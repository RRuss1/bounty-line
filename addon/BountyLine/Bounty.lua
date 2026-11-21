-- Posting logic with no UI: unit snapshots, the opposite-faction gate, reward parsing,
-- and building B (bounty) and L (link) codes. WoW API calls only happen inside
-- functions, so addon/tests/logic.lua can stub them.
local _, ns = ...
local L = ns.L

local FACTION_ID = { Alliance = 1, Horde = 2 }
local DEFAULT_MIN, DEFAULT_MAX = 1, 10000
local NO_BOARD = "0000"

-- Midnight-era clients hide some unit data in combat as "secret values" (spec Section 23).
function ns.IsSecret(v)
  return issecretvalue ~= nil and v ~= nil and issecretvalue(v) == true
end

function ns.FormatGold(n)
  local s = BreakUpLargeNumbers and BreakUpLargeNumbers(n) or tostring(n)
  return s .. "g"
end

-- Reward limits come from the imported Bounty Pack (Phase 5); until then the defaults.
function ns.RewardLimits()
  local pack = BountyLineDB and BountyLineDB.pack
  if pack and pack.rewardMin and pack.rewardMax then return pack.rewardMin, pack.rewardMax end
  return DEFAULT_MIN, DEFAULT_MAX
end

function ns.BoardTag()
  return (BountyLineDB and BountyLineDB.boardTag) or NO_BOARD
end

-- "500", "500g", "1,000", "1k", "2.5k", " 750 G " -> whole gold.
-- Returns gold, or nil and "FORMAT" / "RANGE". Decimal math is done on digits, never floats.
function ns.ParseReward(text, min, max)
  if type(text) ~= "string" then return nil, "FORMAT" end
  local s = text:lower():gsub("[%s,]", ""):gsub("g$", "")
  local whole, frac, k = s:match("^(%d+)%.?(%d*)(k?)$")
  if not whole then return nil, "FORMAT" end
  local gold
  if k == "k" then
    if #frac > 3 and frac:sub(4):find("[1-9]") then return nil, "FORMAT" end
    gold = tonumber(whole) * 1000 + tonumber((frac .. "000"):sub(1, 3))
  else
    if frac ~= "" and frac:find("[1-9]") then return nil, "FORMAT" end
    if s:find("%.$") then return nil, "FORMAT" end
    gold = tonumber(whole)
  end
  if gold < min or gold > max then return nil, "RANGE" end
  return gold
end

function ns.RewardError(reason, min, max)
  if reason == "RANGE" then return L.REWARD_RANGE:format(ns.FormatGold(min), ns.FormatGold(max)) end
  return L.REWARD_FORMAT
end

-- "First Surname". Forever has no realms: UnitName's second return (the realm on retail) is
-- the surname (verified with /bl debug, spec Section 23 item 12).
function ns.FullName(unit)
  local first, surname = UnitName(unit)
  if first == nil or ns.IsSecret(first) then return nil end
  if surname and not ns.IsSecret(surname) and surname ~= "" then return first .. " " .. surname end
  return first
end

function ns.PlayerMapID()
  local id = C_Map and C_Map.GetBestMapForUnit and C_Map.GetBestMapForUnit("player")
  if type(id) ~= "number" or id < 0 or id > 65535 then return 0 end
  return id
end

function ns.ZoneName()
  local id = ns.PlayerMapID()
  local info = id ~= 0 and C_Map.GetMapInfo and C_Map.GetMapInfo(id)
  return info and info.name or nil
end

-- Reads everything a bounty needs from a unit, at the moment it's called (spec 5.4b: the
-- target is fixed when the box opens). Returns a snapshot, or nil and an L key.
function ns.SnapshotUnit(unit)
  if not unit or not UnitExists(unit) then return nil, "NO_TARGET" end
  local guid = UnitGUID(unit)
  local theirs, mine = UnitFactionGroup(unit), UnitFactionGroup("player")
  if ns.IsSecret(guid) or ns.IsSecret(theirs) then return nil, "SECRET" end
  if not UnitIsPlayer(unit) then return nil, "NOT_PLAYER" end
  if UnitIsUnit(unit, "player") then return nil, "SELF" end
  if not guid then return nil, "NO_TARGET" end
  if not FACTION_ID[theirs] or not FACTION_ID[mine] then return nil, "NEUTRAL" end
  if theirs == mine then return nil, "SAME_FACTION" end

  local name = ns.FullName(unit)
  if not name then return nil, "SECRET" end
  local className, _, classID = UnitClass(unit)
  local raceName, _, raceID = UnitRace(unit)
  local level = UnitLevel(unit)
  -- Enemies far above you report -1 ("??"); codes carry 0 for unknown.
  if type(level) ~= "number" or ns.IsSecret(level) or level < 1 or level > 255 then level = 0 end
  return {
    guid = guid,
    name = name,
    className = className,
    classID = classID or 0,
    raceName = raceName,
    raceID = raceID or 0,
    level = level,
    faction = FACTION_ID[theirs],
    factionName = theirs,
  }
end

-- "Grimlok Ashveil · Orc Warrior 42 · Horde"
function ns.Describe(snap)
  local level = snap.level > 0 and tostring(snap.level) or "??"
  return ("%s · %s %s %s · %s"):format(snap.name, snap.raceName or "?", snap.className or "?", level, snap.factionName)
end

local function nonce() return math.random(0, 65535) end

-- existingId: "Add to Bounty…" (stacks gold on that open bounty; Compendium 02 mode 1).
function ns.BuildBountyCode(snap, reward, note, existingId)
  local myFaction = FACTION_ID[UnitFactionGroup("player")]
  return ns.Codec.Encode("B", {
    schema = 1,
    boardTag = ns.BoardTag(),
    targetGUID = snap.guid,
    targetName = snap.name,
    targetClassID = snap.classID,
    targetRaceID = snap.raceID,
    targetLevel = snap.level,
    targetFaction = snap.faction,
    posterFaction = myFaction,
    rewardGold = reward,
    posterGUID = UnitGUID("player"),
    posterName = ns.FullName("player"),
    mapID = ns.PlayerMapID(),
    createdAt = GetServerTime(),
    nonce = nonce(),
    note = note or "",
    mode = existingId and 1 or 0,
    existingBountyId = existingId or 0,
  })
end

-- What the code box copies: a short readable line with the code in a Discord spoiler, so
-- #bounty-line shows "WANTED: Name · 500g" and a black bar instead of a wall of letters.
-- The bot finds the code inside the line.
-- WoW EditBoxes store a literal "|" as "||" and Ctrl+C copies one "|" per pair (verified on
-- Forever, spec 23 item 18), so Discord's "||spoiler||" needs four pipes here.
local SPOILER = "||||"
local COPY = {
  B = "WANTED: **%s** · %s " .. SPOILER .. "%s" .. SPOILER,
  K = "CLAIMED: **%s** · %s " .. SPOILER .. "%s" .. SPOILER,
  L = "LINK: **%s** " .. SPOILER .. "%s" .. SPOILER,
  A = "ADDED: **%s** · +%s " .. SPOILER .. "%s" .. SPOILER,
}
function ns.CopyLine(kind, name, detail, code)
  if kind == "L" then return COPY.L:format(name, code) end
  return COPY[kind]:format(name, detail, code)
end

-- The tidy label shown over the (invisible) code box in game: the line without the code.
local DISPLAY = { B = "WANTED: %s · %s", K = "CLAIMED: %s · %s", L = "LINK: %s", A = "ADDED: %s · +%s" }
function ns.DisplayLine(line)
  if not line then return "" end
  return DISPLAY[line[1]]:format(line[2], line[3]) .. "  "
end

function ns.BuildLinkCode()
  local faction = FACTION_ID[UnitFactionGroup("player")]
  if not faction then return nil, "NEUTRAL", L.LINK_NO_FACTION end
  return ns.Codec.Encode("L", {
    schema = 1,
    boardTag = ns.BoardTag(),
    charGUID = UnitGUID("player"),
    charName = ns.FullName("player"),
    faction = faction,
    guildName = (GetGuildInfo("player")) or "",
    createdAt = GetServerTime(),
    nonce = nonce(),
  })
end
