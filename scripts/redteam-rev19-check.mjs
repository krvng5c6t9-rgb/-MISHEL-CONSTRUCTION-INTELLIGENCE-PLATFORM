import fs from 'node:fs';

const portals = fs.readFileSync('backend/src/modules/portals/portals.routes.ts','utf8');
const ui = fs.readFileSync('frontend/src/pages/Portals.tsx','utf8');
const mig = fs.readFileSync('database/migrations/031_portal_access_operational_hardening.sql','utf8');

const results = [];
function check(name, ok) { results.push([name, Boolean(ok)]); }

check('Client portal INSERT persists authenticated org_id', /insert into client_portal_access \(org_id, user_id, client_id, project_id, granted_by, is_active\)/i.test(portals));
check('Subcontractor portal INSERT persists authenticated org_id', /insert into subcontractor_portal_access \(org_id, user_id, vendor_id, subcontract_id, granted_by, is_active\)/i.test(portals));
check('Client grant validates client-portal user in tenant', /user_type='client_portal'.*org_id=\$2/s.test(portals));
check('Subcontractor grant validates subcontractor-portal user in tenant', /user_type='subcontractor_portal'.*org_id=\$2/s.test(portals));
check('Client grant validates project-client relationship', /Project is assigned to a different client/.test(portals));
check('Subcontract grant validates selected package vendor/org', /Subcontract does not belong to the selected vendor\/organization/.test(portals));
check('Access status endpoints are tenant-scoped', /client-access\/:id\/status[\s\S]*org_id=\$2/.test(portals) && /subcontractor-access\/:id\/status[\s\S]*org_id=\$2/.test(portals));
check('Portal reference data is tenant-scoped', /reference-data[\s\S]*where org_id=\$1/.test(portals));
check('Vendor-wide NULL grant uniqueness is hardened', /CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontractor_portal_vendor_wide_access[\s\S]*WHERE subcontract_id IS NULL/i.test(mig));
check('DB trigger enforces grantor tenant', /grantor_org[\s\S]*Portal grantor belongs to another organization/.test(mig));
check('DB trigger enforces project-client ownership', /p_client[\s\S]*client does not own the selected project/i.test(mig));
check('Portal UI supports client grant', /Grant Client Portal Access/.test(ui) && /apiPost\('\/portals\/client-access'/.test(ui));
check('Portal UI supports subcontractor grant', /Grant Subcontractor Portal Access/.test(ui) && /apiPost\('\/portals\/subcontractor-access'/.test(ui));
check('Portal UI supports activate/deactivate', /apiPatch\(`\/portals\/client-access\/\$\{row.id\}\/status`/.test(ui) && /apiPatch\(`\/portals\/subcontractor-access\/\$\{row.id\}\/status`/.test(ui));
check('Subcontractor dashboard avoids join-multiplication financial sum', /left join lateral[\s\S]*sum\(sc.net_amount_due\)/.test(portals) && !/sum\(distinct sc\.net_amount_due\)/.test(portals));

let failed = 0;
for (const [name, ok] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}`);
  if (!ok) failed++;
}
console.log(`\nREV19 hostile portal gate: ${results.length - failed}/${results.length} PASS`);
if (failed) process.exit(1);
