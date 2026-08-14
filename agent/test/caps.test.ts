import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface CapsRes { ok: boolean; verbs?: string[]; err?: string }

/** Writes the ccd the agent will actually exec: `resolveSpawnCmd` resolves
 *  `ccd` against `home`, never PATH, so a stub here is the whole fake. */
function writeCcd(home: string, body: string): void {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

describe('caps op', () => {
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

  it('answers with the verbs ccd currently prints, not the ones it printed at boot', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start\necho stop');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop'] });

    // A new ccd lands under the running agent — the case the outage was.
    writeCcd(fixture.home, 'echo start\necho stop\necho ws-rename');
    expect(await client.req<CapsRes>(2, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop', 'ws-rename'] });
  });

  // Fix round 2 (task 14 follow-up, item 1): proof that the AGENT-SIDE reader
  // needs no code change to carry `ccd`'s new `stop-surface` capability
  // token. This test changes nothing in `src/` — it exists to show the
  // EXISTING `readCcdVerbs` regex (`/^[a-z][a-z-]*$/`) already accepts a
  // verb-SHAPED capability token and passes it through the real WS `caps` op
  // unmodified, exactly like any other line `cmd_caps` prints. That is the
  // whole point of choosing this shape: zero new agent-side parsing, zero
  // new wire field, zero new FleetState property — reusing plumbing that is
  // already proven rather than building a parallel one.
  it('carries a verb-shaped capability token (stop-surface) through unmodified — no new parsing needed', async () => {
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start\necho stop\necho stop-surface');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' }))
      .toMatchObject({ ok: true, verbs: ['start', 'stop', 'stop-surface'] });
  });

  it('a caps read that fails after a working list retains that list, not []', async () => {
    // Review finding 1 (final whole-branch review): a failed exec used to be
    // written back as a confirmed `[]`, which then read as "unchanged" on
    // every later stat and pinned the outage this feature exists to remove.
    // The fix leaves `cache.verbs` exactly as it was on a failed read — a
    // previously-good list survives a transient failure instead of being
    // cleared by it.
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: ['start'] });

    writeCcd(fixture.home, 'exit 1');
    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: ['start'] });
  });

  it('a failed read with ccd untouched between calls is retried, not pinned to [] (review finding 1)', async () => {
    // Isolates the actual bug: a failed exec must NOT write back the stat.
    // If it did, the second call's stat would match the (poisoned) cache and
    // hit it, never re-execing — served as [] forever until the agent
    // restarts or ccd is rewritten. The marker-file exec count is the only
    // way to observe "re-exec happened" when the ccd file itself never
    // changes between the two calls.
    fixture = makeFixture();
    const marker = path.join(fixture.home, 'execs');
    writeCcd(fixture.home, `echo x >> ${marker}\nexit 1`);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: [] });
    const after1 = readFileSync(marker, 'utf8').length;

    // ccd is NOT rewritten between calls — same mtime, same size. Only
    // whether a failed read retries on the next call (rather than pinning
    // the failure via a written-back stat) is under test.
    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: [] });
    expect(readFileSync(marker, 'utf8').length).toBeGreaterThan(after1);
  });

  it('ccd missing at stat time after a good read retains the cached list (review finding 2)', async () => {
    // `deploy.sh` moves ccd aside mid-install — a stat miss here must be a
    // no-op, not a clearing event: the old bug re-exec'd (ENOENT -> code 1 ->
    // []) the moment the stat stopped matching, wiping a working list for the
    // whole deploy window.
    fixture = makeFixture();
    writeCcd(fixture.home, 'echo start\necho stop');
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: ['start', 'stop'] });

    rmSync(path.join(fixture.home, '.local', 'bin', 'ccd'));
    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: ['start', 'stop'] });
  });

  it('an unchanged ccd is not re-execed', async () => {
    fixture = makeFixture();
    // Appends a line per invocation, so the file's length counts execs.
    const marker = path.join(fixture.home, 'execs');
    writeCcd(fixture.home, `echo x >> ${marker}\necho start`);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    await client.req<CapsRes>(1, { op: 'caps' });
    const after1 = readFileSync(marker, 'utf8').length;
    await client.req<CapsRes>(2, { op: 'caps' });
    expect(readFileSync(marker, 'utf8').length).toBe(after1);
  });

  // The gate is `mtimeMs === cache.mtimeMs && size === cache.size` — a cache
  // hit requires BOTH to match. The two tests below force one to match while
  // the other genuinely changes, isolating each half: neither alone may be
  // enough to justify serving the cache. Real writes always move mtime AND
  // size together, so `utimesSync` with an explicit, whole-second timestamp
  // is used to decouple them deterministically (an OS-assigned mtime can
  // carry sub-millisecond precision `Date` truncates, so re-deriving one from
  // a stat and feeding it back in isn't safe — reusing the SAME literal
  // `Date` input twice is, since the filesystem write is byte-for-byte
  // deterministic for identical input).

  it('a same-size rewrite with a different mtime is re-execed (isolates the mtime half of the stat gate)', async () => {
    fixture = makeFixture();
    const marker = path.join(fixture.home, 'execs');
    const ccdPath = path.join(fixture.home, '.local', 'bin', 'ccd');
    // 'start' and 'begin' are both 5 letters, so these two bodies are
    // byte-identical in length — only the forced mtime differs between reads.
    writeCcd(fixture.home, `echo x >> ${marker}\necho start`);
    const t1 = new Date('2024-01-01T00:00:00.000Z');
    utimesSync(ccdPath, t1, t1);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: ['start'] });
    const after1 = readFileSync(marker, 'utf8').length;
    const sizeBefore = statSync(ccdPath).size;

    writeCcd(fixture.home, `echo x >> ${marker}\necho begin`);
    expect(statSync(ccdPath).size).toBe(sizeBefore); // sanity: size really is unchanged
    const t2 = new Date('2024-01-02T00:00:00.000Z'); // a day later — mtime differs
    utimesSync(ccdPath, t2, t2);

    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: ['begin'] });
    expect(readFileSync(marker, 'utf8').length).toBeGreaterThan(after1);
  });

  it('a same-mtime rewrite with a different size is re-execed (isolates the size half of the stat gate)', async () => {
    fixture = makeFixture();
    const marker = path.join(fixture.home, 'execs');
    const ccdPath = path.join(fixture.home, '.local', 'bin', 'ccd');
    writeCcd(fixture.home, `echo x >> ${marker}\necho start`);
    const t1 = new Date('2024-01-01T00:00:00.000Z');
    utimesSync(ccdPath, t1, t1);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();

    expect(await client.req<CapsRes>(1, { op: 'caps' })).toMatchObject({ verbs: ['start'] });
    const after1 = readFileSync(marker, 'utf8').length;
    const sizeBefore = statSync(ccdPath).size;

    writeCcd(fixture.home, `echo x >> ${marker}\necho start\necho stop`); // longer body
    expect(statSync(ccdPath).size).not.toBe(sizeBefore); // sanity: size really did change
    utimesSync(ccdPath, t1, t1); // force mtime back to the exact same instant

    expect(await client.req<CapsRes>(2, { op: 'caps' })).toMatchObject({ verbs: ['start', 'stop'] });
    expect(readFileSync(marker, 'utf8').length).toBeGreaterThan(after1);
  });
});
