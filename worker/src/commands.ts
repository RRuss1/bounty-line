/** Slash command definitions, shared by the router and scripts/register-commands.ts. */

export const OptionType = { SUB_COMMAND: 1, STRING: 3, INTEGER: 4, CHANNEL: 7, ROLE: 8, ATTACHMENT: 11 } as const;
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
      { type: OptionType.SUB_COMMAND, name: "pack", description: "Update the pinned Bounty Pack and link to it (for /bl import in game)" },
      { type: OptionType.SUB_COMMAND, name: "leaderboard", description: "Top hunters, most wanted and biggest payers" },
      { type: OptionType.SUB_COMMAND, name: "me", description: "Your kills, trust level, open bounties and pending payments" },
      {
        type: OptionType.SUB_COMMAND,
        name: "cancel",
        description: "Cancel an open bounty (its poster or an officer)",
        options: [{ type: OptionType.INTEGER, name: "id", description: "Bounty number", required: true, min_value: 1 }],
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
