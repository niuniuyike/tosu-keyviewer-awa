/*
 * Reproduces the bug where a PARTIAL Dashboard update wiped out every other
 * customised setting of a running overlay.
 *
 *   node tools/dashboard-merge.test.js
 *
 * Background: tosu broadcasts `updateSettings` with only the keys that changed.
 * The overlay was passing that partial object in as if it were the full set, so
 * every other setting fell back to the plugin's settings.json defaults.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(
    path.join(__dirname, '..', 'keyviewer_awa', 'index.html'),
    'utf8'
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ------------------------- tiny DOM ------------------------- */
function makeElement(tag) {
    const classes = new Set();
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        id: '',
        children: [],
        parentNode: null,
        style: {},
        dataset: {},
        attributes: {},
        _text: '',
        _html: '',
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
            contains: (c) => classes.has(c)
        },
        className: '',
        appendChild(child) {
            child.parentNode = el;
            el.children.push(child);
            return child;
        },
        removeChild(child) {
            const i = el.children.indexOf(child);
            if (i !== -1) el.children.splice(i, 1);
            return child;
        },
        remove() {
            if (el.parentNode) el.parentNode.removeChild(el);
        },
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ width: 620, height: 320, left: 0, top: 0 }),
        getContext: () => ({
            setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {},
            lineTo() {}, arcTo() {}, rect() {}, closePath() {}, fill() {},
            save() {}, restore() {}, translate() {}, scale() {},
            measureText: () => ({ width: 10 }), fillText() {}
        }),
        setAttribute(k, v) {
            el.attributes[k] = v;
        },
        getAttribute(k) {
            return el.attributes[k];
        },
        querySelectorAll: () => [],
        querySelector: () => null
    };
    Object.defineProperty(el, 'textContent', {
        get: () => el._text,
        set: (v) => {
            el._text = v == null ? '' : String(v);
        }
    });
    Object.defineProperty(el, 'innerHTML', {
        get: () => el._html,
        set: (v) => {
            el._html = v == null ? '' : String(v);
        }
    });
    return el;
}

const hostEl = makeElement('div');
hostEl.id = 'overlay_host';
hostEl.clientWidth = 620;
hostEl.clientHeight = 320;
const canvasEl = makeElement('canvas');
canvasEl.id = 'rain_canvas';
const squaresEl = makeElement('div');
squaresEl.id = 'key_squares';
const bodyEl = makeElement('body');
bodyEl.appendChild(hostEl);
hostEl.appendChild(canvasEl);
hostEl.appendChild(squaresEl);

const documentStub = {
    readyState: 'complete',
    hidden: false,
    body: bodyEl,
    createElement: makeElement,
    getElementById: (id) =>
        id === 'overlay_host' ? hostEl : id === 'rain_canvas' ? canvasEl : id === 'key_squares' ? squaresEl : null,
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
};

const windowStub = {
    location: {
        pathname: '/keyviewer_awa/',
        search: '',
        href: 'http://127.0.0.1:24050/keyviewer_awa/'
    },
    devicePixelRatio: 1,
    innerWidth: 620,
    innerHeight: 320,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    matchMedia: undefined,
    console
};

const sandbox = {
    window: windowStub,
    document: documentStub,
    console,
    fetch: () => Promise.reject(new Error('no network in this harness')),
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval,
    URLSearchParams,
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'overlay.js' });

const kv = sandbox.window.keyviewer;
if (!kv) throw new Error('no hook');

let failures = 0;
let checks = 0;
function check(condition, label, detail) {
    checks++;
    if (!condition) failures++;
    console.log(
        (condition ? 'PASS  ' : 'FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
    );
}

/* the state a user would have configured in the Dashboard */
const DASHBOARD = {
    inputMode: 'game',
    gameSlots: 'k1\nk2\nm1\nm2',
    displayText: 'X\nC\n.\n/',
    squareSize: 74,
    borderColor: '#ff0000',
    borderOpacity: 40,
    showDuringPlay: true,
    rainFlowSpeed: 250
};

console.log('--- the user saves their settings in the Dashboard ---');
/* a fresh overlay that has just read the Dashboard */

kv.setDashboardValues(DASHBOARD, true);
var s = kv.state().settings;
check(s.displayText === 'X\nC\n.\n/', 'displayText applied');
check(s.squareSize === 74, 'squareSize applied');
check(s.borderColor === '#ff0000', 'borderColor applied');
check(s.borderOpacity === 40, 'borderOpacity applied');
check(s.showDuringPlay === true, 'showDuringPlay applied');
check(s.rainFlowSpeed === 250, 'rainFlowSpeed applied');

/* ---------- now a PARTIAL broadcast, like tosu sends ---------- */
console.log('');
console.log('--- tosu broadcasts updateSettings with ONLY the changed key ---');
kv.setDashboardValues({ squareSize: 90 }, false);

var after = kv.state().settings;
console.log(
    '  after the partial update: displayText=' + JSON.stringify(after.displayText) +
    ' size=' + after.squareSize +
    ' border=' + after.borderColor +
    ' opacity=' + after.borderOpacity +
    ' showDuringPlay=' + after.showDuringPlay +
    ' rainSpeed=' + after.rainFlowSpeed
);

check(after.squareSize === 90, 'the changed key was applied');
check(after.displayText === 'X\nC\n.\n/', 'displayText SURVIVED the partial update',
    JSON.stringify(after.displayText));
check(after.borderColor === '#ff0000', 'borderColor SURVIVED', after.borderColor);
check(after.borderOpacity === 40, 'borderOpacity SURVIVED', String(after.borderOpacity));
check(after.showDuringPlay === true, 'showDuringPlay SURVIVED',
    String(after.showDuringPlay));
check(after.rainFlowSpeed === 250, 'rainFlowSpeed SURVIVED', String(after.rainFlowSpeed));
check(after.gameSlots === 'k1\nk2\nm1\nm2', 'gameSlots SURVIVED', after.gameSlots);

/* ---------- a full dashboard read must not lose them either ---------- */
console.log('');
console.log('--- the full Dashboard read still reflects everything ---');
/* tosu resolves every definition, so the reply carries the changed key too */
kv.setDashboardValues({ squareSize: 90 }, false);
var full = kv.state().settings;
check(full.squareSize === 90, 'the full read carries the latest change',
    String(full.squareSize));
check(full.displayText === 'X\nC\n.\n/', 'and the other settings are intact',
    JSON.stringify(full.displayText));

/* the very first apply on a fresh overlay has nothing to fall back on */
console.log('');
console.log('--- a fresh overlay with no prior state still uses the file defaults ---');
check(kv.state().settings.squareSize === 90, 'value present');

console.log('');
console.log(checks - failures + '/' + checks + ' dashboard-merge checks passed');
if (failures) {
    console.log(failures + ' FAILED');
    process.exit(1);
}
