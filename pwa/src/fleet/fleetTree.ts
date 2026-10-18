// THE FLEET TREE (D-5527): ONE pure model that decides, for both skins, which
// CARD each row renders on and which row is its PARENT. Refined's project cards
// and Instrument's project mode read the groups and rows it returns; Instrument's
// status mode reads `coordinationOf`/`workingOn` for a child it files under its
// own status. No skin re-derives a card or a parent.
//
// WHY IT EXISTS. Cross-project coordination (#601, D-5523) lets a coordinator in
// project A run a programme whose waves work in project B, so its dispatched
// children are workspaces of B. The server already places such a child on A's
// card — `boardPlacement` walks the run's stamp, and the stamp's `coordProject`
// is the CLAIMANT's own project (D-5523) — and `nestFleet` brackets it there.
// Measured on a cross-project fixture before this file: the child nested under
// its coordinator, but its row said nothing about whose code it works on (the
// repo label appears only when both repos are measured and differ), its label
// read "child of run #39" — the run that MINTED a workspace wave 5 had resumed —
// and its session header said nothing at all. And the decision was spread over
// four places that agreed by hand — `boardHome` in `groupFleet`, `FleetScreen`'s
// `cardOf` map for `runCard`, `groupFleet`'s `elsewhere`, and `nestFleet` —
// which Instrument's table (W2 S10) would have had to copy a fifth time.
//
// THE RULE (D-5527).
//   1. PARENT. A session's parent is the `claimedBy` of the ACTIVE run bound to
//      it (`runForSession`: the current wave, so a workspace resumed for wave 5
//      answers wave 5's run, not the run its `.child` mark names). Never itself.
//   2. CARD. Every row renders where the SERVER placed it (`boardHome`): for a
//      held child, its coordinator's project, durably across the wave boundary
//      and whether or not the coordinator is still a live row; otherwise its own
//      project. The client never overrides that placement. Measured and
//      rejected: following the live run's claimant client-side would also move
//      a child whose `boardProject` is null (an older server, or a failed
//      placement read, D-2875) — and that row's own card is where `orphanNote`
//      tells the operator its coordinator is dead and offers the reclaim
//      (fleet-screen's Task 8 cases). TOTAL: every row lands on a card.
//   3. NESTING is `nestFleet`'s, unchanged, over that card's live rows and the
//      runs whose worker renders on that card (`runCard`, over the same card
//      map), so the bracket and its run always reach the same card.
//   4. THE INDICATOR. A row whose own project differs from its card says whose
//      code it works on (`workingOn`). A same-project child, and every row of a
//      fleet with no programme, says nothing — today's rendering, unchanged.
//
// WHERE A CHILD GOES WHEN ITS COORDINATOR IS NOT A LIVE ROW (acceptance 4):
//   • stopped — a dead workspace coordinator is still a live-list row on the
//     same card, so the child stays bracketed under it;
//   • archived — the coordinator is in its card's Archived fold, so the child
//     renders on that card (the server's stamp still answers its project) at
//     top level, where `orphanNote` says the coordinator is gone;
//   • missing from the fleet — the same: the coordinator's project while the
//     stamp answers, top level, with the orphan marker; once nothing answers,
//     the child's own project. It keeps its indicator wherever it lands.
import { boardHome, type FleetSession, type RunSummary } from '../../../shared/api';
import type { Acks } from '../lib/seen';
import { groupFleet, type FleetGroup } from './groupFleet';
import { nestFleet, type FleetRow } from './nestFleet';
import { programmeWave, runCard, runForSession, runHomeProject, type ChildRunContext } from './runWords';
import { sessionLabel } from './sessionLabel';

/** Rule 1: the session id that coordinates this one, from the active run bound
 *  to it — `null` when no active run names it, or it names itself. */
export function parentIdOf(s: { id: string }, runs: readonly RunSummary[]): string | null {
  const by = runForSession(runs, s.id)?.claimedBy ?? null;
  return by === s.id ? null : by;
}

/** Rule 2: every session's card, by id — the server's placement. Built once
 *  per render from the WHOLE session list: a card sees only its own rows and
 *  cannot answer it, and `runCard` reads this same map, so a run reaches the
 *  card its worker renders on. */
export function cardsOf(sessions: readonly FleetSession[]): ReadonlyMap<string, string> {
  return new Map(sessions.map((s) => [s.id, boardHome(s)] as const));
}

/** Rule 4 for a row whose card is already known (a card component knows its
 *  own): the project whose code it works on, or `null` on its own project's card. */
export const workingOnCard = (s: { project: string }, card: string): string | null =>
  card === s.project ? null : s.project;

/** Rule 4: the project whose code this row works on, when its card does not
 *  already say so — `null` on its own project's card. */
export function workingOn(s: FleetSession, cards: ReadonlyMap<string, string>): string | null {
  return workingOnCard(s, cards.get(s.id) ?? boardHome(s));
}

/** What a child's programme-and-wave label is told (`childOfRunLabel`): the
 *  active run bound to it and its coordinator's display name, looked up
 *  FLEET-WIDE (`lookup`), because the coordinator may sit on another card or in
 *  a fold. */
export function childRunContext(
  s: { id: string }, runs: readonly RunSummary[], lookup: (id: string) => FleetSession | null,
): ChildRunContext {
  const pid = parentIdOf(s, runs);
  const parent = pid === null ? null : lookup(pid);
  return { run: runForSession(runs, s.id), coordinator: parent === null ? null : sessionLabel(parent) };
}

/** The runs `nestFleet` brackets by: a pending spawn (no session yet) and, per
 *  session, only the run `runForSession` answers — so the bracket's parent and
 *  `parentIdOf` are one rule, never two orders that disagree. */
const latestPerSession = (runs: readonly RunSummary[]): RunSummary[] =>
  runs.filter((r) => r.sessionId === null || runForSession(runs, r.sessionId) === r);

/** A card of the tree: `groupFleet`'s group, plus the rows `nestFleet` draws
 *  from it, the runs that drew them, and the runs this project is the HOME of
 *  that work on another card (`ProjectCard`'s `abroad`, spec §3 F4). */
export interface FleetTreeGroup extends FleetGroup {
  readonly rows: readonly FleetRow[];
  readonly runs: readonly RunSummary[];
  readonly abroad: readonly RunSummary[];
}

/** The fleet as cards of nested rows. `runs` is the ACTIVE runs. Pure. */
export function fleetTree(
  sessions: FleetSession[], projects: readonly string[], runs: readonly RunSummary[], acks: Acks = {},
): FleetTreeGroup[] {
  const cards = cardsOf(sessions);
  return groupFleet(sessions, projects, acks).map((g) => {
    const mine = runs.filter((r) => runCard(r, cards) === g.project);
    return {
      ...g,
      // Rule 1, ONE parent: the bracket reads only each session's LATEST active
      // run (`runForSession`, the run the label and header name), so a worker
      // two claimants' runs both name nests under the one its label says.
      rows: nestFleet(g.sessions, latestPerSession(mine)),
      runs: mine,
      // A run homed here and working elsewhere, minus one whose worker renders
      // on this very card — that run is a bracketed row here already (spec §6).
      abroad: runs.filter((r) => runHomeProject(r) === g.project && r.project !== g.project
        && runCard(r, cards) !== g.project),
    };
  });
}

/** What the session header says about who this session works for. */
export interface Coordination {
  /** Whose code it works on, when that is not the project it is shown under. */
  readonly workingOn: string | null;
  /** The coordinator's display name, when the fleet carries it. */
  readonly coordinator: string | null;
  /** The card the session renders on — the coordinator's project for a
   *  coordinated child, which names "where from" when the coordinator itself is
   *  not on the fleet. */
  readonly card: string;
  /** The active run bound to it — the programme and wave it is doing. */
  readonly run: RunSummary | null;
}

/** The header's facts for one session, or `null` when it is nobody's worker and
 *  nothing displaces it. Same rules as the tree, so the header and the row agree. */
export function coordinationOf(
  s: FleetSession, sessions: readonly FleetSession[], runs: readonly RunSummary[],
): Coordination | null {
  const ctx = childRunContext(s, runs, (id) => sessions.find((x) => x.id === id) ?? null);
  const cards = cardsOf([s]);
  const on = workingOn(s, cards);
  if (ctx.run === null && on === null) return null;
  return { workingOn: on, coordinator: ctx.coordinator, card: cards.get(s.id) ?? boardHome(s), run: runForSession(runs, s.id) };
}

/** The session header's line, in words (acceptance 2): `working on project-b ·
 *  coordinated from <coordinator> · port-api · wave 5 of 7 · run #41`. The run
 *  number lives HERE, in the session's details, since the fleet row names the
 *  programme and wave instead (operator ruling 2026-10-18). A coordinator the
 *  fleet does not carry is named by its project (the card), never guessed. */
export function coordinationLine(c: Coordination): { text: string; parts: readonly string[]; title: string } {
  const parts: string[] = [];
  if (c.workingOn !== null) parts.push(`working on ${c.workingOn}`);
  const from = c.coordinator ?? (c.workingOn !== null ? c.card : null);
  if (from !== null) parts.push(`coordinated from ${from}`);
  if (c.run !== null) parts.push(programmeWave(c.run), `run #${c.run.id}`);
  const whose = c.workingOn === null ? 'this project’s' : `${c.workingOn}’s`;
  const title = c.run === null
    ? `this workspace works on ${whose} code and is shown under ${c.card}, its coordinator’s project; no open run names it`
    : `this workspace ${c.run.kind === 'review' ? 'reviews' : 'does'} one wave of ${c.run.programTitle !== '' ? c.run.programTitle : c.run.program} on ${whose} code for ${c.coordinator ?? `a coordinator in ${c.card}`}; it is stopped or reclaimed when the wave is done`;
  return { text: parts.join(' · '), parts, title };
}
