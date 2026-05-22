# Resuming VTaaS from hibernate-deep

VTaaS is currently **frozen**. The ALB has been deleted and both ECS services are scaled to 0. Frozen cost is ~$0.50/mo (ECR storage only). The static portfolio frontend on Vercel still loads; `/api/*` calls return errors until resume.

See [docs/decisions/D-041-cost-optimization.md](docs/decisions/D-041-cost-optimization.md) for the full rationale.

## Resume in 3 steps

1. **Recreate the ALB and scale services back up.**
   ```bash
   ./scripts/vtaas-ops.sh resume-deep
   ```
   The script will:
   - Verify the target group `vtaas-api-tg` still exists
   - Create a new ALB (`vtaas-alb`) in the same 2 AZs (`us-east-1b`, `us-east-1e`)
   - Attach an HTTP:80 listener forwarding to `vtaas-api-tg`
   - Scale `vtaas-api` and `vtaas-worker` to `desiredCount=1`
   - Wait for services to stabilize
   - **Print the new ALB DNS** (will be different from the previous DNS)

2. **Update the Vercel rewrite to the new ALB DNS.**
   Edit `web/vercel.json`, change the `/api/*` rewrite `destination` to the new ALB DNS that the script printed, then commit and push.

3. **Trigger a Vercel redeploy.**
   The push from step 2 should trigger an automatic Vercel deploy. If not, run `vercel --prod` or push an empty commit. Once Vercel finishes deploying, `https://vtaas.abhinavyedla.com/api/*` should return 200s again.

## What's preserved during hibernation

Nothing needs to be re-uploaded or reconfigured:

- ECS cluster, services, task definitions, capacity provider strategies
- Target group `vtaas-api-tg` (the ALB will reattach to it on resume)
- ECR images, S3 buckets, IAM roles, security groups, VPC/subnets
- SQS queues (`transcode-jobs`, `transcode-jobs-dlq`)
- SSM Parameter Store entries
- CloudWatch log groups (14-day retention is still active)
- Neon Postgres (billed separately, unaffected)
- ALB + listener snapshot at `~/.vtaas-ops/last-alb.json` and `last-listeners.json` (for reference only — the script rebuilds from CONFIG values, not from these files)

## Cost going forward after resume

Resume-deep returns the live monthly cost to ~$37/mo (Fargate Spot + right-sized worker + ALB + IPv4). The budget alert at $30 (80% threshold) will fire by email if something regresses.

To go back to frozen state: `./scripts/vtaas-ops.sh hibernate-deep`.
