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
# Owner decisions 2026-11-26 (CC-106): (1) marketing / SEO / advertising / social / e-commerce tools -> a separate MARC
# marketing and e-commerce application, phase 2 after the program; CRM, sales and customer-service tools stay in MARC;
# (2) graphics / video / media tools are built natively in MARC at the level of the leading paid programs, with AI;
# (3) IT infrastructure products are MARC's own technology (platform), not functions to replace.
CRM_CORE = {'SW-0182', 'SW-0186', 'SW-0188', 'SW-0189', 'SW-0190', 'SW-0191', 'SW-0192', 'SW-0193', 'SW-0198', 'SW-0201', 'SW-0203',
            'SW-0204', 'SW-0205', 'SW-0206', 'SW-0208', 'SW-0219', 'SW-0220', 'SW-0221', 'SW-0224', 'SW-0228', 'SW-0233', 'SW-0234',
            'SW-0241', 'SW-0242', 'SW-0243', 'SW-0244', 'SW-0246', 'SW-0247'}
def decide(rid, disc, f, st, wv, ai, note):
    if disc == 'CRM marketing & business':
        if rid in CRM_CORE:
            return ('Native CRM, sales, customer service and field service', 'PARTIAL', 'W1', 'AI follows up leads, drafts offers and answers customers; approval by the responsible person', '')
        return ('Separate MARC marketing and e-commerce application (phase 2, after the program)', 'SEPARATE_APP_PHASE2', 'PHASE2', 'AI writes and runs campaigns, SEO and store operations', 'owner decision 2026-11-26: separate app, phase 2')
    if disc == 'Graphic design & media':
        return ('Native graphics, photo, video, audio, font and media tools at the level of the leading paid programs, with AI', 'NOT_STARTED', 'W6', 'AI creates and edits images, videos, presentations and designs on request', 'owner decision 2026-11-26: native in MARC')
    if disc == 'IT software & cybersecurity':
        return ("MARC's own technology stack and IT administration (platform)", 'PLATFORM', 'PLATFORM', 'AI assists IT administration inside MARC', 'owner decision 2026-11-26: platform components, not replaced')
    return (f, st, wv, ai, note)
wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
M = list(wb['Master Inventory'].iter_rows(values_only=True)); h = M[0]
rows = [dict(zip(h, r)) for r in M[1:] if any(r)]
outr = []
for r in rows:
    f, st, wv, ai, note = decide(r['ID'], r['Discipline'], *D[r['Discipline']])
    outr.append([r['ID'], 'owner inventory', r['Discipline'], r['Vendor / developer'], r['Program / named tool'], r['Short description'], f, st, wv, ai, note])
for i, (disc, ven, prog) in enumerate(SUPP, 1):
    f, st, wv, ai, note = decide(f'MARC-S{i:03d}', disc, *D[disc])
    outr.append([f'MARC-S{i:03d}', 'MARC supplement (verified absent)', disc, ven, prog, '', f, st, wv, ai, note])
with open(out, 'w', newline='', encoding='utf-8') as fo:
    w = csv.writer(fo); w.writerow(['id', 'source', 'discipline', 'vendor', 'program', 'description', 'marc_function', 'marc_status', 'wave', 'ai_assistant', 'scope_note']); w.writerows(outr)
import collections
print('rows', len(outr), '= inventory', len(rows), '+ supplement', len(SUPP))
print('by status', dict(collections.Counter(x[7] for x in outr)))
print('by wave', dict(collections.Counter(x[8] for x in outr)))
print('CRM core kept', sum(1 for x in outr if x[2] == 'CRM marketing & business' and x[7] == 'PARTIAL'), '| pending decisions', sum(1 for x in outr if x[10].startswith('OWNER DECISION')))
