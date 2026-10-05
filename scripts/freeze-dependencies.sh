#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for dir in backend frontend; do
  if [[ ! -f "$dir/package-lock.json" ]]; then
    echo "Generating $dir/package-lock.json from exact direct dependency versions..."
    npm --prefix "$dir" install --package-lock-only --ignore-scripts --no-audit --no-fund
  fi
done

echo "Dependency lockfiles are present."
