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
  // Same reach as pr-state, and the same number: it shells out to `git
  // ls-remote` against origin before it will rename. Without an entry it
  // silently inherits the flat 90 s, which is nine naming lanes' worth.
  'ws-rename': 20_000,
  'ws-archive': 60_000,
  'ws-restore': 60_000,
  // Equals CCD_TIMEOUT_MS's own default below — kept explicit, as
  // documentation that ws-audit's budget was chosen deliberately (a fleet
  // scan over every workspace) and not just left to fall through unnoticed,
  // even though no test can tell this line apart from its own absence.
  'ws-audit': 90_000,
  'ws-reap': 240_000,
  // The two SPAWNING verbs, and the reason they need the agent's MAXIMUM
  // (`MAX_EXEC_TIMEOUT_MS`, agent/src/server.ts) rather than a merely larger
  // number (F8, found live 2026-08-12). Both end in `_spawn`, which blocks in
  // `_accept_first_run_prompts` until the new pane renders a ready banner —
  // i.e. a COLD Claude Code start against a freshly seeded workspace HOME. That
  // is not a fleet operation whose cost this repo controls: it boots a node
  // process, reads the wrapper's config, and dials every configured MCP server,
  // and on the live fleet a workspace whose MCP servers were awaiting
  // authentication was still not ready 90 s in.
  //
  // What the flat default did there is the whole reason these rows exist:
  // `cmd_ws_add` writes the worktree and every registry row FIRST and calls
  // `_spawn` LAST, so a kill at 90 s landed AFTER the workspace existed and
  // BEFORE `_reg_set started 1` — leaving a fully-registered workspace with no
  // session, bound to no run, while dispatch answered `fleetFailed` with an
  // EMPTY stderr — not because a killed child writes nothing (execFile
  // delivers whatever was already buffered) but because NO STDERR-WRITING
  // STATEMENT WAS REACHED: ccd was still blocked inside the settle. Corrected
  // here rather than left standing; §1.4 now carries the distinction on the
  // wire. The run stayed `planned`.
  // An orphan is the expensive failure: it costs a worktree, a branch and a
  // registry identity that only a human may clear (`ws-rm`/`ws-reap` are
  // human-only by contract), so this budget is set to the ceiling deliberately
  // — being slow here costs one request, being short costs manual cleanup.
  //
  // NOT the whole fix, and the remaining half is stated so it is not mistaken
  // for one: `_accept_first_run_prompts` waits up to ~900 s (450 * 2 s), which
  // EXCEEDS the agent's 300 s ceiling, so a session slower than 300 s still
  // cannot be spawned through this path at all — it can only ever be killed.
  // Bounding ccd's own wait below this ceiling, and making `ws-add` recoverable
  // rather than orphaning when it is hit, is tracked as the ccd-side half.
  'ws-add': 300_000,
  ensure: 300_000,
  // The two SUPERVISION verbs, which used to inherit the flat 90 s silently.
  // `cmd_start` goes through `_supervised_start`, and BOTH of its outcomes are
  // bounded — which is why this is a correctness fix rather than a latent F8 —
  // but they are bounded at very different numbers, and it is the SECOND one that
  // sets this budget:
  //   • systemd happy path: `reset-failed` + `enable --now`, then a poll bounded
  //     at `SUPERVISED_START_WAIT` (30 s, ccd/ccd:79). Comfortably inside 90 s.
  //   • the two UNSUPERVISED fallbacks (no `systemctl`, or the unit refuses to
  //     enable): `_spawn_start` + `_spawn_settle`, whose wall-clock bound on this
  //     agent-reachable path is `SPAWN_SETTLE_S` (240 s, ccd/ccd:82) — a COLD
  //     Claude Code start against a freshly seeded workspace HOME. That is what
  //     exceeds 90 s, and 300 s is the agent's own `MAX_EXEC_TIMEOUT_MS` ceiling.
  // `cmd_enable` is an arity check plus `cmd_start`, so it inherits the same worst
  // case exactly — hence the same number rather than a guess.
  start: 300_000,
  enable: 300_000,
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

/** THE L3 RULE, applied here rather than described: this function rebuilds the
 *  object field by field, so anything it does not name is DISCARDED — which is
 *  exactly how the agent's `killed` was being narrowed away one hop before §1.5
 *  needed it. Spread-conditional, not `killed: Boolean(...)`: a non-boolean from
 *  a peer this build cannot trust must read as ABSENT, not as `false`. */
function asExecResult(res: unknown): ExecResult {
  const r = res as { code?: unknown; stdout?: unknown; stderr?: unknown };
  return {
    code: typeof r.code === 'number' ? r.code : 1,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    ...(typeof (res as { killed?: unknown }).killed === 'boolean'
      ? { killed: (res as { killed: boolean }).killed }
      : {}),
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
      // NO `killed` HERE, DELIBERATELY, and a test pins the absence. Three facts
      // sit on `code: 1`, not two: ccd refused, we killed ccd, and we do not know
      // because the LINK failed (a dropped socket, a client-side wait expiry).
      // Not-adopting is the safe outcome for all three, and adding `killed: false`
      // would be as wrong as `killed: true` — absence is the honest answer.
      return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
    }
  };
}
