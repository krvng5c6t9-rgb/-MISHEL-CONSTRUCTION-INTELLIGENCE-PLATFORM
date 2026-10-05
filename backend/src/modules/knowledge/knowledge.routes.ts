import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const knowledgeRouter=Router();
knowledgeRouter.use(authorize('knowledge','view'));

knowledgeRouter.get('/summary', asyncHandler(async(_req,res)=>{
  const [sources,current,chunks,queries,grounded]=await Promise.all([
    query<any>('select count(*)::int n from knowledge_sources'),query<any>("select count(*)::int n from knowledge_sources where status='current'"),query<any>('select count(*)::int n from knowledge_chunks'),query<any>('select count(*)::int n from knowledge_queries'),query<any>('select count(*)::int n from knowledge_queries where grounded=true')
  ]);
  res.json({success:true,data:{sources:sources[0]?.n||0,current_sources:current[0]?.n||0,chunks:chunks[0]?.n||0,queries:queries[0]?.n||0,grounded_queries:grounded[0]?.n||0}});
}));

knowledgeRouter.get('/sources', asyncHandler(async(req,res)=>{const status=String(req.query.status||'');const type=String(req.query.source_type||'');res.json({success:true,data:await query(`select * from knowledge_sources where ($1='' or status=$1) and ($2='' or source_type=$2) order by authority_level asc,created_at desc`,[status,type])});}));
knowledgeRouter.post('/sources', authorize('knowledge','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({project_id:z.number().int().positive().nullable().optional(),source_key:z.string().min(1).max(160),title:z.string().min(1).max(255),source_type:z.enum(['contract','specification','drawing','boq','procedure','policy','code','standard','manual','correspondence','report','lesson_learned','other']),authority_level:z.number().int().min(1).max(100).default(50),jurisdiction:z.string().max(120).nullable().optional(),discipline:z.string().max(120).nullable().optional(),revision:z.string().max(80).nullable().optional(),status:z.enum(['draft','current','superseded','void','archived']).default('draft'),effective_date:z.string().nullable().optional(),content_ref:z.string().nullable().optional(),checksum:z.string().max(128).nullable().optional(),metadata:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into knowledge_sources(project_id,source_key,title,source_type,authority_level,jurisdiction,discipline,revision,status,effective_date,content_ref,checksum,metadata,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,[b.project_id??null,b.source_key,b.title,b.source_type,b.authority_level,b.jurisdiction??null,b.discipline??null,b.revision??null,b.status,b.effective_date??null,b.content_ref??null,b.checksum??null,b.metadata,req.user!.id]);
  res.status(201).json({success:true,data:r});
}));

knowledgeRouter.get('/sources/:id/chunks', asyncHandler(async(req,res)=>res.json({success:true,data:await query('select * from knowledge_chunks where source_id=$1 order by id',[Number(req.params.id)])})));
knowledgeRouter.post('/sources/:id/chunks', authorize('knowledge','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({chunk_key:z.string().min(1).max(180),section_ref:z.string().max(255).nullable().optional(),content_text:z.string().min(1),token_count:z.number().int().nonnegative().nullable().optional(),embedding_provider:z.string().max(80).nullable().optional(),embedding_model:z.string().max(120).nullable().optional(),embedding_ref:z.string().nullable().optional(),metadata:z.record(z.any()).default({})}).parse(req.body);
  const [r]=await query(`insert into knowledge_chunks(source_id,chunk_key,section_ref,content_text,token_count,embedding_provider,embedding_model,embedding_ref,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[Number(req.params.id),b.chunk_key,b.section_ref??null,b.content_text,b.token_count??null,b.embedding_provider??null,b.embedding_model??null,b.embedding_ref??null,b.metadata]);
  res.status(201).json({success:true,data:r});
}));

knowledgeRouter.get('/queries', asyncHandler(async(_req,res)=>res.json({success:true,data:await query('select * from knowledge_queries order by created_at desc limit 500')})));
knowledgeRouter.post('/queries', authorize('knowledge','manage'), asyncHandler(async(req,res)=>{
  const b=z.object({project_id:z.number().int().positive().nullable().optional(),query_text:z.string().min(1),filters:z.record(z.any()).default({}),retrieved_chunks:z.array(z.any()).default([]),answer_text:z.string().nullable().optional(),citations:z.array(z.any()).default([]),model_key:z.string().max(160).nullable().optional(),grounded:z.boolean().nullable().optional()}).parse(req.body);
  const [r]=await query(`insert into knowledge_queries(project_id,requested_by,query_text,filters,retrieved_chunks,answer_text,citations,model_key,grounded) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[b.project_id??null,req.user!.id,b.query_text,b.filters,b.retrieved_chunks,b.answer_text??null,b.citations,b.model_key??null,b.grounded??null]);
  res.status(201).json({success:true,data:r});
}));
