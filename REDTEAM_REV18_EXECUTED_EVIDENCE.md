# REV18 — EDMS Versioning & Formal Transmittal Hardening

This revision closes a material EDMS gap found during hostile review: the prior UI exposed only registers/transmittals and did not provide an operational controlled-document version workflow.

Implemented in source:
- Immutable `document_versions` history with one-current-version invariant.
- SHA-256 / MIME / size metadata fields for file-integrity evidence (storage remains provider/path based; this does not claim embedded object storage or malware scanning).
- Transactional document creation and new-version registration.
- Document submit/review maker-checker control.
- Formal transmittal lifecycle `draft -> issued -> void`.
- Transmittals reference a specific document version, not only a mutable document row.
- Issued/void transmittal lines are immutable at DB level.
- Empty transmittals cannot be issued.
- Maker cannot issue their own transmittal.
- EDMS frontend made operational for documents, revisions, registers and transmittals.

Runtime PostgreSQL execution remains UNVERIFIED until a PostgreSQL-capable environment is available.
