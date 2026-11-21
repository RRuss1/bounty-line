-- Shared window look: Blizzard's portrait frame (round skull portrait, metal border, title
-- bar, close button) with a parchment panel, like the quest log. Falls back to a plain
-- dialog box if a template or texture is missing on the client (spec Section 23, item 15).
local _, ns = ...

local ICON = "Interface\\Icons\\INV_Misc_Bone_HumanSkull_01"
local INK = { 0.13, 0.11, 0.09 } -- charcoal, readable on parchment

local function hasAtlas(name)
  return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) ~= nil
end

local function plainDialog(f)
  Mixin(f, BackdropTemplateMixin)
  f:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Gold-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
end

-- Returns a movable window whose content area is f.content (parchment).
function ns.CreateWindow(name, width, height, title)
  local ok, f = pcall(CreateFrame, "Frame", name, UIParent, "PortraitFrameTemplate")
  local portrait = ok
  if not ok then f = CreateFrame("Frame", name, UIParent, "BackdropTemplate") end
  f:SetSize(width, height)
  f:SetPoint("CENTER", 0, 120)
  f:SetFrameStrata("DIALOG")
  f:SetToplevel(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:SetClampedToScreen(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  tinsert(UISpecialFrames, name) -- Escape closes it

  local content = CreateFrame("Frame", nil, f)
  if portrait then
    if f.SetTitle then f:SetTitle(title) end
    if f.SetPortraitToAsset then f:SetPortraitToAsset(ICON) end
    content:SetPoint("TOPLEFT", 6, -26)
    content:SetPoint("BOTTOMRIGHT", -6, 6)
  else
    plainDialog(f)
    local t = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    t:SetPoint("TOP", 0, -18)
    t:SetText(title)
    content:SetPoint("TOPLEFT", 14, -40)
    content:SetPoint("BOTTOMRIGHT", -14, 14)
  end

  local paper = content:CreateTexture(nil, "BACKGROUND")
  paper:SetAllPoints()
  if hasAtlas("QuestBG-Parchment") then
    paper:SetAtlas("QuestBG-Parchment")
  else
    paper:SetTexture("Interface\\QuestFrame\\QuestBG")
    paper:SetTexCoord(0, 0.586, 0, 0.65)
  end

  f.content = content
  return f
end

-- Dark text on the parchment.
function ns.Text(parent, template, size)
  local fs = parent:CreateFontString(nil, "ARTWORK", template or "GameFontHighlight")
  if size then
    local font, _, flags = fs:GetFont()
    fs:SetFont(font, size, flags)
  end
  fs:SetTextColor(INK[1], INK[2], INK[3])
  fs:SetShadowColor(1, 0.95, 0.8, 0.25)
  fs:SetJustifyH("LEFT")
  return fs
end
