/** Slash command definitions, shared by the router and scripts/register-commands.ts. */

export const OptionType = { SUB_COMMAND: 1, STRING: 3, INTEGER: 4, BOOLEAN: 5, CHANNEL: 7, ROLE: 8, ATTACHMENT: 11 } as const;
export const ChannelType = { GUILD_TEXT: 0, GUILD_FORUM: 15 } as const;

export const COMMANDS = [
  {
    name: "bl",
    description: "Bounty Board",
    type: 1,
    contexts: [0], // servers only, never DMs
    integration_types: [0],
    options: [
      { type: OptionType.SUB_COMMAND, name: "ping", description: "Check that the Bounty Board is up" },
      { type: OptionType.SUB_COMMAND, name: "version", description: "Show the Bounty Board and code format versions" },
      {
        type: OptionType.SUB_COMMAND,
        name: "setup",
        description: "Admin: connect this server's channels, officer role and in-game guild",
        options: [
          {
            type: OptionType.CHANNEL,
            name: "bounty_line",
            description: "Text channel where players paste codes",
            required: true,
            channel_types: [ChannelType.GUILD_TEXT],
          },
          {
            type: OptionType.CHANNEL,
            name: "bounty_board",
            description: "Forum channel for wanted posters",
            required: true,
            channel_types: [ChannelType.GUILD_FORUM],
          },
          { type: OptionType.ROLE, name: "officer_role", description: "Role that approves kill claims", required: true },
          { type: OptionType.STRING, name: "wow_guild", description: "In-game guild name", required: true, max_length: 64 },
          {
            type: OptionType.STRING,
            name: "display_name",
            description: "Name shown in in-game banners (defaults to the guild name)",
            required: false,
            max_length: 64,
          },
        ],
      },
      { type: OptionType.SUB_COMMAND, name: "status", description: "Admin: deployment and board status" },
      { type: OptionType.SUB_COMMAND, name: "pack", description: "Post and pin a fresh Bounty Pack (for /bl import in game)" },
      { type: OptionType.SUB_COMMAND, name: "leaderboard", description: "Top hunters, most wanted and biggest payers" },
      { type: OptionType.SUB_COMMAND, name: "me", description: "Your kills, trust level, open bounties and pending payments" },
      {
        type: OptionType.SUB_COMMAND,
        name: "config",
        description: "Admin: show or change this board's settings",
        options: [
          { type: OptionType.INTEGER, name: "reward_min", description: "Smallest reward in gold", min_value: 1 },
          { type: OptionType.INTEGER, name: "reward_max", description: "Biggest reward in gold", min_value: 1 },
          { type: OptionType.INTEGER, name: "expiry_days", description: "Days a bounty stays open (1-60)", min_value: 1, max_value: 60 },
          { type: OptionType.INTEGER, name: "proof_window_hours", description: "Hours to post a kill (1-168)", min_value: 1, max_value: 168 },
          {
            type: OptionType.STRING,
            name: "auto_approve",
            description: "Which clean kill claims approve themselves",
            choices: [
              { name: "off (officers review everything)", value: "off" },
              { name: "trusted hunters only", value: "trusted_only" },
              { name: "all clean claims", value: "all_clean" },
            ],
          },
          { type: OptionType.INTEGER, name: "trust_threshold", description: "Approved kills in a row to become trusted", min_value: 1, max_value: 50 },
          {
            type: OptionType.INTEGER,
            name: "hardcore_min_gold",
            description: "Bounties of this much gold or more get the Hardcore tag (0 = off)",
            min_value: 0,
          },
          { type: OptionType.BOOLEAN, name: "allow_stacking", description: "Let several players add gold to one bounty" },
          { type: OptionType.BOOLEAN, name: "weekly_recap", description: "Post the Sunday recap" },
          { type: OptionType.CHANNEL, name: "hall_of_fame", description: "Channel for the weekly recap", channel_types: [ChannelType.GUILD_TEXT] },
        ],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "forget-me",
        description: "Delete your links and stats from this Bounty Board",
        options: [{ type: OptionType.BOOLEAN, name: "confirm", description: "Yes, delete my data", required: true }],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "cancel",
        description: "Cancel an open bounty (its poster or an officer)",
        options: [{ type: OptionType.INTEGER, name: "id", description: "Bounty number", required: true, min_value: 1 }],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "season",
        description: "Open Season (a bounty on a whole enemy guild): list them, or end one early",
        options: [
          {
            type: OptionType.STRING,
            name: "action",
            description: "What to do (default: list)",
            choices: [
              { name: "list: show the Open Seasons that are running", value: "list" },
              { name: "end: close one early (kills so far are still paid)", value: "end" },
              { name: "close: officers finish a stuck one (waiting claims denied, open lines marked paid)", value: "close" },
            ],
          },
          { type: OptionType.INTEGER, name: "id", description: "Season number (for end)", min_value: 1 },
        ],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "relay",
        description: "Officers: get a token for the Bounty Line Relay program on your PC",
        options: [
          {
            type: OptionType.STRING,
            name: "action",
            description: "What to do (default: status)",
            choices: [
              { name: "enable (make me a new token)", value: "enable" },
              { name: "revoke (turn my relay off)", value: "revoke" },
              { name: "status (who runs a relay)", value: "status" },
            ],
          },
        ],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "submit",
        description: "Submit a Bounty Line code here if pasting in the Bounty Line channel doesn't work",
        options: [
          { type: OptionType.STRING, name: "code", description: "The BL1-... code from the addon", required: true, max_length: 4000 },
          { type: OptionType.ATTACHMENT, name: "image", description: "Kill claims: your screenshot (newest file in your Screenshots folder)", required: false },
        ],
      },
    ],
  },
] as const;
