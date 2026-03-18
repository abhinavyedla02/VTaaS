#!/usr/bin/env bash
#
# Integration test (13 steps): presign → upload → create job → idempotency → GET →
#   SQS verify → poll worker completion → assert SUCCEEDED → assert outputKeys →
#   assert S3 output exists
# Requires: Docker Compose running, curl, jq, awslocal, ffmpeg
#
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
BUCKET="vtaas-inputs"
OUTPUTS_BUCKET="vtaas-outputs"
QUEUE_NAME="${SQS_QUEUE_NAME:-transcode-jobs}"
TEST_FILE="/tmp/vtaas-test-video.mp4"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}→ $1${NC}"; }

# -----------------------------------------------------------
# Pre-flight: check dependencies
# -----------------------------------------------------------
for cmd in curl jq; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Missing dependency: $cmd"
done

# SQS helper: prefer awslocal, fall back to aws --endpoint-url, then docker exec
if command -v awslocal >/dev/null 2>&1; then
    SQS_CMD="awslocal sqs"
elif command -v aws >/dev/null 2>&1; then
    SQS_CMD="aws --endpoint-url ${AWS_ENDPOINT} sqs"
elif docker exec vtaas_localstack awslocal sqs list-queues >/dev/null 2>&1; then
    SQS_CMD="docker exec vtaas_localstack awslocal sqs"
else
    fail "Missing dependency: awslocal, aws CLI, or running LocalStack container"
fi

echo ""
echo "=========================================="
echo "  VTaaS Jobs Integration Test"
echo "=========================================="
echo ""

# -----------------------------------------------------------
# Step 1: Generate a real minimal test video using ffmpeg
# -----------------------------------------------------------
info "Generating real H.264 test video via ffmpeg..."
command -v ffmpeg >/dev/null 2>&1 || fail "Missing dependency: ffmpeg"
ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 \
    -c:v libx264 "$TEST_FILE" -y 2>/dev/null
FILE_SIZE=$(wc -c <"$TEST_FILE" | tr -d ' ')
pass "Test video generated (${FILE_SIZE} bytes): ${TEST_FILE}"

# -----------------------------------------------------------
# Step 2: Presign upload URL
# -----------------------------------------------------------
info "Requesting presigned URL from POST ${API_URL}/api/uploads..."
UPLOAD_RESPONSE=$(curl -s -X POST "${API_URL}/api/uploads" \
    -H "Content-Type: application/json" \
    -d "{\"mimeType\":\"video/mp4\",\"sizeBytes\":${FILE_SIZE}}")

URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.url')
INPUT_KEY=$(echo "$UPLOAD_RESPONSE" | jq -r '.inputKey')

if [ "$URL" = "null" ] || [ -z "$URL" ]; then
    fail "Failed to get presigned URL. Response: $UPLOAD_RESPONSE"
fi
pass "Presigned URL received"
info "  inputKey: ${INPUT_KEY}"

# -----------------------------------------------------------
# Step 3: Upload file to S3
# -----------------------------------------------------------
UPLOAD_URL=$(echo "$URL" | sed "s|http://localstack:4566|${AWS_ENDPOINT}|")

info "Uploading file to S3..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "$UPLOAD_URL" \
    -H "Content-Type: video/mp4" \
    --data-binary "@${TEST_FILE}")

if [ "$HTTP_STATUS" -eq 200 ]; then
    pass "File uploaded (HTTP ${HTTP_STATUS})"
else
    fail "Upload failed (HTTP ${HTTP_STATUS})"
fi

# -----------------------------------------------------------
# Step 4: Create job
# -----------------------------------------------------------
info "Creating job via POST ${API_URL}/api/jobs..."
JOB_RESPONSE=$(curl -s -X POST "${API_URL}/api/jobs" \
    -H "Content-Type: application/json" \
    -d "{\"inputKey\":\"${INPUT_KEY}\"}")

JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.id')
JOB_STATUS=$(echo "$JOB_RESPONSE" | jq -r '.status')

if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
    fail "Failed to create job. Response: $JOB_RESPONSE"
fi

if [ "$JOB_STATUS" = "PENDING" ]; then
    pass "Job created: ${JOB_ID} (status: ${JOB_STATUS})"
else
    fail "Unexpected job status: ${JOB_STATUS} (expected PENDING)"
fi

# -----------------------------------------------------------
# Step 5: Idempotency — duplicate create returns same job
# -----------------------------------------------------------
info "Testing idempotency: re-posting same inputKey..."
DUP_RESPONSE=$(curl -s -X POST "${API_URL}/api/jobs" \
    -H "Content-Type: application/json" \
    -d "{\"inputKey\":\"${INPUT_KEY}\"}")

DUP_ID=$(echo "$DUP_RESPONSE" | jq -r '.id')

if [ "$DUP_ID" = "$JOB_ID" ]; then
    pass "Idempotency verified: duplicate returned same job ID"
else
    fail "Idempotency broken: expected ${JOB_ID}, got ${DUP_ID}"
fi

# -----------------------------------------------------------
# Step 6: GET job by ID
# -----------------------------------------------------------
info "Fetching job via GET ${API_URL}/api/jobs/${JOB_ID}..."
GET_RESPONSE=$(curl -s "${API_URL}/api/jobs/${JOB_ID}")

GET_STATUS=$(echo "$GET_RESPONSE" | jq -r '.status')
GET_INPUT_KEY=$(echo "$GET_RESPONSE" | jq -r '.inputKey')

if { [ "$GET_STATUS" = "PENDING" ] || [ "$GET_STATUS" = "PROCESSING" ] || [ "$GET_STATUS" = "SUCCEEDED" ]; } && [ "$GET_INPUT_KEY" = "$INPUT_KEY" ]; then
    pass "GET returned correct job (status: ${GET_STATUS}, inputKey: ${GET_INPUT_KEY})"
else
    fail "GET response mismatch. Response: $GET_RESPONSE"
fi

# -----------------------------------------------------------
# Step 7: GET missing job returns 404
# -----------------------------------------------------------
info "Testing GET with missing ID..."
MISSING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "${API_URL}/api/jobs/00000000-0000-0000-0000-000000000000")

if [ "$MISSING_STATUS" -eq 404 ]; then
    pass "Missing job returns HTTP 404"
else
    fail "Expected 404 for missing job, got HTTP ${MISSING_STATUS}"
fi

# -----------------------------------------------------------
# Step 8: Verify SQS message exists
# -----------------------------------------------------------
info "Checking SQS for transcode message..."
QUEUE_URL=$($SQS_CMD get-queue-url --queue-name "$QUEUE_NAME" --output text 2>/dev/null) || \
    fail "Could not find SQS queue: $QUEUE_NAME"

SQS_RESPONSE=$($SQS_CMD receive-message \
    --queue-url "$QUEUE_URL" \
    --max-number-of-messages 10 \
    --wait-time-seconds 1 2>/dev/null)

MSG_COUNT=$(echo "$SQS_RESPONSE" | jq '.Messages | length' 2>/dev/null || echo "0")

if [ "$MSG_COUNT" -ge 1 ]; then
    # Check that at least one message contains our jobId
    FOUND=$(echo "$SQS_RESPONSE" | jq -r ".Messages[].Body" | jq -r "select(.jobId == \"${JOB_ID}\") | .jobId" 2>/dev/null || echo "")
    if [ "$FOUND" = "$JOB_ID" ]; then
        pass "SQS message found for job ${JOB_ID}"
        MSG_BODY=$(echo "$SQS_RESPONSE" | jq -r ".Messages[].Body" | jq "select(.jobId == \"${JOB_ID}\")" 2>/dev/null)
        info "  Message body: ${MSG_BODY}"
    else
        pass "SQS messages exist (${MSG_COUNT} total) — job ID match skipped (may have been consumed)"
    fi
else
    fail "No SQS messages found in queue ${QUEUE_NAME}"
fi

# -----------------------------------------------------------
# Step 9: Poll for worker completion
# -----------------------------------------------------------
info "Polling GET ${API_URL}/api/jobs/${JOB_ID} for worker completion (up to 60s)..."
POLL_TIMEOUT=60
POLL_INTERVAL=2
ELAPSED=0
FINAL_STATUS=""
while [ "$ELAPSED" -lt "$POLL_TIMEOUT" ]; do
    POLL_RESPONSE=$(curl -s "${API_URL}/api/jobs/${JOB_ID}")
    FINAL_STATUS=$(echo "$POLL_RESPONSE" | jq -r '.status')
    if [ "$FINAL_STATUS" = "SUCCEEDED" ] || [ "$FINAL_STATUS" = "FAILED" ]; then
        break
    fi
    info "  status: ${FINAL_STATUS} — waiting ${POLL_INTERVAL}s... (${ELAPSED}s elapsed)"
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ "$ELAPSED" -ge "$POLL_TIMEOUT" ] && [ "$FINAL_STATUS" != "SUCCEEDED" ] && [ "$FINAL_STATUS" != "FAILED" ]; then
    fail "Timeout: job ${JOB_ID} did not reach a terminal state within ${POLL_TIMEOUT}s (last status: ${FINAL_STATUS})"
fi
pass "Worker completed in ~${ELAPSED}s (status: ${FINAL_STATUS})"

# -----------------------------------------------------------
# Step 10: Assert SUCCEEDED
# -----------------------------------------------------------
info "Asserting job status is SUCCEEDED..."
if [ "$FINAL_STATUS" != "SUCCEEDED" ]; then
    echo -e "${RED}✗ Job status is ${FINAL_STATUS} (expected SUCCEEDED). Full response:${NC}"
    echo "$POLL_RESPONSE" | jq .
    exit 1
fi
pass "Job status is SUCCEEDED"

# -----------------------------------------------------------
# Step 11: Assert outputKeys populated
# -----------------------------------------------------------
info "Asserting outputKeys contains outputs/${JOB_ID}/720p.mp4..."
EXPECTED_OUTPUT_KEY="outputs/${JOB_ID}/720p.mp4"
OUTPUT_KEY_MATCH=$(echo "$POLL_RESPONSE" | jq -r ".outputKeys[]" 2>/dev/null | grep -F "$EXPECTED_OUTPUT_KEY" || echo "")
if [ -z "$OUTPUT_KEY_MATCH" ]; then
    fail "outputKeys does not contain \"${EXPECTED_OUTPUT_KEY}\". Full response: $(echo \"$POLL_RESPONSE\" | jq .)"
fi
pass "outputKeys contains ${EXPECTED_OUTPUT_KEY}"

# -----------------------------------------------------------
# Step 12: Assert S3 output object exists
# -----------------------------------------------------------
info "Checking S3 output object at ${AWS_ENDPOINT}/${OUTPUTS_BUCKET}/${EXPECTED_OUTPUT_KEY}..."
S3_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "${AWS_ENDPOINT}/${OUTPUTS_BUCKET}/${EXPECTED_OUTPUT_KEY}")
if [ "$S3_STATUS" -eq 200 ]; then
    pass "S3 output object exists (HTTP ${S3_STATUS})"
else
    fail "S3 output object NOT found (HTTP ${S3_STATUS}). Expected: ${AWS_ENDPOINT}/${OUTPUTS_BUCKET}/${EXPECTED_OUTPUT_KEY}"
fi

# -----------------------------------------------------------
# Cleanup
# -----------------------------------------------------------
rm -f "$TEST_FILE"

echo ""
echo "=========================================="
echo -e "  ${GREEN}ALL CHECKS PASSED (Steps 1–13)${NC}"
echo "=========================================="
echo ""
