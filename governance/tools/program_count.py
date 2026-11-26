"""Exact count of distinct programs in the owner list (451 entries) and the MARC supplementary register (65 entries).
Rules (MP-08 §8a): R1 the unit is a separately named product as written in the source; R2 an entry naming several
distinct products counts each; R3 two names of the same product count once (regional editions and edition tiers of one
product line are the same product; a family entry is covered by its listed editions; an AI / feature layer of a listed
product is not a separate product); R4 a repeated entry counts once; R5 an entry the source marks as alias counts zero;
R6 a generic group ("partner / ISV editions") is not a product and counts zero; R7 a suite sold under its own name counts
as a product. Every decision below is listed with its rule; anything not listed counts 1.
Usage: python3 program_count.py OWNER_CSV SUPPLEMENT_CSV OUT_CSV"""
import csv, re, sys
owner, supp, out = sys.argv[1], sys.argv[2], sys.argv[3]
# source_id -> (counted value, rule, note)
OWNER_DECISIONS = {
 # R4 repeated entries (the second occurrence counts 0; the first keeps 1)
 '07.001': (0, 'R4', 'same as 11.002 Autodesk Revit'), '07.003': (0, 'R4', 'same as 11.003 Autodesk AutoCAD'),
 '07.004': (0, 'R4', 'same as 11.007 Autodesk Civil 3D'), '03.104': (0, 'R4', 'same as 11.011 Autodesk Docs'),
 '05.013': (0, 'R4', 'same as 11.013 Autodesk Takeoff'), '07.018': (0, 'R4', 'same as 11.018 Autodesk Robot Structural Analysis'),
 '07.012': (0, 'R4', 'same as 12.003 Graphisoft Archicad'), '12.042': (0, 'R4', 'same as 02.021 Houzz Pro'),
 '07.015': (0, 'R4', 'same as 13.001 ETABS'), '07.017': (0, 'R4', 'same as 13.002 SAFE'), '07.016': (0, 'R4', 'same as 13.003 SAP2000'),
 '07.019': (0, 'R4', 'same as 15.001 Bentley OpenRoads Designer'), '07.010': (0, 'R4', 'same as 15.006 Bentley ProjectWise'),
 '06.004': (0, 'R4', 'same as 15.008 Bentley SYNCHRO 4D'), '03.101': (0, 'R4', 'same as 15.011 Bentley AssetWise'),
 '15.024': (0, 'R4', 'same as 04.012 DroneDeploy'),
 # R3 same product under another name
 '11.026': (0, 'R3', 'same entry as 03.002 Autodesk Forma / Autodesk Construction Cloud (the source calls it platform naming)'),
 '07.101': (0, 'R3', 'Bentley iTwin = 15.007 Bentley iTwin Platform'), '09.038': (0, 'R3', 'IBM Maximo = 16.015 IBM Maximo Application Suite'),
 '04.022': (0, 'R3', 'Oracle Construction Intelligence = 03.017 Oracle Construction Intelligence Cloud'),
 '09.033': (0, 'R3', 'Monday.com = 06.012 Monday.com Work Management'), '03.103': (0, 'R3', 'e-Builder Enterprise = 03.008 Trimble e-Builder'),
 '08.016': (0, 'R3', 'regional edition of 02.026 RIB BuildSmart'), '08.014': (0, 'R3', 'regional edition of 02.027 In4Suite'),
 '08.015': (0, 'R3', 'regional edition of 02.028 Farvision ERP'), '07.002': (0, 'R3', 'family entry covered by 11.009 Navisworks Manage and 11.010 Navisworks Simulate'),
 '12.002': (0, 'R3', 'SketchUp Studio is a subscription tier of 12.001 SketchUp Pro product line'),
 '04.020': (0, 'R3', 'Procore AI / Helix is the AI layer of 03.001 Procore'),
 '08.003': (1, 'R3', 'Focus X / Focus 9 are versions of one product'),
 # R5 aliases marked by the source
 '05.019': (0, 'R5', 'marked alias by the source (Candy CCS = 05.002 RIB Candy)'), '10.009': (0, 'R5', 'marked alias by the source (n8n AI Agent = 09.011 n8n)'),
 # R6 generic groups
 '08.017': (0, 'R6', 'Odoo Construction partner editions - a group, not one product'), '08.018': (0, 'R6', 'Dynamics 365 Construction ISV editions - a group, not one product'),
 # R2 several products in one entry
 '10.010': (2, 'R2', 'LangChain and LangGraph are two products'),
}
SUPP_DECISIONS = {
 'Microsoft Outlook / Exchange': (2, 'R2'), 'Microsoft OneDrive / Dropbox / Box': (3, 'R2'), 'Intelex / Cority / Enablon (EHS)': (3, 'R2'),
 'Rhinoceros (Rhino) + Grasshopper': (1, 'R3 Grasshopper ships inside Rhino'), 'PTV Vissim / Synchro traffic': (2, 'R2'),
 'Bentley WaterCAD / SewerCAD / StormCAD': (3, 'R2'), 'Deltek Vantagepoint / BQE CORE (A&E practice)': (2, 'R2'),
 'Kantata / Monograph (professional services)': (2, 'R2'), 'spColumn / CSiCol': (2, 'R2'), 'Property Finder / Bayut (portals)': (2, 'R2'),
}
rows, total_o = [], 0
for r in csv.DictReader(open(owner, encoding='utf-8-sig')):
    v, rule, note = OWNER_DECISIONS.get(r['source_id'], (1, 'R1', ''))
    total_o += v; rows.append(['owner', r['source_id'], r['name'], v, rule, note])
seen = set(OWNER_DECISIONS)
total_s = 0
for r in csv.DictReader(open(supp, encoding='utf-8')):
    v, rule = SUPP_DECISIONS.get(r['program'], (1, 'R1'))
    total_s += v; rows.append(['supplement', r['supp_id'], r['program'], v, rule, ''])
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['list', 'id', 'name', 'counted', 'rule', 'note']); w.writerows(rows)
unused = [k for k in OWNER_DECISIONS if k not in {x[1] for x in rows}] + [k for k in SUPP_DECISIONS if k not in {x[2] for x in rows}]
print('owner entries', sum(1 for x in rows if x[0] == 'owner'), 'distinct programs', total_o)
print('supplement entries', sum(1 for x in rows if x[0] == 'supplement'), 'distinct programs', total_s)
print('combined distinct programs', total_o + total_s, '| decisions not matched (must be empty):', unused)
