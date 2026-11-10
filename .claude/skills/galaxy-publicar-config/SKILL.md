---
name: galaxy-publicar-config
description: Publicar en PRE (la beta abierta de Galaxy Survivor) una carpeta de configuración preparada en games/galaxy/ops/launch/, como contenido, temporada, evento, escáner, potenciadores, misiones, logros, desbloqueos o un aviso, con la CLI del contenedor. Comprueba la carpeta contra lo vivo con check-config, guarda lo vivo para volver atrás, enseña el diff y solo publica con el OK explícito del propietario. Úsala cuando pidan «publica», «publícalo en PRE», «súbelo a la beta», «lanza la temporada» o «lanza el evento», o publish config.
---

# Publicar configuración en PRE

PRE (`pre.elclub.party/galaxy`) es la **beta abierta, con jugadores reales**. Publicar cambia el juego de todos al momento.

Esta skill publica una carpeta de `games/galaxy/ops/launch/` preparada por otra skill:
- contenido: `galaxy-habilidad`, `galaxy-reliquias`, `galaxy-enemigos-sectores-sondas`;
- operación en vivo: `galaxy-temporada`, `galaxy-evento`.

Las reglas están en la parte B de `games/galaxy/docs/CONTENIDO.md`. El acceso SSH a PRE (`<PRE>` en esta skill) está en `games/galaxy/docs/DEPLOY_PRE.md`, en «Lanzamiento de la beta abierta», y los comandos, en su tabla «Operación». Los comandos son para **Git Bash**: en PowerShell `<` no existe y `>` guarda con BOM. Si no puedes llegar a PRE, para y díselo al propietario.

## Nunca

- **Escribir en PRE sin el OK explícito del propietario en esta conversación.** Un «sí» de antes, para otra cosa, no vale.
- Crear cuentas, ejecutar `create-admin`/`reset-totp`/`grant`, tocar la base de datos con `psql` o reiniciar contenedores.
- Leer o imprimir secretos (`.env`, `galaxy.env`, contraseñas).
- Publicar algo que no haya pasado el test de la carpeta y `check-config`.
- Añadir `--reason` a una comprobación para «arreglar» un error de uso: eso la convierte en una publicación de verdad.

## 1. Comprueba que todo está listo

1. **El test de la carpeta pasa:**
   ```
   pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/launch-config.test.ts
   ```
2. **El código que la carpeta necesita está desplegado en PRE:** el PR está integrado en `develop` y el despliegue está en verde.
   ```
   gh run list --branch develop --workflow preproduction --limit 1
   curl -fsS https://pre.elclub.party/galaxy/api/health
   ```
   - Ejemplos de código previo: arte nuevo, campos nuevos del esquema o un arma nueva en `DEFAULT_CONTENT`.
   - Si no está, para: el esquema es estricto y la publicación fallaría, o el arte faltaría en pantalla.
3. **La CLI de PRE tiene las comprobaciones:**
   ```
   ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js" | grep -E "check-config|draft-config"
   ```
   Si no salen, el código de las skills aún no está desplegado: **para**. Sin `check-config` no se publica.
4. **El `LEEME.md` de la carpeta** dice el orden y, si hay `season`, la hora. Una temporada nueva solo se publica al acabar la anterior.

## 2. Comprueba contra lo vivo (solo lectura)

1. **Comprueba la carpeta entera** sobre lo que está publicado de verdad:
   ```
   node games/galaxy/scripts/ops-bundle.mjs <carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
   ```
   Por cada clave, en el orden canónico, dice la versión viva y la que quedaría (`v12 → v13`), qué campos cambian y, en las listas, qué ids entran (`+`), salen (`-`) o cambian (`~`). Al final, si todo se sostiene entre claves: eventos y escáneres, temporada, destacadas, misiones y anomalía.
   - **Si sale un `-` que el `LEEME.md` no explica** (por ejemplo, un evento ya terminado), el borrador no partía de lo vivo y borraría algo: para y rehazlo.
   - **Si algo no valida o no se sostiene**, para y corrige la carpeta.
2. **Guarda los datos vivos** de cada clave, para poder volver atrás, y apunta sus versiones (las de la salida anterior):
   ```
   mkdir -p <carpeta>/antes
   for k in <claves>; do
     ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js show-config $k --data" > <carpeta>/antes/$k.json
   done
   ```

## 3. Pide el OK

Enseña al propietario, en un mensaje corto:
- las claves en orden, con la línea de `check-config` de cada una;
- el motivo que quedará en la auditoría;
- si hay temporada, la hora a la que se publica y qué pasa (se archiva la anterior);
- el texto del aviso, si lo hay.

Después pregunta con AskUserQuestion:
- «Publicar ahora (Recomendado)»: publica en PRE estas N claves en este orden.
- «Todavía no»: no se toca nada.

Solo sigues con la primera respuesta.

## 4. Publica

1. **Repite `check-config` justo antes:** si alguien publicó desde el panel mientras tanto, la CLI lo pisaría sin avisar. Si la salida cambió, vuelve al paso 3.
2. **Clave a clave, en orden.** Para en el primer fallo y avisa; si ya se publicó parte (por ejemplo, `events` sin su `gacha`), propón arreglarlo enseguida o volver a publicar lo de `antes/`.
```
ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config <clave> - --reason '<motivo>'" < <carpeta>/<clave>.json
```
El motivo va entre comillas simples dentro de las dobles; no pongas apóstrofos.

Aviso, si lo hay:
```
ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js notice '<texto>' --tone info --days <N> --reason '<motivo>'"
```

## 5. Comprueba

- **`show-config <clave>` de cada clave:** la versión subió en una y los datos son los tuyos.
- **Salud:** `curl -fsS https://pre.elclub.party/galaxy/api/health`.
- **Errores en el contenedor:** `ssh <PRE> "docker logs --since 10m elclub-pre-galaxy-1 2>&1 | grep -i -E 'error|invalid' | tail -20"`. Un contenido que no valida se sustituye en silencio por el de por defecto y deja un aviso en el log.
- **El propietario lo prueba en PRE.** No crees cuentas para comprobarlo tú.

## 6. Deja constancia

En el `LEEME.md` de la carpeta, anota la fecha y hora de publicación, las versiones que quedan por clave y el motivo. Súbelo con la carpeta `antes/` en un commit `docs(galaxy): …`:
- si la carpeta aún está en su rama, en ese mismo PR;
- si no, en un PR pequeño a `develop`.

## Volver atrás

Si algo sale mal, con el OK del propietario, se vuelve a publicar `<carpeta>/antes/<clave>.json` tal cual: son los datos completos de antes, así que restauran todos los campos. Sigue los mismos pasos: comprobación (`publish-config <clave> - --dry-run` para una clave suelta), OK y `publish-config`, con el motivo «Vuelta atrás: …».

**Lo que no vuelve atrás** (díselo al propietario antes de publicar, si aplica):
- **Temporada:** volver atrás una `season` no deshace el archivo de la anterior.
- **Eventos quitados:** si un evento en curso desapareció, sus señales ya se convirtieron en polvo en las carteras de los jugadores y su progreso no vuelve; el libro de movimientos es de solo añadir.
