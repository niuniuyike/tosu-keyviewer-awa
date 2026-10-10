/*
 * Contract tests: keyviewer_awa/settings.json must stay compatible with both
 * tosu's counters settings parser and the overlay's own defaults.
 *
 *   node tools/settings.contract.test.js
 *
 * Rules verified against packages/server/utils/parseSettings.ts and
 * packages/server/assets/homepage.js of tosuapp/tosu:
 *   - uniqueID survives .replace(/[^a-z0-9]/gim, '')
 *   - type is one of the types the Dashboard modal can render
 *   - every setting has a value with the right runtime type
 *   - option-like types declare options, and their value is one of them
 *   - header rows carry no value / description requirement
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const DASHBOARD_TYPES = [
    'text',
    'color',
    'number',
    'checkbox',
    'button',
    'options',
    'commands',
    'textarea',
    'password',
    'header'
];

let failures = 0;
let checks = 0;

function ok(value, label) {
    checks++;
    if (!value) {
        failures++;
        console.log(`FAIL ${label}`);
    }
}

function eq(actual, expected, label) {
    checks++;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.log(
            `FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    }
}

const settingsPath = path.join(__dirname, '..', 'keyviewer_awa', 'settings.json');
const raw = fs.readFileSync(settingsPath, 'utf8');
const entries = JSON.parse(raw);

/* ---------- shape ---------- */
ok(Array.isArray(entries), 'settings.json is an array');
ok(entries.length > 0, 'settings.json is not empty');

const seen = {};
for (const entry of entries) {
    const id = entry.uniqueID;
    ok(typeof id === 'string' && id.length > 0, `uniqueID present (${id})`);
    ok(!seen[id], `uniqueID unique (${id})`);
    seen[id] = true;

    const sanitized = String(id).replace(/[^a-z0-9]/gim, '');
    eq(sanitized, id, `uniqueID survives tosu sanitizing (${id})`);

    ok(
        DASHBOARD_TYPES.indexOf(entry.type) !== -1,
        `type is renderable by the Dashboard (${id}: ${entry.type})`
    );
    ok(typeof entry.title === 'string' && entry.title.length > 0, `title present (${id})`);
    ok('description' in entry, `description present (${id})`);
    ok('value' in entry, `value present (${id})`);

    if (entry.type === 'header') {
        continue;
    }

    ok(
        typeof entry.description === 'string' && entry.description.length > 0,
        `non-header rows explain themselves (${id})`
    );

    if (entry.type === 'number') {
        ok(typeof entry.value === 'number', `number default is numeric (${id})`);
        ok(!isNaN(entry.value), `number default is not NaN (${id})`);
    }
    if (entry.type === 'checkbox') {
        ok(typeof entry.value === 'boolean', `checkbox default is boolean (${id})`);
    }
    if (entry.type === 'color') {
        ok(
            typeof entry.value === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.value),
            `color default is a #rrggbb string the <input type=color> accepts (${id})`
        );
    }
    if (entry.type === 'options') {
        ok(Array.isArray(entry.options), `options are declared (${id})`);
        ok(entry.options.length > 0, `options are not empty (${id})`);
        ok(
            entry.options.indexOf(entry.value) !== -1,
            `default value is one of the options (${id}: ${entry.value})`
        );
    }
    if (entry.type === 'text' || entry.type === 'textarea' || entry.type === 'password') {
        ok(typeof entry.value === 'string', `text default is a string (${id})`);
    }
}

/* ---------- default match against the overlay's DEFAULTS ---------- */
const html = fs.readFileSync(
    path.join(__dirname, '..', 'keyviewer_awa', 'index.html'),
    'utf8'
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const windowStub = {
    location: { pathname: '/keyviewer_awa/', search: '' },
    devicePixelRatio: 1,
    innerWidth: 200,
    innerHeight: 400,
    addEventListener() {},
    requestAnimationFrame: () => 0
};
const sandbox = {
    window: windowStub,
    document: {
        readyState: 'complete',
        hidden: false,
        body: { style: {} },
        createElement: () => ({
            style: {},
            children: [],
            appendChild() {},
            addEventListener() {},
            getContext: () => null
        }),
        getElementById: () => null,
        addEventListener() {}
    },
    console,
    fetch: () => Promise.reject(new Error('no fetch')),
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    URLSearchParams,
    JSON,
    Math,
    Date
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'index.html' });

const internals = sandbox.window.__keyviewerInternals;
ok(Boolean(internals), '__keyviewerInternals exported');

const defaults = internals.normalize({});
const overlayDefaults = {};
for (const entry of entries) {
    if (entry.type === 'header') continue;
    overlayDefaults[entry.uniqueID] = entry.value;
}

/* the Dashboard rewrites settings.json through its GUI and stores an ARRAY of
   definitions; reading that file must not silently fall back to DEFAULTS */
const fromArrayFile = internals.normalize(entries);
eq(fromArrayFile.displayText, overlayDefaults.displayText, 'array settings.json -> displayText');
eq(fromArrayFile.squareSize, overlayDefaults.squareSize, 'array settings.json -> squareSize');
eq(
    fromArrayFile.rainFadePosition,
    overlayDefaults.rainFadePosition,
    'array settings.json -> rainFadePosition'
);
eq(fromArrayFile.rainColor, overlayDefaults.rainColor, 'array settings.json -> rainColor');
eq(fromArrayFile.rainFlowSpeed, overlayDefaults.rainFlowSpeed, 'array settings.json -> rainFlowSpeed');
eq(fromArrayFile.debugStatus, overlayDefaults.debugStatus, 'array settings.json -> debugStatus');
/* gameSlots is a LOCKED setting: it is no longer in settings.json, so there is
   nothing to read from the file and the pinned default must win. The assertion
   compares against the pinned value rather than the file's (now absent) entry. */
eq(
    fromArrayFile.gameSlots,
    'k1\nk2\nm1\nm2',
    'array settings.json -> gameSlots falls back to the pinned value'
);
/* and a file that still carries the old value must not win either */
eq(
    internals.normalize({ ...entries, gameSlots: 'd1\nd2\nd3\nd4' }).gameSlots,
    'k1\nk2\nm1\nm2',
    'a stale gameSlots saved in the file cannot override the pinned value'
);

/* the shape tosu sends through 'getSettings' is an object keyed by uniqueID */
const fromValuesFile = internals.normalize({
    squareSize: 72,
    borderColor: '#123456',
    debugStatus: true
});
eq(fromValuesFile.squareSize, 72, 'values.json object -> squareSize');
eq(fromValuesFile.borderColor, '#123456', 'values.json object -> borderColor');
eq(fromValuesFile.debugStatus, true, 'values.json object -> debugStatus');
eq(fromValuesFile.rainFlowSpeed, 400, 'values.json object keeps defaults for absent keys');

/* garbage input must not throw and must not lose the defaults */
eq(defaults.displayText, 'Z\nX\nC\nV', 'default display text');
eq(defaults.gameSlots, 'k1\nk2\nm1\nm2', 'default game slots');
eq(internals.normalize(null).squareSize, 56, 'null -> defaults');
eq(internals.normalize('nope').squareSize, 56, 'string -> defaults');
eq(internals.normalize(42).squareSize, 56, 'number -> defaults');
eq(internals.normalize([null, 1, 'x']).squareSize, 56, 'junk array -> defaults');
eq(internals.normalize([{ uniqueID: 'unknownThing', value: 9 }]).squareSize, 56,
   'unknown setting ids are ignored');

const normalized = internals.normalize(overlayDefaults);
for (const entry of entries) {
    if (entry.type === 'header') continue;
    const id = entry.uniqueID;
    /* resetSettings is a Dashboard-only trigger; the overlay reacts to it through
       the reset token instead of treating it as a visual setting */
    if (id === 'resetSettings') continue;
    ok(
        JSON.stringify(normalized[id]) === JSON.stringify(entry.value),
        `settings.json default for ${id} survives normalization (${JSON.stringify(entry.value)} vs ${JSON.stringify(normalized[id])})`
    );
}

/* Every overlay DEFAULTS key must exist in settings.json, except:
     - the internal values that only shape the optional rain geometry
     - the LOCKED settings, which were deliberately removed from the Dashboard
       while keeping their code paths. Those are asserted separately below so
       that removing one from settings.json without pinning it still fails. */
const INTERNAL_ONLY = ['rainBlockHeight', 'rainBlockWidth', 'rainBarGap'];
const LOCKED = ['inputMode', 'inputProbeMs', 'gameSlots', 'rainMode'];
const internalOnly = [];
for (const key of Object.keys(defaults)) {
    if (key in overlayDefaults) continue;
    if (INTERNAL_ONLY.indexOf(key) !== -1) continue;
    if (LOCKED.indexOf(key) !== -1) continue;
    internalOnly.push(key);
}
eq(internalOnly, [], 'every Dashboard-facing DEFAULTS key exists in settings.json');

/* a locked setting must be absent from the Dashboard AND pinned in LOCKED_SETTINGS,
   so "removed from the UI" can never mean "silently reverts to a file value" */
const lockedInCode = internals.LOCKED_SETTINGS || [];
eq(
    lockedInCode.slice().sort(),
    LOCKED.slice().sort(),
    'LOCKED_SETTINGS lists exactly the settings removed from the Dashboard'
);
for (const key of LOCKED) {
    ok(!(key in overlayDefaults), `${key} is absent from settings.json (no Dashboard option)`);
    ok(
        internals.normalize({ [key]: 'garbage-value' })[key] === defaults[key],
        `${key} resolves to its pinned default whatever the input`
    );
}
ok(Object.keys(defaults).length > 0, 'DEFAULTS is populated');

/* ---------- live handshake, when the preview server happens to be running ---------- */
const port = process.env.PREVIEW_PORT || 24112;

function post(pathname, body) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path: pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            },
            (res) => {
                let text = '';
                res.on('data', (chunk) => (text += chunk));
                res.on('end', () => resolve({ status: res.statusCode, text }));
            }
        );
        req.on('error', (error) => resolve({ error: error.message }));
        req.end(payload);
    });
}

(async () => {
    console.log(`${checks - failures}/${checks} contract checks passed`);
    console.log(`settings entries: ${entries.length}`);
    if (failures) {
        console.log(`${failures} FAILED`);
        process.exit(1);
    }
    console.log('settings.json contract is compatible with tosu');
})();
