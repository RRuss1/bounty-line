std = "lua51"
max_line_length = 140
exclude_files = { "addon/BountyLine/Libs/" }

-- The test runners stub the WoW API as globals.
files["addon/tests/"] = { std = "lua51+luajit", globals = { "strmatch", "LibStub" }, allow_defined_top = true, allow_defined = true,
  -- The stubs are read by the addon files under test, not by the test file itself.
  ignore = { "131" } }

-- Globals the addon sets.
globals = {
  "BountyLineDB", "BountyLineCharDB", "SLASH_BOUNTYLINE1", "SLASH_BOUNTYLINE2", "SlashCmdList",
  -- addon compartment callbacks named in the TOC
  "BountyLine_OnAddonCompartmentClick", "BountyLine_OnAddonCompartmentEnter", "BountyLine_OnAddonCompartmentLeave",
}

-- WoW API the addon reads.
read_globals = {
  "LibStub",
  -- frames & UI
  "CreateFrame", "UIParent", "UISpecialFrames", "GameTooltip", "GameTooltip_SetTitle", "DEFAULT_CHAT_FRAME",
  "Minimap", "GetCursorPosition", "NineSliceUtil", "PlaySound", "SOUNDKIT", "Menu", "tinsert", "BreakUpLargeNumbers", "Mixin", "BackdropTemplateMixin", "C_Texture",
  -- units
  "UnitExists", "UnitGUID", "UnitName", "UnitFullName", "GetUnitName", "UnitIsPlayer", "UnitIsUnit",
  "UnitFactionGroup", "UnitClass", "UnitRace", "UnitLevel", "issecretvalue", "UnitPVPName", "UnitNameUnmodified", "C_TooltipInfo",
  -- world & client
  "C_Map", "GetGuildInfo", "GetServerTime", "GetBuildInfo", "WOW_PROJECT_ID", "InCombatLockdown",
  -- hunting & kills
  "C_NamePlate", "TooltipDataProcessor", "Enum", "RaidNotice_AddMessage", "RaidWarningFrame", "ChatTypeInfo",
  "C_Timer", "Screenshot", "GetTime", "date",
  -- guild sync & board
  "C_ChatInfo", "IsInGuild", "GetNumGuildMembers", "GetGuildRosterInfo", "C_AddOns", "IsShiftKeyDown", "C_CreatureInfo", "RAID_CLASS_COLORS",
}
