/*
 * Read-only diagnostic for the "analyser does not hide during play" problem.
 *
 * Opens the same websocket the analyser uses (/websocket/v2) and prints every
 * change of game.state.name, plus a periodic liveness line. This answers one
 * question definitively: does tosu actually report state.name === "play" while a
 * map is running?
 *
 *   node tools/state-watch.js [tosuUrl]
 *
 * Leave it running, start a map, and watch the output.
 */
const http = require('http');
const crypto = require('crypto');

const rawTarget = process.argv[2] || 'http://127.0.0.1:24050';
/* accept "host:port" as well as a full URL */
const TOSU = /^https?:\/\//.test(rawTarget) ? rawTarget : 'http://' + rawTarget;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LABEL = 'state-watch';

function decodeServerFrames(buffer, onText) {
    let rest = buffer;
    for (;;) {
        if (rest.length < 2) return rest;

        const opcode = rest[0] & 0x0f;
        let length = rest[1] & 0x7f;
        let offset = 2;

        if (length === 126) {
            if (rest.length < 4) return rest;
            length = rest.readUInt16BE(2);
            offset = 4;
        } else if (length === 127) {
            if (rest.length < 10) return rest;
            length = Number(rest.readBigUInt64BE(2));
            offset = 10;
        }

        if (rest.length < offset + length) return rest;
        const payload = rest.slice(offset, offset + length);
        rest = rest.slice(offset + length);

        if (opcode === 0x1) onText(payload.toString('utf8'));
    }
}

function clock() {
    return new Date().toLocaleTimeString();
}

/* ------------------------------------------------------------------ */

const stats = {
    count: 0,
    lastAt: 0,
    names: {},
    transitions: [],
    keys: [],
    focused: null,
    lastState: null
};

function record(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return;
    }

    stats.count++;
    stats.lastAt = Date.now();

    const name = data && data.state ? String(data.state.name) : '(no state)';
    const previous = stats.lastState;

    if (name !== previous) {
        stats.transitions.push({ at: clock(), name: name });
        const normalized = name.trim().toLowerCase().replace(/[^a-z]/g, '');
        const playing = normalized === 'play' || normalized === 'gameplay';
        process.stdout.write(
            `${clock()}  state.name -> ${JSON.stringify(name)}` +
                (playing ? '   <== PLAY (analyser should hide)' : '') +
                '\n'
        );
        stats.lastState = name;
    }

    stats.names[name] = (stats.names[name] || 0) + 1;
    if (data && data.keys) stats.keys = Object.keys(data.keys);
    if (data && data.game) stats.focused = data.game.focused;
}

function open() {
    const url = new URL(TOSU);
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
        host: url.hostname,
        port: url.port || 80,
        path: `/websocket/v2?l=${LABEL}`,
        headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': key,
            'Sec-WebSocket-Version': '13'
        }
    });

    req.on('upgrade', (res, socket) => {
        process.stdout.write(`${clock()}  connected to ${TOSU}/websocket/v2\n`);
        let buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            buffer = decodeServerFrames(Buffer.concat([buffer, chunk]), record);
        });
        socket.on('close', () => {
            process.stdout.write(`${clock()}  socket closed, reconnecting\n`);
            setTimeout(open, 1000);
        });
        socket.on('error', () => {});
    });

    req.on('error', (error) => {
        process.stdout.write(`${clock()}  cannot reach tosu: ${error.message}\n`);
        setTimeout(open, 3000);
    });

    req.end();
}

open();

/* a liveness line, so a silent stream is obvious */
setInterval(() => {
    const age = stats.lastAt ? ((Date.now() - stats.lastAt) / 1000).toFixed(1) : 'never';
    const keys = stats.keys.length ? stats.keys.join(',') : '-';
    process.stdout.write(
        `${clock()}  alive | messages ${stats.count} | last ${age}s ago | ` +
            `state ${JSON.stringify(stats.lastState)} | focused ${stats.focused} | keys ${keys}\n`
    );
}, 5000);
