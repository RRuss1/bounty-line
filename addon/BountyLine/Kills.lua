-- The kill (spec 5.7, 9.2): your killing blow (or your pet's) on a bounty target ->
-- proof stamp on screen -> Screenshot() -> kill code popup.
--
-- Kills come from PARTY_KILL (the combat log is closed on Forever). Guards: the victim must
-- be an open bounty, on the opposite faction, and never during or just after a duel.
-- CHAT_MSG_COMBAT_HONOR_GAIN naming the victim within ~2s sets the "honor" flag.
local _, ns = ...
local L = ns.L

local FACTION_ID = { Alliance = 1, Horde = 2 }
local DUEL_GRACE = 10     -- seconds after a duel ends during which kills are ignored
local HONOR_WAIT = 1.2    -- seconds to wait for the honor message before taking the shot
local MAX_SAVED = 20

local duel = { active = false, endedAt = -math.huge }
local pending   -- kill waiting for its honor message or its screenshot

-- ---------------------------------------------------------------- rules (tested in addon/tests)

-- Returns the bounty if this PARTY_KILL counts, or nil and a reason.
function ns.CheckKill(attackerGUID, victimGUID, now)
  if ns.IsSecret(attackerGUID) or ns.IsSecret(victimGUID) then return nil, "SECRET" end
  local mine = attackerGUID ~= nil and attackerGUID == UnitGUID("player")
  local pet = attackerGUID ~= nil and not mine and attackerGUID == UnitGUID("pet")
  if not mine and not pet then return nil, "NOT_MINE" end
  if duel.active or (now - duel.endedAt) < DUEL_GRACE then return nil, "DUEL" end
  local b = ns.GetBounty(victimGUID)
  if not b then return nil, "NO_BOUNTY" end
  if b.faction == FACTION_ID[UnitFactionGroup("player")] then return nil, "SAME_FACTION" end
  return b, pet and "PET" or "MINE"
end

function ns.SetDuel(active, now)
  duel.active = active
  if not active then duel.endedAt = now end
end

-- flags: bit0 honor corroborated, bit1 pet kill (Compendium 02 Section 3.2).
function ns.BuildKillCode(bountyId, victimGUID, killedAt, honor, pet)
  return ns.Codec.Encode("K", {
    schema = 1,
    boardTag = ns.BoardTag(),
    bountyId = bountyId,
    victimGUID = victimGUID,
    killerGUID = UnitGUID("player"),
    killerName = ns.FullName("player"),
    killerFaction = FACTION_ID[UnitFactionGroup("player")],
    killedAt = killedAt,
    mapID = ns.PlayerMapID(),
    flags = (honor and 1 or 0) + (pet and 2 or 0),
    nonce = math.random(0, 65535),
  })
end

-- ---------------------------------------------------------------- capture

local function finish(shot)
  local k = pending
  if not k or not k.code then return end
  pending = nil
  ns.HideStamp()
  local popup = {
    title = k.practice and L.PRACTICE_TITLE or L.KILL_TITLE,
    subtitle = ("%s · %s · Bounty #%d"):format(k.bounty.name, ns.FormatGold(k.bounty.reward), k.bounty.id),
    instructions = k.practice and L.PRACTICE_POST or L.KILL_POST,
    code = k.code,
    line = not k.practice and { "K", k.bounty.name, ("Bounty #%d"):format(k.bounty.id) } or nil,
    note = shot and L.SCREENSHOT_SAVED or L.SCREENSHOT_FAILED,
  }
  ns.ShowCode(popup)
  if not k.practice then
    ns.Comms.Kill(k.bounty.id, ns.FullName("player"))
    ns.Banner(L.BANNER_KILL:format(ns.FullName("player"), k.bounty.name, ns.BoardName()))
    local kills = BountyLineCharDB.kills
    table.insert(kills, 1, { code = k.code, bountyId = k.bounty.id, t = k.killedAt, shot = shot })
    while #kills > MAX_SAVED do table.remove(kills) end
  end
end

local function capture(k)
  local code, err, message = ns.BuildKillCode(k.bounty.id, k.victimGUID, k.killedAt, k.honor, k.pet)
  if not code then
    pending = nil
    return ns.Print(L.CODE_FAILED:format(message or err))
  end
  k.code = code
  ns.ShowStamp(k)
  -- Give the stamp a frame to draw, then take the shot. Fall back if no screenshot event comes.
  C_Timer.After(0.15, Screenshot)
  C_Timer.After(5, function() if pending == k then finish(false) end end)
end

local function startKill(bounty, victimGUID, pet, practice)
  if pending then return end -- one at a time
  pending = { bounty = bounty, victimGUID = victimGUID, pet = pet, practice = practice, killedAt = GetServerTime(), honor = false }
  local k = pending
  C_Timer.After(practice and 0 or HONOR_WAIT, function() if pending == k then capture(k) end end)
end

-- /bl test: the whole flow on a pretend target, for checking screenshots and the stamp.
function ns.PracticeKill()
  local practice = { id = 0, name = L.PRACTICE_TARGET, reward = 1 }
  startKill(practice, UnitGUID("player"), false, true)
end

-- ---------------------------------------------------------------- events

local events = CreateFrame("Frame")
for _, e in ipairs({ "PARTY_KILL", "CHAT_MSG_COMBAT_HONOR_GAIN", "DUEL_REQUESTED", "DUEL_INBOUNDS", "DUEL_FINISHED",
  "SCREENSHOT_SUCCEEDED", "SCREENSHOT_FAILED" }) do
  events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event, a, b)
  local debug = BountyLineDB and BountyLineDB.settings and BountyLineDB.settings.debugKills
  if event == "PARTY_KILL" then
    if debug then ns.Print(L.DEBUGKILL:format(tostring(a), tostring(b))) end
    local bounty, how = ns.CheckKill(a, b, GetTime())
    if debug then ns.Print("  -> " .. tostring(bounty and ("bounty #" .. bounty.id) or how)) end
    if bounty then startKill(bounty, b, how == "PET", false) end
  elseif event == "CHAT_MSG_COMBAT_HONOR_GAIN" then
    if debug then ns.Print("honor: " .. tostring(a)) end
    local first = pending and pending.bounty.name and pending.bounty.name:match("^(%S+)")
    if first and type(a) == "string" and a:find(first, 1, true) then pending.honor = true end
  elseif event == "DUEL_REQUESTED" or event == "DUEL_INBOUNDS" then
    ns.SetDuel(true, GetTime())
  elseif event == "DUEL_FINISHED" then
    ns.SetDuel(false, GetTime())
  elseif event == "SCREENSHOT_SUCCEEDED" then
    finish(true)
  elseif event == "SCREENSHOT_FAILED" then
    finish(false)
  end
end)
