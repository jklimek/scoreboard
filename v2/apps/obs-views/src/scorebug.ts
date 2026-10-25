// Scorebug OBS view (scoreboard.html): follows one Scores stream profile through the shared source
// module. No connection to the scoreboard's own /ws or snapshot API; nothing on air without data.
import { gsap } from "gsap";
import { createBannerController } from "../../scores-source/src/banners.ts";
import type { Banner } from "../../scores-source/src/banners.ts";
import { parseScoresFragment } from "../../scores-source/src/config.ts";
import { createScoresSource } from "../../scores-source/src/source.ts";
import type { ScoresSource, SourceState, SourceUpdate } from "../../scores-source/src/source.ts";
import { clockText, formatClock, scoreBumps, scoreText, scorebugModel } from "../../scores-source/src/scorebug.ts";
import type { ScorebugModel, ScorebugTeam } from "../../scores-source/src/scorebug.ts";

const config = parseScoresFragment(location.hash);
const origin = config.ok ? config.config.origin : "";
const diag = config.ok ? config.config.diag : config.diag;
const byId = (id: string) => document.getElementById(id);
const overlay = document.querySelector<HTMLElement>(".overlay-scoreboard");
const clock = byId("game-clock");
const scores = { home: byId("home-score"), away: byId("away-score") };
const scoreElements = [scores.home, scores.away].filter((element) => element !== null);
const chip = diag ? createChip() : null;
const rail = byId("scorer-rail");
let source: ScoresSource | undefined;

async function applyObsBgColor(): Promise<void> {
  // The scoreboard server's own one-shot OBS setting (not Scores data).
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const res = await fetch("/api/v1/obs-config");
    const data = (await res.json()) as { bgColor?: string };
    if (typeof data.bgColor === "string" && data.bgColor) document.body.style.backgroundColor = data.bgColor;
  } catch {
    /* keep default from CSS */
  }
}

function createChip(): HTMLElement {
  const element = document.createElement("div");
  element.className = "source-status-chip";
  element.setAttribute("role", "status");
  document.body.append(element);
  return element;
}

function renderTeam(team: ScorebugTeam, per: ScorebugModel["timeoutsPer"]): void {
  const prefix = team.side;
  const card = byId(`${prefix}-team-card`);
  const name = byId(`${prefix}-name`);
  card?.classList.toggle("is-placeholder", team.name === null);
  card?.classList.toggle("is-possession-team", team.possession);
  if (name) name.textContent = team.name ?? (team.side === "home" ? "Home" : "Away");
  document.documentElement.style.setProperty(
    team.side === "home" ? "--team-h-color" : "--team-a-color",
    team.colour ?? "var(--accent-neutral)",
  );
  const logo = byId(`${prefix}-logo`) as HTMLImageElement | null;
  if (logo) {
    if (team.logoUrl) {
      logo.referrerPolicy = "no-referrer";
      if (logo.getAttribute("src") !== team.logoUrl) logo.src = team.logoUrl;
      logo.hidden = false;
    } else {
      logo.removeAttribute("src");
      logo.hidden = true;
    }
  }
  const dots = byId(`${prefix}-timeouts`);
  if (dots) {
    dots.replaceChildren();
    const view = team.timeouts;
    dots.dataset.timeouts = view.kind;
    if (view.kind === "dots")
      for (let index = 0; index < view.total; index++) {
        const dot = document.createElement("span");
        dot.className = "timeout-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.classList.toggle("is-active", index < view.active);
        dots.append(dot);
      }
    else if (view.kind === "count") {
      const count = document.createElement("span");
      count.className = "timeout-count";
      count.textContent = view.text;
      dots.append(count);
    }
    const side = team.side === "home" ? "Home" : "Away";
    dots.setAttribute(
      "aria-label",
      view.kind === "none" ? `${side} timeouts not known` : `${side} timeouts left this ${per}`,
    );
  }
}

/** The goal rail (Touchline reveal, as ScoreboardAnimator's bar reveal); one banner at a time. */
let railTimeline: gsap.core.Timeline | null = null;
function writeBanner(banner: Banner): void {
  const set = (id: string, value: string | null) => {
    const element = byId(id);
    if (!element) return;
    element.textContent = value ?? "";
    element.style.display = value === null ? "none" : "";
  };
  set("event-title", banner.title);
  set("scorer-text", banner.primary);
  set("assist-text", banner.secondary);
  set("scorer-stat", banner.scoreline);
  const wrap = byId("scorer-stat-wrap");
  if (wrap) wrap.style.display = banner.scoreline === null ? "none" : "";
  rail?.style.setProperty("--event-accent", `var(--team-${banner.side === "home" ? "h" : "a"}-color)`);
}
const banners = createBannerController({
  show(banner) {
    if (!rail) return;
    railTimeline?.kill();
    writeBanner(banner);
    rail.dataset.bannerId = banner.id;
    rail.dataset.bannerKind = banner.kind;
    const timeline = gsap.timeline();
    const card = byId(`${banner.side}-team-card`);
    if (card && banner.kind === "goal")
      timeline.fromTo(card, { filter: "brightness(1)" }, { filter: "brightness(1.24)", duration: 0.14, yoyo: true, repeat: 1, ease: "power2.out" }, 0);
    timeline.fromTo(rail, { y: 92, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.44, ease: "power3.out" }, 0);
    const sweep = rail.querySelector(".goal-sweep");
    if (sweep) timeline.fromTo(sweep, { xPercent: -120 }, { xPercent: 120, duration: 0.7, ease: "power2.inOut" }, 0.26);
    railTimeline = timeline;
  },
  refresh: writeBanner,
  hide(mode) {
    if (!rail) return;
    railTimeline?.kill();
    delete rail.dataset.bannerId;
    delete rail.dataset.bannerKind;
    if (mode === "exit") railTimeline = gsap.timeline().to(rail, { y: 72, autoAlpha: 0, duration: 0.3, ease: "power2.in" });
    else {
      railTimeline = null;
      gsap.set(rail, { autoAlpha: 0, y: 0 });
      for (const card of [byId("home-team-card"), byId("away-team-card")]) if (card) gsap.set(card, { clearProps: "filter" });
    }
  },
});

/** The Touchline score bump (ScoreboardAnimator.animateScoreChange), scale only. */
function bump(element: HTMLElement): void {
  gsap.to(element, {
    keyframes: [
      { scale: 1.22, duration: 0.11, ease: "power2.out" },
      { scale: 1, duration: 0.42, ease: "power3.out" },
    ],
  });
}

/** Stops running bumps; the digits are always written at once, so none can go stale. */
function stopScoreAnimations(): void {
  if (!scoreElements.length) return;
  gsap.killTweensOf(scoreElements);
  gsap.set(scoreElements, { scale: 1 });
}

function clear(): void {
  stopScoreAnimations();
  delete document.body.dataset.sourceFreshness;
  delete document.body.dataset.sourceClock;
  overlay?.classList.add("is-empty");
  for (const id of ["home-name", "away-name", "home-score", "away-score", "game-clock", "home-timeouts", "away-timeouts"])
    byId(id)?.replaceChildren();
  for (const side of ["home", "away"]) {
    const logo = byId(`${side}-logo`) as HTMLImageElement | null;
    logo?.removeAttribute("src");
    if (logo) logo.hidden = true;
    byId(`${side}-team-card`)?.classList.remove("is-possession-team");
  }
}

function render(state: SourceState, changed = { home: false, away: false }): void {
  document.body.dataset.sourceStatus = state.status;
  const model = state.game ? scorebugModel(state.game, origin) : null;
  if (chip) {
    // Operator only: a silent scorer and an uncertain clock are never marked on air (Q77 spirit).
    const signals = model
      ? [model.operator.stale ? "stale" : null, model.operator.clock === "good" ? null : `clock ${model.operator.clock}`]
      : [];
    chip.dataset.status = state.status;
    chip.textContent = [`Scores: ${state.status}`, state.problem, ...signals, config.ok ? config.config.profile : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (!model) return clear();
  document.body.dataset.sourceFreshness = model.operator.stale ? "stale" : "fresh";
  document.body.dataset.sourceClock = model.operator.clock;
  overlay?.classList.remove("is-empty");
  overlay?.setAttribute("data-score-source", model.score.source);
  renderTeam(model.home, model.timeoutsPer);
  renderTeam(model.away, model.timeoutsPer);
  if (clock) clock.textContent = clockText(model.clock, source?.serverNow() ?? Date.now());
  stopScoreAnimations();
  for (const side of ["home", "away"] as const) {
    const element = scores[side];
    const text = scoreText(model.score[side]);
    if (!element) continue;
    element.classList.toggle("is-missing", model.score[side] === null);
    element.textContent = text;
    if (changed[side]) bump(element);
  }
}

if (!config.ok) console.warn(`scorebug: Scores setup error (${config.problem})`);
void applyObsBgColor();
source = createScoresSource(config, {
  onUpdate: (update: SourceUpdate) => {
    render(update.state, scoreBumps(update));
    banners.update(update);
  },
  onMoment: (event) => banners.moment(event),
});
render(source.state);
source.tickClock((elapsedMs) => {
  if (clock && source?.state.game) clock.textContent = formatClock(elapsedMs);
});
