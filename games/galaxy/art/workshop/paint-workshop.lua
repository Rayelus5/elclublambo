-- Galaxy Survivor: the probe workshop's bay (the owner's «taller espacial»). Paints the bay at 128×72 in 6 frames,
-- in editable layers (pared, maquinaria, brazos, luces), saves the .aseprite and exports the horizontal strip the web
-- plays with CSS steps(). The probe itself is drawn by the web over the cradle in the middle. Run from games/galaxy:
--   aseprite -b --script-param out=art/workshop --script-param web=apps/web/src/workshop/art --script art/workshop/paint-workshop.lua
local OUT = app.params['out']
local WEB = app.params['web']
local W, H, FRAMES = 128, 72, 6

-- Ramps, dark to light, hue-shifted (the station's, art/station/paint-rooms.lua).
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
local function hash(x, y, s)
  local h = (x * 73856093) ~ (y * 19349663) ~ (s * 83492791)
  h = (h ~ (h >> 13)) * 1274126177
  h = h ~ (h >> 16)
  return h % 1000
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
local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function put(L, x, y, c)
  x, y = math.floor(x), math.floor(y)
  if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
end
local function get(L, x, y)
  x, y = math.floor(x), math.floor(y)
  if x >= 0 and y >= 0 and x < W and y < H then return L[y][x] end
end
local function rect(L, x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do put(L, x, y, c) end end
end
local function line(L, x0, y0, x1, y1, c, thick)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do
    local x, y = math.floor(x0 + (x1 - x0) * i / n + 0.5), math.floor(y0 + (y1 - y0) * i / n + 0.5)
    put(L, x, y, c)
    if thick then put(L, x + 1, y, c); put(L, x, y + 1, c) end
  end
end
local function ellipse(L, cx, cy, rx, ry, f)
  for y = math.floor(cy - ry) - 1, math.ceil(cy + ry) + 1 do
    for x = math.floor(cx - rx) - 1, math.ceil(cx + rx) + 1 do
      local dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
      local d = math.sqrt(dx * dx + dy * dy)
      if d <= 1 then
        local c = f(dx, dy, d, x, y)
        if c then put(L, x, y, c) end
      end
    end
  end
end
--- A bevelled box: outline, lit top and left, shaded bottom and right.
local function box(L, x0, y0, x1, y1, ramp, i)
  rect(L, x0, y0, x1, y1, ramp[i])
  rect(L, x0 + 1, y0 + 1, x1 - 1, y0 + 1, ramp[math.min(#ramp, i + 2)])
  rect(L, x0 + 1, y0 + 1, x0 + 1, y1 - 1, ramp[math.min(#ramp, i + 1)])
  rect(L, x0 + 1, y1 - 1, x1 - 1, y1 - 1, ramp[math.max(1, i - 1)])
  rect(L, x0, y0, x1, y0, S[2]); rect(L, x0, y1, x1, y1, S[2])
  rect(L, x0, y0, x0, y1, S[2]); rect(L, x1, y0, x1, y1, S[2])
end
--- Lighten one ramp step where the dither says so: the lamps' cones.
local WHERE = {}
for name, ramp in pairs(R) do for i, c in ipairs(ramp) do WHERE[c] = WHERE[c] or { name, i } end end
local function lighten(L, x, y, amount)
  local c = get(L, x, y)
  local w = c and WHERE[c]
  if w and bayer(x, y) < amount then put(L, x, y, R[w[1]][math.min(#R[w[1]], w[2] + 1)]) end
end

local function paint(f)
  local wall, gear, arms, lights = layer(), layer(), layer(), layer()
  -- The back wall: panels with seams and rivets, darker near the floor.
  for y = 0, 55 do
    for x = 0, W - 1 do
      local i = (y < 6) and 3 or 4
      if x % 16 == 0 or y == 30 then i = 3 end
      if (x % 16 == 2 or x % 16 == 13) and (y == 8 or y == 28 or y == 33 or y == 52) then i = 6 end
      if y > 44 and bayer(x, y) < (y - 44) / 14 then i = i - 1 end
      put(wall, x, y, S[i])
    end
  end
  -- The great window: space, stars that twinkle by frame, the rim of a planet.
  rect(wall, 38, 4, 89, 27, S[2])
  for y = 5, 26 do
    for x = 39, 88 do
      local c = '#070a1c'
      if hash(x, y, 7) < 18 then c = ((hash(x, y, f) % 3) == 0) and R.ice[6] or S[8] end
      local dx, dy = x - 96, y - 40
      if dx * dx + dy * dy < 30 * 30 and dx * dx + dy * dy > 27 * 27 and bayer(x, y) < 0.7 then c = R.uv[4] end
      if dx * dx + dy * dy <= 27 * 27 then c = (bayer(x, y) < 0.35) and R.uv[2] or R.uv[1] end
      put(wall, x, y, c)
    end
  end
  for x = 38, 89 do put(wall, x, 4, S[7]); put(wall, x, 27, S[6]) end
  for y = 4, 27 do put(wall, 38, y, S[7]); put(wall, 89, y, S[6]); put(wall, 63, y, S[5]) end
  -- Left: the tool rack (wrenches, a drill) and a holo screen whose bars move.
  box(gear, 4, 10, 30, 30, S, 5)
  for i = 0, 3 do
    local x = 8 + i * 6
    rect(gear, x, 13, x + 1, 24, S[9])
    rect(gear, x - 1, 12, x + 2, 13, S[8])
  end
  rect(gear, 7, 26, 27, 27, R.solar[3])
  box(gear, 4, 34, 30, 50, S, 3)
  for i = 0, 4 do
    local hgt = 3 + (hash(i, f, 3) % 8)
    rect(gear, 7 + i * 5, 47 - hgt, 9 + i * 5, 47, (i % 2 == 0) and R.ice[5] or R.ice[4])
  end
  rect(gear, 6, 36, 28, 36, R.ice[6])
  -- Right: crates and a monitor with the probe's schematic.
  box(gear, 98, 10, 123, 28, S, 3)
  ellipse(gear, 110, 19, 7, 5, function(dx, dy, d) if d > 0.8 then return R.uv[5] end end)
  line(gear, 103, 19, 117, 19, R.uv[4])
  line(gear, 110, 14, 110, 24, R.uv[4])
  put(gear, 110 + ((f * 2) % 8) - 4, 19, R.uv[6])
  box(gear, 98, 38, 112, 52, R.solar, 3)
  box(gear, 113, 42, 124, 52, R.solar, 2)
  rect(gear, 101, 44, 109, 44, R.solar[2])
  -- The floor: deck plates and the hazard band toward the cradle.
  for y = 56, H - 1 do
    for x = 0, W - 1 do
      local c = ((x + (y - 56) // 2) % 12 == 0) and S[3] or S[4]
      if y == 56 then c = S[7] end
      if y > 62 and bayer(x, y) < (y - 62) / 12 then c = S[3] end
      put(gear, x, y, c)
    end
  end
  -- The cradle: a raised round deck with two clamps and running lights.
  ellipse(gear, 64, 62, 34, 6, function(dx, dy) return dy > 0 and S[3] or nil end)
  ellipse(gear, 64, 60, 34, 6, function(dx, dy, d, x, y)
    if d > 0.88 then return (dy < 0) and S[9] or S[6] end
    if d > 0.74 then return (((x // 3) + (y // 2)) % 2 == 0) and R.solar[5] or S[2] end
    return (bayer(x, y) < 0.4 - dy * 0.3) and S[7] or S[6]
  end)
  for i = 0, 7 do
    local a = i / 8 * math.pi * 2
    local x, y = 64 + math.cos(a) * 31, 60 + math.sin(a) * 5
    put(lights, x, y, (i == f % 8 or i == (f + 4) % 8) and R.ice[7] or R.ice[4])
  end
  for _, sx in ipairs({ -1, 1 }) do
    local x = 64 + sx * 38
    box(gear, math.min(x, x + sx * 6), 46, math.max(x, x + sx * 6), 60, S, 6)
    rect(gear, math.min(x, x - sx * 6), 50, math.max(x, x - sx * 6), 52, S[8])
    put(lights, x + sx * 3, 48, (f % 2 == 0) and R.term[4] or R.term[2])
  end
  -- The ceiling rail and two arms reaching to the cradle; their tips sway and weld in turn.
  rect(arms, 0, 1, W - 1, 3, S[6])
  rect(arms, 0, 1, W - 1, 1, S[8])
  local sway = { 0, 1, 2, 1, 0, -1 }
  for side = 1, 2 do
    local base = side == 1 and 30 or 98
    local dir = side == 1 and 1 or -1
    local s = sway[(f + (side - 1) * 3) % 6 + 1]
    local ex, ey = base + dir * 6, 20
    local tx, ty = 64 - dir * (14 - s), 44 + s
    rect(arms, base - 3, 3, base + 3, 6, S[5])
    line(arms, base, 6, ex, ey, S[7], true)
    line(arms, ex, ey, tx, ty, S[6], true)
    ellipse(arms, base, 6, 2.5, 2.5, function() return R.solar[4] end)
    ellipse(arms, ex, ey, 2.5, 2.5, function() return R.solar[4] end)
    rect(arms, tx - 1, ty - 1, tx + 2, ty + 2, S[8])
    -- Welding: sparks at the tip, one arm after the other.
    local welding = (side == 1 and (f == 1 or f == 2)) or (side == 2 and (f == 4 or f == 5))
    if welding then
      put(lights, tx + dir, ty + 3, R.solar[7])
      put(lights, tx + dir * 2, ty + 4, R.solar[6])
      for k = 0, 5 do
        local h = hash(k, f, side)
        put(lights, tx + dir * (1 + h % 5), ty + 3 + (h // 7) % 6, (k % 2 == 0) and R.solar[6] or R.ice[7])
      end
    end
  end
  -- Lamps on the ceiling and their light on the wall.
  for _, lx in ipairs({ 16, 112 }) do
    rect(lights, lx - 2, 4, lx + 2, 5, R.solar[6])
    for y = 6, 40 do
      local half = 2 + (y - 6) * 0.35
      for x = math.floor(lx - half), math.ceil(lx + half) do lighten(wall, x, y, 0.35 * (1 - (y - 6) / 40)) end
    end
  end
  return { pared = wall, maquinaria = gear, brazos = arms, luces = lights }
end

local NAMES = { 'pared', 'maquinaria', 'brazos', 'luces' }
local spr = Sprite(W, H, ColorMode.RGB)
local layers = { spr.layers[1] }
layers[1].name = NAMES[1]
for i = 2, #NAMES do
  layers[i] = spr:newLayer()
  layers[i].name = NAMES[i]
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
for f = 1, FRAMES do
  if f > 1 then spr:newEmptyFrame() end
  spr.frames[f].duration = 0.14
  local out = paint(f - 1)
  for i, n in ipairs(NAMES) do
    if out[n] then spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
  end
end
spr:saveAs(OUT .. '/bay.aseprite')
local sheet = Image(W * FRAMES, H, ColorMode.RGB)
for f = 1, FRAMES do
  local frame = Image(W, H, ColorMode.RGB)
  frame:drawSprite(spr, f)
  sheet:drawImage(frame, Point((f - 1) * W, 0))
end
sheet:saveAs(WEB .. '/bay.png')
spr:close()
