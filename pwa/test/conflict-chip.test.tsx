// The predicted-conflict chip (landing order wave 4b; D-7480, D-7481, Review Focus 5): read-only, plain, and silent
// without a fresh landing. Absence is "unknown", so an older server, a cached row and an old snapshot row render nothing.
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SessionLanding } from '../../shared/api';
import { ConflictChip } from '../src/fleet/ConflictChip';
import { fleetSession } from './fleetFixture';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const landing = (over: Partial<SessionLanding> = {}): SessionLanding => ({
  at: new Date(Date.now() - 30_000).toISOString().replace(/\.\d{3}Z$/, 'Z'), pr: 12, head: 'abc1234', baseRef: 'main',
  base: { state: 'clean' }, paired: true, conflicts: [], unmeasuredWith: [],
  cut: { heads: false, pairs: false, unbound: false },
  ...over,
});

describe('ConflictChip', () => {
  it('renders nothing with no session, and nothing when no session carries a landing (an older server)', () => {
    expect(render(<ConflictChip sessions={[]} />).container).toBeEmptyDOMElement();
    cleanup();
    expect(render(<ConflictChip sessions={[fleetSession({ id: 'a' })]} />).container).toBeEmptyDOMElement();
  });

  it('renders nothing for a snapshot row whose landing is past the window', () => {
    const old = landing({ at: new Date(Date.now() - 1201_000).toISOString().replace(/\.\d{3}Z$/, 'Z') });
    expect(render(<ConflictChip sessions={[fleetSession({ id: 'a', landing: old })]} />).container).toBeEmptyDOMElement();
  });

  it('renders nothing for a malformed landing', () => {
    const bad = { at: 'x' } as unknown as SessionLanding;
    expect(render(<ConflictChip sessions={[fleetSession({ id: 'a', landing: bad })]} />).container).toBeEmptyDOMElement();
  });

  it('has its word, role="status" and an accessible name and title that are the one sentence', () => {
    const l = landing({ conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }] });
    render(<ConflictChip sessions={[fleetSession({ id: 'a', landing: l })]} />);
    const chip = screen.getByRole('status', { name: /PRs #12 and #14 conflict in src\/x\.ts/ });
    expect(chip).toHaveTextContent('1 predicted conflict');
    expect(chip).toHaveAttribute('data-state', 'conflict');
    expect(chip.getAttribute('title')).toBe(chip.getAttribute('aria-label'));
    expect(chip.getAttribute('title')).toMatch(/measured \d\d:\d\d$/);
  });

  it('says "No predicted conflicts" of a clean landing, in its own state', () => {
    render(<ConflictChip sessions={[fleetSession({ id: 'a', landing: landing() })]} />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('No predicted conflicts in 1 measured PR');
    expect(chip).toHaveAttribute('data-state', 'clean');
  });

  // R2 (review 1225, F3): the chip ages a landing by the later of `useNow`'s stored clock and the clock of the render itself.
  // Fixed second-aligned instants and a faked Date alone (the 30 s interval never fires), so only the render's own read
  // of the clock can move the age.
  describe('the chip ages by the time it renders', () => {
    const T0 = Date.parse('2026-10-27T09:00:00Z');
    const stamp = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const row = (at: string) => fleetSession({ id: 'a', landing: landing({ at }) });

    it('a landing stamped 2 h old, first seen after a 3 h gap with no landing before it, is in no render commit', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      const commits: string[] = [];
      const view = (sessions: ReturnType<typeof fleetSession>[]) => (
        <Profiler id="chip" onRender={() => commits.push(document.body.textContent ?? '')}><ConflictChip sessions={sessions} /></Profiler>
      );
      const { rerender } = render(view([fleetSession({ id: 'a' })]));    // no landing: the stored clock stands at T0
      vi.setSystemTime(T0 + 3 * 3600_000);
      rerender(view([row(stamp(T0 + 3 * 3600_000 - 2 * 3600_000))]));
      expect(commits.length, 'the rerender committed').toBeGreaterThan(1);
      expect(commits.filter((t) => /predicted conflict|measured/.test(t)), 'a past-window landing reached a commit').toEqual([]);
    });

    it('a landing 1190 s old, the clock 29 s on and the stored clock not yet ticked: not "No predicted conflicts"', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      const at = stamp(T0 - 1190_000);
      const { container, rerender } = render(<ConflictChip sessions={[row(at)]} />);
      expect(container).toHaveTextContent('No predicted conflicts in 1 measured PR');   // inside the window at T0
      vi.setSystemTime(T0 + 29_000);                                                      // now 1219 s old
      rerender(<ConflictChip sessions={[row(at)]} />);
      expect(container.textContent ?? '').not.toContain('No predicted conflicts');
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('has no button, no link and no handler: it is a reading, not a control', () => {
    const { container } = render(<ConflictChip sessions={[fleetSession({ id: 'a', landing: landing() })]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('a, button, [onclick], [tabindex]')).toBeNull();
  });
});
