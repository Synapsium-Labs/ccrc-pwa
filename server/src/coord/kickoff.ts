import type { CoordStore } from './store.js';
import { queueSystemMail, type SystemMailQueued } from './rundefs.js';
import { MAIL_BODY_MAX_BYTES, PROGRAM_KICKOFF_SUBJECT, programKickoff, programResumeKickoff } from '../../../shared/api.js';

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
 * THREE outcomes, and no two of them share an arm.
 *
 * `queued: false` is not a failure (D-1042) — a kickoff IS waiting for this
 * session — but it is not the same fact as "queued just now", and a caller that
 * cannot tell them apart is the overloaded seam this codebase treats as a defect
 * class. Wave 5 is the caller that needs the difference: a re-kickoff most often
 * targets a session that still has an unacked one, and "did anything happen" is
 * the whole question there.
 *
 * The success half is `queueSystemMail`'s own `SystemMailQueued`, INTERSECTED
 * rather than re-declared (wave-4 review note, D-1119). The first version spelled
 * that union out a second time here, which is drift with a one-way silence: a new
 * field on the write's result would simply not reach this caller, and nothing
 * would go red. Nothing is re-spelled now — the discriminant is `queueSystemMail`'s
 * own `queued` boolean, and the refusal is the house `ok: false` with a `kind`,
 * exactly as `dispatchRun` answers its own oversize.
 *
 * An earlier draft used a two-word string union for the queued/not-queued pair
 * instead, and `mail-routes.test.ts`'s scanner refused the second word —
 * correctly: it reads as a code, so it would have to join one of the five declared
 * code families or be excused as a non-code, and it was neither. The right
 * question at the right moment, because the honest answer is that the
 * distinction ALREADY had a single definition one ring down.
 *
 * (Note for anyone editing this file: that scanner reads COMMENTS as well as
 * code, on purpose — a comment naming a code is how a retired code survives its
 * own deletion — so prose here spells codes in backticks, never single quotes.)
 */
export type KickoffOutcome =
  | ({ ok: true } & SystemMailQueued)
  | { ok: false; kind: 'oversize'; limit: number; detail: string };

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
 * THE BODY IS CAPPED HERE, at the seam, and not in the route (wave-4 review,
 * MINOR 2, D-1119): every caller of this function embeds text it was handed, and
 * wave 5's reclaim door is the next one. `MAIL_BODY_MAX_BYTES` is enforced at
 * the `POST /api/mail` ingress and by `dispatchRun` on its own composed brief,
 * and until this cap by nothing at all on this path — so the 8 KiB invariant
 * `schema.ts` records in a comment beside the column was silently false for the
 * one producer whose content an HTTP caller chooses, and a title under Fastify's
 * 1 MiB default landed twice in `coord.db` and was served whole into the
 * recipient's context. Measured on the COMPOSED body for `dispatchRun`'s own
 * stated reason: a cap on the raw title would let a title at exactly the ceiling
 * through and queue a mail over it, and the two producers would then disagree
 * about what 8 KiB means by exactly the length of a template.
 * Wave 5's resume body is longer than wave 1's by two sentences and a run id,
 * and it reaches the three lines below through the same `body` local — which is
 * the whole reason the cap sits there and not on `program.title`. A cap on the
 * title would have to know which template was about to wrap it.
 *
 * THE `resume` ARGUMENT IS A FOURTH PARAMETER, not a second function (wave 5,
 * D-1126). The brief said "reuse this"; measured, that is not a reuse.
 * `programKickoff`'s third sentence hardcodes "open the run for wave 1"
 * (`shared/api.ts`, beside its own composer) — right exactly once, at program
 * start, and wrong for every revive after it. Handing it to a coordinator
 * revived on a program standing at wave 5 briefs it to open wave 1, and the open
 * route dedupes only a `planned` retry naming the same program, wave and
 * claimant, so what that writes is a SECOND run row: a second ledger the board
 * renders, and an open-run count the program never gets back to zero.
 * `ccd/coordinator-skill/references/resume.md` §4 exists to say precisely
 * that to a human, in prose, because until this wave nothing could say it in a
 * message.
 *
 * What genuinely IS shared is everything around the sentence — the dedupe key
 * below, the cap above, the operator sender, the run-less envelope and the
 * three-way answer. A second entry point restates all five, and a second
 * restatement of the cap is the exact drift D-1119 was opened for. So the
 * composer is the only thing that varies, and the argument selects nothing but
 * the composer: absent, this function is byte-for-byte wave 4's.
 *
 * NOTHING ELSE MOVES WITH IT — in particular `runId` stays `null` below even
 * when `resume.runId` names a real run. The prose says which run to pick up; the
 * ENVELOPE claims no run, because `runId` is one quarter of the dedupe key
 * `queueSystemMail` reads, and a run-stamped key would give every wave its own
 * slot and pile a fresh re-kickoff on top of each unread one.
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
  resume?: { runId: number; wave: number },
): KickoffOutcome {
  const body = resume
    ? programResumeKickoff(program.slug, program.title, resume.runId, resume.wave)
    : programKickoff(program.slug, program.title);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAIL_BODY_MAX_BYTES) {
    return { ok: false, kind: 'oversize', limit: MAIL_BODY_MAX_BYTES,
      detail: `kickoff body ${bytes} bytes exceeds the ${MAIL_BODY_MAX_BYTES} byte mail body cap` };
  }
  return { ok: true, ...queueSystemMail(deps.coord, null, {
    fromId: 'operator',
    toId,
    runId: null,
    kind: 'status',
    subject: PROGRAM_KICKOFF_SUBJECT,
    body,
  }) };
}
