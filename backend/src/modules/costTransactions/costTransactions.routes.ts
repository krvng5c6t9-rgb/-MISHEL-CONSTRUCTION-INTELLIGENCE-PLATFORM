import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const costTransactionsRouter = Router();

costTransactionsRouter.use(authorize('cost_control', 'view'));

costTransactionsRouter.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const rows = await query(`
    select ct.id, ct.project_id, p.project_code, ct.cost_code_id, cc.code as cost_code,
           ct.source_module, ct.source_table, ct.source_record_id,
           ct.transaction_type, ct.amount, cur.code as currency_code, ct.transaction_date,
           ct.description, ct.is_posted_to_gl, ct.created_at
    from cost_transactions ct
    join projects p on p.id = ct.project_id
    join cost_codes cc on cc.id = ct.cost_code_id
    join currencies cur on cur.id = ct.currency_id
    where ($1::bigint is null or ct.project_id = $1)
    order by ct.created_at desc
    limit 200
  `, [projectId]);
  res.json({ success: true, data: rows });
}));


costTransactionsRouter.get('/forecasts/list',asyncHandler(async(req,res)=>{const projectId=Number(req.query.project_id||0);const rows=await query(`select f.*,c.code cost_code from cost_forecasts f join cost_codes c on c.id=f.cost_code_id where ($1::bigint=0 or f.project_id=$1) order by forecast_date desc,f.id desc`,[projectId]);res.json({success:true,data:rows});}));
costTransactionsRouter.post('/forecasts',authorize('cost_control','manage'),asyncHandler(async(req,res)=>{const b=z.object({project_id:z.number().int().positive(),cost_code_id:z.number().int().positive(),forecast_date:z.string().optional(),estimate_to_complete:z.number().nonnegative(),estimate_at_completion:z.number().nonnegative(),variance_reason:z.string().optional().nullable()}).parse(req.body);const [r]=await query(`insert into cost_forecasts(org_id,project_id,cost_code_id,forecast_date,estimate_to_complete,estimate_at_completion,variance_reason,prepared_by) values($1,$2,$3,coalesce($4::date,current_date),$5,$6,$7,$8) returning *`,[req.user!.org_id,b.project_id,b.cost_code_id,b.forecast_date??null,b.estimate_to_complete,b.estimate_at_completion,b.variance_reason??null,req.user!.id]);res.status(201).json({success:true,data:r});}));
