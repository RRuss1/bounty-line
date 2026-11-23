-- Tests for the posting logic in Bounty.lua against a stubbed WoW API.
--   lua addon/tests/logic.lua      (stock Lua 5.1 or LuaJIT)
-- Exits non-zero on failure.

local here = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local root = here .. "/../.."
local ns = {}

local function loadAddon(path)
  local f = assert(loadfile(root .. "/addon/BountyLine/" .. path))
  return f("BountyLine", ns)
end

strmatch = string.match
loadAddon("Libs/LibStub/LibStub.lua")
loadAddon("Libs/LibDeflate/LibDeflate.lua")
loadAddon("Libs/qrencode/qrencode.lua")
loadAddon("Codec.lua")
loadAddon("Locales/enUS.lua")

-- ---------------------------------------------------------------- stubbed WoW API

local units
local SECRET = setmetatable({}, { __tostring = function() return "<secret>" end })

local function reset()
  units = {
    player = { guid = "Player-4395-00FFEE11", name = "Slac", surname = "Jaw", faction = "Alliance", player = true,
      class = { "Warrior", "WARRIOR", 1 }, race = { "Human", "Human", 1 }, level = 60 },
    target = { guid = "Player-4395-0A1B2C3D", name = "Grimlok", surname = "Ashveil", faction = "Horde", player = true,
      class = { "Warrior", "WARRIOR", 1 }, race = { "Orc", "Orc", 2 }, level = 42 },
  }
  BountyLineDB = { settings = {} }
end

local function u(unit) return units[unit] end
function UnitExists(unit) return u(unit) ~= nil end
function UnitGUID(unit) return u(unit) and u(unit).guid end
-- Forever: UnitName returns the first name and the surname (where retail has the realm).
function UnitName(unit) if u(unit) then return u(unit).name, u(unit).surname end end
function UnitFactionGroup(unit) return u(unit) and u(unit).faction end
function UnitIsPlayer(unit) return u(unit) and u(unit).player end
function UnitIsUnit(a, b) return u(a) == u(b) end
function UnitClass(unit) return unpack(u(unit).class) end
function UnitRace(unit) return unpack(u(unit).race) end
function UnitLevel(unit) return u(unit).level end
-- Server time is adjustable: the pack vectors are dated a day after the bounty tests.
local BASE_TIME, PACK_TIME = 1795200000, 1795300200
local serverTime = BASE_TIME
function GetServerTime() return serverTime end
function GetGuildInfo() return "Grief" end
function issecretvalue(v) return v == SECRET end
C_Map = { GetBestMapForUnit = function() return 1434 end }
-- Kills.lua registers events at load; nothing fires in tests.
function CreateFrame() return { RegisterEvent = function() end, SetScript = function() end } end

reset()
loadAddon("Bounty.lua")
loadAddon("Pack.lua")
loadAddon("Season.lua")
loadAddon("Kills.lua")
-- Guild sync: timers and sends are stubbed; IsInGuild() is false so nothing is sent.
local clock, combat = 1000, false
function GetTime() return clock end
function IsInGuild() return false end
function InCombatLockdown() return combat end
function Screenshot() end
-- The installed version, as the TOC would report it.
local installed = "v0.8.0-beta2"
C_AddOns = { GetAddOnMetadata = function() return installed end }
-- Timers are collected and run by hand with runTimers().
local timers = {}
C_Timer = {
  After = function(_, fn) timers[#timers + 1] = fn end,
  NewTimer = function() return { Cancel = function() end } end,
  NewTicker = function() end,
}
local function runTimers()
  local batch = timers
  timers = {}
  for _, fn in ipairs(batch) do fn() end
end
loadAddon("Comms.lua")
loadAddon("Detect.lua")
loadAddon("UI/BoardWindow.lua")
loadAddon("Relay.lua")
local Codec = ns.Codec

-- ---------------------------------------------------------------- harness

local passed, failed = 0, 0
local function check(name, ok, detail)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
    print("FAIL  " .. name .. (detail and ("\n      " .. detail) or ""))
  end
end
local function eq(name, got, want)
  check(name, got == want, ("got %s, want %s"):format(tostring(got), tostring(want)))
end

-- ---------------------------------------------------------------- ParseReward

local REWARDS = {
  { "500", 500 }, { "500g", 500 }, { "500G", 500 }, { " 750 g ", 750 }, { "1,000", 1000 },
  { "1k", 1000 }, { "2.5k", 2500 }, { "2.3k", 2300 }, { "1.25k", 1250 }, { "10k", 10000 },
  { "1", 1 }, { "1.0", 1 }, { "2.5000k", 2500 },
  { "0", nil, "RANGE" }, { "10001", nil, "RANGE" }, { "10.001k", nil, "RANGE" }, { "99999999999", nil, "RANGE" },
  { "", nil, "FORMAT" }, { "abc", nil, "FORMAT" }, { "-5", nil, "FORMAT" }, { "1.5", nil, "FORMAT" },
  { "1.2345k", nil, "FORMAT" }, { "1.", nil, "FORMAT" }, { ".5k", nil, "FORMAT" }, { "5kg", 5000 },
  { "1e3", nil, "FORMAT" }, { "0x10", nil, "FORMAT" },
}
for _, c in ipairs(REWARDS) do
  local gold, why = ns.ParseReward(c[1], 1, 10000)
  eq(("ParseReward(%q)"):format(c[1]), gold, c[2])
  if c[3] then eq(("ParseReward(%q) reason"):format(c[1]), why, c[3]) end
end
check("ParseReward(nil)", ns.ParseReward(nil, 1, 10000) == nil)

-- ---------------------------------------------------------------- SnapshotUnit

local function snapFails(name, mutate, want)
  reset()
  mutate()
  local snap, why = ns.SnapshotUnit("target")
  check("snapshot " .. name, snap == nil and why == want, ("got %s / %s, want %s"):format(tostring(snap), tostring(why), want))
end

snapFails("no target", function() units.target = nil end, "NO_TARGET")
snapFails("NPC", function() units.target.player = false end, "NOT_PLAYER")
snapFails("same faction", function() units.target.faction = "Alliance" end, "SAME_FACTION")
snapFails("neutral target", function() units.target.faction = "Neutral" end, "NEUTRAL")
snapFails("neutral player", function() units.player.faction = "Neutral" end, "NEUTRAL")
snapFails("yourself", function() units.target = units.player end, "SELF")
snapFails("secret GUID", function() units.target.guid = SECRET end, "SECRET")
snapFails("secret faction", function() units.target.faction = SECRET end, "SECRET")
snapFails("secret name", function() units.target.name = SECRET end, "SECRET")
-- No bounty options inside any instance: battlegrounds mix in players from other realms.
for _, kind in ipairs({ "pvp", "arena", "party", "raid", "scenario" }) do
  snapFails("inside a " .. kind .. " instance", function() IsInInstance = function() return true, kind end end, "INSTANCE")
end
IsInInstance = function() return false, "none" end
reset()
check("snapshot works in the open world", ns.SnapshotUnit("target") ~= nil)
IsInInstance = nil

reset()
local snap = ns.SnapshotUnit("target")
check("snapshot ok", snap ~= nil)
eq("snapshot faction", snap.faction, 2)
eq("snapshot class", snap.classID, 1)
eq("snapshot race", snap.raceID, 2)
eq("describe", ns.Describe(snap), "Grimlok Ashveil · Orc Warrior 42 · Horde")

reset()
units.target.surname = nil
eq("no surname: first name only", ns.SnapshotUnit("target").name, "Grimlok")
units.target.surname = ""
eq("empty surname: first name only", ns.SnapshotUnit("target").name, "Grimlok")
units.target.surname = SECRET
eq("secret surname: first name only", ns.SnapshotUnit("target").name, "Grimlok")

reset()
units.target.level = -1
local skull = ns.SnapshotUnit("target")
eq("?? level is carried as 0", skull.level, 0)
eq("?? level described", ns.Describe(skull), "Grimlok Ashveil · Orc Warrior ?? · Horde")

-- ---------------------------------------------------------------- B code

reset()
local code = ns.BuildBountyCode(snap, 500, "camps the flight master")
local decoded = Codec.Decode(code)
check("B code decodes", decoded ~= nil and decoded.type == "B", code)
local f = decoded.fields
for k, want in pairs({
  boardTag = "0000", targetGUID = "Player-4395-0A1B2C3D", targetName = "Grimlok Ashveil", targetClassID = 1,
  targetRaceID = 2, targetLevel = 42, targetFaction = 2, posterFaction = 1, rewardGold = 500,
  posterGUID = "Player-4395-00FFEE11", posterName = "Slac Jaw", mapID = 1434, createdAt = 1795200000,
  note = "camps the flight master", mode = 0, existingBountyId = 0,
}) do
  eq("B field " .. k, f[k], want)
end
check("B nonce in range", f.nonce >= 0 and f.nonce <= 65535)

BountyLineDB.boardTag = "MT8H"
eq("B uses the imported board tag", Codec.Decode(ns.BuildBountyCode(snap, 1)).fields.boardTag, "MT8H")
eq("B with no note", Codec.Decode(ns.BuildBountyCode(snap, 1)).fields.note, "")
eq("B note truncated to 80 bytes", #Codec.Decode(ns.BuildBountyCode(snap, 1, ("x"):rep(200))).fields.note, 80)

C_Map.GetBestMapForUnit = function() return nil end
eq("B without a map (instances)", Codec.Decode(ns.BuildBountyCode(snap, 1)).fields.mapID, 0)
C_Map.GetBestMapForUnit = function() return 1434 end

-- ---------------------------------------------------------------- copy lines (code in a Discord spoiler)

-- Four pipes in the EditBox -> Ctrl+C gives two -> Discord spoiler.
eq("bounty copy line", ns.CopyLine("B", "Grimlok Ashveil", "500g", "BL1-B-XYZ-ABCD"),
  "WANTED: **Grimlok Ashveil** · 500g ||||BL1-B-XYZ-ABCD||||")
eq("kill copy line", ns.CopyLine("K", "Grimlok Ashveil", "Bounty #7", "BL1-K-XYZ-ABCD"),
  "CLAIMED: **Grimlok Ashveil** · Bounty #7 ||||BL1-K-XYZ-ABCD||||")
eq("link copy line", ns.CopyLine("L", "Slac Jaw", nil, "BL1-L-XYZ-ABCD"), "LINK: **Slac Jaw** ||||BL1-L-XYZ-ABCD||||")
eq("in-game label hides the code", ns.DisplayLine({ "B", "Grimlok Ashveil", "500g" }), "WANTED: Grimlok Ashveil · 500g  ")
eq("no line, no label text", ns.DisplayLine(nil), "")
eq("stack copy line", ns.CopyLine("A", "Grimlok Ashveil", "200g", "BL1-B-XYZ-ABCD"),
  "ADDED: **Grimlok Ashveil** · +200g ||||BL1-B-XYZ-ABCD||||")

-- Add to Bounty: a B code in mode 1 pointing at the existing bounty.
local stacked = Codec.Decode(ns.BuildBountyCode(snap, 200, "", 12))
check("stack code is mode 1 on bounty #12", stacked and stacked.fields.mode == 1 and stacked.fields.existingBountyId == 12)
eq("new bounty code is mode 0", Codec.Decode(ns.BuildBountyCode(snap, 200)).fields.mode, 0)
local real = ns.BuildBountyCode(snap, 500)
check("the code inside the line is intact", ns.CopyLine("B", "x", "1g", real):find("||||" .. real .. "||||", 1, true) ~= nil)

-- ---------------------------------------------------------------- L code

reset()
local link = Codec.Decode(ns.BuildLinkCode())
check("L code decodes", link ~= nil and link.type == "L")
eq("L charGUID", link.fields.charGUID, "Player-4395-00FFEE11")
eq("L charName", link.fields.charName, "Slac Jaw")
eq("L faction", link.fields.faction, 1)
eq("L guildName", link.fields.guildName, "Grief")
units.player.faction = "Neutral"
local none, err = ns.BuildLinkCode()
check("L refuses a neutral character", none == nil and err == "NEUTRAL")

-- ---------------------------------------------------------------- limits

reset()
local min, max = ns.RewardLimits()
check("default limits 1g to 10,000g", min == 1 and max == 10000)
BountyLineDB.pack = { rewardMin = 5, rewardMax = 500 }
min, max = ns.RewardLimits()
check("pack limits win", min == 5 and max == 500)
eq("range message", ns.RewardError("RANGE", 1, 10000), "Reward must be between 1g and 10000g.")

-- ---------------------------------------------------------------- Bounty Pack

serverTime = PACK_TIME

local JSON = assert(loadfile(here .. "/json.lua"))()
local fh = assert(io.open(root .. "/shared/test-vectors.json", "rb"))
local vectors = JSON.decode(fh:read("*a"))
fh:close()
local single = vectors.packs.cases[1]
local parts = vectors.packs.parts

local NL = "\n"
local _, n = ns.ExtractPackCodes("**Bounty Pack** · 2 open bounties" .. NL .. "In game: type `/bl import`" .. NL .. "```" .. NL
  .. single.input .. NL .. "```")
eq("pack code found inside the pinned message text", n, 1)

reset()
local pack = ns.ReadPack("Bounty Pack, copied with its header:" .. NL .. "```" .. single.input .. "```")
check("whole pinned message imports", pack ~= nil)
eq("pack board tag", pack.boardTag, single.fields.boardTag)
eq("pack bounty count", #pack.bounties, #single.fields.bounties)

local _, partErr, _, received, total = ns.ReadPack(parts[1] .. NL .. parts[3])
check("two of three parts: incomplete", partErr == "INCOMPLETE" and #received == 2 and total == 3, tostring(partErr))
check("all parts in any order", ns.ReadPack(parts[3] .. NL .. parts[1] .. NL .. parts[2]) ~= nil)
eq("no code: EMPTY", select(2, ns.ReadPack("hello")), "EMPTY")

check("store pack", ns.StorePack(pack))
eq("board tag adopted for new codes", ns.BoardTag(), "K7QF")
local first = single.fields.bounties[1]
local b = ns.GetBounty(first.targetGUID)
check("bounty looked up by GUID", b ~= nil and b.id == first.bountyId and b.reward == first.rewardGold and b.poster == first.posterName)
check("unknown GUID: no bounty", ns.GetBounty("Player-1-00000000") == nil)
check("secret GUID: no bounty", ns.GetBounty(SECRET) == nil)
eq("pack reward limits used", select(2, ns.RewardLimits()), single.fields.rewardMax)
check("pack needing a newer addon is flagged", ns.PackOutdated()) -- vector needs 1.2
eq("list biggest reward first", ns.ListBounties()[1].reward, 10000)

local older = {}
for k, v in pairs(pack) do older[k] = v end
older.packVersion = pack.packVersion - 1
check("older pack refused", select(2, ns.StorePack(older)) == "OLDER")

BountyLineDB.pack.bounties[first.targetGUID].expires = 1795200000 - 1
check("expired bounty ignored", ns.GetBounty(first.targetGUID) == nil)

-- ---------------------------------------------------------------- kills

serverTime = BASE_TIME

local function withBounty(faction)
  reset()
  BountyLineDB.pack = { boardTag = "K7QF", version = 1, bounties = {
    ["Player-4395-0A1B2C3D"] = {
      id = 7, name = "Grimlok Ashveil", faction = faction or 2, reward = 500, poster = "Slac Jaw", expires = 1795300000,
    },
  } }
  BountyLineDB.boardTag = "K7QF"
  ns.SetDuel(false, -1000)
end
local VICTIM, ME, PET = "Player-4395-0A1B2C3D", "Player-4395-00FFEE11", "Pet-0-4395-1-12345-678-0000ABCDEF"

withBounty()
eq("my killing blow counts", (ns.CheckKill(ME, VICTIM, 100) or {}).id, 7)
eq("someone else's kill doesn't", select(2, ns.CheckKill("Player-4395-99999999", VICTIM, 100)), "NOT_MINE")
eq("no bounty on the victim", select(2, ns.CheckKill(ME, "Player-4395-12345678", 100)), "NO_BOUNTY")
eq("secret GUIDs are ignored", select(2, ns.CheckKill(SECRET, VICTIM, 100)), "SECRET")
units.pet = { guid = PET }
eq("pet kills count", select(2, ns.CheckKill(PET, VICTIM, 100)), "PET")
ns.SetDuel(true, 100)
eq("never during a duel", select(2, ns.CheckKill(ME, VICTIM, 101)), "DUEL")
ns.SetDuel(false, 100)
eq("nor right after one", select(2, ns.CheckKill(ME, VICTIM, 105)), "DUEL")
eq("fine 10s later", (ns.CheckKill(ME, VICTIM, 111) or {}).id, 7)
withBounty(1)
eq("same-faction bounty never pays out", select(2, ns.CheckKill(ME, VICTIM, 100)), "SAME_FACTION")

-- Totems, guardians and summons (creature GUIDs): yours when you're not in a group.
withBounty()
local TOTEM = "Creature-0-4395-0-12-5925-0000ABCDEF"
IsInGroup = function() return false end
eq("a solo totem's killing blow counts (as a pet kill)", select(2, ns.CheckKill(TOTEM, VICTIM, 100)), "PET")
eq("  ...and so does a summoned guardian (Pet- GUID)", select(2, ns.CheckKill("Pet-0-4395-0-12-416-0100ABCDEF", VICTIM, 100)), "PET")
IsInGroup = function() return true end
eq("in a group it could be a groupmate's totem: no code", select(2, ns.CheckKill(TOTEM, VICTIM, 100)), "NOT_MINE")
IsInGroup = nil
eq("another player's killing blow never counts", select(2, ns.CheckKill("Player-4395-99999999", VICTIM, 100)), "NOT_MINE")

-- Open world only (spec Section 10): every kind of instance is out, the open world is in.
withBounty()
for _, kind in ipairs({ "pvp", "arena", "party", "raid", "scenario" }) do
  IsInInstance = function() return true, kind end
  local got, why, missed = ns.CheckKill(ME, VICTIM, 100)
  check("no kill code inside a " .. kind .. " instance", got == nil and why == "INSTANCE")
  eq("  ...but the bounty comes back so the player is told (" .. kind .. ")", (missed or {}).id, 7)
end
IsInInstance = function() return false, "none" end
eq("open world kills count", (ns.CheckKill(ME, VICTIM, 100) or {}).id, 7)
check("InOpenWorld is true outdoors", ns.InOpenWorld())
IsInInstance = nil
check("InOpenWorld assumes open world when the API is missing", ns.InOpenWorld())

withBounty()
local kill = Codec.Decode(ns.BuildKillCode(7, VICTIM, 1795200100, true, true))
check("K code decodes", kill ~= nil and kill.type == "K")
for k, want in pairs({ boardTag = "K7QF", bountyId = 7, victimGUID = VICTIM, killerGUID = ME, killerName = "Slac Jaw",
  killerFaction = 1, killedAt = 1795200100, mapID = 1434, flags = 3 }) do
  eq("K field " .. k, kill.fields[k], want)
end
eq("K flags without honor or pet", Codec.Decode(ns.BuildKillCode(7, VICTIM, 1, false, false)).fields.flags, 0)

-- ---------------------------------------------------------------- guild sync

serverTime = PACK_TIME

local Comms = ns.Comms
local banners, prints = {}, {}
ns.Banner = function(text) banners[#banners + 1] = text end
ns.Sound = function() end
ns.Print = function(text) prints[#prints + 1] = text end
ns.RefreshMarks = function() end
ns.RefreshBoard = function() end

-- Wire format: chunks fit WoW's 255-byte limit and reassemble in any order, once.
local long = ("ABCDEFGHJK"):rep(55) -- 550 bytes
local lines = Comms.Split("PACK", long, "a1b2c3", 7)
eq("long message is split", #lines, 3)
local fits = true
for _, line in ipairs(lines) do fits = fits and #line <= 255 and not line:find("|", 1, true) end
check("every chunk fits in 255 bytes, no pipes", fits)
local got
for _, i in ipairs({ 3, 1, 1, 2 }) do got = Comms.Reassemble(Comms.Parse(lines[i]), 0) or got end
eq("chunks reassemble in any order, duplicates ignored", got, long)
eq("a short message is one chunk", Comms.Reassemble(Comms.Parse(Comms.Split("HELLO", "5 K7QF", "a1b2c3", 8)[1]), 0), "5 K7QF")
check("junk is ignored", Comms.Parse("hello there") == nil)

-- Who answers a HELLO: only someone with a strictly newer pack from the same board.
reset()
check("no pack: never answer", not Comms.ShouldShare(0, "0000"))
BountyLineDB.pack = { version = 100, boardTag = "K7QF", bounties = {}, codes = "BL1-P-X-0000" }
check("answer an older pack", Comms.ShouldShare(50, "K7QF"))
check("answer someone with no pack yet", Comms.ShouldShare(0, "0000"))
check("not a newer pack", not Comms.ShouldShare(150, "K7QF"))
check("not the same pack", not Comms.ShouldShare(100, "K7QF"))
check("not another guild's board", not Comms.ShouldShare(50, "ZZZZ"))

-- Receiving a pack: guild only, newest wins, new bounties get a banner.
local function receive(kind, data, channel)
  for _, line in ipairs(Comms.Split(kind, data, "f00d01", 1)) do Comms.Receive(line, channel or "GUILD", "Grey") end
end
reset()
banners, prints = {}, {}
local packText = single.input
receive("PACK", packText, "WHISPER")
check("packs from outside the guild channel are ignored", BountyLineDB.pack == nil)
receive("PACK", packText)
eq("a guildie's pack is stored", BountyLineDB.pack and BountyLineDB.pack.version, single.fields.packVersion)
eq("first pack: no banners for every bounty", #banners, 0)
check("sync is announced", prints[1] and prints[1]:find("updated from a guildie") ~= nil, tostring(prints[1]))

-- A newer pack with one more bounty: one banner, for that bounty.
BountyLineDB.pack.version = single.fields.packVersion - 10
local gone = single.fields.bounties[1].targetGUID
BountyLineDB.pack.bounties[gone] = nil
receive("PACK", packText)
eq("banner for the bounty that's new", #banners, 1)
check("banner names it", banners[1] and banners[1]:find(single.fields.bounties[1].targetName, 1, true) ~= nil, tostring(banners[1]))

-- An older pack never replaces a newer one.
BountyLineDB.pack.version = single.fields.packVersion + 10
receive("PACK", packText)
eq("older pack ignored", BountyLineDB.pack.version, single.fields.packVersion + 10)

-- Banners for a guildie's new bounty and kill.
banners = {}
receive("NEWB", "Grimlok Ashveil\t500\tSlac Jaw")
check("pending-bounty banner",
  banners[1] and banners[1]:find("Slac Jaw put a bounty on Grimlok Ashveil", 1, true) ~= nil, tostring(banners[1]))
receive("KILL", ("%d\tHunter McHunterface"):format(single.fields.bounties[2].bountyId))
check("kill banner names the hunter and the target",
  banners[2] and banners[2]:find("Hunter McHunterface collected the bounty on " .. single.fields.bounties[2].targetName, 1, true) ~= nil,
  tostring(banners[2]))

-- Last seen: newest sighting wins, whoever reports it.
reset()
BountyLineDB.lastSeen = {}
receive("SEEN", "12\t1437\t500")
receive("SEEN", "12\t1434\t400")
eq("older sighting doesn't overwrite", ns.LastSeen(12).map, 1437)
receive("SEEN", "12\t1434\t600")
eq("newer sighting does", ns.LastSeen(12).map, 1434)

-- ---------------------------------------------------------------- pack safety and housekeeping

-- A pack dated in the future is refused, and a stored one never blocks real packs.
reset()
local future = {}
for k, v in pairs(ns.ReadPack(single.input)) do future[k] = v end
future.packVersion = PACK_TIME + 100000
check("future-dated pack refused", select(2, ns.StorePack(future)) == "FUTURE")
check("nothing stored", BountyLineDB.pack == nil)
BountyLineDB.pack = { version = PACK_TIME + 100000, boardTag = single.fields.boardTag, bounties = {} }
eq("a stored future pack counts as no pack", (ns.PackVersion()), 0)
receive("PACK", single.input)
eq("so a real pack replaces it", BountyLineDB.pack.version, single.fields.packVersion)

-- Claimed bounties: not hunted, shown as claimed, cleared by a pack made after the kill.
local g1 = single.fields.bounties[1]
ns.MarkClaimed(g1.bountyId, PACK_TIME)
check("claimed bounty isn't hunted", ns.GetBounty(g1.targetGUID) == nil)
local listed
for _, entry in ipairs(ns.ListBounties()) do
  if entry.id == g1.bountyId then listed = entry end
end
check("but is listed as claimed", listed ~= nil and listed.claimed == true)
receive("KILL", ("%d\tSomeone Else"):format(single.fields.bounties[2].bountyId))
check("a guildie's kill marks it claimed too", ns.IsClaimed(single.fields.bounties[2].bountyId))
BountyLineDB.lastSeen[999] = { map = 1, t = 1 }
BountyLineDB.lastSeen[g1.bountyId] = { map = 1437, t = 5 }
local newer = {}
for k, v in pairs(ns.ReadPack(single.input)) do newer[k] = v end
newer.packVersion = PACK_TIME + 60
check("newer pack stored", ns.StorePack(newer))
check("claimed marks older than the pack are cleared", not ns.IsClaimed(g1.bountyId))
check("sightings of vanished bounties are pruned", BountyLineDB.lastSeen[999] == nil)
check("sightings of current bounties are kept", BountyLineDB.lastSeen[g1.bountyId] ~= nil)

-- Banner flood limit: 3 per sender per minute.
check("three banners allowed", Comms.AllowBanner("aa", 0) and Comms.AllowBanner("aa", 1) and Comms.AllowBanner("aa", 2))
check("the fourth is dropped", not Comms.AllowBanner("aa", 3))
check("another sender is unaffected", Comms.AllowBanner("bb", 3))
check("allowed again a minute later", Comms.AllowBanner("aa", 61))

-- Officers-only packs.
function GetNumGuildMembers() return 2 end
function GetGuildRosterInfo(i)
  if i == 1 then return "Slac-Jaw", "Officer", 1 end
  return "Grey", "Peon", 5
end
reset()
check("anyone by default", Comms.TrustsPackFrom("Grey"))
BountyLineDB.settings.packsFrom = "officers"
check("officer trusted", Comms.TrustsPackFrom("Slac-Jaw"))
check("officer trusted by first name", Comms.TrustsPackFrom("Slac"))
check("low rank not trusted", not Comms.TrustsPackFrom("Grey"))
check("stranger not trusted", not Comms.TrustsPackFrom("Nobody"))
receive("PACK", single.input)
check("their pack is ignored", BountyLineDB.pack == nil)

-- Sighting alerts: the first time, then only after losing sight for a while.
reset()
check("first sighting alerts", ns.ShouldAlert(50, 0))
check("still in view: no repeat", not ns.ShouldAlert(50, 300))
check("still in view later: no repeat", not ns.ShouldAlert(50, 800))
check("after 10+ minutes unseen: alerts again", ns.ShouldAlert(50, 800 + 601))

-- ---------------------------------------------------------------- pending bounties

reset()
serverTime = PACK_TIME
local PGUID = "Player-4395-0C0C0C0C"
check("no bounty before", ns.GetBounty(PGUID) == nil)
receive("PEND", table.concat({ PGUID, "Vexa Nightwhisper", 4, 2, 250, "Grey Gnomelander", PACK_TIME + 999999 }, "\t"))
local pend = ns.GetBounty(PGUID)
check("a guildie's new bounty is huntable at once", pend ~= nil and pend.pending and pend.id == 0 and pend.reward == 250)
eq("label has no number", ns.BountyLabel(pend), "new bounty")
check("the sender's clock can't stretch its life", pend.expires <= PACK_TIME + 48 * 3600)
eq("listed on the board with no pack", #ns.ListBounties(), 1)
units.target.guid = PGUID
eq("a kill on it counts", (ns.CheckKill(ME, PGUID, 5000) or {}).id, 0)
eq("its kill code has bounty number 0", Codec.Decode(ns.BuildKillCode(0, PGUID, PACK_TIME, false, false)).fields.bountyId, 0)
receive("PEND", "garbage")
receive("PEND", table.concat({ "Player-4395-0D0D0D0D", "Bad Faction", 4, 7, 250, "X", 1 }, "\t"))
check("malformed pending messages are ignored", ns.GetBounty("Player-4395-0D0D0D0D") == nil)

-- A guildie collects it: gone for everyone.
receive("KILLP", PGUID .. "\tHunter McHunterface\tVexa Nightwhisper")
check("collected pending bounty is dropped", ns.GetBounty(PGUID) == nil)

-- A pack that lists the target replaces the pending entry with the numbered bounty.
local listedGuid = single.fields.bounties[1].targetGUID
check("pending added", ns.AddPending(listedGuid, "Someone", 1, 2, 5, "Me", PACK_TIME))
check("pack stored", ns.StorePack(ns.ReadPack(single.input)))
eq("the numbered bounty wins", ns.GetBounty(listedGuid).id, single.fields.bounties[1].bountyId)
check("pending entry removed", BountyLineDB.pending[listedGuid] == nil)
check("no pending for a target that already has a bounty", not ns.AddPending(listedGuid, "Someone", 1, 2, 5, "Me", PACK_TIME))

-- Pending bounties time out after 48 hours.
check("pending added", ns.AddPending(PGUID, "Vexa Nightwhisper", 4, 2, 250, "Grey", PACK_TIME))
serverTime = PACK_TIME + 49 * 3600
check("gone after 48h", ns.GetBounty(PGUID) == nil)
serverTime = PACK_TIME

-- ---------------------------------------------------------------- board sorting

local sortable = {
  { id = 3, name = "Zed", reward = 50, poster = "B", expires = 30 },
  { id = 1, name = "Amy", reward = 500, poster = "A", expires = 10 },
  { id = 2, name = "Mia", reward = 50, expires = 20 },
}
local function order(key, desc)
  local out = {}
  for i, row in ipairs(ns.SortBounties(sortable, key, desc)) do out[i] = row.id end
  return table.concat(out, ",")
end
eq("by reward, biggest first (ties by number)", order("reward", true), "1,2,3")
eq("by name", order("name", false), "1,2,3")
eq("by expiry, latest first", order("expires", true), "3,2,1")
eq("missing poster sorts first", order("poster", false), "2,1,3")
eq("add-gold description without a unit", ns.Describe({ name = "Amy Vale", factionName = "Horde" }), "Amy Vale · Horde")

-- ---------------------------------------------------------------- relay (spec 5.10)

do
  local realSend, realShow = Comms.Send, ns.RelayShow
  local sent, shown = {}, {}
  Comms.Send = function(kind, data) sent[#sent + 1] = { kind, data } end
  ns.RelayShow = function(c) shown[#shown + 1] = c return true end
  ns.RelayHide = function() end
  local relayed = {}
  ns.CodeRelayed = function(c, who) relayed[#relayed + 1] = c .. " by " .. who end
  local function from(sender, kind, data)
    for _, line in ipairs(Comms.Split(kind, data, "beef02", #sent + #shown + 40)) do Comms.Receive(line, "GUILD", sender) end
  end
  reset()
  local bcode = assert(ns.BuildBountyCode(snap, 500, "")) -- the poster is "Slac Jaw"
  local other = assert(ns.BuildBountyCode(snap, 501, ""))
  local mine = assert(ns.BuildBountyCode(snap, 502, ""))

  check("the sender must be the poster named in the code",
    Comms.SenderIsPoster("Slac-Jaw", "Slac Jaw") and Comms.SenderIsPoster("Slac", "Slac Jaw")
    and not Comms.SenderIsPoster("Evil", "Slac Jaw") and not Comms.SenderIsPoster(nil, "Slac Jaw")
    and not Comms.SenderIsPoster("Slac", nil))

  reset()
  BountyLineDB.settings.relay = true
  ns.RelayStart(nil, nil, serverTime)
  check("no relay program: not a relay", not ns.RelayActive())
  from("Slac-Jaw", "BCODE", bcode)
  check("and guildies' codes are left alone", #shown == 0 and #sent == 0)

  ns.RelayStart(serverTime - 3600, nil, serverTime)
  check("a stale stamp doesn't count (the program isn't running)", not ns.RelayActive())
  BountyLineDB.settings.relay = false
  ns.RelayStart(serverTime - 30, nil, serverTime)
  check("turned off in settings", not ns.RelayActive())
  BountyLineDB.settings.relay = true
  ns.RelayStart(serverTime - 30, nil, serverTime)
  check("a fresh stamp: this client is a relay", ns.RelayActive())
  from("Grey-Warden", "SEEN", ("7\t1437\t%d"):format(serverTime - 900))
  check("an older relay program isn't sent sightings", not ns.RelayFlushSeen(clock, serverTime))
  ns.RelayStart(serverTime - 30, nil, serverTime, true)

  from("Evil", "BCODE", bcode)
  check("a code sent by someone other than its poster is dropped", #shown == 0 and #sent == 0)
  from("Slac-Jaw", "BCODE", "hello")
  check("junk is dropped", #shown == 0)
  from("Slac-Jaw", "BCODE", bcode)
  eq("the poster's own code is shown for the program", shown[1], bcode)
  check("and the poster is told", sent[1] and sent[1][1] == "RLY" and sent[1][2]:find(bcode, 1, true) == 1)
  runTimers()
  from("Slac-Jaw", "BCODE", bcode)
  eq("the same code isn't shown twice", #shown, 1)

  from("Grey", "RLY", other .. "\tGrey Warden")
  eq("the maker hears that a relay has it", relayed[#relayed], other .. " by Grey Warden")
  from("Slac-Jaw", "BCODE", other)
  eq("a code another relay already has is left to them", #shown, 1)

  check("a relay carries its own bounties itself", ns.RelayQueue(mine) == true)
  runTimers()
  runTimers()

  -- Sightings (spec 5.10): collected from guild sync, sent as one W code every 5 minutes.
  shown = {}
  BountyLineDB.settings.shareSeen = nil
  from("Grey-Warden", "SEEN", ("7\t1437\t%d"):format(serverTime - 120))
  eq("a guildie's sighting is recorded with who saw it", ns.LastSeen(7).by, "Grey Warden")
  from("Grey-Warden", "SEEN", ("8\t1429\t%d"):format(serverTime + 9999))
  eq("a sighting from the future is dated now", ns.LastSeen(8).t, serverTime)
  ns.Comms.Seen(9, 1411, serverTime - 60)
  eq("my own sighting is mine", ns.LastSeen(9).by, "Slac Jaw")
  from("Grey-Warden", "SEEN", ("7\t1411\t%d"):format(serverTime - 600))
  eq("an older sighting doesn't replace a newer one", ns.LastSeen(7).map, 1437)
  combat = true
  check("not sent in combat", not ns.RelayFlushSeen(clock, serverTime) and #shown == 0)
  combat = false
  check("sent out of combat", ns.RelayFlushSeen(clock, serverTime) and #shown == 1)
  local w = Codec.Decode(shown[1])
  check("as one W code", w and w.type == "W" and #w.fields.sightings == 3, shown[1])
  if w then
    eq("newest first", w.fields.sightings[1].bountyId, 8)
    eq("with the spotter", w.fields.sightings[3].spotterName, "Grey Warden")
    eq("and the zone", w.fields.sightings[3].mapID, 1437)
  end
  runTimers()
  check("nothing new: nothing sent", not ns.RelayFlushSeen(clock + 600, serverTime))
  from("Grey-Warden", "SEEN", ("7\t1437\t%d"):format(serverTime))
  check("a new sighting waits out the 5 minutes", not ns.RelayFlushSeen(clock + 60, serverTime))
  check("then goes", ns.RelayFlushSeen(clock + 301, serverTime) and #shown == 2)
  runTimers()
  for i = 1, 12 do from("Someone-With-A-Long-Surname", "SEEN", ("%d\t1437\t%d"):format(100 + i, serverTime - i)) end
  check("many sightings: the first report", ns.RelayFlushSeen(clock + 700, serverTime))
  local firstReport = Codec.Decode(shown[#shown])
  check("stays a QR code that reads", #shown[#shown] <= 170 and firstReport and #firstReport.fields.sightings >= 2, shown[#shown])
  runTimers()
  check("the rest go in the next report", ns.RelayFlushSeen(clock + 1100, serverTime))
  local second = Codec.Decode(shown[#shown])
  local firstList = firstReport.fields.sightings
  check("with the older ones", second and second.fields.sightings[1].seenAt < firstList[#firstList].seenAt)
  runTimers()
  local later = clock + 1100
  repeat later = later + 301 until not ns.RelayFlushSeen(later, serverTime) -- send whatever is left
  runTimers()
  BountyLineDB.settings.shareSeen = false
  ns.Comms.Seen(9, 1411, serverTime + 1)
  check("sightings I don't share aren't relayed", not ns.RelayFlushSeen(later + 301, serverTime + 1))
  BountyLineDB.settings.shareSeen = nil
  runTimers()

  -- The pack the program left in its data file is loaded and shared.
  reset()
  BountyLineDB.settings.relay = true
  prints = {}
  ns.RelayStart(serverTime - 30, single.input, serverTime)
  eq("the relay's pack is stored at login", (ns.PackVersion()), single.fields.packVersion)
  check("and announced", #prints >= 1)
  ns.RelayStart(serverTime - 30, "not a pack", serverTime)
  eq("junk in the data file changes nothing", (ns.PackVersion()), single.fields.packVersion)

  Comms.Send, ns.RelayShow = realSend, realShow
  ns.RelayStart(nil, nil, serverTime)
end

-- ---------------------------------------------------------------- QR code on the stamp

do
  local qfh = assert(io.open(root .. "/shared/qr-vector.json", "rb"))
  local qtext = qfh:read("*a")
  qfh:close()
  local qcode = qtext:match('"code": "([^"]+)"')
  local ok, tab = ns.QR.qrcode(qcode, 2)
  check("kill code encodes as a QR code", ok == true)
  local rows = {}
  for y = 1, #tab do
    local r = {}
    for x = 1, #tab do r[x] = tab[x][y] > 0 and "1" or "0" end
    rows[y] = table.concat(r)
  end
  check("and matches the shared matrix", qtext:find(table.concat(rows, "/"), 1, true) ~= nil)
  -- The stamp draws black runs: together they must cover exactly the black modules.
  loadAddon("UI/Stamp.lua")
  local runs, side = ns.QRRuns(qcode)
  local black, covered = 0, 0
  for y = 1, side do for x = 1, side do if tab[x][y] > 0 then black = black + 1 end end end
  for _, run in ipairs(runs) do
    for x = run[1], run[1] + run[3] - 1 do if tab[x][run[2]] > 0 then covered = covered + 1 end end
  end
  eq("stamp runs cover every black module", covered, black)
  check("far fewer runs than modules", #runs < black / 2)
  check("other text still encodes", ns.QRRuns("not a code") ~= nil)
  check("no code, no QR", ns.QRRuns(nil) == nil)
end

-- ---------------------------------------------------------------- version check

local V = ns.ParseVersion
check("versions sort by release order",
  V("v0.7.0") < V("v0.8.0-alpha1") and V("v0.8.0-alpha1") < V("v0.8.0-beta1") and V("v0.8.0-beta1") < V("v0.8.0-beta2")
  and V("v0.8.0-beta2") < V("v0.8.0") and V("v0.8.0") < V("v0.8.1-beta1") and V("0.9.0") < V("v1.0.0"))
eq("a build past a tag counts as that tag", V("v0.8.0-beta2-3-gabc1234"), V("v0.8.0-beta2"))
check("not versions", V("@project-version@") == nil and V("hello") == nil and V(nil) == nil and V(("9"):rep(50)) == nil)
eq("version code for packs", ns.AddonVersionCode(), 8)
installed = "@project-version@"
check("a source copy has no version", ns.AddonVersion() == nil)
eq("and falls back for packs", ns.AddonVersionCode(), 8)
installed = "v0.8.0-beta2"

prints = {}
receive("VER", "v0.8.0-beta2")
check("same version: nothing said", #prints == 0 and ns.NewerVersion() == nil)
receive("VER", "v0.8.0-beta1")
eq("an older guildie is noted", ns.OlderGuildies().Grey, "v0.8.0-beta1")
check("and I'm not told to update", #prints == 0)
receive("VER", "v0.9.0")
check("a newer guildie: told to update", #prints == 1 and prints[1]:find("v0.9.0", 1, true) ~= nil, tostring(prints[1]))
eq("remembered for the board", ns.NewerVersion(), "v0.9.0")
receive("VER", "v0.9.1")
eq("said once per session", #prints, 1)
eq("but the newest is kept", ns.NewerVersion(), "v0.9.1")
receive("VER", "nonsense")
eq("junk ignored", ns.NewerVersion(), "v0.9.1")

-- ---------------------------------------------------------------- kill queue and combat

reset()
serverTime = BASE_TIME
BountyLineCharDB = { kills = {} }
local shown = {}
ns.ShowCode = function(popup) shown[#shown + 1] = popup end
ns.ShowStamp = function() end
ns.HideStamp = function() end
local toast = { shown = 0, waiting = 0 }
ns.ShowKillToast = function(count) toast.shown, toast.waiting = toast.shown + 1, count end
ns.UpdateKillToast = function(count) toast.waiting = count end
timers = {}
local K = ns._kills
K.start({ id = 21, name = "First Target", reward = 5 }, VICTIM, false, false)
K.start({ id = 22, name = "Second Target", reward = 6 }, VICTIM, false, false)
eq("first kill is being processed", K.pending().bounty.id, 21)
runTimers() -- honor wait over: stamp + screenshot
runTimers() -- no screenshot event: fallback finishes it
eq("first kill's code shown", #shown, 1)
eq("then the queued kill starts", K.pending().bounty.id, 22)
runTimers()
K.finish(true)
eq("second kill's code shown", #shown, 2)
check("nothing left pending", K.pending() == nil)
eq("both saved for My Kills", #BountyLineCharDB.kills, 2)
check("both marked claimed", ns.IsClaimed(21) and ns.IsClaimed(22))

combat = true
K.start({ id = 23, name = "Third Target", reward = 7 }, VICTIM, false, false)
runTimers()
K.finish(true)
eq("in combat: no popup (it would grab the keyboard)", #shown, 2)
eq("the flash and logo square appear instead", toast.shown, 1)
check("and the code is ready for /bl last", BountyLineCharDB.lastPopup ~= nil and BountyLineCharDB.lastPopup.code ~= nil)
ns.OpenDeferredKill()
eq("clicking the square mid-fight doesn't open it", #shown, 2)
eq("it keeps waiting", ns.DeferredKills(), 1)
combat = false
eq("combat ending doesn't pop it open by itself", #shown, 2)
ns.OpenDeferredKill()
eq("clicking after the fight opens the code", #shown, 3)
eq("and the square goes away", toast.waiting, 0)
ns.OpenDeferredKill()
eq("only once", #shown, 3)

-- ---------------------------------------------------------------- Open Season (spec 5.11)

reset()
function GetGuildInfo(unit) return units[unit] and units[unit].guild end
serverTime = PACK_TIME
BountyLineDB = { settings = {}, boardTag = "K7QF" }
BountyLineCharDB = { kills = {} }
timers = {}
local HV = "Honor and Valor"
units.target.guild = HV

local seenEntry = ns.RememberUnit("target")
eq("an enemy's name is remembered", seenEntry and seenEntry.n, "Grimlok Ashveil")
eq("and their guild", seenEntry and seenEntry.g, HV)
eq("and their faction", seenEntry and seenEntry.f, 2)
check("your own side isn't remembered", ns.RememberUnit("player") == nil)
check("nor a unit that doesn't exist", ns.RememberUnit("focus") == nil)
units.target.guid = SECRET
check("a hidden GUID is skipped", ns.RememberUnit("target") == nil)
units.target.guid = VICTIM
units.target.guild = SECRET
check("a hidden guild is skipped", ns.RememberUnit("target") == nil)
units.target.guild = HV
eq("lookup by GUID", (ns.GuildOf(VICTIM) or {}).g, HV)

local function seasonPack(seasons, version)
  return {
    packVersion = version or (PACK_TIME - 10), boardTag = "K7QF", discordDisplayName = "Grief", rewardMin = 1, rewardMax = 10000,
    minAddonVersion = 4, bounties = {}, seasons = seasons,
  }
end
local function hv(changes)
  local s = { seasonId = 7, guildName = HV, guildFaction = 2, kind = 1, perKillGold = 25, remainingGold = 100, posterName = "Someone Else",
    expiresAt = PACK_TIME + 3 * 86400 }
  for k, v in pairs(changes or {}) do s[k] = v end
  return s
end
check("a pack with seasons is stored", ns.StorePack(seasonPack({
  hv(),
  hv({ seasonId = 8, guildName = "Long Gone", kind = 3, perKillGold = 5, remainingGold = 0, expiresAt = PACK_TIME - 5 }),
})))
eq("seasons are found by guild, whatever the case", (ns.GetSeason("  HONOR and valor ") or {}).id, 7)
check("an expired season isn't kept", ns.GetSeason("Long Gone") == nil)
eq("one season listed", #ns.ListSeasons(), 1)
eq("terms: per head", ns.SeasonTerms(ns.GetSeason(HV)), "25g a head")
eq("terms: prize pool", ns.SeasonTerms({ kind = 2, remaining = 500 }), "500g prize pool")
eq("label", ns.SeasonLabel(ns.GetSeason(HV)), "Open Season #7")

local season, guildSeen, victimName = ns.SeasonForKill(VICTIM)
eq("a kill on a member counts for the season", season and season.id, 7)
check("and the guild was seen", guildSeen == true)
eq("with the victim's name", victimName, "Grimlok Ashveil")
eq("NPC kills never count", select(2, ns.SeasonForKill("Creature-0-4395-1-2-3-0000ABCDEF")), "NOT_PLAYER")
eq("hidden GUIDs never count", select(2, ns.SeasonForKill(SECRET)), "NOT_PLAYER")

local unseen, unseenSeen = ns.SeasonForKill("Player-4395-0BADF00D")
check("an enemy whose guild we never saw: claimed for review",
  unseen ~= nil and unseen.unknown == true and unseen.id == 0 and unseenSeen == false)

units.target = { guid = "Player-4395-0C0FFEE0", name = "Other", faction = "Horde", player = true, guild = "Nobodies",
  class = { "Warrior", "WARRIOR", 1 }, race = { "Orc", "Orc", 2 }, level = 42 }
ns.RememberUnit("target")
eq("a known player in another guild doesn't count", select(2, ns.SeasonForKill("Player-4395-0C0FFEE0")), "NO_SEASON")
units.target.guild = nil
eq("a guild seen in the last hour isn't forgotten when the game briefly has none", ns.RememberUnit("target").g, "Nobodies")
units.target.guild = "Nobodies"
-- A victim on your own faction (free-for-all areas) never makes an Open Season claim.
units.target = { guid = "Player-4395-0F0F0F0F", name = "Friend", faction = "Alliance", player = true,
  class = { "Warrior", "WARRIOR", 1 }, race = { "Human", "Human", 1 }, level = 42 }
eq("a victim of your own faction makes no stand-in claim", select(2, ns.SeasonForKill("Player-4395-0F0F0F0F")), "SAME_FACTION")
units.target = { guid = "Player-4395-0C0FFEE0", name = "Other", faction = "Horde", player = true, guild = "Nobodies",
  class = { "Warrior", "WARRIOR", 1 }, race = { "Orc", "Orc", 2 }, level = 42 }
units.target.guild = nil
ns.RememberUnit("target")
eq("nor a known player with no guild", select(2, ns.SeasonForKill("Player-4395-0C0FFEE0")), "NO_SEASON")

local seasonCode = ns.BuildKillCode(0, VICTIM, PACK_TIME, true, false, { id = 7, name = victimName, guild = HV, seen = true })
local seasonFields = (Codec.Decode(seasonCode) or {}).fields or {}
eq("season kill code: schema 2", seasonFields.schema, 2)
eq("season kill code: season", seasonFields.seasonId, 7)
eq("season kill code: victim name", seasonFields.victimName, "Grimlok Ashveil")
eq("season kill code: guild seen", seasonFields.guildSeen, 1)
eq("season kill code: guild name", seasonFields.guildName, HV)
eq("the guild comes back from SeasonForKill", select(4, ns.SeasonForKill(VICTIM)), HV)
eq("season kill code: no personal bounty", seasonFields.bountyId, 0)
local unseenFields = (Codec.Decode(ns.BuildKillCode(0, VICTIM, PACK_TIME, false, false, { id = 0, seen = false })) or {}).fields or {}
eq("guild not seen: flagged", unseenFields.guildSeen, 0)
eq("guild not seen: no name", unseenFields.victimName, "")
eq("guild not seen: no guild", unseenFields.guildName, "")
local plainFields = (Codec.Decode(ns.BuildKillCode(12, VICTIM, PACK_TIME, true, false)) or {}).fields or {}
eq("an ordinary kill code is still schema 1", plainFields.schema, 1)

-- the whole flow: stamp line, popup, and "done for today"
local before = #shown
K.start(nil, VICTIM, false, false, { id = 7, name = victimName, seen = true, s = season })
eq("stamp line names the season", ns.KillLine(K.pending()), "Grimlok Ashveil · 25g a head · Open Season #7")
runTimers()
K.finish(true)
eq("season kill: code popup shown", #shown, before + 1)
eq("season kill: its own title", shown[#shown].title, ns.L.SEASON_KILL_TITLE)
eq("season kill: schema 2 code", ((Codec.Decode(shown[#shown].code) or {}).fields or {}).seasonId, 7)
check("no personal bounty was marked claimed", not ns.IsClaimed(0))
check("the victim is done for today", ns.SeasonClaimedToday(VICTIM))
eq("a second kill today makes no code", select(2, ns.SeasonForKill(VICTIM)), "DAILY")
serverTime = PACK_TIME + 86400
eq("tomorrow they count again", (ns.SeasonForKill(VICTIM) or {}).id, 7)
serverTime = PACK_TIME

BountyLineCharDB.seasonKills = nil
eq("a bounty target in a season guild: both on the line",
  ns.KillLine({ bounty = { id = 12, name = "Grimlok Ashveil", reward = 500 }, season = { id = 7, seen = true, s = season } }),
  "Grimlok Ashveil · 500g · Bounty #12 + Open Season #7")

check("newer pack stored", ns.StorePack(seasonPack({ hv({ posterName = "Slac Jaw" }) }, PACK_TIME - 5)))
eq("you can't collect on a season you declared", select(2, ns.SeasonForKill(VICTIM)), "OWN")
check("pack with an empty pot stored", ns.StorePack(seasonPack({ hv({ remainingGold = 0 }) }, PACK_TIME - 4)))
check("a pot that ran dry is no longer open", ns.GetSeason(HV) == nil)
check("so an unseen enemy makes no claim either", ns.SeasonForKill("Player-4395-0BADF00D") == nil)
check("a pack without seasons clears them", ns.StorePack(seasonPack(nil, PACK_TIME - 3)))
eq("none listed", #ns.ListSeasons(), 0)

BountyLineDB.guilds = {
  old = { n = "Old", g = "G", f = 2, t = PACK_TIME - 15 * 86400 },
  fresh = { n = "New", g = "G", f = 2, t = PACK_TIME - 60 },
}
eq("pruning keeps recent players", ns.PruneGuilds(), 1)
check("and drops ones not seen for two weeks", BountyLineDB.guilds.old == nil and BountyLineDB.guilds.fresh ~= nil)

-- declaring an Open Season
reset()
serverTime = PACK_TIME
BountyLineDB = { settings = {}, boardTag = "K7QF" }
units.target.guild = HV
local guildSnap = ns.SnapshotUnit("target")
eq("the snapshot carries the guild", guildSnap.guild, HV)
units.target.guild = SECRET
local hiddenSnap = ns.SnapshotUnit("target")
check("a hidden guild is reported as hidden, not as a name", hiddenSnap.guild == nil and hiddenSnap.guildHidden == true)
units.target.guild = HV

local potCode = ns.BuildSeasonCode(guildSnap, 1, 25, 2000, 7)
local potFields = (Codec.Decode(potCode) or {}).fields or {}
eq("season code: type", (Codec.Decode(potCode) or {}).type, "S")
eq("season code: guild", potFields.guildName, HV)
eq("season code: faction", potFields.guildFaction, 2)
eq("season code: kind", potFields.kind, 1)
eq("season code: price per kill", potFields.perKillGold, 25)
eq("season code: pot", potFields.totalGold, 2000)
eq("season code: days", potFields.days, 7)
eq("season code: poster", potFields.posterName, "Slac Jaw")
local addFields = (Codec.Decode(ns.BuildSeasonCode(guildSnap, 1, 25, 300, 7, 7)) or {}).fields or {}
eq("adding gold: mode 1", addFields.mode, 1)
eq("adding gold: only the amount travels", addFields.kind + addFields.perKillGold + addFields.days, 0)
eq("adding gold: the amount", addFields.totalGold, 300)
eq("adding gold: to that season", addFields.existingSeasonId, 7)
check("a pot smaller than one kill makes no code", ns.BuildSeasonCode(guildSnap, 1, 50, 20, 7) == nil)
local poolFields = (Codec.Decode(ns.BuildSeasonCode(guildSnap, 2, 0, 500, 14, nil, 10)) or {}).fields or {}
eq("a prize pool with a minimum: schema 2", poolFields.schema, 2)
eq("a prize pool with a minimum: the minimum", poolFields.minKills, 10)
local potWithMin = ns.BuildSeasonCode(guildSnap, 1, 25, 100, 7, nil, 10)
eq("a per head season ignores a minimum: schema 1", ((Codec.Decode(potWithMin) or {}).fields or {}).schema, 1)
check("a prize pool minimum of 0 makes no code", ns.BuildSeasonCode(guildSnap, 2, 0, 500, 14, nil, 0) == nil)
check("10 days makes no code", ns.BuildSeasonCode(guildSnap, 3, 50, 0, 10) == nil)
check("no guild makes no code", ns.BuildSeasonCode({ faction = 2 }, 3, 50, 0, 7) == nil)
eq("copy line for Discord", ns.CopyLine("S", HV, "25g a head", "CODE"), "OPEN SEASON: **Honor and Valor** · 25g a head ||||CODE||||")

-- a guildie declares one: hunted at once, before any pack lists it
banners = {}
receive("SEAS", table.concat({ HV, 2, 3, 40, 0, "Grey Wolf", PACK_TIME }, "\t"))
local pendingSeason = ns.GetSeason(HV)
check("a guildie's new season is live straight away", pendingSeason ~= nil and pendingSeason.pending == true and pendingSeason.id == 0)
eq("its terms", ns.SeasonTerms(pendingSeason), "40g a head")
eq("the guild gets one banner", #banners, 1)
receive("SEAS", table.concat({ HV, 2, 1, 5, 50, "Grey Wolf", PACK_TIME }, "\t"))
eq("a second one on the same guild is ignored", ns.GetSeason(HV).perKill, 40)
receive("SEAS", table.concat({ "Friends", 1, 3, 40, 0, "Grey Wolf", PACK_TIME }, "\t"))
check("a season on your own faction is ignored", ns.GetSeason("Friends") == nil)
receive("SEAS", "garbage")
ns.RememberUnit("target")
local pendSeason, pendSeen = ns.SeasonForKill(VICTIM)
check("a kill counts for it, with no number yet", pendSeason ~= nil and pendSeason.id == 0 and pendSeen == true)
local pendCode = ns.BuildKillCode(0, VICTIM, PACK_TIME, true, false, { id = 0, name = "x", guild = HV, seen = true })
eq("and its code names the guild, so the Bounty Board can find the season", ((Codec.Decode(pendCode) or {}).fields or {}).guildName, HV)
check("the pack lists it: the pending copy goes", ns.StorePack(seasonPack({ hv() }, PACK_TIME - 2)))
eq("now it has its number", ns.GetSeason(HV).id, 7)
check("pending copy dropped", next(BountyLineDB.pendingSeasons) == nil)

-- A window opened outside and submitted after zoning into an instance still makes no code.
do
  local built = false
  local realBuild = ns.BuildSeasonCode
  ns.BuildSeasonCode = function(...) built = true return realBuild(...) end
  IsInInstance = function() return true, "pvp" end
  local printedBefore = #prints
  ns.PostSeason({ guild = HV, faction = 2 }, 1, 25, 500, 14)
  check("no Open Season code from inside a battleground", not built)
  eq("  ...and the player is told why", prints[printedBefore + 1], ns.L.INSTANCE)
  IsInInstance = nil
  ns.BuildSeasonCode = realBuild
end

-- ---------------------------------------------------------------- bounty terms (spec 5.4c)

do
  reset()
  serverTime = PACK_TIME
  BountyLineDB = { settings = {}, boardTag = "K7QF" }
  BountyLineCharDB = { kills = {} }
  timers = {}
  local realGroup = IsInGroup
  IsInGroup = function() return false end
  local T = Codec.TERM
  local terms = { { kind = T.soloBonus, value = 0, gold = 50 }, { kind = T.insultBonus, value = 0, gold = 25 } }
  local extras = { kills = 3, payout = 0, days = 7, terms = terms }
  local termSnap = assert(ns.SnapshotUnit("target"))
  local bCode = Codec.Decode(assert(ns.BuildBountyCode(termSnap, 900, "", nil, extras)))
  eq("a bounty with terms is schema 2", bCode and bCode.fields.schema, 2)
  eq("  with its kills", bCode and bCode.fields.kills, 3)
  eq("  its length", bCode and bCode.fields.days, 7)
  eq("  and its terms", bCode and #bCode.fields.terms, 2)
  eq("Add to Bounty never carries terms", Codec.Decode(ns.BuildBountyCode(termSnap, 100, "", 5, extras)).fields.schema, 1)
  eq("no extras: schema 1 as before", Codec.Decode(ns.BuildBountyCode(termSnap, 100, "")).fields.schema, 1)

  -- The pack carries the terms (schema 3) and they land on the bounty.
  local p = {
    schema = 3, boardTag = "K7QF", packVersion = PACK_TIME - 5, minAddonVersion = 4, discordDisplayName = "Grief",
    rewardMin = 1, rewardMax = 10000, seasons = {},
    bounties = { { bountyId = 31, targetGUID = VICTIM, targetName = "Grimlok Ashveil", targetClassID = 1, targetFaction = 2,
      rewardGold = 900, posterName = "Amy Vale", expiresAt = PACK_TIME + 86400 } },
    bountyTerms = { { bountyId = 31, kills = 3, killsLeft = 2, payout = 0, terms = terms } },
  }
  check("a pack with terms is stored", ns.StorePack(p))
  local wanted = ns.GetBounty(VICTIM)
  check("the bounty has terms", ns.HasTerms(wanted))
  local L = ns.L
  eq("its tooltip lines", table.concat(ns.TermsLines(wanted), " | "), table.concat({
    L.TERMS_EACH_KILL:format(3, 2), L.TERM_SOLO_BONUS:format(ns.FormatGold(50)), L.TERM_INSULT_BONUS:format(ns.FormatGold(25)),
  }, " | "))
  check("a plain bounty has none", not ns.HasTerms({ id = 1, reward = 5 }))

  -- The kill: facts in the code (K schema 3), and a wait for the /lol.
  -- (K is ns._kills, from the kill-queue tests)
  K.start(wanted, VICTIM, false, false)
  check("an insult bonus waits for the /lol", K.pending() ~= nil and K.pending().wantsInsult == true)
  ns.OnLaugh("Player-4395-0FFFFFFF")
  check("a /lol at someone else doesn't count", not K.pending().insult)
  ns.OnLaugh(VICTIM)
  check("a /lol at the corpse does", K.pending().insult == true)
  runTimers()
  K.finish(true)
  local saved = BountyLineCharDB.kills[1]
  local kc = saved and Codec.Decode(saved.code)
  eq("the kill code carries facts (schema 3)", kc and kc.fields.schema, 3)
  eq("  solo and the insult", kc and kc.fields.facts, Codec.FACT.solo + Codec.FACT.insult)
  eq("  my class", kc and kc.fields.killerClassID, 1)
  eq("  my level", kc and kc.fields.killerLevel, 60)
  eq("  the victim's level (my target)", kc and kc.fields.victimLevel, 42)
  eq("  and no season", kc and kc.fields.seasonId, 0)
  check("a bounty wanting more kills stays huntable", not ns.IsClaimed(31))

  -- No /lol: the shot is taken when the time is up, without the insult.
  BountyLineCharDB.kills = {}
  IsInGroup = function() return true end
  K.start(wanted, VICTIM, false, false)
  runTimers()
  K.finish(true)
  kc = Codec.Decode(BountyLineCharDB.kills[1].code)
  eq("no /lol, in a group: no facts bits", kc and kc.fields.facts, 0)

  -- One kill with no terms: exactly as before.
  BountyLineCharDB.kills = {}
  K.start({ id = 40, name = "Plain Target", reward = 5 }, VICTIM, false, false)
  runTimers()
  K.finish(true)
  kc = Codec.Decode(BountyLineCharDB.kills[1].code)
  eq("a plain bounty's kill code is schema 1", kc and kc.fields.schema, 1)
  check("and it's marked claimed", ns.IsClaimed(40))
  IsInGroup = realGroup
end

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then os.exit(1) end
