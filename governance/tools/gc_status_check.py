#!/usr/bin/env python3
"""F-25 guard: Golden Case step statuses must agree with the runtime gate.

Checks (exit 1 on any violation):
  1. GOLDEN_CASE_DECOMPOSITION.csv is what gc_decomposition.py generates now (no hand-edited or stale CSV).
  2. Every RUNTIME step names at least one suite that run_from_zero.sh executes (or the gate itself).
  3. Every suite a step names exists in the gate (no evidence pointing at removed or renamed suites).
  4. No ABSENT / SCHEMA / API step names a gate suite (a step exercised at runtime is at least PARTIAL).
Run from the repository root: python3 governance/tools/gc_status_check.py
"""
import csv, io, os, re, runpy, sys
from collections import Counter

ROOT = os.getcwd()
GATE = open(os.path.join(ROOT, 'tests/e2e/run_from_zero.sh')).read()
SUITES = set(re.findall(r'node (\w+)\.mjs', GATE)) - {'probe'}
SUITE_TOKEN = re.compile(r'\b(chain|isolation|hostile_concurrency|wave\d_\w+|sweep_\w+)\b')
GATE_TOKENS = ('runtime-gate', 'run_from_zero')
CSV_PATH = 'governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv'

errors = []
committed = open(CSV_PATH, newline='').read()
mod = runpy.run_path('governance/tools/gc_decomposition.py', run_name='gc_decomposition')
buf = io.StringIO()
w = csv.DictWriter(buf, fieldnames=mod['COLS'])
w.writeheader()
for code in sorted(mod['GC']):
    title, steps = mod['GC'][code]
    for i, s in enumerate(steps, 1):
        w.writerow(dict(zip(mod['COLS'], [code, title, i, *s, f'T-{code}-{i:02d}'])))
if buf.getvalue().replace('\r\n', '\n') != committed.replace('\r\n', '\n'):
    errors.append(f'{CSV_PATH} is stale: run python3 governance/tools/gc_decomposition.py')

rows = list(csv.DictReader(io.StringIO(buf.getvalue())))
for r in rows:
    ref = f"{r['gc']} step {r['step']} ({r['activity'][:50]})"
    ev = r['code_evidence']
    named = set(SUITE_TOKEN.findall(ev))
    for n in sorted(named - SUITES):
        errors.append(f'{ref}: names suite {n} which the gate does not run')
    live = named & SUITES
    if r['code_status'] == 'RUNTIME' and not live and not any(t in ev for t in GATE_TOKENS):
        errors.append(f'{ref}: RUNTIME without a gate suite in its evidence')
    if r['code_status'] in ('ABSENT', 'SCHEMA', 'API') and live:
        errors.append(f"{ref}: {r['code_status']} but evidence names gate suite(s) {sorted(live)}")

print('GC_STATUS', dict(Counter(r['code_status'] for r in rows)), 'violations', len(errors))
for e in errors:
    print('  -', e)
sys.exit(1 if errors else 0)
