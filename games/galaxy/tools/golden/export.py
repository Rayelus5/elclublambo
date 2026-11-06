"""Golden references for the TypeScript port of the galaxy-nft engine (games/galaxy/docs/ENGINE_PORT.md).

Runs with galaxy-nft's own venv, which has the engine installed (editable) and the pinned numpy/scipy/Pillow:

    PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1 <galaxy-nft>/.venv/Scripts/python.exe -I \
        games/galaxy/tools/golden/export.py --check
    ... export.py --out games/galaxy/packages/engine/test/golden/v1

--check re-renders token #1 through the same instrumented pipeline and compares it with galaxy-nft's manifest.json.
--out writes rng.json, traits.json, params.json, colors.json, cases/*.json, images/*.png and meta.json. The output is
deterministic: running it twice gives the same bytes, so a diff of the folder is a diff of the engine.

Intermediate fields are captured by wrapping the functions `pipeline.render_traits` calls (it looks them up in its
module namespace at call time), so every number comes from the unmodified renderer that made the collection.
Integers that can exceed 2^53 (seeds, PCG state) are written as decimal strings for BigInt.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import platform
import sys
from dataclasses import asdict
from pathlib import Path

GALAXY_NFT = Path(os.environ.get("GALAXY_NFT", r"C:\Users\rayel\Desktop\galaxy-nft"))
sys.path.insert(0, str(GALAXY_NFT / "src"))

import numpy as np  # noqa: E402
import PIL  # noqa: E402
import scipy  # noqa: E402
from PIL import Image  # noqa: E402

import galaxy_nft  # noqa: E402
import galaxy_nft.fields as fields  # noqa: E402
import galaxy_nft.pipeline as pipeline  # noqa: E402
from galaxy_nft import noise  # noqa: E402
from galaxy_nft.color import LUT_SIZE, blackbody_linear, load_palette  # noqa: E402
from galaxy_nft.config import Config  # noqa: E402
from galaxy_nft.fields import build_params  # noqa: E402
from galaxy_nft.plan import find_token, plan_collection  # noqa: E402
from galaxy_nft.render.braille import BrailleGrid  # noqa: E402
from galaxy_nft.rng import derive_seed, sub_rng, sub_seed32, token_seed  # noqa: E402
from galaxy_nft.traits import TraitSampler  # noqa: E402

MASTER = 20261104
LODS = (192, 96, 48)
TOKEN1_BRAILLE_LF = "741aa14e"  # prefix printed by --check; the full hash is compared with manifest.json (CRLF)
STREAMS = ("traits", "name", "geometry", "noise", "phenomenon", "background", "dither", "stars", "glints", "postfx",
           "science", "coordinates")


# ---------------------------------------------------------------------------------------------------- serialisation

def plain(o):
    """numpy scalars/arrays and tuples → JSON-native values; floats keep their exact double (repr round-trips)."""
    if isinstance(o, dict):
        return {str(k): plain(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [plain(v) for v in o]
    if isinstance(o, np.ndarray):
        return plain(o.tolist())
    if isinstance(o, (np.bool_, bool)):
        return bool(o)
    if isinstance(o, (np.integer, int)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        if not math.isfinite(f):
            raise ValueError(f"non-finite value in golden data: {f}")
        return f
    return o


def big(n: int) -> str:
    return str(int(n))


def write_json(path: Path, obj, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(plain(obj), ensure_ascii=False, indent=indent, separators=(",", ":") if indent is None else None)
    path.write_bytes((text + "\n").encode("utf-8"))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------------------------- instrumented render

class Capture:
    """Wraps the functions render_traits calls and keeps what they return; compose runs only when an image is wanted."""

    NAMES = ("build_params", "galaxy_field", "background_field", "light_layer")

    def __init__(self):
        self.originals = {n: getattr(pipeline, n) for n in self.NAMES + ("compose",)}
        # Inside galaxy_field: the frame of the main galaxy and the raw output of its disk geometry (before the
        # edge-on dust lane, the core and the gain), so the geometries can be tested on their own.
        self.make_frame = fields.make_frame
        self.disks = dict(fields.DISK_GEOMETRIES)
        self.values: dict = {}
        self.want_image = False

    def __enter__(self):
        for name in self.NAMES:
            setattr(pipeline, name, self._spy(name, self.originals[name]))
        setattr(pipeline, "compose", self._compose)
        fields.make_frame = self._spy("frame", self.make_frame)
        for kind, fn in self.disks.items():
            fields.DISK_GEOMETRIES[kind] = self._spy("disk", fn)
        return self

    def __exit__(self, *exc):
        for name, fn in self.originals.items():
            setattr(pipeline, name, fn)
        fields.make_frame = self.make_frame
        fields.DISK_GEOMETRIES.update(self.disks)

    def _spy(self, name, fn):
        def wrapper(*args, **kwargs):
            result = fn(*args, **kwargs)
            # galaxy_field edits the disk density in place (edge-on dust lane): keep a copy of what the geometry returned.
            self.values[name] = tuple(np.array(a, copy=True) for a in result) if name == "disk" else result
            return result
        return wrapper

    def _compose(self, grid, dot_color, dot_radius, palette, postfx, rng):
        self.values["dot_color"] = dot_color
        self.values["dot_radius"] = dot_radius
        self.values["postfx"] = postfx
        return self.originals["compose"](grid, dot_color, dot_radius, palette, postfx, rng) if self.want_image else None

    def render(self, cfg: Config, traits: dict, seed: int, want_image: bool):
        self.values = {}
        self.want_image = want_image
        image, text = pipeline.render_traits(cfg, traits, seed)
        return image, text, dict(self.values)


def lod_config(columns: int) -> Config:
    return Config() if columns == 192 else Config().with_render(braille={"columns": columns})


def sample_dots(nx: int, ny: int) -> list[tuple[int, int]]:
    """(j, i) = (row, column): a fixed lattice clipped to the grid, plus 40 dots around the centre."""
    marks = (0, 37, 101, 192, 255, 383)
    dots = [(j, i) for j in marks for i in marks if j < ny and i < nx]
    cj, ci = ny // 2, nx // 2
    for k in range(40):
        dj = (k * 7) % 25 - 12
        di = (k * 11) % 25 - 12
        dots.append((min(max(cj + dj, 0), ny - 1), min(max(ci + di, 0), nx - 1)))
    return dots


def lod_record(columns: int, traits: dict, seed: int, cap: Capture, want_image: bool):
    cfg = lod_config(columns)
    image, text, v = cap.render(cfg, traits, seed, want_image)
    gal = v["galaxy_field"]
    t_bg = v["background_field"][0]
    light = v["light_layer"]
    params = v["build_params"]
    dot_color, dot_radius = v["dot_color"], v["dot_radius"]
    ny, nx = dot_radius.shape
    dots = sample_dots(nx, ny)
    js = np.array([d[0] for d in dots])
    iss = np.array([d[1] for d in dots])
    assert t_bg.dtype == np.float32, t_bg.dtype
    assert light is None or light.t.dtype == np.float32, light.t.dtype
    record = {
        "columns": columns,
        "nx": nx,
        "ny": ny,
        "braille": text,
        "braille_sha256": sha256(text.encode("utf-8")),
        "dots_on": int((dot_radius >= 0).sum()),
        "params": params_dict(params),
        "postfx": v["postfx"],
        "samples": {
            "dots": dots,
            "gal_t": gal.t[js, iss],
            "gal_young": gal.young[js, iss],
            "t_bg": t_bg[js, iss],
            "light_t": None if light is None else light.t[js, iss],
            "dot_color": dot_color[js, iss],
            "dot_radius": dot_radius[js, iss],
            "frame_r": None if "frame" not in v else v["frame"].r[js, iss],
            "frame_th": None if "frame" not in v else v["frame"].th[js, iss],
            "disk_d": None if "disk" not in v else v["disk"][0][js, iss],
            "disk_young": None if "disk" not in v else v["disk"][1][js, iss],
        },
    }
    return record, image


def params_dict(p) -> dict:
    d = asdict(p)
    d["noise_seed"] = int(d["noise_seed"])
    return d


# ------------------------------------------------------------------------------------------------------------ cases

ROTATION = ("barred_spiral", "lenticular", "spiral", "elliptical", "ring", "irregular", "dwarf", "merger")
TABLE = [
    # (slug, fixed, predicate on (traits, params at 192) that the seed must satisfy, image?)
    ("spiral_none_andromeda", {"galaxy_type": "spiral", "phenomenon": "none", "palette": "andromeda_blue"}, None, True),
    ("spiral_anomaly_amber", {"galaxy_type": "spiral", "phenomenon": "anomaly", "palette": "amber_crt"}, None, True),
    ("spiral_einstein_edge_on", {"galaxy_type": "spiral", "phenomenon": "einstein_ring", "inclination": "edge_on"},
     None, False),
    ("barred_quasar_jets", {"galaxy_type": "barred_spiral", "core": "quasar", "phenomenon": "relativistic_jets"},
     None, True),
    ("barred_pulsar", {"galaxy_type": "barred_spiral", "phenomenon": "pulsar"}, None, False),
    ("elliptical_shells", {"galaxy_type": "elliptical", "phenomenon": "none"},
     lambda t, p: len(p.extra.get("shells", [])) > 0, False),
    ("elliptical_supernova_antimatter", {"galaxy_type": "elliptical", "phenomenon": "supernova",
                                         "palette": "antimatter"}, None, True),
    ("lenticular_comet", {"galaxy_type": "lenticular", "phenomenon": "comet"}, None, False),
    ("lenticular_globular", {"galaxy_type": "lenticular", "phenomenon": "globular_cluster"}, None, False),
    ("irregular_cosmic_web", {"galaxy_type": "irregular", "phenomenon": "none", "background": "cosmic_web"},
     None, False),
    ("irregular_cmb", {"galaxy_type": "irregular", "phenomenon": "none", "background": "cmb"}, None, True),
    ("ring_satellite", {"galaxy_type": "ring", "phenomenon": "satellite_galaxy"}, None, False),
    ("ring_prismatic", {"galaxy_type": "ring", "phenomenon": "none", "palette": "prismatic"}, None, True),
    ("dwarf_spheroidal", {"galaxy_type": "dwarf", "phenomenon": "none"},
     lambda t, p: p.extra.get("kind") == "spheroidal", True),
    ("dwarf_irregular", {"galaxy_type": "dwarf", "phenomenon": "none"},
     lambda t, p: p.extra.get("kind") == "irregular", False),
    ("merger_supernova", {"galaxy_type": "merger", "phenomenon": "supernova"}, None, True),
    ("merger_spiral_b", {"galaxy_type": "merger", "phenomenon": "none"},
     lambda t, p: p.extra.get("b_kind") == "spiral", False),
]
# Every value of these traits must appear in some case without phenomenon (the braille suite of Task 8 covers them).
COVER = ("galaxy_type", "palette", "background", "core", "star_density", "size", "inclination", "arms")


def draw_case(cfg: Config, sampler: TraitSampler, k: int, fixed: dict, predicate):
    for attempt in range(400):
        seed = token_seed(MASTER, 9000 + k + 100 * attempt)
        traits = sampler.draw(sub_rng(seed, "traits"), fixed)
        for key, value in fixed.items():
            assert traits.get(key) == value, f"fixed {key}={value} not kept: {traits}"
        if predicate is None:
            return seed, traits
        grid = BrailleGrid(cfg.render["width"], cfg.render["height"], 192)
        p = build_params(traits, seed, cfg.visuals, center=grid.snap(0.0, 0.0))
        if predicate(traits, p):
            return seed, traits
    raise RuntimeError(f"no seed found for {fixed}")


def plan_cases(cfg: Config, sampler: TraitSampler) -> list[dict]:
    cases = []
    for slug, fixed, predicate, image in TABLE:
        k = len(cases) + 1
        seed, traits = draw_case(cfg, sampler, k, fixed, predicate)
        cases.append({"name": f"{k:02d}_{slug}", "seed": seed, "fixed": fixed, "traits": traits, "image": image})

    rotation = iter(ROTATION * 4)
    for key in COVER:
        for value in sampler.traits[key]["values"]:
            plain_cases = [c for c in cases if c["traits"].get("phenomenon") == "none"]
            if any(c["traits"].get(key) == value for c in plain_cases):
                continue
            fixed = {key: value, "phenomenon": "none"}
            if key in ("arms", "inclination"):
                fixed["galaxy_type"] = "spiral"
            elif key == "galaxy_type":
                pass
            elif key not in ("size", "core"):
                fixed["galaxy_type"] = next(rotation)
            k = len(cases) + 1
            seed, traits = draw_case(cfg, sampler, k, fixed, None)
            cases.append({"name": f"{k:02d}_{key}_{value}", "seed": seed, "fixed": fixed, "traits": traits,
                          "image": False})

    plain_cases = [c for c in cases if c["traits"].get("phenomenon") == "none"]
    for key in COVER:
        missing = [v for v in sampler.traits[key]["values"] if not any(c["traits"].get(key) == v for c in plain_cases)]
        assert not missing, f"{key} not covered without phenomenon: {missing}"
    phenomena = {c["traits"].get("phenomenon") for c in cases}
    missing = [v for v in sampler.traits["phenomenon"]["values"] if v not in phenomena]
    assert not missing, f"phenomena not covered: {missing}"
    assert sum(c["image"] for c in cases) == 8
    return cases


def export_cases(out: Path, cfg: Config, sampler: TraitSampler, cap: Capture) -> list[dict]:
    cases = plan_cases(cfg, sampler)
    for case in cases:
        lods = {}
        for columns in LODS:
            want_image = case["image"] and columns == 192
            record, image = lod_record(columns, case["traits"], case["seed"], cap, want_image)
            lods[str(columns)] = record
            if want_image:
                rgb = np.asarray(image, dtype=np.uint8)
                record["image_2048_rgb_sha256"] = sha256(rgb.tobytes())
                small = image.resize((256, 256), Image.LANCZOS)
                (out / "images").mkdir(parents=True, exist_ok=True)
                small.save(out / "images" / f"{case['name']}.png", optimize=True)
        write_json(out / "cases" / f"{case['name']}.json", {
            "name": case["name"],
            "seed": big(case["seed"]),
            "fixed": case["fixed"],
            "traits": case["traits"],
            "dna": sampler.dna(case["traits"]),
            "image": f"images/{case['name']}.png" if case["image"] else None,
            "lods": lods,
        })
        print(f"  case {case['name']}: " + ", ".join(f"{c}={lods[str(c)]['dots_on']} dots" for c in LODS))
    return cases


# -------------------------------------------------------------------------------------------------------------- rng

def rng_ops():
    weights = [30, 22, 16, 10, 10, 6, 4, 2]
    p = np.array(weights, dtype=np.float64)
    p = p / p.sum()
    return [
        (["random"], lambda g: g.random()),
        (["integers", 0, 24], lambda g: g.integers(0, 24)),
        (["integers", 3, 8], lambda g: g.integers(3, 8)),
        (["integers", 5, 6], lambda g: g.integers(5, 6)),
        (["choice_p", weights], lambda g: g.choice(len(p), p=p)),
        (["choice_p", [1]], lambda g: g.choice(1, p=np.array([1.0]))),
        (["choice_sign"], lambda g: g.choice([-1, 1])),
        (["uniform", 0, math.pi], lambda g: g.uniform(0, math.pi)),
        (["uniform_n", -0.5, 0.5, 3], lambda g: g.uniform(-0.5, 0.5, 3)),
        (["random_n", 3], lambda g: g.random(3)),
        (["permutation", 10], lambda g: g.permutation(10)),
        (["choice_without_replacement", 50, 7], lambda g: g.choice(np.arange(50), size=7, replace=False)),
        (["choice_without_replacement", 400, 17], lambda g: g.choice(np.arange(400), size=17, replace=False)),
    ]


def export_rng(out: Path) -> None:
    s1 = token_seed(MASTER, 1)
    derive = [["token", MASTER, 1], ["a", 1], ["quotas", MASTER, "phenomenon"], ["shuffle", 1104202611],
              ["galaxia", "ñandú", 0], [""], [2 ** 64 - 1, "x"]]
    pcg_seeds = [0, 1, 12345, 2 ** 32 - 1, 2 ** 32, 3529837714663881650, 2 ** 63 + 12345, 2 ** 64 - 1]
    seq_seeds = [0, 12345, 3529837714663881650, s1, 2 ** 63 + 12345, 2 ** 64 - 1]
    ops = rng_ops()
    sequences = []
    for seed in seq_seeds:
        g = np.random.Generator(np.random.PCG64(seed))
        calls = []
        for r in range(64):
            shift = r % len(ops)
            for call, fn in ops[shift:] + ops[:shift]:
                calls.append([call, plain(fn(g))])
        sequences.append({"seed": big(seed), "calls": calls, "next_raw": hex(int(g.bit_generator.random_raw()))})
    pcg = []
    for seed in pcg_seeds:
        bg = np.random.PCG64(seed)
        st = bg.state["state"]
        raw = [hex(int(x)) for x in bg.random_raw(3)]
        doubles = np.random.Generator(np.random.PCG64(seed)).random(3)
        pcg.append({"seed": big(seed), "state": big(st["state"]), "inc": big(st["inc"]), "random_raw": raw,
                    "random": doubles})
    write_json(out / "rng.json", {
        "derive_seed": [{"parts": [big(p) if isinstance(p, int) else p for p in parts],
                         "part_types": ["int" if isinstance(p, int) else "str" for p in parts],
                         "value": big(derive_seed(*parts))} for parts in derive],
        "token_seed": [{"master": MASTER, "index": i, "value": big(token_seed(MASTER, i))} for i in (1, 2, 973, 9001)],
        "sub_seeds": {"seed": big(s1), "streams": {n: {"derive": big(derive_seed(s1, n)),
                                                        "seed32": sub_seed32(s1, n)} for n in STREAMS}},
        "pcg64": pcg,
        "sequences": sequences,
    })


# ----------------------------------------------------------------------------------------------------------- traits

FIXED_DRAWS = [
    {"size": "large"}, {"size": "colossal"}, {"palette": "antimatter"}, {"galaxy_type": "dwarf"},
    {"galaxy_type": "merger"}, {"core": "quasar"}, {"phenomenon": "relativistic_jets"},
    {"galaxy_type": "elliptical", "arms": "4"}, {"galaxy_type": "ring"}, {"inclination": "edge_on"},
    {"galaxy_type": "spiral", "phenomenon": "anomaly"}, {"palette": "prismatic", "background": "cmb"},
    {"galaxy_type": "dwarf", "size": "large"}, {"phenomenon": "einstein_ring"},
    {"star_density": "saturated", "core": "double_nucleus"},
]


def export_traits(out: Path, sampler: TraitSampler) -> None:
    def draw(seed, fixed=None):
        g = sub_rng(seed, "traits")
        traits = sampler.draw(g, fixed)
        return {"seed": big(seed), "fixed": fixed, "traits": traits, "dna": sampler.dna(traits),
                "violations": sampler.violations(traits), "next_random": g.random()}

    plain_draws = [{"index": i, **draw(token_seed(MASTER, i))} for i in range(1, 501)]
    fixed_draws = [draw(token_seed(MASTER, 5000 + 2 * n + r), fixed)
                   for n, fixed in enumerate(FIXED_DRAWS) for r in range(2)]
    assert len(fixed_draws) == 30
    for d in fixed_draws:
        if d["fixed"] == {"size": "large"}:
            assert d["traits"]["galaxy_type"] != "dwarf"
        if d["fixed"] == {"palette": "antimatter"}:
            assert d["traits"]["background"] == "deep_void"
    write_json(out / "traits.json", {"master": MASTER, "draw_order": sampler.order, "draws": plain_draws,
                                     "fixed_draws": fixed_draws})


# ------------------------------------------------------------------------------------------------- params and noise

APPENDIX_A_TOKENS = (1, 2, 4, 5, 7, 22, 46, 70)


def noise_points():
    pts = []
    for k in range(32):
        scale = 0.013 if k % 4 == 0 else (1.0 if k % 4 == 1 else 37.0)
        x = (k * 7.31 - 113.7) * scale / 10
        y = (k * 3.17 - 41.9) * scale / 10
        pts.append((x, y))
    pts[:6] = [(0.0, 0.0), (-1.0, -1.0), (2.0, -3.0), (-0.5, 0.5), (1e-9, -1e-9), (-123.75, 88.25)]
    return np.array([p[0] for p in pts]), np.array([p[1] for p in pts])


def export_params(out: Path, cfg: Config) -> None:
    plan = plan_collection(cfg)
    tokens = []
    for tid in APPENDIX_A_TOKENS:
        e = find_token(plan, tid)
        lods = {}
        for columns in LODS:
            grid = BrailleGrid(cfg.render["width"], cfg.render["height"], columns)
            center = grid.snap(0.0, 0.0)
            lods[str(columns)] = {"center": center, "uv_step": grid.uv_step,
                                  "params": params_dict(build_params(e.traits, e.seed, cfg.visuals, center=center))}
        tokens.append({"token_id": tid, "seed": big(e.seed), "traits": e.traits, "lods": lods})

    x, y = noise_points()
    seeds = [0, 1740554569, 4294967295, 12345]
    vectors = []
    for seed in seeds:
        f1, f2, f3 = noise.worley(x, y, seed)
        g1, g2, g3 = noise.worley(x, y, seed, jitter=1.0)
        vectors.append({
            "seed": seed,
            "hash": noise._hash(np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), seed),
            "value_noise": noise.value_noise(x, y, seed),
            "fbm": noise.fbm(x, y, seed),
            "fbm_3_2_0.6": noise.fbm(x, y, seed, octaves=3, lacunarity=2.0, gain=0.6),
            "warped_fbm": noise.warped_fbm(x, y, seed),
            "warped_fbm_1.0_3": noise.warped_fbm(x, y, seed, strength=1.0, octaves=3),
            "worley": [f1, f2, f3],
            "worley_jitter_1": [g1, g2, g3],
        })
    smooth_x = np.linspace(-0.25, 1.25, 16)
    write_json(out / "params.json", {
        "tokens": tokens,
        "noise": {"x": x, "y": y, "by_seed": vectors},
        "smoothstep": {"a": 0.2, "b": 0.7, "x": smooth_x, "value": noise.smoothstep(0.2, 0.7, smooth_x)},
        "grids": {str(c): grid_dict(BrailleGrid(cfg.render["width"], cfg.render["height"], c)) for c in LODS},
    }, indent=1)


def grid_dict(grid: BrailleGrid) -> dict:
    u, v = grid.dot_uv()
    return {"cell_w": grid.cell_w, "cell_h": grid.cell_h, "rows": grid.rows, "step": grid.step, "nx": grid.nx,
            "ny": grid.ny, "oy": grid.oy, "uv_step": grid.uv_step, "snap_origin": grid.snap(0.0, 0.0),
            "u_first": u[0, :3], "v_first": v[:3, 0], "u_last": u[0, -1], "v_last": v[-1, 0]}


# ----------------------------------------------------------------------------------------------------------- colors

def export_colors(out: Path, cfg: Config) -> None:
    xs = [k / 63 for k in range(64)]
    xs += [-0.2, 1.3, 0.5 / 1023, 1.5 / 1023, 2.5 / 1023, 511.5 / 1023, 1022.5 / 1023, 0.9999999]
    x = np.array(xs, dtype=np.float64)
    palettes = []
    for key in cfg.palettes:
        p = load_palette(cfg, key)
        palettes.append({
            "key": key, "mode": p.mode, "inverted": p.inverted, "angular": p.angular,
            "accent": p.accent, "background": p.background, "blackbody_mix": p.blackbody_mix,
            "detail": p.detail, "detail_regions": p.detail_regions, "detail_halo": p.detail_halo,
            "detail_stars": p.detail_stars, "postfx": p.postfx,
            "dtypes": {"lut": str(p.lut.dtype), "accent": str(p.accent.dtype)},
            "lut_sha256": sha256(np.ascontiguousarray(p.lut, dtype="<f4").tobytes()),
            "lut_cyclic_sha256": sha256(np.ascontiguousarray(p.lut_cyclic, dtype="<f4").tobytes()),
            "sample": p.sample(x), "sample_cyclic": p.sample_cyclic(x),
        })
    temps = np.array([1000, 1500, 1900, 2000, 3200, 4500, 5778, 6500, 6600, 6601, 10000, 14000], dtype=np.float64)
    bb = blackbody_linear(temps)
    write_json(out / "colors.json", {"lut_size": LUT_SIZE, "x": x, "palettes": palettes,
                                     "blackbody": {"temperature": temps, "linear": bb, "dtype": str(bb.dtype)}},
               indent=1)


# ----------------------------------------------------------------------------------------------------------- config

def export_config(out: Path, cfg: Config) -> None:
    """PyYAML's parse of the four YAML files (YAML 1.1 rules), with every key order the engine depends on."""
    traits = {k: v for k, v in cfg.traits.items() if k in ("draw_order", "traits", "rules")}
    orders = {"traits": list(cfg.traits["traits"]), "palettes": list(cfg.palettes)}
    for key, spec in cfg.traits["traits"].items():
        orders[f"traits.{key}.values"] = list(spec["values"])
    write_json(out / "config.json", {"traits": traits, "palettes": cfg.palettes, "visuals": cfg.visuals,
                                     "render": cfg.render, "postfx": cfg.postfx, "master_seed": cfg.master_seed,
                                     "orders": orders}, indent=1)


# ------------------------------------------------------------------------------------------------------------ check

def check(cap: Capture) -> None:
    cfg = Config()
    manifest = json.loads((GALAXY_NFT / "output" / "reports" / "manifest.json").read_text(encoding="utf-8"))
    entry = next(t for t in manifest["tokens"] if t["token_id"] == 1)
    plan_entry = find_token(plan_collection(cfg), 1)
    assert plan_entry.seed == entry["seed"] and plan_entry.traits == entry["traits"], "plan differs from manifest"
    image, text, _ = cap.render(cfg, plan_entry.traits, plan_entry.seed, want_image=True)
    lf = sha256(text.encode("utf-8"))
    crlf = sha256(text.replace("\n", "\r\n").encode("utf-8"))
    buf = io.BytesIO()
    image.save(buf, format="PNG", compress_level=6)
    png = sha256(buf.getvalue())
    problems = []
    if crlf != entry["braille_sha256"]:
        problems.append(f"braille CRLF sha256 {crlf} != manifest {entry['braille_sha256']}")
    if not lf.startswith(TOKEN1_BRAILLE_LF):
        problems.append(f"braille LF sha256 {lf} does not start with {TOKEN1_BRAILLE_LF}")
    if png != entry["image"]["sha256"]:
        problems.append(f"image sha256 {png} != manifest {entry['image']['sha256']}")
    if problems:
        print("token 1 FAILED:\n  " + "\n  ".join(problems))
        sys.exit(1)
    print(f"token 1 ok: braille sha256 {lf[:8]}…{lf[-4:]} (LF), image sha256 = manifest")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="re-render token #1 and compare with manifest.json")
    ap.add_argument("--out", type=Path, help="folder to write the golden references to")
    args = ap.parse_args()
    if not args.check and not args.out:
        ap.error("nothing to do: pass --check and/or --out")
    with Capture() as cap:
        if args.check:
            check(cap)
        if args.out:
            out = args.out
            cfg = Config()
            sampler = TraitSampler(cfg.traits)
            export_rng(out)
            export_traits(out, sampler)
            export_params(out, cfg)
            export_colors(out, cfg)
            export_config(out, cfg)
            cases = export_cases(out, cfg, sampler, cap)
            write_json(out / "meta.json", {
                "format": 1,
                "engine": f"galaxy-nft {galaxy_nft.__version__}",
                "python": platform.python_version(),
                "numpy": np.__version__, "scipy": scipy.__version__, "pillow": PIL.__version__,
                "master_seed": MASTER, "lods": LODS,
                "cases": [c["name"] for c in cases],
                "images": [c["name"] for c in cases if c["image"]],
                "image_resample": "PIL.Image.LANCZOS 2048 -> 256",
            }, indent=1)
            total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
            print(f"wrote {len(cases)} cases, {sum(c['image'] for c in cases)} images, {total / 1e6:.2f} MB to {out}")


if __name__ == "__main__":
    main()
