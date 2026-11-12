-- Galaxy Survivor: the profile cosmetics' editable sources (bloque C, C3).
-- Turns each PNG the generator wrote (build.py) into an .aseprite file, one frame per frame of the strip, with the
-- speed the web plays it at (avatars at 6 fps, frames at 8 fps), on a layer called «arte». Run from games/galaxy:
--   aseprite -b --script-param web=apps/web/src/profile/art --script-param out=art/profile --script art/profile/gen/sources.lua
-- The generator (art/profile/gen) is the source of truth: edit there, rebuild, and run this again.
local WEB = app.params['web']
local OUT = app.params['out']

local KINDS = {
  { dir = 'avatars', size = 32, ms = 167 },
  { dir = 'frames', size = 48, ms = 125 },
}

local function pngs(dir)
  local list = {}
  for _, name in ipairs(app.fs.listFiles(dir)) do
    if name:match('%.png$') then table.insert(list, name) end
  end
  table.sort(list)
  return list
end

local count = 0
for _, kind in ipairs(KINDS) do
  local src = app.fs.joinPath(WEB, kind.dir)
  local dst = app.fs.joinPath(OUT, kind.dir)
  app.fs.makeAllDirectories(dst)
  for _, name in ipairs(pngs(src)) do
    local id = name:gsub('%.png$', '')
    local strip = Image { fromFile = app.fs.joinPath(src, name) }
    local n = strip.width // kind.size
    local spr = Sprite(kind.size, kind.size, ColorMode.RGB)
    local layer = spr.layers[1]
    layer.name = 'arte'
    for f = 1, n do
      if f > 1 then spr:newEmptyFrame() end
      local img = Image(kind.size, kind.size, ColorMode.RGB)
      img:drawImage(strip, Point(-(f - 1) * kind.size, 0))
      spr:newCel(layer, f, img, Point(0, 0))
      spr.frames[f].duration = kind.ms / 1000
    end
    spr:saveAs(app.fs.joinPath(dst, id .. '.aseprite'))
    spr:close()
    count = count + 1
  end
end
print(count .. ' sources saved')
