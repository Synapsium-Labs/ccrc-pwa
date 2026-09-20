// The `hostStat` op — the fleet box's own load, and the one op on this wire
// that takes no path.
//
// The load-bearing test in this file is the LAST one: `/proc` must still be
// unreachable through `read`. The whole reason this op exists rather than two
// `read` calls is that widening the read whitelist to `/proc` would hand the
// PWA every `/proc/<pid>/environ` on the box along with the CPU numbers.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostStat } from '../../shared/hoststat.js';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface HostRes { ok: boolean; stat?: HostStat; err?: string }

const STAT = [
  'cpu  1000 0 500 8000 100 0 0 0 0 0',
  'cpu0 500 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4000 50 0 0 0 0 0',
].join('\n');

const MEMINFO = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          4000000 kB',
  'SwapTotal:       2000000 kB',
  'SwapFree:        1500000 kB',
  'SReclaimable:     500000 kB',
  'Shmem:            200000 kB',
].join('\n');

/** A fixture `/proc` INSIDE the fixture home, which is exactly the point of the
 *  final test: this path is under the read whitelist's root and the op still
 *  does not take paths from callers. */
function seedProc(home: string): string {
  const root = path.join(home, 'proc');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'stat'), STAT);
  writeFileSync(path.join(root, 'meminfo'), MEMINFO);
  return root;
}

describe('hostStat op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  let client: TestClient | undefined;

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

  it('answers a reading from the box it runs on, computed there', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: seedProc(fixture.home) });
    client = new TestClient(agent.port);
    await client.hello();

    const res = await client.req<HostRes>(1, { op: 'hostStat' });
    expect(res.ok).toBe(true);
    const mem = res.stat?.mem;
    expect(mem?.ok).toBe(true);
    // The numbers the agent computed, not the file it read: nothing on this
    // wire carries raw jiffies or kB lines for the server to re-derive.
    expect(mem?.ok === true && mem.usedKb).toBe(9200000);
    expect(mem?.ok === true && mem.swapUsedKb).toBe(500000);
  });

  it('never rejects a box it cannot measure — it says WHICH condition it is', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: path.join(fixture.home, 'no-proc-here') });
    client = new TestClient(agent.port);
    await client.hello();

    const res = await client.req<HostRes>(1, { op: 'hostStat' });
    // `ok: true` with a named failure inside, not `ok: false`: a rejection would
    // leave the server unable to tell "this box has no /proc" from "the agent
    // refused", and those are different sentences on the tile.
    expect(res.ok).toBe(true);
    expect(res.stat?.cpu.ok === false && res.stat.cpu.why).toBe('absent');
    expect(res.stat?.mem.ok === false && res.stat.mem.why).toBe('absent');
  });

  it('takes no path, and an attempt to send one changes nothing', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: seedProc(fixture.home) });
    client = new TestClient(agent.port);
    await client.hello();

    // `validateReq` builds the frame from the op alone, so a smuggled `path` is
    // dropped before any handler sees it.
    const res = await client.req<HostRes>(1, { op: 'hostStat', path: '/etc/shadow' });
    expect(res.ok).toBe(true);
    expect(res.stat?.mem.ok).toBe(true);
  });

  it.runIf(process.platform === 'linux')('reads the real /proc when no fixture root is configured', async () => {
    fixture = makeFixture();
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    const res = await client.req<HostRes>(1, { op: 'hostStat' });
    const cpu = res.stat?.cpu;
    expect(cpu?.ok).toBe(true);
    expect(cpu?.ok === true && cpu.perCpu.length).toBeGreaterThan(0);
    expect(res.stat?.mem.ok).toBe(true);
  });

  it('did NOT widen the read whitelist: /proc is still unreachable through `read`', async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { procRoot: seedProc(fixture.home) });
    client = new TestClient(agent.port);
    await client.hello();

    // Both the real one and the fixture one. The fixture copy lives under the
    // whitelist ROOT ($HOME) and is still refused, because the whitelist names
    // subdirectories, not the home itself — so this also pins that `procRoot`
    // is not a back door into it.
    for (const p of ['/proc/stat', '/proc/meminfo', path.join(fixture.home, 'proc', 'stat')]) {
      expect(await client.req<{ ok: boolean; err?: string }>(2, { op: 'read', path: p }))
        .toMatchObject({ ok: false, err: 'forbidden' });
    }
  });
});
