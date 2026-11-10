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
- Las fuentes del juego deben estar copiadas en `capture/public/galaxy/fonts/`.

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
