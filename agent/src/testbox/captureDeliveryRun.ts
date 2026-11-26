// The paste delivery recipe's drive (Desktop polish wave 178; task note docs/superpowers/programs/desktop-polish/paste-delivery.md).
// L4: it acts on what `captureDelivery.ts` decides and `shared/deliveryCapture.ts` judges, inside one capture the runner
// (`captureRunner.ts`) has set up and will tear down. The build is started; this drive runs the build-trust drive's start
// and model-switch steps, then sends each case through the product's own send (the driver child,
// `server/src/inject/deliveryDrive.ts`), reads that case's window, and ends with `/exit`.
//
// A FAULT OF THE BOX IS NEVER A VERDICT (the build-trust cut, carried over): a step before the cases that does not finish, a
// launcher that cannot type, a driver child that does not answer or refuses its input, and a build that is gone or whose
// life is unknown during the cases, each answer no verdict and a detail, so the door can try again. Only what the cases
// show is a result: every case is judged, and a refusal by the product's send is part of that result, never a box fault.
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import type { CaptureRecord } from '../../../shared/claudeBuildCapture.js';
import { deliveryCaptureResult, deliveryCaseResult } from '../../../shared/deliveryCapture.js';
import {
  DELIVERY_SEND_WORD, deliveryParts, type DeliveryCaptureResult, type DeliveryCaseId, type DeliveryCaseResult, type DeliveryRoute, type DeliveryUnmeasured,
} from '../../../shared/deliveryResult.js';
import { boundedStdinSpawn } from '../../../shared/spawn.mjs';
import { stepDone, type CaptureStep } from './capture.js';
import { DELIVERY_STEPS_BEFORE, DELIVERY_STEP_AFTER, observeWindow, turnEnded } from './captureDelivery.js';
import type { BuildLife, LaunchedBuild } from './captureRunner.js';

/** What the driver child is given: the capture's scratch directory, its tmux directory, and a case id. Never text. */
export interface DeliveryDriveInput { readonly capture: string; readonly tmux: string; readonly case: DeliveryCaseId }

/** The driver's answer: the send's word, or a fault of the box (the child did not answer, or refused its input). */
export type DriverAnswer = { readonly kind: 'sent'; readonly send: string } | { readonly kind: 'fault'; readonly detail: string };

/** Where the driver child runs: the capture's `PATH` (on which it finds tmux) and the runner's tmux base, which the child
 *  gets as its `TMPDIR` and so as the one parent it accepts for the capture's tmux directory. */
export interface DriverPlace { readonly path: string; readonly tmpBase: string }

/** Runs the driver for one case. Never throws. */
export interface DeliveryDriver { drive(input: DeliveryDriveInput, place: DriverPlace): Promise<DriverAnswer> }

/** The send words that are a fault of the box, never the product's answer. `not-alive`: the capture's own tmux session is
 *  not alive. The product's send answers it too: before it typed anything, but also after it typed the case text when every
 *  later echo read failed, and after its clear keys (`server/src/inject/send.ts`), so text may have reached the pane; in the
 *  capture's own tmux it means the pane is gone, and the part ends with no verdict either way (review 3898 F4). (A driver whose own tmux call could not
 *  complete exits non-zero, which is a fault below whatever send word its line carries.) */
export const DRIVER_BOX_FAULT_SENDS: readonly string[] = Object.freeze(['not-alive']);

/** The driver child's answer, from its exit status and its one stdout line: `{"send":<word>}` with status 0 is the send's
 *  word, unless it is one of {@link DRIVER_BOX_FAULT_SENDS}; anything else (a refused input, a driver that failed, a line
 *  off its shape, a non-zero exit with a send word) is a fault of the box. */
export function readDriverAnswer(code: number, stdout: string): DriverAnswer {
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'fault', detail: `the driver exited ${code} with no answer` }; }
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  if (code === 0 && Object.keys(o).join() === 'send' && typeof o['send'] === 'string' && DELIVERY_SEND_WORD.test(o['send']) && !DRIVER_BOX_FAULT_SENDS.includes(o['send'])) {
    return { kind: 'sent', send: o['send'] };
  }
  if (code === 3 && typeof o['fault'] === 'string' && typeof o['detail'] === 'string') {
    // A fault of the box: its reason and tmux's detail, never the send word, which is not the product's here (review 3898 A1).
    return { kind: 'fault', detail: `the driver exited 3: a fault of the box (${o['fault'].slice(0, 40)}): ${o['detail'].slice(0, 120)}` };
  }
  const word = typeof o['refused'] === 'string' ? `refused ${o['refused']}` : typeof o['send'] === 'string' ? o['send'] : 'an answer off its shape';
  return { kind: 'fault', detail: `the driver exited ${code}: ${word.slice(0, 80)}` };
}

/** The driver child's stdout cap: one short JSON line. */
const DRIVER_OUTPUT_MAX = 4096;

/** The production driver: `node <script>` as its own process group, the input as JSON on stdin, the environment built
 *  from empty (`PATH`, `TMPDIR` and `LANG` only), within `boundMs` (`CaptureTimings.deliveryDriveMs`), then SIGTERM, SIGKILL `graceMs` later
 *  (`CaptureTimings.deliveryKillGraceMs`) and one drain. */
export function nodeDeliveryDriver(node: string, script: string, boundMs: number, graceMs: number): DeliveryDriver {
  return {
    async drive(input, place) {
      const stdin = Buffer.from(JSON.stringify({ capture: input.capture, tmux: input.tmux, case: input.case }));
      const r = await boundedStdinSpawn({ spawn, signals: osConstants.signals }, node, [script], stdin, {
        env: { PATH: place.path, TMPDIR: place.tmpBase, LANG: 'C.UTF-8' }, timeoutMs: boundMs, killGraceMs: graceMs, maxOutputBytes: DRIVER_OUTPUT_MAX, drainMs: UPDATE_SPAWN_DRAIN_MS,
      });
      if (r.kind === 'exited') return readDriverAnswer(r.code, r.stdout);
      return { kind: 'fault', detail: r.kind === 'timeout' ? `the driver did not answer within ${boundMs} ms` : r.kind === 'too-large' ? 'the driver said too much' : 'the driver could not start' };
    },
  };
}

/** What the drive acts on: the started build, what the stand-in has received, the recording so far, and the bounds. */
export interface DeliveryDriveContext {
  readonly launched: LaunchedBuild;
  readonly life: () => Promise<BuildLife>;
  /** Every request the stand-in has received, in arrival order (the stand-in's own list, read live). */
  readonly requests: readonly unknown[];
  /** The route each of `requests` came by, same index (the stand-in's own list, read live). */
  readonly routes: readonly DeliveryRoute[];
  /** The position of each request on a route the stand-in does not script (`captureStub.ts`'s `others`), read live; absent: none
   *  (review 3898 A3). */
  readonly others?: readonly number[];
  /** The recording so far, read fresh. */
  readonly records: () => readonly CaptureRecord[];
  readonly input: Omit<DeliveryDriveInput, 'case'>;
  /** Where the driver child runs (`DriverPlace`). */
  readonly place: DriverPlace;
  readonly build: string;
  /** The part of the cases this capture runs (`shared/deliveryResult.ts#deliveryParts`; the capture owner's call 1148). */
  readonly part: number;
  readonly driver: DeliveryDriver;
  /** `CaptureTimings.deliverySettleMs`: how long, after the send, the case's turn may take to end. */
  readonly settleMs: number;
  /** `CaptureTimings.deliveryQuietMs`: how long the window stays open after the turn ended or the settle bound passed. */
  readonly quietMs: number;
  /** The test box's release tag the result carries, or null when it is not known. */
  readonly release: string | null;
  /** What the part could not measure (decided once by the runner from its dependencies), carried into the result. */
  readonly unmeasured: readonly DeliveryUnmeasured[];
  readonly stepTimeoutMs: number;
  readonly exitTimeoutMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** The drive's answer: the result, or none and why. */
export interface DeliveryDriveRun { readonly delivery: DeliveryCaptureResult | null; readonly detail: string | null }

const noVerdict = (detail: string): DeliveryDriveRun => ({ delivery: null, detail });

/** One step of the build-trust drive (its text typed, then its events awaited from `before`); `false` when it did not
 *  finish within the step bound. */
async function step(c: DeliveryDriveContext, s: CaptureStep): Promise<boolean> {
  const before = c.records().length;
  if (s.type !== null) await c.launched.type(s.type);
  const deadline = c.now() + c.stepTimeoutMs;
  for (;;) {
    const hooks = c.records().slice(before).flatMap((r) => (r.kind === 'hook' ? [r.event] : []));
    if (stepDone(s, hooks)) return true;
    if (c.now() >= deadline) return false;
    await c.sleep(c.pollMs);
  }
}

/** The whole delivery drive. Never throws for the build's sake; a throw is the runner's to answer. */
export async function runDeliveryDrive(c: DeliveryDriveContext): Promise<DeliveryDriveRun> {
  const cases = deliveryParts()[c.part];
  if (cases === undefined) return noVerdict(`part ${c.part} is not a part of this box's recipe`);
  for (const s of DELIVERY_STEPS_BEFORE) {
    try {
      if (!await step(c, s)) return noVerdict(`the build did not finish the step before the cases (${s.type ?? 'start'}) within ${c.stepTimeoutMs} ms: a fault of the box, not a verdict`);
    } catch (e) {
      return noVerdict(`the launcher could not type the step before the cases: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const results: DeliveryCaseResult[] = [];
  for (const [at, id] of cases.entries()) {
    const life = await c.life();
    if (life !== 'alive') return noVerdict(`the build is ${life === 'gone' ? 'gone' : 'of unknown life'} before case ${id}: a fault of the box, not a verdict`);
    const reqAt = c.requests.length;
    const othersAt = c.others?.length ?? 0;
    const recAt = c.records().length;
    const answer = await c.driver.drive({ ...c.input, case: id }, c.place);
    if (answer.kind === 'fault') return noVerdict(`case ${id}: ${answer.detail}: a fault of the box, not a verdict`);
    // The turn's end, if one began: a send that answered ok, or anything that reached the stand-in.
    if (answer.send === 'ok' || c.requests.length > reqAt) {
      const settle = c.now() + c.settleMs;
      while (!turnEnded(c.records().slice(recAt)) && c.now() < settle) await c.sleep(c.pollMs);
    }
    // The quiet period: a late second submit still falls in this case's window.
    const quiet = c.now() + c.quietMs;
    while (c.now() < quiet) await c.sleep(c.pollMs);
    // The trailing window: after the part's LAST case no case follows to take a late request into its window, so this one
    // stays open one more settle, and a request that comes after its quiet period is still judged against it.
    if (at === cases.length - 1) {
      const trailing = c.now() + c.settleMs;
      while (c.now() < trailing) await c.sleep(c.pollMs);
    }
    const observed = observeWindow(answer.send, c.requests.slice(reqAt), c.routes.slice(reqAt, c.requests.length), c.records().slice(recAt), Math.max(0, (c.others?.length ?? 0) - othersAt));
    if (observed === null) return noVerdict(`case ${id}: a request of its window has no route: a fault of the box, not a verdict`);
    results.push(deliveryCaseResult(id, observed));
  }
  // A build gone after the last case's window ended this part early too: its last window cannot be trusted.
  const after = await c.life();
  if (after !== 'alive') return noVerdict(`the build is ${after === 'gone' ? 'gone' : 'of unknown life'} after the last case: a fault of the box, not a verdict`);
  // The result is measured; the build is asked to exit, and the runner's teardown stops it whatever it does.
  try { await step(c, DELIVERY_STEP_AFTER); } catch { /* the teardown stops the build */ }
  const deadline = c.now() + c.exitTimeoutMs;
  while (await c.life() === 'alive' && c.now() < deadline) await c.sleep(c.pollMs);
  return { delivery: deliveryCaptureResult(c.build, c.part, results, c.release, c.unmeasured), detail: null };
}
