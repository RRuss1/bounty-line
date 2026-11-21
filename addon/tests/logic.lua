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
function GetServerTime() return 1795200000 end
function GetGuildInfo() return "Grief" end
function issecretvalue(v) return v == SECRET end
C_Map = { GetBestMapForUnit = function() return 1434 end }
-- Kills.lua registers events at load; nothing fires in tests.
function CreateFrame() return { RegisterEvent = function() end, SetScript = function() end } end

reset()
loadAddon("Bounty.lua")
loadAddon("Pack.lua")
loadAddon("Kills.lua")
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

withBounty()
local kill = Codec.Decode(ns.BuildKillCode(7, VICTIM, 1795200100, true, true))
check("K code decodes", kill ~= nil and kill.type == "K")
for k, want in pairs({ boardTag = "K7QF", bountyId = 7, victimGUID = VICTIM, killerGUID = ME, killerName = "Slac Jaw",
  killerFaction = 1, killedAt = 1795200100, mapID = 1434, flags = 3 }) do
  eq("K field " .. k, kill.fields[k], want)
end
eq("K flags without honor or pet", Codec.Decode(ns.BuildKillCode(7, VICTIM, 1, false, false)).fields.flags, 0)

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then os.exit(1) end
