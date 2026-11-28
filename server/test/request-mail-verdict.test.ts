import { describe, expect, it } from 'vitest';
import {
  OVERLORD_TAKES_ONLY_ITS_OWNERS, mailDesignationOf, programmeRequestVerdict, requestMailVerdict, requestNotYoursDetail,
  requestOwnerReadOf, type MailDesignation, type RequestMailVerdict, type RequestOwnerRead,
} from '../src/coord/requestMail.js';
import { reportMailVerdict } from '../src/coord/peerBound.js';
import { OPEN_REQUEST_STATES, REPORTS_TO_OVERLORD_HOURLY, TERMINAL_REQUEST_STATES } from '../../shared/overlordRequests.js';
import { PEER_MAIL_WINDOW_MS } from '../../shared/api.js';

const ABSENT: RequestOwnerRead = { kind: 'absent' };
const UNOWNED: RequestOwnerRead = { kind: 'unowned' };
const OPEN: RequestOwnerRead = { kind: 'owned', owner: 'prog-a', open: true };
const CLOSED: RequestOwnerRead = { kind: 'owned', owner: 'prog-a', open: false };

interface Counts { request: number; senderOwns: number; designation: number; lastRequest: unknown; lastOwns: unknown; lastDesignation: unknown }
function run(o: {
  toOverlord: boolean; requestId: number | null; request?: RequestOwnerRead | 'unmeasured';
  senderOwns?: boolean | 'unmeasured'; designation?: MailDesignation;
}): { v: RequestMailVerdict; c: Counts } {
  const c: Counts = { request: 0, senderOwns: 0, designation: 0, lastRequest: undefined, lastOwns: undefined, lastDesignation: undefined };
  const v = requestMailVerdict({
    toOverlord: o.toOverlord, requestId: o.requestId,
    request: () => { c.request++; return (c.lastRequest = o.request ?? ABSENT) as RequestOwnerRead | 'unmeasured'; },
    senderOwns: () => { c.senderOwns++; return (c.lastOwns = o.senderOwns ?? true) as boolean | 'unmeasured'; },
    designation: () => { c.designation++; return (c.lastDesignation = o.designation ?? { kind: 'bound', sessionId: 's1' }) as MailDesignation; },
  });
  return { v, c };
}

describe('requestOwnerReadOf', () => {
  it('reads absent, unowned, owned open, owned closed, and an unknown word as open', () => {
    expect(requestOwnerReadOf('absent')).toEqual({ kind: 'absent' });
    expect(requestOwnerReadOf({ owner: null, state: OPEN_REQUEST_STATES[0]! })).toEqual({ kind: 'unowned' });
    expect(requestOwnerReadOf({ owner: 'p', state: OPEN_REQUEST_STATES[0]! })).toEqual({ kind: 'owned', owner: 'p', open: true });
    expect(requestOwnerReadOf({ owner: 'p', state: TERMINAL_REQUEST_STATES[0]! })).toEqual({ kind: 'owned', owner: 'p', open: false });
    expect(requestOwnerReadOf({ owner: 'p', state: 'zzz' })).toEqual({ kind: 'owned', owner: 'p', open: true });
  });
});

describe('programmeRequestVerdict', () => {
  it('admits the owner, open or closed', () => {
    expect(programmeRequestVerdict(OPEN, 7, 'prog-a')).toEqual({ ok: true });
    expect(programmeRequestVerdict(CLOSED, 7, 'prog-a')).toEqual({ ok: true });
  });
  it('refuses every other read with one answer and no oracle', () => {
    const other = programmeRequestVerdict({ kind: 'owned', owner: 'secret-prog', open: true }, 7, 'prog-a');
    const unowned = programmeRequestVerdict(UNOWNED, 7, 'prog-a');
    const absent = programmeRequestVerdict(ABSENT, 7, 'prog-a');
    expect(other).toEqual({ ok: false, refuse: 'request-not-yours', detail: requestNotYoursDetail(7) });
    expect(unowned).toEqual(other);
    expect(absent).toEqual(other);
    const detail = (other as { detail: string }).detail;
    expect(detail).not.toContain('secret-prog');
    expect(detail).not.toContain('exist');
  });
});

describe('mailDesignationOf', () => {
  it('maps the four answers', () => {
    expect(mailDesignationOf({ kind: 'unmeasured', why: 'x' })).toEqual({ kind: 'unmeasured' });
    expect(mailDesignationOf({ kind: 'designated', sessionId: 's', term: 1, row: {} as never })).toEqual({ kind: 'bound', sessionId: 's' });
    expect(mailDesignationOf({ kind: 'not-designated', row: null })).toEqual({ kind: 'none' });
    expect(mailDesignationOf({ kind: 'not-designated', row: {} as never })).toEqual({ kind: 'unbound' });
  });
});

describe('requestMailVerdict rows', () => {
  const noReads = (c: Counts) => expect([c.request, c.senderOwns, c.designation]).toEqual([0, 0, 0]);
  const refuseOverlord = { ok: false, refuse: 'unknown-recipient', detail: OVERLORD_TAKES_ONLY_ITS_OWNERS };

  it('not to the Overlord, no request: today\'s mail, no reads', () => {
    const { v, c } = run({ toOverlord: false, requestId: null });
    expect(v).toEqual({ ok: true, deliverTo: null, stampNews: false, report: false, requestId: null });
    noReads(c);
  });
  it('to the Overlord, no request: unknown-recipient, no reads', () => {
    const { v, c } = run({ toOverlord: true, requestId: null });
    expect(v).toEqual(refuseOverlord);
    noReads(c);
  });
  it.each([true, false])('request unreadable (toOverlord %s): run-unreadable, designation unread', (toOverlord) => {
    const { v, c } = run({ toOverlord, requestId: 7, request: 'unmeasured' });
    expect(v).toMatchObject({ ok: false, reply: 'run-unreadable' });
    expect(c.designation).toBe(0);
    expect(c.senderOwns).toBe(0);
  });
  it.each([['absent', ABSENT], ['unowned', UNOWNED]] as const)('%s request', (_n, request) => {
    let r = run({ toOverlord: true, requestId: 7, request });
    expect(r.v).toEqual(refuseOverlord);
    expect([r.c.senderOwns, r.c.designation]).toEqual([0, 0]);
    r = run({ toOverlord: false, requestId: 7, request });
    expect(r.v).toEqual({ ok: false, refuse: 'request-not-yours', detail: requestNotYoursDetail(7) });
    expect([r.c.senderOwns, r.c.designation]).toEqual([0, 0]);
  });
  it('owner test unreadable: run-unreadable, designation unread', () => {
    const { v, c } = run({ toOverlord: true, requestId: 7, request: OPEN, senderOwns: 'unmeasured' });
    expect(v).toMatchObject({ ok: false, reply: 'run-unreadable' });
    expect(c.designation).toBe(0);
  });
  it('sender does not own: as absent, designation unread', () => {
    let r = run({ toOverlord: true, requestId: 7, request: OPEN, senderOwns: false });
    expect(r.v).toEqual(refuseOverlord);
    expect(r.c.designation).toBe(0);
    r = run({ toOverlord: false, requestId: 7, request: OPEN, senderOwns: false });
    expect(r.v).toEqual({ ok: false, refuse: 'request-not-yours', detail: requestNotYoursDetail(7) });
    expect(r.c.designation).toBe(0);
  });
  it('owner, not to the Overlord: admitted, news stamped while open', () => {
    let r = run({ toOverlord: false, requestId: 7, request: OPEN });
    expect(r.v).toEqual({ ok: true, deliverTo: null, stampNews: true, report: false, requestId: 7 });
    expect(r.c.designation).toBe(0);
    r = run({ toOverlord: false, requestId: 7, request: CLOSED });
    expect(r.v).toEqual({ ok: true, deliverTo: null, stampNews: false, report: false, requestId: 7 });
    expect(r.c.designation).toBe(0);
  });
  it('owner, to the Overlord, closed: refused, designation unread', () => {
    const { v, c } = run({ toOverlord: true, requestId: 7, request: CLOSED });
    expect(v).toEqual({ ok: false, refuse: 'unknown-recipient', detail: 'request 7 is closed' });
    expect(c.designation).toBe(0);
  });
  it('owner, to the Overlord, open: by designation', () => {
    const base = { toOverlord: true, requestId: 7, request: OPEN } as const;
    expect(run({ ...base, designation: { kind: 'unmeasured' } }).v).toMatchObject({ ok: false, reply: 'unmeasured' });
    expect(run({ ...base, designation: { kind: 'none' } }).v)
      .toEqual({ ok: false, refuse: 'unknown-recipient', detail: 'no Overlord is designated' });
    expect(run({ ...base, designation: { kind: 'unbound' } }).v)
      .toEqual({ ok: true, deliverTo: null, report: true, stampNews: true, requestId: 7 });
    expect(run({ ...base, designation: { kind: 'bound', sessionId: 's1' } }).v)
      .toEqual({ ok: true, deliverTo: 's1', report: true, stampNews: true, requestId: 7 });
  });
});

describe('requestMailVerdict: no oracle', () => {
  const j = (o: Parameters<typeof run>[0]) => JSON.stringify(run(o).v);
  it('to the Overlord, four callers read the same bytes', () => {
    const base = j({ toOverlord: true, requestId: null });
    expect(j({ toOverlord: true, requestId: 7, request: ABSENT })).toBe(base);
    expect(j({ toOverlord: true, requestId: 7, request: UNOWNED })).toBe(base);
    expect(j({ toOverlord: true, requestId: 7, request: { kind: 'owned', owner: 'other', open: true }, senderOwns: false })).toBe(base);
  });
  it('not to the Overlord, three callers read the same bytes', () => {
    const base = j({ toOverlord: false, requestId: 7, request: ABSENT });
    expect(j({ toOverlord: false, requestId: 7, request: UNOWNED })).toBe(base);
    expect(j({ toOverlord: false, requestId: 7, request: OPEN, senderOwns: false })).toBe(base);
  });
});

describe('requestMailVerdict: monotonicity over a grid', () => {
  const requests = ['unmeasured', ABSENT, UNOWNED, OPEN, CLOSED] as const;
  const owns = [true, false, 'unmeasured'] as const;
  const designations: MailDesignation[] = [{ kind: 'unmeasured' }, { kind: 'none' }, { kind: 'unbound' }, { kind: 'bound', sessionId: 's1' }];
  for (const toOverlord of [true, false]) for (const requestId of [null, 7]) for (const request of requests)
    for (const senderOwns of owns) for (const designation of designations) {
      it(`toOverlord=${toOverlord} id=${requestId} req=${JSON.stringify(request)} owns=${senderOwns} des=${designation.kind}`, () => {
        const { v, c } = run({ toOverlord, requestId, request, senderOwns, designation });
        const readUnmeasured = (c.request > 0 && c.lastRequest === 'unmeasured') || (c.senderOwns > 0 && c.lastOwns === 'unmeasured')
          || (c.designation > 0 && (c.lastDesignation as MailDesignation).kind === 'unmeasured');
        if (readUnmeasured) {
          expect(v.ok).toBe(false);
          expect('reply' in v).toBe(true);
        }
        if ('reply' in v) expect(['run-unreadable', 'unmeasured']).toContain(v.reply);
        if (v.ok && v.report) {
          expect(toOverlord).toBe(true);
          expect(requestId).not.toBeNull();
          expect(request).toEqual(OPEN);
          expect(senderOwns).toBe(true);
          expect(['bound', 'unbound']).toContain(designation.kind);
        }
      });
    }
});

describe('reportMailVerdict', () => {
  const start = 1_000_000;
  const ats = (n: number) => Array.from({ length: n }, (_, i) => start + i * 1000);
  it('59 in the hour is bounded', () => {
    expect(reportMailVerdict({ fromId: 'a', hourAts: ats(59), now: start + 100_000 })).toEqual({ verdict: 'bounded' });
  });
  it('exactly the quota: peer-quota at the oldest plus the window', () => {
    const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
    const v = reportMailVerdict({ fromId: 'sender-x', hourAts, now: start + 100_000 });
    expect(v).toMatchObject({ verdict: 'peer-quota', retry: { on: 'time', at: hourAts[0]! + PEER_MAIL_WINDOW_MS } });
    const detail = (v as { detail: string }).detail;
    expect(detail).toContain('sender-x');
    expect(detail).toContain(String(REPORTS_TO_OVERLORD_HOURLY));
  });
  it('one over: the second oldest sets the time', () => {
    const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY + 1);
    const v = reportMailVerdict({ fromId: 'a', hourAts, now: start + 100_000 });
    expect(v).toMatchObject({ verdict: 'peer-quota', retry: { on: 'time', at: hourAts[1]! + PEER_MAIL_WINDOW_MS } });
  });
  it('inS is never negative', () => {
    const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
    const v = reportMailVerdict({ fromId: 'a', hourAts, now: hourAts[0]! + PEER_MAIL_WINDOW_MS + 500_000 });
    expect((v as { detail: string }).detail).toContain('(in 0 s)');
    expect((v as { detail: string }).detail).not.toMatch(/in -\d/);
  });
});
