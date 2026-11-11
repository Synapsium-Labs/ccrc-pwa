// D-5867 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1l PR 2; ARCH-66
// (#801); the history coordinator's ack, which names R11). The characterization pin for the move of `ccd/history/lib.mjs`'s
// two rule sets into `shared/redact.mjs`, green on main before the move and through it:
//   - the rule sets byte for byte: `BASE_RULES` (the rev 3.6 rules, R11's base) and `CONTEXT_RULES` (the widened rules),
//     each form's every rule as its regular expression's source and flags, in key order, read through an instrumented copy
//     of lib.mjs (production keeps both private), against `fixtures/history/context-rules.json`, captured before the move;
//   - every redaction door's output, its base reading and its v2 reading over a broad corpus (the (j3) table, two seeded
//     corpora, the egress corpus's inputs and outputs, the docs fixture's strings), under an empty pair index and one that
//     holds planted values, as one digest taken before the move.
// A rule whose bytes change, a rule moved into the wrong set, or a door whose reading moves reds one of them.
import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { f2Cases } from './fixtures/history/f2Cases.js';
import * as lib from '../../ccd/history/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const LIB = path.join(REPO, 'ccd', 'history', 'lib.mjs');

type RuleDump = Record<string, boolean | [string, string]>;
type SetDump = { field: RuleDump; final: RuleDump };
const FIXTURE: { BASE_RULES: SetDump; CONTEXT_RULES: SetDump } =
  JSON.parse(readFileSync(path.join(here, 'fixtures', 'history', 'context-rules.json'), 'utf8'));

/** A rule set as the fixture holds it: each key in order, a regular expression as `[source, flags]`, `final` as it is. */
const dumpSet = (set: Record<string, Record<string, unknown>>): SetDump => {
  const form = (rules: Record<string, unknown>): RuleDump => Object.fromEntries(Object.entries(rules)
    .map(([k, v]) => [k, v instanceof RegExp ? [v.source, v.flags] : v as boolean]));
  return { field: form(set.field!), final: form(set.final!) };
};

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** lib.mjs's two private rule sets, read through a temporary copy of its bytes with ONE appended export statement. The copy
 *  lives where lib's relative `../../shared/` specifiers do not resolve, so each is rewritten to the shared file's URL. */
const privateRuleSets = async (): Promise<{ BASE_RULES: Record<string, Record<string, unknown>>; CONTEXT_RULES: Record<string, Record<string, unknown>> }> => {
  const dir = mkTmp('ccrc-history-redact-pin-');
  dirs.push(dir);
  const bytes = readFileSync(LIB, 'utf8');
  let rewritten = 0;
  const src = bytes.replace(/'\.\.\/\.\.\/shared\/([A-Za-z0-9_-]+\.mjs)'/g, (_m, f: string) => {
    rewritten += 1;
    return JSON.stringify(pathToFileURL(path.join(REPO, 'shared', f)).href);
  });
  expect(rewritten, 'CONTROL: lib names a shared file').toBeGreaterThan(0);
  const copy = path.join(dir, 'lib-rules.mjs');
  writeFileSync(copy, `${src}\nexport { BASE_RULES as __BASE_RULES, CONTEXT_RULES as __CONTEXT_RULES };\n`);
  const m = await import(/* @vite-ignore */ `${pathToFileURL(copy).href}?pin=${process.pid}-${Date.now()}`) as Record<string, never>;
  return { BASE_RULES: m.__BASE_RULES, CONTEXT_RULES: m.__CONTEXT_RULES };
};

describe('the history rule sets, byte for byte, as main builds them (D-5867, C1l PR 2 characterization)', () => {
  it('BASE_RULES and CONTEXT_RULES are the captured rule sets: every key, in order, every source and flag', async () => {
    const sets = await privateRuleSets();
    expect(Object.keys(sets.BASE_RULES), 'CONTROL: two forms').toEqual(['field', 'final']);
    expect(dumpSet(sets.BASE_RULES)).toEqual(FIXTURE.BASE_RULES);
    expect(dumpSet(sets.CONTEXT_RULES)).toEqual(FIXTURE.CONTEXT_RULES);
    for (const set of [sets.BASE_RULES, sets.CONTEXT_RULES]) {
      expect(Object.isFrozen(set), 'a rule set is frozen').toBe(true);
      expect(Object.isFrozen(set.field) && Object.isFrozen(set.final), 'each form is frozen').toBe(true);
      expect([set.field!.final, set.final!.final], 'each form carries its `final`').toEqual([false, true]);
    }
  });
  it('CONTROL: the two sets differ in one rule, the named value\'s field form, which the base reads with v1\'s class', () => {
    const differ = (form: 'field' | 'final'): string[] => Object.keys(FIXTURE.BASE_RULES[form])
      .filter((k) => JSON.stringify(FIXTURE.BASE_RULES[form][k]) !== JSON.stringify(FIXTURE.CONTEXT_RULES[form][k]));
    expect(differ('field')).toEqual(['namedValue']);
    expect(differ('final')).toEqual([]);
    expect(FIXTURE.BASE_RULES.field.namedValue).toEqual([String.raw`(["']?)([^\s"'` + '`' + ',;&]+)', 'y']);
  });
});

/** A seeded generator (mulberry32). */
const rng = (seed0: number): (() => number) => {
  let seed = seed0;
  return (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
/** Seeded texts of every shape a history rule reads (a secret NAME= and NAME: pair, quoted, escaped, unclosed and glued; a
 *  JSON pair, raw and escaped; the Bearer and box-token headers; the token query), with colour sequences in some, glue and
 *  noise, some JSON-serialised. Values are plain words, never key-shaped literals (the repository is public). */
const corpus = (seed0: number, n: number): string[] => {
  const rnd = rng(seed0);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const NAMES = ['password', 'PASSWORD', 'TOKEN', 'api_key', 'SECRET_KEY', 'token', 'secret', 'auth', 'private_key', 'path', 'user'];
  const KEYS = ['api_key', 'token', 'password', 'secret', 'name'];
  const GLUE = ['', ',', ';', '&', ')', '}', ']', '|', '/', ':', "'", '"', ' ', '\\n', '\\"', '<', '>', '\\\\'];
  const SEQS = ['\x1b[0m', '\x1b[32m', '\x1b[1;31m'];
  const cut = (s: string): string => { const k = 1 + Math.floor(rnd() * (s.length - 1)); return `${s.slice(0, k)}${pick(SEQS)}${s.slice(k)}`; };
  const FR: Array<(v: string) => string> = [
    (v) => `${pick(NAMES)}=${v}`, (v) => `${pick(NAMES)}: ${v}`, (v) => `${pick(NAMES)}="${v}"`, (v) => `${pick(NAMES)}='${v} more'`,
    (v) => `${pick(NAMES)}=\\"${v}\\"`, (v) => `${pick(NAMES)}=ab${pick(GLUE)}${v}`, (v) => `"${pick(KEYS)}": "${v}"`,
    (v) => `"${pick(KEYS)}":"${v}`, (v) => `\\"${pick(KEYS)}\\": \\"${v}\\"`, (v) => `${pick(NAMES)}="${pick(KEYS)}: "${v}`,
    (v) => `Authorization: Bearer ${v}`, (v) => `authorization:\tbearer ${v}<b>`, (v) => `x-ccrc-mail-token: ${v}`,
    (v) => `X-CCRC-MAIL-TOKEN:  ${v}&x`, (v) => `x?token=${v}&b=1`, (v) => `/p?a=1&TOKEN=${v}#frag`,
    (v) => `${cut(pick(NAMES))}=${v}`, (v) => `${pick(NAMES)}=${cut(v)}`, (v) => `${pick(NAMES)}=abc&${v}`,
    (v) => `see ${v} here`, () => 'plain words here', () => '\n', () => 'level=INFO path=/a/b', () => 'url?a=1&b=2',
  ];
  let vn = 0;
  return Array.from({ length: n }, () => {
    let t = '';
    for (let i = 0, k = 1 + Math.floor(rnd() * 6); i < k; i += 1) t += pick(FR)(`hunter2q${(vn++).toString(36)}z`) + pick(GLUE);
    return rnd() < 0.4 ? JSON.stringify({ text: t }) : t;
  });
};

describe('every history redaction door, byte for byte, as main reads it (D-5867, C1l PR 2 characterization)', () => {
  it('each door\'s output, its base reading and its v2 reading over the corpus, under two pair indexes, are one captured digest', () => {
    const planted = ['hunter2plantedvalue0001', 'Zq9xK2mP7vL4nR8tW3yB6cD1'];
    const egress: Array<{ input: string; output: string }> =
      JSON.parse(readFileSync(path.join(here, 'fixtures', 'approvals', 'redact-corpus.json'), 'utf8'));
    const docs: Record<string, string[][]> = JSON.parse(readFileSync(path.join(here, 'fixtures', 'redact', 'profiles.json'), 'utf8'));
    const texts = [
      ...f2Cases().map((c) => c.input),
      ...corpus(0x5867, 1200), ...corpus(0xa66, 600),
      ...egress.flatMap((r) => [r.input, r.output]),
      ...Object.values(docs).flatMap((rows) => rows.flat()),
      ...planted.map((p, i) => `password=x ${p} Authorization: Bearer ${planted[1 - i]} done`),
    ];
    expect(texts.length, 'CONTROL: the corpus').toBeGreaterThan(2000);
    const idxs = [lib.makePairIndex(lib.secretPairs([]).pairs), lib.makePairIndex(lib.secretPairs(planted).pairs)];
    const doors: Array<[string, (...a: never[]) => unknown, (t: string, idx: lib.PairIndex) => unknown[]]> = [
      ['redactField', lib.redactField, (t, idx) => [t, idx]], ['redactFinal', lib.redactFinal, (t, idx) => [t, idx]],
      ['redactFinalLines', lib.redactFinalLines, (t, idx) => [t, idx]],
      ['redactFinalJson', lib.redactFinalJson, (t, idx) => [{ a: t, b: [t.slice(0, 40)] }, idx]],
      ['redactFinalText', lib.redactFinalText, (t, idx) => [t, idx]], ['redactForIndex', lib.redactForIndex, (t, idx) => [t, idx]],
      ['redactForDisplay', lib.redactForDisplay, (t, idx) => [t, idx]], ['entryIndexText', lib.entryIndexText, (t, idx) => [t, idx]],
      ['sidecarIndexText', lib.sidecarIndexText, (t, idx) => [Buffer.from(t), idx]],
      ['redactDisplayWindow', lib.redactDisplayWindow, (t, idx) => [t, Math.floor(t.length / 4), Math.ceil((3 * t.length) / 4), idx]],
      ['displaySnippet', lib.displaySnippet, (t, idx) => [t, ['hunter2q', 'token'], idx]],
    ];
    const h = createHash('sha256');
    let masked = 0;
    for (const idx of idxs) {
      for (const [name, door, args] of doors) {
        const r = lib.redactDoorReadings(door);
        expect(r, `${name} has R11's readings`).not.toBeNull();
        for (const t of texts) {
          const a = args(t, idx);
          const out = JSON.stringify((door as (...x: unknown[]) => unknown)(...a));
          const base = r!.base(...a);
          if (out.includes(lib.REDACTED_MARK)) masked += 1;
          h.update(`${name}\0${out}\0${JSON.stringify(base)}\0${JSON.stringify(r!.v2(base, idx))}\n`);
        }
      }
    }
    expect(masked, 'CONTROL: the doors mask something').toBeGreaterThan(10_000);
    expect(h.digest('hex')).toBe('c53e5589ecfbc9e997627e1ed863fe0c5648d74556c8161ceaa5fde89cbf3c02');
  }, 120_000);
});

// The mutation table's two history rows (plan Step 5; the history coordinator's ack), kept as CONTROL rows: each mutant is
// built as a temporary copy of the trusted bytes with one edit, asserted to apply exactly once, and shown to change what the
// pins above read. Run against the real suites, mutant 1 reds 29 rows (the rule-set and digest pins above, 18 of
// history-lib's (j) cases among them (j5), (j7) and (j14), the owed-hit probe rows) and mutant 2 reds 17 ((j7) and (j14)
// among them). Neither reds (j9) or (j10): those hold v2(base) and subtraction for ANY two rule sets, so a swapped base
// leaves them green, which the first row shows.
describe('CONTROL: the two history mutants change what the pins read (D-5867, C1l PR 2, Step 5)', () => {
  const REDACT = path.join(REPO, 'shared', 'redact.mjs');
  /** A copy of lib.mjs (and, when `redactEdit` is given, of shared/redact.mjs) with one edit each, loaded fresh. */
  const mutant = async (libEdit: [string, string] | null, redactEdit: [string, string] | null): Promise<Record<string, never>> => {
    const dir = mkTmp('ccrc-history-redact-mutant-');
    dirs.push(dir);
    const once = (bytes: string, [from, to]: [string, string], what: string): string => {
      expect(bytes.split(from).length - 1, `CONTROL: the ${what} edit applies exactly once`).toBe(1);
      return bytes.replace(from, to);
    };
    let redactUrl = pathToFileURL(REDACT).href;
    if (redactEdit !== null) {
      const copy = path.join(dir, 'redact.mjs');
      writeFileSync(copy, once(readFileSync(REDACT, 'utf8'), redactEdit, 'redact.mjs'));
      redactUrl = pathToFileURL(copy).href;
    }
    let src = readFileSync(LIB, 'utf8').replace(/'\.\.\/\.\.\/shared\/([A-Za-z0-9_-]+\.mjs)'/g, (_m, f: string) =>
      JSON.stringify(f === 'redact.mjs' ? redactUrl : pathToFileURL(path.join(REPO, 'shared', f)).href));
    if (libEdit !== null) src = once(src, libEdit, 'lib.mjs');
    const copy = path.join(dir, 'lib-mutant.mjs');
    writeFileSync(copy, `${src}\nexport { BASE_RULES as __BASE_RULES, CONTEXT_RULES as __CONTEXT_RULES };\n`);
    return await import(/* @vite-ignore */ `${pathToFileURL(copy).href}?mutant=${process.pid}-${Date.now()}-${Math.random()}`) as Record<string, never>;
  };
  const TEXT = 'password=abc&def';
  const idx = lib.makePairIndex(lib.secretPairs([]).pairs);
  const fieldBase = (m: Record<string, never>): string =>
    (m as unknown as typeof lib).redactDoorReadings((m as unknown as typeof lib).redactField)!.base(TEXT, idx) as string;
  it('CONTROL: the base read through the trusted bytes ends v1\'s named value at `&`, and the door masks it whole', () => {
    const r = lib.redactDoorReadings(lib.redactField)!;
    expect(r.base(TEXT, idx)).toBe(`password=${lib.REDACTED_MARK}&def`);
    expect(lib.redactField(TEXT, idx)).toBe(`password=${lib.REDACTED_MARK}`);
  });
  it('mutant 1, BASE_RULES built from the history-v2 profile: the base set is not the captured one, and the base reading moves; v2(base) still holds', async () => {
    const m = await mutant(["const BASE_RULES = historyRules('history-base');", "const BASE_RULES = historyRules('history-v2');"], null);
    expect(dumpSet(m.__BASE_RULES)).not.toEqual(FIXTURE.BASE_RULES);
    expect(fieldBase(m)).toBe(`password=${lib.REDACTED_MARK}`);
    const ml = m as unknown as typeof lib;
    const r = ml.redactDoorReadings(ml.redactField)!;
    expect(ml.redactField(TEXT, idx), '(j9)\'s relation holds under the mutant').toBe(r.v2(r.base(TEXT, idx), idx));
  });
  it('mutant 2, a pattern edit to history-named-value-v1 (the rule only history-base lists): the base reading moves, the v2 set does not', async () => {
    const m = await mutant(null, [
      "'history-named-value-v1': ['namedValue', (final) => namedValueV1(final)],",
      "'history-named-value-v1': ['namedValue', (final) => (final ? namedValueV1(true) : new RegExp(String.raw`([\"']?)([^\\s\"'` + '`' + ',;]+)', 'y'))],",
    ]);
    expect(dumpSet(m.__BASE_RULES)).not.toEqual(FIXTURE.BASE_RULES);
    expect(dumpSet(m.__CONTEXT_RULES)).toEqual(FIXTURE.CONTEXT_RULES);
    expect(fieldBase(m)).toBe(`password=${lib.REDACTED_MARK}`);
  });
});
