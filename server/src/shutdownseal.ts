// THE SHUTDOWN SEAL (fix round 5, D-4916; the operator's choice of 2026-10-13, "Seal on clean shutdown"). The server has
// no other signal handler: Node's default SIGTERM/SIGINT action ends the process without running anything, so the
// dead-coordinator breaker's typed state could never learn that a stop was a clean one. This installs the one handler, in
// the composition root's single additive block (`index.ts`, L5), and keeps the order and the bound in one place, testable
// without a process:
//   1. stop the watcher's timer, so no tick starts a pass behind the seal;
//   2. ask the lane to seal within ONE total bound (`SHUTDOWN_SEAL_BOUND_MS`): the lane awaits the pass in flight, then
//      writes `sealed` only when every condition holds (`FleetWatcher.sealDeadCoordinatorBreaker`), else writes nothing;
//   3. say a refusal or a failure in ONE `console.warn('ccrc-server: …')` line, and never throw;
//   4. exit with today's status: remove the handlers and RE-RAISE the same signal, so the process dies of the signal as it did
//      before this handler existed (systemd, `ccrc update`'s health gate and the watchdog read the same exit). The stop takes
//      up to the bound longer, and during it the watcher's tick is stopped; a tick in flight, the routes and the independent
//      timers (the box-token driver's, the auth sessions', the session sockets') keep running, so an act begun then is cut
//      off by the re-raise, as a SIGKILL would cut it. A
//      second identical signal during the bound is not handled (the listeners are `once`): it kills at once, with no seal. A
//      DIFFERENT signal during the bound (a SIGINT inside a SIGTERM's, or the reverse) IS handled: its `once` listener stands
//      until the first handler's `finally` removes both, so a second handler runs beside the first. When a pass is in flight
//      both wait on it and the first to resume goes first: it seals, removes both listeners and re-raises its own signal,
//      and the process dies of that one; the seal is one generation-checked statement, so no second write can land.
// A handler that waited past its bound would turn a stop into a SIGKILL after systemd's timeout (90 s by default; the unit
// sets none); the bound is 5 s: a pass in flight asks tmux about a handful of coordinators, one agent round trip each, and
// the seal itself is one local statement. A pass that outlives it is not awaited and nothing is sealed: the next start seeds
// conservatively, which is the cost of an unclean exit and never an early act — unless no write of this server landed and
// the state still reads sealed (a bound overrun on a sealed start's first pass, before its unseal), when the old seal stands
// and is trusted, correctly, since this server changed nothing.
import type { DeadCoordinatorSealResult } from './deadCoordinator.js';

/** The one total bound, in milliseconds, a shutdown waits on the seal. */
export const SHUTDOWN_SEAL_BOUND_MS = 5_000;

/** What the handler needs of the watcher. */
export interface SealingWatcher {
  stop(): void;
  sealDeadCoordinatorBreaker(boundMs: number): Promise<DeadCoordinatorSealResult>;
}

/** What the handler needs of `process`, so a test can hand it a recorder. */
export interface SignalHost {
  readonly pid: number;
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
  kill(pid: number, signal: NodeJS.Signals): unknown;
}

const SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/** What the next start does after a refused seal (review 411, F3). Two refusals write nothing and leave the state as it
 *  stands, which may be a seal the next start TRUSTS; every other one, the bound and a throw seed conservatively unless no write of this server landed and the state still reads sealed (a bound
 *  overrun before a sealed start's unseal), when the seal stands and is trusted (review of fix round 6, finding 1). */
function refusalTail(reason: Extract<DeadCoordinatorSealResult, { sealed: false }>['reason']): string {
  switch (reason) {
    case 'already-sealed': return 'the state is already sealed, which the next start trusts';
    case 'no-landed-write': return 'nothing was written; the state stands as the last server left it, and the next start trusts it only if it reads sealed';
    default: return 'the next start seeds it conservatively, unless no write of this server landed and the state still reads sealed';
  }
}

/** Install the SIGTERM and SIGINT handlers. Returns the function that removes them (tests). */
export function installShutdownSeal(
  watcher: SealingWatcher, host: SignalHost = process, boundMs: number = SHUTDOWN_SEAL_BOUND_MS,
  log: Pick<Console, 'log' | 'warn'> = console,
): () => void {
  const listeners = new Map<NodeJS.Signals, () => void>();
  const removeAll = (): void => { for (const [sig, fn] of listeners) host.removeListener(sig, fn); };
  const handle = (sig: NodeJS.Signals): void => {
    void (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        try { watcher.stop(); } catch (err) { log.warn(`ccrc-server: shutdown: the watcher did not stop (${err instanceof Error ? err.message : String(err)})`); }
        const bound = new Promise<'over'>((resolve) => { timer = setTimeout(() => resolve('over'), boundMs + 500); });
        const out = await Promise.race([watcher.sealDeadCoordinatorBreaker(boundMs), bound]);
        if (out === 'over') log.warn(`ccrc-server: shutdown: the dead-coordinator breaker's state was not sealed (no answer within ${boundMs} ms) — the next start seeds it conservatively, unless no write of this server landed and the state still reads sealed`);
        else if (!out.sealed) log.warn(`ccrc-server: shutdown: the dead-coordinator breaker's state was not sealed (${out.reason}) — ${refusalTail(out.reason)}`);
        else log.log('ccrc-server: shutdown: the dead-coordinator breaker\'s state is sealed');
      } catch (err) {
        log.warn(`ccrc-server: shutdown: the dead-coordinator breaker's state was not sealed (${err instanceof Error ? err.message : String(err)}) — the next start seeds it conservatively, unless no write of this server landed and the state still reads sealed`);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        removeAll();
        host.kill(host.pid, sig);
      }
    })();
  };
  for (const sig of SIGNALS) {
    const fn = (): void => handle(sig);
    listeners.set(sig, fn);
    host.once(sig, fn);
  }
  return removeAll;
}
