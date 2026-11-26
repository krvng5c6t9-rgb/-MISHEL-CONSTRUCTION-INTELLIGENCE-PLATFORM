"""Build the MARC supplier directory load file from collected source records (CC-107).
Usage: python3 load_directory.py OUT_SQL EG_DIR KSA_DIR UAE_DIR [--limit N]
Reads each source's records.jsonl and its category state, merges every category a company was listed under, maps
categories to MARC trades (trade_map.py), keeps the source, source id, source URL, fetch time and licence status of each
record, drops records with no name or no mapped trade (counted), and writes an idempotent SQL file (insert ... on conflict
(source, source_id) do update) plus a JSON summary. The data files are not committed to the repository."""
import json, os, sys, hashlib, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trade_map import trades_for

def q(v):
    if v is None: return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"
def arr(xs): return "ARRAY[" + ",".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"

def load(out_sql, eg_dir, ksa_dir, uae_dir, limit=None):
    recs, stats = [], collections.Counter()
    # Egypt: categories from the class index.
    eg_idx = json.load(open(os.path.join(eg_dir, 'index.json')))['companies']
    for line in open(os.path.join(eg_dir, 'records.jsonl'), encoding='utf-8') if os.path.exists(os.path.join(eg_dir, 'records.jsonl')) else []:
        r = json.loads(line); r['categories'] = [c.strip() for c in eg_idx.get(r['source_id'], {}).get('classes', r.get('classes', []))]; recs.append(r)
    for d, key in [(ksa_dir, 'source_id'), (uae_dir, 'source_url')]:
        seen = json.load(open(os.path.join(d, 'state.json')))['seen']
        for line in open(os.path.join(d, 'records.jsonl'), encoding='utf-8'):
            r = json.loads(line); r['categories'] = seen.get(r[key], [r.get('category_listing')]); recs.append(r)
    by = {}
    for r in recs:
        k = (r['source'], str(r['source_id']))
        if k in by:
            stats['duplicate_lines'] += 1
            by[k]['categories'] = sorted(set(by[k]['categories']) | set(r['categories'])); continue
        by[k] = r
    rows = []
    for (src, sid), r in by.items():
        name = (r.get('name') or '').strip()
        trades = sorted({t for c in r['categories'] if c for t in trades_for(c)})
        if len(name) < 2: stats['dropped_no_name'] += 1; continue
        if not trades: stats['dropped_no_trade'] += 1; continue
        phones = [p.strip() for p in r.get('phones') or [] if p and p.strip()]
        rows.append((r, name, trades, phones)); stats['rows_' + r['country']] += 1
        if phones: stats['with_phone_' + r['country']] += 1
    if limit: rows = rows[:limit]
    with open(out_sql, 'w', encoding='utf-8') as f:
        f.write('BEGIN;\n')
        for r, name, trades, phones in rows:
            f.write("INSERT INTO directory_suppliers (country, name, city, address, phones, email, website, description, source, source_id, source_url, fetched_at, licence_status) VALUES ("
                    + ", ".join([q(r['country']), q(name[:300]), q((r.get('city') or None) and r['city'][:120]), q(r.get('address') or None), arr(phones), q((r.get('email') or None) and r['email'][:200]),
                                 q((r.get('website') or None) and r['website'][:400]), q(r.get('description') or None), q(r['source']), q(str(r['source_id'])[:120]), q(r['source_url'][:600]),
                                 q(r['fetched_at']), q(r['licence_status'][:200])])
                    + ") ON CONFLICT (source, source_id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address, phones = EXCLUDED.phones, email = EXCLUDED.email, website = EXCLUDED.website, description = EXCLUDED.description, source_url = EXCLUDED.source_url, fetched_at = EXCLUDED.fetched_at, licence_status = EXCLUDED.licence_status;\n")
            f.write("INSERT INTO directory_supplier_trades (supplier_id, trade_code) SELECT id, t FROM directory_suppliers, unnest(" + arr(trades) + ") t WHERE source = " + q(r['source']) + " AND source_id = " + q(str(r['source_id'])[:120]) + " ON CONFLICT DO NOTHING;\n")
        f.write('COMMIT;\n')
    sha = hashlib.sha256(open(out_sql, 'rb').read()).hexdigest()
    summary = {'rows': len(rows), 'sha256': sha, **stats}
    json.dump(summary, open(out_sql + '.summary.json', 'w'), indent=1)
    return summary

if __name__ == '__main__':
    lim = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    print(json.dumps(load(*sys.argv[1:5], limit=lim)))
