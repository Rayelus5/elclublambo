-- Galaxy Survivor: the arts a pack of the mail library can have (mail v2, P4; DESIGN_SYSTEM «Regalos y packs»).
-- Next to the mailbox's parcel (paint-gift.lua, the «parcel» art), five more, each 32×32 in four frames, saved as
-- .aseprite and exported as the horizontal strip the web plays with CSS steps(4), at integer scale only:
--   chest    a wooden chest with Solar bands and lock; a spark runs over the lid.
--   capsule  a supply capsule, Hielo shell with a Terminal window whose light pulses.
--   star     a Solar star with a lit facet; a four-point spark turns round it.
--   crate    a Terminal crate with a brace; a glint sweeps across.
--   gift     a violet box with a Nova ribbon and bow; the glint runs down the ribbon.
-- Run from games/galaxy:
--   aseprite -b --script-param out=art/mail --script-param web=apps/web/src/mail/art --script art/mail/paint-packs.lua
local W, H, FRAMES = 32, 32, 4
local OUT = app.params['out']
local WEB = app.params['web']

-- The game's ramps, dark to light (the station's steel, Hielo and Solar; Terminal, UV and Nova from the tokens).
local R = {
  steel = { '#07081a', '#0b0c24', '#151838', '#1f2350' },
  ice = { '#101a4a', '#26389a', '#3a58e0', '#6fb7ff', '#6fe3ff', '#bfe3ff', '#f3f5ff' },
  solar = { '#3a1410', '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#ffe9a8', '#fff8e0' },
  wood = { '#24100c', '#4a2316', '#74391f', '#a2582c', '#c97c3e', '#e8a560' },
  terminal = { '#06241b', '#0e4a36', '#1c7a55', '#2fb07a', '#5fe3a8', '#b8ffe0' },
  uv = { '#1a0a3a', '#34146e', '#5527a8', '#7a45e0', '#a77cff', '#d6c2ff' },
  nova = { '#3a0a24', '#6e1240', '#b0245e', '#ff4f8b', '#ff8fb5', '#ffd1e2' },
}

local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function put(L, x, y, c)
  if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
end
local function rect(L, x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do put(L, x, y, c) end end
end
-- An outline of `c` round every painted pixel of L that touches an empty one (outside only).
local function outline(L, c)
  local O = layer()
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if not L[y][x] then
        local n = (L[y - 1] and L[y - 1][x]) or (L[y + 1] and L[y + 1][x]) or L[y][x - 1] or L[y][x + 1]
        if n then put(O, x, y, c) end
      end
    end
  end
  return O
end
local function merge(...)
  local out = layer()
  for _, L in ipairs({ ... }) do
    for y = 0, H - 1 do for x = 0, W - 1 do if L[y][x] then out[y][x] = L[y][x] end end end
  end
  return out
end
local function shadow(x0, x1)
  local L = layer()
  for x = x0, x1 do put(L, x, 29, R.steel[3]) end
  for x = x0 + 3, x1 - 3 do put(L, x, 30, R.steel[2]) end
  return L
end
-- A four-point spark (big when `big`, else just its centre).
local function spark(L, x, y, big)
  put(L, x, y, R.ice[7])
  if big then
    put(L, x - 1, y, R.ice[6]); put(L, x + 1, y, R.ice[6]); put(L, x, y - 1, R.ice[6]); put(L, x, y + 1, R.ice[6])
  end
end

-- chest: a box of planks with a rounded lid, Solar bands and a lock with its keyhole.
local function chest(f)
  local body = layer()
  rect(body, 5, 16, 26, 28, R.wood[3])
  for y = 16, 28 do put(body, 5, y, R.wood[4]) end
  rect(body, 23, 16, 26, 28, R.wood[2])
  for x = 5, 26 do put(body, x, 22, R.wood[2]) end
  local lid = layer()
  rect(lid, 5, 10, 26, 15, R.wood[4])
  rect(lid, 6, 9, 25, 9, R.wood[5])
  rect(lid, 8, 8, 23, 8, R.wood[5])
  rect(lid, 6, 10, 25, 10, R.wood[6])
  rect(lid, 23, 10, 26, 15, R.wood[3])
  local bands = layer()
  for _, bx in ipairs({ 8, 21 }) do
    rect(bands, bx, 8, bx + 1, 28, R.solar[4])
    for y = 8, 28 do put(bands, bx, y, R.solar[5]) end
  end
  rect(bands, 5, 15, 26, 16, R.solar[3])
  local lock = layer()
  rect(lock, 14, 13, 17, 19, R.solar[5])
  rect(lock, 14, 13, 17, 13, R.solar[6])
  put(lock, 15, 16, R.steel[1]); put(lock, 16, 16, R.steel[1]); put(lock, 15, 17, R.steel[1])
  local shape = merge(body, lid, bands, lock)
  local glint = layer()
  local gx = ({ 9, 13, 18, 23 })[f + 1]
  put(glint, gx, 9, R.solar[7]); put(glint, gx + 1, 9, R.solar[6])
  if f % 2 == 0 then spark(glint, 27, 6, f == 0) end
  return { sombra = shadow(4, 27), contorno = outline(shape, R.steel[1]), cuerpo = shape, brillo = glint }
end

-- capsule: a rounded Hielo shell lying down, a seam, and a Terminal window whose light pulses.
local function capsule(f)
  local shell = layer()
  for y = 10, 25 do
    local inset = (y == 10 or y == 25) and 3 or ((y == 11 or y == 24) and 1 or 0)
    rect(shell, 4 + inset, y, 27 - inset, y, R.ice[3])
  end
  rect(shell, 5, 11, 26, 12, R.ice[5])
  rect(shell, 4, 13, 27, 13, R.ice[4])
  rect(shell, 5, 22, 26, 24, R.ice[2])
  for y = 11, 24 do put(shell, 15, y, R.ice[1]) end
  -- Feet.
  rect(shell, 7, 26, 9, 27, R.steel[4]); rect(shell, 22, 26, 24, 27, R.steel[4])
  local window = layer()
  local glow = ({ R.terminal[4], R.terminal[5], R.terminal[6], R.terminal[5] })[f + 1]
  rect(window, 18, 15, 24, 20, R.terminal[2])
  rect(window, 19, 16, 23, 19, glow)
  put(window, 19, 16, R.terminal[6])
  local band = layer()
  for x = 6, 13 do put(band, x, 17, R.solar[4]); put(band, x, 18, R.solar[3]) end
  local shape = merge(shell, window, band)
  local glint = layer()
  if f < 3 then spark(glint, 9, 8 - (f % 2), f ~= 1) end
  return { sombra = shadow(5, 26), contorno = outline(shape, R.steel[1]), cuerpo = shape, brillo = glint }
end

-- star: a five-point Solar star, its upper-left facets lit and its lower-right ones in shade.
local function inside(px, py, pts)
  local c = false
  local j = #pts
  for i = 1, #pts do
    local xi, yi, xj, yj = pts[i][1], pts[i][2], pts[j][1], pts[j][2]
    if ((yi > py) ~= (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi) then c = not c end
    j = i
  end
  return c
end
local function star(f)
  local cx, cy, ro, ri = 15.5, 16.5, 14, 6
  local pts = {}
  for k = 0, 9 do
    local a = -math.pi / 2 + k * math.pi / 5
    local r = (k % 2 == 0) and ro or ri
    pts[#pts + 1] = { cx + r * math.cos(a), cy + r * math.sin(a) }
  end
  local body = layer()
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if inside(x + 0.5, y + 0.5, pts) then
        local dx, dy = x + 0.5 - cx, y + 0.5 - cy
        local c = R.solar[4]
        if dx + dy < -4 then c = R.solar[6] elseif dx + dy < 1 then c = R.solar[5] elseif dx + dy > 7 then c = R.solar[3] end
        put(body, x, y, c)
      end
    end
  end
  -- A lit centre.
  rect(body, 14, 14, 16, 16, R.solar[6]); put(body, 14, 14, R.solar[7])
  local glint = layer()
  local spots = { { 27, 5 }, { 28, 22 }, { 4, 23 }, { 3, 6 } }
  local s = spots[f + 1]
  spark(glint, s[1], s[2], true)
  return { sombra = shadow(6, 25), contorno = outline(body, R.solar[1]), cuerpo = body, brillo = glint }
end

-- crate: a Terminal crate of boards with a frame and a diagonal brace; a glint sweeps across its face.
local function crate(f)
  local body = layer()
  rect(body, 5, 9, 26, 28, R.terminal[3])
  for y = 9, 28 do if y % 5 == 3 then rect(body, 5, y, 26, y, R.terminal[2]) end end
  rect(body, 5, 9, 26, 10, R.terminal[4])
  rect(body, 5, 9, 6, 28, R.terminal[4])
  rect(body, 25, 9, 26, 28, R.terminal[2])
  rect(body, 5, 27, 26, 28, R.terminal[2])
  for i = 0, 17 do put(body, 7 + i, 26 - i, R.terminal[5]); put(body, 8 + i, 26 - i, R.terminal[4]) end
  -- A stencilled mark: a small Solar chevron.
  put(body, 21, 13, R.solar[5]); put(body, 22, 14, R.solar[5]); put(body, 23, 13, R.solar[5])
  local glint = layer()
  local gx = ({ 6, 12, 18, 24 })[f + 1]
  for i = 0, 3 do put(glint, gx + i, 11 + i, R.terminal[6]) end
  if f == 2 then spark(glint, 27, 6, true) end
  return { sombra = shadow(4, 27), contorno = outline(body, R.steel[1]), cuerpo = body, brillo = glint }
end

-- gift: the parcel's shapes in UV with a Nova ribbon tied in a bow.
local function gift(f)
  local box = layer()
  rect(box, 6, 14, 25, 28, R.uv[3])
  rect(box, 22, 14, 25, 28, R.uv[2])
  for y = 14, 28 do put(box, 6, y, R.uv[4]) end
  for x = 6, 25 do if x % 2 == 0 then put(box, x, 14, R.uv[2]) end end
  rect(box, 4, 10, 27, 13, R.uv[4])
  rect(box, 4, 10, 27, 10, R.uv[6])
  rect(box, 24, 11, 27, 13, R.uv[3])
  local ribbon = layer()
  for y = 10, 28 do put(ribbon, 14, y, R.nova[6]); put(ribbon, 15, y, R.nova[5]); put(ribbon, 16, y, R.nova[5]); put(ribbon, 17, y, R.nova[3]) end
  for x = 6, 25 do
    if x < 14 or x > 17 then put(ribbon, x, 19, R.nova[6]); put(ribbon, x, 20, R.nova[5]); put(ribbon, x, 21, R.nova[3]) end
  end
  local LOOP = { '.EEEE.', 'EHHHHE', 'EFooFE', 'EFFFFE', '.EEEE.' }
  local C = { E = R.nova[3], H = R.nova[6], F = R.nova[5], o = R.nova[4] }
  local function loop(x0, flip)
    for i, row in ipairs(LOOP) do
      for j = 1, #row do
        local ch = row:sub(j, j)
        local x = flip and (x0 + #row - j) or (x0 + j - 1)
        if C[ch] then put(ribbon, x, 3 + i, C[ch]) end
      end
    end
  end
  loop(8, false)
  loop(18, true)
  rect(ribbon, 14, 5, 17, 9, R.nova[4])
  rect(ribbon, 14, 5, 15, 5, R.nova[6])
  local shape = merge(box, ribbon)
  local glint = layer()
  local y = 12 + f * 4
  put(glint, 14, y, R.nova[6]); put(glint, 15, y, R.nova[6]); put(glint, 15, y + 1, R.nova[5])
  if f < 3 then spark(glint, 25, 3, f ~= 1) end
  return { sombra = shadow(5, 26), contorno = outline(shape, R.uv[1]), cuerpo = shape, brillo = glint }
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

local NAMES = { 'sombra', 'contorno', 'cuerpo', 'brillo' }
local ARTS = { chest = chest, capsule = capsule, star = star, crate = crate, gift = gift }
for name, paint in pairs(ARTS) do
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1] }
  layers[1].name = NAMES[1]
  for i = 2, #NAMES do
    layers[i] = spr:newLayer()
    layers[i].name = NAMES[i]
  end
  for f = 1, FRAMES do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 0.2
    local out = paint(f - 1)
    for i, n in ipairs(NAMES) do spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
  end
  spr:saveAs(OUT .. '/pack-' .. name .. '.aseprite')
  local sheet = Image(W * FRAMES, H, ColorMode.RGB)
  for f = 1, FRAMES do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(WEB .. '/pack-' .. name .. '.png')
  spr:close()
end
