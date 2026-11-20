"""The profile art's list (contract in docs/superpowers/plans/2026-11-12-galaxy-bloque-c.md, «Contrato del arte (C3)»):
every id, the function that draws it, how many frames it has and, for the approval sheet only, a proposed name and
rarity. The live names and rarities belong to the `cosmetics` catalogue (C2), not to this file."""
import crew
import cores
import probes
import specials
import shop
import frames_static as fs
import frames_anim as fa

# (id, draw, frames, proposed name, proposed rarity, group)
AVATARS = [
    ('crew-pilot', crew.pilot, 1, 'Piloto', 'común', 'De serie'),
    ('crew-navigator', crew.navigator, 1, 'Navegante', 'común', 'De serie'),
    ('crew-technician', crew.technician, 1, 'Técnica', 'común', 'De serie'),
    ('crew-medic', crew.medic, 1, 'Médica', 'común', 'De serie'),
    ('crew-cadet', crew.cadet, 1, 'Cadete', 'común', 'De serie'),
    ('crew-veteran', crew.veteran, 1, 'Veterano', 'común', 'De serie'),
    ('crew-scientist', crew.scientist, 1, 'Científica', 'común', 'De serie'),
    ('crew-android', crew.android, 1, 'Androide', 'común', 'De serie'),
    ('crew-drone', crew.drone, 1, 'Dron', 'común', 'De serie'),
    ('crew-xeno-green', crew.xeno_green, 1, 'Xeno verde', 'común', 'De serie'),
    ('crew-xeno-violet', crew.xeno_violet, 1, 'Xeno violeta', 'común', 'De serie'),
    ('crew-cat', crew.cat, 1, 'Gato de a bordo', 'común', 'De serie'),
    ('portrait-hive', cores.hive, 1, 'La Colmena Rota', 'épico', 'Por jugar'),
    ('portrait-glacier', cores.glacier, 1, 'La Madre Glaciar', 'épico', 'Por jugar'),
    ('portrait-anemone', cores.anemone, 1, 'La Anémona Rey', 'épico', 'Por jugar'),
    ('portrait-anvil', cores.anvil, 1, 'El Yunque', 'épico', 'Por jugar'),
    ('portrait-echo-core', cores.echo_core, 1, 'El Eco Profundo', 'legendario', 'Por jugar'),
    ('portrait-signal', cores.signal, 1, 'La Señal', 'legendario', 'Por jugar'),
    ('probe-lumen', probes.lumen, 1, 'Lumen', 'raro', 'Por jugar'),
    ('probe-bastion', probes.bastion, 1, 'Bastión', 'raro', 'Por jugar'),
    ('probe-spark', probes.spark, 1, 'Chispa', 'raro', 'Por jugar'),
    ('static-ghost', specials.static_ghost, 1, 'Fantasma de estática', 'épico', 'Por jugar'),
    ('cartographer', specials.cartographer, 1, 'La Cartógrafa', 'épico', 'Por jugar'),
    ('first-contact', specials.first_contact, 1, 'Primer contacto', 'legendario', 'Por jugar'),
    ('shop-nebula-queen', shop.nebula_queen, 4, 'Reina nebulosa', 'legendario', 'De tienda'),
    ('shop-void-knight', shop.void_knight, 4, 'Caballero del vacío', 'legendario', 'De tienda'),
    ('shop-star-fox', shop.star_fox, 1, 'Zorro estelar', 'épico', 'De tienda'),
    ('shop-comet-rider', shop.comet_rider, 1, 'Jinete del cometa', 'épico', 'De tienda'),
]

# (id, draw, frames, name, rarity, group): ids and rarities fixed by the contract.
FRAMES = [
    ('bronze', fs.bronze, 1, 'Bronce', 'común', 'Los de hoy'),
    ('silver', fs.silver, 1, 'Plata', 'común', 'Los de hoy'),
    ('gold', fs.gold, 1, 'Oro', 'raro', 'Los de hoy'),
    ('nebula', fa.nebula, 6, 'Nebulosa', 'épico', 'Los de hoy'),
    ('abyss', fa.abyss, 6, 'Abismo', 'épico', 'Los de hoy'),
    ('crown', fa.crown, 6, 'Corona', 'legendario', 'Los de hoy'),
    ('aurora', fa.aurora, 6, 'Aurora', 'épico', 'Por jugar'),
    ('circuit', fs.circuit, 1, 'Circuito', 'raro', 'Por jugar'),
    ('orbit', fs.orbit, 1, 'Órbita', 'raro', 'Por jugar'),
    ('frost', fs.frost, 1, 'Escarcha', 'raro', 'Por jugar'),
    ('ember', fa.ember, 6, 'Ascua', 'épico', 'Por jugar'),
    ('quasar', fa.quasar, 6, 'Cuásar', 'legendario', 'Por jugar'),
    ('prism', fa.prism, 6, 'Prisma', 'legendario', 'De tienda'),
    ('solar', fa.solar, 6, 'Solar', 'épico', 'De tienda'),
    ('eclipse', fs.eclipse, 1, 'Eclipse', 'raro', 'De tienda'),
    ('starlight', fs.starlight, 1, 'Luz estelar', 'raro', 'De tienda'),
]


def render(draw, frames):
    """The frames of one piece as PIL images."""
    return [draw(f).image() for f in range(frames)]
