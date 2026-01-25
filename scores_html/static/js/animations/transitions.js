/**
 * Transition Effects Module
 *
 * Broadcast-style transition effects for scene changes,
 * panel switches, and full-screen overlays.
 */

const TransitionEffects = {
    /**
     * Wipe transition between two elements
     * @param {Element} outElement - Element to hide
     * @param {Element} inElement - Element to show
     * @param {string} direction - 'left', 'right', 'up', 'down'
     */
    wipe(outElement, inElement, direction = 'left') {
        const tl = gsap.timeline();

        const clipPaths = {
            left: {
                out: { from: "inset(0 0 0 0)", to: "inset(0 0 0 100%)" },
                in: { from: "inset(0 100% 0 0)", to: "inset(0 0 0 0)" }
            },
            right: {
                out: { from: "inset(0 0 0 0)", to: "inset(0 100% 0 0)" },
                in: { from: "inset(0 0 0 100%)", to: "inset(0 0 0 0)" }
            },
            up: {
                out: { from: "inset(0 0 0 0)", to: "inset(0 0 100% 0)" },
                in: { from: "inset(100% 0 0 0)", to: "inset(0 0 0 0)" }
            },
            down: {
                out: { from: "inset(0 0 0 0)", to: "inset(100% 0 0 0)" },
                in: { from: "inset(0 0 100% 0)", to: "inset(0 0 0 0)" }
            }
        };

        // Ensure incoming element is visible
        gsap.set(inElement, {
            visibility: 'visible',
            clipPath: clipPaths[direction].in.from
        });

        // Wipe out
        tl.to(outElement, {
            clipPath: clipPaths[direction].out.to,
            duration: 0.6,
            ease: "power2.inOut"
        });

        // Wipe in (slightly overlapped)
        tl.to(inElement, {
            clipPath: clipPaths[direction].in.to,
            duration: 0.6,
            ease: "power2.inOut"
        }, "-=0.4");

        // Hide outgoing element after transition
        tl.set(outElement, { visibility: 'hidden' });

        return tl;
    },

    /**
     * Push transition (one element pushes another off screen)
     * @param {Element} outElement - Element to push out
     * @param {Element} inElement - Element pushing in
     * @param {string} direction - Direction of push
     */
    push(outElement, inElement, direction = 'left') {
        const movements = {
            left: { out: { xPercent: -100 }, in: { xPercent: 100 } },
            right: { out: { xPercent: 100 }, in: { xPercent: -100 } },
            up: { out: { yPercent: -100 }, in: { yPercent: 100 } },
            down: { out: { yPercent: 100 }, in: { yPercent: -100 } }
        };

        const tl = gsap.timeline();

        // Set incoming element starting position
        gsap.set(inElement, {
            visibility: 'visible',
            ...movements[direction].in
        });

        // Push both simultaneously
        tl.to(outElement, {
            ...movements[direction].out,
            duration: 0.5,
            ease: "power2.inOut"
        });

        tl.to(inElement, {
            xPercent: 0,
            yPercent: 0,
            duration: 0.5,
            ease: "power2.inOut"
        }, "<");

        tl.set(outElement, { visibility: 'hidden' });

        return tl;
    },

    /**
     * Fade transition with optional scale
     * @param {Element} outElement - Element to fade out
     * @param {Element} inElement - Element to fade in
     * @param {boolean} withScale - Add scale effect
     */
    fade(outElement, inElement, withScale = false) {
        const tl = gsap.timeline();

        const scaleProps = withScale
            ? { scale: 0.95 }
            : {};

        // Set incoming element
        gsap.set(inElement, {
            visibility: 'visible',
            opacity: 0,
            ...(withScale ? { scale: 1.05 } : {})
        });

        // Fade out
        tl.to(outElement, {
            opacity: 0,
            ...scaleProps,
            duration: 0.4,
            ease: "power2.in"
        });

        // Fade in
        tl.to(inElement, {
            opacity: 1,
            scale: 1,
            duration: 0.4,
            ease: "power2.out"
        }, "-=0.2");

        tl.set(outElement, { visibility: 'hidden', clearProps: "opacity,scale" });

        return tl;
    },

    /**
     * Split reveal (opens from center)
     * @param {Element} element - Element to reveal
     * @param {string} axis - 'horizontal' or 'vertical'
     */
    splitReveal(element, axis = 'horizontal') {
        const clipPath = axis === 'horizontal'
            ? { from: "inset(0 50% 0 50%)", to: "inset(0 0 0 0)" }
            : { from: "inset(50% 0 50% 0)", to: "inset(0 0 0 0)" };

        gsap.set(element, {
            visibility: 'visible',
            clipPath: clipPath.from
        });

        return gsap.to(element, {
            clipPath: clipPath.to,
            duration: 0.6,
            ease: "power3.out"
        });
    },

    /**
     * Split close (closes to center)
     * @param {Element} element - Element to close
     * @param {string} axis - 'horizontal' or 'vertical'
     */
    splitClose(element, axis = 'horizontal') {
        const clipPath = axis === 'horizontal'
            ? "inset(0 50% 0 50%)"
            : "inset(50% 0 50% 0)";

        return gsap.to(element, {
            clipPath: clipPath,
            duration: 0.5,
            ease: "power3.in",
            onComplete: () => {
                gsap.set(element, { visibility: 'hidden', clipPath: 'none' });
            }
        });
    },

    /**
     * Zoom transition
     * @param {Element} outElement - Element zooming out
     * @param {Element} inElement - Element zooming in
     * @param {string} direction - 'in' or 'out'
     */
    zoom(outElement, inElement, direction = 'in') {
        const tl = gsap.timeline();

        if (direction === 'in') {
            gsap.set(inElement, {
                visibility: 'visible',
                opacity: 0,
                scale: 0.5
            });

            tl.to(outElement, {
                opacity: 0,
                scale: 1.5,
                duration: 0.4,
                ease: "power2.in"
            });

            tl.to(inElement, {
                opacity: 1,
                scale: 1,
                duration: 0.5,
                ease: "back.out(1.2)"
            }, "-=0.2");
        } else {
            gsap.set(inElement, {
                visibility: 'visible',
                opacity: 0,
                scale: 2
            });

            tl.to(outElement, {
                opacity: 0,
                scale: 0.5,
                duration: 0.4,
                ease: "power2.in"
            });

            tl.to(inElement, {
                opacity: 1,
                scale: 1,
                duration: 0.5,
                ease: "power2.out"
            }, "-=0.2");
        }

        tl.set(outElement, { visibility: 'hidden', clearProps: "opacity,scale" });

        return tl;
    },

    /**
     * Blinds effect (venetian blind reveal)
     * @param {Element} element - Element to reveal
     * @param {number} slices - Number of blind slices
     */
    blinds(element, slices = 10) {
        // This creates a visual blinds effect using multiple clip-paths
        const tl = gsap.timeline();

        gsap.set(element, { visibility: 'visible' });

        // Create gradient mask effect
        for (let i = 0; i < slices; i++) {
            const delay = i * 0.03;
            const sliceHeight = 100 / slices;
            const top = i * sliceHeight;

            tl.fromTo(element,
                {
                    clipPath: `polygon(0 0, 100% 0, 100% ${top}%, 0 ${top}%)`
                },
                {
                    clipPath: `polygon(0 0, 100% 0, 100% ${top + sliceHeight}%, 0 ${top + sliceHeight}%)`,
                    duration: 0.1,
                    ease: "power1.out"
                },
                delay
            );
        }

        tl.set(element, { clipPath: 'none' });

        return tl;
    },

    /**
     * Glitch transition effect
     * @param {Element} element - Element to apply glitch to
     * @param {number} intensity - Glitch intensity (1-10)
     */
    glitch(element, intensity = 5) {
        const tl = gsap.timeline();
        const steps = intensity * 2;

        for (let i = 0; i < steps; i++) {
            const offsetX = (Math.random() - 0.5) * intensity * 4;
            const offsetY = (Math.random() - 0.5) * intensity * 2;
            const skew = (Math.random() - 0.5) * intensity;

            tl.to(element, {
                x: offsetX,
                y: offsetY,
                skewX: skew,
                duration: 0.05,
                ease: "none"
            });
        }

        // Reset
        tl.to(element, {
            x: 0,
            y: 0,
            skewX: 0,
            duration: 0.1,
            ease: "power2.out"
        });

        return tl;
    },

    /**
     * Flash white transition
     * Good for dramatic moments
     */
    flashWhite(callback) {
        // Create flash overlay if it doesn't exist
        let flash = document.getElementById('transition-flash');
        if (!flash) {
            flash = document.createElement('div');
            flash.id = 'transition-flash';
            flash.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: white;
                pointer-events: none;
                z-index: 99999;
                opacity: 0;
            `;
            document.body.appendChild(flash);
        }

        const tl = gsap.timeline();

        tl.to(flash, {
            opacity: 1,
            duration: 0.1,
            ease: "power2.out"
        });

        if (callback) {
            tl.add(callback);
        }

        tl.to(flash, {
            opacity: 0,
            duration: 0.4,
            ease: "power2.out"
        });

        return tl;
    }
};

// Export for use in other modules
window.TransitionEffects = TransitionEffects;

console.log('Transition Effects Module loaded');
