/*
 * mma-visibility-guard.js
 *
 * Self-healing visibility guard for ManiaMapAnalyser.
 *
 * THE PROBLEM
 * -----------
 * The analyser's card sometimes sticks on a stale visibility: during a map it
 * stays visible (or, outside a map, stays hidden) until the page is reloaded.
 * The card's own state is correct - it does carry .card-hidden-by-play and the
 * stylesheet resolves that to opacity 0 - yet the screen keeps showing the old
 * frame. That is a stale compositing layer, not a logic error, which is why the
 * analyser's own code cannot recover from it.
 *
 * WHAT THIS DOES
 * --------------
 * Every 250ms:
 *   1. reads the game state from tosu's /websocket/v2
 *   2. reads Card Visibility from tosu's settings API (handles both the plugin
 *      folder and the in-game overlay's shared __ingame__ folder)
 *   3. compares that with what the card element is actually doing
 *   4. on a mismatch it re-asserts the class AND forces a repaint
 *   5. on a visibility transition it forces a repaint even when the class was
 *      already right - that is the stale-frame case
 *
 * The repaint is a 1ms no-op animation restart. It changes nothing visually and
 * only runs on a transition, so a healthy session pays almost nothing.
 *
 * CONFIGURATION (all optional, read from window.MMA_GUARD)
 * ------------------------------------------------------
 *   folder       plugin folder name           default 'ManiaMapAnalyser.by.Leo_Black'
 *   overlayFolder shared overlay settings     default '__ingame__'
 *   switchFolder folder holding the on/off switch, default 'keyviewer_awa'
 *   switchKey    setting name for that switch, default 'fixAnalyserOnStateChange'
 *   intervalMs   polling interval             default 250
 *   quiet        true = never draw anything   default true
 *
 * Nothing is drawn unless you set window.MMA_GUARD = { quiet: false }, which
 * adds a small status badge in the top-left - useful while diagnosing.
 */
(function () {
    'use strict';

    var CFG = window.MMA_GUARD || {};
    var FOLDER = CFG.folder || 'ManiaMapAnalyser.by.Leo_Black';
    var OVERLAY_FOLDER = CFG.overlayFolder || '__ingame__';
    var SWITCH_FOLDER = CFG.switchFolder || 'keyviewer_awa';
    var SWITCH_KEY = CFG.switchKey || 'fixAnalyserOnStateChange';
    var INTERVAL = CFG.intervalMs || 250;
    var QUIET = CFG.quiet === false ? false : true;
    var SWITCH_POLL_MS = 15000;
    var MODE_POLL_MS = 30000;

    var mode = 'OutsidePlay';
    var modeSource = '(not read yet)';
    var playing = false;
    var stateName = '';
    var inMenu = false;
    var enabled = true;
    var fixes = 0;
    var reasserts = 0;
    var socketState = 'connecting';
    var lastMessageAt = 0;
    var lastWant = null;
    var lastActual = null;
    var lastChangeAt = 0;
    var previousWant = null;

    /* ---------------------------------------------------------------- *
     * invisible repaint nudge
     * ---------------------------------------------------------------- */

    var style = document.createElement('style');
    style.textContent =
        '@keyframes mmaGuardNudge{from{opacity:1}to{opacity:1}}' +
        '.mma-guard-nudge{animation:mmaGuardNudge 1ms linear}';
    (function mountStyle() {
        if (document.head) document.head.appendChild(style);
        else setTimeout(mountStyle, 50);
    })();

    /* Restart a no-op animation so the browser rebuilds the card's frame
       without changing how anything looks. */
    function repaint(el) {
        el.classList.remove('mma-guard-nudge');
        /* read a layout property so the removal lands before the re-add */
        void el.offsetWidth;
        el.classList.add('mma-guard-nudge');
    }

    /* ---------------------------------------------------------------- *
     * optional status badge (only with quiet:false)
     * ---------------------------------------------------------------- */

    var badge = null;
    if (!QUIET) {
        badge = document.createElement('div');
        badge.style.cssText =
            'position:fixed;left:0;top:0;z-index:2147483647;background:#000;color:#0ff;' +
            'font:12px/1.4 monospace;padding:3px 6px;white-space:pre;pointer-events:none';
        (function mountBadge() {
            if (document.body) document.body.appendChild(badge);
            else setTimeout(mountBadge, 50);
        })();
    }

    function drawBadge(want, actual) {
        if (!badge) return;
        var age = lastMessageAt
            ? ((Date.now() - lastMessageAt) / 1000).toFixed(1) + 's'
            : 'never';
        badge.textContent =
            'guard ' + (enabled ? 'ON ' : 'OFF') +
            '  mode=' + mode + ' (' + modeSource + ')' +
            '  playing=' + playing +
            '\nws=' + socketState + ' last msg ' + age +
            '  card hidden=' + actual + '  want=' + want +
            '  fixes=' + fixes;
        badge.style.color = actual !== null && actual !== want ? '#ff5555' : '#0ff';
    }

    /* ---------------------------------------------------------------- *
     * game state, straight from tosu
     * ---------------------------------------------------------------- */

    function watchState() {
        var ws;
        try {
            var host = location.host || '127.0.0.1:24050';
            ws = new WebSocket('ws://' + host + '/websocket/v2?l=mma-visibility-guard');
        } catch (error) {
            socketState = 'ctor failed: ' + error.message;
            setTimeout(watchState, 3000);
            return;
        }

        ws.onopen = function () {
            socketState = 'open';
        };

        ws.onmessage = function (event) {
            lastMessageAt = Date.now();
            var data;
            try {
                data = JSON.parse(String(event.data));
            } catch (error) {
                return;
            }
            if (!data || !data.state || data.state.name === undefined) return;
            var name = String(data.state.name)
                .trim()
                .toLowerCase()
                .replace(/[^a-z]/g, '');
            stateName = name;
            playing = name === 'play' || name === 'gameplay';
            inMenu = name === 'menu';
        };

        ws.onclose = function () {
            socketState = 'closed';
            setTimeout(watchState, 1500);
        };

        ws.onerror = function () {
            socketState = 'error';
        };
    }

    /* ---------------------------------------------------------------- *
     * settings: the on/off switch and Card Visibility
     * ---------------------------------------------------------------- */

    function readSetting(folder, key) {
        return fetch('/api/counters/settings/' + folder, { cache: 'no-store' })
            .then(function (response) {
                return response.json();
            })
            .then(function (payload) {
                if (!payload || !payload.values) return null;
                var value = payload.values[key];
                return value === undefined || value === null ? null : value;
            })
            .catch(function () {
                return null;
            });
    }

    function loadEnabled() {
        readSetting(SWITCH_FOLDER, SWITCH_KEY).then(function (value) {
            /* missing key viewer, or the setting absent -> stay enabled */
            enabled = value !== false;
        });
    }

    function loadMode() {
        readSetting(FOLDER, 'cardVisibility').then(function (value) {
            if (value) {
                mode = String(value);
                modeSource = FOLDER;
                return;
            }
            /* inside tosu's in-game overlay the value lives in the shared folder */
            return readSetting(OVERLAY_FOLDER, 'cardVisibility').then(function (shared) {
                if (shared) {
                    mode = String(shared);
                    modeSource = OVERLAY_FOLDER;
                }
            });
        });
    }

    /* ---------------------------------------------------------------- *
     * the guard loop
     * ---------------------------------------------------------------- */

    function cardElement() {
        return (
            document.querySelector('.main-card') || document.querySelector('main.dashboard')
        );
    }

    function tick() {
        if (!enabled) {
            drawBadge(lastWant, lastActual);
            return;
        }

        var el = cardElement();
        if (!el) {
            drawBadge(lastWant, lastActual);
            return;
        }

        /* The analyser's own rule, from its hud.js:
         *
         *   // Always hide the card when on the menu screen.
         *   if (state.clientStateName === "menu") {
         *       card.classList.toggle("card-hidden-by-play", true);
         *       return;                      // <- ignores cardVisibility
         *   }
         *
         * The menu therefore forces HIDDEN no matter what Card Visibility says.
         * The guard has to mirror that. Missing it made the guard fight the
         * analyser in the menus: it kept "correcting" the card back to visible,
         * the analyser kept hiding it, and the card flickered.
         *
         * Otherwise:
         *   Always        -> never hidden
         *   DuringPlay    -> hidden when NOT playing
         *   anything else -> hidden while playing (OutsidePlay) */
        var want = inMenu
            ? true
            : mode === 'Always'
              ? false
              : mode === 'DuringPlay'
                ? !playing
                : playing;

        var actual =
            el.classList.contains('card-hidden-by-play') ||
            el.getAttribute('aria-hidden') === 'true';

        lastWant = want;
        lastActual = actual;

        if (actual !== want) {
            /* wrong class state: fix it and rebuild the frame */
            el.classList.toggle('card-hidden-by-play', want);
            el.setAttribute('aria-hidden', want ? 'true' : 'false');
            repaint(el);
            fixes++;
            lastChangeAt = Date.now();
        } else if (previousWant !== null && want !== previousWant) {
            /* The class is already right, but this is exactly where a stale frame
               shows up. Re-assert the same state and force a repaint. This counts
               as a re-assert, NOT a correction, so a healthy session can be told
               apart from one that is fighting the analyser. */
            el.classList.toggle('card-hidden-by-play', want);
            el.setAttribute('aria-hidden', want ? 'true' : 'false');
            repaint(el);
            reasserts++;
            lastChangeAt = Date.now();
        }
        previousWant = want;

        drawBadge(want, actual);
    }

    /* ---------------------------------------------------------------- *
     * start
     * ---------------------------------------------------------------- */

    watchState();
    loadEnabled();
    loadMode();
    setInterval(loadEnabled, SWITCH_POLL_MS);
    setInterval(loadMode, MODE_POLL_MS);
    setInterval(tick, INTERVAL);

    /* programmatic status - nothing needs to be read off the screen */
    window.__mmaGuard = {
        get installed() {
            return true;
        },
        get mode() {
            return mode;
        },
        get modeSource() {
            return modeSource;
        },
        get playing() {
            return playing;
        },
        get stateName() {
            return stateName;
        },
        get inMenu() {
            return inMenu;
        },
        get enabled() {
            return enabled;
        },
        get fixes() {
            return fixes;
        },
        get reasserts() {
            return reasserts;
        },
        get socketState() {
            return socketState;
        },
        get lastMessageAgeMs() {
            return lastMessageAt ? Date.now() - lastMessageAt : null;
        },
        get lastWant() {
            return lastWant;
        },
        get lastActual() {
            return lastActual;
        },
        get lastChangeAt() {
            return lastChangeAt || null;
        },
        /* a readable snapshot, since getters print as functions in a console */
        snapshot: function () {
            return {
                installed: true,
                mode: mode,
                modeSource: modeSource,
                stateName: stateName,
                playing: playing,
                inMenu: inMenu,
                enabled: enabled,
                fixes: fixes,
                reasserts: reasserts,
                socketState: socketState,
                lastMessageAgeMs: lastMessageAt ? Date.now() - lastMessageAt : null,
                lastWant: lastWant,
                lastActual: lastActual,
                lastChangeAt: lastChangeAt || null
            };
        }
    };
})();
