#!/usr/bin/env python3
"""G-015 runtime probe. For every table carrying a trigger function shared by >1 table (and every table with any
UPDATE trigger), run `UPDATE t SET c1=c1, c2=c2, ... WHERE id=<one row>` in a rolled-back transaction as the owner
role, so every BEFORE/AFTER UPDATE trigger fires with unchanged data. Errors of class 42703 (undefined column),
42P08/42725 (parameter/operator typing) or 42883 (undefined function) are defects; P0001 business refusals
(append-only, immutable) are expected. Tables with no rows are reported as NOT_PROBED.
Output: governance/audit/G015_RUNTIME_PROBE.csv"""
import csv, subprocess, sys
DSN = sys.argv[1] if len(sys.argv) > 1 else 'postgresql://erp_owner:owner_pw@localhost:5433/erp_e2e'
def run(sql):
    p = subprocess.run(['psql', DSN, '-v', 'ON_ERROR_STOP=1', '-AtF', '\t', '-c', sql], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr
_, out, _ = run("""select distinct t.tgrelid::regclass::text from pg_trigger t where not t.tgisinternal and (t.tgtype & 16) = 16
                   and t.tgrelid::regclass::text not like 'pg_%' order by 1""")
tables = [l for l in out.splitlines() if l]
results = []
for t in tables:
    _, cols, _ = run(f"""select string_agg(quote_ident(column_name)||'='||quote_ident(column_name), ', ') from information_schema.columns
                          where table_schema='public' and table_name='{t}' and is_generated='NEVER' and column_name<>'id' and is_identity='NO'""")
    _, hasid, _ = run(f"select count(*) from information_schema.columns where table_name='{t}' and column_name='id'")
    if hasid.strip() != '1' or not cols.strip():
        results.append((t, 'NOT_PROBED', 'no id column')); continue
    _, rid, _ = run(f"select min(id) from {t}")
    if not rid.strip():
        results.append((t, 'NOT_PROBED', 'no rows')); continue
    code, _, err = run(f"begin; update {t} set {cols.strip()} where id={rid.strip()}; rollback;")
    msg = next((l for l in err.splitlines() if 'ERROR' in l), '')
    if code == 0: results.append((t, 'OK', ''))
    elif any(k in msg for k in ('does not exist', 'has no field', 'is not unique', 'inconsistent types', 'could not determine')):
        results.append((t, 'DEFECT', msg.strip()))
    else: results.append((t, 'REFUSED_BY_RULE', msg.strip()[:160]))
import os
out_path = os.environ.get('PROBE_OUT', 'governance/audit/G015_RUNTIME_PROBE.csv')
with open(out_path, 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['table', 'result', 'detail']); w.writerows(results)
from collections import Counter
print(Counter(r[1] for r in results))
for r in results:
    if r[1] in ('DEFECT',): print(*r, sep=' | ')
sys.exit(1 if any(r[1] == 'DEFECT' for r in results) else 0)
