# Los cosméticos de la tienda, con precio y activos

Plan de mejoras de noviembre, C5, último paso. En `shop` v5 los 12 cosméticos estaban apagados y sin precio de Stripe (`2026-11-12-tienda-estilo`). El propietario creó los precios desde el panel con «Crear en Stripe los que faltan», que solo los crea en Stripe. Esta carpeta los pone en sus productos y los activa. Se publica por línea de comandos con la skill `galaxy-publicar-config`, con el OK del propietario: «preparalo tú y publicalo por linea de comandos».

**`shop.json` (`products`):** los 34 productos vivos, en el mismo orden e idénticos, salvo los 12 «style-…», que reciben su `stripePriceId` y `enabled: true`. El borrador se hizo desde lo vivo (`antes/shop.json`), y el script comprobó que el importe de cada precio creado coincide con el `priceCents` del producto.

| Producto | Precio | Precio de Stripe |
|---|---|---|
| `style-nebula-queen` | 2,99 € | `price_1Uas5cEruIxZQ4kLiiJLuMXR` |
| `style-void-knight` | 2,99 € | `price_1Uas5dEruIxZQ4kLBf76pI5G` |
| `style-star-fox` | 1,99 € | `price_1Uas5dEruIxZQ4kL3sXJ00W5` |
| `style-comet-rider` | 1,99 € | `price_1Uas5dEruIxZQ4kL1RzvrpnG` |
| `style-prism` | 2,99 € | `price_1Uas5dEruIxZQ4kLeRrqddaa` |
| `style-solar` | 2,49 € | `price_1Uas5eEruIxZQ4kLNd5ptlfi` |
| `style-eclipse` | 1,49 € | `price_1Uas5eEruIxZQ4kLjzmktsT0` |
| `style-starlight` | 0,99 € | `price_1Uas5eEruIxZQ4kL65Apc9g2` |
| `style-patron` | 1,99 € | `price_1Uas5fEruIxZQ4kL37Ku8iab` |
| `style-pioneer` | 1,49 € | `price_1Uas5fEruIxZQ4kLg3O7AAkg` |
| `style-guardian` | 0,99 € | `price_1Uas5fEruIxZQ4kLbE771zCB` |
| `style-voyager` | 0,99 € | `price_1Uas5fEruIxZQ4kLT2xFS9vb` |

La tienda está abierta a todos (`enabled: true`, `audience: everyone`), así que la pestaña «Estilo» sale en cuanto se publica.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-12 a las 08:10 (hora de Madrid)**, con el OK del propietario de esta conversación.
- **`shop` v5 → v6.** `check-config`, repetido justo antes de publicar, dijo lo mismo: cambian los 12 «style-…» (`~`), ninguno entra ni sale, y «Se sostiene».
- **Motivo:** «Precios de Stripe de los 12 cosmeticos y activados, por orden del propietario».
- **Sin aviso en Noticias.**
- **Comprobado:** `show-config shop` da la v6 con los 12 activos y con precio (34 productos), la salud responde `{"ok":true,"db":"up"}` y el contenedor no dejó errores.
- **Lo de antes** (v5) está en `antes/` para volver atrás.
