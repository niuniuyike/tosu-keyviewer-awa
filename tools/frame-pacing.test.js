/*
 * Tests the frame pacing meter added to keyviewer_awa.
 *
 *   node tools/frame-pacing.test.js
 *
 * The meter exists to tell three situations apart, and each is simulated here
 * by feeding the real noteFrameInterval()/framePacing() the intervals that
 * situation would produce:
 *
 *   steady 16.7ms            -> a real 60fps (judder is contrast, not a fault)
 *   8/16.7/45 wild spread    -> frames arrive but pacing is uneven (fixable)
 *   around 33ms              -> the host is capping the overlay to 30
 *
 * It also pins the bug that was fixed while writing it: the interval must be
 * sampled BEFORE the dt clamp, otherwise every stall longer than 250ms is
 * reported as exactly 250ms and the worst case is invisible.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(
    path.join(__dirname, '..', 'keyviewer_awa', 'index.html'),
    'utf8'
);

/* pull the meter out of the page and run it on its own */
const start = html.indexOf('var FRAME_SAMPLE_COUNT');
const end = html.indexOf('function isDebug()');
if (start === -1 || end === -1) throw new Error('could not extract the frame meter');

const sandbox = { Infinity, Float64Array, Math };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end), sandbox);

let failures = 0;
let checks = 0;
function check(condition, label, detail) {
    checks++;
    if (!condition) failures++;
    console.log(
        (condition ? 'PASS  ' : 'FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
    );
}

function feed(intervals, repeat) {
    vm.runInContext(
        'frameIntervalCount = 0; frameIntervalNext = 0;',
        sandbox
    );
    const list = [];
    for (let r = 0; r < (repeat || 1); r++) list.push(...intervals);
    list.forEach((ms) => sandbox.noteFrameInterval(ms));
}

function pacing() {
    return sandbox.framePacing();
}

console.log('--- steady 60fps ---');
feed([16.7], 120);
let p = pacing();
check(p !== null, 'the meter produces a reading');
check(
    Math.abs(p.fps - 59.9) < 0.5,
    'reports about 60fps',
    'fps=' + p.fps.toFixed(1)
);
check(
    Math.abs(p.max - p.min) < 0.01,
    'min and max are equal when the host is perfectly even',
    p.min.toFixed(2) + ' / ' + p.max.toFixed(2)
);
check(
    p.max < 20,
    'no stall is reported, so the judder is a contrast effect and not a pacing fault'
);

console.log('');
console.log('--- uneven pacing at the same average ---');
feed([8, 16.7, 45, 8, 16.7], 24);
p = pacing();
check(p !== null, 'the meter produces a reading');
check(
    Math.abs(p.mean - 18.88) < 1,
    'the MEAN alone looks acceptable',
    'mean=' + p.mean.toFixed(2) + 'ms'
);
check(
    p.max - p.min > 30,
    'but the spread exposes the jitter',
    'min=' + p.min.toFixed(1) + ' max=' + p.max.toFixed(1)
);
check(
    p.max > 40,
    'and the worst frame is visible, which is what a mean would hide',
    'max=' + p.max.toFixed(1) + 'ms'
);

console.log('');
console.log('--- the host capping the overlay to 30 ---');
feed([33.3], 120);
p = pacing();
check(Math.abs(p.fps - 30) < 0.5, 'reports about 30fps', 'fps=' + p.fps.toFixed(1));
check(
    p.max < 40,
    'evenly paced, so the cap is the host and not our pacing',
    'max=' + p.max.toFixed(1) + 'ms'
);

console.log('');
console.log('--- a long stall is reported honestly, not clamped ---');
feed([16.7], 100);
sandbox.noteFrameInterval(900);
p = pacing();
check(
    p.max === 900,
    'a 900ms stall is reported as 900ms, not as the 250ms dt clamp',
    'max=' + p.max + 'ms'
);

console.log('');
console.log('--- the ring buffer stays bounded ---');
sandbox.frameIntervalCount = 0;
sandbox.frameIntervalNext = 0;
for (let i = 0; i < 5000; i++) sandbox.noteFrameInterval(16.7);
check(
    sandbox.frameIntervalCount === 120,
    'only the last 120 intervals are kept',
    'count=' + sandbox.frameIntervalCount
);

console.log('');
console.log('--- junk input is ignored ---');
sandbox.frameIntervalCount = 0;
sandbox.frameIntervalNext = 0;
sandbox.noteFrameInterval(0);
sandbox.noteFrameInterval(-5);
sandbox.noteFrameInterval(NaN);
sandbox.noteFrameInterval(99999);
sandbox.noteFrameInterval(16.7);
check(
    sandbox.frameIntervalCount === 1,
    'zero, negative, NaN and absurd intervals are dropped',
    'count=' + sandbox.frameIntervalCount
);
check(
    sandbox.framePacingText().indexOf('fps=') === 0,
    'the readout starts with the fps figure',
    sandbox.framePacingText().slice(0, 40)
);

console.log('');
console.log('--- the sample happens before the dt clamp ---');
const loopStart = html.indexOf('function loop(now)');
const loopChunk = html.slice(loopStart, loopStart + 900);
const sampleAt = loopChunk.indexOf('noteFrameInterval(rawMs)');
const clampAt = loopChunk.indexOf('if (dt > 0.25)');
check(
    sampleAt !== -1 && clampAt !== -1 && sampleAt < clampAt,
    'noteFrameInterval() runs on the raw value, ahead of the clamp',
    'sample@' + sampleAt + ' clamp@' + clampAt
);
check(
    loopChunk.indexOf('rawMs = now - lastFrame') !== -1,
    'the raw interval is captured before it is scaled'
);

console.log('');
console.log(checks - failures + '/' + checks + ' frame pacing checks passed');
if (failures) {
    console.log(failures + ' FAILED');
    process.exit(1);
}
