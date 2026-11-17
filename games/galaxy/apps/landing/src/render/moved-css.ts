// The stylesheet of the notice on the old address (render/moved.ts), served by the server at /galaxy/mudanza.css: a
// module rather than a .css file so the build and the tests read the same text (Vite's ?raw is empty under Vitest).
// One card in the game's look over a starry sky; its fonts come from the game's own /galaxy/fonts on the old host.
export const MOVED_CSS = `@font-face { font-family: 'Bungee'; font-weight: 400; font-display: swap; src: url('/galaxy/fonts/bungee-latin.woff2') format('woff2'); }
@font-face { font-family: 'Fredoka'; font-weight: 300 700; font-display: swap; src: url('/galaxy/fonts/fredoka-latin.woff2') format('woff2'); }
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; color: #f3f5ff; font-family: 'Fredoka', system-ui, sans-serif; font-size: 18px; line-height: 1.5; -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(900px 600px at 50% 35%, #3346b855, transparent 70%),
    radial-gradient(1px 1px at 20px 30px, #fff9 50%, transparent) 0 0 / 260px 260px,
    radial-gradient(1.5px 1.5px at 60px 120px, #ffc94aaa 50%, transparent) 0 0 / 380px 380px,
    radial-gradient(2px 2px at 100px 300px, #9b86ffcc 50%, transparent) 0 0 / 560px 560px,
    #070a1c;
}
.moved { min-height: 100%; display: grid; place-items: center; padding: 24px 16px; }
.card { width: min(520px, 100%); text-align: center; padding: 36px 32px 30px; border-radius: 28px; background: linear-gradient(180deg, #20234f, #181a3d);
  box-shadow: inset 0 2px 0 rgb(255 255 255 / .18), 0 7px 0 #0b0c24, 0 30px 60px rgb(0 0 0 / .5); }
.logo { display: block; margin: 0 auto 16px; border-radius: 16px; box-shadow: 0 0 40px rgb(255 201 74 / .25); }
h1 { font-family: 'Bungee', 'Fredoka', sans-serif; font-weight: 400; font-size: clamp(28px, 6vw, 40px); line-height: 1; margin: 0 0 16px; text-shadow: 0 5px 0 #0b0c24; text-wrap: balance; }
p { margin: 0 0 24px; color: #b9bfe6; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: .85em 1.8em; border-radius: 20px; font-weight: 700; font-size: 1.2rem; text-decoration: none;
  color: #3a1700; background: linear-gradient(180deg, #ffc94a, #ff9a3c); box-shadow: inset 0 2px 0 rgb(255 255 255 / .28), 0 6px 0 #c25f1c, 0 14px 26px rgb(0 0 0 / .35); transition: transform .18s; }
.btn:hover { transform: translateY(-2px); }
.btn:active { transform: translateY(6px); box-shadow: inset 0 2px 0 rgb(255 255 255 / .28), 0 0 0 #c25f1c; }
.btn:focus-visible { outline: 3px solid #bfe3ff; outline-offset: 4px; }
.note { margin: 22px 0 0; font-size: .95rem; color: #8890c4; }
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;
