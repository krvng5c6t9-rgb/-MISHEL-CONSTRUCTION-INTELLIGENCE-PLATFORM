import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const commercialPlatformRouter = Router();
commercialPlatformRouter.use(authorize('commercial_platform','view'));

commercialPlatformRouter.get('/summary', asyncHandler(async (_req,res)=>{
  const [plans,subscriptions,onboarding,usage,connections] = await Promise.all([
    query<any>('select count(*)::int n from subscription_plans where is_active=true'),
    query<any>("select count(*)::int n from tenant_subscriptions where status in ('trial','active','past_due','suspended')"),
    query<any>("select count(*)::int n from customer_onboarding where stage not in ('completed')"),
    query<any>('select count(*)::int n,coalesce(sum(quantity),0)::numeric qty from usage_events'),
    query<any>("select count(*)::int n from integration_connections where status='active'")
  ]);
  res.json({success:true,data:{plans:plans[0]?.n||0,subscriptions:subscriptions[0]?.n||0,onboarding_open:onboarding[0]?.n||0,usage_events:usage[0]?.n||0,usage_quantity:Number(usage[0]?.qty||0),active_connections:connections[0]?.n||0}});
}));

commercialPlatformRouter.get('/plans', asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select * from subscription_plans order by id')})));
commercialPlatformRouter.post('/plans', authorize('commercial_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({plan_key:z.string().min(1).max(80),name:z.string().min(1).max(160),description:z.string().optional().nullable(),billing_period:z.enum(['monthly','annual','custom']).default('monthly'),base_price:z.number().nonnegative().default(0),currency:z.string().length(3).default('USD'),seat_limit:z.number().int().positive().nullable().optional(),project_limit:z.number().int().positive().nullable().optional(),storage_gb_limit:z.number().nonnegative().nullable().optional(),ai_credit_limit:z.number().nonnegative().nullable().optional(),metadata:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into subscription_plans(plan_key,name,description,billing_period,base_price,currency,seat_limit,project_limit,storage_gb_limit,ai_credit_limit,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[b.plan_key,b.name,b.description??null,b.billing_period,b.base_price,b.currency.toUpperCase(),b.seat_limit??null,b.project_limit??null,b.storage_gb_limit??null,b.ai_credit_limit??null,b.metadata]);
  res.status(201).json({success:true,data:r});
}));

commercialPlatformRouter.get('/subscription', asyncHandler(async(_req,res)=>res.json({success:true,data:(await query(`select s.*,p.plan_key,p.name plan_name from tenant_subscriptions s join subscription_plans p on p.id=s.plan_id order by s.created_at desc limit 20`))}))); 
commercialPlatformRouter.post('/subscription', authorize('commercial_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({plan_id:z.number().int().positive(),status:z.enum(['trial','active','past_due','suspended','cancelled','expired']).default('trial'),trial_ends_at:z.string().nullable().optional(),current_period_start:z.string().nullable().optional(),current_period_end:z.string().nullable().optional(),seats_purchased:z.number().int().positive().nullable().optional(),override_entitlements:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into tenant_subscriptions(plan_id,status,trial_ends_at,current_period_start,current_period_end,seats_purchased,override_entitlements,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[b.plan_id,b.status,b.trial_ends_at??null,b.current_period_start??null,b.current_period_end??null,b.seats_purchased??null,b.override_entitlements,req.user!.id]);
  res.status(201).json({success:true,data:r});
}));

commercialPlatformRouter.get('/usage', asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select meter_key,unit,count(*)::int events,coalesce(sum(quantity),0)::numeric quantity,max(occurred_at) last_event from usage_events group by meter_key,unit order by meter_key`)})));
commercialPlatformRouter.post('/usage', authorize('commercial_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({project_id:z.number().int().positive().nullable().optional(),meter_key:z.string().min(1).max(120),quantity:z.number().positive().default(1),unit:z.string().min(1).max(40).default('count'),source_type:z.string().max(80).nullable().optional(),source_id:z.string().nullable().optional(),idempotency_key:z.string().max(180).nullable().optional(),metadata:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into usage_events(project_id,meter_key,quantity,unit,source_type,source_id,idempotency_key,metadata) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[b.project_id??null,b.meter_key,b.quantity,b.unit,b.source_type??null,b.source_id??null,b.idempotency_key??null,b.metadata]);
  res.status(201).json({success:true,data:r});
}));

commercialPlatformRouter.get('/onboarding', asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select * from customer_onboarding order by created_at desc')})));
commercialPlatformRouter.post('/onboarding', authorize('commercial_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({stage:z.enum(['discovery','configuration','migration','integration','training','uat','go_live','completed','blocked']).default('discovery'),owner_user_id:z.number().int().positive().nullable().optional(),checklist:z.array(z.any()).default([]),migration_status:z.record(z.any()).default({}),integration_status:z.record(z.any()).default({}),training_status:z.record(z.any()).default({}),go_live_target:z.string().nullable().optional()}).parse(req.body);
  const [r]=await query(`insert into customer_onboarding(stage,owner_user_id,checklist,migration_status,integration_status,training_status,go_live_target) values($1,$2,$3,$4,$5,$6,$7) returning *`,[b.stage,b.owner_user_id??null,b.checklist,b.migration_status,b.integration_status,b.training_status,b.go_live_target??null]);
  res.status(201).json({success:true,data:r});
}));
