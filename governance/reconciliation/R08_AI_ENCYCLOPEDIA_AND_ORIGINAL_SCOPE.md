# R08 — AI Agents & Automation Encyclopedia V3 and the original project-scope context

## Sources
- `reference/governance/PROJECT_SCOPE_CONTEXT.txt`: read in full.
- `reference/ai_encyclopedia/AI_AGENTS_AUTOMATION_MASTER.md` (9,919 lines):
  - all 416 chapter headings and parts were read;
  - Part X (construction AI use-case catalog), Part Y (agent team) and chapters 356–358 were read in full;
  - the rest was not read line by line (`SAMPLED`).

## Original scope context: owner intent that must stay visible
1. **Organisation.** The full organisation, from worker / technician / foreman through engineer / lead / manager / director / C-suite / board. Every role carries responsibilities, authority, deliverables, interfaces, qualifications, competencies, KPIs, grade and career path.
2. **Expert and consultant layer.** One per department and discipline, with independent review levels, qualification rules, escalation and closure evidence.
3. **References.** Egyptian-first engineering references, then Saudi, US and international. Books and handbooks are kept **separate** from mandatory codes and contract requirements.
4. **Execution libraries.** BOQ, specifications, method statements, ITP, submittals, shop drawings, RFI, QA/QC, HSE, planning, commercial, contracts, claims, procurement, T&C, handover.
5. **Command architecture.** For example `ARCH BOQ / ARCH SPEC / ARCH MS / ARCH ITP / ARCH REVIEW`, where each command activates the role, input gate, workflow, reference set, review protocol and output template. This is the earliest form of the Constitution's intent-to-execution and STEP_01's "one intent → governed outcome".
6. **Information classification.** FACT / USER DATA / REFERENCE / ASSUMPTION / PROPOSAL / CALCULATION / PENDING.
7. **Strategic gap stated explicitly.** The operational ERP and the engineering knowledge / expert-command layer must be **one application, not parallel tracks**.
   - Confirmed by this investigation: the TS ERP (v0.2), the STEP18 Python kernel and the governance document set are three parallel tracks (R06).
   - **This becomes a hard architectural requirement** for the target design.

## Encyclopedia assessment
- **Nature.** A professional reference and curriculum on chat vs agent vs automation, RAG, MCP, n8n, tool calling, HITL, governance, evaluation, DevOps and dashboards. It has verified-reference appendices dated 2026-10-02.
- **Product-relevant content (adopted as patterns):**
  - per-agent allowed / not-allowed action lists (ch. 356);
  - typed agent output contracts (ch. 358);
  - agent card and tool registry templates (ch. 293–294);
  - approval object model (ch. 301);
  - AI-vs-rule-engine decision framework (ch. 289);
  - autonomy policy (ch. 395);
  - provider assessment and deprecation plan (ch. 397–399);
  - AI cost / model routing / fallback (ch. 347–349).
- **Limitation.** The construction use-case catalog (Part X, 16 areas) and the agent team (Part Y) are assistant-level: summarise, extract, compare, draft, track. They do not specify agents that perform professional work end to end, such as producing a priced BOQ from drawings, building a CPM baseline or preparing an IPC from measured quantities. That depth has to come from the Golden Case decomposition (task 4), the D-pack scenarios and the STEP08/09 engine catalogs.
