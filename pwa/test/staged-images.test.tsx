// The staged-images hook on its own. A tiny harness stands in for the tray so
// this task does not depend on Task 10's markup or Task 11's composer wiring.
import { StrictMode } from 'react';
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
 *  a component's styling choices. `second`, when given, wires up an
 *  "add-twice" button that calls `add()` twice synchronously in the same
 *  handler — the same tick two paste/drop events would land in, and the case
 *  that silently dropped the second upload before the listRef fix. `downscale`,
 *  when given, is injected straight through to the hook — lets a test spy on
 *  whether the downscale branch actually ran. */
function Harness({
  files, second, downscale,
}: { files: File[]; second?: File[]; downscale?: (f: File) => Promise<Blob> }): React.ReactNode {
  const s = useStagedImages(ID, downscale);
  return (
    <div>
      <button type="button" onClick={() => s.add(files)}>add</button>
      {second && (
        <button
          type="button"
          onClick={() => {
            s.add(files);
            s.add(second);
          }}
        >
          add-twice
        </button>
      )}
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

  // — The downscale branch and its extension re-wrap: the client half of the
  // server's "admits uploads by filename extension" contract. Break the
  // re-wrap (wrong name, wrong type) and every non-small-PNG upload 400s on a
  // real server while a test suite that only checks "upload happened" stays
  // green — so these assert the actual name/type of the uploaded File. —

  it('downscales an oversized PNG and re-wraps the result as a PNG File before upload', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    const downscale = vi
      .fn<(f: File) => Promise<Blob>>()
      .mockResolvedValue(new Blob(['small'], { type: 'image/png' }));
    // Over SMALL_PNG_MAX (1MB) — the passthrough test above only covers the
    // branch that skips this one.
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'shot.png', { type: 'image/png' });
    render(<Harness files={[big]} downscale={downscale} />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(downscale).toHaveBeenCalledWith(big);
    const uploaded = upload.mock.calls[0]![1];
    expect(uploaded.name).toBe('shot.png');
    expect(uploaded.type).toBe('image/png');
  });

  it('downscales a camera JPEG regardless of size and re-wraps as a JPEG File before upload', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    const downscale = vi
      .fn<(f: File) => Promise<Blob>>()
      .mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    const photo = new File(['jpeg-bytes'], 'IMG_0042.jpeg', { type: 'image/jpeg' });
    render(<Harness files={[photo]} downscale={downscale} />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(downscale).toHaveBeenCalledWith(photo);
    const uploaded = upload.mock.calls[0]![1];
    expect(uploaded.name).toBe('IMG_0042.jpg');
    expect(uploaded.type).toBe('image/jpeg');
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

  // — Regression: two add() calls in the same tick (e.g. paste and drop
  // landing together) used to lose the second file to React's eager-state
  // fast path — the first add()'s functional setState updater ran
  // synchronously, but the second's just enqueued, so its own `accepted`
  // array was still empty by the time its upload loop ran. Fixed by making
  // `listRef` — not React state — the single source of truth `add()` reads
  // and writes through. —

  it('stages both files when add() is called twice in the same tick', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    const x = shot('x.png');
    const y = shot('y.png');
    render(<Harness files={[x]} second={[y]} />);
    fireEvent.click(screen.getByText('add-twice'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('state-x.png')).toHaveTextContent('staged'));
    await waitFor(() => expect(screen.getByTestId('state-y.png')).toHaveTextContent('staged'));
  });

  it('creates exactly one object URL per file under StrictMode', () => {
    vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    // The shared setup.ts stub persists across this file's tests — clear its
    // call history so this count reflects only this test's single add().
    vi.mocked(URL.createObjectURL).mockClear();
    render(
      <StrictMode>
        <Harness files={[shot()]} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByText('add'));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('never leaves a chip stuck uploading with no upload in flight', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(CLIP);
    const x = shot('x.png');
    const y = shot('y.png');
    render(<Harness files={[x]} second={[y]} />);
    fireEvent.click(screen.getByText('add-twice'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('state-x.png')).not.toHaveTextContent('uploading');
      expect(screen.getByTestId('state-y.png')).not.toHaveTextContent('uploading');
    });
  });
});
