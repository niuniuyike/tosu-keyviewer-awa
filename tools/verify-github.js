/*
 * Verifies the published GitHub repository and release.
 *
 *   node tools/verify-github.js
 *
 * Reads what GitHub actually reports, rather than what the push command printed:
 * the file list and byte count on the default branch, and every asset on the
 * latest release with its size. Prints a pass/fail summary.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'niuniuyike/tosu-keyviewer-awa';
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe';

function gh(args) {
    const out = execFileSync(GH, args, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return out;
}

let failures = 0;
function check(ok, label, detail) {
    if (!ok) failures++;
    console.log(
        (ok ? '  OK    ' : '  FAIL  ') + label + (detail ? '   [' + detail + ']' : '')
    );
}

/* ---- repository ---- */
const repo = JSON.parse(gh(['api', 'repos/' + REPO]));
console.log('repository : ' + repo.full_name);
console.log('');
check(repo.visibility === 'public', 'the repository is public', repo.visibility);
check(repo.default_branch === 'main', 'default branch is main', repo.default_branch);
check(
    repo.license && repo.license.spdx_id === 'MIT',
    'GitHub detected the MIT licence',
    repo.license ? repo.license.spdx_id : 'none'
);
check(!repo.archived && !repo.disabled, 'the repository is active');

/* ---- files on the default branch ---- */
const tree = JSON.parse(
    gh(['api', 'repos/' + REPO + '/git/trees/main?recursive=1'])
);
const blobs = tree.tree.filter((entry) => entry.type === 'blob');
const total = blobs.reduce((sum, entry) => sum + (entry.size || 0), 0);

console.log('');
console.log('files on main : ' + blobs.length + ' (' + (total / 1024).toFixed(0) + ' KB)');

const REQUIRED = [
    'README.md',
    'LICENSE',
    '.gitattributes',
    '.gitignore',
    'keyviewer_awa/index.html',
    'keyviewer_awa/settings.json',
    'keyviewer_awa/metadata.txt',
    'keyviewer_awa/README.md',
    'mma-guard/mma-visibility-guard.js',
    'INSTALL.bat',
    'UNINSTALL.bat',
    'CHECK.bat',
    'tools/serve.js',
    'tools/find-tosu.js',
    'tools/mma-guard-cli.js',
    'tools/build-mma-bats.js'
];

const paths = blobs.map((entry) => entry.path);
REQUIRED.forEach((file) => {
    check(paths.indexOf(file) !== -1, 'main contains ' + file);
});

check(
    !paths.some((p) => p.indexOf('_research/') === 0),
    'no scratch/research files were published'
);
check(
    !paths.some((p) => /\.zip$/i.test(p)),
    'no zip is committed (they are release assets)'
);
check(
    !paths.some((p) => /tosu\.env$|\.values\.json$/.test(p)),
    'no tosu configuration or saved values were published'
);

/* the guard script must still be byte-exact: a CRLF rewrite would break the
   base64 embedded in the .bat files */
const guardOnDisk = fs.readFileSync(
    path.join(__dirname, '..', 'mma-guard', 'mma-visibility-guard.js'),
    'utf8'
);
const guardSize = blobs.find((b) => b.path === 'mma-guard/mma-visibility-guard.js');
if (guardSize) {
    check(
        guardSize.size === Buffer.byteLength(guardOnDisk, 'utf8'),
        'the published guard is byte-identical to the local one',
        guardSize.size + ' vs ' + Buffer.byteLength(guardOnDisk, 'utf8')
    );
}

/* ---- release ---- */
console.log('');
let release = null;
try {
    release = JSON.parse(gh(['api', 'repos/' + REPO + '/releases/latest']));
} catch (error) {
    check(false, 'a release exists');
}

if (release) {
    console.log('release    : ' + release.tag_name + '  "' + release.name + '"');
    console.log('assets     : ' + release.assets.length);
    console.log('');
    check(release.tag_name === 'v1.0.0', 'the tag is v1.0.0', release.tag_name);
    check(
        release.assets.length === 2,
        'the release has exactly two assets',
        String(release.assets.length)
    );

    const wanted = {};
    release.assets.forEach((asset) => {
        wanted[asset.name] = asset.size;
    });

    ['keyviewer_awa.zip', 'mma-card-fix.zip'].forEach((name) => {
        check(
            Object.prototype.hasOwnProperty.call(wanted, name),
            'the release carries ' + name,
            wanted[name] ? wanted[name] + ' bytes' : 'missing'
        );
    });

    /* compare with the local files so a stale upload is caught */
    release.assets.forEach((asset) => {
        const local = path.join(__dirname, '..', asset.name);
        if (!fs.existsSync(local)) return;
        check(
            fs.statSync(local).size === asset.size,
            asset.name + ' matches the local file',
            fs.statSync(local).size + ' vs ' + asset.size
        );
    });
}

console.log('');
console.log(failures === 0 ? 'everything checks out' : failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
