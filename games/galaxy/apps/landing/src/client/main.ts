// The landing's only script (plan «galaxysurvivor.es», PR 4; mock-up B «Viaje de la sonda», approved 2026-11-17).
// It adds motion to a page that is already complete without it: the probe's route and the sector light (desktop,
// motion allowed), the reveals, the clips that play only while seen, the header that turns solid, and the notice that
// replaces «Jugar gratis» on phones (the game needs a computer, like the game's own DesktopGate).
// Everything is set through classes, attributes and CSSOM, which the server's CSP allows.

import { isMobileDevice } from '@galaxy/shared/device';

const root = document.documentElement;
root.classList.add('js');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const wide = matchMedia('(min-width: 901px)');

// Header: solid once the page scrolls.
const header = document.getElementById('top');
const onTop = () => header?.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onTop, { passive: true });
onTop();

// Reveals: once each.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  },
  { threshold: 0.25 },
);
document.querySelectorAll('.lane, .txt, .levelup, .hand, .comm, .radio, .rooms').forEach((el) => io.observe(el));

// Clips: they download only when the visitor gets near (preload="none"), play only while on screen, never with
// reduced motion (the poster stays).
const clips = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting && !reduce.matches) void v.play().catch(() => undefined);
      else v.pause();
    }
  },
  { threshold: 0.2 },
);
document.querySelectorAll<HTMLVideoElement>('video.clip').forEach((v) => clips.observe(v));

// «Jugar gratis» on a phone or tablet: the same rule as the game's DesktopGate (@galaxy/shared/device). The device
// decides, never the screen's size: laptops at 125 % or 150 % report a smaller screen and must play (2026-11-27).
const dialog = document.getElementById('desktop-only') as HTMLDialogElement | null;
const canPlay = () => !isMobileDevice(window);
document.addEventListener('click', (ev) => {
  const link = (ev.target as Element | null)?.closest?.('[data-play]');
  if (!link || !dialog || canPlay()) return;
  ev.preventDefault();
  dialog.showModal();
});
const homeUrl = () => `${location.origin}/`;
dialog?.querySelector<HTMLButtonElement>('[data-share]')?.addEventListener('click', (ev) => {
  const b = ev.currentTarget as HTMLButtonElement;
  if (navigator.share) void navigator.share({ title: document.title, text: b.dataset.shareText ?? '', url: homeUrl() }).catch(() => undefined);
  else void copy(dialog.querySelector<HTMLButtonElement>('[data-copy]'));
});
dialog?.querySelector<HTMLButtonElement>('[data-copy]')?.addEventListener('click', (ev) => void copy(ev.currentTarget as HTMLButtonElement));
async function copy(button: HTMLButtonElement | null) {
  try {
    await navigator.clipboard.writeText(homeUrl());
    if (button?.dataset.copied) button.textContent = button.dataset.copied;
  } catch {
    // No clipboard (an old browser or no permission): the address bar still has the link.
  }
}

// The route: a dotted curve through every stop, lit up to where the probe is. data-anchor is where it crosses each
// stop (% of the width); data-dock ends it at the station.
const route = document.getElementById('route');
const svg = document.getElementById('route-svg');
const trail = document.getElementById('trail') as SVGPathElement | null;
const lit = document.getElementById('lit') as SVGPathElement | null;
const probe = document.getElementById('probe');
const clipRect = document.getElementById('clip-rect');
const sections = [...document.querySelectorAll<HTMLElement>('[data-biome]')];
const hp = document.getElementById('hp');
const hpN = document.getElementById('hp-n');
let routeLength = 0;
let built = false;
// Big screens zoom the whole page (landing.css): the route lives in layout pixels, the scroll in screen pixels.
const zoom = () => parseFloat(getComputedStyle(root).zoom) || 1;

function build() {
  if (!route || !svg || !trail || !lit) return;
  const on = wide.matches && !reduce.matches;
  root.classList.toggle('route-on', on);
  built = on;
  if (!on) return;
  const z = zoom();
  const H = document.documentElement.scrollHeight / z;
  const W = document.documentElement.clientWidth / z;
  route.style.height = `${H}px`;
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  const stops = [...document.querySelectorAll<HTMLElement>('[data-anchor]')];
  const first = stops[0]!;
  const pts: [number, number][] = [[W / 2, first.offsetTop + first.offsetHeight - 90]];
  stops.slice(1).forEach((s, i) => {
    if (s.hasAttribute('data-dock')) {
      const dock = s.querySelector('.dock')!.getBoundingClientRect();
      pts.push([(dock.left + dock.width / 2) / z, (dock.top + scrollY + dock.height * 0.62) / z]);
      return;
    }
    const y = s.offsetTop + s.offsetHeight / 2;
    const x = (Number(s.dataset.anchor) / 100) * W;
    const wobble = Math.abs(x - W / 2) < 2 ? Math.min(70, W * 0.04) : 0;
    pts.push([x + (i % 2 ? 1 : -1) * wobble, y - s.offsetHeight * 0.32]);
    pts.push([x + (i % 2 ? -1 : 1) * wobble, y + s.offsetHeight * 0.3]);
  });
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const my = (y0 + y1) / 2;
    d += ` C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`;
  }
  trail.setAttribute('d', d);
  lit.setAttribute('d', d);
  routeLength = lit.getTotalLength();
}

/** The length along the route whose point is at page height y (the route only goes down). */
function lengthAt(y: number) {
  let lo = 0;
  let hi = routeLength;
  for (let k = 0; k < 22; k++) {
    const m = (lo + hi) / 2;
    if (lit!.getPointAtLength(m).y < y) lo = m;
    else hi = m;
  }
  return lo;
}

let queued = false;
function update() {
  queued = false;
  const sy = scrollY;
  // The parallax follows the scroll only when motion is allowed.
  root.style.setProperty('--sy', reduce.matches ? '0' : String(sy));
  const z = zoom();
  const mid = (sy + innerHeight / 2) / z;
  const cur = sections.find((s) => s.offsetTop <= mid && s.offsetTop + s.offsetHeight > mid) ?? sections[0];
  if (cur) root.style.setProperty('--biome', cur.dataset.biome ?? '#3346b8');
  if (hp && hpN) {
    const p = Math.min(0.9, Math.max(0, (innerHeight * 0.85 - hp.getBoundingClientRect().top) / (innerHeight * 0.6)));
    hp.style.setProperty('--p', String(p));
    hpN.textContent = `${Math.round(100 - p * 100)} %`;
  }
  if (!built || !lit || !probe || !clipRect) return;
  const l = lengthAt((sy + innerHeight * 0.55) / z);
  const p = lit.getPointAtLength(l);
  const q = lit.getPointAtLength(Math.min(routeLength, l + 4));
  // On the launchpad it points up, waiting; once it moves it follows the route.
  const angle = l < 2 ? -90 : (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  probe.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${angle}deg)`;
  probe.style.setProperty('--thrust', l < 2 ? '0.35' : '1');
  clipRect.setAttribute('height', String(Math.max(0, p.y)));
}
const schedule = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
};
const rebuild = () => {
  build();
  update();
};
addEventListener('scroll', schedule, { passive: true });
addEventListener('resize', rebuild);
wide.addEventListener('change', rebuild);
reduce.addEventListener('change', rebuild);
// Fonts and images change the page's height: build again once everything has loaded.
addEventListener('load', rebuild);
void document.fonts?.ready.then(rebuild);
rebuild();
