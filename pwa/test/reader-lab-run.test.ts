// The reader lab's run (native Docs reader, the reader lab plan of 2026-11-03, Task 9; the rich-docs spec's row M10.13):
// `readerLab/run.ts` with a fake door, fake frames that report as a healthy engine would, and a fake reader mount. Every
// step mounts at most one frame and removes it before the next; the door run is closed however the run ends; a missing
// report is never a hold; a run lost after its counts are complete keeps them; the run's steps and mounts are the caps the
// door's run life is derived from.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAB_BATTERY_CHANNELS, LAB_DRAW_SETTLE_MS, LAB_MOUNTS, LAB_MOUNT_WAIT_MS, LAB_PROBE_NAMES, LAB_SETTLE_MS, LAB_STEPS,
  type LabProbeName, type LabProbeTally, type LabRunView,
} from '../../shared/readerLab';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { LAB_CHECKS, LAB_WALLS } from '../src/readerLab/checks';
import { LAB_PAGES } from '../src/readerLab/fixtures';
import {
  AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, COOKIE_SCRIPT, POPUP_SCRIPT, SELF_NAV_SCRIPT, STRAYS_SCRIPT,
} from '../src/readerLab/frameScripts';
import type { LabFrameSpec } from '../src/readerLab/frames';
import {
  LAB_GAP_WINDOW, LabFailure, gapWindowEnd, runReaderLab, type LabDeps, type LabGapWindow, type LabProgress,
} from '../src/readerLab/run';

afterEach(() => {
  document.body.replaceChildren();
});

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};
const AMBIENT = ['parent', 'origin', 'cookie', 'local', 'session', 'idb', 'caches'];

/** What a healthy engine's frame reports, by its script. */
function healthy(spec: LabFrameSpec): string[] {
  switch (spec.script) {
    case POPUP_SCRIPT: return ['popup-null', 'top-read-held', 'top-write-threw', 'popup-ran'];
    case AMBIENT_SCRIPT: return AMBIENT.map((k) => `ambient-${k}-held`);
    case COOKIE_SCRIPT: return ['cookie-fetch', 'cookie-xhr', 'cookie-beacon', 'cookie-image', 'cookie-ran'];
    case BATTERY_SCRIPT: return spec.config['canary'] === true ? ['csp-canary'] : LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe').map((c) => `ctl-${c}`);
    case SELF_NAV_SCRIPT: return ['self-nav-tried'];
    case BUSY_SCRIPT: return ['busy-start', 'busy-end'];
    case STRAYS_SCRIPT: return ['strays-sent'];
    default: return [];
  }
}

interface RigOptions {
  report?: (spec: LabFrameSpec) => string[];
  open?: 'no-door' | 'refused';
  read?: 'unreadable';
  /** The door forgets the run once this many reader mounts have started (a run whose life ran out mid-Mermaid). */
  loseAfterMounts?: number;
  gapWindow?: LabGapWindow;
  /** Runs right after a reader mount became ready, with the mount's input and its place in the run (0: the hostile page). */
  afterReady?: (input: ReaderMountInput, index: number) => void;
  onFrame?: (spec: LabFrameSpec, rig: Rig) => void;
}
interface Rig {
  readonly deps: LabDeps;
  readonly door: { opened: number; closed: string[]; probes: number };
  readonly order: string[];
  readonly inputs: ReaderMountInput[];
  /** Every sleep the run asked for, in order. */
  readonly slept: number[];
  readonly stage: HTMLElement;
  readonly abort: AbortController;
  live(): number;
}

function rig(o: RigOptions = {}): Rig {
  const abort = new AbortController();
  const tallies = new Map<string, { hits: number; cookie: number }>();
  const hit = (n: string, cookie = false): void => {
    const t = tallies.get(n) ?? { hits: 0, cookie: 0 };
    t.hits += 1;
    if (cookie) t.cookie += 1;
    tallies.set(n, t);
  };
  const view = (): LabRunView => ({
    openedAt: 0, expiresAt: 600_000, counted: 0, ignored: 0, saturated: false,
    probes: Object.fromEntries(LAB_PROBE_NAMES.map((n) => [n, { ...ZERO, hits: tallies.get(n)?.hits ?? 0, cookie: tallies.get(n)?.cookie ?? 0 }])) as Record<LabProbeName, LabProbeTally>,
  });
  const door = { opened: 0, closed: [] as string[], probes: 0 };
  const order: string[] = [];
  const inputs: ReaderMountInput[] = [];
  const slept: number[] = [];
  const stage = document.createElement('div');
  document.body.append(stage);
  let live = 0;
  let liveReaders = 0;
  let clock = 0;
  const names = new Map<string, string>([[POPUP_SCRIPT, 'popup'], [AMBIENT_SCRIPT, 'ambient'], [COOKIE_SCRIPT, 'cookie'],
    [BATTERY_SCRIPT, 'battery'], [SELF_NAV_SCRIPT, 'selfNav'], [BUSY_SCRIPT, 'busy'], [STRAYS_SCRIPT, 'strays']]);
  const r: Rig = {
    door, order, inputs, slept, stage, abort, live: () => live,
    deps: {
      door: {
        open: async () => { door.opened += 1; return o.open ?? { nonce: NONCE }; },
        read: async () => (o.loseAfterMounts !== undefined && inputs.length > o.loseAfterMounts ? 'unknown-run' : o.read ?? view()),
        close: async (nonce) => { door.closed.push(nonce); },
        probe: async () => { door.probes += 1; order.push('probe'); hit('cookie-console', true); },
      },
      origin: 'https://box.example',
      stage,
      mountFrame: (s, spec) => {
        expect(live, 'a frame was still mounted when the next one mounted').toBe(0);
        live += 1;
        order.push(names.get(spec.script) ?? 'unknown');
        const el = document.createElement('i');
        s.append(el);
        for (const n of (o.report ?? healthy)(spec)) hit(n);
        o.onFrame?.(spec, r);
        let gone = false;
        return {
          loads: () => (spec.script === SELF_NAV_SCRIPT ? 2 : 1),
          remove: () => { if (!gone) { gone = true; live -= 1; el.remove(); } },
        };
      },
      render: async () => ({
        kind: 'rendered', result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } },
        mermaid: { fences: 1, largestBytes: 10, totalBytes: 10, largestChars: 10, totalChars: 10 }, images: [],
      }) as unknown as ReaderRenderOutcome,
      mountReader: async (_el, input) => {
        expect(liveReaders, 'a reader mount was still up when the next one mounted').toBe(0);
        liveReaders += 1;
        inputs.push(input);
        const index = inputs.length - 1;
        queueMicrotask(() => { input.onReady(); o.afterReady?.(input, index); });
        return { destroy: vi.fn(() => { liveReaders -= 1; }), setPrefs: vi.fn() } satisfies ReaderMount;
      },
      frame: () => Promise.resolve((clock += 16)),
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        return ms >= LAB_MOUNT_WAIT_MS ? new Promise<void>(() => undefined) : ((clock += ms), Promise.resolve());
      },
      address: () => 'https://box.example/settings/reader-lab',
      gapWindow: o.gapWindow ?? 'ready',
      signal: abort.signal,
    },
  };
  return r;
}

describe('the reader lab run (reader lab plan, Task 9)', () => {
  it('a healthy engine: every line holds but the busy frame\'s fact, every step reports, and the door run is closed at the end', async () => {
    const r = rig();
    const steps: number[] = [];
    const result = await runReaderLab(r.deps, (p: LabProgress) => { steps.push(p.step); });
    for (const k of LAB_CHECKS.filter((c) => c !== 'busy-frame')) {
      expect(result.outcomes[k].verdict, `${k}: ${result.outcomes[k].detail}`).toBe('holds');
    }
    expect(result.outcomes['busy-frame'].verdict).toBe('own-thread');
    expect(result.finalRead).toBe('read');
    expect([...new Set(steps)].sort((a, b) => a - b)).toEqual(Array.from({ length: LAB_STEPS }, (_, i) => i + 1));
    expect(r.door.closed).toEqual([NONCE]);
    expect(result.local.mounts.map((m) => m.label)).toEqual(['none', 'trivial', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'all']);
  });

  it('the steps run in order, one frame at a time, and leave the stage empty', async () => {
    const r = rig();
    await runReaderLab(r.deps, () => undefined);
    expect(r.order).toEqual(['popup', 'ambient', 'probe', 'cookie', 'battery', 'battery', 'selfNav', 'busy', 'strays']);
    expect(r.live()).toBe(0);
    expect(r.stage.childElementCount).toBe(0);
  });

  it('every reader mount is the lab profile: lab-draw, no doc key, no images; there are as many as the caps count', async () => {
    const r = rig();
    await runReaderLab(r.deps, () => undefined);
    expect(LAB_PAGES.length + 2, 'the pages, the hostile page and the benign page the strays go to').toBe(LAB_MOUNTS);
    expect(r.inputs).toHaveLength(LAB_MOUNTS);
    for (const input of r.inputs) {
      expect(input.profile).toBe('lab-draw');
      expect(input.docKey).toBeNull();
      expect(input.document.images).toEqual({});
    }
  });

  it('every mount host is scrolled into view before its reader mounts (a frame off screen draws nothing, so ready never comes)', async () => {
    const calls: string[] = [];
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scrolled(this: HTMLElement): void {
      calls.push(`scroll:${this.className}`);
    });
    try {
      const r = rig();
      await runReaderLab({
        ...r.deps,
        mountReader: (el, input) => { calls.push(`mount:${el.className}`); return r.deps.mountReader(el, input); },
      }, () => undefined);
      expect(calls.filter((c) => c.startsWith('mount:'))).toHaveLength(LAB_MOUNTS);
      for (let i = 0; i < calls.length; i += 2) {
        expect([calls[i], calls[i + 1]], 'a scroll comes right before each mount').toEqual(['scroll:reader-lab-mount', 'mount:reader-lab-mount']);
      }
    } finally {
      scroll.mockRestore();
    }
  });

  it('the tap wait ends at the tap: one read while it waits, not thirty', async () => {
    let reads = 0;
    let readsAtAmbient = -1;
    const r = rig({ onFrame: (spec) => { if (spec.script === AMBIENT_SCRIPT) readsAtAmbient = reads; } });
    const inner = r.deps.door;
    await runReaderLab({ ...r.deps, door: { ...inner, read: (n) => { reads += 1; return inner.read(n); } } }, () => undefined);
    expect(readsAtAmbient, 'the first read, one read in the wait, and the step\'s own read').toBe(3);
  });

  it('a frame that never reports reads not measured, never holds (M10.13)', async () => {
    const r = rig({ report: (spec) => (spec.script === AMBIENT_SCRIPT ? [] : healthy(spec)) });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.outcomes['opaque-origin'].verdict).toBe('not-measured');
    expect(result.outcomes['no-ambient-state'].verdict).toBe('not-measured');
  });

  it('no tap within the wait reads not measured for popups, and the run goes on to the end', async () => {
    const r = rig({ report: (spec) => (spec.script === POPUP_SCRIPT ? [] : healthy(spec)) });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.outcomes['no-popup-top-nav']).toEqual({ verdict: 'not-measured', detail: 'the button in the frame was not tapped' });
    expect(result.outcomes['no-cookie'].verdict).toBe('holds');
  });

  it('a stray message that reached a host callback makes bridge-strays not hold', async () => {
    const r = rig({
      onFrame: (spec, rr) => {
        if (spec.script === STRAYS_SCRIPT) rr.inputs[rr.inputs.length - 1]!.onLink({ kind: 'fragment', id: 'x' });
      },
    });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.outcomes['bridge-strays']).toEqual({ verdict: 'does-not-hold', detail: '1 effects' });
  });

  it('the hostile page and the benign page mount one at a time, hostile first, and the strays go to the benign page', async () => {
    const r = rig({ onFrame: (spec, rr) => { if (spec.script === STRAYS_SCRIPT) rr.order.push(`inputs:${rr.inputs.length}`); } });
    await runReaderLab(r.deps, () => undefined);
    expect(r.order.slice(-2), 'the stray frame mounts after both reader mounts of the step started').toEqual(['strays', 'inputs:2']);
    expect(r.inputs[0]!.document.result.outcome).toBe('rendered');
  });

  it.each([{ window: 'ready' as const, ms: LAB_SETTLE_MS }, { window: 'ready-and-settle' as const, ms: LAB_DRAW_SETTLE_MS }])('keeps the hostile reader alive through its $window observation window', async ({ window, ms }) => {
    const r = rig({ gapWindow: window });
    let hostileLive = false;
    let observed = false;
    await runReaderLab({ ...r.deps,
      mountReader: async (el, input) => {
        const mount = await r.deps.mountReader(el, input);
        if (r.inputs.length !== 1) return mount;
        hostileLive = true;
        return { ...mount, destroy: () => { hostileLive = false; mount.destroy(); } };
      },
      sleep: async (duration) => {
        if (r.inputs.length === 1 && duration === ms) { expect(hostileLive).toBe(true); observed = true; }
        await r.deps.sleep(duration);
      },
    }, () => undefined);
    expect(observed).toBe(true);
    expect(hostileLive).toBe(false);
  });

  it('a hostile fallback after ready is the library failing closed, not a stray effect: bridge-strays still holds, and csp-27 still reads the hostile mount ready', async () => {
    const r = rig({ afterReady: (input, index) => { if (index === 0) input.onFallback('error'); } });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.local.hostile).toEqual({ ready: true });
    expect(result.local.strays).toEqual({ ready: true, effects: 0, addressChanged: false });
    expect(result.outcomes['bridge-strays'].verdict).toBe('holds');
    expect(result.outcomes['csp-27'].verdict).toBe('holds');
  });

  it('a benign fallback after ready counts as an effect: bridge-strays does not hold', async () => {
    const r = rig({ afterReady: (input, index) => { if (index === 1) input.onFallback('error'); } });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.local.strays).toEqual({ ready: true, effects: 1, addressChanged: false });
    expect(result.outcomes['bridge-strays']).toEqual({ verdict: 'does-not-hold', detail: '1 effects' });
    expect(result.outcomes['csp-27'].verdict).toBe('holds');
  });

  it('a run lost after the hostile step keeps every count it read: the walls still decide, and the result says the final read failed', async () => {
    const r = rig({ loseAfterMounts: 2 });
    const result = await runReaderLab(r.deps, () => undefined);
    for (const k of LAB_WALLS) expect(result.outcomes[k].verdict, `${k}: ${result.outcomes[k].detail}`).toBe('holds');
    expect(result.finalRead).toBe('unknown-run');
    expect(result.run).not.toBeNull();
    expect(r.door.closed).toEqual([NONCE]);
  });

  it('a rejected final read keeps completed counts and wall verdicts and closes', async () => {
    const r = rig();
    let final = false;
    const door = r.deps.door;
    const result = await runReaderLab({ ...r.deps, door: { ...door, read: (n) => final ? Promise.reject(new Error('lost')) : door.read(n) } }, (p) => { if (p.step === 9) final = true; });
    expect(result.finalRead).toBe('unreadable');
    expect(result.run).not.toBeNull();
    for (const k of LAB_WALLS) expect(result.outcomes[k].verdict).toBe('holds');
    expect(r.door.closed).toEqual([NONCE]);
  });

  it('a stop during a rejecting final read remains stopped and closes', async () => {
    const r = rig();
    let final = false;
    const door = r.deps.door;
    const run = runReaderLab({ ...r.deps, door: { ...door, read: (n) => final ? new Promise((_resolve, reject) => { queueMicrotask(() => { r.abort.abort(); reject(new Error('lost')); }); }) : door.read(n) } }, (p) => { if (p.step === 9) final = true; });
    await expect(run).rejects.toThrow('stopped');
    expect(r.door.closed).toEqual([NONCE]);
  });

  it('the gap window ends at ready under the library this build pins, and a settle past ready once the library draws after it', async () => {
    expect(LAB_GAP_WINDOW).toBe('ready');
    const slept: number[] = [];
    const sleep = async (ms: number): Promise<void> => { slept.push(ms); };
    await gapWindowEnd('ready', Promise.resolve('ready'), sleep);
    await gapWindowEnd('ready-and-settle', Promise.resolve('fallback'), sleep);
    expect(slept).toEqual([]);
    await gapWindowEnd('ready-and-settle', Promise.resolve('ready'), sleep);
    expect(slept).toEqual([LAB_DRAW_SETTLE_MS]);
    const after = rig({ gapWindow: 'ready-and-settle' });
    await runReaderLab(after.deps, () => undefined);
    expect(after.slept.filter((ms) => ms === LAB_DRAW_SETTLE_MS), 'one settle per timed page and the hostile page').toHaveLength(LAB_PAGES.length + 1);
    const now = rig();
    await runReaderLab(now.deps, () => undefined);
    expect(now.slept.filter((ms) => ms === LAB_DRAW_SETTLE_MS)).toEqual([]);
  });

  it('no door: the run fails with that word, mounts nothing and has nothing to close', async () => {
    const r = rig({ open: 'no-door' });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toSatisfy((e: unknown) => e instanceof LabFailure && e.word === 'no-door');
    expect([r.order, r.door.closed]).toEqual([[], []]);
  });

  it('an older door: the first read fails the run with unreadable before any frame, and the run is closed', async () => {
    const r = rig({ read: 'unreadable' });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toSatisfy((e: unknown) => e instanceof LabFailure && e.word === 'unreadable');
    expect(r.order).toEqual([]);
    expect(r.door.closed).toEqual([NONCE]);
  });

  it('Stop: an abort mid-run removes what the step mounted and closes the door run', async () => {
    const r = rig({ onFrame: (spec, rr) => { if (spec.script === BUSY_SCRIPT) rr.abort.abort(); } });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toThrow('stopped');
    expect(r.live()).toBe(0);
    expect(r.stage.childElementCount).toBe(0);
    expect(r.door.closed).toEqual([NONCE]);
  });
});
