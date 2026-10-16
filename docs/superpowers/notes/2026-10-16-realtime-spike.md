# Spike Realtime privado (F2b Task 1)

Resultado: PASS. El broadcast privado con autorizacion por RLS funciona en el stack local (Supabase CLI ~2.121, supabase-js 2.118 / realtime-js 2.118.0).

## Emitir desde SQL

```sql
perform realtime.send(payload jsonb, event text, topic text, private boolean);
-- ej.: realtime.send(jsonb_build_object('id', id, 'channel_id', ch), 'message_created', 'channel:'||ch, true)
```

- `private = true` es obligatorio para que se aplique la autorizacion.
- Se llama desde una funcion `SECURITY DEFINER` (`set search_path = ''`). `realtime.broadcast_changes(...)` tambien existe, pero `send` basta para payloads solo con IDs.
- La funcion helper no debe ser ejecutable por anon/authenticated.

## Autorizar la recepcion

```sql
create policy ... on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^channel:[0-9a-f-]{36}$'
  and public.can_view(substring(realtime.topic() from 9)::uuid)
);
```

- El regex va antes del cast (el `and` se evalua en ese orden en la practica; un tema invalido no rompio la politica).
- Sin politica el join privado falla (visto en RED: la suscripcion no llega a SUBSCRIBED).
- `can_view` usa `auth.uid()` del JWT del socket, funciona dentro de la politica.

## Cliente (supabase-js)

```ts
await supabase.realtime.setAuth(session.access_token); // JWT del usuario
const ch = supabase.channel(`channel:${id}`, { config: { private: true } });
ch.on("broadcast", { event: "message_created" }, (m) => ...).subscribe((status, err) => ...);
```

- En Node/tests: `// @vitest-environment node` (con jsdom el WebSocket de undici rompe con `The "event" argument must be an instance of Event`).
- En el navegador, con `@supabase/ssr` hay que llamar a `setAuth` con el access token actual y al refrescar la sesion.

## Resultados observados

| Caso | Resultado |
|---|---|
| A (puede ver) se suscribe; service role llama `_spike_emit` | SUBSCRIBED; recibe en < 3 s con `{id, channel_id}` |
| B (VIEW denegado por overwrite de miembro) se suscribe al canal oculto | No llega a SUBSCRIBED (status `TIMEOUT` a los 5 s en el primer intento; no recibe nada en 3 s) |
| B se suscribe a un canal visible | SUBSCRIBED y recibe |
| A pierde VIEW (overwrite deny) con la suscripcion abierta | **Sigue recibiendo** en el mismo socket (la autorizacion se evalua al unirse al canal y se cachea) |
| A se resuscribe tras perder VIEW | `CHANNEL_ERROR: Unauthorized: You do not have permissions to read from this Channel topic: channel:<id>`; no recibe |

## Implicaciones para el plan

- El corte de acceso por cambio de permisos solo se aplica al **resuscribirse**. La proteccion real es que el payload solo lleva IDs y el contenido se relee por RLS (`visible_channels`), asi que una suscripcion vieja filtra como mucho el hecho de que hubo un mensaje y su ID.
- El cliente debe resuscribirse al volver a la pestana, al refrescar el token y al cambiar de canal; opcionalmente tras un cambio de permisos propio (Task 8).
- La denegacion en el primer intento puede aparecer como `TIMEOUT` y no como `CHANNEL_ERROR`; la UI no debe depender del texto del error.
- Task 5: absorber la politica y reemplazar `_spike_emit` por triggers (SECURITY DEFINER) que llamen `realtime.send`.
- No se probo si un refresco de token (`setAuth`) en el mismo socket reevalua la politica; verificar en Task 5/8 si se quiere cortar sin resuscribir.
