#!/bin/bash
# Seed the vtaas-samples bucket with the sample video.
# Runs inside LocalStack after the "ready" event.

set -euo pipefail

echo "Creating vtaas-samples bucket..."
awslocal s3 mb s3://vtaas-samples 2>/dev/null || true

echo "Uploading sample video..."
awslocal s3 cp /seed/sample.mp4 s3://vtaas-samples/sample.mp4

echo "Sample video seeded successfully."
