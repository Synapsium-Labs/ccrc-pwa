// Spec §11's audit table for versioned installs, WALKED — W6 Task 7.
//
// W6 turns `~/ccrc` from a directory into a LINK, `~/ccrc ->
// ~/ccrc-versions/<name>`, and spec §11 measured (2026-09-20) which of the
// tree's path contracts a link satisfies unchanged. This file turns each
// "satisfied" verdict into a case that runs or reads the real file through a
// fixture HOME laid out exactly as W6 leaves a box: `v9.9.1` placed and
// linked, `v9.9.0` placed beside it. A verdict that stops holding is a red
// here, not a sentence in a design nobody re-reads.
//
// The table's three "must change" rows are NOT here — they are W6's own
// tasks (the rsync target and the self-copy guard, Task 2; uninstall's sweep,
// Task 6). `deploy.sh`'s row is untouched by decision. The one row the spec
// left OPEN, the agent whitelist, is settled here (row 8).
//
// ONE BOX PER CASE. Row 1 plants an `exit 0` sentinel in `v9.9.1`'s own
// `ccd/ccrc`; a shared box would end every later `source` of that file at its
// second line.
//
// Containment: `ghContainedEnv`'s poisoned `gh` at the head of PATH, every
// `CCRC_*` input deleted by name, HOME a `mkTmp` fixture. Nothing here runs a
// verb that installs, updates or touches a unit.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';
import { installVersionedTree } from './installTreeFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');

/** A W6 box: `v9.9.1` placed and LINKED, `v9.9.0` placed beside it. `mkTmp`
 *  resolves its directory, so `home` is already a physical path and a
 *  `realpathSync` through the link answers `<home>/ccrc-versions/…` exactly. */
function auditBox(prefix: string): { home: string; v1: string; v0: string } {
  const home = mkTmp(prefix);
  const v1 = installVersionedTree(home, 'v9.9.1');
  const v0 = installVersionedTree(home, 'v9.9.0', { link: false });
  return { home, v1, v0 };
}

function auditEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
  // Each of these changes what Node reports as a module's own path — the
  // subject of row 6 — so none may leak in from the runner.
  for (const k of ['NODE_OPTIONS', 'NODE_PRESERVE_SYMLINKS', 'NODE_PRESERVE_SYMLINKS_MAIN']) delete env[k];
  return env;
}

/** A bash snippet; `$1`… are its arguments. `set --` before any `source`, so
 *  the sourced file never sees the snippet's own arguments as its `$@`. */
function sh(home: string, script: string, args: string[] = []) {
  const r = spawnSync(BASH, ['-c', script, '--', ...args], { env: auditEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Every file under `d` whose name `keep` admits, skipping the named
 *  directories. A function declaration, not a self-referencing const, so the
 *  recursion needs no inferred type (`typecheck-tests.test.ts` compiles this
 *  file under `strict`). */
function walk(d: string, keep: (name: string) => boolean, skip: string[]): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return skip.includes(e.name) ? [] : walk(p, keep, skip);
    return keep(e.name) ? [p] : [];
  });
}

describe('spec §11 audit — the satisfied rows, walked through a symlinked ~/ccrc (W6 Task 7)', () => {
  it('row 1, the launcher: _inst_shim\'s bytes exec $HOME/ccrc/ccd/ccrc through the link, and what runs is the pointed-at version\'s copy', () => {
    const { home, v1, v0 } = auditBox('ccrc-audit-shim-');
    // The sentinel, in v9.9.1's copy ONLY, as its second line: if the link
    // pointed anywhere else, the real `ccrc version` would run instead and
    // print no sentinel.
    const planted = join(v1, 'ccd', 'ccrc');
    const lines = readFileSync(planted, 'utf8').split('\n');
    lines.splice(1, 0, 'printf \'audit-sentinel v9.9.1 %s\\n\' "$0"; exit 0');
    writeFileSync(planted, lines.join('\n'));
    const shim = join(home, '.local', 'bin', 'ccrc');
    mkdirSync(dirname(shim), { recursive: true });
    const gen = sh(home, 'f=$1; out=$2; set --; source "$f"; _inst_shim > "$out"', [CCRC, shim]);
    expect(gen.code, gen.stderr).toBe(0);
    chmodSync(shim, 0o755);
    expect(readFileSync(shim, 'utf8')).toContain('CCRC_SHIPPED="$HOME/ccrc/ccd/ccrc"\n');
    const r = spawnSync(shim, ['version'], { env: auditEnv(home), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`audit-sentinel v9.9.1 ${home}/ccrc/ccd/ccrc\n`);
    expect(readFileSync(join(v0, 'ccd', 'ccrc'), 'utf8'), 'v9.9.0\'s copy was touched').toBe(readFileSync(CCRC, 'utf8'));
  });

  it('row 2, CCRC_HERE: the plain pwd keeps the link — a ccrc reached through $HOME/ccrc answers $HOME/ccrc/ccd, never the version path', () => {
    const { home } = auditBox('ccrc-audit-here-');
    // Sourcing hands `CCRC_HERE`'s three-line idiom (`ccd/ccrc:1098-1100`)
    // exactly the `${BASH_SOURCE[0]}` that `bash $HOME/ccrc/ccd/ccrc` does;
    // the file's source guard keeps its dispatch from running.
    const r = sh(home, 'f=$1; set --; source "$f"; printf \'%s\\n\' "$CCRC_HERE"', [join(home, 'ccrc', 'ccd', 'ccrc')]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${join(home, 'ccrc', 'ccd')}\n`);
  });

  it('row 3, _dr_pkg_candidates: the plain pwd keeps the link — both package.json candidates are $HOME/ccrc paths, and they are v9.9.1\'s files', () => {
    const { home, v1 } = auditBox('ccrc-audit-pkg-');
    const r = sh(home,
      'CCRC_HERE=$1; set --; set -uo pipefail; . "$CCRC_HERE/ccrc-doctor-checks"; _dr_pkg_candidates',
      [join(home, 'ccrc', 'ccd')]);
    expect(r.code, r.stderr).toBe(0);
    const got = r.stdout.split('\n').filter((l) => l !== '');
    expect(got).toEqual([join(home, 'ccrc', 'server', 'package.json'), join(home, 'ccrc', 'agent', 'package.json')]);
    expect(got.map((p) => realpathSync(p))).toEqual([join(v1, 'server', 'package.json'), join(v1, 'agent', 'package.json')]);
  });

  it('row 4, the units: every %h/ccrc/… token a shipped unit names resolves through the link into v9.9.1; the session unit names no tree', () => {
    // D-3454: the table names two ExecStart
    // lines; the walk takes EVERY tree token in every unit and drop-in, so a
    // unit written after the table (wave 4's watchdog, whose ExecCondition=
    // greps %h/ccrc/ccd/ccrc) is walked too, and a future one cannot be
    // missed.
    const { home, v1 } = auditBox('ccrc-audit-units-');
    const units = [
      ...walk(join(REPO, 'deploy'), (n) => /\.(service|timer|conf)$/.test(n), ['node_modules']),
      ...walk(join(REPO, 'ccd'), (n) => /\.(service|timer|conf)$/.test(n), ['node_modules']),
    ];
    const tokens: Array<{ at: string; token: string }> = [];
    for (const f of units) {
      for (const l of readFileSync(f, 'utf8').split('\n')) {
        if (/^\s*#/.test(l)) continue;
        for (const m of l.matchAll(/%h\/ccrc\/[^\s'"]+/g)) tokens.push({ at: path.relative(REPO, f), token: m[0] });
      }
    }
    const named = tokens.map((t) => `${t.at}: ${t.token}`);
    expect(named).toContain('deploy/ccrc.service: %h/ccrc/server/dist/server/src/index.js');
    expect(named).toContain('deploy/ccrc-agent.service: %h/ccrc/agent/dist/agent/src/index.js');
    // Wave 4 Task 9's watchdog guard, the token the table predates.
    expect(named).toContain('deploy/systemd/ccrc-update-watchdog.service: %h/ccrc/ccd/ccrc');
    for (const { at, token } of tokens) {
      const onBox = token.replace('%h', home);
      expect(existsSync(onBox),
        `${at} names ${token}, which the fixture version lacks — add it to installTreeFixture.ts and re-walk this row`).toBe(true);
      expect(realpathSync(onBox), `${at}: ${token}`).toBe(join(v1, token.slice('%h/ccrc/'.length)));
    }
    const read = (rel: string): string[] => readFileSync(join(REPO, rel), 'utf8').split('\n');
    expect(read('deploy/ccrc.service')).toContain('ExecStart=/usr/bin/env node %h/ccrc/server/dist/server/src/index.js');
    expect(read('deploy/ccrc-agent.service')).toContain('ExecStart=/usr/bin/env node %h/ccrc/agent/dist/agent/src/index.js');
    const session = read('ccd/claude-session@.service');
    expect(session).toContain('ExecStart=%h/.local/bin/ccd supervise %i');
    expect(session.filter((l) => /%h\/ccrc(?![\w-])/.test(l))).toEqual([]);
  });

  it('row 5, the Darwin plist: _inst_plist_server bakes $HOME/ccrc/server/dist/… into ProgramArguments, unchanged, and it resolves into v9.9.1', () => {
    const { home, v1 } = auditBox('ccrc-audit-plist-');
    const r = sh(home,
      'f=$1; set --; source "$f"; CCD_OS=darwin; _inst_plist_server app.ccrc.ccrc "$HOME/.ccrc/logs/app.ccrc.ccrc.log"',
      [CCRC]);
    expect(r.code, r.stderr).toBe(0);
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(r.stdout);
    expect(args, 'the plist has no ProgramArguments array').not.toBeNull();
    const entry = `${home}/ccrc/server/dist/server/src/index.js`;
    expect(args![1]).toContain(`exec /usr/bin/env node '${entry}'`);
    expect(r.stdout).not.toContain('ccrc-versions');
    expect(realpathSync(entry)).toBe(join(v1, 'server', 'dist', 'server', 'src', 'index.js'));
  });

  it('row 6, findPwaRoot: its body names no ccrc literal, and Node hands it the REAL path — the walk lands in v9.9.1\'s dist-pwa', () => {
    const { home, v1 } = auditBox('ccrc-audit-pwa-');
    const src = readFileSync(join(REPO, 'server', 'src', 'server.ts'), 'utf8');
    const m = /^function findPwaRoot\(\): string \| null \{\n[\s\S]*?\n\}\n/m.exec(src);
    expect(m, 'server.ts has no findPwaRoot() in the shape this row read — re-measure the row').not.toBeNull();
    const body = m![0];
    expect(body).toContain('path.dirname(fileURLToPath(import.meta.url))');
    expect(body).not.toMatch(/ccrc/);
    // The walk itself, run where the built server runs (beside
    // dist/server/src/index.js), reached through the link. Its ONE type
    // annotation is stripped; nothing else in the body is TypeScript.
    const probe = join(v1, 'server', 'dist', 'server', 'src', 'audit-probe.mjs');
    writeFileSync(probe, [
      "import path from 'node:path';",
      "import { existsSync } from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      body.replace('function findPwaRoot(): string | null {', 'function findPwaRoot() {'),
      'console.log(fileURLToPath(import.meta.url));',
      'console.log(findPwaRoot());',
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(home, 'ccrc', 'server', 'dist', 'server', 'src', 'audit-probe.mjs')],
      { env: auditEnv(home), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${probe}\n${join(v1, 'server', 'dist-pwa')}\n`);
  });

  it('row 7, ccd-usage-sweep defaults CCRC_TREE to the plain $HOME/ccrc, and ccd/ccd names the tree on no line of code', () => {
    const TREE_REF = /(\$HOME|\$\{HOME\}|~|%h)\/ccrc(?![\w-])|ccrc-versions/;
    // Controls: the pattern sees the one reference it must, and neither
    // sibling that is not the tree.
    expect(TREE_REF.test(': "${CCRC_TREE:=$HOME/ccrc}"')).toBe(true);
    expect(TREE_REF.test('BOX_BACKUP_ROOT="$HOME/ccrc-backups"')).toBe(false);
    expect(TREE_REF.test('ACCOUNTS_SH="$HOME/.ccrc/accounts.sh"')).toBe(false);
    const sweep = readFileSync(join(REPO, 'ccd', 'ccd-usage-sweep'), 'utf8').split('\n');
    expect(sweep).toContain(': "${CCRC_TREE:=$HOME/ccrc}"');
    // CODE lines only: W6 Task 1's platform helper is byte-identical in both
    // files, and its header comment names the spec's own `$HOME/ccrc.new`.
    const code = readFileSync(CCD, 'utf8').split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => !/^\s*#/.test(l));
    expect(code.length).toBeGreaterThan(1000);
    expect(code.filter(({ l }) => TREE_REF.test(l)).map(({ n, l }) => `ccd/ccd:${n}: ${l.trim()}`)).toEqual([]);
  });

  it('row 8, the agent whitelist (the audit\'s OPEN row, settled): canonicalised from $HOME and the projects root, never the tree — a flip does not move them', () => {
    const wl = readFileSync(join(REPO, 'agent', 'src', 'whitelist.ts'), 'utf8');
    const iface = /^export interface WhitelistConfig \{([^}]*)\}$/m.exec(wl);
    expect(iface, 'whitelist.ts no longer declares WhitelistConfig on one line — re-measure this row').not.toBeNull();
    expect(iface![1]!.trim()).toBe('home: string; projectsRoot: string');
    // WHERE they are canonicalised — the question the spec left open.
    expect(wl).toContain('    canonicalize(cfg.home),\n    canonicalize(cfg.projectsRoot),\n');
    const agent = readFileSync(join(REPO, 'agent', 'src', 'server.ts'), 'utf8');
    expect(agent).toContain('cfg: { home: opts.home, projectsRoot: opts.projectsRoot },');
    expect(agent).toContain('    home: rawOpts.home ?? os.homedir(),\n    projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),\n');
    const rp = /^export function resolveProjectsRoot\([\s\S]*?\n\}\n/m.exec(agent);
    expect(rp, 'agent/src/server.ts has no resolveProjectsRoot — re-measure this row').not.toBeNull();
    expect(rp![0]).toContain("path.join(os.homedir(), 'projects')");
    expect(rp![0]).not.toMatch(/ccrc/);
  });

  it('row 9, the rule for W6: no shipped code compares import.meta.url (or a realpath) with the tree\'s own name', () => {
    // A line is a CANDIDATE when it touches either mechanism, and an OFFENDER
    // when it also carries a tree literal: a `ccrc` path segment delimited
    // on both sides, or the versions root. The literal is required because
    // of the one look-alike, `ccd/compact-card.mjs:749`: it compares
    // `import.meta.url` with a realpath, but that realpath is its own
    // `process.argv[1]` (the is-main-module check), never the tree. `'.ccrc'`
    // is the config directory, which is why the segment must be delimited.
    const TREE_LITERAL = /['"`/]ccrc['"`/]|ccrc-versions/;
    const CANDIDATE = /import\.meta\.url|realpath/;
    const files = ['server/src', 'agent/src', 'shared', 'ccd'].flatMap((r) => walk(join(REPO, r),
      (n) => /\.(ts|mjs|js)$/.test(n) && !n.endsWith('.test.ts'), ['node_modules', 'test', 'dist']));
    const candidates = new Set<string>();
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (!CANDIDATE.test(l)) return;
        candidates.add(path.relative(REPO, f));
        if (TREE_LITERAL.test(l)) offenders.push(`${path.relative(REPO, f)}:${i + 1}: ${l.trim()}`);
      });
    }
    // A scan over nothing passes everything.
    expect([...candidates]).toEqual(expect.arrayContaining(['server/src/server.ts', 'ccd/compact-card.mjs', 'agent/src/whitelist.ts']));
    expect(offenders).toEqual([]);
  });

  it('the fixture is the W6 layout the rows claim — ~/ccrc is a link, both versions are real directories', () => {
    const { home, v1, v0 } = auditBox('ccrc-audit-layout-');
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(home, 'ccrc'))).toBe(v1);
    for (const v of [v1, v0]) expect(lstatSync(v).isDirectory(), v).toBe(true);
  });
});
