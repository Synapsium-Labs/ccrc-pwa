// L4 delivery, context C5 (Coordination): the mailhold projection (mid-turn mail spec
// `docs/superpowers/specs/2026-11-19-mid-turn-mail-design.md` §3.4; plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md`
// Task 4.3). It reads, asks `decideMailHold` (L1, `mailHoldPolicy.ts`) and writes what it answered; it decides nothing.
//
// ONE WRITER. The lane is the one writer of the `mailhold` route field (lane-only: every door refuses it), and `ccd route`
// is its only carrier: one `CCD_ARGV.routeSet` argv per session, behind `route-mailhold-v1` (`capSupported`) and the `route`
// verb (`ccdCan`), its answer read through the shared `routeSetOutcome`. It follows the launch-profile lane's shape, and its
// "legitimately different" reasons are the spec's §3.7: it has no shadow mode (it is live from its first deploy, and
// nothing acts on its marker until the hook's arms are armed), and a lane that stopped would leave stale markers.
//
// IT DERIVES FROM THE STORE, NEVER FROM THE MAIL LANE. The hold is `CoordStore.urgentHolds`, read once a pass, so a lease
// is renewed on schedule while the mail lane leaves a delivered row alone for minutes (its replay back-off). The lease's
// `until` is the wall clock (epoch seconds, as the hook and ccd read it), never the monotonic clock.
//
// UNDER `mail-disabled` IT STILL RUNS, AND ONLY CLEARS (spec §3.4, D3): the watcher dispatches it whether or not the switch
// stands, and the decider answers a clear for a standing marker and nothing else, so a session is never held while mail
// cannot reach it. The store is not read then.
//
// What it skips: a row whose id the registry refuses, a marker the registry could not read, a fleet whose ccd cannot take
// the field, and a held recipient the registry does not list (nothing is written for it). A failed write is logged once
// per episode, by session, and retried next pass.
//
// A PASS A NEWER ONE OVERTOOK WRITES NOTHING MORE. The lane row lets a pass start while one older than `staleAfterMs` still
// walks its rows (a wedged `route` call), and the older one holds an older view: it could clear a marker the newer pass just
// wrote, or write one the newer pass cleared. Each pass takes the next `memory.generation`, and before each write it stops
// once a newer pass has taken one, so the projection never undoes itself. The ack's kick (plan Task 4.4) is not here: until it lands, a cleared
// hold leaves the marker standing until the next pass, at most one `MAIL_SWEEP_MS` later.
import { isRegistryId } from '../../../shared/api.js';
import type { MailHoldPair } from '../../../shared/mailHold.js';
import { CCD_ARGV, MAILHOLD_ROUTE_CAP, capSupported, ccdCan, sweepDec } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import type { SessionRecord } from '../registry.js';
import { routeSetOutcome, type RouteSetOutcome } from '../routeSetOutcome.js';
import { decideMailHold, type MailHoldDecision } from './mailHoldPolicy.js';
import type { RunCcd, WatcherCoordPort } from './ports.js';

/** The lane's `LANE_SCHEDULE` row. */
export const MAIL_HOLD_LANE_ROW = 'mailHold';
/** The actor the route writes are journalled under on the box. */
export const MAIL_HOLD_LANE_ACTOR = 'mailhold lane';

/** The store member the pass reaches, declared by this consumer. */
export type MailHoldCoord = Pick<WatcherCoordPort, 'urgentHolds'>;

/** One registry row, as the tick listed it. */
export interface MailHoldRow {
  readonly id: string;
  /** The routing record as the registry read it: null for a session never routed. */
  readonly route: SessionRecord['route'];
}

/** The lane's memory across passes: the sessions whose last write failed and whether the last store read failed (so each
 *  failure is logged once per episode), the last summary line (so an unchanged pass logs nothing), and the newest pass's
 *  generation (so an overtaken pass stops writing). Never a decision's state. */
export interface MailHoldLaneMemory { readonly failing: Set<string>; lastLine: string | null; storeUnread: boolean; generation: number }

export interface MailHoldLaneDeps {
  readonly coord: MailHoldCoord;
  readonly runCcd: RunCcd;
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  /** The clock port's wall clock, in milliseconds. */
  readonly wallMs: () => number;
  readonly log: (line: string) => void;
  readonly memory: MailHoldLaneMemory;
}

export interface MailHoldLaneResult {
  readonly mailDisabled: boolean;
  /** A newer pass started while this one walked its rows: this one stopped before its next write, and logged nothing. */
  readonly superseded: boolean;
  /** The hold could not be read: the pass wrote and cleared nothing, and every standing marker keeps its lease (D3). */
  readonly storeUnread: boolean;
  /** Writes that landed, by why (`decideMailHold`'s words), and clears that landed. */
  readonly appeared: number; readonly differed: number; readonly renewed: number; readonly cleared: number;
  readonly failed: number;
  /** Rows skipped: the marker could not be read; ccd here cannot take the field; a held pair the grammar cannot spell. */
  readonly unreadable: number; readonly incapable: number; readonly unrenderable: number;
  /** Held recipients the registry does not list, and rows whose id it refuses: nothing is written for either. */
  readonly unlisted: number;
}

type Counts = { -readonly [K in keyof Omit<MailHoldLaneResult, 'mailDisabled' | 'superseded' | 'storeUnread'>]: number };

/** One pass over the tick's listing. `mailDisabled` is `$REG/mail-disabled` as that listing read it. */
export async function mailHoldPass(deps: MailHoldLaneDeps, rows: readonly MailHoldRow[], mailDisabled: boolean): Promise<MailHoldLaneResult> {
  const c: Counts = { appeared: 0, differed: 0, renewed: 0, cleared: 0, failed: 0, unreadable: 0, incapable: 0, unrenderable: 0, unlisted: 0 };
  const generation = ++deps.memory.generation;
  // One store query a pass, and none under `mail-disabled`, where the decider only clears. A read that throws is not "no
  // hold": the pass writes and clears nothing, so each marker stands until its lease lapses at the hook.
  let holds: ReturnType<MailHoldCoord['urgentHolds']> = new Map();
  if (!mailDisabled) {
    try { holds = deps.coord.urgentHolds(); } catch (e) {
      if (!deps.memory.storeUnread) {
        deps.log(`ccrc-server: mailhold: the urgent hold could not be read, so no marker is written or cleared this pass: ${e instanceof Error ? e.message : String(e)}`);
      }
      deps.memory.storeUnread = true;
      return { mailDisabled, superseded: false, storeUnread: true, ...c };
    }
  }
  deps.memory.storeUnread = false;
  const capable = capSupported(deps.fleetState, MAILHOLD_ROUTE_CAP) && ccdCan(deps.fleetState, 'routeSet');
  const now = Math.floor(deps.wallMs() / 1000);
  const listed = new Set<string>();
  for (const r of rows) {
    if (!isRegistryId(r.id)) { c.unlisted += 1; continue; }
    listed.add(r.id);
    const measured = r.route?.fields.mailhold ?? null;
    const unreadable = r.route?.unreadable.includes('mailhold') ?? false;
    const held: MailHoldPair[] = (holds.get(r.id) ?? []).map((h) => ({ role: h.role, delivery: h.deliveryId }));
    const d = decideMailHold({ held, measured, unreadable, now, capable, mailDisabled });
    if (d.act === 'none') continue;
    if (d.act === 'skip') { c[d.why] += 1; continue; }
    if (deps.memory.generation !== generation) return { mailDisabled, superseded: true, storeUnread: false, ...c };
    const value = d.act === 'write' ? d.value : '';
    const res = await deps.runCcd(CCD_ARGV.routeSet(r.id, { mailhold: value }, sweepDec(deps.fleetState, MAIL_HOLD_LANE_ACTOR)));
    settle(deps, r.id, d, routeSetOutcome(res), c);
  }
  for (const id of holds.keys()) if (!listed.has(id)) c.unlisted += 1;
  const result: MailHoldLaneResult = { mailDisabled, superseded: false, storeUnread: false, ...c };
  logPass(deps, result);
  return result;
}

/** Count one write's answer, and log a failure once an episode. */
function settle(deps: MailHoldLaneDeps, id: string, d: Extract<MailHoldDecision, { act: 'write' | 'clear' }>, out: RouteSetOutcome, c: Counts): void {
  if (out.kind === 'written') {
    deps.memory.failing.delete(id);
    if (d.act === 'clear') c.cleared += 1;
    else if (d.why === 'appear') c.appeared += 1;
    else if (d.why === 'differ') c.differed += 1;
    else c.renewed += 1;
    return;
  }
  c.failed += 1;
  if (deps.memory.failing.has(id)) return;   // once per episode
  deps.memory.failing.add(id);
  const detail = out.kind === 'unreachable' ? `${out.detail}, so the write is unmeasured` : out.reason;
  deps.log(`ccrc-server: mailhold: the ${d.act === 'clear' ? 'clear' : 'write'} for ${id} failed, retried each pass: ${detail}`);
}

/** The pass's line, logged only when it differs from the last one; renewals are left out of it, so a settled hold logs once. */
function logPass(deps: MailHoldLaneDeps, r: MailHoldLaneResult): void {
  const parts = [
    r.appeared > 0 ? `${r.appeared} marker(s) written` : '', r.differed > 0 ? `${r.differed} rewritten` : '',
    r.cleared > 0 ? `${r.cleared} cleared${r.mailDisabled ? ' (mail-disabled)' : ''}` : '',
    r.unreadable > 0 ? `${r.unreadable} skipped, the marker could not be read` : '',
    r.incapable > 0 ? `${r.incapable} skipped, ccd here does not take mailhold` : '',
    r.unrenderable > 0 ? `${r.unrenderable} skipped, a held pair the grammar cannot spell` : '',
  ].filter((s) => s !== '');
  const line = parts.length === 0 ? null : `ccrc-server: mailhold: ${parts.join('; ')}`;
  if (line !== null && line !== deps.memory.lastLine) deps.log(line);
  deps.memory.lastLine = line;
}
