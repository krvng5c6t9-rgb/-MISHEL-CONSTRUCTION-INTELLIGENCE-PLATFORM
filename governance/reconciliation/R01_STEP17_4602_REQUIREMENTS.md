# R01 — Nature of the STEP17 4,602 requirements / 787 targets

Sources read (content): `MISHEL_FORENSIC_RESTART_BASELINE_2026-10-02/00_FORENSIC_RESTART_REPORT.md`, `01_REQUIREMENT_FORENSIC_MAP_4602.csv` (all 4,602 rows parsed), `02_…_787.csv`, `03_…_86.csv`, `08_QA_SUMMARY.json`.

## Findings (E1 = computed over the full file)
1. **The 4,602 are an architecture/platform contract, not a specification of professional work.**
   - 3,068 rows (67%) are structural classes generated per family or entity: API operation (552), API authorization (552), plan entitlement binding (344), event contract (306), data identity/lifecycle/authority (3 × 276), capability, product or entitlement boundary (3 × 86), and similar.
   - 936 rows (20%) are contract **field** lists (agent manifest, solver, document, accounting posting, cost ledger, retrieval and others).
   - Only 598 rows (13%) state governance or process rules: 60 SoD conflicts, 34 handoffs, 31 value streams, 26 invariants, 20 approval rules, 18 transaction-consistency rules and others.
2. **Professional work content is effectively absent.** The full text contains 0 requirements for each of: quantity take-off, rate build-up, earned value, critical path, baseline schedule, RFI, method statement, cash flow, liquidated damages, delay analysis, permit to work, procurement plan, long-lead items, material approval, value engineering and resource levelling.
   - Where professional terms appear (IPC 28, variation 11, retention 10), they appear almost only as generated API, event or field names.
3. **Every row has status `SPECIFIED — NOT IMPLEMENTED/TESTED` and priority `MUST`.** There is no prioritisation signal.
4. **The "static evidence" for 2,942 rows is weak.**
   - For 1,688 rows it points to the STEP18 *Python* governance kernel (e.g. `app/catalog.py`, `contracts/*.json`), not to the TypeScript product that runs.
   - The forensic report itself labels this evidence "candidate, not complete".
   - R0 runtime later disproved the report's "schema/code consistency PASS" claim (see DECISION_LEDGER F-09).
5. **The 4,965-capability STEP02 atlas does not exist at row level** in the accessible sources. Only the family totals (86 families) and fragments exist. This is consistent with the forensic report §2 and with the earlier finding about STEP02.

## Consequences for the program
- Keep the 4,602 as the **platform non-functional / contract baseline**: tenancy, PEP/PDP, events, entitlements, SoD, handoffs, invariants. They remain mandatory input (Constitution) and get traced.
- They **cannot** serve as the scope of what the product must *do* professionally. That content has to come from first-principles enterprise decomposition (task 4), the operating-model sources (R02), market benchmarks and expert review.
  - New items are registered as NEWLY_DISCOVERED_CAPABILITY.
- No row of the 4,602 is to be reported as "implemented" from static evidence. Each needs runtime evidence, in the way R0 did for the commercial-finance chain.
