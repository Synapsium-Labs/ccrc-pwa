import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BACK_BUTTON, BackButton, LimitBar, QuickConfirm, Sheet, Skeleton, StatusDot, ToastHost, toast } from '@ccrc/ui';

// vitest runs without globals, so RTL's auto-cleanup never registers itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// — StatusDot —

describe('StatusDot', () => {
  // Keyed by SessionBucket now (Task 6), not by SessionStatus | 'dialog' —
  // 'busy' became 'working' and 'dialog' became 'attention', the same
  // seven-member vocabulary sortFleet/groupFleet/SessionLine all read.
  it('maps each bucket to its dot class, label and glyph', () => {
    const { rerender } = render(<StatusDot status="working" />);
    const working = screen.getByRole('img', { name: 'working' });
    expect(working).toHaveClass('dot--busy');
    expect(working).toHaveTextContent('◐');

    rerender(<StatusDot status="idle" />);
    const idle = screen.getByRole('img', { name: 'idle' });
    expect(idle).toHaveClass('dot--idle');
    expect(idle).toHaveTextContent('○');

    rerender(<StatusDot status="dead" />);
    const dead = screen.getByRole('img', { name: 'not running' });
    expect(dead).toHaveClass('dot--dead');
    expect(dead).toHaveTextContent('✕');
  });

  it('renders a pending dialog as the pulsing attention dot', () => {
    render(<StatusDot status="attention" />);
    const dot = screen.getByRole('img', { name: 'waiting on you' });
    expect(dot).toHaveClass('dot--attention');
    expect(dot).not.toHaveClass('dot--busy');
    expect(dot).toHaveTextContent('●');
  });

  // The two-glyph rule's own reason to exist: `done` and `idle` used to be
  // visually identical (both "not amber, not busy"). Now a check tells them
  // apart even with colour removed from the picture.
  it('renders a check for done, distinct from idle', () => {
    render(<StatusDot status="done" />);
    const dot = screen.getByRole('img', { name: 'finished' });
    expect(dot).toHaveClass('dot--done');
    expect(dot).not.toHaveClass('dot--idle');
    expect(dot).toHaveTextContent('✓');
  });

  it('renders the cleanup bucket distinctly from both idle and dead', () => {
    render(<StatusDot status="cleanup" />);
    const dot = screen.getByRole('img', { name: 'merged, ready to clean up' });
    expect(dot).toHaveClass('dot--cleanup');
    expect(dot).toHaveTextContent('♻');
  });

  it('pins the cleanup glyph to its TEXT presentation, so the lamp keeps its own colour', () => {
    // U+267B has an emoji presentation and no coverage in the --family-mono
    // stack on Apple platforms, so the bare glyph falls back to Apple Color
    // Emoji — painting itself the emoji's green, ignoring --status-cleanup
    // and every ratio design/contrast-check.mjs measured for it, and reading
    // as `working`, whose dot is green by design. U+FE0E is what asks for the
    // text presentation the colour rule is about.
    render(<StatusDot status="cleanup" />);
    expect(screen.getByRole('img', { name: 'merged, ready to clean up' }).textContent)
      .toBe('♻︎');
  });

  it('renders archived with the idle class but its own label', () => {
    // Reuses --status-idle's already-verified contrast (both are matte,
    // non-living), but the aria-label still says WHICH one — colour alone
    // never carries a distinction this screen makes elsewhere by word.
    render(<StatusDot status="archived" />);
    const dot = screen.getByRole('img', { name: 'archived' });
    expect(dot).toHaveClass('dot--idle');
    expect(dot).toHaveTextContent('○');
  });
});

// — LimitBar —

describe('LimitBar', () => {
  it('renders the critical class at 85 and ok below 50', () => {
    const { container } = render(<LimitBar five={85} seven={30} />);
    const fills = container.querySelectorAll('.limit-fill');
    expect(fills).toHaveLength(2);
    expect(fills[0]).toHaveClass('limit-fill--crit');
    expect(fills[0]).toHaveStyle({ width: '85%' });
    expect(fills[1]).toHaveClass('limit-fill--ok');
    expect(fills[1]).toHaveStyle({ width: '30%' });
  });

  it('bands 50–75 as warn (routing policy: prefer handoff)', () => {
    const { container } = render(<LimitBar five={64} seven={75} />);
    const fills = container.querySelectorAll('.limit-fill');
    expect(fills[0]).toHaveClass('limit-fill--warn');
    expect(fills[1]).toHaveClass('limit-fill--warn');
  });

  it('renders an em-dash readout and no fill for unknown values', () => {
    const { container } = render(<LimitBar five={null} seven={null} />);
    expect(container.querySelectorAll('.limit-fill')).toHaveLength(0);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

// — Skeleton —

describe('Skeleton', () => {
  it('renders the requested number of shimmer lines (default 3)', () => {
    const { container, rerender } = render(<Skeleton />);
    expect(container.querySelectorAll('.skel-line')).toHaveLength(3);

    rerender(<Skeleton lines={5} className="extra" />);
    expect(container.querySelectorAll('.skel-line')).toHaveLength(5);
    expect(container.querySelector('.skel')).toHaveClass('extra');
  });
});

// — Sheet —

describe('Sheet', () => {
  it('renders children and title when open, nothing when closed', () => {
    const { rerender } = render(
      <Sheet open={false} onClose={() => {}} title="Pick an option">
        <p>sheet body</p>
      </Sheet>,
    );
    expect(screen.queryByText('sheet body')).not.toBeInTheDocument();

    rerender(
      <Sheet open onClose={() => {}} title="Pick an option">
        <p>sheet body</p>
      </Sheet>,
    );
    expect(screen.getByText('sheet body')).toBeInTheDocument();
    expect(screen.getByText('Pick an option')).toBeInTheDocument();
  });

  it('calls onClose when the scrim is tapped', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose}>
        <p>sheet body</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The eyebrow's *type* (ReactNode, not string) is pinned by the type-level
  // suite in sheet.test-d.tsx — types are erased, so nothing here can see a
  // narrowing. What these two guard is the runtime: where a rich eyebrow lands,
  // and when the kicker line exists at all.
  it('hangs an element eyebrow inside the kicker line', () => {
    render(
      <Sheet
        open
        onClose={() => {}}
        title="t"
        eyebrow={
          <>
            claude is asking <span className="dlg-header-chip">Colour</span>
          </>
        }
      >
        body
      </Sheet>,
    );
    const chip = screen.getByText('Colour');
    expect(chip).toHaveClass('dlg-header-chip');
    // Inside the kicker <p>, not loose in the panel — the chip inherits the
    // eyebrow's mono/uppercase line and sits above the title.
    expect(chip.closest('p.sheet-eyebrow')).not.toBeNull();
  });

  it('renders the kicker line only for a truthy eyebrow', () => {
    const { rerender } = render(
      <Sheet open onClose={() => {}} title="t">
        body
      </Sheet>,
    );
    expect(document.querySelector('.sheet-eyebrow')).toBeNull();

    // Falsy eyebrows render nothing at all: an empty kicker is invisible but
    // still spends its margin, shoving the title down for no reason.
    rerender(
      <Sheet open onClose={() => {}} title="t" eyebrow="">
        body
      </Sheet>,
    );
    expect(document.querySelector('.sheet-eyebrow')).toBeNull();

    rerender(
      <Sheet open onClose={() => {}} title="t" eyebrow={0}>
        body
      </Sheet>,
    );
    expect(document.querySelector('.sheet-eyebrow')).toBeNull();

    rerender(
      <Sheet open onClose={() => {}} title="t" eyebrow="session">
        body
      </Sheet>,
    );
    expect(document.querySelector('.sheet-eyebrow')).toHaveTextContent('session');
  });

  // jsdom does no layout, so what follows can only be asserted against the
  // source — as the attach-tray CSS guards already do. The real geometry is
  // checked in Chromium; these keep the declarations from being dropped again.
  // Since the Sheet moved to utility classes, "the source" is the class list
  // rather than a rule in a stylesheet — see the note inside.
  //
  // Both surfaces render caller text: DialogSheet puts the real
  // AskUserQuestion in the title and its header chip in the eyebrow, and those
  // routinely carry a path, URL, hash or snake_case identifier. .sheet-panel
  // is position:fixed with no overflow of its own, so an unbroken >40ch token
  // is clipped at the viewport edge, out of reach. Every other dynamic-text
  // surface in this codebase (.opt-label, .opt-desc, .well, .dlg-body) sets
  // `overflow-wrap: anywhere`.
  describe('sheet header guards', () => {
    // WHAT CHANGED, AND WHAT IT COST. These two used to read primitives.css and
    // assert the DECLARATIONS — `overflow-wrap: anywhere`, `max-height: 38vh`,
    // `overflow-y: auto` — straight out of the stylesheet. The Sheet is styled
    // with utility classes now, so there is no rule in any .css file to read:
    // the class IS the declaration, and it only becomes CSS when Tailwind
    // generates it at build time.
    //
    // So the guard asserts the classes are on the element. That is genuinely
    // WEAKER than what it replaced, in one specific way worth naming: reading
    // the rule also caught a LATER override of the same property inside it,
    // and a class list cannot. It still fails if a class is dropped or
    // renamed, which is the defect these were written for — a long
    // AskUserQuestion running off a position:fixed panel with nothing to clip
    // against, and a 600-char question pushing the option rows below the fold.
    const open = (title: string, eyebrow?: string) =>
      render(
        <Sheet open title={title} eyebrow={eyebrow} onClose={() => {}}>
          <p>body</p>
        </Sheet>,
      );

    it('lets a long unbroken token in the title and the eyebrow wrap', () => {
      open('a/very/long/unbroken/path/that/cannot/break', 'claude is asking');
      expect(document.querySelector('.sheet-title')).toHaveClass('[overflow-wrap:anywhere]');
      expect(document.querySelector('.sheet-eyebrow')).toHaveClass('[overflow-wrap:anywhere]');
    });

    // The markup this replaced rendered the question in .dlg-body, capped at
    // 38vh with its own scroller "so the options stay reachable". The title
    // rides inside .sheet-body now, but uncapped it still pushes the option
    // rows below the fold on a phone — a 600-char question is ~430px of
    // heading. Short titles never reach the cap, so it stays invisible.
    it('caps the title with its own scroller, as .dlg-body was', () => {
      open('a question');
      const title = document.querySelector('.sheet-title');
      expect(title).toHaveClass('max-h-[38vh]');
      expect(title).toHaveClass('overflow-y-auto');
    });
  });
});

// — QuickConfirm —

describe('QuickConfirm', () => {
  const props = {
    title: 'Stop this session?',
    consequence: 'The session goes offline until you start it again. Its conversation is kept.',
    confirmLabel: 'Stop session',
  };

  it('fires onConfirm only via its confirm button', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<QuickConfirm {...props} open onConfirm={onConfirm} onClose={onClose} />);

    // Tapping the copy or cancelling never confirms.
    fireEvent.click(screen.getByText(/goes offline/));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows title, consequence sentence, and closes after confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<QuickConfirm {...props} open onConfirm={onConfirm} onClose={onClose} />);

    expect(screen.getByText('Stop this session?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// — Toast —

describe('toast + ToastHost', () => {
  it('renders fired toasts and auto-dismisses them', () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    act(() => {
      toast('Image attached to the prompt');
    });
    expect(screen.getByText('Image attached to the prompt')).toBeInTheDocument();
    expect(screen.getByText('Image attached to the prompt')).toHaveAttribute('role', 'status');

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByText('Image attached to the prompt')).not.toBeInTheDocument();
  });

  it('marks error toasts with the error class and alert role', () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    act(() => {
      toast('Upload failed', 'error');
    });
    const el = screen.getByText('Upload failed');
    expect(el).toHaveClass('toast--error');
    expect(el).toHaveAttribute('role', 'alert');
  });

  it('dismisses a toast on tap', () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    act(() => {
      toast('Tap me away');
    });
    fireEvent.click(screen.getByText('Tap me away'));
    expect(screen.queryByText('Tap me away')).not.toBeInTheDocument();
  });
});

// — BackButton —

describe('BackButton', () => {
  // The five rules this replaced had drifted twice, and both drifts were
  // invisible from any one of them. The measured mutation table said neither
  // claim below was guarded: dropping `motion-reduce:transition-none` and
  // swapping the ink both left 192 tests green and the gate at ALL 3432 PASS.
  // THE EXPORTED CONSTANT, not the file. Reading the source made the first
  // version of these assertions VACUOUS and the mutation table caught it:
  // deleting `motion-reduce:transition-none` from the class string left the
  // phrase in the comment ABOVE it that explains the fix, so `toContain` was
  // satisfied by prose while the utility was gone. 217 tests stayed green.
  // `BACK_BUTTON` is the value the component actually renders.
  const source = BACK_BUTTON;

  it('honours prefers-reduced-motion, which four of the five rules did not', () => {
    // THE ONE BEHAVIOUR CHANGE in the extraction, so it gets a guard rather
    // than a comment. chat.css's reduced-motion block named `.chat-back`;
    // fleet.css's named `.fab`, `.card`, `.notice-x`, `.acct-change`,
    // `.acct-list .acct-row` and `.proj-row` — no back button. So four of the
    // five animated for a reader who had asked nothing to animate, and the
    // component is where that stops being per-stylesheet luck.
    expect(source).toContain('motion-reduce:transition-none');
  });

  it('keeps the two transitions on their own durations', () => {
    // `transform` at --dur-press and `color` at --dur-fast. A single
    // `duration-*` utility cannot say that, so collapsing them would be a
    // silent change to how the press feels — which is why this is an
    // arbitrary property and why the shape is asserted.
    expect(source).toContain('transform_var(--dur-press)_var(--curve-swift)');
    expect(source).toContain('color_var(--dur-fast)_var(--curve-swift)');
  });

  it('paints --ink-secondary at rest and --ink-primary pressed', () => {
    // Pinned BY NAME, not by ratio. Both inks clear 4.5 on --bg-page in all
    // twelve palettes, so a swap passes every contrast check silently — the
    // same gap TextInput's ink had. Which ink a control rests at is a design
    // decision: the chevron is quiet until touched, and the lift to
    // --ink-primary is one of the two cues the press gives.
    expect(source).toContain('text-ink-secondary');
    expect(source).toContain('active:text-ink-primary');
    expect(source).toContain('active:scale-[0.88]');
  });

  it('renders a real button carrying the call site’s hook class', () => {
    const onClick = vi.fn();
    render(<BackButton className="chat-back" aria-label="Back to fleet" onClick={onClick}>‹</BackButton>);
    const el = screen.getByRole('button', { name: 'Back to fleet' });
    // The hook class is what shell.css's desktop-hiding rules still key on,
    // and it is the half of the old assertions that did not need rewriting.
    expect(el).toHaveClass('chat-back');
    expect(el).toHaveAttribute('type', 'button');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
