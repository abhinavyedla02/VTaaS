#!/bin/bash
set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "=== Creating IAM Roles ==="

# --- Trust Policy (same for all ECS task roles) ---
cat > /tmp/ecs-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# --- 1. Task Execution Role (shared — pulls images, writes logs, reads SSM) ---
echo "Creating task execution role..."
aws iam create-role \
  --role-name vtaas-ecs-execution-role \
  --assume-role-policy-document file:///tmp/ecs-trust-policy.json || echo "Role exists"

aws iam attach-role-policy \
  --role-name vtaas-ecs-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# SSM read access (for DATABASE_URL secret)
cat > /tmp/execution-ssm-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters",
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter/vtaas/*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name vtaas-ecs-execution-role \
  --policy-name vtaas-ssm-read \
  --policy-document file:///tmp/execution-ssm-policy.json

# --- 2. API Task Role (S3 read/write, SQS send) ---
echo "Creating API task role..."
aws iam create-role \
  --role-name vtaas-api-task-role \
  --assume-role-policy-document file:///tmp/ecs-trust-policy.json || echo "Role exists"

cat > /tmp/api-task-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject"
      ],
      "Resource": [
        "arn:aws:s3:::vtaas-inputs-${ACCOUNT_ID}/*",
        "arn:aws:s3:::vtaas-outputs-${ACCOUNT_ID}/*",
        "arn:aws:s3:::vtaas-samples-${ACCOUNT_ID}/*"
      ]
    },
    {
      "Sid": "SQSSend",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:${REGION}:${ACCOUNT_ID}:transcode-jobs*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name vtaas-api-task-role \
  --policy-name vtaas-api-permissions \
  --policy-document file:///tmp/api-task-policy.json

# --- 3. Worker Task Role (S3 read/write, SQS consume) ---
echo "Creating Worker task role..."
aws iam create-role \
  --role-name vtaas-worker-task-role \
  --assume-role-policy-document file:///tmp/ecs-trust-policy.json || echo "Role exists"

cat > /tmp/worker-task-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:HeadObject"
      ],
      "Resource": [
        "arn:aws:s3:::vtaas-inputs-${ACCOUNT_ID}/*",
        "arn:aws:s3:::vtaas-outputs-${ACCOUNT_ID}/*"
      ]
    },
    {
      "Sid": "SQSConsume",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:${REGION}:${ACCOUNT_ID}:transcode-jobs*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name vtaas-worker-task-role \
  --policy-name vtaas-worker-permissions \
  --policy-document file:///tmp/worker-task-policy.json

echo ""
echo "=== IAM ROLES CREATED ==="
echo "Execution Role: arn:aws:iam::${ACCOUNT_ID}:role/vtaas-ecs-execution-role"
echo "API Task Role:  arn:aws:iam::${ACCOUNT_ID}:role/vtaas-api-task-role"
echo "Worker Task Role: arn:aws:iam::${ACCOUNT_ID}:role/vtaas-worker-task-role"
