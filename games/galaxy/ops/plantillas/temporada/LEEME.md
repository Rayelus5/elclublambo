# Plantilla de temporada

Una Temporada 2 de ejemplo:
- 4 semanas, del 8 de diciembre de 2026 al 5 de enero de 2027, a las 00:00 de Madrid;
- anomalía «swarm»;
- acabado «rift»;
- la ruta y las misiones de temporada de la Temporada 1.

Para usarla, sigue la skill `galaxy-temporada`:
1. Copia esta carpeta a `ops/launch/<aaaa-mm-dd>-temporada-<n>/`.
2. Cambia id (nunca reutilizado), nombre, fechas, anomalía, tramos, ruta y misiones.
3. Si cambian los logros, añade `achievements.json` con la lista completa: lo vivo más lo nuevo.

**Al publicar:**
- **Orden:** `season` antes que `seasonRoute`. El id nuevo archiva la temporada anterior con la ruta que esté viva en ese momento.
- **Hora:** nunca antes de que acabe la anterior, porque la cerraría antes de tiempo.

Lo valida `packages/shared/test/launch-config.test.ts`.
