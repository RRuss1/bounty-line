/** /bl slash command handlers. Only reached after the allowlist and signature checks. */
import { extractCodes, processCode } from "./bounties";
import { PREFIX, SCHEMA } from "./codec";
import { hasAdmin, reply, type CommandOption, type Interaction, type InteractionResponse } from "./discord";
import type { Env } from "./env";
import { gatewayState } from "./gateway";
import { log } from "./log";
import { refreshPack } from "./pack";
import { cancel, configure, forgetMe, leaderboard, me } from "./stats";
import { codeLimiter } from "./ratelimit";
import type { DiscordRest, ForumTag } from "./rest";
import { audit, boardCounts, FORUM_TAGS, getTenant, patchConfig, upsertTenant, type ForumTagKey, type Tenant } from "./tenants";
import { VERSION } from "./version";
import { gold } from "./wow";

export { VERSION };

/** Either an immediate reply, or slow work whose text replaces a "thinking..." reply. */
export type CommandResult = { reply: InteractionResponse } | { defer: () => Promise<string> };

const SNOWFLAKE = /^[0-9]{17,20}$/;
const actorOf = (i: Interaction) => i.member?.user?.id ?? i.user?.id ?? "unknown";

function optionMap(opts: CommandOption[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of opts ?? []) if (o.value !== undefined) out[o.name] = String(o.value);
  return out;
}

export async function runCommand(
  interaction: Interaction,
  env: Env,
  rest: DiscordRest,
  now = Math.floor(Date.now() / 1000),
): Promise<CommandResult> {
  const sub = interaction.data?.options?.[0];
  const guildId = interaction.guild_id!; // guaranteed by the allowlist check
  const o = optionMap(sub?.options);
  switch (sub?.name) {
    case "ping":
      return { reply: reply(`🏓 Pong! Bounty Board v${VERSION} is up.`) };
    case "version":
      return { reply: reply(`Bounty Board **v${VERSION}** · code format **${PREFIX}** (schema ${SCHEMA})`) };
    case "setup":
      return setup(interaction, env, rest, guildId, o, now);
    case "status":
      return { reply: await status(interaction, env, guildId) };
    case "leaderboard": {
      const tenant = await getTenant(env.DB, guildId);
      if (!tenant) return { reply: reply("This server isn't set up yet. An admin needs to run `/bl setup`.") };
      // Public, so the whole channel sees it; never pings.
      return { reply: { type: 4, data: { content: await leaderboard(env, tenant, now), allowed_mentions: { parse: [] } } } };
    }
    case "me":
      return {
        defer: async () => {
          const tenant = await getTenant(env.DB, guildId);
          return tenant ? me(env, tenant, actorOf(interaction)) : "This server isn't set up yet.";
        },
      };
    case "config":
      if (!hasAdmin(interaction)) return { reply: reply("Only server admins (Manage Server) can change settings.") };
      return {
        defer: async () => {
          const tenant = await getTenant(env.DB, guildId);
          return tenant ? configure(env, rest, tenant, o, now) : "This server isn't set up yet. Run `/bl setup` first.";
        },
      };
    case "forget-me":
      if (o.confirm !== "true") return { reply: reply("Nothing deleted. Run it again with `confirm: True` to delete your data.") };
      return {
        defer: async () => {
          const tenant = await getTenant(env.DB, guildId);
          return tenant ? forgetMe(env, tenant, actorOf(interaction), now) : "This server isn't set up yet.";
        },
      };
    case "cancel":
      return {
        defer: async () => {
          const tenant = await getTenant(env.DB, guildId);
          if (!tenant) return "This server isn't set up yet.";
          const user = { id: actorOf(interaction), roles: interaction.member?.roles ?? [], isAdmin: hasAdmin(interaction) };
          return cancel(env, rest, tenant, Number(o.id), user, now);
        },
      };
    case "pack":
      return { defer: () => pack(env, rest, guildId, now) };
    case "submit":
      return { defer: () => submit(interaction, env, rest, guildId, o.code ?? "", now, o.image) };
    default:
      return { reply: reply("I don't know that command. Try `/bl ping`.") };
  }
}

// ---------------------------------------------------------------- /bl setup

function setup(interaction: Interaction, env: Env, rest: DiscordRest, guildId: string, o: Record<string, string>, now: number): CommandResult {
  if (!hasAdmin(interaction)) return { reply: reply("Only server admins (Manage Server) can run `/bl setup`.") };
  const wowGuildName = (o.wow_guild ?? "").trim();
  const displayName = (o.display_name ?? "").trim() || wowGuildName;
  if (!wowGuildName || [o.bounty_line, o.bounty_board, o.officer_role].some((id) => !id || !SNOWFLAKE.test(id))) {
    return { reply: reply("Setup needs the Bounty Line channel, the Bounty Board forum, the officer role and your in-game guild name.") };
  }
  return {
    defer: async () => {
      const { tenant, created } = await upsertTenant(
        env.DB,
        { id: guildId, wowGuildName, bountyLineChannel: o.bounty_line!, bountyBoardForum: o.bounty_board!, officerRoleId: o.officer_role!, displayName },
        now,
      );
      await audit(env.DB, guildId, actorOf(interaction), created ? "setup.create" : "setup.update", { ...o, board_tag: tenant.board_tag }, now);

      const warnings: string[] = [];
      try {
        await patchConfig(env.DB, guildId, { forum_tags: await ensureForumTags(rest, tenant.bounty_board_forum!) });
      } catch (e) {
        log(env, "warn", "setup.forum_tags_failed", { tenant_id: guildId, error: String(e) });
        warnings.push(
          `⚠️ I couldn't create the forum tags in <#${tenant.bounty_board_forum}>. Give me **Manage Channels** on that forum only (forum settings → Permissions → add the bot), then run \`/bl setup\` again.`,
        );
      }
      try {
        const howto = await ensureHowTo(rest, tenant);
        await patchConfig(env.DB, guildId, { howto_message_id: howto.id });
        if (!howto.pinned) warnings.push(`⚠️ I posted the how-to in <#${tenant.bounty_line_ch}> but couldn't pin it. Give me **Pin Messages** there.`);
      } catch (e) {
        log(env, "warn", "setup.howto_failed", { tenant_id: guildId, error: String(e) });
        warnings.push(`⚠️ I couldn't post the how-to in <#${tenant.bounty_line_ch}>. Check I can **View Channel** and **Send Messages** there.`);
      }

      const fresh = await getTenant(env.DB, guildId);
      if (fresh && !(await refreshPack(env, rest, fresh, now))) {
        warnings.push(`⚠️ I couldn't post the Bounty Pack in <#${tenant.bounty_line_ch}>. Check I can **Send Messages** and **Pin Messages** there.`);
      }

      log(env, "info", "setup", { tenant_id: guildId, outcome: created ? "created" : "updated", warnings: warnings.length });
      return [
        created ? "✅ **Your Bounty Board is set up!**" : "✅ **Bounty Board settings updated.**",
        `Board tag: **${tenant.board_tag}**`,
        `Codes go in <#${tenant.bounty_line_ch}> · wanted posters in <#${tenant.bounty_board_forum}> · officers: <@&${tenant.officer_role_id}>`,
        `In-game guild: **${tenant.wow_guild_name}** · banners say "${tenant.config.discord_display_name} Bounty Board"`,
        ...(warnings.length ? ["", ...warnings] : ["", "Players can now paste bounty codes in the Bounty Line channel."]),
      ].join("\n");
    },
  };
}

/** Makes sure the status tags exist on the forum. Keeps any other tags. Returns tag IDs by key. */
export async function ensureForumTags(rest: DiscordRest, forumId: string): Promise<Partial<Record<ForumTagKey, string>>> {
  const channel = await rest.getChannel(forumId);
  let tags: ForumTag[] = channel.available_tags ?? [];
  const missing = Object.values(FORUM_TAGS).filter((name) => !tags.some((t) => t.name === name));
  if (missing.length) {
    if (tags.length + missing.length > 20) throw new Error("forum has too many tags (Discord allows 20)");
    tags = (await rest.setForumTags(forumId, [...tags, ...missing.map((name) => ({ name }))])).available_tags;
  }
  const ids: Partial<Record<ForumTagKey, string>> = {};
  for (const [key, name] of Object.entries(FORUM_TAGS) as [ForumTagKey, string][]) {
    const id = tags.find((t) => t.name === name)?.id;
    if (id) ids[key] = id;
  }
  return ids;
}

export function howToText(t: Tenant): string {
  return [
    "**📜 How the Bounty Board works**",
    `**Post a bounty:** in game, right-click an enemy player's portrait → **Set Bounty…** (or \`/bl mark\`). Copy the code and paste it here. A wanted poster appears in <#${t.bounty_board_forum}>.`,
    "**Claim a bounty:** land the killing blow. Bounty Line screenshots the kill and gives you a kill code. Paste it here **with the screenshot** (newest file in `World of Warcraft\\_forever_\\Screenshots`).",
    "**Get paid:** the poster pays you in game, player to player (honor system).",
    `**Rules:** opposite faction only · no duels · killing blow only · rewards ${gold(t.config.reward_min)} to ${gold(t.config.reward_max)}.`,
    "**See bounties in game:** copy the pinned **Bounty Pack** below and type `/bl import` in game. Wanted players get a skull and a WANTED tooltip.",
    "**Get credit:** type `/bl link` in game once and paste that code here.",
    "Pasting not working? Use `/bl submit` (attach the screenshot for kills).",
    `Install **Bounty Line** from CurseForge (WoW Forever). Board tag: **${t.board_tag}**`,
  ].join("\n");
}

/** Posts (or updates) and pins the how-to. Re-running setup edits the same message instead of posting another. */
async function ensureHowTo(rest: DiscordRest, t: Tenant): Promise<{ id: string; pinned: boolean }> {
  const text = howToText(t);
  const channel = t.bounty_line_ch!;
  if (t.config.howto_message_id) {
    try {
      await rest.editMessage(channel, t.config.howto_message_id, text);
      return { id: t.config.howto_message_id, pinned: true };
    } catch {
      // deleted, or the channel changed: post a new one
    }
  }
  const msg = await rest.sendMessage(channel, text);
  try {
    await rest.pinMessage(channel, msg.id);
    return { id: msg.id, pinned: true };
  } catch {
    return { id: msg.id, pinned: false };
  }
}

// ---------------------------------------------------------------- /bl status and /bl submit

async function status(interaction: Interaction, env: Env, guildId: string): Promise<InteractionResponse> {
  if (!hasAdmin(interaction)) return reply("Only server admins (Manage Server) can run `/bl status`.");
  const tenant = await getTenant(env.DB, guildId);
  if (!tenant) return reply("This server isn't set up yet. Run `/bl setup` first.");
  const counts = await boardCounts(env.DB, guildId);
  const budget = env.READ_CHAT === "false";
  const ai = env.AI_CHECK === "false" ? "off" : `on (cap ${env.AI_DAILY_CAP ?? "200"}/day)`;
  const chat = budget ? "off (use /bl submit)" : await gatewayState(env);
  return reply(
    [
      `**Bounty Board v${VERSION}** · ${budget ? "budget mode" : "full mode"}`,
      `Board tag: **${tenant.board_tag}** · guild: **${tenant.wow_guild_name}**`,
      `Chat reading: ${chat} · AI checks: ${ai}`,
      `Open bounties: **${counts.open}** · pending reviews: **${counts.pendingReviews}**`,
    ].join("\n"),
  );
}

async function pack(env: Env, rest: DiscordRest, guildId: string, now: number): Promise<string> {
  const tenant = await getTenant(env.DB, guildId);
  if (!tenant) return "This server isn't set up yet. An admin needs to run `/bl setup`.";
  const link = await refreshPack(env, rest, tenant, now);
  if (!link) return "❌ I couldn't update the Bounty Pack. An admin should check my permissions in the Bounty Line channel.";
  return `📦 The Bounty Pack is up to date: ${link}\nIn game, type \`/bl import\` and paste it.`;
}

async function submit(interaction: Interaction, env: Env, rest: DiscordRest, guildId: string, code: string, now: number, imageId?: string): Promise<string> {
  const tenant = await getTenant(env.DB, guildId);
  if (!tenant) return "This server isn't set up yet. An admin needs to run `/bl setup`.";
  const user = actorOf(interaction);
  if (!codeLimiter.allow(`${guildId}:${user}`)) return "❌ Slow down a little: try again in a minute.";
  const image = imageId ? interaction.data?.resolved?.attachments?.[imageId] : undefined;
  // Players paste the addon's whole line ("WANTED: **Name** · 500g ||BL1-B-...||"): find the code in it.
  const [found] = extractCodes(code, 1);
  if (!found) return "❌ I don't see a Bounty Line code in that. Copy it again in game with `/bl last`.";
  const outcome = await processCode(env, rest, tenant, found, user, now, image ? [image] : []);
  if (outcome.ok === null) return "That's a Bounty Pack. Packs go into the addon with `/bl import`.";
  return outcome.ok ? outcome.message : `❌ ${outcome.message}`;
}
