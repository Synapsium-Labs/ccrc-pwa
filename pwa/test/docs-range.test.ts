// X2 P1 Task P1.4: the range read's pure decisions (X2 spec section 4.3; plan Task P1.4). `rangeVerdict` says whether a
// leaf's bytes come through the class-capped file route, through range frames, or not at all; `imageViewVerdict` says
// whether an image may be decoded for its own page, from the dimensions its header declares; `imageHeaderDims` reads
// those dimensions from the first bytes, before any decode. Each ceiling is tested one below, at and one above.
import { describe, expect, it, vi } from 'vitest';
import {
  DOCS_CLASS_CAP, DOCS_IMAGE_VIEW_MAX_PIXELS, DOCS_IMAGE_VIEW_MAX_SIDE, DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES,
  DOC_CONTENT_CLASSES, type DocsFailure,
} from '../../shared/docs';
import { b64Bytes, imageHeaderDims, imageViewVerdict, rangeVerdict } from '../src/docs/range/rangePolicy';
import { readRange, type RangeLoader, type RangeTarget } from '../src/docs/range/readRange';

const MIB2 = 2097152;
const MIB64 = 67108864;

describe('rangeVerdict', () => {
  it('rangeVerdict: below, at and above 2 MiB and 64 MiB', () => {
    expect(DOCS_RANGE_MAX_BYTES).toBe(MIB64);
    for (const cls of DOC_CONTENT_CLASSES) {
      expect(DOCS_CLASS_CAP[cls], cls).toBe(MIB2);
      for (const pin of ['blob', 'fp'] as const) {
        expect(rangeVerdict(MIB2 - 1, cls, pin), `${cls} ${pin} below 2 MiB`).toBe('show');
        expect(rangeVerdict(MIB2, cls, pin), `${cls} ${pin} at 2 MiB`).toBe('show');
        expect(rangeVerdict(MIB2 + 1, cls, pin), `${cls} ${pin} above 2 MiB`).toBe('range');
        expect(rangeVerdict(MIB64 - 1, cls, pin), `${cls} ${pin} below 64 MiB`).toBe('range');
        expect(rangeVerdict(MIB64, cls, pin), `${cls} ${pin} at 64 MiB`).toBe('range');
        expect(rangeVerdict(MIB64 + 1, cls, pin), `${cls} ${pin} above 64 MiB`).toBe('over-ceiling');
      }
    }
  });

  it('rangeVerdict: a stat-pinned file of 100 KiB goes through range', () => {
    expect(rangeVerdict(102400, 'markdown', 'stat')).toBe('range');
    expect(rangeVerdict(0, 'text', 'stat')).toBe('range');
    expect(rangeVerdict(MIB64, 'raster', 'stat')).toBe('range');
    expect(rangeVerdict(MIB64 + 1, 'raster', 'stat')).toBe('over-ceiling');
  });

  it('rangeVerdict: a size that is not a whole byte count is over the ceiling, never shown', () => {
    for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rangeVerdict(size, 'markdown', 'blob'), String(size)).toBe('over-ceiling');
    }
  });
});

describe('imageViewVerdict', () => {
  it('image view: 8191 by 8192 and 8192 by 8192 show, 8192 by 8193 refuses by its pixels before decode', () => {
    expect(DOCS_IMAGE_VIEW_MAX_PIXELS).toBe(8192 * 8192);
    expect(imageViewVerdict({ w: 8191, h: 8192 })).toBe('show');
    expect(imageViewVerdict({ w: 8192, h: 8192 })).toBe('show');
    expect(imageViewVerdict({ w: 8192, h: 8193 })).toBe('pixels');
    expect(imageViewVerdict({ w: 8193, h: 8192 })).toBe('pixels');
  });

  it('image view: 16383 by 16 and 16384 by 16 show, 16385 by 16 refuses by its side before decode', () => {
    expect(DOCS_IMAGE_VIEW_MAX_SIDE).toBe(16384);
    expect(imageViewVerdict({ w: 16383, h: 16 })).toBe('show');
    expect(imageViewVerdict({ w: 16384, h: 16 })).toBe('show');
    expect(imageViewVerdict({ w: 16385, h: 16 })).toBe('side');
    expect(imageViewVerdict({ w: 16, h: 16385 })).toBe('side');
  });

  it('image view: a side past its limit says side even when the pixels are past theirs too', () => {
    expect(imageViewVerdict({ w: 20000, h: 20000 })).toBe('side');
  });
});

/** A big-endian 32-bit integer as four bytes. */
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le24 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const png = (w: number, h: number, firstChunk = 'IHDR', len = 13): Uint8Array =>
  bytes(PNG_SIG, be32(len), ascii(firstChunk), be32(w), be32(h), [8, 6, 0, 0, 0], [0, 0, 0, 0]);

describe('imageHeaderDims', () => {
  it('PNG: the IHDR chunk, required as the first chunk at byte 8', () => {
    expect(imageHeaderDims(png(16385, 16))).toEqual({ w: 16385, h: 16 });
    expect(imageHeaderDims(png(1, 1))).toEqual({ w: 1, h: 1 });
    expect(imageHeaderDims(png(16, 16, 'tEXt')), 'a chunk before IHDR').toBeNull();
    expect(imageHeaderDims(png(16, 16, 'IHDR', 12)), 'an IHDR whose length is not 13').toBeNull();
    expect(imageHeaderDims(png(16, 16).slice(0, 20)), 'cut inside IHDR').toBeNull();
    expect(imageHeaderDims(png(0, 16)), 'a zero side declares nothing to check').toBeNull();
  });

  it('JPEG: the first SOF marker, skipping the segments before it', () => {
    const app0 = [0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const dht = [0xff, 0xc4, ...be16(4), 0, 0];
    const sof = (m: number, w: number, h: number): number[] => [0xff, m, ...be16(11), 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0];
    expect(imageHeaderDims(bytes([0xff, 0xd8], app0, dht, sof(0xc0, 8192, 8193)))).toEqual({ w: 8192, h: 8193 });
    expect(imageHeaderDims(bytes([0xff, 0xd8], sof(0xc2, 640, 480))), 'progressive').toEqual({ w: 640, h: 480 });
    expect(imageHeaderDims(bytes([0xff, 0xd8], app0)), 'no SOF').toBeNull();
    expect(imageHeaderDims(bytes([0xff, 0xd8], [0xff, 0xe0, 0, 200])), 'a segment that runs past the bytes').toBeNull();
    expect(imageHeaderDims(bytes([0xff, 0xd8], [0xff, 0xd9], sof(0xc0, 64, 64))), 'nothing after EOI is read').toBeNull();
    expect(imageHeaderDims(bytes([0xff, 0xd8], sof(0xc0, 640, 0))), 'a deferred height (0) declares nothing').toBeNull();
  });

  it('GIF: the logical screen grown to the first frame, past the colour table and the extensions, for both headers', () => {
    const frame = (l: number, t: number, w: number, h: number): number[] => [0x2c, ...le16(l), ...le16(t), ...le16(w), ...le16(h), 0];
    const gct = [0x80, 0, 0, ...new Array(6).fill(0)]; // a global colour table of 2 entries
    const gce = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
    expect(imageHeaderDims(bytes(ascii('GIF89a'), le16(300), le16(200), gct, gce, frame(0, 0, 300, 200)))).toEqual({ w: 300, h: 200 });
    expect(imageHeaderDims(bytes(ascii('GIF87a'), le16(1), le16(2), [0, 0, 0], frame(0, 0, 1, 2)))).toEqual({ w: 1, h: 2 });
    expect(imageHeaderDims(bytes(ascii('GIF89a'), le16(1), le16(1), [0, 0, 0], gce, frame(10, 20, 65535, 65535))),
      'a 1 by 1 screen whose first frame is huge reads as huge').toEqual({ w: 65545, h: 65555 });
    expect(imageHeaderDims(bytes(ascii('GIF89a'), le16(1), le16(2), [0, 0, 0])), 'no frame').toBeNull();
    expect(imageHeaderDims(bytes(ascii('GIF88a'), le16(1), le16(2), [0, 0, 0], frame(0, 0, 1, 2)))).toBeNull();
  });

  it('WebP: the VP8, VP8L and VP8X chunks', () => {
    const riff = (chunk: number[]): Uint8Array => bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), chunk);
    const vp8 = [...ascii('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(400), ...le16(300)];
    expect(imageHeaderDims(riff(vp8))).toEqual({ w: 400, h: 300 });
    const packed = ((300 - 1) << 14) | (400 - 1);
    const vp8l = [...ascii('VP8L'), 0, 0, 0, 0, 0x2f, packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255];
    expect(imageHeaderDims(riff(vp8l))).toEqual({ w: 400, h: 300 });
    const vp8x = [...ascii('VP8X'), 0, 0, 0, 0, 0, 0, 0, 0, ...le24(16385 - 1), ...le24(16 - 1)];
    expect(imageHeaderDims(riff(vp8x))).toEqual({ w: 16385, h: 16 });
    expect(imageHeaderDims(riff([...ascii('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'VP8 without its start code').toBeNull();
  });

  it('anything else, an empty input or a cut header, is null', () => {
    expect(imageHeaderDims(new Uint8Array(0))).toBeNull();
    expect(imageHeaderDims(bytes(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
    expect(imageHeaderDims(bytes(PNG_SIG))).toBeNull();
  });
});

// ---- readRange: the reassembly (spec 4.3, "Progress, Cancel and memory"; plan Task P1.4) ---------------------------

/** A fake range loader over `src`: each frame the real slice, base64, with its own sha256; every call recorded. */
function fakeLoader(src: Uint8Array<ArrayBuffer>, opts: { size?: number; gone?: number; badDigestAt?: number } = {}) {
  const calls: string[] = [];
  let snap = 0;
  let goneLeft = opts.gone ?? 0;
  const loader: RangeLoader = {
    async prepare() {
      snap += 1;
      calls.push(`prepare ${snap}`);
      return { s: 'ok', value: { snapshot: `s${snap}`, size: opts.size ?? src.length, digest: await hex(src) } };
    },
    async frame(_target, snapshot, offset, length) {
      calls.push(`frame ${snapshot} ${offset} ${length}`);
      if (goneLeft > 0 && offset > 0) {
        goneLeft -= 1;
        return { s: 'failed', body: { ok: false, failure: 'snapshot-gone' as DocsFailure } };
      }
      const part = src.slice(offset, offset + length);
      const digest = offset === opts.badDigestAt ? '0'.repeat(64) : await hex(part);
      return { s: 'ok', value: { snapshot, offset, bytesB64: b64(part), digest, total: src.length } };
    },
  };
  return { loader, calls };
}

async function hex(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function b64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

const FRAME = DOCS_RANGE_FRAME_BYTES;
const SRC = new Uint8Array(2 * FRAME + 1234).map((_, i) => (i * 31 + 7) & 255);
const TARGET: RangeTarget = {
  project: 'demo', pin: { kind: 'committed', commit: 'c'.repeat(40), servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'big.md' },
  range: { kind: 'blob', sha: 'b'.repeat(40) }, size: SRC.length,
};
const noProgress = (): void => undefined;

// Each case moves about 1.3 MB through base64 and SHA-256 in the fake loader: a loaded test slice needs more than 5 s.
describe('readRange', { timeout: 30000 }, () => {
  it('range reassembly: frames in order make the blob', async () => {
    const { loader, calls } = fakeLoader(SRC);
    const seen: [number, number][] = [];
    const r = await readRange(loader, TARGET, { signal: new AbortController().signal, onProgress: (d, t) => seen.push([d, t]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes).toEqual(SRC);
    expect(calls).toEqual(['prepare 1', `frame s1 0 ${FRAME}`, `frame s1 ${FRAME} ${FRAME}`, `frame s1 ${2 * FRAME} 1234`]);
    expect(seen).toEqual([[FRAME, SRC.length], [2 * FRAME, SRC.length], [SRC.length, SRC.length]]);
    expect(r.digest).toBe(await hex(SRC));
  });

  it('range reassembly: one buffer, sized from the prepare, holds every frame', async () => {
    const { loader } = fakeLoader(SRC);
    const made: number[] = [];
    const Real = Uint8Array;
    const r = await readRange(loader, TARGET, {
      signal: new AbortController().signal, onProgress: noProgress, alloc: (n) => { made.push(n); return new Real(n); },
    });
    expect(made, 'one allocation, of the prepare\'s size').toEqual([SRC.length]);
    expect(r.ok && r.bytes.buffer.byteLength).toBe(SRC.length);
  });

  it('range reassembly: the bytes answered are the one buffer allocated', async () => {
    const { loader } = fakeLoader(SRC);
    let given: Uint8Array | null = null;
    const r = await readRange(loader, TARGET, {
      signal: new AbortController().signal, onProgress: noProgress, alloc: (n) => { given = new Uint8Array(n); return given as Uint8Array<ArrayBuffer>; },
    });
    expect(r.ok && r.bytes).toBe(given);
  });

  it('range reassembly: a frame naming another snapshot, offset or total, or holding another length, fails the read', async () => {
    const cases: [string, (f: { snapshot: string; offset: number; bytesB64: string; total: number }) => object][] = [
      ['snapshot', (f) => ({ ...f, snapshot: 'other' })],
      ['offset', (f) => ({ ...f, offset: f.offset + 1 })],
      ['total', (f) => ({ ...f, total: f.total + 1 })],
      ['length', (f) => ({ ...f, bytesB64: b64(new Uint8Array(3)) })],
      ['base64', (f) => ({ ...f, bytesB64: '%%%' })],
    ];
    for (const [what, bend] of cases) {
      const { loader } = fakeLoader(SRC);
      const real = loader.frame.bind(loader);
      loader.frame = async (...a) => {
        const ans = await real(...a);
        return ans.s === 'ok' && a[2] === FRAME ? { s: 'ok', value: bend(ans.value) as never } : ans;
      };
      const r = await readRange(loader, TARGET, { signal: new AbortController().signal, onProgress: noProgress });
      expect(r.ok, what).toBe(false);
      expect(!r.ok && r.why, what).toEqual({ kind: 'frame-mismatch', offset: FRAME });
    }
  });

  it('range reassembly: an abort while a frame is in flight drops every frame, whether the loader rejects or resolves', async () => {
    for (const rejects of [true, false]) {
      const ac = new AbortController();
      const { loader, calls } = fakeLoader(SRC);
      const real = loader.frame.bind(loader);
      loader.frame = async (...a) => {
        if (a[2] === FRAME) {
          ac.abort();
          if (rejects) throw new DOMException('aborted', 'AbortError');
        }
        return real(...a);
      };
      const r = await readRange(loader, TARGET, { signal: ac.signal, onProgress: noProgress });
      expect(r.ok, `rejects ${rejects}`).toBe(false);
      expect(!r.ok && r.why, `rejects ${rejects}`).toEqual({ kind: 'aborted' });
      expect(calls.filter((c) => c.startsWith('frame')).length, 'nothing after the frame in flight').toBeLessThanOrEqual(2);
    }
  });

  it('range reassembly: an origin without crypto.subtle reads nothing and says no-digest', async () => {
    const { loader, calls } = fakeLoader(SRC);
    vi.stubGlobal('crypto', {});
    try {
      const r = await readRange(loader, TARGET, { signal: new AbortController().signal, onProgress: noProgress });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.why).toEqual({ kind: 'no-digest' });
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('range reassembly: a frame with a bad digest fails the read', async () => {
    const { loader, calls } = fakeLoader(SRC, { badDigestAt: FRAME });
    const r = await readRange(loader, TARGET, { signal: new AbortController().signal, onProgress: noProgress });
    expect(r.ok, 'the read fails').toBe(false);
    expect(!r.ok && r.why).toEqual({ kind: 'frame-digest', offset: FRAME });
    expect(calls.length, 'no frame after the bad one').toBe(3);
  });

  it('range reassembly: cancel drops every frame', async () => {
    const ac = new AbortController();
    const { loader, calls } = fakeLoader(SRC);
    const progress: number[] = [];
    const r = await readRange(loader, TARGET, {
      signal: ac.signal, onProgress: (d) => { progress.push(d); if (d === FRAME) ac.abort(); },
    });
    expect(r.ok, 'the read fails').toBe(false);
    expect(!r.ok && r.why).toEqual({ kind: 'aborted' });
    expect(calls, 'no further request after the abort').toEqual(['prepare 1', `frame s1 0 ${FRAME}`]);
    expect(progress).toEqual([FRAME]);
  });

  it('range reassembly: snapshot-gone restarts from prepare once, then fails', async () => {
    const once = fakeLoader(SRC, { gone: 1 });
    const r1 = await readRange(once.loader, TARGET, { signal: new AbortController().signal, onProgress: noProgress });
    expect(r1.ok).toBe(true);
    expect(once.calls.filter((c) => c.startsWith('prepare'))).toEqual(['prepare 1', 'prepare 2']);
    const twice = fakeLoader(SRC, { gone: 2 });
    const r2 = await readRange(twice.loader, TARGET, { signal: new AbortController().signal, onProgress: noProgress });
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.why.kind === 'answer' && r2.why.answer.s === 'failed' && r2.why.answer.body.failure).toBe('snapshot-gone');
    expect(twice.calls.filter((c) => c.startsWith('prepare')).length, 'one restart only').toBe(2);
  });

  it('range reassembly: a prepare whose size differs from the listing, or passes the ceiling, allocates nothing and fails', async () => {
    for (const [size, kind] of [[SRC.length + 1, 'size-mismatch'], [DOCS_RANGE_MAX_BYTES + 1, 'over-ceiling']] as const) {
      const { loader, calls } = fakeLoader(SRC, { size });
      const made: number[] = [];
      const target = kind === 'over-ceiling' ? { ...TARGET, size } : TARGET;
      const r = await readRange(loader, target, { signal: new AbortController().signal, onProgress: noProgress, alloc: (n) => { made.push(n); return new Uint8Array(n); } });
      expect(r, kind).toEqual({ ok: false, why: { kind } });
      expect(made, `${kind}: nothing allocated`).toEqual([]);
      expect(calls, `${kind}: no frame read`).toEqual(['prepare 1']);
    }
  });

  it('range reassembly: frames that each check but do not make the prepare\'s digest fail the read, so fp is measured', async () => {
    const { loader } = fakeLoader(SRC);
    const real = loader.prepare.bind(loader);
    loader.prepare = async (...a) => {
      const ans = await real(...a);
      return ans.s === 'ok' ? { s: 'ok', value: { ...ans.value, digest: 'c'.repeat(64) } } : ans;
    };
    const r = await readRange(loader, TARGET, { signal: new AbortController().signal, onProgress: noProgress });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toEqual({ kind: 'whole-digest' });
  });

  it('range reassembly: an already aborted signal reads nothing', async () => {
    const ac = new AbortController();
    ac.abort();
    const { loader, calls } = fakeLoader(SRC);
    expect(await readRange(loader, TARGET, { signal: ac.signal, onProgress: noProgress })).toEqual({ ok: false, why: { kind: 'aborted' } });
    expect(calls).toEqual([]);
  });

  it('b64Bytes: decodes base64, and answers null for text that is not base64', () => {
    expect(b64Bytes('AAEC/w==')).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(b64Bytes('%%%')).toBeNull();
  });
});
