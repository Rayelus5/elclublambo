# Los seis packs de skins, con precio y a la venta

Último paso del plan de packs de skins. En `shop` v11 los seis packs estaban apagados y sin precio (`2026-11-17-packs-skins`). El propietario creó los precios desde el panel con «Crear en Stripe los que faltan», que los crea con el importe de cada producto (1.699 céntimos), y pasó sus ids. Esta carpeta los pone en sus productos y los enciende.

**`shop.json` (`products`):** los 48 productos vivos de la v11, en el mismo orden e idénticos, salvo los seis packs, que reciben su `stripePriceId` y `enabled: true`. Se hizo desde lo vivo (`antes/shop.json`, solo `products`).

| Producto | Precio | Precio de Stripe |
|---|---|---|
| `skins-navidad` | 16,99 € | `price_1UcaFxEruIxZQ4kLm1nkLBqf` |
| `skins-fuego` | 16,99 € | `price_1UcaFyEruIxZQ4kLcmethueU` |
| `skins-agua` | 16,99 € | `price_1UcaFyEruIxZQ4kL4w3exCZv` |
| `skins-galaxia` | 16,99 € | `price_1UcaFyEruIxZQ4kLjNBSYbGd` |
| `skins-carbono` | 16,99 € | `price_1UcaFyEruIxZQ4kLuNnfPXhs` |
| `skins-rubi` | 16,99 € | `price_1UcaFzEruIxZQ4kLsVvpbyJr` |

**Navidad** se vende hasta el 10 de enero incluido: a las 00:00 del 11 de enero en Madrid deja de verse y de venderse sola. El servidor compara en cada pago el precio de Stripe con el mostrado; si no coinciden, no cobra y avisa al admin.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-17 a las 01:50 (hora de Madrid)**, con el OK del propietario en esta conversación (pasó los precios para que los packs se pusieran a la venta).
- **`shop` v11 → v12.** Justo antes, `check-config` dijo: cambian los seis packs (`~`) y ningún otro producto. «Se sostiene: shop».
- **Motivo:** «Precios de Stripe de los seis packs de skins y encendidos, por orden del propietario».
- **Comprobado:**
  - `show-config shop` da la v12: 48 productos y los seis packs encendidos, con su precio;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Lo de antes:** los `products` de la v11 están en `antes/shop.json`, para volver atrás.
