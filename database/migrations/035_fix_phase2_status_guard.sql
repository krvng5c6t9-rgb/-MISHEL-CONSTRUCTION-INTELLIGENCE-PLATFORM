-- CC-006: guard_phase2_status() (migration 012) referenced NEW.stage inside a compound
-- condition evaluated for every table it guards. PL/pgSQL resolves record fields at
-- execution time, so any UPDATE on tenders/contracts/variations raised
-- 'record "new" has no field "stage"' and the row could never change state.
-- Same transition rules as 012; only the table dispatch is restructured so each branch
-- touches only columns that exist on that table.
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
      IF NOT ((OLD.status='proposed' AND NEW.status='under_review')
           OR (OLD.status='under_review' AND NEW.status IN ('approved','rejected'))
           OR (OLD.status='rejected' AND NEW.status='proposed')) THEN
        RAISE EXCEPTION 'Illegal variation status transition: % -> %', OLD.status, NEW.status;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
