import type { ExecResult, Runner } from '../exec.js';
import type { FleetClient } from './client.js';

/**
 * `Runner` over the agent's `exec` op — same shape/contract as `realRunner`
 * (never throws; any transport/protocol failure comes back as a non-zero
 * `ExecResult` with the failure reason in `stderr`, exactly like a local
 * `execFile` spawn error already does), so every existing `Tmux`/`ccd`
 * call site works unmodified whether `run` is local or remote.
 */

const CCD_TIMEOUT_MS = 90_000;
const TMUX_TIMEOUT_MS = 10_000;
// Give the round trip some slack over the agent's own exec timeout so a
// legitimately slow-but-finishing command doesn't get raced by our local
// per-request wait timeout.
const CLIENT_TIMEOUT_SLACK_MS = 5_000;

/** Per-verb budgets. `pr-state` shells out to gh over the network; `ws-reap`
 *  can be deleting several gigabytes of node_modules. The flat 90 s was fine
 *  while every ccd call was a tmux/systemd operation and is wrong for both
 *  ends of that range now. `pr-open` is deliberately absent, but NOT because
 *  ccd bounds it: its gh calls carry `timeout 12` and its `git push` — the
 *  likeliest thing in the verb to hang — carries no bound of its own. The flat
 *  CCD_TIMEOUT_MS default is what bounds the push, and 90 s is the right budget
 *  for one, so there is nothing to override here. */
const CCD_VERB_TIMEOUT_MS: Record<string, number> = {
  'pr-state': 20_000,
  'ws-archive': 60_000,
  'ws-restore': 60_000,
  // Equals CCD_TIMEOUT_MS's own default below — kept explicit, as
  // documentation that ws-audit's budget was chosen deliberately (a fleet
  // scan over every workspace) and not just left to fall through unnoticed,
  // even though no test can tell this line apart from its own absence.
  'ws-audit': 90_000,
  'ws-reap': 240_000,
};

function timeoutMsFor(cmd: string, args: string[]): number {
  if (cmd !== 'ccd') return TMUX_TIMEOUT_MS;
  // `?? ''` guards an empty `args` (args[0] === undefined) from reaching the
  // lookup as a literal `undefined` key. Provably redundant against THIS
  // map, disclosed rather than removed: no key here is `''` or the coerced
  // `"undefined"`, so an empty-array lookup misses either way and the `??
  // CCD_TIMEOUT_MS` below already covers the miss — the guard would only
  // change behaviour if a future verb were ever keyed `''`.
  return CCD_VERB_TIMEOUT_MS[args[0] ?? ''] ?? CCD_TIMEOUT_MS;
}

function asExecResult(res: unknown): ExecResult {
  const r = res as { code?: unknown; stdout?: unknown; stderr?: unknown };
  return {
    code: typeof r.code === 'number' ? r.code : 1,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
  };
}

/** The agent's exec whitelist accepts BARE command names only. Local call
 *  sites pass `cfg.ccdBin` (an absolute `~/.local/bin/ccd` path — correct for
 *  local exec), so normalize any `…/ccd` to bare `ccd` for the wire; the agent
 *  re-resolves it against ITS OWN home. Everything else passes unchanged. */
export function wireCmd(cmd: string): string {
  return cmd.split('/').pop() === 'ccd' ? 'ccd' : cmd;
}

export function createRunner(client: FleetClient): Runner {
  return async (cmd, args) => {
    const sendCmd = wireCmd(cmd);
    const timeoutMs = timeoutMsFor(sendCmd, args);
    try {
      const res = await client.request(
        { t: 'req', op: 'exec', cmd: sendCmd, args, timeoutMs },
        timeoutMs + CLIENT_TIMEOUT_SLACK_MS,
      );
      return asExecResult(res);
    } catch (e) {
      return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
    }
  };
}
