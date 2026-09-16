// Spec §5.4.4. `io.readdir` answers `string[] | null` and folds "the directory
// is not there" into "the directory would not list" (the `FleetIO.readdir`
// member in `server/src/io.ts` is the one read with no measured sibling). This
// reader splits them ONE LEVEL UP, off the
// registry root listing the caller already took, the same trick `readLimits`
// plays for `-disabled` markers. Getting that split wrong in the permissive
// direction silently LIFTS every project's pool constraint, which is the whole
// class of defect this feature exists inside.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import {
  POOLS_DIR_NAME, poolFor, poolsEnforcement, poolsWire, readProjectPools,
  readProjectPoolsWithRoot,
} from '../src/pools.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';

let home: string;
let reg: string;
let pools: string;

beforeEach(() => {
  home = mkTmp('ccrc-pools-read-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  pools = path.join(reg, POOLS_DIR_NAME);
  mkdirSync(reg, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

const cfg = () => loadConfig({ CCRC_HOME: home });
const rootNames = async (): Promise<string[] | null> => localIO.readdir(reg);
const tag = (project: string, bytes: string): void => {
  mkdirSync(pools, { recursive: true });
  writeFileSync(path.join(pools, project), bytes);
};

describe('readProjectPools — absent, unlistable and the four per-entry states', () => {
  it('a null ROOT listing is listed:false — the registry itself could not be read', async () => {
    const read = await readProjectPools(localIO, cfg(), null, 1_000);
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('a root listing WITHOUT pools/ is a MEASURED absence — every project untagged', async () => {
    // Ruling 3: nothing strands on rollout. Nobody has tagged anything, and
    // that is a positive answer, not a failure to look.
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(read).toEqual({ listed: true, tags: new Map() });
    expect(poolFor(read, 'demo')).toEqual({ state: 'untagged' });
  });

  it('pools/ present at the root but unlistable is listed:false — never a fleet of untagged projects', async () => {
    // A REGULAR FILE planted where the directory belongs: `localIO.readdir`
    // answers null for it, exactly as it does for EACCES and exactly as
    // `remote/io.ts` answers for a whitelist refusal (`remote/io.ts:104-112`).
    // The permissive reading — an empty map — would lift every tag on the box.
    writeFileSync(pools, 'not a directory');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('reads a tag, strips a trailing newline, and refuses a leading space', async () => {
    // `printf '%s'` is the verb's writer, `echo` is the 2am writer (ruling 2),
    // so trailing whitespace is stripped — TRAILING ONLY. A leading space is
    // malformed on both sides or the two readers disagree.
    //
    // AGREEMENT IS DECIDED ONE LINE EARLIER THAN THIS COMMENT USED TO SAY.
    // It read "byte for byte with `_project_pool_state`'s
    // `v=${v%"${v##*[![:space:]]}"}`", and that quote is still VERBATIM
    // correct — what stopped being true is its SUFFICIENCY. Wave 2a inserted a
    // 64-byte read cap ABOVE the strip (`grep -n "read -r -d '' -n 64" ccd/ccd`,
    // D-1850), and the strip cannot see it: a valid name padded with 58+ bytes
    // of trailing whitespace is `malformed` to `ccd` and would strip back to a
    // clean tag here. The cap is mirrored below, and the padded case is one of
    // the cases in this describe.
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b\n');
    tag('acct-a-demo', ' pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
    expect(poolFor(read, 'acct-a-demo')).toEqual({ state: 'malformed' });
  });

  it('a tag padded to 64 bytes is malformed, and 63 still strips to a name', async () => {
    // RULING 1's case, and the one that decides the CAP rather than the strip.
    // `ccd`'s `IFS= read -r -d '' -n 64` succeeds AT 64 BYTES, so 64 is
    // already `malformed` there (measured: 63 -> rc 1, 64 -> rc 0). It counts
    // BYTES and not characters because `_project_pool_state` shadows
    // `LC_ALL=C` before reading (D-2520); this sentence said "characters" until
    // that shadow landed, and was correct when it did. For the ASCII pair below
    // the two units coincide, so the boundary this test pins is the same one
    // either way — but the sentence has to track the code, because the next
    // reader of it will be deciding what the cap means for a NON-ASCII tag.
    // The pair
    // below is deliberately one byte apart, because a cap written `> 64`
    // passes the 64 case, strips it, and answers `tagged` — agreeing with
    // `ccd` on 65 and disagreeing on exactly the boundary (D-2010).
    tag('demo', 'pool-a' + ' '.repeat(58));        // 6 + 58 = 64
    tag('quiet-basin', 'pool-b' + ' '.repeat(57)); // 6 + 57 = 63
    // THE NUL, AND WHAT THIS ASSERTION DOES NOT MEASURE — said here because a
    // green expectation that cannot fail is worse than no expectation at all,
    // and this one cannot. `ccd` needs the NUL arm: `read -d ''` STOPS at the
    // delimiter, so `pool-a\0junk` would otherwise yield the valid prefix
    // `pool-a` and place on a pool the file does not name. The SERVER cannot
    // reach that state — it holds the whole string — and `POOL_NAME_RE`
    // (`/^[a-z][a-z0-9-]{0,31}$/`, anchored, and its class excludes `\0`) already
    // answers `malformed` for every NUL-bearing content. `\s` does not include
    // `\0` either, so the strip cannot remove one. MEASURED: delete
    // `.includes('\0')` from the mirror and this whole file stays green.
    // The arm is kept because ruling 1 requires it and because it states the
    // parity at the site, but it is a DOCUMENTED NO-OP, not a pinned guard —
    // the same treatment C1's M19 got rather than a case written to look red.
    // VOID (i.e. it becomes load-bearing, and this comment becomes wrong) if
    // `POOL_NAME_RE` ever admits a NUL, or if the cap is ever applied to the
    // STRIPPED value, or if this reader ever stops holding the whole string.
    tag('acct-a-demo', 'pool-a\0pool-b');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(poolFor(read, 'demo')).toEqual({ state: 'malformed' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
    expect(poolFor(read, 'acct-a-demo'),
      'malformed — but by the name grammar, not by the cap: see above').toEqual({ state: 'malformed' });
  });

  it('two tokens, uppercase and an empty file are all malformed — never untagged', async () => {
    tag('demo', 'pool a');
    tag('quiet-basin', 'Pool-A');
    tag('acct-a-demo', '');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    for (const p of ['demo', 'quiet-basin', 'acct-a-demo']) {
      expect(poolFor(read, p), p).toEqual({ state: 'malformed' });
    }
  });

  it('an entry whose bytes never came back is unreadable, and only that entry', async () => {
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b');
    const io = degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/quiet-basin`));
    const read = await readProjectPools(io, cfg(), await rootNames(), 1_000);
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'unreadable' });
  });

  it('an entry that vanished between the listing and its own read is a SKIP — absence is untag', async () => {
    // The `--clear` that landed mid-read. A proven ENOENT is a proven untag,
    // which is exactly what `readFileMeasured` exists to be able to say.
    tag('demo', 'pool-a');
    const io = absentReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`));
    const read = await readProjectPools(io, cfg(), await rootNames(), 1_000);
    expect(read.listed && read.tags.has('demo')).toBe(false);
    expect(poolFor(read, 'demo')).toEqual({ state: 'untagged' });
  });

  it('skips dot-leading entries — the disclosed tmp leak is not a project', async () => {
    // `$REG/pools/.<project>.$BASHPID.tmp` after a SIGKILL between write and
    // rename. No project may lead with a dot (`_ws_project_valid`), so the
    // skip is exact.
    tag('demo', 'pool-a');
    tag('.demo.4242.tmp', 'pool-b');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(read.listed && [...read.tags.keys()]).toEqual(['demo']);
  });

  it('poolFor answers untagged for a project with no entry, on a listed read', async () => {
    tag('demo', 'pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'untagged' });
  });
});

describe('readProjectPools — the I/O cost awaited by FleetWatcher.tick', () => {
  type CountedIO = Parameters<typeof readProjectPools>[0];

  const countingIO = (): { io: CountedIO; ops: string[] } => {
    const ops: string[] = [];
    const io: Record<string, unknown> = {};
    for (const [member, impl] of Object.entries(localIO as unknown as Record<string, unknown>)) {
      io[member] = typeof impl === 'function'
        ? (...args: unknown[]): unknown => {
            ops.push(member);
            // Preserve methods such as readFile that derive through `this`.
            return (impl as (...a: unknown[]) => unknown).apply(io, args);
          }
        : impl;
    }
    return { io: io as unknown as CountedIO, ops };
  };

  it('does no I/O when the root listing is unmeasurable', async () => {
    tag('demo', 'pool-a');
    const { io, ops } = countingIO();
    expect(await readProjectPools(io, cfg(), null, 1_000)).toEqual({ listed: false });
    expect(ops).toEqual([]);
  });

  it('bounds a route-owned root listing inside the same caller budget', async () => {
    vi.useFakeTimers();
    const pending = readProjectPools(
      localIO,
      cfg(),
      () => new Promise<never>(() => {}),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toEqual({ listed: false });
  });

  it('does not accept a route root that settles after the monotonic deadline', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(11_001);

    const read = await readProjectPools(
      localIO,
      cfg(),
      async () => [POOLS_DIR_NAME],
      1_000,
    );

    expect(read).toEqual({ listed: false });
  });

  it('normalizes a late shared root before revival and pool consumers inspect it', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(11_001);
    const needsPools = vi.fn(() => false);

    const read = await readProjectPoolsWithRoot(
      localIO,
      cfg(),
      async () => ['claude-demo.uuid'],
      1_000,
      needsPools,
    );

    expect(needsPools).toHaveBeenCalledWith(null);
    expect(read).toEqual({ rootNames: null, poolsRead: false });
  });

  it('does no I/O when the measured root listing has no pools directory', async () => {
    const names = await rootNames();
    const { io, ops } = countingIO();
    expect(await readProjectPools(io, cfg(), names, 1_000)).toEqual({ listed: true, tags: new Map() });
    expect(ops).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'fails shut without I/O when a direct caller supplies unusable budget %s',
    async (budgetMs) => {
      tag('demo', 'pool-a');
      const names = await rootNames();
      const { io, ops } = countingIO();

      expect(await readProjectPools(io, cfg(), names, budgetMs)).toEqual({ listed: false });
      expect(ops).toEqual([]);
    },
  );

  it('does one readdir plus one measured read per non-dot entry', async () => {
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b');
    tag('.demo.4242.tmp', 'pool-a');
    const names = await rootNames();
    const { io, ops } = countingIO();
    const read = await readProjectPools(io, cfg(), names, 1_000);
    expect(read.listed).toBe(true);
    expect(ops).toEqual(['readdir', 'readFileMeasured', 'readFileMeasured']);
  });

  it.each([
    ['unfinished', () => new Promise<string[] | null>(() => {})],
    ['rejected', () => Promise.reject(new Error('transport failed'))],
  ])('maps an %s pools-directory listing to listed:false inside the caller budget', async (_case, listing) => {
    vi.useFakeTimers();
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? listing() : localIO.readdir(p),
    };

    const pending = readProjectPools(io, cfg(), names, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toEqual({ listed: false });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('starts a later marker while the first marker is still unresolved', async () => {
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const started: string[] = [];
    let releaseFirst!: () => void;
    let noteLaterStarted!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const laterStarted = new Promise<void>((resolve) => { noteLaterStarted = resolve; });
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo', 'quiet-basin'] : localIO.readdir(p),
      readFileMeasured: async (p) => {
        const name = path.basename(p);
        started.push(name);
        if (name === 'demo') await first;
        else noteLaterStarted();
        return { ok: true, content: 'pool-a' };
      },
    };

    const pending = readProjectPools(io, cfg(), names, 1_000);
    let watchdog: ReturnType<typeof setImmediate> | undefined;
    try {
      await Promise.race([
        laterStarted,
        new Promise<never>((_, reject) => {
          watchdog = setImmediate(
            () => reject(new Error('later marker did not start in the same launch turn')),
          );
        }),
      ]);
      expect(started).toEqual(['demo', 'quiet-basin']);
    } finally {
      if (watchdog !== undefined) clearImmediate(watchdog);
      releaseFirst();
    }
    const read = await pending;

    expect(started).toEqual(['demo', 'quiet-basin']);
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-a' });
  });

  it('degrades the whole listed population and aborts losing reads when the shared deadline expires', async () => {
    vi.useFakeTimers();
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    let abortedAtExpiry = false;
    let noteLosingStarted!: () => void;
    const losingStarted = new Promise<void>((resolve) => { noteLosingStarted = resolve; });
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo', 'quiet-basin', 'acct-a-demo'] : localIO.readdir(p),
      readFileMeasured: async (p, _timeoutMs, signal) => {
        const name = path.basename(p);
        if (name === 'demo') return { ok: true, content: 'pool-a' };
        if (name === 'quiet-basin') return { ok: false, reason: 'absent' };
        signal?.addEventListener('abort', () => { abortedAtExpiry = true; }, { once: true });
        noteLosingStarted();
        return new Promise(() => {});
      },
    };

    const pending = readProjectPools(io, cfg(), names, 1_000);
    await losingStarted;
    vi.advanceTimersByTime(1_000);
    expect(abortedAtExpiry, 'the deadline callback aborts losing adapter work').toBe(true);
    const read = await pending;

    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'unreadable' });
    expect(poolFor(read, 'acct-a-demo')).toEqual({ state: 'unreadable' });
    expect(read.listed && [...read.tags.keys()]).toEqual(['demo', 'quiet-basin', 'acct-a-demo']);
  });

  it('passes the caller budget to the listing and the remaining budget to every marker', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_250);
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const seen: Array<{ op: string; timeoutMs: number | undefined }> = [];
    const io: FleetIO = {
      ...localIO,
      readdir: async (p, timeoutMs) => {
        if (p !== pools) return localIO.readdir(p);
        seen.push({ op: 'readdir', timeoutMs });
        return ['demo', 'quiet-basin'];
      },
      readFileMeasured: async (p, timeoutMs) => {
        seen.push({ op: path.basename(p), timeoutMs });
        return { ok: true, content: 'pool-a' };
      },
    };

    await readProjectPools(io, cfg(), names, 1_000);

    expect(seen).toEqual([
      { op: 'readdir', timeoutMs: 1_000 },
      { op: 'demo', timeoutMs: 750 },
      { op: 'quiet-basin', timeoutMs: 750 },
    ]);
  });

  it('keeps the launch decision numeric when elapsed time becomes non-finite', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(Number.NaN);
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const reads = vi.fn(async () => ({ ok: true as const, content: 'pool-a' }));
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo'] : localIO.readdir(p),
      readFileMeasured: reads,
    };

    const read = await readProjectPools(io, cfg(), names, 1_000);

    expect(reads).not.toHaveBeenCalled();
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('rejects a pools listing that settles after the monotonic deadline but before its timer callback', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000) // construct the deadline
      .mockReturnValueOnce(10_000) // accept the already-measured root listing
      .mockReturnValueOnce(11_001); // reject the pools listing itself
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const reads = vi.fn(async () => ({ ok: true as const, content: 'pool-a' }));
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo'] : localIO.readdir(p),
      readFileMeasured: reads,
    };

    const read = await readProjectPools(io, cfg(), names, 1_000);

    expect(read).toEqual({ listed: false });
    expect(reads).not.toHaveBeenCalled();
    const source = readFileSync(new URL('../src/pools.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/Number\.isFinite\(elapsedBudget\) \? Math\.max\(0, elapsedBudget\) : 0/);
  });

  it('degrades markers that settle after the monotonic deadline before its timer callback', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000) // construct the deadline
      .mockReturnValueOnce(10_000) // accept the root listing
      .mockReturnValueOnce(10_000) // accept the pools listing
      .mockReturnValueOnce(11_001); // reject the completed marker burst
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo'] : localIO.readdir(p),
      readFileMeasured: async () => ({ ok: true, content: 'pool-a' }),
    };

    const read = await readProjectPools(io, cfg(), names, 1_000);

    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it.each([3_600_000, -3_600_000])(
    'uses elapsed time immune to a %i ms wall-clock step',
    async (wallClockStep) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(10_000);
      mkdirSync(pools, { recursive: true });
      const names = await rootNames();
      const seen: Array<number | undefined> = [];
      const io: FleetIO = {
        ...localIO,
        readdir: async (p) => {
          if (p !== pools) return localIO.readdir(p);
          vi.setSystemTime(10_000 + wallClockStep);
          return ['demo'];
        },
        readFileMeasured: async (_p, timeoutMs) => {
          seen.push(timeoutMs);
          return { ok: true, content: 'pool-a' };
        },
      };

      await readProjectPools(io, cfg(), names, 1_000);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeGreaterThan(0);
      expect(seen[0]).toBeLessThanOrEqual(1_000);
    },
  );

  it('does not flood marker requests with less than 50 ms of useful budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_951);
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const reads = vi.fn(async () => ({ ok: true as const, content: 'pool-a' }));
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo', 'quiet-basin'] : localIO.readdir(p),
      readFileMeasured: reads,
    };

    const read = await readProjectPools(io, cfg(), names, 1_000);

    expect(reads).not.toHaveBeenCalled();
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'unreadable' });
  });

  it('clears the deadline timer after a bounded read finishes early', async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    mkdirSync(pools, { recursive: true });
    tag('demo', 'pool-a');

    await readProjectPools(localIO, cfg(), await rootNames(), 1_000);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no marker requests when the listing leaves less than the launch floor', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_951)
      .mockReturnValueOnce(10_951);
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const reads = vi.fn(async () => ({ ok: true as const, content: 'pool-a' }));
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        if (p !== pools) return localIO.readdir(p);
        return ['demo', 'quiet-basin'];
      },
      readFileMeasured: reads,
    };

    const read = await readProjectPools(io, cfg(), names, 1_000);

    expect(reads).not.toHaveBeenCalled();
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'unreadable' });
  });

  it('maps a rejected marker read to unreadable without rejecting the sweep', async () => {
    mkdirSync(pools, { recursive: true });
    const names = await rootNames();
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => p === pools ? ['demo'] : localIO.readdir(p),
      readFileMeasured: async () => Promise.reject(new Error('transport failed')),
    };

    const read = await readProjectPools(io, cfg(), names, 1_000);

    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });
});

describe('L3 may not narrow — four states in, four states out', () => {
  it('every state a marker can be in survives to the wire', async () => {
    tag('demo', 'pool-a');            // tagged
    tag('quiet-basin', 'Pool A');     // malformed
    tag('acct-a-demo', 'pool-b');     // -> made unreadable below
    const io = degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/acct-a-demo`));
    const read = await readProjectPools(io, cfg(), await rootNames(), 1_000);
    expect([
      poolFor(read, 'demo').state,
      poolFor(read, 'quiet-basin').state,
      poolFor(read, 'acct-a-demo').state,
      poolFor(read, 'nothing-here').state,
    ]).toEqual(['tagged', 'malformed', 'unreadable', 'untagged']);
  });
});

describe('poolsEnforcement — the three-state shape lifecycleState uses', () => {
  it('null caps is unknown, never unavailable', () => {
    // `lifecycleState`'s own ruling (`coord/mirrorplan.ts:207`): `unavailable`
    // is a MEASURED absence an operator may act on; a null list is no evidence,
    // and a reader must stay silent on it.
    expect(poolsEnforcement(null)).toBe('unknown');
  });

  it('the verb present is enforced, the verb absent is unavailable', () => {
    const verb = CCD_ARGV.projectPoolClear('demo')[0]!;
    expect(poolsEnforcement([verb, 'swap'])).toBe('enforced');
    expect(poolsEnforcement(['swap', 'start'])).toBe('unavailable');
  });
});

describe('poolsWire', () => {
  it('carries the map as a plain object when listed, and the enforcement either way', async () => {
    tag('demo', 'pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames(), 1_000);
    expect(poolsWire(read, 'enforced')).toEqual({
      listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced',
    });
    expect(poolsWire({ listed: false }, 'unknown')).toEqual({ listed: false, enforcement: 'unknown' });
  });
});

// §11 row 17, server half. Under `CCRC_FLEET=remote` — the live server's
// standing config — every registry read crosses the agent to the FLEET box.
// A `pools/` on the SERVER box is not policy; it is a directory nobody's `ccd`
// reads, and a reader that fell back to local fs would enforce it anyway.
describe('remote mode reads the FLEET box, never the server box', () => {
  let agent: Awaited<ReturnType<typeof bootAgent>> | undefined;
  let fleet: ReturnType<typeof connectToAgent> | undefined;
  let fixture: ReturnType<typeof makeFixture> | undefined;
  let serverHome: string;

  beforeEach(async () => {
    serverHome = mkTmp('ccrc-pools-serverbox-');
    seedRoster(serverHome);
    // The tag the server box must NOT see: a complete, well-formed marker on
    // this process's own disk, at exactly the path `cfg.registryDir` names.
    mkdirSync(path.join(serverHome, '.cc-sessions', POOLS_DIR_NAME), { recursive: true });
    writeFileSync(path.join(serverHome, '.cc-sessions', POOLS_DIR_NAME, 'demo'), 'pool-a');
    fixture = makeFixture();
    // `makeFixture` builds `.cc-sessions`/`.cc-limits`/`.cc-clips`/`.claude` and
    // no roster, so the second case's `loadConfig` over the FIXTURE home threw
    // `RosterError` until this line existed. The plan's Task 11 snippet omitted
    // it and asserted the describe passes on the first run; measured, it does
    // not. Seeding a roster is config, not policy — it plants no `pools/`, so
    // what the pin measures is untouched.
    seedRoster(fixture.home);
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
  });

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
    rmSync(serverHome, { recursive: true, force: true });
  });

  it('a pools/ planted on the SERVER box is invisible, and reads unreadable — never tagged, never untagged', async () => {
    const cfg = loadConfig({ CCRC_HOME: serverHome, CCRC_FLEET: 'remote' });
    const io = fleet!.io;
    // THE ROOT LISTING IS SUPPLIED, NOT TAKEN THROUGH `io`, AND THAT IS THE
    // WHOLE POINT. The plan's snippet passed `await io.readdir(cfg.registryDir)`
    // here, which the agent refuses (this path is outside its read roots), so
    // the reader returned `{listed:false}` at its FIRST guard and never reached
    // the two reads a `localIO` shortcut would corrupt. Measured: with the
    // shortcut planted, that version PASSED while three sibling cases went red —
    // a green mutation with a live control, i.e. a pin that cannot see the
    // defect it names. Supplying a listing that clears both early guards is what
    // puts the reader's own reads under the assertion.
    const read = await readProjectPools(io, cfg, [POOLS_DIR_NAME], 1_000);
    // `io` is the REMOTE io, so this read crosses to the fleet box and is
    // refused there -> null -> `listed:false`. UNREADABLE, not untagged: a
    // whitelist regression must refuse to decide, not silently lift every
    // constraint on the fleet. A reader that fell back to local fs would answer
    // `tagged pool-a` off the marker planted on THIS box in `beforeEach`.
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
    expect(poolFor(read, 'demo')).not.toEqual({ state: 'tagged', name: 'pool-a' });
  });

  it('the FLEET box\'s own pools/ IS what a remote read answers', async () => {
    // The other direction, so the case above cannot pass by the reader being
    // broken outright: a tag on the agent's home reads back correctly.
    const dir = path.join(fixture!.home, '.cc-sessions', POOLS_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'quiet-basin'), 'pool-b');
    const cfg = loadConfig({ CCRC_HOME: fixture!.home, CCRC_FLEET: 'remote' });
    const io = fleet!.io;
    const read = await readProjectPools(io, cfg, await io.readdir(cfg.registryDir), 1_000);
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
  });
});
