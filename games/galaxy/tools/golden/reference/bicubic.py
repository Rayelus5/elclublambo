"""Check a model of Pillow's BICUBIC resample for mode 'F' against Pillow itself."""
import numpy as np
from PIL import Image


def cubic(x, a=-0.5):
    x = abs(x)
    if x < 1.0:
        return ((a + 2.0) * x - (a + 3.0)) * x * x + 1
    if x < 2.0:
        return (((x - 5) * x + 8) * x - 4) * a
    return 0.0


def coeffs(in_size, out_size, support=2.0):
    scale = in_size / out_size
    filterscale = max(scale, 1.0)
    sup = support * filterscale
    ss = 1.0 / filterscale
    out = []
    for xx in range(out_size):
        center = (xx + 0.5) * scale
        xmin = max(int(center - sup + 0.5), 0)
        xmax = min(int(center + sup + 0.5), in_size) - xmin
        k = [cubic((x + xmin - center + 0.5) * ss) for x in range(xmax)]
        ww = sum(k)
        k = [w / ww if ww != 0 else w for w in k]
        out.append((xmin, k))
    return out


def resize(a, W, H):
    h, w = a.shape
    ch = coeffs(w, W)
    tmp = np.zeros((h, W), dtype=np.float32)
    for y in range(h):
        for x, (xmin, k) in enumerate(ch):
            s = 0.0
            for i, kk in enumerate(k):
                s += float(a[y, xmin + i]) * kk
            tmp[y, x] = s
    cv = coeffs(h, H)
    out = np.zeros((H, W), dtype=np.float32)
    for y, (ymin, k) in enumerate(cv):
        for x in range(W):
            s = 0.0
            for i, kk in enumerate(k):
                s += float(tmp[ymin + i, x]) * kk
            out[y, x] = s
    return out


rng = np.random.default_rng(0)
a = rng.random((12, 12)).astype(np.float32) * 3
ref = np.asarray(Image.fromarray(a).resize((64, 64), Image.BICUBIC))
mine = resize(a, 64, 64)
d = np.abs(ref - mine)
print("max abs diff", d.max(), "exact equal fraction", np.mean(ref == mine))
