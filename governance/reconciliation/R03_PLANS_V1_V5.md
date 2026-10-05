# R03 — Claude plans v1–v5 ("TRUE FINAL" is not evidence of finality)

## Sources

| File | How it was read |
|---|---|
| v5 MD | Read in full |
| v5 atomic build register (4,602 rows) | Parsed in full |
| v5 work-package register (787) | Parsed in full |
| v5 QA JSON | Read in full |
| v4 work-package register (787) | Parsed in full |
| v4 QA JSON | Read in full |
| v1 MD | Section outline read; Build/Acceptance items parsed in full → `V1_DOMAIN_FEATURE_INVENTORY.csv` (732 items, 47 phases) |
| v2 MD | Section outline read |
| v3 MD (1.4 MB) | Not yet read: UNREAD |
| v4 master MD (5.2 MB) | Not yet read: UNREAD |

## Reconciled numbers
| Question | Answer | Evidence |
|---|---|---|
| 787 vs 833 work packages | **787 distinct WPs is authoritative.** 833 is the sum of per-wave counts: 7 cross-cutting WPs appear in up to 10 waves, adding 46 wave-slots. | v5 atomic register: 787 distinct `Work_Package_ID`; 833 distinct (wave, WP) pairs |
| 531 vs 1,660 "no evidence" | **1,660 (Forensic Restart) is the more defensible bound.** v5 relabelled 1,238 forensic "no evidence" rows as "partial". | v5 cross-tab vs forensic map |
| | Every v5 evidence item is a derived name mapping (`TARGET_MAP` or `FAMILY_OWNER_MAP`); none comes from requirement-specific code inspection. | 6,016 tags in total |
| | 364 rows are classed PARTIAL and 50 STRONG with no evidence attached at all. | v5 atomic register |
| | Example false positive: Agent Registry field `legal_entity_scope` → `contracts.routes.ts` (the construction contracts module). | REQ17-04059 |
| | **Neither number is an implementation status.** Status is set only by runtime evidence: R0 verified the commercial-finance chain; everything else stays unverified. | — |
| 4,965 capabilities | The row-level atlas is absent from all accessible sources; only the family-level total exists. v5 W00-02 says the same. | R01 |

## v5 "TRUE FINAL": what holds and what does not
- **Holds:**
  - The 10 non-negotiable product rules (§6) are adopted into the Decision Ledger: single source of truth, no self-approval and no invented thresholds, reversal not overwrite, trusted tenant context, AI never sole authority, prompt ≠ authorization, idempotent side effects, upgrade-safe configuration, frozen baselines immutable, and no "Production Ready" without runtime proof.
  - The release-gate list (§9) is adopted.
- **W00 status, now executed by R0:**

  | Item | Status |
  |---|---|
  | W00-04 lockfiles / npm ci | DONE |
  | W00-05 migrations from zero | DONE (PG 16 and 17) |
  | W00-06 clean build | DONE |
  | W00-07 tenant / RBAC / DOA / SoD negatives | DONE for the chain scope |
  | W00-08 core E2E | DONE |
  | W00-09 replay, concurrency, period-lock, reversal and approval-race | **OPEN** |
  | W00-02 4,965 atlas | **OPEN** |
  | W00-10…13 | **OPEN** |

- **Does not hold:**
  - Calling the 4,602-row register "the executable plan". It executes a platform-contract scaffold (R01). Executing it slice by slice would produce generated APIs, fields and entitlements for 86 families, not a contractor that can estimate, plan, measure, certify and claim.
  - "No v6 planning cycle". This contradicts the Owner Constitution (§29, continuous discovery) and is set aside.
  - W07 assigns only 62 requirements to the AI orchestrator, agent factory, RAG and evals. That is far below the Constitution's digital-workforce mandate.
  - v5's own static gates were falsified by R0 (F-09).

## v1 domain inventory (adopted as discovery input, not as authority)
v1 is the only plan organised by professional domain: CPM relations, calendars, float, EVM indices, measurement sheets, accruals, time-bars, rate analysis, treasury/tax and similar. Its 687 build items and 45 acceptance criteria are extracted for traceability into the first-principles decomposition (task 4). The Forensic Restart excluded v1–v5 from authority; using v1 as **input** does not reverse that.
