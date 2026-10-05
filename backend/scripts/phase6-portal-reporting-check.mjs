import fs from 'node:fs';
const root=new URL('../',import.meta.url).pathname;
const routes=fs.readFileSync(root+'src/routes/index.ts','utf8');
const portal=fs.readFileSync(root+'src/modules/portals/portals.routes.ts','utf8');
const notif=fs.readFileSync(root+'src/modules/notifications/notifications.routes.ts','utf8');
const mig=fs.readFileSync(root+'../database/migrations/016_phase6_portals_notifications_reporting_hardening.sql','utf8');
const checks=[
 ['notifications route mounted',routes.includes("'/notifications'"),routes],
 ['notification org+user filter',notif.includes('org_id=$1 and user_id=$2'),notif],
 ['portal org trigger',mig.includes('validate_portal_access_tenant'),mig],
 ['portal RLS',mig.includes('tenant_portal_client_select')&&mig.includes('tenant_portal_sub_select'),mig],
 ['dashboard/reporting KPI views',mig.includes('v_portfolio_kpis')&&mig.includes('v_tender_pipeline_summary'),mig]
];
let ok=true; for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} ${n}`);ok&&=v} process.exit(ok?0:1);
