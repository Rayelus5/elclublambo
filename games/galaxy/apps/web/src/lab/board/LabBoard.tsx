import type { LabNodeView, LabView } from '@galaxy/shared';
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { copy, fmt } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { labIconUrl } from '../icons';
import { between, type Cam, centered, fitted, lodOf, nearestIn, zoomed } from './camera';
import { burst, playLevel, playOpen, playSelect } from './fx';
import { boundsOf, layoutBoard, NODE_RADIUS, type Point } from './layout';

// The Laboratorio's whiteboard (shop and lab plan, F3; the approved F0 mockup; DESIGN_SYSTEM §8 octies). One SVG: the
// permanent core and, while a season is open, the season's beside it; every node on its branch, its ring filled one
// segment per level; edges lit as they open. Drag to move (from 5 px, so a click is still a click), the wheel or two
// fingers to zoom towards them, +, − and 0, and the arrow keys from node to node ([ and ] up and down its branch).
// A node opens its panel (now and next level, cost, what is missing, «Mejorar»). A level bought fills its segment,
// the node bumps, sparks fly, energy runs to the nodes it opens and an arpeggio climbs; with reduced motion, no motion.
// The camera lives in a ref and is written straight to the SVG: no React render per frame.

const t = copy.lab;
const tb = copy.lab.board;
export const BRANCH_COLOR: Record<LabNodeView['branch'], string> = { probe: '#45e3a6', relics: '#9b86ff', station: '#6fb7ff', extraction: '#ffc94a' };
type Core = 'permanent' | 'season';
type State = 'locked' | 'available' | 'affordable' | 'maxed';
export type BoardNode = LabNodeView & Point & { core: Core; parent: string | null };

export function stateOf(n: LabNodeView, wallet: LabView['wallet']): State {
  if (!n.next) return 'maxed';
  if (!n.unlocked) return 'locked';
  return wallet.dust >= n.next.dust && (wallet['components'] ?? 0) >= n.next.components ? 'affordable' : 'available';
}

/** One segment per level: the bought ones drawn, the rest empty (the circle's pathLength is the node's max). */
export function segments(level: number, max: number): string {
  return Array.from({ length: max }, (_, i) => (i < level ? '0.86 0.14' : '0 1')).join(' ');
}

const shortDate = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(iso));

export function LabBoard({
  view,
  reduced,
  pending,
  onUpgrade,
  onRedshift,
}: {
  view: LabView;
  reduced: boolean;
  pending: boolean;
  onUpgrade: (n: BoardNode) => void;
  /** Opens the prestige, when it shows (null: no button). */
  onRedshift: (() => void) | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const fxLayer = useRef<SVGGElement>(null);
  const bg = useRef<SVGPatternElement>(null);
  const miniView = useRef<SVGRectElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, k: 0.6 });
  const tween = useRef(0);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef(new Map<string, SVGPathElement>());
  const [selected, setSelected] = useState<string | null>(null);
  const [legend, setLegend] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Where everything is (pure layout, kept while the tree's shape is the same).
  const shape = `${view.nodes.map((n) => `${n.id}<${n.requires ?? ''}`).join(',')}|${(view.season?.nodes ?? []).map((n) => `${n.id}<${n.requires ?? ''}`).join(',')}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => layoutBoard(view.nodes, view.season?.nodes ?? null), [shape]);
  const nodes: BoardNode[] = useMemo(() => {
    const out: BoardNode[] = [];
    const add = (list: LabNodeView[], core: Core, placed: { id: string; x: number; y: number; parent: string | null }[]) => {
      const at = new Map(placed.map((p) => [p.id, p]));
      for (const n of list) {
        const p = at.get(n.id);
        if (p) out.push({ ...n, x: p.x, y: p.y, parent: p.parent, core });
      }
    };
    add(view.nodes, 'permanent', layout.permanent.nodes);
    if (view.season && layout.season) add(view.season.nodes, 'season', layout.season.nodes);
    return out;
  }, [view, layout]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const all = useMemo(() => boundsOf([...nodes, layout.permanent.center, ...(layout.season ? [layout.season.center] : [])]), [nodes, layout]);

  const viewport = () => {
    const r = svg.current?.getBoundingClientRect();
    return { w: r?.width || 1, h: r?.height || 1, left: r?.left ?? 0, top: r?.top ?? 0 };
  };

  const apply = useCallback(() => {
    const c = cam.current;
    world.current?.setAttribute('transform', `translate(${c.x} ${c.y}) scale(${c.k})`);
    svg.current?.setAttribute('data-lod', lodOf(c.k));
    bg.current?.setAttribute('patternTransform', `translate(${c.x % 40} ${c.y % 40})`);
    const v = viewport();
    const m = miniView.current;
    if (m) {
      m.setAttribute('x', String(-c.x / c.k));
      m.setAttribute('y', String(-c.y / c.k));
      m.setAttribute('width', String(v.w / c.k));
      m.setAttribute('height', String(v.h / c.k));
    }
  }, []);

  const moveTo = useCallback(
    (to: Cam) => {
      cancelAnimationFrame(tween.current);
      if (reduced || typeof requestAnimationFrame !== 'function') {
        cam.current = to;
        apply();
        return;
      }
      const from = { ...cam.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 300);
        cam.current = between(from, to, k);
        apply();
        if (k < 1) tween.current = requestAnimationFrame(step);
      };
      tween.current = requestAnimationFrame(step);
    },
    [apply, reduced],
  );

  const fitBox = useCallback((box: ReturnType<typeof boundsOf>, animate = true) => {
    const v = viewport();
    // The toolbar and the map float over the bottom: fit above them.
    const to = fitted(box, { w: v.w, h: Math.max(1, v.h - 96) });
    if (animate) moveTo(to);
    else {
      cam.current = to;
      apply();
    }
  }, [apply, moveTo]);

  // First sight: everything; again whenever the board changes size.
  useLayoutEffect(() => {
    fitBox(all, false);
    const node = svg.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fitBox(all, false));
    ro.observe(node);
    return () => ro.disconnect();
    // Only once per tree shape: a level bought never moves the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // The wheel zooms towards the cursor (a native listener: React's is passive and cannot stop the page scrolling).
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewport();
      cam.current = zoomed(cam.current, Math.exp(-e.deltaY * 0.0015), e.clientX - v.left, e.clientY - v.top);
      apply();
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [apply]);

  // Dragging (one pointer) and pinching (two).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number } | null>(null);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('.lab-n')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      drag.current = null;
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const v = viewport();
      cam.current = zoomed(cam.current, d / pinch.current.d, (a!.x + b!.x) / 2 - v.left, (a!.y + b!.y) / 2 - v.top);
      pinch.current = { d };
      apply();
      return;
    }
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    if (!g.moved) svg.current?.setPointerCapture?.(e.pointerId);
    g.moved = true;
    svg.current?.classList.add('dragging');
    cam.current = { ...cam.current, x: g.cx + dx, y: g.cy + dy };
    apply();
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = drag.current;
    drag.current = null;
    svg.current?.classList.remove('dragging');
    // A click on the board itself (no drag) closes the panel.
    if (g && !g.moved) setSelected(null);
  };

  const zoomCenter = (f: number) => {
    const v = viewport();
    cam.current = zoomed(cam.current, f, v.w / 2, v.h / 2);
    apply();
  };

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      playSelect();
      const n = byId.get(id);
      if (!n) return;
      // Keep it in sight beside the panel.
      const v = viewport();
      const sx = n.x * cam.current.k + cam.current.x;
      const sy = n.y * cam.current.k + cam.current.y;
      if (sx < 60 || sx > v.w - 440 || sy < 60 || sy > v.h - 60) moveTo(centered(cam.current, n, { w: Math.max(1, v.w - 420), h: v.h }));
    },
    [byId, moveTo],
  );

  const focusNode = (id: string | null | undefined) => {
    if (!id) return;
    nodeRefs.current.get(id)?.focus();
  };
  const onNodeKey = (e: KeyboardEvent<SVGGElement>, n: BoardNode) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(n.id);
      return;
    }
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
    if (dir) {
      e.preventDefault();
      focusNode(nearestIn(nodes, n, dir)?.id);
    } else if (e.key === '[') focusNode(n.parent);
    else if (e.key === ']') focusNode(nodes.find((x) => x.parent === n.id)?.id);
  };
  const onBoardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === '+' || e.key === '=') zoomCenter(1.2);
    else if (e.key === '-') zoomCenter(1 / 1.2);
    else if (e.key === '0') fitBox(all);
    else if (e.key === 'Escape' && selected) {
      e.stopPropagation();
      const id = selected;
      setSelected(null);
      focusNode(id);
    }
  };

  // A level bought: its segment fills (the new view), the node bumps, sparks fly, energy runs to what it opens.
  const levels = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const now = new Map(nodes.map((n) => [n.id, n.level]));
    const before = levels.current;
    levels.current = now;
    if (!before) return;
    for (const n of nodes) {
      const was = before.get(n.id);
      if (was === undefined || n.level <= was) continue;
      playLevel(n.level, n.max);
      // The toast comes on the next tick (not a state change inside this effect's own pass).
      if (n.level >= n.max) setTimeout(() => setToast(tb.maxedToast(n.name)), 0);
      if (reduced) continue;
      const g = nodeRefs.current.get(n.id);
      g?.classList.add('levelup');
      setTimeout(() => g?.classList.remove('levelup'), 500);
      if (fxLayer.current) burst(fxLayer.current, n.x, n.y, n.level >= n.max ? '#ffc94a' : BRANCH_COLOR[n.branch]);
      if (was === 0) {
        nodes
          .filter((c) => c.parent === n.id)
          .forEach((c, i) => {
            playOpen(i);
            const edge = edgeRefs.current.get(c.id);
            edge?.classList.add('flow');
            setTimeout(() => edge?.classList.remove('flow'), 1400);
          });
      }
    }
  }, [nodes, reduced]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(id);
  }, [toast]);

  const sel = selected ? byId.get(selected) : undefined;
  const coreOf = (c: Core) => (c === 'permanent' ? layout.permanent : layout.season!);
  const goCore = (c: Core) => fitBox(boundsOf([...nodes.filter((n) => n.core === c), coreOf(c).center]));
  const pad = 200;

  return (
    <div className="lab-board" onKeyDown={onBoardKey}>
      <svg
        ref={svg}
        className="lab-svg"
        data-lod="mid"
        role="group"
        aria-label={tb.label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <radialGradient id="lab-core-permanent">
            <stop offset="0" stopColor="#fff5cc" />
            <stop offset=".35" stopColor="#ffc94a" />
            <stop offset=".7" stopColor="#ff9a3c" stopOpacity=".6" />
            <stop offset="1" stopColor="#ff9a3c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lab-core-season">
            <stop offset="0" stopColor="#f1eaff" />
            <stop offset=".35" stopColor="#9b86ff" />
            <stop offset=".7" stopColor="#7259ee" stopOpacity=".6" />
            <stop offset="1" stopColor="#7259ee" stopOpacity="0" />
          </radialGradient>
          <pattern ref={bg} id="lab-dots" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="1.4" className="lab-dot" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lab-dots)" />
        <g ref={world}>
          <g className="lab-edges">
            {nodes.map((n) => {
              const p = n.parent ? byId.get(n.parent) : null;
              const from = p ?? coreOf(n.core).center;
              const c = coreOf(n.core).center;
              const mx = (from.x + n.x) / 2;
              const my = (from.y + n.y) / 2;
              const qx = mx + (mx - c.x) * 0.08;
              const qy = my + (my - c.y) * 0.08;
              const lit = n.unlocked;
              return (
                <path
                  key={n.id}
                  ref={(el) => void (el ? edgeRefs.current.set(n.id, el) : edgeRefs.current.delete(n.id))}
                  d={`M${from.x} ${from.y} Q${qx} ${qy} ${n.x} ${n.y}`}
                  className={`lab-edge${lit ? ' lit' : ''}`}
                  style={{ '--c': BRANCH_COLOR[n.branch] } as CSSProperties}
                />
              );
            })}
          </g>
          {(['permanent', 'season'] as const).map((c) => {
            if (c === 'season' && (!layout.season || !view.season)) return null;
            const center = coreOf(c).center;
            return (
              <g key={c} className={`lab-core ${c}`}>
                <circle cx={center.x} cy={center.y} r={120} fill={`url(#lab-core-${c})`} opacity={0.55} />
                <circle cx={center.x} cy={center.y} r={62} className="lab-core-ring" />
                <circle cx={center.x} cy={center.y} r={40} fill={`url(#lab-core-${c})`} className="lab-core-heart" />
                <text x={center.x} y={center.y + 96} className="lab-core-title">
                  {c === 'permanent' ? tb.permanent : view.season!.name}
                </text>
                <text x={center.x} y={center.y + 118} className="lab-core-sub">
                  {c === 'permanent' ? tb.forever : tb.resets(shortDate(view.season!.endsAt))}
                </text>
              </g>
            );
          })}
          <g className="lab-nodes">
            {nodes.map((n) => {
              const st = stateOf(n, view.wallet);
              const url = labIconUrl(n.id);
              return (
                <g
                  key={n.id}
                  ref={(el) => void (el ? nodeRefs.current.set(n.id, el) : nodeRefs.current.delete(n.id))}
                  className={`lab-n ${st}${selected === n.id ? ' sel' : ''}`}
                  transform={`translate(${n.x} ${n.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={tb.node(n.name, n.level, n.max, tb.states[st])}
                  aria-pressed={selected === n.id}
                  style={{ '--c': BRANCH_COLOR[n.branch] } as CSSProperties}
                  onClick={(e) => {
                    e.stopPropagation();
                    select(n.id);
                  }}
                  onKeyDown={(e) => onNodeKey(e, n)}
                >
                  <circle r={NODE_RADIUS - 1} className="lab-ring-bg" pathLength={n.max} strokeDasharray={segments(n.max, n.max)} transform="rotate(-90)" />
                  <circle r={NODE_RADIUS - 1} className="lab-ring" pathLength={n.max} strokeDasharray={segments(n.level, n.max)} transform="rotate(-90)" />
                  <circle r={26} className="lab-disc" />
                  {url ? (
                    <svg x={-15} y={-15} width={30} height={30} viewBox="0 0 24 24" className="lab-glyph-art" aria-hidden="true">
                      <image href={url} width={48} height={24} />
                    </svg>
                  ) : (
                    <circle r={8} className="lab-glyph" />
                  )}
                  <text y={54} className="lab-label">
                    {n.name}
                  </text>
                  <text y={70} className="lab-label lvl">
                    {`${n.level} / ${n.max}`}
                  </text>
                </g>
              );
            })}
          </g>
          <g ref={fxLayer} className="lab-fx" aria-hidden="true" />
        </g>
      </svg>

      <div className="lip panel lab-tools" role="toolbar" aria-label={tb.tools}>
        <button type="button" className="lip lab-tool" aria-label={tb.zoomIn} title={tb.zoomIn} onClick={() => zoomCenter(1.25)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="lip lab-tool" aria-label={tb.zoomOut} title={tb.zoomOut} onClick={() => zoomCenter(0.8)}>
          <span aria-hidden="true">−</span>
        </button>
        <button type="button" className="lip lab-tool wide" onClick={() => fitBox(all)}>
          {tb.fit}
        </button>
        <button type="button" className="lip lab-tool wide" onClick={() => goCore('permanent')}>
          <span className="lab-dotmark permanent" aria-hidden="true" />
          {tb.permanent}
        </button>
        {layout.season && view.season ? (
          <button type="button" className="lip lab-tool wide" onClick={() => goCore('season')}>
            <span className="lab-dotmark season" aria-hidden="true" />
            {tb.season}
          </button>
        ) : null}
        <button type="button" className="lip lab-tool wide" aria-expanded={legend} onClick={() => setLegend((x) => !x)}>
          {tb.legend}
        </button>
        {onRedshift ? (
          <button type="button" className="lip lab-tool wide" onClick={onRedshift}>
            {tb.redshift}
          </button>
        ) : null}
      </div>

      {legend ? (
        <div className="lip panel lab-legend">
          <h3>{tb.legendTitle}</h3>
          <ul>
            <li>
              <svg width="30" height="30" viewBox="-20 -20 40 40" aria-hidden="true">
                <circle r="14" className="lab-legend-locked" />
              </svg>
              {tb.legendItems.locked}
            </li>
            <li>
              <svg width="30" height="30" viewBox="-20 -20 40 40" aria-hidden="true">
                <circle r="14" className="lab-legend-available" />
              </svg>
              {tb.legendItems.available}
            </li>
            <li>
              <svg width="30" height="30" viewBox="-20 -20 40 40" aria-hidden="true">
                <circle r="14" className="lab-legend-disc" />
                <circle r="18" className="lab-legend-ring" pathLength="5" strokeDasharray={segments(2, 5)} transform="rotate(-90)" />
              </svg>
              {tb.legendItems.segments}
            </li>
            <li>
              <svg width="30" height="30" viewBox="-20 -20 40 40" aria-hidden="true">
                <circle r="14" className="lab-legend-maxed" />
                <circle r="18" className="lab-legend-maxed-ring" />
              </svg>
              {tb.legendItems.maxed}
            </li>
            {view.season ? (
              <li>
                <span className="lab-dotmark season" aria-hidden="true" />
                {tb.legendItems.season}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="lip panel lab-mini">
        <svg
          viewBox={`${all.minX - pad} ${all.minY - pad} ${all.maxX - all.minX + pad * 2} ${all.maxY - all.minY + pad * 2}`}
          role="img"
          aria-label={tb.minimap}
          onClick={(e) => {
            const node = e.currentTarget;
            const ctm = node.getScreenCTM?.();
            if (!ctm) return;
            const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
            moveTo(centered(cam.current, pt, viewport()));
          }}
        >
          {nodes.map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r={18} className={`lab-mini-n ${stateOf(n, view.wallet)}${n.level > 0 ? ' some' : ''}`} style={{ '--c': BRANCH_COLOR[n.branch] } as CSSProperties} />
          ))}
          <circle cx={layout.permanent.center.x} cy={layout.permanent.center.y} r={50} className="lab-mini-core permanent" />
          {layout.season ? <circle cx={layout.season.center.x} cy={layout.season.center.y} r={46} className="lab-mini-core season" /> : null}
          <rect ref={miniView} className="lab-mini-view" rx={20} />
        </svg>
      </div>

      {sel ? <NodePanel node={sel} view={view} parentName={sel.parent ? (byId.get(sel.parent)?.name ?? sel.requires ?? '') : (sel.requires ?? '')} pending={pending} onUpgrade={onUpgrade} onClose={() => (setSelected(null), focusNode(sel.id))} /> : null}

      <p className="lip panel lab-toast" role="status" aria-live="polite">
        {toast}
      </p>
    </div>
  );
}

function NodePanel({ node, view, parentName, pending, onUpgrade, onClose }: { node: BoardNode; view: LabView; parentName: string; pending: boolean; onUpgrade: (n: BoardNode) => void; onClose: () => void }) {
  const st = stateOf(node, view.wallet);
  const next = node.next;
  const short = next ? { dust: Math.max(0, next.dust - view.wallet.dust), components: Math.max(0, next.components - (view.wallet['components'] ?? 0)) } : null;
  const color = BRANCH_COLOR[node.branch];
  const coreName = node.core === 'permanent' ? tb.permanent : (view.season?.name ?? tb.season);
  return (
    <aside className="lip panel lab-side" aria-label={node.name} style={{ '--c': node.level >= node.max ? '#ffc94a' : color } as CSSProperties}>
      <button type="button" className="lip iconbtn lab-side-close" aria-label={tb.close} title={tb.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      <span className="lab-side-branch">
        <span className="lab-dotmark" aria-hidden="true" />
        {tb.ofCore(coreName, t.branches[node.branch])}
      </span>
      <h2>{node.name}</h2>
      <p className="lab-side-effect">{t.effect(node.effect, node.per)}</p>
      <div className="lab-side-levels" role="img" aria-label={t.level(node.level, node.max)}>
        {Array.from({ length: node.max }, (_, i) => (
          <i key={i} className={i < node.level ? 'on' : undefined} />
        ))}
      </div>
      <div className="lab-side-gain">
        <div>
          <small>{tb.now}</small>
          <b>{tb.gain(node.effect.kind, node.now)}</b>
        </div>
        <span className="lab-side-arrow" aria-hidden="true">
          ➜
        </span>
        <div>
          <small>{tb.next}</small>
          <b>{next ? tb.gain(node.effect.kind, node.now + node.nextGain) : t.maxed}</b>
        </div>
      </div>
      {next ? (
        <div className="lab-side-cost" aria-label={t.cost(next.dust, next.components)}>
          <span className={short && short.dust > 0 ? 'short' : undefined}>
            <Icon name="dust" />
            {fmt(next.dust)}
          </span>
          {next.components > 0 ? (
            <span className={short && short.components > 0 ? 'short' : undefined}>
              <Icon name="wrench" />
              {fmt(next.components)}
            </span>
          ) : null}
        </div>
      ) : null}
      {st === 'locked' ? <p className="lab-side-req">{t.needs(parentName)}</p> : null}
      {st === 'available' && short ? <p className="lab-side-req">{t.missing(short.dust, short.components)}</p> : null}
      {node.core === 'season' && view.season ? <p className="lab-side-season">{tb.resets(shortDate(view.season.endsAt))}</p> : null}
      <button type="button" className="lip pill pill-solar lab-side-up" disabled={st !== 'affordable' || pending} aria-busy={pending || undefined} onClick={() => onUpgrade(node)}>
        {st === 'maxed' ? t.maxed : st === 'locked' ? tb.locked : st === 'available' ? tb.short : t.upgrade(node.level + 1)}
      </button>
    </aside>
  );
}
