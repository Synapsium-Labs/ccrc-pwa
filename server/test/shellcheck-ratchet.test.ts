// The shellcheck ratchet (D-7995): most of the box-side machinery is bash, and nothing linted it. A big-bang cleanup
// would rewrite scripts that work, so this pins what is there and only lets it go down:
//   - each tracked bash file has a pinned count of warning-level findings in shellcheck-baseline.json;
//   - `ccd/ccd` and its libraries, every `ccd/lib/*.sh` but `ccrc-*`, are ONE pin, linted as ONE text (D-8048,
//     the file split's Q3): `spliceCcd` puts each library region back at its `# @ccd-lib:` pointer, shellcheck reads
//     that text once, and each finding is named at the file and line it came from. Summed per file, a split DOES trip
//     the pin: a variable set in ccd/ccd and read in a library reads as unused in one file and unassigned in the other.
//     Over the one text a pure move cannot change the count. Library code no pointer splices back fails by name, so it
//     can never drop out of the lint. `ccd/lib/ccrc-*.sh` keeps a pin of its own: the sweeps source it, ccd does not;
//   - a count above its pin fails and names the lines; a count below it passes and prints the entry to paste;
//   - a bash file with no pin (a new file) must have 0 findings; each intended exception carries a
//     `# shellcheck disable=SCxxxx  # reason` directive (the reason after a second `#`: ` -- reason` is not shellcheck
//     syntax, and it stops the parse);
//   - a file shellcheck could not parse FAILS whatever its count (PARSE_STOPPED lists every code that means it stopped).
//     A parse failure reports a few findings at most and checks nothing after them, so without this rule breaking a
//     file would read as lowering its count. That is how `ccd/ccrc-doctor-checks` went unlinted: five malformed
//     directives, 2 findings, the rest of the file unread.
//
// The counts are only as good as the tool that made them, so the baseline pins the version: another version here is a
// printed skip, and in CI a failure, so a skip can never read as a pass there. server-deps installs that version on
// Linux (.github/ci/shellcheck-install.sh). The macOS CI legs skip: ccd/ccd alone peaks at 6.2 GB (measured on 0.11.0)
// on a 7 GB runner, and the same tool over the same files has nothing to add to the Linux legs.
//
// The whole pass is slow, so it is no guard suite (fast-plan.mjs HEAVY_TREE_READERS): the queue and the full suite run
// it, and a fast pull request runs it only when the map selects it for a file it reads.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { spliceCcd } from './ccdWsHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = 'server/test/shellcheck-baseline.json';
const ROOTS = ['ccd', 'deploy', 'install.sh', '.github/ci'];
/** The pin `ccd/ccd` and its libraries share, linted as one spliced text. It rose once, on the new measure (D-8048, the
 *  operator's ruling Q3 on the file split): 57 summed per file over ccd/ccd and its three libraries (63 with
 *  `ccrc-settings.sh`, which takes its own pin of 6), 82 over the one text. No line changed. shellcheck does not scope
 *  a name by function or by file, so the one text surfaces 37 findings that a file read alone hides (SC2128 14, SC2100
 *  11, SC2178 8, SC2179 3, SC2190 1) and clears 12 that only a file read alone reports (SC2034 12: a name set in one
 *  file and read in another). From here a move between ccd/ccd and a library cannot change the count. */
const GROUP = 'ccd/ccd + ccd/lib';
/** What the spliced program is called inside its scratch directory, where shellcheck reads it. */
const PROGRAM_FILE = 'ccd-program';
/** `--norc` and an empty SHELLCHECK_OPTS: a developer's own settings must not move a count. */
const SHELLCHECK_ARGS = ['--norc', '--shell=bash', '-S', 'warning', '-f', 'gcc'];
/** Two at once. Peak RSS is 6.2 GB for ccd/ccd and 4.1 GB for ccd/ccrc, on a 16 GB runner shared with the shard's
 *  vitest workers; the whole pass takes about 30 s locally and 66 s on a runner at two lanes. */
const LANES = 2;
/**
 * What shellcheck reports when it gave up on a file: everything after that point was not checked. Its parser has two
 * ways out. A construct it could not finish gives SC1072, with SC1073 for that construct. Input left over at the top
 * level gives one of the rest, alone: SC1089 for a stray keyword or closer (`fi`, `done`, `}`, `)`), SC1088 for invalid
 * parentheses, SC1070 for a stray operator (`&&`, `|`, `;`).
 */
const PARSE_STOPPED = new Set(['SC1070', 'SC1072', 'SC1073', 'SC1088', 'SC1089']);

type Finding = { file: string; line: number; code: string; text: string };
type Pin = { count: number; codes: Record<string, number> };
type Pins = Record<string, Pin>;
type Baseline = { shellcheckVersion: string; shellcheckSha256: string; files: Pins };

const baseline = JSON.parse(readFileSync(path.join(REPO, BASELINE), 'utf8')) as Baseline;

/** `ccd/ccd` and every `ccd/lib/*.sh` but the `ccrc-*` ones, which ccd never loads: the growth check's
 *  `isProgramMember`, the same rule. */
const isProgramFile = (file: string): boolean =>
  file === 'ccd/ccd' || (/^ccd\/lib\/[^/]+\.sh$/.test(file) && !path.basename(file).startsWith('ccrc-'));

const pinKey = (file: string): string => (isProgramFile(file) ? GROUP : file);

/** The program's members among `files`, `ccd/ccd` first. */
const programFiles = (files: readonly string[]): string[] =>
  files.filter(isProgramFile).sort((a, b) => (a === 'ccd/ccd' ? -1 : b === 'ccd/ccd' ? 1 : a.localeCompare(b)));

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

type Source = { file: string; text: string };
type Origin = { file: string; line: number };

const MARKER = /^# @ccd-lib:(\w+)$/;
const POINTER = /^# @ccd-lib:(\w+)\b/;
const isCode = (line: string): boolean => line.trim() !== '' && !line.trimStart().startsWith('#');

/**
 * The program as one text, `spliceCcd`'s, with where each of its lines came from. A region is read as `spliceCcd` reads
 * it: the lines after a `# @ccd-lib:<id>` line, up to the next one, less trailing empty lines. `unlinted` names each
 * library code line no pointer splices back (above a library's first marker, or in a region nothing points at). The
 * map is checked against `spliceCcd`'s text line by line, so the two cannot drift apart.
 */
function programText(main: Source, libs: readonly Source[]): { text: string; origin: Origin[]; unlinted: string[] } {
  const text = spliceCcd(main.text, libs.map((l) => l.text));
  const regions = new Map<string, { lines: string[]; origin: Origin[] }>();
  const outside: { line: string; at: Origin }[] = [];
  for (const lib of libs) {
    let cur: { lines: string[]; origin: Origin[] } | null = null;
    lib.text.split('\n').forEach((line, i) => {
      const m = MARKER.exec(line);
      if (m) { cur = { lines: [], origin: [] }; regions.set(m[1]!, cur); return; }
      if (cur === null) { outside.push({ line, at: { file: lib.file, line: i + 1 } }); return; }
      cur.lines.push(line);
      cur.origin.push({ file: lib.file, line: i + 1 });
    });
  }
  for (const r of regions.values()) {
    while (r.lines.length > 0 && r.lines[r.lines.length - 1] === '') { r.lines.pop(); r.origin.pop(); }
  }
  const lines: string[] = [];
  const origin: Origin[] = [];
  const used = new Set<string>();
  main.text.split('\n').forEach((line, i) => {
    const id = POINTER.exec(line)?.[1];
    const r = id === undefined ? undefined : regions.get(id);
    if (r === undefined || r.lines.length === 0) {
      lines.push(r === undefined ? line : '');
      origin.push({ file: main.file, line: i + 1 });
      if (r !== undefined) used.add(id!);
      return;
    }
    used.add(id!);
    lines.push(...r.lines);
    origin.push(...r.origin);
  });
  if (lines.join('\n') !== text) throw new Error('the program\'s line map does not give spliceCcd\'s text');
  const unlinted = [
    ...outside.filter((o) => isCode(o.line)).map((o) => o.at),
    ...[...regions].filter(([id]) => !used.has(id)).flatMap(([, r]) => r.origin.filter((_, k) => isCode(r.lines[k]!))),
  ].map((o) => `${o.file}:${o.line}`);
  return { text, origin, unlinted };
}

/** Each finding in the spliced program, named at the file and line it came from. */
function mapBack(found: readonly Finding[], origin: readonly Origin[]): Finding[] {
  return found.map((f) => {
    const at = origin[f.line - 1];
    if (at === undefined) throw new Error(`a finding at line ${f.line} of the spliced program maps to no file: ${f.code} ${f.text}`);
    return { ...f, file: at.file, line: at.line };
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

/** The program, `ccd/ccd` and `libs`, spliced into one scratch file, linted once and mapped back. */
async function lintProgram(libs: readonly string[], cwd: string): Promise<Finding[]> {
  const read = (file: string): Source => ({ file, text: readFileSync(path.join(cwd, file), 'utf8') });
  const p = programText(read('ccd/ccd'), libs.map(read));
  if (p.unlinted.length > 0) {
    throw new Error(`library code that no \`# @ccd-lib:\` pointer in ccd/ccd splices back, so the lint would never read it: ${p.unlinted.join(', ')}`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'shellcheck-program-'));
  try {
    writeFileSync(path.join(dir, PROGRAM_FILE), p.text);
    return mapBack(await shellcheck(PROGRAM_FILE, dir), p.origin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every file, the largest first so the long ones do not end up alone at the tail. The program's members are one job,
 *  `lintProgram`, when `ccd/ccd` is among them. */
async function analyse(files: string[], cwd: string): Promise<Finding[]> {
  const size = (f: string): number => statSync(path.join(cwd, f)).size;
  const members = programFiles(files);
  const whole = members[0] === 'ccd/ccd';
  const jobs: { size: number; run: () => Promise<Finding[]> }[] = [
    ...files.filter((f) => !whole || !members.includes(f)).map((f) => ({ size: size(f), run: () => shellcheck(f, cwd) })),
    ...(whole ? [{ size: members.reduce((n, f) => n + size(f), 0), run: () => lintProgram(members.slice(1), cwd) }] : []),
  ];
  const queue = jobs.sort((a, b) => b.size - a.size);
  const found: Finding[] = [];
  const lane = async (): Promise<void> => {
    for (let j = queue.shift(); j !== undefined; j = queue.shift()) found.push(...await j.run());
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

  it('ccd/lib/ccrc-*.sh is its own pin: the sweeps source it, ccd does not, so it is no part of the program', () => {
    expect(pinKey('ccd/ccd')).toBe(GROUP);
    expect(pinKey('ccd/lib/disk-retention.sh')).toBe(GROUP);
    expect(pinKey('ccd/lib/a-future-slice.sh')).toBe(GROUP);
    expect(pinKey('ccd/lib/ccrc-settings.sh')).toBe('ccd/lib/ccrc-settings.sh');
    expect(pinKey('ccd/ccrc')).toBe('ccd/ccrc');
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

  // These three come alone, with no SC1072 or SC1073 beside them, and a single finding is well under most pins.
  it.each(['SC1070', 'SC1088', 'SC1089'])('%s is a parse stop too: it fails, and is not offered as a lower pin', (code) => {
    const { failures, lowered } = judge({ 'a.sh': pinOf({ SC2034: 40 }) }, ['a.sh'], [finding('a.sh', 8, code)]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('stopped parsing');
    expect(failures[0]).toContain(cite('a.sh', 8, code));
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

describe('the program is linted as one text', () => {
  const MAIN = ['#!/usr/bin/env bash', 'limit=5', 'f() {', '  local unused=1', '  echo "$limit"', '}', 'f', ''].join('\n');
  const MOVED_MAIN = ['#!/usr/bin/env bash', 'limit=5', '# @ccd-lib:f', 'f', ''].join('\n');
  const MOVED_LIB = ['# ccd/lib/moved.sh: a header', '# @ccd-lib:f', 'f() {', '  local unused=1', '  echo "$limit"', '}', ''].join('\n');

  it('FIXTURE: the spliced text is spliceCcd\'s, and every line of it maps back to the file and line it came from', () => {
    const p = programText({ file: 'ccd/ccd', text: MOVED_MAIN }, [{ file: 'ccd/lib/moved.sh', text: MOVED_LIB }]);
    expect(p.text).toBe(MAIN);
    expect(p.origin.slice(0, 7)).toEqual([
      { file: 'ccd/ccd', line: 1 }, { file: 'ccd/ccd', line: 2 },
      { file: 'ccd/lib/moved.sh', line: 3 }, { file: 'ccd/lib/moved.sh', line: 4 }, { file: 'ccd/lib/moved.sh', line: 5 },
      { file: 'ccd/lib/moved.sh', line: 6 }, { file: 'ccd/ccd', line: 4 },
    ]);
    expect(p.unlinted).toEqual([]);
    expect(mapBack([finding('program.sh', 4, 'SC2034')], p.origin)).toEqual([finding('ccd/lib/moved.sh', 4, 'SC2034')]);
    expect(() => mapBack([finding('program.sh', 99, 'SC2034')], p.origin)).toThrow('maps to no file');
  });

  it('FIXTURE: library code no pointer splices back is named, never silently left out of the lint', () => {
    const orphan = `${MOVED_LIB}# @ccd-lib:nowhere\ng() {\n  :\n}\n`;
    const p = programText({ file: 'ccd/ccd', text: MOVED_MAIN }, [{ file: 'ccd/lib/moved.sh', text: orphan }]);
    // Built, not spelled, as `cite` is: `citations.test.ts` reads a literal file and line as a line citation.
    const at = (line: number): string => ['ccd/lib/moved.sh', line].join(':');
    expect(p.unlinted).toEqual([at(8), at(9), at(10)]);
    // Code above a library's first marker is outside every region too.
    const above = programText({ file: 'ccd/ccd', text: MOVED_MAIN }, [{ file: 'ccd/lib/moved.sh', text: `x=1\n${MOVED_LIB}` }]);
    expect(above.unlinted).toEqual([at(1)]);
  });

  it('REAL: every line of the spliced program maps back to the line it came from, and no library code is left out', () => {
    const libs = programFiles(bashFiles()).filter((f) => f !== 'ccd/ccd');
    expect(libs.length, 'the tree holds libraries').toBeGreaterThan(0);
    const read = (file: string) => ({ file, text: readFileSync(path.join(REPO, file), 'utf8') });
    const p = programText(read('ccd/ccd'), libs.map(read));
    expect(p.unlinted).toEqual([]);
    const lines = p.text.split('\n');
    const texts = new Map(['ccd/ccd', ...libs].map((f) => [f, read(f).text.split('\n')]));
    const wrong = p.origin.flatMap((o, i) => (texts.get(o.file)![o.line - 1] === lines[i] ? [] : [`${i + 1} -> ${o.file}:${o.line}`]));
    expect(wrong).toEqual([]);
    for (const lib of libs.filter((f) => /^# @ccd-lib:/m.test(read(f).text))) expect(p.origin.some((o) => o.file === lib), lib).toBe(true);
  });

  it.skipIf(gate(installedVersion(), baseline.shellcheckVersion, Boolean(process.env.CI), process.platform).verdict !== 'run')(
    'FIXTURE: moving a function between ccd/ccd and a library leaves the count alone', { timeout: 60_000 }, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'shellcheck-program-'));
      try {
        const lint = async (files: Record<string, string>): Promise<{ program: Finding[]; perFile: Finding[] }> => {
          rmSync(path.join(dir, 'ccd'), { recursive: true, force: true });
          mkdirSync(path.join(dir, 'ccd/lib'), { recursive: true });
          for (const [f, t] of Object.entries(files)) writeFileSync(path.join(dir, f), t);
          const names = Object.keys(files);
          const perFile = (await Promise.all(names.map((f) => shellcheck(f, dir)))).flat();
          return { program: await analyse(names, dir), perFile };
        };
        const before = await lint({ 'ccd/ccd': MAIN });
        const after = await lint({ 'ccd/ccd': MOVED_MAIN, 'ccd/lib/moved.sh': MOVED_LIB });
        expect(before.program.map((f) => cite(f.file, f.line, f.code))).toEqual([cite('ccd/ccd', 4, 'SC2034')]);
        expect(after.program.map((f) => cite(f.file, f.line, f.code)), 'the same finding, named where it now sits')
          .toEqual([cite('ccd/lib/moved.sh', 4, 'SC2034')]);
        // Summed per file, the same move reads `limit` as unused in one file and unassigned in the other.
        expect(after.perFile.length).toBeGreaterThan(before.perFile.length);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
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

  /**
   * The real install script in a scratch tree, over a stand-in for the download: a real `.tar.xz` laid out like the
   * release, so curl and tar both succeed and the sum alone decides. `pinnedSum` makes the scratch baseline's sum from
   * the stand-in's true one.
   */
  function installStandIn(pinnedSum: (actual: string) => string): { status: number | null; output: string; onPath: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'shellcheck-install-'));
    try {
      const version = baseline.shellcheckVersion;
      const member = path.join(dir, 'release', `shellcheck-v${version}`);
      mkdirSync(member, { recursive: true });
      writeFileSync(path.join(member, 'shellcheck'), '#!/usr/bin/env bash\n');
      const tarball = path.join(dir, 'stand-in.tar.xz');
      execFileSync('tar', ['-cJf', tarball, '-C', path.join(dir, 'release'), `shellcheck-v${version}`]);
      const actual = createHash('sha256').update(readFileSync(tarball)).digest('hex');

      const bin = path.join(dir, 'bin');
      mkdirSync(bin);
      // Copies the stand-in to curl's `-o` target.
      writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash\nwhile [ "$#" -gt 0 ]; do [ "$1" = -o ] && cp '${tarball}' "$2"; shift; done\n`);
      chmodSync(path.join(bin, 'curl'), 0o755);

      const script = path.join(dir, 'tree/.github/ci/shellcheck-install.sh');
      const pins = path.join(dir, 'tree/server/test/shellcheck-baseline.json');
      mkdirSync(path.dirname(script), { recursive: true });
      mkdirSync(path.dirname(pins), { recursive: true });
      copyFileSync(path.join(REPO, '.github/ci/shellcheck-install.sh'), script);
      chmodSync(script, 0o755);
      writeFileSync(pins, JSON.stringify({ ...baseline, shellcheckSha256: pinnedSum(actual) }));

      const pathFile = path.join(dir, 'github-path');
      writeFileSync(pathFile, '');
      const r = spawnSync(script, [], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, RUNNER_TEMP: dir, GITHUB_PATH: pathFile },
      });
      return { status: r.status, output: `${r.stdout}${r.stderr}`, onPath: readFileSync(pathFile, 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the install takes a tarball whose sha256 is the pinned one and puts it on PATH', () => {
    const { status, output, onPath } = installStandIn((actual) => actual);
    expect(output).not.toContain('FAILED');
    expect(status).toBe(0);
    expect(onPath).toContain('ccrc-shellcheck');
  });

  // The same tarball as the case above, so the sum is all that differs: without the check it would install.
  it('the install refuses a tarball whose sha256 is not the pinned one, and puts nothing on PATH', () => {
    const { status, output, onPath } = installStandIn((actual) => (actual.startsWith('0') ? '1' : '0') + actual.slice(1));
    expect(status).not.toBe(0);
    expect(output).toContain('FAILED');
    expect(onPath).toBe('');
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

  /** A scratch copy of a pinned file after `edit`, judged by the real shellcheck against the real pin. */
  async function judgeCopy(edit: (text: string) => string): Promise<ReturnType<typeof judge>> {
    const file = 'ccd/ccrc-token-sync';
    const dir = mkdtempSync(path.join(tmpdir(), 'shellcheck-ratchet-'));
    try {
      mkdirSync(path.join(dir, 'ccd'));
      writeFileSync(path.join(dir, file), edit(readFileSync(path.join(REPO, file), 'utf8')));
      return judge({ [file]: baseline.files[file] }, [file], await analyse([file], dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.skipIf(!live)('red: one more warning in a scratch copy of a pinned file fails and names it', { timeout: 60_000 }, async () => {
    const { failures } = await judgeCopy((text) => `${text}\nnever_read_again=1\n`);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/ccd\/ccrc-token-sync:\d+:SC2034/);
  });

  // The two findings a parse failure reports are under this pin, so a count alone would pass it as an improvement.
  it.skipIf(!live)('red: a malformed directive in a scratch copy fails as unparsed, though its count fell', { timeout: 60_000 }, async () => {
    expect(baseline.files['ccd/ccrc-token-sync'].count).toBeGreaterThan(2);
    const { failures, lowered } = await judgeCopy((text) => `${text}\n# shellcheck disable=SC2086 -- not the syntax\necho "$1"\n`);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('stopped parsing');
    expect(lowered).toEqual([]);
  });

  // Each of shellcheck's ways out of a file before its end, against the real tool, on line 2: what it reports there is
  // under the pin, so a code missing from PARSE_STOPPED reads as a file that improved. Together with SC1072 and SC1073
  // above, this pins the list to what this version actually does.
  it.skipIf(!live).each([
    ['a stray keyword', 'fi', 'SC1089'],
    ['a stray closing brace', '}', 'SC1089'],
    ['invalid parentheses', '=(', 'SC1088'],
    ['a stray operator', '&&', 'SC1070'],
  ])('red: %s at the top of a scratch copy fails as unparsed, though its count fell', { timeout: 60_000 }, async (_what, stray, code) => {
    const { failures, lowered } = await judgeCopy((text) => {
      const line2 = text.indexOf('\n') + 1;
      return `${text.slice(0, line2)}${stray}\n${text.slice(line2)}`;
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('stopped parsing');
    expect(failures[0]).toContain(cite('ccd/ccrc-token-sync', 2, code));
    expect(lowered).toEqual([]);
  });
});
