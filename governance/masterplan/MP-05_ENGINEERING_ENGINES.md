# MP-05 — Engineering engines: scheduling, CAD, BIM, interiors, Autodesk connectors, open-source components

Master Plan part 5 of 7 (OVD-001 §2 and §3a, OQS-001). Engines are **tools**: agents (MP-04) produce structured
data, the engines compute, draw, check and export it; humans approve (licensed engineers where the law requires).

## 0. Code status (E3, verified 2026-10-15)
| Area | Exists | Does not exist |
|---|---|---|
| Scheduling | Tables `schedule_activities`, `schedule_relationships` (FS / SS / FF / SF with lag), `schedule_baselines`, milestones, progress updates, programme submissions (migrations 029, 047); `GET /planning/cpm` computes forward / backward pass, total and free float and the critical path in **whole days** (`planning.routes.ts`); external activity IDs kept for P6 / MSP imports; runtime-tested by the wave-2 programme suite | Working calendars and holidays, constraints, resources and levelling, cost loading, data date / progress scheduling options, look-ahead generation, Gantt / network screens, XER / P6 XML / MS Project XML import or export, schedule quality checks |
| Drawings | Drawing register table `drawings` and technical-office review cycles | Any CAD geometry, viewer, DXF / DWG read or write |
| BIM / 3D | — | IFC read / write, model viewer, clash detection, model quantities, 4D / 5D links |
| Interiors | — | Layout generation, style boards, 3D scenes, rendering |
| Autodesk | — | Any Revit / AutoCAD / APS connection |
| Point clouds | — | Any point-cloud handling |

## 1. Scheduling engine (Primavera-class)
| Capability | Specification | Status |
|---|---|---|
| Structure | EPS / projects / WBS / activities, activity codes, milestones (start / finish) | Partly exists (activities, milestones) |
| Logic | FS / SS / FF / SF, positive / negative lag, multiple predecessors / successors, cycle detection | Exists (CPM endpoint) |
| Time unit | Hours and days on **working calendars** (work weeks, shifts, company / project holidays, special periods such as reduced working hours — all entered by the company, none hard-coded) | To build (current CPM counts calendar days) |
| Constraints | Start-on / no-earlier / no-later / finish-on / mandatory, deadlines, out-of-sequence handling (retained logic / progress override) | To build |
| Progress | Data date, actual start / finish, remaining duration, % complete types (duration / physical / units), suspend / resume | Partly exists (progress updates) |
| Resources | Labour by trade, plant by type, materials; units / rates; resource curves; levelling with priorities, within a project and across the portfolio (shared resources); histograms | To build |
| Cost loading | From the execution BOQ (MP-02 D05.03) and resource rates → planned value curve; link to cost codes and EV (D08.04) | To build |
| Baselines | Multiple baselines, comparison of dates / floats / costs, variance columns | Partly exists (baselines) |
| Look-ahead | 3 / 6-week windows with constraints (drawings, materials, permits, manpower, equipment) from the other modules | To build |
| Views | Gantt with logic links, network diagram, critical path, S-curves, histograms, float paths; print / PDF / PPTX (MP-03) | To build |
| Exchange | Import / export Primavera XER and P6 XML, MS Project XML (MSPDI); round-trip test on reference files | To build — component: MPXJ (§6) |
| Quality checks | Logic and float checks on every update (open ends, dangling activities, negative float, hard constraints, long lags / durations, high float, missing resources / costs) — a published industry check set may be adopted as reference by the company | To build |
| Delay analysis support | Snapshots per update, as-planned vs as-built, windows analysis, impacted as-planned fragments (D08.08, D15.07) | To build |
| Linear / location-based scheduling | Time–location views for roads, pipelines, tunnels and repetitive floors | To build (later phase) |
| Schedule risk analysis | Quantitative (Monte Carlo) risk on durations and risk-register events, confidence dates | To build (later phase) |
| Acceptance | On a set of reference schedules, early / late dates, floats and critical path must equal those produced by Primavera P6 for the same data and settings (any difference explained); the reference P6 results are produced by the company's licensed planner (owner input) | To define test set |

## 2. CAD 2D engine (drawing inside the system)
| Capability | Specification |
|---|---|
| Geometry | Exact coordinates in real units (double precision), points / lines / polylines / arcs / circles / ellipses / splines, blocks and attributes, hatches, dimensions (linear, aligned, angular, radial), leaders, text (Arabic and English, RTL) |
| Organisation | Layers with company standards, line types / weights, model space and sheets (paper space) with viewports, external references, plot styles, project coordinate system / survey grid as configured, title blocks from MP-03 |
| Editing | Snapping, ortho / polar, copy / move / rotate / mirror / array / offset / trim / extend, undo / redo, revision clouds, markups |
| Standards | Company drawing standards (layers, symbols, text styles) as configuration; drawing checks against them |
| Exchange | DXF read and write; DWG read / write through a separate service (§6) or a client's licensed AutoCAD (§4) |
| AI drafting | Agent (AG-17 / AG-20) outputs structured geometry (JSON: elements, coordinates, layers, dimensions) validated against a schema; the engine draws it; rule checks run (dimensions, clearances, overlaps, layer standards); a human edits / approves |
| Output | PDF plots via the MP-03 engine (A4–A0, scale, title block, QR, DRAFT watermark until approved), DXF / DWG, quantities to the BOQ |
| Precision rule | The model never computes geometry it reports as final; coordinates and quantities shown are those stored by the engine |

## 3. BIM / 3D engine
| Capability | Specification |
|---|---|
| Model I/O | IFC read / write (IFC2x3 / IFC4), federated models per discipline, element GUIDs preserved |
| Viewer | Browser 3D viewer: navigation, sections, measurements, properties, storeys, discipline filters |
| Clash | Hard / clearance clashes between federated models, grouping, assignment, status, BCF-style issues |
| Quantities | Quantity take-off from IFC quantities / geometry, mapped to BOQ items (D06.11) |
| Links | Element ↔ BOQ item ↔ activity ↔ cost code ↔ inspections ↔ installed asset (4D / 5D / hand-over, GC-28); hand-over asset data export (COBie-style spreadsheets) |
| Model checks | Required properties, naming, classification and LOD per the company BIM standard and the project BIM execution plan |
| AI | Clash grouping (AG-16), model checks, QTO checks (AG-05); authoring of model elements as structured data, executed by the engine or by Revit (§4) |
| Scale | Large models processed server-side; streaming / tiling for the browser |

## 4. Autodesk connectors (when the client has the licences)
- **Revit:** Autodesk announced (June 2026) an official Revit Public MCP server — tech preview, for Revit 2027, with
  read-only tools (model queries, element data, view navigation, view export); write tools announced as in
  development as a separate server. Third-party MCP servers claim read / write and Revit 2024–2027 support; these are
  vendor claims, to be tested on non-production models before any use.
- **AutoCAD:** no official Autodesk MCP server found (search 2026-10-15); options: a third-party connector after
  testing, or the client's AutoCAD automation APIs.
- **Autodesk Platform Services:** AEC Data Model API for cloud model data (geometry, properties, relationships).
- **Operating model:** a connector agent runs on the client's licensed Windows machine; the system sends structured
  commands, receives RVT / DWG / IFC / PDF outputs and data; every write to a model is a draft revision approved by
  the responsible engineer; licences and versions are the client's responsibility. The connector is authenticated per
  company, opens outbound connections only, accepts only signed commands from the system and logs every command.

## 5. Interior design pipeline (MP-02 D07)
1. **Base:** verified as-built from survey, point cloud or measured photos (D07.01).
2. **Layouts:** option generator with hard constraints (room geometry, doors / windows, clearances, circulation,
   furniture library dimensions, code requirements entered by the company) producing the number of options the
   company sets; each option scored against the brief.
3. **Style:** style boards from a curated material / product library; generated images (if used) come from models
   whose licences permit commercial use and are labelled as AI-generated.
4. **3D:** scene assembled from library assets (GLB) and materials; real-time browser viewer; photorealistic
   renders by an offline renderer run as a separate program (§6).
5. **Quantities and BOQ:** materials, finishes and FF&E quantities computed from the model → interior BOQ with codes
   (D07.05).
6. **2D package:** plans, elevations, sections, details, schedules produced by the CAD engine (§2) from the model.
7. **Approval:** client approval recorded per stage; then shop drawings (D07.07).

## 6. Open-source and third-party component register
Licence facts are taken from the package registry or the project's own documentation on 2026-10-15 and re-checked
at adoption (OQS-001). Copyleft components (GPL / AGPL) are never linked into the sold product; they are used only
as separate programs / services after legal review, or replaced by a permissive or commercial alternative.
| Component | Purpose | Licence | Verified from | Rule |
|---|---|---|---|---|
| MPXJ | Read / write XER, P6 XML, MSPDI, MPP | LGPL-2.1-or-later (one older build listed differently — exact version to be checked) | Package registries (RubyGems, NuGet), SourceForge | Separate Java service; LGPL obligations met |
| frappe-gantt | Gantt rendering (UI) | MIT | npm registry | May be replaced by an in-house Gantt if scale requires |
| dxf-parser | DXF read | MIT | npm registry | Parser only |
| @tarikjabiri/dxf | DXF write | MIT | npm registry | — |
| makerjs | 2D geometry / DXF | Apache-2.0 | npm registry | Optional |
| konva, fabric | 2D canvas rendering | MIT | npm registry | UI layer only; geometry kept in the engine's own model |
| LibreDWG | DWG read / write | GPL-3.0-or-later | Project manual (gnu.org) | Separate program only, after legal review; or commercial DWG SDK |
| web-ifc | IFC read / write (WASM) | MPL-2.0 | npm registry | File-level copyleft obligations met |
| @thatopen/components | BIM viewer / tools | MIT | npm registry | — |
| three | 3D rendering | MIT | npm registry | — |
| IfcOpenShell (core libraries) | Server-side IFC processing | LGPL-3.0-or-later (its Blender add-ons are GPL-3.0-or-later) | Project repository listings | Separate service; GPL add-ons not used in the product |
| Open CASCADE Technology | Solid geometry kernel | LGPL-2.1 with the Open CASCADE exception (versions ≥ 6.7.0) | OCCT documentation, SPDX | If needed; notice of reliance included |
| @xeokit/xeokit-sdk | BIM viewer | AGPL-3.0 | npm registry | **Not used** unless a commercial licence is bought |
| FreeCAD | Desktop CAD (reference / tooling) | LGPL-2.0-or-later | FreeCAD licence file | Not embedded |
| potree | Point-cloud viewer | BSD-2-Clause | npm registry | — |
| Blender | Offline rendering | GPL (version to be confirmed — not verified by search) | **Not verified** | Separate program only, after licence verification |
| PDAL | Point-cloud processing | **Not verified** | — | Verify before use |
| exceljs, docx, pptxgenjs, pdf-lib, playwright | Exports (MP-03) | MIT, MIT, MIT, MIT, Apache-2.0 | npm registry | As MP-03 §5 |

## 7. Accuracy, responsibility and acceptance
- Engineering outputs (calculations, temporary works, structural / MEP design checks, shop drawings) are approved by
  the responsible licensed engineer; the system records who approved, never the agent.
- Each engine has a reference test set: schedules compared with P6 results (§1), DXF / IFC round-trip without loss of
  geometry or identifiers, quantities compared with checked manual take-offs, clash results compared with a known
  coordination model.
- Legal and intellectual property: automation of Autodesk products through connectors must respect Autodesk's licence
  and terms of use (client / legal check per deployment); furniture, family and block libraries and manufacturer
  models are used only under their licences; generated images are labelled and used only where the generating
  model's licence allows commercial use.
- Precision: geometry stored in real units with defined tolerance per company standard; money and quantities stored
  and exported as exact database values (MP-03 §5).

## 8. Coverage and review record
**Counts (computed from this file):** scheduling 16 capabilities · CAD 8 · BIM 8 · interior pipeline 7 stages ·
18 component entries in the register (16 licences confirmed from registries / project documentation, 2 marked
"not verified": Blender, PDAL).

**Review log (OQS-001):**
- R3 truth: every code statement checked in the repository — CPM endpoint (`planning.routes.ts`, whole-day forward /
  backward pass, total and free float, critical path, FS / SS / FF / SF with lag), refused relationship loops and
  CPM exercised by `tests/e2e/wave2_programme.mjs` (E1, gate suite), tables from migrations 029 / 047, drawing register
  from migrations 004 / 025; no CAD, BIM, Autodesk or point-cloud code exists. Licences read from the npm registry
  (16 packages) and from project documentation / registries for MPXJ, IfcOpenShell, LibreDWG, OCCT, FreeCAD; Autodesk
  facts from Autodesk's and Cadalyst's 2026 publications (sources below). Unverifiable items are labelled, not
  asserted.
- Hostile pass 1 (planning / BIM expert): added portfolio resource levelling, linear / location-based scheduling,
  quantitative schedule risk, the source of the P6 reference results (company's licensed planner), CAD external
  references / plot styles / project coordinate system, BIM model checks against the BIM execution plan, COBie-style
  hand-over data, and the security of the Autodesk connector (per-company authentication, outbound-only, signed and
  logged commands).
- Hostile pass 2 (legal / IP): added Autodesk licence-terms compliance for connectors, licence-bound use of furniture /
  family / block libraries and manufacturer models, and commercial-use licence condition for generated images;
  copyleft rule made explicit (never linked into the sold product).
- Residual (stated): parity with Primavera / AutoCAD / Revit is a target measured by the acceptance tests in §1 and
  §7, not a claim; no engine capability is to be announced before it passes them.

**Status:** reviewed (code and licence verification + two hostile passes); awaiting owner approval.

## Sources
- [Autodesk — Revit Public MCP Server (June 2026)](https://www.autodesk.com/blogs/aec/2026/06/17/revit-public-mcp-server/)
- [Autodesk Platform Services — Building agentic AI (DevCon 2026)](https://aps.autodesk.com/blog/building-agentic-ai-whats-new-autodesk-platform-services)
- [Cadalyst — MCP: a new standard for connecting AI to AEC software](https://blog.cadalyst.com/architecture-infrastructure-construction-solutions/mcp-a-new-standard-for-connecting-ai-to-aec-software)
- [MPXJ (GitHub)](https://github.com/joniles/mpxj) · [MPXJ on SourceForge](https://sourceforge.net/p/mpxj)
- [IfcOpenShell (project overview)](https://www.sourcepulse.org/projects/1481160)
- [LibreDWG manual — overview](https://www.gnu.org/software/libredwg/manual/html_node/Overview.html)
- [Open CASCADE Technology public licence](https://dev.opencascade.org/doc/overview/html/occt_public_license.html) · [SPDX OCCT-exception-1.0](https://spdx.org/licenses/OCCT-exception-1.0.html)
- [FreeCAD licence file](https://gitverse.ru/gbykov/FreeCAD/content/main/tools/build/WindowsInstaller/License.rtf)
- npm registry metadata (`npm view <package> license`, 2026-10-15) for web-ifc, @thatopen/components, @xeokit/xeokit-sdk,
  three, frappe-gantt, dxf-parser, makerjs, @tarikjabiri/dxf, konva, fabric, potree, exceljs, docx, pptxgenjs, pdf-lib,
  playwright.
