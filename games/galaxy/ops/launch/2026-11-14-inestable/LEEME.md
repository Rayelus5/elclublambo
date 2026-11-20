# La explosión de Inestable

Petición del propietario del 14/11: «a partir del minuto 20-25 hace demasiado daño y puede instant killear al jugador … dejarle algo más de tiempo para huir, y que si te alcanza, que te deje al menos un 40 % de la vida».

**Necesita el código de #197 desplegado (SIM 1.13.0).** El campo `keep` no existe en el esquema anterior.

**`content.json`:** lo que hay en PRE (leído el 14/11, versión 10) con un solo cambio, la explosión del élite `volatile`:
- `delay`: de 0,6 s a **1,2 s** para huir del círculo de aviso;
- `keep`: **0,4**, que es lo que deja de la vida que tengas (se lleva como mucho el 60 %). Ya vale 0,4 por defecto con el código nuevo; publicarlo deja el número a la vista y ajustable desde Admin;
- `radius` (50) y `damage` (12) no cambian.

Nada más cambia: ni armas, ni enemigos, ni sectores, ni sondas.

**`antes/content.json`:** lo que hay ahora, para volver atrás.

Se publica con la skill galaxy-publicar-config, solo con el OK del propietario.

## Publicado

- **Cuándo:** 14/11/2026 a las 18:09 (Madrid), con el OK del propietario y con el código de #197 ya desplegado.
- **Versión:** `content` v10 → v11, con el motivo «Explosión de Inestable: 1,2 s de aviso y nunca mata».
- **Comprobado:** v11 tiene `volatile.explode` = { radius 50, damage 12, delay 1,2, keep 0,4 }, la salud está bien y el contenedor no registró errores.
- **`antes/content.json`:** la v10 tal como estaba justo antes, para volver atrás.
