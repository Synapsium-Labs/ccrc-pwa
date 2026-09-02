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
  hookState: null, askSummary: null, subagents: null, graphQueries: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
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
    onStopSession: () => {}, onOpenHistory: () => {}, onReapWorkspace: () => {},
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

// Wave 3 §3.1's visual consequence, pinned rather than left in a docstring.
// `sessionLabel` is `name ?? branch ?? workspace ?? id`, and the naming sweep
// no longer renames a claimed workspace — so for the whole life of a claim a
// worker row reads `ws/<slug>`, not the ai-title it would have grown before
// this wave. This is the widest-reaching visual change in the build and it is
// the intended trade: a stable name a ledger can cite beats a prettier one
// that moves under it.
//
// REVIEW FINDING, WAVE 3: WHAT THE PWA CAN AND CANNOT MEASURE HERE. The first
// version of this block set `held` on its fixture, which read as though the
// hold were what produced the born name. It is not — `sessionLabel` never
// reads `held`, so the assertion was identical with `held: null` and a later
// reader would have believed in a coupling that does not exist.
//
// The freeze lives on the OTHER BOX and on the server, in two places, and both
// are pinned there, not here:
//   - `server/src/watch.ts`'s naming sweep skips a row that is held or that an
//     open run names — `server/test/name-sweep.test.ts` ("skips on an EMPTY
//     hold file too", "skips a row an OPEN RUN names").
//   - `ccd ws-rename` refuses a held workspace outright —
//     `server/test/ccd-ws-rename.test.ts` ("refuses a HELD workspace…",
//     "refuses on a present-but-unreadable hold").
// The PWA MIRRORS that freeze; it does not enforce it, and the tests below now
// say which of the two they are measuring.
//
// AND THE MIRROR IS NOT PERFECT, which is the part worth knowing: the label
// follows `FleetSession.branch`, and `server/src/fleet.ts` assembles that as
// `sl?.branch ?? r.branch` — THE STATUSLINE WINS. §3.1 froze the registry's
// `.branch` and the verb that writes it; a human running `git checkout -b`
// inside the worktree still moves this label mid-claim, because that is a live
// pane capture and no hold is consulted. `watch.ts`'s sweep guards against
// exactly that confusion by reading the registry's branch rather than the
// assembled one (its own comment says so); a fleet row has no such option.
describe('a claimed worker keeps its born name (W3 §3.1)', () => {
  const HOLD = 'program:build8 wave:2/4 run:17';

  it('labels a claimed workspace by its born branch, not by any title', () => {
    // The consequence a reader sees, and a genuine regression pin on
    // `sessionLabel`'s fallback chain: with no chosen `name`, `branch` wins,
    // and §3.1 is what keeps `branch` at the born value for a whole wave.
    const held = s({ name: null, branch: 'ws/quiet-mesa', workspace: 'quiet-mesa', held: HOLD });
    render(<SessionLine session={held} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();
  });

  it('the hold is not the label — a held row reads exactly like the same row unheld', () => {
    // This is what the old fixture only LOOKED like it measured. `held` is a
    // real input to the row (the chip renders it), and the statement being
    // pinned is that it is not an input to the NAME: the two renders differ in
    // `held` and in nothing else, and the label is the same string.
    //
    // It also pins the answer to the open question `sessionLabel`'s docstring
    // raises out loud — whether a claimed row should read its run's
    // program/wave instead of the slug. Today it does not. That is a product
    // decision, so if someone answers it, this test goes red and the answer
    // gets recorded rather than slipped in.
    const base = { name: null, branch: 'ws/quiet-mesa', workspace: 'quiet-mesa' } as const;
    const { container } = render(
      <SessionLine session={s({ ...base, held: HOLD })} onOpen={() => {}} onActions={() => {}} />);
    const heldLabel = container.querySelector('.sess-label')?.textContent;
    cleanup();
    const { container: c2 } = render(
      <SessionLine session={s({ ...base, held: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(heldLabel).toBe(c2.querySelector('.sess-label')?.textContent);
    expect(heldLabel).toBe('ws/quiet-mesa');
    expect(heldLabel).not.toContain('program:build8');
  });

  it('a chosen name still wins on a claimed row — the PWA mirrors the freeze, it does not enforce it', () => {
    // The honest limit of this file. If the freeze upstream ever fails — a
    // sweep gate deleted, a hand `ws-rename`, a manual checkout the statusline
    // reports — the fleet row shows the drifted name, faithfully, because
    // `name` outranks `branch` and nothing here consults the hold. A test that
    // implied otherwise would send the next reader looking for a PWA-side
    // backstop that has never existed; the backstop is `name-sweep.test.ts`.
    const named = s({ name: 'fix-the-pr-sheet', branch: 'ws/quiet-mesa', workspace: 'quiet-mesa', held: HOLD });
    render(<SessionLine session={named} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('fix-the-pr-sheet')).toBeInTheDocument();
    expect(screen.queryByText('ws/quiet-mesa')).toBeNull();
  });
});
