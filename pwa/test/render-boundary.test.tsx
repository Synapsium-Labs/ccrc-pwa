// The one error boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's refinement (m)).
// A throwing child shows `fallback(error)` with the thrown value, whatever it was (an Error, a string, `undefined`);
// `componentDidCatch` logs exactly `('ccrc: render error in ' + where, error)`; a changed `resetKey` renders the
// children again and an unchanged one keeps the fallback. The two screen fallbacks' buttons do what they say.
// The three mounts are pinned in root-boundary, app-detail-boundary and chat-item-boundary.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RenderBoundary, RootFallback, ScreenFallback } from '../src/components/RenderBoundary';
import { navigate } from '../src/lib/router';

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports every error a boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
  error.mockRestore();
  navigate('/');
});

/** Throws `what` while `boom.on` is true; renders a marker otherwise. */
const boom = { on: true, what: undefined as unknown };
function Thrower(): ReactNode {
  if (boom.on) throw boom.what;
  return <p>child drawn</p>;
}

/** A fallback that shows what it was handed, so a case can assert the thrown value reached it. */
const show = (e: unknown): ReactNode => (
  <p>
    fallback: {e === undefined ? 'undefined' : e === null ? 'null' : e instanceof Error ? e.message : String(e)}
  </p>
);

function arm(what: unknown): void {
  boom.on = true;
  boom.what = what;
}

describe('RenderBoundary: the fallback and the log line', () => {
  it('a throwing child shows fallback(error) with the thrown Error', () => {
    const err = new Error('kaboom');
    arm(err);
    render(<RenderBoundary where="detail" resetKey="k" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument();
    expect(screen.queryByText('child drawn')).toBeNull();
  });

  it('logs exactly (\'ccrc: render error in \' + where, error) through console.warn, once per catch', () => {
    const err = new Error('kaboom');
    arm(err);
    render(<RenderBoundary where="detail" resetKey="k" fallback={show}><Thrower /></RenderBoundary>);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', err);
  });

  it('a thrown string reaches the fallback as that string', () => {
    arm('a plain string');
    render(<RenderBoundary where="chat item" resetKey={1} fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: a plain string')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in chat item', 'a plain string');
  });

  it('a thrown undefined still shows the fallback: failure is a flag, not a non-empty error (no overloaded null)', () => {
    arm(undefined);
    render(<RenderBoundary where="root" resetKey="root" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: undefined')).toBeInTheDocument();
    expect(screen.queryByText('child drawn')).toBeNull();
  });

  it('a thrown null still shows the fallback', () => {
    arm(null);
    render(<RenderBoundary where="root" resetKey="root" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: null')).toBeInTheDocument();
  });

  it('children that do not throw render as they are, and nothing is logged', () => {
    boom.on = false;
    render(<RenderBoundary where="detail" resetKey="k" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('child drawn')).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('RenderBoundary: resetKey', () => {
  it('a changed resetKey renders the children again', () => {
    arm(new Error('kaboom'));
    const { rerender } = render(
      <RenderBoundary where="detail" resetKey="/runs" fallback={show}><Thrower /></RenderBoundary>,
    );
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument();
    boom.on = false;
    rerender(<RenderBoundary where="detail" resetKey="/settings" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('child drawn')).toBeInTheDocument();
    expect(screen.queryByText('fallback: kaboom')).toBeNull();
  });

  it('an unchanged resetKey keeps the fallback, even once the child would draw', () => {
    arm(new Error('kaboom'));
    const { rerender } = render(
      <RenderBoundary where="detail" resetKey="/runs" fallback={show}><Thrower /></RenderBoundary>,
    );
    boom.on = false;
    rerender(<RenderBoundary where="detail" resetKey="/runs" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument();
    expect(screen.queryByText('child drawn')).toBeNull();
  });

  it('a child that throws again under the new key shows the fallback again, with the new error', () => {
    arm(new Error('first'));
    const { rerender } = render(
      <RenderBoundary where="detail" resetKey={1} fallback={show}><Thrower /></RenderBoundary>,
    );
    arm(new Error('second'));
    rerender(<RenderBoundary where="detail" resetKey={2} fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: second')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('the two screen fallbacks', () => {
  it("RootFallback says the app could not draw, and its Reload button calls the injected reload", () => {
    const reload = vi.fn();
    render(<RootFallback reload={reload} />);
    expect(screen.getByText('ccrc could not draw this screen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ScreenFallback says the screen could not be shown, and Back to the fleet navigates to '/'", () => {
    navigate('/runs?x=1');
    render(<ScreenFallback />);
    expect(screen.getByText('This screen could not be shown.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fleet' }));
    expect(location.pathname + location.search).toBe('/');
  });
});
