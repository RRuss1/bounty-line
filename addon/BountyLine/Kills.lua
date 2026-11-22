-- The kill (spec 5.7, 9.2): your killing blow (or your pet's) on a bounty target ->
-- proof stamp on screen -> Screenshot() -> kill code popup.
--
-- Kills come from PARTY_KILL (the combat log is closed on Forever). Guards: the victim must
-- be an open bounty, on the opposite faction, and never during or just after a duel.
-- CHAT_MSG_COMBAT_HONOR_GAIN naming the victim within ~2s sets the "honor" flag.
--
-- Kills are handled one at a time; more that land meanwhile wait in a queue. While you're
-- still in combat the code popup is held back (it would grab the keyboard mid-fight):
-- "BOUNTY KILLED" flashes, then a small logo square waits to be clicked after the fight
-- (UI/KillToast.lua).
local addonName, ns = ...
local L = ns.L

local FACTION_ID = { Alliance = 1, Horde = 2 }
local DUEL_GRACE = 10     -- seconds after a duel ends during which kills are ignored
local HONOR_WAIT = 1.2    -- seconds to wait for the honor message before taking the shot
local MAX_SAVED = 20

local duel = { active = false, endedAt = -math.huge }
local pending        -- the kill being processed (waiting for honor or its screenshot)
local waiting = {}   -- kills that landed while another was being processed
local deferred = {}  -- popups held back during combat, oldest first

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
-- season (Open Season kills only): { id, name, guild, seen } -> schema 2. The Bounty Board finds
-- the season by the guild, so a season declared moments ago (no number yet) still works.
function ns.BuildKillCode(bountyId, victimGUID, killedAt, honor, pet, season)
  return ns.Codec.Encode("K", {
    schema = season and 2 or 1,
    seasonId = season and season.id or nil,
    victimName = season and (season.name or "") or nil,
    guildName = season and (season.guild or "") or nil,
    guildSeen = season and (season.seen and 1 or 0) or nil,
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

-- "Grimlok · 500g · Bounty #12" for the stamp and the popup. Open Season kills name the
-- season instead, and a bounty target in a season guild gets both.
function ns.KillLine(k)
  local name, season = k.bounty.name, k.season
  if k.bounty.seasonOnly then
    if season.s.unknown then return ("%s · %s"):format(name, L.SEASON_UNSEEN) end
    return ("%s · %s · %s"):format(name, ns.SeasonTerms(season.s), ns.SeasonLabel(season.s))
  end
  local line = ("%s · %s · %s"):format(name, ns.FormatGold(k.bounty.reward), ns.BountyLabel(k.bounty))
  if season then line = line .. " + " .. ns.SeasonLabel(season.s) end
  return line
end

-- ---------------------------------------------------------------- capture

local begin

local function nextKill()
  pending = nil
  local k = table.remove(waiting, 1)
  if k then begin(k) end
end

local function popupAllowed()
  return not InCombatLockdown() or (BountyLineDB.settings or {}).killPopupInCombat == true
end

-- Shows the popup now, or holds it for the logo square (never grab the keyboard mid-fight).
local function present(popup)
  if popupAllowed() then return ns.ShowCode(popup) end
  BountyLineCharDB.lastPopup = popup -- /bl last and the minimap menu can open it too
  deferred[#deferred + 1] = popup
  ns.Print(L.KILL_DEFERRED)
  ns.ShowKillToast(#deferred)
end

function ns.DeferredKills() return #deferred end

-- True while a kill's stamp and screenshot are in progress (the relay waits its turn).
function ns.KillBusy() return pending ~= nil end

-- Click on the logo square: open the oldest waiting kill code, once the fight is over.
function ns.OpenDeferredKill()
  if #deferred == 0 then return ns.UpdateKillToast(0) end
  if not popupAllowed() then return ns.Print(L.KILL_WAIT) end
  local popup = table.remove(deferred, 1)
  ns.UpdateKillToast(#deferred)
  ns.Sound("codeReady")
  ns.ShowCode(popup)
end

local function finish(shot)
  local k = pending
  if not k or not k.code then return end
  -- The screenshot is taken; the stamp can stay up a moment longer if the player likes.
  local linger = (BountyLineDB.settings or {}).stampSeconds or 0
  if linger > 0 then C_Timer.After(linger, ns.HideStamp) else ns.HideStamp() end
  local seasonOnly = k.bounty.seasonOnly
  local label = seasonOnly and ns.SeasonLabel(k.season.s) or ns.BountyLabel(k.bounty)
  local popup = {
    title = k.practice and L.PRACTICE_TITLE or seasonOnly and L.SEASON_KILL_TITLE or L.KILL_TITLE,
    subtitle = ns.KillLine(k),
    instructions = k.practice and L.PRACTICE_POST or L.KILL_POST,
    code = k.code,
    line = not k.practice and { "K", k.bounty.name, label } or nil,
    note = shot and L.SCREENSHOT_SAVED or L.SCREENSHOT_FAILED,
    folder = true,
  }
  if not k.practice then
    -- Open Season: this player is done for today (once per day per hunter).
    if k.season then ns.MarkSeasonKill(k.victimGUID, k.killedAt) end
    -- Claimed: no more skull, and a second kill on them won't make a second code.
    -- (A season-only kill has no personal bounty to close.)
    if k.bounty.pending then
      ns.DropPending(k.victimGUID)
      ns.Comms.KillPending(k.victimGUID, ns.FullName("player"), k.bounty.name)
    elseif not seasonOnly then
      ns.MarkClaimed(k.bounty.id, k.killedAt)
      ns.Comms.Kill(k.bounty.id, ns.FullName("player"))
    end
    ns.RefreshMarks()
    ns.Sound("kill")
    if seasonOnly then
      ns.Banner(L.BANNER_SEASON_KILL:format(ns.FullName("player"), k.bounty.name, ns.BoardName()), false)
    else
      ns.Banner(L.BANNER_KILL:format(ns.FullName("player"), k.bounty.name, ns.BoardName()), false)
    end
    local kills = BountyLineCharDB.kills
    table.insert(kills, 1, {
      code = k.code, bountyId = k.bounty.id, name = k.bounty.name, reward = k.bounty.reward, t = k.killedAt, shot = shot,
    })
    while #kills > MAX_SAVED do table.remove(kills) end
  end
  present(popup)
  nextKill()
end

local function capture(k)
  local code, err, message = ns.BuildKillCode(k.bounty.id, k.victimGUID, k.killedAt, k.honor, k.pet, k.season)
  if not code then
    ns.Print(L.CODE_FAILED:format(message or err))
    return nextKill()
  end
  k.code = code
  -- The fallback is set first, so nothing below can leave the stamp stuck on screen: if no
  -- screenshot event comes within 5 seconds, the code is shown anyway.
  C_Timer.After(5, function() if pending == k then finish(false) end end)
  local drawn, drawError = pcall(ns.ShowStamp, k)
  if not drawn then ns.Print(L.AUTO_SHOT_FAILED:format(tostring(drawError))) end
  -- Give the stamp a frame to draw, then take the shot. Called from our own function: the
  -- timer may not accept the game's Screenshot directly (spec 23 item 24).
  C_Timer.After(0.15, function()
    local shot, shotError = pcall(Screenshot)
    if not shot then ns.Print(L.AUTO_SHOT_FAILED:format(tostring(shotError))) end
  end)
end

begin = function(k)
  pending = k
  C_Timer.After(k.practice and 0 or HONOR_WAIT, function() if pending == k then capture(k) end end)
end

-- season (optional): { id, name, seen, s = the season } from ns.SeasonForKill. With no personal
-- bounty on the victim, a stand-in carries their name through the stamp and the popup.
local function startKill(bounty, victimGUID, pet, practice, season)
  if not bounty and season then
    local name = season.name
    if not name or name == "" then name = L.SEASON_UNKNOWN_PLAYER end
    bounty = { id = 0, name = name, reward = season.s.perKill or 0, seasonOnly = true }
  end
  local k = {
    bounty = bounty, victimGUID = victimGUID, pet = pet, practice = practice, killedAt = GetServerTime(), honor = false,
    season = season,
  }
  if pending then
    waiting[#waiting + 1] = k
  else
    begin(k)
  end
end

-- /bl test: the whole flow on a pretend target, for checking screenshots and the stamp.
function ns.PracticeKill()
  local practice = { id = 0, name = L.PRACTICE_TARGET, reward = 1 }
  startKill(practice, UnitGUID("player"), false, true)
end

-- For the test suite only.
ns._kills = { start = startKill, finish = finish, pending = function() return pending end }

-- ---------------------------------------------------------------- events

local events = CreateFrame("Frame")
for _, e in ipairs({ "PARTY_KILL", "CHAT_MSG_COMBAT_HONOR_GAIN", "DUEL_REQUESTED", "DUEL_INBOUNDS", "DUEL_FINISHED",
  "SCREENSHOT_SUCCEEDED", "SCREENSHOT_FAILED", "ADDON_ACTION_BLOCKED", "ADDON_ACTION_FORBIDDEN" }) do
  events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event, a, b)
  local debug = BountyLineDB and BountyLineDB.settings and BountyLineDB.settings.debugKills
  if event == "PARTY_KILL" then
    if debug then ns.Print(L.DEBUGKILL:format(tostring(a), tostring(b))) end
    local bounty, how = ns.CheckKill(a, b, GetTime())
    if debug then ns.Print("  -> " .. tostring(bounty and ("bounty #" .. bounty.id) or how)) end
    -- Open Season (spec 5.11): my kill, no duel.
    local season
    if bounty or how == "NO_BOUNTY" then
      local s, seen, name, guild = ns.SeasonForKill(b)
      if debug then ns.Print("  -> season: " .. tostring(s and (s.unknown and "guild not seen" or s.guild) or seen)) end
      -- A normal bounty claim is never held up for a guild we didn't see.
      if s and (seen or not bounty) then season = { id = s.id, name = name, guild = guild, seen = seen, s = s } end
    end
    local petGUID = UnitGUID("pet")
    local pet = how == "PET" or (not ns.IsSecret(petGUID) and petGUID ~= nil and petGUID == a)
    if bounty or season then startKill(bounty, b, pet, false, season) end
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
  elseif a == addonName then
    -- The game refused something Bounty Line called (b names it). Say what, so it can be fixed.
    ns.Print(L.ACTION_BLOCKED:format(tostring(b)))
  elseif debug then
    -- Another addon was refused something; /bl debugkills shows which, to tell the two apart.
    ns.Print(("blocked action: %s / %s"):format(tostring(a), tostring(b)))
  end
end)
