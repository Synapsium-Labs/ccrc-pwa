// FLEET DISK RETENTION DR-19 (D-6631; spec 2026-10-23 section 2.3). L3: the orphan-worktree lane's executor. It asks ccd
// for the census and for one tree's audit, and runs the act job: capabilities, the switches, the audit as the second
// observation, the licence, the switches once more, and only then `ws-orphan`. Every doubt is "not this time". It
// decides nothing the L1 file (`../orphanTreeLane.ts`) decides, writes no feed row and keeps no memory. The server
// composes the verb and nothing else does (CLAUDE.md SAFETY); `--force` has no builder.
import type { FleetIO, MeasuredDirectoryRead } from '../io.js';
import type { FleetState } from '../fleetstate.js';
import type { RunCcd } from './ports.js';
import { CCD_ARGV, ccdCan, sweepDec } from '../ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  ORPHAN_TREE_LIVE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, readSwitches,
} from '../../../shared/switches.js';
import {
  orphanLicence, orphanRescueArmed, parseOrphanAudit, parseOrphanCensus, parseOrphanResult,
  type OrphanAudit, type OrphanCensus, type OrphanJobOutcome, type OrphanObservation, type OrphanSwitches,
} from '../orphanTreeLane.js';

export interface CollectOrphanDeps {
  readonly io: Pick<FleetIO, 'readdirMeasured'>;
  readonly registryDir: string;
  readonly runCcd: RunCcd;
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  /** The connection epoch (path-identity spec 2026-10-12 section 5.5): a reconnect between the queueing and the act
   *  composes nothing. */
  readonly epochNow: () => number;
}

/** A capability the box does not advertise: nothing was asked. */
export interface OrphanNotAsked { readonly kind: 'not-asked' }

/** The lane's switches from ONE registry listing. A listing that could not be taken cannot rule a pause out, so it is a
 *  pause; a marker is live only when the listing proves it present. */
export async function orphanSwitches(io: Pick<FleetIO, 'readdirMeasured'>, registryDir: string): Promise<OrphanSwitches> {
  let listed: MeasuredDirectoryRead;
  try { listed = await io.readdirMeasured(registryDir); } catch { listed = { ok: false, reason: 'unreadable' }; }
  if (!listed.ok) return { paused: true, why: 'unlistable' };
  const names = listed.entries as readonly string[];
  if (readSwitches(names)[RECLAIM_PAUSE_MARKER] === 'set') return { paused: true, why: 'raised' };
  return { paused: false, live: names.includes(ORPHAN_TREE_LIVE_MARKER), rescueLive: names.includes(ORPHAN_TREE_RESCUE_LIVE_MARKER) };
}

/** `ws-audit --orphans`, or `not-asked` on a box whose ccd lacks `orphan-v1` (the capability refuses on no evidence). */
export async function censusOrphans(deps: CollectOrphanDeps): Promise<OrphanCensus | OrphanNotAsked> {
  if (!ccdCan(deps.fleetState, 'wsOrphanCensus')) return { kind: 'not-asked' };
  try { return parseOrphanCensus((await deps.runCcd(CCD_ARGV.wsOrphanCensus())).stdout); } catch { return { kind: 'unreadable' }; }
}

/** `ws-audit --orphan-hex`: read stdout even on a non-zero exit, because an unmeasured audit prints its document and
 *  exits 1. A call that threw or printed nothing is `unreadable`, which keeps the tree. */
export async function auditOrphan(deps: CollectOrphanDeps, hex: string): Promise<OrphanAudit | OrphanNotAsked> {
  if (!ccdCan(deps.fleetState, 'wsOrphanAudit')) return { kind: 'not-asked' };
  try { return parseOrphanAudit((await deps.runCcd(CCD_ARGV.wsOrphanAudit(hex))).stdout, hex); }
  catch (err) { return { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) }; }
}

/** The act job for one tree. `obs` is the lane's standing first sighting; `nowMono` is the monotonic clock, read when
 *  the audit's answer arrives. In SHADOW (`orphan-tree-live` absent) the job composes no verb and reports `would`. A
 *  tree whose only refusal was rung 9 is spent with its rescue token and `--rescue`, and only when both markers stand. */
export async function collectOrphanTree(
  deps: CollectOrphanDeps, hex: string, obs: OrphanObservation | null, nowMono: () => number, epoch: number,
): Promise<OrphanJobOutcome> {
  if (!ccdCan(deps.fleetState, 'wsOrphanAudit') || !ccdCan(deps.fleetState, 'wsOrphan')) return { kind: 'stopped', why: 'caps' };
  const first = await orphanSwitches(deps.io, deps.registryDir);
  if (first.paused) return { kind: 'stopped', why: 'paused' };
  const audit = await auditOrphan(deps, hex);
  if (audit.kind === 'not-asked') return { kind: 'stopped', why: 'caps' };
  const spend = audit.kind === 'token' ? { token: audit.token, rescue: false }
    : audit.kind === 'rescuable' && orphanRescueArmed(first) ? { token: audit.rescueToken, rescue: true } : null;
  if (spend === null) return { kind: 'audited', audit };
  const arrived = nowMono();
  if (orphanLicence(obs, spend.token, arrived) !== 'licensed') return { kind: 'audited', audit };
  // The switches once more: the job's last await. A pause raised, an arm withdrawn or a moved connection stops it.
  const last = await orphanSwitches(deps.io, deps.registryDir);
  if (last.paused) return { kind: 'stopped', why: 'paused' };
  if (deps.epochNow() !== epoch) return { kind: 'stopped', why: 'epoch' };
  if (spend.rescue && !orphanRescueArmed(last)) return { kind: 'stopped', why: 'switch' };
  // SYNCHRONOUS from here to the argv.
  if (!ccdCan(deps.fleetState, 'wsOrphan')) return { kind: 'stopped', why: 'caps' };
  if (!last.live) return { kind: 'would', rescued: spend.rescue };
  try {
    const r = await deps.runCcd(CCD_ARGV.wsOrphan(spend.token, hex, spend.rescue, sweepDec(deps.fleetState, 'orphan-tree sweep')));
    return { kind: 'result', result: parseOrphanResult(r.stdout, hex), rescued: spend.rescue };
  } catch (err) {
    return { kind: 'result', result: { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) }, rescued: spend.rescue };
  }
}
