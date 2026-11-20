# Tráiler de Galaxy Survivor

Tráiler de 2:23 (1920×1080, 60 fps) y corte vertical del clímax (1080×1920) para redes. Todo lo que se ve es el juego real, grabado fotograma a fotograma, y el montaje va al compás de la música.

## Cómo está hecho

1. **Grabación** (`capture/`). Vitest en modo navegador monta las pantallas reales del juego (`ArenaScreen`, `StationScreen`, `ScannerScreen`…) con datos de ejemplo y un reloj virtual (`vt.ts`). Cada fotograma avanza 1/60 s y se guarda como PNG en `capture/frames/<escena>/`.
2. **Codificación** (`tools/encode.sh`). Cada escena pasa a `public/footage/<escena>.mp4` con ffmpeg.
3. **Montaje** (`src/`). Remotion: `edit.ts` es la lista de planos por compás, con el clip, el segundo de inicio, el movimiento de cámara y el rótulo; `Trailer.tsx` y `Vertical.tsx` los componen.
4. **Ritmo** (`tools/beats.py`). Analiza `public/music.wav` y escribe `src/beats.json` (87,5 BPM). Si cambias la música, vuelve a ejecutarlo y revisa `edit.ts`.

## Comandos

Grabar una escena (desde `games/galaxy`):

```bash
VITE_SCENE=horde pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/arena.capture.tsx
VITE_SCENE=station pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/ui.capture.tsx
```

- Escenas de la arena: `horde`, `cards`, `boss` (graba `boss` y `extract`) y `coop`.
- Escenas de interfaz: `station`, `lab`, `lobby`, `scanner`, `event`, `collection` e `inspector`.
- `VITE_FRAMES=n` cambia la duración. `VITE_SKIP=n` (solo en `scanner`) graba únicamente a partir del fotograma n; así se hizo `scanner-end`, con `VITE_SKIP=2040 VITE_FRAMES=2760`.

## Fotos fijas (capturas de presentación)

Las mismas escenas sirven para sacar capturas sueltas de 1920×1080. Los ajustes:

- `VITE_EVERY=n` guarda solo uno de cada n fotogramas.
- `VITE_STILL=1` (arena) aplica tres cosas:
  - quita el destello blanco de los golpes, que en una foto queda como manchas blancas;
  - activa el modo invulnerable de las partidas de prueba, para que no salga el borde rojo de daño;
  - muestra en la barra la vida real de la sonda.
- `VITE_ZOOM=1` (arena) acerca la cámara un paso, como la rueda del ratón.
- `CAPTURE_SCALE=1.5` (pantallas de menú) hace la captura como una ventana de 1280×720 en pantalla de alta densidad: misma imagen de 1920×1080, con la interfaz más grande.
- `VITE_NOSCROLL=1` (colección) no desplaza la página.

Escenas: `horde-still` (Nebulosa Exterior, minuto 10) y `scanner-summary` (resumen de una tirada de 10).

Las 5 capturas de presentación del 20/11/2026 salieron de:

```bash
VITE_STILL=1 VITE_ZOOM=1 VITE_SCENE=horde-still VITE_FRAMES=240 VITE_EVERY=30 pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/arena.capture.tsx   # f00059
VITE_STILL=1 VITE_ZOOM=1 VITE_SCENE=boss VITE_FRAMES=360 VITE_EVERY=60 pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/arena.capture.tsx          # f00299
CAPTURE_SCALE=1.5 VITE_SCENE=scanner-summary VITE_FRAMES=240 VITE_EVERY=60 pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/ui.capture.tsx     # f00239
VITE_SCENE=collection VITE_NOSCROLL=1 VITE_FRAMES=180 VITE_EVERY=180 pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/ui.capture.tsx         # f00179
VITE_SCENE=lobby VITE_FRAMES=70 VITE_EVERY=70 pnpm -s exec vitest run --config trailer/capture/vitest.config.ts trailer/capture/ui.capture.tsx                                 # f00069
```

Antes de grabar, copia `apps/web/public/*` en `capture/public/galaxy/`: las fuentes y los iconos se sirven desde ahí. Cada foto espera a que carguen Bungee y Fredoka, y falla si no cargan.

Codificar, previsualizar y renderizar (desde `games/galaxy/trailer`):

```bash
bash tools/encode.sh [escena]   # sin argumento, todas
npm run studio                  # editor de Remotion en el navegador
npm run render                  # out/galaxy-survivor-trailer.mp4
npm run render:vertical         # out/galaxy-survivor-vertical.mp4
```

## Qué no se sube al repositorio

Los fotogramas, los clips, los vídeos renderizados y la música no se suben (`.gitignore`): pesan mucho y la música viene del vídeo del propietario, sin confirmar sus derechos. Para cambiarla, sustituye `public/music.wav` y vuelve a analizar el ritmo.

La dirección de juego del cierre está en `PLAY_URL` (`src/theme.ts`).
