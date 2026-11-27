// The box frames recipe's drive (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md,
// sections 3, 4 and 5.2). L4: it acts on what `captureFrames.ts` decides, `shared/framesCapture.ts` lists and
// `shared/framesReduce.ts` reduces, inside one capture the runner (`captureRunner.ts`) has set up and will tear down. The
// build is started; this drive runs the build-trust drive's start and model-switch steps (the delivery recipe's same
// objects), then each of the part's steps through the driver child (`server/src/inject/deliveryDrive.ts`'s frames form),
// reads the ONE frame, REDUCES IT HERE, on the test box, and lets the raw frame go, then ends with `/exit`.
//
// A FAULT OF THE BOX IS NEVER A RESULT (the delivery recipe's cut, carried over): a step before the case that does not
// finish, a driver that does not answer or refuses its input, a typing step tmux refused, a screen that could not be read,
// and a build gone or of unknown life during the case each answer no result and a detail, so the lane tries again.
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { DELIVERY_COUNT_MAX, DELIVERY_SEND_WORD, type DeliveryRoute, type DeliveryUnmeasured } from '../../../shared/deliveryResult.js';
import { deliveryTurnOf } from '../../../shared/deliveryCapture.js';
import { UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import type { CaptureRecord } from '../../../shared/claudeBuildCapture.js';
import { hookEventIs } from '../../../shared/hook-events.js';
import { FRAMES_RECIPE_VERSION, framesDriveSteps, framesOurs, framesStepWord, type FramesDriveStep } from '../../../shared/framesCapture.js';
import { reduceFrame, type FramesScan } from '../../../shared/framesReduce.js';
import {
  FRAMES_PARTS, frameOverCap, frameSize, framesWord, type FramesCaptureResult, type FramesFrame, type FramesSend, type FramesSendStep,
} from '../../../shared/framesResult.js';
import { boundedStdinSpawn } from '../../../shared/spawn.mjs';
import { stepDone, type CaptureStep } from './capture.js';
import { DELIVERY_STEPS_BEFORE, DELIVERY_STEP_AFTER, turnEnded } from './captureDelivery.js';
import { DRIVER_BOX_FAULT_SENDS, type DriverPlace } from './captureDeliveryRun.js';
import type { BuildLife, LaunchedBuild } from './captureRunner.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── the driver's answer ──────────────────────────────────────────────────────────────────────────────────────────

/** One frames step's answer, as the runner reads it from the driver child: the send's word, a typing step's answer, the
 *  screen (the RAW frame, which the runner reduces at once and lets go), or a fault of the box. */
export type FramesDriverAnswer =
  | { readonly kind: 'sent'; readonly send: string }
  | { readonly kind: 'typed'; readonly typed: boolean }
  | { readonly kind: 'frame'; readonly frame: string | null; readonly cursor: readonly [number, number] | null; readonly settled: boolean; readonly overCap?: boolean }
  | { readonly kind: 'fault'; readonly detail: string };

const isCursor = (v: unknown): v is readonly [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);

/** THE reader of the frames driver child's answer, from its exit status and its one stdout line (the driver's
 *  `framesDriveAnswer`): exit 0 with exactly one answer's keys, or a fault of the box. A send word the delivery recipe
 *  reads as a box fault (`not-alive`) is one here too. */
export function readFramesDriverAnswer(code: number, stdout: string): FramesDriverAnswer {
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'fault', detail: `the driver exited ${code} with no answer` }; }
  const o = isObj(v) ? v : {};
  const keys = Object.keys(o).sort().join();
  if (code === 0 && keys === 'send' && typeof o['send'] === 'string' && DELIVERY_SEND_WORD.test(o['send']) && !DRIVER_BOX_FAULT_SENDS.includes(o['send'])) return { kind: 'sent', send: o['send'] };
  if (code === 0 && keys === 'typed' && typeof o['typed'] === 'boolean') return { kind: 'typed', typed: o['typed'] };
  if (code === 0 && keys === 'cursor,frame,settled' && (o['frame'] === null || typeof o['frame'] === 'string')
    && (o['cursor'] === null || isCursor(o['cursor'])) && typeof o['settled'] === 'boolean') {
    return { kind: 'frame', frame: o['frame'] as string | null, cursor: o['cursor'] as readonly [number, number] | null, settled: o['settled'] };
  }
  if (code === 3 && typeof o['fault'] === 'string' && typeof o['detail'] === 'string') {
    return { kind: 'fault', detail: `the driver exited 3: a fault of the box (${o['fault'].slice(0, 40)}): ${o['detail'].slice(0, 120)}` };
  }
  const word = typeof o['refused'] === 'string' ? `refused ${o['refused']}` : typeof o['send'] === 'string' ? o['send'] : 'an answer off its shape';
  return { kind: 'fault', detail: `the driver exited ${code}: ${String(word).slice(0, 80)}` };
}

/** The driver child's stdout cap for a frame step: a frame of `FRAME_BYTES_MAX` bytes, each escape JSON-spelled at six
 *  bytes, with room. Past it the child is killed and the frame is recorded over the cap (with this as its byte count). */
export const FRAMES_FRAME_OUTPUT_MAX = 512 * 1024;
/** The cap for every other step: one short JSON line. */
export const FRAMES_STEP_OUTPUT_MAX = 4096;


/** Runs the driver for one step. Never throws. */
export interface FramesDriver { step(word: string, input: { readonly capture: string; readonly tmux: string }, place: DriverPlace, person: boolean, frame: boolean): Promise<FramesDriverAnswer> }

/** The production driver: `node <script>` as its own process group, the input as JSON on stdin, the environment built from
 *  empty (`PATH`, `TMPDIR` and `LANG` only), within its bound (the person's for a `person` step), then SIGTERM, SIGKILL
 *  `graceMs` later and one drain. A frame step's output may be a frame; every other step's is one short line. */
export function nodeFramesDriver(node: string, script: string, boundMs: number, personBoundMs: number, graceMs: number): FramesDriver {
  return {
    async step(word, input, place, person, frame) {
      const stdin = Buffer.from(JSON.stringify({ capture: input.capture, tmux: input.tmux, frames: word }));
      const bound = person ? personBoundMs : boundMs;
      const max = frame ? FRAMES_FRAME_OUTPUT_MAX : FRAMES_STEP_OUTPUT_MAX;
      const r = await boundedStdinSpawn({ spawn, signals: osConstants.signals }, node, [script], stdin, {
        env: { PATH: place.path, TMPDIR: place.tmpBase, LANG: 'C.UTF-8' }, timeoutMs: bound, killGraceMs: graceMs, maxOutputBytes: max, drainMs: UPDATE_SPAWN_DRAIN_MS,
      });
      if (r.kind === 'exited') return readFramesDriverAnswer(r.code, r.stdout);
      // A frame that would not fit its pipe passed the cap: recorded over it, never cut (the runner reads this word).
      if (r.kind === 'too-large' && frame) return { kind: 'frame', frame: null, cursor: null, settled: false, overCap: true };
      return { kind: 'fault', detail: r.kind === 'timeout' ? `the driver did not answer within ${bound} ms` : r.kind === 'too-large' ? 'the driver said too much' : 'the driver could not start' };
    },
  };
}

/** What the drive acts on: the started build, what the stand-in has received, the recording so far, and the bounds. */
export interface FramesDriveContext {
  readonly launched: LaunchedBuild;
  readonly life: () => Promise<BuildLife>;
  readonly requests: readonly unknown[];
  readonly routes: readonly DeliveryRoute[];
  readonly others?: readonly number[];
  readonly records: () => readonly CaptureRecord[];
  readonly input: { readonly capture: string; readonly tmux: string };
  readonly place: DriverPlace;
  readonly build: string;
  readonly part: number;
  readonly driver: FramesDriver;
  readonly settleMs: number;
  readonly quietMs: number;
  readonly release: string | null;
  readonly unmeasured: readonly DeliveryUnmeasured[];
  /** The exact strings this capture knows (its home, user, host and directories, the stand-in's address): the reducer's. */
  readonly privates: readonly string[];
  /** The committed private-name matcher (`shared/framesScan.mjs#framesScan`), composed by the caller. */
  readonly scan: FramesScan;
  /** Releases the stand-in's held turn (`queued`): after the frame, and always before `/exit`. */
  readonly releaseHold: () => void;
  readonly stepTimeoutMs: number;
  readonly exitTimeoutMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** The drive's answer: the result, or none and why. */
export interface FramesDriveRun { readonly frames: FramesCaptureResult | null; readonly detail: string | null }

const noResult = (detail: string): FramesDriveRun => ({ frames: null, detail });
const capped = (n: number): number => Math.min(n, DELIVERY_COUNT_MAX);

async function stepBefore(c: FramesDriveContext, s: CaptureStep): Promise<boolean> {
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

/** Waits until `done` reads the records since `recAt`, or `ms` passes. */
async function waitFor(c: FramesDriveContext, recAt: number, ms: number, done: (rs: readonly CaptureRecord[]) => boolean): Promise<void> {
  const until = c.now() + ms;
  while (!done(c.records().slice(recAt)) && c.now() < until) await c.sleep(c.pollMs);
}

const prompted = (rs: readonly CaptureRecord[]): boolean => rs.some((r) => r.kind === 'hook' && hookEventIs(r.event, 'UserPromptSubmit'));

const SEND_STEP: Partial<Record<FramesDriveStep['kind'], FramesSendStep>> = { send: 'send', queued: 'send', held: 'held' };

/** The frame as the result carries it, from the raw screen: measured, then the cap (never cut), then the reducer. The raw
 *  text is not kept past this call. */
export function framesFrameOf(
  raw: string | null, overCap: boolean, cursor: readonly [number, number] | null, settled: boolean, part: number, privates: readonly string[], scan: FramesScan,
): FramesFrame {
  const p = FRAMES_PARTS[part]!;
  const cur = cursor !== null && cursor[0] < p.pane.cols && cursor[1] < p.pane.rows ? cursor : null;
  if (raw === null || overCap) return { outcome: 'over-cap', refusal: null, rows: 0, width: 0, bytes: FRAMES_FRAME_OUTPUT_MAX, cursor: cur, replaced: null, text: null };
  const size = frameSize(raw);
  const m = { rows: capped(size.rows), width: capped(size.width), bytes: capped(size.bytes) };
  if (frameOverCap(size, p.pane)) return { outcome: 'over-cap', refusal: null, ...m, cursor: cur, replaced: null, text: null };
  const r = reduceFrame(raw, p.pane, framesOurs(p.case, p.pane), privates, scan);
  if (r.kind === 'refused') return { outcome: 'refused', refusal: r.refusal, ...m, cursor: cur, replaced: null, text: null };
  return { outcome: settled ? 'drawn' : 'unsettled', refusal: null, ...m, cursor: cur, replaced: r.replaced, text: r.text };
}

/** The whole frames drive. Never throws for the build's sake; a throw is the runner's to answer. */
export async function runFramesDrive(c: FramesDriveContext): Promise<FramesDriveRun> {
  const p = FRAMES_PARTS[c.part];
  if (p === undefined) return noResult(`part ${c.part} is not a part of this box's frames recipe`);
  for (const s of DELIVERY_STEPS_BEFORE) {
    try {
      if (!await stepBefore(c, s)) return noResult(`the build did not finish the step before the case (${s.type ?? 'start'}) within ${c.stepTimeoutMs} ms: a fault of the box, not a result`);
    } catch (e) {
      return noResult(`the launcher could not type the step before the case: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const reqAt = c.requests.length;
  const othersAt = c.others?.length ?? 0;
  const sends: FramesSend[] = [];
  let frame: FramesFrame | null = null;
  try {
    for (const ds of framesDriveSteps(c.part)) {
      const life = await c.life();
      if (life !== 'alive') return noResult(`the build is ${life === 'gone' ? 'gone' : 'of unknown life'} before the ${ds.kind} step: a fault of the box, not a result`);
      const recAt = c.records().length;
      const a = await c.driver.step(framesStepWord(ds), c.input, c.place, ds.kind === 'person', ds.kind === 'frame');
      if (a.kind === 'fault') return noResult(`the ${ds.kind} step: ${a.detail}: a fault of the box, not a result`);
      if (ds.kind === 'frame') {
        if (a.kind !== 'frame') return noResult('the frame step answered off its shape: a fault of the box, not a result');
        if (a.frame === null && a.overCap !== true) return noResult('the screen could not be read: a fault of the box, not a result');
        frame = framesFrameOf(a.frame, a.overCap === true, a.cursor, a.settled, c.part, c.privates, c.scan);
        continue;
      }
      if (ds.kind === 'turn' || ds.kind === 'send' || ds.kind === 'queued' || ds.kind === 'held') {
        if (a.kind !== 'sent') return noResult(`the ${ds.kind} step answered off its shape: a fault of the box, not a result`);
        sends.push({ step: ds.kind === 'turn' ? (ds.which === 1 ? 'turn-1' : 'turn-2') : SEND_STEP[ds.kind]!, send: a.send });
        if (ds.kind === 'held') await waitFor(c, recAt, c.settleMs, prompted);
        else if (ds.kind !== 'queued') {
          await waitFor(c, recAt, c.settleMs, turnEnded);
          const quiet = c.now() + c.quietMs;
          while (c.now() < quiet) await c.sleep(c.pollMs);
        }
        continue;
      }
      if (a.kind !== 'typed') return noResult(`the ${ds.kind} step answered off its shape: a fault of the box, not a result`);
      if (!a.typed) return noResult(`tmux refused a key of the ${ds.kind} step: a fault of the box, not a result`);
    }
  } finally {
    c.releaseHold();
  }
  if (frame === null) return noResult('the case took no frame: a fault of the box, not a result');
  const after = await c.life();
  if (after !== 'alive') return noResult(`the build is ${after === 'gone' ? 'gone' : 'of unknown life'} after the frame: a fault of the box, not a result`);
  // The window: every request since the case's first step, a turn by the delivery recipe's one request rule.
  const reqs = c.requests.slice(reqAt);
  const turns = reqs.filter((r, i) => deliveryTurnOf(c.routes[reqAt + i]!, r) !== null).length;
  const side = reqs.length - turns + Math.max(0, (c.others?.length ?? 0) - othersAt);
  try { await stepBefore(c, DELIVERY_STEP_AFTER); } catch { /* the teardown stops the build */ }
  const deadline = c.now() + c.exitTimeoutMs;
  while (await c.life() === 'alive' && c.now() < deadline) await c.sleep(c.pollMs);
  return {
    frames: {
      recipe: 'frames', version: FRAMES_RECIPE_VERSION, build: c.build, part: c.part, case: p.case, pane: p.pane, release: c.release,
      unmeasured: c.unmeasured, word: framesWord(frame.outcome), sends, turns: capped(turns), sideRequests: capped(side), frame,
    },
    detail: null,
  };
}
