-- Shared window look: a dark Dungeon-Journal-style panel (gold title, inset content with a
-- fine gold edge) inside a tight, slowly pulsing blood-red glow. Drawn from flat colours, so
-- it doesn't depend on any client art that might be missing on Forever.
local _, ns = ...

local WHITE = "Interface\\Buttons\\WHITE8x8"
local ICON = "Interface\\Icons\\INV_Misc_Bone_HumanSkull_01"

local COLORS = {
  bg = { 0.055, 0.045, 0.04, 0.97 },      -- near-black, warm
  header = { 0.09, 0.07, 0.06, 1 },
  inset = { 0.10, 0.085, 0.075, 0.95 },
  gold = { 1, 0.82, 0.25 },
  goldEdge = { 0.55, 0.42, 0.2, 0.7 },
  red = { 0.85, 0.08, 0.06 },
  body = { 0.93, 0.91, 0.86 },
  muted = { 0.62, 0.6, 0.56 },
  error = { 1, 0.35, 0.3 },
}
ns.COLORS = COLORS

local function rect(parent, layer, color, sublevel)
  local t = parent:CreateTexture(nil, layer, nil, sublevel or 0)
  t:SetTexture(WHITE)
  t:SetVertexColor(color[1], color[2], color[3], color[4] or 1)
  return t
end

-- 1px edge drawn as four lines, `out` pixels outside the frame.
local function edge(parent, layer, color, out, sublevel)
  local lines = {}
  for i, side in ipairs({ "TOP", "BOTTOM", "LEFT", "RIGHT" }) do
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
    lines[i] = t
  end
  return lines
end

-- The red glow: a crisp 1px line plus three fading rings close to the frame.
local function glow(f)
  local holder = CreateFrame("Frame", nil, f)
  holder:SetAllPoints()
  holder:SetFrameLevel(math.max(0, f:GetFrameLevel() - 1))
  local r, g, b = COLORS.red[1], COLORS.red[2], COLORS.red[3]
  edge(f, "OVERLAY", { r, g, b, 1 }, 0) -- the crisp line sits on the window itself
  for i, alpha in ipairs({ 0.55, 0.28, 0.12 }) do edge(holder, "BACKGROUND", { r, g, b, alpha }, i, 7 - i) end

  local pulse = holder:CreateAnimationGroup()
  pulse:SetLooping("BOUNCE")
  local a = pulse:CreateAnimation("Alpha")
  a:SetFromAlpha(1)
  a:SetToAlpha(0.55)
  a:SetDuration(1.6)
  a:SetSmoothing("IN_OUT")
  f:HookScript("OnShow", function() pulse:Play() end)
  f:HookScript("OnHide", function() pulse:Stop() end)
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

  -- Only the title bar drags the window, so clicks in the content never move it.
  local bar = CreateFrame("Frame", nil, f)
  bar:SetPoint("TOPLEFT")
  bar:SetPoint("TOPRIGHT")
  bar:SetHeight(31)
  bar:EnableMouse(true)
  bar:RegisterForDrag("LeftButton")
  bar:SetScript("OnDragStart", function() f:StartMoving() end)
  bar:SetScript("OnDragStop", function() f:StopMovingOrSizing() end)

  rect(f, "BACKGROUND", COLORS.bg):SetAllPoints()
  glow(f)

  -- Title bar: skull icon, gold title, close button.
  local header = rect(f, "BORDER", COLORS.header)
  header:SetPoint("TOPLEFT", 1, -1)
  header:SetPoint("TOPRIGHT", -1, -1)
  header:SetHeight(30)
  local rule = rect(f, "ARTWORK", COLORS.goldEdge)
  rule:SetHeight(1)
  rule:SetPoint("TOPLEFT", header, "BOTTOMLEFT")
  rule:SetPoint("TOPRIGHT", header, "BOTTOMRIGHT")

  local icon = f:CreateTexture(nil, "ARTWORK")
  icon:SetSize(20, 20)
  icon:SetPoint("LEFT", header, "LEFT", 8, 0)
  icon:SetTexture(ICON)
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)

  local t = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  t:SetPoint("LEFT", icon, "RIGHT", 8, 0)
  t:SetText(title)
  t:SetTextColor(COLORS.gold[1], COLORS.gold[2], COLORS.gold[3])

  local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  close:SetSize(26, 26)
  close:SetPoint("RIGHT", header, "RIGHT", -2, 0)
  close:SetFrameLevel(bar:GetFrameLevel() + 2) -- above the drag bar
  close:SetScript("OnClick", function() f:Hide() end)

  -- Inset content panel with a fine gold edge, like the Dungeon Journal's.
  local content = CreateFrame("Frame", nil, f)
  content:SetPoint("TOPLEFT", 10, -41)
  content:SetPoint("BOTTOMRIGHT", -10, 10)
  rect(content, "BACKGROUND", COLORS.inset):SetAllPoints()
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
