// Console speed, Task C3 (spec 2026-11-04 §2.5, D15): the reload gate's pure decision. The operator's ruling on
// item 33: "Reload when you next move between screens, never in the first seconds back." A new worker's activation
// only marks a reload as pending; the reload runs at the next move between screens once the page has been visible
// for RELOAD_QUIET_MS; the block screen and a lazy chunk that fails while one is pending reload at once.
import { describe, expect, it } from 'vitest';
import {
  RELOAD_IDLE, RELOAD_QUIET_MS, reloadStep, screenOf, type ReloadEvent, type ReloadState,
} from '../src/lib/reloadGate';

const T0 = 1_000_000;
const move = (from: string, to: string): ReloadEvent => ({ kind: 'move', from, to });

/** A page visible since T0 with a reload pending. */
const pending: ReloadState = { pending: true, urgent: false, visibleSince: T0 };

describe('reloadStep: when a pending reload runs (Task C3)', () => {
  it('an activation alone never reloads', () => {
    const r = reloadStep({ ...RELOAD_IDLE, visibleSince: T0 }, { kind: 'activated' }, T0 + 60_000);
    expect(r.reload).toBe(false);
    expect(r.state.pending).toBe(true);
  });

  it('a move with nothing pending never reloads', () => {
    const r = reloadStep({ ...RELOAD_IDLE, visibleSince: T0 }, move('/', '/runs'), T0 + 60_000);
    expect(r.reload).toBe(false);
    expect(r.state.pending).toBe(false);
  });

  it('a move 15 s after a return reloads, and 14.999 s after holds', () => {
    expect(RELOAD_QUIET_MS).toBe(15_000);
    expect(reloadStep(pending, move('/', '/runs'), T0 + 15_000).reload).toBe(true);
    expect(reloadStep(pending, move('/', '/runs'), T0 + 14_999).reload).toBe(false);
  });

  it('a move in the first 15 s back holds and stays pending', () => {
    const r = reloadStep(pending, move('/', '/runs'), T0 + 5_000);
    expect(r.reload).toBe(false);
    expect(r.state).toEqual(pending);
  });

  it('a hidden page holds, and a negative age holds', () => {
    const hidden: ReloadState = { ...pending, visibleSince: null };
    expect(reloadStep(hidden, move('/', '/runs'), T0 + 600_000).reload).toBe(false);
    expect(reloadStep(pending, move('/', '/runs'), T0 - 1).reload).toBe(false);
  });

  it('a Docs page turn, a search-only change and the same session are not moves', () => {
    const later = T0 + 60_000;
    expect(reloadStep(pending, move('/docs/a', '/docs/b'), later).reload).toBe(false);
    // The gate is handed pathnames, so a search-only change arrives as the same path.
    expect(reloadStep(pending, move('/accounts', '/accounts'), later).reload).toBe(false);
    expect(reloadStep(pending, move('/s/a', '/s/a/'), later).reload).toBe(false);
  });

  it('another session, another item and another top route are moves', () => {
    const later = T0 + 60_000;
    expect(reloadStep(pending, move('/s/a', '/s/b'), later).reload).toBe(true);
    expect(reloadStep(pending, move('/waiting/1', '/waiting/2'), later).reload).toBe(true);
    expect(reloadStep(pending, move('/', '/runs'), later).reload).toBe(true);
  });

  it('urgent with a pending reload reloads at once, and an activation after urgent reloads at once', () => {
    // Inside the quiet window: the block screen has nothing to read behind it.
    const a = reloadStep(pending, { kind: 'urgent' }, T0 + 1);
    expect(a.reload).toBe(true);
    expect(a.state.urgent).toBe(true);
    const visibleIdle: ReloadState = { ...RELOAD_IDLE, visibleSince: T0 };
    const u = reloadStep(visibleIdle, { kind: 'urgent' }, T0);
    expect(u.reload, 'urgent with nothing pending waits for the new worker').toBe(false);
    expect(u.state).toEqual({ ...visibleIdle, urgent: true });
    const b = reloadStep(u.state, { kind: 'activated' }, T0 + 1);
    expect(b.reload).toBe(true);
    expect(b.state.pending).toBe(true);
  });

  it('a hidden page holds every arm, and its return runs an urgent reload', () => {
    // The brief's rule: no reload while the page is hidden, the two at-once cases included.
    const hiddenPending: ReloadState = { ...pending, visibleSince: null };
    const u = reloadStep(hiddenPending, { kind: 'urgent' }, T0 + 1);
    expect(u.reload).toBe(false);
    expect(reloadStep({ ...RELOAD_IDLE, urgent: true }, { kind: 'activated' }, T0 + 1).reload).toBe(false);
    expect(reloadStep(hiddenPending, { kind: 'chunk-failed' }, T0 + 1).reload).toBe(false);
    expect(reloadStep(u.state, { kind: 'visible', at: T0 + 9 }, T0 + 9).reload, 'urgent and pending: at once on return').toBe(true);
    expect(reloadStep(hiddenPending, { kind: 'visible', at: T0 + 9 }, T0 + 9).reload, 'pending alone waits for a move').toBe(false);
  });

  it('a failed chunk reloads only while pending', () => {
    expect(reloadStep(pending, { kind: 'chunk-failed' }, T0 + 1).reload).toBe(true);
    expect(reloadStep({ ...RELOAD_IDLE, visibleSince: T0 }, { kind: 'chunk-failed' }, T0 + 60_000).reload).toBe(false);
  });

  it('visible restarts the window, hidden clears it', () => {
    const hid = reloadStep(pending, { kind: 'hidden' }, T0 + 30_000);
    expect(hid.reload).toBe(false);
    expect(hid.state.visibleSince).toBeNull();
    expect(reloadStep(hid.state, move('/', '/runs'), T0 + 40_000).reload, 'a hidden page holds').toBe(false);
    const back = reloadStep(hid.state, { kind: 'visible', at: T0 + 50_000 }, T0 + 50_000);
    expect(back.reload).toBe(false);
    expect(back.state.visibleSince).toBe(T0 + 50_000);
    expect(reloadStep(back.state, move('/', '/runs'), T0 + 55_000).reload, 'the window restarted').toBe(false);
    expect(reloadStep(back.state, move('/', '/runs'), T0 + 65_000).reload).toBe(true);
  });

  it('a step never clears pending', () => {
    const events: ReloadEvent[] = [
      { kind: 'hidden' }, { kind: 'visible', at: T0 }, move('/', '/runs'), { kind: 'chunk-failed' }, { kind: 'urgent' },
    ];
    for (const e of events) expect(reloadStep(pending, e, T0 + 60_000).state.pending, e.kind).toBe(true);
  });
});

describe('screenOf: the screen a path is on (Task C3)', () => {
  it('names the route and its parameter', () => {
    expect(screenOf('/')).toBe('fleet ');
    expect(screenOf('/s/a')).toBe('session a');
    expect(screenOf('/s/a/')).toBe('session a');
    expect(screenOf('/docs/a/b')).toBe('docs ');
    expect(screenOf('/waiting/7')).toBe('item 7');
  });

  it('screenOf answers none for a path outside the table', () => {
    expect(screenOf('/nowhere/at/all')).toBe('none');
    expect(screenOf('/s/%zz')).toBe('none');
  });
});
