-- All player-facing text (design spec 14.7). Translations go in Locales/<locale>.lua.
local _, ns = ...

ns.L = {
  ADDON = "Bounty Line",
  PREFIX = "|cffd4a017Bounty Line:|r ",

  -- slash
  HELP = {
    "|cffd4a017Bounty Line|r commands:",
    "  /bl mark [gold] [note]: set a bounty on your target (or right-click their portrait)",
    "  /bl import: paste the Bounty Pack from #bounty-line",
    "  /bl list: open bounties",
    "  /bl last: show your last code again",
    "  /bl test: practice kill (stamp, screenshot, code)",
    "  /bl link: link this character to your Discord account",
    "  /bl debug: print what the game tells the addon (for bug reports)",
    "  /bl debugmenu: print the name of each right-click menu you open (on/off)",
    "  /bl minimap: show or hide the minimap button",
    "  /bl debugkills: print kill and honor events (on/off)",
    "Guild sync and the in-game board arrive in a later update.",
  },
  UNKNOWN_COMMAND = "Unknown command \"%s\". Type /bl help.",
  NO_LAST = "No code yet this session. Set a bounty or use /bl link first.",
  DEBUGMENU_ON = "Menu debug on: right-click portraits and I'll print each menu's name. /bl debugmenu again to stop.",
  DEBUGMENU_OFF = "Menu debug off.",
  DEBUGMENU_TAG = "menu |cff00ccff%s|r (unit: %s)",

  MINIMAP_TIP = { "Left-click: show your last code", "Right-click: set a bounty on your target", "Drag: move this button" },
  MINIMAP_HIDDEN = "Minimap button hidden. /bl minimap brings it back.",
  MINIMAP_SHOWN = "Minimap button shown.",

  -- pack
  IMPORT_TITLE = "IMPORT BOUNTY PACK",
  IMPORT_HELP = "Paste the pinned Bounty Pack from #bounty-line (Ctrl+V). Several parts? Paste them all.",
  IMPORT_READY = "Ready: %d bounties from the %s Bounty Board (board %s)",
  IMPORT_PARTS = "%d of %d parts received. Paste the rest.",
  IMPORT_CUT = "That code looks cut off. Copy it again from Discord.",
  IMPORT_NO_CODE = "No Bounty Pack code in there yet.",
  IMPORT_BUTTON = "Import",
  IMPORT_OLDER = "You already have a newer Bounty Pack.",
  IMPORTED = "Imported %d open bounties from the %s.",
  CLEAR = "Clear",
  OUTDATED = "Bounty Line is out of date for your Bounty Board. Update it from CurseForge.",
  NO_PACK = "No Bounty Pack yet. Copy the pinned one from #bounty-line and type /bl import.",
  LIST_EMPTY = "No open bounties.",
  LIST_HEADER = "%d open bounties on the %s:",
  LIST_LINE = "  #%d |cffffffff%s|r · |cffffd100%s|r · by %s · until %s",

  -- hunting
  TOOLTIP_WANTED = "WANTED: %s (Bounty #%d, posted by %s)",
  SPOTTED = "WANTED: %s (%s) spotted nearby!",
  MENU_VIEW = "View Bounty (#%d · %s)",

  -- kills
  KILL_TITLE = "BOUNTY COLLECTED!",
  KILL_POST = "Post this in the Discord Bounty Line chat WITH your screenshot:",
  PRACTICE_TITLE = "PRACTICE KILL",
  PRACTICE_POST = "Practice only: don't post this code. A real kill gives you one like it.",
  PRACTICE_TARGET = "Practice Target",
  SCREENSHOT_SAVED = "Screenshot saved: World of Warcraft\\_forever_\\Screenshots (newest file)",
  SCREENSHOT_FAILED = "The screenshot didn't save. Take one yourself (Print Screen) before you post.",
  STAMP_TITLE = "BOUNTY LINE · KILL CONFIRMED",
  STAMP_PRACTICE = "BOUNTY LINE · PRACTICE KILL",
  DEBUGKILL = "PARTY_KILL attacker=%s victim=%s",
  DEBUGKILLS_ON = "Kill debug on: kills and honor messages are printed. /bl debugkills again to stop.",
  DEBUGKILLS_OFF = "Kill debug off.",

  -- target checks
  NO_TARGET = "Target an enemy player first, or right-click their portrait.",
  NOT_PLAYER = "Bounties are for players only.",
  SELF = "You can't put a bounty on yourself.",
  SAME_FACTION = "Bounties must be on the opposite faction.",
  NEUTRAL = "That player hasn't picked a faction yet.",
  SECRET = "Set bounties out of combat.",

  -- reward
  REWARD_RANGE = "Reward must be between %s and %s.",
  REWARD_FORMAT = "Type whole gold, like 500, 500g or 1.5k.",

  -- menu
  MENU_SET_BOUNTY = "Set Bounty...",

  -- amount box
  SET_BOUNTY = "SET BOUNTY",
  REWARD_LABEL = "Reward (gold):",
  NOTE_LABEL = "Note (optional):",
  LIMITS = "Min %s · Max %s",
  SET_BUTTON = "Set Bounty",
  CANCEL = "Cancel",

  -- code popup
  BOUNTY_READY = "BOUNTY READY",
  LINK_READY = "LINK YOUR CHARACTER",
  POST_THIS = "Post this in the Discord Bounty Line chat:",
  POST_LINK = "Post this in the Discord Bounty Line chat once, so your kills count for you:",
  COPY_TIP = "Copy code",
  CODE_HIDDEN = "|cff9a9a9a[code hidden: Ctrl+C copies it]|r",
  COPY_HINT = "Click the code, then press CTRL+C",
  SELECTED = "Selected! Now press CTRL+C",
  CLOSE = "Close",
  LINK_NO_FACTION = "Your character needs a faction before it can be linked.",
  CODE_FAILED = "Couldn't make the code (%s). Please report this with /bl debug output.",
}
