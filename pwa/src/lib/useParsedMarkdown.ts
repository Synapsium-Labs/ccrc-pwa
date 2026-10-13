// The async parse hook (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clause 3, the W4 plan's
// refinements (g) and (i)). Chat's long messages parse through it; W5's DocMarkdown will too. Per hook:
//   - At most one job runs and at most one waits. A new request (a changed text, profile, budget or attempt) starts
//     a job when none runs, and otherwise REPLACES the waiting one, so a message that streams in faster than it
//     parses costs one job per settle, never one per token.
//   - A job's result is applied only while that job is still the hook's running job. Unmount aborts the running
//     job's signal and drops the waiting one, so a parser that answers after that is not heard.
//   - A result becomes the `outcome` only while its request is still the latest one made; a result for an earlier
//     request is kept as `lastGood` alone. A request the hook has already answered, or that the running job
//     answers, queues nothing: so text A -> B -> A shows A's outcome throughout, never B's under A.
//   - `lastGood` is the last tree that settled, kept through any later outcome, so a caller can show it while a
//     newer text parses.
//   - A parser that throws before returning its promise settles its job as `threw` with the error's name.
//   - A rejection ends the job with nothing applied, and the waiting job, if any, runs next. The runner rejects
//     only on an abort (this hook's own, on unmount) or a `dispose()`.
// `parser` is read when a request is made: a new function alone starts nothing.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Root as HastRoot } from 'hast';
import type { MarkdownProfile, ParseOutcome } from './markdownParse';
import type { MarkdownParser } from './markdownRunner';

export interface ParsedMarkdown {
  /** The latest settled outcome, for the current request or an earlier one; null = nothing has settled yet. */
  readonly outcome: ParseOutcome | null;
  /** The last tree that settled; null = no tree has settled yet. */
  readonly lastGood: HastRoot | null;
  /** No outcome has settled yet for the current text, profile, budget and attempt. */
  readonly pending: boolean;
}

interface Request {
  readonly text: string;
  readonly profile: MarkdownProfile;
  readonly budgetMs: number;
  readonly attempt: number;
}

const sameRequest = (a: Request, b: Request): boolean =>
  a.text === b.text && a.profile === b.profile && a.budgetMs === b.budgetMs && a.attempt === b.attempt;

interface Settled {
  readonly outcome: ParseOutcome | null;
  readonly lastGood: HastRoot | null;
  /** The request `outcome` answers; absent until the first outcome settles. */
  readonly answers?: Request;
}

interface Waiting {
  readonly req: Request;
  readonly parser: MarkdownParser;
}

interface Jobs {
  /** Jobs started so far; a job's number tells it apart from every later one. */
  started: number;
  /** The job in flight, and the request it answers; absent while none runs. */
  running: { readonly n: number; readonly ctrl: AbortController; readonly req: Request } | undefined;
  /** The one request waiting behind it; absent when none waits. */
  queued: Waiting | undefined;
  /** The latest request the hook made; absent before the first. */
  latest: Request | undefined;
  /** The request the settled `outcome` answers; absent until an outcome settles for a latest request. */
  answered: Request | undefined;
}

/** The name of whatever was thrown: `name` for an error, else its `typeof`. Never the message. */
function thrownName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

function start(jobs: Jobs, next: Waiting, setSettled: Dispatch<SetStateAction<Settled>>): void {
  jobs.started += 1;
  const n = jobs.started;
  const ctrl = new AbortController();
  const { req, parser } = next;
  jobs.running = { n, ctrl, req };
  const current = (): boolean => jobs.running?.n === n;
  const runNext = (): void => {
    jobs.running = undefined;
    const q = jobs.queued;
    jobs.queued = undefined;
    if (q !== undefined) start(jobs, q, setSettled);
  };
  // The call is total: a parser that throws before returning its promise settles the job as `threw`, so the job
  // still ends and the waiting one still runs.
  let answer: Promise<ParseOutcome>;
  try {
    answer = parser(req.text, { profile: req.profile, budgetMs: req.budgetMs, signal: ctrl.signal });
  } catch (e) {
    answer = Promise.resolve({ kind: 'threw', error: thrownName(e) });
  }
  answer.then(
    (outcome) => {
      const isLatest = jobs.latest !== undefined && sameRequest(jobs.latest, req);
      if (!current()) return;
      setSettled((prev) => ({
        outcome: isLatest ? outcome : prev.outcome,
        lastGood: outcome.kind === 'tree' ? outcome.tree : prev.lastGood,
        answers: isLatest ? req : prev.answers,
      }));
      if (isLatest) jobs.answered = req;
      runNext();
    },
    () => {
      if (!current()) return;
      runNext();
    },
  );
}

export function useParsedMarkdown(
  text: string,
  parser: MarkdownParser,
  opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly attempt?: number },
): ParsedMarkdown {
  const { profile, budgetMs } = opts;
  const attempt = opts.attempt ?? 0;
  const [settled, setSettled] = useState<Settled>({ outcome: null, lastGood: null });
  const jobs = useRef<Jobs>({ started: 0, running: undefined, queued: undefined, latest: undefined, answered: undefined });

  useEffect(() => {
    const j = jobs.current;
    return () => {
      const r = j.running;
      j.running = undefined;
      j.queued = undefined;
      r?.ctrl.abort();
    };
  }, []);

  // `parser` is deliberately not a dependency: it is read when a request is made.
  useEffect(() => {
    const req: Request = { text, profile, budgetMs, attempt };
    const next: Waiting = { req, parser };
    const j = jobs.current;
    j.latest = req;
    // A request already answered, or answered by the running job, needs no job of its own.
    const covered =
      (j.answered !== undefined && sameRequest(j.answered, req)) ||
      (j.running !== undefined && sameRequest(j.running.req, req));
    if (j.running !== undefined) {
      j.queued = covered ? undefined : next;
      return;
    }
    if (covered) return;
    start(j, next, setSettled);
  }, [text, profile, budgetMs, attempt]);

  const current: Request = { text, profile, budgetMs, attempt };
  const pending = settled.answers === undefined || !sameRequest(settled.answers, current);
  return { outcome: settled.outcome, lastGood: settled.lastGood, pending };
}
