import fs from 'node:fs';
const root=new URL('../',import.meta.url).pathname;
const mig=fs.readFileSync(root+'../database/migrations/017_phase7_final_hardening.sql','utf8');
const pool=fs.readFileSync(root+'src/db/pool.ts','utf8');
const checks=[
 ['audit trigger function',mig.includes('write_audit_log_row'),mig],
 ['audit immutable trigger',mig.includes('prevent_audit_mutation'),mig],
 ['audit RLS',mig.includes('tenant_audit_select')&&mig.includes('tenant_audit_insert'),mig],
 ['db context',fs.existsSync(root+'src/db/context.ts'),'' ],
 ['pooled context boundary',pool.includes('currentDbContext'),pool]
]; let ok=true; for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} ${n}`);ok&&=v} process.exit(ok?0:1);
