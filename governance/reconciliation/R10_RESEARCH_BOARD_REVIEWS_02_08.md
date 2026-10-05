# R10: Research board reviews 02–08 (activation pack v2.3, `40_RESEARCH_BOARD/`)

## Scope and method
- **Sources:** the reviews 02 pm-contracts, 03 quality-hse, 04 finance-governance, 05 hr-labor, 06 digital-ai, 07 sustainability and 08 academic-systems. SHA-256 for each is in `SOURCE_REGISTER.csv`.
- **What was read in full:** each review's findings register and its required-changes section:
  - 02 §5–§8
  - 03 §13–§14
  - 04 §4–§6
  - 05 coverage matrix, priority changes and acceptance test
  - 06 §6–§7
  - 07 §4–§6
  - 08 §3.2, §4–§7
- **What was not read in full:** the descriptive sections §2–§4. Only their headings were read, so these files are recorded as **SAMPLED**.
- **Absence check:** every candidate capability was checked by case-insensitive grep over three corpora. The keywords and counts are recorded in each NDC row.
  - the frozen STEP03–17 governing baselines;
  - the D01–D20 pack (`governance/baseline_pack`);
  - migrations 001–037.
- **Covered candidates were not registered.** Those whose grep showed frozen coverage were dropped as new capabilities:
  - vendor bank change callback, duplicate payment detection and access recertification (STEP09/STEP04);
  - legal hold;
  - the climate hazard engine (EE104);
  - carbon/energy/water/circularity records;
  - engineering maturity (EE75).

## Common verdict of the reviews
All seven reviews give the same verdict: **conditional baseline, not operational.** The pack names the right controls but has three weaknesses:
- it lacks acceptance criteria, evidence and owners;
- it lacks jurisdiction inputs;
- its SOPs are templated.

This matches R02 and confirms RK-002: templated sources must not be mistaken for a specification. The reviews also forbid conformity claims ("ISO/FIDIC/NEC compliant") without a documented gap assessment. This becomes product rule NDC-027.

## New capabilities registered (NDC-010 … NDC-027)
| NDC | Capability | Source |
|---|---|---|
| 010 | Accepted Programme governance (submission/acceptance register, data date, health) | 02 PM-C-06 |
| 011 | Cost data dictionary + ERP/cost/programme reconciliation; reproducible EAC | 02 PM-C-07 |
| 012 | Progress measurement rules (materials on site, cut-off, no double count, evidence link) | 02 P1-9 |
| 013 | Subcontract flow-down of notice deadlines | 02 P1-10 |
| 014 | Structured daily record with impact flag → commercial review | 02 P1-11 |
| 015 | Testing-lab qualification (ISO/IEC 17025 scope) register | 03 P1-9 |
| 016 | Worker participation: consultation, stop-work log, anonymous near-miss | 03 P1-8 |
| 017 | P2P SoD hard rules + periodic conflict report + waiver with compensating control | 04 §4 |
| 018 | Fraud/whistleblowing case management with chain of custody | 04 §5 |
| 019 | Counterparty integrity: beneficial ownership, related party, conflict declarations, sanctions | 04 P-11 |
| 020 | Internal-control library and testing (population, sample, re-performance) | 04, 08 |
| 021 | Fair recruitment / labour supply-chain checks | 05 |
| 022 | Performance cycle with calibration and appeal | 05 |
| 023 | Records retention schedule + disposition + retrieval-integrity test | 02, 06 |
| 024 | ESG materiality + recomputable environmental KPIs | 07 |
| 025 | Organisational maturity assessment with evidence rubric and release card | 08 |
| 026 | Lessons-learned loop with recurrence check | 08 |
| 027 | Code & standard register; conformity-claim blocker | 02, 07, 08 |

## Additions to existing NDC rows (no new ID)
- **NDC-006 (delay protocol)** is extended with the claim protocol content from 02 P1-7: taxonomy, chronology, event-to-activity mapping, method-selection rationale, quantum rules, cumulative impact and the without-prejudice flag.
- **NDC-004 (gates)** is confirmed by 03 P2-10. The commissioning sequence is mechanical completion → pre-commissioning → energization → functional → integrated → performance → training → authority acceptance → handover.
- **NDC-009 (AI register)** is confirmed by 06 §6-4 and gains three fields: a model/data/prompt/version register, a vendor no-retraining clause and decommissioning.

## Impact on the target design
- **The weak spot is the commercial core.** 02, 04 and 08 converge on rights preservation (NDC-001/002/010/013/014) and evidence-grade controls (NDC-017/020/023). These are the product's strongest differentiators against generic ERPs, and they depend on G-001 (BOQ handover) and G-002 (vendor API).
- **No values are invented.** Every SLA, threshold, retention period, jurisdiction rule and lab scope is tenant or owner configuration. The NDC rows state this explicitly.

## Status
- Register rows are marked SAMPLED.
- §2–§4 of each review can be read later for supporting rationale, but no further capabilities are expected from them: the required-changes sections enumerate the reviewers' conclusions.
