# Galaxy Survivor: ruta a producción y pruebas de carga

Este documento recoge lo que falta para llevar la beta a producción (GDD §18 y M8). También dice qué tienes que decidir tú antes de tocar `main`. Nada de esto se ha hecho todavía: `main` y producción siguen sin el juego.

## Lo que hay que decidir

1. **Dónde vive el servidor del juego.** Vercel no puede alojar Fastify con WebSocket (el chat), así que el juego necesita un servidor aparte. El rewrite de `/galaxy/:path*` en Vercel apuntará a él.

   | Opción | A favor | En contra |
   |---|---|---|
   | **Proxmox de casa con un túnel de Cloudflare de producción** (como PRE, con otro nombre) | Coste cero. El mismo despliegue que PRE, ya probado. | Depende de la luz y la conexión de casa. El bloqueo de LaLiga a las IP de Cloudflare deja el juego sin acceso durante los partidos, igual que PRE. |
   | **VPS pequeño** (2 vCPU, 4 GB) | Disponible siempre, sin cortes por el fútbol. Mismo `docker-compose`. | Unos 5–10 € al mes y otro sitio que mantener. |

   Recomendación: un **VPS** para la beta con amigos, porque los cortes de LaLiga en PRE han sido frecuentes. PRE puede seguir en casa.

2. **Los datos de la beta.**
   - **Conservarlos:** las cuentas, colecciones y temporadas de PRE pasan a producción.
   - **Empezar de cero.**

   Todo se ha construido como datos de producción (libro de movimientos, migraciones serias, versiones de configuración), así que las dos opciones están abiertas.

3. **Cuándo fusionar `develop` en `main`.** Al fusionar, el esquema `galaxy` se crea vacío en el Supabase de producción (aceptado en el GDD). Hasta que el servidor esté en marcha, el rewrite de Vercel no debe publicarse.

## Pasos cuando lo decidas

1. Fusionar `develop` → `main`, con tu visto bueno.
2. En el Supabase de producción:
   - aplicar las migraciones;
   - crear el rol `galaxy_api` con su contraseña, como el paso 1 de `DEPLOY_PRE.md`.

   Límites del plan Free:
   - **Conexiones:** el servidor usa un pool pequeño.
   - **500 MB:** la retención diaria de M8b borra las entradas grabadas a los 30 días y el chat a los 90.
3. En el servidor elegido:
   - `docker compose` con la imagen del juego y `galaxy.env` (base de datos, `GALAXY_TOTP_KEY` nueva, `GALAXY_PUBLIC_ORIGINS=https://www.elclub.party`);
   - el túnel o el proxy con HTTPS.
4. En Vercel: el rewrite de `/galaxy/:path*` al servidor del juego.
5. Crear los admins por SSH (`node dist/cli.js create-admin`), nunca desde aquí.
6. Pasar la prueba de carga contra producción antes de abrirla.

## Pruebas de carga

`tools/load/load.mjs` simula jugadores que leen lo que el juego lee más:
- **Rutas:** sesión, escáner, misiones, temporada, clasificación, multiplicadores, primeros pasos, Catálogo y hangar.
- **Resultados:** las latencias p50, p95 y p99 por ruta, los errores y las peticiones por segundo.
- **Dependencias:** ninguna, solo Node 22 o más.
- **Cuentas:** el registro está limitado a 5 por IP y hora, así que usa pocas sesiones y las comparte. Puede usar cuentas tuyas con `LOAD_USERS`.

```bash
# Contra un servidor local (el del e2e en el puerto 8090):
node tools/load/load.mjs --base http://localhost:8090/galaxy --users 2 --concurrency 20 --seconds 20
# Contra PRE, solo cuando no lo esté usando nadie:
node tools/load/load.mjs --base https://pre.elclub.party/galaxy --users 3 --concurrency 40 --seconds 60
```

El script termina con error si más del 1 % de las peticiones fallan.

**Medida de referencia local** (Windows, Postgres local de Supabase, 20 a la vez, 2026-11-08):
- **Total:** 670 peticiones por segundo, sin errores.
- **p95:** entre 23 ms (multiplicadores) y 91 ms (hangar, que lee la colección).

Falta medir PRE y el servidor de producción. No se ha lanzado contra PRE porque es tu servidor de casa.
