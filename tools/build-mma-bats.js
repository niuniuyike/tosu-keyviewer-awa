/*
 * Builds the self-contained .bat set for the ManiaMapAnalyser visibility fix.
 *
 *   node tools/build-mma-bats.js
 *
 * Output (repo root, plus mma-card-fix.zip):
 *   INSTALL.bat
 *   UNINSTALL.bat
 *   CHECK.bat
 *
 * Each .bat carries BOTH payloads embedded as base64 - the installer (with the
 * tosu-discovery functions prepended) and the guard script - and writes them to
 * temp files when run. One .bat is therefore completely standalone: copy it
 * anywhere, double-click it, done. No sibling files, no tools folder.
 *
 * Why base64: cmd.exe splits a multi-line argument and eats quotes, so a
 * PowerShell here-string cannot survive inside a .bat. A single-line
 * [Convert]::FromBase64String(...) call has no quotes, no % or ! expansion and
 * no newlines, so it passes through untouched. Verified for both payloads.
 *
 * The installer finds tosu itself, so the .bat does NOT search for the analyser
 * folder any more. It still forwards a dragged-and-dropped folder as an
 * override, which is the escape hatch when auto-discovery cannot decide.
 */
const fs = require('fs');
const path = require('path');
const { TOSU_DISCOVERY_SOURCE } = require('./tosu-discovery-source');

const root = path.join(__dirname, '..');

/* the discovery functions go FIRST: the installer calls discoverTosu() */
const installer =
    TOSU_DISCOVERY_SOURCE +
    '\n' +
    fs.readFileSync(path.join(__dirname, 'mma-guard-cli.js'), 'utf8');

const guard = fs.readFileSync(
    path.join(root, 'mma-guard', 'mma-visibility-guard.js'),
    'utf8'
);

[installer, guard].forEach((source, index) => {
    if (source !== source.replace(/[^\x00-\x7F]/g, '')) {
        console.error(
            (index ? 'guard' : 'installer') + ' source is not ASCII; cannot embed'
        );
        process.exit(2);
    }
});

const installerB64 = Buffer.from(installer, 'utf8').toString('base64');
const guardB64 = Buffer.from(guard, 'utf8').toString('base64');

const BAR = '='.repeat(58);

const TITLES = {
    install: 'ManiaMapAnalyser - card fix - INSTALL',
    remove: 'ManiaMapAnalyser - card fix - UNINSTALL',
    check: 'ManiaMapAnalyser - card fix - STATUS'
};

const INTROS = {
    install: [
        'echo   Stops the analyser card getting stuck visible during a map.',
        'echo.',
        'echo   Self-contained: copy this one file anywhere and run it.',
        'echo.'
    ],
    remove: [
        'echo   Puts the analyser back exactly as it was:',
        'echo     - restores index.html from the backup',
        'echo     - deletes mma-visibility-guard.js',
        'echo.'
    ],
    check: [
        'echo   Reports whether the fix is installed, plus how to inspect',
        'echo   what it is doing at runtime.',
        'echo.'
    ]
};

const TAILS = {
    install: [
        'echo   Next: restart osu! ^(or tosu^) so the page reloads.',
        'echo   Then play a map - the card should hide reliably.',
        'echo.',
        'echo   Turn it off any time from the tosu Dashboard:',
        'echo     keyviewer_awa  -^>  "Fix stuck neighbour card"',
        'echo.',
        'pause',
        'exit /b 0'
    ],
    remove: [
        'echo   Restart osu! ^(or tosu^) to load the original page.',
        'echo.',
        'pause',
        'exit /b 0'
    ],
    check: [
        'echo.',
        'echo   ------------------------------------------------------------',
        'echo   What the guard is doing at runtime',
        'echo   ------------------------------------------------------------',
        'echo.',
        'echo   1. open this in a browser:',
        'echo        http://127.0.0.1:24050/ManiaMapAnalyser.by.Leo_Black/',
        'echo   2. press F12, click Console',
        'echo   3. type:   __mmaGuard.snapshot()',
        'echo.',
        'echo   Look for:',
        'echo     mode           should be "OutsidePlay"',
        'echo     stateName      "menu" means the card is hidden by design',
        'echo     socketState    should be "open"',
        'echo     want / actual  equal when all is well',
        'echo     fixes          corrections (should stay near 0)',
        'echo     reasserts      repaints after a visibility change',
        'echo.',
        'pause',
        'exit /b 0'
    ]
};

function build(mode) {
    const lines = [];
    const add = (...rows) => rows.forEach((row) => lines.push(row));

    add(
        '@echo off',
        'rem ---------------------------------------------------------------',
        'rem  ' + TITLES[mode],
        'rem  self-contained: the installer and the guard are embedded below',
        'rem  as base64 and unpacked to %TEMP% when this runs.',
        'rem ---------------------------------------------------------------',
        'rem delayed expansion OFF: the base64 and the payloads may contain "!"',
        'setlocal DisableDelayedExpansion',
        'setlocal EnableExtensions',
        '',
        'title ' + TITLES[mode],
        '',
        'echo.',
        'echo   ' + BAR,
        'echo     ' + TITLES[mode],
        'echo   ' + BAR,
        'echo.'
    );
    INTROS[mode].forEach((row) => lines.push(row));

    add(
        '',
        'rem --------------------------------------------------------------- node',
        'where node >nul 2>nul',
        'if errorlevel 1 (',
        '    echo   [X] Node.js was not found in PATH.',
        '    echo       Install it from https://nodejs.org then run this again.',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'rem ------------------------------------------- unpack the embedded payloads',
        'set "MQ_INST=%TEMP%\\mma-installer-%RANDOM%%RANDOM%.js"',
        'set "MQ_GUARD=%TEMP%\\mma-guard-%RANDOM%%RANDOM%.js"',
        '',
        'powershell -NoProfile -Command "[IO.File]::WriteAllBytes($env:MQ_INST, [Convert]::FromBase64String(\'' + installerB64 + '\'))"',
        'if errorlevel 1 goto :unpackfail',
        'powershell -NoProfile -Command "[IO.File]::WriteAllBytes($env:MQ_GUARD, [Convert]::FromBase64String(\'' + guardB64 + '\'))"',
        'if errorlevel 1 goto :unpackfail',
        ''
    );

    if (mode === 'remove') {
        add(
            'echo   Press Ctrl+C to cancel, or',
            'pause',
            ''
        );
    }

    /*
     * A dragged-and-dropped folder is forwarded as an override. With no
     * argument the installer finds tosu on its own, which is the normal path.
     */
    add(
        'rem --------------------------------------------------------- run it',
        'set "MQ_MODE=' + mode + '"',
        'if "%~1"=="" (',
        '    node "%MQ_INST%" "%MQ_GUARD%"',
        ') else (',
        '    node "%MQ_INST%" "%~1" "%MQ_GUARD%"',
        ')',
        'set "RC=%ERRORLEVEL%"',
        '',
        'del "%MQ_INST%" >nul 2>nul',
        'del "%MQ_GUARD%" >nul 2>nul',
        '',
        'if not "%RC%"=="0" (',
        '    echo.',
        '    echo   [X] Failed with code %RC%.',
        '    echo       On a first run nothing was changed.',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        ''
    );

    TAILS[mode].forEach((row) => lines.push(row));

    add(
        '',
        ':unpackfail',
        'echo.',
        'echo   [X] Could not unpack the embedded installer.',
        'echo       Check that PowerShell is available, then try again.',
        'echo.',
        'pause',
        'exit /b 1'
    );

    return lines.join('\r\n') + '\r\n';
}

const FILES = {
    install: 'INSTALL.bat',
    remove: 'UNINSTALL.bat',
    check: 'CHECK.bat'
};

Object.keys(FILES).forEach((mode) => {
    const text = build(mode);
    fs.writeFileSync(path.join(root, FILES[mode]), text, 'latin1');
    console.log(FILES[mode].padEnd(16) + String(text.length).padStart(7) + ' bytes');
});

console.log('');
console.log(
    'embedded installer : ' + installer.length + ' bytes (' +
        TOSU_DISCOVERY_SOURCE.length + ' discovery + ' +
        (installer.length - TOSU_DISCOVERY_SOURCE.length - 1) + ' installer)'
);
console.log('embedded guard     : ' + guard.length + ' bytes');
console.log('the installer finds tosu itself; a dropped folder is an override.');
