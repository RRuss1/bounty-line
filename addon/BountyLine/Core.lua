-- Startup, SavedVariables and slash commands.
local addonName, ns = ...
local L = ns.L

local DB_DEFAULTS = {
  version = 1,
  lastSeen = {},
  claimed = {},
  settings = {
    debugMenu = false, debugKills = false, banners = true, minimap = { angle = 200, hide = false },
    relay = true, killPopupInCombat = false, realertMinutes = 10, packsFrom = "anyone", packMaxRank = 1,
    sightAlert = true, sounds = true, skull = true, skullSize = 26, tooltip = true, targetBadge = true,
    shareSeen = true, stampSeconds = 0,
  },
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

-- Addon sounds: all the game's own, played by name or file number (nothing is shipped).
--   file: a sound file in the client (a voice line); kit: a name in the game's SOUNDKIT table.
-- If the client doesn't have the file, the kit plays instead; an unknown kit falls back to the
-- raid warning. /bl debug sounds plays each one and says what was found (spec 23 item 23).
ns.SOUNDS = {
  -- A bounty is created (yours, or a guildie's banner): Mage-Lord Urom, "A_UROMKILL03".
  { "create", file = 554523, kit = "PVP_THROUGH_QUEUE" },
  { "stack", kit = "LOOT_WINDOW_COIN_SOUND" },          -- you add gold to a bounty
  { "sighting", kit = "ALARM_CLOCK_WARNING_3" },        -- a wanted player is in sight
  { "kill", kit = "UI_PVP_HONOR_PRESTIGE_RANK_UP" },    -- you collect a bounty
  { "guildKill", kit = "IG_PVP_UPDATE" },               -- a guildie collects one
  { "codeReady", kit = "IG_QUEST_LIST_COMPLETE" },      -- your waiting kill code opens after the fight
}
local soundByName = {}
for _, s in ipairs(ns.SOUNDS) do soundByName[s[1]] = s end

-- Returns what played: "file", the kit's name, or "RAID_WARNING" (the fallback); nil if off.
function ns.Sound(event, evenIfOff)
  if not evenIfOff and (BountyLineDB.settings or {}).sounds == false then return nil end
  local s = soundByName[event]
  if not s then return nil end
  if s.file and PlaySoundFile and PlaySoundFile(s.file, "Master") then return "file" end
  local kit = s.kit and SOUNDKIT[s.kit]
  if kit and PlaySound(kit) then return s.kit end
  PlaySound(SOUNDKIT.RAID_WARNING)
  return "RAID_WARNING"
end

function ns.Print(msg)
  DEFAULT_CHAT_FRAME:AddMessage(L.PREFIX .. tostring(msg))
end

-- ---------------------------------------------------------------- posting

-- Shows the B code for a snapshot and reward (spec 5.4).
-- existingId: add the gold to that open bounty instead of starting a new one.
function ns.PostBounty(snap, reward, note, existingId)
  if not ns.InOpenWorld() then return ns.Print(L.INSTANCE) end -- e.g. the window was opened outside
  local code, err, message = ns.BuildBountyCode(snap, reward, note, existingId)
  if not code then return ns.Print(L.CODE_FAILED:format(message or err)) end
  ns.Sound(existingId and "stack" or "create")
  if not existingId then
    -- Guildies get a banner and can hunt the target straight away, before any pack lists it.
    local me, now = ns.FullName("player"), GetServerTime()
    ns.Comms.NewBounty(snap.name, reward, me)
    if ns.AddPending(snap.guid, snap.name, snap.classID, snap.faction, reward, me, now) then
      ns.Comms.Pending(snap, reward, me, now)
      ns.RefreshMarks()
    end
  end
  -- Relay (spec 5.10): if this client runs the relay it carries the code itself; otherwise
  -- the code is offered to any relay officer online. The popup is shown either way.
  local relayed = ns.RelayQueue and ns.RelayQueue(code)
  if not relayed then ns.Comms.BountyCode(code) end
  ns.ShowCode({
    title = existingId and L.STACK_READY or L.BOUNTY_READY,
    subtitle = ("%s · %s"):format(ns.Describe(snap), ns.FormatGold(reward)),
    instructions = L.POST_THIS,
    note = relayed and L.RELAYED_SELF or nil,
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
    ns.Comms.Version()
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
  debug = function(rest)
    if rest == "sounds" then return ns.DebugSounds() end
    if rest == "guild" then return ns.DebugGuild() end
    ns.Debug()
  end,
  seasons = function() ns.PrintSeasons() end,
  season = function() ns.PrintSeasons() end,
  version = function()
    ns.Print(L.VERSION:format(ns.AddonVersion() or L.VERSION_DEV, ns.Codec.PREFIX))
    local newer = ns.NewerVersion()
    if newer then ns.Print(L.UPDATE_AVAILABLE:format(newer, ns.AddonVersion() or "?")) end
    local names = {}
    for name, v in pairs(ns.OlderGuildies()) do names[#names + 1] = ("%s (%s)"):format(name, v) end
    table.sort(names)
    if #names > 0 then ns.Print(L.VERSION_OLDER:format(table.concat(names, ", "))) end
    if not newer and #names == 0 then ns.Print(L.VERSION_OK) end
  end,
  minimap = function() ns.ToggleMinimap() end,
  options = function() ns.OpenOptions() end,
  menu = function() ns.OpenMainMenu(UIParent) end,
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
    pcall(ns.RegisterOptions) -- the client's Settings UI may differ on Forever; our own window always works
    if ns.PackOutdated() then ns.Print(L.OUTDATED) end
    ns.PruneGuilds() -- enemy guilds remembered for Open Season: forget the stale ones
    if not BountyLineDB.welcomed then
      -- First login with the addon: say where everything is, once.
      BountyLineDB.welcomed = true
      C_Timer.After(6, function() for _, line in ipairs(L.WELCOME) do ns.Print(line) end end)
    end
    self:UnregisterEvent("ADDON_LOADED")
  end
end)
