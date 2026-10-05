-- REV13 — Technical Office workflow, maker/checker and cross-tenant reference hardening.

ALTER TABLE drawings ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id);
ALTER TABLE drawings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS responded_by BIGINT REFERENCES users(id);
ALTER TABLE method_statements ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
ALTER TABLE method_statements ADD COLUMN IF NOT EXISTS submitted_by BIGINT REFERENCES users(id);
ALTER TABLE method_statements ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION guard_technical_office_workflow() RETURNS TRIGGER AS $$
DECLARE
  project_org BIGINT;
  ref_org BIGINT;
BEGIN
  SELECT org_id INTO project_org FROM projects WHERE id = NEW.project_id;
  IF project_org IS NULL THEN
    RAISE EXCEPTION 'Technical Office record requires a valid project';
  END IF;
  IF NEW.org_id IS NULL THEN NEW.org_id := project_org; END IF;
  IF NEW.org_id <> project_org THEN
    RAISE EXCEPTION 'Technical Office tenant mismatch';
  END IF;

  IF NEW.document_id IS NOT NULL THEN
    SELECT org_id INTO ref_org FROM documents WHERE id=NEW.document_id;
    IF ref_org IS NULL OR ref_org <> project_org THEN
      RAISE EXCEPTION 'Referenced document must belong to the same organization';
    END IF;
  END IF;

  IF TG_TABLE_NAME='drawings' THEN
    SELECT org_id INTO ref_org FROM users WHERE id=NEW.issued_by;
    IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Drawing issuer must belong to the same organization'; END IF;
    IF NEW.reviewed_by IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.reviewed_by;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Drawing reviewer must belong to the same organization'; END IF;
      IF NEW.reviewed_by=NEW.issued_by THEN RAISE EXCEPTION 'Segregation of duties: drawing issuer cannot review own drawing'; END IF;
    END IF;
    IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status='for_review' AND NEW.status IN ('approved','approved_with_comments','rejected')) OR
        (OLD.status IN ('approved','approved_with_comments') AND NEW.status='superseded') OR
        (OLD.status='rejected' AND NEW.status='for_review')
      ) THEN RAISE EXCEPTION 'Invalid drawing status transition % -> %', OLD.status, NEW.status; END IF;
      IF NEW.status IN ('approved','approved_with_comments','rejected') AND NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'Drawing review decision requires reviewed_by';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME='submittals' THEN
    SELECT org_id INTO ref_org FROM users WHERE id=NEW.submitted_by;
    IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Submittal submitter must belong to the same organization'; END IF;
    IF NEW.reviewer_id IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.reviewer_id;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Submittal reviewer must belong to the same organization'; END IF;
      IF NEW.reviewer_id=NEW.submitted_by THEN RAISE EXCEPTION 'Segregation of duties: submitter cannot review own submittal'; END IF;
    END IF;
    IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status='submitted' AND NEW.status='under_review') OR
        (OLD.status='under_review' AND NEW.status IN ('approved','approved_as_noted','rejected','resubmit_required')) OR
        (OLD.status IN ('rejected','resubmit_required') AND NEW.status='submitted')
      ) THEN RAISE EXCEPTION 'Invalid submittal status transition % -> %', OLD.status, NEW.status; END IF;
      IF NEW.status IN ('under_review','approved','approved_as_noted','rejected','resubmit_required') AND NEW.reviewer_id IS NULL THEN
        RAISE EXCEPTION 'Submittal review requires reviewer_id';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME='rfis' THEN
    SELECT org_id INTO ref_org FROM users WHERE id=NEW.raised_by;
    IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'RFI raiser must belong to the same organization'; END IF;
    IF NEW.assigned_to IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.assigned_to;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'RFI assignee must belong to the same organization'; END IF;
    END IF;
    IF NEW.responded_by IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.responded_by;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'RFI responder must belong to the same organization'; END IF;
      IF NEW.responded_by=NEW.raised_by THEN RAISE EXCEPTION 'Segregation of duties: RFI raiser cannot answer own RFI'; END IF;
    END IF;
    IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT ((OLD.status='open' AND NEW.status='answered') OR (OLD.status='answered' AND NEW.status='closed')) THEN
        RAISE EXCEPTION 'Invalid RFI status transition % -> %', OLD.status, NEW.status;
      END IF;
      IF NEW.status IN ('answered','closed') AND NEW.responded_by IS NULL THEN RAISE EXCEPTION 'RFI response requires responded_by'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME='method_statements' THEN
    IF TG_OP='INSERT' AND NEW.created_by IS NULL THEN RAISE EXCEPTION 'Method statement requires created_by'; END IF;
    IF NEW.created_by IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.created_by;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Method statement creator must belong to the same organization'; END IF;
    END IF;
    IF NEW.submitted_by IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.submitted_by;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Method statement submitter must belong to the same organization'; END IF;
    END IF;
    IF NEW.approved_by IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM users WHERE id=NEW.approved_by;
      IF ref_org IS NULL OR ref_org <> project_org THEN RAISE EXCEPTION 'Method statement reviewer must belong to the same organization'; END IF;
      IF NEW.approved_by=NEW.created_by OR NEW.approved_by=NEW.submitted_by THEN
        RAISE EXCEPTION 'Segregation of duties: method statement maker/submitter cannot approve own statement';
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status IN ('draft','rejected') AND NEW.status='submitted') OR
        (OLD.status='submitted' AND NEW.status IN ('approved','rejected'))
      ) THEN RAISE EXCEPTION 'Invalid method statement status transition % -> %', OLD.status, NEW.status; END IF;
      IF NEW.status IN ('approved','rejected') AND NEW.approved_by IS NULL THEN RAISE EXCEPTION 'Method statement review requires approved_by'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['drawings','submittals','rfis','method_statements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_trg_technical_office_workflow ON %I', t);
    EXECUTE format('CREATE TRIGGER zz_trg_technical_office_workflow BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_technical_office_workflow()', t);
  END LOOP;
END $$;
