-- NEXORA ONE Round 2 V3: original inherited security restored; native PostgreSQL runtime formally deferred to Build Phase.
-- Fresh disposable database only. Market remains fail-closed. R23 delta integrated.
BEGIN;
CREATE ROLE nx_design_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE nx_design_client NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE nx_queue_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA nx_auth AUTHORIZATION nx_design_owner;
CREATE SCHEMA nx_design AUTHORIZATION nx_design_owner;
CREATE SCHEMA nx_market;
CREATE SCHEMA nx_crypto AUTHORIZATION nx_design_owner;
CREATE EXTENSION pgcrypto WITH SCHEMA nx_crypto;
REVOKE ALL ON SCHEMA nx_crypto,nx_market FROM PUBLIC;
CREATE SCHEMA nx_org AUTHORIZATION nx_design_owner;
CREATE TABLE nx_design.project_scope (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,project_id)
);
CREATE TABLE nx_design.actor (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,project_id,actor_id)
);
CREATE TABLE nx_design.artifact (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK(size_bytes>=0),
  PRIMARY KEY(tenant_id,project_id,artifact_id)
);
CREATE TABLE nx_design.model (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  model_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,project_id,model_id)
);
CREATE TABLE nx_design.quantity_rule (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  rule_name text NOT NULL CHECK(length(rule_name)>0),
  PRIMARY KEY(tenant_id,project_id,rule_version_id)
);
CREATE TABLE nx_design.catalog_item (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  catalog_item_id uuid NOT NULL,
  source_artifact_id uuid NOT NULL,
  sku text NOT NULL,
  PRIMARY KEY(tenant_id,project_id,catalog_item_id)
);
CREATE TABLE nx_design.operation_result (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation_id text NOT NULL,
  idem_key text NOT NULL CHECK(length(idem_key) BETWEEN 16 AND 128),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_design.operation_result:tenant_id,project_id,actor_id,operation_id,idem_key|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(project_id::text)::text || ':' || project_id::text || '|' || length(actor_id::text)::text || ':' || actor_id::text || '|' || length(operation_id::text)::text || ':' || operation_id::text || '|' || length(idem_key::text)::text || ':' || idem_key::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(tenant_id,project_id,actor_id,operation_id,idem_key)
);
CREATE TABLE nx_design.revision (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  model_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id,revision_id),
  UNIQUE(tenant_id,project_id,model_id,version)
);
CREATE TABLE nx_design.analysis (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  engine_version text NOT NULL CHECK(length(engine_version)>0),
  configuration_sha256 text NOT NULL CHECK(configuration_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,project_id,revision_id,analysis_id)
);
CREATE TABLE nx_design.bundle (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  bundle_id uuid NOT NULL,
  manifest_artifact_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,project_id,revision_id,bundle_id)
);
CREATE TABLE nx_design.element (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  element_id uuid NOT NULL,
  kind text NOT NULL CHECK(length(kind)>0),
  geometry_sha256 text NOT NULL CHECK(geometry_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,project_id,revision_id,element_id)
);
CREATE TABLE nx_design.exchange (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  exchange_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  engine_version text NOT NULL CHECK(length(engine_version)>0),
  configuration_sha256 text NOT NULL CHECK(configuration_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,project_id,revision_id,exchange_id)
);
CREATE TABLE nx_design.measurement (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  measurement_id uuid NOT NULL,
  length_m numeric(28,10) NOT NULL CHECK(length_m>=0),
  method text NOT NULL CHECK(length(method)>0),
  PRIMARY KEY(tenant_id,project_id,revision_id,measurement_id)
);
CREATE TABLE nx_design.outbox (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id,event_id)
);
CREATE TABLE nx_design.release_approval (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id,revision_id,approver_id)
);
CREATE TABLE nx_design.render (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  render_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  engine_version text NOT NULL CHECK(length(engine_version)>0),
  configuration_sha256 text NOT NULL CHECK(configuration_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,project_id,revision_id,render_id)
);
CREATE TABLE nx_design.sheet (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,project_id,revision_id,sheet_id)
);
CREATE TABLE nx_design.terrain (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  terrain_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  engine_version text NOT NULL CHECK(length(engine_version)>0),
  configuration_sha256 text NOT NULL CHECK(configuration_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,project_id,revision_id,terrain_id)
);
CREATE TABLE nx_design.view_state (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  view_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  camera double precision[] NOT NULL CHECK(cardinality(camera)=16),
  label text NOT NULL,
  visibility text NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','PROJECT')),
  PRIMARY KEY(tenant_id,project_id,revision_id,view_id)
);
CREATE TABLE nx_design.issue (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  element_id uuid NOT NULL,
  view_id uuid NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK(status IN ('OPEN','IN_REVIEW','CLOSED')),
  PRIMARY KEY(tenant_id,project_id,revision_id,issue_id)
);
CREATE TABLE nx_design.quantity (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  element_id uuid NOT NULL,
  quantity_id uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  dimension text NOT NULL CHECK(dimension IN ('COUNT','LENGTH','AREA','VOLUME','MASS')),
  quantity_si numeric(28,10) NOT NULL CHECK(quantity_si>=0),
  PRIMARY KEY(tenant_id,project_id,revision_id,quantity_id)
);
CREATE TABLE nx_design.share_grant (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  bundle_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY(tenant_id,project_id,revision_id,grant_id)
);
CREATE TABLE nx_design.space (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  space_id uuid NOT NULL,
  element_id uuid NOT NULL,
  area_m2 numeric(28,10) NOT NULL CHECK(area_m2>=0),
  PRIMARY KEY(tenant_id,project_id,revision_id,space_id)
);
CREATE TABLE nx_design.view_link (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  element_id uuid NOT NULL,
  link_id uuid NOT NULL,
  transform double precision[] NOT NULL CHECK(cardinality(transform)=16),
  PRIMARY KEY(tenant_id,project_id,revision_id,link_id)
);
CREATE TABLE nx_auth.principal_scope (
  principal_name name NOT NULL,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  can_read boolean NOT NULL,
  can_write boolean NOT NULL,
  can_review boolean NOT NULL,
  can_publish boolean NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_auth.principal_scope:principal_name,tenant_id,project_id|'  || length(principal_name::text)::text || ':' || principal_name::text || '|' || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(project_id::text)::text || ':' || project_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  CHECK(can_read OR NOT (can_write OR can_review OR can_publish)),
  UNIQUE(principal_name,tenant_id,project_id)
);
CREATE TABLE nx_design.revision_seal (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  sealed_by uuid NOT NULL,
  manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,project_id,revision_id)
);
CREATE TABLE nx_design.capability_registry (
  capability_id text NOT NULL,
  contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[0-9a-f]{64}$'),
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_design.capability_registry:capability_id,contract_sha256|'  || length(capability_id::text)::text || ':' || capability_id::text || '|' || length(contract_sha256::text)::text || ':' || contract_sha256::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(capability_id,contract_sha256)
);
CREATE TABLE nx_design.operation_evidence (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  capability_id text NOT NULL,
  contract_sha256 text NOT NULL,
  idem_key text NOT NULL CHECK(length(idem_key) BETWEEN 16 AND 128),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
  result_artifact_id uuid NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_design.operation_evidence:tenant_id,project_id,actor_id,capability_id,idem_key|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(project_id::text)::text || ':' || project_id::text || '|' || length(actor_id::text)::text || ':' || actor_id::text || '|' || length(capability_id::text)::text || ':' || capability_id::text || '|' || length(idem_key::text)::text || ':' || idem_key::text || '|')::uuid) STORED NOT NULL,
  master_fk_uuid_4 uuid GENERATED ALWAYS AS (md5('nx_design.capability_registry:capability_id,contract_sha256|'  || length(capability_id::text)::text || ':' || capability_id::text || '|' || length(contract_sha256::text)::text || ':' || contract_sha256::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(tenant_id,project_id,actor_id,capability_id,idem_key)
);
CREATE TABLE nx_design.event_delivery (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer_name text NOT NULL,
  delivery_state text NOT NULL CHECK(delivery_state IN ('PENDING','LEASED','DONE','DEAD')),
  attempts integer NOT NULL CHECK(attempts>=0),
  lease_until timestamptz,
  lease_token uuid,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_design.event_delivery:tenant_id,project_id,event_id,consumer_name|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(project_id::text)::text || ':' || project_id::text || '|' || length(event_id::text)::text || ':' || event_id::text || '|' || length(consumer_name::text)::text || ':' || consumer_name::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  CHECK((delivery_state='LEASED' AND lease_until IS NOT NULL AND lease_token IS NOT NULL) OR (delivery_state<>'LEASED' AND lease_until IS NULL AND lease_token IS NULL)),
  UNIQUE(tenant_id,project_id,event_id,consumer_name)
);
CREATE TABLE nx_org.org_node (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  parent_id uuid,
  parent_kind text,
  kind text NOT NULL CHECK(kind IN ('HOLDING','REGION','ENTITY','SECTOR','PROGRAM','PROJECT','SITE','PLANT')),
  country text NOT NULL CHECK(length(country)=2),
  currency text NOT NULL CHECK(length(currency)=3),
  language text NOT NULL,
  display_name text NOT NULL,
  master_alt_uuid_10 uuid GENERATED ALWAYS AS (md5('nx_org.org_node:tenant_id,node_id,kind|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|' || length(kind::text)::text || ':' || kind::text || '|')::uuid) STORED NOT NULL,
  master_fk_uuid_1 uuid GENERATED ALWAYS AS (md5('nx_org.org_node:tenant_id,node_id,kind|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(parent_id::text)::text || ':' || parent_id::text || '|' || length(parent_kind::text)::text || ':' || parent_kind::text || '|')::uuid) STORED,
  PRIMARY KEY(tenant_id,node_id),
  UNIQUE(tenant_id,node_id,kind),
  CHECK(parent_id IS NULL OR parent_id<>node_id),
  CHECK((kind='HOLDING' AND parent_id IS NULL AND parent_kind IS NULL) OR (parent_id IS NOT NULL AND parent_kind IS NOT NULL AND ((kind='REGION' AND parent_kind='HOLDING') OR (kind='ENTITY' AND parent_kind IN ('HOLDING','REGION')) OR (kind='SECTOR' AND parent_kind='ENTITY') OR (kind='PROGRAM' AND parent_kind='SECTOR') OR (kind='PROJECT' AND parent_kind IN ('PROGRAM','SECTOR')) OR (kind='SITE' AND parent_kind='PROJECT') OR (kind='PLANT' AND parent_kind IN ('PROJECT','SECTOR'))))),
  UNIQUE(master_alt_uuid_10)
);
CREATE TABLE nx_org.role_catalog (
  role_id text NOT NULL,
  division integer NOT NULL CHECK(division BETWEEN 1 AND 14),
  role_title text NOT NULL,
  agent_id text NOT NULL,
  authority text NOT NULL CHECK(authority IN ('RESERVED','REVIEW','DELEGATED','DRAFT')),
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.role_catalog:role_id|'  || length(role_id::text)::text || ':' || role_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(role_id)
);
CREATE TABLE nx_org.node_membership (
  principal_name name NOT NULL,
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  can_read boolean NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.node_membership:principal_name,tenant_id,node_id|'  || length(principal_name::text)::text || ':' || principal_name::text || '|' || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(principal_name,tenant_id,node_id)
);
CREATE TABLE nx_org.role_assignment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  principal_name name NOT NULL,
  role_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  master_fk_uuid_2 uuid GENERATED ALWAYS AS (md5('nx_org.role_catalog:role_id|'  || length(role_id::text)::text || ':' || role_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(tenant_id,node_id,assignment_id),
  CHECK(valid_until>valid_from)
);
CREATE TABLE nx_org.doa_rule (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  role_id text NOT NULL,
  decision_kind text NOT NULL,
  currency text NOT NULL CHECK(length(currency)=3),
  maximum_amount numeric(24,6) NOT NULL CHECK(maximum_amount>=0),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  policy_artifact_sha256 text NOT NULL CHECK(policy_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  master_fk_uuid_2 uuid GENERATED ALWAYS AS (md5('nx_org.role_catalog:role_id|'  || length(role_id::text)::text || ':' || role_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(tenant_id,node_id,rule_id),
  CHECK(valid_until>valid_from)
);
CREATE TABLE nx_org.decision_request (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  requestor name NOT NULL,
  decision_kind text NOT NULL,
  currency text NOT NULL CHECK(length(currency)=3),
  amount numeric(24,6) NOT NULL CHECK(amount>=0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,node_id,decision_id)
);
CREATE TABLE nx_org.decision_review (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  reviewer name NOT NULL,
  review_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  disposition text NOT NULL CHECK(disposition IN ('APPROVE','REJECT')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,decision_id,review_id),
  UNIQUE(tenant_id,node_id,decision_id,reviewer)
);
CREATE TABLE nx_org.project_binding (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  project_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,node_id,project_id)
);
CREATE TABLE nx_org.site_device (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  device_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  registered_principal name NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,project_id,device_id)
);
CREATE TABLE nx_org.sync_event (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  device_id uuid NOT NULL,
  event_id uuid NOT NULL,
  sequence_no bigint NOT NULL CHECK(sequence_no>0),
  base_revision_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('PENDING','ACCEPTED','CONFLICT','REJECTED')),
  PRIMARY KEY(tenant_id,project_id,event_id),
  UNIQUE(tenant_id,project_id,device_id,sequence_no)
);
CREATE TABLE nx_org.role_agent_profile (
  profile_id text NOT NULL,
  role_id text NOT NULL UNIQUE,
  parent_agent_id text NOT NULL CHECK(length(parent_agent_id)>0),
  mission text NOT NULL CHECK(length(mission)>0),
  policy_sha256 text NOT NULL CHECK(policy_sha256 ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT false,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.role_agent_profile:profile_id|'  || length(profile_id::text)::text || ':' || profile_id::text || '|')::uuid) STORED NOT NULL,
  master_fk_uuid_0 uuid GENERATED ALWAYS AS (md5('nx_org.role_catalog:role_id|'  || length(role_id::text)::text || ':' || role_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(profile_id)
);
CREATE TABLE nx_org.governance_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  resolution_ref text NOT NULL,
  meeting_ref text NOT NULL,
  charter_version text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.investment_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  investment_ref text NOT NULL,
  scenario_version text NOT NULL,
  assessment_basis text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.opportunity_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  opportunity_ref text NOT NULL,
  client_ref text NOT NULL,
  qualification_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.estimate_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  estimate_ref text NOT NULL,
  measurement_version text NOT NULL,
  quotation_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.contract_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  contract_ref text NOT NULL,
  clause_ref text NOT NULL,
  notice_or_valuation_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.engineering_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  discipline text NOT NULL,
  design_ref text NOT NULL,
  calculation_or_model_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.technical_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  document_ref text NOT NULL,
  revision_ref text NOT NULL,
  change_or_rfi_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.controls_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  wbs_ref text NOT NULL,
  baseline_ref text NOT NULL,
  data_date date NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.field_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  site_work_ref text NOT NULL,
  inspection_or_diary_ref text NOT NULL,
  observation_date date NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.supply_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  requisition_or_order_ref text NOT NULL,
  supplier_or_lot_ref text NOT NULL,
  document_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.plant_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  asset_or_order_ref text NOT NULL,
  maintenance_or_production_ref text NOT NULL,
  observation_date date NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.finance_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  ledger_or_treasury_ref text NOT NULL,
  fiscal_period text NOT NULL,
  reconciliation_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.workforce_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  protected_worker_ref text NOT NULL,
  pay_or_assignment_period text NOT NULL,
  purpose_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.security_work (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  work_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  work_kind text NOT NULL CHECK(length(work_kind)>0),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  control_or_incident_ref text NOT NULL,
  policy_version text NOT NULL,
  remediation_ref text NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,work_id)
);
CREATE TABLE nx_org.dependency_candidate (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  component_id uuid NOT NULL,
  component_name text NOT NULL,
  component_version text NOT NULL,
  SPDX_expression text NOT NULL,
  source_uri text NOT NULL,
  artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[0-9a-f]{64}$'),
  sbom_sha256 text NOT NULL CHECK(sbom_sha256 ~ '^[0-9a-f]{64}$'),
  distribution_mode text NOT NULL CHECK(distribution_mode IN ('DYNAMIC','STATIC','STANDALONE','DATA_EXCHANGE','NONE')),
  dependency_tree_complete boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,node_id,component_id),
  UNIQUE(tenant_id,node_id,component_name,component_version,artifact_sha256)
);
CREATE TABLE nx_org.dependency_release (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  component_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  decision_rule text NOT NULL CHECK(decision_rule IN ('PERMISSIVE','LGPL21_DYNAMIC','COMMERCIAL_OVERRIDE')),
  legal_evidence_sha256 text NOT NULL CHECK(legal_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by name NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,component_id)
);
CREATE TABLE nx_org.tax_registration (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  jurisdiction text NOT NULL CHECK(length(jurisdiction)>1),
  tax_kind text NOT NULL CHECK(tax_kind IN ('VAT','CORPORATE_TAX','SALES_USE_TAX','WHT','EINVOICE','ERECEIPT')),
  registration_ref text NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,registration_id),
  CHECK(valid_until>valid_from)
);
CREATE TABLE nx_org.tax_pack (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  version_label text NOT NULL,
  legal_source_uri text NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  rule_effective_from date NOT NULL,
  rule_effective_until date NOT NULL,
  state text NOT NULL CHECK(state IN ('DRAFT','APPROVED','RETIRED')),
  approval_decision_id uuid NOT NULL,
  currency text NOT NULL CHECK(length(currency)=3),
  PRIMARY KEY(tenant_id,node_id,pack_id),
  UNIQUE(tenant_id,node_id,registration_id,version_label),
  CHECK(rule_effective_until>rule_effective_from)
);
CREATE TABLE nx_org.tax_rule (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  priority integer NOT NULL CHECK(priority>=0),
  tax_code text NOT NULL,
  supply_class text NOT NULL,
  geographic_scope text NOT NULL,
  treatment text NOT NULL CHECK(treatment IN ('STANDARD','REDUCED','ZERO','EXEMPT','REVERSE_CHARGE','OUT_OF_SCOPE','WITHHOLDING','CORPORATE_ADJUSTMENT')),
  rate numeric(18,9),
  basis_expression jsonb NOT NULL,
  rounding_policy jsonb NOT NULL,
  evidence_requirement jsonb NOT NULL,
  PRIMARY KEY(tenant_id,node_id,pack_id,rule_id),
  UNIQUE(tenant_id,node_id,pack_id,priority,tax_code,supply_class,geographic_scope),
  CHECK(rate IS NULL OR (rate>=0 AND rate<=1))
);
CREATE TABLE nx_org.tax_calculation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  calc_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  document_ref text NOT NULL,
  taxable_date date NOT NULL,
  currency text NOT NULL CHECK(length(currency)=3),
  base_amount numeric(24,6) NOT NULL,
  tax_amount numeric(24,6) NOT NULL,
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('DRAFT','REVIEW_REQUIRED','REJECTED')),
  PRIMARY KEY(tenant_id,node_id,calc_id)
);
CREATE TABLE nx_org.tax_submission (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  calc_id uuid NOT NULL,
  external_doc_id text NOT NULL,
  document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
  protocol_version text NOT NULL,
  approval_decision_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('PENDING','SUBMITTED','ACCEPTED','REJECTED','UNKNOWN')),
  regulator_receipt_ref text,
  PRIMARY KEY(tenant_id,node_id,submission_id),
  UNIQUE(tenant_id,node_id,external_doc_id)
);
CREATE TABLE nx_org.kernel_operation (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  input_artifact_id uuid NOT NULL,
  output_artifact_id uuid,
  kernel_id text NOT NULL,
  kernel_version text NOT NULL,
  configuration_sha256 text NOT NULL CHECK(configuration_sha256 ~ '^[0-9a-f]{64}$'),
  coordinate_ref text NOT NULL,
  unit_code text NOT NULL,
  tolerance_mm numeric(18,9) NOT NULL CHECK(tolerance_mm>0),
  state text NOT NULL CHECK(state IN ('DRAFT','VALIDATED','REJECTED')),
  PRIMARY KEY(tenant_id,project_id,operation_id)
);
CREATE TABLE nx_org.work_queue (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  job_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
  task_kind text NOT NULL,
  state text NOT NULL CHECK(state IN ('PENDING','LEASED','DONE','DEAD')),
  ready_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  max_attempts integer NOT NULL CHECK(max_attempts>0),
  fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
  lease_token uuid,
  lease_owner name,
  lease_until timestamptz,
  result_sha256 text CHECK(result_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,node_id,job_id),
  UNIQUE(tenant_id,node_id,idempotency_key),
  CHECK(attempts<=max_attempts),
  CHECK((state='LEASED' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'LEASED' AND lease_token IS NULL AND lease_owner IS NULL AND lease_until IS NULL)),
  CHECK((state='DONE' AND result_sha256 IS NOT NULL) OR (state<>'DONE' AND result_sha256 IS NULL))
);
CREATE TABLE nx_org.audit_head (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0 CHECK(last_seq>=0),
  last_hash text NOT NULL CHECK(last_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(tenant_id,node_id)
);
CREATE TABLE nx_org.audit_event (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  sequence_no bigint NOT NULL CHECK(sequence_no>0),
  event_id uuid NOT NULL,
  actor_name name NOT NULL,
  event_type text NOT NULL,
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  previous_hash text NOT NULL CHECK(previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL CHECK(event_hash ~ '^[0-9a-f]{64}$'),
  canonical_record text NOT NULL,
  recorded_at timestamptz NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.audit_event:tenant_id,node_id,sequence_no|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|' || length(sequence_no::text)::text || ':' || sequence_no::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(tenant_id,node_id,event_id),
  UNIQUE(tenant_id,node_id,event_hash),
  UNIQUE(tenant_id,node_id,sequence_no)
);
CREATE TABLE nx_org.audit_checkpoint (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  sequence_no bigint NOT NULL,
  anchor_ref text NOT NULL,
  signed_anchor_sha256 text NOT NULL CHECK(signed_anchor_sha256 ~ '^[0-9a-f]{64}$'),
  anchored_at timestamptz NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.audit_checkpoint:tenant_id,node_id,sequence_no|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|' || length(sequence_no::text)::text || ':' || sequence_no::text || '|')::uuid) STORED NOT NULL,
  master_fk_uuid_1 uuid GENERATED ALWAYS AS (md5('nx_org.audit_event:tenant_id,node_id,sequence_no|'  || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|' || length(sequence_no::text)::text || ':' || sequence_no::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(tenant_id,node_id,sequence_no)
);
CREATE TABLE nx_org.protected_field (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  field_id uuid NOT NULL,
  key_id text NOT NULL,
  purpose_code text NOT NULL,
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,node_id,field_id),
  CHECK(length(ciphertext)>0)
);
CREATE TABLE nx_market.boq_item (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  description text NOT NULL,
  quantity numeric NOT NULL,
  unit text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.rate_version (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  boq_item_id uuid NOT NULL,
  rate numeric NOT NULL,
  currency text NOT NULL,
  effective_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.wbs_activity (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(end_date >= start_date)
);
CREATE TABLE nx_market.activity_dependency (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  predecessor_id uuid NOT NULL,
  successor_id uuid NOT NULL,
  lag_days integer NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(predecessor_id <> successor_id)
);
CREATE TABLE nx_market.element_allocation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  boq_item_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  element_ref text NOT NULL,
  quantity numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.contract_notice (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  contract_ref text NOT NULL,
  clause_ref text NOT NULL,
  notice_date date NOT NULL,
  due_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.valuation_line (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  boq_item_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  quantity numeric NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.rfi (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  question text NOT NULL,
  response text NOT NULL,
  due_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.submittal (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  document_ref text NOT NULL,
  revision text NOT NULL,
  due_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.transmittal (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  document_ref text NOT NULL,
  recipient_ref text NOT NULL,
  sent_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.checklist_template (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  version integer NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.inspection_result (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  template_id uuid NOT NULL,
  result text NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.punch_item (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  inspection_id uuid NOT NULL,
  description text NOT NULL,
  due_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.field_escalation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  record_ref text NOT NULL,
  due_at timestamptz NOT NULL,
  assigned_role text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.account (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  account_type text NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,code)
);
CREATE TABLE nx_market.fiscal_period (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  closed boolean NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(end_date >= start_date)
);
CREATE TABLE nx_market.journal_header (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  period_id uuid NOT NULL,
  source_ref text NOT NULL,
  posting_date date NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.journal_line (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  journal_id uuid NOT NULL,
  account_id uuid NOT NULL,
  debit numeric NOT NULL,
  credit numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(debit >= 0),
  CHECK(credit >= 0),
  CHECK((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE TABLE nx_market.cost_commitment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  source_ref text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.invoice (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  invoice_number text NOT NULL,
  counterparty_ref text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,counterparty_ref,invoice_number)
);
CREATE TABLE nx_market.payment_certificate_line (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  valuation_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.fx_rate (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric NOT NULL,
  rate_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(rate > 0)
);
CREATE TABLE nx_market.merge_policy (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  object_type text NOT NULL,
  algorithm text NOT NULL,
  version integer NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.crdt_operation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  object_ref text NOT NULL,
  actor_ref text NOT NULL,
  actor_seq bigint NOT NULL,
  causal_context jsonb NOT NULL,
  payload jsonb NOT NULL,
  policy_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,actor_ref,actor_seq)
);
CREATE TABLE nx_market.sync_conflict (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  operation_id uuid NOT NULL,
  resolution jsonb NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.tombstone (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  object_ref text NOT NULL,
  operation_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.attachment_chunk (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  attachment_ref text NOT NULL,
  chunk_index integer NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,attachment_ref,chunk_index)
);
CREATE TABLE nx_market.sync_checkpoint (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  actor_ref text NOT NULL,
  vector_clock jsonb NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.property (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.building (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  property_id uuid NOT NULL,
  code text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.unit (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  building_id uuid NOT NULL,
  code text NOT NULL,
  saleable_area numeric NOT NULL,
  inventory_status text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(saleable_area > 0)
);
CREATE TABLE nx_market.price_book (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  effective_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.reservation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  customer_ref text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.contact (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  external_ref text NOT NULL,
  display_name text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.lead_source (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  channel text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.lead (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  contact_id uuid NOT NULL,
  source_id uuid NOT NULL,
  stage text NOT NULL,
  dedupe_key text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,dedupe_key)
);
CREATE TABLE nx_market.consent (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  contact_id uuid NOT NULL,
  purpose text NOT NULL,
  granted boolean NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.lead_assignment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  lead_id uuid NOT NULL,
  role_id text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.lead_activity (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  lead_id uuid NOT NULL,
  activity_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.viewing (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  lead_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.funnel_stage (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  sequence integer NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.broker_agreement (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  broker_ref text NOT NULL,
  effective_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.commission_rule (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  agreement_id uuid NOT NULL,
  rate numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(rate >= 0 AND rate <= 1)
);
CREATE TABLE nx_market.commission_split (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  rule_id uuid NOT NULL,
  beneficiary_ref text NOT NULL,
  share numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(share >= 0 AND share <= 1)
);
CREATE TABLE nx_market.eligibility_event (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  rule_id uuid NOT NULL,
  event_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.commission_accrual (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  event_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.commission_clawback (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  accrual_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.commission_payout (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  accrual_id uuid NOT NULL,
  amount numeric NOT NULL,
  payment_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.sale_contract (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  customer_ref text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.installment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  sale_id uuid NOT NULL,
  due_date date NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.lease (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  tenant_ref text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  rent numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(end_date >= start_date)
);
CREATE TABLE nx_market.rent_escalation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  lease_id uuid NOT NULL,
  effective_date date NOT NULL,
  new_rent numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.deposit (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  lease_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.receipt_allocation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  receipt_ref text NOT NULL,
  installment_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.arrears (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  installment_id uuid NOT NULL,
  as_of date NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.unit_handover (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  handover_date date NOT NULL,
  evidence_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.occupant (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.asset_register (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  asset_tag text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.warranty (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  asset_id uuid NOT NULL,
  expiry_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.service_request (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  description text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.service_sla (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  response_minutes integer NOT NULL,
  resolution_minutes integer NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.work_order (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  request_id uuid NOT NULL,
  sla_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.listing (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  unit_id uuid NOT NULL,
  description text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.portal_entitlement (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  portal text NOT NULL,
  account_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.feed_run (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  entitlement_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.listing_permit (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  listing_id uuid NOT NULL,
  permit_ref text NOT NULL,
  expiry_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.portal_credit_ledger (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  entitlement_id uuid NOT NULL,
  credits integer NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.comparable_record (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  market_ref text NOT NULL,
  area numeric NOT NULL,
  price numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.valuation_evidence (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  comparable_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  evidence_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.intercompany_match (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  counterparty_node_ref text NOT NULL,
  source_ref text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.consolidation_run (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  period_id uuid NOT NULL,
  reporting_currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.elimination (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  run_id uuid NOT NULL,
  match_id uuid NOT NULL,
  amount numeric NOT NULL,
  offset_amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(amount + offset_amount = 0)
);
CREATE TABLE nx_market.invoice_line (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  invoice_id uuid NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.receipt (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  commitment_id uuid NOT NULL,
  quantity numeric NOT NULL,
  receipt_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.match_exception (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  invoice_line_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.bank_account (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  bank_ref text NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.bank_statement_line (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  account_id uuid NOT NULL,
  external_ref text NOT NULL,
  amount numeric NOT NULL,
  value_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,account_id,external_ref)
);
CREATE TABLE nx_market.payment_proposal (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  invoice_id uuid NOT NULL,
  amount numeric NOT NULL,
  decision_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.reconciliation_match (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  statement_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,statement_id)
);
CREATE TABLE nx_market.tax_document_line (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  invoice_line_id uuid NOT NULL,
  calculation_ref text NOT NULL,
  tax_amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.tax_return (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  submission_ref text NOT NULL,
  period_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.withholding_event (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  invoice_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.transfer_pricing_adjustment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  match_id uuid NOT NULL,
  amount numeric NOT NULL,
  policy_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.worker (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  worker_ref text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.employment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  worker_id uuid NOT NULL,
  country text NOT NULL,
  start_date date NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.pay_component (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  code text NOT NULL,
  component_type text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.pay_run (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  period_id uuid NOT NULL,
  country text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.pay_result (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  run_id uuid NOT NULL,
  employment_id uuid NOT NULL,
  component_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.shift (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  CHECK(end_at > start_at)
);
CREATE TABLE nx_market.crew_assignment (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  worker_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.time_entry (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  assignment_id uuid NOT NULL,
  external_ref text NOT NULL,
  hours numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,external_ref),
  CHECK(hours >= 0 AND hours <= 24)
);
CREATE TABLE nx_market.labor_allocation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  time_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  hours numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.fixed_asset (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  asset_tag text NOT NULL,
  acquisition_cost numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.depreciation_run (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  asset_id uuid NOT NULL,
  period_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.maintenance_order (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  asset_id uuid NOT NULL,
  description text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.asset_charge (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  asset_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.performance_obligation (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  contract_ref text NOT NULL,
  transaction_price numeric NOT NULL,
  currency text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.wip_snapshot (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  obligation_id uuid NOT NULL,
  period_id uuid NOT NULL,
  cost_to_date numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.revenue_event (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  obligation_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  amount numeric NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.connector_contract (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  connector_ref text NOT NULL,
  version integer NOT NULL,
  schema_doc jsonb NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.webhook_receipt (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  connector_id uuid NOT NULL,
  event_key text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id),
  UNIQUE(tenant_id,node_id,connector_id,event_key)
);
CREATE TABLE nx_market.dead_letter (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  receipt_id uuid NOT NULL,
  error_text text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
CREATE TABLE nx_market.export_manifest (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','CLOSED','VOID')),
  connector_id uuid NOT NULL,
  sha256 text NOT NULL,
  record_count bigint NOT NULL,
  PRIMARY KEY(tenant_id,node_id,id)
);
ALTER TABLE nx_design.actor ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.artifact ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.model ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.quantity_rule ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.catalog_item ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.catalog_item ADD FOREIGN KEY(tenant_id,project_id,source_artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.operation_result ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.operation_result ADD FOREIGN KEY(tenant_id,project_id,actor_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.revision ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_design.revision ADD FOREIGN KEY(tenant_id,project_id,model_id) REFERENCES nx_design.model(tenant_id,project_id,model_id);
ALTER TABLE nx_design.revision ADD FOREIGN KEY(tenant_id,project_id,created_by) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.analysis ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.analysis ADD FOREIGN KEY(tenant_id,project_id,artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.bundle ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.bundle ADD FOREIGN KEY(tenant_id,project_id,manifest_artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.element ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.exchange ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.exchange ADD FOREIGN KEY(tenant_id,project_id,artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.measurement ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.outbox ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.release_approval ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.release_approval ADD FOREIGN KEY(tenant_id,project_id,approver_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.render ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.render ADD FOREIGN KEY(tenant_id,project_id,artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.sheet ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.terrain ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.terrain ADD FOREIGN KEY(tenant_id,project_id,artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.view_state ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.view_state ADD FOREIGN KEY(tenant_id,project_id,actor_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.issue ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.issue ADD FOREIGN KEY(tenant_id,project_id,revision_id,element_id) REFERENCES nx_design.element(tenant_id,project_id,revision_id,element_id);
ALTER TABLE nx_design.issue ADD FOREIGN KEY(tenant_id,project_id,revision_id,view_id) REFERENCES nx_design.view_state(tenant_id,project_id,revision_id,view_id);
ALTER TABLE nx_design.quantity ADD FOREIGN KEY(tenant_id,project_id,revision_id,element_id) REFERENCES nx_design.element(tenant_id,project_id,revision_id,element_id);
ALTER TABLE nx_design.quantity ADD FOREIGN KEY(tenant_id,project_id,rule_version_id) REFERENCES nx_design.quantity_rule(tenant_id,project_id,rule_version_id);
ALTER TABLE nx_design.share_grant ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.share_grant ADD FOREIGN KEY(tenant_id,project_id,revision_id,bundle_id) REFERENCES nx_design.bundle(tenant_id,project_id,revision_id,bundle_id);
ALTER TABLE nx_design.share_grant ADD FOREIGN KEY(tenant_id,project_id,recipient_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.space ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.space ADD FOREIGN KEY(tenant_id,project_id,revision_id,element_id) REFERENCES nx_design.element(tenant_id,project_id,revision_id,element_id);
ALTER TABLE nx_design.view_link ADD FOREIGN KEY(tenant_id,project_id,revision_id,sheet_id) REFERENCES nx_design.sheet(tenant_id,project_id,revision_id,sheet_id);
ALTER TABLE nx_design.view_link ADD FOREIGN KEY(tenant_id,project_id,revision_id,element_id) REFERENCES nx_design.element(tenant_id,project_id,revision_id,element_id);
ALTER TABLE nx_auth.principal_scope ADD FOREIGN KEY(tenant_id,project_id,actor_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.revision_seal ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.revision_seal ADD FOREIGN KEY(tenant_id,project_id,sealed_by) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.operation_evidence ADD FOREIGN KEY(tenant_id,project_id,actor_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_design.operation_evidence ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_design.operation_evidence ADD FOREIGN KEY(tenant_id,project_id,result_artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_design.operation_evidence ADD FOREIGN KEY(master_fk_uuid_4) REFERENCES nx_design.capability_registry(master_key_uuid);
ALTER TABLE nx_design.event_delivery ADD FOREIGN KEY(tenant_id,project_id,event_id) REFERENCES nx_design.outbox(tenant_id,project_id,event_id);
ALTER TABLE nx_org.org_node ADD FOREIGN KEY(master_fk_uuid_1) REFERENCES nx_org.org_node(master_alt_uuid_10);
ALTER TABLE nx_org.node_membership ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.role_assignment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.role_assignment ADD FOREIGN KEY(master_fk_uuid_2) REFERENCES nx_org.role_catalog(master_key_uuid);
ALTER TABLE nx_org.doa_rule ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.doa_rule ADD FOREIGN KEY(master_fk_uuid_2) REFERENCES nx_org.role_catalog(master_key_uuid);
ALTER TABLE nx_org.decision_request ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.decision_review ADD FOREIGN KEY(tenant_id,node_id,decision_id) REFERENCES nx_org.decision_request(tenant_id,node_id,decision_id);
ALTER TABLE nx_org.decision_review ADD FOREIGN KEY(tenant_id,node_id,rule_id) REFERENCES nx_org.doa_rule(tenant_id,node_id,rule_id);
ALTER TABLE nx_org.project_binding ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.project_binding ADD FOREIGN KEY(tenant_id,project_id) REFERENCES nx_design.project_scope(tenant_id,project_id);
ALTER TABLE nx_org.site_device ADD FOREIGN KEY(tenant_id,project_id,actor_id) REFERENCES nx_design.actor(tenant_id,project_id,actor_id);
ALTER TABLE nx_org.sync_event ADD FOREIGN KEY(tenant_id,project_id,device_id) REFERENCES nx_org.site_device(tenant_id,project_id,device_id);
ALTER TABLE nx_org.sync_event ADD FOREIGN KEY(tenant_id,project_id,base_revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_org.sync_event ADD FOREIGN KEY(tenant_id,project_id,artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_org.role_agent_profile ADD FOREIGN KEY(master_fk_uuid_0) REFERENCES nx_org.role_catalog(master_key_uuid);
ALTER TABLE nx_org.governance_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.investment_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.opportunity_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.estimate_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.contract_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.engineering_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.technical_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.controls_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.field_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.supply_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.plant_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.finance_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.workforce_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.security_work ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.dependency_candidate ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.dependency_release ADD FOREIGN KEY(tenant_id,node_id,component_id) REFERENCES nx_org.dependency_candidate(tenant_id,node_id,component_id);
ALTER TABLE nx_org.dependency_release ADD FOREIGN KEY(tenant_id,node_id,decision_id) REFERENCES nx_org.decision_request(tenant_id,node_id,decision_id);
ALTER TABLE nx_org.tax_registration ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.tax_pack ADD FOREIGN KEY(tenant_id,node_id,registration_id) REFERENCES nx_org.tax_registration(tenant_id,node_id,registration_id);
ALTER TABLE nx_org.tax_pack ADD FOREIGN KEY(tenant_id,node_id,approval_decision_id) REFERENCES nx_org.decision_request(tenant_id,node_id,decision_id);
ALTER TABLE nx_org.tax_rule ADD FOREIGN KEY(tenant_id,node_id,pack_id) REFERENCES nx_org.tax_pack(tenant_id,node_id,pack_id);
ALTER TABLE nx_org.tax_calculation ADD FOREIGN KEY(tenant_id,node_id,pack_id,rule_id) REFERENCES nx_org.tax_rule(tenant_id,node_id,pack_id,rule_id);
ALTER TABLE nx_org.tax_submission ADD FOREIGN KEY(tenant_id,node_id,calc_id) REFERENCES nx_org.tax_calculation(tenant_id,node_id,calc_id);
ALTER TABLE nx_org.tax_submission ADD FOREIGN KEY(tenant_id,node_id,approval_decision_id) REFERENCES nx_org.decision_request(tenant_id,node_id,decision_id);
ALTER TABLE nx_org.kernel_operation ADD FOREIGN KEY(tenant_id,project_id,revision_id) REFERENCES nx_design.revision(tenant_id,project_id,revision_id);
ALTER TABLE nx_org.kernel_operation ADD FOREIGN KEY(tenant_id,project_id,input_artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_org.kernel_operation ADD FOREIGN KEY(tenant_id,project_id,output_artifact_id) REFERENCES nx_design.artifact(tenant_id,project_id,artifact_id);
ALTER TABLE nx_org.work_queue ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.audit_head ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_org.audit_event ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.audit_head(tenant_id,node_id);
ALTER TABLE nx_org.audit_checkpoint ADD FOREIGN KEY(master_fk_uuid_1) REFERENCES nx_org.audit_event(master_key_uuid);
ALTER TABLE nx_org.protected_field ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.boq_item ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.rate_version ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.rate_version ADD FOREIGN KEY(tenant_id,node_id,boq_item_id) REFERENCES nx_market.boq_item(tenant_id,node_id,id);
ALTER TABLE nx_market.wbs_activity ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.activity_dependency ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.activity_dependency ADD FOREIGN KEY(tenant_id,node_id,predecessor_id) REFERENCES nx_market.wbs_activity(tenant_id,node_id,id);
ALTER TABLE nx_market.activity_dependency ADD FOREIGN KEY(tenant_id,node_id,successor_id) REFERENCES nx_market.wbs_activity(tenant_id,node_id,id);
ALTER TABLE nx_market.element_allocation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.element_allocation ADD FOREIGN KEY(tenant_id,node_id,boq_item_id) REFERENCES nx_market.boq_item(tenant_id,node_id,id);
ALTER TABLE nx_market.element_allocation ADD FOREIGN KEY(tenant_id,node_id,activity_id) REFERENCES nx_market.wbs_activity(tenant_id,node_id,id);
ALTER TABLE nx_market.contract_notice ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.valuation_line ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.valuation_line ADD FOREIGN KEY(tenant_id,node_id,boq_item_id) REFERENCES nx_market.boq_item(tenant_id,node_id,id);
ALTER TABLE nx_market.valuation_line ADD FOREIGN KEY(tenant_id,node_id,notice_id) REFERENCES nx_market.contract_notice(tenant_id,node_id,id);
ALTER TABLE nx_market.rfi ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.submittal ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.transmittal ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.checklist_template ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.inspection_result ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.inspection_result ADD FOREIGN KEY(tenant_id,node_id,template_id) REFERENCES nx_market.checklist_template(tenant_id,node_id,id);
ALTER TABLE nx_market.punch_item ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.punch_item ADD FOREIGN KEY(tenant_id,node_id,inspection_id) REFERENCES nx_market.inspection_result(tenant_id,node_id,id);
ALTER TABLE nx_market.field_escalation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.account ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.fiscal_period ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.journal_header ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.journal_header ADD FOREIGN KEY(tenant_id,node_id,period_id) REFERENCES nx_market.fiscal_period(tenant_id,node_id,id);
ALTER TABLE nx_market.journal_line ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.journal_line ADD FOREIGN KEY(tenant_id,node_id,journal_id) REFERENCES nx_market.journal_header(tenant_id,node_id,id);
ALTER TABLE nx_market.journal_line ADD FOREIGN KEY(tenant_id,node_id,account_id) REFERENCES nx_market.account(tenant_id,node_id,id);
ALTER TABLE nx_market.cost_commitment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.invoice ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.payment_certificate_line ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.payment_certificate_line ADD FOREIGN KEY(tenant_id,node_id,valuation_id) REFERENCES nx_market.valuation_line(tenant_id,node_id,id);
ALTER TABLE nx_market.fx_rate ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.merge_policy ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.crdt_operation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.crdt_operation ADD FOREIGN KEY(tenant_id,node_id,policy_id) REFERENCES nx_market.merge_policy(tenant_id,node_id,id);
ALTER TABLE nx_market.sync_conflict ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.sync_conflict ADD FOREIGN KEY(tenant_id,node_id,operation_id) REFERENCES nx_market.crdt_operation(tenant_id,node_id,id);
ALTER TABLE nx_market.tombstone ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.tombstone ADD FOREIGN KEY(tenant_id,node_id,operation_id) REFERENCES nx_market.crdt_operation(tenant_id,node_id,id);
ALTER TABLE nx_market.attachment_chunk ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.sync_checkpoint ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.property ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.building ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.building ADD FOREIGN KEY(tenant_id,node_id,property_id) REFERENCES nx_market.property(tenant_id,node_id,id);
ALTER TABLE nx_market.unit ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.unit ADD FOREIGN KEY(tenant_id,node_id,building_id) REFERENCES nx_market.building(tenant_id,node_id,id);
ALTER TABLE nx_market.price_book ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.price_book ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.reservation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.reservation ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.contact ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.lead_source ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.lead ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.lead ADD FOREIGN KEY(tenant_id,node_id,contact_id) REFERENCES nx_market.contact(tenant_id,node_id,id);
ALTER TABLE nx_market.lead ADD FOREIGN KEY(tenant_id,node_id,source_id) REFERENCES nx_market.lead_source(tenant_id,node_id,id);
ALTER TABLE nx_market.consent ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.consent ADD FOREIGN KEY(tenant_id,node_id,contact_id) REFERENCES nx_market.contact(tenant_id,node_id,id);
ALTER TABLE nx_market.lead_assignment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.lead_assignment ADD FOREIGN KEY(tenant_id,node_id,lead_id) REFERENCES nx_market.lead(tenant_id,node_id,id);
ALTER TABLE nx_market.lead_activity ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.lead_activity ADD FOREIGN KEY(tenant_id,node_id,lead_id) REFERENCES nx_market.lead(tenant_id,node_id,id);
ALTER TABLE nx_market.viewing ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.viewing ADD FOREIGN KEY(tenant_id,node_id,lead_id) REFERENCES nx_market.lead(tenant_id,node_id,id);
ALTER TABLE nx_market.viewing ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.funnel_stage ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.broker_agreement ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.commission_rule ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.commission_rule ADD FOREIGN KEY(tenant_id,node_id,agreement_id) REFERENCES nx_market.broker_agreement(tenant_id,node_id,id);
ALTER TABLE nx_market.commission_split ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.commission_split ADD FOREIGN KEY(tenant_id,node_id,rule_id) REFERENCES nx_market.commission_rule(tenant_id,node_id,id);
ALTER TABLE nx_market.eligibility_event ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.eligibility_event ADD FOREIGN KEY(tenant_id,node_id,rule_id) REFERENCES nx_market.commission_rule(tenant_id,node_id,id);
ALTER TABLE nx_market.commission_accrual ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.commission_accrual ADD FOREIGN KEY(tenant_id,node_id,event_id) REFERENCES nx_market.eligibility_event(tenant_id,node_id,id);
ALTER TABLE nx_market.commission_clawback ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.commission_clawback ADD FOREIGN KEY(tenant_id,node_id,accrual_id) REFERENCES nx_market.commission_accrual(tenant_id,node_id,id);
ALTER TABLE nx_market.commission_payout ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.commission_payout ADD FOREIGN KEY(tenant_id,node_id,accrual_id) REFERENCES nx_market.commission_accrual(tenant_id,node_id,id);
ALTER TABLE nx_market.sale_contract ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.sale_contract ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.installment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.installment ADD FOREIGN KEY(tenant_id,node_id,sale_id) REFERENCES nx_market.sale_contract(tenant_id,node_id,id);
ALTER TABLE nx_market.lease ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.lease ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.rent_escalation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.rent_escalation ADD FOREIGN KEY(tenant_id,node_id,lease_id) REFERENCES nx_market.lease(tenant_id,node_id,id);
ALTER TABLE nx_market.deposit ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.deposit ADD FOREIGN KEY(tenant_id,node_id,lease_id) REFERENCES nx_market.lease(tenant_id,node_id,id);
ALTER TABLE nx_market.receipt_allocation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.receipt_allocation ADD FOREIGN KEY(tenant_id,node_id,installment_id) REFERENCES nx_market.installment(tenant_id,node_id,id);
ALTER TABLE nx_market.arrears ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.arrears ADD FOREIGN KEY(tenant_id,node_id,installment_id) REFERENCES nx_market.installment(tenant_id,node_id,id);
ALTER TABLE nx_market.unit_handover ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.unit_handover ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.occupant ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.occupant ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.occupant ADD FOREIGN KEY(tenant_id,node_id,contact_id) REFERENCES nx_market.contact(tenant_id,node_id,id);
ALTER TABLE nx_market.asset_register ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.asset_register ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.warranty ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.warranty ADD FOREIGN KEY(tenant_id,node_id,asset_id) REFERENCES nx_market.asset_register(tenant_id,node_id,id);
ALTER TABLE nx_market.service_request ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.service_request ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.service_sla ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.work_order ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.work_order ADD FOREIGN KEY(tenant_id,node_id,request_id) REFERENCES nx_market.service_request(tenant_id,node_id,id);
ALTER TABLE nx_market.work_order ADD FOREIGN KEY(tenant_id,node_id,sla_id) REFERENCES nx_market.service_sla(tenant_id,node_id,id);
ALTER TABLE nx_market.listing ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.listing ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.portal_entitlement ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.feed_run ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.feed_run ADD FOREIGN KEY(tenant_id,node_id,entitlement_id) REFERENCES nx_market.portal_entitlement(tenant_id,node_id,id);
ALTER TABLE nx_market.feed_run ADD FOREIGN KEY(tenant_id,node_id,listing_id) REFERENCES nx_market.listing(tenant_id,node_id,id);
ALTER TABLE nx_market.listing_permit ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.listing_permit ADD FOREIGN KEY(tenant_id,node_id,listing_id) REFERENCES nx_market.listing(tenant_id,node_id,id);
ALTER TABLE nx_market.portal_credit_ledger ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.portal_credit_ledger ADD FOREIGN KEY(tenant_id,node_id,entitlement_id) REFERENCES nx_market.portal_entitlement(tenant_id,node_id,id);
ALTER TABLE nx_market.comparable_record ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.valuation_evidence ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.valuation_evidence ADD FOREIGN KEY(tenant_id,node_id,comparable_id) REFERENCES nx_market.comparable_record(tenant_id,node_id,id);
ALTER TABLE nx_market.valuation_evidence ADD FOREIGN KEY(tenant_id,node_id,unit_id) REFERENCES nx_market.unit(tenant_id,node_id,id);
ALTER TABLE nx_market.intercompany_match ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.consolidation_run ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.consolidation_run ADD FOREIGN KEY(tenant_id,node_id,period_id) REFERENCES nx_market.fiscal_period(tenant_id,node_id,id);
ALTER TABLE nx_market.elimination ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.elimination ADD FOREIGN KEY(tenant_id,node_id,run_id) REFERENCES nx_market.consolidation_run(tenant_id,node_id,id);
ALTER TABLE nx_market.elimination ADD FOREIGN KEY(tenant_id,node_id,match_id) REFERENCES nx_market.intercompany_match(tenant_id,node_id,id);
ALTER TABLE nx_market.invoice_line ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.invoice_line ADD FOREIGN KEY(tenant_id,node_id,invoice_id) REFERENCES nx_market.invoice(tenant_id,node_id,id);
ALTER TABLE nx_market.receipt ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.receipt ADD FOREIGN KEY(tenant_id,node_id,commitment_id) REFERENCES nx_market.cost_commitment(tenant_id,node_id,id);
ALTER TABLE nx_market.match_exception ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.match_exception ADD FOREIGN KEY(tenant_id,node_id,invoice_line_id) REFERENCES nx_market.invoice_line(tenant_id,node_id,id);
ALTER TABLE nx_market.match_exception ADD FOREIGN KEY(tenant_id,node_id,receipt_id) REFERENCES nx_market.receipt(tenant_id,node_id,id);
ALTER TABLE nx_market.bank_account ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.bank_statement_line ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.bank_statement_line ADD FOREIGN KEY(tenant_id,node_id,account_id) REFERENCES nx_market.bank_account(tenant_id,node_id,id);
ALTER TABLE nx_market.payment_proposal ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.payment_proposal ADD FOREIGN KEY(tenant_id,node_id,invoice_id) REFERENCES nx_market.invoice(tenant_id,node_id,id);
ALTER TABLE nx_market.reconciliation_match ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.reconciliation_match ADD FOREIGN KEY(tenant_id,node_id,statement_id) REFERENCES nx_market.bank_statement_line(tenant_id,node_id,id);
ALTER TABLE nx_market.reconciliation_match ADD FOREIGN KEY(tenant_id,node_id,journal_id) REFERENCES nx_market.journal_header(tenant_id,node_id,id);
ALTER TABLE nx_market.tax_document_line ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.tax_document_line ADD FOREIGN KEY(tenant_id,node_id,invoice_line_id) REFERENCES nx_market.invoice_line(tenant_id,node_id,id);
ALTER TABLE nx_market.tax_return ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.tax_return ADD FOREIGN KEY(tenant_id,node_id,period_id) REFERENCES nx_market.fiscal_period(tenant_id,node_id,id);
ALTER TABLE nx_market.withholding_event ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.withholding_event ADD FOREIGN KEY(tenant_id,node_id,invoice_id) REFERENCES nx_market.invoice(tenant_id,node_id,id);
ALTER TABLE nx_market.transfer_pricing_adjustment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.transfer_pricing_adjustment ADD FOREIGN KEY(tenant_id,node_id,match_id) REFERENCES nx_market.intercompany_match(tenant_id,node_id,id);
ALTER TABLE nx_market.worker ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.employment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.employment ADD FOREIGN KEY(tenant_id,node_id,worker_id) REFERENCES nx_market.worker(tenant_id,node_id,id);
ALTER TABLE nx_market.pay_component ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.pay_run ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.pay_run ADD FOREIGN KEY(tenant_id,node_id,period_id) REFERENCES nx_market.fiscal_period(tenant_id,node_id,id);
ALTER TABLE nx_market.pay_result ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.pay_result ADD FOREIGN KEY(tenant_id,node_id,run_id) REFERENCES nx_market.pay_run(tenant_id,node_id,id);
ALTER TABLE nx_market.pay_result ADD FOREIGN KEY(tenant_id,node_id,employment_id) REFERENCES nx_market.employment(tenant_id,node_id,id);
ALTER TABLE nx_market.pay_result ADD FOREIGN KEY(tenant_id,node_id,component_id) REFERENCES nx_market.pay_component(tenant_id,node_id,id);
ALTER TABLE nx_market.shift ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.crew_assignment ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.crew_assignment ADD FOREIGN KEY(tenant_id,node_id,worker_id) REFERENCES nx_market.worker(tenant_id,node_id,id);
ALTER TABLE nx_market.crew_assignment ADD FOREIGN KEY(tenant_id,node_id,shift_id) REFERENCES nx_market.shift(tenant_id,node_id,id);
ALTER TABLE nx_market.time_entry ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.time_entry ADD FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_market.crew_assignment(tenant_id,node_id,id);
ALTER TABLE nx_market.labor_allocation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.labor_allocation ADD FOREIGN KEY(tenant_id,node_id,time_id) REFERENCES nx_market.time_entry(tenant_id,node_id,id);
ALTER TABLE nx_market.labor_allocation ADD FOREIGN KEY(tenant_id,node_id,activity_id) REFERENCES nx_market.wbs_activity(tenant_id,node_id,id);
ALTER TABLE nx_market.fixed_asset ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.depreciation_run ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.depreciation_run ADD FOREIGN KEY(tenant_id,node_id,asset_id) REFERENCES nx_market.fixed_asset(tenant_id,node_id,id);
ALTER TABLE nx_market.depreciation_run ADD FOREIGN KEY(tenant_id,node_id,period_id) REFERENCES nx_market.fiscal_period(tenant_id,node_id,id);
ALTER TABLE nx_market.maintenance_order ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.maintenance_order ADD FOREIGN KEY(tenant_id,node_id,asset_id) REFERENCES nx_market.fixed_asset(tenant_id,node_id,id);
ALTER TABLE nx_market.asset_charge ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.asset_charge ADD FOREIGN KEY(tenant_id,node_id,asset_id) REFERENCES nx_market.fixed_asset(tenant_id,node_id,id);
ALTER TABLE nx_market.asset_charge ADD FOREIGN KEY(tenant_id,node_id,activity_id) REFERENCES nx_market.wbs_activity(tenant_id,node_id,id);
ALTER TABLE nx_market.performance_obligation ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.wip_snapshot ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.wip_snapshot ADD FOREIGN KEY(tenant_id,node_id,obligation_id) REFERENCES nx_market.performance_obligation(tenant_id,node_id,id);
ALTER TABLE nx_market.wip_snapshot ADD FOREIGN KEY(tenant_id,node_id,period_id) REFERENCES nx_market.fiscal_period(tenant_id,node_id,id);
ALTER TABLE nx_market.revenue_event ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.revenue_event ADD FOREIGN KEY(tenant_id,node_id,obligation_id) REFERENCES nx_market.performance_obligation(tenant_id,node_id,id);
ALTER TABLE nx_market.revenue_event ADD FOREIGN KEY(tenant_id,node_id,journal_id) REFERENCES nx_market.journal_header(tenant_id,node_id,id);
ALTER TABLE nx_market.connector_contract ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.webhook_receipt ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.webhook_receipt ADD FOREIGN KEY(tenant_id,node_id,connector_id) REFERENCES nx_market.connector_contract(tenant_id,node_id,id);
ALTER TABLE nx_market.dead_letter ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.dead_letter ADD FOREIGN KEY(tenant_id,node_id,receipt_id) REFERENCES nx_market.webhook_receipt(tenant_id,node_id,id);
ALTER TABLE nx_market.export_manifest ADD FOREIGN KEY(tenant_id,node_id) REFERENCES nx_org.org_node(tenant_id,node_id);
ALTER TABLE nx_market.export_manifest ADD FOREIGN KEY(tenant_id,node_id,connector_id) REFERENCES nx_market.connector_contract(tenant_id,node_id,id);
CREATE UNIQUE INDEX market_active_reservation ON nx_market.reservation(tenant_id,node_id,unit_id) WHERE state = 'ACTIVE';
ALTER TABLE nx_market.boq_item ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.boq_item FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.boq_item USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.rate_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.rate_version FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.rate_version USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.wbs_activity ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.wbs_activity FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.wbs_activity USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.activity_dependency ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.activity_dependency FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.activity_dependency USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.element_allocation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.element_allocation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.element_allocation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.contract_notice ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.contract_notice FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.contract_notice USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.valuation_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.valuation_line FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.valuation_line USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.rfi ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.rfi FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.rfi USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.submittal ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.submittal FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.submittal USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.transmittal ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.transmittal FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.transmittal USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.checklist_template ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.checklist_template FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.checklist_template USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.inspection_result ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.inspection_result FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.inspection_result USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.punch_item ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.punch_item FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.punch_item USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.field_escalation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.field_escalation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.field_escalation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.account ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.account FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.account USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.fiscal_period ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.fiscal_period FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.fiscal_period USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.journal_header ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.journal_header FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.journal_header USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.journal_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.journal_line FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.journal_line USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.cost_commitment ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.cost_commitment FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.cost_commitment USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.invoice ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.invoice FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.invoice USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.payment_certificate_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.payment_certificate_line FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.payment_certificate_line USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.fx_rate ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.fx_rate FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.fx_rate USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.merge_policy ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.merge_policy FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.merge_policy USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.crdt_operation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.crdt_operation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.crdt_operation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.sync_conflict ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.sync_conflict FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.sync_conflict USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.tombstone ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.tombstone FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.tombstone USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.attachment_chunk ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.attachment_chunk FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.attachment_chunk USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.sync_checkpoint ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.sync_checkpoint FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.sync_checkpoint USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.property ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.property FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.property USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.building ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.building FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.building USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.unit ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.unit FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.unit USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.price_book ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.price_book FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.price_book USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.reservation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.reservation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.reservation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.contact ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.contact FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.contact USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.lead_source ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.lead_source FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.lead_source USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.lead ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.lead FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.lead USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.consent ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.consent FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.consent USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.lead_assignment ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.lead_assignment FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.lead_assignment USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.lead_activity ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.lead_activity FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.lead_activity USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.viewing ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.viewing FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.viewing USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.funnel_stage ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.funnel_stage FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.funnel_stage USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.broker_agreement ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.broker_agreement FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.broker_agreement USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.commission_rule ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.commission_rule FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.commission_rule USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.commission_split ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.commission_split FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.commission_split USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.eligibility_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.eligibility_event FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.eligibility_event USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.commission_accrual ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.commission_accrual FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.commission_accrual USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.commission_clawback ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.commission_clawback FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.commission_clawback USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.commission_payout ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.commission_payout FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.commission_payout USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.sale_contract ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.sale_contract FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.sale_contract USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.installment ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.installment FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.installment USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.lease ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.lease FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.lease USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.rent_escalation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.rent_escalation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.rent_escalation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.deposit ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.deposit FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.deposit USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.receipt_allocation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.receipt_allocation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.receipt_allocation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.arrears ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.arrears FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.arrears USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.unit_handover ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.unit_handover FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.unit_handover USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.occupant ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.occupant FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.occupant USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.asset_register ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.asset_register FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.asset_register USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.warranty ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.warranty FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.warranty USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.service_request ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.service_request FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.service_request USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.service_sla ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.service_sla FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.service_sla USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.work_order ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.work_order FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.work_order USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.listing ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.listing FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.listing USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.portal_entitlement ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.portal_entitlement FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.portal_entitlement USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.feed_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.feed_run FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.feed_run USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.listing_permit ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.listing_permit FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.listing_permit USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.portal_credit_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.portal_credit_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.portal_credit_ledger USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.comparable_record ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.comparable_record FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.comparable_record USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.valuation_evidence ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.valuation_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.valuation_evidence USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.intercompany_match ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.intercompany_match FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.intercompany_match USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.consolidation_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.consolidation_run FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.consolidation_run USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.elimination ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.elimination FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.elimination USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.invoice_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.invoice_line FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.invoice_line USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.receipt ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.receipt FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.receipt USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.match_exception ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.match_exception FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.match_exception USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.bank_account ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.bank_account FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.bank_account USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.bank_statement_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.bank_statement_line FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.bank_statement_line USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.payment_proposal ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.payment_proposal FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.payment_proposal USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.reconciliation_match ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.reconciliation_match FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.reconciliation_match USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.tax_document_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.tax_document_line FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.tax_document_line USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.tax_return ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.tax_return FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.tax_return USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.withholding_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.withholding_event FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.withholding_event USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.transfer_pricing_adjustment ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.transfer_pricing_adjustment FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.transfer_pricing_adjustment USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.worker ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.worker FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.worker USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.employment ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.employment FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.employment USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.pay_component ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.pay_component FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.pay_component USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.pay_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.pay_run FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.pay_run USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.pay_result ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.pay_result FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.pay_result USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.shift ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.shift FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.shift USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.crew_assignment ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.crew_assignment FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.crew_assignment USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.time_entry ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.time_entry FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.time_entry USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.labor_allocation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.labor_allocation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.labor_allocation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.fixed_asset ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.fixed_asset FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.fixed_asset USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.depreciation_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.depreciation_run FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.depreciation_run USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.maintenance_order ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.maintenance_order FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.maintenance_order USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.asset_charge ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.asset_charge FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.asset_charge USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.performance_obligation ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.performance_obligation FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.performance_obligation USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.wip_snapshot ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.wip_snapshot FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.wip_snapshot USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.revenue_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.revenue_event FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.revenue_event USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.connector_contract ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.connector_contract FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.connector_contract USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.webhook_receipt ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.webhook_receipt FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.webhook_receipt USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.dead_letter ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.dead_letter FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.dead_letter USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));

ALTER TABLE nx_market.export_manifest ENABLE ROW LEVEL SECURITY;

ALTER TABLE nx_market.export_manifest FORCE ROW LEVEL SECURITY;

CREATE POLICY market_scope ON nx_market.export_manifest USING (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true)) WITH CHECK (tenant_id::text = current_setting('nx.tenant_id', true) AND node_id::text = current_setting('nx.node_id', true));


ALTER TABLE nx_design.project_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.project_scope FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.actor ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.actor FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.artifact FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.model ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.model FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.quantity_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.quantity_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.catalog_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.catalog_item FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.operation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.operation_result FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.revision FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.analysis FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.bundle FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.element ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.element FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.exchange ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.exchange FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.measurement ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.measurement FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.release_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.release_approval FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.render ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.render FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.sheet ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.sheet FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.terrain ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.terrain FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.view_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.view_state FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.issue FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.quantity ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.quantity FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.share_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.share_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.space ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.space FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.view_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.view_link FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_auth.principal_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_auth.principal_scope FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.revision_seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.revision_seal FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.capability_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.capability_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.operation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.operation_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_design.event_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.event_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.org_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.org_node FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.node_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.node_membership FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.doa_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.doa_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.decision_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.decision_request FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.decision_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.decision_review FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.project_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.project_binding FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.site_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.site_device FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.sync_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.sync_event FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_agent_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_agent_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.governance_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.governance_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.investment_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.investment_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.opportunity_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.opportunity_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.estimate_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.estimate_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.contract_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.contract_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.engineering_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.engineering_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.technical_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.technical_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.controls_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.controls_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.field_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.field_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.supply_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.supply_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.plant_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.plant_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.finance_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.finance_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.workforce_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.workforce_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.security_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.security_work FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.dependency_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.dependency_candidate FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.dependency_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.dependency_release FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_registration FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_pack FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_calculation ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_calculation FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_submission FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.kernel_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.kernel_operation FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.work_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.work_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_head FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_event FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_checkpoint FORCE ROW LEVEL SECURITY;
ALTER TABLE nx_org.protected_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.protected_field FORCE ROW LEVEL SECURITY;
CREATE POLICY round1_closed ON nx_market.boq_item AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.rate_version AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.wbs_activity AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.activity_dependency AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.element_allocation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.contract_notice AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.valuation_line AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.rfi AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.submittal AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.transmittal AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.checklist_template AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.inspection_result AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.punch_item AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.field_escalation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.account AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.fiscal_period AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.journal_header AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.journal_line AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.cost_commitment AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.invoice AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.payment_certificate_line AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.fx_rate AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.merge_policy AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.crdt_operation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.sync_conflict AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.tombstone AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.attachment_chunk AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.sync_checkpoint AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.property AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.building AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.unit AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.price_book AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.reservation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.contact AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.lead_source AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.lead AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.consent AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.lead_assignment AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.lead_activity AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.viewing AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.funnel_stage AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.broker_agreement AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.commission_rule AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.commission_split AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.eligibility_event AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.commission_accrual AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.commission_clawback AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.commission_payout AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.sale_contract AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.installment AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.lease AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.rent_escalation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.deposit AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.receipt_allocation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.arrears AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.unit_handover AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.occupant AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.asset_register AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.warranty AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.service_request AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.service_sla AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.work_order AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.listing AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.portal_entitlement AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.feed_run AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.listing_permit AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.portal_credit_ledger AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.comparable_record AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.valuation_evidence AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.intercompany_match AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.consolidation_run AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.elimination AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.invoice_line AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.receipt AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.match_exception AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.bank_account AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.bank_statement_line AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.payment_proposal AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.reconciliation_match AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.tax_document_line AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.tax_return AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.withholding_event AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.transfer_pricing_adjustment AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.worker AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.employment AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.pay_component AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.pay_run AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.pay_result AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.shift AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.crew_assignment AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.time_entry AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.labor_allocation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.fixed_asset AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.depreciation_run AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.maintenance_order AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.asset_charge AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.performance_obligation AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.wip_snapshot AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.revenue_event AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.connector_contract AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.webhook_receipt AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.dead_letter AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY round1_closed ON nx_market.export_manifest AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY r25_scope ON nx_org.engineering_work AS RESTRICTIVE FOR ALL TO nx_design_client USING (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=engineering_work.tenant_id AND a.node_id=engineering_work.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until)) WITH CHECK (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=engineering_work.tenant_id AND a.node_id=engineering_work.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until));
CREATE POLICY r25_scope ON nx_org.decision_request AS RESTRICTIVE FOR ALL TO nx_design_client USING (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=decision_request.tenant_id AND a.node_id=decision_request.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until)) WITH CHECK (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=decision_request.tenant_id AND a.node_id=decision_request.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until));
CREATE POLICY r25_scope ON nx_org.decision_review AS RESTRICTIVE FOR ALL TO nx_design_client USING (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=decision_review.tenant_id AND a.node_id=decision_review.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until)) WITH CHECK (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=decision_review.tenant_id AND a.node_id=decision_review.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until));
CREATE POLICY r25_scope ON nx_org.tax_calculation AS RESTRICTIVE FOR ALL TO nx_design_client USING (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=tax_calculation.tenant_id AND a.node_id=tax_calculation.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until)) WITH CHECK (EXISTS (SELECT 1 FROM nx_org.role_assignment a WHERE a.tenant_id=tax_calculation.tenant_id AND a.node_id=tax_calculation.node_id AND a.principal_name=session_user AND now() BETWEEN a.valid_from AND a.valid_until));
CREATE FUNCTION nx_org.r25_doa_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reviewer <> session_user OR NOT EXISTS (SELECT 1 FROM nx_org.decision_request d JOIN nx_org.doa_rule r ON r.tenant_id=d.tenant_id AND r.node_id=d.node_id JOIN nx_org.role_assignment a ON a.tenant_id=r.tenant_id AND a.node_id=r.node_id AND a.role_id=r.role_id WHERE d.tenant_id=NEW.tenant_id AND d.node_id=NEW.node_id AND d.decision_id=NEW.decision_id AND r.rule_id=NEW.rule_id AND d.requestor<>NEW.reviewer AND a.principal_name=NEW.reviewer AND d.currency=r.currency AND d.decision_kind=r.decision_kind AND d.amount<=r.maximum_amount AND now() BETWEEN r.valid_from AND r.valid_until AND now() BETWEEN a.valid_from AND a.valid_until) THEN RAISE EXCEPTION 'DOA denied'; END IF; RETURN NEW; END $$;
CREATE TRIGGER r25_doa BEFORE INSERT OR UPDATE ON nx_org.decision_review FOR EACH ROW EXECUTE FUNCTION nx_org.r25_doa_guard();
CREATE FUNCTION nx_org.r25_tax_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM nx_org.tax_pack p JOIN nx_org.tax_rule r ON r.tenant_id=p.tenant_id AND r.node_id=p.node_id AND r.pack_id=p.pack_id WHERE p.tenant_id=NEW.tenant_id AND p.node_id=NEW.node_id AND p.pack_id=NEW.pack_id AND r.rule_id=NEW.rule_id AND p.state='APPROVED' AND p.currency=NEW.currency AND NEW.taxable_date BETWEEN p.rule_effective_from AND p.rule_effective_until) THEN RAISE EXCEPTION 'Tax pack invalid'; END IF; RETURN NEW; END $$;
CREATE TRIGGER r25_tax BEFORE INSERT OR UPDATE ON nx_org.tax_calculation FOR EACH ROW EXECUTE FUNCTION nx_org.r25_tax_guard();

REVOKE ALL ON FUNCTION nx_org.r25_doa_guard(), nx_org.r25_tax_guard() FROM PUBLIC;

ALTER TABLE nx_auth.principal_scope OWNER TO nx_design_owner;
ALTER TABLE nx_design.actor OWNER TO nx_design_owner;
ALTER TABLE nx_design.analysis OWNER TO nx_design_owner;
ALTER TABLE nx_design.artifact OWNER TO nx_design_owner;
ALTER TABLE nx_design.bundle OWNER TO nx_design_owner;
ALTER TABLE nx_design.capability_registry OWNER TO nx_design_owner;
ALTER TABLE nx_design.catalog_item OWNER TO nx_design_owner;
ALTER TABLE nx_design.element OWNER TO nx_design_owner;
ALTER TABLE nx_design.event_delivery OWNER TO nx_design_owner;
ALTER TABLE nx_design.exchange OWNER TO nx_design_owner;
ALTER TABLE nx_design.issue OWNER TO nx_design_owner;
ALTER TABLE nx_design.measurement OWNER TO nx_design_owner;
ALTER TABLE nx_design.model OWNER TO nx_design_owner;
ALTER TABLE nx_design.operation_evidence OWNER TO nx_design_owner;
ALTER TABLE nx_design.operation_result OWNER TO nx_design_owner;
ALTER TABLE nx_design.outbox OWNER TO nx_design_owner;
ALTER TABLE nx_design.project_scope OWNER TO nx_design_owner;
ALTER TABLE nx_design.quantity OWNER TO nx_design_owner;
ALTER TABLE nx_design.quantity_rule OWNER TO nx_design_owner;
ALTER TABLE nx_design.release_approval OWNER TO nx_design_owner;
ALTER TABLE nx_design.render OWNER TO nx_design_owner;
ALTER TABLE nx_design.revision OWNER TO nx_design_owner;
ALTER TABLE nx_design.revision_seal OWNER TO nx_design_owner;
ALTER TABLE nx_design.share_grant OWNER TO nx_design_owner;
ALTER TABLE nx_design.sheet OWNER TO nx_design_owner;
ALTER TABLE nx_design.space OWNER TO nx_design_owner;
ALTER TABLE nx_design.terrain OWNER TO nx_design_owner;
ALTER TABLE nx_design.view_link OWNER TO nx_design_owner;
ALTER TABLE nx_design.view_state OWNER TO nx_design_owner;
ALTER TABLE nx_org.audit_checkpoint OWNER TO nx_design_owner;
ALTER TABLE nx_org.audit_event OWNER TO nx_design_owner;
ALTER TABLE nx_org.audit_head OWNER TO nx_design_owner;
ALTER TABLE nx_org.contract_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.controls_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.decision_request OWNER TO nx_design_owner;
ALTER TABLE nx_org.decision_review OWNER TO nx_design_owner;
ALTER TABLE nx_org.dependency_candidate OWNER TO nx_design_owner;
ALTER TABLE nx_org.dependency_release OWNER TO nx_design_owner;
ALTER TABLE nx_org.doa_rule OWNER TO nx_design_owner;
ALTER TABLE nx_org.engineering_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.estimate_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.field_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.finance_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.governance_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.investment_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.kernel_operation OWNER TO nx_design_owner;
ALTER TABLE nx_org.node_membership OWNER TO nx_design_owner;
ALTER TABLE nx_org.opportunity_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.org_node OWNER TO nx_design_owner;
ALTER TABLE nx_org.plant_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.project_binding OWNER TO nx_design_owner;
ALTER TABLE nx_org.protected_field OWNER TO nx_design_owner;
ALTER TABLE nx_org.role_agent_profile OWNER TO nx_design_owner;
ALTER TABLE nx_org.role_assignment OWNER TO nx_design_owner;
ALTER TABLE nx_org.role_catalog OWNER TO nx_design_owner;
ALTER TABLE nx_org.security_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.site_device OWNER TO nx_design_owner;
ALTER TABLE nx_org.supply_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.sync_event OWNER TO nx_design_owner;
ALTER TABLE nx_org.tax_calculation OWNER TO nx_design_owner;
ALTER TABLE nx_org.tax_pack OWNER TO nx_design_owner;
ALTER TABLE nx_org.tax_registration OWNER TO nx_design_owner;
ALTER TABLE nx_org.tax_rule OWNER TO nx_design_owner;
ALTER TABLE nx_org.tax_submission OWNER TO nx_design_owner;
ALTER TABLE nx_org.technical_work OWNER TO nx_design_owner;
ALTER TABLE nx_org.work_queue OWNER TO nx_design_owner;
ALTER TABLE nx_org.workforce_work OWNER TO nx_design_owner;
SET ROLE nx_design_owner;
-- Fresh database / dedicated migration principal only. Do not run on production.
-- Database principals are individually authenticated; no end-user arbitrary SQL via a shared service login.
REVOKE ALL ON SCHEMA nx_design FROM PUBLIC;
REVOKE ALL ON SCHEMA nx_auth FROM PUBLIC;
CREATE INDEX ix_catalog_item_2 ON nx_design.catalog_item (tenant_id,project_id,source_artifact_id);
CREATE INDEX ix_revision_3 ON nx_design.revision (tenant_id,project_id,created_by);
CREATE INDEX ix_analysis_2 ON nx_design.analysis (tenant_id,project_id,artifact_id);
CREATE INDEX ix_bundle_2 ON nx_design.bundle (tenant_id,project_id,manifest_artifact_id);
CREATE INDEX ix_exchange_2 ON nx_design.exchange (tenant_id,project_id,artifact_id);
CREATE INDEX ix_outbox_1 ON nx_design.outbox (tenant_id,project_id,revision_id);
CREATE INDEX ix_release_approval_2 ON nx_design.release_approval (tenant_id,project_id,approver_id);
CREATE INDEX ix_render_2 ON nx_design.render (tenant_id,project_id,artifact_id);
CREATE INDEX ix_terrain_2 ON nx_design.terrain (tenant_id,project_id,artifact_id);
CREATE INDEX ix_view_state_2 ON nx_design.view_state (tenant_id,project_id,actor_id);
CREATE INDEX ix_issue_2 ON nx_design.issue (tenant_id,project_id,revision_id,element_id);
CREATE INDEX ix_issue_3 ON nx_design.issue (tenant_id,project_id,revision_id,view_id);
CREATE INDEX ix_quantity_1 ON nx_design.quantity (tenant_id,project_id,revision_id,element_id);
CREATE INDEX ix_quantity_2 ON nx_design.quantity (tenant_id,project_id,rule_version_id);
CREATE INDEX ix_share_grant_2 ON nx_design.share_grant (tenant_id,project_id,revision_id,bundle_id);
CREATE INDEX ix_share_grant_3 ON nx_design.share_grant (tenant_id,project_id,recipient_id);
CREATE INDEX ix_space_2 ON nx_design.space (tenant_id,project_id,revision_id,element_id);
CREATE INDEX ix_view_link_1 ON nx_design.view_link (tenant_id,project_id,revision_id,sheet_id);
CREATE INDEX ix_view_link_2 ON nx_design.view_link (tenant_id,project_id,revision_id,element_id);

CREATE INDEX ix_principal_scope_actor ON nx_auth.principal_scope (tenant_id,project_id,actor_id);
CREATE INDEX ix_revision_seal_actor ON nx_design.revision_seal (tenant_id,project_id,sealed_by);
CREATE INDEX ix_operation_evidence_revision ON nx_design.operation_evidence (tenant_id,project_id,revision_id);
CREATE INDEX ix_operation_evidence_artifact ON nx_design.operation_evidence (tenant_id,project_id,result_artifact_id);
CREATE INDEX ix_operation_evidence_contract ON nx_design.operation_evidence (capability_id,contract_sha256);
CREATE FUNCTION nx_auth.scope_allowed(p_t uuid,p_p uuid,p_mode text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM nx_auth.principal_scope AS a WHERE a.principal_name=session_user AND a.tenant_id=p_t AND a.project_id=p_p AND a.can_read AND CASE p_mode WHEN 'READ' THEN true WHEN 'WRITE' THEN a.can_write WHEN 'REVIEW' THEN a.can_review WHEN 'PUBLISH' THEN a.can_publish WHEN 'LOCK' THEN (a.can_write OR a.can_review OR a.can_publish) ELSE false END);
$$;
CREATE FUNCTION nx_auth.actor_matches(p_t uuid,p_p uuid,p_actor uuid,p_mode text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT nx_auth.scope_allowed(p_t,p_p,p_mode) AND EXISTS (SELECT 1 FROM nx_auth.principal_scope AS a WHERE a.principal_name=session_user AND a.tenant_id=p_t AND a.project_id=p_p AND a.actor_id=p_actor);
$$;
REVOKE ALL ON FUNCTION nx_auth.scope_allowed(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nx_auth.actor_matches(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA nx_auth,nx_design TO nx_design_client;
GRANT EXECUTE ON FUNCTION nx_auth.scope_allowed(uuid,uuid,text) TO nx_design_client;
GRANT EXECUTE ON FUNCTION nx_auth.actor_matches(uuid,uuid,uuid,text) TO nx_design_client;

ALTER TABLE nx_design.project_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.project_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.project_scope FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
ALTER TABLE nx_design.actor ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.actor FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.actor FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
ALTER TABLE nx_design.artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.artifact FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.artifact FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.model ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.model FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.model FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.model FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.quantity_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.quantity_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.quantity_rule FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.quantity_rule FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.catalog_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.catalog_item FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.catalog_item FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.catalog_item FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.operation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.operation_result FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.operation_result FOR SELECT USING (nx_auth.actor_matches(tenant_id,project_id,actor_id,'READ'));
CREATE POLICY p_insert ON nx_design.operation_result FOR INSERT WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,actor_id,'WRITE'));
ALTER TABLE nx_design.revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.revision FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.revision FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.revision FOR INSERT WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,created_by,'WRITE'));
CREATE POLICY p_revision_lock ON nx_design.revision FOR UPDATE TO nx_design_owner USING (nx_auth.scope_allowed(tenant_id,project_id,'LOCK')) WITH CHECK (false);
ALTER TABLE nx_design.analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.analysis FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.analysis FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.analysis FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.analysis FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.bundle FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.bundle FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.bundle FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.bundle FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.element ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.element FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.element FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.element FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.element FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.element FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.exchange ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.exchange FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.exchange FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.exchange FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.exchange FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.exchange FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.measurement ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.measurement FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.measurement FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.measurement FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.measurement FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.measurement FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.outbox FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.outbox FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.release_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.release_approval FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.release_approval FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.release_approval FOR INSERT WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,approver_id,'REVIEW'));
ALTER TABLE nx_design.render ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.render FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.render FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.render FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.render FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.render FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.sheet ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.sheet FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.sheet FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.sheet FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.sheet FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.sheet FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.terrain ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.terrain FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.terrain FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.terrain FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.terrain FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.terrain FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.view_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.view_state FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.view_state FOR SELECT USING ((nx_auth.scope_allowed(tenant_id,project_id,'READ') AND (visibility='PROJECT' OR nx_auth.actor_matches(tenant_id,project_id,actor_id,'READ'))));
CREATE POLICY p_insert ON nx_design.view_state FOR INSERT WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,actor_id,'WRITE'));
CREATE POLICY p_update ON nx_design.view_state FOR UPDATE USING (nx_auth.actor_matches(tenant_id,project_id,actor_id,'WRITE')) WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,actor_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.view_state FOR DELETE USING (nx_auth.actor_matches(tenant_id,project_id,actor_id,'WRITE'));
ALTER TABLE nx_design.issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.issue FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.issue FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.issue FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.issue FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.issue FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.quantity ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.quantity FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.quantity FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.quantity FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.quantity FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.quantity FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.share_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.share_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.share_grant FOR SELECT USING ((nx_auth.actor_matches(tenant_id,project_id,recipient_id,'READ') OR nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH')));
CREATE POLICY p_insert ON nx_design.share_grant FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH'));
CREATE POLICY p_update ON nx_design.share_grant FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH'));
ALTER TABLE nx_design.space ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.space FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.space FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.space FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.space FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.space FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.view_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.view_link FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.view_link FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.view_link FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_update ON nx_design.view_link FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
CREATE POLICY p_delete ON nx_design.view_link FOR DELETE USING (nx_auth.scope_allowed(tenant_id,project_id,'WRITE'));
ALTER TABLE nx_design.revision_seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.revision_seal FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.revision_seal FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.revision_seal FOR INSERT WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,sealed_by,'PUBLISH'));
ALTER TABLE nx_design.operation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.operation_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.operation_evidence FOR SELECT USING (nx_auth.actor_matches(tenant_id,project_id,actor_id,'READ'));
CREATE POLICY p_insert ON nx_design.operation_evidence FOR INSERT WITH CHECK (nx_auth.actor_matches(tenant_id,project_id,actor_id,'WRITE'));
ALTER TABLE nx_design.event_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_design.event_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_design.event_delivery FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_insert ON nx_design.event_delivery FOR INSERT WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH'));
CREATE POLICY p_update ON nx_design.event_delivery FOR UPDATE USING (nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH')) WITH CHECK (nx_auth.scope_allowed(tenant_id,project_id,'PUBLISH'));

CREATE FUNCTION nx_design.reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'immutable record' USING ERRCODE = '23514';
END;
$$;
CREATE FUNCTION nx_design.guard_revision_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_t uuid; v_p uuid; v_r uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  v_t := OLD.tenant_id; v_p := OLD.project_id; v_r := OLD.revision_id;
 ELSE
  v_t := NEW.tenant_id; v_p := NEW.project_id; v_r := NEW.revision_id;
  IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.project_id,NEW.revision_id) IS DISTINCT FROM (OLD.tenant_id,OLD.project_id,OLD.revision_id) THEN
   RAISE EXCEPTION 'revision scope is immutable' USING ERRCODE = '23514';
  END IF;
 END IF;
 PERFORM 1 FROM nx_design.revision WHERE tenant_id=v_t AND project_id=v_p AND revision_id=v_r FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'revision unavailable' USING ERRCODE = '23503'; END IF;
 IF EXISTS (SELECT 1 FROM nx_design.revision_seal WHERE tenant_id=v_t AND project_id=v_p AND revision_id=v_r) THEN
  RAISE EXCEPTION 'sealed revision' USING ERRCODE = '23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION nx_design.seal_revision(p_t uuid,p_p uuid,p_r uuid,p_actor uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_hash text;
BEGIN
 IF NOT nx_auth.actor_matches(p_t,p_p,p_actor,'PUBLISH') THEN RAISE EXCEPTION 'publisher required' USING ERRCODE = '42501'; END IF;
 SELECT content_sha256 INTO v_hash FROM nx_design.revision WHERE tenant_id=p_t AND project_id=p_p AND revision_id=p_r FOR UPDATE;
 IF NOT FOUND OR v_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'revision manifest mismatch' USING ERRCODE = '23514'; END IF;
 INSERT INTO nx_design.revision_seal(tenant_id,project_id,revision_id,sealed_by,manifest_sha256) VALUES(p_t,p_p,p_r,p_actor,p_hash);
END;
$$;
CREATE FUNCTION nx_design.guard_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF NOT nx_auth.actor_matches(NEW.tenant_id,NEW.project_id,NEW.approver_id,'REVIEW') THEN RAISE EXCEPTION 'eligible reviewer required' USING ERRCODE = '42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM nx_design.revision_seal WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND revision_id=NEW.revision_id) THEN RAISE EXCEPTION 'sealed revision required' USING ERRCODE = '23514'; END IF;
 IF EXISTS (SELECT 1 FROM nx_design.revision WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND revision_id=NEW.revision_id AND created_by=NEW.approver_id) THEN RAISE EXCEPTION 'self approval forbidden' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION nx_design.guard_issue_view() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM nx_design.view_state WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND revision_id=NEW.revision_id AND view_id=NEW.view_id AND visibility='PROJECT') THEN RAISE EXCEPTION 'shared issue view required' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nx_design.reject_immutable_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION nx_design.guard_revision_child() FROM PUBLIC;
REVOKE ALL ON FUNCTION nx_design.seal_revision(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nx_design.guard_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION nx_design.guard_issue_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nx_design.seal_revision(uuid,uuid,uuid,uuid,text) TO nx_design_client;
CREATE TRIGGER review_eligibility BEFORE INSERT ON nx_design.release_approval FOR EACH ROW EXECUTE FUNCTION nx_design.guard_approval();
CREATE TRIGGER issue_shared_view BEFORE INSERT OR UPDATE ON nx_design.issue FOR EACH ROW EXECUTE FUNCTION nx_design.guard_issue_view();
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON nx_design.revision FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_release_approval BEFORE UPDATE OR DELETE ON nx_design.release_approval FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_revision_seal BEFORE UPDATE OR DELETE ON nx_design.revision_seal FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_artifact BEFORE UPDATE OR DELETE ON nx_design.artifact FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_quantity_rule BEFORE UPDATE OR DELETE ON nx_design.quantity_rule FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_operation_result BEFORE UPDATE OR DELETE ON nx_design.operation_result FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_operation_evidence BEFORE UPDATE OR DELETE ON nx_design.operation_evidence FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER immutable_outbox BEFORE UPDATE OR DELETE ON nx_design.outbox FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER sealed_analysis BEFORE INSERT OR UPDATE OR DELETE ON nx_design.analysis FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_bundle BEFORE INSERT OR UPDATE OR DELETE ON nx_design.bundle FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_element BEFORE INSERT OR UPDATE OR DELETE ON nx_design.element FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_exchange BEFORE INSERT OR UPDATE OR DELETE ON nx_design.exchange FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_render BEFORE INSERT OR UPDATE OR DELETE ON nx_design.render FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_sheet BEFORE INSERT OR UPDATE OR DELETE ON nx_design.sheet FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_terrain BEFORE INSERT OR UPDATE OR DELETE ON nx_design.terrain FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_quantity BEFORE INSERT OR UPDATE OR DELETE ON nx_design.quantity FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_space BEFORE INSERT OR UPDATE OR DELETE ON nx_design.space FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();
CREATE TRIGGER sealed_view_link BEFORE INSERT OR UPDATE OR DELETE ON nx_design.view_link FOR EACH ROW EXECUTE FUNCTION nx_design.guard_revision_child();

REVOKE ALL ON ALL TABLES IN SCHEMA nx_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nx_design FROM PUBLIC;
GRANT SELECT ON nx_design.project_scope TO nx_design_client;
GRANT SELECT ON nx_design.actor TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.artifact TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.model TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.quantity_rule TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.catalog_item TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.operation_result TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.revision TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.analysis TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.bundle TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.element TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.exchange TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.measurement TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.outbox TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.release_approval TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.render TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.sheet TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.terrain TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.view_state TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.issue TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.quantity TO nx_design_client;
GRANT SELECT,INSERT,UPDATE ON nx_design.share_grant TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.space TO nx_design_client;
GRANT SELECT,INSERT,UPDATE,DELETE ON nx_design.view_link TO nx_design_client;
GRANT SELECT ON nx_design.revision_seal TO nx_design_client;
GRANT SELECT ON nx_design.capability_registry TO nx_design_client;
GRANT SELECT,INSERT ON nx_design.operation_evidence TO nx_design_client;
GRANT SELECT ON nx_design.event_delivery TO nx_design_client;

-- Additive migration after verified TURN 1/2 design schema; execute as authorized migration principal.
REVOKE ALL ON SCHEMA nx_org FROM PUBLIC;
CREATE INDEX ix_org_parent ON nx_org.org_node(tenant_id,parent_id,parent_kind);
CREATE INDEX ix_membership_node ON nx_org.node_membership(tenant_id,node_id);
CREATE INDEX ix_assignment_role ON nx_org.role_assignment(role_id);
CREATE INDEX ix_doa_role ON nx_org.doa_rule(role_id);
CREATE INDEX ix_review_rule ON nx_org.decision_review(tenant_id,node_id,rule_id);
CREATE INDEX ix_binding_project ON nx_org.project_binding(tenant_id,project_id);
CREATE INDEX ix_device_actor ON nx_org.site_device(tenant_id,project_id,actor_id);
CREATE INDEX ix_sync_revision ON nx_org.sync_event(tenant_id,project_id,base_revision_id);
CREATE INDEX ix_sync_artifact ON nx_org.sync_event(tenant_id,project_id,artifact_id);
CREATE FUNCTION nx_org.node_read(p_t uuid,p_n uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM nx_org.node_membership AS m WHERE m.principal_name=session_user AND m.tenant_id=p_t AND m.node_id=p_n AND m.can_read);
$$;
REVOKE ALL ON FUNCTION nx_org.node_read(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nx_org.node_read(uuid,uuid) TO nx_design_client;
GRANT USAGE ON SCHEMA nx_org TO nx_design_client;
-- All mutations are deliberately withheld from clients; service-side command authorization contract is not implemented by this DDL.
ALTER TABLE nx_org.org_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.org_node FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.org_node FOR SELECT USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY p_owner_read ON nx_org.org_node FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.org_node FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.org_node TO nx_design_client;
ALTER TABLE nx_org.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.role_assignment FOR SELECT USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY p_owner_read ON nx_org.role_assignment FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.role_assignment FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.role_assignment TO nx_design_client;
ALTER TABLE nx_org.doa_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.doa_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.doa_rule FOR SELECT USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY p_owner_read ON nx_org.doa_rule FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.doa_rule FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.doa_rule TO nx_design_client;
ALTER TABLE nx_org.decision_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.decision_request FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.decision_request FOR SELECT USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY p_owner_read ON nx_org.decision_request FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.decision_request FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.decision_request TO nx_design_client;
ALTER TABLE nx_org.decision_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.decision_review FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.decision_review FOR SELECT USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY p_owner_read ON nx_org.decision_review FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.decision_review FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.decision_review TO nx_design_client;
ALTER TABLE nx_org.project_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.project_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.project_binding FOR SELECT USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY p_owner_read ON nx_org.project_binding FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.project_binding FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.project_binding TO nx_design_client;
ALTER TABLE nx_org.site_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.site_device FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.site_device FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_owner_read ON nx_org.site_device FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.site_device FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.site_device TO nx_design_client;
ALTER TABLE nx_org.sync_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.sync_event FORCE ROW LEVEL SECURITY;
CREATE POLICY p_read ON nx_org.sync_event FOR SELECT USING (nx_auth.scope_allowed(tenant_id,project_id,'READ'));
CREATE POLICY p_owner_read ON nx_org.sync_event FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY p_owner_insert ON nx_org.sync_event FOR INSERT TO nx_design_owner WITH CHECK (true);
GRANT SELECT ON nx_org.sync_event TO nx_design_client;
REVOKE ALL ON nx_org.node_membership FROM PUBLIC;
GRANT SELECT ON nx_org.role_catalog TO nx_design_client;
CREATE FUNCTION nx_org.guard_decision_review() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
 DECLARE v_requestor name; v_eligible boolean;
 BEGIN
 SELECT d.requestor INTO v_requestor FROM nx_org.decision_request AS d WHERE d.tenant_id=NEW.tenant_id AND d.node_id=NEW.node_id AND d.decision_id=NEW.decision_id FOR UPDATE;
 IF v_requestor IS NULL OR v_requestor=NEW.reviewer OR NEW.reviewer<>session_user THEN RAISE EXCEPTION 'self approval or impersonation forbidden' USING ERRCODE = '23514'; END IF;
 SELECT EXISTS (SELECT 1 FROM nx_org.doa_rule AS r WHERE r.tenant_id=NEW.tenant_id AND r.node_id=NEW.node_id AND r.rule_id=NEW.rule_id AND r.valid_from<=now() AND r.valid_until>now() AND EXISTS (SELECT 1 FROM nx_org.decision_request AS d WHERE d.tenant_id=r.tenant_id AND d.node_id=r.node_id AND d.decision_id=NEW.decision_id AND d.decision_kind=r.decision_kind AND d.currency=r.currency AND d.amount<=r.maximum_amount) AND EXISTS (SELECT 1 FROM nx_org.role_assignment AS a WHERE a.tenant_id=r.tenant_id AND a.node_id=r.node_id AND a.role_id=r.role_id AND a.principal_name=session_user AND a.valid_from<=now() AND a.valid_until>now()) AND EXISTS (SELECT 1 FROM nx_org.role_catalog AS c WHERE c.role_id=r.role_id AND c.authority='DELEGATED')) INTO v_eligible;
 IF NOT v_eligible OR NOT nx_org.node_read(NEW.tenant_id,NEW.node_id) THEN RAISE EXCEPTION 'delegation missing or exceeded' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
 END;
$$;
REVOKE ALL ON FUNCTION nx_org.guard_decision_review() FROM PUBLIC;
CREATE TRIGGER trg_decision_review BEFORE INSERT ON nx_org.decision_review FOR EACH ROW EXECUTE FUNCTION nx_org.guard_decision_review();
CREATE TRIGGER trg_decision_review_immutable BEFORE UPDATE OR DELETE ON nx_org.decision_review FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE FUNCTION nx_org.record_decision_review(p_t uuid,p_n uuid,p_d uuid,p_review uuid,p_rule uuid,p_result text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
 BEGIN
 INSERT INTO nx_org.decision_review(tenant_id,node_id,decision_id,review_id,rule_id,reviewer,disposition) VALUES(p_t,p_n,p_d,p_review,p_rule,session_user,p_result);
 RETURN;
 END;
$$;
REVOKE ALL ON FUNCTION nx_org.record_decision_review(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nx_org.record_decision_review(uuid,uuid,uuid,uuid,uuid,text) TO nx_design_client;

-- NEXORA TURN4 enterprise extension. Fresh build after DESIGN_STORAGE_BLUEPRINT.sql and the preserved TURN3 ENTERPRISE_EXTENSION.sql.
-- Execute only as authorized migration administrator. Application principals are not schema owners.
REVOKE ALL ON SCHEMA nx_crypto FROM PUBLIC;
CREATE INDEX ix_t4_governance_work_1 ON nx_org.governance_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_investment_work_1 ON nx_org.investment_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_opportunity_work_1 ON nx_org.opportunity_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_estimate_work_1 ON nx_org.estimate_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_contract_work_1 ON nx_org.contract_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_engineering_work_1 ON nx_org.engineering_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_technical_work_1 ON nx_org.technical_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_controls_work_1 ON nx_org.controls_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_field_work_1 ON nx_org.field_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_supply_work_1 ON nx_org.supply_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_plant_work_1 ON nx_org.plant_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_finance_work_1 ON nx_org.finance_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_workforce_work_1 ON nx_org.workforce_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_security_work_1 ON nx_org.security_work(tenant_id,node_id,assignment_id);
CREATE INDEX ix_t4_dependency_release_1 ON nx_org.dependency_release(tenant_id,node_id,decision_id);
CREATE INDEX ix_t4_tax_pack_1 ON nx_org.tax_pack(tenant_id,node_id,approval_decision_id);
CREATE INDEX ix_t4_tax_calculation_1 ON nx_org.tax_calculation(tenant_id,node_id,pack_id,rule_id);
CREATE INDEX ix_t4_tax_submission_1 ON nx_org.tax_submission(tenant_id,node_id,calc_id);
CREATE INDEX ix_t4_tax_submission_2 ON nx_org.tax_submission(tenant_id,node_id,approval_decision_id);
CREATE INDEX ix_t4_kernel_operation_1 ON nx_org.kernel_operation(tenant_id,project_id,revision_id);
CREATE INDEX ix_t4_kernel_operation_2 ON nx_org.kernel_operation(tenant_id,project_id,input_artifact_id);
CREATE INDEX ix_t4_kernel_operation_3 ON nx_org.kernel_operation(tenant_id,project_id,output_artifact_id);
CREATE INDEX ix_t4_work_queue_1 ON nx_org.work_queue(tenant_id,node_id,state,ready_at,job_id);
CREATE INDEX ix_t4_work_queue_2 ON nx_org.work_queue(tenant_id,node_id,state,lease_until,job_id);
ALTER TABLE nx_org.role_agent_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.role_agent_profile FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.role_agent_profile FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.role_agent_profile FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.role_agent_profile FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.governance_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.governance_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.governance_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.governance_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.governance_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.investment_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.investment_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.investment_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.investment_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.investment_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.opportunity_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.opportunity_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.opportunity_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.opportunity_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.opportunity_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.estimate_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.estimate_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.estimate_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.estimate_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.estimate_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.contract_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.contract_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.contract_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.contract_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.contract_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.engineering_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.engineering_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.engineering_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.engineering_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.engineering_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.technical_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.technical_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.technical_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.technical_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.technical_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.controls_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.controls_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.controls_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.controls_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.controls_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.field_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.field_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.field_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.field_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.field_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.supply_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.supply_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.supply_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.supply_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.supply_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.plant_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.plant_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.plant_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.plant_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.plant_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.finance_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.finance_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.finance_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.finance_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.finance_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.workforce_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.workforce_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.workforce_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.workforce_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.workforce_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.security_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.security_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.security_work FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.security_work FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.security_work FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.dependency_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.dependency_candidate FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.dependency_candidate FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.dependency_candidate FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.dependency_candidate FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.dependency_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.dependency_release FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.dependency_release FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.dependency_release FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.dependency_release FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.tax_registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_registration FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.tax_registration FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.tax_registration FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.tax_registration FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.tax_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_pack FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.tax_pack FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.tax_pack FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.tax_pack FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.tax_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_rule FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.tax_rule FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.tax_rule FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.tax_rule FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.tax_calculation ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_calculation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.tax_calculation FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.tax_calculation FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.tax_calculation FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.tax_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.tax_submission FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.tax_submission FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.tax_submission FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.tax_submission FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.kernel_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.kernel_operation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.kernel_operation FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.kernel_operation FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.kernel_operation FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.work_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.work_queue FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.work_queue FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.work_queue FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.work_queue FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.audit_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_head FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.audit_head FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.audit_head FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.audit_head FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_event FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.audit_event FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.audit_event FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.audit_event FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.audit_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.audit_checkpoint FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.audit_checkpoint FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.audit_checkpoint FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.audit_checkpoint FOR INSERT TO nx_design_owner WITH CHECK (true);
ALTER TABLE nx_org.protected_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.protected_field FORCE ROW LEVEL SECURITY;
REVOKE ALL ON nx_org.protected_field FROM PUBLIC;
CREATE POLICY t4_owner_read ON nx_org.protected_field FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY t4_owner_insert ON nx_org.protected_field FOR INSERT TO nx_design_owner WITH CHECK (true);
CREATE POLICY t4_owner_update ON nx_org.work_queue FOR UPDATE TO nx_design_owner USING (true) WITH CHECK (true);
CREATE POLICY t4_owner_update ON nx_org.audit_head FOR UPDATE TO nx_design_owner USING (true) WITH CHECK (true);
CREATE TRIGGER trg_t4_audit_event_immutable BEFORE UPDATE OR DELETE ON nx_org.audit_event FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER trg_t4_audit_checkpoint_immutable BEFORE UPDATE OR DELETE ON nx_org.audit_checkpoint FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER trg_t4_dependency_release_immutable BEFORE UPDATE OR DELETE ON nx_org.dependency_release FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER trg_t4_tax_calculation_immutable BEFORE UPDATE OR DELETE ON nx_org.tax_calculation FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();

-- Authorized worker identity comes from session_user, never from caller-supplied identity.
-- Role-specific membership must be provisioned separately; node_read alone is not sufficient for business-domain actions.
CREATE FUNCTION nx_org.claim_work(p_t uuid,p_n uuid,p_token uuid,p_lease_seconds integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 IF p_t IS NULL OR p_n IS NULL OR p_token IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds<1 OR p_lease_seconds>300 OR NOT nx_org.node_read(p_t,p_n) THEN RAISE EXCEPTION 'worker scope or lease denied' USING ERRCODE='42501'; END IF;
 UPDATE nx_org.work_queue SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE tenant_id=p_t AND node_id=p_n AND state='LEASED' AND lease_until<=clock_timestamp() AND attempts>=max_attempts;
 SELECT q.job_id INTO v_id FROM nx_org.work_queue AS q WHERE q.tenant_id=p_t AND q.node_id=p_n AND q.attempts<q.max_attempts AND ((q.state='PENDING' AND q.ready_at<=clock_timestamp()) OR (q.state='LEASED' AND q.lease_until<=clock_timestamp())) ORDER BY q.ready_at,q.job_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 UPDATE nx_org.work_queue SET state='LEASED',attempts=attempts+1,fence=fence+1,lease_token=p_token,lease_owner=session_user,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds) WHERE tenant_id=p_t AND node_id=p_n AND job_id=v_id;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION nx_org.claim_work(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA nx_org TO nx_queue_worker;
GRANT EXECUTE ON FUNCTION nx_org.claim_work(uuid,uuid,uuid,integer) TO nx_queue_worker;
CREATE FUNCTION nx_org.finish_work(p_t uuid,p_n uuid,p_job uuid,p_token uuid,p_fence bigint,p_result text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_ok boolean;
BEGIN
 IF NOT nx_org.node_read(p_t,p_n) OR p_result IS NULL OR p_result !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'worker scope or digest denied' USING ERRCODE='42501'; END IF;
 UPDATE nx_org.work_queue SET state='DONE',result_sha256=p_result,lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE tenant_id=p_t AND node_id=p_n AND job_id=p_job AND state='LEASED' AND lease_token=p_token AND lease_owner=session_user AND fence=p_fence AND lease_until>clock_timestamp() RETURNING true INTO v_ok;
 RETURN COALESCE(v_ok,false);
END;
$$;
REVOKE ALL ON FUNCTION nx_org.finish_work(uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nx_org.finish_work(uuid,uuid,uuid,uuid,bigint,text) TO nx_queue_worker;
CREATE FUNCTION nx_org.read_work_fence(p_t uuid,p_n uuid,p_job uuid,p_token uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT q.fence FROM nx_org.work_queue AS q WHERE q.tenant_id=p_t AND q.node_id=p_n AND q.job_id=p_job AND q.lease_token=p_token AND q.state='LEASED' AND q.lease_owner=session_user AND q.lease_until>clock_timestamp() AND nx_org.node_read(p_t,p_n);
$$;
REVOKE ALL ON FUNCTION nx_org.read_work_fence(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nx_org.read_work_fence(uuid,uuid,uuid,uuid) TO nx_queue_worker;
-- Owner-only audit writer. Do not grant to generic application client. Canonical bytes are stored verbatim, so verification does not depend on later JSON serialization.
CREATE FUNCTION nx_org.append_audit(p_t uuid,p_n uuid,p_event uuid,p_type text,p_evidence text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_seq bigint; v_prev text; v_canonical text; v_hash text; v_existing text; v_time timestamptz;
BEGIN
 IF NOT nx_org.node_read(p_t,p_n) OR p_event IS NULL OR p_type IS NULL OR p_evidence IS NULL OR p_evidence !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'audit scope or input denied' USING ERRCODE='42501'; END IF;
 SELECT h.last_seq,h.last_hash INTO v_seq,v_prev FROM nx_org.audit_head AS h WHERE h.tenant_id=p_t AND h.node_id=p_n FOR UPDATE;
 IF v_seq IS NULL THEN RAISE EXCEPTION 'audit genesis missing' USING ERRCODE='23514'; END IF;
 SELECT e.event_hash INTO v_existing FROM nx_org.audit_event AS e WHERE e.tenant_id=p_t AND e.node_id=p_n AND e.event_id=p_event;
 IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'duplicate audit event id; reconcile existing digest' USING ERRCODE='23505'; END IF;
 v_seq:=v_seq+1;
 v_time:=clock_timestamp();
 v_canonical:=jsonb_build_object('version',1,'tenant_id',p_t,'node_id',p_n,'sequence',v_seq,'event_id',p_event,'actor',session_user,'event_type',p_type,'evidence_sha256',p_evidence,'recorded_at_utc',to_char(v_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'previous_hash',v_prev)::text;
 v_hash:=encode(nx_crypto.digest(convert_to(v_canonical,'UTF8'),'sha256'),'hex');
 INSERT INTO nx_org.audit_event(tenant_id,node_id,sequence_no,event_id,actor_name,event_type,evidence_sha256,previous_hash,event_hash,canonical_record,recorded_at) VALUES(p_t,p_n,v_seq,p_event,session_user,p_type,p_evidence,v_prev,v_hash,v_canonical,v_time);
 UPDATE nx_org.audit_head SET last_seq=v_seq,last_hash=v_hash WHERE tenant_id=p_t AND node_id=p_n;
 RETURN v_hash;
END;
$$;
REVOKE ALL ON FUNCTION nx_org.append_audit(uuid,uuid,uuid,text,text) FROM PUBLIC;
-- Optional pgcrypto server-side envelope for approved threat model only: key delivered by trusted KMS broker, never persisted/logged. For hostile DBA threat model use app-side AEAD instead.
CREATE FUNCTION nx_org.encrypt_protected_field(p_t uuid,p_n uuid,p_field uuid,p_key_id text,p_purpose text,p_plain text,p_kms_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF NOT nx_org.node_read(p_t,p_n) OR p_kms_key IS NULL OR length(p_kms_key)<32 OR p_plain IS NULL THEN RAISE EXCEPTION 'protected field scope or key denied' USING ERRCODE='42501'; END IF;
 INSERT INTO nx_org.protected_field(tenant_id,node_id,field_id,key_id,purpose_code,ciphertext) VALUES(p_t,p_n,p_field,p_key_id,p_purpose,nx_crypto.pgp_sym_encrypt(jsonb_build_object('tenant_id',p_t,'node_id',p_n,'field_id',p_field,'purpose',p_purpose,'value',p_plain)::text,p_kms_key,'cipher-algo=aes256,compress-algo=0'));
 RETURN;
END;
$$;
REVOKE ALL ON FUNCTION nx_org.encrypt_protected_field(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
-- Licensing trigger: no GPL/AGPL release through a permissive route. A commercial override must document a separate grant and independent decision; no automatic override.
CREATE FUNCTION nx_org.guard_dependency_release() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_license text; v_mode text; v_complete boolean; v_approved boolean;
BEGIN
 SELECT c.SPDX_expression,c.distribution_mode,c.dependency_tree_complete INTO v_license,v_mode,v_complete FROM nx_org.dependency_candidate AS c WHERE c.tenant_id=NEW.tenant_id AND c.node_id=NEW.node_id AND c.component_id=NEW.component_id FOR UPDATE;
 IF NOT COALESCE(v_complete,false) THEN RAISE EXCEPTION 'unverified dependency tree' USING ERRCODE='23514'; END IF;
 IF NEW.approved_by<>session_user THEN RAISE EXCEPTION 'licensing reviewer impersonation' USING ERRCODE='42501'; END IF;
 IF NEW.decision_rule='PERMISSIVE' AND v_license NOT IN ('MIT','Apache-2.0','BSD-3-Clause') THEN RAISE EXCEPTION 'SPDX not allowlisted' USING ERRCODE='23514'; END IF;
 IF NEW.decision_rule='COMMERCIAL_OVERRIDE' AND v_license NOT LIKE 'LicenseRef-Commercial-%' THEN RAISE EXCEPTION 'separate commercial entitlement required' USING ERRCODE='23514'; END IF;
 IF NEW.decision_rule='LGPL21_DYNAMIC' AND (v_license NOT IN ('LGPL-2.1-only','LGPL-2.1-only WITH OCCT-exception-1.0') OR v_mode<>'DYNAMIC') THEN RAISE EXCEPTION 'LGPL mode or version denied' USING ERRCODE='23514'; END IF;
 SELECT EXISTS (SELECT 1 FROM nx_org.decision_request AS d JOIN nx_org.decision_review AS r ON r.tenant_id=d.tenant_id AND r.node_id=d.node_id AND r.decision_id=d.decision_id WHERE d.tenant_id=NEW.tenant_id AND d.node_id=NEW.node_id AND d.decision_id=NEW.decision_id AND d.decision_kind='DEPENDENCY_RELEASE' AND d.evidence_sha256=NEW.legal_evidence_sha256 AND r.disposition='APPROVE' AND r.reviewer<>d.requestor AND r.reviewer=NEW.approved_by) INTO v_approved;
 IF NOT v_approved THEN RAISE EXCEPTION 'independent legal decision missing' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION nx_org.guard_dependency_release() FROM PUBLIC;
CREATE TRIGGER trg_t4_dependency_release_guard BEFORE INSERT ON nx_org.dependency_release FOR EACH ROW EXECUTE FUNCTION nx_org.guard_dependency_release();
CREATE TRIGGER trg_t4_dependency_candidate_immutable BEFORE UPDATE OR DELETE ON nx_org.dependency_candidate FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
-- Rule packs are immutable rows. Correct by inserting a new version. Activation and statutory review remain service policy gates.
CREATE TRIGGER trg_t4_tax_rule_immutable BEFORE UPDATE OR DELETE ON nx_org.tax_rule FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();
CREATE TRIGGER trg_t4_tax_pack_immutable BEFORE UPDATE OR DELETE ON nx_org.tax_pack FOR EACH ROW EXECUTE FUNCTION nx_design.reject_immutable_mutation();

CREATE POLICY restored_owner_access ON nx_auth.principal_scope FOR ALL TO nx_design_owner USING (true) WITH CHECK (true);
CREATE POLICY restored_owner_access ON nx_design.capability_registry FOR ALL TO nx_design_owner USING (true) WITH CHECK (true);
CREATE POLICY restored_catalog_read ON nx_design.capability_registry FOR SELECT TO nx_design_client USING (true);
CREATE POLICY restored_owner_access ON nx_org.node_membership FOR ALL TO nx_design_owner USING (true) WITH CHECK (true);
CREATE POLICY restored_owner_access ON nx_org.role_catalog FOR ALL TO nx_design_owner USING (true) WITH CHECK (true);
CREATE POLICY restored_catalog_read ON nx_org.role_catalog FOR SELECT TO nx_design_client USING (true);
CREATE POLICY restored_owner_provision ON nx_design.project_scope FOR INSERT TO nx_design_owner WITH CHECK (true);
CREATE POLICY restored_owner_provision ON nx_design.actor FOR INSERT TO nx_design_owner WITH CHECK (true);
CREATE POLICY restored_owner_lock ON nx_org.decision_request FOR UPDATE TO nx_design_owner USING (true) WITH CHECK (false);
CREATE POLICY restored_owner_lock ON nx_org.dependency_candidate FOR UPDATE TO nx_design_owner USING (true) WITH CHECK (false);



CREATE TABLE nx_org.r23_job (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  job_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  capability_id text NOT NULL,
  revision_sha256 text NOT NULL,
  input_sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','LEASED','DONE','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  lease_holder uuid,
  lease_until timestamptz,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  PRIMARY KEY(tenant_id,node_id,job_id),
  FOREIGN KEY(tenant_id,node_id,assignment_id) REFERENCES nx_org.role_assignment(tenant_id,node_id,assignment_id),
  CHECK(revision_sha256 ~ '^[0-9a-f]{64}$' AND input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK((state='LEASED' AND lease_holder IS NOT NULL AND lease_until IS NOT NULL AND lease_epoch>0) OR (state<>'LEASED' AND lease_holder IS NULL AND lease_until IS NULL)),
  CHECK(length(capability_id)>0)
);
CREATE TABLE nx_org.r23_job_event (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_kind text NOT NULL,
  evidence_sha256 text NOT NULL,
  PRIMARY KEY(tenant_id,node_id,job_id,event_id),
  FOREIGN KEY(tenant_id,node_id,job_id) REFERENCES nx_org.r23_job(tenant_id,node_id,job_id),
  CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK(length(event_kind)>0)
);
CREATE INDEX ix_r23_job_queue ON nx_org.r23_job(tenant_id,node_id,state,created_at);
CREATE INDEX ix_r23_job_assignment ON nx_org.r23_job(tenant_id,node_id,assignment_id);
ALTER TABLE nx_org.r23_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.r23_job FORCE ROW LEVEL SECURITY;
CREATE POLICY r23_member_read ON nx_org.r23_job FOR SELECT TO nx_design_client USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY r23_owner_read ON nx_org.r23_job FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY r23_owner_insert ON nx_org.r23_job FOR INSERT TO nx_design_owner WITH CHECK (true);
REVOKE ALL ON nx_org.r23_job FROM PUBLIC;
GRANT SELECT ON nx_org.r23_job TO nx_design_client;
ALTER TABLE nx_org.r23_job_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.r23_job_event FORCE ROW LEVEL SECURITY;
CREATE POLICY r23_member_read ON nx_org.r23_job_event FOR SELECT TO nx_design_client USING (nx_org.node_read(tenant_id,node_id));
CREATE POLICY r23_owner_read ON nx_org.r23_job_event FOR SELECT TO nx_design_owner USING (true);
CREATE POLICY r23_owner_insert ON nx_org.r23_job_event FOR INSERT TO nx_design_owner WITH CHECK (true);
REVOKE ALL ON nx_org.r23_job_event FROM PUBLIC;
GRANT SELECT ON nx_org.r23_job_event TO nx_design_client;
CREATE FUNCTION nx_org.r23_immutable_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'Evidence is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER r23_immutable BEFORE UPDATE OR DELETE ON nx_org.r23_job_event FOR EACH ROW EXECUTE FUNCTION nx_org.r23_immutable_event();


-- Queue selection contract (owner transaction only; gateway authorization and lease fencing required):
-- SELECT job_id FROM nx_org.r23_job WHERE tenant_id=$1 AND node_id=$2 AND state='DRAFT' ORDER BY created_at,job_id LIMIT 1 FOR UPDATE SKIP LOCKED;



CREATE TABLE nx_org.r23_replay_receipt (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  device_id uuid NOT NULL,
  client_seq_id bigint NOT NULL CHECK(client_seq_id>0),
  idempotency_key uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  vector_clock jsonb NOT NULL CHECK(jsonb_typeof(vector_clock)='object'),
  job_id uuid NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.r23_replay_receipt:tenant_id,node_id,device_id,client_seq_id|' || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|' || length(device_id::text)::text || ':' || device_id::text || '|' || length(client_seq_id::text)::text || ':' || client_seq_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  UNIQUE(tenant_id,node_id,idempotency_key),
  FOREIGN KEY(tenant_id,node_id,job_id) REFERENCES nx_org.r23_job(tenant_id,node_id,job_id),
  UNIQUE(tenant_id,node_id,device_id,client_seq_id)
);
CREATE TABLE nx_org.r23_outbox_events (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  event_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  PRIMARY KEY(tenant_id,node_id,event_id),
  FOREIGN KEY(tenant_id,node_id,job_id) REFERENCES nx_org.r23_job(tenant_id,node_id,job_id),
  CHECK(published_at IS NULL OR published_at>=created_at),
  CHECK(length(event_type)>0)
);
CREATE INDEX r23_outbox_pending ON nx_org.r23_outbox_events(tenant_id,node_id,created_at,event_id) WHERE published_at IS NULL;
CREATE TABLE nx_org.r23_consumer_receipt (
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer_id text NOT NULL,
  master_key_uuid uuid GENERATED ALWAYS AS (md5('nx_org.r23_consumer_receipt:tenant_id,node_id,event_id,consumer_id|' || length(tenant_id::text)::text || ':' || tenant_id::text || '|' || length(node_id::text)::text || ':' || node_id::text || '|' || length(event_id::text)::text || ':' || event_id::text || '|' || length(consumer_id::text)::text || ':' || consumer_id::text || '|')::uuid) STORED NOT NULL,
  PRIMARY KEY(master_key_uuid),
  FOREIGN KEY(tenant_id,node_id,event_id) REFERENCES nx_org.r23_outbox_events(tenant_id,node_id,event_id),
  CHECK(length(consumer_id)>0),
  UNIQUE(tenant_id,node_id,event_id,consumer_id)
);
ALTER TABLE nx_org.r23_replay_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.r23_replay_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY r23_replay_owner ON nx_org.r23_replay_receipt TO nx_design_owner USING(true) WITH CHECK(true);
ALTER TABLE nx_org.r23_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.r23_outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r23_outbox_owner ON nx_org.r23_outbox_events TO nx_design_owner USING(true) WITH CHECK(true);
ALTER TABLE nx_org.r23_consumer_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE nx_org.r23_consumer_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY r23_consumer_owner ON nx_org.r23_consumer_receipt TO nx_design_owner USING(true) WITH CHECK(true);
CREATE POLICY r23_job_owner_update ON nx_org.r23_job FOR UPDATE TO nx_design_owner USING(true) WITH CHECK(true);
REVOKE ALL ON nx_org.r23_replay_receipt,nx_org.r23_outbox_events,nx_org.r23_consumer_receipt FROM PUBLIC,nx_design_client;
-- Owner-only service function. Gateway must authorize tenant/node and worker before call.
CREATE FUNCTION nx_org.r23_claim_job(p_tenant uuid,p_node uuid,p_worker uuid,p_lease_seconds integer)
RETURNS TABLE(claimed_job uuid,fence bigint) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_tenant IS NULL OR p_node IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 900 OR p_worker IS NULL THEN RAISE EXCEPTION 'Invalid lease'; END IF;
 RETURN QUERY WITH candidate AS (
 SELECT j.job_id FROM nx_org.r23_job j WHERE j.tenant_id=p_tenant AND j.node_id=p_node
 AND (j.state='DRAFT' OR (j.state='LEASED' AND j.lease_until<=clock_timestamp()))
 ORDER BY j.created_at,j.job_id LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE nx_org.r23_job j SET state='LEASED',lease_holder=p_worker,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_epoch=j.lease_epoch+1
 FROM candidate c WHERE j.tenant_id=p_tenant AND j.node_id=p_node AND j.job_id=c.job_id RETURNING j.job_id,j.lease_epoch;
END; $$;
REVOKE ALL ON FUNCTION nx_org.r23_claim_job(uuid,uuid,uuid,integer) FROM PUBLIC,nx_design_client;
CREATE FUNCTION nx_org.r23_finish_job(p_tenant uuid,p_node uuid,p_job uuid,p_worker uuid,p_fence bigint,p_event uuid,p_evidence text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_tenant IS NULL OR p_node IS NULL OR p_job IS NULL OR p_worker IS NULL OR p_fence IS NULL OR p_event IS NULL OR p_evidence IS NULL OR p_evidence !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 UPDATE nx_org.r23_job SET state='DONE',lease_holder=NULL,lease_until=NULL WHERE tenant_id=p_tenant AND node_id=p_node AND job_id=p_job AND state='LEASED' AND lease_holder=p_worker AND lease_epoch=p_fence AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Stale or unauthorized lease'; END IF;
 INSERT INTO nx_org.r23_job_event(tenant_id,node_id,job_id,event_id,event_kind,evidence_sha256) VALUES(p_tenant,p_node,p_job,p_event,'JOB_DONE',p_evidence);
 INSERT INTO nx_org.r23_outbox_events(tenant_id,node_id,event_id,job_id,event_type,payload) VALUES(p_tenant,p_node,p_event,p_job,'JOB_DONE',jsonb_build_object('evidence_sha256',p_evidence,'fence',p_fence));
END; $$;
REVOKE ALL ON FUNCTION nx_org.r23_finish_job(uuid,uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC,nx_design_client;



-- Round 2 hardening: separate R23 execution ledger from general scheduler.
CREATE TRIGGER r23_replay_immutable BEFORE UPDATE OR DELETE ON nx_org.r23_replay_receipt FOR EACH ROW EXECUTE FUNCTION nx_org.r23_immutable_event();
CREATE TRIGGER r23_consumer_immutable BEFORE UPDATE OR DELETE ON nx_org.r23_consumer_receipt FOR EACH ROW EXECUTE FUNCTION nx_org.r23_immutable_event();
CREATE FUNCTION nx_org.r23_guard_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outbox evidence cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'published_at') IS DISTINCT FROM (to_jsonb(OLD)-'published_at') OR OLD.published_at IS NOT NULL OR NEW.published_at IS NULL THEN RAISE EXCEPTION 'Only first publication timestamp may be set'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER r23_outbox_guard BEFORE UPDATE OR DELETE ON nx_org.r23_outbox_events FOR EACH ROW EXECUTE FUNCTION nx_org.r23_guard_outbox();
REVOKE ALL ON FUNCTION nx_org.r23_immutable_event(),nx_org.r23_guard_outbox() FROM PUBLIC;
-- R23 job execution functions remain owner-only. No direct client writes.

RESET ROLE;
COMMIT;
