import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const aiPlatformRouter = Router();
aiPlatformRouter.use(authorize('ai_platform','view'));

const modelSchema = z.object({
  provider:z.string().trim().min(1).max(80), model_key:z.string().trim().min(1).max(160), display_name:z.string().trim().min(1).max(160),
  use_case:z.string().nullable().optional(), data_class:z.string().max(40).nullable().optional(), cost_class:z.string().max(40).nullable().optional(),
  fallback_model_id:z.number().int().positive().nullable().optional(), is_approved:z.boolean().default(false), status:z.enum(['draft','active','suspended','deprecated','retired']).default('draft'),
  deprecation_review_date:z.string().nullable().optional(), metadata:z.record(z.any()).default({})
});
const toolSchema = z.object({
  tool_key:z.string().trim().min(1).max(120), name:z.string().trim().min(1).max(160), description:z.string().nullable().optional(),
  risk_class:z.enum(['R0','R1','R2','R3','R4','R5']).default('R1'), input_schema:z.record(z.any()).default({}), output_schema:z.record(z.any()).default({}),
  auth_type:z.string().max(50).nullable().optional(), permission_scope:z.record(z.any()).default({}), timeout_ms:z.number().int().min(100).max(600000).default(30000),
  approval_required:z.boolean().default(false), side_effects:z.string().nullable().optional(), is_enabled:z.boolean().default(true), metadata:z.record(z.any()).default({})
});
const promptSchema = z.object({
  prompt_key:z.string().trim().min(1).max(120), version:z.string().trim().min(1).max(40), purpose:z.string().nullable().optional(), system_prompt:z.string().min(1),
  output_schema:z.record(z.any()).default({}), prohibited_actions:z.array(z.any()).default([]), status:z.enum(['draft','approved','active','superseded','retired']).default('draft')
});
const agentSchema = z.object({
  agent_key:z.string().trim().min(1).max(120), name:z.string().trim().min(1).max(160), purpose:z.string().min(1), owner_user_id:z.number().int().positive().nullable().optional(),
  model_id:z.number().int().positive().nullable().optional(), prompt_id:z.number().int().positive().nullable().optional(), risk_level:z.enum(['low','medium','high','critical']).default('medium'),
  memory_mode:z.enum(['none','conversation','task','business','hybrid']).default('task'), write_access:z.boolean().default(false), human_approval_required:z.boolean().default(true),
  max_steps:z.number().int().min(1).max(200).default(12), timeout_seconds:z.number().int().min(5).max(3600).default(120), cost_limit:z.number().nonnegative().nullable().optional(),
  fallback_policy:z.record(z.any()).default({}), kill_switch:z.boolean().default(false), status:z.enum(['draft','active','suspended','retired']).default('draft'), metadata:z.record(z.any()).default({})
});
const workflowSchema = z.object({
  workflow_key:z.string().trim().min(1).max(120), name:z.string().trim().min(1).max(160), trigger_type:z.string().trim().min(1).max(40).default('manual'),
  orchestrator_agent_id:z.number().int().positive().nullable().optional(), definition:z.record(z.any()).default({}), retry_policy:z.record(z.any()).default({}),
  idempotency_required:z.boolean().default(true), human_approval_policy:z.record(z.any()).default({}), is_enabled:z.boolean().default(false), version:z.string().max(40).default('1.0.0')
});
const evalSchema = z.object({
  agent_id:z.number().int().positive().nullable().optional(), model_id:z.number().int().positive().nullable().optional(), prompt_id:z.number().int().positive().nullable().optional(),
  evaluation_name:z.string().trim().min(1).max(160), dataset_ref:z.string().nullable().optional(), metrics:z.record(z.any()).default({}), pass_thresholds:z.record(z.any()).default({}),
  results:z.record(z.any()).default({}), passed:z.boolean().nullable().optional(), failure_classes:z.array(z.any()).default([])
});

function registryRoutes(path:string, table:string, schema:z.ZodTypeAny, columns:string[]) {
  aiPlatformRouter.get(path, asyncHandler(async(_req,res)=> res.json({success:true,data:await query(`select * from ${table} order by id desc limit 1000`)})));
  aiPlatformRouter.post(path, authorize('ai_platform','manage'), asyncHandler(async(req,res)=>{
    const b=schema.parse(req.body) as Record<string,unknown>;
    const keys=columns.filter(k=>Object.prototype.hasOwnProperty.call(b,k));
    const vals=keys.map(k=>b[k]);
    const sql=`insert into ${table} (${keys.join(',')}${keys.length?',':''}created_by) values (${keys.map((_,i)=>`$${i+1}`).join(',')}${keys.length?',':''}$${keys.length+1}) returning *`;
    const [r]=await query(sql,[...vals,req.user!.id]); res.status(201).json({success:true,data:r});
  }));
  aiPlatformRouter.patch(`${path}/:id`, authorize('ai_platform','manage'), asyncHandler(async(req,res)=>{
    const b=schema.partial().parse(req.body) as Record<string,unknown>;
    const keys=columns.filter(k=>Object.prototype.hasOwnProperty.call(b,k)); if(!keys.length)return res.status(400).json({success:false,error:'No supported fields supplied'});
    const vals=keys.map(k=>b[k]); const set=keys.map((k,i)=>`${k}=$${i+2}`).join(',');
    const rows=await query(`update ${table} set ${set}${['ai_models','ai_tools','ai_agents','ai_workflows'].includes(table)?',updated_at=now()':''} where id=$1 returning *`,[Number(req.params.id),...vals]);
    if(!rows.length)return res.status(404).json({success:false,error:'Record not found'}); res.json({success:true,data:rows[0]});
  }));
}

registryRoutes('/models','ai_models',modelSchema,['provider','model_key','display_name','use_case','data_class','cost_class','fallback_model_id','is_approved','status','deprecation_review_date','metadata']);
registryRoutes('/tools','ai_tools',toolSchema,['tool_key','name','description','risk_class','input_schema','output_schema','auth_type','permission_scope','timeout_ms','approval_required','side_effects','is_enabled','metadata']);
registryRoutes('/prompts','ai_prompts',promptSchema,['prompt_key','version','purpose','system_prompt','output_schema','prohibited_actions','status']);
registryRoutes('/agents','ai_agents',agentSchema,['agent_key','name','purpose','owner_user_id','model_id','prompt_id','risk_level','memory_mode','write_access','human_approval_required','max_steps','timeout_seconds','cost_limit','fallback_policy','kill_switch','status','metadata']);
registryRoutes('/workflows','ai_workflows',workflowSchema,['workflow_key','name','trigger_type','orchestrator_agent_id','definition','retry_policy','idempotency_required','human_approval_policy','is_enabled','version']);

aiPlatformRouter.post('/agents/:agentId/tools/:toolId', authorize('ai_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({can_read:z.boolean().default(true),can_write:z.boolean().default(false),can_execute_external:z.boolean().default(false),approval_override:z.boolean().nullable().optional(),constraints:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into ai_agent_tools(agent_id,tool_id,can_read,can_write,can_execute_external,approval_override,constraints) values($1,$2,$3,$4,$5,$6,$7) on conflict(agent_id,tool_id) do update set can_read=excluded.can_read,can_write=excluded.can_write,can_execute_external=excluded.can_execute_external,approval_override=excluded.approval_override,constraints=excluded.constraints returning *`,[Number(req.params.agentId),Number(req.params.toolId),b.can_read,b.can_write,b.can_execute_external,b.approval_override??null,b.constraints]);
  res.json({success:true,data:r});
}));

aiPlatformRouter.get('/agents/:agentId/tools', asyncHandler(async(req,res)=>res.json({success:true,data:await query(`select at.*,t.tool_key,t.name,t.risk_class,t.approval_required from ai_agent_tools at join ai_tools t on t.id=at.tool_id where at.agent_id=$1 order by t.name`,[Number(req.params.agentId)])})));

aiPlatformRouter.get('/runs', asyncHandler(async(req,res)=>{
  const status=String(req.query.status||''); const projectId=Number(req.query.project_id||0);
  const rows=await query(`select r.*,a.name agent_name,w.name workflow_name from ai_runs r left join ai_agents a on a.id=r.agent_id left join ai_workflows w on w.id=r.workflow_id where ($1='' or r.status=$1) and ($2::bigint=0 or r.project_id=$2) order by r.created_at desc limit 1000`,[status,projectId]);
  res.json({success:true,data:rows});
}));

aiPlatformRouter.post('/runs', authorize('ai_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({project_id:z.number().int().positive().nullable().optional(),workflow_id:z.number().int().positive().nullable().optional(),agent_id:z.number().int().positive().nullable().optional(),input_payload:z.record(z.any()).default({}),source_refs:z.array(z.any()).default([])}).parse(req.body);
  const [r]=await query(`insert into ai_runs(project_id,workflow_id,agent_id,requested_by,input_payload,source_refs,status) values($1,$2,$3,$4,$5,$6,'queued') returning *`,[b.project_id??null,b.workflow_id??null,b.agent_id??null,req.user!.id,b.input_payload,b.source_refs]);
  res.status(201).json({success:true,data:r});
}));

aiPlatformRouter.patch('/runs/:id/status', authorize('ai_platform','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({status:z.enum(['queued','running','waiting_approval','succeeded','failed','cancelled','blocked']),output_payload:z.record(z.any()).optional(),tool_calls:z.array(z.any()).optional(),approval_events:z.array(z.any()).optional(),prompt_version:z.string().max(80).optional(),model_key:z.string().max(160).optional(),input_tokens:z.number().int().nonnegative().optional(),output_tokens:z.number().int().nonnegative().optional(),estimated_cost:z.number().nonnegative().optional(),latency_ms:z.number().int().nonnegative().optional(),error_code:z.string().max(80).nullable().optional(),error_message:z.string().nullable().optional()}).parse(req.body);
  const [r]=await query(`update ai_runs set status=$2,output_payload=coalesce($3,output_payload),tool_calls=coalesce($4,tool_calls),approval_events=coalesce($5,approval_events),prompt_version=coalesce($6,prompt_version),model_key=coalesce($7,model_key),input_tokens=coalesce($8,input_tokens),output_tokens=coalesce($9,output_tokens),estimated_cost=coalesce($10,estimated_cost),latency_ms=coalesce($11,latency_ms),error_code=$12,error_message=$13,started_at=case when $2='running' and started_at is null then now() else started_at end,completed_at=case when $2 in ('succeeded','failed','cancelled','blocked') then now() else completed_at end where id=$1 returning *`,[Number(req.params.id),b.status,b.output_payload??null,b.tool_calls??null,b.approval_events??null,b.prompt_version??null,b.model_key??null,b.input_tokens??null,b.output_tokens??null,b.estimated_cost??null,b.latency_ms??null,b.error_code??null,b.error_message??null]);
  if(!r)return res.status(404).json({success:false,error:'Run not found'});res.json({success:true,data:r});
}));

aiPlatformRouter.get('/evaluations', asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select e.*,a.name agent_name,m.display_name model_name,p.prompt_key,p.version prompt_version from ai_evaluations e left join ai_agents a on a.id=e.agent_id left join ai_models m on m.id=e.model_id left join ai_prompts p on p.id=e.prompt_id order by e.evaluated_at desc limit 1000`)})));
aiPlatformRouter.post('/evaluations', authorize('ai_platform','manage'), asyncHandler(async(req,res)=>{const b=evalSchema.parse(req.body);const [r]=await query(`insert into ai_evaluations(agent_id,model_id,prompt_id,evaluation_name,dataset_ref,metrics,pass_thresholds,results,passed,failure_classes,reviewed_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,[b.agent_id??null,b.model_id??null,b.prompt_id??null,b.evaluation_name,b.dataset_ref??null,b.metrics,b.pass_thresholds,b.results,b.passed??null,b.failure_classes,req.user!.id]);res.status(201).json({success:true,data:r});}));

aiPlatformRouter.get('/summary', asyncHandler(async(_req,res)=>{
  const [models,agents,tools,workflows,runs,failed,cost]=await Promise.all([
    query<any>('select count(*)::int n from ai_models'),query<any>('select count(*)::int n from ai_agents'),query<any>('select count(*)::int n from ai_tools'),query<any>('select count(*)::int n from ai_workflows'),query<any>('select count(*)::int n from ai_runs'),query<any>("select count(*)::int n from ai_runs where status='failed'"),query<any>('select coalesce(sum(estimated_cost),0)::numeric total from ai_runs')
  ]);
  res.json({success:true,data:{models:models[0]?.n||0,agents:agents[0]?.n||0,tools:tools[0]?.n||0,workflows:workflows[0]?.n||0,runs:runs[0]?.n||0,failed_runs:failed[0]?.n||0,estimated_cost:Number(cost[0]?.total||0)}});
}));
