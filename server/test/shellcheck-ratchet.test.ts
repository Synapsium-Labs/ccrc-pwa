// The shellcheck ratchet (D-7995): most of the box-side machinery is bash, and nothing linted it. A big-bang cleanup
// would rewrite scripts that work, so this pins what is there and only lets it go down:
//   - each tracked bash file has a pinned count of warning-level findings in shellcheck-baseline.json; `ccd/ccd` and
//     everything under `ccd/lib/` are ONE pin, so code moved between them by a split does not trip it;
//   - a count above its pin fails and names the lines; a count below it passes and prints the entry to paste;
//   - a bash file with no pin (a new file) must have 0 findings; each intended exception carries a
//     `# shellcheck disable=SCxxxx  # reason` directive (the reason after a second `#`: ` -- reason` is not shellcheck
//     syntax, and it stops the parse);
//   - a file shellcheck could not parse FAILS whatever its count. A parse failure reports one or two findings and
//     checks nothing after them, so without this rule breaking a file would read as lowering its count. That is how
//     `ccd/ccrc-doctor-checks` went unlinted: five malformed directives, 2 findings, the rest of the file unread.
//
// The counts are only as good as the tool that made them, so the baseline pins the version: another version here is a
// printed skip, and in CI a failure, so a skip can never read as a pass there. server-deps installs that version on
// Linux (.github/ci/shellcheck-install.sh). The macOS CI legs skip: ccd/ccd alone peaks at 6.2 GB (measured on 0.11.0)
// on a 7 GB runner, and the same tool over the same files has nothing to add to the Linux legs.
//
// The whole pass is slow, so it is no guard suite (fast-plan.mjs HEAVY_TREE_READERS): the queue and the full suite run
// it, and a fast pull request runs it only when the map selects it for a file it reads.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = 'server/test/shellcheck-baseline.json';
const ROOTS = ['ccd', 'deploy', 'install.sh', '.github/ci'];
/** The pin `ccd/ccd` and `ccd/lib/` share. */
const GROUP = 'ccd/ccd + ccd/lib';
/** `--norc` and an empty SHELLCHECK_OPTS: a developer's own settings must not move a count. */
const SHELLCHECK_ARGS = ['--norc', '--shell=bash', '-S', 'warning', '-f', 'gcc'];
/** Two at once. Peak RSS is 6.2 GB for ccd/ccd and 4.1 GB for ccd/ccrc, on a 16 GB runner shared with the shard's
 *  vitest workers; the whole pass takes about 30 s locally and 66 s on a runner at two lanes. */
const LANES = 2;
/** What shellcheck reports when it gave up on a file: everything after that point was not checked. */
const PARSE_STOPPED = new Set(['SC1072', 'SC1073']);

type Finding = { file: string; line: number; code: string; text: string };
type Pin = { count: number; codes: Record<string, number> };
type Pins = Record<string, Pin>;
type Baseline = { shellcheckVersion: string; shellcheckSha256: string; files: Pins };

const baseline = JSON.parse(readFileSync(path.join(REPO, BASELINE), 'utf8')) as Baseline;

const pinKey = (file: string): string => (file === 'ccd/ccd' || file.startsWith('ccd/lib/') ? GROUP : file);

const countCodes = (found: Finding[]): Record<string, number> => {
  const codes: Record<string, number> = {};
  for (const f of [...found].sort((a, b) => a.code.localeCompare(b.code))) codes[f.code] = (codes[f.code] ?? 0) + 1;
  return codes;
};

const entry = (found: Finding[]): Pin => ({ count: found.length, codes: countCodes(found) });

const GCC_LINE = /^(.+?):(\d+):\d+: \w+: (.*) \[(SC\d+)\]$/;

/** shellcheck's gcc output. A line it cannot read is an error: a skipped line would be an undercount. */
function parseGcc(out: string): Finding[] {
  return out.split('\n').filter((l) => l !== '').map((l) => {
    const m = GCC_LINE.exec(l);
    if (!m) throw new Error(`a shellcheck line this test cannot read: ${l}`);
    return { file: m[1], line: Number(m[2]), code: m[4], text: m[3] };
  });
}

/** Every line of each code that rose past its pin. A count cannot say which of them is the new one. */
function risen(found: Finding[], pin: Pin | undefined): Finding[] {
  const now = countCodes(found);
  return found.filter((f) => now[f.code] > (pin?.codes[f.code] ?? 0));
}

const named = (found: Finding[]): string => found.map((f) => `  ${f.file}:${f.line}:${f.code} ${f.text}`).join('\n');

/**
 * The rules. `files` is every bash file measured, `found` everything they reported.
 * @returns `failures` turn the test red; `lowered` are the entries that can come down, printed and passed.
 */
function judge(pins: Pins, files: string[], found: Finding[]): { failures: string[]; lowered: string[] } {
  const failures: string[] = [];
  const lowered: string[] = [];
  const stopped = found.filter((f) => PARSE_STOPPED.has(f.code));
  if (stopped.length > 0) {
    failures.push(`shellcheck stopped parsing, so nothing after these lines was checked and the count means nothing:\n${named(stopped)}`);
  }
  const stoppedKeys = new Set(stopped.map((f) => pinKey(f.file)));
  const measured = new Set(files.map(pinKey));
  for (const key of [...new Set([...measured, ...Object.keys(pins)])].sort()) {
    if (stoppedKeys.has(key)) continue;
    const now = found.filter((f) => pinKey(f.file) === key);
    const pin = pins[key];
    const pinned = pin?.count ?? 0;
    if (now.length > pinned) {
      failures.push(pin
        ? `${key}: ${now.length} findings, pinned at ${pinned}. Fix the new one, or give an intended one a \`# shellcheck disable=SCxxxx  # reason\`. The lines of each code that rose:\n${named(risen(now, pin))}`
        : `${key}: a new bash file must have 0 findings, and it has ${now.length}. Fix them, or give an intended one a \`# shellcheck disable=SCxxxx  # reason\`:\n${named(now)}`);
    } else if (!measured.has(key)) {
      lowered.push(`${key}: no longer a tracked bash file. Delete its entry from ${BASELINE}.`);
    } else if (now.length < pinned) {
      lowered.push(`${key}: ${now.length} findings, pinned at ${pinned}. Lower its entry in ${BASELINE} to "${key}": ${JSON.stringify(entry(now))}`);
    }
  }
  return { failures, lowered };
}

type Gate = { verdict: 'run' } | { verdict: 'skip' | 'fail'; reason: string };

/** Whether this machine may judge the counts. Decided by `found`, the installed version (null: none). */
function gate(found: string | null, pinned: string, ci: boolean, platform: string): Gate {
  if (ci && platform === 'darwin') return { verdict: 'skip', reason: 'a macOS CI leg: the Linux legs run this, and ccd/ccd alone peaks near the runner\'s memory' };
  if (found === pinned) return { verdict: 'run' };
  const reason = found === null
    ? `shellcheck is not installed; ${BASELINE} pins ${pinned}`
    : `shellcheck ${found} is installed; ${BASELINE} pins ${pinned}`;
  return { verdict: ci ? 'fail' : 'skip', reason };
}

function installedVersion(): string | null {
  const out = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' }).stdout ?? '';
  return /^version: (\S+)$/m.exec(out)?.[1] ?? null;
}

function isBash(file: string): boolean {
  const full = path.join(REPO, file);
  if (!lstatSync(full, { throwIfNoEntry: false })?.isFile()) return false;
  return file.endsWith('.sh') || /^#!.*\bbash\b/.test(readFileSync(full, 'utf8').split('\n', 1)[0]);
}

function bashFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], { cwd: REPO, encoding: 'utf8' })
    .split('\0').filter((f) => f !== '' && isBash(f));
}

/** One file. Exit 1 only means it has findings; anything else means it was not measured. */
function shellcheck(file: string, cwd: string): Promise<Finding[]> {
  return new Promise((resolve, reject) => {
    execFile('shellcheck', [...SHELLCHECK_ARGS, file], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SHELLCHECK_OPTS: '' } }, (err, stdout, stderr) => {
      if (err && err.code !== 1) { reject(new Error(`shellcheck could not measure ${file}: ${stderr || err.message}`)); return; }
      try { resolve(parseGcc(stdout)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
  });
}

/** Every file, the largest first so the long ones do not end up alone at the tail. */
async function analyse(files: string[], cwd: string): Promise<Finding[]> {
  const queue = [...files].sort((a, b) => statSync(path.join(cwd, b)).size - statSync(path.join(cwd, a)).size);
  const found: Finding[] = [];
  const lane = async (): Promise<void> => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) found.push(...await shellcheck(f, cwd));
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  return found;
}

/** Straight to stderr: the default reporter, which CI uses, drops console output from a test that passed or skipped. */
const tell = (line: string): void => { writeSync(2, `shellcheck ratchet: ${line}\n`); };

const finding = (file: string, line: number, code: string): Finding => ({ file, line, code, text: 'a message' });
/** How a failure names a finding. Built, not spelled: `citations.test.ts` reads a literal one as a line citation. */
const cite = (file: string, line: number, code: string): string => [file, line, code].join(':');
const pinOf = (codes: Record<string, number>): Pin => ({ count: Object.values(codes).reduce((a, b) => a + b, 0), codes });

describe('the ratchet rules', () => {
  it('a count at its pin passes silently', () => {
    expect(judge({ 'a.sh': pinOf({ SC2034: 1 }) }, ['a.sh'], [finding('a.sh', 3, 'SC2034')])).toEqual({ failures: [], lowered: [] });
  });

  it('a count above its pin fails and names the lines of the code that rose, not every finding in the file', () => {
    const { failures } = judge({ 'a.sh': pinOf({ SC2034: 1, SC2155: 1 }) }, ['a.sh'],
      [finding('a.sh', 3, 'SC2034'), finding('a.sh', 7, 'SC2155'), finding('a.sh', 9, 'SC2155')]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('a.sh: 3 findings, pinned at 2');
    expect(failures[0]).toContain(cite('a.sh', 7, 'SC2155'));
    expect(failures[0]).toContain(cite('a.sh', 9, 'SC2155'));
    expect(failures[0]).not.toContain(cite('a.sh', 3, 'SC2034'));
  });

  it('a code that swaps for another at the same count passes: the pin is the count', () => {
    expect(judge({ 'a.sh': pinOf({ SC2034: 1 }) }, ['a.sh'], [finding('a.sh', 3, 'SC2155')]).failures).toEqual([]);
  });

  it('a count below its pin passes and prints the entry to put in the baseline', () => {
    const { failures, lowered } = judge({ 'a.sh': pinOf({ SC2034: 2 }) }, ['a.sh'], [finding('a.sh', 3, 'SC2034')]);
    expect(failures).toEqual([]);
    expect(lowered).toEqual([expect.stringContaining('"a.sh": {"count":1,"codes":{"SC2034":1}}')]);
  });

  it('a new bash file must have 0 findings', () => {
    expect(judge({}, ['new.sh'], [])).toEqual({ failures: [], lowered: [] });
    const { failures } = judge({}, ['new.sh'], [finding('new.sh', 2, 'SC2164')]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('a new bash file must have 0 findings');
    expect(failures[0]).toContain(cite('new.sh', 2, 'SC2164'));
  });

  it('ccd/ccd and ccd/lib are one pin: code moved between them does not trip it, and a new lib file joins the group', () => {
    const pins = { [GROUP]: pinOf({ SC2034: 2 }) };
    const moved = [finding('ccd/ccd', 3, 'SC2034'), finding('ccd/lib/new-split.sh', 9, 'SC2034')];
    expect(judge(pins, ['ccd/ccd', 'ccd/lib/new-split.sh'], moved)).toEqual({ failures: [], lowered: [] });
    const { failures } = judge(pins, ['ccd/ccd', 'ccd/lib/new-split.sh'], [...moved, finding('ccd/lib/new-split.sh', 12, 'SC2034')]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`${GROUP}: 3 findings, pinned at 2`);
  });

  it('a file shellcheck could not parse fails even though its count fell, and is not offered as a lower pin', () => {
    const { failures, lowered } = judge({ 'a.sh': pinOf({ SC2034: 40 }) }, ['a.sh'], [finding('a.sh', 8, 'SC1073'), finding('a.sh', 8, 'SC1072')]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(cite('a.sh', 8, 'SC1072'));
    expect(lowered).toEqual([]);
  });

  it('a pinned file that is gone passes and says to delete its entry', () => {
    const { failures, lowered } = judge({ 'gone.sh': pinOf({ SC2034: 1 }) }, [], []);
    expect(failures).toEqual([]);
    expect(lowered).toEqual([expect.stringContaining('gone.sh: no longer a tracked bash file')]);
  });

  it('reads gcc output, and refuses a line it cannot read rather than undercount', () => {
    expect(parseGcc("ccd/x:12:3: warning: Use 'cd ... || exit' in case cd fails. [SC2164]\n"))
      .toEqual([{ file: 'ccd/x', line: 12, code: 'SC2164', text: "Use 'cd ... || exit' in case cd fails." }]);
    expect(() => parseGcc('something else\n')).toThrow('cannot read');
  });

  it('another version is a printed skip locally and a failure in CI, so a skip never reads as a pass there', () => {
    expect(gate('0.11.0', '0.11.0', false, 'linux')).toEqual({ verdict: 'run' });
    expect(gate('0.11.0', '0.11.0', true, 'linux')).toEqual({ verdict: 'run' });
    expect(gate('0.9.0', '0.11.0', false, 'linux')).toEqual({ verdict: 'skip', reason: expect.stringContaining('shellcheck 0.9.0 is installed') });
    expect(gate(null, '0.11.0', false, 'darwin')).toEqual({ verdict: 'skip', reason: expect.stringContaining('not installed') });
    expect(gate('0.9.0', '0.11.0', true, 'linux')).toEqual({ verdict: 'fail', reason: expect.stringContaining('shellcheck 0.9.0 is installed') });
    expect(gate(null, '0.11.0', true, 'linux')).toEqual({ verdict: 'fail', reason: expect.stringContaining('not installed') });
    expect(gate(null, '0.11.0', true, 'darwin').verdict).toBe('skip');
    expect(gate('0.11.0', '0.11.0', false, 'darwin')).toEqual({ verdict: 'run' });
  });
});

describe('the baseline and its install', () => {
  it('pins one version and one tarball, and each entry\'s codes add up to its count', () => {
    expect(baseline.shellcheckVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(baseline.shellcheckSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const [key, pin] of Object.entries(baseline.files)) {
      expect(Object.values(pin.codes).reduce((a, b) => a + b, 0), key).toBe(pin.count);
    }
  });

  it('the install refuses a tarball whose sha256 is not the pinned one, and puts nothing on PATH', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shellcheck-install-'));
    try {
      const bin = path.join(dir, 'bin');
      mkdirSync(bin);
      // Writes something other than the release to curl's `-o` target.
      writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\nwhile [ "$#" -gt 0 ]; do [ "$1" = -o ] && printf tampered > "$2"; shift; done\n');
      chmodSync(path.join(bin, 'curl'), 0o755);
      const pathFile = path.join(dir, 'github-path');
      writeFileSync(pathFile, '');
      const r = spawnSync(path.join(REPO, '.github/ci/shellcheck-install.sh'), [], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, RUNNER_TEMP: dir, GITHUB_PATH: pathFile },
      });
      expect(r.status).not.toBe(0);
      expect(readFileSync(pathFile, 'utf8')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the tree', () => {
  const now = gate(installedVersion(), baseline.shellcheckVersion, Boolean(process.env.CI), process.platform);
  const live = now.verdict === 'run';
  if (now.verdict === 'skip') tell(`NOT RUN: ${now.reason}`);

  it('has the pinned shellcheck to judge it with', (ctx) => {
    if (now.verdict === 'skip') ctx.skip(now.reason);
    expect(now).toEqual({ verdict: 'run' });
  });

  it.skipIf(!live)('every tracked bash file is at or under its pin, and all of it was parsed', { timeout: 600_000 }, async () => {
    const files = bashFiles();
    // A corpus that went blind would pass every count.
    for (const f of ['ccd/ccd', 'ccd/ccrc', 'ccd/ccrc-doctor-checks', 'install.sh', 'deploy/deploy.sh', '.github/ci/bounded.sh']) expect(files).toContain(f);
    expect(files.some((f) => f.startsWith('ccd/lib/'))).toBe(true);
    const { failures, lowered } = judge(baseline.files, files, await analyse(files, REPO));
    for (const line of lowered) tell(line);
    expect(failures.join('\n\n')).toBe('');
  });

  /** A scratch copy of a pinned file with `lines` appended, judged by the real shellcheck against the real pin. */
  async function judgeCopy(lines: string): Promise<ReturnType<typeof judge>> {
    const file = 'ccd/ccrc-token-sync';
    const dir = mkdtempSync(path.join(tmpdir(), 'shellcheck-ratchet-'));
    try {
      mkdirSync(path.join(dir, 'ccd'));
      copyFileSync(path.join(REPO, file), path.join(dir, file));
      appendFileSync(path.join(dir, file), lines);
      return judge({ [file]: baseline.files[file] }, [file], await analyse([file], dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.skipIf(!live)('red: one more warning in a scratch copy of a pinned file fails and names it', { timeout: 60_000 }, async () => {
    const { failures } = await judgeCopy('\nnever_read_again=1\n');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/ccd\/ccrc-token-sync:\d+:SC2034/);
  });

  // The two findings a parse failure reports are under this pin, so a count alone would pass it as an improvement.
  it.skipIf(!live)('red: a malformed directive in a scratch copy fails as unparsed, though its count fell', { timeout: 60_000 }, async () => {
    expect(baseline.files['ccd/ccrc-token-sync'].count).toBeGreaterThan(2);
    const { failures, lowered } = await judgeCopy('\n# shellcheck disable=SC2086 -- not the syntax\necho "$1"\n');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('stopped parsing');
    expect(lowered).toEqual([]);
  });
});
