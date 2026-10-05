CREATE TABLE IF NOT EXISTS schedule_relationships (
    id                      BIGSERIAL PRIMARY KEY,
    project_id               BIGINT NOT NULL REFERENCES projects(id),
    predecessor_activity_id   BIGINT NOT NULL REFERENCES schedule_activities(id),
    successor_activity_id     BIGINT NOT NULL REFERENCES schedule_activities(id),
    relationship_type         VARCHAR(2) NOT NULL CHECK (relationship_type IN ('FS','SS','FF','SF')),
    lag_days                  INT NOT NULL DEFAULT 0,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (predecessor_activity_id <> successor_activity_id),
    UNIQUE (predecessor_activity_id, successor_activity_id, relationship_type, lag_days)
);

CREATE INDEX IF NOT EXISTS idx_sched_rel_project
    ON schedule_relationships(project_id);

CREATE INDEX IF NOT EXISTS idx_sched_rel_successor
    ON schedule_relationships(successor_activity_id);
CREATE OR REPLACE FUNCTION guard_drawing_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'for_review'             AND NEW.status IN ('approved','approved_with_comments','rejected'))
        OR (OLD.status = 'approved_with_comments' AND NEW.status IN ('approved','superseded'))
        OR (OLD.status = 'approved'               AND NEW.status = 'superseded')
        OR (OLD.status = 'rejected'               AND NEW.status = 'for_review')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on drawings %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_drawing_status ON drawings;
CREATE TRIGGER trg_guard_drawing_status
    BEFORE UPDATE ON drawings
    FOR EACH ROW EXECUTE FUNCTION guard_drawing_status();
CREATE OR REPLACE FUNCTION guard_submittal_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'submitted'          AND NEW.status IN ('under_review','rejected','resubmit_required'))
        OR (OLD.status = 'under_review'       AND NEW.status IN ('approved','approved_as_noted','rejected','resubmit_required'))
        OR (OLD.status = 'approved_as_noted'  AND NEW.status = 'approved')
        OR (OLD.status IN ('rejected','resubmit_required') AND NEW.status = 'submitted')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on submittals %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    IF NEW.status IN ('approved','approved_as_noted','rejected','resubmit_required') AND NEW.actual_response_date IS NULL THEN
        NEW.actual_response_date := CURRENT_DATE;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_submittal_status ON submittals;
CREATE TRIGGER trg_guard_submittal_status
    BEFORE UPDATE ON submittals
    FOR EACH ROW EXECUTE FUNCTION guard_submittal_status();
CREATE OR REPLACE FUNCTION guard_rfi_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'open'     AND NEW.status = 'answered')
        OR (OLD.status = 'answered' AND NEW.status = 'closed')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on rfis %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'answered' AND (NEW.response IS NULL OR NEW.response_date IS NULL) THEN
        RAISE EXCEPTION 'RFI % cannot be answered without response and response_date.', OLD.id;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_rfi_status ON rfis;
CREATE TRIGGER trg_guard_rfi_status
    BEFORE UPDATE ON rfis
    FOR EACH ROW EXECUTE FUNCTION guard_rfi_status();
CREATE OR REPLACE FUNCTION guard_method_statement_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'draft'     AND NEW.status = 'submitted')
        OR (OLD.status = 'submitted' AND NEW.status IN ('approved','rejected'))
        OR (OLD.status = 'rejected'  AND NEW.status = 'draft')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on method_statements %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'approved' AND (NEW.approved_by IS NULL OR NEW.approval_date IS NULL) THEN
        RAISE EXCEPTION 'Method statement % cannot be approved without approved_by and approval_date.', OLD.id;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_method_statement_status ON method_statements;
CREATE TRIGGER trg_guard_method_statement_status
    BEFORE UPDATE ON method_statements
    FOR EACH ROW EXECUTE FUNCTION guard_method_statement_status();
CREATE OR REPLACE FUNCTION guard_quantity_sheet_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (OLD.status = 'draft' AND NEW.status = 'verified') THEN
        RAISE EXCEPTION 'Illegal status transition on quantity_sheets %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    IF NEW.checked_by IS NULL THEN
        RAISE EXCEPTION 'quantity_sheets % cannot be verified without checked_by.', OLD.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_quantity_sheet_status ON quantity_sheets;
CREATE TRIGGER trg_guard_quantity_sheet_status
    BEFORE UPDATE ON quantity_sheets
    FOR EACH ROW EXECUTE FUNCTION guard_quantity_sheet_status();
CREATE OR REPLACE FUNCTION guard_site_instruction_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'open'         AND NEW.status = 'acknowledged')
        OR (OLD.status = 'acknowledged' AND NEW.status = 'closed')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on site_instructions %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_site_instruction_status ON site_instructions;
CREATE TRIGGER trg_guard_site_instruction_status
    BEFORE UPDATE ON site_instructions
    FOR EACH ROW EXECUTE FUNCTION guard_site_instruction_status();
CREATE OR REPLACE FUNCTION guard_subcontract_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'draft'  AND NEW.status = 'active')
        OR (OLD.status = 'active' AND NEW.status IN ('completed','terminated'))
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on subcontracts %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_subcontract_status ON subcontracts;
CREATE TRIGGER trg_guard_subcontract_status
    BEFORE UPDATE ON subcontracts
    FOR EACH ROW EXECUTE FUNCTION guard_subcontract_status();
ALTER TABLE subcontract_certificates DROP CONSTRAINT IF EXISTS subcontract_certificates_status_check;
ALTER TABLE subcontract_certificates ADD CONSTRAINT subcontract_certificates_status_check
    CHECK (status IN ('draft','site_verified','qs_certified','approved','rejected','posted','paid'));

ALTER TABLE subcontract_certificates
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS rejected_by BIGINT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

ALTER TABLE subcontract_certificates
    DROP CONSTRAINT IF EXISTS chk_sc_rejection_fields_together;

ALTER TABLE subcontract_certificates
    ADD CONSTRAINT chk_sc_rejection_fields_together
    CHECK (
        (rejection_reason IS NULL AND rejected_by IS NULL AND rejected_at IS NULL)
        OR (rejection_reason IS NOT NULL AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION guard_subcontract_certificate_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
           (OLD.status = 'draft'         AND NEW.status = 'site_verified')
        OR (OLD.status = 'site_verified' AND NEW.status IN ('qs_certified','rejected'))
        OR (OLD.status = 'qs_certified'  AND NEW.status IN ('approved','rejected'))
        OR (OLD.status = 'approved'      AND NEW.status IN ('posted','rejected'))
        OR (OLD.status = 'rejected'      AND NEW.status = 'draft')
        OR (OLD.status = 'posted'        AND NEW.status = 'paid')
    ) THEN
        RAISE EXCEPTION 'Illegal status transition on subcontract_certificates %: % -> %.', OLD.id, OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'rejected' THEN
        IF NEW.rejection_reason IS NULL OR NEW.rejected_by IS NULL OR NEW.rejected_at IS NULL THEN
            RAISE EXCEPTION 'subcontract_certificates % rejection requires rejection_reason, rejected_by, and rejected_at.', OLD.id;
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_subcontract_certificate_status ON subcontract_certificates;
CREATE TRIGGER trg_guard_subcontract_certificate_status
    BEFORE UPDATE ON subcontract_certificates
    FOR EACH ROW EXECUTE FUNCTION guard_subcontract_certificate_status();
ALTER TABLE evm_snapshots
    ADD COLUMN IF NOT EXISTS source_progress_date DATE,
    ADD COLUMN IF NOT EXISTS source_cost_date DATE,
    ADD COLUMN IF NOT EXISTS calculation_notes TEXT;
