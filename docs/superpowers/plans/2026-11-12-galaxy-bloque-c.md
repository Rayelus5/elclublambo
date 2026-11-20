# Galaxy: bloque C (perfil y cosméticos). Plan

**Especificación:** `docs/superpowers/specs/2026-11-12-galaxy-mejoras-noviembre-design.md` §6 C1–C5 y §8.

**Ramas, una por parte:**
- C1 `feature/galaxy-c1-desplegables`
- C2 `feature/galaxy-c2-personalizar`
- C3 `feature/galaxy-c3-arte-perfil`, solo arte
- C4 y C5, encima de C2

El arte de C3 entra en C2 con un merge antes de abrir el PR.

## Contrato del arte (C3)

**Medidas.** Pixel art a escala entera, hecho con un generador en Python (`art/profile/gen/`, como `art/shop/gen/`) y revisado en Aseprite.

| Pieza | Tamaño | Animada |
|---|---|---|
| Avatar | 32×32, con fondo propio (retrato) | Tira horizontal de 4 fotogramas (128×32), a 6 fps |
| Marco | 48×48, con una ventana transparente de 32×32 en el centro (8 px de borde por lado) | Tira de 6 fotogramas (288×48), a 8 fps |

**Archivos.**
- Imágenes: `apps/web/src/profile/art/avatars/<id>.png` y `apps/web/src/profile/art/frames/<id>.png`.
- Fuentes: `art/profile/avatars/*.aseprite` y `art/profile/frames/*.aseprite`.
- Hoja de aprobación: `art/profile/sheet.png`.

**Avatares (28).**

| Grupo | ids |
|---|---|
| De serie (12) | `crew-pilot`, `crew-navigator`, `crew-technician`, `crew-medic`, `crew-cadet`, `crew-veteran`, `crew-scientist`, `crew-android`, `crew-drone`, `crew-xeno-green`, `crew-xeno-violet`, `crew-cat` |
| Por jugar (12) | Los Núcleos: `portrait-hive`, `portrait-glacier`, `portrait-anemone`, `portrait-anvil`, `portrait-echo-core`, `portrait-signal`. Las sondas: `probe-lumen`, `probe-bastion`, `probe-spark`. Además: `static-ghost`, `cartographer`, `first-contact` |
| De tienda (4) | `shop-nebula-queen` (animado), `shop-void-knight` (animado), `shop-star-fox`, `shop-comet-rider` |

**Marcos (16).**

| Grupo | ids y rareza |
|---|---|
| Los de hoy, redibujados con el mismo id | `bronze` común, `silver` común, `gold` raro, `nebula` épico animado, `abyss` épico animado, `crown` legendario animado |
| Nuevos, por jugar | `aurora` épico animado, `circuit` raro, `orbit` raro, `frost` raro, `ember` épico animado, `quasar` legendario animado |
| De tienda | `prism` legendario animado, `solar` épico animado, `eclipse` raro, `starlight` raro |

Los ids de los marcos solo llevan letras minúsculas, porque así lo exige `accounts.frame`.

## C2: datos y pantalla

**Catálogo vivo: clave `cosmetics` en `packages/shared/src/cosmetics/`.**
- Cada lista (`avatars`, `frames`, `titles`) lleva:
  - el id, o el texto en el caso de los títulos;
  - nombre, rareza y origen (`default`, `reward` o `shop`);
  - el texto de cómo conseguirlo;
  - si está activo;
  - en los avatares y los marcos, si es animado;
  - en los títulos, el estilo (`plain`, `shine`, `aurora` o `flare`).
- Los ids deben estar en la lista de arte conocida (`ART_AVATARS` y `ART_FRAMES`).
- Por defecto trae el lote de estreno.

**Base de datos** (migración posterior a la última de `develop`):
- `galaxy.cosmetics.kind` admite `avatar`;
- columna `accounts.avatar text null`, con id `^[a-z0-9-]{1,32}$`;
- columna `accounts.banner uuid null`, que referencia `galaxy.galaxies(id)` y se pone a null si se borra la galaxia.
- Los avatares `default` no tienen filas: los tiene todo el mundo.

**API:**
- `GET /galaxy/api/profile/cosmetics`: lo que llevas puesto, lo que tienes y el catálogo activo.
- `PUT /galaxy/api/profile/cosmetics` con `{ avatar?, frame?, title?, banner? }`:
  - comprueba que es tuyo; un avatar de serie siempre lo es, y el banner debe ser una galaxia tuya;
  - `null` quita la pieza.
  - Sustituye a la ruta de misiones, que queda como alias.
- **Recompensas** (`title`, `frame` y `avatar`): logros, ruta, tienda, cierre y podio de temporada, catálogo, metas de evento y concesión manual en el admin. Todas usan una sola ayuda, `grantCosmetic(trx, cuenta, tipo, valor)`, idempotente.
- **Retratos de Núcleo:** se dan al guardar una partida con Núcleos vencidos (`portrait-<boss>` por sector; el Eco Profundo, con capa ≥ 4 y bajas suficientes).
- **CLI `cosmetics-backfill`:** da con carácter retroactivo los retratos, a partir de `galaxy.runs`, y los avatares de logros, ruta y catálogo ya cobrados. Se puede repetir.

**Avatar con marco en todas partes.**
- El componente `hub/Avatar.tsx` recibe `{ name, avatar, frame, size }` y pinta el arte. Sin avatar, la figura generada («Tu firma»).
- Los tipos de la API que lo llevan: `MeResponse`, `LeaderRow`, `FriendEntry`, `ChatMessage.author`, `RoomMember`, `Profile` y los miembros del clan.

**«Personalizar».**
- Un botón en tu perfil abre un diálogo con las pestañas Avatar, Marco, Título y Banner (C4).
- Cada pestaña es una rejilla de inventario con vista previa animada; las piezas bloqueadas dicen cómo conseguirlas, y las de tienda llevan a `/tienda?pestana=estilo`.
- Arriba, una vista previa de la cabecera; abajo, «Guardar».
- Se quita `Cosmetics` de Misiones › Logros y se deja un enlace a «Personalizar».
