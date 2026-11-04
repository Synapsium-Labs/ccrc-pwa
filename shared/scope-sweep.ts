// D-7993, D-7994 (plan docs/superpowers/plans/2026-11-03-scope-sweep-busy-orphans.md). The L0 half of the Settings card
// over `ccd-scope-sweep`'s two switches: the wire view, its one reader over a registry listing, and the words the PWA's
// Automation card shows. The sweep reads its markers itself, so nothing here decides what it does. L0: the PWA bundles
// `shared/`, so this file takes no `node:` module. It sits outside `shared/api.ts` for `stall-watch.ts`'s reason: other
// programmes append at that file's foot.
import type { MarkerState } from './api.js';
import { readSwitches, SCOPE_SWEEP_BUSY_LIVE_MARKER, SCOPE_SWEEP_LIVE_MARKER } from './switches.js';

/** What the registry says of the two switches (`GET /api/coord/scope-sweep`). `unmeasurable` is a registry that could
 *  not be listed, and is never read as off. */
export interface ScopeSweepView { readonly stop: MarkerState; readonly busy: MarkerState }

/** The view of one registry listing, through the switch table's one reader. */
export function scopeSweepViewOf(listing: readonly string[] | null): ScopeSweepView {
  const s = readSwitches(listing);
  return { stop: s[SCOPE_SWEEP_LIVE_MARKER], busy: s[SCOPE_SWEEP_BUSY_LIVE_MARKER] };
}

/** `POST /api/coord/scope-sweep`'s body: the busy arm's switch. `scope-sweep-live` has no writer here. */
export interface ScopeSweepBusyRequest { on: boolean }

/** The codes the POST refuses with before running anything, spelled once. A `fleetFailed` is the verb's own refusal only
 *  when it carries the verb's `stderr`: without one the verb never ran, and whether the switch moved is unmeasured. */
export const SCOPE_SWEEP_REFUSALS = ['bad-request', 'unsupported'] as const;
export function isScopeSweepRefusal(error: unknown, stderr: unknown): boolean {
  return (SCOPE_SWEEP_REFUSALS as readonly unknown[]).includes(error) || (error === 'fleetFailed' && typeof stderr === 'string' && stderr.trim() !== '');
}

/** The busy arm's two choices, as the card's radios spell them. */
export const SCOPE_SWEEP_BUSY_CHOICES = ['off', 'on'] as const;
export type ScopeSweepBusyChoice = (typeof SCOPE_SWEEP_BUSY_CHOICES)[number];
export function isScopeSweepBusyChoice(v: unknown): v is ScopeSweepBusyChoice {
  return typeof v === 'string' && (SCOPE_SWEEP_BUSY_CHOICES as readonly string[]).includes(v);
}

/** Every word the card shows. */
export const SCOPE_SWEEP_TEXT = {
  title: 'Leftover processes',
  purpose: 'What happens to the processes a session leaves running after its pane is gone. Checked every minute on the '
    + 'fleet box, and at most three scopes are stopped a minute.',
  idleLead: 'Idle leftovers',
  idleOn: 'Stopped after six hours.',
  idleOff: 'Recorded only. Nothing is stopped.',
  idleUnread: 'Could not be read.',
  legend: 'Busy leftovers',
  off: 'Record only',
  offNote: 'Loops and servers left by a dead session are listed by the doctor, with what would be stopped. Nothing is stopped.',
  on: 'Stop them',
  onNote: 'A busy scope is stopped once its session has been stopped or gone for six hours. A session that is running, '
    + 'and anything another session is connected to, are left alone.',
  when: 'Read the doctor\'s scope-sweep lines for about a week before turning this on.',
  needsIdle: 'This has no effect until idle leftovers are being stopped.',
  unmeasured: 'The fleet box could not be read, so which of these is on is not known.',
  unread: 'This could not be read.',
  stale: 'This may be out of date: the last read failed.',
  refused: 'The fleet box refused the change.',
  unanswered: 'The change was not confirmed.',
} as const;
