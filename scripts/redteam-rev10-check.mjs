import fs from 'node:fs';

function read(p){return fs.readFileSync(p,'utf8');}
function must(cond,msg){if(!cond){console.error('FAIL',msg);process.exitCode=1;}else console.log('PASS',msg);}

const approval=read('backend/src/services/approval.service.ts');
const hr=read('backend/src/modules/hr/hr.routes.ts');
const assets=read('backend/src/modules/assets/assets.routes.ts');
const phase5=read('backend/src/services/phase5Posting.service.ts');
const procurement=read('backend/src/modules/procurement/procurement.routes.ts');
const subcontracts=read('backend/src/modules/subcontracts/subcontracts.routes.ts');
const contracts=read('backend/src/modules/contracts/contracts.routes.ts');
const tendering=read('backend/src/modules/tendering/tendering.routes.ts');
const finance=read('backend/src/modules/finance/finance.routes.ts');

must(approval.includes("'payroll_run'") && approval.includes("'equipment_usage'"), 'payroll/equipment are governed by central approval engine');
must(hr.includes("module: 'payroll_run'") && !hr.includes("update payroll_runs set status='approved'"), 'payroll route cannot directly self-approve');
must(assets.includes("module: 'equipment_usage'") && !assets.includes("update equipment_usage set status='approved'"), 'equipment usage route cannot directly self-approve');
must(hr.includes('count(distinct currency_id)') && hr.includes('Payroll run must use one currency before approval'), 'payroll DOA amount has deterministic currency');
must(phase5.includes('const amount = String(line.net_pay)') && !phase5.includes('Number(line.net_pay)'), 'payroll overhead GL avoids Float64 monetary conversion');

const all=[procurement,subcontracts,contracts,tendering,finance].join('\n');
for(const pattern of ['Number(po.rows[0].total_amount)','Number(s.contract_value)','Number(cert.net_amount_due)','Number(contract.contract_value)','Number(v.cost_impact)','Number(tender.estimated_value)','Number(ipc.net_amount_due)','Number(payment.amount)']){
  must(!all.includes(pattern), `approval monetary conversion removed: ${pattern}`);
}

if(process.exitCode){process.exit(process.exitCode)}
console.log('REV10 REDTEAM PASS — Phase5 approval bypass and remaining approval-money Float64 paths closed statically');
