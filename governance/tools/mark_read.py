#!/usr/bin/env python3
"""Mark source-register rows by regex on archive/path.
Usage: mark_read.py STATUS NOTE REGEX [REGEX...]
STATUS: READ_FULL | PARSED_FULL | SAMPLED | READ_RUNTIME | UNREAD
Byte-identical duplicates (duplicate_of) inherit the status of their original."""
import csv, re, sys
p = 'governance/SOURCE_REGISTER.csv'
status, note, pats = sys.argv[1], sys.argv[2], [re.compile(x) for x in sys.argv[3:]]
rows = list(csv.DictReader(open(p)))
hit = 0
for r in rows:
    key = r['archive'] + '/' + r['path']
    if any(x.search(key) for x in pats) and not r['duplicate_of']:
        r['read_status'], r['notes'] = status, note; hit += 1
orig = {r['archive'] + '/' + r['path']: r for r in rows}
for r in rows:
    if r['duplicate_of'] in orig:
        o = orig[r['duplicate_of']]; r['read_status'] = o['read_status']; r['notes'] = o['notes'] and 'dup: ' + o['notes']
w = csv.DictWriter(open(p, 'w', newline=''), fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(f'{hit} originals marked {status}')
