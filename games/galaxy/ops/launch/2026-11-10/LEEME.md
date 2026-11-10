# Lanzamiento de la beta abierta y Temporada 1

Publicado en PRE el 10 de noviembre de 2026 con la CLI (`publish-config`), justo después del borrado de la beta cerrada. La secuencia completa está en `docs/DEPLOY_PRE.md`, en «Lanzamiento de la beta abierta (2026-11-10)».

- **Qué trae:** Temporada 1 (4 semanas), los eventos «Primer contacto» y «Escuadrón estelar» con el escáner de Primer contacto, un potenciador de lanzamiento (×1,5 en monedas y polvo, una semana), misiones más duras, dos logros nuevos y la dureza por sector.
- **Orden:** `content`, `season`, `seasonRoute`, `missions`, `achievements`, `boosts`, `events`, `gacha`, y el aviso «Arranca la Beta Abierta y la Temporada 1. Eventos activos hasta el 24 de noviembre» (14 días).
- **Antes hacía falta** el código de SIM 1.8.0 (dureza por sector) y la migración que admite `seasonRoute` como clave.
- **Versiones:** no se apuntaron. Se consultan con `show-config <clave>`.
- **Después, a mano desde el panel:** el propietario cambió cosas que no están en estos archivos, como las probabilidades de botiquines e imanes. Por eso cualquier borrador nuevo parte de lo vivo (`show-config <clave> --data`).

Lo valida `packages/shared/test/launch-config.test.ts`.
