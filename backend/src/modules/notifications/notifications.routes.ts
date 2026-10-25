import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// R1.4 / CC-083 (MP-06 §6, migration 090): the notification centre and its alerts. A user's own notifications need no
// module permission (each user reads and marks only their own); the company's alert settings need 'notifications'.
// Alerts are evaluated by the database (evaluate_alerts) when notifications are read, at most once per company every
// EVALUATE_EVERY_MS - a technical interval, not a business threshold.
export const notificationsRouter = Router();
const EVALUATE_EVERY_MS = 30_000;
const lastEvaluated = new Map<number, number>();

async function evaluate(orgId: number, force = false): Promise<{ evaluated: boolean; written?: number; error?: string }> {
  const now = Date.now();
  if (!force && now - (lastEvaluated.get(orgId) ?? 0) < EVALUATE_EVERY_MS) return { evaluated: false };
  lastEvaluated.set(orgId, now);
  try {
    const [r] = await query<any>(`select evaluate_alerts($1) as written`, [orgId]);
    return { evaluated: true, written: Number(r?.written ?? 0) };
  } catch (e: any) {
    // A failing rule must not hide the notifications already recorded; the failure is reported with the list.
    lastEvaluated.delete(orgId);
    return { evaluated: false, error: String(e?.message ?? e) };
  }
}

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const q = z.object({ unread: z.enum(['true', 'false']).default('false'), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
  const meta = await evaluate(Number(req.user!.org_id));
  const rows = await query(`select id,source_module,alert_code,params,record_table,record_id,message,link,is_read,read_at,created_at
    from notifications where org_id=$1 and user_id=$2 ${q.unread === 'true' ? 'and is_read=false' : ''} order by created_at desc, id desc limit $3`,
    [req.user!.org_id, req.user!.id, q.limit]);
  res.json({ success: true, data: rows, meta });
}));

notificationsRouter.get('/count', asyncHandler(async (req, res) => {
  const meta = await evaluate(Number(req.user!.org_id));
  const [r] = await query<any>(`select count(*)::int as unread from notifications where org_id=$1 and user_id=$2 and is_read=false`, [req.user!.org_id, req.user!.id]);
  res.json({ success: true, data: { unread: r.unread }, meta });
}));

notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  const rows = await query(`update notifications set is_read=true, read_at=now() where org_id=$1 and user_id=$2 and is_read=false returning id`, [req.user!.org_id, req.user!.id]);
  res.json({ success: true, data: { marked_read: rows.length } });
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const rows = await query(`update notifications set is_read=true, read_at=coalesce(read_at, now()) where id=$3 and org_id=$1 and user_id=$2 returning *`, [req.user!.org_id, req.user!.id, id]);
  if (!rows[0]) throw new AppError(404, 'Notification not found');
  res.json({ success: true, data: rows[0] });
}));

// Company alert settings (MP-06 §6): enabled, threshold (unit from the catalogue) and recipient roles.
notificationsRouter.get('/alert-rules', authorize('notifications', 'view'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`
    select c.alert_code, c.threshold_unit, c.needs_roles, c.view_module, c.default_on,
           coalesce(a.enabled, c.default_on) as enabled, a.threshold, coalesce(a.recipient_role_ids, '{}') as recipient_role_ids, a.enabled_at, a.updated_at,
           (coalesce(a.enabled, c.default_on) and (c.threshold_unit is null or a.threshold is not null) and (not c.needs_roles or cardinality(coalesce(a.recipient_role_ids, '{}')) > 0)) as active
      from alert_catalog() c left join alert_rules a on a.org_id = $1 and a.alert_code = c.alert_code
     order by c.alert_code`, [req.user!.org_id]) });
}));

notificationsRouter.put('/alert-rules/:code', authorize('notifications', 'manage'), asyncHandler(async (req, res) => {
  const code = z.string().regex(/^AL-\d{2}$/).parse(req.params.code);
  const b = z.object({ enabled: z.boolean(), threshold: z.number().int().min(0).max(3650).nullable().optional(), recipient_role_ids: z.array(z.number().int().positive()).max(50).default([]) }).parse(req.body);
  const [cat] = await query<any>(`select * from alert_catalog() where alert_code = $1`, [code]);
  if (!cat) throw new AppError(404, 'Alert not found');
  if (cat.threshold_unit === null && b.threshold != null) throw new AppError(422, 'This alert has no threshold');
  if (b.enabled && cat.threshold_unit !== null && b.threshold == null) throw new AppError(422, 'Set the threshold of this alert before switching it on');
  if (b.enabled && cat.needs_roles && !b.recipient_role_ids.length) throw new AppError(422, 'Choose the recipient roles of this alert before switching it on');
  if (!cat.needs_roles && b.recipient_role_ids.length) throw new AppError(422, 'This alert goes to the approvers of the current step; it takes no recipient roles');
  const [r] = await query(`insert into alert_rules(org_id, alert_code, enabled, threshold, recipient_role_ids, updated_by) values ($1, $2, $3, $4, $5, $6)
    on conflict (org_id, alert_code) do update set enabled = excluded.enabled, threshold = excluded.threshold, recipient_role_ids = excluded.recipient_role_ids, updated_by = excluded.updated_by
    returning *`, [req.user!.org_id, code, b.enabled, b.threshold ?? null, [...new Set(b.recipient_role_ids)], req.user!.id]);
  lastEvaluated.delete(Number(req.user!.org_id));
  res.json({ success: true, data: r });
}));

notificationsRouter.post('/evaluate', authorize('notifications', 'manage'), asyncHandler(async (req, res) => {
  const r = await evaluate(Number(req.user!.org_id), true);
  if (r.error) throw new AppError(422, r.error);
  res.json({ success: true, data: r });
}));
