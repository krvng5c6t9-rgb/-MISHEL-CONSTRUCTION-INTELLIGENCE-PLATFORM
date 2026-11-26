# Standing instructions for work on MARC (owner: Eng. Michel)

- Product name: MARC. Plan of record: `governance/masterplan/MP-08_MARC_UNIFIED_MASTER_MAP.md`; state:
  `CURRENT_STATE.md`, `governance/HANDOFF.md`; owner directives: `governance/OWNER_VISION_DIRECTIVE*.md`;
  quality rules: `governance/OWNER_QUALITY_STANDARD.md`.
- Owner rule (2026-11-26): no mistakes. Use full care. Never give unverified results or information that has not been
  thoroughly reviewed against its source in the same session. Counts are computed, not estimated. A wrong result found
  later is corrected openly.
- Reply to the owner in clear Arabic (Egyptian register is fine), English technical terms allowed, conclusion first.
- Every stage: implement -> full gate from an empty database (`tests/e2e/run_from_zero.sh`) -> records (CURRENT_STATE,
  HANDOFF, DECISION_LEDGER, registers/10) -> commit -> push to both `claude/read-file-dsz1qx-jkyid3` and
  `claude/read-file-dsz1qx`. Never edit repository files while a gate is running.
- Report any third-party / open-source download to the owner first; check licences before use.
