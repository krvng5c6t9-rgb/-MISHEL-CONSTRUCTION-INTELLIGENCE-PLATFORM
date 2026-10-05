# R07 — STEP03 product boundaries, STEP04 enterprise operating model, STEP05 architecture

## Sources
| Document | How it was read |
|---|---|
| STEP04 `15_…OPERATING_MODEL_v1_3` (1,264 lines) | §1–§25 read in full; §26–§30 (60 attack scenarios, 30 closure gates, inputs, status) outlined |
| STEP03 `10_…PRODUCT_DEFINITION_BOUNDARIES_v1_2` | §1–§7 and §9–§12 read; §8 (F01–F86 boundary matrix) inventoried as CSV in R04 |
| STEP05 `36_…SYSTEM_ARCHITECTURE_v1_2` | §1–§5 and §7–§9 read, plus the start of the integration contracts; the 68-component catalog is inventoried as a CSV (`16_…LOGICAL_COMPONENT_CATALOG_78`) |

## Assessment
These three documents are professionally strong and **consistent** with STEP_01 and the Owner Constitution. They are adopted as the operating-model and architecture baseline for design.

## STEP04: what it supplies
- **Organisation model.**
  - 26 organisational object types and 22 relationship types; 12 operating-model dimensions.
  - Identity separations: Tenant ≠ Group ≠ Legal Entity ≠ BU ≠ Project; Person ≠ Employment ≠ Position ≠ Job ≠ User ≠ Service ≠ AI principal.
- **Operating structure.**
  - 9 deployment archetypes; 38 enterprise functions.
  - 30 value streams with an L0–L5 process hierarchy and a per-process definition template (Purpose → Trigger → … → Tests). This is the skeleton for task 4.
- **Governance and authority.**
  - 20 governance forums with quorum and recusal; 16 decision-right classes.
  - **12 DOA dimensions:** action, amount and aggregation, risk, legal entity, project, contract, jurisdiction, discipline, effective time, delegation, SoD, evidence preconditions. This is **the target DOA architecture** for owner decision DEC-008: configurable and versioned, with no invented values.
  - 12 RACI/DOA constitution rules, including "RACI ≠ authorization" and that historical DOA is preserved per transaction.
  - 20 SoD patterns.
- **Operations.**
  - 14 shared services; 18 operating cadences (daily site coordination through annual DOA recertification); 16 external stakeholder classes.
  - **32 critical handoffs**, each carrying source IDs, revision, owner, acceptance criteria, pending obligations, downstream impacts and reconciliation status. This is the design basis for the Constitution's **event/impact propagation**.
  - 24 invariants, e.g. "physical progress ≠ certification ≠ revenue ≠ cash" and "technical recovery ≠ business reopening".

## STEP03: what it supplies
- Product layers P0–P13 and 14 packs (PK-00 core … PK-13 CPM).
- Configuration precedence (protected core > law > jurisdiction > company OS > Mishel > project > user).
- Specialist and external-authority boundaries SB-01…SB-10: CAD/BIM authoring, solvers and Primavera are **integrated or hybrid, not cloned**; government and e-signature are external authorities; market data is licensed and never invented.

## STEP05: what it supplies
- **Architecture style:** domain-modular, evolution-ready. Not a single undifferentiated monolith and not "microservices everywhere".
- **20 architecture principles**, including:
  - one authoritative owner per concept;
  - local transactions with distributed workflow, outbox events and idempotent consumers;
  - temporal truth;
  - AI is not the system of record;
  - deterministic engines for deterministic truth;
  - failure as an explicit state.
- **12 logical data-store classes.** Search, vector, graph and analytics are **derived and rebuildable** and never authoritative. This resolves how the Constitution's "knowledge graph" fits: a derived graph projection over canonical IDs, not a second source of truth.

## Gap vs v0.2 (E3, from the schema and code reviewed in R0/R05)
| Topic | v0.2 today |
|---|---|
| Identity | 1 role per user |
| Organisation | No position / employment / assignment separation; no legal entity within a tenant; no BU / cost-centre / profit-centre dimensions |
| DOA | Flat amount bands per module: 1 of the 12 dimensions, plus partially SoD |
| Events | No outbox or durable event fabric; only `notify` triggers and webhook subscription rows |
| Data stores | No derived projections beyond `knowledge_chunks` |
| History | No effective-dating of organisational relationships |
| Handoffs | Of the 32, only parts of HO-07 / HO-13 / HO-14 exist (procurement → finance), and these are now runtime-proven |
