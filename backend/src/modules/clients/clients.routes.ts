import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const clientsRouter = Router();

const clientSchema = z.object({
  client_name: z.string().min(2).max(200),
  client_type: z.enum(['private','government','developer']).default('private'),
  contact_person: z.string().max(150).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().max(150).optional().nullable(),
  address: z.string().optional().nullable(),
  tax_id: z.string().max(50).optional().nullable(),
  source: z.enum(['referral','tender','direct','other']).optional().nullable()
});

clientsRouter.get('/', authorize('crm','view'), asyncHandler(async (_req,res) => {
  const rows = await query(`select id,client_name,client_type,contact_person,phone,email,address,tax_id,source,is_active,created_at,updated_at from clients order by created_at desc limit 500`);
  res.json({ success:true, data:rows });
}));

clientsRouter.get('/:id', authorize('crm','view'), asyncHandler(async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400,'Invalid client id');
  const rows = await query(`select * from clients where id=$1`, [id]);
  if (!rows[0]) throw new AppError(404,'Client not found');
  res.json({ success:true, data:rows[0] });
}));

clientsRouter.post('/', authorize('crm','create'), asyncHandler(async (req,res) => {
  if (!req.user) throw new AppError(401,'Authentication required');
  const b = clientSchema.parse(req.body);
  const rows = await query(`insert into clients (org_id,client_name,client_type,contact_person,phone,email,address,tax_id,source,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[req.user.org_id,b.client_name,b.client_type,b.contact_person??null,b.phone??null,b.email??null,b.address??null,b.tax_id??null,b.source??null,req.user.id]);
  res.status(201).json({ success:true, data:rows[0] });
}));

clientsRouter.patch('/:id', authorize('crm','edit'), asyncHandler(async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400,'Invalid client id');
  const b = clientSchema.partial().parse(req.body);
  const rows = await query(`update clients set client_name=coalesce($2,client_name),client_type=coalesce($3,client_type),contact_person=coalesce($4,contact_person),phone=coalesce($5,phone),email=coalesce($6,email),address=coalesce($7,address),tax_id=coalesce($8,tax_id),source=coalesce($9,source),updated_at=now() where id=$1 returning *`,[id,b.client_name??null,b.client_type??null,b.contact_person??null,b.phone??null,b.email??null,b.address??null,b.tax_id??null,b.source??null]);
  if (!rows[0]) throw new AppError(404,'Client not found');
  res.json({ success:true,data:rows[0] });
}));

clientsRouter.delete('/:id', authorize('crm','delete'), asyncHandler(async (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400,'Invalid client id');
  const rows = await query(`update clients set is_active=false,updated_at=now() where id=$1 returning id,is_active`,[id]);
  if (!rows[0]) throw new AppError(404,'Client not found');
  res.json({ success:true,data:rows[0] });
}));
