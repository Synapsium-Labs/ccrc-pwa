// The park's L1 deciders, case by case (approvals plan 2026-11-18, §3.3 and Tasks 3.1 to 3.3; approvals PR 3). Two lists of
// named cases: `APPROVAL_PARK_CASES` over `server/src/coord/approvalPark.ts` (the mint's word, the key, a retry's class, the
// doors' recording refusals, the one signing site's guard, `fetchedAt`, Waiting on you's view) and `APPROVAL_LAPSE_PARK_CASES`
// over `server/src/coord/questionPolicy.ts` (`decideApprovalLapse`'s park arms and the deferred push's parked drop). Run by
// `approval-park-policy.test.ts` and by the mutation floors' `sim/approvalParkSets.ts` over a mutated copy of each module.
// Neutral fixtures only.
import { expect } from 'vitest';
import type { ApprovalParkWord, ApprovalRefusal, ParkedApprovalView } from '../../shared/api.js';
import type { ParkFacts, SigningFacts } from '../src/coord/approvalPark.js';
import type { ApprovalLapse, ApprovalLapsePark, ApprovalLapseRow, DeferredApprovalPush, DeferredApprovalRows } from '../src/coord/questionPolicy.js';

export interface ApprovalParkModule {
  parkWordAt(laneLive: boolean, signedIn: boolean, slotsTaken: number): ApprovalParkWord;
  parkKeyOf(childId: string, runId: number, inputSha256: string): string;
  classMeets(freshClass: string, rulingClass: string): boolean;
  parkOpen(park: ParkFacts, now: number): boolean;
  parkRecordRefusal(
    row: { state: string; class: string; denyCurrent: boolean }, park: ParkFacts | null, authority: 'coordinator' | 'operator',
    verdict: 'allow' | 'deny', now: number,
  ): ApprovalRefusal | null;
  signingRefusal(f: SigningFacts): ApprovalRefusal | null;
  fetchedAtRecordable(now: number, expiresAt: number, graceMs: number): boolean;
  parkHorizonFrom(parkedAt: number): number;
  parkedApprovalViewOf(rows: readonly (Parameters<typeof import('../src/coord/approvalPark.js').parkedApprovalViewOf>[0][number])[], now: number): ParkedApprovalView[];
}
export interface ApprovalLapseModule {
  decideApprovalLapse(row: ApprovalLapseRow, now: number, graceMs?: number, park?: ApprovalLapsePark | null): ApprovalLapse;
  decideDeferredApprovalPush(entry: { rowIds: readonly number[] }, rows: DeferredApprovalRows, now: number, painted: boolean, graceMs: number): DeferredApprovalPush;
}

interface Case<M> { readonly name: string; readonly run: (mod: M) => void }

const NOW = 1_786_000_000_000;
const H = 2 * 60 * 60 * 1000;
const open = (over: Partial<ParkFacts> = {}): ParkFacts => ({ horizon: NOW + 1_000, void: false, ruling: null, coordDenied: false, coordDeclined: false, ...over });
const parked = (cls = 'ordinary', denyCurrent = true) => ({ state: 'parked', class: cls, denyCurrent });
const sign = (over: Partial<SigningFacts> = {}): SigningFacts => ({
  authority: 'coordinator', verdict: 'allow', ruler: 'project-a-calm-mesa', rowClass: 'ordinary', freshClass: 'ordinary',
  rowDenyCurrent: true, denyStandingNow: 'current', claimantNow: 'project-a-calm-mesa', parkDenied: false, ...over,
});

export const APPROVAL_PARK_CASES: readonly Case<ApprovalParkModule>[] = [
  // ── the mint's word (F1, F12, the cap) ──
  { name: 'the word: shadow while the lane is not live', run: (m) => expect(m.parkWordAt(false, true, 0)).toBe('shadow') },
  { name: 'the word: shadow while sign-in is dark, even with the lane live (F12)', run: (m) => expect(m.parkWordAt(true, false, 0)).toBe('shadow') },
  { name: 'the word: live under the cap', run: (m) => expect([0, 1, 2].map((n) => m.parkWordAt(true, true, n))).toEqual(['live', 'live', 'live']) },
  { name: 'the word: capped when the three slots are taken, and past them (the cap race)', run: (m) => {
    expect(m.parkWordAt(true, true, 3)).toBe('capped');
    expect(m.parkWordAt(true, true, 4)).toBe('capped');
  } },
  { name: 'the word: a shadow lane is shadow even at the cap (one meaning per word)', run: (m) => expect(m.parkWordAt(false, true, 3)).toBe('shadow') },
  // ── the key (F8-d) ──
  { name: 'the key names the registry id, the run and the input digest', run: (m) => {
    expect(m.parkKeyOf('project-a-quiet-basin', 7, 'ab'.repeat(32))).toBe(`project-a-quiet-basin:7:${'ab'.repeat(32)}`);
  } },
  { name: 'the key: another run at a recycled id is another key', run: (m) => {
    expect(m.parkKeyOf('project-a-quiet-basin', 7, 'cd')).not.toBe(m.parkKeyOf('project-a-quiet-basin', 8, 'cd'));
  } },
  // ── a retry's class ──
  { name: 'a retry: the same class meets', run: (m) => expect([m.classMeets('ordinary', 'ordinary'), m.classMeets('escalate', 'escalate')]).toEqual([true, true]) },
  { name: 'a retry: a lower class meets', run: (m) => expect(m.classMeets('ordinary', 'escalate')).toBe(true) },
  { name: 'a retry: a higher class never meets (held fresh)', run: (m) => expect(m.classMeets('escalate', 'ordinary')).toBe(false) },
  { name: 'a retry: forbidden, or a class this build does not know, never meets', run: (m) => {
    expect([m.classMeets('forbidden', 'forbidden'), m.classMeets('from-the-future', 'escalate'), m.classMeets('forbidden', 'from-the-future')])
      .toEqual([false, false, false]);
  } },
  // ── the park's openness ──
  { name: 'a park is open before its horizon and closed at it', run: (m) => {
    expect(m.parkOpen(open({ horizon: NOW + 1 }), NOW)).toBe(true);
    expect(m.parkOpen(open({ horizon: NOW }), NOW)).toBe(false);
  } },
  { name: 'a void park is closed; one with no horizon yet is open', run: (m) => {
    expect(m.parkOpen(open({ void: true }), NOW)).toBe(false);
    expect(m.parkOpen(open({ horizon: null }), NOW)).toBe(true);
  } },
  { name: 'the horizon is two hours from the first park (open question 5)', run: (m) => expect(m.parkHorizonFrom(NOW)).toBe(NOW + H) },
  // ── recording a ruling on a park (the doors) ──
  { name: 'record: a row that is not parked is hook-gone', run: (m) => expect(m.parkRecordRefusal({ ...parked(), state: 'held' }, open(), 'operator', 'allow', NOW)).toBe('hook-gone') },
  { name: 'record: no park, a void park, a park past its horizon: hook-gone', run: (m) => {
    expect(m.parkRecordRefusal(parked(), null, 'operator', 'deny', NOW)).toBe('hook-gone');
    expect(m.parkRecordRefusal(parked(), open({ void: true }), 'operator', 'deny', NOW)).toBe('hook-gone');
    expect(m.parkRecordRefusal(parked(), open({ horizon: NOW }), 'coordinator', 'deny', NOW)).toBe('hook-gone');
  } },
  { name: 'record: an unspent ruling refuses a second principal (park-ruled), a spent one does not (F5)', run: (m) => {
    const unspent = open({ ruling: { verdict: 'allow', authority: 'coordinator', spent: false } });
    const spent = open({ ruling: { verdict: 'allow', authority: 'coordinator', spent: true } });
    expect(m.parkRecordRefusal(parked(), unspent, 'operator', 'deny', NOW)).toBe('park-ruled');
    expect(m.parkRecordRefusal(parked(), spent, 'operator', 'allow', NOW)).toBeNull();
  } },
  { name: 'record: an allow on a key the coordinator denied is refused for every authority (F3)', run: (m) => {
    expect(m.parkRecordRefusal(parked(), open({ coordDenied: true }), 'operator', 'allow', NOW)).toBe('coordinator-denied');
    expect(m.parkRecordRefusal(parked(), open({ coordDenied: true }), 'coordinator', 'allow', NOW)).toBe('coordinator-denied');
    expect(m.parkRecordRefusal(parked(), open({ coordDenied: true }), 'operator', 'deny', NOW)).toBeNull();
  } },
  { name: 'record: a forbidden row is never allowed', run: (m) => expect(m.parkRecordRefusal(parked('forbidden'), open(), 'operator', 'allow', NOW)).toBe('guard-forbidden') },
  { name: 'record: the coordinator may allow an ordinary, deny-current row only', run: (m) => {
    expect(m.parkRecordRefusal(parked('ordinary'), open(), 'coordinator', 'allow', NOW)).toBeNull();
    expect(m.parkRecordRefusal(parked('escalate'), open(), 'coordinator', 'allow', NOW)).toBe('guard-escalate');
    expect(m.parkRecordRefusal(parked('ordinary', false), open(), 'coordinator', 'allow', NOW)).toBe('deny-not-current');
  } },
  { name: 'record: the operator may allow ordinary or escalate, at any deny currency (Table 3b)', run: (m) => {
    expect(m.parkRecordRefusal(parked('escalate', false), open(), 'operator', 'allow', NOW)).toBeNull();
    expect(m.parkRecordRefusal(parked('ordinary'), open(), 'operator', 'allow', NOW)).toBeNull();
    expect(m.parkRecordRefusal(parked('from-the-future'), open(), 'operator', 'allow', NOW)).toBe('guard-escalate');
  } },
  { name: 'record: either principal may deny any parked row', run: (m) => {
    expect(m.parkRecordRefusal(parked('escalate', false), open(), 'coordinator', 'deny', NOW)).toBeNull();
    expect(m.parkRecordRefusal(parked('forbidden'), open(), 'operator', 'deny', NOW)).toBeNull();
  } },
  // ── the one signing site's guard (§3.4, F8-b, F2's carry) ──
  { name: 'sign: a coordinator allow of an ordinary, deny-current row by the claimant is signed', run: (m) => expect(m.signingRefusal(sign())).toBeNull() },
  { name: 'sign: a ruler no longer the claimant is refused, a deny too (the heir, F8-b)', run: (m) => {
    expect(m.signingRefusal(sign({ claimantNow: 'project-a-still-cove' }))).toBe('parent-changed');
    expect(m.signingRefusal(sign({ claimantNow: 'project-a-still-cove', verdict: 'deny' }))).toBe('parent-changed');
    expect(m.signingRefusal(sign({ claimantNow: null }))).toBe('parent-changed');
  } },
  { name: 'sign: the operator is not checked against the claimant', run: (m) => {
    expect(m.signingRefusal(sign({ authority: 'operator', ruler: 'operator', claimantNow: 'project-a-calm-mesa' }))).toBeNull();
  } },
  { name: 'sign: a deny is signed whatever the class or currency', run: (m) => {
    expect(m.signingRefusal(sign({ verdict: 'deny', rowClass: 'forbidden', freshClass: 'forbidden', rowDenyCurrent: false, denyStandingNow: 'history', parkDenied: true }))).toBeNull();
  } },
  { name: 'sign: an allow on a key the coordinator denied is refused for every authority', run: (m) => {
    expect(m.signingRefusal(sign({ parkDenied: true }))).toBe('coordinator-denied');
    expect(m.signingRefusal(sign({ authority: 'operator', parkDenied: true }))).toBe('coordinator-denied');
  } },
  { name: 'sign: forbidden by the stored or the fresh class is guard-forbidden', run: (m) => {
    expect(m.signingRefusal(sign({ rowClass: 'forbidden' }))).toBe('guard-forbidden');
    expect(m.signingRefusal(sign({ freshClass: 'forbidden' }))).toBe('guard-forbidden');
    expect(m.signingRefusal(sign({ authority: 'operator', freshClass: 'forbidden' }))).toBe('guard-forbidden');
  } },
  { name: 'sign: a coordinator allow of a row minted with older deny rules is deny-not-current', run: (m) => {
    expect(m.signingRefusal(sign({ rowDenyCurrent: false }))).toBe('deny-not-current');
  } },
  { name: 'sign (F2 carry): a row minted current whose deny file changed before the ruling is refused at signing', run: (m) => {
    expect(m.signingRefusal(sign({ denyStandingNow: 'history' }))).toBe('deny-not-current');
    expect(m.signingRefusal(sign({ denyStandingNow: 'none' }))).toBe('deny-not-current');
  } },
  { name: 'sign: no standing read at signing (the claimant door until PR 3b) answers as before', run: (m) => {
    expect(m.signingRefusal(sign({ denyStandingNow: 'unread' }))).toBeNull();
    expect(m.signingRefusal(sign({ denyStandingNow: 'unread', rowDenyCurrent: false }))).toBe('deny-not-current');
  } },
  { name: 'sign: a coordinator allow needs both classes ordinary, after the deny currency', run: (m) => {
    expect(m.signingRefusal(sign({ freshClass: 'escalate' }))).toBe('guard-escalate');
    expect(m.signingRefusal(sign({ rowClass: 'escalate' }))).toBe('guard-escalate');
    expect(m.signingRefusal(sign({ rowClass: 'escalate', rowDenyCurrent: false }))).toBe('deny-not-current');
  } },
  { name: 'sign: the operator may allow escalate at any deny currency, never an unknown class', run: (m) => {
    expect(m.signingRefusal(sign({ authority: 'operator', rowClass: 'escalate', freshClass: 'escalate', rowDenyCurrent: false, denyStandingNow: 'history' }))).toBeNull();
    expect(m.signingRefusal(sign({ authority: 'operator', freshClass: 'from-the-future' }))).toBe('guard-escalate');
  } },
  // ── `fetchedAt` (F8-c, F2-a) ──
  { name: 'fetchedAt: recorded when served at least the grace before expiry', run: (m) => {
    expect(m.fetchedAtRecordable(NOW, NOW + 10_000, 10_000)).toBe(true);
    expect(m.fetchedAtRecordable(NOW, NOW + 10_001, 10_000)).toBe(true);
  } },
  { name: 'fetchedAt: not recorded when served later than the grace before expiry', run: (m) => {
    expect(m.fetchedAtRecordable(NOW, NOW + 9_999, 10_000)).toBe(false);
    expect(m.fetchedAtRecordable(NOW, NOW - 1, 0)).toBe(false);
  } },
  // ── Waiting on you's view (§3.3.2) ──
  { name: 'the view lists open parked rows oldest first, held by the coordinator', run: (m) => {
    const row = (id: number, state = 'parked', park: ParkFacts | null = open()) => ({
      id, childId: 'project-a-quiet-basin', parentId: 'project-a-calm-mesa', runId: 7, agentId: '', tool: 'Bash',
      inputRedacted: 'rm -rf build', class: 'escalate', denyCurrent: true, askAt: NOW - 200_000, state, park,
    });
    const v = m.parkedApprovalViewOf([row(9), row(3), row(5, 'stale'), row(6, 'parked', open({ void: true })), row(8, 'parked', open({ horizon: NOW }))], NOW);
    expect(v.map((x) => x.id)).toEqual([3, 9]);
    expect(v[0]).toMatchObject({ holder: 'coordinator', tool: 'Bash', input: 'rm -rf build', ruled: null, horizon: NOW + 1_000 });
  } },
  { name: 'the view shows an unspent ruling, and a row whose park cannot be read with no horizon', run: (m) => {
    const base = { childId: 'project-a-quiet-basin', parentId: 'project-a-calm-mesa', runId: 7, agentId: '', tool: 'Bash', inputRedacted: null,
      class: 'escalate', denyCurrent: true, askAt: NOW, state: 'parked' };
    const v = m.parkedApprovalViewOf([
      { ...base, id: 1, park: open({ ruling: { verdict: 'allow', authority: 'operator', spent: false } }) },
      { ...base, id: 2, park: open({ ruling: { verdict: 'allow', authority: 'operator', spent: true } }) },
      { ...base, id: 3, park: null },
    ], NOW);
    expect(v.map((x) => [x.id, x.ruled, x.horizon])).toEqual([[1, { verdict: 'allow', authority: 'operator' }, NOW + 1_000], [2, null, NOW + 1_000], [3, null, null]]);
  } },
];

const CEIL = 540 * 1000;
const lrow = (over: Partial<ApprovalLapseRow>): ApprovalLapseRow => ({ state: 'held', askAt: NOW - 70_000, notifyAt: NOW - 10_000, parkWord: null, fetchedAt: null, ...over });
const GRACE = 10_000;

export const APPROVAL_LAPSE_PARK_CASES: readonly Case<ApprovalLapseModule>[] = [
  { name: 'lapse: a held row at notifyAt whose stored word is live parks', run: (m) => expect(m.decideApprovalLapse(lrow({ parkWord: 'live', notifyAt: NOW }), NOW, GRACE)).toBe('park') },
  { name: 'lapse: a held row inside its window does nothing, whatever its word', run: (m) => expect(m.decideApprovalLapse(lrow({ parkWord: 'live', notifyAt: NOW + 1 }), NOW, GRACE)).toBe('none') },
  { name: 'lapse: a shadow word lapses and records wouldPark (a shadow mint never parks)', run: (m) => expect(m.decideApprovalLapse(lrow({ parkWord: 'shadow' }), NOW, GRACE)).toBe('shadow-park') },
  { name: 'lapse: a capped word, and a row minted before PR 3, lapse as today', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ parkWord: 'capped' }), NOW, GRACE)).toBe('lapse');
    expect(m.decideApprovalLapse(lrow({ parkWord: null }), NOW, GRACE)).toBe('lapse');
    expect(m.decideApprovalLapse({ state: 'held', askAt: NOW - 70_000, notifyAt: NOW - 1 }, NOW)).toBe('lapse');
  } },
  { name: 'parked: none while its park is open', run: (m) => expect(m.decideApprovalLapse(lrow({ state: 'parked' }), NOW, GRACE, { horizon: NOW + 1, void: false })).toBe('none') },
  { name: 'parked: none past the hook ceiling (the lapse sweep never lapses it)', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'parked', askAt: NOW - CEIL - 1 }), NOW, GRACE, { horizon: NOW + 1, void: false })).toBe('none');
  } },
  { name: 'parked: stale at its horizon', run: (m) => expect(m.decideApprovalLapse(lrow({ state: 'parked' }), NOW, GRACE, { horizon: NOW, void: false })).toBe('stale') },
  { name: 'parked: stale at once when its park is void, or missing', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'parked' }), NOW, GRACE, { horizon: NOW + H, void: true })).toBe('stale');
    expect(m.decideApprovalLapse(lrow({ state: 'parked' }), NOW, GRACE, null)).toBe('stale');
  } },
  { name: 'the last poll: an unfetched ruling of a live row past notifyAt plus the grace parks', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'live', notifyAt: NOW - GRACE }), NOW, GRACE)).toBe('park');
    expect(m.decideApprovalLapse(lrow({ state: 'denied', parkWord: 'live', notifyAt: NOW - GRACE - 1 }), NOW, GRACE)).toBe('park');
  } },
  { name: 'the last poll: never inside the grace', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'live', notifyAt: NOW - GRACE + 1 }), NOW, GRACE)).toBe('none');
  } },
  { name: 'the last poll: never a fetched ruling', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'live', fetchedAt: NOW - 30_000 }), NOW, GRACE)).toBe('none');
  } },
  { name: 'the last poll: never a row minted in shadow, nor one minted before PR 3 (F2)', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'shadow' }), NOW, GRACE)).toBe('none');
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: null }), NOW, GRACE)).toBe('none');
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'capped' }), NOW, GRACE)).toBe('none');
  } },
  { name: 'the last poll: never at or past the hook ceiling', run: (m) => {
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'live', askAt: NOW - CEIL }), NOW, GRACE)).toBe('none');
    expect(m.decideApprovalLapse(lrow({ state: 'allowed', parkWord: 'live', askAt: NOW - CEIL + 1 }), NOW, GRACE)).toBe('park');
  } },
  { name: 'the deferred push drops an entry covering a parked row, painted or not (F4, F16)', run: (m) => {
    const rows: DeferredApprovalRows = { ok: true, rows: [{ id: 1, state: 'parked', notifyAt: NOW - 1, ruledAt: null }, { id: 2, state: 'held', notifyAt: NOW + 1, ruledAt: null }] };
    expect(m.decideDeferredApprovalPush({ rowIds: [1, 2] }, rows, NOW, true, GRACE)).toBe('drop');
  } },
];
