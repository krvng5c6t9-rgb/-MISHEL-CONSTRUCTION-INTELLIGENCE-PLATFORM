# Code Phase 7 — Runtime Build/Test Repair Pack — REV-C

## Consultant Decision
REV-B is not accepted as a runtime-ready handoff without repair because the database permission CHECK constraint still allowed only legacy actions, while the application uses `manage` and `post` actions.

REV-C repairs this issue and adds repeatable validation scripts.

## Confirmed Repairs

1. **Database permission constraint repaired**
   - File: `database/migrations/010_phase6_permissions_and_validation_patch.sql`
   - Action: drops and recreates `permissions_action_check` to allow:
     `view, create, edit, approve, delete, export, manage, post`.

2. **System Admin permission coverage expanded**
   - Adds required permissions for modules used by code:
     `dashboards`, `reports`, `portals`, `system`, plus extended actions used in finance/site/planning/technical office.

3. **Bootstrap Admin expanded**
   - File: `backend/src/modules/auth/auth.routes.ts`
   - Bootstrap now grants permissions for Phase 1A–6 modules.
   - Bootstrap response now returns the created role permissions instead of an empty permissions array.

4. **Roles API schema fixed**
   - File: `backend/src/modules/roles/roles.routes.ts`
   - Role permission schema now accepts `manage` and `post`.

5. **TypeScript strict issue repaired**
   - File: `backend/src/services/glPosting.service.ts`
   - Manual journal balance reducer now has explicit typing.

## Validation Scripts Added

- `scripts/static-import-check.mjs`
- `scripts/permission-consistency-check.mjs`
- `scripts/runtime-build-check.sh`

## Local Runtime Test Command

```bash
cp .env.example .env
# update DATABASE_URL and JWT_SECRET
bash scripts/runtime-build-check.sh
```

## Database Runtime Validation Order

Run migrations in filename order:

```text
001_phase0_phase1.sql
002_cost_adjustment_v1_1.sql
003_cost_adjustment_v1_2.sql
004_phase2.sql
005_phase2_1_hardening_recovered.sql
006_phase3_finance_gl.sql
007_phase4_hr_assets_qaqc_hse.sql
008_phase5_phase6_views_portals.sql
009_priority_execution_patch.sql
010_phase6_permissions_and_validation_patch.sql
```

Then run:

```sql
select * from permissions where action in ('manage','post');
```

## Status

- Static file structure: passed
- Relative import existence: passed
- Permission consistency: passed after repair
- Full package install/build: pending on an environment with npm package installation available
- PostgreSQL migration execution on clean database: pending final runtime environment

## Consultant Hold Point Before Production

Do not call this production until these are completed:

1. `npm install` succeeds in backend and frontend.
2. `npm run build` succeeds in backend and frontend.
3. All migrations run on a clean PostgreSQL database.
4. Full workflow test passes:
   Project → BOQ → PO → Approval → Vendor Invoice → Cost Transaction → GL → IPC → Payment.
