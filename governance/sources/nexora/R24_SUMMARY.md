# NEXORA ONE — R24 handoff

Source: ORIGINAL_451_SOURCE_ORDER CSV, positional numbering; baseline 67 tables / 538 columns / 634 roles.

## Programs #001–#080

| # | Program | Evidence status |
|---|---|---|
| 001 | Autodesk AEC Collection | Source inventory only; prior package not inspected |
| 002 | Autodesk Revit | Source inventory only; prior package not inspected |
| 003 | Autodesk AutoCAD | Source inventory only; prior package not inspected |
| 004 | AutoCAD Architecture Toolset | Source inventory only; prior package not inspected |
| 005 | AutoCAD MEP Toolset | Source inventory only; prior package not inspected |
| 006 | AutoCAD Electrical Toolset | Source inventory only; prior package not inspected |
| 007 | Autodesk Civil 3D | Source inventory only; prior package not inspected |
| 008 | Autodesk InfraWorks | Source inventory only; prior package not inspected |
| 009 | Autodesk Navisworks Manage | Source inventory only; prior package not inspected |
| 010 | Autodesk Navisworks Simulate | Source inventory only; prior package not inspected |
| 011 | Autodesk Docs | Source inventory only; prior package not inspected |
| 012 | Autodesk Build | Source inventory only; prior package not inspected |
| 013 | Autodesk Takeoff | Source inventory only; prior package not inspected |
| 014 | Autodesk BIM Collaborate Pro | Source inventory only; prior package not inspected |
| 015 | Autodesk Forma Site Design | Source inventory only; prior package not inspected |
| 016 | Autodesk 3ds Max | Source inventory only; prior package not inspected |
| 017 | Autodesk Maya | Source inventory only; prior package not inspected |
| 018 | Autodesk Robot Structural Analysis | Source inventory only; prior package not inspected |
| 019 | Autodesk Advance Steel | Source inventory only; prior package not inspected |
| 020 | Autodesk ReCap Pro | Source inventory only; prior package not inspected |
| 021 | Autodesk Fabrication CADmep | Source inventory only; prior package not inspected |
| 022 | Autodesk Dynamo | Source inventory only; prior package not inspected |
| 023 | Autodesk Fusion | Source inventory only; prior package not inspected |
| 024 | Autodesk Inventor | Source inventory only; prior package not inspected |
| 025 | Autodesk Vault | Source inventory only; prior package not inspected |
| 026 | Autodesk Construction Cloud / Forma platform naming | Source inventory only; prior package not inspected |
| 027 | SketchUp Pro | Source inventory only; prior package not inspected |
| 028 | SketchUp Studio | Source inventory only; prior package not inspected |
| 029 | Graphisoft Archicad | Source inventory only; prior package not inspected |
| 030 | Graphisoft BIMcloud | Source inventory only; prior package not inspected |
| 031 | Graphisoft BIMx | Source inventory only; prior package not inspected |
| 032 | Vectorworks Architect | Source inventory only; prior package not inspected |
| 033 | Vectorworks Landmark | Source inventory only; prior package not inspected |
| 034 | Vectorworks Design Suite | Source inventory only; prior package not inspected |
| 035 | Chief Architect Premier | Source inventory only; prior package not inspected |
| 036 | Home Designer Pro | Source inventory only; prior package not inspected |
| 037 | 2020 Design Live | Source inventory only; prior package not inspected |
| 038 | Cabinet Vision | Source inventory only; prior package not inspected |
| 039 | Microvellum | Source inventory only; prior package not inspected |
| 040 | Mozaik | Source inventory only; prior package not inspected |
| 041 | Palette CAD | Source inventory only; prior package not inspected |
| 042 | Coohom | Source inventory only; prior package not inspected |
| 043 | Homestyler | Source inventory only; prior package not inspected |
| 044 | Foyr Neo | Source inventory only; prior package not inspected |
| 045 | Planner 5D | Source inventory only; prior package not inspected |
| 046 | RoomSketcher | Source inventory only; prior package not inspected |
| 047 | Floorplanner | Source inventory only; prior package not inspected |
| 048 | Cedreo | Source inventory only; prior package not inspected |
| 049 | Sweet Home 3D | Source inventory only; prior package not inspected |
| 050 | Blender | Source inventory only; prior package not inspected |
| 051 | Chaos V-Ray | Source inventory only; prior package not inspected |
| 052 | Chaos Enscape | Source inventory only; prior package not inspected |
| 053 | Chaos Vantage | Source inventory only; prior package not inspected |
| 054 | Chaos Corona | Source inventory only; prior package not inspected |
| 055 | Lumion Pro | Source inventory only; prior package not inspected |
| 056 | Twinmotion | Source inventory only; prior package not inspected |
| 057 | Unreal Engine | Source inventory only; prior package not inspected |
| 058 | D5 Render | Source inventory only; prior package not inspected |
| 059 | Adobe Substance 3D | Source inventory only; prior package not inspected |
| 060 | Adobe Photoshop | Source inventory only; prior package not inspected |
| 061 | Adobe Illustrator | R24 archive present; see audit |
| 062 | Adobe InDesign | R24 archive present; see audit |
| 063 | Adobe Firefly | R24 archive present; see audit |
| 064 | Morpholio Board | R24 archive present; see audit |
| 065 | Mydoma Studio | R24 archive present; see audit |
| 066 | Studio Designer | R24 archive present; see audit |
| 067 | Design Manager | R24 archive present; see audit |
| 068 | Houzz Pro (Interior workflows) | R24 archive present; see audit |
| 069 | ETABS | R24 archive present; see audit |
| 070 | SAFE | R24 archive present; see audit |
| 071 | SAP2000 | R24 archive present; see audit |
| 072 | CSiBridge | R24 archive present; see audit |
| 073 | PERFORM-3D | R24 archive present; see audit |
| 074 | STAAD.Pro | R24 archive present; see audit |
| 075 | RAM Structural System | R24 archive present; see audit |
| 076 | RAM Concept | R24 archive present; see audit |
| 077 | PLAXIS 2D | R24 archive present; see audit |
| 078 | PLAXIS 3D | R24 archive present; see audit |
| 079 | GeoStudio | R24 archive present; see audit |
| 080 | MIDAS Gen | R24 archive present; see audit |

## R24 archive validation evidence

### NEXORA_ONE_R24_TURN1_061_065.zip
ZIP integrity: PASS
- schema meta validation | PASS | 230 schemas; missing required field rejected
- SQLite FK and integrity | PASS | 115 role bindings
- vendor parity and versions | OPEN | Official exhaustive release-specific evidence absent
- PostgreSQL runtime | OPEN | SQL not executed; authorization and tax semantics require review
- SBOM closure | OPEN | Transitive dependencies and distribution artifacts not verified
- schema semantics | OPEN | Candidate schemas need domain fixtures and vendor comparison

### NEXORA_ONE_R24_TURN2_066_070.zip
ZIP integrity: PASS
Recorded validation: `{
  "schemas_checked": 250,
  "capabilities": 125,
  "sqlite_errors": 0,
  "jsonschema_errors": 0,
  "openapi_local_reference_errors": 0,
  "openapi_full_validator": "not run",
  "baseline_tables": 67,
  "baseline_columns": 538,
  "roles": 634
}`
- JSON Schema and sample validation | PASS
- SQLite role FK and integrity | PASS
- OpenAPI local reference checks | PASS
- Full vendor parity | OPEN
- DOA/tax triggers and legal rules | OPEN
- Novelty and latency | UNVERIFIED
- Dependency license verification | OPEN

### NEXORA_ONE_R24_TURN3_071_075.zip
ZIP integrity: PASS
Recorded validation: `{"schemas":250,"capabilities":125,"jsonschema_errors":0,"sqlite_errors":0,"open_blockers":6}`
- JSON Schema | PASS | 250 metaschemas checked
- SQLite | PASS | 125 role foreign keys; integrity check
- vendor parity | OPEN | No exhaustive vendor tool inventory verified
- schema semantics | OPEN | Single parameter contracts are incomplete for actual FEA execution
- OpenAPI | OPEN | References constructed; full validator not run
- DOA/tax | OPEN | Approval and tax trigger rules not implemented
- SBOM | OPEN | Candidate versions and licenses not independently verified
- innovation | OPEN | Patent novelty and latency not established

### NEXORA_ONE_R24_TURN4_076_080.zip
ZIP integrity: PASS
Recorded validation: `{"schemas":250,"capabilities":125,"jsonschema_errors":0,"sqlite_errors":0,"open_blockers":6}`
- JSON Schema | PASS | 250 metaschemas checked
- SQLite | PASS | 125 role foreign keys; integrity check
- vendor parity | OPEN | No exhaustive vendor tool inventory verified
- schema semantics | OPEN | Single parameter contracts are incomplete for actual FEA execution
- OpenAPI | OPEN | References constructed; full validator not run
- DOA/tax | OPEN | Approval and tax trigger rules not implemented
- SBOM | OPEN | Candidate versions and licenses not independently verified
- innovation | OPEN | Patent novelty and latency not established

## Batch 06 continuation
Start at source positions #081–#100, preserve source order. Static schema and role-reference checks do not certify vendor parity, solver correctness, PostgreSQL trigger semantics, license closure or patent novelty. Resolve outstanding audits before production.