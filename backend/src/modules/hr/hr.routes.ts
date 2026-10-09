import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { postPayrollLineToCostTransaction, postPayrollOverheadToGl } from '../../services/phase5Posting.service.js';
import { createApprovalInstance } from '../../services/approval.service.js';
import { AppError } from '../../middleware/errors.js';

export const hrRouter = Router();
hrRouter.use(authorize('hr', 'view'));

const employeeSchema = z.object({
  org_id: z.number().int().positive().optional(),
  department_id: z.number().int().positive().optional(),
  employee_code: z.string().min(1).max(30),
  full_name: z.string().min(1).max(150),
  job_title: z.string().max(100).optional(),
  national_id: z.string().max(30).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  hire_date: z.string().optional(),
  employment_type: z.enum(['staff','labor','daily_wage']).optional(),
  basic_salary: z.number().nonnegative().optional(),
  primary_project_id: z.number().int().positive().optional()
});

hrRouter.get('/employees', asyncHandler(async (req, res) => {
  const orgId = req.user!.org_id;
  const rows = await query(`
    select e.*, d.department_name, p.project_code as primary_project_code, p.project_name as primary_project_name
    from employees e
    left join departments d on d.id = e.department_id
    left join projects p on p.id = e.primary_project_id
    where e.org_id = $1
    order by e.full_name
    limit 500
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

hrRouter.post('/employees', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = employeeSchema.parse(req.body);
  const orgId = req.user!.org_id;
  const [created] = await query(`
    insert into employees
      (org_id, department_id, employee_code, full_name, job_title, national_id, phone, email, hire_date,
       employment_type, basic_salary, primary_project_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    returning *
  `, [orgId, b.department_id ?? null, b.employee_code, b.full_name, b.job_title ?? null, b.national_id ?? null,
      b.phone ?? null, b.email ?? null, b.hire_date ?? null, b.employment_type ?? null, b.basic_salary ?? null,
      b.primary_project_id ?? null]);
  res.status(201).json({ success: true, data: created });
}));

hrRouter.patch('/employees/:id/status', authorize('hr', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ employment_status: z.enum(['active','on_leave','terminated']), termination_date: z.string().optional() })
    .refine(v => v.employment_status !== 'terminated' || !!v.termination_date, { message: 'Termination requires termination_date', path: ['termination_date'] })
    .parse(req.body);
  const [updated] = await query(`update employees set employment_status=$2, termination_date=$3, updated_at=now() where id=$1 and org_id=$4 returning *`, [Number(req.params.id), b.employment_status, b.termination_date ?? null, req.user!.org_id]);
  if (!updated) throw new AppError(404, 'Employee not found');
  res.json({ success: true, data: updated });
}));

hrRouter.get('/attendance', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`
    select a.*, e.full_name, e.employee_code
    from attendance a
    join employees e on e.id = a.employee_id
    where ($1::bigint = 0 or a.project_id = $1)
    order by a.attendance_date desc, e.full_name
    limit 500
  `, [projectId]);
  res.json({ success: true, data: rows });
}));

hrRouter.post('/attendance', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ employee_id: z.number().int().positive(), project_id: z.number().int().positive().optional(), attendance_date: z.string(), status: z.enum(['present','absent','leave','overtime']), hours_worked: z.number().nonnegative().optional() }).parse(req.body);
  const [created] = await query(`
    insert into attendance (employee_id, project_id, attendance_date, status, hours_worked)
    values ($1,$2,$3,$4,$5)
    on conflict (employee_id, attendance_date) do update set project_id=excluded.project_id, status=excluded.status, hours_worked=excluded.hours_worked
    returning *
  `, [b.employee_id, b.project_id ?? null, b.attendance_date, b.status, b.hours_worked ?? null]);
  res.status(201).json({ success: true, data: created });
}));

hrRouter.get('/timesheets', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`
    select t.*, e.full_name, cc.code as cost_code, sa.activity_id_ext as activity_code
    from timesheets t
    join employees e on e.id = t.employee_id
    left join cost_codes cc on cc.id = t.cost_code_id
    left join schedule_activities sa on sa.id = t.activity_ref
    where ($1::bigint = 0 or t.project_id = $1)
    order by t.work_date desc, t.id desc
    limit 500
  `, [projectId]);
  res.json({ success: true, data: rows });
}));

hrRouter.post('/timesheets', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ employee_id: z.number().int().positive(), project_id: z.number().int().positive(), cost_code_id: z.number().int().positive().optional(), work_date: z.string(), hours: z.number().positive(), activity_ref: z.number().int().positive().optional() }).parse(req.body);
  if (!req.user) throw new AppError(401, 'Authentication required');
  const [created] = await query(`
    insert into timesheets (employee_id, project_id, cost_code_id, work_date, hours, activity_ref, created_by)
    values ($1,$2,$3,$4,$5,$6,$7)
    returning *
  `, [b.employee_id, b.project_id, b.cost_code_id ?? null, b.work_date, b.hours, b.activity_ref ?? null, req.user.id]);
  res.status(201).json({ success: true, data: created });
}));

hrRouter.patch('/timesheets/:id/approve', authorize('hr', 'approve'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const [updated] = await query(`
    update timesheets
       set status='approved', approved_by=$2, updated_at=now()
     where id=$1
       and org_id=$3
       and status='draft'
       and created_by is not null
       and created_by <> $2
    returning *
  `, [Number(req.params.id), req.user.id, req.user.org_id]);
  if (!updated) throw new AppError(409, 'Timesheet cannot be approved: it may be missing, already approved, unattributed, cross-tenant, or created by the same user');
  res.json({ success: true, data: updated });
}));

hrRouter.get('/payroll-runs', asyncHandler(async (req, res) => {
  const rows = await query(`select * from payroll_runs where org_id=$1 order by period_month desc limit 120`, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

hrRouter.post('/payroll-runs', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ period_month: z.string() }).parse(req.body);
  const [created] = await query(`insert into payroll_runs (org_id, period_month) values ($1,$2) returning *`, [req.user!.org_id, b.period_month]);
  res.status(201).json({ success: true, data: created });
}));

hrRouter.post('/payroll-runs/:id/lines', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ employee_id: z.number().int().positive(), project_id: z.number().int().positive().optional(), cost_code_id: z.number().int().positive().optional(), currency_id: z.number().int().positive(), basic: z.number().nonnegative().default(0), overtime: z.number().nonnegative().default(0), allowances: z.number().nonnegative().default(0), deductions: z.number().nonnegative().default(0) }).parse(req.body);
  const [created] = await query(`
    insert into payroll_lines (payroll_run_id, employee_id, project_id, cost_code_id, currency_id, basic, overtime, allowances, deductions)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    returning *
  `, [Number(req.params.id), b.employee_id, b.project_id ?? null, b.cost_code_id ?? null, b.currency_id, b.basic, b.overtime, b.allowances, b.deductions]);
  res.status(201).json({ success: true, data: created });
}));

hrRouter.patch('/payroll-runs/:id/approve', authorize('hr', 'approve'), asyncHandler(async (req, res) => {
  const payrollRunId = Number(req.params.id);
  if (!Number.isInteger(payrollRunId) || payrollRunId <= 0) throw new AppError(400, 'Invalid payroll run id');
  const client = await getClient();
  try {
    await client.query('begin');
    const run = (await client.query(`select * from payroll_runs where id=$1 for update`, [payrollRunId])).rows[0];
    if (!run) throw new AppError(404, 'Payroll run not found');
    if (run.status !== 'draft') throw new AppError(409, 'Only draft payroll runs can be submitted for approval');
    const totals = (await client.query(`
      select count(*)::int as line_count, count(distinct currency_id)::int as currency_count,
             min(currency_id)::bigint as currency_id, coalesce(sum(basic+overtime+allowances),0)::numeric(18,2) as total_amount
      from payroll_lines where payroll_run_id=$1
    `, [payrollRunId])).rows[0];
    if (!totals || Number(totals.line_count) === 0) throw new AppError(422, 'Payroll run has no lines');
    if (Number(totals.currency_count) !== 1) throw new AppError(422, 'Payroll run must use one currency before approval');
    const approval = await createApprovalInstance(client, {
      org_id: req.user!.org_id, module: 'payroll_run', record_id: payrollRunId,
      amount: String(totals.total_amount), currency_id: Number(totals.currency_id), initiated_by: req.user!.id
    });
    await client.query(`update payroll_runs set status='pending_approval', total_amount=$2, approval_instance_id=$3, updated_at=now() where id=$1`, [payrollRunId, totals.total_amount, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await releaseClient(client);
  }
}));

hrRouter.post('/payroll-lines/:id/post-cost', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postPayrollLineToCostTransaction(client, Number(req.params.id));
    await client.query('commit');
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await releaseClient(client);
  }
}));

hrRouter.post('/payroll-lines/:id/post-overhead-gl', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postPayrollOverheadToGl(client, Number(req.params.id));
    await client.query('commit');
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await releaseClient(client);
  }
}));

hrRouter.get('/leave-requests', asyncHandler(async (req, res) => {
  const rows = await query(`select lr.*, e.full_name from leave_requests lr join employees e on e.id=lr.employee_id order by lr.created_at desc limit 200`);
  res.json({ success: true, data: rows });
}));

hrRouter.post('/leave-requests', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const b = z.object({ employee_id: z.number().int().positive(), leave_type: z.enum(['annual','sick','unpaid','other']), from_date: z.string(), to_date: z.string() }).parse(req.body);
  const [created] = await query(`insert into leave_requests (employee_id, leave_type, from_date, to_date, created_by) values ($1,$2,$3,$4,$5) returning *`, [b.employee_id, b.leave_type, b.from_date, b.to_date, req.user.id]);
  res.status(201).json({ success: true, data: created });
}));

hrRouter.patch('/leave-requests/:id/:action', authorize('hr', 'approve'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const action = z.enum(['approve','reject']).parse(req.params.action);
  const status = action === 'approve' ? 'approved' : 'rejected';
  const [updated] = await query(`
    update leave_requests
       set status=$2, approved_by=$3
     where id=$1
       and org_id=$4
       and status='pending'
       and created_by is not null
       and created_by <> $3
    returning *
  `, [Number(req.params.id), status, req.user.id, req.user.org_id]);
  if (!updated) throw new AppError(409, 'Leave request cannot be decided: it may be missing, already decided, unattributed, cross-tenant, or created by the same user');
  res.json({ success: true, data: updated });
}));
