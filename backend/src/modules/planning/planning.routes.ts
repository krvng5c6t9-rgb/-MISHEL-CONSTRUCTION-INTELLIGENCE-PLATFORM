import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const planningRouter = Router();
planningRouter.use(authorize('planning', 'view'));

const baselineSchema = z.object({
  project_id: z.number().int().positive(),
  baseline_name: z.string().trim().min(1).max(100),
  baseline_date: z.string().optional(),
  is_current: z.boolean().default(false)
});

const activitySchema = z.object({
  project_id: z.number().int().positive(),
  cost_code_id: z.number().int().positive().nullable().optional(),
  baseline_id: z.number().int().positive().nullable().optional(),
  activity_id_ext: z.string().trim().max(30).nullable().optional(),
  activity_name: z.string().trim().min(1).max(255),
  planned_start: z.string().nullable().optional(),
  planned_finish: z.string().nullable().optional(),
  planned_duration_days: z.number().int().nonnegative().nullable().optional(),
  actual_start: z.string().nullable().optional(),
  actual_finish: z.string().nullable().optional()
});

const milestoneSchema = z.object({
  project_id: z.number().int().positive(),
  milestone_name: z.string().trim().min(1).max(200),
  planned_date: z.string().nullable().optional(),
  actual_date: z.string().nullable().optional(),
  is_contractual: z.boolean().default(false),
  payment_trigger_flag: z.boolean().default(false)
});

planningRouter.get('/baselines', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select * from schedule_baselines where ($1::bigint = 0 or project_id=$1) order by is_current desc, baseline_date desc, id desc`, [projectId]);
  res.json({ success: true, data: rows });
}));

planningRouter.post('/baselines', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const body = baselineSchema.parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    if (body.is_current) await client.query('update schedule_baselines set is_current=false where project_id=$1', [body.project_id]);
    const created = await client.query(`insert into schedule_baselines (project_id, baseline_name, baseline_date, is_current, created_by) values ($1,$2,coalesce($3::date,current_date),$4,$5) returning *`, [body.project_id, body.baseline_name, body.baseline_date ?? null, body.is_current, req.user!.id]);
    await client.query('commit');
    res.status(201).json({ success: true, data: created.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { await releaseClient(client); }
}));

planningRouter.patch('/baselines/:id/current', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const client = await getClient();
  try {
    await client.query('begin');
    const found = await client.query('select id, project_id from schedule_baselines where id=$1 for update', [id]);
    if (!found.rowCount) { await client.query('rollback'); return res.status(404).json({ success:false, error:'Baseline not found' }); }
    const projectId = found.rows[0].project_id;
    await client.query('update schedule_baselines set is_current=false where project_id=$1', [projectId]);
    const updated = await client.query('update schedule_baselines set is_current=true where id=$1 returning *', [id]);
    await client.query('commit');
    res.json({ success:true, data:updated.rows[0] });
  } catch (error) { await client.query('rollback'); throw error; }
  finally { await releaseClient(client); }
}));

planningRouter.delete('/baselines/:id', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const id=Number(req.params.id);
  const refs=await query<{count:string}>('select count(*)::text count from schedule_activities where baseline_id=$1',[id]);
  if(Number(refs[0]?.count||0)>0) return res.status(409).json({success:false,error:'Baseline is referenced by schedule activities'});
  const rows=await query('delete from schedule_baselines where id=$1 returning id',[id]);
  if(!rows.length) return res.status(404).json({success:false,error:'Baseline not found'});
  res.json({success:true});
}));

planningRouter.get('/activities', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select a.*, c.code as cost_code, b.baseline_name from schedule_activities a left join cost_codes c on c.id=a.cost_code_id left join schedule_baselines b on b.id=a.baseline_id where ($1::bigint = 0 or a.project_id=$1) order by a.planned_start nulls last, a.id limit 2000`, [projectId]);
  res.json({ success: true, data: rows });
}));

planningRouter.post('/activities', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const body = activitySchema.parse(req.body);
  const [created] = await query(`insert into schedule_activities (project_id,cost_code_id,baseline_id,activity_id_ext,activity_name,planned_start,planned_finish,planned_duration_days,actual_start,actual_finish) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [body.project_id,body.cost_code_id??null,body.baseline_id??null,body.activity_id_ext||null,body.activity_name,body.planned_start??null,body.planned_finish??null,body.planned_duration_days??null,body.actual_start??null,body.actual_finish??null]);
  res.status(201).json({ success: true, data: created });
}));

planningRouter.patch('/activities/:id', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const body=activitySchema.partial().omit({project_id:true}).parse(req.body);
  const id=Number(req.params.id); const current=(await query<any>('select * from schedule_activities where id=$1',[id]))[0];
  if(!current) return res.status(404).json({success:false,error:'Activity not found'});
  const values={...current,...body};
  const rows=await query(`update schedule_activities set cost_code_id=$2,baseline_id=$3,activity_id_ext=$4,activity_name=$5,planned_start=$6,planned_finish=$7,planned_duration_days=$8,actual_start=$9,actual_finish=$10,updated_at=now() where id=$1 returning *`,[id,values.cost_code_id??null,values.baseline_id??null,values.activity_id_ext||null,values.activity_name,values.planned_start??null,values.planned_finish??null,values.planned_duration_days??null,values.actual_start??null,values.actual_finish??null]);
  res.json({success:true,data:rows[0]});
}));

planningRouter.delete('/activities/:id', authorize('planning', 'manage'), asyncHandler(async (req,res)=>{
  const id=Number(req.params.id);
  const refs=await query<any>(`select (select count(*) from progress_updates where schedule_activity_id=$1)::int progress_count,(select count(*) from schedule_relationships where predecessor_activity_id=$1 or successor_activity_id=$1)::int relation_count`,[id]);
  if((refs[0]?.progress_count||0)>0 || (refs[0]?.relation_count||0)>0) return res.status(409).json({success:false,error:'Activity has progress or schedule relationships and cannot be deleted'});
  const rows=await query('delete from schedule_activities where id=$1 returning id',[id]); if(!rows.length) return res.status(404).json({success:false,error:'Activity not found'}); res.json({success:true});
}));

planningRouter.patch('/activities/:id/progress', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const body = z.object({ percent_complete: z.number().min(0).max(100), remarks: z.string().max(2000).optional(), boq_item_id: z.number().int().positive().optional() }).parse(req.body);
  const activityId = Number(req.params.id);
  const client=await getClient();
  try{
    await client.query('begin');
    const act=await client.query('select id from schedule_activities where id=$1 for update',[activityId]);
    if(!act.rowCount){await client.query('rollback');return res.status(404).json({success:false,error:'Activity not found'});}
    const progress=await client.query(`insert into progress_updates (schedule_activity_id, percent_complete, updated_by, remarks, boq_item_id) values ($1,$2,$3,$4,$5) returning *`, [activityId, body.percent_complete, req.user!.id, body.remarks ?? null, body.boq_item_id ?? null]);
    await client.query('update schedule_activities set percent_complete=$1, updated_at=now() where id=$2', [body.percent_complete, activityId]);
    await client.query('commit');res.json({ success: true, data: progress.rows[0] });
  }catch(error){await client.query('rollback');throw error;}finally{await releaseClient(client);}
}));

planningRouter.get('/progress-updates', asyncHandler(async (req, res) => {
  const activityId = Number(req.query.activity_id || 0);
  const rows = await query(`select pu.*, sa.activity_name from progress_updates pu join schedule_activities sa on sa.id=pu.schedule_activity_id where ($1::bigint = 0 or pu.schedule_activity_id=$1) order by pu.update_date desc, pu.id desc limit 1000`, [activityId]);
  res.json({ success: true, data: rows });
}));

planningRouter.get('/milestones', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select * from milestones where ($1::bigint = 0 or project_id=$1) order by planned_date nulls last, id`, [projectId]);
  res.json({ success: true, data: rows });
}));
planningRouter.post('/milestones',authorize('planning','manage'),asyncHandler(async(req,res)=>{const b=milestoneSchema.parse(req.body);const [r]=await query(`insert into milestones(project_id,milestone_name,planned_date,actual_date,is_contractual,payment_trigger_flag) values($1,$2,$3,$4,$5,$6) returning *`,[b.project_id,b.milestone_name,b.planned_date??null,b.actual_date??null,b.is_contractual,b.payment_trigger_flag]);res.status(201).json({success:true,data:r});}));
planningRouter.patch('/milestones/:id',authorize('planning','manage'),asyncHandler(async(req,res)=>{const id=Number(req.params.id), b=milestoneSchema.partial().omit({project_id:true}).parse(req.body);const cur=(await query<any>('select * from milestones where id=$1',[id]))[0];if(!cur)return res.status(404).json({success:false,error:'Milestone not found'});const v={...cur,...b};const rows=await query(`update milestones set milestone_name=$2,planned_date=$3,actual_date=$4,is_contractual=$5,payment_trigger_flag=$6,updated_at=now() where id=$1 returning *`,[id,v.milestone_name,v.planned_date??null,v.actual_date??null,v.is_contractual,v.payment_trigger_flag]);res.json({success:true,data:rows[0]});}));

planningRouter.get('/relationships',asyncHandler(async(req,res)=>{const projectId=Number(req.query.project_id||0);res.json({success:true,data:await query(`select r.*,p.activity_id_ext predecessor_code,p.activity_name predecessor_name,s.activity_id_ext successor_code,s.activity_name successor_name from schedule_relationships r join schedule_activities p on p.id=r.predecessor_activity_id join schedule_activities s on s.id=r.successor_activity_id where ($1::bigint=0 or r.project_id=$1) order by r.id`,[projectId])});}));
planningRouter.post('/relationships',authorize('planning','manage'),asyncHandler(async(req,res)=>{const b=z.object({project_id:z.number().int().positive(),predecessor_activity_id:z.number().int().positive(),successor_activity_id:z.number().int().positive(),relationship_type:z.enum(['FS','SS','FF','SF']),lag_days:z.number().int().min(-3650).max(3650).default(0)}).parse(req.body);const [r]=await query(`insert into schedule_relationships(org_id,project_id,predecessor_activity_id,successor_activity_id,relationship_type,lag_days) values($1,$2,$3,$4,$5,$6) returning *`,[req.user!.org_id,b.project_id,b.predecessor_activity_id,b.successor_activity_id,b.relationship_type,b.lag_days]);res.status(201).json({success:true,data:r});}));
planningRouter.delete('/relationships/:id',authorize('planning','manage'),asyncHandler(async(req,res)=>{const rows=await query('delete from schedule_relationships where id=$1 returning id',[Number(req.params.id)]);if(!rows.length)return res.status(404).json({success:false,error:'Relationship not found'});res.json({success:true});}));

planningRouter.get('/cpm',asyncHandler(async(req,res)=>{
 const projectId=Number(req.query.project_id||0);if(!projectId)return res.status(400).json({success:false,error:'project_id is required'});
 const acts=await query<any>(`select id,activity_id_ext,activity_name,coalesce(planned_duration_days,0)::int duration from schedule_activities where project_id=$1 order by id`,[projectId]);
 if(!acts.length)return res.status(404).json({success:false,error:'No schedule activities found for project'});
 const rels=await query<any>(`select predecessor_activity_id pred,successor_activity_id succ,relationship_type type,lag_days lag from schedule_relationships where project_id=$1`,[projectId]);
 const ids=acts.map(a=>Number(a.id)), by=new Map(acts.map(a=>[Number(a.id),a])); const incoming=new Map<number,any[]>(),outgoing=new Map<number,any[]>(),indeg=new Map(ids.map(id=>[id,0]));
 for(const r of rels){const p=Number(r.pred),s=Number(r.succ);if(!by.has(p)||!by.has(s))throw new Error('Schedule relationship references an activity outside the selected project');(incoming.get(s)??incoming.set(s,[]).get(s)!).push(r);(outgoing.get(p)??outgoing.set(p,[]).get(p)!).push(r);indeg.set(s,(indeg.get(s)||0)+1)}
 const q=ids.filter(id=>(indeg.get(id)||0)===0),order:number[]=[];while(q.length){const n=q.shift()!;order.push(n);for(const r of outgoing.get(n)||[]){const s=Number(r.succ);indeg.set(s,(indeg.get(s)||0)-1);if(indeg.get(s)===0)q.push(s)}}if(order.length!==ids.length)throw new Error('Schedule contains a relationship cycle');
 const es=new Map<number,number>(),ef=new Map<number,number>();for(const id of order){const dur=Number(by.get(id).duration||0);let start=0;for(const r of incoming.get(id)||[]){const p=Number(r.pred),lag=Number(r.lag||0);let c=0;if(r.type==='FS')c=(ef.get(p)||0)+lag;else if(r.type==='SS')c=(es.get(p)||0)+lag;else if(r.type==='FF')c=(ef.get(p)||0)+lag-dur;else c=(es.get(p)||0)+lag-dur;start=Math.max(start,c)}es.set(id,start);ef.set(id,start+dur)}
 const finish=Math.max(0,...ids.map(id=>ef.get(id)||0)),ls=new Map<number,number>(),lf=new Map<number,number>();for(const id of [...order].reverse()){const dur=Number(by.get(id).duration||0);let latestStart=finish-dur;const outs=outgoing.get(id)||[];if(outs.length){latestStart=Infinity;for(const r of outs){const s=Number(r.succ),lag=Number(r.lag||0);let c=finish-dur;if(r.type==='FS')c=(ls.get(s)??finish)-lag-dur;else if(r.type==='SS')c=(ls.get(s)??finish)-lag;else if(r.type==='FF')c=(lf.get(s)??finish)-lag-dur;else c=(lf.get(s)??finish)-lag;latestStart=Math.min(latestStart,c)}}ls.set(id,latestStart);lf.set(id,latestStart+dur)}
 const data=order.map(id=>{const a=by.get(id),tf=(ls.get(id)??0)-(es.get(id)??0),outs=outgoing.get(id)||[];let ff=finish-(ef.get(id)||0);if(outs.length){ff=Math.min(...outs.map((r:any)=>{const s=Number(r.succ),lag=Number(r.lag||0);if(r.type==='FS')return (es.get(s)||0)-(ef.get(id)||0)-lag;if(r.type==='SS')return (es.get(s)||0)-(es.get(id)||0)-lag;if(r.type==='FF')return (ef.get(s)||0)-(ef.get(id)||0)-lag;return (ef.get(s)||0)-(es.get(id)||0)-lag;}));}return{id,activity_id:a.activity_id_ext,name:a.activity_name,duration_days:a.duration,early_start_day:es.get(id),early_finish_day:ef.get(id),late_start_day:ls.get(id),late_finish_day:lf.get(id),total_float_days:tf,free_float_days:ff,is_critical:Math.abs(tf)<1e-9}});
 res.json({success:true,data:{project_duration_days:finish,critical_path:data.filter(x=>x.is_critical).map(x=>x.id),activities:data}});
}));
