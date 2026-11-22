// The Overlord inbox's coalesced wake (Overlord W1, inbox piece, Task 4; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`,
// questions 7, 9 and 16; spec §6.8). Ring L4, context C5: the server's own lane, not a caller. Each tick (`FleetWatcher.sweepInboxWake`)
// it reads the facts, asks the L1 decider (`overlordInbox.ts#inboxWakeVerdict`) and acts on the answer: it decides nothing.
//
// The facts, each through its one reader: the designation (`CoordStore.designationRead`), the gate's verdict for the `inbox` row as a
// read (`overlordGateRun.ts#overlordReadGate`, the runner's own readers, no fence and no witness), `mail-disabled` from the tick's
// listing, an undelivered wake (`CoordStore.hasOutstandingMail`, which `queueSystemMail` asks too), and the rows the inbox door
// composes (`composeInbox` over the open probe round and `OperatorModelStore.unsettledFacts`, text-free). The send is
// `queueSystemMail`, the wake's one writer.
//
// It holds two things in memory and nothing in a table (question 9): `woken`, the keys its last wake covered, and `lastHold`, the
// hold word it last logged, so one `ccrc-server:` line is written when the word changes and never one a pass. A restart forgets
// both, so the first pass after a boot wakes once for whatever is waiting. It reads no read door and writes no ledger line; its
// mail and its log lines carry row keys, counts and words of the server, never a message's text or a probe's question.
import type { GateVerdict } from './overlordGate.js';
import { laneArmRowViewOf } from './laneArm.js';
import { callerGenerationOf } from './overlordGateRun.js';
import {
  composeInbox, inboxProbeSourceOf, inboxWakeVerdict, type InboxComposed, type ProbeRowsFact, type WakeHold,
} from './overlordInbox.js';
import type { WatcherCoordPort } from './ports.js';
import { queueSystemMail } from './rundefsTx.js';
import type { MarkerState } from '../../../shared/api.js';
import { CONTINUITY_LANE } from '../../../shared/lane-arm.js';
import { INBOX_WAKE_SENDER, INBOX_WAKE_SUBJECT, renderInboxWakeBody } from '../../../shared/overlordInbox.js';
import type { OperatorModelStore } from '../operatorModel/store.js';

const NO_STORE = 'the private store is not open';
const NOT_READ: InboxComposed = { kind: 'unmeasured', source: 'probe', why: 'no session is designated, so no row was read' };

/** The open round's rows cut to the fields the inbox may carry: ids, kind and time, never a question or what it expects. A failed or
 *  throwing read carries its detail. The inbox door and the wake read the round through this one function. */
export function openRoundFact(reads: Pick<WatcherCoordPort, 'openProbeRound'>, sessionId: string): ProbeRowsFact {
  try {
    const r = reads.openProbeRound(sessionId);
    return r.ok ? { ok: true, rows: r.rows.map((x) => ({ roundId: x.roundId, kind: x.kind, askedAt: x.askedAt })) } : { ok: false, detail: r.detail };
  } catch (err) { return { ok: false, detail: err instanceof Error ? err.message : String(err) }; }
}

export interface InboxWakePorts {
  readonly coord: WatcherCoordPort;
  /** The private store's text-free reader, or undefined on a server that never opened it (the rows read unmeasured). */
  readonly operatorModel: Pick<OperatorModelStore, 'unsettledFacts'> | undefined;
  /** The read gate (`overlordReadGate`, bound in `server.ts`), read at the pass: undefined until it is handed over, which holds. */
  readonly gate: () => ((sessionId: string, key: string) => Promise<GateVerdict>) | undefined;
  readonly log: (line: string) => void;
}

/** The tick's reading of the `mail-disabled` marker (`FleetReadModel.switches`): `set`, `clear`, or `unmeasurable` (a registry that could not be listed). */
export interface InboxWakeInput { readonly mailDisabled: MarkerState }

export function createInboxWakeLane(ports: InboxWakePorts): { pass(input: InboxWakeInput, now: number): Promise<void> } {
  // Whether the `continuity` row is live, for `effectiveGeneration`, as `server.ts` binds the gate's port.
  const continuityLive = (): boolean => laneArmRowViewOf(CONTINUITY_LANE, ports.coord.laneArmSetting(CONTINUITY_LANE)).live;
  let woken: ReadonlySet<string> = new Set();
  let lastHold: WakeHold | null = null;
  const holdWith = (why: WakeHold): void => {
    if (why !== lastHold) ports.log(`ccrc-server: the inbox wake holds: ${why}`);
    lastHold = why;
  };
  return {
    /** `now` is the tick's clock; the lane decides on nothing timed (the line's time left is read by the mail lane at typing). */
    async pass(input, _now) {
      const designation = ports.coord.designationRead();
      const designated = designation.kind === 'designated' ? designation.sessionId : null;
      const gateOf = ports.gate();
      const sessionId = designated ?? '';
      const gate: GateVerdict | 'not-asked' = designated === null || gateOf === undefined ? 'not-asked' : await gateOf(designated, 'inbox');
      const mailDisabled = input.mailDisabled === 'set' ? 'standing' : input.mailDisabled === 'clear' ? 'absent' : 'unmeasured';
      const outstanding = designated !== null && ports.coord.hasOutstandingMail(INBOX_WAKE_SENDER, null, sessionId, INBOX_WAKE_SUBJECT);
      // The rows are read only for a designated session: the decider holds `not-designated` first, and a box with no Overlord reads nothing.
      const composed: InboxComposed = designated === null ? NOT_READ : composeInbox({
        probe: inboxProbeSourceOf(
          callerGenerationOf({ generations: () => ports.coord.liveGenerations(), continuityLive }, sessionId, designation).generation,
          () => openRoundFact(ports.coord, sessionId)),
        messages: ports.operatorModel === undefined ? { kind: 'unmeasured', why: NO_STORE } : ports.operatorModel.unsettledFacts(),
      });
      const verdict = inboxWakeVerdict({ designated: designated !== null, gate, mailDisabled, outstanding, composed, woken });
      if (verdict.kind === 'hold') { holdWith(verdict.why); return; }
      const sent = queueSystemMail(ports.coord, null, {
        fromId: INBOX_WAKE_SENDER, toId: sessionId, runId: null, kind: 'status', subject: INBOX_WAKE_SUBJECT, body: renderInboxWakeBody(verdict.body),
      });
      if (!sent.queued) return;
      woken = new Set(verdict.body.keys);
      lastHold = null;
    },
  };
}
