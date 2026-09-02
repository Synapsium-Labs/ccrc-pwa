import type { CcrcConfig } from '../config.js';
import type { SessionVerdict } from '../exec.js';
import { lifecycleInputFor } from '../fleet.js';
import type { FleetIO } from '../io.js';
import { readSessionRecord } from '../registry.js';
import type { CoordStore } from './store.js';
import { lifecycleIsDead, sessionLifecycle } from '../../../shared/api.js';

/**
 * L1 decision function (architecture doc increment 4 — "deciding split from
 * acting"): everything `POST /api/runs/:id/reclaim` decides, as a named function
 * with narrowed deps in and a typed union out. Same model as `dispatch.ts`'s
 * `dispatchRun` and `close.ts`'s `closeRun` — no `reply` anywhere below, and the
 * route reduced to a union->status map.
 *
 * WHY IT IS A MODULE OF ITS OWN rather than a few lines in the route, which is
 * the argument `kickoff.ts:12-20` already makes for its own existence: the ladder
 * below is the only thing between an operator's tap and the overwrite of the one
 * column that says who owns a program. Inside a Fastify closure it could only
 * ever be tested through HTTP — at the granularity of the ANSWER, never of the
 * RUNG — and the rungs are the guard.
 *
 * HOLDS NO HANDLE. `single-definition.test.ts:402-437` licenses five files in
 * this directory to touch the coordination database; this is not one of them, so
 * the whole reclaim commit lives in `CoordStore.reclaimProgram` as one
 * transaction and this file only decides whether to call it.
 *
 * ONE IMPORT IS WORTH A SENTENCE: `lifecycleInputFor` is value-imported from
 * `../fleet.js`, which itself value-imports `configDirFor` from `../config.js`,
 * which imports `./db.js` — the transitive edge `dispatch.ts:60-73` declared a
 * port to avoid. It is taken deliberately here: the alternative is a fifth dep
 * for a pure function whose whole content is a x1000 and a field rename, and an
 * optional port a caller forgot to wire is the fail-quiet `DispatchRunDeps.configDir`
 * refuses to allow. The coord-ring scanner still holds — nothing below imports
 * `./db.js` or `node:sqlite`, and no database handle is named on a store receiver.
 */
export interface ReclaimDeps {
  coord: CoordStore;
  io: FleetIO;
  cfg: CcrcConfig;
  /**
   * The tmux port, narrowed to ONE method by the consumer — and narrowed to
   * `sessionVerdict` SPECIFICALLY. `Tmux` also carries `hasSession`, whose own
   * docstring forbids it here in as many words (exec.ts:117-120): "A caller that
   * handles `gone` differently from `unknown` must use `sessionVerdict` instead."
   * This caller is exactly that caller — `gone` continues to the lifecycle rung,
   * `unknown` refuses outright — and `hasSession` answers `false` to both, so a
   * ladder built on it reports a tmux server that never answered as proof the
   * coordinator died. A port that cannot EXPRESS the boolean is a port a later
   * edit cannot regress into it.
   */
  tmux: { sessionVerdict(id: string): Promise<SessionVerdict> };
}

/** THREE answers, never two. `why` is the sentence the route sends as `detail`, so the evidence
 *  survives the collapse to a code — `alive` is reached from a live tmux pane AND from a
 *  gone-but-restarting lifecycle, and those two are the same ANSWER (do not reclaim) told apart by
 *  this string, not by a fourth arm nobody would branch on.
 *
 *  THE CENSUS, because the guard IS which input lands where (corrected by D-1144 — the `dead` arm
 *  used to be written as "a registry that LISTED and carried no row", which is what `SingleRead`
 *  SAYS and not what it MEANS):
 *    `dead`         — a registry that listed and did not name `<id>.uuid` AT ALL, re-confirmed by a
 *                     second listing; or a listed row whose pane tmux calls gone and whose lifecycle
 *                     is one of the three words `lifecycleIsDead` names (`stopped`, `orphan`,
 *                     `never-started`).
 *    `alive`        — tmux says the pane is live; or the pane is gone and the lifecycle reads
 *                     `running`, `unsupervised`, `unclaimed`, `restarting` or `unmeasurable`.
 *                     `restarting` is the arm this file exists to keep.
 *    `unmeasurable` — the registry directory did not list at all; or it listed `<id>.uuid` while the
 *                     row behind it could not be ASSEMBLED (D-1144, the arm below); or the
 *                     re-listing that tells those two apart failed; or tmux did not answer.
 *                     Doubt is not evidence, in either direction: the identical line
 *                     `LIFECYCLE_DEAD` draws for its own `unmeasurable` key (shared/api.ts:1666-1668),
 *                     drawn again for the whole ladder. */
export type ClaimantVerdict =
  | { state: 'dead'; why: string }
  | { state: 'alive'; why: string }
  | { state: 'unmeasurable'; why: string };

/**
 * Is the session that owns this program still there?
 *
 * THE LADDER IS `watch.ts`'s MAIL SWEEP, rung for rung, deliberately: that loop
 * (`sweepMail`, watch.ts:2205+) already answers this exact question about a mail
 * recipient, it was corrected twice on live evidence (D-309 for the tmux
 * collapse, D-1066 for the lifecycle rung), and a second, subtly different ladder
 * deciding a strictly MORE destructive act is the drift this repo files as a
 * defect. Its own words, at watch.ts:2476-2481: "`gone` — tmux itself said the
 * recipient's pane does not exist — stays the ordinary silent gate … `unknown` —
 * tmux DID NOT ANSWER — must not wear the same bare `continue`". And at
 * watch.ts:2501-2507: "The question is NOT 'is the pane gone' … but 'is it
 * coming back'".
 *
 * WHY `readSessionRecord` AND NOT `readRegistry`. `readRegistry`
 * (registry.ts:853-856) is two lines over `readRegistryMeasured` ending
 * `r.listed ? r.records : []` — an unlistable directory arrives wearing the exact
 * shape "nobody is in the registry" wears. Fed to this ladder it reports a
 * fleet-wide outage as proof the coordinator is gone: the fail-open `dispatchRun`
 * already had to close on its own registry read (dispatch.ts:462-480, blocking
 * review finding 7). `readSessionRecord` (registry.ts:895) answers `unlistable`
 * and `absent` separately (`SingleRead`, registry.ts:863-866), and nothing below
 * re-collapses them — but `absent` is ITSELF a fold, of three conditions that do
 * not all mean the claimant is gone, so rung 1 re-splits it at the consumer
 * rather than trusting the word. The argument is D-1144 in the body; the debt
 * that split leaves unpaid is D-1145 beside it.
 *
 * `nowMs` IS MILLISECONDS, and the parameter name is the guard (fleet.ts:175-185).
 * Every registry stamp is epoch seconds, `lifecycleInputFor` owns the one x1000,
 * and a caller that hands it seconds places every stamp ~55 years in the future —
 * which `sessionLifecycle`'s `>= 0` freshness guard reads as NOT fresh. The
 * failure is silent AND it points the wrong way: `restarting` collapses to
 * `orphan`, `orphan` is dead, and the reclaim proceeds against a session a
 * supervisor is in the middle of bringing back.
 */
export async function measureClaimant(
  deps: ReclaimDeps, id: string, nowMs: number,
): Promise<ClaimantVerdict> {
  const read = await readSessionRecord(deps.io, deps.cfg, id);
  if (!read.found) {
    if (read.reason === 'unlistable') {
      return { state: 'unmeasurable',
        why: 'the registry directory could not be listed — transient, not a fact about the claimant' };
    }
    // D-1144 — RUNG 1 ANSWERS THREE WAYS, AND THE THIRD IS THE ONE THAT MATTERS.
    // `SingleRead`'s `absent` is THREE conditions wearing one shape
    // (registry.ts:895, three `reason: 'absent'` returns): the listing did not
    // name `<id>.uuid` at all — a PROVEN absence; `buildRecord` came back null
    // for a row the listing DID name — its own docstring's "a session mid-write
    // or mid-teardown", a triple member that is empty or not yet written; and
    // the identity reconfirm's twice-observed absence. The first and third are
    // deaths. THE SECOND IS A LIVE COORDINATOR caught between two `_reg_set`
    // writes, and answering `dead` for it hands its program away under the
    // sentence "no registry row in a directory that listed cleanly" — which is
    // FALSE about that input, and false in the one direction this door may not
    // be wrong in, because `dead` PROCEEDS.
    //
    // The split is one `readdir` at the consumer — the same evidence, in the
    // same direction, that the mail ingress already draws for the same fold
    // (routes.ts:578-585: `names.includes(<toId>.uuid)` -> 502
    // `registry-unmeasurable`, otherwise 404 `unknown-recipient`). It sits AHEAD
    // of the tmux consultation deliberately: a pane's absence must not get to
    // speak about a row the registry itself is still writing, and the rung that
    // guards a destructive act is the rung that pays an extra round trip.
    //
    // A re-listing that FAILS answers `unmeasurable` too, and that arm is not a
    // formality. The first listing knew which of the three conditions fired and
    // `SingleRead` dropped that fact, so a failed second listing leaves the
    // question genuinely unanswered — fail-shut is the only safe direction for a
    // destructive re-pointing, and the whole cost of being wrong here is one
    // operator retry against a cost that is not recoverable.
    //
    // D-1145 — THE DEBT THIS DOES NOT PAY. `SingleRead` still folds the three
    // conditions AT THE SOURCE, and this is the SECOND consumer to re-split them
    // by hand; the mail ingress cited above was the first. Widening the type was
    // considered for this fix and declined on scope, not on merit: `SingleRead`
    // has ~8 consumers (sessionws.ts:466, skillstate.ts:82, server.ts:1532 and
    // 1699, fleet.ts:116, watch.ts:2911, this file's own rung 3 below, and the
    // readiness/hookstate/livestate analogues), each of which needs a deliberate
    // direction rather than a mechanical one, and the ruling that produced this
    // arm is scoped to the one rung that stands in front of a destructive act.
    // THE THIRD CONSUMER THAT NEEDS THE DISTINCTION MUST WIDEN THE TYPE INSTEAD:
    // three hand-copies of a split the source could carry is "no overloaded null
    // at a seam" losing by attrition instead of by argument.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      return { state: 'unmeasurable',
        why: 'the registry stopped listing while the claimant was being measured, so a proven absence '
          + 'could not be told from a half-written row — transient, not a fact about the claimant' };
    }
    if (names.includes(`${id}.uuid`)) {
      return { state: 'unmeasurable',
        why: `the registry lists ${id}.uuid but the row behind it could not be assembled — a session `
          + 'mid-write or mid-teardown, transient, not a fact about the claimant' };
    }
    return { state: 'dead', why: 'no registry row in a directory that listed cleanly' };
  }
  const sv = await deps.tmux.sessionVerdict(id);
  if (sv.verdict === 'live') return { state: 'alive', why: 'tmux reports the pane live' };
  // The message IS the diagnosis, carried verbatim rather than summarised
  // (`SessionVerdict`'s own rule, exec.ts:75-84: `detail` exists only here).
  if (sv.verdict === 'unknown') return { state: 'unmeasurable', why: sv.detail };
  const lc = sessionLifecycle(lifecycleInputFor(read.record, false, nowMs));
  // D-1140 — THE `otherwise` IS TOTAL, AND ITS NAME IS NARROWER THAN ITS
  // CONTENTS. Three inputs reach it, not two: `running`/`unsupervised`/
  // `unclaimed` (a pane tmux lost track of but the registry still calls
  // working), `restarting` (the arm this whole file exists to keep), and
  // `unmeasurable` — a listed row whose `.started`/`.stopped`/`.supervised`
  // could not be READ. The third is a doubt, not an aliveness, and it is
  // answered `alive` on purpose: fail-shut is the only safe direction for a
  // destructive re-pointing, so the door refuses. Only the WORD is wrong, and
  // splitting a fourth arm off would buy nothing — every caller branches on
  // these identically. `why` names which of the three produced it, because the
  // sheet renders `detail` and not the code alone.
  return lifecycleIsDead(lc)
    ? { state: 'dead', why: `the pane is gone and the lifecycle reads ${lc}` }
    : { state: 'alive', why: `the pane is gone but the lifecycle reads ${lc}` };
}

/**
 * `registry-unmeasurable` has TWO producers and they are the same answer to the
 * caller: the incoming coordinator's read would not list, or the ladder could not
 * measure the outgoing one. `detail` is what tells them apart, which is why the
 * arm carries one and `unknown-session` does not — there is nothing to say about
 * a directory that listed cleanly and had no such row.
 *
 * `unknown-session` is NOT `unknown-run`: one is a session id nothing in the
 * registry knows, the other a run id nothing in the coordination database knows,
 * and a caller that cannot tell them apart cannot tell the operator which of the
 * two things they typed was wrong.
 *
 * D-1127 — WHY THE TWO WORDS THIS DOOR OWNS ARE A UNION OF THEIR OWN.
 * `claimant-alive` and `no-claimant` are new hyphenated literals under
 * `server/src/coord/`, and the obvious home — `RunRefuseCode` — is closed to
 * them: `coordinator-skill.test.ts` requires EVERY declared `RunRefuseCode` to be
 * named somewhere in the coordinator corpus, so joining that union would drag
 * this door's vocabulary into the very corpus that same file forbids naming the
 * door in. An allowlist entry is wrong the other way: these two ride the wire to
 * the PWA, and the allowlist is for spellings no wire carries. Hence the sixth
 * typed union and its exported guard in L0. The other three spellings below are
 * borrowed rather than minted — `unknown-run` and `registry-unmeasurable` are
 * already `MAIL_REJECT_CODES` members and `unknown-session` is already a
 * `ClaimRefuseCode` — and reusing a declared word costs nothing.
 */
export type ReclaimOutcome =
  | { ok: true; program: string; runIds: number[]; from: string; to: string }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'no-claimant' }
  | { ok: false; kind: 'unknown-session' }              // the NEW claimant has no registry row
  | { ok: false; kind: 'registry-unmeasurable'; detail: string }
  | { ok: false; kind: 'claimant-alive'; detail: string; by: string };

/**
 * Hand a program's coordination to `to`, after PROVING the session holding it is
 * gone.
 *
 * THE ORDER IS THE GUARD, cheapest and most certain first:
 *   1. the run exists                    — else `unknown-run`;
 *   2. it names a claimant at all        — else `no-claimant`. `reconstruct` binds
 *      `claimedBy` to NULL because it cannot know who will resume, and `openRun`'s
 *      D-12 clause skips exactly those rows (store.ts:373-383); adopting one here
 *      would invent an owner for a row that never had one;
 *   3. `to` is a session this box can SEE — else `unknown-session`, or
 *      `registry-unmeasurable` when the directory would not list. Ahead of the
 *      ladder on purpose: handing a program to an id that does not exist strands
 *      it exactly as thoroughly as leaving it on a corpse, and one listing rules
 *      it out;
 *   4. the CURRENT claimant is dead      — else `claimant-alive` carrying the
 *      evidence sentence, or `registry-unmeasurable`;
 *   5. the commit, as ONE transaction the store owns.
 *
 * D-1136 — `to === from` SHORT-CIRCUITS PAST 4 BUT NOT PAST 3, and where it sits
 * is the decision rather than the arm itself. It must not be a refusal: an
 * operator re-typing the id the board already shows is asking for nothing, and a
 * refusal there teaches them the door is broken. Run at the ALIVENESS rung, as
 * here, it still pays for the destination's own registry read — so a typo that
 * happened to match the current claimant is still proved to exist — while no
 * longer refusing `claimant-alive` about the very session the operator named as
 * the winner. At the top of the ladder it would skip that read and answer `ok`
 * for an id nothing knows; below rung 4 it would refuse a living session for
 * holding its own program.
 *
 * The empty `runIds` that identity case returns is not synthesised here either —
 * `reclaimProgram`'s own `claimedBy != ?` selection answers it, so a program
 * whose sibling rows somehow name a DIFFERENT id still gets them rewritten and
 * reported. `runIds` is the rows that MOVED, never the program's rows, and a
 * caller reading its emptiness as failure is reading the wrong fact.
 *
 * ONE `now` FOR THE WHOLE CALL. `recordRunEvent`'s `at` became the caller's in
 * this same wave for exactly this: the commit writes one attribution row per
 * rewritten run for ONE operator act, and N `Date.now()` calls would put N moments
 * in the trail. The ladder reads the same clock, so the lifecycle freshness window
 * and the recorded moment cannot disagree by a scheduling gap.
 *
 * `causedBy` is not a parameter and never reaches this function: the store
 * hardcodes it at its own call site. This door is ungated (the D-282 family), so a
 * body-supplied attribution would be a self-declared one.
 */
export async function reclaimRun(
  deps: ReclaimDeps, runId: number, to: string,
): Promise<ReclaimOutcome> {
  const now = Date.now();
  const run = deps.coord.run(runId);
  if (run === null) return { ok: false, kind: 'unknown-run' };
  const from = run.claimedBy;
  if (from === null) return { ok: false, kind: 'no-claimant' };
  const incoming = await readSessionRecord(deps.io, deps.cfg, to);
  if (!incoming.found) {
    if (incoming.reason === 'unlistable') {
      return { ok: false, kind: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed, so the incoming coordinator could not be checked' };
    }
    return { ok: false, kind: 'unknown-session' };
  }
  if (to !== from) {
    const claimant = await measureClaimant(deps, from, now);
    if (claimant.state === 'unmeasurable') {
      return { ok: false, kind: 'registry-unmeasurable', detail: claimant.why };
    }
    if (claimant.state === 'alive') {
      return { ok: false, kind: 'claimant-alive', detail: claimant.why, by: from };
    }
  }
  const committed = deps.coord.reclaimProgram(runId, to, now);
  // Re-measured INSIDE the transaction, so these are not the answers rungs 1-2
  // already gave — they are what is still true at commit time, after two awaited
  // registry reads have given the event loop somewhere to run.
  if (!committed.ok) return committed;
  return { ok: true, program: committed.program, runIds: committed.runIds,
    from: committed.from, to };
}
