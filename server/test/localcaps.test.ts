// Fix round 3 (task 14 follow-up, Important #3): local mode's own evidence
// for `stopSurfaceSupported` — see `localcaps.ts`'s own comment for why this
// exists. Uses a REAL spawned process (via `readLocalCcdCaps` itself, not an
// injected stub callback — round 4 dropped the earlier `Runner` parameter
// entirely, since the bound and the process-group kill it needs live in a
// manual `spawn`, not the shared `Runner` abstraction) against a real,
// executable stub script on disk — the same idiom `agent/test/caps.test.ts`
// uses for the remote side, so this proves the actual exec mechanism, not
// just the string-parsing half.
import { describe, it, expect, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KILL_GRACE_MS, readLocalCcdCaps } from '../src/localcaps.js';
import { mkTmp } from './tmpHelpers.js';

// A DEADLINE THAT OUTLASTS THE SPAWN. Two fixtures below prove a timeout by
// letting the child record its own pid first, so that write has to land before
// the deadline fires or there is nothing left to check. Measured on macOS:
// starting `/bin/sh` and writing one line takes longer than the 200-300ms
// these tests were written to, and the child was killed before it ever wrote.
// It is bounded from ABOVE too: the descendant fixture proves the kill reached
// a grandchild by racing a 1s `touch`, so the deadline must fire before that.
// 600ms sits between the two on this box. The stubs sleep for minutes, so the
// timeout is still what ends every call — only the room given to reach it.
const KILL_BOUND_MS = process.platform === 'darwin' ? 600 : 200;

const writeStubCcd = (home: string, body: string): string => {
  const dir = path.join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};

describe('readLocalCcdCaps', () => {
  it('parses a real exec of a new-shaped ccd — stop-surface present', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'echo start\necho stop\necho stop-surface\nexit 0');
    expect(await readLocalCcdCaps(ccdBin)).toEqual(['start', 'stop', 'stop-surface']);
  });

  it('parses a real exec of an old-shaped ccd — stop-surface absent', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'echo start\necho stop\nexit 0');
    expect(await readLocalCcdCaps(ccdBin)).toEqual(['start', 'stop']);
  });

  it('answers null, not [], on a nonzero exit — no evidence is not zero capabilities', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'echo start\nexit 1');
    expect(await readLocalCcdCaps(ccdBin)).toBeNull();
  });

  it('answers null on a missing binary, rather than throwing', async () => {
    const home = mkTmp('ccrc-localcaps-');
    expect(await readLocalCcdCaps(path.join(home, 'no-such-ccd'))).toBeNull();
  });

  it('drops a line that is not verb-shaped, exactly like the agent-side reader does', async () => {
    // Same regex, same parser (`parseCcdCaps`, shared/agent-protocol.ts) —
    // proven here with a line no real ccd would print, to show the filter
    // is real and not just "whatever ccd happens to emit".
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, "echo start\necho 'not a verb!'\necho stop");
    expect(await readLocalCcdCaps(ccdBin)).toEqual(['start', 'stop']);
  });

  // Fix round 4 (task 14 follow-up, Important #1): the reviewer drove the
  // REAL composition root with `ccd` replaced by `sleep 600` and measured
  // boot hang forever — no listen line, `/health` unanswered across 25
  // retries; a `ccd` that merely reads stdin does the same, because Node
  // never closes a child's stdin pipe on its own. This function's stdin is
  // explicitly `'ignore'` (closed, reading as immediate EOF) precisely to
  // structurally remove THAT half of the hazard — proven here: `cat` with
  // no arguments would block forever on an open stdin, but against this
  // function it reads EOF at once and exits clean, needing no timeout at
  // all.
  it('a ccd that merely reads stdin does not hang at all — stdin is closed, not left open', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'cat'); // would block forever on an open/piped stdin
    const start = Date.now();
    const result = await readLocalCcdCaps(ccdBin, 5000);
    const elapsed = Date.now() - start;
    // Empty, zero-exit output parses to [] ("measured, and this box has
    // NONE" — see the function's own return-contract doc), not null: this
    // is a real answer from a real process that actually ran to
    // completion, not a timeout.
    expect(result).toEqual([]);
    expect(elapsed, 'must not need anywhere near the timeout to finish').toBeLessThan(1000);
  });

  // The OTHER hazard shape, which closing stdin cannot fix: a process that
  // is genuinely still running (CPU/wall-clock bound, not stdin-bound) —
  // `sleep 600` is the reviewer's own exact reproduction. A small override
  // timeout (not the real 10s production default, `LOCAL_CAPS_TIMEOUT_MS`)
  // keeps this test fast while proving the identical timer+kill mechanism
  // a production hang would hit.
  it('is bounded — a ccd that is genuinely still running does not block the caller past the timeout', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'sleep 600');
    const start = Date.now();
    const result = await readLocalCcdCaps(ccdBin, KILL_BOUND_MS);
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    expect(elapsed, 'must return near the bound, not hang indefinitely').toBeLessThan(2000);
  });

  // The process-group kill, proven directly rather than inferred from the
  // function returning promptly: a `spawn`+`{timeout}` shape that killed
  // only the direct child (a shell interpreter) left the reviewer's own
  // `sleep 600` reproduction running afterward, reparented to init — a
  // real leak a "returns in time" assertion alone cannot catch. This test
  // has the stub's grandchild WRITE a marker file after its own sleep, so
  // "the marker never appears" is direct evidence the descendant was
  // actually killed, not merely outraced.
  it('actually kills the hung process (and its children), not merely stops waiting for it', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const marker = path.join(home, 'still-alive');
    // A backgrounded grandchild the timeout must also reach: `spawn`'s
    // `detached: true` makes the whole tree one process GROUP, and the
    // group-kill in `execCapped` targets that group, not just the direct
    // child `cmd_caps` is running as.
    const ccdBin = writeStubCcd(home, `(sleep 1 && touch '${marker}') &\nsleep 600`);
    const result = await readLocalCcdCaps(ccdBin, KILL_BOUND_MS);
    expect(result).toBeNull();
    // Past the backgrounded job's own 1s mark, so a survivor would have
    // had time to write the marker.
    await new Promise((r) => setTimeout(r, 1300));
    expect(existsSync(marker), 'a descendant process survived the kill').toBe(false);
  });

  // The other half of the plan owner's own characterisation ("a slow-but-
  // valid ccd delays boot by exactly its runtime — a 3s stub cost 3s"): the
  // bound must not cut off a merely-slow, genuinely-finishing ccd before it
  // has a chance to answer. Boot itself no longer waits at all (`index.ts`
  // does not await this call), so this pins the READ's own contract in
  // isolation from that.
  it('a slow-but-valid ccd finishes within the bound and its real output is used', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'sleep 0.3\necho start\necho stop\nexit 0');
    expect(await readLocalCcdCaps(ccdBin, 5000)).toEqual(['start', 'stop']);
  });

  // Fix round 5 (task 14 follow-up, Minor #2): the one hang shape the
  // SIGTERM-only group kill did not actually kill — a stub that traps and
  // discards SIGTERM survives with its whole subtree, because nothing
  // about a caught signal ends the process. Real `ccd` installs no such
  // trap (checked before this was written), so this defends a shape
  // nobody has shipped, proven the same way the plain kill was: by
  // recording the real PID and checking it directly, not by inferring
  // survival from the function's own return.
  it('escalates to SIGKILL when the group ignores SIGTERM — the one shape SIGTERM alone cannot kill', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const pidFile = path.join(home, 'pid');
    const ccdBin = writeStubCcd(home, `trap '' TERM\necho $$ > '${pidFile}'\nsleep 600`);
    const result = await readLocalCcdCaps(ccdBin, KILL_BOUND_MS);
    expect(result).toBeNull(); // the caller is never blocked by the trap

    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    const isAlive = (): boolean => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    };

    // Shortly after the bound: SIGTERM was sent and trapped away — the
    // process is still here. Not a vacuous test: this proves the trap is
    // genuinely in effect before the escalation gets credit for anything.
    await new Promise((r) => setTimeout(r, 300));
    expect(isAlive(), 'the TERM-trapping process should still be alive right after SIGTERM alone').toBe(true);

    // Past the SIGKILL grace period — unmaskable, so the trap cannot save it.
    await new Promise((r) => setTimeout(r, KILL_GRACE_MS));
    expect(isAlive(), 'the SIGKILL escalation must have ended the trapping process').toBe(false);
  });

  // Fix round 5 (task 14 follow-up, Minor #3): a failed probe used to be
  // completely silent, and in local mode its effect is not transient — it
  // disables `--surface` for the rest of the process's life. One
  // `console.warn`, naming which failure shape fired, so an operator who
  // notices every stop recording `cli` has something to grep for.
  it('warns with the specific reason on every failure shape, and never on success', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const home = mkTmp('ccrc-localcaps-');

      const goodBin = writeStubCcd(home, 'echo start\nexit 0');
      await readLocalCcdCaps(goodBin);
      expect(warnSpy).not.toHaveBeenCalled();

      const nonzeroBin = writeStubCcd(home, 'echo start\nexit 3');
      await readLocalCcdCaps(nonzeroBin);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toMatch(/exited 3/);
      expect(warnSpy.mock.calls[0]![0]).toMatch(/--surface will be omitted/);
      warnSpy.mockClear();

      // A missing binary surfaces through `spawn`'s async 'error' event
      // (ENOENT), not the synchronous throw the try/catch around `spawn()`
      // itself guards — measured, not assumed; both paths still land in
      // the one `console.warn` call site.
      await readLocalCcdCaps(path.join(home, 'no-such-ccd'));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toMatch(/spawn error/);
      warnSpy.mockClear();

      const hangBin = writeStubCcd(home, 'sleep 600');
      await readLocalCcdCaps(hangBin, 200);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toMatch(/timed out after 200ms/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
