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
  for _, b in ipairs(p.bounties) do
    if b.expiresAt > now then
      if cur and not old[b.targetGUID] then added[#added + 1] = b end
      bounties[b.targetGUID] = {
        id = b.bountyId, name = b.targetName, classID = b.targetClassID, faction = b.targetFaction,
        reward = b.rewardGold, poster = b.posterName, expires = b.expiresAt,
      }
      ids[b.bountyId] = true
      count = count + 1
    end
  end
  db.pack = {
    version = p.packVersion, boardTag = p.boardTag, discordName = p.discordDisplayName,
    rewardMin = p.rewardMin, rewardMax = p.rewardMax, minAddon = p.minAddonVersion,
    bounties = bounties, count = count, codes = p.codes,
  }
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
  return nil
end

-- Last sightings, from you or guildies (spec 5.6), keyed by bounty id. Newest wins.
function ns.RecordSeen(id, mapID, t)
  BountyLineDB.lastSeen = BountyLineDB.lastSeen or {}
  local seen = BountyLineDB.lastSeen
  local cur = seen[id]
  if cur and cur.t >= t then return end
  seen[id] = { map = mapID, t = t }
end

function ns.LastSeen(id)
  return BountyLineDB.lastSeen and BountyLineDB.lastSeen[id]
end
