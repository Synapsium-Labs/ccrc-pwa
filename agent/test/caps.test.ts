import { describe, it, expect, afterEach } from 'vitest';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

interface CapsRes { ok: boolean; verbs?: string[]; err?: string }

/** The ENTRY half of the installed pair: `$HOME/.local/bin/ccd`, the one the
 *  agent execs (`resolveSpawnCmd` resolves `ccd` against `home`, never PATH). */
function entryPath(home: string): string {
  return path.join(home, '.local', 'bin', 'ccd');
}

/** The BODY half: `$HOME/.local/libexec/ccrc/ccd`, which the launcher hands
 *  control to. The agent never execs or reads it — it stats it, locally, only
 *  to know whether `ccd caps` could now answer differently. */
function bodyPath(home: string): string {
  return path.join(home, '.local', 'libexec', 'ccrc', 'ccd');
}

/** Writes the body half. */
function writeBody(home: string, body: string): void {
  mkdirSync(path.dirname(bodyPath(home)), { recursive: true });
  writeFileSync(bodyPath(home), `#!/bin/sh\n${body}\n`);
  chmodSync(bodyPath(home), 0o755);
}

/** Writes the ccd the agent will actually exec, as a SELF-CONTAINED entry — the
 *  pre-launcher shape, which is what the single-file cases below exercise. A
 *  cache hit now needs a measurable body too, so a placeholder body is seeded
 *  once if none exists; it is never exec'd by these cases and never changed by
 *  them, so the only half they move is the entry. */
function writeCcd(home: string, body: string): void {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = entryPath(home);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  if (!existsSync(bodyPath(home))) writeBody(home, 'exit 70');
}

/** A launcher stub that behaves like the real one in the only way the cache
 *  cares about: it counts its own execs, then hands over to the body — so a
 *  change to the body's verbs changes what `caps` prints while the launcher's
 *  own bytes stay exactly as they were. `lines` run before the hand-over. The
 *  marker lives HERE, not in the body, so an exec is counted even when the body
 *  is missing or broken. */
function writeLauncher(home: string, marker: string, lines: string[] = []): void {
  writeCcd(home, [`echo x >> ${marker}`, ...lines, `exec /bin/sh '${bodyPath(home)}' "$@"`].join('\n'));
}

/** Whole-second timestamps, so a pair's mtimes are pinned and "unchanged" is
 *  exact (an OS-assigned mtime carries sub-millisecond precision a `Date`
 *  would truncate). */
const T0 = new Date('2024-01-01T00:00:00.000Z');
const T1 = new Date('2024-01-02T00:00:00.000Z');
function pin(p: string, t: Date): void {
  utimesSync(p, t, t);
}

/** `(mtimeMs, size)` — the key the cache is made of. */
function stamp(p: string): { mtimeMs: number; size: number } {
  const s = statSync(p);
  return { mtimeMs: s.mtimeMs, size: s.size };
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
  // EXISTING `readCcdVerbs` regex (`/^[a-z][a-z0-9-]*$/`) already accepts a
  // NOTE: this proves the claim for `stop-surface` ONLY, and the claim was
  // over-generalised once already — `lifecycle-v1`/`actor-flags-v1` were
  // dropped by this filter for weeks because it had no digit class and no
  // test crossed a digit-bearing token through it. `server/test/
  // caps-token-shape.test.ts` covers the whole advertised set; this case
  // stays as the agent-side end-to-end proof, not as the general argument.
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

  // The gate is `(mtimeMs, size)` of the entry AND of the body, and a cache hit
  // requires all four to match. The two tests below force one of the ENTRY's two
  // numbers to match while the other genuinely changes, isolating each half of
  // the entry's stat: neither alone may be enough to justify serving the cache.
  // The body is untouched in them — the same two controls for the BODY half sit
  // at the end of this file. Real writes always move mtime AND size together, so
  // `utimesSync` with an explicit, whole-second timestamp is used to decouple
  // them deterministically (an OS-assigned mtime can carry sub-millisecond
  // precision `Date` truncates, so re-deriving one from a stat and feeding it
  // back in isn't safe — reusing the SAME literal `Date` input twice is, since
  // the filesystem write is byte-for-byte deterministic for identical input).

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
  // ---- The entry/body PAIR -------------------------------------------------
  // `~/.local/bin/ccd` is a launcher; the Bash that prints `caps` lives in
  // `~/.local/libexec/ccrc/ccd`. A new verb is a body change, and a body change
  // must not need the launcher's stat to move for the agent to see it. Each case
  // below moves exactly ONE named thing between two caps calls and counts execs
  // through a marker the launcher appends to.

  /** Boots an agent over a launcher+body pair, both mtimes pinned to `T0`. */
  async function bootPair(bodyScript: string) {
    fixture = makeFixture();
    const home = fixture.home;
    const marker = path.join(home, 'execs');
    writeBody(home, bodyScript);
    pin(bodyPath(home), T0);
    writeLauncher(home, marker);
    pin(entryPath(home), T0);
    agent = await boot(fixture);
    client = new TestClient(agent.port);
    await client.hello();
    let id = 0;
    return {
      home,
      marker,
      /** One `caps` request; resolves to the verbs list the agent answered. */
      caps: async (): Promise<string[] | undefined> => (await client!.req<CapsRes>(++id, { op: 'caps' })).verbs,
      /** How many times the launcher ran, boot's own read included. */
      execs: (): number => readFileSync(marker, 'utf8').split('\n').length - 1,
    };
  }

  it('the first caps request after boot measures and establishes the pair, then an unchanged pair is not re-execed', async () => {
    // Boot reads `caps` once but leaves BOTH key halves unset, so the first live
    // request must exec again to measure them; only from then on is it a hit.
    const { caps, execs } = await bootPair('echo start');
    expect(execs()).toBe(1);
    expect(await caps()).toEqual(['start']);
    expect(execs()).toBe(2);
    expect(await caps()).toEqual(['start']);
    expect(await caps()).toEqual(['start']);
    expect(execs()).toBe(2);
  });

  it('a BODY-only change is re-execed and its verbs are served, with the launcher untouched', async () => {
    // The case a launcher-keyed cache gets wrong: a new verb lands in the body,
    // the launcher's bytes and stat never move, and the agent would answer the
    // old list for as long as it ran.
    const { home, caps, execs } = await bootPair('echo start');
    expect(await caps()).toEqual(['start']);
    const base = execs();
    const entryBefore = stamp(entryPath(home));

    writeBody(home, 'echo start\necho ws-reclaim');
    expect(stamp(entryPath(home))).toEqual(entryBefore); // sanity: the launcher really is untouched

    expect(await caps()).toEqual(['start', 'ws-reclaim']);
    expect(execs()).toBe(base + 1);
    expect(await caps()).toEqual(['start', 'ws-reclaim']); // and the new pair is now the key
    expect(execs()).toBe(base + 1);
  });

  it('an ENTRY-only change is re-execed and its output served, with the body untouched', async () => {
    const { home, marker, caps, execs } = await bootPair('echo start');
    expect(await caps()).toEqual(['start']);
    const base = execs();
    const bodyBefore = stamp(bodyPath(home));

    writeLauncher(home, marker, ['echo from-launcher']);
    expect(stamp(bodyPath(home))).toEqual(bodyBefore); // sanity: the body really is untouched

    expect(await caps()).toEqual(['from-launcher', 'start']);
    expect(execs()).toBe(base + 1);
  });

  it('a missing body after a good read serves the prior list without an exec, and keeps the WHOLE prior key', async () => {
    // Half a pair is "no evidence": nothing is exec'd and nothing is written
    // back — not even the half that DID stat. The entry changes while the body
    // is gone; the body then returns with its ORIGINAL bytes and stat. A cache
    // that had adopted the new entry stamp during the outage would now see a
    // pair that matches its (half-updated) key and serve the stale list; one
    // that retained the whole prior key sees the entry differ and re-execs.
    const { home, marker, caps, execs } = await bootPair('echo start');
    expect(await caps()).toEqual(['start']);
    const base = execs();

    writeLauncher(home, marker, ['echo from-launcher']);
    const bodyBytes = readFileSync(bodyPath(home));
    rmSync(bodyPath(home));

    expect(await caps()).toEqual(['start']);
    expect(execs()).toBe(base); // no exec on half a pair

    writeFileSync(bodyPath(home), bodyBytes);
    chmodSync(bodyPath(home), 0o755);
    pin(bodyPath(home), T0); // the exact stat the key holds

    expect(await caps()).toEqual(['from-launcher', 'start']);
    expect(execs()).toBe(base + 1);
  });

  it('a body that cannot be statted for a reason OTHER than absence is retried once it can', async () => {
    // ENOTDIR (a file where the directory should be) is an unreadable body, not
    // an absent one — `statMeasured` keeps the two apart and the cache must treat
    // both as "no evidence". The body changed BEFORE the outage, so once it is
    // measurable again it differs from the key and must be picked up.
    const { home, caps, execs } = await bootPair('echo start');
    expect(await caps()).toEqual(['start']);
    const base = execs();

    writeBody(home, 'echo start\necho stop');
    const libexec = path.dirname(bodyPath(home));
    const aside = `${libexec}.aside`;
    renameSync(libexec, aside);
    writeFileSync(libexec, 'not a directory');

    expect(await caps()).toEqual(['start']);
    expect(execs()).toBe(base);

    rmSync(libexec);
    renameSync(aside, libexec);

    expect(await caps()).toEqual(['start', 'stop']);
    expect(execs()).toBe(base + 1);
  });

  it.each(['entry', 'body'] as const)(
    'a failed caps after a change to the %s half keeps the prior list AND the prior key, so the next call retries',
    async (half) => {
      // A failed exec must write back NEITHER half: if it advanced only the half
      // that changed, the next call would find a pair that matches the key and
      // serve the old list from a cache that never saw the new one.
      const { home, marker, caps, execs } = await bootPair('echo start');
      expect(await caps()).toEqual(['start']);
      const base = execs();

      if (half === 'body') writeBody(home, 'exit 1');
      else writeLauncher(home, marker, ['exit 1']);

      expect(await caps()).toEqual(['start']);
      expect(execs()).toBe(base + 1); // attempted, and failed
      expect(await caps()).toEqual(['start']);
      expect(execs()).toBe(base + 2); // same mismatch, so tried again — the key never moved

      // Healed with yet another content: the retry that follows is the one that lands.
      if (half === 'body') writeBody(home, 'echo start\necho stop');
      else writeLauncher(home, marker, ['echo healed']);
      expect(await caps()).toEqual(half === 'body' ? ['start', 'stop'] : ['healed', 'start']);
      expect(execs()).toBe(base + 3);
    },
  );

  // The two BODY controls the entry's own pair of tests (above) already give the
  // launcher: each number of the body's stat is, alone, enough to invalidate.

  it('a same-size rewrite of the BODY with a different mtime is re-execed (isolates the mtime half of the body gate)', async () => {
    const { home, caps, execs } = await bootPair('echo start');
    expect(await caps()).toEqual(['start']);
    const base = execs();
    const sizeBefore = statSync(bodyPath(home)).size;
    const entryBefore = stamp(entryPath(home));

    writeBody(home, 'echo begin'); // 'start' and 'begin' are both 5 letters
    expect(statSync(bodyPath(home)).size).toBe(sizeBefore); // sanity: size unchanged
    pin(bodyPath(home), T1); // a day later — mtime differs
    expect(stamp(entryPath(home))).toEqual(entryBefore);

    expect(await caps()).toEqual(['begin']);
    expect(execs()).toBe(base + 1);
  });

  it('a same-mtime rewrite of the BODY with a different size is re-execed (isolates the size half of the body gate)', async () => {
    const { home, caps, execs } = await bootPair('echo start');
    expect(await caps()).toEqual(['start']);
    const base = execs();
    const before = stamp(bodyPath(home));
    const entryBefore = stamp(entryPath(home));

    writeBody(home, 'echo start\necho stop'); // longer body
    pin(bodyPath(home), T0); // back to the exact same instant
    expect(statSync(bodyPath(home)).mtimeMs).toBe(before.mtimeMs); // sanity: mtime unchanged
    expect(statSync(bodyPath(home)).size).not.toBe(before.size); // sanity: size changed
    expect(stamp(entryPath(home))).toEqual(entryBefore);

    expect(await caps()).toEqual(['start', 'stop']);
    expect(execs()).toBe(base + 1);
  });
});
