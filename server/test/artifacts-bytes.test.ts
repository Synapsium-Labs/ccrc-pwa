// Native Docs HTML artifacts X5, plan Task A3.3 part 3: the bytes port's adapter over the console's docs reads
// (`artifactBytes`, `server/src/docs/routes.ts`; the L1 words and jobs in `server/src/docs/policy.ts`). Every case builds the adapter over
// a REAL `composeDocs` (the real `ccdDocsReader` checks and the real read lane) and a scripted `CcdRunner`, with a fleet state that
// grants docs and docs-range, so each answer goes through the same checks the console's own reads do. The runner records every argv
// it is sent; the scripted tree is never consulted (no tree read is ever scripted), so a read that named the tip would show in the argv.
// Hosts and projects are placeholders: the project is `project-a`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_CAP, DOCS_RANGE_CAP } from '../src/ccdargv.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { ArtifactReadAt, ArtifactSinkAnswer } from '../src/artifacts/ports.js';
import type { ArtifactManifestEntry } from '../src/artifacts/store.js';
import { docsReadLane, type DocsReadLane } from '../src/docs/lane.js';
import { artifactJob, artifactReadWord, artifactShowJob, showWire, type DocsJob } from '../src/docs/policy.js';
import { artifactBytes, composeDocs } from '../src/docs/routes.js';
import { DOCS_RANGE_FRAME_BYTES, type DocPin, type DocsRangePin } from '../../shared/docs.js';
import { line, nodeLanes, okRes, scripted, sha256Hex, showLine, until } from './docsRouteHelpers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Fixtures ----

const PROJECT = 'project-a';
const COMMIT = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const SERVED = 'refs/remotes/origin/main';
const DRAFT_SERVED = 'refs/heads/feature';
const BLOB = 'b'.repeat(40);
const SNAP = 'e'.repeat(32);
const MTIME = '1700000000000000000';
const PAGE = 'x/page.html';
const FILE_PATH = 'x/app.js';
const LIVE = new AbortController().signal;
const FRAME = DOCS_RANGE_FRAME_BYTES;

const COMMITTED_AT: ArtifactReadAt = {
  project: PROJECT,
  pin: { kind: 'committed', commit: COMMIT, servedRef: SERVED, section: 'specs', path: PAGE },
  ref: { commit: COMMIT, served: SERVED },
  section: 'specs',
  path: FILE_PATH,
};
const DRAFT_AT: ArtifactReadAt = {
  project: PROJECT,
  pin: { kind: 'draft', branch: 'feature', head: HEAD, section: 'specs', path: PAGE, fp: 'd'.repeat(64) },
  ref: { commit: HEAD, served: DRAFT_SERVED },
  section: 'specs',
  path: FILE_PATH,
};

const blobPin = (sha = BLOB): DocsRangePin => ({ kind: 'blob', sha });
const entry = (pin: DocsRangePin, size: number): ArtifactManifestEntry =>
  ({ rel: 'app.js', pin, size, mime: 'text/javascript', committed: pin.kind === 'blob' });

const rangeLine = (o: Record<string, unknown>): string => line({ v: 1, verb: 'docs-show-range', ok: true, elapsedMs: 2, ...o });
const failureLine = (verb: string, failure: string): string => line({ v: 1, verb, ok: false, elapsedMs: 1, failure });
const flag = (argv: string[], name: string): string => argv[argv.indexOf(name) + 1]!;

/** The scripted ccd over one file: a show answers the whole file under the pin the argv names, a prepare the snapshot of it, a
 *  frame the slice it is asked for. */
function ccdOver(file: Buffer): (argv: string[]) => CcdResult {
  return (argv) => {
    if (argv[0] === 'docs-show') {
      const pin: DocPin = argv.includes('--draft-branch')
        ? {
          kind: 'draft', branch: flag(argv, '--draft-branch'), head: flag(argv, '--head'), section: 'specs', path: flag(argv, '--path'),
          fp: flag(argv, '--fingerprint'),
        }
        : { kind: 'committed', commit: flag(argv, '--commit'), servedRef: flag(argv, '--ref'), section: 'specs', path: flag(argv, '--path') };
      return okRes(showLine(pin, file));
    }
    if (argv.includes('--prepare')) return okRes(rangeLine({ snapshot: SNAP, size: file.length, digest: sha256Hex(file) }));
    const offset = Number(flag(argv, '--offset'));
    const slice = file.subarray(offset, offset + Number(flag(argv, '--length')));
    return okRes(rangeLine({
      snapshot: flag(argv, '--snapshot'), offset, bytesB64: slice.toString('base64'), digest: sha256Hex(slice), total: file.length,
    }));
  };
}

/** The adapter over a real composition and a scripted runner. */
function rig(handler: (argv: string[]) => CcdResult | Promise<CcdResult>, readLane?: () => DocsReadLane) {
  const rec = scripted(handler);
  const state = { ccdVerbs: ['caps', DOCS_CAP, DOCS_RANGE_CAP] };
  const docs = composeDocs({ runCcd: rec.run, fleetState: state }, readLane === undefined ? {} : { readLane });
  return { rec, docs, bytes: artifactBytes(docs.readers, docs.lanes) };
}

/** A sink that keeps every frame it is handed and answers `after` for each. */
function collector(after: (n: number) => Promise<ArtifactSinkAnswer> | ArtifactSinkAnswer = () => 'next') {
  const frames: Uint8Array[] = [];
  return {
    frames,
    sink: async (frame: Uint8Array): Promise<ArtifactSinkAnswer> => {
      frames.push(frame);
      return after(frames.length);
    },
    joined: (): Buffer => Buffer.concat(frames),
  };
}

/** A file of `n` frames, each frame filled with its own byte, so a slice names the frame it came from. */
function framedFile(n: number, tail = 0): Buffer {
  return Buffer.concat([...Array.from({ length: n }, (_, i) => Buffer.alloc(FRAME, i + 1)), Buffer.alloc(tail, n + 1)]);
}

/** Let every pending promise step and every immediate fire a few times. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---- Cases ----

describe('content: reads name the pinned version', () => {
  const showPlace = ['docs-show', '--project', PROJECT];
  const rangePlaceCommitted = ['docs-show-range', '--project', PROJECT, '--commit', COMMIT, '--section', 'specs', '--path', FILE_PATH];
  const rangePlaceDraft = ['docs-show-range', '--project', PROJECT, '--draft-branch', 'feature', '--head', HEAD, '--section', 'specs',
    '--path', FILE_PATH];

  it('(a) a committed pin\'s small entry is docs-show at the pin\'s commit and served ref', async () => {
    const file = Buffer.from('hello');
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, entry(blobPin(), 5), { start: 0, end: 4 }, null, sunk.sink, LIVE)).toEqual({ ok: true });
    expect(rec.calls).toEqual([[...showPlace, '--commit', COMMIT, '--ref', SERVED, '--section', 'specs', '--path', FILE_PATH,
      '--max-bytes', '5']]);
  });

  it('(b) a draft pin\'s committed small entry is docs-show at the draft view\'s head and served ref', async () => {
    const file = Buffer.from('hello');
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector();
    expect(await bytes.read(DRAFT_AT, entry(blobPin(), 5), { start: 0, end: 4 }, null, sunk.sink, LIVE)).toEqual({ ok: true });
    expect(rec.calls).toEqual([[...showPlace, '--commit', HEAD, '--ref', DRAFT_SERVED, '--section', 'specs', '--path', FILE_PATH,
      '--max-bytes', '5']]);
  });

  it('(c) a draft pin\'s fp small entry is docs-show of the draft branch, head and fingerprint', async () => {
    const file = Buffer.from('hello');
    const fp = sha256Hex(file);
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector();
    expect(await bytes.read(DRAFT_AT, entry({ kind: 'fp', sha: fp }, 5), { start: 0, end: 4 }, null, sunk.sink, LIVE))
      .toEqual({ ok: true });
    expect(rec.calls).toEqual([[...showPlace, '--draft-branch', 'feature', '--head', HEAD, '--section', 'specs', '--path', FILE_PATH,
      '--fingerprint', fp, '--max-bytes', '5']]);
  });

  it('(d) a committed large entry\'s prepare and frame name its commit and blob', async () => {
    const file = Buffer.alloc(FRAME + 1000, 7);
    const { rec, bytes } = rig(ccdOver(file));
    const e = entry(blobPin(), file.length);
    expect(await bytes.prepare(COMMITTED_AT, e, LIVE)).toEqual({ ok: true, snapshot: SNAP });
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, e, { start: 0, end: file.length - 1 }, SNAP, sunk.sink, LIVE)).toEqual({ ok: true });
    expect(rec.calls).toEqual([
      [...rangePlaceCommitted, '--pin', `blob:${BLOB}`, '--prepare'],
      [...rangePlaceCommitted, '--pin', `blob:${BLOB}`, '--snapshot', SNAP, '--offset', '0', '--length', String(FRAME)],
      [...rangePlaceCommitted, '--pin', `blob:${BLOB}`, '--snapshot', SNAP, '--offset', String(FRAME), '--length', '1000'],
    ]);
  });

  it('(d) a draft pin\'s committed large entry is read at the draft view\'s head, not the draft branch', async () => {
    const file = Buffer.alloc(FRAME + 1000, 7);
    const { rec, bytes } = rig(ccdOver(file));
    expect(await bytes.prepare(DRAFT_AT, entry(blobPin(), file.length), LIVE)).toEqual({ ok: true, snapshot: SNAP });
    expect(rec.calls).toEqual([[...rangePlaceCommitted.slice(0, 3), '--commit', HEAD, '--section', 'specs', '--path', FILE_PATH,
      '--pin', `blob:${BLOB}`, '--prepare']]);
  });

  it('(e) a draft pin\'s fp and stat large entries are read by branch and head, never by commit', async () => {
    const file = Buffer.alloc(FRAME + 1000, 7);
    const fp = sha256Hex(file);
    const { rec, bytes } = rig(ccdOver(file));
    const pins: DocsRangePin[] = [{ kind: 'fp', sha: fp }, { kind: 'stat', size: file.length, mtimeNs: MTIME }];
    const texts = [`fp:${fp}`, `stat:${file.length}:${MTIME}`];
    for (const pin of pins) {
      const e = entry(pin, file.length);
      expect(await bytes.prepare(DRAFT_AT, e, LIVE)).toEqual({ ok: true, snapshot: SNAP });
      const sunk = collector();
      expect(await bytes.read(DRAFT_AT, e, { start: 0, end: 9 }, SNAP, sunk.sink, LIVE)).toEqual({ ok: true });
    }
    expect(rec.calls).toEqual(texts.flatMap((text) => [
      [...rangePlaceDraft, '--pin', text, '--prepare'],
      [...rangePlaceDraft, '--pin', text, '--snapshot', SNAP, '--offset', '0', '--length', '10'],
    ]));
    for (const argv of rec.calls) expect(argv).not.toContain('--commit');
  });
});

describe('bytes: a pin that fits no read is unreadable with no exec', () => {
  it('names an entry the pinned view cannot read', async () => {
    const file = Buffer.from('hello');
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector();
    const stat: DocsRangePin = { kind: 'stat', size: 5, mtimeNs: MTIME };
    const fp: DocsRangePin = { kind: 'fp', sha: sha256Hex(file) };
    // A stat pin has no show; an fp entry under a committed pin has no place; neither can be prepared under a committed pin.
    expect(await bytes.read(DRAFT_AT, entry(stat, 5), { start: 0, end: 4 }, null, sunk.sink, LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.read(COMMITTED_AT, entry(fp, 5), { start: 0, end: 4 }, null, sunk.sink, LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.prepare(COMMITTED_AT, entry(fp, 5), LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.prepare(COMMITTED_AT, entry(stat, 5), LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.read(COMMITTED_AT, entry(fp, 5), { start: 0, end: 4 }, SNAP, sunk.sink, LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(rec.calls).toEqual([]);
    expect(sunk.frames).toEqual([]);
  });
});

describe('bytes: a small file is cut to its range', () => {
  const file = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
  const ranges: readonly (readonly [string, number, number])[] = [
    ['the whole file', 0, 99], ['the first ten bytes', 0, 9], ['a middle slice', 40, 59], ['the last byte', 99, 99],
  ];
  it.each(ranges)('%s', async (_what, start, end) => {
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, entry(blobPin(), 100), { start, end }, null, sunk.sink, LIVE)).toEqual({ ok: true });
    expect(sunk.frames).toHaveLength(1);
    expect(sunk.joined().equals(file.subarray(start, end + 1))).toBe(true);
    expect(rec.calls).toHaveLength(1);
  });

  it('a range past the file\'s size is unreadable and nothing is handed on', async () => {
    const { bytes } = rig(ccdOver(file));
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, entry(blobPin(), 100), { start: 90, end: 100 }, null, sunk.sink, LIVE))
      .toEqual({ ok: false, error: 'unreadable' });
    expect(sunk.frames).toEqual([]);
  });
});

describe('bytes: frames in order, each after the sink', () => {
  const file = framedFile(3);
  const e = entry(blobPin(), file.length);
  const place = ['docs-show-range', '--project', PROJECT, '--commit', COMMIT, '--section', 'specs', '--path', FILE_PATH, '--pin', `blob:${BLOB}`];

  it('reads a 1.5 MiB file as three frames of at most 512 KiB, the next one only after the sink has answered', async () => {
    const { rec, bytes } = rig(ccdOver(file));
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const sunk = collector(async (n): Promise<ArtifactSinkAnswer> => {
      if (n === 1) await held;
      return 'next';
    });
    const done = bytes.read(COMMITTED_AT, e, { start: 0, end: file.length - 1 }, SNAP, sunk.sink, LIVE);
    await until(() => sunk.frames.length === 1, 'the first frame reaches the sink');
    await settle();
    expect(rec.calls, 'the second frame waits for the first sink').toHaveLength(1);
    release();
    expect(await done).toEqual({ ok: true });
    expect(rec.calls).toEqual([0, 1, 2].map((i) =>
      [...place, '--snapshot', SNAP, '--offset', String(i * FRAME), '--length', String(FRAME)]));
    expect(sunk.frames.map((f) => f.length)).toEqual([FRAME, FRAME, FRAME]);
    expect(sunk.joined().equals(file)).toBe(true);
  });

  it('cuts the first and last frame to the range', async () => {
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector();
    const start = 100;
    const end = FRAME + 5000;
    expect(await bytes.read(COMMITTED_AT, e, { start, end }, SNAP, sunk.sink, LIVE)).toEqual({ ok: true });
    expect(rec.calls).toEqual([
      [...place, '--snapshot', SNAP, '--offset', '100', '--length', String(FRAME)],
      [...place, '--snapshot', SNAP, '--offset', String(100 + FRAME), '--length', String(end + 1 - (100 + FRAME))],
    ]);
    expect(sunk.joined().equals(file.subarray(start, end + 1))).toBe(true);
  });

  it('a sink that answers stop ends the read: no second frame is asked for', async () => {
    const { rec, bytes } = rig(ccdOver(file));
    const sunk = collector(() => 'stop');
    expect(await bytes.read(COMMITTED_AT, e, { start: 0, end: file.length - 1 }, SNAP, sunk.sink, LIVE)).toEqual({ ok: true });
    expect(rec.calls).toHaveLength(1);
    expect(sunk.frames).toHaveLength(1);
  });
});

describe('content: a bad frame aborts the response', () => {
  it('a frame whose bytes do not hash to its digest never reaches the sink, and no later frame is read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const file = framedFile(3);
    const good = ccdOver(file);
    const marker = Buffer.alloc(FRAME, 0xee);
    const { rec, bytes } = rig((argv) => {
      if (argv.includes('--snapshot') && flag(argv, '--offset') === String(FRAME)) {
        const real = file.subarray(FRAME, 2 * FRAME);
        return okRes(rangeLine({
          snapshot: SNAP, offset: FRAME, bytesB64: marker.toString('base64'), digest: sha256Hex(real), total: file.length,
        }));
      }
      return good(argv);
    });
    const sunk = collector();
    const res = await bytes.read(COMMITTED_AT, entry(blobPin(), file.length), { start: 0, end: file.length - 1 }, SNAP, sunk.sink, LIVE);
    expect(res).toEqual({ ok: false, error: 'frame-digest' });
    expect(sunk.frames).toHaveLength(1);
    expect(sunk.joined().equals(file.subarray(0, FRAME))).toBe(true);
    expect(sunk.joined().includes(0xee)).toBe(false);
    expect(rec.calls).toHaveLength(2);
  });
});

describe('bytes: a busy lane is not unreadable', () => {
  const small = Buffer.from('hello');
  const e = entry(blobPin(), 5);
  const big = Buffer.alloc(FRAME + 10, 3);
  const eBig = entry(blobPin(), big.length);
  const draftFp = entry({ kind: 'fp', sha: sha256Hex(small) }, 5);

  it('answers busy when the lane is closed or the read was abandoned', async () => {
    const { rec, docs, bytes } = rig(ccdOver(small));
    const gone = new AbortController();
    gone.abort();
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, e, { start: 0, end: 4 }, null, sunk.sink, gone.signal)).toEqual({ ok: false, error: 'busy' });
    expect(await bytes.prepare(COMMITTED_AT, e, gone.signal)).toEqual({ ok: false, error: 'busy' });
    nodeLanes(docs).read.close();
    expect(await bytes.read(COMMITTED_AT, e, { start: 0, end: 4 }, null, sunk.sink, LIVE)).toEqual({ ok: false, error: 'busy' });
    expect(await bytes.prepare(COMMITTED_AT, e, LIVE)).toEqual({ ok: false, error: 'busy' });
    expect(await bytes.read(COMMITTED_AT, eBig, { start: 0, end: 9 }, SNAP, sunk.sink, LIVE)).toEqual({ ok: false, error: 'busy' });
    expect(rec.calls).toEqual([]);
    expect(sunk.frames).toEqual([]);
  });

  it('keeps ccd\'s own failure words apart', async () => {
    const outcome = async (verb: 'docs-show' | 'docs-show-range', failure: string, step: 'show' | 'prepare' | 'frame') => {
      const { bytes } = rig(() => okRes(failureLine(verb, failure)));
      const sunk = collector();
      if (step === 'prepare') return bytes.prepare(DRAFT_AT, entry({ kind: 'fp', sha: 'f'.repeat(64) }, big.length), LIVE);
      if (step === 'show') return bytes.read(DRAFT_AT, draftFp, { start: 0, end: 4 }, null, sunk.sink, LIVE);
      return bytes.read(DRAFT_AT, entry({ kind: 'fp', sha: 'f'.repeat(64) }, big.length), { start: 0, end: 9 }, SNAP, sunk.sink, LIVE);
    };
    expect(await outcome('docs-show', 'draft-changed', 'show')).toEqual({ ok: false, error: 'draft-changed' });
    expect(await outcome('docs-show', 'worktree-moved', 'show')).toEqual({ ok: false, error: 'draft-changed' });
    expect(await outcome('docs-show', 'too-large', 'show')).toEqual({ ok: false, error: 'too-large' });
    expect(await outcome('docs-show', 'unknown-commit', 'show')).toEqual({ ok: false, error: 'unreadable' });
    expect(await outcome('docs-show-range', 'draft-changed', 'prepare')).toEqual({ ok: false, error: 'draft-changed' });
    expect(await outcome('docs-show-range', 'prepare-busy', 'prepare')).toEqual({ ok: false, error: 'prepare-busy' });
    expect(await outcome('docs-show-range', 'range-too-large', 'prepare')).toEqual({ ok: false, error: 'unreadable' });
    expect(await outcome('docs-show-range', 'unknown-commit', 'prepare')).toEqual({ ok: false, error: 'unreadable' });
    expect(await outcome('docs-show-range', 'draft-changed', 'frame')).toEqual({ ok: false, error: 'draft-changed' });
    expect(await outcome('docs-show-range', 'worktree-moved', 'frame')).toEqual({ ok: false, error: 'draft-changed' });
    expect(await outcome('docs-show-range', 'snapshot-gone', 'frame')).toEqual({ ok: false, error: 'snapshot-gone' });
    expect(await outcome('docs-show-range', 'range-too-large', 'frame')).toEqual({ ok: false, error: 'too-large' });
    expect(await outcome('docs-show-range', 'prepare-busy', 'frame')).toEqual({ ok: false, error: 'unreadable' });
    expect(await outcome('docs-show-range', 'unknown-commit', 'frame')).toEqual({ ok: false, error: 'unreadable' });
  });

  it('answers unreadable, and never throws, when the runner throws', async () => {
    const { bytes } = rig(() => { throw new Error('link down'); });
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, e, { start: 0, end: 4 }, null, sunk.sink, LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.prepare(COMMITTED_AT, eBig, LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.read(COMMITTED_AT, eBig, { start: 0, end: 9 }, SNAP, sunk.sink, LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(sunk.frames).toEqual([]);
  });

  it('maps every word of the table: busy, a changed draft, a gone snapshot and a busy prepare each have their own', () => {
    const table: readonly (readonly ['show' | 'prepare' | 'frame', string, string])[] = [
      ['show', 'docs-busy', 'busy'], ['prepare', 'docs-busy', 'busy'], ['frame', 'docs-busy', 'busy'],
      ['show', 'draft-changed', 'draft-changed'], ['prepare', 'draft-changed', 'draft-changed'], ['frame', 'draft-changed', 'draft-changed'],
      ['show', 'worktree-moved', 'draft-changed'], ['prepare', 'worktree-moved', 'draft-changed'], ['frame', 'worktree-moved', 'draft-changed'],
      ['frame', 'snapshot-gone', 'snapshot-gone'], ['show', 'snapshot-gone', 'snapshot-gone'], ['prepare', 'snapshot-gone', 'unreadable'],
      ['prepare', 'prepare-busy', 'prepare-busy'], ['show', 'prepare-busy', 'unreadable'], ['frame', 'prepare-busy', 'unreadable'],
      ['show', 'too-large', 'too-large'], ['frame', 'too-large', 'too-large'], ['prepare', 'too-large', 'unreadable'],
      ['show', 'range-too-large', 'too-large'], ['frame', 'range-too-large', 'too-large'], ['prepare', 'range-too-large', 'unreadable'],
      ['frame', 'malformed-answer', 'frame-digest'], ['show', 'malformed-answer', 'unreadable'], ['prepare', 'malformed-answer', 'unreadable'],
      ['show', 'unknown-commit', 'unreadable'], ['prepare', 'link-failed', 'unreadable'], ['frame', 'thrown', 'unreadable'],
    ];
    for (const [step, failure, word] of table) expect(artifactReadWord(step, failure), `${step} ${failure}`).toBe(word);
  });
});

describe('bytes: sizes are held to the manifest', () => {
  it('a show of another length than the entry\'s is unreadable and nothing reaches the sink', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { bytes } = rig(ccdOver(Buffer.from('hello')));
    const sunk = collector();
    // Longer than the entry says (the show bound refuses it) and shorter (the adapter's own size check).
    expect(await bytes.read(COMMITTED_AT, entry(blobPin(), 4), { start: 0, end: 3 }, null, sunk.sink, LIVE))
      .toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.read(COMMITTED_AT, entry(blobPin(), 6), { start: 0, end: 5 }, null, sunk.sink, LIVE))
      .toEqual({ ok: false, error: 'unreadable' });
    expect(sunk.frames).toEqual([]);
  });

  it('a prepare of another size than the entry\'s is unreadable', async () => {
    const file = Buffer.alloc(FRAME + 10, 3);
    const { bytes } = rig(ccdOver(file));
    expect(await bytes.prepare(COMMITTED_AT, entry(blobPin(), file.length + 1), LIVE)).toEqual({ ok: false, error: 'unreadable' });
    expect(await bytes.prepare(COMMITTED_AT, entry(blobPin(), file.length), LIVE)).toEqual({ ok: true, snapshot: SNAP });
  });

  it('a frame whose total differs from the entry\'s size is a frame-digest failure and nothing reaches the sink', async () => {
    const file = Buffer.alloc(FRAME + 10, 3);
    const { bytes } = rig(ccdOver(file));
    const sunk = collector();
    expect(await bytes.read(COMMITTED_AT, entry(blobPin(), file.length + 1), { start: 0, end: 99 }, SNAP, sunk.sink, LIVE))
      .toEqual({ ok: false, error: 'frame-digest' });
    expect(sunk.frames).toEqual([]);
  });
});

describe('bytes: jobs are the artifact lane\'s', () => {
  it('books every exec as an artifact job, and a second artifact read waits for the first', async () => {
    const jobs: DocsJob[] = [];
    const lane = docsReadLane();
    const spy = (): DocsReadLane => ({
      run: (job, signal, exec) => {
        jobs.push(job);
        return lane.run(job, signal, exec);
      },
      load: () => lane.load(),
      close: () => lane.close(),
    });
    const file = Buffer.from('hello');
    const answer = ccdOver(file);
    const held: (() => void)[] = [];
    const { rec, docs, bytes } = rig(
      (argv) => new Promise<CcdResult>((resolve) => { held.push(() => resolve(answer(argv))); }), spy);
    const e = entry(blobPin(), 5);
    const sunkA = collector();
    const sunkB = collector();
    const first = bytes.read(COMMITTED_AT, e, { start: 0, end: 4 }, null, sunkA.sink, LIVE);
    await until(() => rec.calls.length === 1, 'the first artifact exec starts');
    const second = bytes.read(COMMITTED_AT, e, { start: 0, end: 4 }, null, sunkB.sink, LIVE);
    await until(() => nodeLanes(docs).read.load().artifactQueued === 1, 'the second artifact job waits in the lane');
    await settle();
    expect(rec.calls, 'one artifact job runs at a time').toHaveLength(1);
    held[0]!();
    expect(await first).toEqual({ ok: true });
    await until(() => rec.calls.length === 2, 'the second artifact exec starts after the first');
    held[1]!();
    expect(await second).toEqual({ ok: true });
    expect(jobs).toEqual([artifactShowJob(5), artifactShowJob(5)]);
    for (const job of jobs) expect(job.source).toBe('artifact');
  });

  it('books a prepare and a frame as artifact jobs of their own estimates', async () => {
    const jobs: DocsJob[] = [];
    const lane = docsReadLane();
    const spy = (): DocsReadLane => ({
      run: (job, signal, exec) => {
        jobs.push(job);
        return lane.run(job, signal, exec);
      },
      load: () => lane.load(),
      close: () => lane.close(),
    });
    const file = Buffer.alloc(FRAME + 10, 3);
    const { bytes } = rig(ccdOver(file), spy);
    const e = entry(blobPin(), file.length);
    expect(await bytes.prepare(COMMITTED_AT, e, LIVE)).toEqual({ ok: true, snapshot: SNAP });
    expect(await bytes.read(COMMITTED_AT, e, { start: 0, end: FRAME + 9 }, SNAP, collector().sink, LIVE)).toEqual({ ok: true });
    expect(jobs).toEqual([
      artifactJob({ raw: 0, wire: jobs[0]!.wire, prepare: true }),
      artifactJob({ raw: FRAME, wire: showWire(FRAME) }),
      artifactJob({ raw: 10, wire: showWire(10) }),
    ]);
    for (const job of jobs) expect(job.source).toBe('artifact');
    expect(jobs[0]!.prepare).toBe(true);
  });

  it('artifactJob keeps every field and makes a fresh job', () => {
    const base: DocsJob = { raw: 3, wire: 9, prepare: true };
    const made = artifactJob(base);
    expect(made).toEqual({ raw: 3, wire: 9, prepare: true, source: 'artifact' });
    expect(made).not.toBe(base);
    expect(base.source).toBeUndefined();
  });
});
