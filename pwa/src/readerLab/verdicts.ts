// The reader lab's verdicts (native Docs reader, the reader lab plan of 2026-11-03, Task 8, refinements (l) and (u); the
// reader lab design, section 3.2; the rich-docs spec's row M10.13). Ring L1: pure. Each line answers one of its three
// words and a short detail, from the door's counts for the run and what the page itself observed. "Not measured" never
// folds into "holds": a check holds only once its own positive signal is there (a frame's report, the control and its
// floor, the canary, the tap, a mount that reached ready, every figure mount present), and a wall's broken signals are read
// first, so a forged arrival cannot hide a real "broke" or a real arrival at a wall's target. (A forged POSITIVE signal can
// still turn "not measured" into "holds" for a frame that never ran: that defence is the nonce's secrecy, the design's
// section 4.6, not these rules.) A saturated run (the door stopped counting) keeps a counted "does not hold", which is
// already in the counts it took, and answers every other count line "not measured"; an unread run answers every count line
// "not measured"; so neither ever reads "holds". `bridge-strays`' broken arm is local (the reader's own callbacks), so it is
// read before the door's state. `busy-frame` is a fact that gates nothing; `self-nav-teardown` names an engine that differs
// from desktop Chromium without calling a wall broken.
import { LAB_BATTERY_CHANNELS, type LabBatteryChannel, type LabProbeName, type LabRunView } from '../../../shared/readerLab';
import type { LabCheckId, LabOutcome } from './checks';
import { LAB_STRAYS_POSTED } from './frameScripts';

/** One timed mount of the production reader under the lab profile. */
export interface LabMount {
  /** `none`, `trivial`, `f1` to `f6`, or `all`. */
  readonly label: string;
  readonly outcome: 'ready' | 'fallback' | 'timeout' | 'not-rendered' | 'mermaid-dropped';
  /** The longest gap between animation frames from the mount's start to its outcome. */
  readonly longestGapMs: number;
  /** Visibility invalidated the gap; the number is not a measurement. */
  readonly gapHidden?: boolean;
  /** From the mount's start to its outcome. */
  readonly elapsedMs: number;
}

/** What the page itself observed. Each `null` means that step did not run (the run stopped or failed before it). */
export interface LabLocal {
  /** The `load` events the self-navigating frame fired. */
  readonly selfNavLoads: number | null;
  readonly busy: { readonly longestGapMs: number; readonly timerLateMs: number; readonly spinMs: number; readonly gapHidden?: boolean } | null;
  /** The figure mounts, in run order; empty when that step did not run. */
  readonly mounts: readonly LabMount[];
  /** The hostile page's mount: whether it became ready (`csp-27`'s condition). A fallback after ready is the library
   *  failing closed on a figure the wall refused, and it is no effect of any stray message. */
  readonly hostile: { readonly ready: boolean; readonly mermaidDropped?: boolean } | null;
  /** The benign page's mount, which the stray messages are sent to: whether it became ready, and the host callbacks the
   *  stray messages reached (a fallback after ready counts as one here). */
  readonly strays: { readonly ready: boolean; readonly effects: number; readonly addressChanged: boolean } | null;
}

const ORIGIN_KEYS = ['parent', 'origin'] as const;
const STORE_KEYS = ['cookie', 'local', 'session', 'idb', 'caches'] as const;
type AmbientKey = (typeof ORIGIN_KEYS)[number] | (typeof STORE_KEYS)[number];
const COOKIE_CHANNELS = ['cookie-fetch', 'cookie-xhr', 'cookie-beacon', 'cookie-websocket', 'cookie-image'] as const;
const HOSTILE_TARGETS = ['hostile-img', 'hostile-click'] as const;
const POPUP_TARGETS = ['popup-open', 'popup-blank', 'top-nav'] as const;

/** The control frame's floor: the rich-docs spec's M8.B1 ("Without the meta, B is reached on at least 20/27"). Below it,
 *  too few channels are shown to leave a frame on this engine for "0 reached" in the wall frame to mean anything. */
export const LAB_CONTROL_FLOOR = 20;
/** Channels no lab frame can reach by design: a srcdoc frame inherits the console shell's `frame-src 'none'`, so its
 *  `iframe` channel never leaves. They are left out before the floor is compared, and named as not measured. */
const UNREACHABLE: readonly LabBatteryChannel[] = ['iframe'];

const holds = (detail = ''): LabOutcome => ({ verdict: 'holds', detail });
const broken = (detail: string): LabOutcome => ({ verdict: 'does-not-hold', detail });
const unmeasured = (detail: string): LabOutcome => ({ verdict: 'not-measured', detail });
const ms = (n: number): string => String(Math.round(n));
const hits = (r: LabRunView, n: LabProbeName): number => r.probes[n].hits;

/** A self-report: `broke` if any broke report arrived, else `held` if a held one did, else `missing`. */
function report(r: LabRunView, key: AmbientKey): 'held' | 'broke' | 'missing' {
  if (hits(r, `ambient-${key}-broke` as LabProbeName) > 0) return 'broke';
  return hits(r, `ambient-${key}-held` as LabProbeName) > 0 ? 'held' : 'missing';
}

function opaqueOrigin(r: LabRunView): LabOutcome {
  const sameOrigin = [...ORIGIN_KEYS, ...STORE_KEYS]
    .flatMap((k) => [`ambient-${k}-held`, `ambient-${k}-broke`] as LabProbeName[])
    .reduce((n, name) => n + r.probes[name].site['same-origin'], 0);
  const broke = ORIGIN_KEYS.filter((k) => report(r, k) === 'broke');
  if (broke.length > 0 || sameOrigin > 0) {
    return broken([
      ...broke.map((k) => (k === 'parent' ? 'the console page was readable' : "the frame's origin was not null")),
      ...(sameOrigin > 0 ? ['a report arrived as same-origin'] : []),
    ].join('; '));
  }
  const missing = ORIGIN_KEYS.filter((k) => report(r, k) === 'missing');
  return missing.length > 0 ? unmeasured(`no report: ${missing.join(', ')}`) : holds();
}

function ambientState(r: LabRunView): LabOutcome {
  const broke = STORE_KEYS.filter((k) => report(r, k) === 'broke');
  if (broke.length > 0) return broken(`reachable: ${broke.join(', ')}`);
  const missing = STORE_KEYS.filter((k) => report(r, k) === 'missing');
  return missing.length > 0 ? unmeasured(`no report: ${missing.join(', ')}`) : holds();
}

function noCookie(r: LabRunView): LabOutcome {
  const withCookie = COOKIE_CHANNELS.filter((n) => r.probes[n].cookie > 0);
  if (withCookie.length > 0) return broken(`the cookie rode: ${withCookie.join(', ')}`);
  if (hits(r, 'cookie-fetch-marker') > 0) return broken('a request that needs a preflight reached the server');
  const control = r.probes['cookie-console'];
  if (control.hits === 0) return unmeasured("the console's own request did not arrive");
  if (control.cookie === 0) return unmeasured('this console sent no session cookie (is the sign-in gate off?)');
  const arrived = COOKIE_CHANNELS.filter((n) => hits(r, n) > 0);
  if (arrived.length === 0) return unmeasured(hits(r, 'cookie-ran') > 0 ? 'no frame request arrived' : 'the frame did not run');
  return holds(`${arrived.length} arrived, 0 with the cookie; the control carried it`);
}

function csp27(r: LabRunView, local: LabLocal): LabOutcome {
  const reached = LAB_BATTERY_CHANNELS.filter((c) => hits(r, `csp-${c}`) > 0);
  const library = HOSTILE_TARGETS.filter((n) => hits(r, n) > 0);
  if (reached.length > 0 || library.length > 0) {
    return broken([
      ...(reached.length > 0 ? [`${reached.length} of 27 reached: ${reached.join(', ')}`] : []),
      ...(library.length > 0 ? [`the library reached ${library.join(', ')}`] : []),
    ].join('; '));
  }
  if (hits(r, 'csp-canary') === 0) return unmeasured('the wall frame did not run');
  const measured = LAB_BATTERY_CHANNELS.filter((c) => hits(r, `ctl-${c}`) > 0);
  const reachable = LAB_BATTERY_CHANNELS.filter((c) => !UNREACHABLE.includes(c));
  const counted = measured.filter((c) => !UNREACHABLE.includes(c)).length;
  if (counted < LAB_CONTROL_FLOOR) return unmeasured(`the control frame reached ${counted} of ${reachable.length} (floor ${LAB_CONTROL_FLOOR})`);
  if (local.hostile?.mermaidDropped === true) return unmeasured('library not measured: the Mermaid asset did not load');
  if (local.hostile?.ready !== true) return unmeasured('library not measured: the hostile mount never became ready');
  const unseen = LAB_BATTERY_CHANNELS.filter((c) => hits(r, `ctl-${c}`) === 0);
  return holds(`0 of 27 reached; ${measured.length} measured${unseen.length > 0 ? `; not measured: ${unseen.join(', ')}` : ''}; library 0 of 1 attempted`);
}

function popups(r: LabRunView): LabOutcome {
  const escaped = POPUP_TARGETS.filter((n) => hits(r, n) > 0);
  const opened = hits(r, 'popup-window') > 0;
  const readTop = hits(r, 'top-read-broke') > 0;
  if (escaped.length > 0 || opened || readTop) {
    return broken([
      ...escaped.map((n) => `${n} reached the server`),
      ...(opened ? ['window.open returned a window'] : []),
      ...(readTop ? ["the frame read the console's address"] : []),
    ].join('; '));
  }
  if (hits(r, 'popup-ran') === 0) return unmeasured('the button in the frame was not tapped');
  const threw = hits(r, 'top-write-threw') > 0;
  if (hits(r, 'popup-null') === 0 || hits(r, 'top-read-held') === 0 || (!threw && hits(r, 'top-write-returned') === 0)) {
    return unmeasured('a report did not arrive');
  }
  // Refinement (u): a top-navigation write that returned without an error, while nothing reached its target, holds. The
  // wall is that the console stayed where it was, which the door's silence shows; the detail names the difference from
  // M8.B4's "throws".
  return holds(threw ? '' : 'top navigation blocked without an error');
}

function selfNavigate(r: LabRunView, local: LabLocal): LabOutcome {
  if (hits(r, 'self-nav') > 0) return broken('the frame navigated itself to the server');
  const evidence = [
    ...(local.selfNavLoads !== null && local.selfNavLoads >= 2 ? ['attempt seen: second load'] : []),
    ...(hits(r, 'self-nav-tried') > 0 ? ['attempt seen: tried'] : []),
  ];
  return evidence.length === 0 ? unmeasured('the frame did not try') : holds(evidence.join('; '));
}

/** The engine's teardown signal: a blocked self-navigation fires a second `load`, which is what closes the reader's port
 *  (the rich-docs spec's section 5.1 and M8.B5). No port exists in a lab frame; this is the engine signal it relies on. An
 *  engine without it differs from desktop Chromium: a miss E18 investigates, not a broken wall. */
function selfNavTeardown(r: LabRunView, local: LabLocal): LabOutcome {
  if (local.selfNavLoads !== null && local.selfNavLoads >= 2) return holds('second load fired');
  return hits(r, 'self-nav-tried') > 0 ? { verdict: 'differs', detail: 'no second load' } : unmeasured('the frame did not try');
}

/** The stray messages' broken signal, observed by the page itself and so independent of the door: `undefined` when none. */
function straysBroke(local: LabLocal): LabOutcome | undefined {
  const h = local.strays;
  return h !== null && (h.effects > 0 || h.addressChanged)
    ? broken(`${h.effects} effects${h.addressChanged ? '; the address changed' : ''}`) : undefined;
}

/** Observes navigate, hash and copy effects; store.set and a same-source-only listener are not exercised. */
function strays(r: LabRunView, local: LabLocal): LabOutcome {
  const h = local.strays;
  const bad = straysBroke(local);
  if (bad !== undefined) return bad;
  if (h === null || !h.ready) return unmeasured('the reader did not become ready');
  if (hits(r, 'strays-sent') === 0) return unmeasured('the stray frame did not run');
  return holds(`${LAB_STRAYS_POSTED} sent, 0 effects; observed navigate, hash, copy; store.set and a same-source-only listener not exercised`);
}

/** A fact, never a pass or a fail: whether the busy frame shares the console's thread (its spin stops the console's
 *  frames for most of the spin), and how late the console's timer, the reader watchdog's stand-in, fired. It steers the
 *  Mermaid policy and gates nothing: a deliberate spin on a shared thread can meet no budget. */
function busyFrame(r: LabRunView, local: LabLocal): LabOutcome {
  const b = local.busy;
  if (b === null || hits(r, 'busy-start') === 0 || hits(r, 'busy-end') === 0) return unmeasured('the busy frame did not run');
  if (b.gapHidden) return unmeasured('the page was hidden');
  return {
    verdict: b.longestGapMs >= 0.8 * b.spinMs ? 'shared-thread' : 'own-thread',
    detail: `longest gap ${ms(b.longestGapMs)} ms in a ${ms(b.spinMs)} ms spin; watchdog timer ${ms(b.timerLateMs)} ms late`,
  };
}

/** The seven figure mounts the Mermaid line needs before it can hold: the six figures singly, then the six together. */
const FIGURE_LABELS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'all'] as const;

const worstOf = (list: readonly LabMount[]): LabMount => list.reduce((a, b) => (b.longestGapMs > a.longestGapMs ? b : a));

/** The Mermaid stall under the lab profile's draw mode, draw on open. Every figure mount counts, the six together (`all`,
 *  the heavy page) included, and so does a mount that fell back or timed out, where a stall is likeliest: the worst gap of
 *  them all decides. Over the budget: does not hold. Within it, a figure mount that did not become ready, or that is
 *  missing from the list, cannot show that it holds. Ready does not prove that figures drew inside the opaque frame. */
function mermaid(local: LabLocal, budgetMs: number): LabOutcome {
  const figures = local.mounts.filter((m) => /^f\d$/.test(m.label) || m.label === 'all');
  if (figures.length === 0) return unmeasured('not run');
  if (figures.some((m) => m.outcome === 'mermaid-dropped')) return unmeasured('the Mermaid asset did not load');
  if (figures.some((m) => m.gapHidden)) return unmeasured('the page was hidden');
  const worst = worstOf(figures);
  const singles = figures.filter((m) => m.label !== 'all');
  const single = singles.length === 0 ? null : worstOf(singles);
  const where = worst.label !== 'all' ? `figure ${worst.label.slice(1)}`
    : `all six together${single === null ? '' : `; worst single: figure ${single.label.slice(1)}, ${ms(single.longestGapMs)} ms`}`;
  const detail = `longest gap ${ms(worst.longestGapMs)} ms, ${where}`;
  if (worst.longestGapMs > budgetMs) return broken(detail);
  const missed = [
    ...figures.filter((m) => m.outcome !== 'ready').map((m) => `${m.label} ${m.outcome}`),
    ...FIGURE_LABELS.filter((l) => !figures.some((m) => m.label === l)).map((l) => `${l} missing`),
  ];
  return missed.length > 0 ? unmeasured(`not ready: ${missed.join(', ')}`) : holds(`ready; ${detail}`);
}

/** What the E17 lines mean for drawing Mermaid on open, the operator's ruling of 2026-11-03 (the reader lab design,
 *  section 8): one reading of the busy frame's fact and the Mermaid line together, for the library change. Not a verdict. */
export function drawOnOpenReading(o: Readonly<Record<LabCheckId, LabOutcome>>, local: LabLocal, budgetMs: number): string {
  const busy = o['busy-frame'].verdict;
  const m = o.mermaid.verdict;
  if (busy === 'not-measured' || m === 'not-measured') return 'not measured';
  if (busy === 'own-thread') {
    return m === 'holds' ? 'costs the console nothing here; the change only stops ready waiting for figures'
      : 'the console stalls though the frame has its own thread; read the gaps';
  }
  if (m === 'holds') return 'fits the budget here, though the frame shares the thread';
  const over = local.mounts.filter((x) => /^f\d$/.test(x.label) && x.longestGapMs > budgetMs).map((x) => x.label);
  return over.length === 0 ? 'needs one figure per task here; every single figure fits the budget'
    : `needs one figure per task here, and ${over.join(', ')} still exceed the budget: draw those on tap or when scrolled into view`;
}

/** Every check's outcome. `run` null: the door could not be read. */
export function labVerdicts(run: LabRunView | null, local: LabLocal, budgetMs: number): Record<LabCheckId, LabOutcome> {
  const fromCounts = (f: (r: LabRunView) => LabOutcome): LabOutcome => {
    if (run === null) return unmeasured('the door could not be read');
    const o = f(run);
    // A saturated run: the door stopped counting, which does not falsify the counts it had taken, so a counted "does not
    // hold" stands; anything else cannot be trusted to be complete and is not measured.
    return run.saturated && o.verdict !== 'does-not-hold' ? unmeasured('the door counted more than a lab run sends') : o;
  };
  return {
    'opaque-origin': fromCounts((r) => opaqueOrigin(r)),
    'no-ambient-state': fromCounts((r) => ambientState(r)),
    'no-cookie': fromCounts((r) => noCookie(r)),
    'csp-27': fromCounts((r) => csp27(r, local)),
    'no-popup-top-nav': fromCounts((r) => popups(r)),
    'no-self-navigate': fromCounts((r) => selfNavigate(r, local)),
    'bridge-strays': straysBroke(local) ?? fromCounts((r) => strays(r, local)),
    'self-nav-teardown': fromCounts((r) => selfNavTeardown(r, local)),
    'busy-frame': fromCounts((r) => busyFrame(r, local)),
    mermaid: mermaid(local, budgetMs),
  };
}
