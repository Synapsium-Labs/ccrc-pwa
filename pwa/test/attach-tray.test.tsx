// Task 10 — the attachment tray: chips above the input bar. Presentational
// only — states, labels, alt text, the remove/retry callbacks. The staging
// logic itself is Task 9's useStagedImages, tested elsewhere.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AttachTray } from '../src/session/AttachTray';
import type { StagedImage } from '../src/session/useAttachImage';

afterEach(() => {
  cleanup();
});

const img = (over: Partial<StagedImage> = {}): StagedImage => ({
  key: 'k1', file: new File(['x'], 'shot.png', { type: 'image/png' }),
  previewUrl: 'blob:mock/1', state: 'staged', width: 2788, height: 442, ...over,
});

describe('AttachTray', () => {
  it('renders nothing when there is nothing attached', () => {
    const { container } = render(<AttachTray images={[]} onRemove={vi.fn()} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the thumbnail, its dimensions and a labelled remove control', () => {
    render(<AttachTray images={[img()]} onRemove={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByAltText('shot.png')).toHaveAttribute('src', 'blob:mock/1');
    expect(screen.getByText('2788×442')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove shot.png' })).toBeInTheDocument();
  });

  it('says it is uploading, and offers retry once it has failed', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AttachTray images={[img({ state: 'uploading', width: undefined, height: undefined })]}
                  onRemove={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('uploading…')).toBeInTheDocument();

    rerender(<AttachTray images={[img({ state: 'failed' })]} onRemove={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('retry'));
    expect(onRetry).toHaveBeenCalledWith('k1');
  });

  // Regression guard for a real-browser finding: .attach-chip used to carry
  // `overflow: hidden`, which clipped .attach-remove's 44px hit-area overlay
  // to ~3px. The fix moves the clip onto an inner .attach-chip-media wrapper
  // so .attach-remove — a direct sibling, not a descendant — is never inside
  // a clipped box. This asserts the structural shape that guarantees that,
  // so it can't be silently undone later (jsdom doesn't do hit-testing, so
  // the geometry itself is verified separately, in a real browser).
  it('keeps the remove control outside the clipped media wrapper', () => {
    const { container } = render(
      <AttachTray images={[img({ state: 'failed' })]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );
    const chip = container.querySelector('.attach-chip');
    const media = container.querySelector('.attach-chip-media');
    const remove = container.querySelector('.attach-remove');
    expect(media).not.toBeNull();
    expect(remove).not.toBeNull();
    expect(remove?.parentElement).toBe(chip);
    expect(media?.contains(remove)).toBe(false);
  });

  // Regression guard for the other real-browser finding: `.attach-chip-retry
  // { all: unset; ... }` reset `outline` to `initial`, which won at equal
  // specificity over the global `:focus-visible` rule because it appeared
  // later in the bundle — silently killing the keyboard focus ring on the
  // retry button. Guard the source directly: whatever the rule contains, it
  // must not reset `all`.
  it('does not reset `all` on the retry button (that silently strips outline/:focus-visible)', () => {
    const cssPath = path.resolve(process.cwd(), 'src/session/chat.css');
    const css = readFileSync(cssPath, 'utf8');
    const rule = css.match(/\.attach-chip-retry\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/all\s*:\s*unset/);
  });
});
