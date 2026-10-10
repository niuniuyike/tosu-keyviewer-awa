/*
 * The tosu discovery algorithm, kept as a plain function body so it can be
 * embedded into a generated .bat file.
 *
 *   tools/find-tosu.js   requires this (development use)
 *   tools/mma-guard-cli.js  requires this (development use)
 *   tools/build-mma-bats.js INLINES this source into the embedded installer,
 *                           because a .bat must be self-contained and cannot
 *                           require() a sibling file.
 *
 * Hard-coding a path broke once already: the user's install moved from
 * D:\tosu\tosu-windows-v4.25.1 to D:\tosu\test\tosu-windows-v4.26.2 when they
 * updated tosu, and every tool with the old path baked in started failing.
 *
 * So discovery looks for marker files rather than a version number:
 *   a tosu root  = a folder containing tosu.exe or tosu.env
 *   the analyser = a folder named ManiaMapAnalyser* containing index.html
 */
const TOSU_DISCOVERY_SOURCE = `
function looksLikeTosuRoot(dir) {
    if (!dir || !fs.existsSync(dir)) return false;
    try {
        if (!fs.statSync(dir).isDirectory()) return false;
    } catch (error) {
        return false;
    }
    return (
        fs.existsSync(path.join(dir, 'tosu.exe')) ||
        fs.existsSync(path.join(dir, 'tosu.env'))
    );
}

function looksLikePlugin(dir) {
    return Boolean(dir) && fs.existsSync(path.join(dir, 'index.html'));
}

/* A deleted older install still sits in the Recycle Bin with tosu.exe and every
   plugin inside, so it must be skipped or it would be patched instead of the
   live one. Spelled $Recycle.Bin on some systems and $RECYCLE.BIN on others,
   hence the lowercase comparison. */
var SKIP_DIRS = [
    'windows', 'node_modules', '$recycle.bin', 'system volume information',
    'appdata', 'programdata', 'recovery', 'perflogs', 'msocache', '.git', 'temp'
];

function skipDir(name) {
    return SKIP_DIRS.indexOf(String(name).toLowerCase()) !== -1;
}

/* newest version first: a machine that updated tosu keeps the old folder too */
function versionScore(dir) {
    var matches = String(dir).match(/(\\d+)\\.(\\d+)\\.(\\d+)/g);
    if (!matches) return -1;
    var best = -1;
    for (var i = 0; i < matches.length; i++) {
        var parts = matches[i].split('.');
        var score =
            Number(parts[0]) * 1000000 + Number(parts[1]) * 1000 + Number(parts[2]);
        if (score > best) best = score;
    }
    return best;
}

function newestOf(list) {
    if (list.length <= 1) return list[0] || null;
    return list.slice().sort(function (a, b) {
        return versionScore(b) - versionScore(a);
    })[0];
}

function analyserUnder(rootDir) {
    var staticDir = path.join(rootDir, 'static');
    if (!fs.existsSync(staticDir)) return null;
    var entries;
    try {
        entries = fs.readdirSync(staticDir);
    } catch (error) {
        return null;
    }
    for (var i = 0; i < entries.length; i++) {
        if (!/^ManiaMapAnalyser/i.test(entries[i])) continue;
        var candidate = path.join(staticDir, entries[i]);
        if (looksLikePlugin(candidate)) return candidate;
    }
    return null;
}

/* Ask the OS where tosu.exe runs from. Most reliable source by far, and fast:
   it names the install actually in use even when several are on disk. */
function tosuRootFromProcess() {
    if (process.platform !== 'win32') return null;
    var ps;
    try {
        ps = require('child_process')
            .execSync(
                'powershell -NoProfile -Command "' +
                    '(Get-Process -Name tosu -ErrorAction SilentlyContinue | ' +
                    'Select-Object -First 1 -ExpandProperty Path)"',
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }
            )
            .trim();
    } catch (error) {
        return null;
    }
    if (!ps) return null;
    var dir = path.dirname(ps);
    return looksLikeTosuRoot(dir) ? dir : null;
}

function walkForTosu() {
    var roots = [];
    var drives = ['C', 'D', 'E', 'F', 'G'];
    for (var d = 0; d < drives.length; d++) {
        var drive = drives[d] + ':\\\\';
        if (fs.existsSync(drive)) roots.push(drive);
    }

    var MAX_DEPTH = 4;
    var frontier = [];
    for (var r = 0; r < roots.length; r++) frontier.push({ dir: roots[r], depth: 0 });
    var seen = {};
    var found = [];

    while (frontier.length) {
        var next = [];
        for (var i = 0; i < frontier.length; i++) {
            var node = frontier[i];
            if (seen[node.dir] || node.depth > MAX_DEPTH) continue;
            seen[node.dir] = true;

            if (looksLikeTosuRoot(node.dir)) {
                found.push(node.dir);
                continue; /* do not descend into an install */
            }

            var entries;
            try {
                entries = fs.readdirSync(node.dir, { withFileTypes: true });
            } catch (error) {
                continue;
            }
            for (var e = 0; e < entries.length; e++) {
                if (!entries[e].isDirectory()) continue;
                if (skipDir(entries[e].name)) continue;
                next.push({
                    dir: path.join(node.dir, entries[e].name),
                    depth: node.depth + 1
                });
            }
        }
        frontier = next;
    }
    return newestOf(found);
}

/*
 * Returns { root, analyser, keyviewer, settings } - any field may be null.
 * opts: { near: [directories to check before walking the drives] }
 */
function discoverTosu(opts) {
    opts = opts || {};
    var result = { root: null, analyser: null, keyviewer: null, settings: null };

    function finish(rootDir) {
        result.root = rootDir;
        result.analyser = analyserUnder(rootDir);
        var kv = path.join(rootDir, 'static', 'keyviewer_awa');
        result.keyviewer = fs.existsSync(kv) ? kv : null;
        var st = path.join(rootDir, 'settings');
        result.settings = fs.existsSync(st) ? st : null;
        return result;
    }

    /* 1. the running process */
    var fromProcess = tosuRootFromProcess();
    if (fromProcess) return finish(fromProcess);

    /* 2. an explicit pointer */
    var explicit = process.env.DSH_TOSU_ROOT;
    if (looksLikeTosuRoot(explicit)) return finish(explicit);

    var mmaDir = process.env.MMA_DIR;
    if (looksLikePlugin(mmaDir)) {
        var dir = path.resolve(mmaDir);
        for (var up = 0; up < 4; up++) {
            dir = path.dirname(dir);
            if (looksLikeTosuRoot(dir)) return finish(dir);
        }
    }

    /* 3. the candidates the caller suggested */
    var nearHits = [];
    var near = opts.near || [];
    for (var n = 0; n < near.length; n++) {
        var base = near[n];
        if (!base || !fs.existsSync(base)) continue;
        if (looksLikeTosuRoot(base)) nearHits.push(base);
        var sub;
        try {
            sub = fs.readdirSync(base, { withFileTypes: true });
        } catch (error) {
            continue;
        }
        for (var s = 0; s < sub.length; s++) {
            if (!sub[s].isDirectory()) continue;
            if (skipDir(sub[s].name)) continue;
            var candidate = path.join(base, sub[s].name);
            if (looksLikeTosuRoot(candidate)) nearHits.push(candidate);
        }
    }
    var nearBest = newestOf(nearHits);
    if (nearBest) return finish(nearBest);

    /* 4. bounded walk of the drives */
    var walked = walkForTosu();
    if (walked) return finish(walked);

    return result;
}
`;

module.exports = { TOSU_DISCOVERY_SOURCE };
