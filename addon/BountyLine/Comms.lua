-- Guild sync (spec 5.8) over the GUILD addon channel.
--
-- Messages (type: payload):
--   HELLO  "<packVersion> <boardTag>"   on login: "here's how fresh my pack is"
--   PACK   the pack's code text         reply to an older HELLO, and after /bl import (chunked)
--   NEWB   "<name>\t<reward>\t<poster>" a guildie just made a bounty code (pending on Discord)
--   SEEN   "<bountyId>\t<mapID>\t<time>" a wanted player was spotted (1 per bounty per minute)
--   KILL   "<bountyId>\t<killer>"       a guildie collected a bounty
--   PEND   "<guid>\t<name>\t<classID>\t<faction>\t<reward>\t<poster>\t<time>"
--                                       a guildie made a bounty code: hunt it before any pack lists it
--   KILLP  "<guid>\t<killer>\t<name>"   a guildie collected a pending bounty
--
-- Self-contained instead of AceComm: messages over 240 bytes are chunked, sends are paced, and
-- anything the client refuses (addon comms are blocked during instance encounters) is retried
-- later. Only GUILD messages are accepted.
local _, ns = ...
local L = ns.L

local PREFIX = "BountyLine"
local CHUNK = 220          -- payload bytes per message (the limit is 255 with our header)
local PACE = 0.4           -- seconds between sends
local RETRY = 3            -- seconds before retrying a refused send
local SEEN_EVERY = 60      -- seconds between SEEN messages for one bounty
local BANNER_LIMIT = 3     -- banners (new bounty / kill) accepted per sender per minute

local Comms = {}
ns.Comms = Comms

-- A random id for this session, so we ignore our own messages (sender names on Forever are
-- "First" or "First-Surname", so they're not reliable for that).
local me = ("%06x"):format(math.random(0, 0xFFFFFF))
local msgSeq = 0

-- ---------------------------------------------------------------- wire format (pure, tested)

-- "<type>:<sender id>:<message id>:<part>/<total>:<data>". No "|" (WoW's escape character).
function Comms.Split(kind, data, sender, id)
  local parts = {}
  local total = math.max(1, math.ceil(#data / CHUNK))
  for i = 1, total do
    parts[i] = ("%s:%s:%d:%d/%d:%s"):format(kind, sender, id, i, total, data:sub((i - 1) * CHUNK + 1, i * CHUNK))
  end
  return parts
end

function Comms.Parse(text)
  local kind, sender, id, part, total, data = text:match("^(%u+):(%x+):(%d+):(%d+)/(%d+):(.*)$")
  if not kind then return nil end
  return { kind = kind, sender = sender, id = tonumber(id), part = tonumber(part), total = tonumber(total), data = data }
end

-- Collects chunks; returns the full data once every part of a message has arrived.
local inbox = {}
function Comms.Reassemble(msg, now)
  if msg.total == 1 then return msg.data end
  if msg.total > 64 or msg.part < 1 or msg.part > msg.total then return nil end
  local key = msg.sender .. ":" .. msg.id
  local box = inbox[key] or { parts = {}, n = 0, t = now }
  inbox[key] = box
  if not box.parts[msg.part] then
    box.parts[msg.part] = msg.data
    box.n = box.n + 1
  end
  for k, b in pairs(inbox) do
    if now - b.t > 120 then inbox[k] = nil end -- drop stale partial messages
  end
  if box.n < msg.total then return nil end
  inbox[key] = nil
  return table.concat(box.parts)
end

-- ---------------------------------------------------------------- sending

local queue = {}
local ticker

local function sent(result)
  -- Midnight-era clients return an Enum.SendAddonMessageResult (0 = success); older ones a boolean.
  return result == nil or result == true or result == 0
end

local function pump()
  local line = queue[1]
  if not line then
    if ticker then ticker:Cancel() ticker = nil end
    return
  end
  local ok, result = pcall(C_ChatInfo.SendAddonMessage, PREFIX, line, "GUILD")
  if ok and sent(result) then
    table.remove(queue, 1)
  else
    -- Refused (comms lockdown in an encounter, or throttled): wait and try again.
    if ticker then ticker:Cancel() end
    ticker = nil
    C_Timer.After(RETRY, function() if not ticker then ticker = C_Timer.NewTicker(PACE, pump) end end)
  end
end

function Comms.Send(kind, data)
  if not IsInGuild() then return end
  msgSeq = msgSeq + 1
  for _, line in ipairs(Comms.Split(kind, data, me, msgSeq)) do queue[#queue + 1] = line end
  if not ticker then ticker = C_Timer.NewTicker(PACE, pump) end
end

-- ---------------------------------------------------------------- the protocol

local packReply      -- pending C_Timer handle for answering an older HELLO
local seenSentAt = {} -- bounty id -> time we last sent SEEN

local function myPackVersion()
  return ns.PackVersion()
end

-- Stops one client (or a forged sender) flooding everyone's screen with banners.
local bannerTimes = {}
function Comms.AllowBanner(sender, now)
  local times = bannerTimes[sender] or {}
  bannerTimes[sender] = times
  while times[1] and now - times[1] >= 60 do table.remove(times, 1) end
  if #times >= BANNER_LIMIT then return false end
  times[#times + 1] = now
  return true
end

-- Guild rank index of a sender (0 = guild master), or nil if they aren't on the roster.
-- Roster names may be "First" or "First-Surname" on Forever (spec 23 item 19): match either.
function Comms.SenderRank(senderName)
  if not senderName or not GetNumGuildMembers then return nil end
  local short = senderName:match("^[^-]+")
  for i = 1, GetNumGuildMembers() do
    local name, _, rankIndex = GetGuildRosterInfo(i)
    if name and (name == senderName or name:match("^[^-]+") == short) then return rankIndex end
  end
  return nil
end

-- settings.packsFrom = "officers": only take packs from ranks up to settings.packMaxRank
-- (default 1: guild master and the next rank). Spec 5.8's optional trust rule.
function Comms.TrustsPackFrom(senderName)
  local s = BountyLineDB.settings or {}
  if s.packsFrom ~= "officers" then return true end
  local rank = Comms.SenderRank(senderName)
  return rank ~= nil and rank <= (s.packMaxRank or 1)
end

function Comms.Hello()
  local version, tag = myPackVersion()
  Comms.Send("HELLO", ("%d %s"):format(version, tag))
end

function Comms.SharePack()
  local pack = BountyLineDB.pack
  -- Parts travel space-separated: line breaks aren't safe in addon messages.
  if pack and pack.codes then Comms.Send("PACK", (pack.codes:gsub("%s+", " "))) end
end

function Comms.NewBounty(name, reward, poster)
  Comms.Send("NEWB", ("%s\t%d\t%s"):format(name, reward, poster or ""))
end

-- Share a just-made bounty so guildies can hunt it before the next pack (Pack.lua, pending).
function Comms.Pending(snap, reward, poster, t)
  Comms.Send("PEND", table.concat({ snap.guid, snap.name, snap.classID or 0, snap.faction, reward, poster or "", t }, "\t"))
end

function Comms.KillPending(guid, killer, name)
  Comms.Send("KILLP", ("%s\t%s\t%s"):format(guid, killer or "", name or ""))
end

function Comms.Kill(bountyId, killer)
  Comms.Send("KILL", ("%d\t%s"):format(bountyId, killer or ""))
end

-- A wanted player was spotted: remember it and tell the guild (at most once a minute each).
function Comms.Seen(bountyId, mapID, now)
  ns.RecordSeen(bountyId, mapID, now)
  if (BountyLineDB.settings or {}).shareSeen == false then return end
  local last = seenSentAt[bountyId]
  if last and GetTime() - last < SEEN_EVERY then return end
  seenSentAt[bountyId] = GetTime()
  Comms.Send("SEEN", ("%d\t%d\t%d"):format(bountyId, mapID or 0, now))
end

-- Should I answer this HELLO with my pack? Only with a strictly newer pack from the same board
-- (or any pack, when they have none yet).
function Comms.ShouldShare(theirVersion, theirTag)
  local version, tag = myPackVersion()
  if version == 0 then return false end
  if theirTag ~= "0000" and theirTag ~= tag then return false end
  return version > theirVersion
end

local handlers = {}

function handlers.HELLO(data)
  local version, tag = data:match("^(%d+) (%w+)$")
  if not version or not Comms.ShouldShare(tonumber(version), tag) then return end
  -- Wait a random moment so not everyone online answers at once; a PACK from someone else cancels it.
  if packReply then return end
  packReply = C_Timer.NewTimer(1 + math.random() * 4, function()
    packReply = nil
    Comms.SharePack()
  end)
end

function handlers.PACK(data, senderName)
  if not Comms.TrustsPackFrom(senderName) then return end
  local pack = ns.ReadPack(data)
  if not pack then return end
  local version, tag = myPackVersion()
  if version > 0 and pack.boardTag ~= tag then return end -- another guild's board
  if pack.packVersion >= version and packReply then
    packReply:Cancel()
    packReply = nil
  end
  if pack.packVersion <= version then return end
  local ok, added = ns.StorePack(pack)
  if not ok then return end
  ns.RefreshMarks()
  if ns.RefreshBoard then ns.RefreshBoard() end
  ns.Print(L.SYNCED:format(#pack.bounties))
  for _, b in ipairs(added or {}) do ns.Banner(L.BANNER_NEW:format(b.targetName, ns.FormatGold(b.rewardGold), ns.BoardName())) end
end

function handlers.NEWB(data, senderName, senderId)
  local name, reward, poster = data:match("^(.-)\t(%d+)\t(.*)$")
  if not name or not Comms.AllowBanner(senderId, GetTime()) then return end
  local who = poster ~= "" and poster or (senderName and senderName:match("^[^-]+")) or "?"
  ns.Banner(L.BANNER_PENDING:format(who, name, ns.FormatGold(tonumber(reward)), ns.BoardName()))
end

-- guid, name, classID, faction (1 or 2), reward, poster, time
local PEND_PATTERN = "^([^\t]+)\t([^\t]*)\t(%d+)\t([12])\t(%d+)\t([^\t]*)\t(%d+)$"

function handlers.PEND(data, _, senderId)
  local guid, name, classID, faction, reward, poster, t = data:match(PEND_PATTERN)
  if not guid or not Comms.AllowBanner("pend:" .. senderId, GetTime()) then return end
  -- Never trust a sender's clock for how long it lives.
  local at = math.min(tonumber(t), GetServerTime())
  if ns.AddPending(guid, name, tonumber(classID), tonumber(faction), tonumber(reward), poster, at) then
    ns.RefreshMarks()
    if ns.RefreshBoard then ns.RefreshBoard() end
  end
end

function handlers.KILLP(data, _, senderId)
  local guid, killer, name = data:match("^([^\t]+)\t([^\t]*)\t([^\t]*)$")
  if not guid then return end
  ns.DropPending(guid)
  ns.RefreshMarks()
  if ns.RefreshBoard then ns.RefreshBoard() end
  if not Comms.AllowBanner(senderId, GetTime()) then return end
  ns.Banner(L.BANNER_KILL:format(killer ~= "" and killer or "?", name ~= "" and name or "?", ns.BoardName()))
end

function handlers.SEEN(data)
  local id, mapID, t = data:match("^(%d+)\t(%d+)\t(%d+)$")
  if id then ns.RecordSeen(tonumber(id), tonumber(mapID), tonumber(t)) end
end

function handlers.KILL(data, _, senderId)
  local id, killer = data:match("^(%d+)\t(.*)$")
  if not id then return end
  local b = ns.GetBountyById(tonumber(id))
  -- Claimed: stop hunting it here too, until the next pack.
  if b then
    ns.MarkClaimed(tonumber(id), GetServerTime())
    ns.RefreshMarks()
    if ns.RefreshBoard then ns.RefreshBoard() end
  end
  if not Comms.AllowBanner(senderId, GetTime()) then return end
  ns.Banner(L.BANNER_KILL:format(killer ~= "" and killer or "?", b and b.name or ("bounty #" .. id), ns.BoardName()))
end

function Comms.Receive(text, channel, senderName)
  if channel ~= "GUILD" then return end -- trust rule: guild only
  local msg = Comms.Parse(text)
  if not msg or msg.sender == me or not handlers[msg.kind] then return end
  local data = Comms.Reassemble(msg, GetTime())
  if data then handlers[msg.kind](data, senderName, msg.sender) end
end

-- ---------------------------------------------------------------- events

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("CHAT_MSG_ADDON")
events:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  if event == "PLAYER_LOGIN" then
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
    C_Timer.After(8, Comms.Hello) -- after the guild roster settles
  elseif prefix == PREFIX then
    Comms.Receive(text, channel, sender)
  end
end)
