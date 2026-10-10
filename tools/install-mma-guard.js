/*
 * Installs the visibility guard into a ManiaMapAnalyser installation.
 *
 *   node tools/install-mma-guard.js [analyserFolder] [--remove] [--check] [--dry-run]
 *
 *   analyserFolder   path to the ManiaMapAnalyser folder. Optional: falls back
 *                    to the MMA_DIR environment variable, then to the usual
 *                    tosu install location. INSTALL.bat passes it in.
 *
 * The guard fixes the analyser's card sticking on a stale visibility (visible
 * during a map, or hidden outside one) until the page is reloaded. It is a
 * standalone script - see mma-guard/mma-visibility-guard.js for what it does.
 *
 * What installation touches
 * -------------------------
 *   1. copies mma-guard/mma-visibility-guard.js  ->  <analyser folder>/
 *   2. appends ONE line to <analyser folder>/index.html:
 *          <script src="mma-visibility-guard.js" defer></script>
 *
 * The analyser's own JS modules are never modified, and the original
 * index.html is kept as index.html.bak-preguard so --remove can restore it.
 */
const fs = require('fs');
const path = require('path');
const tosu = require('./find-tosu');

const givenFolder = process.argv.slice(2).find(function (value) {
    return value.charAt(0) !== '-';
});

/* No folder given: find the install. The analyser folder is discovered from
   the running tosu process or by searching, so a tosu update that renames the
   install folder cannot break this. */
const analyserDir = path.resolve(
    givenFolder || process.env.MMA_DIR || tosu.analyserDir()
);
const sourceFile = path.join(__dirname, '..', 'mma-guard', 'mma-visibility-guard.js');
const indexFile = path.join(analyserDir, 'index.html');
const backupFile = indexFile + '.bak-preguard';
const targetFile = path.join(analyserDir, 'mma-visibility-guard.js');

const TAG = '<script src="mma-visibility-guard.js" defer></script>';
const MARKER = 'mma-visibility-guard.js';

const remove = process.argv.indexOf('--remove') !== -1;
const check = process.argv.indexOf('--check') !== -1;
const dryRun = process.argv.indexOf('--dry-run') !== -1;

function fail(message) {
    console.error(message);
    process.exit(2);
}

if (!fs.existsSync(analyserDir)) fail('analyser folder not found: ' + analyserDir);
if (!fs.existsSync(indexFile)) fail('index.html not found in ' + analyserDir);

/* ------------------------------------------------------------------ */
/* --check : report, change nothing                                     */
/* ------------------------------------------------------------------ */
if (check) {
    const html = fs.readFileSync(indexFile, 'utf8');
    console.log('analyser folder : ' + analyserDir);
    console.log('index.html      : ' + html.length + ' bytes');
    console.log('guard file      : ' + (fs.existsSync(targetFile) ? 'present' : 'MISSING'));
    console.log('script tag      : ' + (html.indexOf(MARKER) !== -1 ? 'present' : 'MISSING'));
    console.log('backup          : ' + (fs.existsSync(backupFile) ? 'present' : 'absent'));

    if (fs.existsSync(targetFile)) {
        const stat = fs.statSync(targetFile);
        console.log('guard bytes     : ' + stat.size + '  (mtime ' + stat.mtime.toLocaleString() + ')');
    }

    const installed = html.indexOf(MARKER) !== -1 && fs.existsSync(targetFile);
    console.log('');
    console.log(installed ? 'STATUS          : INSTALLED' : 'STATUS          : NOT INSTALLED');
    if (!installed) {
        console.log('                  run INSTALL.bat to install it');
    }
    process.exit(0);
}

/* ------------------------------------------------------------------ */
/* --remove                                                             */
/* ------------------------------------------------------------------ */
if (remove) {
    if (dryRun) {
        console.log('dry run: would remove the guard from ' + analyserDir);
        process.exit(0);
    }

    let restored = false;
    if (fs.existsSync(backupFile)) {
        fs.copyFileSync(backupFile, indexFile);
        fs.unlinkSync(backupFile);
        restored = true;
    } else {
        /* no backup: strip the tag instead of failing */
        const html = fs.readFileSync(indexFile, 'utf8');
        const stripped = html
            .split('\n')
            .filter((line) => line.indexOf(MARKER) === -1)
            .join('\n');
        if (stripped !== html) {
            fs.writeFileSync(indexFile, stripped, 'utf8');
            restored = true;
        }
    }

    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);

    console.log('guard removed from ' + analyserDir);
    console.log('  index.html restored : ' + restored);
    console.log('  guard file deleted  : ' + !fs.existsSync(targetFile));
    process.exit(0);
}

/* ------------------------------------------------------------------ */
/* install                                                              */
/* ------------------------------------------------------------------ */
if (!fs.existsSync(sourceFile)) fail('guard source not found: ' + sourceFile);

const guardSource = fs.readFileSync(sourceFile, 'utf8');
const html = fs.readFileSync(indexFile, 'utf8');

if (html.indexOf(MARKER) !== -1) {
    /* already installed: just refresh the script file so an update lands */
    if (dryRun) {
        console.log('dry run: guard already installed, would refresh ' + targetFile);
        process.exit(0);
    }
    fs.writeFileSync(targetFile, guardSource, 'utf8');
    console.log('guard already installed - script file refreshed');
    console.log('  ' + targetFile + ' (' + guardSource.length + ' bytes)');
    process.exit(0);
}

/* inject right before </body>, after the module script so the module graph wins */
if (html.indexOf('</body>') === -1) fail('no </body> in index.html to inject before');

const patched = html.replace('</body>', '    ' + TAG + '\n</body>');

console.log('analyser folder : ' + analyserDir);
console.log('index.html      : ' + html.length + ' -> ' + patched.length + ' bytes');
console.log('guard script    : ' + guardSource.length + ' bytes');
console.log('backup          : ' + backupFile);

if (dryRun) {
    console.log('');
    console.log('dry run - nothing written');
    process.exit(0);
}

if (!fs.existsSync(backupFile)) {
    fs.writeFileSync(backupFile, html, 'utf8');
    console.log('backup written');
} else {
    console.log('backup already exists, kept as-is');
}

fs.writeFileSync(targetFile, guardSource, 'utf8');
fs.writeFileSync(indexFile, patched, 'utf8');

console.log('');
console.log('guard installed.');
console.log('  status : node tools/install-mma-guard.js --check');
console.log('  remove : node tools/install-mma-guard.js --remove');
