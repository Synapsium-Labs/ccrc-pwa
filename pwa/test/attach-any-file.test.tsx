// Any file attaches (wave 172, the operator's goal of 2026-11-24). The three
// doors — the picker, paste and drop — each stage a non-picture as a chip
// carrying its own name, uploaded byte for byte; a picture still thumbnails
// and may still downscale. What remains of a gate is the two limits, said
// with the file's name and its size.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { api } from '../src/lib/api';
import { uploadErrorText } from '../src/lib/refusalWords';
import { Composer } from '../src/session/Composer';
import {
  ATTACH_ACCEPT, NEUTRAL_EXT, clipboardFiles, isAttachable, namedUpload, tooLargeText, useStagedImages,
} from '../src/session/useAttachImage';
import { CLIP_EXT_MAX, CLIP_MAX_BYTES, CLIP_MAX_PER_MESSAGE, clipExtOf, hasClipExt, isImageClip } from '../../shared/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ID = 'lane-a-project-a';
const ZIP_CLIP = { path: '/home/u/.cc-clips/lane-a-project-a/clip-1-a1b2c3d4-bundle.zip', name: 'clip-1-a1b2c3d4-bundle.zip', bytes: 2 };

const fileInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('attach input not rendered');
  return el;
};

/** A File that reports `size` without allocating it. */
const sized = (name: string, size: number, type = ''): File => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('the extension shape, from the one definition', () => {
  it('admits any extension of letters and digits, lower-cased', () => {
    for (const [name, ext] of [
      ['bundle.zip', 'zip'], ['memo.docx', 'docx'], ['main.ts', 'ts'], ['track.mp3', 'mp3'],
      ['backup.tar.gz', 'gz'], ['REPORT.PDF', 'pdf'], ['x.7z', '7z'], [`x.${'a'.repeat(CLIP_EXT_MAX)}`, 'a'.repeat(CLIP_EXT_MAX)],
    ] as const) expect(clipExtOf(name), name).toBe(ext);
  });

  // The Kelvin sign lower-cases to an ASCII `k` and the long s does not; the
  // server's case-insensitive gate admits neither, so neither may count here,
  // or a chip would go up only to be refused.
  it('admits no extension that is over-long, symbol-bearing, absent, only dots, or non-ASCII', () => {
    for (const name of [
      'README', `x.${'a'.repeat(CLIP_EXT_MAX + 1)}`, 'x.t~t', 'x.tar-gz', 'x.', '...', '.', '', 'x.K', 'x.ſh', 'a.b/c',
    ]) {
      expect(clipExtOf(name), JSON.stringify(name)).toBe('');
      expect(hasClipExt(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('keeps the four pictures as the only thumbnails', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp']) expect(isImageClip(n), n).toBe(true);
    for (const n of ['a.gif', 'a.svg', 'a.heic', 'a.pdf', 'a.zip', 'a']) expect(isImageClip(n), n).toBe(false);
  });
});

describe('namedUpload gives every file a name the store admits', () => {
  it('keeps a name that already has a usable extension, any type', () => {
    for (const n of ['bundle.zip', 'memo.docx', 'backup.tar.gz', 'REPORT.PDF', 'anim.gif']) {
      const f = new File(['x'], n);
      expect(namedUpload(f, 1), n).toBe(f);
    }
  });

  it(`adds .${NEUTRAL_EXT} to a name with none, keeping the name`, () => {
    for (const [n, want] of [
      ['README', 'README.noext'], ['Makefile', 'Makefile.noext'], [`x.${'a'.repeat(CLIP_EXT_MAX + 1)}`, `x.${'a'.repeat(CLIP_EXT_MAX + 1)}.noext`],
      ['x.t~t', 'x.t~t.noext'], ['...', '....noext'], ['x.K', 'x.K.noext'],
    ] as const) {
      const named = namedUpload(new File(['x'], n, { type: 'application/octet-stream' }), 1);
      expect(named.name, n).toBe(want);
      expect(hasClipExt(named.name), n).toBe(true);
      expect(named.type, n).toBe('application/octet-stream');
    }
  });

  it('names a nameless clipboard picture by its type, and any other nameless file neutrally', () => {
    expect(namedUpload(new File(['x'], '', { type: 'image/png' }), 7).name).toBe('pasted-7.png');
    expect(namedUpload(new File(['x'], '', { type: 'image/gif' }), 7).name).toBe('pasted-7.noext');
    expect(namedUpload(new File(['x'], '', { type: '' }), 7).name).toBe('pasted-7.noext');
  });

  it('keeps the bytes: the renamed file is the same content', async () => {
    const f = new File([new Uint8Array([0, 0x80, 0xff])], 'README');
    expect(new Uint8Array(await namedUpload(f, 1).arrayBuffer())).toEqual(new Uint8Array([0, 0x80, 0xff]));
  });
});

describe('every file is attachable at the doors', () => {
  it('admits any file, and a clipboard carrying one hands it over', () => {
    const zip = new File(['PK'], 'bundle.zip', { type: 'application/zip' });
    expect(isAttachable(zip)).toBe(true);
    expect(isAttachable(new File(['x'], 'mystery', { type: '' }))).toBe(true);
    const clip = { items: [{ kind: 'file', type: zip.type, getAsFile: () => zip }] } as unknown as DataTransfer;
    expect(clipboardFiles(clip)).toEqual([zip]);
  });

  it('a text-only clipboard still gives nothing, so the text paste is untouched', () => {
    const clip = { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } as unknown as DataTransfer;
    expect(clipboardFiles(clip)).toEqual([]);
  });
});

describe('the picker offers every file', () => {
  // No `accept` attribute: that is what makes a phone offer the photo library,
  // the camera and its files in one sheet. A list greys everything else out.
  it('renders the composer picker with no filter at all', () => {
    expect(ATTACH_ACCEPT).toBeUndefined();
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    expect(fileInput().hasAttribute('accept')).toBe(false);
    expect(fileInput().hasAttribute('capture')).toBe(false);
  });

  it('stages a picked archive as a chip with its own name, uploaded as picked', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    const zip = new File(['PK'], 'bundle.zip', { type: 'application/zip' });
    fireEvent.change(fileInput(), { target: { files: [zip] } });
    expect(await screen.findByText('bundle.zip')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(ID, zip);
    expect(screen.queryByAltText('bundle.zip')).toBeNull();
  });
});

describe('paste and drop stage a non-picture as a chip', () => {
  it('a pasted file of any type becomes a chip, not text', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    const zip = new File(['PK'], 'bundle.zip', { type: 'application/zip' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'file', type: zip.type, getAsFile: () => zip }], getData: () => '' },
    });
    fireEvent(screen.getByRole('textbox'), event);
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByText('bundle.zip')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(ID, zip);
  });

  it('a dropped file of any type becomes a chip; a dropped file with no extension gains .noext', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const { container } = render(<Composer onSend={vi.fn()} pending={[]} id={ID} />);
    const composer = container.querySelector<HTMLElement>('.composer')!;
    const zip = new File(['PK'], 'bundle.zip', { type: 'application/zip' });
    const readme = new File(['# hi'], 'README', { type: '' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [zip, readme] } });
    fireEvent(composer, event);
    expect(await screen.findByText('bundle.zip')).toBeInTheDocument();
    expect(await screen.findByText('README.noext')).toBeInTheDocument();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[0]![1]).toBe(zip);
    expect((upload.mock.calls[1]![1] as File).name).toBe('README.noext');
  });
});

/** The hook on its own, with the downscale injectable. */
function Harness({ files, downscale }: { files: File[]; downscale?: (f: File) => Promise<Blob> }): React.ReactNode {
  const s = useStagedImages(ID, downscale);
  return (
    <div>
      <button type="button" onClick={() => s.add(files)}>add</button>
      <ul>
        {s.images.map((i) => (
          <li key={i.key}>
            <span data-testid={`state-${i.file.name}`}>{i.state}</span>
            <span data-testid={`preview-${i.file.name}`}>{i.previewUrl ?? ''}</span>
            <span data-testid={`error-${i.file.name}`}>{i.error ?? ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('the limits that remain', () => {
  it('says the per-file limit with the name and the size', () => {
    expect(tooLargeText('big.zip', CLIP_MAX_BYTES + 1)).toBe('big.zip is 12.0 MB — 12 MB per file is the limit');
    expect(tooLargeText('huge.iso', 40 * 1024 * 1024)).toBe('huge.iso is 40.0 MB — 12 MB per file is the limit');
  });

  it('refuses a non-picture one byte over the limit before any request, with no chip', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<><Harness files={[sized('big.zip', CLIP_MAX_BYTES + 1)]} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    expect(await screen.findByRole('alert')).toHaveTextContent('big.zip is 12.0 MB — 12 MB per file is the limit');
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('state-big.zip')).toBeNull();
  });

  it('stages a non-picture of exactly the limit', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<Harness files={[sized('edge.zip', CLIP_MAX_BYTES)]} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-edge.zip')).toHaveTextContent('staged'));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it(`refuses a file past the ${String(CLIP_MAX_PER_MESSAGE)}th, naming the limit`, async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const files = Array.from({ length: CLIP_MAX_PER_MESSAGE + 1 }, (_, i) => new File(['x'], `f${String(i)}.zip`));
    render(<><Harness files={files} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Four attachments per message/);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(CLIP_MAX_PER_MESSAGE));
    expect(screen.queryByTestId(`state-f${String(CLIP_MAX_PER_MESSAGE)}.zip`)).toBeNull();
  });

  // A picture is judged AFTER its downscale, which is what may bring it under.
  it('a large picture still downscales, and is staged when the result fits', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const downscale = vi.fn().mockResolvedValue(new Blob(['small'], { type: 'image/jpeg' }));
    render(<Harness files={[sized('photo.jpg', 20 * 1024 * 1024, 'image/jpeg')]} downscale={downscale} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-photo.jpg')).toHaveTextContent('staged'));
    expect(downscale).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('preview-photo.jpg').textContent).not.toBe('');
    expect((upload.mock.calls[0]![1] as File).size).toBe(5);
  });

  it('a picture still over the limit after its downscale fails with its size, and is never sent', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    // Real bytes: the hook wraps the downscale's Blob in a new File, which
    // would not keep a size faked onto the Blob.
    const big = new Blob([new Uint8Array(CLIP_MAX_BYTES + 1)], { type: 'image/jpeg' });
    render(<><Harness files={[sized('photo.jpg', 30 * 1024 * 1024, 'image/jpeg')]} downscale={async () => big} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-photo.jpg')).toHaveTextContent('failed'));
    expect(screen.getByTestId('error-photo.jpg')).toHaveTextContent('photo.jpg is 12.0 MB — 12 MB per file is the limit');
    expect(upload).not.toHaveBeenCalled();
  });

  it("the server's refusal of a name says what is left, not the old type list", () => {
    expect(uploadErrorText('unsupported-type')).not.toMatch(/images, text, PDF/);
    expect(uploadErrorText('too-large')).toMatch(/12 MB/);
  });
});
