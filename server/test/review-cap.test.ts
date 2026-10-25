// D-6795: the pure half of the review-round cap (`coord/reviewcap.ts`).
//
// MUTATION ROWS (each measured red on the case(s) named, then restored; `run-routes.test.ts` "review-round cap"):
//   `rounds >= CAP` -> `rounds > CAP` ............ the 4th opens: refused case + the pure row at 3
//   drop the `!lifted` arm ...................... the lifted case and the pure "lifted run" row
//   CAP 3 -> 4 .................................. the constant row and the 4th-refused case
//   raise the ask on every refusal .............. "raised exactly once" (second refusal adds a notice)
//   count only `planned` review runs ............ rounds 1-3 case (the failed rounds are not counted)
//   delete the store's guard .................... both the refusal case and the lifted case (never refuses)
//   `reviewCapLifted` always false .............. the lifted case (the 4th stays refused)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ReadFailure } from '../../shared/agent-protocol.js';
import { REVIEW_FINDINGS_STATES, type ReviewFindingsState } from '../../shared/api.js';
import { REVIEW_ROUND_CAP, extractOpenFindings, reviewCapAsk, reviewCapNotice, reviewCapRefuses, reviewCapStatus, reviewFindingsOf } from '../src/coord/reviewcap.js';

describe('reviewCapRefuses', () => {
  it('the cap is 3', () => { expect(REVIEW_ROUND_CAP).toBe(3); });
  it.each([[0, false], [1, false], [2, false], [3, true], [4, true]])('%i rounds, not lifted -> refuses %s', (n, want) => {
    expect(reviewCapRefuses(n, false)).toBe(want);
  });
  it('a lifted run is never refused', () => { expect(reviewCapRefuses(7, true)).toBe(false); });
});

describe('reviewCapNotice', () => {
  const none = { reviewRunId: null, summary: null, report: null };
  it('names the run, its rounds and the last review', () => {
    const n = reviewCapNotice(reviewCapAsk(12, 3, { reviewRunId: 15, summary: '2 findings', report: '/r.md' }, { state: 'read', lines: ['F1 needs a ruling: x'] }));
    expect(n.title).toBe('Review cap reached on run 12');
    expect(n.body).toContain('3 review rounds (cap 3)');
    expect(n.body).toContain('Last review (run 15): 2 findings');
    expect(n.body).toContain('Report: /r.md');
    expect(n.body).toContain('Open findings: F1 needs a ruling: x');
  });
  it('says so when no review has reported', () => {
    expect(reviewCapNotice(reviewCapAsk(12, 3, none, { state: 'unnamed' })).body).toContain('No review has reported yet.');
  });
});

describe('extractOpenFindings', () => {
  it('takes the bullets of the Findings section only, capped and redacted', () => {
    const md = '# R\n## Findings\n' + Array.from({ length: 12 }, (_, i) => `- **F${i}** x`).join('\n') + '\n## Nothing found at\n- lens\n';
    const got = extractOpenFindings(md);
    expect(got).toHaveLength(8);
    expect(got[0]).toBe('**F0** x');
    expect(got.join()).not.toContain('lens');
  });
  it('falls back to the needs-a-ruling lines when there is no Findings section', () => {
    expect(extractOpenFindings('prose\nF1 needs a ruling: which?\nmore')).toEqual(['F1 needs a ruling: which?']);
  });
  it('maps a read to four distinct states', () => {
    expect(reviewFindingsOf(null)).toEqual({ state: 'unnamed' });
    expect(reviewFindingsOf({ ok: false, reason: 'absent' })).toEqual({ state: 'absent' });
    expect(reviewFindingsOf({ ok: false, reason: 'unreadable' })).toEqual({ state: 'unreadable' });
    expect(reviewFindingsOf({ ok: true, content: '## Findings\n' })).toEqual({ state: 'read', lines: [] });
  });
});

// D-6909: the cap's state on a run row. A work run carries it; a review run, or a run of unknown kind, carries null.
describe('reviewCapStatus', () => {
  it('a work run with no review_cap row reads rounds and the cap, nothing raised or lifted', () => {
    expect(reviewCapStatus('work', 2, undefined)).toEqual({ rounds: 2, cap: 3, askedAt: null, liftedAt: null });
  });
  it('a work run carries its row\'s askedAt and liftedAt', () => {
    expect(reviewCapStatus('work', 3, { askedAt: 10, liftedAt: 20 })).toEqual({ rounds: 3, cap: 3, askedAt: 10, liftedAt: 20 });
  });
  it('a review run, and a run of unknown kind, carry null', () => {
    expect(reviewCapStatus('review', 0, undefined)).toBeNull();
    expect(reviewCapStatus('unknown', 3, { askedAt: 1, liftedAt: null })).toBeNull();
  });
});

// D-6910: the ask's types live in `shared/api.ts` so the PWA can read them. Its findings states are derived from one
// array (`STALL_STORED_STATES`' idiom, since that file cannot import `ReadFailure`), and their two read-failure words
// are held EQUAL to `ReadFailure` here, in both directions, at compile time.
type _Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _failuresAreReadFailure: _Same<Exclude<ReviewFindingsState, 'read' | 'unnamed'>, ReadFailure> = true;
void _failuresAreReadFailure;

describe('the ask\'s types moved to shared/api.ts (D-6910)', () => {
  it('names four findings states, read first', () => {
    expect(REVIEW_FINDINGS_STATES).toEqual(['read', 'unnamed', 'absent', 'unreadable']);
  });
  it('reviewcap.ts declares none of the three any more', () => {
    const src = readFileSync(new URL('../src/coord/reviewcap.ts', import.meta.url), 'utf8');
    for (const t of ['LastReviewReport', 'ReviewFindings', 'ReviewCapAsk']) {
      expect(src, `${t} is declared in reviewcap.ts again`).not.toMatch(new RegExp(`(?:interface|type)\\s+${t}\\b`));
    }
  });
});

// D-6911 relies on this: the PWA's Mail door matches the cap's record by `kind: 'run'` and an empty session, so the cap
// notice must stay the one writer of that literal shape in the server's source.
describe('the cap notice is the one kind run record with no session (D-6911)', () => {
  it('a scan of server/src finds exactly one such writer, and it is the cap notice', () => {
    const root = new URL('../..', import.meta.url).pathname;
    const grep = (args: string[]): string[] =>
      execFileSync('git', ['grep', '-n', ...args, "kind: 'run', sessionId: ''", '--', 'server/src'], { cwd: root, encoding: 'utf8' })
        .trim().split('\n');
    const hits = grep([]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^server\/src\/coord\/routes\.ts:\d+:.*title: n\.title/);
    // The line after it carries the cap notice's own tag: this writer is the review cap's, not another run notice's.
    expect(grep(['-A1'])[1]).toContain('tag: `review-cap-${work}`');
  });
});
