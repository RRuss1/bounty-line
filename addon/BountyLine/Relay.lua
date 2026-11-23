-- Relay (spec 5.10): works with the optional relay program an officer runs on their PC.
--
--   Discord -> game  The program writes the newest Bounty Pack into its own addon folder
--                    (BountyLine_Relay, global BountyLine_RelayPack). It is loaded here at
--                    login or /reload and shared with the guild: nobody types /bl import.
--   Game -> Discord  When a guildie makes a bounty code, this client shows it as a QR code
--                    and takes a screenshot. The program reads the file and posts the bounty.
--                    Sightings of wanted players (from guild sync) go the same way, as one W
--                    code at most every 5 minutes, so the wanted posters show where they were.
--
-- The program can't talk to a running game, so the addon decides whether it's there from a
-- time stamp the program rewrites every minute (BountyLine_RelayAlive), read at load.
local _, ns = ...
local L = ns.L

local ALIVE_WINDOW = 600 -- seconds: how fresh the program's stamp must be at login
local SHOW_SECONDS = 1.2 -- how long each QR code stays up
local active = false
local carriesSightings = false -- the program is new enough to send sightings on
local queue, busy = {}, false
local handled = {}       -- code -> true: queued here, or already picked up by another relay
local SEEN_EVERY = 300   -- seconds between sighting reports
local SEEN_CHECK = 30    -- how often to look for sightings to send
local SEEN_MAX_CHARS = 170 -- longest sighting code: kill proofs this size read reliably
local sightings = {}     -- bounty id -> newest sighting not yet sent
local seenSentAt = -math.huge
local seenTicker

function ns.RelayActive() return active end

-- Called at login. alive / packText / now are passed in so this can be tested. sightings: the
-- program says it carries sightings (older ones would leave their screenshots lying around).
function ns.RelayStart(alive, packText, now, sightingsOk)
  local s = BountyLineDB.settings or {}
  active = false
  carriesSightings = sightingsOk == true
  if s.relay == false then return end
  alive = tonumber(alive)
  active = alive ~= nil and math.abs(now - alive) <= ALIVE_WINDOW
  if type(packText) == "string" and packText ~= "" then
    local pack = ns.ReadPack(packText)
    local version, tag = ns.PackVersion()
    -- Same rules as a pack from a guildie: this board only, and only if it's newer.
    if pack and (version == 0 or pack.boardTag == tag) and pack.packVersion > version then
      local ok, added = ns.StorePack(pack)
      if ok then
        ns.RefreshMarks()
        if ns.RefreshBoard then ns.RefreshBoard() end
        ns.Print(L.RELAY_PACK:format(#pack.bounties))
        for _, b in ipairs(added or {}) do ns.Banner(L.BANNER_NEW:format(b.targetName, ns.FormatGold(b.rewardGold), ns.BoardName())) end
        -- After the guild roster settles, hand it to everyone online.
        C_Timer.After(12, ns.Comms.SharePack)
      end
    end
  end
  if active then
    ns.Print(L.RELAY_ON)
    if not seenTicker and C_Timer.NewTicker then
      seenTicker = C_Timer.NewTicker(SEEN_CHECK, function() ns.RelayFlushSeen(GetTime(), GetServerTime()) end)
    end
  end
end

-- ---------------------------------------------------------------- QR frames for the program

local frame

-- Shows the code as a QR code where the proof stamp puts its own (lower left, under where the
-- band would be), so the program looks in one place for both. Replaced in tests.
function ns.RelayShow(code)
  if not frame then
    frame = ns.NewQR(UIParent)
    frame:SetFrameStrata("FULLSCREEN_DIALOG")
    frame:SetPoint("TOPLEFT", UIParent, "LEFT", 24, -97)
    frame.caption = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    frame.caption:SetPoint("TOP", frame, "BOTTOM", 0, -4)
    frame.caption:SetText(L.RELAY_CAPTION)
  end
  if not ns.DrawQR(frame, code) then return false end
  -- Give it a frame to draw, then take the shot.
  C_Timer.After(0.2, function() pcall(Screenshot) end)
  return true
end

function ns.RelayHide()
  if frame then frame:Hide() end
end

local function pump()
  if busy or #queue == 0 then return end
  -- A kill's proof stamp comes first: its screenshot must not carry a second QR code.
  if ns.KillBusy and ns.KillBusy() then
    C_Timer.After(2, pump)
    return
  end
  busy = true
  ns.RelayShow(table.remove(queue, 1))
  C_Timer.After(SHOW_SECONDS, function()
    ns.RelayHide()
    busy = false
    C_Timer.After(0.5, pump)
  end)
end

-- Queues a bounty code for the program. Returns true if this client took it.
function ns.RelayQueue(code)
  if not active or handled[code] then return false end
  handled[code] = true
  queue[#queue + 1] = code
  pump()
  return true
end

-- ---------------------------------------------------------------- sightings for the program

-- A wanted player was seen (by you or a guildie): keep the newest per bounty for the next report.
function ns.RelayNoteSeen(id, mapID, t, by)
  if not active or not carriesSightings or not id or id == 0 or not t then return end
  local cur = sightings[id]
  if cur and cur.seenAt >= t then return end
  mapID = tonumber(mapID) or 0
  if mapID < 0 or mapID > 65535 then mapID = 0 end
  sightings[id] = { bountyId = id, mapID = mapID, seenAt = t, spotterName = by or "" }
end

-- The newest sightings as one W code, as many as fit in a QR code that reads reliably. The
-- ones in the code are taken off the list; the rest wait for the next report.
function ns.SightingCode(now)
  local list = {}
  for _, s in pairs(sightings) do list[#list + 1] = s end
  if #list == 0 then return nil end
  table.sort(list, function(a, b)
    if a.seenAt ~= b.seenAt then return a.seenAt > b.seenAt end
    return a.bountyId < b.bountyId
  end)
  local _, tag = ns.PackVersion()
  local fields = { schema = 1, boardTag = tag, sentAt = now, nonce = math.random(0, 65535), sightings = {} }
  local code
  for _, s in ipairs(list) do
    if #fields.sightings >= ns.Codec.MAX_SIGHTINGS then break end
    fields.sightings[#fields.sightings + 1] = s
    local c = ns.Codec.Encode("W", fields)
    if not c or (code and #c > SEEN_MAX_CHARS) then
      fields.sightings[#fields.sightings] = nil
      if not c then sightings[s.bountyId] = nil end -- can't be written: drop it, don't retry forever
      break
    end
    code = c
  end
  if code then
    for _, s in ipairs(fields.sightings) do sightings[s.bountyId] = nil end
  end
  return code
end

-- Sends the waiting sightings, at most every SEEN_EVERY seconds and never in combat.
function ns.RelayFlushSeen(t, now)
  if not active or next(sightings) == nil then return false end
  if t - seenSentAt < SEEN_EVERY then return false end
  if InCombatLockdown and InCombatLockdown() then return false end
  local code = ns.SightingCode(now)
  if not code then return false end
  seenSentAt = t
  return ns.RelayQueue(code)
end

-- Another relay officer picked this code up: leave it to them.
function ns.RelayHandled(code)
  handled[code] = true
  for i = #queue, 1, -1 do
    if queue[i] == code then table.remove(queue, i) end
  end
end
