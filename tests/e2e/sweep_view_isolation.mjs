// G-016: database views must not leak another tenant's rows to the application role. For every public view, count
// rows visible to the app role under tenant B's org setting that belong to tenant A (via org_id, project_id,
// vendor_id or client_id). Also re-runs the G-015 shared-guard runtime probe expectation (no undefined-column defects).
import { check, sql, finish } from './harness.mjs';

const APP = process.env.APP_PSQL_URL, OWNER = process.env.OWNER_PSQL_URL;
const last = (r) => r.out.trim().split('\n').filter(Boolean).pop();
try {
  if (!APP || !OWNER) throw new Error('APP_PSQL_URL and OWNER_PSQL_URL required');
  const views = last(sql(OWNER, `select string_agg(c.relname, ',' order by c.relname) from pg_class c where c.relkind='v' and c.relnamespace='public'::regnamespace`)).split(',');
  // Keys visible to tenant B are collected under the app role; their owning org is resolved under the owner role
  // (resolving under the app role would hide tenant A's parents behind RLS and mask a leak).
  const ownerOf = { org_id: (ids) => `select count(*) from organizations where id in (${ids}) and id <> 2`,
    project_id: (ids) => `select count(*) from projects where id in (${ids}) and org_id <> 2`,
    vendor_id: (ids) => `select count(*) from vendors_subcontractors where id in (${ids}) and org_id <> 2`,
    client_id: (ids) => `select count(*) from clients where id in (${ids}) and org_id <> 2` };
  for (const v of views) {
    const cols = (last(sql(OWNER, `select coalesce(string_agg(column_name, ','),'') from information_schema.columns where table_name='${v}' and column_name in ('org_id','project_id','vendor_id','client_id')`)) ?? '').split(',').filter(Boolean);
    if (!cols.length) { check(`${v}: has a tenant key to verify`, false, 'no org/project/vendor/client column'); continue; }
    const key = cols[0];
    const seen = sql(APP, `select set_config('app.org_id','2',false); select coalesce(string_agg(distinct ${key}::text, ','),'') from ${v} where ${key} is not null`);
    if (!seen.ok) { check(`${v}: readable by the app role`, false, seen.out.split('\n').find(l => /ERROR/.test(l))); continue; }
    const ids = (last(seen) ?? '').replace(/^\d+\n?/, '').trim();
    const visibleIds = ids.split(',').filter(x => /^\d+$/.test(x));
    const leaked = visibleIds.length ? Number(last(sql(OWNER, ownerOf[key](visibleIds.join(','))))) : 0;
    check(`${v}: tenant B sees no tenant A rows (by ${key})`, leaked === 0, `visible ${key}s=${visibleIds.length} foreign=${leaked}`);
  }
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_view_isolation');
