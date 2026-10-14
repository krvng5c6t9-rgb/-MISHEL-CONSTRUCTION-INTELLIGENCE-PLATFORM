-- Stage 32 / DEC-015 part 1: multi-factor sign-in (TOTP, RFC 6238) mandatory for privileged users.
-- (transaction managed by migrator)
-- Before (E3 @e0de953): password-only sign-in for every user, including system administrators, finance users who
-- post and approve money, and DOA approvers (DEC-015 decided MFA mandatory for them on 2026-10-09).
-- Now:
--  * user_requires_mfa(user): a role holding any admin permission, finance manage / approve / post, or named as
--    approver on an active DOA rule. Computed at every sign-in, so a role change takes effect immediately;
--  * users carry the TOTP secret encrypted by the API (AES-256-GCM, never stored in clear), the enrolment time and
--    the last accepted time step (a code is accepted once - replay refused);
--  * ten one-time recovery codes per enrolment, stored as SHA-256 only, each usable once;
--  * mfa_events: append-only record of enrolment, verification, failure, recovery use and administrator reset.
-- The enforcement switch (MFA_ENFORCEMENT) is refused as 'off' in production by the API.
-- Rollback: DROP TABLE mfa_events, mfa_recovery_codes; DROP FUNCTION user_requires_mfa; drop the users columns.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT users_mfa_enabled_needs_secret CHECK (mfa_enabled_at IS NULL OR mfa_secret_enc IS NOT NULL);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  code_sha256 CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_sha256)
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes(user_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE OR REPLACE FUNCTION guard_mfa_recovery_code() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recovery codes are never deleted; they are used or revoked'; END IF;
  IF (NEW.org_id, NEW.user_id, NEW.code_sha256, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.user_id, OLD.code_sha256, OLD.created_at)
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR (OLD.used_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'A recovery code is used once or revoked once';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mfa_recovery_code ON mfa_recovery_codes;
CREATE TRIGGER trg_mfa_recovery_code BEFORE UPDATE OR DELETE ON mfa_recovery_codes FOR EACH ROW EXECUTE FUNCTION guard_mfa_recovery_code();

CREATE TABLE IF NOT EXISTS mfa_events (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  event VARCHAR(20) NOT NULL CHECK (event IN ('enrolled','verified','failed','recovery_used','reset')),
  actor_id BIGINT REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (event <> 'reset' OR (actor_id IS NOT NULL AND actor_id <> user_id AND length(trim(coalesce(reason,''))) >= 10))
);
CREATE INDEX IF NOT EXISTS idx_mfa_events_user ON mfa_events(user_id, created_at);
CREATE OR REPLACE FUNCTION guard_mfa_events() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'mfa_events is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mfa_events_append_only ON mfa_events;
CREATE TRIGGER trg_mfa_events_append_only BEFORE UPDATE OR DELETE ON mfa_events FOR EACH ROW EXECUTE FUNCTION guard_mfa_events();

-- Privileged = admin permission, finance manage/approve/post, or approver on an active DOA rule (DEC-015).
CREATE OR REPLACE FUNCTION user_requires_mfa(p_user BIGINT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users u JOIN permissions p ON p.role_id = u.role_id
                 WHERE u.id = p_user AND (p.module = 'admin' OR (p.module = 'finance' AND p.action IN ('manage','approve','post'))))
      OR EXISTS (SELECT 1 FROM users u JOIN delegation_of_authority d ON d.approver_role_id = u.role_id AND d.org_id = u.org_id
                 WHERE u.id = p_user AND d.is_active AND d.retired_at IS NULL
                   AND (d.effective_to IS NULL OR d.effective_to >= current_date))
$$ LANGUAGE sql STABLE;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mfa_recovery_codes','mfa_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;
