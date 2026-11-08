-- Galaxy Survivor: the market's trading post (GDD §14.6, DESIGN_SYSTEM §8 quattuordecies).
-- Paints the header at 256×48 in four frames, in editable layers (pared, ventana, cartel, mostrador, hologramas,
-- luces), saves the .aseprite and exports the horizontal strip the web plays with CSS steps(4), at integer scale only.
-- A station wall with a porthole on open space and a ringed planet, a hanging sign with a coin, and two counters whose
-- emitters project galaxy cards that bob and flicker; the beam's lamps chase.
-- Run from games/galaxy:
--   aseprite -b --script-param out=art/market --script-param web=apps/web/src/market/art --script art/market/paint-market.lua
local W, H, FRAMES = 256, 48, 4
local OUT = app.params['out']
local WEB = app.params['web']

-- The station's ramps (art/station/paint-rooms.lua), dark to light.
local R = {
  steel = { '#07081a', '#0b0c24', '#151838', '#1f2350', '#2a2f5e', '#3a4278', '#4b5390', '#6670b0', '#8890c4', '#b9bfe6' },
  space = { '#04050f', '#070a1c', '#0d1130' },
  ice = { '#101a4a', '#26389a', '#3a58e0', '#6fb7ff', '#6fe3ff', '#bfe3ff', '#f3f5ff' },
  solar = { '#3a1410', '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#ffe9a8', '#fff8e0' },
  uv = { '#1c1450', '#3a2a9a', '#5a43d6', '#7259ee', '#b39dff', '#e0d6ff' },
  coral = { '#4a1a30', '#c94f7c', '#ff8fb3' },
  terminal = { '#0d3a2c', '#1f8a62', '#45e3a6', '#b8ffe2' },
}
local S = R.steel

local function hash(x, y, s)
  local h = (x * 73856093) ~ (y * 19349663) ~ (s * 83492791)
  h = (h ~ (h >> 13)) * 1274126177
  h = h ~ (h >> 16)
  return h % 1000
end
local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end

local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function put(L, x, y, c)
  x, y = math.floor(x), math.floor(y)
  if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
end
local function rect(L, x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do put(L, x, y, c) end end
end
local function hline(L, x0, x1, y, c) rect(L, x0, y, x1, y, c) end
local function vline(L, x, y0, y1, c) rect(L, x, y0, x, y1, c) end
local function disc(L, cx, cy, r, c)
  for y = math.floor(cy - r) - 1, math.ceil(cy + r) + 1 do
    for x = math.floor(cx - r) - 1, math.ceil(cx + r) + 1 do
      local dx, dy = x + 0.5 - cx, y + 0.5 - cy
      if dx * dx + dy * dy <= r * r then put(L, x, y, c) end
    end
  end
end

-- The porthole: a rounded window in the middle of the wall.
local WX0, WX1, WY0, WY1 = 96, 160, 9, 29
local function inWindow(x, y)
  if x < WX0 or x > WX1 or y < WY0 or y > WY1 then return false end
  local cx = (x < WX0 + 3) and WX0 + 3 or ((x > WX1 - 3) and WX1 - 3 or x)
  local cy = (y < WY0 + 3) and WY0 + 3 or ((y > WY1 - 3) and WY1 - 3 or y)
  local dx, dy = x - cx, y - cy
  return dx * dx + dy * dy <= 9
end

-- The wall: steel panels with seams and rivets, a beam on top, darker towards the floor.
local function pared()
  local L = layer()
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local t = y / H
      put(L, x, y, (bayer(x, y) < t * 0.9) and S[3] or S[4])
    end
  end
  for x = 0, W - 1, 32 do vline(L, x, 3, H - 1, S[2]); vline(L, x + 1, 3, H - 1, S[5]) end
  rect(L, 0, 0, W - 1, 2, S[2])
  hline(L, 0, W - 1, 3, S[6])
  for x = 6, W - 1, 16 do put(L, x, 1, S[7]) end
  -- The porthole's frame.
  for y = WY0 - 2, WY1 + 2 do
    for x = WX0 - 2, WX1 + 2 do
      if not inWindow(x, y) then
        local near = false
        for dy = -2, 2 do for dx = -2, 2 do if inWindow(x + dx, y + dy) then near = true end end end
        if near then put(L, x, y, (y < (WY0 + WY1) / 2) and S[7] or S[5]) end
      end
    end
  end
  return L
end

-- The view: deep space dithered towards the bottom, stars that twinkle by frame, and a ringed planet.
local function ventana(f)
  local L = layer()
  for y = WY0, WY1 do
    for x = WX0, WX1 do
      if inWindow(x, y) then
        local t = (y - WY0) / (WY1 - WY0)
        local c = R.space[1]
        if bayer(x, y) < t * 0.8 then c = R.space[3] elseif bayer(x, y) < t then c = R.space[2] end
        put(L, x, y, c)
        local h = hash(x, y, 7)
        if h < 22 then
          local on = (h + f * 5) % 4
          put(L, x, y, on == 0 and R.ice[7] or (on == 1 and R.ice[6] or R.ice[4]))
        end
      end
    end
  end
  -- The planet, lit from the left, with its ring in front.
  local px, py, pr = 146, 22, 6
  for y = py - pr, py + pr do
    for x = px - pr, px + pr do
      local dx, dy = x + 0.5 - px, y + 0.5 - py
      if dx * dx + dy * dy <= pr * pr and inWindow(x, y) then
        local lit = (-dx - dy) / pr
        local c = R.uv[2]
        if lit > 0.55 then c = R.uv[5] elseif lit > 0.1 then c = R.uv[4] elseif lit > -0.4 then c = R.uv[3] end
        put(L, x, y, c)
      end
    end
  end
  -- The ring, an ellipse tilted a little: its far half hides behind the planet, its near half crosses in front.
  for k = 0, 179 do
    local a = k * math.pi / 90
    local x = px + math.cos(a) * 11
    local y = py + math.sin(a) * 2.6 - math.cos(a) * 1.2
    local dx, dy = math.floor(x) + 0.5 - px, math.floor(y) + 0.5 - py
    local behind = math.sin(a) < 0 and dx * dx + dy * dy <= pr * pr
    if inWindow(x, y) and not behind then put(L, x, y, math.cos(a) < -0.3 and R.solar[6] or R.solar[4]) end
  end
  -- A slow freighter's beacon at the window's left, blinking.
  if f % 2 == 0 then put(L, 104, 14, R.coral[3]) end
  return L
end

-- The sign hanging from the beam: a dark plate with a solar border and a coin.
local function cartel(f)
  local L = layer()
  vline(L, 116, 3, 5, S[6]); vline(L, 140, 3, 5, S[6])
  rect(L, 112, 5, 144, 13, S[1])
  local glow = (f == 2) and R.solar[3] or R.solar[5]
  hline(L, 112, 144, 5, glow); hline(L, 112, 144, 13, glow)
  vline(L, 112, 5, 13, glow); vline(L, 144, 5, 13, glow)
  disc(L, 120.5, 9.5, 3.2, R.solar[4])
  disc(L, 120.5, 9.5, 2.2, R.solar[5])
  vline(L, 120, 8, 11, R.solar[3])
  -- Three bars of «market» script, not letters: the game is in Spanish and the sign stays wordless.
  for i = 0, 2 do hline(L, 127 + i * 5, 130 + i * 5, 9, (f == 2) and R.solar[3] or R.solar[6]) end
  hline(L, 127, 140, 11, R.solar[3])
  return L
end

-- Two counters: a lit top edge, a front with panels and coin lamps, and the emitters' discs on top.
local COUNTERS = { { 6, 88 }, { 168, 250 } }
local EMITTERS = { 24, 56, 186, 222 }
local function mostrador()
  local L = layer()
  for _, c in ipairs(COUNTERS) do
    local x0, x1 = c[1], c[2]
    hline(L, x0, x1, 34, S[9])
    hline(L, x0, x1, 35, S[7])
    rect(L, x0, 36, x1, H - 3, S[5])
    rect(L, x0, H - 2, x1, H - 1, S[2])
    for x = x0 + 10, x1 - 6, 14 do
      rect(L, x, 39, x + 7, 43, S[3])
      hline(L, x, x + 7, 39, S[2])
      disc(L, x + 3.5, 41.5, 1.6, R.solar[4])
    end
  end
  for _, ex in ipairs(EMITTERS) do
    hline(L, ex - 4, ex + 4, 33, S[8])
    hline(L, ex - 3, ex + 3, 32, R.ice[4])
  end
  return L
end

-- A holographic galaxy card over each emitter: a cone of light, a framed card with a small spiral that turns a step
-- each frame, scanlines; the card bobs a pixel.
local BOB = { 0, -1, -1, 0 }
local TONES = { R.ice, R.uv, R.coral, R.terminal }
local function hologramas(f)
  local L = layer()
  for i, ex in ipairs(EMITTERS) do
    local tone = TONES[i]
    local top = 10 + BOB[(f + i) % 4 + 1]
    -- The cone, sparse inside.
    for y = top + 20, 31 do
      local half = math.floor((y - (top + 20)) * 0.4) + 6
      for x = ex - half, ex + half do
        if bayer(x, y + f) < 0.18 then put(L, x, y, R.ice[3]) end
      end
    end
    -- The card.
    local x0, x1, y0, y1 = ex - 7, ex + 7, top, top + 19
    for y = y0, y1 do
      for x = x0, x1 do
        local edge = (x == x0 or x == x1 or y == y0 or y == y1)
        if edge then put(L, x, y, tone[#tone - 1])
        elseif (y + f) % 3 == 0 then put(L, x, y, R.space[3])
        else put(L, x, y, R.space[2]) end
      end
    end
    -- The galaxy: a faint halo, two log-spiral arms that wind outwards (turned a quarter each frame) and a 2×2 core.
    local cx, cy = ex + 0.5, top + 8.5
    for y = -5, 5 do
      for x = -5, 5 do
        if x * x + (y * 1.3) ^ 2 <= 25 and hash(ex + x, y, i + f) < 140 then put(L, cx + x, cy + y, tone[2]) end
      end
    end
    for arm = 0, 1 do
      for k = 0, 15 do
        local a = k * 0.42 + arm * math.pi + f * (math.pi / 2)
        local r = 1.2 * math.exp(k * 0.085)
        put(L, cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, (k < 6) and tone[#tone] or tone[#tone - 2])
      end
    end
    rect(L, cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5, R.ice[7])
    -- Its price tag below: a lit strip.
    hline(L, ex - 4, ex + 4, top + 17, (f + i) % 4 == 0 and R.solar[6] or R.solar[4])
  end
  return L
end

-- The beam's lamps: a chase of four.
local function luces(f)
  local L = layer()
  for x = 6, W - 1, 16 do
    local on = ((x // 16) % 4) == f
    put(L, x, 1, on and R.solar[6] or S[7])
    if on then put(L, x, 2, R.solar[4]) end
  end
  return L
end

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

local NAMES = { 'pared', 'ventana', 'cartel', 'mostrador', 'hologramas', 'luces' }
local spr = Sprite(W, H, ColorMode.RGB)
local layers = { spr.layers[1] }
layers[1].name = NAMES[1]
for i = 2, #NAMES do
  layers[i] = spr:newLayer()
  layers[i].name = NAMES[i]
end
local wall, counters = pared(), mostrador()
for f = 1, FRAMES do
  if f > 1 then spr:newEmptyFrame() end
  spr.frames[f].duration = 0.3
  local out = { pared = wall, ventana = ventana(f - 1), cartel = cartel(f - 1), mostrador = counters, hologramas = hologramas(f - 1), luces = luces(f - 1) }
  for i, n in ipairs(NAMES) do spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
end
spr:saveAs(OUT .. '/post.aseprite')
local sheet = Image(W * FRAMES, H, ColorMode.RGB)
for f = 1, FRAMES do
  local frame = Image(W, H, ColorMode.RGB)
  frame:drawSprite(spr, f)
  sheet:drawImage(frame, Point((f - 1) * W, 0))
end
sheet:saveAs(WEB .. '/post.png')
spr:close()
