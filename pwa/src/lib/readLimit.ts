// THE READ TIME LIMIT (console speed, task C1 "the link and the start"; spec 2026-11-04 §2.3, D12). `lib/api.ts`'s one
// funnel sends every request through `limitedFetch`: a GET gets `READ_TIMEOUT_MS` to answer unless it passes its own
// `timeoutMs`, and a write gets no default, because a write's outcome must not be guessed. Its own module because
// `api.ts` is a file the growth check holds; `api.ts` re-exports every name here, so a caller imports from either.

/** Every GET's limit unless it passes its own. */
export const READ_TIMEOUT_MS = 20_000;

/** A request that outran its time limit: the server may be slow, not refusing. Never an `ApiError` (there was no
 *  answer to carry a status), and never folded into a generic failure, so a screen can say "the server is slow". */
export class ApiTimeout extends Error {
  readonly path: string;
  readonly ms: number;
  constructor(path: string, ms: number) {
    super(`no answer from ${path} within ${Math.round(ms / 1000)} s`);
    this.name = 'ApiTimeout';
    this.path = path;
    this.ms = ms;
  }
}

/** A read's options. `signal` aborts it (a caller abort rejects with the signal's reason, an `AbortError` by default);
 *  `timeoutMs` replaces the GET default, and `null` means no limit at all. */
export interface ReadOpts {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number | null;
}

/** The GETs whose server-side bound is above `READ_TIMEOUT_MS`, each with its own limit: the server's bound plus the
 *  agent link's 5 s slack (`CLIENT_TIMEOUT_SLACK_MS`) on each remote call, rounded up. Read from
 *  `server/src/remote/runner.ts`'s `CCD_VERB_TIMEOUT_MS` and `TMUX_TIMEOUT_MS`, and `update/inventory.ts`'s
 *  `INVENTORY_BUDGET_MS`. A route behind the server's `knownId` gate first reads the registry over the agent link (one
 *  remote read, bounded at 15 s). These are the remote fleet's bounds: in local mode (`CCRC_FLEET=local`) the server's
 *  ccd and tmux calls have no remote bound at all, and these limits are the only ones. */
export const LONG_READ_MS = {
  /** `knownId`'s registry read, 15 s, then `ccd ws-audit`, the ccd default, 90 s, plus its slack: 110 s. */
  workspaceAudit: 115_000,
  /** `knownId`'s registry read, 15 s, then the slower of `ccd pr-state` (25 s plus slack) and the route's task read
   *  beside it (`prTasks`: four sequential agent reads of up to 15 s each, five with its re-listing). On the pr-state
   *  path that is 45 s; a slow-but-answering agent can hold the route to 75 or 90 s, and that surfaces here as a
   *  fair "slow" (`ApiTimeout`): the PR sheet then keeps the fleet sweep's PR state and leaves the draft's title and
   *  body unfilled. */
  pr: 50_000,
  /** Two tmux calls in sequence, 10 s each, with the 5 s slack on each call: 30 s. */
  paneHistory: 35_000,
  /** Before the server's own node row exists, two inventory sweeps of 10 s each. */
  updates: 30_000,
} as const;

const isGet = (init?: RequestInit): boolean => (init?.method ?? 'GET').toUpperCase() === 'GET';

/** `fetchImpl` under the time limit. With no limit and no caller signal it is the plain call, byte for byte. With a
 *  limit, one controller carries both the caller's signals and the limit, and the call also races the limit, so a
 *  fetch that ignores its signal still rejects `ApiTimeout`. The deadline timer is this call's own; it is left to run
 *  out after the answer, so a body still being read when it fires is aborted too, and one already read is untouched. */
export async function limitedFetch(
  fetchImpl: typeof fetch, path: string, init: RequestInit | undefined, opts: ReadOpts | undefined,
): Promise<Response> {
  const ms = opts?.timeoutMs !== undefined ? opts.timeoutMs : isGet(init) ? READ_TIMEOUT_MS : null;
  if (ms === null && opts?.signal === undefined) return fetchImpl(path, init);
  if (ms === null && !init?.signal) return fetchImpl(path, { ...init, signal: opts?.signal ?? null });
  const outer = [opts?.signal, init?.signal ?? undefined].filter((x): x is AbortSignal => x !== undefined);
  const ctl = new AbortController();
  let fail: (err: unknown) => void = () => {};
  const stop = new Promise<never>((_resolve, reject) => { fail = reject; });
  stop.catch(() => {}); // settled by whichever comes first; never an unhandled rejection
  const quit = (reason: unknown): void => { fail(reason); ctl.abort(reason); };
  for (const sig of outer) {
    if (sig.aborted) quit(sig.reason);
    else sig.addEventListener('abort', () => quit(sig.reason), { once: true });
  }
  if (ms !== null && !ctl.signal.aborted) setTimeout(() => quit(new ApiTimeout(path, ms)), ms);
  if (ctl.signal.aborted) return stop;
  return Promise.race([fetchImpl(path, { ...init, signal: ctl.signal }), stop]);
}
