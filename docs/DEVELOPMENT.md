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

# Check web service
curl http://localhost:5173
# Expected output: Returns HTML page

# Check web health check proxy
curl http://localhost:5173/api/health
# Expected output: {"status":"ok"}

# Check LocalStack health (if healthcheck is implemented)
curl http://localhost:4566/_localstack/health

# View service status
docker compose ps

# View API logs
docker logs -f vtaas_api

# View web logs
docker logs -f vtaas_web

# View all service logs
docker compose logs -f
```

### Common commands
```bash
# Rebuild API after code changes
docker compose build api
docker compose up -d api

# Rebuild web after code changes
docker compose build web
docker compose up -d web

# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

---

## Known Limitations

**Docker Compose is the supported workflow** - `fetch('/api/health')` relies on Vite proxy to `http://api:3000` (Docker DNS). This works when web runs in Docker Compose. If running `npm run dev` on host, proxy will fail unless you change the proxy target to `http://localhost:3000`.

**React StrictMode in development** - In development mode, React StrictMode intentionally double-invokes effects to help catch bugs. This causes `useEffect` to run twice, resulting in 2 `/api/health` calls when the page loads. This is expected behavior and helps catch bugs. Production builds don't have this behavior.