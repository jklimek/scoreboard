/**
 * Scoreboard Animation Module
 *
 * Handles all animations for the main scoreboard overlay:
 * - Scorer/Assist lower third graphics
 * - Score change animations
 * - Disc possession transitions
 * - Timer effects
 * - Match start/end sequences
 */

const ScoreboardAnimations = {
    // Store jQuery handles (set during init)
    elements: {},

    // Active timelines
    timelines: {
        scorer: null,
        score: null,
        possession: null
    },

    /**
     * Initialize the animation module with element references
     * @param {Object} elements - jQuery element references
     */
    init(elements) {
        this.elements = elements;
        console.log('Scoreboard Animations initialized');
    },

    /**
     * Scorer/Assist Animation Sequence
     * Complete timeline for goal-scored lower third graphic
     *
     * Timeline:
     * 0.0s - Scorer bar slides in from left
     * 0.3s - Scorer text fades in
     * 1.0s - Assist bar slides up from bottom
     * 8.0s - Assist bar slides down
     * 9.0s - Scorer bar slides out
     *
     * @param {Element} teamHandle - The team box element (for color flash)
     * @param {string} scorer - Scorer name
     * @param {string} assist - Assist name
     */
    animateScore(teamHandle, scorer, assist) {
        // Kill any existing scorer animation
        if (this.timelines.scorer) {
            this.timelines.scorer.kill();
        }

        const scorerEl = document.getElementById('scorer');
        const assistEl = document.getElementById('assist');

        // Set text content
        scorerEl.textContent = scorer.toString().toUpperCase();
        assistEl.textContent = assist.toString().toUpperCase();

        // Get CSS variable for accent color
        const accentColor = getComputedStyle(document.body)
            .getPropertyValue('--box-point-accent-color').trim();
        const bgColor = getComputedStyle(document.body)
            .getPropertyValue('--box-bg-color').trim();

        // Create the main timeline
        const tl = gsap.timeline({
            onComplete: () => {
                // Reset states after animation completes
                gsap.set(scorerEl, { clearProps: "all" });
                gsap.set(assistEl, { clearProps: "all" });
            }
        });

        // Team box color flash
        tl.to(teamHandle, {
            backgroundColor: accentColor,
            duration: 0.1,
            ease: "power2.out"
        }, 0);

        // Scorer slides in from left
        tl.fromTo(scorerEl,
            { left: '-70%', opacity: 1 },
            {
                left: '0%',
                duration: 0.65,
                ease: "back.out(1.2)"
            },
            0
        );

        // Assist slides up (after 1 second delay)
        tl.fromTo(assistEl,
            { bottom: '-60px' },
            {
                bottom: '0px',
                duration: 0.5,
                ease: "back.out(1.4)"
            },
            1
        );

        // Assist slides down (at 8 seconds)
        tl.to(assistEl, {
            bottom: '-60px',
            duration: 0.35,
            ease: "power2.in"
        }, 8);

        // Scorer slides out (at 9 seconds)
        tl.to(scorerEl, {
            left: '-70%',
            duration: 0.5,
            ease: "power2.in"
        }, 9);

        // Team box color fade back (8 second duration starting at 0.1s)
        tl.to(teamHandle, {
            backgroundColor: bgColor,
            duration: 8,
            ease: "power1.out"
        }, 0.1);

        this.timelines.scorer = tl;
        AnimationController.register('scorer', tl);

        return tl;
    },

    /**
     * Score Update Animation
     * Pulse effect when score changes
     *
     * @param {Element|string} scoreElement - The score display element
     * @param {number} newScore - The new score value
     */
    animateScoreChange(scoreElement, newScore) {
        const el = typeof scoreElement === 'string'
            ? document.querySelector(scoreElement)
            : scoreElement;

        const tl = gsap.timeline();

        // Pulse scale effect
        tl.to(el, {
            scale: 1.3,
            duration: 0.1,
            ease: "power2.out"
        });

        // Update the score text at peak of animation
        tl.add(() => {
            el.textContent = newScore.toString();
        });

        // Settle back with elastic ease
        tl.to(el, {
            scale: 1,
            duration: 0.5,
            ease: "elastic.out(1, 0.4)"
        });

        AnimationController.register('score-change', tl);
        return tl;
    },

    /**
     * Disc Possession Change Animation
     *
     * @param {Element} gainElement - Element gaining possession
     * @param {Element} loseElement - Element losing possession (optional)
     */
    animatePossessionChange(gainElement, loseElement = null) {
        const accentColor = getComputedStyle(document.body)
            .getPropertyValue('--box-point-accent-color').trim();

        const tl = gsap.timeline();

        // Fade out old possession indicator
        if (loseElement) {
            tl.to(loseElement, {
                borderRightWidth: '0px',
                borderRightColor: 'transparent',
                duration: 0.2,
                ease: "power2.out"
            }, 0);
        }

        // Fade in new possession indicator
        tl.to(gainElement, {
            borderRightWidth: '5px',
            borderRightColor: accentColor,
            duration: 0.3,
            ease: "back.out(2)"
        }, 0.1);

        return tl;
    },

    /**
     * Match Start Animation Sequence
     *
     * @param {number} timerOffset - Timer starting offset
     */
    animateMatchStart(timerOffset = 0) {
        const scorerEl = document.getElementById('scorer');
        const timerEl = document.getElementById('timer');

        // Set "START" text
        scorerEl.textContent = 'START';

        const tl = gsap.timeline();

        // Timer highlight
        tl.to(timerEl, {
            backgroundColor: getComputedStyle(document.body)
                .getPropertyValue('--box-point-accent-color').trim(),
            duration: 0.2,
            ease: "power2.out"
        }, 0);

        // Scorer slides in
        tl.fromTo(scorerEl,
            { left: '-70%' },
            {
                left: '0%',
                duration: 0.6,
                ease: "back.out(1.2)"
            },
            0
        );

        // Scorer slides out (after 4 seconds)
        tl.to(scorerEl, {
            left: '-70%',
            duration: 0.4,
            ease: "power2.in"
        }, 4);

        // Timer color fade back
        tl.to(timerEl, {
            backgroundColor: getComputedStyle(document.body)
                .getPropertyValue('--box-bg-color').trim(),
            duration: 8,
            ease: "power1.out"
        }, 0.2);

        AnimationController.register('match-start', tl);
        return tl;
    },

    /**
     * Match End Animation Sequence
     */
    animateMatchEnd() {
        const scorerEl = document.getElementById('scorer');
        const timerEl = document.getElementById('timer');

        // Set "END" text
        scorerEl.textContent = 'KONIEC MECZU';

        const tl = gsap.timeline();

        // Timer highlight
        tl.to(timerEl, {
            backgroundColor: getComputedStyle(document.body)
                .getPropertyValue('--box-point-accent-color').trim(),
            duration: 0.2,
            ease: "power2.out"
        }, 0);

        // Scorer slides in with emphasis
        tl.fromTo(scorerEl,
            { left: '-70%' },
            {
                left: '0%',
                duration: 0.7,
                ease: "back.out(1.5)"
            },
            0
        );

        // Scorer stays longer for end of match
        tl.to(scorerEl, {
            left: '-70%',
            duration: 0.5,
            ease: "power2.in"
        }, 10);

        // Timer color fade back
        tl.to(timerEl, {
            backgroundColor: getComputedStyle(document.body)
                .getPropertyValue('--box-bg-color').trim(),
            duration: 8,
            ease: "power1.out"
        }, 0.2);

        AnimationController.register('match-end', tl);
        return tl;
    },

    /**
     * Timeout Animation
     *
     * @param {Element} teamHandle - Team box element
     */
    animateTimeout(teamHandle) {
        const scorerEl = document.getElementById('scorer');

        scorerEl.textContent = 'TIMEOUT';

        const accentColor = getComputedStyle(document.body)
            .getPropertyValue('--box-point-accent-color').trim();
        const bgColor = getComputedStyle(document.body)
            .getPropertyValue('--box-bg-color').trim();

        const tl = gsap.timeline();

        // Team box flash
        tl.to(teamHandle, {
            backgroundColor: accentColor,
            duration: 0.1,
            ease: "power2.out"
        }, 0);

        // Scorer slides in
        tl.fromTo(scorerEl,
            { left: '-70%' },
            {
                left: '0%',
                duration: 0.5,
                ease: "back.out(1.2)"
            },
            0
        );

        // Pulsing effect during timeout
        tl.to(scorerEl, {
            scale: 1.02,
            duration: 1,
            repeat: 24,
            yoyo: true,
            ease: "sine.inOut"
        }, 0.5);

        // Scorer slides out (after 50 seconds)
        tl.to(scorerEl, {
            left: '-70%',
            duration: 0.5,
            ease: "power2.in"
        }, 50);

        // Team box fade back
        tl.to(teamHandle, {
            backgroundColor: bgColor,
            duration: 2,
            ease: "power1.out"
        }, 50);

        AnimationController.register('timeout', tl);
        return tl;
    },

    /**
     * Timer Milestone Effect
     * Flash effect at significant time points
     *
     * @param {Element} timerElement - Timer element
     */
    animateTimerMilestone(timerElement) {
        return AnimationPresets.pulse(timerElement, 1.1);
    },

    /**
     * Initial Board Entrance Animation
     * Animate the scoreboard appearing on screen
     */
    animateBoardEntrance() {
        const board = document.querySelector('.board');
        const boxes = document.querySelectorAll('.board__box');

        const tl = gsap.timeline();

        // Board container slides in
        tl.from(board, {
            xPercent: -100,
            duration: 0.6,
            ease: "power3.out"
        });

        // Individual boxes stagger in
        tl.from(boxes, {
            opacity: 0,
            x: -20,
            stagger: 0.1,
            duration: 0.3,
            ease: "power2.out"
        }, "-=0.3");

        return tl;
    }
};

// Export for use in other modules
window.ScoreboardAnimations = ScoreboardAnimations;

console.log('Scoreboard Animation Module loaded');
