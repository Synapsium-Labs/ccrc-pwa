// docs-show-range (X2 spec 2026-11-18 section 4.3, plan Task P1.2, D-8764): one file read as a prepare, which copies the
// pinned bytes once into a private snapshot and answers its id, size and digest, then frames of at most 512 KiB from that
// snapshot, each bound to the doc and carrying its own digest. Every end-to-end case runs the SHIPPED dispatcher in a
// fixture HOME through `runCcdDocs` (the three poisons are `runCcdDocs`'s); the cache is the fixture HOME's own
// `.cc-docs-range`, never the live one. Units import the helper (`unitJson`) for what a fixture cannot produce: a bound
// file that is a FIFO, a budget already spent.
// DISK: the 64 MiB cases use SPARSE sources (`ftruncate`), but each prepare copies real bytes into the cache, so every
// such case removes the fixture HOME's cache directory as soon as its answer is read.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { docsRepo, commitDocs, parseOneLine, runCcdDocs } from './ccdDocsHelpers.js';
import { unitJson } from './docsHelperPy.js';
import { DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES } from '../../shared/docs.js';

const SPECS = 'docs/superpowers/specs';
const PLANS = 'docs/superpowers/plans';
type Answer = Record<string, unknown>;
const CACHE_BOUND = 536870912;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccd-docs-range-'); });
afterEach(() => { h.cleanup(); });

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const cacheDir = (): string => path.join(h.home, '.cc-docs-range');
/** The fixture HOME's cache, removed whole: the 64 MiB cases and the planted cases leave nothing behind. */
const dropCache = (): void => { fs.rmSync(cacheDir(), { recursive: true, force: true }); };
const run = (args: readonly string[]): Answer => parseOneLine(runCcdDocs(h, args));
/** The names in the cache directory, or [] before the first range call creates it. */
const cacheNames = (): string[] => (fs.existsSync(cacheDir()) ? fs.readdirSync(cacheDir()) : []);
const cacheBytes = (): number => cacheNames().reduce((n, f) => n + fs.statSync(path.join(cacheDir(), f)).size, 0);
const ID = /^[0-9a-f]{32}$/;
const bytesOf = (n: number): Buffer => crypto.randomBytes(n);

/** `demo` with `files` committed and pushed; the commit and each file's blob id. */
function committed(files: Record<string, Buffer | string>): { main: string; commit: string; blob: (rel: string) => string } {
  const main = docsRepo(h, 'demo', files);
  const commit = h.git(main, 'rev-parse', 'HEAD');
  return { main, commit, blob: (rel) => h.git(main, 'rev-parse', `${commit}:${rel}`) };
}

const committedArgs = (commit: string, section: string, rel: string, pin: string, tail: readonly string[]): string[] => [
  'docs-show-range', '--project', 'demo', '--commit', commit, '--section', section, '--path', rel, '--pin', pin, ...tail];
const draftArgs = (head: string, rel: string, pin: string, tail: readonly string[]): string[] => [
  'docs-show-range', '--project', 'demo', '--draft-branch', 'ws/a', '--head', head, '--section', 'specs', '--path', rel,
  '--pin', pin, ...tail];
const frameTail = (snapshot: string, offset: number, length: number): string[] =>
  ['--snapshot', snapshot, '--offset', String(offset), '--length', String(length)];

/** `demo` with one committed doc and its holder: a worktree on `ws/a` under HOME's worktrees root, as ws-add puts one. */
function holder(files?: Record<string, Buffer | string>): { main: string; wt: string; head: string } {
  const main = docsRepo(h, 'demo', files);
  const wt = path.join(h.home, 'worktrees', 'demo', 'a');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  h.git(main, 'worktree', 'add', '-q', '-b', 'ws/a', wt);
  return { main, wt, head: h.git(wt, 'rev-parse', 'HEAD') };
}
const draftFile = (wt: string, rel: string): string => path.join(wt, SPECS, rel);
const writeDraft = (wt: string, rel: string, body: Buffer | string): string => {
  const p = draftFile(wt, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
/** `stat:<size>:<mtimeNs>` exactly as the listing would measure the file now. */
const statPinOf = (p: string): string => {
  const st = fs.statSync(p, { bigint: true });
  return `stat:${st.size}:${st.mtimeNs}`;
};

/** Every frame of a snapshot, in order, as the PWA reads them: the reassembled bytes, and each frame's answer. */
function readFrames(
  argsFor: (tail: string[]) => string[], snapshot: string, size: number,
): { bytes: Buffer; frames: Answer[] } {
  const parts: Buffer[] = [];
  const frames: Answer[] = [];
  for (let offset = 0; offset < size; offset += DOCS_RANGE_FRAME_BYTES) {
    const length = Math.min(DOCS_RANGE_FRAME_BYTES, size - offset);
    const f = run(argsFor(frameTail(snapshot, offset, length)));
    frames.push(f);
    expect(f).toMatchObject({ v: 1, verb: 'docs-show-range', ok: true, snapshot, offset, total: size });
    const raw = Buffer.from(String(f['bytesB64']), 'base64');
    expect(raw).toHaveLength(length);
    expect(f['digest'], `the frame at ${offset} carries the sha256 of its own bytes`).toBe(sha(raw));
    parts.push(raw);
  }
  return { bytes: Buffer.concat(parts), frames };
}

/** A planted cache record, in the cache directory's own format: a reservation, the starts log or the bound file. */
function plant(name: string, body: string): void {
  fs.mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(cacheDir(), name), body);
}
/** `H.range_bound` on the cache directory `dir`, opened as the verb opens it (one descriptor, every read through it). */
const boundOf = (dir: string): string => `out(H.range_bound(H.range_open_dir(${JSON.stringify(dir)})))`;
const plantReservation =(size: number, at: number = Date.now()): void => {
  const id = crypto.randomBytes(16).toString('hex');
  plant(`${id}.resv`, JSON.stringify({ id, size, at }));
};

describe('docs-show-range (X2 P1.2)', () => {
  it('range: frames reassemble to the blob', () => {
    const blob = bytesOf(1_300_000);
    const c = committed({ [`${SPECS}/a.bin`]: blob });
    const pin = `blob:${c.blob(`${SPECS}/a.bin`)}`;
    const prep = run(committedArgs(c.commit, 'specs', 'a.bin', pin, ['--prepare']));
    expect(prep).toMatchObject({ v: 1, verb: 'docs-show-range', ok: true, size: blob.length, digest: sha(blob) });
    expect(String(prep['snapshot'])).toMatch(ID);
    for (const k of ['bytesB64', 'offset', 'total']) expect(prep, `a prepare carries no ${k}`).not.toHaveProperty(k);
    const got = readFrames((t) => committedArgs(c.commit, 'specs', 'a.bin', pin, t), String(prep['snapshot']), blob.length);
    expect(got.frames).toHaveLength(3);
    expect(got.bytes.equals(blob)).toBe(true);
  });

  it('range: frames of a stat-pinned draft reassemble to the file, and the snapshot digest names the bytes', () => {
    const wt = holder().wt;
    const head = h.git(wt, 'rev-parse', 'HEAD');
    const body = bytesOf(700_000);
    const p = writeDraft(wt, 'd.bin', body);
    const pin = statPinOf(p);
    const prep = run(draftArgs(head, 'd.bin', pin, ['--prepare']));
    expect(prep).toMatchObject({ ok: true, size: body.length, digest: sha(body) });
    const got = readFrames((t) => draftArgs(head, 'd.bin', pin, t), String(prep['snapshot']), body.length);
    expect(got.bytes.equals(body)).toBe(true);
    // An fp pin of the same bytes reads the same file through its own snapshot.
    const fpPrep = run(draftArgs(head, 'd.bin', `fp:${sha(body)}`, ['--prepare']));
    expect(fpPrep).toMatchObject({ ok: true, size: body.length, digest: sha(body) });
  });

  it('range: a file changed since the listing refuses', () => {
    const { wt, head } = holder();
    const p = writeDraft(wt, 'd.md', 'listed bytes\n');
    const pin = statPinOf(p);
    // CONTROL: the pin as measured prepares, so the refusals below are the change, not the pin.
    expect(run(draftArgs(head, 'd.md', pin, ['--prepare']))).toMatchObject({ ok: true, size: 13 });
    const before = cacheNames().filter((n) => n.endsWith('.bin')).length;
    // Touched: the same bytes, a later modified time.
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(p, later, later);
    expect(run(draftArgs(head, 'd.md', pin, ['--prepare']))).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present' });
    // Grown: a new pin for the touched file, then a byte appended.
    const pin2 = statPinOf(p);
    expect(run(draftArgs(head, 'd.md', pin2, ['--prepare']))).toMatchObject({ ok: true });
    fs.appendFileSync(p, 'x');
    expect(run(draftArgs(head, 'd.md', pin2, ['--prepare']))).toMatchObject({ ok: false, failure: 'draft-changed' });
    // Gone: a pinned file that is no longer there.
    fs.rmSync(p);
    expect(run(draftArgs(head, 'd.md', pin2, ['--prepare']))).toMatchObject({ ok: false, failure: 'draft-changed', now: 'absent' });
    // A refusal leaves no snapshot, partial copy or reservation: only the two prepares that passed are in the cache.
    expect(cacheNames().filter((n) => n.endsWith('.bin'))).toHaveLength(before + 1);
    expect(cacheNames().filter((n) => n.endsWith('.part') || n.endsWith('.resv'))).toEqual([]);
  });

  it('range: fp pin of a changed draft refuses', () => {
    const { wt, head } = holder();
    const p = writeDraft(wt, 'd.md', 'AAAA\n');
    const fp = sha(Buffer.from('AAAA\n'));
    expect(run(draftArgs(head, 'd.md', `fp:${fp}`, ['--prepare']))).toMatchObject({ ok: true, size: 5, digest: fp });
    fs.writeFileSync(p, 'BBBB\n');
    const r = runCcdDocs(h, draftArgs(head, 'd.md', `fp:${fp}`, ['--prepare']));
    expect(parseOneLine(r)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present' });
    // The answer names neither the new bytes nor their hash.
    expect(r.stdout).not.toContain(sha(Buffer.from('BBBB\n')));
    expect(cacheNames().filter((n) => n.endsWith('.part') || n.endsWith('.resv'))).toEqual([]);
    expect(cacheNames().filter((n) => n.endsWith('.bin'))).toHaveLength(1);
  });

  it("range: a frame naming another path's snapshot refuses", () => {
    const same = bytesOf(600_000);
    const c = committed({
      [`${SPECS}/a.bin`]: same, [`${SPECS}/copy.bin`]: same, [`${SPECS}/other.bin`]: bytesOf(600_000),
      [`${PLANS}/a.bin`]: bytesOf(600_000),
    });
    const pinA = `blob:${c.blob(`${SPECS}/a.bin`)}`;
    expect(c.blob(`${SPECS}/copy.bin`), 'two paths of one blob: only the path tells them apart').toBe(c.blob(`${SPECS}/a.bin`));
    const snapshot = String(run(committedArgs(c.commit, 'specs', 'a.bin', pinA, ['--prepare']))['snapshot']);
    const frame = (commit: string, section: string, rel: string, pin: string): Answer =>
      run(committedArgs(commit, section, rel, pin, frameTail(snapshot, 0, 1000)));
    // CONTROL: the snapshot's own tuple reads.
    expect(frame(c.commit, 'specs', 'a.bin', pinA)).toMatchObject({ ok: true, snapshot, offset: 0 });
    // Another path, same blob and pin: refused.
    expect(frame(c.commit, 'specs', 'copy.bin', pinA)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // Another pin, another section, another commit: each refused.
    expect(frame(c.commit, 'specs', 'a.bin', `blob:${c.blob(`${SPECS}/other.bin`)}`)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    expect(frame(c.commit, 'plans', 'a.bin', pinA)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    const next = commitDocs(h, c.main, { [`${SPECS}/n.md`]: 'n\n' });
    expect(frame(next, 'specs', 'a.bin', pinA)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // A snapshot id nothing holds, and one that is not an id at all.
    expect(run(committedArgs(c.commit, 'specs', 'a.bin', pinA, frameTail('f'.repeat(32), 0, 10))))
      .toMatchObject({ ok: false, failure: 'snapshot-gone' });
    expect(run(committedArgs(c.commit, 'specs', 'a.bin', pinA, frameTail('../lock', 0, 10))))
      .toMatchObject({ ok: false, failure: 'snapshot-gone' });
  });

  it('range: a frame of 524289 bytes refuses', () => {
    const blob = bytesOf(600_000);
    const c = committed({ [`${SPECS}/a.bin`]: blob });
    const pin = `blob:${c.blob(`${SPECS}/a.bin`)}`;
    const snapshot = String(run(committedArgs(c.commit, 'specs', 'a.bin', pin, ['--prepare']))['snapshot']);
    const frame = (offset: number, length: number): Answer =>
      run(committedArgs(c.commit, 'specs', 'a.bin', pin, frameTail(snapshot, offset, length)));
    expect(DOCS_RANGE_FRAME_BYTES).toBe(524288);
    expect(frame(0, 524289)).toMatchObject({ ok: false, failure: 'range-too-large', size: 524289, cap: 524288 });
    // At the bound it reads whole, and the same snapshot still serves the tail.
    const full = frame(0, 524288);
    expect(full).toMatchObject({ ok: true, total: 600_000 });
    expect(Buffer.from(String(full['bytesB64']), 'base64').equals(blob.subarray(0, 524288))).toBe(true);
    expect(frame(524288, 75_712)).toMatchObject({ ok: true });
    // Outside the snapshot: a range that runs past its end, and one that starts at it.
    expect(frame(524288, 75_713)).toMatchObject({ ok: false, failure: 'range-too-large' });
    expect(frame(600_000, 1)).toMatchObject({ ok: false, failure: 'range-too-large' });
  });

  it('range: files of 67108863 and 67108864 bytes prepare, 67108865 refuses range-too-large', () => {
    expect(DOCS_RANGE_MAX_BYTES).toBe(67108864);
    const { wt, head } = holder();
    const zeros = (n: number): string => {
      const hash = crypto.createHash('sha256');
      const mib = Buffer.alloc(1048576);
      for (let left = n; left > 0; left -= mib.length) hash.update(mib.subarray(0, Math.min(mib.length, left)));
      return hash.digest('hex');
    };
    const sparse = (rel: string, size: number): string => {
      const p = draftFile(wt, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const fd = fs.openSync(p, 'w');
      fs.ftruncateSync(fd, size);
      fs.closeSync(fd);
      return p;
    };
    try {
      for (const size of [67108863, 67108864]) {
        const p = sparse(`big-${size}.bin`, size);
        const r = run(draftArgs(head, `big-${size}.bin`, statPinOf(p), ['--prepare']));
        expect(r, `${size} bytes`).toMatchObject({ ok: true, size, digest: zeros(size) });
        dropCache();
        fs.rmSync(p);
      }
      const over = sparse('big-over.bin', 67108865);
      const refused = run(draftArgs(head, 'big-over.bin', statPinOf(over), ['--prepare']));
      expect(refused).toMatchObject({ ok: false, failure: 'range-too-large', size: 67108865, cap: 67108864 });
      // Nothing was copied for the refusal: the size is read from the descriptor before any byte moves.
      expect(cacheBytes()).toBeLessThan(65536);
    } finally {
      dropCache();
    }
  }, 240_000);

  it('range: a third concurrent prepare answers prepare-busy', () => {
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const args = committedArgs(c.commit, 'specs', 'a.md', `blob:${c.blob(`${SPECS}/a.md`)}`, ['--prepare']);
    // Two prepares standing between their reservation and their commit stand in as two live reservation records.
    plantReservation(1024);
    // CONTROL: one live prepare beside this one is within the limit of two.
    expect(run(args)).toMatchObject({ ok: true });
    plantReservation(1024);
    expect(run(args)).toMatchObject({ ok: false, failure: 'prepare-busy' });
    // A reservation older than its lifetime is a prepare that died: it holds no slot.
    for (const f of cacheNames().filter((n) => n.endsWith('.resv'))) {
      const rec = JSON.parse(fs.readFileSync(path.join(cacheDir(), f), 'utf8')) as { id: string; size: number };
      fs.writeFileSync(path.join(cacheDir(), f), JSON.stringify({ ...rec, at: Date.now() - 3_600_000 }));
    }
    expect(run(args)).toMatchObject({ ok: true });
    expect(cacheNames().filter((n) => n.endsWith('.resv'))).toEqual([]);
  });

  it('range: a seventh prepare in a minute answers prepare-busy', () => {
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const args = committedArgs(c.commit, 'specs', 'a.md', `blob:${c.blob(`${SPECS}/a.md`)}`, ['--prepare']);
    // Six starts a minute and a half ago are outside the minute: the first prepare passes (CONTROL: the window ages).
    plant('starts', Array.from({ length: 6 }, () => String(Date.now() - 90_000)).join('\n') + '\n');
    for (let n = 1; n <= 6; n++) expect(run(args), `prepare ${n}`).toMatchObject({ ok: true });
    expect(run(args)).toMatchObject({ ok: false, failure: 'prepare-busy' });
    // The refusal is not a start, and it left nothing in the cache beyond the six snapshots.
    expect(cacheNames().filter((n) => n.endsWith('.bin'))).toHaveLength(6);
    expect(cacheNames().filter((n) => n.endsWith('.part') || n.endsWith('.resv'))).toEqual([]);
  });

  it('range: an evicted snapshot answers snapshot-gone', () => {
    const c = committed({ [`${SPECS}/a.bin`]: bytesOf(600_000), [`${SPECS}/b.bin`]: bytesOf(600_000) });
    // A bound of 1 000 000 bytes holds one of the two snapshots, not both.
    plant('bound', '1000000');
    const pinOf = (rel: string): string => `blob:${c.blob(`${SPECS}/${rel}`)}`;
    const prepare = (rel: string): Answer => run(committedArgs(c.commit, 'specs', rel, pinOf(rel), ['--prepare']));
    const frame = (rel: string, snapshot: string): Answer =>
      run(committedArgs(c.commit, 'specs', rel, pinOf(rel), frameTail(snapshot, 0, 100)));
    const a = String(prepare('a.bin')['snapshot']);
    expect(frame('a.bin', a)).toMatchObject({ ok: true });
    const b = String(prepare('b.bin')['snapshot']);
    expect(frame('a.bin', a)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    expect(frame('b.bin', b)).toMatchObject({ ok: true });
    expect(cacheNames().filter((n) => n.endsWith('.bin'))).toEqual([`${b}.bin`]);
  });

  it('range: an entry unused for an hour is removed by the next range call', () => {
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const pin = `blob:${c.blob(`${SPECS}/a.md`)}`;
    const snapshot = String(run(committedArgs(c.commit, 'specs', 'a.md', pin, ['--prepare']))['snapshot']);
    const frame = (): Answer => run(committedArgs(c.commit, 'specs', 'a.md', pin, frameTail(snapshot, 0, 5)));
    // A frame touches the entry's last use, so an entry that is read stays.
    expect(frame()).toMatchObject({ ok: true });
    const metaFile = path.join(cacheDir(), `${snapshot}.meta`);
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { used: number };
    expect(meta.used).toBeGreaterThan(Date.now() - 600_000);
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, used: Date.now() - 3_700_000 }));
    expect(frame()).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    expect(cacheNames().filter((n) => n.startsWith(snapshot))).toEqual([]);
  });

  it('range: cache never exceeds its bound', () => {
    const MIB = 1048576;
    const c = committed({ [`${SPECS}/five.bin`]: bytesOf(5 * MIB), [`${SPECS}/three.bin`]: bytesOf(3 * MIB) });
    const prepare = (rel: string): Answer => run(committedArgs(c.commit, 'specs', rel, `blob:${c.blob(`${SPECS}/${rel}`)}`, ['--prepare']));
    plant('bound', String(8 * MIB));
    // A first prepare paused between its reservation and its copy: 5 MiB reserved, nothing copied yet.
    plantReservation(5 * MIB);
    expect(prepare('five.bin')).toMatchObject({ ok: false, failure: 'prepare-busy' });
    expect(cacheBytes()).toBeLessThanOrEqual(8 * MIB);
    expect(cacheNames().filter((n) => n.endsWith('.bin') || n.endsWith('.part'))).toEqual([]);
    // CONTROL: 5 reserved and 3 asked is exactly the bound, so it fits; the bound is a bound, not a refusal of everything.
    expect(prepare('three.bin')).toMatchObject({ ok: true, size: 3 * MIB });
    expect(cacheBytes()).toBeLessThanOrEqual(8 * MIB);
    // The reservation is never evicted to make room.
    expect(cacheNames().filter((n) => n.endsWith('.resv'))).toHaveLength(1);
  });

  it('range: a bound file above the constant changes nothing', () => {
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const bound = (content: string): number => {
      fs.writeFileSync(path.join(dir, 'bound'), content);
      return unitJson<number>(h.home, boundOf(dir));
    };
    expect(bound('999999999999999999999999')).toBe(CACHE_BOUND);
    expect(bound('536870913')).toBe(CACHE_BOUND);
    expect(bound('1'.repeat(32))).toBe(CACHE_BOUND);
    // More than 32 bytes, junk, a sign, a space, a newline and an empty file are ignored too.
    for (const junk of ['1'.repeat(33), 'abc', '-5', '12 ', '1000\n', '']) expect(bound(junk), JSON.stringify(junk)).toBe(CACHE_BOUND);
    // CONTROL: a lower value is used, and no file at all is the constant.
    expect(bound('8388608')).toBe(8388608);
    fs.rmSync(path.join(dir, 'bound'));
    expect(unitJson<number>(h.home, boundOf(dir))).toBe(CACHE_BOUND);
    // End to end, a bound file far above the constant leaves a prepare as it was.
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    plant('bound', '9'.repeat(30));
    expect(run(committedArgs(c.commit, 'specs', 'a.md', `blob:${c.blob(`${SPECS}/a.md`)}`, ['--prepare']))).toMatchObject({ ok: true });
  });

  it('range: a FIFO or a symlink as the bound file is ignored and never blocks', () => {
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = path.join(h.home, 'one-kib');
    fs.writeFileSync(target, '1024');
    const read = (): number => unitJson<number>(h.home, boundOf(dir), { timeoutMs: 10_000 });
    const boundPath = path.join(dir, 'bound');
    execFileSync('mkfifo', [boundPath]);
    expect(fs.lstatSync(boundPath).isFIFO()).toBe(true);
    expect(read()).toBe(CACHE_BOUND);
    fs.rmSync(boundPath);
    fs.symlinkSync(target, boundPath);
    // The link points at a file holding a lower bound, and is not followed.
    expect(read()).toBe(CACHE_BOUND);
    // End to end through the dispatcher, with a FIFO in the bound's place.
    fs.rmSync(boundPath);
    execFileSync('mkfifo', [boundPath]);
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const t0 = Date.now();
    expect(run(committedArgs(c.commit, 'specs', 'a.md', `blob:${c.blob(`${SPECS}/a.md`)}`, ['--prepare']))).toMatchObject({ ok: true });
    expect(Date.now() - t0).toBeLessThan(60_000);
  });

  it('range: a prepare past its copy budget removes its partial copy and answers prepare-busy', () => {
    const c = committed({ [`${SPECS}/a.bin`]: bytesOf(300_000) });
    const home = h.home;
    const argv = ['docs-show-range', path.join(home, 'projects'), path.join(home, 'worktrees'), path.join(home, '.cc-sessions'),
      ...committedArgs(c.commit, 'specs', 'a.bin', `blob:${c.blob(`${SPECS}/a.bin`)}`, ['--prepare']).slice(1)];
    const got = unitJson<Answer>(home, [
      'import json',
      'H.DOCS_RANGE_PREPARE_BUDGET_MS = -1',
      `out(json.loads(H.run(${JSON.stringify(argv)}).decode('utf-8')))`,
    ].join('\n'));
    expect(got).toMatchObject({ ok: false, failure: 'prepare-busy' });
    expect(cacheNames().filter((n) => /\.(part|bin|meta|resv)$/.test(n))).toEqual([]);
  });

  it('range: the cache directory is private, and a symlink in its place is refused, never followed', () => {
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const args = committedArgs(c.commit, 'specs', 'a.md', `blob:${c.blob(`${SPECS}/a.md`)}`, ['--prepare']);
    expect(run(args)).toMatchObject({ ok: true });
    expect(fs.statSync(cacheDir()).mode & 0o777).toBe(0o700);
    dropCache();
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, cacheDir());
    expect(run(args)).toMatchObject({ ok: false, failure: 'helper-failed' });
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('range: a cache directory left at a wider mode is repaired to 0700 by the next call', () => {
    // The first case above starts with no directory, so the create alone yields 0700: only a directory that already
    // stands, at a mode another user could list, shows the repair (`fchmod` on the opened descriptor).
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const args = committedArgs(c.commit, 'specs', 'a.md', `blob:${c.blob(`${SPECS}/a.md`)}`, ['--prepare']);
    fs.mkdirSync(cacheDir(), { mode: 0o755 });
    fs.chmodSync(cacheDir(), 0o755); // the umask may have narrowed the create
    expect(fs.statSync(cacheDir()).mode & 0o777, 'the planted directory is wide').toBe(0o755);
    expect(run(args)).toMatchObject({ ok: true });
    expect(fs.statSync(cacheDir()).mode & 0o777).toBe(0o700);
  });

  it('range: ccd caps lists the verb and its token, and a bad shape or pin is refused before any copy', () => {
    const caps = h.sh('cmd_caps').split('\n');
    for (const t of ['docs-show-range', 'docs-range-v1']) expect(caps, t).toContain(t);
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const blobPin = `blob:${c.blob(`${SPECS}/a.md`)}`;
    // A shape no builder writes is a usage error: rc 1 and an empty stdout.
    for (const bad of [
      ['docs-show-range', '--project', 'demo'],
      committedArgs(c.commit, 'specs', 'a.md', blobPin, []),
      committedArgs(c.commit, 'specs', 'a.md', blobPin, ['--snapshot', 'a'.repeat(32), '--offset', 'x', '--length', '5']),
      committedArgs(c.commit, 'specs', 'a.md', blobPin, ['--snapshot', 'a'.repeat(32), '--offset', '0', '--length', '0']),
    ]) {
      const r = runCcdDocs(h, bad);
      expect(r.code, bad.join(' ')).toBe(1);
      expect(r.stdout).toBe('');
    }
    // A value outside its grammar is a word: a pin of the wrong kind for the source, or one that is no pin.
    for (const pin of [`fp:${'a'.repeat(64)}`, 'stat:5:1', `blob:${'a'.repeat(39)}`, 'blob:', `stat:05:1`]) {
      expect(run(committedArgs(c.commit, 'specs', 'a.md', pin, ['--prepare'])), pin).toMatchObject({ ok: false, failure: 'bad-fingerprint' });
    }
    expect(run(draftArgs('a'.repeat(40), 'a.md', `blob:${'a'.repeat(40)}`, ['--prepare']))).toMatchObject({ ok: false, failure: 'bad-fingerprint' });
    for (const pin of ['stat:5:-1', 'stat:5:01', 'stat:5:', `stat:${'9'.repeat(11)}:1`, `stat:5:${'9'.repeat(20)}`]) {
      expect(run(draftArgs('a'.repeat(40), 'a.md', pin, ['--prepare'])), pin).toMatchObject({ ok: false, failure: 'bad-fingerprint' });
    }
    // A committed blob that is not the entry at that commit and path.
    expect(run(committedArgs(c.commit, 'specs', 'a.md', `blob:${'e'.repeat(40)}`, ['--prepare'])))
      .toMatchObject({ ok: false, failure: 'absent-path' });
    expect(cacheNames().filter((n) => /\.(part|bin|meta)$/.test(n))).toEqual([]);
  });

  it('range: a path with a non-ASCII name prepares and reads its frames', () => {
    // A two-byte letter and a four-byte character (an astral one: a surrogate pair in UTF-16), in a committed doc and a draft.
    const names = ['café.md', 'x-\u{1D4B3}.md'];
    const bodies = names.map((_n, i) => bytesOf(600_000 + i));
    const { main, wt, head } = holder(Object.fromEntries(names.map((n, i) => [`${SPECS}/${n}`, bodies[i]!])));
    names.forEach((name, i) => {
      const pin = `blob:${h.git(main, 'rev-parse', `${head}:${SPECS}/${name}`)}`;
      const prep = run(committedArgs(head, 'specs', name, pin, ['--prepare']));
      expect(prep, name).toMatchObject({ ok: true, size: bodies[i]!.length, digest: sha(bodies[i]!) });
      const got = readFrames((t) => committedArgs(head, 'specs', name, pin, t), String(prep['snapshot']), bodies[i]!.length);
      expect(got.bytes.equals(bodies[i]!), name).toBe(true);
    });
    // The record on disk is UTF-8, as the writer makes it: the path itself, not an escape of it.
    const meta = cacheNames().filter((n) => n.endsWith('.meta')).map((n) => fs.readFileSync(path.join(cacheDir(), n), 'utf8'));
    expect(meta.some((m) => m.includes('café.md'))).toBe(true);
    dropCache();
    // A draft, stat-pinned and fp-pinned.
    for (const name of names) {
      const body = bytesOf(1000);
      const p = writeDraft(wt, name, body);
      for (const pin of [statPinOf(p), `fp:${sha(body)}`]) {
        const prep = run(draftArgs(head, name, pin, ['--prepare']));
        expect(prep, `${name} ${pin}`).toMatchObject({ ok: true, size: 1000, digest: sha(body) });
        const got = readFrames((t) => draftArgs(head, name, pin, t), String(prep['snapshot']), 1000);
        expect(got.bytes.equals(body), `${name} ${pin}`).toBe(true);
      }
    }
  });

  /** The helper's own dispatcher, as a unit calls it: the verb name, the three roots, then `args` less its verb. */
  const unitArgv = (args: readonly string[]): string[] => ['docs-show-range', path.join(h.home, 'projects'),
    path.join(h.home, 'worktrees'), path.join(h.home, '.cc-sessions'), ...args.slice(1)];
  /**
   * A draft prepare run inside a unit whose `SYS.read` runs `mutation` (python, one statement a line, `target` the draft's
   * path, `os` and `subprocess` imported) at the read that ends the copy, so the file changes AFTER the last byte was read
   * and BEFORE the after-copy check: deterministic, no timing. `mutation` null changes nothing (the control).
   */
  const prepareWithMidCopyChange = (wt: string, rel: string, args: readonly string[], mutation: string | null): Answer => {
    const lines = mutation === null ? ['pass'] : mutation.split('\n');
    return unitJson<Answer>(h.home, [
      'import json, os, subprocess',
      `target = ${JSON.stringify(draftFile(wt, rel))}`,
      `wt = ${JSON.stringify(wt)}`,
      'fired = []',
      'class MutatesAtEnd(type(H.SYS)):',
      '    def read(self, fd, n):',
      '        data = super().read(fd, n)',
      '        if data == b"" and not fired and os.path.samestat(os.fstat(fd), os.stat(target)):',
      '            fired.append(1)',
      ...lines.map((l) => `            ${l}`),
      '        return data',
      'H.SYS = MutatesAtEnd()',
      `reply = json.loads(H.run(${JSON.stringify(unitArgv(args))}).decode('utf-8'))`,
      "reply['fired'] = len(fired)",
      'out(reply)',
    ].join('\n'));
  };
  const noRecord = (): string[] => cacheNames().filter((n) => /\.(part|bin|meta|resv)$/.test(n));

  it('range: a draft that changes while it is copied refuses draft-changed, and a moved head refuses worktree-moved', () => {
    const { wt, head } = holder();
    const body = bytesOf(5000);
    const p = writeDraft(wt, 'd.bin', body);
    const stat = statPinOf(p);
    const fp = `fp:${sha(body)}`;
    const original = (): void => { fs.writeFileSync(p, body); fs.utimesSync(p, new Date(), new Date()); };
    // CONTROL: the hook fires at the end of the copy and, changing nothing, leaves both pins preparing.
    for (const pin of [stat, fp]) {
      expect(prepareWithMidCopyChange(wt, 'd.bin', draftArgs(head, 'd.bin', pin, ['--prepare']), null), pin)
        .toMatchObject({ ok: true, size: body.length, fired: 1 });
    }
    dropCache();
    const changes: Record<string, string> = {
      'grows by a byte': "open(target, 'ab').write(b'x')",
      'shrinks by a byte': 'os.truncate(target, os.stat(target).st_size - 1)',
      'changes its modified time only': 'st = os.stat(target)\nos.utime(target, ns=(st.st_atime_ns, st.st_mtime_ns + 7_000_000_000))',
      // The bytes are rewritten in place at the same size, and the modified time put back: only the change time betrays it.
      'is rewritten in place with its modified time put back':
        "st = os.stat(target)\nf = open(target, 'r+b')\nf.write(b'Z' * st.st_size)\nf.close()\nos.utime(target, ns=(st.st_atime_ns, st.st_mtime_ns))",
    };
    for (const [what, mutation] of Object.entries(changes)) {
      // A stat pin names the file as listed (the listed pin is re-measured for each change, from the file as it stands).
      original();
      for (const pin of [statPinOf(p), fp]) {
        // The fp pin never meets the rewritten bytes at the copy (they are written after it), so only the after-copy check
        // can see a change; the stat pin is the one the listing took, the file as it stood before this change.
        const r = prepareWithMidCopyChange(wt, 'd.bin', draftArgs(head, 'd.bin', pin, ['--prepare']), mutation);
        expect(r, `${what} (${pin.slice(0, 5)}) ${JSON.stringify(r)}`).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present', fired: 1 });
        expect(noRecord(), `${what}: a refusal leaves nothing in the cache`).toEqual([]);
        dropCache(); // and the cache's own start log, which would otherwise count the prepares of this case against a minute
        original();
      }
    }
    // The head moves while the copy runs: the after-copy check reads HEAD again.
    original();
    const moved = prepareWithMidCopyChange(wt, 'd.bin', draftArgs(head, 'd.bin', statPinOf(p), ['--prepare']), [
      "subprocess.run(['git', '-C', wt, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--allow-empty', '-q', '-m', 'moved'],",
      '               check=True)',
    ].join('\n'));
    expect(moved).toMatchObject({ ok: false, failure: 'worktree-moved', fired: 1 });
    expect(moved['head']).toBe(h.git(wt, 'rev-parse', 'HEAD'));
    expect(moved['head']).not.toBe(head);
    expect(noRecord()).toEqual([]);
  });

  it('range: a stale stat pin refuses before any byte of the file is copied', () => {
    // The pre-copy check and the after-copy check compare the same pin, so a refusal alone cannot tell them apart: with
    // the pre-copy check gone the after-copy one still answers draft-changed, only after the whole file was read and
    // written into the cache (up to 64 MiB). What only a copy produces is a read of the file: the unit counts the
    // `SYS.read` calls that meet the draft's inode, and a stale pin must meet none. The counter is the observable
    // because a refused prepare removes its partial copy, so the cache directory shows nothing afterwards.
    // The after-copy stat comparison has no case of its own, and cannot have one: it runs only after the stable-field
    // check (inode, size, modified and change time against the file as first opened), and the pre-copy check has
    // already matched that first fstat to the pin, so while the pre-copy check stands it can never be the one that
    // refuses. Delete it alone and nothing is red (measured); delete both and "a file changed since the listing refuses" is.
    const { wt, head } = holder();
    const p = writeDraft(wt, 'd.md', 'listed bytes\n');
    const readsOf = (pin: string): Answer => unitJson<Answer>(h.home, [
      'import json, os',
      `target = ${JSON.stringify(draftFile(wt, 'd.md'))}`,
      'reads = []',
      'class CountsReads(type(H.SYS)):',
      '    def read(self, fd, n):',
      '        if os.path.samestat(os.fstat(fd), os.stat(target)):',
      '            reads.append(n)',
      '        return super().read(fd, n)',
      'H.SYS = CountsReads()',
      `reply = json.loads(H.run(${JSON.stringify(unitArgv(draftArgs(head, 'd.md', pin, ['--prepare'])))}).decode('utf-8'))`,
      "reply['reads'] = len(reads)",
      'out(reply)',
    ].join('\n'));
    // CONTROL: the pin as measured copies, and the counter sees the reads (a counter that counts nothing proves nothing).
    const control = readsOf(statPinOf(p));
    expect(control).toMatchObject({ ok: true, size: 13 });
    expect(control['reads'], 'a prepare that copies reads the file').toBeGreaterThan(0);
    dropCache();
    // Touched: the same bytes, a later modified time.
    const listed = statPinOf(p);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(p, later, later);
    expect(readsOf(listed)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present', reads: 0 });
    // Grown: a new pin for the touched file, then a byte appended.
    const grownPin = statPinOf(p);
    fs.appendFileSync(p, 'x');
    expect(readsOf(grownPin)).toMatchObject({ ok: false, failure: 'draft-changed', now: 'present', reads: 0 });
    expect(noRecord()).toEqual([]);
  });

  it('range: a frame naming a snapshot of another draft head, another branch, or the committed side refuses', () => {
    const { main, wt, head } = holder();
    const body = bytesOf(2000);
    const p = writeDraft(wt, 'd.bin', body);
    const pin = statPinOf(p);
    const snapshot = String(run(draftArgs(head, 'd.bin', pin, ['--prepare']))['snapshot']);
    const frameOf = (args: string[]): Answer => run(args);
    const tail = frameTail(snapshot, 0, 100);
    // CONTROL: the snapshot's own tuple reads.
    expect(frameOf(draftArgs(head, 'd.bin', pin, tail))).toMatchObject({ ok: true, snapshot });
    // Another head (a valid object id the snapshot was not prepared for).
    expect(frameOf(draftArgs('b'.repeat(40), 'd.bin', pin, tail))).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // Another branch: the same head and pin, a different bare branch name.
    const otherBranch = ['docs-show-range', '--project', 'demo', '--draft-branch', 'ws/b', '--head', head, '--section', 'specs',
      '--path', 'd.bin', '--pin', pin, ...tail];
    expect(frameOf(otherBranch)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // The committed side: a committed frame (the draft's head read as a commit, any blob pin) naming the draft's snapshot.
    expect(frameOf(committedArgs(head, 'specs', 'd.bin', `blob:${'e'.repeat(40)}`, tail))).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // And the other way round: a committed snapshot read as a draft of the same path.
    const commit = commitDocs(h, main, { [`${SPECS}/c.bin`]: bytesOf(2000) });
    const cpin = `blob:${h.git(main, 'rev-parse', `${commit}:${SPECS}/c.bin`)}`;
    const csnap = String(run(committedArgs(commit, 'specs', 'c.bin', cpin, ['--prepare']))['snapshot']);
    expect(run(committedArgs(commit, 'specs', 'c.bin', cpin, frameTail(csnap, 0, 10)))).toMatchObject({ ok: true });
    expect(run(draftArgs(commit, 'c.bin', pin, frameTail(csnap, 0, 10)))).toMatchObject({ ok: false, failure: 'snapshot-gone' });
  });

  it('range: a frame naming another project refuses snapshot-gone', () => {
    const { main, wt, head } = holder();
    // A second project that holds the SAME commit: a copy of the first fixture repository, registered under the projects
    // root as `other`, so the project is the only field that tells the two requests apart (commit, branch, head, section,
    // path and pin are all identical).
    fs.cpSync(main, path.join(h.home, 'projects', 'other'), { recursive: true });
    expect(h.git(path.join(h.home, 'projects', 'other'), 'rev-parse', 'HEAD')).toBe(head);
    const inProject = (args: string[], project: string): string[] =>
      args.map((a, i) => (args[i - 1] === '--project' ? project : a));
    const p = writeDraft(wt, 'd.bin', bytesOf(2000));
    const dpin = statPinOf(p);
    const cpin = `blob:${h.git(main, 'rev-parse', `${head}:${SPECS}/a.md`)}`;
    const csnap = String(run(committedArgs(head, 'specs', 'a.md', cpin, ['--prepare']))['snapshot']);
    const dsnap = String(run(draftArgs(head, 'd.bin', dpin, ['--prepare']))['snapshot']);
    const committedFrame = (project: string): Answer =>
      run(inProject(committedArgs(head, 'specs', 'a.md', cpin, frameTail(csnap, 0, 4)), project));
    const draftFrame = (project: string): Answer =>
      run(inProject(draftArgs(head, 'd.bin', dpin, frameTail(dsnap, 0, 4)), project));
    // CONTROL: each snapshot reads for the project it was prepared for.
    expect(committedFrame('demo')).toMatchObject({ ok: true, snapshot: csnap });
    expect(draftFrame('demo')).toMatchObject({ ok: true, snapshot: dsnap });
    // CONTROL: the second project is a real one, and prepares the same doc under a snapshot of its own.
    expect(run(inProject(committedArgs(head, 'specs', 'a.md', cpin, ['--prepare']), 'other'))).toMatchObject({ ok: true });
    // Another project, the same commit (or branch and head), section, path and pin: refused.
    expect(committedFrame('other')).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    expect(draftFrame('other')).toMatchObject({ ok: false, failure: 'snapshot-gone' });
  });

  it('range: a snapshot rewritten in place at its own size answers snapshot-gone at its next frame', () => {
    const blob = bytesOf(600_000);
    const c = committed({ [`${SPECS}/a.bin`]: blob });
    const pin = `blob:${c.blob(`${SPECS}/a.bin`)}`;
    const prepare = (): string => String(run(committedArgs(c.commit, 'specs', 'a.bin', pin, ['--prepare']))['snapshot']);
    const frame = (snapshot: string): Answer => run(committedArgs(c.commit, 'specs', 'a.bin', pin, frameTail(snapshot, 0, 1000)));
    const binOf = (snapshot: string): string => path.join(cacheDir(), `${snapshot}.bin`);
    // The finished copy is sealed read-only, and its identity is on record.
    const s0 = prepare();
    expect(fs.statSync(binOf(s0)).mode & 0o777).toBe(0o400);
    // Read as text: a nanosecond time is past what a JSON number holds in JavaScript.
    const meta = fs.readFileSync(path.join(cacheDir(), `${s0}.meta`), 'utf8');
    const st0 = fs.statSync(binOf(s0), { bigint: true });
    expect(meta).toContain(`"ino":${st0.ino},`);
    expect(meta).toContain(`"mtime_ns":${st0.mtimeNs},`);
    expect(meta).toMatch(new RegExp(`"ctime_ns":${st0.ctimeNs}[,}]`));
    // CONTROL: frames read, and a frame's touch of the record does not disturb the identity.
    expect(frame(s0)).toMatchObject({ ok: true });
    expect(frame(s0)).toMatchObject({ ok: true });
    // Rewritten in place: the same size and the same inode, other bytes. The modified time is put back, too.
    const rewrite = (snapshot: string, keepMtime: boolean): void => {
      const before = fs.statSync(binOf(snapshot));
      fs.chmodSync(binOf(snapshot), 0o600);
      const fd = fs.openSync(binOf(snapshot), 'r+');
      fs.writeSync(fd, Buffer.alloc(before.size, 0x5a));
      fs.closeSync(fd);
      if (keepMtime) fs.utimesSync(binOf(snapshot), before.atime, before.mtime);
      expect(fs.statSync(binOf(snapshot)).size).toBe(blob.length);
    };
    rewrite(s0, false);
    expect(frame(s0)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    expect(cacheNames().filter((n) => n.startsWith(s0))).toEqual([]);
    const s1 = prepare();
    rewrite(s1, true);
    expect(frame(s1)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // A different file of the same bytes put in its place (a new inode) is not the sealed one either.
    const s2 = prepare();
    const raw = fs.readFileSync(binOf(s2));
    fs.rmSync(binOf(s2));
    fs.writeFileSync(binOf(s2), raw, { mode: 0o400 });
    expect(frame(s2)).toMatchObject({ ok: false, failure: 'snapshot-gone' });
    // CONTROL: a snapshot left alone still reads.
    expect(frame(prepare())).toMatchObject({ ok: true });
  });

  it('range: a reservation or record stamped in the future is junk, and holds nothing', () => {
    const c = committed({ [`${SPECS}/a.md`]: 'tiny\n' });
    const pin = `blob:${c.blob(`${SPECS}/a.md`)}`;
    const args = committedArgs(c.commit, 'specs', 'a.md', pin, ['--prepare']);
    // Two reservations an hour ahead would fill both live slots for good: they are junk, so a prepare is not busy.
    plantReservation(1024, Date.now() + 3_600_000);
    plantReservation(1024, Date.now() + 3_600_000);
    expect(cacheNames().filter((n) => n.endsWith('.resv'))).toHaveLength(2);
    const prep = run(args);
    expect(prep).toMatchObject({ ok: true });
    expect(cacheNames().filter((n) => n.endsWith('.resv'))).toEqual([]);
    // Within the skew a reservation still counts (CONTROL): one a second ahead is live, two make a third prepare busy.
    plantReservation(1024, Date.now() + 1000);
    plantReservation(1024, Date.now() + 1000);
    expect(run(args)).toMatchObject({ ok: false, failure: 'prepare-busy' });
    // A snapshot record whose last use is in the future never expires, so it is junk as well.
    const snapshot = String(prep['snapshot']);
    const metaFile = path.join(cacheDir(), `${snapshot}.meta`);
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown>;
    expect(run(committedArgs(c.commit, 'specs', 'a.md', pin, frameTail(snapshot, 0, 5)))).toMatchObject({ ok: true });
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, used: Date.now() + 3_600_000 }));
    expect(run(committedArgs(c.commit, 'specs', 'a.md', pin, frameTail(snapshot, 0, 5)))).toMatchObject({ ok: false, failure: 'snapshot-gone' });
  });

  it('range: a record of another user is ignored, and the dead-reservation age is a multiple of the copy budget', () => {
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'bound'), '1000');
    // CONTROL: this user's file reads; the same read with another uid answering `getuid` is None.
    const read = (delta: number): unknown => unitJson<unknown>(h.home, [
      'import os',
      `cache = H.range_open_dir(${JSON.stringify(dir)})`,
      'real = os.getuid()',
      `os.getuid = lambda: real + ${delta}`,
      "r = H.range_read_small(cache, 'bound', 32)",
      "out(None if r is None else r.decode('ascii'))",
    ].join('\n'));
    expect(read(0)).toBe('1000');
    expect(read(1)).toBeNull();
    const consts = unitJson<{ ttl: number; budget: number }>(h.home,
      'out({"ttl": H.RANGE_RESERVATION_TTL_MS, "budget": H.DOCS_RANGE_PREPARE_BUDGET_MS})');
    expect(consts.ttl).toBeGreaterThanOrEqual(6 * consts.budget);
  });
});
