-- Hunting (spec 5.6): bounty targets get a skull over their nameplate, a WANTED line in
-- their tooltip, and a raid-warning alert when you spot them. The alert repeats only after
-- you've lost sight of them for a while (settings.realertMinutes), not while you're fighting.
-- GUIDs hidden as secret values (combat) are skipped, never guessed.
local _, ns = ...
local L = ns.L

local SKULL = "Interface\\TargetingFrame\\UI-RaidTargetingIcon_8"
local DEFAULT_REALERT = 10 -- minutes
local marks = {}     -- nameplate frame -> skull texture
local lastSight = {} -- bounty id -> GetTime() of the latest sighting

local function wanted(unit)
  if not unit or not UnitIsPlayer(unit) then return nil end
  return ns.GetBounty(UnitGUID(unit))
end

-- True when this sighting deserves an alert: the first one, or the first after a gap.
function ns.ShouldAlert(id, now)
  local last = lastSight[id]
  lastSight[id] = now
  local gap = ((BountyLineDB.settings or {}).realertMinutes or DEFAULT_REALERT) * 60
  return last == nil or now - last > gap
end

local function alert(b)
  ns.Comms.Seen(b.id, ns.PlayerMapID(), GetServerTime()) -- last-seen, shared with the guild
  if not ns.ShouldAlert(b.id, GetTime()) then return end
  local text = L.SPOTTED:format(b.name, ns.FormatGold(b.reward))
  if RaidNotice_AddMessage and RaidWarningFrame then
    RaidNotice_AddMessage(RaidWarningFrame, text, ChatTypeInfo.RAID_WARNING)
  end
  PlaySound(SOUNDKIT.RAID_WARNING)
  ns.Print(text)
end

local function markPlate(unit)
  local plate = C_NamePlate.GetNamePlateForUnit(unit)
  if not plate or (plate.IsForbidden and plate:IsForbidden()) then return end
  local b = wanted(unit)
  local tex = marks[plate]
  if b then
    if not tex then
      tex = plate:CreateTexture(nil, "OVERLAY")
      tex:SetSize(26, 26)
      tex:SetPoint("BOTTOM", plate, "TOP", 0, 2)
      tex:SetTexture(SKULL)
      marks[plate] = tex
    end
    tex:Show()
    alert(b)
  elseif tex then
    tex:Hide()
  end
end

function ns.RefreshMarks()
  if not (C_NamePlate and C_NamePlate.GetNamePlates) then return end
  for _, plate in ipairs(C_NamePlate.GetNamePlates()) do
    if plate.namePlateUnitToken then markPlate(plate.namePlateUnitToken) end
  end
end

local function onTooltip(tooltip, data)
  local guid = data and data.guid
  if not guid or ns.IsSecret(guid) then return end
  local b = ns.GetBounty(guid)
  if not b then return end
  tooltip:AddLine(L.TOOLTIP_WANTED:format(ns.FormatGold(b.reward), b.id, b.poster), 1, 0.2, 0.15)
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("NAME_PLATE_UNIT_ADDED")
events:RegisterEvent("NAME_PLATE_UNIT_REMOVED")
events:RegisterEvent("PLAYER_TARGET_CHANGED")
events:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
events:SetScript("OnEvent", function(_, event, unit)
  if event == "PLAYER_LOGIN" then
    if TooltipDataProcessor and Enum and Enum.TooltipDataType then
      TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, onTooltip)
    end
  elseif event == "NAME_PLATE_UNIT_ADDED" then
    markPlate(unit)
  elseif event == "NAME_PLATE_UNIT_REMOVED" then
    local plate = C_NamePlate.GetNamePlateForUnit(unit)
    if plate and marks[plate] then marks[plate]:Hide() end
  else
    local b = wanted(event == "PLAYER_TARGET_CHANGED" and "target" or "mouseover")
    if b then alert(b) end
  end
end)
