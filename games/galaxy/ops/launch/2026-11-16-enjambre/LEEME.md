# Menos enjambre, Núcleos más despejados y un Amplificador que se nota

SIM 1.19.0 (PR #223). Lo pidió el propietario el 16/11/2026, por lo que contaban los jugadores: «se me siguen acumulando exageradas cantidades de enemigos pequeños y me cuesta muchas veces matar a los núcleos».

**`content.json`** es lo vivo (v13) con tres cambios:
- **Amplificador** (`passives`, `amplifier`): +10, +20, +35, +60 y +100 %. Antes era +10, +20, +30, +40 y +50 %.
- **Contra el Núcleo** (`sectors[].density.bossFactor`): una cuarta parte de lo de siempre, en los cinco sectores. Antes, la mitad.
- **Curación del Sifón** (`healing.base`): queda fijada en el 1,5 %.

**Lo que no hace falta publicar:** el enjambre a raya (`sectors[].swarm`: tope de 60 y desvanecimiento hasta la mitad desde el minuto 8) entra con su valor por defecto al desplegar.

**Volver atrás:** publicar `antes/content.json` tal cual.

## Publicado

- **2026-11-16 a las 20:04 UTC:** `content` v13 → **v14**, con la CLI y el motivo «SIM 1.19.0: Amplificador 10/20/35/60/100 y una cuarta parte de enemigos contra el Nucleo, por decision del propietario».
- **`check-config`** también listó `events`. La v13 guardada no traía ese campo y lo vivo ya usaba su valor por defecto, que ahora queda escrito igual.
- **Comprobado tras publicar:** la salud está en verde y no hay errores en el contenedor.
