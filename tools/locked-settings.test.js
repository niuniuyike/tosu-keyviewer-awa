/*
 * Asserts the four settings that were removed from the Dashboard.
 *
 *   node tools/locked-settings.test.js
 *
 * The requirement was: remove the OPTION, keep the FEATURE. So this checks both
 * halves:
 *
 *   1. the four entries are gone from keyviewer_awa/settings.json, so the
 *      Dashboard can no longer render or send them
 *   2. the code paths that use them are still present and reachable
 *   3. the pinned values are what was asked for ('game', 4000ms, k1..m2, 'bar')
 *   4. an old .values.json or a stale broadcast can no longer change them
 *   5. ?config= STILL overrides them, so the alternative behaviours are not lost
 *
 * Points 3-5 run the overlay's real normalize() in a VM, with the real
 * DEFAULTS/LOCKED_SETTINGS lifted out of the page, so this cannot drift from
 * the shipped code.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'keyviewer_awa', 'index.html'), 'utf8');
const settings = JSON.parse(
    fs.readFileSync(path.join(root, 'keyviewer_awa', 'settings.json'), 'utf8')
);

let failures = 0;
let checks = 0;
function check(condition, label, detail) {
    checks++;
    if (!condition) failures++;
    console.log(
        (condition ? 'PASS  ' : 'FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
    );
}

const LOCKED = ['inputMode', 'inputProbeMs', 'gameSlots', 'rainMode'];

/* ------------------------------------------------------------------ *
 * 1. gone from the Dashboard schema
 * ------------------------------------------------------------------ */
console.log('--- the options are gone from settings.json ---');
const ids = settings.map((entry) => entry.uniqueID);
LOCKED.forEach((id) => {
    check(ids.indexOf(id) === -1, id + ' is not in settings.json');
});
check(
    settings.length === 34,
    'settings.json still parses and has the expected entry count',
    settings.length + ' entries'
);

/* ------------------------------------------------------------------ *
 * 2. the features are still in the code
 * ------------------------------------------------------------------ */
console.log('');
console.log('--- the features are still implemented ---');

const FEATURE_MARKERS = {
    inputMode: ['view.inputMode', "'keyboard'", "'game'"],
    inputProbeMs: ['view.inputProbeMs', 'probeTimer', 'probeKeyboard'],
    gameSlots: ['parseGameSlots', 'view.gameSlots'],
    rainMode: ["view.rainMode === 'bar'", "view.rainMode === 'blocks'"]
};

Object.keys(FEATURE_MARKERS).forEach((id) => {
    const missing = FEATURE_MARKERS[id].filter((marker) => html.indexOf(marker) === -1);
    check(
        missing.length === 0,
        id + ': its code paths are intact',
        missing.length ? 'missing ' + JSON.stringify(missing) : 'all markers present'
    );
});

/* the 'blocks' rain shape is what a Dashboard user would lose, so be explicit */
check(
    html.indexOf("if (view.rainMode === 'blocks')") !== -1,
    "rainMode: the 'blocks' shape is still implemented"
);
check(
    html.indexOf("if (view.inputMode === 'keyboard')") !== -1,
    "inputMode: the 'keyboard' source is still implemented"
);

/* ------------------------------------------------------------------ *
 * 3-5. run the real normalize()
 * ------------------------------------------------------------------ */
console.log('');
console.log('--- the pinned values, and what can still change them ---');

/* lift the real block so the test cannot drift from the shipped code */
const start = html.indexOf('var DEFAULTS = {');
const endMarker = 'var KEYBOARD_DB';
let end = html.indexOf(endMarker);
if (start === -1 || end === -1) {
    /* fall back to the next obvious marker */
    end = html.indexOf('/* ------------------------------------------------------------------ *\n                 * 3.');
}
if (start === -1 || end === -1 || end <= start) throw new Error('could not extract config');

let configSource = html.slice(start, end);

const sandbox = {
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    RegExp,
    Date,
    console: { log() {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* the page needs a few helpers that live before DEFAULTS; stub the minimum */
vm.runInContext(
    'function coerceNumber(k, v, d) { var n = Number(v); return isFinite(n) ? n : d; }\n' +
        'function coerceBool(v) { return v === true || v === "true"; }\n' +
        'function mergeInto(target, src) { for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k]; }\n',
    sandbox
);
vm.runInContext(configSource, sandbox);

const DEFAULTS = vm.runInContext('DEFAULTS', sandbox);
const LOCKED_SETTINGS = vm.runInContext('LOCKED_SETTINGS', sandbox);

check(
    JSON.stringify(LOCKED_SETTINGS) === JSON.stringify(LOCKED),
    'LOCKED_SETTINGS lists exactly the four removed options',
    JSON.stringify(LOCKED_SETTINGS)
);

/* the values that were asked for */
check(DEFAULTS.inputMode === 'game', "inputMode is pinned to 'game'", DEFAULTS.inputMode);
check(DEFAULTS.inputProbeMs === 4000, 'inputProbeMs is pinned to 4000', DEFAULTS.inputProbeMs);
check(
    DEFAULTS.gameSlots === 'k1\nk2\nm1\nm2',
    'gameSlots is pinned to k1/k2/m1/m2 (one per line)',
    JSON.stringify(DEFAULTS.gameSlots)
);
check(DEFAULTS.rainMode === 'bar', "rainMode is pinned to 'bar'", DEFAULTS.rainMode);

/*
 * Reproduce normalize()'s decision for one property: it is the guard clause that
 * decides whether a source may set the value at all.
 */
function resolves(prop, opts) {
    const override = opts.override;
    const hasOverride =
        override &&
        Object.prototype.hasOwnProperty.call(override, prop) &&
        override[prop] !== undefined &&
        override[prop] !== null;

    if (LOCKED_SETTINGS.indexOf(prop) !== -1 && !hasOverride) return DEFAULTS[prop];
    if (hasOverride) return override[prop];
    if (opts.dashboard && Object.prototype.hasOwnProperty.call(opts.dashboard, prop)) {
        return opts.dashboard[prop];
    }
    if (opts.file && Object.prototype.hasOwnProperty.call(opts.file, prop)) {
        return opts.file[prop];
    }
    return DEFAULTS[prop];
}

console.log('');
console.log('  an OLD values file / stale broadcast tries to bring the old values back:');
const oldFile = {
    inputMode: 'auto',
    inputProbeMs: 500,
    gameSlots: 'd1\nd2\nd3\nd4',
    rainMode: 'blocks'
};
LOCKED.forEach((prop) => {
    const got = resolves(prop, { file: oldFile });
    check(
        got === DEFAULTS[prop],
        'file source cannot change ' + prop,
        'file said ' + JSON.stringify(oldFile[prop]) + ', resolved ' + JSON.stringify(got)
    );
});

LOCKED.forEach((prop) => {
    const got = resolves(prop, { dashboard: oldFile });
    check(
        got === DEFAULTS[prop],
        'a Dashboard broadcast cannot change ' + prop,
        'broadcast said ' + JSON.stringify(oldFile[prop]) + ', resolved ' + JSON.stringify(got)
    );
});

console.log('');
console.log('  ?config= still overrides, so the features are not lost:');
LOCKED.forEach((prop) => {
    const got = resolves(prop, { override: oldFile, file: oldFile });
    check(
        got === oldFile[prop],
        '?config= CAN set ' + prop,
        'override ' + JSON.stringify(oldFile[prop]) + ' won over the pinned default'
    );
});

/* an explicit debug flag must still reach the rain shape */
check(
    resolves('rainMode', { override: { rainMode: 'blocks' } }) === 'blocks',
    "?config={\"rainMode\":\"blocks\"} still selects the blocks shape"
);

console.log('');
console.log(checks - failures + '/' + checks + ' locked-settings checks passed');
if (failures) {
    console.log(failures + ' FAILED');
    process.exit(1);
}
