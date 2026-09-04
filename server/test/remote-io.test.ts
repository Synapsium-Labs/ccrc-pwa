import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet, FleetClient } from '../src/remote/client.js';
import { createIo } from '../src/remote/io.js';
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
