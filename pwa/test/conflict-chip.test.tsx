// The predicted-conflict chip (landing order wave 4b; D-7480, D-7481, Review Focus 5): read-only, plain, and silent
// without a fresh landing. Absence is "unknown", so an older server, a cached row and an old snapshot row render nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SessionLanding } from '../../shared/api';
import { ConflictChip } from '../src/fleet/ConflictChip';
import { fleetSession } from './fleetFixture';

afterEach(cleanup);

const landing = (over: Partial<SessionLanding> = {}): SessionLanding => ({
  at: new Date(Date.now() - 30_000).toISOString(), pr: 12, head: 'abc1234', baseRef: 'main',
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
    const old = landing({ at: new Date(Date.now() - 1201_000).toISOString() });
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

  it('has no button, no link and no handler: it is a reading, not a control', () => {
    const { container } = render(<ConflictChip sessions={[fleetSession({ id: 'a', landing: landing() })]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('a, button, [onclick], [tabindex]')).toBeNull();
  });
});
