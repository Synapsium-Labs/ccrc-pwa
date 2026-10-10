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
  // 25, not 20, since landing-order wave 2: `pr-state --project` makes THREE
  // gh calls now (rows, rollups, the merge-queue read), and their timeouts are
  // summed against this number by `pr-timeout-budget.test.ts`. The key is the
  // VERB, so `--session` (one gh call) is bounded at 25 s too, and it is read
  // INSIDE `coordMutex` — by `verifyDone` at close and at advance, and through
  // `childSpent` by every child-bind check (`childBindGate` on `POST /api/runs`,
  // dispatch's resume arm) and by the close's child gate (`childGateAtClose`,
  // up to two reads per close) — so every other coordination write can queue
  // behind one slow read for up to this long.
  'pr-state': 25_000,
  // Same reach as pr-state: it shells out to `git ls-remote` against origin
  // before it will rename. Without an entry it silently inherits the flat
  // 90 s, which is nine naming lanes' worth. It makes ONE network call, so it
  // keeps the 20 s pr-state had before its third.
  'ws-rename': 20_000,
  'ws-archive': 60_000,
  'ws-restore': 60_000,
  // Equals CCD_TIMEOUT_MS's own default below — kept explicit, as
  // documentation that ws-audit's budget was chosen deliberately (a fleet
  // scan over every workspace) and not just left to fall through unnoticed,
  // even though no test can tell this line apart from its own absence.
  'ws-audit': 90_000,
  'ws-reap': 240_000,
  // Child reclamation (spec 2026-09-22 §5.6): ws-reap's destruction — a
  // worktree that can hold gigabytes of node_modules, a branch, the clips, a
  // temp root — plus a pin phase and a settle. It earns ws-reap's budget, not
  // the flat 90 s it would silently inherit without this row.
  'ws-reclaim': 240_000,
  // Archived-workspace expiry (spec 2026-09-24 §5.3): ws-reclaim's machinery — the pin phase, the settle and the same
  // teardown — on an archived workspace, so it earns the same budget.
  'ws-expire': 240_000,
  // The child temp-root collector (spec 2026-09-22 §5.10): its probes, a quarantine move, and the removal of a tree that
  // can hold gigabytes, all under the reap lock. It earns ws-reclaim's budget, not the flat 90 s it would silently
  // inherit without this row. Its audit is `ws-audit` and keeps that verb's row. A fresh collection runs eight bounded
  // probes, about 180 s in all: the evaluation's 70 s (the idle walk 30, the in-use probe 10, the checkout scan 30),
  // step 3a's checkout scan 30, step 5's two in-use probes 2 x 10, and the removal's 60 (its checkout scan 30, then the
  // permission pass `_ws_reclaim_normalise`, a second 30 s walk) — plus each probe's TERM-to-KILL grace (3 s by default,
  // 24 s over eight). That leaves about 36 s for the `rm` itself, which no bound of its own caps. At the widest grace
  // (8 s each) the probes alone can reach about 244 s, past the row, and it still fails safe. A big leaf may need
  // several passes, and nothing is lost: the quarantine record carries the next pass.
  'ws-collect': 240_000,
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
  //     at `SUPERVISED_START_WAIT` (30 s, ccd/ccd:81). Comfortably inside 90 s.
  //   • the two UNSUPERVISED fallbacks (no `systemctl`, or the unit refuses to
  //     enable): `_spawn_start` + `_spawn_settle`, whose wall-clock bound on this
  //     agent-reachable path is `SPAWN_SETTLE_S` (240 s, ccd/ccd:84) — a COLD
  //     Claude Code start against a freshly seeded workspace HOME. That is what
  //     exceeds 90 s, and 300 s is the agent's own `MAX_EXEC_TIMEOUT_MS` ceiling.
  // `cmd_enable` is an arity check plus `cmd_start`, so it inherits the same worst
  // case exactly — hence the same number rather than a guess.
  start: 300_000,
  enable: 300_000,
  // `cmd_swap` stops the supervisor unit (ccd/ccd:13722) and kills the tmux
  // pane (:13723) BEFORE it flips the registry's `wrapper` (:13817). A kill
  // inside that window leaves a session that is not running, a registry that
  // still names the old account, and NO marker of either: no `swapblocked`, no
  // `lastswap`, no line in `swap.log`. Nothing in the tree can tell that state
  // from "never swapped", which is why this is a correctness fix and not a
  // comfort margin.
  //
  // 300 s is the agent's own `MAX_EXEC_TIMEOUT_MS` ceiling (agent/src/server.ts),
  // not a merely larger number, because the transcript carry has no bash-side
  // bound below it — `SWAP_BEAT_MAX` bounds the heartbeat re-stamping, not the
  // copy. So this NARROWS the window to the agent's maximum; it does not close
  // it, and a carry slower than 300 s is still killed mid-flight. Closing it
  // needs a ccd-side bound and is not this row's job.
  swap: 300_000,
  // The four Docs verbs (spec 2026-10-01 section 2 (a), Budgets). ccd's python helper bounds each one itself: a
  // whole-verb deadline (`HELPER_DEADLINE_S` in ccd/ccd: index 12 s, tree 12 s, show 7 s, fetch 45 s), at which it
  // sends SIGTERM to every git process group it started and SIGKILL `KILL_GRACE_S` (2 s) later. Each budget below
  // is strictly greater than that deadline + the 2 s grace + 5 s; `docs-budget.test.ts` reads both sides from
  // source and holds the inequality, and docs-show's margin is the thinnest (exactly 1 s).
  //
  // Why the margin must stay positive: these budgets exist so the AGENT never kills ccd in normal operation. The
  // agent's deadline (`runExec`'s `execFile` timeout) kills only its direct child, so a kill landing while the
  // helper still waits on git would orphan git's process group (`git-remote-https`, ssh, `git-lfs`) rather than
  // let the helper's own `killpg` reap it. The helper's deadline must always fire first. Without these rows a
  // docs verb silently inherits the flat 90 s.
  //
  // The docs-index budget is also doctor's wait: ccd/ccrc-doctor-checks defaults `CCRC_DOCTOR_DOCS_TIMEOUT` to it
  // in seconds, so doctor waits exactly as long as a Docs page would; `docs-budget.test.ts` holds the two equal.
  'docs-index': 20_000,
  'docs-tree': 20_000,
  'docs-show': 15_000,
  'docs-fetch': 60_000,
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
 *  a peer this build cannot trust must read as ABSENT, not as `false`.
 *
 *  `signal` (§1.7) is the same rule one class narrower, and it was the half
 *  still being dropped: the agent has sent BOTH since §1.4 (`agent/src/server.ts`
 *  `runExec`), and naming only `killed` here re-narrows exactly the distinction
 *  §1.4 widened. A child node did not kill itself arrives `killed: false` with a
 *  `signal` naming what did — the only evidence that a `ws-add` was cut short by
 *  an operator `kill`, an OOM reaper, or systemd stopping the unit mid-spawn.
 *  BOTH `string` AND an explicit `null` are carried, because a present `null`
 *  ("measured: no signal") is a different fact from the key being missing ("an
 *  older agent, which measured nothing"), and only the spread keeps them apart. */
function asExecResult(res: unknown): ExecResult {
  const r = res as { code?: unknown; stdout?: unknown; stderr?: unknown; signal?: unknown };
  return {
    code: typeof r.code === 'number' ? r.code : 1,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    ...(typeof (res as { killed?: unknown }).killed === 'boolean'
      ? { killed: (res as { killed: boolean }).killed }
      : {}),
    ...(typeof r.signal === 'string' || r.signal === null
      ? { signal: r.signal as string | null }
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
      // NEITHER HALF HERE, DELIBERATELY, and a test pins the absence. Three facts
      // sit on `code: 1`, not two: ccd refused, ccd was cut short, and we do not
      // know because the LINK failed (a dropped socket, a client-side wait
      // expiry). Not-adopting is the safe outcome for all three, and `killed:
      // false`/`signal: null` would be as wrong as their positives — absence is
      // the honest answer, and `cutShort` (`lifecycle.ts`) reads it as
      // `UNMEASURED`.
      //
      // NOT "the ONE shape `cutShort` answers `UNMEASURED` for", which is what
      // this comment claimed until 00fd376 widened that function. The SIGNAL
      // half decides there now and `killed` only fast-paths an adopt, so every
      // shape with an unmeasured `signal` that `killed` does not fast-path
      // answers `UNMEASURED`: this one, which sends neither half, and the half-measured
      // `killed: false, signal` absent that `asExecResult`'s independent
      // spreads let a peer frame carry. The property this arm actually depends
      // on was never uniqueness — it is that omitting BOTH lands on
      // `UNMEASURED`, and it still does. Adding either field here would demote
      // this from "unknown" to "measured, and it refused cleanly".
      return { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
    }
  };
}
