// The run binding a fixture session carries: what the current server sends for it (D-7182, D-7461; Task C7d; ARCH-61's
// PWA half, GitHub #796; consolidation spec §3 K10). D-7461 is the coordinator's ruling that re-points the fixtures
// written before the wire carried the binding, in one commit before C7d's behaviour commits, with no assertion changed.
//
// WHY. Since ARCH-61's server half (#1546) every fleet session carries `run` and `openRun`, the newest and the newest
// open run bound to its INCARNATION (`server/src/coord/runBinding.ts#bindingOf`), and since C7d the PWA reads which run
// is a session's from them alone (`fleet/runWords.ts#workerOf`, `#boundOpenRun`). Fixtures written before that built
// sessions with no binding key, which is the shape an OLDER server sends: on it an open run finds no worker (the skew
// row). A fixture that means a current server says so by carrying the binding, and this module gives it the one the
// server would send over the same runs, so a row keeps the meaning it had when the PWA guessed the binding itself.
//
// THE RULE, the server's over the columns a fixture has. A run binds the session when it names the session's id and,
// for a child whose `.child` mark names its minting run, was not opened before that run (run ids only increase with
// `openedAt`, so "opened before the minting run" is "a lower id"): `bindsRun`'s `openedAt >= bornAt` arm, with the
// incarnation born at the minting run. A session with no placeable mark (`none`, `unreadable`, `unrecognised`) is
// `unborn` and keeps the id-string rule. `run` is the newest bound run in any state, `openRun` the newest bound run
// outside `TERMINAL_RUN_STATES` (a state this build cannot name counts as open). `server/test/w7-run-binding-parity.test.ts`
// holds this rule equal to `bindingOf`.
//
// Pass EVERY run the server would know of (the live slice and any closed run the fixture holds): the binding is a fact
// about the series, not about the slice one screen is shown.
import { TERMINAL_RUN_STATES, type ChildMark, type FleetSession, type RunState, type SessionRun } from '../../shared/api';

/** The run columns the rule reads. */
export interface BindingRunFacts {
  readonly id: number;
  readonly sessionId: string | null;
  readonly state: RunState;
  readonly claimedBy: string | null;
}

/** The minting run a session's `.child` mark names, or `null` (the session is `unborn`: the id-string rule). */
function mintingRun(child: ChildMark | undefined): number | null {
  const c: unknown = child;
  if (c === null || typeof c !== 'object') return null;
  const o = c as { kind?: unknown; runId?: unknown };
  return o.kind === 'child' && typeof o.runId === 'number' && Number.isSafeInteger(o.runId) ? o.runId : null;
}

const isOpen = (r: BindingRunFacts): boolean => !(TERMINAL_RUN_STATES as readonly string[]).includes(r.state);
const asBound = (r: BindingRunFacts): SessionRun => ({ id: r.id, state: r.state, claimedBy: r.claimedBy });

/** Whether `run` binds this session, by the rule above. */
export function bindsSession(session: { readonly id: string; readonly child?: ChildMark }, run: BindingRunFacts): boolean {
  if (run.sessionId !== session.id) return false;
  const minter = mintingRun(session.child);
  return minter === null || run.id >= minter;
}

/** The server's binding for one session over `runs`: the newest bound run and the newest open one. */
export function serverBinding(
  session: { readonly id: string; readonly child?: ChildMark }, runs: readonly BindingRunFacts[],
): { run: SessionRun | null; openRun: SessionRun | null } {
  const bound = runs.filter((r) => bindsSession(session, r)).sort((a, b) => b.id - a.id);
  const open = bound.find(isOpen);
  return { run: bound[0] === undefined ? null : asBound(bound[0]), openRun: open === undefined ? null : asBound(open) };
}

/** Each session with the binding the current server would send over `runs`. A session that already carries a binding
 *  key keeps it (the fixture said what it means). */
export function withRunBinding<S extends FleetSession>(sessions: readonly S[], runs: readonly BindingRunFacts[]): S[] {
  return sessions.map((s) => ('run' in s || 'openRun' in s ? s : { ...s, ...serverBinding(s, runs) }));
}

/** A fleet store whose `setState` writes sessions as a current server's frames carry them: a patch that sets `sessions`
 *  binds each over the runs the store holds once the patch lands (`patch.runs`, or the runs already there). A patch
 *  that sets only `runs` leaves the sessions as they are. Returns the same store. */
export function withBindingFrames<T extends { setState: (patch: never, replace?: never) => void; getState: () => { runs: readonly BindingRunFacts[] } }>(store: T): T {
  const setState = store.setState.bind(store) as (patch: unknown, replace?: unknown) => void;
  (store as { setState: unknown }).setState = (patch: unknown, replace?: unknown): void => {
    if (patch !== null && typeof patch === 'object' && 'sessions' in patch && Array.isArray((patch as { sessions: unknown }).sessions)) {
      const p = patch as { sessions: FleetSession[]; runs?: readonly BindingRunFacts[] };
      setState({ ...p, sessions: withRunBinding(p.sessions, p.runs ?? store.getState().runs) }, replace);
      return;
    }
    setState(patch, replace);
  };
  return store;
}
