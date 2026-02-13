#!/usr/bin/env bash
#
# Integration test: presign → PUT → HEAD → verify
# Requires: Docker Compose running, curl, jq
#
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
BUCKET="vtaas-inputs"
TEST_FILE="/tmp/vtaas-test-upload.bin"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}→ $1${NC}"; }

# -----------------------------------------------------------
# Pre-flight: check dependencies
# -----------------------------------------------------------
for cmd in curl jq; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Missing dependency: $cmd"
done

echo ""
echo "=========================================="
echo "  VTaaS Upload Integration Test"
echo "=========================================="
echo ""

# -----------------------------------------------------------
# Step 1: Create a dummy test file (10KB of zeros)
# -----------------------------------------------------------
info "Creating 10KB test file..."
dd if=/dev/zero of="$TEST_FILE" bs=1024 count=10 2>/dev/null
FILE_SIZE=$(wc -c < "$TEST_FILE" | tr -d ' ')
pass "Test file created (${FILE_SIZE} bytes)"

# -----------------------------------------------------------
# Step 2: Request presigned URL from API
# -----------------------------------------------------------
info "Requesting presigned URL from POST ${API_URL}/api/uploads..."
RESPONSE=$(curl -s -X POST "${API_URL}/api/uploads" \
    -H "Content-Type: application/json" \
    -d "{\"mimeType\":\"video/mp4\",\"sizeBytes\":${FILE_SIZE}}")

# Parse response
URL=$(echo "$RESPONSE" | jq -r '.url')
INPUT_KEY=$(echo "$RESPONSE" | jq -r '.inputKey')
EXPIRES_IN=$(echo "$RESPONSE" | jq -r '.expiresIn')

if [ "$URL" = "null" ] || [ -z "$URL" ]; then
    fail "Failed to get presigned URL. Response: $RESPONSE"
fi

pass "Presigned URL received (expires in ${EXPIRES_IN}s)"
info "  inputKey: ${INPUT_KEY}"

# -----------------------------------------------------------
# Step 3: Upload file to presigned URL
# -----------------------------------------------------------
# The presigned URL uses the Docker internal hostname (localstack:4566).
# Replace with localhost for host-side curl.
UPLOAD_URL=$(echo "$URL" | sed "s|http://localstack:4566|${AWS_ENDPOINT}|")

info "Uploading file to S3 via presigned URL..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "$UPLOAD_URL" \
    -H "Content-Type: video/mp4" \
    --data-binary "@${TEST_FILE}")

if [ "$HTTP_STATUS" -eq 200 ]; then
    pass "File uploaded successfully (HTTP ${HTTP_STATUS})"
else
    fail "Upload failed with HTTP ${HTTP_STATUS}"
fi

# -----------------------------------------------------------
# Step 4: HEAD object via S3 REST API to verify it exists
# -----------------------------------------------------------
info "Verifying file exists in S3 via HEAD..."
HEAD_RESPONSE=$(curl -s -I "${AWS_ENDPOINT}/${BUCKET}/${INPUT_KEY}" 2>&1)
HEAD_STATUS=$(echo "$HEAD_RESPONSE" | head -1 | awk '{print $2}')

if [ "$HEAD_STATUS" != "200" ]; then
    fail "HEAD request failed — object not found (HTTP ${HEAD_STATUS})"
fi

# Extract metadata from HEAD response headers
S3_SIZE=$(echo "$HEAD_RESPONSE" | grep -i "content-length" | tail -1 | tr -d '\r' | awk '{print $2}')
S3_CONTENT_TYPE=$(echo "$HEAD_RESPONSE" | grep -i "content-type" | tail -1 | tr -d '\r' | awk '{print $2}')

pass "Object exists in S3"
info "  Size: ${S3_SIZE} bytes"
info "  ContentType: ${S3_CONTENT_TYPE}"

# -----------------------------------------------------------
# Step 5: Assert metadata matches
# -----------------------------------------------------------
if [ "$S3_SIZE" -eq "$FILE_SIZE" ]; then
    pass "Size matches: expected=${FILE_SIZE}, actual=${S3_SIZE}"
else
    fail "Size mismatch: expected=${FILE_SIZE}, actual=${S3_SIZE}"
fi

if [ "$S3_CONTENT_TYPE" = "video/mp4" ]; then
    pass "Content type matches: video/mp4"
else
    fail "Content type mismatch: expected=video/mp4, actual=${S3_CONTENT_TYPE}"
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
