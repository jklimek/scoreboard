// Scorebug OBS view (scoreboard.html): follows one Scores stream profile through the shared source
// module. No connection to the scoreboard's own /ws or snapshot API; nothing on air without data.
import { gsap } from "gsap";
import { parseScoresFragment } from "../../scores-source/src/config.ts";
import { createScoresSource } from "../../scores-source/src/source.ts";
import type { ScoresSource, SourceState, SourceUpdate } from "../../scores-source/src/source.ts";
import { clockText, formatClock, scoreBumps, scoreText, scorebugModel } from "../../scores-source/src/scorebug.ts";
import type { ScorebugTeam } from "../../scores-source/src/scorebug.ts";

const config = parseScoresFragment(location.hash);
const origin = config.ok ? config.config.origin : "";
const diag = config.ok ? config.config.diag : config.diag;
const byId = (id: string) => document.getElementById(id);
const overlay = document.querySelector<HTMLElement>(".overlay-scoreboard");
const clock = byId("game-clock");
const scores = { home: byId("home-score"), away: byId("away-score") };
const scoreElements = [scores.home, scores.away].filter((element) => element !== null);
const chip = diag ? createChip() : null;
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

function renderTeam(team: ScorebugTeam): void {
  const prefix = team.side;
  const card = byId(`${prefix}-team-card`);
  const name = byId(`${prefix}-name`);
  card?.classList.toggle("is-placeholder", team.name === null);
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
    if (team.timeoutsLeft !== null)
      for (let index = 0; index < team.timeoutLimit; index++) {
        const dot = document.createElement("span");
        dot.className = "timeout-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.classList.toggle("is-active", index < team.timeoutsLeft);
        dots.append(dot);
      }
  }
}

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
  overlay?.classList.add("is-empty");
  for (const id of ["home-name", "away-name", "home-score", "away-score", "game-clock", "home-timeouts", "away-timeouts"])
    byId(id)?.replaceChildren();
  for (const side of ["home", "away"]) {
    const logo = byId(`${side}-logo`) as HTMLImageElement | null;
    logo?.removeAttribute("src");
    if (logo) logo.hidden = true;
  }
}

function render(state: SourceState, changed = { home: false, away: false }): void {
  document.body.dataset.sourceStatus = state.status;
  if (chip) {
    chip.dataset.status = state.status;
    chip.textContent = [`Scores: ${state.status}`, state.problem, config.ok ? config.config.profile : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (!state.game) return clear();
  const model = scorebugModel(state.game, origin);
  overlay?.classList.remove("is-empty");
  overlay?.setAttribute("data-score-source", model.score.source);
  renderTeam(model.home);
  renderTeam(model.away);
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
  onUpdate: (update: SourceUpdate) => render(update.state, scoreBumps(update)),
});
render(source.state);
source.tickClock((elapsedMs) => {
  if (clock && source?.state.game) clock.textContent = formatClock(elapsedMs);
});
