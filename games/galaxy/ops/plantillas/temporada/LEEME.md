# Plantilla de temporada

Una Temporada 2 de ejemplo como ficha (`temporada.json`, plan «temporadas como fichas»):
- 4 semanas, del 8 de diciembre de 2026 al 5 de enero de 2027, a las 00:00 de Madrid;
- anomalía «swarm» y acabado «rift» (en `rules`);
- la ruta y las misiones de temporada de la Temporada 1 (en `route` y `missions`);
- el núcleo de temporada del laboratorio (en `lab`): 36 nodos en tres ramas (Asalto, Resistencia y Botín), con estadísticas y cobro de partida, tres niveles cada uno. Un jugador activo completa en torno al 80 % en las cuatro semanas. Empieza vacío con el id nuevo de la temporada.

Para usarla, sigue la skill `galaxy-temporada`:
1. Copia esta carpeta a `ops/launch/<aaaa-mm-dd>-temporada-<n>/`.
2. Cambia id (nunca reutilizado), nombre, fechas, anomalía, tramos, ruta, misiones y los ids del árbol de laboratorio.
3. Si cambian los logros, añade `achievements.json` con la lista completa: lo vivo más lo nuevo.

**Al llevarla a PRE:** se importa con `season-import` y se programa con `season-schedule`, con el OK del propietario. Empieza sola a su hora y la anterior se archiva sola al acabar, con sus propios premios de cierre. Nunca se solapa con otra programada.

Lo valida `packages/shared/test/launch-config.test.ts`.
