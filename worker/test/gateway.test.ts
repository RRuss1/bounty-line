import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FATAL_RETRY_MS, GATEWAY_URL, GatewayClient, INTENTS, type KV, type SocketLike } from "../src/gateway-client";

class FakeSocket implements SocketLike {
  sent: { op: number; d: unknown }[] = [];
  closed: { code?: number } | null = null;
  private listeners: Record<string, ((ev: never) => void)[]> = {};
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.closed = { code };
  }
  addEventListener(type: string, fn: (ev: never) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(payload: { op: number; d?: unknown; s?: number | null; t?: string | null }) {
    for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(payload) } as never);
  }
  serverClose(code: number, reason = "") {
    for (const fn of this.listeners.close ?? []) fn({ code, reason } as never);
  }
  ops() {
    return this.sent.map((p) => p.op);
  }
}

class MemoryKV implements KV {
  data = new Map<string, unknown>();
  async get<T>(k: string) {
    return this.data.get(k) as T | undefined;
  }
  async put(k: string, v: unknown) {
    this.data.set(k, structuredClone(v));
  }
  async delete(k: string) {
    return this.data.delete(k);
  }
}

let sockets: FakeSocket[];
let storage: MemoryKV;
let dispatched: { type: string; data: unknown }[];

function makeClient(kv = storage) {
  return new GatewayClient({
    token: "bot-token",
    connect: async (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    storage: kv,
    now: () => Date.now(),
    random: () => 0.5,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onDispatch: async (type, data) => void dispatched.push({ type, data }),
    log: () => undefined,
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const last = () => sockets.at(-1)!;

async function connectAndReady(client: GatewayClient, seq = 1) {
  await client.ensure();
  last().emit({ op: 10, d: { heartbeat_interval: 1000 } });
  last().emit({ op: 0, t: "READY", s: seq, d: { session_id: "sess-1", resume_gateway_url: "wss://resume.discord.gg" } });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  storage = new MemoryKV();
  dispatched = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Gateway connection", () => {
  it("identifies with the right intents after HELLO", async () => {
    const client = makeClient();
    await client.ensure();
    expect(last().url).toBe(`${GATEWAY_URL}/?v=10&encoding=json`);
    last().emit({ op: 10, d: { heartbeat_interval: 1000 } });
    expect(last().sent[0]).toMatchObject({ op: 2, d: { token: "bot-token", intents: INTENTS } });
    expect(INTENTS).toBe(1 + 512 + 32768); // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT
  });

  it("stores the session on READY and forwards events", async () => {
    const client = makeClient();
    await connectAndReady(client);
    expect(client.status()).toMatchObject({ state: "connected", hasSession: true, seq: 1 });
    expect(storage.data.get("session")).toMatchObject({ sessionId: "sess-1", resumeUrl: "wss://resume.discord.gg" });
    last().emit({ op: 0, t: "MESSAGE_CREATE", s: 2, d: { id: "m1" } });
    await flush();
    expect(dispatched.map((d) => d.type)).toEqual(["READY", "MESSAGE_CREATE"]);
  });

  it("is a no-op when already connected", async () => {
    const client = makeClient();
    await connectAndReady(client);
    await client.ensure();
    expect(sockets).toHaveLength(1);
  });

  it("heartbeats with the latest sequence after a jittered first beat", async () => {
    const client = makeClient();
    await connectAndReady(client, 5);
    await vi.advanceTimersByTimeAsync(500); // interval * random(0.5)
    expect(last().sent.at(-1)).toEqual({ op: 1, d: 5 });
    last().emit({ op: 11 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().sent.filter((p) => p.op === 1)).toHaveLength(2);
  });

  it("answers a heartbeat request immediately", async () => {
    const client = makeClient();
    await connectAndReady(client);
    last().emit({ op: 1 });
    expect(last().ops().at(-1)).toBe(1);
  });

  it("treats a missed ACK as a zombie connection and resumes", async () => {
    const client = makeClient();
    await connectAndReady(client, 7);
    await vi.advanceTimersByTimeAsync(500); // beat, no ACK
    await vi.advanceTimersByTimeAsync(1000); // next tick finds no ACK
    expect(sockets[0]!.closed?.code).toBe(4000); // not 1000: keeps the session resumable
    await vi.advanceTimersByTimeAsync(2000);
    expect(last().url).toBe("wss://resume.discord.gg/?v=10&encoding=json");
    last().emit({ op: 10, d: { heartbeat_interval: 1000 } });
    expect(last().sent[0]).toEqual({ op: 6, d: { token: "bot-token", session_id: "sess-1", seq: 7 } });
  });

  it("resumes when Discord asks it to reconnect", async () => {
    const client = makeClient();
    await connectAndReady(client, 3);
    last().emit({ op: 7 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets).toHaveLength(2);
    last().emit({ op: 10, d: { heartbeat_interval: 1000 } });
    expect(last().sent[0]!.op).toBe(6);
    last().emit({ op: 0, t: "RESUMED", s: 4, d: {} });
    await flush();
    expect(client.status().state).toBe("connected");
  });

  it("starts a fresh session after a non-resumable INVALID_SESSION", async () => {
    const client = makeClient();
    await connectAndReady(client);
    last().emit({ op: 9, d: false });
    await vi.advanceTimersByTimeAsync(6000);
    expect(storage.data.has("session")).toBe(false);
    expect(last().url).toBe(`${GATEWAY_URL}/?v=10&encoding=json`);
    last().emit({ op: 10, d: { heartbeat_interval: 1000 } });
    expect(last().sent[0]!.op).toBe(2);
  });

  it("reconnects with backoff after an ordinary close", async () => {
    const client = makeClient();
    await connectAndReady(client);
    last().serverClose(4000, "unknown error");
    await flush();
    expect(client.status().state).toBe("backoff");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
  });

  it("stops on a fatal close (e.g. Message Content intent not enabled) and waits an hour", async () => {
    const client = makeClient();
    await client.ensure();
    last().serverClose(4014, "Disallowed intent(s)");
    await flush();
    expect(client.status()).toMatchObject({ state: "fatal", fatal: { code: 4014 } });
    await vi.advanceTimersByTimeAsync(60_000);
    await client.ensure(); // the cron's next call
    expect(sockets).toHaveLength(1);

    // A restarted Durable Object remembers the fatal error too.
    const restarted = makeClient(storage);
    await restarted.ensure();
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(FATAL_RETRY_MS);
    await client.ensure();
    expect(sockets).toHaveLength(2);
  });

  it("resumes a stored session after the Durable Object restarts (e.g. a redeploy)", async () => {
    await connectAndReady(makeClient(), 9);
    await vi.advanceTimersByTimeAsync(500); // heartbeat persists seq
    const restarted = makeClient(storage);
    await restarted.ensure();
    expect(last().url).toBe("wss://resume.discord.gg/?v=10&encoding=json");
    last().emit({ op: 10, d: { heartbeat_interval: 1000 } });
    expect(last().sent[0]).toEqual({ op: 6, d: { token: "bot-token", session_id: "sess-1", seq: 9 } });
  });

  it("keeps going when an event handler throws", async () => {
    const client = new GatewayClient({
      token: "t",
      connect: async (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      storage,
      now: () => Date.now(),
      random: () => 0.5,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onDispatch: async () => {
        throw new Error("boom");
      },
      log: () => undefined,
    });
    await connectAndReady(client);
    last().emit({ op: 0, t: "MESSAGE_CREATE", s: 2, d: {} });
    await flush();
    expect(client.status().state).toBe("connected");
  });

  it("retries when the connection itself fails", async () => {
    let fail = true;
    const client = new GatewayClient({
      token: "t",
      connect: async (url) => {
        if (fail) {
          fail = false;
          throw new Error("network down");
        }
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      storage,
      now: () => Date.now(),
      random: () => 0.5,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onDispatch: async () => undefined,
      log: () => undefined,
    });
    await client.ensure();
    expect(client.status().state).toBe("backoff");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(1);
  });
});
