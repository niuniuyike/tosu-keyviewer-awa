/*
 * Unit tests for the pure key-mapping helpers inside keyviewer_awa/index.html.
 *
 *   node tools/keys.test.js
 *
 * They run in a browser VM with a tiny DOM stub, so the same code that ships in
 * the overlay is what gets tested.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const overlayPath = path.join(__dirname, '..', 'keyviewer_awa', 'index.html');
const html = fs.readFileSync(overlayPath, 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('no inline script found in index.html');

const stubElement = () => ({
    style: { cssText: '' },
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) {
        this.children.push(child);
    },
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
    },
    addEventListener() {},
    getBoundingClientRect: () => ({ width: 200, height: 400 }),
    getContext: () => null,
    set textContent(value) {
        this._text = value;
    },
    get textContent() {
        return this._text;
    }
});

const documentStub = {
    readyState: 'complete',
    hidden: false,
    body: stubElement(),
    createElement: stubElement,
    getElementById: () => null,
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
};

const windowStub = {
    location: { pathname: '/keyviewer_awa/', search: '' },
    devicePixelRatio: 1,
    innerWidth: 200,
    innerHeight: 400,
    addEventListener() {},
    requestAnimationFrame: () => 0,
    matchMedia: undefined,
    console
};

const sandbox = {
    window: windowStub,
    document: documentStub,
    console,
    fetch: () => Promise.reject(new Error('no fetch in tests')),
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    URLSearchParams,
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp
};
sandbox.globalThis = sandbox;
windowStub.document = documentStub;

vm.createContext(sandbox);
vm.runInContext(match[1], sandbox, { filename: 'keyviewer_awa/index.html' });

const api = sandbox.window.__keyviewerInternals;
if (!api) throw new Error('__keyviewerInternals was not exported');

let failures = 0;
let checks = 0;

function eq(actual, expected, label) {
    checks++;
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
        failures++;
        console.log(`FAIL ${label}\n  expected ${b}\n  actual   ${a}`);
    }
}

function ok(value, label) {
    checks++;
    if (!value) {
        failures++;
        console.log(`FAIL ${label} (got ${JSON.stringify(value)})`);
    }
}

/* ---------------- resolveCode ---------------- */
eq(api.resolveCode('KeyZ'), 'KeyZ', 'exact code KeyZ');
eq(api.resolveCode('keyz'), 'KeyZ', 'case-insensitive keyz');
eq(api.resolveCode('Z'), 'KeyZ', 'printed letter Z');
eq(api.resolveCode('z'), 'KeyZ', 'lowercase printed letter z');
eq(api.resolveCode('ctrl'), 'ControlLeft', 'alias ctrl');
eq(api.resolveCode('CTRL'), 'ControlLeft', 'alias CTRL');
eq(api.resolveCode('rctrl'), 'ControlRight', 'alias rctrl');
eq(api.resolveCode('right shift'), 'ShiftRight', 'alias with a space');
eq(api.resolveCode('shiftright'), 'ShiftRight', 'alias without a space');
eq(api.resolveCode('numpad4'), 'Numpad4', 'numpad4');
eq(api.resolveCode('NUM4'), 'Numpad4', 'alias NUM4');
eq(api.resolveCode('num1'), 'Numpad1', 'alias num1');
eq(api.resolveCode('numpadadd'), 'NumpadAdd', 'numpad add');
eq(api.resolveCode('numpadenter'), 'NumpadEnter', 'numpad enter');
eq(api.resolveCode('space'), 'Space', 'alias space');
eq(api.resolveCode('spacebar'), 'Space', 'alias spacebar');
eq(api.resolveCode('enter'), 'Enter', 'alias enter');
eq(api.resolveCode('esc'), 'Escape', 'alias esc');
eq(api.resolveCode('f12'), 'F12', 'function key f12');
eq(api.resolveCode(';'), 'Semicolon', 'semicolon');
eq(api.resolveCode(':'), 'Semicolon', 'colon maps to semicolon');
eq(api.resolveCode(','), 'Comma', 'comma');
eq(api.resolveCode('`'), 'Backquote', 'backquote');
eq(api.resolveCode('1'), 'Digit1', 'digit 1');
eq(api.resolveCode('0'), 'Digit0', 'digit 0');
eq(api.resolveCode('KeyZ=Z'), 'KeyZ', 'explicit label still resolves the key');
eq(api.resolveCode('Space=SP'), 'Space', 'explicit label on space');
eq(api.resolveCode(''), null, 'empty is unknown');
eq(api.resolveCode('   '), null, 'blank is unknown');
eq(api.resolveCode('notakey'), null, 'unknown name is null');
eq(api.resolveCode(null), null, 'null is null');

/* ---------------- resolveDisplay ---------------- */
eq(api.resolveDisplay('KeyZ', 'char'), 'Z', 'char mode letter');
eq(api.resolveDisplay('Digit1', 'char'), '1', 'char mode digit');
eq(api.resolveDisplay('Digit1', 'charShift'), '!', 'shift mode digit');
eq(api.resolveDisplay('Digit0', 'charShift'), ')', 'shift mode zero');
eq(api.resolveDisplay('Semicolon', 'char'), ';', 'char mode semicolon');
eq(api.resolveDisplay('Semicolon', 'charShift'), ':', 'shift mode semicolon');
eq(api.resolveDisplay('Numpad4', 'char'), '4', 'numpad digit');
eq(api.resolveDisplay('NumpadAdd', 'char'), '+', 'numpad add');
eq(api.resolveDisplay('ControlLeft', 'char'), 'CTRL', 'ctrl label');
eq(api.resolveDisplay('ControlLeft', 'code'), 'ControlLeft', 'code label mode');
eq(api.resolveDisplay('Space', 'char'), 'SPACE', 'space label');
eq(api.resolveDisplay('Space', 'short'), 'SPC', 'short space label');
eq(api.resolveDisplay('ControlLeft', 'short'), 'CT', 'short ctrl label');
eq(api.resolveDisplay('Enter', 'short'), 'ENT', 'short enter label');
eq(api.resolveDisplay('KeyZ', 'short'), 'Z', 'short falls back to the character');
eq(api.resolveDisplay('Backspace', 'short'), 'BSP', 'short backspace label');
eq(api.resolveDisplay('KeyZ=我的键', 'char'), '我的键', 'explicit label wins');
eq(api.resolveDisplay('Space=SP', 'char'), 'SP', 'explicit short label');
eq(api.resolveDisplay('garbage', 'char'), 'garbag', 'unknown token shows the raw text');
eq(api.resolveDisplay('', 'char'), '--', 'empty shows placeholder');

/* ---------------- parseDisplayText ---------------- */
eq(api.parseDisplayText('Z\nX\nC\nV', 4), ['Z', 'X', 'C', 'V'], 'four lines, four squares');
eq(api.parseDisplayText('ZXCV', 4), ['Z', 'X', 'C', 'V'], 'one compact token is split');
eq(api.parseDisplayText('Z X C V', 4), ['Z', 'X', 'C', 'V'], 'one spaced token is split');
eq(api.parseDisplayText('A\nB', 4), ['A', 'B', '', ''], 'short input leaves blanks');
eq(
    api.parseDisplayText('A\nB\nC\nD\nE', 4),
    ['A', 'B', 'C', 'D'],
    'extra lines are ignored'
);
eq(api.parseDisplayText('', 4), ['', '', '', ''], 'empty gives four blanks');
eq(api.parseDisplayText(null, 4), ['', '', '', ''], 'null gives four blanks');
eq(api.parseDisplayText('  z  \n  x  ', 2), ['z', 'x'], 'lines are trimmed');

/* ---------------- parseColor ---------------- */
eq(api.parseColor('#ff0000'), [255, 0, 0], 'hex red');
eq(api.parseColor('#f00'), [255, 0, 0], 'short hex red');
eq(api.parseColor('rgba(1,2,3,0.5)'), [1, 2, 3], 'rgba');
eq(api.parseColor('pink'), [255, 192, 203], 'named pink');
eq(api.parseColor('00ff00'), [0, 255, 0], 'bare hex');
eq(api.parseColor(''), [255, 255, 255], 'empty falls back to white');
eq(api.parseColor(undefined), [255, 255, 255], 'undefined falls back to white');
eq(api.parseColor('#zzzzzz'), [255, 255, 255], 'invalid falls back to white');

/* ---------------- normalize ---------------- */
const normalized = api.normalize({
    squareSize: '9999',
    borderOpacity: -20,
    debugStatus: 'true',
    inputMode: 'nonsense',
    unknownKey: 1
});
eq(normalized.squareSize, 400, 'string number coerced and clamped to max');
eq(normalized.borderOpacity, 0, 'number clamped to min');
eq(normalized.debugStatus, true, 'string boolean coerced');
/* inputMode is a locked setting now: whatever is handed in, it resolves to the
   pinned value. It is no longer a Dashboard option, but the mode itself and all
   of its code paths are still there and still selectable through ?config=. */
eq(normalized.inputMode, 'game', 'inputMode is pinned regardless of input');
ok(!('unknownKey' in normalized), 'unknown keys are dropped');
ok(!('keyCount' in normalized), 'the removed keyCount setting is gone');

/* A locked setting still yields to an explicit URL override. A headless harness
   cannot change window.location, so the ?config= payload is injected through the
   same variable the real readUrlOverride() result flows into. */
const overridden = api.setUrlOverride({ inputMode: 'keyboard', rainMode: 'blocks' });
eq(overridden.inputMode, 'keyboard', '?config= can still select the keyboard source');
eq(overridden.rainMode, 'blocks', '?config= can still select the blocks rain shape');
api.setUrlOverride(null);
eq(
    api.normalize({ inputMode: 'keyboard' }).inputMode,
    'game',
    'clearing ?config= restores the pinned value'
);

/* an old values file cannot bring the removed values back */
const fromOldFile = api.normalize({
    inputMode: 'auto',
    inputProbeMs: 500,
    gameSlots: 'd1\nd2\nd3\nd4',
    rainMode: 'blocks'
});
eq(fromOldFile.inputMode, 'game', 'a stale file cannot restore inputMode=auto');
eq(fromOldFile.inputProbeMs, 4000, 'a stale file cannot change the probe time');
eq(fromOldFile.gameSlots, 'k1\nk2\nm1\nm2', 'a stale file cannot change the slots');
eq(fromOldFile.rainMode, 'bar', 'a stale file cannot restore the blocks shape');

/* ---------------- defaults ---------------- */
const defaults = api.normalize({});
eq(defaults.rainFlowSpeed, 400, 'default rain speed matches KeyViewer');
eq(defaults.displayText, 'Z\nX\nC\nV', 'default display text');
eq(defaults.gameSlots, 'k1\nk2\nm1\nm2', 'default game slots');

/* ---------------- the Dashboard value layer ----------------
   normalize() reads the Dashboard set from module scope, so install one first
   and then call it the way production does. */
function withDashboard(values, input) {
    api.setDashboardValues(values);
    const out = api.normalize(input || {});
    api.setDashboardValues({});
    return out;
}

eq(withDashboard({ squareSize: 72 }).squareSize, 72,
    'dashboard values override the file defaults');
eq(withDashboard({ squareSize: 72 }, { squareSize: 40 }).squareSize, 72,
    'dashboard values beat settings.json');
eq(withDashboard({ displayText: 'A B C D' }).displayText, 'A B C D',
    'display text comes from the dashboard');
eq(withDashboard({ borderColor: '#123456' }).borderColor, '#123456',
    'colors come from the dashboard');
eq(withDashboard({ rainFlowSpeed: '250' }).rainFlowSpeed, 250,
    'dashboard numbers are coerced');
eq(withDashboard({}).squareSize, 56, 'empty dashboard values keep the defaults');
eq(api.normalize({}).squareSize, 56, 'no dashboard values keeps the defaults');

/* a partial set must not disturb settings it does not mention: this is the
   regression that reset a user's whole configuration */
eq(withDashboard({ displayText: 'X\nC\n.\n/' }, {}).squareSize, 56,
    'a partial set leaves untouched settings at their defaults');
eq(
    withDashboard({ showDuringPlay: true }, { displayText: 'A\nB\nC\nD' }).displayText,
    'A\nB\nC\nD',
    'dashboard beats settings.json for keys both define'
);

/* ---------------- coverage sanity ---------------- */
ok(api.allCodes.length > 140, `key database has a real size (${api.allCodes.length})`);
['KeyA', 'KeyZ', 'Digit0', 'Numpad0', 'NumpadAdd', 'ControlRight', 'ShiftLeft',
 'AltRight', 'MetaLeft', 'ArrowUp', 'F24', 'PrintScreen', 'NumLock', 'Backquote',
 'IntlYen', 'IntlRo'].forEach((code) => {
    ok(api.allCodes.indexOf(code) !== -1, `database contains ${code}`);
});

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) {
    console.log(`${failures} FAILED`);
    process.exit(1);
}
console.log('all key mapping tests passed');
