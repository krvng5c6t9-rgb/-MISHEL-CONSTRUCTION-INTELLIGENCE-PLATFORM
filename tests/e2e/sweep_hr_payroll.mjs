// RK-003 sweep / GC-37 HR, time and payroll: first runtime execution. Users hold all relevant permissions so that
// only integrity and segregation-of-duties rules can stop them. Salaries, hours and periods are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const PERIOD = '2031-03-01'; // fixture period far from other suites (unique per org)
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `HR ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const hrAll = await mkRole('HR All', [['hr', 'view'], ['hr', 'create'], ['hr', 'edit'], ['hr', 'approve'], ['finance', 'view'], ['finance', 'create'], ['approvals', 'view'], ['approvals', 'approve']]);
  const H = { a: await mkUser('hra', hrAll), b: await mkUser('hrb', hrAll) };
  const conf = await mkUser('hrconf', await mkRole('HR DOA Conf', [['admin', 'view'], ['admin', 'approve']]));
  if (!must(await api('GET', '/approvals/configuration/doa', admin), 'doa').some(d => d.module === 'payroll_run' && d.is_active && d.is_confirmed && Number(d.approver_role_id) === hrAll)) {
    const d = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'payroll_run', min_amount: 0, approval_level: 1, approver_role_id: hrAll, notes: 'TEST FIXTURE' }), 'doa');
    must(await api('POST', `/approvals/configuration/doa/${d.id}/confirm`, conf), 'doa confirm');
  }
  const project = must(await api('POST', '/projects', admin, { project_code: `HR-${TAG}`, project_name: `HR ${TAG}`, currency_id: 1 }), 'project').id;
  const emp = async (code, extra = {}) => must(await api('POST', '/hr/employees', H.a, { employee_code: `${code}-${TAG}`, full_name: `Emp ${code}`, hire_date: '2025-01-01', employment_type: 'staff', basic_salary: 10000, ...extra }), `emp ${code}`);
  const e1 = await emp('E1'), e2 = await emp('E2'), e3 = await emp('E3');
  const tb = await login(ADMIN_B);
  const eB = must(await api('POST', '/hr/employees', tb, { employee_code: `EB-${TAG}`, full_name: 'Tenant B employee', hire_date: '2025-01-01' }), 'emp B');

  // --- Employee master.
  await expectStatus('termination without a termination date refused', () => api('PATCH', `/hr/employees/${e2.id}/status`, H.a, { employment_status: 'terminated' }), 400);
  await expectStatus('termination dated before hire refused', () => api('PATCH', `/hr/employees/${e2.id}/status`, H.a, { employment_status: 'terminated', termination_date: '2024-12-31' }), 422);
  await run('E2 terminated end of January 2031', async () => must(await api('PATCH', `/hr/employees/${e2.id}/status`, H.a, { employment_status: 'terminated', termination_date: '2031-01-31' }), 'term'));
  await expectStatus('tenant B cannot change a tenant A employee', () => api('PATCH', `/hr/employees/${e1.id}/status`, tb, { employment_status: 'on_leave' }), 404);

  // --- Payroll run lines.
  const pr = await run('payroll run created', async () => must(await api('POST', '/hr/payroll-runs', H.a, { period_month: PERIOD }), 'run'));
  await expectStatus('second run for the same period refused', () => api('POST', '/hr/payroll-runs', H.a, { period_month: PERIOD }), 409);
  await expectStatus('period must be the first day of a month', () => api('POST', '/hr/payroll-runs', H.a, { period_month: '2031-04-15' }), 422);
  const line = (body) => api('POST', `/hr/payroll-runs/${pr.id}/lines`, H.a, { currency_id: 1, ...body });
  const l1 = await run('line for E1 (10,000 + 500 OT + 1,000 allowances - 1,500 deductions)', async () => must(await line({ employee_id: e1.id, project_id: project, cost_code_id: 2, basic: 10000, overtime: 500, allowances: 1000, deductions: 1500 }), 'l1'));
  check('net pay computed in DB = 10,000', Number(l1.net_pay) === 10000, String(l1.net_pay));
  await expectStatus('same employee twice in one run refused', () => line({ employee_id: e1.id, basic: 1 }), 409);
  await expectStatus('negative net pay refused', () => line({ employee_id: e3.id, basic: 1000, deductions: 5000 }), 422);
  await expectStatus('employee terminated before the period cannot be paid', () => line({ employee_id: e2.id, basic: 10000 }), 422);
  await expectStatus('employee of another tenant cannot be put on this payroll', () => line({ employee_id: eB.id, basic: 10000 }), 422);
  must(await line({ employee_id: e3.id, basic: 8000 }), 'l3 overhead');

  // --- Submission freezes the run; approval by a second person.
  const pa = await run('payroll run submitted for approval', async () => must(await api('PATCH', `/hr/payroll-runs/${pr.id}/approve`, H.a), 'submit').approval);
  check('approval amount = sum of gross pay (19,500, DEC-013)', Number(pa.amount) === 19500, String(pa.amount));
  await expectStatus('lines cannot be added once submitted', () => line({ employee_id: e2.id, basic: 1 }), 422);
  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: submitted payroll line amounts frozen', `update payroll_lines set basic=99999 where id=${l1.id}`);
    probe('DB: submitted payroll lines cannot be deleted', `delete from payroll_lines where id=${l1.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);
  await expectStatus('submitter cannot approve own payroll (SoD)', () => api('POST', `/approvals/${pa.id}/actions`, H.a, { action: 'approved', comment: 'self' }), 403);
  const ok = await run('second HR user approves', async () => must(await api('POST', `/approvals/${pa.id}/actions`, H.b, { action: 'approved', comment: 'ok' }), 'appr'));
  check('payroll run approved', ok.finalization?.record?.status === 'approved');
  await expectStatus('lines cannot be added after approval', () => line({ employee_id: e2.id, basic: 1 }), 422);
  const ct = await run('project payroll line posted to cost', async () => must(await api('POST', `/hr/payroll-lines/${l1.id}/post-cost`, H.a), 'post'));
  // DEC-013 (owner decision 2026-10-09): labour cost = gross pay 11,500 (10,000 + 500 + 1,000); deductions 1,500 are a liability.
  check('posted payroll cost is the gross pay 11,500 (DEC-013), not the net 10,000', Number(ct.amount) === 11500, String(ct.amount));
  const coa = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const labour = await coa('5200', 'Site labour cost (fixture)', 'expense'), netPay = await coa('2400', 'Salaries payable (fixture)', 'liability'), dedPay = await coa('2410', 'Payroll deductions payable (fixture)', 'liability');
  await expectStatus('GL posting of a payroll cost with deductions needs a deductions rule', async () => {
    must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: 'cost_transaction', source_subtype: 'hr_payroll', debit_account_id: labour, credit_account_id: netPay, notes: 'TEST FIXTURE' }), 'payroll rule');
    return api('POST', `/finance/cost-transactions/${ct.id}/post-gl`, admin);
  }, 422);
  must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: 'cost_transaction', source_subtype: 'payroll_deductions', debit_account_id: labour, credit_account_id: dedPay, notes: 'TEST FIXTURE' }), 'deductions rule');
  const gl = await run('payroll cost posted to GL', async () => must(await api('POST', `/finance/cost-transactions/${ct.id}/post-gl`, admin), 'post gl'));
  check('GL batches returned for net pay and deductions', !!gl.deductions_gl, JSON.stringify(Object.keys(gl)));
  if (OWNER) {
    const sum = (acct, col) => sql(OWNER, `select coalesce(sum(${col}),0) from general_ledger where source_table='cost_transactions' and source_record_id=${ct.id} and account_id=${acct}`).out.trim();
    check('GL: labour cost debited 11,500; salaries payable credited 10,000; deductions payable credited 1,500', sum(labour, 'debit') === '11500.00' && sum(netPay, 'credit') === '10000.00' && sum(dedPay, 'credit') === '1500.00', `${sum(labour, 'debit')} / ${sum(netPay, 'credit')} / ${sum(dedPay, 'credit')}`);
  }
  await expectStatus('payroll line cannot be posted twice', () => api('POST', `/hr/payroll-lines/${l1.id}/post-cost`, H.a), 409);

  // --- Return for correction (CC-027 path on payroll): back to draft, editable, resubmittable.
  const pr2 = must(await api('POST', '/hr/payroll-runs', H.a, { period_month: '2031-04-01' }), 'run2');
  must(await api('POST', `/hr/payroll-runs/${pr2.id}/lines`, H.a, { currency_id: 1, employee_id: e3.id, basic: 8000 }), 'r2 line');
  const pa2 = must(await api('PATCH', `/hr/payroll-runs/${pr2.id}/approve`, H.a), 'r2 submit').approval;
  const back = await run('approver returns April payroll with a reason', async () => must(await api('POST', `/approvals/${pa2.id}/actions`, H.b, { action: 'returned', comment: 'E1 missing from April (fixture)' }), 'r2 return'));
  check('returned payroll run is draft again', back.finalization?.record?.status === 'draft');
  await run('missing line added after return', async () => must(await api('POST', `/hr/payroll-runs/${pr2.id}/lines`, H.a, { currency_id: 1, employee_id: e1.id, basic: 10000 }), 'r2 line2'));
  const pa3 = await run('corrected run resubmitted', async () => must(await api('PATCH', `/hr/payroll-runs/${pr2.id}/approve`, H.a), 'r2 resubmit').approval);
  check('resubmitted amount includes the correction (18,000)', Number(pa3.amount) === 18000 && pa3.id !== pa2.id, String(pa3.amount));

  // --- Timesheets.
  const ts = (tok, body) => api('POST', '/hr/timesheets', tok, { project_id: project, cost_code_id: 2, ...body });
  const t1 = await run('timesheet 10h for E1', async () => must(await ts(H.a, { employee_id: e1.id, work_date: '2031-03-10', hours: 10 }), 't1'));
  await expectStatus('more than 24 hours for one employee on one day refused', () => ts(H.a, { employee_id: e1.id, work_date: '2031-03-10', hours: 15 }), 422);
  await expectStatus('timesheet after termination refused', () => ts(H.a, { employee_id: e2.id, work_date: '2031-03-10', hours: 8 }), 422);
  await expectStatus('timesheet before hire refused', () => ts(H.a, { employee_id: e1.id, work_date: '2024-06-01', hours: 8 }), 422);
  await expectStatus('maker cannot approve own timesheet (SoD)', () => api('PATCH', `/hr/timesheets/${t1.id}/approve`, H.a), 409);
  await run('second user approves timesheet', async () => must(await api('PATCH', `/hr/timesheets/${t1.id}/approve`, H.b), 'tappr'));
  if (OWNER) {
    const r = sql(OWNER, `update timesheets set hours=1 where id=${t1.id}`);
    check('DB: approved timesheet immutable', !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120));
  }

  // --- Leave.
  const lv = await run('E1 annual leave 2031-03-20..22', async () => must(await api('POST', '/hr/leave-requests', H.a, { employee_id: e1.id, leave_type: 'annual', from_date: '2031-03-20', to_date: '2031-03-22' }), 'lv'));
  await expectStatus('overlapping leave for the same employee refused', () => api('POST', '/hr/leave-requests', H.a, { employee_id: e1.id, leave_type: 'sick', from_date: '2031-03-22', to_date: '2031-03-25' }), 422);
  await expectStatus('leave ending before it starts refused', () => api('POST', '/hr/leave-requests', H.a, { employee_id: e1.id, leave_type: 'annual', from_date: '2031-05-02', to_date: '2031-05-01' }), 422);
  await expectStatus('requester cannot decide own leave (SoD)', () => api('PATCH', `/hr/leave-requests/${lv.id}/approve`, H.a), 409);
  await run('second user approves leave', async () => must(await api('PATCH', `/hr/leave-requests/${lv.id}/approve`, H.b), 'lappr'));
  const lvB = must(await api('GET', '/hr/leave-requests', tb), 'leave B');
  check('tenant B does not see tenant A leave requests', !lvB.some(x => Number(x.id) === Number(lv.id)));
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_hr_payroll');
