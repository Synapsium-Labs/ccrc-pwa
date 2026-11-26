// Overlord W1 readiness, plan `w1-readiness.md` Task 4 Step 1: what the operator is told. The dead push's payload
// (`readinessPushOf`), the words of each item (`readinessItemTextOf`, over L0's `READINESS_ITEM_TEXT`) and the item rules
// (`readinessNotices`) that decide which of them are raised, settled or closed. Pure: no database, no clock. The expected
// words are written out here, never read from L0, so a changed or swapped text reds a case.
import { describe, expect, it } from 'vitest';
import { STRAND_CAUSES, type StrandCause } from '../../shared/overlord-readiness.js';
import type { EarliestReset } from '../../shared/loadLines.js';
import type { TurnMarkRead } from '../src/coord/stall.js';
import {
  readinessEarliestReset, readinessItemTextOf, readinessNotices, readinessPushOf,
  type Fact, type NoticeInputs, type ReadinessAnswer, type ReadinessItemContext, type ReadinessItemRecord, type ReadinessNotice,
  type SubjectReadings,
} from '../src/coord/overlordReadiness.js';

const m = <T>(value: T): Fact<T> => ({ kind: 'measured', value });
const u = (why: string): { kind: 'unmeasured'; why: string } => ({ kind: 'unmeasured', why });

// ── The dead push ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe('readinessPushOf: the dead push\'s payload', () => {
  it('with Restart: the title, the restart body, the home url, the tag, the one Restart action and the key of the row', () => {
    expect(readinessPushOf(7, true)).toEqual({
      title: 'The Overlord has stopped',
      body: 'Questions go to you as usual. Restart it from the Overlord place.',
      tag: 'overlord-readiness',
      url: '/',
      actions: [{ action: 'overlord-restart', title: 'Restart' }],
      dedupeKey: 'overlord-dead:7',
    });
  });

  it('without Restart: the restarting-repeatedly body and no action', () => {
    expect(readinessPushOf(7, false)).toEqual({
      title: 'The Overlord has stopped',
      body: 'Questions go to you as usual. It is restarting repeatedly: open the Overlord place.',
      tag: 'overlord-readiness',
      url: '/',
      actions: [],
      dedupeKey: 'overlord-dead:7',
    });
  });

  it('the dedupe key is per episode row, and the Restart action is the only thing withRestart changes besides the body', () => {
    expect(readinessPushOf(8, true).dedupeKey).toBe('overlord-dead:8');
    expect(readinessPushOf(8, true).dedupeKey).not.toBe(readinessPushOf(9, true).dedupeKey);
    const a = readinessPushOf(3, true); const b = readinessPushOf(3, false);
    expect({ ...a, body: '', actions: [] }).toEqual({ ...b, body: '', actions: [] });
    expect(a.body).not.toBe(b.body);
  });
});

// ── The items' words ────────────────────────────────────────────────────────────────────────────────────────────────────

const markOf = (over: Record<string, unknown> = {}): TurnMarkRead => ({
  ok: true, sessionId: 'cc-overlord-a', state: 'failed', event: 'StopFailure', at: 1, turnAt: null, stopAt: 1, bg: 0, bgKinds: [], bgIds: [],
  err: 'rate_limit', restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: 0, graceUntil: null, ...over,
}) as unknown as TurnMarkRead;
const AT_NOON = Date.UTC(2026, 10, 26, 12, 0, 0) / 1000;
const AT_LATER = Date.UTC(2026, 10, 27, 6, 30, 15) / 1000;
const sub = (over: Partial<SubjectReadings> = {}): SubjectReadings => ({
  ladder: { kind: 'read', operatorRung: 'full' }, body: { kind: 'up' }, generation: { ok: true, value: null }, restarts: { ok: true, value: 0 },
  candidates: { kind: 'candidates', list: [{ id: 'lane-a', limits: undefined, serves: 'at-ceiling' }, { id: 'lane-b', limits: undefined, serves: 'at-ceiling' }] },
  resets: { ok: true, value: { 'lane-a': { kind: 'at', atS: AT_LATER }, 'lane-b': { kind: 'at', atS: AT_NOON } } },
  strand: { kind: 'none' }, swapBlocked: null, turnMark: { ok: false, reason: 'absent' }, hookState: { ok: false, reason: 'no-state' },
  sessionStatus: 'idle', dialogSince: null, unsettled: { kind: 'measured', value: [] }, servedReadAt: { kind: 'measured', value: 'none' },
  continuityReadAt: { ok: true, value: null }, ...over,
}) as SubjectReadings;
const ctx = (over: Partial<SubjectReadings> = {}, count: Fact<number> = m(2)): ReadinessItemContext => ({ readings: sub(over), count });
const textOf = (item: 'stranded' | 'count' | 'hold', key: string, c: ReadinessItemContext = ctx()) => readinessItemTextOf({ item, key }, c);

/** The seven causes' words, written out: the title's cause sentence, the static `why`, the `how` steps. */
const STRANDED: Record<StrandCause, { title: string; why: string; how: string[] }> = {
  limited: {
    title: 'The Overlord cannot run: every account in its set is limited',
    why: 'Every account in the Overlord\'s set is at its limit, so no session of it can run until one resets.',
    how: ['Wait for the earliest reset.'],
  },
  projection: {
    title: 'The Overlord cannot run: the pool projection is stale or unreadable',
    why: 'The pool projection that says which accounts can serve it is stale or unreadable.',
    how: ['Check the pool sync and the control-plane link.', 'A reset does not clear this.'],
  },
  'set-unreadable': {
    title: 'The Overlord cannot run: the set on its route record is unreadable or malformed',
    why: 'The account set saved on its route record cannot be read.',
    how: ['Save the set again in Settings.'],
  },
  'set-admits-none': {
    title: 'The Overlord cannot run: its set admits no account that can serve it',
    why: 'Its account set admits no account that can serve it.',
    how: ['Widen the set in Settings, or bring an account back.'],
  },
  'swap-blocked': {
    title: 'The Overlord cannot run: a swap off its account was refused',
    why: 'A swap off its account was refused, so it stays on an account that cannot serve it.',
    how: ['Open the session to see why.'],
  },
  'turn-failed': {
    title: 'The Overlord cannot run: its last turn failed on its account',
    why: 'Its last turn failed on its account.',
    how: ['It moves at its next renewal.', 'Check the account in Settings.'],
  },
  unread: {
    title: 'The Overlord cannot run: ccd marked it stranded',
    why: 'ccd marked the session stranded, and no structured reader names the cause.',
    how: ['Open the session to see why.'],
  },
};
/** The one measured sentence each cause's reading appends to its `why`, for a readings fixture that carries the cause. */
const DETAIL: Record<StrandCause, { over: Partial<SubjectReadings>; sentence: string }> = {
  limited: { over: {}, sentence: ' The earliest reset is 2026-11-26T12:00:00Z.' },
  projection: { over: {}, sentence: '' },
  'set-unreadable': { over: {}, sentence: '' },
  'set-admits-none': { over: {}, sentence: '' },
  'swap-blocked': { over: { swapBlocked: { at: 1, reason: 'the ceiling' } }, sentence: ' ccd recorded the refusal: "the ceiling".' },
  'turn-failed': { over: { turnMark: markOf() }, sentence: ' The account\'s failure word is rate_limit.' },
  unread: { over: { strand: { kind: 'marked', reason: 'pool epoch stale' } }, sentence: ' ccd\'s reason: "pool epoch stale".' },
};

describe('readinessItemTextOf: the stranded item, each cause', () => {
  it('the table covers the seven causes this test spells', () => {
    expect([...STRAND_CAUSES].sort()).toEqual(Object.keys(STRANDED).sort());
    expect(STRAND_CAUSES).toHaveLength(7);
  });

  for (const cause of STRAND_CAUSES) {
    it(`${cause}: its title, its words and its measured detail`, () => {
      const t = textOf('stranded', cause, ctx(DETAIL[cause].over));
      expect(t).toEqual({ title: STRANDED[cause].title, why: `${STRANDED[cause].why}${DETAIL[cause].sentence}`, how: STRANDED[cause].how });
    });
  }

  it('every cause has its own title and its own why: no two causes share a text', () => {
    const titles = STRAND_CAUSES.map((c) => textOf('stranded', c).title);
    const whys = STRAND_CAUSES.map((c) => textOf('stranded', c).why);
    expect(new Set(titles).size).toBe(7);
    expect(new Set(whys).size).toBe(7);
  });

  it('a cause this build does not know gets the fallback text, and does not throw', () => {
    expect(textOf('stranded', 'from-the-future')).toEqual({
      title: 'The Overlord cannot run: unmeasured',
      why: 'The session is stranded for a cause this build does not know.',
      how: ['Open the session to see why.'],
    });
  });

  it('with no readings at all every cause still answers a text, and a detail reads unmeasured', () => {
    const none: ReadinessItemContext = { readings: null, count: u('count: not read') };
    for (const cause of STRAND_CAUSES) {
      const t = textOf('stranded', cause, none);
      expect(t.title).toBe(STRANDED[cause].title);
      expect(t.how).toEqual(STRANDED[cause].how);
    }
    expect(textOf('stranded', 'limited', none).why).toBe(`${STRANDED.limited.why} The earliest reset is unmeasured.`);
    expect(textOf('stranded', 'swap-blocked', none).why).toBe(`${STRANDED['swap-blocked'].why} The refusal is unmeasured.`);
    expect(textOf('stranded', 'turn-failed', none).why).toBe(`${STRANDED['turn-failed'].why} The account's failure word is unmeasured.`);
    expect(textOf('stranded', 'unread', none).why).toBe(`${STRANDED.unread.why} ccd's reason is unmeasured.`);
  });

  it('the turn-failed word is the marker\'s own token, and an unreadable or tokenless marker reads unmeasured', () => {
    expect(textOf('stranded', 'turn-failed', ctx({ turnMark: markOf({ err: 'billing_error' }) })).why).toMatch(/failure word is billing_error\.$/);
    expect(textOf('stranded', 'turn-failed', ctx({ turnMark: markOf({ err: null }) })).why).toMatch(/failure word is unmeasured\.$/);
    expect(textOf('stranded', 'turn-failed', ctx({ turnMark: { ok: false, reason: 'unmeasured' } })).why).toMatch(/failure word is unmeasured\.$/);
  });

  it('the strand reason is quoted as ccd wrote it, and an unreadable marker reads unmeasured', () => {
    expect(textOf('stranded', 'unread', ctx({ strand: { kind: 'marked', reason: 'a "quoted" word; and more' } })).why)
      .toMatch(/ccd's reason: "a "quoted" word; and more"\.$/);
    expect(textOf('stranded', 'unread', ctx({ strand: { kind: 'unreadable' } })).why).toMatch(/ccd's reason is unmeasured\.$/);
  });
});

describe('the earliest reset, three arms', () => {
  const resets = (value: Record<string, EarliestReset>) => ({ ok: true as const, value });

  it('a time: the earliest of the candidates\' resets, as UTC to the second', () => {
    expect(readinessEarliestReset(sub())).toEqual({ kind: 'at', atS: AT_NOON });
    expect(textOf('stranded', 'limited').why).toMatch(/The earliest reset is 2026-11-26T12:00:00Z\.$/);
    const later = ctx({ resets: resets({ 'lane-a': { kind: 'at', atS: AT_LATER }, 'lane-b': { kind: 'at', atS: AT_LATER } }) });
    expect(textOf('stranded', 'limited', later).why).toMatch(/The earliest reset is 2026-11-27T06:30:15Z\.$/);
  });

  it('none-exhausted: no candidate has a reset pending', () => {
    const r = resets({ 'lane-a': { kind: 'none-exhausted' }, 'lane-b': { kind: 'none-exhausted' } });
    expect(readinessEarliestReset(sub({ resets: r }))).toEqual({ kind: 'none-exhausted' });
    expect(textOf('stranded', 'limited', ctx({ resets: r })).why).toMatch(/No account reads exhausted, so no reset is pending\.$/);
  });

  it('a none-exhausted candidate beside one with a reset leaves the reset the earliest', () => {
    const r = resets({ 'lane-a': { kind: 'none-exhausted' }, 'lane-b': { kind: 'at', atS: AT_LATER } });
    expect(readinessEarliestReset(sub({ resets: r }))).toEqual({ kind: 'at', atS: AT_LATER });
  });

  it('unmeasured: a candidate\'s reset that cannot be read, a missing reading, a failed read or no candidates', () => {
    const one = resets({ 'lane-a': { kind: 'at', atS: AT_LATER }, 'lane-b': { kind: 'unmeasured', why: 'no-sample' } });
    expect(readinessEarliestReset(sub({ resets: one }))).toEqual({ kind: 'unmeasured', why: 'no-sample' });
    expect(textOf('stranded', 'limited', ctx({ resets: one })).why).toMatch(/The earliest reset is unmeasured\.$/);
    expect(readinessEarliestReset(sub({ resets: resets({ 'lane-a': { kind: 'at', atS: AT_LATER } }) }))).toMatchObject({ kind: 'unmeasured' });
    expect(readinessEarliestReset(sub({ resets: { ok: false, detail: 'boom' } }))).toEqual({ kind: 'unmeasured', why: 'boom' });
    expect(readinessEarliestReset(sub({ candidates: { kind: 'candidates', list: [] } }))).toMatchObject({ kind: 'unmeasured' });
    expect(readinessEarliestReset(sub({ candidates: { kind: 'unmeasured', why: 'designation-unreadable' } }))).toMatchObject({ kind: 'unmeasured' });
    expect(readinessEarliestReset(sub({ candidates: { kind: 'not-designated' } }))).toMatchObject({ kind: 'unmeasured' });
  });
});

describe('readinessItemTextOf: the count and hold items', () => {
  const COUNT = { title: 'The Overlord has fewer than two accounts',
    how: ['Widen its account set in Settings, or bring an account back.', 'Retiring the Overlord is the other way.'] };
  const COUNT_WHY = 'With fewer than two accounts that can serve it, a failing account leaves it nowhere to move.';

  it('the count item names the count, singular and plural', () => {
    expect(textOf('count', 'count', ctx({}, m(1)))).toEqual({ ...COUNT, why: `${COUNT_WHY} It counts 1 account that can serve it.` });
    expect(textOf('count', 'count', ctx({}, m(0)))).toEqual({ ...COUNT, why: `${COUNT_WHY} It counts 0 accounts that can serve it.` });
  });

  it('an unmeasured count reads unmeasured in the text', () => {
    expect(textOf('count', 'count', { readings: null, count: u('count: not read') }))
      .toEqual({ ...COUNT, why: `${COUNT_WHY} The count is unmeasured.` });
  });

  it('the hold item names the held lane in its title', () => {
    expect(textOf('hold', 'lane-a')).toEqual({
      title: 'An account is held out of the Overlord\'s list: lane-a',
      why: 'The Overlord\'s ordered list leaves this account out while its hold stands.',
      how: ['Open the hold beside this item to see which profile properties failed.',
        'Clear the hold beside this item once the account\'s config is fixed.'],
    });
    expect(textOf('hold', 'lane-b').title).toBe('An account is held out of the Overlord\'s list: lane-b');
  });
});

// ── Which items are raised, settled and closed ─────────────────────────────────────────────────────────────────────────

describe('readinessNotices: the item rules the texts ride on', () => {
  const ans = (word: ReadinessAnswer['word'], over: Partial<ReadinessAnswer> = {}): ReadinessAnswer =>
    ({ word, why: null, until: null, strandCause: null, restartable: false, ...over });
  const stranded = (cause: StrandCause): ReadinessAnswer => ans('stranded', { why: cause, strandCause: cause });
  const rec = (id: number, item: ReadinessItemRecord['item'], key: string, itemState: ReadinessItemRecord['itemState'] = 'open'): ReadinessItemRecord =>
    ({ id, item, key, itemId: 100 + id, raisedAt: 1, itemState });
  const notices = (answer: ReadinessAnswer, over: Partial<NoticeInputs> = {}): readonly ReadinessNotice[] =>
    readinessNotices({ written: { answer, episodeFirst: false, rowId: 7 }, records: [], count: m(2), holds: { kind: 'not-wired' }, ...over });

  it('under a set-admits-none strand the count item is suppressed, and a standing one is settled', () => {
    expect(notices(stranded('set-admits-none'), { count: m(0) })).toEqual([{ kind: 'raise', item: 'stranded', key: 'set-admits-none' }]);
    expect(notices(stranded('set-admits-none'), { count: m(0), records: [rec(1, 'stranded', 'set-admits-none'), rec(2, 'count', 'count')] }))
      .toEqual([{ kind: 'settle', recordId: 2, note: 'cleared' }]);
  });

  it('beside any other cause the count item is raised and left standing', () => {
    for (const cause of STRAND_CAUSES.filter((c) => c !== 'set-admits-none')) {
      expect([cause, notices(stranded(cause), { count: m(1) })])
        .toEqual([cause, [{ kind: 'raise', item: 'stranded', key: cause }, { kind: 'raise', item: 'count', key: 'count' }]]);
      expect([cause, notices(stranded(cause), { count: m(1), records: [rec(1, 'stranded', cause), rec(2, 'count', 'count')] })]).toEqual([cause, []]);
    }
  });

  it('the hold item with holds not-wired raises nothing and settles nothing', () => {
    expect(notices(ans('ready'), { holds: { kind: 'not-wired' } })).toEqual([]);
    expect(notices(ans('ready'), { holds: { kind: 'not-wired' }, records: [rec(1, 'hold', 'lane-a')] })).toEqual([]);
  });

  it('a hold read raises one item per held lane, which readinessItemTextOf then words by lane', () => {
    const out = notices(ans('ready'), { holds: { kind: 'read', lanes: ['lane-a', 'lane-b'] } });
    expect(out).toEqual([{ kind: 'raise', item: 'hold', key: 'lane-a' }, { kind: 'raise', item: 'hold', key: 'lane-b' }]);
    const titles = out.flatMap((n) => (n.kind === 'raise' ? [textOf(n.item, n.key).title] : []));
    expect(titles).toEqual(['An account is held out of the Overlord\'s list: lane-a', 'An account is held out of the Overlord\'s list: lane-b']);
  });

  it('an item the operator dismissed is closed, never settled, in every word', () => {
    for (const w of ['ready', 'stranded', 'absent', 'unproved'] as const) {
      const answer = w === 'stranded' ? stranded('limited') : ans(w);
      const out = notices(answer, { records: [rec(1, 'stranded', 'limited', 'dismissed')] });
      expect(out.filter((n) => n.kind === 'settle')).toEqual([]);
      expect(out.filter((n) => n.kind === 'close')).toEqual([{ kind: 'close', recordId: 1 }]);
    }
  });
});
