-- CC-027 (RK-003 approval engine sweep): rejection / return of an approval must release the business record.
-- Runtime finding (sweep_approval_rejection.mjs): the approval engine only closed the approval instance; records
-- moved out of draft on submission (contracts, variations, manual journals, payroll runs) stayed under review for
-- ever, and the status guards had no "returned for correction" transition. This migration adds the return paths,
-- makes a rejected variation terminal, and removes the payroll draft -> approved transition that bypassed approval.
-- (transaction managed by migrator)
CREATE OR REPLACE FUNCTION guard_phase2_status()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      IF NOT ((OLD.stage='new' AND NEW.stage IN ('qualified','lost'))
           OR (OLD.stage='qualified' AND NEW.stage IN ('proposal','lost'))
           OR (OLD.stage='proposal' AND NEW.stage IN ('won','lost'))
           OR (OLD.stage='lost' AND NEW.stage='new')) THEN
        RAISE EXCEPTION 'Illegal lead stage transition: % -> %', OLD.stage, NEW.stage;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'tenders' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT ((OLD.status='invited' AND NEW.status IN ('in_progress','withdrawn'))
           OR (OLD.status='in_progress' AND NEW.status IN ('submitted','withdrawn'))
           OR (OLD.status='submitted' AND NEW.status IN ('won','lost','withdrawn'))
           OR (OLD.status='lost' AND NEW.status='in_progress')) THEN
        RAISE EXCEPTION 'Illegal tender status transition: % -> %', OLD.status, NEW.status;
      END IF;
      IF NEW.status='won' AND (NEW.awarded_value IS NULL OR NEW.awarded_value < 0) THEN
        RAISE EXCEPTION 'Won tender requires awarded_value';
      END IF;
      IF NEW.status='lost' AND (NEW.loss_reason IS NULL OR btrim(NEW.loss_reason)='') THEN
        RAISE EXCEPTION 'Lost tender requires loss_reason';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'contracts' THEN
    IF NEW.contract_status IS DISTINCT FROM OLD.contract_status THEN
      IF NOT ((OLD.contract_status='draft' AND NEW.contract_status='under_review')
           OR (OLD.contract_status='under_review' AND NEW.contract_status IN ('signed','draft'))
           OR (OLD.contract_status='signed' AND NEW.contract_status='active')
           OR (OLD.contract_status='active' AND NEW.contract_status IN ('closed','terminated'))) THEN
        RAISE EXCEPTION 'Illegal contract status transition: % -> %', OLD.contract_status, NEW.contract_status;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'variations' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- CC-027: under_review -> proposed (approval returned for correction). rejected is terminal: a revised
      -- proposal is raised as a new variation (STEP09), so rejected -> proposed is no longer allowed.
      IF NOT ((OLD.status='proposed' AND NEW.status='under_review')
           OR (OLD.status='under_review' AND NEW.status IN ('approved','rejected','proposed'))) THEN
        RAISE EXCEPTION 'Illegal variation status transition: % -> %', OLD.status, NEW.status;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_manual_journal_entry_status()
RETURNS trigger AS $$
DECLARE
    line_balance NUMERIC(18,2);
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF NOT (
           (OLD.status = 'draft'            AND NEW.status IN ('pending_approval','cancelled'))
        OR (OLD.status = 'pending_approval' AND NEW.status IN ('approved','rejected','cancelled','draft'))
        OR (OLD.status = 'approved'         AND NEW.status = 'posted')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on manual_journal_entries %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;
    -- Cannot even submit an unbalanced entry for approval.
    IF NEW.status = 'pending_approval' THEN
        SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) INTO line_balance
        FROM manual_journal_entry_lines WHERE journal_entry_id = NEW.id;
        IF line_balance <> 0 THEN
            RAISE EXCEPTION 'manual_journal_entries % does not balance (debit - credit = %) — cannot submit for approval.',
                NEW.id, line_balance;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_phase5_status_transition()
RETURNS trigger AS $$
DECLARE ok boolean := false;
BEGIN
  IF TG_TABLE_NAME='payroll_runs' THEN
    -- draft -> approved removed: a payroll run is approved only through its approval instance.
    ok := (OLD.status, NEW.status) IN (('draft','pending_approval'),('pending_approval','approved'),('pending_approval','draft'),('approved','posted'),('posted','paid'));
  ELSIF TG_TABLE_NAME='equipment_usage' THEN
    ok := (OLD.status, NEW.status) IN (('draft','approved'));
  ELSIF TG_TABLE_NAME='ncrs' THEN
    ok := (OLD.status, NEW.status) IN (('open','closed'));
  ELSIF TG_TABLE_NAME='incidents' THEN
    ok := (OLD.investigation_status, NEW.investigation_status) IN (('open','closed'));
  ELSIF TG_TABLE_NAME='permits_to_work' THEN
    ok := (OLD.status, NEW.status) IN (('active','expired'),('active','closed'));
  ELSE
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND TG_TABLE_NAME NOT IN ('incidents') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='incidents' AND OLD.investigation_status IS NOT DISTINCT FROM NEW.investigation_status THEN RETURN NEW; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'Invalid Phase 5 status transition on %: % -> %', TG_TABLE_NAME, OLD.status, NEW.status; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
