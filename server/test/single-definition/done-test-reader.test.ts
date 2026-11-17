// THE DONE-TEST READER'S CENSUS (Overlord W2 done tests A, Task A4; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §5, §9 "One reader per fact"). `doneTestRead.ts` is the only gatherer of a predicate's rows and
// `doneTests.ts` the only decider, so a second place that decides "this run merged" from a run's own columns is red here:
//   - `targetVerdict` is called only from `doneTestRead.ts`;
//   - `parseDoneTest` only from `doneTestRead.ts`, relay A's body parser (`relayBody.ts`) and the coordinator doors'
//     counter (`requestAnswers.ts`), the three callers the plans name (Q2, F8);
//   - a run's `closePr` is READ (a member access, an index by name or a destructuring) only in `store.ts`, which writes
//     and hydrates it, `doneTestRead.ts`, which gathers it, and `doneTests.ts`, which decides on the gathered fact; and a
//     run's `prLineage` only in `store.ts` and `doneTestRead.ts`. Naming the column as a key of the writer's input (the
//     close's `closePr: closePrFactsOf(line, plan.claim.prNumber)`) is not a read (slug `census-allows-the-decider-and-the-close-argument`).
//     The Linear plan sync reads `prLineage` too, for a run's PR NUMBER to link, never whether it merged: it is admitted
//     as ONE function, `linear/planSync.ts#prOfRunFrom` (#2941), whose body is cut out and must not say `merged`, and the
//     rest of that file reads neither column (slug `census-admits-the-plan-sync-pr-link`, narrowed by review 2377 F4).
// A read is a member access, an index by name, a destructuring (plain, typed, or of a parameter) or a one-line `SELECT`
// naming the column (review 2377 F5). Comment lines are not code. KNOWN WIDTH: a read through a computed key or an alias
// of the row object, and a `SELECT` whose column list spans lines, are not seen.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL, rel, stallCodeText } from './helpers.js';
import { readFileSync } from 'node:fs';

const SRC = ALL.filter((f) => rel(f).startsWith('server/src/'));
const code = (f: string): string => stallCodeText(readFileSync(f, 'utf8'));

/** The files that call `name(` outside its own definition. */
export const callersOf = (files: readonly string[], name: string): string[] => files.filter((f) => {
  const text = code(f).replace(new RegExp(`function\\s+${name}\\s*\\(`, 'g'), '');
  return new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(text);
}).map(rel).sort();

/** A read of `field`: `x.field`, `x?.field`, `x['field']`, `{ … field … } =`, `{ … field … }: T =`, a parameter
 *  `({ … field … }) =>` (typed or not, or a function's `{`), or `SELECT … field` on one line. */
export const readPattern = (field: string): RegExp => new RegExp([
  `\\??\\.${field}\\b`,
  `\\[\\s*['"]${field}['"]\\s*\\]`,
  `\\{[^{}]*\\b${field}\\b[^{}]*\\}\\s*(?::\\s*[\\w.<>\\[\\]|, '"]+?\\s*)?=(?![=>])`,
  `\\(\\s*\\{[^{}()]*\\b${field}\\b[^{}()]*\\}\\s*(?::[^()]*)?\\)\\s*(?:=>|\\{|:)`,
  `\\bSELECT\\b[^;\\n]*\\b${field}\\b`,
].join('|'));

/** The files that read `field` off an object (`readPattern`). */
export const readersOf = (files: readonly string[], field: string): string[] =>
  files.filter((f) => readPattern(field).test(code(f))).map(rel).sort();

/** `function name(` … the first column-0 `}` after it: one top-level function's lines (`late-census.test.ts`'s cut). */
const bodyOfFn = (src: string, head: RegExp): string => {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => head.test(l));
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && l === '}');
  return lines.slice(at, end + 1).join('\n');
};

/** The plan sync's admission, by text: the one function cut out, what the rest of the file reads, and what the body says. */
const PLAN_SYNC = 'server/src/linear/planSync.ts';
const PR_OF_RUN = /^export function prOfRunFrom\(/;
const admission = (text: string): { body: string; restReads: boolean; bodyReads: boolean; bodySaysMerged: boolean } => {
  const body = bodyOfFn(text, PR_OF_RUN);
  const rest = body === '' ? text : text.replace(body, '');
  const reads = (t: string): boolean => readPattern('prLineage').test(t) || readPattern('closePr').test(t);
  return { body, restReads: reads(rest), bodyReads: reads(body), bodySaysMerged: /merged/i.test(body) };
};

const C = 'server/src/coord/';
const plant = (lines: string[]): { file: string; done: () => void } => {
  const d = mkdtempSync(path.join(tmpdir(), 'done-test-census-'));
  const file = path.join(d, 'planted.ts');
  writeFileSync(file, lines.join('\n'));
  return { file, done: () => rmSync(d, { recursive: true, force: true }) };
};

describe('the done-test reader: one gatherer, one decider, and no other reader of a run\'s closePr or prLineage', () => {
  it('CONTROL: a planted second reader of each column, and a planted caller of each decider, are found', () => {
    const p = plant([
      'export const a = (run: { closePr: string | null }) => run.closePr;',
      "export const b = (run: Record<string, unknown>) => run['prLineage'];",
      'export const c = () => targetVerdict(t, f);',
      'export const d = () => parseDoneTest(v);',
    ]);
    try {
      const planted = rel(p.file);
      expect(readersOf([...SRC, p.file], 'closePr')).toContain(planted);
      expect(readersOf([...SRC, p.file], 'prLineage')).toContain(planted);
      expect(callersOf([...SRC, p.file], 'targetVerdict')).toContain(planted);
      expect(callersOf([...SRC, p.file], 'parseDoneTest')).toContain(planted);
    } finally { p.done(); }
  });

  it('CONTROL: a destructuring read is found; a key of an object passed to a writer, a comment and a definition are not', () => {
    const p = plant([
      'const { closePr, prLineage: l } = row;',
      'coord.closeRun({ runId: 1, closePr: facts });',
      '// run.closePr is read by the reader',
      'export function parseDoneTest(v: unknown) { return v; }',
    ]);
    const q = plant(['coord.closeRun({ runId: 1, closePr: facts });', 'export function targetVerdict() {}']);
    try {
      expect(readersOf([p.file], 'closePr')).toEqual([rel(p.file)]);
      expect(readersOf([p.file], 'prLineage')).toEqual([rel(p.file)]);
      expect(readersOf([q.file], 'closePr')).toEqual([]);
      expect(callersOf([p.file, q.file], 'parseDoneTest')).toEqual([]);
      expect(callersOf([q.file], 'targetVerdict')).toEqual([]);
    } finally { p.done(); q.done(); }
  });

  it('CONTROL (F5): an unprefixed SELECT, a parameter destructure and a typed destructure are reads; a call\'s object is not', () => {
    for (const line of [
      "const rows = db.prepare('SELECT id, closePr FROM runs').all();",
      'export const a = ({ closePr }) => closePr;',
      'export const b = ({ closePr, state }: RunRow) => closePr;',
      'export function c({ closePr }: RunRow) { return closePr; }',
      'const { closePr }: RunRow = row;',
      'const { closePr, kind }: Pick<RunRow, \'closePr\' | \'kind\'> = row;',
    ]) {
      const p = plant([line]);
      try { expect(readersOf([p.file], 'closePr'), line).toEqual([rel(p.file)]); } finally { p.done(); }
    }
    for (const line of [
      'coord.closeRun({ runId: 1, closePr: facts });',
      'const x = f({ closePr: g(y) });',
      "db.exec('ALTER TABLE runs ADD COLUMN closePr TEXT;');",
      'if (a == { closePr } ) {}',
    ]) {
      const p = plant([line]);
      try { expect(readersOf([p.file], 'closePr'), line).toEqual([]); } finally { p.done(); }
    }
  });

  it('targetVerdict is called only from doneTestRead.ts', () => {
    expect(callersOf(SRC, 'targetVerdict')).toEqual([`${C}doneTestRead.ts`]);
  });

  it('parseDoneTest is called only from the reader, relay A\'s body parser and the counter', () => {
    const allowed = [`${C}doneTestRead.ts`, `${C}relayBody.ts`, `${C}requestAnswers.ts`];
    expect(callersOf(SRC, 'parseDoneTest').filter((f) => !allowed.includes(f))).toEqual([]);
  });

  it('a run\'s closePr is read only by the store, the gatherer and the decider', () => {
    expect(readersOf(SRC, 'closePr')).toEqual([`${C}doneTestRead.ts`, `${C}doneTests.ts`, `${C}store.ts`]);
  });

  it('a run\'s prLineage is read only by the store, the gatherer and the plan sync\'s one PR-link function', () => {
    expect(readersOf(SRC, 'prLineage').filter((f) => f !== PLAN_SYNC)).toEqual([`${C}doneTestRead.ts`, `${C}store.ts`]);
  });

  it('the plan sync reads a run\'s lineage only inside prOfRunFrom, which never says merged (F4)', () => {
    const file = SRC.find((f) => rel(f) === PLAN_SYNC);
    expect(file, PLAN_SYNC).toBeDefined();
    const a = admission(code(file!));
    expect(a.body, 'prOfRunFrom is cut out of the file').not.toBe('');
    expect(a.bodyReads, 'prOfRunFrom is the admitted reader').toBe(true);
    expect(a.restReads, 'the rest of the plan sync reads neither prLineage nor closePr').toBe(false);
    expect(a.bodySaysMerged, 'prOfRunFrom never decides merged').toBe(false);
  });

  it('CONTROL (F4): a reader beside prOfRunFrom, and a prOfRunFrom that says merged, are each found', () => {
    const fn = ['export function prOfRunFrom(coord: CoordStore) {', '  return (id) => coord.run(id).run.prLineage.at(-1);', '}'];
    expect(admission(fn.join('\n'))).toMatchObject({ restReads: false, bodyReads: true, bodySaysMerged: false });
    expect(admission([...fn, 'export const other = (r: RunRow) => r.prLineage;'].join('\n')).restReads).toBe(true);
    expect(admission([...fn, 'export const other = (r: RunRow) => r.closePr;'].join('\n')).restReads).toBe(true);
    const merged = ['export function prOfRunFrom(coord: CoordStore) {', "  return (id) => coord.run(id).run.prLineage.find((e) => e.phase === 'merged');", '}'];
    expect(admission(merged.join('\n')).bodySaysMerged).toBe(true);
    expect(admission('export const x = (r: RunRow) => r.prLineage;').body).toBe('');
  });
});
