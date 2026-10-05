// R0-5 negative tests: tenant B (org 2) attempts to read and write tenant A (org 1) records
// created by chain.mjs. Usage: node isolation.mjs out/chain_<run>.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { api, must, log } from './lib.mjs';

const chain = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const A = chain.ids;
const TAG = chain.tag ?? chain.run;
const results = [];
const rec = (name, pass, detail = '') => { results.push({ name, outcome: pass ? 'PASS' : 'FAIL', detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const tb = must(await api('POST', '/auth/login', null, { email: 'admin.b@test.local', password: 'Passw0rd!B', org_id: 2 }), 'login B').token;
const ta = must(await api('POST', '/auth/login', null, { email: 'admin.a@test.local', password: 'Passw0rd!A', org_id: 1 }), 'login A').token;

// Login must not cross tenants: A's credentials against org 2.
const cross = await api('POST', '/auth/login', null, { email: 'admin.a@test.local', password: 'Passw0rd!A', org_id: 2 });
rec('login with org A credentials into org B rejected', !cross.ok, `HTTP ${cross.status}`);

// Reads by id: must be 404 (not visible), never 200 with A's data.
const reads = [
  ['lead', `/crm/leads/${A.lead}`], ['tender', `/tendering/tenders/${A.tender}`], ['contract', `/contracts/${A.contract}`],
  ['PO details', `/procurement/purchase-orders/${A.po}/details`], ['client', `/clients/${A.client}`],
  ['BOQ rate build-up', `/boq/master/${A.boq}/rate-buildup`]
];
for (const [label, path] of reads) {
  const r = await api('GET', path, tb);
  const leaked = r.ok && (Array.isArray(r.data) ? r.data.length > 0 : r.data != null);
  rec(`B cannot read A ${label} by id`, !leaked, `HTTP ${r.status}${leaked ? ' LEAK ' + JSON.stringify(r.data).slice(0, 120) : ''}`);
}
// Lists: must contain none of A's rows.
for (const [label, path, key] of [['projects', '/projects', 'project_code'], ['leads', '/crm/leads', 'lead_name'], ['POs', '/procurement/purchase-orders', 'po_ref'], ['approvals', '/approvals', 'module'], ['GL', '/finance/gl', 'account_code'], ['AP', '/finance/ap', 'id'], ['DOA', '/approvals/configuration/doa', 'module'], ['cost transactions', '/cost-transactions', 'id'], ['roles', '/roles', 'role_name'], ['users', '/users', 'email']]) {
  const r = await api('GET', path, tb);
  const rows = Array.isArray(r.data) ? r.data : [];
  const foreign = rows.filter(x => x.org_id != null ? Number(x.org_id) !== 2 : String(x[key] ?? '').includes(TAG));
  rec(`B list ${label} has no A rows`, r.status < 500 && foreign.length === 0, `HTTP ${r.status} rows=${rows.length} foreign=${foreign.length}`);
}

// Writes referencing A's ids from B's session must fail and must not create rows.
const writes = [
  ['create MR on A project', 'POST', '/procurement/material-requisitions', { project_id: A.project, mr_no: `XMR-${TAG}`, lines: [{ item_description: 'x tenant', unit_of_measure: 'm2', quantity: 1 }] }],
  ['add quotation to A RFQ', 'POST', `/procurement/rfqs/${A.rfq}/vendor-quotations`, { vendor_id: A.vendor, total_amount: 1, currency_id: 1 }],
  ['add rate build-up to A BOQ', 'POST', `/boq/master/${A.boq}/rate-buildup`, { resource_type: 'material', quantity_per_unit: 1, unit_cost: 1 }],
  ['create PO with A vendor/project', 'POST', '/procurement/purchase-orders', { project_id: A.project, vendor_id: A.vendor, cost_code_id: 2, po_ref: `XPO-${TAG}`, currency_id: 1, lines: [{ item_description: 'x tenant', unit_of_measure: 'm2', quantity: 1, unit_rate: 1 }] }],
  ['issue A PO', 'POST', `/procurement/purchase-orders/${A.po}/issue`, undefined],
  ['post A cost transaction to GL', 'POST', `/finance/cost-transactions/${A.ctCommitted}/post-gl`, undefined],
  ['client-approve A IPC', 'POST', `/finance/ipcs/${A.ipc}/client-approve`, undefined],
  ['create contract on A project', 'POST', '/contracts', { project_id: A.project, client_id: A.client, contract_type: 'lump_sum', contract_value: 1, currency_id: 1 }],
  ['edit A DOA row', 'PATCH', '/approvals/configuration/doa/1', { min_amount: 0, approval_level: 1, approver_role_id: 1, is_active: true, confirm: true }],
  ['change A role permissions', 'PUT', '/roles/8/permissions', { permissions: [] }],
  ['create BOQ on A project', 'POST', '/boq/master', { project_id: A.project, item_no: 'X1', description: 'x', unit_of_measure: 'm2', quantity: 1 }]
];
for (const [label, m, path, body] of writes) {
  const r = await api(m, path, tb, body);
  // Must be refused with a client error (4xx). A 500 means an unmapped server fault (F-07/CC-013).
  rec(`B cannot ${label}`, !r.ok && r.status < 500, `HTTP ${r.status} ${JSON.stringify(r.body?.error ?? '').slice(0, 120)}`);
}

// Approval actions on A's approval instance from B.
const apprs = must(await api('GET', '/approvals', ta), 'A approvals');
const anyA = apprs[0];
const ra = await api('POST', `/approvals/${anyA.id}/actions`, tb, { action: 'rejected', comment: 'x-tenant' });
rec('B cannot act on A approval instance', !ra.ok, `HTTP ${ra.status} ${JSON.stringify(ra.body?.error ?? '')}`);

// Authorization inside one tenant: a role holding only projects.view must not create projects (F-06/CC-013).
{
  const role = must(await api('POST', '/roles', ta, { role_name: `ViewOnly ${TAG}`, permissions: [{ module: 'projects', action: 'view', scope: 'all' }] }), 'view-only role');
  const email = `viewonly.${TAG}@test.local`;
  must(await api('POST', '/users', ta, { role_id: role.id, full_name: 'View Only', email, password: 'Passw0rd!V' }), 'view-only user');
  const tv = must(await api('POST', '/auth/login', null, { email, password: 'Passw0rd!V', org_id: 1 }), 'login view-only').token;
  const list = await api('GET', '/projects', tv);
  rec('view-only user can list projects', list.ok, `HTTP ${list.status}`);
  const create = await api('POST', '/projects', tv, { project_code: `VO-${TAG}`, project_name: 'should fail', currency_id: 1 });
  rec('view-only user cannot create project', create.status === 403, `HTTP ${create.status}`);
  const appr = await api('POST', '/approvals/1/actions', tv, { action: 'approved' });
  rec('view-only user cannot act on approvals', appr.status === 403, `HTTP ${appr.status}`);
}

// Error hygiene: invalid input must be a 4xx without SQL/schema text.
{
  const bad = await api('GET', '/crm/leads/abc', ta);
  const leak = /column|relation|syntax|bigint|select |insert /i.test(JSON.stringify(bad.body ?? ''));
  rec('invalid id returns 4xx without SQL details', bad.status >= 400 && bad.status < 500 && !leak, `HTTP ${bad.status} ${JSON.stringify(bad.body?.error ?? '')}`);
}

// DB-level probe: organizations table (no RLS) as the application role under org 2 context.
if (process.env.APP_PSQL_URL) {
  const out = execFileSync('psql', [process.env.APP_PSQL_URL, '-At', '-c', "select set_config('app.org_id','2',false); select count(*) from organizations where id<>2; select count(*) from projects where org_id<>2; select count(*) from boq_rate_buildup;"]).toString().trim().split('\n');
  rec('DB: app role under org 2 sees other organizations rows = 0', Number(out[1]) === 0, `other orgs visible=${out[1]}`);
  rec('DB: app role under org 2 sees other-tenant projects = 0', Number(out[2]) === 0, `foreign projects=${out[2]}`);
  rec('DB: app role under org 2 sees boq_rate_buildup rows = 0 (A has rows)', Number(out[3]) === 0, `rate-buildup rows visible=${out[3]}`);
}

writeFileSync(new URL(`./out/isolation_${chain.run}.json`, import.meta.url), JSON.stringify({ run: chain.run, results, http: log }, null, 2));
const f = results.filter(r => r.outcome === 'FAIL').length;
console.log(`\nSUMMARY isolation PASS=${results.length - f} FAIL=${f}`);
process.exitCode = f ? 1 : 0;
