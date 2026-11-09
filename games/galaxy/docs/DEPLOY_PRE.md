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

17. **Desde M5c-1 (el mercado):** la migración `20261108025826_galaxy_market` crea:
   - `galaxy.market_listings`: una galaxia en venta, en depósito mientras está activa, y una sola venta activa por galaxia. Los anuncios no se borran: quedan vendidos, retirados o caducados;
   - el trigger `market_min_price`: ningún precio baja del mínimo de su rareza. Lo lee de la clave viva `market` o, si no se ha publicado, de los valores del GDD;
   - `galaxy.trade_alerts`: los avisos para el admin, que enseñará el panel de M6.
   - y la migración `20261108033607_galaxy_account_ips` crea `galaxy.account_ips`: las IPs desde las que entra cada cuenta, que no se borran al salir. Se rellena con las sesiones vivas, y los avisos de IP compartida la leen.

   Llegan además:
   - la clave viva `market`:
     - `minPrice`, el mínimo por rareza: Común 50, Poco común 120, Rara 400, Épica 1500 y Legendaria 6000;
     - `maxPrice`, el precio máximo (10 000 000);
     - `commission`, la comisión (0,07): se queda en el mercado, como sumidero, y es al menos 1 moneda;
     - `days`, los días que dura un anuncio (7);
     - `perDay`, los anuncios y compras por día de Madrid (10 y 10);
     - `minLevel` (10) y `minAccountDays` (3), lo que hace falta para comerciar;
     - `alertMultiple` (20) y `sharedIpDays` (30), cuándo avisar: un precio de 20 veces el mínimo o más, o una IP que comprador y vendedor compartieron en los últimos 30 días. La venta sigue igualmente;
   - el botón «Mercado» de la barra de arriba lleva a `/galaxy/mercado`, con las pestañas Comprar, Vender y Mis anuncios;
   - «Vender» en el detalle de una galaxia lleva a venderla;
   - una galaxia en venta no se equipa, expone, fusiona, desintegra ni mejora.

   Comprueba con dos cuentas de prueba nuevas:
   - **Sin requisitos:** una cuenta nueva (nivel 1) abre «Mercado» y ve el aviso «Necesitas nivel 10 y 3 días de cuenta para comerciar»; los botones de comprar están desactivados.
   - **Con requisitos:** para vender y comprar hacen falta cuentas de nivel 10 y 3 días. El nivel se gana jugando o, en una cuenta de prueba, con experiencia en `galaxy.account_xp`; los días, con `created_at` en `galaxy.accounts`. Monedas: `grant <usuario> coins 2000 --reason "probar el mercado"`.
     - La primera vende una galaxia desde el detalle de su colección.
     - La segunda la compra desde Comprar.
     - La primera ve la venta en Mis anuncios, con lo cobrado.
   - **Sin violaciones de CSP.**

18. **Desde M5c-2 (el trueque):** la migración `20261108035643_galaxy_trades` crea `galaxy.trades`, los trueques de galaxia por galaxia entre dos cuentas:
   - lo que ofrece cada parte queda en depósito: una galaxia ofrecida no se equipa, expone, vende, fusiona, desintegra ni mejora;
   - lo que solo se pide no queda bloqueado;
   - cada cambio crea una versión nueva, y el intercambio ocurre cuando las dos partes confirman la misma.

   Además añade `trade_id` a `galaxy.trade_alerts`.

   La migración `20261108042617_galaxy_trades_pair` permite un solo trueque abierto por pareja de cuentas. Si ya hubiera parejas con varios abiertos, se queda el más reciente y los demás se cancelan.

   Llegan además:
   - en la clave viva `market`:
     - `perDay.trades`: los trueques propuestos al día (10);
     - `tradeDays`: los días que sigue abierto un trueque (3);
     - `openTrades`: los abiertos por cuenta (5), contados aparte los propuestos y los recibidos;
     - `tradeAlertTierGap`: la diferencia de rareza que avisa al admin (3; por ejemplo, Común por Legendaria);
   - «Proponer trueque» en el perfil de otro jugador, y la pestaña «Trueques» del mercado (`/galaxy/mercado?pestana=trueques`);
   - para el trueque hacen falta los mismos requisitos que para el mercado: nivel 10 y 3 días de cuenta.

   Comprueba:
   - una cuenta nueva (nivel 1) ve la pestaña Trueques con el aviso de los requisitos;
   - con dos cuentas de nivel 10 y 3 días (ver el paso 17), la primera propone desde el perfil de la segunda;
   - la segunda ve «… ha confirmado. Te toca» y confirma;
   - las dos ven «Recibiste …» en los cerrados, y cada galaxia aparece en la colección de su nueva dueña;
   - sin violaciones de CSP.

19. **Desde M6a (el panel de admin: jugadores y auditoría):** la migración `20261108045518_galaxy_leaderboard_excluded` añade `galaxy.accounts.leaderboard_excluded`. La clasificación, también la pestaña Clanes, deja fuera esas cuentas.

   Llegan además:
   - el panel `/galaxy/admin`, solo para admins y superadmins que entraron con TOTP; se abre con el escudo de la barra de arriba;
   - **Jugadores:**
     - buscar por nombre, IP o etiqueta de clan;
     - la ficha con estado, monedas, acciones y el historial (galaxias, movimientos, tiradas, partidas, comercio, chat, sesiones e IPs);
   - **Acciones** (cada una pide un motivo y queda en `galaxy.admin_audit_log`):
     - dar o quitar moneda (como asientos compensatorios);
     - conceder o retirar galaxias;
     - experiencia y nombre;
     - código de recuperación, que se enseña una vez;
     - cerrar sesiones;
     - banear o levantar el baneo: banear cierra las sesiones y cancela sus anuncios y trueques;
     - sacar o volver a meter en la clasificación;
   - **Lo destructivo** (quitar moneda, retirar galaxia, experiencia, nombre, código y baneo) pide además la contraseña del admin. Diez contraseñas equivocadas en diez minutos lo bloquean un rato;
   - **Auditoría:** filtros, el antes y el después de cada cambio, y exportar a CSV.

   Comprueba, cuando exista tu cuenta `rayelus` (la creas tú por SSH, como dice «Operación»):
   - entras con tu código TOTP y el escudo lleva a `/galaxy/admin/jugadores`;
   - buscas una cuenta de prueba `e2e_pre_…`, le das 100 monedas con un motivo y ves «Hecho. Queda en la auditoría»;
   - en Auditoría aparece `player.wallet` con tu nombre;
   - una cuenta sin rol que abra `/galaxy/admin` vuelve al inicio;
   - sin violaciones de CSP.

20. **Desde M6b (configuración viva):** sin migraciones. La clave `features` gana tres interruptores, `market`, `trades` y `chat`, encendidos por defecto: sin publicar nada, todo sigue igual.

   Llegan además:
   - **`/galaxy/admin/configuracion`:**
     - los interruptores (Registro, Mantenimiento, Gachapón, Incursiones, Mercado, Trueque y Chat), cada uno con su estado en palabras;
     - cada clave con su versión y quién la cambió por última vez;
   - **Apagar el mercado, el trueque o el chat** cierra lo nuevo al momento (como mucho, en los 10 s de la caché de configuración):
     - anunciar y comprar, proponer y confirmar trueques, y escribir en el chat responden 503;
     - cancelar anuncios y trueques, leer y reportar siguen abiertos;
   - **El editor de cada clave:**
     - un borrador en JSON con sus problemas por ruta, en español;
     - lo que cambia respecto a lo publicado;
     - el historial, con «Cargar la versión N en el editor»;
   - **Publicar** pide motivo y la contraseña del admin (la misma regla de bloqueo que M6a) y cada versión queda en la auditoría como `config.published`;
   - **en `gacha`, el simulador:** tira el borrador en el navegador sin publicarlo, 1000, 10.000 o 100.000 veces, y lo compara con lo esperado.

   Comprueba, cuando exista tu cuenta `rayelus`:
   - Configuración lista las claves y los siete interruptores encendidos, salvo Mantenimiento;
   - apagas Mercado con un motivo y tu contraseña, y una cuenta `e2e_pre_…` que intente anunciar ve que el mercado está cerrado; lo vuelves a encender;
   - en `chat`, un `maxLength` de 5 enseña el problema en `maxLength` y no deja publicar;
   - en `gacha`, «Tirar 100.000 veces» da una legendaria cada unas 10 tiradas;
   - sin violaciones de CSP.

21. **Desde M6c-1 (moderación de chats y clanes):** una migración, `*_galaxy_chat_report_reviews`. Guarda la última revisión de cada mensaje denunciado: solo las denuncias posteriores a ella vuelven a la cola y cuentan para ocultarlo.

   Llegan además:
   - **El rol moderador entra al panel** (con su TOTP), pero solo a **Moderación**. Jugadores, Auditoría, Configuración y Clanes siguen siendo de admins;
   - **`/galaxy/admin/moderacion`:**
     - **Denuncias:** la cola, con lo denunciado más recientemente primero y de 50 en 50, cuántos mensajes esperan, y en cada uno el mensaje, quién y dónde, cuántas denuncias y lo que dijeron. Se resuelve ocultando o dejándolo visible (si las denuncias lo habían ocultado, vuelve);
     - **Chat en vivo:** el global y el de cada clan con mensajes en los últimos 30 días, ocultos incluidos, actualizado cada 5 s y con pausa. Cada mensaje se oculta o se restaura;
     - **Silencios:** los que siguen en curso, silenciar por nombre con su duración y levantarlos;
     - **Clanes** (solo admins): buscar, ver sus miembros, renombrar (nombre y etiqueta), borrar la descripción, expulsar, hacer líder y disolver, esto último con la contraseña del admin;
   - **Todo pide motivo y queda en la auditoría:** `chat.hide`, `chat.restore`, `chat.review`, `chat.mute`, `chat.unmute`, `clan.edit`, `clan.kick`, `clan.leader` y `clan.dissolve`. Ocultar y silenciar desde el propio chat del juego también se auditan;
   - **Nadie silencia ni expulsa a quien no puede tocar:** ni a un superadmin, ni a otro miembro del equipo si no es superadmin. Además, nadie se silencia a sí mismo (expulsarse de un clan desde el panel sí se puede).

   Comprueba, cuando exista tu cuenta `rayelus`:
   - crea un moderador por SSH, `docker exec -it elclub-pre-galaxy-1 node dist/cli.js create-admin <nombre> --role moderator`, y entra con su TOTP: el escudo lleva a Moderación y no ve Jugadores;
   - una cuenta `e2e_pre_…` de nivel 5 escribe en Comunidad y otra la denuncia: el mensaje aparece en Denuncias y «Dejar visible» lo saca de la cola;
   - en Chat en vivo, ocultas un mensaje y la otra cuenta deja de verlo; lo restauras;
   - silencias a la cuenta 10 minutos, no puede escribir, y levantas el silencio;
   - con `rayelus`, en Clanes, buscas un clan de prueba y lo renombras; aparece `clan.edit` en Auditoría;
   - sin violaciones de CSP.

22. **Desde M6c-2 (moderación del comercio):** una migración, `*_galaxy_market_moderation`:
   - `deal_reversals`: una reversión como mucho por venta o por trueque. La venta sigue «vendida» y el trueque «cerrado», porque la historia no se reescribe;
   - `trade_alerts` gana la revisión de cada alerta: cuándo, quién y por qué.

   Llegan además, solo para admins, dos apartados de Moderación:
   - **Comercio:**
     - el historial de anuncios o de trueques, filtrado por cuenta y estado (los filtros van en la dirección);
     - **«Retirar»** un anuncio activo y **«Anular»** un trueque abierto, con motivo;
     - **«Revertir»** una venta o un trueque cerrado. Antes enseña a dónde vuelve cada galaxia, o por qué no puede: la revendieron o la cambiaron, se fusionó o ya no existe. En ese caso el botón queda apagado y la corrección se hace a mano desde la ficha de cada jugador. Revertir pide la contraseña;
     - **revertir una venta** devuelve la galaxia (soltándola de donde la tuviera el comprador), todo el precio al comprador y lo cobrado por el vendedor hasta donde le lleguen las monedas. Lo que falte queda apuntado; ningún saldo baja de 0;
   - **Alertas:** las de comercio sospechoso (IP compartida, venta o trueque desequilibrados), pendientes y revisadas. Cada una enlaza a su trato en Comercio y se marca revisada con un motivo;
   - **todo queda en la auditoría:** `market.cancel`, `trade.cancel`, `market.revert`, `trade.revert` y `alert.review`; los movimientos de monedas, con el motivo `market_revert`.

   Comprueba con `rayelus`:
   - dos cuentas `e2e_pre_…` con nivel de comercio hacen un trueque; en Comercio, «Revertir» dice a dónde vuelve cada galaxia y, con tu contraseña, el trueque sale como «Revertido» y cada galaxia vuelve a su dueño;
   - una de ellas anuncia una galaxia y tú la retiras desde Comercio;
   - en Alertas, si aparece alguna, la marcas revisada con un motivo;
   - sin violaciones de CSP.

23. **Desde M6d-1 (comunicación):** una migración, `*_galaxy_mailbox`:
   - `mailbox_messages`: título, texto, regalos, audiencia y caducidad. Se retiran, nunca se editan ni se borran;
   - `mailbox_receipts`: leído y recogido, uno por mensaje y cuenta;
   - `title_notices`: los avisos de la pantalla de título, con su tono y sus fechas.

   Llegan además:
   - **El buzón** de la barra de arriba deja de estar «En desarrollo»:
     - su nombre dice cuántos hay sin leer y una insignia Solar los cuenta;
     - abre una bandeja con los mensajes y la carta abierta;
     - un regalo se recoge una vez y suma al monedero (asientos `mail_gift`);
   - **Los avisos** en curso salen sobre el logo de la pantalla de título, como mucho 3, y cada jugador los cierra en su navegador;
   - **`/galaxy/admin/comunicacion`** (solo admins):
     - enviar un mensaje a todas las cuentas, a una lista de nombres o a un segmento por nivel y fecha de alta, viendo a cuántas cuentas llega antes de enviarlo;
     - **los regalos** (monedas, polvo y señales) piden tu contraseña;
     - un mensaje solo llega a las cuentas que ya existían al enviarse;
     - la lista de enviados dice a cuántas llega, cuántas lo leyeron y cuántas recogieron, y se retira con motivo;
     - los avisos se publican con sus fechas y se terminan antes con motivo;
     - todo queda en la auditoría: `mail.send`, `mail.withdraw`, `notice.create` y `notice.end`.

   Comprueba con `rayelus`:
   - envías a una cuenta `e2e_pre_…` (por su nombre) un mensaje con 100 monedas; en esa cuenta el buzón dice «1 sin leer», la carta se abre y «Recoger» suma las 100 monedas;
   - publicas un aviso de prueba de una hora, lo ves en la pantalla de título de esa cuenta y lo terminas;
   - sin violaciones de CSP.

24. **Desde M6d-2 (estadísticas):** una migración, `*_galaxy_stats_indexes`, con índices por fecha para que las estadísticas no recorran las tablas enteras. Llega **`/galaxy/admin/estadisticas`** (solo admins). Solo lee, así que no deja nada en la auditoría. Las cifras son las de las últimas 24 horas (por horas) o de 7 o 30 días (por días UTC), y se leen otra vez cada 30 segundos:
   - **arriba:** conectados ahora (cuentas con una sesión vista en los últimos 10 minutos; debajo, las conexiones abiertas al chat), cuentas nuevas y activas, partidas, tiradas, monedas en ventas y lo pendiente de revisar (alertas y denuncias);
   - **partidas:** en barras por tramo, cada una con su número, y cómo terminaron (las que no terminaron, «en curso» mientras aún pueden acabar y «sin terminar» después);
   - **monedas:** lo que entra y sale de cada moneda, con su desglose por motivo del libro de movimientos;
   - **rarezas:** las de las tiradas, reales frente a las esperadas por la configuración del gachapón (la suerte de bienvenida de las cuentas nuevas sube las legendarias por encima de lo esperado, y la tabla lo dice);
   - **mercado y trueques:** anuncios, ventas, monedas movidas, comisión y trueques;
   - **«Exportar CSV»** en cada sección, con el periodo elegido.

   Comprueba con `rayelus`:
   - Estadísticas dice «Conectados ahora» 1 o más (tu propia sesión);
   - las partidas tienen 24 barras y, con «Últimos 7 días», 7;
   - «Exportar CSV» descarga `estadisticas-runs-7d-<fecha>.csv`;
   - sin violaciones de CSP.

25. **Desde M6d-3 (reproductor de partidas):** dos migraciones. `*_galaxy_run_marks` deja que una partida terminada cambie solo `suspicious` y `flags`; el resto sigue sin poder reescribirse. `*_galaxy_run_claims` guarda, al terminar, lo que envió la partida (ticks, capa, bajas, jefes y nivel) junto a lo que se quedó el servidor tras recortarlo al tiempo real. Llega **`/galaxy/admin/partidas`** (solo admins):
   - **la lista:** todas las partidas, de la más nueva a la más vieja, por jugador (nombre exacto) y «Solo sospechosas». Cada una se abre con «Ver», también desde la pestaña «Partidas» de la ficha del jugador;
   - **la repetición:** la arena de la partida con su semilla, su contenido y sus entradas grabadas. Se reproduce de 1x a 8x y se mueve por la línea de tiempo. Espacio reproduce o pausa y las flechas mueven 5 segundos. Nunca empieza sola ni suena;
   - **«Comprobar»:** repite la partida aparte hasta el último tick que envió y compara con lo que envió al terminarla: huella del estado, ticks, bajas, capa y nivel. Una partida que no coincide se jugó con trampas o con otra versión de la simulación. La página avisa si la versión de la simulación es otra, si la versión del contenido ya no está y si es una partida de antes de M6d-3 que el servidor recortó (de esas no se guardó lo original y pueden no coincidir aunque se jugaran limpias);
   - **«Marcar como sospechosa»** o **«Quitar la marca»**, con motivo y en la auditoría (`run.mark`, `run.unmark`):
     - una partida marcada deja de contar para la temporada, los desbloqueos de sectores y sondas, y el perfil;
     - la experiencia y la paga que ya dio no cambian. Para corregirlas están la cartera y la experiencia de la ficha del jugador.

   Comprueba con `rayelus` y una cuenta de prueba que juegue unos segundos y abandone:
   - en Partidas, filtrando por esa cuenta, sale su partida «Abandonada»;
   - «Ver» la reproduce, y «Comprobar» dice «Coincide con lo guardado»;
   - marcarla con un motivo la deja «Sospechosa», y sale en la auditoría;
   - sin violaciones de CSP.

26. **Desde M6d-4 (ficha completa):** dos migraciones. `*_galaxy_admin_progress` crea dos tablas:
   - `probe_grants`: las sondas que un admin desbloquea a una cuenta;
   - `season_adjustments`: los puntos de temporada que un admin suma o quita, en filas que nunca se borran ni se editan.

   `*_galaxy_lab_nodes_delete` deja borrar un nodo del laboratorio que un admin devuelve a 0.

   La ficha del jugador estrena la pestaña **«Progreso»**. Cada cambio pide motivo y queda en la auditoría:
   - **suerte del gachapón**, por grupo: tiradas desde la última legendaria y desde la última destacada, y la suerte de bienvenida. Nunca pide contraseña;
   - **sondas:** su nivel y su arma inicial (solo las variantes que ese nivel abre), y «Desbloquear» o «Bloquear». Una sonda bloqueada que estaba elegida devuelve el hangar a la sonda del test;
   - **máquinas de la estación** (laboratorio, refinería y antena): su nivel. Antes se guarda lo que la refinería llevaba refinado a su ritmo de antes;
   - **laboratorio:** el nivel de cada nodo, y a 0 desaparece;
   - **temporada:** puntos que se suman en la clasificación General de la temporada abierta y solo en esa;
   - **«Conceder galaxia»** deja elegir también el tipo.

   **Pide tu contraseña** lo que quita algo: bajar un nivel, bloquear una sonda o quitar puntos.

   Comprueba con `rayelus` y una cuenta de prueba:
   - en su «Progreso», «Desbloquear» una sonda que no tenga: sale «Desbloqueada por un admin» y la cuenta la puede elegir en el hangar;
   - «Ajustar puntos de temporada» con 100: la cuenta sale en la clasificación General con esos puntos;
   - bajar un nivel pide tu contraseña;
   - sin violaciones de CSP.

27. **Desde M6d-5 (economía viva):** sin migraciones. Además llegan dos peticiones del dueño sobre la vista 3D.

   **Multiplicadores globales temporales.** La configuración tiene una clave nueva, **`boosts`**, que se edita en Configuración como las demás. Cada multiplicador lleva:
   - `id` y `name`;
   - `currency`: `coins`, `dust`, `material` o `signal`;
   - `factor`, de 1 a 5;
   - `startsAt` y `endsAt`, con una ventana de 14 días como mucho.

   Una partida que termina dentro de la ventana cobra multiplicado: monedas, polvo y material antes de los topes por partida, y la probabilidad de señal por Núcleo. El resultado de la partida dice qué multiplicador pagó. Varios sobre la misma moneda se multiplican, hasta 5. Los jugadores ven los que están en marcha en la pantalla de título y en el hangar.

   Ejemplo, «doble polvo el fin de semana»:
   ```json
   { "list": [{ "id": "polvo-finde", "name": "Doble polvo", "currency": "dust", "factor": 2, "startsAt": "2026-11-14T00:00:00.000Z", "endsAt": "2026-11-16T00:00:00.000Z" }] }
   ```

   **Simulador de la economía.** En Configuración, bajo `runs` y `boosts`, juega tres partidas con el bot en el sector y la duración elegidos. Después compara lo publicado con el borrador, por partida y en un día de juego. Es una estimación y no publica nada.

   **Inspector 3D.**
   - Si el equipo no puede generar la vista 3D pro, sale la vista 3D clásica (la de antes de M6d-1) con un aviso y el motivo. Sin WebGL2, la carta plana, también con el motivo.
   - Las cartas del planetario de otro jugador se abren en 3D al hacer clic en ellas.

   Comprueba con `rayelus`:
   - en `boosts`, un multiplicador de polvo que empiece ahora: sale en la pantalla de título;
   - el simulador de `runs` da su tabla;
   - una carta de un planetario visitado se abre en 3D;
   - sin violaciones de CSP.

28. **Desde M7a (misiones y logros):** una migración, `*_galaxy_missions`. Crea:
   - `mission_progress`, `achievement_progress` y `cosmetics`;
   - las columnas `accounts.title` y `accounts.frame`;
   - `season_adjustments.source`.

   Dos claves nuevas de configuración se editan en Configuración y ya traen sus valores por defecto:
   - **`missions`:** 3 diarias de un fondo de 7, 3 semanales de un fondo de 6, y 4 de temporada. Las del día y las de la semana son las mismas para todos.
   - **`achievements`:** 10 logros que dan señales, títulos, marcos y puntos de temporada.

   Cuentan las partidas que no son sospechosas (incursiones, minutos, bajas, Núcleos, extracciones y capa), las tiradas y las legendarias, las fusiones, las desintegraciones y los componentes recogidos.

   El jugador lo ve así:
   - un botón con trofeo en la barra de arriba, con el número de recompensas por recoger;
   - **`/galaxy/misiones`**, con las pestañas Diarias, Semanales, Temporada y Logros;
   - «Recoger» paga en el libro de movimientos y suma sus puntos a la clasificación General;
   - en Logros elige su título y su marco, que se ven en su perfil.

   Comprueba con una cuenta de prueba:
   - juega una incursión;
   - el logro «Primer despegue» se recoge y da el título «Cadete»;
   - con ese título elegido, sale en el perfil;
   - sin violaciones de CSP.

29. **Desde M7b (Catálogo ECN):** una migración, `*_galaxy_catalog` (`catalog_claims`), y una clave nueva de configuración, **`catalog`**, con los premios por porcentaje.
   - **El álbum:** 32 entradas (8 tipos, 11 paletas, 8 fenómenos y 5 acabados). Se descubre con las galaxias que tienes y con las que sacaste en el escáner, aunque ya no las tengas.
   - **Los premios por defecto:**
     - al 10 %, 300 de polvo;
     - al 25 %, 2 señales;
     - al 50 %, 5 señales y el título «Cartógrafo»;
     - al 75 %, 1.500 de polvo y el título «Archivista»;
     - al 100 %, 10 señales, el título «Guardián del cielo» y el marco Oro.
     
     Cada premio se recoge una vez.
   - **Dónde:** `/galaxy/catalogo`, desde «Catálogo ECN» en la colección.

   Comprueba con una cuenta de prueba que haga sus 10 tiradas de bienvenida:
   - el catálogo marca lo descubierto;
   - el premio del 10 % se recoge si llega al 10 %;
   - sin violaciones de CSP.

30. **Desde M7b-2 (Códice):** sin migraciones. La sala **Archivo** de la estación deja de estar «en reparación» y abre **`/galaxy/codice`**. El Códice son los registros del ECN, con el lore aprobado como provisional (`docs/LORE.md`), y se descifran jugando:
   - **Crónica:** se abre con el nivel de cuenta. El capítulo de la Temporada 1 se abre al purgar el Núcleo de la Fisura.
   - **Sectores:** al jugar en cada uno.
   - **Núcleos:** al purgarlos. El Eco Profundo, al llegar a la capa 4.
   - **Bestiario:** al aguantar en un sector hasta el minuto en que aparece cada especie. Cada entrada dice cómo combatirla.
   - **Fragmentos de transmisión:** tras 3, 10, 25, 50 y 100 Núcleos purgados.

   Lo que aún no se ha descifrado dice cómo se abre. Cuentan solo las partidas que no son sospechosas.

31. **Desde M7c (primeros pasos y Guía):** sin migraciones.
   - **Primeros pasos:** el inicio enseña cinco pasos que se tachan solos (`GET /galaxy/api/onboarding`): el test de la sonda, la primera incursión, las tiradas de bienvenida, la primera sala reparada y la primera reliquia equipada. Cada uno lleva a donde se hace. Se pueden ocultar y desaparecen al acabarlos.
   - **Guía:** **`/galaxy/guia`**, desde el pie del menú. Tiene seis capítulos cortos, cada uno con un ejemplo animado que queda quieto con movimiento reducido.
   - **PERKINS:** la primera subida de nivel explica cómo elegir una mejora, una sola vez.
   - **Menú:** Misiones de hoy (con su avance), Logros, Sondas y Códice llevan a su sitio. Solo Eventos y Ajustes siguen «En desarrollo».

   Comprueba con una cuenta nueva que el inicio enseñe 1 de 5 tras el test de la sonda, y que no haya violaciones de CSP.

32. **Desde M7d-1 y M7d-2 (ruta, tienda y cierre de temporada):** la migración `20261108203624_galaxy_season_route.sql`:
   - deja que la moneda de temporada viva en su propio saldo, `season:<id>`, para que cada temporada empiece de cero;
   - crea `galaxy.season_route_claims` (escalones recogidos) y `galaxy.season_purchases` (compras por artículo).

   Clave de configuración nueva, **`seasonRoute`**:
   - **Moneda:** «Esquirlas». Cada incursión que cuenta paga la mitad de sus puntos de temporada. Al cerrar la temporada, cada esquirla que sobra vale 2 de polvo.
   - **Ruta:** 20 escalones hasta los 30 000 puntos, con monedas, polvo, señales, esquirlas, tres títulos y el marco Nebulosa.
   - **Tienda:** señales, polvo, monedas, un título y el marco Abismo, cada uno con su límite.

   **Dónde:** **`/galaxy/temporada`**, desde «Ruta y tienda de temporada» en la columna de la temporada del inicio. El resultado de una incursión enseña la moneda ganada. La puntuación es la de la clasificación General.

   **Cierre de temporada (M7d-2):** la migración `20261108204602_galaxy_season_close.sql` crea `galaxy.season_archive` (el salón de la fama) y `galaxy.season_results` (puesto, puntos, tramo y premios de cada jugador).
   - **Cuándo:** la primera lectura tras `season.endsAt` archiva la temporada con la clasificación General final. Esa lectura es `/season` o `/hall-of-fame`.
   - **Premios:** cada tramo paga lo suyo (`seasonRoute.closing.tiers`, de Bronce a Estelar). Los 3 primeros reciben además el premio del podio: el título «Podio de temporada», el marco nuevo **Corona** y su trofeo. Se recogen una vez desde `/galaxy/temporada`, y se guardan al cerrar, así que cambiar la configuración después no los cambia.
   - **Trofeos:** la sala de la estación deja de estar «en reparación» y abre **`/galaxy/trofeos`**, con tus temporadas y el salón de la fama.
   - **Perfil:** enseña el historial de temporadas (`GET /galaxy/api/profiles/:usuario/seasons`).
   - **Clasificación:** tiene un enlace al salón de la fama.

   **Antes de abrir otra temporada** (cambiar `season.id`), deja que la anterior se archive: abre `/galaxy/temporada` una vez pasado su `endsAt`. M7d-3 lo hará solo desde el panel.

   Comprueba con una cuenta de prueba:
   - `GET /galaxy/api/season` y `GET /galaxy/api/hall-of-fame` responden 401 sin sesión y su vista con sesión;
   - `/temporada` y `/trofeos` (desde la sala Trofeos) cargan sin violaciones de CSP.

33. **Desde M7d-3 (anomalía de temporada):** sin migraciones. La simulación pasa a **SIM_VERSION 1.6.0**: un cliente con la web vieja en caché tiene que recargar.
   - **Anomalías:** el contenido trae cuatro en `content.anomalies`: Corrosión contagiosa, Enjambre, Estática férrea y Marea veloz. Multiplican la vida, el daño, la velocidad, la aparición y las élites de los enemigos, y los datos que sueltan. La primera hace además que un enemigo corroído que cae corroa a los que tiene cerca.
   - **La temporada elige una:** `season.anomaly`, por defecto `contagion`; `null` para ninguna. Mientras la temporada está abierta, cada incursión empieza con ella y la guarda en `upgrades.anomaly`, así que la repetición del panel la juega igual.
   - **Inicio y hangar:** la enseñan en un chip junto a los multiplicadores (`GET /galaxy/api/boosts` trae `anomaly`).
   - **Abrir otra temporada desde el panel:** al publicar `season` con otro `id`, la temporada que sustituye se archiva sola con su clasificación final, haya terminado o no.

   Comprueba con una cuenta de prueba que el inicio enseñe el chip de la anomalía y que una incursión arranque sin errores.

34. **Desde M7e-1 (eventos):** la migración `20261108210841_galaxy_events.sql`:
   - deja que las misiones usen también el periodo `e:<evento>`;
   - crea `galaxy.clan_event_progress` (lo que suma cada clan en sus metas).

   Clave nueva, **`events`**, vacía por defecto. Cada evento tiene nombre, descripción y fechas (hasta 31 días), y hasta 12 metas.
   - **Metas personales:** se cuentan como misiones.
   - **Metas de clan:** suman lo que hacen sus miembros mientras lo son, y cada miembro recoge el premio una vez.
   - **Premios:** pueden incluir `eventSignals`, las señales propias del evento (`signal:<id del evento>`).

   **Escáner de evento:** ya se publica. Se añade en `gacha.banners` con `kind: "event"`, su destacada, `currency: "signal:<id del evento>"` y las mismas fechas. El escáner lo paga con esas señales.

   **Dónde se ve:** el inicio enseña el evento en marcha y lleva a su pestaña en `/misiones`.

   Ejemplo para probarlo desde el panel (cambia las fechas):
   ```json
   { "list": [{ "id": "cometas", "name": "Lluvia de cometas", "description": "Escanea el cielo mientras pasan los cometas",
     "startsAt": "2026-11-10T00:00:00.000Z", "endsAt": "2026-11-17T00:00:00.000Z",
     "goals": [
       { "id": "scan", "name": "Haz 20 tiradas", "stat": "pulls", "target": 20, "reward": { "eventSignals": 5 } },
       { "id": "purge", "name": "Purga 3 Núcleos", "stat": "bossKills", "target": 3, "reward": { "coins": 1500, "eventSignals": 5 } },
       { "id": "clan-runs", "name": "Entre todo el clan, 50 incursiones", "stat": "runs", "target": 50, "scope": "clan", "reward": { "signal": 3 } } ] }] }
   ```

35. **Desde M7e-2 (prestigio «Corrimiento al rojo»):** la migración `20261108211407_galaxy_redshift.sql` crea `galaxy.redshift` (el rango de cada cuenta). Clave nueva, **`redshift`**:
   - **Requisitos:** nivel de cuenta 25 y niveles de Laboratorio comprados en total: 10, 15, 20, 25 y 30 para cada rango.
   - **Rangos:** como mucho 5.
   - **Bonus:** cada rango suma +3 % de experiencia y +2 % de suerte en cada incursión (dentro de los topes).
   - **Títulos:** uno por rango, «Corrimiento I» a «Corrimiento V».
   - **Qué reinicia:** los nodos del Laboratorio y su sala, que hay que reparar otra vez. Nunca la colección, ni las monedas, el polvo, las sondas o el resto de la estación.

   **Dónde:** al pie de **`/galaxy/laboratorio`**, a partir del nivel en que se abre. Pide confirmación diciendo qué vuelve a cero.

   Comprueba que `GET /galaxy/api/redshift` responde 401 sin sesión y su vista con sesión.

36. **Desde M8a (audio y Ajustes):** sin migraciones ni claves.
   - **Música adaptativa:** synthwave en La menor a 104 bpm, sintetizada con WebAudio y un planificador anticipado. Empieza con el primer clic o tecla y nunca suena en el panel de admin.
   - **Capas:** el pad siempre; el bajo, el arpegio y la batería entran según la intensidad. En la incursión la intensidad sube con la capa o la baliza, y es máxima con un jefe o con poca vida.
   - **Mezclador:** los efectos del escáner y del combate pasan por un solo mezclador con dos buses.
   - **Ajustes (`/galaxy/ajustes`):** el botón del pie del menú, que deja de estar «En desarrollo», lleva a la música, los efectos, silenciar todo, apuntar con el ratón, volver a oír a PERKINS y enseñar otra vez los primeros pasos. Se guarda en el navegador. El silencio de antes del escáner se respeta.

   Comprueba que suena tras el primer clic, que el volumen de la música la baja y que «Silenciar todo» lo calla todo.

37. **Desde M8b (retención):** la migración `20261108212600_galaxy_retention.sql` crea `galaxy.prune_retention()`, la única vía para borrar lo caducado. El servidor la ejecuta un minuto después de arrancar y luego cada hora; el log dice `retention pruned` cuando borra algo.
   - **Entradas grabadas:** las de partidas normales se van a los 30 días. Las de partidas sospechosas, las que purgaron un Núcleo y las que llegaron a la capa 3 se quedan siempre.
   - **Chat:** los mensajes se van a los 90 días, salvo los denunciados.
   - `run_inputs` sigue siendo de solo añadir para todo lo demás.

38. **Desde M8c (acabado exclusivo de temporada):** la migración `20261108213407_galaxy_season_finish.sql` admite el acabado nuevo **Fisura** (`rift`) en `galaxy.galaxies`.
   - **Cómo sale:** `season.finish` (por defecto `rift`) y `season.finishChance` (por defecto 2 %, como mucho 20 %). Mientras la temporada está abierta, cada tirada tiene esa probabilidad de llevarlo, con su propio flujo de azar. Las probabilidades del escáner (`gacha.finishes`, cinco pesos) no cambian.
   - **Sello de origen:** cada galaxia de una tirada en la temporada guarda su `season`.
   - **Catálogo:** la Fisura queda fuera, para que el 100 % siga siendo alcanzable.
   - **Al desintegrarla:** rinde como Corrupto.
   - **Cómo se ve:** en la carta, estática violeta con esquirlas de cristal; en el inspector 3D, su luz propia.

39. **Pulido, fase 1 (interfaz):** sin migraciones.
   - **Inicio:**
     - «Misiones de hoy» tiene clase propia (`hub-missions`), contador e insignia «Recoger»; se acaba el choque con `.missions` de las pantallas de lista;
     - las seis fichas del menú tienen la misma forma, con subtítulos de una línea;
     - «Tienda de temporada» va centrado y sin icono.
   - **Anomalía:** pasa a una etiqueta con «Más información», que abre una ventana con lo que hace. Está en la columna de la temporada y en el Hangar.
   - **Comunicaciones:** deja de estar «en reparación». Abre un panel con Mercado, Trueques, Buzón (con sus no leídos), Comunidad y Clanes.
   - **Refinería y Antena:**
     - el panel tiene el arte de la sala, datos con icono y barra (con el tiempo hasta acabar la cola, o hasta llenarse);
     - se carga con un deslizador y atajos ¼, ½ y Todo;
     - la mejora compara ahora con el siguiente nivel;
     - una máquina con algo que recoger dice «Listo» en su placa.
   - **Laboratorio:** cada rama tiene su progreso, y cada nodo su coste con iconos y su estado más claro.

40. **Pulido, fase 2 (sonidos y test de la sonda):** sin migraciones.
   - **Sonidos:** todo lo interactivo suena al pulsar con un sonido corto y suave, sintetizado por el bus de efectos.
     - Cada tipo de control tiene el suyo: toque, pestaña, interruptor, confirmar en las acciones principales y volver.
     - Los botones grandes del menú dan un roce muy bajo al pasar el ratón.
     - Hay una casilla nueva en Ajustes, «Sonidos de la interfaz». Usa el volumen de Efectos y respeta «Silenciar todo».
   - **Test de la sonda:** preguntas cotidianas de personalidad, sin términos del juego, con la intro y los perfiles en lenguaje llano. Cada respuesta sigue dando la misma sonda que antes.

   Comprueba de oído que los sonidos no cansan y que la casilla los apaga.

41. **Pulido, fase 3 (tutorial guiado):** migración `20261108232335_galaxy_tutorial.sql`, que se aplica sola al desplegar.
   - **Tabla nueva `galaxy.tutorial`:** guarda el capítulo de cada cuenta. Las cuentas que ya habían terminado alguna incursión quedan con el tutorial hecho, así que solo lo hacen las nuevas.
   - **Recorrido:** tras su sonda, un jugador nuevo hace el tour de PERKINS por el inicio, el Escáner (sus 10 tiradas de bienvenida), el Hangar (equipa una reliquia), la primera incursión, el botín y la estación.
     - Cada paso es una tarjeta con un hueco alrededor de lo que importa, un anillo y una flecha.
     - Con un panel abierto, la tarjeta se acopla en una esquina.
     - Si el jugador se va a otra pantalla, una píldora le devuelve al tour.
   - **Primera incursión:** espera tras una tarjeta de controles con «Despegar», y PERKINS da consejos por radio en el momento justo.
   - **Regalo:** al llegar a la estación, el tour regala una vez los componentes que cuesta reparar la antena (motivo `tutorial` en el libro de movimientos). Así el jugador la repara en el último paso.
   - **Saltar y repetir:**
     - se puede saltar en cualquier momento, con «Saltar tutorial» o Escape;
     - se repite desde Ajustes, con «Repetir el tutorial»;
     - los admins creados con `create-admin` empiezan con el tutorial saltado.

   Comprueba el tour completo con una cuenta nueva.

42. **Pulido, fase 4 (admin sin código):** sin migraciones.
   - **Configuración:** la portada agrupa las claves por categorías con su nombre y para qué sirven.
     - Cada clave se edita con un formulario: números con su unidad y rango, porcentajes de 0 a 100, opciones con nombres, fechas en tu hora con su UTC, y listas de tarjetas.
     - Cada campo dice su problema, y «Qué cambia» habla con los nombres del formulario.
     - Avanzado avisa y conserva la pestaña JSON; el contenido de las incursiones solo se edita en JSON.
   - **Eventos:** sección nueva del panel, con los eventos en marcha, próximos y terminados.
     - Un asistente de cinco pasos crea o edita un evento: datos, metas, premios, escáner opcional y revisar, con la vista del jugador.
     - El evento y su escáner se publican juntos, todo o nada, con `POST /galaxy/api/admin/config/batch`, que solo admite eventos, escáner, multiplicadores y misiones.
     - Avisa sin bloquear de señales de evento sin escáner y de escáneres sin evento o con otras fechas.
     - Desde la lista se puede terminar un evento ahora o quitarlo.

   Lo comprueba el propietario con su admin. Las cuentas de admin se crean por SSH.

43. **Multijugador, fase 1 (objetos de la incursión, SIM 1.7.0):** sin migraciones.
   - **Objetos rompibles:** las rocas, el hielo, el coral, la escoria y los cristales del sector se rompen con las armas. Llevan barra de vida roja y sueltan componentes y polvo.
   - **HUD y pagos:** el HUD cuenta los componentes, y el resultado los paga, a la mitad sin extraer.
   - **Topes:** van en `runs.caps` (`runComponents`, `componentsPerMinute`, `propDustPerMinute`). Lo que sueltan los objetos se ajusta en `content.props` y la probabilidad del imán en `content.sectors[].drops.magnet` y `eliteMagnet`.
   - **Imán:** atrae todos los datos del suelo a quien lo recoge, y el cofre del Núcleo siempre trae uno.
   - **Datos:** se ven en verde.
   - **Catálogo ECN:** con premios por recoger, el botón se vuelve dorado y la ficha Colección del inicio lleva «Premio».
   - **Partidas de la versión anterior:** las repeticiones del panel de partidas jugadas con SIM 1.6.0 avisan de la versión, como siempre.

44. **Multijugador, fase 2 (fusión automática y candado):** migración `20261109120000_galaxy_galaxy_lock.sql`, que se aplica sola al desplegar.
   - **Candado:** se pone desde el detalle de una galaxia. Una galaxia con candado no se fusiona ni se desintegra, y la colección filtra «Con candado».
   - **Fusión automática:** abre su diálogo desde la colección, partiendo de los filtros.
     - Enseña la cadena, el polvo y lo que se queda, y luego revela lo que hizo.
     - Como mucho hace 100 fusiones por vez.
     - En el libro de movimientos quedan como `fusion` con `ref.auto`.

45. **Multijugador, fase 3 (amigos, presencia e invitaciones):** migración `20261109121000_galaxy_friends.sql`, que se aplica sola al desplegar. Crea `friendships`, `blocks` y `social_prefs`.
   - **El botón Amigos** de la barra superior abre una hoja con cuatro pestañas:
     - Amigos: los conectados primero, con lo que hacen (en la estación, en el hangar o en una incursión con su capa);
     - Solicitudes;
     - Bloqueados;
     - Privacidad: quién puede invitarte y si se ve tu estado.
   - **Socket vivo** en `/galaxy/api/live/ws`: pasa por el túnel como el del chat. Si se queda sin conectar, revisa que Cloudflare tenga los WebSockets activos.
     - Una solicitud llega al momento como aviso, que se puede aceptar ahí mismo.
     - Al cerrar sesión, banear o cerrar sesiones, sus sockets se cierran.
   - **Bloqueos:** un bloqueo vale en las dos direcciones y no se revela: para el bloqueado, la cuenta parece no existir.
   - **El perfil** gana «Añadir amigo», «Aceptar», «Quitar amigo» y «Bloquear».
   - **Admin:**
     - clave nueva `social` (`maxFriends`, `requestsPerHour`) y el interruptor `features.friends` en Configuración;
     - pestaña Social en la ficha del jugador, con amigos, solicitudes y bloqueos en los dos sentidos;
     - las estadísticas cuentan los sockets de los dos tipos.

46. **Multijugador, fase 5 (salas y la nueva /incursion):** sin migraciones. Las salas viven en la memoria del servidor: un reinicio las cierra.
   - **El hangar** gana arriba tres tarjetas:
     - Partida rápida: despega ya con lo de abajo;
     - Solitario: la página de siempre;
     - En grupo: lleva a las salas, o a la tuya si ya estás en una.

     No salen durante el tutorial guiado.
   - **`/incursion/grupo`:**
     - Entrar rápido: la sala pública más llena con hueco, o una nueva;
     - crear sala: pública, solo amigos o privada, en un sector que tengas abierto;
     - unirse con código;
     - la lista de salas públicas;
     - los amigos conectados, con «Unirse» si están en una sala.
   - **`/incursion/sala`:**
     - cuatro huecos con sonda, nivel, listo y conexión;
     - el líder cambia el sector (y nadie queda listo) y el tipo, expulsa y cede el liderazgo;
     - invitar a amigos conectados: les llega un aviso con «Unirse».
   - **Despegar** aún responde «Las partidas en grupo llegan muy pronto», hasta la fase 6.
   - **Acceso:** jugar en grupo pide acabar o saltar el tutorial y el nivel `coop.minLevel`. Se apaga con `features.coop`.
   - **Admin:**
     - clave nueva `coop` en Configuración › En grupo, con nivel mínimo, salas, invitaciones y las reglas de la partida por número de jugadores (las usa la fase 6);
     - Moderación › Salas en vivo: lista cada 5 segundos y cierra una sala con motivo (queda en la auditoría como `room.close`, y a sus jugadores se les avisa).

47. **Multijugador, fase 6 (partidas en grupo):** migración `20261109122000_galaxy_coop.sql`, que se aplica sola al desplegar. Crea `coop_runs` y `coop_run_inputs`, y añade a `runs` `coop_run_id`, `slot`, `party_size` y `points_factor`.
   - **Despegar** ya lanza la partida. Todos los de la sala pasan a la arena y juegan la misma incursión en tiempo real:
     - el servidor cierra los ticks a 60 Hz y reparte las entradas por `/galaxy/api/coop/play/ws`, que pasa por el túnel como los otros sockets;
     - las cartas no paran el mundo (1, 2 o 3, con 15 s);
     - los caídos se reaniman quedándose encima;
     - Escape abre un menú sin pausa con «Abandonar», que también saca de la sala.
   - **Cobro:** cada jugador cobra al acabar, en su propia fila:
     - botín del grupo × `coop.loot` por capa;
     - puntos de temporada × `coop.points`;
     - quien se fue cobra como abandono.

     La sala vuelve a esperar, con nadie listo.
   - **Desconexiones:** sin socket 10 s, la sonda queda ausente (intangible) y vuelve al reconectar. Si no queda nadie conectado en 120 s, la partida termina.
   - **Despliegues a mitad de partida:** las partidas en curso se guardan cada 5 s. Al arrancar, el servidor paga las que quedaron a medias como extracción de lo que llevaban (`coop_runs.state = interrupted`).
   - **Clasificación:** General suma los puntos de grupo con su factor. Profundidad y Purgas solo cuentan partidas en solitario, porque los récords de grupo tendrán su propia clasificación (fase 7).
   - **Pendiente (fase 6c):**
     - avisos rápidos;
     - chat de sala;
     - comparar los hashes de los clientes con el árbitro;
     - cámara de espectador;
     - desglose por jugador en los resultados.

48. **Taller de sondas (`/taller`):** sin migraciones.
   - **Entrada:** la ficha «Sondas» del inicio lleva aquí, y en el lobby de `/incursion` se llega pulsando la sonda.
   - **Dentro:** se ven las 8 sondas; las bloqueadas dicen qué las gana. La seleccionada aparece en la bahía del taller, pintada en Aseprite (`art/workshop/paint-workshop.lua`).
   - **Acciones:**
     - elegir una para verla no la equipa: se equipa con «Equipar»;
     - se sube de nivel, con chispas, destello, el nuevo nivel y sonido;
     - se elige el arma inicial.
   - **Enlace directo:** `/taller?sonda=<id>` abre esa sonda.
49. **Lobby de `/incursion` (estilo «Escenario»):** sin migraciones.
   - **Fondo:** el bioma del sector elegido animado, con flotas de sondas, la estación y el planeta pintados en Aseprite (`art/lobby/paint-lobby.lua`) y una galaxia real al fondo.
   - **Pasos en orden:** 1 ¿Con quién? (Solo o En grupo, sobre el escenario); 2 ¿Dónde? (el sector a la derecha, o la sala); 3 ¿Con qué? (la sonda en su plataforma y las reliquias abajo); y el botón de lanzar.
   - **La sonda:** pulsarla abre `/taller?sonda=<id>`; las flechas cambian la sonda equipada entre las que se tienen.
   - **Grupo dentro del lobby:** «En grupo» deja `?modo=grupo`; desde ahí se crea sala, se entra con código, con un amigo o en una pública, y «Entrar rápido» es el botón grande. En una sala, los compañeros salen en sus plataformas, el líder despega y los demás marcan «Estoy listo». `/incursion/grupo` y `/incursion/sala` llevan al lobby.
   - **Comprobar:** a 1280, 1600 y 2560 px nada se tapa ni se desborda; la barra de arriba y el raíl de zonas (Taller, Colección, Estación, Temporada, Clasificación, Clan) llevan a su sitio.

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
