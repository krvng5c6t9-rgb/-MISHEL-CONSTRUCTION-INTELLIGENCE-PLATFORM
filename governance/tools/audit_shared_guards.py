#!/usr/bin/env python3
"""G-015 audit: trigger functions attached to more than one table that reference NEW./OLD. columns which do not
exist on every attached table. Such a reference raises 42703 at run time unless the code path is reachable only for
tables that have the column. Output: governance/audit/G015_SHARED_GUARDS.csv (function, table, missing columns)."""
import csv, re, subprocess, sys
DSN = sys.argv[1] if len(sys.argv) > 1 else 'postgresql://postgres:pg_pw@localhost:5433/erp_e2e'
def q(sql):
    out = subprocess.run(['psql', DSN, '-AtF', '\t', '-c', sql], capture_output=True, text=True, check=True).stdout
    return [l.split('\t') for l in out.splitlines() if l]
rows = q("""select p.proname, string_agg(distinct t.tgrelid::regclass::text, ',') from pg_trigger t join pg_proc p on p.oid=t.tgfoid
            where not t.tgisinternal and t.tgrelid::regclass::text not like 'pg_%' group by p.proname having count(distinct t.tgrelid) > 1""")
cols = {}
for tbl, col in q("select table_name, column_name from information_schema.columns where table_schema='public'"):
    cols.setdefault(tbl, set()).add(col)
findings = []
for fn, tables in rows:
    src = q(f"select replace(replace(prosrc, chr(10), ' '), chr(9), ' ') from pg_proc where proname='{fn}' limit 1")[0][0]
    refs = set(re.findall(r'\b(?:NEW|OLD)\.([a-z_][a-z0-9_]*)', src, re.I))
    refs = {r.lower() for r in refs}
    for t in tables.split(','):
        missing = sorted(r for r in refs if r not in cols.get(t, set()))
        if missing: findings.append((fn, t, ' '.join(missing)))
with open('governance/audit/G015_SHARED_GUARDS.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['function', 'table', 'referenced_columns_missing_on_table']); w.writerows(findings)
print(len(rows), 'shared functions;', len(findings), 'function/table pairs reference missing columns')
for x in findings: print(*x, sep=' | ')
