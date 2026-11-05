// The reader lab's run (native Docs reader, the reader lab plan of 2026-11-03, Task 9; the reader lab design, sections 3
// and 4). Ring L4: it opens a door run, mounts each lab frame and each timed reader in turn into the page's stage, waits,
// reads the door's counts, and answers the result; the decisions are `verdicts.ts`'s. Every frame and mount a step starts
// is removed when the step ends, however it ends, and the door run is closed when the run ends, however it ends. Every
// arrival that decides a verdict is read by step 7, before the Mermaid mounts, so a final read that finds the run gone
// keeps the last view instead of losing the run. It waits by the lab's own caps (`shared/readerLab.ts`), from which the
// door derives a run's life. The only requests it makes or causes go to this console's own door. `defaultLabDeps` builds
// the real dependencies; the page hands it its stage and its abort signal.
import { DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE } from '../../../shared/docs';
import {
  LAB_BUSY_SPIN_MS, LAB_DRAW_SETTLE_MS, LAB_MOUNT_WAIT_MS, LAB_SETTLE_MS, LAB_STEPS, LAB_TAP_WAIT_MS, isLabNonce,
  readerLabProbeBase, type LabRunView,
} from '../../../shared/readerLab';
import { lazyMountReader } from '../docs/ReaderFrame';
import { READER_LIBRARY_BUILD } from '../docs/reader/labPolicy';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiError';
import { longestFrameGap } from '../lib/frameGap';
import { utf8ByteLength } from '../lib/markdownGuard';
import { DOCS_PARSE_BUDGET_MS } from '../lib/markdownLimits';
import { docsRunner } from '../lib/markdownRunner';
import type { ReaderRenderOutcome } from '../lib/readerRenderJob';
import { isRecord } from '../lib/wire';
import type { LabCheckId, LabOutcome } from './checks';
import type { LabDevice } from './device';
import { LAB_PAGES, hostileDoc } from './fixtures';
import {
  AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, COOKIE_SCRIPT, POPUP_SCRIPT, SELF_NAV_SCRIPT, STRAYS_SCRIPT,
} from './frameScripts';
import { mountLabFrame, type LabFrame, type LabFrameSpec } from './frames';
import { LAB_TEXT } from './labText';
import { formatLabResult, type LabFinalRead } from './result';
import { labVerdicts, type LabLocal, type LabMount } from './verdicts';
import { readLabRunView } from './wire';

// The reader's types come through the loader's own signature, so this file names the bridge nowhere (the docs scan's
// rule: the adapters are reached only through ReaderFrame).
type ReaderMountInput = Parameters<typeof lazyMountReader>[1];
type ReaderMount = Awaited<ReturnType<typeof lazyMountReader>>;

/** The timer whose lateness stands for the reader's watchdog while the busy frame spins. */
export const LAB_WATCHDOG_PROBE_MS = 500;
/** How often the popup step reads the door while it waits for the operator's tap (`LAB_TAP_WAIT_MS`). */
export const LAB_TAP_READ_EVERY_MS = 1000;
/** The stall the Mermaid line is held to (question Q2). The busy frame is a fact and has no budget. */
export const LAB_STALL_BUDGET_MS = 200;

/** Where a timed mount's frame-gap window ends (the reader lab design, section 8). `ready`: at the mount's outcome, which
 *  holds the draw while the library's `ready` waits for its figures (library 1.0.0). `ready-and-settle`: LAB_DRAW_SETTLE_MS
 *  past `ready`, for a library that draws after `ready`, so the draw stays inside the window. The hostile mount stays live
 *  for LAB_SETTLE_MS under `ready`, or LAB_DRAW_SETTLE_MS under `ready-and-settle`, to observe its requests. */
export type LabGapWindow = 'ready' | 'ready-and-settle';
/** The window for the library this build pins. The library change that draws after `ready` flips it, in that change. */
export const LAB_GAP_WINDOW: LabGapWindow = 'ready';

/** The end of a timed mount's gap window: its outcome, or a settle past a `ready` outcome. */
export function gapWindowEnd(w: LabGapWindow, settled: Promise<LabMount['outcome']>, sleep: (ms: number) => Promise<void>): Promise<unknown> {
  return w === 'ready' ? settled : settled.then((o) => (o === 'ready' ? sleep(LAB_DRAW_SETTLE_MS) : undefined));
}

/** The door as the run sees it: a word for every server answer; a rejection only for a defect or a lost connection. */
export interface LabDoor {
  open(): Promise<{ readonly nonce: string } | 'no-door' | 'refused'>;
  read(nonce: string): Promise<LabRunView | 'unknown-run' | 'unreadable'>;
  close(nonce: string): Promise<void>;
  /** The console's own request to the probe, with its session: the cookie check's control. */
  probe(nonce: string): Promise<void>;
}

export interface LabDeps {
  readonly door: LabDoor;
  /** The console's own origin. */
  readonly origin: string;
  /** Where frames and mounts go: laid out and visible. */
  readonly stage: HTMLElement;
  readonly mountFrame: (stage: HTMLElement, spec: LabFrameSpec) => LabFrame;
  readonly render: (src: string, o: { budgetMs: number; signal?: AbortSignal }) => Promise<ReaderRenderOutcome>;
  readonly mountReader: (el: HTMLElement, input: ReaderMountInput) => Promise<ReaderMount>;
  /** The next animation frame's time. */
  readonly frame: () => Promise<number>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** The console's address, read before and after the stray messages. */
  readonly address: () => string;
  /** Where each timed mount's gap window ends (`LAB_GAP_WINDOW` in the real dependencies). */
  readonly gapWindow: LabGapWindow;
  readonly signal: AbortSignal;
}

/** Where the run is, for the page. `outcomes` holds every check's outcome on the counts so far; the page shows a check's
 *  only once the step that decides it has passed (`checks.ts#LAB_CHECK_STEP`). */
export interface LabProgress {
  readonly step: number;
  readonly of: number;
  readonly line: string;
  readonly tap: boolean;
  readonly outcomes: Readonly<Partial<Record<LabCheckId, LabOutcome>>>;
}

export interface LabResult {
  readonly outcomes: Readonly<Record<LabCheckId, LabOutcome>>;
  readonly local: LabLocal;
  /** The last view of the door that was read; null: no read of the door happened. */
  readonly run: LabRunView | null;
  /** How the final read went: a run gone by then keeps the view step 7 read, which holds every verdict's counts. */
  readonly finalRead: LabFinalRead;
}

/** A word the run stops with, which the page says in one sentence. */
export type LabFailureWord = 'no-door' | 'refused' | 'unknown-run' | 'unreadable';
export class LabFailure extends Error {
  readonly word: LabFailureWord;
  constructor(word: LabFailureWord) {
    super(word);
    this.word = word;
  }
}

const noop = (): void => undefined;

/** A timed mount's input: the lab profile, no doc key, no images. */
function mountInput(out: Extract<ReaderRenderOutcome, { kind: 'rendered' }>, bytes: number, cb: {
  readonly onReady: () => void; readonly onFallback: () => void;
  readonly onLink?: () => void; readonly onHash?: () => void; readonly copy?: () => void;
}): ReaderMountInput {
  return {
    document: { result: out.result, scan: { mermaid: out.mermaid }, images: {}, initialHash: null },
    bytes, docKey: null, title: 'reader-lab.md', prefs: { theme: 'auto' }, profile: 'lab-draw',
    onLink: cb.onLink ?? noop, onHash: cb.onHash ?? noop, copy: cb.copy ?? noop, onReady: cb.onReady, onFallback: cb.onFallback,
  };
}

/** A host element for one mount, at the end of the stage, scrolled into view before the mount starts. The mount is a
 *  frame of an opaque origin, and Chrome throttles a cross-origin frame that is off screen: no animation frame runs in
 *  it, so the library's draw never starts and `ready`, which waits for the figures under `lab-draw`, never comes before
 *  the watchdog. The stage sits below the lists, and the rows' details push it down as the run goes. The limit: this is
 *  one scroll before the mount, not a hold. If the operator scrolls the stage away mid-mount, that mount reads "not
 *  measured" (a fallback or the cap), never a false "holds". */
function hostIn(stage: HTMLElement): HTMLElement {
  const host = document.createElement('div');
  host.className = 'reader-lab-mount';
  stage.append(host);
  host.scrollIntoView({ block: 'nearest' });
  return host;
}

/** One page mounted under the lab profile, timed from the mount's start to ready, fallback, the cap or a stop. */
async function timedMount(deps: LabDeps, label: string, text: string): Promise<LabMount> {
  const bytes = utf8ByteLength(text);
  const out = await deps.render(text, { budgetMs: DOCS_PARSE_BUDGET_MS(bytes), signal: deps.signal });
  if (out.kind !== 'rendered') return { label, outcome: 'not-rendered', longestGapMs: 0, elapsedMs: 0 };
  const host = hostIn(deps.stage);
  let settle: (o: LabMount['outcome']) => void = noop;
  const settled = new Promise<LabMount['outcome']>((resolve) => { settle = resolve; });
  const onAbort = (): void => settle('timeout');
  deps.signal.addEventListener('abort', onAbort, { once: true });
  void deps.sleep(LAB_MOUNT_WAIT_MS).then(() => settle('timeout'));
  const gap = longestFrameGap(deps.frame, gapWindowEnd(deps.gapWindow, settled, deps.sleep));
  const t0 = deps.now();
  let mount: ReaderMount | null = null;
  try {
    try {
      mount = await deps.mountReader(host, mountInput(out, bytes, { onReady: () => settle('ready'), onFallback: () => settle('fallback') }));
    } catch {
      settle('fallback');
    }
    const outcome = await settled;
    const elapsedMs = deps.now() - t0;
    return { label, outcome, longestGapMs: await gap, elapsedMs };
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
    mount?.destroy();
    host.remove();
  }
}

/** One page mounted under the lab profile for step 7, with no timing: `true` once it is ready (after `whileReady` has run
 *  while it is up), `false` for a fallback or throw before ready, the cap or a stop. `onFallback` hears every fallback with
 *  whether ready had come, and `effect` is every host callback the page's messages can reach. The mount and its host are
 *  gone when this returns. */
async function readyMount(deps: LabDeps, text: string, on: {
  readonly onFallback: (afterReady: boolean) => void; readonly effect: () => void;
}, whileReady: () => Promise<void>): Promise<boolean> {
  const bytes = utf8ByteLength(text);
  const out = await deps.render(text, { budgetMs: DOCS_PARSE_BUDGET_MS(bytes), signal: deps.signal });
  if (out.kind !== 'rendered') return false;
  const host = hostIn(deps.stage);
  let ready = false;
  let settle: (r: boolean) => void = noop;
  const settled = new Promise<boolean>((resolve) => { settle = resolve; });
  const onAbort = (): void => settle(false);
  deps.signal.addEventListener('abort', onAbort, { once: true });
  void deps.sleep(LAB_MOUNT_WAIT_MS).then(() => settle(false));
  let mount: ReaderMount | null = null;
  try {
    try {
      mount = await deps.mountReader(host, mountInput(out, bytes, {
        onReady: () => { ready = true; settle(true); },
        onFallback: () => { on.onFallback(ready); settle(false); },
        onLink: on.effect, onHash: on.effect, copy: on.effect,
      }));
    } catch {
      return false;
    }
    if (!(await settled)) return false;
    await whileReady();
    return true;
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
    mount?.destroy();
    host.remove();
  }
}

/** Step 7, one mount at a time. First the hostile page under the lab profile: `csp-27` needs it ready, and a fallback after
 *  ready is the library failing closed on a figure the wall refused, never an effect of a stray message. Then a benign
 *  page (the step-8 "none" page, the same lab profile and caps), where `bridge-strays` is measured: while it is up and
 *  ready the stray frame posts its messages, and any host callback they reach, a fallback after ready, or a change of the
 *  console's address is an effect. Last, the step's one read of the door. */
async function hostileAndStrays(deps: LabDeps, base: string, read: () => Promise<void>): Promise<{
  readonly hostile: NonNullable<LabLocal['hostile']>; readonly strays: NonNullable<LabLocal['strays']>;
}> {
  const hostile = { ready: await readyMount(deps, hostileDoc(base), { onFallback: noop, effect: noop }, () => deps.sleep(deps.gapWindow === 'ready' ? LAB_SETTLE_MS : LAB_DRAW_SETTLE_MS)) };
  const benign = LAB_PAGES.find((p) => p.label === 'none');
  let effects = 0;
  let addressChanged = false;
  let readDone = false;
  const effect = (): void => { effects += 1; };
  const ready = benign !== undefined && await readyMount(deps, benign.text, {
    onFallback: (afterReady) => { if (afterReady) effects += 1; }, effect,
  }, async () => {
    const before = deps.address();
    const frame = deps.mountFrame(deps.stage, { script: STRAYS_SCRIPT, config: { base } });
    try {
      await deps.sleep(LAB_SETTLE_MS);
    } finally {
      frame.remove();
    }
    readDone = true;
    await read();
    addressChanged = deps.address() !== before;
  });
  if (!readDone) await read();
  return { hostile, strays: { ready, effects, addressChanged } };
}

/** The run: nine steps, then the verdicts. Rejects with a LabFailure for the door's words up to step 7, and with `stopped`
 *  on an abort. */
export async function runReaderLab(deps: LabDeps, progress: (p: LabProgress) => void): Promise<LabResult> {
  const stop = (): void => {
    if (deps.signal.aborted) throw new Error('stopped');
  };
  const opened = await deps.door.open();
  if (opened === 'no-door' || opened === 'refused') throw new LabFailure(opened);
  const nonce = opened.nonce;
  const base = `${deps.origin}${readerLabProbeBase(nonce)}`;
  const counts: { view: LabRunView | null } = { view: null };
  const local: { selfNavLoads: number | null; busy: LabLocal['busy']; mounts: LabMount[]; hostile: LabLocal['hostile']; strays: LabLocal['strays'] } =
    { selfNavLoads: null, busy: null, mounts: [], hostile: null, strays: null };
  let step = 0;
  const say = (line: string, tap = false): void => {
    progress({ step, of: LAB_STEPS, line, tap, outcomes: counts.view === null ? {} : labVerdicts(counts.view, local, LAB_STALL_BUDGET_MS) });
  };
  const read = async (): Promise<void> => {
    const r = await deps.door.read(nonce);
    if (r === 'unknown-run' || r === 'unreadable') throw new LabFailure(r);
    counts.view = r;
  };
  /** One frame for one step: mounted, given `ms` after `during`, read, and removed however the step ends. */
  const withFrame = async (spec: LabFrameSpec, ms: number, during?: () => Promise<void>): Promise<LabFrame> => {
    stop();
    const f = deps.mountFrame(deps.stage, spec);
    try {
      if (during !== undefined) await during();
      await deps.sleep(ms);
      stop();
      await read();
      return f;
    } finally {
      f.remove();
    }
  };
  try {
    // An older door fails here, before any frame (refinement (s)).
    await read();
    // 1. Popups and top navigation, after the operator's tap (refinements (m), (t)).
    step = 1;
    say(LAB_TEXT.steps.popup, true);
    await withFrame({ script: POPUP_SCRIPT, config: { base, label: LAB_TEXT.tapLabel } }, LAB_SETTLE_MS, async () => {
      const until = deps.now() + LAB_TAP_WAIT_MS;
      while (deps.now() < until) {
        stop();
        await deps.sleep(LAB_TAP_READ_EVERY_MS);
        await read();
        if ((counts.view?.probes['popup-ran'].hits ?? 0) > 0) return;
      }
    });
    // 2. The opaque origin and ambient state.
    step = 2;
    say(LAB_TEXT.steps.ambient);
    await withFrame({ script: AMBIENT_SCRIPT, config: { base } }, LAB_SETTLE_MS);
    // 3. No cookie on frame requests; the console's own request first, as the control.
    step = 3;
    say(LAB_TEXT.steps.cookie);
    stop();
    await deps.door.probe(nonce);
    await withFrame({ script: COOKIE_SCRIPT, config: { base, marker: DOCS_REQUEST_HEADER, markerValue: DOCS_REQUEST_HEADER_VALUE } }, LAB_SETTLE_MS);
    // 4. The battery: the control frame with no policy, then the wall frame under the library's.
    step = 4;
    say(LAB_TEXT.steps.battery);
    await withFrame({ script: BATTERY_SCRIPT, config: { base, prefix: 'ctl-', canary: false }, importChannel: true }, LAB_SETTLE_MS);
    await withFrame({ script: BATTERY_SCRIPT, config: { base, prefix: 'csp-', canary: true }, importChannel: true, wall: { canary: `${base}csp-canary` } }, LAB_SETTLE_MS);
    // 5. A frame navigating itself.
    step = 5;
    say(LAB_TEXT.steps.selfNav);
    local.selfNavLoads = (await withFrame({ script: SELF_NAV_SCRIPT, config: { base } }, LAB_SETTLE_MS)).loads();
    // 6. A busy frame: the frame gaps and a timer, both started before it mounts.
    step = 6;
    say(LAB_TEXT.steps.busy);
    const spinOver = deps.sleep(LAB_BUSY_SPIN_MS + LAB_SETTLE_MS);
    const gap = longestFrameGap(deps.frame, spinOver);
    const t0 = deps.now();
    const late = deps.sleep(LAB_WATCHDOG_PROBE_MS).then(() => Math.max(0, deps.now() - t0 - LAB_WATCHDOG_PROBE_MS));
    await withFrame({ script: BUSY_SCRIPT, config: { base, spinMs: LAB_BUSY_SPIN_MS } }, 0, () => spinOver);
    local.busy = { longestGapMs: await gap, timerLateMs: await late, spinMs: LAB_BUSY_SPIN_MS };
    // 7. The real library on hostile figures, then on a benign page with stray messages sent while it is up: the last step
    // whose arrivals decide a verdict, so its read is the last one that must succeed (the reader lab design, section 4.4).
    step = 7;
    stop();
    say(LAB_TEXT.steps.strays);
    ({ hostile: local.hostile, strays: local.strays } = await hostileAndStrays(deps, base, read));
    // 8. Mermaid drawn on open, one page at a time. Nothing here sends a probe.
    step = 8;
    for (const page of LAB_PAGES) {
      stop();
      say(`${LAB_TEXT.steps.mermaid} ${page.label}`);
      local.mounts.push(await timedMount(deps, page.label, page.text));
    }
    // 9. The final counts, for a late arrival. A run that is gone by now (its life spent on a slow phone's mounts, or a
    // restart) keeps the view step 7 read, and the result says so.
    step = 9;
    stop();
    say(LAB_TEXT.steps.done);
    const last = await deps.door.read(nonce).catch(() => { stop(); return 'unreadable' as const; });
    stop();
    if (last !== 'unknown-run' && last !== 'unreadable') counts.view = last;
    const finalRead: LabFinalRead = typeof last === 'string' ? last : 'read';
    return { outcomes: labVerdicts(counts.view, local, LAB_STALL_BUDGET_MS), local, run: counts.view, finalRead };
  } finally {
    await deps.door.close(nonce).catch(noop);
  }
}

/** The door through the funnel. */
const apiDoor: LabDoor = {
  async open() {
    try {
      const a = await api.readerLab.open();
      return isRecord(a) && a['ok'] === true && typeof a['nonce'] === 'string' && isLabNonce(a['nonce']) ? { nonce: a['nonce'] } : 'refused';
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return 'no-door';
      if (e instanceof ApiError) return 'refused';
      throw e;
    }
  },
  async read(nonce) {
    try {
      return readLabRunView(await api.readerLab.read(nonce)) ?? 'unreadable';
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return 'unknown-run';
      throw e;
    }
  },
  close: (nonce) => api.readerLab.close(nonce),
  probe: (nonce) => api.readerLab.probe(nonce),
};

/** A wall frame's script nonce: sixteen random bytes as base64. */
function scriptNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/=+$/, '');
}

/** The real dependencies. */
export function defaultLabDeps(p: { readonly stage: HTMLElement; readonly signal: AbortSignal }): LabDeps {
  return {
    door: apiDoor,
    origin: location.origin,
    stage: p.stage,
    mountFrame: (stage, spec) => mountLabFrame(stage, spec, scriptNonce),
    render: (src, o) => docsRunner.render(src, o),
    mountReader: lazyMountReader,
    frame: () => new Promise((resolve) => { requestAnimationFrame(resolve); }),
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); }),
    address: () => location.href,
    gapWindow: LAB_GAP_WINDOW,
    signal: p.signal,
  };
}

/** The result block for this run on this device, with the library build it ran against. */
export function labResultText(r: LabResult, device: LabDevice): string {
  return formatLabResult(device, READER_LIBRARY_BUILD, r.outcomes, r.local, r.run, LAB_STALL_BUDGET_MS, r.finalRead);
}
