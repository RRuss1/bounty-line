-- The Bounty Pack (spec 5.5): the list of open bounties, pasted from the pinned message in
-- #bounty-line with /bl import, or received from a guildie (Comms.lua). Stored account-wide
-- and looked up by target GUID.
local _, ns = ...

-- ---------------------------------------------------------------- addon version

-- The installed version, as the release wrote it into the TOC ("v0.8.0-beta2"). A copy run
-- straight from the source has no real version; then this returns nil.
function ns.AddonVersion()
  local get = C_AddOns and C_AddOns.GetAddOnMetadata
  local v = get and get("BountyLine", "Version")
  if v and ns.ParseVersion(v) then return v end
  return nil
end

-- "v0.8.0", "0.8.0-beta2", "v0.8.0-beta2-3-gabc123" -> a number that sorts by release order
-- (alpha < beta < release). nil if it isn't a version.
function ns.ParseVersion(text)
  if type(text) ~= "string" or #text > 40 then return nil end
  local major, minor, patch, rest = text:match("^v?(%d+)%.(%d+)%.(%d+)(.*)$")
  if not major then return nil end
  local stage = 999
  local beta, alpha = rest:match("^%-beta(%d*)"), rest:match("^%-alpha(%d*)")
  if beta then
    stage = 500 + (tonumber(beta) or 0)
  elseif alpha then
    stage = tonumber(alpha) or 0
  end
  return ((tonumber(major) * 1000 + tonumber(minor)) * 1000 + tonumber(patch)) * 1000 + stage
end

-- major*1000 + minor, for the pack's minAddonVersion. FALLBACK is for source copies.
local FALLBACK_VERSION_CODE = 8
function ns.AddonVersionCode()
  local key = ns.ParseVersion(ns.AddonVersion() or "")
  return key and math.floor(key / 1000000) or FALLBACK_VERSION_CODE
end

-- A pack's version is the time the bot made it. One dated further ahead than this is forged
-- or broken: accepting it would block every real pack ("newest wins").
local MAX_FUTURE = 600

-- Players copy the whole pinned message or just the code block; keep only the codes.
function ns.ExtractPackCodes(text)
  local codes = {}
  for code in (text or ""):gsub("`", ""):gmatch("[Bb][Ll]1%-[Pp]%-[%w%-]+") do codes[#codes + 1] = code end
  return table.concat(codes, "\n"), #codes
end

-- Returns the decoded pack, or nil, errorCode, message, received, total (multi-part progress).
function ns.ReadPack(text)
  local codes, n = ns.ExtractPackCodes(text)
  if n == 0 then return nil, "EMPTY" end
  local r, err, message, received, total = ns.Codec.DecodePack(codes)
  if not r then return nil, err, message, received, total end
  r.fields.codes = codes -- the original code text, so guild sync can pass it on unchanged
  return r.fields
end

-- The stored pack's version and board tag. A stored pack dated in the future counts as none,
-- so a real one can replace it.
function ns.PackVersion()
  local pack = BountyLineDB.pack
  if not pack or (pack.version or 0) > GetServerTime() + MAX_FUTURE then return 0, pack and pack.boardTag or "0000" end
  return pack.version or 0, pack.boardTag or "0000"
end

-- Saves a decoded pack. Returns true and the bounties that weren't in the old pack (for
-- banners), or false and "OLDER" (the saved one is newer) / "FUTURE" (dated ahead of now).
function ns.StorePack(p)
  local db = BountyLineDB
  local now = GetServerTime()
  if p.packVersion > now + MAX_FUTURE then return false, "FUTURE" end
  local cur = db.pack
  if cur and cur.boardTag == p.boardTag and ns.PackVersion() > p.packVersion then return false, "OLDER" end
  local old = cur and cur.bounties or {}
  local added, bounties, ids, count = {}, {}, {}, 0
  -- Bounty terms (pack schema 3, spec 5.4c), by bounty number. Older packs have none.
  local terms = {}
  for _, t in ipairs(p.bountyTerms or {}) do terms[t.bountyId] = t end
  for _, b in ipairs(p.bounties) do
    if b.expiresAt > now then
      if cur and not old[b.targetGUID] then added[#added + 1] = b end
      bounties[b.targetGUID] = {
        id = b.bountyId, name = b.targetName, classID = b.targetClassID, faction = b.targetFaction,
        reward = b.rewardGold, poster = b.posterName, expires = b.expiresAt,
      }
      local t = terms[b.bountyId]
      if t then
        local e = bounties[b.targetGUID]
        e.kills, e.killsLeft, e.payout, e.terms = t.kills, t.killsLeft, t.payout, t.terms
      end
      ids[b.bountyId] = true
      count = count + 1
    end
  end
  -- Bounties set by name in Discord (pack schema 4, spec 5.12), keyed by name; the ones this
  -- account already locked to a player go in with the others, under their GUID.
  local wanted, oldWanted, wantedIds = {}, cur and cur.wanted or {}, {}
  for _, w in ipairs(p.wanted or {}) do
    if w.expiresAt > now then
      local key = ns.NameKey(w.targetName)
      if cur and not oldWanted[key] then added[#added + 1] = w end
      wanted[key] = {
        id = w.bountyId, name = w.targetName, faction = w.targetFaction, reward = w.rewardGold,
        poster = w.posterName, expires = w.expiresAt, byName = true,
      }
      wantedIds[w.bountyId] = wanted[key]
      ids[w.bountyId] = true
      count = count + 1
    end
  end
  db.wantedLocks = db.wantedLocks or {}
  for id, lock in pairs(db.wantedLocks) do
    local w = wantedIds[id]
    if not w then
      db.wantedLocks[id] = nil -- gone, or the Bounty Board locked it and the pack lists it by GUID
    elseif not bounties[lock.guid] then
      bounties[lock.guid] = ns.LockedCopy(w, lock.classID, lock.name)
    end
  end
  -- Open seasons (pack schema 2), keyed by guild. Older packs have none.
  local seasons, seasonCount = ns.SeasonsFromPack(p.seasons, now)
  db.pack = {
    version = p.packVersion, boardTag = p.boardTag, discordName = p.discordDisplayName,
    rewardMin = p.rewardMin, rewardMax = p.rewardMax, minAddon = p.minAddonVersion,
    bounties = bounties, count = count, codes = p.codes, seasons = seasons, seasonCount = seasonCount,
    wanted = wanted,
  }
  -- Seasons a guildie just declared that the pack now lists, or that timed out.
  for key, pend in pairs(db.pendingSeasons or {}) do
    if seasons[key] or pend.expires <= now then db.pendingSeasons[key] = nil end
  end
  db.boardTag = p.boardTag
  db.discordName = p.discordDisplayName
  -- Housekeeping: forget sightings of bounties that are gone, and "claimed" marks the bot has
  -- caught up with (a pack made after the kill either dropped the bounty or reopened it).
  db.lastSeen, db.claimed = db.lastSeen or {}, db.claimed or {}
  for id in pairs(db.lastSeen) do
    if not ids[id] then db.lastSeen[id] = nil end
  end
  for id, t in pairs(db.claimed) do
    if not ids[id] or t < p.packVersion then db.claimed[id] = nil end
  end
  -- Pending bounties the pack now lists (they have a number) or that timed out.
  for guid, pend in pairs(db.pending or {}) do
    if bounties[guid] or pend.expires <= now then db.pending[guid] = nil end
  end
  return true, added
end

function ns.PackOutdated()
  local pack = BountyLineDB.pack
  return pack ~= nil and (pack.minAddon or 0) > ns.AddonVersionCode()
end

-- A kill on this bounty was just claimed (by you or a guildie): stop hunting it until the
-- next pack says otherwise.
function ns.MarkClaimed(id, t)
  BountyLineDB.claimed = BountyLineDB.claimed or {}
  BountyLineDB.claimed[id] = t or GetServerTime()
end

function ns.IsClaimed(id)
  local claimed = BountyLineDB.claimed
  return claimed ~= nil and claimed[id] ~= nil
end

-- ---------------------------------------------------------------- pending bounties
--
-- A bounty a guildie just made a code for, before any pack lists it (the pack only reaches
-- the game when someone imports it). Shared over guild sync so everyone can hunt it at once.
-- It has no bounty number yet (id 0): a kill on it makes a K code with bountyId 0, and the
-- Bounty Board finds the bounty by the victim (Compendium 02 Section 3.2).

local PENDING_TTL = 48 * 3600
local MAX_PENDING = 50

function ns.AddPending(guid, name, classID, faction, reward, poster, t)
  if type(guid) ~= "string" or guid == "" or ns.GetBounty(guid) then return false end
  local db = BountyLineDB
  db.pending = db.pending or {}
  local n = 0
  for _ in pairs(db.pending) do n = n + 1 end
  if n >= MAX_PENDING then return false end
  db.pending[guid] = {
    id = 0, pending = true, name = name, classID = classID, faction = faction, reward = reward, poster = poster,
    t = t, expires = t + PENDING_TTL,
  }
  return true
end

function ns.DropPending(guid)
  if BountyLineDB.pending then BountyLineDB.pending[guid] = nil end
end

-- "Bounty #12", or "new bounty" for one that has no number yet.
function ns.BountyLabel(b)
  return b.pending and ns.L.BOUNTY_PENDING or ("Bounty #%d"):format(b.id)
end

-- The open bounty on this GUID, if any (expired and just-claimed ones don't count): from the
-- pack, or else a pending one.
function ns.GetBounty(guid)
  if not guid or ns.IsSecret(guid) then return nil end
  local now = GetServerTime()
  local pack = BountyLineDB and BountyLineDB.pack
  local b = pack and pack.bounties[guid]
  if b and b.expires > now and not ns.IsClaimed(b.id) then return b end
  local p = BountyLineDB and BountyLineDB.pending and BountyLineDB.pending[guid]
  if p and p.expires > now then return p end
  return nil
end

-- ---------------------------------------------------------------- bounties set by name (spec 5.12)
--
-- /bl wanted in Discord puts a bounty on a name, with no GUID; the pack lists those by name.
-- The first time this account sees an enemy of that name and faction (nameplate, target,
-- mouseover) or kills one, the bounty is locked to their GUID here, and from then on it is
-- marked and claimed like any other. The Bounty Board locks it when an officer approves a kill.

local FACTION_ID = { Alliance = 1, Horde = 2 }

-- "  Grimlok  ASHVEIL " -> "grimlok ashveil". The game's lower() only changes A-Z.
function ns.NameKey(name)
  if type(name) ~= "string" then return "" end
  local s = name:gsub("^%s+", ""):gsub("%s+$", ""):gsub("%s+", " ")
  return (s:lower())
end

-- The open bounty set on this name, if any.
function ns.WantedByName(name)
  local pack = BountyLineDB and BountyLineDB.pack
  local w = pack and pack.wanted and pack.wanted[ns.NameKey(name)]
  if w and w.expires > GetServerTime() and not ns.IsClaimed(w.id) then return w end
  return nil
end

-- The bounty, now on this player: their name as the game shows it, and their class if seen.
function ns.LockedCopy(w, classID, name)
  local b = {}
  for k, v in pairs(w) do b[k] = v end
  b.classID = classID or 0
  b.name = name or w.name
  return b
end

-- Locks a bounty set by name to this player. faction: theirs (1 or 2), or nil when it isn't
-- known (a kill: names are unique on the server, and the faction is checked as for any bounty).
function ns.LockWanted(guid, name, faction, classID)
  if type(guid) ~= "string" or ns.IsSecret(guid) or ns.IsSecret(name) then return nil end
  local w = ns.WantedByName(name)
  local db = BountyLineDB
  if not w or (faction and faction ~= w.faction) or db.pack.bounties[guid] then return nil end
  db.wantedLocks = db.wantedLocks or {}
  local old = db.wantedLocks[w.id]
  if old and db.pack.bounties[old.guid] and db.pack.bounties[old.guid].id == w.id then db.pack.bounties[old.guid] = nil end
  local b = ns.LockedCopy(w, classID, name)
  db.pack.bounties[guid] = b
  db.wantedLocks[w.id] = { guid = guid, classID = b.classID, name = name }
  ns.Print(ns.L.WANTED_LOCKED:format(name, w.id))
  return b
end

local function anyWanted()
  local pack = BountyLineDB and BountyLineDB.pack
  return pack ~= nil and pack.wanted ~= nil and next(pack.wanted) ~= nil
end

-- A player on screen: is a bounty by name about them? Enemy faction only.
function ns.LockUnit(unit)
  if not anyWanted() then return nil end
  local faction = UnitFactionGroup(unit)
  if ns.IsSecret(faction) or not FACTION_ID[faction] or faction == UnitFactionGroup("player") then return nil end
  local name = ns.FullName(unit)
  if not name then return nil end
  local _, _, classID = UnitClass(unit)
  if ns.IsSecret(classID) or type(classID) ~= "number" then classID = 0 end
  return ns.LockWanted(UnitGUID(unit), name, FACTION_ID[faction], classID)
end

-- A kill on a player this account never saw: the game still names them from the GUID
-- (first name and, on Forever, the surname where retail has the realm: spec 23 item 30).
function ns.LockVictim(guid)
  if not anyWanted() or not GetPlayerInfoByGUID or ns.IsSecret(guid) then return nil end
  local ok, _, _, _, _, _, first, surname = pcall(GetPlayerInfoByGUID, guid)
  if not ok or type(first) ~= "string" or ns.IsSecret(first) or first == "" then return nil end
  local name = first
  if type(surname) == "string" and not ns.IsSecret(surname) and surname ~= "" then name = first .. " " .. surname end
  return ns.LockWanted(guid, name, nil, 0)
end

local function pendingList()
  local out, now = {}, GetServerTime()
  for guid, p in pairs(BountyLineDB.pending or {}) do
    if p.expires > now and ns.GetBounty(guid) == p then out[#out + 1] = setmetatable({ guid = guid }, { __index = p }) end
  end
  return out
end

-- Bounties for the board, biggest reward first. Just-claimed ones are listed with claimed = true.
function ns.ListBounties()
  local list = pendingList()
  local pack = BountyLineDB.pack
  if not pack then return list end
  local now = GetServerTime()
  for guid, b in pairs(pack.bounties) do
    if b.expires > now then
      list[#list + 1] = setmetatable({ guid = guid, claimed = ns.IsClaimed(b.id) }, { __index = b })
    end
  end
  -- Bounties by name nobody here has seen yet (the locked ones are listed above, by GUID).
  local locks = BountyLineDB.wantedLocks or {}
  for _, w in pairs(pack.wanted or {}) do
    if w.expires > now and not locks[w.id] then
      list[#list + 1] = setmetatable({ claimed = ns.IsClaimed(w.id) }, { __index = w })
    end
  end
  table.sort(list, function(a, b) return a.reward > b.reward or (a.reward == b.reward and a.id < b.id) end)
  return list
end

function ns.BoardName()
  local name = BountyLineDB.discordName
  return (name and name ~= "") and (name .. " Bounty Board") or "Discord Bounty Board"
end

function ns.GetBountyById(id)
  local pack = BountyLineDB.pack
  if not pack then return nil end
  for _, b in pairs(pack.bounties) do
    if b.id == id then return b end
  end
  for _, w in pairs(pack.wanted or {}) do
    if w.id == id then return w end
  end
  return nil
end

-- Last sightings, from you or guildies (spec 5.6), keyed by bounty id. Newest wins.
-- by: who saw them. Returns true when this is the newest sighting.
function ns.RecordSeen(id, mapID, t, by)
  BountyLineDB.lastSeen = BountyLineDB.lastSeen or {}
  local seen = BountyLineDB.lastSeen
  local cur = seen[id]
  if cur and cur.t >= t then return false end
  seen[id] = { map = mapID, t = t, by = by }
  return true
end

function ns.LastSeen(id)
  return BountyLineDB.lastSeen and BountyLineDB.lastSeen[id]
end
