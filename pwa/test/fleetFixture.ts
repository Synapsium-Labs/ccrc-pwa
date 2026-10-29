// ONE `FleetSession` fixture, because there were thirty-three.
//
// Every test file that touches the board hand-rolled the same 45-field
// literal — measured: 33 copies, each a `(over) => ({ …45 fields…, ...over })`
// whose only real content was an id, a project and a workspace. The other
// forty-odd fields were identical in 30 or more of them, so adding a field to
// `FleetSession` meant 33 edits that each said the same thing.
//
// WHAT THIS DOES NOT WEAKEN, and the reason it is safe. The compile-time
// guarantee for a new wire field does not live in these fixtures: it lives in
// `reviveFleetSession`, which returns a LITERAL, so a new field is a compile
// error there until every path computes it (CLAUDE.md's wire-discipline rule).
// What the 33 copies added on top of that was 33 chances to drift — a fixture
// that still said `child: null` after the mark became a union, say — and a
// one-line edit that reads as 33 decisions.
//
// EACH CALLER KEEPS ITS OWN IDENTITY. The defaults here are the values the
// majority of those copies already used, and every file still names the id,
// project, workspace and status its own cases are about: those ARE the test's
// subject, and collapsing them into a shared default would be the mistake this
// file is not making.
//
// PRESENCE IS DERIVED, never defaulted (D-7181; plan Task C7c Step 1; ARCH-49). When the caller passes no `presence`
// key, the row's own `status`, `lifecycle`, `hibernatedAt` and `substrate` are read back through the inverse rule
// `presenceTable.ts` states once (`tablePresence`), so a fixture carries the word the server's assembly would send for
// the same row (`server/test/w7-presence-parity.test.ts` holds that rule to `assembleFleet`). A dead row with no
// lifecycle is the old-server skew row: the rule leaves `presence` absent on it, as such a server does, so it reads
// `unknown`. A case that means an unknown pane passes `presence: 'unknown'` itself; a case that means an old server
// passes `presence: undefined` (the key, so nothing is derived).
import type { FleetSession } from '../../shared/api';
import { tablePresence } from './presenceTable';

export const fleetSession = (over: Partial<FleetSession> = {}): FleetSession => withPresence(over, ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: null, name: null, title: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  ctxPct: null, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null,
  graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null,
  substrate: null, started: true, spawnState: null, ask: null, usage: null,
  boardProject: null, route: null, child: { kind: 'none' }, role: null, releasedFrom: null,
  ...over,
}));

/** The row with the presence the inverse rule gives it, unless the caller named the key itself. */
function withPresence(over: Partial<FleetSession>, row: FleetSession): FleetSession {
  if ('presence' in over) return row;
  const presence = tablePresence(row);
  return presence === undefined ? row : { ...row, presence };
}

/** A row `ccd hibernate` put to sleep (D-5242), in the shape the server assembles it: `.stopped` (lifecycle `stopped`,
 *  the sweep's declared `agent` stamp) plus `.hibernated` (`hibernatedAt`), and the pane gone, so status and bucket
 *  `dead`. `at` is the marker's epoch MS; the caller names its own id, project and anything else its case is about. */
export const hibernatedSession = (at: number, over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  status: 'dead', bucket: 'dead', lifecycle: 'stopped', stoppedBy: { at, surface: 'agent' }, hibernatedAt: at,
  ...over,
});

/** The lifecycle a dead fixture names when its case is not about which death it was: `orphan` (nothing is bringing the
 *  pane back), one `sessionLifecycle` returns for a pane that is not live and `lifecycleIsDead` calls dead, so the
 *  derivation reads the row `dead` as the server does. Measured (C7c Step 1b): it keeps every listed suite green on the
 *  code that reads `status`. A case whose words depend on the cause names its own lifecycle. */
export const DEAD_LIFECYCLE = 'orphan' as const;

/** A row whose pane is gone and that the server reads `dead`: status and bucket `dead` under a dead lifecycle, not the
 *  lifecycle-null skew row an old server sends (D-7181, plan Task C7c Step 1; ARCH-49). */
export const deadSession = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  status: 'dead', bucket: 'dead', lifecycle: DEAD_LIFECYCLE,
  ...over,
});
