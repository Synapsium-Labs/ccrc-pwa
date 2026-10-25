import type { MarkerState } from '../../../shared/api.js';
import {
  CHECKS_MODES, LANDING_CHECKS_STUCK_MS, LANDING_KEBABS, REQUIRED_CHECKS_PRECEDENCE, isHead40, isFp12,
  type ChecksMailWord, type ChecksMode, type LeftPhase, type RequiredChecksWord, type StuckCause,
} from '../../../shared/landing.js';
import type { SwitchReading } from '../../../shared/switches.js';
import type { PrLandingLine, PrQueueRead } from '../prstate.js';
import { GITHUB_TEXT_PREFACE, untrustedBlock } from './untrusted.js';
/**
 * The landing lane's pure half (landing-order wave 2, `landing-verdict-is-l1` (D-3883)). L1: clock-free, fs-free,
 * fastify-free and store-free, on `stall.ts`'s precedent — the coord-ring scan in `single-definition.test.ts` forbids
 * this file `./db.js` and `node:sqlite`, and `landing-verdict.test.ts` pins the rest: no node builtin, and no value
 * import but L0's `shared/landing.ts` and `./untrusted.ts` (which imports nothing); `shared/api.ts` and `shared/switches.ts` are
 * admitted too, today as TYPES only. `watch.ts`'s `sweepLanding` keeps the READS
 * (the store, the registry, `survivorOf`, `coordinatorOfRun`, `hasMailWithSubject`, `hasNotice`) and the
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
  /** `coordinatorOfRun(run.id)`: asked only of a run. */
  coordinator?: string | null;
  /** The survivor run's own state, read for a merge only. `null` is a run row that is gone. */
  runState?: { ok: true; state: string | null } | { ok: false; detail: string };
  /** The durable "already told" answer: a mail through `hasMailWithSubject` when a coordinator is named, the feed
   *  notice's key through `hasNotice` when none is (D-5860). */
  told?: boolean;
}

export interface LandingMail {
  fromId: 'operator'; toId: string; runId: number; kind: 'status'; subject: string; body: string;
}
export interface LandingRecord {
  title: string; body: string; runId: number | null; tag: string; recordAlways: true;
  /** D-5860: the removal's once-only key (`LandingAsk.key`), archived beside the row whether or not a coordinator was
   *  mailed, so a later feed-only read finds this removal whatever its wording (OA-C3, ruled A: the label decides). */
  dedupeKey: string;
}

export type LandingStep =
  | { step: 'runs' }
  | { step: 'coordinator'; runId: number }
  | { step: 'runState'; runId: number }
  | { step: 'toldMail'; runId: number; toId: string; subject: string }
  /** D-5860: `key` is read first (`hasNotice`); `body` matches only a row archived before the key existed. */
  | { step: 'toldFeed'; key: string; body: string }
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
    return named ? { step: 'toldMail', runId: run.id, toId: coordinator, subject } : { step: 'toldFeed', key: a.key, body };
  }
  if (f.told) return LATCH;
  return { step: 'deliver',
    mail: named
      ? { fromId: 'operator', toId: coordinator, runId: run.id, kind: 'status',
          subject, body: renderDequeueBrief(a.sessionId, a.number) }
      : null,
    // `recordAlways`: the record of a removal is never presence-gated.
    record: { title: `⤺ dequeued › ${a.workspace}`, body, runId: run?.id ?? null,
      tag: `queue-${a.key}`, recordAlways: true, dedupeKey: a.key } };
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

// ══ PR landing in ccrc, stage 1: the checks mail (D-6785; spec §3.1, §3.4 to §3.8) ════════════════════════════════
//
// The deciders of the checks lane, all pure: the required verdict, the edge fold over an episode's durable rows, the
// act a line asks for, the stuck bound, the mode, the check-name sanitiser and the brief. `watch.ts`'s checks lane
// (PL-4) keeps the reads, the clock, the digest (`node:crypto`) and the deliveries; every DECISION is here.

/** The marker rows this file reads, checked against `SwitchReading` so a typo is a compile error. */
const LANDING_MARKER_KEYS = ['landing-disabled', 'landing-checks-live'] as const satisfies readonly (keyof SwitchReading)[];

/** True for every hyphenated word this file spells as a single-quoted literal: the words of `shared/landing.ts`'s
 *  maps, derived and never listed here, and the two marker rows. `mail-routes.test.ts`'s kebab scan reads it. */
export function isLandingKebab(token: string): boolean {
  return LANDING_KEBABS.has(token) || (LANDING_MARKER_KEYS as readonly string[]).includes(token);
}

// ── the required verdict (§3.4) ───────────────────────────────────────────────────────────────────────────────────

/** The verdict of a line's required set: one word, a fingerprint of the reported check runs and the failing names. */
export interface RequiredVerdict {
  word: RequiredChecksWord;
  /** First 12 hex of `digest` over the sorted `name=checkId` pairs of the required CHECK RUNS that have reported. A
   *  commit status is not in it: it carries no attempt id, and its own final post must not read as a rerun. */
  fp: string;
  failing: Array<{ name: string; runId: number | null }>;
}

const RUN_RUNNING = new Set(['', 'pending', 'queued', 'in_progress', 'waiting', 'requested']);
const RUN_PASSING = new Set(['success', 'neutral', 'skipped']);

/** One required context's word. A check run (it has a `checkId`) with an empty conclusion has not completed, so it is
 *  running; any completed conclusion that is not a pass is red. A commit status answers by its state. */
function contextWord(r: { state: string; checkId: number | null }): RequiredChecksWord {
  const st = r.state.toLowerCase();
  if (r.checkId !== null) {
    if (RUN_RUNNING.has(st)) return 'pending';
    return RUN_PASSING.has(st) ? 'green' : 'red';
  }
  if (st === 'success') return 'green';
  if (st === 'failure' || st === 'error') return 'red';
  if (st === 'pending' || st === 'expected' || st === '') return 'pending';
  return 'unmeasured';
}

/** The ONE total precedence, `REQUIRED_CHECKS_PRECEDENCE`: unmeasured, red, unverifiable, pending, not-reported,
 *  green. So a head whose set mixes `unverifiable` with `pending` always reads `unverifiable`, never flipping. */
const stronger = (a: RequiredChecksWord, b: RequiredChecksWord): RequiredChecksWord =>
  REQUIRED_CHECKS_PRECEDENCE.indexOf(a) <= REQUIRED_CHECKS_PRECEDENCE.indexOf(b) ? a : b;

/** The required set is the union of the contexts marked required, the rules' names and the branch view's names. The
 *  set is never empty by default: a repository with no required checks reads `green` only when all three sources
 *  answered and named none. A required name no context carries is `not-reported`, never `green`. */
export function requiredChecksVerdict(line: PrLandingLine, digest: (s: string) => string): RequiredVerdict {
  const pairs = line.required.filter((r) => r.checkId !== null).map((r) => `${r.name}=${String(r.checkId)}`).sort();
  const fp = digest(pairs.join('\n')).slice(0, 12);
  const seen = new Set<string>();
  const failing: Array<{ name: string; runId: number | null }> = [];
  for (const r of line.required) {
    const key = `${r.name}\n${String(r.runId)}`;
    if (contextWord(r) === 'red' && !seen.has(key)) { seen.add(key); failing.push({ name: r.name, runId: r.runId }); }
  }
  failing.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // A read that did not answer, a line that does not bind, a list ccd cut: nothing here may be called green.
  if (!line.bound || line.unmeasured.length > 0 || line.requiredCut) return { word: 'unmeasured', fp, failing };
  const pinned = new Set(line.pinnedNames);
  const names = new Set([...line.required.map((r) => r.name), ...line.rulesNamed, ...line.protectionNamed]);
  let word: RequiredChecksWord = 'green';
  for (const name of names) {
    const own = line.required.filter((r) => r.name === name);
    let w: RequiredChecksWord = own.length === 0 ? 'not-reported' : 'green';
    for (const r of own) w = stronger(w, contextWord(r));
    // Pinned to an App, but only a commit status shows it: a status carries no App id (a parent §5.7.5 stop).
    if (own.length > 0 && pinned.has(name) && own.every((r) => r.checkId === null)) w = stronger(w, 'unverifiable');
    word = stronger(word, w);
  }
  return { word, fp, failing };
}

// ── the edge fold (§3.5) ──────────────────────────────────────────────────────────────────────────────────────────

/** One row of an episode's generations, parsed from its `run_events` detail by `readChecksRowDetail`. `fp` is an
 *  edge row's fingerprint, `reading` a `stuck` row's (`unread`, or `<word>@<fp12>`), `atMs` the row's `at`. */
export interface ChecksRow {
  gen: number;
  what: 'open' | 'green' | 'red' | 'stuck';
  fp: string | null;
  reading: string | null;
  atMs: number;
}
/** What one pass read of the episode: the verdict word and its fingerprint (`fp` is ignored for `unmeasured`). */
export interface ChecksRead { word: RequiredChecksWord; fp: string }
export interface ChecksMailAsk { gen: number; word: ChecksMailWord; cause?: StuckCause }
export interface ChecksFold {
  /** The rows to write, in order. */
  write: ChecksRow[];
  /** At most one mail, for the generation it names. */
  mail: ChecksMailAsk | null;
  /** The current generation's bound as the rows stand after this answer, or null when it owes none (green-settled, or
   *  it holds its `stuck` row). The latch spares a read only until this time. */
  dueAtMs: number | null;
}

const readingOf = (read: ChecksRead | null): string => {
  if (read === null || !isFp12(read.fp)) return 'unread';
  return read.word === 'pending' || read.word === 'not-reported' || read.word === 'unverifiable' || read.word === 'red'
    ? `${read.word}@${read.fp}` : 'unread';
};
const parseReading = (reading: string | null): { word: string | null; fp: string | null } => {
  if (reading === null || reading === 'unread') return { word: null, fp: null };
  const at = reading.indexOf('@');
  return at < 0 ? { word: null, fp: null } : { word: reading.slice(0, at), fp: reading.slice(at + 1) };
};

/** The state of the current generation (the count of `open` rows, minus one). */
function currentGen(rows: readonly ChecksRow[]) {
  const gen = rows.filter((r) => r.what === 'open').length - 1;
  const own = rows.filter((r) => r.gen === gen);
  return {
    gen,
    open: own.find((r) => r.what === 'open'),
    edge: own.find((r) => r.what === 'green' || r.what === 'red'),
    stuck: own.find((r) => r.what === 'stuck'),
  };
}

function dueOf(rows: readonly ChecksRow[]): number | null {
  const c = currentGen(rows);
  if (c.stuck !== undefined || c.open === undefined) return null;
  if (c.edge !== undefined) return c.edge.what === 'red' ? c.edge.atMs + LANDING_CHECKS_STUCK_MS : null;
  return c.open.atMs + LANDING_CHECKS_STUCK_MS;
}

/** The one fold. `read` null is a pass that did not read (the bound alone, with `forced` the cause). */
function foldChecks(rows: readonly ChecksRow[], read: ChecksRead | null, nowMs: number, episodeAtMs: number,
  forced: StuckCause | null): ChecksFold {
  const all = [...rows];
  const write: ChecksRow[] = [];
  const push = (r: ChecksRow): void => { all.push(r); write.push(r); };
  let mail: ChecksMailAsk | null = null;
  // Generation 0 opens on the first pass that sees the episode, at the transition row's time, not the sighting's.
  if (!all.some((r) => r.what === 'open')) push({ gen: 0, what: 'open', fp: null, reading: null, atMs: episodeAtMs });
  const answered = read !== null && read.word !== 'unmeasured' ? read : null;

  if (answered !== null) {
    const w = answered.word;
    const settled = w === 'green' || w === 'red';
    const c = currentGen(all);
    const openNext = (): number => {
      const next = c.gen + 1;
      push({ gen: next, what: 'open', fp: null, reading: null, atMs: nowMs });
      return next;
    };
    const settle = (gen: number): void => {
      push({ gen, what: w as 'green' | 'red', fp: answered.fp, reading: null, atMs: nowMs });
      mail = { gen, word: w as ChecksMailWord };
    };
    if (c.edge === undefined && c.stuck !== undefined) {
      // After an unsettled `stuck`: the same hung wait opens nothing, a rerun the lane saw or a settle does.
      const sr = parseReading(c.stuck.reading);
      const running = w === 'pending' || w === 'not-reported';
      if (settled) settle(openNext());
      else if ((w === 'pending' && sr.word !== 'pending') || (running && answered.fp !== sr.fp)) openNext();
    } else if (c.edge !== undefined) {
      // A settled generation opens the next on a rerun seen running, a changed fingerprint, or the other settled word.
      if (w === 'pending' || w === 'not-reported') openNext();
      else if (settled && (w !== c.edge.what || answered.fp !== c.edge.fp)) settle(openNext());
    } else if (settled) {
      settle(c.gen);
    }
  }

  if (mail === null) {
    const c = currentGen(all);
    if (c.open !== undefined && c.stuck === undefined && !(c.edge !== undefined && c.edge.what === 'green')) {
      const unverifiable = c.edge === undefined && answered !== null && answered.word === 'unverifiable';
      const due = c.edge !== undefined ? c.edge.atMs + LANDING_CHECKS_STUCK_MS : c.open.atMs + LANDING_CHECKS_STUCK_MS;
      if (unverifiable || nowMs >= due) {
        const cause: StuckCause = unverifiable ? 'unverifiable' : forced ?? (answered !== null ? 'timeout' : 'unmeasured');
        push({ gen: c.gen, what: 'stuck', fp: null, reading: readingOf(answered), atMs: nowMs });
        mail = { gen: c.gen, word: 'stuck', cause };
      }
    }
  }
  return { write, mail, dueAtMs: dueOf(all) };
}

/** The edge of one read over an episode's rows (spec §3.5): generations, edges, the stuck bound and the due time. Pure:
 *  it reads no clock and no memory. `live` is the caller's (a shadow pass folds the same rows and writes them as
 *  `landing-shadow:` rows), so it changes nothing here. */
export function checksEdge(rows: readonly ChecksRow[], read: ChecksRead, nowMs: number, episodeAtMs: number,
  _live: boolean): ChecksFold {
  return foldChecks(rows, read, nowMs, episodeAtMs, null);
}

/** The bound alone, for an owed episode the pass does not read: `disabled` under `landing-disabled`; `unmeasured` with
 *  no capability, a workspace gone from the registry, or a registry that cannot be listed. It writes the `stuck` row
 *  with reading `unread`, with both of `checksEdge`'s clocks, and a green-settled generation owes nothing. */
export function stuckOnly(rows: readonly ChecksRow[], nowMs: number, episodeAtMs: number, cause: StuckCause): ChecksFold {
  return foldChecks(rows, null, nowMs, episodeAtMs, cause);
}

// ── what a line asks for (§3.2) ───────────────────────────────────────────────────────────────────────────────────

/** The two facts of an episode a line is judged against: the PR it advanced at and the head it verified. */
export interface LandingEpisode { pr: number; head: string }
export type LandingLineAct =
  | { act: 'unmeasured' }
  | { act: 'edge' }
  | { act: 'moved'; head: string }
  | { act: 'left'; phase: LeftPhase };

/** Spec §3.2's four acts, in order. `unmeasured` (the read, or the binding, did not answer) is never `left`. */
export function landingLineAct(episode: LandingEpisode, line: PrLandingLine | null): LandingLineAct {
  if (line === null || line.unmeasured.length > 0) return { act: 'unmeasured' };
  if (!line.bound || line.number !== episode.pr) return { act: 'left', phase: 'unbound' };
  if (line.state === 'MERGED') return { act: 'left', phase: 'merged' };
  if (line.state === 'CLOSED') return { act: 'left', phase: 'closed' };
  if (line.state !== 'OPEN' || line.head === null || !isHead40(line.head)) return { act: 'unmeasured' };
  if (line.isDraft) return { act: 'left', phase: 'draft' };
  return line.head === episode.head ? { act: 'edge' } : { act: 'moved', head: line.head };
}

// ── the mode (§3.7) ───────────────────────────────────────────────────────────────────────────────────────────────

/** The mode an episode is decided in, once, at the advance. `off` unless a bound PR in phase `open` was measured, the
 *  ccd answers `pr-landing-v1` and `landing-disabled` is clear; `live` when `landing-checks-live` stands, else
 *  `shadow`. A marker that reads `unmeasurable` (the registry could not be listed) is `off`: this reader's own
 *  mapping, so no token is sent and nothing is owed to a coordinator that was not told `live`. */
export function checksModeAt(switches: SwitchReading, capable: boolean,
  measured: { prNumber: number | null; prPhase: string | undefined }): ChecksMode {
  const disabled: MarkerState = switches['landing-disabled'];
  const live: MarkerState = switches['landing-checks-live'];
  if (disabled !== 'clear' || live === 'unmeasurable') return 'off';
  if (!capable || measured.prNumber === null || measured.prPhase !== 'open') return 'off';
  const mode: ChecksMode = live === 'set' ? 'live' : 'shadow';
  return (CHECKS_MODES as readonly string[]).includes(mode) ? mode : 'off';
}

/** What the lane's disable marker says of a pass: `disabled` (it stands: no read, no edge row, no mail of an edge),
 *  `unmeasurable` (the registry could not be listed) or `enabled`. The one place L4 asks, so `watch.ts` never names the
 *  marker (`landing-words.test.ts`'s no-writer pin lists the files that do). */
export function checksGate(switches: SwitchReading): 'enabled' | 'disabled' | 'unmeasurable' {
  const s: MarkerState = switches['landing-disabled'];
  return s === 'set' ? 'disabled' : s === 'unmeasurable' ? 'unmeasurable' : 'enabled';
}

// ── GitHub-supplied names (§3.6) ──────────────────────────────────────────────────────────────────────────────────

const NAME_OUTSIDE = /[^A-Za-z0-9 _.,:()/+#-]/gu;
const NAME_MAX = 80;
const NAMES_MAX = 10;

/** Reduce a GitHub-supplied check name before it enters any mail: NFKC-normalise, replace every character outside
 *  `[A-Za-z0-9 _.,:()/+#-]` with `?` (backticks, control characters, newlines and bidirectional overrides go), collapse
 *  runs of spaces and cap at 80. A name is never an argv, a shell word, a subject or a file name. */
export function landingCheckName(raw: string): string {
  return raw.normalize('NFKC').replace(NAME_OUTSIDE, '?').replace(/ {2,}/g, ' ').trim().slice(0, NAME_MAX).trimEnd();
}

/** The names a mail shows: the first 10 reduced, and the count of the rest. */
export function landingCheckNames(list: readonly string[]): { names: string[]; more: number } {
  return { names: list.slice(0, NAMES_MAX).map(landingCheckName), more: Math.max(0, list.length - NAMES_MAX) };
}

// ── the mail (§3.6) ───────────────────────────────────────────────────────────────────────────────────────────────

/** `checks:#<pr>:<e>.<gen>:<word>@<head7>`, beside `dequeuedSubject` and `mergedSubject`. The episode and the
 *  generation are in it, because a second red of the same head, or a red after a re-entry, is a new fact. */
export const checksSubject = (pr: number, e: number, gen: number, word: ChecksMailWord, head: string): string =>
  `checks:#${pr}:${e}.${gen}:${word}@${head.slice(0, 7)}`;

export interface ChecksBriefInput {
  pr: number; sessionId: string; head: string; e: number; gen: number; word: ChecksMailWord;
  /** `stuck` only. */
  cause?: StuckCause;
  /** `red` only: the failing required contexts, names as GitHub wrote them (reduced here). */
  failing?: ReadonlyArray<{ name: string; runId: number | null }>;
  /** `moved` only: the measured head. */
  movedHead?: string;
  /** `left` only: the measured phase. */
  phase?: LeftPhase;
}

const STUCK_SENTENCE: Record<StuckCause, string> = {
  timeout: 'the lane read the checks and they were still unsettled (or still red) 45 minutes on',
  unmeasured: 'the lane could not read this PR, so it cannot tell you when its checks settle',
  unverifiable: 'a required check is pinned to an App and shows only as a commit status, so it cannot be verified from here',
  disabled: 'the landing lane was switched off while this episode was live',
};

/** The mail's body, built in one place. Every value is this server's own except a failing check name, which reaches
 *  the body only through `landingCheckNames` and inside `untrustedBlock` with a GitHub preface. The server names the
 *  next act and never performs it. */
export function renderChecksBrief(a: ChecksBriefInput): string {
  const sid = /^[A-Za-z0-9._-]+$/.test(a.sessionId) ? a.sessionId : '?';
  const head = isHead40(a.head) ? a.head : '?';
  const out: string[] = [
    `PR #${a.pr} (workspace \`${sid}\`), episode ${a.e}, generation ${a.gen}: ${a.word}.`,
    `The run advanced to \`merging\` at head \`${head}\`.`,
  ];
  if (a.word === 'green') {
    out.push('Every required check passed on that head. Confirm it once, then run your own enqueue and its read-back.');
  } else if (a.word === 'red') {
    out.push('At least one required check failed on that head.');
    const { names, more } = landingCheckNames((a.failing ?? []).map((f) => f.name));
    if (names.length > 0) {
      out.push(untrustedBlock(names.join('\n'), 2048, 'on the PR', GITHUB_TEXT_PREFACE) + (more > 0 ? `\n+${more} more` : ''));
    }
    const ids = [...new Set((a.failing ?? []).map((f) => f.runId).filter((n): n is number => n !== null && Number.isSafeInteger(n) && n > 0))].slice(0, 5);
    out.push('Either send the owning worker a fix round on the `merging → working` edge, or, when the failure is not this PR\'s own, '
      + (ids.length > 0 ? `rerun the failed jobs once: ${ids.map((n) => `\`gh run rerun ${n} --failed\``).join(', ')}.` : 'rerun the failed jobs once.'));
  } else if (a.word === 'stuck') {
    const cause: StuckCause = a.cause ?? 'unmeasured';
    out.push(`The wait has no end the server can see (${cause}): ${STUCK_SENTENCE[cause]}.`);
    out.push('Go back to the foreground wait for this episode, or act on the cause.');
  } else if (a.word === 'moved') {
    out.push(`The PR head moved to \`${a.movedHead !== undefined && isHead40(a.movedHead) ? a.movedHead : '?'}\`.`);
    out.push('Send the run back to `working` and advance again through `awaiting-review`.');
  } else {
    out.push(`The PR is no longer one this episode can wait on (${a.phase ?? 'unbound'}).`);
    out.push('Go back to the foreground wait, or send the run back.');
  }
  out.push('The server performs none of this; it only tells you.', 'Run the ccrc-coordinator skill.');
  return out.join('\n\n');
}
