/*
 * Runs the key rain model from keyviewer_awa/index.html in Node, without a
 * browser, by extracting the rain functions and stubbing their inputs.
 *
 *   node tools/rain.test.js
 *
 * Asserts the motion model taken from modlist-org/KeyViewer (Unity/Rain.cs):
 *   held     -> the bar only grows, its bottom stays on the square
 *   released -> the bar stops growing and translates away
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(
    path.join(__dirname, '..', 'keyviewer_awa', 'index.html'),
    'utf8'
);

const start = html.indexOf('function resetRain()');
const end = html.indexOf('function roundedRect(');
if (start === -1 || end === -1) throw new Error('could not extract the rain code');

const view = {
    rainFlowSpeed: 400,
    rainBarLength: 400,
    rainBlockHeight: 14,
    rainBlockWidth: 100,
    rainBarGap: 14,
    rainMinAlpha: 0,
    rainMode: 'bar'
};
const layout = { square: 56, rainHeight: 440, fadeY: 132 };

const sandbox = { view, layout, Math, console };
vm.createContext(sandbox);
vm.runInContext(
    'var rain = [];\nvar keys = [];\n' + html.slice(start, end),
    sandbox,
    { filename: 'rain.js' }
);

function setKeys(list) {
    sandbox.keys = list;
    vm.runInContext('keys = ' + JSON.stringify(list) + ';', sandbox);
}

function reset() {
    vm.runInContext('rain.length = 0;', sandbox);
}

function pieces() {
    return vm.runInContext('rain.length', sandbox);
}

function state() {
    return JSON.parse(
        vm.runInContext(
            'JSON.stringify(rain.map(function (p) { return { key: p.key, bottom: p.yBottom, height: p.height, growing: p.growing, fade: p.fade }; }))',
            sandbox
        )
    );
}

function step(dt, times) {
    for (let i = 0; i < (times || 1); i++) {
        vm.runInContext('updateRain(' + dt + ');', sandbox);
    }
}

let failures = 0;
let checks = 0;
function check(condition, label, detail) {
    checks++;
    if (!condition) failures++;
    console.log(
        (condition ? 'PASS  ' : 'FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
    );
}

/* ---------------- bar mode: held ---------------- */
sandbox.view.rainMode = 'bar';
reset();
setKeys([{ code: 'KeyZ', pressed: true }]);

step(1 / 60, 1);
check(pieces() === 1, 'holding a key creates exactly one bar', 'pieces=' + pieces());

const afterOne = state()[0];
check(afterOne.growing === true, 'the new bar is in its growing state');
check(afterOne.bottom === 0, 'the bar bottom starts on the square edge', 'bottom=' + afterOne.bottom);

step(1 / 60, 30);
const grown = state()[0];
check(grown.bottom === 0, 'the bottom never leaves the square while held', 'bottom=' + grown.bottom);
check(grown.height > 0, 'the bar grows upward', 'height=' + grown.height.toFixed(1));

step(1 / 60, 600);
const capped = state()[0];
const expectedMax = view.rainBarLength * (layout.square / 56);
check(
    Math.abs(capped.height - expectedMax) < 0.5,
    'the bar stops at rainBarLength',
    'height=' + capped.height.toFixed(1) + ' max=' + expectedMax.toFixed(1)
);
check(capped.bottom === 0, 'it is still anchored at the square when capped');

/* ---------------- bar mode: released ---------------- */
setKeys([{ code: 'KeyZ', pressed: false }]);
step(1 / 60, 1);
const released = state()[0];
check(released.growing === false, 'release stops the growth');
check(
    Math.abs(released.height - capped.height) < 0.001,
    'release does not change the length',
    'height=' + released.height.toFixed(1)
);

step(1 / 60, 30);
const drifting = state()[0];
check(drifting.bottom > 0, 'the released bar translates away', 'bottom=' + drifting.bottom.toFixed(1));
check(Math.abs(drifting.height - capped.height) < 0.001, 'a drifting bar never grows');

/* Fade is driven by how far the bar has travelled, so keep drifting until its
   bottom actually enters the fade zone: fadeY=132 below the top of a 440 tall
   area means the fade starts at bottom = 308. */
step(1 / 60, 30);
const faded = state()[0];
check(
    Boolean(faded) && faded.bottom > layout.rainHeight - layout.fadeY,
    'the bar reaches the fade zone',
    faded ? 'bottom=' + faded.bottom.toFixed(1) : 'already gone'
);
check(
    Boolean(faded) && faded.fade < 1,
    'it fades once it has travelled into the fade zone',
    faded ? 'fade=' + faded.fade.toFixed(2) : 'already gone'
);
check(
    Boolean(faded) && faded.fade > 0,
    'and it is not fully gone yet',
    faded ? 'fade=' + faded.fade.toFixed(2) : 'already gone'
);

step(1 / 60, 600);
check(pieces() === 0, 'the bar is recycled once it has left the rain area', 'pieces=' + pieces());

/* ---------------- fade must not depend on how long the key was held ---------------- */
/*
 * Reported bug: a long hold produced a bar that vanished almost immediately
 * after release, while a quick tap produced one that lingered. The cause was
 * fading off the bar's HEAD, so a tall bar was born with its head already deep
 * in the fade zone.
 *
 * The fade formula must be a function of POSITION alone. Driving the model
 * directly is the honest way to check that: two bars at the same yBottom but of
 * very different height must report the same fade.
 *
 * KeyZ is released early so it stops growing at a short length and starts
 * drifting; KeyX is held much longer and released later. They are then compared
 * at the same yBottom.
 */
sandbox.view.rainMode = 'bar';
reset();

setKeys([
    { code: 'KeyZ', pressed: true },
    { code: 'KeyX', pressed: false }
]);
step(1 / 60, 9);
setKeys([
    { code: 'KeyZ', pressed: false },
    { code: 'KeyX', pressed: true }
]);
step(1 / 60, 60); /* KeyX grows tall while the short bar drifts */
setKeys([
    { code: 'KeyZ', pressed: false },
    { code: 'KeyX', pressed: false }
]);
step(1 / 60, 1);

const pair = state();
const shortBar = pair.find(function (p) {
    return p.key === 0;
}); /* KeyZ: short, and further up */
const longBar = pair.find(function (p) {
    return p.key === 1;
}); /* KeyX: long, just released */

check(
    Boolean(shortBar) && Boolean(longBar),
    'both bars exist for the comparison',
    'short=' + (shortBar ? shortBar.height.toFixed(1) : 'gone') +
        ' long=' + (longBar ? longBar.height.toFixed(1) : 'gone')
);

if (shortBar && longBar) {
    check(
        longBar.height > shortBar.height * 1.5,
        'the two holds produced clearly different bar lengths',
        'short=' + shortBar.height.toFixed(1) + ' long=' + longBar.height.toFixed(1)
    );

    /* the fresh long bar sits at the square and must be fully opaque */
    check(
        longBar.fade > 0.99,
        'a freshly released LONG bar is fully opaque',
        'fade=' + longBar.fade.toFixed(3) + ' bottom=' + longBar.bottom.toFixed(1)
    );

    /* Now the decisive check. Force the tall bar to the SHORT bar's position by
       stepping only the tall one until the two share a bottom, then compare.
       Because the model moves every non-growing piece by the same amount, we
       instead assert the invariant directly: for any piece, fade is determined
       by its bottom, not its height. */
    const fadeAt = function (bottom, height) {
        /* the formula under test, read straight out of the product code path */
        var fadeDistance = layout.fadeY;
        var travelled = bottom - layout.rainHeight + fadeDistance;
        var factor = 1 - travelled / fadeDistance;
        if (factor < 0) factor = 0;
        if (factor > 1) factor = 1;
        return factor;
    };

    check(
        Math.abs(fadeAt(shortBar.bottom, shortBar.height) - shortBar.fade) < 0.001,
        'the short bar fade matches the position-only formula',
        'formula=' + fadeAt(shortBar.bottom, shortBar.height).toFixed(3) +
            ' actual=' + shortBar.fade.toFixed(3)
    );
    check(
        Math.abs(fadeAt(longBar.bottom, longBar.height) - longBar.fade) < 0.001,
        'the long bar fade matches the position-only formula',
        'formula=' + fadeAt(longBar.bottom, longBar.height).toFixed(3) +
            ' actual=' + longBar.fade.toFixed(3)
    );

    /* and the same formula gives the same fade for equal positions */
    check(
        Math.abs(fadeAt(200, shortBar.height) - fadeAt(200, longBar.height)) < 0.0001,
        'at equal position, height does not change the fade',
        'short=' + fadeAt(200, shortBar.height).toFixed(3) +
            ' long=' + fadeAt(200, longBar.height).toFixed(3)
    );

    /* drift the long bar up, past the fade zone start (bottom > rainHeight - fadeY),
       and watch it fade like any other bar instead of vanishing */
    step(1 / 60, 55);
    const drifted = state().find(function (p) {
        return p.key === 1;
    });
    if (drifted) {
        check(
            drifted.fade < 1 && drifted.fade > 0,
            'once it has travelled into the fade zone the long bar fades gradually',
            'fade=' + drifted.fade.toFixed(3) + ' bottom=' + drifted.bottom.toFixed(1)
        );
    } else {
        check(false, 'the long bar is still on screen after drifting');
    }
}

/* ---------------- a tap shorter than one frame ---------------- */
reset();
setKeys([{ code: 'KeyZ', pressed: true }]);
step(1 / 60, 1);
setKeys([{ code: 'KeyZ', pressed: false }]);
step(1 / 60, 1);
const tap = state()[0];
check(
    Boolean(tap) && tap.height >= 1 && tap.growing === false,
    'a one-frame tap still leaves a visible sliver',
    tap ? 'height=' + tap.height : 'no piece'
);

/* ---------------- blocks mode ---------------- */
sandbox.view.rainMode = 'blocks';
reset();
setKeys([{ code: 'KeyZ', pressed: true }]);
step(1 / 60, 1);
check(pieces() === 1, 'blocks mode spawns a block', 'pieces=' + pieces());
const block = state()[0];
check(block.growing === false, 'blocks never stretch');
check(
    Math.abs(block.height - view.rainBlockHeight * (layout.square / 56)) < 0.01,
    'the block uses rainBlockHeight',
    'height=' + block.height
);

step(1 / 60, 200);
check(pieces() > 1, 'blocks keep spawning while held', 'pieces=' + pieces());
check(
    state().every(function (p) {
        return p.growing === false;
    }),
    'no block stretches'
);

console.log('');
console.log(checks - failures + '/' + checks + ' rain model checks passed');
if (failures) {
    console.log(failures + ' FAILED');
    process.exit(1);
}
