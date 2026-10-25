// Deterministic fake of the Scores live WebSocket protocol (`apps/api/src/live/ws.ts` at the pinned
// release): `{op:"auth",key}` first, `subscribe` → snapshot (if behind) then `subscribed`, envelopes
// `{v:1,channel,type,version,serverNow,data}`, a refused key answers `error NOT_FOUND` and closes
// 1008, a revoked key closes authenticated sockets 1008. Test-only; transport adapters below.
import { readFileSync } from "node:fs";

export const fixtureKey = "W31fixtureKEY_not-a-real-key_00000000000000"; // 43 base64url characters
export const fixtureProfile = "w31-fixture";

type Envelope = { v: 1; channel: string; type: "snapshot" | "moment" | "removed"; version: number; serverNow: string; data: unknown };

export function fixture(name: string): Envelope {
  return JSON.parse(readFileSync(new URL(`../fixtures/scores/${name}.json`, import.meta.url), "utf8")) as Envelope;
}

/** One server-side socket; `send`/`close` are the transport's. */
export interface FakePeer {
  send(text: string): void;
  close(code: number, reason: string): void;
  /** Abnormal transport loss (no close frame). */
  drop(): void;
}

interface Connection {
  peer: FakePeer;
  slug: string | undefined;
  key: string | undefined;
  authSeen: boolean;
  subscribed: Set<string>;
  ended: boolean;
}

export interface FakeScoresOptions {
  /** Valid key → profile slug. */
  keys?: Record<string, string>;
  now?: () => number;
}

export function createFakeScores(options: FakeScoresOptions = {}) {
  const keys = new Map(Object.entries(options.keys ?? { [fixtureKey]: fixtureProfile }));
  const now = options.now ?? Date.now;
  /** Hub key `slug:part` → the current snapshot or removed envelope. */
  const current = new Map<string, Envelope>();
  const connections = new Set<Connection>();
  /** Every client frame, in order (the key value is replaced so logs never hold it). */
  const received: unknown[] = [];
  let version = 0;

  const stamp = (envelope: Envelope, channel: string): Envelope => ({
    ...envelope,
    channel,
    version: ++version,
    serverNow: new Date(now()).toISOString(),
  });
  const parse = (name: string) => /^stream:([a-z0-9][a-z0-9-]{1,46}[a-z0-9]):(game|court|leaders|standings|roster:home|roster:away)$/.exec(name);

  function end(connection: Connection, code: number, reason: string) {
    if (connection.ended) return;
    connection.ended = true;
    connections.delete(connection);
    connection.peer.close(code, reason);
  }
  const control = (connection: Connection, message: object) => {
    if (!connection.ended) connection.peer.send(JSON.stringify(message));
  };

  function handle(connection: Connection, message: Record<string, unknown>) {
    if (message.op === "auth") {
      if (connection.authSeen || connection.subscribed.size)
        return control(connection, { op: "error", code: "VALIDATION_ERROR", message: "auth must come once, before any subscribe" });
      connection.authSeen = true;
      const slug = keys.get(String(message.key));
      if (!slug) {
        control(connection, { op: "error", code: "NOT_FOUND", message: "Unknown stream key" });
        return end(connection, 1008, "stream key refused");
      }
      connection.slug = slug;
      connection.key = String(message.key);
      return;
    }
    if (message.op === "ping") return control(connection, { op: "pong", serverNow: new Date(now()).toISOString() });
    if (message.op !== "subscribe" || !Array.isArray(message.channels))
      return control(connection, { op: "error", code: "VALIDATION_ERROR", message: "Unknown or invalid operation" });
    const resume = (message.resume ?? {}) as Record<string, number>;
    for (const name of message.channels as string[]) {
      const match = parse(name);
      if (!match) return control(connection, { op: "error", code: "VALIDATION_ERROR", channel: name, message: "Invalid channel name" });
      if (connection.slug !== match[1]) {
        control(connection, { op: "error", code: "NOT_FOUND", channel: name, message: "Unknown or non-public channel" });
        continue;
      }
      // A profile with nothing to show streams `removed` (the hub reads stream keys with removed).
      const hubKey = `${match[1]}:${match[2]}`;
      if (!current.has(hubKey)) current.set(hubKey, stamp({ ...fixture("removed"), data: null }, name));
      const state = current.get(hubKey)!;
      connection.subscribed.add(name);
      // `if-behind` resume: a snapshot only for a client that holds an older version.
      if (!(resume[name] !== undefined && resume[name]! >= state.version)) control(connection, { ...state, channel: name });
    }
    control(connection, { op: "subscribed", channels: (message.channels as string[]).filter((name) => connection.subscribed.has(name)) });
  }

  function broadcast(slug: string, part: string, envelope: Envelope) {
    const channel = `stream:${slug}:${part}`;
    for (const connection of connections)
      if (connection.subscribed.has(channel)) control(connection, envelope);
  }

  return {
    received,
    get connections() {
      return connections.size;
    },
    /** A new server-side socket for a transport; returns its message handler. */
    connect(peer: FakePeer) {
      const connection: Connection = { peer, slug: undefined, key: undefined, authSeen: false, subscribed: new Set(), ended: false };
      connections.add(connection);
      return {
        receive(text: string) {
          if (connection.ended) return;
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(text) as Record<string, unknown>;
          } catch {
            return control(connection, { op: "error", code: "VALIDATION_ERROR", message: "Message is not JSON" });
          }
          // Logged without the key value: `validKey` says whether it was a known key.
          received.push(message.op === "auth" ? { op: "auth", validKey: keys.has(String(message.key)) } : message);
          handle(connection, message);
        },
        closed() {
          connection.ended = true;
          connections.delete(connection);
        },
      };
    },
    /** Publishes a fixture snapshot for the profile's game stream (re-stamped version/serverNow). */
    snapshot(name: string, slug = fixtureProfile) {
      const envelope = stamp({ ...fixture(name), type: "snapshot" }, `stream:${slug}:game`);
      current.set(`${slug}:game`, envelope);
      broadcast(slug, "game", envelope);
      return envelope;
    },
    /** Publishes arbitrary snapshot data (e.g. an unsupported payload). */
    snapshotData(data: unknown, slug = fixtureProfile) {
      const envelope = stamp({ ...fixture("game-live"), type: "snapshot", data }, `stream:${slug}:game`);
      current.set(`${slug}:game`, envelope);
      broadcast(slug, "game", envelope);
      return envelope;
    },
    /** Updates the stored snapshot without sending it (it happened during an outage). */
    snapshotQuietly(name: string, slug = fixtureProfile) {
      const envelope = stamp({ ...fixture(name), type: "snapshot" }, `stream:${slug}:game`);
      current.set(`${slug}:game`, envelope);
      return envelope;
    },
    moment(name: string, slug = fixtureProfile) {
      const envelope = stamp({ ...fixture(name), type: "moment" }, `stream:${slug}:game`);
      broadcast(slug, "game", envelope);
      return envelope;
    },
    /** The profile has nothing to show any more: a `removed` envelope (also served to new subscribers). */
    remove(slug = fixtureProfile) {
      const envelope = stamp({ ...fixture("removed"), type: "removed", data: null }, `stream:${slug}:game`);
      current.set(`${slug}:game`, envelope);
      broadcast(slug, "game", envelope);
      return envelope;
    },
    /** Revokes a key: its authenticated sockets close 1008 at once, later auths are refused. */
    revoke(key = fixtureKey) {
      keys.delete(key);
      for (const connection of [...connections]) if (connection.key === key) end(connection, 1008, "stream key refused");
    },
    /** Transport loss for every socket (no close frame). */
    dropAll() {
      for (const connection of [...connections]) {
        connection.ended = true;
        connections.delete(connection);
        connection.peer.drop();
      }
    },
  };
}
export type FakeScores = ReturnType<typeof createFakeScores>;

/**
 * In-memory `WebSocket` for the pinned client. Frames are delivered asynchronously (microtasks),
 * as a real socket would; `down` makes new sockets fail before opening.
 */
export function fakeWebSocket(scores: FakeScores) {
  const sockets: { url: string; closed: boolean; sent: string[] }[] = [];
  const control = { down: false, sockets };
  class FakeWebSocket {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readonly url: string;
    private server: ReturnType<FakeScores["connect"]> | undefined;
    private record: { url: string; closed: boolean; sent: string[] };
    constructor(url: string) {
      this.url = url;
      this.record = { url, closed: false, sent: [] };
      sockets.push(this.record);
      if (control.down) {
        queueMicrotask(() => this.finish(1006));
        return;
      }
      queueMicrotask(() => {
        if (this.record.closed) return;
        this.server = scores.connect({
          send: (text) => queueMicrotask(() => !this.record.closed && this.onmessage?.({ data: text })),
          close: (code) => queueMicrotask(() => this.finish(code)),
          drop: () => queueMicrotask(() => this.finish(1006)),
        });
        this.onopen?.({});
      });
    }
    send(text: string) {
      if (this.record.closed) throw new Error("send on a closed socket");
      this.record.sent.push(text);
      const server = this.server;
      queueMicrotask(() => server?.receive(text));
    }
    close() {
      this.record.closed = true;
      this.server?.closed();
    }
    private finish(code: number) {
      if (this.record.closed) return;
      this.record.closed = true;
      this.server?.closed();
      this.onclose?.({ code });
    }
  }
  return { WebSocket: FakeWebSocket as unknown as typeof WebSocket, control };
}
