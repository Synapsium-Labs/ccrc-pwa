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

function timeoutMsFor(cmd: string): number {
  return cmd === 'ccd' ? CCD_TIMEOUT_MS : TMUX_TIMEOUT_MS;
}

function asExecResult(res: unknown): ExecResult {
  const r = res as { code?: unknown; stdout?: unknown; stderr?: unknown };
  return {
    code: typeof r.code === 'number' ? r.code : 1,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
  };
}

export function createRunner(client: FleetClient): Runner {
  return async (cmd, args) => {
    const timeoutMs = timeoutMsFor(cmd);
    try {
      const res = await client.request(
        { t: 'req', op: 'exec', cmd, args, timeoutMs },
        timeoutMs + CLIENT_TIMEOUT_SLACK_MS,
      );
      return asExecResult(res);
    } catch (e) {
      return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
    }
  };
}
