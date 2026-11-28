// Changes since on the current part (X2 P6.1 Step 0c (b); spec 4.3, "Markdown in parts": Export and Changes since act on the
// whole text when the file was read whole, up to 2 MiB, and above 2 MiB on the current part, and say so). `partChangeTexts`
// (`reader/partChanges.ts`, L1, pure) answers the frame's marks for one part's rendered text: the whole diff clipped to the part
// when both sides are within `readerDiff`'s bounds, else the part's own region, aligned by the common head and tail of the two
// texts. `startReaderHistory` reads the base of a part (by range, from the blob the `too-large` answer names, when it is above
// the class cap) and takes the head's whole text from the part context. The part bar says it once the text is above 2 MiB.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { DOCS_MAX_DOC_BYTES, type DocPin, type DocsShowOk } from '../../shared/docs';
import type { DocsFileAnswer } from '../src/docs/failures';
import { createFetchQueue } from '../src/docs/fetchQueue';
import { readerDiff } from '../src/docs/reader/diff';
import { partChangeTexts } from '../src/docs/reader/partChanges';
import { startReaderHistory } from '../src/docs/readerHistory';
import { MarkdownParts } from '../src/docs/range/MarkdownParts';
import { partText, type MdPart } from '../src/docs/range/mdParts';
import type { RangeLoader, RangeTarget } from '../src/docs/range/readRange';
import { failedAnswer, fileResponse, pageAt, servingLoader } from './docsFixtures';

const lines = (n: number, f: (k: number) => string = (k) => `line ${k}`): string[] => Array.from({ length: n }, (_, k) => f(k + 1));
const textOf = (ls: readonly string[]): string => ls.join('\n') + '\n';
/** The offset where the 1-based line `n` of `t` starts. */
function lineStart(t: string, n: number): number {
  let at = 0;
  for (let k = 1; k < n; k += 1) at = t.indexOf('\n', at) + 1;
  return at;
}
const plain = (start: number, end: number, extra: Partial<MdPart> = {}): MdPart =>
  ({ start, end, continued: false, reopen: null, close: null, ...extra });

describe('changes since: the part of a document read whole', () => {
  // Twelve lines; the second text changes line 3 and line 9 and drops line 11: the whole diff is ranges [3,3] and [9,9], and a
  // removal after lines 2, 8 and 10.
  const before = textOf(lines(12));
  const afterLines = lines(12).filter((_, k) => k !== 10);
  afterLines[2] = 'THREE';
  afterLines[8] = 'NINE';
  const after = textOf(afterLines);
  const cut = lineStart(after, 7);

  it('changes since: a part of a document read whole marks the whole diff\'s changes inside this part only', () => {
    const first = plain(0, cut);
    const second = plain(cut, after.length);
    expect(partChangeTexts(before, after, first, partText(after, first))).toEqual({ ranges: [[3, 3]], removedAfter: [2] });
    expect(partChangeTexts(before, after, second, partText(after, second))).toEqual({ ranges: [[3, 3]], removedAfter: [2, 4] });
  });

  it('changes since: a reopened part\'s marks are shifted by its reopen line', () => {
    const second = plain(cut, after.length, { reopen: '```md\n', close: '```\n' });
    // The reopen line is the rendered text's first line; the close line adds no line of the document.
    expect(partChangeTexts(before, after, second, partText(after, second))).toEqual({ ranges: [[4, 4]], removedAfter: [3, 5] });
    // A reopen that is a marker with no line ending of its own shifts nothing.
    const marker = plain(cut, after.length, { reopen: '- ' });
    expect(partChangeTexts(before, after, marker, partText(after, marker))).toEqual({ ranges: [[3, 3]], removedAfter: [2, 4] });
  });

  it('changes since: a rendered text that is not this part\'s is unavailable', () => {
    const second = plain(cut, after.length);
    expect(partChangeTexts(before, after, second, partText(after, second) + 'x')).toBeNull();
    expect(partChangeTexts(before, after, second, partText(after, plain(0, cut)))).toBeNull();
    expect(partChangeTexts(before, after, plain(cut, after.length, { reopen: '```\n' }), partText(after, second))).toBeNull();
  });

  it('changes since: a part wholly in the unchanged lines has no marks', () => {
    const tail = textOf(lines(12, (k) => `same ${k}`));
    const b = textOf(['one', 'two']) + tail;
    const a = textOf(['ONE', 'TWO']) + tail;
    const head = plain(0, lineStart(a, 3));
    const rest = plain(lineStart(a, 3), a.length);
    expect(partChangeTexts(b, a, rest, partText(a, rest))).toEqual({ ranges: [], removedAfter: [] });
    expect(partChangeTexts(b, a, head, partText(a, head))?.ranges).toEqual([[1, 2]]);
  });
});

describe('changes since: a part of a document above 2 MiB', () => {
  const N = 60000;
  const row = (k: number): string => `row ${String(k).padStart(7, '0')} ${'z'.repeat(40)}`;
  const beforeLines = lines(N, row);
  const afterLines = beforeLines.slice();
  afterLines[30000] = 'CHANGED';
  afterLines.splice(30010, 0, 'INS1', 'INS2');
  const before = textOf(beforeLines);
  const after = textOf(afterLines);

  it('is above the whole bounds, so the region form is the one under test', () => {
    expect(before.length).toBeGreaterThan(DOCS_MAX_DOC_BYTES);
    expect(after.length).toBeGreaterThan(DOCS_MAX_DOC_BYTES);
  });

  it('changes since: a part of a document read by range marks its own region, aligned by the unchanged lines before and after', () => {
    // After-lines 29991 to 30030: the replaced line is after-line 30001 (rendered 11), the inserted two are 30011 and 30012 (21 and 22).
    const part = plain(lineStart(after, 29991), lineStart(after, 30031));
    expect(partChangeTexts(before, after, part, partText(after, part))).toEqual({ ranges: [[11, 11], [21, 22]], removedAfter: [10] });
    // A part that starts in the changed middle and ends past it is compared with the whole middle of the base, so the removal
    // just above it (the replaced line) is marked at its top: the straddle the header names.
    const late = plain(lineStart(after, 30005), lineStart(after, 30030));
    expect(partChangeTexts(before, after, late, partText(after, late))).toEqual({ ranges: [[7, 8]], removedAfter: [0] });
  });

  it('changes since: a part wholly in the unchanged lines has no marks (above 2 MiB)', () => {
    const head = plain(lineStart(after, 100), lineStart(after, 600));
    const tail = plain(lineStart(after, 40000), lineStart(after, 40500));
    expect(partChangeTexts(before, after, head, partText(after, head))).toEqual({ ranges: [], removedAfter: [] });
    expect(partChangeTexts(before, after, tail, partText(after, tail))).toEqual({ ranges: [], removedAfter: [] });
  });

  it('changes since: a part past an unchanged prefix maps its reopen line by the lines of its reopen', () => {
    const part = plain(lineStart(after, 29991), lineStart(after, 30031), { reopen: '```ts\n', close: '```\n' });
    expect(partChangeTexts(before, after, part, partText(after, part))).toEqual({ ranges: [[12, 12], [22, 23]], removedAfter: [11] });
  });

  it('changes since: a base that is absent (the empty text) marks every line of the part', () => {
    const part = plain(lineStart(after, 100), lineStart(after, 110));
    expect(partChangeTexts('', after, part, partText(after, part))).toEqual({ ranges: [[1, 10]], removedAfter: [] });
  });

  it('changes since: a changed middle larger than the bound is unavailable, never a partial answer', () => {
    const wild = textOf(lines(N, (k) => `other ${k} ${'q'.repeat(40)}`));
    const part = plain(lineStart(after, 100), lineStart(after, 600));
    expect(partChangeTexts(wild, after, part, partText(after, part))).toBeNull();
  });

  it('changes since: a 64 MiB pair is aligned without an array of its lines', () => {
    const one = 'x'.repeat(63) + '\n';
    const half = one.repeat(1 << 19);
    const b = half + 'old\n' + half;
    const a = half + 'new\n' + half;
    expect(a.length).toBeGreaterThan(64 * 1024 * 1024);
    const part = plain(half.length - 64 * 10, half.length + 4 + 64 * 10);
    const rendered = partText(a, part);
    const sizes: number[] = [];
    const real = String.prototype.split;
    const spy = vi.spyOn(String.prototype, 'split').mockImplementation(function (this: string, ...args: Parameters<typeof real>) {
      sizes.push(this.length);
      return real.apply(this, args);
    });
    let marks: ReturnType<typeof partChangeTexts>;
    let none: ReturnType<typeof partChangeTexts>;
    try {
      marks = partChangeTexts(b, a, part, rendered);
      const head = plain(0, 640);
      none = partChangeTexts(b, a, head, partText(a, head));
    } finally {
      spy.mockRestore();
    }
    expect(marks).toEqual({ ranges: [[11, 11]], removedAfter: [10] });
    expect(none).toEqual({ ranges: [], removedAfter: [] });
    // Every string split is a part or a part-sized slice, never the 64 MiB text or its middle.
    expect(sizes.length > 0 ? Math.max(...sizes) : 0).toBeLessThan(DOCS_MAX_DOC_BYTES);
  });
});

describe('changes since: a removal at a part edge in the region form', () => {
  const N = 60000;
  const rows = lines(N, (k) => `row ${String(k).padStart(7, '0')} ${'z'.repeat(40)}`);
  const before = textOf(rows);
  /** The part holding the after-lines `a` to `b`, inclusive. */
  const lineParts = (t: string, a: number, b: number): MdPart => plain(lineStart(t, a), lineStart(t, b + 1));
  const marks = (t: string, p: MdPart): ReturnType<typeof partChangeTexts> => partChangeTexts(before, t, p, partText(t, p));

  it('changes since: five lines deleted exactly at the boundary of two parts are marked once, after the last line of the part before', () => {
    const after = textOf([...rows.slice(0, 30000), ...rows.slice(30005)]);
    expect(marks(after, lineParts(after, 29990, 30000))).toEqual({ ranges: [], removedAfter: [11] });
    expect(marks(after, lineParts(after, 30001, 30010))).toEqual({ ranges: [], removedAfter: [] });
    // A part holding the point inside it marks it too, as before.
    expect(marks(after, lineParts(after, 29995, 30005))).toEqual({ ranges: [], removedAfter: [6] });
  });

  it('changes since: the first lines deleted are marked before the first line of the first part, and not in the next', () => {
    const after = textOf(rows.slice(3));
    expect(marks(after, lineParts(after, 1, 10))).toEqual({ ranges: [], removedAfter: [0] });
    expect(marks(after, lineParts(after, 11, 20))).toEqual({ ranges: [], removedAfter: [] });
  });

  it('changes since: the last lines deleted are marked after the last line of the last part, and not in the one before', () => {
    const after = textOf(rows.slice(0, N - 3));
    expect(marks(after, lineParts(after, N - 12, N - 3))).toEqual({ ranges: [], removedAfter: [10] });
    expect(marks(after, lineParts(after, N - 22, N - 13))).toEqual({ ranges: [], removedAfter: [] });
  });

  it('changes since: lines replaced at the boundary of two parts mark their removal in the part before and their lines in the part after', () => {
    const after = textOf([...rows.slice(0, 30000), 'A', 'B', ...rows.slice(30005)]);
    expect(marks(after, lineParts(after, 29990, 30000))).toEqual({ ranges: [], removedAfter: [11] });
    expect(marks(after, lineParts(after, 30001, 30010))).toEqual({ ranges: [[1, 2]], removedAfter: [] });
  });

  it('changes since: the removal at a reopened part\'s end is marked after its last line, shifted by its reopen line', () => {
    const after = textOf([...rows.slice(0, 30000), ...rows.slice(30005)]);
    const part = { ...lineParts(after, 29990, 30000), reopen: '```ts\n', close: '```\n' };
    expect(marks(after, part)).toEqual({ ranges: [], removedAfter: [12] });
  });
});

describe('changes since: the whole form\'s removal before the first line', () => {
  it('changes since: a removal before line 1 is owned by the first part, and by no other', () => {
    const b = textOf(lines(12));
    const a = textOf(lines(12).slice(2));
    const first = plain(0, lineStart(a, 5));
    const second = plain(lineStart(a, 5), a.length);
    expect(partChangeTexts(b, a, first, partText(a, first))).toEqual({ ranges: [], removedAfter: [0] });
    expect(partChangeTexts(b, a, second, partText(a, second))).toEqual({ ranges: [], removedAfter: [] });
  });
});

describe('changes since: the form follows how the head was read', () => {
  const short = (k: number): string => `r${k}`;

  it('changes since: a 30 000-line document read whole is unavailable in parts, as the 20 000-line cap says', () => {
    const ls = lines(30000, short);
    const changed = ls.slice();
    changed[5] = 'X';
    const b = textOf(ls);
    const a = textOf(changed);
    expect(a.length).toBeLessThan(DOCS_MAX_DOC_BYTES);
    expect(readerDiff(b, a)).toMatchObject({ kind: 'unavailable', why: 'lines' });
    const first = plain(0, lineStart(a, 101));
    expect(partChangeTexts(b, a, first, partText(a, first))).toBeNull();
  });

  it('changes since: a base above 2 MiB with a head at or below it is unavailable', () => {
    const big = textOf(lines(60000, (k) => `row ${String(k).padStart(7, '0')} ${'z'.repeat(40)}`));
    const a = textOf(lines(12));
    const only = plain(0, a.length);
    expect(big.length).toBeGreaterThan(DOCS_MAX_DOC_BYTES);
    expect(partChangeTexts(big, a, only, partText(a, only))).toBeNull();
  });

  it('changes since: a 25 000-line document not in parts stays unavailable', async () => {
    const ls = lines(25000, short);
    const changed = ls.slice();
    changed[5] = 'X';
    const base = textOf(ls);
    const head = textOf(changed);
    const file = vi.fn(async (_p: string, pin: DocPin): Promise<DocsFileAnswer> =>
      ({ s: 'ok', value: fileResponse(pin.kind === 'committed' && pin.commit === BASE ? base : head) }));
    const body = startReaderHistory({
      project: 'demo', show: showOf(head), text: head, pin: headPin,
      page: () => pageAt('/docs/demo/specs/a.md') as never, only: null, history: null,
      loaders: { file }, queue: createFetchQueue(), signal: new AbortController().signal,
    });
    expect(await body.changes(BASE)).toBeNull();
  });
});

describe('partChanges.ts: its imports', () => {
  it('imports only the line diff, the part cutter\'s partText and L0, and no React, no loader', () => {
    const src = readFileSync(resolve(__dirname, '../src/docs/reader/partChanges.ts'), 'utf8');
    const specs = [...src.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1]);
    for (const s of specs) expect(['./diff', '../range/mdParts', '../../../../shared/docs', '../../../../shared/utf8'], s).toContain(s);
  });
});

// ---- the history adapter --------------------------------------------------------------------------------------------------

const SERVED = 'refs/remotes/origin/main';
const HEAD = '1'.repeat(40);
const BASE = 'b'.repeat(40);
const BLOB = 'a'.repeat(40);
const headPin: DocPin = { kind: 'committed', commit: HEAD, servedRef: SERVED, section: 'specs', path: 'a.md' };
const draftPin: DocPin = { kind: 'draft', branch: 'main', head: HEAD, section: 'specs', path: 'a.md', fp: 'f'.repeat(64) };
const showOf = (text: string, draft = false): DocsShowOk => {
  const s = fileResponse(text).show;
  return draft ? { ...s, source: 'draft', head: HEAD, fp: 'f'.repeat(64) } : { ...s, source: 'committed', commit: HEAD };
};

function rig(o: { pin?: DocPin; before: string; baseFile: DocsFileAnswer; bytes?: Uint8Array<ArrayBuffer> }) {
  const file = vi.fn(async (_p: string, pin: DocPin): Promise<DocsFileAnswer> => {
    if (pin.kind === 'committed' && pin.commit === BASE) return o.baseFile;
    throw new Error('the head is never read again');
  });
  // The screen's queue, counting the jobs that run, so a case can say which calls went through it.
  const inner = createFetchQueue();
  let running = 0;
  const queue = { run: <T,>(job: (s: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => inner.run(async (s) => {
    running += 1;
    try { return await job(s); } finally { running -= 1; }
  }, signal), dispose: () => { inner.dispose(); } };
  const targets: RangeTarget[] = [];
  const queued: boolean[] = [];
  const served = servingLoader(o.bytes ?? new TextEncoder().encode(o.before));
  const range: RangeLoader = {
    prepare: (t, s) => { targets.push(t); queued.push(running > 0); return served.loader.prepare(t, s); },
    frame: (t, snap, off, len, s) => { queued.push(running > 0); return served.loader.frame(t, snap, off, len, s); },
  };
  return { file, range, targets, served, queue, queued };
}

describe('changes since: the base of a part is read through the history', () => {
  const N = 60000;
  const row = (k: number): string => `row ${String(k).padStart(7, '0')} ${'z'.repeat(40)}`;
  const beforeLines = lines(N, row);
  const afterLines = beforeLines.slice();
  afterLines[30000] = 'CHANGED';
  const before = textOf(beforeLines);
  const whole = textOf(afterLines);
  const part = plain(lineStart(whole, 29991), lineStart(whole, 30031));
  const rendered = partText(whole, part);
  const start = (r: ReturnType<typeof rig>, over: {
    pin?: DocPin; draft?: boolean; part?: { whole: string; part: MdPart } | null; signal?: AbortSignal; noRange?: boolean;
  } = {}) =>
    startReaderHistory({
      project: 'demo', show: showOf(rendered, over.draft === true), text: rendered, pin: over.pin ?? headPin,
      page: () => pageAt('/docs/demo/specs/a.md') as never, only: null, history: null,
      loaders: over.noRange === true ? { file: r.file } : { file: r.file, range: r.range }, queue: r.queue,
      signal: over.signal ?? new AbortController().signal,
      part: over.part === undefined ? { whole, part } : over.part,
    });

  afterEach(() => { cleanup(); });

  it('changes since: the base of a part above 2 MiB is read by range from the blob the too-large answer names', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    const marks = await start(r).changes(BASE);
    expect(marks).toEqual({ ranges: [[11, 11]], removedAfter: [10] });
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]!.range).toEqual({ kind: 'blob', sha: BLOB });
    expect(r.targets[0]!.size).toBe(before.length);
    expect(r.targets[0]!.pin).toMatchObject({ kind: 'committed', commit: BASE, path: 'a.md' });
    // The head's whole text is the part context's: the file route is asked for the base alone.
    expect(r.file).toHaveBeenCalledTimes(1);
    expect(r.file.mock.calls[0]![1]).toMatchObject({ commit: BASE });
  });

  it('changes since: a too-large base that names no blob is unavailable, and nothing is read by range', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES }) as DocsFileAnswer });
    expect(await start(r).changes(BASE)).toBeNull();
    expect(r.targets).toHaveLength(0);
  });

  it('changes since: a base the range read fails on is unavailable', async () => {
    const r = rig({ before: 'short', baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    expect(await start(r).changes(BASE)).toBeNull();
  });

  it('changes since: a base read by range is aborted with the body', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    const ac = new AbortController();
    const pending = start(r, { signal: ac.signal }).changes(BASE);
    ac.abort();
    expect(await pending).toBeNull();
  });

  it('changes since: a base that is not UTF-8 is unavailable', async () => {
    const bytes = Uint8Array.of(0xff, 0xfe, 0x0a);
    const r = rig({ before: '', bytes, baseFile: failedAnswer('too-large', { size: bytes.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    expect(await start(r).changes(BASE)).toBeNull();
    expect(r.targets).toHaveLength(1);
  });

  it('changes since: a too-large base with no range loader is unavailable', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    expect(await start(r, { noRange: true }).changes(BASE)).toBeNull();
    expect(r.targets).toHaveLength(0);
  });

  it('changes since: the range read of a base runs its prepare and frames through the screen\'s fetch queue', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    expect(await start(r).changes(BASE)).not.toBeNull();
    expect(r.queued.length).toBeGreaterThan(1);
    expect(r.queued.every((q) => q)).toBe(true);
  });

  it('changes since: the base read for a commit is kept for the history\'s life, one entry, and dropped when it ends', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    const ac = new AbortController();
    const body = start(r, { signal: ac.signal });
    const first = await body.changes(BASE);
    const again = await body.changes(BASE);
    expect(first).not.toBeNull();
    expect(again).toEqual(first);
    expect(r.targets, 'the same commit is read once').toHaveLength(1);
    expect(r.file).toHaveBeenCalledTimes(1);
    // Another commit replaces the entry (one entry), and asking the first again reads it again.
    const OTHER = 'c'.repeat(40);
    r.file.mockImplementationOnce(async () => ({ s: 'ok', value: fileResponse(before) }));
    await body.changes(OTHER);
    await body.changes(BASE);
    expect(r.file).toHaveBeenCalledTimes(3);
    ac.abort();
    expect(await body.changes(BASE)).toBeNull();
  });

  it('changes since: a base that was unavailable is read again by the next ask', async () => {
    const r = rig({ before: 'short', baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    const body = start(r);
    expect(await body.changes(BASE)).toBeNull();
    expect(await body.changes(BASE)).toBeNull();
    expect(r.file).toHaveBeenCalledTimes(2);
  });

  it('changes since: a base under the class cap is read through the file route, and the part is marked from it', async () => {
    const small = textOf(lines(12));
    const smallAfterLines = lines(12);
    smallAfterLines[8] = 'NINE';
    const smallWhole = textOf(smallAfterLines);
    const second = plain(lineStart(smallWhole, 7), smallWhole.length);
    const smallRendered = partText(smallWhole, second);
    const r = rig({ before: '', baseFile: { s: 'ok', value: fileResponse(small) } });
    const body = startReaderHistory({
      project: 'demo', show: showOf(smallRendered), text: smallRendered, pin: headPin,
      page: () => pageAt('/docs/demo/specs/a.md') as never, only: null, history: null,
      loaders: { file: r.file, range: r.range }, queue: createFetchQueue(), signal: new AbortController().signal,
      part: { whole: smallWhole, part: second },
    });
    expect(await body.changes(BASE)).toEqual({ ranges: [[3, 3]], removedAfter: [2] });
    expect(r.targets).toHaveLength(0);
  });

  it('changes since: a path absent at the base marks every line of the part', async () => {
    const r = rig({ before: '', baseFile: failedAnswer('absent-path') as DocsFileAnswer });
    const marks = await start(r).changes(BASE);
    expect(marks?.ranges).toEqual([[1, 40]]);
  });

  it('changes since: a draft\'s part stays unavailable', async () => {
    const r = rig({ pin: draftPin, before, baseFile: { s: 'ok', value: fileResponse(before) } });
    expect(await start(r, { pin: draftPin, draft: true }).changes(BASE)).toBeNull();
    expect(r.file).not.toHaveBeenCalled();
    expect(r.targets).toHaveLength(0);
  });

  it('changes since: a part whose rendered text is not the context\'s part is unavailable', async () => {
    const r = rig({ before, baseFile: failedAnswer('too-large', { size: before.length, cap: DOCS_MAX_DOC_BYTES, blob: BLOB }) as DocsFileAnswer });
    const other = plain(lineStart(whole, 100), lineStart(whole, 200));
    expect(await start(r, { part: { whole, part: other } }).changes(BASE)).toBeNull();
  });

  it('changes since: a body not in parts is unchanged', async () => {
    const base = textOf(lines(4));
    const head = textOf(['line 1', 'NEW', 'line 3', 'line 4']);
    const file = vi.fn(async (_p: string, pin: DocPin): Promise<DocsFileAnswer> =>
      ({ s: 'ok', value: fileResponse(pin.kind === 'committed' && pin.commit === BASE ? base : head) }));
    const body = startReaderHistory({
      project: 'demo', show: showOf(head), text: head, pin: headPin,
      page: () => pageAt('/docs/demo/specs/a.md') as never, only: null, history: null,
      loaders: { file }, queue: createFetchQueue(), signal: new AbortController().signal,
    });
    expect(await body.changes(BASE)).toEqual({ ranges: [[2, 2]], removedAfter: [1] });
    // Both texts through the file route, as before, and a head that is not the rendered text still refuses.
    expect(file).toHaveBeenCalledTimes(2);
    const refused = startReaderHistory({
      project: 'demo', show: showOf(head), text: head + 'x', pin: headPin,
      page: () => pageAt('/docs/demo/specs/a.md') as never, only: null, history: null,
      loaders: { file }, queue: createFetchQueue(), signal: new AbortController().signal, part: null,
    });
    expect(await refused.changes(BASE)).toBeNull();
  });
});

describe('parts: the bar says what Changes since and Export act on', () => {
  const SAY = 'Changes since and Export act on this part.';
  const big = (bytes: number): string => ('word '.repeat(15) + '\n').repeat(Math.ceil(bytes / 76));

  afterEach(() => { cleanup(); });

  it('parts: a document above 2 MiB in parts says Changes since and Export act on this part', () => {
    const { container } = render(createElement(MarkdownParts, { text: big(2 * 1024 * 1024 + 1024), pre: null, fragment: null, renderPart: () => null }));
    expect(container.textContent).toContain(SAY);
    expect(container.querySelector('.docs-parts')).not.toBeNull();
  });

  it('parts: a 600 KiB document in parts says nothing of the kind', () => {
    const { container } = render(createElement(MarkdownParts, { text: big(600 * 1024), pre: null, fragment: null, renderPart: () => null }));
    expect(container.querySelector('.docs-parts')).not.toBeNull();
    expect(container.textContent).not.toContain(SAY);
  });
});
