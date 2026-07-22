import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

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

  it('read rejects a path outside every whitelist prefix', async () => {
    await open();
    const file = path.join(fixture!.outside, 'secret.txt');
    writeFileSync(file, 'nope');
    const res = await client!.req<Res>(nextId(), { op: 'read', path: file });
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
