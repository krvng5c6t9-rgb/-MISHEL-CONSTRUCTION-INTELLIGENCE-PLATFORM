// Stage 29 / DEC-012 remainder + DEC-016/017 supplier side: subcontract advance paid through payments (F-33, part
// payments), input tax on subcontract certificates from the confirmed subcontract tax profile, tax withheld from the
// subcontractor on payment with our notice reference, and every payment clearing the account its payable was credited
// to (F-44). Rates, amounts and accounts are TEST FIXTURES - no legal rate is implied.
// Runs after sweep_subcontract_gl (reuses its GL rules and users).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const maker = await existing('sdmaker'), site = await existing('sdsite'), qs = await existing('sdqs');
  const appr = await existing('scappr'), vend = await existing('scvend'), fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), fin = await existing('fin');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });
  const coa = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const accounts = must(await api('GET', '/finance/chart-of-accounts', admin), 'coa list');
  const acct = (code) => Number(accounts.find(a => a.account_code === `${code}-${TAG}`)?.id);
  const acc = { cost: acct('5300'), ap: acct('2110'), ret: acct('2120'), adv: acct('1150'), generic: acct('2100'),
    inTax: await coa('1310', 'Input tax recoverable (fixture)', 'asset'), whs: await coa('2310', 'Tax withheld from suppliers payable (fixture)', 'liability') };
  const bank = must(await api('GET', '/finance/bank-accounts', admin), 'banks').find(b => b.account_no === `ACC-${TAG}`).id;
  const legal = { legal_reference: 'TEST FIXTURE - not a legal rate', source_reference: 'Gate fixture (no real rate)' };

  const project = must(await api('POST', '/projects', admin, { project_code: `ST-${TAG}`, project_name: `ST ${TAG}`, currency_id: 1 }), 'project').id;
  const vendor = must(await api('POST', '/vendors', admin, { vendor_name: `ST Sub ${TAG}`, vendor_type: 'subcontractor' }), 'vendor').id;
  must(await api('POST', `/vendors/${vendor}/prequalification`, vend, { decision: 'approved', reason: 'fixture prequalification' }), 'preq');
  const sc = must(await api('POST', '/subcontracts', admin, { project_id: project, vendor_id: vendor, package_name: `ST pkg ${TAG}`, contract_value: 100000, currency_id: 1, cost_code_id: 2, retention_percent: 10, advance_payment_percent: 10 }), 'sc');
  must(await approve(appr, must(await api('POST', `/subcontracts/${sc.id}/submit-approval`, admin), 'sc submit').approval.id), 'sc approve');

  // --- Tax codes and the subcontract tax profile (draft first).
  const code = async (body) => { const c = must(await api('POST', '/finance/tax-codes', fm1, { ...legal, effective_from: day(-60), ...body }), 'code'); must(await api('POST', `/finance/tax-codes/${c.id}/confirm`, fm2), 'confirm code'); return c; };
  await code({ code: `IN-${TAG}`, name: 'Input tax (fixture)', kind: 'input_tax', rate: 10, base: 'certified_net', gl_account_id: acc.inTax });
  await code({ code: `WHS-${TAG}`, name: 'Withheld from subcontractor (fixture)', kind: 'withheld_from_supplier', base: 'as_per_certificate', gl_account_id: acc.whs });
  const prof = must(await api('POST', `/finance/subcontracts/${sc.id}/tax-profile`, fm1, { input_tax_code: `IN-${TAG}`, supplier_withholding_code: `WHS-${TAG}` }), 'profile');

  // --- Advance 9,000 paid in two parts.
  const pay = async (ap, amount, extra = {}) => {
    const p = must(await api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: ap, amount, currency_id: 1, bank_account_id: bank, method: 'transfer', reference_no: `STP-${TAG}-${Math.random().toString(36).slice(2, 7)}`, ...extra }), 'pay');
    must(await approve(fin, must(await api('POST', `/finance/payments/${p.id}/submit-approval`, fm1), 'submit pay').approval.id), 'approve pay');
    must(await api('POST', `/finance/payments/${p.id}/post-gl`, fm2), 'post pay');
    return p;
  };
  const adv = must(await api('POST', '/subcontracts/advances', maker, { subcontract_id: sc.id, amount: 9000, recovery_percent: 25, guarantee_ref: `APG-ST-${TAG}` }), 'adv');
  const advAp = must(await api('POST', `/subcontracts/advances/${adv.id}/approve`, qs), 'adv approve').accounts_payable;
  await expectStatus('withholding refused while the subcontract tax profile is not confirmed', () => api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: advAp.id, amount: 5000, withheld_tax_amount: 100, withholding_certificate_ref: `WN-${TAG}`, currency_id: 1, bank_account_id: bank, method: 'transfer' }), 422);
  await expectStatus('the profile author cannot confirm it (SoD)', () => api('POST', `/finance/tax-profiles/subcontract/${prof.id}/confirm`, fm1), 403);
  must(await api('POST', `/finance/tax-profiles/subcontract/${prof.id}/confirm`, fm2), 'confirm profile');
  const p1 = await pay(advAp.id, 6000);
  const advMid = must(await api('GET', `/subcontracts/advances?subcontract_id=${sc.id}`, qs), 'adv list')[0];
  check('advance part-paid (6,000 of 9,000) stays approved - recovery counts only paid advances', advMid.status === 'approved', advMid.status);
  await expectStatus('payment above the advance balance refused (5,000 > 3,000)', () => api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: advAp.id, amount: 5000, currency_id: 1, bank_account_id: bank, method: 'transfer' }), 422);
  const p2 = await pay(advAp.id, 3000);
  const advDone = must(await api('GET', `/subcontracts/advances?subcontract_id=${sc.id}`, qs), 'adv list')[0];
  check('advance paid when its payable is settled in full, evidenced by the last payment', advDone.status === 'paid' && Number(advDone.paid_payment_id) === Number(p2.id), JSON.stringify(advDone));
  if (OWNER) {
    const advDr = sql(OWNER, `select coalesce(sum(debit),0) from general_ledger where source_table='payments' and source_record_id in (${p1.id},${p2.id}) and account_id=${acc.adv}`).out.trim();
    check('GL: the advance payments debit advances to subcontractors 9,000 (asset), not a payable', advDr === '9000.00', advDr);
  }

  // --- Certificate: gross 20,000, retention 2,000, advance recovery 5,000 -> net 13,000; input tax 10% of net = 1,300.
  const c = must(await api('POST', '/subcontracts/certificates', maker, { subcontract_id: sc.id, project_id: project, certificate_no: `ST1-${TAG}`, period_from: day(-30), period_to: day(-1), gross_work_done: 20000, less_retention: 2000, less_advance_recovery: 5000 }), 'cert');
  must(await api('POST', `/subcontracts/certificates/${c.id}/lines`, maker, { description: 'Concrete m3', quantity_this_period: 100, cumulative_quantity: 100, unit_rate: 200 }), 'line');
  must(await api('POST', `/subcontracts/certificates/${c.id}/verify`, site), 'verify');
  must(await api('POST', `/subcontracts/certificates/${c.id}/qs-certify`, qs), 'qs');
  const fz = (await approve(appr, must(await api('POST', `/subcontracts/certificates/${c.id}/submit-approval`, qs), 'submit').approval.id)).body.data.finalization;
  check('input tax applied at approval from the confirmed profile: base net 13,000, tax 1,300', fz.record.tax_treatment === 'computed' && Number(fz.record.input_tax_base) === 13000 && Number(fz.record.input_tax_amount) === 1300, JSON.stringify({ t: fz.record.tax_treatment, b: fz.record.input_tax_base, a: fz.record.input_tax_amount }));
  check('subcontractor payable = net + input tax = 14,300', Number(fz.accounts_payable.amount) === 14300, String(fz.accounts_payable?.amount));
  must(await api('POST', `/finance/cost-transactions/${fz.cost_transaction.id}/post-gl`, admin), 'post cost');
  if (OWNER) {
    const s = (a, col) => sql(OWNER, `select coalesce(sum(${col}),0) from general_ledger where source_table='cost_transactions' and source_record_id=${fz.cost_transaction.id} and account_id=${a}`).out.trim();
    check('GL: Dr cost 20,000 + input tax 1,300 / Cr payable 14,300, retention 2,000, advance 5,000',
      s(acc.cost, 'debit') === '20000.00' && s(acc.inTax, 'debit') === '1300.00' && s(acc.ap, 'credit') === '14300.00' && s(acc.ret, 'credit') === '2000.00' && s(acc.adv, 'credit') === '5000.00',
      `cost=${s(acc.cost, 'debit')} tax=${s(acc.inTax, 'debit')} ap=${s(acc.ap, 'credit')} ret=${s(acc.ret, 'credit')} adv=${s(acc.adv, 'credit')}`);
  }

  // --- Payment with tax withheld from the subcontractor, as stated on our withholding notice.
  const ap = fz.accounts_payable.id;
  await expectStatus('withholding needs our withholding notice reference', () => api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: ap, amount: 13800, withheld_tax_amount: 500, currency_id: 1, bank_account_id: bank, method: 'transfer' }), 422);
  await expectStatus('cash + withheld above the payable refused (13,900 + 500 > 14,300)', () => api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: ap, amount: 13900, withheld_tax_amount: 500, withholding_certificate_ref: `WN-${TAG}`, currency_id: 1, bank_account_id: bank, method: 'transfer' }), 422);
  const wp = await run('payment 13,800 cash + 500 withheld settles the 14,300 payable', async () => pay(ap, 13800, { withheld_tax_amount: 500, withholding_certificate_ref: `WN-${TAG}` }));
  const apRow = must(await api('GET', '/finance/ap', admin), 'ap').find(x => Number(x.id) === Number(ap));
  check('certificate payable paid by cash + withholding', apRow?.status === 'paid', apRow?.status);
  if (OWNER) {
    const s = (a, col) => sql(OWNER, `select coalesce(sum(${col}),0) from general_ledger where source_table='payments' and source_record_id=${wp.id} and account_id=${a}`).out.trim();
    check('GL: Dr subcontractors payable 14,300 / Cr bank 13,800 + withholding liability 500; generic payables untouched (F-44)',
      s(acc.ap, 'debit') === '14300.00' && s(acc.whs, 'credit') === '500.00' && s(acc.generic, 'debit') === '0', `ap=${s(acc.ap, 'debit')} whs=${s(acc.whs, 'credit')} generic=${s(acc.generic, 'debit')}`);
  }
  const pos = must(await api('GET', `/finance/tax/position?from=${day(-1)}&to=${day(1)}`, fm1), 'position');
  const row = (k, cd) => pos.find(r => r.kind === k && r.code === cd);
  check('tax position: input tax 1,300 on base 13,000; withheld from suppliers 500', Number(row('input_tax', `IN-${TAG}`)?.tax) === 1300 && Number(row('input_tax', `IN-${TAG}`)?.base) === 13000 && Number(row('withheld_from_supplier', `WHS-${TAG}`)?.tax) === 500, JSON.stringify(pos.filter(r => r.code.endsWith(TAG))));

  // --- Retention release paid: clears retention payable.
  const ret = must(await api('GET', `/subcontracts/retentions?subcontract_id=${sc.id}`, qs), 'retentions')[0];
  const rel = must(await api('POST', `/subcontracts/retentions/${ret.id}/release`, qs, { reason: 'Defects liability period ended (fixture)', reference: `DLP-${TAG}` }), 'release');
  const rp = await pay(rel.accounts_payable.id, 2000);
  if (OWNER) {
    const d = sql(OWNER, `select coalesce(sum(debit),0) from general_ledger where source_table='payments' and source_record_id=${rp.id} and account_id=${acc.ret}`).out.trim();
    check('F-44: paying released retention debits retention payable 2,000', d === '2000.00', d);
  }

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: a certificate payable must equal net + input tax', `update accounts_payable set amount = amount + 1 where id = ${ap}`);
    probe('DB: an advance payable must equal the advance', `update accounts_payable set amount = 1 where id = ${advAp.id}`);
    probe('DB: input tax on an approved certificate is immutable', `update subcontract_certificates set input_tax_amount = 0 where id = ${c.id}`);
    const a2 = must(await api('POST', '/subcontracts/advances', maker, { subcontract_id: sc.id, amount: 1000, guarantee_ref: `APG-ST2-${TAG}` }), 'adv2');
    must(await api('POST', `/subcontracts/advances/${a2.id}/approve`, qs), 'adv2 approve');
    probe('DB: an advance cannot be set paid without a posted payment against its payable', `update subcontract_advances set status = 'paid', paid_at = now(), payment_reference = 'TYPED-REF', paid_by = approved_by where id = ${a2.id}`);
    await expectStatus('an advance cannot be marked paid through the old route', () => api('POST', `/subcontracts/advances/${a2.id}/paid`, qs, { payment_reference: 'TYPED-REF' }), 409);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A subcontract tax profile', must(await api('GET', `/finance/subcontracts/${sc.id}/tax-profile`, tb), 'b prof') === null);
  await expectStatus('tenant B cannot pay a tenant A advance payable', () => api('POST', '/finance/payments', tb, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: advAp.id, amount: 1, currency_id: 1, bank_account_id: bank, method: 'transfer' }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_subcontract_tax');
