// Deterministic fake of the Scores live WebSocket protocol (`apps/api/src/live/ws.ts` and `hub.ts`
// at the pinned commit): `{op:"auth",key}` first; `subscribe` resumes `if-behind` (the retained
// snapshot, restamped with the current `serverNow`, only for a channel whose resume version is
// behind; buffered moments newer than the resume version replay with `replay: true`), then
// `subscribed`; envelopes `{v:1,channel,type,version,serverNow,data}` share one version sequence;
// `pong` carries `serverNow`. A refused key answers `error NOT_FOUND` and closes 1008, at auth or
// while connected (B06-UP); a connection overdue for verification closes 1008 without a frame.
// The replay ring keeps only moments the current projection still carries (`hub.ts` rebuilds it on
// every snapshot): a switched game's moments leave it, a voided play moment leaves it (modelled as
// "the moment's game is the snapshot's and its id is in the timeline, or it is a correction").
// Test-only; transport adapters below.
import { readFileSync } from "node:fs";

export const fixtureKey = "W31fixtureKEY_not-a-real-key_00000000000000"; // 43 base64url characters
export const fixtureProfile = "w31-fixture";

type Envelope = {
  v: 1;
  channel: string;
  type: "snapshot" | "moment" | "removed";
  version: number;
  serverNow: string;
  replay?: true;
  data: unknown;
};

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

/** A hub channel: the retained snapshot (or `removed`) and the moment replay ring. */
interface HubChannel {
  latest: Envelope;
  moments: { envelope: Envelope; gameId: string | undefined }[];
}

type GameData = { game?: { id?: string }; timeline?: { id?: string }[] } | null;
const gameOf = (envelope: Envelope) => (envelope.type === "snapshot" ? (envelope.data as GameData)?.game?.id : undefined);
const corrections = new Set(["event.voided", "event.amended", "result.official"]);

export interface FakeScoresOptions {
  /** Valid key → profile slug. */
  keys?: Record<string, string>;
  /** Server time (ms); defaults to the local clock. */
  now?: () => number;
}

export function createFakeScores(options: FakeScoresOptions = {}) {
  const keys = new Map(Object.entries(options.keys ?? { [fixtureKey]: fixtureProfile }));
  const now = options.now ?? Date.now;
  const channels = new Map<string, HubChannel>();
  const connections = new Set<Connection>();
  /** Every client frame, in order (the key value is replaced so logs never hold it). */
  const received: unknown[] = [];
  /** Every server frame, in order. */
  const sent: Record<string, unknown>[] = [];
  /** Test switches: refuse auth transiently, or reject every channel name (protocol mismatch). */
  const faults: { auth?: "LIMIT" | "NOT_READY"; invalidChannels?: boolean } = {};
  let version = 0;

  const serverNow = () => new Date(now()).toISOString();
  const stamp = (envelope: Envelope, channel: string): Envelope => ({
    ...envelope,
    channel,
    version: ++version,
    serverNow: serverNow(),
  });
  const parse = (name: string) =>
    /^stream:([a-z0-9][a-z0-9-]{1,46}[a-z0-9]):(game|court|leaders|standings|roster:home|roster:away)$/.exec(name);
  const hubChannel = (name: string) => {
    // A profile with nothing to show streams `removed` (the hub reads stream keys with removed).
    let channel = channels.get(name);
    if (!channel) channels.set(name, (channel = { latest: stamp({ ...fixture("removed"), data: null }, name), moments: [] }));
    return channel;
  };

  function end(connection: Connection, code: number, reason: string) {
    if (connection.ended) return;
    connection.ended = true;
    connections.delete(connection);
    connection.peer.close(code, reason);
  }
  const control = (connection: Connection, message: object) => {
    if (connection.ended) return;
    sent.push(message as Record<string, unknown>);
    connection.peer.send(JSON.stringify(message));
  };
  const error = (connection: Connection, code: string, message: string, channel?: string) =>
    control(connection, { op: "error", code, ...(channel === undefined ? {} : { channel }), message });

  function auth(connection: Connection, key: string) {
    if (connection.authSeen || connection.subscribed.size)
      return error(connection, "VALIDATION_ERROR", "auth must come once, before any subscribe");
    connection.authSeen = true;
    const slug = keys.get(key);
    if (!slug) {
      error(connection, "NOT_FOUND", "Unknown stream key");
      return end(connection, 1008, "stream key refused");
    }
    if (faults.auth === "NOT_READY") {
      error(connection, "NOT_READY", "Stream key check temporarily unavailable");
      return end(connection, 1013, "try again later");
    }
    if (faults.auth === "LIMIT") {
      error(connection, "LIMIT", "Too many connections for this stream key");
      return end(connection, 1008, "stream key limit");
    }
    connection.slug = slug;
    connection.key = key;
  }

  function subscribe(connection: Connection, names: string[], resume: Record<string, number>) {
    names = [...new Set(names)];
    const invalid = names.find((name) => faults.invalidChannels || !parse(name));
    // No `subscribed` follows: the client's ack timeout reconnects.
    if (invalid !== undefined) return error(connection, "VALIDATION_ERROR", "Invalid channel name", invalid);
    const stray = Object.keys(resume).find((name) => !names.includes(name));
    if (stray !== undefined) return error(connection, "VALIDATION_ERROR", "Resume names a channel not subscribed", stray);
    for (const name of names.filter((entry) => !connection.subscribed.has(entry))) {
      if (connection.slug !== parse(name)![1]) {
        error(connection, "NOT_FOUND", "Unknown or non-public channel", name);
        continue;
      }
      const channel = hubChannel(name);
      connection.subscribed.add(name);
      const from = resume[name];
      // `resume: 'if-behind'`: no snapshot for a client that already holds the latest version;
      // otherwise the retained one, restamped for this subscriber (Q33/IF-92).
      if (!(from !== undefined && channel.latest.version <= from))
        control(connection, { ...channel.latest, serverNow: serverNow() });
      if (from !== undefined)
        for (const { envelope } of channel.moments)
          if (envelope.version > from) control(connection, { ...envelope, replay: true });
    }
    control(connection, { op: "subscribed", channels: names.filter((name) => connection.subscribed.has(name)) });
  }

  function handle(connection: Connection, message: Record<string, unknown>) {
    if (message.op === "auth") return auth(connection, String(message.key));
    if (message.op === "ping") return control(connection, { op: "pong", serverNow: serverNow() });
    if (message.op !== "subscribe" || !Array.isArray(message.channels))
      return error(connection, "VALIDATION_ERROR", "Unknown or invalid operation");
    subscribe(connection, message.channels as string[], (message.resume ?? {}) as Record<string, number>);
  }

  /** Versions and retains an envelope (moments in the replay ring, last 50), then sends it. */
  function publish(slug: string, envelope: Envelope) {
    const name = `stream:${slug}:game`;
    const channel = hubChannel(name);
    const stamped = stamp(envelope, name);
    if (stamped.type === "moment")
      channel.moments = [...channel.moments, { envelope: stamped, gameId: gameOf(channel.latest) }].slice(-50);
    else {
      channel.latest = stamped;
      const data = stamped.data as GameData;
      const ids = new Set((data?.timeline ?? []).map((entry) => entry.id));
      const kept = ({ envelope: moment, gameId }: HubChannel["moments"][number]) => {
        const { id, kind } = moment.data as { id: string; kind: string };
        return gameId === gameOf(stamped) && (corrections.has(kind) || ids.has(id));
      };
      channel.moments = stamped.type === "removed" ? [] : channel.moments.filter(kept);
    }
    for (const connection of connections) if (connection.subscribed.has(name)) control(connection, stamped);
    return stamped;
  }

  return {
    received,
    sent,
    faults,
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
            return error(connection, "VALIDATION_ERROR", "Message is not JSON");
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
    /** Publishes a fixture snapshot for the profile's game stream (new version, current serverNow). */
    snapshot: (name: string, slug = fixtureProfile) => publish(slug, { ...fixture(name), type: "snapshot" }),
    /** Publishes arbitrary snapshot data (e.g. an unsupported payload, a re-anchored clock). */
    snapshotData: (data: unknown, slug = fixtureProfile) =>
      publish(slug, { ...fixture("game-live"), type: "snapshot", data }),
    /** A moment: sent to subscribers and kept in the replay ring. */
    moment: (name: string, slug = fixtureProfile) => publish(slug, { ...fixture(name), type: "moment" }),
    /** Arbitrary moment data, versioned like `moment`. */
    momentData: (data: unknown, slug = fixtureProfile) => publish(slug, { ...fixture("moment-goal"), type: "moment", data }),
    /** The ring's moments for a profile (version and id), oldest first. */
    ring: (slug = fixtureProfile) =>
      (channels.get(`stream:${slug}:game`)?.moments ?? []).map(({ envelope }) => ({
        version: envelope.version,
        id: (envelope.data as { id: string }).id,
      })),
    /**
     * Adverse ordering the real hub never produces: sends an envelope as given (its own version,
     * e.g. one older than the latest snapshot) to every subscriber, without retaining it.
     */
    deliver(envelope: Envelope, slug = fixtureProfile) {
      const name = `stream:${slug}:game`;
      const message = { ...envelope, channel: name, serverNow: serverNow() };
      for (const connection of connections) if (connection.subscribed.has(name)) control(connection, message);
      return message;
    },
    /** The profile has nothing to show any more: a `removed` envelope (also served to new subscribers). */
    remove: (slug = fixtureProfile) => publish(slug, { ...fixture("removed"), type: "removed", data: null }),
    /** Revokes a key: its sockets get `error NOT_FOUND` then a 1008 close; later auths are refused. */
    revoke(key = fixtureKey) {
      keys.delete(key);
      for (const connection of [...connections])
        if (connection.key === key) {
          error(connection, "NOT_FOUND", "Unknown stream key");
          end(connection, 1008, "stream key refused");
        }
    },
    /** The verification-failure bound (checks failing): a 1008 close without any frame; the key stays valid. */
    overdue(key = fixtureKey) {
      for (const connection of [...connections]) if (connection.key === key) end(connection, 1008, "stream key refused");
    },
    /** A message flood: `RATE_LIMITED` then a 1008 close for every socket. */
    rateLimit() {
      for (const connection of [...connections]) {
        error(connection, "RATE_LIMITED", "Too many messages");
        end(connection, 1008, "rate limited");
      }
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
