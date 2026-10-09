// Stage 14 / GC-10: weekly/monthly project report packs - freeze as of a data date (DB-computed content + SHA-256),
// cross-module reconciliation exceptions, explanation, approval by someone other than the preparer, back-dated
// postings surfaced in the next pack. Also the weekly-executive defects (project-scoped approvals, missing EVM).
// Amounts and dates are TEST FIXTURES. Reuses plant users asa/asb and the equipment-usage DOA from sweep_assets.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `RP ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('Reports All', [['reports', 'view'], ['reports', 'create'], ['reports', 'edit'], ['reports', 'approve'], ['site', 'view'], ['site', 'manage']]);
  const P1 = await mkUser('rpp', all), P2 = await mkUser('rpa', all);
  const V = await mkUser('rpv', await mkRole('Reports Viewer', [['reports', 'view']]));
  const cc = await mkRole('RP Cost', [['cost_control', 'view'], ['cost_control', 'manage'], ['cost_control', 'approve']]);
  const QS = await mkUser('rpqs', cc), CM = await mkUser('rpcm', cc);
  const asa = await login({ email: `asa.${TAG}@test.local`, password: 'Passw0rd!asa', org_id: 1 });
  const asb = await login({ email: `asb.${TAG}@test.local`, password: 'Passw0rd!asb', org_id: 1 });
  const mkProject = async (code) => must(await api('POST', '/projects', admin, { project_code: `${code}-${TAG}`, project_name: `${code} ${TAG}`, currency_id: 1 }), 'project').id;
  const PR = await mkProject('RP'), OTHER = await mkProject('RPO');
  const ex = must(await api('POST', '/assets/equipment', asa, { asset_code: `RPX-${TAG}`, asset_name: 'Roller (fixture)', ownership_type: 'rented' }), 'asset');
  must(await api('PATCH', `/assets/equipment/${ex.id}/status`, asa, { status: 'in_use', current_project_id: PR }), 'mobilise');
  const usage = async (date, hours, post = true, project = PR, asset = ex.id) => {
    const u = must(await api('POST', '/assets/equipment-usage', asa, { asset_id: asset, project_id: project, usage_date: date, hours_used: hours, cost_code_id: 2, currency_id: 1, hourly_rate: 100 }), 'usage');
    const ap = must(await api('PATCH', `/assets/equipment-usage/${u.id}/approve`, asa), 'submit').approval;
    if (!post) return ap;
    must(await api('POST', `/approvals/${ap.id}/actions`, asb, { action: 'approved', comment: 'ok' }), 'approve usage');
    must(await api('POST', `/assets/equipment-usage/${u.id}/post-cost`, asb), 'post');
    return ap;
  };

  // --- Weekly-executive defects (before CC-043: org-wide approvals on every project; SPI/CPI 0 without EVM).
  const ex2 = must(await api('POST', '/assets/equipment', asa, { asset_code: `RPY-${TAG}`, asset_name: 'Pump (fixture)', ownership_type: 'rented' }), 'asset2');
  must(await api('PATCH', `/assets/equipment/${ex2.id}/status`, asa, { status: 'in_use', current_project_id: OTHER }), 'mobilise2');
  await usage(day(-1), 1, false, OTHER, ex2.id); // pending approval on the OTHER project only
  const wk = must(await api('GET', `/reports/weekly-executive?project_id=${PR}`, P1), 'weekly');
  check('weekly-executive counts only this project\'s pending approvals (other project pending: 1, this: 0)', wk[0]?.pending_approvals === 0, JSON.stringify(wk[0] ?? null));
  const wkO = must(await api('GET', `/reports/weekly-executive?project_id=${OTHER}`, P1), 'weekly other');
  check('the other project shows its own pending approval', wkO[0]?.pending_approvals === 1, JSON.stringify(wkO[0] ?? null));
  check('without an EVM snapshot SPI/CPI are null, not 0', wk[0]?.spi === null && wk[0]?.cpi === null && wk[0]?.evm_available === false);

  // --- Data for the first period (day -13 .. -7): actual 400 (not posted to GL), budget approved today, unsigned diary.
  await usage(day(-10), 4);
  const bud = must(await api('POST', '/cost-transactions/budgets', QS, { project_id: PR, cost_code_id: 2, budget_type: 'original', amount: 300 }), 'budget');
  must(await api('POST', `/cost-transactions/budgets/${bud.id}/approve`, CM), 'approve budget');
  must(await api('POST', '/site/diaries', P1, { project_id: PR, diary_date: day(-9), weather: 'clear', work_performed: 'Compaction of layer 2 (fixture)' }), 'diary');

  await expectStatus('a pack cannot be frozen for a period that has not ended', () => api('POST', '/reports/packs', P1, { project_id: PR, period_type: 'weekly', period_start: day(-5), period_end: day(1) }), 422);
  await expectStatus('viewer cannot freeze a pack', () => api('POST', '/reports/packs', V, { project_id: PR, period_type: 'weekly', period_start: day(-13), period_end: day(-7) }), 403);
  const k1 = await run('preparer freezes weekly pack (day -13 .. -7)', async () => must(await api('POST', '/reports/packs', P1, { project_id: PR, period_type: 'weekly', period_start: day(-13), period_end: day(-7), payload: { cost: { actual: 1 } } }), 'pack1'));
  const types = k1.payload.exceptions.map(e => e.type);
  check('content computed by the database as of the data date (actual 400; budget approved later not counted)', Number(k1.payload.cost.actual) === 400 && Number(k1.payload.cost.budget) === 0 && k1.payload.cost.basis === 'as_of', JSON.stringify(k1.payload.cost));
  check('reconciliation lists: actual not posted to GL, actual without approved budget, unsigned diary', ['actual_not_posted_to_gl', 'actual_without_approved_budget', 'unsigned_site_diaries_in_period'].every(t => types.includes(t)) && k1.exception_count === types.length, types.join(','));
  check('status-based sections are labelled at_capture', k1.payload.time.basis === 'at_capture' && k1.payload.risks.basis === 'at_capture');
  await expectStatus('one live pack per project period', () => api('POST', '/reports/packs', P2, { project_id: PR, period_type: 'weekly', period_start: day(-13), period_end: day(-7) }), 409);

  // --- Explain, submit, approve.
  await expectStatus('submission refused while exceptions are unexplained', () => api('POST', `/reports/packs/${k1.id}/submit`, P1), 422);
  await expectStatus('only the preparer writes the narrative', () => api('PATCH', `/reports/packs/${k1.id}/narrative`, P2, { narrative: 'not mine to write here at all' }), 403);
  must(await api('PATCH', `/reports/packs/${k1.id}/narrative`, P1, { narrative: 'Roller cost awaiting GL posting; budget approved after period end; diary of day -9 awaiting signature (fixture)' }), 'narrative');
  await run('preparer submits the explained pack', async () => must(await api('POST', `/reports/packs/${k1.id}/submit`, P1), 'submit'));
  await expectStatus('narrative frozen once submitted', () => api('PATCH', `/reports/packs/${k1.id}/narrative`, P1, { narrative: 'rewritten after submission' }), 409);
  await expectStatus('preparer cannot approve own pack (SoD)', () => api('POST', `/reports/packs/${k1.id}/decision`, P1, { decision: 'approved' }), 403);
  await run('second person approves the pack', async () => must(await api('POST', `/reports/packs/${k1.id}/decision`, P2, { decision: 'approved' }), 'approve'));
  const v1 = must(await api('GET', `/reports/packs/${k1.id}`, V), 'verify1');
  check('stored hash verifies and data unchanged since freeze', v1.verification.stored_hash_valid === true && v1.verification.data_changed_since_freeze === false, JSON.stringify(v1.verification));

  // --- A posting back-dated into the approved period.
  await usage(day(-8), 2);
  const v2 = must(await api('GET', `/reports/packs/${k1.id}`, V), 'verify2');
  check('approved pack still verifies, and flags that the data behind it changed', v2.verification.stored_hash_valid === true && v2.verification.data_changed_since_freeze === true && Number(v2.payload.cost.actual) === 400);
  const k2 = must(await api('POST', '/reports/packs', P1, { project_id: PR, period_type: 'weekly', period_start: day(-6), period_end: day(0) }), 'pack2');
  const bd = k2.payload.exceptions.find(e => e.type === 'backdated_into_approved_period');
  check('next pack reports the back-dated posting (1 entry, 200)', bd && bd.count === 1 && Number(bd.amount) === 200, JSON.stringify(k2.payload.exceptions));
  must(await api('PATCH', `/reports/packs/${k2.id}/narrative`, P1, { narrative: 'Back-dated roller hours of day -8 under review with plant team (fixture)' }), 'narr2');
  must(await api('POST', `/reports/packs/${k2.id}/submit`, P1), 'submit2');
  await expectStatus('rejection needs a reason', () => api('POST', `/reports/packs/${k2.id}/decision`, P2, { decision: 'rejected' }), 400);
  await run('approver rejects with reason', async () => must(await api('POST', `/reports/packs/${k2.id}/decision`, P2, { decision: 'rejected', reason: 'Resolve back-dated hours before issue (fixture)' }), 'reject'));
  await run('a rejected period can be frozen again', async () => must(await api('POST', '/reports/packs', P1, { project_id: PR, period_type: 'weekly', period_start: day(-6), period_end: day(0) }), 'pack3'));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: frozen content cannot be edited', `update project_report_packs set payload = payload || '{"edited":true}' where id=${k1.id}`);
    probe('DB: approved pack cannot be deleted', `delete from project_report_packs where id=${k1.id}`);
    probe('DB: approved pack cannot be re-decided', `update project_report_packs set status='rejected', decision_reason='second thoughts' where id=${k1.id}`);
    const forged = sql(OWNER, `begin; insert into project_report_packs(org_id,project_id,period_type,period_start,period_end,payload,payload_sha256,exception_count,prepared_by) values(1,${PR},'monthly','${day(-13)}','${day(-7)}','{"cost":{"actual":1}}','${'0'.repeat(64)}',0,1) returning payload->'cost'->>'actual'; rollback;`);
    check('DB: supplied figures are ignored - the database computes the content', forged.ok && /\n?600\.00/.test(forged.out) && !/^1$/m.test(forged.out), forged.out.replace(/\n/g, ' | ').slice(0, 120));
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  const lB = must(await api('GET', '/reports/packs', tb), 'packs B');
  check('tenant B sees no tenant A packs', !lB.some(p => Number(p.id) === Number(k1.id)));
  await expectStatus('tenant B cannot read a tenant A pack', () => api('GET', `/reports/packs/${k1.id}`, tb), 404);
  await expectStatus('tenant B cannot freeze a pack for a tenant A project', () => api('POST', '/reports/packs', tb, { project_id: PR, period_type: 'weekly', period_start: day(-13), period_end: day(-7) }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_report_packs');
