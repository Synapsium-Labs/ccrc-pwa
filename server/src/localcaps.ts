import { spawn } from 'node:child_process';
import { parseCcdCaps } from '../../shared/agent-protocol.js';

/** Same ceiling the agent's own `readCcdVerbs` uses for the identical
 *  operation on the identical class of box (`agent/src/server.ts`'s
 *  `DEFAULT_EXEC_TIMEOUT_MS`) — `ccd caps` is a static heredoc plus one
 *  `echo` (`cmd_caps`'s own docstring: a pure read, no I/O), so 10s is
 *  generous rather than tight; it exists to bound a HUNG child (a `ccd`
 *  wrapper shadowed by something that blocks on stdin, or a shebang that
 *  resolves to `sleep`), not a slow-but-honest one. */
export const LOCAL_CAPS_TIMEOUT_MS = 10_000;

/** Same ceiling `realRunner`/the agent's `runExec` both use for stdout
 *  buffering — `ccd caps`'s whole output is under 1KB today, so this is
 *  headroom, not a working limit. Enforced by hand here (not `execFile`'s
 *  `maxBuffer`) because this module spawns manually — see the function
 *  doc for why. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** Grace period between the SIGTERM escalation and the SIGKILL that follows
 *  it (fix round 5, task 14, Minor #2) — the standard two-step, long enough
 *  for an ordinary process to unwind on SIGTERM, short enough that the
 *  whole escalation stays well inside operator patience. Real `ccd` installs
 *  no top-level TERM trap (checked), so this fires in production only for a
 *  hang shape nobody has actually shipped — but the mechanism exists
 *  precisely to cover shapes nobody has shipped YET. */
export const KILL_GRACE_MS = 2_000;

/**
 * Local mode's own evidence for `stopSurfaceSupported` and every other
 * capability check `verbSupported` makes (fix round 3, task 14, Important
 * #3). Before round 3, local mode's `Deps.fleetState` was simply absent, so
 * every gated check answered off `ccdVerbs === null` — "no evidence,
 * permit" for an ordinary verb, which is safe (guessing wrong there is
 * LOUD: ccd's own usage refusal, a 502, never a lie) but, for `--surface`
 * specifically, the opposite guess is the safe one (see
 * `stopSurfaceSupported`'s own comment in `ccdargv.ts`) — and inverting
 * that default with no local evidence at all would have left the surface
 * feature permanently dead in local mode, the DEFAULT deployment mode
 * (`deploy/ccrc.env.example`'s own `CCRC_FLEET=local`).
 *
 * ONE exec, and BOUNDED (fix round 4, task 14, Important #1 — the reviewer
 * drove the real `index.ts` with `ccd` replaced by `sleep 600` and measured
 * boot hang forever: no listen line, `/health` unanswered across 25
 * retries, the process still stuck when the harness killed it; a `ccd` that
 * merely reads stdin does the same, because Node never closes a child's
 * stdin pipe on its own). An EARLIER version of this function took an
 * injected `Runner` and reused `realRunner`/`exec.ts`'s shared local
 * runner, which has NO timeout — correctly so, since `realRunner` is the
 * one path every OTHER ccd call goes through too, including `ccd swap`
 * carrying a 188MB sidecar through the `cp -a` fallback, measured at over
 * two minutes; a blanket timeout on that shared runner would break the
 * feature this whole branch exists to deliver. So the bound lives HERE, at
 * this one call site — never on `realRunner`.
 *
 * SPAWNED MANUALLY, NOT VIA `execFile`'s OWN `timeout` OPTION — measured,
 * not assumed: an earlier version used `execFile(cmd, args, { timeout })`,
 * which sends the kill signal to the DIRECT child only. `ccd` is a shell
 * script; when its final command runs as a genuine grandchild rather than
 * a shell tail-call exec, killing the direct child (the shell interpreter)
 * leaves the grandchild orphaned and running — reproduced live against the
 * real composition root with a `sleep 600` stub: `/health` answered inside
 * a second (bounded, as required), but the `sleep 600` process itself
 * survived, reparented to init, still consuming a slot ten seconds later.
 * Fixed by spawning `detached: true` (POSIX: the child becomes the leader
 * of its own new process GROUP) and, on timeout, signalling the whole
 * group via `process.kill(-child.pid, 'SIGTERM')` rather than the one
 * process Node itself tracks — the standard shape for "kill this and
 * everything it spawned," confirmed by re-running the same `sleep 600`
 * reproduction and finding no surviving process afterward.
 *
 * SIGTERM, THEN SIGKILL (fix round 5, task 14, Minor #2): a stub — or, one
 * day, a real wrapper — that TRAPS `SIGTERM` returns `null` at the bound
 * as designed (this function still resolves on time) but SURVIVES with its
 * whole subtree, because nothing about a caught, ignored SIGTERM ends the
 * process. That is the one hang shape a SIGTERM-only kill does not
 * actually kill, which matters precisely because killing hang shapes is
 * this mechanism's whole job. `KILL_GRACE_MS` after the SIGTERM, an
 * unmaskable SIGKILL follows to the same group — scheduled independently
 * of this function's own promise, so it still fires and still cleans up
 * even though the CALLER already moved on at the timeout. Real `ccd`
 * installs no top-level trap (checked before writing this), so this is
 * defence for a shape nobody has shipped, not a fix for one that exists.
 *
 * A FAILED PROBE IS LOGGED (fix round 5, task 14, Minor #3): silent before
 * this — no journal line, and in local mode the effect is not transient,
 * it disables `--surface` for the rest of the process's life (one probe,
 * at boot, no retry). One `console.warn`, naming which of the three
 * failure shapes (spawn error, nonzero exit, timeout) fired, so an
 * operator who notices every stop recording `cli` has something to grep
 * for instead of a silent, permanent degrade.
 *
 * TWO RESIDUALS OF DETACHED SPAWNING, STATED RATHER THAN FIXED (fix round
 * 5, task 14, Minor #5 — both inherent to the mechanism, both bounded to
 * at most one child process for one server lifetime, neither a regression
 * this function introduced beyond what detaching always costs):
 *   1. A GROUP-DIRECTED signal to the SERVER itself (a terminal Ctrl-C, a
 *      process-group-directed supervisor stop) kills the server but — a
 *      detached child is, by construction, in a DIFFERENT process group —
 *      leaves the probe process running, orphaned. Confirmed with a
 *      control: a non-detached child dies under the identical signal, so
 *      this is specifically the cost of `detached: true`, not a general
 *      signal-handling gap. Production is covered regardless:
 *      `deploy/ccrc.service` sets no `KillMode`, so systemd's DEFAULT
 *      (`control-group`) still reaps the whole cgroup, probe included, on
 *      `systemctl stop`. The exposed case is a foreground/dev run killed
 *      by hand.
 *   2. The server exiting WHILE a probe is in flight (a crash, a forced
 *      exit, not a graceful stop) orphans the probe permanently — its own
 *      10s timeout timer dies with the parent process before it ever
 *      fires, so nothing later reaps it. Reproduced via `EADDRINUSE` (the
 *      server process exiting on a bind failure while a probe was already
 *      running).
 *   Neither gets a shutdown hook: the blast radius is one process, once,
 *   and building lifecycle machinery to close it would be a bigger surface
 *   than the residual it removes — the plan owner's own ruling.
 *
 * NON-BLOCKING at the caller: `index.ts` does not `await` this before
 * `app.listen()` — it seeds `fleetState.ccdVerbs: null` synchronously and
 * lets this resolve into it in the background, so even the bounded delay
 * above never sits on the boot path. "Not yet known" is exactly `null`,
 * which is already the safe, disclosed answer both `verbSupported` and
 * `stopSurfaceSupported` give it.
 *
 * THE RETURN CONTRACT, precisely, because `null` and `[]` mean OPPOSITE
 * things to every caller of `verbSupported`/`stopSurfaceSupported` (fix
 * round 4, task 14, Minor #5 — undocumented before this):
 *   - `null` — "no evidence": the exec failed, timed out, or spawned a
 *     process that never answered inside the bound. `verbSupported`
 *     PERMITS on null (guessing wrong about an ordinary verb is loud);
 *     `stopSurfaceSupported` REFUSES on null (guessing wrong about
 *     `--surface` is a silent success). Neither reads a probe failure as a
 *     fact about ccd's capabilities.
 *   - `[]` (a genuine possibility: a ZERO-exit ccd whose stdout parses to
 *     no capability-shaped lines at all — a stub, a badly patched ccd, or
 *     one whose `cmd_caps` heredoc got emptied by a bad merge) —
 *     "measured, and this box has NONE." `verbSupported` and
 *     `stopSurfaceSupported` both then REFUSE every single gated verb,
 *     `--surface` included: `verbs.includes(x)` is false for every `x`
 *     when `verbs` is `[]`. In local mode that greys out roughly twenty
 *     gated call sites at once, not just this one — a real, sharp-edged
 *     consequence of a genuinely empty answer, disclosed here rather than
 *     left to be discovered.
 *   - Two of those ~twenty call sites degrade SILENTLY on a `false`
 *     verdict rather than answering an HTTP error: `FleetWatcher`'s naming
 *     sweep (`watch.ts`) simply skips the row, and `archiveMerged`'s
 *     auto-archive gate simply does not archive. Both comments' own
 *     "self-heals on the next sweep once the host is upgraded" premise is
 *     true in REMOTE mode — `FleetWatcher`'s OWN 60s timer (`watch.ts`'s
 *     `CAPS_REFRESH_MS`) re-asks the agent regardless of any signal from
 *     ccd; the agent itself has no timer, it answers when asked and
 *     re-execs only when ccd's mtime/size on disk has changed — but NOT in
 *     local mode, which reads once at boot: a `[]` (or a stale `null`)
 *     there self-heals only on the next server restart.
 */
export async function readLocalCcdCaps(
  ccdBin: string, timeoutMs: number = LOCAL_CAPS_TIMEOUT_MS,
): Promise<string[] | null> {
  const r = await execCapped(ccdBin, ['caps'], timeoutMs);
  if (r.code !== 0) {
    // The one log line this probe ever gets — see the function doc for
    // why silence here is the wrong default on this branch specifically.
    console.warn(
      `ccrc-server: local ccd caps probe failed (${r.reason}) — --surface will be omitted from ` +
      'every stop until this box\'s ccd answers "ccd caps" cleanly. In local mode there is no ' +
      'periodic retry: this is re-probed only at the next server restart.',
    );
    return null;
  }
  return parseCcdCaps(r.stdout);
}

/** The manual spawn+group-kill mechanism `readLocalCcdCaps` needs — see its
 *  own doc comment for why `execFile`'s built-in `timeout` is not enough.
 *  `reason` is populated on every non-zero `code`, human-readable, for the
 *  one `console.warn` call site above. */
function execCapped(
  cmd: string, args: string[], timeoutMs: number,
): Promise<{ code: number; stdout: string; reason: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number, stdout: string, reason: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, reason });
    };

    let child;
    try {
      // `detached: true` — POSIX makes this process the leader of a NEW
      // process group distinct from this server's own, so the group-kill
      // below can never reach anything but this one subtree. stdin
      // `'ignore'`, not inherited or a dangling pipe: an unclosed stdin is
      // the OTHER named hazard ("a ccd that merely reads stdin" hangs the
      // same way `sleep` does), closed here structurally rather than left
      // to the timeout alone to cover.
      child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      resolve({ code: 1, stdout: '', reason: `could not spawn: ${(err as Error).message}` });
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return;
      total += chunk.length;
      if (total > MAX_BUFFER) { truncated = true; return; }
      chunks.push(chunk);
    });

    const timer = setTimeout(() => {
      if (typeof child.pid === 'number') {
        const pid = child.pid;
        try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
        // Escalation, scheduled independently of `finish` below: the
        // CALLER already gets its answer at the timeout regardless, but
        // this timer keeps running on its own to guarantee the group is
        // actually gone — a TERM-trapping stub survives the line above
        // alone (verified: see localcaps.test.ts's dedicated test) and
        // needs the unmaskable follow-up to actually die.
        setTimeout(() => {
          try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
        }, KILL_GRACE_MS);
      }
      finish(1, '', `timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.on('error', (err) => finish(1, '', `spawn error: ${err.message}`));
    child.on('close', (code) => {
      // A truncated read is not a trustworthy zero — `parseCcdCaps('')`
      // would otherwise answer `[]` ("measured, and this box has NONE",
      // per the return contract above) for output that was never actually
      // read in full. Forced to `code 1` (-> `null`, "no evidence")
      // regardless of the process's own exit status.
      if (truncated) { finish(1, '', `stdout exceeded ${MAX_BUFFER} bytes`); return; }
      if (code !== 0) { finish(code ?? 1, '', `exited ${code ?? 'with no code (signalled)'}`); return; }
      finish(0, Buffer.concat(chunks).toString('utf8'), null);
    });
  });
}
