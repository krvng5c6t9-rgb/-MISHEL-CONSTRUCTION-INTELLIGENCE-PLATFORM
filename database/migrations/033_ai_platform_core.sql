BEGIN;

-- AI Platform Core: tenant-scoped registries and runtime evidence.
CREATE TABLE IF NOT EXISTS ai_models (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  provider VARCHAR(80) NOT NULL,
  model_key VARCHAR(160) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  use_case TEXT,
  data_class VARCHAR(40),
  cost_class VARCHAR(40),
  fallback_model_id BIGINT REFERENCES ai_models(id),
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','suspended','deprecated','retired')),
  deprecation_review_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, provider, model_key)
);

CREATE TABLE IF NOT EXISTS ai_tools (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  tool_key VARCHAR(120) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  risk_class VARCHAR(4) NOT NULL DEFAULT 'R1' CHECK (risk_class IN ('R0','R1','R2','R3','R4','R5')),
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  auth_type VARCHAR(50),
  permission_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 100 AND 600000),
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  side_effects TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, tool_key)
);

CREATE TABLE IF NOT EXISTS ai_prompts (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  prompt_key VARCHAR(120) NOT NULL,
  version VARCHAR(40) NOT NULL,
  purpose TEXT,
  system_prompt TEXT NOT NULL,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  prohibited_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','superseded','retired')),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, prompt_key, version)
);

CREATE TABLE IF NOT EXISTS ai_agents (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  agent_key VARCHAR(120) NOT NULL,
  name VARCHAR(160) NOT NULL,
  purpose TEXT NOT NULL,
  owner_user_id BIGINT REFERENCES users(id),
  model_id BIGINT REFERENCES ai_models(id),
  prompt_id BIGINT REFERENCES ai_prompts(id),
  risk_level VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  memory_mode VARCHAR(30) NOT NULL DEFAULT 'task' CHECK (memory_mode IN ('none','conversation','task','business','hybrid')),
  write_access BOOLEAN NOT NULL DEFAULT FALSE,
  human_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  max_steps INTEGER NOT NULL DEFAULT 12 CHECK (max_steps BETWEEN 1 AND 200),
  timeout_seconds INTEGER NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 5 AND 3600),
  cost_limit NUMERIC(18,6),
  fallback_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','suspended','retired')),
  last_evaluation_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, agent_key)
);

CREATE TABLE IF NOT EXISTS ai_agent_tools (
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  agent_id BIGINT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES ai_tools(id) ON DELETE CASCADE,
  can_read BOOLEAN NOT NULL DEFAULT TRUE,
  can_write BOOLEAN NOT NULL DEFAULT FALSE,
  can_execute_external BOOLEAN NOT NULL DEFAULT FALSE,
  approval_override BOOLEAN,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(agent_id, tool_id)
);

CREATE TABLE IF NOT EXISTS ai_workflows (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  workflow_key VARCHAR(120) NOT NULL,
  name VARCHAR(160) NOT NULL,
  trigger_type VARCHAR(40) NOT NULL DEFAULT 'manual',
  orchestrator_agent_id BIGINT REFERENCES ai_agents(id),
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_required BOOLEAN NOT NULL DEFAULT TRUE,
  human_approval_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, workflow_key, version)
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  project_id BIGINT REFERENCES projects(id),
  workflow_id BIGINT REFERENCES ai_workflows(id),
  agent_id BIGINT REFERENCES ai_agents(id),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  requested_by BIGINT REFERENCES users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled','blocked')),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_version VARCHAR(80),
  model_key VARCHAR(160),
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  latency_ms BIGINT,
  error_code VARCHAR(80),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, correlation_id)
);

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  agent_id BIGINT REFERENCES ai_agents(id),
  model_id BIGINT REFERENCES ai_models(id),
  prompt_id BIGINT REFERENCES ai_prompts(id),
  evaluation_name VARCHAR(160) NOT NULL,
  dataset_ref TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  pass_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  passed BOOLEAN,
  failure_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by BIGINT REFERENCES users(id),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_models','ai_tools','ai_prompts','ai_agents','ai_agent_tools','ai_workflows','ai_runs','ai_evaluations'] LOOP
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

CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(org_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_project ON ai_runs(org_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_eval_agent ON ai_evaluations(org_id,agent_id,evaluated_at DESC);

INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'ai_platform','view','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='ai_platform' AND p.action='view');

INSERT INTO permissions(role_id,org_id,module,action,scope)
SELECT r.id,r.org_id,'ai_platform','manage','all' FROM roles r
WHERE r.is_system_role=true
AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.role_id=r.id AND p.module='ai_platform' AND p.action='manage');

COMMIT;
