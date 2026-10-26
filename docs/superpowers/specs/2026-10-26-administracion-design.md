# Administración de ElClub. — diseño

Fecha: 2026-10-26. Estado: aprobado en conversación por el dueño; este documento lo pone por escrito.

## Por qué

ElClub. ya tiene una parte pública con herramientas abiertas a cualquiera y un foro para miembros. El SuperAdmin no tiene hoy forma de:

- apagar una herramienta pública que falla o que no quiere ofrecer en un momento dado, sin desplegar código;
- cerrar la web entera mientras arregla algo, dejando pasar solo a su equipo;
- mostrar páginas de error y de mantenimiento propias, con la identidad de la web, en vez de las de Next.

Todo esto se gestiona desde una pestaña nueva de los ajustes del foro, **«Administración»**, dedicada a la administración general de ElClub.

## Quién

- **SuperAdmin**: el miembro con el bit `ADMINISTRATOR` (rol SuperAdmin), el mismo criterio que ya usa la pestaña «Economía» (`settingsSections` comprueba el bit en bruto). Solo él ve y usa «Administración».
- **Equipo con acceso**: wallets que el SuperAdmin añade a la lista de acceso de mantenimiento.
- **Visitantes**: todos los demás (anónimos, cuentas públicas, miembros del foro).

## Objetivos

### 1. Pestaña «Administración»

- Ruta `/foro/settings/administracion` (nombre del segmento a elección del constructor, coherente con `economia`), en `settingsSections` solo con el bit `ADMINISTRATOR`.
- Secciones: **Herramientas y funciones públicas**, **Mantenimiento**, **Lista de acceso**, **Historial**.
- Cada cambio pide una confirmación cuando corta el acceso a visitantes (apagar algo, activar mantenimiento).

### 2. Herramientas y funciones públicas (interruptores)

Un interruptor por cada una:

| Interruptor | Qué cubre |
|---|---|
| Sorteos verificables | `/[lang]/tools/giveaways` y subrutas |
| ElClub Pay | `/[lang]/tools/pay`, páginas `/[lang]/pay/...` y recibos |
| Comprobador | `/[lang]/tools/checker` |
| Avales | `/[lang]/tools/vouches` |
| Aprobaciones | `/[lang]/tools/approvals` |
| Envío múltiple (incluye «Repartir gastos») | `/[lang]/tools/multisend` |
| Gas | `/[lang]/tools/gas` |
| Donar público | `/donar` (y su equivalente EN si existe). No afecta a «Dona desde el club» dentro del foro |
| API del comprobador | `/api/v1/check/*` |
| Registro de cuentas públicas | que una wallet sin cuenta pueda crear cuenta pública al firmar. Quien ya tiene cuenta sigue entrando |

Todas encendidas por defecto (estado actual).

Comportamiento de una herramienta apagada (decisión del dueño: aviso «No disponible»):

- En el hub `/herramientas` (`/en/tools`) su tarjeta sigue, atenuada, con la etiqueta «No disponible ahora» en vez de «Disponible», y sin enlace activo.
- Desaparece de la landing (bloques que la enlazan).
- Su URL directa muestra una página «Esta herramienta no está disponible ahora» con enlace de vuelta al hub, en el idioma de la ruta. Código HTTP 503.
- **Quien ya tiene la página abierta puede terminar** lo que está firmando (decisión del dueño: no cortar un pago a medias). Por eso no se bloquean las acciones de servidor de verificación/registro posteriores a una firma (p. ej. registrar un pago ya enviado, refrescar un aval). Sí se bloquea empezar algo nuevo al cargar la página.
- API apagada: `503` JSON `{ "error": "unavailable" }`, sin cobrar x402.
- Registro apagado: la wallet nueva que firma ve un mensaje claro («El registro de cuentas está cerrado ahora») y no se crea la cuenta; las existentes entran normal.
- El foro (miembros) no se ve afectado por estos interruptores.

### 3. Modo mantenimiento

- Cierra **toda la web**: parte pública y foro.
- Dos modalidades (decisión del dueño):
  - **Por defecto**: mensaje general fijo, indefinido (sin hora de vuelta).
  - **Personalizado**: texto propio en español e inglés, hora estimada de vuelta (opcional; se muestra en la hora local del visitante), y programación opcional de inicio y fin (se activa y desactiva solo a esas horas).
- Respuesta: página de mantenimiento propia con código **503** y `Retry-After` (para que los buscadores no desindexen).
- **Lo automático sigue funcionando** (decisión del dueño): crons de sorteos, encuestas, verificaciones, webhooks y cualquier llamada de servidor a servidor. El mantenimiento solo cierra páginas y APIs de cara al visitante.
- Recursos estáticos (CSS, JS, fuentes, imágenes) se siguen sirviendo para que la página de mantenimiento se vea bien.

#### Acceso durante el mantenimiento

- La página de mantenimiento tiene un botón discreto **«Acceso del equipo»**.
- Flujo: firmar con la wallet (el SIWE actual) → si la wallet está en la lista de acceso, se pide la **contraseña de mantenimiento** → si es correcta, entra y navega con normalidad.
- **Doble llave** (decisión del dueño): wallet de la lista **y** contraseña.
- **El SuperAdmin entra solo firmando** (decisión del dueño), para no quedarse nunca fuera.
- Una wallet que no está en la lista, o una contraseña incorrecta, sigue viendo mantenimiento con un mensaje claro y sin revelar quién está en la lista.
- Quien entra ve una **franja fija** «Mantenimiento activo: la web está cerrada al público» mientras dure.
- Al terminar el mantenimiento, el acceso especial deja de importar (todos entran).

#### Lista de acceso

- Wallets sueltas (decisión del dueño: sin roles), cada una con una nota opcional («Ana — moderadora»).
- Añadir, quitar, ver. Direcciones validadas y normalizadas.
- La contraseña de mantenimiento se fija y se cambia desde «Administración». Se guarda solo como hash; nunca se muestra.

### 4. Historial

- Lista de las últimas acciones de administración (activar/desactivar interruptores, encender/apagar/programar mantenimiento, cambiar contraseña —sin el valor—, añadir/quitar wallets): fecha, quién, qué.
- Se guarda en el `audit_log` existente.

### 5. Páginas 404 y de mantenimiento propias

- **404 propia** para la parte pública (ES/EN según la ruta) y para el foro, sustituyendo la de Next. Debe cubrir también los casos que hoy acaban en la 404 por defecto.
- **Mantenimiento propia**, ES/EN según el idioma del visitante (ruta o `Accept-Language`).
- **Página «herramienta no disponible»**, en la misma familia visual.
- Tono (decisión del dueño): **sobrio con un detalle visual** — el estilo actual de la web (fondo oscuro, Cerulean para acentos, Base Blue solo como relleno del CTA principal, tipografía Archivo/DM Sans/JetBrains Mono), con un elemento gráfico propio y animado (p. ej. a partir del cuadrado del logo) y textos cortos con algo de chispa.
- Animación respetando `prefers-reduced-motion`. Accesibles (contraste AA, foco visible), sin scroll horizontal de 375 a 1440 px.

## No objetivos

- Permisos por rol para administración (solo SuperAdmin).
- Acceso por roles durante el mantenimiento (solo wallets sueltas).
- Apagar partes del foro con estos interruptores.
- Pausar crons o tareas automáticas durante el mantenimiento.
- Notificar a los usuarios del mantenimiento (push, email).

## Anti-objetivos (fallos aunque «funcione»)

- Que el SuperAdmin pueda quedarse fuera de la web por un error de configuración.
- Que el mantenimiento rompa los crons, los webhooks o el login de quien tiene acceso.
- Que la contraseña o la lista de acceso se filtren al cliente o a los logs.
- Que apagar una herramienta corte un pago o firma ya en curso.
- Que comprobar el estado en cada petición vuelva lenta la web (lectura cara en cada request).
- Que un visitante pueda saltarse el mantenimiento manipulando cookies o cabeceras.

## Restricciones

- Next.js 16 con `cacheComponents` (leer `node_modules/next/dist/docs/` antes de tocar APIs de Next); la comprobación de mantenimiento y de interruptores vive donde ya se decide el acceso (`src/proxy.ts`) y/o en las páginas, sin romper la build sin secretos (`SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build`).
- Estado guardado en Supabase (patrón existente: `app_config` y RPCs auditadas solo para SuperAdmin, como la economía), con RLS; escrituras solo por RPC/servidor.
- Paleta R2 (un solo relleno Base Blue por pantalla), i18n ES/EN con los diccionarios existentes, rutas con `clubPath()`.
- TDD estricto; pgTAP para la base de datos; e2e para mantenimiento, interruptores, 404 y acceso del equipo.
- Nunca secretos en el cliente; la contraseña con un hash lento (bcrypt/argon2/scrypt) y comparación en tiempo constante.

## Decisiones del constructor (calls propias, revisables)

- **SuperAdmin = bit `ADMINISTRATOR`**, como «Economía».
- **Si no se puede leer el estado** (fallo de base de datos): la web sigue abierta (fail-open) y se registra el error; un caché corto (segundos) evita leer en cada petición y hace que un cambio se note en pocos segundos.
- **Sesión de acceso con contraseña**: dura hasta que acaba el mantenimiento y como mucho 12 horas; ligada a la cuenta y a la wallet de la sesión: sin sesión no hay acceso, pero volver a firmar con la misma wallet de la lista dentro de ese plazo entra sin volver a pedir la contraseña (ver «Riesgos residuales»). Cambiar la contraseña invalida los accesos concedidos con la anterior; quitar una wallet de la lista le corta el acceso.
- **Intentos de contraseña limitados** por IP y wallet (reutilizando el rate limit en Postgres existente).
- **Mantenimiento programado** se evalúa por hora en cada comprobación (no depende de un cron).
- **Rutas siempre accesibles en mantenimiento**: recursos estáticos, crons (`/api/cron/*` con su secreto), webhooks, el flujo de login necesario para «Acceso del equipo», y la propia página de mantenimiento.
- **Código 503** en «herramienta no disponible» y mantenimiento; **404** solo en la página 404.
- **Indexación**: las páginas de mantenimiento, «no disponible» y 404 llevan `noindex`.

## Lo que se deja al constructor

Nombres de tablas/columnas/RPCs, formato del caché, cómo se marca la sesión de acceso del equipo (cookie firmada o fila en BD), el diseño gráfico concreto de las tres páginas dentro del tono pedido, y el orden de tareas.

## Hecho

Construido en la rama `feature/administracion` (plan `docs/superpowers/plans/2026-10-26-administracion.md`, tareas 1–8).

### Lo construido, por objetivos

1. **Pestaña «Administración»** (`/foro/settings/administracion`, solo con el bit `ADMINISTRATOR`): secciones Herramientas y funciones públicas, Mantenimiento (modalidad, mensajes, fechas, «Activar ahora», contraseña), Lista de acceso e Historial. Confirmación (`AlertDialog`) al apagar un interruptor y al guardar un mantenimiento activo o programado.
2. **Interruptores**: diez claves en `app_config.site_switches`. El proxy corta con 503 la carga de documento de una herramienta apagada (página «Esta herramienta no está disponible ahora», ES/EN) y `/api/v1/check/*` con `{ "error": "unavailable" }` antes de x402. Las acciones de servidor y las navegaciones dentro de la app pasan, para no cortar un pago en curso. El hub deja la tarjeta atenuada, sin enlace y con «No disponible ahora»; la landing quita su bloque y sus enlaces. Registro cerrado: la cuenta nueva se borra al firmar y ve «El registro de cuentas está cerrado ahora.»; las cuentas existentes, las invitaciones y el SuperAdmin no cambian.
3. **Mantenimiento**: por defecto o personalizado (mensajes ES/EN, vuelta estimada en la hora local del visitante, inicio y fin programados evaluados en cada petición). 503 real con `Retry-After`, `Cache-Control: no-store` y `X-Robots-Tag: noindex`; los crons, `/api/team-access`, `robots.txt`, `sitemap.xml`, las imágenes OG internas y los estáticos pasan. «Acceso del equipo» en la propia página: firmar → wallet en la lista → contraseña (scrypt, intentos limitados) → acceso guardado en BD; el SuperAdmin entra solo firmando. Franja «Mantenimiento activo» para quien entra.
4. **Historial**: las acciones `admin.*` en `audit_log` (sin el valor de la contraseña), visibles solo con el bit 512; los moderadores no las leen.
5. **Páginas propias**: 404 única (ES / EN / foro según la ruta), mantenimiento y «no disponible», con `noindex`, la misma familia visual, una animación del cuadrado del logo que respeta `prefers-reduced-motion` y un solo relleno Base Blue.

### Rutas internas

- `/status/{lang}/maintenance` y `/status/{lang}/unavailable`: solo las sirve el proxy (se pide la página a sí mismo con `x-elclub-status: 1` y la devuelve con 503); pedidas directamente son 404.
- `POST /api/team-access`: responde `not_signed_in`, `needs_password`, `not_listed`, `wrong_password`, `rate_limited`, `granted`, `superadmin` u `off`.

### Rulings del plan

- **A-R1** Lo no secreto en `app_config` (`site_switches`, `maintenance`); lista, hash, accesos y retenciones en tablas con RLS sin políticas.
- **A-R2** RPCs `security definer` con `search_path = ''`; escrituras solo para el bit 512 y auditadas como `admin.*`.
- **A-R3** El proxy lee `site_state()` con la clave anónima, timeout 1,5 s, caché de módulo `SITE_STATE_TTL_MS` (5 s; 0 en e2e) y fail-open.
- **A-R4** El acceso del equipo es una fila en `maintenance_grants` atada a `auth.uid()`, la wallet y la versión de la contraseña; caché solo de positivos, 5 s.
- **A-R5** Cambiar la contraseña, quitar una wallet o apagar el mantenimiento borra los accesos; caducan a las 12 h o en `endsAt`.
- **A-R6** El SuperAdmin pasa por `SUPER_ADMIN_WALLET` sin BD o por el bit 512, sin contraseña.
- **A-R7** En mantenimiento pasan estáticos, crons, webhooks, `/api/team-access`, `robots.txt`, `sitemap.xml` y OG internas; `/foro/login` no; `/status/*` directo es 404.
- **A-R8** 503 con `no-store` y `noindex`; `Retry-After` solo en mantenimiento (`returnAt`, si no `endsAt`, acotado a 60–86400 s; si no hay ninguno, 3600); JSON fuera de las páginas.
- **A-R9** Un interruptor corta solo cargas de documento GET/HEAD (y toda `/api/v1/check/*`); el SuperAdmin no se los salta.
- **A-R10** scrypt N=2^15, r=8, p=1, 12–128 caracteres, `timingSafeEqual`, 20 intentos por IP y 5 por sesión cada 15 min.
- **A-R11** Activo = (`enabled` o `startsAt` pasado) y `endsAt` futuro o nulo; validación en SQL (`maintenance_invalid`).
- **A-R12** Idioma de las páginas de estado por la ruta y, si no la hay, por `Accept-Language`.
- **A-R13** Registro cerrado: retención por trigger en `auth.users`, `my_registration_blocked()`, la app borra la cuenta nueva; al reabrir se borran las retenciones.
- **A-R14** Una sola `not-found.tsx` en la raíz con variante por `x-pathname`.
- **A-R15** Cookie cosmética `elclub-mnt=1` para la franja.
- **A-R16** Hub y landing leen el estado dentro de `<Suspense>` tras `connection()`; tarjeta atenuada en el hub, bloques fuera en la landing, sin promover otro relleno.
- **A-R17** Un relleno por pantalla: ninguno en mantenimiento hasta abrir el panel, «Ver herramientas», «Volver al inicio» / «Volver al foro», «Guardar mantenimiento».
- **A-R18** Confirmación al apagar un interruptor y al activar o programar el mantenimiento; no al encender ni en la lista.
- **A-R19** Wallet fuera de la lista → «Esta wallet no tiene acceso durante el mantenimiento.»; contraseña mala → «Contraseña incorrecta.».
- **A-R20** Textos ES/EN fijados en `status.*`, `tools.unavailableNow` y `connect.errRegistrationClosed`.

### Rulings durante la ejecución

- El mantenimiento bloquea también los POST; un pago ya enviado conserva su hash y se registra al terminar.
- El SuperAdmin no se salta una herramienta apagada.
- `/tools/checker/api` sigue el interruptor «API del comprobador».
- Una cuenta creada por la API de GoTrue con el registro cerrado existe pero no puede usar nada público (`is_public_account()` la rechaza; filas huérfanas aceptadas).
- Los interruptores cortan solo cargas de documento: una pestaña antigua puede seguir navegando dentro de la herramienta hasta recargar.
- Las filas `admin.*` de `audit_log` quedan ocultas a los moderadores (bit 32) salvo con el bit 512; una concesión con `endsAt` pasado devuelve `expired`.
- Las imágenes OG con hash se clasifican por herramienta; en mantenimiento una OG pública ES da 503 (aceptado).
- **503 real**: Next pone 200 a una página reescrita, así que el proxy pide `/status/{lang}/{kind}` a su propio origen (`INTERNAL_ORIGIN`; si no, `http://127.0.0.1:<puerto>` cuando escucha en loopback o 0.0.0.0, como en PRE tras el túnel; si no, el origen de la petición, como en Vercel) y la devuelve con 503. Caché de 5 s, también negativa; si falla, vuelve al rewrite (200 con las mismas cabeceras), nunca una página en blanco.
- El panel del equipo no usa acciones de servidor ni RSC (darían 503): habla con Supabase desde el navegador, llama a `/api/team-access` y recarga.
- Las páginas de estado son dinámicas (`connection()`), para que Next no cambie el `no-store` por un `s-maxage`.
- Registro cerrado: `getPublicSession()` devuelve null para una cuenta retenida (cierre único para toda acción pública) y, en profundidad, `enter_public_giveaway`, `record_public_giveaway_payout` y `mark_public_prize_delivered` rechazan a los retenidos; `is_public_account()` exige que exista el usuario de auth. El SuperAdmin queda exento.
- **404 sin sesión** (sustituye el ruling de P2 «un anónimo en una URL basura ve el login»): un único segmento desconocido (`/typo`, `/wp-admin`) es la 404 propia también sin sesión, antes de la redirección a `/foro/login`; las rutas del foro siguen pidiendo login.
- **Cierre final**: `setMaintenancePasswordAction` comprueba el bit `ADMINISTRATOR` (`my_permissions`) antes de scrypt; el matcher del proxy deja fuera solo `_next/`, `favicon.ico`, `sw.js` y los SVG de `public/brand/` (una URL como `/foro/x.png` pasa por todas las puertas); los interruptores leen la ruta decodificada (`/en/tools/%67as` es Gas); el cuerpo de `/api/team-access` se corta a 4 KB (400 `invalid`); el formulario quita del borrador una «Vuelta estimada» o un «Termina» guardados que ya pasaron y, si la RPC rechaza una fecha, dice cuál; `?registration=closed` sale de la URL tras mostrar el aviso; la descripción de una herramienta apagada ya no se atenúa (AA).
- En la landing, el botón de pago dibujado dentro de la demo de Pay es parte de la ilustración: el test de A-R16 cuenta los enlaces con relleno (`a.bg-accent-fill`), que llegan a cero con «Sorteos» apagado.

### Riesgos residuales

- Con varias instancias cada una tiene su caché: un cambio tarda hasta 5 s en notarse, y un acceso revocado puede durar hasta 5 s más (caché de positivos).
- Si el self-fetch de la página de estado falla, la respuesta es 200 con las cabeceras de mantenimiento (contenido correcto, código incorrecto) hasta que vuelva.
- Una cuenta creada directamente contra GoTrue con el registro cerrado deja una fila huérfana sin acceso.
- **El mantenimiento no congela la base de datos**: cierra las páginas y las APIs de la app, pero un miembro con sesión puede seguir escribiendo directamente en Supabase (PostgREST) según sus políticas RLS. Si hiciera falta congelar escrituras (una migración delicada), haría falta una marca en la BD.
- **Los accesos del equipo sobreviven al cierre de sesión**: sin sesión no hay acceso, pero la fila de `maintenance_grants` sigue ahí; volver a firmar con la misma wallet de la lista dentro del plazo (12 h o `endsAt`) entra sin volver a pedir la contraseña. Coste aceptado: con la clave de esa wallet robada, la contraseña no se vuelve a pedir dentro del plazo. Cambiar la contraseña o quitar la wallet lo corta.
- La comprobación de `SUPER_ADMIN_WALLET` está en dos sitios (la ruta y `access.ts`) a propósito: necesitan salidas distintas.

### HACER A MANO

- **En PRE**: fijar la contraseña de mantenimiento, añadir una wallet del equipo, activar el mantenimiento 5 minutos y comprobar que el cron de Vercel (`/api/cron/dao`) sigue respondiendo; apagar y encender una herramienta y ver el hub.
- **En PRE**: durante ese mantenimiento, comprobar con `curl -I https://pre.elclub.party/` que el self-fetch devuelve un 503 de verdad detrás del túnel. Si diera 200, fijar `INTERNAL_ORIGIN=http://127.0.0.1:3000` en `web.env` (opcional en los demás casos).
- **En PRO**: apagar «Gas» desde la pestaña, comprobar con `curl -I https://www.elclub.party/en/tools/gas` que responde **503** (el self-fetch funciona en Vercel, sin Firewall ni Bot protection por medio) y volver a encenderlo. No hace falta ventana de mantenimiento.
- **En PRE y PRO**: comprobar que la migración `20261026100001_administracion.sql`, con el trigger `after insert on auth.users`, se aplica en el Supabase de cada entorno.
- **Local**: hasta el próximo `pnpm db:reset` (o e2e), la BD local puede tener el miembro SuperAdmin de prueba del e2e.
