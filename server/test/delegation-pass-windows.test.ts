// Delegation broker, the pass's window list (D-5643): the reconcile lane builds ONE list of listing windows per pass and hands the very same
// window objects, and the very same listings inside them, to every census tree's input. The correlation module keys what it computes once
// per pass (a window's delta and parsed span, the indexes over the list) on those objects, so a window that could be changed after it is
// built, or a list that could grow after it is handed over, would let a memo answer for something that is no longer there. The builders
// therefore return windows that cannot change, and the list is built by one pure function that freezes it.
//
//   D-5643 R1, the freeze. A window from `delegationListingWindowsOf` is frozen, and so are its `before` and `after` (which ARE the hook
//      events' own `listing` arrays: the freeze is on those arrays themselves); so are a lost hour's window, the retention floor and the
//      not-ready window, with their `before`; `delegationPassWindowsOf` returns the pass's list frozen and holding exactly the windows it was
//      given, in the lane's order; and a write to any of them throws.
//
// Fixtures only: names are `lane-a-demo`, `project-a`, `/fixture/...`. No file is read or written.
import { describe, it, expect } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import type { DelegationListingWindow } from '../src/coord/delegation-correlation.js';
import { delegationSha256Hex, formatDelegationInstant } from '../src/coord/delegation-model.js';
import { delegationListingWindowsOf, delegationLostWindowsOf, delegationNotReadyWindowOf, delegationPassWindowsOf } from '../src/watch.js';

// ── fixtures (the style of delegation-correlation-cost.test.ts, copied: a test file imports no other test file) ────────

const PARENT = 'lane-a-demo';
const INC = 'g1';
const REPO = 'project-a';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);

const mkBase = (n: number) => ({
  v: 1 as const, observedAt: T(n), sessionId: PARENT, parentIncarnation: INC, claudeSessionId: CLAUDE,
  eventId: delegationSha256Hex(`fixture-pass-windows-event-${n}`), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
const bashPre = (n: number, toolUseId: string, listing: readonly string[]): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing });
const bashPost = (n: number, toolUseId: string, listing: readonly string[]): DelegationEventEnvelopeV1 =>
  ({ ...mkBase(n), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing });

const projectOf = (sessionId: string): string | undefined => (sessionId === PARENT ? REPO : undefined);
/** One lost hour of one owner: the interval row `delegationLostWindowsOf` turns into a window on every repository. */
const lostHour = { sessionId: PARENT, parentIncarnation: INC, utcHour: '2026-10-14T10:00:00.000Z', state: 'unmeasured' as const, detail: 'range-unreadable: x', recordedAt: '2026-10-14T10:30:00.000Z' };
const NOW = Date.UTC(2026, 9, 14, 12);

/** A window built from a Bash call's two ends, whose listings are the events' own arrays. */
function listingWindow() {
  const pre = bashPre(1, 'toolu_one', ['main-wt']);
  const post = bashPost(2, 'toolu_one', ['main-wt', 'wt-raw-1']);
  const windows = delegationListingWindowsOf([pre, post], projectOf);
  expect(windows.length).toBe(1);
  return { pre, post, window: windows[0]! };
}
/** The lane's lost-hour window and its retention floor (the last window `delegationLostWindowsOf` returns). */
function lostWindows() {
  const windows = delegationLostWindowsOf([lostHour], [], NOW);
  expect(windows.length, 'one lost hour and the retention floor').toBe(2);
  return { hour: windows[0]!, floor: windows[windows.length - 1]! };
}

describe('D-5643 R1: the lane\'s windows, their listings and the pass\'s window list are frozen', () => {
  it('a window from the listing builder is frozen, and so are its before and after, which are the hook events\' own listing arrays', () => {
    const { pre, post, window } = listingWindow();
    expect(Object.isFrozen(window), 'the window').toBe(true);
    expect(Object.isFrozen(window.before), 'its before').toBe(true);
    expect(Object.isFrozen(window.after), 'its after').toBe(true);
    expect(window.before, 'before IS the PreToolUse listing').toBe(pre.listing);
    expect(window.after, 'after IS the PostToolUse listing').toBe(post.listing);
    expect(Object.isFrozen(pre.listing), 'the event\'s own PreToolUse listing').toBe(true);
    expect(Object.isFrozen(post.listing), 'the event\'s own PostToolUse listing').toBe(true);
  });

  it('a window with no after-listing, and a shed one, are frozen too', () => {
    const open = delegationListingWindowsOf([bashPre(1, 'toolu_open', ['main-wt'])], projectOf)[0]!;
    expect(open.after, 'no PostToolUse yet').toBeNull();
    expect(Object.isFrozen(open), 'the window').toBe(true);
    expect(Object.isFrozen(open.before), 'its before').toBe(true);
    const shedPre = { ...mkBase(3), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 'toolu_shed', truncated: true } as DelegationEventEnvelopeV1;
    const shed = delegationListingWindowsOf([shedPre], projectOf)[0]!;
    expect(shed.lost, 'a pre that shed its listing is lost').toBe(true);
    expect(Object.isFrozen(shed), 'the window').toBe(true);
    expect(Object.isFrozen(shed.before), 'its before').toBe(true);
  });

  it('a lost hour\'s window, the retention floor and the not-ready window are frozen, and so is each one\'s before', () => {
    const { hour, floor } = lostWindows();
    const notReady = delegationNotReadyWindowOf(Date.UTC(2026, 9, 14));
    const openNotReady = delegationNotReadyWindowOf(null);
    for (const [what, w] of [['the lost hour', hour], ['the retention floor', floor], ['the not-ready window', notReady], ['the open-ended not-ready window', openNotReady]] as const) {
      expect(w.lost, `${what} is lost evidence`).toBe(true);
      expect(Object.isFrozen(w), `${what}`).toBe(true);
      expect(Object.isFrozen(w.before), `${what}: its before`).toBe(true);
    }
  });

  it('the pass\'s list is frozen and holds the listing windows, the lost ones, the not-ready window and the pending ones, in that order', () => {
    const { window } = listingWindow();
    const { hour, floor } = lostWindows();
    const notReady = delegationNotReadyWindowOf(Date.UTC(2026, 9, 14));
    const pending = delegationListingWindowsOf([bashPre(5, 'toolu_pending', ['main-wt'])], projectOf);
    expect(pending.length).toBe(1);
    const list = delegationPassWindowsOf([window], [hour, floor], notReady, pending);
    expect(Object.isFrozen(list), 'the list').toBe(true);
    const expected: readonly DelegationListingWindow[] = [window, hour, floor, notReady, pending[0]!];
    expect(list.length).toBe(expected.length);
    expected.forEach((w, i) => expect(list[i], `the window at index ${i}`).toBe(w));
  });

  it('an empty pass still has a frozen list, holding the not-ready window alone', () => {
    const notReady = delegationNotReadyWindowOf(null);
    const list = delegationPassWindowsOf([], [], notReady, []);
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.length).toBe(1);
    expect(list[0]).toBe(notReady);
  });

  it('writes throw: a push to the list, a field of a window, and a push to a window\'s listing', () => {
    const { window } = listingWindow();
    const { hour, floor } = lostWindows();
    const notReady = delegationNotReadyWindowOf(Date.UTC(2026, 9, 14));
    const list = delegationPassWindowsOf([window], [hour, floor], notReady, []);
    expect(() => (list as DelegationListingWindow[]).push(window), 'a push to the list').toThrow(TypeError);
    expect(() => { (list as DelegationListingWindow[])[0] = hour; }, 'an assignment to the list').toThrow(TypeError);
    for (const [what, w] of [['a listing window', window], ['a lost hour', hour], ['the retention floor', floor], ['the not-ready window', notReady]] as const) {
      expect(() => { (w as { repository: string | null }).repository = 'x'; }, `${what}: a field`).toThrow(TypeError);
      expect(() => (w.before as string[]).push('x'), `${what}: a push to its before`).toThrow(TypeError);
    }
    expect(() => (window.after as string[]).push('x'), 'a push to a listing window\'s after').toThrow(TypeError);
  });
});
