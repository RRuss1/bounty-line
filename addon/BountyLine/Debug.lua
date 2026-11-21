-- /bl debug: prints what the client tells the addon, to settle the open questions in
-- spec Section 23 (GUID shape, name format, map IDs, secret values, menu API).
local _, ns = ...

local function show(v)
  if ns.IsSecret(v) then return "|cffff6060<secret>|r" end
  if v == nil then return "nil" end
  return tostring(v)
end

local function line(label, ...)
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = show((select(i, ...))) end
  DEFAULT_CHAT_FRAME:AddMessage(("  |cffd4a017%s|r %s"):format(label, table.concat(parts, " | ")))
end

local function describeUnit(unit)
  DEFAULT_CHAT_FRAME:AddMessage(("|cffd4a017[%s]|r"):format(unit))
  if not UnitExists(unit) then return line("exists", false) end
  line("GUID", UnitGUID(unit))
  line("UnitName", UnitName(unit))
  line("GetUnitName(unit, true)", GetUnitName and GetUnitName(unit, true))
  line("UnitFullName", UnitFullName and UnitFullName(unit))
  -- Forever characters have surnames (spec 23 item 12): find which API returns them.
  line("UnitPVPName", UnitPVPName and UnitPVPName(unit))
  line("UnitNameUnmodified", UnitNameUnmodified and UnitNameUnmodified(unit))
  local tip = C_TooltipInfo and C_TooltipInfo.GetUnit and C_TooltipInfo.GetUnit(unit)
  local lines = tip and tip.lines or {}
  for i = 1, math.min(#lines, 3) do line("tooltip line " .. i, lines[i].leftText) end
  line("player / faction", UnitIsPlayer(unit), UnitFactionGroup(unit))
  line("UnitClass", UnitClass(unit))
  line("UnitRace", UnitRace(unit))
  line("UnitLevel", UnitLevel(unit))
  local snap, why = ns.SnapshotUnit(unit)
  line("bounty allowed", snap and "yes" or ("no: " .. tostring(why)))
end

function ns.Debug()
  ns.Print("debug (paste this into bug reports)")
  local version, build, buildDate, toc = GetBuildInfo()
  line("client", version, build, buildDate, toc)
  line("WOW_PROJECT_ID", WOW_PROJECT_ID)
  line("server time", GetServerTime())
  local mapID = C_Map.GetBestMapForUnit("player")
  local info = mapID and C_Map.GetMapInfo(mapID)
  line("map", mapID, info and info.name, info and info.mapType)
  line("guild", GetGuildInfo("player"))
  line("issecretvalue API", issecretvalue ~= nil)
  line("Menu.ModifyMenu API", Menu ~= nil and Menu.ModifyMenu ~= nil)
  line("in combat", InCombatLockdown())
  line("board tag / reward limits", ns.BoardTag(), ns.RewardLimits())
  describeUnit("player")
  describeUnit("target")
end
