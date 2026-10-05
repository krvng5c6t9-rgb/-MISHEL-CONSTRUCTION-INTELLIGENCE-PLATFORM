import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const automationRouter = Router();
automationRouter.use(authorize('automation','view'));

automationRouter.get('/summary', asyncHandler(async(_req,res)=>{
  const [workflows,executions,failed,connections,hooks]=await Promise.all([
    query<any>("select count(*)::int n from automation_workflows where status='active'"),
    query<any>('select count(*)::int n from automation_executions'),
    query<any>("select count(*)::int n from automation_executions where status in ('failed','dead_letter')"),
    query<any>("select count(*)::int n from integration_connections where status='active'"),
    query<any>('select count(*)::int n from webhook_subscriptions where is_active=true')
  ]);
  res.json({success:true,data:{active_workflows:workflows[0]?.n||0,executions:executions[0]?.n||0,failed_executions:failed[0]?.n||0,active_connections:connections[0]?.n||0,active_webhooks:hooks[0]?.n||0}});
}));

automationRouter.get('/connections', asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select id,connection_key,provider,connection_type,status,scopes,last_health_at,last_health_status,created_at from integration_connections order by id desc')})));
automationRouter.post('/connections', authorize('automation','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({connection_key:z.string().min(1).max(120),provider:z.string().min(1).max(120),connection_type:z.enum(['api','oauth','webhook','mcp','database','email','storage','messaging','other']),status:z.enum(['draft','active','degraded','disabled','revoked']).default('draft'),config:z.record(z.any()).default({}),secret_ref:z.string().nullable().optional(),scopes:z.array(z.any()).default([])}).parse(req.body);
  const [r]=await query(`insert into integration_connections(connection_key,provider,connection_type,status,config,secret_ref,scopes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,connection_key,provider,connection_type,status,scopes,created_at`,[b.connection_key,b.provider,b.connection_type,b.status,b.config,b.secret_ref??null,b.scopes,req.user!.id]);
  res.status(201).json({success:true,data:r});
}));

automationRouter.get('/workflows', asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select * from automation_workflows order by id desc')})));
automationRouter.post('/workflows', authorize('automation','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({workflow_key:z.string().min(1).max(120),name:z.string().min(1).max(180),engine:z.enum(['internal','n8n','external']).default('internal'),trigger_type:z.string().min(1).max(60),trigger_config:z.record(z.any()).default({}),definition:z.record(z.any()).default({}),version:z.string().max(40).default('1.0.0'),status:z.enum(['draft','active','paused','retired']).default('draft'),approval_policy:z.record(z.any()).default({}),retry_policy:z.record(z.any()).default({}),concurrency_limit:z.number().int().min(1).max(1000).default(1),idempotency_required:z.boolean().default(true),timeout_seconds:z.number().int().min(1).max(86400).default(300),owner_user_id:z.number().int().positive().nullable().optional()}).parse(req.body);
  const [r]=await query(`insert into automation_workflows(workflow_key,name,engine,trigger_type,trigger_config,definition,version,status,approval_policy,retry_policy,concurrency_limit,idempotency_required,timeout_seconds,owner_user_id,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,[b.workflow_key,b.name,b.engine,b.trigger_type,b.trigger_config,b.definition,b.version,b.status,b.approval_policy,b.retry_policy,b.concurrency_limit,b.idempotency_required,b.timeout_seconds,b.owner_user_id??null,req.user!.id]);
  res.status(201).json({success:true,data:r});
}));

automationRouter.get('/executions', asyncHandler(async(req,res)=>{const status=String(req.query.status||'');res.json({success:true,data:await query(`select e.*,w.name workflow_name,w.engine from automation_executions e join automation_workflows w on w.id=e.workflow_id where ($1='' or e.status=$1) order by e.created_at desc limit 1000`,[status])});}));
automationRouter.post('/executions', authorize('automation','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({workflow_id:z.number().int().positive(),project_id:z.number().int().positive().nullable().optional(),idempotency_key:z.string().max(180).nullable().optional(),trigger_payload:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into automation_executions(workflow_id,project_id,idempotency_key,trigger_payload,status) values($1,$2,$3,$4,'queued') returning *`,[b.workflow_id,b.project_id??null,b.idempotency_key??null,b.trigger_payload]);
  res.status(201).json({success:true,data:r});
}));

automationRouter.patch('/executions/:id/status', authorize('automation','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({status:z.enum(['queued','running','waiting_approval','succeeded','failed','cancelled','dead_letter']),output_payload:z.record(z.any()).optional(),step_log:z.array(z.any()).optional(),retry_count:z.number().int().nonnegative().optional(),error_code:z.string().max(100).nullable().optional(),error_message:z.string().nullable().optional()}).parse(req.body);
  const [r]=await query(`update automation_executions set status=$2,output_payload=coalesce($3,output_payload),step_log=coalesce($4,step_log),retry_count=coalesce($5,retry_count),error_code=$6,error_message=$7,started_at=case when $2='running' and started_at is null then now() else started_at end,completed_at=case when $2 in ('succeeded','failed','cancelled','dead_letter') then now() else completed_at end where id=$1 returning *`,[Number(req.params.id),b.status,b.output_payload??null,b.step_log??null,b.retry_count??null,b.error_code??null,b.error_message??null]);
  if(!r)return res.status(404).json({success:false,error:'Execution not found'});res.json({success:true,data:r});
}));
