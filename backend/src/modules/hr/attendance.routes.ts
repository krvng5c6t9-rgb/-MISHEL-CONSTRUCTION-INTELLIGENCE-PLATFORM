import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// CC-093 (Stage 64, A-006; migration 098): site attendance. Recording needs hr.create, approving a day needs
// hr.approve and is done by someone other than the recorder; an approved record never changes (database rules, which
// also check employment on the date, hours, leave and company). The labour summary is computed by the database.
export const attendanceRouter = Router();
attendanceRouter.use(authorize('hr', 'view'));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hours = z.number().min(0).max(24);
const entry = z.object({ employee_id: z.number().int().positive(), status: z.enum(['present', 'absent', 'leave']), hours_worked: hours.optional(), overtime_hours: hours.optional() });

// One record per employee and day (migration 007); re-entry updates it while it is not approved (the database refuses
// a change to an approved record).
async function upsert(c: PoolClient | null, userId: number, projectId: number | null, date: string, e: z.infer<typeof entry>) {
  const sql = `insert into attendance (employee_id, project_id, attendance_date, status, hours_worked, overtime_hours, recorded_by)
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (employee_id, attendance_date) do update set project_id = excluded.project_id, status = excluded.status,
      hours_worked = excluded.hours_worked, overtime_hours = excluded.overtime_hours, recorded_by = excluded.recorded_by
    returning *`;
  const params = [e.employee_id, projectId, date, e.status, e.status === 'present' ? e.hours_worked ?? null : 0, e.status === 'present' ? e.overtime_hours ?? 0 : 0, userId];
  return c ? (await c.query(sql, params)).rows[0] : (await query<any>(sql, params))[0];
}

attendanceRouter.post('/attendance', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = entry.extend({ project_id: z.number().int().positive().optional(), attendance_date: isoDate }).parse(req.body);
  res.status(201).json({ success: true, data: await upsert(null, Number(req.user!.id), b.project_id ?? null, b.attendance_date, b) });
}));

// The day sheet of a project: the active employees whose primary project it is, plus anyone already recorded on it
// that day, with their record (if any).
attendanceRouter.get('/attendance/sheet', asyncHandler(async (req, res) => {
  const q = z.object({ project_id: z.coerce.number().int().positive(), date: isoDate }).parse(req.query);
  res.json({ success: true, data: await query(`
    select e.id as employee_id, e.employee_code, e.full_name, e.job_title, e.employment_type, a.id as attendance_id, a.project_id, a.status,
           a.hours_worked::text as hours_worked, a.overtime_hours::text as overtime_hours, a.approved_at, ur.full_name as recorded_by_name, ua.full_name as approved_by_name,
           exists (select 1 from leave_requests l where l.employee_id = e.id and l.status = 'approved' and $3::date between l.from_date and l.to_date) as on_leave
      from employees e
      left join attendance a on a.employee_id = e.id and a.attendance_date = $3::date
      left join users ur on ur.id = a.recorded_by left join users ua on ua.id = a.approved_by
     where e.org_id = $1 and ((e.primary_project_id = $2 and e.employment_status <> 'terminated') or a.project_id = $2)
     order by e.full_name`, [req.user!.org_id, q.project_id, q.date]) });
}));

attendanceRouter.post('/attendance/bulk', authorize('hr', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), date: isoDate, rows: z.array(entry).min(1).max(500) }).parse(req.body);
  if (new Set(b.rows.map(r => r.employee_id)).size !== b.rows.length) throw new AppError(422, 'An employee appears twice in the sheet');
  const c = await getClient();
  try {
    await c.query('begin');
    const out = [];
    for (const r of b.rows) out.push(await upsert(c, Number(req.user!.id), b.project_id, b.date, r));
    await c.query('commit');
    res.status(201).json({ success: true, data: out });
  } catch (err) { await c.query('rollback'); throw err; } finally { await releaseClient(c); }
}));

// Approves the day's unapproved records of a project that someone else recorded; records the approver entered stay
// for another person.
attendanceRouter.post('/attendance/approve', authorize('hr', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), date: isoDate }).parse(req.body);
  const rows = await query<any>(`update attendance set approved_by = $4, approved_at = now()
    where org_id = $1 and project_id = $2 and attendance_date = $3 and approved_by is null and recorded_by is not null and recorded_by <> $4 returning id`,
    [req.user!.org_id, b.project_id, b.date, req.user!.id]);
  const [left] = await query<any>(`select count(*)::int as n from attendance where org_id = $1 and project_id = $2 and attendance_date = $3 and approved_by is null`,
    [req.user!.org_id, b.project_id, b.date]);
  if (!rows.length && left.n) throw new AppError(403, 'Attendance you recorded is approved by someone else');
  res.json({ success: true, data: { approved: rows.length, still_unapproved: left.n } });
}));

// Labour summary of a project for a period: man-days by status, hours, overtime, workers, approved timesheet hours,
// labour cost posted to the project (cost transactions of type labour, project currency) and cost per man-day present;
// and the days where an employee's approved timesheet hours differ from the attendance hours.
attendanceRouter.get('/labour-summary', asyncHandler(async (req, res) => {
  const q = z.object({ project_id: z.coerce.number().int().positive(), from: isoDate, to: isoDate }).parse(req.query);
  if (q.to < q.from) throw new AppError(422, 'The period ends before it starts');
  const p = [req.user!.org_id, q.project_id, q.from, q.to];
  const [s] = await query<any>(`
    with a as (select * from attendance where org_id = $1 and project_id = $2 and attendance_date between $3::date and $4::date),
         t as (select coalesce(sum(hours), 0) as h from timesheets where org_id = $1 and project_id = $2 and status = 'approved' and work_date between $3::date and $4::date),
         c as (select coalesce(sum(ct.project_amount), 0) as cost from cost_transactions ct join cost_codes cc on cc.id = ct.cost_code_id
                where ct.org_id = $1 and ct.project_id = $2 and ct.transaction_type = 'actual' and cc.cost_type = 'labor' and ct.transaction_date between $3::date and $4::date)
    select count(*) filter (where status in ('present', 'overtime'))::int as days_present, count(*) filter (where status = 'absent')::int as days_absent,
           count(*) filter (where status = 'leave')::int as days_leave, count(distinct employee_id)::int as workers,
           coalesce(sum(hours_worked), 0)::text as hours, coalesce(sum(overtime_hours), 0)::text as overtime_hours,
           count(*) filter (where approved_by is null)::int as unapproved,
           (select h from t)::text as timesheet_hours, (select cost from c)::text as labour_cost,
           case when count(*) filter (where status in ('present', 'overtime')) > 0
                then round((select cost from c) / count(*) filter (where status in ('present', 'overtime')), 2)::text end as cost_per_man_day,
           (select code from currencies where id = (select currency_id from projects where id = $2)) as currency
      from a`, p);
  const gaps = await query(`
    with a as (select employee_id, attendance_date as d, coalesce(hours_worked, 0) + overtime_hours as h from attendance
                where org_id = $1 and project_id = $2 and attendance_date between $3::date and $4::date),
         t as (select employee_id, work_date as d, sum(hours) as h from timesheets
                where org_id = $1 and project_id = $2 and status = 'approved' and work_date between $3::date and $4::date group by 1, 2)
    select coalesce(a.employee_id, t.employee_id) as employee_id, e.full_name, coalesce(a.d, t.d)::text as date,
           coalesce(a.h, 0)::text as attendance_hours, coalesce(t.h, 0)::text as timesheet_hours
      from a full join t on t.employee_id = a.employee_id and t.d = a.d join employees e on e.id = coalesce(a.employee_id, t.employee_id)
     where coalesce(a.h, 0) <> coalesce(t.h, 0) order by 3, 2 limit 500`, p);
  res.json({ success: true, data: { ...s, differences: gaps } });
}));

// Project names for the attendance screen (ids, codes and names only, under hr.view).
attendanceRouter.get('/attendance/projects', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select id, project_code, project_name from projects where org_id = $1 and status not in ('closed', 'cancelled') order by project_code`, [req.user!.org_id]) });
}));
