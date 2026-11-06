import { linearToSrgb } from '../color';
import { smoothstep } from '../noise';
import type { BrailleRender } from '../render';
import { BLUR_FS, COMBINE_FS, FINAL_FS, FULLSCREEN_VS } from './shaders';

// render/postfx.py compose (ENGINE_PORT §7) on the GPU: coverage disc of each dot with a 1-px ramp and the colour
// of the nearest dot, a three-scale glow blurred at dot resolution and upsampled bicubically, vignette, CRT channel
// shift and scanlines, tonemap (knee 0.8) and sRGB. Antimatter is subtractive: ink diffuses into the paper.
// Visually equivalent to the Python PNG, not bit-exact (float32 shader maths, GPU exp/pow).
type Canvas = HTMLCanvasElement | OffscreenCanvas;

const MAX_TAPS = 64;

/** scipy.ndimage.gaussian_filter1d weights for `sigma` (truncate 4.0): w[0..r], normalised over −r..r. */
export function gaussianWeights(sigma: number): Float32Array {
  const radius = Math.trunc(4.0 * sigma + 0.5);
  if (radius >= MAX_TAPS) throw new RangeError(`glow sigma ${sigma} needs ${radius} taps (max ${MAX_TAPS - 1})`);
  const w = new Float64Array(radius + 1);
  let sum = 0;
  for (let x = -radius; x <= radius; x++) {
    const k = Math.exp((-0.5 / (sigma * sigma)) * x * x);
    if (x >= 0) w[x] = k;
    sum += k;
  }
  const out = new Float32Array(MAX_TAPS);
  for (let x = 0; x <= radius; x++) out[x] = w[x]! / sum;
  return out;
}

/** Per-dot glow energy: colour × dot area (or, on paper, the ink absorbed from the background). */
function glowEnergy(render: BrailleRender): Float32Array {
  const n = render.nx * render.ny;
  const energy = new Float32Array(4 * n);
  const step2 = render.step * render.step;
  const bg = render.palette.background;
  for (let k = 0; k < n; k++) {
    const r = Math.max(render.dotRadius[k]!, 0);
    const area = (Math.PI * r * r) / step2;
    for (let ch = 0; ch < 3; ch++) {
      const c = render.dotColor[3 * k + ch]!;
      energy[4 * k + ch] = render.palette.inverted ? (render.dotRadius[k]! > 0 ? Math.max(bg[ch]! - c, 0) * area : 0) : c * area;
    }
  }
  return energy;
}

interface Programs {
  blur: WebGLProgram;
  combine: WebGLProgram;
  final: WebGLProgram;
  vao: WebGLVertexArrayObject;
}

const programs = new WeakMap<WebGL2RenderingContext, Programs>();

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, FULLSCREEN_VS],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function programsFor(gl: WebGL2RenderingContext): Programs {
  let p = programs.get(gl);
  if (!p) {
    p = { blur: compile(gl, BLUR_FS), combine: compile(gl, COMBINE_FS), final: compile(gl, FINAL_FS), vao: gl.createVertexArray() };
    programs.set(gl, p);
  }
  return p;
}

function floatTexture(gl: WebGL2RenderingContext, w: number, h: number, format: 'rgba' | 'r', data: Float32Array | null): WebGLTexture {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (format === 'rgba') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  return tex;
}

function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, name);
}

/**
 * Composes the galaxy into `canvas` (size × size px). Returns false — without throwing — when WebGL2 or float
 * render targets are unavailable or the context is lost; the caller then uses composeFallback.
 */
export function composeWebGL(canvas: Canvas, render: BrailleRender, size: number): boolean {
  let gl: WebGL2RenderingContext | null = null;
  try {
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl || gl.isContextLost() || !gl.getExtension('EXT_color_buffer_float')) return false;
    const p = programsFor(gl);
    const { nx, ny } = render;
    const n = nx * ny;
    const created: WebGLTexture[] = [];
    const framebuffers: WebGLFramebuffer[] = [];
    const tex = (format: 'rgba' | 'r', data: Float32Array | null) => {
      const t = floatTexture(gl!, nx, ny, format, data);
      created.push(t);
      return t;
    };
    const colorRgba = new Float32Array(4 * n);
    for (let k = 0; k < n; k++) {
      colorRgba[4 * k] = render.dotColor[3 * k]!;
      colorRgba[4 * k + 1] = render.dotColor[3 * k + 1]!;
      colorRgba[4 * k + 2] = render.dotColor[3 * k + 2]!;
    }
    const colorTex = tex('rgba', colorRgba);
    const radiusTex = tex('r', render.dotRadius);
    const glowCfg = render.postfx.glow;
    const glowOn = glowCfg.enabled !== false;
    let glowTex = tex('rgba', null);

    gl.bindVertexArray(p.vao);
    if (glowOn) {
      const energy = tex('rgba', glowEnergy(render));
      const tmp = tex('rgba', null);
      const blurred = [tex('rgba', null), tex('rgba', null), tex('rgba', null)];
      const target = (t: WebGLTexture) => {
        const fb = gl!.createFramebuffer();
        framebuffers.push(fb);
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb);
        gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, t, 0);
        gl!.viewport(0, 0, nx, ny);
      };
      gl.useProgram(p.blur);
      gl.uniform2i(uniform(gl, p.blur, 'uSize'), nx, ny);
      gl.uniform1i(uniform(gl, p.blur, 'uSrc'), 0);
      glowCfg.radii.forEach((radiusPx, i) => {
        const weights = gaussianWeights(radiusPx / render.step);
        const taps = Math.trunc((4.0 * radiusPx) / render.step + 0.5);
        gl!.uniform1fv(uniform(gl!, p.blur, 'uW'), weights);
        gl!.uniform1i(uniform(gl!, p.blur, 'uRadius'), taps);
        // scipy filters axis 0 (rows) first, then axis 1 (columns).
        for (const [src, dst, dir] of [
          [energy, tmp, [0, 1]],
          [tmp, blurred[i]!, [1, 0]],
        ] as const) {
          target(dst);
          gl!.activeTexture(gl!.TEXTURE0);
          gl!.bindTexture(gl!.TEXTURE_2D, src);
          gl!.uniform2i(uniform(gl!, p.blur, 'uDir'), dir[0], dir[1]);
          gl!.drawArrays(gl!.TRIANGLES, 0, 3);
        }
      });
      glowTex = tex('rgba', null);
      target(glowTex);
      gl.useProgram(p.combine);
      blurred.forEach((t, i) => {
        gl!.activeTexture(gl!.TEXTURE0 + i);
        gl!.bindTexture(gl!.TEXTURE_2D, t);
        gl!.uniform1i(uniform(gl!, p.combine, `uB${i}`), i);
      });
      const [w0 = 0, w1 = 0, w2 = 0] = glowCfg.weights;
      gl.uniform3f(uniform(gl, p.combine, 'uWeights'), w0, w1, w2);
      gl.uniform1f(uniform(gl, p.combine, 'uStrength'), glowCfg.strength);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.useProgram(p.final);
    const f = p.final;
    [colorTex, radiusTex, glowTex].forEach((t, i) => {
      gl!.activeTexture(gl!.TEXTURE0 + i);
      gl!.bindTexture(gl!.TEXTURE_2D, t);
    });
    gl.uniform1i(uniform(gl, f, 'uColor'), 0);
    gl.uniform1i(uniform(gl, f, 'uRadius'), 1);
    gl.uniform1i(uniform(gl, f, 'uGlow'), 2);
    gl.uniform2i(uniform(gl, f, 'uDots'), nx, ny);
    gl.uniform2f(uniform(gl, f, 'uCanvas'), render.width, render.height);
    gl.uniform1f(uniform(gl, f, 'uStep'), render.step);
    gl.uniform1f(uniform(gl, f, 'uOy'), render.oy);
    gl.uniform1f(uniform(gl, f, 'uScale'), size / render.width);
    gl.uniform1f(uniform(gl, f, 'uSize'), size);
    gl.uniform3f(uniform(gl, f, 'uBackground'), ...render.palette.background);
    gl.uniform1i(uniform(gl, f, 'uInverted'), render.palette.inverted ? 1 : 0);
    gl.uniform1i(uniform(gl, f, 'uGlowOn'), glowOn ? 1 : 0);
    gl.uniform1f(uniform(gl, f, 'uVignette'), render.postfx.vignette * (render.palette.inverted ? 0.4 : 1));
    gl.uniform1f(uniform(gl, f, 'uShift'), Math.max(0, roundHalfEven(render.postfx.chromatic_aberration ?? 0)));
    const scan = render.postfx.scanlines;
    gl.uniform1i(uniform(gl, f, 'uScanPeriod'), scan ? Math.trunc(scan.period ?? 4) : 0);
    gl.uniform1f(uniform(gl, f, 'uScanDepth'), scan ? (scan.depth ?? 0.28) : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    for (const fb of framebuffers) gl.deleteFramebuffer(fb);
    for (const t of created) gl.deleteTexture(t);
    return !gl.isContextLost();
  } catch (error) {
    if (gl?.isContextLost()) return false;
    throw error;
  }
}

function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}

function tonemapChannel(x: number, peak: number): number {
  const knee = 0.8;
  const over = Math.max(x - knee, 0);
  const y = Math.min(x, knee) + (1 - knee) * (1 - Math.exp(-over / (1 - knee)));
  const white = Math.min(Math.max((peak - 1) / 4, 0), 0.85);
  return y + (1 - y) * white;
}

/**
 * Without WebGL2: the coloured dots on their background, with vignette and tonemap but no glow or CRT
 * (Review Focus 4). Same geometry as the shader.
 */
export function composeFallback(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, render: BrailleRender, size: number): void {
  const image = ctx.createImageData(size, size);
  const { nx, ny, step, oy, width, height } = render;
  const scale = size / width;
  const bg = render.palette.background;
  const vignette = render.postfx.vignette * (render.palette.inverted ? 0.4 : 1);
  const lin = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const Y = (y + 0.5) / scale;
    const iyRaw = Math.floor((Y - oy) / step);
    const valid = iyRaw >= 0 && iyRaw < ny;
    const iy = Math.min(Math.max(iyRaw, 0), ny - 1);
    const dy = Y - oy - (iy + 0.5) * step;
    for (let x = 0; x < size; x++) {
      const X = (x + 0.5) / scale;
      const ix = Math.min(Math.max(Math.floor(X / step), 0), nx - 1);
      const dx = X - (ix + 0.5) * step;
      const k = iy * nx + ix;
      const cov = valid ? Math.min(Math.max((render.dotRadius[k]! - Math.sqrt(dx * dx + dy * dy)) * scale + 0.5, 0), 1) : 0;
      const cx = (X / width) * 2 - 1;
      const cy = (Y / height) * 2 - 1;
      const v = 1 - vignette * smoothstep(0.5, 1.35, Math.sqrt(cx * cx + cy * cy));
      for (let ch = 0; ch < 3; ch++) {
        const c = render.dotColor[3 * k + ch]!;
        const value = render.palette.inverted ? bg[ch]! * (1 - cov) + Math.min(Math.max(c, 0), 1) * cov : bg[ch]! + c * cov;
        lin[ch] = Math.max(value * v, 0);
      }
      const peak = Math.max(lin[0]!, lin[1]!, lin[2]!);
      const o = 4 * (y * size + x);
      for (let ch = 0; ch < 3; ch++) image.data[o + ch] = Math.round(linearToSrgb(tonemapChannel(lin[ch]!, peak)) * 255);
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
