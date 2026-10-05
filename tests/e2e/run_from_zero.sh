#!/usr/bin/env bash
# Runtime regression gate: fresh database -> migrate -> start API -> bootstrap -> E2E chain -> negative suite -> wave suites.
# Required env:
#   PG_ADMIN_URL   superuser URL to a maintenance DB (used to drop/create the test DB)
#   OWNER_URL_BASE owner (BYPASSRLS) URL without database name, e.g. postgresql://erp_owner:pw@localhost:5432
#   APP_URL_BASE   app role URL without database name,         e.g. postgresql://erp_app:pw@localhost:5432
# Optional: TEST_DB (default erp_e2e), PG_URL_QUERY (e.g. "?host=/run/postgresql"), API_PORT (default 4100), RUN_ID
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${TEST_DB:-erp_e2e}"; Q="${PG_URL_QUERY:-}"; PORT_="${API_PORT:-4100}"; RUN="${RUN_ID:-$(date +%s)}"
OWNER_ROLE="$(node -e "console.log(new URL(process.argv[1]).username)" "$OWNER_URL_BASE")"
psql "$PG_ADMIN_URL" -qv ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB owner $OWNER_ROLE"

cd "$ROOT/backend"
MIGRATION_DATABASE_URL="$OWNER_URL_BASE/$DB$Q" APP_DB_ROLE="$(node -e "console.log(new URL(process.argv[1]).username)" "$APP_URL_BASE")" \
  MIGRATIONS_DIR=../database/migrations node dist/db/migrate.js | tail -1

export DATABASE_URL="$APP_URL_BASE/$DB$Q" PORT="$PORT_" NODE_ENV=development ALLOW_MULTI_TENANT_BOOTSTRAP=true
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export BOOTSTRAP_ADMIN_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
node dist/server.js > "${TMPDIR:-/tmp}/erp_e2e_server_$RUN.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "http://localhost:$PORT_/api/health" >/dev/null && break; sleep 0.5; done

cd "$ROOT/tests/e2e"; mkdir -p out
export API_BASE="http://localhost:$PORT_/api"
node probe.mjs | head -2
PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node chain.mjs
APP_PSQL_URL="$APP_URL_BASE/$DB$Q" node isolation.mjs "out/chain_$RUN.json"
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_boq_handover.mjs
APP_PSQL_URL="$APP_URL_BASE/$DB$Q" OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_vendor_master.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_doa_governance.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_tenant_onboarding.mjs
RUN_ID="$RUN" node wave1_subcontract_ipc.mjs
