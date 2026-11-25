// The Overlord's body over ccd (Overlord W1, designation A, plan Task 4; spec §3.1, §3.2 C4). Ring L3, context C5: the ADAPTER of
// the `OverlordBody` port that `overlordRoutes.ts` declares. It is the one place that composes ccd for the Overlord: the
// project add, the named create, the route writes (the Settings door's `class` among them), the pool probe, the keep-awake markers, Restart's
// `ensure` (designation B) and the stop. It decides nothing about
// WHETHER to act (the decider and the doors do); it keeps every distinction ccd's answer gives it and says it in the port's words.
//
// FAILURE CONTRACT. No method throws: a runner that rejects, a reader that throws and a missing capability are each an answer.
// Every call asks its capability first (`ccdCan` for a verb row, `capSupported` for a flag's token) and answers `ok: false`
// with a detail, or `not-run` for the probe, when the deployed ccd lacks the word. An id the registry refuses is never composed.
//
// THE RUNNER PASSES NO `CLAUDECODE` (review M5). `cmd_route` refuses a pool-set write from a Claude Code session's shell
// (`pool-set-operator-only`), and the server and the agent are units, never such a session. A server started from a session's
// shell would carry the variable down to every child, so `withoutClaudeCode` takes it out of the environment for the one
// synchronous moment the child is started (an `execFile` reads the environment as it spawns), and puts it back.
import { isRegistryId, type ChildReclaimGeneration, type RouteFields } from '../../../shared/api.js';
import { OVERLORD_PROJECT, type OverlordModelClass } from '../../../shared/overlord-designation.js';
import {
  CCD_ARGV, WS_TITLE_CAP, WS_WRAPPER_CAP, capSupported, ccdCan, type ActorFlags, type CcdArgv,
} from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import { cutShort } from '../lifecycle.js';
import { parsePoolAnswer } from '../poolrule.js';
import { classifyProjectAddFailure } from '../projectAdd.js';
import type { SessionRecord, SingleRead } from '../registry.js';
import type { CcdResult, RunCcd } from './ports.js';
import { classifyAddFailure } from '../workspaceCreate.js';
import type { BodyAnswer, CreateAnswer, KeepAwakeAnswer, OverlordBody, StopAnswer } from './overlordRoutes.js';

/** The Overlord's display title, passed to `ws-add --title` (the named create's mark, which the sweep exempts). */
const OVERLORD_TITLE = 'Overlord';

/** `$REG/<id>.generation`, as `childReclaimGenerationRead` answers it (L0's one shape): the value, a proven absence, or a
 *  read that failed. */
export type GenerationRead = ChildReclaimGeneration;

/** What the adapter reaches, each narrow so a test hands fakes; the server binds each to its own read. */
export interface OverlordBodyDeps {
  readonly runCcd: RunCcd;
  /** The deployed ccd's caps, read at every call (the link mutates one state object in place). */
  readonly fleetState: () => Pick<FleetState, 'ccdVerbs'> | undefined;
  /** The projects ccrc lists; `null` is a listing that failed, which is never "the project is absent". */
  readonly projects: () => Promise<readonly string[] | null>;
  /** Called when `project-add` may have changed the listing (a success, an "exists", or a lost answer). */
  readonly projectsChanged?: () => void;
  /** One session's registry row (`readSessionRecord`): only its `kind` is read here. */
  readonly rowOf: (id: string) => Promise<Pick<SingleRead, 'kind'>>;
  /** `childReclaimGenerationRead`: the incarnation ccd minted for a made session. */
  readonly generationOf: (id: string) => Promise<GenerationRead>;
  /** The ensure route's asked-wake record (`admitWake('asked', id)` for a hibernated row), run before Restart's `ensure`. */
  readonly askedWake?: (id: string) => Promise<void>;
  /** `stopCreated` (below), built by the server from the stop route's own path. */
  readonly stop: (id: string) => Promise<StopAnswer>;
  /** The environment the runner's children inherit (the process's own); a test hands its own. */
  readonly env?: NodeJS.ProcessEnv;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const firstLine = (s: string): string => s.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';

/** Why a ccd call failed, in one line: the runner's own words for a call that never ran, else ccd's first line. */
function detailOf(verb: string, r: CcdResult): string {
  if (r.ran === false) return `${verb} did not run (${r.reason}): ${r.detail}`;
  const said = firstLine(r.stderr) || firstLine(r.stdout);
  return `${verb} exited ${r.exitCode ?? 'with an unmeasured code'}${said === '' ? '' : `: ${said}`}`;
}

/** `run`, with `CLAUDECODE` out of `env` while the child starts. The runner starts its child before its first await, so the
 *  window is one synchronous call; the variable is put back whatever the call does. */
export function withoutClaudeCode(run: RunCcd, env: NodeJS.ProcessEnv = process.env): RunCcd {
  return (argv) => {
    const had = Object.prototype.hasOwnProperty.call(env, 'CLAUDECODE');
    const value = env['CLAUDECODE'];
    delete env['CLAUDECODE'];
    try { return run(argv); } finally { if (had) env['CLAUDECODE'] = value; }
  };
}

export function ccdOverlordBody(deps: OverlordBodyDeps): OverlordBody {
  const run = withoutClaudeCode(deps.runCcd, deps.env);
  const state = () => deps.fleetState();
  const refuse = (detail: string): { ok: false; detail: string } => ({ ok: false, detail });

  /** One ccd call that cannot throw: a rejecting runner is a call that did not run. */
  async function ran(argv: CcdArgv): Promise<CcdResult> {
    try { return await run(argv); } catch (e) {
      return { ran: false, ok: false, stdout: '', stderr: '', killed: 'unmeasured', signal: 'unmeasured', reason: 'transport', detail: messageOf(e) };
    }
  }

  async function ensureProject(): Promise<BodyAnswer> {
    if (!ccdCan(state(), 'projectAddEmpty')) return refuse('the deployed ccd has no project-add');
    let names: readonly string[] | null;
    try { names = await deps.projects(); } catch { names = null; }
    // A listing that failed proves nothing about the project: it refuses, and no `project-add` runs.
    if (names === null) return refuse('the project listing could not be read, so the Overlord project was not added');
    if (names.includes(OVERLORD_PROJECT)) return { ok: true };
    const res = await ran(CCD_ARGV.projectAddEmpty(OVERLORD_PROJECT));
    if (res.ok) { deps.projectsChanged?.(); return { ok: true }; }
    const failure = classifyProjectAddFailure(res);
    if (failure !== 'other') deps.projectsChanged?.();
    if (failure === 'exists') return { ok: true };
    return refuse(failure === 'unknown' ? `project-add's answer was lost: ${detailOf('project-add', res)}` : detailOf('project-add', res));
  }

  /** The registry's word for a minted id, after a lost `ws-add` answer: a row is `yes`, a measured absence `no`, anything else `unknown`. */
  async function remeasured(id: string): Promise<'yes' | 'no' | 'unknown'> {
    try {
      const row = await deps.rowOf(id);
      return row.kind === 'found' ? 'yes' : row.kind === 'absent' ? 'no' : 'unknown';
    } catch { return 'unknown'; }
  }

  async function create(slug: string, id: string, wrapper: string, route: RouteFields, dec: ActorFlags | null): Promise<CreateAnswer> {
    if (!capSupported(state(), WS_TITLE_CAP) || !capSupported(state(), WS_WRAPPER_CAP)) {
      return { ...refuse('the deployed ccd cannot name a workspace or pick its account (ws-title-v1, ws-wrapper-v1)'), created: 'no' };
    }
    // Only the three fields the create may carry: ccd refuses `poolset` and `acctorder` on `--route`.
    const carried: RouteFields = { class: route.class, profile: route.profile, profiledigest: route.profiledigest };
    const res = await ran(CCD_ARGV.wsAddNamed(OVERLORD_PROJECT, slug, { title: OVERLORD_TITLE, wrapper }, carried, dec));
    if (!res.ok) {
      const detail = detailOf('ws-add', res);
      // A call that never started is a call that made nothing; a call cut short, or lost, may have made the session.
      if (res.ran === false && res.reason === 'spawn') return { ...refuse(detail), created: 'no' };
      if (res.ran === false || cutShort(res) !== false) {
        // A lost answer whose re-measure reads absent still owes the stop: ccd may yet make the session (review 2349 F3).
        const seen = await remeasured(id);
        return { ...refuse(`ws-add's answer was lost: ${detail}`), created: seen === 'no' ? 'unknown' : seen };
      }
      // ccd answered. Only its refusals made before the row exists answer `no`; ccd's own `spawn failed` (rc 3 to 6) says the session
      // exists, is claimed and is supervised, so it answers `yes`; every other failure is re-measured from the registry (review 2349 F1).
      const failure = classifyAddFailure(res);
      if (failure.kind === 'slug-taken' || failure.kind === 'bad-slug' || (failure.kind === 'account-refused' && !failure.leftBehind)) {
        return { ...refuse(detail), created: 'no' };
      }
      const spawned = res.exitCode !== undefined && res.exitCode >= 3 && res.exitCode <= 6 && res.stderr.includes(`ws-add spawn failed for ${id} `);
      return { ...refuse(detail), created: failure.kind === 'account-refused' || spawned ? 'yes' : await remeasured(id) };
    }
    let generation: GenerationRead;
    try { generation = await deps.generationOf(id); } catch { generation = { kind: 'unreadable' }; }
    if (generation.kind !== 'value') {
      return { ...refuse(`the session was made but its generation ${generation.kind === 'absent' ? 'is absent' : 'could not be read'}`), created: 'yes' };
    }
    return { ok: true, generation: generation.v };
  }

  /** The one `ccd route --set` composer. */
  async function setRoute(id: string, fields: RouteFields): Promise<BodyAnswer> {
    if (!isRegistryId(id)) return refuse('the session id is not a registry id');
    if (!ccdCan(state(), 'routeSet')) return refuse('the deployed ccd cannot write a route (route-v1)');
    const res = await ran(CCD_ARGV.routeSet(id, fields));
    return res.ok ? { ok: true } : refuse(detailOf('route', res));
  }

  async function writeSet(id: string, set: { poolset: string; acctorder: string }): Promise<BodyAnswer> {
    // One word, `pool-set`, says ccd takes both the pool answer and the set's route fields, so the row is the answer's.
    if (!ccdCan(state(), 'poolAnswer')) return refuse('the deployed ccd has no pool set (pool-set)');
    return setRoute(id, { poolset: set.poolset, acctorder: set.acctorder });
  }

  const clearProfile = (id: string): Promise<BodyAnswer> => setRoute(id, { profiledigest: '' });
  /** The model class Settings door's one route write (C45): `class` only, through the same composer; a box-token route write
   *  is what D-6790 refuses `fable` on, and this is the operator's door, never that one. */
  const writeClass = (id: string, cls: OverlordModelClass): Promise<BodyAnswer> => setRoute(id, { class: cls });

  async function poolAnswer(id: string): ReturnType<OverlordBody['poolAnswer']> {
    if (!ccdCan(state(), 'poolAnswer') || !isRegistryId(id)) return { kind: 'not-run' };
    const res = await ran(CCD_ARGV.poolAnswer(id));
    return parsePoolAnswer({ ran: res.ran, code: res.ran ? (res.exitCode ?? (res.ok ? 0 : 1)) : 1, stdout: res.stdout });
  }

  async function keepAwake(id: string, which: 'on' | 'off'): Promise<KeepAwakeAnswer> {
    if (!isRegistryId(id)) return refuse('the session id is not a registry id');
    if (!ccdCan(state(), 'keepAwake')) return refuse('the deployed ccd cannot keep a session awake (keep-awake-v1)');
    const res = await ran(CCD_ARGV.keepAwake(id, which));
    if (!res.ok) {
      // An unreadable marker answers rc 1 with its `kept <marker>: unreadable` line on stdout, and no `awake` line.
      const unread = res.stdout.split('\n').find((l) => l.startsWith('kept ') && l.includes('unreadable'));
      return refuse(unread === undefined ? detailOf('keep-awake', res) : `keep-awake could not read a marker: ${unread}`);
    }
    // Rc 0 says the line it ends with, `awake <id>` or `released <id>`; a call without it is not the verb's answer.
    const line = which === 'on' ? `awake ${id}` : `released ${id}`;
    if (!res.stdout.split('\n').includes(line)) return refuse(`keep-awake answered without its line (${line})`);
    // A marker someone else wrote stands (`kept-foreign <marker>`, rc 0): the call succeeded and every such marker is named, as
    // `no-hibernate` and `no-roll` can both be foreign (review 2349 F8).
    return { ok: true, foreign: [...res.stdout.matchAll(/^kept-foreign (\S+)$/gm)].map((m) => m[1]!) };
  }

  /** Restart's resume path (C23, designation B): `ccd ensure <id>`, as the ensure route composes it, with its asked wake recorded
   *  first. A wake that could not be recorded does not stop the resume. */
  async function ensure(id: string): Promise<BodyAnswer> {
    if (!isRegistryId(id)) return refuse('the session id is not a registry id');
    if (!ccdCan(state(), 'ensure')) return refuse('the deployed ccd cannot ensure a session');
    try { await deps.askedWake?.(id); } catch (e) { console.warn(`ccrc-server: the asked wake of ${id} was not recorded: ${messageOf(e)}`); }
    const res = await ran(CCD_ARGV.ensure(id));
    return res.ok ? { ok: true } : refuse(detailOf('ensure', res));
  }

  async function stop(id: string): Promise<StopAnswer> {
    try { return await deps.stop(id); } catch (e) { return { ok: false, detail: `the stop did not answer: ${messageOf(e)}` }; }
  }

  return { ensureProject, create, writeSet, writeClass, clearProfile, poolAnswer, keepAwake, ensure, stop };
}

// ── stopCreated ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** What `stopCreated` reaches. The three functions are the stop route's own (`server.ts`: `measuredIdentity`,
 *  `stopPairRefused`, `stopArgvFor`), handed over, so the route and this lane compose ONE argv and ask ONE refusal. */
export interface StopCreatedDeps {
  readonly read: (id: string) => Promise<SingleRead>;
  readonly runCcd: RunCcd;
  readonly identityOf: (rec: SessionRecord) => { readonly wrapper: string } | null;
  readonly pairRefused: (id: string, rec: SessionRecord, identity: { readonly wrapper: string }) => boolean;
  readonly argvFor: (id: string, rec: SessionRecord, identity: { readonly wrapper: string }) => CcdArgv;
}

/** `POST /api/sessions/:id/stop`'s own path for a body this lane created: the row, its measured identity, `stopArgvFor`, `runCcd`.
 *  It skips `decideStopClaims`: the Overlord claims no runs. `{ ok: true, absent: true }` is a registry that PROVES no row for the
 *  id; an unlistable registry, a row it could not assemble and a refused id are failures (the route answers the middle one
 *  `unknown-session` too, and this lane does not: a row that may exist is not a stopped body). Never throws. */
export function stopCreatedOf(deps: StopCreatedDeps): (id: string) => Promise<StopAnswer> {
  return async (id) => {
    try {
      const read = await deps.read(id);
      switch (read.kind) {
        case 'absent': return { ok: true, absent: true };
        case 'found': break;
        default: return { ok: false, detail: `the registry could not say whether ${id} has a row (${read.kind})` };
      }
      const identity = deps.identityOf(read.record);
      if (identity === null || deps.pairRefused(id, read.record, identity)) return { ok: false, detail: 'the registry row is unmeasurable' };
      const res = await deps.runCcd(deps.argvFor(id, read.record, identity));
      if (res.ran === false) return { ok: false, detail: detailOf('stop', res) };
      return res.ok ? { ok: true, absent: false } : { ok: false, detail: detailOf('stop', res) };
    } catch (e) {
      return { ok: false, detail: `the stop did not answer: ${messageOf(e)}` };
    }
  };
}
