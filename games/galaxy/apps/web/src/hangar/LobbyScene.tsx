import { useEffect, useRef } from 'react';
import { spriteDataUrl } from '../arena/sprites';
import type { BiomeLook } from '../arena/stage/biomes';

// The lobby's living backdrop (the owner's «fondo épico, como si pasaran cosas»), drawn at a third of the screen and
// scaled up with crisp pixels. Things happen far away: stars drift in three depths, the sector's nebula breathes, shooting stars,
// fleets of real probes fly by with their trails, a skirmish against the Static flickers in a corner (lasers,
// explosions, new swarms), asteroids of the sector's biome tumble in front, and now and then a ship drops out of
// warp. Reduced motion: one still frame.

const SCALE = 3;

interface Star { x: number; y: number; z: number; tw: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Ship { img: HTMLImageElement; x: number; y: number; vx: number; vy: number; size: number }
interface Foe { a: number; r: number; speed: number; img: HTMLImageElement; hp: number }
interface Rock { img: HTMLImageElement; x: number; y: number; vx: number; vy: number; rot: number; spin: number; size: number }

function load(id: string, scale = 1): HTMLImageElement {
  const img = new Image();
  try {
    img.src = spriteDataUrl(id, scale);
  } catch {
    // An id this build does not have: drawn as nothing.
  }
  return img;
}

const ok = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

/** What the scene shows: the sector's biome (its nebula, stars and rocks), its fauna, and the probes that fly by. */
export interface SceneCast {
  look: BiomeLook;
  fauna: string[];
  probes: string[];
}

export function LobbyScene({ cast, reduced = false }: { cast: SceneCast; reduced?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const castRef = useRef(cast);
  useEffect(() => {
    castRef.current = cast;
  }, [cast]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    // No canvas here (a test's DOM, a blocked context): the lobby works without its backdrop.
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const fit = () => {
      w = Math.max(160, Math.round(canvas.clientWidth / SCALE));
      h = Math.max(90, Math.round(canvas.clientHeight / SCALE));
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = false;
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const stars: Star[] = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), z: Math.ceil(Math.random() * 3), tw: Math.random() * 6 }));
    const particles: Particle[] = [];
    const ships: Ship[] = [];
    const probes = castRef.current.probes.map((id) => load(id, 1));
    const faunaImgs = castRef.current.fauna.map((id) => load(id, 1));
    let foes: Foe[] = [];
    const rocks: Rock[] = [];
    let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let warp: { x: number; y: number; t: number; img: HTMLImageElement } | null = null;
    let nextFleet = 2;
    let nextShoot = 1.5;
    let nextWarp = 5;
    let nextSwarm = 0;
    let nextLaser = 0.4;
    let lasers: { x0: number; y0: number; x1: number; y1: number; life: number }[] = [];
    let t = 0;
    let last = performance.now();
    let raf = 0;

    const rockIds = castRef.current.look.rocks;
    for (let i = 0; i < 5; i++) {
      rocks.push({ img: load(rockIds[i % rockIds.length]!, 2), x: Math.random(), y: rnd(0.55, 1), vx: rnd(-0.004, -0.0015), vy: rnd(-0.001, 0.001), rot: Math.random() * 6, spin: rnd(-0.4, 0.4), size: rnd(0.8, 1.6) });
    }

    const burst = (x: number, y: number, color: string, n: number, speed = 30) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rnd(speed * 0.3, speed);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rnd(0.4, 0.9), color, size: Math.random() < 0.3 ? 2 : 1 });
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const look = castRef.current.look;
      // The deep: the sector's nebula, breathing.
      ctx.fillStyle = '#070a1c';
      ctx.fillRect(0, 0, w, h);
      const blobs = [
        { x: 0.3 + Math.sin(t * 0.05) * 0.05, y: 0.4, r: 0.55, c: look.nebula[0] },
        { x: 0.75 + Math.cos(t * 0.04) * 0.05, y: 0.3, r: 0.45, c: look.nebula[1] },
        { x: 0.55, y: 0.85 + Math.sin(t * 0.03) * 0.04, r: 0.5, c: look.nebula[2] },
      ];
      for (const b of blobs) {
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * Math.max(w, h));
        g.addColorStop(0, b.c);
        g.addColorStop(1, 'rgba(7,10,28,0)');
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      // Stars in three depths, drifting left, twinkling.
      for (const st of stars) {
        st.x -= (dt * 0.004 * st.z) / 3;
        if (st.x < 0) st.x += 1;
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + st.tw);
        ctx.globalAlpha = st.z === 3 ? 0.9 : st.z === 2 ? 0.6 * (0.6 + tw * 0.4) : 0.35 * tw + 0.15;
        ctx.fillStyle = st.z === 3 ? look.stars[0] : look.stars[1];
        const size = st.z === 3 && tw > 0.85 ? 2 : 1;
        ctx.fillRect(Math.floor(st.x * w), Math.floor(st.y * h), size, size);
      }
      ctx.globalAlpha = 1;

      // Shooting stars.
      nextShoot -= dt;
      if (!shooting && nextShoot <= 0) {
        shooting = { x: rnd(0.2, 1) * w, y: rnd(0, 0.35) * h, vx: -rnd(120, 200), vy: rnd(40, 80), life: 0 };
        nextShoot = rnd(2.5, 6);
      }
      if (shooting) {
        shooting.life += dt;
        shooting.x += shooting.vx * dt;
        shooting.y += shooting.vy * dt;
        for (let k = 0; k < 14; k++) {
          ctx.globalAlpha = (1 - k / 14) * Math.max(0, 1 - shooting.life);
          ctx.fillStyle = k < 2 ? '#ffffff' : look.stars[0];
          ctx.fillRect(Math.floor(shooting.x - (shooting.vx * k) / 160), Math.floor(shooting.y - (shooting.vy * k) / 160), 1, 1);
        }
        ctx.globalAlpha = 1;
        if (shooting.life > 1.1) shooting = null;
      }

      // The far skirmish: a swarm of the sector's fauna around a point, probes firing at it.
      const cx = w * 0.84;
      const cy = h * 0.2;
      nextSwarm -= dt;
      if (foes.length < 6 && nextSwarm <= 0 && faunaImgs.length) {
        for (let i = 0; i < 4; i++) foes.push({ a: Math.random() * 6.28, r: rnd(6, 18), speed: rnd(0.6, 1.4), img: faunaImgs[Math.floor(Math.random() * faunaImgs.length)]!, hp: Math.ceil(rnd(1, 4)) });
        nextSwarm = rnd(3, 5);
      }
      for (const f of foes) {
        f.a += f.speed * dt;
        const x = cx + Math.cos(f.a) * f.r;
        const y = cy + Math.sin(f.a) * f.r * 0.6;
        if (ok(f.img)) {
          ctx.globalAlpha = 0.85;
          ctx.drawImage(f.img, Math.floor(x - f.img.width / 4), Math.floor(y - f.img.height / 4), Math.ceil(f.img.width / 2), Math.ceil(f.img.height / 2));
          ctx.globalAlpha = 1;
        }
      }
      // Two defenders orbiting wide, firing.
      const defenders = [0, 1].map((i) => ({ x: cx + Math.cos(t * 0.5 + i * Math.PI) * 34, y: cy + Math.sin(t * 0.5 + i * Math.PI) * 14 }));
      defenders.forEach((d, i) => {
        const img = probes[(i + 1) % Math.max(1, probes.length)];
        if (img && ok(img)) ctx.drawImage(img, Math.floor(d.x - img.width / 4), Math.floor(d.y - img.height / 4), Math.ceil(img.width / 2), Math.ceil(img.height / 2));
      });
      nextLaser -= dt;
      if (nextLaser <= 0 && foes.length) {
        const d = defenders[Math.floor(Math.random() * 2)]!;
        const target = foes[Math.floor(Math.random() * foes.length)]!;
        const tx = cx + Math.cos(target.a) * target.r;
        const ty = cy + Math.sin(target.a) * target.r * 0.6;
        lasers.push({ x0: d.x, y0: d.y, x1: tx, y1: ty, life: 0 });
        target.hp--;
        if (target.hp <= 0) {
          burst(tx, ty, '#ff4d6d', 10, 22);
          burst(tx, ty, '#ffc94a', 6, 14);
          foes = foes.filter((f) => f !== target);
        }
        nextLaser = rnd(0.15, 0.5);
      }
      lasers = lasers.filter((l) => (l.life += dt) < 0.12);
      for (const l of lasers) {
        ctx.strokeStyle = '#6fe3ff';
        ctx.globalAlpha = 1 - l.life / 0.12;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.floor(l.x0) + 0.5, Math.floor(l.y0) + 0.5);
        ctx.lineTo(Math.floor(l.x1) + 0.5, Math.floor(l.y1) + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Fleets flying by, in formation, trails behind.
      nextFleet -= dt;
      if (nextFleet <= 0 && probes.length) {
        const y = rnd(0.12, 0.5) * h;
        const n = Math.floor(rnd(3, 6));
        const img = probes[Math.floor(Math.random() * probes.length)];
        const speed = rnd(28, 46);
        const size = Math.random() < 0.3 ? 1 : 0.6;
        for (let i = 0; i < n && img; i++) ships.push({ img, x: -10 - i * 9, y: y + (i % 2 ? 5 : -5) * (i > 0 ? 1 : 0), vx: speed, vy: rnd(-2, 2), size });
        nextFleet = rnd(5, 9);
      }
      for (const sh of ships) {
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        if (Math.random() < 0.6) particles.push({ x: sh.x - 3, y: sh.y, vx: -10, vy: rnd(-2, 2), life: 0, max: 0.6, color: Math.random() < 0.5 ? '#ffc94a' : '#ff9a3c', size: 1 });
        if (ok(sh.img)) ctx.drawImage(sh.img, Math.floor(sh.x - (sh.img.width * sh.size) / 2), Math.floor(sh.y - (sh.img.height * sh.size) / 2), Math.ceil(sh.img.width * sh.size), Math.ceil(sh.img.height * sh.size));
      }
      for (let i = ships.length - 1; i >= 0; i--) if (ships[i]!.x > w + 20) ships.splice(i, 1);

      // A ship dropping out of warp: a streak, a flash, then it drifts away.
      nextWarp -= dt;
      if (!warp && nextWarp <= 0 && probes.length) {
        warp = { x: rnd(0.1, 0.45) * w, y: rnd(0.15, 0.4) * h, t: 0, img: probes[Math.floor(Math.random() * probes.length)]! };
        nextWarp = rnd(7, 12);
      }
      if (warp) {
        warp.t += dt;
        const k = warp.t;
        if (k < 0.25) {
          ctx.fillStyle = '#bfe3ff';
          ctx.globalAlpha = 0.9;
          ctx.fillRect(Math.floor(warp.x - 60 * (1 - k * 4)), Math.floor(warp.y), Math.ceil(60 * (1 - k * 4)), 1);
        } else if (k < 0.4) {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 1 - (k - 0.25) / 0.15;
          ctx.fillRect(Math.floor(warp.x - 3), Math.floor(warp.y - 3), 7, 7);
        }
        ctx.globalAlpha = 1;
        if (k > 0.25 && ok(warp.img)) ctx.drawImage(warp.img, Math.floor(warp.x + (k - 0.25) * 14), Math.floor(warp.y - warp.img.height / 2));
        if (k > 0.3 && k < 0.32) burst(warp.x, warp.y, '#bfe3ff', 8, 18);
        if (k > 5) warp = null;
      }

      // Particles.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life += dt;
        if (p.life > p.max) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        ctx.globalAlpha = 1 - p.life / p.max;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // Asteroids in front, tumbling.
      for (const r of rocks) {
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.rot += r.spin * dt;
        if (r.x < -0.1) {
          r.x = 1.1;
          r.y = rnd(0.55, 1);
        }
        if (!ok(r.img)) continue;
        const rw = r.img.width * r.size * 0.5;
        const rh = r.img.height * r.size * 0.5;
        ctx.save();
        ctx.translate(Math.floor(r.x * w), Math.floor(r.y * h));
        ctx.rotate(Math.round(r.rot * 4) / 4);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(r.img, -rw / 2, -rh / 2, rw, rh);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [reduced]);

  return <canvas ref={ref} className="lobby-scene" aria-hidden="true" />;
}
