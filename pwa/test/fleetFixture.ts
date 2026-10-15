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
import type { FleetSession } from '../../shared/api';

export const fleetSession = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: null, name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  ctxPct: null, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null,
  substrate: null, started: true, spawnState: null, ask: null, usage: null,
  boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
  ...over,
});
