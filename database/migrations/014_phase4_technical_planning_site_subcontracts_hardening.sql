-- ============================================================================
-- PHASE 4 — TECHNICAL OFFICE / PLANNING / SITE / SUBCONTRACTS HARDENING
-- Adds explicit tenant keys to project-scoped execution records, derives them
-- from trusted parents, enforces cross-tenant consistency, and enables RLS.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'drawings','submittals','rfis','method_statements','schedule_baselines',
    'schedule_activities','progress_updates','milestones','site_diary',
    'diary_manpower','diary_equipment','site_instructions','quantity_sheets',
    'punch_lists','cost_forecasts','evm_snapshots','subcontracts',
    'subcontract_certificates','subcontract_certificate_lines','schedule_relationships'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id BIGINT', t);
  END LOOP;
END $$;

-- Backfill from authoritative parent relationships.
UPDATE drawings d SET org_id=p.org_id FROM projects p WHERE p.id=d.project_id AND d.org_id IS NULL;
UPDATE submittals s SET org_id=p.org_id FROM projects p WHERE p.id=s.project_id AND s.org_id IS NULL;
UPDATE rfis r SET org_id=p.org_id FROM projects p WHERE p.id=r.project_id AND r.org_id IS NULL;
UPDATE method_statements m SET org_id=p.org_id FROM projects p WHERE p.id=m.project_id AND m.org_id IS NULL;
UPDATE schedule_baselines b SET org_id=p.org_id FROM projects p WHERE p.id=b.project_id AND b.org_id IS NULL;
UPDATE schedule_activities a SET org_id=p.org_id FROM projects p WHERE p.id=a.project_id AND a.org_id IS NULL;
UPDATE progress_updates u SET org_id=a.org_id FROM schedule_activities a WHERE a.id=u.schedule_activity_id AND u.org_id IS NULL;
UPDATE milestones m SET org_id=p.org_id FROM projects p WHERE p.id=m.project_id AND m.org_id IS NULL;
UPDATE site_diary d SET org_id=p.org_id FROM projects p WHERE p.id=d.project_id AND d.org_id IS NULL;
UPDATE diary_manpower x SET org_id=d.org_id FROM site_diary d WHERE d.id=x.diary_id AND x.org_id IS NULL;
UPDATE diary_equipment x SET org_id=d.org_id FROM site_diary d WHERE d.id=x.diary_id AND x.org_id IS NULL;
UPDATE site_instructions i SET org_id=p.org_id FROM projects p WHERE p.id=i.project_id AND i.org_id IS NULL;
UPDATE quantity_sheets q SET org_id=p.org_id FROM projects p WHERE p.id=q.project_id AND q.org_id IS NULL;
UPDATE punch_lists x SET org_id=p.org_id FROM projects p WHERE p.id=x.project_id AND x.org_id IS NULL;
UPDATE cost_forecasts f SET org_id=p.org_id FROM projects p WHERE p.id=f.project_id AND f.org_id IS NULL;
UPDATE evm_snapshots e SET org_id=p.org_id FROM projects p WHERE p.id=e.project_id AND e.org_id IS NULL;
UPDATE subcontracts s SET org_id=p.org_id FROM projects p WHERE p.id=s.project_id AND s.org_id IS NULL;
UPDATE subcontract_certificates c SET org_id=p.org_id FROM projects p WHERE p.id=c.project_id AND c.org_id IS NULL;
UPDATE subcontract_certificate_lines l SET org_id=c.org_id FROM subcontract_certificates c WHERE c.id=l.certificate_id AND l.org_id IS NULL;
UPDATE schedule_relationships r SET org_id=p.org_id FROM projects p WHERE p.id=r.project_id AND r.org_id IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'drawings','submittals','rfis','method_statements','schedule_baselines',
    'schedule_activities','progress_updates','milestones','site_diary',
    'diary_manpower','diary_equipment','site_instructions','quantity_sheets',
    'punch_lists','cost_forecasts','evm_snapshots','subcontracts',
    'subcontract_certificates','subcontract_certificate_lines','schedule_relationships'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES organizations(id)', t, 'fk_'||t||'_org');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(org_id)', 'idx_'||t||'_org', t);
  END LOOP;
END $$;

-- Trusted-parent consistency: application code cannot manufacture cross-tenant links.
CREATE OR REPLACE FUNCTION guard_phase4_org_consistency() RETURNS TRIGGER AS $$
DECLARE parent_org bigint;
BEGIN
  IF TG_TABLE_NAME IN ('drawings','submittals','rfis','method_statements','schedule_baselines','schedule_activities','milestones','site_diary','site_instructions','quantity_sheets','punch_lists','cost_forecasts','evm_snapshots','subcontracts','subcontract_certificates','schedule_relationships') THEN
    EXECUTE format('SELECT org_id FROM projects WHERE id = $1') INTO parent_org USING NEW.project_id;
  ELSIF TG_TABLE_NAME='progress_updates' THEN
    SELECT org_id INTO parent_org FROM schedule_activities WHERE id=NEW.schedule_activity_id;
  ELSIF TG_TABLE_NAME IN ('diary_manpower','diary_equipment') THEN
    SELECT org_id INTO parent_org FROM site_diary WHERE id=NEW.diary_id;
  ELSIF TG_TABLE_NAME='subcontract_certificate_lines' THEN
    SELECT org_id INTO parent_org FROM subcontract_certificates WHERE id=NEW.certificate_id;
  END IF;
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'Trusted parent not found for %.%', TG_TABLE_NAME, NEW.id;
  END IF;
  IF NEW.org_id IS NULL THEN NEW.org_id := parent_org; END IF;
  IF NEW.org_id <> parent_org THEN
    RAISE EXCEPTION 'Tenant mismatch on %.%: org_id % does not match trusted parent org %', TG_TABLE_NAME, NEW.id, NEW.org_id, parent_org;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'drawings','submittals','rfis','method_statements','schedule_baselines','schedule_activities',
    'progress_updates','milestones','site_diary','diary_manpower','diary_equipment','site_instructions',
    'quantity_sheets','punch_lists','cost_forecasts','evm_snapshots','subcontracts','subcontract_certificates',
    'subcontract_certificate_lines','schedule_relationships'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_'||t||'_org_consistency', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_phase4_org_consistency()', 'trg_'||t||'_org_consistency', t);
  END LOOP;
END $$;

-- Schedule relationship must stay inside one project and cannot self-link.
CREATE OR REPLACE FUNCTION guard_schedule_relationship_project() RETURNS TRIGGER AS $$
DECLARE p1 bigint; p2 bigint;
BEGIN
  SELECT project_id INTO p1 FROM schedule_activities WHERE id=NEW.predecessor_activity_id;
  SELECT project_id INTO p2 FROM schedule_activities WHERE id=NEW.successor_activity_id;
  IF p1 IS NULL OR p2 IS NULL OR p1 <> p2 OR NEW.project_id <> p1 THEN
    RAISE EXCEPTION 'Schedule relationship activities must belong to the same project';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_schedule_relationship_project ON schedule_relationships;
CREATE TRIGGER trg_schedule_relationship_project BEFORE INSERT OR UPDATE ON schedule_relationships FOR EACH ROW EXECUTE FUNCTION guard_schedule_relationship_project();

-- Core construction-data integrity checks.
ALTER TABLE schedule_activities DROP CONSTRAINT IF EXISTS chk_schedule_dates;
ALTER TABLE schedule_activities ADD CONSTRAINT chk_schedule_dates CHECK (planned_finish IS NULL OR planned_start IS NULL OR planned_finish >= planned_start);
ALTER TABLE progress_updates DROP CONSTRAINT IF EXISTS chk_progress_boq_nonnegative;
ALTER TABLE quantity_sheets DROP CONSTRAINT IF EXISTS chk_quantity_nonnegative;
ALTER TABLE quantity_sheets ADD CONSTRAINT chk_quantity_nonnegative CHECK (quantity >= 0);
ALTER TABLE diary_manpower DROP CONSTRAINT IF EXISTS chk_diary_manpower_nonnegative;
ALTER TABLE diary_manpower ADD CONSTRAINT chk_diary_manpower_nonnegative CHECK (headcount >= 0 AND (hours IS NULL OR hours >= 0));
ALTER TABLE diary_equipment DROP CONSTRAINT IF EXISTS chk_diary_equipment_nonnegative;
ALTER TABLE diary_equipment ADD CONSTRAINT chk_diary_equipment_nonnegative CHECK ((hours_used IS NULL OR hours_used >= 0) AND (idle_hours IS NULL OR idle_hours >= 0));
ALTER TABLE subcontract_certificate_lines ADD CONSTRAINT chk_sc_line_nonnegative CHECK (quantity_this_period >= 0 AND cumulative_quantity >= 0 AND unit_rate >= 0);
ALTER TABLE subcontracts ADD CONSTRAINT chk_subcontract_value_positive CHECK (contract_value > 0);
ALTER TABLE subcontract_certificates ADD CONSTRAINT chk_sc_amounts_nonnegative CHECK (gross_work_done >= 0 AND less_retention >= 0 AND less_advance_recovery >= 0 AND less_previous_paid >= 0 AND penalties_deductions >= 0);
ALTER TABLE evm_snapshots ADD CONSTRAINT chk_evm_values_nonnegative CHECK (planned_value >= 0 AND earned_value >= 0 AND actual_cost >= 0);

-- RLS: these tables now have explicit tenant keys and are safe for direct application queries.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'drawings','submittals','rfis','method_statements','schedule_baselines','schedule_activities',
    'progress_updates','milestones','site_diary','diary_manpower','diary_equipment','site_instructions',
    'quantity_sheets','punch_lists','cost_forecasts','evm_snapshots','subcontracts','subcontract_certificates',
    'subcontract_certificate_lines','schedule_relationships'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS phase4_tenant_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS phase4_tenant_write ON %I', t);
    EXECUTE format('CREATE POLICY phase4_tenant_select ON %I FOR SELECT USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint)', t);
    EXECUTE format('CREATE POLICY phase4_tenant_write ON %I FOR ALL USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::bigint)', t);
  END LOOP;
END $$;
