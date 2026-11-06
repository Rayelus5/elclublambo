import numpy as np
from scipy.ndimage import gaussian_filter


def kernel(sigma):
    r = int(4.0 * float(sigma) + 0.5)
    x = np.arange(-r, r + 1)
    phi = np.exp(-0.5 / (sigma * sigma) * x ** 2)
    return (phi / phi.sum()), r


def corr1d(line, w, r):  # line: float64 list, mode constant 0; symmetric kernel path
    n = len(line)
    pad = [0.0] * r + list(line) + [0.0] * r
    out = []
    for i in range(n):
        c = i + r
        acc = pad[c] * w[r]
        for jj in range(-r, 0):
            acc += (pad[c + jj] + pad[c - jj]) * w[r + jj]
        out.append(acc)
    return out


def gf(a, sigma):
    w, r = kernel(sigma)
    w = w.tolist()
    out = a.astype(np.float32).copy()
    for axis in (0, 1):
        src = out.copy()
        if axis == 0:
            for x in range(a.shape[1]):
                out[:, x] = np.array(corr1d(src[:, x].astype(np.float64).tolist(), w, r), dtype=np.float64).astype(np.float32)
        else:
            for y in range(a.shape[0]):
                out[y, :] = np.array(corr1d(src[y, :].astype(np.float64).tolist(), w, r), dtype=np.float64).astype(np.float32)
    return out


rng = np.random.default_rng(5)
a = (rng.random((40, 37)) ** 4 * 3).astype(np.float32)
for s in (1.125, 3.375, 9.0):
    ref = gaussian_filter(a[..., None], sigma=(s, s, 0), mode="constant")[..., 0]
    mine = gf(a, s)
    print(s, "exact:", np.array_equal(ref, mine), "max abs diff", float(np.abs(ref - mine).max()))
