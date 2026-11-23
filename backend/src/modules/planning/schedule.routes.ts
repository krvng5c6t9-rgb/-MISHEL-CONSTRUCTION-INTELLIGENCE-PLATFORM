import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { ScheduleError, datedSchedule, exportMspdi, exportXer, importMspdi, importXer, type Act, type Calendar, type Rel } from './scheduleEngine.js';

// CC-097 (Stage 68): work calendars, dated CPM and schedule exchange (Primavera XER, Microsoft Project XML).
// planning.view reads; planning.manage changes calendars and settings and imports.
export const scheduleRouter = Router();
scheduleRouter.use(authorize('planning', 'view'));
const wrap = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof ScheduleError) throw new AppError(422, e.message); throw e; } };

scheduleRouter.get('/calendars', asyncHandler(async (req, res) => {
  const rows = await query<any>(`select c.id, c.name, c.work_days, c.hours_per_day::text as hours_per_day, c.created_at,
      coalesce((select json_agg(json_build_object('id', h.id, 'holiday_date', h.holiday_date, 'description', h.description) order by h.holiday_date) from calendar_holidays h where h.calendar_id = c.id), '[]') as holidays
    from work_calendars c where c.org_id = $1 order by c.name`, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));
scheduleRouter.post('/calendars', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(100), work_days: z.array(z.number().int().min(0).max(6)).min(1).max(7), hours_per_day: z.number().positive().max(24) }).parse(req.body);
  const [r] = await query<any>(`insert into work_calendars (org_id, name, work_days, hours_per_day, created_by) values ($1, $2, $3, $4, $5) returning id`,
    [req.user!.org_id, b.name, [...new Set(b.work_days)].sort(), b.hours_per_day, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
scheduleRouter.post('/calendars/:id/holidays', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().trim().min(2).max(200) }).parse(req.body);
  const [r] = await query<any>(`insert into calendar_holidays (org_id, calendar_id, holiday_date, description) values ($1, $2, $3, $4) returning id`, [req.user!.org_id, Number(req.params.id), b.holiday_date, b.description]);
  res.status(201).json({ success: true, data: r });
}));
scheduleRouter.delete('/calendars/:id/holidays/:hid', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const r = await query(`delete from calendar_holidays where org_id = $1 and calendar_id = $2 and id = $3 returning id`, [req.user!.org_id, Number(req.params.id), Number(req.params.hid)]);
  if (!r.length) throw new AppError(404, 'Holiday not found');
  res.json({ success: true });
}));

async function projectOf(orgId: number, id: number) {
  const [p] = await query<any>(`select id, project_code, project_name from projects where org_id = $1 and id = $2`, [orgId, id]);
  if (!p) throw new AppError(404, 'Project not found');
  return p;
}
scheduleRouter.get('/projects/:id/schedule-settings', asyncHandler(async (req, res) => {
  const [s] = await query(`select s.calendar_id, s.data_date, c.name as calendar_name from project_schedule_settings s join work_calendars c on c.id = s.calendar_id where s.org_id = $1 and s.project_id = $2`,
    [req.user!.org_id, Number(req.params.id)]);
  res.json({ success: true, data: s ?? null });
}));
scheduleRouter.put('/projects/:id/schedule-settings', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ calendar_id: z.number().int().positive(), data_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  const p = await projectOf(Number(req.user!.org_id), Number(req.params.id));
  await query(`insert into project_schedule_settings (org_id, project_id, calendar_id, data_date, updated_by) values ($1, $2, $3, $4, $5)
    on conflict (project_id) do update set calendar_id = excluded.calendar_id, data_date = excluded.data_date, updated_by = excluded.updated_by, updated_at = now()`,
    [req.user!.org_id, p.id, b.calendar_id, b.data_date, req.user!.id]);
  res.json({ success: true });
}));

async function loadSchedule(orgId: number, projectId: number) {
  const project = await projectOf(orgId, projectId);
  const [s] = await query<any>(`select s.data_date, c.work_days, c.hours_per_day::text as hours_per_day,
      coalesce((select array_agg(h.holiday_date::text) from calendar_holidays h where h.calendar_id = c.id), '{}') as holidays
    from project_schedule_settings s join work_calendars c on c.id = s.calendar_id where s.org_id = $1 and s.project_id = $2`, [orgId, projectId]);
  if (!s) throw new AppError(422, 'Choose the project calendar and data date first');
  const acts: Act[] = (await query<any>(`select id, activity_id_ext, activity_name, coalesce(planned_duration_days, 0)::int as duration, activity_type, wbs_code
    from schedule_activities where org_id = $1 and project_id = $2 order by id`, [orgId, projectId]))
    .map(a => ({ id: a.id, code: a.activity_id_ext, name: a.activity_name, duration: a.duration, type: a.activity_type, wbs: a.wbs_code }));
  const rels: Rel[] = (await query<any>(`select predecessor_activity_id as pred, successor_activity_id as succ, relationship_type as type, lag_days as lag
    from schedule_relationships where org_id = $1 and project_id = $2 order by id`, [orgId, projectId])).map(r => ({ pred: r.pred, succ: r.succ, type: r.type, lag: r.lag }));
  const cal: Calendar = { work_days: s.work_days.map(Number), hours_per_day: Number(s.hours_per_day), holidays: s.holidays };
  return { project, acts, rels, cal, dataDate: s.data_date as string };
}

scheduleRouter.get('/projects/:id/schedule', asyncHandler(async (req, res) => {
  const { project, acts, rels, cal, dataDate } = await loadSchedule(Number(req.user!.org_id), Number(req.params.id));
  if (!acts.length) return res.json({ success: true, data: { project, data_date: dataDate, duration_days: 0, start: null, finish: null, activities: [], relationships: rels } });
  const d = wrap(() => datedSchedule(acts, rels, cal, dataDate)), by = new Map(acts.map(a => [a.id, a]));
  res.json({ success: true, data: { project, data_date: dataDate, duration_days: d.duration, start: d.start, finish: d.finish, relationships: rels,
    activities: d.rows.map(r => ({ ...by.get(r.id)!, ...r })) } });
}));

scheduleRouter.get('/projects/:id/export', asyncHandler(async (req, res) => {
  const format = z.enum(['xer', 'mspdi']).parse(req.query.format);
  const { project, acts, rels, cal, dataDate } = await loadSchedule(Number(req.user!.org_id), Number(req.params.id));
  if (!acts.length) throw new AppError(422, 'The project has no schedule activities to export');
  const d = wrap(() => datedSchedule(acts, rels, cal, dataDate)), proj = { code: project.project_code, name: project.project_name };
  const body = format === 'xer' ? exportXer(proj, acts, rels, cal, d) : exportMspdi(proj, acts, rels, cal, d);
  const safe = String(project.project_code).replace(/[^A-Za-z0-9_-]+/g, '_');
  res.setHeader('Content-Type', format === 'xer' ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.${format === 'xer' ? 'xer' : 'xml'}"`);
  res.send(body);
}));

// Import: the file is sent as the request body (text, up to 20 MB). dry_run=1 reads and reports without saving. A
// schedule is imported into a project that has no activities yet (replacing a schedule is not supported in this
// version); every import is recorded with the file's SHA-256.
scheduleRouter.post('/projects/:id/import', authorize('planning', 'manage'), express.text({ type: () => true, limit: '20mb' }), asyncHandler(async (req, res) => {
  const q = z.object({ format: z.enum(['xer', 'mspdi']), file_name: z.string().trim().min(1).max(255), dry_run: z.enum(['0', '1']).default('0') }).parse(req.query);
  const orgId = Number(req.user!.org_id), project = await projectOf(orgId, Number(req.params.id));
  const text = typeof req.body === 'string' ? req.body : '';
  if (!text.trim()) throw new AppError(400, 'The file is empty');
  const [s] = await query<any>(`select c.hours_per_day::text as hpd from project_schedule_settings s join work_calendars c on c.id = s.calendar_id where s.org_id = $1 and s.project_id = $2`, [orgId, project.id]);
  if (!s) throw new AppError(422, 'Choose the project calendar and data date first');
  const imp = wrap(() => q.format === 'xer' ? importXer(text, Number(s.hpd)) : importMspdi(text, Number(s.hpd)));
  if (!imp.acts.length) throw new AppError(422, 'The file has no activities to import');
  const tooLong = imp.acts.find(a => (a.code ?? '').length > 30 || a.name.length > 255);
  if (tooLong) throw new AppError(422, `Activity code longer than 30 or name longer than 255 characters: ${String(tooLong.code).slice(0, 40)}`);
  const dup = imp.acts.map(a => a.code).find((c, i, all) => c && all.indexOf(c) !== i);
  if (dup) throw new AppError(422, `Activity code appears twice in the file: ${dup}`);
  // Check the network before saving (cycles, references).
  const tmpId = new Map(imp.acts.map((a, i) => [a.key, i + 1]));
  wrap(() => datedSchedule(imp.acts.map((a, i) => ({ ...a, id: i + 1 })), imp.rels.map(r => ({ pred: tmpId.get(r.pred)!, succ: tmpId.get(r.succ)!, type: r.type, lag: r.lag })),
    { work_days: [0, 1, 2, 3, 4, 5, 6], hours_per_day: Number(s.hpd), holidays: [] }, '2000-01-03'));
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const summary = { activities: imp.acts.length, relationships: imp.rels.length, milestones: imp.acts.filter(a => a.type !== 'task').length, warnings: imp.warnings, file_sha256: sha };
  if (q.dry_run === '1') return res.json({ success: true, data: { ...summary, saved: false } });
  const c = await getClient();
  try {
    await c.query('begin');
    const [{ n }] = (await c.query(`select count(*)::int as n from schedule_activities where org_id = $1 and project_id = $2`, [orgId, project.id])).rows;
    if (n > 0) throw new AppError(409, 'The project already has schedule activities; import into a project without a schedule');
    const ids = new Map<string, number>();
    for (const a of imp.acts) {
      const { rows } = await c.query(`insert into schedule_activities (org_id, project_id, activity_id_ext, activity_name, planned_duration_days, activity_type, wbs_code)
        values ($1, $2, $3, $4, $5, $6, $7) returning id`, [orgId, project.id, a.code, a.name, a.duration, a.type, a.wbs]);
      ids.set(a.key, rows[0].id);
    }
    for (const r of imp.rels) await c.query(`insert into schedule_relationships (org_id, project_id, predecessor_activity_id, successor_activity_id, relationship_type, lag_days)
      values ($1, $2, $3, $4, $5, $6)`, [orgId, project.id, ids.get(r.pred), ids.get(r.succ), r.type, r.lag]);
    const { rows } = await c.query(`insert into schedule_imports (org_id, project_id, format, file_name, file_sha256, activities_count, relationships_count, warnings, imported_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [orgId, project.id, q.format, q.file_name, sha, imp.acts.length, imp.rels.length, JSON.stringify(imp.warnings), req.user!.id]);
    await c.query('commit');
    res.status(201).json({ success: true, data: { ...summary, saved: true, import_id: rows[0].id } });
  } catch (e) { await c.query('rollback').catch(() => undefined); throw e; } finally { await releaseClient(c); }
}));

scheduleRouter.get('/projects/:id/imports', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select i.id, i.format, i.file_name, i.file_sha256, i.activities_count, i.relationships_count, i.warnings, i.created_at, u.full_name as imported_by_name
    from schedule_imports i join users u on u.id = i.imported_by where i.org_id = $1 and i.project_id = $2 order by i.id desc`, [req.user!.org_id, Number(req.params.id)]) });
}));
