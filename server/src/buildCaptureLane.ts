// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md; the operator's ruling SH-1 of 2026-11-10). L4: the
// capture queue. Once a minute, on the watcher tick's sessions, it records a `claude_builds` row for every build a session
// runs that has none (`unrecordedBuilds`: a new build, D-8276's newest-build signal, and every build already live take the
// same path), then sends at most one job (`nextCaptureJob`: the newest queued build outside its retry spacing) through the
// test box transport, and lands the verdict the answer's one reader (`readBuildCaptureResult`) accepts. Every choice is
// `shared/claudeBuildTrust.ts`'s; this file only acts on it.
//
// NO VERDICT IS NOT A FAILURE. A box that is not there, a runner that is not built, a throw or an answer off its shape keeps
// the build `queued`, its attempt stamped, so it is sent again after the spacing. Only a verdict the reader accepted moves
// the row, and a `fail` raises ONE push notice opening Settings, keyed by build and attempt (`hasNotice`, read before the
// write), so a restart never repeats it and an operator's re-capture that fails again raises its own.
//
// `watch.ts` owns one of these and calls `sweep()` from its tick beside the roll, never awaited.
import { BUILD_CAPTURE_OUTPUT_MAX, nextCaptureJob, readBuildCaptureResult, unrecordedBuilds, type BuildCaptureJob } from '../../shared/claudeBuildTrust.js';
import type { WatcherCoordPort } from './coord/ports.js';
import { notify, type NoticeDeps } from './notice.js';
import type { TestboxBlock } from './testbox.js';

/** The lane's clock: once a minute. A new build is sent on the first pass after a session runs it. */
export const BUILD_CAPTURE_SWEEP_MS = 60_000;

/** Why the transport sent nothing it could judge. `no-test-box`: no box answers. `no-runner`: the box has no capture
 *  runner. `unanswered`: the job went out and no answer came back. */
export type BuildCaptureUnavailable = 'no-test-box' | 'no-runner' | 'unanswered';

/** What the transport answers: the runner's answer, unread (the lane reads it through `readBuildCaptureResult`), or why
 *  there is none. */
export type BuildCaptureAnswer =
  | { readonly kind: 'answered'; readonly result: unknown }
  | { readonly kind: 'unavailable'; readonly why: BuildCaptureUnavailable };

/** THE PORT: one job to the test box, over the existing test box connection. A rejection reads as `unanswered`. */
export interface BuildCaptureTransport {
  capture(job: BuildCaptureJob): Promise<BuildCaptureAnswer>;
}

/** The production adapter. It reads the test box lane's block: `no-test-box` while no box answers (no block yet, `off`,
 *  `down`, `unreachable`), and `no-runner` otherwise, because the box-side capture runner is the plan's open item. It
 *  sends nothing, so nothing is judged: every new build stays `queued` until the runner lands. */
export function testboxCaptureTransport(block: () => TestboxBlock | null): BuildCaptureTransport {
  return {
    capture: async () => {
      const b = block();
      const answers = b !== null && (b.state === 'ok' || b.state === 'degraded');
      return { kind: 'unavailable', why: answers ? 'no-runner' : 'no-test-box' };
    },
  };
}

export interface BuildCaptureLaneDeps extends NoticeDeps {
  readonly coord?: Pick<WatcherCoordPort, 'claudeBuilds' | 'noteClaudeBuildsSeen' | 'markClaudeBuildAttempt'
    | 'recordClaudeBuildVerdict' | 'hasNotice' | 'recordFeedEvent'> | undefined;
  /** Absent (a test, a script): rows are recorded and no job is sent. */
  readonly buildCapture?: BuildCaptureTransport | undefined;
}

export class BuildCaptureLane {
  /** The clock the last pass started on (0: never). A pass skipped while one runs takes no slot. */
  private lastSweep = 0;
  private inflight = false;

  constructor(private readonly deps: () => BuildCaptureLaneDeps, private readonly now: () => number = Date.now) {}

  /** One pass over `versions`, each session's build. Never rejects: `tick()` dispatches it with `void`. */
  async sweep(versions: readonly (string | null)[]): Promise<void> {
    const at = this.now();
    if (this.inflight) return;
    if (this.lastSweep !== 0 && at - this.lastSweep < BUILD_CAPTURE_SWEEP_MS) return;
    this.lastSweep = at;
    this.inflight = true;
    try {
      await this.pass(versions, at);
    } catch (err) {
      console.warn(`ccrc-server: build capture: pass failed (${err instanceof Error ? err.message : String(err)}) — the next pass retries`);
    } finally {
      this.inflight = false;
    }
  }

  private async pass(versions: readonly (string | null)[], at: number): Promise<void> {
    const d = this.deps();
    const coord = d.coord;
    if (coord === undefined) return;
    let records = coord.claudeBuilds();
    if (unrecordedBuilds(records, versions).length > 0) {
      coord.noteClaudeBuildsSeen(unrecordedBuilds(records, versions), at);
      records = coord.claudeBuilds();
    }
    const transport = d.buildCapture;
    const build = transport === undefined ? null : nextCaptureJob(records, at);
    if (transport === undefined || build === null) return;
    if (!coord.markClaudeBuildAttempt(build, at)) return;
    let answer: BuildCaptureAnswer;
    try { answer = await transport.capture({ build }); } catch { answer = { kind: 'unavailable', why: 'unanswered' }; }
    if (answer.kind === 'unavailable') return;
    const result = readBuildCaptureResult(answer.result, build);
    if (result === null) {
      console.warn(`ccrc-server: build capture: the answer for ${build} is not a capture result — it stays queued`);
      return;
    }
    if (!coord.recordClaudeBuildVerdict(result, this.now()) || result.pass) return;
    const attempts = coord.claudeBuilds().find((r) => r.build === build)?.attempts ?? 0;
    this.raiseFailure(d, build, attempts);
  }

  /** The failure's notice: one push opening Settings, keyed by build and attempt. A store that cannot answer the dedupe
   *  read costs the dedupe only: a repeat beats silence (the disk alarm's rule). */
  private raiseFailure(d: BuildCaptureLaneDeps, build: string, attempts: number): void {
    const dedupeKey = `claude-build-capture-failed:${build}:${attempts}`;
    try { if (d.coord?.hasNotice('coord', '', dedupeKey) === true) return; } catch { /* send it */ }
    notify(d, {
      kind: 'coord', sessionId: '', runId: null, title: `Claude Code ${build} failed its capture`,
      body: `The replay tests failed on the test box, so ${build} stays untrusted and children on it are refused approvals. `
        + `Settings › Automation › Test box shows the output (its last ${BUILD_CAPTURE_OUTPUT_MAX} characters) and Capture again.`,
    }, 'push', { tag: 'claude-build-capture', dedupeKey, url: '/settings', lane: 'build capture', degraded: 'capture verdict recorded, feed archive degraded' });
  }
}
