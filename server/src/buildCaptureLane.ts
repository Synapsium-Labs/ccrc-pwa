// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md; the operator's ruling SH-1 of 2026-11-10). L4: the
// capture queue. Once a minute, on the watcher tick's sessions, it records a `claude_builds` row for every build a session
// runs that has none (`unrecordedBuilds`: a new build, D-8276's newest-build signal, and every build already live take the
// same path), then sends at most one job (`nextCaptureJob`: the newest queued build outside its retry spacing) through the
// test box transport, and lands the verdict the answer's one reader (`readBuildCaptureResult`) accepts. Every choice is
// `shared/claudeBuildTrust.ts`'s; this file only acts on it.
//
// A FAILURE IS RETRIED BEFORE ANYONE IS TOLD (the Overlord's "a new Claude Code release needs no operator",
// `docs/superpowers/programs/overlord/claude-release-unattended.md`, slug capture-retry-ceiling). Each pass first puts every
// failed build whose time has come back in the queue (`capturesToRetry`: an hour after its first failure, two after its
// second), through the same writer as the operator's Capture again. Only the failed verdict that reaches the ceiling
// (`captureStandingOf` answers `given-up`) tells the operator: one push, and one Waiting on you item naming the act only they
// can do (`untrustedBuildItemOf`). Every other open item settles on the next pass (`untrustedBuildItemsToSettle`).
//
// NO VERDICT IS NOT A FAILURE. A box that is not there, a runner that is not built, a throw or an answer off its shape keeps
// the build `queued`, its retry clock stamped, so it is tried again after the spacing. ONLY A JOB THAT WENT OUT IS AN
// ATTEMPT: a throw, an off-shape answer or `unanswered` counts one; `no-test-box` and `no-runner` sent nothing, so they count
// none and the row records why (`notSent`), which the console says instead of "sent N times". Only a verdict the reader
// accepted moves the row, and a `fail` that gives up raises ONE push notice opening Settings, keyed by build and attempt
// (`hasNotice`, read before the write), so a restart never repeats it and an operator's re-capture that fails again raises its own.
//
// `watch.ts` owns one of these and calls `sweep()` from its tick beside the roll, never awaited.
import {
  BUILD_CAPTURE_OUTPUT_MAX, captureStandingOf, capturesToRetry, nextCaptureJob, readBuildCaptureResult, unrecordedBuilds,
  type BuildCaptureJob, type BuildCaptureNotSent, type ClaudeBuildRecord,
} from '../../shared/claudeBuildTrust.js';
import type { WatcherCoordPort } from './coord/ports.js';
import {
  openUntrustedBuildItems, UNTRUSTED_BUILD_ITEM_PROGRAMME, untrustedBuildItemOf, untrustedBuildItemsToSettle,
} from './coord/untrustedBuildItem.js';
import { notify, type NoticeDeps } from './notice.js';
import type { TestboxBlock } from './testbox.js';

/** The lane's clock: once a minute. A new build is sent on the first pass after a session runs it. */
export const BUILD_CAPTURE_SWEEP_MS = 60_000;

/** Why the transport brought back nothing it could judge. `no-test-box`: no box answers, and nothing was sent. `no-runner`:
 *  the box has no capture runner, and nothing was sent. `unanswered`: the job went out and no answer came back. */
export type BuildCaptureUnavailable = BuildCaptureNotSent | 'unanswered';

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
 *  sends nothing, so nothing is judged and no attempt is counted: every new build stays `queued`, its row saying why, and
 *  the test box card says no build can be captured (`captureBlockedBy`) until the runner lands. */
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
    | 'recordClaudeBuildVerdict' | 'requeueClaudeBuild' | 'hasNotice' | 'recordFeedEvent' | 'itemsFor' | 'moveItem' | 'raiseItem'> | undefined;
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
    const retry = capturesToRetry(records, at);
    if (retry.length > 0) {
      for (const b of retry) coord.requeueClaudeBuild(b);
      records = coord.claudeBuilds();
    }
    this.settleItems(coord, records, at);
    const transport = d.buildCapture;
    const build = transport === undefined ? null : nextCaptureJob(records, at);
    if (transport === undefined || build === null) return;
    // One pass at a time (`inflight`), so the try is stamped after the answer: it says whether a job actually went out.
    let answer: BuildCaptureAnswer;
    try { answer = await transport.capture({ build }); } catch { answer = { kind: 'unavailable', why: 'unanswered' }; }
    const sentNothing = answer.kind === 'unavailable' && answer.why !== 'unanswered' ? answer.why : null;
    if (!coord.markClaudeBuildAttempt(build, at, sentNothing ?? 'sent')) return;
    if (answer.kind === 'unavailable') return;
    const result = readBuildCaptureResult(answer.result, build);
    if (result === null) {
      console.warn(`ccrc-server: build capture: the answer for ${build} is not a capture result — it stays queued`);
      return;
    }
    if (!coord.recordClaudeBuildVerdict(result, this.now()) || result.pass) return;
    // A failure ccrc will capture again tells nobody: only the verdict that gives up does.
    const row = coord.claudeBuilds().find((r) => r.build === build);
    if (row === undefined || captureStandingOf(row).kind !== 'given-up') return;
    this.raiseGivenUp(d, coord, row, at);
  }

  /** Each pass, the open untrusted-build items whose build ccrc has not given up on settle, each with its note (L1's
   *  `untrustedBuildItemsToSettle` decides; this acts). A move that is refused (the item moved meanwhile) is left. */
  private settleItems(coord: NonNullable<BuildCaptureLaneDeps['coord']>, records: readonly ClaudeBuildRecord[], at: number): void {
    const open = openUntrustedBuildItems(coord.itemsFor(UNTRUSTED_BUILD_ITEM_PROGRAMME, at).open);
    for (const item of untrustedBuildItemsToSettle(open, records)) {
      coord.moveItem(item.id, 'settle', 'ccrc', { note: item.note }, at, { programmeHasOpenRun: false });
    }
  }

  /** ccrc has given up on `row`: its Waiting on you item (L1's `untrustedBuildItemOf`, none while one is open for the build;
   *  the read and the raise run with no await between), then one push opening Settings, keyed by build and attempt. A store
   *  that cannot answer the dedupe read costs the dedupe only: a repeat beats silence (the disk alarm's rule). A raise that
   *  throws is logged and never stops the push. */
  private raiseGivenUp(d: BuildCaptureLaneDeps, coord: NonNullable<BuildCaptureLaneDeps['coord']>, row: ClaudeBuildRecord, at: number): void {
    const { build } = row;
    try {
      const open = openUntrustedBuildItems(coord.itemsFor(UNTRUSTED_BUILD_ITEM_PROGRAMME, at).open);
      const input = untrustedBuildItemOf(new Set(open.map((i) => i.build)), row);
      if (input !== null) coord.raiseItem(input, at, 'ccrc');
    } catch (err) {
      console.warn(`ccrc-server: build capture: the item for ${build} was not raised (${err instanceof Error ? err.message : String(err)})`);
    }
    const dedupeKey = `claude-build-capture-failed:${build}:${row.attempts}`;
    try { if (coord.hasNotice('coord', '', dedupeKey)) return; } catch { /* send it */ }
    notify(d, {
      kind: 'coord', sessionId: '', runId: null, title: `Claude Code ${build} failed its capture ${row.fails} times`,
      body: `The replay tests failed on the test box each time, so ccrc has stopped capturing ${build} by itself, and nothing is `
        + 'allowed through ccrc for a child on it. Settings › Automation › Test box shows the output (its last '
        + `${BUILD_CAPTURE_OUTPUT_MAX} characters) and Capture again.`,
    }, 'push', { tag: 'claude-build-capture', dedupeKey, url: '/settings', lane: 'build capture', degraded: 'capture verdict recorded, feed archive degraded' });
  }
}
