/** Fakes for the Discord REST API, ExecutionContext and the Gateway Durable Object namespace. */
import { vi } from "vitest";
import type { ForumTag } from "../../src/rest";

export interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  /** Multipart uploads: the files[n] parts. */
  files?: { name: string; type: string; bytes: Uint8Array }[];
}

/** Stubs global fetch with an in-memory Discord API that records every call. */
export class FakeDiscord {
  calls: Call[] = [];
  forumTags: ForumTag[] = [];
  messages = new Set<string>();
  fail: Partial<Record<"forumPatch" | "threads" | "pin" | "send", number>> = {};
  private next = 900000000000000000n;

  newId(): string {
    return String(this.next++);
  }

  install(): this {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input), init));
    return this;
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    const path = new URL(url).pathname.replace(/^\/api\/v10/, "");
    const method = init?.method ?? "GET";
    let body: Record<string, unknown> | undefined;
    let files: Call["files"];
    if (typeof init?.body === "string") body = JSON.parse(init.body) as Record<string, unknown>;
    else if (init?.body instanceof FormData) {
      body = JSON.parse(String(init.body.get("payload_json"))) as Record<string, unknown>;
      files = [];
      for (const [key, value] of init.body.entries()) {
        if (key.startsWith("files[") && value instanceof Blob) {
          files.push({ name: (value as File).name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
        }
      }
    }
    this.calls.push({ method, path, body, ...(files ? { files } : {}) });
    const ok = (data: unknown = {}) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    const status = (code: number) => new Response(JSON.stringify({ message: "nope", code: 50013 }), { status: code });
    const noContent = () => new Response(null, { status: 204 });

    let m: RegExpExecArray | null;
    if (method === "GET" && (m = /^\/channels\/(\d+)$/.exec(path))) return ok({ id: m[1], type: 15, available_tags: this.forumTags });
    if (method === "PATCH" && /^\/channels\/\d+$/.test(path)) {
      if (this.fail.forumPatch) return status(this.fail.forumPatch);
      this.forumTags = (body!.available_tags as ForumTag[]).map((t) => ({ ...t, id: t.id ?? this.newId() }));
      return ok({ available_tags: this.forumTags });
    }
    if (method === "POST" && /^\/channels\/\d+\/threads$/.test(path)) {
      if (this.fail.threads) return status(this.fail.threads);
      return ok({ id: this.newId() });
    }
    if (method === "POST" && /^\/channels\/\d+\/messages$/.test(path)) {
      if (this.fail.send) return status(this.fail.send);
      const id = this.newId();
      this.messages.add(id);
      return ok({ id });
    }
    if (method === "PATCH" && (m = /^\/channels\/\d+\/messages\/(\d+)$/.exec(path))) return this.messages.has(m[1]!) ? ok({ id: m[1] }) : status(404);
    if (method === "PUT" && /\/messages\/pins\//.test(path)) return this.fail.pin ? status(this.fail.pin) : noContent();
    if (method === "PUT" && /\/reactions\//.test(path)) return noContent();
    if (method === "DELETE") return noContent();
    if (method === "PATCH" && /^\/webhooks\/.+\/messages\/@original$/.test(path)) return ok({});
    return status(404);
  }

  find(method: string, pattern: RegExp): Call[] {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path));
  }

  /** Text of the deferred interaction replies, in order. */
  followups(): string[] {
    return this.find("PATCH", /\/webhooks\/.+\/@original$/).map((c) => String(c.body?.content ?? ""));
  }
}

/** ExecutionContext whose waitUntil promises can be awaited. */
export function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext,
    settle: () => Promise.all(pending),
  };
}

/** Gateway namespace whose single object answers /status and /ensure. */
export function fakeGateway(state = "connected") {
  const calls: string[] = [];
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async (url: string) => {
        calls.push(new URL(url).pathname);
        return new Response(JSON.stringify({ state }));
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, calls };
}
