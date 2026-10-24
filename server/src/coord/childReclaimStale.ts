// D-6639 (fleet disk retention DR-27; spec 2026-10-23 §2.7.3, rulings G2): the stale arm of child reclaim, beyond the
// pure step (`childReclaimStaleVerdict`, `childReclaimSweep.ts`). Three things live here:
//   - `ChildStaleArm`, the lane's side: it gathers the evidence the step needs, records "child would be reclaimed
//     (stale)" once while the arm is SHADOWED, and hands the executor an ask only when the operator has armed it
//     (`$REG/child-stale-reclaim-live`) and the box proves `reclaim-stale-v1`. A terminal child is asked at most once
//     per seven idle days.
//   - `childStaleHoldDigest`, the sha256 of the hold file's raw bytes, which ccd compares to its own hash of the same file.
//   - `childReclaimStaleTold`, the executor's last step after a stale-arm reclaim: system mail from the `operator`
//     role to the minting run's coordinator naming the attic refs, or a coord feed row when there is nobody to tell.
// The marker this arm reads has NO writer in the tree (`single-definition.test.ts` pins it); this file only reads a
// listing the caller already took.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CCD_ARGV, RECLAIM_STALE_CAP, capSupported, ccdCan } from '../ccdargv.js';
import { notify } from '../notice.js';
import type { NotifyLog } from '../notifylog.js';
import type { FleetState } from '../fleetstate.js';
import type { SessionRecord } from '../registry.js';
import type { FleetIO } from '../io.js';
import {
  CHILD_STALE_IDLE_MS, childReclaimDetailText, childReclaimStaleVerdict, childReclaimStaleWordOf,
  type ChildReclaimSweepInput, type ChildReclaimSweepVerdict, type ChildStaleAsk, type ChildStaleIdleRead, type ChildStaleWord,
} from '../childReclaimSweep.js';
import { CHILD_STALE_RECLAIM_LIVE_MARKER, readSwitches } from '../../../shared/switches.js';
import type { CoordStore } from './store.js';
import { queueSystemMail } from './rundefsTx.js';
import type { ChildReclaimDeps, ChildReclaimRequest } from './childReclaim.js';

/** The title of the shadow row: what the arm would have done. */
export const CHILD_STALE_WOULD_TITLE = 'child would be reclaimed (stale)';
/** The title of the row that stands in for the coordinator's mail when there is nobody to send it to. */
export const CHILD_STALE_TOLD_TITLE = 'stale child reclaimed';

/** The hold file's own bytes, UNTRIMMED, as `$REG/<id>.hold` holds them, or `null` when they cannot be told: the read
 *  failed, or the text carries a U+FFFD (the file was not UTF-8, so these characters are not its bytes). ccd hashes the
 *  raw file (`_ws_reclaim_hold_released`), so the digest must be taken of exactly this, never of the registry's trimmed
 *  reason: `echo reason > <id>.hold` ends in a newline the trimmed text has lost. */
export async function readStaleHoldBytes(io: Pick<FleetIO, 'readFileMeasured'>, registryDir: string, id: string): Promise<string | null> {
  const r = await io.readFileMeasured(path.join(registryDir, `${id}.hold`));
  return r.ok && !r.content.includes('\uFFFD') ? r.content : null;
}

/** The sha256 of the hold file's raw bytes (`readStaleHoldBytes`), or `null` when they are not known: no digest names
 *  no file, so the child is kept. An empty file digests as the empty string; ccd's rung accepts an empty readable file. */
export function childStaleHoldDigest(bytes: string | null): string | null {
  return bytes === null ? null : createHash('sha256').update(bytes, 'utf8').digest('hex');
}

/** The server's idle evidence for one marked child (spec §2.7.3, the server half), or `'unmeasured'`. The status
 *  clock is the registry row's own stamps in milliseconds: the last process end and the last hibernation. ccd measures
 *  the live half (transcript, pane) on the box, and refuses `not-idle` on it. */
export function childStaleIdleOf(coord: Pick<CoordStore, 'childStaleActivity'>, r: SessionRecord, runId: number): ChildStaleIdleRead {
  const a = coord.childStaleActivity(r.id, runId);
  if (!a.ok) return 'unmeasured';
  const status = [r.lastEnd?.at ?? null, r.hibernatedAt].filter((x): x is number => x !== null);
  return { runAt: a.runAt, mailAt: a.mailAt, statusAt: status.length === 0 ? null : Math.max(...status) };
}

/** What the lane hands `judge` for one marked child. */
export interface ChildStaleJudgement {
  readonly coord: Pick<CoordStore, 'childStaleActivity' | 'recordFeedEvent'>;
  readonly record: SessionRecord;
  /** The hold file's raw bytes (`readStaleHoldBytes`), `null` when not read or not known. */
  readonly holdBytes: string | null;
  readonly input: ChildReclaimSweepInput;
  readonly verdict: ChildReclaimSweepVerdict;
  /** The registry listing this pass took, which the arm's switch is read from. */
  readonly names: readonly string[];
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  readonly notifyLog: NotifyLog | undefined;
  readonly nowMs: number;
}

/** The lane's memory of the stale arm: what the shadow already said, and when a terminal child was last asked. */
export class ChildStaleArm {
  private readonly shadowSaid = new Map<string, { runId: number; words: Set<ChildStaleWord> }>();
  private readonly terminalAsked = new Map<string, { runId: number; at: number }>();

  /** The ask for this child this pass, or `null`: not stale, the box cannot take the flag, the arm is shadowed (the
   *  row is written once), or a terminal child was asked within the last seven days. */
  judge(j: ChildStaleJudgement): (ChildStaleAsk & { readonly runId: number }) | null {
    const id = j.record.id;
    const word = childReclaimStaleWordOf(j.verdict);
    if (word === null) { this.forget(id); return null; }
    // A box that does not prove the flag is not sent it, and is not told "would" either: it could not.
    if (!capSupported(j.fleetState, RECLAIM_STALE_CAP)) return null;
    const i: ChildReclaimSweepInput = {
      ...j.input,
      idle: j.input.child.kind === 'child' ? childStaleIdleOf(j.coord, j.record, j.input.child.runId) : 'unmeasured',
      holdDigest: childStaleHoldDigest(j.holdBytes),
    };
    const v = childReclaimStaleVerdict(i, j.verdict);
    if (!v.stale) { this.forget(id); return null; }
    if (readSwitches(j.names)[CHILD_STALE_RECLAIM_LIVE_MARKER] !== 'set') {
      this.recordWould(j, id, v.runId, v.word);
      return null;
    }
    if (v.word === 'terminal') {
      const last = this.terminalAsked.get(id);
      if (last !== undefined && last.runId === v.runId && !(j.nowMs - last.at >= CHILD_STALE_IDLE_MS)) return null;
    }
    return v;
  }

  /** A terminal child's ask went out: the next one waits seven idle days. */
  asked(id: string, runId: number, ask: ChildStaleAsk, nowMs: number): void {
    if (ask.word === 'terminal') this.terminalAsked.set(id, { runId, at: nowMs });
  }

  private forget(id: string): void {
    this.shadowSaid.delete(id);
  }

  private recordWould(j: ChildStaleJudgement, id: string, runId: number, word: ChildStaleWord): void {
    const said = this.shadowSaid.get(id);
    const words = said !== undefined && said.runId === runId ? said.words : new Set<ChildStaleWord>();
    if (words.has(word)) return;
    words.add(word);
    this.shadowSaid.set(id, { runId, words });
    notify({ notifyLog: j.notifyLog, coord: j.coord },
      { kind: 'run', sessionId: id, runId, title: CHILD_STALE_WOULD_TITLE,
        body: `${id}, child of run #${runId}: kept as "${word}" and idle for more than seven days; with stale reclaim switched on ccrc would reclaim it and pin its work to the attic.` },
      'record-only', { degraded: 'child would be reclaimed (stale), feed archive degraded' });
  }
}

const REASON: Readonly<Record<ChildStaleWord, string>> = {
  held: 'it carried a hold, and a hold lapses after seven idle days',
  'run-absent': 'the run its marker names is not in the coordination database, and nothing had touched it for seven days',
  review: 'it held a review report while the run it reviewed was still open, and nothing had touched it for seven days',
  terminal: 'an earlier reclaim of it was refused, and a fresh attempt after seven idle days passed',
};

/** The attic refs `ws-attic --session <id>` printed, as the lines that name this id's attic and nothing else. */
export function parseAtticRefs(sessionId: string, stdout: string): string[] {
  const prefix = `refs/ccrc/attic/${sessionId}/`;
  return stdout.split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '')
    .filter((ref) => ref.startsWith(prefix) && /^[A-Za-z0-9._/-]+$/.test(ref)).slice(0, 20);
}

/** The coordinator's mail (spec §2.7.3): what happened, why, and the refs it can re-dispatch from. Pure. */
export function childStaleMail(a: {
  readonly sessionId: string; readonly runId: number; readonly ask: ChildStaleAsk; readonly refs: readonly string[] | null;
}): { subject: string; body: string } {
  const refs = a.refs === null || a.refs.length === 0
    ? [`The refs could not be listed just now. List them with: git for-each-ref refs/ccrc/attic/${a.sessionId}/ (in the project's main checkout).`]
    : ['Attic refs:', ...a.refs.map((r) => `  ${r}`)];
  const hold = a.ask.word === 'held' && a.ask.holdText !== null
    ? [`The hold it carried read: "${childReclaimDetailText(a.ask.holdText)}"`] : [];
  return {
    subject: `stale child reclaimed: ${a.sessionId}`,
    body: [
      `${a.sessionId}, a child workspace of run #${a.runId}, was reclaimed: ${REASON[a.ask.word]}.`,
      ...hold,
      'Its branch, work in progress and any review report were pinned under the attic before the tree was removed.',
      ...refs,
      'To work from one again, in the project\'s main checkout: git worktree add <path> <ref>',
    ].join('\n'),
  };
}

/** The executor's step after a stale-arm reclaim finished: tell the coordinator, or, with nobody to tell, record it.
 *  Never throws: a reclaim that finished stays finished. */
export async function childReclaimStaleTold(
  deps: Pick<ChildReclaimDeps, 'coord' | 'runCcd' | 'fleetState' | 'notifyLog'>, req: ChildReclaimRequest,
): Promise<void> {
  const ask = req.stale;
  if (ask === undefined) return;
  try {
    let refs: string[] | null = null;
    if (ccdCan(deps.fleetState, 'wsAttic')) {
      const res = await deps.runCcd(CCD_ARGV.wsAttic(req.sessionId));
      if (res.ok) refs = parseAtticRefs(req.sessionId, res.stdout);
    }
    const { subject, body } = childStaleMail({ sessionId: req.sessionId, runId: req.runId, ask, refs });
    const coordinator = ask.word === 'run-absent' ? null : deps.coord.resolveCoordinator(req.runId);
    if (coordinator !== null) {
      queueSystemMail(deps.coord, null, { fromId: 'operator', toId: coordinator, runId: null, kind: 'status', subject, body });
      return;
    }
    notify(deps, { kind: 'coord', sessionId: req.sessionId, runId: req.runId, title: CHILD_STALE_TOLD_TITLE, body },
      'record-only', { degraded: 'stale child reclaimed, feed archive degraded' });
  } catch (err) {
    console.warn(`ccrc-server: telling the coordinator of ${req.sessionId}'s stale reclaim failed `
      + `(${err instanceof Error ? err.message : String(err)}) — the reclaim stands`);
  }
}
