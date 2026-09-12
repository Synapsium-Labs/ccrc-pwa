// `deploy/gen-wrappers.mjs` — Task 5 of the stage-2c wrapper-generation plan.
//
// Drives the CLI as a subprocess, exactly as `gen-accounts.test.ts` does: a
// bare `node`, three path args, output read off stdout/stderr/exit code. Every
// fixture — the roster file, the "bin" directory, the staging directory — is
// built under `mkTmp` (an `os.tmpdir()` `mkdtemp`, never the real `$HOME`), so
// this file, like the CLI itself, never touches `$HOME/.local/bin` or
// `$HOME/.ccrc`. Nothing here reads `process.env.HOME`.
//
// The test default roster (`DEFAULT_TEST_ROSTER`, server/test/helpers.ts) is
// the fixture: 5 accounts — 1 upstream (`claude`), 3 generated (`claude-a`,
// `claude-b`, `claude-d`), 1 external (`gpt`). The 3 generated accounts are what gets
// staged; `expectedBody(id)` computes the exact text the CLI should produce
// for one of them, in-process, through the same `generateWrapperBody` +
// `markGenerated` pipeline the CLI itself composes — so a test asserting text
// equality is asserting agreement, not restating a golden literal.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync,
  statSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { mkTmp } from './tmpHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const CLI = path.join(ccrcRoot, 'deploy', 'gen-wrappers.mjs');

const fixtureJson: { accounts: Array<{ id: string; configDirSuffix: string; exec: { kind: string; secretsFile?: string } }> } =
  DEFAULT_TEST_ROSTER;
const UPSTREAM_ID = 'claude';
const GENERATED_IDS = ['claude-a', 'claude-b', 'claude-d'];

/** Runs the CLI exactly as Task 6's bash will: a bare `node`, three path
 *  args, nothing on stdin. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A fresh roster file plus an empty "bin" dir and an empty staging dir, none
 *  of them under the real $HOME — the whole fixture triple the CLI takes. */
function fixture(json: unknown): { rosterFile: string; binDir: string; stagingDir: string } {
  const rosterFile = path.join(mkTmp('ccrc-gen-wrappers-roster-'), 'accounts.json');
  writeFileSync(rosterFile, JSON.stringify(json, null, 2));
  const binDir = mkTmp('ccrc-gen-wrappers-bin-');
  const stagingDir = mkTmp('ccrc-gen-wrappers-staging-');
  return { rosterFile, binDir, stagingDir };
}

/** The exact marked text the CLI must produce for one of the test
 *  roster's generated accounts, computed the same way the CLI computes it —
 *  through the real emitter and the real marker, not a hand-typed literal. */
function expectedBody(id: string): string {
  const acct = fixtureJson.accounts.find((a) => a.id === id);
  if (!acct) throw new Error(`fixture bug: ${id} is not in the test roster`);
  return markGenerated(generateWrapperBody(
    { id: acct.id, configDirSuffix: acct.configDirSuffix, execKind: acct.exec.kind, secretsFile: acct.exec.secretsFile },
    UPSTREAM_ID,
  ));
}

describe('gen-wrappers.mjs', () => {
  it('a fresh box: 3 generated accounts are absent, each gets staged at mode 0755', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);

    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toBe('summary\t5\t3\t1\t1');
    const wrapperLines = lines.filter((l) => l.startsWith('wrapper\t'));
    const orphanLines = lines.filter((l) => l.startsWith('orphan\t'));
    expect(wrapperLines).toHaveLength(3);
    expect(orphanLines).toHaveLength(0);

    for (const line of wrapperLines) {
      const [, id, classify, equal] = line.split('\t');
      expect(GENERATED_IDS).toContain(id);
      expect(classify).toBe('absent');
      expect(equal).toBe('no');
    }
    for (const id of GENERATED_IDS) {
      const staged = path.join(stagingDir, id);
      expect(readFileSync(staged, 'utf8')).toBe(expectedBody(id));
      expect(statSync(staged).mode & 0o777).toBe(0o755);
    }
  });

  it('a converged box: pre-staged text on disk reads back ccrc-unmodified/yes for every account', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    for (const id of GENERATED_IDS) writeFileSync(path.join(binDir, id), expectedBody(id));
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const wrapperLines = r.stdout.trim().split('\n').filter((l) => l.startsWith('wrapper\t'));
    expect(wrapperLines).toHaveLength(3);
    for (const line of wrapperLines) {
      const [, , classify, equal] = line.split('\t');
      expect(classify).toBe('ccrc-unmodified');
      expect(equal).toBe('yes');
    }
  });

  it('a roster change: a marked wrapper generated for a DIFFERENT suffix reads back ccrc-unmodified/no', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const stale = markGenerated(generateWrapperBody(
      { id: 'claude-a', configDirSuffix: '.some-other-dir', execKind: 'generated' }, UPSTREAM_ID,
    ));
    writeFileSync(path.join(binDir, 'claude-a'), stale);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\tccrc-unmodified\tno');
  });

  it('a hand-edited ccrc file reads back ccrc-edited/no', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    writeFileSync(path.join(binDir, 'claude-a'), `${expectedBody('claude-a')}# a human added this line\n`);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\tccrc-edited\tno');
  });

  it('a hand-written file carrying no marker reads back foreign/no', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    writeFileSync(path.join(binDir, 'claude-a'), '#!/usr/bin/env bash\necho hi\n');
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\tforeign\tno');
  });

  // root reads anything, so a 0o000 file is not unreadable to it — this box's
  // suite always runs unprivileged, but the guard is cheap and matches the
  // idiom the rest of this suite already uses (config.test.ts, coord-token.test.ts, …).
  it.skipIf(process.getuid?.() === 0)('an unreadable file reads back unreadable/no', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const f = path.join(binDir, 'claude-a');
    writeFileSync(f, expectedBody('claude-a'));
    chmodSync(f, 0o000);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\tunreadable\tno');
  });

  // A directory is not a missing file — `classify` must not collapse the two.
  // `readFileSync` on a directory throws EISDIR, not ENOENT, so this exercises
  // the same absent-vs-unreadable branch as the chmod-0o000 case above, from a
  // different real-world shape (a stale directory left at a wrapper's path,
  // rather than a permission problem on a file).
  it('a directory at bin/<id> reads back unreadable/no, not absent — a directory is not a missing file', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    mkdirSync(path.join(binDir, 'claude-a'));
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\tunreadable\tno');
  });

  // D-81: a >512 MiB candidate used to reach `readFileSync` and THROW past
  // V8's string cap, landing in `unreadable` — whose remedy ("make it
  // readable") can never work on a file that is perfectly readable, just too
  // big to be a wrapper. `oversize` is the sixth classification, gated by a
  // cheap `statSync` before any read is attempted. The fixture is SPARSE
  // (`ftruncateSync` on an empty file) so the test costs no real disk: this
  // pins the classify() OUTCOME, not the "never read a candidate whole"
  // property — `bigblob` above already pins that one, for the orphan scan.
  it('an oversize file (over 1 MiB) reads back oversize/no, never unreadable (D-81)', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const p = path.join(binDir, 'claude-a');
    const fd = openSync(p, 'w');
    try {
      ftruncateSync(fd, 1024 * 1024 + 1); // OVERSIZE_BYTES + 1, sparse
    } finally {
      closeSync(fd);
    }
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\toversize\tno');
  });

  // Regression: nothing pinned this before D-81 touched the same catch
  // blocks. A dangling symlink's `statSync` throws ENOENT — exactly like a
  // missing file — so it must read back `absent`, not `unreadable` and not
  // `oversize`.
  it('a dangling symlink at bin/<id> reads back absent, not unreadable', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    symlinkSync(path.join(binDir, 'does-not-exist'), path.join(binDir, 'claude-a'));
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line).toBe('wrapper\tclaude-a\tabsent\tno');
  });

  // `equal` is a byte-for-byte comparison, not a trimmed one — a mutation
  // that computes `text.trim() === staged.trim()` passed every OTHER case in
  // this file (none of them differ from the staged text by whitespace alone)
  // and needed this one added to catch it.
  it('equal is byte-for-byte: a file differing from staged only by a trailing blank line is NOT equal', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    writeFileSync(path.join(binDir, 'claude-a'), `${expectedBody('claude-a')}\n`);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('wrapper\tclaude-a\t'));
    expect(line?.split('\t')[3]).toBe('no');
  });

  it('an orphan: a marked, generated-shape file with no roster entry is reported and left on disk', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const leftoverText = markGenerated(generateWrapperBody(
      { id: 'leftover', configDirSuffix: '.leftover', execKind: 'generated' }, UPSTREAM_ID,
    ));
    writeFileSync(path.join(binDir, 'leftover'), leftoverText);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('orphan\tleftover');
    expect(readFileSync(path.join(binDir, 'leftover'), 'utf8')).toBe(leftoverText);
  });

  it('not an orphan: an UNMARKED file produces no orphan record — ccrc only claims what it marked', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    writeFileSync(path.join(binDir, 'somethingelse'), '#!/usr/bin/env bash\necho hi\n');
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).not.toMatch(/^orphan\t/m);
  });

  it('not an orphan: a marked file at a PROTECTED (non-generated) account\'s id (D-83)', () => {
    // The exclusion set used to be `generatedIds` only, so a marked file
    // sitting at a `protected` account's id — upstream OR external — was
    // reported ORPHAN even though the roster claims that id. This is exactly
    // the shape `ccrc wrappers`'s own `ccrc-edited` remedy produces: it tells
    // an operator to "keep the edit by setting exec.kind to \"external\"",
    // and the very next run must not turn around and call that same id an
    // orphan with a remedy ("add an account ... to accounts.json") that is
    // doubly false — the roster already claims it, and adding it again would
    // be a duplicate-id error. `gpt` is the migration roster's `external`
    // account; the file left there still carries ccrc's marker from before
    // the operator's edit — the exact state `ccrc-edited` -> "set external"
    // leaves on disk.
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const externalText = markGenerated(generateWrapperBody(
      { id: 'gpt', configDirSuffix: '.gpt', execKind: 'generated' }, UPSTREAM_ID,
    ));
    writeFileSync(path.join(binDir, 'gpt'), externalText);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).not.toMatch(/^orphan\tgpt$/m);
    expect(r.stdout).toContain('protected\tgpt');
  });

  it('not an orphan: ccrc\'s OWN executables, which the installer puts in the same dir (D-93)', () => {
    // MEASURED, on the fixture and on any installed box: `ccrc install` puts
    // `ccd`, `ccd-cap-scopes`, `ccd-graph-sweep` (graphify Task 10, O3/O6b —
    // the "day one of them installs a fourth thing" the production comment
    // anticipated) and the `ccrc` launcher into the very directory this scan
    // walks, and `ccd` passes every clause of the orphan predicate — regular
    // file, id-shaped, claimed by no account, `#!`-headed, and CARRYING A
    // CCRC MARKER. The marker is deliberate provenance (41bdf60, gated by
    // ownership.test.ts:139-153, so that ccrc's own shipped `ccd` reads
    // `ccrc-unmodified` and the installer may replace it on a box), so the fix
    // cannot be to remove it: the scan has to know these six are ccrc's own
    // toolchain rather than candidate account wrappers.
    //
    // What the operator saw without this: `ORPHAN ccd: … remedy: … or remove
    // $HOME/.local/bin/ccd by hand` — printed by every install, four lines
    // above that same transcript's "next: add your first session with: ccd
    // menu".
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    // Marked the way the real ones are. `ccd`'s marker is over its own bytes;
    // any marked script is the same five-for-five shape as far as this scan is
    // concerned, and using the real 570 KB `ccd` here would test file size.
    for (const name of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-account-health', 'ccd-telemetry-keepalive']) {
      writeFileSync(path.join(binDir, name),
        markGenerated(`#!/usr/bin/env bash\n# ccrc's own ${name}, installed by ccrc install\nexit 0\n`));
    }
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    for (const name of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-account-health', 'ccd-telemetry-keepalive']) {
      expect(r.stdout, `${name} was reported as an account wrapper nobody claims`)
        .not.toMatch(new RegExp(`^orphan\\t${name}$`, 'm'));
    }
    // …and the exclusion did NOT widen into "nothing is an orphan any more":
    // a real leftover beside them is still reported.
    writeFileSync(path.join(binDir, 'leftover'), markGenerated(generateWrapperBody(
      { id: 'leftover', configDirSuffix: '.leftover', execKind: 'generated' }, UPSTREAM_ID,
    )));
    const r2 = run([rosterFile, binDir, stagingDir]);
    expect(r2.stdout).toMatch(/^orphan\tleftover$/m);
    // Nor did it touch the files: this scan removes nothing, ever.
    expect(existsSync(path.join(binDir, 'ccd'))).toBe(true);
  });

  // The reference box has exactly this shape (`gpt -> ccgpt`), so it is not
  // hypothetical. `readdirSync`'s `Dirent.isFile()` answers about the DIRENT
  // ITSELF — it is false for a symlink no matter what the symlink points to —
  // so the orphan scan's `entry.isFile()` gate never even looks at a
  // symlink's target. This pins the MEASURED behaviour: a marked file is
  // invisible to orphan detection when it is only reachable by following a
  // symlink, while a marked file living at its own name is still caught.
  // Whether that is the behaviour a future author WANTS is a separate
  // question from whether it is the behaviour today — this test is about the
  // second one.
  it('a symlink in the bin dir is invisible to orphan detection, even when it targets marked text', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    // Not `ID_RE`-shaped (leading underscore), so its own name could never be
    // an orphan candidate either — isolating this case to the symlink
    // question alone.
    const markedTarget = path.join(binDir, '_marked-target-not-an-id');
    writeFileSync(markedTarget, markGenerated(generateWrapperBody(
      { id: 'linkacct', configDirSuffix: '.linkacct', execKind: 'generated' }, UPSTREAM_ID,
    )));
    symlinkSync(markedTarget, path.join(binDir, 'linkacct'));
    // A genuine, separately-named marked regular file — confirms ordinary
    // orphan detection still works with the symlink merely present.
    writeFileSync(path.join(binDir, 'stillorphan'), markGenerated(generateWrapperBody(
      { id: 'stillorphan', configDirSuffix: '.stillorphan', execKind: 'generated' }, UPSTREAM_ID,
    )));
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).not.toMatch(/^orphan\tlinkacct$/m);
    expect(r.stdout).toMatch(/^orphan\tstillorphan$/m);
  });

  it('never reads a non-script candidate whole — a 256 MiB blob in the bin dir costs two bytes', () => {
    // `~/.local/bin/claude` is the ~304 MB Claude Code binary. On the reference
    // box it happens to be a SYMLINK, so `isFile()` skipped it and nobody
    // noticed; where it is a regular file, the orphan scan used to pull the
    // whole thing into a JS string — on the box `ccrc wrappers` runs as an
    // INSTALLER, with the fleet live. `ccd/ccrc-wrapper-shape:48-57` states the
    // rule ("never read a candidate whole") and implements it in two bytes;
    // this is the same rule on this side of the language boundary.
    //
    // The file is SPARSE — one byte written at a high offset — so making it
    // costs nothing while reading it whole costs a quarter-gigabyte string.
    //
    // THIS CASE IS THE SCENARIO, NOT THE PIN, and saying which is which matters
    // more than the case does. Measured with the gate removed: the same run
    // finishes in 0.75 s (the page cache serves a sparse file's zeroes almost
    // free) and still exits 0, and capping the child's heap at 128 MiB does not
    // abort it either — V8 allocates the string anyway. So there is no cheap,
    // deterministic, SIZE-based assertion available here; a time bound tight
    // enough to discriminate would be a flake on a loaded box. The pin for this
    // gate is the `no shebang` case below, which is behavioural and exact. What
    // this case buys is the regression the reviewer asked for by name: the
    // 304 MB upstream binary sitting in the bin dir as a regular file must not
    // make `ccrc wrappers` fall over, and it must not become an orphan record.
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const blob = path.join(binDir, 'bigblob');
    const fd = openSync(blob, 'w');
    try {
      writeSync(fd, Buffer.from([0x7f]), 0, 1, 256 * 1024 * 1024);
    } finally {
      closeSync(fd);
    }
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).not.toMatch(/^orphan\tbigblob$/m);
    // The three real accounts are still classified: a blob in the directory
    // does not cost the scan its answer.
    expect(r.stdout.split('\n').filter((l) => l.startsWith('wrapper\t'))).toHaveLength(3);
  }, 30_000);

  it('a marked file with no shebang is not an orphan — the two-byte gate is the only reader', () => {
    // The behavioural half of the gate, with no timing in it. `markGenerated`
    // puts the marker on line 1 when there is no shebang, so this file's own
    // `verifyMarker` says `ccrc-unmodified` — and it is STILL not an orphan,
    // because nothing this pipeline writes into the bin dir lacks a shebang
    // (`generateWrapperBody` always emits one), so a file that does was not
    // ccrc's to claim. Remove the gate and this file becomes an orphan record.
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    writeFileSync(path.join(binDir, 'noshebang'), markGenerated('echo not a script\n'));
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).not.toMatch(/^orphan\tnoshebang$/m);
  });

  it('names every non-generated account in a `protected` record (D-80)', () => {
    // The record exists so that "this id is an account ccrc must not touch" and
    // "this id is not in the roster at all" stop being the same thing on the
    // wire — see this file's header and `cmd_wrappers`'s. Walked out of
    // `roster.accounts` independently of the `wrapper` filter, so a bug in one
    // does not corrupt both identically.
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const protectedLines = r.stdout.trim().split('\n').filter((l) => l.startsWith('protected\t'));
    expect(protectedLines).toEqual(['protected\tclaude', 'protected\tgpt']);
    // And the count the bash reader asserts against holds: upstream + external.
    const summary = (r.stdout.split('\n')[0] ?? '').split('\t');
    expect(protectedLines).toHaveLength(Number(summary[3]) + Number(summary[4]));
    // No generated account is ever in that list — the two are disjoint, and an
    // overlap is what `ccrc wrappers` refuses the whole run over.
    for (const id of GENERATED_IDS) expect(r.stdout).not.toContain(`protected\t${id}`);
  });

  it('upstream and external accounts are never staged', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const staged = new Set(readdirSync(stagingDir));
    expect(staged).toEqual(new Set(GENERATED_IDS));
  });

  it('an invalid roster (two upstream accounts): exit 1, empty stdout, a remedy on stderr', () => {
    const twoUpstream = {
      version: 1,
      accounts: [
        { id: 'claude', label: 'Claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'claude-a', label: 'Claude2', configDirSuffix: '.claude-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
      ],
    };
    const { rosterFile, binDir, stagingDir } = fixture(twoUpstream);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('upstream');
    expect(r.stderr).toContain('remedy:');
  });

  it.skipIf(process.getuid?.() === 0)('an unwritable staging dir: exit 1, empty stdout', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    chmodSync(stagingDir, 0o555);
    try {
      const r = run([rosterFile, binDir, stagingDir]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
    } finally {
      chmodSync(stagingDir, 0o755);
    }
  });

  it('usage: no args or four args exits 2, with no stdout', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    for (const args of [[], [rosterFile, binDir, stagingDir, 'extra']]) {
      const r = run(args);
      expect(r.code, JSON.stringify(args)).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('usage:');
    }
  });

  it('the manifest has no empty fields — the property that makes IFS=$\'\\t\' read safe in Task 6', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const field of line.split('\t')) {
        expect(field.length, `empty field in line: ${line}`).toBeGreaterThan(0);
      }
    }
  });

  it('a control byte in a roster id cannot reach the manifest — rosterFromJson rejects it first', () => {
    const bad = {
      version: 1,
      accounts: [
        // The escape sequence below is a control byte IN THE STRING, written
        // as a JS escape in this source file — never a raw byte on disk
        // (source-bytes.test.ts bans that).
        { id: 'cla\u0001ude', label: 'Claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      ],
    };
    const { rosterFile, binDir, stagingDir } = fixture(bad);
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
  });
});

// THE MANIFEST'S ARITY, which the non-empty-field test above does not cover.
// The grammar is `deploy/gen-wrappers.mjs`'s own header — the four record
// lines are :43-46, under the `THE MANIFEST GRAMMAR (plan D6)` banner at :40:
//   summary\t<total>\t<generated>\t<upstream>\t<external>
//   wrapper\t<id>\t<classify>\t<equal>
//   protected\t<id>
//   orphan\t<id>
describe('the manifest grammar cannot grow a column in silence', () => {
  const ARITY: Readonly<Record<string, number>> = {
    summary: 5, wrapper: 4, protected: 2, orphan: 2,
  };

  it('every record has exactly the field count its grammar declares', () => {
    const { rosterFile, binDir, stagingDir } = fixture(fixtureJson);
    // Writes exactly ONE extra file — a marked orphan — not a foreign one. The
    // other three record types need no help to appear: `DEFAULT_TEST_ROSTER`
    // already carries 3 generated + 1 upstream + 1 external, so a plain run of
    // this fixture already emits `summary`, `wrapper` and `protected` records;
    // the only record type this write adds is `orphan`, which is why it is
    // here — a scan that never sees an `orphan` line asserts nothing about it.
    // A foreign file could not contribute a record even if one were added:
    // `foreign` is a `<classify>` VALUE carried inside a `wrapper` record, not
    // a manifest record type of its own, and `deploy/gen-wrappers.mjs:366`
    // (`if (verifyMarker(text) === 'foreign') continue;`) drops foreign files
    // from the orphan scan before they could become one anyway.
    writeFileSync(path.join(binDir, 'leftover'), markGenerated(generateWrapperBody(
      { id: 'leftover', configDirSuffix: '.leftover', execKind: 'generated' }, UPSTREAM_ID)), { mode: 0o755 });
    const r = run([rosterFile, binDir, stagingDir]);
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    const lines = r.stdout.trim().split('\n');
    const seen = new Set<string>();
    for (const line of lines) {
      const fields = line.split('\t');
      const kind = fields[0]!;
      expect(ARITY, `unknown record type "${kind}" — add it to ARITY and to ccd/ccrc's reader`)
        .toHaveProperty(kind);
      expect(fields.length, `record type "${kind}" carries ${fields.length} fields: ${line}`)
        .toBe(ARITY[kind]);
      seen.add(kind);
    }
    // All four types were exercised, so no arity above went unchecked.
    expect([...seen].sort()).toEqual(['orphan', 'protected', 'summary', 'wrapper']);
  });

  it('the reader in ccd/ccrc takes at least as many variables as the widest record', () => {
    // Producer and consumer, in one assertion. `ccd/ccrc`'s manifest loop reads
    // `local kind a b c d` — five names for a five-field `summary` — and its own
    // comment (`ccd/ccrc:2386-2389`) says why five and not four.
    //
    // A field with no variable left to hold it is NOT discarded — `IFS=$'\t'
    // read` never drops a field. It is CONCATENATED onto the last variable,
    // tab included: measured, `IFS=$'\t' read -r kind a b c d` over
    // `summary\t5\t3\t1\t1\tSIXTH` leaves `d` holding `1<TAB>SIXTH`, not `1`.
    // That is exactly the corruption `ccd/ccrc:2386-2389` itself names ("the
    // record-count assertion below would then be comparing against a string
    // that is not a number") — restated here from a real `bash -c` run, not
    // copied off the comment. "Discards" IS the right word for a narrower
    // case: a FIFTH field on a four-field `wrapper` record lands whole in `d`,
    // and the `wrapper)` case arm below never reads `d`, so that one really is
    // silently ignored. A field past every declared variable does something
    // worse than either: it corrupts its neighbour instead of vanishing.
    //
    // This guard checks agreement between TWO lines, not just that a
    // declaration exists: `ccd/ccrc:2390`'s `local kind a b c d` and
    // `ccd/ccrc:2393`'s `while IFS=$'\t' read -r kind a b c d; do` are
    // independent pieces of bash syntax that happen to list the same names
    // today — nothing enforces that they stay in sync. Narrowing the READ
    // list alone (`read -r kind a b c` while the `local` line still says
    // `a b c d`) is the exact hazard above, and a regex that only looks at the
    // `local` declaration cannot see it: measured, that was this test before
    // this fix, and it stayed GREEN under that mutation.
    const ccrc = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');

    // Widened past `[a-z ]+` (Minor 1): a benign future rename to `f1`/`rec_a`,
    // or a trailing `# comment` on either line, must not red this suite. Both
    // patterns are checked for a SINGLE match in `ccd/ccrc` below, so a second,
    // unrelated `local kind …` line earlier in the file can't silently steal
    // the measurement.
    const DECL_RE = /^\s*local kind ([A-Za-z0-9_ ]+?)\s*(?:#.*)?$/m;
    const READ_RE = /^\s*while IFS=\$'\\t' read -r kind ([A-Za-z0-9_ ]+?);\s*do\s*$/m;

    const declMatches = [...ccrc.matchAll(new RegExp(DECL_RE.source, 'gm'))];
    expect(declMatches, 'ccd/ccrc must declare the manifest reader exactly once, as `local kind a b c d`')
      .toHaveLength(1);
    const readMatches = [...ccrc.matchAll(new RegExp(READ_RE.source, 'gm'))];
    expect(readMatches, "ccd/ccrc must read the manifest exactly once, as `while IFS=$'\\t' read -r kind a b c d; do`")
      .toHaveLength(1);

    const declVars = declMatches[0]![1]!.trim().split(/\s+/);
    const readVars = readMatches[0]![1]!.trim().split(/\s+/);
    expect(
      readVars,
      `the read line's variables (${readVars.join(' ')}) must match the declaration's (${declVars.join(' ')}) — ` +
        'a narrower read silently corrupts the last field instead of erroring',
    ).toEqual(declVars);

    expect(readVars.length + 1).toBeGreaterThanOrEqual(Math.max(...Object.values(ARITY)));
  });

  it('the collapse this arity guards against is real, in bash, right now', () => {
    // MEASURED rather than asserted. `deploy/gen-wrappers.mjs:77-90` and
    // `ccd/ccrc:2367-2384` both argue from this behaviour (plan D-71); a guard
    // whose reason lives only in prose is a guard nobody can check.
    //
    // THE ROW BELOW IS A WRAPPER-SHAPE RECORD, not a manifest record — its
    // first four fields are `ok\tclaude\t.claude-plain\t""`, i.e.
    // `_wrap_parse_shape`'s own `ok\ttarget\tsuffix\tsecrets` grammar
    // (`ccd/ccrc-wrapper-shape`'s `printf 'ok\t%s\t%s\t%s\n' "$target"
    // "$suffix" "$secrets"`), not any of the four rows this `describe` block's
    // header names — `openrouter` is a fifth field tacked on past that grammar
    // purely so the empty `secrets` field has something after it to collapse
    // INTO, which is the point being demonstrated. That is deliberate, not a
    // copy-paste of the wrong fixture: `wrapper-roundtrip.test.ts:21` already
    // reads this same four-field shape with `String.prototype.split`, so
    // reusing it gives this file a genuine SECOND witness instead of inventing
    // a row nothing else corroborates — and the bash collapse being
    // demonstrated (`IFS=$'\t' read` swallowing an empty field between two
    // tabs) is generic to any tab-separated record, manifest or not, so a
    // wrapper-shape row proves the same hazard just as well. Do not change the
    // row to a manifest shape — that would break the cross-reference above.
    //
    // THE ROW IS BUILT IN JS AND PASSED AS AN ARGUMENT, not written into the
    // snippet as an escape. A here-string spelled `<<< "ok\tclaude\t…"` inside
    // a JS template literal reaches bash as `<<< "ok\tclaude\t…"` with a
    // BACKSLASH-t, because a double-quoted here-string does not interpret `\t`
    // — measured 2026-09-07, that spelling prints
    // `ok\tclaude\t.claude-plain\t\topenrouter||||`, i.e. one field and four
    // empties, which is not the collapse and would pin nothing. `$'…'` would
    // fix it; passing the row through `$1` removes the question, and lets the
    // JS assertion below run over the SAME string rather than a transcription
    // of it.
    const row = ['ok', 'claude', '.claude-plain', '', 'openrouter'].join('\t');
    const out = spawnSync('bash', [
      '-c',
      `IFS=$'\\t' read -r a b c d e <<< "$1"; printf '%s|%s|%s|%s|%s' "$a" "$b" "$c" "$d" "$e"`,
      'bash', row,
    ], { encoding: 'utf8' });
    expect(out.status, out.stderr).toBe(0);
    // The 4th field was EMPTY; `openrouter` landed in it and the 5th is gone.
    expect(out.stdout).toBe('ok|claude|.claude-plain|openrouter|');
    // …and JS `split` does NOT collapse — same string, five elements, the empty
    // one intact. That is why `wrapper-roundtrip.test.ts:21`, which reads the
    // same record shape with `String.prototype.split`, is NOT a second witness
    // to this hazard.
    expect(row.split('\t')).toEqual(['ok', 'claude', '.claude-plain', '', 'openrouter']);
  });
});
