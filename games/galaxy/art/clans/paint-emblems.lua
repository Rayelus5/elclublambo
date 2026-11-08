-- Galaxy Survivor: the clans' emblems (GDD §14.3, DESIGN_SYSTEM §8 duodecies; M5b-1 Task 4).
-- Paints eight emblems at 32×32: a bevelled badge in the clan's colour with a figure on it (shield, comet, nebula,
-- star, ringed planet, crown, eye, bolt). Each emblem is one sprite with six frames, one per colour in CLAN_COLORS
-- order (solar, nova, terminal, ice, uv, coral), in editable layers (insignia, figura), and is exported as a strip of
-- the six that the web picks from with background-position. Run from games/galaxy:
--   aseprite -b --script-param out=art/clans --script-param web=apps/web/src/clans/emblems --script art/clans/paint-emblems.lua
local W, H = 32, 32
local OUT = app.params['out']
local WEB = app.params['web']

-- Ramps, outline first, then dark to light.
local COLORS = {
  { '#2a1203', '#7a3d08', '#c27a12', '#ffc94a', '#ffe58a', '#fffbe6' },
  { '#2b0712', '#7a1830', '#c9364f', '#ff6b7a', '#ffa3ad', '#ffe1e5' },
  { '#04281c', '#0b7352', '#17b07e', '#45e3a6', '#a6ffd9', '#eafff5' },
  { '#0b1a33', '#26389a', '#3a58e0', '#6fb7ff', '#bfe3ff', '#f3f9ff' },
  { '#0d0828', '#3a2a9a', '#5a43d6', '#7259ee', '#b39dff', '#f3efff' },
  { '#3a1206', '#8f3418', '#d4572c', '#ff8a5c', '#ffc2a3', '#fff0e8' },
}

local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end
local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function maskOf(fn)
  local m = {}
  for y = 0, H - 1 do
    m[y] = {}
    for x = 0, W - 1 do m[y][x] = fn(x + 0.5, y + 0.5) or false end
  end
  return m
end
local function inM(m, x, y) return x >= 0 and y >= 0 and x < W and y < H and m[y][x] end
local function inPoly(px, py, pts)
  local inside, j = false, #pts
  for i = 1, #pts do
    local xi, yi, xj, yj = pts[i][1], pts[i][2], pts[j][1], pts[j][2]
    if (yi > py) ~= (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi then inside = not inside end
    j = i
  end
  return inside
end
local function segd(px, py, x0, y0, x1, y1)
  local dx, dy = x1 - x0, y1 - y0
  local t = math.max(0, math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)))
  return math.sqrt((px - x0 - t * dx) ^ 2 + (py - y0 - t * dy) ^ 2)
end

--- Fills a mask from ramp levels lo..hi by a light value (0–1): dithered, a bevel (lit top-left, shaded
--- bottom-right) and the outline colour around it.
local function body(L, m, ramp, lo, hi, light)
  local n = hi - lo
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if m[y][x] then
        local v = light(x + 0.5, y + 0.5)
        if not inM(m, x, y - 1) or not inM(m, x - 1, y) then v = v + 0.3 end
        if not inM(m, x, y + 1) or not inM(m, x + 1, y) then v = v - 0.3 end
        local t = math.max(0, math.min(0.999, v)) * (n + 1)
        local i = math.floor(t)
        if t - i > bayer(x, y) then i = i + 1 end
        L[y][x] = ramp[math.min(hi, lo + i)]
      elseif inM(m, x + 1, y) or inM(m, x - 1, y) or inM(m, x, y + 1) or inM(m, x, y - 1) then
        L[y][x] = ramp[1]
      end
    end
  end
end

-- The badge every emblem stands on: a rounded square with cut corners.
local BADGE = maskOf(function(px, py)
  local dx, dy = math.abs(px - 16), math.abs(py - 16)
  return dx <= 13.5 and dy <= 13.5 and dx + dy <= 23
end)

local F = {}
F.shield = maskOf(function(px, py)
  if py < 7 or py > 26 then return false end
  local w = py < 16 and 8 or 8 * (1 - ((py - 16) / 10.5) ^ 1.5)
  return math.abs(px - 16) <= w
end)
F.comet = maskOf(function(px, py)
  if (px - 21) ^ 2 + (py - 11) ^ 2 <= 5.2 ^ 2 then return true end
  -- The tail tapers from the head to a point down and to the left.
  return inPoly(px, py, { { 16.6, 8.2 }, { 23.8, 15.4 }, { 6.5, 26.5 } })
end)
-- A two-armed spiral cloud: the arms where the spiral's cosine is high, and a bright core.
F.nebula = maskOf(function(px, py)
  local dx, dy = px - 16, py - 16
  local r = math.sqrt(dx * dx + dy * dy)
  if r > 11.5 then return false end
  if r < 3.4 then return true end
  return math.cos(2 * (math.atan(dy, dx) - math.log(r) * 1.7)) > 0.25 - r * 0.012
end)
F.star = maskOf(function(px, py)
  local pts = {}
  for k = 0, 9 do
    local a = -math.pi / 2 + k * math.pi / 5
    local r = k % 2 == 0 and 10.5 or 4.4
    pts[#pts + 1] = { 16 + r * math.cos(a), 17 + r * math.sin(a) }
  end
  return inPoly(px, py, pts)
end)
--- The ring: a thin tilted ellipse band (rotated coordinates, ry < 0 is its far side).
local function ringAt(px, py)
  local rx, ry = (px - 16) * 0.94 + (py - 16) * 0.34, -(px - 16) * 0.34 + (py - 16) * 0.94
  local e = (rx / 12.5) ^ 2 + (ry / 4.2) ^ 2
  return e <= 1 and e >= 0.6, ry
end
F.ring = maskOf(function(px, py)
  if (px - 16) ^ 2 + (py - 16) ^ 2 <= 6.8 ^ 2 then return true end
  return (ringAt(px, py))
end)
F.crown = maskOf(function(px, py)
  return inPoly(px, py, { { 6.5, 23 }, { 6.5, 10 }, { 11.5, 15.5 }, { 16, 7.5 }, { 20.5, 15.5 }, { 25.5, 10 }, { 25.5, 23 } })
end)
F.eye = maskOf(function(px, py)
  local dy = math.abs(py - 16)
  local half = 11 * math.sqrt(math.max(0, 1 - (dy / 6.8) ^ 2))
  return math.abs(px - 16) <= half * (1 - dy / 9)
end)
F.bolt = maskOf(function(px, py)
  return inPoly(px, py, { { 18.5, 5 }, { 9, 18 }, { 15, 18 }, { 12.5, 27 }, { 23, 13.5 }, { 17, 13.5 } })
end)

--- What goes on top of each figure: details in the outline or the brightest colour.
local DETAIL = {
  shield = function(I, r) for y = 9, 23 do I[y][16] = r[2] end for x = 10, 22 do I[13][x] = r[2] end end,
  comet = function(I, r)
    -- Streaks along the tail, and the head's glint.
    for k = 0, 9 do
      local t = k / 9
      I[math.floor(13 + t * 10)][math.floor(16 - t * 7.5)] = r[3]
      if k < 7 then I[math.floor(15.5 + t * 9)][math.floor(20 - t * 10)] = r[3] end
    end
    I[9][19] = r[6]; I[9][20] = r[6]; I[10][19] = r[6]
  end,
  nebula = function(I, r)
    for y = 14, 18 do for x = 14, 18 do
      if (x + 0.5 - 16) ^ 2 + (y + 0.5 - 16) ^ 2 < 2.2 ^ 2 then I[y][x] = r[6] end
    end end
    I[8][23] = r[6]; I[24][10] = r[6]; I[9][9] = r[5]; I[23][24] = r[5]
  end,
  star = function(I, r) for y = 15, 18 do for x = 15, 17 do I[y][x] = (x + y) % 2 == 0 and r[6] or r[5] end end end,
  ring = function(I, r)
    -- The near side of the ring crosses in front of the planet, darker, with its own shadow below.
    for y = 0, H - 1 do
      for x = 0, W - 1 do
        local on, ry = ringAt(x + 0.5, y + 0.5)
        local inPlanet = (x + 0.5 - 16) ^ 2 + (y + 0.5 - 16) ^ 2 <= 6.8 ^ 2
        -- The whole ring in a darker tone, but its far side stays hidden behind the planet.
        if on and (ry >= 0 or not inPlanet) then I[y][x] = (y > 16 + (x - 16) * 0.36) and r[3] or r[4] end
        if inPlanet and not on and ry >= 0 then
          local below, bry = ringAt(x + 0.5, y - 0.5)
          if below and bry >= 0 then I[y][x] = r[2] end
        end
      end
    end
    I[11][13] = r[6]; I[12][12] = r[6]; I[11][14] = r[5]
  end,
  crown = function(I, r)
    for x = 7, 25 do I[20][x] = r[2] end
    for _, p in ipairs({ { 6, 10 }, { 16, 7 }, { 25, 10 } }) do I[p[2]][p[1]] = r[6] end
    for _, x in ipairs({ 11, 16, 21 }) do I[17][x] = r[6] end
  end,
  eye = function(I, r)
    for y = 12, 20 do for x = 12, 20 do
      local d = math.sqrt((x + 0.5 - 16) ^ 2 + (y + 0.5 - 16) ^ 2)
      if d < 4 then I[y][x] = d < 1.8 and r[1] or r[2] end
    end end
    I[14][14] = r[6]
  end,
  bolt = function(I, r) I[7][17] = r[6]; I[8][16] = r[6]; I[20][14] = r[6] end,
}

local COLOURS = {}
local function colour(c)
  local v = COLOURS[c]
  if not v then
    v = app.pixelColor.rgba(tonumber(c:sub(2, 3), 16), tonumber(c:sub(4, 5), 16), tonumber(c:sub(6, 7), 16), 255)
    COLOURS[c] = v
  end
  return v
end
local function image(L)
  local img = Image(W, H, ColorMode.RGB)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local c = L[y][x]
      if c then img:drawPixel(x, y, colour(c)) end
    end
  end
  return img
end

local ORDER = { 'shield', 'comet', 'nebula', 'star', 'ring', 'crown', 'eye', 'bolt' }
for _, id in ipairs(ORDER) do
  local spr = Sprite(W, H, ColorMode.RGB)
  local badge = spr.layers[1]
  badge.name = 'insignia'
  local figure = spr:newLayer()
  figure.name = 'figura'
  for c, ramp in ipairs(COLORS) do
    if c > 1 then spr:newEmptyFrame() end
    local B, I = layer(), layer()
    -- The badge: dark to mid, lit from the top.
    body(B, BADGE, ramp, 2, 3, function(_, py) return 0.75 - py / 32 * 0.6 end)
    -- The figure: light to brightest, lit from the top left.
    body(I, F[id], ramp, 4, 6, function(px, py) return 0.62 - (px + py - 16) / 48 * 0.5 end)
    DETAIL[id](I, ramp)
    spr:newCel(badge, c, image(B), Point(0, 0))
    spr:newCel(figure, c, image(I), Point(0, 0))
  end
  spr:saveAs(OUT .. '/' .. id .. '.aseprite')
  local sheet = Image(W * #COLORS, H, ColorMode.RGB)
  for c = 1, #COLORS do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, c)
    sheet:drawImage(frame, Point((c - 1) * W, 0))
  end
  sheet:saveAs(WEB .. '/' .. id .. '.png')
  spr:close()
end
