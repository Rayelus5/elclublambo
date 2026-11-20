# Las skins Leyenda en la tienda, cerradas y sin precio

Plan «banda sonora, skins, perfil y entorno», parte C2, primer paso. Las 8 skins Leyenda (animadas) se venden en la pestaña «Estilo». El código ya está en PRE (#161), pero la tienda publicada (`shop` v6) no las tiene: los productos nuevos del código solo llegan al publicar.

**`shop.json` (`products`):** los 34 productos vivos, en el mismo orden e idénticos (`antes/shop.json`), y al final los 8 de las skins Leyenda. Van **apagados y sin precio de Stripe**: nadie los ve hasta el paso siguiente.

| Producto | Skin | Precio | Distintivo |
|---|---|---|---|
| `style-skin-lumen` | Lumen leyenda | 3,99 € | Nuevo |
| `style-skin-prism` | Prisma leyenda | 3,99 € | Más popular |
| `style-skin-bastion` | Bastión leyenda | 2,99 € | |
| `style-skin-spark` | Chispa leyenda | 2,99 € | |
| `style-skin-comet` | Cometa leyenda | 2,99 € | |
| `style-skin-echo` | Eco leyenda | 2,99 € | |
| `style-skin-sentinel` | Vigía leyenda | 1,99 € | |
| `style-skin-anchor` | Áncora leyenda | 1,99 € | |

**Después de publicar:**
1. El propietario, en Administración › Tienda, pulsa «Crear en Stripe los que faltan». Crea los 8 precios con estos importes.
2. Se ponen los precios en sus productos y se activan, como en `2026-11-12-tienda-estilo-precios`.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-13 a las 00:25 (hora de Madrid)**, con el OK del propietario en esta conversación.
- **`shop` v6 → v7.** Justo antes de publicar, `check-config` dijo lo mismo: entran los 8 «style-skin-…» (`+`) y no sale ni cambia ningún otro.
- **Motivo:** «Productos de las skins Leyenda, apagados y sin precio, por orden del propietario».
- **Sin aviso en Noticias.**
- **Comprobado:**
  - `show-config shop` da la v7: 42 productos, los 8 nuevos apagados y sin precio;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Lo de antes** (v6) está en `antes/` para volver atrás.
- **Aparte** (ya estaba en lo vivo y esta carpeta no lo toca): `check-config` avisa de que los eventos «primer-contacto» y «escuadron-estelar» no caben en la temporada season-1.
