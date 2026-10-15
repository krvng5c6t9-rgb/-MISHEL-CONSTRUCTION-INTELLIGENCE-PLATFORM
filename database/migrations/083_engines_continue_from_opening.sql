-- Stage 35 / F-49 / DEC-019 part 2: the live engines continue from the opening positions brought in at cut-over.
-- (transaction managed by migrator)
-- Before (E3 @dece6b0, F-49): contract and subcontract positions were recorded and reconciled at cut-over (CC-063) but
-- nothing used them - the first revenue run would recognise from zero, the next subcontract certificate would treat the
-- legacy work as new, opening advances could not be recovered (or new ones could exceed the limit), and opening retention
-- could never be released.
-- Now (an opened plan's position is "the opening position"):
--  * client IPCs: advance outstanding includes advances received / recovered before cut-over; the "less previous
--    certified" cap includes the net certified before cut-over (gross - retention - advance recovered); new client
--    advances count the opening advances toward the contract limit;
--  * subcontract certificates: the previous cumulative gross includes the gross certified before cut-over (so the next
--    certificate measures cumulatively from the legacy figure); advance outstanding includes opening advance paid /
--    recovered; new advances count the opening advance toward the subcontract limit;
--  * revenue runs: start on or after the cut-over date; cost to date and EAC include the cost before cut-over; the first
--    run's previous revenue is the revenue recognised before cut-over; billings include the gross certified before it;
--  * opening retention can be released, in parts, up to the retention held at cut-over, with reason and certificate
--    reference, by someone other than the plan preparer: client retention becomes a receivable and is reclassified to
--    receivables in the GL; subcontract retention becomes a payable whose payment clears the retention payable account;
--  * positions (contract receivable, client advance, subcontract deductions) show the opening figures.
-- Rollback: re-apply the 070/077/078/079/080/082 definitions; drop opening_retention_releases and the helper functions.

CREATE OR REPLACE FUNCTION opening_contract_position(p_contract BIGINT) RETURNS TABLE (
  id BIGINT, plan_id BIGINT, contract_id BIGINT, certified_gross_to_date NUMERIC, retention_held NUMERIC, advances_received NUMERIC,
  advance_recovered NUMERIC, cost_to_date NUMERIC, eac NUMERIC, revenue_recognised_to_date NUMERIC, cutover_date DATE) AS $$
  SELECT p.id, p.plan_id, p.contract_id, p.certified_gross_to_date, p.retention_held, p.advances_received, p.advance_recovered,
         p.cost_to_date, p.eac, p.revenue_recognised_to_date, c.cutover_date
  FROM cutover_contract_positions p JOIN cutover_plans c ON c.id = p.plan_id AND c.status = 'opened'
  WHERE p.contract_id = p_contract
$$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION opening_subcontract_position(p_subcontract BIGINT) RETURNS TABLE (
  id BIGINT, plan_id BIGINT, subcontract_id BIGINT, certified_gross_to_date NUMERIC, retention_held NUMERIC, advance_paid NUMERIC,
  advance_recovered NUMERIC, cutover_date DATE) AS $$
  SELECT p.id, p.plan_id, p.subcontract_id, p.certified_gross_to_date, p.retention_held, p.advance_paid, p.advance_recovered, c.cutover_date
  FROM cutover_subcontract_positions p JOIN cutover_plans c ON c.id = p.plan_id AND c.status = 'opened'
  WHERE p.subcontract_id = p_subcontract
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS opening_retention_releases (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('client','subcontract')),
  position_id BIGINT NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  reference TEXT NOT NULL CHECK (length(trim(reference)) >= 3),
  released_by BIGINT NOT NULL REFERENCES users(id),
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  receivable_id BIGINT REFERENCES accounts_receivable(id),
  payable_id BIGINT REFERENCES accounts_payable(id),
  gl_batch_id BIGINT,
  -- A client release links a receivable (and its GL reclassification); a subcontract release links a payable. The link
  -- is set right after the insert, so only the wrong-side link is refused here.
  CHECK (kind = 'subcontract' OR payable_id IS NULL),
  CHECK (kind = 'client' OR (receivable_id IS NULL AND gl_batch_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_opening_retention_position ON opening_retention_releases(kind, position_id);
-- A release names a position of an opened plan of the same organisation, never exceeds what remains held, is made by
-- someone other than the plan preparer, and is frozen except for linking its receivable / payable / GL batch once.
CREATE OR REPLACE FUNCTION guard_opening_retention_release() RETURNS trigger AS $$
DECLARE pos record; released numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retention releases are never deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'receivable_id' - 'payable_id' - 'gl_batch_id') <> (to_jsonb(OLD) - 'receivable_id' - 'payable_id' - 'gl_batch_id')
       OR (OLD.receivable_id IS NOT NULL AND NEW.receivable_id IS DISTINCT FROM OLD.receivable_id)
       OR (OLD.payable_id IS NOT NULL AND NEW.payable_id IS DISTINCT FROM OLD.payable_id)
       OR (OLD.gl_batch_id IS NOT NULL AND NEW.gl_batch_id IS DISTINCT FROM OLD.gl_batch_id) THEN
      RAISE EXCEPTION 'Opening retention release % is frozen', OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.receivable_id IS NOT NULL OR NEW.payable_id IS NOT NULL OR NEW.gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'A release starts unlinked'; END IF;
  IF NEW.kind = 'client' THEN
    SELECT p.id, p.org_id, p.retention_held, c.prepared_by INTO pos FROM cutover_contract_positions p JOIN cutover_plans c ON c.id = p.plan_id AND c.status = 'opened' WHERE p.id = NEW.position_id FOR UPDATE OF p;
  ELSE
    SELECT p.id, p.org_id, p.retention_held, c.prepared_by INTO pos FROM cutover_subcontract_positions p JOIN cutover_plans c ON c.id = p.plan_id AND c.status = 'opened' WHERE p.id = NEW.position_id FOR UPDATE OF p;
  END IF;
  IF pos.id IS NULL OR pos.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Opening % position % not found in an opened cut-over of this organisation', NEW.kind, NEW.position_id; END IF;
  IF NEW.released_by = pos.prepared_by THEN RAISE EXCEPTION 'Segregation of duties: the cut-over preparer cannot release the opening retention'; END IF;
  SELECT coalesce(sum(amount), 0) INTO released FROM opening_retention_releases WHERE kind = NEW.kind AND position_id = NEW.position_id;
  IF released + NEW.amount > pos.retention_held THEN
    RAISE EXCEPTION 'Release % exceeds the opening retention still held % (held %, released %)', NEW.amount, pos.retention_held - released, pos.retention_held, released;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_opening_retention_release ON opening_retention_releases;
CREATE TRIGGER trg_opening_retention_release BEFORE INSERT OR UPDATE OR DELETE ON opening_retention_releases FOR EACH ROW EXECUTE FUNCTION guard_opening_retention_release();
ALTER TABLE opening_retention_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_retention_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON opening_retention_releases;
DROP POLICY IF EXISTS tenant_isolation_write ON opening_retention_releases;
CREATE POLICY tenant_isolation_select ON opening_retention_releases FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON opening_retention_releases FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);

ALTER TABLE accounts_receivable DROP CONSTRAINT IF EXISTS accounts_receivable_source_type_check;
ALTER TABLE accounts_receivable ADD CONSTRAINT accounts_receivable_source_type_check CHECK (source_type IN ('ipc','client_advance','retention_release','opening','opening_retention'));
ALTER TABLE accounts_payable DROP CONSTRAINT IF EXISTS accounts_payable_source_type_check;
ALTER TABLE accounts_payable ADD CONSTRAINT accounts_payable_source_type_check
  CHECK (source_type IN ('vendor_invoice','subcontract_certificate','subcontract_retention','subcontract_advance','opening','opening_retention'));

CREATE OR REPLACE FUNCTION guard_ar_source() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF NEW.source_type = 'ipc' THEN RETURN NEW; END IF;
  IF NEW.source_type = 'opening' THEN
    SELECT o.id, o.org_id, o.client_id, o.project_id, org.base_currency_id AS currency_id, o.amount AS amt INTO c
      FROM cutover_receivables o JOIN organizations org ON org.id = o.org_id WHERE o.id = NEW.source_record_id;
  ELSIF NEW.source_type = 'opening_retention' THEN
    SELECT k.id, r.org_id, k.client_id, k.project_id, k.currency_id, r.amount AS amt INTO c
      FROM opening_retention_releases r JOIN cutover_contract_positions p ON p.id = r.position_id JOIN contracts k ON k.id = p.contract_id
      WHERE r.id = NEW.source_record_id AND r.kind = 'client';
  ELSIF NEW.source_type = 'client_advance' THEN
    SELECT k.id, k.org_id, k.client_id, k.project_id, k.currency_id, a.amount AS amt INTO c
      FROM client_advances a JOIN contracts k ON k.id = a.contract_id WHERE a.id = NEW.source_record_id;
  ELSE
    SELECT k.id, k.org_id, k.client_id, k.project_id, k.currency_id, r.retained_amount AS amt INTO c
      FROM retention_ledger r JOIN ipcs i ON i.id = r.ipc_id JOIN contracts k ON k.id = i.contract_id WHERE r.id = NEW.source_record_id;
  END IF;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Receivable source % % not found in this organization', NEW.source_type, NEW.source_record_id; END IF;
  IF NEW.client_id <> c.client_id OR NEW.project_id <> c.project_id THEN RAISE EXCEPTION 'Receivable client/project must be the source client/project'; END IF;
  IF NEW.currency_id <> c.currency_id THEN RAISE EXCEPTION 'Receivable currency differs from the source currency'; END IF;
  IF NEW.amount <> c.amt THEN RAISE EXCEPTION 'Receivable % for % % must equal its source amount %', NEW.amount, NEW.source_type, NEW.source_record_id, c.amt; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ar_contract_id(p_ar BIGINT) RETURNS BIGINT AS $$
  SELECT CASE a.source_type
    WHEN 'ipc' THEN (SELECT contract_id FROM ipcs WHERE id = a.ipc_id)
    WHEN 'client_advance' THEN (SELECT contract_id FROM client_advances WHERE id = a.source_record_id)
    WHEN 'retention_release' THEN (SELECT i.contract_id FROM retention_ledger r JOIN ipcs i ON i.id = r.ipc_id WHERE r.id = a.source_record_id)
    WHEN 'opening' THEN (SELECT contract_id FROM cutover_receivables WHERE id = a.source_record_id)
    WHEN 'opening_retention' THEN (SELECT p.contract_id FROM opening_retention_releases r JOIN cutover_contract_positions p ON p.id = r.position_id WHERE r.id = a.source_record_id)
  END FROM accounts_receivable a WHERE a.id = p_ar
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION guard_ap_opening() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  IF NEW.source_type = 'opening' THEN
    SELECT o.id, o.org_id, o.vendor_id, o.project_id, org.base_currency_id AS currency_id, o.amount INTO c
      FROM cutover_payables o JOIN organizations org ON org.id = o.org_id WHERE o.id = NEW.source_record_id;
  ELSIF NEW.source_type = 'opening_retention' THEN
    SELECT r.id, r.org_id, s.vendor_id, s.project_id, s.currency_id, r.amount INTO c
      FROM opening_retention_releases r JOIN cutover_subcontract_positions p ON p.id = r.position_id JOIN subcontracts s ON s.id = p.subcontract_id
      WHERE r.id = NEW.source_record_id AND r.kind = 'subcontract';
  ELSE
    RETURN NEW;
  END IF;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Opening payable source % not found in this organization', NEW.source_record_id; END IF;
  IF NEW.vendor_id <> c.vendor_id OR NEW.project_id IS DISTINCT FROM c.project_id OR NEW.currency_id <> c.currency_id OR NEW.amount <> c.amount THEN
    RAISE EXCEPTION 'Opening payable must equal its source (vendor, project, currency, amount %)', c.amount;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION guard_ipc_deductions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE c record; received numeric; recovered numeric; outstanding numeric; rate_part numeric; rated int; expected numeric; prev_net numeric; op record;
BEGIN
  IF NOT (TG_OP = 'INSERT' OR (OLD.status = 'draft' AND NEW.status = 'submitted_to_client')) THEN RETURN NEW; END IF;
  SELECT id, retention_percent INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.retention_percent IS NOT NULL AND NEW.less_retention > round((NEW.gross_work_done_this_period + NEW.materials_on_site_value) * c.retention_percent / 100, 2) THEN
    RAISE EXCEPTION 'Retention % exceeds % percent of gross this period plus materials on site %', NEW.less_retention, c.retention_percent, NEW.gross_work_done_this_period + NEW.materials_on_site_value;
  END IF;
  SELECT coalesce(sum(amount), 0), coalesce(sum(round(NEW.gross_work_done_this_period * recovery_percent / 100, 2)), 0), count(recovery_percent)
    INTO received, rate_part, rated FROM client_advances WHERE contract_id = NEW.contract_id AND status = 'received';
  SELECT coalesce(sum(coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) INTO recovered FROM ipcs
    WHERE contract_id = NEW.contract_id AND id IS DISTINCT FROM NEW.id AND status <> 'draft';
  -- F-49 (083): an in-flight contract continues from its opening position (advances received / recovered before cut-over).
  SELECT * INTO op FROM opening_contract_position(NEW.contract_id);
  received := received + coalesce(op.advances_received, 0);
  recovered := recovered + coalesce(op.advance_recovered, 0);
  outstanding := received - recovered;
  IF NEW.less_advance_recovery > outstanding THEN
    RAISE EXCEPTION 'Advance recovery % exceeds the outstanding received advance % (received %, already recovered %)', NEW.less_advance_recovery, outstanding, received, recovered;
  END IF;
  IF rated > 0 THEN
    expected := least(rate_part, outstanding);
    IF NEW.less_advance_recovery <> expected THEN
      RAISE EXCEPTION 'Advance recovery % differs from the recovery due % (recorded rate on gross this period %, capped at outstanding %)', NEW.less_advance_recovery, expected, NEW.gross_work_done_this_period, outstanding;
    END IF;
  END IF;
  SELECT coalesce(sum(coalesce(client_certified_amount, net_amount_due)), 0) INTO prev_net FROM ipcs
    WHERE contract_id = NEW.contract_id AND id IS DISTINCT FROM NEW.id AND status IN ('client_approved','posted','paid');
  -- Net certified before cut-over = certified gross less retention held and advance recovered.
  prev_net := prev_net + coalesce(op.certified_gross_to_date - op.retention_held - op.advance_recovered, 0);
  IF NEW.less_previous_certified > prev_net THEN
    RAISE EXCEPTION 'Less previous certified % exceeds the net certified on earlier client-approved IPCs %', NEW.less_previous_certified, prev_net;
  END IF;
  RETURN NEW;
END $$

;

CREATE OR REPLACE FUNCTION guard_subcontract_certificate_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE s subcontracts%ROWTYPE; line_total numeric; line_count int;
        paid_adv numeric; recovered numeric; outstanding numeric; rate_part numeric; rated int; expected numeric;
        bc_total numeric; prev_net numeric; prev_cum numeric; cum_lines numeric; op record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft subcontract certificates can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO s FROM subcontracts WHERE id = NEW.subcontract_id;
  IF TG_OP = 'INSERT' THEN
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Certificates can only be raised against an active (approved) subcontract; subcontract % is %', s.id, s.status; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Certificates start as draft'; END IF;
    RETURN NEW;
  END IF;
  -- Valuation fields are frozen once the certificate leaves draft.
  IF OLD.status <> 'draft' AND (NEW.gross_work_done, NEW.less_retention, NEW.less_advance_recovery, NEW.less_previous_paid, NEW.penalties_deductions, NEW.subcontract_id, NEW.project_id, NEW.period_from, NEW.period_to)
       IS DISTINCT FROM (OLD.gross_work_done, OLD.less_retention, OLD.less_advance_recovery, OLD.less_previous_paid, OLD.penalties_deductions, OLD.subcontract_id, OLD.project_id, OLD.period_from, OLD.period_to) THEN
    RAISE EXCEPTION 'Subcontract certificate valuation is frozen after draft';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'site_verified' THEN
    -- Serialise deduction checks per subcontract (two certificates must not recover the same advance).
    PERFORM 1 FROM subcontracts WHERE id = NEW.subcontract_id FOR UPDATE;
    SELECT coalesce(sum(amount), 0), count(*) INTO line_total, line_count FROM subcontract_certificate_lines WHERE certificate_id = NEW.id;
    IF line_count > 0 AND line_total <> NEW.gross_work_done THEN
      RAISE EXCEPTION 'Certificate gross % does not equal the sum of its lines %', NEW.gross_work_done, line_total;
    END IF;
    IF s.retention_percent IS NOT NULL AND NEW.less_retention > round(NEW.gross_work_done * s.retention_percent / 100, 2) THEN
      RAISE EXCEPTION 'Retention % exceeds % percent of gross %', NEW.less_retention, s.retention_percent, NEW.gross_work_done;
    END IF;
    -- Advance recovery: only of paid advances, never above the outstanding balance, at the recorded rate when one exists.
    SELECT coalesce(sum(amount), 0), coalesce(sum(round(NEW.gross_work_done * recovery_percent / 100, 2)), 0), count(recovery_percent)
      INTO paid_adv, rate_part, rated FROM subcontract_advances WHERE subcontract_id = NEW.subcontract_id AND status = 'paid';
    SELECT coalesce(sum(less_advance_recovery), 0) INTO recovered FROM subcontract_certificates
      WHERE subcontract_id = NEW.subcontract_id AND id <> NEW.id AND status <> 'draft';
    -- F-49 (083): an in-flight subcontract continues from its opening position.
    SELECT * INTO op FROM opening_subcontract_position(NEW.subcontract_id);
    paid_adv := paid_adv + coalesce(op.advance_paid, 0);
    recovered := recovered + coalesce(op.advance_recovered, 0);
    outstanding := paid_adv - recovered;
    IF NEW.less_advance_recovery > outstanding THEN
      RAISE EXCEPTION 'Advance recovery % exceeds the outstanding paid advance % (paid %, already recovered %)', NEW.less_advance_recovery, outstanding, paid_adv, recovered;
    END IF;
    IF rated > 0 THEN
      expected := least(rate_part, outstanding);
      IF NEW.less_advance_recovery <> expected THEN
        RAISE EXCEPTION 'Advance recovery % differs from the recovery due % (recorded rate on gross %, capped at outstanding %)', NEW.less_advance_recovery, expected, NEW.gross_work_done, outstanding;
      END IF;
    END IF;
    -- Back-charges: the deduction is exactly the approved back-charges applied to this certificate.
    SELECT coalesce(sum(amount), 0) INTO bc_total FROM subcontract_backcharges WHERE certificate_id = NEW.id AND status = 'applied';
    IF NEW.penalties_deductions <> bc_total THEN
      RAISE EXCEPTION 'Deductions % must equal the back-charges applied to this certificate %', NEW.penalties_deductions, bc_total;
    END IF;
    -- Defect (043): the generated net_amount_due of the new row is not yet computed in a BEFORE trigger (NULL), so the
    -- "never negative" check never fired. The net is computed here from its parts.
    IF NEW.gross_work_done - NEW.less_retention - NEW.less_advance_recovery - NEW.less_previous_paid - NEW.penalties_deductions < 0 THEN
      RAISE EXCEPTION 'Net amount due % cannot be negative; use a separate credit process', NEW.gross_work_done - NEW.less_retention - NEW.less_advance_recovery - NEW.less_previous_paid - NEW.penalties_deductions;
    END IF;
    IF NEW.period_to < NEW.period_from THEN RAISE EXCEPTION 'Certificate period end precedes start'; END IF;
    -- DEC-012: cumulative valuation. "Less previous" is implicit (the period gross is already the difference of the
    -- cumulative values) and must be 0; the period gross must equal the cumulative measure less the earlier cumulative.
    IF NEW.less_previous_paid <> 0 THEN
      RAISE EXCEPTION 'Less previous must be 0 under cumulative valuation (the period gross is cumulative to date less previous cumulative); got %', NEW.less_previous_paid;
    END IF;
    SELECT coalesce(sum(gross_work_done), 0) INTO prev_cum FROM subcontract_certificates
      WHERE subcontract_id = NEW.subcontract_id AND id <> NEW.id AND status NOT IN ('draft','rejected');
    prev_cum := prev_cum + coalesce(op.certified_gross_to_date, 0);
    IF line_count > 0 THEN
      SELECT coalesce(sum(cumulative_quantity * unit_rate), 0) INTO cum_lines FROM subcontract_certificate_lines WHERE certificate_id = NEW.id;
      IF cum_lines - prev_cum <> NEW.gross_work_done THEN
        RAISE EXCEPTION 'Cumulative measure % less previous cumulative % = % does not equal the period gross %', cum_lines, prev_cum, cum_lines - prev_cum, NEW.gross_work_done;
      END IF;
    END IF;
    NEW.previous_cumulative_gross := prev_cum;
    NEW.cumulative_gross_to_date := prev_cum + NEW.gross_work_done;
  END IF;
  RETURN NEW;
END $$

;

CREATE OR REPLACE FUNCTION guard_revenue_run()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE k record; prev record; missing text; v_snap record; v_est record; v_var numeric; v_bill numeric; op record; v_cost numeric; v_eac numeric;
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
  -- F-49 (083): an in-flight contract continues from its opening position: runs start on or after the cut-over date;
  -- cost to date and EAC include the cost incurred before cut-over; the first run's previous revenue is the revenue
  -- recognised before cut-over; billings include the gross certified before cut-over.
  SELECT * INTO op FROM opening_contract_position(NEW.contract_id);
  IF op.id IS NOT NULL AND NEW.period_start < op.cutover_date THEN
    RAISE EXCEPTION 'Contract % was brought in at cut-over %; revenue runs start on or after it', NEW.contract_id, op.cutover_date;
  END IF;
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
  v_cost := v_snap.cost + coalesce(op.cost_to_date, 0);
  v_eac := v_snap.eac + coalesce(op.cost_to_date, 0);
  IF v_snap.ids IS NULL OR v_eac <= 0 THEN RAISE EXCEPTION 'No approved estimate at completion for project % inside the period', k.project_id; END IF;
  SELECT coalesce(sum(agreed_amount), 0) INTO v_var FROM variations
   WHERE contract_id = NEW.contract_id AND client_status = 'agreed' AND client_decided_on <= NEW.period_end;
  SELECT coalesce(sum(amount), 0) AS total, array_agg(id ORDER BY id) AS ids INTO v_est FROM revenue_price_estimates
   WHERE contract_id = NEW.contract_id AND status IN ('approved','retired') AND effective_from <= NEW.period_end
     AND (retired_on IS NULL OR retired_on > NEW.period_end);
  SELECT coalesce(sum(coalesce(client_certified_amount, net_amount_due) + coalesce(client_certified_retention, less_retention)
                      + coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) INTO v_bill
    FROM ipcs WHERE contract_id = NEW.contract_id AND status IN ('posted','paid') AND coalesce(client_certified_on, client_approved_date) <= NEW.period_end;
  v_bill := v_bill + coalesce(op.certified_gross_to_date, 0);
  NEW.contract_value := k.contract_value; NEW.agreed_variations := v_var; NEW.approved_estimates := v_est.total;
  NEW.transaction_price := k.contract_value + v_var + v_est.total;
  NEW.cost_to_date := v_cost; NEW.eac := v_eac;
  NEW.progress := least(round(v_cost / v_eac, 6), 1);
  NEW.cumulative_revenue := round(NEW.transaction_price * NEW.progress, 2);
  NEW.previous_revenue := coalesce(prev.cumulative_revenue, op.revenue_recognised_to_date, 0);
  NEW.period_revenue := NEW.cumulative_revenue - NEW.previous_revenue;
  NEW.expected_loss := greatest(v_eac - NEW.transaction_price, 0);
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
    'snapshot_ids', to_jsonb(NEW.snapshot_ids), 'estimate_ids', to_jsonb(NEW.estimate_ids), 'opening_position_id', op.id);
  NEW.payload_sha256 := encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
  NEW.approved_by := NULL; NEW.approved_at := NULL;
  RETURN NEW;
END $$

;

CREATE OR REPLACE FUNCTION guard_client_advance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE c record; total numeric; ar record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft client advance can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, contract_status, contract_value, advance_payment_percent INTO c FROM contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF c.id IS NULL OR c.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Contract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'A client advance starts as draft'; END IF;
    IF NEW.receivable_id IS NOT NULL OR NEW.received_payment_id IS NOT NULL THEN RAISE EXCEPTION 'A draft client advance has no receivable or receipt'; END IF;
    IF c.contract_status NOT IN ('signed','active') THEN RAISE EXCEPTION 'Client advances are recorded only under a signed or active contract (contract % is %)', c.id, c.contract_status; END IF;
    IF c.advance_payment_percent IS NULL OR c.advance_payment_percent <= 0 THEN
      RAISE EXCEPTION 'Contract % provides no advance payment (advance_payment_percent not set)', c.id;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO total FROM client_advances WHERE contract_id = NEW.contract_id;
    -- F-49 (083): advances received before cut-over count toward the contract limit.
    total := total + coalesce((SELECT advances_received FROM opening_contract_position(NEW.contract_id)), 0);
    IF total + NEW.amount > round(c.contract_value * c.advance_payment_percent / 100, 2) THEN
      RAISE EXCEPTION 'Client advances % exceed % percent of the contract value %', total + NEW.amount, c.advance_payment_percent, c.contract_value;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.org_id, NEW.contract_id, NEW.amount, NEW.recovery_percent, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.org_id, OLD.contract_id, OLD.amount, OLD.recovery_percent, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Client advance % is approved; its terms are frozen', OLD.id;
  END IF;
  IF OLD.status = 'received' THEN RAISE EXCEPTION 'Client advance % is received and immutable', OLD.id; END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status IN ('draft','approved')) OR (OLD.status = 'approved' AND NEW.status IN ('approved','received'))) THEN
    RAISE EXCEPTION 'Invalid client advance transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.receivable_id IS NOT NULL AND NEW.receivable_id IS DISTINCT FROM OLD.receivable_id THEN RAISE EXCEPTION 'Client advance % receivable is fixed', OLD.id; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND NOT (OLD.receivable_id IS NULL AND NEW.receivable_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An approved client advance changes only by being received';
  END IF;
  IF NEW.status = 'approved' THEN
    SELECT id, source_type, source_record_id INTO ar FROM accounts_receivable WHERE id = NEW.receivable_id;
    IF ar.id IS NULL OR ar.source_type <> 'client_advance' OR ar.source_record_id <> NEW.id THEN
      RAISE EXCEPTION 'An approved client advance needs its own advance receivable';
    END IF;
  END IF;
  IF NEW.status = 'received' THEN
    IF NEW.received_payment_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.received_payment_id AND p.related_ar_id = OLD.receivable_id AND p.status IN ('posted','reconciled')) THEN
      RAISE EXCEPTION 'Client advance % is received only through posted receipts against its receivable %', OLD.id, OLD.receivable_id;
    END IF;
    IF (SELECT coalesce(sum(amount + withheld_tax_amount), 0) FROM payments WHERE related_ar_id = OLD.receivable_id AND status IN ('posted','reconciled')) < OLD.amount THEN
      RAISE EXCEPTION 'Client advance % is not fully received', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$

;

CREATE OR REPLACE FUNCTION guard_subcontract_advance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE s record; total numeric; ap record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft advance can be deleted'; END IF;
    RETURN OLD;
  END IF;
  SELECT id, org_id, status, contract_value, advance_payment_percent, vendor_id INTO s FROM subcontracts WHERE id = NEW.subcontract_id FOR UPDATE;
  IF s.id IS NULL OR s.org_id <> NEW.org_id THEN RAISE EXCEPTION 'Subcontract not found in this organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'An advance starts as draft'; END IF;
    IF NEW.payable_id IS NOT NULL OR NEW.paid_payment_id IS NOT NULL THEN RAISE EXCEPTION 'A draft advance has no payable or payment'; END IF;
    IF s.status <> 'active' THEN RAISE EXCEPTION 'Advances are recorded only on an active subcontract (subcontract % is %)', s.id, s.status; END IF;
    IF s.advance_payment_percent IS NULL OR s.advance_payment_percent <= 0 THEN
      RAISE EXCEPTION 'Subcontract % provides no advance payment (advance_payment_percent not set)', s.id;
    END IF;
    SELECT coalesce(sum(amount), 0) INTO total FROM subcontract_advances WHERE subcontract_id = NEW.subcontract_id;
    -- F-49 (083): advances paid before cut-over count toward the subcontract limit.
    total := total + coalesce((SELECT advance_paid FROM opening_subcontract_position(NEW.subcontract_id)), 0);
    IF total + NEW.amount > round(s.contract_value * s.advance_payment_percent / 100, 2) THEN
      RAISE EXCEPTION 'Advances % exceed % percent of the subcontract value %', total + NEW.amount, s.advance_payment_percent, s.contract_value;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.subcontract_id, NEW.amount, NEW.recovery_percent, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.org_id, OLD.subcontract_id, OLD.amount, OLD.recovery_percent, OLD.created_by, OLD.created_at) AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Advance % is approved; its terms are frozen', OLD.id;
  END IF;
  IF OLD.status = 'paid' THEN RAISE EXCEPTION 'Advance % is paid and immutable', OLD.id; END IF;
  IF NOT ((OLD.status = NEW.status) OR (OLD.status = 'draft' AND NEW.status = 'approved') OR (OLD.status = 'approved' AND NEW.status = 'paid')) THEN
    RAISE EXCEPTION 'Invalid advance transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND NOT (OLD.payable_id IS NULL AND NEW.payable_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An approved advance changes only by being paid';
  END IF;
  IF OLD.payable_id IS NOT NULL AND NEW.payable_id IS DISTINCT FROM OLD.payable_id THEN RAISE EXCEPTION 'Advance % payable is fixed', OLD.id; END IF;
  -- F-33: approval opens the advance payable; payment is evidenced only by posted payments that settle it.
  IF NEW.status = 'approved' THEN
    SELECT id, source_type, source_record_id, vendor_id, amount INTO ap FROM accounts_payable WHERE id = NEW.payable_id;
    IF ap.id IS NULL OR ap.source_type <> 'subcontract_advance' OR ap.source_record_id <> NEW.id THEN
      RAISE EXCEPTION 'An approved advance needs its own advance payable';
    END IF;
  END IF;
  IF NEW.status = 'paid' THEN
    IF NEW.paid_payment_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.paid_payment_id AND p.related_ap_id = OLD.payable_id AND p.status IN ('posted','reconciled')) THEN
      RAISE EXCEPTION 'Advance % is paid only through posted payments against its payable %', OLD.id, OLD.payable_id;
    END IF;
    IF (SELECT coalesce(sum(amount + withheld_tax_amount), 0) FROM payments WHERE related_ap_id = OLD.payable_id AND status IN ('posted','reconciled')) < OLD.amount THEN
      RAISE EXCEPTION 'Advance % is not fully settled', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$

;

CREATE OR REPLACE FUNCTION client_advance_position(p_contract bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $$
  SELECT jsonb_build_object(
    'contract_id', c.id,
    'advance_limit', CASE WHEN c.advance_payment_percent IS NULL THEN NULL ELSE round(c.contract_value * c.advance_payment_percent / 100, 2) END,
    'advances_recorded', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id),
    'advances_received', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id AND status = 'received') + coalesce((SELECT advances_received FROM opening_contract_position(c.id)), 0),
    'advance_recovered', (SELECT coalesce(sum(coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) FROM ipcs WHERE contract_id = c.id AND status <> 'draft') + coalesce((SELECT advance_recovered FROM opening_contract_position(c.id)), 0),
    'advance_outstanding', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = c.id AND status = 'received')
                         - (SELECT coalesce(sum(coalesce(client_certified_advance_recovery, less_advance_recovery)), 0) FROM ipcs WHERE contract_id = c.id AND status <> 'draft')
                         + coalesce((SELECT advances_received - advance_recovered FROM opening_contract_position(c.id)), 0),
    'net_certified', (SELECT coalesce(sum(coalesce(client_certified_amount, net_amount_due)), 0) FROM ipcs WHERE contract_id = c.id AND status IN ('client_approved','posted','paid'))
                     + coalesce((SELECT certified_gross_to_date - retention_held - advance_recovered FROM opening_contract_position(c.id)), 0))
  FROM contracts c WHERE c.id = p_contract
$$

;

CREATE OR REPLACE FUNCTION subcontract_deductions_position(p_subcontract bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $$
  SELECT jsonb_build_object(
    'subcontract_id', s.id,
    'advance_limit', CASE WHEN s.advance_payment_percent IS NULL THEN NULL ELSE round(s.contract_value * s.advance_payment_percent / 100, 2) END,
    'advances_recorded', (SELECT coalesce(sum(amount), 0) FROM subcontract_advances WHERE subcontract_id = s.id),
    'opening_position', (SELECT to_jsonb(o) FROM opening_subcontract_position(s.id) o WHERE o.id IS NOT NULL),
    'advances_paid', (SELECT coalesce(sum(amount), 0) FROM subcontract_advances WHERE subcontract_id = s.id AND status = 'paid') + coalesce((SELECT advance_paid FROM opening_subcontract_position(s.id)), 0),
    'advance_recovered', (SELECT coalesce(sum(less_advance_recovery), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status <> 'draft') + coalesce((SELECT advance_recovered FROM opening_subcontract_position(s.id)), 0),
    'advance_outstanding', (SELECT coalesce(sum(amount), 0) FROM subcontract_advances WHERE subcontract_id = s.id AND status = 'paid')
                         - (SELECT coalesce(sum(less_advance_recovery), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status <> 'draft')
                         + coalesce((SELECT advance_paid - advance_recovered FROM opening_subcontract_position(s.id)), 0),
    'opening_retention_unreleased', coalesce((SELECT o.retention_held - (SELECT coalesce(sum(amount), 0) FROM opening_retention_releases WHERE kind = 'subcontract' AND position_id = o.id)
                         FROM opening_subcontract_position(s.id) o WHERE o.id IS NOT NULL), 0),
    'backcharges', (SELECT coalesce(jsonb_object_agg(status, total), '{}'::jsonb) FROM (SELECT status, sum(amount) total FROM subcontract_backcharges WHERE subcontract_id = s.id GROUP BY status) b),
    'backcharges_disputed', (SELECT coalesce(sum(amount), 0) FROM subcontract_backcharges WHERE subcontract_id = s.id AND subcontractor_response = 'disputed' AND status <> 'withdrawn'),
    'net_certified_approved', (SELECT coalesce(sum(net_amount_due), 0) FROM subcontract_certificates WHERE subcontract_id = s.id AND status IN ('approved','posted','paid')))
  FROM subcontracts s WHERE s.id = p_subcontract
$$

;

-- Contract position including the opening position brought in at cut-over (F-49): billed, retention held and
-- released, advances received / recovered start from the cut-over figures; opening receivables and released opening
-- retention are receivables of the contract.
CREATE OR REPLACE FUNCTION contract_receivable_position(p_contract bigint) RETURNS jsonb AS $$
  WITH i AS (
    SELECT coalesce(client_certified_amount, net_amount_due) AS net, coalesce(client_certified_retention, less_retention) AS ret,
           coalesce(client_certified_advance_recovery, less_advance_recovery) AS adv, coalesce(output_tax_amount, 0) AS tax
    FROM ipcs WHERE contract_id = p_contract AND status IN ('posted','paid')),
  op AS (SELECT * FROM opening_contract_position(p_contract)),
  opr AS (SELECT coalesce(sum(amount), 0) AS released FROM opening_retention_releases WHERE kind = 'client' AND position_id = (SELECT id FROM op)),
  ar AS (SELECT a.id, a.source_type, a.amount, (SELECT coalesce(sum(p.amount + p.withheld_tax_amount), 0) FROM payments p
           WHERE p.related_ar_id = a.id AND p.status IN ('posted','reconciled')) AS settled
         FROM accounts_receivable a WHERE ar_contract_id(a.id) = p_contract),
  r AS (SELECT r.retained_amount, r.release_status FROM retention_ledger r JOIN ipcs x ON x.id = r.ipc_id WHERE x.contract_id = p_contract)
  SELECT jsonb_build_object(
    'contract_id', p_contract,
    'opening_position', (SELECT to_jsonb(op) FROM op),
    'billed_gross', (SELECT coalesce(sum(net + ret + adv), 0) FROM i) + coalesce((SELECT certified_gross_to_date FROM op), 0),
    'billed_net', (SELECT coalesce(sum(net), 0) FROM i) + coalesce((SELECT certified_gross_to_date - retention_held - advance_recovered FROM op), 0),
    'output_tax_billed', (SELECT coalesce(sum(tax), 0) FROM i),
    'receivables_outstanding', (SELECT coalesce(sum(amount - settled), 0) FROM ar WHERE source_type IN ('ipc','retention_release','opening','opening_retention')),
    'collected', (SELECT coalesce(sum(settled), 0) FROM ar WHERE source_type IN ('ipc','retention_release','opening','opening_retention')),
    'retention_held', (SELECT coalesce(sum(retained_amount), 0) FROM r WHERE release_status = 'held') + coalesce((SELECT retention_held FROM op), 0) - (SELECT released FROM opr),
    'retention_released', (SELECT coalesce(sum(retained_amount), 0) FROM r WHERE release_status = 'released') + (SELECT released FROM opr),
    'advances_received', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = p_contract AND status = 'received') + coalesce((SELECT advances_received FROM op), 0),
    'advance_requests_outstanding', (SELECT coalesce(sum(amount - settled), 0) FROM ar WHERE source_type = 'client_advance'),
    'advance_recovered', (SELECT coalesce(sum(adv), 0) FROM i) + coalesce((SELECT advance_recovered FROM op), 0),
    'advance_liability', (SELECT coalesce(sum(amount), 0) FROM client_advances WHERE contract_id = p_contract AND status = 'received') - (SELECT coalesce(sum(adv), 0) FROM i)
                         + coalesce((SELECT advances_received - advance_recovered FROM op), 0))
$$ LANGUAGE sql STABLE;
;

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
    cp  cutover_plans%ROWTYPE;
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

    -- Stage 35 (083): released opening client retention is reclassified once, on the project of its contract.
    ELSIF NEW.source_module = 'retention_release' AND NEW.source_table = 'opening_retention_releases' THEN
        IF NOT EXISTS (SELECT 1 FROM opening_retention_releases o JOIN cutover_contract_positions p ON p.id = o.position_id JOIN contracts k ON k.id = p.contract_id
                       WHERE o.id = NEW.source_record_id AND o.kind = 'client' AND o.gl_batch_id IS NULL AND k.project_id = NEW.project_id) THEN
            RAISE EXCEPTION 'Opening retention release % is not a client release awaiting its reclassification on this project.', NEW.source_record_id;
        END IF;

    ELSIF NEW.source_module = 'retention_release' THEN
        IF NEW.source_table <> 'retention_ledger' THEN RAISE EXCEPTION 'retention_release GL rows must have source_table = ''retention_ledger''.'; END IF;
        SELECT * INTO rl FROM retention_ledger WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'retention_ledger row % not found', NEW.source_record_id; END IF;
        IF rl.release_status <> 'released' OR rl.release_gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'Retention % is not a released, unposted retention.', rl.id; END IF;
        IF NEW.project_id IS DISTINCT FROM rl.project_id THEN RAISE EXCEPTION 'project_id mismatch for retention %.', rl.id; END IF;

    ELSIF NEW.source_module = 'opening_balance' THEN
        IF NEW.source_table <> 'cutover_plans' THEN RAISE EXCEPTION 'opening_balance GL rows must have source_table = ''cutover_plans''.'; END IF;
        SELECT * INTO cp FROM cutover_plans WHERE id = NEW.source_record_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'cutover_plans row % not found', NEW.source_record_id; END IF;
        IF cp.status <> 'reconciled' OR cp.gl_batch_id IS NOT NULL THEN RAISE EXCEPTION 'Cut-over plan % is not a reconciled plan awaiting its opening journal.', cp.id; END IF;
        IF NEW.org_id <> cp.org_id OR NEW.transaction_date <> cp.cutover_date THEN RAISE EXCEPTION 'The opening journal posts on the cut-over date % of its organisation.', cp.cutover_date; END IF;
        IF NEW.currency_id <> (SELECT base_currency_id FROM organizations WHERE id = cp.org_id) THEN RAISE EXCEPTION 'The opening journal is in the base currency.'; END IF;

    ELSE
        RAISE EXCEPTION 'Unrecognized GL source_module "%".', NEW.source_module;
    END IF;

    RETURN NEW;
END;
$$;

;
