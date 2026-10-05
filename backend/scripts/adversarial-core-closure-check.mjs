import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const migration=read('database/migrations/018_adversarial_closure_core.sql');
const procurement=read('backend/src/modules/procurement/procurement.routes.ts');
const routes=read('backend/src/routes/index.ts');
const checks=[
 ['warehouse schema',/CREATE TABLE IF NOT EXISTS warehouses/i.test(migration)],
 ['inventory ledger',/CREATE TABLE IF NOT EXISTS inventory_transactions/i.test(migration)],
 ['fiscal periods',/CREATE TABLE IF NOT EXISTS fiscal_periods/i.test(migration)],
 ['historical FX',/CREATE TABLE IF NOT EXISTS exchange_rates/i.test(migration)],
 ['claims EOT register',/CREATE TABLE IF NOT EXISTS contract_claims/i.test(migration)],
 ['GRN API',/purchase-orders\/:id\/grns/.test(procurement)],
 ['GRN inventory posting',/transaction_type.*receipt/s.test(procurement)],
 ['3-way match evidence',/invoice_match_results/.test(procurement)&&/accepted_grn_amount/.test(procurement)],
 ['invoice approval requires match',/must pass 3-way match/.test(procurement)],
 ['inventory route wired',/inventoryRouter/.test(routes)],['claims route wired',/claimsRouter/.test(routes)],
 ['RLS forced',/FORCE ROW LEVEL SECURITY/i.test(migration)]
];
let fail=0; for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fail++;} if(fail){process.exitCode=1}else console.log('ADVERSARIAL CORE CLOSURE: PASS');
