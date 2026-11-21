-- Minimap button: drag it around the minimap's edge; position and visibility are saved.
-- Left-click: last code (or help). Right-click: set a bounty on your target.
-- Also registers with the minimap's addon compartment menu (TOC AddonCompartmentFunc).
-- Self-contained instead of LibDBIcon, to keep the addon free of extra libraries.
local _, ns = ...
local L = ns.L

local ICON = "Interface\\Icons\\INV_Misc_Bone_HumanSkull_01"
local button

local function settings() return BountyLineDB.settings.minimap end

local function place()
  local a = math.rad(settings().angle)
  local r = Minimap:GetWidth() / 2 + 10
  button:ClearAllPoints()
  button:SetPoint("CENTER", Minimap, "CENTER", math.cos(a) * r, math.sin(a) * r)
end

local function onDragUpdate()
  local mx, my = Minimap:GetCenter()
  local px, py = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  settings().angle = math.deg(math.atan2(py / scale - my, px / scale - mx))
  place()
end

function ns.MinimapClick(mouse)
  if mouse == "RightButton" then
    local snap, why = ns.SnapshotUnit("target")
    if not snap then return ns.Print(L[why]) end
    return ns.OpenAmountEntry(snap)
  end
  local last = BountyLineCharDB.lastPopup
  if last then return ns.ShowCode(last) end
  ns.RunCommand("help")
end

function ns.MinimapTooltip(tooltip)
  tooltip:SetText(L.ADDON, 1, 0.82, 0.25)
  for _, line in ipairs(L.MINIMAP_TIP) do tooltip:AddLine(line, 0.93, 0.91, 0.86) end
  tooltip:Show()
end

local function build()
  local b = CreateFrame("Button", "BountyLineMinimapButton", Minimap)
  b:SetSize(31, 31)
  b:SetFrameStrata("MEDIUM")
  b:SetFrameLevel(8)
  b:RegisterForClicks("AnyUp")
  b:RegisterForDrag("LeftButton")
  b:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

  local bg = b:CreateTexture(nil, "BACKGROUND")
  bg:SetSize(24, 24)
  bg:SetPoint("TOPLEFT", 2, -4)
  bg:SetTexture("Interface\\Minimap\\UI-Minimap-Background")

  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(18, 18)
  icon:SetPoint("TOPLEFT", 7, -6)
  icon:SetTexture(ICON)
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)

  local border = b:CreateTexture(nil, "OVERLAY")
  border:SetSize(50, 50)
  border:SetPoint("TOPLEFT")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")

  b:SetScript("OnClick", function(_, mouse) ns.MinimapClick(mouse) end)
  b:SetScript("OnDragStart", function(self)
    GameTooltip:Hide()
    self:SetScript("OnUpdate", onDragUpdate)
  end)
  b:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    ns.MinimapTooltip(GameTooltip)
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

function ns.SetupMinimap()
  if not Minimap then return end
  button = button or build()
  place()
  button:SetShown(not settings().hide)
end

function ns.ToggleMinimap()
  settings().hide = not settings().hide
  ns.SetupMinimap()
  ns.Print(settings().hide and L.MINIMAP_HIDDEN or L.MINIMAP_SHOWN)
end

-- Addon compartment (the minimap's addon menu), named in the TOC.
function BountyLine_OnAddonCompartmentClick(_, mouse) ns.MinimapClick(mouse) end
function BountyLine_OnAddonCompartmentEnter(_, menuButton)
  GameTooltip:SetOwner(menuButton, "ANCHOR_LEFT")
  ns.MinimapTooltip(GameTooltip)
end
function BountyLine_OnAddonCompartmentLeave() GameTooltip:Hide() end
