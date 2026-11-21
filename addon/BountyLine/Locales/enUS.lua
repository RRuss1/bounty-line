-- All player-facing text (design spec 14.7). Translations go in Locales/<locale>.lua.
local _, ns = ...

ns.L = {
  ADDON = "Bounty Line",
  PREFIX = "|cffd4a017Bounty Line:|r ",

  -- slash
  HELP = {
    "|cffd4a017Bounty Line|r commands:",
    "  /bl mark [gold] [note]: set a bounty on your target (or right-click their portrait)",
    "  /bl last: show your last code again",
    "  /bl link: link this character to your Discord account",
    "  /bl debug: print what the game tells the addon (for bug reports)",
    "  /bl debugmenu: print the name of each right-click menu you open (on/off)",
    "The in-game board, /bl import and hunting arrive in later updates.",
  },
  UNKNOWN_COMMAND = "Unknown command \"%s\". Type /bl help.",
  NO_LAST = "No code yet this session. Set a bounty or use /bl link first.",
  DEBUGMENU_ON = "Menu debug on: right-click portraits and I'll print each menu's name. /bl debugmenu again to stop.",
  DEBUGMENU_OFF = "Menu debug off.",
  DEBUGMENU_TAG = "menu |cff00ccff%s|r (unit: %s)",

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
  COPY_HINT = "Click the code, then press Ctrl+C",
  SELECTED = "|TInterface\\RaidFrame\\ReadyCheck-Ready:14|t |cff33ff33Selected! Press Ctrl+C|r",
  CLOSE = "Close",
  LINK_NO_FACTION = "Your character needs a faction before it can be linked.",
  CODE_FAILED = "Couldn't make the code (%s). Please report this with /bl debug output.",
}
