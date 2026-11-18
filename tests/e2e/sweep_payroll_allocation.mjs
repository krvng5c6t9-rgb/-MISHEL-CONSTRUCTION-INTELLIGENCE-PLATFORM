// CC-094 / Stage 65 (F-68, migration 099): payroll cost to projects by approved timesheet hours, as a company setting.
// The company has not chosen (the line's project is used); finance.manage is needed to choose; with 'timesheet_hours'
// an approved line's gross pay is split over the employee's approved timesheet hours of the month by project and cost
// code (draft timesheets ignored), shares rounded to 2 decimals with the remainder on the largest share so they add up
// exactly; one cost transaction per share; refused without approved hours or with a timesheet lacking a cost code;
// never posted twice; allocations permanent; isolation. The payroll run is approved through the DOA cycle configured
// by sweep_hr_payroll (its approver role). Amounts and hours are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const PERIOD = '2031-06-01';
try {
  const admin = await login(ADMIN);
  const roleId = Number(one(`select approver_role_id from delegation_of_authority where org_id = ${ADMIN.org_id} and module = 'payroll_run' and is_active and is_confirmed order by id limit 1`));
  const mk = async (key, rid) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: rid, full_name: `PA ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const A = await mk('pa1', roleId), B = await mk('pa2', roleId);
  const hrOnlyRole = must(await api('POST', '/roles', admin, { role_name: `PA hr ${TAG}`, permissions: [['hr', 'view'], ['finance', 'view']].map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
  const viewer = await mk('pa3', hrOnlyRole);
  const [p1, p2] = one(`select id from projects where org_id = ${ADMIN.org_id} and project_code in ('P-${TAG}', 'HR-${TAG}') order by project_code`).split('\n').map(Number);
  const [ca, cb] = one(`select id from cost_codes where org_id = ${ADMIN.org_id} order by id limit 2`).split('\n').map(Number);
  const emp = async (code) => must(await api('POST', '/hr/employees', A, { employee_code: `${code}-${TAG}`, full_name: `${code} ${TAG}`, hire_date: '2030-01-01', employment_type: 'staff' }), code);
  const E = await emp('PAE'), F = await emp('PAF'), G = await emp('PAG');
  const ts = async (e, project_id, cost_code_id, work_date, hours, approve = true) => {
    const t = must(await api('POST', '/hr/timesheets', A, { employee_id: e.id, project_id, ...(cost_code_id ? { cost_code_id } : {}), work_date, hours }), 'timesheet');
    if (approve) must(await api('PATCH', `/hr/timesheets/${t.id}/approve`, B), 'approve timesheet');
    return t;
  };
  await ts(E, p1, ca, '2031-06-03', 10); await ts(E, p1, cb, '2031-06-04', 10); await ts(E, p2, ca, '2031-06-05', 10);
  await ts(E, p2, cb, '2031-06-06', 8, false);            // draft: not counted
  await ts(E, p1, ca, '2031-07-02', 8);                    // next month: not counted
  await ts(G, p1, null, '2031-06-03', 8);                  // approved without a cost code

  // --- Setting.
  const s0 = must(await api('GET', '/hr/payroll-settings', viewer), 'settings');
  check('the company has not chosen: the payroll line\'s own project is used', s0.cost_basis === null && s0.effective_basis === 'line_project');
  await expectStatus('choosing the basis needs finance.manage', () => api('PUT', '/hr/payroll-settings', viewer, { cost_basis: 'timesheet_hours' }), 403);
  await expectStatus('an unknown basis is refused', () => api('PUT', '/hr/payroll-settings', admin, { cost_basis: 'headcount' }), 400);
  must(await api('PUT', '/hr/payroll-settings', admin, { cost_basis: 'timesheet_hours' }), 'choose');
  check('the company chooses timesheet hours (recorded with who)', must(await api('GET', '/hr/payroll-settings', viewer), 's1').cost_basis === 'timesheet_hours');

  // --- Approved payroll run with three lines.
  const run = must(await api('POST', '/hr/payroll-runs', A, { period_month: PERIOD }), 'run');
  const line = async (e, basic) => must(await api('POST', `/hr/payroll-runs/${run.id}/lines`, A, { currency_id: 1, employee_id: e.id, basic, overtime: 0, allowances: 0, deductions: 0 }), 'line');
  const lE = await line(E, 1000), lF = await line(F, 500), lG = await line(G, 700);
  await expectStatus('a line of a run not yet approved is not allocated', () => api('POST', `/hr/payroll-lines/${lE.id}/post-cost`, A), 422);
  const ap = must(await api('PATCH', `/hr/payroll-runs/${run.id}/approve`, A), 'submit').approval;
  check('payroll run approved through its DOA by the second person', must(await api('POST', `/approvals/${ap.id}/actions`, B, { action: 'approved', comment: 'ok' }), 'approve').finalization?.record?.status === 'approved');

  // --- Allocation.
  const r = must(await api('POST', `/hr/payroll-lines/${lE.id}/post-cost`, A), 'allocate');
  check('the line is split over its approved (project, cost code) hours of the month: three shares (draft and next-month timesheets ignored)', r.basis === 'timesheet_hours' && r.shares === 3, JSON.stringify(r).slice(0, 300));
  const shares = r.allocations.map(a => `${a.project_id}/${a.cost_code_id}:${a.hours}:${a.amount}`).sort();
  // Tie on hours: the remainder goes to the lowest project id, then the lowest cost code (ca < cb).
  const target = `${Math.min(p1, p2)}/${ca}`;
  const expected = [`${p1}/${ca}`, `${p1}/${cb}`, `${p2}/${ca}`].map(k => `${k}:10.00:${k === target ? '333.34' : '333.33'}`).sort();
  check('1,000.00 over 10 / 10 / 10 hours: 333.33 each, the 0.01 remainder on the first of the tied largest shares (lowest project, then cost code)', JSON.stringify(shares) === JSON.stringify(expected), `${shares} / ${expected}`);
  check('the shares add up exactly to the gross pay', one(`select sum(amount)::text from payroll_line_allocations where payroll_line_id = ${lE.id}`) === '1000.00');
  check('each share is one actual cost transaction of the same amount on its project and cost code',
    one(`select count(*) from payroll_line_allocations a join cost_transactions c on c.id = a.cost_transaction_id
      where a.payroll_line_id = ${lE.id} and c.amount = a.amount and c.project_id = a.project_id and c.cost_code_id = a.cost_code_id and c.transaction_type = 'actual'
      and c.source_table = 'payroll_line_allocations' and c.source_record_id = a.id`) === '3');
  await expectStatus('a line is never allocated twice', () => api('POST', `/hr/payroll-lines/${lE.id}/post-cost`, A), 422);
  await expectStatus('a line without approved hours in the month is refused (nothing assumed)', () => api('POST', `/hr/payroll-lines/${lF.id}/post-cost`, A), 422);
  await expectStatus('a line whose approved timesheets lack a cost code is refused', () => api('POST', `/hr/payroll-lines/${lG.id}/post-cost`, A), 422);
  check('refused lines leave no allocation and no cost', one(`select count(*) from payroll_line_allocations where payroll_line_id in (${lF.id}, ${lG.id})`) === '0'
    && one(`select count(*) from cost_transactions where source_table = 'payroll_lines' and source_record_id in (${lF.id}, ${lG.id})`) === '0');
  { const y = sql(OWNER, `insert into cost_transactions (project_id, cost_code_id, source_module, source_table, source_record_id, transaction_type, amount, currency_id, transaction_date)
      select project_id, cost_code_id, 'hr_payroll', 'payroll_line_allocations', id, 'actual', amount + 1, 1, current_date from payroll_line_allocations where payroll_line_id = ${lE.id} order by id limit 1`);
    check('DB: a second or different posting of an allocation is refused', !y.ok && /already posted|must equal/.test(y.out), y.out.slice(0, 160)); }
  const list = must(await api('GET', `/hr/payroll-lines/${lE.id}/allocations`, viewer), 'allocations');
  check('the allocation of a line is listed with its projects and cost codes', list.length === 3 && list.every(a => a.project_code && a.cost_code));
  { const x = sql(OWNER, `delete from payroll_line_allocations where payroll_line_id = ${lE.id}`); check('DB: allocations are permanent', !x.ok && /permanent/.test(x.out), x.out.slice(0, 120)); }
  check('the allocation is audited', Number(one(`select count(*) from audit_log where table_name = 'payroll_line_allocations' and org_id = ${ADMIN.org_id}`)) >= 3);
  const adminB = await login(ADMIN_B);
  check('the other company sees no allocation of this line', must(await api('GET', `/hr/payroll-lines/${lE.id}/allocations`, adminB), 'B').length === 0);

  // Back to the line's project for the rest of the gate.
  must(await api('PUT', '/hr/payroll-settings', admin, { cost_basis: 'line_project' }), 'restore');
  check('switched back, the basis is the line\'s project again', must(await api('GET', '/hr/payroll-settings', viewer), 's2').effective_basis === 'line_project');
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_payroll_allocation');
