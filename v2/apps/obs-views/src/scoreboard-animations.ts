import { gsap } from "gsap";

export type TeamKey = "a" | "h";

export type OverlayEvent = {
  id: string;
  kind: string;
  team?: TeamKey | null;
  clock_seconds?: number | null;
  display_ms?: number;
  title?: string;
  primary_text?: string;
  secondary_text?: string;
  meta?: Record<string, unknown>;
};

type ScoreboardAnimationElements = {
  homeTeamCard: HTMLElement | null;
  awayTeamCard: HTMLElement | null;
  scorerRail: HTMLElement | null;
  infoRail: HTMLElement | null;
  playerRail: HTMLElement | null;
  timeoutBanner: HTMLElement | null;
  eventTitle: HTMLElement | null;
  scorerText: HTMLElement | null;
  assistText: HTMLElement | null;
  scorerStat: HTMLElement | null;
  goalStatWrap: HTMLElement | null;
  goalSweep: HTMLElement | null;
  infoTitle: HTMLElement | null;
  infoPrimary: HTMLElement | null;
  infoSecondary: HTMLElement | null;
  playerTitle: HTMLElement | null;
  playerName: HTMLElement | null;
  playerStats: HTMLElement | null;
  homeScoreWrap: HTMLElement | null;
  awayScoreWrap: HTMLElement | null;
};

export class ScoreboardAnimator {
  private readonly elements: ScoreboardAnimationElements;
  private lowerThirdTimeline: gsap.core.Timeline | null = null;
  private timeoutTimeline: gsap.core.Timeline | null = null;

  constructor() {
    this.elements = {
      homeTeamCard: document.getElementById("home-team-card"),
      awayTeamCard: document.getElementById("away-team-card"),
      scorerRail: document.getElementById("scorer-rail"),
      infoRail: document.getElementById("info-rail"),
      playerRail: document.getElementById("player-rail"),
      timeoutBanner: document.getElementById("timeout-banner"),
      eventTitle: document.getElementById("event-title"),
      scorerText: document.getElementById("scorer-text"),
      assistText: document.getElementById("assist-text"),
      scorerStat: document.getElementById("scorer-stat"),
      goalStatWrap: document.getElementById("scorer-stat-wrap"),
      goalSweep: document.querySelector("#scorer-rail .goal-sweep"),
      infoTitle: document.getElementById("info-title"),
      infoPrimary: document.getElementById("info-primary"),
      infoSecondary: document.getElementById("info-secondary"),
      playerTitle: document.getElementById("player-title"),
      playerName: document.getElementById("player-name"),
      playerStats: document.getElementById("player-stats"),
      homeScoreWrap: document.getElementById("home-score-wrap"),
      awayScoreWrap: document.getElementById("away-score-wrap"),
    };
  }

  animateScoreChange(scoreElement: HTMLElement, nextScoreText: string): void {
    const timeline = gsap.timeline();
    timeline.to(scoreElement, {
      scale: 1.22,
      duration: 0.11,
      ease: "power2.out",
    });
    timeline.add(() => {
      scoreElement.textContent = nextScoreText;
    });
    timeline.to(scoreElement, {
      scale: 1.0,
      duration: 0.42,
      ease: "power3.out",
    });
  }

  animatePossessionPulse(team: TeamKey): void {
    const target = team === "h" ? this.elements.homeTeamCard : this.elements.awayTeamCard;
    if (!target) {
      return;
    }
    gsap.fromTo(
      target,
      { boxShadow: "0 8px 22px rgba(0, 0, 0, 0.34)" },
      {
        boxShadow: "0 10px 26px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2)",
        duration: 0.18,
        yoyo: true,
        repeat: 1,
        ease: "power2.inOut",
        clearProps: "boxShadow",
      },
    );
  }

  playEvent(event: OverlayEvent): void {
    if (event.kind === "clear_overlay") {
      this.resetLowerThirdTimeline();
      if (this.timeoutTimeline) {
        this.timeoutTimeline.kill();
        this.timeoutTimeline = null;
      }
      const timeoutBanner = this.elements.timeoutBanner;
      if (timeoutBanner) {
        gsap.set(timeoutBanner, { autoAlpha: 0, clearProps: "all" });
      }
      return;
    }
    if (this.isPossessionOnlyEvent(event)) {
      return;
    }
    if (event.kind === "score") {
      this.playScoreEvent(event);
      return;
    }
    if (event.kind === "timeout_start") {
      this.playTimeoutEvent(event);
      return;
    }
    if (
      event.kind === "featured_player" ||
      event.kind === "player_spotlight" ||
      event.kind === "player_focus" ||
      event.kind === "player_info"
    ) {
      this.playFeaturedPlayerEvent(event);
      return;
    }
    if (
      event.kind === "info" ||
      event.kind === "announcement" ||
      event.kind === "generic_info" ||
      event.kind === "generic"
    ) {
      const meta = this.getMetaObject(event.meta);
      if (meta.custom_info_only) {
        this.playInfoEvent(event);
        return;
      }
      if (this.eventLooksLikePlayerSpotlight(event)) {
        this.playFeaturedPlayerEvent(event);
        return;
      }
      if (this.cleanText(event.primary_text, "").length === 0 && this.cleanText(event.secondary_text, "").length === 0) {
        return;
      }
      this.playInfoEvent(event);
      return;
    }
    this.playInfoEvent(event);
  }

  private playScoreEvent(event: OverlayEvent): void {
    const { scorerRail, eventTitle, scorerText, assistText, scorerStat, goalStatWrap, goalSweep } =
      this.elements;
    if (!scorerRail || !eventTitle || !scorerText || !assistText) {
      return;
    }

    this.resetLowerThirdTimeline();

    eventTitle.textContent = this.formatTitle(event.title, "GOAL");
    scorerText.textContent = this.cleanText(event.primary_text, "Scorer");
    assistText.textContent = this.formatAssistText(event.secondary_text);
    assistText.style.display = "";
    if (scorerStat) {
      scorerStat.textContent = this.readScoreline();
    }
    if (goalStatWrap) {
      goalStatWrap.style.display = "";
    }

    const teamCard = event.team === "h" ? this.elements.homeTeamCard : this.elements.awayTeamCard;
    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5);
    scorerRail.style.setProperty("--event-accent", this.resolveTeamAccent(event.team));

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(scorerRail, { clearProps: "all" });
        gsap.set(scorerRail, { autoAlpha: 0 });
      },
    });

    if (teamCard) {
      timeline.fromTo(
        teamCard,
        { filter: "brightness(1)" },
        {
          filter: "brightness(1.24)",
          duration: 0.14,
          yoyo: true,
          repeat: 1,
          ease: "power2.out",
        },
        0,
      );
    }

    this.addBarReveal(timeline, scorerRail, goalSweep, holdSeconds);

    this.lowerThirdTimeline = timeline;
  }

  private formatAssistText(raw: string | undefined): string {
    const assist = this.cleanText(raw, "");
    if (!assist || assist.toUpperCase() === "UNASSISTED") {
      return "Unassisted";
    }
    return /^assist/i.test(assist) ? assist : `Assist: ${assist}`;
  }

  private readScoreline(): string {
    const home = document.getElementById("home-score")?.textContent?.trim() || "0";
    const away = document.getElementById("away-score")?.textContent?.trim() || "0";
    return `${home}\u2013${away}`;
  }

  private playTimeoutEvent(event: OverlayEvent): void {
    const { scorerRail, eventTitle, scorerText, assistText, goalStatWrap, goalSweep, timeoutBanner } =
      this.elements;
    if (!scorerRail || !eventTitle || !scorerText) {
      return;
    }
    this.resetLowerThirdTimeline();
    if (this.timeoutTimeline) {
      this.timeoutTimeline.kill();
      this.timeoutTimeline = null;
    }

    if (timeoutBanner) {
      gsap.set(timeoutBanner, { autoAlpha: 0, clearProps: "all" });
    }
    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5.8);
    eventTitle.textContent = "TIME";
    scorerText.textContent = this.resolveTimeoutPrimaryText(event);
    if (assistText) {
      assistText.textContent = "";
      assistText.style.display = "none";
    }
    if (goalStatWrap) {
      goalStatWrap.style.display = "none";
    }
    scorerRail.style.setProperty("--event-accent", this.resolveTeamAccent(event.team));

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(scorerRail, { clearProps: "all" });
        gsap.set(scorerRail, { autoAlpha: 0 });
      },
    });

    this.addBarReveal(timeline, scorerRail, goalSweep, holdSeconds);

    this.timeoutTimeline = timeline;
  }

  private addBarReveal(
    timeline: gsap.core.Timeline,
    rail: HTMLElement,
    sweep: Element | null,
    holdSeconds: number,
  ): void {
    timeline.fromTo(
      rail,
      { y: 92, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.44, ease: "power3.out" },
      0,
    );
    if (sweep) {
      timeline.fromTo(
        sweep,
        { xPercent: -120 },
        { xPercent: 120, duration: 0.7, ease: "power2.inOut" },
        0.26,
      );
    }
    timeline.to(rail, { y: 72, autoAlpha: 0, duration: 0.3, ease: "power2.in" }, holdSeconds);
  }

  private playInfoEvent(event: OverlayEvent): void {
    const { infoRail, infoTitle, infoPrimary, infoSecondary, playerRail } = this.elements;
    if (!infoRail || !infoTitle || !infoPrimary || !infoSecondary) {
      return;
    }

    this.resetLowerThirdTimeline();
    if (playerRail) {
      gsap.set(playerRail, { autoAlpha: 0 });
    }

    const titleText = this.cleanText(event.title, "");
    const primaryText = this.cleanText(event.primary_text, "");
    const secondaryText = this.cleanText(event.secondary_text, "");

    if (!titleText && !primaryText && !secondaryText) {
      return;
    }

    infoTitle.textContent = (titleText || "INFO").toUpperCase();
    infoPrimary.textContent = primaryText || secondaryText || titleText;
    const subText = primaryText ? secondaryText : "";
    infoSecondary.textContent = subText;
    infoSecondary.style.display = subText ? "" : "none";

    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5);
    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(infoRail, { clearProps: "all" });
        gsap.set(infoRail, { autoAlpha: 0 });
      },
    });
    this.addBarReveal(timeline, infoRail, infoRail.querySelector(".goal-sweep"), holdSeconds);
    this.lowerThirdTimeline = timeline;
  }

  private playFeaturedPlayerEvent(event: OverlayEvent): void {
    const { playerRail, playerTitle, playerName, playerStats } = this.elements;
    if (!playerRail || !playerTitle || !playerName || !playerStats) {
      return;
    }

    this.resetLowerThirdTimeline();

    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5.4);
    const player = this.extractPlayerDetails(event);
    playerTitle.textContent = this.formatTitle(event.title, "PLAYER");
    playerName.textContent = player.name;
    const subLine = player.statsLine || player.note;
    playerStats.textContent = subLine;
    playerStats.style.display = subLine ? "" : "none";

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(playerRail, { clearProps: "all" });
        gsap.set(playerRail, { autoAlpha: 0 });
      },
    });
    this.addBarReveal(timeline, playerRail, playerRail.querySelector(".goal-sweep"), holdSeconds);
    this.lowerThirdTimeline = timeline;
  }

  private resetLowerThirdTimeline(): void {
    if (this.lowerThirdTimeline) {
      this.lowerThirdTimeline.kill();
      this.lowerThirdTimeline = null;
    }
    this.hideLowerThirdRails();
  }

  private hideLowerThirdRails(): void {
    const { scorerRail, infoRail, playerRail } = this.elements;
    const rails = [scorerRail, infoRail, playerRail].filter(
      (rail): rail is HTMLElement => rail instanceof HTMLElement,
    );
    if (rails.length === 0) {
      return;
    }
    gsap.set(rails, {
      autoAlpha: 0,
      clearProps: "x,xPercent,yPercent,y,scale,scaleY,filter,borderLeftColor,clipPath,transformOrigin",
    });
  }

  private normalizeDisplaySeconds(displayMs: number | undefined, fallbackSeconds: number): number {
    const parsed = Number(displayMs);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(3, parsed / 1000);
    }
    return fallbackSeconds;
  }

  private formatTitle(raw: string | undefined, fallback: string): string {
    const cleaned = this.cleanText(raw, fallback);
    return cleaned.toUpperCase();
  }

  private cleanText(raw: unknown, fallback: string): string {
    if (typeof raw === "string") {
      const cleaned = raw.trim();
      if (cleaned) {
        return cleaned;
      }
    }
    return fallback;
  }

  private resolveTeamAccent(team: TeamKey | null | undefined): string {
    const styles = getComputedStyle(document.documentElement);
    if (team === "h") {
      return styles.getPropertyValue("--team-h-color").trim() || "#52E0A6";
    }
    if (team === "a") {
      return styles.getPropertyValue("--team-a-color").trim() || "#8CA7FF";
    }
    return styles.getPropertyValue("--accent-neutral").trim() || "#8CA7FF";
  }

  private eventLooksLikePlayerSpotlight(event: OverlayEvent): boolean {
    const meta = this.getMetaObject(event.meta);
    return Boolean(
      meta.player ||
        meta.player_name ||
        meta.first_name ||
        meta.last_name ||
        meta.points ||
        meta.goals ||
        meta.assists,
    );
  }

  private isPossessionOnlyEvent(event: OverlayEvent): boolean {
    const kind = (event.kind || "").toLowerCase();
    const title = this.cleanText(event.title, "").toLowerCase();
    if (kind.includes("possession")) {
      return true;
    }
    if (title.includes("possession")) {
      return true;
    }
    return false;
  }

  private resolveTimeoutPrimaryText(event: OverlayEvent): string {
    const byTeam = event.team === "h" ? "home-name" : event.team === "a" ? "away-name" : null;
    if (byTeam) {
      const teamEl = document.getElementById(byTeam);
      const teamLabel = teamEl?.textContent?.trim();
      if (teamLabel) {
        return `${teamLabel.toUpperCase()} TIMEOUT`;
      }
    }

    const source = this.cleanText(event.primary_text, "");
    if (source && source.toLowerCase().includes("timeout")) {
      return source.toUpperCase();
    }
    if (source) {
      return `${source.toUpperCase()} TIMEOUT`;
    }
    return "TIMEOUT";
  }

  private extractPlayerDetails(event: OverlayEvent): { name: string; statsLine: string; note: string } {
    const meta = this.getMetaObject(event.meta);
    const metaPlayer = this.getMetaObject(meta.player);

    const first = this.cleanText(metaPlayer.first_name ?? meta.first_name, "");
    const last = this.cleanText(metaPlayer.last_name ?? meta.last_name, "");
    const fullNameCandidate = `${first} ${last}`.trim();

    const name = this.cleanText(
      event.primary_text ??
        metaPlayer.name ??
        meta.player_name ??
        meta.name ??
        (fullNameCandidate || undefined),
      "Unknown Player",
    );

    const points = this.readStatValue(metaPlayer.points ?? meta.points);
    const goals = this.readStatValue(metaPlayer.goals ?? meta.goals);
    const assists = this.readStatValue(metaPlayer.assists ?? meta.assists);

    const stats: string[] = [];
    if (points !== null) stats.push(`PTS ${points}`);
    if (goals !== null) stats.push(`G ${goals}`);
    if (assists !== null) stats.push(`A ${assists}`);

    const team = this.cleanText(metaPlayer.team_name ?? meta.team_name ?? meta.team, "");
    const number = this.cleanText(metaPlayer.number ?? meta.number, "");
    if (team || number) {
      stats.push([team, number ? `#${number}` : ""].filter(Boolean).join(" "));
    }

    const statsLine = stats.length > 0 ? stats.join("  ·  ") : "LIVE PLAYER SNAPSHOT";
    const note = this.cleanText(
      event.secondary_text ??
        metaPlayer.note ??
        meta.note ??
        metaPlayer.extra_info ??
        meta.extra_info ??
        "",
      "",
    );

    return { name, statsLine, note };
  }

  private getMetaObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private readStatValue(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.round(value));
    }
    if (typeof value === "string") {
      const cleaned = value.trim();
      if (!cleaned) {
        return null;
      }
      const parsed = Number.parseFloat(cleaned);
      if (Number.isFinite(parsed)) {
        return String(Math.round(parsed));
      }
      return cleaned;
    }
    return null;
  }
}
