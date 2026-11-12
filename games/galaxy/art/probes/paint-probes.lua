-- Galaxy Survivor: the eight playable probes at 24 × 24 (plan «banda sonora, skins, perfil y entorno», part B). The
-- owner, after a first shaded try: «quiero que la skin base de las sondas sea lo más minimalista posible como los
-- diseños originales». So each probe keeps the silhouette and the colours of its 16 × 16 grid, drawn flat like it:
-- three tones per part from the arena's palette (its fill, a light edge to the top left, a dark edge to the bottom
-- right), no dithering, a 1 px #0b0c24 contour, and four idle frames (the engine flickers, the core breathes, the
-- navigation lights blink). Facing right, the engine on the left. The bodies leave a margin round them: the skins
-- (part C) grow their own shapes there.
--
-- Run from games/galaxy:
--   aseprite -b --script-param out=art/probes --script-param web=apps/web/src/arena/sprites \
--     [--script-param preview=<folder>] [--script-param only=<id>] --script art/probes/paint-probes.lua
-- It saves art/probes/<id>.aseprite (layers «casco» and «luces»), its 4-frame strip art/probes/<id>.png, an 8× preview
-- sheet when asked, and the generated module apps/web/src/arena/sprites/probe-art.ts the game draws from. The skins
-- (part C, SKINS below) go to art/probes/skins/<probe>-<collection>.* and to SKIN_ART (ids `skin-<probe>-<line>`).
local W, H, FRAMES = 24, 24, 4
local OUT = app.params['out']
local WEB = app.params['web']
local PREVIEW = app.params['preview']
local ONLY = app.params['only']
local OUTLINE = '#0b0c24'

-- Three tones per material: dark edge, fill, light edge (the arena's palette, apps/web/src/arena/sprites/palette.ts).
local R = {
  ice = { '#6fb7ff', '#bfe3ff', '#f3f5ff' },
  steel = { '#2a2f5e', '#4b5390', '#b9bfe6' },
  plate = { '#8890c4', '#b9bfe6', '#f3f5ff' },
  uv = { '#3a2a9a', '#7259ee', '#b39dff' },
  lilac = { '#5a43d6', '#b39dff', '#f3f5ff' },
  cyan = { '#3a58e0', '#6fe3ff', '#f3f5ff' },
  terminal = { '#0b7352', '#17b07e', '#45e3a6' },
  solar = { '#c25f1c', '#ff9a3c', '#ffc94a' },
  engine = { '#c25f1c', '#ff9a3c', '#ffc94a' },
}

-- ── Shapes: a material grid (what each pixel is made of) ────────────────────────────────────────────────────────
local function grid()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function inside(x, y) return x >= 0 and y >= 0 and x < W and y < H end
local function set(M, x, y, m) if inside(x, y) then M[y][x] = m end end
local function ellipse(M, cx, cy, rx, ry, m)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if ((x + 0.5 - cx) / rx) ^ 2 + ((y + 0.5 - cy) / ry) ^ 2 <= 1 then M[y][x] = m end
    end
  end
end
local function rect(M, x0, y0, x1, y1, m)
  for y = y0, y1 do for x = x0, x1 do set(M, x, y, m) end end
end
local function rrect(M, x0, y0, x1, y1, r, m)
  for y = y0, y1 do
    for x = x0, x1 do
      local dx = math.max(x0 + r - x, 0, x - (x1 - r))
      local dy = math.max(y0 + r - y, 0, y - (y1 - r))
      if dx * dx + dy * dy <= r * r + 0.5 then set(M, x, y, m) end
    end
  end
end
local function poly(M, pts, m)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local px, py, odd = x + 0.5, y + 0.5, false
      local j = #pts
      for i = 1, #pts do
        local xi, yi, xj, yj = pts[i][1], pts[i][2], pts[j][1], pts[j][2]
        if (yi > py) ~= (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi then odd = not odd end
        j = i
      end
      if odd then M[y][x] = m end
    end
  end
end
local function line(M, x0, y0, x1, y1, m)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do set(M, math.floor(x0 + (x1 - x0) * i / n + 0.5), math.floor(y0 + (y1 - y0) * i / n + 0.5), m) end
end

-- ── The eight probes: shapes and the tones of each material ─────────────────────────────────────────────────────
-- Materials: hull, hull2, trim, trim2, glass, core, dark (an inner contour), engine, light. `nozzle`: how far behind
-- the centre the exhaust is (px); `lights`: the blinking lights' tones.
local PROBES = {}

PROBES['probe-lumen'] = function(M)
  ellipse(M, 12.5, 12, 7.6, 5.8, 'hull')
  poly(M, { { 9, 6.5 }, { 15, 6.5 }, { 11.5, 2.5 }, { 7.5, 2.5 } }, 'trim')
  poly(M, { { 9, 17.5 }, { 15, 17.5 }, { 11.5, 21.5 }, { 7.5, 21.5 } }, 'trim')
  ellipse(M, 16.4, 12, 3.4, 3.2, 'dark')
  ellipse(M, 16.6, 12, 2.4, 2.2, 'glass')
  rect(M, 3, 10, 4, 13, 'engine')
  set(M, 8, 3, 'light'); set(M, 8, 20, 'light')
  return { hull = R.ice, trim = R.plate, glass = R.cyan, lights = R.cyan, nozzle = 9 }
end

PROBES['probe-bastion'] = function(M)
  rrect(M, 4, 4, 18, 17, 2, 'hull')
  rect(M, 19, 8, 20, 13, 'hull')
  rrect(M, 7, 7, 15, 14, 2, 'trim')
  ellipse(M, 11.5, 10.5, 3.2, 3.2, 'dark')
  ellipse(M, 11.5, 10.5, 2.2, 2.2, 'core')
  rect(M, 5, 18, 8, 20, 'trim2'); rect(M, 14, 18, 17, 20, 'trim2')
  rect(M, 2, 8, 3, 13, 'engine')
  set(M, 6, 5, 'light'); set(M, 16, 16, 'light')
  return { hull = R.steel, trim = R.plate, trim2 = R.steel, core = R.solar, lights = R.solar, nozzle = 10 }
end

PROBES['probe-spark'] = function(M)
  poly(M, { { 4, 4 }, { 11, 7 }, { 21.5, 12 }, { 11, 17 }, { 4, 20 }, { 8, 12 } }, 'hull')
  poly(M, { { 8.5, 8.5 }, { 16.5, 11.4 }, { 16.5, 12.6 }, { 8.5, 15.5 }, { 10.5, 12 } }, 'trim')
  poly(M, { { 13, 10 }, { 16, 12 }, { 13, 14 }, { 10, 12 } }, 'core')
  rect(M, 4, 11, 7, 12, 'engine')
  set(M, 5, 5, 'light'); set(M, 5, 18, 'light')
  return { hull = R.uv, trim = R.lilac, core = R.cyan, lights = R.lilac, nozzle = 8 }
end

PROBES['probe-sentinel'] = function(M)
  ellipse(M, 12, 12.5, 7.4, 6.2, 'hull')
  line(M, 12, 6, 12, 5, 'trim')
  ellipse(M, 12.5, 3.5, 1.4, 1.4, 'light')
  ellipse(M, 13.4, 12.2, 3.2, 3.2, 'dark')
  ellipse(M, 13.4, 12.2, 2.2, 2.2, 'glass')
  set(M, 14, 11, 'core')
  rect(M, 8, 18, 9, 20, 'trim2'); rect(M, 15, 18, 16, 20, 'trim2')
  rect(M, 3, 10, 4, 13, 'engine')
  return { hull = R.terminal, trim = R.plate, trim2 = R.steel, glass = R.cyan, core = R.plate, lights = R.terminal, nozzle = 9 }
end

PROBES['probe-anchor'] = function(M)
  poly(M, { { 8.5, 3 }, { 15.5, 3 }, { 20.5, 8 }, { 20.5, 16 }, { 15.5, 21 }, { 8.5, 21 }, { 3.5, 16 }, { 3.5, 8 } }, 'hull')
  poly(M, { { 9.5, 6 }, { 14.5, 6 }, { 17.5, 9 }, { 17.5, 15 }, { 14.5, 18 }, { 9.5, 18 }, { 6.5, 15 }, { 6.5, 9 } }, 'trim')
  rrect(M, 9, 9, 15, 15, 1, 'dark')
  ellipse(M, 12.5, 12.5, 2.6, 2.6, 'core')
  rect(M, 1, 10, 2, 13, 'engine')
  set(M, 20, 11, 'light'); set(M, 20, 12, 'light')
  return { hull = R.steel, trim = R.plate, core = R.lilac, lights = R.uv, nozzle = 11 }
end

PROBES['probe-prism'] = function(M)
  poly(M, { { 12, 2 }, { 21.5, 12 }, { 12, 22 }, { 2.5, 12 } }, 'hull')
  for y = 0, H - 1 do for x = 12, W - 1 do if M[y][x] == 'hull' then M[y][x] = 'hull2' end end end
  rect(M, 11, 7, 12, 16, 'core')
  poly(M, { { 12, 4 }, { 15.5, 8.5 }, { 12, 7 } }, 'trim')
  rect(M, 1, 11, 2, 12, 'engine')
  set(M, 12, 3, 'light'); set(M, 12, 20, 'light')
  return { hull = R.ice, hull2 = R.uv, trim = R.lilac, core = R.cyan, lights = R.lilac, nozzle = 11 }
end

PROBES['probe-comet'] = function(M)
  poly(M, { { 2, 11 }, { 6, 10 }, { 11.5, 8 }, { 11.5, 16 }, { 6, 14 }, { 2, 13 } }, 'hull2')
  ellipse(M, 15.5, 12, 5.4, 4.6, 'hull')
  ellipse(M, 17.6, 11.6, 2, 1.7, 'glass')
  set(M, 20, 12, 'light')
  return { hull = R.ice, hull2 = R.cyan, glass = R.cyan, lights = R.ice, nozzle = 10, tail = true }
end

PROBES['probe-echo'] = function(M)
  ellipse(M, 12, 13, 8, 5.2, 'hull')
  poly(M, { { 8.5, 4.5 }, { 15.5, 4.5 }, { 16.5, 7.5 }, { 7.5, 7.5 } }, 'trim')
  rect(M, 9, 12, 15, 14, 'dark')
  set(M, 11, 13, 'glass'); set(M, 13, 13, 'glass')
  rect(M, 7, 18, 8, 20, 'trim2'); rect(M, 15, 18, 16, 20, 'trim2')
  rect(M, 2, 11, 3, 14, 'engine')
  set(M, 12, 5, 'light')
  return { hull = R.solar, trim = R.steel, trim2 = R.steel, glass = R.plate, lights = R.solar, nozzle = 10 }
end

local ORDER = { 'probe-lumen', 'probe-bastion', 'probe-spark', 'probe-sentinel', 'probe-anchor', 'probe-prism', 'probe-comet', 'probe-echo' }

-- ── Flat tones: the fill, a light edge where the part meets something to its top or left, a dark one to its
-- bottom or right (a part one pixel thin keeps its fill) ──────────────────────────────────────────────────────────
local function toneOf(M, x, y)
  local m = M[y][x]
  local function other(qx, qy) return not inside(qx, qy) or M[qy][qx] ~= m end
  local lit = other(x, y - 1) or other(x - 1, y)
  local shade = other(x, y + 1) or other(x + 1, y)
  if lit and not shade then return 3 end
  if shade and not lit then return 1 end
  return 2
end

-- Engine, core and lights through the four frames.
local ENGINE = { 3, 2, 3, 1 }
local CORE = { 2, 2, 3, 2 }

--- One frame's colours: { casco = {y = {x = colour}}, luces = … } and the merged frame.
local function paint(M, look, f)
  local casco, luces = grid(), grid()
  local n = look.frames or FRAMES
  local beat = look.engineBeat or ENGINE
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local m = M[y][x]
      if m == 'engine' then
        luces[y][x] = (look.engine or R.engine)[beat[f % #beat + 1]]
      elseif m == 'light' then
        local tones = look.lights or R.cyan
        luces[y][x] = tones[f % 4 < 2 and 3 or 1]
      elseif m == 'core' then
        -- Its fill breathes up to the light tone once a loop; its top-left edge stays lit.
        luces[y][x] = (look.core or R.cyan)[toneOf(M, x, y) == 3 and 3 or CORE[f % #CORE + 1]]
      elseif m == 'dark' then
        casco[y][x] = OUTLINE
      elseif m == 'rivet' then
        casco[y][x] = look.rivet or R.plate[3]
      elseif m and look.glowing and look.glowing[m] then
        -- A part that gives light (a skin's polyps): it breathes with the core.
        luces[y][x] = look[m][toneOf(M, x, y) == 3 and 3 or CORE[f % #CORE + 1]]
      elseif m then
        local tones = look[m] or look.hull
        casco[y][x] = tones[toneOf(M, x, y)]
      end
    end
  end
  -- The comet's tail: darker toward its end, a light streak running along it frame by frame.
  if look.tail then
    for y = 0, H - 1 do
      for x = 0, 11 do
        if M[y][x] == 'hull2' then
          local t = x < 6 and 1 or 2
          if toneOf(M, x, y) == 3 then t = 3 end
          if y == 12 and (x + f * 3) % 6 < 2 then t = 3 end
          casco[y][x] = look.hull2[t]
        end
      end
    end
  end
  -- A skin's moving parts (part C), drawn before the contour so they get one too.
  if look.animate then look.animate(M, casco, luces, f, n, look.box) end
  -- The contour: every empty pixel touching the drawing (4-neighbourhood), against the drawing before it.
  local merged = grid()
  for y = 0, H - 1 do for x = 0, W - 1 do merged[y][x] = luces[y][x] or casco[y][x] end end
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if not merged[y][x] then
        for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
          local qx, qy = x + d[1], y + d[2]
          if inside(qx, qy) and merged[qy][qx] and merged[qy][qx] ~= OUTLINE then
            casco[y][x] = OUTLINE
            break
          end
        end
      end
    end
  end
  for y = 0, H - 1 do for x = 0, W - 1 do merged[y][x] = luces[y][x] or casco[y][x] end end
  -- And what floats round it (sparks), in the empty space after the contour.
  if look.around then look.around(merged, luces, f, n) end
  return casco, luces, merged
end

-- ── Output ──────────────────────────────────────────────────────────────────────────────────────────────────────
local COLOURS = {}
local function colour(c)
  local v = COLOURS[c]
  if not v then
    v = app.pixelColor.rgba(tonumber(c:sub(2, 3), 16), tonumber(c:sub(4, 5), 16), tonumber(c:sub(6, 7), 16), 255)
    COLOURS[c] = v
  end
  return v
end
local function image(L, scale)
  scale = scale or 1
  local img = Image(W * scale, H * scale, ColorMode.RGB)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local c = L[y][x]
      if c then for sy = 0, scale - 1 do for sx = 0, scale - 1 do img:drawPixel(x * scale + sx, y * scale + sy, colour(c)) end end end
    end
  end
  return img
end

local KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
local generated = {}
local nozzles = {}
local previews = {}

local function build(id, M, look, file, group)
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1], spr:newLayer() }
  layers[1].name = 'casco'
  layers[2].name = 'luces'
  local count = look.frames or FRAMES
  local frames, palette, keyOf, n = {}, {}, {}, 0
  for f = 1, count do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 1 / (look.fps or 8)
    local casco, luces, merged = paint(M, look, f - 1)
    spr:newCel(layers[1], f, image(casco), Point(0, 0))
    spr:newCel(layers[2], f, image(luces), Point(0, 0))
    local rows = {}
    for y = 0, H - 1 do
      local row = {}
      for x = 0, W - 1 do
        local c = merged[y][x]
        if c then
          if not keyOf[c] then
            n = n + 1
            keyOf[c] = KEYS:sub(n, n)
            palette[#palette + 1] = { keyOf[c], c }
          end
          row[#row + 1] = keyOf[c]
        else
          row[#row + 1] = '.'
        end
      end
      rows[#rows + 1] = table.concat(row)
    end
    frames[f] = rows
    previews[group] = previews[group] or {}
    table.insert(previews[group], { id = id, f = f, img = image(merged, 8) })
  end
  assert(n <= #KEYS, id .. ': too many colours')
  spr:saveAs(OUT .. '/' .. file .. '.aseprite')
  local sheet = Image(W * count, H, ColorMode.RGB)
  for f = 1, count do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(OUT .. '/' .. file .. '.png')
  spr:close()
  generated[#generated + 1] = { id = id, palette = palette, frames = frames, skin = group ~= 'probes', fps = look.fps or 8 }
  nozzles[#nozzles + 1] = { id = id, rear = look.nozzle }
end

-- ── Skins (part C): four collections across the eight probes, each skin a design of its own ─────────────────────
-- The owner: «que las skins ya tengan diseños diferentes» and flat like the base. A collection keeps the probe's body
-- (who it is) and grows its own parts round it in the margin the bodies leave: Chatarra is patched up from salvage,
-- Coral grows branches and polyps, Aurora is swept back with a ribbon of polar light, Leyenda wears a gold crown and
-- prow with sparks round it. Aurora and Leyenda move (six and eight frames); every skin keeps the idle life of its
-- probe (engine, core, lights).

R.rust = { '#5a1d10', '#a04a22', '#d98a4a' }
R.scrap = { '#2a2f5e', '#6a6e8e', '#a8acc4' }
R.paint = { '#2c4436', '#4f7a58', '#8ab48a' }
R.amber = { '#a05a10', '#f0a830', '#ffe08a' }
R.coral = { '#9c2238', '#e8435a', '#ff8fb3' }
R.reef = { '#3a2a9a', '#8e2bb3', '#e05cff' }
R.sea = { '#13867f', '#3fe0d0', '#b4fff0' }
R.deep = { '#0a4a52', '#13867f', '#3fe0d0' }
R.glow = { '#17b07e', '#45e3a6', '#d8fff0' }
R.night = { '#1a2156', '#26389a', '#3a58e0' }
R.auroraG = { '#17b07e', '#45e3a6', '#d8fff0' }
R.auroraV = { '#5a43d6', '#b39dff', '#f0e6ff' }
R.obsidian = { '#0e0b1c', '#241c3a', '#3e3260' }
R.royal = { '#4a0f6a', '#8e2bb3', '#e05cff' }
R.gold = { '#a0661a', '#ffc94a', '#fff2b8' }

local function hullBox(M)
  local x0, y0, x1, y1 = W, H, -1, -1
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local m = M[y][x]
      if m == 'hull' or m == 'hull2' then
        x0, y0, x1, y1 = math.min(x0, x), math.min(y0, y), math.max(x1, x), math.max(y1, y)
      end
    end
  end
  return { x0 = x0, y0 = y0, x1 = x1, y1 = y1, cx = math.floor((x0 + x1) / 2 + 0.5), cy = math.floor((y0 + y1) / 2 + 0.5) }
end
-- Only where nothing is drawn yet: a skin's parts grow round the body, never over it.
local function grow(M, x, y, m) if inside(x, y) and not M[y][x] then M[y][x] = m end end
local function isHull(m) return m == 'hull' or m == 'hull2' end
-- Over the body's plating too (never its glass, core, engine or lights): a skin's bigger parts sit on its edge.
local function over(M, x, y, m)
  if not inside(x, y) then return end
  local was = M[y][x]
  if not was or was == 'hull' or was == 'hull2' or was == 'trim' or was == 'trim2' then M[y][x] = m end
end
local function block(M, x0, y0, x1, y1, m) for y = y0, y1 do for x = x0, x1 do over(M, x, y, m) end end end
-- A filled polygon of a skin's part, over the body's plating like `over`.
local function polyOver(M, pts, m)
  local T = grid()
  poly(T, pts, m)
  for y = 0, H - 1 do for x = 0, W - 1 do if T[y][x] then over(M, x, y, m) end end end
end
-- A line two pixels thick.
local function thick(M, x0, y0, x1, y1, m)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do
    local x = math.floor(x0 + (x1 - x0) * i / n + 0.5)
    local y = math.floor(y0 + (y1 - y0) * i / n + 0.5)
    over(M, x, y, m); over(M, x + 1, y, m)
  end
end
local function topAt(M, x)
  for y = 0, H - 1 do if isHull(M[y][x]) then return y end end
end
local function bottomAt(M, x)
  for y = H - 1, 0, -1 do if isHull(M[y][x]) then return y end end
end
local function backAt(M, y)
  for x = 0, W - 1 do if isHull(M[y][x]) then return x end end
end
local function frontAt(M, y)
  for x = W - 1, 0, -1 do if isHull(M[y][x]) then return x end end
end

local SKINS = {
  -- Chatarra: rebuilt from salvage. Rust with a panel of old paint, a bent antenna with an amber lamp, a scrap box
  -- bolted under it, a chip off its nose, and an engine that sputters.
  {
    line = 'chatarra',
    look = { hull = R.rust, hull2 = R.paint, trim = R.scrap, trim2 = R.scrap, glass = R.amber, core = R.amber, lights = R.amber, patch = R.paint, box = R.scrap, pipe = R.scrap, rivet = '#e0d2b0', engineBeat = { 3, 1, 3, 2 } },
    shape = function(M)
      local b = hullBox(M)
      -- A chip off the nose, top front.
      for y = b.y0, b.y0 + 1 do
        for x = b.x1 - 1, b.x1 do if isHull(M[y][x]) and y == topAt(M, x) then M[y][x] = nil end end
      end
      -- A smokestack at the back, its cap a pixel wider.
      local sx = b.x0 + 2
      local top = topAt(M, sx + 1) or b.y0
      block(M, sx, top - 3, sx + 1, top + 1, 'pipe')
      block(M, sx - 1, top - 4, sx + 2, top - 4, 'pipe')
      -- An armour slab bolted on top, a rivet at each end.
      local ax0, ax1 = b.cx, math.min(b.x1 - 2, b.cx + 4)
      local atop = topAt(M, b.cx + 1) or b.y0
      block(M, ax0, atop - 1, ax1, atop, 'box')
      over(M, ax0, atop - 1, 'rivet'); over(M, ax1, atop - 1, 'rivet')
      -- A panel of old paint on the body.
      local px, py = b.cx - 2, b.cy + 1
      for y = py, py + 1 do for x = px, px + 2 do if isHull(M[y][x]) then M[y][x] = 'patch' end end end
    end,
  },
  -- Coral: grown, not built. Coral and reef with sea-green parts, two branching stalks on top, glowing polyps under
  -- it and fronds trailing behind that sway.
  {
    line = 'coral',
    look = {
      hull = R.deep, hull2 = R.reef, trim = R.coral, trim2 = R.coral, glass = R.glow, core = R.glow, lights = R.glow, engine = R.sea, branch = R.coral, polyp = R.glow,
      glowing = { polyp = true },
      animate = function(M, casco, luces, f, n, b)
        -- Two fronds from the back, swaying up and down.
        for k, dy in ipairs({ -2, 2 }) do
          local y0 = b.cy + dy
          local x0 = backAt(M, y0) or b.x0
          for i = 1, 3 do
            local x = x0 - i
            local y = y0 + math.floor(math.sin(f / n * math.pi * 2 + i * 0.9 + k) * 1.2 + 0.5)
            if inside(x, y) and not casco[y][x] and not luces[y][x] then casco[y][x] = R.sea[i == 3 and 3 or 2] end
          end
        end
      end,
    },
    shape = function(M)
      local b = hullBox(M)
      -- Antlers of coral on top: a thick trunk that forks in two, glowing at its tips.
      local tx = b.cx - 1
      local top = topAt(M, tx) or b.y0
      thick(M, tx, top + 1, tx, top - 1, 'branch')
      thick(M, tx, top - 1, tx - 2, top - 3, 'branch')
      thick(M, tx + 1, top - 1, tx + 3, top - 3, 'branch')
      over(M, tx - 2, top - 4, 'polyp'); over(M, tx - 1, top - 4, 'polyp')
      over(M, tx + 3, top - 4, 'polyp'); over(M, tx + 4, top - 4, 'polyp')
      -- Round polyps on the back corners, above and below the engine.
      for _, dy in ipairs({ -4, 3 }) do
        local y = b.cy + dy
        local x = (backAt(M, y) or b.x0) - 1
        block(M, x, y, x + 1, y + 1, 'polyp')
      end
      -- Glowing spots on the body.
      for _, d in ipairs({ { -3, -1 }, { 1, 2 }, { -1, 3 } }) do
        local x, y = b.cx + d[1], b.cy + d[2]
        if inside(x, y) and isHull(M[y][x]) then M[y][x] = 'polyp' end
      end
    end,
  },
  -- Aurora: swept back for speed, a night-blue body with ice blades, and a ribbon of polar light that waves behind it
  -- while a veil of green and violet crosses the body. Six frames.
  {
    line = 'aurora',
    look = {
      hull = R.night, hull2 = R.night, trim = R.plate, trim2 = R.plate, glass = R.auroraG, core = R.auroraV, lights = R.auroraG, engine = R.auroraG, blade = R.ice,
      frames = 6, fps = 7,
      animate = function(M, casco, luces, f, n, b)
        -- The veil: a band of light crossing the body from the back to the front.
        local at = b.x0 - 4 + (f / n) * (b.x1 - b.x0 + 10)
        for y = 0, H - 1 do
          for x = 0, W - 1 do
            if isHull(M[y][x]) then
              local d = x - (at - (y - b.cy) * 0.5)
              if d >= 0 and d < 2 then luces[y][x] = (y < b.cy) and R.auroraG[2] or R.auroraV[2] end
            end
          end
        end
        -- The ribbon: two pixels thick, from the back, waving to the left edge.
        local x0 = backAt(M, b.cy) or b.x0
        for x = x0 - 1, 0, -1 do
          local y = b.cy + math.floor(math.sin((x0 - x) * 0.8 - f / n * math.pi * 2) * 1.5 + 0.5)
          for dy = 0, 1 do
            local yy = y + dy - 1
            if inside(x, yy) and not casco[yy][x] and not luces[yy][x] then luces[yy][x] = (dy == 0) and R.auroraG[2] or R.auroraV[2] end
          end
        end
      end,
    },
    shape = function(M)
      local b = hullBox(M)
      -- Two crystal fins swept far back, one above and one below, solid over the body's edge.
      local wx = b.cx + 1
      local top, bottom = topAt(M, wx) or b.y0, bottomAt(M, wx) or b.y1
      polyOver(M, { { wx + 1.5, top + 2.5 }, { wx - 3, top + 2.5 }, { b.x0 - 1.5, top - 3 }, { b.x0 + 1.5, top - 3 } }, 'blade')
      polyOver(M, { { wx + 1.5, bottom - 1.5 }, { wx - 3, bottom - 1.5 }, { b.x0 - 1.5, bottom + 4 }, { b.x0 + 1.5, bottom + 4 } }, 'blade')
    end,
  },
  -- Leyenda: obsidian and royal violet crowned in gold, with a gold prow, a gem for a core, a gleam sweeping over it and
  -- three sparks orbiting it. Eight frames.
  {
    line = 'leyenda',
    look = {
      hull = R.obsidian, hull2 = R.royal, trim = R.gold, trim2 = R.gold, glass = R.royal, core = R.gold, lights = R.gold, engine = R.royal, crown = R.gold, prow = R.gold, gem = R.royal,
      glowing = { gem = true },
      frames = 8, fps = 10,
      animate = function(M, casco, luces, f, n, b)
        -- The gleam: a diagonal of white gold from the top left to the bottom right.
        local at = b.x0 + b.y0 - 4 + (f / n) * (b.x1 - b.x0 + b.y1 - b.y0 + 12)
        for y = 0, H - 1 do
          for x = 0, W - 1 do
            local m = M[y][x]
            if (isHull(m) or m == 'crown' or m == 'prow' or m == 'trim') and math.abs((x + y) - at) < 0.75 then luces[y][x] = '#fff8e0' end
          end
        end
      end,
      around = function(merged, luces, f, n)
        for k = 0, 2 do
          local a = (f / n) * math.pi * 2 + k * (math.pi * 2 / 3)
          local x = math.floor(11.5 + math.cos(a) * 11 + 0.5)
          local y = math.floor(11.5 + math.sin(a) * 11 + 0.5)
          if inside(x, y) and not merged[y][x] then
            merged[y][x], luces[y][x] = R.gold[3], R.gold[3]
            if (f + k) % 2 == 0 then
              for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
                local qx, qy = x + d[1], y + d[2]
                if inside(qx, qy) and not merged[qy][qx] then merged[qy][qx], luces[qy][qx] = R.gold[2], R.gold[2] end
              end
            end
          end
        end
      end,
    },
    shape = function(M)
      local b = hullBox(M)
      -- A crown on top: a band of gold and three pointed spikes, a gem on the tallest.
      local top = topAt(M, b.cx) or b.y0
      block(M, b.cx - 3, top - 1, b.cx + 4, top, 'crown')
      for _, d in ipairs({ { -2.5, 3 }, { 0.5, 4 }, { 3.5, 3 } }) do
        local x = b.cx + d[1]
        polyOver(M, { { x - 1.5, top - 0.5 }, { x + 1.5, top - 0.5 }, { x, top - 0.5 - d[2] } }, 'crown')
      end
      over(M, b.cx, top - 3, 'gem')
      -- Two gold fins swept back, above and below the engine.
      polyOver(M, { { b.x0 + 4.5, b.cy - 1.5 }, { b.x0 + 1, b.cy - 1.5 }, { b.x0 - 1.5, b.cy - 6 }, { b.x0 + 1, b.cy - 6 } }, 'prow')
      polyOver(M, { { b.x0 + 4.5, b.cy + 2.5 }, { b.x0 + 1, b.cy + 2.5 }, { b.x0 - 1.5, b.cy + 7 }, { b.x0 + 1, b.cy + 7 } }, 'prow')
      -- A gold prow at the front.
      local fx = frontAt(M, b.cy) or b.x1
      polyOver(M, { { fx + 0.5, b.cy - 1.5 }, { fx + 0.5, b.cy + 2.5 }, { fx + 3.5, b.cy + 0.5 } }, 'prow')
    end,
  },
}

for _, id in ipairs(ORDER) do
  if not ONLY or ONLY == id then
    local M = grid()
    build(id, M, PROBES[id](M), id:gsub('^probe%-', ''), 'probes')
    local probe = id:gsub('^probe%-', '')
    for _, skin in ipairs(SKINS) do
      local S = grid()
      local look = {}
      for k, v in pairs(PROBES[id](S)) do look[k] = v end
      for k, v in pairs(skin.look) do look[k] = v end
      look.box = hullBox(S)
      skin.shape(S)
      build('skin-' .. probe .. '-' .. skin.line, S, look, 'skins/' .. probe .. '-' .. skin.line, skin.line)
    end
  end
end

-- The game's module (every probe, so `only` is for a quick look and skips it).
if not ONLY then
  local out = {}
  out[#out + 1] = '// Generated by art/probes/paint-probes.lua (plan «banda sonora, skins, perfil y entorno», part B). Do not edit by'
  out[#out + 1] = '// hand: change the script and run it again (the command is at its top).'
  out[#out + 1] = "import type { SpriteDef } from './types';"
  out[#out + 1] = ''
  local function emit(title, name, skins)
    out[#out + 1] = title
    out[#out + 1] = 'export const ' .. name .. ': Record<string, SpriteDef> = {'
    for _, g in ipairs(generated) do
      if g.skin == skins then
        out[#out + 1] = "  '" .. g.id .. "': {"
        out[#out + 1] = '    w: 24,'
        out[#out + 1] = '    h: 24,'
        out[#out + 1] = '    fps: ' .. g.fps .. ','
        out[#out + 1] = '    anchor: [0.5, 0.5],'
        local pal = {}
        for _, p in ipairs(g.palette) do pal[#pal + 1] = p[1] .. ": '" .. p[2] .. "'" end
        out[#out + 1] = '    palette: { ' .. table.concat(pal, ', ') .. ' },'
        out[#out + 1] = '    frames: ['
        for _, rows in ipairs(g.frames) do
          out[#out + 1] = '      ['
          for _, r in ipairs(rows) do out[#out + 1] = "        '" .. r .. "'," end
          out[#out + 1] = '      ],'
        end
        out[#out + 1] = '    ],'
        out[#out + 1] = '  },'
      end
    end
    out[#out + 1] = '};'
    out[#out + 1] = ''
  end
  emit('/** The eight probes, 24 × 24, four idle frames each, facing right. */', 'PROBE_ART', false)
  emit('/** The probes\' skins (part C), each a design of its own round its probe\'s body: `skin-<probe>-<collection>`. */', 'SKIN_ART', true)
  out[#out + 1] = '/** How far behind the centre each probe\'s (and skin\'s) exhaust is (px): where its flame comes out. */'
  out[#out + 1] = 'export const PROBE_NOZZLE: Record<string, number> = {'
  for _, nz in ipairs(nozzles) do out[#out + 1] = "  '" .. nz.id .. "': " .. nz.rear .. ',' end
  out[#out + 1] = '};'
  local file = io.open(WEB .. '/probe-art.ts', 'w')
  file:write(table.concat(out, '\n') .. '\n')
  file:close()
end

-- An 8× preview sheet per group (one row per drawing, its frames), to look at the art.
if PREVIEW then
  for group, list in pairs(previews) do
    local cols, ids, order = 1, {}, {}
    for _, p in ipairs(list) do
      cols = math.max(cols, p.f)
      if not ids[p.id] then
        order[#order + 1] = p.id
        ids[p.id] = #order
      end
    end
    local sheet = Image(W * 8 * cols + (cols - 1) * 8, #order * (H * 8 + 8), ColorMode.RGB)
    sheet:clear(colour('#20244a'))
    for _, p in ipairs(list) do
      sheet:drawImage(p.img, Point((p.f - 1) * (W * 8 + 8), (ids[p.id] - 1) * (H * 8 + 8)), 255, BlendMode.NORMAL)
    end
    sheet:saveAs(PREVIEW .. '/' .. group .. '-preview.png')
  end
end
