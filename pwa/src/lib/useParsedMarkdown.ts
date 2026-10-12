// The async parse hook (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clause 3, the W4 plan's
// refinements (g) and (i)). Chat's long messages parse through it; W5's DocMarkdown will too. Per hook:
//   - At most one job runs and at most one waits. A new request (a changed text, profile, budget or attempt) starts
//     a job when none runs, and otherwise REPLACES the waiting one, so a message that streams in faster than it
//     parses costs one job per settle, never one per token.
//   - A job's result is applied only while that job is still the hook's running job. Unmount aborts the running
//     job's signal and drops the waiting one, so a parser that answers after that is not heard.
//   - `lastGood` is the last tree that settled, kept through any later outcome, so a caller can show it while a
//     newer text parses.
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
  /** The job in flight; absent while none runs. */
  running: { readonly n: number; readonly ctrl: AbortController } | undefined;
  /** The one request waiting behind it; absent when none waits. */
  queued: Waiting | undefined;
}

function start(jobs: Jobs, next: Waiting, setSettled: Dispatch<SetStateAction<Settled>>): void {
  jobs.started += 1;
  const n = jobs.started;
  const ctrl = new AbortController();
  jobs.running = { n, ctrl };
  const { req, parser } = next;
  const current = (): boolean => jobs.running?.n === n;
  const runNext = (): void => {
    jobs.running = undefined;
    const q = jobs.queued;
    jobs.queued = undefined;
    if (q !== undefined) start(jobs, q, setSettled);
  };
  parser(req.text, { profile: req.profile, budgetMs: req.budgetMs, signal: ctrl.signal }).then(
    (outcome) => {
      if (!current()) return;
      setSettled((prev) => ({
        outcome,
        lastGood: outcome.kind === 'tree' ? outcome.tree : prev.lastGood,
        answers: req,
      }));
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
  const jobs = useRef<Jobs>({ started: 0, running: undefined, queued: undefined });

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
    const next: Waiting = { req: { text, profile, budgetMs, attempt }, parser };
    const j = jobs.current;
    if (j.running !== undefined) {
      j.queued = next;
      return;
    }
    start(j, next, setSettled);
  }, [text, profile, budgetMs, attempt]);

  const current: Request = { text, profile, budgetMs, attempt };
  const pending = settled.answers === undefined || !sameRequest(settled.answers, current);
  return { outcome: settled.outcome, lastGood: settled.lastGood, pending };
}
