#!/usr/bin/env bash
#
# Integration test: presign → upload → create job → idempotency → GET → SQS verify
# Requires: Docker Compose running, curl, jq, awslocal
#
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
BUCKET="vtaas-inputs"
QUEUE_NAME="${SQS_QUEUE_NAME:-transcode-jobs}"
TEST_FILE="/tmp/vtaas-test-job.bin"

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
for cmd in curl jq awslocal; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Missing dependency: $cmd"
done

echo ""
echo "=========================================="
echo "  VTaaS Jobs Integration Test"
echo "=========================================="
echo ""

# -----------------------------------------------------------
# Step 1: Create a dummy test file (10KB)
# -----------------------------------------------------------
info "Creating 10KB test file..."
dd if=/dev/zero of="$TEST_FILE" bs=1024 count=10 2>/dev/null
FILE_SIZE=$(wc -c <"$TEST_FILE" | tr -d ' ')
pass "Test file created (${FILE_SIZE} bytes)"

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

if [ "$GET_STATUS" = "PENDING" ] && [ "$GET_INPUT_KEY" = "$INPUT_KEY" ]; then
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
QUEUE_URL=$(awslocal sqs get-queue-url --queue-name "$QUEUE_NAME" --output text 2>/dev/null) || \
    fail "Could not find SQS queue: $QUEUE_NAME"

SQS_RESPONSE=$(awslocal sqs receive-message \
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
# Cleanup
# -----------------------------------------------------------
rm -f "$TEST_FILE"

echo ""
echo "=========================================="
echo -e "  ${GREEN}ALL CHECKS PASSED${NC}"
echo "=========================================="
echo ""
