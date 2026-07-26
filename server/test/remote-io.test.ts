import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';

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
});
