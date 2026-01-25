/**
 * Core Animation Module
 *
 * Central animation system using GSAP for sports broadcast-quality animations.
 * Provides base utilities, configuration, and shared animation infrastructure.
 */

// Animation configuration
const AnimationConfig = {
    // Global defaults
    defaults: {
        duration: 0.5,
        ease: "power2.out"
    },

    // Easing presets for broadcast-style animations
    easing: {
        // Smooth slide-in (professional broadcast feel)
        slideIn: "power3.out",
        // Bouncy entrance (attention-grabbing)
        bounce: "back.out(1.7)",
        // Elastic settle (organic feel)
        elastic: "elastic.out(1, 0.5)",
        // Sharp snap (urgent/impactful)
        snap: "power4.out",
        // Smooth exit
        slideOut: "power2.in",
        // Linear for continuous animations
        linear: "none"
    },

    // Timing presets (in seconds)
    timing: {
        instant: 0.1,
        fast: 0.3,
        normal: 0.5,
        slow: 0.8,
        verySlow: 1.2
    },

    // Stagger presets
    stagger: {
        fast: 0.05,
        normal: 0.1,
        slow: 0.15
    },

    // Display durations (how long elements stay visible)
    display: {
        scorer: 9000,      // 9 seconds
        assist: 7000,      // 7 seconds (appears 1s after scorer, leaves 1s before)
        timeout: 50000,    // 50 seconds
        matchEvent: 4000,  // 4 seconds for start/end
        scoreFlash: 400    // Score pulse duration
    }
};

// Set GSAP defaults
gsap.defaults({
    duration: AnimationConfig.defaults.duration,
    ease: AnimationConfig.defaults.ease
});

/**
 * Animation Presets
 * Reusable animation configurations for common broadcast effects
 */
const AnimationPresets = {
    /**
     * Slide in from a direction
     * @param {Element|string} target - Target element(s)
     * @param {string} direction - 'left', 'right', 'up', 'down'
     * @param {Object} options - Additional GSAP options
     */
    slideIn(target, direction = 'left', options = {}) {
        const distance = 100;
        const props = {
            left: { xPercent: -distance },
            right: { xPercent: distance },
            up: { yPercent: -distance },
            down: { yPercent: distance }
        };

        return gsap.from(target, {
            ...props[direction],
            opacity: 0,
            duration: AnimationConfig.timing.normal,
            ease: AnimationConfig.easing.slideIn,
            ...options
        });
    },

    /**
     * Slide out to a direction
     * @param {Element|string} target - Target element(s)
     * @param {string} direction - 'left', 'right', 'up', 'down'
     * @param {Object} options - Additional GSAP options
     */
    slideOut(target, direction = 'left', options = {}) {
        const distance = 100;
        const props = {
            left: { xPercent: -distance },
            right: { xPercent: distance },
            up: { yPercent: -distance },
            down: { yPercent: distance }
        };

        return gsap.to(target, {
            ...props[direction],
            opacity: 0,
            duration: AnimationConfig.timing.fast,
            ease: AnimationConfig.easing.slideOut,
            ...options
        });
    },

    /**
     * Scale pulse effect (for score changes)
     * @param {Element|string} target - Target element(s)
     * @param {number} scale - Maximum scale
     * @param {Object} options - Additional options
     */
    pulse(target, scale = 1.2, options = {}) {
        return gsap.timeline(options)
            .to(target, {
                scale: scale,
                duration: AnimationConfig.timing.instant,
                ease: AnimationConfig.easing.snap
            })
            .to(target, {
                scale: 1,
                duration: AnimationConfig.timing.normal,
                ease: AnimationConfig.easing.elastic
            });
    },

    /**
     * Flash effect (color change and back)
     * @param {Element|string} target - Target element(s)
     * @param {string} color - Flash color
     * @param {Object} options - Additional options
     */
    flash(target, color, options = {}) {
        const originalColor = gsap.getProperty(target, "backgroundColor");

        return gsap.timeline(options)
            .to(target, {
                backgroundColor: color,
                duration: AnimationConfig.timing.instant,
                ease: AnimationConfig.easing.snap
            })
            .to(target, {
                backgroundColor: originalColor,
                duration: 2,
                ease: "power1.out"
            });
    },

    /**
     * Wipe reveal effect using clip-path
     * @param {Element|string} target - Target element(s)
     * @param {string} direction - 'left', 'right', 'up', 'down'
     * @param {Object} options - Additional options
     */
    wipeIn(target, direction = 'left', options = {}) {
        const clipPaths = {
            left: { from: "inset(0 100% 0 0)", to: "inset(0 0% 0 0)" },
            right: { from: "inset(0 0 0 100%)", to: "inset(0 0 0 0%)" },
            up: { from: "inset(100% 0 0 0)", to: "inset(0% 0 0 0)" },
            down: { from: "inset(0 0 100% 0)", to: "inset(0 0 0% 0)" }
        };

        gsap.set(target, { clipPath: clipPaths[direction].from });

        return gsap.to(target, {
            clipPath: clipPaths[direction].to,
            duration: AnimationConfig.timing.normal,
            ease: AnimationConfig.easing.slideIn,
            ...options
        });
    },

    /**
     * Wipe out effect
     * @param {Element|string} target - Target element(s)
     * @param {string} direction - 'left', 'right', 'up', 'down'
     * @param {Object} options - Additional options
     */
    wipeOut(target, direction = 'left', options = {}) {
        const clipPaths = {
            left: { to: "inset(0 100% 0 0)" },
            right: { to: "inset(0 0 0 100%)" },
            up: { to: "inset(100% 0 0 0)" },
            down: { to: "inset(0 0 100% 0)" }
        };

        return gsap.to(target, {
            clipPath: clipPaths[direction].to,
            duration: AnimationConfig.timing.fast,
            ease: AnimationConfig.easing.slideOut,
            ...options
        });
    },

    /**
     * Stagger reveal for multiple elements
     * @param {Element|string} targets - Target elements
     * @param {Object} options - Additional options
     */
    staggerReveal(targets, options = {}) {
        return gsap.from(targets, {
            opacity: 0,
            y: 20,
            stagger: AnimationConfig.stagger.normal,
            duration: AnimationConfig.timing.fast,
            ease: AnimationConfig.easing.slideIn,
            ...options
        });
    },

    /**
     * Typewriter effect for text
     * @param {Element|string} target - Target element
     * @param {Object} options - Additional options
     */
    typewriter(target, options = {}) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        const text = element.textContent;
        element.textContent = '';

        const tl = gsap.timeline(options);

        for (let i = 0; i < text.length; i++) {
            tl.add(() => {
                element.textContent = text.substring(0, i + 1);
            }, i * 0.03);
        }

        return tl;
    },

    /**
     * Number counter animation
     * @param {Element|string} target - Target element
     * @param {number} endValue - Final number
     * @param {Object} options - Additional options
     */
    countTo(target, endValue, options = {}) {
        const element = typeof target === 'string' ? document.querySelector(target) : target;
        const startValue = parseInt(element.textContent) || 0;

        return gsap.to({ val: startValue }, {
            val: endValue,
            duration: options.duration || AnimationConfig.timing.normal,
            ease: options.ease || "power2.out",
            onUpdate: function() {
                element.textContent = Math.round(this.targets()[0].val);
            },
            ...options
        });
    }
};

/**
 * Timeline Factory
 * Creates pre-configured timelines for complex animation sequences
 */
const TimelineFactory = {
    /**
     * Create a basic timeline with default settings
     * @param {Object} options - Timeline options
     */
    create(options = {}) {
        return gsap.timeline({
            paused: options.paused || false,
            ...options
        });
    },

    /**
     * Create a timeline that auto-reverses after a delay
     * @param {number} displayDuration - How long to display (ms)
     * @param {Object} options - Timeline options
     */
    createAutoReverse(displayDuration, options = {}) {
        const tl = gsap.timeline({
            paused: true,
            ...options
        });

        // Store display duration for later use
        tl.displayDuration = displayDuration;

        return tl;
    },

    /**
     * Play a timeline and auto-reverse after delay
     * @param {GSAPTimeline} timeline - The timeline to play
     */
    playAndReverse(timeline) {
        timeline.play();

        if (timeline.displayDuration) {
            setTimeout(() => {
                timeline.reverse();
            }, timeline.displayDuration);
        }
    }
};

/**
 * Animation Controller
 * Manages active animations and provides cleanup
 */
const AnimationController = {
    // Store active animations by ID
    activeAnimations: new Map(),

    /**
     * Register an animation
     * @param {string} id - Unique identifier
     * @param {GSAPTimeline|GSAPTween} animation - The animation
     */
    register(id, animation) {
        // Kill existing animation with same ID
        if (this.activeAnimations.has(id)) {
            this.activeAnimations.get(id).kill();
        }
        this.activeAnimations.set(id, animation);
    },

    /**
     * Get an animation by ID
     * @param {string} id - Animation ID
     */
    get(id) {
        return this.activeAnimations.get(id);
    },

    /**
     * Kill an animation by ID
     * @param {string} id - Animation ID
     */
    kill(id) {
        if (this.activeAnimations.has(id)) {
            this.activeAnimations.get(id).kill();
            this.activeAnimations.delete(id);
        }
    },

    /**
     * Kill all active animations
     */
    killAll() {
        this.activeAnimations.forEach(animation => animation.kill());
        this.activeAnimations.clear();
    },

    /**
     * Pause all animations
     */
    pauseAll() {
        this.activeAnimations.forEach(animation => animation.pause());
    },

    /**
     * Resume all animations
     */
    resumeAll() {
        this.activeAnimations.forEach(animation => animation.resume());
    }
};

// Export for use in other modules
window.AnimationConfig = AnimationConfig;
window.AnimationPresets = AnimationPresets;
window.TimelineFactory = TimelineFactory;
window.AnimationController = AnimationController;

console.log('Animation Core Module loaded');
