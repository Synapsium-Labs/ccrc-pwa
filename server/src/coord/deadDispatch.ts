// D-7319 (operator ruling 2026-10-29): WHEN A DISPATCH THAT NEVER CAME BACK IS DEAD. L1 policy: one pure verdict over
// facts the executor (`abandonDeadDispatch.ts`) gathered, and nothing else. It makes no I/O and imports only types.
//
// The fleet card draws a run's phantom child, "spawn never completed", while the run is `planned`, carries a
// `dispatchStartedAt` older than `SPAWN_STALL_MS` and binds no session (`dispatchWindow`, `pwa/src/fleet/runWords.ts`).
// That is a DISPLAY: the dispatch may still be binding, a workspace may stand that the run never learned of, or the box
// may never mark its workspaces. The act abandons only a run PROVEN dead, and every doubt keeps it. In order:
//   1. the switch: Settings' choice must read exactly `on`, and the fleet's cleanup pause (`reclaim-paused`) must be
//      measured clear; an unlistable registry is not clear;
//   2. the run itself: still `planned`, no session bound, a dispatch stamp, and a coordinator to tell (`claimedBy`);
//   3. NOTHING IN FLIGHT: the stamp is at least `boundMs` old. The bound's floor is `SPAWN_STALL_MS` (config), and that
//      is at or above the `ws-add` ceiling the runner and the agent enforce, so the `ws-add` started at that stamp has
//      returned or been killed. A retry restamps the run, so a dispatch started since reads young again. The executor
//      runs this verdict a second time INSIDE the coordination serialiser, which every dispatch holds for its whole
//      length, so no dispatch of this server is between its `ws-add` and its bind at that read;
//   4. a box that marks its workspaces: a dispatch journaled `child-omitted:` minted a workspace no marker names, so the
//      registry cannot prove there is none;
//   5. NO WORKSPACE for the run, in a registry that was measured whole: no row whose `.child` marker names this run, no
//      row of the run's project whose marker is unreadable, and no row of the run's project that looks like a cut-short
//      `ws-add` left it (a workspace with no marker, no hold and no spawn yet: `cmd_ws_add` writes the rows, then the
//      marker, then spawns the pane, so a kill between leaves exactly that shape).
//
// D-7563 (operator ruling 2026-10-30): A RETURNED CHILD IS BOUND, NOT KEPT FOREVER. Step 5's first half used to keep a
// run with a child workspace for good: the `ws-add` came back (its `.child` marker names the run, its pane runs) but the
// run never bound its session, so the card drew "spawn never completed" with no end. When EXACTLY ONE row's marker names
// the run, that row is a measured workspace of the run's own project, its pane measured `live`, and NO run names its
// session yet, the verdict is `bind` to that session, and the executor binds through the spawn arm's own store write.
// Every other shape keeps today's answer, `child-workspace`: two such rows, a pane not live or not asked, a session some
// run already names (or whose runs could not be read), a row not of the run's project or not measured, a row with a
// hold (a claim someone placed, or a hold that could not be read: a run that never bound placed none, so a hold is
// someone else acting on it, the adopted arm's own `held === null`), and a session this run's journal says was once
// unbound from it (`session-unbound:`, the resume arm's workspace-spent unbind: binding it back would ping-pong with
// that arm). The executor then asks the child bind gate (`childBind.ts`) before it writes: a spent child never binds.
// A marker that names ANOTHER run is not this run's child at all, exactly as before. Every guard above step 5 still
// comes first, so a bind needs the switch on, the pause clear, the bound passed, a marking box and a registry read whole.
import type { ChildMark } from '../../../shared/api.js';
import { isDispatchAbandonChoice, isDispatchAbandonRefusal, type DispatchAbandonView } from '../../../shared/dispatch-abandon.js';

/** The switch's row as the store read it (`CoordStore.dispatchAbandonSetting`), declared here by its consumer: the raw
 *  stored token and write time, a lost row, or a read that failed. */
export type DispatchAbandonRead =
  | { readonly kind: 'row'; readonly choice: unknown; readonly updatedAt: number | null }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The one reading of the switch, for the route's view and the executor alike: armed only by an exact `on`. */
export function dispatchAbandonViewOf(read: DispatchAbandonRead, boundMs: number): DispatchAbandonView {
  if (read.kind === 'absent') return { stored: 'absent', detail: null, armed: false, boundMs, updatedAt: null };
  if (read.kind === 'unreadable') return { stored: 'unreadable', detail: read.detail, armed: false, boundMs, updatedAt: null };
  const stored = isDispatchAbandonChoice(read.choice) ? read.choice : 'unknown';
  return { stored, detail: null, armed: stored === 'on', boundMs, updatedAt: read.updatedAt };
}

/** The run's fields the verdict reads. */
export interface DeadDispatchRun {
  readonly id: number;
  readonly state: string;
  readonly project: string;
  readonly sessionId: string | null;
  readonly dispatchStartedAt: number | null;
  readonly claimedBy: string | null;
}

/** One registry row's fields the verdict reads. `identityMeasured` is `measuredIdentity(r) !== null`. */
export interface DeadDispatchRecord {
  readonly id: string;
  readonly project: string;
  readonly workspace: string | null;
  readonly child: ChildMark;
  readonly held: string | null;
  readonly spawned: boolean;
  readonly identityMeasured: boolean;
}

/** The registry as the executor read it: listed (with its refused-name count and the two switches' states) or not. */
export type DeadDispatchRegistry =
  | { readonly listed: false }
  | { readonly listed: true; readonly refused: number; readonly records: readonly DeadDispatchRecord[];
      readonly pause: 'set' | 'clear' | 'unmeasurable' };

/** D-7563: what the executor measured of the ONE row whose marker names the run, beyond the registry: its tmux pane
 *  (`live`, `gone`, or `unknown` when tmux could not say), and how many runs already name its session (`unreadable`
 *  when the store could not say). Measured only when exactly one row names the run; absent, nothing binds. */
export interface ReturnedChildFacts {
  readonly id: string;
  readonly pane: 'live' | 'gone' | 'unknown';
  readonly namedBy: number | 'unreadable';
  /** The run's journal carries a `session-unbound: <id>` event for this session: the server found it spent for this
   *  run once and unbound it, so it is never bound back. */
  readonly unboundBefore: boolean;
}

export interface DeadDispatchFacts {
  /** Settings' switch: `true` only when the stored choice reads exactly `on`. */
  readonly armed: boolean;
  readonly run: DeadDispatchRun;
  /** The run's journal carries a `child-omitted:` event: a box that minted it without a marker. */
  readonly childOmitted: boolean;
  readonly registry: DeadDispatchRegistry;
  /** D-7563: the one child's measured facts; absent when no single child was measured. */
  readonly returned?: ReturnedChildFacts;
  readonly now: number;
  readonly boundMs: number;
}

/** Why a run is kept, spelled once as a total table's keys and the list derived. */
const DEAD_DISPATCH_KEEP_TABLE = {
  'switch-off': true,
  'paused': true,
  'run-unreadable': true,
  'not-planned': true,
  'bound': true,
  'no-stamp': true,
  'in-flight': true,
  'unclaimed': true,
  'unmarked-box': true,
  'registry-unmeasured': true,
  'child-workspace': true,
  'marker-unreadable': true,
  'possible-target': true,
} as const;
export type DeadDispatchKeep = keyof typeof DEAD_DISPATCH_KEEP_TABLE;
export const DEAD_DISPATCH_KEEPS: readonly DeadDispatchKeep[] = Object.keys(DEAD_DISPATCH_KEEP_TABLE) as DeadDispatchKeep[];

/** The kebab words this act spells as literals in `server/src/coord` (its keep reasons and its door's refusals), for
 *  `mail-routes.test.ts`'s scan: none is a mail rejection or a run refusal. */
export const isDeadDispatchKebab = (tok: string): boolean =>
  (DEAD_DISPATCH_KEEPS as readonly string[]).includes(tok) || isDispatchAbandonRefusal(tok);

export type DeadDispatchVerdict =
  | { readonly kind: 'dead'; readonly claimedBy: string; readonly startedAt: number }
  | { readonly kind: 'bind'; readonly sessionId: string; readonly claimedBy: string; readonly startedAt: number }
  | { readonly kind: 'keep'; readonly why: DeadDispatchKeep; readonly detail?: string };

const keep = (why: DeadDispatchKeep, detail?: string): DeadDispatchVerdict =>
  (detail === undefined ? { kind: 'keep', why } : { kind: 'keep', why, detail });

/** The one verdict. Every doubt keeps the run (the module comment's five steps, in that order). */
export function deadDispatchVerdict(f: DeadDispatchFacts): DeadDispatchVerdict {
  if (!f.armed) return keep('switch-off');
  if (!f.registry.listed) return keep('registry-unmeasured', 'the registry could not be listed');
  if (f.registry.pause !== 'clear') return keep('paused');
  const run = f.run;
  if (run.state !== 'planned') return keep('not-planned');
  if (run.sessionId !== null) return keep('bound');
  if (run.dispatchStartedAt === null) return keep('no-stamp');
  if (f.now - run.dispatchStartedAt < f.boundMs) return keep('in-flight');
  if (run.claimedBy === null) return keep('unclaimed');
  if (f.childOmitted) return keep('unmarked-box');
  if (f.registry.refused > 0) return keep('registry-unmeasured', `${f.registry.refused} listed name(s) refused`);
  const children = f.registry.records.filter((r) => r.child.kind === 'child' && r.child.runId === run.id);
  if (children.length > 0) {
    const c = children[0]!;
    const back = f.returned;
    const bindable = children.length === 1 && back !== undefined && back.id === c.id && back.pane === 'live'
      && back.namedBy === 0 && !back.unboundBefore && c.held === null
      && c.project === run.project && c.workspace !== null && c.identityMeasured;
    if (!bindable) return keep('child-workspace', children.map((r) => r.id).join(', '));
    return { kind: 'bind', sessionId: c.id, claimedBy: run.claimedBy, startedAt: run.dispatchStartedAt };
  }
  for (const r of f.registry.records) {
    if (r.project !== run.project) continue;
    if (!r.identityMeasured) return keep('registry-unmeasured', r.id);
    if (r.child.kind === 'unreadable') return keep('marker-unreadable', r.id);
    if (r.child.kind === 'none' && r.workspace !== null && r.held === null && !r.spawned) return keep('possible-target', r.id);
  }
  return { kind: 'dead', claimedBy: run.claimedBy, startedAt: run.dispatchStartedAt };
}
