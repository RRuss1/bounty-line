std = "lua51"
max_line_length = 140
exclude_files = { "addon/BountyLine/Libs/" }

-- The test runners stub the WoW API as globals.
files["addon/tests/"] = { std = "lua51+luajit", globals = { "strmatch", "LibStub" }, allow_defined_top = true, allow_defined = true,
  -- The stubs are read by the addon files under test, not by the test file itself.
  ignore = { "131" } }

-- Globals the addon sets.
globals = { "BountyLineDB", "BountyLineCharDB", "SLASH_BOUNTYLINE1", "SLASH_BOUNTYLINE2", "SlashCmdList" }

-- WoW API the addon reads.
read_globals = {
  "LibStub",
  -- frames & UI
  "CreateFrame", "UIParent", "UISpecialFrames", "GameTooltip", "GameTooltip_SetTitle", "DEFAULT_CHAT_FRAME",
  "PlaySound", "SOUNDKIT", "Menu", "tinsert", "BreakUpLargeNumbers",
  -- units
  "UnitExists", "UnitGUID", "UnitName", "UnitFullName", "GetUnitName", "UnitIsPlayer", "UnitIsUnit",
  "UnitFactionGroup", "UnitClass", "UnitRace", "UnitLevel", "issecretvalue",
  -- world & client
  "C_Map", "GetGuildInfo", "GetServerTime", "GetBuildInfo", "WOW_PROJECT_ID", "InCombatLockdown",
}
