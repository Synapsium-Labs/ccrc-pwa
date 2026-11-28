// The Operator Model's boot pass. Ring L4, context C11 (invariant I8; Overlord W1 private store plan, Task 6). It re-derives
// what a crash can leave wrong, once, after both stores open and before the watcher starts: a `settled` row no citation
// proves (`bootSettlement`), and a recorded message whose nudge was never queued (`nudgeRecovery`). It decides nothing:
// the deciders (`./messages.ts`) answer, and it acts through `moveMessage` (actor `boot-pass`, with its sequence line,
// `messageLine.ts`) and `queueSystemMail`. It
// carries no message text: counts and ids only. Time is the injected clock.
import { operatorMessageSubject, OPERATOR_MESSAGE_SENDER } from '../../../shared/operatorMessages.js';
import type { CoordStore } from '../coord/store.js';
import type { MessageState } from '../../../shared/operatorMessages.js';
import type { CitedMessagesRead } from '../coord/overlordRequestStore.js';
import { bootSettlement, bootSpend, nudgeRecovery, type CitationRead, type RestoreFloorRead } from './messages.js';
import { queueOperatorNudge, type NudgeQueueCoord } from './nudgeQueue.js';
import { moveOperatorMessage } from './messageLine.js';
import type { OperatorModelStore } from './store.js';

export interface BootPassCounts {
  readonly kept: number; readonly unsettled: number; readonly unjudged: number;
  readonly linked: number; readonly queued: number; readonly waiting: number;
  /** Queued rows whose acked nudge moved them to `delivered`, and rows a coordination call threw on (logged, the pass went on). */
  readonly delivered: number; readonly errors: number;
  /** Rows the spend arm spent: a root citation's copy repaired, or a row at or below the restore floor (W2 request record A). */
  readonly spent: number;
}

export interface BootPassDeps {
  readonly operatorModel: Pick<OperatorModelStore,
    'settledRows' | 'unnudged' | 'queuedIds' | 'highestMessageId' | 'moveMessage' | 'messageSessionOf' | 'unspentAmong' | 'unspentThrough' | 'presentAmong'>;
  readonly coord: NudgeQueueCoord & Pick<CoordStore, 'highestOperatorMessageMail' | 'hasAckedMailWithSubject'>;
  /** The citations port: W1's adapter answers `not-applicable` (open question 9); W2's measured adapter reads the request record's
   *  cited messages, the root-cited ones and the restore floor (`requestCitations`, composed at the root). */
  readonly citations: () => CitationRead;
  readonly now: () => number;
}

/** The W1 citation adapter. */
export const w1Citations = (): CitationRead => ({ kind: 'not-applicable' });

/** W2's measured citation adapter (request record A): the request store's three answers kept apart, `absent` (no migration) as
 *  `not-applicable` and a failed read as `unmeasured`, with the restore floor beside them (`none` until act journal B). */
export function requestCitations(read: CitedMessagesRead, restoreFloor: RestoreFloorRead): CitationRead {
  if (read.kind === 'absent') return { kind: 'not-applicable' };
  if (read.kind === 'unmeasured') return { kind: 'unmeasured', why: read.why };
  // The pairs ride only when a row cites (additive: a read with none is the same measured arm as before).
  return { kind: 'measured', cited: read.cited, rootCited: read.rootCited, restoreFloor, ...(read.citing.length > 0 ? { citing: read.citing } : {}) };
}

/** How many pairs the line naming citations with no message row lists, by request then message (review 4190 F4). */
export const BOOT_ABSENT_CITATIONS_SHOWN = 5;

export function runOperatorModelBootPass(deps: BootPassDeps): { readonly counts: BootPassCounts; readonly lines: readonly string[] } {
  const c = { kept: 0, unsettled: 0, unjudged: 0, linked: 0, queued: 0, waiting: 0, delivered: 0, errors: 0, spent: 0 };
  const lines: string[] = [];
  const { operatorModel: store, coord } = deps;
  // Each move's sequence line goes to the pass's own lines, like its other notes (call 1218). Those lines carry no `ccrc-server:`
  // prefix (the boot prints each with one), so the message line's own prefix is taken off here (review 3852 F4).
  const mover = { store, coordDb: coord.db, warn: (l: string): void => { lines.push(l.replace(/^ccrc-server: /, '')); } };

  const cites = deps.citations();
  // The spend arm (W2 request record A, RQ11, F14), first, so a root-cited settled row is spent rather than re-judged: the copy a
  // citing door failed to write, and every row up to a read restore floor. It never takes a mark away, and spends only through
  // the one mover that stamps the message's sequence line. A floor that could not be read spends nothing by the floor. A citation
  // read that could not be measured says so with its reason, so the log never reads it as a clean read with none (review 4190 F1).
  if (cites.kind === 'unmeasured') lines.push(`boot pass: citations unmeasured (${cites.why}); nothing spent by a citation or the floor`);
  if (cites.kind === 'measured') {
    const floor = cites.restoreFloor;
    if (floor?.kind === 'unreadable') lines.push(`boot pass: the restore floor could not be read (${floor.why}); nothing spent by the floor`);
    const reads = [store.unspentAmong([...(cites.rootCited ?? [])]), ...(floor?.kind === 'floor' ? [store.unspentThrough(floor.id)] : [])];
    const candidates = new Map<number, { readonly id: number; readonly state: MessageState | 'unknown' }>();
    for (const r of reads) {
      if (r.kind === 'unmeasured') lines.push(`boot pass: unspent rows unmeasured (${r.why}); some spends deferred`);
      else for (const row of r.value) candidates.set(row.id, row);
    }
    for (const row of [...candidates.values()].sort((a, b) => a.id - b.id)) {
      const verdict = bootSpend(row, cites);
      if (verdict !== 'spend') { if (verdict === 'unjudged') c.unjudged++; continue; }
      const moved = moveOperatorMessage(mover, row.id, 'spend', 'boot-pass', deps.now());
      if (moved.ok) c.spent++;
      else { c.unjudged++; lines.push(`boot pass: message ${row.id} not spent (${moved.error})`); }
    }
    // A citation of a message the private store has no row for (a row removed by hand, an older private store under a newer
    // coordination database) moves nothing, and leaves one line per boot: the count, and the first few pairs, ids only (F4).
    const citing = cites.citing ?? [];
    if (citing.length > 0) {
      const present = store.presentAmong([...new Set(citing.map((p) => p.messageId))]);
      if (present.kind === 'unmeasured') lines.push(`boot pass: cited message rows unmeasured (${present.why}); citations with no row not counted`);
      else {
        const have = new Set(present.value);
        const absent = citing.filter((p) => !have.has(p.messageId));
        if (absent.length > 0) {
          const shown = absent.slice(0, BOOT_ABSENT_CITATIONS_SHOWN).map((p) => `${p.requestId}:${p.messageId}`).join(', ');
          lines.push(`boot pass: citations with no message row: ${absent.length} (request:message, the first ${BOOT_ABSENT_CITATIONS_SHOWN}: ${shown}); nothing moved for them`);
        }
      }
    }
  }

  const settled = store.settledRows();
  if (settled.kind === 'unmeasured') lines.push(`boot pass: settled rows unmeasured (${settled.why}); nothing re-derived`);
  else {
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
  `operator model boot pass: kept ${c.kept}, unsettled ${c.unsettled}, unjudged ${c.unjudged}, linked ${c.linked}, queued ${c.queued}, waiting ${c.waiting}, delivered ${c.delivered}, errors ${c.errors}, spent ${c.spent}`;
