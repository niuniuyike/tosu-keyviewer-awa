/*
 * Confirms the analyser page and the guard are being served correctly.
 *
 *   node tools/verify-analyser-page.js [host:port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const tosu = require('./find-tosu');

const hostArg = process.argv[2] || '127.0.0.1:24050';
const [host, port] = hostArg.split(':');

/* discover the real install, so this keeps working after a tosu update moves
   the folder (which is exactly what broke the hard-coded path before) */
let LOCAL_DIR = null;
try {
    LOCAL_DIR = tosu.analyserDir();
} catch (error) {
    LOCAL_DIR = null;
}
const FOLDER_NAME = LOCAL_DIR ? path.basename(LOCAL_DIR) : 'ManiaMapAnalyser.by.Leo_Black';
const ANALYSER = FOLDER_NAME;

function get(urlPath) {
    return new Promise((resolve, reject) => {
        http.get({ host, port: Number(port), path: urlPath }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

(async function main() {
    let failures = 0;
    const check = (ok, label, detail) => {
        if (!ok) failures++;
        console.log(
            (ok ? '  OK    ' : '  FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
        );
    };

    /* ---- the page ---- */
    const page = await get('/' + ANALYSER + '/');
    console.log('page  HTTP ' + page.status + '  ' + page.body.length + ' bytes');
    check(page.status === 200, 'the analyser page is served');
    check(page.body.includes('src="index.js"'), 'its JS module entry is intact');
    check(
        page.body.includes('mma-visibility-guard.js'),
        'the guard script tag is present'
    );
    check(page.body.includes('COUNTER_PATH'), 'tosu injected COUNTER_PATH');
    check(page.body.includes('main-card'), 'the card element is in the markup');

    /* ---- the guard file ---- */
    const guard = await get('/' + ANALYSER + '/mma-visibility-guard.js');
    console.log('');
    console.log('guard HTTP ' + guard.status + '  ' + guard.body.length + ' bytes');
    check(guard.status === 200, 'the guard script is served');

    let syntax = 'OK';
    try {
        new Function(guard.body);
    } catch (error) {
        syntax = error.message;
    }
    check(syntax === 'OK', 'the guard parses as valid JavaScript', syntax);

    check(guard.body.includes('inMenu'), 'the guard mirrors the analyser menu rule');
    check(guard.body.includes('reasserts'), 'the guard separates fixes from reasserts');

    /* ---- served copy must match the local installed copy ---- */
    if (fs.existsSync(LOCAL_DIR)) {
        const diskGuard = fs.readFileSync(
            path.join(LOCAL_DIR, 'mma-visibility-guard.js'),
            'utf8'
        );
        console.log('');
        check(
            guard.body === diskGuard,
            'what tosu serves matches the file on disk',
            guard.body === diskGuard
                ? 'identical'
                : 'served ' + guard.body.length + ' vs disk ' + diskGuard.length +
                  ' - tosu is serving a stale copy, restart it'
        );

        const diskIndex = fs.readFileSync(path.join(LOCAL_DIR, 'index.html'), 'utf8');
        check(
            page.body.includes(diskIndex.trim().slice(0, 60)),
            'the served page matches the installed index.html'
        );
    }

    console.log('');
    console.log(failures === 0 ? 'all checks passed' : failures + ' FAILED');
    process.exit(failures === 0 ? 0 : 1);
})();
