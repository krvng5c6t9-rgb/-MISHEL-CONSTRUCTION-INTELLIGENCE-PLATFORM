-- Phase 6/7 permission patch for dashboards, reports, portals, runtime validation, and extended actions.
-- Safe to run after 001-009.
-- Critical repair: original permissions.action CHECK allowed only view/create/edit/approve/delete/export.
-- Later code uses manage/post, so the CHECK constraint must be widened before inserting those permissions.

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_action_check;
ALTER TABLE permissions
  ADD CONSTRAINT permissions_action_check
  CHECK (action IN ('view','create','edit','approve','delete','export','manage','post'));

insert into permissions (role_id, module, action, scope)
select r.id, x.module, x.action, 'all'
from roles r
cross join (values
  ('admin','view'), ('admin','create'), ('admin','edit'), ('admin','approve'), ('admin','delete'), ('admin','export'), ('admin','manage'), ('admin','post'),
  ('projects','view'), ('projects','create'), ('projects','edit'), ('projects','approve'), ('projects','delete'), ('projects','export'), ('projects','manage'), ('projects','post'),
  ('boq','view'), ('boq','create'), ('boq','edit'), ('boq','approve'), ('boq','delete'), ('boq','export'), ('boq','manage'), ('boq','post'),
  ('procurement','view'), ('procurement','create'), ('procurement','edit'), ('procurement','approve'), ('procurement','delete'), ('procurement','export'), ('procurement','manage'), ('procurement','post'),
  ('finance','view'), ('finance','create'), ('finance','edit'), ('finance','approve'), ('finance','delete'), ('finance','export'), ('finance','manage'), ('finance','post'),
  ('cost_control','view'), ('cost_control','create'), ('cost_control','edit'), ('cost_control','approve'), ('cost_control','delete'), ('cost_control','export'), ('cost_control','manage'), ('cost_control','post'),
  ('approvals','view'), ('approvals','create'), ('approvals','edit'), ('approvals','approve'), ('approvals','delete'), ('approvals','export'), ('approvals','manage'), ('approvals','post'),
  ('technical_office','view'), ('technical_office','create'), ('technical_office','edit'), ('technical_office','approve'), ('technical_office','delete'), ('technical_office','export'), ('technical_office','manage'), ('technical_office','post'),
  ('planning','view'), ('planning','create'), ('planning','edit'), ('planning','approve'), ('planning','delete'), ('planning','export'), ('planning','manage'), ('planning','post'),
  ('site','view'), ('site','create'), ('site','edit'), ('site','approve'), ('site','delete'), ('site','export'), ('site','manage'), ('site','post'),
  ('hr','view'), ('hr','create'), ('hr','edit'), ('hr','approve'), ('hr','delete'), ('hr','export'), ('hr','manage'), ('hr','post'),
  ('assets','view'), ('assets','create'), ('assets','edit'), ('assets','approve'), ('assets','delete'), ('assets','export'), ('assets','manage'), ('assets','post'),
  ('qaqc','view'), ('qaqc','create'), ('qaqc','edit'), ('qaqc','approve'), ('qaqc','delete'), ('qaqc','export'), ('qaqc','manage'), ('qaqc','post'),
  ('hse','view'), ('hse','create'), ('hse','edit'), ('hse','approve'), ('hse','delete'), ('hse','export'), ('hse','manage'), ('hse','post'),
  ('edms','view'), ('edms','create'), ('edms','edit'), ('edms','approve'), ('edms','delete'), ('edms','export'), ('edms','manage'), ('edms','post'),
  ('dashboards','view'), ('dashboards','export'),
  ('reports','view'), ('reports','export'),
  ('portals','view'), ('portals','manage'),
  ('system','view')
) as x(module, action)
where r.role_name = 'System Admin'
on conflict (role_id, module, action) do nothing;
