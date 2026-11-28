// The request ids' deciders' cases and mutant sets (Overlord W2, request ids A). The cases are written once, here, as functions of
// the loaded module: `request-mail-verdict.test.ts` runs them against the real modules and `mutation-floors.test.ts` runs each
// set against its textual mutants (D-8217's every-run floors). Every mutant must be killed; the one mutant left out on purpose is
// named at its set.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import type { MailDesignation, RequestMailVerdict, RequestOwnerRead } from '../../src/coord/requestMail.js';
import { OPEN_REQUEST_STATES, REPORTS_TO_OVERLORD_HOURLY, TERMINAL_REQUEST_STATES } from '../../../shared/overlordRequests.js';
import { PEER_MAIL_WINDOW_MS } from '../../../shared/api.js';

export type RequestMailModule = typeof import('../../src/coord/requestMail.js');
export type PeerBoundModule = typeof import('../../src/coord/peerBound.js');
type Cases = Record<string, SuiteCase>;

const ABSENT: RequestOwnerRead = { kind: 'absent' };
const UNOWNED: RequestOwnerRead = { kind: 'unowned' };
const OPEN: RequestOwnerRead = { kind: 'owned', owner: 'prog-a', open: true };
const CLOSED: RequestOwnerRead = { kind: 'owned', owner: 'prog-a', open: false };
const ONE_DETAIL = "the Overlord's role takes no mail in W1";

export function requestOwnerReadCases(m: RequestMailModule): Cases {
  const read = m.requestOwnerReadOf;
  return {
    'absent': () => { expect(read('absent')).toEqual({ kind: 'absent' }); },
    'unowned': () => { expect(read({ owner: null, state: OPEN_REQUEST_STATES[0]! })).toEqual({ kind: 'unowned' }); },
    'unowned, whatever the state': () => { expect(read({ owner: null, state: TERMINAL_REQUEST_STATES[0]! })).toEqual({ kind: 'unowned' }); },
    'owned, every open state is open': () => {
      for (const state of OPEN_REQUEST_STATES) expect(read({ owner: 'p', state })).toEqual({ kind: 'owned', owner: 'p', open: true });
    },
    'owned, every terminal state is closed': () => {
      for (const state of TERMINAL_REQUEST_STATES) expect(read({ owner: 'p', state })).toEqual({ kind: 'owned', owner: 'p', open: false });
    },
    'owned, an unknown word is open': () => {
      expect(read({ owner: 'p', state: 'zzz' })).toEqual({ kind: 'owned', owner: 'p', open: true });
    },
    'the owner is the row\'s own': () => { expect(read({ owner: 'prog-q', state: OPEN_REQUEST_STATES[0]! })).toMatchObject({ owner: 'prog-q' }); },
  };
}

export function programmeRequestCases(m: RequestMailModule): Cases {
  const v = m.programmeRequestVerdict;
  const refused = { ok: false, refuse: 'request-not-yours', detail: m.requestNotYoursDetail(7) };
  return {
    'the owner, open': () => { expect(v(OPEN, 7, 'prog-a')).toEqual({ ok: true }); },
    'the owner, closed': () => { expect(v(CLOSED, 7, 'prog-a')).toEqual({ ok: true }); },
    'another programme owns it': () => {
      const other = v({ kind: 'owned', owner: 'secret-prog', open: true }, 7, 'prog-a');
      expect(other).toEqual(refused);
      expect((other as { detail: string }).detail).not.toContain('secret-prog');
      expect((other as { detail: string }).detail).not.toContain('exist');
    },
    'unowned is the same answer': () => { expect(v(UNOWNED, 7, 'prog-a')).toEqual(refused); },
    'absent is the same answer': () => { expect(v(ABSENT, 7, 'prog-a')).toEqual(refused); },
    'the detail is the one text': () => { expect(m.requestNotYoursDetail(7)).toBe("request 7 is not this programme's"); },
    'the detail names the id given': () => { expect(v(ABSENT, 9, 'prog-a')).toEqual({ ok: false, refuse: 'request-not-yours', detail: m.requestNotYoursDetail(9) }); },
  };
}

export function mailDesignationCases(m: RequestMailModule): Cases {
  const d = m.mailDesignationOf;
  return {
    'unmeasured': () => { expect(d({ kind: 'unmeasured', why: 'x' })).toEqual({ kind: 'unmeasured' }); },
    'designated is bound to its session': () => { expect(d({ kind: 'designated', sessionId: 's', term: 1, row: {} as never })).toEqual({ kind: 'bound', sessionId: 's' }); },
    'designated names the other session too': () => { expect(d({ kind: 'designated', sessionId: 'other', term: 2, row: {} as never })).toEqual({ kind: 'bound', sessionId: 'other' }); },
    'not designated, no row: none': () => { expect(d({ kind: 'not-designated', row: null })).toEqual({ kind: 'none' }); },
    'not designated, a row: unbound': () => { expect(d({ kind: 'not-designated', row: {} as never })).toEqual({ kind: 'unbound' }); },
  };
}

interface Counts { request: number; senderOwns: number; designation: number; lastRequest: unknown; lastOwns: unknown; lastDesignation: unknown; ownerAsked: string[] }
interface RunOpts {
  toOverlord: boolean; requestId: number | null; request?: RequestOwnerRead | 'unmeasured';
  senderOwns?: boolean | 'unmeasured'; designation?: MailDesignation;
}
const runWith = (m: RequestMailModule, o: RunOpts): { v: RequestMailVerdict; c: Counts } => {
  const c: Counts = { request: 0, senderOwns: 0, designation: 0, lastRequest: undefined, lastOwns: undefined, lastDesignation: undefined, ownerAsked: [] };
  const v = m.requestMailVerdict({
    toOverlord: o.toOverlord, requestId: o.requestId,
    request: () => { c.request++; return (c.lastRequest = o.request ?? ABSENT) as RequestOwnerRead | 'unmeasured'; },
    senderOwns: (owner) => { c.senderOwns++; c.ownerAsked.push(owner); return (c.lastOwns = o.senderOwns ?? true) as boolean | 'unmeasured'; },
    designation: () => { c.designation++; return (c.lastDesignation = o.designation ?? { kind: 'bound', sessionId: 's1' }) as MailDesignation; },
  });
  return { v, c };
};

/** The mail door's doc-table rows, the no-oracle byte identity and the monotonicity grid. */
export function requestMailCases(m: RequestMailModule): Cases {
  const run = (o: RunOpts) => runWith(m, o);
  const noReads = (c: Counts) => expect([c.request, c.senderOwns, c.designation]).toEqual([0, 0, 0]);
  const refuseOverlord = { ok: false, refuse: 'unknown-recipient', detail: ONE_DETAIL };
  const notYours = { ok: false, refuse: 'request-not-yours', detail: m.requestNotYoursDetail(7) };
  const cases: Cases = {
    'the one detail is the text main sent': () => { expect(m.OVERLORD_TAKES_ONLY_ITS_OWNERS).toBe(ONE_DETAIL); },
    'not to the Overlord, no request: today\'s mail, no reads': () => {
      const { v, c } = run({ toOverlord: false, requestId: null });
      expect(v).toEqual({ ok: true, deliverTo: null, stampNews: false, report: false, requestId: null });
      noReads(c);
    },
    'to the Overlord, no request: unknown-recipient, no reads': () => {
      const { v, c } = run({ toOverlord: true, requestId: null });
      expect(v).toEqual(refuseOverlord);
      noReads(c);
    },
    'request unreadable, to the Overlord: run-unreadable, nothing else read': () => {
      const { v, c } = run({ toOverlord: true, requestId: 7, request: 'unmeasured' });
      expect(v).toEqual({ ok: false, reply: 'run-unreadable', detail: 'the request record could not be read' });
      expect([c.senderOwns, c.designation]).toEqual([0, 0]);
    },
    'request unreadable, not to the Overlord: run-unreadable, nothing else read': () => {
      const { v, c } = run({ toOverlord: false, requestId: 7, request: 'unmeasured' });
      expect(v).toEqual({ ok: false, reply: 'run-unreadable', detail: 'the request record could not be read' });
      expect([c.senderOwns, c.designation]).toEqual([0, 0]);
    },
    'absent request, to the Overlord': () => {
      const r = run({ toOverlord: true, requestId: 7, request: ABSENT });
      expect(r.v).toEqual(refuseOverlord);
      expect([r.c.senderOwns, r.c.designation]).toEqual([0, 0]);
    },
    'absent request, not to the Overlord': () => {
      const r = run({ toOverlord: false, requestId: 7, request: ABSENT });
      expect(r.v).toEqual(notYours);
      expect([r.c.senderOwns, r.c.designation]).toEqual([0, 0]);
    },
    'unowned request, to the Overlord': () => {
      const r = run({ toOverlord: true, requestId: 7, request: UNOWNED });
      expect(r.v).toEqual(refuseOverlord);
      expect([r.c.senderOwns, r.c.designation]).toEqual([0, 0]);
    },
    'unowned request, not to the Overlord': () => {
      const r = run({ toOverlord: false, requestId: 7, request: UNOWNED });
      expect(r.v).toEqual(notYours);
      expect([r.c.senderOwns, r.c.designation]).toEqual([0, 0]);
    },
    'owner test unreadable: run-unreadable, designation unread': () => {
      const { v, c } = run({ toOverlord: true, requestId: 7, request: OPEN, senderOwns: 'unmeasured' });
      expect(v).toEqual({ ok: false, reply: 'run-unreadable', detail: "the sender's programme could not be read" });
      expect(c.designation).toBe(0);
    },
    'owner test unreadable, not to the Overlord: run-unreadable': () => {
      const { v } = run({ toOverlord: false, requestId: 7, request: OPEN, senderOwns: 'unmeasured' });
      expect(v).toMatchObject({ ok: false, reply: 'run-unreadable' });
    },
    'the owner test is asked of the request\'s owner': () => {
      const { c } = run({ toOverlord: true, requestId: 7, request: OPEN });
      expect(c.ownerAsked).toEqual(['prog-a']);
    },
    'sender does not own, to the Overlord: as absent, designation unread': () => {
      const r = run({ toOverlord: true, requestId: 7, request: OPEN, senderOwns: false });
      expect(r.v).toEqual(refuseOverlord);
      expect(r.c.designation).toBe(0);
    },
    'sender does not own, not to the Overlord: as absent, designation unread': () => {
      const r = run({ toOverlord: false, requestId: 7, request: OPEN, senderOwns: false });
      expect(r.v).toEqual(notYours);
      expect(r.c.designation).toBe(0);
    },
    'owner, not to the Overlord, open: admitted, news stamped': () => {
      const r = run({ toOverlord: false, requestId: 7, request: OPEN });
      expect(r.v).toEqual({ ok: true, deliverTo: null, stampNews: true, report: false, requestId: 7 });
      expect(r.c.designation).toBe(0);
    },
    'owner, not to the Overlord, closed: admitted, no news': () => {
      const r = run({ toOverlord: false, requestId: 7, request: CLOSED });
      expect(r.v).toEqual({ ok: true, deliverTo: null, stampNews: false, report: false, requestId: 7 });
      expect(r.c.designation).toBe(0);
    },
    'owner, to the Overlord, closed: refused, designation unread': () => {
      const { v, c } = run({ toOverlord: true, requestId: 7, request: CLOSED });
      expect(v).toEqual({ ok: false, refuse: 'unknown-recipient', detail: 'request 7 is closed' });
      expect(c.designation).toBe(0);
    },
    'owner, to the Overlord, open, designation unreadable': () => {
      expect(run({ toOverlord: true, requestId: 7, request: OPEN, designation: { kind: 'unmeasured' } }).v)
        .toEqual({ ok: false, reply: 'unmeasured', detail: "the Overlord's designation could not be read" });
    },
    'owner, to the Overlord, open, none designated': () => {
      expect(run({ toOverlord: true, requestId: 7, request: OPEN, designation: { kind: 'none' } }).v)
        .toEqual({ ok: false, refuse: 'unknown-recipient', detail: 'no Overlord is designated' });
    },
    'owner, to the Overlord, open, designated and unbound': () => {
      expect(run({ toOverlord: true, requestId: 7, request: OPEN, designation: { kind: 'unbound' } }).v)
        .toEqual({ ok: true, deliverTo: null, report: true, stampNews: true, requestId: 7 });
    },
    'owner, to the Overlord, open, bound': () => {
      expect(run({ toOverlord: true, requestId: 7, request: OPEN, designation: { kind: 'bound', sessionId: 's1' } }).v)
        .toEqual({ ok: true, deliverTo: 's1', report: true, stampNews: true, requestId: 7 });
    },
    'the request id is the one named': () => {
      expect(run({ toOverlord: true, requestId: 12, request: OPEN }).v).toMatchObject({ requestId: 12 });
      expect(run({ toOverlord: false, requestId: 12, request: OPEN }).v).toMatchObject({ requestId: 12 });
      expect(run({ toOverlord: false, requestId: 12, request: ABSENT }).v).toEqual({ ok: false, refuse: 'request-not-yours', detail: m.requestNotYoursDetail(12) });
    },
    'to the Overlord, four callers read the same bytes': () => {
      const j = (o: RunOpts) => JSON.stringify(run(o).v);
      const base = j({ toOverlord: true, requestId: null });
      expect(j({ toOverlord: true, requestId: 7, request: ABSENT })).toBe(base);
      expect(j({ toOverlord: true, requestId: 7, request: UNOWNED })).toBe(base);
      expect(j({ toOverlord: true, requestId: 7, request: { kind: 'owned', owner: 'other', open: true }, senderOwns: false })).toBe(base);
    },
    'not to the Overlord, three callers read the same bytes': () => {
      const j = (o: RunOpts) => JSON.stringify(run(o).v);
      const base = j({ toOverlord: false, requestId: 7, request: ABSENT });
      expect(j({ toOverlord: false, requestId: 7, request: UNOWNED })).toBe(base);
      expect(j({ toOverlord: false, requestId: 7, request: OPEN, senderOwns: false })).toBe(base);
    },
  };
  // Monotonicity over a grid: an unmeasured fact read is never a refusal, a report needs the whole chain.
  const requests = ['unmeasured', ABSENT, UNOWNED, OPEN, CLOSED] as const;
  const owns = [true, false, 'unmeasured'] as const;
  const designations: MailDesignation[] = [{ kind: 'unmeasured' }, { kind: 'none' }, { kind: 'unbound' }, { kind: 'bound', sessionId: 's1' }];
  for (const toOverlord of [true, false]) for (const requestId of [null, 7]) for (const request of requests)
    for (const senderOwns of owns) for (const designation of designations) {
      cases[`grid toOverlord=${toOverlord} id=${requestId} req=${JSON.stringify(request)} owns=${senderOwns} des=${designation.kind}`] = () => {
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
      };
    }
  return cases;
}

/** The reports' quota. */
export function reportMailCases(m: PeerBoundModule): Cases {
  const verdict = m.reportMailVerdict;
  const start = 1_000_000;
  const ats = (n: number) => Array.from({ length: n }, (_, i) => start + i * 1000);
  const detailOf = (v: unknown): string => (v as { detail: string }).detail;
  return {
    'none in the hour is bounded': () => { expect(verdict({ fromId: 'a', hourAts: [], now: start })).toEqual({ verdict: 'bounded' }); },
    'one under the quota is bounded': () => {
      expect(verdict({ fromId: 'a', hourAts: ats(REPORTS_TO_OVERLORD_HOURLY - 1), now: start + 100_000 })).toEqual({ verdict: 'bounded' });
    },
    'exactly the quota: peer-quota at the oldest plus the window': () => {
      const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
      const v = verdict({ fromId: 'sender-x', hourAts, now: start + 100_000 });
      expect(v).toMatchObject({ verdict: 'peer-quota', retry: { on: 'time', at: hourAts[0]! + PEER_MAIL_WINDOW_MS } });
      expect(detailOf(v)).toContain('sender-x');
      expect(detailOf(v)).toContain(`sent ${REPORTS_TO_OVERLORD_HOURLY} reports to the Overlord in the last hour`);
    },
    'one over: the second oldest sets the time': () => {
      const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY + 1);
      const v = verdict({ fromId: 'a', hourAts, now: start + 100_000 });
      expect(v).toMatchObject({ verdict: 'peer-quota', retry: { on: 'time', at: hourAts[1]! + PEER_MAIL_WINDOW_MS } });
    },
    'the answer carries nothing but a time retry': () => {
      const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
      const v = verdict({ fromId: 'a', hourAts, now: start }) as unknown as { retry: Record<string, unknown> };
      expect(v.retry).toEqual({ on: 'time', at: hourAts[0]! + PEER_MAIL_WINDOW_MS });
    },
    'inS is never negative': () => {
      const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
      const v = verdict({ fromId: 'a', hourAts, now: hourAts[0]! + PEER_MAIL_WINDOW_MS + 500_000 });
      expect(detailOf(v)).toContain('(in 0 s)');
      expect(detailOf(v)).not.toMatch(/in -\d/);
    },
    'inS rounds a part second up, in seconds': () => {
      const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
      const at = hourAts[0]! + PEER_MAIL_WINDOW_MS;
      const v = verdict({ fromId: 'a', hourAts, now: at - 5_500 });
      expect(detailOf(v)).toContain('(in 6 s)');
      expect(detailOf(verdict({ fromId: 'a', hourAts, now: at - 5_000 }))).toContain('(in 5 s)');
    },
    'the detail names the time it can go': () => {
      const hourAts = ats(REPORTS_TO_OVERLORD_HOURLY);
      const at = hourAts[0]! + PEER_MAIL_WINDOW_MS;
      expect(detailOf(verdict({ fromId: 'a', hourAts, now: start }))).toContain(`it can go at ${new Date(at).toISOString()} (in `);
    },
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MAIL_KEY = 'server/src/coord/requestMail.ts';
const PEER_KEY = 'server/src/coord/peerBound.ts';
const MAIL_MODULE = path.join(ROOT, MAIL_KEY);
const PEER_MODULE = path.join(ROOT, PEER_KEY);

const NOT_YOURS_OK = "{ ok: true, deliverTo: null, stampNews: false, report: false, requestId: id }";
const UNMEASURED_OWNS = "  if (owns === 'unmeasured') return { ok: false, reply: 'run-unreadable', detail: \"the sender's programme could not be read\" };\n";
const CLOSED_LINE = "  if (!read.open) return { ok: false, refuse: 'unknown-recipient', detail: `request ${id} is closed` };\n";

const OWNER_SET: MutantSet<RequestMailModule> = {
  modulePath: MAIL_MODULE,
  suite: requestOwnerReadCases,
  mutants: [
    { id: 'A1 an absent row reads on', old: "  if (row === 'absent') return { kind: 'absent' };\n", new: '' },
    { id: 'A2 an absent row reads unowned', old: "if (row === 'absent') return { kind: 'absent' };", new: "if (row === 'absent') return { kind: 'unowned' };" },
    { id: 'A3 a null owner reads owned', old: "if (row.owner === null) return { kind: 'unowned' };", new: "if (row.owner === null) return { kind: 'owned', owner: '', open: true };" },
    { id: 'A4 a null owner is not read', old: "  if (row.owner === null) return { kind: 'unowned' };\n", new: '' },
    { id: 'A5 a terminal state reads open', old: 'open: !TERMINAL_REQUEST_STATES.includes(row.state as RequestState)', new: 'open: true' },
    { id: 'A6 every state reads closed', old: 'open: !TERMINAL_REQUEST_STATES.includes(row.state as RequestState)', new: 'open: false' },
    { id: 'A7 open and closed swapped', old: 'open: !TERMINAL_REQUEST_STATES.includes(row.state as RequestState)', new: 'open: TERMINAL_REQUEST_STATES.includes(row.state as RequestState)' },
    { id: 'A8 an unknown word reads closed', old: 'open: !TERMINAL_REQUEST_STATES.includes(row.state as RequestState)', new: 'open: !TERMINAL_REQUEST_STATES.includes(row.state as RequestState) && row.state.length < 3' },
    { id: 'A9 the owner is lost', old: 'owner: row.owner, open:', new: "owner: '', open:" },
  ],
};

// Two mutants are left out on purpose, as equivalent: dropping `read.kind === 'owned' &&` (or widening it to `!== 'absent'`) changes
// nothing, since an absent or unowned read carries no `owner`, and `undefined === programme` is false for every programme a door passes.
const PROGRAMME_SET: MutantSet<RequestMailModule> = {
  modulePath: MAIL_MODULE,
  suite: programmeRequestCases,
  mutants: [
    { id: 'G1 any owner passes', old: "read.kind === 'owned' && read.owner === programme ?", new: "read.kind === 'owned' ?" },
    { id: 'G2 only another programme passes', old: 'read.owner === programme ?', new: 'read.owner !== programme ?' },
    { id: 'G3 an open request only', old: 'read.owner === programme ?', new: 'read.owner === programme && read.open ?' },
    { id: 'G6 the refusal is another word', old: "refuse: 'request-not-yours', detail: requestNotYoursDetail(requestId) }", new: "refuse: 'unknown-recipient', detail: requestNotYoursDetail(requestId) }" },
    { id: 'G7 the refusal names the programme', old: "detail: requestNotYoursDetail(requestId) }", new: 'detail: `request ${requestId} is not ${programme}\'s` }' },
    { id: 'G8 the detail says it is unknown', old: "is not this programme's`", new: "does not exist`" },
    { id: 'G9 the detail names another id', old: "`request ${requestId} is not this programme's`", new: "`request ${requestId + 1} is not this programme's`" },
  ],
};

const DESIGNATION_SET: MutantSet<RequestMailModule> = {
  modulePath: MAIL_MODULE,
  suite: mailDesignationCases,
  mutants: [
    { id: 'D1 unmeasured reads none', old: "if (d.kind === 'unmeasured') return { kind: 'unmeasured' };", new: "if (d.kind === 'unmeasured') return { kind: 'none' };" },
    { id: 'D2 unmeasured reads unbound', old: "if (d.kind === 'unmeasured') return { kind: 'unmeasured' };", new: "if (d.kind === 'unmeasured') return { kind: 'unbound' };" },
    { id: 'D3 unmeasured is not read', old: "  if (d.kind === 'unmeasured') return { kind: 'unmeasured' };\n", new: '' },
    { id: 'D4 designated reads unbound', old: "return { kind: 'bound', sessionId: d.sessionId };", new: "return { kind: 'unbound' };" },
    { id: 'D5 designated loses its session', old: 'sessionId: d.sessionId }', new: "sessionId: '' }" },
    { id: 'D6 designated is not read', old: "  if (d.kind === 'designated') return { kind: 'bound', sessionId: d.sessionId };\n", new: '' },
    { id: 'D7 a row reads none', old: "return d.row === null ? { kind: 'none' } : { kind: 'unbound' };", new: "return { kind: 'none' };" },
    { id: 'D8 no row reads unbound', old: "return d.row === null ? { kind: 'none' } : { kind: 'unbound' };", new: "return { kind: 'unbound' };" },
    { id: 'D9 none and unbound swapped', old: "d.row === null ? { kind: 'none' } : { kind: 'unbound' }", new: "d.row === null ? { kind: 'unbound' } : { kind: 'none' }" },
    { id: 'D10 a row reads unmeasured', old: "d.row === null ? { kind: 'none' } : { kind: 'unbound' }", new: "d.row === null ? { kind: 'none' } : { kind: 'unmeasured' }" },
  ],
};

const MAIL_SET: MutantSet<RequestMailModule> = {
  modulePath: MAIL_MODULE,
  suite: requestMailCases,
  mutants: [
    { id: 'V1 no request to the Overlord is admitted', old: '  if (f.requestId === null) {\n    return f.toOverlord ?', new: '  if (f.requestId === null) {\n    return false ?' },
    { id: 'V2 no request, not to the Overlord, is refused', old: '  if (f.requestId === null) {\n    return f.toOverlord ?', new: '  if (f.requestId === null) {\n    return true ?' },
    { id: 'V3 no request, not to the Overlord, stamps news', old: 'stampNews: false, report: false, requestId: null }', new: 'stampNews: true, report: false, requestId: null }' },
    { id: 'V4 the one detail changes', old: "\"the Overlord's role takes no mail in W1\"", new: "\"the Overlord's role takes no mail\"" },
    { id: 'V5 an unowned or absent request is admitted', old: "if (read.kind !== 'owned') return notYours;", new: `if (read.kind !== 'owned') return ${NOT_YOURS_OK};` },
    { id: 'V6 an unowned request reads owned', old: "if (read.kind !== 'owned') return notYours;", new: "if (read.kind === 'absent') return notYours;" },
    { id: 'V7 an absent request reads owned', old: "if (read.kind !== 'owned') return notYours;", new: "if (read.kind === 'unowned') return notYours;" },
    { id: 'V8 the non-owner word is swapped', old: 'const notYours: RequestMailVerdict = f.toOverlord ?', new: 'const notYours: RequestMailVerdict = !f.toOverlord ?' },
    { id: 'V9 the non-owner detail loses the id', old: 'detail: requestNotYoursDetail(id) };', new: 'detail: requestNotYoursDetail(0) };' },
    { id: 'V10 an unreadable request is a refusal', old: "reply: 'run-unreadable', detail: 'the request record could not be read'", new: "refuse: 'request-not-yours', detail: 'the request record could not be read'" },
    { id: 'V11 an unreadable request is an admission', old: "if (read === 'unmeasured') return { ok: false, reply: 'run-unreadable', detail: 'the request record could not be read' };",
      new: `if (read === 'unmeasured') return ${NOT_YOURS_OK};` },
    { id: 'V12 an unreadable request is not read', old: "  if (read === 'unmeasured') return { ok: false, reply: 'run-unreadable', detail: 'the request record could not be read' };\n", new: '' },
    { id: 'V13 an unreadable owner test counts as owned', old: UNMEASURED_OWNS, new: '' },
    { id: 'V14 an unreadable owner test is a refusal', old: "reply: 'run-unreadable', detail: \"the sender's programme", new: "refuse: 'request-not-yours', detail: \"the sender's programme" },
    { id: 'V15 an unreadable owner test is a non-owner', old: UNMEASURED_OWNS, new: "  if (owns === 'unmeasured') return notYours;\n" },
    { id: 'V16 a non-owner passes', old: '  if (!owns) return notYours;\n', new: '' },
    { id: 'V17 an owner is a non-owner', old: 'if (!owns) return notYours;', new: 'if (owns) return notYours;' },
    { id: 'V18 the owner test is asked of the request id', old: 'f.senderOwns(read.owner)', new: 'f.senderOwns(String(id))' },
    { id: 'V19 not to the Overlord, the gate is skipped', old: 'if (!f.toOverlord) return {', new: 'if (false) return {' },
    { id: 'V20 not to the Overlord, a report', old: 'stampNews: read.open, report: false', new: 'stampNews: read.open, report: true' },
    { id: 'V21 not to the Overlord, news never stamped', old: 'stampNews: read.open, report: false', new: 'stampNews: false, report: false' },
    { id: 'V22 not to the Overlord, news always stamped', old: 'stampNews: read.open, report: false', new: 'stampNews: true, report: false' },
    { id: 'V23 not to the Overlord, the id is lost', old: 'report: false, requestId: id }', new: 'report: false, requestId: null }' },
    { id: 'V24 a closed request reaches the Overlord', old: CLOSED_LINE, new: '' },
    { id: 'V25 an open request is closed', old: 'if (!read.open) return', new: 'if (read.open) return' },
    { id: 'V26 the closed detail loses the id', old: 'detail: `request ${id} is closed`', new: "detail: 'request is closed'" },
    { id: 'V27 the closed refusal is another word', old: "refuse: 'unknown-recipient', detail: `request ${id} is closed`", new: "refuse: 'request-not-yours', detail: `request ${id} is closed`" },
    { id: 'V28 the designation is read before ownership', old: '  const read = f.request();\n', new: '  const read = f.request();\n  f.designation();\n' },
    { id: 'V29 the designation is read before the closed check', old: '  if (!f.toOverlord) return {', new: '  f.designation();\n  if (!f.toOverlord) return {' },
    { id: 'V30 an unreadable designation is not read', old: "  if (d.kind === 'unmeasured') return { ok: false, reply: 'unmeasured', detail: \"the Overlord's designation could not be read\" };\n", new: '' },
    { id: 'V31 an unreadable designation is a none', old: "if (d.kind === 'unmeasured') return { ok: false, reply: 'unmeasured'", new: "if (d.kind === 'none') return { ok: false, reply: 'unmeasured'" },
    { id: 'V32 an unreadable designation is a refusal', old: "reply: 'unmeasured', detail: \"the Overlord's designation", new: "refuse: 'unknown-recipient', detail: \"the Overlord's designation" },
    { id: 'V33 an unreadable designation answers the request word', old: "reply: 'unmeasured', detail:", new: "reply: 'run-unreadable', detail:" },
    { id: 'V34 no designation is admitted', old: "  if (d.kind === 'none') return { ok: false, refuse: 'unknown-recipient', detail: 'no Overlord is designated' };\n", new: '' },
    { id: 'V35 no designation answers unmeasured', old: "if (d.kind === 'none') return { ok: false, refuse: 'unknown-recipient', detail: 'no Overlord is designated' };", new: "if (d.kind === 'none') return { ok: false, reply: 'unmeasured', detail: 'no Overlord is designated' };" },
    { id: 'V36 an unbound designation is refused', old: "if (d.kind === 'none') return", new: "if (d.kind !== 'bound') return" },
    { id: 'V37 a bound session is not named', old: "deliverTo: d.kind === 'bound' ? d.sessionId : null", new: 'deliverTo: null' },
    { id: 'V38 an unbound role is named a session', old: "deliverTo: d.kind === 'bound' ? d.sessionId : null", new: "deliverTo: d.kind !== 'none' ? d.sessionId : null" },
    { id: 'V39 a report is not a report', old: 'stampNews: true, report: true, requestId: id }', new: 'stampNews: true, report: false, requestId: id }' },
    { id: 'V40 a report stamps no news', old: 'stampNews: true, report: true, requestId: id }', new: 'stampNews: false, report: true, requestId: id }' },
    { id: 'V41 a report loses its id', old: 'stampNews: true, report: true, requestId: id }', new: 'stampNews: true, report: true, requestId: null }' },
  ],
};

const REPORT_SET: MutantSet<PeerBoundModule> = {
  modulePath: PEER_MODULE,
  suite: reportMailCases,
  mutants: [
    { id: 'R1 the quota is exclusive', old: 'f.hourAts.length < REPORTS_TO_OVERLORD_HOURLY', new: 'f.hourAts.length <= REPORTS_TO_OVERLORD_HOURLY' },
    { id: 'R2 the quota is one lower', old: 'f.hourAts.length < REPORTS_TO_OVERLORD_HOURLY', new: 'f.hourAts.length < REPORTS_TO_OVERLORD_HOURLY - 1' },
    { id: 'R3 the peer quota is used', old: 'f.hourAts.length < REPORTS_TO_OVERLORD_HOURLY', new: 'f.hourAts.length < PEER_MAIL_HOURLY' },
    { id: 'R4 the oldest is one off', old: 'f.hourAts[f.hourAts.length - REPORTS_TO_OVERLORD_HOURLY]!', new: 'f.hourAts[f.hourAts.length - REPORTS_TO_OVERLORD_HOURLY + 1]!' },
    { id: 'R5 the newest sets the time', old: 'f.hourAts[f.hourAts.length - REPORTS_TO_OVERLORD_HOURLY]!', new: 'f.hourAts[f.hourAts.length - 1]!' },
    { id: 'R6 the first sets the time', old: 'f.hourAts[f.hourAts.length - REPORTS_TO_OVERLORD_HOURLY]!', new: 'f.hourAts[0]!' },
    { id: 'R7 the window is dropped', old: 'REPORTS_TO_OVERLORD_HOURLY]! + PEER_MAIL_WINDOW_MS;', new: 'REPORTS_TO_OVERLORD_HOURLY]! + 0;' },
    { id: 'R8 the retry waits on an ack', old: "retry: { on: 'time', at },\n    detail: `${f.fromId} has sent ${REPORTS_TO_OVERLORD_HOURLY}", new: "retry: { on: 'ack', toId: f.fromId },\n    detail: `${f.fromId} has sent ${REPORTS_TO_OVERLORD_HOURLY}" },
    { id: 'R9 the seconds go negative', old: '\n  const inS = Math.max(0, Math.ceil((at - f.now) / 1000));', new: '\n  const inS = Math.ceil((at - f.now) / 1000);' },
    { id: 'R10 the seconds round down', old: '\n  const inS = Math.max(0, Math.ceil((at - f.now) / 1000));', new: '\n  const inS = Math.max(0, Math.floor((at - f.now) / 1000));' },
    { id: 'R11 the seconds are tenths', old: '\n  const inS = Math.max(0, Math.ceil((at - f.now) / 1000));', new: '\n  const inS = Math.max(0, Math.ceil((at - f.now) / 100));' },
    { id: 'R12 the detail names the peer quota', old: '${f.fromId} has sent ${REPORTS_TO_OVERLORD_HOURLY} reports', new: '${f.fromId} has sent ${PEER_MAIL_HOURLY} reports' },
    { id: 'R13 the detail loses the sender', old: '`${f.fromId} has sent ${REPORTS_TO_OVERLORD_HOURLY} reports', new: '`someone has sent ${REPORTS_TO_OVERLORD_HOURLY} reports' },
    { id: 'R14 the detail loses the time', old: '`${new Date(at).toISOString()} (in ${inS} s), when the oldest leaves the hour` };\n}\n', new: '`(in ${inS} s), when the oldest leaves the hour` };\n}\n' },
    { id: 'R15 an under-quota sender is refused', old: 'if (f.hourAts.length < REPORTS_TO_OVERLORD_HOURLY) return { verdict: \'bounded\' };', new: 'if (f.hourAts.length < REPORTS_TO_OVERLORD_HOURLY) return { verdict: \'peer-quota\', retry: { on: \'time\', at: 0 }, detail: \'\' };' },
  ],
};

/** One entry per decider, keyed `<path>#<function>`; `mutation-floors.test.ts` spreads it into `MUTANT_SETS`. */
export const REQUEST_ID_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${MAIL_KEY}#requestOwnerReadOf`]: OWNER_SET as MutantSet<never>,
  [`${MAIL_KEY}#programmeRequestVerdict`]: PROGRAMME_SET as MutantSet<never>,
  [`${MAIL_KEY}#mailDesignationOf`]: DESIGNATION_SET as MutantSet<never>,
  [`${MAIL_KEY}#requestMailVerdict`]: MAIL_SET as MutantSet<never>,
  [`${PEER_KEY}#reportMailVerdict`]: REPORT_SET as MutantSet<never>,
};
