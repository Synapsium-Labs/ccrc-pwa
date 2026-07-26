// The staged-images hook on its own. A tiny harness stands in for the tray so
// this task does not depend on Task 10's markup or Task 11's composer wiring.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { useStagedImages } from '../src/session/useAttachImage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ID = 'claude2-Proj';
const CLIP = { path: '/home/u/.cc-clips/claude2-Proj/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };
const shot = (name = 'shot.png') => new File(['tiny'], name, { type: 'image/png' });

/** Renders the hook's state as plain text, so assertions read the hook and not
 *  a component's styling choices. */
function Harness({ files }: { files: File[] }): React.ReactNode {
  const s = useStagedImages(ID);
  return (
    <div>
      <button type="button" onClick={() => s.add(files)}>add</button>
      <span data-testid="uploading">{String(s.uploading)}</span>
      <span data-testid="failed">{String(s.hasFailed)}</span>
      <ul>
        {s.images.map((i) => (
          <li key={i.key} data-testid={`img-${i.file.name}`}>
            <span data-testid={`state-${i.file.name}`}>{i.state}</span>
            <span data-testid={`dims-${i.file.name}`}>
              {i.width && i.height ? `${i.width}×${i.height}` : ''}
            </span>
            <span data-testid={`path-${i.file.name}`}>{i.path ?? ''}</span>
            <button type="button" onClick={() => s.remove(i.key)}>remove {i.file.name}</button>
            <button type="button" onClick={() => s.retry(i.key)}>retry {i.file.name}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('useStagedImages', () => {
  it('stages an image and reports the payload’s dimensions', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    render(<Harness files={[shot()]} />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('staged'));
    expect(screen.getByTestId('path-shot.png')).toHaveTextContent(CLIP.path);
    // The small-PNG passthrough skips the downscale entirely — the dimensions
    // must still be there. This is the branch a naive implementation misses.
    expect(screen.getByTestId('dims-shot.png')).toHaveTextContent('2788×442');
  });

  it('removes an image and revokes its object URL', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    render(<Harness files={[shot()]} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('staged'));

    fireEvent.click(screen.getByText('remove shot.png'));
    expect(screen.queryByTestId('img-shot.png')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('marks a failed upload and retries the same file', async () => {
    const upload = vi.spyOn(api, 'upload')
      .mockRejectedValueOnce(new ApiError(502, { error: 'nope' }))
      .mockResolvedValueOnce(CLIP);
    render(<Harness files={[shot()]} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('failed')).toHaveTextContent('true'));

    fireEvent.click(screen.getByText('retry shot.png'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('staged'));
  });

  it('refuses a fifth image', async () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    const five = Array.from({ length: 5 }, (_, i) => shot(`s${i}.png`));
    render(<><Harness files={five} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));

    expect(await screen.findByText(/Four images per message/)).toBeInTheDocument();
    expect(screen.queryByTestId('img-s4.png')).not.toBeInTheDocument();
  });
});
