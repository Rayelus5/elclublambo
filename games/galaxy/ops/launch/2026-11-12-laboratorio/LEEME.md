# El laboratorio ampliado

Plan de tienda y laboratorio, F2b. **Solo se publica con el OK del propietario** (skill `galaxy-publicar-config`).

**`lab.json` (`nodes`):** el árbol permanente pasa de 16 a 107 nodos.
- **Los 16 de hoy quedan idénticos**, con sus ids, costes y efectos: nadie pierde nada.
- **Los 91 nuevos** cuelgan de ellos en anillos 2 a 5:
  - cada nivel da algo menos que el anterior (`falloff` de 0,92 a 0,86);
  - el coste crece con la profundidad (de 110 de polvo y 26 componentes a 360 y 76, ×1,5 por nivel).
- **Ramas:** Sonda 30, Reliquias 27, Estación 25 y Extracción 25.
- **Coste total:** unos 225.000 de polvo y 52.000 componentes. A un jugador activo de PRE (noviembre: ~2.600 de polvo y ~260 componentes al día, la mitad del polvo al laboratorio) le lleva unos 6 meses.
- **Nada de regeneración, proyectiles ni perforación:** son valores absolutos o enteros, y un «+1 %» engañaría.

**Lo que suma todo el árbol permanente al máximo:**

| | Hoy | Ampliado |
|---|---|---|
| Vida | +10 % | +17 % |
| Daño | +10 % | +15 % |
| Recarga | 5 % | 9,7 % |
| Crítico | — | +6,3 % |
| Daño crítico | — | +19 % |
| Blindaje | — | +8,9 % |
| Barrera | — | +7,3 % |
| Suerte | +15 % | +29 % |
| Experiencia | +10 % | +24 % |
| Monedas, polvo y material de las incursiones | +10, +10 y +20 % | +24, +18 y +35 % |
| Refinería (ritmo y cola) | +25 y +50 % | +61 y +100 % |
| Antena | +25 % | +43 % |
| Polvo al desintegrar | +20 % | +46 % |
| Fusión más barata | 20 % | 36 % |

Todo queda dentro de los topes del esquema (por estadística, cobro y fusión, sumando también el árbol de temporada).

**`redshift.json`:** el Corrimiento al rojo pide más niveles comprados desde el último rango: 50, 80, 110, 140 y 170 (antes 10, 15, 20, 25 y 30). Sigue borrando solo el árbol permanente.

**El árbol de temporada** no va aquí: sale con la Temporada 2, desde `ops/plantillas/temporada/lab.json`.

Lo validan `packages/shared/test/launch-config.test.ts` y `packages/shared/test/lab-content.test.ts`. Los genera `scripts/lab-tree.py` (`python games/galaxy/scripts/lab-tree.py` enseña los totales; con `write` reescribe los archivos).

## Publicado

**El 2026-11-11 hacia las 18:15 (hora de Madrid)**, con el OK del propietario y adelantado a la fecha de la carpeta: la pizarra ya estaba en PRE y así la Temporada 1 (desde el 13/11) se juega entera con el mismo árbol.
- **`lab` v0 → v1** (107 nodos; el árbol de temporada sigue vacío) y **`redshift` v0 → v1** (50, 80, 110, 140 y 170).
- **Motivo:** «Laboratorio ampliado a 107 nodos y umbrales nuevos del Corrimiento al rojo».
- **Aviso** en Noticias durante 7 días: «El Laboratorio crece: 91 mejoras nuevas en sus cuatro ramas y una pizarra para recorrerlas. El Corrimiento al rojo ahora pide más niveles por rango».
- **Lo de antes** (los valores por defecto, versión 0) está en `antes/` para volver atrás. El polvo y los componentes gastados en nodos nuevos no se devolverían.
- **`check-config`** avisó de dos problemas que ya estaban en lo vivo y que esta carpeta no toca: los eventos `primer-contacto` (del 10 al 24/11) y `escuadron-estelar` (del 17/11 al 8/12) se salen de las fechas de `season-1` (del 13 al 23/11).
