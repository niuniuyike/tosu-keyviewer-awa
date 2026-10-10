/*
 * Installer used by INSTALL.bat / UNINSTALL.bat / CHECK.bat.
 *
 *   node tools/mma-guard-cli.js check   [analyserFolder] [guardFile]
 *   node tools/mma-guard-cli.js install [analyserFolder] [guardFile]
 *   node tools/mma-guard-cli.js remove  [analyserFolder]
 *   node tools/mma-guard-cli.js find
 *
 * The folder argument is OPTIONAL: with no argument the installer finds tosu
 * itself, including the analyser plugin, by looking for marker files rather
 * than a versioned path. That matters because a hard-coded path broke as soon
 * as the user updated tosu and the folder name changed.
 *
 * A .bat file carries the action in MQ_MODE so its argument list stays free for
 * the folder. Without it the action is the first argument.
 *
 * tools/build-mma-bats.js embeds this file (plus the discovery functions, which
 * are appended by the builder) into the generated .bat files, so nothing here
 * may require() a sibling module at runtime.
 */
const fs = require('fs');
const path = require('path');

const TAG = '<script src="mma-visibility-guard.js" defer></script>';
const MARKER = 'mma-visibility-guard.js';
const BACKUP_SUFFIX = '.bak-preguard';

/* discoverTosu() is defined above this file in a generated .bat, where the
   discovery source is concatenated in. Run from disk, pull it from the tools
   folder instead. */
if (typeof discoverTosu !== 'function') {
    var discovery = require('./tosu-discovery-source');
    /* eslint-disable-next-line no-new-func */
    discoverTosu = new Function(
        'fs',
        'path',
        'process',
        'require',
        discovery.TOSU_DISCOVERY_SOURCE + '\nreturn discoverTosu;'
    )(fs, path, process, require);
}

var useEnvMode = Boolean(process.env.MQ_MODE);
const action = (process.env.MQ_MODE || process.argv[2] || '').toLowerCase();

/*
 * Classify the positional arguments by what they ARE, not by position.
 *
 * The .bat may call this three ways:
 *     node installer.js                         (no override)
 *     node installer.js  <guardFile>
 *     node installer.js  <folder>  <guardFile>
 *
 * Reading them by position got that wrong - with one argument the guard file
 * was taken as the folder. Checking the path instead is unambiguous: the guard
 * is always a .js file, the folder never is.
 */
const positionals = (useEnvMode ? process.argv.slice(2) : process.argv.slice(3)).filter(
    Boolean
);

var folderArg = null;
var guardArg = null;

positionals.forEach((value) => {
    if (/\.js$/i.test(value)) {
        if (!guardArg) guardArg = value;
        return;
    }
    if (!folderArg) folderArg = value;
});

function out(text) {
    console.log('  ' + text);
}

function die(message) {
    console.error('  [X] ' + message);
    process.exit(2);
}

/* the folder we were handed, or null */
const givenFolder = folderArg ? path.resolve(folderArg) : null;

/* Where the installer lives, used as a hint for the search. (__dirname is
   defined both when run from disk and when the file is written to %TEMP% by a
   .bat, so this always resolves to somewhere sane.) */
const INSTALLER_DIR = typeof __dirname === 'string' ? __dirname : process.cwd();

/* ------------------------------------------------------------------ *
 * find tosu
 * ------------------------------------------------------------------ */
function locate() {
    if (givenFolder) {
        if (!fs.existsSync(path.join(givenFolder, 'index.html'))) {
            die('that folder has no index.html: ' + givenFolder);
        }
        return givenFolder;
    }

    const found = discoverTosu({
        near: [INSTALLER_DIR, process.cwd()]
    });

    if (found.analyser) return found.analyser;

    /* the analyser itself was not found: say what WAS found instead */
    if (found.root) {
        die(
            'found tosu at ' + found.root + '\n' +
                '      but no ManiaMapAnalyser plugin under ' +
                path.join(found.root, 'static') + '\n' +
                '      Install the analyser in tosu, or drag its folder onto this file.'
        );
    }

    die(
        'could not find the tosu installation.\n' +
            '      FIX: drag the folder "ManiaMapAnalyser.by.Leo_Black" onto this\n' +
            '           file and drop it, or set DSH_TOSU_ROOT to your tosu folder.'
    );
}

/* ------------------------------------------------------------------ *
 * find: print the analyser folder, exit 1 if there is none
 * ------------------------------------------------------------------ */
if (action === 'find') {
    const found = discoverTosu({ near: [INSTALLER_DIR, process.cwd()] });
    if (found.analyser) {
        console.log(found.analyser);
        process.exit(0);
    }
    if (found.root) {
        console.error('  tosu found at ' + found.root + ' but no ManiaMapAnalyser plugin');
        process.exit(3);
    }
    console.error('  tosu not found');
    process.exit(1);
}

if (action !== 'check' && action !== 'install' && action !== 'remove') {
    console.error('usage: mma-guard-cli.js check|install|remove [folder] [guardFile]');
    process.exit(2);
}

const folder = locate();
const indexFile = path.join(folder, 'index.html');
const backupFile = indexFile + BACKUP_SUFFIX;
const targetFile = path.join(folder, 'mma-visibility-guard.js');
const guardFile = guardArg ? path.resolve(guardArg) : null;

/* ------------------------------------------------------------------ *
 * check
 * ------------------------------------------------------------------ */
if (action === 'check') {
    const html = fs.readFileSync(indexFile, 'utf8');
    const hasFile = fs.existsSync(targetFile);
    const hasTag = html.indexOf(MARKER) !== -1;
    const installed = hasFile && hasTag;

    console.log('');
    out('analyser folder : ' + folder);
    out('index.html      : ' + html.length + ' bytes');
    out(
        'guard file      : ' +
            (hasFile ? 'present (' + fs.statSync(targetFile).size + ' bytes)' : 'MISSING')
    );
    out('script tag      : ' + (hasTag ? 'present' : 'MISSING'));
    out('backup          : ' + (fs.existsSync(backupFile) ? 'present' : 'absent'));
    console.log('');
    out(installed ? 'STATUS          : INSTALLED' : 'STATUS          : NOT INSTALLED');
    if (!installed) out('                  run INSTALL.bat');
    console.log('');
    process.exit(0);
}

/* ------------------------------------------------------------------ *
 * remove
 * ------------------------------------------------------------------ */
if (action === 'remove') {
    let restored = false;

    if (fs.existsSync(backupFile)) {
        fs.copyFileSync(backupFile, indexFile);
        fs.unlinkSync(backupFile);
        restored = true;
    } else {
        const html = fs.readFileSync(indexFile, 'utf8');
        const stripped = html
            .split(/\r?\n/)
            .filter((line) => line.indexOf(MARKER) === -1)
            .join('\n');
        if (stripped !== html) {
            fs.writeFileSync(indexFile, stripped, 'utf8');
            restored = true;
        }
    }

    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);

    out('index.html restored : ' + restored);
    out('guard file deleted  : ' + !fs.existsSync(targetFile));
    console.log('');
    out('RESULT: REMOVED');
    console.log('');
    process.exit(0);
}

/* ------------------------------------------------------------------ *
 * install
 * ------------------------------------------------------------------ */
if (!guardFile) die('no guard script given');
if (!fs.existsSync(guardFile)) die('guard script not found: ' + guardFile);

const guard = fs.readFileSync(guardFile, 'utf8');
const html = fs.readFileSync(indexFile, 'utf8');

if (html.indexOf(MARKER) !== -1) {
    fs.writeFileSync(targetFile, guard, 'utf8');
    out('already installed - script refreshed (' + guard.length + ' bytes)');
    console.log('');
    out('RESULT: INSTALLED');
    console.log('');
    process.exit(0);
}

if (html.indexOf('</body>') === -1) die('no closing </body> tag in index.html');

if (!fs.existsSync(backupFile)) {
    fs.writeFileSync(backupFile, html, 'utf8');
    out('backup written  : index.html.bak-preguard');
} else {
    out('backup kept     : index.html.bak-preguard (already existed)');
}

fs.writeFileSync(targetFile, guard, 'utf8');
out('guard script    : mma-visibility-guard.js (' + guard.length + ' bytes)');

fs.writeFileSync(indexFile, html.replace('</body>', '    ' + TAG + '\n</body>'), 'utf8');
out('index.html      : patched (' + html.length + ' bytes)');

console.log('');
out('RESULT: INSTALLED');
console.log('');
