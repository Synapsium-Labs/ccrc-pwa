// The compaction counter's cases (Overlord W1a, context readings), shared by `continuity-compactions.test.ts` and the
// counter's mutation set in `sim/mutation-floors.test.ts`, so the floor is measured against the very cases the suite
// asserts. Each case throws on a wrong answer.
import type { CompactionLine } from '../src/continuity/compactions.js';

export type Counter = (lines: readonly CompactionLine[], sinceMs: number) => number;

const PAIR_MS = 600_000;   // COMPACTION_PAIR_MS, pinned against the module in the suite
const T = 1_800_000_000_000;
const MIN = 60_000;
type Spec = readonly [phase: CompactionLine['phase'], trigger: CompactionLine['trigger'], atOffsetMs: number,
  transcript?: string | null, scope?: CompactionLine['scope']];
const L = (specs: readonly Spec[]): CompactionLine[] => specs.map(([phase, trigger, off, transcript, scope]) =>
  ({ phase, trigger, at: T + off, transcript: transcript ?? null, scope: scope === undefined ? 'main' : scope }));

/** [name, lines, sinceMs, expected count]. */
export const COUNT_CASES: ReadonlyArray<readonly [string, readonly CompactionLine[], number, number]> = [
  ['no lines count none', [], T, 0],
  ['a pre alone counts one', L([['pre', 'auto', 0]]), T, 1],
  ['a post alone counts one', L([['post', 'auto', 0]]), T, 1],
  ['a pre and its post count one', L([['pre', 'auto', 0], ['post', 'auto', MIN]]), T, 1],
  ['a manual pre and its post count one', L([['pre', 'manual', 0], ['post', 'manual', MIN]]), T, 1],
  ['a post of another trigger is another compaction', L([['pre', 'auto', 0], ['post', 'manual', MIN]]), T, 2],
  ['two pres count two', L([['pre', 'auto', 0], ['pre', 'auto', MIN]]), T, 2],
  ['two pres and one post count two', L([['pre', 'auto', 0], ['pre', 'auto', MIN], ['post', 'auto', 2 * MIN]]), T, 2],
  ['one pre and two posts count two', L([['pre', 'auto', 0], ['post', 'auto', MIN], ['post', 'auto', 2 * MIN]]), T, 2],
  ['a post exactly COMPACTION_PAIR_MS after its pre is the same one', L([['pre', 'auto', 0], ['post', 'auto', PAIR_MS]]), T, 1],
  ['a post one ms past the window is another', L([['pre', 'auto', 0], ['post', 'auto', PAIR_MS + 1]]), T, 2],
  ['a post eleven minutes after a pre counts two', L([['pre', 'auto', 0], ['post', 'auto', 11 * MIN]]), T, 2],
  ['a post before the pre is not its settlement', L([['post', 'auto', 0], ['pre', 'auto', MIN]]), T, 2],
  ['a post at the pre\'s own ms is its settlement', L([['pre', 'auto', 0], ['post', 'auto', 0]]), T, 1],
  ['contradicting transcripts are two compactions', L([['pre', 'auto', 0, '/t/a.jsonl'], ['post', 'auto', MIN, '/t/b.jsonl']]), T, 2],
  ['the same transcript pairs', L([['pre', 'auto', 0, '/t/a.jsonl'], ['post', 'auto', MIN, '/t/a.jsonl']]), T, 1],
  ['an unnamed transcript on the post does not contradict', L([['pre', 'auto', 0, '/t/a.jsonl'], ['post', 'auto', MIN, null]]), T, 1],
  ['an unnamed transcript on the pre does not contradict', L([['pre', 'auto', 0, null], ['post', 'auto', MIN, '/t/b.jsonl']]), T, 1],
  ['the pairing is the most the lines admit, not the first found',
    L([['pre', 'auto', 0, null], ['pre', 'auto', MIN, '/t/a.jsonl'], ['post', 'auto', 2 * MIN, '/t/a.jsonl'],
      ['post', 'auto', 3 * MIN, '/t/b.jsonl']]), T, 2],
  ['lines before sinceMs count none', L([['pre', 'auto', 0], ['post', 'auto', MIN]]), T + 2 * MIN, 0],
  ['a line at sinceMs counts', L([['pre', 'auto', 0]]), T, 1],
  ['a pre before sinceMs and its post after count one (the post)', L([['pre', 'auto', 0], ['post', 'auto', 2 * MIN]]), T + MIN, 1],
  ['other pairs only with other', L([['pre', 'other', 0], ['post', 'other', MIN], ['post', 'auto', 2 * MIN]]), T, 2],
  // Plan review 1896 B3: a refused line is written in place of a refused event's pre; it counts nothing, cancels nothing.
  ['a refused line alone counts none', L([['refused', 'auto', 0]]), T, 0],
  ['a pre and a refused line count one: a refusal never cancels a pre', L([['pre', 'auto', 0], ['refused', 'auto', 0]]), T, 1],
  ['a refused line is never a post\'s pre', L([['refused', 'auto', 0], ['post', 'auto', MIN]]), T, 1],
  // Plan review 1896 B2: only the main conversation's compactions count.
  ['a subagent\'s compaction counts none', L([['pre', 'auto', 0, '/t/agent.jsonl', 'subagent'],
    ['post', 'auto', MIN, '/t/agent.jsonl', 'subagent']]), T, 0],
  ['an ambiguous compaction counts none', L([['pre', 'auto', 0, null, 'ambiguous'], ['post', 'auto', MIN, null, 'ambiguous']]), T, 0],
  ['a line with no scope verdict counts none', L([['pre', 'auto', 0, null, null]]), T, 0],
  ['a main pre beside a subagent pre counts one', L([['pre', 'auto', 0], ['pre', 'auto', MIN, null, 'subagent']]), T, 1],
  ['a subagent post never settles a main pre', L([['pre', 'auto', 0], ['post', 'auto', MIN, null, 'subagent']]), T, 1],
];

/** Every sequence of up to four lines from {pre auto, post auto, post manual} at two times. */
export function smallSequences(): CompactionLine[][] {
  const atoms: CompactionLine[] = [];
  for (const off of [0, MIN]) {
    atoms.push({ phase: 'pre', trigger: 'auto', at: T + off, transcript: null, scope: 'main' });
    atoms.push({ phase: 'post', trigger: 'auto', at: T + off, transcript: null, scope: 'main' });
    atoms.push({ phase: 'post', trigger: 'manual', at: T + off, transcript: null, scope: 'main' });
  }
  const out: CompactionLine[][] = [[]];
  let layer: CompactionLine[][] = [[]];
  for (let n = 1; n <= 4; n += 1) {
    layer = layer.flatMap((s) => atoms.map((a) => [...s, a]));
    out.push(...layer);
  }
  return out;
}

/** Appending any one line to any small sequence never lowers the count. Throws the first counterexample. */
export function checkMonotonic(count: Counter): void {
  const atoms = smallSequences().filter((s) => s.length === 1).map((s) => s[0]!);
  for (const seq of smallSequences()) {
    if (seq.length === 4) continue;
    const before = count(seq, T);
    for (const a of atoms) {
      const after = count([...seq, a], T);
      if (after < before) throw new Error(`appending ${JSON.stringify(a)} to ${JSON.stringify(seq)} lowered ${before} to ${after}`);
    }
  }
}

/** The mutation suite's cases: every named case, and the monotonic sweep. */
export function counterSuite(count: Counter): Record<string, () => void> {
  const cases: Record<string, () => void> = {};
  for (const [name, lines, since, want] of COUNT_CASES) {
    cases[name] = () => {
      const got = count(lines, since);
      if (got !== want) throw new Error(`${name}: ${got}, expected ${want}`);
    };
  }
  cases['monotonic'] = () => checkMonotonic(count);
  return cases;
}
