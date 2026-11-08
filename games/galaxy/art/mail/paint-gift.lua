-- Galaxy Survivor: the mailbox's gift parcel (GDD §16.5, DESIGN_SYSTEM §8 vicies).
-- Paints a 32×32 parcel in four frames, in editable layers (sombra, caja, cinta, lazo, brillo), saves the .aseprite
-- and exports the horizontal strip the web plays with CSS steps(4), at integer scale only.
-- A Hielo box with a lighter lid, a Solar ribbon tied in a bow, a soft shadow below; a glint runs down the ribbon and a
-- four-point spark blinks over the bow's right loop.
-- Run from games/galaxy:
--   aseprite -b --script-param out=art/mail --script-param web=apps/web/src/mail/art --script art/mail/paint-gift.lua
local W, H, FRAMES = 32, 32, 4
local OUT = app.params['out']
local WEB = app.params['web']

-- The station's ramps (art/station/paint-rooms.lua), dark to light.
local R = {
  steel = { '#07081a', '#0b0c24', '#151838', '#1f2350' },
  ice = { '#101a4a', '#26389a', '#3a58e0', '#6fb7ff', '#6fe3ff', '#bfe3ff', '#f3f5ff' },
  solar = { '#3a1410', '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#ffe9a8', '#fff8e0' },
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

-- The soft shadow: a flat ellipse under the box, darker in its middle.
local function sombra()
  local L = layer()
  for x = 6, 25 do put(L, x, 29, R.steel[3]) end
  for x = 9, 22 do put(L, x, 30, R.steel[2]) end
  return L
end

-- The box and its lid, lit from the top left: an outline, a lit front, a shaded right side.
local function caja()
  local L = layer()
  local BX0, BX1, BY0, BY1 = 6, 25, 14, 28
  rect(L, BX0, BY0, BX1, BY1, R.ice[3])
  rect(L, BX1 - 3, BY0, BX1, BY1, R.ice[2])
  for y = BY0, BY1 do put(L, BX0, y, R.ice[4]) end
  for x = BX0 - 1, BX1 + 1 do put(L, x, BY1 + 1, R.ice[1]) end
  for y = BY0, BY1 do put(L, BX0 - 1, y, R.ice[1]); put(L, BX1 + 1, y, R.ice[1]) end
  -- A dithered band under the lid's edge: its shadow on the box.
  for x = BX0, BX1 do if x % 2 == 0 then put(L, x, BY0, R.ice[2]) end end
  -- The lid, a pixel wider on each side and lighter.
  local LX0, LX1, LY0, LY1 = 4, 27, 10, 13
  rect(L, LX0, LY0, LX1, LY1, R.ice[4])
  rect(L, LX0, LY0, LX1, LY0, R.ice[6])
  rect(L, LX1 - 3, LY0 + 1, LX1, LY1, R.ice[3])
  for x = LX0 - 1, LX1 + 1 do put(L, x, LY0 - 1, R.ice[1]); put(L, x, LY1 + 1, R.ice[1]) end
  for y = LY0, LY1 do put(L, LX0 - 1, y, R.ice[1]); put(L, LX1 + 1, y, R.ice[1]) end
  return L
end

-- The ribbon: down the middle of lid and box, and across the box.
local function cinta()
  local L = layer()
  for y = 10, 28 do
    put(L, 14, y, R.solar[6]); put(L, 15, y, R.solar[5]); put(L, 16, y, R.solar[5]); put(L, 17, y, R.solar[3])
  end
  for x = 6, 25 do
    if x < 14 or x > 17 then put(L, x, 19, R.solar[6]); put(L, x, 20, R.solar[5]); put(L, x, 21, R.solar[3]) end
  end
  for x = 13, 18 do put(L, x, 9, R.solar[2]) end
  return L
end

-- The bow: two rounded loops leaning out from the knot, lit on top, with a small mid-tone opening; two short tails.
local function lazo()
  local L = layer()
  local LOOP = {
    '.EEEE.',
    'EHHHHE',
    'EFooFE',
    'EFFFFE',
    '.EEEE.',
  }
  local C = { E = R.solar[3], H = R.solar[6], F = R.solar[5], o = R.solar[4] }
  local function loop(x0, flip)
    for i, row in ipairs(LOOP) do
      for j = 1, #row do
        local ch = row:sub(j, j)
        local x = flip and (x0 + #row - j) or (x0 + j - 1)
        if C[ch] then put(L, x, 3 + i, C[ch]) end
      end
    end
  end
  loop(8, false)
  loop(18, true)
  rect(L, 14, 5, 17, 9, R.solar[4])
  rect(L, 14, 5, 15, 5, R.solar[7])
  put(L, 14, 6, R.solar[6])
  rect(L, 17, 6, 17, 9, R.solar[3])
  put(L, 12, 10, R.solar[3]); put(L, 11, 11, R.solar[4]); put(L, 19, 10, R.solar[3]); put(L, 20, 11, R.solar[4])
  return L
end

-- The glint (down the ribbon, one step a frame) and the spark over the right loop (big, small, big, off).
local function brillo(f)
  local L = layer()
  local y = 12 + f * 4
  put(L, 14, y, R.solar[7]); put(L, 15, y, R.solar[7]); put(L, 15, y + 1, R.solar[6])
  if f < 3 then
    local sx, sy = 25, 3
    put(L, sx, sy, R.ice[7])
    if f ~= 1 then
      put(L, sx - 1, sy, R.ice[6]); put(L, sx + 1, sy, R.ice[6]); put(L, sx, sy - 1, R.ice[6]); put(L, sx, sy + 1, R.ice[6])
    end
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

local NAMES = { 'sombra', 'caja', 'cinta', 'lazo', 'brillo' }
local spr = Sprite(W, H, ColorMode.RGB)
local layers = { spr.layers[1] }
layers[1].name = NAMES[1]
for i = 2, #NAMES do
  layers[i] = spr:newLayer()
  layers[i].name = NAMES[i]
end
local still = { sombra = sombra(), caja = caja(), cinta = cinta(), lazo = lazo() }
for f = 1, FRAMES do
  if f > 1 then spr:newEmptyFrame() end
  spr.frames[f].duration = 0.2
  local out = { sombra = still.sombra, caja = still.caja, cinta = still.cinta, lazo = still.lazo, brillo = brillo(f - 1) }
  for i, n in ipairs(NAMES) do spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
end
spr:saveAs(OUT .. '/gift.aseprite')
local sheet = Image(W * FRAMES, H, ColorMode.RGB)
for f = 1, FRAMES do
  local frame = Image(W, H, ColorMode.RGB)
  frame:drawSprite(spr, f)
  sheet:drawImage(frame, Point((f - 1) * W, 0))
end
sheet:saveAs(WEB .. '/gift.png')
spr:close()
