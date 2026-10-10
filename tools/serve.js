/*
 * Minimal dependency free static server used only to preview / test the
 * keyviewer_awa overlay locally. Not part of the plugin itself.
 *
 *   node tools/serve.js [port] [root]
 *
 * It also exposes a fake tosu `/websocket/v2/precise` endpoint that speaks the
 * real wire format, so the "game data" input source can be exercised without
 * osu! or tosu running:
 *
 *   /websocket/v2/precise?l=keyviewer_awa
 *
 * The fake game state is driven from the page through
 * `POST /__fake/keys  {"k1":true,"m1":true}` or the preview page buttons.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.argv[2], 10) || 24111;
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));

/* Where the installed plugins live, for the analyser proxy. Defaults to the
   user's tosu install; override with the second argument. */
const PROJECT_ROOT = path.join(__dirname, '..');
const installedRoot = path.resolve(
    process.argv[4] || path.join(PROJECT_ROOT, '_installed')
);

/* Point a plugin's hardcoded socket host at this fake server. */
function rewriteSocketHost(source) {
    return source
        .replace(/localhost:24050/g, '127.0.0.1:' + port)
        .replace(/127\.0\.0\.1:24050/g, '127.0.0.1:' + port);
}

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

/* ------------------------------------------------------------------ *
 * Fake tosu precise websocket: {"keys":{"k1":{"isPressed":..,"count":..}}}
 * ------------------------------------------------------------------ */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const KEY_IDS = ['k1', 'k2', 'm1', 'm2'];
const fakeKeys = {
    k1: { isPressed: false, count: 0 },
    k2: { isPressed: false, count: 0 },
    m1: { isPressed: false, count: 0 },
    m2: { isPressed: false, count: 0 }
};
const wsClients = new Set();

/* Optional demo pattern so a screenshot can catch the overlay reacting:
   ?l=...&auto=1 makes k1 and k2 alternate automatically. */
let autoTimer = null;
function setAuto(on) {
    if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
    }
    if (!on) return;
    let tick = 0;
    autoTimer = setInterval(() => {
        tick++;
        setFakeKey('k1', tick % 2 === 1);
        setFakeKey('k2', tick % 3 === 0);
    }, 260);
}

function setFakeKey(id, pressed) {
    const entry = fakeKeys[id];
    if (!entry) return;
    if (pressed && !entry.isPressed) entry.count++;
    entry.isPressed = Boolean(pressed);
    broadcast();
}

function encodeFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const length = payload.length;
    let header;

    if (length < 126) {
        header = Buffer.from([0x81, length]);
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }

    return Buffer.concat([header, payload]);
}

function decodeFrames(socket, chunk, onText) {
    socket.__buffer = Buffer.concat([socket.__buffer || Buffer.alloc(0), chunk]);

    for (;;) {
        const buffer = socket.__buffer;
        if (buffer.length < 2) return;

        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) === 0x80;
        let length = buffer[1] & 0x7f;
        let offset = 2;

        if (length === 126) {
            if (buffer.length < 4) return;
            length = buffer.readUInt16BE(2);
            offset = 4;
        } else if (length === 127) {
            if (buffer.length < 10) return;
            length = Number(buffer.readBigUInt64BE(2));
            offset = 10;
        }

        let mask = null;
        if (masked) {
            if (buffer.length < offset + 4) return;
            mask = buffer.slice(offset, offset + 4);
            offset += 4;
        }

        if (buffer.length < offset + length) return;

        const payload = buffer.slice(offset, offset + length);
        if (mask) {
            for (let i = 0; i < payload.length; i++) {
                payload[i] ^= mask[i % 4];
            }
        }
        socket.__buffer = buffer.slice(offset + length);

        if (opcode === 0x1) onText(payload.toString('utf8'));
    }
}

function broadcast() {
    const message = JSON.stringify({
        state: { number: fakeGameState.number, name: fakeGameState.name },
        game: { focused: fakeGameState.focused !== false, paused: false },
        beatmap: {
            id: fakeBeatmap.id,
            md5: fakeBeatmap.md5,
            artist: fakeBeatmap.artist,
            title: fakeBeatmap.title,
            version: fakeBeatmap.version,
            mapper: fakeBeatmap.mapper,
            mode: 3,
            stats: { stars: { total: 4.2 } }
        },
        files: { beatmap: 'C:/fake/Fake Map/fake.osu' },
        play: { playerName: 'tester', score: 0, accuracy: 100, combo: 0 },
        keys: fakeKeys,
        hitErrors: [],
        tourney: []
    });
    const frame = encodeFrame(message);
    wsClients.forEach((socket) => {
        try {
            socket.write(frame);
        } catch (error) {
            wsClients.delete(socket);
        }
    });
}

/* tosu's commands channel: the overlay sends getSettings:<folder> and receives
   the saved values; a Dashboard save broadcasts "updateSettings" only to the
   clients that identify as that overlay. */
function sendToCommandsClients(overlayName, text) {
    commandClients.forEach((socket) => {
        if (overlayName && socket.__overlay && socket.__overlay !== overlayName) return;
        try {
            socket.write(encodeFrame(text));
        } catch (error) {
            commandClients.delete(socket);
        }
    });
}

function handleUpgrade(req, socket) {
    const url = new URL(req.url, 'http://localhost');
    const isData =
        url.pathname === '/websocket/v2' || url.pathname === '/websocket/v2/precise';
    const isCommands = url.pathname === '/websocket/commands';

    if (!isData && !isCommands) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        return socket.destroy();
    }

    const accept = crypto
        .createHash('sha1')
        .update(req.headers['sec-websocket-key'] + WS_GUID)
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: ' +
            accept +
            '\r\n\r\n'
    );

    if (isCommands) {
        socket.__overlay = decodeURIComponent(url.searchParams.get('l') || '');
        commandClients.add(socket);
        process.stdout.write(
            `fake commands ws client connected (l=${socket.__overlay})\n`
        );

        socket.on('data', (chunk) => {
            decodeFrames(socket, chunk, (text) => {
                if (text.indexOf('getSettings:') !== 0) return;
                /* tosu resolves EVERY definition: saved value, else its default
                   (parseSettings.ts, case 'counter/get'). So this reply is always
                   the complete set, while updateSettings carries only the changes.
                   The folder in the request decides WHICH schema is answered -
                   answering every overlay with one schema would hide real bugs. */
                const folder = decodeURIComponent(text.slice('getSettings:'.length));
                socket.write(
                    encodeFrame(
                        JSON.stringify({
                            command: 'getSettings',
                            message: resolveSettings(folder)
                        })
                    )
                );
            });
        });
        socket.on('close', () => commandClients.delete(socket));
        socket.on('error', () => commandClients.delete(socket));
        return;
    }

    wsClients.add(socket);
    addDataPath(url.pathname);
    process.stdout.write(
        `fake data ws client connected on ${url.pathname} (l=${url.searchParams.get('l')})\n`
    );

    /* push immediately, then keep pushing like tosu's poll loop does */
    const push = setInterval(broadcast, 100);
    broadcast();

    const drop = () => {
        clearInterval(push);
        wsClients.delete(socket);
        removeDataPath(url.pathname);
    };
    socket.on('close', drop);
    socket.on('error', drop);

    /* tosu's overlay may send text frames (applyFilters); drain and ignore them */
    socket.on('data', () => {});

    if (url.searchParams.get('auto') === '1') setAuto(true);
}

const commandClients = new Set();
/* how many live clients are on each data endpoint, for the tests */
const dataPaths = new Map();

function addDataPath(pathname) {
    dataPaths.set(pathname, (dataPaths.get(pathname) || 0) + 1);
}

function removeDataPath(pathname) {
    const next = (dataPaths.get(pathname) || 0) - 1;
    if (next > 0) dataPaths.set(pathname, next);
    else dataPaths.delete(pathname);
}

/* game.state.name values come from tosu's GameState enum */
const fakeGameState = { number: 5, name: 'selectPlay' };

/* the beatmap currently "selected", so the analyser sees song changes */
let fakeBeatmap = {
    id: 4242,
    md5: 'fake0000000000000000000000000000',
    artist: 'keyviewer_awa',
    title: 'Fake Map',
    version: '4K',
    mapper: 'test'
};

function selectFakeBeatmap(index) {
    fakeBeatmap = {
        id: 5000 + index,
        md5: ('fake' + index).padEnd(32, '0').slice(0, 32),
        artist: 'keyviewer_awa',
        title: 'Fake Map ' + index,
        version: index + 'K',
        mapper: 'test'
    };
    broadcast();
}

function setFakeGameState(name, number) {
    fakeGameState.name = name;
    if (typeof number === 'number') fakeGameState.number = number;
    broadcast();
}

/* ------------------------------------------------------------------ *
 * Fake tosu Dashboard settings API.
 *
 * Real tosu saves what the user entered in the Dashboard into
 * <tosu>/settings/<folder>.values.json and serves
 *   GET /api/counters/settings/<folder>  ->  { settings: [...], values: {...} }
 * This is the endpoint the overlay polls. The fake keeps the values in memory so
 * a test can POST to /__fake/dashboard and watch the overlay react without a
 * page reload - exactly the "hot reload" the Dashboard does.
 * ------------------------------------------------------------------ */

/* Only the keys the user actually saved, which is all tosu stores in
   <tosu>/settings/<folder>.values.json. */
/* A minimal but valid .osu file for the analyser's beatmap pull. The header must
   end with a blank line or the parser reports a malformed file. */
const FAKE_OSU_FILE = [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: fake.mp3',
    'Mode: 3',
    '',
    '[Editor]',
    'DistanceSpacing: 1',
    'BeatDivisor: 4',
    'GridSize: 4',
    '',
    '[Metadata]',
    'Title:Fake Map',
    'TitleUnicode:Fake Map',
    'Artist:keyviewer_awa',
    'ArtistUnicode:keyviewer_awa',
    'Creator:test',
    'Version:4K',
    'Source:',
    'Tags:test',
    'BeatmapID:4242',
    'BeatmapSetID:4242',
    '',
    '[Difficulty]',
    'HPDrainRate:8',
    'CircleSize:4',
    'OverallDifficulty:8',
    'ApproachRate:9',
    'SliderMultiplier:1.4',
    'SliderTickRate:1',
    '',
    '[Events]',
    '//Background and Video events',
    '',
    '[TimingPoints]',
    '1000,500,4,2,1,100,1,0',
    '',
    '[HitObjects]',
    '64,192,1000,1,0,0:0:0:0:',
    '192,192,1250,1,0,0:0:0:0:',
    '320,192,1500,1,0,0:0:0:0:',
    '448,192,1750,1,0,0:0:0:0:',
    ''
].join('\n');

const dashboardValues = {};
/* how many times the settings endpoint was served, so a test can prove the
   overlay is not polling it */
let settingsReads = 0;

/* what tosu's counter/get returns: every definition, saved value or default */
function resolveSettings(folder) {
    const definitions = definitionsFor(folder);
    const saved = valuesFor(folder);
    const out = {};
    definitions.forEach((definition) => {
        if (definition.type === 'header') return;
        out[definition.uniqueID] =
            saved[definition.uniqueID] !== undefined
                ? saved[definition.uniqueID]
                : definition.value;
    });
    return out;
}

function handleSettingsApi(req, res, folderName) {
    settingsReads++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
        JSON.stringify({
            settings: definitionsFor(folderName),
            values: valuesFor(folderName)
        })
    );
}
/* The real settings schema, read straight from the plugin.
 *
 * This used to be a hand-written 5-entry list. That was wrong in an important
 * way: tosu resolves EVERY definition as `saved ?? definition.value`, so a
 * definition the fake did not know about was silently dropped from the
 * getSettings reply even after it had been saved. The fake must serve the same
 * schema the plugin ships or it will hide real behaviour. */
const fakeSettingsDefinitions = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, '..', 'keyviewer_awa', 'settings.json'),
        'utf8'
    )
);

/* A stand-in for the analyser's own schema. Only the keys its boot path needs;
   the point is that a getSettings request for its folder must NOT be answered
   with the key viewer's settings.

   wsEndpoint matters: the analyser prefers its SAVED endpoint over the value in
   config.js, so this is what actually redirects it at this fake server. */
const ANALYSER_FOLDER = 'ManiaMapAnalyser.by.Leo_Black';
const analyserDefinitions = [
    {
        uniqueID: 'cardVisibility',
        type: 'options',
        title: 'Card Visibility',
        description: '',
        options: ['DuringPlay', 'OutsidePlay', 'Always'],
        value: 'Always'
    },
    {
        uniqueID: 'wsEndpoint',
        type: 'text',
        title: 'Socket endpoint',
        description: '',
        value: '127.0.0.1:' + port
    }
];
const analyserValues = {
    cardVisibility: 'OutsidePlay',
    wsEndpoint: '127.0.0.1:' + port
};

function definitionsFor(folder) {
    return folder === ANALYSER_FOLDER ? analyserDefinitions : fakeSettingsDefinitions;
}

function valuesFor(folder) {
    return folder === ANALYSER_FOLDER ? analyserValues : dashboardValues;
}

/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
    /* REQLOG */
    process.stdout.write('req ' + req.method + ' ' + req.url + '\n');
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    /* the overlay polls this; see the comment above */
    const settingsMatch = pathname.match(/^\/api\/counters\/settings\/(.+)$/);
    if (settingsMatch) {
        return handleSettingsApi(req, res, settingsMatch[1]);
    }

    /* simulate clicking through charts in song select */
    if (pathname === '/__fake/select' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                selectFakeBeatmap(Number(payload.index) || 1);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, beatmap: fakeBeatmap }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    /* start a test from a clean Dashboard, like a fresh install */
    if (pathname === '/__fake/reset' && req.method === 'POST') {
        Object.keys(dashboardValues).forEach((key) => delete dashboardValues[key]);
        settingsReads = 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
    }

    /* ---- serve an unmodified copy of an installed plugin, for the tests ----
       The analyser hardcodes localhost:24050 as its socket host, so its
       config.js has to be re-pointed at this fake server. Everything else is
       byte-identical to what the user has installed. */
    const staticMatch = pathname.match(/^\/__static\/(.+)$/);
    if (staticMatch) {
        const file = path.join(installedRoot, staticMatch[1]);
        if (!file.startsWith(installedRoot)) {
            res.writeHead(403);
            return res.end('forbidden');
        }
        return fs.readFile(file, (error, content) => {
            if (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('not found: ' + staticMatch[1]);
            }
            const type =
                types[path.extname(file)] || 'application/octet-stream';
            let body = content;
            if (/\.js$/.test(file)) {
                body = rewriteSocketHost(content.toString('utf8'));
            }
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        });
    }

    /* lets a test choose which wsEndpoint the analyser proxy serves */
    if (pathname === '/__fake/analyser-endpoint' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                if (typeof payload.wsEndpoint === 'string') {
                    analyserValues.wsEndpoint = payload.wsEndpoint;
                    analyserDefinitions.forEach((definition) => {
                        if (definition.uniqueID === 'wsEndpoint') {
                            definition.value = payload.wsEndpoint;
                        }
                    });
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, wsEndpoint: analyserValues.wsEndpoint }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    /* The analyser loads its own settings.json as the baseline before the
       commands channel answers. Serve it with the values under test so the boot
       path is deterministic. This must come BEFORE the generic /__analyser/
       handler below, which would otherwise serve the file unmodified. */
    if (pathname === '/__analyser/settings.json') {
        const definitions = JSON.parse(
            fs.readFileSync(
                path.join(installedRoot, ANALYSER_FOLDER, 'settings.json'),
                'utf8'
            )
        );
        definitions.forEach((definition) => {
            if (Object.prototype.hasOwnProperty.call(analyserValues, definition.uniqueID)) {
                definition.value = analyserValues[definition.uniqueID];
            }
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(definitions));
    }

    const analyserMatch = pathname.match(/^\/__analyser\/(.*)$/);
    if (analyserMatch) {
        const rel = analyserMatch[1] || 'index.html';
        const file = path.join(installedRoot, ANALYSER_FOLDER, rel);
        return fs.readFile(file, (error, content) => {
            if (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('not found: ' + rel);
            }
            const type = types[path.extname(file)] || 'application/octet-stream';
            let body = content;
            if (/\.js$/.test(file)) {
                body = rewriteSocketHost(content.toString('utf8'));
            } else if (/\.html$/.test(file)) {
                /* tosu appends the overlay's own folder name to every counter page
                   (directories.ts -> addCounterMetadata). Plugins rely on it to
                   address their settings stream, so the fake must do it too, or a
                   plugin silently falls back to its config defaults. */
                body =
                    content
                        .toString('utf8')
                        .replace(/(["'])\/js\//g, '$1/__analyser/js/')
                        .replace(/(["'])\/styles\//g, '$1/__analyser/styles/')
                        .replace(/(["'])\/assets\//g, '$1/__analyser/assets/') +
                    '\n<script>window.COUNTER_PATH=`' + ANALYSER_FOLDER + '`;</script>\n';
            }
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        });
    }

    /* A boot page that traces the analyser's websocket traffic from inside its own
       frame, then imports the real entry point. Used by the settings-channel
       diagnostic; the analyser's own files are untouched. */
    if (pathname === '/__analyser-boot/' || pathname === '/__analyser-boot') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(
            [
                '<!doctype html><html><head><meta charset="utf-8">',
                '<base href="/__analyser/">',
                '<link rel="stylesheet" href="styles/main.css">',
                '</head><body>',
                '<script>',
                'window.__traced = { opens: [], sent: [], received: [] };',
                '(function () {',
                '  var Native = window.WebSocket;',
                '  function Traced(url, protocols) {',
                '    var ws = protocols === undefined ? new Native(url) : new Native(url, protocols);',
                '    window.__traced.opens.push(String(url));',
                '    var send = ws.send.bind(ws);',
                '    ws.send = function (d) {',
                '      window.__traced.sent.push({ url: String(url), data: String(d).slice(0, 400) });',
                '      return send(d);',
                '    };',
                '    ws.addEventListener("message", function (e) {',
                '      window.__traced.received.push({ url: String(url), data: String(e.data).slice(0, 500) });',
                '    });',
                '    return ws;',
                '  }',
                '  Traced.prototype = Native.prototype;',
                '  ["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function (k) { Traced[k] = Native[k]; });',
                '  window.WebSocket = Traced;',
                '})();',
                'window.COUNTER_PATH = ' + JSON.stringify(ANALYSER_FOLDER) + ';',
                '/* surface boot problems, which otherwise only show as a card that',
                '   never reacts */',
                'window.__boot = { errors: [], rejections: [], log: [] };',
                'window.addEventListener("error", function (e) {',
                '  window.__boot.errors.push(String(e.message) + " @ " + String(e.filename) + ":" + e.lineno);',
                '});',
                'window.addEventListener("unhandledrejection", function (e) {',
                '  var r = e.reason;',
                '  window.__boot.rejections.push(r && r.stack ? r.stack.split("\\n")[0] : String(r));',
                '});',
                '(function () {',
                '  var c = console.error, w = console.warn;',
                '  console.error = function () {',
                '    window.__boot.errors.push(Array.prototype.join.call(arguments, " "));',
                '    return c.apply(console, arguments);',
                '  };',
                '  console.warn = function () {',
                '    window.__boot.log.push(Array.prototype.join.call(arguments, " "));',
                '    return w.apply(console, arguments);',
                '  };',
                '})();',
                '/* the analyser fetches the .osu by absolute URL; send it here */',
                '(function () {',
                '  var f = window.fetch;',
                '  window.fetch = function (input, init) {',
                '    var url = typeof input === "string" ? input : (input && input.url) || "";',
                '    if (url.indexOf("/files/") !== -1) {',
                '      var fixed = url.replace(/^https?:\\/\\/[^/]+/, "http://127.0.0.1:' + port + '");',
                '      return f(fixed, init);',
                '    }',
                '    return f(input, init);',
                '  };',
                '})();',
                '</script>',
                '<div id="status" class="status">booting</div>',
                '<section class="card main-card"></section>',
                '<script type="module">import "/__analyser/index.js";</script>',
                '</body></html>'
            ].join('\n')
        );
    }

    /* Serve the installed analyser at its real URL, with settings.json carrying
       the visibility value under test. A plugin fetches its own settings.json as
       the baseline, so the value has to be right there too. */
    if (pathname === '/' + ANALYSER_FOLDER + '/settings.json') {
        const definitions = JSON.parse(
            fs.readFileSync(
                path.join(installedRoot, ANALYSER_FOLDER, 'settings.json'),
                'utf8'
            )
        );
        definitions.forEach((definition) => {
            if (Object.prototype.hasOwnProperty.call(analyserValues, definition.uniqueID)) {
                definition.value = analyserValues[definition.uniqueID];
            }
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(definitions));
    }

    /* The analyser loads its own settings.json as the baseline before the
       commands channel answers. Serve it with the values under test so the boot
       path is deterministic. Handled earlier, before the generic handler. */

    if (pathname === '/files/beatmap/file') {
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        return res.end(FAKE_OSU_FILE);
    }

    if (pathname === '/__fake/state' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                setFakeGameState(String(payload.name || 'menu'), Number(payload.number));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, state: fakeGameState }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    if (pathname === '/__fake/state' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
            JSON.stringify({
                state: fakeGameState,
                keys: fakeKeys,
                commandClients: commandClients.size,
                dataClients: wsClients.size,
                /* which endpoint each data client is on */
                dataPaths: Array.from(dataPaths.keys()),
                settingsReads: settingsReads,
                dashboardValues: dashboardValues
            })
        );
    }

    if (pathname === '/__fake/dashboard' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                Object.keys(payload).forEach((key) => {
                    dashboardValues[key] = payload[key];
                });
                /* exactly what tosu broadcasts after a Dashboard save:
                   command "updateSettings", message = [{uniqueID, value}, ...]
                   and only to clients whose ?l= names the same overlay */
                const changed = Object.keys(payload)
                    .filter((key) => key.indexOf('__') !== 0)
                    .map((key) => ({ uniqueID: key, value: payload[key] }));
                sendToCommandsClients(
                    'keyviewer_awa',
                    JSON.stringify({ command: 'updateSettings', message: changed })
                );
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, values: dashboardValues }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    if (pathname === '/__fake/dashboard') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ values: dashboardValues }));
    }

    if (pathname === '/__fake/keys' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}');
                Object.keys(payload).forEach((id) => setFakeKey(id, payload[id]));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, keys: fakeKeys }));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    if (pathname === '/__fake/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
            JSON.stringify({
                keys: fakeKeys,
                clients: wsClients.size,
                ids: KEY_IDS
            })
        );
    }

    /* ?game=k1,k2&at=1500 runs the whole flow from a plain URL, so headless
       screenshots can exercise the tosu data path without a real game */
    const gameParam = url.searchParams.get('game');
    if (gameParam) {
        const at = parseInt(url.searchParams.get('at') || '1200', 10);
        const codes = gameParam.split(',');
        setTimeout(() => {
            codes.forEach((code) => setFakeKey(code.trim(), true));
            process.stdout.write(`fake keys down: ${codes.join(',')}\n`);
        }, at);
    }

    /* ?state=play flips the fake game state from a plain URL */
    const stateParam = url.searchParams.get('state');
    if (stateParam) {
        const at = parseInt(url.searchParams.get('stateAt') || '1200', 10);
        setTimeout(() => {
            setFakeGameState(stateParam, stateParam === 'play' ? 2 : 5);
            process.stdout.write(`fake game state: ${stateParam}\n`);
        }, at);
    }

    if (pathname === '/') pathname = '/preview.html';

    let filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
        res.writeHead(403);
        return res.end('forbidden');
    }

    /* STAGE_FALLBACK: a plugin folder may live in the staged root instead, so a
       test can host several plugins at their real URLs while /tools still comes
       from the repo. */
    if (!fs.existsSync(filePath)) {
        const staged = path.join(installedRoot, pathname.replace(/^\/+/, ''));
        if (staged.startsWith(installedRoot) && fs.existsSync(staged)) {
            filePath = staged;
        }
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('not found: ' + pathname);
        }

        /* tosu appends window.COUNTER_PATH to every counter page it serves
           (directories.ts -> addCounterMetadata). Plugins rely on it to address
           their settings stream, so the fake has to do the same or they silently
           fall back to their own defaults. */
        if (
            path.extname(filePath) === '.html' &&
            /\/[^/]+\/(index\.html)?$/.test(pathname)
        ) {
            const folder = pathname.split('/').filter(Boolean)[0] || '';
            if (folder) {
                content =
                    content.toString('utf8') +
                    `\n<script>window.COUNTER_PATH=\`${folder}\`;</script>\n`;
            }
        }

        /* headless screenshots use --virtual-time-budget, which advances virtual
           time; without this delay the capture races the overlay's first frames */
        setTimeout(() => {
            res.writeHead(200, {
                'Content-Type':
                    types[path.extname(filePath)] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(content);
        }, 400);
    });
});

server.on('upgrade', handleUpgrade);

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
        `preview server on http://127.0.0.1:${port}/ (root: ${root})\n` +
            `fake precise ws on ws://127.0.0.1:${port}/websocket/v2/precise\n`
    );
});
