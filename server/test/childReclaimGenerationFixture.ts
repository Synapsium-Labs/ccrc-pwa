// Child reclamation wave 8 (spec §5.5, §5.6, §5.7): what the generation cases share —
// `child-reclaim-licence-executor.test.ts`, `child-reclaim-licence-lane.test.ts` and
// `child-reclaim-hold-retired-generation.test.ts`. Two generations of one workspace name; a MODEL of the
// fleet box's two reclaim verbs, wave 7's and an older ccd's; and a compact lane rig.
//
// The lane rig is `child-reclaim-sweep.test.ts`'s `fixture`, cut to what these cases need (that one is
// not exported): a real `FleetWatcher`, a real `CoordStore`, a registry under a fixture HOME, the REAL
// executor and the REAL release job on the watcher's own `KeyedQueue`, and a scripted ccd behind the
// agent's real exec whitelist (`testDeps`). The executor is reached through `Deps.childReclaimExec`,
// the watcher's one seam, composed exactly as `execChildReclaim` composes it, so that each request and
// its answer can be recorded. `child-reclaim-sweep.test.ts`'s "the production path" pins that
// composition. FIXTURE HOME ONLY: every path derives from `mkTmp`.
//
// THE ONE WATCHER RIG, the one shared lane rig. A later task that needs more of it adds an option to `LaneOpts`, or a
// member to what `laneFixture` returns, additively and in its own commit. It never builds a second
// `FleetWatcher` rig.
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { reclaimChild, type ChildReclaimOutcome, type ChildReclaimRequest } from '../src/coord/childReclaim.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { REG_GENERATION_SHAPE } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** Two generations of one workspace name: 36 characters each, `REG_GENERATION_SHAPE`'s grammar. */
export const G1 = '0a1b2c3d-0000-4000-8000-00000000000a';
export const G2 = '0a1b2c3d-0000-4000-8000-00000000000b';

export interface CcdAnswer { readonly code: number; readonly stdout: string; readonly stderr?: string }
/** Moments inside the two verbs where a case re-mints the slug. They are read when the verb runs, so a
 *  case sets them on the object it handed the model. */
export interface CcdHooks { beforeAudit?: () => void; beforeAct?: () => void; afterReclaim?: () => void }

/**
 * `ccd ws-audit --reclaim` and `ccd ws-reclaim` for ONE child, as the server sees them (spec §5.5).
 * - `wave7: true` is wave 7's ccd. The audit reads the row's generation as it stands, mints its token
 *   over it, and prints it as `generation`. An absent or malformed generation is the audit's
 *   `unmeasured`, at exit 1, with `generation: null` and no token. The verb recomputes the token under
 *   its lock, and refuses `state-changed` when the token no longer binds the row under the name.
 * - `wave7: false` is an older ccd. It prints no `generation` key, and its token binds no generation,
 *   so the token is spent on whatever row stands under the name.
 * This is a MODEL of the binding, never the binding: wave 7's `ccd-child-reclaim-row-generation.test.ts`
 * pins the real one on a real ccd. Any other argv answers `undefined`, and the caller answers it.
 */
export function modelCcd(o: { readonly reg: string; readonly id: string; readonly wave7: boolean; readonly hooks: CcdHooks }):
  (args: readonly string[]) => CcdAnswer | undefined {
  const file = (field: string): string => path.join(o.reg, `${o.id}.${field}`);
  const current = (): string | null => { try { return readFileSync(file('generation'), 'utf8'); } catch { return null; } };
  const tokenOf = (g: string | null): string =>
    createHash('sha256').update(o.wave7 ? `id=${o.id} generation=${g ?? ''}` : `id=${o.id}`).digest('hex');
  const listed = (): boolean => readdirSync(o.reg).includes(`${o.id}.uuid`);
  return (args) => {
    if (args[0] === 'ws-audit') {
      o.hooks.beforeAudit?.();
      if (!listed()) {
        return { code: 0, stdout: JSON.stringify({ id: o.id, mode: 'reclaim', childOf: null, verdict: 'no-such-session', detail: '' }) };
      }
      const head = { id: o.id, mode: 'reclaim', childOf: Number(readFileSync(file('child'), 'utf8')) };
      if (!o.wave7) return { code: 0, stdout: JSON.stringify({ ...head, verdict: 'reclaimable', detail: '', token: tokenOf(null) }) };
      const g = current();
      if (g === null || !REG_GENERATION_SHAPE.test(g)) {
        return { code: 1, stdout: JSON.stringify({ ...head, generation: null, verdict: 'unmeasured',
          detail: `${o.id}.generation could not be read as this row's generation` }) };
      }
      return { code: 0, stdout: JSON.stringify({ ...head, generation: g, verdict: 'reclaimable', detail: '', token: tokenOf(g) }) };
    }
    if (args[0] === 'ws-reclaim') {
      o.hooks.beforeAct?.();
      const spent = args[args.indexOf('--expect') + 1];
      if (!listed() || spent !== tokenOf(o.wave7 ? current() : null)) {
        return { code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'the token no longer binds this row' }) };
      }
      for (const n of readdirSync(o.reg)) if (n.startsWith(`${o.id}.`)) rmSync(path.join(o.reg, n), { recursive: true, force: true });
      o.hooks.afterReclaim?.();
      return { code: 0, stdout: JSON.stringify({ reclaimed: o.id, childOf: Number(args[args.indexOf('--child-of') + 1]),
        wip: null, attic: 2, residueBytes: null, secretsDropped: 0 }) };
    }
    return undefined;
  };
}

export interface LaneOpts {
  /** `ws-audit`/`ws-reclaim`, given the registry directory (`modelCcd`, or a script). `ws-release` is
   *  answered as `cmd_ws_release` answers it. Any other argv exits 1. */
  readonly ccd?: (reg: string) => (args: readonly string[]) => CcdAnswer | undefined;
  /** Someone is viewing this session: the executor's presence port. */
  readonly visible?: (id: string) => boolean;
  /** Runs after EVERY `readFileMeasured` the server makes, with its path, so a case can re-mint at an exact read. */
  readonly afterRead?: (p: string) => void;
}

/** ONE journal uid and cursor counter for every rig in a test file. A second rig over the same coord.db
 *  must never reuse a uid, because the mirror inserts OR IGNORE. */
let uidN = 0;
export const laneFixture = (opts: LaneOpts = {}) => {
  let clock = 1_790_000_000_000;
  let mono = 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-child-reclaim-generation-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const ccd = opts.ccd?.(reg);
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'ws-release') {
      const id = args[args.indexOf('--session') + 1] ?? '';
      try { rmSync(path.join(reg, `${id}.hold`)); return { code: 0, stdout: `released ${id}\n`, stderr: '' }; }
      catch { return { code: 0, stdout: `not held ${id}\n`, stderr: '' }; }
    }
    const a = ccd?.(args);
    return a === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` }
      : { code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
  };
  const base = testDeps(home, run);
  const io: FleetIO = {
    ...base.io,
    readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      const r = await base.io.readFileMeasured(p, timeoutMs, signal);
      opts.afterRead?.(p);
      return r;
    },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const fleetState: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
    ccdVerbs: ['ws-audit', 'ws-reclaim', 'ws-release', RECLAIM_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP] };
  const presence = { isVisible: (id: string) => opts.visible?.(id) === true };
  const requests: ChildReclaimRequest[] = [];
  const outcomes: ChildReclaimOutcome[] = [];
  const deps = {
    ...base, cfg, io, coord, fleetState, presence, monotonicMs: () => mono,
    childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
      requests.push(req);
      const o = await base.queue.run(req.sessionId, () => reclaimChild(
        { coord, io, cfg, runCcd: base.runCcd, fleetState, presence }, req));
      outcomes.push(o);
      return o;
    },
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  /** A registry row as ws-add writes it, with its `create` journalled. `extra` lands as `<id>.<field>`
   *  files: `child`, `hold`, `generation`. */
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = { uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1', ...extra };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    uidN += 1;
    const line = JSON.stringify({ uid: `w8.1.${uidN}`, at: clock, act: 'create', outcome: 'done', verb: 'ws-add', id });
    coord.ingestJournal({ gen: '1790000000000000000', rows: [parseJournalLine(line)], cursor: uidN * 200,
      size: uidN * 200, at: clock });
  };
  let progN = 0;
  const openRun = (): { id: number; program: string } => {
    const program = `w8-prog-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    return { id: r.id, program };
  };
  const abandon = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null,
      program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`abandon refused: ${JSON.stringify(res)}`);
  };
  /** A child of an abandoned run, carrying `generation` (`null`: no file). */
  const finishedChild = (id: string, generation: string | null): { id: number; program: string } => {
    const r = openRun(); abandon(r);
    plant(id, { child: String(r.id), ...(generation === null ? {} : { generation }) });
    return r;
  };
  /** The SAME row with its generation re-minted: a same-run re-mint, in the window where only the
   *  generation tells it apart (spec §5.6). */
  const remint = (id: string, g: string): void => { writeFileSync(path.join(reg, `${id}.generation`), g); };
  const listing = async () => ({ records: await readRegistry(io, cfg), names: readdirSync(reg) });
  const sweepOn = async (l: Awaited<ReturnType<typeof listing>>): Promise<void> => {
    await watcher.sweepChildReclaim(l.records, l.names);
  };
  const pass = async (): Promise<void> => { await sweepOn(await listing()); };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  const releases = (): string[][] => calls.filter((c) => c[0] === 'ws-release');
  return { reg, coord, watcher, calls, requests, outcomes, queue: base.queue, plant, openRun, abandon,
    finishedChild, remint, listing, sweepOn, pass, next, releases };
};
export type Lane = ReturnType<typeof laneFixture>;
