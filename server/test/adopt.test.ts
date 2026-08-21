// ccd/ccrc-adopt — Task 11 of the stage-2a roster-becomes-data plan, and the
// last one. Every other task made the roster the single source of truth for
// an account's shape (shared/roster.ts, Tasks 2-10); this one bootstraps
// that file on a box that was hand-built before it existed — every account
// wrapper was `touch`/`vi`'d directly into $HOME/.local/bin, long before
// anyone wrote a generator.
//
// These fixtures mirror what was actually measured on the real fleet host
// (see the task-11 report): a non-script upstream binary, three
// generated-shape scripts (two carrying a secrets-sourcing guard, one
// without), and one bespoke external launcher that sets CLAUDE_CONFIG_DIR
// but is nothing like the generated template. The real box additionally
// carries a `gpt -> ccgpt` symlink alias and several `<name>.bak-<date>`
// backups from `ccd`'s own history; both get dedicated coverage below
// because both are real failure modes measured on disk, not hypothetical.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoster, RosterError, type Roster } from '../../shared/roster.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADOPT = path.resolve(here, '..', '..', 'ccd', 'ccrc-adopt');

interface Result { code: number; stdout: string; stderr: string }

/** Runs the CLI exactly as an operator does: `bash ccd/ccrc-adopt`, HOME
 *  pointed at a throwaway fixture. Never throws on a nonzero exit — several
 *  tests below exercise the refusal paths (clobber, ambiguous upstream) and
 *  need the exit code and stderr as data, not as a thrown Error. */
function runAdoptRaw(home: string, args: string[] = []): Result {
  const r = spawnSync('bash', [ADOPT, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The brief's own shape: returns stdout, throwing (with stderr attached) on
 *  a nonzero exit — for the tests that only care about the happy path. */
function runAdopt(home: string, args: string[] = []): string {
  const r = runAdoptRaw(home, args);
  if (r.code !== 0) throw new Error(`ccrc-adopt exited ${r.code}\n${r.stderr}`);
  return r.stdout;
}

function writeExec(p: string, content: string): void {
  writeFileSync(p, content);
  chmodSync(p, 0o755);
}

const binDir = (home: string): string => path.join(home, '.local', 'bin');

/**
 * The MEASURED real-world shape (task-11 report / recon on the fleet host):
 * a non-script `claude` binary (deliberately a few bytes here — the real one
 * is 300+ MB and adopt must never read it whole), `claude2`/`claude-dev0`
 * generated wrappers each carrying a secrets-sourcing guard preceded by an
 * explanatory comment (the exact shape on disk), a secrets-free
 * `claude-corp`, and `gpt`, a bespoke script that sets CLAUDE_CONFIG_DIR but
 * manages its own proxy rather than `exec`ing the upstream binary.
 */
function buildMeasuredBox(home: string): void {
  const bin = binDir(home);
  mkdirSync(bin, { recursive: true });

  // NOT a real 304 MB ELF — a few bytes are enough to prove "non-script,
  // never read as text". Real content is asserted separately, in the
  // "never reads the upstream binary as text" test below.
  writeExec(path.join(bin, 'claude'), '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker');

  writeExec(path.join(bin, 'claude2'), [
    '#!/usr/bin/env bash',
    'export CLAUDE_CONFIG_DIR="$HOME/.claude-personal"',
    "# Long-lived setup token (see the file's own header for why). Sourced, not",
    '# inlined, so the token never sits in this world-readable wrapper.',
    '[ -r "$HOME/.cc-secrets/claude2-oauth.env" ] && . "$HOME/.cc-secrets/claude2-oauth.env"',
    'exec "$HOME/.local/bin/claude" "$@"',
    '',
  ].join('\n'));

  writeExec(path.join(bin, 'claude-corp'), [
    '#!/usr/bin/env bash',
    'export CLAUDE_CONFIG_DIR="$HOME/.claude-corp"',
    'exec "$HOME/.local/bin/claude" "$@"',
    '',
  ].join('\n'));

  writeExec(path.join(bin, 'claude-dev0'), [
    '#!/usr/bin/env bash',
    'export CLAUDE_CONFIG_DIR="$HOME/.claude-dev0"',
    '[ -r "$HOME/.cc-secrets/claude-dev0-oauth.env" ] && . "$HOME/.cc-secrets/claude-dev0-oauth.env"',
    'exec "$HOME/.local/bin/claude" "$@"',
    '',
  ].join('\n'));

  // Bespoke: sets CLAUDE_CONFIG_DIR, but manages its own proxy and execs a
  // DIFFERENT binary — not the generated shape by any reading of it.
  writeExec(path.join(bin, 'gpt'), [
    '#!/usr/bin/env bash',
    '# ccgpt — drives a local LiteLLM proxy; nothing like the generated template.',
    'export CLAUDE_CONFIG_DIR="$HOME/.claude-gpt"',
    'echo "starting litellm proxy..." >&2',
    'ensure_proxy_running',
    'exec "$HOME/.local/bin/litellm-real" "$@"',
    '',
  ].join('\n'));

  for (const d of ['.claude', '.claude-personal', '.claude-corp', '.claude-dev0', '.claude-gpt']) {
    mkdirSync(path.join(home, d), { recursive: true });
  }
}

describe('ccrc-adopt: the measured five-account box', () => {
  function freshBox(): string {
    const home = mkTmp('ccrc-adopt-');
    buildMeasuredBox(home);
    return home;
  }

  it('classifies the binary as upstream, the shaped scripts as generated, and the bespoke one as external', () => {
    const home = freshBox();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.upstreamId).toBe('claude');
    expect(roster.byId.get('claude2')!.exec).toEqual({ kind: 'generated', secretsFile: '.cc-secrets/claude2-oauth.env' });
    expect(roster.byId.get('gpt')!.exec.kind).toBe('external');
  });

  it('writes id-as-label, since it cannot invent a friendly name', () => {
    const home = freshBox();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.byId.get('claude2')!.label).toBe('claude2');
  });

  it('says on stderr that labels are id-as-written and names the file to edit', () => {
    const home = freshBox();
    const r = runAdoptRaw(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/label is id-as-written/i);
  });

  it('says on stderr that homeAble/telemetry are policy defaults, not facts read off disk, and names the file to edit', () => {
    // Round-1 review finding: the report claimed this disclosure existed
    // alongside the label caveat; it did not (homeAble/telemetry were
    // assigned silently). Pinning it so the claim in the report stays true.
    const home = freshBox();
    const r = runAdoptRaw(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/homeAble/);
    expect(r.stderr).toMatch(/telemetry/);
    expect(r.stderr).toMatch(/policy default/i);
  });

  it('recognizes claude-corp (no secretsFile) and claude-dev0 (with one), matching every account on disk', () => {
    const home = freshBox();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.accounts.map((a) => a.id).sort()).toEqual(
      ['claude', 'claude-corp', 'claude-dev0', 'claude2', 'gpt'].sort(),
    );
    expect(roster.byId.get('claude-corp')!.exec).toEqual({ kind: 'generated' });
    expect(roster.byId.get('claude-dev0')!.exec).toEqual({
      kind: 'generated', secretsFile: '.cc-secrets/claude-dev0-oauth.env',
    });
  });

  it('assigns homeAble and telemetry by exec kind: upstream/generated are homeAble+anthropic, external is opt-in+none', () => {
    const home = freshBox();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    for (const id of ['claude', 'claude2', 'claude-corp', 'claude-dev0']) {
      const a = roster.byId.get(id)!;
      expect(a.homeAble, id).toBe(true);
      expect(a.telemetry, id).toBe('anthropic');
    }
    const gpt = roster.byId.get('gpt')!;
    expect(gpt.homeAble).toBe(false);
    expect(gpt.telemetry).toBe('none');
  });

  it('assigns hues by position, upstream first then the rest alphabetically', () => {
    const home = freshBox();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    // Declaration order is upstream first, then the remaining ids sorted
    // byte-wise (LC_ALL=C) — "claude-corp" < "claude-dev0" < "claude2" < "gpt".
    expect(roster.accounts.map((a) => a.id)).toEqual(
      ['claude', 'claude-corp', 'claude-dev0', 'claude2', 'gpt'],
    );
    expect(roster.accounts.map((a) => a.hue)).toEqual(
      ['cyan', 'violet', 'blue', 'magenta', 'amber'],
    );
  });

  it('gives the upstream account configDirSuffix ".claude" — the tool default, not something read off disk', () => {
    const home = freshBox();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.byId.get('claude')!.configDirSuffix).toBe('.claude');
  });

  it('prints nothing but valid JSON on stdout — diagnostics all go to stderr', () => {
    const home = freshBox();
    const r = runAdoptRaw(home);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it('writes accounts.json under $HOME/.ccrc by default', () => {
    const home = freshBox();
    runAdopt(home);
    const written = JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')) as unknown;
    expect(() => parseRoster(written)).not.toThrow();
  });

  it('never reads the upstream binary as text: a genuinely huge, non-UTF8 upstream file does not hang or crash the run', () => {
    const home = freshBox();
    // Overwrite the tiny fixture binary with several MB of non-UTF8 noise —
    // large enough that a full `read`/`mapfile` of it would be slow and
    // almost certainly throw on invalid encoding; adopt must finish quickly
    // regardless, because classification only ever looks at its first two
    // bytes.
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    bytes[0] = 0x7f; bytes[1] = 0x45; bytes[2] = 0x4c; bytes[3] = 0x46; // \x7fELF
    for (let i = 4; i < bytes.length; i++) bytes[i] = i % 256;
    writeFileSync(path.join(binDir(home), 'claude'), bytes);
    chmodSync(path.join(binDir(home), 'claude'), 0o755);

    const start = Date.now();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(roster.upstreamId).toBe('claude');
  });
});

describe('ccrc-adopt: refusing to clobber', () => {
  it('prints the proposal and does not touch an existing accounts.json, exiting nonzero', () => {
    const home = mkTmp('ccrc-adopt-clobber-');
    buildMeasuredBox(home);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const existing = JSON.stringify({ version: 1, accounts: [{ id: 'sentinel', label: 'sentinel', configDirSuffix: '.sentinel', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }] });
    writeFileSync(path.join(home, '.ccrc', 'accounts.json'), existing);

    const r = runAdoptRaw(home);
    expect(r.code).not.toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow(); // still printed the proposal
    expect(JSON.parse(r.stdout).accounts.map((a: { id: string }) => a.id)).toContain('claude');
    // untouched on disk
    expect(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(existing);
  });

  it('--force overwrites the existing file with the new proposal', () => {
    const home = mkTmp('ccrc-adopt-force-');
    buildMeasuredBox(home);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [{ id: 'sentinel', label: 'sentinel', configDirSuffix: '.sentinel', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }] }));

    const r = runAdoptRaw(home, ['--force']);
    expect(r.code).toBe(0);
    const onDisk = JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: { id: string }[] };
    expect(onDisk.accounts.map((a) => a.id)).toContain('claude');
    expect(onDisk.accounts.map((a) => a.id)).not.toContain('sentinel');
  });

  it('--out redirects the write path without touching $HOME/.ccrc/accounts.json', () => {
    const home = mkTmp('ccrc-adopt-out-');
    buildMeasuredBox(home);
    const outPath = path.join(mkTmp('ccrc-adopt-outfile-'), 'adopted.json');

    const r = runAdoptRaw(home, ['--out', outPath]);
    expect(r.code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(path.join(home, '.ccrc', 'accounts.json'))).toBe(false);
  });
});

describe('ccrc-adopt: never mis-classifies a bespoke launcher as generated', () => {
  // The specific bug this guards: a bespoke script whose stripped body is
  // ALSO exactly 2-3 significant lines (the same count a real generated
  // wrapper has) must still fail on shape, not on line count — and,
  // separately, must never be allowed to cast a vote for "upstream" just
  // because its final line happens to read `exec "$HOME/.local/bin/<x>"
  // "$@"` for some x that is not what the real wrappers agree on.
  it('a short bespoke script (same line count as a generated wrapper, different content) stays external and never wins the upstream vote', () => {
    const home = mkTmp('ccrc-adopt-shortbespoke-');
    const bin = binDir(home);
    mkdirSync(bin, { recursive: true });
    writeExec(path.join(bin, 'claude'), '\x7fELF-fixture');
    writeExec(path.join(bin, 'claude2'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude-personal"',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'));
    // Exactly 3 significant lines, same as a secrets-carrying generated
    // wrapper — but the middle line is not the secrets guard, and the exec
    // targets a DIFFERENT binary than "claude".
    writeExec(path.join(bin, 'weird'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude-weird"',
      'echo "not a secrets guard" >&2',
      'exec "$HOME/.local/bin/something-else" "$@"',
      '',
    ].join('\n'));
    mkdirSync(path.join(home, '.claude'), { recursive: true });

    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.upstreamId).toBe('claude');
    expect(roster.byId.get('weird')!.exec.kind).toBe('external');
  });

  it('a shape-plausible script that execs a DIFFERENT binary than the winning upstream stays external, not generated', () => {
    const home = mkTmp('ccrc-adopt-wrongtarget-');
    const bin = binDir(home);
    mkdirSync(bin, { recursive: true });
    writeExec(path.join(bin, 'claude'), '\x7fELF-fixture');
    writeExec(path.join(bin, 'opus'), '\x7fELF-fixture-2'); // a second non-script binary, never voted for
    for (const id of ['claude2', 'claude-corp']) {
      writeExec(path.join(bin, id), [
        '#!/usr/bin/env bash',
        `export CLAUDE_CONFIG_DIR="$HOME/.${id}"`,
        'exec "$HOME/.local/bin/claude" "$@"',
        '',
      ].join('\n'));
    }
    // Same shape, but execs "opus" instead — one lone vote against two.
    writeExec(path.join(bin, 'stray'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.stray"',
      'exec "$HOME/.local/bin/opus" "$@"',
      '',
    ].join('\n'));
    for (const d of ['.claude', '.claude2', '.claude-corp', '.stray']) {
      mkdirSync(path.join(home, d), { recursive: true });
    }

    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.upstreamId).toBe('claude');
    expect(roster.byId.get('stray')!.exec.kind).toBe('external');
    expect(roster.byId.get('claude2')!.exec.kind).toBe('generated');
  });

  it('refuses to guess when wrapper scripts are evenly split between two different upstream binaries', () => {
    const home = mkTmp('ccrc-adopt-tied-');
    const bin = binDir(home);
    mkdirSync(bin, { recursive: true });
    writeExec(path.join(bin, 'claude'), '\x7fELF-a');
    writeExec(path.join(bin, 'opus'), '\x7fELF-b');
    writeExec(path.join(bin, 'claude2'), [
      '#!/usr/bin/env bash', 'export CLAUDE_CONFIG_DIR="$HOME/.claude2"',
      'exec "$HOME/.local/bin/claude" "$@"', '',
    ].join('\n'));
    writeExec(path.join(bin, 'opus2'), [
      '#!/usr/bin/env bash', 'export CLAUDE_CONFIG_DIR="$HOME/.opus2"',
      'exec "$HOME/.local/bin/opus" "$@"', '',
    ].join('\n'));

    const r = runAdoptRaw(home);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/ambiguous upstream/i);
  });
});

describe('ccrc-adopt: disk noise this box actually has', () => {
  it('drops a symlink alias of another candidate rather than proposing two accounts for one script', () => {
    const home = mkTmp('ccrc-adopt-alias-');
    const bin = binDir(home);
    mkdirSync(bin, { recursive: true });
    writeExec(path.join(bin, 'claude'), '\x7fELF-fixture');
    writeExec(path.join(bin, 'claude2'), [
      '#!/usr/bin/env bash', 'export CLAUDE_CONFIG_DIR="$HOME/.claude-personal"',
      'exec "$HOME/.local/bin/claude" "$@"', '',
    ].join('\n'));
    // Measured shape: gpt -> ccgpt, both live in $HOME/.local/bin, identical
    // content, "gpt" is the name an operator actually types.
    writeExec(path.join(bin, 'ccgpt'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude-gpt"',
      'echo "proxy" >&2',
      'exec "$HOME/.local/bin/litellm-real" "$@"',
      '',
    ].join('\n'));
    symlinkSync('ccgpt', path.join(bin, 'gpt'));
    mkdirSync(path.join(home, '.claude'), { recursive: true });

    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.accounts.map((a) => a.id).sort()).toEqual(['claude', 'claude2', 'gpt']);
    expect(roster.byId.has('ccgpt')).toBe(false);
  });

  it('classifies an upstream symlink whose target lives OUTSIDE .local/bin correctly — not by the link file\'s own tiny size', () => {
    // The real shape on this box: $HOME/.local/bin/claude is a symlink to
    // $HOME/.local/share/claude/versions/<ver>, a multi-hundred-MB ELF that
    // lives entirely outside .local/bin. A classifier that judged the link
    // by its OWN metadata (a symlink's `stat` size is the length of the
    // target path string it holds, a few dozen bytes) rather than reading
    // through it would get this wrong. Round-1 review asked for this pinned
    // — the earlier alias test only covers a target that is ANOTHER
    // candidate inside .local/bin (gpt -> ccgpt), a different case.
    const home = mkTmp('ccrc-adopt-symlink-outside-');
    const bin = binDir(home);
    mkdirSync(bin, { recursive: true });
    const versionsDir = path.join(home, '.local', 'share', 'claude', 'versions');
    mkdirSync(versionsDir, { recursive: true });
    const realBinary = path.join(versionsDir, '2.1.228');
    // Multi-MB, non-script, ELF-shaped — large enough that reading it whole
    // would be slow; is_script() must only ever look at its first two bytes.
    const bytes = Buffer.alloc(5 * 1024 * 1024);
    bytes[0] = 0x7f; bytes[1] = 0x45; bytes[2] = 0x4c; bytes[3] = 0x46; // \x7fELF
    writeFileSync(realBinary, bytes);
    chmodSync(realBinary, 0o755);
    symlinkSync(realBinary, path.join(bin, 'claude'));

    writeExec(path.join(bin, 'claude2'), [
      '#!/usr/bin/env bash', 'export CLAUDE_CONFIG_DIR="$HOME/.claude-personal"',
      'exec "$HOME/.local/bin/claude" "$@"', '',
    ].join('\n'));
    mkdirSync(path.join(home, '.claude'), { recursive: true });

    const start = Date.now();
    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(roster.upstreamId).toBe('claude');
    expect(roster.byId.get('claude')!.exec.kind).toBe('upstream');
    expect(roster.byId.get('claude2')!.exec.kind).toBe('generated');
  });

  it('ignores ccd.bak-<date>-shaped and <id>.bak-<date>-shaped files: a "." never appears in a real account id', () => {
    const home = mkTmp('ccrc-adopt-backups-');
    buildMeasuredBox(home);
    const bin = binDir(home);
    // Verbatim copies of real files, under backup-style names — exactly the
    // measured shape (ccd.bak-20260729-090937, claude2.bak-20260805-181306).
    writeExec(path.join(bin, 'claude2.bak-20260805-181306'), readFileSync(path.join(bin, 'claude2'), 'utf8'));
    writeExec(path.join(bin, 'ccd.pre-flip'), '#!/usr/bin/env bash\necho not a real ccd\n');

    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.accounts.map((a) => a.id)).not.toContain('claude2.bak-20260805-181306');
    expect(roster.accounts.map((a) => a.id)).not.toContain('ccd.pre-flip');
    // the real claude2 is still there, unaffected by its own backup existing
    expect(roster.byId.get('claude2')!.exec.kind).toBe('generated');
  });

  it('refuses cleanly when $HOME/.local/bin has nothing that sets CLAUDE_CONFIG_DIR', () => {
    const home = mkTmp('ccrc-adopt-empty-');
    mkdirSync(binDir(home), { recursive: true });
    writeExec(path.join(binDir(home), 'ls'), '#!/usr/bin/env bash\necho hi\n');
    const r = runAdoptRaw(home);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/nothing to adopt/i);
  });
});

describe('ccrc-adopt: cross-check reports disagreement, never silently prefers a source', () => {
  it('flags an id from the session registry that adopt never discovered under .local/bin', () => {
    const home = mkTmp('ccrc-adopt-crosscheck-');
    buildMeasuredBox(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    // A ghost wrapper: a live session claims a home adopt cannot find on disk.
    writeFileSync(path.join(home, '.cc-sessions', 'someproj.wrapper'), 'claude-ghost');

    const r = runAdoptRaw(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/claude-ghost/);
    expect(r.stderr).toMatch(/session registry/i);
  });

  it('reads multiple .wrapper files with no trailing newline as separate ids, not one concatenated string', () => {
    // Regression: the measured shape is that NONE of ~/.cc-sessions's
    // `.wrapper` (and `.home`) files carry a trailing newline. An earlier
    // version of the registry scan did `cat *.wrapper | sort -u`, which with
    // 2+ such files silently ran their contents together into one garbled
    // line (reproduced during development: a real run reported a single
    // ~800-character "id"). One file alone can't catch this — concatenating
    // ONE file's bytes with nothing is a no-op — so this needs 2+.
    const home = mkTmp('ccrc-adopt-crosscheck-multiwrapper-');
    buildMeasuredBox(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    // A real, discovered id — must NOT be reported as missing from the
    // registry once correctly split out from its neighbours.
    writeFileSync(path.join(home, '.cc-sessions', 'proj-a.wrapper'), 'claude'); // no trailing \n
    // Two more ghost ids, back to back with no separator on disk.
    writeFileSync(path.join(home, '.cc-sessions', 'proj-b.wrapper'), 'claude-ghost-a'); // no trailing \n
    writeFileSync(path.join(home, '.cc-sessions', 'proj-c.wrapper'), 'claude-ghost-b'); // no trailing \n

    const r = runAdoptRaw(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/cross-check:.*"claude-ghost-a"/);
    expect(r.stderr).toMatch(/cross-check:.*"claude-ghost-b"/);
    // Never the garbled concatenation a bulk `cat | sort` would produce.
    expect(r.stderr).not.toContain('claude-ghost-aclaude-ghost-b');
    expect(r.stderr).not.toContain('claudeclaude-ghost');
    // "claude" IS discovered AND IS in the registry (its own file) — must
    // not be flagged as a mismatch in either direction.
    expect(r.stderr).not.toMatch(/adopt discovered "claude", which the .* session registry never mentions/);
  });

  it('flags a ~/.claude* directory with no matching discovered configDirSuffix', () => {
    const home = mkTmp('ccrc-adopt-crosscheck2-');
    buildMeasuredBox(home);
    // Unrelated tool config dir that merely starts with ".claude" — measured
    // on the real box as ~/.claude-docserver.
    mkdirSync(path.join(home, '.claude-docserver'), { recursive: true });

    const r = runAdoptRaw(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('.claude-docserver');
  });

  it('does not let cross-check mismatches change which accounts get written', () => {
    const home = mkTmp('ccrc-adopt-crosscheck3-');
    buildMeasuredBox(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'nonexistent-account.json'), '{}');

    const roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(roster.byId.has('nonexistent-account')).toBe(false);
    expect(roster.accounts).toHaveLength(5);
  });
});

describe('ccrc-adopt: self-validation', () => {
  it('every account it proposes round-trips through the real parseRoster with no warnings needed', () => {
    const home = mkTmp('ccrc-adopt-selfcheck-');
    buildMeasuredBox(home);
    const parsed: Roster = parseRoster(JSON.parse(runAdopt(home)));
    expect(parsed.version).toBe(1);
    expect(parsed.accounts.length).toBeGreaterThan(0);
  });

  it('a roster ccrc-adopt would refuse to write never reaches disk at all — the clobber test already proves the write is skipped, this proves parseRoster would reject a hand-corrupted one the same way adopt validates its own', () => {
    // Guards the CONTRACT ccrc-adopt's self-check leans on (deploy/gen-accounts.mjs
    // agrees with parseRoster) rather than re-deriving it — that agreement is
    // already pinned by server/test/gen-accounts.test.ts.
    expect(() => parseRoster({ version: 1, accounts: [] })).toThrow(RosterError);
  });
});

// ── D-155: the elected upstream may legitimately be a LAUNCHER SCRIPT ─────
//
// The measured shape on the fleet host changed on 2026-08-20.
// `~/.local/bin/claude` had been the native installer's symlink into
// `~/.local/share/claude/versions/<ver>` — a 334 MB ELF, and the file every
// fixture above models as `\x7fELF…`. It is now a 2.7 KB bash LAUNCHER that
// picks which installed version to run and injects the upstream account's
// token before `exec`ing the real binary.
//
// Adopt refused that box outright, exit 1, writing nothing — and adopt is the
// remedy four `ccrc doctor` checks name, so the whole re-bootstrap path
// terminated in a refusal. The gate it tripped keyed on "does this file start
// with `#!`", which was never the hazard: the hazard is electing an ACCOUNT
// WRAPPER as the upstream, because the wrappers that voted for it would then
// exec a wrapper — a cycle. `#!` was a proxy for that, and the proxy stopped
// tracking the thing when the binary path became a script.
//
// These cases pin the re-keyed gate from both sides: a launcher is adopted, a
// wrapper is still refused, and the refusal is judged on the elected file's
// OWN bytes rather than on whether it happened to pass the candidate filter.
describe('ccrc-adopt: an upstream that is a launcher script, not the binary itself', () => {
  /** The real launcher's shape, in miniature: a script that execs onward to a
   *  versioned binary OUTSIDE `.local/bin`, and that declares no
   *  `CLAUDE_CONFIG_DIR` — which is exactly what makes it the binary path
   *  rather than an account. */
  const LAUNCHER = [
    '#!/usr/bin/env bash',
    '# Launcher: picks the newest installed version and execs it. It declares',
    '# no CLAUDE_CONFIG_DIR deliberately — it is the binary path, not an account.',
    'set -u',
    '_vdir="${XDG_DATA_HOME:-$HOME/.local/share}/claude/versions"',
    'exec "$_vdir/2.1.238" "$@"',
    '',
  ].join('\n');

  /** The measured five-account box, with the upstream binary replaced by the
   *  launcher — i.e. the fleet host as it actually is today. */
  function launcherBox(): string {
    const home = mkTmp('ccrc-adopt-launcher-');
    buildMeasuredBox(home);
    writeExec(path.join(binDir(home), 'claude'), LAUNCHER);
    return home;
  }

  it('adopts it: a script that execs onward but declares no config dir is the upstream account', () => {
    const home = launcherBox();
    const r = runAdoptRaw(home);
    expect(r.code, `adopt refused a launcher-shaped upstream:\n${r.stderr}`).toBe(0);
    const roster = parseRoster(JSON.parse(r.stdout));
    expect(roster.upstreamId).toBe('claude');
    expect(roster.byId.get('claude')!.exec.kind).toBe('upstream');
    // The rest of the box still classifies exactly as it did with a binary
    // there — the gate is the only thing that changed.
    expect(roster.byId.get('claude2')!.exec).toEqual({ kind: 'generated', secretsFile: '.cc-secrets/claude2-oauth.env' });
    expect(roster.byId.get('gpt')!.exec.kind).toBe('external');
  });

  it('writes accounts.json for such a box, so the re-bootstrap path doctor names actually completes', () => {
    const home = launcherBox();
    expect(runAdoptRaw(home).code).toBe(0);
    const written = JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')) as unknown;
    expect(parseRoster(written).upstreamId).toBe('claude');
  });

  it('still refuses when the elected upstream is itself an account wrapper — the exec cycle the old gate was a proxy for', () => {
    // `claude2` and `claude-corp` both exec `claude`, so `claude` wins the
    // vote — but `claude` here sets its own CLAUDE_CONFIG_DIR and execs
    // onward, which makes it an account wrapper. Adopting it would write a
    // roster whose generated wrappers exec a wrapper.
    const home = mkTmp('ccrc-adopt-cycle-');
    buildMeasuredBox(home);
    writeExec(path.join(binDir(home), 'claude'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude-cycle"',
      'exec "$HOME/.local/bin/claude-real" "$@"',
      '',
    ].join('\n'));
    const r = runAdoptRaw(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/account wrapper/i);
    expect(r.stderr).toMatch(/CLAUDE_CONFIG_DIR/);
    expect(existsSync(path.join(home, '.ccrc', 'accounts.json'))).toBe(false);
  });

  it('judges the elected upstream by its own bytes, not by whether it passed the candidate filter', () => {
    // THE SPELLING TEST. The gate can be written two ways: ask
    // `_wrap_declares_config_dir` about the elected path directly, or test the
    // winner for membership of `CFG_SCRIPTS`, the list built in pass 1. They
    // are not equivalent, and this is the case that separates them: a textbook
    // account wrapper parked at the upstream path whose only anomaly is mode
    // 0644. Pass 0 drops it for want of `-x`, so it is in no list — the
    // membership spelling would call it "not a wrapper" and adopt a cycle.
    // Reading its bytes gets it right.
    const home = mkTmp('ccrc-adopt-unreadable-mode-');
    buildMeasuredBox(home);
    const p = path.join(binDir(home), 'claude');
    writeFileSync(p, [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude-cycle"',
      'exec "$HOME/.local/bin/claude-real" "$@"',
      '',
    ].join('\n'));
    chmodSync(p, 0o644);
    const r = runAdoptRaw(home);
    expect(r.code, `a wrapper at the upstream path was adopted:\n${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/account wrapper/i);
  });

  it('does not call a script "non-script" in its own success line', () => {
    // Rider to the gate change: the success echo asserted `non-script` as a
    // measured fact about the elected file. The moment the gate admits a
    // script that literal is a falsehood ccrc prints about the operator's own
    // box, and nothing pins it — `ccrc-cli.test.ts` pins this line by prefix
    // only.
    const launcher = runAdoptRaw(launcherBox());
    expect(launcher.code).toBe(0);
    expect(launcher.stderr).toMatch(/^ccrc-adopt: upstream account "claude"/m);
    expect(launcher.stderr).not.toMatch(/non-script/);
    expect(launcher.stderr).toMatch(/launcher script/);

    // …and a real binary is still described as one.
    const binary = runAdoptRaw((() => { const h = mkTmp('ccrc-adopt-binary-'); buildMeasuredBox(h); return h; })());
    expect(binary.code).toBe(0);
    expect(binary.stderr).toMatch(/^ccrc-adopt: upstream account "claude".*\bbinary\b/m);
  });

  it('does not call a file it could not measure "over 1 MiB" (D-155)', () => {
    // The size gate is fail-closed, which is right on a write path. But
    // "I measured it and it is too big" and "I could not measure it at all"
    // are two different facts about the box, resolved two different ways, and
    // the first spelling of this gate folded them into one sentence — so a box
    // whose `stat` does not take `-c%s` (every BSD-flavoured one) was told its
    // 102-byte wrappers were over a megabyte, and adopt then reported that
    // nothing under .local/bin sets CLAUDE_CONFIG_DIR. Measured, not
    // hypothetical: that is the overloaded-null class CLAUDE.md names, shipped
    // by the very change that closed D-81's hole on this path.
    const home = launcherBox();
    const stubBin = path.join(home, 'stub-bin');
    mkdirSync(stubBin, { recursive: true });
    writeExec(path.join(stubBin, 'stat'), '#!/bin/sh\nexit 1\n');
    const r = spawnSync('bash', [ADOPT, '--out', path.join(home, 'out.json')], {
      env: { ...process.env, HOME: home, PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    });
    const stderr = r.stderr ?? '';
    expect(stderr, 'an unmeasurable file must not be reported as an oversize one')
      .not.toMatch(/\? bytes/);
    expect(stderr).not.toMatch(/of \? bytes — over/);
    // It must name the thing that actually failed, and name it as a size it
    // could not obtain rather than a size it obtained and disliked.
    expect(stderr).toMatch(/size/i);
    expect(stderr).toMatch(/stat/);
  });

  it('never reads a huge script at the upstream path whole', () => {
    // D-81's rule, on the path that just became reachable. `_wrap_is_script`
    // bounds itself to two bytes, but `_wrap_declares_config_dir` reads its
    // argument WHOLE — and until the gate moved, no script ever reached it at
    // the upstream path, because `_wrap_is_script` refused first. Relaxing the
    // gate without a size bound would put an unbounded read on exactly the
    // file this tool has always promised never to read whole.
    const home = launcherBox();
    const big = Buffer.concat([
      Buffer.from('#!/usr/bin/env bash\n'),
      Buffer.alloc(8 * 1024 * 1024, 0x41),   // 8 MiB of 'A', no newlines
      Buffer.from('\nexec "$HOME/.local/share/claude/versions/2.1.238" "$@"\n'),
    ]);
    writeFileSync(path.join(binDir(home), 'claude'), big);
    chmodSync(path.join(binDir(home), 'claude'), 0o755);

    const start = Date.now();
    const r = runAdoptRaw(home);
    expect(Date.now() - start).toBeLessThan(10_000);
    // Refusing is the right answer — a file too big to classify is not one
    // adopt may call the upstream account — but it must refuse having read
    // two bytes and a size, not 8 MiB.
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/too big|over 1 MiB/i);
  });
});
