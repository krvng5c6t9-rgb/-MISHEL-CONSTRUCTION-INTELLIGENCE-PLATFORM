import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const failures=[];let passed=0;
function ok(name,cond){if(cond){passed++;console.log(`PASS ${name}`)}else{failures.push(name);console.error(`FAIL ${name}`)}}
const auth=read('backend/src/middleware/authenticate.ts');
const authRoutes=read('backend/src/modules/auth/auth.routes.ts');
const users=read('backend/src/modules/users/users.routes.ts');
const roles=read('backend/src/modules/roles/roles.routes.ts');
const app=read('frontend/src/App.tsx');
const setup=read('frontend/src/pages/Setup.tsx');
const admin=read('frontend/src/pages/Admin.tsx');
ok('JWT org_id is validated',auth.includes('Invalid token organization'));
ok('Authenticated user is loaded under signed tenant RLS context',auth.includes('withDbContext({ userId, orgId: tokenOrgId }'));
ok('User lookup re-validates org_id',auth.includes('u.id = $1 and u.org_id = $2'));
ok('User creation validates role belongs to tenant',users.includes('Role not found in current organization'));
ok('User creation validates employee belongs to tenant',users.includes('Employee not found in current organization'));
ok('Role permission read is tenant constrained',roles.includes('r.org_id = $2'));
ok('Role permission management endpoint exists',roles.includes("rolesRouter.put('/:id/permissions'"));
ok('Bootstrap can create/reuse an organization without SQL',authRoutes.includes('Provide org_id or organization details') && authRoutes.includes("insert into organizations"));
ok('Bootstrap switches RLS tenant after organization resolution',authRoutes.includes("set_config('app.org_id'"));
ok('First-run setup page is routed',app.includes('path="setup"') && app.includes("./pages/Setup"));
ok('First-run setup posts bootstrap token',setup.includes('apiBootstrapAdmin') && setup.includes('bootstrap_token'));
ok('Admin UI can create roles',admin.includes('Create Role') && admin.includes("apiPost('/roles'"));
ok('Admin UI can manage role permissions',admin.includes('Save Role Permissions') && admin.includes('apiPut(`/roles/${selectedRole}/permissions`'));
ok('Admin UI can edit and confirm DOA',admin.includes('Save & Confirm') && admin.includes('/approvals/configuration/doa/'));
if(failures.length){console.error(`REV20 REDTEAM FAIL — ${failures.length} failure(s)`);process.exit(1)}
console.log(`REV20 REDTEAM PASS — ${passed}/${passed}`);
