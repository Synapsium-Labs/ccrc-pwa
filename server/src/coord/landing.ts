import type { PrQueueRead } from '../prstate.js';
/**
 * The landing lane's pure half (landing-order wave 2, `landing-verdict-is-l1` (D-3883)). L1: clock-free, fs-free,
 * fastify-free and store-free, on `stall.ts`'s precedent — the coord-ring scan in `single-definition.test.ts` forbids
 * this file `./db.js` and `node:sqlite`, and `landing-verdict.test.ts` pins the rest: no node builtin, and no value
 * import but L0's `shared/api.ts` (today its imports are TYPES only). `watch.ts`'s `sweepLanding` keeps the READS
 * (the store, the registry, `survivorOf`, `resolveCoordinator`, `hasMailWithSubject`, `hasFeedEvent`) and the
 * DELIVERIES (`queueSystemMail`, the feed record, the latch write); every DECISION is here: which notice a line asks
 * for, its latch key and whether it is already latched, whom to tell, whether a merge is told at all, which durable
 * read proves "already told", when to defer instead of latching, and the notice bodies.
 *
 * TWO FUNCTIONS, because the reads depend on earlier answers (the coordinator is asked of a run the survivor pick
 * returned; "already told" is asked of a subject and a coordinator). `landingAsk` answers what the line asks for.
 * `landingVerdict` is then called with the facts read SO FAR and answers the next step: a read it still needs
 * (`runs`, `coordinator`, `runState`, `toldMail`, `toldFeed`), or an end (`defer`, `latch`, `deliver`). The caller
 * performs the step, records the answer in the facts, and asks again. Reads happen in exactly the order the lane
 * always made them, and nothing is read that no decision needs. Step names are single words on purpose:
 * `mail-routes.test.ts` scans this directory for quoted kebab words.
 *
 * `survivorOf` is NOT called here. It is `rundefs.ts`'s (close and dispatch share it) and `rundefs.ts` holds the
 * database handle, which this file may not reach; the caller hands this file its answer. What is decided here is what
 * that answer means: null is nobody to tell, and an unreadable read is a deferral, never null.
 *
 * Spelled ONCE here: the two notice subjects (re-exported by `rundefs.ts`, where `watch.ts` and the coordinator-skill
 * test have always imported them) and the two notice bodies.
 */

/** The landing lane's two notice subjects (landing-order wave 2), each spelled
 *  ONCE: `watch.ts`'s `sweepLanding` queues them and asks `hasMailWithSubject`
 *  about them, and the coordinator skill tells its reader to expect them
 *  (`references/wave-lifecycle.md` §5) — `coordinator-skill.test.ts` holds the
 *  skill's spelling to these. A dequeue is unique per REMOVAL — the PR and the
 *  removal's own time (`queueAt`, shape-gated by `queueFor`) — so a second
 *  removal of the same PR is a new notice, and a reading with no well-shaped
 *  time falls back to the PR alone; a merge happens once per PR. */
export const dequeuedSubject = (pr: number, at: string | null): string =>
  at === null ? `dequeued:#${pr}` : `dequeued:#${pr}@${at}`;
export const mergedSubject = (pr: number): string => `merged:#${pr}`;

// ── what a line asks for ──────────────────────────────────────────────────────────────────────────────────────

export type LandingNotice = 'dequeued' | 'merged';

/** One session's measured line, as the lane reads it: `pr?.number`, `pr?.phase` and the queue word `sweepPr` kept
 *  beside it. `phase` is a string, not the union — only `merged` means anything here. */
export interface LandingLine {
  sessionId: string;
  workspace: string;
  number: number | null;
  phase: string | undefined;
  queue: PrQueueRead | undefined;
}

export interface LandingAsk {
  notice: LandingNotice;
  /** The in-memory latch's key: per (workspace, PR, notice, removal time). A PR can be dequeued, re-enqueued and
   *  dequeued AGAIN, and each removal is a new fact the coordinator has to hear. */
  key: string;
  number: number;
  at: string | null;
  sessionId: string;
  workspace: string;
}

/** What this line asks for, or null for nothing. The lane fires on the one word that asks for an act: `dequeued`.
 *  `unmeasured`, `absent`, `queued`, `landed` and `none` never announce a dequeue. A merge asks only through the
 *  derived phase. A key already latched asks for nothing, which is what spares a latched notice every later read. */
export function landingAsk(l: LandingLine, latched: ReadonlySet<string>): LandingAsk | null {
  const dequeued = l.queue?.state === 'dequeued';
  if (l.number === null || (!dequeued && l.phase !== 'merged')) return null;
  const at = dequeued ? l.queue?.at ?? null : null;
  const key = `${l.sessionId}#${l.number}:${dequeued ? 'dequeued' : 'merged'}@${at ?? ''}`;
  if (latched.has(key)) return null;
  return { notice: dequeued ? 'dequeued' : 'merged', key, number: l.number, at, sessionId: l.sessionId, workspace: l.workspace };
}

// ── the verdict ───────────────────────────────────────────────────────────────────────────────────────────────

/** The run `survivorOf` picked (an `OpenSibling` satisfies it), or null for "no open run names the workspace". */
export interface LandingRun { id: number }

/** What the caller read, so far. An absent key is a read not made yet. Every read that can fail carries its failure
 *  APART from its empty answer: `runs.ok === false` is not `run === null`. */
export interface LandingFacts {
  runs?: { ok: true; run: LandingRun | null } | { ok: false; detail: string };
  /** `resolveCoordinator(run.id)`: asked only of a run. */
  coordinator?: string | null;
  /** The survivor run's own state, read for a merge only. `null` is a run row that is gone. */
  runState?: { ok: true; state: string | null } | { ok: false; detail: string };
  /** The durable "already told" answer: a mail through `hasMailWithSubject` when a coordinator is named, the feed
   *  body through `hasFeedEvent` when none is. */
  told?: boolean;
}

export interface LandingMail {
  fromId: 'operator'; toId: string; runId: number; kind: 'status'; subject: string; body: string;
}
export interface LandingRecord {
  title: string; body: string; runId: number | null; tag: string; recordAlways: true;
}

export type LandingStep =
  | { step: 'runs' }
  | { step: 'coordinator'; runId: number }
  | { step: 'runState'; runId: number }
  | { step: 'toldMail'; runId: number; toId: string; subject: string }
  | { step: 'toldFeed'; body: string }
  /** Say a warning, latch NOTHING: the next sweep re-reads. */
  | { step: 'defer'; detail: string }
  /** Say nothing and latch: told already, nobody to tell, or not a merge anyone waits on. */
  | { step: 'latch' }
  /** Mail first, then the record, then latch — a throw anywhere before the latch leaves it unset, and the mail is
   *  queued BEFORE the record so a retry leaves one record. `mail` is null when no coordinator is named. */
  | { step: 'deliver'; mail: LandingMail | null; record: LandingRecord | null };

const LATCH: LandingStep = { step: 'latch' };

/** The next step of one notice. Total over the facts: every missing fact is a read the caller still owes. */
export function landingVerdict(a: LandingAsk, f: LandingFacts): LandingStep {
  if (f.runs === undefined) return { step: 'runs' };
  if (!f.runs.ok) return { step: 'defer', detail: f.runs.detail };
  const run = f.runs.run;
  if (run !== null && f.coordinator === undefined) return { step: 'coordinator', runId: run.id };
  const coordinator = run === null ? null : f.coordinator ?? null;
  if (a.notice === 'merged') {
    // A MERGE: told only to a coordinator whose run waits at `merging`.
    if (run === null || coordinator === null) return LATCH;
    if (f.runState === undefined) return { step: 'runState', runId: run.id };
    if (!f.runState.ok) return { step: 'defer', detail: f.runState.detail };
    if (f.runState.state !== 'merging') return LATCH;
    const subject = mergedSubject(a.number);
    if (f.told === undefined) return { step: 'toldMail', runId: run.id, toId: coordinator, subject };
    if (f.told) return LATCH;
    return { step: 'deliver',
      mail: { fromId: 'operator', toId: coordinator, runId: run.id, kind: 'status',
        subject, body: renderMergedBrief(a.sessionId, a.number) },
      record: null };
  }
  const subject = dequeuedSubject(a.number, a.at);
  const body = `PR #${a.number} left the merge queue without landing`
    + (a.at === null ? '' : ` (removed ${a.at})`) + '; GitHub does not re-enqueue it. '
    + (coordinator === null ? 'No open run names a coordinator to tell.' : `Mailed coordinator ${coordinator}.`);
  const named = run !== null && coordinator !== null;
  if (f.told === undefined) {
    return named ? { step: 'toldMail', runId: run.id, toId: coordinator, subject } : { step: 'toldFeed', body };
  }
  if (f.told) return LATCH;
  return { step: 'deliver',
    mail: named
      ? { fromId: 'operator', toId: coordinator, runId: run.id, kind: 'status',
          subject, body: renderDequeueBrief(a.sessionId, a.number) }
      : null,
    // `recordAlways`: the record of a removal is never presence-gated.
    record: { title: `⤺ dequeued › ${a.workspace}`, body, runId: run?.id ?? null,
      tag: `queue-${a.key}`, recordAlways: true } };
}

// ── the notice bodies ─────────────────────────────────────────────────────────────────────────────────────────

/** The dequeue notice's body. Every value in it is this server's own — a PR
 *  number, a registry-validated session id — and nothing GitHub wrote (the
 *  removal's reason is never carried): this text lands in a model's context.
 *  The re-enqueue spelling is clause 15's, exact-SHA binding and all. The why
 *  is the QUEUE's own CI run: a queue failure is the `merge_group` run on the
 *  queue branch's commit, which the PR head's checks never include, so they
 *  can read green while the queue reads red. A fix round disarms first: an
 *  armed auto-merge would queue whatever head the round pushes. */
export function renderDequeueBrief(sessionId: string, pr: number): string {
  return `PR #${pr} (workspace \`${sessionId}\`) was removed from this repository's merge queue without landing. ` +
    `GitHub does not re-enqueue a PR after a failed group.\n` +
    `Read why from the QUEUE's own CI run, not the PR's checks — they ran on a different commit and can read green: ` +
    `\`gh run list --event merge_group --limit 20 --json databaseId,headBranch,conclusion\` finds it by its ` +
    `\`headBranch\` (\`gh-readonly-queue/<base>/pr-${pr}-…\`), \`gh run view <id> --log-failed\` says why, and ` +
    `\`gh pr view ${pr} --json mergeStateStatus\` answers a conflict.\n` +
    `Then either re-enqueue it — \`gh pr merge ${pr} --match-head-commit <handoffCommit>\`, the run's verified ` +
    `handoffCommit, never \`--admin\` (clause 15) — or disarm any armed auto-merge ` +
    `(\`gh pr merge ${pr} --disable-auto\`) and send the owning worker a fix round on the ` +
    `\`merging → working\` edge.\n\n` +
    `Run the ccrc-coordinator skill.`;
}

/** The merged notice's body — the same provenance rule as the dequeue's. It
 *  asks for the merge PROOF before the close, because a merged PR is not yet
 *  proof that the exact head the review read is the one that landed. */
export function renderMergedBrief(sessionId: string, pr: number): string {
  return `PR #${pr} (workspace \`${sessionId}\`) merged while its run waited at \`merging\`.\n` +
    `Prove it from your own shell — \`gh pr view ${pr} --json state,headRefOid\` answers MERGED with ` +
    `\`headRefOid\` equal to the run's verified handoffCommit — then close the run as ` +
    `references/wave-lifecycle.md §5 closes a producer.\n\n` +
    `Run the ccrc-coordinator skill.`;
}
