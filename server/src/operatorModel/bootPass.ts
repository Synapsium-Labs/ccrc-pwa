// The Operator Model's boot pass (invariant I8; Overlord W1 private store plan, Task 6; context C11, ring L4). It re-derives
// what a crash can leave wrong, once, after both stores open and before the watcher starts: a `settled` row no citation
// proves (`bootSettlement`), and a recorded message whose nudge was never queued (`nudgeRecovery`). It decides nothing:
// the deciders (`./messages.ts`) answer, and it acts through `moveMessage` (actor `boot-pass`) and `queueSystemMail`. It
// carries no message text: counts and ids only. Time is the injected clock.
import { operatorMessageNudgeBody, operatorMessageSubject, OPERATOR_MESSAGE_SENDER } from '../../../shared/operatorMessages.js';
import { queueSystemMail } from '../coord/rundefsTx.js';
import type { WatcherCoordPort } from '../coord/ports.js';
import type { CoordStore } from '../coord/store.js';
import { bootSettlement, nudgeRecovery, type CitationRead } from './messages.js';
import type { OperatorModelStore } from './store.js';

export interface BootPassCounts {
  readonly kept: number; readonly unsettled: number; readonly unjudged: number;
  readonly linked: number; readonly queued: number; readonly waiting: number;
}

export interface BootPassDeps {
  readonly operatorModel: Pick<OperatorModelStore,
    'settledRows' | 'unnudged' | 'highestMessageId' | 'moveMessage' | 'messageSessionOf'>;
  readonly coord: WatcherCoordPort & Pick<CoordStore, 'highestOperatorMessageMail'>;
  /** W1 has no citing table: its adapter answers `not-applicable` (open question 9). */
  readonly citations: () => CitationRead;
  readonly now: () => number;
}

/** The W1 citation adapter. */
export const w1Citations = (): CitationRead => ({ kind: 'not-applicable' });

export function runOperatorModelBootPass(deps: BootPassDeps): { readonly counts: BootPassCounts; readonly lines: readonly string[] } {
  const c = { kept: 0, unsettled: 0, unjudged: 0, linked: 0, queued: 0, waiting: 0 };
  const lines: string[] = [];
  const { operatorModel: store, coord } = deps;

  const settled = store.settledRows();
  if (settled.kind === 'unmeasured') lines.push(`boot pass: settled rows unmeasured (${settled.why}); nothing re-derived`);
  else {
    const cites = deps.citations();
    for (const row of settled.value) {
      const verdict = bootSettlement(row, cites);
      if (verdict === 'keep') { c.kept++; continue; }
      if (verdict === 'unjudged') { c.unjudged++; continue; }
      const moved = store.moveMessage(row.id, 'unsettle', 'boot-pass', deps.now());
      if (moved.ok) c.unsettled++;
      else { c.unjudged++; lines.push(`boot pass: message ${row.id} not unsettled (${moved.error})`); }
    }
  }

  const unnudged = store.unnudged();
  if (unnudged.kind === 'unmeasured') lines.push(`boot pass: unnudged rows unmeasured (${unnudged.why}); nothing re-nudged`);
  else {
    for (const row of unnudged.value) {
      const owner = store.messageSessionOf(row.id);
      if (owner.kind === 'unmeasured' || owner.value === 'absent') { c.unjudged++; continue; }
      const subject = operatorMessageSubject(row.id);
      const found = coord.hasMailWithSubject(OPERATOR_MESSAGE_SENDER, null, owner.value.sessionId, subject);
      const verdict = nudgeRecovery(owner.value, found, coord.designationRead());
      if (verdict === 'unjudged') { c.unjudged++; continue; }
      if (verdict === 'wait') { c.waiting++; continue; }
      if (verdict === 'queue') {
        const q = queueSystemMail(coord, null, {
          fromId: OPERATOR_MESSAGE_SENDER, toId: owner.value.sessionId, runId: null, kind: 'status', subject, body: operatorMessageNudgeBody(row.id),
        });
        if (!q.queued) { c.unjudged++; lines.push(`boot pass: message ${row.id} nudge not queued (an identical one is outstanding)`); continue; }
        c.queued++;
      } else c.linked++;
      const moved = store.moveMessage(row.id, 'queue', 'boot-pass', deps.now());
      if (!moved.ok) lines.push(`boot pass: message ${row.id} not moved to queued (${moved.error})`);
    }
  }

  const mailHi = coord.highestOperatorMessageMail();
  const storeHi = store.highestMessageId();
  if (storeHi.kind === 'measured' && mailHi !== 'none' && (storeHi.value === 'none' || mailHi > storeHi.value)) {
    lines.push(`boot pass: the mail's highest operator message id (${mailHi}) is above the store's (${storeHi.value}); keep the journal until this reads clean`);
  }
  return { counts: c, lines };
}

/** The one `ccrc-server:` line the composition root prints: counts, never a text. */
export const bootPassSummary = (c: BootPassCounts): string =>
  `operator model boot pass: kept ${c.kept}, unsettled ${c.unsettled}, unjudged ${c.unjudged}, linked ${c.linked}, queued ${c.queued}, waiting ${c.waiting}`;
