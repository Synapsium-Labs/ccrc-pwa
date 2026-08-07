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
  bucket: 'idle', bucketSince: null, ...over,
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
    expect(document.querySelector('.typed-caret')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(TYPE_MS * 'ws/fix-the-pr-sheet'.length); });
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
    expect(document.querySelector('.typed-caret'), 'the caret goes when the value has landed').toBeNull();
  });

  it('the settled value is ONE text node, so getByText still finds it', () => {
    // Not decoration: header.test.tsx:502 reads the crumb through
    // getAllByText and asserts length 1, and getNodeText concatenates direct
    // TEXT-node children only. A per-character split into sibling spans would
    // make that query find nothing.
    render(<TypedLabel text="ws/quiet-mesa" className="chat-crumb" />);
    const el = document.querySelector('.chat-crumb')!;
    expect([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(1);
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
