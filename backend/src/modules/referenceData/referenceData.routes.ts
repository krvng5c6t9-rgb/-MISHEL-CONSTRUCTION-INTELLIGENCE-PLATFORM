import { Router } from 'express';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../middleware/errors.js';

export const referenceDataRouter=Router();
referenceDataRouter.use((req,_res,next)=>{
  if(!req.user) return next(new AppError(401,'Authentication required'));
  if(req.user.user_type!=='internal') return next(new AppError(403,'Internal user required'));
  next();
});
referenceDataRouter.get('/',asyncHandler(async(req,res)=>{
 const orgId=Number(req.user!.org_id);
 const [projects,clients,vendors,currencies,users,costCodes,contracts,subcontracts,documents,activities,warehouses,inventoryItems]=await Promise.all([
  query(`select id,project_code,project_name,status,currency_id from projects where org_id=$1 order by project_code`,[orgId]),
  query(`select id,client_name from clients where org_id=$1 and is_active=true order by client_name`,[orgId]),
  query(`select id,vendor_name,vendor_type from vendors_subcontractors where org_id=$1 and is_active=true order by vendor_name`,[orgId]),
  query(`select id,code,name from currencies where is_active=true order by code`),
  query(`select id,full_name,email from users where org_id=$1 and is_active=true and user_type='internal' order by full_name`,[orgId]),
  query(`select id,project_id,code,description from cost_codes where org_id=$1 and is_active=true order by code`,[orgId]),
  query(`select id,project_id,client_id,contract_value,currency_id,contract_status from contracts where org_id=$1 order by id desc`,[orgId]),
  query(`select id,project_id,vendor_id,package_name,status,currency_id from subcontracts where org_id=$1 order by id desc`,[orgId]),
  query(`select id,project_id,doc_number,file_name,revision,status from documents where org_id=$1 order by id desc limit 1000`,[orgId]),
  query(`select a.id,a.activity_id_ext,a.activity_name,a.project_id from schedule_activities a where a.org_id=$1 order by a.project_id,a.activity_id_ext`,[orgId]),
  query(`select id,project_id,code,name from warehouses where org_id=$1 and is_active=true order by code`,[orgId]),
  query(`select id,item_code,description,unit_of_measure from inventory_items where org_id=$1 and is_active=true order by item_code`,[orgId])
 ]);
 res.json({success:true,data:{projects,clients,vendors,currencies,users,costCodes,contracts,subcontracts,documents,activities,warehouses,inventoryItems}});
}));
