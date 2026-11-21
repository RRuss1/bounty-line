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

-- The red glow grows inward: ten 1px rings from the metal's outer edge toward the middle,
-- added on top of the metal (additive, so the metal shows through red-hot), pulsing slowly.
local GLOW = { 0.9, 0.75, 0.6, 0.47, 0.36, 0.27, 0.19, 0.13, 0.08, 0.04 }
local function glow(f, level)
  local holder = CreateFrame("Frame", nil, f)
  holder:SetAllPoints() -- fitted to the visible metal by fitToMetal()
  holder:SetFrameLevel(level)
  local r, g, b = COLORS.red[1], COLORS.red[2], COLORS.red[3]
  for i, alpha in ipairs(GLOW) do
    for _, t in ipairs(edge(holder, "OVERLAY", { r, g, b, alpha }, -(i - 1))) do t:SetBlendMode("ADD") end
  end

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

-- Blizzard's metal frame (the one around the Dungeon Journal and most panels). Returns the
-- NineSlice, or nil when it fell back to the classic dialog border.
local function metalBorder(f)
  local slice
  local ok = pcall(function()
    slice = CreateFrame("Frame", nil, f, "NineSlicePanelTemplate")
    slice:SetAllPoints()
    slice:SetFrameLevel(f:GetFrameLevel() + 3)
    NineSliceUtil.ApplyLayoutByName(slice, "ButtonFrameTemplateNoPortrait")
  end)
  if ok and slice.LeftEdge and slice.RightEdge and slice.TopEdge and slice.BottomEdge then return slice end
  if slice then slice:Hide() end
  local border = CreateFrame("Frame", nil, f, "BackdropTemplate")
  border:SetAllPoints()
  border:SetFrameLevel(f:GetFrameLevel() + 3)
  border:SetBackdrop({ edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", edgeSize = 24 })
  return nil
end

-- The metal layout doesn't sit flush with the frame (it's inset ~10px on the left), so the
-- background poked out past it and the glow sat off it. Once the window is on screen, fit
-- both to the metal's visible edges. `inset` pulls a region that many px inside the metal.
local function fitToMetal(f, slice, fits)
  local l, r = slice.LeftEdge:GetLeft(), slice.RightEdge:GetRight()
  local t, b = slice.TopEdge:GetTop(), slice.BottomEdge:GetBottom()
  local fl, fr, ft, fb = f:GetLeft(), f:GetRight(), f:GetTop(), f:GetBottom()
  if not (l and r and t and b and fl and fr and ft and fb) then return end
  for _, fit in ipairs(fits) do
    local region, inset = fit[1], fit[2]
    region:ClearAllPoints()
    region:SetPoint("TOPLEFT", f, "TOPLEFT", l - fl + inset, t - ft - inset)
    region:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", r - fr - inset, b - fb + inset)
  end
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

  local bg = image(f, "BACKGROUND", WINDOW_BG)
  bg:SetAllPoints()
  local slice = metalBorder(f)
  local halo = glow(f, f:GetFrameLevel() + 5) -- above the metal
  if slice then
    local fits = { { bg, 4 }, { halo, 0 } }
    local function fit() fitToMetal(f, slice, fits) end
    f:HookScript("OnShow", fit)
    C_Timer.After(0, fit) -- first open: positions exist from the next frame
  end

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
