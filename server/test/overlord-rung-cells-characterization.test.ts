// The rung cells' characterization (Overlord W2, the act catalogue, plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Task A1). Written green against `main` BEFORE the cells
// move from the ladder into the act catalogue (`shared/overlord.ts`), and kept after: it pins what `rungStep` answers for every
// W1 act kind at every rung and both door classes, the act kind every door row names, and what the gate order answers at every
// Overlord door row at every rung. Every expected value is written out here, never read from the table the move changes, so a
// move that changed an answer is a red case. A projection keeps the pass's added fields (the cell, the catalogue's Task A2) out
// of the pin: the answers are pinned, not the shape of a pass. It pins step 10's rung half; the ceiling half, which the move
// added, is pinned by the two cases derived from the door rows in `overlord-act-ceiling.test.ts` (no door of today reaches
// the count reader, and every door row answers as before through the read gate).
import { describe, expect, it } from 'vitest';
import { rungStep } from '../src/coord/overlordLadder.js';
import { overlordGate } from '../src/coord/overlordGate.js';
import { OVERLORD_DOORS, doorRow } from '../src/coord/overlordDoors.js';
import { passFacts } from './sim/gateSets.js';

type Act = Parameters<typeof rungStep>[2];
type Door = Parameters<typeof rungStep>[1];
type Rung = Parameters<typeof rungStep>[0];

const RUNGS_WRITTEN: readonly Rung[] = ['off', 'chat', 'advise', 'full'];
const DOORS_WRITTEN: readonly Door[] = ['other', 'card-probe-note'];

/** The pinned part of an answer: pass, or the word and the rung it names. */
const pin = (v: ReturnType<typeof rungStep>): { pass: true } | { pass: false; word: string; needs: unknown } =>
  (v.pass ? { pass: true } : { pass: false, word: v.word, needs: v.needs });
const PASS = { pass: true } as const;
const below = (needs: Rung) => ({ pass: false, word: 'rung-below', needs }) as const;

/** W1's four act kinds (the plan names three; D-8809 added the team link), each rung, each door class, as `main` answers. */
const EXPECTED: Readonly<Record<string, Readonly<Record<Rung, Readonly<Record<Door, ReturnType<typeof pin>>>>>>> = {
  read: { off: { other: below('chat'), 'card-probe-note': PASS }, chat: { other: PASS, 'card-probe-note': PASS },
    advise: { other: PASS, 'card-probe-note': PASS }, full: { other: PASS, 'card-probe-note': PASS } },
  'write-note': { off: { other: below('chat'), 'card-probe-note': PASS }, chat: { other: PASS, 'card-probe-note': PASS },
    advise: { other: PASS, 'card-probe-note': PASS }, full: { other: PASS, 'card-probe-note': PASS } },
  acknowledge: { off: { other: below('chat'), 'card-probe-note': PASS }, chat: { other: PASS, 'card-probe-note': PASS },
    advise: { other: PASS, 'card-probe-note': PASS }, full: { other: PASS, 'card-probe-note': PASS } },
  'link-team': { off: { other: below('full'), 'card-probe-note': PASS }, chat: { other: below('full'), 'card-probe-note': below('full') },
    advise: { other: below('full'), 'card-probe-note': below('full') }, full: { other: PASS, 'card-probe-note': PASS } },
};

/** Every door row's act kind, written out: `operator` for an operator door, which carries none. */
const DOOR_ACTS: Readonly<Record<string, string | null>> = {
  designate: 'operator', retire: 'operator', rebind: 'operator', restart: 'operator', designation: 'operator', model: 'operator',
  'account-set': 'operator', ladder: 'operator', readiness: 'operator', chat: 'operator', 'chat-earlier': 'operator',
  invariants: 'operator', rung: 'operator', pause: 'operator',
  'latch-clear': 'operator', witness: 'operator', 'restore-read': 'operator', 'restore-confirm': 'operator',
  'portfolio-rank': 'operator', 'goals-ratify': 'operator', 'private-names-read': 'operator', 'private-names-write': 'operator',
  card: 'read', 'card-record': 'read', 'notes-write': 'write-note', 'notes-read': 'read', handover: 'write-note',
  'probe-read': 'read', 'probe-answer': 'write-note', 'link-team': 'link-team', inbox: 'read', messages: 'read',
  acknowledge: 'acknowledge', history: 'read', sequence: 'read', board: 'read',
  'timer-set': null, 'timer-list': null, 'timer-cancel': null,
};

/** What the gate order answers at each Overlord door row at each effective rung, every other fact passing: `pass`, or the
 *  refusal's word and step. A start door reads no ladder, so its answer is one for every rung. */
const GATE_AT: Readonly<Record<string, string | Readonly<Record<Rung, string>>>> = {
  card: 'pass', 'card-record': 'pass', 'notes-write': 'pass', 'notes-read': 'pass', handover: 'pass', 'probe-read': 'pass',
  'probe-answer': 'pass',
  'link-team': { off: 'rung-below@10', chat: 'rung-below@10', advise: 'rung-below@10', full: 'pass' },
  inbox: { off: 'rung-below@10', chat: 'pass', advise: 'pass', full: 'pass' },
  messages: { off: 'rung-below@10', chat: 'pass', advise: 'pass', full: 'pass' },
  acknowledge: { off: 'rung-below@10', chat: 'pass', advise: 'pass', full: 'pass' },
  history: { off: 'rung-below@10', chat: 'pass', advise: 'pass', full: 'pass' },
  sequence: { off: 'rung-below@10', chat: 'pass', advise: 'pass', full: 'pass' },
  board: { off: 'rung-below@10', chat: 'pass', advise: 'pass', full: 'pass' },
  'timer-set': 'pass', 'timer-list': 'pass', 'timer-cancel': 'pass',
};

describe('the rung cells before and after the move (W2 act catalogue A1)', () => {
  it('rungStep answers every W1 act kind at every rung and both door classes as main does', () => {
    for (const act of Object.keys(EXPECTED)) for (const r of RUNGS_WRITTEN) for (const d of DOORS_WRITTEN) {
      expect(pin(rungStep(r, d, act as Act)), `${act} at ${r} by ${d}`).toEqual(EXPECTED[act]![r][d]);
    }
  });
  it('every door row names the act kind main gives it, and the table has no row this pin lacks', () => {
    expect(Object.keys(OVERLORD_DOORS).sort()).toEqual(Object.keys(DOOR_ACTS).sort());
    for (const [key, act] of Object.entries(DOOR_ACTS)) {
      const row = doorRow(key);
      expect(row.group === 'operator' ? 'operator' : row.act, key).toBe(act);
    }
  });
  it('the gate order answers every Overlord door row at every rung as main does (brief item 5: no door answer changes)', () => {
    const overlordKeys = Object.keys(OVERLORD_DOORS).filter((k) => OVERLORD_DOORS[k]!.group === 'overlord');
    expect(overlordKeys.sort()).toEqual(Object.keys(GATE_AT).sort());
    for (const key of overlordKeys) {
      const door = doorRow(key) as never;
      for (const r of RUNGS_WRITTEN) {
        const start = (OVERLORD_DOORS[key] as { ladderClass: string }).ladderClass === 'card-probe-note';
        const facts = start ? passFacts(door) : passFacts(door, { ladder: { kind: 'read', rung: { rung: r, operatorRung: 'full', binding: [], readBy: [] } } });
        const v = overlordGate(facts);
        const got = v.kind === 'refuse' ? `${v.word}@${v.step}` : v.kind;
        const want = GATE_AT[key]!;
        expect(got, `${key} at ${r}`).toBe(typeof want === 'string' ? want : want[r]);
      }
    }
  });
});
