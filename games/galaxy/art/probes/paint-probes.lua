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
-- sheet when asked, and the generated module apps/web/src/arena/sprites/probe-art.ts the game draws from.
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
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local m = M[y][x]
      if m == 'engine' then
        luces[y][x] = (look.engine or R.engine)[ENGINE[f % #ENGINE + 1]]
      elseif m == 'light' then
        local tones = look.lights or R.cyan
        luces[y][x] = tones[f % 4 < 2 and 3 or 1]
      elseif m == 'core' then
        -- Its fill breathes up to the light tone once a loop; its top-left edge stays lit.
        luces[y][x] = (look.core or R.cyan)[toneOf(M, x, y) == 3 and 3 or CORE[f % #CORE + 1]]
      elseif m == 'dark' then
        casco[y][x] = OUTLINE
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

for _, id in ipairs(ORDER) do
  if not ONLY or ONLY == id then
    local M = grid()
    build(id, M, PROBES[id](M), id:gsub('^probe%-', ''), 'probes')
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
  out[#out + 1] = '/** How far behind the centre each probe\'s exhaust is (px): where its flame comes out. */'
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
