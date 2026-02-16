# Sports TV Broadcast Animation System - Implementation Plan

## Executive Summary

Transform the current basic scoreboard animations into professional sports television-style broadcast graphics with smooth transitions, coordinated sequences, and dynamic visual effects.

**Key Decision**: Stay with vanilla JavaScript + Anime.js (already present but unused). No framework migration needed.

**Timeline**: 5 phases over 5-6 weeks

**Impact**: All 8 views (scoreboard, field_scoreboard, roster, stats, player_stats, matches, wind, controller)

---

## Current State Analysis

### Technology Stack
- **Frontend**: Vanilla JavaScript + jQuery (86KB)
- **Animation Library**: Anime.js v3.0.0 (17KB) - **PRESENT BUT UNUSED**
- **Real-time**: WebSocket (port 5005) with 4-second update intervals
- **Templating**: Flask Jinja2
- **Build**: None (direct file serving)
- **Styling**: Pure CSS with custom properties, no preprocessor

### Current Animation Approach
- Simple CSS transitions (opacity, 0.4-0.9s durations)
- jQuery `.animate()` for wind arrow rotation only
- Class-based toggles (`.active` class triggers CSS transitions)
- No coordinated multi-element sequences
- No number count-up animations
- Basic fade in/out for overlays

### Key Files
- `scores_html/static/js/scoreboard.js` (612 lines) - Main display logic, WebSocket event parsing
- `scores_html/static/js/field_scoreboard.js` (260 lines) - Stadium display with countdown timer
- `scores_html/static/js/controller.js` - Operator control interface
- `scores_html/static/css/scoreboard.css` (588 lines) - Main broadcast styling
- `scores_html/templates/*.html` (8 templates) - All display views

### Limitations
- No professional broadcast-style animations (slide, bounce, scale)
- Score updates are instant (no celebration effects)
- Overlays pop in/out without smooth transitions
- Stats bars update instantly (no growth animation)
- No staggered list animations
- No lower-thirds style graphics
- Limited coordination between animation elements

---

## Recommended Architecture

### Stay Vanilla JavaScript + Anime.js

**Why NO Framework (React/Vue/Svelte)?**
1. Current vanilla architecture works well for WebSocket-driven updates
2. Framework adds 40-100KB+ overhead and complexity
3. No build process needed - maintain fast deployment
4. WebSocket integration simpler without framework abstractions
5. Broadcast displays prioritize speed over component abstractions

**Why Anime.js is Sufficient?**
1. Already present in codebase (17KB, v3.0.0)
2. Covers all requirements: timelines, stagger, easing, transforms
3. GPU-accelerated CSS transform animations
4. Better performance than GSAP for CSS-heavy animations
5. No licensing complexity (MIT license)

**Why NOT Add GSAP?**
- Adds 50KB+ and commercial licensing concerns
- Anime.js handles all identified use cases
- Avoid library bloat for broadcast systems

---

## Implementation Plan

### Phase 1: Animation Foundation (Week 1)

**Goal**: Set up animation infrastructure without breaking existing functionality

**Tasks**:

1. **Create Animation Utilities Module**
   - File: `scores_html/static/js/animations.js` (NEW)
   - Contents:
     - Entrance animations (slideInLeft, slideInRight, slideInTop, slideInBottom, scaleUp, fadeIn)
     - Exit animations (slideOutLeft, slideOutRight, slideOutTop, slideOutBottom, scaleDown, fadeOut)
     - Celebration effects (pulseScale, bounceIn, shakeX, glowPulse)
     - Number counter animations (animateNumber)
     - Timeline sequences (scorerSequence, overlayShowSequence, overlayHideSequence, statsBarSequence)
     - Utility functions (staggerDelay, createTimeline, stopAllAnimations)

2. **Create Animation Queue System**
   - File: `scores_html/static/js/animation-queue.js` (NEW)
   - Prevents animation conflicts when rapid WebSocket events occur
   - Queue management: add, cancel, priority system

3. **Add Anime.js to HTML Templates**
   - Modify ALL 8 templates in `scores_html/templates/`
   - Add before existing script tags:
     ```html
     <script src="../static/js/anime.min.js"></script>
     <script src="../static/js/animations.js"></script>
     <script src="../static/js/animation-queue.js"></script>
     ```

4. **Create Animation-Specific CSS**
   - File: `scores_html/static/css/animations.css` (NEW)
   - GPU acceleration hints (will-change: transform, opacity)
   - Animation helper classes (.animatable, .score-celebrate, .lower-third-base)
   - Transform-origin presets

**Success Criteria**:
- All views load without errors
- Anime.js available globally (test in browser console)
- Existing CSS animations still work
- No visual regressions

---

### Phase 2: Main Scoreboard Animations (Week 2)

**Goal**: Migrate primary broadcast view (`scoreboard.html`) to professional animations

**Critical File**: `scores_html/static/js/scoreboard.js`

**Animations to Implement**:

1. **Score Update Animation** (`score()` function, ~line 200)
   - Replace instant text update with number count-up animation
   - Duration: 800ms, easing: easeOutCubic
   - Trigger: WebSocket score_set or score event

2. **Score Celebration Effect**
   - Pulse scale animation (1.0 → 1.1 → 1.0)
   - Glow effect via CSS drop-shadow
   - Duration: 1200ms
   - Trigger: New score event (subtype: "score")

3. **Scorer Banner Animation** (`scorerHandle`, ~line 24)
   - Replace CSS fade with slide-in from left
   - Add elastic overshoot (easeOutElastic)
   - Duration: 900ms
   - Stay visible: 8 seconds
   - Exit: slide-out to left (600ms)

4. **Assist Banner Animation** (`assistHandle`, ~line 25)
   - Slide-in from bottom
   - Delay: 1000ms after scorer appears
   - Duration: 600ms
   - Stay visible: 8 seconds (same as scorer)
   - Exit: slide-out to bottom (400ms)

5. **Timer Highlight** (`timerHandle`, ~line 18)
   - Pulse effect on game start event
   - Flash effect on game end event
   - Color transition animation

6. **Disc Possession Indicator**
   - Smooth border slide animation
   - Highlight effect when possession changes
   - Duration: 400ms

**Implementation Pattern**:
```javascript
// Replace current score() function with timeline
function score(team, assist, scorer) {
    const timeline = ScoreboardAnimations.utils.createTimeline();

    timeline
        .add(ScoreboardAnimations.celebration.pulseScale(team.score_handle))
        .add(ScoreboardAnimations.counter.animateNumber(team.score_handle, oldScore, newScore))
        .add(ScoreboardAnimations.entrance.slideInLeft(scorerHandle, 0), '-=800')
        .add(ScoreboardAnimations.entrance.slideInBottom(assistHandle, 0), '+=1000')
        .add(ScoreboardAnimations.exit.slideOutBottom(assistHandle, 0), '+=8000')
        .add(ScoreboardAnimations.exit.slideOutLeft(scorerHandle, 0), '+=0');

    timeline.play();
}
```

**Modified Functions** in `scoreboard.js`:
- `score()` - Full timeline replacement
- `parseEvent()` - Add animation triggers for events
- `setTimer()` - Add timer pulse animations
- `toggleDiscPossession()` - Add border slide

**Testing**:
- Score updates via WebSocket trigger correctly
- Animations don't conflict with rapid events
- Timings match broadcast standards (4-10 second sequences)
- Performance: 60fps during animations

---

### Phase 3: Overlay Animations (Week 3)

**Goal**: Enhance roster, stats, wind, and player_stats overlays with coordinated entrance/exit sequences

**Files to Modify**:
- `scores_html/static/js/scoreboard.js` (overlay toggle functions)
- `scores_html/static/css/scoreboard.css` (remove opacity transitions, add animation classes)

**Animations to Implement**:

1. **Roster Overlay** (`toggleRoster()`, ~line 350)
   - Entrance:
     - Backdrop fade in (0 → 1, 200ms)
     - Panel scale up (0.9 → 1.0, 300ms) + fade in
     - Title bar slide from top (300ms)
     - Player rows stagger in (50ms delay per row)
   - Exit:
     - Reverse sequence (faster: 200ms total)

2. **Stats Overlay** (`toggleStats()`, ~line 380)
   - Entrance:
     - Similar to roster
     - Stats bars animate width from 0% → target% (800ms)
     - Numbers count up during bar animation
     - Stagger bars (100ms delay each)
   - Exit:
     - Quick fade out (200ms)

3. **Player Stats Overlay** (`togglePlayerStats()`)
   - Lower-thirds style entrance:
     - Wipe in from left (400ms)
     - Player names slide with gradient reveal
     - Stats counter animation
   - Exit:
     - Wipe out to left (300ms)

4. **Wind Overlay** (`toggleWind()`)
   - Entrance:
     - Slide from top-right corner
     - Scale + fade
   - Wind arrow rotation:
     - Replace jQuery .animate() with Anime.js
     - Smooth rotation with easeOutExpo (300ms)

**Implementation Pattern**:
```javascript
function toggleRoster(toggle) {
    if (toggle) {
        rosterHandle.css('display', 'grid');

        const elements = [
            rosterHandle.find('.roster__name'),
            rosterHandle.find('.roster-table tr')
        ];

        const timeline = ScoreboardAnimations.sequences.overlayShowSequence(elements);
        timeline.play();
    } else {
        const timeline = ScoreboardAnimations.sequences.overlayHideSequence([rosterHandle]);
        timeline.finished.then(() => {
            rosterHandle.css('display', 'none');
        });
        timeline.play();
    }
}
```

**Stats Bar Animation**:
```javascript
function statsUpdate(stats_data) {
    Object.entries(stats_data).forEach((stat, index) => {
        const delay = ScoreboardAnimations.utils.staggerDelay(index, 100);

        // Animate bar width
        anime({
            targets: stat.barElement,
            width: [`0%`, `${stat.percentage}%`],
            duration: 800,
            delay: delay,
            easing: 'easeOutExpo'
        });

        // Animate number count
        ScoreboardAnimations.counter.animateNumber(
            stat.numberElement,
            0,
            stat.value,
            800
        );
    });
}
```

**Testing**:
- Toggle events work smoothly
- Overlays don't conflict with scoreboard animations
- Stagger timing feels natural (not too fast/slow)
- Performance with 20+ list items maintained

---

### Phase 4: Field Scoreboard & Matches (Week 4)

**Goal**: Animate large-format stadium display and match list views

#### 4.1 Field Scoreboard

**File**: `scores_html/static/js/field_scoreboard.js`

**Animations**:
1. **Score Number Count-Up**
   - Animate from old score → new score
   - Large text requires smooth animation
   - Duration: 1000ms (slower for visibility)
   - Easing: easeOutCubic

2. **Score Celebration**
   - Large scale bounce (1.0 → 1.15 → 1.0)
   - More pronounced than broadcast version
   - Visible from 50+ meters

3. **Timer Pulse** (final minute)
   - Red flash every 10 seconds in final minute
   - Pulse effect on countdown

4. **Team Name Transition**
   - Slide in when new game starts
   - Cross-fade between games

**Considerations**:
- Larger animations for stadium visibility
- Simplified effects (no complex overlays)
- Performance on large displays (4K)
- Maintain 10ms timer update interval

#### 4.2 Matches List

**File**: `scores_html/templates/matches.html` (inline script or new JS file)

**Animation**:
- Staggered card entrance on page load
- Each match card slides in from bottom
- Delay: 100ms per card
- Duration: 600ms
- Easing: easeOutExpo

**Implementation**:
```javascript
document.addEventListener('DOMContentLoaded', () => {
    const matchCards = document.querySelectorAll('.match_data');

    anime({
        targets: matchCards,
        translateY: [50, 0],
        opacity: [0, 1],
        delay: anime.stagger(100),
        duration: 600,
        easing: 'easeOutExpo'
    });
});
```

---

### Phase 5: Performance Optimization & Polish (Week 5-6)

**Goal**: Ensure smooth 60fps performance and professional polish

**Tasks**:

1. **Performance Profiling**
   - Use Chrome DevTools Performance tab
   - Identify animation bottlenecks
   - Monitor FPS during complex sequences
   - Test on target hardware (broadcast systems)

2. **Optimize Animation Queue**
   - Cancel interrupted animations gracefully
   - Implement priority system (score > stats > roster)
   - Debounce rapid WebSocket events (100ms window)

3. **GPU Acceleration**
   - Ensure all animations use CSS transforms (not layout properties)
   - Add `will-change` hints to frequently animated elements
   - Remove `will-change` when animation completes (performance)

4. **Batch DOM Operations**
   - Group multiple element animations in single anime() call
   - Reduce reflows/repaints

5. **Custom Easing Library**
   - File: `scores_html/static/js/easing-presets.js` (NEW)
   - Define broadcast-specific timing functions:
     - `scoreImpact`: Sharp overshoot for score updates
     - `smoothSlide`: Professional slide timing
     - `snapIn`: Quick snap for small elements
     - `elasticBounce`: Celebration effects

6. **Animation Timing Standards**
   - Document standard durations (150ms, 300ms, 600ms, 900ms, 1200ms)
   - Document standard stagger delays (50ms, 100ms, 150ms)
   - Ensure consistency across all views

7. **Fallback System**
   - Detect if Anime.js fails to load
   - Fall back to CSS animations
   - Feature detection and graceful degradation

8. **Testing**
   - Performance: 60fps target during all animations
   - Latency: <100ms from WebSocket event to animation start
   - Stress test: Rapid score updates (multiple per second)
   - Network: Test with slow WebSocket (simulate lag)

---

## Critical Files to Modify

### JavaScript Files
1. **scores_html/static/js/scoreboard.js** (612 lines)
   - Most critical file
   - Functions to modify: `score()`, `parseEvent()`, `toggleRoster()`, `toggleStats()`, `toggleWind()`, `statsUpdate()`, `setTimer()`
   - Add animation triggers for all WebSocket events

2. **scores_html/static/js/field_scoreboard.js** (260 lines)
   - Simpler than scoreboard.js but large-format considerations
   - Functions to modify: `parseEvent()`, `updateScore()`, `startTimer()`

3. **scores_html/static/js/controller.js**
   - Minimal changes (only visual feedback animations)

### New JavaScript Files
4. **scores_html/static/js/animations.js** (NEW, ~400 lines)
   - Centralized animation utilities
   - All reusable animation functions

5. **scores_html/static/js/animation-queue.js** (NEW, ~100 lines)
   - Queue management system
   - Conflict prevention

6. **scores_html/static/js/easing-presets.js** (NEW, ~50 lines)
   - Custom easing functions
   - Timing standards

### CSS Files
7. **scores_html/static/css/scoreboard.css** (588 lines)
   - Remove some CSS transitions (migrating to Anime.js)
   - Add GPU hints
   - Keep simple hover effects in CSS

8. **scores_html/static/css/field_scoreboard.css**
   - Add animation helper classes
   - GPU acceleration hints

9. **scores_html/static/css/animations.css** (NEW, ~100 lines)
   - Animation-specific styles
   - Helper classes

### HTML Templates
All 8 templates need script tag additions:
- `scores_html/templates/scoreboard.html`
- `scores_html/templates/field_scoreboard.html`
- `scores_html/templates/controller.html`
- `scores_html/templates/roster.html`
- `scores_html/templates/stats.html`
- `scores_html/templates/player_stats.html`
- `scores_html/templates/wind.html`
- `scores_html/templates/matches.html`

Change:
```html
<!-- Add before existing script tags -->
<script src="../static/js/anime.min.js"></script>
<script src="../static/js/animations.js"></script>
<script src="../static/js/animation-queue.js"></script>
```

---

## Design System Standards

### Animation Timing
```javascript
const TIMING = {
    instant: 150,        // Hover, clicks
    fast: 300,           // Toggle, fade
    normal: 600,         // Overlays, slides
    slow: 900,           // Score celebrations
    extended: 1200,      // Multi-step sequences
    scoreSequence: 9000, // Full score announcement
};
```

### Easing Presets
```javascript
const EASING = {
    slideIn: 'easeOutExpo',      // Smooth deceleration
    bounceIn: 'easeOutElastic',  // Playful overshoot
    slideOut: 'easeInExpo',      // Smooth acceleration
    celebration: 'easeOutBack',  // Overshoot then settle
    counter: 'easeOutCubic'      // Smooth count-up
};
```

### Stagger Delays
```javascript
const STAGGER = {
    list: 50,          // List items (ms per item)
    statsBar: 100,     // Stat bars cascade
    cards: 150,        // Match cards entrance
    grid: 80           // Grid layouts
};
```

---

## Performance Targets

- **60 FPS** during all animations (16.67ms per frame)
- **<100ms** animation start latency from WebSocket event
- **<5% CPU** overhead during animations
- **No dropped frames** on 1080p/4K displays
- **Memory stable** during long-running sessions (no leaks)

---

## Risk Mitigation

### Challenge 1: Animation Conflicts
**Risk**: Rapid WebSocket events trigger overlapping animations
**Solution**: AnimationQueue system with priority and cancellation

### Challenge 2: Performance on 4K Displays
**Risk**: Stadium field_scoreboard may lag with complex animations
**Solution**: Simplified animations for large displays, hardware detection

### Challenge 3: WebSocket Lag
**Risk**: Network delay causes animation timing desync
**Solution**: Start animations immediately on event receipt, timestamp compensation

### Challenge 4: Browser Compatibility
**Risk**: Older broadcast system browsers
**Solution**: Anime.js supports IE10+, CSS fallbacks for critical features

---

## Verification Plan

### Development Testing

1. **Unit Tests** (optional but recommended)
   - Test animation utility functions
   - Test timeline creation
   - Test queue management

2. **Manual Testing Checklist**
   - [ ] Score update animation triggers on WebSocket event
   - [ ] Scorer/assist banners slide in with correct timing
   - [ ] Score celebration effect visible and smooth
   - [ ] Roster overlay shows with staggered list animation
   - [ ] Stats bars animate from 0% to target width
   - [ ] Stats numbers count up smoothly
   - [ ] Wind arrow rotates smoothly
   - [ ] Player stats overlay wipes in/out
   - [ ] Field scoreboard score counts up (large format)
   - [ ] Matches list staggers in on page load
   - [ ] Timer pulse works on game start/end
   - [ ] Disc possession indicator animates
   - [ ] Rapid score updates don't conflict
   - [ ] Multiple overlays don't interfere with each other
   - [ ] Animations maintain 60fps
   - [ ] No visual glitches or flickering

3. **Performance Testing**
   - Open Chrome DevTools → Performance tab
   - Record during complex animation sequence
   - Verify FPS stays above 55fps (consistent)
   - Check for long tasks (>50ms)
   - Monitor memory for leaks

4. **Cross-Browser Testing**
   - Chrome (primary)
   - Firefox
   - Safari (if applicable)
   - Edge

5. **Stress Testing**
   - Simulate rapid WebSocket events (5+ per second)
   - Toggle multiple overlays rapidly
   - Run for extended period (30+ minutes)
   - Monitor CPU and memory usage

### End-to-End Verification

**Test Scenario 1: Live Game Simulation**
1. Start WebSocket connection to scoreboard
2. Send score event via controller
3. Verify score counts up with celebration effect
4. Verify scorer/assist banners slide in and out
5. Check timing: 9-second sequence completes correctly

**Test Scenario 2: Overlay Cycling**
1. Toggle roster on → verify entrance animation
2. Wait 5 seconds
3. Toggle roster off → verify exit animation
4. Toggle stats on → verify entrance with staggered bars
5. Verify no conflicts or visual glitches

**Test Scenario 3: Field Scoreboard**
1. Display field_scoreboard.html on large screen (TV/projector)
2. Send score update
3. Verify number count-up visible from 10+ meters
4. Verify celebration effect pronounced enough
5. Check timer countdown stays smooth (10ms intervals)

**Test Scenario 4: Matches List**
1. Load matches.html or matches_all.html
2. Verify cards stagger in on page load
3. Check spacing of stagger (100ms feels natural)
4. Verify no layout shift during animation

### Acceptance Criteria

- ✅ All animations trigger correctly from WebSocket events
- ✅ Animations feel smooth and professional (broadcast quality)
- ✅ No animation conflicts or visual glitches
- ✅ Performance maintains 60fps on target hardware
- ✅ Timing matches sports broadcast standards
- ✅ Large displays (field scoreboard) remain visible and smooth
- ✅ Existing functionality unchanged (WebSocket, timer, overlays)
- ✅ All 8 views load and animate correctly
- ✅ Code is maintainable (centralized utilities, clear structure)

---

## Migration Strategy

### Rollout Approach
1. **Feature Flag** (optional): Add `USE_ANIME_ANIMATIONS = true` flag in config
2. **Incremental Migration**: Phase by phase, test thoroughly between phases
3. **Backup CSS**: Keep original CSS animations intact initially
4. **Parallel Testing**: Run old and new systems side-by-side

### Rollback Plan
- If critical issues found, set feature flag to false
- Original CSS transitions remain functional
- Anime.js script tags can be commented out
- No data model changes, only presentation layer

---

## Additional Considerations

### Should We Use Context7?
Context7 plugin was installed by the user for enhanced code analysis. It has been used implicitly during the exploration phase to understand the codebase structure. No specific action needed - the exploration already benefited from enhanced context capabilities.

### Should We Add More Libraries?
**No.** Anime.js + existing jQuery is sufficient for all identified requirements:
- Anime.js: Professional animations (timelines, stagger, easing)
- jQuery: DOM manipulation and WebSocket handling (already integrated)
- EasyTimer.js: Timer functionality (works well)

**Do NOT add:**
- GSAP (overkill, licensing)
- Framer Motion (requires React)
- Lottie (for pre-made animations, not needed here)
- Three.js (no 3D requirements)

### Should We Add SASS/SCSS?
**No.** Current CSS with custom properties works well. Adding SASS:
- Requires build process (complexity)
- Minimal benefit for this project
- CSS custom properties handle theming adequately

Keep it simple: Pure CSS + Anime.js for animations.

---

## Summary

**What We're Doing:**
- Activating Anime.js (already present, 17KB)
- Creating centralized animation utilities
- Migrating from basic CSS transitions to professional sports TV animations
- Adding celebration effects, coordinated sequences, and smooth transitions
- Improving all 8 views incrementally over 5-6 weeks

**What We're NOT Doing:**
- Adding frameworks (React/Vue)
- Adding build process
- Adding GSAP or other heavy libraries
- Changing data model or WebSocket architecture
- Changing deployment or Docker setup

**Expected Outcome:**
Professional sports television broadcast quality animations with smooth score celebrations, coordinated overlay sequences, staggered lists, animated stats bars, and lower-thirds style graphics - all while maintaining 60fps performance and existing WebSocket-driven functionality.
