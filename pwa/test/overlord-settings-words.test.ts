// Settings › Overlord's words and pure readers (Overlord W1 home C, Tasks 8 and 9): `overlordSettingsWords.ts` (L1) and the
// Settings refusal readers in `lib/refusalWords.ts`. Neutral names only: the repository is public.
import { describe, expect, it } from 'vitest';
import type { DesignationView } from '../../shared/overlord-designation';
import { READINESS_ITEM_TEXT } from '../../shared/overlord-readiness';
import {
  ACCOUNT_FACT_REFUSAL_TEXT, ApiError, OVERLORD_PLACE_REFUSAL_TEXT, OVERLORD_SETTINGS_REFUSAL_TEXT, accountFactRefusalText,
  overlordSettingsRefusalText,
} from '../src/lib/api';
import {
  NOT_SET, OVERLORD_SETTINGS_WORDS as W, accountSetAnswerWords, backstopOf, backstopWords, billingWordOf, continuityWordOf,
  editedSetOf, holdLaneOfItem, holdLineOf, holdsOf, modelAnswerWords, overlordGateOf, overlordStatusOf, retentionChoicesOf,
  retentionOf, retentionWords, retireAnswerOf, retireOffered, retireWords, sameSet, setBoxesOf, settingsWarningText, storeAnswered,
  zoneChoicesOf,
} from '../src/overlord/overlordSettingsWords';
import type { ReadState } from '../src/overlord/readState';

const AT = 1_700_000_000_000;
const row = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 3, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
  pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND = row({ bound: { sessionId: 'lane-a-overlord', generation: 'g1' } });
type Read = ReadState<DesignationView | null>;
const refused = (status: number, error: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(status, { ok: false, error, ...extra });

describe('the gate keeps absent, unread, none and a row apart', () => {
  it.each<[string, Read, string]>([
    ['absent', { state: 'absent' }, 'absent'],
    ['loading', { state: 'loading' }, 'loading'],
    ['unmeasured', { state: 'unmeasured', error: 'HTTP 503' }, 'unmeasured'],
    ['answered with no row', { state: 'answered', value: null, at: AT }, 'none'],
    ['answered with a row', { state: 'answered', value: BOUND, at: AT }, 'row'],
    ['stale with a row', { state: 'stale', value: BOUND, at: AT, error: 'timeout' }, 'row'],
    ['stale with no row', { state: 'stale', value: null, at: AT, error: 'timeout' }, 'none'],
  ])('%s', (_name, read, kind) => {
    expect(overlordGateOf(read).kind).toBe(kind);
  });

  it('an absent read is never "no Overlord, start one": an older server is not a missing row', () => {
    // The hand mutant "read not-found before an answer" folds absent into none, as the home does.
    expect(overlordGateOf({ state: 'absent' })).toEqual({ kind: 'absent' });
    expect(storeAnswered(overlordGateOf({ state: 'absent' }))).toBe(false);
  });

  it('only an answer, fresh or stale, counts as the store having answered', () => {
    expect(storeAnswered(overlordGateOf({ state: 'loading' }))).toBe(false);
    expect(storeAnswered(overlordGateOf({ state: 'unmeasured', error: 'x' }))).toBe(false);
    expect(storeAnswered(overlordGateOf({ state: 'answered', value: null, at: AT }))).toBe(true);
    expect(storeAnswered(overlordGateOf({ state: 'stale', value: BOUND, at: AT, error: 'x' }))).toBe(true);
  });

  it('a stale read says when it was last read; a fresh one does not', () => {
    expect(overlordGateOf({ state: 'stale', value: BOUND, at: AT, error: 'x' })).toMatchObject({ staleAt: AT });
    expect(overlordGateOf({ state: 'answered', value: BOUND, at: AT })).toMatchObject({ staleAt: null });
  });
});

describe("the index's status line", () => {
  it.each<[string, Read, string | null, string | null]>([
    ['absent', { state: 'absent' }, 'This server has no Overlord', 'calm'],
    ['none', { state: 'answered', value: null, at: AT }, 'No Overlord', 'calm'],
    ['bound', { state: 'answered', value: BOUND, at: AT }, 'Bound to lane-a-overlord, Opus', 'calm'],
    ['unmeasured', { state: 'unmeasured', error: 'HTTP 503' }, 'unmeasured', 'amber'],
    ['loading', { state: 'loading' }, null, null],
  ])('%s', (_name, read, text, tone) => {
    const s = overlordStatusOf(read);
    expect(s === null ? null : s.text).toBe(text);
    expect(s === null ? null : s.tone).toBe(tone);
  });

  it('a pending row says it is starting, and a row with no binding names its class', () => {
    const pending = row({ model: 'fable', pending: { sessionId: 'lane-b-overlord', kind: 'designate', deadlineAt: AT, since: AT, actor: 'operator', generation: null } });
    expect(overlordStatusOf({ state: 'answered', value: pending, at: AT })?.text).toBe('Starting lane-b-overlord, Fable');
    expect(overlordStatusOf({ state: 'answered', value: row(), at: AT })?.text).toBe('No Overlord, Opus');
  });
});

describe('Retire', () => {
  it('is offered while something is bound or starting, or while the row still owes a stop (F1), and not otherwise', () => {
    expect(retireOffered(BOUND)).toBe(true);
    expect(retireOffered(row({ pending: { sessionId: 'lane-a-overlord', kind: 'designate', deadlineAt: AT, since: AT, actor: 'operator', generation: null } }))).toBe(true);
    expect(retireOffered(row({ stopsOwed: ['lane-b-overlord'] }))).toBe(true);
    expect(retireOffered(row())).toBe(false);
  });

  it('draws what it stopped and what it still owes', () => {
    const a = retireAnswerOf({ ok: true, changed: true, term: 3, stopped: ['lane-a-overlord'], owed: ['lane-b-overlord'] });
    expect(retireWords(a)).toEqual([
      'The Overlord was retired (term 3).', 'Stopped: lane-a-overlord.',
      'Still owed a stop: lane-b-overlord. Retire again to try the stop again.',
    ]);
  });

  it('an unchanged answer says nothing was retired, and an unreadable one says so', () => {
    expect(retireWords(retireAnswerOf({ ok: true, changed: false }))).toEqual(['Nothing was bound, so nothing was retired.']);
    expect(retireAnswerOf({ ok: true })).toBeNull();
    expect(retireAnswerOf({ ok: true, changed: true, stopped: 'lane-a' })).toBeNull();
    expect(retireWords(null)[0]).toMatch(/could not be read/);
  });
});

describe('the model and account set answers', () => {
  it('a model change says the next renewal and its warnings', () => {
    expect(modelAnswerWords({ ok: true, changed: true, model: 'fable', warnings: [{ warning: 'overlord-single-account', count: 1 }], written: [] }))
      .toEqual([`Set to Fable. ${W.modelLater}`, 'Only 1 account can serve it: the Overlord needs at least two.']);
    expect(modelAnswerWords({ ok: true, changed: false, model: 'opus' })).toEqual(['It is already Opus: nothing changed.']);
  });

  it('a session the door could not rewrite is named', () => {
    expect(modelAnswerWords({ ok: true, changed: true, model: 'opus', warnings: [], written: [{ sessionId: 'lane-a-overlord', ok: false, detail: 'x' }] }))
      .toContain('Saved, but not yet written to lane-a-overlord: the next renewal writes it.');
  });

  it('the account set answer draws the list, the count and every warning, an unknown one raw', () => {
    const said = accountSetAnswerWords({
      ok: true, changed: true, accountPools: { pools: ['pool-a'], untagged: false },
      accounts: { list: ['lane-a', 'lane-b'], counted: ['lane-a'], unmeasured: [] },
      warnings: [{ warning: 'unknown-pool', pool: 'pool-c' }, { warning: 'overlord-single-account', count: 1 }, { warning: 'a-newer-warning' }],
    });
    expect(said[0]).toBe('The account set was saved.');
    expect(said[1]).toBe('It lists lane-a, lane-b; 1 can serve it.');
    expect(said.slice(2)).toHaveLength(3);
    expect(said[3]).toBe('Only 1 account can serve it: the Overlord needs at least two.');
    expect(said[4]).toContain('a-newer-warning');
  });

  it('a missing list is said, never drawn as an empty one', () => {
    expect(accountSetAnswerWords({ ok: true, changed: false })).toContain('Which accounts it lists was not in the answer.');
    expect(settingsWarningText({ warning: 'overlord-single-account' })).toMatch(/Fewer than two/);
  });
});

describe('the account set boxes keep the saved order and the same pool options as Start', () => {
  const saved = { pools: ['pool-b', 'pool-gone'], untagged: true };
  const options = ['pool-a', 'pool-b'];

  it('saved pools first as saved, then the roster pools not in it, then untagged', () => {
    expect(setBoxesOf(saved, options).map((b) => [b.key, b.rostered])).toEqual([
      ['pool-b', true], ['pool-gone', false], ['pool-a', true], ['(untagged)', true],
    ]);
  });

  it('before the roster is heard, a saved pool is unread (null), never "no account carries it" (F6)', () => {
    expect(setBoxesOf(saved, [], false).map((b) => [b.key, b.rostered])).toEqual([
      ['pool-b', null], ['pool-gone', null], ['(untagged)', true],
    ]);
  });

  it('an untouched set is the saved set, in its order', () => {
    expect(editedSetOf(saved, options, new Map())).toEqual(saved);
    expect(sameSet(editedSetOf(saved, options, new Map()), saved)).toBe(true);
  });

  it('a pool switched on joins after the saved ones; switched off leaves; untagged follows its pick', () => {
    const picks = new Map([['pool-a', true], ['pool-gone', false], ['(untagged)', false]]);
    expect(editedSetOf(saved, options, picks)).toEqual({ pools: ['pool-b', 'pool-a'], untagged: false });
  });

  it('a reorder is a different set', () => {
    expect(sameSet({ pools: ['pool-a', 'pool-b'], untagged: false }, { pools: ['pool-b', 'pool-a'], untagged: false })).toBe(false);
  });
});

describe('the backstop', () => {
  it('draws the read\'s own hour and zone, and "the default" only when the read says so', () => {
    const v = backstopOf({ ok: true, hour: 4, zone: 'UTC', isDefault: true, setAt: null })!;
    expect(backstopWords(v)).toBe('Daily at 04:00, UTC (the default).');
    expect(backstopWords(backstopOf({ ok: true, hour: 23, zone: 'Europe/Berlin', isDefault: false, setAt: AT })!)).toBe('Daily at 23:00, Europe/Berlin.');
  });

  it('an answer without its fields is unreadable, never a default', () => {
    expect(backstopOf({ ok: true, hour: 4 })).toBeNull();
    expect(backstopOf(null)).toBeNull();
  });

  it('offers the browser\'s zones with the saved one kept, or a free field without a list', () => {
    expect(zoneChoicesOf(['UTC', 'Europe/Berlin'], 'Asia/Tokyo')).toEqual(['Asia/Tokyo', 'UTC', 'Europe/Berlin']);
    expect(zoneChoicesOf(['UTC'], 'UTC')).toEqual(['UTC']);
    expect(zoneChoicesOf(null, 'UTC')).toBeNull();
    expect(zoneChoicesOf([], 'UTC')).toBeNull();
  });
});

describe('the retention', () => {
  it('the bounds come from the read', () => {
    const v = retentionOf({ ok: true, days: 30, min: 7, max: 9, default: 30 })!;
    expect(retentionChoicesOf(v)).toEqual([7, 8, 9]);
    expect(retentionWords(v)).toContain('from 7 to 9 days');
  });

  it('an unreadable stored value is said, never a default', () => {
    const v = retentionOf({ ok: true, days: null, unreadable: true, min: 7, max: 90, default: 30 })!;
    expect(v.days).toBeNull();
    expect(retentionWords(v)).toContain(W.retentionStoredUnread);
    expect(retentionOf({ ok: true, days: null, min: 7, max: 90, default: 30 })).toBeNull();
  });
});

describe('the account facts', () => {
  it('an absent billing fact reads "not set", never credits', () => {
    // The plan's hand mutant: read an absent `fableBilling` as `credits`.
    expect(billingWordOf({})).toBe(NOT_SET);
    expect(billingWordOf({ fableBilling: 'credits' })).toBe('Fable bills credits');
    expect(billingWordOf({ fableBilling: 'included' })).toBe('Fable is included');
    expect(billingWordOf({ fableBilling: 'a-newer-word' })).toBe('a-newer-word');
  });

  it('an absent continuity record reads "not set"; a recorded one carries its date', () => {
    const dateOf = (ms: number): string => `day ${ms}`;
    expect(continuityWordOf({}, dateOf)).toBe(NOT_SET);
    expect(continuityWordOf({ continuity: { recordedAt: 10 } }, dateOf)).toBe('Continuity recorded day 10000');
    expect(continuityWordOf({ continuity: {} }, dateOf)).toMatch(/could not be read/);
  });
});

describe('the account holds', () => {
  it('reads the standing holds, and a row it cannot read makes the answer unreadable', () => {
    expect(holdsOf({ ok: true, holds: [{ lane: 'lane-a', cause: 'launch-profile-unmet', startId: 1, heldAt: AT }] }))
      .toEqual([{ lane: 'lane-a', cause: 'launch-profile-unmet', heldAt: AT }]);
    expect(holdsOf({ ok: true, holds: [] })).toEqual([]);
    expect(holdsOf({ ok: true, holds: [{ lane: 'lane-a' }] })).toBeNull();
    expect(holdsOf({ ok: true })).toBeNull();
  });

  it('words a hold, an unknown cause raw', () => {
    expect(holdLineOf({ cause: 'launch-profile-unmet' })).toBe('Held: launch profile unmet');
    expect(holdLineOf({ cause: 'a-newer-cause' })).toBe('Held: a-newer-cause');
  });

  it('a hold item names its lane only while open, in the Overlord programme, by its own title grammar', () => {
    const title = `${READINESS_ITEM_TEXT.hold.title}: lane-a`;
    expect(holdLaneOfItem({ program: 'overlord', title, state: 'open' })).toBe('lane-a');
    expect(holdLaneOfItem({ program: 'overlord', title, state: 'checking' })).toBe('lane-a');
    expect(holdLaneOfItem({ program: 'overlord', title, state: 'done' })).toBeNull();
    expect(holdLaneOfItem({ program: 'prog-a', title, state: 'open' })).toBeNull();
    expect(holdLaneOfItem({ program: 'overlord', title: READINESS_ITEM_TEXT.count.title, state: 'open' })).toBeNull();
    expect(holdLaneOfItem({ program: 'overlord', title: `${READINESS_ITEM_TEXT.hold.title}: not a lane!`, state: 'open' })).toBeNull();
  });
});

describe("Settings' refusals", () => {
  it('a designation door\'s not-found reads "no row" only after the store answered', () => {
    for (const act of ['retire', 'model', 'account-set'] as const) {
      expect(overlordSettingsRefusalText(refused(404, 'not-found'), act, true)).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT['no-row']);
      expect(overlordSettingsRefusalText(refused(404, 'not-found'), act, false)).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT['no-door']);
    }
  });

  it('the designation doors read the place\'s table for every other word', () => {
    expect(overlordSettingsRefusalText(refused(409, 'overlord-single-account', { count: 1 }), 'account-set', true))
      .toBe(`${OVERLORD_PLACE_REFUSAL_TEXT['overlord-single-account']} It counts 1.`);
    expect(overlordSettingsRefusalText(refused(501, 'auth-off'), 'retire', true)).toBe('Sign-in must be on to retire the Overlord.');
  });

  it('the backstop draws the server\'s detail on bad-request, and a Clear\'s not-found says the hold is gone', () => {
    expect(overlordSettingsRefusalText(refused(400, 'bad-request', { detail: 'hour must be a whole number from 0 to 23' }), 'backstop', true))
      .toBe(`${OVERLORD_SETTINGS_REFUSAL_TEXT['bad-request']} (hour must be a whole number from 0 to 23)`);
    expect(overlordSettingsRefusalText(refused(404, 'not-found'), 'hold-clear', false)).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT['no-hold']);
    expect(overlordSettingsRefusalText(refused(409, 'a-newer-word'), 'backstop', true)).toBe('Refused: a-newer-word');
    expect(overlordSettingsRefusalText(refused(501, 'auth-off'), 'backstop', true)).toBe('Refused: auth-off');
  });

  it('an older fleet node and an unmeasured outcome each have their sentence; any other lane word is the lane acts\'', () => {
    expect(accountFactRefusalText(refused(409, 'lane-act-refused', { verbCode: 'unknown-argument' }), 'lane-a')).toBe(ACCOUNT_FACT_REFUSAL_TEXT.older);
    expect(accountFactRefusalText(refused(504, 'outcome-unknown'), 'lane-a')).toBe(ACCOUNT_FACT_REFUSAL_TEXT.unknown);
    expect(accountFactRefusalText(refused(409, 'lane-act-refused', { verbCode: 'bad-value' }), 'lane-a')).toBe('The fleet host refused (bad-value): lane-a was not changed.');
  });
});
