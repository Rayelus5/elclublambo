# Música propia del juego

La banda sonora del juego se genera sola (`src/audio/music/`). Aquí puedes dejar archivos de audio que sustituyen a una pieza generada. Todo es opcional: lo que no tenga archivo se sigue generando.

## Dónde va cada archivo

Una carpeta por estilo (el que el jugador elige en Ajustes › Sonido › Estilo de música):

| Carpeta | Estilo |
|---|---|
| `ambiente/` | Ambiente espacial |
| `lofi/` | Lo-fi espacial |
| `synthwave/` | Synthwave suave |
| `propia/` | **Mi música**: un estilo nuevo que solo aparece en Ajustes si esta carpeta tiene archivos. Lo que no tenga archivo aquí suena con Ambiente espacial. |

## Cómo se llama cada archivo

El nombre es el de la pieza que sustituye:

| Archivo | Cuándo suena |
|---|---|
| `menu-deriva`, `menu-faro`, `menu-marea`, `menu-polvo` | Menú de inicio (se turnan) |
| `sector-nebulosa` | Incursión en Nebulosa exterior |
| `sector-hielo` | Anillos de escarcha |
| `sector-arrecife` | Arrecife hueco |
| `sector-forja` | Forja rota |
| `sector-fisura` | Fisura de la señal |
| `nucleo-1`, `nucleo-2` | Núcleos (se turnan por capa) |
| `nucleo-profundo` | Núcleo profundo |
| `resultados` | Resultados de una incursión |

Puedes dar la pieza entera (`sector-hielo.ogg`) o por capas que siguen la intensidad de la partida:

| Capa | Cuándo se oye |
|---|---|
| `-capa0` | Siempre (la base) |
| `-capa1` | Calma |
| `-capa2` | Combate |
| `-capa3` | Peligro y Núcleo |

Por ejemplo: `propia/sector-hielo-capa0.ogg`, `propia/sector-hielo-capa2.ogg`.

## Formato

- **`.ogg` (Opus)** y, si quieres, también **`.m4a` (AAC)** con el mismo nombre: cada navegador usa el que sabe tocar.
- Estéreo, 44,1 o 48 kHz.
- **Bucle sin cortes:** sin silencio al principio ni al final.
- **Capas:** todas las de una pieza con el mismo tempo y la misma duración, para que sigan alineadas.
- **Sonoridad:** unos **−16 LUFS**, con picos por debajo de **−1 dBTP**, para que no salte frente a la generada.

## Cómo se publica

Los archivos se encuentran al compilar el juego: se suben al repositorio y se despliegan como cualquier cambio, y salen con un nombre único y caché larga. Un nombre mal escrito no rompe nada: simplemente no se usa.

## Derechos

**El repositorio es público.** Sube solo audio que hayas creado tú o que tenga una licencia que permita publicarlo y usarlo en el juego.
