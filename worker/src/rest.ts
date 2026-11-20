/** Minimal Discord REST client: bot auth, JSON, and one polite retry on 429. */
import { VERSION } from "./version";

export const API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`Discord API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "DiscordApiError";
  }
}

export interface ForumTag {
  id?: string;
  name: string;
  moderated?: boolean;
}

const NO_PINGS = { parse: [] as string[] };

export class DiscordRest {
  constructor(private readonly token: string) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          "User-Agent": `DiscordBot (bounty-board, ${VERSION})`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 2) {
        const retry = Number(((await res.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 1);
        await new Promise((r) => setTimeout(r, Math.min(retry, 5) * 1000));
        continue;
      }
      if (!res.ok) throw new DiscordApiError(res.status, await res.text(), path);
      return (res.status === 204 ? undefined : await res.json()) as T;
    }
  }

  // ---- channels & messages
  getChannel = (id: string) => this.request<{ id: string; type: number; available_tags?: ForumTag[] }>("GET", `/channels/${id}`);
  setForumTags = (id: string, tags: ForumTag[]) =>
    this.request<{ available_tags: ForumTag[] }>("PATCH", `/channels/${id}`, { available_tags: tags });

  sendMessage = (channelId: string, content: string, replyTo?: string) =>
    this.request<{ id: string }>("POST", `/channels/${channelId}/messages`, {
      content,
      allowed_mentions: { ...NO_PINGS, replied_user: false },
      ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
    });
  editMessage = (channelId: string, messageId: string, content: string) =>
    this.request("PATCH", `/channels/${channelId}/messages/${messageId}`, { content, allowed_mentions: NO_PINGS });
  deleteMessage = (channelId: string, messageId: string) => this.request("DELETE", `/channels/${channelId}/messages/${messageId}`);
  pinMessage = (channelId: string, messageId: string) => this.request("PUT", `/channels/${channelId}/messages/pins/${messageId}`);
  react = (channelId: string, messageId: string, emoji: string) =>
    this.request("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);

  createForumPost = (forumId: string, post: { name: string; tagIds: string[]; content: string; embed: unknown }) =>
    this.request<{ id: string }>("POST", `/channels/${forumId}/threads`, {
      name: post.name,
      auto_archive_duration: 10080,
      applied_tags: post.tagIds,
      message: { content: post.content, embeds: [post.embed], allowed_mentions: NO_PINGS },
    });

  // ---- guilds & interactions
  leaveGuild = (guildId: string) => this.request("DELETE", `/users/@me/guilds/${guildId}`);
  editInteractionReply = (appId: string, token: string, content: string) =>
    this.request("PATCH", `/webhooks/${appId}/${token}/messages/@original`, { content, allowed_mentions: NO_PINGS });
}
