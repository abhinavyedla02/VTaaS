#!/usr/bin/env bash
# vtaas-ops.sh — hibernate/resume VTaaS infrastructure
# Usage: ./vtaas-ops.sh {status|hibernate|hibernate-deep|resume|resume-deep|costs}

set -euo pipefail

# ============================================================
# CONFIG — fill these in once (see README for discovery commands)
# ============================================================
AWS_REGION="us-east-1"
ECS_CLUSTER="vtaas"
# API first — it's the user-facing service behind the ALB and should drain first on hibernate
ECS_SERVICES=("vtaas-api" "vtaas-worker")
ALB_NAME="vtaas-alb"
TARGET_GROUP_NAME="vtaas-api-tg"
ALB_SUBNETS=("subnet-0d9cf365f38488798" "subnet-0eb4cc29a53fe8f04")  # us-east-1b, us-east-1e
ALB_SECURITY_GROUP="sg-0e41ef2d3aa4efe58"
ALB_LISTENER_PORT=80
ALB_LISTENER_PROTOCOL=HTTP   # Vercel terminates TLS; ALB serves HTTP behind it
# ACM_CERT_ARN="arn:aws:acm:us-east-1:..."

STATE_DIR="${HOME}/.vtaas-ops"
mkdir -p "$STATE_DIR"

# ============================================================
# Helpers
# ============================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }

confirm() {
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { warn "Aborted"; exit 1; }
}

aws_q() { aws "$@" --region "$AWS_REGION"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing dependency: $1"; exit 1; }
}

require aws
require jq

# ============================================================
# Discovery helpers (internal)
# ============================================================
get_alb_arn() {
  aws_q elbv2 describe-load-balancers --names "$ALB_NAME" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo ""
}

get_tg_arn() {
  aws_q elbv2 describe-target-groups --names "$TARGET_GROUP_NAME" \
    --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || echo ""
}

# ============================================================
# Commands
# ============================================================

cmd_status() {
  log "Checking VTaaS state..."
  echo

  # ECS services (loop over all configured)
  local svc n i
  svc=$(aws_q ecs describe-services --cluster "$ECS_CLUSTER" --services "${ECS_SERVICES[@]}" 2>/dev/null || echo "")
  n=$(echo "$svc" | jq '.services | length' 2>/dev/null || echo 0)
  if [[ -z "$svc" ]] || [[ "$n" -eq 0 ]]; then
    warn "No ECS services found in $ECS_CLUSTER (${ECS_SERVICES[*]})"
  else
    for i in $(seq 0 $((n-1))); do
      local name status desired running cp
      name=$(echo "$svc" | jq -r ".services[$i].serviceName")
      status=$(echo "$svc" | jq -r ".services[$i].status")
      desired=$(echo "$svc" | jq ".services[$i].desiredCount")
      running=$(echo "$svc" | jq ".services[$i].runningCount")
      cp=$(echo "$svc" | jq -r "(.services[$i].capacityProviderStrategy // []) | if length == 0 then \"on-demand (\(\$lt))\" else (map(\"\(.capacityProvider)=\(.weight)\") | join(\",\")) end" --arg lt "$(echo "$svc" | jq -r ".services[$i].launchType // \"\"")" 2>/dev/null)
      echo "  ECS $name: $status | desired=$desired running=$running | cp=${cp:-unknown}"
    done
  fi

  # ALB
  local alb_arn
  alb_arn=$(get_alb_arn)
  if [[ -z "$alb_arn" || "$alb_arn" == "None" ]]; then
    warn "ALB not present"
  else
    local dns state
    dns=$(aws_q elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" --query 'LoadBalancers[0].DNSName' --output text)
    state=$(aws_q elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" --query 'LoadBalancers[0].State.Code' --output text)
    echo "  ALB: $state | $dns"
  fi

  # Target health
  local tg_arn
  tg_arn=$(get_tg_arn)
  if [[ -n "$tg_arn" && "$tg_arn" != "None" ]]; then
    local healthy total
    total=$(aws_q elbv2 describe-target-health --target-group-arn "$tg_arn" --query 'TargetHealthDescriptions | length(@)' --output text)
    healthy=$(aws_q elbv2 describe-target-health --target-group-arn "$tg_arn" --query 'TargetHealthDescriptions[?TargetHealth.State==`healthy`] | length(@)' --output text)
    echo "  Target group: $healthy/$total healthy"
  fi
  echo
}

cmd_hibernate() {
  log "Light hibernate — scale all ECS services to 0, keep ALB"
  log "Services: ${ECS_SERVICES[*]}"
  confirm "Continue?"

  for svc in "${ECS_SERVICES[@]}"; do
    log "Scaling $svc to 0..."
    aws_q ecs update-service \
      --cluster "$ECS_CLUSTER" --service "$svc" \
      --desired-count 0 >/dev/null
  done

  log "Waiting for all services to drain..."
  aws_q ecs wait services-stable \
    --cluster "$ECS_CLUSTER" --services "${ECS_SERVICES[@]}"

  ok "All ECS services scaled to 0. ALB still up. Savings: ~\$30/mo"
}

cmd_hibernate_deep() {
  log "Deep hibernate — scale all ECS services to 0 AND delete ALB"
  log "Services: ${ECS_SERVICES[*]}"
  warn "Frontend /api/* will 502 until resume + Vercel DNS update"
  confirm "Continue?"

  # Scale all services down first so tasks deregister cleanly (API first to drain ALB traffic)
  for svc in "${ECS_SERVICES[@]}"; do
    log "Scaling $svc to 0..."
    aws_q ecs update-service \
      --cluster "$ECS_CLUSTER" --service "$svc" \
      --desired-count 0 >/dev/null
  done

  log "Waiting for all services to drain..."
  aws_q ecs wait services-stable \
    --cluster "$ECS_CLUSTER" --services "${ECS_SERVICES[@]}"
  ok "All services drained"

  local alb_arn
  alb_arn=$(get_alb_arn)
  if [[ -z "$alb_arn" || "$alb_arn" == "None" ]]; then
    warn "ALB already gone — skipping delete"
    return
  fi

  # Snapshot ALB + listener config so resume can faithfully recreate
  log "Saving ALB state to $STATE_DIR/"
  aws_q elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" \
    > "$STATE_DIR/last-alb.json"
  aws_q elbv2 describe-listeners --load-balancer-arn "$alb_arn" \
    > "$STATE_DIR/last-listeners.json"

  # Delete listeners
  log "Deleting listeners..."
  for listener_arn in $(jq -r '.Listeners[].ListenerArn' "$STATE_DIR/last-listeners.json"); do
    aws_q elbv2 delete-listener --listener-arn "$listener_arn"
  done

  # Delete ALB
  log "Deleting ALB..."
  aws_q elbv2 delete-load-balancer --load-balancer-arn "$alb_arn"

  ok "ALB deleted. Savings: ~\$46/mo"
}

cmd_resume() {
  log "Light resume — scale all ECS services back up"

  local alb_arn
  alb_arn=$(get_alb_arn)
  if [[ -z "$alb_arn" || "$alb_arn" == "None" ]]; then
    err "ALB not found — run 'resume-deep' to recreate it"
    exit 1
  fi

  for svc in "${ECS_SERVICES[@]}"; do
    log "Scaling $svc to 1..."
    aws_q ecs update-service \
      --cluster "$ECS_CLUSTER" --service "$svc" \
      --desired-count 1 >/dev/null
  done

  log "Waiting for all services to start..."
  aws_q ecs wait services-stable \
    --cluster "$ECS_CLUSTER" --services "${ECS_SERVICES[@]}"

  local dns
  dns=$(aws_q elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" --query 'LoadBalancers[0].DNSName' --output text)
  ok "Up. ALB: $dns"
}

cmd_resume_deep() {
  log "Deep resume — recreate ALB and scale ECS back up"

  if [[ -n "$(get_alb_arn)" && "$(get_alb_arn)" != "None" ]]; then
    warn "ALB already exists — use 'resume' instead"
    exit 1
  fi

  local tg_arn
  tg_arn=$(get_tg_arn)
  if [[ -z "$tg_arn" || "$tg_arn" == "None" ]]; then
    err "Target group $TARGET_GROUP_NAME not found — can't reattach"
    exit 1
  fi

  # Create ALB
  log "Creating ALB..."
  local alb_arn
  alb_arn=$(aws_q elbv2 create-load-balancer \
    --name "$ALB_NAME" \
    --subnets "${ALB_SUBNETS[@]}" \
    --security-groups "$ALB_SECURITY_GROUP" \
    --type application \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)

  log "Waiting for ALB to be active..."
  aws_q elbv2 wait load-balancer-available --load-balancer-arns "$alb_arn"

  # Create listener
  log "Creating listener ($ALB_LISTENER_PROTOCOL:$ALB_LISTENER_PORT)..."
  local listener_args=(
    --load-balancer-arn "$alb_arn"
    --protocol "$ALB_LISTENER_PROTOCOL"
    --port "$ALB_LISTENER_PORT"
    --default-actions "Type=forward,TargetGroupArn=$tg_arn"
  )
  if [[ "$ALB_LISTENER_PROTOCOL" == "HTTPS" ]]; then
    listener_args+=(--certificates "CertificateArn=${ACM_CERT_ARN}")
  fi
  aws_q elbv2 create-listener "${listener_args[@]}" >/dev/null

  # Start ECS services (API first so ALB has a target by the time worker comes up)
  for svc in "${ECS_SERVICES[@]}"; do
    log "Scaling $svc to 1..."
    aws_q ecs update-service \
      --cluster "$ECS_CLUSTER" --service "$svc" \
      --desired-count 1 >/dev/null
  done

  log "Waiting for all services to stabilize..."
  aws_q ecs wait services-stable \
    --cluster "$ECS_CLUSTER" --services "${ECS_SERVICES[@]}"

  local new_dns
  new_dns=$(aws_q elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" --query 'LoadBalancers[0].DNSName' --output text)

  ok "Resume complete"
  echo
  warn "NEXT STEP — update Vercel rewrite target to:"
  echo "    $new_dns"
  echo
  echo "  Edit vercel.json /api/* destination, commit, and redeploy."
}

cmd_costs() {
  log "Month-to-date gross spend (pre-credit) by service..."
  local start end
  start=$(date -u +%Y-%m-01)
  end=$(date -u -d "+1 day" +%Y-%m-%d 2>/dev/null || date -u -v+1d +%Y-%m-%d)

  aws ce get-cost-and-usage \
    --time-period "Start=$start,End=$end" \
    --granularity MONTHLY \
    --metrics UnblendedCost \
    --group-by Type=DIMENSION,Key=SERVICE \
    --region us-east-1 \
    --query 'ResultsByTime[0].Groups[?Metrics.UnblendedCost.Amount!=`0`].[Keys[0],Metrics.UnblendedCost.Amount]' \
    --output table
}

# ============================================================
# Dispatch
# ============================================================
usage() {
  cat <<EOF
Usage: $0 {status|hibernate|hibernate-deep|resume|resume-deep|costs}

  status          Show ECS service, ALB, target health
  hibernate       Light: scale ECS to 0, keep ALB        (~\$30/mo saved)
  hibernate-deep  Full: delete ALB too                   (~\$46/mo saved, DNS update on resume)
  resume          Bring back from light hibernate
  resume-deep     Bring back from deep hibernate (new ALB DNS, update Vercel)
  costs           Show MTD gross spend by service (pre-credit)
EOF
}

case "${1:-}" in
  status)         cmd_status ;;
  hibernate)      cmd_hibernate ;;
  hibernate-deep) cmd_hibernate_deep ;;
  resume)         cmd_resume ;;
  resume-deep)    cmd_resume_deep ;;
  costs)          cmd_costs ;;
  ""|-h|--help)   usage ;;
  *)              err "Unknown command: $1"; usage; exit 1 ;;
esac
