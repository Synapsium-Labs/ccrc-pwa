// L3 — the resolver's store-facing half and the server-role projection writer
// (design 2026-09-20 §9; D-3187: the resolver is L1, so the
// fs write and the store reads live here, beside it, not in it).
//
// ON A SERVER-ROLE OR `both` NODE THE SERVER PROCESS IS THE WRITER of
// ~/.ccrc/update-intent (§9): the same document a fleet node will pull in W4,
// the same grammar, tmp-then-rename, rewritten at every resolution and on
// every inventory sweep so its `lease` is refreshed on the timer's cadence.
// WRITE NOTHING UNLESS THE WHOLE ANSWER ARRIVED (ccd/ccd-pool-sync's header):
// a resolution with no channel writes nothing, and the previous document
// ages out through its own lease rather than being replaced by a guess.
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FLEET_SCOPE, type NodeRole } from '../../../shared/api.js';
import { NODE_FILES } from '../../../shared/agent-protocol.js';
import type {
  NodeResolvedColumns, NodeRow, RefusalRow, ReleaseRow, ResolveNodeResult, UpdateIntentRow,
} from '../coord/store.js';
import { SERVER_LABEL } from './inventory.js';
import {
  renderProjection, resolveNodeIntent, type IntentView, type Resolution, type ResolveInput,
} from './resolve.js';

export const PROJECTION_FILE_MODE = 0o600;

/** The port this module needs, declared by the consumer (L2). CoordStore satisfies it structurally. */
export interface ProjectStore {
  nodes(): NodeRow[];
  releases(): ReleaseRow[];
  refusalsFor(nodeId: string): RefusalRow[];
  intentFor(scope: string): UpdateIntentRow | null;
  updateEpoch(): { epoch: number; issuedAt: number };
  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult;
}

function intentView(row: UpdateIntentRow | null): IntentView | null {
  return row === null ? null : { channel: row.channel, pinnedTag: row.pinnedTag, auto: row.auto };
}

/** The resolver's input for one node, from store reads only. `currentVersion` is a version only when the
 *  stamp read `ok` — a malformed or unreadable stamp's columns say nothing about what runs. The refusal set
 *  is THIS node's (decision 16); `releases()`'s `refused` roll-up is display and never read here. */
export function resolveInputFor(store: Omit<ProjectStore, 'resolveNode' | 'nodes'>, node: NodeRow): ResolveInput {
  return {
    currentVersion: node.stampRead === 'ok' ? node.currentVersion : null,
    highestVersion: node.highestVersion,
    floorRead: node.floorRead,
    nodeIntent: intentView(store.intentFor(node.nodeId)),
    fleetIntent: intentView(store.intentFor(FLEET_SCOPE)),
    releases: store.releases().map((r) => ({ tag: r.tag, channel: r.channel, bundleListed: r.bundleListed, yanked: r.yanked })),
    refusedByThisNode: new Set(store.refusalsFor(node.nodeId).map((f) => f.tag)),
  };
}

/** `code` is the fs errno (`EACCES`, `EROFS`, …) when the failure carries one — `null` for a thrown value
 *  that isn't a `NodeJS.ErrnoException` (fix round 1, finding 1; D-3217 records this field in the plan's
 *  own Interfaces block, which had fallen behind it). It is the STABLE half of the failure:
 *  `detail` embeds `e.message`, which for a `writeFile`/`rename` failure includes the tmp path — and that
 *  path embeds `process.pid` and `Date.now()` (below), so two failures of the SAME underlying condition
 *  never produce the same `detail` string. A caller that wants to dedupe repeated warnings compares on
 *  `why` + `code`, never on `detail`. */
export type WriteProjectionResult =
  | { ok: true; path: string }
  | { ok: false; why: 'unwritable'; detail: string; code: string | null };

/** tmp then ONE rename(2) — a symlink at the path is replaced, never followed; a directory there refuses.
 *  The tmp is dot-leading (every reader skips it) and removed on every failure arm. Never throws. */
export async function writeOwnProjection(ccrcDir: string, text: string): Promise<WriteProjectionResult> {
  const dest = path.join(ccrcDir, NODE_FILES.projection);
  const tmp = path.join(ccrcDir, `.${NODE_FILES.projection}.${process.pid}.${Date.now()}.tmp`);
  try {
    await mkdir(ccrcDir, { recursive: true });
    await writeFile(tmp, text, { mode: PROJECTION_FILE_MODE, flag: 'wx' });
    // Explicit, so a permissive umask cannot widen it and a narrow one cannot make it unreadable to us.
    await chmod(tmp, PROJECTION_FILE_MODE);
    await rename(tmp, dest);
    return { ok: true, path: dest };
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => { /* the refusal below is the answer */ });
    return {
      ok: false, why: 'unwritable', detail: e instanceof Error ? e.message : String(e),
      code: e instanceof Error ? (e as NodeJS.ErrnoException).code ?? null : null,
    };
  }
}

export type ProjectionOutcome =
  | WriteProjectionResult
  | { ok: false; why: 'no-channel'; detail: string }
  | { ok: false; why: 'not-server-role' }
  | { ok: false; why: 'no-server-row' };
export interface ResolveRunResult { resolved: number; refused: { nodeId: string; why: string }[]; projection: ProjectionOutcome }
export interface ProjectDeps { store: ProjectStore; role: NodeRole; ccrcDir: string }

async function projectOwn(deps: ProjectDeps, own: Resolution | null, now: number): Promise<ProjectionOutcome> {
  // A fleet-role server has no own projection: the fleet box's timer writes that one (W4).
  if (deps.role !== 'server' && deps.role !== 'both') return { ok: false, why: 'not-server-role' };
  if (own === null) return { ok: false, why: 'no-server-row' };
  // SECONDS (§9, the C1 lesson): the render time, floored — not the epoch row's ms issuedAt.
  const rendered = renderProjection(own, deps.store.updateEpoch().epoch, Math.floor(now / 1000));
  if (!rendered.ok) return { ok: false, why: 'no-channel', detail: rendered.detail };
  return writeOwnProjection(deps.ccrcDir, rendered.text);
}

/**
 * ONE RUN AT A TIME PER ~/.ccrc. Two callers reach this function with no lock between them: the inventory
 * run (`sweepThenProject`, inside `inventoryNow()`'s single-flight) and the update routes' `reproject`
 * (Task 13), which runs in the request that changed an input and never goes through the watcher. The
 * store half of a run is synchronous (`DatabaseSync`), but the file half is four awaited steps. So without
 * a queue, a sweep that snapshotted epoch E0 could finish its `rename` AFTER a route run that snapshotted
 * E1: the file would step back to the old epoch and channel until the next sweep, up to 60 s later. And two
 * writes in the same millisecond share a tmp name, so the `wx` loser's cleanup would delete the winner's tmp.
 * Every call therefore joins a per-directory chain. A run TAKES ITS SNAPSHOT only when the run before it has
 * renamed (or failed), so the document on disk is always the one taken last, and its epoch never goes down.
 * (An epoch re-check before the rename would not be enough: an ack or a catalogue change moves the desired
 * tags without bumping the epoch.) `now` is still the caller's, so a queued run renders its caller's clock.
 * A rejected run never wedges the chain: the next run starts on either settlement.
 */
const projectionRuns = new Map<string, Promise<ResolveRunResult>>();

/** Resolve + store every live node; then render and write the SERVER_LABEL row's document when role is
 *  'server' | 'both' — queued behind any run in flight for the same `ccrcDir` (see `projectionRuns`).
 *  The enqueue is synchronous, on the call, so call order is write order. */
export async function resolveAndProject(deps: ProjectDeps, now: number): Promise<ResolveRunResult> {
  const key = path.resolve(deps.ccrcDir);
  const prev = projectionRuns.get(key);
  const once = (): Promise<ResolveRunResult> => resolveAndProjectOnce(deps, now);
  const run = prev === undefined ? Promise.resolve().then(once) : prev.then(once, once);
  projectionRuns.set(key, run);
  const clear = (): void => { if (projectionRuns.get(key) === run) projectionRuns.delete(key); };
  void run.then(clear, clear);
  return run;
}

/** One run: a store refusal for one node (superseded between the read and the write) is reported in
 *  `refused` and never stops the others. Called only through `resolveAndProject`'s queue. */
async function resolveAndProjectOnce(deps: ProjectDeps, now: number): Promise<ResolveRunResult> {
  let resolved = 0;
  const refused: { nodeId: string; why: string }[] = [];
  let own: Resolution | null = null;
  for (const node of deps.store.nodes()) {
    const r = resolveNodeIntent(resolveInputFor(deps.store, node));
    const w = deps.store.resolveNode(node.nodeId, { channel: r.channel, desiredTag: r.desiredTag, resolveDetail: r.resolveDetail });
    if (w.ok) resolved += 1;
    else refused.push({ nodeId: node.nodeId, why: w.why });
    if (own === null && node.label === SERVER_LABEL) own = r;
  }
  return { resolved, refused, projection: await projectOwn(deps, own, now) };
}
