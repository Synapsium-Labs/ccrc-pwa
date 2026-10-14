// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2): a failed journal append undoes its own bytes. A real
// `writeSync` cannot be made short and a real `fsyncSync` cannot be made to fail on demand, so `node:fs` is mocked here,
// pass-through by default (`update-spawn-deadline.test.ts`'s shape), and a case arms ONE failure for ONE call. The
// adapter is the production one, built by its one-parameter constructor, against real files under a fixture HOME
// (mkTmp); the store cases build `CoordStore` on a fixture database the way `collect-lane-store.test.ts` does. Never a
// live database, never a journal resolved from the real HOME.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { collectLaneJournalAt, defaultCollectLaneJournalPath } from '../src/coord/collectLaneJournal.js';
import {
  collectLaneControl, collectLaneEffective, measureCollectLaneRow,
  type CollectLaneControl, type CollectLaneJournal, type CollectLaneWriteRequest,
} from '../src/collectLane.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

type Real = (...args: unknown[]) => unknown;
type Hook = (real: Real, ...args: unknown[]) => unknown;
interface Call { readonly name: string; readonly args: readonly unknown[] }
/** The armed hooks by function name, and the call log while one is open. Reset after every case. */
const h = vi.hoisted(() => ({ hooks: new Map<string, Hook>(), log: null as Call[] | null }));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  const wrap = (name: string): Real => {
    const fn = (real as unknown as Record<string, Real>)[name]!;
    return (...args: unknown[]) => {
      h.log?.push({ name, args });
      const hook = h.hooks.get(name);
      return hook === undefined ? fn(...args) : hook(fn, ...args);
    };
  };
  return {
    ...real,
    openSync: wrap('openSync'), fstatSync: wrap('fstatSync'), writeSync: wrap('writeSync'), fsyncSync: wrap('fsyncSync'),
    ftruncateSync: wrap('ftruncateSync'), unlinkSync: wrap('unlinkSync'), closeSync: wrap('closeSync'),
  };
});

afterEach(() => {
  h.hooks.clear();
  h.log = null;
  removeTmpFixtures();
});

const AT = Date.parse('2026-10-12T12:00:00Z');
const NODE_A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const NODE_B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SEED_RAW = { id: 1n, choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n };

type Journal = CollectLaneJournal & { readonly logPath: string };
/** A store on a fresh fixture database, and the journal beside it (its directory exists: the database lives there). */
const opened = (): { s: CoordStore; j: Journal } => {
  const home = mkTmp('ccrc-collect-undo-');
  const ccrcDir = path.join(home, '.ccrc');
  return { s: new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db'))),
    j: collectLaneJournalAt(defaultCollectLaneJournalPath(ccrcDir)) };
};
/** A store already Live at generation 1, its journal `{"generation":1}\n`: the existing arm's starting state. */
const liveAtOne = (): { s: CoordStore; j: Journal } => {
  const o = opened();
  expect(o.s.setCollectLane(live(o.s, o.j, NODE_A), AT, o.j)).toMatchObject({ kind: 'written', generation: 1 });
  expect(readFileSync(o.j.logPath, 'utf8'), 'CONTROL: the starting journal').toBe('{"generation":1}\n');
  return o;
};
/** The row exactly as SQLite holds it, every INTEGER as a bigint. */
const rawRow = (s: CoordStore): unknown => {
  const st = s.db.prepare('SELECT id, choice, fleetNodeId, markerRetiredAt, generation, updatedAt FROM collect_lane_settings');
  st.setReadBigInts(true);
  return st.all();
};
const live = (s: CoordStore, j: CollectLaneJournal, fleetNodeId: string): Extract<CollectLaneWriteRequest, { kind: 'live' }> =>
  ({ kind: 'live', fleetNodeId, expected: s.collectLaneRow(), expectedJournal: j.read() });
const retire = (s: CoordStore, j: CollectLaneJournal): CollectLaneWriteRequest =>
  ({ kind: 'retire', expected: s.collectLaneRow(), expectedJournal: j.read() });
const controlOf = (s: CoordStore, j: CollectLaneJournal): CollectLaneControl =>
  collectLaneControl(measureCollectLaneRow(s.collectLaneRow()), j.read());
/** The lane under every other condition met (unpaused, capable, the node known): what the control alone arms. */
const effective = (control: CollectLaneControl) => collectLaneEffective({
  switches: { paused: false, marker: false }, epoch: { before: 1, after: 1 }, caps: { collect: true, reclaimPause: true },
  control, node: { kind: 'known', connectionEpoch: 1, nodeId: NODE_A, measuredAt: AT },
});

const fsError = (message: string, code: string): Error => Object.assign(new Error(message), { code });
/** The `code` a call throws, or `no throw`. */
const thrownCode = (fn: () => void): unknown => {
  try { fn(); } catch (e) { return (e as { code?: unknown }).code; }
  return 'no throw';
};
/** Arms `name` to run `act` instead, ONCE, on the first call `when` accepts; every other call passes through. */
const failOnce = (name: string, when: (...args: unknown[]) => boolean, act: Hook): { fired: () => number } => {
  let fired = 0;
  h.hooks.set(name, (real, ...args) => {
    if (fired > 0 || !when(...args)) return real(...args);
    fired += 1;
    return act(real, ...args);
  });
  return { fired: () => fired };
};
const always = (): boolean => true;
/** A short write: only the first `n` bytes land, for real, and the call answers `n`. */
const shortBy = (n: number): Hook => (real, fd, buf) => real(fd, (buf as Buffer).subarray(0, n));
const throwing = (message: string, code: string): Hook => () => { throw fsError(message, code); };
/** Every fd an `openSync` of `p` answered, in order (the call passes through). */
const fdsOpenedOn = (p: string): number[] => {
  const fds: number[] = [];
  h.hooks.set('openSync', (real, ...args) => {
    const fd = real(...args) as number;
    if (args[0] === p) fds.push(fd);
    return fd;
  });
  return fds;
};
/** The names of the logged calls made on descriptor `fd`, in order. */
const onFd = (log: readonly Call[], fd: unknown): string[] => log.filter((c) => c.args[0] === fd).map((c) => c.name);

describe('a failed journal append undoes its own bytes (path-identity spec 2026-10-12 §5.2)', () => {
  it('(i) a short write on an existing journal: the bytes are exactly the bytes before, and the next read is coherent with the row', () => {
    const { s, j } = liveAtOne();
    const before = readFileSync(j.logPath);
    let landed = '';
    const w = failOnce('writeSync', always, (real, ...args) => {
      const n = shortBy(5)(real, ...args);
      landed = readFileSync(j.logPath, 'utf8');
      return n;
    });
    h.log = [];
    expect(thrownCode(() => j.appendGeneration(2))).toBe('EIO');
    const log = h.log;
    h.log = null;
    expect(w.fired(), 'CONTROL: the short write fired').toBe(1);
    expect(landed, 'CONTROL: five bytes landed before the undo').toBe('{"generation":1}\n{"gen');
    expect(readFileSync(j.logPath)).toEqual(before);
    expect(j.read()).toEqual({ kind: 'ok', max: 1, records: 1 });
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 1, bootstrap: false });
    // The undo, on the append's own descriptor: truncate to the measured length, fsync it, THEN close.
    const cut = log.find((c) => c.name === 'ftruncateSync');
    expect(cut?.args[1], 'the truncate is to the length the fstat measured').toBe(before.length);
    expect(onFd(log, cut?.args[0])).toEqual(['fstatSync', 'writeSync', 'ftruncateSync', 'fsyncSync', 'closeSync']);
    expect(log.filter((c) => c.name === 'unlinkSync'), 'an existing journal is never removed').toEqual([]);
  });

  it('(ii) a write that throws with nothing written: the bytes are unchanged', () => {
    const { s, j } = liveAtOne();
    const before = readFileSync(j.logPath);
    const w = failOnce('writeSync', always, throwing('ENOSPC: no space left on device, write', 'ENOSPC'));
    expect(thrownCode(() => j.appendGeneration(2))).toBe('ENOSPC');
    expect(w.fired(), 'CONTROL: the write threw').toBe(1);
    expect(readFileSync(j.logPath)).toEqual(before);
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 1 });
  });

  it('(iii) a fsync that throws after a full write: the record is gone, and the read equals the row', () => {
    const { s, j } = liveAtOne();
    const before = readFileSync(j.logPath);
    let landed = '';
    const f = failOnce('fsyncSync', always, () => {
      landed = readFileSync(j.logPath, 'utf8');
      throw fsError('EDQUOT: disk quota exceeded, fsync', 'EDQUOT');
    });
    expect(thrownCode(() => j.appendGeneration(2))).toBe('EDQUOT');
    expect(f.fired(), 'CONTROL: the fsync threw').toBe(1);
    expect(landed, 'CONTROL: the whole record landed before the fsync threw').toBe('{"generation":1}\n{"generation":2}\n');
    expect(readFileSync(j.logPath)).toEqual(before);
    expect(j.read()).toEqual({ kind: 'ok', max: 1, records: 1 });
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 1 });
  });

  it.each([
    ['the fstat', 'fstatSync', throwing('EIO: i/o error, fstat', 'EIO'), 'EIO'],
    ['the write', 'writeSync', throwing('ENOSPC: no space left on device, write', 'ENOSPC'), 'ENOSPC'],
    ['a short write', 'writeSync', shortBy(4), 'EIO'],
    ['the fsync', 'fsyncSync', throwing('EDQUOT: disk quota exceeded, fsync', 'EDQUOT'), 'EDQUOT'],
  ] as const)('(iv) a throw on a created file, at %s: the file is absent, and the lane reads the seed state', (_what, name, act, code) => {
    const { s, j } = opened();
    const dir = path.dirname(j.logPath);
    expect(existsSync(dir), 'CONTROL: the directory stands, so the open creates only the file').toBe(true);
    const dirFds = fdsOpenedOn(dir);
    const f = failOnce(name, always, act);
    h.log = [];
    expect(thrownCode(() => j.appendGeneration(1))).toBe(code);
    const log = h.log;
    h.log = null;
    expect(f.fired(), 'CONTROL: the failure fired').toBe(1);
    expect(existsSync(j.logPath), 'the file this call created is still there').toBe(false);
    expect(j.read()).toEqual({ kind: 'missing' });
    expect(rawRow(s)).toEqual([SEED_RAW]);
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 0, bootstrap: true });
    expect(log.filter((c) => c.name === 'unlinkSync').map((c) => c.args[0]), 'the undo removes exactly the journal')
      .toEqual([j.logPath]);
    expect(log.filter((c) => c.name === 'ftruncateSync'), 'a created file is removed, never truncated to empty').toEqual([]);
    // After the unlink, the undo opens the directory, fsyncs it and closes it, and only then is the journal closed.
    const tail = log.slice(log.findIndex((c) => c.name === 'unlinkSync'));
    expect(tail.map((c) => c.name)).toEqual(['unlinkSync', 'openSync', 'fsyncSync', 'closeSync', 'closeSync']);
    expect(tail[1]?.args[0], 'the undo opens the journal’s directory').toBe(dir);
    expect(dirFds, 'CONTROL: the failure came before the success path’s own directory open').toHaveLength(1);
    expect(tail[2]?.args[0], 'the undo fsyncs the directory it opened').toBe(dirFds[0]);
    expect(tail[3]?.args[0], 'and closes it').toBe(dirFds[0]);
  });

  it('(v-a) a short write whose ftruncateSync throws: the error is the original’s code, and the journal reads malformed', () => {
    const { s, j } = liveAtOne();
    failOnce('writeSync', always, shortBy(5));
    const t = failOnce('ftruncateSync', always, throwing('EROFS: read-only file system, ftruncate', 'EROFS'));
    expect(thrownCode(() => j.appendGeneration(2))).toBe('EIO');
    expect(t.fired(), 'CONTROL: the undo ran and its truncate threw').toBe(1);
    expect(readFileSync(j.logPath, 'utf8')).toBe('{"generation":1}\n{"gen');
    expect(j.read()).toMatchObject({ kind: 'malformed', fault: 'json', record: 2 });
    expect(effective(controlOf(s, j))).toEqual({ kind: 'safety-stopped', why: 'journal-malformed' });
  });

  it('(v-b) a fsync throw whose ftruncateSync throws: the error is the original’s code, and the journal reads ok but one generation ahead, a mismatch that arms nothing', () => {
    const { s, j } = liveAtOne();
    failOnce('fsyncSync', always, throwing('EDQUOT: disk quota exceeded, fsync', 'EDQUOT'));
    const t = failOnce('ftruncateSync', always, throwing('EROFS: read-only file system, ftruncate', 'EROFS'));
    expect(thrownCode(() => j.appendGeneration(2))).toBe('EDQUOT');
    expect(t.fired(), 'CONTROL: the undo ran and its truncate threw').toBe(1);
    expect(j.read()).toEqual({ kind: 'ok', max: 2, records: 2 });
    const c = controlOf(s, j);
    expect(c).toMatchObject({ kind: 'mismatch', journalMax: 2, rowGeneration: 1 });
    expect(effective(c)).toEqual({ kind: 'safety-stopped', why: 'generation-mismatch' });
  });

  it.each([
    ['a short write', 'writeSync', shortBy(5), 'EIO'],
    ['a write that throws', 'writeSync', throwing('ENOSPC: no space left on device, write', 'ENOSPC'), 'ENOSPC'],
    ['a fsync that throws', 'fsyncSync', throwing('EDQUOT: disk quota exceeded, fsync', 'EDQUOT'), 'EDQUOT'],
  ] as const)('(vi) through setCollectLane, a failed append (%s) leaves BOTH the row and the journal equal to their before-reads, and the next confirmed write succeeds with the next generation', (_what, name, act, code) => {
    const { s, j } = liveAtOne();
    const rowBefore = rawRow(s);
    const bytesBefore = readFileSync(j.logPath);
    const req = live(s, j, NODE_B);
    const f = failOnce(name, always, act);
    expect(s.setCollectLane(req, AT + 1, j)).toEqual({ kind: 'failed', phase: 'append', code });
    expect(f.fired(), 'CONTROL: the failure fired').toBe(1);
    h.hooks.clear();
    expect(rawRow(s)).toEqual(rowBefore);
    expect(readFileSync(j.logPath)).toEqual(bytesBefore);
    expect(s.collectLaneRow(), 'the row equals the request’s own expectation').toEqual(req.expected);
    expect(j.read(), 'the journal equals the request’s own expectation').toEqual(req.expectedJournal);
    // The same request, its expectations unmoved, now writes the NEXT generation: nothing was consumed.
    expect(s.setCollectLane(req, AT + 2, j)).toMatchObject({ kind: 'written', generation: 2 });
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 2 });
  });

  it('(vii) the created arm’s directory fsync throws: the file is absent and the seed coherent, and a latch retire from the bootstrap then succeeds at generation 1', () => {
    const { s, j } = opened();
    const dirFds = fdsOpenedOn(path.dirname(j.logPath));
    const f = failOnce('fsyncSync', (fd) => dirFds.includes(fd as number), throwing('EIO: i/o error, fsync', 'EIO'));
    h.log = [];
    expect(s.setCollectLane(retire(s, j), AT, j)).toEqual({ kind: 'failed', phase: 'append', code: 'EIO' });
    const log = h.log;
    h.log = null;
    expect(f.fired(), 'CONTROL: the directory fsync threw').toBe(1);
    h.hooks.clear();
    // The undo's own directory fsync, on a second open of the directory, after the unlink and before the journal's close.
    const tail = log.slice(log.findIndex((c) => c.name === 'unlinkSync'));
    expect(tail.map((c) => c.name)).toEqual(['unlinkSync', 'openSync', 'fsyncSync', 'closeSync', 'closeSync']);
    expect(dirFds, 'the success path’s directory open, then the undo’s').toHaveLength(2);
    expect(tail[2]?.args[0], 'the undo fsyncs the directory it opened').toBe(dirFds[1]);
    expect(existsSync(j.logPath), 'the file this call created is still there').toBe(false);
    expect(rawRow(s)).toEqual([SEED_RAW]);
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 0, bootstrap: true });
    expect(s.setCollectLane(retire(s, j), AT + 1, j)).toMatchObject({ kind: 'written', generation: 1 });
    expect(readFileSync(j.logPath, 'utf8')).toBe('{"generation":1}\n');
  });

  it('(viii) the close throws during a failed write: setCollectLane’s code is the original error’s', () => {
    const { s, j } = liveAtOne();
    const rowBefore = rawRow(s);
    const bytesBefore = readFileSync(j.logPath);
    const req = live(s, j, NODE_B);
    const fileFds = fdsOpenedOn(j.logPath);
    let writeFailed = false;
    failOnce('writeSync', always, () => {
      writeFailed = true;
      throw fsError('ENOSPC: no space left on device, write', 'ENOSPC');
    });
    // The descriptor IS released (Linux closes it even when close reports an error); only the report is the fault.
    const c = failOnce('closeSync', (fd) => writeFailed && fileFds.includes(fd as number), (real, fd) => {
      real(fd);
      throw fsError('EIO: i/o error, close', 'EIO');
    });
    expect(s.setCollectLane(req, AT + 1, j)).toEqual({ kind: 'failed', phase: 'append', code: 'ENOSPC' });
    expect(c.fired(), 'CONTROL: the close threw').toBe(1);
    h.hooks.clear();
    expect(rawRow(s)).toEqual(rowBefore);
    expect(readFileSync(j.logPath)).toEqual(bytesBefore);
  });

  it('(ix) a short write on a planted {"generation":1} with no final newline: exactly those bytes remain', () => {
    const home = mkTmp('ccrc-collect-undo-');
    const ccrcDir = path.join(home, '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    const j = collectLaneJournalAt(defaultCollectLaneJournalPath(ccrcDir));
    writeFileSync(j.logPath, '{"generation":1}');
    let landed = '';
    const w = failOnce('writeSync', always, (real, ...args) => {
      const n = shortBy(3)(real, ...args);
      landed = readFileSync(j.logPath, 'utf8');
      return n;
    });
    expect(thrownCode(() => j.appendGeneration(2))).toBe('EIO');
    expect(w.fired(), 'CONTROL: the short write fired').toBe(1);
    expect(landed, 'CONTROL: the lead newline and two bytes landed before the undo').toBe('{"generation":1}\n{"');
    expect(readFileSync(j.logPath, 'utf8')).toBe('{"generation":1}');
    expect(j.read()).toEqual({ kind: 'ok', max: 1, records: 1 });
  });

  it('(x) an fstat that throws on an existing journal undoes nothing: the bytes are exactly unchanged, and nothing is truncated', () => {
    const { s, j } = liveAtOne();
    const before = readFileSync(j.logPath);
    const f = failOnce('fstatSync', always, throwing('EIO: i/o error, fstat', 'EIO'));
    h.log = [];
    expect(thrownCode(() => j.appendGeneration(2))).toBe('EIO');
    const log = h.log;
    h.log = null;
    expect(f.fired(), 'CONTROL: the fstat threw').toBe(1);
    expect(readFileSync(j.logPath)).toEqual(before);
    expect(log.filter((c) => c.name === 'ftruncateSync'), 'a length the fstat never measured is never truncated to').toEqual([]);
    expect(log.filter((c) => c.name === 'unlinkSync'), 'an existing journal is never removed').toEqual([]);
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 1 });
  });

  it('(xi) the created arm’s directory fsync throws and the directory’s close throws too: setCollectLane’s code is the fsync’s, the file is absent, and the seed coherent', () => {
    const { s, j } = opened();
    const dir = path.dirname(j.logPath);
    const dirFds = fdsOpenedOn(dir);
    let fsyncOn: unknown = null;
    let closeOn: unknown = null;
    let closeAt = -1;
    const f = failOnce('fsyncSync', (fd) => dirFds.includes(fd as number), (_real, fd) => {
      fsyncOn = fd;
      throw fsError('EIO: i/o error, fsync', 'EIO');
    });
    // The descriptor IS released (Linux closes it even when close reports an error); only the report is the fault.
    const c = failOnce('closeSync', (fd) => dirFds.includes(fd as number), (real, fd) => {
      closeOn = fd;
      closeAt = (h.log?.length ?? 0) - 1;
      real(fd);
      throw fsError('EBADF: bad file descriptor, close', 'EBADF');
    });
    h.log = [];
    const out = s.setCollectLane(live(s, j, NODE_A), AT, j);
    const log = h.log;
    h.log = null;
    expect(f.fired(), 'CONTROL: the directory fsync threw').toBe(1);
    expect(c.fired(), 'CONTROL: the directory close threw').toBe(1);
    expect(fsyncOn, 'CONTROL: the fsync fault is on the success path’s directory descriptor').toBe(dirFds[0]);
    expect(closeOn, 'CONTROL: the close fault is on that same directory descriptor').toBe(dirFds[0]);
    // A fault armed on the journal's descriptor reds at the descriptor-number CONTROL above: the journal is still open
    // when the directory opens, so the two numbers differ. A fault armed on the undo's own directory close passes that
    // CONTROL, because the undo's descriptor reuses `dirFds[0]`'s number, and reds at this one: the success path's
    // directory close sits in the `finally` straight after its fsync, so it is the first close after that fsync.
    const dirOpenAt = log.findIndex((x) => x.name === 'openSync' && x.args[0] === dir);
    const dirFsyncAt = log.findIndex((x, i) => i > dirOpenAt && x.name === 'fsyncSync' && x.args[0] === dirFds[0]);
    expect(dirFsyncAt, 'CONTROL: the directory was fsynced after its open').toBeGreaterThan(-1);
    expect(closeAt, 'CONTROL: the faulted close is the first close after the directory’s fsync, the directory’s own')
      .toBe(log.findIndex((x, i) => i > dirFsyncAt && x.name === 'closeSync'));
    h.hooks.clear();
    expect(out).toEqual({ kind: 'failed', phase: 'append', code: 'EIO' });
    expect(existsSync(j.logPath), 'the file this call created is still there').toBe(false);
    expect(rawRow(s)).toEqual([SEED_RAW]);
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 0, bootstrap: true });
  });

  it('(xii) the created arm’s fsyncs succeed and only the directory’s close throws: the write is written, the file holds the record, and the row commits at that generation', () => {
    const { s, j } = opened();
    const dir = path.dirname(j.logPath);
    const dirFds = fdsOpenedOn(dir);
    let closeOn: unknown = null;
    let closeAt = -1;
    // The descriptor IS released (Linux closes it even when close reports an error); only the report is the fault.
    const c = failOnce('closeSync', (fd) => dirFds.includes(fd as number), (real, fd) => {
      closeOn = fd;
      closeAt = (h.log?.length ?? 0) - 1;
      real(fd);
      throw fsError('EBADF: bad file descriptor, close', 'EBADF');
    });
    h.log = [];
    const out = s.setCollectLane(live(s, j, NODE_A), AT, j);
    const log = h.log;
    h.log = null;
    expect(c.fired(), 'CONTROL: the directory close threw').toBe(1);
    const journalFd = log.find((x) => x.name === 'writeSync')?.args[0];
    expect(closeOn, 'CONTROL: the close fault is on the success path’s directory descriptor').toBe(dirFds[0]);
    // A fault armed on the journal's descriptor reds at the descriptor-number CONTROL above, as in (xi). This CONTROL
    // pins the faulted close's position, the first close after the directory's fsync. No misarm measured here reds it
    // alone: the directory opens once on this path, and only its own close carries `dirFds[0]`'s number.
    const dirOpenAt = log.findIndex((x) => x.name === 'openSync' && x.args[0] === dir);
    const dirFsyncAt = log.findIndex((x, i) => i > dirOpenAt && x.name === 'fsyncSync' && x.args[0] === dirFds[0]);
    expect(dirFsyncAt, 'CONTROL: the directory was fsynced after its open').toBeGreaterThan(-1);
    expect(closeAt, 'CONTROL: the faulted close is the first close after the directory’s fsync, the directory’s own')
      .toBe(log.findIndex((x, i) => i > dirFsyncAt && x.name === 'closeSync'));
    expect(log.filter((x) => x.name === 'fsyncSync').slice(0, 2).map((x) => x.args[0]),
      'CONTROL: both fsyncs ran and succeeded, the file’s then the directory’s').toEqual([journalFd, dirFds[0]]);
    h.hooks.clear();
    expect(out).toMatchObject({ kind: 'written', generation: 1 });
    expect(readFileSync(j.logPath, 'utf8')).toBe('{"generation":1}\n');
    expect(s.collectLaneRow(), 'the row commits at that generation')
      .toMatchObject({ kind: 'row', row: { choice: 'live', fleetNodeId: NODE_A, generation: 1n } });
    expect(controlOf(s, j)).toMatchObject({ kind: 'coherent', generation: 1, bootstrap: false });
  });

  it('(xiii) the created arm’s success path fsyncs the directory before the journal’s close', () => {
    const { j } = opened();
    const dir = path.dirname(j.logPath);
    const dirFds = fdsOpenedOn(dir);
    h.log = [];
    expect(thrownCode(() => j.appendGeneration(1)), 'CONTROL: the append succeeds').toBe('no throw');
    const log = h.log;
    h.log = null;
    expect(readFileSync(j.logPath, 'utf8'), 'CONTROL: the record landed').toBe('{"generation":1}\n');
    expect(dirFds, 'CONTROL: the success path opened the directory once').toHaveLength(1);
    // The journal's close is the first close carrying its descriptor's number, sound because the log begins at the
    // journal's own open; the directory's fsync is the first fsync on its descriptor after the directory's open.
    const journalFd = log.find((c) => c.name === 'writeSync')?.args[0];
    const dirOpen = log.findIndex((c) => c.name === 'openSync' && c.args[0] === dir);
    const dirFsync = log.findIndex((c, i) => i > dirOpen && c.name === 'fsyncSync' && c.args[0] === dirFds[0]);
    const journalClose = log.findIndex((c) => c.name === 'closeSync' && c.args[0] === journalFd);
    expect(dirOpen, 'CONTROL: the directory was opened').toBeGreaterThan(-1);
    expect(dirFsync, 'CONTROL: the directory was fsynced').toBeGreaterThan(-1);
    expect(journalClose, 'CONTROL: the journal was closed').toBeGreaterThan(-1);
    expect(dirFsync, 'the directory fsync comes before the journal’s close').toBeLessThan(journalClose);
  });
});
