# Owner Quality Standard (OQS-001) — set by the owner 2026-10-15, binding on every deliverable

## Owner rules (verbatim intent)
1. No errors at all.
2. Every product or release is reviewed, approved and trustworthy: it passes every review stage — gap discovery,
   audit, inspection, deep dive — and a **hostile review** by the chair of an expert panel and senior consultants
   of competing firms whose aim is to make us fail.
3. No stalling or chatter: precision, highest quality and professional standards, complete information and data on
   the widest scope. The deliverable is a **reference**, not surface content.
4. Every output comes out right the first time: complete, reviewed, final, approved — anyone who reviews it finds no
   gap, error or omission.

## Review pipeline applied before anything is delivered
| Stage | What is checked | Evidence kept |
|---|---|---|
| R1 Completeness | Against the scope and the checklist of the part (every unit, process, document, role, link) | Checklist result |
| R2 Consistency | Cross-references, numbering, terms, no duplicates or contradictions, counts computed not estimated | Count / reference check |
| R3 Truth | Every statement about the code verified (E1 runtime, E2 static, E3 code read); external facts sourced; no invented numbers, laws, thresholds or DOA values | Evidence grades |
| R4 Hostile review | Expert-panel chair + competitor consultants attack: missing roles / steps, local (Egyptian / Arab market) practice, legal and regulatory exposure, SoD and fraud paths, AI over-reach, scalability, ambiguity, unverifiable claims | Findings list |
| R5 Fix and re-check | Every finding fixed or explicitly justified; R1–R3 re-run | Review log in the deliverable |
| R6 Owner approval | Only the owner approves; until then status = "reviewed, awaiting owner approval" | Approval record |

Code releases additionally pass the existing gate (runtime suites from zero, static and security checks, CI on
PG 16/17) before any claim.

## Honesty clause
A claim of "no error" is made only to the extent the evidence covers it; any residual uncertainty is written in the
deliverable, never hidden.
