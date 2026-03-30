#!/bin/bash
set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "=== Account: $ACCOUNT_ID | Region: $REGION ==="

# --- ECR Repositories ---
echo "Creating ECR repositories..."
aws ecr create-repository --repository-name vtaas-api --region $REGION \
  --image-scanning-configuration scanOnPush=false || echo "vtaas-api already exists"

aws ecr create-repository --repository-name vtaas-worker --region $REGION \
  --image-scanning-configuration scanOnPush=false || echo "vtaas-worker already exists"

# --- S3 Buckets ---
# S3 bucket names are globally unique — prefix with account ID.
echo "Creating S3 buckets..."
aws s3 mb "s3://vtaas-inputs-${ACCOUNT_ID}" --region $REGION || echo "inputs bucket exists"
aws s3 mb "s3://vtaas-outputs-${ACCOUNT_ID}" --region $REGION || echo "outputs bucket exists"
aws s3 mb "s3://vtaas-samples-${ACCOUNT_ID}" --region $REGION || echo "samples bucket exists"

# CORS on inputs bucket (presigned PUT from browser)
cat > /tmp/cors.json << 'CORS'
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT", "GET"],
      "AllowedOrigins": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
CORS
aws s3api put-bucket-cors --bucket "vtaas-inputs-${ACCOUNT_ID}" \
  --cors-configuration file:///tmp/cors.json

# CORS on outputs bucket (presigned GET for video playback)
aws s3api put-bucket-cors --bucket "vtaas-outputs-${ACCOUNT_ID}" \
  --cors-configuration file:///tmp/cors.json

# --- SQS Queues ---
echo "Creating SQS queues..."

# DLQ first (main queue references it)
DLQ_URL=$(aws sqs create-queue \
  --queue-name transcode-jobs-dlq \
  --region $REGION \
  --query 'QueueUrl' --output text)

DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

echo "DLQ ARN: $DLQ_ARN"

# Main queue with redrive policy
QUEUE_URL=$(aws sqs create-queue \
  --queue-name transcode-jobs \
  --region $REGION \
  --attributes "{
    \"VisibilityTimeout\": \"300\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }" \
  --query 'QueueUrl' --output text)

echo "Queue URL: $QUEUE_URL"

# --- Summary ---
echo ""
echo "=== RESOURCES CREATED ==="
echo "ECR API:       ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/vtaas-api"
echo "ECR Worker:    ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/vtaas-worker"
echo "S3 Inputs:     vtaas-inputs-${ACCOUNT_ID}"
echo "S3 Outputs:    vtaas-outputs-${ACCOUNT_ID}"
echo "S3 Samples:    vtaas-samples-${ACCOUNT_ID}"
echo "SQS Queue:     $QUEUE_URL"
echo "SQS DLQ:       $DLQ_URL"
echo ""
echo ">>> Save these values for task definitions <<<"
