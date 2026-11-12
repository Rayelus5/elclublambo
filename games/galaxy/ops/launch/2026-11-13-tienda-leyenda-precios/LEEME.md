# Las skins Leyenda, con precio y a la venta

Plan «banda sonora, skins, perfil y entorno», parte C2, último paso. En `shop` v7 los 8 productos de las skins Leyenda estaban apagados y sin precio (`2026-11-12-tienda-leyenda`). El propietario creó los precios desde el panel con «Crear en Stripe los que faltan». Esta carpeta los pone en sus productos y los activa.

**`shop.json` (`products`):** los 42 productos vivos, en el mismo orden e idénticos, salvo los 8 «style-skin-…», que reciben su `stripePriceId` y `enabled: true`. El borrador se hizo desde lo vivo (`antes/shop.json`), y el script comprobó que el importe de cada precio coincide con el `priceCents` de su producto.

| Producto | Precio | Precio de Stripe |
|---|---|---|
| `style-skin-lumen` | 3,99 € | `price_1Ub6yVEruIxZQ4kLLD6yt2I8` |
| `style-skin-bastion` | 2,99 € | `price_1Ub6yWEruIxZQ4kLUTrIhGcP` |
| `style-skin-spark` | 2,99 € | `price_1Ub6yWEruIxZQ4kLbWcNoHH5` |
| `style-skin-sentinel` | 1,99 € | `price_1Ub6yWEruIxZQ4kLi8T3nOJT` |
| `style-skin-anchor` | 1,99 € | `price_1Ub6yXEruIxZQ4kL1tWqXLV0` |
| `style-skin-prism` | 3,99 € | `price_1Ub6yXEruIxZQ4kLAE6nUC3K` |
| `style-skin-comet` | 2,99 € | `price_1Ub6yXEruIxZQ4kLluS8hQzh` |
| `style-skin-echo` | 2,99 € | `price_1Ub6yXEruIxZQ4kL3s0b2YLT` |

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-13 a las 00:40 (hora de Madrid)**, con el OK del propietario en esta conversación.
- **`shop` v7 → v8.** Justo antes de publicar, `check-config` dijo lo mismo: cambian los 8 «style-skin-…» (`~`) y ningún otro.
- **Motivo:** «Precios de Stripe de las 8 skins Leyenda y activadas, por orden del propietario».
- **Sin aviso en Noticias.**
- **Comprobado:**
  - `show-config shop` da la v8: 42 productos y las 8 skins activas con precio;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Lo de antes** (v7) está en `antes/` para volver atrás.
