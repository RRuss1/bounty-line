/** /bl slash command handlers. Only reached after the allowlist and signature checks. */
import pkg from "../package.json";
import { PREFIX, SCHEMA } from "./codec";
import { hasAdmin, reply, type CommandOption, type Interaction, type InteractionResponse } from "./discord";
import type { Env } from "./env";
import { log } from "./log";
import { audit, boardCounts, getTenant, upsertTenant } from "./tenants";

export const VERSION: string = pkg.version;

const SNOWFLAKE = /^[0-9]{17,20}$/;
const actorOf = (i: Interaction) => i.member?.user?.id ?? i.user?.id ?? "unknown";

function optionMap(opts: CommandOption[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of opts ?? []) if (o.value !== undefined) out[o.name] = String(o.value);
  return out;
}

export async function runCommand(interaction: Interaction, env: Env, now = Math.floor(Date.now() / 1000)): Promise<InteractionResponse> {
  const sub = interaction.data?.options?.[0];
  const guildId = interaction.guild_id!; // guaranteed by the allowlist check
  switch (sub?.name) {
    case "ping":
      return reply(`🏓 Pong! Bounty Board v${VERSION} is up.`);
    case "version":
      return reply(`Bounty Board **v${VERSION}** · code format **${PREFIX}** (schema ${SCHEMA})`);
    case "setup":
      return setup(interaction, env, guildId, optionMap(sub.options), now);
    case "status":
      return status(interaction, env, guildId);
    default:
      return reply("I don't know that command. Try `/bl ping`.");
  }
}

async function setup(interaction: Interaction, env: Env, guildId: string, o: Record<string, string>, now: number): Promise<InteractionResponse> {
  if (!hasAdmin(interaction)) return reply("Only server admins (Manage Server) can run `/bl setup`.");
  const wowGuildName = (o.wow_guild ?? "").trim();
  const displayName = (o.display_name ?? "").trim() || wowGuildName;
  const ids = [o.bounty_line, o.bounty_board, o.officer_role];
  if (!wowGuildName || ids.some((id) => !id || !SNOWFLAKE.test(id))) {
    return reply("Setup needs the Bounty Line channel, the Bounty Board forum, the officer role and your in-game guild name.");
  }
  const { tenant, created } = await upsertTenant(
    env.DB,
    {
      id: guildId,
      wowGuildName,
      bountyLineChannel: o.bounty_line!,
      bountyBoardForum: o.bounty_board!,
      officerRoleId: o.officer_role!,
      displayName,
    },
    now,
  );
  await audit(env.DB, guildId, actorOf(interaction), created ? "setup.create" : "setup.update", { ...o, board_tag: tenant.board_tag }, now);
  log(env, "info", "setup", { tenant_id: guildId, outcome: created ? "created" : "updated" });
  return reply(
    [
      created ? "✅ **Your Bounty Board is set up!**" : "✅ **Bounty Board settings updated.**",
      `Board tag: **${tenant.board_tag}**`,
      `Codes go in <#${tenant.bounty_line_ch}> · wanted posters in <#${tenant.bounty_board_forum}> · officers: <@&${tenant.officer_role_id}>`,
      `In-game guild: **${tenant.wow_guild_name}** · banners say "${tenant.config.discord_display_name} Bounty Board"`,
      "",
      "Next: tell your guild to install **Bounty Line**. Pasting codes in the Bounty Line channel comes online in the next Bounty Board update.",
    ].join("\n"),
  );
}

async function status(interaction: Interaction, env: Env, guildId: string): Promise<InteractionResponse> {
  if (!hasAdmin(interaction)) return reply("Only server admins (Manage Server) can run `/bl status`.");
  const tenant = await getTenant(env.DB, guildId);
  if (!tenant) return reply("This server isn't set up yet. Run `/bl setup` first.");
  const counts = await boardCounts(env.DB, guildId);
  const budget = env.READ_CHAT === "false";
  const ai = env.AI_CHECK === "false" ? "off" : `on (cap ${env.AI_DAILY_CAP ?? "200"}/day)`;
  return reply(
    [
      `**Bounty Board v${VERSION}** · ${budget ? "budget mode" : "full mode"}`,
      `Board tag: **${tenant.board_tag}** · guild: **${tenant.wow_guild_name}**`,
      `Chat reading: ${budget ? "off (use /bl submit)" : "not running yet"} · AI checks: ${ai}`,
      `Open bounties: **${counts.open}** · pending reviews: **${counts.pendingReviews}**`,
    ].join("\n"),
  );
}
