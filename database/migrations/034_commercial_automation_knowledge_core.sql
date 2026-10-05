BEGIN;

-- Commercial SaaS productization core
CREATE TABLE IF NOT EXISTS feature_catalog (
  id BIGSERIAL PRIMARY KEY,
  feature_key VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  module VARCHAR(120) NOT NULL,
  description TEXT,
  meter_key VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id BIGSERIAL PRIMARY KEY,
  plan_key VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','annual','custom')),
  base_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  seat_limit INTEGER,
  project_limit INTEGER,
  storage_gb_limit NUMERIC(18,4),
  ai_credit_limit NUMERIC(18,4),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_id BIGINT NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_id BIGINT NOT NULL REFERENCES feature_catalog(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quota NUMERIC(20,6),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(plan_id, feature_id)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  plan_id BIGINT NOT NULL REFERENCES subscription_plans(id),
  status VARCHAR(30) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','suspended','cancelled','expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  billing_customer_ref TEXT,
  billing_subscription_ref TEXT,
  seats_purchased INTEGER,
  override_entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_subscription_live
ON tenant_subscriptions(org_id)
WHERE status IN ('trial','active','past_due','suspended');

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT REFERENCES projects(id),
  meter_key VARCHAR(120) NOT NULL,
  quantity NUMERIC(20,6) NOT NULL DEFAULT 1,
  unit VARCHAR(40) NOT NULL DEFAULT 'count',
  source_type VARCHAR(80),
  source_id TEXT,
  idempotency_key VARCHAR(180),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS customer_onboarding (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  stage VARCHAR(40) NOT NULL DEFAULT 'discovery' CHECK (stage IN ('discovery','configuration','migration','integration','training','uat','go_live','completed','blocked')),
  owner_user_id BIGINT REFERENCES users(id),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  migration_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  integration_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  training_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  go_live_target DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Integration and automation runtime
CREATE TABLE IF NOT EXISTS integration_connections (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  connection_key VARCHAR(120) NOT NULL,
  provider VARCHAR(120) NOT NULL,
  connection_type VARCHAR(60) NOT NULL CHECK (connection_type IN ('api','oauth','webhook','mcp','database','email','storage','messaging','other')),
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','degraded','disabled','revoked')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref TEXT,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_health_at TIMESTAMPTZ,
  last_health_status VARCHAR(30),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, connection_key)
);

CREATE TABLE IF NOT EXISTS automation_workflows (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  workflow_key VARCHAR(120) NOT NULL,
  name VARCHAR(180) NOT NULL,
  engine VARCHAR(40) NOT NULL DEFAULT 'internal' CHECK (engine IN ('internal','n8n','external')),
  trigger_type VARCHAR(60) NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','retired')),
  approval_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  concurrency_limit INTEGER NOT NULL DEFAULT 1 CHECK (concurrency_limit BETWEEN 1 AND 1000),
  idempotency_required BOOLEAN NOT NULL DEFAULT TRUE,
  timeout_seconds INTEGER NOT NULL DEFAULT 300 CHECK (timeout_seconds BETWEEN 1 AND 86400),
  owner_user_id BIGINT REFERENCES users(id),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, workflow_key, version)
);

CREATE TABLE IF NOT EXISTS automation_executions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  workflow_id BIGINT NOT NULL REFERENCES automation_workflows(id),
  project_id BIGINT REFERENCES projects(id),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(180),
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled','dead_letter')),
  trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB,
  step_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(100),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, correlation_id),
  UNIQUE(org_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  name VARCHAR(160) NOT NULL,
  event_key VARCHAR(120) NOT NULL,
  target_url TEXT NOT NULL,
  secret_ref TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Knowledge/RAG governance core
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT REFERENCES projects(id),
  source_key VARCHAR(160) NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_type VARCHAR(60) NOT NULL CHECK (source_type IN ('contract','specification','drawing','boq','procedure','policy','code','standard','manual','correspondence','report','lesson_learned','other')),
  authority_level INTEGER NOT NULL DEFAULT 50 CHECK (authority_level BETWEEN 1 AND 100),
  jurisdiction VARCHAR(120),
  discipline VARCHAR(120),
  revision VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','current','superseded','void','archived')),
  effective_date DATE,
  superseded_by_id BIGINT REFERENCES knowledge_sources(id),
  content_ref TEXT,
  checksum VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, source_key, revision)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  source_id BIGINT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  chunk_key VARCHAR(180) NOT NULL,
  section_ref VARCHAR(255),
  content_text TEXT NOT NULL,
  token_count INTEGER,
  embedding_provider VARCHAR(80),
  embedding_model VARCHAR(120),
  embedding_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, chunk_key)
);

CREATE TABLE IF NOT EXISTS knowledge_queries (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT REFERENCES projects(id),
  requested_by BIGINT REFERENCES users(id),
  query_text TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  retrieved_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_text TEXT,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_key VARCHAR(160),
  grounded BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Multi-agent orchestration traceability
CREATE TABLE IF NOT EXISTS ai_run_steps (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  run_id BIGINT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  agent_id BIGINT REFERENCES ai_agents(id),
  step_type VARCHAR(50) NOT NULL CHECK (step_type IN ('plan','retrieve','tool','handoff','validate','approval','compose','finalize','error')),
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','skipped','blocked')),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB,
  tool_id BIGINT REFERENCES ai_tools(id),
  handoff_to_agent_id BIGINT REFERENCES ai_agents(id),
  validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, step_no)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_subscriptions','usage_events','customer_onboarding','integration_connections',
    'automation_workflows','automation_executions','webhook_subscriptions','knowledge_sources',
    'knowledge_chunks','knowledge_queries','ai_run_steps'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT NULLIF(current_setting(''app.org_id'',true),'''')::bigint', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(org_id)', 'idx_'||t||'_org', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON %I FOR ALL USING (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint) WITH CHECK (org_id=NULLIF(current_setting(''app.org_id'',true),'''')::bigint)', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_events_meter ON usage_events(org_id,meter_key,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_exec_status ON automation_executions(org_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_lookup ON knowledge_sources(org_id,project_id,source_type,status,discipline);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(org_id,source_id);
CREATE INDEX IF NOT EXISTS idx_ai_run_steps_run ON ai_run_steps(org_id,run_id,step_no);

INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'commercial_platform','view','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='commercial_platform' AND p.action='view');
INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'commercial_platform','manage','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='commercial_platform' AND p.action='manage');
INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'automation','view','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='automation' AND p.action='view');
INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'automation','manage','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='automation' AND p.action='manage');
INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'knowledge','view','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='knowledge' AND p.action='view');
INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'knowledge','manage','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='knowledge' AND p.action='manage');

COMMIT;
