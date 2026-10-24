-- Stage 52 / CC-082 / DEC-024 (owner, 2026-10-24; closes F-56): currencies are the official ISO 4217 list, and each
-- company enables the currencies it uses.
-- (transaction managed by migrator)
-- Before (E3 @CC-081): one currency table shared by every company, seeded with EGP only, with no way to add a currency
-- from the application; any company record could name any currency in the table.
-- Now:
--  * the table holds ISO 4217 List One as published on 2024-06-25 (code, name, minor units): every entry with numeric
--    minor units that is not a fund code; precious metals, SDR / bond units, the testing code XTS and XXX (no currency)
--    are not currencies of account and are left out. Source: the agency's list as distributed in the npm package
--    currency-codes 2.2.0 (iso-4217-list-one.xml, sha256 2dea9812978172e5d3aa7b1edc71560b3f3fd465b9edde1acc8f07e765771b8b;
--    identical to the copy in the package repository); the agency's own site could not be reached from the build
--    environment. Amendments after 2024-06-25 need a release (F-58). The table is changed only by a release.
--  * org_currencies: the currencies a company has enabled (who, when; audited). The base currency is always enabled.
--    A record in a currency the company has not enabled is refused, on every table that carries a currency.
--  * a currency with more than 2 decimal places (BHD, IQD, JOD, KWD, LYD, OMR, TND, UYW) cannot be enabled: amounts are
--    kept to 2 decimal places (F-59).
--  * a currency cannot be disabled while the company has records in it; the base currency cannot be disabled.
-- Existing data: every currency a company already uses is enabled for it.
-- Rollback: drop the triggers trg_currency_enabled_*, trg_guard_org_currencies, trg_audit_org_currencies; drop table
-- org_currencies; drop functions currency_enabled, require_enabled_currency, guard_org_currencies; drop the two columns.

ALTER TABLE currencies
  ADD COLUMN IF NOT EXISTS minor_units SMALLINT CHECK (minor_units BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS iso_list_date DATE;

INSERT INTO currencies (code, name, minor_units, iso_list_date) VALUES
  ('AED', 'UAE Dirham', 2, DATE '2024-06-25'),
  ('AFN', 'Afghani', 2, DATE '2024-06-25'),
  ('ALL', 'Lek', 2, DATE '2024-06-25'),
  ('AMD', 'Armenian Dram', 2, DATE '2024-06-25'),
  ('ANG', 'Netherlands Antillean Guilder', 2, DATE '2024-06-25'),
  ('AOA', 'Kwanza', 2, DATE '2024-06-25'),
  ('ARS', 'Argentine Peso', 2, DATE '2024-06-25'),
  ('AUD', 'Australian Dollar', 2, DATE '2024-06-25'),
  ('AWG', 'Aruban Florin', 2, DATE '2024-06-25'),
  ('AZN', 'Azerbaijan Manat', 2, DATE '2024-06-25'),
  ('BAM', 'Convertible Mark', 2, DATE '2024-06-25'),
  ('BBD', 'Barbados Dollar', 2, DATE '2024-06-25'),
  ('BDT', 'Taka', 2, DATE '2024-06-25'),
  ('BGN', 'Bulgarian Lev', 2, DATE '2024-06-25'),
  ('BHD', 'Bahraini Dinar', 3, DATE '2024-06-25'),
  ('BIF', 'Burundi Franc', 0, DATE '2024-06-25'),
  ('BMD', 'Bermudian Dollar', 2, DATE '2024-06-25'),
  ('BND', 'Brunei Dollar', 2, DATE '2024-06-25'),
  ('BOB', 'Boliviano', 2, DATE '2024-06-25'),
  ('BRL', 'Brazilian Real', 2, DATE '2024-06-25'),
  ('BSD', 'Bahamian Dollar', 2, DATE '2024-06-25'),
  ('BTN', 'Ngultrum', 2, DATE '2024-06-25'),
  ('BWP', 'Pula', 2, DATE '2024-06-25'),
  ('BYN', 'Belarusian Ruble', 2, DATE '2024-06-25'),
  ('BZD', 'Belize Dollar', 2, DATE '2024-06-25'),
  ('CAD', 'Canadian Dollar', 2, DATE '2024-06-25'),
  ('CDF', 'Congolese Franc', 2, DATE '2024-06-25'),
  ('CHF', 'Swiss Franc', 2, DATE '2024-06-25'),
  ('CLP', 'Chilean Peso', 0, DATE '2024-06-25'),
  ('CNY', 'Yuan Renminbi', 2, DATE '2024-06-25'),
  ('COP', 'Colombian Peso', 2, DATE '2024-06-25'),
  ('CRC', 'Costa Rican Colon', 2, DATE '2024-06-25'),
  ('CUC', 'Peso Convertible', 2, DATE '2024-06-25'),
  ('CUP', 'Cuban Peso', 2, DATE '2024-06-25'),
  ('CVE', 'Cabo Verde Escudo', 2, DATE '2024-06-25'),
  ('CZK', 'Czech Koruna', 2, DATE '2024-06-25'),
  ('DJF', 'Djibouti Franc', 0, DATE '2024-06-25'),
  ('DKK', 'Danish Krone', 2, DATE '2024-06-25'),
  ('DOP', 'Dominican Peso', 2, DATE '2024-06-25'),
  ('DZD', 'Algerian Dinar', 2, DATE '2024-06-25'),
  ('EGP', 'Egyptian Pound', 2, DATE '2024-06-25'),
  ('ERN', 'Nakfa', 2, DATE '2024-06-25'),
  ('ETB', 'Ethiopian Birr', 2, DATE '2024-06-25'),
  ('EUR', 'Euro', 2, DATE '2024-06-25'),
  ('FJD', 'Fiji Dollar', 2, DATE '2024-06-25'),
  ('FKP', 'Falkland Islands Pound', 2, DATE '2024-06-25'),
  ('GBP', 'Pound Sterling', 2, DATE '2024-06-25'),
  ('GEL', 'Lari', 2, DATE '2024-06-25'),
  ('GHS', 'Ghana Cedi', 2, DATE '2024-06-25'),
  ('GIP', 'Gibraltar Pound', 2, DATE '2024-06-25'),
  ('GMD', 'Dalasi', 2, DATE '2024-06-25'),
  ('GNF', 'Guinean Franc', 0, DATE '2024-06-25'),
  ('GTQ', 'Quetzal', 2, DATE '2024-06-25'),
  ('GYD', 'Guyana Dollar', 2, DATE '2024-06-25'),
  ('HKD', 'Hong Kong Dollar', 2, DATE '2024-06-25'),
  ('HNL', 'Lempira', 2, DATE '2024-06-25'),
  ('HTG', 'Gourde', 2, DATE '2024-06-25'),
  ('HUF', 'Forint', 2, DATE '2024-06-25'),
  ('IDR', 'Rupiah', 2, DATE '2024-06-25'),
  ('ILS', 'New Israeli Sheqel', 2, DATE '2024-06-25'),
  ('INR', 'Indian Rupee', 2, DATE '2024-06-25'),
  ('IQD', 'Iraqi Dinar', 3, DATE '2024-06-25'),
  ('IRR', 'Iranian Rial', 2, DATE '2024-06-25'),
  ('ISK', 'Iceland Krona', 0, DATE '2024-06-25'),
  ('JMD', 'Jamaican Dollar', 2, DATE '2024-06-25'),
  ('JOD', 'Jordanian Dinar', 3, DATE '2024-06-25'),
  ('JPY', 'Yen', 0, DATE '2024-06-25'),
  ('KES', 'Kenyan Shilling', 2, DATE '2024-06-25'),
  ('KGS', 'Som', 2, DATE '2024-06-25'),
  ('KHR', 'Riel', 2, DATE '2024-06-25'),
  ('KMF', 'Comorian Franc', 0, DATE '2024-06-25'),
  ('KPW', 'North Korean Won', 2, DATE '2024-06-25'),
  ('KRW', 'Won', 0, DATE '2024-06-25'),
  ('KWD', 'Kuwaiti Dinar', 3, DATE '2024-06-25'),
  ('KYD', 'Cayman Islands Dollar', 2, DATE '2024-06-25'),
  ('KZT', 'Tenge', 2, DATE '2024-06-25'),
  ('LAK', 'Lao Kip', 2, DATE '2024-06-25'),
  ('LBP', 'Lebanese Pound', 2, DATE '2024-06-25'),
  ('LKR', 'Sri Lanka Rupee', 2, DATE '2024-06-25'),
  ('LRD', 'Liberian Dollar', 2, DATE '2024-06-25'),
  ('LSL', 'Loti', 2, DATE '2024-06-25'),
  ('LYD', 'Libyan Dinar', 3, DATE '2024-06-25'),
  ('MAD', 'Moroccan Dirham', 2, DATE '2024-06-25'),
  ('MDL', 'Moldovan Leu', 2, DATE '2024-06-25'),
  ('MGA', 'Malagasy Ariary', 2, DATE '2024-06-25'),
  ('MKD', 'Denar', 2, DATE '2024-06-25'),
  ('MMK', 'Kyat', 2, DATE '2024-06-25'),
  ('MNT', 'Tugrik', 2, DATE '2024-06-25'),
  ('MOP', 'Pataca', 2, DATE '2024-06-25'),
  ('MRU', 'Ouguiya', 2, DATE '2024-06-25'),
  ('MUR', 'Mauritius Rupee', 2, DATE '2024-06-25'),
  ('MVR', 'Rufiyaa', 2, DATE '2024-06-25'),
  ('MWK', 'Malawi Kwacha', 2, DATE '2024-06-25'),
  ('MXN', 'Mexican Peso', 2, DATE '2024-06-25'),
  ('MYR', 'Malaysian Ringgit', 2, DATE '2024-06-25'),
  ('MZN', 'Mozambique Metical', 2, DATE '2024-06-25'),
  ('NAD', 'Namibia Dollar', 2, DATE '2024-06-25'),
  ('NGN', 'Naira', 2, DATE '2024-06-25'),
  ('NIO', 'Cordoba Oro', 2, DATE '2024-06-25'),
  ('NOK', 'Norwegian Krone', 2, DATE '2024-06-25'),
  ('NPR', 'Nepalese Rupee', 2, DATE '2024-06-25'),
  ('NZD', 'New Zealand Dollar', 2, DATE '2024-06-25'),
  ('OMR', 'Rial Omani', 3, DATE '2024-06-25'),
  ('PAB', 'Balboa', 2, DATE '2024-06-25'),
  ('PEN', 'Sol', 2, DATE '2024-06-25'),
  ('PGK', 'Kina', 2, DATE '2024-06-25'),
  ('PHP', 'Philippine Peso', 2, DATE '2024-06-25'),
  ('PKR', 'Pakistan Rupee', 2, DATE '2024-06-25'),
  ('PLN', 'Zloty', 2, DATE '2024-06-25'),
  ('PYG', 'Guarani', 0, DATE '2024-06-25'),
  ('QAR', 'Qatari Rial', 2, DATE '2024-06-25'),
  ('RON', 'Romanian Leu', 2, DATE '2024-06-25'),
  ('RSD', 'Serbian Dinar', 2, DATE '2024-06-25'),
  ('RUB', 'Russian Ruble', 2, DATE '2024-06-25'),
  ('RWF', 'Rwanda Franc', 0, DATE '2024-06-25'),
  ('SAR', 'Saudi Riyal', 2, DATE '2024-06-25'),
  ('SBD', 'Solomon Islands Dollar', 2, DATE '2024-06-25'),
  ('SCR', 'Seychelles Rupee', 2, DATE '2024-06-25'),
  ('SDG', 'Sudanese Pound', 2, DATE '2024-06-25'),
  ('SEK', 'Swedish Krona', 2, DATE '2024-06-25'),
  ('SGD', 'Singapore Dollar', 2, DATE '2024-06-25'),
  ('SHP', 'Saint Helena Pound', 2, DATE '2024-06-25'),
  ('SLE', 'Leone', 2, DATE '2024-06-25'),
  ('SOS', 'Somali Shilling', 2, DATE '2024-06-25'),
  ('SRD', 'Surinam Dollar', 2, DATE '2024-06-25'),
  ('SSP', 'South Sudanese Pound', 2, DATE '2024-06-25'),
  ('STN', 'Dobra', 2, DATE '2024-06-25'),
  ('SVC', 'El Salvador Colon', 2, DATE '2024-06-25'),
  ('SYP', 'Syrian Pound', 2, DATE '2024-06-25'),
  ('SZL', 'Lilangeni', 2, DATE '2024-06-25'),
  ('THB', 'Baht', 2, DATE '2024-06-25'),
  ('TJS', 'Somoni', 2, DATE '2024-06-25'),
  ('TMT', 'Turkmenistan New Manat', 2, DATE '2024-06-25'),
  ('TND', 'Tunisian Dinar', 3, DATE '2024-06-25'),
  ('TOP', 'Pa’anga', 2, DATE '2024-06-25'),
  ('TRY', 'Turkish Lira', 2, DATE '2024-06-25'),
  ('TTD', 'Trinidad and Tobago Dollar', 2, DATE '2024-06-25'),
  ('TWD', 'New Taiwan Dollar', 2, DATE '2024-06-25'),
  ('TZS', 'Tanzanian Shilling', 2, DATE '2024-06-25'),
  ('UAH', 'Hryvnia', 2, DATE '2024-06-25'),
  ('UGX', 'Uganda Shilling', 0, DATE '2024-06-25'),
  ('USD', 'US Dollar', 2, DATE '2024-06-25'),
  ('UYU', 'Peso Uruguayo', 2, DATE '2024-06-25'),
  ('UYW', 'Unidad Previsional', 4, DATE '2024-06-25'),
  ('UZS', 'Uzbekistan Sum', 2, DATE '2024-06-25'),
  ('VED', 'Bolívar Soberano', 2, DATE '2024-06-25'),
  ('VES', 'Bolívar Soberano', 2, DATE '2024-06-25'),
  ('VND', 'Dong', 0, DATE '2024-06-25'),
  ('VUV', 'Vatu', 0, DATE '2024-06-25'),
  ('WST', 'Tala', 2, DATE '2024-06-25'),
  ('XAF', 'CFA Franc BEAC', 0, DATE '2024-06-25'),
  ('XCD', 'East Caribbean Dollar', 2, DATE '2024-06-25'),
  ('XOF', 'CFA Franc BCEAO', 0, DATE '2024-06-25'),
  ('XPF', 'CFP Franc', 0, DATE '2024-06-25'),
  ('YER', 'Yemeni Rial', 2, DATE '2024-06-25'),
  ('ZAR', 'Rand', 2, DATE '2024-06-25'),
  ('ZMW', 'Zambian Kwacha', 2, DATE '2024-06-25'),
  ('ZWG', 'Zimbabwe Gold', 2, DATE '2024-06-25')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, minor_units = EXCLUDED.minor_units, iso_list_date = EXCLUDED.iso_list_date, updated_at = now();

CREATE TABLE IF NOT EXISTS org_currencies (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  currency_id BIGINT NOT NULL REFERENCES currencies(id),
  enabled_by BIGINT REFERENCES users(id),
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, currency_id)
);
ALTER TABLE org_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_currencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON org_currencies;
DROP POLICY IF EXISTS tenant_isolation_write ON org_currencies;
CREATE POLICY tenant_isolation_select ON org_currencies FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON org_currencies FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
DROP TRIGGER IF EXISTS trg_audit_org_currencies ON org_currencies;
CREATE TRIGGER trg_audit_org_currencies AFTER INSERT OR UPDATE OR DELETE ON org_currencies FOR EACH ROW EXECUTE FUNCTION write_audit_log_row();

-- Tables whose rows name a currency for a company (the enablement applies to all of them).
CREATE OR REPLACE FUNCTION org_currency_tables() RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT c.table_name::text FROM information_schema.columns c
    JOIN information_schema.columns o ON o.table_schema = c.table_schema AND o.table_name = c.table_name AND o.column_name = 'org_id'
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.column_name = 'currency_id' AND c.table_name <> 'org_currencies' ORDER BY 1 $$;

-- Read with the owner's rights so the answer does not depend on the session's tenant context (the organisation is
-- given explicitly).
CREATE OR REPLACE FUNCTION currency_enabled(p_org bigint, p_currency bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM organizations WHERE id = p_org AND base_currency_id = p_currency)
      OR EXISTS (SELECT 1 FROM org_currencies WHERE org_id = p_org AND currency_id = p_currency) $$;

CREATE OR REPLACE FUNCTION require_enabled_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency_id IS NOT NULL AND NEW.org_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.currency_id IS DISTINCT FROM OLD.currency_id)
     AND NOT currency_enabled(NEW.org_id, NEW.currency_id) THEN
    RAISE EXCEPTION 'Currency % is not enabled for this company - enable it in the exchange settings first',
      (SELECT code FROM currencies WHERE id = NEW.currency_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_org_currencies() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; n bigint; code text; mu smallint;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'An enabled currency is not changed; disable it and enable another'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT c.code, c.minor_units INTO code, mu FROM currencies c WHERE c.id = NEW.currency_id AND c.is_active;
    IF code IS NULL THEN RAISE EXCEPTION 'Currency not found'; END IF;
    IF mu > 2 THEN
      RAISE EXCEPTION 'Currency % has % decimal places; amounts are kept to 2 decimal places, so it cannot be enabled yet', code, mu;
    END IF;
    RETURN NEW;
  END IF;
  SELECT c.code INTO code FROM currencies c WHERE c.id = OLD.currency_id;
  IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id AND base_currency_id = OLD.currency_id) THEN
    RAISE EXCEPTION 'The base currency % cannot be disabled', code;
  END IF;
  FOR t IN SELECT * FROM org_currency_tables() LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_id = $1 AND currency_id = $2', t) INTO n USING OLD.org_id, OLD.currency_id;
    IF n > 0 THEN RAISE EXCEPTION 'Currency % is used by records of this company (%) and cannot be disabled', code, t; END IF;
  END LOOP;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_guard_org_currencies ON org_currencies;
CREATE TRIGGER trg_guard_org_currencies BEFORE INSERT OR UPDATE OR DELETE ON org_currencies FOR EACH ROW EXECUTE FUNCTION guard_org_currencies();

-- Existing data first (the base currencies and every currency in use), then the rule on every currency-bearing table.
INSERT INTO org_currencies (org_id, currency_id) SELECT id, base_currency_id FROM organizations WHERE base_currency_id IS NOT NULL ON CONFLICT DO NOTHING;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT * FROM org_currency_tables() LOOP
    EXECUTE format('INSERT INTO org_currencies (org_id, currency_id) SELECT DISTINCT x.org_id, x.currency_id FROM %I x
      JOIN currencies c ON c.id = x.currency_id WHERE x.org_id IS NOT NULL AND coalesce(c.minor_units, 2) <= 2 ON CONFLICT DO NOTHING', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_currency_enabled ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_currency_enabled BEFORE INSERT OR UPDATE OF currency_id ON %I FOR EACH ROW EXECUTE FUNCTION require_enabled_currency()', t);
  END LOOP;
END $$;
