import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const notificationsRouter = Router();
notificationsRouter.use(authorize('notifications','view'));

notificationsRouter.get('/', asyncHandler(async (req,res)=>{
  const q=z.object({unread:z.coerce.boolean().default(false),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
  const rows=await query(`select id,source_module,message,link,is_read,created_at from notifications where org_id=$1 and user_id=$2 ${q.unread?'and is_read=false':''} order by created_at desc limit $3`,[req.user!.org_id,req.user!.id,q.limit]);
  res.json({success:true,data:rows});
}));

notificationsRouter.post('/:id/read', authorize('notifications','manage'), asyncHandler(async(req,res)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const rows=await query(`update notifications set is_read=true where id=$1 and org_id=$2 and user_id=$3 returning *`,[id,req.user!.org_id,req.user!.id]);
  if(!rows[0]) return res.status(404).json({success:false,error:'Notification not found'});
  res.json({success:true,data:rows[0]});
}));

notificationsRouter.post('/read-all', authorize('notifications','manage'), asyncHandler(async(req,res)=>{
  const rows=await query(`update notifications set is_read=true where org_id=$1 and user_id=$2 and is_read=false returning id`,[req.user!.org_id,req.user!.id]);
  res.json({success:true,data:{marked_read:rows.length}});
}));
