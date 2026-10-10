/*
 * Locates the user's tosu installation and its plugins.
 *
 *   const tosu = require('./find-tosu');
 *   tosu.root()          -> <tosu>
 *   tosu.analyserDir()   -> <tosu>/static/ManiaMapAnalyser.by.Leo_Black
 *   tosu.keyviewerDir()  -> <tosu>/static/keyviewer_awa
 *   tosu.settingsDir()   -> <tosu>/settings
 *
 * The algorithm lives in tosu-discovery-source.js so that the same code can be
 * embedded into a generated .bat file, which cannot require() a sibling module.
 * Keeping one copy means the .bat and the tools can never disagree about which
 * install they are patching.
 *
 * `node tools/find-tosu.js` prints what it found.
 */
const path = require('path');
const { TOSU_DISCOVERY_SOURCE } = require('./tosu-discovery-source');

/* eslint-disable no-new-func */
const build = new Function(
    'fs',
    'path',
    'process',
    'require',
    TOSU_DISCOVERY_SOURCE + '\nreturn { discoverTosu: discoverTosu };'
);

const { discoverTosu } = build(require('fs'), path, process, require);

const REPO = path.join(__dirname, '..');

/* the places worth checking before walking whole drives */
function nearCandidates() {
    const near = [];
    for (const base of [REPO, path.dirname(REPO)]) {
        near.push(base);
        near.push(path.join(base, 'tosu'));
        near.push(path.join(base, 'test'));
    }
    return near;
}

let cached;

function result() {
    if (!cached) cached = discoverTosu({ near: nearCandidates() });
    return cached;
}

function root() {
    return result().root;
}

function requireRoot() {
    const found = root();
    if (!found) {
        throw new Error(
            'could not locate the tosu installation.\n' +
                'Set DSH_TOSU_ROOT to your tosu folder, for example:\n' +
                '  set DSH_TOSU_ROOT=D:\\tosu\\test\\tosu-windows-v4.26.2'
        );
    }
    return found;
}

function analyserDir() {
    const found = result().analyser;
    if (!found) {
        throw new Error(
            'no ManiaMapAnalyser plugin found under ' +
                path.join(requireRoot(), 'static') +
                '\nInstall the analyser in tosu first.'
        );
    }
    return found;
}

function keyviewerDir() {
    return result().keyviewer;
}

function settingsDir() {
    return result().settings;
}

module.exports = {
    root,
    requireRoot,
    analyserDir,
    keyviewerDir,
    settingsDir
};

if (require.main === module) {
    const found = result();
    if (!found.root) {
        console.log('tosu NOT found');
        process.exit(1);
    }
    console.log('tosu root     : ' + found.root);
    console.log('analyser      : ' + (found.analyser || '(not installed)'));
    console.log('keyviewer_awa : ' + (found.keyviewer || '(not installed)'));
    console.log('settings      : ' + (found.settings || '(none)'));
}
