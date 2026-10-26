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
- **Sesión de acceso con contraseña**: dura hasta que acaba el mantenimiento y como mucho 12 horas; ligada a la wallet de la sesión (si cambia la wallet o se cierra sesión, se pierde). Cambiar la contraseña invalida los accesos concedidos con la anterior; quitar una wallet de la lista le corta el acceso.
- **Intentos de contraseña limitados** por IP y wallet (reutilizando el rate limit en Postgres existente).
- **Mantenimiento programado** se evalúa por hora en cada comprobación (no depende de un cron).
- **Rutas siempre accesibles en mantenimiento**: recursos estáticos, crons (`/api/cron/*` con su secreto), webhooks, el flujo de login necesario para «Acceso del equipo», y la propia página de mantenimiento.
- **Código 503** en «herramienta no disponible» y mantenimiento; **404** solo en la página 404.
- **Indexación**: las páginas de mantenimiento, «no disponible» y 404 llevan `noindex`.

## Lo que se deja al constructor

Nombres de tablas/columnas/RPCs, formato del caché, cómo se marca la sesión de acceso del equipo (cookie firmada o fila en BD), el diseño gráfico concreto de las tres páginas dentro del tono pedido, y el orden de tareas.
