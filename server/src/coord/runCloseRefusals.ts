// D-8077 (spec 2026-11-04 §12.2, A19, A59, A62; the runs rebuild, Task 27): WHAT AN ARMED LANE DOES WITH A CLOSE IT REFUSED.
// A refusal goes to the coordinator first, and an item is the last step: `refusalRoute` (`runClose.ts`, L1) decides, per
// refusal, between telling a living coordinator, telling it and holding the item for `ASK_GRACE_MS`, raising the item at once
// (a gone coordinator), and information (the board's line and one feed row, no item). This file does what the decider says:
// it writes the `untold` row, raises the item through §10's writer (raised by ccrc), records the feed row, and settles the
// item when a later pass finds the reason gone. `moveItemInTx` stays the only writer of an item's state.
//
// ONE ACT PER REFUSAL, by the lane's own anchor. A refusal that lasts acts on its first pass and never again: the anchor
// (`run_close_anchors`, row `refused:<reason>:<lives|gone>`, key the run) says it was already told, so a coordinator's
// withdraw inside the hold is not undone by the next pass, and a changed reason or a coordinator that went gone has a row
// of its own and acts once more. The anchor goes with the refusal.
//
// Every raised item names a control that works (A62). Before an item whose door is Abandon or "Abandon anyway" is raised, the
// lane asks `abandonRefusal`, the arm's own read of the run without acting, inside the same hold; a run the arm cannot move
// from its row raises no item whoever owns it.
import { askNotifyAt } from '../askwindow.js';
import type { NotifyLog } from '../notifylog.js';
import { notifyEach } from '../notice.js';
import { askGraceSeconds } from '../askwindow.js';
import { insertSystemMailTx } from './rundefsTx.js';
import { MAIL_BODY_MAX_BYTES, MAIL_SUBJECT_MAX_BYTES, isRunState } from '../../../shared/api.js';
import { ITEM_TITLE_MAX, closeRefusedAction, isCloseRefusedAction, itemRunName, type ItemDoors } from '../../../shared/ledgers.js';
import type { CloseOutcome } from './close.js';
import type { WatcherCoordPort } from './ports.js';
import {
  REFUSAL_REASONS, refusalRoute, type LaneRun, type RefusalReason, type RunCloseRow,
} from './runClose.js';

const mailBytes = (s: string): number => Buffer.byteLength(s, 'utf8');
/** A mail body cut to `MAIL_BODY_MAX_BYTES` on a code-point boundary. */
function cutMailBody(body: string): string {
  if (mailBytes(body) <= MAIL_BODY_MAX_BYTES) return body;
  let chars = [...body];
  while (chars.length > 0 && mailBytes(chars.join('')) > MAIL_BODY_MAX_BYTES) chars = chars.slice(0, -64);
  return chars.join('');
}

/** The notice a living coordinator gets when ccrc would close one of its runs, refused, and holds the item for the grace
 *  (spec 2026-11-04 §12.2, tell-and-hold). It names the item, as `endRequestAskMail` does, because the held item is on no
 *  list the coordinator can read: without the id it cannot withdraw it. `why` is ccrc's own sentence, not session text. */
export function closeRefusedAskMail(
  r: { itemId: number; runId: number; runName: string; why: string; graceSeconds: number },
): { subject: string; body: string } {
  const head = `close refused: item ${r.itemId}: run ${r.runId}`;
  let title = [...head];
  while (title.length > 0 && mailBytes(title.join('')) > MAIL_SUBJECT_MAX_BYTES) title = title.slice(0, -1);
  const body = [
    `ccrc would close run ${r.runId} (${r.runName}) on its own, but refused: ${r.why}`,
    `The operator sees nothing for ${r.graceSeconds} seconds. If you can handle the run, start it or close it, or withdraw the item with your identity in the body:`,
    `"$API" items withdraw ${r.itemId} --json - <<JSON`,
    '{"byId":"<your id>","byUuid":"<your uuid>"}',
    'JSON',
    'After the operator has acted, a withdraw changes nothing.',
  ].join('\n');
  return { subject: title.join(''), body: cutMailBody(body) };
}

/** One close an armed lane refused, with who owns the run. `lives` is true for an alive or asleep claimant and false for a gone one
 *  (or none); a claimant the pass could not measure is never routed. */
export interface RefusedClose {
  readonly run: LaneRun;
  readonly row: RunCloseRow | null;
  readonly reason: RefusalReason;
  readonly claimant: string | null;
  readonly lives: boolean;
}

export interface RefusalDeps {
  readonly coord: WatcherCoordPort;
  /** `abandonRefusal(coord, runId)`: the arm's own read of the row, asked inside the hold. */
  readonly abandonRefusal: (runId: number) => Extract<CloseOutcome, { ok: false }> | null;
  readonly notifyLog?: NotifyLog | undefined;
}

export interface RefusalOutcome {
  readonly told: readonly number[];
  readonly raised: readonly number[];
  readonly informed: readonly number[];
  readonly settled: readonly number[];
}

/** The lane row of an anchor that says a refusal was acted on. */
const anchorRow = (reason: RefusalReason, lives: boolean): string => `refused:${reason}:${lives ? 'lives' : 'gone'}`;
const ANCHOR_ROWS: readonly string[] = REFUSAL_REASONS.flatMap((r) => [anchorRow(r, true), anchorRow(r, false)]);

/** The item's title word per reason. */
const TITLE: Readonly<Record<RefusalReason, string>> = {
  'open-pr': 'Open pull request',
  'unpushed-commits': 'Unpushed commits',
  'busy-worker': 'Worker still busy',
  'child-marker-unreadable': 'Cannot tell if a child is working',
  'absent-claimant': 'No coordinator on record',
  'warning-undelivered': 'Coordinator not reached',
  'unknown-run': 'Run in a state ccrc cannot read',
};

/** The item's why, before its origin line. */
const WHY: Readonly<Record<RefusalReason, string>> = {
  'open-pr': 'ccrc would close this run on its own, but its branch has an open pull request.',
  'unpushed-commits': 'ccrc would close this run on its own, but its branch has commits that are not pushed.',
  'busy-worker': 'ccrc would close this run on its own, but its worker is still busy.',
  'child-marker-unreadable': 'ccrc would close this run on its own, but it cannot tell whether a child is still working in its workspace.',
  'absent-claimant': 'ccrc would close this run on its own, but nobody is on record as its coordinator.',
  'warning-undelivered': 'ccrc would close this run on its own after a warning, but the warning could not be delivered.',
  'unknown-run': 'This run is in a state this server cannot read.',
};

/** The step words of a refused-close item. */
export const CLOSE_REFUSED_HOW: readonly string[] = ['Read why ccrc did not close it.', 'Take the control on this row.'];

/** The line a refused-close item ends in, as an end request's does: who it reached the operator through. */
export const closeRefusedOrigin = (lives: boolean): string => (lives ? 'Its coordinator did not answer' : 'Its coordinator is gone');

/** The board's information line for a run the arm cannot move (§8.2 item 5), as the feed row says it once. */
function informWords(runId: number, ab: Extract<CloseOutcome, { ok: false }> | null, reason: RefusalReason): { title: string; body: string } {
  if (reason === 'unknown-run' || (ab?.kind === 'bad-transition' && ab.from === 'unknown')) {
    return { title: `run ${runId} is in a state this server cannot read`, body: 'A newer server can move it. Nothing is asked of you.' };
  }
  if (ab?.kind === 'bad-transition' && ab.from === 'closing') {
    return { title: `run ${runId} is already closing`, body: 'The lane that put it there finishes it. Nothing is asked of you.' };
  }
  return { title: `run ${runId} could not be read`, body: 'ccrc could not read this run to close it. Nothing is asked of you.' };
}

/** The refused-close item for a run: its title, why and doors. Null when the run cannot be read. */
function itemInput(coord: WatcherCoordPort, r: RefusedClose, doors: ItemDoors, heldUntil: number | null) {
  const read = coord.run(r.run.id);
  if (!read.ok || read.run === null) return null;
  return {
    program: read.run.program, runId: r.run.id, raisedBy: 'ccrc', kind: 'do' as const,
    title: [...`${TITLE[r.reason]}: ${itemRunName(read.run)}`].slice(0, ITEM_TITLE_MAX).join(''),
    why: `${WHY[r.reason]}\n${closeRefusedOrigin(r.lives)}`, how: [...CLOSE_REFUSED_HOW], options: null,
    // `soon` with no label: nothing pushes, at raise or later (A20).
    neededBy: 'soon' as const, soonLabel: null, secretSlot: null, action: closeRefusedAction(r.run.id, doors), heldUntil,
  };
}

const nameOf = (coord: WatcherCoordPort, runId: number): string => {
  const read = coord.run(runId);
  return read.ok && read.run !== null ? itemRunName(read.run) : `run ${runId}`;
};

const sameDoors = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);

/** Route every refusal once, then settle the items whose reason has gone. SYNCHRONOUS past the arm's read, and called inside the
 *  lane's coordination hold. `current` is every refusal this pass measured, whether or not it acts. Never throws past a
 *  refusal: one that fails is warned and acted on again next pass (its anchor is written last). `unmeasured` is every run the pass
 *  could not measure: its anchors and its open item are kept, because a doubt is not "the reason has gone" (§12.2: a refusal that
 *  lasts tells once); only a definite measurement settles. */
export function routeRefusals(
  deps: RefusalDeps, current: readonly RefusedClose[], now: number, unmeasured: ReadonlySet<number> = new Set(),
): RefusalOutcome {
  const { coord } = deps;
  const told: number[] = [];
  const raised: number[] = [];
  const informed: number[] = [];
  const doorsNow = new Map<number, readonly string[]>();
  const keep = new Set<string>();
  for (const r of current) {
    const row = anchorRow(r.reason, r.lives);
    const key = String(r.run.id);
    keep.add(`${row}\u0000${key}`);
    try {
      const ab = deps.abandonRefusal(r.run.id);
      const route = refusalRoute(r.reason, r.lives ? 'lives' : 'gone', ab === null);
      if (route.kind === 'item' || route.kind === 'tell-and-hold') doorsNow.set(r.run.id, route.doors);
      if (coord.runCloseAnchors(row).has(key)) { coord.setRunCloseAnchor(row, key, { firstAt: coord.runCloseAnchors(row).get(key)!.firstAt, lastAt: now }); continue; }
      let toldInItem = false;
      if (route.kind === 'item' || route.kind === 'tell-and-hold') {
        const open = coord.openCloseRefusedItems().some((i) => i.runId === r.run.id && isCloseRefusedAction(i.action) && sameDoors(i.action.doors, route.doors));
        const input = open ? null : itemInput(coord, r, route.doors, route.kind === 'tell-and-hold' ? askNotifyAt(now) : null);
        if (input !== null) {
          const mailTo = route.kind === 'tell-and-hold' ? r.claimant : null;
          // The held item is on no list the coordinator reads, so the notice that tells it names the item: its id is the only
          // way to withdraw it inside the hold. It goes in the item's own transaction, as an end request's does.
          raised.push(coord.raiseItemWithMail(input, now, 'ccrc', (itemId) => {
            if (mailTo === null) return null;
            const mail = closeRefusedAskMail({ itemId, runId: r.run.id, runName: nameOf(coord, r.run.id),
              why: WHY[r.reason], graceSeconds: askGraceSeconds() });
            return insertSystemMailTx(coord, null, { fromId: 'operator', toId: mailTo, runId: null, kind: 'status',
              subject: mail.subject, body: mail.body, wake: 'never' });
          }));
          if (mailTo !== null) { told.push(r.run.id); toldInItem = true; }
        }
      }
      if (!toldInItem && (route.kind === 'tell' || route.kind === 'tell-and-hold' || (route.kind === 'inform' && r.lives && r.reason === 'unknown-run'))) {
        if (r.claimant !== null) { coord.tellRefusal(r.run.id, r.reason); told.push(r.run.id); }
      }
      if (route.kind === 'inform') {
        const words = informWords(r.run.id, ab, r.reason);
        notifyEach({ coord, notifyLog: deps.notifyLog }, [{ kind: 'run', sessionId: r.claimant ?? '', runId: null, ...words }],
          'record-only', { degraded: 'run-close information, feed archive degraded' });
        informed.push(r.run.id);
      }
      coord.setRunCloseAnchor(row, key, { firstAt: now, lastAt: now });
    } catch (err) {
      console.warn(`ccrc-server: runClose: the refusal of run ${r.run.id} could not be routed (${err instanceof Error ? err.message : String(err)}) — asked again next pass`);
    }
  }
  // A refusal that has gone loses its anchor, so one that returns acts again.
  for (const row of ANCHOR_ROWS) for (const key of coord.runCloseAnchors(row).keys()) if (!keep.has(`${row}\u0000${key}`) && !unmeasured.has(Number(key))) coord.deleteRunCloseAnchor(row, key);
  // `settle`: an item whose reason has gone (or whose doors changed) closes when the lane re-measures (A18).
  const settled: number[] = [];
  for (const item of coord.openCloseRefusedItems()) {
    if (!isCloseRefusedAction(item.action)) continue;
    if (unmeasured.has(item.action.runId)) continue;
    const doors = doorsNow.get(item.action.runId);
    if (doors !== undefined && sameDoors(doors, item.action.doors)) continue;
    const res = coord.moveItem(item.id, 'settle', 'ccrc', { note: 'The reason has gone.' }, now, { programmeHasOpenRun: true });
    if (res.ok) settled.push(item.id);
  }
  return { told, raised, informed, settled };
}

/** The runs whose stored state this server cannot name: a newer build wrote them. No route moves them, so they are information
 *  and never an item (A62, n2). */
export const unknownStateRuns = (runs: readonly LaneRun[]): LaneRun[] => runs.filter((r) => !isRunState(r.state));
