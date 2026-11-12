-- Galaxy Survivor: the eight playable probes, redrawn (plan «banda sonora, skins, perfil y entorno», part B; the owner:
-- «reworkear las sondas actuales para que las skins tengan mejor sentido y sean más épicas… misma identidad»).
-- Each probe keeps its silhouette and colours from the 16×16 grids, now at 24×24 with hue-shifted ramps, a bevelled
-- shading lit from the top left (ordered dithering between the ramp's steps), a 1 px #0b0c24 contour, and four idle
-- frames: the engine and the core pulse, the navigation lights blink. Facing right, the engine on the left.
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

-- Ramps, dark to light (hue-shifted toward violet in the shadows and warm in the lights).
local R = {
  ice = { '#16205a', '#3a58e0', '#6fb7ff', '#bfe3ff', '#f3f5ff' },
  steel = { '#1f2350', '#363d72', '#4b5390', '#6f78b4', '#b9bfe6' },
  plate = { '#3a4278', '#6670b0', '#9aa2d6', '#c9cff0', '#f3f5ff' },
  dark = { '#0e1130', '#161a3f', '#232a5c' },
  solar = { '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#fff1b8' },
  uv = { '#1c1450', '#3a2a9a', '#5a43d6', '#7259ee', '#b39dff' },
  lilac = { '#2a1c6a', '#5a43d6', '#8f7cff', '#c9bcff', '#f3f0ff' },
  cyan = { '#0d2a4a', '#1f7aa8', '#3fc8e8', '#9ff0ff', '#f3f5ff' },
  terminal = { '#06302a', '#0b7352', '#17b07e', '#45e3a6', '#a6ffd9' },
  engine = { '#5a1d10', '#d2401c', '#ff8a2c', '#ffc94a', '#fff1b8' },
}

local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end

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

-- ── The eight probes: shapes and the ramp of each material ──────────────────────────────────────────────────────
-- Materials: hull, hull2, trim, trim2, glass, core, dark, engine, light. `nozzle`: how far behind the centre the
-- exhaust is (px), `lights`: the blinking lights' ramp.
local PROBES = {}

PROBES['probe-lumen'] = function(M)
  ellipse(M, 12.5, 12, 8.2, 6.6, 'hull')
  poly(M, { { 8.5, 6.5 }, { 15, 6.5 }, { 11, 1.5 }, { 6.5, 1.5 } }, 'trim')
  poly(M, { { 8.5, 18.5 }, { 15, 18.5 }, { 11, 23.5 }, { 6.5, 23.5 } }, 'trim')
  ellipse(M, 16.6, 12, 3.6, 3.4, 'dark')
  ellipse(M, 16.9, 11.8, 2.6, 2.4, 'glass')
  rect(M, 3, 10, 4, 13, 'engine')
  set(M, 7, 2, 'light'); set(M, 7, 21, 'light')
  return { hull = R.ice, trim = R.plate, glass = R.cyan, lights = R.cyan, nozzle = 10 }
end

PROBES['probe-bastion'] = function(M)
  rrect(M, 3, 3, 19, 18, 2, 'hull')
  rect(M, 19, 7, 21, 14, 'hull')
  rrect(M, 6, 6, 16, 15, 2, 'trim')
  ellipse(M, 11.5, 10.5, 3.3, 3.3, 'dark')
  ellipse(M, 11.5, 10.5, 2.4, 2.4, 'core')
  rect(M, 4, 19, 8, 21, 'trim2'); rect(M, 13, 19, 17, 21, 'trim2')
  rect(M, 1, 8, 2, 13, 'engine')
  set(M, 7, 7, 'light'); set(M, 15, 14, 'light')
  return { hull = R.steel, trim = R.plate, trim2 = R.steel, core = R.solar, lights = R.solar, nozzle = 11 }
end

PROBES['probe-spark'] = function(M)
  poly(M, { { 3, 3.5 }, { 11, 6.5 }, { 22.5, 12 }, { 11, 17.5 }, { 3, 20.5 }, { 7, 12 } }, 'hull')
  poly(M, { { 8, 8 }, { 17, 11.2 }, { 17, 12.8 }, { 8, 16 }, { 10.5, 12 } }, 'trim')
  poly(M, { { 13, 9.5 }, { 16.5, 12 }, { 13, 14.5 }, { 9.5, 12 } }, 'core')
  rect(M, 2, 10, 4, 13, 'engine')
  set(M, 4, 4, 'light'); set(M, 4, 19, 'light')
  return { hull = R.uv, trim = R.lilac, core = R.cyan, lights = R.lilac, nozzle = 10 }
end

PROBES['probe-sentinel'] = function(M)
  ellipse(M, 12, 12.5, 8, 6.8, 'hull')
  line(M, 12, 5, 12, 3, 'trim')
  ellipse(M, 12.5, 2, 1.6, 1.6, 'light')
  ellipse(M, 13.6, 12, 3.4, 3.4, 'dark')
  ellipse(M, 13.6, 12, 2.3, 2.3, 'glass')
  set(M, 14, 11, 'core')
  rect(M, 7, 18, 8, 21, 'trim2'); rect(M, 15, 18, 16, 21, 'trim2')
  rect(M, 3, 10, 4, 13, 'engine')
  return { hull = R.terminal, trim = R.plate, trim2 = R.steel, glass = R.cyan, core = R.plate, lights = R.terminal, nozzle = 9 }
end

PROBES['probe-anchor'] = function(M)
  poly(M, { { 8, 2 }, { 16, 2 }, { 21.5, 7.5 }, { 21.5, 16.5 }, { 16, 22 }, { 8, 22 }, { 2.5, 16.5 }, { 2.5, 7.5 } }, 'hull')
  poly(M, { { 9, 5 }, { 15, 5 }, { 18.5, 8.5 }, { 18.5, 15.5 }, { 15, 19 }, { 9, 19 }, { 5.5, 15.5 }, { 5.5, 8.5 } }, 'trim')
  rrect(M, 8, 8, 16, 16, 1, 'dark')
  ellipse(M, 12, 12, 3, 3, 'core')
  rect(M, 0, 10, 1, 13, 'engine')
  set(M, 21, 11, 'light'); set(M, 21, 12, 'light')
  return { hull = R.steel, trim = R.plate, core = R.lilac, lights = R.uv, nozzle = 12 }
end

PROBES['probe-prism'] = function(M)
  poly(M, { { 12, 0.5 }, { 22.5, 12 }, { 12, 23.5 }, { 1.5, 12 } }, 'hull')
  for y = 0, H - 1 do for x = 12, W - 1 do if M[y][x] == 'hull' then M[y][x] = 'hull2' end end end
  rect(M, 11, 6, 12, 17, 'core')
  poly(M, { { 12, 3 }, { 16, 8 }, { 12, 6 } }, 'trim')
  rect(M, 1, 11, 3, 12, 'engine')
  set(M, 12, 1, 'light'); set(M, 12, 22, 'light')
  return { hull = R.ice, hull2 = R.uv, trim = R.lilac, core = R.cyan, lights = R.lilac, nozzle = 11 }
end

PROBES['probe-comet'] = function(M)
  poly(M, { { 0.5, 11 }, { 6, 9.5 }, { 12, 7.5 }, { 12, 16.5 }, { 6, 14.5 }, { 0.5, 13 } }, 'hull2')
  ellipse(M, 16, 12, 5.8, 5, 'hull')
  ellipse(M, 18.4, 11.6, 2.2, 1.8, 'glass')
  set(M, 21, 12, 'light')
  return { hull = R.ice, hull2 = R.cyan, glass = R.cyan, lights = R.ice, nozzle = 12, tail = true }
end

PROBES['probe-echo'] = function(M)
  ellipse(M, 12, 13, 8.6, 5.6, 'hull')
  poly(M, { { 8, 4 }, { 16, 4 }, { 17, 7.5 }, { 7, 7.5 } }, 'trim')
  line(M, 12, 8, 12, 8, 'trim')
  rect(M, 9, 12, 16, 14, 'dark')
  set(M, 11, 13, 'glass'); set(M, 14, 13, 'glass')
  rect(M, 7, 19, 8, 21, 'trim2'); rect(M, 15, 19, 16, 21, 'trim2')
  rect(M, 2, 11, 3, 14, 'engine')
  set(M, 12, 3, 'light')
  return { hull = R.solar, trim = R.steel, trim2 = R.steel, glass = R.plate, lights = R.solar, nozzle = 10 }
end

local ORDER = { 'probe-lumen', 'probe-bastion', 'probe-spark', 'probe-sentinel', 'probe-anchor', 'probe-prism', 'probe-comet', 'probe-echo' }

-- ── Shading: a bevel per part, lit from the top left, dithered between the ramp's steps ─────────────────────────
local LX, LY, LZ = -0.55, -0.65, 0.52
do
  local n = math.sqrt(LX * LX + LY * LY + LZ * LZ)
  LX, LY, LZ = LX / n, LY / n, LZ / n
end

local function shadeOf(M, x, y)
  local m = M[y][x]
  local ox, oy, near = 0, 0, 4
  for dy = -3, 3 do
    for dx = -3, 3 do
      if dx ~= 0 or dy ~= 0 then
        local qx, qy = x + dx, y + dy
        local other = not inside(qx, qy) or M[qy][qx] ~= m
        if other then
          local d2 = dx * dx + dy * dy
          ox, oy = ox + dx / d2, oy + dy / d2
          near = math.min(near, math.sqrt(d2))
        end
      end
    end
  end
  local len = math.sqrt(ox * ox + oy * oy)
  local tilt = math.max(0, 1 - (near - 1) / 3)
  local nx, ny = 0, 0
  if len > 0 then nx, ny = ox / len * tilt * 0.9, oy / len * tilt * 0.9 end
  local nz = math.sqrt(math.max(0, 1 - nx * nx - ny * ny))
  return math.max(0, math.min(1, (nx * LX + ny * LY + nz * LZ) * 0.85 + 0.12))
end

local function pick(ramp, s, x, y)
  local v = s * (#ramp - 1)
  local base = math.floor(v)
  local i = base + ((v - base) > bayer(x, y) and 1 or 0)
  return ramp[math.max(1, math.min(#ramp, i + 1))]
end

local PULSE = { 0.0, 0.12, 0.22, 0.1 }
local ENGINE = { 0.55, 0.85, 1.0, 0.75 }

--- One frame's colours: { casco = {y = {x = colour}}, luces = … } and the merged frame.
local function paint(M, look, f)
  local casco, luces = grid(), grid()
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local m = M[y][x]
      if m then
        local c
        if m == 'engine' then
          -- Hottest at its back edge, flickering frame by frame.
          local back = x <= 4 and 1 or 0.8
          c = pick(R.engine, math.min(1, ENGINE[f + 1] * back * (0.75 + 0.25 * bayer(x + f, y))), x, y)
          luces[y][x] = c
        elseif m == 'light' then
          local on = f < 2
          c = (look.lights or R.cyan)[on and #(look.lights or R.cyan) or 2]
          luces[y][x] = c
        elseif m == 'core' then
          c = pick(look.core or R.cyan, math.min(1, shadeOf(M, x, y) * 0.7 + 0.3 + PULSE[f + 1]), x, y)
          luces[y][x] = c
        elseif m == 'dark' then
          c = pick(R.dark, shadeOf(M, x, y), x, y)
          casco[y][x] = c
        elseif m == 'glass' then
          c = pick(look.glass or R.cyan, math.min(1, shadeOf(M, x, y) * 0.8 + 0.2), x, y)
          casco[y][x] = c
        else
          local ramp = look[m] or look.hull
          c = pick(ramp, shadeOf(M, x, y), x, y)
          casco[y][x] = c
        end
      end
    end
  end
  -- A glint on each glass: its top-left-most pixel at the ramp's top.
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if M[y][x] == 'glass' and (not inside(x - 1, y) or M[y][x - 1] ~= 'glass') and (not inside(x, y - 1) or M[y - 1][x] ~= 'glass') then
        casco[y][x] = (look.glass or R.cyan)[#(look.glass or R.cyan)]
        break
      end
    end
  end
  -- The comet's tail: lighter toward the head, its streaks shimmering frame by frame.
  if look.tail then
    for y = 0, H - 1 do
      for x = 0, 11 do
        if M[y][x] == 'hull2' then
          local s = (x / 11) * 0.8 + 0.1 + ((y == 10 or y == 13) and 0.15 or 0) + 0.08 * math.sin((x + f * 2) * 1.3)
          casco[y][x] = pick(look.hull2, math.max(0, math.min(1, s)), x, y)
        end
      end
    end
  end
  -- The contour: every empty pixel touching the drawing (4-neighbourhood).
  local merged = grid()
  for y = 0, H - 1 do for x = 0, W - 1 do merged[y][x] = luces[y][x] or casco[y][x] end end
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if not merged[y][x] then
        for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
          local qx, qy = x + d[1], y + d[2]
          -- Against the drawing as it was before the contour (or the contour would spread over the whole frame).
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

local function build(id)
  local M = grid()
  local look = PROBES[id](M)
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1], spr:newLayer() }
  layers[1].name = 'casco'
  layers[2].name = 'luces'
  local frames, palette, keyOf, n = {}, {}, {}, 0
  for f = 1, FRAMES do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 0.125
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
    previews[#previews + 1] = { id = id, f = f, img = image(merged, 8) }
  end
  assert(n <= #KEYS, id .. ': too many colours')
  spr:saveAs(OUT .. '/' .. id:gsub('^probe%-', '') .. '.aseprite')
  local sheet = Image(W * FRAMES, H, ColorMode.RGB)
  for f = 1, FRAMES do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(OUT .. '/' .. id:gsub('^probe%-', '') .. '.png')
  spr:close()
  generated[#generated + 1] = { id = id, palette = palette, frames = frames }
  nozzles[#nozzles + 1] = { id = id, rear = look.nozzle }
end

for _, id in ipairs(ORDER) do
  if not ONLY or ONLY == id then build(id) end
end

-- The game's module (every probe, so `only` is for a quick look and skips it).
if not ONLY then
  local out = {}
  out[#out + 1] = '// Generated by art/probes/paint-probes.lua (plan «banda sonora, skins, perfil y entorno», part B). Do not edit by'
  out[#out + 1] = '// hand: change the script and run it again (the command is at its top).'
  out[#out + 1] = "import type { SpriteDef } from './types';"
  out[#out + 1] = ''
  out[#out + 1] = '/** The eight probes, 24 × 24, four idle frames each, facing right. */'
  out[#out + 1] = 'export const PROBE_ART: Record<string, SpriteDef> = {'
  for _, g in ipairs(generated) do
    out[#out + 1] = "  '" .. g.id .. "': {"
    out[#out + 1] = '    w: 24,'
    out[#out + 1] = '    h: 24,'
    out[#out + 1] = '    fps: 8,'
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
  out[#out + 1] = ''
  out[#out + 1] = '/** How far behind the centre each probe\'s exhaust is (px): where its flame comes out. */'
  out[#out + 1] = 'export const PROBE_NOZZLE: Record<string, number> = {'
  for _, nz in ipairs(nozzles) do out[#out + 1] = "  '" .. nz.id .. "': " .. nz.rear .. ',' end
  out[#out + 1] = '};'
  local file = io.open(WEB .. '/probe-art.ts', 'w')
  file:write(table.concat(out, '\n') .. '\n')
  file:close()
end

-- An 8× preview sheet (one row per probe, its four frames), to look at the art.
if PREVIEW then
  local rows = math.ceil(#previews / FRAMES)
  local sheet = Image(W * 8 * FRAMES + (FRAMES - 1) * 8, rows * (H * 8 + 8), ColorMode.RGB)
  sheet:clear(colour('#20244a'))
  for i, p in ipairs(previews) do
    local r = math.floor((i - 1) / FRAMES)
    sheet:drawImage(p.img, Point((p.f - 1) * (W * 8 + 8), r * (H * 8 + 8)), 255, BlendMode.NORMAL)
  end
  sheet:saveAs(PREVIEW .. '/probes-preview.png')
end
