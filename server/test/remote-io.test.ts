import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet, FleetClient } from '../src/remote/client.js';
import { createIo } from '../src/remote/io.js';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';
import { MAX_READ_B64_BYTES } from '../../agent/src/fileops.js';

describe('remote FleetIO — file ops over the agent WS', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function connected(): Promise<ConnectedFleet> {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    return fleet;
  }

  it('readFile round-trips content, null when missing', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-sessions', 'x.json');
    writeFileSync(file, '{"a":1}');
    expect(await f.io.readFile(file)).toBe('{"a":1}');
    expect(await f.io.readFile(path.join(fixture!.home, '.cc-sessions', 'nope.json'))).toBeNull();
  });

  it('readFileFrom returns a byte offset slice plus the full size', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-sessions', 'x.log');
    writeFileSync(file, 'abcdefghij');
    expect(await f.io.readFileFrom(file, 4)).toEqual({ data: 'efghij', size: 10 });
  });

  it('readFileB64 round-trips binary bytes as base64, null when missing', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-clips', 'clip.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(file, bytes);
    expect(await f.io.readFileB64(file)).toBe(bytes.toString('base64'));
    expect(await f.io.readFileB64(path.join(fixture!.home, '.cc-clips', 'nope.png'))).toBeNull();
  });

  it('an over-cap clip reads as {ok:false, reason:"too-large"} with the real size, not as missing', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-clips', 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    expect(await f.io.readFileB64Measured(file)).toEqual({ ok: false, reason: 'too-large', size: MAX_READ_B64_BYTES + 1 });
    // And the derived method still answers today's null, so its one caller is untouched until Task 8.
    expect(await f.io.readFileB64(file)).toBeNull();
  });

  it('readdir lists names, null when missing', async () => {
    const f = await connected();
    const dir = path.join(fixture!.home, '.cc-sessions', 'sub');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    writeFileSync(path.join(dir, 'b.txt'), 'y');
    const names = await f.io.readdir(dir);
    expect(names?.slice().sort()).toEqual(['a.txt', 'b.txt']);
    expect(await f.io.readdir(path.join(dir, 'nope'))).toBeNull();
  });

  it('stat reports mtimeMs/size, null when missing', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-sessions', 'y.txt');
    writeFileSync(file, 'abcd');
    const s = await f.io.stat(file);
    expect(s).not.toBeNull();
    expect(s!.size).toBe(4);
    expect(typeof s!.mtimeMs).toBe('number');
    expect(await f.io.stat(path.join(fixture!.home, '.cc-sessions', 'nope.txt'))).toBeNull();
  });

  it('writeFileB64 mkdir-ps the parent and writes decoded bytes, in the writable whitelist', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-clips', 'deep', 'nested', 'clip.png');
    const data = Buffer.from('89504e470d0a1a0a', 'hex');
    await f.io.writeFileB64(file, data.toString('base64'));
    expect(readFileSync(file)).toEqual(data);
  });

  it('a path outside the whitelist reads back as null rather than throwing', async () => {
    const f = await connected();
    const outside = path.join(fixture!.projectsRoot, '..', 'definitely-outside.txt');
    expect(await f.io.readFile(outside)).toBeNull();
  });

  it('read ops return null (not a rejection) once the agent is unreachable', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-sessions', 'z.txt');
    writeFileSync(file, 'hi');
    await agent!.close();
    agent = undefined; // already closed — afterEach shouldn't double-close
    await expect(f.io.readFile(file)).resolves.toBeNull();
  });

  describe('readFileMeasured', () => {
    it('round-trips content as {ok:true, content}', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'x.json');
      writeFileSync(file, '{"a":1}');
      expect(await f.io.readFileMeasured(file)).toEqual({ ok: true, content: '{"a":1}' });
    });

    it('a missing file reads as {ok:false, reason:"absent"}', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'nope.json');
      expect(await f.io.readFileMeasured(file)).toEqual({ ok: false, reason: 'absent' });
    });

    it('a directory reads as {ok:false, reason:"unreadable"} (EISDIR, not ENOENT)', async () => {
      const f = await connected();
      const dir = path.join(fixture!.home, '.cc-sessions', 'a-directory');
      mkdirSync(dir, { recursive: true });
      expect(await f.io.readFileMeasured(dir)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('a path outside every whitelist reads as {ok:false, reason:"unreadable"}, NEVER "absent"', async () => {
      const f = await connected();
      const outside = path.join(fixture!.projectsRoot, '..', 'definitely-outside.txt');
      expect(await f.io.readFileMeasured(outside)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('a disconnected client reads as {ok:false, reason:"unreadable"}', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'z2.txt');
      writeFileSync(file, 'hi');
      await agent!.close();
      agent = undefined; // already closed — afterEach shouldn't double-close
      expect(await f.io.readFileMeasured(file)).toEqual({ ok: false, reason: 'unreadable' });
    });
  });

  describe('statMeasured', () => {
    it('a real file reads as {ok:true, …}, a missing one as {ok:false, reason:"absent"}', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'sm.txt');
      writeFileSync(file, 'abcd');
      expect(await f.io.statMeasured(file)).toMatchObject({ ok: true, size: 4 });
      expect(await f.io.statMeasured(path.join(fixture!.home, '.cc-sessions', 'nope.txt')))
        .toEqual({ ok: false, reason: 'absent' });
    });

    it('a path THROUGH a file (ENOTDIR) reads as "unreadable", NEVER "absent" — the D-114 case, end to end', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'sm2.txt');
      writeFileSync(file, 'abcd');
      expect(await f.io.statMeasured(path.join(file, 'child'))).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('a path outside every whitelist reads as "unreadable", NEVER "absent"', async () => {
      const f = await connected();
      const outside = path.join(fixture!.projectsRoot, '..', 'definitely-outside.txt');
      expect(await f.io.statMeasured(outside)).toEqual({ ok: false, reason: 'unreadable' });
    });
  });

  describe('lstatMeasured', () => {
    it('answers about the PATH end to end — a live symlink is `symlink` while stat still answers about the target', async () => {
      const f = await connected();
      const target = path.join(fixture!.home, '.cc-sessions', 'lm-target.txt');
      const link = path.join(fixture!.home, '.cc-sessions', 'lm-link.txt');
      writeFileSync(target, 'abcd');
      symlinkSync(target, link);
      expect(await f.io.lstatMeasured(link)).toEqual({ ok: true, kind: 'symlink' });
      expect(await f.io.lstatMeasured(target)).toEqual({ ok: true, kind: 'regular' });
      // Proving the two ops really do disagree over this wire, not just in the
      // local adapter: `stat` follows and reports the target's four bytes.
      expect(await f.io.statMeasured(link)).toMatchObject({ ok: true, size: 4 });
    });

    it('a directory is `other`, a missing path is "absent", a path outside the whitelist is "unmeasured"', async () => {
      const f = await connected();
      expect(await f.io.lstatMeasured(path.join(fixture!.home, '.cc-sessions'))).toEqual({ ok: true, kind: 'other' });
      expect(await f.io.lstatMeasured(path.join(fixture!.home, '.cc-sessions', 'nope.txt')))
        .toEqual({ ok: false, reason: 'absent' });
      // A whitelist refusal is a REJECTED request, which this reader reports as
      // `unmeasured` — the same stance `statMeasured` takes when it answers
      // "unreadable" rather than "absent" for the same path, and for the same
      // reason: a refusal is not evidence about the file.
      const outside = path.join(fixture!.projectsRoot, '..', 'definitely-outside.txt');
      expect(await f.io.lstatMeasured(outside)).toEqual({ ok: false, reason: 'unmeasured' });
    });

    /** THE ESCAPE THE WHITELIST EXISTS TO STOP, asked of the one op that
     *  deliberately does NOT take `checkPath`'s canonical answer as its
     *  subject. The decision is still made on the fully resolved path, so a
     *  link out of the whitelist is refused before anything is lstat'd — and
     *  the refusal must not leak the answer it refused, which is why it reads
     *  as `unmeasured` and not as a kind. */
    it('a symlink inside the registry pointing OUTSIDE the whitelist is refused, not typed', async () => {
      const f = await connected();
      const outside = path.join(fixture!.projectsRoot, '..', 'escape-target.txt');
      writeFileSync(outside, 'secret');
      const link = path.join(fixture!.home, '.cc-sessions', 'escape-link');
      symlinkSync(outside, link);
      expect(await f.io.lstatMeasured(link)).toEqual({ ok: false, reason: 'unmeasured' });
      // And the content path is refused too, on the same decision — the op
      // added here widened nothing.
      expect(await f.io.readFileMeasured(link)).toEqual({ ok: false, reason: 'unreadable' });
    });
  });

  // ── delegation wave 3, Task 4 — the two additive measured reads, over a REAL agent ──
  // The stub tables below pin the reader's decisions one response at a time;
  // these pin the same reads against the real wire, so a disagreement between
  // what the agent sends and what the reader accepts is a red case here.
  describe('readdirMeasured and readFileFromBytesMeasured over the real wire', () => {
    const SPOOL_MAX = 262144;
    /** Every byte value in rotation, so a lossy UTF-8 round trip cannot hide. */
    const pattern = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));
    const u8 = (b: Buffer | readonly number[]): Uint8Array => new Uint8Array(b);
    const sess = (name: string): string => path.join(fixture!.home, '.cc-sessions', name);

    it('readdirMeasured lists a directory, and an EMPTY one is a POSITIVE [] — not a failure', async () => {
      const f = await connected();
      const dir = sess('dm-sub');
      mkdirSync(dir, { recursive: true });
      expect(await f.io.readdirMeasured(dir)).toEqual({ ok: true, entries: [] });
      writeFileSync(path.join(dir, 'a.txt'), 'x');
      writeFileSync(path.join(dir, 'b.txt'), 'y');
      const r = await f.io.readdirMeasured(dir);
      expect(r.ok).toBe(true);
      expect(r.ok && [...r.entries].sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('readdirMeasured: a missing directory is "absent"; a FILE (ENOTDIR) and a path THROUGH a file are "unreadable"', async () => {
      const f = await connected();
      expect(await f.io.readdirMeasured(sess('dm-nope'))).toEqual({ ok: false, reason: 'absent' });
      const file = sess('dm-a-file');
      writeFileSync(file, 'x');
      expect(await f.io.readdirMeasured(file)).toEqual({ ok: false, reason: 'unreadable' });
      expect(await f.io.readdirMeasured(path.join(file, 'child'))).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('readdirMeasured: a path outside every whitelist is "unreadable", NEVER "absent" — even when it does not exist', async () => {
      const f = await connected();
      const outside = path.join(fixture!.projectsRoot, '..', 'dm-definitely-outside-dir');
      expect(await f.io.readdirMeasured(outside)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('readdirMeasured: a disconnected agent is "unreadable"', async () => {
      const f = await connected();
      const dir = sess('dm-sub2');
      mkdirSync(dir, { recursive: true });
      await agent!.close();
      agent = undefined;   // already closed — afterEach shouldn't double-close
      expect(await f.io.readdirMeasured(dir)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('readdir keeps its collapse over the same wire: a listing stays a list ([] included), absent and unreadable are both null', async () => {
      const f = await connected();
      const dir = sess('dm-collapse');
      mkdirSync(dir, { recursive: true });
      expect(await f.io.readdir(dir)).toEqual([]);
      writeFileSync(path.join(dir, 'one'), '1');
      expect(await f.io.readdir(dir)).toEqual(['one']);
      expect(await f.io.readdir(sess('dm-collapse-nope'))).toBeNull();
      expect(await f.io.readdir(path.join(dir, 'one'))).toBeNull();
    });

    it.each([
      // [label, offset, maxBytes, expected bytes]
      ['start, 1 byte', 0, 1, 'a'],
      ['start, 4 bytes', 0, 4, 'abcd'],
      ['middle, 3 bytes', 4, 3, 'efg'],
      ['last byte', 9, 1, 'j'],
      ['the remainder is shorter than maxBytes', 8, SPOOL_MAX, 'ij'],
      ['the whole file under the largest bound', 0, SPOOL_MAX, 'abcdefghij'],
      ['exactly at EOF — a POSITIVE empty answer', 10, 5, ''],
    ] as const)('readFileFromBytesMeasured, %s', async (_label, offset, maxBytes, expected) => {
      const f = await connected();
      const file = sess('db-range.txt');
      writeFileSync(file, 'abcdefghij');
      expect(await f.io.readFileFromBytesMeasured(file, offset, maxBytes))
        .toEqual({ ok: true, bytes: u8(Buffer.from(expected)), size: 10 });
    });

    it('readFileFromBytesMeasured: an offset PAST the file\'s size (the cursor outran a shrunk file) is "unreadable" — a size regression', async () => {
      const f = await connected();
      const file = sess('db-shrunk.txt');
      writeFileSync(file, 'abcdefghij');
      expect(await f.io.readFileFromBytesMeasured(file, 12, 5)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('readFileFromBytesMeasured: the largest bound (262144) returns exactly that many bytes of a larger file, byte-exact, at an offset', async () => {
      const f = await connected();
      const bytes = pattern(SPOOL_MAX + 10);
      const file = sess('db-big.bin');
      writeFileSync(file, bytes);
      const r = await f.io.readFileFromBytesMeasured(file, 10, SPOOL_MAX);
      expect(r).toEqual({ ok: true, bytes: u8(bytes.subarray(10, 10 + SPOOL_MAX)), size: SPOOL_MAX + 10 });
    });

    it('readFileFromBytesMeasured: a bound of 1 returns one byte of a larger file, never more', async () => {
      const f = await connected();
      const bytes = pattern(SPOOL_MAX + 10);
      const file = sess('db-one.bin');
      writeFileSync(file, bytes);
      expect(await f.io.readFileFromBytesMeasured(file, 7, 1))
        .toEqual({ ok: true, bytes: u8(bytes.subarray(7, 8)), size: SPOOL_MAX + 10 });
    });

    it('readFileFromBytesMeasured: a multibyte character SPLIT by the bound comes back as its raw bytes, and rejoins through them alone', async () => {
      const f = await connected();
      const file = sess('db-euro.txt');
      writeFileSync(file, '€');   // e2 82 ac
      const first = await f.io.readFileFromBytesMeasured(file, 0, 1);
      const second = await f.io.readFileFromBytesMeasured(file, 1, 2);
      expect(first).toEqual({ ok: true, bytes: u8([0xe2]), size: 3 });
      expect(second).toEqual({ ok: true, bytes: u8([0x82, 0xac]), size: 3 });
      const joined = Buffer.concat([
        Buffer.from(first.ok ? first.bytes : []), Buffer.from(second.ok ? second.bytes : []),
      ]);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(joined)).toBe('€');
    });

    it('readFileFromBytesMeasured: bytes that are not UTF-8 at all come back exact', async () => {
      const f = await connected();
      const file = sess('db-not-utf8.bin');
      writeFileSync(file, Buffer.from([0xff, 0xfe, 0x00, 0x80]));
      expect(await f.io.readFileFromBytesMeasured(file, 0, 4))
        .toEqual({ ok: true, bytes: u8([0xff, 0xfe, 0x00, 0x80]), size: 4 });
    });

    it('readFileFromBytesMeasured: missing is "absent"; a DIRECTORY (EISDIR) and a path THROUGH a file (ENOTDIR) are "unreadable"', async () => {
      const f = await connected();
      expect(await f.io.readFileFromBytesMeasured(sess('db-nope.bin'), 0, 4)).toEqual({ ok: false, reason: 'absent' });
      expect(await f.io.readFileFromBytesMeasured(path.join(fixture!.home, '.cc-clips'), 0, 4))
        .toEqual({ ok: false, reason: 'unreadable' });
      const file = sess('db-through.txt');
      writeFileSync(file, 'x');
      expect(await f.io.readFileFromBytesMeasured(path.join(file, 'child'), 0, 4))
        .toEqual({ ok: false, reason: 'unreadable' });
    });

    it('readFileFromBytesMeasured: a path outside every whitelist is "unreadable", NEVER "absent" — even when it does not exist', async () => {
      const f = await connected();
      const outside = path.join(fixture!.projectsRoot, '..', 'db-definitely-outside.bin');
      expect(await f.io.readFileFromBytesMeasured(outside, 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('readFileFromBytesMeasured: a disconnected agent is "unreadable"', async () => {
      const f = await connected();
      const file = sess('db-gone.txt');
      writeFileSync(file, 'hello');
      await agent!.close();
      agent = undefined;   // already closed — afterEach shouldn't double-close
      expect(await f.io.readFileFromBytesMeasured(file, 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('an old caller\'s decoded read over the same wire is UNCHANGED — decoded text, the real size, no byte fields', async () => {
      const f = await connected();
      const file = sess('db-old-caller.txt');
      writeFileSync(file, 'a€b');   // 61 e2 82 ac 62
      expect(await f.io.readFileFromMeasured(file, 1)).toEqual({ ok: true, data: '€b', size: 5 });
      expect(await f.io.readFileFrom(file, 1)).toEqual({ data: '€b', size: 5 });
    });
  });
});

// ── delegation wave 3, Task 4 — the reader's decisions, one response at a time ──
describe('remote FleetIO — readdirMeasured and readFileFromBytesMeasured against a stub FleetClient (no real agent)', () => {
  const clientAnswering = (res: unknown): FleetClient =>
    ({ request: async () => res }) as unknown as FleetClient;
  const rejectingClient = (err: unknown): FleetClient =>
    ({ request: async () => { throw err; } }) as unknown as FleetClient;
  /** A stub that remembers every request, with the deadline and signal it was given. */
  const recordingClient = (res: unknown) => {
    const seen: Array<{ req: Record<string, unknown>; timeoutMs: number | undefined; signal: AbortSignal | undefined }> = [];
    const client = ({
      request: async (req: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal) => {
        seen.push({ req, timeoutMs, signal });
        return res;
      },
    }) as unknown as FleetClient;
    return { client, seen };
  };
  const UNREADABLE = { ok: false, reason: 'unreadable' } as const;
  const ABSENT = { ok: false, reason: 'absent' } as const;
  const REFUSALS: ReadonlyArray<readonly [string, unknown]> = [
    ['a whitelist refusal', new Error('forbidden')],
    ['a disconnect', new Error('disconnected')],
    ['a timeout', new Error('timeout')],
    ['an agent too old for the request', new Error('bad-request')],
    ['a rejection that is not an Error', 'boom'],
  ];

  describe('readdirMeasured', () => {
    it.each([
      ['an array is success', { names: ['a', 'b'] }, { ok: true, entries: ['a', 'b'] }],
      ['an EMPTY array is success, not a failure', { names: [] }, { ok: true, entries: [] }],
      ['names:null WITH absent:true is "absent"', { names: null, absent: true }, ABSENT],
      ['an OLDER AGENT — {names:null} with no marker — is "unreadable", NEVER "absent"', { names: null }, UNREADABLE],
      ['a response with no names at all is "unreadable"', {}, UNREADABLE],
      ['absent:true with no names key is malformed, so "unreadable"', { absent: true }, UNREADABLE],
      ['the marker must be exactly true: the string is "unreadable"', { names: null, absent: 'true' }, UNREADABLE],
      ['the marker must be exactly true: false is "unreadable"', { names: null, absent: false }, UNREADABLE],
      ['names that is a string is malformed', { names: 'abc' }, UNREADABLE],
      ['names that is an object is malformed', { names: {} }, UNREADABLE],
      ['an entry that is not a string is malformed', { names: ['a', 1] }, UNREADABLE],
      ['a bare null response is malformed', null, UNREADABLE],
      ['an undefined response is malformed', undefined, UNREADABLE],
      ['a string response is malformed', 'ok', UNREADABLE],
      ['an array beats a contradictory marker — positive evidence wins', { names: ['a'], absent: true }, { ok: true, entries: ['a'] }],
    ])('%s', async (_label, response, expected) => {
      expect(await createIo(clientAnswering(response)).readdirMeasured('/whatever/dir')).toEqual(expected);
    });

    it.each(REFUSALS)('%s reads as "unreadable", NEVER "absent"', async (_label, err) => {
      expect(await createIo(rejectingClient(err)).readdirMeasured('/whatever/dir')).toEqual(UNREADABLE);
    });

    it('sends the EXISTING readdir request — no new op — and forwards the consumer\'s deadline and signal', async () => {
      const { client, seen } = recordingClient({ names: ['one'] });
      const controller = new AbortController();
      expect(await createIo(client).readdirMeasured('/whatever/dir', 750, controller.signal))
        .toEqual({ ok: true, entries: ['one'] });
      expect(seen).toEqual([{ req: { t: 'req', op: 'readdir', path: '/whatever/dir' }, timeoutMs: 750, signal: controller.signal }]);
    });

    it.each([
      ['a listing', { names: ['a', 'b'] }, ['a', 'b']],
      ['an EMPTY listing stays [] — it is not collapsed to null', { names: [] }, []],
      ['"absent" collapses to null', { names: null, absent: true }, null],
      ['"unreadable" collapses to null', { names: null }, null],
      ['a malformed answer collapses to null', { names: 7 }, null],
    ])('readdir keeps its compatibility collapse: %s', async (_label, response, expected) => {
      expect(await createIo(clientAnswering(response)).readdir('/whatever/dir')).toEqual(expected);
    });

    it.each(REFUSALS)('readdir keeps its collapse on %s: null', async (_label, err) => {
      expect(await createIo(rejectingClient(err)).readdir('/whatever/dir')).toBeNull();
    });

    it('readdir DERIVES from readdirMeasured rather than re-reading the wire', async () => {
      const io = createIo(rejectingClient(new Error('the wire must not be touched')));
      io.readdirMeasured = async () => ({ ok: true, entries: ['from-the-measured-read'] });
      expect(await io.readdir('/whatever/dir')).toEqual(['from-the-measured-read']);
    });

    it('readdir still forwards the consumer\'s deadline and signal (it passes them to the measured read)', async () => {
      const { client, seen } = recordingClient({ names: [] });
      const controller = new AbortController();
      await createIo(client).readdir('/whatever/dir', 321, controller.signal);
      expect(seen.map((s) => [s.timeoutMs, s.signal])).toEqual([[321, controller.signal]]);
    });
  });

  describe('readFileFromBytesMeasured', () => {
    const b64 = (b: Buffer | readonly number[]): string => Buffer.from(b).toString('base64');
    const u8 = (b: Buffer | readonly number[]): Uint8Array => new Uint8Array(b);
    /** A well-formed byte-range answer. `data` is the old decoded field, present exactly as a real agent sends it. */
    const answer = (bytes: Buffer | readonly number[], size: number) =>
      ({ data: Buffer.from(bytes).toString('utf8'), dataB64: b64(bytes), size });
    const read = (res: unknown, offset: number, maxBytes: number) =>
      createIo(clientAnswering(res)).readFileFromBytesMeasured('/whatever/spool.bucket', offset, maxBytes);
    const ten = Buffer.from('abcdefghij');

    describe('a well-formed answer is the bytes of dataB64, byte for byte', () => {
      it.each([
        // [label, offset, maxBytes, the bytes the agent read, the file's size]
        ['start of the file', 0, 4, ten.subarray(0, 4), 10],
        ['middle of the file', 4, 3, ten.subarray(4, 7), 10],
        ['the last bytes: shorter than maxBytes', 8, 262144, ten.subarray(8, 10), 10],
        ['maxBytes 1', 0, 1, ten.subarray(0, 1), 10],
        ['maxBytes 1 at the last byte', 9, 1, ten.subarray(9, 10), 10],
        ['maxBytes 262144 against a larger file: exactly 262144 bytes', 0, 262144, Buffer.alloc(262144, 0x61), 300000],
        ['maxBytes 262144 against a smaller file: the whole file', 0, 262144, ten, 10],
        ['exactly at EOF — a POSITIVE empty answer (size - offset = 0)', 10, 5, Buffer.alloc(0), 10],
        ['an empty file at offset 0', 0, 5, Buffer.alloc(0), 0],
      ])('%s', async (_label, offset, maxBytes, bytes, size) => {
        expect(await read(answer(bytes, size), offset, maxBytes)).toEqual({ ok: true, bytes: u8(bytes), size });
      });

      it('a multibyte character split by the bound: dataB64 is the raw byte, whatever lossy text `data` carries', async () => {
        const half = Buffer.from([0xe2]);   // the first byte of a three-byte character
        expect(await read({ data: '�', dataB64: b64(half), size: 3 }, 0, 1)).toEqual({ ok: true, bytes: u8(half), size: 3 });
      });

      it('bytes that are not UTF-8 survive: the reader returns them exactly', async () => {
        const raw = Buffer.from([0xff, 0xfe, 0x00, 0x80]);
        expect(await read(answer(raw, 4), 0, 4)).toEqual({ ok: true, bytes: u8(raw), size: 4 });
      });

      it('`data` is IGNORED when dataB64 is present — the bytes come from dataB64 alone', async () => {
        expect(await read({ data: 'WRONG-TEXT', dataB64: b64(Buffer.from('abc')), size: 3 }, 0, 3))
          .toEqual({ ok: true, bytes: u8(Buffer.from('abc')), size: 3 });
      });

      it('returns a plain Uint8Array of exactly the answered bytes (no pooled-Buffer view leaks out)', async () => {
        const r = await read(answer(ten.subarray(2, 5), 10), 2, 3);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(Buffer.isBuffer(r.bytes)).toBe(false);
        expect(r.bytes.buffer.byteLength).toBe(3);
        expect(r.bytes.byteOffset).toBe(0);
      });
    });

    describe('an OLD PEER — `data` only, no dataB64 — is "unreadable"; bytes are NEVER reconstructed from decoded text', () => {
      it.each([
        ['a decoded answer whose text would re-encode to exactly the expected length', { data: 'abcd', size: 10 }, 0, 4],
        ['a decoded answer at EOF (empty text, right size)', { data: '', size: 10 }, 10, 5],
        ['a decoded answer with no size either', { data: 'abcd' }, 0, 4],
        ['a decoded answer where dataB64 is null', { data: 'abcd', dataB64: null, size: 10 }, 0, 4],
        ['a decoded answer where dataB64 is undefined', { data: 'abcd', dataB64: undefined, size: 10 }, 0, 4],
      ])('%s', async (_label, response, offset, maxBytes) => {
        expect(await read(response, offset, maxBytes)).toEqual(UNREADABLE);
      });
    });

    describe('base64 must be CANONICAL — anything else is "unreadable", whatever Node would make of it', () => {
      it.each([
        ['not base64 at all', 'not base64!'],
        ['missing padding', 'YWJj' + 'ZA'],
        ['short padding', 'YWJjZA='],
        ['over-long padding', 'YWJjZA==='],
        ['non-zero trailing bits (a second spelling of the same byte)', 'YR=='],
        ['leading whitespace', ' YWJj'],
        ['trailing newline', 'YWJj\n'],
        ['interior whitespace', 'YW Jj'],
        ['two padded groups glued together', 'YQ==YQ=='],
        ['URL-safe alphabet', '_-8='],
        ['a data: URI prefix', 'data:;base64,YWJj'],
      ])('%s: %j', async (_label, dataB64) => {
        // Node's decoder is lenient about every one of these; the reader must not be.
        // `size` and `maxBytes` are set so the LENIENT decode has exactly the
        // owed length: nothing but the canonical check can refuse the answer.
        const lenient = Buffer.from(dataB64, 'base64').length;
        expect(await read({ data: '', dataB64, size: lenient }, 0, Math.max(1, lenient))).toEqual(UNREADABLE);
      });

      it('control: the canonical spelling of the same bytes IS accepted', async () => {
        expect(await read({ data: 'abc', dataB64: 'YWJj', size: 3 }, 0, 3))
          .toEqual({ ok: true, bytes: u8(Buffer.from('abc')), size: 3 });
        expect(await read({ data: 'a', dataB64: 'YQ==', size: 1 }, 0, 1))
          .toEqual({ ok: true, bytes: u8(Buffer.from('a')), size: 1 });
      });

      it.each([
        ['a number', 7], ['an array', ['YWJj']], ['an object', {}], ['null', null], ['true', true],
      ])('a dataB64 that is %s is "unreadable"', async (_label, dataB64) => {
        expect(await read({ data: 'abc', dataB64, size: 3 }, 0, 3)).toEqual(UNREADABLE);
      });
    });

    describe('the decoded length must EQUAL min(maxBytes, size - offset)', () => {
      it.each([
        ['one byte too many', answer(Buffer.from('abcde'), 10), 0, 4],
        ['one byte too few', answer(Buffer.from('abc'), 10), 0, 4],
        ['empty when bytes were owed', answer(Buffer.alloc(0), 10), 0, 4],
        ['bytes when EOF was owed (size - offset = 0)', answer(Buffer.from('a'), 10), 10, 4],
        ['maxBytes bytes when the file only holds fewer (size - offset < maxBytes)', answer(Buffer.from('abcd'), 3), 0, 4],
        ['more than the remaining bytes at a mid-file offset', answer(Buffer.from('abc'), 10), 8, 4],
        ['past the bound even though it fits the file', answer(Buffer.from('abcdef'), 10), 0, 4],
      ])('%s', async (_label, response, offset, maxBytes) => {
        expect(await read(response, offset, maxBytes)).toEqual(UNREADABLE);
      });
    });

    describe('size must be a non-negative safe integer that has not regressed below the offset', () => {
      it.each([
        ['missing', undefined], ['a string', '10'], ['null', null], ['negative', -1], ['fractional', 3.5],
        ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['beyond the safe integers', 2 ** 53],
      ])('a size that is %s is "unreadable" — it is never rebuilt from the bytes', async (_label, size) => {
        expect(await read({ data: 'abc', dataB64: 'YWJj', size }, 0, 3)).toEqual(UNREADABLE);
      });

      it.each([
        ['one byte below the offset', 9, 10],
        ['far below the offset (the file was replaced by a short one)', 0, 10],
      ])('a size %s is a regression: "unreadable", even though an empty read looks plausible', async (_label, size, offset) => {
        expect(await read({ data: '', dataB64: '', size }, offset, 4)).toEqual(UNREADABLE);
      });
    });

    describe('failures', () => {
      it('data:null WITH absent:true is "absent"', async () => {
        expect(await read({ data: null, absent: true }, 0, 4)).toEqual(ABSENT);
      });

      it('an OLDER AGENT — {data:null} with no marker — is "unreadable", NEVER "absent"', async () => {
        expect(await read({ data: null }, 0, 4)).toEqual(UNREADABLE);
      });

      it.each([
        ['an empty object', {}], ['null', null], ['undefined', undefined], ['a string', 'bytes'], ['absent without data', { absent: true }],
        ['absent as the string', { data: null, absent: 'true' }],
      ])('a response that is %s is "unreadable"', async (_label, response) => {
        expect(await read(response, 0, 4)).toEqual(UNREADABLE);
      });

      it.each(REFUSALS)('%s reads as "unreadable", NEVER "absent"', async (_label, err) => {
        expect(await createIo(rejectingClient(err)).readFileFromBytesMeasured('/whatever/spool.bucket', 0, 4))
          .toEqual(UNREADABLE);
      });
    });

    describe('arguments are checked BEFORE the wire is used', () => {
      it.each([
        ['a negative offset', -1, 4], ['a fractional offset', 1.5, 4], ['a NaN offset', Number.NaN, 4],
        ['an offset beyond the safe integers', 2 ** 53, 4],
        ['maxBytes 0', 0, 0], ['a negative maxBytes', 0, -1], ['a fractional maxBytes', 0, 1.5], ['a NaN maxBytes', 0, Number.NaN],
        ['maxBytes one past the largest bound', 0, 262145],
      ])('%s: "unreadable", and no request is sent', async (_label, offset, maxBytes) => {
        const { client, seen } = recordingClient(answer(ten, 10));
        expect(await createIo(client).readFileFromBytesMeasured('/whatever/spool.bucket', offset, maxBytes))
          .toEqual(UNREADABLE);
        expect(seen).toEqual([]);
      });

      it('the bounds themselves (1 and 262144) are accepted', async () => {
        expect((await read(answer(ten.subarray(0, 1), 10), 0, 1)).ok).toBe(true);
        expect((await read(answer(Buffer.alloc(262144), 262144), 0, 262144)).ok).toBe(true);
      });
    });

    it('sends the EXISTING readFrom request with maxBytes — no new op — and forwards the consumer\'s deadline and signal', async () => {
      const { client, seen } = recordingClient(answer(ten.subarray(4, 7), 10));
      const controller = new AbortController();
      expect(await createIo(client).readFileFromBytesMeasured('/whatever/spool.bucket', 4, 3, 900, controller.signal))
        .toEqual({ ok: true, bytes: u8(ten.subarray(4, 7)), size: 10 });
      expect(seen).toEqual([{
        req: { t: 'req', op: 'readFrom', path: '/whatever/spool.bucket', offset: 4, maxBytes: 3 },
        timeoutMs: 900, signal: controller.signal,
      }]);
    });

    it('an old caller of the decoded read sends NO maxBytes and keeps the decoded-string arm', async () => {
      const { client, seen } = recordingClient({ data: 'efghij', size: 10 });
      expect(await createIo(client).readFileFromMeasured('/whatever/spool.bucket', 4)).toEqual({ ok: true, data: 'efghij', size: 10 });
      expect(await createIo(client).readFileFrom('/whatever/spool.bucket', 4)).toEqual({ data: 'efghij', size: 10 });
      expect(seen.map((s) => s.req)).toEqual([
        { t: 'req', op: 'readFrom', path: '/whatever/spool.bucket', offset: 4 },
        { t: 'req', op: 'readFrom', path: '/whatever/spool.bucket', offset: 4 },
      ]);
      expect(seen.every((s) => !('maxBytes' in s.req))).toBe(true);
    });

    it('the decoded read does NOT upgrade a dataB64-only answer: an old caller\'s reader is untouched', async () => {
      // The decoded reader keeps reading `data`; a response with bytes but no
      // text is not an answer to the question it asks.
      expect(await createIo(clientAnswering({ dataB64: 'YWJj', size: 3 })).readFileFromMeasured('/p', 0))
        .toEqual({ ok: false, reason: 'unreadable' });
    });
  });
});

// ── delegation wave 3, Task 4 — the SAME two reads, local ───────────────────────
describe('localIO — readdirMeasured and readFileFromBytesMeasured', () => {
  const SPOOL_MAX = 262144;
  const UNREADABLE = { ok: false, reason: 'unreadable' } as const;
  const ABSENT = { ok: false, reason: 'absent' } as const;
  const u8 = (b: Buffer | readonly number[]): Uint8Array => new Uint8Array(b);
  const pattern = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));
  const dirOf = (): string => mkTmp('ccrc-local-io-');

  describe('readdirMeasured', () => {
    it('a readable EMPTY directory is a POSITIVE answer: {ok:true, entries:[]}', async () => {
      expect(await localIO.readdirMeasured(dirOf())).toEqual({ ok: true, entries: [] });
    });

    it('lists entries', async () => {
      const dir = dirOf();
      writeFileSync(path.join(dir, 'a.txt'), 'x');
      mkdirSync(path.join(dir, 'sub'));
      const r = await localIO.readdirMeasured(dir);
      expect(r.ok && [...r.entries].sort()).toEqual(['a.txt', 'sub']);
    });

    it('a missing directory (ENOENT) is "absent"', async () => {
      expect(await localIO.readdirMeasured(path.join(dirOf(), 'nope'))).toEqual(ABSENT);
    });

    it('a FILE (ENOTDIR) and a path THROUGH a file are "unreadable", never "absent"', async () => {
      const dir = dirOf();
      const file = path.join(dir, 'f');
      writeFileSync(file, 'x');
      expect(await localIO.readdirMeasured(file)).toEqual(UNREADABLE);
      expect(await localIO.readdirMeasured(path.join(file, 'child'))).toEqual(UNREADABLE);
    });

    it('readdir DERIVES from it and keeps its collapse: a list ([] included), null for absent and for unreadable', async () => {
      const dir = dirOf();
      expect(await localIO.readdir(dir)).toEqual([]);
      writeFileSync(path.join(dir, 'one'), '1');
      expect(await localIO.readdir(dir)).toEqual(['one']);
      expect(await localIO.readdir(path.join(dir, 'nope'))).toBeNull();
      expect(await localIO.readdir(path.join(dir, 'one'))).toBeNull();
    });

    it('readdir derives from readdirMeasured (a spread double that overrides the measured read steers the compatibility read)', async () => {
      const double: FleetIO = { ...localIO, readdirMeasured: async () => ({ ok: true, entries: ['steered'] }) };
      expect(await double.readdir('/whatever')).toEqual(['steered']);
    });
  });

  describe('readFileFromBytesMeasured', () => {
    const fileWith = (content: Buffer | string): string => {
      const file = path.join(dirOf(), 'bucket.spool');
      writeFileSync(file, content);
      return file;
    };

    it.each([
      // [label, offset, maxBytes, expected bytes]
      ['start, 1 byte', 0, 1, 'a'],
      ['start, 4 bytes', 0, 4, 'abcd'],
      ['middle, 3 bytes', 4, 3, 'efg'],
      ['last byte', 9, 1, 'j'],
      ['the remainder is shorter than maxBytes', 8, SPOOL_MAX, 'ij'],
      ['the whole file under the largest bound', 0, SPOOL_MAX, 'abcdefghij'],
      ['exactly at EOF — a POSITIVE empty answer', 10, 5, ''],
    ] as const)('%s', async (_label, offset, maxBytes, expected) => {
      expect(await localIO.readFileFromBytesMeasured(fileWith('abcdefghij'), offset, maxBytes))
        .toEqual({ ok: true, bytes: u8(Buffer.from(expected)), size: 10 });
    });

    it('an empty file at offset 0 is a positive empty answer', async () => {
      expect(await localIO.readFileFromBytesMeasured(fileWith(''), 0, 4)).toEqual({ ok: true, bytes: u8([]), size: 0 });
    });

    it('an offset PAST the size (the cursor outran a shrunk file) is "unreadable" — a size regression, the same answer the remote reader gives', async () => {
      expect(await localIO.readFileFromBytesMeasured(fileWith('abcdefghij'), 11, 4)).toEqual(UNREADABLE);
    });

    it('the largest bound (262144) returns exactly that many bytes of a larger file, byte-exact, at an offset', async () => {
      const bytes = pattern(SPOOL_MAX + 10);
      expect(await localIO.readFileFromBytesMeasured(fileWith(bytes), 10, SPOOL_MAX))
        .toEqual({ ok: true, bytes: u8(bytes.subarray(10, 10 + SPOOL_MAX)), size: SPOOL_MAX + 10 });
    });

    it('a bound of 1 returns one byte of a larger file, never more', async () => {
      const bytes = pattern(SPOOL_MAX + 10);
      expect(await localIO.readFileFromBytesMeasured(fileWith(bytes), 7, 1))
        .toEqual({ ok: true, bytes: u8(bytes.subarray(7, 8)), size: SPOOL_MAX + 10 });
    });

    it('a multibyte character split by the bound comes back as raw bytes and rejoins through them alone', async () => {
      const file = fileWith('€');   // e2 82 ac
      const first = await localIO.readFileFromBytesMeasured(file, 0, 1);
      const second = await localIO.readFileFromBytesMeasured(file, 1, 2);
      expect(first).toEqual({ ok: true, bytes: u8([0xe2]), size: 3 });
      expect(second).toEqual({ ok: true, bytes: u8([0x82, 0xac]), size: 3 });
      const joined = Buffer.concat([Buffer.from(first.ok ? first.bytes : []), Buffer.from(second.ok ? second.bytes : [])]);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(joined)).toBe('€');
    });

    it('bytes that are not UTF-8 come back exact', async () => {
      expect(await localIO.readFileFromBytesMeasured(fileWith(Buffer.from([0xff, 0xfe, 0x00, 0x80])), 0, 4))
        .toEqual({ ok: true, bytes: u8([0xff, 0xfe, 0x00, 0x80]), size: 4 });
    });

    it('returns a plain Uint8Array of exactly the read bytes', async () => {
      const r = await localIO.readFileFromBytesMeasured(fileWith('abcdefghij'), 2, 3);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(Buffer.isBuffer(r.bytes)).toBe(false);
      expect(r.bytes.buffer.byteLength).toBe(3);
      expect(r.bytes.byteOffset).toBe(0);
    });

    it('missing is "absent"; a DIRECTORY (stat ok, read EISDIR) and a path THROUGH a file (ENOTDIR) are "unreadable"', async () => {
      const dir = dirOf();
      expect(await localIO.readFileFromBytesMeasured(path.join(dir, 'nope'), 0, 4)).toEqual(ABSENT);
      expect(await localIO.readFileFromBytesMeasured(dir, 0, 4)).toEqual(UNREADABLE);
      const file = path.join(dir, 'f');
      writeFileSync(file, 'x');
      expect(await localIO.readFileFromBytesMeasured(path.join(file, 'child'), 0, 4)).toEqual(UNREADABLE);
    });

    it.each([
      ['a negative offset', -1, 4], ['a fractional offset', 1.5, 4], ['a NaN offset', Number.NaN, 4],
      ['an offset beyond the safe integers', 2 ** 53, 4],
      ['maxBytes 0', 0, 0], ['a negative maxBytes', 0, -1], ['a fractional maxBytes', 0, 1.5], ['a NaN maxBytes', 0, Number.NaN],
      ['maxBytes one past the largest bound', 0, SPOOL_MAX + 1],
    ])('%s is "unreadable" — and the file is never touched (a MISSING file answers "unreadable", not "absent")', async (_label, offset, maxBytes) => {
      expect(await localIO.readFileFromBytesMeasured(path.join(dirOf(), 'never-created'), offset, maxBytes)).toEqual(UNREADABLE);
    });

    it('the decoded readFileFromMeasured is UNCHANGED beside it: decoded text, the real size, no byte fields', async () => {
      const file = fileWith('a€b');   // 61 e2 82 ac 62
      expect(await localIO.readFileFromMeasured(file, 1)).toEqual({ ok: true, data: '€b', size: 5 });
      expect(await localIO.readFileFrom(file, 1)).toEqual({ data: '€b', size: 5 });
    });
  });

  // Real filesystems cannot be made to raise EACCES or EIO on demand under every
  // uid (chmod does not deny root), so the errno table injects them: the node:fs
  // call raises the named error and the adapter must fold it. ENOENT is the
  // control that proves the injection reaches the adapter at all.
  describe('every errno other than ENOENT folds to "unreadable" (injected)', () => {
    const failing = async (member: 'readdir' | 'stat', code: string | undefined): Promise<FleetIO> => {
      vi.resetModules();
      vi.doMock('node:fs/promises', async (importOriginal) => {
        const real = await importOriginal<typeof import('node:fs/promises')>();
        return {
          ...real,
          [member]: async () => { throw Object.assign(new Error(code ?? 'no errno'), code === undefined ? {} : { code }); },
        };
      });
      return (await import('../src/io.js')).localIO;
    };
    afterEach(() => {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    });

    it.each([
      ['EACCES', 'EACCES'], ['EIO', 'EIO'], ['EPERM', 'EPERM'], ['ENOTDIR', 'ENOTDIR'], ['ELOOP', 'ELOOP'],
      ['EMFILE', 'EMFILE'], ['ENAMETOOLONG', 'ENAMETOOLONG'], ['a throw with no errno code at all', undefined],
    ])('readdirMeasured: %s', async (_label, code) => {
      const io = await failing('readdir', code);
      expect(await io.readdirMeasured(os.tmpdir())).toEqual(UNREADABLE);
      expect(await io.readdir(os.tmpdir())).toBeNull();
    });

    it('readdirMeasured: ENOENT is the control — the one errno that answers "absent"', async () => {
      const io = await failing('readdir', 'ENOENT');
      expect(await io.readdirMeasured(os.tmpdir())).toEqual(ABSENT);
    });

    it.each([
      ['EACCES', 'EACCES'], ['EIO', 'EIO'], ['EPERM', 'EPERM'], ['ELOOP', 'ELOOP'], ['EMFILE', 'EMFILE'],
      ['a throw with no errno code at all', undefined],
    ])('readFileFromBytesMeasured (the stat fails): %s', async (_label, code) => {
      const io = await failing('stat', code);
      expect(await io.readFileFromBytesMeasured(path.join(os.tmpdir(), 'whatever'), 0, 4)).toEqual(UNREADABLE);
    });

    it('readFileFromBytesMeasured: ENOENT is the control — the one errno that answers "absent"', async () => {
      const io = await failing('stat', 'ENOENT');
      expect(await io.readFileFromBytesMeasured(path.join(os.tmpdir(), 'whatever'), 0, 4)).toEqual(ABSENT);
    });
  });
});

describe('remote FleetIO — readFileMeasured against a stub FleetClient (no real agent)', () => {
  // Structural stub, same idiom as `remote-runner.test.ts:133` — `FleetClient`
  // is a class with private fields, so a structural object needs the double
  // cast through `unknown`.
  const clientAnswering = (res: unknown): FleetClient =>
    ({ request: async () => res }) as unknown as FleetClient;

  const rejectingClient = (err: unknown): FleetClient =>
    ({ request: async () => { throw err; } }) as unknown as FleetClient;

  it('an OLDER AGENT — a response with no `absent` key — reads a genuinely-missing file as "unreadable", NEVER "absent"', async () => {
    // The whole point of this task: an agent that predates the `absent` wire
    // field answers plain `{data: null}` for a file that does not exist.
    // Without a marker to trust, the reader must fail SHUT to "unreadable",
    // not assume the omission means "absent".
    const io = createIo(clientAnswering({ data: null }));
    expect(await io.readFileMeasured('/whatever/missing.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering {data: null, absent: true} reads as "absent"', async () => {
    const io = createIo(clientAnswering({ data: null, absent: true }));
    expect(await io.readFileMeasured('/whatever/missing.txt')).toEqual({ ok: false, reason: 'absent' });
  });

  it('a modern agent answering {data: null} with no absent key (EACCES/EISDIR/etc) reads as "unreadable"', async () => {
    const io = createIo(clientAnswering({ data: null }));
    expect(await io.readFileMeasured('/whatever/unreadable.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a string data payload reads as {ok:true, content}', async () => {
    const io = createIo(clientAnswering({ data: 'hello' }));
    expect(await io.readFileMeasured('/whatever/file.txt')).toEqual({ ok: true, content: 'hello' });
  });

  it('a rejected request (forbidden/disconnected/timeout) reads as "unreadable"', async () => {
    const io = createIo(rejectingClient(new Error('forbidden')));
    expect(await io.readFileMeasured('/whatever/file.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('forwards consumer-owned deadlines to FleetClient', async () => {
    const seen: Array<{
      op: string;
      timeoutMs: number | undefined;
      signal: AbortSignal | undefined;
    }> = [];
    const client = ({
      request: async (req: { op: string }, timeoutMs?: number, signal?: AbortSignal) => {
        seen.push({ op: req.op, timeoutMs, signal });
        return req.op === 'readdir' ? { names: ['one'] } : { data: 'hello' };
      },
    }) as unknown as FleetClient;
    const io = createIo(client);
    const controller = new AbortController();
    expect(await io.readFileMeasured('/whatever/file.txt', 1_000, controller.signal))
      .toEqual({ ok: true, content: 'hello' });
    expect(await io.readdir('/whatever', 750, controller.signal)).toEqual(['one']);
    expect(seen).toEqual([
      { op: 'read', timeoutMs: 1_000, signal: controller.signal },
      { op: 'readdir', timeoutMs: 750, signal: controller.signal },
    ]);
  });

  it('an OLDER AGENT — {missing:true} with no `absent` key — reads as "unreadable", NEVER "absent"', async () => {
    const io = createIo(clientAnswering({ missing: true }));
    expect(await io.statMeasured('/whatever/missing.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering {missing:true, absent:true} reads as "absent"', async () => {
    const io = createIo(clientAnswering({ missing: true, absent: true }));
    expect(await io.statMeasured('/whatever/missing.txt')).toEqual({ ok: false, reason: 'absent' });
  });

  it('a rejected stat request (forbidden/disconnected/timeout) reads as "unreadable"', async () => {
    const io = createIo(rejectingClient(new Error('forbidden')));
    expect(await io.statMeasured('/whatever/file.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  /** THE OLDER-AGENT ARM FOR `lstat`, and it is a different shape from every
   *  other one on this wire. The ops above degrade by OMITTING a field, so
   *  their reader has to read silence correctly. An agent that predates this op
   *  cannot omit anything — it rejects the request outright — so the failure
   *  arrives as a rejection, and the ONE thing that must never happen is that
   *  it arrives as a kind. `regular` is the only answer a caller may condemn
   *  on, so a rejection reading as `regular` would condemn accounts on a fleet
   *  nobody asked. */
  it('an agent too old for the `lstat` op (`not-implemented`) reads as "unmeasured", NEVER a kind', async () => {
    const io = createIo(rejectingClient(new Error('not-implemented')));
    expect(await io.lstatMeasured('/whatever/marker')).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a payload in no shape this reader knows is "unmeasured" — never the nearest kind', async () => {
    const io = createIo(clientAnswering({ kind: 'file' }));       // plausible, and not our vocabulary
    expect(await io.lstatMeasured('/whatever/marker')).toEqual({ ok: false, reason: 'unmeasured' });
    const io2 = createIo(clientAnswering({ missing: true }));     // measured by nothing
    expect(await io2.lstatMeasured('/whatever/marker')).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a modern agent answering {missing:true, absent:true} reads as "absent" here too', async () => {
    const io = createIo(clientAnswering({ missing: true, absent: true }));
    expect(await io.lstatMeasured('/whatever/marker')).toEqual({ ok: false, reason: 'absent' });
  });

  it('all three kinds survive the wire unchanged', async () => {
    for (const kind of ['regular', 'symlink', 'other'] as const) {
      expect(await createIo(clientAnswering({ kind })).lstatMeasured('/p')).toEqual({ ok: true, kind });
    }
  });

  it('an OLDER AGENT — {dataB64: null} with no marker — reads as "unreadable", NEVER "absent"', async () => {
    const io = createIo(clientAnswering({ dataB64: null }));
    expect(await io.readFileB64Measured('/whatever/clip.png')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering {dataB64: null, tooLarge: true, size: N} reads as "too-large" WITH the size', async () => {
    const io = createIo(clientAnswering({ dataB64: null, tooLarge: true, size: 12582913 }));
    expect(await io.readFileB64Measured('/whatever/huge.png')).toEqual({ ok: false, reason: 'too-large', size: 12582913 });
  });

  it('a tooLarge marker with no size reports a NULL size, never a manufactured 0', async () => {
    const io = createIo(clientAnswering({ dataB64: null, tooLarge: true }));
    expect(await io.readFileB64Measured('/whatever/huge.png')).toEqual({ ok: false, reason: 'too-large', size: null });
  });

  it('an OLDER AGENT — readFrom {data: null} with no marker — reads as "unreadable"', async () => {
    const io = createIo(clientAnswering({ data: null }));
    expect(await io.readFileFromMeasured('/whatever/t.jsonl', 0)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering readFrom {data: null, absent: true} reads as "absent"', async () => {
    const io = createIo(clientAnswering({ data: null, absent: true }));
    expect(await io.readFileFromMeasured('/whatever/t.jsonl', 0)).toEqual({ ok: false, reason: 'absent' });
  });
});
