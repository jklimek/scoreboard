// Scores profile configuration from the overlay URL fragment:
// `scoreboard.html#scores=<origin>&profile=<slug>&key=<key>[&diag=1]`.
// The fragment never reaches a server; the key goes only to the live client's WebSocket auth frame.

export interface ScoresConfig {
  /** Scores origin, e.g. `https://scores.example.org` (no path). */
  readonly origin: string;
  /** Stream profile slug. */
  readonly profile: string;
  /** B04 stream key; non-enumerable so it never appears in a serialized or logged config. */
  readonly key: string;
  /** Operator diagnostics chip (`diag=1`); off on air by default. */
  readonly diag: boolean;
}

export type SetupProblem =
  | "missing-origin"
  | "invalid-origin"
  | "missing-profile"
  | "invalid-profile"
  | "missing-key"
  | "invalid-key";

export type ConfigResult =
  | { readonly ok: true; readonly config: ScoresConfig }
  | { readonly ok: false; readonly problem: SetupProblem; readonly diag: boolean };

/** Scores `broadcastStreamSlugPattern` (stream profile slugs, 3 to 48 characters). */
export const profileSlugPattern = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
/** Scores `broadcastStreamKeyPattern`: 32 random bytes, base64url without padding. */
export const streamKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `https:` origins, or `http:` on loopback only; no credentials, path, query or fragment. */
export function parseScoresOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!secure && !loopback) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  return url.origin;
}

export function parseScoresFragment(hash: string): ConfigResult {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const diag = params.get("diag") === "1";
  const fail = (problem: SetupProblem): ConfigResult => ({ ok: false, problem, diag });
  const scores = params.get("scores");
  const profile = params.get("profile");
  const key = params.get("key");
  if (!scores) return fail("missing-origin");
  const origin = parseScoresOrigin(scores);
  if (!origin) return fail("invalid-origin");
  if (!profile) return fail("missing-profile");
  if (!profileSlugPattern.test(profile)) return fail("invalid-profile");
  if (!key) return fail("missing-key");
  if (!streamKeyPattern.test(key)) return fail("invalid-key");
  const config = { origin, profile, diag } as ScoresConfig;
  Object.defineProperty(config, "key", { value: key, enumerable: false });
  return { ok: true, config: Object.freeze(config) };
}
