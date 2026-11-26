"""Regression cases for trade_map.py (each was a wrong mapping found in review, CC-107). Run: python3 test_trade_map.py"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trade_map import trades_for
CASES = {'nails wires': ['hardware_ironmongery'], 'fiberglass': ['insulation_waterproofing'], 'solar panels': ['solar_energy'],
 'sandwich panel': ['cladding_facades'], 'air curtains': ['hvac'], 'gate valves': ['valves'], 'pipe clamps': ['pipes_fittings'],
 'waterproofing contractors': ['insulation_waterproofing'], 'fire safety equipment': ['fire_fighting', 'safety_equipment'],
 'electronic systems equipment': ['electrical_supplies'], 'interlock tiles': ['blocks_bricks'], 'glass fittings': ['glass_glazing'],
 'pvc flooring': ['flooring'], 'led ceiling lights': ['lighting'], 'concrete repairs': ['building_maintenance'],
 'Marble -  Granite': ['marble_granite'], 'porcelain-tiles-c6649': ['ceramic_porcelain'], 'lifts-and-escalators-c7108': ['elevators_escalators'],
 'Elevators - Escalators': ['elevators_escalators'], 'Air Condition ': ['hvac'], 'metal roof water proofing': ['cladding_facades', 'insulation_waterproofing', 'metal_works_general']}
bad = [(c, trades_for(c), e) for c, e in CASES.items() if sorted(trades_for(c)) != sorted(e)]
for b in bad: print('FAIL', b)
print('trade_map cases', len(CASES), 'failures', len(bad)); sys.exit(1 if bad else 0)
