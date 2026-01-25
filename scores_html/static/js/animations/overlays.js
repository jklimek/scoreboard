/**
 * Overlay Panel Animation Module
 *
 * Handles animations for overlay panels:
 * - Stats panel with animated bars
 * - Roster reveal with stagger
 * - Player stats table entrance
 * - Wind overlay transitions
 */

const OverlayAnimations = {
    // Active overlay timelines
    timelines: {
        stats: null,
        roster: null,
        playerStats: null,
        wind: null
    },

    /**
     * Stats Panel Show Animation
     * Slides in panel with animated stat bars
     *
     * @param {Element|string} panelElement - Stats panel element
     * @param {Object} options - Animation options
     */
    showStats(panelElement, options = {}) {
        const panel = typeof panelElement === 'string'
            ? document.querySelector(panelElement)
            : panelElement;

        // Kill existing animation
        if (this.timelines.stats) {
            this.timelines.stats.kill();
        }

        const teamNames = panel.querySelectorAll('.stats__name');
        const statRows = panel.querySelectorAll('.stats__stats li');
        const statBars = panel.querySelectorAll('.stats__stats-th-container li, .stats__stats-ta-container li');
        const infoBar = panel.querySelector('#stats__info');

        const tl = gsap.timeline({
            onStart: () => {
                panel.style.display = 'grid';
            }
        });

        // Panel fade in
        tl.fromTo(panel,
            { opacity: 0 },
            {
                opacity: 1,
                duration: 0.4,
                ease: "power2.out"
            }
        );

        // Team names slide down
        tl.from(teamNames, {
            yPercent: -100,
            opacity: 0,
            stagger: 0.15,
            duration: 0.4,
            ease: "back.out(1.5)"
        }, "-=0.2");

        // Stat category labels cascade in
        tl.from(statRows, {
            scale: 0.8,
            opacity: 0,
            stagger: 0.05,
            duration: 0.3,
            ease: "power2.out"
        }, "-=0.2");

        // Stat bars grow from center
        tl.from(statBars, {
            scaleX: 0,
            opacity: 0,
            stagger: 0.03,
            duration: 0.5,
            ease: "power3.out",
            transformOrigin: (index, target) => {
                // Left bars grow from right, right bars from left
                return target.closest('.stats__stats-th-container') ? 'right center' : 'left center';
            }
        }, "-=0.3");

        // Info bar slides up
        if (infoBar) {
            tl.from(infoBar, {
                yPercent: 50,
                opacity: 0,
                duration: 0.4,
                ease: "power2.out"
            }, "-=0.2");
        }

        this.timelines.stats = tl;
        AnimationController.register('stats-show', tl);

        return tl;
    },

    /**
     * Stats Panel Hide Animation
     *
     * @param {Element|string} panelElement - Stats panel element
     */
    hideStats(panelElement) {
        const panel = typeof panelElement === 'string'
            ? document.querySelector(panelElement)
            : panelElement;

        const tl = gsap.timeline({
            onComplete: () => {
                panel.style.display = 'none';
                gsap.set(panel, { clearProps: "opacity" });
            }
        });

        tl.to(panel, {
            opacity: 0,
            duration: 0.4,
            ease: "power2.in"
        });

        AnimationController.register('stats-hide', tl);
        return tl;
    },

    /**
     * Roster Panel Show Animation
     * Cascade reveal with player stagger
     *
     * @param {Element|string} panelElement - Roster panel element
     */
    showRoster(panelElement) {
        const panel = typeof panelElement === 'string'
            ? document.querySelector(panelElement)
            : panelElement;

        // Kill existing animation
        if (this.timelines.roster) {
            this.timelines.roster.kill();
        }

        const teamNames = panel.querySelectorAll('.roster__name');
        const playerRows = panel.querySelectorAll('.roster-table tr');
        const infoBar = panel.querySelector('#roster__info');

        const tl = gsap.timeline({
            onStart: () => {
                panel.style.display = 'grid';
            }
        });

        // Panel fade in with slight scale
        tl.fromTo(panel,
            { opacity: 0, scale: 0.95 },
            {
                opacity: 1,
                scale: 1,
                duration: 0.5,
                ease: "power2.out"
            }
        );

        // Team name headers wipe in
        tl.from(teamNames, {
            clipPath: "inset(0 100% 0 0)",
            stagger: 0.2,
            duration: 0.5,
            ease: "power3.out"
        }, "-=0.3");

        // Player rows cascade in
        tl.from(playerRows, {
            x: -30,
            opacity: 0,
            stagger: {
                each: 0.04,
                from: "start"
            },
            duration: 0.3,
            ease: "power2.out"
        }, "-=0.3");

        // Info bar slides up
        if (infoBar) {
            tl.from(infoBar, {
                yPercent: 30,
                opacity: 0,
                duration: 0.4,
                ease: "back.out(1.2)"
            }, "-=0.2");
        }

        this.timelines.roster = tl;
        AnimationController.register('roster-show', tl);

        return tl;
    },

    /**
     * Roster Panel Hide Animation
     *
     * @param {Element|string} panelElement - Roster panel element
     */
    hideRoster(panelElement) {
        const panel = typeof panelElement === 'string'
            ? document.querySelector(panelElement)
            : panelElement;

        const playerRows = panel.querySelectorAll('.roster-table tr');

        const tl = gsap.timeline({
            onComplete: () => {
                panel.style.display = 'none';
                gsap.set(panel, { clearProps: "all" });
                gsap.set(playerRows, { clearProps: "all" });
            }
        });

        // Player rows fade out quickly
        tl.to(playerRows, {
            opacity: 0,
            x: 20,
            stagger: {
                each: 0.02,
                from: "end"
            },
            duration: 0.2,
            ease: "power2.in"
        });

        // Panel fades out
        tl.to(panel, {
            opacity: 0,
            duration: 0.3,
            ease: "power2.in"
        }, "-=0.1");

        AnimationController.register('roster-hide', tl);
        return tl;
    },

    /**
     * Player Stats Panel Show Animation
     *
     * @param {Element|string} panelElement - Player stats panel element
     */
    showPlayerStats(panelElement) {
        const panel = typeof panelElement === 'string'
            ? document.querySelector(panelElement)
            : panelElement;

        // Kill existing animation
        if (this.timelines.playerStats) {
            this.timelines.playerStats.kill();
        }

        const teamNames = panel.querySelectorAll('.player-stats__name');
        const tableHeaders = panel.querySelectorAll('.player-stats-table th');
        const tableRows = panel.querySelectorAll('.player-stats-table tbody tr');
        const infoBar = panel.querySelector('#player-stats__info');

        const tl = gsap.timeline({
            onStart: () => {
                panel.style.display = 'grid';
            }
        });

        // Panel fade in
        tl.fromTo(panel,
            { opacity: 0 },
            {
                opacity: 1,
                duration: 0.4,
                ease: "power2.out"
            }
        );

        // Team names bounce in
        tl.from(teamNames, {
            y: -40,
            opacity: 0,
            stagger: 0.1,
            duration: 0.5,
            ease: "back.out(1.5)"
        }, "-=0.2");

        // Table headers slide down
        tl.from(tableHeaders, {
            y: -20,
            opacity: 0,
            stagger: 0.05,
            duration: 0.3,
            ease: "power2.out"
        }, "-=0.3");

        // Player rows stagger in with highlight effect
        tl.from(tableRows, {
            x: -40,
            opacity: 0,
            stagger: {
                each: 0.08,
                from: "start"
            },
            duration: 0.4,
            ease: "power2.out"
        }, "-=0.2");

        // Info bar entrance
        if (infoBar) {
            tl.from(infoBar, {
                yPercent: 30,
                opacity: 0,
                duration: 0.4,
                ease: "back.out(1.2)"
            }, "-=0.2");
        }

        this.timelines.playerStats = tl;
        AnimationController.register('player-stats-show', tl);

        return tl;
    },

    /**
     * Player Stats Panel Hide Animation
     *
     * @param {Element|string} panelElement - Player stats panel element
     */
    hidePlayerStats(panelElement) {
        const panel = typeof panelElement === 'string'
            ? document.querySelector(panelElement)
            : panelElement;

        const tl = gsap.timeline({
            onComplete: () => {
                panel.style.display = 'none';
                gsap.set(panel, { clearProps: "all" });
            }
        });

        tl.to(panel, {
            opacity: 0,
            scale: 0.95,
            duration: 0.4,
            ease: "power2.in"
        });

        AnimationController.register('player-stats-hide', tl);
        return tl;
    },

    /**
     * Wind Overlay Show Animation
     *
     * @param {Element|string} windElement - Wind overlay element
     */
    showWind(windElement) {
        const wind = typeof windElement === 'string'
            ? document.querySelector(windElement)
            : windElement;

        // Kill existing animation
        if (this.timelines.wind) {
            this.timelines.wind.kill();
        }

        const windBoxes = wind.querySelectorAll('.wind__box');

        const tl = gsap.timeline();

        // Container slides in from right
        tl.fromTo(wind,
            { opacity: 0, x: 50 },
            {
                opacity: 1,
                x: 0,
                duration: 0.5,
                ease: "power3.out"
            }
        );

        // Individual boxes stagger in
        tl.from(windBoxes, {
            scale: 0.8,
            opacity: 0,
            stagger: 0.08,
            duration: 0.3,
            ease: "back.out(1.5)"
        }, "-=0.3");

        this.timelines.wind = tl;
        AnimationController.register('wind-show', tl);

        return tl;
    },

    /**
     * Wind Overlay Hide Animation
     *
     * @param {Element|string} windElement - Wind overlay element
     */
    hideWind(windElement) {
        const wind = typeof windElement === 'string'
            ? document.querySelector(windElement)
            : windElement;

        const tl = gsap.timeline();

        tl.to(wind, {
            opacity: 0,
            x: 30,
            duration: 0.3,
            ease: "power2.in"
        });

        AnimationController.register('wind-hide', tl);
        return tl;
    },

    /**
     * Wind Arrow Rotation Animation
     *
     * @param {Element|string} arrowElement - Arrow element
     * @param {number} targetAngle - Target rotation angle
     */
    animateWindArrow(arrowElement, targetAngle) {
        const arrow = typeof arrowElement === 'string'
            ? document.querySelector(arrowElement)
            : arrowElement;

        return gsap.to(arrow, {
            rotation: targetAngle - 45, // Offset for arrow visual alignment
            duration: 0.5,
            ease: "power2.out"
        });
    },

    /**
     * Stat Bar Update Animation
     * Animate stat bar width changes
     *
     * @param {Element|string} barElement - Stat bar element
     * @param {number} percentage - Target width percentage
     */
    animateStatBar(barElement, percentage) {
        const bar = typeof barElement === 'string'
            ? document.querySelector(barElement)
            : barElement;

        return gsap.to(bar, {
            width: `${percentage}%`,
            duration: 0.6,
            ease: "power2.out"
        });
    },

    /**
     * Toggle overlay with animation
     * Unified method for showing/hiding overlays
     *
     * @param {string} overlayType - 'stats', 'roster', 'playerStats', 'wind'
     * @param {Element|string} element - Overlay element
     * @param {boolean} show - True to show, false to hide
     */
    toggleOverlay(overlayType, element, show) {
        const methods = {
            stats: { show: 'showStats', hide: 'hideStats' },
            roster: { show: 'showRoster', hide: 'hideRoster' },
            playerStats: { show: 'showPlayerStats', hide: 'hidePlayerStats' },
            wind: { show: 'showWind', hide: 'hideWind' }
        };

        const methodName = show ? methods[overlayType].show : methods[overlayType].hide;
        return this[methodName](element);
    }
};

// Export for use in other modules
window.OverlayAnimations = OverlayAnimations;

console.log('Overlay Animation Module loaded');
