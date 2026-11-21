-- Minimap button: the menu for everything, so nobody has to remember slash commands.
--   Left-click   opens the Bounty Board (which has the Settings button)
--   Right-click  a dropdown with every command
--   Drag         moves it around the minimap's edge (position and visibility are saved)
-- The same clicks work on the entry in the minimap's addon compartment menu (TOC
-- AddonCompartmentFunc). Self-contained instead of LibDBIcon, to avoid extra libraries.
local _, ns = ...
local L = ns.L

local ICON = "Interface\\AddOns\\BountyLine\\Media\\logo" -- the Bounty Line logo
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

-- "Open Bounty Board   /bl": each entry shows the command that does the same thing, in grey.
local function entry(text, command)
  return ("%s   |cff8a8a8a/bl%s|r"):format(text, command ~= "" and (" " .. command) or "")
end

-- The right-click menu: every player command, with the reason shown when one can't be used.
function ns.OpenMainMenu(owner)
  if not (MenuUtil and MenuUtil.CreateContextMenu) then return ns.RunCommand("help") end
  MenuUtil.CreateContextMenu(owner, function(_, root)
    local function disabled(item, reason)
      item:SetEnabled(false)
      item:SetTooltip(function(tip) GameTooltip_SetTitle(tip, reason) end)
    end
    root:CreateTitle(L.ADDON)
    root:CreateButton(entry(L.M_BOARD, ""), function() ns.OpenBoard(nil, "wanted") end)

    local snap, why = ns.SnapshotUnit("target")
    local set = root:CreateButton(entry(L.M_SET, "mark"), function() if snap then ns.OpenAmountEntry(snap) end end)
    if not snap then disabled(set, L[why]) end

    root:CreateButton(entry(L.M_IMPORT, "import"), function() ns.OpenImport() end)
    local share = root:CreateButton(entry(L.M_SHARE, "sync"), function() ns.RunCommand("sync") end)
    if not BountyLineDB.pack then disabled(share, L.NO_PACK) end

    root:CreateDivider()
    local last = BountyLineCharDB.lastPopup
    local lastItem = root:CreateButton(entry(L.M_LAST, "last"), function() if last then ns.ShowCode(last) end end)
    if not last then disabled(lastItem, L.NO_LAST) end
    root:CreateButton(L.M_KILLS, function() ns.OpenBoard(nil, "kills") end)
    root:CreateButton(L.M_MINE, function() ns.OpenBoard(nil, "mine") end)
    root:CreateButton(entry(L.M_LINK, "link"), function() ns.RunCommand("link") end)
    root:CreateButton(entry(L.M_TEST, "test"), function() ns.RunCommand("test") end)

    root:CreateDivider()
    local s = BountyLineDB.settings
    root:CreateCheckbox(entry(L.M_BANNERS, "banners"), function() return s.banners end, function() s.banners = not s.banners end)
    root:CreateButton(entry(L.M_OPTIONS, "options"), function() ns.OpenOptions() end)
    root:CreateButton(entry(L.M_VERSION, "version"), function() ns.RunCommand("version") end)
    root:CreateButton(entry(L.M_HELP, "help"), function() ns.RunCommand("help") end)
    root:CreateButton(entry(L.M_HIDE, "minimap"), function() ns.ToggleMinimap() end)
    local debug = root:CreateButton(L.M_DEBUG)
    debug:CreateButton(entry(L.M_DEBUG_INFO, "debug"), function() ns.Debug() end)
    debug:CreateButton(entry(L.M_DEBUG_SOUNDS, "debug sounds"), function() ns.DebugSounds() end)
    debug:CreateCheckbox(entry(L.OPT_DEBUG_MENU, "debugmenu"), function() return s.debugMenu end,
      function() s.debugMenu = not s.debugMenu end)
    debug:CreateCheckbox(entry(L.OPT_DEBUG_KILLS, "debugkills"), function() return s.debugKills end,
      function() s.debugKills = not s.debugKills end)
  end)
end

function ns.MinimapClick(mouse, owner)
  if mouse == "RightButton" then return ns.OpenMainMenu(owner or button or UIParent) end
  ns.OpenBoard()
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

  local border = b:CreateTexture(nil, "OVERLAY")
  border:SetSize(50, 50)
  border:SetPoint("TOPLEFT")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")

  b:SetScript("OnClick", function(self, mouse)
    GameTooltip:Hide()
    ns.MinimapClick(mouse, self)
  end)
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
function BountyLine_OnAddonCompartmentClick(_, mouse, menuButton) ns.MinimapClick(mouse, menuButton) end
function BountyLine_OnAddonCompartmentEnter(_, menuButton)
  GameTooltip:SetOwner(menuButton, "ANCHOR_LEFT")
  ns.MinimapTooltip(GameTooltip)
end
function BountyLine_OnAddonCompartmentLeave() GameTooltip:Hide() end
