// Hand-written types for the plain ESM `live-client.js` (no build step).

/** A B01 broadcast envelope as delivered over WebSocket or SSE. */
export interface LiveEnvelope<T = unknown> {
  v: 1;
  channel: string;
  type: 'snapshot' | 'moment' | 'removed';
  version: number;
  serverNow: string;
  replay?: true;
  /**
   * Client-made `removed`: a reconnect found the channel unknown or non-public (WebSocket
   * `NOT_FOUND`, SSE 404), `version` = the newest version seen.
   */
  unavailable?: true;
  data: T;
}
export interface LiveMoment {
  id: string;
  kind: string;
  [key: string]: unknown;
}
export interface LiveStatus {
  state: 'connecting' | 'open' | 'reconnecting' | 'closed';
  transport: 'ws' | 'sse';
  /** Channels of the connection this status is about. */
  channels: string[];
  /** Reconnect delay (`reconnecting`). */
  delayMs?: number;
}
export interface LiveError {
  op: 'error';
  code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'NOT_READY' | 'LIMIT' | 'RATE_LIMITED';
  channel?: string;
  message: string;
}
export interface LiveClock {
  running: boolean;
  elapsedMs: number;
  anchorServerTs: string;
}
export interface LiveClientOptions {
  /** Channel names (`game:{id}`, `competition:{id}`, `org:{slug}:live`, `stream:{slug}:game` with `key`, ...). */
  channels: string[];
  /** API origin; defaults to the origin this script was loaded from. */
  baseUrl?: string;
  /**
   * B04 stream key of a stream profile, for its `stream:{slug}:{part}` channels (and public ones
   * on the same connections): sent as the first WebSocket message (`{op:"auth"}`) or `&key=` on the
   * keyed SSE route `/api/live/streams`. A refused key (unknown, revoked, expired, another
   * profile's) closes the socket and refuses the SSE stream like an unknown channel: the client
   * keeps retrying with backoff and reports `onError`/`onRemoved`. Never logged by the client.
   */
  key?: string;
  /** `auto` (default): WebSocket, falling back to SSE when a socket cannot open. */
  transport?: 'auto' | 'ws' | 'sse';
  onSnapshot?(channel: string, data: unknown, message: LiveEnvelope): void;
  /** Once per moment id and channel; never for `replay: true` moments. */
  onMoment?(channel: string, moment: LiveMoment, message: LiveEnvelope<LiveMoment>): void;
  /** Unseen buffered moments on resume; may predate the authoritative snapshot. Do not animate. */
  onReplay?(channel: string, moment: LiveMoment, message: LiveEnvelope<LiveMoment>): void;
  /**
   * The target stopped being public: a `removed` message, or (`unavailable: true`) a refusal on
   * reconnect for a channel that showed data (reported as soon as that channel's refusal is
   * confirmed). `get` then has no data until a newer snapshot; the client retries a refused
   * channel with backoff (WebSocket: one resuming subscribe at a time on the same socket; SSE:
   * one-shot probes, where only 200 or 404 counts and a 429 keeps the channel, then it rejoins a
   * stream with room).
   */
  onRemoved?(channel: string, message: LiveEnvelope<null>): void;
  onStatus?(status: LiveStatus): void;
  /** WebSocket control errors (`NOT_FOUND` for an unknown or non-public channel, ...). */
  onError?(error: LiveError): void;
  /** Injection points (tests, other runtimes). */
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
  random?: () => number;
}
export interface LiveClient {
  readonly transport: 'ws' | 'sse';
  /** The channel's current snapshot (or `removed`, `data` undefined) and its version. */
  get(channel: string): { version: number; data: unknown } | undefined;
  /** Estimated server time in ms since the epoch (from `serverNow`). */
  serverNow(): number;
  /** Stops every connection, probe and retry; reports `closed`, then no callback fires. */
  close(): void;
}
export function createLiveClient(options: LiveClientOptions): LiveClient;
export function reconnectDelay(attempt: number, random?: () => number): number;
export function clockElapsedMs(clock: LiveClock, serverNowMs: number): number;
export function formatClock(ms: number): string;
export function createClockTicker(
  client: Pick<LiveClient, 'serverNow'>,
  getClock: () => LiveClock | null | undefined,
  onTick: (elapsedMs: number) => void,
  intervalMs?: number,
): () => void;
