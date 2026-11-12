# Los cosméticos de la tienda, apagados

Plan de mejoras de noviembre, C5. La tienda de PRE está publicada (`shop` v4), así que los 12 cosméticos de pago del código no salían en el panel. Se publican **apagados y sin precio de Stripe**: los jugadores no ven nada nuevo hasta que el propietario les pone su precio y los activa. Se publica con la skill `galaxy-publicar-config`, con el OK que el propietario dio para este plan. Necesita el PR #139 desplegado.

**`shop.json` (`products`):** los 22 productos de hoy, en el mismo orden e idénticos (con sus precios de Stripe), y los 12 nuevos al final:

| Producto | Pieza | Precio |
|---|---|---|
| `style-nebula-queen` | Avatar Reina de la nebulosa | 2,99 € |
| `style-void-knight` | Avatar Caballero del vacío | 2,99 € |
| `style-star-fox` | Avatar Zorro estelar | 1,99 € |
| `style-comet-rider` | Avatar Jinete del cometa | 1,99 € |
| `style-prism` | Marco Prisma | 2,99 € |
| `style-solar` | Marco Corona solar | 2,49 € |
| `style-eclipse` | Marco Eclipse | 1,49 € |
| `style-starlight` | Marco Luz de estrellas | 0,99 € |
| `style-patron` | Título «Mecenas estelar» | 1,99 € |
| `style-pioneer` | Título «Pionero del ECN» | 1,49 € |
| `style-guardian` | Título «Guardián de la nebulosa» | 0,99 € |
| `style-voyager` | Título «Viajero del vacío» | 0,99 € |

El borrador se hizo en PRE con `draft-config shop products`.

**Lo que falta, del propietario:** en el panel › Tienda, a cada «style-…» ponerle su `price_…` (o «Crear en Stripe los que faltan») y activarlo. La pestaña «Estilo» sale sola en cuanto haya uno activo.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-12 hacia las 04:40 (hora de Madrid)**, con el OK que el propietario dio para este plan, tras desplegar el PR #139.
- **`shop` v4 → v5.** `check-config`, repetido justo antes de publicar, dijo lo mismo: entran los 12 «style-…» y «Se sostiene».
- **Motivo:** «Cosmeticos de la tienda, apagados y sin precio hasta que el propietario los active».
- **Sin aviso:** los jugadores no ven nada nuevo hasta que se activen.
- **Comprobado:** la salud responde `{"ok":true,"db":"up"}` y el contenedor no dejó errores.
- **Lo de antes** (v4) está en `antes/` para volver atrás.
