import fs from 'node:fs';
const must=[
 ['migration 020','database/migrations/020_redteam_closure.sql','DELETE FROM delegation_of_authority'],
 ['claim transition','backend/src/modules/claims/claims.routes.ts','Invalid claim transition'],
 ['atomic transfer','backend/src/modules/inventory/inventory.routes.ts',"post('/transfer'"],
 ['negative stock guard','backend/src/modules/inventory/inventory.routes.ts','Insufficient stock'],
 ['CRM create UI','frontend/src/pages/CRM.tsx','Create Lead'],
 ['Tender create UI','frontend/src/pages/Tendering.tsx','New Tender'],
 ['Contract workflow UI','frontend/src/pages/Contracts.tsx','Submit Approval'],
 ['Claims workflow UI','frontend/src/pages/Claims.tsx','Register Claim'],
 ['Subcontract workflow UI','frontend/src/pages/Subcontracts.tsx','QS Certify'],
 ['Inventory transfer UI','frontend/src/pages/Inventory.tsx','Warehouse Transfer'],
];
let bad=0;for(const [name,file,needle] of must){const ok=fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes(needle);console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)bad++;}
const junk=[];function walk(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=`${d}/${x.name}`;if(x.isDirectory()){if(x.name!=='node_modules')walk(p)}else if(/\.(tmp|bak)$/.test(x.name)||x.name.endsWith('~'))junk.push(p)}}walk('.');console.log(junk.length?'FAIL junk files '+junk.join(', '):'PASS no temp/bak artifacts');if(junk.length)bad++;


for (const [name,file,needle] of [
 ['contract approval edit lock','backend/src/modules/contracts/contracts.routes.ts','Contract is under approval and cannot be edited'],
 ['tender approval edit lock','backend/src/modules/tendering/tendering.routes.ts','Tender has a pending submission approval and cannot be edited'],
 ['inventory append-only transfer compatibility','backend/src/modules/inventory/inventory.routes.ts',"source_record_id=$2 where id=$1"]
]) {
 const body=fs.readFileSync(file,'utf8');
 const ok=name==='inventory append-only transfer compatibility'?!body.includes(needle):body.includes(needle);
 console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok)bad++;
}

const migrationFiles=fs.readdirSync('database/migrations').filter(x=>/^\d{3}_.*\.sql$/.test(x)).sort();
const seq=new Map(); for(const f of migrationFiles){const n=f.slice(0,3); seq.set(n,(seq.get(n)||[]).concat(f));}
const dup=[...seq.entries()].filter(([,v])=>v.length>1);
if(dup.length){console.log('FAIL duplicate migration sequence '+JSON.stringify(dup));bad++;}else console.log('PASS unique migration sequence');

if(bad)process.exit(1);console.log('REDTEAM REV5 CHECK: PASS');
