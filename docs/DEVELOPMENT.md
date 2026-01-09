# Development (Local)

## Prerequisites
- Docker (Docker Desktop or equivalent)
- Node.js 20 (this repo is pinned to Node 20)
- curl (for quick endpoint checks)

---

## Quickstart (current state)

### Start services
```bash
docker compose up
```

### Verify services are running
```bash
# Check API health endpoint
curl http://localhost:3000/api/health
# Expected output: {"status":"ok"}

# Check LocalStack health (if healthcheck is implemented)
curl http://localhost:4566/_localstack/health

# View service status
docker compose ps

# View API logs
docker logs -f vtaas_api

# View all service logs
docker compose logs -f
```

### Common commands
```bash
# Rebuild API after code changes
docker compose build api
docker compose up -d api

# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```