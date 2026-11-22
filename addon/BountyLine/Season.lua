-- Open Season (spec 5.11): a bounty on every member of an enemy guild.
--
-- A kill event names its victim only by GUID, and a GUID doesn't say what guild a player is
-- in. So the addon remembers the guild of every enemy player it sees (nameplate, target,
-- mouseover) and looks the victim up when a kill lands. Open seasons arrive in the Bounty
-- Pack, keyed by guild name.
local _, ns = ...
local L = ns.L

local DAY = 86400
local MEMORY_TTL = 14 * DAY
local MAX_MEMORY = 3000
local FACTION_ID = { Alliance = 1, Horde = 2 }

ns.SEASON_KIND = { pot = 1, pool = 2, open = 3 }
ns.SEASON_DAYS = { 7, 14, 28 }

-- Guild names are matched without case or outer spaces.
function ns.GuildKey(name)
  if type(name) ~= "string" then return "" end
  return (name:lower():gsub("^%s+", ""):gsub("%s+$", ""))
end

-- ---------------------------------------------------------------- memory of enemy players

-- Notes an enemy player's name and guild. Anything the game hides (secret values) is skipped.
function ns.RememberUnit(unit)
  if not unit then return nil end
  local exists = UnitExists(unit)
  if ns.IsSecret(exists) or not exists then return nil end
  local isPlayer = UnitIsPlayer(unit)
  if ns.IsSecret(isPlayer) or not isPlayer then return nil end
  local guid, theirs, mine = UnitGUID(unit), UnitFactionGroup(unit), UnitFactionGroup("player")
  if not guid or ns.IsSecret(guid) or ns.IsSecret(theirs) or ns.IsSecret(mine) then return nil end
  if not FACTION_ID[theirs] or theirs == mine then return nil end -- enemies only
  local guild = GetGuildInfo and GetGuildInfo(unit) or nil
  if ns.IsSecret(guild) then return nil end
  local db = BountyLineDB
  db.guilds = db.guilds or {}
  local entry = { n = ns.FullName(unit) or "", g = guild or "", f = FACTION_ID[theirs], t = GetServerTime() }
  db.guilds[guid] = entry
  return entry
end

-- What we remember about an enemy player: { n = name, g = guild ("" = none), f = faction, t }.
function ns.GuildOf(guid)
  if type(guid) ~= "string" or ns.IsSecret(guid) then return nil end
  local e = BountyLineDB and BountyLineDB.guilds and BountyLineDB.guilds[guid]
  if e and GetServerTime() - e.t <= MEMORY_TTL then return e end
  return nil
end

-- At login: drop players not seen for two weeks; if the list is still huge, keep the last two days.
function ns.PruneGuilds()
  local guilds = BountyLineDB.guilds
  if not guilds then return 0 end
  local now, n = GetServerTime(), 0
  for guid, e in pairs(guilds) do
    if now - (e.t or 0) > MEMORY_TTL then guilds[guid] = nil else n = n + 1 end
  end
  if n > MAX_MEMORY then
    n = 0
    for guid, e in pairs(guilds) do
      if now - e.t > 2 * DAY then guilds[guid] = nil else n = n + 1 end
    end
  end
  return n
end

-- ---------------------------------------------------------------- seasons

-- Pack entries -> the stored form, keyed by guild (Pack.lua StorePack).
function ns.SeasonsFromPack(list, now)
  local out, count = {}, 0
  for _, s in ipairs(list or {}) do
    if s.expiresAt > now then
      out[ns.GuildKey(s.guildName)] = {
        id = s.seasonId, guild = s.guildName, faction = s.guildFaction, kind = s.kind, perKill = s.perKillGold,
        remaining = s.remainingGold, poster = s.posterName, expires = s.expiresAt,
      }
      count = count + 1
    end
  end
  return out, count
end

local function live(s, now)
  return s ~= nil and s.expires > now and not (s.kind == ns.SEASON_KIND.pot and (s.remaining or 0) <= 0)
end

-- The open season on this guild, if any: from the pack, or one a guildie just declared.
function ns.GetSeason(guildName)
  local key = ns.GuildKey(guildName)
  if key == "" or not BountyLineDB then return nil end
  local now = GetServerTime()
  local pack = BountyLineDB.pack
  local s = pack and pack.seasons and pack.seasons[key]
  if live(s, now) then return s end
  local p = BountyLineDB.pendingSeasons and BountyLineDB.pendingSeasons[key]
  if live(p, now) then return p end
  return nil
end

-- Open seasons for the board, soonest to end first.
function ns.ListSeasons()
  local out, seen, now = {}, {}, GetServerTime()
  local pack = BountyLineDB.pack
  for key, s in pairs(pack and pack.seasons or {}) do
    if live(s, now) then
      out[#out + 1] = s
      seen[key] = true
    end
  end
  for key, s in pairs(BountyLineDB.pendingSeasons or {}) do
    if live(s, now) and not seen[key] then out[#out + 1] = s end
  end
  table.sort(out, function(a, b) return a.expires < b.expires end)
  return out
end

-- "25g a head", "10,000g prize pool"
function ns.SeasonTerms(s)
  if s.kind == ns.SEASON_KIND.pool then return L.SEASON_POOL:format(ns.FormatGold(s.remaining or 0)) end
  if (s.perKill or 0) <= 0 then return L.SEASON_NAME end
  return L.SEASON_PER_HEAD:format(ns.FormatGold(s.perKill))
end

-- "Open Season #7", or "new Open Season" before the Bounty Board has numbered it.
function ns.SeasonLabel(s)
  if not s or (s.id or 0) == 0 then return L.SEASON_PENDING end
  return L.SEASON_LABEL:format(s.id)
end

-- The season a remembered enemy player falls under, and what we remember about them.
function ns.SeasonOf(guid)
  local e = ns.GuildOf(guid)
  if not e or e.g == "" then return nil, e end
  local s = ns.GetSeason(e.g)
  if s and s.faction == e.f then return s, e end
  return nil, e
end

-- ---------------------------------------------------------------- once per day per victim

local function today(t) return math.floor((t or GetServerTime()) / DAY) end

function ns.MarkSeasonKill(guid, t)
  local kills = BountyLineCharDB.seasonKills or {}
  BountyLineCharDB.seasonKills = kills
  local day = today(t)
  for g, d in pairs(kills) do
    if d < day then kills[g] = nil end
  end
  kills[guid] = day
end

function ns.SeasonClaimedToday(guid)
  local kills = BountyLineCharDB and BountyLineCharDB.seasonKills
  return kills ~= nil and kills[guid] == today()
end

-- ---------------------------------------------------------------- does this kill count?

-- Returns season, seen, victimName when your killing blow on this GUID counts for an Open
-- Season; otherwise nil and a reason. seen = false means a season is open but we never saw
-- this player's guild: the claim is still made and the officers decide (season.id is 0).
function ns.SeasonForKill(victimGUID)
  if type(victimGUID) ~= "string" or ns.IsSecret(victimGUID) or victimGUID:sub(1, 7) ~= "Player-" then return nil, "NOT_PLAYER" end
  if ns.SeasonClaimedToday(victimGUID) then return nil, "DAILY" end
  local s, e = ns.SeasonOf(victimGUID)
  if s then
    if s.poster ~= nil and s.poster ~= "" and s.poster == ns.FullName("player") then return nil, "OWN" end
    return s, true, e.n
  end
  if e then return nil, "NO_SEASON" end -- we know their guild, and it isn't under a season
  local mine = FACTION_ID[UnitFactionGroup("player")]
  for _, open in ipairs(ns.ListSeasons()) do
    if open.faction ~= mine and open.poster ~= ns.FullName("player") then
      return { id = 0, unknown = true, kind = 0, perKill = 0, remaining = 0 }, false, nil
    end
  end
  return nil, "NO_SEASON"
end

-- ---------------------------------------------------------------- declaring one

local PENDING_TTL = 48 * 3600
local MAX_PENDING = 20

-- A season someone just made a code for, before any pack lists it (like pending bounties):
-- shared over guild sync so everyone can hunt that guild at once. It has no number yet.
function ns.AddPendingSeason(guild, faction, kind, perKill, total, poster, t)
  local key = ns.GuildKey(guild)
  if key == "" or ns.GetSeason(guild) then return false end
  if faction ~= 1 and faction ~= 2 or faction == FACTION_ID[UnitFactionGroup("player")] then return false end
  if kind ~= 1 and kind ~= 2 and kind ~= 3 then return false end
  local db = BountyLineDB
  db.pendingSeasons = db.pendingSeasons or {}
  local n, now = 0, GetServerTime()
  for k, p in pairs(db.pendingSeasons) do
    if p.expires <= now then db.pendingSeasons[k] = nil else n = n + 1 end
  end
  if n >= MAX_PENDING then return false end
  db.pendingSeasons[key] = {
    id = 0, pending = true, guild = guild, faction = faction, kind = kind, perKill = perKill or 0, remaining = total or 0,
    poster = poster, expires = t + PENDING_TTL,
  }
  return true
end

-- existingId: add gold to that season (Compendium 02 Section 3.5, mode 1): only the amount travels.
function ns.BuildSeasonCode(snap, kind, perKill, total, days, existingId)
  return ns.Codec.Encode("S", {
    schema = 1,
    boardTag = ns.BoardTag(),
    guildName = snap.guild or "",
    guildFaction = snap.faction,
    posterFaction = FACTION_ID[UnitFactionGroup("player")],
    kind = existingId and 0 or kind,
    perKillGold = existingId and 0 or perKill,
    totalGold = total,
    days = existingId and 0 or days,
    posterGUID = UnitGUID("player"),
    posterName = ns.FullName("player"),
    createdAt = GetServerTime(),
    nonce = math.random(0, 65535),
    mode = existingId and 1 or 0,
    existingSeasonId = existingId or 0,
  })
end

-- Shows the S code for an Open Season on the snapshot's guild (or for gold added to one).
function ns.PostSeason(snap, kind, perKill, total, days, existingId)
  local code, err, message = ns.BuildSeasonCode(snap, kind, perKill, total, days, existingId)
  if not code then return ns.Print(L.CODE_FAILED:format(message or err)) end
  ns.Sound(existingId and "stack" or "create")
  local terms = existingId and ns.FormatGold(total) or ns.SeasonTerms({ kind = kind, perKill = perKill, remaining = total })
  if not existingId then
    -- Guildies get a banner and can hunt that guild straight away, before any pack lists it.
    local me, now = ns.FullName("player"), GetServerTime()
    if ns.AddPendingSeason(snap.guild, snap.faction, kind, perKill, total, me, now) then
      ns.Comms.Season(snap.guild, snap.faction, kind, perKill, total, me, now)
      ns.RefreshMarks()
      if ns.RefreshBoard then ns.RefreshBoard() end
    end
  end
  -- Relay (spec 5.10), as for bounty codes.
  local relayed = ns.RelayQueue and ns.RelayQueue(code)
  if not relayed then ns.Comms.BountyCode(code) end
  ns.ShowCode({
    title = existingId and L.STACK_READY or L.SEASON_READY,
    subtitle = ("<%s> · %s%s"):format(snap.guild, existingId and "+" or "", terms),
    instructions = L.POST_THIS,
    note = relayed and L.RELAYED_SELF or nil,
    code = code,
    line = { existingId and "G" or "S", snap.guild, terms },
  })
end

-- /bl seasons
function ns.PrintSeasons()
  local list = ns.ListSeasons()
  if #list == 0 then return ns.Print(L.SEASONS_NONE) end
  ns.Print(L.SEASONS_HEAD)
  for _, s in ipairs(list) do
    local days = math.max(1, math.ceil((s.expires - GetServerTime()) / DAY))
    DEFAULT_CHAT_FRAME:AddMessage(L.SEASONS_LINE:format(s.guild, ns.SeasonTerms(s), ns.SeasonLabel(s), s.pending and "?" or tostring(days)))
  end
end
