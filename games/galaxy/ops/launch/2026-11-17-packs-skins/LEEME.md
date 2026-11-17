# Los seis packs de skins, apagados y sin precio

Plan de packs de skins, aprobado por el propietario el 17/11/2026. Son seis packs completos de 8 skins animadas, una por sonda, a 16,99 € cada uno: Navidad, Fuego, Agua, Galáctico, Carbono y Rubí. Las skins son exclusivas del pack.

**`shop.json` (`products`):** los 42 productos vivos de `shop` v10, en el mismo orden e idénticos, más seis productos `set`. Se hizo desde lo vivo (`antes/shop.json`).

| Producto | Nombre | Precio | Marca | A la venta |
|---|---|---|---|---|
| `skins-navidad` | Pack Navidad | 16,99 € | Edición limitada | hasta el 10 de enero incluido (`availableUntil` 2027-01-10T23:00:00Z, las 00:00 del 11 de enero en Madrid) |
| `skins-fuego` | Pack Fuego | 16,99 € | Nuevo | sin fechas |
| `skins-agua` | Pack Agua | 16,99 € | Nuevo | sin fechas |
| `skins-galaxia` | Pack Galáctico | 16,99 € | Nuevo | sin fechas |
| `skins-carbono` | Pack Carbono | 16,99 € | Nuevo | sin fechas |
| `skins-rubi` | Pack Rubí | 16,99 € | Nuevo | sin fechas |

Cada uno lleva `pieces` con las ocho skins de su línea (`skin-<sonda>-<línea>`) y `maxPerAccount` 1. Ninguno lleva extra de primera compra ni oferta. Van **apagados y sin `stripePriceId`**.

**`cosmetics` no se publica.** En PRE nunca se ha publicado (v0), así que su catálogo es el del código, que ya trae las 48 skins desde el despliegue del PR #233.

**Siguiente paso:**
1. El propietario crea los precios desde Admin › Tienda › Precios, con «Crear en Stripe los que faltan».
2. Otra carpeta pone cada `price_…` en su producto y lo enciende.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-17 a las 01:30 (hora de Madrid)**, con el OK del propietario en esta conversación («tienes mi OK en todo»).
- **`shop` v10 → v11.** Justo antes, `check-config` dijo: entran `+skins-navidad`, `+skins-fuego`, `+skins-agua`, `+skins-galaxia`, `+skins-carbono` y `+skins-rubi`, y no cambia nada más. «Se sostiene: shop».
- **Motivo:** «Los seis packs de skins (Navidad, Fuego, Agua, Galactico, Carbono, Rubi) apagados y sin precio, por orden del propietario».
- **Comprobado:**
  - `show-config shop` da 48 productos y los seis packs apagados, sin precio y con 8 piezas;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Lo de antes:** los `products` de la v10 están en `antes/shop.json`, para volver atrás. Solo se guarda ese campo, que es el único que se publica: así no entran en el repositorio público los datos del vendedor (`legal`).
