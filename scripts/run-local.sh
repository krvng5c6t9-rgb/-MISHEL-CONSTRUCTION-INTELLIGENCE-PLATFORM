#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "BLOCKED: Docker is required."; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "BLOCKED: Docker Compose v2 is required."; exit 2; }

ENV_FILE=.env.local
if [[ ! -f "$ENV_FILE" ]]; then
  secret() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
  cat > "$ENV_FILE" <<ENV
POSTGRES_PASSWORD=$(secret)
JWT_SECRET=$(secret)
BOOTSTRAP_ADMIN_TOKEN=$(secret)
ENV
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with generated local secrets."
fi

echo "Freezing dependency graph if lockfiles are not present..."
bash scripts/freeze-dependencies.sh

echo "Running immutable-release and full hostile regression gates..."
npm run check:immutable
npm run check:release

echo "Starting Construction ERP local stack..."
docker compose --env-file "$ENV_FILE" up --build -d

echo "Waiting for backend health..."
for i in $(seq 1 60); do
  if node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "ERP is running."
    echo "Frontend: http://localhost:5173"
    echo "First-run setup: http://localhost:5173/setup"
    echo "Bootstrap token is stored in $ENV_FILE"
    exit 0
  fi
  sleep 2
done

echo "FAIL: backend did not become healthy. Run: docker compose --env-file $ENV_FILE logs"
exit 1
