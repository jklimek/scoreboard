/**
 * Field Scoreboard Animation Module
 *
 * Handles animations for the large stadium/field display:
 * - Score change pulse effects
 * - Timer countdown effects
 * - Initial entrance animation
 * - Team name transitions
 */

const FieldScoreboardAnimations = {
    // Animation state
    isInitialized: false,

    // Element references
    elements: {
        scoreHome: null,
        scoreAway: null,
        timer: null,
        teamNameHome: null,
        teamNameAway: null
    },

    /**
     * Initialize the field scoreboard animations
     */
    init() {
        this.elements = {
            scoreHome: document.getElementById('home-score'),
            scoreAway: document.getElementById('away-score'),
            timer: document.querySelector('.timer'),
            timerMinutes: document.getElementById('timer-minutes'),
            timerSeconds: document.getElementById('timer-seconds'),
            timerHundredths: document.getElementById('timer-hundredths'),
            teamNameHome: document.getElementById('home-team-name'),
            teamNameAway: document.getElementById('away-team-name'),
            scoreContainerHome: document.querySelector('.score-container.home'),
            scoreContainerAway: document.querySelector('.score-container.away')
        };

        this.isInitialized = true;
        console.log('Field Scoreboard Animations initialized');
    },

    /**
     * Initial Entrance Animation
     * Animate the entire scoreboard appearing
     */
    animateEntrance() {
        if (!this.isInitialized) this.init();

        const tl = gsap.timeline();

        // Score containers scale in from center
        tl.from([this.elements.scoreContainerHome, this.elements.scoreContainerAway], {
            scale: 0,
            opacity: 0,
            duration: 0.8,
            stagger: 0.15,
            ease: "back.out(1.7)"
        });

        // Timer slides up
        tl.from(this.elements.timer, {
            yPercent: 100,
            opacity: 0,
            duration: 0.6,
            ease: "power3.out"
        }, "-=0.4");

        // Team names fade in
        tl.from([this.elements.teamNameHome, this.elements.teamNameAway], {
            opacity: 0,
            y: 20,
            duration: 0.4,
            stagger: 0.1,
            ease: "power2.out"
        }, "-=0.2");

        AnimationController.register('field-entrance', tl);
        return tl;
    },

    /**
     * Score Change Animation
     * Large pulse effect for stadium visibility
     *
     * @param {string} team - 'home' or 'away'
     * @param {number} newScore - New score value
     */
    animateScoreChange(team, newScore) {
        if (!this.isInitialized) this.init();

        const scoreEl = team === 'home' ? this.elements.scoreHome : this.elements.scoreAway;
        const containerEl = team === 'home'
            ? this.elements.scoreContainerHome
            : this.elements.scoreContainerAway;

        const tl = gsap.timeline();

        // Container pulse
        tl.to(containerEl, {
            scale: 1.15,
            boxShadow: "0 0 60px rgba(255, 255, 255, 0.8)",
            duration: 0.15,
            ease: "power2.out"
        });

        // Update score at peak
        tl.add(() => {
            scoreEl.textContent = newScore.toString();
        });

        // Score number flash
        tl.to(scoreEl, {
            color: "#FFD700", // Gold flash
            duration: 0.1,
            ease: "power2.out"
        }, "<");

        // Settle back
        tl.to(containerEl, {
            scale: 1,
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
            duration: 0.6,
            ease: "elastic.out(1, 0.5)"
        });

        // Score color back to normal
        tl.to(scoreEl, {
            color: "#000000",
            duration: 0.4,
            ease: "power2.out"
        }, "-=0.5");

        AnimationController.register(`field-score-${team}`, tl);
        return tl;
    },

    /**
     * Timer Warning Animation
     * Visual effect when time is running low
     *
     * @param {string} level - 'warning' (< 2 min), 'critical' (< 30 sec), 'ended'
     */
    animateTimerWarning(level) {
        if (!this.isInitialized) this.init();

        const timerEl = this.elements.timer;

        const colors = {
            warning: '#FFA500',    // Orange
            critical: '#FF4444',   // Red
            ended: '#FF0000'       // Bright red
        };

        const tl = gsap.timeline();

        if (level === 'critical' || level === 'ended') {
            // Pulsing effect for critical time
            tl.to(timerEl, {
                backgroundColor: colors[level],
                scale: 1.05,
                duration: 0.3,
                repeat: level === 'ended' ? 3 : -1,
                yoyo: true,
                ease: "power2.inOut"
            });
        } else if (level === 'warning') {
            // Single color change for warning
            tl.to(timerEl, {
                backgroundColor: colors[level],
                duration: 0.5,
                ease: "power2.out"
            });
        }

        AnimationController.register('field-timer-warning', tl);
        return tl;
    },

    /**
     * Timer Milestone Animation
     * Flash effect at significant time points (5min, 10min, halftime)
     */
    animateTimerMilestone() {
        if (!this.isInitialized) this.init();

        const tl = gsap.timeline();

        // Quick pulse
        tl.to(this.elements.timer, {
            scale: 1.08,
            boxShadow: "0 0 40px rgba(255, 255, 255, 0.6)",
            duration: 0.15,
            ease: "power2.out"
        });

        tl.to(this.elements.timer, {
            scale: 1,
            boxShadow: "0 4px 15px rgba(0, 0, 0, 0.2)",
            duration: 0.4,
            ease: "elastic.out(1, 0.6)"
        });

        return tl;
    },

    /**
     * Team Name Update Animation
     *
     * @param {string} team - 'home' or 'away'
     * @param {string} newName - New team name
     */
    animateTeamNameChange(team, newName) {
        if (!this.isInitialized) this.init();

        const nameEl = team === 'home'
            ? this.elements.teamNameHome
            : this.elements.teamNameAway;

        const tl = gsap.timeline();

        // Fade out current name
        tl.to(nameEl, {
            opacity: 0,
            y: -10,
            duration: 0.2,
            ease: "power2.in"
        });

        // Update text
        tl.add(() => {
            nameEl.textContent = newName.toUpperCase();
        });

        // Fade in new name
        tl.to(nameEl, {
            opacity: 0.85,
            y: 0,
            duration: 0.3,
            ease: "power2.out"
        });

        return tl;
    },

    /**
     * Half Time Animation
     * Special effect for halftime
     */
    animateHalfTime() {
        if (!this.isInitialized) this.init();

        const tl = gsap.timeline();

        // All elements pulse
        tl.to([this.elements.scoreContainerHome, this.elements.scoreContainerAway], {
            scale: 0.95,
            duration: 0.3,
            ease: "power2.inOut"
        });

        tl.to(this.elements.timer, {
            backgroundColor: '#4CAF50',
            scale: 1.1,
            duration: 0.4,
            ease: "power2.out"
        }, "<");

        // Hold briefly
        tl.to({}, { duration: 1 });

        // Return to normal
        tl.to([this.elements.scoreContainerHome, this.elements.scoreContainerAway], {
            scale: 1,
            duration: 0.4,
            ease: "power2.out"
        });

        tl.to(this.elements.timer, {
            backgroundColor: '#FFFFFF',
            scale: 1,
            duration: 0.4,
            ease: "power2.out"
        }, "<");

        AnimationController.register('field-halftime', tl);
        return tl;
    },

    /**
     * Game Over Animation
     */
    animateGameOver() {
        if (!this.isInitialized) this.init();

        const tl = gsap.timeline();

        // Timer turns red and pulses
        tl.to(this.elements.timer, {
            backgroundColor: '#FF4444',
            scale: 1.1,
            duration: 0.3,
            ease: "power2.out"
        });

        // Scores flash
        tl.to([this.elements.scoreHome, this.elements.scoreAway], {
            color: '#FFD700',
            scale: 1.1,
            duration: 0.2,
            ease: "power2.out"
        }, "<");

        // Multiple pulses
        tl.to([this.elements.scoreContainerHome, this.elements.scoreContainerAway], {
            boxShadow: "0 0 50px rgba(255, 215, 0, 0.8)",
            duration: 0.3,
            repeat: 2,
            yoyo: true,
            ease: "power2.inOut"
        });

        // Settle
        tl.to([this.elements.scoreHome, this.elements.scoreAway], {
            color: '#000000',
            scale: 1,
            duration: 0.5,
            ease: "power2.out"
        });

        tl.to([this.elements.scoreContainerHome, this.elements.scoreContainerAway], {
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
            duration: 0.5,
            ease: "power2.out"
        }, "<");

        AnimationController.register('field-game-over', tl);
        return tl;
    }
};

// Export for use in other modules
window.FieldScoreboardAnimations = FieldScoreboardAnimations;

console.log('Field Scoreboard Animation Module loaded');
