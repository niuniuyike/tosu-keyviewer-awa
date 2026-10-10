/*
 * Makes ManiaMapAnalyser's "Card Visibility" work for overlays running inside
 * tosu's in-game overlay.
 *
 *   node tools/fix-ingame-overlay-settings.js [--dry-run]
 *
 * Why a second fix is needed
 * --------------------------
 * tosu resolves plugin settings per FOLDER NAME:
 *
 *     const ingameOverlay = folderName === '__ingame__';
 *     const settingsValuesPath = getSettingsPath(folderName);
 *
 * and `counter/get` then does `values[uniqueID] ?? settings.json default`.
 *
 * Everything inside the in-game overlay identifies as `__ingame__`, so it reads
 * __ingame__.values.json - NOT ManiaMapAnalyser.by.Leo_Black.values.json. That
 * file holds the overlay layout (profiles) and had no cardVisibility key at all,
 * so the analyser fell back to its schema default, which is "Always". The card
 * could therefore never hide, no matter what the Dashboard showed, because the
 * Dashboard writes the per-plugin file the overlay never reads.
 *
 * The layout (`profiles`) is preserved untouched - only the two settings are
 * merged in.
 */
const fs = require('fs');
const path = require('path');
const tosu = require('./find-tosu');

const settingsDir = process.argv[2] || tosu.settingsDir();
const dryRun = process.argv.indexOf('--dry-run') !== -1;

const valuesFile = path.join(settingsDir, '__ingame__.values.json');

/* what the analyser should see */
const WANTED = {
    cardVisibility: 'OutsidePlay'
};

if (!fs.existsSync(valuesFile)) {
    console.error('not found: ' + valuesFile);
    process.exit(2);
}

const original = fs.readFileSync(valuesFile, 'utf8');
const values = JSON.parse(original);

console.log('file: ' + valuesFile);
console.log('');
console.log('before:');
Object.keys(WANTED).forEach((key) => {
    console.log(
        '  ' + key + ' = ' +
            (Object.prototype.hasOwnProperty.call(values, key)
                ? JSON.stringify(values[key])
                : '(ABSENT -> schema default is used, which is "Always")')
    );
});
console.log('  profiles kept: ' +
    (Array.isArray(values.profiles) ? values.profiles.length : 0));

if (dryRun) {
    console.log('');
    console.log('dry run - nothing written');
    process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = valuesFile + '.bak-cardvisibility-' + stamp;
fs.writeFileSync(backup, original, 'utf8');
console.log('');
console.log('backup written: ' + backup);

Object.assign(values, WANTED);
fs.writeFileSync(valuesFile, JSON.stringify(values), 'utf8');

const check = JSON.parse(fs.readFileSync(valuesFile, 'utf8'));
console.log('');
console.log('after:');
Object.keys(WANTED).forEach((key) => {
    console.log('  ' + key + ' = ' + JSON.stringify(check[key]));
});
console.log('  profiles kept: ' + (Array.isArray(check.profiles) ? check.profiles.length : 0));
console.log('');
console.log('The in-game overlay now gets cardVisibility=' + JSON.stringify(WANTED.cardVisibility) + '.');
console.log('Reload the overlay (Ctrl+Shift+Space to open it, or restart osu!/tosu) to apply.');
