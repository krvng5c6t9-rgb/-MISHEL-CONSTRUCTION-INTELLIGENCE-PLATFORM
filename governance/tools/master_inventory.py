"""MARC master inventory = owner inventory (NEXORA_SOFTWARE_MASTER_INVENTORY.xlsx, 1,662 named programs / tools) + the
programs of the MARC supplementary register that the inventory does not contain (checked by name and by keyword, 19).
Unit (inventory's own rule): a named application, separately identifiable tool or module; no duplicate normalised names.
Status is per discipline, measured against MARC's gate (not product parity). Usage: python3 master_inventory.py XLSX OUT_CSV"""
import csv, sys
import openpyxl
xlsx, out = sys.argv[1], sys.argv[2]
# discipline -> (MARC function, current MARC status, wave, AI assistant, scope note)
D = {
 'ERP & finance': ('Native finance: GL, AP/AR, treasury, tax, budgeting, consolidation, expenses', 'PARTIAL', 'W1', 'AI does entries, reconciliations, closing and reports; approval by the accountable person', ''),
 'Construction & project controls': ('Native contracts, BOQ, IPC, cost, schedule, field, CDE, estimating', 'PARTIAL', 'W1/W3', 'AI prepares IPCs, schedules, take-off, reports and RFIs; approval by the responsible person', ''),
 'HR & workforce': ('Native HR, payroll per country, attendance, recruitment, learning, performance', 'PARTIAL', 'W1', 'AI prepares payroll, recruitment shortlists and HR letters; approval by HR', ''),
 'Procurement & logistics': ('Native procurement, supplier directory, stores, logistics, fleet', 'PARTIAL', 'W1/W2/W7', 'AI drafts RFQs, compares offers and tracks deliveries; approval by the buyer', ''),
 'QA QC HSE & facilities': ('Native QA/QC, HSE, inspections, labs, facilities and maintenance', 'PARTIAL', 'W3/W4', 'AI drafts inspections, NCRs and HSE observations from photos and voice', ''),
 'Work management & document control': ('Native tasks, documents, EDMS, collaboration, OCR', 'PARTIAL', 'W3', 'AI files, summarises, routes and chases documents and tasks', ''),
 'CRM marketing & business': ('Native CRM, sales, service desk; marketing and e-commerce tools', 'PARTIAL', 'W1/W7', 'AI follows up leads and drafts offers and campaigns', 'OWNER DECISION: marketing / SEO / e-commerce tools - native in MARC or out of scope'),
 'AI data analytics & automation': ('Native analytics, automation, AI agents and data pipelines', 'PARTIAL', 'W5', 'AI answers questions, builds dashboards and automations from plain words', ''),
 'Engineering CAD & BIM': ('Native 2D drafting, BIM modelling, coordination and clash detection', 'NOT_STARTED', 'W6', 'AI draws and models on request; the user reviews and edits', ''),
 'Architecture & visualization': ('Native architectural / interior design, rendering and visualisation', 'NOT_STARTED', 'W6', 'AI designs layouts, interiors and renders on request', ''),
 'Structural & Geotechnical': ('Native structural / geotechnical analysis and design engines, verified', 'NOT_STARTED', 'W6', 'AI builds and runs the analysis and drafts the report; the licensed engineer signs', ''),
 'MEP & energy': ('Native MEP, electrical, lighting, energy and solar calculation', 'NOT_STARTED', 'W6', 'AI sizes systems and runs calculations; the licensed engineer signs', ''),
 'Infrastructure & geospatial': ('Native roads, drainage, networks, GIS, survey, point clouds', 'NOT_STARTED', 'W6', 'AI designs alignments and networks from survey data; the engineer reviews', ''),
 'Mechanical & Industrial': ('Native mechanical / plant design and simulation (lowest priority)', 'NOT_STARTED', 'W8', 'AI prepares equipment and plant design drafts; the engineer reviews', ''),
 'Legal & compliance': ('Native contract lifecycle, legal matters, compliance and risk registers', 'PARTIAL', 'W5', 'AI reviews contracts and flags risks with cited clauses; counsel approves', ''),
 'Graphic design & media': ('Graphics, video, fonts and media tools', 'NOT_STARTED', 'W8', 'AI produces graphics, presentations and videos on request', 'OWNER DECISION: general graphic / media tools - native in MARC or out of scope'),
 'IT software & cybersecurity': ('Platform components and IT administration (databases, DevOps, monitoring, security tools)', 'PLATFORM', 'W1', 'AI assists IT administration inside MARC', 'OWNER DECISION: infrastructure products (e.g. PostgreSQL, Git, Redis) are components MARC runs on, not business functions to replace'),
}
SUPP = [  # verified absent from the inventory (name and keyword search, 2026-11-26)
 ('Work management & document control', 'Microsoft', 'Microsoft Exchange'), ('Construction & project controls', 'Planisware', 'Planisware'),
 ('Construction & project controls', 'Phoenix', 'Phoenix Project Manager'), ('Construction & project controls', 'Kalloc', 'Fuzor'),
 ('Construction & project controls', 'Causeway', 'Causeway CATO'), ('Construction & project controls', 'Glodon', 'Glodon Cubicost'),
 ('Construction & project controls', 'Trimble', 'Vico Office'), ('Construction & project controls', 'Beck Technology', 'DESTINI Estimator'),
 ('Engineering CAD & BIM', 'Autodesk', 'AutoCAD LT'), ('Engineering CAD & BIM', 'Gstarsoft', 'GstarCAD'),
 ('Structural & Geotechnical', 'Hilti', 'Hilti PROFIS Engineering'), ('Infrastructure & geospatial', 'Transoft Solutions', 'AutoTURN'),
 ('Infrastructure & geospatial', 'Golden Software', 'Surfer'), ('ERP & finance', 'Deltek', 'Deltek Vantagepoint'),
 ('ERP & finance', 'BQE Software', 'BQE CORE'), ('ERP & finance', 'Kantata', 'Kantata'), ('ERP & finance', 'Monograph', 'Monograph'),
 ('CRM marketing & business', 'Property Finder', 'Property Finder'), ('CRM marketing & business', 'Bayut', 'Bayut'),
]
wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
M = list(wb['Master Inventory'].iter_rows(values_only=True)); h = M[0]
rows = [dict(zip(h, r)) for r in M[1:] if any(r)]
outr = []
for r in rows:
    f, st, wv, ai, note = D[r['Discipline']]
    outr.append([r['ID'], 'owner inventory', r['Discipline'], r['Vendor / developer'], r['Program / named tool'], r['Short description'], f, st, wv, ai, note])
for i, (disc, ven, prog) in enumerate(SUPP, 1):
    f, st, wv, ai, note = D[disc]
    outr.append([f'MARC-S{i:03d}', 'MARC supplement (verified absent)', disc, ven, prog, '', f, st, wv, ai, note])
with open(out, 'w', newline='', encoding='utf-8') as fo:
    w = csv.writer(fo); w.writerow(['id', 'source', 'discipline', 'vendor', 'program', 'description', 'marc_function', 'marc_status', 'wave', 'ai_assistant', 'scope_note']); w.writerows(outr)
import collections
print('rows', len(outr), '= inventory', len(rows), '+ supplement', len(SUPP))
print('by status', dict(collections.Counter(x[7] for x in outr)))
print('owner decision rows', sum(1 for x in outr if x[10]), dict(collections.Counter(x[2] for x in outr if x[10])))
