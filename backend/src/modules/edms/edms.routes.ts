import { Router } from 'express';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const edmsRouter = Router();
edmsRouter.use(authorize('edms', 'view'));

const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, 'Invalid id');
  return n;
};

edmsRouter.get('/documents', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`
    select d.*, v.id as current_version_id, v.storage_key, v.mime_type, v.file_size_bytes, v.sha256
    from documents d
    left join document_versions v on v.document_id=d.id and v.is_current=true
    where ($1::bigint=0 or d.project_id=$1)
    order by d.updated_at desc, d.id desc limit 500`, [projectId]);
  res.json({ success: true, data: rows });
}));

edmsRouter.get('/documents/:id/versions', asyncHandler(async (req, res) => {
  const rows = await query(`select * from document_versions where document_id=$1 order by version_no desc`, [id(req.params.id)]);
  res.json({ success: true, data: rows });
}));

edmsRouter.post('/documents', authorize('edms', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({
    project_id: z.number().int().positive(), module_source: z.string().min(1).max(60).default('edms'),
    record_type: z.string().min(1).max(60).default('controlled_document'), doc_number: z.string().min(1).max(50),
    file_name: z.string().min(1).max(255), storage_key: z.string().min(1), revision: z.string().max(20).optional(),
    confidentiality: z.enum(['public','internal','restricted']).default('internal'), mime_type: z.string().max(150).optional(),
    file_size_bytes: z.number().int().nonnegative().optional(), sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional()
  }).parse(req.body);
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const d = (await c.query(`insert into documents(org_id,project_id,module_source,record_type,file_name,file_path,version_no,revision,doc_number,status,confidentiality,uploaded_by)
      values($1,$2,$3,$4,$5,$6,1,$7,$8,'draft',$9,$10) returning *`,
      [req.user!.org_id,b.project_id,b.module_source,b.record_type,b.file_name,b.storage_key,b.revision??null,b.doc_number,b.confidentiality,req.user!.id])).rows[0];
    const v = (await c.query(`insert into document_versions(org_id,document_id,project_id,version_no,revision,file_name,storage_key,mime_type,file_size_bytes,sha256,uploaded_by,is_current)
      values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,true) returning *`,
      [req.user!.org_id,d.id,b.project_id,b.revision??null,b.file_name,b.storage_key,b.mime_type??null,b.file_size_bytes??null,b.sha256??null,req.user!.id])).rows[0];
    await c.query('COMMIT');
    res.status(201).json({ success:true, data:{...d,current_version:v} });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await releaseClient(c); }
}));

edmsRouter.post('/documents/:id/versions', authorize('edms', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ file_name:z.string().min(1).max(255), storage_key:z.string().min(1), revision:z.string().max(20).optional(), mime_type:z.string().max(150).optional(), file_size_bytes:z.number().int().nonnegative().optional(), sha256:z.string().regex(/^[0-9a-fA-F]{64}$/).optional() }).parse(req.body);
  const documentId=id(req.params.id); const c=await getClient();
  try {
    await c.query('BEGIN');
    const d=(await c.query(`select * from documents where id=$1 for update`,[documentId])).rows[0];
    if(!d) throw new AppError(404, 'Document not found');
    if(d.status==='for_approval') throw new AppError(409, 'Cannot revise a document while it is under approval');
    const next=Number((await c.query(`select coalesce(max(version_no),0)+1 n from document_versions where document_id=$1`,[documentId])).rows[0].n);
    await c.query(`update document_versions set is_current=false where document_id=$1 and is_current=true`,[documentId]);
    const v=(await c.query(`insert into document_versions(org_id,document_id,project_id,version_no,revision,file_name,storage_key,mime_type,file_size_bytes,sha256,uploaded_by,is_current)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) returning *`,[req.user!.org_id,documentId,d.project_id,next,b.revision??null,b.file_name,b.storage_key,b.mime_type??null,b.file_size_bytes??null,b.sha256??null,req.user!.id])).rows[0];
    await c.query(`update documents set version_no=$2,revision=$3,file_name=$4,file_path=$5,status='draft',uploaded_by=$6,updated_at=now() where id=$1`,[documentId,next,b.revision??null,b.file_name,b.storage_key,req.user!.id]);
    await c.query('COMMIT'); res.status(201).json({success:true,data:v});
  } catch(e){await c.query('ROLLBACK');throw e;} finally{await releaseClient(c);}
}));

edmsRouter.post('/documents/:id/submit', authorize('edms', 'edit'), asyncHandler(async (req,res)=>{
  const rows=await query(`update documents set status='for_approval',updated_at=now() where id=$1 and status in ('draft','rejected') returning *`,[id(req.params.id)]);
  if(!rows[0]) return res.status(409).json({success:false,error:'Document is not in a submittable state'});
  res.json({success:true,data:rows[0]});
}));

edmsRouter.post('/documents/:id/review', authorize('edms', 'approve'), asyncHandler(async (req,res)=>{
  // CC-029: the decision is recorded on the reviewed (current) revision with reviewer, time and reason (ED2).
  const b=z.object({action:z.enum(['approved','rejected']), comment:z.string().trim().max(2000).optional()})
    .refine(v=>v.action==='approved'||(v.comment??'').length>=5,{message:'A rejection must state its reason (comment, at least 5 characters)',path:['comment']})
    .parse(req.body);
  const documentId=id(req.params.id); const c=await getClient();
  try{await c.query('BEGIN'); const d=(await c.query(`select * from documents where id=$1 for update`,[documentId])).rows[0];
    if(!d) throw new AppError(404,'Document not found');
    if(d.status!=='for_approval') throw new AppError(409,'Document is not awaiting approval');
    if(Number(d.uploaded_by)===req.user!.id) throw new AppError(403,'Maker cannot approve/reject own document');
    const v=(await c.query(`update document_versions set review_status=$2,reviewed_by=$3,reviewed_at=now(),review_comment=$4 where document_id=$1 and is_current=true and review_status is null returning id`,[documentId,b.action,req.user!.id,b.comment??null])).rows[0];
    if(!v) throw new AppError(409,'Current revision has no pending review');
    const out=(await c.query(`update documents set status=$2,updated_at=now() where id=$1 returning *`,[documentId,b.action])).rows[0];
    await c.query('COMMIT');res.json({success:true,data:out});
  }catch(e){await c.query('ROLLBACK');throw e;}finally{await releaseClient(c);}
}));

edmsRouter.get('/registers', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select * from document_registers where ($1::bigint=0 or project_id=$1) order by register_type, id`, [projectId]);
  res.json({ success: true, data: rows });
}));

edmsRouter.post('/registers', authorize('edms', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), register_type: z.enum(['drawings','correspondence','contracts','submittals','photos']), numbering_scheme: z.string().max(100).optional() }).parse(req.body);
  const [created] = await query(`insert into document_registers (project_id, register_type, numbering_scheme) values ($1,$2,$3) returning *`, [b.project_id, b.register_type, b.numbering_scheme ?? null]);
  res.status(201).json({ success: true, data: created });
}));

edmsRouter.get('/transmittals', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select t.*, (select count(*)::int from transmittal_lines l where l.transmittal_id=t.id) line_count from document_transmittals t where ($1::bigint=0 or project_id=$1) order by issue_date desc, id desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

edmsRouter.get('/transmittals/:id/lines', asyncHandler(async(req,res)=>{
  const rows=await query(`select l.*,d.doc_number,d.file_name,v.version_no,v.storage_key from transmittal_lines l join documents d on d.id=l.document_id join document_versions v on v.id=l.document_version_id where l.transmittal_id=$1 order by l.id`,[id(req.params.id)]);
  res.json({success:true,data:rows});
}));

edmsRouter.post('/transmittals', authorize('edms', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), transmittal_no: z.string().min(1).max(30), from_party: z.string().max(150).optional(), to_party: z.string().max(150).optional(), issue_date: z.string().optional(), purpose: z.enum(['for_approval','for_information','for_construction']).optional() }).parse(req.body);
  const [created] = await query(`insert into document_transmittals (project_id, transmittal_no, from_party, to_party, issue_date, purpose, created_by, status) values ($1,$2,$3,$4,coalesce($5::date,current_date),$6,$7,'draft') returning *`, [b.project_id, b.transmittal_no, b.from_party ?? null, b.to_party ?? null, b.issue_date ?? null, b.purpose ?? null,req.user!.id]);
  res.status(201).json({ success: true, data: created });
}));

edmsRouter.post('/transmittals/:id/lines', authorize('edms', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ document_id: z.number().int().positive(), document_version_id:z.number().int().positive().optional() }).parse(req.body);
  let versionId=b.document_version_id;
  if(!versionId){const rows=await query<{id:number}>(`select id from document_versions where document_id=$1 and is_current=true`,[b.document_id]); if(!rows[0]) return res.status(409).json({success:false,error:'Document has no current version'}); versionId=rows[0].id;}
  const [created] = await query(`insert into transmittal_lines (transmittal_id, document_id, document_version_id) values ($1,$2,$3) returning *`, [id(req.params.id), b.document_id,versionId]);
  res.status(201).json({ success: true, data: created });
}));

edmsRouter.delete('/transmittals/:id/lines/:lineId', authorize('edms','edit'), asyncHandler(async(req,res)=>{
  const rows=await query(`delete from transmittal_lines where id=$1 and transmittal_id=$2 returning id`,[id(req.params.lineId),id(req.params.id)]);
  if(!rows[0]) return res.status(404).json({success:false,error:'Line not found'}); res.json({success:true});
}));

edmsRouter.post('/transmittals/:id/issue', authorize('edms','approve'), asyncHandler(async(req,res)=>{
  const transmittalId=id(req.params.id); const c=await getClient();
  try{await c.query('BEGIN'); const t=(await c.query(`select * from document_transmittals where id=$1 for update`,[transmittalId])).rows[0];
    if(!t) throw new AppError(404,'Transmittal not found');
    if(t.status!=='draft') throw new AppError(409,'Only a draft transmittal can be issued');
    if(Number(t.created_by)===req.user!.id) throw new AppError(403,'Maker cannot issue own transmittal');
    const count=Number((await c.query(`select count(*) n from transmittal_lines where transmittal_id=$1`,[transmittalId])).rows[0].n); if(count<1) throw new AppError(422,'Cannot issue an empty transmittal');
    const out=(await c.query(`update document_transmittals set status='issued',issued_by=$2,issued_at=now() where id=$1 returning *`,[transmittalId,req.user!.id])).rows[0];
    await c.query('COMMIT');res.json({success:true,data:out});
  }catch(e){await c.query('ROLLBACK');throw e;}finally{await releaseClient(c);}
}));

edmsRouter.post('/transmittals/:id/void', authorize('edms','approve'), asyncHandler(async(req,res)=>{
  const b=z.object({reason:z.string().min(5).max(500)}).parse(req.body);
  const rows=await query(`update document_transmittals set status='void',void_reason=$2 where id=$1 and status='issued' returning *`,[id(req.params.id),b.reason]);
  if(!rows[0]) return res.status(409).json({success:false,error:'Only an issued transmittal can be voided'}); res.json({success:true,data:rows[0]});
}));
