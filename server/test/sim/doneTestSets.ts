// Overlord W2 done tests A (plan w2-done-tests.md Task A3, Step 4; the floors rule is D-8217's): the mutants of
// `parseDoneTest` and `targetVerdict`, each run against the cases in `../doneTestCases.ts`. The plan's named mutants come
// first (swap rows 7 and 9, a failed run read as pending, `checking` read as passed, no `openedAt` filter on the lineage,
// an unknown run state read as open, a duplicate accepted, no measured-predicate check); the rest hold the other rows.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MutantSet } from './mutate.js';
import { parseDoneTestCases, targetVerdictCases, type DoneTestDeciders } from '../doneTestCases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DECIDER_TS = path.join(ROOT, 'server/src/coord/doneTests.ts');

export const PARSE_DONE_TEST_KEY = 'server/src/coord/doneTests.ts#parseDoneTest';
export const TARGET_VERDICT_KEY = 'server/src/coord/doneTests.ts#targetVerdict';

export const PARSE_DONE_TEST_SET: MutantSet<DoneTestDeciders> = {
  modulePath: DECIDER_TS,
  suite: parseDoneTestCases,
  mutants: [
    { id: 'DT-PARSE-1', old: "if (new Set(words).size !== words.length) return { ok: false, why: 'duplicate' };", new: '' },
    { id: 'DT-PARSE-2', old: "if (!words.some((p) => (MEASURED_PREDICATES as readonly string[]).includes(p))) return { ok: false, why: 'no-measured-predicate' };", new: '' },
    { id: 'DT-PARSE-3', old: "if (!Array.isArray(v)) return { ok: false, why: 'not-a-list' };", new: "if (!Array.isArray(v)) return { ok: false, why: 'empty' };" },
    { id: 'DT-PARSE-4', old: "if (v.length === 0) return { ok: false, why: 'empty' };", new: '' },
    { id: 'DT-PARSE-5', old: 'if (v.length > DONE_TEST_BOUNDS.entries)', new: 'if (v.length > DONE_TEST_BOUNDS.entries + 1)' },
    { id: 'DT-PARSE-6', old: "if (keys.length !== 1 || keys[0] !== 'predicate') return null;", new: "if (!keys.includes('predicate')) return null;" },
    { id: 'DT-PARSE-7', old: 'return isPredicate(p) ? p : null;', new: 'return typeof p === \'string\' ? p as DonePredicate : null;' },
    { id: 'DT-PARSE-8', old: "if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;", new: "if (typeof v !== 'object' || v === null) return null;" },
    { id: 'DT-PARSE-9', old: 'return { ok: true, test: words.map((predicate) => ({ predicate })) };', new: 'return { ok: true, test: v as DoneTest };' },
    { id: 'DT-PARSE-10', old: "if (v.length > DONE_TEST_BOUNDS.entries) return { ok: false, why: 'too-many' };\n  const words", new: "const words" },
  ],
};

export const TARGET_VERDICT_SET: MutantSet<DoneTestDeciders> = {
  modulePath: DECIDER_TS,
  suite: targetVerdictCases,
  mutants: [
    // The plan's named mutants.
    { id: 'DT-TV-1', old: "if (c.kind === 'none') return unmeasurable('no-close-record');\n  return c.merged", new: "if (c.kind === 'none') return passed('pr-none');\n  return c.merged" },
    { id: 'DT-TV-2', old: "if (r.state === 'failed') return ended(failedEvidence(r.closeDetail));\n  const c = closePrOf(r.closePr);\n  if (c.kind === 'bad') return unmeasurable('close-record-unreadable');\n  if (c.kind === 'none')", new: "if (r.state === 'failed') return pending('failed');\n  const c = closePrOf(r.closePr);\n  if (c.kind === 'bad') return unmeasurable('close-record-unreadable');\n  if (c.kind === 'none')" },
    { id: 'DT-TV-3', old: "if (s === 'done') return passed", new: "if (s === 'done' || s === 'checking') return passed" },
    { id: 'DT-TV-4', old: 'if (n !== pr || recordedAt < from) continue;', new: 'if (n !== pr) continue;' },
    { id: 'DT-TV-5', old: "if (!isRunState(r.state)) return unmeasurable('state-unknown');", new: '' },
    // The other rows.
    { id: 'DT-TV-6', old: 'if (facts.kind === \'threw\') return unmeasured(facts.why);', new: 'if (facts.kind === \'threw\') return unmeasurable(facts.why);' },
    { id: 'DT-TV-7', old: "if (facts.run === 'absent') return unmeasurable('no-such-row');", new: "if (facts.run === 'absent') return pending('no-such-row');" },
    { id: 'DT-TV-8', old: "if (facts.run === 'unreadable') return unmeasurable('run-unreadable');", new: "if (facts.run === 'unreadable') return unmeasurable('no-such-row');" },
    { id: 'DT-TV-9', old: "if (facts.item === 'absent') return unmeasurable('no-such-row');", new: "if (facts.item === 'absent') return ended('no-such-row');" },
    { id: 'DT-TV-10', old: "if (!isItemState(s)) return unmeasurable('state-unknown');", new: '' },
    { id: 'DT-TV-11', old: "if (s === 'dismissed' || s === 'withdrawn') return ended(s);", new: "if (s === 'dismissed') return ended(s);" },
    { id: 'DT-TV-12', old: "return c.merged ? passed(`pr-${c.pr}`) : ended(`pr-${c.pr}-not-merged`);", new: 'return passed(`pr-${c.pr}`);' },
    { id: 'DT-TV-13', old: "if (c.kind === 'bad') return unmeasurable('close-record-unreadable');\n  if (c.kind === 'none') return unmeasurable('no-close-record');", new: "if (c.kind !== 'ok') return unmeasurable('no-close-record');" },
    { id: 'DT-TV-14', old: "if (c.kind === 'ok' && c.pr === pr) return", new: "if (c.kind === 'ok') return" },
    { id: 'DT-TV-15', old: "if (e === null) return unmeasurable('not-this-runs-pr');", new: "if (e === null) return ended('not-this-runs-pr');" },
    { id: 'DT-TV-16', old: "if (e.phase === 'closed') return ended(`pr-${pr}-closed`);", new: '' },
    { id: 'DT-TV-17', old: "if (e === 'bad') return unmeasurable('lineage-unreadable');", new: "if (e === 'bad') return unmeasurable('not-this-runs-pr');" },
    { id: 'DT-TV-18', old: 'if (best === null || recordedAt >= best.at)', new: 'if (best === null)' },
    { id: 'DT-TV-19', old: 'const from = Math.floor(openedAt / 1000);', new: 'const from = openedAt;' },
    { id: 'DT-TV-20', old: "if (reviews.some((v) => !isTerminal(v.state))) return pending", new: "if (reviews.some((v) => v.state === 'working')) return pending" },
    { id: 'DT-TV-21', old: "if (reviews.some((v) => v.state === 'done')) return unmeasurable('verdict-not-recorded');", new: "if (reviews.some((v) => v.state === 'done')) return passed('review');" },
    { id: 'DT-TV-22', old: "if (reviews === undefined) return unmeasurable('reviews-unread');", new: "if (reviews === undefined) return pending('reviews-unread');" },
    { id: 'DT-TV-23', old: "if (reviews.some((v) => !isRunState(v.state))) return unmeasurable('state-unknown');", new: '' },
    { id: 'DT-TV-24', old: "if (!isTerminal(r.state)) return pending(`run-${id}-${r.state}`);\n  if (r.state === 'failed')", new: "if (r.state !== 'done' && r.state !== 'failed') return pending('open');\n  if (r.state === 'failed')" },
    { id: 'DT-TV-25', old: "if (!isPr(pr) || typeof merged !== 'boolean'", new: "if (typeof merged !== 'boolean'" },
    { id: 'DT-TV-26', old: "|| typeof head !== 'string' || !isHead40(head)) return { kind: 'bad' };", new: ') return { kind: \'bad\' };' },
    { id: 'DT-TV-27', old: "return unmeasurable(isPrPhase(e.phase) ? `phase-${e.phase}` : 'phase-unknown');", new: 'return unmeasurable(`phase-${String(e.phase)}`);' },
    { id: 'DT-TV-28', old: "/^[a-z][a-z0-9-]*/.exec(detail)?.[0]) ?? 'failed';", new: "null) ?? 'failed';" },
    { id: 'DT-TV-29', old: "if (facts.kind !== 'item') return unmeasurable('facts-mismatch');", new: '' },
    { id: 'DT-TV-30', old: "  if (r.state === 'failed') return ended(failedEvidence(r.closeDetail));\n  if (reviews === undefined)", new: '  if (reviews === undefined)' },
  ],
};

export const DONE_TEST_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PARSE_DONE_TEST_KEY]: PARSE_DONE_TEST_SET as MutantSet<never>,
  [TARGET_VERDICT_KEY]: TARGET_VERDICT_SET as MutantSet<never>,
};
