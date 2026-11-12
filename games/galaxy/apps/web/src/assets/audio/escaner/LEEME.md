# Sonidos de la presentación pro del escáner

Esta carpeta guarda los archivos de audio de la cinemática del escáner (plan «escáner pro», parte B).

**Cómo funciona:**
- **Todo es opcional.** Cada sonido tiene una versión sintetizada, así que la cinemática suena entera aunque esta carpeta esté vacía.
- **Para sustituir un sonido**, deja aquí un archivo con su nombre exacto y despliega.
- **Formato:** `.ogg` (Opus) y, si quieres que suene también en Safari antiguo, el mismo sonido en `.m4a` (AAC). El juego elige el que el navegador reproduce.
- **Se encuentran al compilar** (`import.meta.glob` en `src/scanner/pro/sounds.ts`). Salen con un nombre con hash y se guardan en caché un año, así que un cambio de archivo llega con el siguiente despliegue.
- **El repo es público:** sube solo audio con derechos para usarlo y publicarlo (propio, encargado o con una licencia que lo permita).

## Efectos

| Archivo | Cuándo suena | Duración orientativa |
|---|---|---|
| `cierre` | Las bandas negras se cierran al pulsar «Escanear» | 0,6–0,9 s |
| `latido` | Latido en la oscuridad, dos veces en la ignición | 0,4 s |
| `salto` | Subida del viaje warp; se corta con un fundido al acabar el salto | 3–4 s (se recorta) |
| `ascenso` | La estela cambia al color real: 0,34 s de aspiración y después el golpe | 1 s |
| `meteoro` | Cae la estrella fugaz | 1 s |
| `impacto` | Impacto de común, poco común o rara | 0,6–0,9 s |
| `impacto-grande` | Impacto de épica o legendaria: subgrave y cola larga | 1,5–2 s |
| `reparto` | Las diez cartas caen en la rejilla | 0,7 s |
| `giro` | Una carta se da la vuelta | 0,25 s |
| `revelar-comun`, `revelar-poco-comun`, `revelar-rara`, `revelar-epica`, `revelar-legendaria` | La cara de la carta, uno por rareza | 1–2,5 s |
| `sello` | La rareza se estampa bajo el nombre | 0,3 s |
| `fanfarria` | Solo las legendarias | 2–2,5 s |
| `fenomeno` | «Fenómeno detectado» | 1 s |
| `destacada` | «¡Destacada!» | 0,8 s |
| `acabado` | El brillo de un acabado (holo, prismático, braille, corrupto, fisura) | 0,5 s |
| `resumen` | Al llegar al resumen | 1–1,5 s |

## Música

| Archivo | Capa |
|---|---|
| `musica-base` | Siempre, desde la ignición |
| `musica-rara` | Entra con la primera carta rara |
| `musica-epica` | Entra con la primera épica |
| `musica-legendaria` | Entra con la primera legendaria |

- **Las cuatro van juntas:** el mismo tempo, la misma duración y un bucle sin costura. Arrancan a la vez y solo cambia el volumen de cada capa.
- **Si falta alguna** de las cuatro, suena la música sintetizada entera (72 bpm, 8 compases, unos 27 s).
- **Sonoridad:** unos −16 LUFS integrados en la base, picos a −1 dBTP como mucho.
- **Sin silencio** al principio ni al final (el bucle salta del último instante al primero).
