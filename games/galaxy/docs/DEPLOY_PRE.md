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

   Las claves `content` (el catálogo de la incursión) y `runs` (la economía) de la configuración viva se ajustan sin desplegar, y `features.runs` apaga las incursiones (503 `runs_disabled`). Las partidas sospechosas quedan en `galaxy.runs` con `suspicious = true` y sus banderas.

## Operación

| Tarea | Cómo |
|---|---|
| Código de recuperación para un jugador | `docker exec elclub-pre-galaxy-1 node dist/cli.js issue-reset-code <usuario>` (24 h, un uso; queda auditado). El panel de admin lo hará en M6 |
| Dar o quitar moneda a un jugador | `docker exec elclub-pre-galaxy-1 node dist/cli.js grant <usuario> <coins\|dust\|signal> <cantidad> --reason "<motivo>"` (una cantidad negativa la quita, nunca por debajo de 0). Queda en el libro de movimientos y auditado como `wallet.grant` |
| Logs | `docker compose … logs -f galaxy` (JSON de pino; nunca llevan contraseñas, cookies ni tokens) |
| Reiniciar | `docker compose … up -d --no-build galaxy` |
| Un admin ha perdido su app de autenticación | `docker exec -it elclub-pre-galaxy-1 node dist/cli.js reset-totp <usuario>`: secreto nuevo, sesiones cerradas, queda auditado |
| Rotar `GALAXY_TOTP_KEY` | Invalida todos los TOTP: solo si la clave se ha filtrado; después, `reset-totp` para cada admin |
| Rotar la contraseña de `galaxy_api` | Paso 1 con otra contraseña, actualizar `galaxy.env` y `up -d galaxy` |
