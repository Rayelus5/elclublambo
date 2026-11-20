"""Run from anywhere: `python games/galaxy/scripts/lab-tree.py` prints the totals, `… write` rewrites the files.

Generates the expanded Laboratorio (shop and lab plan, F2b): the 16 nodes of today untouched plus ~91 new ones in
rings, and the Season 2 tree. Prints totals per stat, caps and costs so the numbers can be tuned before they are fixed."""
import json, math, os, sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ops')

# Today's tree (packages/shared/src/lab/tree.ts DEFAULT_LAB_NODES), exactly.
ROOT = {'dust': 40, 'components': 15}
MID = {'dust': 60, 'components': 20}
DEEP = {'dust': 100, 'components': 40}
def old(id, branch, name, effect, per, requires, cost):
    return {'id': id, 'branch': branch, 'name': name, 'effect': effect, 'per': per, 'max': 5, 'requires': requires, 'cost': cost, 'growth': 1.6, 'falloff': 1, 'at': None}
TODAY = [
    old('hull', 'probe', 'Blindaje reforzado', {'kind': 'stat', 'stat': 'maxHp'}, 0.02, None, ROOT),
    old('thrusters', 'probe', 'Propulsores', {'kind': 'stat', 'stat': 'speed'}, 0.01, 'hull', MID),
    old('targeting', 'probe', 'Puntería', {'kind': 'stat', 'stat': 'damage'}, 0.02, 'hull', MID),
    old('reactor', 'probe', 'Reactor', {'kind': 'stat', 'stat': 'cooldown'}, 0.01, 'targeting', DEEP),
    old('resonance', 'relics', 'Resonancia', {'kind': 'stat', 'stat': 'elemental'}, 0.03, None, ROOT),
    old('fortune', 'relics', 'Fortuna', {'kind': 'stat', 'stat': 'luck'}, 0.03, 'resonance', MID),
    old('recycling', 'relics', 'Reciclaje', {'kind': 'disintegrate'}, 0.04, 'resonance', MID),
    old('stable-fusion', 'relics', 'Fusión estable', {'kind': 'fusion'}, 0.04, 'recycling', DEEP),
    old('throughput', 'station', 'Caudal', {'kind': 'refinery', 'field': 'rate'}, 0.05, None, ROOT),
    old('silos', 'station', 'Silos', {'kind': 'refinery', 'field': 'queue'}, 0.1, 'throughput', MID),
    old('receiver', 'station', 'Receptor', {'kind': 'antenna'}, 0.05, 'throughput', MID),
    old('salvage', 'station', 'Chatarrería', {'kind': 'payout', 'currency': 'material'}, 0.04, 'silos', DEEP),
    old('magnet', 'extraction', 'Imán', {'kind': 'stat', 'stat': 'pickup'}, 0.04, None, ROOT),
    old('ledger', 'extraction', 'Contabilidad', {'kind': 'payout', 'currency': 'coins'}, 0.02, 'magnet', MID),
    old('sieve', 'extraction', 'Tamiz', {'kind': 'payout', 'currency': 'dust'}, 0.02, 'magnet', MID),
    old('study', 'extraction', 'Estudio', {'kind': 'stat', 'stat': 'xp'}, 0.02, 'ledger', DEEP),
]

def stat(s): return {'kind': 'stat', 'stat': s}
def pay(c): return {'kind': 'payout', 'currency': c}
REF = lambda f: {'kind': 'refinery', 'field': f}
ANT = {'kind': 'antenna'}
DIS = {'kind': 'disintegrate'}
FUS = {'kind': 'fusion'}

# Cost of the first level by ring (rings 2..5 from the core; today's nodes are rings 0..2).
RING_COST = {2: (110, 26), 3: (170, 38), 4: (250, 54), 5: (360, 76)}
FALLOFF = {2: 0.92, 3: 0.9, 4: 0.88, 5: 0.86}

# (id, name, effect, per, requires, ring, max)
NEW = {
 'probe': [
  ('afterburner', 'Postquemador', stat('speed'), 0.006, 'thrusters', 2, 5),
  ('evasion', 'Maniobras evasivas', stat('armor'), 0.008, 'thrusters', 2, 5),
  ('plating', 'Placas de titanio', stat('armor'), 0.008, 'hull', 2, 5),
  ('nano-weave', 'Nanomalla', stat('maxHp'), 0.008, 'hull', 2, 5),
  ('focus-lens', 'Lente de foco', stat('crit'), 0.006, 'targeting', 2, 5),
  ('overcharge', 'Sobrecarga', stat('critDamage'), 0.015, 'targeting', 2, 5),
  ('coolant', 'Refrigerante', stat('cooldown'), 0.005, 'reactor', 3, 5),
  ('capacitor', 'Condensador', stat('duration'), 0.012, 'reactor', 3, 5),
  ('slipstream', 'Estela', stat('velocity'), 0.012, 'afterburner', 3, 5),
  ('deflector', 'Deflector', stat('barrier'), 0.008, 'evasion', 3, 5),
  ('bulkhead', 'Mamparos', stat('maxHp'), 0.01, 'plating', 3, 5),
  ('shield-cells', 'Celdas de escudo', stat('barrier'), 0.005, 'nano-weave', 3, 5),
  ('marksman', 'Tirador', stat('crit'), 0.005, 'focus-lens', 3, 5),
  ('ruin', 'Ruina', stat('critDamage'), 0.012, 'overcharge', 3, 5),
  ('cryo', 'Criobobinas', stat('cooldown'), 0.004, 'coolant', 4, 5),
  ('resonant-field', 'Campo resonante', stat('area'), 0.01, 'capacitor', 4, 5),
  ('warp-skid', 'Patines warp', stat('speed'), 0.005, 'slipstream', 4, 5),
  ('aegis', 'Égida', stat('barrier'), 0.005, 'deflector', 4, 5),
  ('citadel', 'Ciudadela', stat('maxHp'), 0.008, 'bulkhead', 4, 5),
  ('leech', 'Sanguijuela', stat('lifesteal'), 0.002, 'shield-cells', 4, 5),
  ('deadeye', 'Ojo certero', stat('damage'), 0.008, 'marksman', 4, 5),
  ('executioner', 'Verdugo', stat('critDamage'), 0.01, 'ruin', 4, 5),
  ('zero-point', 'Punto cero', stat('cooldown'), 0.004, 'cryo', 5, 3),
  ('shockwave', 'Onda expansiva', stat('area'), 0.008, 'resonant-field', 5, 3),
  ('last-stand', 'Último aliento', stat('armor'), 0.008, 'citadel', 5, 3),
  ('apex-frame', 'Chasis ápice', stat('damage'), 0.008, 'deadeye', 5, 3),
 ],
 'relics': [
  ('serendipity', 'Serendipia', stat('luck'), 0.01, 'fortune', 2, 5),
  ('lucky-star', 'Estrella fortuita', stat('crit'), 0.004, 'fortune', 2, 5),
  ('harmonics', 'Armónicos', stat('elemental'), 0.012, 'resonance', 2, 5),
  ('amplifier', 'Amplificador', stat('duration'), 0.01, 'resonance', 2, 5),
  ('refiner', 'Depurador', DIS, 0.02, 'recycling', 2, 5),
  ('salvager', 'Rescatador de polvo', DIS, 0.015, 'recycling', 2, 5),
  ('catalyst', 'Catalizador', FUS, 0.015, 'stable-fusion', 3, 5),
  ('crucible', 'Crisol', FUS, 0.01, 'stable-fusion', 3, 5),
  ('golden-hour', 'Hora dorada', stat('luck'), 0.008, 'serendipity', 3, 5),
  ('gambit', 'Gambito', stat('critDamage'), 0.01, 'lucky-star', 3, 5),
  ('chorus', 'Coro estelar', stat('elemental'), 0.01, 'harmonics', 3, 5),
  ('echo-chamber', 'Cámara de eco', stat('duration'), 0.008, 'amplifier', 3, 5),
  ('alembic', 'Alambique', DIS, 0.015, 'refiner', 3, 5),
  ('prism-press', 'Prensa prismática', stat('area'), 0.006, 'salvager', 3, 5),
  ('star-forge', 'Forja estelar', FUS, 0.008, 'catalyst', 4, 5),
  ('binding', 'Ligadura', stat('velocity'), 0.01, 'crucible', 4, 5),
  ('jackpot', 'Premio gordo', stat('luck'), 0.006, 'golden-hour', 4, 5),
  ('afterglow', 'Resplandor', stat('elemental'), 0.008, 'chorus', 4, 5),
  ('long-echo', 'Eco largo', stat('duration'), 0.006, 'echo-chamber', 4, 5),
  ('philosopher', 'Piedra filosofal', DIS, 0.012, 'alembic', 4, 5),
  ('supernova-core', 'Núcleo supernova', FUS, 0.008, 'star-forge', 5, 3),
  ('tether', 'Amarre', stat('velocity'), 0.008, 'binding', 5, 3),
  ('conjunction', 'Conjunción', stat('elemental'), 0.008, 'afterglow', 5, 3),
 ],
 'station': [
  ('overclock', 'Sobrerreloj', REF('rate'), 0.015, 'throughput', 2, 5),
  ('deep-silos', 'Silos profundos', REF('queue'), 0.05, 'silos', 2, 5),
  ('conveyor', 'Cinta transportadora', REF('rate'), 0.012, 'silos', 2, 5),
  ('dish', 'Antena parabólica', ANT, 0.012, 'receiver', 2, 5),
  ('relay', 'Repetidor', ANT, 0.01, 'receiver', 2, 5),
  ('scrapyard', 'Desguace', pay('material'), 0.01, 'salvage', 3, 5),
  ('smelter', 'Fundición', REF('rate'), 0.01, 'salvage', 3, 5),
  ('vaults', 'Bóvedas', REF('queue'), 0.04, 'deep-silos', 3, 5),
  ('automation', 'Automatización', REF('rate'), 0.01, 'conveyor', 3, 5),
  ('array', 'Matriz de antenas', ANT, 0.008, 'dish', 3, 5),
  ('beacon', 'Baliza', ANT, 0.008, 'relay', 3, 5),
  ('turbo', 'Turbo', REF('rate'), 0.01, 'overclock', 3, 5),
  ('magnet-crane', 'Grúa magnética', pay('material'), 0.008, 'scrapyard', 4, 5),
  ('forge-line', 'Línea de forja', REF('rate'), 0.008, 'smelter', 4, 5),
  ('megavault', 'Megabóveda', REF('queue'), 0.03, 'vaults', 4, 5),
  ('assembly', 'Ensamblaje', REF('rate'), 0.008, 'automation', 4, 5),
  ('deep-space-net', 'Red de espacio profundo', ANT, 0.006, 'array', 4, 5),
  ('hyperline', 'Línea hiper', REF('rate'), 0.008, 'turbo', 4, 5),
  ('scavenger', 'Carroñero', pay('material'), 0.006, 'magnet-crane', 5, 3),
  ('fusion-furnace', 'Horno de fusión', REF('rate'), 0.006, 'forge-line', 5, 3),
  ('singularity-press', 'Prensa de singularidad', REF('rate'), 0.006, 'assembly', 5, 3),
 ],
 'extraction': [
  ('tractor', 'Rayo tractor', stat('pickup'), 0.02, 'magnet', 2, 5),
  ('bounty', 'Recompensa', pay('coins'), 0.01, 'ledger', 2, 5),
  ('auditor', 'Auditor', stat('luck'), 0.006, 'ledger', 2, 5),
  ('distiller', 'Destilador', pay('dust'), 0.008, 'sieve', 2, 5),
  ('prospector', 'Prospector', pay('material'), 0.006, 'sieve', 2, 5),
  ('archive', 'Archivo', stat('xp'), 0.01, 'study', 3, 5),
  ('tutor', 'Tutor', stat('xp'), 0.008, 'study', 3, 5),
  ('mercenary', 'Mercenario', pay('coins'), 0.008, 'bounty', 3, 5),
  ('appraiser', 'Tasador', pay('coins'), 0.006, 'auditor', 3, 5),
  ('stardust-net', 'Red de polvo', pay('dust'), 0.006, 'distiller', 3, 5),
  ('deep-drill', 'Taladro profundo', pay('material'), 0.005, 'prospector', 3, 5),
  ('gravity-well', 'Pozo gravitatorio', stat('pickup'), 0.015, 'tractor', 3, 5),
  ('scholar', 'Erudito', stat('xp'), 0.008, 'archive', 4, 5),
  ('mentor', 'Mentor', stat('xp'), 0.006, 'tutor', 4, 5),
  ('treasury', 'Tesorería', pay('coins'), 0.006, 'mercenary', 4, 5),
  ('fortune-teller', 'Adivina', stat('luck'), 0.005, 'appraiser', 4, 5),
  ('condenser', 'Condensador de polvo', pay('dust'), 0.005, 'stardust-net', 4, 5),
  ('core-sampler', 'Muestreador', pay('material'), 0.004, 'deep-drill', 4, 5),
  ('event-horizon', 'Horizonte de sucesos', stat('pickup'), 0.012, 'gravity-well', 4, 5),
  ('sage', 'Sabio', stat('xp'), 0.006, 'scholar', 5, 3),
  ('golden-ledger', 'Libro dorado', pay('coins'), 0.005, 'treasury', 5, 3),
 ],
}

def node(branch, id, name, effect, per, requires, ring, mx):
    d, c = RING_COST[ring]
    return {'id': id, 'branch': branch, 'name': name, 'effect': effect, 'per': per, 'max': mx, 'requires': requires,
            'cost': {'dust': d, 'components': c}, 'growth': 1.5, 'falloff': FALLOFF[ring], 'at': None}

def total(n, level=None):
    l = n['max'] if level is None else level
    f = n['falloff']
    return n['per'] * l if f == 1 else n['per'] * (1 - f ** l) / (1 - f)

def cost_all(n):
    return [sum(round(n['cost'][k] * n['growth'] ** (l - 1)) for l in range(1, n['max'] + 1)) for k in ('dust', 'components')]

perm = list(TODAY)
for b, lst in NEW.items():
    for (id, name, eff, per, req, ring, mx) in lst:
        perm.append(node(b, id, name, eff, per, req, ring, mx))

# Season 2 (template): stats and pay only, three levels each, the same every level.
def snode(branch, id, name, effect, per, requires, ring):
    base = {0: (60, 5), 1: (90, 8), 2: (130, 11), 3: (180, 15)}[ring]
    return {'id': id, 'branch': branch, 'name': name, 'effect': effect, 'per': per, 'max': 3, 'requires': requires,
            'cost': {'dust': base[0], 'components': base[1]}, 'growth': 1.5, 'falloff': 1, 'at': None}
SEASON = [
 # Asalto (probe)
 snode('probe', 't2-assault', 'Asalto', stat('damage'), 0.01, None, 0),
 snode('probe', 't2-rapid', 'Ráfaga', stat('cooldown'), 0.005, 't2-assault', 1),
 snode('probe', 't2-sweep', 'Barrido', stat('area'), 0.01, 't2-assault', 1),
 snode('probe', 't2-hunter', 'Cazador', stat('critDamage'), 0.015, 't2-rapid', 2),
 snode('probe', 't2-frenzy', 'Frenesí', stat('speed'), 0.006, 't2-sweep', 2),
 snode('probe', 't2-volley', 'Andanada', stat('velocity'), 0.012, 't2-rapid', 2),
 snode('probe', 't2-spark', 'Chispazo', stat('crit'), 0.005, 't2-sweep', 2),
 snode('probe', 't2-predator', 'Depredador', stat('damage'), 0.008, 't2-hunter', 3),
 snode('probe', 't2-overdrive', 'Desenfreno', stat('cooldown'), 0.004, 't2-frenzy', 3),
 snode('probe', 't2-reach', 'Alcance', stat('duration'), 0.01, 't2-volley', 3),
 snode('probe', 't2-shatter', 'Quiebre', stat('critDamage'), 0.012, 't2-spark', 3),
 snode('probe', 't2-storm', 'Tormenta', stat('area'), 0.008, 't2-predator', 3),
 # Resistencia (relics)
 snode('relics', 't2-shell', 'Caparazón', stat('armor'), 0.008, None, 0),
 snode('relics', 't2-pulse', 'Latido', stat('maxHp'), 0.006, 't2-shell', 1),
 snode('relics', 't2-wall', 'Muralla', stat('maxHp'), 0.01, 't2-shell', 1),
 snode('relics', 't2-reflex', 'Reflejos', stat('barrier'), 0.006, 't2-pulse', 2),
 snode('relics', 't2-vigor', 'Vigor', stat('maxHp'), 0.008, 't2-wall', 2),
 snode('relics', 't2-leech', 'Sorbo', stat('lifesteal'), 0.002, 't2-pulse', 2),
 snode('relics', 't2-bastion', 'Bastión', stat('armor'), 0.006, 't2-wall', 2),
 snode('relics', 't2-aura', 'Aura', stat('elemental'), 0.01, 't2-reflex', 3),
 snode('relics', 't2-endure', 'Aguante', stat('armor'), 0.005, 't2-vigor', 3),
 snode('relics', 't2-ward', 'Guarda', stat('barrier'), 0.005, 't2-bastion', 3),
 snode('relics', 't2-lucky', 'Talismán', stat('luck'), 0.01, 't2-leech', 3),
 snode('relics', 't2-heart', 'Corazón de hierro', stat('maxHp'), 0.006, 't2-endure', 3),
 # Botín (extraction)
 snode('extraction', 't2-harvest', 'Cosecha', pay('dust'), 0.01, None, 0),
 snode('extraction', 't2-gather', 'Recolector', stat('pickup'), 0.015, 't2-harvest', 1),
 snode('extraction', 't2-coins', 'Diezmo', pay('coins'), 0.008, 't2-harvest', 1),
 snode('extraction', 't2-salvage', 'Hallazgo', pay('material'), 0.006, 't2-gather', 2),
 snode('extraction', 't2-wisdom', 'Saber', stat('xp'), 0.01, 't2-gather', 2),
 snode('extraction', 't2-fortune', 'Fortuna de temporada', stat('luck'), 0.008, 't2-coins', 2),
 snode('extraction', 't2-hoard', 'Acopio', pay('dust'), 0.008, 't2-coins', 2),
 snode('extraction', 't2-tracker', 'Rastreador', stat('pickup'), 0.012, 't2-salvage', 3),
 snode('extraction', 't2-sage', 'Lección', stat('xp'), 0.008, 't2-wisdom', 3),
 snode('extraction', 't2-tithe', 'Tributo', pay('coins'), 0.006, 't2-fortune', 3),
 snode('extraction', 't2-reap', 'Siega', pay('dust'), 0.006, 't2-hoard', 3),
 snode('extraction', 't2-scrap', 'Rebusca', pay('material'), 0.005, 't2-tracker', 3),
]

def report(nodes, title, budget=1.0):
    by = {}
    for n in nodes:
        e = n['effect']
        k = e['kind'] + (':' + e.get('stat', e.get('currency', e.get('field', ''))) if e['kind'] in ('stat', 'payout', 'refinery') else '')
        by[k] = by.get(k, 0) + total(n)
    d = sum(cost_all(n)[0] for n in nodes); c = sum(cost_all(n)[1] for n in nodes)
    print(f'== {title}: {len(nodes)} nodes, levels {sum(n["max"] for n in nodes)}, cost dust {d:,} components {c:,}')
    for k in sorted(by): print(f'   {k:22s} {by[k]:.3f}')
    return by, d, c

if __name__ == '__main__':
    print({b: sum(1 for n in perm if n['branch'] == b) for b in ('probe', 'relics', 'station', 'extraction')})
    today_by, _, _ = report(TODAY, 'today')
    perm_by, pd, pc = report(perm, 'permanent')
    season_by, sd, sc = report(SEASON, 'season 2')
    both = {k: perm_by.get(k, 0) + season_by.get(k, 0) for k in set(perm_by) | set(season_by)}
    print('== both trees at max (caps: stat 1.0, payout 0.5, fusion 0.5):')
    for k in sorted(both): print(f'   {k:22s} {both[k]:.3f}  (+{both[k] - today_by.get(k, 0):.3f} over today)')
    # Time: an active player (PRE p90, Nov 2026): ~2,600 dust and ~260 components a day; half the dust to the lab.
    print(f'== permanent: {pd / 1300:.0f} days of dust (1,300/day) and {pc / 260:.0f} days of components (260/day)')
    print(f'== season: 80 % is {0.8 * sd / 700:.0f} days of dust (700/day) and {0.8 * sc / 60:.0f} days of components (60/day)')
    if len(sys.argv) > 1 and sys.argv[1] == 'write':
        folder = os.path.join(OUT, 'launch', '2026-11-12-laboratorio')
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, 'lab.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'nodes': perm}, f, ensure_ascii=False, indent=2); f.write('\n')
        tpl = os.path.join(OUT, 'plantillas', 'temporada', 'lab.json')
        with open(tpl, 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'season': SEASON}, f, ensure_ascii=False, indent=2); f.write('\n')
        print('written')
