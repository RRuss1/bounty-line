-- Hunting (spec 5.6): bounty targets get a skull over their nameplate, a WANTED line in
-- their tooltip, and a raid-warning alert when you spot them. The alert repeats only after
-- you've lost sight of them for a while (settings.realertMinutes), not while you're fighting.
-- GUIDs hidden as secret values (combat) are skipped, never guessed.
local _, ns = ...
local L = ns.L

local SKULL = "Interface\\TargetingFrame\\UI-RaidTargetingIcon_8"
local DEFAULT_REALERT = 10 -- minutes
local marks = {}     -- nameplate frame -> skull texture
local badge          -- WANTED badge above the target frame

local function setting(key)
  local s = BountyLineDB.settings or {}
  return s[key] ~= false
end
local lastSight = {} -- bounty id -> GetTime() of the latest sighting

-- Bounties are open world only, so nobody is marked or announced in battlegrounds, arenas or
-- dungeons: no skull, badge, tooltip line, alert or last-seen report there.
local function wanted(unit)
  if not unit or not ns.InOpenWorld() or not UnitIsPlayer(unit) then return nil end
  return ns.GetBounty(UnitGUID(unit))
end

-- Open Season (spec 5.11): notes the unit's guild, and returns the season its guild is under
-- (and what we know of the player), unless you already collected on them today.
local function inSeason(unit)
  if not unit then return nil end
  local e = ns.RememberUnit(unit) -- guilds are still learned inside instances
  if not e or not ns.InOpenWorld() then return nil end
  local guid = UnitGUID(unit)
  if ns.IsSecret(guid) or ns.SeasonClaimedToday(guid) then return nil end
  local s = ns.SeasonOf(guid)
  if s and s.poster == ns.FullName("player") then return nil end -- your own season: you can't collect
  return s, e
end

-- One alert per season per gap, however many of that guild are around.
local function seasonAlert(s, e)
  if not ns.ShouldAlert("season:" .. ns.GuildKey(s.guild), GetTime()) then return end
  if not setting("sightAlert") then return end
  local text = L.SPOTTED_SEASON:format(e.n ~= "" and e.n or L.SEASON_UNKNOWN_PLAYER, s.guild, ns.SeasonTerms(s))
  if RaidNotice_AddMessage and RaidWarningFrame then
    RaidNotice_AddMessage(RaidWarningFrame, text, ChatTypeInfo.RAID_WARNING)
  end
  ns.Sound("sighting")
  ns.Print(text)
end

-- True when this sighting deserves an alert: the first one, or the first after a gap.
function ns.ShouldAlert(id, now)
  local last = lastSight[id]
  lastSight[id] = now
  local gap = ((BountyLineDB.settings or {}).realertMinutes or DEFAULT_REALERT) * 60
  return last == nil or now - last > gap
end

local function alert(b)
  -- Last-seen is shared with the guild (pending bounties have no number to share it under).
  if not b.pending then ns.Comms.Seen(b.id, ns.PlayerMapID(), GetServerTime()) end
  if not ns.ShouldAlert(b.pending and ("new:" .. b.name) or b.id, GetTime()) then return end
  if not setting("sightAlert") then return end
  local text = L.SPOTTED:format(b.name, ns.FormatGold(b.reward))
  if RaidNotice_AddMessage and RaidWarningFrame then
    RaidNotice_AddMessage(RaidWarningFrame, text, ChatTypeInfo.RAID_WARNING)
  end
  ns.Sound("sighting")
  ns.Print(text)
end

local function markPlate(unit)
  local plate = C_NamePlate.GetNamePlateForUnit(unit)
  if not plate or (plate.IsForbidden and plate:IsForbidden()) then return end
  local b = wanted(unit)
  local season, known = inSeason(unit)
  local tex = marks[plate]
  if b or season then
    if not tex then
      tex = plate:CreateTexture(nil, "OVERLAY")
      tex:SetPoint("BOTTOM", plate, "TOP", 0, 2)
      tex:SetTexture(SKULL)
      marks[plate] = tex
    end
    local size = (BountyLineDB.settings or {}).skullSize or 26
    tex:SetSize(size, size)
    tex:SetShown(setting("skull"))
    if b then alert(b) else seasonAlert(season, known) end
  elseif tex then
    tex:Hide()
  end
end

-- A skull and the reward above the target frame while your target is wanted.
function ns.RefreshTargetBadge()
  local b = setting("targetBadge") and wanted("target") or nil
  local season = not b and setting("targetBadge") and inSeason("target") or nil
  if not b and not season then
    if badge then badge:Hide() end
    return
  end
  if not badge then
    if not TargetFrame then return end
    badge = CreateFrame("Frame", nil, TargetFrame)
    badge:SetSize(140, 22)
    badge:SetPoint("BOTTOMLEFT", TargetFrame, "TOPLEFT", 24, -4)
    local icon = badge:CreateTexture(nil, "OVERLAY")
    icon:SetSize(20, 20)
    icon:SetPoint("LEFT")
    icon:SetTexture(SKULL)
    badge.text = badge:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    badge.text:SetPoint("LEFT", icon, "RIGHT", 4, 0)
    badge.text:SetTextColor(1, 0.2, 0.15)
  end
  badge.text:SetText(b and L.BADGE:format(ns.FormatGold(b.reward)) or L.BADGE_SEASON:format(ns.SeasonTerms(season)))
  badge:Show()
end

function ns.RefreshMarks()
  ns.RefreshTargetBadge()
  if not (C_NamePlate and C_NamePlate.GetNamePlates) then return end
  for _, plate in ipairs(C_NamePlate.GetNamePlates()) do
    if plate.namePlateUnitToken then markPlate(plate.namePlateUnitToken) end
  end
end

local function onTooltip(tooltip, data)
  local guid = data and data.guid
  if not guid or ns.IsSecret(guid) then return end
  if not setting("tooltip") or not ns.InOpenWorld() then return end
  local b = ns.GetBounty(guid)
  if b then
    local text = b.pending and L.TOOLTIP_PENDING:format(ns.FormatGold(b.reward), b.poster)
      or L.TOOLTIP_WANTED:format(ns.FormatGold(b.reward), b.id, b.poster)
    tooltip:AddLine(text, 1, 0.2, 0.15)
    -- The bounty's terms (spec 5.4c): kills, bonuses and restrictions.
    for _, line in ipairs(ns.TermsLines(b)) do tooltip:AddLine("  " .. line, 1, 0.82, 0) end
  end
  local season = not ns.SeasonClaimedToday(guid) and ns.SeasonOf(guid)
  if season then tooltip:AddLine(L.TOOLTIP_SEASON:format(season.guild, ns.SeasonTerms(season)), 1, 0.2, 0.15) end
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("NAME_PLATE_UNIT_ADDED")
events:RegisterEvent("NAME_PLATE_UNIT_REMOVED")
events:RegisterEvent("PLAYER_TARGET_CHANGED")
events:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
events:RegisterEvent("PLAYER_ENTERING_WORLD") -- zoning into or out of an instance
events:SetScript("OnEvent", function(_, event, unit)
  if event == "PLAYER_ENTERING_WORLD" then
    ns.RefreshMarks()
  elseif event == "PLAYER_LOGIN" then
    if TooltipDataProcessor and Enum and Enum.TooltipDataType then
      TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, onTooltip)
    end
  elseif event == "NAME_PLATE_UNIT_ADDED" then
    markPlate(unit)
  elseif event == "NAME_PLATE_UNIT_REMOVED" then
    local plate = C_NamePlate.GetNamePlateForUnit(unit)
    if plate and marks[plate] then marks[plate]:Hide() end
  else
    if event == "PLAYER_TARGET_CHANGED" then ns.RefreshTargetBadge() end
    local who = event == "PLAYER_TARGET_CHANGED" and "target" or "mouseover"
    local b = wanted(who)
    if b then
      alert(b)
    else
      local season, known = inSeason(who)
      if season then seasonAlert(season, known) end
    end
  end
end)
