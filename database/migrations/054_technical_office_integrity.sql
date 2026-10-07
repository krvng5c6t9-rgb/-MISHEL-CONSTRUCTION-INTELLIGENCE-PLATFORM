-- CC-031 (RK-003 / GC-03..05): Technical Office integrity - first runtime execution (sweep_technical_office.mjs).
-- TO1 every drawing review decision failed (42P08 -> HTTP 500; fixed in the route); the same untyped pattern was in
--     the submittal review route.
-- TO2 review decisions (reject / with comments / as noted / resubmit) carried no comment.
-- TO3 approving a new drawing revision left the earlier approved revision "approved" (two current revisions).
-- TO4 a submittal resubmission erased the previous review (reviewer, date, decision) - no review history or cycle.
-- TO5 RFIs had no response due date / overdue view; answers editable after being given; impact-flagged RFIs could be
--     closed without a link to a contract event or a stated no-impact reason (NDC-002); closer not recorded.
-- TO6 reviewed drawings and approved method statements editable in place.
-- TO0 RFI creation always failed (42703: shared guard read NEW.document_id, which rfis does not have) -> RFIs could never be raised.
-- (transaction managed by migrator)

CREATE OR REPLACE FUNCTION guard_technical_office_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

  -- CC-031: rfis has no document_id; the field may only be read for tables that have it (PL/pgSQL resolves at run time).
  IF TG_TABLE_NAME <> 'rfis' THEN
    IF NEW.document_id IS NOT NULL THEN
      SELECT org_id INTO ref_org FROM documents WHERE id=NEW.document_id;
      IF ref_org IS NULL OR ref_org <> project_org THEN
        RAISE EXCEPTION 'Referenced document must belong to the same organization';
      END IF;
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
$function$;


ALTER TABLE drawings ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE submittals ADD COLUMN IF NOT EXISTS cycle INT NOT NULL DEFAULT 1;
ALTER TABLE submittals ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE submittals DROP CONSTRAINT IF EXISTS chk_submittal_due_after_submission;
ALTER TABLE submittals ADD CONSTRAINT chk_submittal_due_after_submission CHECK (due_date IS NULL OR submitted_date IS NULL OR due_date >= submitted_date) NOT VALID;
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS response_due DATE;
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS closed_by BIGINT REFERENCES users(id);
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE rfis ADD COLUMN IF NOT EXISTS no_impact_reason TEXT;
ALTER TABLE method_statements ADD COLUMN IF NOT EXISTS review_comment TEXT;

CREATE TABLE IF NOT EXISTS submittal_reviews (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  submittal_id BIGINT NOT NULL REFERENCES submittals(id),
  cycle INT NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved','approved_as_noted','rejected','resubmit_required')),
  comment TEXT,
  reviewer_id BIGINT NOT NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submittal_id, cycle)
);
CREATE OR REPLACE FUNCTION guard_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_submittal_reviews_append_only ON submittal_reviews;
CREATE TRIGGER trg_submittal_reviews_append_only BEFORE UPDATE OR DELETE ON submittal_reviews FOR EACH ROW EXECUTE FUNCTION guard_append_only();
ALTER TABLE submittal_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE submittal_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON submittal_reviews;
DROP POLICY IF EXISTS tenant_isolation_write ON submittal_reviews;
CREATE POLICY tenant_isolation_select ON submittal_reviews FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON submittal_reviews FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);

CREATE OR REPLACE FUNCTION guard_technical_office_integrity() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'drawings' THEN
    IF NEW.status IN ('rejected','approved_with_comments') AND NEW.status IS DISTINCT FROM OLD.status AND length(trim(coalesce(NEW.review_comment,''))) < 5 THEN
      RAISE EXCEPTION 'Drawing decision % needs review comments', NEW.status;
    END IF;
    IF OLD.status IN ('approved','approved_with_comments','superseded') AND (NEW.project_id, NEW.drawing_no, NEW.title, NEW.discipline, NEW.revision, NEW.document_id, NEW.issued_by, NEW.reviewed_by, NEW.reviewed_at, NEW.review_comment)
         IS DISTINCT FROM (OLD.project_id, OLD.drawing_no, OLD.title, OLD.discipline, OLD.revision, OLD.document_id, OLD.issued_by, OLD.reviewed_by, OLD.reviewed_at, OLD.review_comment) THEN
      RAISE EXCEPTION 'Reviewed drawing % is immutable; issue a new revision', OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'submittals' THEN
    IF NEW.status IN ('rejected','resubmit_required','approved_as_noted') AND NEW.status IS DISTINCT FROM OLD.status AND length(trim(coalesce(NEW.review_comment,''))) < 5 THEN
      RAISE EXCEPTION 'Submittal decision % needs review comments', NEW.status;
    END IF;
    IF OLD.status IN ('rejected','resubmit_required') AND NEW.status = 'submitted' THEN
      NEW.cycle := OLD.cycle + 1; NEW.review_comment := NULL;
    END IF;
    IF OLD.status IN ('approved','approved_as_noted') AND (NEW.description, NEW.type, NEW.document_id, NEW.due_date) IS DISTINCT FROM (OLD.description, OLD.type, OLD.document_id, OLD.due_date) THEN
      RAISE EXCEPTION 'Approved submittal % is immutable', OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'rfis' THEN
    IF OLD.status <> 'open' AND (NEW.question, NEW.subject, NEW.response, NEW.responded_by, NEW.response_date) IS DISTINCT FROM (OLD.question, OLD.subject, OLD.response, OLD.responded_by, OLD.response_date) THEN
      RAISE EXCEPTION 'RFI % question and answer are immutable once answered', OLD.id;
    END IF;
    IF NEW.status = 'closed' AND OLD.status = 'answered' THEN
      IF NEW.closed_by IS NULL THEN RAISE EXCEPTION 'RFI closure requires closed_by'; END IF;
      NEW.closed_at := now();
      IF (NEW.cost_impact_flag OR NEW.time_impact_flag)
         AND NOT EXISTS (SELECT 1 FROM contract_event_links l WHERE l.link_type = 'rfi' AND l.linked_id = NEW.id AND l.org_id = NEW.org_id)
         AND length(trim(coalesce(NEW.no_impact_reason,''))) < 5 THEN
        RAISE EXCEPTION 'RFI % is flagged for cost/time impact: link it to a contract event or state why there is no impact', NEW.id;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'method_statements' THEN
    IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' AND length(trim(coalesce(NEW.review_comment,''))) < 5 THEN
      RAISE EXCEPTION 'Method statement rejection needs review comments';
    END IF;
    IF OLD.status = 'approved' AND (NEW.activity_name, NEW.document_id, NEW.status) IS DISTINCT FROM (OLD.activity_name, OLD.document_id, OLD.status) THEN
      RAISE EXCEPTION 'Approved method statement % is immutable', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['drawings','submittals','rfis','method_statements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_technical_office_integrity ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_technical_office_integrity BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_technical_office_integrity()', t);
  END LOOP;
END $$;

-- One current approved revision per drawing number; review cycles recorded.
CREATE OR REPLACE FUNCTION after_technical_office_decision() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'drawings' AND NEW.status IN ('approved','approved_with_comments') AND OLD.status = 'for_review' THEN
    UPDATE drawings SET status = 'superseded', updated_at = now()
     WHERE project_id = NEW.project_id AND drawing_no = NEW.drawing_no AND id <> NEW.id AND status IN ('approved','approved_with_comments');
  ELSIF TG_TABLE_NAME = 'submittals' AND NEW.status IN ('approved','approved_as_noted','rejected','resubmit_required') AND OLD.status = 'under_review' THEN
    INSERT INTO submittal_reviews(org_id, submittal_id, cycle, decision, comment, reviewer_id) VALUES (NEW.org_id, NEW.id, NEW.cycle, NEW.status, NEW.review_comment, NEW.reviewer_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_drawing_decision ON drawings;
CREATE TRIGGER trg_drawing_decision AFTER UPDATE OF status ON drawings FOR EACH ROW EXECUTE FUNCTION after_technical_office_decision();
DROP TRIGGER IF EXISTS trg_submittal_decision ON submittals;
CREATE TRIGGER trg_submittal_decision AFTER UPDATE OF status ON submittals FOR EACH ROW EXECUTE FUNCTION after_technical_office_decision();
