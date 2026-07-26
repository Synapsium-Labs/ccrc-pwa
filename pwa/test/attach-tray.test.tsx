// Task 10 — the attachment tray: chips above the input bar. Presentational
// only — states, labels, alt text, the remove/retry callbacks. The staging
// logic itself is Task 9's useStagedImages, tested elsewhere.
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
});
