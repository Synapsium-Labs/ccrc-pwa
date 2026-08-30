import type { CoordStore } from './store.js';
import { queueSystemMail } from './rundefs.js';
import { PROGRAM_KICKOFF_SUBJECT, programKickoff } from '../../../shared/api.js';

/**
 * L1 decision function (architecture doc increment 4 — "deciding split from
 * acting"): the program kickoff, as MAIL. Same model as `dispatch.ts`'s
 * `dispatchRun` and `close.ts`'s `closeRun` — narrowed deps declared by this
 * consumer, no `reply` anywhere, a typed result union out, and the route
 * reduced to a union->status map.
 *
 * WHY IT IS A MODULE OF ITS OWN, rather than a few lines inside the route
 * (program-leverage wave 4, D-1039). Wave 5's coordinator-reclaim door lives in
 * `coord/routes.ts` and re-kickoffs a revived coordinator with this same shape,
 * so the queueing must be callable without the start-program sheet in the loop.
 * It cannot live in either delivery file: `server.ts` value-imports
 * `registerCoordRoutes` from `coord/routes.ts`, and `coord/routes.ts` imports
 * `server.ts` TYPE-ONLY — putting the seam in either would force the other to
 * value-import it, an L4<->L4 runtime edge. A third file below both is the only
 * placement where neither delivery file imports the other's module.
 *
 * WHY IT DOES ITS OWN WRITE THROUGH `queueSystemMail`, and holds no handle:
 * `single-definition.test.ts`'s coord-ring guard licenses exactly five files to
 * touch `coord.db`, and this is not one of them. The transaction stays in
 * `rundefs.ts`, whose own docstring already makes this wave's argument — "a
 * single shared home means the call sites can never drift onto different
 * system-mail shapes".
 *
 * WHY THERE IS NO INJECTION HERE, and no import that could add one: the kickoff
 * this replaces fired `api.prompt` the instant a new session's row appeared in a
 * `/ws/fleet` frame, with no idle gate, racing ccd's own cold-start prompt
 * clearing. That is the last machine injection in the tree that bypassed the
 * delivery lane's discipline, and wave briefs have refused exactly this path
 * since Build 4 ("the brief, as MAIL … never injected directly — a fresh pane is
 * `working` for its first seconds"). `coord-kickoff.test.ts` pins the absence
 * structurally, which is only possible because this file exists: `server.ts`
 * already imports the injector for the operator's own keystroke route.
 */
export interface KickoffDeps {
  coord: CoordStore;
}

/**
 * Two outcomes, never one (D-1042). `queued: false` is not a failure — a kickoff
 * IS waiting for this session — but it is not the same fact as "queued just
 * now", and a caller that cannot tell them apart is the overloaded seam this
 * codebase treats as a defect class. Wave 5 is the caller that needs the
 * difference: a re-kickoff most often targets a session that still has an
 * unacked one, and "did anything happen" is the whole question there.
 *
 * The discriminant is `queueSystemMail`'s own `queued` boolean, carried through
 * unchanged rather than re-spelled as a word pair. The first draft of this type
 * used a two-word string union instead, and `mail-routes.test.ts`'s scanner
 * refused the second word — correctly: it reads as a code, so it would have to
 * join one of the five declared code families or be excused as a non-code, and it
 * was neither. The right question at the right moment, because the honest answer
 * is that this distinction ALREADY had a single definition one ring down, and a
 * word pair here was a second vocabulary for it.
 *
 * (Note for anyone editing this file: that scanner reads COMMENTS as well as
 * code, on purpose — a comment naming a code is how a retired code survives its
 * own deletion — so prose here spells codes in backticks, never single quotes.)
 */
export type KickoffOutcome =
  | { queued: true; mailId: number; deliveryId: number }
  | { queued: false };

/**
 * Queue the standing coordinator kickoff to `toId` as durable system mail.
 *
 * The sender is the OPERATOR, not the coordinator (D-1040): the recipient is the
 * session that is about to BECOME the coordinator, so `from: coordinator` would
 * be a false statement on the face of its own envelope — and would send
 * `watch.ts`'s `tellSender` through `resolveCoordinator(null)`, whose answer is
 * whichever program happens to be the single active one.
 *
 * It names NO run, because there is none: opening run 1 is the first thing this
 * message asks its recipient to do. `queueSystemMail`'s `run`/`runId` are
 * nullable for exactly this caller — the alternative, synthesising a
 * `{program: slug, wave: 0}` here, compiles and even works (the envelope skips
 * all three fields when `runId` is null) but asserts a run that does not exist.
 *
 * THE DEDUPE KEY IS `(operator, null, toId, PROGRAM_KICKOFF_SUBJECT)` — deliberately
 * not namespaced by slug. One session is one program's coordinator; a second
 * outstanding kickoff to a session that already has one unread is a thing to
 * refuse whatever program it names, and a slug-suffixed subject would queue both
 * and let the first one lose. It is also why `hasOutstandingMail` became
 * sender-scoped in the same wave (D-1041): without that, a peer mail that
 * happened to carry this subject would swallow the kickoff silently.
 */
export function queueProgramKickoff(
  deps: KickoffDeps,
  toId: string,
  program: { slug: string; title: string },
): KickoffOutcome {
  return queueSystemMail(deps.coord, null, {
    fromId: 'operator',
    toId,
    runId: null,
    kind: 'status',
    subject: PROGRAM_KICKOFF_SUBJECT,
    body: programKickoff(program.slug, program.title),
  });
}
