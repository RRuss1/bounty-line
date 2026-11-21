-- Startup, SavedVariables and slash commands.
local addonName, ns = ...
local L = ns.L

local DB_DEFAULTS = {
  version = 1,
  lastSeen = {},
  settings = { debugMenu = false, debugKills = false, banners = true, minimap = { angle = 200, hide = false } },
}
local CHAR_DEFAULTS = { version = 1, kills = {} }

local function applyDefaults(t, defaults)
  for k, v in pairs(defaults) do
    if t[k] == nil then
      t[k] = type(v) == "table" and applyDefaults({}, v) or v
    elseif type(v) == "table" and type(t[k]) == "table" then
      applyDefaults(t[k], v)
    end
  end
  return t
end

function ns.Print(msg)
  DEFAULT_CHAT_FRAME:AddMessage(L.PREFIX .. tostring(msg))
end

-- ---------------------------------------------------------------- posting

-- Shows the B code for a snapshot and reward (spec 5.4).
-- existingId: add the gold to that open bounty instead of starting a new one.
function ns.PostBounty(snap, reward, note, existingId)
  local code, err, message = ns.BuildBountyCode(snap, reward, note, existingId)
  if not code then return ns.Print(L.CODE_FAILED:format(message or err)) end
  if not existingId then ns.Comms.NewBounty(snap.name, reward, ns.FullName("player")) end -- guildies see a "pending" banner
  ns.ShowCode({
    title = existingId and L.STACK_READY or L.BOUNTY_READY,
    subtitle = ("%s · %s"):format(ns.Describe(snap), ns.FormatGold(reward)),
    instructions = L.POST_THIS,
    code = code,
    line = { existingId and "A" or "B", snap.name, ns.FormatGold(reward) },
  })
end

-- /bl mark [gold] [note]
local function mark(rest)
  local snap, why = ns.SnapshotUnit("target")
  if not snap then return ns.Print(L[why]) end
  local amount, note = rest:match("^(%S+)%s*(.*)$")
  if amount then
    local min, max = ns.RewardLimits()
    local reward = ns.ParseReward(amount, min, max)
    if reward then return ns.PostBounty(snap, reward, note) end
  end
  ns.OpenAmountEntry(snap, amount, note)
end

local function link()
  local code, err, message = ns.BuildLinkCode()
  if not code then return ns.Print(err == "NEUTRAL" and message or L.CODE_FAILED:format(message or err)) end
  local name = ns.FullName("player")
  ns.ShowCode({ title = L.LINK_READY, subtitle = name, instructions = L.POST_LINK, code = code, line = { "L", name } })
end

local COMMANDS = {
  help = function() for _, line in ipairs(L.HELP) do DEFAULT_CHAT_FRAME:AddMessage(line) end end,
  mark = mark,
  last = function()
    local last = BountyLineCharDB.lastPopup
    if not last then return ns.Print(L.NO_LAST) end
    ns.ShowCode(last)
  end,
  link = link,
  import = function() ns.OpenImport() end,
  list = function()
    local list = ns.ListBounties()
    if #list == 0 then return ns.Print(BountyLineDB.pack and L.LIST_EMPTY or L.NO_PACK) end
    ns.Print(L.LIST_HEADER:format(#list, ns.BoardName()))
    for _, b in ipairs(list) do
      DEFAULT_CHAT_FRAME:AddMessage(L.LIST_LINE:format(b.id, b.name, ns.FormatGold(b.reward), b.poster, date("%b %d", b.expires)))
    end
  end,
  test = function() ns.PracticeKill() end,
  sync = function()
    ns.Comms.Hello()
    ns.Comms.SharePack()
    ns.Print(L.SYNC_SENT)
  end,
  banners = function()
    local s = BountyLineDB.settings
    s.banners = not s.banners
    ns.Print(s.banners and L.BANNERS_ON or L.BANNERS_OFF)
  end,
  debugkills = function()
    local s = BountyLineDB.settings
    s.debugKills = not s.debugKills
    ns.Print(s.debugKills and L.DEBUGKILLS_ON or L.DEBUGKILLS_OFF)
  end,
  debug = function() ns.Debug() end,
  minimap = function() ns.ToggleMinimap() end,
  debugmenu = function()
    local s = BountyLineDB.settings
    s.debugMenu = not s.debugMenu
    ns.Print(s.debugMenu and L.DEBUGMENU_ON or L.DEBUGMENU_OFF)
  end,
}

SLASH_BOUNTYLINE1 = "/bl"
SLASH_BOUNTYLINE2 = "/bountyline"
function ns.RunCommand(input)
  local cmd, rest = (input or ""):match("^%s*(%S*)%s*(.-)%s*$")
  cmd = cmd:lower()
  if cmd == "" then return ns.OpenBoard() end
  local fn = COMMANDS[cmd]
  if not fn then return ns.Print(L.UNKNOWN_COMMAND:format(cmd)) end
  fn(rest)
end
SlashCmdList.BOUNTYLINE = ns.RunCommand

-- ---------------------------------------------------------------- startup

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(self, event, name)
  if event == "ADDON_LOADED" and name == addonName then
    BountyLineDB = applyDefaults(BountyLineDB or {}, DB_DEFAULTS)
    BountyLineCharDB = applyDefaults(BountyLineCharDB or {}, CHAR_DEFAULTS)
    ns.SetupMenus()
    ns.SetupMinimap()
    if ns.PackOutdated() then ns.Print(L.OUTDATED) end
    self:UnregisterEvent("ADDON_LOADED")
  end
end)
