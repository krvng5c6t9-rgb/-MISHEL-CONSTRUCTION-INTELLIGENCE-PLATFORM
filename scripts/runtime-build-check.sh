#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/8] Node/npm versions"
node -v
npm -v

echo "[2/8] Static checks"
node scripts/static-import-check.mjs
node scripts/permission-consistency-check.mjs
node scripts/schema-code-column-check.mjs

echo "[3/8] Security/integrity gates"
npm --prefix backend run security:tenant
npm --prefix backend run security:phase2
npm --prefix backend run security:phase3
npm --prefix backend run security:phase4
npm --prefix backend run security:phase5
npm --prefix backend run security:phase6
npm --prefix backend run security:phase7
npm run check:redteam-rev16

echo "[4/8] Reproducible dependency metadata"
if [[ ! -f backend/package-lock.json || ! -f frontend/package-lock.json ]]; then
  echo "BLOCKED: backend/frontend package-lock.json files are absent; reproducible npm ci build cannot be proven." >&2
  exit 20
fi

echo "[5/8] Backend clean install/build"
npm --prefix backend ci --no-audit --no-fund
npm --prefix backend run build

echo "[6/8] Frontend clean install/build"
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build

echo "[7/8] PostgreSQL client availability"
command -v psql >/dev/null || { echo "BLOCKED: psql is not installed." >&2; exit 21; }

echo "[8/8] Build prerequisites passed"
echo "PASS: source/build prerequisites. Database migrations and E2E still require the configured PostgreSQL acceptance run."
