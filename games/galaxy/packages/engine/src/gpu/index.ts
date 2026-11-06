// @galaxy/engine/gpu: browser-only post-processing (WebGL2 and its 2D fallback). The core (@galaxy/engine) stays
// free of DOM types so the server and the shared rules can use it.
export { composeFallback, composeWebGL, gaussianWeights } from './compose';
