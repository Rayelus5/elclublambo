# Fase 2: motor del foro (diseño)

Spec padre: `docs/superpowers/specs/2026-10-16-plan-maestro.md`. F1 está mergeada (PR #1): identidad, invitaciones, baneos, bitfield de permisos global y shell del foro.

## Intención

Que la comunidad deje Discord. El club funciona **como Discord en estructura y ritmo**: canales, chat en tiempo real, hilos, roles y permisos finos. Encima lleva la estética y la seguridad del Plan Maestro: tokens §1, gate en Postgres y una postura anti-scam.

**Éxito:** un miembro entra, ve solo los canales que su rol le permite, chatea en tiempo real, responde en hilos, recibe avisos de escritorio cuando le mencionan, y el admin monta y reorganiza todo sin tocar código.

**Anti-objetivos** (aunque "funcione", sería un fracaso):
- Que un mensaje de un canal oculto llegue a quien no debe ver ese canal, por la vía que sea (tiempo real, búsqueda, notificaciones, push, contador de no leídos).
- Que una cuenta nueva pueda publicar enlaces o imágenes de phishing.
- Que dos miembros puedan hablar en privado sin staff. Los únicos espacios privados son los tickets.

## Decisiones del usuario

1. **Árbol de canales.** Tres tipos de nodo:
   - **Categoría:** separador visual, solo en la raíz.
   - **Foro:** contenedor sin mensajes propios, anidable dentro de categorías o de otros foros.
   - **Canal de texto:** hoja con conversación tipo chat.

   Ejemplo: categoría *Mercado* → foro *Airdrops* → foro *L2* → texto *Linea*.
2. **Permisos en cascada por todo el árbol.** Base del miembro (F1: `@everyone` OR sus roles) → overwrites de la categoría → los de cada foro antecesor, de arriba abajo → los del propio nodo. En cada nivel se aplica el orden de Discord:
   1. `@everyone` deny/allow;
   2. roles: primero el OR de todos los deny, luego el OR de todos los allow;
   3. miembro deny/allow.

   `ADMINISTRATOR` lo concede todo. Las penalizaciones globales de F1 (`member_permission_overrides`) se aplican al final y prevalecen. Si se oculta un nodo (`VIEW_CHANNEL` denegado), queda oculto todo lo que cuelga de él, aunque un descendiente lo permita.
3. **Canales de texto en tiempo real.** Mensajes, ediciones, borrados, reacciones y respuestas en hilos aparecen sin recargar.
4. **Hilos de un solo nivel** (Discord/Slack). Responder a un mensaje abre su hilo en un panel lateral. Dentro del hilo las respuestas son lineales y se puede citar a otra respuesta, pero no hay hilos dentro de hilos.
5. **Publicaciones especiales como mensajes** del canal de texto:
   - **Alpha/Tesis:** pide un contrato `0x…` de Linea y muestra el widget de DexScreener junto al texto. Su hilo hace de debate.
   - **Bounty** existe como tipo, pero **se construye en F3** porque necesita las propinas verificadas on-chain.
6. **Slowmode por canal de texto:** desactivado, entre 5 s y 1 semana, o un valor a medida en segundos dentro de ese rango.
   - Se aplica por usuario y cuenta tanto los mensajes del canal como las respuestas en sus hilos.
   - Quien tenga `MANAGE_MESSAGES` o `ADMINISTRATOR` está exento.
   - La UI muestra la cuenta atrás.
7. **Permisos de contenido separados, estilo Discord:**
   - Sin `ATTACH_FILES` no se adjuntan imágenes.
   - Sin `EMBED_LINKS` las URLs se muestran como texto plano no clicable y sin preview.
   - El formato y los emojis están siempre permitidos.
8. **Interacciones:**
   - reacciones con emoji;
   - menciones `@usuario`, `@rol`, `@everyone`;
   - editar y borrar mensajes propios (se marca "editado"); los moderadores borran los de otros;
   - fijar mensajes;
   - marcador de no leídos por canal.
9. **`@everyone` y las menciones de rol solo notifican** a quien tenga el nuevo permiso `MENTION_EVERYONE`. Para el resto se muestran como texto y no avisan a nadie.
10. **Notificaciones.** Bandeja dentro de la app y **Web Push**, que llega aunque la pestaña esté cerrada. Eventos:
    - menciones;
    - respuestas a mis mensajes o en hilos en los que participo;
    - nuevo mensaje en canales que sigo (preferencia por canal: todo / solo menciones / silencio);
    - actividad de invitaciones (canjearon tu invitación; un ahijado fue baneado o te penalizaron);
    - avisos de moderación para el staff (nuevo reporte, miembro marcado "Revisar", nuevo ticket).
11. **Reportar mensaje** con motivo (scam, spam, abuso, otro) y cola de reportes para moderadores. Desde ella se borra el mensaje o se abre el baneo de F1.
12. **Sin DMs.** La única conversación privada es el **ticket**:
    - Lo abre el miembro desde los canales de texto con tickets activados (por ejemplo *Soporte Técnico*, *Ayuda*).
    - Es un hilo privado que solo ven su autor y quienes tienen `MANAGE_TICKETS`.
    - Estados: abierto / cerrado. El staff puede reabrirlo.
13. **Compositor de mensajes:**
    - Caja compacta: Enter envía, Shift+Enter nueva línea, atajos markdown, comando `/` (Alpha, imagen, bloque de código), pegar o arrastrar imágenes, selector de emoji, autocompletado de `@`.
    - Botón **modo expandido** tipo Notion para mensajes largos: encabezados, listas, citas, código, tablas, separadores e imágenes.
14. **Panel "Ajustes del servidor"** (admin):
    - Árbol completo con arrastrar y soltar, con alternativa por teclado.
    - Crear, renombrar, mover, reordenar y borrar.
    - Configurar slowmode y tickets por canal.
    - Matriz de permisos roles/miembros × permisos, con estados permitir / heredar / denegar.
    - Gestión de roles: crear, color, posición, permisos.
    - Lista de dominios permitidos del guardián de enlaces.
15. **Cmd+K:** canales y foros visibles, miembros (nombre o wallet), texto completo de mensajes (respetando permisos) y acciones ("Crear invitación", "Ajustes", "Mis menciones", "Abrir ticket"…).
16. **Semilla.** Todo editable después desde el panel. `*` = solo admins/moderadores publican; el resto lee y reacciona.
    - Categoría *Comunidad*: General, Reglas*, Anuncios*, Noticias.
    - Categoría *Mercado*: Trading, Airdrops (foro: L1, L2), Links de referidos.
    - Categoría *Ayuda*: Consejos antiscam*, Soporte Técnico (tickets), Ayuda (tickets).
17. **Roles semilla nuevos:**

    | Rol | Desbloquea |
    |---|---|
    | **Verificado** | `ATTACH_FILES` + `EMBED_LINKS`. `@everyone` **no** los tiene. |
    | **Moderador** | `MANAGE_MESSAGES`, `BAN_MEMBERS`, `MANAGE_TICKETS`, `MENTION_EVERYONE`, `VERIFY_MEMBERS`, más los de Verificado. |
    | **Soporte** | `MANAGE_TICKETS` + Verificado. |

18. **Verificado lo da el staff a mano** (admin y Moderador) desde Miembros. Moderador solo puede asignar o quitar *Verificado*, no cualquier rol. Los miembros que existan al migrar y los Padrinos lo reciben automáticamente.
19. **Mensajes Alpha:**
    - Solo en canales con la opción **"Permitir Alpha"** activada (de serie: Trading, y Airdrops con sus subcanales).
    - Requieren `EMBED_LINKS` (Verificado).
    - Antes de publicar se comprueba on-chain que la dirección es un contrato en **Linea mainnet (59144)**. Si no lo es, se rechaza con un mensaje claro.
20. **Sin previews de enlaces en F2.** Con `EMBED_LINKS` el enlace es clicable y pasa por el guardián (`/out` con aviso si el dominio no está permitido). Las tarjetas de preview quedan para más adelante y solo para dominios permitidos.
21. **Valores por defecto de "seguir":** todos los canales visibles en *solo menciones*; *Anuncios* en *todo*. Cada miembro lo cambia por canal (todo / solo menciones / silencio).

## Contenido de cada entrega

- **F2a. Estructura y permisos:**
  - Migración de bits y roles semilla (Verificado, Moderador, Soporte, y Verificado para los miembros actuales y los Padrinos).
  - Árbol de nodos con flags por canal: slowmode, tickets, permitir Alpha, y los campos de gating DAO.
  - Overwrites, y la función de permisos en cascada con su espejo en TS y fixtures JSON compartidos.
  - Canales semilla y barra lateral con el árbol visible.
  - Panel "Ajustes del servidor": árbol con arrastrar y soltar, matriz de permisos, gestión de roles y dominios permitidos.
  - Asignar Verificado desde Miembros.
- **F2b. Chat:**
  - Mensajes, hilos, compositor (compacto + expandido), imágenes, reacciones, editar/borrar, fijar, no leídos y slowmode.
  - Menciones (parseo y validación; el aviso llega en F2c).
  - Guardián de enlaces con `/out`, mensajes Alpha y tiempo real.
- **F2c. Avisos y soporte:** bandeja de notificaciones, preferencias por canal, Web Push, reportes con cola, tickets privados y avisos de moderación e invitaciones.
- **F2d. Búsqueda:** Cmd+K con canales, miembros, mensajes (texto completo) y acciones.

## Mis decisiones (del controlador, revisables)

- **Penalizaciones globales** (`member_permission_overrides` de F1):
  - Su `deny` se aplica al final y gana a cualquier allow de canal.
  - Su `allow` **solo afecta a bits globales**: nunca concede bits de canal, así que no puede revelar canales ocultos ni tickets.
  - Los administradores siguen sin ser penalizables (comportamiento de F1).
- **Panel de ajustes delegable:**
  - Árbol y overwrites requieren `MANAGE_CHANNELS`; roles requieren `MANAGE_ROLES`; `ADMINISTRATOR` lo puede todo.
  - Reglas anti-escalada de Discord: no puedes conceder bits que no tienes, ni tocar roles de posición ≥ a tu rol más alto, ni crear overwrites que te beneficien a ti o a un rol tuyo con bits que no tenías.
  - Todo se aplica en las RPC y se cubre con pgTAP.
- **Bit nuevo `VERIFY_MEMBERS=32768`:** solo permite asignar o quitar el rol Verificado. Lo tienen Moderador y los admins. Por tanto `ALL_PERMS` pasa a 65535.
- **Gating DAO (preparado para F3):**
  - Columnas `gate_mode`/`gate_value`/`gate_scope` en cualquier nodo.
  - Se heredan en cascada como `VIEW`; `gate_scope=post` afecta a `SEND_MESSAGES` y `SEND_IN_THREADS`.
  - En F2 la comprobación siempre devuelve "pasa" y la interfaz no lo muestra.
- **Tiempo real a prueba de pérdidas de acceso:** las emisiones de Realtime solo llevan IDs y el tipo de evento. El cliente pide el contenido por consulta normal bajo RLS, así que quien pierde acceso deja de recibir contenido de inmediato aunque siga suscrito. Además, al cambiar permisos o al banear, el cliente reevalúa sus suscripciones.
- **Alpha on-chain:** la comprobación `getCode` se hace en una Server Action con viem (RPC de Linea mainnet) **antes** de llamar a la RPC de publicación, que recibe el resultado verificado. El widget de DexScreener usa siempre la dirección y la red mainnet, también en desarrollo.

- **Un solo editor (Tiptap) y un solo formato de documento** (JSON de ProseMirror) para la caja compacta y el modo expandido. Sustituye a BlockNote del Plan Maestro: evita dos formatos, dos sanitizadores y dos renderers. El contenido se guarda como JSON más una versión en texto plano para búsqueda y notificaciones. **Nunca HTML.** Se renderiza en servidor con un allowlist de nodos y marcas.
- **Profundidad máxima del árbol: 6 niveles** (categoría incluida). Límite de cordura para la UI y para el cálculo de permisos.
- **Bits de permiso.** F1 reservó `CREATE_THREADS=2` y `SEND_REPLIES=4`. En F2 pasan a significar:
  - `SEND_MESSAGES=2`: publicar en el canal.
  - `SEND_IN_THREADS=4`: responder en hilos.

  Bits nuevos: `ATTACH_FILES=1024`, `EMBED_LINKS=2048`, `MENTION_EVERYONE=4096`, `ADD_REACTIONS=8192`, `MANAGE_TICKETS=16384`, `VERIFY_MEMBERS=32768` (ver abajo). `ALL_PERMS` pasa a 65535. Esto obliga a actualizar el `& 512 → 1023` de F1. `@everyone` queda en `VIEW|SEND_MESSAGES|SEND_IN_THREADS|ADD_REACTIONS`.
- **Permisos de solo canal vs globales.** Los overwrites de canal solo afectan a bits de canal: VIEW, SEND_*, ATTACH, EMBED, MENTION_EVERYONE, ADD_REACTIONS, MANAGE_MESSAGES, MANAGE_TICKETS. Los globales (CREATE_INVITES, BAN, MANAGE_ROLES, MANAGE_CHANNELS, MANAGE_TREASURY, ADMINISTRATOR) se ignoran en un overwrite.
- **Tiempo real con canales privados de Supabase Realtime autorizados por RLS:**
  - Un tema por canal de texto y uno por hilo.
  - Se emite con broadcast desde triggers.
  - Política sobre `realtime.messages` que exige `can_view(channel)`.
  - No se usa `postgres_changes` a pelo: evaluaría RLS por fila y por suscriptor y es fácil equivocarse.
  - Los tickets usan su propio tema, autorizado solo para autor + staff.
- **Las escrituras de mensajes van por RPC `SECURITY DEFINER`**, en una sola transacción: comprueban permisos, slowmode, contenido permitido (quitar o rechazar imágenes y enlaces sin permiso), menciones válidas y fan-out de notificaciones.
- **Web Push:**
  - Claves VAPID generadas por mí y guardadas en `.env.local` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
  - Tabla `push_subscriptions` por dispositivo.
  - Envío desde una ruta/servicio Node con la librería `web-push`, disparado tras crear la notificación.
  - Al enviar se vuelve a comprobar que el destinatario sigue pudiendo ver el canal.
  - La notificación push **nunca incluye el texto completo**: solo "Fulano te mencionó en #trading", con extracto corto si el canal es visible.
- **Imágenes:**
  - Supabase Storage, bucket privado con RLS ligada a ver el canal.
  - URLs firmadas de corta duración.
  - Máx. 5 MB; solo png/jpeg/webp/gif; sin SVG.
  - Limpiar EXIF en servidor si es viable; si no, documentarlo.
- **Bounty → F3.**
- **Orden de entrega:** F2a → F2b → F2c → F2d. Cada una es un plan propio con TDD y revisión.

## Restricciones

- Las de F1 y del Plan Maestro siguen vigentes:
  - RLS deny-by-default;
  - funciones `SECURITY DEFINER` con `search_path=''`, sin EXECUTE para anon;
  - la wallet sale solo de `auth.identities`;
  - tokens §1 y nada de "AI slop";
  - ≥44px, foco visible, `prefers-reduced-motion`, móvil a 375px sin scroll horizontal;
  - copy en español de tú;
  - consultar ui-ux-pro-max antes de cada UI.
- Paridad SQL/TS de permisos, verificada con los **mismos casos en JSON** (Plan Maestro §2).
- Cualquier camino de lectura (consulta, Realtime, búsqueda, notificación, push, no leídos, contadores de reacciones) debe tener un test que demuestre que no filtra contenido de canales no visibles.

## Lo que queda a criterio del constructor

- Esquema exacto de tablas e índices; virtualización de la lista de mensajes; paginación (cursor por `created_at, id`).
- Librería de arrastrar y soltar (accesible por teclado) y selector de emoji.
- Formato visual del placeholder de mensaje borrado:
  - Con hilo que tiene respuestas: "Mensaje eliminado", y el hilo se conserva.
  - Sin respuestas: el mensaje desaparece.
- Límites anti-abuso razonables:
  - longitud de mensaje 4000 caracteres en la caja compacta y 20000 en el modo expandido;
  - reacciones distintas por mensaje: 20;
  - reportes por miembro y hora.
