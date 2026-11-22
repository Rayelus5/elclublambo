# Las primeras campañas de «Encuestas y avisos»

Petición del propietario del 22/11: tres campañas para todos los jugadores de **nivel 3 o más**, **sin premio**.

| Archivo | Tipo | Qué pregunta o dice | Fechas (Madrid) | Prioridad |
|---|---|---|---|---|
| `avisos/1-recomendacion.json` | Encuesta | «¿Recomendarías Galaxy Survivor a un amigo?», de 0 a 10 (Poco probable / Muy probable), que da el NPS en los resultados | 22/11 16:00 → 7/12 00:00 | Normal |
| `avisos/2-valoracion.json` | Valoración | Estrellas y «Cuéntanos por qué», opcional | 22/11 16:00 → 14/12 00:00 | Baja |
| `avisos/3-promocion-temporada-2.json` | Promoción | «La Temporada 2 ya está aquí», con la captura del Núcleo La Anémona Rey (`avisos/temporada-2.png`) y «Ver la temporada», que lleva a la pantalla de la temporada | 23/11 00:00 → 30/11 00:00 | Alta |

Cada jugador ve una al día como mucho, la de más prioridad. Así, desde el 23/11 la promoción sale la primera; la encuesta y la valoración van saliendo los días siguientes, y «Más tarde» las trae otro día, hasta 3 veces.

## Cómo se suben

Solo como **borradores**: publicarlas es cosa del panel, con la contraseña del admin. Necesita el código de `popup-draft` desplegado.

```sh
for f in games/galaxy/ops/launch/2026-11-22-encuestas-y-avisos/avisos/*.json; do
  node games/galaxy/scripts/popup-bundle.mjs "$f" | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js popup-draft - --reason 'Primeras campañas: recomendación, valoración y Temporada 2'"
done
```

Después, en **Administración › Encuestas y avisos**, cada borrador › **Revisión** › «Guardar y publicar».
