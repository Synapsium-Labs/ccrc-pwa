// D-6795: the pure half of the review-round cap (`coord/reviewcap.ts`).
//
// MUTATION ROWS (each measured red on the case(s) named, then restored; `run-routes.test.ts` "review-round cap"):
//   `rounds >= CAP` -> `rounds > CAP` ............ the 4th opens: refused case + the pure row at 3
//   drop the `!lifted` arm ...................... the lifted case and the pure "lifted run" row
//   CAP 3 -> 4 .................................. the constant row and the 4th-refused case
//   raise the ask on every refusal .............. "raised exactly once" (second refusal adds a notice)
//   count only `planned` review runs ............ rounds 1-3 case (the failed rounds are not counted)
//   delete the store's guard .................... both the refusal case and the lifted case (never refuses)
//   `reviewCapGate` never lifted .......... the lifted case (the 4th stays refused)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReadFailure } from '../../shared/agent-protocol.js';
import {
  REVIEW_FINDINGS_NONE_OPEN, REVIEW_FINDINGS_STATES, REVIEW_FINDINGS_WORDS, type ReviewFindings, type ReviewFindingsState,
} from '../../shared/api.js';
import { parseFile, parseSource, type CallSite, type ParsedFile } from './scan/parse.js';
import { REPO, walkSrc } from './rings/walkSrc.js';
import { REVIEW_FINDING_MAX, REVIEW_ROUND_CAP, cutWhole, extractOpenFindings, reviewCapAsk, reviewCapNotice, reviewCapRefuses, reviewCapStatus, reviewFindingsOf,
  effectiveReviewCap, COORD_LIFT_REASON_MIN, COORD_LIFT_REASON_MAX, coordLiftReason, coordLiftVerdict, coordLiftNotice, coordLiftEventDetail } from '../src/coord/reviewcap.js';

describe('reviewCapRefuses', () => {
  it('the cap is 3', () => { expect(REVIEW_ROUND_CAP).toBe(3); });
  it.each([[0, false], [1, false], [2, false], [3, true], [4, true]])('%i rounds, not lifted -> refuses %s', (n, want) => {
    expect(reviewCapRefuses(n, false, 0)).toBe(want);
  });
  it('a lifted run is never refused', () => { expect(reviewCapRefuses(7, true, 0)).toBe(false); });
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

// Review 960 F1: a cut never leaves part of a token, because the egress mask matches a key only whole.
describe('cutWhole', () => {
  it('leaves a text within the limit as it is', () => {
    expect(cutWhole('abc def', 7)).toBe('abc def');
  });
  it('keeps a cut that falls on whitespace as the bare cut', () => {
    expect(cutWhole('abc def ghi', 7)).toBe('abc def');
    expect(cutWhole('abc def ghi', 4)).toBe('abc ');
  });
  it('drops the whole token a cut falls inside, appending nothing', () => {
    expect(cutWhole('abc defghi jkl', 6)).toBe('abc');
  });
  it('a text with no whitespace before the limit comes out empty', () => {
    expect(cutWhole('abcdefghijkl mno', 6)).toBe('');
  });
  it('a findings line cut inside a token drops the token, and a line that is one long token is dropped', () => {
    const long = 'k'.repeat(REVIEW_FINDING_MAX + 5);
    const got = extractOpenFindings(`## Findings\n- **F1** see ${long}\n- ${long}\n- **F2** short\n`);
    expect(got).toEqual(['**F1** see', '**F2** short']);
  });
});

// D-6909: the cap's state on a run row. A work run carries it; a review run, or a run of unknown kind, carries null.
describe('reviewCapStatus', () => {
  it('a work run with no review_cap row reads rounds and the cap, nothing raised, lifted or granted', () => {
    expect(reviewCapStatus('work', 2, undefined)).toEqual({ rounds: 2, cap: 3, askedAt: null, liftedAt: null, granted: 0, askHandledAt: null, coordLift: null });
  });
  it('a work run carries its row\'s askedAt and liftedAt', () => {
    expect(reviewCapStatus('work', 3, { askedAt: 10, liftedAt: 20 })).toEqual({ rounds: 3, cap: 3, askedAt: 10, liftedAt: 20, granted: 0, askHandledAt: null, coordLift: null });
  });
  it('the cap is the effective one: a granted row of 3 reads cap 6 (D-8125)', () => {
    const lift = { at: 5, by: 'coordinator-a', reason: 'two real major findings remain open', rounds: 3, capBefore: 3, capAfter: 6, count: 1 };
    expect(reviewCapStatus('work', 4, { askedAt: 10, liftedAt: null, granted: 3, askHandledAt: 11, coordLift: lift }))
      .toEqual({ rounds: 4, cap: 6, askedAt: 10, liftedAt: null, granted: 3, askHandledAt: 11, coordLift: lift });
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
      expect(src, `${t} is declared in reviewcap.ts again`).not.toMatch(new RegExp(`^(?:export\\s+)?(?:interface|type)\\s+${t}\\b`, 'm'));
    }
  });
});

// D-6911 narrows on this: the PWA's Mail door asks for `kind: 'run'` with an empty session, so the cap notice should
// stay that shape's one literal writer in the server's source. A census over `scan/parse.ts`'s call facts, not text
// (`single-definition`'s ratchet holds `coord/routes.ts`'s literal source pins): every `notice`, `notify` or
// `notifyEach` call under `server/src` with an argument whose object literal says both. The door's real key is the
// measured cap state, a raised and unlifted ask on the named run, so a writer whose session is empty only at runtime
// can never open the door for a run that does not wait.
const NOTICE_CALLS = new Set(['notice', 'notify', 'notifyEach']);
const capShaped = (p: ParsedFile): CallSite[] => p.calls.filter((c) => c.name !== null && NOTICE_CALLS.has(c.name)
  && c.args.some((a) => /\bkind:\s*'run'/.test(a.text) && /\bsessionId:\s*''/.test(a.text)));

describe('the cap notice is the one kind run record with no session (D-6911)', () => {
  it('CONTROL: the census sees a reformatted literal, and a notify whose record is its second argument', () => {
    const fixture = "notice({\n  kind:   'run',\n  sessionId:\n    '',\n  title: t,\n});\n"
      + "notify(deps, { kind: 'run', sessionId: '', runId: 1 });\n"
      + "notify(deps, { kind: 'run', sessionId: id, runId: 1 });\n";
    expect(capShaped(parseSource(fixture)).map((c) => c.name)).toEqual(['notice', 'notify']);
  });

  it('finds exactly one such writer under server/src, inside POST /api/runs', () => {
    const files = walkSrc({ roots: ['server/src'], min: 150 });
    const hits = files.flatMap((f) => capShaped(parseFile(path.join(REPO, f))).map((c) => ({ f, c })));
    expect(hits.map(({ f, c }) => `${f}:${c.line}`)).toHaveLength(1);
    expect(hits[0]!.f).toBe('server/src/coord/routes.ts');
    const routes = parseFile(path.join(REPO, 'server/src/coord/routes.ts'));
    const open = routes.calls.filter((c) => c.name === 'post' && c.args[0]?.kind === 'string' && c.args[0].text === '/api/runs');
    expect(open).toHaveLength(1);
    expect(hits[0]!.c.start).toBeGreaterThan(open[0]!.start);
    expect(hits[0]!.c.end).toBeLessThan(open[0]!.end);
  });
});

// D-6910: the findings words are one table, read by the notice and the sheet. For the three states the notice speaks,
// its body carries that table entry; for `unnamed` it carries none of them.
describe('reviewCapNotice reads the shared findings words', () => {
  const last = { reviewRunId: 15, summary: 's', report: '/r.md' };
  const body = (f: ReviewFindings): string => reviewCapNotice(reviewCapAsk(12, 3, last, f)).body;
  it('says the none-open, absent and unreadable entries', () => {
    expect(body({ state: 'read', lines: [] })).toContain(REVIEW_FINDINGS_NONE_OPEN);
    expect(body({ state: 'absent' })).toContain(REVIEW_FINDINGS_WORDS.absent);
    expect(body({ state: 'unreadable' })).toContain(REVIEW_FINDINGS_WORDS.unreadable);
  });
  it('stays silent on unnamed', () => {
    const b = body({ state: 'unnamed' });
    for (const w of [REVIEW_FINDINGS_NONE_OPEN, ...Object.values(REVIEW_FINDINGS_WORDS)]) expect(b).not.toContain(w);
  });
});

describe('effectiveReviewCap and reviewCapRefuses with a grant (D-8125)', () => {
  it('the effective cap is the base plus the grant', () => {
    expect(effectiveReviewCap(0)).toBe(3);
    expect(effectiveReviewCap(6)).toBe(9);
  });
  it('a grant moves the refusal point; a lift still removes it', () => {
    expect(reviewCapRefuses(3, false, 0)).toBe(true);
    expect(reviewCapRefuses(3, false, 3)).toBe(false);
    expect(reviewCapRefuses(6, false, 3)).toBe(true);
    expect(reviewCapRefuses(99, true, 0)).toBe(false);
  });
});

describe('coordLiftReason (D-8125)', () => {
  it('the bounds are 16 and 300', () => {
    expect(COORD_LIFT_REASON_MIN).toBe(16);
    expect(COORD_LIFT_REASON_MAX).toBe(300);
  });
  it.each([[undefined], [42], [''], ['   '], ['too short']])('%j is refused naming both bounds', (raw) => {
    const r = coordLiftReason(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.detail).toContain('16'); expect(r.detail).toContain('300'); }
  });
  it('a multi-line reason is refused', () => {
    const r = coordLiftReason('two real majors still open\nsecond line');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/one line/);
    expect(coordLiftReason('two real majors still open\rsecond line').ok).toBe(false);
  });
  it('a real reason passes unchanged', () => {
    const t = 'F1 and F3 are real majors and round 3 closed two of five';
    expect(coordLiftReason(`  ${t}  `)).toEqual({ ok: true, reason: t });
  });
  it('a 400-character reason is cut to at most 300 and never inside a token', () => {
    const raw = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ').slice(0, 400);
    const r = coordLiftReason(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reason.length).toBeLessThanOrEqual(300);
      expect(raw.startsWith(r.reason)).toBe(true);
      expect(/^word\d+$/.test(r.reason.split(' ').pop()!)).toBe(true);
      expect(raw[r.reason.length]).toBe(' ');
    }
  });
  it('a secret-shaped key is masked, no 8-character slice survives', () => {
    const secret = 'sk-' + 'Zq7Lm2Xv9Rt4Bw8Nc3Hd6Fy1Ka5Js0Pe';
    const r = coordLiftReason(`round 3 closed two majors, key ${secret} was pasted by mistake`);
    expect(r.ok).toBe(true);
    if (r.ok) for (let i = 0; i + 8 <= secret.length; i++) expect(r.reason.includes(secret.slice(i, i + 8))).toBe(false);
  });
  it('a result shorter than the minimum after the cut is refused', () => {
    const secret = 'sk-' + 'Zq7Lm2Xv9Rt4Bw8Nc3Hd6Fy1Ka5Js0Pe';
    expect(coordLiftReason(secret).ok).toBe(false);
  });
});

describe('coordLiftVerdict (D-8125)', () => {
  type VerdictInput = Parameters<typeof coordLiftVerdict>[0];
  const base: VerdictInput = { kind: 'work', closed: false, rounds: 3, granted: 0, liftedAt: null, setting: 'on' };
  const refused = (over: Partial<VerdictInput>) => {
    const v = coordLiftVerdict({ ...base, ...over });
    return v.ok ? 'ok' : v.refused;
  };
  it('the setting off refuses even at the cap', () => { expect(refused({ setting: 'off' })).toBe('coord-lift-off'); });
  it('a review run and an unknown run are not found', () => {
    expect(refused({ kind: 'review' })).toBe('not-found');
    expect(refused({ kind: 'unknown' })).toBe('not-found');
  });
  it('a closed run is refused', () => { expect(refused({ closed: true })).toBe('run-closed'); });
  it('under the cap, or already lifted by the operator, is cap-not-reached', () => {
    expect(refused({ rounds: 2 })).toBe('cap-not-reached');
    expect(refused({ rounds: 5, granted: 3 })).toBe('cap-not-reached');
    expect(refused({ liftedAt: 1, rounds: 50 })).toBe('cap-not-reached');
  });
  it('at the cap it grants one more cap of rounds', () => {
    expect(coordLiftVerdict({ ...base })).toEqual({ ok: true, capBefore: 3, capAfter: 6 });
    expect(coordLiftVerdict({ ...base, rounds: 6, granted: 3 })).toEqual({ ok: true, capBefore: 6, capAfter: 9 });
  });
});

describe('coordLiftNotice and coordLiftEventDetail (D-8125)', () => {
  it('word the record exactly', () => {
    expect(coordLiftNotice(12, 'lane-a', 'two real majors still open', 3, 6)).toEqual({
      title: 'Review cap lifted by its coordinator',
      body: 'Run 12: lane-a allowed 3 more review rounds (cap 3 to 6). Why: two real majors still open',
    });
    expect(coordLiftEventDetail(3, 3, 6, 'two real majors still open')).toBe('coord-lift: rounds 3, cap 3 -> 6: two real majors still open');
  });
});
