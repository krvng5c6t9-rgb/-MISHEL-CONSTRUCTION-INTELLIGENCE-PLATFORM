-- Stage 31 / DEC-009 part 2 (GC-13): revenue recognised over time by cost-to-cost progress in a periodic run per
-- contract, prepared by one person and approved (and posted) by another; contract asset / liability per contract;
-- onerous contract provision in full; released client retention reclassified to receivables in the GL.
-- (transaction managed by migrator)
-- Before (E3 @c1f3101): no recognition engine (GC-13 step "Revenue recognition per adopted policy" ABSENT); the IPC
-- billing credit was the only "revenue"; released retention stayed in the retention receivable account (CC-059
-- known limitation).
-- Method (DEC-009, analysis section 2.3; EAS 48 / IFRS 15 over-time):
--  * transaction price = contract value + client-agreed variations (decided on/before period end) + approved price
--    estimates (unpriced variations, claims - positive; expected delay damages - negative) each with a written basis
--    that a significant reversal is highly improbable, approved by a second person, never automatic;
--  * progress = cost incurred to date / EAC, both from the approved cost snapshots (one per cost code with cost) dated
--    inside the run period - the run is refused when any cost code with cost lacks one; capped at 100 %;
--  * cumulative revenue = price x progress; period revenue = cumulative - previous approved run (may be negative);
--  * expected loss = max(EAC - price, 0); onerous provision = expected loss x (1 - progress) so that, with the
--    margin already recognised, the whole loss is recognised at once; period movement vs previous run;
--  * contract position = cumulative revenue - gross billed to date: positive = contract asset, negative = liability;
--  * every input is captured by the database at preparation (nothing typed), frozen with a SHA-256 of the payload;
--    approval posts GL on the period end: Dr/Cr billings vs revenue (rule revenue_recognition), Dr/Cr onerous loss
--    vs provision (rule revenue_recognition / onerous_provision); approved runs are immutable; runs move forward only.
--  * Constraint (stated): progress uses the project's costs, so a project with more than one signed client contract is
--    refused until costs are attributed per contract. Output method and point-in-time contracts are not built (F-47).
-- Rollback: drop revenue_recognition_runs, revenue_price_estimates and their functions; re-apply 079 validate/guards;
-- restore the GL / rule source_module checks.

ALTER TABLE general_ledger DROP CONSTRAINT IF EXISTS general_ledger_source_module_check;
ALTER TABLE general_ledger ADD CONSTRAINT general_ledger_source_module_check
  CHECK (source_module IN ('cost_transaction','ipc','payment','manual_journal','payroll_overhead','revenue_recognition','retention_release'));
ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_source_module_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_source_module_check
  CHECK (source_module IN ('cost_transaction','ipc','payment','payroll_overhead','revenue_recognition'));

ALTER TABLE retention_ledger ADD COLUMN IF NOT EXISTS release_gl_batch_id BIGINT;

CREATE TABLE IF NOT EXISTS revenue_price_estimates (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('unpriced_variation','claim','delay_damages')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
  effective_from DATE NOT NULL,
  basis TEXT NOT NULL CHECK (length(trim(basis)) >= 20),
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) >= 3),
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id), approved_at TIMESTAMPTZ,
  retired_on DATE, retired_reason TEXT, retired_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'delay_damages' OR amount < 0),
  CHECK (kind = 'delay_damages' OR amount > 0),
  CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_by <> prepared_by AND approved_at IS NOT NULL)),
  CHECK (status <> 'retired' OR (retired_on IS NOT NULL AND length(trim(coalesce(retired_reason,''))) >= 10 AND retired_by IS NOT NULL))
);
CREATE OR REPLACE FUNCTION guard_revenue_price_estimate() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Approved price estimates are never deleted; retire them'; END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = NEW.contract_id AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN RAISE EXCEPTION 'Price estimates start as draft'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'retired' THEN RAISE EXCEPTION 'Price estimate % is retired and immutable', OLD.id; END IF;
    IF OLD.status = 'approved' AND (NEW.status <> 'retired' OR (NEW.org_id, NEW.contract_id, NEW.kind, NEW.amount, NEW.effective_from, NEW.basis, NEW.evidence_reference, NEW.prepared_by, NEW.approved_by, NEW.approved_at)
       IS DISTINCT FROM (OLD.org_id, OLD.contract_id, OLD.kind, OLD.amount, OLD.effective_from, OLD.basis, OLD.evidence_reference, OLD.prepared_by, OLD.approved_by, OLD.approved_at)) THEN
      RAISE EXCEPTION 'Approved price estimate % changes only by being retired', OLD.id;
    END IF;
    IF OLD.status = 'draft' AND NEW.status = 'retired' THEN RAISE EXCEPTION 'A draft estimate is deleted, not retired'; END IF;
    IF NEW.status = 'retired' AND NEW.retired_on < OLD.effective_from THEN RAISE EXCEPTION 'An estimate cannot be retired before it took effect'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_revenue_price_estimate ON revenue_price_estimates;
CREATE TRIGGER trg_revenue_price_estimate BEFORE INSERT OR UPDATE OR DELETE ON revenue_price_estimates FOR EACH ROW EXECUTE FUNCTION guard_revenue_price_estimate();

CREATE TABLE IF NOT EXISTS revenue_recognition_runs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  project_id BIGINT NOT NULL REFERENCES projects(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  method VARCHAR(15) NOT NULL DEFAULT 'cost_to_cost' CHECK (method = 'cost_to_cost'),
  contract_value NUMERIC(18,2), agreed_variations NUMERIC(18,2), approved_estimates NUMERIC(18,2), transaction_price NUMERIC(18,2),
  cost_to_date NUMERIC(18,2), eac NUMERIC(18,2), progress NUMERIC(9,6),
  cumulative_revenue NUMERIC(18,2), previous_revenue NUMERIC(18,2), period_revenue NUMERIC(18,2),
  expected_loss NUMERIC(18,2), loss_provision NUMERIC(18,2), previous_loss_provision NUMERIC(18,2), period_loss_provision NUMERIC(18,2),
  billings_to_date NUMERIC(18,2), contract_position NUMERIC(18,2),
  snapshot_ids BIGINT[], estimate_ids BIGINT[], payload JSONB, payload_sha256 CHAR(64),
  status VARCHAR(10) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','approved')),
  prepared_by BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, period_end),
  CHECK (period_end >= period_start),
  CHECK (status = 'prepared' OR (approved_by IS NOT NULL AND approved_by <> prepared_by AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_revenue_runs_contract ON revenue_recognition_runs(contract_id, period_end);

-- Inputs captured at preparation; nothing typed. Runs move forward only; one open run per contract.
CREATE OR REPLACE FUNCTION guard_revenue_run() RETURNS trigger AS $$
DECLARE k record; prev record; missing text; v_snap record; v_est record; v_var numeric; v_bill numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'prepared' THEN RAISE EXCEPTION 'Approved revenue runs are never deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'approved' THEN RAISE EXCEPTION 'Approved revenue run % is immutable', OLD.id; END IF;
    IF (NEW.org_id, NEW.contract_id, NEW.project_id, NEW.period_start, NEW.period_end, NEW.payload, NEW.payload_sha256, NEW.prepared_by)
       IS DISTINCT FROM (OLD.org_id, OLD.contract_id, OLD.project_id, OLD.period_start, OLD.period_end, OLD.payload, OLD.payload_sha256, OLD.prepared_by)
       OR NOT (NEW.status = 'approved') THEN
      RAISE EXCEPTION 'A prepared revenue run changes only by being approved; prepare a new run to change inputs';
    END IF;
    IF NEW.approved_by = OLD.prepared_by THEN RAISE EXCEPTION 'Segregation of duties: the preparer cannot approve the revenue run'; END IF;
    IF NOT EXISTS (SELECT 1 FROM general_ledger WHERE source_module = 'revenue_recognition' AND source_record_id = OLD.id)
       AND (OLD.period_revenue <> 0 OR OLD.period_loss_provision <> 0) THEN
      RAISE EXCEPTION 'Revenue run % is approved by posting it', OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT
  IF NEW.status <> 'prepared' THEN RAISE EXCEPTION 'A revenue run starts as prepared'; END IF;
  IF NEW.period_end > current_date THEN RAISE EXCEPTION 'A revenue run cannot end in the future'; END IF;
  SELECT id, org_id, project_id, contract_value, contract_status INTO k FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF k.id IS NULL OR k.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
  IF k.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Revenue is recognised only under a signed or active contract (contract % is %)', k.id, k.contract_status; END IF;
  IF (SELECT count(*) FROM contracts WHERE project_id = k.project_id AND contract_status IN ('signed','active')) > 1 THEN
    RAISE EXCEPTION 'Project % has more than one signed client contract; costs are not attributed per contract, so cost-to-cost progress cannot be measured', k.project_id;
  END IF;
  IF EXISTS (SELECT 1 FROM revenue_recognition_runs WHERE contract_id = NEW.contract_id AND status = 'prepared') THEN
    RAISE EXCEPTION 'Contract % already has a prepared revenue run awaiting approval', NEW.contract_id;
  END IF;
  SELECT period_end, cumulative_revenue, loss_provision INTO prev FROM revenue_recognition_runs
    WHERE contract_id = NEW.contract_id AND status = 'approved' ORDER BY period_end DESC LIMIT 1;
  IF prev.period_end IS NOT NULL AND NEW.period_start <= prev.period_end THEN
    RAISE EXCEPTION 'Revenue runs move forward: the last approved run ended %', prev.period_end;
  END IF;
  NEW.project_id := k.project_id;
  -- Every cost code with cost on the project must have an approved snapshot dated inside the period.
  SELECT string_agg(DISTINCT ct.cost_code_id::text, ', ') INTO missing FROM cost_transactions ct
   WHERE ct.project_id = k.project_id AND ct.transaction_type = 'actual' AND ct.transaction_date <= NEW.period_end
     AND NOT EXISTS (SELECT 1 FROM cost_forecast_snapshots s WHERE s.project_id = k.project_id AND s.cost_code_id = ct.cost_code_id
                     AND s.approved_by IS NOT NULL AND s.as_of BETWEEN NEW.period_start AND NEW.period_end);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'No approved cost snapshot inside % - % for cost code(s) %', NEW.period_start, NEW.period_end, missing; END IF;
  SELECT coalesce(sum(s.actual + s.accrual), 0) AS cost, coalesce(sum(s.eac), 0) AS eac, array_agg(s.id ORDER BY s.id) AS ids INTO v_snap
    FROM (SELECT DISTINCT ON (cost_code_id) * FROM cost_forecast_snapshots
          WHERE project_id = k.project_id AND approved_by IS NOT NULL AND as_of BETWEEN NEW.period_start AND NEW.period_end
          ORDER BY cost_code_id, as_of DESC, id DESC) s;
  IF v_snap.ids IS NULL OR v_snap.eac <= 0 THEN RAISE EXCEPTION 'No approved estimate at completion for project % inside the period', k.project_id; END IF;
  SELECT coalesce(sum(agreed_amount), 0) INTO v_var FROM variations
   WHERE contract_id = NEW.contract_id AND client_status = 'agreed' AND client_decided_on <= NEW.period_end;
  SELECT coalesce(sum(amount), 0) AS total, array_agg(id ORDER BY id) AS ids INTO v_est FROM revenue_price_estimates
   WHERE contract_id = NEW.contract_id AND status IN ('approved','retired') AND effective_from <= NEW.period_end
     AND (retired_on IS NULL OR retired_on > NEW.period_end);
  SELECT coalesce(sum(coalesce(client_certified_amount, net_amount_due) + coalesce(client_certified_retention, less_retention)
                      + coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) INTO v_bill
    FROM ipcs WHERE contract_id = NEW.contract_id AND status IN ('posted','paid') AND coalesce(client_certified_on, client_approved_date) <= NEW.period_end;
  NEW.contract_value := k.contract_value; NEW.agreed_variations := v_var; NEW.approved_estimates := v_est.total;
  NEW.transaction_price := k.contract_value + v_var + v_est.total;
  NEW.cost_to_date := v_snap.cost; NEW.eac := v_snap.eac;
  NEW.progress := least(round(v_snap.cost / v_snap.eac, 6), 1);
  NEW.cumulative_revenue := round(NEW.transaction_price * NEW.progress, 2);
  NEW.previous_revenue := coalesce(prev.cumulative_revenue, 0);
  NEW.period_revenue := NEW.cumulative_revenue - NEW.previous_revenue;
  NEW.expected_loss := greatest(v_snap.eac - NEW.transaction_price, 0);
  NEW.loss_provision := round(NEW.expected_loss * (1 - NEW.progress), 2);
  NEW.previous_loss_provision := coalesce(prev.loss_provision, 0);
  NEW.period_loss_provision := NEW.loss_provision - NEW.previous_loss_provision;
  NEW.billings_to_date := v_bill;
  NEW.contract_position := NEW.cumulative_revenue - v_bill;
  NEW.snapshot_ids := v_snap.ids; NEW.estimate_ids := v_est.ids;
  NEW.payload := jsonb_build_object('contract_id', NEW.contract_id, 'period_start', NEW.period_start, 'period_end', NEW.period_end, 'method', NEW.method,
    'contract_value', NEW.contract_value, 'agreed_variations', NEW.agreed_variations, 'approved_estimates', NEW.approved_estimates,
    'transaction_price', NEW.transaction_price, 'cost_to_date', NEW.cost_to_date, 'eac', NEW.eac, 'progress', NEW.progress,
    'cumulative_revenue', NEW.cumulative_revenue, 'previous_revenue', NEW.previous_revenue, 'period_revenue', NEW.period_revenue,
    'expected_loss', NEW.expected_loss, 'loss_provision', NEW.loss_provision, 'previous_loss_provision', NEW.previous_loss_provision,
    'period_loss_provision', NEW.period_loss_provision, 'billings_to_date', NEW.billings_to_date, 'contract_position', NEW.contract_position,
    'snapshot_ids', to_jsonb(NEW.snapshot_ids), 'estimate_ids', to_jsonb(NEW.estimate_ids));
  NEW.payload_sha256 := encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
  NEW.approved_by := NULL; NEW.approved_at := NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_revenue_run ON revenue_recognition_runs;
CREATE TRIGGER trg_revenue_run BEFORE INSERT OR UPDATE OR DELETE ON revenue_recognition_runs FOR EACH ROW EXECUTE FUNCTION guard_revenue_run();

-- Released retention: the GL reclassification batch id may be recorded once after release; everything else frozen.
CREATE OR REPLACE FUNCTION guard_retention_release() RETURNS trigger AS $$
DECLARE ar record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retention records are never deleted'; END IF;
  IF OLD.release_status = 'released' THEN
    IF OLD.release_gl_batch_id IS NULL AND NEW.release_gl_batch_id IS NOT NULL
       AND (to_jsonb(NEW) - 'release_gl_batch_id') = (to_jsonb(OLD) - 'release_gl_batch_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Retention % is released and immutable', OLD.id;
  END IF;
  IF NEW.release_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'Only a released retention is reclassified'; END IF;
  IF (NEW.org_id, NEW.project_id, NEW.ipc_id, NEW.retained_amount, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.project_id, OLD.ipc_id, OLD.retained_amount, OLD.created_at) THEN
    RAISE EXCEPTION 'Retention % amount and source are fixed', OLD.id;
  END IF;
  IF NEW.release_status = 'released' THEN
    IF length(trim(coalesce(NEW.release_reason, ''))) < 10 OR length(trim(coalesce(NEW.release_reference, ''))) < 3 OR NEW.released_by IS NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'A retention release needs a reason, the certificate reference and who released it';
    END IF;
    IF NEW.released_by = (SELECT prepared_by FROM ipcs WHERE id = OLD.ipc_id) THEN RAISE EXCEPTION 'Segregation of duties: the IPC preparer cannot release its retention'; END IF;
    SELECT id, source_type, source_record_id INTO ar FROM accounts_receivable WHERE id = NEW.release_receivable_id;
    IF ar.id IS NULL OR ar.source_type <> 'retention_release' OR ar.source_record_id <> OLD.id THEN RAISE EXCEPTION 'A released retention needs its own receivable'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['revenue_price_estimates','revenue_recognition_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION validate_gl_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE
    ct  cost_transactions%ROWTYPE;
    ipc ipcs%ROWTYPE;
    pay payments%ROWTYPE;
    mje manual_journal_entries%ROWTYPE;
    pl  payroll_lines%ROWTYPE;
    pr  payroll_runs%ROWTYPE;
    rr  revenue_recognition_runs%ROWTYPE;
    rl  retention_ledger%ROWTYPE;
BEGIN
    IF NEW.source_module = 'cost_transaction' THEN
        IF NEW.source_table <> 'cost_transactions' THEN
            RAISE EXCEPTION 'cost_transaction GL rows must have source_table = ''cost_transactions''.';
        END IF;
        SELECT * INTO ct FROM cost_transactions WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'cost_transactions row % not found', NEW.source_record_id; END IF;
        IF ct.is_posted_to_gl THEN RAISE EXCEPTION 'cost_transactions % already posted to GL.', ct.id; END IF;
        IF NEW.project_id IS DISTINCT FROM ct.project_id THEN RAISE EXCEPTION 'project_id mismatch for %.', ct.id; END IF;
        IF NEW.currency_id <> ct.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for %.', ct.id; END IF;

    ELSIF NEW.source_module = 'ipc' THEN
        IF NEW.source_table <> 'ipcs' THEN RAISE EXCEPTION 'ipc GL rows must have source_table = ''ipcs''.'; END IF;
        SELECT * INTO ipc FROM ipcs WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'ipcs row % not found', NEW.source_record_id; END IF;
        IF ipc.status <> 'client_approved' THEN RAISE EXCEPTION 'ipcs % status "%" not postable.', ipc.id, ipc.status; END IF;
        IF ipc.posted_ar_id IS NOT NULL THEN RAISE EXCEPTION 'ipcs % already posted.', ipc.id; END IF;
        IF NEW.project_id <> ipc.project_id THEN RAISE EXCEPTION 'project_id mismatch for %.', ipc.id; END IF;

    ELSIF NEW.source_module = 'payment' THEN
        IF NEW.source_table <> 'payments' THEN RAISE EXCEPTION 'payment GL rows must have source_table = ''payments''.'; END IF;
        SELECT * INTO pay FROM payments WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'payments row % not found', NEW.source_record_id; END IF;
        IF pay.status <> 'approved' THEN RAISE EXCEPTION 'payments % status "%" not postable.', pay.id, pay.status; END IF;
        IF NEW.currency_id <> pay.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for %.', pay.id; END IF;

    ELSIF NEW.source_module = 'manual_journal' THEN
        IF NEW.source_table <> 'manual_journal_entries' THEN RAISE EXCEPTION 'must have source_table = ''manual_journal_entries''.'; END IF;
        SELECT * INTO mje FROM manual_journal_entries WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'manual_journal_entries row % not found', NEW.source_record_id; END IF;
        IF mje.status <> 'approved' THEN RAISE EXCEPTION 'manual_journal_entries % status "%" not postable.', mje.id, mje.status; END IF;

    -- ---------------- payroll_overhead: NEW in Phase 4 ----------------
    ELSIF NEW.source_module = 'payroll_overhead' THEN
        IF NEW.source_table <> 'payroll_lines' THEN
            RAISE EXCEPTION 'payroll_overhead GL rows must have source_table = ''payroll_lines''.';
        END IF;
        SELECT * INTO pl FROM payroll_lines WHERE id = NEW.source_record_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'payroll_lines row % not found', NEW.source_record_id; END IF;
        IF pl.project_id IS NOT NULL THEN
            RAISE EXCEPTION 'payroll_lines % has a project_id — project-allocated payroll posts via cost_transactions, not payroll_overhead.', pl.id;
        END IF;
        SELECT * INTO pr FROM payroll_runs WHERE id = pl.payroll_run_id;
        IF pr.status <> 'approved' THEN RAISE EXCEPTION 'payroll_runs % status "%" not postable.', pr.id, pr.status; END IF;
        IF pl.posted_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'payroll_lines % already posted to GL.', pl.id; END IF;
        IF NEW.currency_id <> pl.currency_id THEN RAISE EXCEPTION 'currency_id mismatch for payroll_lines %.', pl.id; END IF;

    -- ---------------- Stage 31 / DEC-009 (080) ----------------
    ELSIF NEW.source_module = 'revenue_recognition' THEN
        IF NEW.source_table <> 'revenue_recognition_runs' THEN RAISE EXCEPTION 'revenue_recognition GL rows must have source_table = ''revenue_recognition_runs''.'; END IF;
        SELECT * INTO rr FROM revenue_recognition_runs WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'revenue_recognition_runs row % not found', NEW.source_record_id; END IF;
        IF rr.status <> 'prepared' THEN RAISE EXCEPTION 'Revenue run % is % and cannot be posted again.', rr.id, rr.status; END IF;
        IF NEW.project_id IS DISTINCT FROM rr.project_id THEN RAISE EXCEPTION 'project_id mismatch for revenue run %.', rr.id; END IF;
        IF NEW.transaction_date <> rr.period_end THEN RAISE EXCEPTION 'Revenue run % posts on its period end %.', rr.id, rr.period_end; END IF;

    ELSIF NEW.source_module = 'retention_release' THEN
        IF NEW.source_table <> 'retention_ledger' THEN RAISE EXCEPTION 'retention_release GL rows must have source_table = ''retention_ledger''.'; END IF;
        SELECT * INTO rl FROM retention_ledger WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'retention_ledger row % not found', NEW.source_record_id; END IF;
        IF rl.release_status <> 'released' OR rl.release_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'Retention % is not a released, unposted retention.', rl.id; END IF;
        IF NEW.project_id IS DISTINCT FROM rl.project_id THEN RAISE EXCEPTION 'project_id mismatch for retention %.', rl.id; END IF;

    ELSE
        RAISE EXCEPTION 'Unrecognized GL source_module "%".', NEW.source_module;
    END IF;

    RETURN NEW;
END;
$$;
