
import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
const files = walk('backend/src').filter(f => f.endsWith('.ts'));
const required = new Set();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/authorize\('([^']+)',\s*'([^']+)'/g)) required.add(`${m[1]}.${m[2]}`);
}
const migration = fs.readdirSync('database/migrations').filter(f => f.endsWith('.sql')).sort()
  .map(f => fs.readFileSync(path.join('database/migrations', f), 'utf8')).join('\n');
const bootstrap = fs.readFileSync('backend/src/modules/auth/auth.routes.ts', 'utf8');
function hasPermission(text, module, action) {
  const m = module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['\"]${m}['\"]\\s*,\\s*['\"]${a}['\"]`).test(text);
}
const missingInMigration = [...required].filter(p => {
  const [module, action] = p.split('.');
  return !hasPermission(migration, module, action);
});
function bootstrapGrants(module, action) {
  const modulesMatch = bootstrap.match(/const modules = \[([^\]]+)\]/s);
  const actionsMatch = bootstrap.match(/const actions = \[([^\]]+)\]/s);
  if (!modulesMatch || !actionsMatch) return false;
  return modulesMatch[1].includes(`'${module}'`) && actionsMatch[1].includes(`'${action}'`);
}
const missingInBootstrap = [...required].filter(p => {
  const [module, action] = p.split('.');
  return !bootstrapGrants(module, action);
});
const allowedActionsOk = migration.includes("'manage'") && migration.includes("'post'") && migration.includes('DROP CONSTRAINT IF EXISTS permissions_action_check');
if (missingInMigration.length || missingInBootstrap.length || !allowedActionsOk) {
  console.error(JSON.stringify({ status: 'failed', missingInMigration, missingInBootstrap, allowedActionsOk }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'passed', required_permissions: [...required].sort() }, null, 2));
