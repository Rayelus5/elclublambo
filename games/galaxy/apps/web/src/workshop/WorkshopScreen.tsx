import type { HangarView, ProbeCard } from '@galaxy/shared';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useGacha } from '../api/economy';
import { useChooseProbe, useHangar } from '../api/runs';
import { spriteDataUrl } from '../arena/sprites';
import { errorText } from '../auth/useMe';
import { copy, quirkText } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import bayUrl from './art/bay.png';
import { ProbeLevel, Unlock, WeaponPicker } from './parts';
import { playEquip, playLevelUp } from './sfx';

// The probe workshop (the owner's «taller espacial»): every probe in the roster (locked ones say what earns them), the
// one you look at on the bay (painted in Aseprite, art/workshop/paint-workshop.lua: arms that weld, screens, the
// cradle), and its sheet: what it is, its level with the next one's cost, its starting weapon. Looking at a probe is
// not equipping it: «Equipar» is the bay's one action. Levelling up is celebrated: welding sparks, a flash, the new
// level and a sound. `?sonda=` opens one (the hangar's probe leads here).

const t = copy.workshop;
const BAY_W = 128;
const BAY_H = 72;

/** The bay's pixel size: the biggest whole number of screen pixels per art pixel that fits its box (measured as soon
 * as the box exists, and again whenever it changes size). */
function useBayScale() {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [px, setPx] = useState(4);
  useEffect(() => {
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setPx(Math.max(2, Math.floor(Math.min(r.width / BAY_W, r.height / BAY_H))));
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [el]);
  return { ref, px };
}

/** Welding sparks from the probe, a ring of light and the new level, for a moment. */
function Celebration({ level, reduced }: { level: number; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (reduced) return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const w = (c.width = c.clientWidth);
    const h = (c.height = c.clientHeight);
    const sparks = Array.from({ length: 90 }, () => {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 360;
      return { x: w / 2, y: h * 0.55, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0, max: 0.5 + Math.random() * 0.7, hot: Math.random() < 0.6 };
    });
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const s of sparks) {
        s.life += dt;
        if (s.life > s.max) continue;
        alive++;
        s.vy += 520 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const k = 1 - s.life / s.max;
        ctx.globalAlpha = k;
        ctx.fillStyle = s.hot ? (k > 0.6 ? '#fff8e0' : '#ffc94a') : '#6fe3ff';
        ctx.fillRect(Math.round(s.x), Math.round(s.y), 3, 3);
      }
      if (alive) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return (
    <div className="workshop-celebrate" role="status">
      <span className="workshop-flash" aria-hidden="true" />
      <canvas ref={canvas} className="workshop-sparks" aria-hidden="true" />
      <span className="workshop-banner">
        <b>{t.levelBanner(level)}</b>
        <small>{t.levelDone}</small>
      </span>
    </div>
  );
}

function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="workshop-stat">
      <span>{label}</span>
      <span className="workshop-stat-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <i style={{ inlineSize: `${Math.min(100, (value / max) * 100)}%` }} />
      </span>
      <b>{value}</b>
    </div>
  );
}

function Roster({ view, selected, onSelect }: { view: HangarView; selected: string; onSelect: (id: string) => void }) {
  return (
    <nav className="lip panel workshop-roster" aria-label={t.roster}>
      <h2 className="workshop-kicker">{t.roster}</h2>
      <ul aria-label={t.roster}>
        {view.probes.map((p) => {
          const equipped = p.id === view.probe;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-label={p.name}
                aria-pressed={p.id === selected}
                className={`workshop-pick${p.unlocked ? '' : ' locked'}${equipped ? ' equipped' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="workshop-pick-art">
                  <img src={spriteDataUrl(p.sprite, 3)} alt="" />
                  {!p.unlocked ? <Icon name="lock" /> : null}
                </span>
                <span className="workshop-pick-text">
                  <b>{p.name}</b>
                  {equipped ? <small className="workshop-equipped">{t.equipped}</small> : p.unlocked ? <small>{copy.hangar.level(p.level, p.maxLevel)}</small> : <Unlock card={p} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sheet({ probe, maxHp, maxSpeed, onLeveled }: { probe: ProbeCard; maxHp: number; maxSpeed: number; onLeveled: (level: number) => void }) {
  return (
    <aside className="lip panel workshop-info" aria-label={t.sheet}>
      <section className="workshop-section" aria-label={t.sheet}>
        <h3>{t.sheet}</h3>
        <p className="workshop-desc">{probe.description}</p>
        <StatBar label={copy.hangar.hp} value={probe.hp} max={maxHp} />
        <StatBar label={copy.hangar.speed} value={probe.speed} max={maxSpeed} />
        {probe.quirk ? (
          <p className="workshop-quirk">
            <b>{copy.probeTest.quirk}</b>
            <span>{quirkText(probe.quirk)}</span>
          </p>
        ) : null}
      </section>
      {probe.unlocked ? (
        <>
          <section className="workshop-section" aria-label={t.upgrade}>
            <h3>{t.upgrade}</h3>
            <ProbeLevel probe={probe} onLeveled={onLeveled} />
          </section>
          <section className="workshop-section">
            <WeaponPicker probe={probe} />
          </section>
        </>
      ) : (
        <section className="workshop-section workshop-how" aria-label={t.how}>
          <h3>{t.how}</h3>
          <div className="workshop-how-row">
            <Unlock card={probe} />
          </div>
        </section>
      )}
    </aside>
  );
}

export function WorkshopScreen() {
  const hangar = useHangar();
  const gacha = useGacha();
  const choose = useChooseProbe();
  const reduced = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const [celebrate, setCelebrate] = useState<{ level: number; key: number } | null>(null);
  const [clamp, setClamp] = useState(0);
  const { ref: bayRef, px } = useBayScale();
  useEffect(() => {
    if (!celebrate) return;
    const id = setTimeout(() => setCelebrate(null), 2600);
    return () => clearTimeout(id);
  }, [celebrate]);

  const view = hangar.data;
  if (view && !view.test.taken) return <Navigate to="/sonda" replace />;
  const selectedId = params.get('sonda') ?? view?.probe ?? '';
  const probe = view?.probes.find((p) => p.id === selectedId) ?? view?.probes.find((p) => p.id === view.probe);
  const equipped = !!view && !!probe && probe.id === view.probe;
  const pending = choose.isPending;
  const maxHp = Math.max(1, ...(view?.probes.map((p) => p.hp) ?? [1]));
  const maxSpeed = Math.max(1, ...(view?.probes.map((p) => p.speed) ?? [1]));

  return (
    <div className="screen-root workshop-root">
      <div className="workshop">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={gacha.data?.wallet} components />
          </div>
        </header>
        {!view || !probe ? (
          <p className="workshop-loading" role="status">
            {copy.loading}
          </p>
        ) : (
          <div className="workshop-grid">
            <Roster view={view} selected={probe.id} onSelect={(id) => setParams({ sonda: id }, { replace: true })} />
            <section className="workshop-bay" aria-label={t.bay(probe.name)}>
              <div className="workshop-bay-frame" ref={bayRef}>
                <div className="workshop-bay-art" style={{ '--px': `${px}px`, backgroundImage: `url(${bayUrl})` } as CSSProperties}>
                  <span className="workshop-scan" aria-hidden="true" />
                  <img
                    key={`${probe.id}-${clamp}`}
                    className={`workshop-probe${probe.unlocked ? '' : ' locked'}${clamp ? ' clamped' : ''}`}
                    src={spriteDataUrl(probe.sprite, 12)}
                    alt=""
                  />
                  {celebrate ? <Celebration key={celebrate.key} level={celebrate.level} reduced={reduced} /> : null}
                </div>
              </div>
              <div className="workshop-plate">
                <h2>{probe.name}</h2>
                <span className="workshop-pips" aria-label={copy.hangar.level(probe.level, probe.maxLevel)}>
                  {Array.from({ length: probe.maxLevel }, (_, i) => (
                    <i key={i} className={i < probe.level ? 'on' : undefined} />
                  ))}
                </span>
                {probe.unlocked ? (
                  <button
                    type="button"
                    className={`lip workshop-equip${equipped ? ' done' : ''}`}
                    disabled={equipped || pending}
                    aria-busy={pending || undefined}
                    onClick={() =>
                      choose.mutate(probe.id, {
                        onSuccess: () => {
                          playEquip();
                          setClamp((n) => n + 1);
                        },
                      })
                    }
                  >
                    <Icon name={equipped ? 'check' : 'probe'} />
                    <span>{equipped ? t.equipped : t.equip}</span>
                  </button>
                ) : (
                  <button type="button" className="lip workshop-equip locked" disabled>
                    <Icon name="lock" />
                    <span>{t.locked}</span>
                  </button>
                )}
                {!equipped && probe.unlocked ? <small className="workshop-equip-hint">{t.equipHint}</small> : null}
                {choose.error ? (
                  <p className="field-error" role="alert">
                    {errorText(choose.error, copy.errors)}
                  </p>
                ) : null}
              </div>
            </section>
            <Sheet
              key={probe.id}
              probe={probe}
              maxHp={maxHp}
              maxSpeed={maxSpeed}
              onLeveled={(level) => {
                playLevelUp();
                setCelebrate({ level, key: Date.now() });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
