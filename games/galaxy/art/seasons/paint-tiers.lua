-- Galaxy Survivor: the season tiers' emblems (GDD §13.1, DESIGN_SYSTEM §8 undecies; M5a Task 4).
-- Paints Bronce, Plata, Oro, Platino and Estelar at 32×32 in four frames, each richer than the one before:
--   bronze    a heater shield with a chevron and rivets;
--   silver    a smaller shield with spread wings and a double chevron;
--   gold      a five-pointed star with bevelled faces and a gem;
--   platinum  a cut crystal with its facets, twinkling;
--   stellar   a crowned medallion with a turning spiral galaxy inside, twinkling.
-- Each has a shine that sweeps it diagonally, in editable layers (cuerpo, insignia, brillo), saves the .aseprite and
-- exports the strip the web plays with CSS steps(4). Run from games/galaxy:
--   aseprite -b --script-param out=art/seasons --script-param web=apps/web/src/social/tiers --script art/seasons/paint-tiers.lua
local W, H, FRAMES = 32, 32, 4
local OUT = app.params['out']
local WEB = app.params['web']

-- Ramps, outline first, then dark to light.
local R = {
  bronze = { '#1e0c04', '#5a2a10', '#8f4a1e', '#c2732f', '#e8a35f', '#ffd9ae' },
  silver = { '#11131f', '#3b4060', '#6a7090', '#a3a9c6', '#d6dbef', '#ffffff' },
  gold = { '#2a1203', '#7a3d08', '#c27a12', '#ffc94a', '#ffe58a', '#fffbe6' },
  platinum = { '#06141f', '#1a4a66', '#2f7f9e', '#6fd0e8', '#bff3ff', '#f6feff' },
  uv = { '#0d0828', '#1c1450', '#3a2a9a', '#7259ee', '#b39dff', '#f3efff' },
}

local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end

local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function put(L, x, y, c)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
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
local function union(a, b) return maskOf(function(px, py) return inM(a, math.floor(px), math.floor(py)) or inM(b, math.floor(px), math.floor(py)) end) end

--- Distance from a point to a segment.
local function segd(px, py, x0, y0, x1, y1)
  local dx, dy = x1 - x0, y1 - y0
  local t = math.max(0, math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)))
  return math.sqrt((px - x0 - t * dx) ^ 2 + (py - y0 - t * dy) ^ 2)
end
local function inPoly(px, py, pts)
  local inside, j = false, #pts
  for i = 1, #pts do
    local xi, yi, xj, yj = pts[i][1], pts[i][2], pts[j][1], pts[j][2]
    if (yi > py) ~= (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi then inside = not inside end
    j = i
  end
  return inside
end

--- Fills a mask with the ramp by a light value (0–1) per pixel: dithered between levels, a bevel (lit top-left
--- edges, shaded bottom-right ones) and the darkest colour as an outline around it.
local function body(L, m, ramp, light)
  local n = #ramp - 1
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if m[y][x] then
        local v = light(x + 0.5, y + 0.5)
        if not inM(m, x, y - 1) or not inM(m, x - 1, y) then v = v + 0.26 end
        if not inM(m, x, y + 1) or not inM(m, x + 1, y) then v = v - 0.24 end
        local t = math.max(0, math.min(0.999, v)) * n
        local i = math.floor(t)
        if t - i > bayer(x, y) then i = i + 1 end
        L[y][x] = ramp[math.min(#ramp, 2 + i)]
      elseif inM(m, x + 1, y) or inM(m, x - 1, y) or inM(m, x, y + 1) or inM(m, x, y - 1) then
        L[y][x] = ramp[1]
      end
    end
  end
end

--- The shine: a diagonal band that crosses the emblem once per loop (frame 0 waits before it, off the emblem).
local function shine(G, m, ramp, f)
  local phase = -10 + f * 17
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if m[y][x] then
        local d = math.abs(x + y - phase)
        if d < 1.2 then G[y][x] = ramp[#ramp] elseif d < 2.4 then G[y][x] = ramp[#ramp - 1] end
      end
    end
  end
end

--- A four-point twinkle of size 0–2.
local function twinkle(G, cx, cy, size, c, core)
  if size <= 0 then return end
  put(G, cx, cy, core)
  for k = 1, size do
    put(G, cx + k, cy, c)
    put(G, cx - k, cy, c)
    put(G, cx, cy + k, c)
    put(G, cx, cy - k, c)
  end
end

local function shield(cx, top, bottom, halfw)
  local mid = top + (bottom - top) * 0.42
  return maskOf(function(px, py)
    if py < top or py > bottom then return false end
    local w = halfw
    if py > mid then w = halfw * (1 - ((py - mid) / (bottom - mid)) ^ 1.6) end
    return math.abs(px - cx) <= w
  end)
end

local P = {}

function P.bronze(B, I, G, f)
  local ramp = R.bronze
  local m = shield(16, 3.5, 29, 10.5)
  body(B, m, ramp, function(_, py) return 0.78 - (py - 4) / 25 * 0.5 end)
  -- An inner border two pixels in (a heraldic shield), its lit side up and left.
  local inner = shield(16, 6, 25.6, 8)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if m[y][x] and not inner[y][x] and inM(inner, x + 1, y + 1) then I[y][x] = ramp[2] end
      if m[y][x] and not inner[y][x] and inM(inner, x - 1, y - 1) then I[y][x] = ramp[6] end
    end
  end
  -- A chevron across the middle, with its lit upper edge.
  for k = -6, 6 do
    local x, y = 16 + k, 12 + math.abs(k) * 0.8
    put(I, x, y + 1, ramp[2])
    put(I, x, y + 2, ramp[3])
    put(I, x, y, ramp[6])
  end
  shine(G, m, ramp, f)
end

function P.silver(B, I, G, f)
  local ramp = R.silver
  local wings = maskOf(function(px, py)
    local feathers = { { 9.5, 11, 2.5, 4.5, 1.9 }, { 9.5, 14.5, 2, 10, 1.7 }, { 9.5, 18, 3.5, 15.5, 1.5 } }
    for _, s in ipairs(feathers) do
      if segd(px, py, s[1], s[2], s[3], s[4]) < s[5] then return true end
      if segd(px, py, 32 - s[1], s[2], 32 - s[3], s[4]) < s[5] then return true end
    end
    return false
  end)
  body(B, wings, ramp, function(px, py) return 0.62 - (py - 4) / 20 * 0.3 + (math.abs(px - 16) > 10 and 0.08 or 0) end)
  local m = shield(16, 5, 28.5, 7.8)
  body(B, m, ramp, function(_, py) return 0.82 - (py - 5) / 24 * 0.5 end)
  for _, base in ipairs({ 12, 16.5 }) do
    for k = -4, 4 do
      local x, y = 16 + k, base + math.abs(k) * 0.7
      put(I, x, y + 1, ramp[2])
      put(I, x, y, ramp[6])
    end
  end
  shine(G, union(m, wings), ramp, f)
end

function P.gold(B, I, G, f)
  local ramp = R.gold
  local cx, cy, ro, ri = 16, 17, 14, 5.8
  local pts, tips = {}, {}
  for k = 0, 9 do
    local a = -math.pi / 2 + k * math.pi / 5
    local r = k % 2 == 0 and ro or ri
    pts[#pts + 1] = { cx + r * math.cos(a), cy + r * math.sin(a) }
    if k % 2 == 0 then tips[#tips + 1] = a end
  end
  local m = maskOf(function(px, py) return inPoly(px, py, pts) end)
  -- Bevelled faces: each point has two faces, lit or shaded by how they face the light (top-left).
  local light = -3 * math.pi / 4
  body(B, m, ramp, function(px, py)
    local a = math.atan(py - cy, px - cx)
    local best, side = nil, 0
    for _, t in ipairs(tips) do
      local d = math.atan(math.sin(a - t), math.cos(a - t))
      if not best or math.abs(d) < math.abs(best) then best, side = d, (d < 0 and -1 or 1) end
    end
    local face = a + side * 0.9
    return 0.55 + 0.32 * math.cos(face - light)
  end)
  -- The gem in the middle.
  for y = 14, 20 do
    for x = 13, 19 do
      local d = math.sqrt((x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2)
      if d < 2.9 then I[y][x] = d < 1.2 and R.uv[6] or (x + y < 33 and R.uv[5] or R.uv[4]) end
      if d >= 2.9 and d < 3.7 then I[y][x] = ramp[2] end
    end
  end
  shine(G, m, ramp, f)
  twinkle(G, 26, 6, ({ 0, 1, 2, 1 })[f + 1], ramp[5], ramp[6])
end

function P.platinum(B, I, G, f)
  local ramp = R.platinum
  local outline = { { 10.5, 5 }, { 21.5, 5 }, { 28, 12 }, { 16, 29.5 }, { 4, 12 } }
  local m = maskOf(function(px, py) return inPoly(px, py, outline) end)
  body(B, m, ramp, function(px, py)
    if py < 12 then
      if px < 12 + (py - 5) * -0.2 then return 0.72 end
      if px > 20 - (py - 5) * -0.2 then return 0.48 end
      return 0.92
    end
    -- The pavilion's facets fan out from the culet.
    local a = math.atan(px - 16, 29.5 - py)
    if a < -0.42 then return 0.5 elseif a < 0 then return 0.7 elseif a < 0.42 then return 0.42 end
    return 0.26
  end)
  -- Facet edges: the girdle and the lines down to the culet.
  for x = 5, 27 do if inM(m, x, 12) then I[12][x] = ramp[6] end end
  for _, gx in ipairs({ 10, 16, 22 }) do
    for k = 0, 16 do
      local t = k / 16
      local x, y = gx + (16 - gx) * t, 12 + (29 - 12) * t
      if inM(m, math.floor(x), math.floor(y)) and k % 2 == 0 then put(I, x, y, ramp[5]) end
    end
  end
  shine(G, m, ramp, f)
  local size = { 0, 1, 2, 1 }
  twinkle(G, 25, 5, size[f + 1], ramp[5], ramp[6])
  twinkle(G, 6, 22, size[(f + 2) % 4 + 1], ramp[5], ramp[6])
end

function P.stellar(B, I, G, f)
  local gold, uv = R.gold, R.uv
  local cx, cy = 16, 19
  local ring = maskOf(function(px, py)
    local d = math.sqrt((px - cx) ^ 2 + (py - cy) ^ 2)
    return d >= 9.2 and d <= 11.8
  end)
  local crown = maskOf(function(px, py)
    return inPoly(px, py, { { 8.5, 9 }, { 9.5, 2.5 }, { 12.8, 6 }, { 16, 0.8 }, { 19.2, 6 }, { 22.5, 2.5 }, { 23.5, 9 } })
  end)
  local disc = maskOf(function(px, py) return (px - cx) ^ 2 + (py - cy) ^ 2 < 9.2 ^ 2 end)
  -- The deep sky inside the ring, with a two-armed spiral that turns a quarter of a half turn per frame (seamless:
  -- two arms look the same after half a turn).
  local spin = f * math.pi / 4
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if disc[y][x] then
        local dx, dy = x + 0.5 - cx, y + 0.5 - cy
        local r = math.sqrt(dx * dx + dy * dy)
        local a = math.atan(dy, dx) - spin
        local arm = r > 2.4 and math.max(0, math.cos(2 * (a - math.log(r) * 2.2))) ^ 2 or 0
        local v = 0.1 + arm * 0.55 * (1.15 - r / 10) + (r < 1.6 and 0.75 or (r < 2.4 and 0.32 or 0))
        -- A few fixed stars in the deep sky.
        if (x * 7 + y * 13) % 29 == 0 and r > 4 then v = 0.85 end
        local t = math.min(0.999, v) * 5
        local i = math.floor(t)
        if t - i > bayer(x, y) then i = i + 1 end
        B[y][x] = uv[math.min(6, 1 + i)]
      end
    end
  end
  body(B, ring, gold, function(px, py) return 0.75 - (py - 8) / 22 * 0.45 + (px < cx and 0.06 or 0) end)
  body(B, crown, gold, function(_, py) return 0.86 - py / 10 * 0.3 end)
  -- Jewels on the crown's points.
  for _, p in ipairs({ { 9, 3 }, { 16, 1 }, { 22, 3 } }) do
    put(I, p[1], p[2] + 1, uv[5])
    put(I, p[1], p[2] + 2, uv[4])
  end
  put(I, 16, 6, uv[6])
  shine(G, union(ring, crown), gold, f)
  local size = { 2, 1, 0, 1 }
  twinkle(G, 4, 9, size[f + 1], uv[5], uv[6])
  twinkle(G, 28, 13, size[(f + 2) % 4 + 1], gold[5], gold[6])
  twinkle(G, 27, 27, size[(f + 1) % 4 + 1], uv[5], uv[6])
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

local NAMES = { 'cuerpo', 'insignia', 'brillo' }
for _, id in ipairs({ 'bronze', 'silver', 'gold', 'platinum', 'stellar' }) do
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1] }
  layers[1].name = NAMES[1]
  for i = 2, #NAMES do
    layers[i] = spr:newLayer()
    layers[i].name = NAMES[i]
  end
  for f = 1, FRAMES do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 0.18
    local B, I, G = layer(), layer(), layer()
    P[id](B, I, G, f - 1)
    local out = { cuerpo = B, insignia = I, brillo = G }
    for i, n in ipairs(NAMES) do spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
  end
  spr:saveAs(OUT .. '/' .. id .. '.aseprite')
  local sheet = Image(W * FRAMES, H, ColorMode.RGB)
  for f = 1, FRAMES do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(WEB .. '/' .. id .. '.png')
  spr:close()
end
