/*
 * Boots keyviewer_awa/index.html in Node with a small DOM stub, then drives
 * applySettings() exactly the way the Dashboard does, asserting that the change
 * reaches the rendered squares.
 *
 *   node tools/apply-settings.test.js
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
let elementCount = 0;

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
        getContext: () => null,
        setAttribute(k, v) {
            el.attributes[k] = v;
        },
        getAttribute(k) {
            return el.attributes[k];
        },
        querySelectorAll(selector) {
            return findAll(el, selector);
        },
        querySelector(selector) {
            return findAll(el, selector)[0] || null;
        }
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

    elementCount++;
    return el;
}

function walk(node, visit) {
    visit(node);
    (node.children || []).forEach((child) => walk(child, visit));
}

function matches(node, selector) {
    if (!selector.startsWith('.')) return false;
    const cls = selector.slice(1);
    if (node.className && node.className.split(/\s+/).indexOf(cls) !== -1) return true;
    return node.classList && node.classList.contains(cls);
}

function findAll(root, selector) {
    const out = [];
    walk(root, (node) => {
        if (node !== root && matches(node, selector)) out.push(node);
    });
    return out;
}

/* the overlay's three host nodes */
const hostEl = makeElement('div');
hostEl.id = 'overlay_host';
hostEl.clientWidth = 620;
hostEl.clientHeight = 320;

const canvasEl = makeElement('canvas');
canvasEl.id = 'rain_canvas';
canvasEl.getContext = () => ({
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    rect() {},
    closePath() {},
    fill() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    measureText: () => ({ width: 10 }),
    fillText() {},
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: ''
});

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
    getElementById(id) {
        if (id === 'overlay_host') return hostEl;
        if (id === 'rain_canvas') return canvasEl;
        if (id === 'key_squares') return squaresEl;
        return null;
    },
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
    /* the settings fetch is not what this test exercises */
    fetch: () => Promise.reject(new Error('no network in this harness')),
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Proxy
};
sandbox.globalThis = sandbox;
sandbox.window.document = documentStub;

vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'overlay.js' });

const kv = sandbox.window.keyviewer;
if (!kv) throw new Error('the overlay did not expose its hook');

let failures = 0;
let checks = 0;
function check(condition, label, detail) {
    checks++;
    if (!condition) failures++;
    console.log(
        (condition ? 'PASS  ' : 'FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
    );
}

function letters() {
    return findAll(squaresEl, '.keyv-letter').map((el) => el.textContent);
}

function squareWidths() {
    return findAll(squaresEl, '.keyviewer-key').map((el) => el.style.width);
}

console.log('boot state: squares=' + findAll(squaresEl, '.keyviewer-key').length);
check(findAll(squaresEl, '.keyviewer-key').length === 4, 'boots with exactly four squares');
check(letters().join('') === 'ZXCV', 'boots with the default ZXCV text', JSON.stringify(letters()));

/* ---------- the Dashboard changes the display text ---------- */
console.log('');
console.log('--- Dashboard sets displayText = "A\\nB\\nC\\nD" ---');
kv.setDashboardValues({ displayText: 'A\nB\nC\nD' }, false);
check(
    kv.state().settings.displayText === 'A\nB\nC\nD',
    'the setting itself was applied',
    JSON.stringify(kv.state().settings.displayText)
);
check(letters().join('') === 'ABCD', 'the squares now render ABCD', JSON.stringify(letters()));

/* ---------- compact form ---------- */
console.log('');
console.log('--- Dashboard sets displayText = "1234" (compact) ---');
const beforeCompact = kv.state();
kv.setDashboardValues({ displayText: '1234' }, false);
const afterCompact = kv.state();
console.log(
    '  displayText ' + JSON.stringify(beforeCompact.settings.displayText) +
    ' -> ' + JSON.stringify(afterCompact.settings.displayText) +
    '   applies ' + beforeCompact.applies + ' -> ' + afterCompact.applies +
    '   sig=' + afterCompact.lastSignature +
    '   lastDisplaySeen=' + JSON.stringify(afterCompact.lastDisplaySeen) +
    '   frame=' + afterCompact.frameRequested +
    '   rebuildsAfterApply=' + afterCompact.rebuildsAfterApply +
    '   rebuildInput=' + JSON.stringify(afterCompact.rebuildInput) +
    '   rebuildOutput=' + JSON.stringify(afterCompact.rebuildOutput) +
    '   rebuilds ' + beforeCompact.rebuilds + ' -> ' + afterCompact.rebuilds +
    '   key displays ' + JSON.stringify(afterCompact.keys.map((k) => k.display))
);
check(letters().join('') === '1234', 'a compact token is split per character', JSON.stringify(letters()));

/* ---------- blank line falls back to the slot name ---------- */
console.log('');
console.log('--- blank lines fall back to the slot names ---');
kv.setDashboardValues({ displayText: 'Q\n\n\nR' }, false);
check(letters().join('|') === 'Q|K2|M1|R', 'blank lines show the data slot name', JSON.stringify(letters()));

/* ---------- appearance still hot reloads ---------- */
console.log('');
console.log('--- Dashboard sets squareSize = 90 ---');
kv.setDashboardValues({ squareSize: 90 }, false);
check(kv.state().settings.squareSize === 90, 'squareSize applied');
check(
    squareWidths()[0] === '90px',
    'the DOM squares resized',
    JSON.stringify(squareWidths())
);

console.log('');
console.log('--- Dashboard sets borderColor + rainFlowSpeed ---');
kv.setDashboardValues({ borderColor: '#ff0000', rainFlowSpeed: 250 }, false);
check(kv.state().settings.rainFlowSpeed === 250, 'rainFlowSpeed applied');
check(
    findAll(squaresEl, '.keyviewer-key')[0].style.border.indexOf('255,0,0') !== -1,
    'the border colour reached the DOM',
    findAll(squaresEl, '.keyviewer-key')[0].style.border
);

/* ---------- the square count never changes ---------- */
console.log('');
console.log('--- attempts to change the square count are ignored ---');
kv.setDashboardValues({ keyCount: 9, keyList: 'a\nb\nc\nd\ne\nf\ng\nh\ni' }, false);
check(
    findAll(squaresEl, '.keyviewer-key').length === 4,
    'still exactly four squares'
);
check(
    !('keyCount' in kv.state().settings),
    'keyCount is no longer a setting at all'
);

/* ---------- "only while playing" ---------- */
console.log('');
console.log('--- showDuringPlay: hidden outside a map, visible while playing ---');
kv.setDashboardValues({ showDuringPlay: true }, false);
kv.applyGamePayload({ state: { number: 5, name: 'selectPlay' } });
check(kv.visibility().state === 'selectplay', 'state name is normalised',
    kv.visibility().state);
check(kv.visibility().playing === false, 'select screen is not "playing"');
check(kv.visibility().hidden === true, 'the overlay is hidden in the menus');

kv.applyGamePayload({ state: { number: 2, name: 'play' }, keys: {} });
check(kv.visibility().playing === true, 'play is recognised');
check(kv.visibility().hidden === false, 'the overlay shows during a map');

kv.applyGamePayload({ state: { number: 5, name: 'resultScreen' } });
check(kv.visibility().hidden === true, 'it hides again on the result screen');

/* turning the switch off must show it everywhere again */
kv.setDashboardValues({ showDuringPlay: false }, false);
check(kv.visibility().hidden === false, 'with the switch off it is always visible');

/* the switch must not break key handling */
kv.setDashboardValues({ showDuringPlay: true }, false);
kv.applyGamePayload({ state: { name: 'play' }, keys: { k1: { isPressed: true, count: 1 } } });
check(kv.state().keys[0].pressed === true, 'keys still work while shown');

console.log('');
console.log(checks - failures + '/' + checks + ' apply-settings checks passed');
if (failures) {
    console.log(failures + ' FAILED');
    process.exit(1);
}
