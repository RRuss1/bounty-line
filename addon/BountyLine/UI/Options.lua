-- Settings window (/bl options, the board's Settings button, the minimap menu). Built with the
-- addon's own window so it looks the same and doesn't depend on the client's Settings UI; a
-- small entry is also registered there (Esc > Options > AddOns) that opens this window.
-- Everything is stored in BountyLineDB.settings and takes effect at once.
local _, ns = ...
local L = ns.L

local frame
local controls = {}

local function S() return BountyLineDB.settings end

local function apply()
  ns.RefreshMarks()
  ns.SetupMinimap()
  if ns.RefreshBoard then ns.RefreshBoard() end
end

-- { kind, key, label, ... }. "check": on/off. "cycle": click to step through values.
-- get/set override the plain settings[key] read and write.
local LEFT = {
  { "head", L.OPT_ALERTS },
  { "check", "banners", L.OPT_BANNERS },
  { "check", "sightAlert", L.OPT_SIGHT },
  { "cycle", "realertMinutes", L.OPT_REALERT, { 5, 10, 20, 30, 60 }, function(v) return L.OPT_MINUTES:format(v) end },
  { "check", "sounds", L.OPT_SOUNDS },
  { "head", L.OPT_HUNTING },
  { "check", "skull", L.OPT_SKULL },
  { "cycle", "skullSize", L.OPT_SKULL_SIZE, { 20, 26, 34, 44 }, function(v) return L.OPT_PIXELS:format(v) end },
  { "check", "tooltip", L.OPT_TOOLTIP },
  { "check", "targetBadge", L.OPT_BADGE },
}
local RIGHT = {
  { "head", L.OPT_KILLS },
  { "check", "killPopupInCombat", L.OPT_KILL_POPUP },
  { "cycle", "stampSeconds", L.OPT_STAMP, { 0, 1, 2, 3 }, function(v) return v == 0 and L.OPT_STAMP_OFF or L.OPT_SECONDS:format(v) end },
  { "head", L.OPT_SYNC },
  { "cycle", "packsFrom", L.OPT_PACKS_FROM, { "anyone", "officers" },
    function(v) return v == "officers" and L.OPT_OFFICERS or L.OPT_ANYONE end },
  { "check", "shareSeen", L.OPT_SHARE_SEEN },
  { "head", L.OPT_OTHER },
  { "check", "minimapShown", L.OPT_MINIMAP,
    get = function() return not S().minimap.hide end, set = function(v) S().minimap.hide = not v end },
  { "check", "debugMenu", L.OPT_DEBUG_MENU },
  { "check", "debugKills", L.OPT_DEBUG_KILLS },
}

local function makeCheck(parent, row, x, y)
  local key = row[2]
  local get = row.get or function() return S()[key] ~= false and S()[key] ~= nil end
  local set = row.set or function(v) S()[key] = v end
  local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
  box:SetSize(24, 24)
  box:SetPoint("TOPLEFT", x, y)
  local label = ns.Text(parent, "body", 13)
  label:SetPoint("LEFT", box, "RIGHT", 4, 0)
  label:SetText(row[3])
  box:SetScript("OnClick", function(self)
    set(self:GetChecked() and true or false)
    apply()
  end)
  controls[#controls + 1] = function() box:SetChecked(get()) end
end

local function makeCycle(parent, row, x, y)
  local key, values, show = row[2], row[4], row[5]
  local label = ns.Text(parent, "body", 13)
  label:SetPoint("TOPLEFT", x + 4, y - 5)
  label:SetText(row[3])
  local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  button:SetSize(110, 22)
  button:SetPoint("TOPLEFT", x + 200, y - 1)
  local function refresh() button:SetText(show(S()[key])) end
  button:SetScript("OnClick", function()
    local at = 1
    for i, v in ipairs(values) do if v == S()[key] then at = i end end
    S()[key] = values[at % #values + 1]
    refresh()
    apply()
  end)
  controls[#controls + 1] = refresh
end

local function column(parent, rows, x)
  local y = -12
  for _, row in ipairs(rows) do
    if row[1] == "head" then
      y = y - 6
      local head = ns.Text(parent, "section", 14)
      head:SetPoint("TOPLEFT", x + 12, y - 4)
      head:SetText(row[2])
    elseif row[1] == "check" then
      makeCheck(parent, row, x, y)
    else
      makeCycle(parent, row, x, y)
    end
    y = y - 27
  end
end

local function build()
  local f = ns.CreateWindow("BountyLineOptions", 760, 440, L.OPT_TITLE)
  local c = f.content
  column(c, LEFT, 10)
  column(c, RIGHT, 350)

  local function button(text, x, onClick)
    local b = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
    b:SetSize(150, 24)
    b:SetPoint("BOTTOMLEFT", x, 12)
    b:SetText(text)
    b:SetScript("OnClick", onClick)
  end
  button(L.OPT_RESET_WINDOWS, 16, function() ns.ResetWindows() end)
  button(L.OPT_DEBUG_INFO, 176, function() ns.Debug() end)
  button(L.CLOSE, 336, function() f:Hide() end)
  return f
end

function ns.OpenOptions()
  frame = frame or build()
  for _, refresh in ipairs(controls) do refresh() end
  frame:Show()
end

-- An entry in the game's own options list that opens the window above.
function ns.RegisterOptions()
  if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then return end
  local panel = CreateFrame("Frame")
  local title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText(L.ADDON)
  local open = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  open:SetSize(220, 26)
  open:SetPoint("TOPLEFT", 16, -52)
  open:SetText(L.OPT_OPEN)
  open:SetScript("OnClick", function() ns.OpenOptions() end)
  Settings.RegisterAddOnCategory(Settings.RegisterCanvasLayoutCategory(panel, L.ADDON))
end
