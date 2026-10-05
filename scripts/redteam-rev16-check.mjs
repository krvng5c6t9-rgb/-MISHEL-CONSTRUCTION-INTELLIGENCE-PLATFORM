import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const checks = [];
const ok = (name, cond) => checks.push([name, Boolean(cond)]);

const login = read('frontend/src/pages/Login.tsx');
const auth = read('backend/src/modules/auth/auth.routes.ts');
const env = read('backend/src/config/env.ts');
const seed = read('database/seed_minimal.sql');
const mig = read('database/migrations/028_release_bootstrap_and_demo_data_hardening.sql');

ok('Login has no hard-coded demo email', !login.includes('mishel@example.com'));
ok('Login has no hard-coded demo password', !login.includes('ChangeMe123!'));
ok('Login does not force org_id=1', !/org_id\s*:\s*1\b/.test(login));
ok('Login requires operator supplied organization id', login.includes('parsedOrgId'));
ok('Bootstrap requires x-bootstrap-token', auth.includes("x-bootstrap-token"));
ok('Bootstrap token compared timing-safely', auth.includes('timingSafeEqual'));
ok('Bootstrap secret is validated by environment schema', env.includes('BOOTSTRAP_ADMIN_TOKEN') && env.includes("min(32"));
ok('JWT secret minimum strengthened', /JWT_SECRET:[\s\S]*min\(32/.test(env));
ok('Minimal seed has no user insert', !/insert\s+into\s+users/i.test(seed));
ok('Minimal seed has no demo project/client', !/Demo Client|Najma Walk Demo Project/.test(seed));
ok('Release migration neutralizes historical placeholder org', mig.includes('Construction ERP Bootstrap Organization'));
ok('Release migration removes exact historical placeholder login', mig.includes("mishel@example.com") && mig.includes('CHANGE_ME_HASH'));

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  if (!pass) failed++;
}
if (failed) {
  console.error(`REV16 gate failed: ${failed}/${checks.length} checks failed`);
  process.exit(1);
}
console.log(`REV16 gate passed: ${checks.length}/${checks.length}`);
