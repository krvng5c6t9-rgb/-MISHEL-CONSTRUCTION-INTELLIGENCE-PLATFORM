// CC-093 / Stage 64 (A-006, migration 098): site attendance. Employees of a project (daily-wage labour and staff) are
// recorded on a day sheet in bulk; the database refuses a terminated employee, a date before hiring, hours above 24
// (with overtime), hours on an absence, a present day without hours, "leave" without an approved leave and "present"
// during one; another person approves the day (refused for the recorder, also when holding every permission); an
// approved record never changes; the labour summary of a period is checked against independent SQL, including the
// attendance / timesheet differences; company isolation. Employees and hours are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const probe = (name, text, re) => { const r = sql(OWNER, text); check(name, !r.ok && re.test(r.out), r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 160)); };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkUser = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `AT ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `AT ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const rec = await mkUser('atrec', [['hr', 'view'], ['hr', 'create'], ['hr', 'edit']]);
  const sup = await mkUser('atsup', [['hr', 'view'], ['hr', 'approve']]);
  const viewer = await mkUser('atview', [['hr', 'view']]);
  const projectId = Number(one(`select id from projects where project_code = 'P-${TAG}'`));
  const mkEmp = async (code, type, hire) => must(await api('POST', '/hr/employees', rec, { employee_code: `${code}-${TAG}`, full_name: `${code} ${TAG}`, employment_type: type, hire_date: hire, primary_project_id: projectId }), `employee ${code}`);
  const w1 = await mkEmp('AW1', 'daily_wage', day(-60)), w2 = await mkEmp('AW2', 'daily_wage', day(-60)), st = await mkEmp('AST', 'staff', day(-60));
  const late = await mkEmp('ALT', 'labor', day(-2)), gone = await mkEmp('AGN', 'labor', day(-60)), aad = await mkEmp('AAD', 'labor', day(-60));
  must(await api('PATCH', `/hr/employees/${gone.id}/status`, rec, { employment_status: 'terminated', termination_date: day(-5) }), 'terminate');
  const lv = must(await api('POST', '/hr/leave-requests', rec, { employee_id: st.id, leave_type: 'annual', from_date: day(-4), to_date: day(-3) }), 'leave');
  must(await api('PATCH', `/hr/leave-requests/${lv.id}/approve`, sup), 'approve leave');
  const D = day(-3), D2 = day(-1);

  // --- Day sheet and bulk entry.
  const sheet0 = must(await api('GET', `/hr/attendance/sheet?project_id=${projectId}&date=${D}`, viewer), 'sheet');
  check('the day sheet lists the project\'s active employees (terminated excluded) with leave flagged',
    [w1.id, w2.id, st.id, late.id].every(id => sheet0.some(r => r.employee_id === id)) && !sheet0.some(r => r.employee_id === gone.id) && sheet0.find(r => r.employee_id === st.id)?.on_leave === true,
    sheet0.map(r => `${r.employee_code}:${r.on_leave}`).join(','));
  const saved = must(await api('POST', '/hr/attendance/bulk', rec, { project_id: projectId, date: D, rows: [
    { employee_id: w1.id, status: 'present', hours_worked: 8, overtime_hours: 2 }, { employee_id: w2.id, status: 'absent' }, { employee_id: st.id, status: 'leave' }] }), 'bulk');
  check('the sheet is saved in one go: present with overtime, absent, leave (approved leave)', saved.length === 3 && saved.every(r => Number(r.recorded_by) > 0 && r.approved_by === null));
  await expectStatus('recording needs hr.create', () => api('POST', '/hr/attendance/bulk', viewer, { project_id: projectId, date: D, rows: [{ employee_id: w2.id, status: 'absent' }] }), 403);
  await expectStatus('an employee twice in one sheet is refused', () => api('POST', '/hr/attendance/bulk', rec, { project_id: projectId, date: D2, rows: [{ employee_id: w1.id, status: 'absent' }, { employee_id: w1.id, status: 'absent' }] }), 422);
  await expectStatus('a terminated employee after the termination date is refused', () => api('POST', '/hr/attendance', rec, { employee_id: gone.id, project_id: projectId, attendance_date: D, status: 'present', hours_worked: 8 }), 422);
  await expectStatus('a date before hiring is refused', () => api('POST', '/hr/attendance', rec, { employee_id: late.id, project_id: projectId, attendance_date: day(-10), status: 'present', hours_worked: 8 }), 422);
  await expectStatus('more than 24 hours with overtime is refused', () => api('POST', '/hr/attendance', rec, { employee_id: w2.id, project_id: projectId, attendance_date: D2, status: 'present', hours_worked: 20, overtime_hours: 6 }), 422);
  await expectStatus('a present day without hours is refused', () => api('POST', '/hr/attendance', rec, { employee_id: w2.id, project_id: projectId, attendance_date: D2, status: 'present' }), 422);
  await expectStatus('"leave" without an approved leave is refused', () => api('POST', '/hr/attendance', rec, { employee_id: w2.id, project_id: projectId, attendance_date: D2, status: 'leave' }), 422);
  await expectStatus('"present" during an approved leave is refused', () => api('POST', '/hr/attendance', rec, { employee_id: st.id, project_id: projectId, attendance_date: day(-4), status: 'present', hours_worked: 8 }), 422);
  probe('DB: hours on an absence are refused', `update attendance set hours_worked = 4 where employee_id = ${w2.id} and attendance_date = '${D}'`, /no hours/);
  const bProject = one(`select id from projects where org_id <> ${ADMIN.org_id} order by id limit 1`);
  await expectStatus('a project of another company is refused', () => api('POST', '/hr/attendance', rec, { employee_id: w2.id, project_id: Number(bProject), attendance_date: D2, status: 'absent' }), 422);
  const re = must(await api('POST', '/hr/attendance', rec, { employee_id: w1.id, project_id: projectId, attendance_date: D, status: 'present', hours_worked: 9, overtime_hours: 1 }), 're-entry');
  check('an unapproved record is corrected by re-entry', re.hours_worked === '9.00' && re.overtime_hours === '1.00');

  // --- Approval of the day.
  await expectStatus('approving needs hr.approve', () => api('POST', '/hr/attendance/approve', rec, { project_id: projectId, date: D }), 403);
  must(await api('POST', '/hr/attendance', admin, { employee_id: aad.id, project_id: projectId, attendance_date: D, status: 'present', hours_worked: 8 }), 'admin records');
  const ap = must(await api('POST', '/hr/attendance/approve', admin, { project_id: projectId, date: D }), 'admin approves');
  check('SoD: a user holding every permission approves the others\' records but not the one they recorded', ap.approved === 3 && ap.still_unapproved === 1, JSON.stringify(ap));
  await expectStatus('SoD: approving only one\'s own records is refused', () => api('POST', '/hr/attendance/approve', admin, { project_id: projectId, date: D }), 403);
  const ap2 = must(await api('POST', '/hr/attendance/approve', sup, { project_id: projectId, date: D }), 'supervisor approves');
  check('another supervisor approves the remaining record', ap2.approved === 1 && ap2.still_unapproved === 0);
  await expectStatus('an approved record is not changed by re-entry', () => api('POST', '/hr/attendance', rec, { employee_id: w1.id, project_id: projectId, attendance_date: D, status: 'present', hours_worked: 4 }), 422);
  probe('DB: an approved record is never deleted', `delete from attendance where employee_id = ${w1.id} and attendance_date = '${D}'`, /never deleted/);
  must(await api('POST', '/hr/attendance', rec, { employee_id: w2.id, project_id: projectId, attendance_date: D2, status: 'absent' }), 'w2 on D2');
  probe('DB: approval by the recorder is refused by the database', `update attendance set approved_by = recorded_by, approved_at = now() where employee_id = ${w2.id} and attendance_date = '${D2}'`, /check constraint/);
  const sheet1 = must(await api('GET', `/hr/attendance/sheet?project_id=${projectId}&date=${D}`, viewer), 'sheet after');
  check('the sheet shows who recorded and who approved', sheet1.find(r => r.employee_id === w1.id)?.approved_by_name === 'Admin A' && sheet1.find(r => r.employee_id === aad.id)?.approved_by_name === 'AT atsup');

  // --- Labour summary against independent SQL; differences with timesheets.
  must(await api('POST', '/hr/timesheets', rec, { employee_id: w1.id, project_id: projectId, work_date: D, hours: 6 }), 'timesheet w1');
  const ts = must(await api('POST', '/hr/timesheets', rec, { employee_id: w2.id, project_id: projectId, work_date: D, hours: 3 }), 'timesheet w2');
  for (const id of [ts.id, Number(one(`select id from timesheets where employee_id = ${w1.id} and work_date = '${D}'`))]) must(await api('PATCH', `/hr/timesheets/${id}/approve`, sup), 'approve timesheet');
  const sm = must(await api('GET', `/hr/labour-summary?project_id=${projectId}&from=${day(-7)}&to=${day(0)}`, viewer), 'summary');
  const [pres, abs, lea, wk, hrs, ot, tsh, cost] = one(`select count(*) filter (where status in ('present','overtime')), count(*) filter (where status = 'absent'), count(*) filter (where status = 'leave'),
      count(distinct employee_id), coalesce(sum(hours_worked), 0)::text, coalesce(sum(overtime_hours), 0)::text,
      (select coalesce(sum(hours), 0)::text from timesheets where project_id = ${projectId} and status = 'approved' and work_date between '${day(-7)}' and '${day(0)}'),
      (select coalesce(sum(ct.project_amount), 0)::text from cost_transactions ct join cost_codes cc on cc.id = ct.cost_code_id where ct.project_id = ${projectId} and ct.transaction_type = 'actual' and cc.cost_type = 'labor' and ct.transaction_date between '${day(-7)}' and '${day(0)}')
    from attendance where project_id = ${projectId} and attendance_date between '${day(-7)}' and '${day(0)}'`).split('|');
  check('labour summary: man-days present / absent / leave, workers, hours, overtime, approved timesheet hours and labour cost are the database figures',
    String(sm.days_present) === pres && String(sm.days_absent) === abs && String(sm.days_leave) === lea && String(sm.workers) === wk && sm.hours === hrs && sm.overtime_hours === ot && sm.timesheet_hours === tsh && sm.labour_cost === cost,
    `${JSON.stringify(sm).slice(0, 260)} / ${pres} ${abs} ${lea} ${wk} ${hrs} ${ot} ${tsh} ${cost}`);
  const d1 = sm.differences.find(d => d.employee_id === w1.id && d.date === D), d2 = sm.differences.find(d => d.employee_id === w2.id && d.date === D);
  check('differences: 10 attendance hours (9 + 1 overtime) against 6 timesheet hours, and 3 timesheet hours on an absence', d1?.attendance_hours === '10.00' && d1?.timesheet_hours === '6.00' && d2?.attendance_hours === '0.00' && d2?.timesheet_hours === '3.00',
    JSON.stringify(sm.differences.filter(d => [w1.id, w2.id].includes(d.employee_id))));
  await expectStatus('a period ending before it starts is refused', () => api('GET', `/hr/labour-summary?project_id=${projectId}&from=${day(0)}&to=${day(-7)}`, viewer), 422);

  // --- Isolation and audit.
  const adminB = await login(ADMIN_B);
  check('the other company\'s sheet of this project is empty', must(await api('GET', `/hr/attendance/sheet?project_id=${projectId}&date=${D}`, adminB), 'B sheet').length === 0);
  await expectStatus('the other company cannot record this company\'s employee', () => api('POST', '/hr/attendance', adminB, { employee_id: w2.id, attendance_date: D2, status: 'absent' }), 422);
  check('attendance changes are audited', Number(one(`select count(*) from audit_log where table_name = 'attendance' and org_id = ${ADMIN.org_id}`)) >= 5);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_attendance');
