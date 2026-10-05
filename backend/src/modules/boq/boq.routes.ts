import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const boqRouter = Router();
boqRouter.use(authorize('boq', 'view'));

const masterBase = z.object({
  tender_id:z.number().int().positive().optional().nullable(), project_id:z.number().int().positive().optional().nullable(),
  item_no:z.string().min(1).max(20), section:z.string().max(150).optional().nullable(), description:z.string().min(1), unit_of_measure:z.string().min(1).max(20),
  quantity:z.number().nonnegative().default(0), cost_code_id:z.number().int().positive().optional().nullable(), unit_rate_material:z.number().nonnegative().default(0),
  unit_rate_labor:z.number().nonnegative().default(0), unit_rate_equipment:z.number().nonnegative().default(0), unit_rate_subcontract:z.number().nonnegative().default(0),
  overhead_percent:z.number().min(0).max(100).default(0), profit_percent:z.number().min(0).max(100).default(0)
});
const masterSchema = masterBase.refine(v=>v.tender_id||v.project_id,{message:'tender_id or project_id is required'});

boqRouter.get('/master', asyncHandler(async(req,res)=>{
 const tenderId=Number(req.query.tender_id||0), projectId=Number(req.query.project_id||0);
 const rows=await query(`select b.*,c.code cost_code from boq_master b left join cost_codes c on c.id=b.cost_code_id where ($1::bigint=0 or b.tender_id=$1) and ($2::bigint=0 or b.project_id=$2) order by b.section nulls first,b.item_no`,[tenderId,projectId]);
 res.json({success:true,data:rows});
}));
boqRouter.post('/master', authorize('boq','create'), asyncHandler(async(req,res)=>{
 const b=masterSchema.parse(req.body); const [r]=await query(`insert into boq_master(org_id,tender_id,project_id,item_no,section,description,unit_of_measure,quantity,cost_code_id,unit_rate_material,unit_rate_labor,unit_rate_equipment,unit_rate_subcontract,overhead_percent,profit_percent,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,[req.user!.org_id,b.tender_id??null,b.project_id??null,b.item_no,b.section??null,b.description,b.unit_of_measure,b.quantity,b.cost_code_id??null,b.unit_rate_material,b.unit_rate_labor,b.unit_rate_equipment,b.unit_rate_subcontract,b.overhead_percent,b.profit_percent,req.user!.id]); res.status(201).json({success:true,data:r});
}));
boqRouter.patch('/master/:id', authorize('boq','edit'), asyncHandler(async(req,res)=>{
 const id=Number(req.params.id), b=masterBase.partial().parse(req.body); const fields:any[]=[]; const vals:any[]=[]; for(const [k,v] of Object.entries(b)){fields.push(`${k}=$${fields.length+2}`);vals.push(v);} if(!fields.length)throw new AppError(400,'No fields to update');
 const rows=await query(`update boq_master set ${fields.join(',')},updated_at=now() where id=$1 and approval_instance_id is null returning *`,[id,...vals]); if(!rows[0])throw new AppError(409,'BOQ row is approved/submitted or not found');res.json({success:true,data:rows[0]});
}));
boqRouter.delete('/master/:id', authorize('boq','delete'), asyncHandler(async(req,res)=>{const rows=await query(`delete from boq_master where id=$1 and approval_instance_id is null returning id`,[Number(req.params.id)]);if(!rows[0])throw new AppError(409,'BOQ row is approved/submitted or not found');res.json({success:true,data:rows[0]});}));
boqRouter.get('/master/:id/rate-buildup',asyncHandler(async(req,res)=>res.json({success:true,data:await query(`select rb.*,r.resource_name,r.unit_of_measure from boq_rate_buildup rb left join resource_library r on r.id=rb.resource_id where rb.boq_master_id=$1 order by rb.id`,[Number(req.params.id)])})));
boqRouter.post('/master/:id/rate-buildup',authorize('boq','edit'),asyncHandler(async(req,res)=>{const b=z.object({resource_type:z.enum(['material','labor','equipment']),resource_id:z.number().int().positive().optional().nullable(),quantity_per_unit:z.number().positive(),unit_cost:z.number().nonnegative(),source:z.enum(['own_db','vendor_quote']).default('own_db')}).parse(req.body);const [r]=await query(`insert into boq_rate_buildup(boq_master_id,resource_type,resource_id,quantity_per_unit,unit_cost,source) values($1,$2,$3,$4,$5,$6) returning *`,[Number(req.params.id),b.resource_type,b.resource_id??null,b.quantity_per_unit,b.unit_cost,b.source]);res.status(201).json({success:true,data:r});}));
boqRouter.get('/resources',asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select * from resource_library where is_active=true order by resource_type,resource_name`)})));
boqRouter.post('/resources',authorize('boq','create'),asyncHandler(async(req,res)=>{const b=z.object({resource_type:z.enum(['material','labor','equipment']),resource_name:z.string().min(1),unit_of_measure:z.string().min(1).max(20),current_market_rate:z.number().nonnegative().optional().nullable(),currency_id:z.number().int().positive().optional().nullable()}).parse(req.body);const [r]=await query(`insert into resource_library(org_id,resource_type,resource_name,unit_of_measure,current_market_rate,currency_id,last_updated) values($1,$2,$3,$4,$5,$6,current_date) returning *`,[req.user!.org_id,b.resource_type,b.resource_name,b.unit_of_measure,b.current_market_rate??null,b.currency_id??null]);res.status(201).json({success:true,data:r});}));

boqRouter.get('/project/:projectId', asyncHandler(async (req, res) => {
  const rows = await query(`select id,item_no,section,description,unit_of_measure,contract_quantity,contract_unit_rate,contract_amount,revised_quantity,revised_amount,cost_code_id,is_locked from project_boq where project_id=$1 order by item_no`, [Number(req.params.projectId)]);
  res.json({ success: true, data: rows });
}));
