// The reader lab's verdicts, device line and result block (native Docs reader, the reader lab plan of 2026-11-03, Task 8;
// the rich-docs spec's rows M10.13 and M10.14). Every line has three outcomes; a check holds only on its own positive
// signal; any arrival at a wall's target is "does not hold", and a forged arrival cannot hide a real one; the busy frame
// is a fact; the block is format 1 and names no host, nonce or user agent.
import { describe, expect, it } from 'vitest';
import {
  LAB_BATTERY_CHANNELS, LAB_PROBE_NAMES, type LabBatteryChannel, type LabProbeName, type LabProbeTally, type LabRunView,
} from '../../shared/readerLab';
import { LAB_CHECKS, LAB_E17, LAB_E18, LAB_WALLS } from '../src/readerLab/checks';
import { deviceOf, labFeaturesOf, type LabFeatures } from '../src/readerLab/device';
import { LAB_RESULT_FORMAT, formatLabResult } from '../src/readerLab/result';
import { LAB_CONTROL_FLOOR, drawOnOpenReading, labVerdicts, type LabLocal } from '../src/readerLab/verdicts';

const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};
type Over = Partial<Record<LabProbeName, Partial<LabProbeTally>>>;

/** A run whose every probe is zero but those `over` names. */
function runWith(over: Over, extra: Partial<LabRunView> = {}): LabRunView {
  const probes = Object.fromEntries(LAB_PROBE_NAMES.map((n) => [n, { ...ZERO, ...(over[n] ?? {}) }])) as Record<LabProbeName, LabProbeTally>;
  return { openedAt: 0, expiresAt: 600_000, counted: 0, ignored: 0, saturated: false, probes, ...extra };
}

const one = { hits: 1 };
/** A healthy engine's counts: every report held, the control carried the cookie, the canary arrived, and the control frame
 *  reached the door on every channel but `link-prefetch` and `iframe`. */
const HEALTHY: Over = {
  'cookie-console': { hits: 1, cookie: 1 },
  'cookie-fetch': one, 'cookie-xhr': one, 'cookie-beacon': one, 'cookie-image': one, 'cookie-ran': one,
  'ambient-parent-held': one, 'ambient-origin-held': one, 'ambient-cookie-held': one, 'ambient-local-held': one,
  'ambient-session-held': one, 'ambient-idb-held': one, 'ambient-caches-held': one,
  'csp-canary': one,
  ...(Object.fromEntries(LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe' && c !== 'link-prefetch').map((c) => [`ctl-${c}`, one])) as Over),
  'popup-null': one, 'top-read-held': one, 'top-write-threw': one, 'popup-ran': one,
  'self-nav-tried': one, 'busy-start': one, 'busy-end': one, 'strays-sent': one,
};

const LOCAL_OK: LabLocal = {
  selfNavLoads: 2,
  busy: { longestGapMs: 30, timerLateMs: 5, spinMs: 3000 },
  mounts: [['none', 40], ['trivial', 120], ['f1', 30], ['f2', 20], ['f3', 50], ['f4', 60], ['f5', 70], ['f6', 25], ['all', 150]]
    .map(([label, gap]) => ({ label: String(label), outcome: 'ready' as const, longestGapMs: Number(gap), elapsedMs: 900 })),
  hostile: { ready: true, effects: 0, addressChanged: false },
};

const verdictsOf = (over: Over, local: LabLocal = LOCAL_OK) => labVerdicts(runWith({ ...HEALTHY, ...over }), local, 200);

describe('the reader lab verdicts (reader lab plan, Task 8)', () => {
  it('a healthy engine: all seven walls, the teardown signal and the Mermaid line hold, and the busy frame is a fact', () => {
    expect(LAB_CHECKS).toHaveLength(10);
    expect([LAB_WALLS.length, LAB_E18.length, [...LAB_E17]]).toEqual([7, 8, ['busy-frame', 'mermaid']]);
    const v = labVerdicts(runWith(HEALTHY), LOCAL_OK, 200);
    for (const k of LAB_CHECKS.filter((c) => c !== 'busy-frame')) expect(v[k].verdict, k).toBe('holds');
    expect(v['busy-frame']).toEqual({ verdict: 'own-thread', detail: 'longest gap 30 ms in a 3000 ms spin; watchdog timer 5 ms late' });
    expect(v['no-cookie'].detail).toBe('4 arrived, 0 with the cookie; the control carried it');
    expect(v['csp-27'].detail).toBe('0 of 27 reached; 25 measured; not measured: link-prefetch, iframe; library 0 of 2');
    expect(v['no-self-navigate'].detail).toBe('');
    expect(v['self-nav-teardown'].detail).toBe('second load fired');
    expect(v['bridge-strays'].detail).toBe('8 sent, 0 effects');
    expect(v.mermaid.detail).toBe('longest gap 150 ms, all six together; worst single: figure 5, 70 ms');
  });

  it('opaque origin: a broke report or a same-origin arrival does not hold; a missing report is not measured', () => {
    expect(verdictsOf({ 'ambient-parent-broke': one })['opaque-origin'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'ambient-origin-broke': one })['opaque-origin'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'ambient-idb-held': { hits: 1, site: { ...ZERO.site, 'same-origin': 1 } } })['opaque-origin'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'ambient-origin-held': { hits: 0 } })['opaque-origin']).toEqual({ verdict: 'not-measured', detail: 'no report: origin' });
  });

  it('ambient state: a reachable store does not hold; a missing report is not measured', () => {
    expect(verdictsOf({ 'ambient-local-broke': one })['no-ambient-state']).toEqual({ verdict: 'does-not-hold', detail: 'reachable: local' });
    expect(verdictsOf({ 'ambient-caches-held': { hits: 0 } })['no-ambient-state']).toEqual({ verdict: 'not-measured', detail: 'no report: caches' });
  });

  it('no cookie: a frame request with the cookie, or the preflighted one arriving, does not hold; no control cookie or no arrival is not measured', () => {
    expect(verdictsOf({ 'cookie-xhr': { hits: 1, cookie: 1 } })['no-cookie'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'cookie-fetch-marker': one })['no-cookie'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'cookie-console': { hits: 1, cookie: 0 } })['no-cookie'].verdict).toBe('not-measured');
    expect(verdictsOf({ 'cookie-console': { hits: 0 } })['no-cookie'].verdict).toBe('not-measured');
    const none = { 'cookie-fetch': { hits: 0 }, 'cookie-xhr': { hits: 0 }, 'cookie-beacon': { hits: 0 }, 'cookie-image': { hits: 0 } };
    expect(verdictsOf(none)['no-cookie']).toEqual({ verdict: 'not-measured', detail: 'no frame request arrived' });
    expect(verdictsOf({ ...none, 'cookie-ran': { hits: 0 } })['no-cookie']).toEqual({ verdict: 'not-measured', detail: 'the frame did not run' });
  });

  it('csp-27: a wall channel or a hostile target arriving does not hold; no canary is not measured', () => {
    expect(verdictsOf({ 'csp-beacon': one })['csp-27']).toEqual({ verdict: 'does-not-hold', detail: '1 of 27 reached: beacon' });
    expect(verdictsOf({ 'hostile-img': one })['csp-27'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'csp-canary': { hits: 0 } })['csp-27']).toEqual({ verdict: 'not-measured', detail: 'the wall frame did not run' });
  });

  it('csp-27: under M8.B1\'s control floor, iframe left out, the line is not measured; at the floor it holds (F6)', () => {
    expect(LAB_CONTROL_FLOOR).toBe(20);
    const reachable: readonly LabBatteryChannel[] = LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe');
    const control = (n: number): Over => Object.fromEntries(LAB_BATTERY_CHANNELS.map((c) => [`ctl-${c}`, { hits: reachable.indexOf(c) > -1 && reachable.indexOf(c) < n ? 1 : 0 }])) as Over;
    expect(verdictsOf(control(19))['csp-27']).toEqual({ verdict: 'not-measured', detail: 'the control frame reached 19 of 26 (floor 20)' });
    expect(verdictsOf({ ...control(19), 'ctl-iframe': one })['csp-27'].verdict, 'iframe does not count toward the floor').toBe('not-measured');
    expect(verdictsOf(control(20))['csp-27'].verdict).toBe('holds');
    expect(verdictsOf(control(0))['csp-27']).toEqual({ verdict: 'not-measured', detail: 'the control frame reached 0 of 26 (floor 20)' });
  });

  it('csp-27: a library mount that never became ready is not measured, never holds (F6)', () => {
    for (const hostile of [null, { ready: false, effects: 0, addressChanged: false }]) {
      expect(verdictsOf({}, { ...LOCAL_OK, hostile })['csp-27'])
        .toEqual({ verdict: 'not-measured', detail: 'library not measured: the hostile mount never became ready' });
    }
    expect(verdictsOf({ 'hostile-click': one }, { ...LOCAL_OK, hostile: null })['csp-27'].verdict, 'an arrival still decides first').toBe('does-not-hold');
  });

  it('popups: any target reached, a returned window or a read of the console address does not hold; no tap or a missing report is not measured', () => {
    for (const n of ['popup-open', 'popup-blank', 'top-nav', 'popup-window', 'top-read-broke'] as const) {
      expect(verdictsOf({ [n]: one } as Over)['no-popup-top-nav'].verdict, n).toBe('does-not-hold');
    }
    expect(verdictsOf({ 'popup-ran': { hits: 0 } })['no-popup-top-nav'])
      .toEqual({ verdict: 'not-measured', detail: 'the button in the frame was not tapped' });
    expect(verdictsOf({ 'top-write-threw': { hits: 0 } })['no-popup-top-nav'])
      .toEqual({ verdict: 'not-measured', detail: 'a report did not arrive' });
  });

  it('popups, refinement (u): a top-navigation write that returned without an error, with nothing at its target, holds and says so', () => {
    expect(verdictsOf({ 'top-write-threw': { hits: 0 }, 'top-write-returned': one })['no-popup-top-nav'])
      .toEqual({ verdict: 'holds', detail: 'top navigation blocked without an error' });
    expect(verdictsOf({ 'top-write-threw': { hits: 0 }, 'top-write-returned': one, 'top-nav': one })['no-popup-top-nav'].verdict)
      .toBe('does-not-hold');
  });

  it('self-navigation: the navigation arriving does not hold; no tried report is not measured', () => {
    expect(verdictsOf({ 'self-nav': one })['no-self-navigate'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'self-nav-tried': { hits: 0 } })['no-self-navigate'].verdict).toBe('not-measured');
    expect(verdictsOf({}, { ...LOCAL_OK, selfNavLoads: 1 })['no-self-navigate'].verdict, 'the wall is the door\'s silence alone').toBe('holds');
  });

  it('teardown signal: a second load holds; none differs from desktop, a miss E18 reads, never a broken wall; no run is not measured (F7)', () => {
    expect(verdictsOf({}, { ...LOCAL_OK, selfNavLoads: 1 })['self-nav-teardown']).toEqual({ verdict: 'differs', detail: 'no second load' });
    expect(verdictsOf({}, { ...LOCAL_OK, selfNavLoads: null })['self-nav-teardown'].verdict).toBe('not-measured');
    expect(verdictsOf({ 'self-nav-tried': { hits: 0 } })['self-nav-teardown'].verdict).toBe('not-measured');
  });

  it('strays: an effect or an address change does not hold; a reader that never became ready is not measured', () => {
    expect(verdictsOf({}, { ...LOCAL_OK, hostile: { ready: true, effects: 1, addressChanged: false } })['bridge-strays'].verdict).toBe('does-not-hold');
    expect(verdictsOf({}, { ...LOCAL_OK, hostile: { ready: true, effects: 0, addressChanged: true } })['bridge-strays'].verdict).toBe('does-not-hold');
    expect(verdictsOf({}, { ...LOCAL_OK, hostile: { ready: false, effects: 0, addressChanged: false } })['bridge-strays'].verdict).toBe('not-measured');
    expect(verdictsOf({ 'strays-sent': { hits: 0 } })['bridge-strays'].verdict).toBe('not-measured');
  });

  it('busy frame: a fact, never a pass or a fail: a gap over most of the spin is a shared thread, whatever the budget (F2)', () => {
    const shared = verdictsOf({}, { ...LOCAL_OK, busy: { longestGapMs: 3012, timerLateMs: 2489, spinMs: 3000 } })['busy-frame'];
    expect(shared).toEqual({ verdict: 'shared-thread', detail: 'longest gap 3012 ms in a 3000 ms spin; watchdog timer 2489 ms late' });
    expect(verdictsOf({}, { ...LOCAL_OK, busy: { longestGapMs: 30, timerLateMs: 250, spinMs: 3000 } })['busy-frame'].verdict).toBe('own-thread');
    expect(verdictsOf({ 'busy-end': { hits: 0 } })['busy-frame'].verdict).toBe('not-measured');
    expect(verdictsOf({}, { ...LOCAL_OK, busy: null })['busy-frame'].verdict).toBe('not-measured');
  });

  it('mermaid: every figure mount counts, the six together included; the worst gap decides (F3)', () => {
    const slow = LOCAL_OK.mounts.map((m) => (m.label === 'f4' ? { ...m, longestGapMs: 420 } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: slow }).mermaid).toEqual({ verdict: 'does-not-hold', detail: 'longest gap 420 ms, figure 4' });
    const heavy = LOCAL_OK.mounts.map((m) => (m.label === 'all' ? { ...m, longestGapMs: 1310 } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: heavy }).mermaid)
      .toEqual({ verdict: 'does-not-hold', detail: 'longest gap 1310 ms, all six together; worst single: figure 5, 70 ms' });
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: [] }).mermaid).toEqual({ verdict: 'not-measured', detail: 'not run' });
  });

  it('mermaid: a mount that fell back or timed out still counts its gap; within the budget it is not measured, never holds (F4)', () => {
    const timedOut = LOCAL_OK.mounts.map((m) => (m.label === 'f3' ? { ...m, outcome: 'timeout' as const, longestGapMs: 420 } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: timedOut }).mermaid).toEqual({ verdict: 'does-not-hold', detail: 'longest gap 420 ms, figure 3' });
    const fell = LOCAL_OK.mounts.map((m) => (m.label === 'f2' ? { ...m, outcome: 'fallback' as const } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: fell }).mermaid).toEqual({ verdict: 'not-measured', detail: 'did not draw: f2 fallback' });
    const none = LOCAL_OK.mounts.map((m) => ({ ...m, outcome: 'timeout' as const }));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: none }).mermaid.verdict).toBe('not-measured');
  });

  it('a forged arrival cannot hide a real broke: held reports added to a broken wall leave it broken (M10.13)', () => {
    const v = verdictsOf({ 'ambient-parent-broke': one, 'ambient-parent-held': { hits: 9 }, 'ambient-local-broke': one, 'ambient-local-held': { hits: 9 } });
    expect([v['opaque-origin'].verdict, v['no-ambient-state'].verdict]).toEqual(['does-not-hold', 'does-not-hold']);
  });

  it('a saturated or unread run makes every count line not measured; mermaid still reads its mounts', () => {
    for (const v of [labVerdicts(runWith(HEALTHY, { saturated: true }), LOCAL_OK, 200), labVerdicts(null, LOCAL_OK, 200)]) {
      for (const k of LAB_CHECKS.filter((c) => c !== 'mermaid')) expect(v[k].verdict, k).toBe('not-measured');
      expect(v.mermaid.verdict).toBe('holds');
    }
  });

  it('the draw-on-open reading: what the busy frame\'s fact and the Mermaid line mean for drawing on open', () => {
    const shared = { ...LOCAL_OK, busy: { longestGapMs: 3012, timerLateMs: 2489, spinMs: 3000 } };
    const read = (local: LabLocal, over: Over = {}): string => drawOnOpenReading(verdictsOf(over, local), local, 200);
    expect(read(LOCAL_OK)).toBe('costs the console nothing here; the change only stops ready waiting for figures');
    expect(read(shared)).toBe('fits the budget here, though the frame shares the thread');
    const heavy = { ...shared, mounts: shared.mounts.map((m) => (m.label === 'all' ? { ...m, longestGapMs: 1310 } : m)) };
    expect(read(heavy)).toBe('needs one figure per task here; every single figure fits the budget');
    const slow = { ...heavy, mounts: heavy.mounts.map((m) => (m.label === 'f4' ? { ...m, longestGapMs: 420 } : m)) };
    expect(read(slow)).toBe('needs one figure per task here, and f4 still exceed the budget: draw those on tap or when scrolled into view');
    expect(read(LOCAL_OK, { 'busy-end': { hits: 0 } })).toBe('not measured');
  });
});

describe('the device line and the result block (reader lab plan, Task 8)', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
  const ALL: LabFeatures = { worker: true, frameSandbox: true, cspAttribute: true };

  it('deviceOf keeps classes only: engine and major version, OS class, cores, and the three features', () => {
    const cases: readonly (readonly [string, unknown, string, string, number | null])[] = [
      [ANDROID, 8, 'Blink 141', 'Android', 8],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', 6, 'WebKit 19', 'iOS', 6],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1', 6, 'WebKit 19', 'iOS', 6],
      ['Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0', 8, 'Gecko 140', 'Android', 8],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15', 10, 'WebKit 19', 'macOS', 10],
      ['x', 0, 'unknown', 'other', null],
      ['x', 'eight', 'unknown', 'other', null],
    ];
    for (const [ua, cores, engine, os, n] of cases) expect(deviceOf(ua, cores, ALL), ua).toEqual({ engine, os, cores: n, ...ALL });
  });

  it('labFeaturesOf tests presence only: a Worker, the iframe sandbox attribute, and the iframe csp attribute', () => {
    const proto = { sandbox: null };
    expect(labFeaturesOf({ Worker: function W() { /* a constructor */ }, HTMLIFrameElement: { prototype: proto } }))
      .toEqual({ worker: true, frameSandbox: true, cspAttribute: false });
    expect(labFeaturesOf({ HTMLIFrameElement: { prototype: { ...proto, csp: '' } } })).toEqual({ worker: false, frameSandbox: true, cspAttribute: true });
    expect(labFeaturesOf(null)).toEqual({ worker: false, frameSandbox: false, cspAttribute: false });
  });

  it('the block is format 1: fixed keys in order, each line\'s words, the budget, the gaps, the reading and the door line, and no host, nonce or user agent (M10.14)', () => {
    expect(LAB_RESULT_FORMAT).toBe(1);
    const run = runWith(HEALTHY, { counted: 151 });
    const text = formatLabResult(deviceOf(ANDROID, 8, ALL), 'abcdef012345', labVerdicts(run, LOCAL_OK, 200), LOCAL_OK, run, 200, 'read');
    const lines = text.split('\n');
    expect(lines[0]).toBe('reader-lab 1 · Blink 141 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library abcdef012345');
    expect(lines[1]).toBe('E18 walls: 7 of 7 hold; teardown signal holds');
    expect(lines.slice(2, 10).map((l) => l.trim().split(/\s+/)[0])).toEqual([...LAB_E18]);
    for (const l of lines.slice(2, 9)) expect(l).toMatch(/^ {2}[a-z0-9-]+ +(?:holds|does not hold|not measured)(?: \(.+\))?$/);
    expect(lines[9]).toBe('  self-nav-teardown  holds (second load fired)');
    expect(lines[10]).toBe('E17 responsive (mermaid budget 200 ms):');
    expect(lines[11]).toBe('  busy-frame         own thread (longest gap 30 ms in a 3000 ms spin; watchdog timer 5 ms late)');
    expect(lines[12]!.trim().startsWith('mermaid            holds')).toBe(true);
    expect(lines[13]).toBe('    gaps ms          none 40 · trivial 120 · f1 30 · f2 20 · f3 50 · f4 60 · f5 70 · f6 25 · all 150');
    expect(lines[14]).toBe('draw on open: costs the console nothing here; the change only stops ready waiting for figures');
    expect(lines[15]).toBe('door: 151 counted, 0 ignored; session cookie sent');
    for (const leak of ['Mozilla', 'Chrome/', 'box.example', 'AAAAAAAAAAAAAAAAAAAAAA', 'http']) expect(text, leak).not.toContain(leak);
    const broken = labVerdicts(runWith({ ...HEALTHY, 'self-nav': one, 'popup-ran': { hits: 0 } }), { ...LOCAL_OK, selfNavLoads: 1 }, 200);
    expect(formatLabResult(deviceOf(ANDROID, null, ALL), 'abcdef012345', broken, LOCAL_OK, null, 200, 'read').split('\n')[1])
      .toBe('E18 walls: 5 of 7 hold, 1 does not hold, 1 not measured; teardown signal differs from desktop');
  });

  it('the door line names a console request without the cookie, and a final read that found the run gone', () => {
    const run = runWith({ ...HEALTHY, 'cookie-console': { hits: 1, cookie: 0 } }, { counted: 140 });
    const last = formatLabResult(deviceOf('x', null, ALL), 'abcdef012345', labVerdicts(run, LOCAL_OK, 200), LOCAL_OK, run, 200, 'unknown-run')
      .split('\n').pop();
    expect(last).toBe('door: 140 counted, 0 ignored; no session cookie (sign-in gate off?); final read found the run gone, counts as of the hostile step');
  });
});
