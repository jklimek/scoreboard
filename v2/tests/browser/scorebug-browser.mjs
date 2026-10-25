// OBS-like acceptance check (S1-A5): headless Chromium loads the built scoreboard.html against a
// local deterministic fake Scores (real WebSocket protocol, synthetic fixtures). Dev only.
// Usage: npm run test:browser   (ports: SCOREBOARD_PORT=8131, FAKE_SCORES_PORT=8141)
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { WebSocketServer } from "ws";
import { createFakeScores, fixture, fixtureKey, fixtureProfile } from "../support/fake-scores.ts";

const scoreboardPort = Number(process.env.SCOREBOARD_PORT ?? 8131);
const scoresPort = Number(process.env.FAKE_SCORES_PORT ?? 8141);
const publicDir = fileURLToPath(new URL("../../apps/obs-views/public/", import.meta.url));
const scoresOrigin = `http://127.0.0.1:${scoresPort}`;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".map": "application/json" };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** What each server saw. */
const log = { scoreboard: [], scoreboardUpgrades: [], scores: [], scoresUpgrades: [], external: [] };

// The scoreboard's static OBS pages (as FastAPI serves them at /ui/obs/); legacy APIs answer 404.
const scoreboard = createServer(async (request, response) => {
  log.scoreboard.push(`${request.method} ${request.url}`);
  const path = new URL(request.url, "http://x").pathname;
  if (path === "/api/v1/obs-config") {
    response.writeHead(200, { "content-type": "application/json" }).end('{"bgColor":"#00000000"}');
    return;
  }
  const relative = path.startsWith("/ui/obs/") ? normalize(path.slice("/ui/obs/".length)) : null;
  if (!relative || relative.startsWith("..")) return void response.writeHead(404).end();
  try {
    const body = await readFile(join(publicDir, relative));
    response.writeHead(200, { "content-type": types[extname(relative)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
scoreboard.on("upgrade", (request, socket) => {
  log.scoreboardUpgrades.push(request.url);
  socket.destroy();
});

// Fake Scores: the live WebSocket and logo images; nothing else exists.
const hub = createFakeScores();
const wss = new WebSocketServer({ noServer: true });
let down = false;
const fakeScores = createServer((request, response) => {
  log.scores.push(`${request.method} ${request.url}`);
  if (request.url.startsWith("/api/public/v1/broadcast/logos/")) {
    response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=300" }).end(png);
  } else response.writeHead(404).end();
});
fakeScores.on("upgrade", (request, socket, head) => {
  log.scoresUpgrades.push(request.url);
  if (down || request.url !== "/api/live/ws") return void socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => {
    const connection = hub.connect({
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
      drop: () => ws.terminate(),
    });
    ws.on("message", (data) => connection.receive(String(data)));
    ws.on("close", () => connection.closed());
  });
});

/** Fixture data with its clock anchored now (fixtures carry fixed instants). */
function live(name) {
  const data = structuredClone(fixture(name).data);
  data.clock.anchorServerTs = new Date().toISOString();
  return data;
}

const listen = (server, port) => new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
await listen(scoreboard, scoreboardPort);
await listen(fakeScores, scoresPort);
const browser = await chromium.launch({ headless: true });
const results = [];
const check = async (name, run) => {
  const started = Date.now();
  await run();
  results.push(`ok ${results.length + 1} - ${name} (${Date.now() - started} ms)`);
  console.log(results.at(-1));
};

async function openPage(params) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const requests = [];
  const sockets = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("websocket", (socket) => sockets.push(socket.url()));
  // OBS hosts are offline-safe: third-party font requests are blocked and recorded.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    log.external.push(url.origin);
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__bumps = 0;
    new MutationObserver((records) => {
      for (const record of records)
        if (/scale\(1\.[1-9]/.test(record.target.getAttribute("style") ?? "")) window.__bumps++;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["style"] });
  });
  const fragment = new URLSearchParams(params).toString();
  await page.goto(`http://127.0.0.1:${scoreboardPort}/ui/obs/scoreboard.html#${fragment}`);
  return { page, requests, sockets };
}
const status = (page) => page.evaluate(() => document.body.dataset.sourceStatus);
const waitStatus = (page, value, timeout = 20_000) =>
  page.waitForFunction((expected) => document.body.dataset.sourceStatus === expected, value, { timeout });
const text = (page, id) => page.evaluate((element) => document.getElementById(element)?.textContent ?? "", id);
const bumps = (page) => page.evaluate(() => window.__bumps);
const empty = (page) => page.evaluate(() => document.querySelector(".overlay-scoreboard").classList.contains("is-empty"));
const clockSeconds = async (page) => {
  const [minutes, seconds] = (await text(page, "game-clock")).split(":").map(Number);
  return minutes * 60 + seconds;
};
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = { scores: scoresOrigin, profile: fixtureProfile, key: fixtureKey, diag: "1" };

let main;
try {
  await check("the module loads, uses the WebSocket and renders the scorebug", async () => {
    hub.snapshotData(live("game-live"));
    main = await openPage(profile);
    await waitStatus(main.page, "live");
    assert.equal(await text(main.page, "home-name"), "W31 Fixture Home");
    assert.equal(await text(main.page, "away-name"), "W31 Fixture Away");
    assert.deepEqual([await text(main.page, "home-score"), await text(main.page, "away-score")], ["3", "2"]);
    assert.equal(await empty(main.page), false);
    const logo = await main.page.evaluate(() => document.getElementById("home-logo").src);
    assert.equal(logo, `${scoresOrigin}/api/public/v1/broadcast/logos/00000000-0000-4000-8000-000000000201/128?v=1`);
    assert.equal(await main.page.evaluate(() => document.getElementById("away-logo").hidden), true);
    assert.equal(await main.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--team-h-color").trim()), "#1b6f7d");
    const chip = await main.page.evaluate(() => document.querySelector(".source-status-chip").textContent);
    assert.equal(chip, `Scores: live · ${fixtureProfile}`);
    assert.deepEqual(main.sockets, [`ws://127.0.0.1:${scoresPort}/api/live/ws`]);
    const before = await clockSeconds(main.page);
    await settle(3200);
    const after = await clockSeconds(main.page);
    assert.ok(after >= before + 2, `the clock runs locally (${before} -> ${after})`);
    assert.equal(await bumps(main.page), 0, "no animation on the first render");
  });

  await check("degraded: a dropped server keeps the score and the clock advancing", async () => {
    down = true;
    hub.dropAll();
    await waitStatus(main.page, "degraded");
    const before = await clockSeconds(main.page);
    await settle(3200);
    assert.equal(await status(main.page), "degraded");
    assert.deepEqual([await text(main.page, "home-score"), await text(main.page, "away-score")], ["3", "2"]);
    assert.equal(await text(main.page, "home-name"), "W31 Fixture Home");
    assert.equal(await empty(main.page), false, "the last game stays on air");
    assert.ok((await clockSeconds(main.page)) >= before + 3, "the clock keeps running while degraded");
    assert.match(await main.page.evaluate(() => document.querySelector(".source-status-chip").textContent), /degraded/);
  });

  await check("resync on reconnect replaces the state without animating; live updates bump", async () => {
    // A goal during the outage (no socket is connected, so it is only stored).
    hub.snapshotData(live("game-live-goal"));
    down = false;
    await waitStatus(main.page, "live", 40_000);
    await main.page.waitForFunction(() => document.getElementById("home-score").textContent === "4");
    assert.equal(await bumps(main.page), 0, "a resync never animates");
    assert.ok(main.sockets.length >= 2 && main.sockets.every((url) => url === `ws://127.0.0.1:${scoresPort}/api/live/ws`));
    hub.snapshotData(live("game-official"));
    await main.page.waitForFunction(() => document.getElementById("home-score").textContent === "15");
    assert.ok((await bumps(main.page)) > 0, "a live snapshot of the same game bumps the digits");
    assert.equal(await text(main.page, "game-clock"), "90:00", "a stopped official clock");
  });

  await check("unavailable: removed clears the scorebug at once", async () => {
    hub.remove();
    await waitStatus(main.page, "unavailable");
    assert.equal(await empty(main.page), true);
    assert.deepEqual(
      await Promise.all(["home-name", "away-name", "home-score", "away-score", "game-clock"].map((id) => text(main.page, id))),
      ["", "", "", "", ""],
    );
    hub.snapshotData(live("game-live"));
    await waitStatus(main.page, "live");
    assert.equal(await text(main.page, "home-score"), "3");
  });

  await check("a missing result shows neutral placeholders, never 0:0", async () => {
    hub.snapshotData(live("game-no-result"));
    await main.page.waitForFunction(() => document.getElementById("home-name").textContent === "W31 Fixture Next");
    assert.deepEqual([await text(main.page, "home-score"), await text(main.page, "away-score")], ["-", "-"]);
    assert.equal(await text(main.page, "away-name"), "Away");
    assert.equal(await main.page.evaluate(() => document.getElementById("away-team-card").classList.contains("is-placeholder")), true);
    assert.equal(await text(main.page, "game-clock"), "0:00");
  });

  await check("unavailable: a revoked key clears the scorebug on the refused reconnect", async () => {
    hub.revoke();
    await waitStatus(main.page, "unavailable", 20_000);
    assert.equal(await empty(main.page), true);
    await settle(3000);
    assert.equal(await status(main.page), "unavailable", "retries never bring old data back");
    assert.equal(await text(main.page, "home-name"), "");
  });

  await check("unavailable: an unknown key never shows data", async () => {
    const { page } = await openPage({ ...profile, key: "W31fixtureKEY_browser-unknown_0000000000000" });
    await waitStatus(page, "unavailable", 20_000);
    assert.equal(await empty(page), true);
    await page.close();
  });

  await check("setup errors open no connection", async () => {
    for (const params of [
      { ...profile, key: "short" },
      { ...profile, scores: "http://scores.example.invalid" },
      { ...profile, profile: "Bad_Slug" },
      { diag: "1" },
    ]) {
      const { page, sockets, requests } = await openPage(params);
      await waitStatus(page, "setup-error", 5000);
      await settle(300);
      assert.deepEqual(sockets, []);
      assert.deepEqual(requests.filter((url) => url.startsWith(scoresOrigin)), []);
      assert.equal(await empty(page), true);
      const chip = await page.evaluate(() => document.querySelector(".source-status-chip").textContent);
      assert.match(chip, /^Scores: setup-error · /);
      await page.close();
    }
  });

  await check("no Scores polling and no legacy scoreboard endpoints", async () => {
    const all = [...main.requests, ...log.scoreboard, ...log.scores, ...log.scoresUpgrades];
    // Fake Scores saw only WebSocket upgrades plus the snapshot's logo image (display content).
    assert.ok(log.scores.every((entry) => entry.startsWith("GET /api/public/v1/broadcast/logos/")), log.scores.join(", "));
    assert.ok(log.scoresUpgrades.every((url) => url === "/api/live/ws"));
    assert.deepEqual(log.scoreboardUpgrades, [], "never the scoreboard's Python /ws");
    assert.ok(log.scoreboard.every((entry) => !/\/api\/v1\/snapshot|main\.js/.test(entry)), log.scoreboard.join(", "));
    assert.ok(all.every((entry) => !entry.includes(fixtureKey)), "the key never appears in a URL");
    assert.ok(log.external.every((origin) => /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(origin)));
  });
} finally {
  await browser.close();
  wss.close();
  scoreboard.closeAllConnections();
  fakeScores.closeAllConnections();
  scoreboard.close();
  fakeScores.close();
}
console.log(`\n${results.length} browser checks passed`);
console.log(
  `fake Scores: ${log.scoresUpgrades.length} WebSocket upgrades, ${log.scores.length} HTTP requests (logo images only); ` +
    `scoreboard: ${log.scoreboard.length} static requests, ${log.scoreboardUpgrades.length} upgrades`,
);
console.log(`scoreboard paths: ${[...new Set(log.scoreboard.map((entry) => entry.replace(/#.*/, "")))].join(", ")}`);
