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
