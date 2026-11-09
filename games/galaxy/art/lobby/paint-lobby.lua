-- Galaxy Survivor: key art of the lobby «Escenario» (/incursion, the owner's chosen direction).
-- Paints, in editable layers, the launch pad the probe floats over (rim lights chasing, holo emitter breathing),
-- a distant orbital station (blinking beacons, lit windows) and a ringed gas giant, and exports each as a horizontal
-- strip of frames for CSS steps(). Run from games/galaxy:
--   aseprite -b --script-param out=art/lobby --script-param web=apps/web/src/hangar/lobby-art --script art/lobby/paint-lobby.lua
local OUT = app.params['out']
local WEB = app.params['web']

-- Ramps, dark to light, hue-shifted (the station's ramps, art/station/paint-rooms.lua).
local R = {
  steel = { '#07081a', '#0b0c24', '#151838', '#1f2350', '#2a2f5e', '#3a4278', '#4b5390', '#6670b0', '#8890c4', '#b9bfe6' },
  ice = { '#101a4a', '#26389a', '#3a58e0', '#6fb7ff', '#6fe3ff', '#bfe3ff', '#f3f5ff' },
  solar = { '#3a1410', '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#ffe9a8', '#fff8e0' },
  term = { '#06302a', '#0b7352', '#17b07e', '#45e3a6', '#a6ffd9' },
  uv = { '#1c1450', '#3a2a9a', '#5a43d6', '#7259ee', '#b39dff', '#e0d6ff' },
  nova = { '#2a0814', '#4a0f22', '#9c2238', '#e8435a', '#ff4d6d', '#ff8fa0' },
}
local S = R.steel
local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end

local COLOURS = {}
local function colour(c)
  local v = COLOURS[c]
  if not v then
    v = app.pixelColor.rgba(tonumber(c:sub(2, 3), 16), tonumber(c:sub(4, 5), 16), tonumber(c:sub(6, 7), 16), 255)
    COLOURS[c] = v
  end
  return v
end

-- A canvas: layers are tables of hex colours (nil: transparent).
local function canvas(W, H)
  local K = { W = W, H = H }
  function K.layer()
    local t = {}
    for y = 0, H - 1 do t[y] = {} end
    return t
  end
  function K.put(L, x, y, c)
    x, y = math.floor(x), math.floor(y)
    if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
  end
  function K.get(L, x, y)
    x, y = math.floor(x), math.floor(y)
    if x >= 0 and y >= 0 and x < W and y < H then return L[y][x] end
  end
  function K.rect(L, x0, y0, x1, y1, c)
    for y = y0, y1 do for x = x0, x1 do K.put(L, x, y, c) end end
  end
  function K.line(L, x0, y0, x1, y1, c)
    local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
    for i = 0, n do K.put(L, math.floor(x0 + (x1 - x0) * i / n + 0.5), math.floor(y0 + (y1 - y0) * i / n + 0.5), c) end
  end
  --- A filled ellipse, its colour chosen per pixel by `f(dx, dy, d)` (d: 0 at the centre, 1 at the edge).
  function K.ellipse(L, cx, cy, rx, ry, f)
    for y = math.floor(cy - ry) - 1, math.ceil(cy + ry) + 1 do
      for x = math.floor(cx - rx) - 1, math.ceil(cx + rx) + 1 do
        local dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
        local d = math.sqrt(dx * dx + dy * dy)
        if d <= 1 then
          local c = f(dx, dy, d, x, y)
          if c then K.put(L, x, y, c) end
        end
      end
    end
  end
  function K.image(L)
    local img = Image(W, H, ColorMode.RGB)
    for y = 0, H - 1 do
      for x = 0, W - 1 do
        local c = L[y][x]
        if c then img:drawPixel(x, y, colour(c)) end
      end
    end
    return img
  end
  return K
end

--- Saves the editable .aseprite (named layers, frames) and the web strip.
local function build(name, W, H, frames, names, paint, duration)
  local K = canvas(W, H)
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1] }
  layers[1].name = names[1]
  for i = 2, #names do
    layers[i] = spr:newLayer()
    layers[i].name = names[i]
  end
  for f = 1, frames do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = duration or 0.12
    local out = paint(K, f - 1, frames)
    for i, n in ipairs(names) do
      if out[n] then spr:newCel(layers[i], f, K.image(out[n]), Point(0, 0)) end
    end
  end
  spr:saveAs(OUT .. '/' .. name .. '.aseprite')
  local sheet = Image(W * frames, H, ColorMode.RGB)
  for f = 1, frames do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(WEB .. '/' .. name .. '.png')
  spr:close()
end

-- ——— The launch pad: a round deck seen from above at an angle, its rim, the hazard ring, eight lights chasing
-- around it and the holo emitter in the middle. 8 frames.
build('launchpad', 160, 64, 8, { 'estructura', 'cubierta', 'luces', 'holo' }, function(K, f, n)
  local cx, cy = 80, 26
  local base, deck, lights, holo = K.layer(), K.layer(), K.layer(), K.layer()
  -- Under the deck: the column and the struts, fading into the dark.
  for y = cy + 6, 63 do
    local t = (y - cy - 6) / (63 - cy - 6)
    local half = 26 - t * 12
    for x = math.floor(cx - half), math.ceil(cx + half) do
      local side = (x - cx) / half
      local i = math.max(2, math.floor(6 - t * 4 - math.abs(side) * 2 + 0.5))
      if bayer(x, y) > t * 0.9 then K.put(base, x, y, S[i]) end
    end
  end
  for _, sx in ipairs({ -54, 54 }) do K.line(base, cx + sx, cy + 6, cx + sx * 0.45, 60, S[4]) end
  -- The deck's side (thickness), then its top: rim, hazard ring, plates, the inner ring.
  K.ellipse(deck, cx, cy + 5, 74, 22, function(dx, dy) return dy > 0 and S[3] or nil end)
  K.ellipse(deck, cx, cy, 74, 22, function(dx, dy, d, x, y)
    if d > 0.93 then return dy < 0 and S[9] or S[6] end
    if d > 0.82 then
      -- The hazard ring: slanted stripes.
      local a = math.atan(dy, dx)
      local k = math.floor((a + math.pi) / (math.pi * 2) * 40 + (x - y) * 0.0)
      return (k % 2 == 0) and R.solar[5] or S[2]
    end
    if d > 0.78 then return S[2] end
    -- Plates: radial seams, lit toward the upper left.
    local a = math.atan(dy, dx)
    local seam = math.abs(((a + math.pi) / (math.pi * 2) * 12) % 1 - 0.5) < 0.04
    if seam then return S[3] end
    local lit = 0.5 - dx * 0.35 - dy * 0.45
    local i = 5 + (bayer(x, y) < lit and 1 or 0) + (d < 0.45 and 1 or 0)
    if d < 0.36 and d > 0.3 then return S[3] end
    return S[i]
  end)
  -- Eight rim lights; one runs around (the chase), the others glow softly.
  for i = 0, 15 do
    local a = i / 16 * math.pi * 2
    local x, y = cx + math.cos(a) * 70, cy + math.sin(a) * 20.5
    local on = (i % 8) == f
    local c = on and R.ice[7] or R.ice[4]
    K.rect(lights, x - 1, y, x + 1, y, c)
    if on then
      K.put(lights, x, y - 1, R.ice[6])
      K.put(lights, x, y + 1, R.ice[6])
    end
  end
  -- The holo emitter: a cyan disc that breathes, its rings expanding by frame.
  local breathe = 0.5 + 0.5 * math.sin(f / n * math.pi * 2)
  K.ellipse(holo, cx, cy, 22, 6.5, function(dx, dy, d, x, y)
    if d > 0.86 then return R.ice[5] end
    if bayer(x, y) < (1 - d) * (0.55 + breathe * 0.35) then return R.ice[4 + (d < 0.4 and 2 or 0)] end
  end)
  local ring = 0.4 + (f / n) * 0.6
  K.ellipse(holo, cx, cy, 22 * ring + 6, 6.5 * ring + 2, function(dx, dy, d, x, y)
    if d > 0.9 and bayer(x, y) < 0.8 - ring * 0.6 then return R.ice[6] end
  end)
  return { estructura = base, cubierta = deck, luces = lights, holo = holo }
end, 0.1)

-- ——— The distant station: a ring on spokes around a hub, solar wings, a docking arm, lit windows and beacons
-- that blink. 4 frames.
build('station', 200, 96, 4, { 'casco', 'paneles', 'luces' }, function(K, f)
  local hull, panels, lights = K.layer(), K.layer(), K.layer()
  local cx, cy = 100, 48
  -- Solar wings, left and right: blue cells in a grid on a spar.
  for _, side in ipairs({ -1, 1 }) do
    local x0 = side < 0 and 6 or 150
    K.rect(hull, side < 0 and 40 or 150, cy - 1, side < 0 and 50 or 160, cy + 1, S[6])
    for x = x0, x0 + 43 do
      for y = cy - 13, cy + 13 do
        local cell = (x % 5 == 0) or (y % 4 == 0)
        local c = cell and R.ice[1] or ((bayer(x, y) < 0.3) and R.ice[3] or R.ice[2])
        if y == cy - 13 or y == cy + 13 or x == x0 or x == x0 + 43 then c = S[4] end
        K.put(panels, x, y, c)
      end
    end
  end
  -- The ring (a torus seen at an angle): outer band lit on top, dark below; windows along it.
  K.ellipse(hull, cx, cy, 46, 17, function(dx, dy, d, x, y)
    if d < 0.74 then return nil end
    local lit = -dy * 0.6 - dx * 0.2
    local i = 4 + math.floor((lit + 0.6) * 3)
    if bayer(x, y) < 0.25 then i = i + 1 end
    return S[math.max(3, math.min(9, i))]
  end)
  -- Spokes and the hub.
  for i = 0, 3 do
    local a = i / 4 * math.pi * 2 + math.pi / 4
    K.line(hull, cx, cy, cx + math.cos(a) * 36, cy + math.sin(a) * 13, S[5])
  end
  K.ellipse(hull, cx, cy, 11, 9, function(dx, dy, d, x, y)
    local i = 6 + (dy < -0.2 and 2 or 0) - (dy > 0.4 and 2 or 0)
    if bayer(x, y) < 0.2 then i = i + 1 end
    return S[math.max(3, math.min(10, i))]
  end)
  -- The docking arm, up from the hub, with its cradle.
  K.rect(hull, cx - 2, cy - 30, cx + 2, cy - 9, S[6])
  K.rect(hull, cx - 7, cy - 34, cx + 7, cy - 30, S[7])
  K.rect(hull, cx - 7, cy - 34, cx + 7, cy - 34, S[9])
  -- Windows: warm and cool, a few go dark and light up again.
  for i = 0, 27 do
    local a = i / 28 * math.pi * 2
    local x, y = cx + math.cos(a) * 41, cy + math.sin(a) * 15
    if math.sin(a) > -0.2 and ((i * 7 + f) % 9 ~= 0) then K.put(lights, x, y, (i % 3 == 0) and R.solar[5] or R.ice[6]) end
  end
  -- Beacons: red on the left wing, green on the right, white on the arm; they blink in turn.
  if f % 2 == 0 then K.rect(lights, 5, cy - 1, 6, cy, R.nova[5]) end
  if f % 2 == 1 then K.rect(lights, 193, cy - 1, 194, cy, R.term[4]) end
  if f == 0 or f == 2 then K.rect(lights, cx - 1, cy - 37, cx, cy - 36, R.ice[7]) end
  K.put(lights, cx, cy, R.uv[5])
  return { casco = hull, paneles = panels, luces = lights }
end, 0.4)

-- ——— The gas giant: banded, dithered at the terminator, with a ring in front and behind. 1 frame.
build('planet', 160, 120, 1, { 'planeta', 'anillo' }, function(K)
  local body, ring = K.layer(), K.layer()
  local cx, cy, r = 80, 60, 44
  local bands = { R.uv[2], R.uv[3], R.uv[4], R.ice[2], R.uv[3], R.uv[5], R.uv[3], R.uv[2] }
  -- The ring behind the planet.
  K.ellipse(ring, cx, cy, 76, 16, function(dx, dy, d, x, y)
    if dy < 0 and d > 0.72 and d < 0.97 then return ((math.floor(d * 40)) % 3 == 0) and R.uv[2] or R.uv[4] end
  end)
  K.ellipse(body, cx, cy, r, r, function(dx, dy, d, x, y)
    local band = bands[math.floor((dy * 0.5 + 0.5) * #bands + math.sin(dx * 6) * 0.35) % #bands + 1]
    -- Light from the upper left; the night side dithers into the dark.
    local lit = -dx * 0.6 - dy * 0.5 + 0.45
    if lit < 0 and bayer(x, y) > lit + 1 then return S[1] end
    if lit < 0.15 and bayer(x, y) > (lit + 0.3) * 2 then return S[2] end
    if d > 0.95 and dx < 0 then return R.uv[6] end
    return band
  end)
  -- The ring in front.
  K.ellipse(ring, cx, cy, 76, 16, function(dx, dy, d, x, y)
    if dy >= 0 and d > 0.72 and d < 0.97 then return ((math.floor(d * 40)) % 3 == 0) and R.uv[3] or R.uv[5] end
  end)
  return { planeta = body, anillo = ring }
end)
