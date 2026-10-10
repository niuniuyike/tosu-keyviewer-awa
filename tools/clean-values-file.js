/*
 * Cleans up an installed keyviewer_awa.values.json that accumulated keys from an
 * older version of the plugin.
 *
 *   node tools/clean-values-file.js <values.json> [backup.json]
 *
 * Why this matters:
 *   - tosu's user/save only writes keys that exist in the CURRENT settings.json.
 *     Keys that were removed from the schema (keyCount, keyList, labelMode,
 *     rainBlock*) therefore stay in the values file forever, and the Dashboard
 *     keeps showing them.
 *   - gameSocket can be saved with a value that came from an older default, and a
 *     saved value always beats the plugin's default. Dropping it lets the current
 *     default apply again.
 *
 * Everything the current schema still defines is preserved untouched.
 */
const fs = require('fs');
const path = require('path');

const valuesFile = process.argv[2];
const backupFile = process.argv[3] || '';

if (!valuesFile) {
    console.error('usage: node tools/clean-values-file.js <values.json> [backup.json]');
    process.exit(2);
}

const schemaFile = path.join(__dirname, '..', 'keyviewer_awa', 'settings.json');
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));

/* every uniqueID the current schema defines */
const known = {};
schema.forEach((definition) => {
    if (definition && definition.uniqueID) known[definition.uniqueID] = definition;
});

const original =
    backupFile && fs.existsSync(backupFile)
        ? JSON.parse(fs.readFileSync(backupFile, 'utf8'))
        : {};

const values = JSON.parse(fs.readFileSync(valuesFile, 'utf8'));

const removed = [];
const reset = [];

Object.keys(values).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(known, key)) return;
    delete values[key];
    removed.push(key);
});

/* The endpoint the key stream uses. A saved value would otherwise keep overriding
   the corrected default for good. */
if (Object.prototype.hasOwnProperty.call(values, 'gameSocket')) {
    reset.push('gameSocket: ' + JSON.stringify(values.gameSocket) + ' -> (plugin default)');
    delete values.gameSocket;
}

fs.writeFileSync(valuesFile, JSON.stringify(values), 'utf8');

console.log('cleaned ' + valuesFile);
console.log('');
console.log('removed ' + removed.length + ' orphan key(s) the schema no longer defines:');
removed.forEach((key) => {
    console.log('  - ' + key + ' = ' + JSON.stringify(original[key]));
});
console.log('');
if (reset.length) {
    console.log('reset so the plugin default applies again:');
    reset.forEach((line) => console.log('  - ' + line));
    console.log('');
}
console.log('kept ' + Object.keys(values).length + ' setting(s):');
console.log('  ' + Object.keys(values).join(', '));
