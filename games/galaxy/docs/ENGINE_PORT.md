# Port del motor de galaxias (referencia)

> Referencia del port a TypeScript de `packages/engine` (M2a, GDD §7 y §17.1). Es el resumen verificado del motor de
> Python `galaxy-nft` v0.4.0, leído y comprobado el 2026-11-06. Las referencias doradas que lo respaldan salen de
> `tools/golden/export.py` y viven en `packages/engine/test/golden/v1`; los modelos de Python verificados están en
> `tools/golden/reference/`. Las rutas de `scratchpad\py\` que cita el texto son esas copias.

---

## Versionado (M2a)

- `ENGINE_VERSION = '1.0.0'` (`packages/engine/src/version.ts`). Las galaxias que tienen los jugadores no cambian nunca: una semilla da siempre los mismos rasgos y el mismo braille en la versión con que se creó.
- `test/golden/v1` congela los visuales v1: 26 casos × 3 LOD exportados de Python con `tools/golden/export.py` (determinista: dos exportaciones dan los mismos bytes). `test/version.test.ts` fija el SHA-256 de todo ese braille junto a la versión.
- Si un cambio del motor altera cualquier galaxia: exportar a `golden/v2`, subir `ENGINE_VERSION` y fijar el hash nuevo. La versión forma parte de la clave de la caché del navegador y el servidor la guardará con cada galaxia (M2b), para renderizar cada una con su versión.
- Lo que el port reproduce: rasgos, DNA, parámetros, ruido, campos (error relativo ≤ 1e-12 por ulps de libm), `t_bg` y `light.t` en float32 exactos, braille y colores y radios de los puntos idénticos. El posprocesado en WebGL2 es equivalente a la vista (error medio ≤ 6/255, percentil 99 ≤ 40/255; medido 0,5–2,1 y 7–14).

---


Source: `C:\Users\rayel\Desktop\galaxy-nft` (engine v0.4.0, `src/galaxy_nft/`, not a git repo). Read 2026-11-06, read-only.
Environment that produced the collection: Windows 11, CPython 3.13.14 (MSC v.1944, AMD64), numpy 2.5.4, scipy 1.18.1, Pillow 13.0.0, PyYAML 6.0.3, pytest 9.2.0; CPU AMD Ryzen 7 5700G (numpy SIMD: baseline X86_V2, found X86_V3 = AVX2/FMA, no AVX-512).

Everything marked **[verified]** was checked by running code against numpy/scipy/Pillow in that venv (scripts in `scratchpad\py\`, see §9.5). Everything else is read from source.

Notation: `U(a,b)` = `rng.uniform(a,b)`; `ss(a,b,x)` = `smoothstep`; `E(x)` = `exp(x)`; `**` = power (Python precedence: `-a ** 2` = `-(a²)`); arrays are `(ny, nx)` row-major, row = y (v grows downward).

---

## 0. Ten facts that matter most

1. Seeds: `derive_seed(*parts) = int(sha256("\x1f".join(str(p))).digest()[:8], big-endian)` (64-bit). Token art seed = `derive_seed("token", master, generation_index)`; every subsystem gets `np.random.Generator(PCG64(derive_seed(seed, name)))`. PCG64 is seeded through numpy `SeedSequence` (algorithm in §2.2) **[verified]**.
2. One render = 384×384 dot grid (192 braille columns × 96 rows at 2048 px). The density field is evaluated **once per dot centre** in float64; dots turn on by `t > 0.035 && t*1.1 > 0.75*Bayer4 + 0.25*U[0,1)`.
3. Braille text depends only on: the density fields, the `dither`/`stars`/`glints`/`phenomenon` RNG streams and integer logic. Colours and post-processing never feed back into the dots (except Anomaly's glitch, which edits the dot grid).
4. Dot decisions are robust: over 200 tokens the smallest distance of any dot to its threshold was 1.7e-9 (dither), 8.7e-10 (glint pools), 1.2e-8 (resolved stars) **[verified]**. 1-ulp libm differences (~1e-16) cannot flip dots; **float32 field math would** (use Float64Array).
5. `np.hypot` here equals `Math.sqrt(x*x + y*y)` bit-for-bit (0/200 000 mismatches); `math.hypot`/`Math.hypot` differ in ~16 % of cases. Use `sqrt(x*x+y*y)`. **[verified]**
6. numpy float64 `exp, log, sin, cos, arctan2, power` on this machine = the Windows UCRT libm (0 mismatches vs CPython `math`). Python **scalar** `x ** 2` also goes through UCRT `pow` and differs from `x*x` in ~0.05 % of inputs; numpy **array** `a ** 2` is exactly `a*a` **[verified]**.
7. Two arrays are rounded to float32 before they influence dots: the background density `t_bg` and the phenomenon density `light.t` (use `Math.fround`).
8. PCG64 32-bit draws (`integers`, `choice(list)`, `permutation`, Floyd sampling) use **half** of a 64-bit output and buffer the other half; `random()` always takes a fresh 64-bit word and does not clear the buffer **[verified]**.
9. There is no LOD code and no `tools/golden/` in galaxy-nft. "192/96/48 columns" exists only as `render.braille.columns` (any value works via `Config().with_render(braille={"columns": N})`); a 96-column render is an **independent** render (different RNG-to-dot mapping, different centre snap), not a downsample (§1.3).
10. Braille text: `to_text()` returns LF-joined lines with no trailing newline, but files in `output/braille/*.txt` were written with `Path.write_text` on Windows → **CRLF**; `manifest.json.braille_sha256` is over the CRLF bytes **[verified]**. PNG file hashes depend on Pillow's zlib; compare decoded pixels, never PNG bytes.

---

## 1. Module map and pipeline

### 1.1 Files, public API, callers

| File | Public API (signature) | Called by |
|---|---|---|
| `rng.py` | `derive_seed(*parts) -> int`; `token_seed(master, token_id) -> int`; `sub_rng(seed, name) -> np.random.Generator`; `sub_seed32(seed, name) -> int` | everything |
| `config.py` | `Config(root=ROOT)`: attrs `collection, traits, palettes (=palettes.yaml["palettes"]), visuals, descriptions, showcase, showcase_phenomena`; props `render (=collection["render"]), postfx, master_seed, output_dir`; `with_render(**overrides, braille={...}) -> Config` (deepcopy, updates `render` and `render.braille`) | all entry points |
| `traits.py` | `TraitSampler(traits_cfg)`: `.order, .traits, .rules`; `allowed_values(key, chosen)`; `draw(rng, fixed=None, exclude=None) -> dict[str,str]`; `violations(chosen) -> list[str]`; `label(key, value)`; `dna(traits) -> hex` | plan, pipeline.render_custom, rarity, metadata |
| `plan.py` | `TokenPlan(token_id, index, seed, traits, dna, name, designation)`; `plan_collection(cfg, master=None) -> list[TokenPlan]` (sorted by token_id); `find_token(plan, token_id)` | pipeline, generate, validate, preview |
| `naming.py` | `SYLLABLES` (24); `proper_name(rng)`; `unique_name(rng, taken, blocklist)`; `designation(token_id, fmt="GX-{id:04d}")` | plan, pipeline |
| `rarity.py` | `ABSENT="—"`; `Rarity(token_id, score, rank, tier)`; `trait_counts(cfg, plan)`; `score_collection(cfg, plan) -> dict[int,Rarity]`; `expected_counts(cfg, simulations=20000)`; `deviation_flag(real, expected, supply, tolerance)` | generate, validate, reports, preview |
| `science.py` | `numeric_attributes(traits, seed, numeric_cfg) -> dict`; `sky_coordinates(seed, region)`; `format_*` | metadata |
| `color.py` | `LUT_SIZE=1024`; `hex_to_srgb, srgb_to_linear, linear_to_srgb, hex_to_linear, linear_to_oklab, oklab_to_linear`; `gradient_lut(stops_linear, cyclic=False, size=1024)`; `Palette(key, spec, default_background, default_blackbody_mix)` with `.sample(x)`, `.sample_cyclic(x)`; `luminance(rgb)`; `load_palette(cfg, key)`; `blackbody_linear(T)` | pipeline, fields, background, stars, phenomena, postfx |
| `noise.py` | `_hash(ix, iy, seed)`; `value_noise(x, y, seed)`; `fbm(x, y, seed, octaves=5, lacunarity=2.03, gain=0.5)`; `warped_fbm(x, y, seed, strength=0.5, octaves=5)`; `worley(x, y, seed, jitter=0.8) -> (F1,F2,F3)`; `smoothstep(a, b, x)` | geometry, fields, background, phenomena, postfx, placeholder |
| `geometry/common.py` | `GalaxyParams` (dataclass, §5.1); `Frame(x, y, r, th, yb, rb, ys)`; `make_frame(u, v, cx, cy, size, angle, tilt, bulge_tilt_floor=0.65)`; `gaussian_blob(x, y, cx, cy, radius)` | fields, geometry/*, phenomena |
| `geometry/spiral.py` | `spiral(f, p, seed, barred=False) -> (d, young)`; `barred_spiral(f, p, seed)` | fields, merger, phenomena (satellite) |
| `geometry/elliptical.py` | `elliptical(f, p, seed)`; `lenticular(f, p, seed)` | fields, merger |
| `geometry/irregular.py` | `irregular(f, p, seed, amplitude=1.0)`; `dwarf(f, p, seed)` | fields |
| `geometry/ring.py` | `ring(f, p, seed)` | fields |
| `geometry/merger.py` | `component_centers(p) -> (a_pos, b_pos)`; `merger(u, v, p, seed) -> (d, young, frame_A)`; private `_stream`, `_tail` | fields, phenomena |
| `geometry/__init__.py` | `DISK_GEOMETRIES = {spiral, barred_spiral, elliptical, lenticular, irregular, ring, dwarf}` | fields |
| `fields.py` | `DISK_TYPES=("spiral","barred_spiral","lenticular")`; `GalaxyField(t, young, theta, radius)`; `build_params(traits, seed, visuals, center) -> GalaxyParams`; `core_density(f, p)`; `quasar_spikes(u, v, p, dot_step)`; `galaxy_field(u, v, p, density_gain, dot_step, extra=None)`; `galaxy_color(field, palette) -> float32 (ny,nx,3)` | pipeline |
| `background.py` | `background_field(u, v, kind, spec, palette, seed, rng) -> (t float32, color float32)` | pipeline |
| `stars.py` | `StarLayer(mask, color)`; `background_stars(shape, probability, palette, rng)`; `galaxy_stars(t, young, probability, palette, rng)`; `glint_centers(t, count, rng, margin=3) -> list[(row, col, big)]` | pipeline |
| `phenomena.py` | `LightLayer(t, color)`; `disk_point(p, r, phi)`; `core_point(p)`; `galaxy_matter(kind, u, v, p, spec, rng, seed) -> (d, young) or None`; `light_layer(kind, u, v, p, palette, spec, rng, grid, seed) -> LightLayer or None`; `glitch(on, color, radius, palette, spec, rng, dot_radius)` (in place) | pipeline |
| `render/braille.py` | `BAYER4`; `_BRAILLE_BITS`; `BrailleGrid(width, height, columns)` (`cell_w, cell_h, rows, step, nx, ny, oy, dot_uv(), uv_step, snap(u,v), pixel_maps, coverage(radius_px), expand(per_dot)`); `dither(t, jitter, min_density, rng)`; `to_text(on)` | pipeline, phenomena, postfx, placeholder |
| `render/postfx.py` | `_upsample(arr, grid)`; `glow(energy, grid, glow_cfg)`; `tonemap(x, knee=0.8)`; `compose(grid, dot_color, dot_radius, palette, postfx, rng) -> PIL.Image RGB` | pipeline, placeholder |
| `pipeline.py` | `TokenRender(token_id, seed, traits, name, designation, image, braille)`; `render_token(cfg, token_id, master=None)`; `render_entry(cfg, entry)`; `render_custom(cfg, token_id, fixed, master=None)`; `render_traits(cfg, traits, seed) -> (Image, str)`; `_postfx_for(base, override)` | cli, preview, generate, validate |
| non-pixel | `cli.py` (argparse), `generate.py`, `preview.py`, `metadata.py`, `opensea.py`, `provenance.py`, `validate.py` (incl. Keccak-256/EIP-55), `reports.py`, `placeholder.py` (pre-reveal image), `__main__.py` | — |

Call graph of one render: `render_token → plan_collection → find_token → render_entry → render_traits → {load_palette; build_params; galaxy_matter; galaxy_field → make_frame/merger → geometry → noise; background_field → noise; light_layer → disk_point/core_point/spiral/noise; dither; background_stars; galaxy_stars; glint_centers; glitch; compose → coverage/expand/glow(scipy gaussian_filter, PIL resize)/tonemap/linear_to_srgb; to_text}`.

### 1.2 Pipeline for one token (`render_traits(cfg, traits, seed)`) — exact order

Inputs: `traits` (dict of string keys), `seed` (64-bit int = token seed). Outputs: PIL RGB image `width×height`, braille string.

```
render = cfg.render; bcfg = render.braille
grid = BrailleGrid(render.width, render.height, bcfg.columns)          # 2048, 2048, 192
u, v = grid.dot_uv()                                                     # float64 (ny,nx)
palette = load_palette(cfg, traits.palette)
density = visuals.star_density[traits.star_density]                      # {gain, stars, glints}
bg_spec = visuals.background[traits.background]
phenomenon = traits.get("phenomenon","none"); ph_spec = visuals.phenomenon.get(phenomenon, {})
ph_rng  = sub_rng(seed,"phenomenon");  ph_seed = sub_seed32(seed,"phenomenon")
params  = build_params(traits, seed, visuals, center=grid.snap(0.0,0.0))   # RNG "geometry"; noise_seed=sub_seed32(seed,"noise")
matter  = galaxy_matter(phenomenon, u, v, params, ph_spec, ph_rng, ph_seed)  # satellite/globular only
gal     = galaxy_field(u, v, params, render.density_gain(1.55), grid.uv_step, matter)
t_bg, bg_color = background_field(u, v, traits.background, bg_spec, palette,
                                  sub_seed32(seed,"background"), sub_rng(seed,"background"))   # t_bg float32
light   = light_layer(phenomenon, u, v, params, palette, ph_spec, ph_rng, grid, ph_seed)   # light.t float32
t       = max(gal.t, t_bg)                                   # float64
weight  = gal.t / max(gal.t + t_bg, 1e-6)
color   = galaxy_color(gal, palette)*weight + bg_color*(1-weight)
t_light = zeros if light is None else light.t
if light: w = light.t**2 / max(light.t**2 + t**2, 1e-6); color = color*(1-w) + light.color*w; t = max(t, light.t)
t_dots  = t**0.7 if palette.inverted else t
on      = dither(t_dots, 0.25, 0.035, sub_rng(seed,"dither"))
rng_stars = sub_rng(seed,"stars")
far  = background_stars(t.shape, bg_spec.stars, palette, rng_stars)
far.mask &= (gal.t < 0.1) & (t_light < 0.05)
near = galaxy_stars(gal.t, gal.young, density.stars, palette, rng_stars)
for layer in (far, near): on |= layer.mask; color = where(layer.mask, layer.color, color)
dot_r = 0.19*grid.cell_w;  radius = full(t.shape, dot_r, float32);  big_r = 0.23*grid.cell_w
for (row, col, big) in glint_centers(gal.t, density.glints, sub_rng(seed,"glints")):   # note: gal.t, not t
    reach = 2 if big else 1
    cross = [(0,0)] + [(d*s,0) for s in (-1,1) for d in 1..reach] + [(0,d*s) for s in (-1,1) for d in 1..reach]
    for (dy,dx) in cross:  y,x = row+dy, col+dx; on[y,x]=True; radius[y,x]=big_r
        color[y,x] = accent if inverted else (accent*0.5+0.5) * (3.0 if (dy,dx)==(0,0) else 1.2/max(|dx|,|dy|))
postfx = _postfx_for(cfg.postfx, palette.postfx)
if phenomenon == "anomaly": color = float32 copy; glitch(on, color, radius, palette, ph_spec, ph_rng, dot_r)
                            postfx = _postfx_for(postfx, ph_spec.get("postfx", {}))
dot_color  = where(on, color, 0).astype(float32);  dot_radius = where(on, radius, -1).astype(float32)
image = compose(grid, dot_color, dot_radius, palette, postfx, sub_rng(seed,"postfx"))
return image, to_text(on)
```

`_postfx_for(base, override) = {**base, **override}` and, if `"glow" in override`, `glow = {**base.glow, **override.glow}`.

Entry points that choose `traits` and `seed`:
- `render_token(cfg, token_id)` / `render_entry`: from the collection plan (`plan_collection`, §3.4); `seed = token_seed(master, generation_index)`, NOT of the token id (the art travels with the shuffle).
- `render_custom(cfg, token_id, fixed)`: `seed = token_seed(master, token_id)`; `traits = TraitSampler.draw(sub_rng(seed,"traits"), fixed)` (no DNA uniqueness, no quotas, no `exclude`); `name = proper_name(sub_rng(seed,"name"))` (not `unique_name`). This is the closest model for "live generation from a seed".

### 1.3 Grid, canvas and resolutions

`BrailleGrid(width, height, columns)`: `cell_w = width/columns`; `cell_h = 2*cell_w`; `rows = int(height // cell_h)` (Python float floor division); `step = cell_w/2` (dot pitch, px); `nx = 2*columns`; `ny = 4*rows`; `oy = (height - rows*cell_h)/2`.
`dot_uv()`: `x = (arange(nx)+0.5)*step`; `y = oy + (arange(ny)+0.5)*step`; `u = x/width*2 - 1`; `v = y/height*2 - 1`; `meshgrid(u, v)` (u varies along columns). `uv_step = 2*step/width`.
`snap(u, v)`: `i = clip(floor((u+1)/2*width/step), 0, nx-1)`; `j = clip(floor(((v+1)/2*height - oy)/step), 0, ny-1)`; returns `((i+0.5)*step/width*2 - 1, (oy + (j+0.5)*step)/height*2 - 1)`.

Values at 2048×2048 **[verified]** (full precision; port these formulas, don't hardcode):

| columns | dots nx×ny | text | step px | uv_step | snap(0,0) = galaxy centre (cx=cy) | dot_r px | glint_r px | glow σ (dots) / kernel radius |
|---|---|---|---|---|---|---|---|---|
| 192 (production) | 384×384 = 147 456 | 96 lines × 192 chars | 5.333333333333333 | 0.005208333333333333 | 0.0026041666666665186 | 2.0266666666666664 | 2.453333333333333 | 1.125/5, 3.375/14, 9.0/36 |
| 96 | 192×192 | 48 × 96 | 10.666666666666666 | 0.010416666666666666 | 0.005208333333333259 | 4.053333333333333 | 4.906666666666666 | 0.5625/2, 1.6875/7, 4.5/18 |
| 48 | 96×96 | 24 × 48 | 21.333333333333332 | 0.020833333333333332 | 0.010416666666666519 | 8.106666666666666 | 9.813333333333333 | 0.28125/1, 0.84375/3, 2.25/9 |
| 24 @256 px (unit tests) | 48×48 | 12 × 24 | 5.333333333333333 | 0.041666666666666664 | — | — | — | — |

`oy = 0.0` for all of these; `rows*cell_h` rounds to exactly 2048. The galaxy centre is snapped to the dot right/below the canvas centre (`+half a dot`), so it moves with the column count.

LOD consequences (Python has none; this is what `columns=96/48` does): u,v sample different points; every full-grid RNG array (`dither`, stars, …) has a different shape, so random values land on different dots; glint count is fixed (6–22) and crosses stay 3/5 dots; quasar spike and phenomenon line widths scale with `uv_step`; star counts scale with dot count (per-dot probabilities); glow radii stay constant in px. A Python reference for each LOD is `Config().with_render(braille={"columns": 96})` (keeps 2048 px). Deriving 96/48 from the 192 grid (pooling) would be a new design, not comparable to Python.

PNG: 2048×2048 RGB uint8 (`compose`), saved `compress_level=6`. Text: `to_text(on)`.

---

## 2. RNG

### 2.1 Seed derivation (`rng.py`, `plan.py`)

```
derive_seed(*parts) = int.from_bytes(sha256("\x1f".join(str(p) for p in parts).encode("utf-8")).digest()[:8], "big")
token_seed(master, i)  = derive_seed("token", master, i)          # i = generation index 1..supply (plan) or token id (render_custom)
sub_rng(seed, name)    = np.random.Generator(np.random.PCG64(derive_seed(seed, name)))
sub_seed32(seed, name) = derive_seed(seed, name) & 0xFFFFFFFF      # integer seed for noise hashing (no Generator)
plan._generator(*parts)= np.random.Generator(np.random.PCG64(derive_seed(*parts)))
```
`str(p)`: ints in decimal (64-bit seeds as full decimal, no sign issues: all ≥ 0), strings verbatim. Separator U+001F. Example: `derive_seed("token", 20261104, 1)` hashes the UTF-8 of `"token\x1f20261104\x1f1"`.

Stream names: `"traits"` (retries `"traits:1"`, `"traits:2"`, …), `"name"`, `"geometry"`, `"noise"` (32-bit), `"phenomenon"` (Generator **and** 32-bit), `"background"` (Generator **and** 32-bit), `"dither"`, `"stars"`, `"glints"`, `"postfx"`, `"science"`, `"coordinates"`. Plan-level: `derive_seed("quotas", master, trait)`, `derive_seed("shuffle", shuffle_seed)`, rarity sims `derive_seed("expected", master, simulations)`, placeholder `derive_seed("placeholder", master)`.

### 2.2 numpy seeding: `PCG64(int)` → SeedSequence → state **[verified]**

Generator = `np.random.Generator(np.random.PCG64(seed_int))` (modern Generator, not RandomState).

```
# SeedSequence(entropy=int), pool_size 4, no spawn key
words = little-endian uint32 limbs of entropy ([0] if entropy==0)       # 64-bit seeds -> 2 words (1 if < 2^32)
INIT_A=0x43b0d7e5 MULT_A=0x931e8875 INIT_B=0x8b51f9dd MULT_B=0x58f38ded MIX_MULT_L=0xca01f9dd MIX_MULT_R=0x4973f715
hc = INIT_A
hashmix(v): v ^= hc; hc = hc*MULT_A (mod 2^32); v = v*hc (mod 2^32); v ^= v >> 16; return v
mix(x,y):   r = (MIX_MULT_L*x - MIX_MULT_R*y) mod 2^32; r ^= r >> 16; return r
pool[i] = hashmix(words[i] if i < len(words) else 0)            for i in 0..3
for s in 0..3: for d in 0..3: if s != d: pool[d] = mix(pool[d], hashmix(pool[s]))
for s in 4..len(words)-1: for d in 0..3: pool[d] = mix(pool[d], hashmix(words[s]))     # never for 64-bit seeds
# generate_state(4, uint64): 8 uint32 words
hb = INIT_B
for i in 0..7: x = pool[i % 4]; x ^= hb; hb = hb*MULT_B; x = x*hb; x ^= x >> 16; out32[i] = x
s64[k] = out32[2k] | out32[2k+1] << 32                          # k = 0..3
# PCG64 seeding (pcg64_set_seed / pcg_setseq_128_srandom_r)
initstate = s64[0] << 64 | s64[1];  initseq = s64[2] << 64 | s64[3]
inc = (initseq << 1) | 1;  state = 0;  step();  state += initstate;  step();   has_uint32 = 0
```

### 2.3 PCG64 core **[verified]**

```
MULT = 0x2360ED051FC65DA44385DF649FCCF645          (high 2549297995355413924, low 4865540595714422341)
step():    state = (state*MULT + inc) mod 2^128
next64():  step(); hi = state>>64; lo = state & (2^64-1); x = hi ^ lo; rot = hi >> 58; return rotr64(x, rot)   # XSL-RR, output AFTER step
next32():  if has_uint32: has_uint32=0; return uinteger
           n = next64(); has_uint32 = 1; uinteger = n >> 32; return n & 0xFFFFFFFF          # low half first
next_double(): (next64() >> 11) * 2^-53                                                   # does not touch the 32-bit buffer
```
In TS: two BigInt or four 32-bit limbs for 128-bit state; `next_double` exact via `Number(x >> 11n) * 2**-53`.

### 2.4 Generator methods used, exact algorithms **[verified]**

| Call | Algorithm |
|---|---|
| `random()` / `random(shape)` | `next_double()` per element, C order |
| `uniform(lo, hi[, size])` | `range = float(hi) - float(lo)` (computed once in double); each = `lo + range*next_double()` |
| `integers(lo, hi)` / `integers(hi)` (dtype int64, `endpoint=False`) | `rng = hi-1-lo`; if `rng == 0`: return `lo` **without consuming**; if `rng == 0xFFFFFFFF`: `lo + next32()`; if `rng < 2^32`: Lemire-32: `excl = rng+1; m = next32()*excl (64-bit); left = m & 0xFFFFFFFF; if left < excl: thr = (0xFFFFFFFF - rng) % excl; while left < thr: m = next32()*excl; left = m & 0xFFFFFFFF`; return `lo + (m >> 32)`. (64-bit Lemire never reached here.) Arrays: same per element. |
| `choice(n, p=w)` (replace=True) | `cdf = cumsum(p)` (sequential); `cdf /= cdf[-1]`; `u = next_double()`; result = `searchsorted(cdf, u, side="right")` = number of `cdf[i] <= u`. **Consumes one double even when n == 1.** numpy validates `|sum(p)-1| <= sqrt(eps)`. |
| `choice([-1, 1])` (list, no p) | `[-1,1][integers(0, 2)]` → Lemire with rng=1 = top bit of one `next32()` |
| `permutation(n)` | `arr = arange(n)`; `for i = n-1 down to 1: j = random_interval(i); swap(arr[i], arr[j])` where `random_interval(max)`: `mask = smallest 2^k-1 ≥ max`; `do v = next32() & mask while v > max` (uses `next64()` if max > 2^32-1) — masked rejection, **not** Lemire |
| `choice(pool_array, size=k, replace=False)` (shuffle=True) | numpy uses Floyd's algorithm unless `pop > 10000 and k > pop//50` (tail-shuffle branch; unreachable here, k ≤ 17). Floyd: `set_size = int(1.2*k)`; `mask = smallest 2^m-1 ≥ set_size`; hash table of `mask+1` slots (empty = -1); `for j in pop-k .. pop-1: val = bounded(0..j)` (Lemire-32 inclusive; `j == 0` consumes nothing); linear-probe `loc = val & mask` while slot non-empty and ≠ val: `loc = (loc+1) & mask`; if slot empty: store val, `idx[j-pop+k] = val`; else: probe from `j & mask` to an empty slot, store j, `idx[...] = j`. Then `_shuffle_int`: `for i = k-1 down to 1: jj = bounded(0..i) (Lemire); swap(idx[i], idx[jj])`. Return `pool[idx]`. |
| `normal(0, grain, shape)` | only if `postfx.grain` is truthy; production `grain: 0.0` → **never called** (ziggurat not needed) |

### 2.5 Every RNG call, by stream, in consumption order

`traits` — `TraitSampler.draw`: for each trait in `draw_order` that applies, is not fixed and not forced: `choice(len(candidates), p=w/w.sum())` → 1 double.

`name` — `proper_name`: `random() < 0.55` → 3 syllables else 2; then repeat `SYLLABLES[integers(24)]` (Lemire 32-bit) appending only if ≠ previous syllable, until count reached; capitalise first char. `unique_name` repeats `proper_name` on the same stream until the name is not taken and not in the blocklist.

`quotas` (`derive_seed("quotas", master, trait)`, one Generator per quota trait): for each quota value in YAML order: `permutation(supply)` (fully generated before iterating).
`shuffle` (`derive_seed("shuffle", shuffle_seed)`): `permutation(supply)` (only if `shuffle.enabled`).

`geometry` — `build_params` (U = uniform):
1. `size = U(*visuals.size[traits.size])`
2. `tilt = U(*visuals.inclination[traits.inclination])` if `"inclination" in traits` else `U(*visuals.shape[galaxy_type])`
3. `angle = U(0, π)`; 4. `disk_scale = U(0.33,0.43)`; 5. `pitch = U(0.2,0.42)`; 6. `arm_sharpness = U(2.2,4.5)`; 7. `arm_amp = U(1.1,1.5)`; 8. `interarm = U(0.10,0.20)`; 9. `arm_warp = U(0.25,0.6)`; 10. `dust = U(0.35,0.6)`; 11. `dust_offset = U(0.5,0.9)`; 12. `core_dir = U(0, 2π)` — these 12 are drawn for every type.
13. type-specific:
   - barred_spiral: `bar_length U(0.2,0.3)`, `bar_width U(0.04,0.06)`, `bar_amp U(0.7,1.0)`, `pitch U(0.25,0.5)` (overrides 5).
   - elliptical: `random() < 0.35` → `n = integers(2,5)`; per shell `(U(0.35,0.8) radius, U(0,2π) phase)`; then `amp U(2.0,2.4)`, `k U(3.6,4.2)`, `exp U(0.55,0.68)`.
   - lenticular: `lens_radius U(0.25,0.4)`, `ring_amp U(0.0,0.25)`, `ring_radius U(0.5,0.65)`.
   - ring: `radius U(0.55,0.7)`, `width U(0.05,0.08)`, `amp U(1.0,1.4)`, `spokes integers(5,10)`, `spoke_amp U(0.04,0.12)`, `core_offset = (U(-0.08,0.08), U(-0.05,0.05))`.
   - irregular/dwarf: `n = integers(3,8)`; per knot `(U(-0.5,0.5) kx, U(-0.4,0.4) ky, U(0.03,0.07) radius, U(0.3,0.9) amp)`; `ox U(-50,50)`, `oy U(-50,50)`, `env_dx U(-0.15,0.15)`, `env_dy U(-0.15,0.15)`, `env_radius U(0.38,0.5)`; `kind = "irregular" if type=="irregular" or random()<0.4 else "spheroidal"` (**`random()` only drawn for dwarf**, short-circuit).
   - merger: `a_scale U(0.58,0.66)`, `b_scale U(0.42,0.52)`, `a_angle U(-0.6,0.6)`, `b_angle U(0.8,2.4)`, `b_tilt U(0.4,0.9)`, `a_pitch U(0.3,0.45)`, `b_pitch U(0.3,0.5)`, `b_kind = "elliptical" if random()<0.35 else "spiral"`, `b_amp U(0.8,1.1)`, `tail_a_angle = π + U(-0.5,0.5)`, `tail_sweep U(1.2,1.9)`, `tail_length U(0.6,0.85)`, `n = integers(6,11)`; per burst `(integers(0,3) path, U(0.15,0.85) pos, U(0.5,1.0) amp, U(0.012,0.022) radius)`. Constants `a_offset=(-0.24,0.05)`, `b_offset=(0.26,-0.07)`.
   - spiral: nothing more.

`phenomenon` (only one consumer per token):
- satellite_galaxy: `rho U(0.60,0.74)`, `theta U(0,2π)`, `size U(0.17,0.24)`, `angle U(0,π)`, `tilt U(0.55,1.0)`, `random() < 0.5` (spiral_share) → if spiral `pitch U(0.3,0.45)`.
- globular_cluster: `n = integers(5, 11)`; per cluster `rho = min(p.size*U(0.45,1.05), 0.84)`, `theta U(0,2π)`, `rc U(0.008,0.013)`.
- supernova: `r U(0.25,0.60)`, `phi U(0,2π)`, `length U(0.38,0.52)`, `shell U(0.070,0.095)`.
- comet: `rho U(0.40,0.58)`, `theta U(0,2π)`, `s1 = choice([-1,1])`, `U(-0.35,0.35)`, `length U(0.50,0.70)`, `U(0.08,0.18)`, `s2 = choice([-1,1])` (Python evaluates the left operand of `*` first).
- relativistic_jets: `U(-0.35,0.35)`, `length U(0.55,0.80)`, `lobe_r U(0.05,0.08)`, `n = integers(3,6)`, `knots = U(0.15,0.85, n)`.
- pulsar: `rho U(0.50,0.72)`, `theta U(0,2π)`, `axis U(0,π)`, `opening U(0.06,0.10)`, `length U(0.30,0.42)`, `spacing U(0.045,0.060)`, `n = integers(3, 6)` (rings 3..5).
- einstein_ring: `radius = p.size*U(0.40,0.55)`, `axis U(0,π)`, `squash U(0.85,1.0)`, `count = integers(2, 5)`, `base U(0,2π)`, `jit = U(-0.3,0.3, count)`.
- anomaly (`glitch`, after stars and glints): `nb = integers(3, 7)`; per band: `r0 = integers(0,rows)`, `h = integers(1,7)`, `m = integers(3,30)`, `sg = choice([-1,1])`, `random() < 0.5` (swap channels). `nk = integers(2, 5)`; per block: `r0 = integers(0,rows)`, `c0 = integers(0,cols)`, `h = integers(1,4)`, `w = integers(4,20)`, `random(shape of the CLIPPED slice) < 0.6`. `nl = integers(1,4)`; per lost row `integers(0,rows)`. Then `row = integers(0, ny)`, `line = random(nx) < 0.7`. (`rows = ny//4`, `cols = nx//2`.)

`background`: per distant galaxy (`spec.distant_galaxies`: starfield 4, cosmic_web 10, others 0): `(cx, cy) = U(-0.92,0.92, 2)`, `a = U(0.010,0.022)`, `b = a*U(0.35,0.8)`, `ang = U(0,π)`.

`dither`: `random((ny, nx))`.

`stars` (one stream, two consumers): `background_stars`: `random(shape)` (mask), `random(shape)` (brightness), `uniform(3200, 14000, shape)`; then `galaxy_stars`: `random(shape)` (mask), `uniform(0, 1500, shape)`, `random(shape)` (brightness), and **only if** `palette.detail` and `detail_stars > 0` (amber_crt): `random(shape)` (pick). All full-grid, always drawn regardless of probabilities.

`glints`: `choice(on_galaxy, size=min(count-n_bg, len), replace=False)` (if pool non-empty and n>0), then `choice(off_galaxy, size=min(n_bg, len), replace=False)` (same condition), then one `random()` per pick, in pick order (after both choices).

`postfx`: `normal(...)` only if grain ≠ 0 (never in production).
`science`: `U(log 8, log 4200)` → exp; `U(*age_range)`; `U(log lo, log hi)` → exp.
`coordinates`: `U(13.6, 15.2)` (RA h), `U(29.0, 47.0)` (Dec °).
`noise`, `phenomenon`, `background` 32-bit seeds feed `noise._hash` only.

### 2.6 Non-numpy randomness and ordering hazards

- Python `random`: only `validate.py` (`random.SystemRandom().sample` to pick tokens for the determinism re-render). Does not affect outputs. No `hash()` of objects; no `PYTHONHASHSEED` dependence.
- `set`s (`seen`, `taken`, `exclude`, `blocklist`) are used only for membership tests. No set iteration order reaches any output.
- `dict` order = YAML insertion order and **does** matter: order of trait values (candidate/cdf order), rule order (first matching `force` wins), quota trait/value order, merged postfx dicts. In JS, plain-object keys that look like integers are reordered (`"2".."6"` for `arms` happen to be ascending already) — use `Map`/arrays from an order-preserving YAML parser.
- YAML: keys like `none` stay strings in PyYAML (YAML 1.1 null is only `~/null/Null/NULL`); all hex colours are quoted strings; `arms` keys are quoted strings.

### 2.7 RNG test vectors **[verified]**

- `token_seed(20261104, 1)` = 8592738875135951460. `derive_seed('a', 1)` = 9484037261928657086.
- With s = 8592738875135951460: `derive_seed(s, n)` / `sub_seed32`: traits 12095904573190017021 / 1510182909; geometry 3529837714663881650 / 424754098; noise 11731334907893429220 / 2250290148; phenomenon 6461797495541366334 / 205553214; background 1300588402162593819 / 3454332955; dither 8292007415504644312 / 3155110104; stars 5437318965537067038 / 2136264734; glints 13965408249295388584 / 2458894248; postfx 9385502948116476696 / 1826435864; name 8626118830146539447 / 1966165943; science 3131586298534714177 / 2342804289; coordinates 3686928904348507961 / 3889176377.
- `PCG64(3529837714663881650)`: state after seeding = 278106903930041210533212072556057723678, inc = 112189075521776727329362978364026886271; `random_raw(3)` = 0x989aa40cdfa5786a, 0x691d8ae7597f4ed2, 0x2f9bf86a7025dbb7; `random(3)` = 0.5961096316747411, 0.4106070341890674, 0.18597366903863788.
- `PCG64(0).random_raw(2)` = 0xa30febcfd9c2825f, 0x4510bdf882d9d721. `Generator(PCG64(12345)).random(2)` = 0.22733602246716966, 0.31675833970975287.

---

## 3. Traits, DNA, numeric attributes, rarity

### 3.1 `TraitSampler.draw(rng, fixed=None, exclude=None)` (exact)

```
fixed = {k: str(v)}; exclude = exclude or {}; chosen = {}
for key in draw_order:                      # galaxy_type, arms, size, inclination, core, star_density, palette, background, phenomenon
    spec = traits[key]; context = {**fixed, **chosen}
    if not matches(spec.requires, context): continue          # trait absent (also drops a fixed value for it)
    if key in fixed: value = fixed[key] (ValueError if unknown)
    elif (f := forced(key, context)) is not None: value = f   # no RNG
    else:
        cands = [v for v in allowed_values(key, context) if v not in exclude.get(key, ())]   # YAML order
        if not cands: ValueError
        w = float64 array of cands' weights
        value = cands[rng.choice(len(cands), p = w / w.sum())]
    chosen[key] = value
matches(cond, ctx)      = cond empty or all(ctx.get(k) in allowed for k, allowed in cond.items())
allowed_values(key,ctx) = [v for v, s in values.items() if matches(s.requires, ctx) and not forbidden(key, v, ctx)]
forbidden(key, v, ctx)  = any rule.forbid with key in forbid and v in forbid[key]
                          and all(ctx.get(k) in allowed for other k in forbid)          # absent key -> None -> not forbidden
forced(key, ctx)        = first rule.force with key in force.set and all(ctx.get(k) == v for k,v in force.when) -> force.set[key]
```
Semantics: there is no actual re-draw loop; the YAML comment's "re-draw the last implied trait" is achieved by filtering candidates of the later trait at its draw time. Because `context` includes `fixed`, a fixed later trait can restrict an earlier draw (e.g., fixed `size: large` removes `dwarf`). Weights are integers, so `w.sum()` is exact and `p`/`cumsum` reproduce exactly in JS. `force` is not re-checked against `forbid`/`requires`. `violations(chosen)` reports trait-level requires, value-level requires, forbids and unmet forces (used for quotas and validation).

### 3.2 Rules (traits.yaml, verbatim semantics)

- `arms` requires `galaxy_type ∈ {spiral, barred_spiral}`; `inclination` requires `galaxy_type ∈ {spiral, barred_spiral, lenticular, ring}`; value `phenomenon.relativistic_jets` requires `core ∈ {quasar}`.
- forbid: {dwarf}×{large, colossal}; {dwarf}×core{quasar, double_nucleus}; {merger}×size{compact}; {merger}×phenomenon{satellite_galaxy}; {ring}×inclination{edge_on}; {dwarf}×phenomenon{einstein_ring}.
- force: `when palette=antimatter → background=deep_void`.

### 3.3 DNA

`dna(traits) = sha256_hex("|".join(f"{k}={traits[k]}" for k in draw_order if k in traits))`, lowercase hex. Example canonical string: `galaxy_type=elliptical|size=large|core=bright|star_density=normal|palette=crimson_nebula|background=nebular_dust|phenomenon=none`.

### 3.4 Collection plan (`plan_collection`)

1. `seeds[i] = token_seed(master, i)` for i = 1..supply (1000), master 20261104.
2. Per seed: attempt 0 → `draw(sub_rng(seed,"traits"), exclude={phenomenon: {einstein_ring, anomaly}})`; if DNA already seen, retry with `sub_rng(seed, f"traits:{attempt}")`. Add DNA to `seen`.
3. Quotas (`collection.yaml rarity.quotas`: phenomenon from `none`: einstein_ring 12, anomaly 3, in that order): `rng = _generator("quotas", master, "phenomenon")`; per value: iterate `rng.permutation(supply)`; for index i with `drawn[i].phenomenon == "none"`, candidate = traits with phenomenon replaced (same key position); accept if no `violations` and DNA unseen; update `seen`; stop at count; error if short.
4. Names, in generation order: `unique_name(sub_rng(seed,"name"), taken, blocklist)`.
5. Shuffle (enabled): `perm = _generator("shuffle", 1104202611).permutation(supply)`; generation position i → `token_id = first_token_id(1) + perm[i]`; `designation = "GX-{id:04d}"`. Sorted by token_id. Example: token #1 = generation index 973, seed 1847109058257526444, name "Kathra", DNA `696d2990…cc9d`, spiral/3 arms/large/tilted/quasar/dense/andromeda_blue/starfield/relativistic_jets.

### 3.5 Numeric ("science") attributes (`science.py`, stream `science`, not used in rendering)

`distance_mly = exp(U(ln 8, ln 4200))`; `age_gyr = U(*ranges[galaxy_type])` (spiral 4–11, barred 5–12, elliptical 9–13.4, lenticular 8–13, irregular 0.8–6, ring 3–9, dwarf 1–10, merger 2–12); `stars = exp(U(ln lo, ln hi))` with range by size (compact 1–40, medium 40–200, large 200–600, colossal 600–2000; dwarf override 0.01–5); `abs = 4.83 - 2.5*log10(stars*1e9*0.3)`; `apparent = abs + 5*log10(distance*(1e6/3.2616)/10)`. Rounding: decimals 0 → `int(round(x))`; else `round(x, d if x >= 1 else 2)` (Python round: exact decimal of the double, ties-to-even; JS `toFixed` breaks exact ties upward). Decimals: distance 0, others 1. Coordinates: stream `coordinates`, RA `U(13.6,15.2)` h, Dec `U(29,47)`°.

### 3.6 Rarity (information content)

`counts[key][value]` over the whole plan for every key in draw_order, missing trait counted as value `"—"` (U+2014). `score(token) = Σ_key -log2(count[key][value or "—"] / n)` (Python `math.log2`, summed in draw_order). Rank: sort by `(-round(score, 9), token_id)` (rank 1 = rarest). Tiers from the rarest: legendary `round(0.03n)`=30, epic 70, rare 150, uncommon 250, common = rest (500). `expected_counts` simulates 20 000 draws with `Generator(PCG64(derive_seed("expected", master, 20000)))`. Rarity never affects pixels. (The game plans calibrated bands instead.)

---

## 4. Config schemas

### 4.1 `collection.yaml` (render-relevant parts)

```
collection: {supply: 1000, first_token_id: 1}
seeds: {master: 20261104, shuffle: 1104202611}
render: {width: 2048, height: 2048, format: png, background_color: "05060A", blackbody_mix: 0.3, density_gain: 1.55,
         braille: {columns: 192, dot_radius: 0.19, glint_radius: 0.23, dither: "bayer4" (UNUSED), dither_jitter: 0.25, min_density: 0.035}}
postfx: {glow: {enabled: true, strength: 1.0, radii: [6, 18, 48], weights: [0.45, 0.30, 0.22]}, vignette: 0.35, grain: 0.0,
         scanlines: false, chromatic_aberration: 0}
rarity: {quotas: {phenomenon: {from: none, values: {einstein_ring: 12, anomaly: 3}}}, tiers: [...shares 0.50/0.25/0.15/0.07/0.03]}
shuffle: {enabled: true}
```
Unused by code: `render.braille.dither`, `pfp.*`, `rarity.method`, `rarity.include_numeric`, `collection.reserved`, `metadata_language`.

### 4.2 `traits.yaml`

Schema: `draw_order: [keys]`; `traits.<key>: {label, requires?: {trait: [values]}, values: {<value>: {name, weight, requires?}}}`; `rules: [{forbid: {trait: [values], ...}} | {force: {when: {trait: value}, set: {trait: value}}}]`; `numeric.<key>: {label, decimals, distribution?, range?, by?, ranges?, overrides?, derived?}`.

Weights (YAML order = candidate order):
- galaxy_type: spiral 30, barred_spiral 22, elliptical 16, lenticular 10, irregular 10, ring 6, dwarf 4, merger 2
- arms: "2" 40, "3" 25, "4" 20, "5" 10, "6" 5
- size: compact 20, medium 40, large 28, colossal 12
- inclination: face_on 50, tilted 38, edge_on 12
- core: faint 28, bright 47, quasar 18, double_nucleus 7
- star_density: sparse 20, normal 45, dense 25, saturated 10
- palette: andromeda_blue 16, terminal_green 14, solar_gold 13, crimson_nebula 11, emerald_void 10, amber_crt 9, ultraviolet 8, neon_synapse 7, monochrome 6, prismatic 4, antimatter 2
- background: deep_void 30, starfield 35, nebular_dust 18, cosmic_web 12, cmb 5
- phenomenon: none 740, supernova 55, satellite_galaxy 55, globular_cluster 50, comet 35, relativistic_jets 90 (requires core quasar), pulsar 20, einstein_ring 12, anomaly 3 (last two excluded from random plan draws, assigned by quota)

### 4.3 `palettes.yaml` and colour code (`color.py`)

Schema per palette: `stops: [hex…]` (low→high density), `accent: hex`, optional `mode: normal|angular|inverted`, `background: hex` (default `render.background_color`), `blackbody_mix` (default 0.3), `detail: {color, regions, halo, stars}`, `postfx: {…}` (overrides global postfx).

| palette | stops | accent | extras |
|---|---|---|---|
| andromeda_blue | 0A1633 1B4A8A 3A8BDB 9DD2FF F3FBFF | FFD59E | |
| terminal_green | 021407 06501B 12A23A 59F57A E4FFE9 | F2FFF4 | blackbody_mix 0.0 |
| solar_gold | 1E1204 6A460A D9A11C FFD447 FFF7D6 | 8FE3FF | |
| crimson_nebula | 22050D 661030 C2244B FF6B7A FFE4E7 | FFF0C2 | |
| emerald_void | 02191A 0A5246 179C78 6CF0C0 E8FFF7 | D6B4FF | |
| amber_crt | 160A1E 4A1630 B3440A FF9A1A FFE0A0 | 7FF4FF | blackbody_mix 0.0; detail {color 2FE0CF, regions 0.8, halo 0.6, stars 0.3}; postfx {chromatic_aberration: 2, scanlines: {period: 2, depth: 0.18}} |
| ultraviolet | 12082A 431A85 8538F5 C79CFF F6EEFF | 7DF9FF | |
| neon_synapse | 12031F 6A0F5C FF2E97 2EE6FF EFFFFF | FFF35C | |
| monochrome | 101215 383D45 7B838E C4CAD2 FFFFFF | FFFFFF | blackbody_mix 0.0 |
| prismatic | FF3D7F FF9F1C F7F052 2EC4B6 5B5FEF B14AED | FFFFFF | mode angular |
| antimatter | C9C3B8 8A8296 4B3F6B 1E1338 07030F | D4004C | mode inverted; background ECE8DF; blackbody_mix 0.0 |

Colour code:
```
hex_to_srgb(h) = [int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)] / 255.0        (float64)
srgb_to_linear(c) = c/12.92 if c <= 0.04045 else ((c+0.055)/1.055) ** 2.4
linear_to_srgb(c) = clip(c,0,1); c*12.92 if c <= 0.0031308 else 1.055*c**(1/2.4) - 0.055
hex_to_linear(h) = float32(srgb_to_linear(hex_to_srgb(h)))
M1 = [[0.4122214708,0.5363325363,0.0514459929],[0.2119034982,0.6806995451,0.1073969566],[0.0883024619,0.2817188376,0.6299787005]]
M2 = [[0.2104542553,0.7936177850,-0.0040720468],[1.9779984951,-2.4285922050,0.4505937099],[0.0259040371,0.7827717662,-0.8086757660]]
M2_INV = [[1.0,0.3963377774,0.2158037573],[1.0,-0.1055613458,-0.0638541728],[1.0,-0.0894841775,-1.2914855480]]
M1_INV = [[4.0767416621,-3.3077115913,0.2309699292],[-1.2684380046,2.6097574011,-0.3413193965],[-0.0041960863,-0.7034186147,1.7076147010]]
linear_to_oklab(rgb) = cbrt(rgb @ M1.T) @ M2.T ;  oklab_to_linear(lab) = ((lab @ M2_INV.T) ** 3) @ M1_INV.T
gradient_lut(stops_lin, cyclic): labs = oklab(stops) (float64); if cyclic: labs.append(labs[0]); n = len(labs)-1
    x[k] = (k*(1/1023) for k<1023, 1.0 for k=1023) * n ; i = min(floor(x), n-1); f = x - i
    LUT[k] = float32(max(oklab_to_linear(labs[i]*(1-f) + labs[i+1]*f), 0))
Palette: lut = gradient_lut(stops), lut_cyclic = gradient_lut(stops, cyclic=True); accent/background/detail = hex_to_linear
sample(x)        = lut[rint(clip(x,0,1)*1023)]          # rint = round half to even
sample_cyclic(x) = lut_cyclic[rint(mod(x,1.0)*1023)]     # numpy mod: fmod, +1 if result < 0
luminance(rgb)   = rgb @ float32[0.2126, 0.7152, 0.0722]
blackbody_linear(T): t = T/100 (float64)
    r = 255 if t <= 66 else 329.698727446 * max(t-60,1e-6) ** -0.1332047592
    g = 99.4708025861*ln(t) - 161.1195681661 if t <= 66 else 288.1221695283 * max(t-60,1e-6) ** -0.0755148492
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231*ln(max(t-10,1e-6)) - 305.0447927307)
    lin = srgb_to_linear(clip([r,g,b],0,255)/255); return float32(lin / max(max_channel(lin), 1e-6))
```
**[verified]** the 11×2 LUTs (67 584 float32 values) are reproduced exactly by naive scalar float64 code (left-to-right dot products, `np.cbrt`, `**3`), so BLAS/FMA did not affect them here. In JS, `Math.cbrt`/`Math.pow` may differ by an ulp; either verify or ship the LUTs as data. Test vectors: andromeda_blue `lut[0]=[0.0030352703761309385,0.00802319310605526,0.03310476243495941]`, `lut[511]=[0.04221983253955841,0.25764530897140503,0.7071765065193176]`, `lut[1023]=[0.8962694406509399,0.9646862149238586,0.9999997615814209]`, `cyclic[700]=[0.5375626683235168,0.7721347212791443,1.0054113864898682]`, accent `[1.0,0.6653872728347778,0.34191441535949707]`, default bg `[0.0015176349552348256,0.0018211619462817907,0.0030352699104696512]`. blackbody 3200/5000/6600/12000/14000 K = `[1,0.4771154522895813,0.19848378002643585]`, `[1,0.7759183645248413,0.6167382001876831]`, `[1,1,1]`, `[0.5216012597084045,0.654849112033844,1]`, `[0.47882527112960815,0.6236206889152527,1]`.

### 4.4 `visuals.yaml` (verbatim numbers)

```
size:        compact [0.56,0.63]  medium [0.70,0.78]  large [0.84,0.92]  colossal [0.98,1.08]     # radius, 1 = canvas edge
inclination: face_on [0.82,1.00]  tilted [0.45,0.68]  edge_on [0.13,0.20]                          # axis ratio (tilt)
shape:       elliptical [0.45,1.00]  irregular [0.60,1.00]  dwarf [0.60,1.00]  merger [0.55,0.95]
core:        faint {amplitude 0.55, radius 0.060}   bright {1.35, 0.075}
             quasar {1.10, 0.060, point 6.0, spikes 0.30}   double_nucleus {1.15, 0.050, separation 0.090}
core_scale:  spiral 1.0 barred_spiral 1.0 elliptical 0.6 lenticular 0.9 irregular 0.45 ring 0.9 dwarf 0.5 merger 0.9
star_density: sparse {gain 0.80, stars 0.010, glints 6}  normal {1.00, 0.020, 10}  dense {1.20, 0.035, 15}  saturated {1.45, 0.055, 22}
background:  deep_void {stars 0.0010, level 0.00, brightness 0.0}
             starfield {0.0045, 0.00, 0.0, distant_galaxies 4}
             nebular_dust {0.0025, 0.50, 0.17}
             cosmic_web {0.0020, 0.55, 0.22, distant_galaxies 10}
             cmb {0.0015, 0.34, 0.11}
phenomenon:
  supernova:        distance [0.25,0.60] (× size, disk radius)  spike_length [0.38,0.52]  shell_radius [0.070,0.095]  brightness 8.0
  satellite_galaxy: distance [0.60,0.74]  size [0.17,0.24]  spiral_share 0.5  amplitude 1.0
  globular_cluster: count [5,10]  distance [0.45,1.05] (× size)  radius [0.008,0.013]
  comet:            distance [0.40,0.58]  length [0.50,0.70]
  relativistic_jets: length [0.55,0.80]  lobe_radius [0.05,0.08]
  pulsar:           distance [0.50,0.72]  beam_length [0.30,0.42]  ring_spacing [0.045,0.060]  rings [3,5]
  einstein_ring:    radius [0.40,0.55] (× size)  width 0.010  arcs [2,4]
  anomaly:          bands [3,6]  blocks [2,4]  postfx {chromatic_aberration: 6}
```
Ranges `[a,b]` with `integers` are inclusive via `integers(a, b+1)` (count, rings, arcs, bands, blocks).

---

## 5. Rendering math

### 5.0 Conventions

- Screen coords u,v ∈ [-1,1] at dot centres (v down). Galaxy centre `(cx, cy) = grid.snap(0,0)`.
- `smoothstep(a,b,x)`: `t = clip((x-a)/(b-a), 0, 1); return t*t*(3-2*t)` (works with a > b, e.g. placeholder).
- `make_frame(u,v,cx,cy,size,angle,tilt,floor=0.65)`: `su=(u-cx)/size; sv=(v-cy)/size; ca,sa=cos(angle),sin(angle); xs=ca*su+sa*sv; ys=-sa*su+ca*sv; y=ys/tilt; yb=ys/max(tilt,floor)` → `Frame(x=xs, y=y, r=hypot(xs,y), th=atan2(y,xs), yb=yb, rb=hypot(xs,yb), ys=ys)`.
- `gaussian_blob(x,y,cx,cy,R) = exp(-((x-cx)**2 + (y-cy)**2) / (R*R))`.
- Array `a ** 2` is `a*a`; array `** k` for any other k (3, 4, 6, 10, 14, 1.2, …) is `pow`; Python-scalar `s ** 2` is `pow` (UCRT) — see §8.

### 5.1 `build_params(traits, seed, visuals, center) → GalaxyParams`

Fields (defaults in brackets): `type, size (= U(size)*0.88 for dwarf), angle, tilt, cx, cy, arms (= int(traits.arms or 0)), gain (= star_density.gain), noise_seed (= sub_seed32(seed,"noise")), disk_scale [0.32], pitch [0.3], arm_sharpness [3.0], arm_amp [1.3], interarm [0.15], arm_warp [0.4], dust [0.5], dust_offset [0.7], bar_length [0.25], bar_width [0.05], bar_amp [0.85], core_kind (= traits.core), core (= visuals.core[core] dict), core_scale (= visuals.core_scale[type]), core_dir, core_offset [(0,0)], extra [{}]`. RNG order in §2.5. Golden dumps for 8 types are in Appendix A.

### 5.2 `galaxy_field(u, v, p, density_gain=1.55, dot_step=uv_step, extra=matter)`

```
seed = p.noise_seed
if merger: d, young, f = merger(u, v, p, seed)
else:
    f = make_frame(u, v, p.cx, p.cy, p.size, p.angle, p.tilt)
    d, young = DISK_GEOMETRIES[p.type](f, p, seed)
    if p.type in (spiral, barred_spiral, lenticular) and p.tilt < 0.3:          # edge-on dust lane (edge_on only)
        lane = exp(-(f.ys / (0.03 + 0.04*p.tilt)) ** 2)
        d *= 1 - 0.75*lane*(0.4 + 0.6*ss(0.0, 0.12, |f.x|))
d = d + core_density(f, p)
if extra: d = d + extra.d; young = young + extra.young
if p.core_kind == "quasar": d += quasar_spikes(u, v, p, dot_step)
d *= p.gain
d *= 1 - ss(0.9, 1.05, hypot(u, v))                       # nothing touches the canvas edge
t = 1 - exp(-density_gain * d)
return GalaxyField(t, clip(young,0,1), theta=f.th, radius=f.r)
```
`core_density(f, p)`: `amp = core.amplitude*core_scale; rad = core.radius; x = f.x - core_offset[0]; yb = f.yb - core_offset[1]`;
double_nucleus: `half = separation/2; dx = half*cos(core_dir); dy = half*sin(core_dir); d = amp*(exp(-((x-dx)**2 + (yb-dy)**2)/rad**2) + 0.85*exp(-((x+dx)**2 + (yb+dy)**2)/rad**2))`;
else: `rb = hypot(x, yb); d = amp*exp(-(rb/rad)**2) + 0.35*amp*exp(-rb/(rad*2.5))`;
quasar additionally: `d += core.point * exp(-(hypot(x, yb)/0.012)**2)`. (`rad**2` is a scalar pow: 0.060→0.0036, 0.075→0.005625, 0.050→0.0025000000000000005.)
`quasar_spikes(u,v,p,dot_step)`: `du=u-p.cx; dv=v-p.cy; L = core.spikes*p.size; w = dot_step*0.65; 2.0*(exp(-3*|du|/L)*exp(-(dv/w)**2) + exp(-3*|dv|/L)*exp(-(du/w)**2))` — centred at `(p.cx, p.cy)`, axis-aligned (also for mergers, where the nucleus is elsewhere).

### 5.3 Per galaxy type (`d`, `young` on the frame `f`)

**spiral / barred_spiral** (`spiral(f, p, seed, barred)`):
```
warp  = (fbm(f.x*1.6 + 3.1, f.y*1.6 - 7.4, seed+11, 4) - 0.5) * 2 * p.arm_warp
r0    = p.bar_length*0.95 if barred else 0.06
phase = p.arms * (f.th + warp - log((f.r + 0.015)/r0) / p.pitch)              # log spiral r = r0·e^(θ·pitch)
arm   = ((1 + cos(phase))*0.5) ** p.arm_sharpness
if barred: arm *= ss(p.bar_length*0.55, p.bar_length*1.15, f.r)
clump = fbm(f.x*4.5, f.y*4.5, seed+23, 5)
dust  = ((1 + cos(phase - p.dust_offset))*0.5) ** 14 * ss(0.08, 0.25, f.r)
disk  = exp(-f.r/p.disk_scale);  arm_env = exp(-f.r/(p.disk_scale*1.3))
d     = (disk*p.interarm + arm_env*p.arm_amp*arm*(0.35 + 1.15*clump)) * (1 - p.dust*dust)
if barred: bar = exp(-(f.x/p.bar_length)**2 - (f.y/p.bar_width)**2); d += p.bar_amp*bar*(0.75 + 0.5*clump)
d    *= 1 - ss(0.82, 1.08, f.r)
young = arm*clump*ss(0.12, 0.35, f.r)
```
**elliptical**: `n = fbm(f.x*2.2, f.y*2.2, seed+5, 4); d = amp*exp(-k*f.r**exp)*(0.9+0.2n)`; per shell `(R, ph)`: `side = ss(-0.2, 0.6, cos(f.th - ph)); d += 0.09*exp(-((f.r-R)/0.022)**2)*side*(0.6+0.8n)`; `d *= 1 - ss(0.85, 1.1, f.r)`; `young = 0`.
**lenticular**: `n = fbm(f.x*2.6, f.y*2.6, seed+9, 4); disk = 0.85*exp(-f.r/disk_scale)*(0.92+0.16n); lens = 0.32*exp(-(f.r/lens_radius)**4); ring = ring_amp*exp(-((f.r-ring_radius)/0.05)**2)*(0.7+0.6n); d = (disk+lens+ring)*(1-ss(0.82,1.05,f.r))`; `young = 0`.
**ring**: `n = fbm(f.x*3.5 + 2.0, f.y*3.5 - 1.0, seed+7, 5); band = exp(-((f.r-R)/W)**2); knots = band*(0.25 + 1.5*n**1.6); spokes = ((1 + cos(S*f.th + 3*(n-0.5)))*0.5)**10; spokes *= ss(0.12,0.3,f.r)*(1 - ss(R-0.14, R-0.03, f.r)); inner = 0.12*exp(-f.r/0.25); d = amp*knots + spoke_amp*spokes + inner; d *= 1 - ss(R+0.15, R+0.35, f.r); young = knots*n` (R=radius, W=width, S=spokes). Ring has `core_offset`.
**irregular** (`amplitude=1.0`): `w = warped_fbm(f.x*1.8 + ox, f.y*1.8 + oy, seed+3, strength=0.7, octaves=5); env = exp(-((f.x-env_dx)**2 + (f.y-env_dy)**2)/(2*env_radius**2)); cloud = env*ss(0.32,0.8,w)**1.4*(0.6+0.8w); knots = Σ_k amp_k*gaussian_blob(f.x,f.y,kx,ky,R_k)` (sequential sum from zeros in knot order); `d = amplitude*(1.6*cloud + knots); young = clip(knots*1.5 + cloud*0.6, 0, 1)`. (`env_radius**2` is a scalar pow.)
**dwarf**: kind irregular → `irregular(f,p,seed, amplitude=0.6)`; spheroidal → `w = warped_fbm(f.x*2.0, f.y*2.0, seed+5, strength=0.4, octaves=4); d = 0.55*exp(-(f.r/0.5)**2)*(0.7+0.6w); young = 0`. Size was multiplied by 0.88.
**merger** (`merger(u, v, p, seed)`, works in screen coords):
```
ca, sa = cos(p.angle), sin(p.angle)
place(o): ox = o[0]*p.size; oy = o[1]*p.size; return (p.cx + ca*ox - sa*oy, p.cy + sa*ox + ca*oy)
a_pos = place(a_offset); b_pos = place(b_offset)
fa = make_frame(u,v,*a_pos, p.size*a_scale, p.angle + a_angle, p.tilt)
d_a, y_a = spiral(fa, p with {arms:2, pitch:a_pitch, arm_warp:0.7}, seed)
fb = make_frame(u,v,*b_pos, p.size*b_scale, p.angle + b_angle, b_tilt)
if b_kind == elliptical: d_b, y_b = elliptical(fb, p with extra {amp:1.6, k:3.3, exp:0.6, shells:[]}, seed+101)
else:                    d_b, y_b = spiral(fb, p with {arms:2, pitch:b_pitch, arm_warp:0.8}, seed+101)
d_b = d_b + 0.7*exp(-(hypot(fb.x, fb.yb)/0.08)**2)                 # B nucleus; A nucleus comes from core_density on fa
_tail(origin, ang0, sweep, length, steps=140): s = linspace(0,1,140); rho = (0.12 + length*s)*p.size; phi = ang0 + sweep*s
      lx = rho*cos(phi); ly = rho*sin(phi)*0.75; pts = (origin.x + ca*lx - sa*ly, origin.y + sa*lx + ca*ly)
      widths = (0.025 + 0.06*s)*p.size; amps = 0.6*(1-s)**0.9 + 0.06
tail_a = _tail(a_pos, tail_a_angle, tail_sweep, tail_length); tail_b = _tail(b_pos, tail_a_angle + π, tail_sweep, tail_length*0.85)
s = linspace(0,1,60); bend = (-(b.y - a.y), b.x - a.x)*0.25; bridge_pts = (1-s)*a + s*b + sin(π*s)*bend
bridge = (bridge_pts, widths 0.03*p.size, amps 0.22)
_stream(pts, w, a) = running max over points of a*exp(-((u-px)**2 + (v-py)**2)/(2*w*w))
streams = max(stream(tail_a), stream(tail_b), stream(bridge)) * (0.3 + 1.2*fbm(u*7.0, v*7.0, seed+31, 5)**1.5)
bursts  = Σ amp*exp(-((u-bx)**2 + (v-by)**2)/(r*r)), (bx,by) = paths[path][int(pos*(len(path)-1))], r = radius*p.size
          paths = (tail_a points, tail_b points, bridge_pts)
halo    = 0.12*exp(-((u-mx)**2 + (v-my)**2)/(0.5*p.size)**2), (mx,my) = midpoint(a_pos, b_pos)     # scalar pow
d = d_a + d_b*b_amp + streams + bursts + halo;   young = clip(y_a + y_b + streams*0.8 + bursts*1.5, 0, 1);   frame = fa
```
`linspace(0,1,N)[k] = k*(1/(N-1))`, last element exactly 1.0. `p with {...}` = `GalaxyParams(**{**p.__dict__, ...})` (all other params copied, e.g. arm_sharpness, interarm, dust).

### 5.4 `noise.py` (exact)

```
_hash(ix, iy, seed):   # ix, iy int64 -> wrap to uint32; all products mod 2^32
    h  = u32(ix) * 0x165667B1
    h += u32(iy) * 0x27D4EB2F
    h += (seed * 0x9E3779B1) & 0xFFFFFFFF        # Python big int; seed may exceed 2^32 (seed + k): reduce seed mod 2^32 first
    h ^= h >> 15; h *= 0x85EBCA77; h ^= h >> 13; h *= 0xC2B2AE3D; h ^= h >> 16
    return h * 2^-32                              # float64 in [0,1)
  TS: Math.imul for products, >>> 0 to unsigned; (seed mod 2^32) then Math.imul(s, 0x9E3779B1).
value_noise(x, y, seed):
    fx0 = floor(x); fy0 = floor(y); fx = x - fx0; fy = y - fy0; ix = int(fx0); iy = int(fy0)
    ux = fx*fx*(3 - 2*fx); uy = fy*fy*(3 - 2*fy)
    a = H(ix,iy) b = H(ix+1,iy) c = H(ix,iy+1) d = H(ix+1,iy+1)
    return a + (b - a)*ux + (c - a)*uy + (a - b - c + d)*ux*uy      # left-to-right: ((a+(b-a)*ux)+(c-a)*uy)+(((a-b)-c+d)*ux)*uy
fbm(x, y, seed, octaves=5, lacunarity=2.03, gain=0.5):
    total = 0; amp = 0.5; freq = 1.0; norm = 0.0
    for i in 0..octaves-1:
        total += amp * value_noise(x*freq + i*17.13, y*freq - i*11.71, seed + i*1013)
        norm += amp; amp *= gain; freq *= lacunarity          # freq by repeated multiplication: 1, 2.03, 4.1209, ...
    return total / norm
warped_fbm(x, y, seed, strength=0.5, octaves=5):
    qx = fbm(x + 1.7, y + 9.2, seed + 1, 4); qy = fbm(x + 8.3, y + 2.8, seed + 2, 4)
    return fbm(x + strength*(2*qx - 1), y + strength*(2*qy - 1), seed, octaves)
worley(x, y, seed, jitter=0.8):      # F1 <= F2 <= F3
    ix0 = floor(x); iy0 = floor(y); f1 = f2 = f3 = +inf; margin = (1 - jitter)/2      # = 0.09999999999999998
    for dy in (-1,0,1): for dx in (-1,0,1):
        cx = ix0+dx; cy = iy0+dy
        px = cx + margin + jitter*_hash(cx, cy, seed); py = cy + margin + jitter*_hash(cx, cy, seed+1)
        d = hypot(x - px, y - py)
        f3 = (d < f2) ? f2 : min(f3, d);  f2 = (d < f1) ? f1 : min(f2, d);  f1 = min(f1, d)      # this order, old values
```
Test vectors **[verified]** (x=[0,0.25,1.5,-2.75,10.1], y=[0,0.5,-0.3,3.3,-7.9]): `_hash([0,1,-1,7,-123456],[0,0,5,-3,99],12345)` = 0.6544282627291977, 0.11058697174303234, 0.7613470407668501, 0.5794877433218062, 0.6145058434922248; same with seed 2^32+5 = 0.39151056483387947, 0.7198529792949557, 0.6597909186966717, 0.1657334417104721, 0.15222590882331133. `value_noise(x,y,7)` = 0.7534191987942904, 0.6364476866256155, 0.3226985448095948, 0.7668940749672475, 0.05818165109162764. `fbm(x,y,7)` = 0.6129027658861038, 0.5938779045154193, 0.34735381147105293, 0.6631370182968715, 0.3832259944547513. `fbm(x,y,7,4)` = 0.6245622048751864, 0.6085859725951648, 0.3434102559461266, 0.6715072450325744, 0.3755927817104296. `warped_fbm(x,y,7,0.7,5)` = 0.6170905723367229, 0.5758918610496727, 0.41094441486524325, 0.7228796047142383, 0.43974054453688616. `worley(x,y,7)`: F1 = 0.5734160508099517, 0.5183645472681283, 0.6006387917683905, 0.5429412628869721, 0.14115377025635983; F2 = 0.8259722856351657, 0.9172284182052242, 1.0870131335029867, 0.6801659434638627, 0.7212224643632345; F3 = 0.9498148767613228, 0.9302588757118798, 1.1155208193643298, 0.9342675451549138, 0.7946168464798965.

### 5.5 `background.py` — `background_field(u, v, kind, spec, palette, seed=sub_seed32(seed,"background"), rng)`

```
level = spec.level (0); brightness = spec.brightness (0); t = 0; color = 0 (float32)
nebular_dust: n = warped_fbm(u*1.1 + 4.0, v*1.1 - 3.0, seed, strength=0.9, octaves=6)
              t = level * ss(0.40, 0.80, n) ** 1.2; warm = ss(0.5, 0.8, n)
              color = sample(0.45 + 0.4n)*(1 - 0.35warm) + accent*0.35*warm
cosmic_web:   wu = u + 0.25*(fbm(u*1.4 + 3.0, v*1.4, seed+1, 4) - 0.5); wv = v + 0.25*(fbm(u*1.4, v*1.4 - 3.0, seed+2, 4) - 0.5)
              web = nodes = 0
              for (scale, width, amp) in ((1.7, 0.045, 1.0), (4.2, 0.04, 0.4)):
                  k = seed + int(scale*10)                                  # +17, +42
                  F1,F2,F3 = worley(wu*scale + 11.0, wv*scale - 7.0, k)
                  strength = amp*ss(0.3, 0.62, fbm(u*1.3 + scale, v*1.3, k+5, 3))
                  w = width*(0.55 + 0.9*fbm(u*2.5, v*2.5 + scale, k+6, 3))
                  web = max(web, strength*exp(-((F2-F1)/w)**2)); nodes = max(nodes, strength*exp(-((F3-F1)/(w*2))**2))
              beads = 0.15 + 1.1*ss(0.25, 0.75, fbm(u*8.0 + 5.0, v*8.0, seed+3, 4))
              t = level*clip((0.7web + 0.5nodes)*beads, 0, 1); hot = nodes
              color = sample(0.55 + 0.3web)*(1 + 1.6hot)*(1 - 0.4hot) + accent*0.4*hot
cmb:          n = fbm(u*2.4, v*2.4, seed, 6); t = level*(0.35 + 0.65n); warm = ss(0.38, 0.62, n)
              color = sample(0.55)*(1 - warm) + accent*warm
color = float32(color) * brightness
for each distant galaxy (RNG §2.5): du=u-cx; dv=v-cy; x = du*cos(ang) + dv*sin(ang); y = -du*sin(ang) + dv*cos(ang)
    blob = 0.45*exp(-(x/a)**2 - (y/b)**2); color = where(blob > t, sample(0.7)*0.7, color); t = max(t, blob)
return float32(t), float32(color)
```
deep_void/starfield: t = 0 (+ blobs for starfield/cosmic_web).

### 5.6 `stars.py` and glints

```
background_stars(shape, prob=bg_spec.stars, palette, rng):
    mask = random(shape) < prob;  bright = 0.35 + 0.9*random(shape)**6;  T = uniform(3200, 14000, shape)
    mix = min(1.0, blackbody_mix*2);  color = sample(0.85)*(1-mix) + blackbody_linear(T)*mix
    -> StarLayer(mask, float32(color*bright))
    pipeline: mask &= (gal.t < 0.1) & (t_light < 0.05)
galaxy_stars(t=gal.t, young=gal.young, prob=star_density.stars, palette, rng):
    p = prob * clip(t*2.2, 0, 1)**1.2;  mask = (random(shape) < p) & (t < 0.85)
    T = 3300 + young*15000 + uniform(0, 1500, shape);  base = sample(clip(t + 0.3, 0, 1))
    color = base*(1 - blackbody_mix) + blackbody_linear(T)*blackbody_mix;  bright = 1.1 + 0.8*random(shape)
    if detail and detail_stars > 0: pick = random(shape) < detail_stars; color = where(pick, detail*0.85, color)
    -> StarLayer(mask, float32(color*bright))
glint_centers(t=gal.t, count=star_density.glints, rng, margin=3):
    inner = rows/cols [3, n-3);  on_pool = flatnonzero(inner & (t > 0.12) & (t < 0.65)); off_pool = flatnonzero(inner & (t < 0.03))
    n_bg = max(1, count // 4)
    for (pool, n) in ((on_pool, count - n_bg), (off_pool, n_bg)):
        if len(pool) and n > 0: picks += sorted(choice(pool, size=min(n, len(pool)), replace=False))
    return [(i // nx, i % nx, random() < 0.3) for i in picks]          # big = reach 2 (5-dot arms), else reach 1
```
`flatnonzero` = row-major flat indices ascending. Cross drawing and colours: §1.2.

### 5.7 Phenomena (`phenomena.py`)

Helpers: `disk_point(p, r, phi)`: `x = r*cos(phi); y = r*sin(phi)*p.tilt; return (p.cx + p.size*(ca*x - sa*y), p.cy + p.size*(sa*x + ca*y))`. `core_point(p)`: merger → `component_centers(p)[0]`; else `ys = core_offset.y*max(tilt, 0.65)`, `(cx + size*(ca*ox - sa*ys), cy + size*(sa*ox + ca*ys))`. `_field_point(p, dist, rng)`: `rho = U(dist); th = U(0,2π); (p.cx + rho*cos(th), p.cy + rho*sin(th), th)`. `_axes(du, dv, dir)`: `s = du*cos(dir) + dv*sin(dir); n = -du*sin(dir) + dv*cos(dir)`. `_cross(a, b, L, W) = exp(-3|a|/L)*exp(-(b/W)**2) + exp(-3|b|/L)*exp(-(a/W)**2)`. `_compose(parts)`: `t = Σ intensity` (float64, sequential), `color += float32(intensity * (float32(rgb)*brightness))`; returns `(clip(t,0,1), color)`. `_tint(pal, white) = accent*(1-white) + WHITE*white`. `step = grid.uv_step`.
`light_layer` post-step for all light kinds: `t = clip(t*(1 - ss(0.88, 1.0, hypot(u,v))), 0, 1)`; inverted palette → color = accent everywhere; returns `LightLayer(float32(t), float32(color))`.

Matter (added to the galaxy density before gain, coloured by the palette):
1. **satellite_galaxy**: `(sx,sy) = _field_point(p, dist)`; `size = U(size)`; `f = make_frame(u,v,sx,sy,size, U(0,π), U(0.55,1.0))`; if `random() < spiral_share`: `d, young = spiral(f, GalaxyParams(type=spiral, size, angle 0, tilt 1, arms 2, pitch U(0.3,0.45), arm_sharpness 2.5, arm_amp 1.3, interarm 0.25, arm_warp 0.5, dust 0.2, disk_scale 0.35; other defaults incl. dust_offset 0.7), ph_seed)`; else `w = warped_fbm(f.x*2.2 + 7.0, f.y*2.2, ph_seed, strength=0.6, octaves=4); d = 0.9*exp(-(f.r/0.5)**2)*(0.5+0.9w); young = ss(0.55,0.8,w)*exp(-(f.r/0.6)**2)`. Then `d = (d + 0.9*exp(-(f.r/0.09)**2))*(1 - ss(0.85,1.05,f.r))`; returns `(amplitude*d, young)`.
2. **globular_cluster**: for each: `r = hypot(u - p.cx - rho*cos(th), v - p.cy - rho*sin(th)); d += 2.4*exp(-(r/rc)**2) + 0.35*exp(-(r/(3.5rc))**2)`; young 0 (not projected on the disk).

Light (own colour, linear HDR):
3. **supernova**: `(sx,sy) = grid.snap(*disk_point(p, U(dist), U(0,2π)))`; `du,dv`; `r = hypot`; `L = U(spike_length)`; `diag = _cross((du+dv)/sqrt(2), (du-dv)/sqrt(2), 0.4L, 0.6step)`; `shell = U(shell_radius)`; `tint = _tint(0.4)`; parts: `(exp(-(r/(1.6step))**2), WHITE, 8.0)`, `(0.9*_cross(du,dv,L,0.6step), tint, 2.2)`, `(0.55*diag, tint, 1.6)`, `(0.7*exp(-(r/0.055)**2), tint, 1.2)`, `(0.6*exp(-((r-shell)/(0.9step))**2), accent, 1.5)`.
4. **comet**: `(hx,hy,θ) = _field_point(p, dist)`; `dir = θ + s1*(π/2 + U(-0.35,0.35))`; `L = U(length)`; `curve = U(0.08,0.18)*s2`; `(s,n) = _axes(u-hx, v-hy, dir)`; `a = clip(s/L, 0, 1)`; `behind = s > 0`; `ion = exp(-(n/(0.005 + 0.022a))**2)*(1-a)**0.6*behind`; `dust = exp(-((n - curve*L*a**2)/(0.012 + 0.09a))**2)*(1-a)**0.9*behind`; `r = hypot`; parts: `(exp(-(r/(1.8step))**2), WHITE, 6.0)`, `(0.9*exp(-(r/0.026)**2), _tint(0.5), 1.8)`, `(ion, accent, 1.6)`, `(0.9*dust, sample(0.85), 1.3)`.
5. **relativistic_jets**: `(cx,cy) = core_point(p)`; `dir = p.angle + π/2 + U(-0.35,0.35)`; `L = U(length)`; `lobe = U(lobe_radius)`; `knots = U(0.15,0.85, integers(3,6))`; `(s0,n) = _axes(u-cx, v-cy, dir)`; `lumps = fbm(u*9.0, v*9.0, ph_seed, 3)`; for `(sign, power) in ((1,1.0), (-1,0.6))`: `s = sign*s0; a = s/L; inside = (a > 0.02) & (a < 1.0); knot = min(1.0, 0.55 + Σ_k 0.45*exp(-((a-k)/0.04)**2)); beams += power*exp(-(n/(step*(0.6+1.2a)))**2)*inside*knot*(1-0.4a); end = hypot(s-L, n); lobes += power*exp(-(end/lobe)**2)*(0.5+0.8lumps); spots += power*exp(-(end/(1.5step))**2)`; parts: `(beams, _tint(0.5), 2.6)`, `(0.55*lobes, accent, 1.2)`, `(spots, WHITE, 3.5)`.
6. **pulsar**: `(px,py) = grid.snap(_field_point(p, dist)[:2])`; `r = hypot`; `(s0,n) = _axes(du,dv, U(0,π))`; `open = U(0.06,0.10)`; `L = U(beam_length)`; `beams = Σ_{s in (s0,-s0)} exp(-(n/(open*s + 0.7step))**2)*(s > 0)*exp(-2.5s/L)`; `spacing = U(ring_spacing)`; `rings = Σ_{k=1..integers(3,6)} 0.8**k * exp(-((r - spacing*k)/(0.7step))**2)` (`0.8**k` scalar pow: 0.8, 0.6400000000000001, 0.5120000000000001, 0.4096000000000001, 0.3276800000000001); parts: `(exp(-(r/(1.5step))**2), WHITE, 6.0)`, `(beams, _tint(0.4), 2.6)`, `(0.75*rings, accent, 1.4)`.
7. **einstein_ring**: `(cx,cy) = core_point(p)`; `R = p.size*U(radius)`; `(s,n) = _axes(u-cx, v-cy, U(0,π))`; `n = n / U(0.85,1.0)`; `rho = hypot(s,n); ang = atan2(n,s)`; `count = integers(2,5)`; `centers = U(0,2π) + 2π*arange(count)/count + U(-0.3,0.3,count)`; `near = Σ_c exp(-(((ang - c + π) mod 2π - π)/0.45)**2)` (Python-sign mod); `arcs = 0.35 + 0.65*min(near, 1)`; `W = 0.010`; parts: `(exp(-((rho-R)/W)**2)*arcs, _tint(0.35), 2.4)`, `(0.25*exp(-((rho-R)/(3W))**2)*arcs, accent, 0.8)`.
8. **anomaly** (`glitch(on, color, radius, palette, spec, rng, dot_r)`, in place, after stars/glints; whole braille cells): `accent = palette.accent if inverted else palette.accent*2.0 + 0.3`.
   - bands: `band = rows [4*r0, min(ny, 4*(r0+h)))`; `shift = 2*m*sg` dots; `on, color, radius` of the band ← `np.roll(…, shift, axis=1)` (wraps around); if the swap draw: `color[band] = color[band][..., ::-1]` (RGB→BGR).
   - blocks: `ys = [4r0, 4(r0+h))`, `xs = [2c0, 2(c0+w))` (numpy-clipped at the edge): `on[ys,xs] = random(clipped shape) < 0.6; color[ys,xs] = accent; radius[ys,xs] = dot_r`.
   - lost rows: `on[4r0 : 4r0+4] = False`.
   - scan line: `on[row] |= line; color[row, line] = accent*0.6; radius[row, line] = dot_r`.
   - then `postfx.chromatic_aberration = 6`.

### 5.8 Colour of each dot (`galaxy_color` and mixing)

```
galaxy_color(field, palette):
  angular (prismatic): hue = theta/(2π) + radius*0.9; base = sample_cyclic(hue)*(0.35 + 0.65t); white = t**3*0.8; color = base*(1-white) + white
  inverted (antimatter): color = sample(0.45 + 0.55t)
  normal:                color = sample(0.12 + 0.88t)
  if detail (amber_crt): w = regions*ss(0.2,0.6,young)*(1 - ss(0.7,0.9,t)); w = max(w, halo*(1 - ss(0.08,0.4,t)))
                         tint = detail*(luminance(color)/luminance(detail)); color = color*(1-w) + tint*w
  if not inverted:       color = color*(1 + 1.5*ss(0.85, 1.0, t))          # HDR core
  return float32(color)
```
Then mixing, stars, glints and anomaly as in §1.2. dtype rule (numpy 2 / NEP 50): an operation whose array operands are all float32 (Python scalars do not upcast) is computed in float32; any float64 array operand makes it float64. Float32 points: LUTs, accent/background/detail, `galaxy_color` output, `bg_color`, `light.color` (accumulated in float32), star colours, glint colours (`(accent*0.5+0.5)*k` in float32), anomaly colours, `dot_color`, and the whole of `compose`.

---

## 6. Braille raster (`render/braille.py`)

- `BAYER4 = ([[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]] + 0.5)/16`; tiled so `bayer[y][x] = BAYER4[y % 4][x % 4]` (y = dot row).
- `dither(t, jitter=0.25, min_density=0.035, rng)`: `threshold = (1 - jitter)*bayer + jitter*rng.random((ny,nx))` (= `0.75*bayer + 0.25*U`); `on = (t > min_density) & (t*1.1 > threshold)`. Input `t_dots` is float64 (`t**0.7` for antimatter).
- Forced-on dots afterwards: background stars, resolved stars, glint crosses, anomaly edits. Off-grid: none (glint margin 3).
- `to_text(on)`: crop to multiples of 4 rows / 2 cols; cell (r, c) code = Σ bits over dot (j, i) at `on[4r+j, 2c+i]` with `bits = [[0x01,0x08],[0x02,0x10],[0x04,0x20],[0x40,0x80]]` (j = 0..3 row in cell, i = 0..1 column) → char `U+2800 + code`; lines joined with `"\n"`, no trailing newline; 192 chars × 96 lines in production. Unit-test vector: `on[0,0] = on[3,1] = True` in an 8×4 grid → line 0 char 0 = `chr(0x2800 + 0x01 + 0x80)`.
- Disk files: `output/braille/<id>.txt` and preview `.txt` are UTF-8 with **CRLF** (Windows text mode): 55 486 bytes = 96×192×3 + 95×2. Token #1: sha256 of LF text = `741aa14e3f1518430b9e716f1fb87bf401132192121c040dab7bba4ae1aec4fb`, of CRLF bytes = `e8c39ba3…b947` (= manifest).
- LODs: none in Python (§1.3).

---

## 7. Post-processing (`render/postfx.py` `compose`) — all of it is a pure image filter

Inputs: `dot_color (ny,nx,3) float32` (0 for off dots), `dot_radius (ny,nx) float32` (px, −1 for off dots).

```
pixel_maps: px = arange(W)+0.5; ix = clip(floor(px/step), 0, nx-1); dx = px - (ix+0.5)*step
            py = arange(H)+0.5; iy_raw = floor((py - oy)/step); valid = 0 <= iy_raw < ny; iy = clip(iy_raw); dy = py - oy - (iy+0.5)*step
            dist = float32(hypot(dx[None,:], dy[:,None]))
cov   = clip(radius[iy,ix] + 0.5 - dist, 0, 1), 0 on invalid rows        # each pixel sees only its own dot cell (1-px AA ramp)
color = dot_color[iy, ix]                                               # nearest-dot colour
lit   = dot_radius > 0;  area = π*max(dot_radius,0)**2 / step**2        # per dot; step**2 = 28.444444444444443 at 192 cols
if not inverted:  lin = background + color*cov;  if glow.enabled: lin += glow(dot_color*area)
                  vignette_amount = vignette (0.35)
else (antimatter): lin = background*(1-cov) + clip(color,0,1)*cov;  if glow.enabled: lin -= 0.6*glow(clip(background - dot_color, 0)*area*lit)
                  vignette_amount = vignette*0.4
r = hypot(xs, ys) with xs = (arange(W)+0.5)/W*2-1, ys likewise;  lin *= float32(1 - vignette_amount*ss(0.5, 1.35, r))
shift = int(round(chromatic_aberration)); if shift > 0:  lin[:, shift:, R] = lin[:, :-shift, R]  (red moves right)
                                                         lin[:, :-shift, B] = lin[:, shift:, B]  (blue moves left)
                                                         (the uncovered edge columns keep their own values)
if scanlines: period = int(scan.period or 4), depth = float(scan.depth or 0.28); lin[::period] *= 1 - depth    # rows 0, p, 2p, ...
srgb = linear_to_srgb(tonemap(max(lin, 0)))
if grain: srgb += rng.normal(0, grain, (H,W,1))          # never (grain 0.0)
out  = uint8(clip(rint(srgb*255), 0, 255))               # rint = half-to-even
tonemap(x, knee=0.8): over = max(x - 0.8, 0); y = min(x, 0.8) + 0.2*(1 - exp(-over/0.2))
                      white = clip((max_channel(x) - 1)/4, 0, 0.85); return y + (1 - y)*white
glow(energy (ny,nx,3), grid, cfg): total = Σ_i weight_i * gaussian_filter(energy, sigma=(σ_i, σ_i, 0), mode="constant")
                                   σ_i = radius_px_i/step (radii [6,18,48] px, weights [0.45,0.30,0.22]); then ×strength (1.0)
                                   → _upsample: per channel PIL Image("F").resize((W, round(ny*step)), BICUBIC), pasted at row round(oy), clip >= 0
```
Exact CPU references **[verified bit-for-bit]**:
- `gaussian_filter` (scipy 1.18): kernel radius `int(4.0*σ + 0.5)`; `w[x] = exp(-0.5/σ² * x²)` for x = −r..r (int x² ), normalised by its sum; correlate axis 0 then axis 1, constant 0 outside; per output: `acc = in[c]*w0; for j = −r..−1: acc += (in[c+j] + in[c−j])*w[j]` in float64, stored as float32 between axes.
- Pillow 13 BICUBIC on mode F: separable, horizontal pass first, float32 intermediate; per output x: `scale = in/out; support = 2*max(scale,1); center = (x+0.5)*scale; xmin = max(int(center - support + 0.5), 0); xmax = min(int(center + support + 0.5), in) - xmin; k[i] = cubic((i + xmin - center + 0.5)/max(scale,1))` normalised by Σk; `cubic` = Keys a = −0.5: `|x|<1: ((a+2)|x| − (a+3))x² + 1`; `|x|<2: (((|x|−5)|x| + 8)|x| − 4)*a`; else 0. Accumulate in double, store float32.

What touches braille data: nothing in `compose`. Only `dither`, stars, glints and `glitch` (Anomaly) define `on`. When CRT is on: palette amber_crt (`chromatic_aberration 2`, `scanlines {period 2, depth 0.18}`) and phenomenon anomaly (`chromatic_aberration 6`, which overrides amber's 2; amber's scanlines survive). Globally both off. For WebGL: everything after `dot_color/dot_radius` (coverage disc, nearest-dot colour, 3-scale blur at dot resolution + bicubic upsample, vignette, channel shift, scanlines, tonemap, sRGB) maps to shaders; expect ±1 LSB differences (float32 shader math, different exp/pow).

---

## 8. Float sensitivity (numpy vs JavaScript)

Measured on this machine **[verified]**:
- numpy float64 `exp, log, sin, cos, arctan2, power(x, 1.2)`, `x**3` (array) = UCRT libm results (0 mismatches vs CPython `math`, which uses the CRT). V8/SpiderMonkey use fdlibm-derived code → occasional 1-ulp differences. No SVML/SIMD float64 transcendentals here (no AVX-512).
- `np.hypot(x,y)` == `sqrt(x*x + y*y)` (0/200 000); `math.hypot` differs in 16 %. **Use `Math.sqrt(x*x+y*y)`, never `Math.hypot`.**
- numpy array `a**2` == `a*a`; array `**0.5` == sqrt; array `**3` == `pow(a,3)` ≠ `a*a*a` (26 % differ). Python scalar `s**2` = UCRT `pow(s,2)` ≠ `s*s` in 0.05 % of inputs; np.float64 scalar `**2` likewise. Scalar pows in pixel code: `rad**2` (constants, hardcode 0.0036 / 0.005625 / 0.0025000000000000005), `env_radius**2`, `(0.5*p.size)**2`, `0.8**k` (hardcode), `step**2` (28.444444444444443 / 113.77777777777777 / 455.1111111111111).
- float32 `np.exp` (tonemap) is numpy's own SIMD routine (differs from rounding the float64 exp in 40 % of inputs) — PNG only.
- `np.cbrt` (LUT only).

Discrete decisions and their safety margins (200 tokens, 384² dots each):

| decision | inputs | min distance to threshold |
|---|---|---|
| dither `t > 0.035 && t*1.1 > thr` | t (f64), thr = 0.75·B + 0.25·U | 1.7e-9 (median per token 8.9e-7) |
| resolved stars `U < prob*clip(2.2t)**1.2`, `t < 0.85` | gal.t | 1.2e-8 / 3.3e-7 |
| glint pools `0.12 < t < 0.65`, `t < 0.03` | gal.t | 8.7e-10 |
| background-star mask `gal.t < 0.1`, `t_light < 0.05` | gal.t, light.t (f32) | 3.5e-9 |

A 1e-15 relative perturbation of `t` flipped 0 dots in every trial; even a half-float32-ulp perturbation of `t_bg`/`light.t` flipped 0 dots in 138 tokens. Conclusion: with float64 fields and the same formula order, the braille text should match exactly; float32 field math would not be safe (errors ~1e-7 vs margins ~1e-9).

Other sensitivity points (all measure-zero in practice but worth matching exactly):
- `floor()` in `value_noise`/`worley` at integer crossings (value noise is continuous, so harmless); `int(pos*(len-1))` in merger bursts (`Math.trunc`); `grid.snap` floors (supernova, pulsar, centre).
- Glint pools: if one dot changed pool membership, Floyd's index draws would map onto different dots and every glint could move — the most fragile path, still 1e-9 margin.
- `rint` (half-to-even) in palette sampling and final uint8; `round()` in Python is half-even (`h = int(round(ny*step))`).
- `np.mod`/Python `%` with a positive divisor returns a non-negative result (einstein ring, `sample_cyclic`): `m = a % b; if (m < 0) m += b`.
- Evaluation order: replicate Python's left-to-right evaluation and parenthesisation (no FMA, no reassociation). Constants like `(1 - 0.8)/2 = 0.09999999999999998`, `2*π = 6.283185307179586`, `int(4.2*10) = 42`.
- Python `x // y` on floats (`rows`) equals `Math.floor(x/y)` for these inputs.
- Typed arrays: `Float64Array` for u, v, fields, thresholds; `Math.fround` at `t_bg`, `light.t` (and colour points in §5.8).

---

## 9. How to run

### 9.1 Environment
Python ≥ 3.11 (venv is 3.13.14 at `C:\Users\rayel\Desktop\galaxy-nft\.venv`). Pinned `requirements.txt`: numpy==2.5.4, pillow==13.0.0, PyYAML==6.0.3, scipy==1.18.1, pytest==9.2.0. Package installed editable (`__editable__.galaxy_nft-0.2.0.pth` → `src`; dist-info says 0.2.0, `__version__` is 0.4.0). Setup per README: `python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt; .\.venv\Scripts\python.exe -m pip install -e . --no-deps`. On this PC `python3` resolves to the Microsoft Store stub (hangs): call `.venv\Scripts\python.exe` directly. Console is cp1252: set `PYTHONIOENCODING=utf-8` to print braille. Use `PYTHONDONTWRITEBYTECODE=1` and `pytest -p no:cacheprovider` to keep the repo untouched.

### 9.2 CLI (`python -m galaxy_nft <cmd>`, run from the repo root)
`render --token N` → `output/previews/tokens/NNNN.png` (PNG only, prints traits); `preview --showcase | --phenomena | --count N [--seed S] | --rarest N` → `output/previews/<folder>/NNNN.png` + `NNNN.txt` + contact sheet + avatar check; `generate [--tokens 1-12,468] [--force]` → `output/images/*.png`, `output/braille/*.txt`, metadata, `reports/manifest.json`, `provenance.json` (resumable; refuses if the generation fingerprint changed); `validate`, `rarity`, `sheet`, `export-csv`, `placeholder`, `set-base-uri`.

### 9.3 Python API
```python
from galaxy_nft.config import Config
from galaxy_nft.pipeline import render_token, render_custom, render_traits
cfg = Config()                                        # or Config().with_render(braille={"columns": 96}) / (width=256, height=256, braille={"columns": 24})
r = render_token(cfg, 17)                             # r.image (PIL RGB), r.braille (str, LF), r.traits, r.seed, r.name, r.designation
img, text = render_traits(cfg, traits_dict, seed)     # lowest level
r = render_custom(cfg, 21, {"galaxy_type": "spiral", "phenomenon": "anomaly"})
```
For intermediate arrays (fields, `on`, `dot_color`), copy `render_traits` (60 lines) into a script; see `scratchpad\py\probe.py`.

### 9.4 Timing (this PC, single process) **[verified]**
`plan_collection` 0.26 s. `render_entry` at 2048 px ≈ 1.4 s: galaxy field 0.05–0.11 s, background 0–0.15 s, light 0–0.06 s, dither+stars+glints ≈ 0.1 s, `compose` ≈ 1.1 s (tonemap 0.36, sRGB 0.17, glow 0.14, upsample 0.11, expand 0.09). Full collection ≈ 10 min with 15 worker processes (README). Tests: `.\.venv\Scripts\python.exe -m pytest` → **50 passed in 4.8 s**. Re-rendering token #1 reproduced the PNG sha256 in `manifest.json` and the stored braille text.

### 9.5 Golden data
`tools/golden/` (or any golden-export script) **does not exist** in galaxy-nft (the GDD/BRIEF plan `tools/golden/export.py`). Existing reference outputs: `output/braille/1..1000.txt` (CRLF), `output/images/1..1000.png`, `output/reports/manifest.json` (per token: generation_index, seed, dna, traits, name, sha256 of PNG and braille). Verified reference implementations written during this review (session scratchpad, `C:\Users\rayel\AppData\Local\Temp\claude\f50402b6a0924bc9\4d6e0762-cd0f-4163-891c-3b8c68538083\scratchpad\py\`): `pcgref.py` (pure-Python SeedSequence + PCG64 + random/uniform/integers/choice/permutation/Floyd, matches numpy), `bicubic.py` (Pillow BICUBIC model), `gauss.py` (scipy gaussian model), `probe.py`/`probe2.py` (field margins), `vectors.py` (+ `vectors.out`). Suggested golden export per token and per LOD: traits, params, `gal.t`, `gal.young`, `t_bg`, `light.t`, dither threshold, `on`, `radius`, `dot_color`, braille text (LF), decoded RGB pixels; plus RNG vectors.

---

## 10. Surprises and easy mistakes

1. Token art seed comes from the **generation index**, not the token id (shuffle). `render_custom` uses the token id and skips DNA uniqueness/quotas.
2. Every applicable, non-fixed, non-forced trait consumes exactly one double, **even with a single candidate**; forced/fixed/absent traits consume none. Trait-level `requires` drops even a fixed value; `fixed` values of later traits constrain earlier draws.
3. PCG64 32-bit buffering: `integers`, `choice(list)`, Floyd and `permutation` consume half words; the leftover half is used by the next 32-bit draw even after intervening `random()` calls. `integers(a, a+1)` consumes nothing.
4. `permutation`/`shuffle` use masked rejection (`random_interval`); `choice(replace=False)` uses Lemire + Floyd + a Lemire shuffle (its RNG use matters even though the result is sorted).
5. The 12 base geometry draws happen for every type; `random()` for dwarf `kind` only for dwarfs; elliptical shells draw `integers` only if `random() < 0.35`.
6. Galaxy centre is `snap(0,0)` = +½ dot, not (0,0), and depends on the column count.
7. Quasar spikes are centred on `(p.cx, p.cy)`, also for mergers whose main nucleus is at `a_pos`.
8. Satellite galaxies use the phenomenon 32-bit seed for their noise; merger galaxy B uses `noise_seed + 101` (so its spiral fBms use seeds +112 and +124, its elliptical fBm +106).
9. `t_bg` and `light.t` are float32; everything else in the field is float64. `glint_centers` and resolved stars use `gal.t` (galaxy only), not the combined `t`.
10. Antimatter: dots from `t**0.7`, paper background, subtractive glow (×0.6), vignette ×0.4, phenomena and glints in accent ink, background forced to deep_void.
11. Glitch slices are numpy-clipped; the random block fill uses the clipped shape (RNG count depends on it); `np.roll` wraps around the full width; channel swap reverses RGB.
12. CRT shift leaves edge columns unshifted (not black); scanlines darken row 0 too.
13. Scalar `**2` is `pow` (UCRT) in Python; array `**2` is `x*x`; array `**3/**4/**6/**10/**14` are `pow`. Use `Math.sqrt(x*x+y*y)` for `hypot`.
14. YAML/JS: preserve key order (Maps); `arms` values are strings `"2"…"6"`; `none` is a string.
15. Braille `.txt` on disk is CRLF; `to_text` is LF; no trailing newline.
16. PNG bytes (provenance) depend on zlib; a port can only match decoded pixels, and with WebGL postfx only approximately.
17. Config keys that do nothing: `render.braille.dither: "bayer4"`, `pfp.*`. Docs mention grain 0.012 (old); current `grain: 0.0`.
18. LODs at 96/48 columns are not subsets of the 192 render; star counts drop with dot count while glint count stays fixed.
19. Python round (half-even, exact decimal) for science attributes vs JS `toFixed`.
20. The BRIEF's "8 s per image" is not what a single process takes now (≈1.4 s; postfx ≈ 80 %).

---

## Appendix A. Golden vectors **[verified]**

`build_params` with `center = snap(0,0) = (0.0026041666666665186, 0.0026041666666665186)` (first plan token of each type):

- token 1 (seed 1847109058257526444, spiral 3/large/tilted/quasar/dense): size 0.8796705188378762, angle 1.2098143763519995, tilt 0.6161923282130007, gain 1.2, noise_seed 1740554569, disk_scale 0.3681535603467923, pitch 0.40712901897521403, arm_sharpness 4.2542960088049995, arm_amp 1.139177014461908, interarm 0.1115922621571898, arm_warp 0.4263352527655402, dust 0.45367986696735507, dust_offset 0.6472234644233169, core_dir 4.848549669574221.
- token 2 (seed 5433263452210703738, elliptical/large/bright/dense): size 0.8536146327577867, angle 1.9936542894135256, tilt 0.8193964493399333, noise_seed 269191899, core_scale 0.6, core_dir 2.1815918130634397, extra {amp 2.1829059037211636, k 3.8074606262037944, exp 0.6700745119733788, shells []}.
- token 4 (seed 313712851501884848, barred 2/colossal/face_on/quasar): size 1.0684270583263278, angle 1.5567237396655413, tilt 0.870616608041052, noise_seed 3312581238, pitch 0.3534068033597302, bar_length 0.20276534914239244, bar_width 0.05582760782904951, bar_amp 0.7514202878629561, core_dir 0.42589542014336174.
- token 5 (seed 14998549358365763970, ring/compact/tilted/bright/saturated): size 0.5828795680703756, angle 2.7538559733785455, tilt 0.638406768008831, gain 1.45, noise_seed 1789414982, core_offset (-0.017934966494715605, -0.01563040382693144), extra {radius 0.5601412701768866, width 0.06308313406847849, amp 1.216401557558791, spokes 7, spoke_amp 0.07037443299908383}.
- token 7 (seed 2726499447795441370, irregular/large/faint): size 0.91194424962329, angle 2.433638861542453, tilt 0.9493334406679779, noise_seed 4253659742, extra {ox 16.45159655308423, oy 18.577232389284617, env_dx 0.14259111453378823, env_dy 0.0008495743251375754, env_radius 0.40900168688622746, 7 knots, first [0.35301384734237107, -0.28058326640457587, 0.06006248828203418, 0.3360283852268922], kind irregular}.
- token 22 (seed 9722316308166385164, lenticular/compact/face_on/faint): size 0.562525152544737, angle 2.856004282317226, tilt 0.9249224360577489, noise_seed 3550162500, disk_scale 0.33010052333572915, extra {lens_radius 0.34735174792670054, ring_amp 0.16581535139540082, ring_radius 0.5743130832217538}.
- token 46 (seed 16510124574455869323, merger/large/bright/sparse/supernova): size 0.8941217411498166, angle 1.608789514400001, tilt 0.7330943801998034, noise_seed 2525268404, extra {a_scale 0.5918620403462821, b_scale 0.423383690258272, a_angle 0.5185769114754478, b_angle 1.8706904987203032, b_tilt 0.4129518573485974, a_pitch 0.3383369085341027, b_pitch 0.3516569358577759, b_kind elliptical, b_amp 0.8512612948381061, tail_a_angle 3.1094419015999444, tail_sweep 1.2858656872454424, tail_length 0.7307419228376437, 10 bursts, first [2, 0.7021818259953528, 0.6389126344343522, 0.015602395696380382]}.
- token 70 (seed 127186172512881563, dwarf/medium/bright): size 0.6740475598843781 (already ×0.88), angle 3.096485391471566, tilt 0.8640210080371693, noise_seed 2017633855, extra {ox -7.871556798511357, oy 23.619165599688756, env_radius 0.4875311070695801, 3 knots, kind spheroidal}.

Trait draws: `draw(sub_rng(token_seed(20261104,1),"traits"))` = spiral/4/medium/tilted/bright/normal/emerald_void/nebular_dust/none (DNA 3d0cf73e…3808); index 2 = spiral/4/colossal/face_on/bright/saturated/neon_synapse/deep_void/none; index 3 = elliptical/large/bright/normal/crimson_nebula/nebular_dust/none (DNA 4f55413a…1d90).

Small renders (`Config().with_render(width=256, height=256, braille={"columns": 24})`, 48×48 dots): `render_token(small, 1)` braille sha256 (LF) `3b1d3029de657639fc6c7feec46cc51a510417fa46bf6a999e11af3551bc5019`, `image.tobytes()` sha256 `49ef79461e63900dd404c823c03d10beea57a15de47da849ed5cdd740a7d5781`; `render_token(small, 5)` braille `b246bedfb588f52146892ac1857f796fcd36986a494b5a913a41be32f90e1a85`, image `80e9146366e4f312ee440e965e4d265441a4d3c9e012a117fc0c49edbeff313e`; `render_custom(small, 21, {phenomenon: anomaly, galaxy_type: spiral, palette: andromeda_blue})` → traits spiral/4/large/tilted/faint/normal/andromeda_blue/nebular_dust/anomaly, name "Thamir", braille `dec628dbc09aa816c27632955a6fc8c0ad953ee84707d36d6f711b3ba402d510`.
