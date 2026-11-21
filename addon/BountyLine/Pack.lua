-- The Bounty Pack (spec 5.5): the list of open bounties, pasted from the pinned message in
-- #bounty-line with /bl import. Stored account-wide and looked up by target GUID.
-- Guild sync (sharing it over the addon channel) arrives in Phase 5.
local _, ns = ...

-- major*1000 + minor. Packs say which addon version they need (minAddonVersion).
ns.ADDON_VERSION_CODE = 4

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

-- Saves a decoded pack. Returns true and the bounties that weren't in the old pack (for
-- banners), or false and "OLDER" when the saved one is newer.
function ns.StorePack(p)
  local db = BountyLineDB
  local cur = db.pack
  if cur and cur.boardTag == p.boardTag and (cur.version or 0) > p.packVersion then return false, "OLDER" end
  local old = cur and cur.bounties or {}
  local added = {}
  local bounties = {}
  for _, b in ipairs(p.bounties) do
    if cur and not old[b.targetGUID] then added[#added + 1] = b end
    bounties[b.targetGUID] = {
      id = b.bountyId, name = b.targetName, classID = b.targetClassID, faction = b.targetFaction,
      reward = b.rewardGold, poster = b.posterName, expires = b.expiresAt,
    }
  end
  db.pack = {
    version = p.packVersion, boardTag = p.boardTag, discordName = p.discordDisplayName,
    rewardMin = p.rewardMin, rewardMax = p.rewardMax, minAddon = p.minAddonVersion,
    bounties = bounties, count = #p.bounties, codes = p.codes,
  }
  db.boardTag = p.boardTag
  db.discordName = p.discordDisplayName
  return true, added
end

function ns.PackOutdated()
  local pack = BountyLineDB.pack
  return pack ~= nil and (pack.minAddon or 0) > ns.ADDON_VERSION_CODE
end

-- The open bounty on this GUID, if any (expired ones don't count).
function ns.GetBounty(guid)
  if not guid or ns.IsSecret(guid) then return nil end
  local pack = BountyLineDB and BountyLineDB.pack
  local b = pack and pack.bounties[guid]
  if b and b.expires > GetServerTime() then return b end
  return nil
end

-- Open bounties, biggest reward first.
function ns.ListBounties()
  local list = {}
  local pack = BountyLineDB.pack
  if not pack then return list end
  local now = GetServerTime()
  for guid, b in pairs(pack.bounties) do
    if b.expires > now then list[#list + 1] = setmetatable({ guid = guid }, { __index = b }) end
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
  local seen = BountyLineDB.lastSeen
  local cur = seen[id]
  if cur and cur.t >= t then return end
  seen[id] = { map = mapID, t = t }
end

function ns.LastSeen(id)
  return BountyLineDB.lastSeen[id]
end
