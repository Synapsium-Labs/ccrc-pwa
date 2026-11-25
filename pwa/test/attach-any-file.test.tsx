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
  ATTACH_ACCEPT, NEUTRAL_EXT, clipboardFiles, isAttachable, namedUpload, stillTooLargeText, tooLargeText, useStagedImages,
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

  // Pinned as numbers, not from the constant, so a change to it is a red here.
  it('takes an extension of twelve characters and not of thirteen', () => {
    expect(CLIP_EXT_MAX).toBe(12);
    expect(clipExtOf(`x.${'a'.repeat(12)}`)).toBe('aaaaaaaaaaaa');
    expect(clipExtOf(`x.${'a'.repeat(13)}`)).toBe('');
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

  // Review 3647 F1 case 1: a DECLARED picture whose name has no usable
  // extension stays a picture, as on main — its own name kept as the stem —
  // and only a file that is not a declared picture takes the neutral one.
  it('gives a declared picture with an unusable name its picture extension, keeping its name', () => {
    for (const [n, type, want] of [
      ['photo.jpeg_large', 'image/jpeg', 'photo.jpeg_large.jpg'], ['shot', 'image/png', 'shot.png'],
      ['frame', 'image/webp', 'frame.webp'], ['x.t~t', 'image/png', 'x.t~t.png'],
    ] as const) {
      const named = namedUpload(new File(['x'], n, { type }), 1);
      expect(named.name, n).toBe(want);
      expect(isImageClip(named.name), n).toBe(true);
      expect(named.type, n).toBe(type);
    }
  });

  it('gives the same names the neutral extension when the declared type is not one of the pictures', () => {
    for (const type of ['application/octet-stream', 'image/gif', 'image/svg+xml', 'text/plain', '']) {
      expect(namedUpload(new File(['x'], 'photo.jpeg_large', { type }), 1).name, type).toBe('photo.jpeg_large.noext');
      expect(namedUpload(new File(['x'], 'shot', { type }), 1).name, type).toBe('shot.noext');
    }
  });

  // Review 3670 F1: a declared picture whose usable extension is not one of
  // the four pictures was a picture on main (`photo.jfif`, a Windows save from
  // the web; `Screenshot 10.15.32`; `chart.v2`), so it stays one here: the
  // whole name is kept and the picture's extension follows it.
  it('gives a declared picture whose usable extension is not a picture its picture extension after the whole name', () => {
    for (const [n, type, want] of [
      ['photo.jfif', 'image/jpeg', 'photo.jfif.jpg'], ['photo.jpe', 'image/jpeg', 'photo.jpe.jpg'],
      ['photo.pjpeg', 'image/jpeg', 'photo.pjpeg.jpg'], ['Screenshot 10.15.32', 'image/png', 'Screenshot 10.15.32.png'],
      ['chart.v2', 'image/webp', 'chart.v2.webp'],
    ] as const) {
      const named = namedUpload(new File(['x'], n, { type }), 1);
      expect(named.name, n).toBe(want);
      expect(isImageClip(named.name), n).toBe(true);
      expect(named.type, n).toBe(type);
    }
  });

  it('leaves the name as it is when its extension is already a picture, whatever picture is declared', () => {
    for (const [n, type] of [['shot.png', 'image/jpeg'], ['IMG.JPG', 'image/png'], ['a.webp', 'image/webp']] as const) {
      const f = new File(['x'], n, { type });
      expect(namedUpload(f, 1), n).toBe(f);
    }
  });

  // The declared type wins only over an extension nothing else claims: one the
  // serve table types as something else stays that document.
  it('keeps a document the serve table types, though a picture is declared', () => {
    for (const n of ['notes.md', 'report.pdf', 'data.csv', 'log.txt', 'cfg.yaml']) {
      const f = new File(['# hi'], n, { type: 'image/png' });
      expect(namedUpload(f, 1), n).toBe(f);
    }
  });

  it('never renames a usable name when no picture is declared', () => {
    for (const [n, type] of [['photo.png', 'text/plain'], ['photo.jfif', ''], ['photo.jfif', 'image/gif'], ['bundle.zip', 'application/zip']] as const) {
      const f = new File(['x'], n, { type });
      expect(namedUpload(f, 1), `${n} ${type}`).toBe(f);
    }
  });

  // Review 3647 F7: the type table is read by a browser-declared string, so a
  // type named like an Object.prototype member must find nothing in it.
  // Review 3670 F4: a File lower-cases its declared type, so only the member
  // names that are lower-case already reach the table as members: two of them.
  it('finds nothing for a declared type named like an object member (the two a File can carry)', () => {
    expect(new File(['x'], '', { type: 'toString' }).type).toBe('tostring');
    const probes = ['constructor', '__proto__'];
    expect(probes).toHaveLength(2);
    for (const type of probes) {
      expect(new File(['x'], '', { type }).type, type).toBe(type);
      expect(namedUpload(new File(['x'], '', { type }), 7).name, type).toBe('pasted-7.noext');
      expect(namedUpload(new File(['x'], 'shot', { type }), 7).name, type).toBe('shot.noext');
      expect(namedUpload(new File(['x'], 'photo.jfif', { type }), 7).name, type).toBe('photo.jfif');
    }
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
function Harness({ files, then, downscale }: { files: File[]; then?: File[]; downscale?: (f: File) => Promise<Blob> }): React.ReactNode {
  const s = useStagedImages(ID, downscale);
  return (
    <div>
      <button type="button" onClick={() => s.add(files)}>add</button>
      <button type="button" onClick={() => s.add(then ?? [])}>add then</button>
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
    expect(tooLargeText('big.zip', CLIP_MAX_BYTES + 1)).toBe('big.zip is 12.1 MB — 12 MB per file is the limit');
    expect(tooLargeText('huge.iso', 40 * 1024 * 1024)).toBe('huge.iso is 40.0 MB — 12 MB per file is the limit');
  });

  it('refuses a non-picture one byte over the limit before any request, with no chip', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<><Harness files={[sized('big.zip', CLIP_MAX_BYTES + 1)]} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    expect(await screen.findByRole('alert')).toHaveTextContent('big.zip is 12.1 MB — 12 MB per file is the limit');
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
    expect(CLIP_MAX_PER_MESSAGE).toBe(4);
    expect(await screen.findByRole('alert')).toHaveTextContent('4 attachments per message');
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
    expect(screen.getByTestId('error-photo.jpg')).toHaveTextContent('photo.jpg is still 12.1 MB after shrinking — 12 MB per file is the limit');
    expect(upload).not.toHaveBeenCalled();
  });

  // Review 3647 F9: a refusal never names the limit as the size.
  it('never says the limit as the size of a file over it', () => {
    for (const over of [1, 1000, 52_428]) {
      const mbSaid = Number(/is ([0-9.]+) MB/.exec(tooLargeText('f', CLIP_MAX_BYTES + over))![1]);
      expect(mbSaid, String(over)).toBeGreaterThan(12);
    }
  });

  // Review 3647 F2b: the size arm skips one file and goes on with the batch.
  it('in a batch, refuses the file over the limit and still stages the one beside it', async () => {
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<><Harness files={[sized('big.zip', CLIP_MAX_BYTES + 1), new File(['x'], 'ok.zip')]} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    expect(await screen.findByRole('alert')).toHaveTextContent('big.zip is 12.1 MB');
    await waitFor(() => expect(screen.getByTestId('state-ok.zip')).toHaveTextContent('staged'));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('state-big.zip')).toBeNull();
  });

  // Review 3647 F1 case 2: a nameless clipboard picture is a picture by its
  // NAMED form, so its size is judged after the downscale, as on main.
  it('downscales a nameless clipboard picture over the limit and stages it when the result fits', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const downscale = vi.fn().mockResolvedValue(new Blob(['small'], { type: 'image/jpeg' }));
    render(<Harness files={[sized('', 15 * 1024 * 1024, 'image/jpeg')]} downscale={downscale} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-pasted-1000.jpg')).toHaveTextContent('staged'));
    expect(downscale).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a nameless clipboard picture still over the limit after its downscale fails with a name in the words', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const big = new Blob([new Uint8Array(CLIP_MAX_BYTES + 1)], { type: 'image/jpeg' });
    render(<><Harness files={[sized('', 15 * 1024 * 1024, 'image/jpeg')]} downscale={async () => big} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-pasted-1000.jpg')).toHaveTextContent('failed'));
    expect(screen.getByTestId('error-pasted-1000.jpg')).toHaveTextContent('pasted-1000.jpg is still 12.1 MB after shrinking — 12 MB per file is the limit');
    expect(upload).not.toHaveBeenCalled();
  });

  // Review 3670 F3: the size a still-too-large picture is refused with is
  // the shrunk one, so the words say it is that size after shrinking.
  it('says a picture over the limit after its downscale is still that size after shrinking', () => {
    expect(stillTooLargeText('photo.jpg', CLIP_MAX_BYTES + 1)).toBe('photo.jpg is still 12.1 MB after shrinking — 12 MB per file is the limit');
  });

  // Review 3670 F2: the size refusals are decided before the batch is cut to
  // the room left, so a refused file never takes the slot of one that fits.
  it('with one slot left, a refused file does not take the slot of a picture beside it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const three = ['f0.zip', 'f1.zip', 'f2.zip'].map((n) => new File(['x'], n));
    render(<><Harness files={three} then={[sized('big.zip', 20 * 1024 * 1024), new File(['png'], 'a.png', { type: 'image/png' })]} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByText('add then'));
    await waitFor(() => expect(screen.getByTestId('state-a.png')).toHaveTextContent('staged'));
    expect(screen.queryByTestId('state-big.zip')).toBeNull();
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).not.toMatch(/attachments per message/);
  });

  // Review 3670 F1, in the hook: a declared jpeg named photo.jfif is a picture.
  it('stages a declared jpeg named photo.jfif as a picture, its name kept', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const downscale = vi.fn().mockResolvedValue(new Blob(['small'], { type: 'image/jpeg' }));
    render(<Harness files={[new File(['jpeg'], 'photo.jfif', { type: 'image/jpeg' })]} downscale={downscale} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-photo.jfif.jpg')).toHaveTextContent('staged'));
    expect(screen.getByTestId('preview-photo.jfif.jpg').textContent).not.toBe('');
    expect((upload.mock.calls[0]![1] as File).name).toBe('photo.jfif.jpg');
  });

  it('downscales a declared jpeg named photo.jfif over the limit rather than refusing it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const downscale = vi.fn().mockResolvedValue(new Blob(['small'], { type: 'image/jpeg' }));
    render(<><Harness files={[sized('photo.jfif', 20 * 1024 * 1024, 'image/jpeg')]} downscale={downscale} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-photo.jfif.jpg')).toHaveTextContent('staged'));
    expect(downscale).toHaveBeenCalledTimes(1);
    expect((upload.mock.calls[0]![1] as File).size).toBe(5);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stages a declared png named Screenshot 10.15.32 as a picture', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10, height: 10, close: () => {} }));
    vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<Harness files={[new File(['png'], 'Screenshot 10.15.32', { type: 'image/png' })]} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-Screenshot 10.15.32.png')).toHaveTextContent('staged'));
    expect(screen.getByTestId('preview-Screenshot 10.15.32.png').textContent).not.toBe('');
  });

  // When the declared type alone made it a picture and the bytes do not
  // decode, the file goes up untouched under the name it came with.
  it('stages a declared picture that does not decode as the document it arrived as', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const original = new File(['not a picture'], 'photo.jfif', { type: 'image/jpeg' });
    const downscale = vi.fn().mockRejectedValue(new Error('not an image'));
    render(<Harness files={[original]} downscale={downscale} />);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-photo.jfif')).toHaveTextContent('staged'));
    expect(upload).toHaveBeenCalledWith(ID, original);
    expect(screen.getByTestId('preview-photo.jfif').textContent).toBe('');
  });

  it('a declared picture that does not decode and is over the limit is refused as the document it arrived as', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    const downscale = vi.fn().mockRejectedValue(new Error('not an image'));
    render(<><Harness files={[sized('photo.jfif', 20 * 1024 * 1024, 'image/jpeg')]} downscale={downscale} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-photo.jfif')).toHaveTextContent('failed'));
    expect(screen.getByTestId('error-photo.jfif')).toHaveTextContent('photo.jfif is 20.0 MB — 12 MB per file is the limit');
    expect(upload).not.toHaveBeenCalled();
  });

  it('a file named as a picture whose bytes do not decode still fails, as on main', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')));
    const upload = vi.spyOn(api, 'upload').mockResolvedValue(ZIP_CLIP);
    render(<><Harness files={[new File(['nope'], 'shot.png', { type: 'image/png' })]} /><ToastHost /></>);
    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('state-shot.png')).toHaveTextContent('failed'));
    expect(upload).not.toHaveBeenCalled();
  });

  it("the server's refusal of a name says what is left, not the old type list", () => {
    expect(uploadErrorText('unsupported-type')).not.toMatch(/images, text, PDF/);
    expect(uploadErrorText('too-large')).toMatch(/12 MB/);
  });
});
