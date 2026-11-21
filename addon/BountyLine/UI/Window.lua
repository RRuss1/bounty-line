-- Shared window look: the classic grey metal dialog border around a dark parchment panel, a
-- tall gold title bar, an inset content panel with a fine gold edge (Dungeon Journal style),
-- and a slowly pulsing blood-red glow that grows inward over the metal.
local _, ns = ...

local WHITE = "Interface\\Buttons\\WHITE8x8"
local ICON = "Interface\\Icons\\INV_Misc_Bone_HumanSkull_01"
-- Our own backgrounds (Media/): dark, softened crops of the wanted-poster parchment.
local WINDOW_BG = "Interface\\AddOns\\BountyLine\\Media\\window-bg"
local PANEL_BG = "Interface\\AddOns\\BountyLine\\Media\\panel-bg"

local COLORS = {
  header = { 0.05, 0.04, 0.035, 0.75 },    -- darkens the title strip
  gold = { 1, 0.82, 0.25 },
  goldEdge = { 0.62, 0.47, 0.22, 0.8 },
  red = { 0.9, 0.06, 0.04 },
  body = { 0.95, 0.93, 0.88 },
  muted = { 0.66, 0.64, 0.6 },
  error = { 1, 0.35, 0.3 },
}
ns.COLORS = COLORS

local function rect(parent, layer, color, sublevel)
  local t = parent:CreateTexture(nil, layer, nil, sublevel or 0)
  t:SetTexture(WHITE)
  t:SetVertexColor(color[1], color[2], color[3], color[4] or 1)
  return t
end

local function image(parent, layer, path)
  local t = parent:CreateTexture(nil, layer)
  t:SetTexture(path)
  return t
end

-- 1px edge drawn as four lines, `out` pixels outside the frame.
-- Returns the four lines. A negative `out` draws inside.
local function edge(parent, layer, color, out, sublevel)
  local lines = {}
  for _, side in ipairs({ "TOP", "BOTTOM", "LEFT", "RIGHT" }) do
    local t = rect(parent, layer, color, sublevel)
    lines[#lines + 1] = t
    if side == "TOP" or side == "BOTTOM" then
      t:SetHeight(1)
      t:SetPoint(side .. "LEFT", -out, side == "TOP" and out or -out)
      t:SetPoint(side .. "RIGHT", out, side == "TOP" and out or -out)
    else
      t:SetWidth(1)
      t:SetPoint("TOP" .. side, side == "LEFT" and -out or out, out)
      t:SetPoint("BOTTOM" .. side, side == "LEFT" and -out or out, -out)
    end
  end
  return lines
end

-- The red glow grows inward from the window's edge with rounded corners: four corner pieces
-- and four edge strips (Media/glow-*.tga, white with a soft falloff), tinted red and added on
-- top of the metal so it shows through red-hot. Pulses slowly.
local GLOW_SIZE = 16
local MEDIA = "Interface\\AddOns\\BountyLine\\Media\\"
local function glowPiece(holder, file, coords)
  local t = holder:CreateTexture(nil, "OVERLAY")
  t:SetTexture(MEDIA .. file)
  t:SetTexCoord(unpack(coords))
  t:SetVertexColor(COLORS.red[1], COLORS.red[2], COLORS.red[3], 0.95)
  t:SetBlendMode("ADD")
  return t
end
local function glow(f, level)
  local holder = CreateFrame("Frame", nil, f)
  holder:SetAllPoints() -- the border sits exactly on the window edges
  holder:SetFrameLevel(level)
  local G = GLOW_SIZE
  -- Corners: the texture's outer corner is its top-left; mirror it for the other three.
  for point, coords in pairs({
    TOPLEFT = { 0, 1, 0, 1 }, TOPRIGHT = { 1, 0, 0, 1 }, BOTTOMLEFT = { 0, 1, 1, 0 }, BOTTOMRIGHT = { 1, 0, 1, 0 },
  }) do
    local c = glowPiece(holder, "glow-corner", coords)
    c:SetSize(G, G)
    c:SetPoint(point)
  end
  local left = glowPiece(holder, "glow-edge-v", { 0, 1, 0, 1 })
  left:SetPoint("TOPLEFT", 0, -G)
  left:SetPoint("BOTTOMLEFT", 0, G)
  left:SetWidth(G)
  local right = glowPiece(holder, "glow-edge-v", { 1, 0, 0, 1 })
  right:SetPoint("TOPRIGHT", 0, -G)
  right:SetPoint("BOTTOMRIGHT", 0, G)
  right:SetWidth(G)
  local top = glowPiece(holder, "glow-edge-h", { 0, 1, 0, 1 })
  top:SetPoint("TOPLEFT", G, 0)
  top:SetPoint("TOPRIGHT", -G, 0)
  top:SetHeight(G)
  local bottom = glowPiece(holder, "glow-edge-h", { 0, 1, 1, 0 })
  bottom:SetPoint("BOTTOMLEFT", G, 0)
  bottom:SetPoint("BOTTOMRIGHT", -G, 0)
  bottom:SetHeight(G)

  local pulse = holder:CreateAnimationGroup()
  pulse:SetLooping("BOUNCE")
  local a = pulse:CreateAnimation("Alpha")
  a:SetFromAlpha(1)
  a:SetToAlpha(0.45)
  a:SetDuration(1.4)
  a:SetSmoothing("IN_OUT")
  -- New frames start out shown, so OnShow never fires for the first open: start now too.
  pulse:Play()
  f:HookScript("OnShow", function() pulse:Play() end)
  f:HookScript("OnHide", function() pulse:Stop() end)
  return holder
end

-- The classic grey, nicked metal dialog border. It's symmetric and sits exactly on the
-- window's edges, so the background and glow line up with it without any measuring.
local BORDER = "Interface\\DialogFrame\\UI-DialogBox-Border"
local BORDER_INSET = 9 -- px from the window edge to the inside of the metal

local function metalBorder(f)
  local border = CreateFrame("Frame", nil, f, "BackdropTemplate")
  border:SetAllPoints()
  border:SetFrameLevel(f:GetFrameLevel() + 3)
  border:SetBackdrop({ edgeFile = BORDER, edgeSize = 32 })
end

-- Returns a movable window; put things in f.content.
function ns.CreateWindow(name, width, height, title)
  local f = CreateFrame("Frame", name, UIParent)
  f:SetSize(width, height)
  f:SetPoint("CENTER", 0, 120)
  f:SetFrameStrata("DIALOG")
  f:SetToplevel(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:SetClampedToScreen(true)
  tinsert(UISpecialFrames, name) -- Escape closes it

  -- Background stays inside the metal so nothing spills past its corners.
  local bg = image(f, "BACKGROUND", WINDOW_BG)
  bg:SetPoint("TOPLEFT", BORDER_INSET, -BORDER_INSET)
  bg:SetPoint("BOTTOMRIGHT", -BORDER_INSET, BORDER_INSET)
  metalBorder(f)
  glow(f, f:GetFrameLevel() + 5) -- over the metal, growing inward from its outer edge

  -- Title bar: tall enough that the metal never cuts through the title. Only the bar drags.
  local bar = CreateFrame("Frame", nil, f)
  bar:SetPoint("TOPLEFT", BORDER_INSET + 2, -BORDER_INSET - 1)
  bar:SetPoint("TOPRIGHT", -BORDER_INSET - 2, -BORDER_INSET - 1)
  bar:SetHeight(38)
  bar:SetFrameLevel(f:GetFrameLevel() + 4)
  bar:EnableMouse(true)
  bar:RegisterForDrag("LeftButton")
  bar:SetScript("OnDragStart", function() f:StartMoving() end)
  bar:SetScript("OnDragStop", function() f:StopMovingOrSizing() end)

  local header = rect(bar, "BACKGROUND", COLORS.header)
  header:SetAllPoints()
  local rule = rect(bar, "BORDER", COLORS.goldEdge)
  rule:SetHeight(1)
  rule:SetPoint("BOTTOMLEFT")
  rule:SetPoint("BOTTOMRIGHT")

  local icon = bar:CreateTexture(nil, "ARTWORK")
  icon:SetSize(30, 30)
  icon:SetPoint("LEFT", 6, 0)
  icon:SetTexture(ICON)
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)

  local t = bar:CreateFontString(nil, "ARTWORK", "GameFontNormalHuge")
  local font = t:GetFont()
  t:SetFont(font, 20, "")
  t:SetPoint("LEFT", icon, "RIGHT", 10, 0)
  t:SetText(title)
  t:SetTextColor(COLORS.gold[1], COLORS.gold[2], COLORS.gold[3])
  t:SetShadowOffset(1, -1)

  local close = CreateFrame("Button", nil, bar, "UIPanelCloseButton")
  close:SetSize(30, 30)
  close:SetPoint("RIGHT", -2, 0)
  close:SetFrameLevel(bar:GetFrameLevel() + 2)
  close:SetScript("OnClick", function() f:Hide() end)

  -- Inset panel with a fine gold edge, like the Dungeon Journal's.
  local content = CreateFrame("Frame", nil, f)
  content:SetPoint("TOPLEFT", BORDER_INSET + 6, -BORDER_INSET - 46)
  content:SetPoint("BOTTOMRIGHT", -BORDER_INSET - 6, BORDER_INSET + 6)
  image(content, "BACKGROUND", PANEL_BG):SetAllPoints()
  edge(content, "BORDER", COLORS.goldEdge, 0)

  f.content = content
  return f
end

-- Text roles: "heading" (big gold), "section" (gold, with a red marker), "body", "muted".
function ns.Text(parent, role, size)
  local template = role == "heading" and "GameFontNormalHuge" or "GameFontHighlight"
  local fs = parent:CreateFontString(nil, "ARTWORK", template)
  if size then
    local font, _, flags = fs:GetFont()
    fs:SetFont(font, size, flags)
  end
  local c = (role == "heading" or role == "section") and COLORS.gold or role == "muted" and COLORS.muted or COLORS.body
  fs:SetTextColor(c[1], c[2], c[3])
  fs:SetJustifyH("LEFT")
  if role == "section" then
    local marker = rect(parent, "ARTWORK", COLORS.red)
    marker:SetSize(5, 5)
    marker:SetPoint("RIGHT", fs, "LEFT", -6, 0)
  end
  return fs
end
