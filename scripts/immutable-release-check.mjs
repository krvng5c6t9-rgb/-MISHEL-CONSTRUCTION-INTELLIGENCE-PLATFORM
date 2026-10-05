import fs from 'node:fs';
const failures=[];
for (const f of ['backend/package-lock.json','frontend/package-lock.json']) if(!fs.existsSync(f)) failures.push(`missing ${f}`);
for (const f of ['backend/Dockerfile','frontend/Dockerfile']) {
  const s=fs.readFileSync(f,'utf8');
  if(!/package-lock\.json/.test(s)) failures.push(`${f} does not copy package-lock.json`);
  if(!/npm ci/.test(s)) failures.push(`${f} does not use npm ci`);
}
const run=fs.readFileSync('scripts/run-local.sh','utf8');
for(const marker of ['freeze-dependencies.sh','check:immutable','check:release']) if(!run.includes(marker)) failures.push(`run-local missing ${marker}`);
if(failures.length){console.error('IMMUTABLE_RELEASE_CHECK: FAIL'); failures.forEach(x=>console.error('- '+x)); process.exit(1)}
console.log('IMMUTABLE_RELEASE_CHECK: PASS');
