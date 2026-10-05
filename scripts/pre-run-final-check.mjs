import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const pass=m=>console.log(`PASS ${m}`);
const fail=m=>{console.error(`FAIL ${m}`);failures.push(m)};
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

for (const f of ['backend/Dockerfile','frontend/Dockerfile','docker-compose.yml','scripts/run-local.sh','backend/src/db/migrate.ts']) {
  fs.existsSync(path.join(root,f)) ? pass(f) : fail(`missing ${f}`);
}

const migrationDir=path.join(root,'database/migrations');
const migrations=fs.readdirSync(migrationDir).filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort();
const nums=migrations.map(x=>Number(x.slice(0,3)));
const expected=Array.from({length:nums.length},(_,i)=>i+1);
JSON.stringify(nums)===JSON.stringify(expected) ? pass(`migration sequence 001→${String(nums.at(-1)).padStart(3,'0')}`) : fail('migration numbering has gaps/duplicates');

const packages=['package.json','backend/package.json','frontend/package.json'].map(p=>[p,JSON.parse(read(p))]);
for (const [name,pkg] of packages) {
  for (const sec of ['dependencies','devDependencies']) for (const [dep,v] of Object.entries(pkg[sec]||{})) {
    if (/^[~^*]|x$/i.test(String(v))) fail(`${name}: unpinned direct dependency ${dep}=${v}`);
  }
}
pass('direct dependency versions are exact');

const compose=read('docker-compose.yml');
for (const s of ['postgres:','migrator:','backend:','frontend:','service_completed_successfully']) compose.includes(s)?pass(`compose ${s}`):fail(`compose missing ${s}`);

const migrator=read('backend/src/db/migrate.ts');
for (const s of ['schema_migrations','checksum mismatch','Refusing unsafe automatic baseline','begin','rollback']) migrator.includes(s)?pass(`migrator ${s}`):fail(`migrator missing ${s}`);

const legacySeed=read('database/seed_phase1A_minimal.sql');
if (/Demo Client|CHANGE_ME_HASH|insert\s+into\s+users/i.test(legacySeed)) fail('legacy seed still contains demo/default identity data'); else pass('legacy seed contains no default/demo identity data');

const env=read('.env.example');
if (/ChangeMe123|CHANGE_ME_HASH|JWT_SECRET=.{1,20}$/m.test(env)) fail('unsafe default secret in env example'); else pass('env example has no usable default secrets');

const rootPkg=packages[0][1];
rootPkg.scripts?.['check:redteam-rev20'] ? pass('REV20 gate exposed in root scripts') : fail('REV20 gate missing from root scripts');
rootPkg.scripts?.['check:release'] ? pass('release regression script exists') : fail('release regression script missing');

if (failures.length) {
  console.error(`PRE_RUN_GATE_FAIL ${failures.length}`);
  process.exit(1);
}
console.log('PRE_RUN_GATE_PASS');
