// The Operator Model's boot pass. Ring L4, context C11 (invariant I8; Overlord W1 private store plan, Task 6). It re-derives
// what a crash can leave wrong, once, after both stores open and before the watcher starts: a `settled` row no citation
// proves (`bootSettlement`), and a recorded message whose nudge was never queued (`nudgeRecovery`). It decides nothing:
// the deciders (`./messages.ts`) answer, and it acts through `moveMessage` (actor `boot-pass`, with its sequence line,
// `messageLine.ts`) and `queueSystemMail`. It
// carries no message text: counts and ids only. Time is the injected clock.
import { operatorMessageSubject, OPERATOR_MESSAGE_SENDER } from '../../../shared/operatorMessages.js';
import type { CoordStore } from '../coord/store.js';
import { bootSettlement, nudgeRecovery, type CitationRead } from './messages.js';
import { queueOperatorNudge, type NudgeQueueCoord } from './nudgeQueue.js';
import { moveOperatorMessage } from './messageLine.js';
import type { OperatorModelStore } from './store.js';

export interface BootPassCounts {
  readonly kept: number; readonly unsettled: number; readonly unjudged: number;
  readonly linked: number; readonly queued: number; readonly waiting: number;
  /** Queued rows whose acked nudge moved them to `delivered`, and rows a coordination call threw on (logged, the pass went on). */
  readonly delivered: number; readonly errors: number;
}

export interface BootPassDeps {
  readonly operatorModel: Pick<OperatorModelStore,
    'settledRows' | 'unnudged' | 'queuedIds' | 'highestMessageId' | 'moveMessage' | 'messageSessionOf'>;
  readonly coord: NudgeQueueCoord & Pick<CoordStore, 'highestOperatorMessageMail' | 'hasAckedMailWithSubject'>;
  /** W1 has no citing table: its adapter answers `not-applicable` (open question 9). */
  readonly citations: () => CitationRead;
  readonly now: () => number;
}

/** The W1 citation adapter. */
export const w1Citations = (): CitationRead => ({ kind: 'not-applicable' });

export function runOperatorModelBootPass(deps: BootPassDeps): { readonly counts: BootPassCounts; readonly lines: readonly string[] } {
  const c = { kept: 0, unsettled: 0, unjudged: 0, linked: 0, queued: 0, waiting: 0, delivered: 0, errors: 0 };
  const lines: string[] = [];
  const { operatorModel: store, coord } = deps;
  // Each move's sequence line goes to the pass's own lines, like its other notes (call 1218).
  const mover = { store, coordDb: coord.db, warn: (l: string): void => { lines.push(l); } };

  const settled = store.settledRows();
  if (settled.kind === 'unmeasured') lines.push(`boot pass: settled rows unmeasured (${settled.why}); nothing re-derived`);
  else {
    const cites = deps.citations();
    for (const row of settled.value) {
      const verdict = bootSettlement(row, cites);
      if (verdict === 'keep') { c.kept++; continue; }
      if (verdict === 'unjudged') { c.unjudged++; continue; }
      const moved = moveOperatorMessage(mover, row.id, 'unsettle', 'boot-pass', deps.now());
      if (moved.ok) c.unsettled++;
      else { c.unjudged++; lines.push(`boot pass: message ${row.id} not unsettled (${moved.error})`); }
    }
  }

  const unnudged = store.unnudged();
  if (unnudged.kind === 'unmeasured') lines.push(`boot pass: unnudged rows unmeasured (${unnudged.why}); nothing re-nudged`);
  else {
    for (const row of unnudged.value) {
      // One row's coordination call that throws never stops the rest (review 2550 F8; `bootPushOutbox`'s habit).
      try {
        const owner = store.messageSessionOf(row.id);
        if (owner.kind === 'unmeasured' || owner.value === 'absent') { c.unjudged++; continue; }
        const subject = operatorMessageSubject(row.id);
        const found = coord.hasMailWithSubject(OPERATOR_MESSAGE_SENDER, null, owner.value.sessionId, subject);
        const verdict = nudgeRecovery(owner.value, found, coord.designationRead());
        if (verdict === 'unjudged') { c.unjudged++; continue; }
        if (verdict === 'wait') { c.waiting++; continue; }
        if (verdict === 'queue') {
          // The same act the route runs: the mail and the `@overlord` mark in one transaction (N3).
          if (!queueOperatorNudge(coord, owner.value.sessionId, row.id, deps.now(), (l) => lines.push(l))) {
            c.unjudged++; lines.push(`boot pass: message ${row.id} nudge not queued (an identical one is outstanding)`); continue;
          }
          c.queued++;
        } else c.linked++;
        const moved = moveOperatorMessage(mover, row.id, 'queue', 'boot-pass', deps.now());
        if (!moved.ok) lines.push(`boot pass: message ${row.id} not moved to queued (${moved.error})`);
      } catch (e) {
        c.errors++; lines.push(`boot pass: message ${row.id} not re-nudged (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  // A row still `queued` whose nudge is ACKED was typed: the mail lane's `deliver` move was refused or lost (F3). The boot pass
  // delivers it now, after the loop above so a row it just linked is judged in the same pass.
  const queuedIds = store.queuedIds();
  if (queuedIds.kind === 'unmeasured') lines.push(`boot pass: queued rows unmeasured (${queuedIds.why}); none delivered`);
  else {
    for (const id of queuedIds.value) {
      try {
        const owner = store.messageSessionOf(id);
        if (owner.kind === 'unmeasured' || owner.value === 'absent') { c.unjudged++; continue; }
        if (!coord.hasAckedMailWithSubject(OPERATOR_MESSAGE_SENDER, owner.value.sessionId, operatorMessageSubject(id))) continue;
        const moved = moveOperatorMessage(mover, id, 'deliver', 'boot-pass', deps.now());
        if (moved.ok) c.delivered++; else lines.push(`boot pass: message ${id} not moved to delivered (${moved.error})`);
      } catch (e) {
        c.errors++; lines.push(`boot pass: message ${id} not delivered (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  let mailHi: number | 'none' = 'none';
  try { mailHi = coord.highestOperatorMessageMail(); } catch (e) { c.errors++; lines.push(`boot pass: the mail's highest id not read (${e instanceof Error ? e.message : String(e)})`); }
  const storeHi = store.highestMessageId();
  if (storeHi.kind === 'measured' && mailHi !== 'none' && (storeHi.value === 'none' || mailHi > storeHi.value)) {
    lines.push(`boot pass: the mail's highest operator message id (${mailHi}) is above the store's (${storeHi.value}); keep the journal until this reads clean`);
  }
  return { counts: c, lines };
}

/** The one `ccrc-server:` line the composition root prints: counts, never a text. */
export const bootPassSummary = (c: BootPassCounts): string =>
  `operator model boot pass: kept ${c.kept}, unsettled ${c.unsettled}, unjudged ${c.unjudged}, linked ${c.linked}, queued ${c.queued}, waiting ${c.waiting}, delivered ${c.delivered}, errors ${c.errors}`;
