// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md; the operator's ruling SH-1 of 2026-11-10). L4: the
// capture queue. Once a minute, on the watcher tick's sessions, it records a `claude_builds` row for every build a session
// runs that has none (`unrecordedBuilds`: a new build, D-8276's newest-build signal, and every build already live take the
// same path), then sends at most one job (`nextCaptureJob`: the newest queued build outside its retry spacing) through the
// test box transport, and lands the verdict the answer's one reader (`readBuildCaptureResult`) accepts. Every choice is
// `shared/claudeBuildTrust.ts`'s; this file only acts on it.
//
// A FAILURE IS RETRIED BEFORE ANYONE IS TOLD (the Overlord's "a new Claude Code release needs no operator",
// `docs/superpowers/programs/overlord/claude-release-unattended.md`, slug capture-retry-ceiling). Each pass first puts every
// failed build whose time has come and that a session still runs back in the queue (`capturesToRetry`: an hour after its
// first failure, two after its second), through the same writer as the operator's Capture again, keeping its count and its
// last output (`keepLadder`). Only the failed verdict that reaches the ceiling on a build a session runs (`givenUpToTell`)
// tells the operator, with one push; a build no session runs gives up quietly. Each pass raises the Waiting on you item
// naming the act only the operator can do for any such build that has none (`untrustedBuildItemsToRaise`), and settles
// every other open item (`untrustedBuildItemsToSettle`).
//
// THE COPY (capture runner spec 2026-11-22 §2.2, D7). A box that holds no checked copy of the build refuses the capture
// `build-absent`; the pass then copies the fleet's own copy over the admin lane (`BuildCopyTransport`) and sends the capture
// again. WHEN is `shared/claudeBuildTrust.ts#captureNextAct`'s decision, read after each act; this file only carries it out,
// and no adapter sequences two ops.
//
// NO VERDICT IS NOT A FAILURE. A box that is not there, a runner that is not built, a throw or an answer off its shape keeps
// the build `queued`, its retry clock stamped, so it is tried again after the spacing. ONLY A JOB THAT WENT OUT IS AN
// ATTEMPT: a throw, an off-shape answer or `unanswered` counts one; a not-sent word (`BuildCaptureNotSent`, a failed copy's
// included) counts no capture attempt, and the row records why (`notSent`). Only a verdict the reader accepted moves the
// row. A `fail` that gives up raises ONE push notice opening Settings, keyed by build and attempt (`hasNotice`, read before
// the write), so a restart never repeats it and an operator's re-capture that fails again raises its own.
//
// THE DELIVERY CAPTURE (Desktop polish wave 178; `shared/deliveryLane.ts` decides, this file acts). After the trust part, and
// ONLY when this pass sent no trust job (`nextCaptureJob` gave none), `nextDeliveryJob` names at most ONE (build, part) of the
// paste delivery recipe, sent through the same transport. So a pass makes at most one capture, trust first, and the pass's
// `inflight` guard keeps at most one delivery capture in flight for the box: a sweep that comes while one is out sends
// nothing. The result is read by its one reader (`readDeliveryCaptureResult`) and judged by `deliveryResultCurrency`; only a
// current one is stored (`recordDelivery`). A DELIVERY RESULT NEVER TOUCHES A TRUST ROW: it never records a verdict, stamps a
// trust attempt, requeues a build, raises an item or pushes.
//
// THE FRAMES CAPTURE (Desktop polish wave 187; `shared/framesLane.ts` decides, this file acts). ONLY when this pass sent no
// trust job and no delivery job, `nextFramesJob` names at most ONE (build, part) of the box frames recipe, sent through the
// same transport. The result is read by its one reader; a result of another recipe version is not stored; a current one is
// CHECKED AGAIN here, on the server (the capture owner's condition 1: `framesReduce.ts#checkReducedFrame`, the reducer's own
// check, with the live masker beside it), and stored with the check's word, its text only when the check is clear, while
// the frame texts of builds past the newest four are set aside in the same write. A refused frame is one log line naming
// the build, the part and the word, never the text. A FRAMES RESULT NEVER TOUCHES A TRUST OR DELIVERY ROW.
//
// `watch.ts` owns one of these and calls `sweep()` from its tick beside the roll, never awaited.
import {
  BUILD_CAPTURE_OUTPUT_MAX, captureNextAct, capturesToRetry, captureTryOf, givenUpToTell, nextCaptureJob,
  readBuildCaptureResult, unrecordedBuilds, type BuildCaptureJob, type BuildCaptureNotSent, type BuildCopyFailure,
  type CapturePassStep, type ClaudeBuildRecord,
} from '../../shared/claudeBuildTrust.js';
import { nextDeliveryJob } from '../../shared/deliveryLane.js';
import { deliveryResultCurrency } from '../../shared/deliveryCapture.js';
import { readDeliveryCaptureResult } from '../../shared/deliveryResult.js';
import { FRAMES_RECIPE_VERSION, framesOurs } from '../../shared/framesCapture.js';
import { framesTextToDrop, nextFramesJob } from '../../shared/framesLane.js';
import { checkReducedFrame } from '../../shared/framesReduce.js';
import { FRAMES_PARTS, readFramesCaptureResult } from '../../shared/framesResult.js';
import { framesScan } from '../../shared/framesScan.mjs';
import type { WatcherCoordPort } from './coord/ports.js';
import {
  openUntrustedBuildItems, UNTRUSTED_BUILD_ITEM_PROGRAMME, untrustedBuildItemsToRaise, untrustedBuildItemsToSettle,
} from './coord/untrustedBuildItem.js';
import { notify, type NoticeDeps } from './notice.js';

/** The lane's clock: once a minute. A new build is sent on the first pass after a session runs it. */
export const BUILD_CAPTURE_SWEEP_MS = 60_000;

/** Why the transport brought back nothing it could judge: a not-sent word (nothing was sent), or `unanswered` (the job went
 *  out and no answer came back). `recipe-not-run` is a DELIVERY job's word alone (`deliveryResult.ts#DeliveryNotSent`): the box
 *  was reached and does not run the recipe. The trust loop below never receives it. */
export type BuildCaptureUnavailable = BuildCaptureNotSent | 'recipe-not-run' | 'unanswered';

/** What the transport answers: the runner's answer, unread (the lane reads it through `readBuildCaptureResult`), or why
 *  there is none. */
export type BuildCaptureAnswer =
  | { readonly kind: 'answered'; readonly result: unknown }
  | { readonly kind: 'unavailable'; readonly why: BuildCaptureUnavailable; readonly detail?: string };

/** THE PORT: one capture job to the test box through the fleet agent. A rejection reads as `unanswered`. */
export interface BuildCaptureTransport {
  capture(job: BuildCaptureJob): Promise<BuildCaptureAnswer>;
}

/** What the copy came to: the build is placed on the box (`copied`), or why not. */
export type BuildCopyAnswer = 'copied' | BuildCopyFailure;

/** THE COPY PORT (spec §2.2): the fleet's own copy of one build, read-only, to the test box's capture store, hashed at both
 *  ends. Never rejects; a rejection reads as `copy-failed`. */
export interface BuildCopyTransport {
  copy(job: BuildCaptureJob): Promise<BuildCopyAnswer>;
}

export interface BuildCaptureLaneDeps extends NoticeDeps {
  readonly coord?: Pick<WatcherCoordPort, 'claudeBuilds' | 'noteClaudeBuildsSeen' | 'markClaudeBuildAttempt'
    | 'recordClaudeBuildVerdict' | 'requeueClaudeBuild' | 'claudeBuildDeliveries' | 'markDeliveryAttempt' | 'recordDelivery'
    | 'claudeBuildFrames' | 'markFramesAttempt' | 'recordFrames' | 'hasNotice' | 'recordFeedEvent' | 'itemsFor' | 'moveItem' | 'raiseItem'> | undefined;
  /** Whether the product's live masker would change a text (`SecretMasker`): the receiver's check runs it beside the
   *  reducer's own shapes. Absent: the shapes alone. */
  readonly framesMasked?: ((text: string) => boolean) | undefined;
  /** Absent (a test, a script): rows are recorded and no job is sent. */
  readonly buildCapture?: BuildCaptureTransport | undefined;
  /** Absent: a `build-absent` refusal is answered `no-admin-lane`, and nothing is copied. */
  readonly buildCopy?: BuildCopyTransport | undefined;
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
    const retry = capturesToRetry(records, at, versions);
    if (retry.length > 0) {
      for (const b of retry) coord.requeueClaudeBuild(b, { keepLadder: true });
      records = coord.claudeBuilds();
    }
    this.settleItems(coord, records, at);
    this.raiseItems(coord, records, versions, at);
    const transport = d.buildCapture;
    const build = transport === undefined ? null : nextCaptureJob(records, at);
    if (transport === undefined) return;
    if (build === null) {
      if (await this.deliveryPass(coord, transport, records, at)) return;
      await this.framesPass(d, coord, transport, records, at);
      return;
    }
    // One pass at a time (`inflight`), so the try is stamped after the pass's acts: it says whether a job actually went out.
    // Each act is the decider's (`captureNextAct`): the capture, and after a `build-absent` the copy and the capture again.
    const steps: CapturePassStep[] = [];
    let answer: BuildCaptureAnswer | null = null;
    for (let act = captureNextAct(steps); act !== 'stop'; act = captureNextAct(steps)) {
      if (act === 'copy') { steps.push(await this.copy(d.buildCopy, build)); continue; }
      try { answer = await transport.capture({ build }); } catch { answer = { kind: 'unavailable', why: 'unanswered' }; }
      steps.push(answer.kind === 'unavailable' && answer.why !== 'unanswered' && answer.why !== 'recipe-not-run' ? answer.why : 'sent');
    }
    if (!coord.markClaudeBuildAttempt(build, at, captureTryOf(steps))) return;
    if (answer === null || answer.kind === 'unavailable') return;
    const result = readBuildCaptureResult(answer.result, build);
    if (result === null) {
      console.warn(`ccrc-server: build capture: the answer for ${build} is not a capture result — it stays queued`);
      return;
    }
    if (!coord.recordClaudeBuildVerdict(result, this.now()) || result.pass) return;
    // A failure ccrc will capture again tells nobody: only the verdict that gives up does.
    const after = coord.claudeBuilds();
    const row = after.find((r) => r.build === build);
    if (row === undefined || !givenUpToTell(row, versions)) return;
    this.raiseItems(coord, after, versions, at);
    this.pushGivenUp(d, coord, row);
  }

  /** The delivery recipe's one job of a pass, when no trust job went out (the caller's `build === null`): the decider's
   *  (build, part), sent through the same transport, the attempt stamped after the send, then what came back. Nothing here
   *  reads or writes a trust row. */
  private async deliveryPass(
    coord: NonNullable<BuildCaptureLaneDeps['coord']>, transport: BuildCaptureTransport, records: readonly ClaudeBuildRecord[], at: number,
  ): Promise<boolean> {
    const job = nextDeliveryJob(records, coord.claudeBuildDeliveries(), at);
    if (job === null) return false;
    await this.deliverySend(coord, transport, job, at);
    return true;
  }

  /** The delivery job the decider named: sent, stamped, read and stored (the body of the pass before wave 187, unchanged). A
   *  pass that named one sends no frames job. */
  private async deliverySend(
    coord: NonNullable<BuildCaptureLaneDeps['coord']>, transport: BuildCaptureTransport, job: { readonly build: string; readonly part: number }, at: number,
  ): Promise<void> {
    const { build, part } = job;
    let answer: BuildCaptureAnswer;
    try { answer = await transport.capture({ build, recipe: 'delivery', part }); } catch { answer = { kind: 'unavailable', why: 'unanswered' }; }
    // A not-sent word stamps the try only; an answer, or `unanswered`, is one counted attempt, spaced by the hour. A refused
    // stamp ends the pass before anything is recorded, as the trust loop's does (call 1253, condition 1).
    if (!coord.markDeliveryAttempt(build, part, at, answer.kind === 'unavailable' && answer.why !== 'unanswered' ? answer.why : 'sent')) return;
    if (answer.kind === 'unavailable') {
      // THE ONE LINE of a delivery job that was not taken (review 3898 F6, the coordinator's ruling): the transport and the
      // remote arm log nothing for it and hand over what was measured, the fleet agent's refusal or the box's closed frame.
      if (answer.why === 'recipe-not-run') {
        console.warn(`ccrc-server: delivery capture: ${build} part ${part}: not sent: ${answer.detail ?? 'the test box closed the connection on the delivery frame'}; no attempt counted, asked again after the spacing`);
      }
      return;
    }
    const result = readDeliveryCaptureResult(answer.result, build, part);
    if (result === null) {
      console.warn(`ccrc-server: delivery capture: the answer for ${build} part ${part} is not a delivery result — no row is stored`);
      return;
    }
    switch (deliveryResultCurrency(result)) {
      case 'current':
        if (!coord.recordDelivery(result, this.now())) console.warn(`ccrc-server: delivery capture: the result for ${build} part ${part} could not be stored — asked again after the spacing`);
        return;
      case 'another-recipe': return;
      case 'contradiction':
        console.warn(`ccrc-server: delivery capture: ${build} part ${part} carries this recipe's version with cases the part does not hold — no row is stored`);
        return;
    }
  }

  /** The box frames recipe's one job of a pass, when no trust job and no delivery job went out: the decider's (build, part),
   *  sent through the same transport, the attempt stamped after the send, then what came back, checked again and stored. */
  private async framesPass(
    d: BuildCaptureLaneDeps, coord: NonNullable<BuildCaptureLaneDeps['coord']>, transport: BuildCaptureTransport, records: readonly ClaudeBuildRecord[], at: number,
  ): Promise<void> {
    const rows = coord.claudeBuildFrames();
    const job = nextFramesJob(records, rows, at);
    if (job === null) return;
    const { build, part } = job;
    let answer: BuildCaptureAnswer;
    try { answer = await transport.capture({ build, recipe: 'frames', part }); } catch { answer = { kind: 'unavailable', why: 'unanswered' }; }
    if (!coord.markFramesAttempt(build, part, at, answer.kind === 'unavailable' && answer.why !== 'unanswered' ? answer.why : 'sent')) return;
    if (answer.kind === 'unavailable') {
      if (answer.why === 'recipe-not-run') {
        console.warn(`ccrc-server: frames capture: ${build} part ${part}: not sent: ${answer.detail ?? 'the test box closed the connection on the frames frame'}; no attempt counted, asked again after the spacing`);
      }
      return;
    }
    const result = readFramesCaptureResult(answer.result, build, part);
    if (result === null) {
      console.warn(`ccrc-server: frames capture: the answer for ${build} part ${part} is not a frames result — no row is stored`);
      return;
    }
    if (result.version !== FRAMES_RECIPE_VERSION) return;
    // The receiver checks again (the capture owner's condition 1): the reducer's own check, and the live masker beside it.
    const p = FRAMES_PARTS[part]!;
    const text = result.frame.text;
    const masked = d.framesMasked;
    const check = text === null ? { ok: true as const }
      : checkReducedFrame(text, p.pane, framesOurs(p.case, p.pane), framesScan, masked === undefined ? undefined : (t) => masked(t));
    const checked = check.ok ? 'clear' as const : check.refusal;
    if (!check.ok) console.warn(`ccrc-server: frames capture: ${build} frame ${part} refused by the server's check (${check.refusal}); its text is not stored`);
    if (!coord.recordFrames(result, checked, this.now(), framesTextToDrop(rows, build))) {
      console.warn(`ccrc-server: frames capture: the result for ${build} part ${part} could not be stored — asked again after the spacing`);
    }
  }

  /** The copy, once: the port's answer, `no-admin-lane` with no port, `copy-failed` for a rejection. */
  private async copy(port: BuildCopyTransport | undefined, build: string): Promise<BuildCopyAnswer> {
    if (port === undefined) return 'no-admin-lane';
    try { return await port.copy({ build }); } catch { return 'copy-failed'; }
  }

  /** Each pass, the open untrusted-build items whose build ccrc has not given up on settle, each with its note (L1's
   *  `untrustedBuildItemsToSettle` decides; this acts). A move that is refused (the item moved meanwhile) is left. */
  private settleItems(coord: NonNullable<BuildCaptureLaneDeps['coord']>, records: readonly ClaudeBuildRecord[], at: number): void {
    const open = openUntrustedBuildItems(coord.itemsFor(UNTRUSTED_BUILD_ITEM_PROGRAMME, at).open);
    for (const item of untrustedBuildItemsToSettle(open, records)) {
      coord.moveItem(item.id, 'settle', 'ccrc', { note: item.note }, at, { programmeHasOpenRun: false });
    }
  }

  /** The Waiting on you items L1 says are missing (`untrustedBuildItemsToRaise`: a build given up with a session on it and no
   *  open item; the read and the raise run with no await between). A raise that throws is logged, and a later pass raises it. */
  private raiseItems(coord: NonNullable<BuildCaptureLaneDeps['coord']>, records: readonly ClaudeBuildRecord[], versions: readonly (string | null)[], at: number): void {
    try {
      const open = openUntrustedBuildItems(coord.itemsFor(UNTRUSTED_BUILD_ITEM_PROGRAMME, at).open);
      for (const input of untrustedBuildItemsToRaise(open, records, versions)) coord.raiseItem(input, at, 'ccrc');
    } catch (err) {
      console.warn(`ccrc-server: build capture: an untrusted-build item was not raised (${err instanceof Error ? err.message : String(err)}) — the next pass retries`);
    }
  }

  /** ccrc has given up on `row`, a build a session runs: one push opening Settings, keyed by build and attempt. A store that
   *  cannot answer the dedupe read costs the dedupe only: a repeat beats silence (the disk alarm's rule). */
  private pushGivenUp(d: BuildCaptureLaneDeps, coord: NonNullable<BuildCaptureLaneDeps['coord']>, row: ClaudeBuildRecord): void {
    const { build } = row;
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
