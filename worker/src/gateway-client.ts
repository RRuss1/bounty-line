/**
 * Discord Gateway protocol (v10, JSON): identify, heartbeat, resume, reconnect.
 * No Workers APIs in here; sockets, storage and timers are injected so the
 * protocol can be unit tested. GatewayDO (gateway.ts) wires in the real ones.
 */

export const GATEWAY_URL = "wss://gateway.discord.gg";
/** GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT */
export const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

const Op = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 };
/** Close codes that retrying can't fix (bad token, disallowed intents, ...). */
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Close codes after which the session can't be resumed. */
const NEW_SESSION_CLOSE = new Set([4007, 4009]);
/** After a fatal close, wait this long before trying again (identify limit is 1000/day). */
export const FATAL_RETRY_MS = 60 * 60 * 1000;
const MAX_BACKOFF_MS = 30_000;

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
  addEventListener(type: "close", fn: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", fn: (ev: unknown) => void): void;
}

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

export interface GatewayDeps {
  token: string;
  connect(url: string): Promise<SocketLike>;
  storage: KV;
  now(): number;
  random(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onDispatch(type: string, data: unknown): Promise<void>;
  log(level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void;
}

interface Session {
  sessionId: string;
  resumeUrl: string;
  seq: number | null;
}

export type GatewayState = "idle" | "connecting" | "connected" | "backoff" | "fatal";

export class GatewayClient {
  private state: GatewayState = "idle";
  private ws: SocketLike | null = null;
  private connId = 0;
  private session: Session | null = null;
  private seq: number | null = null;
  private resuming = false;
  private awaitingAck = false;
  private heartbeatTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private attempts = 0;
  private fatal: { code: number; reason: string; at: number } | null = null;
  private loaded = false;
  private lastEventAt = 0;

  constructor(private readonly d: GatewayDeps) {}

  status() {
    return { state: this.state, seq: this.seq, hasSession: this.session !== null, fatal: this.fatal, lastEventAt: this.lastEventAt };
  }

  /** Connects unless already connected/connecting or waiting out a fatal error. Safe to call every minute. */
  async ensure(): Promise<void> {
    if (!this.loaded) {
      this.session = (await this.d.storage.get<Session>("session")) ?? null;
      this.seq = this.session?.seq ?? null;
      this.fatal = (await this.d.storage.get<{ code: number; reason: string; at: number }>("fatal")) ?? null;
      this.loaded = true;
      if (this.fatal) this.state = "fatal";
    }
    if (this.state === "fatal") {
      if (this.fatal && this.d.now() - this.fatal.at < FATAL_RETRY_MS) return;
      this.fatal = null;
      await this.d.storage.delete("fatal");
      this.state = "idle";
    }
    if (this.state !== "idle") return;
    await this.open();
  }

  private async open(): Promise<void> {
    this.state = "connecting";
    const id = ++this.connId;
    this.resuming = this.session !== null && this.seq !== null;
    const base = (this.resuming ? this.session!.resumeUrl : GATEWAY_URL).replace(/\/+$/, "");
    let ws: SocketLike;
    try {
      ws = await this.d.connect(`${base}/?v=10&encoding=json`);
    } catch (e) {
      this.d.log("warn", "gateway.connect_failed", { error: String(e) });
      this.scheduleReconnect();
      return;
    }
    if (id !== this.connId) return ws.close(1000);
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      if (id === this.connId) void this.onMessage(String(ev.data));
    });
    ws.addEventListener("close", (ev) => {
      if (id === this.connId) void this.onClose(ev.code, ev.reason);
    });
    ws.addEventListener("error", () => undefined); // a close event always follows
  }

  private send(payload: unknown): void {
    try {
      this.ws?.send(JSON.stringify(payload));
    } catch (e) {
      this.d.log("warn", "gateway.send_failed", { error: String(e) });
    }
  }

  private async onMessage(raw: string): Promise<void> {
    let p: { op: number; d: unknown; s?: number | null; t?: string | null };
    try {
      p = JSON.parse(raw);
    } catch {
      return;
    }
    this.lastEventAt = this.d.now();
    if (typeof p.s === "number") this.seq = p.s;

    switch (p.op) {
      case Op.HELLO: {
        const interval = (p.d as { heartbeat_interval: number }).heartbeat_interval;
        this.startHeartbeat(interval);
        if (this.resuming) {
          this.send({ op: Op.RESUME, d: { token: this.d.token, session_id: this.session!.sessionId, seq: this.seq } });
        } else {
          this.send({
            op: Op.IDENTIFY,
            d: { token: this.d.token, intents: INTENTS, properties: { os: "cloudflare", browser: "bounty-board", device: "bounty-board" } },
          });
        }
        return;
      }
      case Op.HEARTBEAT_ACK:
        this.awaitingAck = false;
        return;
      case Op.HEARTBEAT:
        this.beat();
        return;
      case Op.RECONNECT:
        this.d.log("info", "gateway.reconnect_requested");
        return this.drop("reconnect requested");
      case Op.INVALID_SESSION:
        if (!p.d) await this.clearSession();
        this.d.log("warn", "gateway.invalid_session", { resumable: Boolean(p.d) });
        return this.drop("invalid session", 1000 + Math.floor(this.d.random() * 4000));
      case Op.DISPATCH:
        await this.onDispatch(p.t ?? "", p.d);
        return;
    }
  }

  private async onDispatch(type: string, data: unknown): Promise<void> {
    if (type === "READY") {
      const r = data as { session_id: string; resume_gateway_url: string };
      this.session = { sessionId: r.session_id, resumeUrl: r.resume_gateway_url, seq: this.seq };
      await this.d.storage.put("session", this.session);
      this.connected("ready");
    } else if (type === "RESUMED") {
      this.connected("resumed");
    }
    try {
      await this.d.onDispatch(type, data);
    } catch (e) {
      this.d.log("error", "gateway.dispatch_failed", { type, error: String(e) });
    }
  }

  private connected(how: string): void {
    this.state = "connected";
    this.attempts = 0;
    this.d.log("info", "gateway.connected", { how });
  }

  private startHeartbeat(interval: number): void {
    this.stopHeartbeat();
    this.awaitingAck = false;
    const tick = () => {
      if (this.awaitingAck) {
        this.d.log("warn", "gateway.zombie");
        return this.drop("heartbeat not acknowledged");
      }
      this.beat();
      this.heartbeatTimer = this.d.setTimer(tick, interval);
    };
    // First beat after interval * jitter, as Discord asks.
    this.heartbeatTimer = this.d.setTimer(tick, Math.floor(interval * this.d.random()));
  }

  private beat(): void {
    this.awaitingAck = true;
    this.send({ op: Op.HEARTBEAT, d: this.seq });
    if (this.session && this.session.seq !== this.seq) {
      this.session.seq = this.seq;
      void this.d.storage.put("session", this.session);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) this.d.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Drops the current socket (keeping the session resumable) and reconnects. */
  private drop(reason: string, delayMs?: number): void {
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    this.connId++; // ignore events from the old socket
    try {
      ws?.close(4000, reason); // not 1000/1001, which would invalidate the session
    } catch {
      // already closed
    }
    this.scheduleReconnect(delayMs);
  }

  private async onClose(code: number, reason: string): Promise<void> {
    this.stopHeartbeat();
    this.ws = null;
    if (FATAL_CLOSE.has(code)) {
      this.state = "fatal";
      this.fatal = { code, reason, at: this.d.now() };
      await this.d.storage.put("fatal", this.fatal);
      this.d.log("error", "gateway.fatal", { code, reason });
      return;
    }
    if (NEW_SESSION_CLOSE.has(code)) await this.clearSession();
    this.d.log("warn", "gateway.closed", { code, reason });
    this.scheduleReconnect();
  }

  private async clearSession(): Promise<void> {
    this.session = null;
    this.seq = null;
    await this.d.storage.delete("session");
  }

  private scheduleReconnect(delayMs?: number): void {
    this.state = "backoff";
    if (this.reconnectTimer !== null) this.d.clearTimer(this.reconnectTimer);
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts) * (0.5 + this.d.random() / 2);
    this.attempts++;
    this.reconnectTimer = this.d.setTimer(() => {
      this.reconnectTimer = null;
      this.state = "idle";
      void this.open();
    }, delayMs ?? Math.floor(backoff));
  }
}
