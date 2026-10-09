// Stage 26 / DEC-016, DEC-017: tax codes with legal reference and second-person confirmation, versions by effective
// date, contract tax profiles, output tax computed at client certification (net or gross base) and carried into the
// receivable and GL, e-invoice reference, tax withheld by the client on receipts (certificate required) settling the
// receivable and posted as a tax credit, tax position. ALL RATES HERE ARE TEST FIXTURES - the system holds none.
// Runs after chain.mjs, sweep_client_ipc_deductions and sweep_collections (reuses their users and GL fixtures).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), pm = await existing('pm'), s1 = await existing('w1s1'), s2 = await existing('w1s2'), fin = await existing('fin');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });
  const account = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const outAcct = await account('2300', 'Output tax payable (fixture)', 'liability');
  const whtAcct = await account('1300', 'Tax withheld by clients (fixture)', 'asset');
  const legal = { legal_reference: 'TEST FIXTURE - not a legal rate', source_reference: 'Gate fixture (no real rate)' };
  const taxCode = (body) => api('POST', '/finance/tax-codes', fm1, { gl_account_id: outAcct, ...legal, ...body });
  const confirm = (id, tok = fm2) => api('POST', `/finance/tax-codes/${id}/confirm`, tok);

  // --- Tax codes.
  await expectStatus('an output tax code needs a rate', () => taxCode({ code: `OUTX-${TAG}`, name: 'Output without rate', kind: 'output_tax', base: 'certified_net', effective_from: day(-60) }), 422);
  await expectStatus('a withholding code is taken from the certificate, not computed on the certified amount', () => taxCode({ code: `WHTX-${TAG}`, name: 'Bad withholding base', kind: 'withheld_by_client', base: 'certified_net', effective_from: day(-60), gl_account_id: whtAcct }), 422);
  const out1 = must(await taxCode({ code: `OUT-${TAG}`, name: 'Output tax (fixture) v1', kind: 'output_tax', rate: 10, base: 'certified_net', effective_from: day(-60) }), 'out v1');
  await expectStatus('the author cannot confirm own tax code (SoD)', () => confirm(out1.id, fm1), 403);
  must(await confirm(out1.id), 'confirm v1');
  const out2 = must(await taxCode({ code: `OUT-${TAG}`, name: 'Output tax (fixture) v2', kind: 'output_tax', rate: 12, base: 'certified_net', effective_from: day(-10) }), 'out v2');
  await expectStatus('a version overlapping the open confirmed version is refused', () => confirm(out2.id), 422);
  must(await api('POST', `/finance/tax-codes/${out1.id}/close`, fm2, { effective_to: day(-11) }), 'close v1');
  await run('new version (12%, from day -10) confirmed after closing v1', async () => must(await confirm(out2.id), 'confirm v2'));
  const outg = must(await taxCode({ code: `OUTG-${TAG}`, name: 'Output tax on gross (fixture)', kind: 'output_tax', rate: 10, base: 'certified_gross', effective_from: day(-60) }), 'outg');
  must(await confirm(outg.id), 'confirm outg');
  const wht = must(await taxCode({ code: `WHT-${TAG}`, name: 'Withheld by client (fixture)', kind: 'withheld_by_client', base: 'as_per_certificate', effective_from: day(-60), gl_account_id: whtAcct }), 'wht');
  must(await confirm(wht.id), 'confirm wht');

  // --- Contracts and profiles.
  const client = must(await api('POST', '/clients', admin, { client_name: `TX Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `TX-${TAG}`, project_name: `TX ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const signed = async () => {
    const id = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 900000, currency_id: 1, retention_percent: 5 }), 'contract').id;
    const a = must(await api('POST', `/contracts/${id}/submit-approval`, admin), 'sign').approval;
    must(await approve(s1, a.id), 's1'); must(await approve(s2, a.id), 's2');
    return id;
  };
  const cNet = await signed(), cNone = await signed(), cGross = await signed();
  await expectStatus('a profile naming an unknown code is refused', () => api('POST', `/finance/contracts/${cNet}/tax-profile`, fm1, { output_tax_code: `NOPE-${TAG}` }), 422);
  const prof = must(await api('POST', `/finance/contracts/${cNet}/tax-profile`, fm1, { output_tax_code: `OUT-${TAG}`, client_withholding_code: `WHT-${TAG}` }), 'profile');
  await expectStatus('the author cannot confirm own tax profile (SoD)', () => api('POST', `/finance/tax-profiles/contract/${prof.id}/confirm`, fm1), 403);
  must(await api('POST', `/finance/tax-profiles/contract/${prof.id}/confirm`, fm2), 'confirm profile');
  const profG = must(await api('POST', `/finance/contracts/${cGross}/tax-profile`, fm1, { output_tax_code: `OUTG-${TAG}` }), 'profile g');
  must(await api('POST', `/finance/tax-profiles/contract/${profG.id}/confirm`, fm2), 'confirm profile g');

  let n = 0;
  const submitted = async (contract, gross) => {
    const i = must(await api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `TX${++n}-${TAG}`, period_from: day(-30), period_to: day(-1), gross_work_done_this_period: gross, cumulative_gross_work_done: gross, less_retention: gross * 0.05 }), 'ipc');
    must(await approve(pm, must(await api('POST', `/finance/ipcs/${i.id}/submit-to-client`, fm1), 'submit').approval.id), 'pm');
    return i;
  };
  const certify = (id, body) => api('POST', `/finance/ipcs/${id}/client-approve`, fm2, { client_reference: `TXC-${TAG}-${id}`, certified_on: day(0), ...body });

  // --- Output tax on the net certified (version effective today = 12%).
  const a = await submitted(cNet, 100000);
  await expectStatus('an e-invoice is not recorded before the client certification', () => api('POST', `/finance/ipcs/${a.id}/einvoice`, fm1, { uuid: `UUID-${TAG}-A-0001` }), 422);
  const ca = await certify(a.id, { certified_amount: 95000 });
  check('output tax computed at certification with the version effective that day: 12% of 95,000 = 11,400', ca.status === 200 && ca.body.data.tax_treatment === 'computed' && Number(ca.body.data.output_tax_amount) === 11400 && Number(ca.body.data.output_tax_code_id) === Number(out2.id), `HTTP ${ca.status} ${JSON.stringify(ca.body?.data ? { t: ca.body.data.tax_treatment, tax: ca.body.data.output_tax_amount } : ca.body?.error)}`);
  await run('e-invoice reference recorded after certification', async () => must(await api('POST', `/finance/ipcs/${a.id}/einvoice`, fm1, { uuid: `UUID-${TAG}-A-0001` }), 'einvoice'));
  await expectStatus('the e-invoice reference is recorded once', () => api('POST', `/finance/ipcs/${a.id}/einvoice`, fm1, { uuid: `UUID-${TAG}-A-0002` }), 409);
  const pa = await run('IPC posted to AR/GL', async () => must(await api('POST', `/finance/ipcs/${a.id}/post-ar-gl`, admin), 'post a'));
  check('receivable = certified 95,000 + output tax 11,400 = 106,400, with a separate output-tax GL batch', Number(pa.accounts_receivable.amount) === 106400 && pa.tax_treatment === 'computed' && !!pa.tax_gl, `${pa.accounts_receivable.amount} ${pa.tax_treatment}`);

  // --- No profile: no tax, said so.
  const b = await submitted(cNone, 20000);
  const cb = await certify(b.id, { certified_amount: 19000 });
  check('a contract without a confirmed tax profile computes no tax and says so', cb.status === 200 && cb.body.data.tax_treatment === 'no_tax_profile' && cb.body.data.output_tax_amount === null, JSON.stringify({ t: cb.body?.data?.tax_treatment, e: cb.body?.error }));
  const pb = must(await api('POST', `/finance/ipcs/${b.id}/post-ar-gl`, admin), 'post b');
  check('its receivable is the certified amount only', Number(pb.accounts_receivable.amount) === 19000);

  // --- Gross-base code needs the client breakdown.
  const g = await submitted(cGross, 50000);
  await expectStatus('a gross-base tax code refuses a certification without the client breakdown', () => certify(g.id, { certified_amount: 47500 }), 422);
  const cg = await certify(g.id, { certified_amount: 47500, certified_gross: 50000, certified_retention: 2500, certified_advance_recovery: 0, certified_previous: 0 });
  check('gross-base output tax: 10% of the certified gross 50,000 = 5,000', cg.status === 200 && Number(cg.body.data.output_tax_amount) === 5000 && Number(cg.body.data.output_tax_base) === 50000, JSON.stringify({ s: cg.status, tax: cg.body?.data?.output_tax_amount, e: cg.body?.error }));

  // --- Tax withheld by the client on a receipt.
  const bank = must(await api('GET', '/finance/bank-accounts', admin), 'banks').find(x => x.account_no === `ACC-${TAG}`).id;
  const ar = must(await api('GET', '/finance/ar', admin), 'ar').find(x => x.ipc_no === `TX1-${TAG}`);
  const arNone = must(await api('GET', '/finance/ar', admin), 'ar').find(x => x.ipc_no === `TX2-${TAG}`);
  const receipt = (target, cash, withheld, ref) => api('POST', '/finance/payments', fm1, { payment_type: 'incoming', party_type: 'client', party_id: Number(target.client_id), related_ar_id: target.id, amount: cash, currency_id: Number(target.currency_id), bank_account_id: bank, method: 'transfer', reference_no: `TXR-${TAG}-${cash}`, payment_date: day(0), withheld_tax_amount: withheld, ...(ref ? { withholding_certificate_ref: ref } : {}) });
  await expectStatus('tax withheld without the client certificate reference is refused', () => receipt(ar, 50000, 1900), 422);
  await expectStatus('tax withheld on a contract without a withholding code is refused', () => receipt(arNone, 10000, 200, `WC-${TAG}-X`), 422);
  const r = await run('receipt: 50,000 cash + 1,900 withheld per client certificate', async () => must(await receipt(ar, 50000, 1900, `WC-${TAG}-001`), 'receipt'));
  check('the withholding code is resolved from the contract profile', Number(r.withholding_tax_code_id) === Number(wht.id), String(r.withholding_tax_code_id));
  must(await approve(fin, must(await api('POST', `/finance/payments/${r.id}/submit-approval`, fm1), 'submit r').approval.id), 'approve r');
  const pr = await run('receipt posted with a separate tax-credit GL batch', async () => must(await api('POST', `/finance/payments/${r.id}/post-gl`, fm2), 'post r'));
  check('withholding posted to the tax-credit account', !!pr.withholding_gl, JSON.stringify(Object.keys(pr)));
  const aging = must(await api('GET', `/finance/receivables/aging?as_of=${day(0)}`, admin), 'aging').find(x => Number(x.receivable_id) === Number(ar.id));
  check('the receivable counts cash + withheld as received: 51,900 of 106,400, 54,500 outstanding', aging && Number(aging.received) === 51900 && Number(aging.outstanding) === 54500, JSON.stringify(aging));
  await expectStatus('cash + withheld above the outstanding 54,500 is refused', () => receipt(ar, 54000, 1000, `WC-${TAG}-002`), 422);

  const pos = must(await api('GET', `/finance/tax/position?from=${day(-1)}&to=${day(1)}`, fm1), 'position');
  const row = (kind, code) => pos.find(p => p.kind === kind && p.code === code);
  check('tax position: output 11,400 (OUT) and 5,000 (OUTG); withheld by client 1,900', Number(row('output_tax', `OUT-${TAG}`)?.tax) === 11400 && Number(row('output_tax', `OUTG-${TAG}`)?.tax) === 5000 && Number(row('withheld_by_client', `WHT-${TAG}`)?.tax) === 1900, JSON.stringify(pos.filter(p => String(p.code).endsWith(TAG))));

  if (OWNER) {
    const probe = (name, text) => { const res = sql(OWNER, text); check(name, !res.ok, res.out.split('\n').find(l => /ERROR/.test(l)) ?? res.out.slice(0, 120)); };
    const gl = sql(OWNER, `select coalesce(sum(credit),0) from general_ledger where account_id = ${outAcct} and source_table = 'ipcs' and source_record_id = ${a.id}`);
    check('GL: output tax account credited 11,400 for IPC TX1', gl.ok && /^11400\.00$/m.test(gl.out), gl.out);
    probe('DB: a confirmed tax code is immutable', `update tax_codes set rate = 1 where id = ${out2.id}`);
    probe('DB: a confirmed tax code is never deleted', `delete from tax_codes where id = ${out2.id}`);
    probe('DB: the computed output tax is immutable', `update ipcs set output_tax_amount = 0 where id = ${a.id}`);
    probe('DB: a confirmed tax profile is immutable', `update contract_tax_profiles set output_tax_code = null where id = ${prof.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A tax codes', !must(await api('GET', '/finance/tax-codes', tb), 'b codes').some(c => String(c.code).endsWith(TAG)));
  await expectStatus('tenant B cannot confirm a tenant A tax code', () => api('POST', `/finance/tax-codes/${wht.id}/confirm`, tb), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_tax');
