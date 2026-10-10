/*
 * Inspects the analyser's custom-preset library, which it stores as JSON inside
 * the `presetStorage` setting.
 *
 *   node tools/inspect-presets.js [valuesFile]
 *
 * Why: the analyser writes a WHOLE settings snapshot back to tosu whenever a
 * custom preset is (re)saved, so a snapshot that captured an old cardVisibility
 * silently overrides whatever the Dashboard shows.
 */
const fs = require('fs');
const path = require('path');
const tosu = require('./find-tosu');

const valuesFile =
    process.argv[2] ||
    path.join(tosu.settingsDir(), 'ManiaMapAnalyser.by.Leo_Black.values.json');

const values = JSON.parse(fs.readFileSync(valuesFile, 'utf8'));

console.log('values file : ' + valuesFile);
console.log('preset      : ' + JSON.stringify(values.preset));
console.log('presetStorage: ' + (values.presetStorage ? values.presetStorage.length + ' chars' : '(empty)'));
console.log('cardVisibility (the value tosu reports): ' + JSON.stringify(values.cardVisibility));
console.log('');

if (!values.presetStorage) {
    console.log('no preset library stored - nothing to inspect');
    process.exit(0);
}

let store;
try {
    store = JSON.parse(values.presetStorage);
} catch (error) {
    console.log('presetStorage is not JSON: ' + error.message);
    process.exit(1);
}

console.log('library keys: ' + Object.keys(store).join(', '));
console.log('');

const presets = Array.isArray(store.presets) ? store.presets : [];
const lastWritten = Array.isArray(store.lastWritten) ? store.lastWritten : [];

console.log('=== stored presets (' + presets.length + ') ===');
presets.forEach((preset) => {
    const settings = preset.settings || {};
    console.log(
        '  ' + String(preset.name).padEnd(20) +
            ' cardVisibility = ' + JSON.stringify(settings.cardVisibility) +
            '   (' + Object.keys(settings).length + ' settings)'
    );
});

console.log('');
console.log('=== lastWritten echo guard (' + lastWritten.length + ') ===');
lastWritten.forEach((entry) => {
    console.log(
        '  ' + JSON.stringify(entry && entry.preset) +
            '  cardVisibility=' + JSON.stringify(entry && entry.snapshot && entry.snapshot.cardVisibility) +
            '  at ' + (entry && entry.at ? new Date(entry.at).toLocaleString() : '?')
    );
});

/* what the plugin would push back for the ACTIVE preset */
const active = values.preset;
console.log('');
console.log('=== the active preset (' + active + ') ===');
let match = presets.find((preset) => preset.name === active);
if (!match && active === 'LastSavedPreset') {
    match = presets.find((preset) => /lastsaved/i.test(String(preset.name)));
}
if (match) {
    const settings = match.settings || {};
    console.log('  found. cardVisibility in its snapshot = ' +
        JSON.stringify(settings.cardVisibility));
    console.log('  keys it would write back: ' + Object.keys(settings).length);
    console.log('');
    console.log('  >>> when this preset is auto-saved, the plugin POSTs that whole');
    console.log('      snapshot to tosu, which overwrites the Dashboard value.');
} else {
    console.log('  no stored snapshot matches this name (built-in)');
}
