// The done-test deciders' cases (Overlord W2 done tests A, Task A3; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §5, Table 3), written once as suite cases over a module: `done-tests-policy.test.ts` runs them against
// the real `server/src/coord/doneTests.ts`, and `sim/doneTestSets.ts` runs them against each named mutant. Every expected
// word is spelled out here, never read from the code the cases judge.
import { expect } from 'vitest';
import type { DoneTarget, TargetAnswer } from '../../shared/doneTests.js';
import type { TargetFacts, TargetRunFacts } from '../src/coord/doneTests.js';
import type { SuiteCase } from './sim/mutate.js';

export type DoneTestDeciders = typeof import('../src/coord/doneTests.js');

/** A run opened at this wall millisecond; `.prhistory` records whole seconds, so its window opens at `OPENED_S`. */
export const OPENED = 1_790_000_000_500;
export const OPENED_S = 1_790_000_000;
export const HEAD = 'c'.repeat(40);

export const closePr = (pr: number, merged: boolean, head = HEAD): string => JSON.stringify({ pr, merged, head });
export const lin = (pr: number, phase: string, recordedAt = OPENED_S + 60) => ({ pr, branch: 'ws/a', phase, recordedAt });

export const runFacts = (o: Partial<TargetRunFacts> = {}, reviews?: readonly { state: string }[]): TargetFacts => ({
  kind: 'run',
  run: { state: 'done', kind: 'work', openedAt: OPENED, closeDetail: null, closePr: closePr(7, true), lineage: [], ...o },
  ...(reviews === undefined ? {} : { reviews }),
});
export const itemFacts = (state: string): TargetFacts => ({ kind: 'item', item: { state } });

export const RUN_CLOSED: DoneTarget = { predicate: 'run-closed', runId: 4 };
export const PR_MERGED: DoneTarget = { predicate: 'pr-merged', runId: 4, pr: 7 };
export const PR_REPLACED: DoneTarget = { predicate: 'pr-merged', runId: 4, pr: 5 };
export const REVIEW: DoneTarget = { predicate: 'review-passed', runId: 4 };
export const ITEM: DoneTarget = { predicate: 'operator-confirms', itemId: 9 };

/** One answer as one word: `kind:evidence` or `kind:why`. */
export const word = (a: TargetAnswer): string => ('evidence' in a ? `${a.kind}:${a.evidence}` : `${a.kind}:${a.why}`);

/** The seven known non-terminal run states, written out. */
export const OPEN_STATES = ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown'];

export function parseDoneTestCases(m: Pick<DoneTestDeciders, 'parseDoneTest'>): Record<string, SuiteCase> {
  const why = (v: unknown): string => {
    const r = m.parseDoneTest(v);
    return r.ok ? `ok:${r.test.map((e) => e.predicate).join(',')}` : r.why;
  };
  const p = (predicate: unknown): unknown => ({ predicate });
  return {
    'anything but a list is not-a-list': () => {
      for (const v of [undefined, null, 'run-closed', 7, { predicate: 'run-closed' }, { 0: p('run-closed'), length: 1 }]) {
        expect(why(v)).toBe('not-a-list');
      }
    },
    'an empty list is empty': () => { expect(why([])).toBe('empty'); },
    'six entries are too-many, before any entry is read': () => {
      expect(why([p('run-closed'), p('pr-merged'), p('goals-modified'), p('review-passed'), p('operator-confirms'), p('run-closed')]))
        .toBe('too-many');
      expect(why(['x', 'x', 'x', 'x', 'x', 'x'])).toBe('too-many');
    },
    'a word outside the vocabulary, a missing predicate, or any other key is unknown-predicate': () => {
      expect(why([p('merged')])).toBe('unknown-predicate');
      expect(why([p('Run-Closed')])).toBe('unknown-predicate');
      expect(why([p(7)])).toBe('unknown-predicate');
      expect(why(['run-closed'])).toBe('unknown-predicate');
      expect(why([null])).toBe('unknown-predicate');
      expect(why([[p('run-closed')]])).toBe('unknown-predicate');
      expect(why([Object.assign([], { predicate: 'run-closed' })])).toBe('unknown-predicate');
      expect(why([{}])).toBe('unknown-predicate');
      expect(why([{ predicate: 'run-closed', note: 'the PR merged' }])).toBe('unknown-predicate');
      expect(why([p('run-closed'), { kind: 'run-closed', runId: 4 }])).toBe('unknown-predicate');
    },
    'a relay-shaped object with a kind field and no predicate is unknown-predicate': () => {
      expect(why([{ kind: 'pr-merged', pr: 7 }])).toBe('unknown-predicate');
    },
    'a predicate named twice is duplicate, after every entry is known': () => {
      expect(why([p('run-closed'), p('run-closed')])).toBe('duplicate');
      expect(why([p('review-passed'), p('review-passed')])).toBe('duplicate');
      expect(why([p('run-closed'), p('run-closed'), p('nope')])).toBe('unknown-predicate');
    },
    'a test of only unmeasured predicates is no-measured-predicate (DT9)': () => {
      expect(why([p('review-passed')])).toBe('no-measured-predicate');
      expect(why([p('operator-confirms')])).toBe('no-measured-predicate');
      expect(why([p('review-passed'), p('operator-confirms')])).toBe('no-measured-predicate');
    },
    'one measured predicate is enough, each of the three': () => {
      for (const w of ['run-closed', 'pr-merged', 'goals-modified']) expect(why([p(w)])).toBe(`ok:${w}`);
      expect(why([p('operator-confirms'), p('goals-modified')])).toBe('ok:operator-confirms,goals-modified');
    },
    'a valid test of each size from one to five, in its order': () => {
      const all = ['pr-merged', 'run-closed', 'goals-modified', 'review-passed', 'operator-confirms'];
      for (let n = 1; n <= 5; n++) expect(why(all.slice(0, n).map(p))).toBe(`ok:${all.slice(0, n).join(',')}`);
    },
    'the accepted test is rebuilt from the words, never the caller\'s objects': () => {
      const entry = { predicate: 'run-closed' };
      const r = m.parseDoneTest([entry]);
      expect(r).toEqual({ ok: true, test: [{ predicate: 'run-closed' }] });
      if (r.ok) expect(r.test[0]).not.toBe(entry);
    },
  };
}

export function targetVerdictCases(m: Pick<DoneTestDeciders, 'targetVerdict'>): Record<string, SuiteCase> {
  const at = (t: DoneTarget, f: TargetFacts): string => word(m.targetVerdict(t, f));
  const targets = [RUN_CLOSED, PR_MERGED, REVIEW];
  return {
    'row 1: a read that threw is unmeasured, for every target': () => {
      for (const t of [...targets, ITEM]) expect(at(t, { kind: 'threw', why: 'SqliteError' })).toBe('unmeasured:SqliteError');
    },
    'row 2: an absent or unreadable row is unmeasurable, never pending': () => {
      for (const t of targets) {
        expect(at(t, { kind: 'run', run: 'absent' })).toBe('unmeasurable:no-such-row');
        expect(at(t, { kind: 'run', run: 'unreadable' })).toBe('unmeasurable:run-unreadable');
      }
      expect(at(ITEM, { kind: 'item', item: 'absent' })).toBe('unmeasurable:no-such-row');
    },
    'row 3: a state word outside RunState or ItemState is unmeasurable, never open': () => {
      for (const t of targets) for (const s of ['bogus', 'Done', '', 'closed']) expect(at(t, runFacts({ state: s }))).toBe('unmeasurable:state-unknown');
      for (const s of ['bogus', 'Done', 'closed']) expect(at(ITEM, itemFacts(s))).toBe('unmeasurable:state-unknown');
    },
    'facts of the wrong kind are unmeasurable': () => {
      expect(at(ITEM, runFacts())).toBe('unmeasurable:facts-mismatch');
      for (const t of targets) expect(at(t, itemFacts('done'))).toBe('unmeasurable:facts-mismatch');
    },
    'row 4: run-closed on each known open state is pending': () => {
      for (const s of OPEN_STATES) expect(at(RUN_CLOSED, runFacts({ state: s }))).toBe(`pending:run-4-${s}`);
    },
    'row 5: run-closed on a failed run is ended, with its close detail\'s first word': () => {
      expect(at(RUN_CLOSED, runFacts({ state: 'failed', closeDetail: 'abandon:never-started' }))).toBe('ended:abandon');
      expect(at(RUN_CLOSED, runFacts({ state: 'failed', closeDetail: null }))).toBe('ended:failed');
      expect(at(RUN_CLOSED, runFacts({ state: 'failed', closeDetail: 'The PR merged, honest' }))).toBe('ended:failed');
    },
    'row 6: run-closed on a done run whose closePr is unparsable': () => {
      for (const c of ['{', '"x"', '7', JSON.stringify({ pr: 7, merged: 'yes', head: HEAD }), JSON.stringify({ pr: 0, merged: true, head: HEAD }),
        JSON.stringify({ pr: 7, merged: true, head: 'abc' }), JSON.stringify({ merged: true, head: HEAD }), 42, { pr: 7 }]) {
        expect(at(RUN_CLOSED, runFacts({ closePr: c }))).toBe('unmeasurable:close-record-unreadable');
      }
    },
    'row 7: run-closed on a done run whose closePr merged passes, with its PR': () => {
      expect(at(RUN_CLOSED, runFacts({ closePr: closePr(12, true) }))).toBe('passed:pr-12');
    },
    'row 8: run-closed on a done run whose closePr is not merged is ended': () => {
      expect(at(RUN_CLOSED, runFacts({ closePr: closePr(12, false) }))).toBe('ended:pr-12-not-merged');
    },
    'row 9: run-closed on a done run with no closePr is unmeasurable, never passed': () => {
      expect(at(RUN_CLOSED, runFacts({ closePr: null }))).toBe('unmeasurable:no-close-record');
      expect(at(RUN_CLOSED, runFacts({ closePr: undefined }))).toBe('unmeasurable:no-close-record');
    },
    'the reuse case (F1): an earlier wave\'s merged lineage entry never passes run-closed': () => {
      const f = runFacts({ closePr: closePr(7, false), lineage: [lin(5, 'merged', OPENED_S - 3600), lin(5, 'merged')] });
      expect(at(RUN_CLOSED, f)).toBe('ended:pr-7-not-merged');
      expect(at(RUN_CLOSED, runFacts({ closePr: null, lineage: [lin(5, 'merged')] }))).toBe('unmeasurable:no-close-record');
    },
    'row 10: pr-merged on each known open state is pending': () => {
      for (const s of OPEN_STATES) expect(at(PR_MERGED, runFacts({ state: s }))).toBe(`pending:run-4-${s}`);
    },
    'row 11: pr-merged whose closePr names the PR: passed if merged, ended if not, whatever the lineage says': () => {
      expect(at(PR_MERGED, runFacts({ closePr: closePr(7, true) }))).toBe('passed:pr-7');
      expect(at(PR_MERGED, runFacts({ closePr: closePr(7, false) }))).toBe('ended:pr-7-not-merged');
      expect(at(PR_MERGED, runFacts({ closePr: closePr(7, false), lineage: [lin(7, 'merged')] }))).toBe('ended:pr-7-not-merged');
      expect(at(PR_MERGED, runFacts({ state: 'failed', closePr: closePr(7, true) }))).toBe('passed:pr-7');
    },
    'pr-merged on an unparsable closePr is unmeasurable before the lineage is read': () => {
      expect(at(PR_REPLACED, runFacts({ closePr: '{', lineage: [lin(5, 'merged')] }))).toBe('unmeasurable:close-record-unreadable');
    },
    'row 12: a PR the run replaced, merged inside its window, passes through the lineage': () => {
      expect(at(PR_REPLACED, runFacts({ closePr: closePr(7, false), lineage: [lin(5, 'merged')] }))).toBe('passed:pr-5');
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'merged')] }))).toBe('passed:pr-5');
      expect(at(PR_REPLACED, runFacts({ state: 'failed', closePr: null, lineage: [lin(5, 'merged', OPENED_S)] }))).toBe('passed:pr-5');
    },
    'row 12: the window is the run\'s own, measured in seconds: an entry before it does not count': () => {
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'merged', OPENED_S - 1)] }))).toBe('unmeasurable:not-this-runs-pr');
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'merged', OPENED_S - 1), lin(5, 'closed', OPENED_S + 9)] })))
        .toBe('ended:pr-5-closed');
    },
    'the newest in-window entry for the PR decides': () => {
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'open', OPENED_S + 1), lin(5, 'merged', OPENED_S + 9)] })))
        .toBe('passed:pr-5');
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'merged', OPENED_S + 9), lin(5, 'closed', OPENED_S + 1)] })))
        .toBe('passed:pr-5');
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(6, 'merged'), lin(5, 'closed')] }))).toBe('ended:pr-5-closed');
    },
    'row 13: a closed in-window entry is ended': () => {
      expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'closed')] }))).toBe('ended:pr-5-closed');
    },
    'row 14: another PrPhase word, or a word outside it, is unmeasurable': () => {
      for (const w of ['open', 'draft', 'none', 'unknown', 'unchecked', 'no-commits']) {
        expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, w)] }))).toBe(`unmeasurable:phase-${w}`);
      }
      for (const w of ['MERGED', 'landed', 7, null]) expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, w as string)] })))
        .toBe('unmeasurable:phase-unknown');
    },
    'row 15: an unparsable lineage is unmeasurable': () => {
      for (const l of ['[]', null, {}, [null], [{ pr: '5', recordedAt: OPENED_S + 1 }], [{ pr: 5 }], [7]]) {
        expect(at(PR_REPLACED, runFacts({ closePr: null, lineage: l }))).toBe('unmeasurable:lineage-unreadable');
      }
    },
    'row 16: a terminal run whose PR is neither its closePr nor in its window is unmeasurable': () => {
      expect(at(PR_REPLACED, runFacts({ closePr: closePr(7, true), lineage: [] }))).toBe('unmeasurable:not-this-runs-pr');
      expect(at(PR_REPLACED, runFacts({ state: 'failed', closePr: null, lineage: [lin(6, 'merged')] }))).toBe('unmeasurable:not-this-runs-pr');
    },
    'row 17: review-passed on a failed work run is ended': () => {
      expect(at(REVIEW, runFacts({ state: 'failed', closeDetail: 'abandon:x' }, [{ state: 'done' }]))).toBe('ended:abandon');
    },
    'row 18: review-passed with a review open is pending': () => {
      for (const s of OPEN_STATES) expect(at(REVIEW, runFacts({}, [{ state: 'done' }, { state: s }]))).toBe('pending:run-4-review-open');
    },
    'row 19: review-passed with a review closed done is unmeasurable: the verdict is not recorded (DT4)': () => {
      expect(at(REVIEW, runFacts({}, [{ state: 'done' }]))).toBe('unmeasurable:verdict-not-recorded');
      expect(at(REVIEW, runFacts({}, [{ state: 'failed' }, { state: 'done' }]))).toBe('unmeasurable:verdict-not-recorded');
    },
    'row 20: review-passed with no review, or only failed ones, is pending': () => {
      expect(at(REVIEW, runFacts({}, []))).toBe('pending:run-4-no-review');
      expect(at(REVIEW, runFacts({ state: 'working' }, []))).toBe('pending:run-4-no-review');
      expect(at(REVIEW, runFacts({}, [{ state: 'failed' }, { state: 'failed' }]))).toBe('pending:run-4-no-review');
    },
    'review-passed with reviews unread, or a review state outside RunState, is unmeasurable': () => {
      expect(at(REVIEW, runFacts({}))).toBe('unmeasurable:reviews-unread');
      expect(at(REVIEW, runFacts({}, [{ state: 'done' }, { state: 'bogus' }]))).toBe('unmeasurable:state-unknown');
    },
    'row 21: operator-confirms on a done item passes': () => { expect(at(ITEM, itemFacts('done'))).toBe('passed:item-9-done'); },
    'row 22: operator-confirms on a dismissed or withdrawn item is ended': () => {
      expect(at(ITEM, itemFacts('dismissed'))).toBe('ended:dismissed');
      expect(at(ITEM, itemFacts('withdrawn'))).toBe('ended:withdrawn');
    },
    'row 23 and the tick case (F2): open and checking are pending, and checking then return then open stays pending': () => {
      for (const s of ['checking', 'open', 'checking', 'open']) expect(at(ITEM, itemFacts(s))).toBe(`pending:item-9-${s}`);
    },
    'the sweep: every target, run state, closePr, lineage and review set answers one word, ids and words only': () => {
      const states = ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'done', 'failed', 'unknown', 'bogus'];
      const cps = [closePr(7, true), closePr(7, false), closePr(5, true), null, '{'];
      const lins = [[], [lin(5, 'merged')], [lin(5, 'merged', OPENED_S - 1)], [lin(5, 'closed')], [lin(5, 'draft')], [lin(5, 'x')], 'bad'];
      const revs = [undefined, [], [{ state: 'done' }], [{ state: 'working' }], [{ state: 'failed' }], [{ state: 'bogus' }]];
      const words = ['passed', 'ended', 'pending', 'unmeasured', 'unmeasurable'];
      let n = 0;
      for (const t of [RUN_CLOSED, PR_MERGED, PR_REPLACED, REVIEW]) for (const state of states) for (const c of cps) for (const l of lins) {
        for (const r of revs) {
          const a = m.targetVerdict(t, runFacts({ state, closePr: c, lineage: l }, r));
          expect(words).toContain(a.kind);
          expect('evidence' in a ? a.evidence : a.why).toMatch(/^[a-z0-9][a-z0-9:-]*$/);
          if (state === 'bogus') expect(word(a)).toBe('unmeasurable:state-unknown');
          else if (OPEN_STATES.includes(state) && t !== REVIEW) expect(word(a)).toBe(`pending:run-4-${state}`);
          else if (a.kind === 'passed' && t === RUN_CLOSED) expect([closePr(7, true), closePr(5, true)]).toContain(c);
          n++;
        }
      }
      for (const s of ['open', 'checking', 'done', 'withdrawn', 'dismissed', 'bogus']) {
        expect(words).toContain(m.targetVerdict(ITEM, itemFacts(s)).kind);
        n++;
      }
      expect(n).toBe(4 * 10 * 5 * 7 * 6 + 6);
    },
    'the property: degrading any fact never moves an answer to passed or ended': () => {
      const bases: [DoneTarget, TargetFacts][] = [
        [RUN_CLOSED, runFacts()], [RUN_CLOSED, runFacts({ closePr: closePr(7, false) })],
        [RUN_CLOSED, runFacts({ state: 'failed', closeDetail: 'abandon:x' })], [RUN_CLOSED, runFacts({ state: 'working' })],
        [PR_MERGED, runFacts()], [PR_MERGED, runFacts({ closePr: closePr(7, false) })],
        [PR_REPLACED, runFacts({ closePr: closePr(7, false), lineage: [lin(5, 'merged')] })],
        [PR_REPLACED, runFacts({ closePr: null, lineage: [lin(5, 'closed')] })],
        [REVIEW, runFacts({ state: 'failed' }, [])], [REVIEW, runFacts({}, [{ state: 'done' }])], [REVIEW, runFacts({}, [])],
        [ITEM, itemFacts('done')], [ITEM, itemFacts('dismissed')], [ITEM, itemFacts('checking')],
      ];
      const degraded = (f: TargetFacts): TargetFacts[] => {
        const out: TargetFacts[] = [{ kind: 'threw', why: 'Error' }];
        if (f.kind === 'item') return [...out, { kind: 'item', item: 'absent' }, itemFacts('bogus')];
        if (f.kind !== 'run' || typeof f.run === 'string') return out;
        const r = f.run;
        const re = f.reviews;
        return [...out, { kind: 'run', run: 'absent' }, { kind: 'run', run: 'unreadable' },
          runFacts({ ...r, state: 'bogus' }, re), runFacts({ ...r, closePr: '{' }, re), runFacts({ ...r, lineage: 'bad' }, re),
          runFacts(r, undefined), runFacts(r, [...(re ?? []), { state: 'bogus' }])];
      };
      for (const [t, f] of bases) {
        const was = word(m.targetVerdict(t, f));
        for (const d of degraded(f)) {
          const now = m.targetVerdict(t, d);
          if (now.kind === 'passed' || now.kind === 'ended') expect(word(now)).toBe(was);
        }
      }
    },
  };
}
