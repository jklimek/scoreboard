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
  assistRail: HTMLElement | null;
  infoRail: HTMLElement | null;
  playerRail: HTMLElement | null;
  timeoutBanner: HTMLElement | null;
  eventTitle: HTMLElement | null;
  scorerText: HTMLElement | null;
  assistText: HTMLElement | null;
  infoTitle: HTMLElement | null;
  infoPrimary: HTMLElement | null;
  infoSecondary: HTMLElement | null;
  playerTitle: HTMLElement | null;
  playerName: HTMLElement | null;
  playerStats: HTMLElement | null;
  playerNote: HTMLElement | null;
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
      assistRail: document.getElementById("assist-rail"),
      infoRail: document.getElementById("info-rail"),
      playerRail: document.getElementById("player-rail"),
      timeoutBanner: document.getElementById("timeout-banner"),
      eventTitle: document.getElementById("event-title"),
      scorerText: document.getElementById("scorer-text"),
      assistText: document.getElementById("assist-text"),
      infoTitle: document.getElementById("info-title"),
      infoPrimary: document.getElementById("info-primary"),
      infoSecondary: document.getElementById("info-secondary"),
      playerTitle: document.getElementById("player-title"),
      playerName: document.getElementById("player-name"),
      playerStats: document.getElementById("player-stats"),
      playerNote: document.getElementById("player-note"),
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
    const { scorerRail, assistRail, eventTitle, scorerText, assistText } = this.elements;
    if (!scorerRail || !assistRail || !eventTitle || !scorerText || !assistText) {
      return;
    }

    this.resetLowerThirdTimeline();

    eventTitle.textContent = this.formatTitle(event.title, "GOAL");
    scorerText.textContent = this.cleanText(event.primary_text, "Scorer");
    assistText.textContent = this.cleanText(event.secondary_text, "UNASSISTED");

    const teamCard = event.team === "h" ? this.elements.homeTeamCard : this.elements.awayTeamCard;
    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5);
    gsap.set(scorerRail, { borderLeftColor: this.resolveTeamAccent(event.team) });

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set([scorerRail, assistRail], { clearProps: "all" });
        gsap.set([scorerRail, assistRail], { autoAlpha: 0 });
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

    this.applyScoreAnimationVariantRiseAndLock(timeline, scorerRail, assistRail, holdSeconds);

    this.lowerThirdTimeline = timeline;
  }

  private applyScoreAnimationVariantSlideSplit(
    timeline: gsap.core.Timeline,
    scorerRail: HTMLElement,
    assistRail: HTMLElement,
    holdSeconds: number,
  ): void {
    timeline.fromTo(
      scorerRail,
      { x: -220, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.38, ease: "power3.out" },
      0,
    );
    timeline.fromTo(
      assistRail,
      { x: 180, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.32, ease: "power3.out" },
      0.12,
    );
    timeline.to(assistRail, { x: 180, autoAlpha: 0, duration: 0.24, ease: "power2.in" }, holdSeconds);
    timeline.to(scorerRail, { x: -220, autoAlpha: 0, duration: 0.28, ease: "power2.in" }, holdSeconds + 0.16);
  }

  private applyScoreAnimationVariantRiseAndLock(
    timeline: gsap.core.Timeline,
    scorerRail: HTMLElement,
    assistRail: HTMLElement,
    holdSeconds: number,
  ): void {
    timeline.fromTo(
      scorerRail,
      { y: 36, autoAlpha: 0, scaleY: 0.92, transformOrigin: "bottom center" },
      { y: 0, autoAlpha: 1, scaleY: 1, duration: 0.36, ease: "power3.out" },
      0,
    );
    timeline.fromTo(
      assistRail,
      { y: 24, autoAlpha: 0, scaleY: 0.9, transformOrigin: "bottom center" },
      { y: 0, autoAlpha: 1, scaleY: 1, duration: 0.3, ease: "power2.out" },
      0.1,
    );
    timeline.to(assistRail, { y: 20, autoAlpha: 0, duration: 0.22, ease: "power2.in" }, holdSeconds);
    timeline.to(
      scorerRail,
      { y: 28, autoAlpha: 0, scaleY: 0.95, duration: 0.24, ease: "power2.in" },
      holdSeconds + 0.12,
    );
  }

  private applyScoreAnimationVariantWipeReveal(
    timeline: gsap.core.Timeline,
    scorerRail: HTMLElement,
    assistRail: HTMLElement,
    holdSeconds: number,
  ): void {
    timeline.fromTo(
      scorerRail,
      { autoAlpha: 0, clipPath: "inset(0 100% 0 0)" },
      { autoAlpha: 1, clipPath: "inset(0 0% 0 0)", duration: 0.34, ease: "power2.out" },
      0,
    );
    timeline.fromTo(
      assistRail,
      { autoAlpha: 0, clipPath: "inset(100% 0 0 0)" },
      { autoAlpha: 1, clipPath: "inset(0 0 0 0)", duration: 0.28, ease: "power2.out" },
      0.14,
    );
    timeline.to(
      assistRail,
      { autoAlpha: 0, clipPath: "inset(0 0 100% 0)", duration: 0.2, ease: "power2.in" },
      holdSeconds,
    );
    timeline.to(
      scorerRail,
      { autoAlpha: 0, clipPath: "inset(0 0 0 100%)", duration: 0.22, ease: "power2.in" },
      holdSeconds + 0.12,
    );
  }

  private applyScoreAnimationVariantCenterPop(
    timeline: gsap.core.Timeline,
    scorerRail: HTMLElement,
    assistRail: HTMLElement,
    holdSeconds: number,
  ): void {
    timeline.fromTo(
      scorerRail,
      { autoAlpha: 0, scale: 0.9, y: 10, transformOrigin: "center center" },
      { autoAlpha: 1, scale: 1, y: 0, duration: 0.32, ease: "power3.out" },
      0,
    );
    timeline.fromTo(
      assistRail,
      { autoAlpha: 0, scale: 0.94, y: 8, transformOrigin: "center center" },
      { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: "power2.out" },
      0.12,
    );
    timeline.to(assistRail, { autoAlpha: 0, scale: 0.95, y: 10, duration: 0.2, ease: "power2.in" }, holdSeconds);
    timeline.to(
      scorerRail,
      { autoAlpha: 0, scale: 0.9, y: 12, duration: 0.24, ease: "power2.in" },
      holdSeconds + 0.14,
    );
  }

  private playTimeoutEvent(event: OverlayEvent): void {
    const { scorerRail, assistRail, eventTitle, scorerText, timeoutBanner } = this.elements;
    if (!scorerRail || !assistRail || !eventTitle || !scorerText) {
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
    eventTitle.textContent = "TIMEOUT";
    scorerText.textContent = this.resolveTimeoutPrimaryText(event);
    gsap.set(scorerRail, { borderLeftColor: this.resolveTeamAccent(event.team) });
    gsap.set(assistRail, { autoAlpha: 0, clearProps: "all" });

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(scorerRail, { clearProps: "all" });
        gsap.set(scorerRail, { autoAlpha: 0 });
      },
    });

    timeline.fromTo(
      scorerRail,
      { y: 30, autoAlpha: 0, scaleY: 0.92, transformOrigin: "bottom center" },
      { y: 0, autoAlpha: 1, scaleY: 1, duration: 0.34, ease: "power3.out" },
      0,
    );
    timeline.to(
      scorerRail,
      {
        y: 26,
        autoAlpha: 0,
        duration: 0.24,
        ease: "power2.in",
      },
      holdSeconds,
    );

    this.timeoutTimeline = timeline;
  }

  private playInfoEvent(event: OverlayEvent): void {
    const { infoRail, infoTitle, infoPrimary, infoSecondary, playerRail, playerTitle, playerName, playerStats, playerNote } = this.elements;
    if (!infoRail || !infoTitle || !infoPrimary || !infoSecondary) {
      return;
    }

    this.resetLowerThirdTimeline();

    // Fully hide player rail so no extra line (e.g. #13) ever appears; only info rail is used
    if (playerRail) {
      (playerRail as HTMLElement).style.display = "none";
      gsap.set(playerRail, { autoAlpha: 0 });
    }
    if (playerTitle) playerTitle.textContent = "";
    if (playerName) playerName.textContent = "";
    if (playerStats) playerStats.textContent = "";
    if (playerNote) playerNote.textContent = "";

    const titleText = this.cleanText(event.title, "");
    const primaryText = this.cleanText(event.primary_text, "");
    const infoSecondaryText = this.cleanText(event.secondary_text, "");

    if (titleText) {
      infoTitle.textContent = titleText.toUpperCase();
      infoTitle.style.display = "";
    } else {
      infoTitle.textContent = "";
      infoTitle.style.display = "none";
    }
    if (primaryText) {
      infoPrimary.textContent = primaryText;
      infoPrimary.style.display = "";
    } else {
      infoPrimary.textContent = "";
      infoPrimary.style.display = "none";
    }
    infoSecondary.textContent = infoSecondaryText;
    infoSecondary.style.display = infoSecondaryText ? "block" : "none";

    if (!titleText && !primaryText && !infoSecondaryText) {
      return;
    }

    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5);

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(infoRail, { clearProps: "all" });
        gsap.set(infoRail, { autoAlpha: 0 });
      },
    });
    timeline.fromTo(
      infoRail,
      { y: 16, autoAlpha: 0, scale: 0.985 },
      { y: 0, autoAlpha: 1, scale: 1, duration: 0.4, ease: "power3.out" },
      0,
    );
    timeline.to(
      infoRail,
      {
        y: 16,
        autoAlpha: 0,
        duration: 0.3,
        ease: "power2.in",
      },
      holdSeconds,
    );
    this.lowerThirdTimeline = timeline;
  }

  private playFeaturedPlayerEvent(event: OverlayEvent): void {
    const { playerRail, playerTitle, playerName, playerStats, playerNote } = this.elements;
    if (!playerRail || !playerTitle || !playerName || !playerStats || !playerNote) {
      return;
    }

    this.resetLowerThirdTimeline();
    (playerRail as HTMLElement).style.display = "";

    const holdSeconds = this.normalizeDisplaySeconds(event.display_ms, 5.4);
    const player = this.extractPlayerDetails(event);
    playerTitle.textContent = this.formatTitle(event.title, "PLAYER SPOTLIGHT");
    playerName.textContent = player.name;
    playerStats.textContent = player.statsLine;
    playerNote.textContent = player.note;
    playerNote.style.display = player.note ? "block" : "none";

    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(playerRail, { clearProps: "all" });
        gsap.set(playerRail, { autoAlpha: 0 });
      },
    });
    timeline.fromTo(
      playerRail,
      { y: 18, autoAlpha: 0, scale: 0.985 },
      { y: 0, autoAlpha: 1, scale: 1, duration: 0.42, ease: "power3.out" },
      0,
    );
    timeline.to(
      playerRail,
      {
        y: 16,
        autoAlpha: 0,
        duration: 0.3,
        ease: "power2.in",
      },
      holdSeconds,
    );
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
    const { scorerRail, assistRail, infoRail, playerRail } = this.elements;
    const rails = [scorerRail, assistRail, infoRail, playerRail].filter(
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
