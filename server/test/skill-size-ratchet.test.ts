import { describe, expect, it } from 'vitest';

type Caps = Record<string, number>;
type Sizes = Record<string, number>;
type Base = { caps: Caps | 'absent'; sizes: Sizes };

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
