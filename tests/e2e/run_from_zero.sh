#!/usr/bin/env bash
# Runtime regression gate: fresh database -> migrate -> start API -> bootstrap -> E2E chain -> negative suite -> wave suites.
# Required env:
#   PG_ADMIN_URL   superuser URL to a maintenance DB (used to drop/create the test DB)
#   OWNER_URL_BASE owner (BYPASSRLS) URL without database name, e.g. postgresql://erp_owner:pw@localhost:5432
#   APP_URL_BASE   app role URL without database name,         e.g. postgresql://erp_app:pw@localhost:5432
# Optional: TEST_DB (default erp_e2e), PG_URL_QUERY (e.g. "?host=/run/postgresql"), API_PORT (default 4100), RUN_ID,
#           UI_CHECK=1 (F-29: build the frontend against this API and run the browser checks in tests/ui; needs Chromium
#           via `npm ci` + `npx playwright install chromium` in tests/ui, or CHROMIUM_PATH), UI_PORT (default 4173)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${TEST_DB:-erp_e2e}"; Q="${PG_URL_QUERY:-}"; PORT_="${API_PORT:-4100}"; UI_PORT_="${UI_PORT:-4173}"; RUN="${RUN_ID:-$(date +%s)}"
OWNER_ROLE="$(node -e "console.log(new URL(process.argv[1]).username)" "$OWNER_URL_BASE")"
psql "$PG_ADMIN_URL" -qv ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB owner $OWNER_ROLE"

cd "$ROOT/backend"
MIGRATION_DATABASE_URL="$OWNER_URL_BASE/$DB$Q" APP_DB_ROLE="$(node -e "console.log(new URL(process.argv[1]).username)" "$APP_URL_BASE")" \
  MIGRATIONS_DIR=../database/migrations node dist/db/migrate.js | tail -1

export DATABASE_URL="$APP_URL_BASE/$DB$Q" PORT="$PORT_" NODE_ENV=development ALLOW_MULTI_TENANT_BOOTSTRAP=true CORS_ORIGIN="http://localhost:$UI_PORT_"
# G-017 login throttling: TEST FIXTURE values (production values are the owner's security policy, DEC-015).
export LOGIN_MAX_FAILED_ATTEMPTS=5 LOGIN_FAILURE_WINDOW_MINUTES=15 LOGIN_LOCKOUT_MINUTES=15 LOGIN_ADDRESS_MAX_FAILURES=20 TRUST_PROXY=1
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export BOOTSTRAP_ADMIN_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
# F-13: run the API in a non-UTC zone (Egypt-first target) so date-handling defects surface in every run.
TZ="${API_TZ:-Africa/Cairo}" node dist/server.js > "${TMPDIR:-/tmp}/erp_e2e_server_$RUN.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "http://localhost:$PORT_/api/health" >/dev/null && break; sleep 0.5; done

cd "$ROOT/tests/e2e"; mkdir -p out
export API_BASE="http://localhost:$PORT_/api"
node probe.mjs | head -2
# Stage 17: wave1_boq_handover configures contract signing (DOA) and its signers; the chain now signs its contract with them.
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_boq_handover.mjs
PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node chain.mjs
APP_PSQL_URL="$APP_URL_BASE/$DB$Q" node isolation.mjs "out/chain_$RUN.json"
APP_PSQL_URL="$APP_URL_BASE/$DB$Q" OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_vendor_master.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_doa_governance.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave1_tenant_onboarding.mjs
RUN_ID="$RUN" node wave1_subcontract_ipc.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave2_notice_engine.mjs
RUN_ID="$RUN" node hostile_concurrency.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave2_daily_record_changes.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node wave2_programme.mjs
RUN_ID="$RUN" node sweep_variations.mjs
RUN_ID="$RUN" node sweep_quality_hse.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_approval_rejection.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_hr_payroll.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_edms.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_claims.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_technical_office.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_assets.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_inventory.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_ndc002.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_cost_eac.mjs
APP_PSQL_URL="$APP_URL_BASE/$DB$Q" OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_view_isolation.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_sessions.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_time_for_completion.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_inventory_controls.mjs
APP_PSQL_URL="$APP_URL_BASE/$DB$Q" OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_login_throttling.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_risks.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_report_packs.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_commissioning.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_design_impact.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_mobilisation.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_subcontract_deductions.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_client_ipc_deductions.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_ipc_client_certification.mjs
OWNER_PSQL_URL="$OWNER_URL_BASE/$DB$Q" RUN_ID="$RUN" node sweep_ipc_terms_breakdown.mjs
PROBE_OUT="out/G015_RUNTIME_PROBE_$RUN.csv" python3 "$ROOT/governance/tools/probe_shared_guards.py" "$OWNER_URL_BASE/$DB$Q"
# F-25: Golden Case step statuses must agree with the suites this gate runs.
(cd "$ROOT" && python3 governance/tools/gc_status_check.py)

# F-29: browser checks of the Project Controls screen, driven against this gate's data and API.
if [ "${UI_CHECK:-0}" = "1" ]; then
  UI_DIST="${TMPDIR:-/tmp}/erp_ui_dist_$RUN"
  (cd "$ROOT/frontend" && VITE_API_BASE_URL="$API_BASE" npx vite build --outDir "$UI_DIST" --emptyOutDir >/dev/null)
  (cd "$ROOT/frontend" && npx vite preview --outDir "$UI_DIST" --port "$UI_PORT_" --strictPort > "${TMPDIR:-/tmp}/erp_ui_preview_$RUN.log" 2>&1) &
  UI_PID=$!
  trap 'kill $SERVER_PID $UI_PID 2>/dev/null || true; pkill -f "vite preview --outDir $UI_DIST" 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do curl -sf "http://localhost:$UI_PORT_/login" >/dev/null && break; sleep 0.5; done
  mkdir -p out/ui
  UI_BASE="http://localhost:$UI_PORT_" UI_API="$API_BASE" RUN_ID="$RUN" OUT_DIR="$ROOT/tests/e2e/out/ui" node "$ROOT/tests/ui/project_controls.ui.mjs" | tee "out/ui/project_controls_ui_$RUN.txt"
  UI_BASE="http://localhost:$UI_PORT_" RUN_ID="$RUN" OUT_DIR="$ROOT/tests/e2e/out/ui" node "$ROOT/tests/ui/payments.ui.mjs" | tee "out/ui/payments_ui_$RUN.txt"
fi
