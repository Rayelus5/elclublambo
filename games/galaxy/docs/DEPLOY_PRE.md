# Galaxy Survivor · Puesta en PRE

Cómo dejar el juego en `https://pre.elclub.party/galaxy` sobre el homelab de PRE (contenedor CT 103, `root@192.168.1.103`, Supabase autoalojado en `/opt/supabase/docker`, proyecto compose `elclub-pre`). El pipeline `.github/workflows/preproduction.yml` hace el resto en cada push a `develop`: build → migrar → reiniciar → smoke.

## Antes del primer despliegue (una sola vez)

Hay que hacerlo **antes de fusionar** el PR que trae el juego: el compose exige `/opt/elclub/pre/galaxy.env` (sin él falla todo el despliegue, también el de la web) y el smoke del juego necesita que `galaxy_api` pueda entrar en Postgres.

### 1. El rol `galaxy_api` con contraseña

La migración `20261106150001_galaxy_foundation.sql` crea el rol sin contraseña y sin `login`, y lo respeta si ya existe. Por eso se puede crear ahora, antes de que llegue la migración:

```bash
ssh root@192.168.1.103
GALAXY_DB_PASS="$(openssl rand -hex 24)"
export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env | cut -d= -f2-)"
# Heredoc SIN comillas: bash expande $GALAXY_DB_PASS dentro de la entrada estándar de psql, nunca en sus argumentos.
docker exec -i -e PGPASSWORD supabase-db psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'galaxy_api') then create role galaxy_api nologin; end if;
end \$\$;
alter role galaxy_api login password '$GALAXY_DB_PASS';
SQL
printf 'Contraseña de galaxy_api (cópiala en el paso 2): %s\n' "$GALAXY_DB_PASS"   # printf es interno de bash: no sale en ps
unset PGPASSWORD GALAXY_DB_PASS
```

La contraseña solo viaja por variables de entorno (`-e PGPASSWORD` pasa el nombre, no el valor) y por la entrada estándar: nunca aparece en los argumentos de un proceso (`ps`) ni en el historial. Es hexadecimal, así que no necesita escaparse en SQL ni en la URL.

### 2. El archivo de entorno

```bash
git -C /opt/elclub/src pull --ff-only   # la copia del repo de la guía del homelab (§7.2), con la rama que trae el juego
install -m 600 -o gh-runner -g gh-runner /opt/elclub/src/deploy/preprod/galaxy.env.example /opt/elclub/pre/galaxy.env
nano /opt/elclub/pre/galaxy.env
```

| Clave | Valor en PRE |
|---|---|
| `DATABASE_URL` | `postgresql://galaxy_api:<contraseña del paso 1>@db:5432/postgres?sslmode=disable` |
| `GALAXY_PUBLIC_ORIGINS` | `https://pre.elclub.party` |
| `GALAXY_TOTP_KEY` | la salida de `openssl rand -base64 32` (guárdala también en tu gestor de contraseñas) |
| `NODE_ENV` | `production` |

### 3. Comprobar que la API de Supabase no ve el esquema

```bash
grep -E '^PGRST_DB_SCHEMAS=' /opt/supabase/docker/.env
```

`galaxy` **no** debe aparecer. El esquema es solo del contenedor del juego.

## Después de fusionar

1. El pipeline construye `elclub-galaxy:pre`, aplica las migraciones, levanta `galaxy` y comprueba `http://127.0.0.1:8080/galaxy/api/health` → `{"ok":true,"db":"up"}`.
2. Comprueba desde fuera:
   - `curl https://pre.elclub.party/galaxy/api/health` → `{"ok":true,"db":"up"}`;
   - `https://pre.elclub.party/galaxy/` muestra «Vuelve a tu estación» con la CSP propia del juego;
   - `https://pre.elclub.party/` sigue siendo ElClub como antes.
3. **Crea tu cuenta de superadmin en tu propia sesión SSH** (la contraseña y el secreto TOTP solo se imprimen en tu terminal, una vez):

   ```bash
   docker exec -it elclub-pre-galaxy-1 node dist/cli.js create-admin rayelus --role superadmin
   ```

   (`elclub-pre-galaxy-1` es el contenedor del servicio `galaxy` del proyecto compose `elclub-pre`; `docker ps` lo confirma.)

   Añade el secreto (o la URI `otpauth://`) a tu app de autenticación y entra en `/galaxy/entrar`: después de la contraseña te pedirá el código.
4. **Desde M2b (economía y escáner):** la migración `20261106201600_galaxy_economy_gacha` crea monedero, libro de movimientos, operaciones idempotentes, suerte del escáner y galaxias. Comprueba con una cuenta de prueba que la portada enseña el saldo con las 10 señales de bienvenida, que `/galaxy/escaner` escanea y revela, y que `/galaxy/coleccion` muestra las cartas. El interruptor `features.gacha` de la configuración viva apaga el escáner sin desplegar (503 `gacha_disabled`).
5. **Desde M3a (incursiones):** la migración `20261107020626_galaxy_runs` crea hangar, equipo de reliquias, partidas, entradas grabadas y tiempo diario de juego. Comprueba con una cuenta de prueba:
   - **Jugar** lleva a `/galaxy/incursion`, con el sector, la sonda Lumen, 2 ranuras y el premio del día.
   - Una galaxia se equipa y la incursión arranca: la arena dibuja y el HUD corre.
   - Al abandonar desde la pausa, los resultados cobran la mitad del botín y el saldo sube.
   - No hay violaciones de CSP en la consola: PixiJS llega en su propio fragmento con `pixi.js/unsafe-eval`.

   Las claves `content` (el catálogo de la incursión) y `runs` (la economía) de la configuración viva se ajustan sin desplegar, y `features.runs` apaga las incursiones (503 `runs_disabled`). Las partidas sospechosas quedan en `galaxy.runs` con `suspicious = true` y sus banderas. Hasta que el servidor reproduzca las partidas (M5), un final se recorta a lo que cabe en su tiempo real antes de pagar, una bandera de trampa cobra solo la parte de morir y ninguna partida cobra más de `runs.caps.runCoins` / `runs.caps.runDust` (20 000 / 10 000 de partida; las que llegan al techo quedan marcadas `payout_cap`).

6. **Desde M3b-1 (arsenal):** sin migraciones. El contenido de la incursión trae 16 armas, 20 pasivas, una evolución por arma, 11 reacciones entre elementos y 9 conjuntos de reliquias (`SIM_VERSION` 1.1.0). Comprueba con una cuenta de prueba:
   - el Hangar enseña el panel «Conjuntos» bajo las reliquias;
   - en la incursión salen armas y pasivas nuevas en las mejoras, y al subir un arma a su nivel máximo con su pasiva aparece su carta de evolución, dorada y primera;
   - con dos galaxias de elementos distintos equipadas, las reacciones escriben su nombre sobre los enemigos;
   - sin violaciones de CSP.

   Si alguien hubiera guardado la clave `content` en la configuración viva con el esquema de M3a, dejaría de validar (faltan los campos nuevos): hay que volver a publicarla desde el valor por defecto.

7. **Desde M3b-2 (sondas):** la migración `20261107063639_galaxy_probes` crea `galaxy.probe_tests`: un test por cuenta, que no se puede cambiar. Llegan además:
   - ocho sondas, cada una con su peculiaridad (`SIM_VERSION` 1.2.0);
   - la clave `probes` de la configuración viva, que se ajusta sin desplegar. Trae «3 incursiones» para las otras dos iniciales, la condición de cada una de las cinco restantes y `minRunSeconds` (60): las partidas más cortas no cuentan, para que abandonar al instante no desbloquee nada. Las tres iniciales del test no son un ajuste: las preguntas y los perfiles están escritos para ellas.

   Comprueba con una cuenta de prueba nueva:
   - al crear la cuenta se abre el test de la sonda: cinco preguntas, desempate si hace falta, confirmar y el revelado. «Saltar el test» también da una sonda tras confirmarlo;
   - el Hangar enseña la sonda del test elegida, y las otras siete bloqueadas con lo que las gana y su barra;
   - la incursión sale con la sonda elegida y su peculiaridad funciona (Lumen atrae los fragmentos cada minuto);
   - sin violaciones de CSP.

   Las cuentas de PRE de antes de M3b-2 no tienen test: al entrar en el Hangar van primero al test, y hasta hacerlo no pueden lanzar incursiones (409 `probe_test_required`). Sus partidas ya terminadas cuentan para los desbloqueos.

   Si alguien hubiera guardado la clave `content` en la configuración viva con el esquema de M3b-1, dejaría de validar porque falta `quirk` en las sondas. Hay que volver a publicarla desde el valor por defecto.

8. **Desde M3b-3 (sectores):** la migración `20261107102627_galaxy_sectors` añade `galaxy.hangars.sector`, el sector elegido (por defecto, `outer-nebula`). Llegan además:
   - cuatro sectores nuevos: Anillos de Escarcha, Arrecife Hueco, Forja Rota y la Fisura de la Señal (temporada 1). Traen 19 especies, 5 Núcleos y el Núcleo profundo cada 4 capas en los sectores normales (`SIM_VERSION` 1.3.0);
   - la clave `sectors` de la configuración viva, que se ajusta sin desplegar. Trae qué abre cada sector (por defecto, vencer al Núcleo del anterior una vez) y `season`, el sector de temporada abierto ahora (`signal-rift`; `null` lo cierra).

   Comprueba con una cuenta de prueba:
   - el Hangar enseña los 5 sectores: la Nebulosa elegida, la Escarcha, el Arrecife y la Forja cerrados con «Derrota a…», y la Fisura abierta con su insignia «Temporada»;
   - una incursión en la Fisura dibuja su bioma violeta, su fauna y sus avisos (marcas de salto, minas, líneas);
   - sin violaciones de CSP.

   Si se cierra la temporada (`season: null`), quien la tuviera elegida vuelve a la Nebulosa, y empezar en la Fisura da 409 `sector_locked`.

   Si alguien hubiera guardado la clave `content` con el esquema de M3b-2, sigue validando: los campos nuevos de los sectores tienen valor por defecto. Pero no traería los sectores nuevos; hay que volver a publicarla desde el valor por defecto.

9. **Desde M4a (la estación):** la migración `20261107134328_galaxy_station` crea `galaxy.station_rooms`, `galaxy.refinery` y `galaxy.antenna`, y deja apuntar `material` y `components` en el libro de movimientos. Llegan además:
   - el Hogar de la portada abre la estación: diez salas en dos cubiertas, pintadas en Aseprite (los fuentes editables están en `art/station`);
   - las incursiones pagan material en bruto: 6 por capa, 10 por Núcleo y 2 por cada 100 bajas, con un tope de 500 por partida (la clave `runs.material` y `caps.runMaterial` de la configuración viva);
   - la Refinería convierte material en componentes con el tiempo (nivel 1: 20 por hora y 100 en cola) y la Antena, rota al empezar, capta señales hasta llenarse en 8 h. Ambas se reparan y mejoran con componentes y monedas. Sus ritmos y costes son la clave `station` de la configuración viva, que se ajusta sin desplegar.

   Comprueba con una cuenta de prueba nueva:
   - el Hogar lleva a `/galaxy/estacion`. Funcionan el Escáner, el Planetario, el Hangar, el Colisionador y la Refinería; la Antena está rota y las otras cuatro dicen «En reparación»;
   - con `grant <usuario> material 60 --reason "probar la estación"`, la Refinería carga 60 y la barra «En cola» lo enseña;
   - con `grant <usuario> components 30 --reason "probar la estación"`, la Antena se repara y dice «Una señal cada 8 h»;
   - una incursión terminada enseña el material en los resultados;
   - sin violaciones de CSP.

   La Refinería y la Antena avanzan solas en el tiempo del servidor (se calculan al pedir la vista), así que no hay nada que programar.

10. **Desde M4b-1 (niveles de sonda y variantes):** la migración `20261107151557_galaxy_probe_levels` crea `galaxy.probe_levels`, con el nivel y el arma inicial elegida de cada sonda de cada cuenta, y `galaxy.runs.upgrades`, con la foto de bonos y variante con la que sale cada incursión. Llegan además:
   - cada sonda sube del nivel 1 al 10 en el Hangar con componentes y monedas (20 y 300 para el nivel 2, … 400 y 8000 para el 10). Cada nivel da +3 % de vida y +2 % de daño, con rendimiento decreciente y topes;
   - en los niveles 4 y 8 se abren dos variantes de su arma inicial (doble, amplia, en cadena, rápida o con elemento), con su escena pintada en Aseprite en el Hangar y su icono en la incursión (`SIM_VERSION` 1.4.0);
   - la clave `probes.levels` de la configuración viva (`perLevel` y `costs`), que se ajusta sin desplegar.

   Comprueba con una cuenta de prueba nueva:
   - el Hangar enseña «Nivel 1 de 10», «Subir a nivel 2» con su coste y los componentes en el saldo;
   - con `grant <usuario> components 115 --reason "probar niveles"` y `grant <usuario> coins 1900 --reason "probar niveles"` sube al 4, y «Arma inicial» deja elegir la variante del nivel 4 (la del 8 dice «Se abre en el nivel 8»);
   - la incursión sale con esa arma;
   - sin violaciones de CSP.

   Las cuentas de antes no tienen filas: salen en el nivel 1 con su arma base.

   Si alguien hubiera guardado la clave `content` con el esquema de M4a, sigue validando (`variant` es opcional), pero no traería las 16 variantes: los niveles 4 y 8 no abrirían nada y no saldría ningún aviso. Mira si `galaxy.game_config_active` tiene una versión de `content` y, si la tiene, vuelve a publicarla desde el valor por defecto.

11. **Desde M4b-2 (el laboratorio):** la migración `20261107165822_galaxy_lab` crea `galaxy.lab_nodes`, con el nivel de cada nodo comprado por cada cuenta. Llegan además:
   - el Laboratorio de la estación empieza roto y se repara con 50 componentes y 500 monedas (`station.lab`). Arreglado, abre `/galaxy/laboratorio`;
   - el árbol, que es la clave viva `lab` y se ajusta sin desplegar. Tiene cuatro ramas de cuatro nodos de hasta 5 niveles, pagados con polvo y componentes (de 40 de polvo y 15 componentes en adelante, ×1,6 por nivel):
     - **Sonda:** vida, velocidad, daño y recarga;
     - **Reliquias:** potencia elemental, suerte, polvo al desintegrar y fusión más barata;
     - **Estación:** ritmo y cola de la refinería, ritmo de la antena y material de las incursiones;
     - **Extracción:** recogida, monedas y polvo de las incursiones, y experiencia;
   - cada incursión guarda los bonos del laboratorio con los del nivel de la sonda y el empuje a lo cobrado, que se aplica antes de los topes.

   Comprueba con una cuenta de prueba nueva:
   - la estación enseña el Laboratorio roto. Con `grant <usuario> components 65`, `grant <usuario> coins 500` y `grant <usuario> dust 40` (cada uno con `--reason "probar el laboratorio"`), «Reparar» lo arregla y su sala lleva a `/galaxy/laboratorio`;
   - el laboratorio enseña las cuatro ramas con sus iconos. «Mejorar a nivel 1» en Blindaje reforzado lo compra y abre Propulsores;
   - una incursión sale con +2 % de vida;
   - sin violaciones de CSP.

   Si alguien hubiera guardado la clave `station` con el esquema de M4a, sigue validando (`lab` tiene valor por defecto). Pero si se guardó con `lab` ya dentro y luego se publica una versión de M4a, el Laboratorio se quedaría sin su reparación. Revisa `galaxy.game_config_active` para `station` y `lab`, y vuelve a publicarlas desde el valor por defecto si hiciera falta.

12. **Desde M4c-1 (niveles y ranuras de las reliquias):** la migración `20261107183527_galaxy_relic_levels` añade `galaxy.galaxies.level_dust`, el polvo invertido en los niveles de cada galaxia. Llegan además:
   - la clave viva `relics`, que se ajusta sin desplegar:
     - `levels`: lo que cuesta cada nivel, del 2 al 10 (20, 35, 55, 80, 110, 150, 200, 260 y 330 de polvo);
     - `refund`: la parte que devuelve al desintegrarla o fusionarla (0,5);
     - `slots`: lo que abre las ranuras 3 a 6 (5 incursiones y 100 de polvo, 3 Núcleos y 300, capa 4 y 600, 10 extracciones y 1000);
   - el detalle de cada galaxia enseña su nivel y «Subir a nivel N» con su coste, y el Hangar enseña la siguiente ranura con su hito y su barra;
   - desde la tercera reliquia de la misma familia, cada una rinde la mitad que la anterior (`SIM_VERSION` 1.5.0).

   Comprueba con una cuenta de prueba nueva:
   - con `grant <usuario> dust 55 --reason "probar las reliquias"`, una galaxia de su colección sube a nivel 3 desde su detalle, que dice «Al desintegrarla o fusionarla devuelve 27 de polvo de sus niveles». Al desintegrarla cobra ese polvo además del suyo;
   - el Hangar enseña «Ranura 3» con «Juega 5 incursiones» y su barra, sin botón;
   - sin violaciones de CSP.

   Abrir la ranura necesita cinco incursiones de un minuto o más: se prueba en integración y en el e2e.

13. **Desde M4c-2 (el planetario):** la migración `20261107222320_galaxy_planetarium` crea dos tablas:
   - `galaxy.exhibits`: la galaxia de cada pedestal de cada cuenta;
   - `galaxy.planetarium_visits`: una fila por visitante, dueño y día UTC, nunca la propia.

   Llegan además:
   - la clave viva `planetarium`, que se ajusta sin desplegar:
     - `slots`: los pedestales, 6 como mucho, los que tiene la cúpula;
     - `points`: el prestigio de cada rareza, de común a legendaria (1, 2, 4, 7 y 12), y 1 más si el acabado no es normal;
     - `xpPerPoint`: la experiencia por punto (0,001);
     - `cap`: el tope del bonus, 0,05 como mucho;
     - `featured`: cuántos destacados se ven (8);
   - la sala Planetario de la estación lleva ahora a `/galaxy/planetario`, y una visita a `/galaxy/planetario/<nombre>`;
   - una galaxia expuesta no se desintegra ni se fusiona (`409 galaxy_exhibited`);
   - cada incursión guarda el bonus de experiencia de lo expuesto al empezar.

   Comprueba con dos cuentas de prueba nuevas:
   - la primera escanea con su señal de bienvenida y expone dos galaxias desde los pedestales. Ve su prestigio y «+N % de experiencia en las incursiones». En su colección las dos llevan «Expuesta» y su Desintegrar está desactivado;
   - la segunda la visita por su nombre desde «Visitar un planetario». Ve las dos cartas, sin botones, y «1 visita». Al volver a entrar sigue en 1;
   - un nombre que no existe dice «No hay ningún planetario con ese nombre»;
   - sin violaciones de CSP.

14. **Desde M5a (perfiles, nivel de cuenta y clasificación):** las migraciones `20261107233125_galaxy_progress` y `20261108001508_galaxy_progress_min_run` crean:
   - `galaxy.account_xp`, la experiencia de cada cuenta, rellenada con las incursiones ya terminadas y no sospechosas con la fórmula por defecto: 10 por minuto entero, 15 por capa, 40 por Núcleo y 30 por extraer. Una incursión cuenta desde un minuto, y nunca da más de 30 por minuto jugado;
   - la función `galaxy.run_xp`, con esa fórmula;
   - el índice `runs_season`.

   Llegan además:
   - la clave viva `account`: la experiencia por incursión (`xp`, con su tope por minuto `capPerMinute`), el mínimo para contar (`minRunSeconds`, 60) y los umbrales de nivel del 2 al 30 (`levels`);
   - la clave viva `season`:
     - `id`, `name`, `startsAt` y `endsAt`; la temporada 1 va del 1 de noviembre al 13 de diciembre de 2026;
     - `points`: 10 por capa, 50 por Núcleo y 25 por extraer;
     - `tiers`: los tramos Bronce, Plata, Oro, Platino y Estelar, desde 500, 2000, 6000, 15 000 y 30 000;
     - `top`: las filas de la clasificación, 100;
     - `capPerMinute`: los puntos que una incursión puede dar como mucho por minuto jugado, 20. Empezar y morir, o una incursión corta inventada, no puntúan más que una de verdad;

     Cambiar los puntos o las fechas recalcula la clasificación sin migrar nada, porque se lee de las incursiones;
   - el inicio enseña la temporada en la columna derecha, el mosaico «Ranking» lleva a `/galaxy/clasificacion` y el avatar a tu perfil con tu nivel;
   - `/galaxy/perfil/<nombre>` y `/galaxy/perfil/<nombre>/coleccion` son públicos para cualquiera con sesión;
   - cada incursión no sospechosa da experiencia y puntos, y los resultados lo dicen.

   Comprueba con dos cuentas de prueba nuevas:
   - el inicio enseña la temporada con los días que quedan y «Ver clasificación completa». El avatar dice «Nivel 1» y lleva al perfil;
   - una incursión de un minuto (morir en la capa 1) da «+25 de experiencia» y «+10 puntos de temporada». Después, la cuenta sale en la clasificación con su fila marcada. Una de menos de un minuto no da nada;
   - la segunda cuenta abre `/galaxy/perfil/<nombre>` de la primera y ve su nivel, su temporada, «Ver su colección» y «Visitar su planetario»;
   - sin violaciones de CSP.

   Si PRE ya tiene cuentas con incursiones, el relleno les da su nivel al desplegar. Compara `select count(*) from galaxy.account_xp` con las cuentas que tienen incursiones terminadas y no sospechosas.

15. **Desde M5b-1 (los clanes):** la migración `20261108004913_galaxy_clans` crea tres tablas:
   - `galaxy.clans`: el nombre es único sin distinguir mayúsculas y la etiqueta, única y en mayúsculas;
   - `galaxy.clan_members`: una cuenta está en un clan como mucho, y un clan tiene un solo líder;
   - `galaxy.clan_requests`.

   Llegan además:
   - la clave viva `clans`: `maxMembers` (30), `createCost.coins` (2000) y `minLevel` para crear (5);
   - el mosaico «Clan» del inicio lleva a `/galaxy/clanes`, y cada clan tiene su página en `/galaxy/clanes/<etiqueta>`;
   - la clasificación estrena la pestaña Clanes: los puntos de temporada de sus miembros actuales;
   - el perfil enseña el clan.

   Comprueba con dos cuentas de prueba nuevas:
   - la primera, con nivel 5 o más y 2000 monedas (`grant <usuario> coins 2000 --reason "probar los clanes"`; el nivel se gana jugando o, en una cuenta de prueba, con experiencia en `galaxy.account_xp`), crea un clan cerrado desde «Crear clan». El coste se descuenta y la página del clan la tiene de líder;
   - la segunda pide entrar («Solicitud enviada»). La primera la acepta desde «Solicitudes» y la asciende a oficial;
   - la segunda sale confirmándolo;
   - la pestaña Clanes de la clasificación lista los clanes con puntos;
   - sin violaciones de CSP.

16. **Desde M5b-2 (los chats):** la migración `20261108015244_galaxy_chat` crea tres tablas:
   - `galaxy.chat_messages`, con el canal `global` o `clan:<id>`. Los mensajes se ocultan, nunca se borran: `hidden_reason` dice si fue un moderador o las denuncias;
   - `galaxy.chat_reports`, una denuncia por cuenta y mensaje;
   - `galaxy.chat_mutes`, un silencio por cuenta, con su fin, su motivo y quién lo puso.

   Llegan además:
   - la clave viva `chat`:
     - `minLevel`, el nivel para escribir (5);
     - `perMinute`, los mensajes por minuto (6);
     - `maxLength`, los caracteres por mensaje (280);
     - `history`, los mensajes que trae cada canal (50);
     - `hideAfter`, las denuncias de cuentas distintas que ocultan un mensaje (3);
     - `words`, el filtro, que tapa esas palabras enteras con asteriscos sin distinguir tildes ni mayúsculas. Empieza vacío y admite 500 palabras;
   - el botón «Comunidad» de la barra de arriba abre el chat, y «Chat del clan» en la página de tu clan lo abre en su canal;
   - el socket `wss://pre.elclub.party/galaxy/api/chat/ws` solo empuja los mensajes. Se escribe y se lee por HTTP, y el socket se cierra sin sesión (4401) o desde otro origen (4403);
   - los moderadores (rol `moderator`, `admin` o `superadmin`, entrando con TOTP) ven «Ocultar» y «Silenciar 1 hora» en cada mensaje.

   **El WebSocket por el túnel:** `cloudflared` reenvía la cabecera `Upgrade` a `galaxy:8080` sin configurar nada, y la CSP `connect-src 'self'` ya cubre el `wss:` del mismo origen. Si el chat se queda en «Reconectando», mira en el panel de Cloudflare (Network) que WebSockets esté activado para `elclub.party`.

   Comprueba con dos cuentas de prueba nuevas, de nivel 5 (experiencia en `galaxy.account_xp`):
   - las dos abren «Comunidad»; la primera escribe y la segunda lo ve llegar sin recargar (eso prueba el socket a través del túnel);
   - la segunda denuncia el mensaje y queda «Denunciado»;
   - una tercera cuenta, de nivel 1, ve el campo desactivado con «Necesitas nivel 5 para escribir»;
   - sin violaciones de CSP, tampoco del socket.

## Operación

| Tarea | Cómo |
|---|---|
| Código de recuperación para un jugador | `docker exec elclub-pre-galaxy-1 node dist/cli.js issue-reset-code <usuario>` (24 h, un uso; queda auditado). El panel de admin lo hará en M6 |
| Dar o quitar moneda a un jugador | `docker exec elclub-pre-galaxy-1 node dist/cli.js grant <usuario> <coins\|dust\|signal\|material\|components> <cantidad> --reason "<motivo>"` (una cantidad negativa la quita, nunca por debajo de 0). Queda en el libro de movimientos y auditado como `wallet.grant` |
| Logs | `docker compose … logs -f galaxy` (JSON de pino; nunca llevan contraseñas, cookies ni tokens) |
| Reiniciar | `docker compose … up -d --no-build galaxy` |
| Un admin ha perdido su app de autenticación | `docker exec -it elclub-pre-galaxy-1 node dist/cli.js reset-totp <usuario>`: secreto nuevo, sesiones cerradas, queda auditado |
| Rotar `GALAXY_TOTP_KEY` | Invalida todos los TOTP: solo si la clave se ha filtrado; después, `reset-totp` para cada admin |
| Rotar la contraseña de `galaxy_api` | Paso 1 con otra contraseña, actualizar `galaxy.env` y `up -d galaxy` |
