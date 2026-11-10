# Plantilla de evento

Un evento de fin de semana de ejemplo, dentro de la Temporada 1: del viernes 27 de noviembre de 2026 a las 00:00 de Madrid (`2026-11-26T23:00:00.000Z`) al lunes 30 a las 00:00 (`2026-11-29T23:00:00.000Z`). El lunes no cuenta: el fin es exclusivo.
- cuatro metas: tres personales y una de clan;
- señales de evento;
- su escáner, con cometas destacados;
- un potenciador de polvo ×2.

Para usarla, sigue la skill `galaxy-evento`:
1. Copia esta carpeta a `ops/launch/<aaaa-mm-dd>-<id-evento>/`.
2. Cambia ids, nombres, fechas, metas y destacada.
3. **Mezcla con lo vivo.** Las listas (`events.list`, `gacha.banners`, `boosts.list`) se publican enteras: añade lo tuyo a lo que haya publicado (`show-config <clave> --data`), sin quitar `deep-scan` ni los eventos que siguen en curso.

Lo valida `packages/shared/test/launch-config.test.ts`.
