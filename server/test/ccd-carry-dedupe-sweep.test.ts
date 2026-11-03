// `ccd/ccd-carry-dedupe-sweep` (#317; D-7857): the daily run of `ccd carry-dedupe --identical-only`, a dry run until the
// operator arms `$REG/carry-dedupe-live`, and one dated summary line per run in `$REG/carry-dedupe-record`, bounded.
// Fixture HOMEs only: `~/.local/bin/ccd` is a stub that records its argv and prints a planted output, and one case
// plants the REAL program's output (`ccd/lib/carry-dedupe.py` over a fixture account pair), so the summary is held to
// the verb's own table and total line, not to a copy of them typed here.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'ccd', 'ccd-carry-dedupe-sweep');
const PROGRAM = join(REPO, 'ccd', 'lib', 'carry-dedupe.py');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const STAMP = String.raw`\d{4}-\d\d-\d\d \d\d:\d\d:\d\d`;

/** The stub ccd: argv to `<home>/ccd-argv`, `<home>/ccd-out` on stdout, exit `<home>/ccd-rc` (0 when absent). */
const CCD_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/ccd-argv"
[ -f "$HOME/ccd-out" ] && cat "$HOME/ccd-out"
[ -f "$HOME/ccd-rc" ] && exit "$(cat "$HOME/ccd-rc")"
exit 0
`;

const U = (n: number): string => `${String(n).padStart(8, '0')}-1111-4aaa-8bbb-${String(n).padStart(12, '0')}`;
/** The verb's dry-run output in its own shape (`carry-dedupe.py`'s header, table and total lines). */
const dryOut = (rows: Array<[string, string]>, bytes: number, live = false): string => [
  live ? 'dedupe: --apply' : 'dedupe: dry run, nothing changes (pass --apply to reclaim)',
  'dedupe: identical copies only (a proved copy not byte-identical to the keeper\'s is left, NONIDENT)',
  `${'UUID'.padEnd(36)} ${'COPIES'.padStart(6)} ${'KEPT'.padEnd(16)} FILES LINKED          BYTES NONIDENT REFUSED`,
  ...rows.map(([u, w]) => `${u} ${'2'.padStart(6)} ${'lane-a'.padEnd(16)} ${'1'.padStart(5)} ${'0'.padStart(6)} ${'10'.padStart(14)} ${'0'.padStart(8)} ${w}`),
  `total: ${rows.length} uuid(s), ${rows.length * 2} copies, ${bytes} bytes ${live ? 'reclaimed' : 'reclaimable'}, ${rows.filter(([, w]) => w !== '-').length} refused`,
  '',
].join('\n');

interface Box { home: string; reg: string; record: string }
function box(prefix: string, o: { reg?: boolean; ccd?: boolean } = {}): Box {
  const home = mkTmp(prefix);
  const reg = join(home, '.cc-sessions');
  if (o.reg !== false) mkdirSync(reg, { recursive: true });
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  if (o.ccd !== false) writeFileSync(join(home, '.local', 'bin', 'ccd'), CCD_STUB, { mode: 0o755 });
  return { home, reg, record: join(reg, 'carry-dedupe-record') };
}
const plant = (b: Box, out: string, rc = 0): void => {
  writeFileSync(join(b.home, 'ccd-out'), out);
  if (rc !== 0) writeFileSync(join(b.home, 'ccd-rc'), String(rc));
};
function run(b: Box): { code: number; stderr: string } {
  const stubs = join(b.home, 'stub-bin');
  mkdirSync(stubs, { recursive: true });
  // The bash this suite runs on, ahead of the system one: the script's `#!/usr/bin/env bash` needs a bash 4+.
  spawnSync('ln', ['-sf', BASH, join(stubs, 'bash')]);
  const r = spawnSync(BASH, [SCRIPT], {
    env: { HOME: b.home, PATH: `${stubs}:/usr/bin:/bin`, TMPDIR: b.home, LANG: 'C' }, encoding: 'utf8',
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? '' };
}
const argv = (b: Box): string[] => readFileSync(join(b.home, 'ccd-argv'), 'utf8').trim().split('\n');
const recordLines = (b: Box): string[] => readFileSync(b.record, 'utf8').split('\n').filter((l) => l !== '');

describe('ccd-carry-dedupe-sweep: shadow until armed (D-7857)', () => {
  it('shadow: with no marker the verb is asked for a dry run, never --apply', () => {
    const b = box('ccrc-cdsweep-shadow-');
    plant(b, dryOut([[U(1), '-']], 10));
    const r = run(b);
    expect(r.code, r.stderr).toBe(0);
    expect(argv(b)).toEqual(['carry-dedupe --identical-only']);
    expect(argv(b).join(' ')).not.toContain('--apply');
    expect(recordLines(b)).toHaveLength(1);
    expect(recordLines(b)[0]).toMatch(/ mode=shadow /);
  });

  it('live: the marker, and only the marker, adds --apply', () => {
    const b = box('ccrc-cdsweep-live-');
    writeFileSync(join(b.reg, 'carry-dedupe-live'), '');
    plant(b, dryOut([[U(1), '-']], 10, true));
    const r = run(b);
    expect(r.code, r.stderr).toBe(0);
    expect(argv(b)).toEqual(['carry-dedupe --identical-only --apply']);
    expect(recordLines(b)[0]).toMatch(new RegExp(`^${STAMP} mode=live rc=0 uuids=1 copies=2 reclaimed=10 refused=0 by=-$`));
  });

  it('a marker of another name arms nothing (the read is exact)', () => {
    const b = box('ccrc-cdsweep-othername-');
    writeFileSync(join(b.reg, 'carry-dedupe-live.bak'), '');
    writeFileSync(join(b.reg, 'scope-sweep-live'), '');
    plant(b, dryOut([], 0));
    expect(run(b).code).toBe(0);
    expect(argv(b)).toEqual(['carry-dedupe --identical-only']);
  });
});

describe('ccd-carry-dedupe-sweep: the record line (D-7857)', () => {
  it('one dated line: mode, rc, the verb\'s total figures, and the refusals counted by word in the order first seen', () => {
    const b = box('ccrc-cdsweep-format-');
    plant(b, dryOut([[U(1), 'tie'], [U(2), '-'], [U(3), 'diverged'], [U(4), 'tie'], [U(5), 'recent']], 123456789012));
    expect(run(b).code).toBe(0);
    expect(recordLines(b)).toEqual([expect.stringMatching(
      new RegExp(`^${STAMP} mode=shadow rc=0 uuids=5 copies=10 reclaimable=123456789012 refused=4 by=tie:2,diverged:1,recent:1$`))]);
  });

  it('the real program\'s dry-run output (carry-dedupe.py over a fixture pair) summarises to its own total', () => {
    const b = box('ccrc-cdsweep-real-');
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    const uuid = 'c3a10e57-5555-4bcc-b60b-0cfc0dc3d199';
    const body = `${JSON.stringify({ type: 'user', uuid: 'm-1', text: 'x'.repeat(4000) })}\n`;
    for (const cfg of ['.claude', '.claude-lane-a']) {
      const p = join(b.home, cfg, 'projects', '-w-project-a', `${uuid}.jsonl`);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
      utimesSync(p, old, old);
    }
    // The registry row names the keeper's account, as the verb's shell half would pass it.
    const stdin = `A\tclaude\t${join(b.home, '.claude')}\nA\tlane-a\t${join(b.home, '.claude-lane-a')}\nO\t${uuid}\tclaude\trow\n`;
    // The program's fifth argument is the ccd it sources to ask the link route, which only a sidecar walk does: there is
    // no sidecar here, so it names a path that does not exist, and the program never runs a ccd at all.
    const p = spawnSync('python3', [PROGRAM, b.reg, '0', '-', '24', join(b.home, 'no-ccd'), '1'],
      { input: stdin, encoding: 'utf8', env: { HOME: b.home, PATH: '/usr/bin:/bin', LANG: 'C' } });
    expect(p.status, p.stderr).toBe(0);
    expect(p.stdout).toMatch(new RegExp(`^total: 1 uuid\\(s\\), 2 copies, ${body.length} bytes reclaimable, 0 refused$`, 'm'));
    plant(b, p.stdout);
    expect(run(b).code).toBe(0);
    expect(recordLines(b)[0]).toMatch(new RegExp(`^${STAMP} mode=shadow rc=0 uuids=1 copies=2 reclaimable=${body.length} refused=0 by=-$`));
    // A dry run changed nothing.
    expect(existsSync(join(b.home, '.claude-lane-a', 'projects', '-w-project-a', `${uuid}.jsonl`))).toBe(true);
  });

  it('the verb\'s exit code is recorded and returned', () => {
    const b = box('ccrc-cdsweep-rc-');
    plant(b, dryOut([[U(1), 'error']], 0), 1);
    expect(run(b).code).toBe(1);
    expect(recordLines(b)[0]).toMatch(new RegExp(`^${STAMP} mode=shadow rc=1 uuids=1 copies=2 reclaimable=0 refused=1 by=error:1$`));
  });

  it('an output with no total line records unmeasured=no-total and fails the unit, even when the verb exited 0', () => {
    const b = box('ccrc-cdsweep-nototal-');
    plant(b, 'ccd: carry-dedupe: its program is not installed\n');
    expect(run(b).code).toBe(1);
    expect(recordLines(b)).toEqual([expect.stringMatching(new RegExp(`^${STAMP} mode=shadow rc=0 unmeasured=no-total$`))]);
  });

  it('the record keeps its last 400 lines: the oldest goes, the new line is last', () => {
    const b = box('ccrc-cdsweep-bound-');
    writeFileSync(b.record, Array.from({ length: 400 }, (_, i) => `old-${i}\n`).join(''));
    plant(b, dryOut([], 0));
    expect(run(b).code).toBe(0);
    const got = recordLines(b);
    expect(got).toHaveLength(400);
    expect(got[0]).toBe('old-1');
    expect(got[398]).toBe('old-399');
    expect(got[399]).toMatch(/ mode=shadow rc=0 uuids=0 /);
  });

  it('a short record is appended to, every line kept', () => {
    const b = box('ccrc-cdsweep-append-');
    writeFileSync(b.record, 'old-0\nold-1\n');
    plant(b, dryOut([], 0));
    expect(run(b).code).toBe(0);
    expect(recordLines(b).slice(0, 2)).toEqual(['old-0', 'old-1']);
    expect(recordLines(b)).toHaveLength(3);
  });
});

describe('ccd-carry-dedupe-sweep: what it needs (D-7857)', () => {
  it('no registry: nothing to collect, nothing asked, nothing recorded, exit 0', () => {
    const b = box('ccrc-cdsweep-noreg-', { reg: false });
    const r = run(b);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/no session registry/);
    expect(existsSync(join(b.home, 'ccd-argv'))).toBe(false);
    expect(existsSync(b.record)).toBe(false);
  });

  it('no ccd: exit 1, nothing recorded', () => {
    const b = box('ccrc-cdsweep-noccd-', { ccd: false });
    const r = run(b);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no ccd at ~\/\.local\/bin\/ccd/);
    expect(existsSync(b.record)).toBe(false);
  });
});
