"""Pure-Python reference of numpy SeedSequence + PCG64 + the Generator methods used by galaxy_nft.
Used to verify the algorithms documented in the digest (compares against numpy)."""
import hashlib
import math

M32 = 0xFFFFFFFF
M64 = (1 << 64) - 1
M128 = (1 << 128) - 1
INIT_A, MULT_A, INIT_B, MULT_B = 0x43B0D7E5, 0x931E8875, 0x8B51F9DD, 0x58F38DED
MIX_MULT_L, MIX_MULT_R = 0xCA01F9DD, 0x4973F715
PCG_MULT = (2549297995355413924 << 64) | 4865540595714422341


def derive_seed(*parts):
    text = "\x1f".join(str(p) for p in parts)
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")


def seedseq_state(entropy: int, n_words64=4):
    # entropy -> uint32 words, little-endian
    words = []
    if entropy == 0:
        words = [0]
    n = entropy
    while n > 0:
        words.append(n & M32)
        n >>= 32
    hc = [INIT_A]

    def hashmix(value):
        value = (value ^ hc[0]) & M32
        hc[0] = (hc[0] * MULT_A) & M32
        value = (value * hc[0]) & M32
        value ^= value >> 16
        return value

    def mix(x, y):
        r = (MIX_MULT_L * x - MIX_MULT_R * y) & M32
        r ^= r >> 16
        return r

    pool = [0] * 4
    for i in range(4):
        pool[i] = hashmix(words[i] if i < len(words) else 0)
    for s in range(4):
        for d in range(4):
            if s != d:
                pool[d] = mix(pool[d], hashmix(pool[s]))
    for s in range(4, len(words)):
        for d in range(4):
            pool[d] = mix(pool[d], hashmix(words[s]))
    # generate_state
    hb = INIT_B
    out32 = []
    for i in range(n_words64 * 2):
        v = pool[i % 4]
        v ^= hb
        hb = (hb * MULT_B) & M32
        v = (v * hb) & M32
        v ^= v >> 16
        out32.append(v)
    return [out32[2 * k] | (out32[2 * k + 1] << 32) for k in range(n_words64)]


class PCG64:
    def __init__(self, seed_int):
        s = seedseq_state(seed_int)
        initstate = (s[0] << 64) | s[1]
        initseq = (s[2] << 64) | s[3]
        self.inc = ((initseq << 1) | 1) & M128
        self.state = 0
        self._step()
        self.state = (self.state + initstate) & M128
        self._step()
        self.has32 = False
        self.u32 = 0

    def _step(self):
        self.state = (self.state * PCG_MULT + self.inc) & M128

    def next64(self):
        self._step()
        hi, lo = self.state >> 64, self.state & M64
        x = hi ^ lo
        rot = hi >> 58
        return ((x >> rot) | (x << ((64 - rot) & 63))) & M64

    def next32(self):
        if self.has32:
            self.has32 = False
            return self.u32
        n = self.next64()
        self.has32 = True
        self.u32 = n >> 32
        return n & M32

    def next_double(self):
        return (self.next64() >> 11) * (1.0 / 9007199254740992.0)


class Gen:
    def __init__(self, seed_int):
        self.b = PCG64(seed_int)

    def random(self, n=None):
        if n is None:
            return self.b.next_double()
        return [self.b.next_double() for _ in range(n)]

    def uniform(self, lo, hi, n=None):
        rng = float(hi) - float(lo)
        if n is None:
            return float(lo) + rng * self.b.next_double()
        return [float(lo) + rng * self.b.next_double() for _ in range(n)]

    def _lemire32(self, rng):  # inclusive range [0, rng], rng < 2^32-1
        excl = rng + 1
        m = self.b.next32() * excl
        left = m & M32
        if left < excl:
            thr = (M32 - rng) % excl
            while left < thr:
                m = self.b.next32() * excl
                left = m & M32
        return m >> 32

    def bounded(self, rng):  # random_bounded_uint64(off=0, rng, use_masked=0)
        if rng == 0:
            return 0
        if rng <= M32:
            if rng == M32:
                return self.b.next32()
            return self._lemire32(rng)
        raise NotImplementedError("64-bit lemire not needed")

    def integers(self, low, high=None, n=None):
        if high is None:
            low, high = 0, low
        rng = high - 1 - low
        if n is None:
            return low + self.bounded(rng)
        return [low + self.bounded(rng) for _ in range(n)]

    def interval(self, mx):  # random_interval (masked rejection), used by shuffle/permutation
        if mx == 0:
            return 0
        mask = mx
        for s in (1, 2, 4, 8, 16, 32):
            mask |= mask >> s
        if mx <= M32:
            while True:
                v = self.b.next32() & mask
                if v <= mx:
                    return v
        while True:
            v = self.b.next64() & mask
            if v <= mx:
                return v

    def permutation(self, n):
        arr = list(range(n))
        for i in range(n - 1, 0, -1):
            j = self.interval(i)
            arr[i], arr[j] = arr[j], arr[i]
        return arr

    def choice_p(self, weights_norm):
        cdf = []
        acc = 0.0
        for w in weights_norm:
            acc += w
            cdf.append(acc)
        last = cdf[-1]
        cdf = [c / last for c in cdf]
        u = self.b.next_double()
        return sum(1 for c in cdf if c <= u)  # searchsorted side='right'

    def choice_uniform(self, pop):  # choice(list) without p
        return self.integers(0, pop)

    def choice_noreplace(self, pop, size):
        # Floyd + hash set + _shuffle_int (Lemire), as in numpy Generator.choice
        set_size = int(1.2 * size)
        mask = set_size
        for s in (1, 2, 4, 8, 16, 32):
            mask |= mask >> s
        hs = [None] * (mask + 1)
        idx = [0] * size
        for j in range(pop - size, pop):
            val = self.bounded(j)
            loc = val & mask
            while hs[loc] is not None and hs[loc] != val:
                loc = (loc + 1) & mask
            if hs[loc] is None:
                hs[loc] = val
                idx[j - pop + size] = val
            else:
                loc = j & mask
                while hs[loc] is not None:
                    loc = (loc + 1) & mask
                hs[loc] = j
                idx[j - pop + size] = j
        for i in range(size - 1, 0, -1):
            jj = self.bounded(i)
            idx[i], idx[jj] = idx[jj], idx[i]
        return idx
