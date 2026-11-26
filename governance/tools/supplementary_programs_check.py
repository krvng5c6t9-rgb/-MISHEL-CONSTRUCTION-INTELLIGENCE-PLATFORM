import csv, sys, re
src, out = sys.argv[1], sys.argv[2]
have = [re.sub(r'[^a-z0-9]+', ' ', r['name'].lower()) for r in csv.DictReader(open(src, encoding='utf-8-sig'))]
blob = ' | '.join(have)
# (domain, program, match terms, MARC strategy, wave)
C = [
 # Documents, PDF and office
 ('Documents / office', 'Adobe Acrobat Pro', ['acrobat'], 'REPLACE_NATIVE (PDF viewer, markup, stamps, compare, sign workflow)', 'W3'),
 ('Documents / office', 'Foxit PDF Editor', ['foxit'], 'REPLACE_NATIVE (PDF tools)', 'W3'),
 ('Documents / office', 'Nitro PDF Pro', ['nitro'], 'REPLACE_NATIVE (PDF tools)', 'W3'),
 ('Documents / office', 'Microsoft Excel', ['excel'], 'INTEGRATE (xlsx exchange - built CC-098) + native grid views', 'W1'),
 ('Documents / office', 'Microsoft Word', ['microsoft word'], 'INTEGRATE (docx generation of letters, reports, contracts)', 'W1'),
 ('Documents / office', 'Microsoft PowerPoint', ['powerpoint'], 'INTEGRATE (pptx report packs)', 'W5'),
 ('Documents / office', 'Microsoft Outlook / Exchange', ['outlook', 'exchange online'], 'INTEGRATE (mail capture to correspondence register)', 'W3'),
 ('Documents / office', 'Microsoft Teams', ['teams'], 'INTEGRATE (notifications, meetings)', 'W3'),
 ('Documents / office', 'Google Workspace', ['google workspace'], 'INTEGRATE (mail, drive, calendar)', 'W3'),
 ('Documents / office', 'Microsoft Visio', ['visio'], 'REPLACE_NATIVE (org charts, process diagrams)', 'W5'),
 ('Documents / office', 'Microsoft OneDrive / Dropbox / Box', ['onedrive', 'dropbox', ' box '], 'INTEGRATE (file sources for EDMS)', 'W3'),
 ('Documents / office', 'DocuSign', ['docusign'], 'INTEGRATE (e-signature) + native signing workflow', 'W3'),
 ('Documents / office', 'Adobe Acrobat Sign', ['acrobat sign'], 'INTEGRATE (e-signature)', 'W3'),
 ('Documents / office', 'M-Files', ['m files'], 'REPLACE_NATIVE (EDMS)', 'W3'),
 ('Documents / office', 'OpenText Content Suite', ['opentext'], 'REPLACE_NATIVE (EDMS)', 'W3'),
 ('Documents / office', 'Autodesk Vault', ['vault'], 'INTEGRATE (CAD file vault)', 'W6'),
 ('Documents / office', 'Newforma Project Center', ['newforma'], 'REPLACE_NATIVE (project information management)', 'W3'),
 ('Documents / office', 'Zoom', ['zoom'], 'INTEGRATE (meetings to minutes)', 'W5'),
 ('Documents / office', 'Slack', ['slack'], 'INTEGRATE (notifications)', 'W3'),
 # Work and project management (general)
 ('Project management (general)', 'Smartsheet', ['smartsheet'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Monday.com', ['monday'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Asana', ['asana'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Trello', ['trello'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Jira', ['jira'], 'REPLACE_NATIVE (issue tracking)', 'W3'),
 ('Project management (general)', 'ClickUp', ['clickup'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Wrike', ['wrike'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Notion', ['notion'], 'REPLACE_NATIVE (knowledge pages)', 'W3'),
 ('Project management (general)', 'Airtable', ['airtable'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Microsoft Planner', ['microsoft planner'], 'REPLACE_NATIVE', 'W3'),
 ('Project management (general)', 'Planisware', ['planisware'], 'REPLACE_NATIVE (portfolio)', 'W3'),
 # Scheduling
 ('Scheduling', 'Phoenix Project Manager', ['phoenix'], 'REPLACE_NATIVE (CPM)', 'W3'),
 ('Scheduling', 'Spider Project', ['spider'], 'REPLACE_NATIVE (resource scheduling)', 'W3'),
 ('Scheduling', 'Deltek Open Plan', ['open plan'], 'REPLACE_NATIVE', 'W3'),
 ('Scheduling', 'Safran Project', ['safran project'], 'REPLACE_NATIVE', 'W3'),
 ('Scheduling', 'Fuzor', ['fuzor'], 'INNOVATE (4D)', 'W6'),
 ('Scheduling', 'GanttPRO', ['ganttpro'], 'REPLACE_NATIVE', 'W3'),
 # Construction PM / field
 ('Construction PM / field', 'Asite', ['asite'], 'REPLACE_NATIVE (CDE)', 'W3'),
 ('Construction PM / field', 'Fieldwire', ['fieldwire'], 'REPLACE_NATIVE (field tasks)', 'W3'),
 ('Construction PM / field', 'Raken', ['raken'], 'REPLACE_NATIVE (daily reports)', 'W3'),
 ('Construction PM / field', 'Dalux', ['dalux'], 'REPLACE_NATIVE (field + BIM viewer)', 'W3'),
 ('Construction PM / field', 'LetsBuild', ['letsbuild'], 'REPLACE_NATIVE', 'W3'),
 ('Construction PM / field', 'Buildertrend', ['buildertrend'], 'REPLACE_NATIVE (residential builders)', 'W3'),
 ('Construction PM / field', 'Contractor Foreman', ['contractor foreman'], 'REPLACE_NATIVE', 'W3'),
 ('Construction PM / field', 'Archdesk', ['archdesk'], 'REPLACE_NATIVE', 'W3'),
 ('Construction PM / field', 'SafetyCulture (iAuditor)', ['safetyculture', 'iauditor'], 'REPLACE_NATIVE (inspections, HSE)', 'W3'),
 ('Construction PM / field', 'Intelex / Cority / Enablon (EHS)', ['intelex', 'cority', 'enablon'], 'REPLACE_NATIVE (HSE)', 'W3'),
 # Estimating / take-off
 ('Estimating / take-off', 'Buildsoft Cubit', ['cubit'], 'REPLACE_NATIVE (take-off)', 'W6'),
 ('Estimating / take-off', 'Causeway CATO', ['cato'], 'REPLACE_NATIVE (QS)', 'W6'),
 ('Estimating / take-off', 'HCSS HeavyBid', ['heavybid'], 'REPLACE_NATIVE (civil estimating)', 'W6'),
 ('Estimating / take-off', 'B2W Estimate', ['b2w'], 'REPLACE_NATIVE', 'W6'),
 ('Estimating / take-off', 'Glodon Cubicost', ['glodon', 'cubicost'], 'REPLACE_NATIVE (BIM take-off)', 'W6'),
 ('Estimating / take-off', 'Vico Office', ['vico'], 'INNOVATE (5D)', 'W6'),
 ('Estimating / take-off', 'Destini Estimator', ['destini'], 'REPLACE_NATIVE', 'W6'),
 # CAD / BIM / visual design
 ('CAD / BIM', 'AutoCAD LT', ['autocad lt'], 'INTEGRATE (DWG/DXF) + native viewer / markup', 'W6'),
 ('CAD / BIM', 'BricsCAD', ['bricscad'], 'INTEGRATE (DWG)', 'W6'),
 ('CAD / BIM', 'ZWCAD', ['zwcad'], 'INTEGRATE (DWG)', 'W6'),
 ('CAD / BIM', 'GstarCAD', ['gstarcad'], 'INTEGRATE (DWG)', 'W6'),
 ('CAD / BIM', 'DraftSight', ['draftsight'], 'INTEGRATE (DWG)', 'W6'),
 ('CAD / BIM', 'Allplan', ['allplan'], 'INTEGRATE (IFC)', 'W6'),
 ('CAD / BIM', 'Rhinoceros (Rhino) + Grasshopper', ['rhino'], 'INTEGRATE (3DM / IFC)', 'W6'),
 ('CAD / BIM', 'Autodesk Dynamo', ['dynamo'], 'INNOVATE (rule / script automation inside MARC)', 'W6'),
 ('CAD / BIM', 'Blender', ['blender'], 'INTEGRATE (glTF)', 'W6'),
 ('CAD / BIM', 'Twinmotion / Unreal Engine', ['twinmotion', 'unreal'], 'INTEGRATE (visualisation)', 'W6'),
 ('CAD / BIM', 'V-Ray / Corona / D5 Render', ['v ray', 'vray', 'corona', 'd5 render'], 'INTEGRATE (renders to gallery)', 'W6'),
 ('CAD / BIM', 'Autodesk AutoCAD Map 3D', ['map 3d'], 'INTEGRATE (GIS + CAD)', 'W6'),
 ('Visual / graphics', 'Adobe Premiere Pro', ['premiere'], 'INTEGRATE (site video)', 'W8'),
 ('Visual / graphics', 'Adobe After Effects', ['after effects'], 'INTEGRATE', 'W8'),
 ('Visual / graphics', 'Canva', ['canva'], 'INNOVATE (report / proposal templates)', 'W5'),
 ('Visual / graphics', 'Figma', ['figma'], 'INTEGRATE', 'W8'),
 ('Visual / graphics', 'CorelDRAW', ['corel'], 'INTEGRATE', 'W8'),
 # Structural / geotechnical
 ('Structural / geotechnical', 'Dlubal RFEM / RSTAB', ['rfem', 'rstab', 'dlubal'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'MIDAS Civil / Gen', ['midas'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'SCIA Engineer', ['scia'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'Tekla Structural Designer', ['structural designer'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'IDEA StatiCa', ['idea statica'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'RISA-3D', ['risa'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'Prokon', ['prokon'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'spColumn / CSiCol', ['spcolumn', 'csicol'], 'NATIVE_CALCULATOR (section checks, signed)', 'W6'),
 ('Structural / geotechnical', 'Hilti PROFIS Engineering', ['profis'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'ADAPT-Builder', ['adapt'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'GeoStudio', ['geostudio'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'Rocscience suite', ['rocscience', 'rs2', 'slide2'], 'INTEGRATE_CONNECTOR', 'W6'),
 ('Structural / geotechnical', 'OpenSees (open source)', ['opensees'], 'CANDIDATE ENGINE (licence and verification first)', 'W6'),
 # MEP / energy
 ('MEP / energy', 'MagiCAD', ['magicad'], 'INTEGRATE', 'W6'),
 ('MEP / energy', 'Trane TRACE 3D Plus', ['trace'], 'INTEGRATE + native load records', 'W6'),
 ('MEP / energy', 'Elite Software (CHVAC / HVAC)', ['elite'], 'INTEGRATE', 'W6'),
 ('MEP / energy', 'SKM PowerTools', ['skm'], 'INTEGRATE', 'W6'),
 ('MEP / energy', 'Caneco BT', ['caneco'], 'INTEGRATE', 'W6'),
 ('MEP / energy', 'EPANET (open source)', ['epanet'], 'CANDIDATE ENGINE (water networks)', 'W6'),
 ('MEP / energy', 'Pipe Flow Expert', ['pipe flow'], 'INTEGRATE', 'W6'),
 # Infrastructure / transport / survey
 ('Infrastructure / survey', '12d Model', ['12d'], 'INTEGRATE', 'W6'),
 ('Infrastructure / survey', 'AutoTURN', ['autoturn'], 'INTEGRATE', 'W6'),
 ('Infrastructure / survey', 'PTV Vissim / Synchro traffic', ['vissim', 'ptv'], 'INTEGRATE', 'W6'),
 ('Infrastructure / survey', 'Global Mapper', ['global mapper'], 'INTEGRATE (GIS)', 'W6'),
 ('Infrastructure / survey', 'Golden Surfer', ['surfer'], 'INTEGRATE (contours)', 'W6'),
 ('Infrastructure / survey', 'Carlson Survey', ['carlson'], 'INTEGRATE (survey)', 'W6'),
 ('Infrastructure / survey', 'Bentley WaterCAD / SewerCAD / StormCAD', ['watercad', 'sewercad', 'stormcad'], 'INTEGRATE', 'W6'),
 # Finance / ERP / HR (regional and SME)
 ('Finance / ERP / HR', 'QuickBooks', ['quickbooks'], 'REPLACE_NATIVE + migration import', 'W1'),
 ('Finance / ERP / HR', 'Xero', ['xero'], 'REPLACE_NATIVE + migration import', 'W1'),
 ('Finance / ERP / HR', 'Zoho Books', ['zoho books'], 'REPLACE_NATIVE + migration import', 'W1'),
 ('Finance / ERP / HR', 'Sage 50', ['sage 50'], 'REPLACE_NATIVE + migration import', 'W1'),
 ('Finance / ERP / HR', 'ERPNext', ['erpnext'], 'REPLACE_NATIVE + migration import', 'W1'),
 ('Finance / ERP / HR', 'Workday HCM', ['workday hcm', 'workday human'], 'REPLACE_NATIVE', 'W1'),
 ('Finance / ERP / HR', 'ADP', ['adp'], 'REPLACE_NATIVE (payroll)', 'W1'),
 ('Finance / ERP / HR', 'Jisr', ['jisr'], 'REPLACE_NATIVE (KSA HR / payroll)', 'W1'),
 ('Finance / ERP / HR', 'ZenHR', ['zenhr'], 'REPLACE_NATIVE (MENA HR)', 'W1'),
 ('Finance / ERP / HR', 'Bayzat', ['bayzat'], 'REPLACE_NATIVE (UAE HR)', 'W1'),
 ('Finance / ERP / HR', 'Deltek Vantagepoint / BQE CORE (A&E practice)', ['vantagepoint', 'bqe'], 'REPLACE_NATIVE (design-office profile)', 'W1'),
 ('Finance / ERP / HR', 'Kantata / Monograph (professional services)', ['kantata', 'monograph'], 'REPLACE_NATIVE (design-office profile)', 'W1'),
 # Facilities / maintenance / fleet
 ('Facilities / maintenance / fleet', 'IBM Maximo', ['maximo'], 'REPLACE_NATIVE (CMMS)', 'W4'),
 ('Facilities / maintenance / fleet', 'Archibus', ['archibus'], 'REPLACE_NATIVE (IWMS)', 'W4'),
 ('Facilities / maintenance / fleet', 'Fiix / UpKeep / eMaint', ['fiix', 'upkeep', 'emaint'], 'REPLACE_NATIVE (CMMS)', 'W4'),
 ('Facilities / maintenance / fleet', 'HCSS Equipment360 / Tenna', ['equipment360', 'tenna'], 'REPLACE_NATIVE (plant)', 'W1'),
 ('Facilities / maintenance / fleet', 'Samsara (telematics)', ['samsara'], 'INTEGRATE (telematics feed)', 'W3'),
 # Real estate
 ('Real estate', 'Yardi', ['yardi'], 'REPLACE_NATIVE (W4 developer suite)', 'W4'),
 ('Real estate', 'MRI Software', ['mri '], 'REPLACE_NATIVE (W4 developer suite)', 'W4'),
 ('Real estate', 'Property Finder / Bayut (portals)', ['property finder', 'bayut'], 'INTEGRATE (listing feeds)', 'W4'),
 # BI / data / AI
 ('BI / data / AI', 'Qlik Sense', ['qlik'], 'REPLACE_NATIVE (analytics CC-099)', 'W5'),
 ('BI / data / AI', 'Looker', ['looker'], 'REPLACE_NATIVE (analytics)', 'W5'),
 ('BI / data / AI', 'ChatGPT / OpenAI', ['chatgpt', 'openai'], 'AI_NATIVE (provider-neutral AI layer)', 'W5'),
 ('BI / data / AI', 'Google Gemini', ['gemini'], 'AI_NATIVE (provider-neutral AI layer)', 'W5'),
]
miss, found = [], []
for dom, name, terms, strat, wave in C:
    hit = next((t for t in terms if (' ' + t.strip() + ' ') in (' ' + blob + ' ')), None)
    (found if hit else miss).append((dom, name, strat, wave, hit))
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['supp_id', 'domain', 'program', 'marc_strategy', 'wave', 'marc_status', 'source'])
    for i, (dom, name, strat, wave, _) in enumerate(miss, 1):
        w.writerow([f'S.{i:03d}', dom, name, strat, wave, 'PARTIAL' if 'built CC-098' in strat or 'CC-099' in strat else 'NOT_STARTED', 'MARC review 2026-11-26: not in the owner list'])
print('checked', len(C), 'already in list', len(found), 'missing', len(miss))
print('IN LIST:', '; '.join(f'{n}({h})' for _, n, _, _, h in found))
import collections; print(collections.Counter(m[0] for m in miss))
