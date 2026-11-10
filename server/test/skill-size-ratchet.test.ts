// The skill-size ratchet: every shipped skill file (every .md under a ccd/*-skill directory)
// is capped in bytes. A cap only falls, except in a pull request that appends a pinned contract
// clause to a SKILL.md, which may raise that SKILL.md's cap by that clause's whole line in bytes.
//
// The rules are:
//   R1: every skill file has a cap, and every cap names a skill file;
//   R2: each file is at or under its cap (print the entry to lower when under);
//   R3: a cap new on this branch must equal its file's size at HEAD;
//   R4: a cap the merge-base holds may rise by at most the file's clause allowance;
//   R5: a file the merge-base holds may grow by at most the file's clause allowance.
// Without origin/main, only R1 and R2 run, with a printed notice.
//
// A clause's bytes are the UTF-8 bytes of its whole numbered line, number and newline included,
// for every line numbered past the merge-base's highest clause in the SKILL.md's `## The contract`
// section. A first contract earns nothing, because no pin suite stands behind it yet. The three
// skills that already have pinned clauses have suites that check `1..N` with no gaps, so a
// numbered contract line is what counts as a pinned clause.
//
// Lower a cap by editing skill-size-caps.json down to the size the R2 lowered message prints.
// Raise a cap only by the bytes of the clause line a pull request appends.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mergeBaseFiles, treeEntriesAt } from './mergeBase.js';

type Caps = Record<string, number>;
type Sizes = Record<string, number>;
type Base = { caps: Caps | 'absent'; sizes: Sizes };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPS = 'server/test/skill-size-caps.json';
const SKILL_FILE = /^ccd\/[^/]+-skill\/.+\.md$/;

function readCaps(text: string): Caps {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('no "files" object');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Object.hasOwn(obj, 'files') || typeof obj.files !== 'object' || obj.files === null || Array.isArray(obj.files)) {
    throw new Error('no "files" object');
  }
  const files = obj.files as Record<string, unknown>;
  const out: Caps = {};
  for (const [file, value] of Object.entries(files)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`${file}: ${JSON.stringify(value)} is not a whole number of bytes`);
    }
    out[file] = value;
  }
  return out;
}

function contractClauses(text: string): Map<number, string> {
  const heading = '## The contract';
  const start = text.indexOf(heading);
  if (start === -1) return new Map();
  const afterHeading = start + heading.length;
  const end = text.indexOf('\n## ', afterHeading);
  const section = end === -1 ? text.slice(start) : text.slice(start, end);
  const clauses = new Map<number, string>();
  const re = /^(\d+)\. .*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    clauses.set(Number(m[1]), m[0]);
  }
  return clauses;
}

function clauseAllowance(file: string, baseText: string | null, headText: string): number {
  if (!file.endsWith('/SKILL.md')) return 0;
  if (baseText === null) return 0;
  const baseClauses = contractClauses(baseText);
  if (baseClauses.size === 0) return 0;
  const headClauses = contractClauses(headText);
  const lastBase = Math.max(...baseClauses.keys());
  let allowance = 0;
  for (const [n, line] of headClauses) {
    if (n > lastBase) allowance += Buffer.byteLength(`${line}\n`);
  }
  return allowance;
}

function judge(
  caps: Caps,
  sizes: Sizes,
  base: Base | null,
  allowance: Record<string, number>,
): { failures: string[]; lowered: string[] } {
  const failures: string[] = [];
  const lowered: string[] = [];
  const keys = [...new Set([...Object.keys(caps), ...Object.keys(sizes)])].sort();
  for (const file of keys) {
    const cap = caps[file];
    const size = sizes[file];
    if (cap === undefined) {
      failures.push(`${file}: a skill file with no cap. Add "${file}": ${size} to server/test/skill-size-caps.json`);
      continue;
    }
    if (size === undefined) {
      failures.push(`${file}: capped, but no longer a skill file. Delete its entry`);
      continue;
    }
    if (size > cap) {
      failures.push(`${file}: ${size} bytes, capped at ${cap}. Lower it or add a clause.`);
    } else if (size < cap) {
      lowered.push(`${file}: ${size} bytes, under its cap of ${cap}. Lower its entry to "${file}": ${size}`);
    }
    if (base === null) continue;
    const baseCaps = base.caps === 'absent' ? {} : base.caps;
    if (!(file in baseCaps)) {
      if (cap !== size) {
        failures.push(`${file}: a new cap must be its file's size, ${size}; it is ${cap}`);
      }
      continue;
    }
    const baseCap = baseCaps[file]!;
    const allow = allowance[file] ?? 0;
    if (cap > baseCap + allow) {
      failures.push(`${file}: cap ${cap} rose past ${baseCap} on main, more than the ${allow} bytes of the clauses this branch adds`);
    }
    if (file in base.sizes) {
      const baseSize = base.sizes[file]!;
      const delta = size - baseSize;
      if (delta > allow) {
        failures.push(`${file}: grew by ${delta} bytes against main, more than the ${allow} bytes of the clauses this branch adds`);
      }
    }
  }
  return { failures, lowered };
}

function skillFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'ccd'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter((f) => f !== '' && SKILL_FILE.test(f) && lstatSync(path.join(REPO, f), { throwIfNoEntry: false })?.isFile());
}

const tell = (line: string): void => { writeSync(2, `skill-size ratchet: ${line}\n`); };

function baseView(): (Base & { texts: Record<string, string> }) | null {
  const baseInfo = mergeBaseFiles(REPO, 'ccd');
  if (baseInfo === null) return null;
  const { base } = baseInfo;
  const sizes: Sizes = {};
  const texts: Record<string, string> = {};
  for (const e of baseInfo.entries) {
    if (e.type !== 'blob' || e.mode === '120000' || !SKILL_FILE.test(e.path)) continue;
    const bytes = execFileSync('git', ['show', `${base}:${e.path}`], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
    });
    sizes[e.path] = bytes.length;
    if (e.path.endsWith('/SKILL.md')) texts[e.path] = bytes.toString('utf8');
  }
  const capsEntries = treeEntriesAt(REPO, base, 'server/test');
  if (capsEntries === null) throw new Error(`skill-size ratchet: could not list server/test at ${base}`);
  const capEntry = capsEntries.find((e) => e.path === CAPS);
  const caps: Caps | 'absent' = capEntry === undefined
    ? 'absent'
    : readCaps(execFileSync('git', ['show', `${base}:${CAPS}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));
  return { caps, sizes, texts };
}

const F = 'ccd/x-skill/SKILL.md';
const R = 'ccd/x-skill/references/r.md';
const line = (n: number, text: string): string => `${n}. ${text}\n`;
const doc = (...clauses: string[]): string =>
  `---\nname: x\n---\n## The contract\n\n${clauses.join('')}\n## Steps\n\n1. a step, not a clause\n`;
const one = line(1, 'One.');
const two = line(2, 'Two.');

describe('the clause allowance', () => {
  it('is the bytes of each clause appended past the base\'s last, number and newline included', () => {
    const added = line(3, 'Three, with a ’ curly apostrophe.');
    const a = clauseAllowance(F, doc(one, two), doc(one, two, added));
    expect(a).toBe(Buffer.byteLength(added));
    expect(a).toBe(added.length + 2); // the curly apostrophe is three bytes: bytes, not characters
  });
  it('a reworded clause earns nothing', () => {
    expect(clauseAllowance(F, doc(one, two), doc(one, line(2, 'Two, now much longer.')))).toBe(0);
  });
  it('a clause removed and another added at the same count earn nothing', () => {
    expect(clauseAllowance(F, doc(one, two), doc(one, line(2, 'Another.')))).toBe(0);
  });
  it('a numbered line outside the contract section earns nothing', () => {
    expect(clauseAllowance(F, doc(one), `${doc(one)}2. another step\n`)).toBe(0);
  });
  it('a reference file, and a SKILL.md new on this branch, earn nothing', () => {
    expect(clauseAllowance(R, doc(one), doc(one, two))).toBe(0);
    expect(clauseAllowance(F, null, doc(one, two))).toBe(0);
  });
  it('a contract new to a SKILL.md earns nothing: no pin suite stands behind its clauses yet', () => {
    expect(clauseAllowance(F, '---\nname: x\n---\nprose\n', doc(one, two))).toBe(0);
    expect(clauseAllowance(F, doc(), doc(one, two))).toBe(0);
  });
});

describe('the caps file', () => {
  it('a caps file that is not whole bytes is refused', () => {
    expect(readCaps(`{ "files": { "${F}": 90 } }`)).toEqual({ [F]: 90 });
    for (const bad of ['"90"', '90.5', '-1', 'null']) {
      expect(() => readCaps(`{ "files": { "${F}": ${bad} } }`)).toThrow(F);
    }
    expect(() => readCaps('{}')).toThrow('files');
  });
});

describe('the ratchet rules', () => {
  const at = (caps: Caps, sizes: Sizes): Base => ({ caps, sizes });
  it('a file at its cap passes silently', () => {
    expect(judge({ [F]: 100 }, { [F]: 100 }, null, {})).toEqual({ failures: [], lowered: [] });
  });
  it('a file over its cap fails and names both numbers', () => {
    const { failures } = judge({ [F]: 100 }, { [F]: 101 }, null, {});
    expect(failures).toEqual([expect.stringContaining(`${F}: 101 bytes, capped at 100`)]);
  });
  it('a file under its cap passes and prints the entry to lower', () => {
    expect(judge({ [F]: 100 }, { [F]: 90 }, null, {}))
      .toEqual({ failures: [], lowered: [expect.stringContaining(`"${F}": 90`)] });
  });
  it('every skill file has a cap, and every cap names a skill file', () => {
    expect(judge({}, { [F]: 1 }, null, {}).failures).toEqual([expect.stringContaining(`"${F}": 1`)]);
    expect(judge({ [F]: 1 }, {}, null, {}).failures).toEqual([expect.stringContaining('no longer a skill file')]);
  });
  it('a cap new on this branch must equal its file\'s measured size', () => {
    for (const base of [at({}, {}), { caps: 'absent' as const, sizes: {} }]) {
      expect(judge({ [F]: 100 }, { [F]: 90 }, base, {}).failures)
        .toEqual([expect.stringContaining('a new cap must be its file\'s size, 90')]);
      expect(judge({ [F]: 90 }, { [F]: 90 }, base, {}).failures).toEqual([]);
    }
  });
  it('a cap and its file may rise by the bytes of the clauses this branch adds, and not one byte more', () => {
    const base = at({ [F]: 100 }, { [F]: 100 });
    expect(judge({ [F]: 150 }, { [F]: 150 }, base, { [F]: 50 }).failures).toEqual([]);
    const { failures } = judge({ [F]: 151 }, { [F]: 151 }, base, { [F]: 50 });
    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toContain(`${F}: cap 151 rose past 100`);
    expect(failures.join('\n')).toContain(`${F}: grew by 51`);
  });
  it('a cap raised with no clause added fails, though the file did not grow', () => {
    expect(judge({ [F]: 120 }, { [F]: 100 }, at({ [F]: 100 }, { [F]: 100 }), {}).failures)
      .toEqual([expect.stringContaining('rose past 100')]);
  });
  it('a file that grows into slack under its cap fails: growth is measured against main, not the cap', () => {
    expect(judge({ [F]: 100 }, { [F]: 90 }, at({ [F]: 100 }, { [F]: 80 }), {}).failures)
      .toEqual([expect.stringContaining(`${F}: grew by 10`)]);
  });
  it('a reference earns nothing from its SKILL.md\'s clause', () => {
    expect(judge({ [R]: 110 }, { [R]: 110 }, at({ [R]: 100 }, { [R]: 100 }), { [F]: 50 }).failures)
      .toHaveLength(2);
  });
  it('a split passes: the SKILL.md shrinks and the new reference starts at its size', () => {
    expect(judge({ [F]: 60, [R]: 40 }, { [F]: 60, [R]: 40 }, at({ [F]: 100 }, { [F]: 100 }), {}))
      .toEqual({ failures: [], lowered: [] });
  });
  it('without a merge-base only R1 and R2 run', () => {
    expect(judge({ [F]: 120 }, { [F]: 100 }, null, {}).failures).toEqual([]);
  });
});

describe('the tree', () => {
  const caps = readCaps(readFileSync(path.join(REPO, CAPS), 'utf8'));
  const sizes = Object.fromEntries(skillFiles().map((f) => [f, readFileSync(path.join(REPO, f)).length]));
  const COORD = 'ccd/coordinator-skill/SKILL.md';

  it('the corpus is every .md under a ccd/*-skill directory, and it is not blind', () => {
    const files = skillFiles();
    for (const f of [COORD, 'ccd/worker-skill/SKILL.md', 'ccd/reviewer-skill/SKILL.md',
      'ccd/coordinator-skill/references/wave-lifecycle.md']) expect(files).toContain(f);
    expect(files.every((f) => SKILL_FILE.test(f))).toBe(true);
  });

  it('every skill file has a cap and is at or under it', () => {
    const { failures, lowered } = judge(caps, sizes, null, {});
    for (const l of lowered) tell(l);
    expect(failures.join('\n')).toBe('');
  });

  it('against main, no cap rose and no file grew past the bytes of the clauses this branch adds', (ctx) => {
    const base = baseView();
    if (base === null) { tell('skipped the merge-base rules: no origin/main or merge-base'); ctx.skip(); return; }
    const allowance = Object.fromEntries(Object.keys(sizes).map((f) =>
      [f, clauseAllowance(f, base.texts[f] ?? null, readFileSync(path.join(REPO, f), 'utf8'))]));
    expect(judge(caps, sizes, base, allowance).failures.join('\n')).toBe('');
  });

  it('red: one byte past the real coordinator cap fails', () => {
    expect(judge(caps, { ...sizes, [COORD]: caps[COORD]! + 1 }, null, {}).failures)
      .toEqual([expect.stringContaining(`${COORD}: ${caps[COORD]! + 1} bytes, capped at ${caps[COORD]}`)]);
  });

  it('red: the real last clause, taken off the base, earns exactly its own bytes', () => {
    const head = readFileSync(path.join(REPO, COORD), 'utf8');
    const last = [...contractClauses(head).values()].at(-1)!;
    expect(clauseAllowance(COORD, head.replace(`${last}\n`, ''), head)).toBe(Buffer.byteLength(`${last}\n`));
  });
});
