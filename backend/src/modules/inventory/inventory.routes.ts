import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
export const inventoryRouter = Router();
const id=z.number().int().positive();
const parseId=(v:string)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw new AppError(400,'Invalid id');return n;};
const txSchema=z.object({warehouse_id:id,project_id:id.optional().nullable(),inventory_item_id:id,transaction_type:z.enum(['issue','transfer_in','transfer_out','adjustment']),quantity:z.number().refine(v=>v!==0),unit_cost:z.number().nonnegative().optional().nullable(),transaction_date:z.string().optional(),source_table:z.string().max(80).optional(),source_record_id:id.optional(),reason:z.string().trim().max(2000).optional(),cost_code_id:id.optional().nullable(),}).refine(v=>v.transaction_type!=='adjustment'||(v.reason??'').length>=5,{message:'A stock adjustment needs a reason (at least 5 characters)',path:['reason']}).refine(v=>v.transaction_type!=='issue'||!!v.project_id,{message:'An issue must name the receiving project',path:['project_id']});
inventoryRouter.get('/warehouses',authorize('procurement','view'),asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select * from warehouses order by code')})));
inventoryRouter.get('/items',authorize('procurement','view'),asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select * from inventory_items order by item_code')})));
inventoryRouter.get('/stock',authorize('procurement','view'),asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select warehouse_id,inventory_item_id,sum(quantity) quantity_on_hand from inventory_transactions group by warehouse_id,inventory_item_id order by warehouse_id,inventory_item_id`)})));
inventoryRouter.post('/transactions',authorize('procurement','edit'),asyncHandler(async(req,res)=>{if(!req.user)throw new AppError(401,'Authentication required');const b=txSchema.parse(req.body);if(['transfer_in','transfer_out'].includes(b.transaction_type))throw new AppError(422,'Use /inventory/transfer for warehouse transfers');if(b.transaction_type==='issue'&&b.quantity>=0)throw new AppError(422,'Issue quantity must be negative');if(b.transaction_type==='issue'&&b.unit_cost!=null)throw new AppError(422,'Issue cost is the store moving average and cannot be entered (DEC-014)');if(b.transaction_type==='adjustment'){const granted:{module:string;action:string}[]=req.user.permissions;if(!granted.some(g=>g.module==='procurement'&&g.action==='approve'))throw new AppError(403,'Stock adjustments require procurement.approve');}const client=await getClient();try{await client.query('begin');const wh=(await client.query('select id from warehouses where id=$1 for update',[b.warehouse_id])).rows[0];if(!wh)throw new AppError(422,'Warehouse not found in current organization');if(b.transaction_type==='issue'){const stock=(await client.query(`select coalesce(sum(quantity),0)::numeric(18,3)::text as available, (coalesce(sum(quantity),0) >= abs($3::numeric)) as sufficient from inventory_transactions where warehouse_id=$1 and inventory_item_id=$2`,[b.warehouse_id,b.inventory_item_id,String(b.quantity)])).rows[0];if(!stock.sufficient)throw new AppError(409,`Insufficient stock. Available ${stock.available}`);}const rows=(await client.query(`insert into inventory_transactions(org_id,warehouse_id,project_id,inventory_item_id,transaction_type,quantity,unit_cost,transaction_date,source_table,source_record_id,created_by,reason,cost_code_id) values($1,$2,$3,$4,$5,$6,$7,coalesce($8::date,current_date),$9,$10,$11,$12,$13) returning *`,[req.user.org_id,b.warehouse_id,b.project_id??null,b.inventory_item_id,b.transaction_type,b.quantity,b.unit_cost??null,b.transaction_date??null,b.source_table??null,b.source_record_id??null,req.user.id,b.reason??null,b.cost_code_id??null])).rows;await client.query('commit');res.status(201).json({success:true,data:rows[0]});}catch(e){await client.query('rollback');throw e;}finally{await releaseClient(client);}}));

// DEC-014: store valuation at moving average.
inventoryRouter.get('/valuation',authorize('procurement','view'),asyncHandler(async(req,res)=>{res.json({success:true,data:await query(`select v.*,w.code as warehouse_code,i.item_code from inventory_valuation() v join warehouses w on w.id=v.warehouse_id and w.org_id=$1 join inventory_items i on i.id=v.inventory_item_id order by w.code,i.item_code`,[req.user!.org_id])});}));
inventoryRouter.post('/warehouses',authorize('procurement','manage'),asyncHandler(async(req,res)=>{const b=z.object({project_id:id.optional().nullable(),code:z.string().min(1).max(30),name:z.string().min(1).max(150)}).parse(req.body);const [r]=await query(`insert into warehouses(org_id,project_id,code,name) values($1,$2,$3,$4) returning *`,[req.user!.org_id,b.project_id??null,b.code,b.name]);res.status(201).json({success:true,data:r});}));
inventoryRouter.post('/items',authorize('procurement','manage'),asyncHandler(async(req,res)=>{const b=z.object({item_code:z.string().min(1).max(50),description:z.string().min(1),unit_of_measure:z.string().min(1).max(20),cost_code_id:id.optional().nullable()}).parse(req.body);const [r]=await query(`insert into inventory_items(org_id,item_code,description,unit_of_measure,cost_code_id) values($1,$2,$3,$4,$5) returning *`,[req.user!.org_id,b.item_code,b.description,b.unit_of_measure,b.cost_code_id??null]);res.status(201).json({success:true,data:r});}));

// NDC-030 (migration 062): two-step transfer. Dispatch posts the source leg (stock in transit); a different user
// confirms receipt of the quantity actually received; a short receipt is accepted by a third person.
// DEC-014 (migration 075): carried cost = the store's moving (weighted) average, the same value the database assigns
// to every outflow (inventory_moving_average / trg_inventory_valuation).
const carriedCostSql=`(case when sum(quantity) filter (where unit_cost is not null) > 0 then round(sum(quantity*unit_cost) filter (where unit_cost is not null) / sum(quantity) filter (where unit_cost is not null),4) end)::numeric(18,4)`;
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
async function inTx<T>(fn:(c:any)=>Promise<T>):Promise<T>{const client=await getClient();try{await client.query('begin');const r=await fn(client);await client.query('commit');return r;}catch(e){await client.query('rollback');throw e;}finally{await releaseClient(client);}}

inventoryRouter.post('/transfer',authorize('procurement','edit'),asyncHandler(async(req,res)=>{
 if(!req.user)throw new AppError(401,'Authentication required');
 const b=z.object({from_warehouse_id:id,to_warehouse_id:id,project_id:id.optional().nullable(),inventory_item_id:id,quantity:z.number().positive(),unit_cost:z.number().nonnegative().optional().nullable(),transaction_date:isoDate.optional()}).parse(req.body);
 if(b.from_warehouse_id===b.to_warehouse_id)throw new AppError(422,'Source and destination warehouses must differ');
 if(b.unit_cost!=null)throw new AppError(422,'Transfer cost is carried from the source store and cannot be entered');
 const data=await inTx(async client=>{
  const wh=(await client.query('select id,project_id from warehouses where id=any($1::bigint[]) order by id for update',[[b.from_warehouse_id,b.to_warehouse_id]])).rows;if(wh.length!==2)throw new AppError(422,'Warehouse not found in current organization');
  const dest=wh.find((w:any)=>Number(w.id)===b.to_warehouse_id);const project=dest.project_id??b.project_id??null;
  if(dest.project_id&&b.project_id&&Number(b.project_id)!==Number(dest.project_id))throw new AppError(422,'Transfer project must be the destination store project');
  const stock=(await client.query(`select coalesce(sum(quantity),0)::numeric(18,3)::text as available, (coalesce(sum(quantity),0) >= $3::numeric) as sufficient, ${carriedCostSql} as carried_cost from inventory_transactions where warehouse_id=$1 and inventory_item_id=$2`,[b.from_warehouse_id,b.inventory_item_id,String(b.quantity)])).rows[0];
  if(!stock.sufficient)throw new AppError(409,`Insufficient stock. Available ${stock.available}`);
  const t=(await client.query(`insert into stock_transfers(org_id,from_warehouse_id,to_warehouse_id,project_id,inventory_item_id,quantity,unit_cost,dispatched_by,dispatched_on) values($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,coalesce($9::date,current_date)) returning *`,[req.user!.org_id,b.from_warehouse_id,b.to_warehouse_id,project,b.inventory_item_id,String(b.quantity),stock.carried_cost,req.user!.id,b.transaction_date??null])).rows[0];
  const out=(await client.query(`insert into inventory_transactions(org_id,warehouse_id,project_id,inventory_item_id,transaction_type,quantity,unit_cost,transaction_date,source_table,source_record_id,created_by) values($1,$2,$3,$4,'transfer_out',($5::numeric)*-1,$6::numeric,$7::date,'stock_transfer',$8,$9) returning *`,[req.user!.org_id,b.from_warehouse_id,project,b.inventory_item_id,String(b.quantity),stock.carried_cost,t.dispatched_on,t.id,req.user!.id])).rows[0];
  return {transfer:t,transfer_out:out};
 });
 res.status(201).json({success:true,data});
}));
inventoryRouter.get('/transfers',authorize('procurement','view'),asyncHandler(async(req,res)=>{
 const st=req.query.status===undefined?null:z.enum(['dispatched','received','received_short','shortage_accepted']).parse(req.query.status);
 res.json({success:true,data:await query(`select t.*, (t.quantity-coalesce(t.received_quantity,0))::numeric(18,3) as open_or_short_quantity from stock_transfers t where t.org_id=$1 and ($2::varchar is null or t.status=$2::varchar) order by t.id`,[req.user!.org_id,st])});
}));
inventoryRouter.get('/in-transit',authorize('procurement','view'),asyncHandler(async(req,res)=>{
 res.json({success:true,data:await query(`select to_warehouse_id,inventory_item_id,sum(quantity)::numeric(18,3) as quantity_in_transit,sum(quantity*coalesce(unit_cost,0))::numeric(18,2) as value_in_transit,count(*)::int as transfers from stock_transfers where org_id=$1 and status='dispatched' group by to_warehouse_id,inventory_item_id order by to_warehouse_id,inventory_item_id`,[req.user!.org_id])});
}));
inventoryRouter.post('/transfers/:id/receive',authorize('procurement','edit'),asyncHandler(async(req,res)=>{
 const tid=parseId(req.params.id);
 const b=z.object({received_quantity:z.number().nonnegative(),received_on:isoDate.optional(),discrepancy_reason:z.string().trim().max(2000).optional()}).parse(req.body);
 const data=await inTx(async client=>{
  const t=(await client.query(`select * from stock_transfers where id=$1 and org_id=$2 for update`,[tid,req.user!.org_id])).rows[0];
  if(!t)throw new AppError(404,'Transfer not found');
  if(t.status!=='dispatched')throw new AppError(409,'Transfer is already received');
  if(Number(t.dispatched_by)===req.user!.id)throw new AppError(403,'Segregation of duties: receipt must be confirmed by someone other than the dispatcher');
  const short=(await client.query(`select $1::numeric < $2::numeric as short`,[String(b.received_quantity),t.quantity])).rows[0].short;
  const u=(await client.query(`update stock_transfers set status=$2::varchar,received_by=$3,received_on=coalesce($4::date,current_date),received_quantity=$5::numeric,discrepancy_reason=$6::text where id=$1 returning *`,[tid,short?'received_short':'received',req.user!.id,b.received_on??null,String(b.received_quantity),b.discrepancy_reason??null])).rows[0];
  let inn=null;
  if(b.received_quantity>0)inn=(await client.query(`insert into inventory_transactions(org_id,warehouse_id,project_id,inventory_item_id,transaction_type,quantity,unit_cost,transaction_date,source_table,source_record_id,created_by) values($1,$2,$3,$4,'transfer_in',$5::numeric,$6::numeric,$7::date,'stock_transfer',$8,$9) returning *`,[u.org_id,u.to_warehouse_id,u.project_id,u.inventory_item_id,u.received_quantity,u.unit_cost,u.received_on,u.id,req.user!.id])).rows[0];
  return {transfer:u,transfer_in:inn};
 });
 res.json({success:true,data});
}));
inventoryRouter.post('/transfers/:id/accept-shortage',authorize('procurement','approve'),asyncHandler(async(req,res)=>{
 const tid=parseId(req.params.id);const b=z.object({note:z.string().trim().min(5).max(2000)}).parse(req.body);
 const cur=(await query<any>(`select * from stock_transfers where id=$1 and org_id=$2`,[tid,req.user!.org_id]))[0];
 if(!cur)throw new AppError(404,'Transfer not found');
 if(cur.status!=='received_short')throw new AppError(409,'Only a short receipt awaits shortage acceptance');
 if([Number(cur.dispatched_by),Number(cur.received_by)].includes(req.user!.id))throw new AppError(403,'Segregation of duties: a transit shortage is accepted by someone other than the dispatcher and the receiver');
 const [u]=await query(`update stock_transfers set status='shortage_accepted',shortage_accepted_by=$2,shortage_accepted_at=now(),shortage_note=$3 where id=$1 and status='received_short' returning *`,[tid,req.user!.id,b.note]);
 if(!u)throw new AppError(409,'Only a short receipt awaits shortage acceptance');
 res.json({success:true,data:u});
}));

// NDC-030: physical stock count -> variance review -> approval by someone other than the counter posts adjustments.
inventoryRouter.post('/stock-counts',authorize('procurement','edit'),asyncHandler(async(req,res)=>{
 const b=z.object({warehouse_id:id,count_date:isoDate.optional()}).parse(req.body);
 const [c]=await query(`insert into stock_counts(org_id,warehouse_id,count_date,counted_by) values($1,$2,coalesce($3::date,current_date),$4) returning *`,[req.user!.org_id,b.warehouse_id,b.count_date??null,req.user!.id]);
 res.status(201).json({success:true,data:c});
}));
inventoryRouter.get('/stock-counts/:id',authorize('procurement','view'),asyncHandler(async(req,res)=>{
 const cid=parseId(req.params.id);
 const [c]=await query(`select * from stock_counts where id=$1 and org_id=$2`,[cid,req.user!.org_id]);if(!c)throw new AppError(404,'Stock count not found');
 res.json({success:true,data:{...c,lines:await query(`select * from stock_count_lines where stock_count_id=$1 order by id`,[cid])}});
}));
inventoryRouter.post('/stock-counts/:id/lines',authorize('procurement','edit'),asyncHandler(async(req,res)=>{
 const cid=parseId(req.params.id);const b=z.object({inventory_item_id:id,counted_quantity:z.number().nonnegative(),variance_reason:z.string().trim().max(2000).optional()}).parse(req.body);
 const [c]=await query<any>(`select * from stock_counts where id=$1 and org_id=$2`,[cid,req.user!.org_id]);if(!c)throw new AppError(404,'Stock count not found');
 if(c.status!=='open')throw new AppError(409,'Lines of a submitted count are immutable');
 if(Number(c.counted_by)!==req.user!.id)throw new AppError(403,'Only the counter records count lines');
 const [l]=await query(`insert into stock_count_lines(org_id,stock_count_id,inventory_item_id,counted_quantity,variance_reason) values($1,$2,$3,$4::numeric,$5) on conflict (stock_count_id,inventory_item_id) do update set counted_quantity=excluded.counted_quantity,variance_reason=excluded.variance_reason returning *`,[req.user!.org_id,cid,b.inventory_item_id,String(b.counted_quantity),b.variance_reason??null]);
 res.status(201).json({success:true,data:l});
}));
const snapshotSql=`select coalesce(sum(quantity),0)::numeric(18,3) as system_quantity, ${carriedCostSql} as carried_cost from inventory_transactions where org_id=$1 and warehouse_id=$2 and inventory_item_id=$3`;
inventoryRouter.post('/stock-counts/:id/submit',authorize('procurement','edit'),asyncHandler(async(req,res)=>{
 const cid=parseId(req.params.id);
 const data=await inTx(async client=>{
  const c=(await client.query(`select * from stock_counts where id=$1 and org_id=$2 for update`,[cid,req.user!.org_id])).rows[0];if(!c)throw new AppError(404,'Stock count not found');
  if(c.status!=='open')throw new AppError(409,'Only an open count can be submitted');
  if(Number(c.counted_by)!==req.user!.id)throw new AppError(403,'Only the counter submits the count sheet');
  for(const l of (await client.query(`select * from stock_count_lines where stock_count_id=$1`,[cid])).rows){
   const s=(await client.query(snapshotSql,[c.org_id,c.warehouse_id,l.inventory_item_id])).rows[0];
   await client.query(`update stock_count_lines set system_quantity=$2::numeric,unit_cost=$3::numeric where id=$1`,[l.id,s.system_quantity,s.carried_cost]);
  }
  return (await client.query(`update stock_counts set status='submitted',submitted_at=now() where id=$1 returning *`,[cid])).rows[0];
 });
 res.json({success:true,data:{...data,lines:await query(`select * from stock_count_lines where stock_count_id=$1 order by id`,[cid])}});
}));
inventoryRouter.post('/stock-counts/:id/decision',authorize('procurement','approve'),asyncHandler(async(req,res)=>{
 const cid=parseId(req.params.id);const b=z.object({decision:z.enum(['approved','rejected']),reason:z.string().trim().max(2000).optional()}).parse(req.body);
 const data=await inTx(async client=>{
  const c=(await client.query(`select * from stock_counts where id=$1 and org_id=$2 for update`,[cid,req.user!.org_id])).rows[0];if(!c)throw new AppError(404,'Stock count not found');
  if(c.status!=='submitted')throw new AppError(409,'Only a submitted count can be decided');
  if(Number(c.counted_by)===req.user!.id)throw new AppError(403,'Segregation of duties: the counter cannot approve own count');
  if(b.decision==='rejected'){if((b.reason??'').length<5)throw new AppError(400,'A rejected count needs a reason');return (await client.query(`update stock_counts set status='rejected',decided_by=$2,decided_at=now(),rejection_reason=$3 where id=$1 returning *`,[cid,req.user!.id,b.reason])).rows[0];}
  await client.query('select id from warehouses where id=$1 for update',[c.warehouse_id]);
  const lines=(await client.query(`select * from stock_count_lines where stock_count_id=$1 order by id`,[cid])).rows;
  for(const l of lines){const s=(await client.query(snapshotSql,[c.org_id,c.warehouse_id,l.inventory_item_id])).rows[0];
   const moved=(await client.query(`select $1::numeric <> $2::numeric as moved`,[s.system_quantity,l.system_quantity])).rows[0].moved;
   if(moved)throw new AppError(409,`Stock of item ${l.inventory_item_id} moved since the count was submitted; recount`);}
  const u=(await client.query(`update stock_counts set status='approved',decided_by=$2,decided_at=now() where id=$1 returning *`,[cid,req.user!.id])).rows[0];
  for(const l of lines.filter((x:any)=>Number(x.variance)!==0))
   await client.query(`insert into inventory_transactions(org_id,warehouse_id,inventory_item_id,transaction_type,quantity,unit_cost,transaction_date,source_table,source_record_id,created_by,reason) values($1,$2,$3,'adjustment',$4::numeric,$5::numeric,current_date,'stock_count',$6,$7,$8)`,[c.org_id,c.warehouse_id,l.inventory_item_id,l.variance,l.unit_cost,l.id,req.user!.id,`Stock count ${cid}: ${l.variance_reason}`]);
  return u;
 });
 res.json({success:true,data});
}));
