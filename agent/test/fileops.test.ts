import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';
import { MAX_READ_B64_BYTES } from '../src/fileops.js';

interface Res { ok: boolean; err?: string; [k: string]: unknown }

describe('ccrc-agent file ops', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;
  let id = 0;

  afterEach(async () => {
    client?.ws.close();
    client = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  async function open(): Promise<void> {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
  }

  const nextId = () => ++id;

  it('read returns content for whitelisted files, null for missing ones', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 'a.wrapper');
    writeFileSync(file, 'claude2');
    const res1 = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res1).toMatchObject({ ok: true, data: 'claude2' });
    const res2 = await client!.req<Res>(nextId(), { op: 'read', path: path.join(fixture!.home, '.cc-sessions', 'nope') });
    expect(res2).toMatchObject({ ok: true, data: null });
  });

  it('read marks a genuinely missing whitelisted file with absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'read', path: path.join(fixture!.home, '.cc-sessions', 'nope-absent') });
    expect(res).toMatchObject({ ok: true, data: null, absent: true });
  });

  it('read of a directory (EISDIR) answers null with no absent key — unreadable is not absent', async () => {
    await open();
    // .cc-sessions is pre-created by the fixture as a directory under a whitelist root.
    const dir = path.join(fixture!.home, '.cc-sessions');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: dir });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });

  it('read rejects a path outside every whitelist prefix', async () => {
    await open();
    const file = path.join(fixture!.outside, 'secret.txt');
    writeFileSync(file, 'nope');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res).not.toHaveProperty('absent');
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('read rejects .. traversal that would escape the whitelist', async () => {
    await open();
    const escape = path.join(fixture!.home, '.cc-sessions', '..', '..', 'etc', 'passwd');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: escape });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('read allows the .claude* glob roots (e.g. .claude-personal)', async () => {
    await open();
    const file = path.join(fixture!.home, '.claude-personal', 'settings.json');
    writeFileSync(file, '{}');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res).toMatchObject({ ok: true, data: '{}' });
  });

  it('read allows files under the fleet projects root', async () => {
    await open();
    const file = path.join(fixture!.projectsRoot, 'my-project', 'README.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# hi');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
    expect(res).toMatchObject({ ok: true, data: '# hi' });
  });

  it('readFrom reads from an offset and reports the real size', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcdefghij');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
    expect(res).toMatchObject({ ok: true, data: 'efghij', size: 10 });
  });

  it('readFrom rejects paths outside the whitelist', async () => {
    await open();
    const file = path.join(fixture!.outside, 'x.txt');
    writeFileSync(file, 'x');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 0 });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('readB64 serves a whitelisted clip as base64, and refuses outside the whitelist', async () => {
    await open();
    const bytes = Buffer.from([0x00, 0x01, 0xfe]);
    const file = path.join(fixture!.home, '.cc-clips', 'clip-x.png');
    writeFileSync(file, bytes);
    const res1 = await client!.req<Res>(nextId(), { op: 'readB64', path: file });
    expect(res1).toMatchObject({ ok: true, dataB64: bytes.toString('base64') });
    const res2 = await client!.req<Res>(nextId(), { op: 'readB64', path: path.join(fixture!.outside, 'secret.png') });
    expect(res2).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('readB64 returns null for a missing whitelisted file', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readB64',
      path: path.join(fixture!.home, '.cc-clips', 'nope.png'),
    });
    expect(res).toMatchObject({ ok: true, dataB64: null });
  });

  it('readB64 marks a genuinely missing whitelisted file absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readB64', path: path.join(fixture!.home, '.cc-clips', 'nope-absent.png'),
    });
    expect(res).toMatchObject({ ok: true, dataB64: null, absent: true });
  });

  it('readB64 of a DIRECTORY (EISDIR) answers null with no absent and no tooLarge key', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readB64', path: path.join(fixture!.home, '.cc-clips') });
    expect(res).toMatchObject({ ok: true, dataB64: null });
    expect(res).not.toHaveProperty('absent');
    expect(res).not.toHaveProperty('tooLarge');
  });

  it('readB64 REPORTS an over-cap clip as tooLarge with its measured size, never as missing', async () => {
    await open();
    // Sparse via truncate: the cap is checked against st.size BEFORE any byte
    // is read, so no 12 MB buffer is ever allocated by this test. Reachable in
    // production because `ccd clip` (ccd/ccd:13416) mv -f's an image of any
    // size into this directory with no size check, while the upload route
    // refuses one (server/src/server.ts:1803-1804).
    const file = path.join(fixture!.home, '.cc-clips', 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    const res = await client!.req<Res>(nextId(), { op: 'readB64', path: file });
    expect(res).toMatchObject({ ok: true, dataB64: null, tooLarge: true, size: MAX_READ_B64_BYTES + 1 });
    expect(res).not.toHaveProperty('absent');
  });

  it('readFrom marks a genuinely missing whitelisted file absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readFrom', path: path.join(fixture!.home, '.cc-limits', 'nope-absent.json'), offset: 0,
    });
    expect(res).toMatchObject({ ok: true, data: null, absent: true });
  });

  it('readFrom at EOF is a POSITIVE answer — empty data with the real size, and no absent key', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'eof.json');
    writeFileSync(file, 'abcd');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
    expect(res).toMatchObject({ ok: true, data: '', size: 4 });
    expect(res).not.toHaveProperty('absent');
  });

  it('readFrom of a DIRECTORY (stat ok, range read EISDIR) answers null with no absent key', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: path.join(fixture!.home, '.cc-clips'), offset: 0 });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });

  it('readdir lists entries for a whitelisted directory', async () => {
    await open();
    const dir = path.join(fixture!.home, '.cc-clips', 'sess1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'x.png'), 'x');
    const res = await client!.req<Res>(nextId(), { op: 'readdir', path: dir });
    expect(res.ok).toBe(true);
    expect(res.names).toEqual(['x.png']);
  });

  it('readdir rejects a directory outside the whitelist', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readdir', path: fixture!.outside });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('stat reports size/mtimeMs for whitelisted files, missing:true otherwise', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcd');
    const res1 = await client!.req<Res>(nextId(), { op: 'stat', path: file });
    expect(res1.ok).toBe(true);
    expect(res1.size).toBe(4);
    expect(typeof res1.mtimeMs).toBe('number');
    const res2 = await client!.req<Res>(nextId(), { op: 'stat', path: path.join(fixture!.home, '.cc-limits', 'nope') });
    expect(res2).toMatchObject({ ok: true, missing: true });
  });

  it('stat rejects a path outside the whitelist', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'stat', path: fixture!.outside });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('stat marks a genuinely missing whitelisted path with absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'stat', path: path.join(fixture!.home, '.cc-limits', 'nope-absent'),
    });
    expect(res).toMatchObject({ ok: true, missing: true, absent: true });
  });

  it('stat THROUGH a file (ENOTDIR) answers missing:true with NO absent key — unmeasured is not absent', async () => {
    await open();
    // The whole of D-114 in one case. `claude.json` is a FILE, so the kernel
    // refuses to walk THROUGH it: ENOTDIR, not ENOENT. This op USED to answer
    // a bare `{missing:true}` — byte-identical to a genuine ENOENT — and the
    // server read that as proof the path was gone. D-1396 closed it, and the
    // two assertions below are the guarantee that close is worth, not a
    // record of the defect: `missing: true` still rides the wire, keeping its
    // exact pre-existing "no {mtimeMs,size} for you" meaning so an older
    // server's reader is unaffected — and `absent`, the PROVEN-absence
    // marker, is WITHHELD. Both halves are load-bearing. Delete the
    // `not.toHaveProperty('absent')` line and you delete the only agent-side
    // pin that a non-ENOENT stat failure never wears that marker; the
    // genuine-ENOENT case two `it()`s up is its other half, asserting the
    // marker IS worn when it is earned.
    //
    // ENOTDIR rather than `chmod 000` deliberately: chmod does not deny root,
    // so a root runner would silently assert the wrong thing (D-116, still
    // open at every `chmodSync(…, 0o000)` site in
    // server/test/coord-fingerprint.test.ts — cited by the CALL rather than by
    // line because the line set this comment first named, :100/:632/:650/:701,
    // had moved by the time anyone read it back). Which is why nothing new
    // here uses chmod.
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcd');
    const res = await client!.req<Res>(nextId(), { op: 'stat', path: path.join(file, 'child') });
    expect(res).toMatchObject({ ok: true, missing: true });
    expect(res).not.toHaveProperty('absent');
  });

  it('writeB64 mkdir-ps the parent and writes decoded bytes under .cc-clips', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-clips', 'deep', 'nested', 'clip.png');
    const data = Buffer.from('89504e470d0a1a0a', 'hex');
    const res = await client!.req<Res>(nextId(), { op: 'writeB64', path: file, dataB64: data.toString('base64') });
    expect(res).toEqual({ t: 'res', id, ok: true });
    expect(readFileSync(file)).toEqual(data);
  });

  it('writeB64 rejects a write under a read-only whitelist root (.cc-sessions)', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-sessions', 'evil.wrapper');
    const res = await client!.req<Res>(nextId(), { op: 'writeB64', path: file, dataB64: Buffer.from('x').toString('base64') });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('writeB64 rejects a write outside the whitelist entirely', async () => {
    await open();
    const file = path.join(fixture!.outside, 'evil.txt');
    const res = await client!.req<Res>(nextId(), { op: 'writeB64', path: file, dataB64: Buffer.from('x').toString('base64') });
    expect(res).toMatchObject({ ok: false, err: 'forbidden' });
  });

  it('writeB64 replies with a failure response (not a crash) when mkdir hits a real fs error', async () => {
    await open();
    // Force ENOTDIR: `blocker` is a regular file, so mkdir-ing a directory
    // "under" it (a path-collision) fails at the fs layer, not the whitelist.
    const blocker = path.join(fixture!.home, '.cc-clips', 'blocker-file');
    writeFileSync(blocker, 'not a directory');
    const file = path.join(blocker, 'nested', 'clip.png');
    const res = await client!.req<Res>(nextId(), {
      op: 'writeB64',
      path: file,
      dataB64: Buffer.from('x').toString('base64'),
    });
    expect(res.ok).toBe(false);
    expect(typeof res.err).toBe('string');
    // The connection must still be alive afterwards — a crashed/dead agent
    // process would never answer this follow-up request.
    const other = path.join(fixture!.home, '.cc-clips', 'still-alive.txt');
    const res2 = await client!.req<Res>(nextId(), {
      op: 'writeB64',
      path: other,
      dataB64: Buffer.from('ok').toString('base64'),
    });
    expect(res2).toMatchObject({ ok: true });
  });
});
