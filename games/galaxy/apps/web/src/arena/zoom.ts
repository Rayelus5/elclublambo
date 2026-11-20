import { type RefObject, useEffect } from 'react';
import { wheelSteps } from './stage/camera';
import type { Stage } from './stage/stage';
import { setArenaZoom } from './settings';

// The mouse wheel zooms the arena (the owner's request, 2026-11-11), solo or in a group: over the field, a notch up
// comes one whole step closer and one down goes back, never farther than the base view. Only the view changes (each
// player their own), never the simulation; the level is kept for the next run.

/** Listens to the wheel over the arena's canvas and zooms its stage. */
export function useWheelZoom(canvasRef: RefObject<HTMLCanvasElement | null>, stageRef: RefObject<Stage | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rest = 0;
    const wheel = (e: WheelEvent) => {
      const stage = stageRef.current;
      if (!stage || e.ctrlKey) return;
      e.preventDefault();
      const r = wheelSteps(rest, e);
      rest = r.rest;
      if (r.steps === 0) return;
      const before = stage.zoomLevel();
      stage.zoom(r.steps);
      // At a limit the extra turn is dropped, so the way back starts at once.
      if (stage.zoomLevel() === before) rest = 0;
      else setArenaZoom(stage.zoomLevel());
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [canvasRef, stageRef]);
}
