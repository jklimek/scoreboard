// @scores/live-client: dependency-free broadcast client for overlays (06 §9, Wave 21 B02).
// Served unchanged at /broadcast/live-client.js; types in live-client.d.ts.

/** Origin this module was loaded from (the default API base URL); none for file:// copies. */
const scriptOrigin = (() => {
  try {
    const url = new URL(import.meta.url);
    return /^https?:$/.test(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
})();

export function reconnectDelay(attempt, random = Math.random) {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(Math.min(30_000, Math.max(1000, base * (0.5 + random()))));
}

export function clockElapsedMs(clock, serverNowMs) {
  if (!clock.running) return clock.elapsedMs;
  return clock.elapsedMs + Math.max(0, serverNowMs - Date.parse(clock.anchorServerTs));
}

export function formatClock(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function createClockTicker(client, getClock, onTick, intervalMs = 250) {
  const tick = () => {
    const clock = getClock();
    if (clock) onTick(clockElapsedMs(clock, client.serverNow()));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

const wsMaxChannels = 50;
const sseMaxChannels = 20;
const seenLimit = 500;
const silenceMs = 45_000;
const probeMs = 10_000;
const probeGapMs = 250;
const ackMs = 30_000;

/**
 * Follows broadcast channels over WebSocket or SSE with resume by version, jittered backoff, a
 * version guard and moment-id deduplication (see docs/live-client.md).
 */
export function createLiveClient(options) {
  const base = (options.baseUrl ?? scriptOrigin)?.replace(/\/+$/, '');
  if (!base) throw new Error('live-client: baseUrl is required outside http(s) pages');
  const names = [...new Set(options.channels)];
  if (!names.length) throw new Error('live-client: no channels');
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const random = options.random ?? Math.random;
  const key = options.key;
  // B04: stream channels keyed (SSE route; socket: key first), public ones anonymous.
  const keyed = (name) => !!key && name.startsWith('stream:');
  const sse = (list) =>
    `${base}/api/live/${keyed(list[0]) ? 'streams' : 'broadcast'}?channels=${list.join(',')}${keyed(list[0]) ? `&key=${key}` : ''}`;
  const requested = options.transport ?? 'auto';
  let transport = requested === 'sse' || !WebSocketImpl ? 'sse' : 'ws';
  /** Channel → { resume cursor, authoritative snapshot version, data, seen ids }. */
  const state = new Map(
    names.map((name) => [name, { version: 0, dataVersion: 0, data: undefined, seen: new Set() }]),
  );
  /** Server minus local clock, largest sample; a reopen keeps it until a new sample. */
  let offset = null;
  let stale = false;
  let closed = false;
  /** Sockets closed unopened in a row: `auto` moves to SSE after 1 (none ever opened) or 5. */
  let failedOpens = 0;
  let socketWorked = false;
  let connections = [];

  const report = (connection, value, extra) =>
    options.onStatus?.({ state: value, transport, channels: connection.names, ...extra });

  function sample(serverNow) {
    const value = Date.parse(serverNow) - Date.now();
    if (Number.isFinite(value) && (offset === null || stale || value > offset)) {
      offset = value;
      stale = false;
    }
  }

  /** Applies one envelope; true when it was valid for a followed channel. */
  function apply(message) {
    const channel = state.get(message?.channel);
    if (closed || !channel || !Number.isSafeInteger(message.version)) return false;
    if (message.serverNow) sample(message.serverNow);
    if (message.type === 'moment') {
      const id = message.data?.id;
      // Replay may predate the latest snapshot; live moments must be newer.
      const guard = message.replay
        ? channel.version
        : Math.max(channel.version, channel.dataVersion);
      if (message.version <= guard || id === undefined) return true;
      channel.version = Math.max(channel.version, message.version);
      if (channel.seen.has(id)) return true;
      channel.seen.add(id);
      if (channel.seen.size > seenLimit) channel.seen.delete(channel.seen.values().next().value);
      if (message.replay) options.onReplay?.(message.channel, message.data, message);
      else options.onMoment?.(message.channel, message.data, message);
      return true;
    }
    if (message.version <= Math.max(channel.version, channel.dataVersion)) return true;
    // Keep the cursor behind unseen replay if a reconnect drops after its snapshot.
    if (!channel.version || message.type === 'removed') channel.version = message.version;
    channel.dataVersion = message.version;
    if (message.type === 'snapshot') {
      channel.data = message.data;
      options.onSnapshot?.(message.channel, message.data, message);
    } else if (message.type === 'removed') {
      channel.data = undefined;
      options.onRemoved?.(message.channel, message);
    }
    return true;
  }

  /** No `removed` follows a refusal: report a client-made one; the version guard stays. */
  function unavailable(name) {
    const channel = state.get(name);
    if (closed || !channel || channel.data === undefined) return;
    channel.data = undefined;
    channel.dataVersion = Math.max(channel.version, channel.dataVersion);
    options.onRemoved?.(name, {
      v: 1,
      channel: name,
      type: 'removed',
      version: channel.dataVersion,
      serverNow: new Date(Date.now() + (offset ?? 0)).toISOString(),
      unavailable: true,
      data: null,
    });
  }

  /** Refused channels (NOT_FOUND, SSE 404) that `recover` retries. */
  const parked = new Set();
  let recoveryTimer;
  let recoveryAttempt = 0;
  let recovering = false;
  /** Bumped by `shutdown`: older async work stops before any request or callback. */
  let generation = 0;
  let probes = Promise.resolve();
  let probing;

  /** One-shot SSE request (status or undefined); one at a time, ≤ 4/s, 10 s deadline. */
  function probe(name) {
    const run = generation;
    const result = probes.then(async () => {
      if (closed || run !== generation) return;
      const abort = (probing = new AbortController());
      let timer;
      const response = await Promise.race([
        fetchImpl(sse([name]), {
          signal: abort.signal,
          cache: 'no-store',
        }).catch(() => {}),
        new Promise((resolve) => (timer = setTimeout(resolve, probeMs))),
      ]);
      clearTimeout(timer);
      abort.abort();
      return closed || run !== generation ? undefined : response?.status;
    });
    probes = result.then(() => new Promise((resolve) => setTimeout(resolve, probeGapMs)));
    return result;
  }

  function schedule() {
    if (!closed && !recovering && !recoveryTimer && parked.size)
      recoveryTimer = setTimeout(recover, reconnectDelay(recoveryAttempt++, random));
  }

  /** Drops a refused channel's data at once and parks it. */
  function refuse(name) {
    if (closed || !state.has(name)) return;
    unavailable(name);
    if (!parked.has(name)) {
      parked.add(name);
      recoveryAttempt = 0;
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    }
    schedule();
  }

  /** Probes in turn; the first answer other than 200/404 stops (a later round retries). */
  async function probeAll(names, found) {
    for (const name of names) {
      const status = await probe(name);
      if (status !== 200 && status !== 404) return;
      found(name, status);
    }
  }

  /** SSE 404 (whole stream): refuse each channel whose probe answers 404, keep the rest. */
  async function isolate(connection) {
    const drop = (name) => {
      refuse(name);
      connection.names = connection.names.filter((entry) => entry !== name);
      if (name === connection.lastName) connection.lastName = undefined;
      connection.attempt = 0;
    };
    if (connection.dead) return;
    if (connection.names.length === 1) drop(connection.names[0]);
    else await probeAll([...connection.names], (name, status) => status === 404 && drop(name));
    if (!connection.names.length) {
      connection.dead = true;
      connections = connections.filter((entry) => entry !== connection);
    }
  }

  /** Backoff round: sockets subscribe parked channels again; SSE probes rejoin streams with room. */
  async function recover() {
    const run = generation;
    recoveryTimer = undefined;
    recovering = true;
    if (transport === 'ws')
      for (const connection of connections)
        connection.subscribe?.(connection.names.filter((name) => parked.has(name)));
    else {
      const back = [];
      await probeAll([...parked], (name, status) => status === 200 && back.push(name));
      if (closed || run !== generation) return;
      const restart = new Set();
      for (const name of back) {
        parked.delete(name);
        let connection = connections.find(
          (entry) =>
            entry.names.length < sseMaxChannels && keyed(entry.names[0] ?? name) === keyed(name),
        );
        if (!connection) connections.push((connection = { names: [], attempt: 0 }));
        connection.names.push(name);
        restart.add(connection);
      }
      for (const connection of restart)
        if (connection.stop) connection.stop();
        else open(connection);
    }
    recovering = false;
    schedule();
  }

  function retry(connection) {
    if (closed || connection.dead || connection.timer) return;
    const delayMs = reconnectDelay(connection.attempt++, random);
    report(connection, 'reconnecting', { delayMs });
    connection.timer = setTimeout(() => {
      connection.timer = undefined;
      open(connection);
    }, delayMs);
  }

  function watch(connection, stop) {
    connection.last = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - connection.last > silenceMs) stop();
      else connection.ping?.();
    }, 15_000);
    return () => clearInterval(timer);
  }

  function openSocket(connection) {
    const socket = new WebSocketImpl(`${base.replace(/^http/, 'ws')}/api/live/ws`);
    let opened = false;
    let unwatch = () => {};
    let ackTimer;
    const quiet = () => {
      unwatch();
      clearTimeout(ackTimer);
      connection.subscribe = undefined;
    };
    const stop = () => {
      quiet();
      socket.onclose = socket.onmessage = socket.onerror = null;
      socket.close();
    };
    connection.stop = stop;
    connection.ping = () => socket.send('{"op":"ping"}');
    // One subscribe awaits its ack at a time; each resumes by version (buffered moments replay).
    const subscribe = (channels) => {
      if (!channels.length) return;
      connection.subscribe = undefined;
      const resume = {};
      for (const name of channels) {
        const version = state.get(name).version;
        if (version > 0) resume[name] = version;
      }
      socket.send(
        JSON.stringify({
          op: 'subscribe',
          channels,
          ...(Object.keys(resume).length ? { resume } : {}),
        }),
      );
      ackTimer = setTimeout(() => {
        stop();
        retry(connection);
      }, ackMs);
    };
    socket.onopen = () => {
      opened = socketWorked = true;
      failedOpens = 0;
      stale = true;
      if (key) socket.send(JSON.stringify({ op: 'auth', key }));
      connection.subscribe = subscribe;
      subscribe(connection.names);
      unwatch = watch(connection, () => {
        stop();
        retry(connection);
      });
      report(connection, 'open');
    };
    socket.onmessage = (event) => {
      connection.last = Date.now();
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.op === 'error') {
        options.onError?.(message);
        if (message.code === 'NOT_FOUND') refuse(message.channel);
        // A transient refusal: reconnect later and resume every channel.
        if (message.code === 'NOT_READY') {
          stop();
          retry(connection);
        }
      } else if (message.op === 'subscribed') {
        clearTimeout(ackTimer);
        connection.subscribe = subscribe;
        for (const name of message.channels ?? []) parked.delete(name);
      } else if (message.op === 'pong') sample(message.serverNow);
      else if (!message.op && apply(message)) connection.attempt = 0;
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      quiet();
      if (!opened) failedOpens++;
      if (requested === 'auto' && transport === 'ws' && failedOpens >= (socketWorked ? 5 : 1)) {
        transport = 'sse';
        start();
      } else retry(connection);
    };
  }

  function openStream(connection) {
    const abort = new AbortController();
    let unwatch = () => {};
    const stop = () => {
      unwatch();
      abort.abort();
    };
    connection.stop = stop;
    connection.ping = undefined;
    // SSE resumes one channel: the one that delivered last (as EventSource's Last-Event-ID).
    const last = connection.lastName && state.get(connection.lastName);
    const headers =
      last && last.version > 0 ? { 'Last-Event-ID': `${connection.lastName}@${last.version}` } : {};
    const url = sse(connection.names);
    (async () => {
      const response = await fetchImpl(url, { headers, signal: abort.signal, cache: 'no-store' });
      if (response.status === 404) return isolate(connection);
      if (response.status !== 200 || !response.body) throw new Error(`HTTP ${response.status}`);
      stale = true;
      unwatch = watch(connection, stop);
      report(connection, 'open');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        connection.last = Date.now();
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!data) continue;
          let message;
          try {
            message = JSON.parse(data.slice(6));
          } catch {
            continue;
          }
          if (apply(message)) {
            connection.attempt = 0;
            connection.lastName = message.channel;
          }
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        unwatch();
        retry(connection);
      });
  }

  function open(connection) {
    if (closed || connection.dead) return;
    report(connection, 'connecting');
    if (transport === 'ws') openSocket(connection);
    else openStream(connection);
  }

  function shutdown() {
    generation++;
    probing?.abort();
    probes = Promise.resolve();
    parked.clear();
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
    recovering = false;
    for (const connection of connections) {
      connection.dead = true;
      clearTimeout(connection.timer);
      connection.stop?.();
    }
  }
  function start() {
    shutdown();
    const size = transport === 'ws' ? wsMaxChannels : sseMaxChannels;
    connections = [];
    const groups = [false, true].map((k) => names.filter((name) => keyed(name) === k));
    for (const group of transport === 'ws' ? [names] : groups)
      for (let i = 0; i < group.length; i += size)
        connections.push({ names: group.slice(i, i + size), attempt: 0 });
    connections.forEach(open);
  }
  start();

  return {
    get transport() {
      return transport;
    },
    get(name) {
      const channel = state.get(name);
      return channel?.dataVersion
        ? { version: channel.dataVersion, data: channel.data }
        : undefined;
    },
    serverNow() {
      return Date.now() + (offset ?? 0);
    },
    close() {
      if (closed) return;
      closed = true;
      shutdown();
      for (const connection of connections) report(connection, 'closed');
      connections = [];
    },
  };
}
