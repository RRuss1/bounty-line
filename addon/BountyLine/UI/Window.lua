-- Shared window look: Blizzard's metal frame border around a dark stone panel, a gold title
-- bar, an inset marble content panel with a fine gold edge (Dungeon Journal style), all inside
-- a thick, slowly pulsing blood-red glow. Client art is used where it exists; if the metal
-- frame layout is missing on Forever it falls back to the classic dialog border (spec 23).
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
local function edge(parent, layer, color, out, sublevel)
  for _, side in ipairs({ "TOP", "BOTTOM", "LEFT", "RIGHT" }) do
    local t = rect(parent, layer, color, sublevel)
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
end

-- The red glow: ten fading 1px rings just outside the metal border, pulsing slowly.
-- Anchored to the window itself (the metal's corner pieces carry invisible padding, which
-- pushed the glow off-centre), starting GLOW_OUTSET px out so it hugs the visible metal.
local GLOW = { 0.95, 0.85, 0.7, 0.55, 0.42, 0.31, 0.22, 0.14, 0.08, 0.04 }
local GLOW_OUTSET = 1
local function glow(f)
  local holder = CreateFrame("Frame", nil, f)
  holder:SetPoint("TOPLEFT", -GLOW_OUTSET, GLOW_OUTSET)
  holder:SetPoint("BOTTOMRIGHT", GLOW_OUTSET, -GLOW_OUTSET)
  holder:SetFrameLevel(math.max(0, f:GetFrameLevel() - 1))
  local r, g, b = COLORS.red[1], COLORS.red[2], COLORS.red[3]
  for i, alpha in ipairs(GLOW) do edge(holder, "BACKGROUND", { r, g, b, alpha }, i) end

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
end

-- Blizzard's metal frame (the one around the Dungeon Journal and most panels).
-- Returns the regions marking its outer corners, for the glow.
local function metalBorder(f)
  local slice
  local ok = pcall(function()
    slice = CreateFrame("Frame", nil, f, "NineSlicePanelTemplate")
    slice:SetAllPoints()
    slice:SetFrameLevel(f:GetFrameLevel() + 3)
    NineSliceUtil.ApplyLayoutByName(slice, "ButtonFrameTemplateNoPortrait")
  end)
  if ok and slice.TopLeftCorner and slice.BottomRightCorner then
    return { topLeft = slice.TopLeftCorner, bottomRight = slice.BottomRightCorner }
  end
  if slice then slice:Hide() end
  local border = CreateFrame("Frame", nil, f, "BackdropTemplate")
  border:SetPoint("TOPLEFT", -4, 4)
  border:SetPoint("BOTTOMRIGHT", 4, -4)
  border:SetFrameLevel(f:GetFrameLevel() + 3)
  border:SetBackdrop({ edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", edgeSize = 24 })
  return { topLeft = border, bottomRight = border }
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

  image(f, "BACKGROUND", WINDOW_BG):SetAllPoints()
  metalBorder(f)
  glow(f)

  -- Only the title bar drags the window, so clicks in the content never move it.
  local bar = CreateFrame("Frame", nil, f)
  bar:SetPoint("TOPLEFT", 4, -2)
  bar:SetPoint("TOPRIGHT", -4, -2)
  bar:SetHeight(32)
  bar:SetFrameLevel(f:GetFrameLevel() + 4)
  bar:EnableMouse(true)
  bar:RegisterForDrag("LeftButton")
  bar:SetScript("OnDragStart", function() f:StartMoving() end)
  bar:SetScript("OnDragStop", function() f:StopMovingOrSizing() end)

  local header = rect(f, "BORDER", COLORS.header)
  header:SetPoint("TOPLEFT", 4, -4)
  header:SetPoint("TOPRIGHT", -4, -4)
  header:SetHeight(28)

  local icon = bar:CreateTexture(nil, "ARTWORK")
  icon:SetSize(20, 20)
  icon:SetPoint("LEFT", 8, -1)
  icon:SetTexture(ICON)
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)

  local t = bar:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  t:SetPoint("LEFT", icon, "RIGHT", 8, 0)
  t:SetText(title)
  t:SetTextColor(COLORS.gold[1], COLORS.gold[2], COLORS.gold[3])

  local close = CreateFrame("Button", nil, bar, "UIPanelCloseButton")
  close:SetSize(26, 26)
  close:SetPoint("RIGHT", -2, -1)
  close:SetFrameLevel(bar:GetFrameLevel() + 2)
  close:SetScript("OnClick", function() f:Hide() end)

  -- Inset panel with a fine gold edge, like the Dungeon Journal's.
  local content = CreateFrame("Frame", nil, f)
  content:SetPoint("TOPLEFT", 14, -44)
  content:SetPoint("BOTTOMRIGHT", -14, 14)
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
