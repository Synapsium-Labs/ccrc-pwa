// The inbox's codecs and deciders: their cases and mutant sets (Overlord W1, inbox piece, Task 1; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`). As in `probeDoorSets.ts`, each function's cases are written
// ONCE here, as suite cases over a module: `overlord-inbox-vocab.test.ts` (the L0 codecs, `shared/overlordInbox.ts`) and
// `overlord-inbox-deciders.test.ts` (the L1 deciders, `server/src/coord/overlordInbox.ts`) run them against the real
// modules, and `mutation-floors.test.ts` runs them against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { INJECTED_PROMPTS } from '../../../shared/injected-prompts.mjs';
import { MESSAGE_STATES, READ_DOORS } from '../../../shared/operatorMessages.js';
import { INBOX_PAGE_ROWS, READ_CEILINGS, READ_CEILING_WINDOW_MS, type InboxBehind, type InboxRow, type InboxWakeBody } from '../../../shared/overlordInbox.js';
import type { GateVerdict, GateWord } from '../../src/coord/overlordGate.js';
import type { InboxComposed, InboxSources, MessageFacts, OpenRound, ProbeRowsFact, Source } from '../../src/coord/overlordInbox.js';
import { GENERATION_STATES } from '../../../shared/continuity.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const L0 = path.join(ROOT, 'shared/overlordInbox.ts');
const L1 = path.join(ROOT, 'server/src/coord/overlordInbox.ts');

export type InboxVocabModule = typeof import('../../../shared/overlordInbox.js');
export type InboxDecidersModule = typeof import('../../src/coord/overlordInbox.js');

const HEAD = INJECTED_PROMPTS['mail-nudge'].text;
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const WINDOW = READ_CEILING_WINDOW_MS;
const NONE = { kind: 'none' } as const;

// ------------------------------------------------------------------------------------------------------ parseMessageId

export function parseMessageIdCases(m: InboxVocabModule): Record<string, SuiteCase> {
  return {
    'a canonical positive id is allowed': () => {
      for (const [raw, id] of [['3', 3], ['12', 12], ['10', 10], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]] as const) {
        expect(m.parseMessageId(raw), raw).toEqual({ ok: true, id });
      }
    },
    'zero, a sign, a leading zero, a radix prefix, a list, a fraction and white space are refused': () => {
      for (const raw of ['0', '00', '-1', '+3', '07', '0x3', '3,7', '1.5', ' 3', '3 ', '3\n', '1e3', '٣']) {
        const r = m.parseMessageId(raw);
        expect(r.ok, raw).toBe(false);
      }
    },
    'an id past the safe integers, the empty string and a non-string are refused': () => {
      for (const raw of [String(Number.MAX_SAFE_INTEGER + 1), '99999999999999999999', '', 3, null, undefined, {}, ['3']]) {
        expect(m.parseMessageId(raw).ok, String(raw)).toBe(false);
      }
    },
    'a refusal carries a detail that does not echo the input': () => {
      const r = m.parseMessageId('0x3-secret');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.detail.length).toBeGreaterThan(0);
        expect(r.detail).not.toContain('secret');
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------------ readInboxWakeBody

const BODY: InboxWakeBody = { keys: ['probe-round:r1', 'operator-message:5'], waiting: 3, firstDue: NONE };
const TEXT = (lines: readonly string[]): string => lines.join('\n');
const HEADER = 'inbox-wake v1';

export function readInboxWakeBodyCases(m: InboxVocabModule): Record<string, SuiteCase> {
  const refuses = (s: string): void => { expect(m.readInboxWakeBody(s), JSON.stringify(s)).toEqual({ ok: false }); };
  return {
    'the body renders as a header and one line for each field, never a word': () => {
      expect(m.renderInboxWakeBody(BODY)).toBe(TEXT([HEADER, 'waiting: 3', 'first-due: none', 'key: probe-round:r1', 'key: operator-message:5']));
      expect(m.renderInboxWakeBody({ keys: [], waiting: 0, firstDue: { kind: 'by', at: 1700000000000 } }))
        .toBe(TEXT([HEADER, 'waiting: 0', 'first-due: by 1700000000000']));
    },
    'a body round-trips: no keys, a key, many keys, a deadline': () => {
      const bodies: InboxWakeBody[] = [
        { keys: [], waiting: 0, firstDue: NONE },
        { keys: ['a:1'], waiting: 1, firstDue: NONE },
        { keys: ['probe-round:r1', 'operator-message:5', 'operator-message:6'], waiting: 9, firstDue: { kind: 'by', at: 42 } },
        { keys: ['a:1'], waiting: 1, firstDue: { kind: 'by', at: 0 } },
      ];
      for (const b of bodies) expect(m.readInboxWakeBody(m.renderInboxWakeBody(b))).toEqual({ ok: true, body: b });
    },
    'one trailing newline is tolerated, two are not': () => {
      const text = m.renderInboxWakeBody(BODY);
      expect(m.readInboxWakeBody(`${text}\n`)).toEqual({ ok: true, body: BODY });
      refuses(`${text}\n\n`);
    },
    'a missing, wrong or misplaced header is refused': () => {
      refuses('');
      refuses('\n');
      refuses(TEXT(['waiting: 1', 'first-due: none']));
      refuses(TEXT(['inbox-wake v2', 'waiting: 1', 'first-due: none']));
      refuses(TEXT(['inbox-wake', 'waiting: 1', 'first-due: none']));
      refuses(TEXT(['waiting: 1', HEADER, 'first-due: none']));
    },
    'an unknown line, a line with no value and a stray blank line are refused': () => {
      refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', 'colour: red']));
      refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', 'key']));
      refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', 'key:x']));
      refuses(TEXT([HEADER, 'waiting: 1', '', 'first-due: none']));
      refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', 'text: hello']));
    },
    'a missing or repeated waiting or first-due line is refused': () => {
      refuses(TEXT([HEADER, 'first-due: none']));
      refuses(TEXT([HEADER, 'waiting: 1']));
      refuses(TEXT([HEADER, 'waiting: 1', 'waiting: 1', 'first-due: none']));
      refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', 'first-due: none']));
    },
    'a bad count is refused: sign, leading zero, fraction, text, empty, past the safe integers, below the keys': () => {
      for (const n of ['-1', '01', '1.5', 'x', '', ' 1', '1 ', '9007199254740992', '0x1']) {
        refuses(TEXT([HEADER, `waiting: ${n}`, 'first-due: none']));
      }
      refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', 'key: a:1', 'key: a:2']));
      refuses(TEXT([HEADER, 'waiting: x', 'waiting: 1', 'first-due: none']));
      expect(m.readInboxWakeBody(TEXT([HEADER, 'waiting: 2', 'first-due: none', 'key: a:1', 'key: a:2'])).ok).toBe(true);
    },
    'a bad deadline is refused': () => {
      for (const d of ['soon', 'by', 'by x', 'by -3', 'by 01', 'by 1.5', 'by  1', 'none ', 'None', 'by 9007199254740992', '']) {
        refuses(TEXT([HEADER, 'waiting: 1', `first-due: ${d}`]));
      }
    },
    'a key with a control character, a space, no characters or a repeat is refused': () => {
      for (const k of ['a\u0007b', 'a\u0000b', 'a\u007fb', 'a b', 'a\tb', 'a\rb', '', ' a']) {
        refuses(TEXT([HEADER, 'waiting: 1', 'first-due: none', `key: ${k}`]));
      }
      refuses(TEXT([HEADER, 'waiting: 2', 'first-due: none', 'key: a:1', 'key: a:1']));
    },
    'the lines may come in any order after the header': () => {
      expect(m.readInboxWakeBody(TEXT([HEADER, 'key: a:1', 'first-due: none', 'waiting: 1']))).toEqual({
        ok: true, body: { keys: ['a:1'], waiting: 1, firstDue: NONE },
      });
    },
  };
}

// ------------------------------------------------------------------------------------------------------ renderInboxWakeLine

const OK = (b: InboxWakeBody): { ok: true; body: InboxWakeBody } => ({ ok: true, body: b });

export function renderInboxWakeLineCases(m: InboxVocabModule): Record<string, SuiteCase> {
  return {
    'with no deadline: the head, the count and the door': () => {
      expect(m.renderInboxWakeLine(OK({ keys: [], waiting: 2, firstDue: NONE }), NOW))
        .toBe(`${HEAD} 2 waiting in your inbox: read it with your inbox door.`);
    },
    'with a deadline: the time left in whole seconds, rounded up': () => {
      const at = (ms: number) => OK({ keys: [], waiting: 3, firstDue: { kind: 'by', at: NOW + ms } });
      const line = (s: number) => `${HEAD} 3 waiting in your inbox, the first lapses in ${s} s: read it with your inbox door.`;
      expect(m.renderInboxWakeLine(at(140_000), NOW)).toBe(line(140));
      expect(m.renderInboxWakeLine(at(139_001), NOW)).toBe(line(140));
      expect(m.renderInboxWakeLine(at(1), NOW)).toBe(line(1));
    },
    'a deadline already lapsed says so, with no negative time': () => {
      for (const ms of [0, -1, -90_000]) {
        const line = m.renderInboxWakeLine(OK({ keys: [], waiting: 1, firstDue: { kind: 'by', at: NOW + ms } }), NOW);
        expect(line, String(ms)).toBe(`${HEAD} 1 waiting in your inbox, the first has lapsed: read it with your inbox door.`);
      }
    },
    "the codec's refusal still names the door, without a count": () => {
      const line = m.renderInboxWakeLine({ ok: false }, NOW);
      expect(line).toBe(`${HEAD} Something waits in your inbox: read it with your inbox door.`);
      expect(line.slice(HEAD.length)).not.toMatch(/\d/);
    },
    'the count of a body with keys is its own waiting, never the key count': () => {
      expect(m.renderInboxWakeLine(OK({ keys: ['a:1'], waiting: 4, firstDue: NONE }), NOW)).toContain(' 4 waiting ');
    },
  };
}

export function renderSpotProbeLineCases(m: InboxVocabModule): Record<string, SuiteCase> {
  return {
    "the spot-probe notice's line is the head, then the probe door": () => {
      expect(m.renderSpotProbeLine()).toBe(`${HEAD} A probe round is open: answer it with your probe door.`);
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- composeInbox

const M = <T>(value: T): Source<T> => ({ kind: 'measured', value });
const NOPE = { kind: 'unmeasured', why: 'not read' } as const;
const msg = (id: number, at = 1000 + id, over: Partial<MessageFacts> = {}): MessageFacts =>
  ({ id, at, term: 1, state: 'delivered', cut: false, ...over });
const round = (over: Partial<OpenRound> = {}): OpenRound => ({ roundId: 'r1', kind: 'compaction', questions: 3, askedAt: 500, ...over });
const sources = (probe: InboxSources['probe'], messages: InboxSources['messages']): InboxSources => ({ probe, messages });
const rowsOf = (c: InboxComposed): InboxRow[] => {
  if (c.kind !== 'served') throw new Error(`not served: ${JSON.stringify(c)}`);
  return [...c.rows];
};
const idsOf = (c: InboxComposed): number[] => rowsOf(c).map((r) => (r.kind === 'operator-message' ? r.messageId : -1));

export function composeInboxCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  return {
    'no rows: served, empty, nothing behind': () => {
      expect(m.composeInbox(sources(M('none'), M([])))).toEqual({ kind: 'served', rows: [], behind: NONE });
    },
    'messages only: oldest first by at, ties by id': () => {
      const c = m.composeInbox(sources(M('none'), M([msg(3, 300), msg(1, 200), msg(2, 200)])));
      expect(idsOf(c)).toEqual([1, 2, 3]);
      expect(m.composeInbox(sources(M('none'), M([msg(1, 300), msg(2, 200)])))).toMatchObject({ kind: 'served', behind: NONE });
      expect(idsOf(m.composeInbox(sources(M('none'), M([msg(1, 300), msg(2, 200)]))))).toEqual([2, 1]);
    },
    'a message row names its kind, key, band, time, no deadline, door, term, state and cut, and nothing else': () => {
      const c = m.composeInbox(sources(M('none'), M([msg(7, 250, { term: 4, state: 'picked-up', cut: true })])));
      expect(rowsOf(c)).toEqual([{
        kind: 'operator-message', key: 'operator-message:7', band: 'operator', at: 250, due: NONE, door: 'messages',
        messageId: 7, term: 4, state: 'picked-up', cut: true,
      }]);
    },
    'an open round with messages behind it is served alone, with the count behind it': () => {
      const c = m.composeInbox(sources(M(round({ roundId: 'r9', kind: 'spot', questions: 2, askedAt: 777 })), M([msg(1), msg(2)])));
      expect(c).toEqual({
        kind: 'served',
        rows: [{
          kind: 'probe-round', key: 'probe-round:r9', band: 'probe', at: 777, due: NONE, door: 'probe',
          roundId: 'r9', roundKind: 'spot', questions: 2,
        }],
        behind: { kind: 'probe-first', count: 2 },
      });
    },
    'an open round with nothing behind it has nothing behind it': () => {
      expect(m.composeInbox(sources(M(round()), M([])))).toMatchObject({ kind: 'served', behind: NONE });
      expect(rowsOf(m.composeInbox(sources(M(round()), M([])))).map((r) => r.key)).toEqual(['probe-round:r1']);
    },
    'every round kind is served as a probe row of that kind': () => {
      for (const kind of ['start', 'compaction', 'spot'] as const) {
        const r = rowsOf(m.composeInbox(sources(M(round({ kind })), M([]))))[0]!;
        expect([r.kind, r.kind === 'probe-round' ? r.roundKind : null]).toEqual(['probe-round', kind]);
      }
    },
    'more than a page of messages is cut at the page, the rest counted behind it': () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1, 10_000 - i));
      const c = m.composeInbox(sources(M('none'), M(many(INBOX_PAGE_ROWS + 5))));
      const rows = rowsOf(c);
      expect(rows).toHaveLength(INBOX_PAGE_ROWS);
      expect(c).toMatchObject({ behind: { kind: 'page', count: 5 } });
      // The oldest first: the highest ids carry the lowest `at`, so the page is ids n..n-99, never the first hundred by id.
      expect(idsOf(c)[0]).toBe(INBOX_PAGE_ROWS + 5);
      expect(idsOf(c)[INBOX_PAGE_ROWS - 1]).toBe(6);
      expect(m.composeInbox(sources(M('none'), M(many(INBOX_PAGE_ROWS))))).toMatchObject({ behind: NONE });
      expect(m.composeInbox(sources(M('none'), M(many(INBOX_PAGE_ROWS + 1))))).toMatchObject({ behind: { kind: 'page', count: 1 } });
    },
    'a source that is unmeasured answers unmeasured naming it, never a partial list': () => {
      expect(m.composeInbox(sources(NOPE, M([msg(1)])))).toEqual({ kind: 'unmeasured', source: 'probe', why: 'not read' });
      expect(m.composeInbox(sources(M('none'), NOPE))).toEqual({ kind: 'unmeasured', source: 'messages', why: 'not read' });
      expect(m.composeInbox(sources(M(round()), NOPE))).toEqual({ kind: 'unmeasured', source: 'messages', why: 'not read' });
      expect(m.composeInbox(sources(NOPE, { kind: 'unmeasured', why: 'other' }))).toEqual({ kind: 'unmeasured', source: 'probe', why: 'not read' });
    },
    'a state read as unknown is still served in band 1': () => {
      const c = m.composeInbox(sources(M('none'), M([msg(1, 5, { state: 'unknown' })])));
      expect(rowsOf(c)).toMatchObject([{ kind: 'operator-message', band: 'operator', state: 'unknown' }]);
    },
    'the sources are not reordered in place': () => {
      const list = Object.freeze([msg(2, 20), msg(1, 10)]);
      expect(() => m.composeInbox(sources(M('none'), M(list)))).not.toThrow();
      expect(list.map((x) => x.id)).toEqual([2, 1]);
    },
  };
}

// ------------------------------------------------------------------------------------------------------ inboxProbeSource

const ROUND_ROWS = (kind: 'start' | 'compaction' | 'spot' = 'compaction'): Extract<ProbeRowsFact, { ok: true }> => ({
  ok: true,
  rows: [
    { roundId: 'r-7', kind, askedAt: 4_000 },
    { roundId: 'r-7', kind, askedAt: 4_000 },
    { roundId: 'r-7', kind, askedAt: 4_001 },
  ],
});

export function inboxProbeSourceCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  const active = { kind: 'state', state: 'active' } as const;
  return {
    'an active generation asks for its open round before it answers': () => {
      expect(m.inboxProbeSource(active, 'not-read')).toEqual({ kind: 'read-rows' });
    },
    'an active generation with an open round answers its id, kind, count and first time, and nothing else': () => {
      const r = m.inboxProbeSource(active, ROUND_ROWS('spot'));
      expect(r).toEqual({ kind: 'measured', value: { roundId: 'r-7', kind: 'spot', questions: 3, askedAt: 4_000 } });
      if (r.kind === 'measured' && r.value !== 'none') expect(Object.keys(r.value).sort()).toEqual(['askedAt', 'kind', 'questions', 'roundId']);
    },
    'an active generation with no open round answers none': () => {
      expect(m.inboxProbeSource(active, { ok: true, rows: [] })).toEqual({ kind: 'measured', value: 'none' });
    },
    'a round whose rows could not be read is unmeasured, naming the reader\'s detail, never none': () => {
      expect(m.inboxProbeSource(active, { ok: false, detail: 'continuity_probes read failed' })).toEqual({ kind: 'unmeasured', why: 'continuity_probes read failed' });
    },
    'a generation in any other state answers none and never asks for the round, whatever rows are given': () => {
      for (const state of GENERATION_STATES.filter((s) => s !== 'active')) {
        expect(m.inboxProbeSource({ kind: 'state', state }, 'not-read'), state).toEqual({ kind: 'measured', value: 'none' });
        expect(m.inboxProbeSource({ kind: 'state', state }, ROUND_ROWS()), state).toEqual({ kind: 'measured', value: 'none' });
        expect(m.inboxProbeSource({ kind: 'state', state }, { ok: false, detail: 'x' }), state).toEqual({ kind: 'measured', value: 'none' });
      }
    },
    'no live generation answers none': () => {
      expect(m.inboxProbeSource({ kind: 'none' }, 'not-read')).toEqual({ kind: 'measured', value: 'none' });
      expect(m.inboxProbeSource({ kind: 'none' }, ROUND_ROWS())).toEqual({ kind: 'measured', value: 'none' });
    },
    'a generation whose state could not be read is unmeasured with its reason, whatever rows are given': () => {
      const gen = { kind: 'unmeasured', why: 'the generations could not be read' } as const;
      expect(m.inboxProbeSource(gen, 'not-read')).toEqual({ kind: 'unmeasured', why: 'the generations could not be read' });
      expect(m.inboxProbeSource(gen, ROUND_ROWS())).toEqual({ kind: 'unmeasured', why: 'the generations could not be read' });
    },
  };
}

// ---------------------------------------------------------------------------------------------------- inboxProbeSourceOf

export function inboxProbeSourceOfCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  /** A reader that counts its calls, and answers `rows`. */
  const reader = (rows: ProbeRowsFact) => { const calls = { n: 0 }; return { calls, read: (): ProbeRowsFact => { calls.n++; return rows; } }; };
  const active = { kind: 'state', state: 'active' } as const;
  return {
    'an active generation reads the round once and answers from its rows': () => {
      const r = reader(ROUND_ROWS('spot'));
      expect(m.inboxProbeSourceOf(active, r.read)).toEqual({ kind: 'measured', value: { roundId: 'r-7', kind: 'spot', questions: 3, askedAt: 4_000 } });
      expect(r.calls.n).toBe(1);
    },
    'an active generation with no rows answers none, after one read': () => {
      const r = reader({ ok: true, rows: [] });
      expect(m.inboxProbeSourceOf(active, r.read)).toEqual({ kind: 'measured', value: 'none' });
      expect(r.calls.n).toBe(1);
    },
    'an active generation whose rows could not be read is unmeasured with the reader\'s detail': () => {
      const r = reader({ ok: false, detail: 'continuity_probes read failed' });
      expect(m.inboxProbeSourceOf(active, r.read)).toEqual({ kind: 'unmeasured', why: 'continuity_probes read failed' });
      expect(r.calls.n).toBe(1);
    },
    'any other state answers none and never calls the reader': () => {
      for (const state of GENERATION_STATES.filter((s) => s !== 'active')) {
        const r = reader(ROUND_ROWS());
        expect(m.inboxProbeSourceOf({ kind: 'state', state }, r.read), state).toEqual({ kind: 'measured', value: 'none' });
        expect(r.calls.n, state).toBe(0);
      }
    },
    'no live generation answers none and never calls the reader': () => {
      const r = reader(ROUND_ROWS());
      expect(m.inboxProbeSourceOf({ kind: 'none' }, r.read)).toEqual({ kind: 'measured', value: 'none' });
      expect(r.calls.n).toBe(0);
    },
    'an unmeasured generation answers unmeasured with its reason and never calls the reader': () => {
      const r = reader(ROUND_ROWS());
      expect(m.inboxProbeSourceOf({ kind: 'unmeasured', why: 'the generations could not be read' }, r.read))
        .toEqual({ kind: 'unmeasured', why: 'the generations could not be read' });
      expect(r.calls.n).toBe(0);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- inboxOrder

const probeRow = (over: Partial<InboxRow> = {}): InboxRow => ({
  kind: 'probe-round', key: 'probe-round:r1', band: 'probe', at: 500, due: NONE, door: 'probe', roundId: 'r1', roundKind: 'compaction', questions: 3, ...over,
} as InboxRow);
const msgRow = (id: number, at = 1000 + id, over: Partial<InboxRow> = {}): InboxRow => ({
  kind: 'operator-message', key: `operator-message:${id}`, band: 'operator', at, due: NONE, door: 'messages', messageId: id, term: 1,
  state: 'delivered', cut: false, ...over,
} as InboxRow);
/** A row of a kind W1 does not know, in a band it may not serve yet (built by casting, as W2 and W3's rows will arrive). */
const otherRow = (kind: string, band: string, key: string, at: number, due: InboxRow['due'] = NONE): InboxRow =>
  ({ kind, key, band, at, due, door: 'other' }) as unknown as InboxRow;

export function inboxOrderCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  const before = (a: InboxRow, b: InboxRow, why: string): void => {
    expect(Math.sign(m.inboxOrder(a, b)), `${why}: a before b`).toBe(-1);
    expect(Math.sign(m.inboxOrder(b, a)), `${why}: b after a`).toBe(1);
  };
  return {
    'every band is ranked ahead of the next, whatever the times': () => {
      const rows = [
        probeRow({ at: 9000 }), msgRow(1, 9000),
        otherRow('deadline-row', 'deadline', 'd:1', 9000, { kind: 'by', at: 9000 }),
        otherRow('move-row', 'moves', 'm:1', 1), otherRow('background-row', 'background', 'b:1', 1),
      ];
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) before(rows[i]!, rows[j]!, `${rows[i]!.band} then ${rows[j]!.band}`);
    },
    'a sort of every band at once is the bands in rank order': () => {
      const rows = [
        otherRow('background-row', 'background', 'b:1', 1), otherRow('move-row', 'moves', 'm:1', 2), msgRow(1, 3), probeRow({ at: 4 }),
        otherRow('deadline-row', 'deadline', 'd:1', 5, { kind: 'by', at: 6 }),
      ];
      expect([...rows].sort(m.inboxOrder).map((r) => r.band)).toEqual(['probe', 'operator', 'deadline', 'moves', 'background']);
    },
    'in the operator band: by time, then by message id': () => {
      before(msgRow(9, 100), msgRow(1, 200), 'the earlier time first, though its id is higher');
      before(msgRow(1, 100), msgRow(2, 100), 'a tie by the lower id');
      expect(m.inboxOrder(msgRow(4, 100), msgRow(4, 100))).toBe(0);
    },
    'in the operator band, a row that is no message (a command) comes ahead of every message': () => {
      before(otherRow('operator-command', 'operator', 'operator-command:1', 900), msgRow(1, 100), 'a command, though later');
      before(otherRow('operator-command', 'operator', 'operator-command:1', 100), otherRow('operator-command', 'operator', 'operator-command:2', 200), 'commands by time');
      before(otherRow('operator-command', 'operator', 'operator-command:1', 100), otherRow('operator-command', 'operator', 'operator-command:2', 100), 'commands by key on a tie');
    },
    'in the deadline band: by the deadline, then by time; no deadline last': () => {
      const d = (key: string, at: number, due: number | null) => otherRow('deadline-row', 'deadline', key, at, due === null ? NONE : { kind: 'by', at: due });
      before(d('d:2', 900, 100), d('d:1', 100, 200), 'the earlier deadline, though it arrived later');
      before(d('d:1', 100, 500), d('d:2', 200, 500), 'a tie on the deadline by time');
      before(d('d:2', 100, 500), d('d:1', 200, 500), 'a tie on the deadline by time, not by key');
      before(d('d:2', 900, 100), d('d:1', 100, null), 'a deadline before none');
      before(d('d:1', 100, null), d('d:2', 200, null), 'no deadline on both: by time');
    },
    'in the moves and background bands: by time, then by key': () => {
      for (const band of ['moves', 'background']) {
        before(otherRow('x', band, 'x:9', 1), otherRow('x', band, 'x:1', 2), `${band} by time`);
        before(otherRow('x', band, 'x:1', 5), otherRow('x', band, 'x:2', 5), `${band} by key on a tie`);
        expect(m.inboxOrder(otherRow('x', band, 'x:1', 5), otherRow('x', band, 'x:1', 5))).toBe(0);
      }
    },
    'a row of a kind this build does not know still sorts by its band': () => {
      before(msgRow(1, 9000), otherRow('future-kind', 'moves', 'f:1', 1), 'an unknown kind in moves after band 1');
      before(otherRow('future-kind', 'moves', 'f:1', 1), otherRow('future-kind', 'background', 'f:0', 0), 'moves before background');
      before(probeRow({ at: 9000 }), otherRow('future-kind', 'deadline', 'f:1', 1, { kind: 'by', at: 1 }), 'a probe round first of all');
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- rowNudgeOf

export function rowNudgeOfCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  return {
    'a message has its own nudge': () => { expect(m.rowNudgeOf(msgRow(1))).toBe('message-nudge'); },
    "a round's nudge follows its kind: start the renewal feed, spot the spot-probe notice, compaction none": () => {
      expect(m.rowNudgeOf(probeRow({ roundKind: 'start' } as Partial<InboxRow>))).toBe('renewal-feed');
      expect(m.rowNudgeOf(probeRow({ roundKind: 'spot' } as Partial<InboxRow>))).toBe('spot-probe-notice');
      expect(m.rowNudgeOf(probeRow({ roundKind: 'compaction' } as Partial<InboxRow>))).toBe('none');
    },
    'a row of a kind this build does not know declares none, so the wake covers it': () => {
      expect(m.rowNudgeOf(otherRow('future-kind', 'moves', 'f:1', 1))).toBe('none');
    },
  };
}

// ----------------------------------------------------------------------------------------------------- readCeilingVerdict

const counted = (count: number, oldestAt: number | 'none' = NOW - 60_000, lastRefusalAt: number | 'none' = 'none') =>
  ({ count, oldestAt, lastRefusalAt });

export function readCeilingVerdictCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  const refuse = (door: Parameters<InboxDecidersModule['readCeilingVerdict']>[0], c: ReturnType<typeof counted>) => {
    const v = m.readCeilingVerdict(door, c, NOW);
    if (v.kind !== 'refuse') throw new Error(`${door} ${c.count}: allowed`);
    return v;
  };
  return {
    'under, at and over each door\'s own ceiling': () => {
      for (const door of READ_DOORS) {
        const limit = READ_CEILINGS[door].perHour;
        expect(m.readCeilingVerdict(door, counted(0, 'none'), NOW), `${door} 0`).toEqual({ kind: 'allow' });
        expect(m.readCeilingVerdict(door, counted(1), NOW), `${door} 1`).toEqual({ kind: 'allow' });
        expect(m.readCeilingVerdict(door, counted(limit - 1), NOW), `${door} under`).toEqual({ kind: 'allow' });
        expect(m.readCeilingVerdict(door, counted(limit), NOW).kind, `${door} at`).toBe('refuse');
        expect(m.readCeilingVerdict(door, counted(limit + 1), NOW).kind, `${door} over`).toBe('refuse');
        expect(m.readCeilingVerdict(door, counted(limit * 10), NOW).kind, `${door} far over`).toBe('refuse');
      }
    },
    'a door is held to its own ceiling, not another\'s': () => {
      expect(m.readCeilingVerdict('inbox', counted(READ_CEILINGS.messages.perHour), NOW).kind).toBe('allow');
      expect(m.readCeilingVerdict('history', counted(READ_CEILINGS.history.perHour), NOW).kind).toBe('refuse');
      expect(m.readCeilingVerdict('messages', counted(READ_CEILINGS.history.perHour), NOW).kind).toBe('allow');
    },
    'retryAfterS is the seconds until the oldest counted line leaves the window, rounded up, at least one': () => {
      const limit = READ_CEILINGS.inbox.perHour;
      expect(refuse('inbox', counted(limit, NOW - WINDOW + 1500)).retryAfterS).toBe(2);
      expect(refuse('inbox', counted(limit, NOW - WINDOW + 1000)).retryAfterS).toBe(1);
      expect(refuse('inbox', counted(limit, NOW - WINDOW + 1)).retryAfterS).toBe(1);
      expect(refuse('inbox', counted(limit, NOW - WINDOW)).retryAfterS).toBe(1);
      expect(refuse('inbox', counted(limit, NOW - WINDOW - 5000)).retryAfterS).toBe(1);
      expect(refuse('inbox', counted(limit, NOW - 1000)).retryAfterS).toBe(3599);
      expect(refuse('inbox', counted(limit, NOW)).retryAfterS).toBe(3600);
      expect(refuse('inbox', counted(limit, NOW - 60_000)).retryAfterS).toBe(3540);
    },
    'writeLine: true with no refusal standing, false with one inside the window, true with one before it': () => {
      const limit = READ_CEILINGS.messages.perHour;
      expect(refuse('messages', counted(limit, NOW - 5000, 'none')).writeLine).toBe(true);
      expect(refuse('messages', counted(limit, NOW - 5000, NOW - 100)).writeLine).toBe(false);
      expect(refuse('messages', counted(limit, NOW - 5000, NOW)).writeLine).toBe(false);
      expect(refuse('messages', counted(limit, NOW - 5000, NOW - WINDOW + 1)).writeLine).toBe(false);
      expect(refuse('messages', counted(limit, NOW - 5000, NOW - WINDOW)).writeLine).toBe(false);
      expect(refuse('messages', counted(limit, NOW - 5000, NOW - WINDOW - 1)).writeLine).toBe(true);
    },
    'an oldest time of none beside a count is a reader fault: it refuses for the whole window, never allows': () => {
      for (const door of READ_DOORS) {
        for (const count of [1, 2, READ_CEILINGS[door].perHour - 1, READ_CEILINGS[door].perHour]) {
          const v = refuse(door, counted(count, 'none'));
          expect([v.retryAfterS, v.writeLine], `${door} ${count}`).toEqual([WINDOW / 1000, true]);
        }
      }
      expect(refuse('inbox', counted(5, 'none', NOW - 10)).writeLine).toBe(false);
    },
  };
}

// ---------------------------------------------------------------------------------------------------- acknowledgeVerdict

export function acknowledgeVerdictCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  return {
    'a message not yet settled is settled, in every state before it': () => {
      for (const state of MESSAGE_STATES.filter((s) => s !== 'settled' && s !== 'spent')) {
        expect(m.acknowledgeVerdict({ state }), state).toEqual({ kind: 'settle' });
      }
    },
    'a message already settled or spent is already, with its state': () => {
      expect(m.acknowledgeVerdict({ state: 'settled' })).toEqual({ kind: 'already', state: 'settled' });
      expect(m.acknowledgeVerdict({ state: 'spent' })).toEqual({ kind: 'already', state: 'spent' });
    },
    'a state read as unknown is still unsettled: the Overlord may settle it': () => {
      expect(m.acknowledgeVerdict({ state: 'unknown' })).toEqual({ kind: 'settle' });
    },
    'an id that is no message is absent': () => {
      expect(m.acknowledgeVerdict('absent')).toEqual({ kind: 'absent' });
    },
  };
}

// ------------------------------------------------------------------------------------------------------- inboxWakeVerdict

const PASS: GateVerdict = { kind: 'pass' };
const refusal = (word: GateWord): GateVerdict => ({ kind: 'refuse', word, detail: 'd', step: '2', record: null, why: null });
const GATE_WORDS: Record<GateWord, true> = {
  'not-the-overlord': true, unavailable: true, 'registry-unmeasurable': true, renewing: true, 'capability-missing': true,
  'authority-rolled-back': true, 'overlord-off': true, 'stale-designation': true, 'launch-profile-unmet': true,
  'stale-generation': true, unwitnessed: true, unmeasured: true, 'card-unread': true, 'rung-below': true,
};
export const GATE_WORD_LIST = Object.keys(GATE_WORDS) as GateWord[];
const served = (rows: readonly InboxRow[], behind: InboxBehind = NONE): InboxComposed => ({ kind: 'served', rows, behind });
const compactionRound = probeRow({ roundKind: 'compaction' } as Partial<InboxRow>);

type WakeInput = Parameters<InboxDecidersModule['inboxWakeVerdict']>[0];
const ready = (over: Partial<WakeInput> = {}): WakeInput => ({
  designated: true, gate: PASS, mailDisabled: 'absent', outstanding: false, composed: served([compactionRound]), woken: new Set(), ...over,
});

export function inboxWakeVerdictCases(m: InboxDecidersModule): Record<string, SuiteCase> {
  const hold = (i: WakeInput, why: string, label: string): void => { expect(m.inboxWakeVerdict(i), label).toEqual({ kind: 'hold', why }); };
  return {
    'every hold standing answers not-designated, then each is lifted in turn, in the plan\'s order': () => {
      const woken = new Set([compactionRound.key]);
      let i: WakeInput = {
        designated: false, gate: 'not-asked', mailDisabled: 'standing', outstanding: true,
        composed: { kind: 'unmeasured', source: 'probe', why: 'x' }, woken,
      };
      hold(i, 'not-designated', 'nothing lifted');
      i = { ...i, designated: true, gate: refusal('overlord-off') };
      hold(i, 'overlord-off', 'designated');
      i = { ...i, gate: PASS };
      hold(i, 'mail-disabled', 'the gate passes');
      i = { ...i, mailDisabled: 'unmeasured' };
      hold(i, 'mail-disabled-unmeasured', 'mail-disabled unreadable');
      i = { ...i, mailDisabled: 'absent' };
      hold(i, 'outstanding', 'mail not stopped');
      i = { ...i, outstanding: false };
      hold(i, 'rows-unmeasured', 'nothing outstanding');
      i = { ...i, composed: served([compactionRound]) };
      hold(i, 'nothing-new', 'rows readable, the round already woken');
      expect(m.inboxWakeVerdict({ ...i, woken: new Set() }).kind, 'the round is new').toBe('send');
    },
    'not designated holds whatever the gate says, and is not a gate word': () => {
      hold(ready({ designated: false, gate: 'not-asked' }), 'not-designated', 'not asked');
      hold(ready({ designated: false, gate: PASS }), 'not-designated', 'a pass is not designation');
      hold(ready({ designated: false, gate: refusal('renewing') }), 'not-designated', 'a refusal');
    },
    'each of the gate\'s refusal words is a hold of that word, ahead of every hold after it': () => {
      for (const word of GATE_WORD_LIST) {
        hold(ready({ gate: refusal(word) }), word, word);
        hold(ready({ gate: refusal(word), mailDisabled: 'standing', outstanding: true, composed: { kind: 'unmeasured', source: 'messages', why: 'x' } }), word, `${word} first`);
      }
    },
    'a gate verdict that cannot occur for the inbox row, or an unasked gate for a designated session, holds': () => {
      hold(ready({ gate: { kind: 'hook' } }), 'not-designated', 'hook');
      hold(ready({ gate: 'not-asked' }), 'unmeasured', 'not asked');
    },
    'mail stopped, standing or unreadable, holds; so does a wake undelivered, and unreadable rows': () => {
      hold(ready({ mailDisabled: 'standing' }), 'mail-disabled', 'standing');
      hold(ready({ mailDisabled: 'unmeasured' }), 'mail-disabled-unmeasured', 'unmeasured');
      hold(ready({ outstanding: true }), 'outstanding', 'outstanding');
      hold(ready({ mailDisabled: 'standing', outstanding: true }), 'mail-disabled', 'mail first');
      hold(ready({ composed: { kind: 'unmeasured', source: 'messages', why: 'x' } }), 'rows-unmeasured', 'rows');
    },
    'a compaction round not yet woken sends, with its key, its count and no deadline': () => {
      expect(m.inboxWakeVerdict(ready())).toEqual({ kind: 'send', body: { keys: ['probe-round:r1'], waiting: 1, firstDue: NONE } });
    },
    'the same round already woken holds nothing-new': () => {
      hold(ready({ woken: new Set(['probe-round:r1']) }), 'nothing-new', 'woken');
      expect(m.inboxWakeVerdict(ready({ woken: new Set(['probe-round:other']) })).kind).toBe('send');
    },
    'a spot round alone, a start round alone and a message alone each hold nothing-new': () => {
      hold(ready({ composed: served([probeRow({ roundKind: 'spot' } as Partial<InboxRow>)]) }), 'nothing-new', 'spot');
      hold(ready({ composed: served([probeRow({ roundKind: 'start' } as Partial<InboxRow>)]) }), 'nothing-new', 'start');
      hold(ready({ composed: served([msgRow(1)]) }), 'nothing-new', 'message');
      hold(ready({ composed: served([]) }), 'nothing-new', 'no rows');
    },
    'a row with no nudge of its own among rows that have one sends, and the body counts them all': () => {
      const v = m.inboxWakeVerdict(ready({ composed: served([msgRow(1), compactionRound, probeRow({ key: 'probe-round:r2', roundKind: 'spot' } as Partial<InboxRow>)]) }));
      expect(v).toEqual({ kind: 'send', body: { keys: ['operator-message:1', 'probe-round:r1', 'probe-round:r2'], waiting: 3, firstDue: NONE } });
    },
    'the body counts the messages behind a round and the rows past a page': () => {
      const behind = ready({ composed: served([compactionRound], { kind: 'probe-first', count: 4 }) });
      expect(m.inboxWakeVerdict(behind)).toEqual({ kind: 'send', body: { keys: ['probe-round:r1'], waiting: 5, firstDue: NONE } });
      const paged = ready({ composed: served([compactionRound], { kind: 'page', count: 7 }) });
      expect(m.inboxWakeVerdict(paged)).toEqual({ kind: 'send', body: { keys: ['probe-round:r1'], waiting: 8, firstDue: NONE } });
    },
    'the first deadline is the earliest among the rows that carry one': () => {
      const dl = (key: string, at: number) => otherRow('deadline-row', 'deadline', key, 1, { kind: 'by', at });
      const v = m.inboxWakeVerdict(ready({ composed: served([compactionRound, dl('d:1', 900), dl('d:2', 300), dl('d:3', 600), msgRow(1)]) }));
      expect(v).toMatchObject({ kind: 'send', body: { firstDue: { kind: 'by', at: 300 }, waiting: 5 } });
      const none = m.inboxWakeVerdict(ready());
      expect(none).toMatchObject({ kind: 'send', body: { firstDue: NONE } });
    },
    'a row of a kind this build does not know, with no nudge, wakes once and then holds': () => {
      const unknown = otherRow('future-kind', 'moves', 'future-kind:1', 1);
      const first = m.inboxWakeVerdict(ready({ composed: served([unknown]) }));
      expect(first).toMatchObject({ kind: 'send', body: { keys: ['future-kind:1'], waiting: 1 } });
      hold(ready({ composed: served([unknown]), woken: new Set(['future-kind:1']) }), 'nothing-new', 'woken');
    },
  };
}


// ----------------------------------------------------------------------------------------------------------- the mutants

const PARSE_MESSAGE_ID_SET: MutantSet<InboxVocabModule> = {
  modulePath: L0,
  mutants: [
    { id: 'P1 leading zeros and zero allowed', old: '!/^[1-9][0-9]*$/.test(raw)', new: '!/^[0-9]+$/.test(raw)' },
    { id: 'P2 the start unanchored', old: '!/^[1-9][0-9]*$/.test(raw)', new: '!/[1-9][0-9]*$/.test(raw)' },
    { id: 'P3 the end unanchored', old: '!/^[1-9][0-9]*$/.test(raw)', new: '!/^[1-9][0-9]*/.test(raw)' },
    { id: 'P4 a sign allowed', old: '!/^[1-9][0-9]*$/.test(raw)', new: '!/^[+-]?[1-9][0-9]*$/.test(raw)' },
    { id: 'P5 the safe-integer bound dropped', old: "  if (!Number.isSafeInteger(id)) return { ok: false, detail: 'the id is past the largest whole number the server reads' };\n", new: '' },
    { id: 'P6 integers, not safe integers', old: 'if (!Number.isSafeInteger(id))', new: 'if (!Number.isInteger(id))' },
    { id: 'P7 a non-string coerced', old: "typeof raw !== 'string' || ", new: '' },
    { id: 'P8 the refusal echoes its input', old: "detail: 'the id is not a positive whole number in plain digits' }", new: 'detail: `the id ${String(raw)} is not a positive whole number` }' },
    { id: 'P9 the refusal has no detail', old: "detail: 'the id is not a positive whole number in plain digits' }", new: "detail: '' }" },
    { id: 'P10 the id is not the number', old: 'return { ok: true, id };', new: 'return { ok: true, id: id + 1 };' },
  ],
  suite: parseMessageIdCases,
};

const READ_WAKE_BODY_SET: MutantSet<InboxVocabModule> = {
  modulePath: L0,
  mutants: [
    { id: 'R1 the header unchecked', old: '  if (lines[0] !== WAKE_BODY_HEAD) return refused;\n', new: '' },
    { id: 'R2 a trailing newline refused', old: "  if (lines[lines.length - 1] === '') lines.pop();\n", new: '' },
    { id: 'R3 every trailing newline dropped', old: "if (lines[lines.length - 1] === '') lines.pop();", new: "while (lines[lines.length - 1] === '') lines.pop();" },
    { id: 'R4 a repeated waiting accepted', old: '      if (waiting !== null) return refused;\n', new: '' },
    { id: 'R5 a repeated first-due accepted', old: '      if (firstDue !== null) return refused;\n', new: '' },
    { id: 'R6 a repeated key accepted', old: '!KEY_SHAPE.test(value) || keys.includes(value)', new: '!KEY_SHAPE.test(value)' },
    { id: 'R7 a key unchecked', old: '!KEY_SHAPE.test(value) || keys.includes(value)', new: 'keys.includes(value)' },
    { id: 'R8 a delete character in a key', old: '/^[^\\s\\u0000-\\u001f\\u007f]+$/', new: '/^[^\\s\\u0000-\\u001f]+$/' },
    { id: 'R9 a control character in a key', old: '/^[^\\s\\u0000-\\u001f\\u007f]+$/', new: '/^[^\\s\\u007f]+$/' },
    { id: 'R10 a space in a key', old: '/^[^\\s\\u0000-\\u001f\\u007f]+$/', new: '/^[^\\u0000-\\u001f\\u007f]+$/' },
    { id: 'R11 an empty key', old: '/^[^\\s\\u0000-\\u001f\\u007f]+$/', new: '/^[^\\s\\u0000-\\u001f\\u007f]*$/' },
    { id: 'R12 a count below its keys', old: 'waiting === null || firstDue === null || waiting < keys.length', new: 'waiting === null || firstDue === null' },
    { id: 'R13 a missing waiting', old: 'waiting === null || firstDue === null || waiting < keys.length', new: 'firstDue === null || waiting! < keys.length' },
    { id: 'R14 a missing first-due', old: 'waiting === null || firstDue === null || waiting < keys.length', new: 'waiting === null || waiting < keys.length' },
    { id: 'R15 a leading zero in a count', old: '/^(?:0|[1-9][0-9]*)$/', new: '/^[0-9]+$/' },
    { id: 'R16 a count unanchored', old: '/^(?:0|[1-9][0-9]*)$/', new: '/(?:0|[1-9][0-9]*)/' },
    { id: 'R17 a count past the safe integers', old: 'return Number.isSafeInteger(n) ? n : null;', new: 'return n;' },
    { id: 'R18 an unknown line accepted', old: '    } else return refused;\n  }\n  if (waiting === null', new: '    }\n  }\n  if (waiting === null' },
    { id: 'R19 an unreadable waiting accepted', old: '      if (waiting === null) return refused;\n', new: '' },
    { id: 'R20 an unreadable deadline time accepted', old: '        if (when === null) return refused;\n', new: '' },
    { id: 'R21 none by prefix', old: "if (value === 'none') firstDue", new: "if (value.startsWith('none')) firstDue" },
    { id: 'R22 a key dropped', old: '      keys.push(value);\n', new: '' },
    { id: 'R23 the deadline read as none', old: "firstDue = { kind: 'by', at: when };", new: "firstDue = { kind: 'none' };" },
    { id: 'R24 the render shifts the deadline', old: '`by ${b.firstDue.at}`', new: '`by ${b.firstDue.at + 1}`' },
    { id: 'R25 the render counts the keys', old: '`waiting: ${b.waiting}`', new: '`waiting: ${b.keys.length}`' },
    { id: 'R26 the render drops the key prefix', old: '`key: ${k}`', new: '`${k}`' },
    { id: 'R27 the render ignores the deadline', old: "const due = b.firstDue.kind === 'by' ? `by ${b.firstDue.at}` : 'none';", new: "const due = 'none';" },
  ],
  suite: readInboxWakeBodyCases,
};

const RENDER_WAKE_LINE_SET: MutantSet<InboxVocabModule> = {
  modulePath: L0,
  mutants: [
    { id: 'W1 a deadline at now is not lapsed', old: 'due.at <= now', new: 'due.at < now' },
    { id: 'W2 the time left rounded down', old: 'Math.ceil((due.at - now) / 1000)', new: 'Math.floor((due.at - now) / 1000)' },
    { id: 'W3 the time left reversed', old: '(due.at - now) / 1000', new: '(now - due.at) / 1000' },
    { id: 'W4 the time left in milliseconds', old: 'Math.ceil((due.at - now) / 1000)', new: 'Math.ceil(due.at - now)' },
    { id: 'W5 the codec refusal unhandled', old: "  if (!b.ok) return `${MAIL_NUDGE_HEAD} Something waits in your inbox: ${INBOX_DOOR_TAIL}`;\n", new: '' },
    { id: 'W6 the refusal names a count', old: 'Something waits in your inbox:', new: '0 waiting in your inbox:' },
    { id: 'W7 the deadline clause never written', old: "if (due.kind === 'by') {", new: "if (false) {" },
    { id: 'W8 the clause for every body', old: "if (due.kind === 'by') {", new: 'if (true) {' },
    { id: 'W9 the key count, not the waiting count', old: '${b.body.waiting} waiting', new: '${b.body.keys.length} waiting' },
    { id: 'W10 a lapsed deadline said as time left', old: "due.at <= now ? ', the first has lapsed' :", new: 'false ? "" :' },
    { id: 'W11 the head dropped', old: '`${MAIL_NUDGE_HEAD} ${b.body.waiting} waiting', new: '`${b.body.waiting} waiting' },
    { id: 'W12 the door dropped', old: '${clause}: ${INBOX_DOOR_TAIL}`', new: '${clause}.`' },
  ],
  suite: renderInboxWakeLineCases,
};

const COMPOSE_INBOX_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'C1 a round is not served alone', old: "if (s.probe.value !== 'none') {", new: 'if (false) {' },
    { id: 'C2 band 1 served behind an open round', old: "return { kind: 'served', rows: [probeRowOf(s.probe.value)], behind };", new: "return { kind: 'served', rows: [probeRowOf(s.probe.value), ...messages], behind };" },
    { id: 'C3 the count behind miscounted', old: "{ kind: 'probe-first', count: messages.length }", new: "{ kind: 'probe-first', count: messages.length + 1 }" },
    { id: 'C4 nothing behind a round still counted', old: 'messages.length > 0 ? { kind', new: 'true ? { kind' },
    { id: 'C5 messages sorted by key text', old: '.sort(inboxOrder)', new: '.sort((a, b) => (a.key < b.key ? -1 : 1))' },
    { id: 'C6 messages not sorted', old: '.sort(inboxOrder)', new: '.sort(() => 0)' },
    { id: 'C7 a page of one more', old: 'messages.slice(0, INBOX_PAGE_ROWS)', new: 'messages.slice(0, INBOX_PAGE_ROWS + 1)' },
    { id: 'C8 an exact page counted as cut', old: 'past > 0 ?', new: 'past >= 0 ?' },
    { id: 'C9 the rows past the page miscounted', old: 'const past = messages.length - INBOX_PAGE_ROWS;', new: 'const past = messages.length - INBOX_PAGE_ROWS + 1;' },
    { id: 'C10 the page behind not counted', old: "{ kind: 'page', count: past }", new: "{ kind: 'page', count: 0 }" },
    { id: 'C11 an unmeasured probe unnoticed', old: "  if (s.probe.kind === 'unmeasured') return { kind: 'unmeasured', source: 'probe', why: s.probe.why };\n", new: '' },
    { id: 'C12 an unmeasured message source unnoticed', old: "  if (s.messages.kind === 'unmeasured') return { kind: 'unmeasured', source: 'messages', why: s.messages.why };\n", new: '' },
    { id: 'C13 the sources checked in the other order', old: "  if (s.probe.kind === 'unmeasured') return { kind: 'unmeasured', source: 'probe', why: s.probe.why };\n  if (s.messages.kind === 'unmeasured') return { kind: 'unmeasured', source: 'messages', why: s.messages.why };",
      new: "  if (s.messages.kind === 'unmeasured') return { kind: 'unmeasured', source: 'messages', why: s.messages.why };\n  if (s.probe.kind === 'unmeasured') return { kind: 'unmeasured', source: 'probe', why: s.probe.why };" },
    { id: 'C14 the wrong source named', old: "source: 'messages', why: s.messages.why", new: "source: 'probe', why: s.messages.why" },
    { id: 'C15 the reason dropped', old: "source: 'probe', why: s.probe.why", new: "source: 'probe', why: ''" },
    { id: 'C16 the round row keyed by its time', old: '`probe-round:${r.roundId}`', new: '`probe-round:${r.askedAt}`' },
    { id: 'C17 the round row timed zero', old: 'at: r.askedAt', new: 'at: 0' },
    { id: 'C18 the round kind lost', old: 'roundKind: r.kind', new: "roundKind: 'start'" },
    { id: 'C19 the question count lost', old: 'questions: r.questions', new: 'questions: 0' },
    { id: 'C20 the message row keyed by its time', old: '`operator-message:${f.id}`', new: '`operator-message:${f.at}`' },
    { id: 'C21 the message term lost', old: 'term: f.term', new: 'term: 1' },
    { id: 'C22 the message state lost', old: 'state: f.state', new: "state: 'delivered'" },
    { id: 'C23 the message cut lost', old: 'cut: f.cut', new: 'cut: false' },
    { id: 'C24 the message time lost', old: 'at: f.at, due', new: 'at: 0, due' },
    { id: 'C25 the message in the wrong band', old: "band: INBOX_KIND_MAP['operator-message'].band", new: "band: 'moves'" },
    { id: 'C26 the message served by the wrong door', old: "door: INBOX_KIND_MAP['operator-message'].door", new: "door: 'probe'" },
    { id: 'C27 the round in the wrong band', old: "band: INBOX_KIND_MAP['probe-round'].band", new: "band: 'operator'" },
    { id: 'C28 the messages sorted in place', old: 's.messages.value.map(messageRowOf).sort(', new: '(s.messages.value as MessageFacts[]).sort((a, b) => b.id - a.id).map(messageRowOf).sort(' },
  ],
  suite: composeInboxCases,
};

const INBOX_ORDER_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'O1 the bands reversed', old: 'bandRank(a.band) - bandRank(b.band)', new: 'bandRank(b.band) - bandRank(a.band)' },
    { id: 'O2 the band ignored', old: '  if (byBand !== 0) return byBand;\n', new: '' },
    { id: 'O3 the time reversed', old: 'const byTime = a.at - b.at;', new: 'const byTime = b.at - a.at;' },
    { id: 'O4 the ids reversed', old: 'a.messageId - b.messageId', new: 'b.messageId - a.messageId' },
    { id: 'O5 messages by id alone', old: 'return byTime !== 0 ? byTime : a.messageId - b.messageId;', new: 'return a.messageId - b.messageId;' },
    { id: 'O6 messages by time alone', old: 'return byTime !== 0 ? byTime : a.messageId - b.messageId;', new: 'return byTime;' },
    { id: 'O7 a command after a message', old: 'return aMessage ? 1 : -1;', new: 'return aMessage ? -1 : 1;' },
    { id: 'O8 a command not set apart', old: '    if (aMessage !== bMessage) return aMessage ? 1 : -1;\n', new: '' },
    { id: 'O9 no band 1 rule', old: "if (a.band === 'operator') {", new: 'if (false) {' },
    { id: 'O10 no deadline rule', old: "if (a.band === 'deadline') {", new: 'if (false) {' },
    { id: 'O11 no deadline before a deadline', old: "return a.due.kind === 'by' ? -1 : 1;", new: "return a.due.kind === 'by' ? 1 : -1;" },
    { id: 'O12 the deadlines reversed', old: 'return a.due.at - b.due.at;', new: 'return b.due.at - a.due.at;' },
    { id: 'O13 a tie of deadlines left a tie', old: "if (a.due.kind === 'by' && b.due.kind === 'by' && a.due.at !== b.due.at) return a.due.at - b.due.at;", new: "if (a.due.kind === 'by' && b.due.kind === 'by') return a.due.at - b.due.at;" },
    { id: 'O14 deadlines tied by key before time', old: 'a.due.at - b.due.at;\n    return byTime !== 0 ? byTime : byKey;', new: 'a.due.at - b.due.at;\n    return byKey;' },
    { id: 'O15 commands tied by time alone', old: 'b.messageId;\n    return byTime !== 0 ? byTime : byKey;', new: 'b.messageId;\n    return byTime;' },
    { id: 'O16 the other bands tied by time alone', old: '  }\n  return byTime !== 0 ? byTime : byKey;\n}', new: '  }\n  return byTime;\n}' },
    { id: 'O17 the keys reversed', old: 'a.key < b.key ? -1 : a.key > b.key ? 1 : 0', new: 'a.key < b.key ? 1 : a.key > b.key ? -1 : 0' },
    { id: 'O18 a probe round not first', old: 'bandRank(a.band) - bandRank(b.band)', new: 'Math.max(bandRank(a.band), 1) - Math.max(bandRank(b.band), 1)' },
  ],
  suite: inboxOrderCases,
};

const INBOX_PROBE_SOURCE_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'P1 an unmeasured generation read as none', old: "  if (gen.kind === 'unmeasured') return { kind: 'unmeasured', why: gen.why };\n", new: '' },
    { id: 'P2 an unmeasured generation read as active', old: "if (gen.kind !== 'state' || gen.state !== 'active') return { kind: 'measured', value: 'none' };", new: "if (gen.kind === 'none') return { kind: 'measured', value: 'none' };" },
    { id: 'P3 any state reads the round', old: "gen.kind !== 'state' || gen.state !== 'active'", new: "gen.kind !== 'state'" },
    { id: 'P4 only a card or active state reads', old: "gen.state !== 'active'", new: "gen.state === 'degraded'" },
    { id: 'P5 the round asked for when rows are given', old: "  if (rows === 'not-read') return { kind: 'read-rows' };\n", new: '' },
    { id: 'P6 the round never asked for', old: "if (rows === 'not-read') return { kind: 'read-rows' };", new: "if (rows === 'not-read') return { kind: 'measured', value: 'none' };" },
    { id: 'P7 a failed read taken as no round', old: "  if (!rows.ok) return { kind: 'unmeasured', why: rows.detail };\n", new: '' },
    { id: 'P8 the failed read\'s reason dropped', old: 'why: rows.detail', new: "why: ''" },
    { id: 'P9 an empty round taken as unmeasured', old: "if (first === undefined) return { kind: 'measured', value: 'none' };", new: "if (first === undefined) return { kind: 'unmeasured', why: 'no rows' };" },
    { id: 'P10 the last row\'s id', old: 'const first = rows.rows[0];', new: 'const first = rows.rows[rows.rows.length - 1];' },
    { id: 'P11 the question count lost', old: 'questions: rows.rows.length', new: 'questions: 1' },
    { id: 'P12 the round\'s kind lost', old: 'kind: first.kind,', new: "kind: 'start'," },
    { id: 'P13 the time lost', old: 'askedAt: first.askedAt', new: 'askedAt: 0' },
    { id: 'P14 the id lost', old: 'roundId: first.roundId', new: "roundId: ''" },
  ],
  suite: inboxProbeSourceCases,
};

const INBOX_PROBE_SOURCE_OF_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'S1 the reader always called', old: "  return asked.kind === 'read-rows' ? inboxProbeSource(gen, readRows()) : asked;", new: "  const r = readRows();\n  return asked.kind === 'read-rows' ? inboxProbeSource(gen, r) : asked;" },
    { id: 'S2 the reader never called', old: 'inboxProbeSource(gen, readRows())', new: "inboxProbeSource(gen, { ok: true, rows: [] })" },
    { id: 'S3 the reader called twice', old: 'inboxProbeSource(gen, readRows())', new: '(readRows(), inboxProbeSource(gen, readRows()))' },
    { id: 'S4 the ask negated', old: "asked.kind === 'read-rows'", new: "asked.kind !== 'read-rows'" },
    { id: 'S5 the first answer dropped', old: ': asked;', new: ": { kind: 'measured', value: 'none' };" },
    { id: 'S6 the rows ignored', old: 'inboxProbeSource(gen, readRows())', new: '(readRows(), inboxProbeSource(gen, { ok: true, rows: [] }))' },
    { id: 'S7 the rows read before the ask', old: 'const asked = inboxProbeSource(gen, \'not-read\');', new: "readRows();\n  const asked = inboxProbeSource(gen, 'not-read');" },
    { id: 'S8 the reader result passed on as a failure', old: 'inboxProbeSource(gen, readRows())', new: "inboxProbeSource(gen, { ok: false, detail: String(readRows().ok) })" },
  ],
  suite: inboxProbeSourceOfCases,
};

const ROW_NUDGE_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'N1 a message has no nudge', old: 'if (r.kind === \'operator-message\') return MESSAGE_NUDGE;', new: "if (r.kind === 'operator-message') return 'none';" },
    { id: 'N2 a round has no nudge', old: 'return PROBE_ROUND_NUDGE[r.roundKind];', new: "return 'none';" },
    { id: 'N3 an unknown kind has a nudge', old: "  return 'none';\n}\n\nexport interface CeilingCount", new: '  return MESSAGE_NUDGE;\n}\n\nexport interface CeilingCount' },
    { id: 'N4 the message test negated', old: "if (r.kind === 'operator-message') return MESSAGE_NUDGE;", new: "if (r.kind !== 'operator-message') return MESSAGE_NUDGE;" },
    { id: 'N5 every other row a round', old: "if (r.kind === 'probe-round') return PROBE_ROUND_NUDGE", new: 'if (true) return PROBE_ROUND_NUDGE' },
  ],
  suite: rowNudgeOfCases,
};

const READ_CEILING_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'K1 count > perHour for >=', old: 'c.count < READ_CEILINGS[door].perHour', new: 'c.count <= READ_CEILINGS[door].perHour' },
    { id: 'K2 every door held to the inbox ceiling', old: 'READ_CEILINGS[door].perHour', new: 'READ_CEILINGS.inbox.perHour' },
    { id: 'K3 a retry of none', old: 'Math.max(1, Math.ceil(', new: 'Math.max(0, Math.ceil(' },
    { id: 'K4 the retry rounded down', old: 'Math.ceil((c.oldestAt', new: 'Math.floor((c.oldestAt' },
    { id: 'K5 the retry reversed', old: '(c.oldestAt + READ_CEILING_WINDOW_MS - now) / 1000', new: '(now - c.oldestAt) / 1000' },
    { id: 'K6 the retry in milliseconds', old: '(c.oldestAt + READ_CEILING_WINDOW_MS - now) / 1000', new: '(c.oldestAt + READ_CEILING_WINDOW_MS - now)' },
    { id: 'K7 a refusal at the window start counted outside it', old: 'c.lastRefusalAt < windowStart', new: 'c.lastRefusalAt <= windowStart' },
    { id: 'K8 a standing refusal never found', old: "c.lastRefusalAt === 'none' || c.lastRefusalAt < windowStart", new: 'c.lastRefusalAt < windowStart' },
    { id: 'K9 the line written inside the window again', old: "c.lastRefusalAt === 'none' || c.lastRefusalAt < windowStart", new: 'true' },
    { id: 'K10 the line never written', old: "c.lastRefusalAt === 'none' || c.lastRefusalAt < windowStart", new: 'false' },
    { id: 'K11 a refusal before the window counted standing', old: 'c.lastRefusalAt < windowStart', new: 'c.lastRefusalAt < now' },
    { id: 'K12 the window halved', old: 'const windowStart = now - READ_CEILING_WINDOW_MS;', new: 'const windowStart = now - READ_CEILING_WINDOW_MS / 2;' },
    { id: 'K13 allow on an oldest time of none', old: "return c.count > 0 ? { kind: 'refuse', retryAfterS: READ_CEILING_WINDOW_MS / 1000, writeLine } : { kind: 'allow' };", new: "return { kind: 'allow' };" },
    { id: 'K14 one line of a fault allowed', old: 'return c.count > 0 ? {', new: 'return c.count > 1 ? {' },
    { id: 'K15 the fault refused for a minute', old: 'retryAfterS: READ_CEILING_WINDOW_MS / 1000, writeLine }', new: 'retryAfterS: 60, writeLine }' },
    { id: 'K16 no fault arm', old: "if (c.oldestAt === 'none') {", new: 'if (false) {' },
    { id: 'K17 the fault never writes its line', old: 'retryAfterS: READ_CEILING_WINDOW_MS / 1000, writeLine }', new: 'retryAfterS: READ_CEILING_WINDOW_MS / 1000, writeLine: false }' },
    { id: 'K18 an empty hour refused', old: ': { kind: \'allow\' };\n  }', new: ": { kind: 'refuse', retryAfterS: 1, writeLine };\n  }" },
  ],
  suite: readCeilingVerdictCases,
};

const ACKNOWLEDGE_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'A1 an absent id settled', old: "  if (row === 'absent') return { kind: 'absent' };\n", new: '' },
    { id: 'A2 a settled message settled again', old: "row.state === 'settled' || ", new: '' },
    { id: 'A3 a spent message settled', old: " || row.state === 'spent'", new: '' },
    { id: 'A4 already always says settled', old: "{ kind: 'already', state: row.state }", new: "{ kind: 'already', state: 'settled' }" },
    { id: 'A5 an unsettled message already', old: "  return { kind: 'settle' };\n}", new: "  return { kind: 'already', state: row.state };\n}" },
    { id: 'A6 an unknown state already', old: "if (row.state === 'settled'", new: "if (row.state === 'unknown' || row.state === 'settled'" },
    { id: 'A7 an absent id already', old: "if (row === 'absent') return { kind: 'absent' };", new: "if (row === 'absent') return { kind: 'already', state: 'unknown' };" },
  ],
  suite: acknowledgeVerdictCases,
};

const WAKE_VERDICT_SET: MutantSet<InboxDecidersModule> = {
  modulePath: L1,
  mutants: [
    { id: 'V1 designation unchecked', old: "  if (!i.designated) return hold('not-designated');\n", new: '' },
    { id: 'V2 an unasked gate passes', old: "  if (i.gate === 'not-asked') return hold('unmeasured');\n", new: '' },
    { id: 'V3 the gate word dropped from the holds', old: "  if (i.gate.kind === 'refuse') return hold(i.gate.word);\n", new: '' },
    { id: 'V4 every refusal held as one word', old: 'return hold(i.gate.word);', new: "return hold('overlord-off');" },
    { id: 'V5 a hook verdict passes', old: "  if (i.gate.kind === 'hook') return hold('not-designated');\n", new: '' },
    { id: 'V6 a standing mail stop unchecked', old: "  if (i.mailDisabled === 'standing') return hold('mail-disabled');\n", new: '' },
    { id: 'V7 an unreadable mail stop unchecked', old: "  if (i.mailDisabled === 'unmeasured') return hold('mail-disabled-unmeasured');\n", new: '' },
    { id: 'V8 an unreadable mail stop held as standing', old: "return hold('mail-disabled-unmeasured');", new: "return hold('mail-disabled');" },
    { id: 'V9 an undelivered wake unchecked', old: "  if (i.outstanding) return hold('outstanding');\n", new: '' },
    { id: 'V10 unreadable rows unchecked', old: "  if (i.composed.kind === 'unmeasured') return hold('rows-unmeasured');\n", new: '' },
    { id: 'V11 an undelivered wake held ahead of designation', old: "  if (!i.designated) return hold('not-designated');\n", new: "  if (i.outstanding) return hold('outstanding');\n  if (!i.designated) return hold('not-designated');\n" },
    { id: 'V12 the mail stop held ahead of the gate', old: "  if (i.gate === 'not-asked') return hold('unmeasured');\n", new: "  if (i.mailDisabled === 'standing') return hold('mail-disabled');\n  if (i.gate === 'not-asked') return hold('unmeasured');\n" },
    { id: 'V13 woken for a row that has a nudge', old: "rowNudgeOf(r) === 'none' && ", new: "rowNudgeOf(r) !== 'message-nudge' && " },
    { id: 'V14 woken for the rows that have a nudge only', old: "rowNudgeOf(r) === 'none' && ", new: "rowNudgeOf(r) !== 'none' && " },
    { id: 'V15 a row already woken wakes again', old: ' && !i.woken.has(r.key)', new: '' },
    { id: 'V16 nothing new unchecked', old: "  if (!rows.some((r) => rowNudgeOf(r) === 'none' && !i.woken.has(r.key))) return hold('nothing-new');\n", new: '' },
    { id: 'V17 the rows behind not counted', old: 'waiting: rows.length + behind', new: 'waiting: rows.length' },
    { id: 'V18 the rows behind counted as one', old: ': i.composed.behind.count;', new: ': 1;' },
    { id: 'V19 the page behind not counted', old: "i.composed.behind.kind === 'none' ? 0 :", new: "i.composed.behind.kind !== 'probe-first' ? 0 :" },
    { id: 'V20 the latest deadline', old: 'Math.min(...dues)', new: 'Math.max(...dues)' },
    { id: 'V21 a deadline always', old: 'dues.length > 0 ?', new: 'true ?' },
    { id: 'V22 no deadline ever', old: 'dues.length > 0 ?', new: 'false ?' },
    { id: 'V23 a row with no deadline counted as one', old: "r.due.kind === 'by' ? [r.due.at] : []", new: '[r.due.at]' },
    { id: 'V24 the keys of the unnudged rows only', old: 'keys: rows.map((r) => r.key)', new: "keys: rows.filter((r) => rowNudgeOf(r) === 'none').map((r) => r.key)" },
    { id: 'V25 the keys left out', old: 'keys: rows.map((r) => r.key)', new: 'keys: []' },
    { id: 'V26 a hook verdict held as the gate word', old: "if (i.gate.kind === 'hook') return hold('not-designated');", new: "if (i.gate.kind === 'hook') return hold('unmeasured');" },
    { id: 'V27 an unasked gate held as not designated', old: "if (i.gate === 'not-asked') return hold('unmeasured');", new: "if (i.gate === 'not-asked') return hold('not-designated');" },
  ],
  suite: inboxWakeVerdictCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const OVERLORD_INBOX_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'shared/overlordInbox.ts#parseMessageId': PARSE_MESSAGE_ID_SET as MutantSet<never>,
  'shared/overlordInbox.ts#readInboxWakeBody': READ_WAKE_BODY_SET as MutantSet<never>,
  'shared/overlordInbox.ts#renderInboxWakeLine': RENDER_WAKE_LINE_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#composeInbox': COMPOSE_INBOX_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#inboxProbeSource': INBOX_PROBE_SOURCE_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#inboxProbeSourceOf': INBOX_PROBE_SOURCE_OF_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#inboxOrder': INBOX_ORDER_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#rowNudgeOf': ROW_NUDGE_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#readCeilingVerdict': READ_CEILING_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#acknowledgeVerdict': ACKNOWLEDGE_SET as MutantSet<never>,
  'server/src/coord/overlordInbox.ts#inboxWakeVerdict': WAKE_VERDICT_SET as MutantSet<never>,
};
