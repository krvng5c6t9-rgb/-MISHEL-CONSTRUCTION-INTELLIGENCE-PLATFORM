// NDC-029 / Stage 9: decided EOT (claims, compensation events) produces append-only Time for Completion revisions;
// original completion preserved; signed terms frozen; LD terms second-person confirmed; LD exposure from the revised
// date, capped. LD exposure is information only. Rates, caps, dates and amounts are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const s1 = await login({ email: `w1s1.${TAG}@test.local`, password: 'Passw0rd!w1s1', org_id: 1 });
  const s2 = await login({ email: `w1s2.${TAG}@test.local`, password: 'Passw0rd!w1s2', org_id: 1 });
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `TF ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('TfC All', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'edit'], ['contracts', 'approve']]);
  const A = await mkUser('tfa', all), B = await mkUser('tfb', all), C = await mkUser('tfc', all);
  const client = must(await api('POST', '/clients', admin, { client_name: `TF Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `TF-${TAG}`, project_name: `TF ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const sign = async (body) => {
    const id = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 1000000, currency_id: 1, ...body }), 'contract').id;
    const ca = must(await api('POST', `/contracts/${id}/submit-approval`, admin), 'csub').approval;
    must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved', comment: 'ok' }), 's1');
    must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved', comment: 'ok' }), 's2');
    return id;
  };
  // Commencement 200 days ago, 180-day period -> original completion = 20 days ago.
  const contract = await sign({ effective_date: day(-200), completion_period_days: 180 });
  const noStart = await sign({ completion_period_days: 90 });

  // --- Signed terms frozen (Stage 9 defect: they were editable).
  await expectStatus('completion period of a signed contract cannot be edited', () => api('PATCH', `/contracts/${contract}`, A, { completion_period_days: 400 }), 422);
  await expectStatus('contract value of a signed contract cannot be edited', () => api('PATCH', `/contracts/${contract}`, A, { contract_value: 1 }), 422);
  await run('commencement date recorded once after signing', async () => must(await api('PATCH', `/contracts/${noStart}`, A, { effective_date: day(-10) }), 'start'));
  await expectStatus('recorded commencement date cannot be changed', () => api('PATCH', `/contracts/${noStart}`, A, { effective_date: day(-60) }), 422);
  await run('status-only change (signed -> active) still allowed', async () => must(await api('PATCH', `/contracts/${contract}`, A, { contract_status: 'active' }), 'active'));

  const pos = async (q = '') => must(await api('GET', `/contract-admin/contracts/${contract}/time-position${q}`, B), 'position');
  const p0 = await pos();
  check('original completion = commencement + period; no extension yet', p0.original_completion === day(-20) && p0.revised_completion === day(-20) && p0.approved_extension_days === 0, JSON.stringify(p0));
  check('no forecast without an accepted programme or a stated date (days late unknown, not zero)', p0.forecast_source === 'none' && p0.days_late === null && p0.ld_terms_status === 'not_recorded');

  // --- Claim decided with 20 of 30 days -> revision 1.
  const rule = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, A, { clause_ref: 'PC-20.1', obligation_type: 'notice_of_claim', responsible_party: 'contractor', trigger_description: 'Contractor claim (fixture)', period_value: 28, period_unit: 'calendar_days', addressee: 'Engineer (fixture)', is_condition_precedent: true, source_reference: 'fixture conditions' }), 'rule');
  must(await api('POST', `/contract-admin/rules/${rule.id}/confirm`, B), 'rule confirm');
  const ev = must(await api('POST', `/contract-admin/contracts/${contract}/events`, A, { title: 'Late site access (fixture)', description: 'Access to Zone D given late (fixture)', occurred_on: day(-12), became_aware_on: day(-10), rule_ids: [rule.id] }), 'event');
  must(await api('POST', `/contract-admin/notices/${ev.notices[0].id}/issue`, A, { delivery_method: 'courier', delivery_reference: 'AWB 901 (fixture)' }), 'issue');
  const k = must(await api('POST', '/claims', A, { project_id: project, contract_id: contract, claim_no: `TF1-${TAG}`, claim_type: 'eot', title: 'Zone D access', event_id: ev.event.id, notice_id: ev.notices[0].id, event_date: day(-12), notice_date: day(-5), claimed_days: 30, claimed_amount: 0, basis: 'Late access under PC-2.1 (fixture)' }), 'claim');
  must(await api('POST', `/claims/${k.id}/status`, A, { status: 'notified' }), 'notified');
  must(await api('POST', `/claims/${k.id}/status`, A, { status: 'submitted' }), 'submitted');
  must(await api('POST', `/claims/${k.id}/status`, B, { status: 'under_review' }), 'review');
  must(await api('PATCH', `/claims/${k.id}`, B, { approved_days: 20, approved_amount: 0, determination_reason: 'Concurrent delay (fixture)' }), 'determine');
  const revs0 = must(await api('GET', `/contract-admin/contracts/${contract}/time-revisions`, B), 'revs0');
  check('no revision before the decision (determination alone does not move the date)', revs0.length === 0);
  must(await api('POST', `/claims/${k.id}/status`, C, { status: 'partially_approved', reason: 'Accepted per determination (fixture)' }), 'decide');
  const revs1 = must(await api('GET', `/contract-admin/contracts/${contract}/time-revisions`, B), 'revs1');
  check('decided claim creates exactly one revision of 20 days from that claim', revs1.length === 1 && revs1[0].source_type === 'claim' && Number(revs1[0].source_id) === Number(k.id) && revs1[0].days === 20 && revs1[0].cumulative_days === 20 && revs1[0].revision_seq === 1, JSON.stringify(revs1));

  // --- Compensation event PM-assessed at 8 days -> revision 2.
  const ev2 = must(await api('POST', `/contract-admin/contracts/${contract}/events`, A, { title: 'Late drawings (fixture)', description: 'Design information late (fixture)', occurred_on: day(-9), became_aware_on: day(-9) }), 'event2').event;
  const ce = must(await api('POST', `/contract-admin/contracts/${contract}/compensation-events`, A, { event_id: ev2.id, ce_no: `TFCE-${TAG}`, description: 'Late drawings CE (fixture)', notified_on: day(-8) }), 'ce');
  must(await api('POST', `/contract-admin/compensation-events/${ce.id}/quotation`, B, { amount: 20000, time_days: 12, submitted_on: day(-4) }), 'quote');
  must(await api('POST', `/contract-admin/compensation-events/${ce.id}/decision`, C, { decision: 'pm_assessed', decision_on: day(0), reference: 'PM letter 9 (fixture)', amount: 15000, time_days: 8, reason: 'Only Zone D affected (fixture)' }), 'ce decide');
  const p1 = await pos();
  check('revised completion = original + 20 + 8 days; original preserved', p1.original_completion === day(-20) && p1.approved_extension_days === 28 && p1.revisions === 2 && p1.revised_completion === day(8), JSON.stringify(p1));
  check('programme update flagged outstanding after the time revision', p1.programme_update_outstanding === true);
  const p1c = must(await api('GET', `/claims/${k.id}`, A), 'claim view');
  check('claim view still shows the claimed 30 days beside the 20 granted', p1c.claimed_days === 30 && p1c.approved_days === 20);

  // --- LD terms: from the contract, second-person confirmed.
  await expectStatus('LD cap basis without a cap value refused', () => api('POST', `/contract-admin/contracts/${contract}/ld-terms`, A, { basis: 'amount_per_day', rate: 1000, cap_basis: 'amount', clause_ref: 'PC-8.8', source_reference: 'Contract Data (fixture)' }), 400);
  const ld = await run('LD terms recorded: 1,000/day, cap 10% of contract value', async () => must(await api('POST', `/contract-admin/contracts/${contract}/ld-terms`, A, { basis: 'amount_per_day', rate: 1000, cap_basis: 'percent_of_contract_value', cap_value: 10, clause_ref: 'PC-8.8', source_reference: 'Contract Data, LD row (fixture)' }), 'ld'));
  const pd = await pos(`?forecast_completion=${day(158)}`);
  check('unconfirmed LD terms give no exposure figure', pd.ld_terms_status === 'draft' && pd.ld_exposure === null && pd.days_late === 150, JSON.stringify(pd));
  await expectStatus('author cannot confirm own LD terms (SoD)', () => api('POST', `/contract-admin/ld-terms/${ld.id}/confirm`, A), 403);
  await run('second person confirms LD terms', async () => must(await api('POST', `/contract-admin/ld-terms/${ld.id}/confirm`, B), 'ld confirm'));
  await expectStatus('confirmed LD terms cannot be confirmed again', () => api('POST', `/contract-admin/ld-terms/${ld.id}/confirm`, C), 409);
  const p2 = await pos(`?forecast_completion=${day(18)}`);
  check('10 days late against the REVISED date -> exposure 10,000 (not 38 days against the original)', p2.days_late === 10 && Number(p2.ld_exposure) === 10000 && Number(p2.ld_daily_amount) === 1000, JSON.stringify(p2));
  const p3 = await pos(`?forecast_completion=${day(158)}`);
  check('150 days late -> gross 150,000 capped at 100,000', Number(p3.ld_gross) === 150000 && Number(p3.ld_cap) === 100000 && Number(p3.ld_exposure) === 100000, JSON.stringify(p3));
  const p4 = await pos(`?forecast_completion=${day(5)}`);
  check('forecast within the revised date -> 0 days late, 0 exposure', p4.days_late === 0 && Number(p4.ld_exposure) === 0);
  await expectStatus('malformed forecast date refused', () => api('GET', `/contract-admin/contracts/${contract}/time-position?forecast_completion=soon`, B), 400);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: time revisions cannot be edited', `update time_for_completion_revisions set days=99 where contract_id=${contract}`);
    probe('DB: time revisions cannot be deleted', `delete from time_for_completion_revisions where contract_id=${contract}`);
    probe('DB: a revision not matching a decided source is refused', `insert into time_for_completion_revisions(org_id,contract_id,revision_seq,source_type,source_id,days,cumulative_days,decided_on) values(1,${contract},0,'claim',${k.id},25,0,current_date)`);
    probe('DB: signed contract terms frozen at DB level', `update contracts set completion_period_days=999 where id=${contract}`);
    probe('DB: confirmed LD terms immutable', `update contract_ld_terms set rate=1 where id=${ld.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read tenant A time position', () => api('GET', `/contract-admin/contracts/${contract}/time-position`, tb), 404);
  const rB = must(await api('GET', `/contract-admin/contracts/${contract}/time-revisions`, tb), 'revs B');
  check('tenant B sees no tenant A revisions', rB.length === 0);
  await expectStatus('tenant B cannot record LD terms on tenant A contract', () => api('POST', `/contract-admin/contracts/${noStart}/ld-terms`, tb, { basis: 'amount_per_day', rate: 1, cap_basis: 'none', clause_ref: 'X', source_reference: 'cross tenant' }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_time_for_completion');
