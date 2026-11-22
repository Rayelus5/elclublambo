# Plantilla de torneo

Un torneo de ejemplo como ficha (`torneo.json`, skill `galaxy-torneo`):
- **Fechas:** de viernes a las 20:00 a martes a las 00:00 de Madrid, dentro de la Temporada 2. Un torneo puede empezar y acabar a cualquier hora, dura 28 días como mucho y cabe en su temporada.
- **Cómo se gana:** `points`, los puntos de temporada de cada incursión, sumados. Sin filtros de sector, sonda ni modo.
- **Inscripción:** exclusivo (nadie está en dos exclusivos a la vez), sin entrada, sin nivel mínimo y sin cupo.
- **Premios por puesto:** del 1.º al 50.º, en cuatro tramos, más un premio de participación para quien juega 3 incursiones que cuentan.
- **Revisión:** 24 horas antes de publicar los resultados.

Para usarla, sigue la skill `galaxy-torneo`:
1. Copia esta carpeta (sin este `LEEME.md`) a `ops/launch/<aaaa-mm-dd>-torneo-<slug>/`.
2. Cambia el slug (nunca repetido), la temporada, el título, el resumen, las reglas, las fechas, la medida, los filtros, la entrada y los premios.
3. Las imágenes (banner y premios) no van aquí: se suben en el panel, en el paso «Datos» del torneo.

**Al llevarlo a PRE:** con el OK del propietario, `tournament-draft` lo guarda como **borrador**. Lo programa el propietario desde Administración › Torneos, con su contraseña. Si los premios superan los límites del buzón o llevan dinero, tiene que programarlo un superadmin.

Lo valida `packages/shared/test/launch-config.test.ts`.
