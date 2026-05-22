# vtaas-ops

Idempotent hibernate/resume script for the VTaaS AWS stack. Two depths:

| Mode | What it does | Savings | Resume cost |
|---|---|---|---|
| **light** | Scale ECS to 0, keep ALB | ~$30/mo | Instant, no DNS change |
| **deep** | Also delete ALB | ~$46/mo | New ALB DNS, update Vercel |

## Prerequisites

- `aws` CLI configured (`aws sts get-caller-identity` should work)
- `jq`
- IAM permissions: `ecs:UpdateService`, `ecs:DescribeServices`, `elbv2:*`, `ce:GetCostAndUsage`

## One-time setup

Fill in the CONFIG block at the top of `vtaas-ops.sh`. `ECS_SERVICES` is an array — list **all** ECS services in the cluster you want hibernate/resume to operate on. Order matters: the script scales services down in the order listed and back up in the same order. Put user-facing services (e.g. anything behind the ALB) first so they drain before queue workers on hibernate, and start before workers on resume.

Use these commands to discover the values:

```bash
# ECS cluster + all services (script targets every service listed in ECS_SERVICES)
aws ecs list-clusters --region us-east-1
aws ecs list-services --cluster <cluster-name> --region us-east-1

# ALB name + target group
aws elbv2 describe-load-balancers --region us-east-1 \
  --query 'LoadBalancers[*].[LoadBalancerName,DNSName,State.Code]' --output table
aws elbv2 describe-target-groups --region us-east-1 \
  --query 'TargetGroups[*].[TargetGroupName,Protocol,Port]' --output table

# ALB subnets + security group (look at current ALB before tearing it down)
aws elbv2 describe-load-balancers --names <alb-name> --region us-east-1 \
  --query 'LoadBalancers[0].[AvailabilityZones[*].SubnetId, SecurityGroups]'

# Listener config (port, protocol, cert ARN if HTTPS)
aws elbv2 describe-listeners --load-balancer-arn <alb-arn> --region us-east-1 \
  --query 'Listeners[*].[Protocol,Port,Certificates[0].CertificateArn]'
```

VTaaS values are pre-filled — `ECS_SERVICES=("vtaas-api" "vtaas-worker")`. API first because it's the ALB-bound user-facing service; the worker is queue-driven and tolerates draining after the API is already quiet.

Then:

```bash
chmod +x vtaas-ops.sh
./vtaas-ops.sh status     # sanity check — should print current state
```

## Usage

```bash
./vtaas-ops.sh status            # what's running right now
./vtaas-ops.sh costs             # MTD gross spend, by service
./vtaas-ops.sh hibernate         # going away for weeks
./vtaas-ops.sh resume            # back in business
./vtaas-ops.sh hibernate-deep    # going away for months
./vtaas-ops.sh resume-deep       # ...and back (will print new ALB DNS)
```

## Notes

- **Multi-service operation**: all hibernate/resume commands operate on every entry in `ECS_SERVICES`. The script issues `update-service` per service in order, then waits for `services-stable` across all of them in one `aws ecs wait` call. If only one service should be touched, edit the array.
- **Listener config**: defaults to HTTP:80. If the original ALB had HTTPS, set `ALB_LISTENER_PROTOCOL=HTTPS` and uncomment `ACM_CERT_ARN`. Saved listener JSON lives in `~/.vtaas-ops/last-listeners.json` after a deep hibernate — sanity-check against that before resuming.
- **Vercel update after deep resume**: edit `vercel.json` `/api/*` rewrite destination to the new ALB DNS, commit, redeploy. Alternative: put a CNAME like `api.vtaas.abhinavyedla.com` in front of the ALB and update only the CNAME on resume — Vercel config stays static.
- **What stays cheap/free during hibernate** (no need to delete): ECR images, S3 buckets, IAM roles, security groups, VPC/subnets, CloudWatch log groups (within 5GB free tier), SSM Parameter Store, target group, Neon Postgres (separate billing).
- **Public IPv4 charges** disappear when Fargate tasks stop (light) and the ALB is gone (deep) — the $14/mo IPv4 line is mostly Fargate-assigned IPs + ALB AZ IPs.

## Optional: cron a daily status email

```cron
0 9 * * * /path/to/vtaas-ops.sh status 2>&1 | mail -s "vtaas daily" you@example.com
```

Or `costs` weekly to catch surprises early.
