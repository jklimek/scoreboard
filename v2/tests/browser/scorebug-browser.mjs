// OBS-like acceptance check (S1-A5, S2-A3): headless Chromium loads the built scoreboard.html against a
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

async function openPage(params, { skewMs = 0 } = {}) {
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
  await page.addInitScript((skew) => {
    // An OBS host whose clock is off by `skew` ms.
    if (skew) {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + skew;
    }
    window.__bumps = 0;
    // Every banner entrance (the rail's `data-banner-id` is set on show, removed on hide).
    window.__banners = [];
    // Status transitions with the number of sockets opened so far and whether the bug was empty.
    window.__sockets = 0;
    window.__statuses = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        window.__sockets++;
      }
    };
    new MutationObserver((records) => {
      for (const record of records)
        if (record.attributeName === "data-source-status")
          window.__statuses.push({
            status: document.body.dataset.sourceStatus,
            sockets: window.__sockets,
            empty: document.querySelector(".overlay-scoreboard").classList.contains("is-empty"),
          });
        else if (record.attributeName === "data-banner-id") {
          const id = record.target.getAttribute("data-banner-id");
          if (id) window.__banners.push(id);
        } else if (/scale\(1\.[1-9]/.test(record.target.getAttribute("style") ?? "")) window.__bumps++;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["style", "data-source-status", "data-banner-id"] });
  }, skewMs);
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
const statuses = (page) => page.evaluate(() => window.__statuses);
const socketCount = (page) => page.evaluate(() => window.__sockets);
const profile = { scores: scoresOrigin, profile: fixtureProfile, key: fixtureKey, diag: "1" };
const bannerLog = (page) => page.evaluate(() => window.__banners);
const shortId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** The rail's banner id (undefined when none is on air) and its computed visibility. */
const rail = (page) =>
  page.evaluate(() => {
    const element = document.getElementById("scorer-rail");
    return { id: element.dataset.bannerId, visibility: getComputedStyle(element).visibility };
  });
const waitBanner = (page, id) =>
  page.waitForFunction((expected) => document.getElementById("scorer-rail").dataset.bannerId === expected, id, { timeout: 5000 });
const timeoutDots = (page, side) =>
  page.evaluate((prefix) => {
    const element = document.getElementById(`${prefix}-timeouts`);
    return { kind: element.dataset.timeouts, dots: [...element.querySelectorAll(".timeout-dot")].map((dot) => dot.classList.contains("is-active")), text: element.textContent };
  }, side);
const possession = (page) =>
  page.evaluate(() => ["home", "away"].map((side) => document.getElementById(`${side}-team-card`).classList.contains("is-possession-team")));

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
    // The snapshot's goal history is quiet: no banner on the first render.
    const banners = await main.page.evaluate(() =>
      ["scorer-rail", "info-rail", "player-rail"].map((id) => getComputedStyle(document.getElementById(id)).visibility),
    );
    assert.deepEqual(banners, ["hidden", "hidden", "hidden"]);
    assert.deepEqual(await bannerLog(main.page), []);
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
    // The digits are written at once; the bump only scales them.
    await main.page.waitForFunction(() => document.getElementById("home-score").textContent === "15");
    await main.page.waitForFunction(() => window.__bumps > 0, null, { timeout: 2000 });
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

  await check("the verification-failure bound (silent 1008 close) is degraded with the data kept", async () => {
    const seen = (await statuses(main.page)).length;
    hub.overdue();
    await main.page.waitForFunction((from) => window.__statuses.slice(from).some((entry) => entry.status === "degraded"), seen);
    await waitStatus(main.page, "live", 20_000);
    const path = (await statuses(main.page)).slice(seen);
    assert.deepEqual(path.map((entry) => entry.status), ["degraded", "live"]);
    assert.ok(path.every((entry) => !entry.empty), "the scorebug stays on air");
    assert.equal(await text(main.page, "home-name"), "W31 Fixture Next");
  });

  await check("an OBS host clock 2 minutes ahead: an unchanged reconnect does not move the clock", async () => {
    const published = Date.now();
    hub.snapshotData(live("game-live"));
    const { page } = await openPage(profile, { skewMs: 120_000 });
    await waitStatus(page, "live");
    const expected = () => 600 + Math.floor((Date.now() - published) / 1000);
    assert.ok(Math.abs((await clockSeconds(page)) - expected()) <= 1, "server time, not the host clock");
    const seen = (await statuses(page)).length;
    hub.dropAll();
    await page.waitForFunction(
      (from) => window.__statuses.slice(from).some((entry) => entry.status === "live") && window.__sockets === 2,
      seen,
      { timeout: 20_000 },
    );
    // Before the new connection's first pong (15 s keep-alive) nothing has resampled server time.
    let previous = await clockSeconds(page);
    for (let sample = 0; sample < 12; sample++) {
      await settle(250);
      const value = await clockSeconds(page);
      assert.ok(value >= previous && value <= previous + 1, `the clock moved ${previous} -> ${value}`);
      previous = value;
    }
    assert.ok(Math.abs(previous - expected()) <= 1, `${previous} s vs ${expected()} s`);
    assert.equal(await socketCount(page), 2);
    await page.close();
  });

  await check("possession and per-side timeouts render from the snapshot", async () => {
    hub.snapshotData(live("game-standard"));
    await main.page.waitForFunction(() => document.getElementById("away-team-card").classList.contains("is-possession-team"));
    assert.deepEqual(await possession(main.page), [false, true], "possession, never guessed from offence (home)");
    assert.deepEqual(await timeoutDots(main.page, "home"), { kind: "dots", dots: [true, true], text: "" });
    assert.deepEqual(await timeoutDots(main.page, "away"), { kind: "dots", dots: [true, false], text: "" });
    hub.snapshotData(live("game-asymmetric-timeouts"));
    await main.page.waitForFunction(() => document.querySelectorAll("#home-timeouts .timeout-dot").length === 3);
    assert.deepEqual(await timeoutDots(main.page, "home"), { kind: "dots", dots: [true, true, false], text: "" });
    assert.deepEqual(await timeoutDots(main.page, "away"), { kind: "dots", dots: [false], text: "" });
    assert.deepEqual(await possession(main.page), [false, false], "BASIC: no possession");
  });

  await check("operator-only freshness and clock confidence: attributes and chip, nothing on air", async () => {
    const onAir = () => main.page.evaluate(() => document.querySelector(".overlay-scoreboard").outerHTML.replace(/<img[^>]*>/g, ""));
    hub.snapshotData(live("game-standard"));
    await main.page.waitForFunction(() => document.body.dataset.sourceFreshness === "fresh");
    const before = await onAir();
    hub.snapshotData(live("game-partial"));
    await main.page.waitForFunction(() => document.body.dataset.sourceFreshness === "stale");
    assert.equal(await main.page.evaluate(() => document.body.dataset.sourceClock), "uncertain");
    assert.equal(await main.page.evaluate(() => document.querySelector(".source-status-chip").textContent), `Scores: live · stale · clock uncertain · ${fixtureProfile}`);
    assert.deepEqual(await timeoutDots(main.page, "home"), { kind: "none", dots: [], text: "" }, "not covered: no fake dots");
    const after = await onAir();
    for (const marker of ["stale", "uncertain", "warning"]) assert.ok(!after.includes(marker), `no on-air ${marker} marker`);
    assert.ok(before.includes("scoreboard-shell") && after.includes("scoreboard-shell"));
  });

  await check("a live goal shows its banner once; a reload does not; a void retracts it at once", async () => {
    hub.snapshotData(live("game-standard"));
    await main.page.waitForFunction(() => document.body.dataset.sourceFreshness === "fresh");
    const seen = (await bannerLog(main.page)).length;
    hub.snapshotData(live("game-standard-goal"));
    hub.moment("moment-goal-named");
    await waitBanner(main.page, shortId(302));
    await settle(700);
    assert.deepEqual(await rail(main.page), { id: shortId(302), visibility: "visible" });
    assert.deepEqual(
      await Promise.all(["event-title", "scorer-text", "assist-text", "scorer-stat"].map((id) => text(main.page, id))),
      ["GOAL", "W31 Fixture Scorer", "Assist: W31 Fixture Thrower", "6\u20134"],
    );
    assert.deepEqual([await text(main.page, "home-score"), await text(main.page, "away-score")], ["6", "4"], "the score is the snapshot's");
    // At-least-once delivery: a duplicate id never enters again.
    hub.moment("moment-goal-named");
    // A reload while the goal is current: its history is quiet.
    const reloaded = await openPage(profile);
    await waitStatus(reloaded.page, "live");
    await settle(1200);
    assert.deepEqual(await bannerLog(reloaded.page), []);
    assert.equal((await rail(reloaded.page)).visibility, "hidden");
    await reloaded.page.close();
    assert.deepEqual((await bannerLog(main.page)).slice(seen), [shortId(302)], "exactly once");
    // The void: the snapshot without the goal, then the void moment. Gone at once (no exit).
    hub.snapshotData(live("game-standard"));
    hub.moment("moment-voided");
    await main.page.waitForFunction(() => getComputedStyle(document.getElementById("scorer-rail")).visibility === "hidden", null, { timeout: 1000 });
    assert.deepEqual(await rail(main.page), { id: undefined, visibility: "hidden" });
    assert.deepEqual([await text(main.page, "home-score"), await text(main.page, "away-score")], ["5", "4"]);
  });

  await check("a game switch clears the banner at once; a stale old-game moment never animates", async () => {
    const seen = (await bannerLog(main.page)).length;
    hub.snapshotData(live("game-standard-callahan"));
    hub.moment("moment-goal-callahan");
    await waitBanner(main.page, shortId(303));
    assert.equal(await text(main.page, "assist-text"), "Callahan");
    const switched = hub.snapshotData(live("game-hidden-stats"));
    await main.page.waitForFunction(() => document.getElementById("scorer-rail").dataset.bannerId === undefined, null, { timeout: 1000 });
    await main.page.waitForFunction(() => getComputedStyle(document.getElementById("scorer-rail")).visibility === "hidden", null, { timeout: 1000 });
    assert.deepEqual([await text(main.page, "home-score"), await text(main.page, "away-score")], ["2", "1"]);
    assert.deepEqual(await possession(main.page), [true, false]);
    hub.deliver({ ...fixture("moment-goal-hidden"), version: switched.version - 1 });
    await settle(1200);
    assert.deepEqual((await bannerLog(main.page)).slice(seen), [shortId(303)]);
    // A timeout banner on the next game (its first snapshot is the baseline).
    hub.snapshotData(live("game-standard"));
    await main.page.waitForFunction(() => document.getElementById("home-score").textContent === "5");
    hub.snapshotData(live("game-standard-timeout"));
    hub.moment("moment-timeout");
    await waitBanner(main.page, shortId(304));
    assert.deepEqual(
      await Promise.all(["event-title", "scorer-text", "assist-text"].map((id) => text(main.page, id))),
      ["TIMEOUT", "W31 Fixture Home", "1 of 2 left this half"],
    );
    assert.equal(await main.page.evaluate(() => document.getElementById("scorer-stat-wrap").style.display), "none");
  });

  await check("unavailable clears a banner on air at once", async () => {
    await waitBanner(main.page, shortId(304));
    hub.remove();
    await waitStatus(main.page, "unavailable");
    assert.deepEqual(await rail(main.page), { id: undefined, visibility: "hidden" });
    hub.snapshotData(live("game-live"));
    await waitStatus(main.page, "live");
  });

  await check("reload race: a goal whose snapshot a new page gets first never shows there", async () => {
    // The page subscribes between the hub's snapshot and its moment (both of one load).
    hub.snapshotData(live("game-live-goal"));
    const reloaded = await openPage(profile);
    await waitStatus(reloaded.page, "live");
    await reloaded.page.waitForFunction(() => document.getElementById("home-score").textContent === "4");
    hub.moment("moment-goal");
    await waitBanner(main.page, shortId(301));
    await settle(1200);
    assert.deepEqual(await bannerLog(reloaded.page), [], "its id was in the page's first snapshot");
    await reloaded.page.close();
  });

  await check("a game switch cuts a banner still leaving at once", async () => {
    // The goal banner's exit (after its 6 s hold) is a 0.3 s slide down to y 72; a cut is y 0.
    await main.page.waitForFunction(
      () => {
        const element = document.getElementById("scorer-rail");
        return element.dataset.bannerId === undefined && getComputedStyle(element).visibility === "visible";
      },
      null,
      { timeout: 10_000, polling: 10 },
    );
    hub.snapshotData(live("game-standard"));
    await main.page.waitForFunction(() => getComputedStyle(document.getElementById("scorer-rail")).visibility === "hidden", null, { timeout: 1000 });
    const offset = await main.page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById("scorer-rail")).transform).f);
    assert.equal(offset, 0, "cut, not the end of the exit");
    await main.page.waitForFunction(() => document.getElementById("home-score").textContent === "5");
  });

  await check("unavailable: a key revoked while connected clears the scorebug before any reconnect", async () => {
    await waitStatus(main.page, "live", 20_000);
    const seen = (await statuses(main.page)).length;
    const sockets = await socketCount(main.page);
    hub.revoke();
    await waitStatus(main.page, "unavailable", 20_000);
    assert.equal(await empty(main.page), true);
    const path = (await statuses(main.page)).slice(seen);
    assert.deepEqual(path[0], { status: "unavailable", sockets, empty: true }, "cleared on the frame, same socket");
    await settle(3000);
    assert.equal(await status(main.page), "unavailable", "retries never bring old data back");
    assert.ok((await socketCount(main.page)) > sockets, "the client kept retrying");
    assert.ok((await statuses(main.page)).slice(seen).every((entry) => entry.empty));
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
