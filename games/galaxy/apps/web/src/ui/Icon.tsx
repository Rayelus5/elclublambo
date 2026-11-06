/** Inline SVG icons (DESIGN_SYSTEM §7): 24×24, round 2.2 px strokes, decorative unless given a label. The title-screen
 * set comes from the approved demo's sprite (titulo-v2.html). */
const PATHS = {
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.6A9.9 9.9 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.2 4M6.6 6.7C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
      <path d="M9.9 9.9a3 3 0 004.2 4.2" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16.2 9.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.5v.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
  exit: (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="M9.5 8l-4 4 4 4" />
      <path d="M5.5 12H15" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.5 6.5a4 4 0 00-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 005.2-5.2l-2.5 2.5-2.5-.5-.5-2.5z" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12l6.5-6.5" />
    </>
  ),
  store: (
    <>
      <path d="M3.5 9L5.5 4h13l2 5z" />
      <path d="M5 9v11h14V9" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v11H10l-5 4v-4H4z" />
      <path d="M8 10h8" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7.5l8.5 6 8.5-6" />
    </>
  ),
  dust: (
    <>
      <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" fill="currentColor" stroke="none" />
      <path d="M19 3v4M17 5h4" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity=".22" />
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v9M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 7h18v3.2a2 2 0 000 3.6V17H3v-3.2a2 2 0 000-3.6z" />
      <path d="M14.5 7.5v9" strokeDasharray="1.6 2.2" />
    </>
  ),
  cards: (
    <>
      <rect x="8" y="3" width="12" height="16" rx="2.2" />
      <path d="M5 6.5v12a2.5 2.5 0 002.5 2.5H16" />
      <circle cx="14" cy="11" r="2.2" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 01-8 0z" />
      <path d="M8 6H5a3 3 0 003 3.5M16 6h3a3 3 0 01-3 3.5" />
      <path d="M12 13v4M8.5 20h7" />
    </>
  ),
  clan: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M12 8v8M8.5 11.5h7" />
    </>
  ),
  podium: (
    <>
      <path d="M9 21V9h6v12" />
      <path d="M3 21v-7h6" />
      <path d="M15 12h6v9" />
      <path d="M2 21h20" />
      <path d="M12 3.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.6l2-.3z" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5h6.5A2.5 2.5 0 0113 7v13a2 2 0 00-2-2H4z" />
      <path d="M20 4.5h-6.5A2.5 2.5 0 0011 7v13a2 2 0 012-2h7z" />
    </>
  ),
  probe: (
    <>
      <path d="M12 3c3 2.5 4.5 6 4.5 10l-2 3h-5l-2-3C7.5 9 9 5.5 12 3z" />
      <circle cx="12" cy="10" r="1.8" />
      <path d="M9.5 16l-2.5 4M14.5 16l2.5 4M12 16v5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  comet: (
    <>
      <circle cx="16.5" cy="7.5" r="3.5" />
      <path d="M13.8 10.2L4 20M11.5 7.5L5.5 13.5M16.5 12.5l-6 6" />
    </>
  ),
  list: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M3.5 6l1.4 1.4L7.5 4.8M3.5 12l1.4 1.4 2.6-2.6M3.5 18l1.4 1.4 2.6-2.6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22" />
    </>
  ),
  station: (
    <>
      <path d="M3 20h18" />
      <path d="M5 20v-5h14v5" />
      <path d="M7.5 15a4.5 4.5 0 019 0" />
      <path d="M12 10.5V6.5l3.5-3" />
    </>
  ),
  back: (
    <>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  fuse: (
    <>
      <path d="M5 5l5.5 5.5M19 5l-5.5 5.5M12 13v7" />
      <circle cx="12" cy="11" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  flip: (
    <>
      <path d="M4.5 10.5a7.6 7.6 0 0 1 13.2-3.6L20 9M20 4.5V9h-4.5" />
      <path d="M19.5 13.5a7.6 7.6 0 0 1-13.2 3.6L4 15M4 19.5V15h4.5" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.6" />
      <path d="M8.3 10.5V8a3.7 3.7 0 0 1 7.4 0v2.5" />
    </>
  ),
  play: (
    <>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, className = 'ico' }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  );
}
