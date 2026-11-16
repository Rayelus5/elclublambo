-- Galaxy Survivor: the in-run events' sprites (2026-11-16, plan «botín, Sifón, Estática y eventos», C1). Flat like the
-- probes: three tones per part (its fill, a light edge to the top left, a dark edge to the bottom right), no dithering,
-- a 1 px #0b0c24 contour. The abandoned ship wears each sector's look — its hull, and an accent of its own: frost in
-- the rings, coral in the reef, embers in the forge, crystal in the rift; so does the meteor of the hazards (a rock, an
-- ice chunk, a spore, slag, a shard of the Signal). The supply capsule and the bounty mark are the station's, the same
-- everywhere.
--
-- Run from games/galaxy:
--   aseprite -b --script-param out=art/events --script-param web=apps/web/src/arena/sprites \
--     [--script-param preview=<folder>] --script art/events/paint-events.lua
-- It saves art/events/<id>.aseprite (layers «casco» and «luces»), its strip art/events/<id>.png, an 8× preview sheet
-- when asked, and the generated module apps/web/src/arena/sprites/event-art.ts the game draws from.
local OUT = app.params['out']
local WEB = app.params['web']
local PREVIEW = app.params['preview']
local OUTLINE = '#0b0c24'
local FRAMES = 4

-- Three tones per material: dark edge, fill, light edge (the arena's palette, apps/web/src/arena/sprites/palette.ts).
local R = {
  steel = { '#2a2f5e', '#4b5390', '#b9bfe6' },
  plate = { '#8890c4', '#b9bfe6', '#f3f5ff' },
  grey = { '#4b5390', '#8890c4', '#b9bfe6' },
  uv = { '#3a2a9a', '#7259ee', '#b39dff' },
  ice = { '#6fb7ff', '#bfe3ff', '#f3f5ff' },
  deep = { '#13867f', '#3fe0d0', '#b4fff0' },
  rust = { '#5a1d10', '#a04a22', '#d98a4a' },
  slag = { '#4a0f22', '#5a1d10', '#a04a22' },
  obsidian = { '#2a2f5e', '#3a2a9a', '#7259ee' },
  cyan = { '#3a58e0', '#6fe3ff', '#f3f5ff' },
  solar = { '#c25f1c', '#ff9a3c', '#ffc94a' },
  lava = { '#c25f1c', '#ff5a1f', '#ffc94a' },
  coral = { '#9c2238', '#c94f7c', '#ff8fb3' },
  teal = { '#13867f', '#3fe0d0', '#f3f5ff' },
  glitch = { '#8e2bb3', '#e05cff', '#f3f5ff' },
  terminal = { '#0b7352', '#17b07e', '#45e3a6' },
  gold = { '#c25f1c', '#ffc94a', '#f3f5ff' },
  static = { '#9c2238', '#ff4d6d', '#f3f5ff' },
}

-- ── Shapes: a material grid (what each pixel is made of), of any size ───────────────────────────────────────────
local function grid(w, h)
  local t = { w = w, h = h }
  for y = 0, h - 1 do t[y] = {} end
  return t
end
local function inside(M, x, y) return x >= 0 and y >= 0 and x < M.w and y < M.h end
local function set(M, x, y, m) if inside(M, x, y) then M[y][x] = m end end
local function ellipse(M, cx, cy, rx, ry, m)
  for y = 0, M.h - 1 do
    for x = 0, M.w - 1 do
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
  for y = 0, M.h - 1 do
    for x = 0, M.w - 1 do
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

-- ── Flat tones: the fill, a light edge where the part meets something to its top or left, a dark one to its bottom
-- or right (a part one pixel thin keeps its fill) ─────────────────────────────────────────────────────────────────
local function toneOf(M, x, y)
  local m = M[y][x]
  local function other(qx, qy) return not inside(M, qx, qy) or M[qy][qx] ~= m end
  local lit = other(x, y - 1) or other(x - 1, y)
  local shade = other(x, y + 1) or other(x + 1, y)
  if lit and not shade then return 3 end
  if shade and not lit then return 1 end
  return 2
end

-- What glows breathes through the four frames; lights blink.
local BREATH = { 2, 3, 3, 2 }
local BLINK = { 3, 3, 1, 1 }

--- One frame's colours: the hull layer, the lights layer and the merged frame.
local function paint(M, look, f)
  local casco, luces = grid(M.w, M.h), grid(M.w, M.h)
  for y = 0, M.h - 1 do
    for x = 0, M.w - 1 do
      local m = M[y][x]
      if m == 'dark' then
        casco[y][x] = OUTLINE
      elseif m == 'light' then
        luces[y][x] = (look.light or R.static)[BLINK[f % #BLINK + 1]]
      elseif m and look.glowing and look.glowing[m] then
        luces[y][x] = look[m][toneOf(M, x, y) == 3 and 3 or BREATH[(f + x + y) % #BREATH + 1]]
      elseif m then
        casco[y][x] = (look[m] or look.hull)[toneOf(M, x, y)]
      end
    end
  end
  if look.animate then look.animate(M, casco, luces, f) end
  -- The contour: every empty pixel touching the drawing (4-neighbourhood).
  local merged = grid(M.w, M.h)
  for y = 0, M.h - 1 do for x = 0, M.w - 1 do merged[y][x] = luces[y][x] or casco[y][x] end end
  for y = 0, M.h - 1 do
    for x = 0, M.w - 1 do
      if not merged[y][x] then
        for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
          local qx, qy = x + d[1], y + d[2]
          if inside(M, qx, qy) and merged[qy][qx] and merged[qy][qx] ~= OUTLINE then
            casco[y][x] = OUTLINE
            break
          end
        end
      end
    end
  end
  for y = 0, M.h - 1 do for x = 0, M.w - 1 do merged[y][x] = luces[y][x] or casco[y][x] end end
  -- And what floats round it (sparks), in the empty space after the contour.
  if look.around then look.around(merged, luces, f) end
  return casco, luces, merged
end

-- ── The abandoned ship: a freighter broken at its back, its cargo bay open, one emergency light left ──────────────
local function wreckShape()
  local M = grid(34, 22)
  -- The hull, nose to the right.
  poly(M, { { 4, 8 }, { 8, 5.5 }, { 23, 5.5 }, { 29, 8 }, { 32, 11 }, { 29, 14 }, { 23, 16.5 }, { 8, 16.5 }, { 4, 14 } }, 'hull')
  -- Its fins, the lower one bent back.
  poly(M, { { 12, 6 }, { 19, 6 }, { 17, 2.5 }, { 13.5, 2.5 } }, 'trim')
  poly(M, { { 11, 16 }, { 18, 16 }, { 13, 20.5 }, { 9.5, 20.5 } }, 'trim')
  -- The cargo bay: two plates and their seams.
  rect(M, 10, 8, 20, 13, 'bay')
  line(M, 13, 8, 13, 13, 'dark')
  line(M, 17, 8, 17, 13, 'dark')
  -- The cockpit.
  ellipse(M, 25.5, 10.5, 3.2, 2.6, 'dark')
  ellipse(M, 25.7, 10.5, 2.2, 1.6, 'glass')
  -- A hole in its side (the jagged cut at its back comes after: `cut`).
  ellipse(M, 21.5, 14.2, 1.5, 1.0, 'dark')
  -- The emergency light, on the top fin.
  set(M, 15, 2, 'light')
  return M
end

--- Clears what is inside `pts`: the ship broken off at its back.
local function cut(M, pts)
  for y = 0, M.h - 1 do
    for x = 0, M.w - 1 do
      local px, py, odd = x + 0.5, y + 0.5, false
      local j = #pts
      for i = 1, #pts do
        local xi, yi, xj, yj = pts[i][1], pts[i][2], pts[j][1], pts[j][2]
        if (yi > py) ~= (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi then odd = not odd end
        j = i
      end
      if odd then M[y][x] = nil end
    end
  end
end

-- Sparks from the break, frame by frame (in the empty space left of the cut).
local function sparks(tones)
  return function(merged, luces, f)
    local spots = { { { 3, 9 }, { 1, 12 } }, { { 2, 7 }, { 4, 13 } }, { { 1, 10 } }, { { 3, 15 }, { 2, 8 } } }
    for _, s in ipairs(spots[f % #spots + 1]) do
      local x, y = s[1], s[2]
      if not merged[y][x] then
        luces[y][x] = tones[f % 2 == 0 and 3 or 2]
        merged[y][x] = luces[y][x]
      end
    end
  end
end

-- Each sector's ship: its hull and trim, and an accent of its own grown on the shape.
local SECTORS = {
  { id = 'outer-nebula', look = { hull = R.grey, trim = R.steel, bay = R.uv, glass = R.cyan, light = R.static } },
  {
    id = 'frost-rings',
    look = { hull = R.plate, trim = R.grey, bay = R.steel, glass = R.cyan, light = R.cyan, frost = R.ice },
    accent = function(M)
      -- Frost on its back and icicles under it.
      for x = 0, M.w - 1 do
        for y = 0, M.h - 1 do
          local m = M[y][x]
          if m == 'hull' or m == 'trim' then
            if x % 3 ~= 1 then M[y][x] = 'frost' end
            break
          end
        end
      end
      for _, x in ipairs({ 20, 22, 26 }) do
        local y = 16
        while y < M.h - 1 and M[y][x] do y = y + 1 end
        set(M, x, y, 'frost')
        if x ~= 22 then set(M, x, y + 1, 'frost') end
      end
    end,
  },
  {
    id = 'hollow-reef',
    look = { hull = R.deep, trim = R.steel, bay = R.grey, glass = R.cyan, light = R.teal, coral = R.coral, polyp = R.teal, glowing = { polyp = true } },
    accent = function(M)
      -- Coral grown over the break, polyps at its tips.
      line(M, 9, 6, 7, 2, 'coral')
      line(M, 8, 4, 10, 2, 'coral')
      line(M, 22, 6, 23, 3, 'coral')
      set(M, 7, 1, 'polyp'); set(M, 10, 1, 'polyp'); set(M, 23, 2, 'polyp')
    end,
  },
  {
    id = 'broken-forge',
    look = { hull = R.rust, trim = R.slag, bay = R.steel, glass = R.solar, light = R.solar, ember = R.lava, glowing = { ember = true } },
    accent = function(M)
      -- Embers glowing in its seams and its wound.
      for y = 0, M.h - 1 do
        for x = 0, M.w - 1 do
          if M[y][x] == 'dark' and x > 9 and x < 23 then M[y][x] = 'ember' end
        end
      end
      set(M, 9, 9, 'ember'); set(M, 9, 12, 'ember')
    end,
  },
  {
    id = 'signal-rift',
    look = { hull = R.obsidian, trim = R.steel, bay = R.grey, glass = R.glitch, light = R.glitch, crystal = R.cyan, glowing = { crystal = true } },
    accent = function(M)
      -- Crystal shards out of the break and through its side.
      poly(M, { { 9, 8 }, { 4, 6 }, { 9, 10 } }, 'crystal')
      poly(M, { { 9, 12 }, { 3, 14 }, { 9, 14 } }, 'crystal')
      poly(M, { { 21, 6 }, { 22, 1.5 }, { 24, 6 } }, 'crystal')
    end,
  },
}

-- ── The supply capsule: a pod from the station, its gold band (it brings loot), landing on its fins ───────────────
local function capsuleShape()
  local M = grid(16, 20)
  rrect(M, 4, 4, 11, 15, 3, 'hull')
  poly(M, { { 5, 5 }, { 11, 5 }, { 9.5, 1.5 }, { 6.5, 1.5 } }, 'trim')
  rect(M, 4, 9, 11, 11, 'band')
  -- The band's clasp: a seam down its middle, so it reads as a strap.
  line(M, 8, 9, 8, 11, 'dark')
  poly(M, { { 4.5, 12 }, { 1, 18 }, { 4.5, 16.5 } }, 'trim')
  poly(M, { { 11.5, 12 }, { 15, 18 }, { 11.5, 16.5 } }, 'trim')
  rect(M, 6, 16, 9, 17, 'engine')
  set(M, 7, 0, 'light'); set(M, 8, 0, 'light')
  return M
end
local CAPSULE = {
  hull = R.plate,
  trim = R.steel,
  band = R.gold,
  engine = R.solar,
  light = R.terminal,
  glowing = { engine = true },
}

-- ── The bounty mark: gold brackets that close in on the hunter, and over it a gold diamond (its loot) that blinks ──
-- The brackets leave the hunter seen: nothing is drawn on it. The diamond sits above the frame, the bottom stays
-- empty, so the sprite's centre is the frame's.
local function markShape(f)
  local M = grid(17, 25)
  local i = ({ 0, 1, 1, 0 })[f % 4 + 1]
  local a, b = 1 + i, 15 - i
  local top, bottom = 5 + i, 19 - i
  for _, c in ipairs({ { a, top, 1, 1 }, { b, top, -1, 1 }, { a, bottom, 1, -1 }, { b, bottom, -1, -1 } }) do
    local x, y, dx, dy = c[1], c[2], c[3], c[4]
    line(M, x, y, x + dx * 3, y, 'mark')
    line(M, x, y, x, y + dy * 3, 'mark')
  end
  poly(M, { { 8.5, 0.5 }, { 10.5, 2.5 }, { 8.5, 4.5 }, { 6.5, 2.5 } }, 'loot')
  return M
end
local MARK = { mark = R.gold, loot = R.gold, glowing = { loot = true } }

-- ── The meteor of each sector (the hazards, 2026-11-16): a lump falling with its tail above it, the tail flickering.
-- A rock with a fire tail in the nebula, an ice chunk in the rings, a spore in the reef, slag in the forge, a shard of
-- the Signal in the rift.
local function meteorShape(f)
  local M = grid(12, 18)
  local len = ({ 0, 1, 0, 2 })[f % 4 + 1]
  poly(M, { { 3.5, 12 }, { 8.5, 12 }, { 7, 1 + len }, { 5, 1 + len } }, 'tail')
  ellipse(M, 6, 13, 4.6, 4.2, 'rock')
  set(M, 4, 12, 'crack'); set(M, 5, 13, 'crack'); set(M, 7, 14, 'crack')
  return M
end
local METEORS = {
  { id = 'outer-nebula', look = { rock = R.grey, tail = R.solar, crack = R.steel, glowing = { tail = true } } },
  { id = 'frost-rings', look = { rock = R.ice, tail = R.cyan, crack = R.plate, glowing = { tail = true } } },
  { id = 'hollow-reef', look = { rock = R.coral, tail = R.teal, crack = R.teal, glowing = { tail = true, crack = true } } },
  { id = 'broken-forge', look = { rock = R.slag, tail = R.lava, crack = R.lava, glowing = { tail = true, crack = true } } },
  { id = 'signal-rift', look = { rock = R.obsidian, tail = R.glitch, crack = R.cyan, glowing = { tail = true, crack = true } } },
}

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
local function image(L, w, h, scale)
  scale = scale or 1
  local img = Image(w * scale, h * scale, ColorMode.RGB)
  for y = 0, h - 1 do
    for x = 0, w - 1 do
      local c = L[y][x]
      if c then for sy = 0, scale - 1 do for sx = 0, scale - 1 do img:drawPixel(x * scale + sx, y * scale + sy, colour(c)) end end end
    end
  end
  return img
end

local KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
local generated = {}
local previews = {}

--- `shapeAt(f)`: the material grid of frame f (most keep one shape; the mark moves its brackets).
local function build(id, shapeAt, look, fps)
  local first = shapeAt(0)
  local W, H = first.w, first.h
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1], spr:newLayer() }
  layers[1].name = 'casco'
  layers[2].name = 'luces'
  local frames, palette, keyOf, n = {}, {}, {}, 0
  for f = 1, FRAMES do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 1 / fps
    local casco, luces, merged = paint(shapeAt(f - 1), look, f - 1)
    spr:newCel(layers[1], f, image(casco, W, H), Point(0, 0))
    spr:newCel(layers[2], f, image(luces, W, H), Point(0, 0))
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
    previews[#previews + 1] = { id = id, f = f, img = image(merged, W, H, 8), w = W, h = H }
  end
  assert(n <= #KEYS, id .. ': too many colours')
  spr:saveAs(OUT .. '/' .. id .. '.aseprite')
  local sheet = Image(W * FRAMES, H, ColorMode.RGB)
  for f = 1, FRAMES do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(OUT .. '/' .. id .. '.png')
  spr:close()
  generated[#generated + 1] = { id = id, palette = palette, frames = frames, fps = fps, w = W, h = H }
end

for _, s in ipairs(SECTORS) do
  local M = wreckShape()
  cut(M, { { 0, 4 }, { 7, 4 }, { 6, 7 }, { 8.5, 9 }, { 6, 11 }, { 8.5, 13 }, { 6, 15 }, { 7, 18 }, { 0, 18 } })
  if s.accent then s.accent(M) end
  local look = s.look
  look.around = sparks(look.ember or look.crystal or R.solar)
  build('event-wreck-' .. s.id, function() return M end, look, 6)
end
for _, m in ipairs(METEORS) do build('event-meteor-' .. m.id, meteorShape, m.look, 10) end
local capsule = capsuleShape()
build('event-capsule', function() return capsule end, CAPSULE, 8)
build('event-bounty', markShape, MARK, 6)

-- ── The module the game draws from ──────────────────────────────────────────────────────────────────────────────
if WEB then
  local out = {
    '// Generated by art/events/paint-events.lua (plan «botín, Sifón, Estática y eventos», C1). Do not edit by hand:',
    '// change the script and run it again (the command is at its top).',
    "import type { SpriteDef } from './types';",
    '',
    '/** The in-run events: the abandoned ship and the meteor of each sector (`event-wreck-<sector>`, `event-meteor-<sector>`), the supply capsule, the bounty mark. */',
    'export const EVENT_ART: Record<string, SpriteDef> = {',
  }
  for _, g in ipairs(generated) do
    out[#out + 1] = "  '" .. g.id .. "': {"
    out[#out + 1] = '    w: ' .. g.w .. ','
    out[#out + 1] = '    h: ' .. g.h .. ','
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
  out[#out + 1] = '};'
  local file = io.open(WEB .. '/event-art.ts', 'w')
  file:write(table.concat(out, '\n') .. '\n')
  file:close()
end

-- An 8× preview sheet: one row per drawing, its frames.
if PREVIEW then
  local cols, rows, order, ids = FRAMES, 0, {}, {}
  local cw, ch = 0, 0
  for _, p in ipairs(previews) do
    cw = math.max(cw, p.w * 8)
    ch = math.max(ch, p.h * 8)
    if not ids[p.id] then
      order[#order + 1] = p.id
      ids[p.id] = #order
    end
  end
  rows = #order
  local sheet = Image(cols * (cw + 8), rows * (ch + 8), ColorMode.RGB)
  sheet:clear(colour('#20244a'))
  for _, p in ipairs(previews) do
    sheet:drawImage(p.img, Point((p.f - 1) * (cw + 8), (ids[p.id] - 1) * (ch + 8)), 255, BlendMode.NORMAL)
  end
  sheet:saveAs(PREVIEW .. '/events-preview.png')
end
