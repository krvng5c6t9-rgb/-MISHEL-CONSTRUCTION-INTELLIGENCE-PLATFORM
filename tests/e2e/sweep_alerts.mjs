// CC-083 / R1.4 (MP-06 §6, migration 090): the alert engine and the notification centre API. Each alert of the first
// batch is driven by its source data: an approval created through the API (AL-01, AL-02), an NCR and an incident
// and an RFI created through the API (AL-11, AL-12, AL-25), an existing contract notice whose deadline is fixed (AL-03: the window is
// set around it), and existing receivables, payables and an RFI whose dates are set by SQL as TEST FIXTURES and
// restored at the end (AL-15, AL-14). A receivable linked to an IPC keeps the due date of its contract's payment
// terms (database rule), so the fixture receivable is one without an IPC. Thresholds and recipient roles
// are TEST FIXTURES (company settings), not recommended values.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const restore = [];
const fixture = (table, id, column, valueSql) => {
  const before = one(`select coalesce(${column}::text, 'NULL') from ${table} where id = ${id}`);
  restore.push(`update ${table} set ${column} = ${before === 'NULL' ? 'NULL' : `'${before}'`} where id = ${id}`);
  one(`update ${table} set ${column} = ${valueSql} where id = ${id}`);
};
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    const created = must(await api('POST', '/users', admin, { role_id, full_name: `AL ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return { id: Number(created.id), token: await login(u) };
  };
  const mine = async (u) => must(await api('GET', '/notifications?unread=false&limit=200', u.token), 'list');
  const evaluate = async () => must(await api('POST', '/notifications/evaluate', admin), 'evaluate');

  // --- Settings: the catalogue, validation, permissions.
  const rules = must(await api('GET', '/notifications/alert-rules', admin), 'rules');
  check('alert catalogue (CC-083 + CC-084): AL-01, 02, 03, 06, 07, 11, 12, 14, 15, 18, 20, 22, 23, 25; only AL-01 active before the company sets anything',
    rules.map(r => r.alert_code).join(',') === 'AL-01,AL-02,AL-03,AL-06,AL-07,AL-11,AL-12,AL-14,AL-15,AL-18,AL-20,AL-22,AL-23,AL-25' && rules.filter(r => r.active).map(r => r.alert_code).join(',') === 'AL-01',
    rules.map(r => `${r.alert_code}:${r.active}`).join(' '));
  const collect = await mkRole('AL Collections', [['finance', 'view']]);
  const noFin = await mkRole('AL No finance', [['projects', 'view']]);
  const qa = await mkRole('AL QA', [['qaqc', 'view'], ['qaqc', 'create'], ['hse', 'view'], ['hse', 'create'], ['contracts', 'view'], ['technical_office', 'view'], ['technical_office', 'manage']]);
  const U = { col: await mkUser('alcol', collect), nofin: await mkUser('alnof', noFin), qa: await mkUser('alqa', qa) };
  await expectStatus('alert settings need the notifications permission', () => api('GET', '/notifications/alert-rules', U.col.token), 403);
  await expectStatus('an alert that needs a threshold cannot be switched on without one (AL-03)', () => api('PUT', '/notifications/alert-rules/AL-03', admin, { enabled: true, recipient_role_ids: [qa] }), 422);
  await expectStatus('an alert addressed to roles cannot be switched on without them (AL-15)', () => api('PUT', '/notifications/alert-rules/AL-15', admin, { enabled: true }), 422);
  await expectStatus('an alert without a threshold takes none (AL-15)', () => api('PUT', '/notifications/alert-rules/AL-15', admin, { enabled: true, threshold: 5, recipient_role_ids: [collect] }), 422);
  await expectStatus('approval alerts take no recipient roles (they go to the approvers)', () => api('PUT', '/notifications/alert-rules/AL-01', admin, { enabled: true, recipient_role_ids: [collect] }), 422);
  await expectStatus('an alert outside the catalogue is refused', () => api('PUT', '/notifications/alert-rules/AL-99', admin, { enabled: true }), 404);
  const otherRole = Number(one(`select id from roles where org_id = ${ADMIN_B.org_id} order by id limit 1`));
  await expectStatus('recipient roles of another company are refused', () => api('PUT', '/notifications/alert-rules/AL-15', admin, { enabled: true, recipient_role_ids: [otherRole] }), 422);

  // --- AL-01 / AL-02: an approval created through the API reaches the approvers of its step, once.
  let mjRule = must(await api('GET', '/approvals/configuration/doa', admin), 'doa').find(d => d.module === 'manual_journal_entry' && d.is_active && d.is_confirmed);
  if (!mjRule) {
    const conf = await mkUser('alconf', await mkRole('AL DOA Conf', [['admin', 'view'], ['admin', 'approve']]));
    const apr = await mkRole('AL Approver', [['approvals', 'view'], ['approvals', 'approve'], ['finance', 'view']]);
    mjRule = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'manual_journal_entry', min_amount: 0, approval_level: 1, approver_role_id: apr, notes: 'TEST FIXTURE' }), 'doa');
    must(await api('POST', `/approvals/configuration/doa/${mjRule.id}/confirm`, conf.token), 'doa confirm');
  }
  const approver = await mkUser('alap', Number(mjRule.approver_role_id));
  const maker = await mkUser('almk', await mkRole('AL Maker', [['finance', 'view'], ['finance', 'manage'], ['approvals', 'view']]));
  const coa = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const dr = await coa('AL1020', 'Alert test bank (fixture)', 'asset'), cr = await coa('AL3020', 'Alert test funding (fixture)', 'equity');
  const mj = must(await api('POST', '/finance/manual-journals', maker.token, { description: 'Alert test journal (fixture)', reason_category: 'other', project_id: null,
    lines: [{ account_id: dr, debit: 10, credit: 0, currency_id: 1 }, { account_id: cr, debit: 0, credit: 10, currency_id: 1 }] }), 'mj');
  const approval = must(await api('POST', `/finance/manual-journals/${mj.id}/submit`, maker.token), 'submit').approval;
  const forApproval = (list, code) => list.filter(n => n.alert_code === code && n.record_table === 'approval_instances' && Number(n.record_id) === Number(approval.id));
  const a1 = forApproval(await mine(approver), 'AL-01');
  check('AL-01: the approver of the step is told, with the record, its type and a link to the approvals screen',
    a1.length === 1 && a1[0].link === '/approvals' && a1[0].params?.module === 'manual_journal_entry' && Number(a1[0].params?.record) === Number(mj.id) && a1[0].is_read === false,
    JSON.stringify(a1[0] ?? null));
  check('AL-01: the maker (not an approver) is not told', forApproval(await mine(maker), 'AL-01').length === 0);
  await evaluate();
  check('AL-01: evaluating again does not repeat the notification', forApproval(await mine(approver), 'AL-01').length === 1);
  // The initiator is never told about their own approval even when holding the approver role (probe rolled back).
  await mkUser('alap2', Number(mjRule.approver_role_id));
  const self = one(`begin;
    insert into approval_instances(org_id, module, record_id, amount, currency_id, current_step, status, initiated_by)
      values (${ADMIN.org_id}, 'manual_journal_entry', 0, 10, 1, ${mjRule.approval_level}, 'pending', ${approver.id});
    select evaluate_alerts(${ADMIN.org_id});
    select 'n', (select count(*) from notifications where record_id = currval('approval_instances_id_seq') and record_table = 'approval_instances' and user_id <> ${approver.id}),
      (select count(*) from notifications where user_id = ${approver.id} and record_id = currval('approval_instances_id_seq') and record_table = 'approval_instances');
    rollback;`).split('\n').find(l => l.startsWith('n|'))?.split('|') ?? [];
  // The count runs in a later statement: a statement does not see rows written by a function it calls (one snapshot).
  // Control: the other active users of the approver role are told, so the probe does see what the evaluation wrote.
  const peers = Number(one(`select count(*) from users where org_id = ${ADMIN.org_id} and role_id = ${mjRule.approver_role_id} and is_active and user_type = 'internal' and id <> ${approver.id}`));
  check('AL-01: an approver who initiated the approval is not told about it (the other approvers are)', self[2] === '0' && peers > 0 && Number(self[1]) === peers, `${self.join('|')}, other approvers ${peers}`);
  must(await api('PUT', '/notifications/alert-rules/AL-02', admin, { enabled: true, threshold: 0 }), 'al-02 on');
  await evaluate();
  const a2 = forApproval(await mine(approver), 'AL-02');
  check('AL-02: pending longer than the company\'s hours (0 for the test) -> overdue alert to the approver', a2.length === 1 && Number(a2[0].params?.hours) === 0, JSON.stringify(a2[0] ?? null));
  must(await api('PUT', '/notifications/alert-rules/AL-02', admin, { enabled: false, threshold: 0 }), 'al-02 off');

  // --- AL-15 / AL-14: receivables and payables (finance view required).
  must(await api('PUT', '/notifications/alert-rules/AL-15', admin, { enabled: true, recipient_role_ids: [collect, noFin] }), 'al-15 on');
  const ar = one(`select id from accounts_receivable where org_id = ${ADMIN.org_id} and status in ('open', 'partially_paid') and ipc_id is null order by id limit 1`);
  fixture('accounts_receivable', ar, 'due_date', 'current_date - 1');
  await evaluate();
  const r15 = (await mine(U.col)).filter(n => n.alert_code === 'AL-15' && Number(n.record_id) === Number(ar));
  check('AL-15: an open receivable past its due date reaches the recipient role, with party, amount and currency', r15.length === 1 && r15[0].link === '/payments-certification' && !!r15[0].params?.party && Number(r15[0].params?.amount) > 0 && /^[A-Z]{3}$/.test(r15[0].params?.currency ?? ''),
    JSON.stringify(r15[0] ?? null));
  check('AL-15: a recipient role without finance view is not told (an alert never shows what the user may not read)', (await mine(U.nofin)).filter(n => n.alert_code === 'AL-15').length === 0);
  must(await api('PUT', '/notifications/alert-rules/AL-14', admin, { enabled: true, threshold: 7, recipient_role_ids: [collect] }), 'al-14 on');
  const aps = one(`select id from accounts_payable where org_id = ${ADMIN.org_id} and status in ('open', 'partially_paid') order by id limit 2`).split('\n');
  fixture('accounts_payable', aps[0], 'due_date', 'current_date + 3');
  fixture('accounts_payable', aps[1], 'due_date', 'current_date + 30');
  await evaluate();
  const r14 = (await mine(U.col)).filter(n => n.alert_code === 'AL-14').map(n => String(n.record_id));
  check('AL-14: a payable due within the company\'s days (7) is alerted; one due in 30 days is not', r14.includes(aps[0]) && !r14.includes(aps[1]), r14.join(','));

  // --- AL-11 / AL-12 / AL-03 / AL-25: quality, HSE, contract notices, consultant responses.
  const project = Number(one(`select id from projects where org_id = ${ADMIN.org_id} order by id limit 1`));
  const oldNcr = must(await api('POST', '/qaqc/ncrs', U.qa.token, { project_id: project, ncr_no: `AL-N1-${TAG}`, description: 'Alert test NCR (fixture)' }), 'ncr 1');
  const newNcr = must(await api('POST', '/qaqc/ncrs', U.qa.token, { project_id: project, ncr_no: `AL-N2-${TAG}`, description: 'Alert test NCR (fixture)' }), 'ncr 2');
  fixture('ncrs', oldNcr.id, 'raised_date', 'current_date - 10');
  must(await api('PUT', '/notifications/alert-rules/AL-11', admin, { enabled: true, threshold: 5, recipient_role_ids: [qa] }), 'al-11 on');
  const before = must(await api('POST', '/hse/incidents', U.qa.token, { project_id: project, severity: 'minor', description: 'Before the alert was switched on (fixture)' }), 'incident 1');
  must(await api('PUT', '/notifications/alert-rules/AL-12', admin, { enabled: true, recipient_role_ids: [qa] }), 'al-12 on');
  const after = must(await api('POST', '/hse/incidents', U.qa.token, { project_id: project, severity: 'major', description: 'After the alert was switched on (fixture)' }), 'incident 2');
  // A notice deadline cannot be changed (database rule): the window is set one day short of it, then to reach it.
  const [notice, left] = (one(`select id, greatest(deadline - current_date, 1) from contract_notices where org_id = ${ADMIN.org_id} and status = 'open' order by id limit 1`) || '|').split('|');
  if (notice) {
    must(await api('PUT', '/notifications/alert-rules/AL-03', admin, { enabled: true, threshold: Number(left) - 1, recipient_role_ids: [qa] }), 'al-03 short');
    await evaluate();
    check('AL-03: a notice due after the company\'s window is not alerted', !(await mine(U.qa)).some(n => n.alert_code === 'AL-03' && String(n.record_id) === notice), `window ${Number(left) - 1} days, deadline in ${left}`);
  }
  must(await api('PUT', '/notifications/alert-rules/AL-03', admin, { enabled: true, threshold: Number(left || 5), recipient_role_ids: [qa] }), 'al-03 on');
  const yesterday = one(`select (current_date - 1)::text`);
  const rfi = String(must(await api('POST', '/technical-office/rfis', U.qa.token, { project_id: project, rfi_no: `AL-R-${TAG}`, subject: 'Alert test RFI (fixture)', question: 'Fixture question', response_due: yesterday }), 'rfi').id);
  must(await api('PUT', '/notifications/alert-rules/AL-25', admin, { enabled: true, recipient_role_ids: [qa] }), 'al-25 on');
  await evaluate();
  const q = await mine(U.qa);
  const has = (code, id) => q.some(n => n.alert_code === code && String(n.record_id) === String(id));
  check('AL-11: an NCR open longer than the company\'s days (5) is alerted; one raised today is not', has('AL-11', oldNcr.id) && !has('AL-11', newNcr.id), q.filter(n => n.alert_code === 'AL-11').map(n => n.record_id).join(','));
  check('AL-12: an incident recorded after the alert was switched on is alerted (with its severity); an earlier one is not', has('AL-12', after.id) && !has('AL-12', before.id)
    && q.find(n => n.alert_code === 'AL-12' && String(n.record_id) === String(after.id))?.params?.severity === 'major');
  check('AL-03: an open contract notice due within the company\'s window is alerted', !!notice && has('AL-03', notice), `notice ${notice || 'none in the data'}, window ${left} days`);
  check('AL-25: an open RFI past its response date is alerted', !!rfi && has('AL-25', rfi), `rfi ${rfi || 'none in the data'}`);
  check('alerts reach only the roles named: the collections role gets no quality, HSE or contract alerts', !(await mine(U.col)).some(n => ['AL-03', 'AL-11', 'AL-12', 'AL-25'].includes(n.alert_code)));

  // --- CC-084 second batch: AL-06, AL-07, AL-18, AL-20, AL-22, AL-23 (recipients: an operations role).
  const ops = await mkRole('AL Ops', [['hse', 'view'], ['hse', 'create'], ['edms', 'view'], ['edms', 'create'], ['edms', 'edit'], ['ai_platform', 'view'], ['cost_control', 'view'], ['site', 'view']]);
  U.ops = await mkUser('alops', ops);
  const soon = one(`select (current_date + 3)::text`), later = one(`select (current_date + 30)::text`);
  const pSoon = must(await api('POST', '/hse/permits', U.ops.token, { project_id: project, permit_type: 'hot_work', expiry_date: soon }), 'permit soon');
  const pLater = must(await api('POST', '/hse/permits', U.ops.token, { project_id: project, permit_type: 'height', expiry_date: later }), 'permit later');
  for (const p of [pSoon, pLater]) must(await api('POST', `/hse/permits/${p.id}/approve`, admin), 'permit approve');
  must(await api('PUT', '/notifications/alert-rules/AL-06', admin, { enabled: true, threshold: 7, recipient_role_ids: [ops] }), 'al-06 on');
  const agent = must(await api('POST', '/ai-platform/agents', admin, { agent_key: `al-agent-${TAG}`, name: `Alert test agent ${TAG}`, purpose: 'TEST FIXTURE' }), 'agent');
  must(await api('PATCH', `/ai-platform/agents/${agent.id}`, admin, { status: 'suspended' }), 'agent suspend');
  const run1 = must(await api('POST', '/ai-platform/runs', admin, { agent_id: agent.id, input_payload: { fixture: true } }), 'run');
  must(await api('PATCH', `/ai-platform/runs/${run1.id}/status`, admin, { status: 'waiting_approval' }), 'run waiting');
  const run2 = must(await api('POST', '/ai-platform/runs', admin, { agent_id: agent.id, input_payload: { fixture: true } }), 'run 2');
  must(await api('PUT', '/notifications/alert-rules/AL-18', admin, { enabled: true, recipient_role_ids: [ops] }), 'al-18 on');
  must(await api('PUT', '/notifications/alert-rules/AL-20', admin, { enabled: true, recipient_role_ids: [ops] }), 'al-20 on');
  const doc = must(await api('POST', '/edms/documents', U.ops.token, { project_id: project, doc_number: `ALDOC${TAG}`, file_name: 'rev-a.pdf', storage_key: `al/${TAG}/a.pdf`, revision: 'A' }), 'doc');
  const v1 = must(await api('GET', `/edms/documents/${doc.id}/versions`, U.ops.token), 'versions').find(v => v.is_current);
  must(await api('POST', `/edms/documents/${doc.id}/versions`, U.ops.token, { file_name: 'rev-b.pdf', storage_key: `al/${TAG}/b.pdf`, revision: 'B' }), 'version B');
  const tr = must(await api('POST', '/edms/transmittals', U.ops.token, { project_id: project, transmittal_no: `AL-T-${TAG}`, purpose: 'for_information' }), 'transmittal');
  const oldLine = await api('POST', `/edms/transmittals/${tr.id}/lines`, U.ops.token, { document_id: doc.id, document_version_id: v1.id });
  must(await api('PUT', '/notifications/alert-rules/AL-22', admin, { enabled: true, recipient_role_ids: [ops] }), 'al-22 on');
  const [cert, dlpLeft] = (one(`select id, dlp_end_date - current_date from handover_certificates where org_id = ${ADMIN.org_id} and dlp_end_date >= current_date order by id limit 1`) || '|').split('|');
  if (cert) must(await api('PUT', '/notifications/alert-rules/AL-23', admin, { enabled: true, threshold: Math.max(0, Number(dlpLeft) - 1), recipient_role_ids: [ops] }), 'al-23 short');
  await evaluate();
  const shortHas = cert ? (await mine(U.ops)).some(n => n.alert_code === 'AL-23' && String(n.record_id) === cert) : true;
  if (cert) must(await api('PUT', '/notifications/alert-rules/AL-23', admin, { enabled: true, threshold: Number(dlpLeft), recipient_role_ids: [ops] }), 'al-23 on');
  must(await api('PUT', '/notifications/alert-rules/AL-07', admin, { enabled: true, threshold: 10, recipient_role_ids: [ops] }), 'al-07 on');
  await evaluate();
  const o = await mine(U.ops);
  const got = (code, id) => o.some(n => n.alert_code === code && String(n.record_id) === String(id));
  check('AL-06: an approved work permit expiring within the company\'s days (7) is alerted with its type; one expiring in 30 days is not',
    got('AL-06', pSoon.id) && !got('AL-06', pLater.id) && o.find(n => n.alert_code === 'AL-06' && String(n.record_id) === String(pSoon.id))?.params?.type === 'hot_work');
  check('AL-18: an AI run waiting for human approval is alerted; a queued run is not', got('AL-18', run1.id) && !got('AL-18', run2.id));
  check('AL-20: a suspended AI agent is alerted', got('AL-20', agent.id));
  check('AL-22: a draft transmittal holding a superseded document version is alerted', oldLine.status === 201 && o.some(n => n.alert_code === 'AL-22' && n.params?.transmittal === `AL-T-${TAG}`),
    `line HTTP ${oldLine.status}`);
  check('AL-23: a defects liability period ending within the company\'s days is alerted, not one ending after them', !!cert && !shortHas && got('AL-23', cert), `certificate ${cert || 'none in the data'}, ends in ${dlpLeft} days`);
  check('second-batch alerts reach only the role named (the QA role gets none of them)', !(await mine(U.qa)).some(n => ['AL-06', 'AL-18', 'AL-20', 'AL-22', 'AL-23'].includes(n.alert_code)));
  // AL-07 on approved cost forecasts (probes rolled back): EAC 120 on a budget of 100 breaches a 10 % threshold; 105 does not.
  const eacProbe = (etc) => one(`begin;
    alter table cost_forecast_snapshots disable trigger user;
    insert into cost_forecast_snapshots(org_id, project_id, cost_code_id, as_of, budget, committed, actual, accrual, etc_method, etc_amount, etc_basis, prepared_by, approved_by, approved_at)
      values (${ADMIN.org_id}, ${project}, (select id from cost_codes where org_id = ${ADMIN.org_id} order by id limit 1), current_date + 1, 100, 0, 0, 0, 'manual', ${etc}, 'Alert test forecast (fixture)', ${maker.id}, ${approver.id}, now());
    select evaluate_alerts(${ADMIN.org_id});
    select 'eac', 0, (select count(*) from notifications where user_id = ${U.ops.id} and alert_code = 'AL-07' and record_id = currval('cost_forecast_snapshots_id_seq'));
    rollback;`).split('\n').find(l => l.startsWith('eac|'))?.split('|') ?? [];
  const e1 = eacProbe(120), e2 = eacProbe(105);
  check('AL-07: the latest approved forecast with EAC more than the company\'s percentage (10) over budget is alerted; 5 % over is not', e1[2] === '1' && e2[2] === '0', `${e1.join('|')} / ${e2.join('|')}`);

  // --- Read state, own records only, other company.
  const cnt = async (u) => must(await api('GET', '/notifications/count', u.token), 'count').unread;
  const c0 = await cnt(U.qa);
  const first = q.find(n => !n.is_read);
  const read = must(await api('POST', `/notifications/${first.id}/read`, U.qa.token), 'read');
  check('a notification marked read records when; the unread count drops by one', read.is_read === true && !!read.read_at && await cnt(U.qa) === c0 - 1, `${c0} -> ${await cnt(U.qa)}`);
  await expectStatus('a user cannot mark another user\'s notification', () => api('POST', `/notifications/${first.id}/read`, U.col.token), 404);
  must(await api('POST', '/notifications/read-all', U.qa.token), 'read all');
  check('mark all as read leaves no unread notification', await cnt(U.qa) === 0);
  const unreadList = must(await api('GET', '/notifications?unread=true', U.qa.token), 'unread list');
  check('the unread view lists nothing after mark-all', unreadList.length === 0);
  const b = await login(ADMIN_B);
  const bList = must(await api('GET', '/notifications?unread=false&limit=200', b), 'b list');
  check('another company\'s users never receive this company\'s alerts', !bList.some(n => ['approval_instances', 'ncrs', 'incidents'].includes(n.record_table) && [String(approval.id), String(oldNcr.id), String(after.id)].includes(String(n.record_id))));
  // Switching an alert off stops new alerts of that kind.
  must(await api('PUT', '/notifications/alert-rules/AL-11', admin, { enabled: false, threshold: 5, recipient_role_ids: [qa] }), 'al-11 off');
  fixture('ncrs', newNcr.id, 'raised_date', 'current_date - 10');
  await evaluate();
  check('an alert switched off raises nothing new', !(await mine(U.qa)).some(n => n.alert_code === 'AL-11' && String(n.record_id) === String(newNcr.id)));
  const audit = one(`select count(*) from audit_log where table_name = 'alert_rules' and org_id = ${ADMIN.org_id}`);
  check('alert settings changes are in the audit trail', Number(audit) >= 8, audit);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
} finally {
  for (const s of restore.reverse()) { try { one(s); } catch (e) { console.error('restore failed:', s, e.message); } }
}
finish('sweep_alerts');
