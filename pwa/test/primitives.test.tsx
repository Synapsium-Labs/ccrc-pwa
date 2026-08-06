import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatusDot } from '../src/components/StatusDot';
import { LimitBar } from '../src/components/LimitBar';
import { Skeleton } from '../src/components/Skeleton';
import { Sheet } from '../src/components/Sheet';
import { QuickConfirm } from '../src/components/QuickConfirm';
import { toast, ToastHost } from '../src/components/Toast';
import { declValue, ruleIn } from './cssRule';

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
  //
  // Both surfaces render caller text: DialogSheet puts the real
  // AskUserQuestion in the title and its header chip in the eyebrow, and those
  // routinely carry a path, URL, hash or snake_case identifier. .sheet-panel
  // is position:fixed with no overflow of its own, so an unbroken >40ch token
  // is clipped at the viewport edge, out of reach. Every other dynamic-text
  // surface in this codebase (.opt-label, .opt-desc, .well, .dlg-body) sets
  // `overflow-wrap: anywhere`.
  describe('sheet header CSS guards', () => {
    const css = readFileSync(
      path.resolve(process.cwd(), 'src/components/primitives.css'),
      'utf8',
    );
    // Shared rule reader (test/cssRule.ts), not a hand-rolled copy — fix round
    // 4, controller item 1. The copy that used to live here was `^`-anchored
    // with the `m` flag, so re-indenting primitives.css — a file this lane does
    // not own — or grouping `.sheet-title` with a sibling selector turned these
    // assertions into a thrown "" and a failure about nothing. `declValue`
    // reads the DECLARATION, so it still fails when the value changes or the
    // declaration is dropped, and it also catches a later override of the same
    // property inside the same rule, which `toMatch` did not.
    const rule = (selector: string): string => ruleIn(css, selector);

    it('lets a long unbroken token in the title and the eyebrow wrap', () => {
      expect(declValue(rule('.sheet-title'), 'overflow-wrap')).toBe('anywhere');
      expect(declValue(rule('.sheet-eyebrow'), 'overflow-wrap')).toBe('anywhere');
    });

    // The markup this replaced rendered the question in .dlg-body, capped at
    // 38vh with its own scroller "so the options stay reachable". The title
    // rides inside .sheet-body now, but uncapped it still pushes the option
    // rows below the fold on a phone — a 600-char question is ~430px of
    // heading. Short titles never reach the cap, so it stays invisible.
    it('caps the title with its own scroller, as .dlg-body was', () => {
      const title = rule('.sheet-title');
      expect(declValue(title, 'max-height')).toBe('38vh');
      expect(declValue(title, 'overflow-y')).toBe('auto');
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
