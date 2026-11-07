// The arena's sprite colours (DESIGN_SYSTEM §2.1 tokens and the engine palettes). One key per colour, shared by
// every sprite so the whole field reads as one set.
export const P: Record<string, string> = {
  k: '#0b0c24', // outline (--panel-lip)
  w: '#f3f5ff', // white (--ink)
  i: '#bfe3ff', // ice
  b: '#6fb7ff', // light blue
  d: '#3a58e0', // blue
  D: '#26389a', // deep blue
  c: '#6fe3ff', // Static cyan / visor
  s: '#ffc94a', // Solar
  o: '#ff9a3c', // Solar 2
  r: '#c25f1c', // Solar lip
  m: '#ff4d6d', // Static
  n: '#ff6b7a', // Nova
  e: '#e8435a', // Nova 2
  x: '#9c2238', // Nova lip
  z: '#4a0f22', // wine
  U: '#b39dff', // lilac
  u: '#7259ee', // UV
  a: '#5a43d6', // UV 2
  p: '#3a2a9a', // UV lip
  g: '#45e3a6', // Terminal
  G: '#17b07e', // Terminal 2
  h: '#0b7352', // Terminal lip
  y: '#8890c4', // grey
  Y: '#b9bfe6', // light grey
  t: '#2a2f5e', // steel dark
  T: '#4b5390', // steel
};
