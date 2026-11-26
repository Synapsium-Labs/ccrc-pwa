// A fixed line's settlement and its recovery (Overlord W1, inbox piece; review 3389 F1). A fixed line whose first delivery moves
// nothing but the ack (the wake, a spot-probe notice) is acked on its first delivery. When the process stops between `markDelivered`
// and that ack, the row stays outstanding and comes back as a replay: `fixedLineReplayOf` (L1, `coord/envelope.ts`) answers
// `ack-only` for it, and `finishFixedLineAck` (`operatorModel/nudgeLane.ts`) acks it without the line being typed again. Isolated
// state-transition assertions over a synthetic delivery writer: no process is stopped and no live delivery is made.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import * as envelope from '../src/coord/envelope.js';
import { fixedLineReplayOf, mailNudgeOf } from '../src/coord/envelope.js';
import { fixedLineReplayOfCases } from './sim/fixedLineMailSets.js';
import { finishFixedLineAck, settleNudge, type NudgeLaneDeps } from '../src/operatorModel/nudgeLane.js';
import { INBOX_WAKE_SUBJECT, renderInboxWakeBody } from '../../shared/overlordInbox.js';
import { operatorMessageSubject } from '../../shared/operatorMessages.js';
import { SPOT_PROBE_SUBJECT } from '../src/continuity/renewalFeed.js';

const OVERLORD = 'lane-a-project-a';
const designated = { kind: 'designated', sessionId: OVERLORD } as const;
const NOW = 1_800_000_000_000;
const wake = mailNudgeOf(OVERLORD, {
  fromId: 'operator', subject: INBOX_WAKE_SUBJECT,
  body: renderInboxWakeBody({ keys: ['probe-round:r1'], waiting: 1, firstDue: { kind: 'none' } }),
}, designated, NOW);
const spot = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT, body: 'b' }, designated, NOW);
const generic = mailNudgeOf(OVERLORD, { fromId: 'lane-b-project-a', subject: 'status', body: 'b' }, designated, NOW);
const message = mailNudgeOf(OVERLORD, { fromId: 'operator', subject: operatorMessageSubject(7) }, designated, NOW);

/** A delivery writer that is the one owner of a row's state: `outstanding` until an ack lands, then `acked`, and an ack of an acked
 *  row is refused as `already-acked`, the answer `CoordStore.markAcked` gives. Typed as the lane's own port, so a change to that
 *  answer is a type error here. */
function writer() {
  const state = new Map<number, 'outstanding' | 'acked'>();
  const acks: number[] = [];
  const warned: string[] = [];
  const coord: NudgeLaneDeps['coord'] = {
    // A fixed line moves no operator message, so nothing is stamped here.
    db: new DatabaseSync(':memory:'),
    markAcked(id: number) {
      acks.push(id);
      if (state.get(id) === 'acked') return { ok: false, why: 'already-acked', state: 'acked' };
      state.set(id, 'acked');
      return { ok: true, state: 'acked' };
    },
  };
  return { state, acks, warned, deps: { coord, now: NOW, warn: (l: string) => { warned.push(l); } } };
}

describe('fixedLineReplayOf: a fixed line delivered once and not acked is finished, never typed again', () => {
  for (const [name, run] of Object.entries(fixedLineReplayOfCases(envelope))) it(name, run);
  it('answers ack-only for a delivered wake too', () => {
    expect(wake.firstDelivery).toBe('none');
    expect(fixedLineReplayOf(wake, NOW - 1)).toBe('ack-only');
    expect(fixedLineReplayOf(wake, null)).toBe('type');
  });
});

describe('a fixed line\'s settlement and its recovery', () => {
  it('ordinary settlement: the first delivery is typed, then acked once, and the row is settled', () => {
    const w = writer();
    w.state.set(41, 'outstanding');
    expect(finishFixedLineAck(w.deps, { id: 41, deliveredAt: null }, wake)).toBe(false);   // the pass types the line
    settleNudge({ ...w.deps, operatorModel: undefined }, { id: 41, deliveredAt: null }, wake);
    expect(w.acks).toEqual([41]);
    expect(w.state.get(41)).toBe('acked');
    expect(w.warned).toEqual([]);
  });

  it('recovery: a row delivered once whose ack never landed is acked, and the pass types nothing', () => {
    const w = writer();
    w.state.set(42, 'outstanding');   // markDelivered landed, the process stopped before the ack
    expect(finishFixedLineAck(w.deps, { id: 42, deliveredAt: NOW - 60_000 }, wake)).toBe(true);
    expect(w.acks).toEqual([42]);
    expect(w.state.get(42)).toBe('acked');
    expect(w.warned).toEqual([]);
  });

  it('recovery is idempotent: a second finish of an already acked row is refused as already acked, logged, and changes nothing', () => {
    const w = writer();
    w.state.set(43, 'outstanding');
    expect(finishFixedLineAck(w.deps, { id: 43, deliveredAt: NOW - 60_000 }, spot)).toBe(true);
    expect(finishFixedLineAck(w.deps, { id: 43, deliveredAt: NOW - 60_000 }, spot)).toBe(true);
    expect(w.state.get(43)).toBe('acked');
    expect(w.acks).toEqual([43, 43]);
    expect(w.warned).toEqual(['ccrc-server: mail sweep: delivery 43: ack refused (already-acked)']);
  });

  it('a replayed generic nudge or operator message is left to the pass, which types it as before', () => {
    const w = writer();
    expect(finishFixedLineAck(w.deps, { id: 44, deliveredAt: NOW - 60_000 }, generic)).toBe(false);
    expect(finishFixedLineAck(w.deps, { id: 45, deliveredAt: NOW - 60_000 }, message)).toBe(false);
    expect(w.acks).toEqual([]);
  });

  it('a replay settles nothing through settleNudge: the recovery is finishFixedLineAck\'s, before the pass types', () => {
    const w = writer();
    settleNudge({ ...w.deps, operatorModel: undefined }, { id: 46, deliveredAt: NOW - 60_000 }, wake);
    expect(w.acks).toEqual([]);
  });
});
