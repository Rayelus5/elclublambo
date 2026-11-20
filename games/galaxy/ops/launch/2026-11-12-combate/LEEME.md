# El combate de noviembre

Plan de mejoras de noviembre, bloque B (B5). Necesita la **SIM 1.9.0** desplegada en PRE (PR #140). Se publica con la skill `galaxy-publicar-config`, con el OK que el propietario dio para este plan.

**`content.json`** sustituye cinco campos de primer nivel y deja el resto de `content` como está:
- **`weapons`:** las 48 de hoy, idénticas, y 10 nuevas: Arpón magnético, Honda gravitatoria, Señuelo holográfico, Faro de fotones y Mortero de racimo, con sus evoluciones (Arpón de remolque, Catapulta de singularidad, Legión de espejismos, Faro binario y Mortero de asedio).
- **`passives`:** las 20 de hoy, idénticas, y 5 nuevas: Fase cuántica, Cazanúcleos, Protocolo de purga, Repulsor e Inercia.
- **`caps`:** los topes de hoy, idénticos, y los de las 5 stats nuevas (esquiva 25 %, daño a Núcleos 60 %, remate 12 %, empuje 1,2 y daño en movimiento 35 %). Ya valían por defecto desde el despliegue; publicarlos los deja escritos.
- **`bosses`:** los 6 Núcleos de hoy, idénticos (con la vida del «Bosses Buff»), y sus 12 formas nuevas.
- **`sectors`:** los 5 de hoy con el ciclo de formas (`bossCycle` y `deepBoss.cycle`) y la curva calibrada. Las gotas, oleadas, balizas y desbloqueos quedan como están.

**La curva** (todo lo demás de cada sector queda igual):

| Sector | Daño de la fauna | Crece por minuto (daño) | Vida de la fauna | Crece por minuto (vida) | Más enemigos por minuto | Daño de los Núcleos |
|---|---|---|---|---|---|---|
| Nebulosa | ×1 → ×1,65 | 6,5 % → 10 % | ×1,05 | 6 % → 9 % | 0,18 → 0,24 (tope 3,5 → 4,5) | ×1 → ×1,6 |
| Anillos | ×1,03 → ×2,4 | 9 % → 10 % | ×1,1 | 7,5 % | igual | ×1 → ×1,7 |
| Arrecife | ×1,06 → ×1,15 | 6,5 % → 18 % | ×1,15 | 6 % → 14 % | 0,18 → 0,24 (tope 3,5 → 4,5) | ×1 → ×1,8 |
| Forja | ×1,09 → ×1,6 | 6,5 % → 14 % | ×1,2 | 6 % → 10 % | 0,18 → 0,24 (tope 3,5 → 4,5) | ×1 → ×1,9 |
| Fisura (temporada) | ×1,12 → ×2,4 | 9 % → 14 % | ×1,3 | 7,5 % → 12 % | igual | ×1 → ×2,1 |

**Medida con el bot** (`packages/sim/test/difficulty.test.ts`, 16 semillas, media de la mitad central), en minutos:
- quien empieza, en la Nebulosa: 6,1 (llega al primer Núcleo en 10 de 16 partidas y lo vence en 8);
- medio: Nebulosa 14,5, Anillos 11,2, Arrecife 8,9, Forja 7,9 y Fisura 7,0;
- veterano: Nebulosa 32,3, Anillos 25,9, Arrecife 21,2, Forja 15,4 y Fisura 11,1.

**Cómo se preparó** (en PRE, ya desplegada la SIM 1.9.0):
```
draft-config content weapons,passives,caps,bosses
draft-config content sectors --ids outer-nebula,frost-rings,hollow-reef,broken-forge,signal-rift
```
Comparé campo a campo el borrador con lo vivo: no sale nada, el orden se conserva y fuera de lo de arriba todo es idéntico (gotas, oleadas, vida de los Núcleos, armas y pasivas de hoy).

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-12 hacia las 04:30 (hora de Madrid)**, con el OK que el propietario dio para este plan, tras desplegar la SIM 1.9.0 (PR #140).
- **`content` v3 → v4.** `check-config`, repetido justo antes de publicar, dijo lo mismo: entran 10 armas, 5 pasivas y 12 formas, cambian los 5 sectores, no sale nada y «Se sostiene».
- **Motivo:** «Combate de noviembre: 5 armas, 5 pasivas, formas de Nucleo y curva de dificultad (SIM 1.9.0)».
- **Aviso** en Noticias durante 7 días: «Combate renovado: 5 armas y 5 pasivas nuevas, cada Núcleo cambia de forma capa a capa y cada sector es más duro que el anterior».
- **Comprobado:** lo vivo es igual al borrador, la salud responde `{"ok":true,"db":"up"}` y el contenedor no dejó errores.
- **Lo de antes** (v3) está en `antes/` para volver atrás. Una partida empezada con la v3 termina con la v3.
