// THE DONE-TEST READER'S CENSUS (Overlord W2 done tests A, Task A4; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §5, §9 "One reader per fact"). `doneTestRead.ts` is the only gatherer of a predicate's rows and
// `doneTests.ts` the only decider, so a second place that decides "this run merged" from a run's own columns is red here:
//   - `targetVerdict` is called only from `doneTestRead.ts`;
//   - `parseDoneTest` only from `doneTestRead.ts`, relay A's body parser (`relayBody.ts`) and the coordinator doors'
//     counter (`requestAnswers.ts`), the three callers the plans name (Q2, F8);
//   - a run's `closePr` is READ (a member access, an index by name or a destructuring) only in `store.ts`, which writes
//     and hydrates it, `doneTestRead.ts`, which gathers it, and `doneTests.ts`, which decides on the gathered fact; and a
//     run's `prLineage` only in `store.ts` and `doneTestRead.ts`. Naming the column as a key of the writer's input (the
//     close's `closePr: closePrFactsOf(line)`) is not a read (slug `census-allows-the-decider-and-the-close-argument`).
//     The Linear plan sync (`linear/planSync.ts#prOfRunFrom`, #2941) reads `prLineage` too, for a run's PR NUMBER to link,
//     never whether it merged, so it is admitted by name (slug `census-admits-the-plan-sync-pr-link`).
// Comment lines are not code. KNOWN WIDTH: a read through a computed key or an alias of the row object is not seen.
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

/** The files that read `field` off an object: `x.field`, `x?.field`, `x['field']`, or `{ … field … } =`. */
export const readersOf = (files: readonly string[], field: string): string[] => {
  const read = new RegExp(`\\??\\.${field}\\b|\\[\\s*['"]${field}['"]\\s*\\]|\\{[^{}]*\\b${field}\\b[^{}]*\\}\\s*=(?!=)`);
  return files.filter((f) => read.test(code(f))).map(rel).sort();
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

  it('a run\'s prLineage is read only by the store, the gatherer and the plan sync\'s PR link', () => {
    expect(readersOf(SRC, 'prLineage')).toEqual([`${C}doneTestRead.ts`, `${C}store.ts`, 'server/src/linear/planSync.ts']);
  });
});
