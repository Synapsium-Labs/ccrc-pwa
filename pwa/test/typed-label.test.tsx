// The name was written by a model; it arrives the way a model writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SessionLine } from '../src/fleet/SessionLine';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';
import { TYPE_MS, TypedLabel } from '../src/fleet/TypedLabel';

// framer-motion's useReducedMotion caches its matchMedia answer in module state
// on first use, so a `vi.stubGlobal('matchMedia', …)` after the fact is not
// reliably observed — and setup.ts:7's shim already answers `matches: false` to
// every query, which pins only one of the two branches. Mocking the single
// export this component uses makes both deterministic; the same move
// test/chat.test.tsx:16 makes for react-virtuoso. Vitest hoists `vi.hoisted`
// and `vi.mock` above the imports, which is why the holder is reachable here.
// SessionLine's own subtree imports no framer-motion, so the mock reaches
// nothing else.
const { motionPref } = vi.hoisted(() => ({ motionPref: { reduced: false } }));
vi.mock('framer-motion', () => ({ useReducedMotion: () => motionPref.reduced }));

afterEach(() => { cleanup(); vi.useRealTimers(); motionPref.reduced = false; });

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, ...over,
});

describe('TypedLabel', () => {
  it('is silent on first mount — the whole value, immediately', () => {
    render(<TypedLabel text="ws/quiet-mesa" className="sess-label" />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).toBeNull();
  });

  it('streams a CHANGED value in, character by character, then settles', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/quiet-mesa" />);
    rerender(<TypedLabel text="ws/fix-the-pr-sheet" />);

    // Mid-flight: a prefix, and a caret to say it is still arriving.
    act(() => { vi.advanceTimersByTime(TYPE_MS * 6); });
    const el = document.querySelector('span')!;
    expect(el.textContent!.startsWith('ws/fix')).toBe(true);
    expect(el.textContent).not.toContain('sheet');
    const caret = document.querySelector('.typed-caret');
    expect(caret).not.toBeNull();
    // Pinned: the caret is decoration, never announced on its own — its
    // ancestor's aria-hidden wrapper already covers it, but this is the
    // property that must hold regardless of where it sits in that tree.
    expect(caret!.getAttribute('aria-hidden')).toBe('true');

    act(() => { vi.advanceTimersByTime(TYPE_MS * 'ws/fix-the-pr-sheet'.length); });
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret'), 'the caret goes when the value has landed').toBeNull();
  });

  it('the settled value is ONE text node, so getByText still finds it', () => {
    // Not decoration: header.test.tsx:502 reads the crumb through
    // getAllByText and asserts length 1, and getNodeText concatenates direct
    // TEXT-node children only. The text node lives one level down from
    // `.chat-crumb` now (inside the `aria-hidden` wrapper — see the component
    // docstring's ACCESSIBLE NAME section), so `.chat-crumb` itself carries no
    // direct text node any more; a per-character split into sibling spans
    // would still make BOTH queries below find nothing, which is what they
    // pin against.
    render(<TypedLabel text="ws/quiet-mesa" className="chat-crumb" />);
    const root = document.querySelector('.chat-crumb')!;
    expect([...root.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(0);
    const hidden = root.querySelector(':scope > [aria-hidden]')!;
    expect([...hidden.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(1);
  });

  // Review finding 8. The wrapper's whole reason to exist: the root's
  // computed accessible name must be the FULL target text from the first
  // frame, not `shown` (which starts at `''` the instant a rename begins,
  // then grows one character per tick) — see TypedLabel's ACCESSIBLE NAME
  // docstring section.
  it('aria-label on the root carries the FULL value, even on the first frame of a change', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/quiet-mesa" className="sess-label" />);
    rerender(<TypedLabel text="ws/fix-the-pr-sheet" className="sess-label" />);

    // Before a single timer tick: `shown` has already reset to '', but the
    // root's aria-label must already say the FULL new name.
    const root = document.querySelector('.sess-label')!;
    expect(root.getAttribute('aria-label')).toBe('ws/fix-the-pr-sheet');
    // `shown` is '' at this instant — only the caret glyph is visible, none
    // of the new name yet — while the label above already says the whole word.
    expect(root.querySelector(':scope > [aria-hidden]')?.textContent).toBe('▏');

    act(() => { vi.advanceTimersByTime(TYPE_MS * 6); });
    // Mid-flight: the label kept its full name; only the hidden text grew.
    expect(root.getAttribute('aria-label')).toBe('ws/fix-the-pr-sheet');

    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });
    expect(root.getAttribute('aria-label')).toBe('ws/fix-the-pr-sheet');
  });

  it('reduced motion swaps instantly and never renders a caret', () => {
    motionPref.reduced = true;
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/quiet-mesa" />);
    rerender(<TypedLabel text="ws/fix-the-pr-sheet" />);
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).toBeNull();
  });

  it('a value that changes mid-flight retargets rather than interleaving', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TypedLabel text="ws/a" />);
    rerender(<TypedLabel text="ws/first-guess" />);
    act(() => { vi.advanceTimersByTime(TYPE_MS * 4); });
    rerender(<TypedLabel text="ws/second-guess" />);
    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });
    expect(screen.getByText('ws/second-guess')).toBeInTheDocument();
  });
});

describe('the fleet line', () => {
  it('types the new branch in when a rename lands', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SessionLine session={s({ branch: 'ws/quiet-mesa' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();

    rerender(<SessionLine session={s({ branch: 'ws/fix-the-pr-sheet' })} onOpen={() => {}} onActions={() => {}} />);
    // Mid-flight, before advancing a single timer: a plain span reverting this
    // feature would already show the whole new value and would never grow a
    // caret. Both assertions exist to fail against exactly that revert — every
    // assertion below this point is also true of a plain span, so it cannot
    // pin the animation on its own.
    expect(screen.queryByText('ws/fix-the-pr-sheet')).toBeNull();
    expect(document.querySelector('.typed-caret')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
  });

  // Review finding 8. `.sess-open` is a `<button>` whose only content is
  // `TypedLabel` — before the aria-label fix its accessible name replayed
  // `shown`'s own animation: empty on the frame the rename lands (before the
  // interval's first tick), then a growing prefix, landing on the full name
  // only once the caret was gone. `getByRole`'s `name` option computes the
  // REAL accessible name (aria-label wins over content), so this fails
  // against that regression the way a `textContent` check could not.
  it('.sess-open’s accessible name is the full new branch on every frame, never empty or partial', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SessionLine session={s({ branch: 'ws/quiet-mesa' })} onOpen={() => {}} onActions={() => {}} />);

    rerender(<SessionLine session={s({ branch: 'ws/fix-the-pr-sheet' })} onOpen={() => {}} onActions={() => {}} />);
    // Frame zero: `shown` has already reset to '' but nothing has ticked yet.
    expect(screen.getByRole('button', { name: 'ws/fix-the-pr-sheet' })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(TYPE_MS * 6); });   // mid-flight
    expect(screen.getByRole('button', { name: 'ws/fix-the-pr-sheet' })).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).not.toBeNull();   // still animating

    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });   // settled
    expect(screen.getByRole('button', { name: 'ws/fix-the-pr-sheet' })).toBeInTheDocument();
  });

  it('a session with a human-chosen name does not animate on a rename', () => {
    // sessionLabel is `name ?? branch ?? …`, and the server only ships a `name`
    // a human chose (fleet.ts:128 drops Claude Code's derived handles). A rename
    // under a chosen name changes nothing on screen, by design.
    vi.useFakeTimers();
    const { rerender } = render(
      <SessionLine session={s({ name: 'refactor-auth', branch: 'ws/quiet-mesa' })}
                   onOpen={() => {}} onActions={() => {}} />);
    rerender(<SessionLine session={s({ name: 'refactor-auth', branch: 'ws/fix-the-pr-sheet' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('refactor-auth')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret')).toBeNull();
  });
});

// The spec names this mount point explicitly (design doc :293, "Mounted at
// the fleet line and the session header crumb") and nothing above exercises
// it — `header.test.tsx` only reads settled text (`toHaveTextContent`,
// `getAllByText`), which is identical whether the crumb is a plain span or a
// wrapped one. This is the header's half of the fleet-line case above.
describe('the session header crumb', () => {
  const headerProps = (session: FleetSession): SessionHeaderProps => ({
    session, status: 'idle', statusUpdatedAt: null,
    onInterrupt: () => {}, onOpenTerminal: () => {}, onBack: () => {},
    onChangeModel: () => {}, onChangeEffort: () => {}, onMoveAccount: () => {},
    onStopSession: () => {}, onReapWorkspace: () => {},
  });

  it('types the new branch in on the crumb when a rename lands', () => {
    // workspace non-null, so the crumb renders at all (SessionHeader.tsx:191).
    vi.useFakeTimers();
    const { rerender, container } = render(
      <SessionHeader {...headerProps(s({ workspace: 'quiet-mesa', branch: 'ws/quiet-mesa' }))} />);
    expect(container.querySelector('.chat-crumb')).toHaveTextContent('ws/quiet-mesa');

    rerender(<SessionHeader {...headerProps(s({ workspace: 'quiet-mesa', branch: 'ws/fix-the-pr-sheet' }))} />);
    // Mid-flight: a plain span would already show the whole new value and
    // would never grow a caret — both false here, exactly as on the fleet line.
    expect(container.querySelector('.chat-crumb')).not.toHaveTextContent('ws/fix-the-pr-sheet');
    expect(document.querySelector('.typed-caret')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(TYPE_MS * 40); });
    expect(container.querySelector('.chat-crumb')).toHaveTextContent('ws/fix-the-pr-sheet');
    expect(document.querySelector('.typed-caret')).toBeNull();
  });
});
