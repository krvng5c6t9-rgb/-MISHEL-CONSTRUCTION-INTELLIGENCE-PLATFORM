-- Stage 58 / CC-088 / F-64 (MP-03 §1): names of a currency and its sub-unit for amounts in words.
-- (transaction managed by migrator)
-- Before (E3 @CC-087): printed financial documents had no amount in words.
-- Now a company may set, for a currency it uses (its base currency or one it enabled), the names written after the
-- amount in words, in Arabic and English (for example the unit and the sub-unit as the company writes them). Nothing is
-- assumed: without a name the document writes the currency code and the fraction as digits. A currency without minor
-- units takes no sub-unit name. Arabic names must be written in Arabic letters, English names in Latin letters.
-- Rollback: drop table currency_words and function guard_currency_words.

CREATE TABLE IF NOT EXISTS currency_words (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  currency_id BIGINT NOT NULL REFERENCES currencies(id),
  unit_ar VARCHAR(40),
  subunit_ar VARCHAR(40),
  unit_en VARCHAR(40),
  subunit_en VARCHAR(40),
  updated_by BIGINT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, currency_id),
  CHECK (unit_ar IS NULL OR (unit_ar ~ '[؀-ۿ]' AND unit_ar !~ '[A-Za-z]' AND length(btrim(unit_ar)) BETWEEN 1 AND 40)),
  CHECK (subunit_ar IS NULL OR (subunit_ar ~ '[؀-ۿ]' AND subunit_ar !~ '[A-Za-z]' AND length(btrim(subunit_ar)) BETWEEN 1 AND 40)),
  CHECK (unit_en IS NULL OR (unit_en ~ '^[A-Za-z][A-Za-z .''-]*$' AND length(btrim(unit_en)) BETWEEN 1 AND 40)),
  CHECK (subunit_en IS NULL OR (subunit_en ~ '^[A-Za-z][A-Za-z .''-]*$' AND length(btrim(subunit_en)) BETWEEN 1 AND 40))
);
ALTER TABLE currency_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_words FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON currency_words;
DROP POLICY IF EXISTS tenant_isolation_write ON currency_words;
CREATE POLICY tenant_isolation_select ON currency_words FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON currency_words FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_currency_words ON currency_words;
CREATE TRIGGER trg_audit_currency_words AFTER INSERT OR UPDATE OR DELETE ON currency_words FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

CREATE OR REPLACE FUNCTION guard_currency_words() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.org_id AND o.base_currency_id = NEW.currency_id)
     AND NOT EXISTS (SELECT 1 FROM org_currencies oc WHERE oc.org_id = NEW.org_id AND oc.currency_id = NEW.currency_id) THEN
    RAISE EXCEPTION 'Words can be set only for a currency the company uses';
  END IF;
  IF (NEW.subunit_ar IS NOT NULL OR NEW.subunit_en IS NOT NULL) AND (SELECT minor_units FROM currencies WHERE id = NEW.currency_id) = 0 THEN
    RAISE EXCEPTION 'This currency has no sub-unit';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_currency_words ON currency_words;
CREATE TRIGGER trg_guard_currency_words BEFORE INSERT OR UPDATE ON currency_words FOR EACH ROW EXECUTE FUNCTION guard_currency_words();
