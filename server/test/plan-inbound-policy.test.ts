// Review 2457 F2, F4 (D-8733, D-8735): the pure deciders of the inbound re-read and the take door's choice. L1, no I/O.
import { describe, expect, it } from 'vitest';
import {
  INBOUND_RECHECK_MAX_PER_PASS, INBOUND_RECHECK_MS, inboundDoorVerdict, inboundRecheckDue, inboundRecheckOf, inboundRecheckStops, inboundReopenedMail, inboundRetireVerdict, upkeepLookupOf,
  closeRefusedCommentBody, closeTextRefusedMail,
} from '../src/linear/inboundPolicy.js';
import { handedRowOf } from '../src/coord/planPolicy.js';
import { RETIRE_WHYS, inboundRetirable, retireWhyOf } from '../src/linear/inboundRetire.js';

const AAA: ReadonlySet<string> = new Set(['AAA']);
const row = (linearId: string, state = 'mailed', actedAt: number | null = null) => ({ linearId, state: state as never, actedAt });

describe('retireWhyOf and inboundRetirable', () => {
  it('the causes are the four words, and an unknown word reads as null', () => {
    expect([...RETIRE_WHYS]).toEqual(['completed', 'canceled', 'ccrc-own', 'moved-out']);
    expect(RETIRE_WHYS.map(retireWhyOf)).toEqual([...RETIRE_WHYS]);
    expect([retireWhyOf('x'), retireWhyOf(null), retireWhyOf(undefined), retireWhyOf(3)]).toEqual([null, null, null, null]);
  });
  it('a row is retirable in waiting, mailed, handed, raised and an unacted close; never taken, placed, an acted close or retired', () => {
    expect(['waiting', 'mailed', 'handed', 'raised', 'closed'].map((state) => inboundRetirable({ state: state as never, actedAt: null }))).toEqual([true, true, true, true, true]);
    expect(inboundRetirable({ state: 'closed', actedAt: 5 })).toBe(false);
    expect(['taken', 'placed', 'retired'].map((state) => inboundRetirable({ state: state as never, actedAt: null }))).toEqual([false, false, false]);
  });
  it('inboundRetireVerdict still keeps a row that may not be retired', () => {
    expect(inboundRetireVerdict({ state: 'taken', actedAt: null }, { stateType: 'completed', own: false, inbound: false })).toEqual({ kind: 'keep' });
    expect(inboundRetireVerdict({ state: 'mailed', actedAt: null }, { stateType: 'canceled', own: false, inbound: false })).toEqual({ kind: 'retire', why: 'canceled' });
  });
});

describe('handedRowOf (review 2457 F2)', () => {
  const a = { workspaceId: 'ws-a' }; const b = { workspaceId: 'ws-b' };
  it('the only row, whatever the home; two rows by the home\'s workspace; none when the home does not decide', () => {
    expect(handedRowOf([b], null)).toBe(b);
    expect(handedRowOf([b], 'ws-a')).toBe(b);
    expect(handedRowOf([b, a], 'ws-a')).toBe(a);
    expect(handedRowOf([b, a], 'ws-b')).toBe(b);
    expect(handedRowOf([b, a], null)).toBeNull();
    expect(handedRowOf([b, a], 'ws-c')).toBeNull();
    expect(handedRowOf([], 'ws-a')).toBeNull();
  });
});

describe('inboundRecheckOf (D-8733)', () => {
  it('an issue in a team that is not managed is moved-out, before its state is read', () => {
    expect(inboundRecheckOf({ teamKey: 'ZZZ', stateType: 'unstarted' }, AAA)).toEqual({ kind: 'retire', why: 'moved-out' });
    expect(inboundRecheckOf({ teamKey: 'ZZZ', stateType: 'completed' }, AAA)).toEqual({ kind: 'retire', why: 'moved-out' });
  });
  it('an issue Linear no longer shows is moved-out', () => expect(inboundRecheckOf(null, AAA)).toEqual({ kind: 'retire', why: 'moved-out' }));
  it('a managed team judges by the state: completed and canceled retire by it, anything else is managed; keys compare upper-case', () => {
    expect(inboundRecheckOf({ teamKey: 'aaa', stateType: 'unstarted' }, AAA)).toEqual({ kind: 'managed' });
    expect(inboundRecheckOf({ teamKey: 'AAA', stateType: 'started' }, AAA)).toEqual({ kind: 'managed' });
    expect(inboundRecheckOf({ teamKey: 'AAA', stateType: 'completed' }, AAA)).toEqual({ kind: 'retire', why: 'completed' });
    expect(inboundRecheckOf({ teamKey: 'AAA', stateType: 'canceled' }, AAA)).toEqual({ kind: 'retire', why: 'canceled' });
  });
  it('an answer without its team or state, and a workspace with no managed team, are not measured: nothing is retired', () => {
    expect(inboundRecheckOf({}, AAA)).toMatchObject({ kind: 'unmeasured' });
    expect(inboundRecheckOf({ teamKey: 'AAA' }, AAA)).toMatchObject({ kind: 'unmeasured' });
    expect(inboundRecheckOf({ teamKey: 'ZZZ', stateType: 'started' }, new Set())).toMatchObject({ kind: 'unmeasured' });
    expect(inboundRecheckOf(null, new Set())).toMatchObject({ kind: 'unmeasured' });
  });
});

describe('inboundRecheckDue', () => {
  const now = 10 * INBOUND_RECHECK_MS;
  it('the interval is six hours, and a row is due a whole interval after its last read, never sooner', () => {
    expect(INBOUND_RECHECK_MS).toBe(6 * 3_600_000);
    const rows = [row('a')];
    expect(inboundRecheckDue(rows, new Set(), new Map([['a', now - INBOUND_RECHECK_MS + 1]]), now)).toEqual([]);
    expect(inboundRecheckDue(rows, new Set(), new Map([['a', now - INBOUND_RECHECK_MS]]), now)).toEqual(rows);
  });
  it('a row never read is due; a row the pass\'s changed read returned is not; only retirable rows are asked', () => {
    const rows = [row('a'), row('b'), row('c', 'taken'), row('d', 'closed', 3), row('e', 'raised')];
    expect(inboundRecheckDue(rows, new Set(['b']), new Map(), now).map((r) => r.linearId)).toEqual(['a', 'e']);
  });
  it('the longest unchecked go first and a pass takes at most the cap', () => {
    const rows = Array.from({ length: INBOUND_RECHECK_MAX_PER_PASS + 5 }, (_, i) => row(`r${i}`));
    const checked = new Map(rows.map((r, i) => [r.linearId, i + 1] as const));
    rows.reverse();
    const due = inboundRecheckDue(rows, new Set(), checked, now);
    expect(due).toHaveLength(INBOUND_RECHECK_MAX_PER_PASS);
    expect(due[0]!.linearId).toBe('r0');
    expect(inboundRecheckDue(rows, new Set(), checked, now, 2).map((r) => r.linearId)).toEqual(['r0', 'r1']);
  });
});

describe('inboundDoorVerdict', () => {
  it('managed goes on; a retire answer retires and refuses issue-not-inbound, binding or not', () => {
    for (const binds of [true, false]) {
      expect(inboundDoorVerdict({ kind: 'managed' }, binds)).toEqual({ kind: 'go' });
      expect(inboundDoorVerdict({ kind: 'retire', why: 'moved-out' }, binds)).toEqual({ kind: 'retire', why: 'moved-out', word: 'issue-not-inbound' });
      expect(inboundDoorVerdict({ kind: 'retire', why: 'completed' }, binds)).toEqual({ kind: 'retire', why: 'completed', word: 'issue-not-inbound' });
    }
  });
  it('a read that cannot be made (or was not asked) refuses unreachable for a decision that binds, and goes on for one that does not', () => {
    for (const a of [undefined, { kind: 'unmeasured', word: 'unreachable' } as const, { kind: 'unmeasured', word: null } as const]) {
      expect(inboundDoorVerdict(a, true)).toEqual({ kind: 'refuse', word: 'unreachable' });
      expect(inboundDoorVerdict(a, false)).toEqual({ kind: 'go' });
    }
  });
});

describe('inboundRecheckStops (review 2524 F2)', () => {
  it('only a workspace-wide answer stops the walk: the key, a transport or rate failure, a policy or journal outage, no key, no word', () => {
    for (const w of ['linear-unauthorised', 'unreachable', 'timeout', 'rate-limited', 'policy-unavailable', 'journal-unavailable', 'not-configured', null]) {
      expect(inboundRecheckStops(w), String(w)).toBe(true);
    }
  });
  it('an answer about one row does not: malformed, linear-forbidden, linear-invalid', () => {
    for (const w of ['malformed', 'linear-forbidden', 'linear-invalid']) expect(inboundRecheckStops(w), w).toBe(false);
  });
  it('not-found is not a walk word (review 2571 F9): the by-id read retires it moved-out, and asked anyway it stops, the safe side', () => {
    expect(inboundRecheckStops('not-found')).toBe(true);
  });
  it('a word nobody classified stops the walk (the safe side)', () => expect(inboundRecheckStops('some-new-word')).toBe(true));
});

describe('inboundReopenedMail names the retire cause (review 2524 A4)', () => {
  const r = { identifier: 'AAA-12', teamKey: 'AAA', title: 'T', body: null };
  const sentence = (why: Parameters<typeof inboundReopenedMail>[2]): string => inboundReopenedMail(r, '2026-01-01T00:00:00.000Z', why).body.split('\n\n')[0]!;
  it('one sentence per cause, and a fallback for none', () => {
    expect(sentence('completed')).toBe('The issue AAA-12 was completed and is open again in Linear, so it waits for your triage once more.');
    expect(sentence('canceled')).toBe('The issue AAA-12 was canceled and is open again in Linear, so it waits for your triage once more.');
    expect(sentence('moved-out')).toBe('The issue AAA-12 left the managed Linear teams and is back in one, so it waits for your triage once more.');
    expect(sentence('ccrc-own')).toBe('The issue AAA-12 was ccrc\'s own issue and now reads as inbound in Linear, so it waits for your triage once more.');
    expect(sentence(null)).toBe('The issue AAA-12 was retired earlier and is open again in Linear, so it waits for your triage once more.');
  });
});

describe('upkeepLookupOf (review 2571 F10)', () => {
  it('a measured home workspace is the only place the lookup is made', () => {
    expect(upkeepLookupOf({ home: 'project-a', homeTeamKey: 'AAA', homeWorkspace: 'ws-a' })).toEqual({ kind: 'lookup', workspace: 'ws-a' });
  });
  it('no home, or a home with no team key, is issue-not-inbound', () => {
    expect(upkeepLookupOf({ home: null, homeTeamKey: null, homeWorkspace: null })).toMatchObject({ kind: 'refuse', word: 'issue-not-inbound' });
    expect(upkeepLookupOf({ home: 'project-x', homeTeamKey: null, homeWorkspace: null })).toMatchObject({ kind: 'refuse', word: 'issue-not-inbound' });
  });
  it('a home with a team key whose workspace could not be resolved is unreachable', () => {
    expect(upkeepLookupOf({ home: 'project-a', homeTeamKey: 'AAA', homeWorkspace: null })).toMatchObject({ kind: 'refuse', word: 'unreachable' });
  });
  it('its detail names both causes: a failed read a retry helps, and a team no slot routes, which it does not (review 2834 A4)', () => {
    const v = upkeepLookupOf({ home: 'project-a', homeTeamKey: 'AAA', homeWorkspace: null });
    expect(v.kind === 'refuse' ? v.detail : '').toMatch(/could not be read \(a retry helps\).*no slot routes.*retry does not help/);
  });
});

describe('the close builders for a reason that failed the public-text check (final review minor 4)', () => {
  const sample = { identifier: 'AAA-12', teamKey: 'AAA', title: 'distinctive-title-zq', body: 'distinctive-body-zq' };
  it('the comment carries no reason text and carries ccrc\'s provenance', () => {
    const body = closeRefusedCommentBody();
    expect(body).toContain('Closed by ccrc');
    expect(body).toMatch(/ccrc/i);
    expect(body).not.toContain('Closed: ');
  });
  it('the mail names the identifier, team key and class, and echoes neither title nor body', () => {
    const m = closeTextRefusedMail(sample, 'some-class', 'abc-1');
    expect(m.subject).toContain('AAA-12');
    expect(m.body).toContain('AAA-12');
    expect(m.body).toContain('team AAA');
    expect(m.body).toContain('some-class');
    expect(m.body).not.toContain('You closed');
    for (const text of [m.subject, m.body]) { expect(text).not.toContain('distinctive-title-zq'); expect(text).not.toContain('distinctive-body-zq'); }
  });
});
