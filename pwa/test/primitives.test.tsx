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

// vitest runs without globals, so RTL's auto-cleanup never registers itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// — StatusDot —

describe('StatusDot', () => {
  it('maps each status to its dot class and label', () => {
    const { rerender } = render(<StatusDot status="busy" />);
    expect(screen.getByRole('img', { name: 'working' })).toHaveClass('dot--busy');

    rerender(<StatusDot status="idle" />);
    expect(screen.getByRole('img', { name: 'idle' })).toHaveClass('dot--idle');

    rerender(<StatusDot status="dead" />);
    expect(screen.getByRole('img', { name: 'not running' })).toHaveClass('dot--dead');
  });

  it('renders a pending dialog as the pulsing attention dot', () => {
    render(<StatusDot status="dialog" />);
    const dot = screen.getByRole('img', { name: 'waiting on you' });
    expect(dot).toHaveClass('dot--attention');
    expect(dot).not.toHaveClass('dot--busy');
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
    const rule = (selector: string): string => {
      const found = css.match(new RegExp(`^\\${selector}\\s*\\{[^}]*\\}`, 'm'))?.[0] ?? '';
      expect(found).not.toBe('');
      return found;
    };

    it('lets a long unbroken token in the title and the eyebrow wrap', () => {
      expect(rule('.sheet-title')).toMatch(/overflow-wrap:\s*anywhere/);
      expect(rule('.sheet-eyebrow')).toMatch(/overflow-wrap:\s*anywhere/);
    });

    // The markup this replaced rendered the question in .dlg-body, capped at
    // 38vh with its own scroller "so the options stay reachable". The title
    // rides inside .sheet-body now, but uncapped it still pushes the option
    // rows below the fold on a phone — a 600-char question is ~430px of
    // heading. Short titles never reach the cap, so it stays invisible.
    it('caps the title with its own scroller, as .dlg-body was', () => {
      const title = rule('.sheet-title');
      expect(title).toMatch(/max-height:\s*38vh/);
      expect(title).toMatch(/overflow-y:\s*auto/);
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
