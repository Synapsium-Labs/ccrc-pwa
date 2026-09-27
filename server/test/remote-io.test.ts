import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
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
