// D4, spec §5.1-§5.5: the resolver stops betting the render on one path.
// The ladder is existence-first and its ORDER is the product, so every rung
// gets a fixture where each earlier rung MISSES and it alone hits — a mutant
// that reorders two rungs, drops one, or short-circuits early fails here.
// Real files on real disk against `localIO`, the idiom `transcript-parse.test.ts`
// already establishes for this module; `FleetIO` spread-fakes (the
// `unlistableIO` shape from `sessionws.test.ts`) cover the seams disk cannot.
import { describe, it, expect } from 'vitest';
import { mkdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import {
  collapseHits, MEMO_MAX, pickNewest, resolveTranscript, RUNG_ORDER, rungRank,
  transcriptPath, TranscriptResolver, type GlobHit, type ResolveOpts,
} from '../src/transcript/resolve.js';
import { mkTmp } from './tmpHelpers.js';

const UUID = 'u'.repeat(36);

interface Box {
  root: string; cfg: string;
  liveLink: string; livePhys: string;
  regLink: string; regPhys: string;
}

/** The production chain in miniature — `<root>/data -> <root>/volume`, same
 *  shape as `transcript-parse.test.ts`'s own `build()` — with a SECOND project
 *  dir so the live cwd and the registry workdir can genuinely differ (M8: a
 *  worktree tool chdir'd the process without a `/cd`). The root is realpath'd
 *  so `/tmp` being a symlink on some hosts cannot make rung 1 fire by accident. */
const box = (): Box => {
  const root = realpathSync(mkTmp('ccrc-ladder-'));
  mkdirSync(path.join(root, 'volume', 'projects', 'demo'), { recursive: true });
  mkdirSync(path.join(root, 'volume', 'projects', 'other'), { recursive: true });
  symlinkSync(path.join(root, 'volume'), path.join(root, 'data'));
  return {
    root,
    cfg: path.join(root, '.claude'),
    liveLink: path.join(root, 'data', 'projects', 'demo'),
    livePhys: path.join(root, 'volume', 'projects', 'demo'),
    regLink: path.join(root, 'data', 'projects', 'other'),
    regPhys: path.join(root, 'volume', 'projects', 'other'),
  };
};

/** Plant a transcript and STAMP its mtime — newest-wins must be a fact of the
 *  fixture, never of how fast the test ran. */
const plant = (file: string, mtimeSec: number, body = '{}\n'): string => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  utimesSync(file, mtimeSec, mtimeSec);
  return file;
};

const opts = (b: Box, over: Partial<ResolveOpts> = {}): ResolveOpts => ({
  configDir: b.cfg, dir: b.liveLink, registryWorkdir: b.regLink, uuid: UUID, ...over,
});

/** A glob-only address: a project dir no munge of any fixture path produces, so
 *  only rung 5/6 can ever reach it. */
const stranded = (cfg: string, uuid = UUID): string =>
  path.join(cfg, 'projects', '-a-directory-no-munge-produces', `${uuid}.jsonl`);

const hit = (over: Partial<GlobHit>): GlobHit =>
  ({ path: '/p', size: 10, mtimeMs: 1000, account: null, order: 0, ...over });

describe('resolveTranscript — the ladder, rung by rung (spec §5.1)', () => {
  it('rung 1: the RESOLVED munge of the directory given wins when the file is there', async () => {
    // Kills a mutant that drops the realpath walk — today's rung 1, the fix
    // that made dead sessions behind a symlinked workdir render at all.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.livePhys, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'live-resolved', account: null });
  });

  it('rung 2: the RAW munge of the directory given wins when only IT exists', async () => {
    // Kills a mutant that returns the resolved path unconditionally: every
    // session whose workdir has no symlink in it lives here.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.liveLink, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'live-raw', account: null });
  });

  it('rung 3: the RESOLVED munge of the REGISTRY workdir rescues a live session whose cwd moved (M4)', async () => {
    // THE reproduced production failure: the process reports a worktree cwd in
    // <configDir>/sessions/<pid>.json while Claude Code keeps appending under
    // its startup directory. Kills a mutant that never crosses from `dir` to
    // `registryWorkdir` — which is exactly what the old resolver could not do.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.regPhys, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'registry-resolved', account: null });
  });

  it('rung 4: the RAW munge of the registry workdir, when nothing above it exists', async () => {
    // Kills a mutant that only ever resolves the registry workdir and never
    // tries it raw.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.regLink, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'registry-raw', account: null });
  });

  it('rung 5: the uuid glob finds a transcript that moved inside its own account', async () => {
    // Kills a mutant that stops after the four exact addresses. `account` is
    // null: this is the session's OWN config dir, so there is nothing to banner.
    const b = box();
    const f = plant(stranded(b.cfg), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'uuid-glob', account: null });
  });

  it('rung 5 picks the NEWEST of several own-account matches', async () => {
    // Kills a mutant that returns the first readdir entry — readdir order is
    // not a preference, and M2's copies differ by weeks.
    const b = box();
    plant(path.join(b.cfg, 'projects', '-old', `${UUID}.jsonl`), 1000, 'old\n');
    const fresh = plant(path.join(b.cfg, 'projects', '-new', `${UUID}.jsonl`), 9000, 'fresher\n');
    const r = await resolveTranscript(localIO, opts(b));
    expect(r).toEqual({ kind: 'found', path: fresh, rung: 'uuid-glob', account: null });
  });

  it('rung 6: a foreign account is used ONLY when 1-5 all miss, and names the account holding it', async () => {
    // The stranded-history case (M2: 17 of 23 rows carry residue under other
    // accounts). Kills a mutant that forgets `account`, which is the entire
    // input to the PWA's banner — a foreign hit rendered silently is the quiet
    // wrongness this spec exists to remove.
    const b = box();
    const personal = path.join(b.root, '.claude-personal');
    const corp = path.join(b.root, '.claude-corp');
    plant(stranded(personal), 2000, 'older foreign\n');
    const newest = plant(stranded(corp), 3000, 'newer foreign\n');
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true }); // own account: listable, empty
    const r = await resolveTranscript(localIO, opts(b, {
      foreign: [{ account: 'claude2', configDir: personal }, { account: 'claude-corp', configDir: corp }],
    }));
    expect(r).toEqual({ kind: 'found', path: newest, rung: 'foreign-glob', account: 'claude-corp' });
  });

  it('an own-account answer beats a NEWER foreign one — rung 6 is never reached while rung 5 hits', async () => {
    // Kills the mutant that pools own and foreign together: M2's five copies of
    // one uuid would then render another account's frozen history for most of
    // the fleet.
    const b = box();
    const personal = path.join(b.root, '.claude-personal');
    plant(stranded(personal), 9000, 'newer, but foreign\n');
    const own = plant(stranded(b.cfg), 1000, 'older, but ours\n');
    const r = await resolveTranscript(localIO, opts(b, {
      foreign: [{ account: 'claude2', configDir: personal }],
    }));
    expect(r).toEqual({ kind: 'found', path: own, rung: 'uuid-glob', account: null });
  });

  it('a foreign mtime tie breaks by roster declaration order, then by path — deterministic, so a test can pin it', async () => {
    // Kills a mutant that leaves the tie to readdir/Map order. `cp -p` carries
    // mtime AND size across accounts (§2.2), so exact ties are ordinary.
    const b = box();
    const first = path.join(b.root, '.claude-first');
    const second = path.join(b.root, '.claude-second');
    const a = plant(stranded(first), 5000, 'same bytes\n');
    plant(stranded(second), 5000, 'same bytes\n');
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true });
    const r = await resolveTranscript(localIO, opts(b, {
      foreign: [{ account: 'first', configDir: first }, { account: 'second', configDir: second }],
    }));
    expect(r).toEqual({ kind: 'found', path: a, rung: 'foreign-glob', account: 'first' });
  });

  it('rung 7: nothing anywhere is a COMPLETE fallback at the raw munge of the directory given', async () => {
    // Kills a mutant that returns null/throws when nothing exists: a tailer
    // pointed at a not-yet-written path must keep working, exactly as today.
    const b = box();
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true }); // listable and empty: the search RAN
    expect(await resolveTranscript(localIO, opts(b))).toEqual({
      kind: 'fallback', path: transcriptPath(b.cfg, b.liveLink, UUID), complete: true,
    });
  });

  it('a null readdir marks the fallback INCOMPLETE — never read as an absence (§5.5)', async () => {
    // The rule (b) case, and the whole reason `complete` exists: remote readdir
    // answers null for a missing directory, a forbidden path and a disconnected
    // agent alike (remote/io.ts). Kills the mutant that hardcodes
    // `complete: true`, which would render a confident empty chat over a fleet
    // host the server simply could not reach.
    const b = box();
    const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };
    expect(await resolveTranscript(unlistableIO, opts(b))).toEqual({
      kind: 'fallback', path: transcriptPath(b.cfg, b.liveLink, UUID), complete: false,
    });
  });

  it('a foreign account that cannot be listed also marks the answer incomplete', async () => {
    // Kills a mutant that only tracks completeness for the own-account glob.
    const b = box();
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => (p.includes('.claude-personal') ? null : localIO.readdir(p)),
    };
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true });
    const r = await resolveTranscript(io, opts(b, {
      foreign: [{ account: 'claude2', configDir: path.join(b.root, '.claude-personal') }],
    }));
    expect(r).toEqual({ kind: 'fallback', path: transcriptPath(b.cfg, b.liveLink, UUID), complete: false });
  });

  it('remote mode (realpath always null) collapses 1 into 2 and 3 into 4, and the uuid glob still works (§5.5)', async () => {
    // Documented degradation, pinned rather than assumed: a transcript under
    // the PHYSICAL munge is unreachable by the exact rungs remotely, and rung 5
    // is what still finds it — with no widening of the agent read whitelist.
    const b = box();
    const remoteish: FleetIO = { ...localIO, realpath: async () => null };
    const phys = plant(transcriptPath(b.cfg, b.livePhys, UUID), 1000);
    const r = await resolveTranscript(remoteish, opts(b));
    expect(r).toEqual({ kind: 'found', path: phys, rung: 'uuid-glob', account: null });
  });
});

describe('rung order and candidate collapse (spec §5.1)', () => {
  it('rungRank is strictly increasing in ladder order and a fallback ranks after every rung', () => {
    // §5.3's "strictly better rung" comparator reads this order. Kills a mutant
    // that reorders RUNG_ORDER or ranks a fallback as a hit.
    expect(RUNG_ORDER).toEqual([
      'live-resolved', 'live-raw', 'registry-resolved', 'registry-raw', 'uuid-glob', 'foreign-glob',
    ]);
    const ranks = RUNG_ORDER.map((rung) => rungRank({ kind: 'found', path: '/p', rung, account: null }));
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rungRank({ kind: 'fallback', path: '/p', complete: true })).toBe(RUNG_ORDER.length);
  });

  it('collapseHits folds identical (size, mtimeMs) names into ONE candidate (M1)', () => {
    // The fleet holds one inode wearing three names right now. Three names for
    // one file must not read as three candidates. Kills a mutant that dedupes
    // on path (which never collapses anything) or on size alone (which would
    // fold two genuinely different files).
    const names = ['/c.jsonl', '/a.jsonl', '/b.jsonl'].map((p) => hit({ path: p, size: 70, mtimeMs: 42 }));
    const collapsed = collapseHits([...names, hit({ path: '/d.jsonl', size: 70, mtimeMs: 43 })]);
    expect(collapsed).toHaveLength(2);
    // The survivor of a collapsed group is the lowest (order, path) — stable,
    // so the rendered path does not wander between ticks.
    expect(collapsed.map((h) => h.path).sort()).toEqual(['/a.jsonl', '/d.jsonl']);
  });

  it('pickNewest: newest mtime wins, ties by roster order, then by path', () => {
    // Kills mutants that sort ascending, that skip the order tiebreak, or that
    // leave the final tie to input order.
    expect(pickNewest([])).toBeNull();
    expect(pickNewest([
      hit({ path: '/old', mtimeMs: 1 }), hit({ path: '/new', mtimeMs: 2 }),
    ])!.path).toBe('/new');
    expect(pickNewest([
      hit({ path: '/second', mtimeMs: 5, size: 1, order: 1 }),
      hit({ path: '/first', mtimeMs: 5, size: 2, order: 0 }),
    ])!.path).toBe('/first');
    expect(pickNewest([
      hit({ path: '/zzz', mtimeMs: 5, size: 2, order: 0 }),
      hit({ path: '/aaa', mtimeMs: 5, size: 1, order: 0 }),
    ])!.path).toBe('/aaa');
  });
});

describe('TranscriptResolver — the memo (spec §5.4)', () => {
  /** A counting FleetIO. The stat/readdir counts ARE §5.4's cost claim: steady
   *  state must be ONE stat per session per tick, cheaper than today's found
   *  case, or the ladder is a regression on every open socket. */
  const counting = (inner: FleetIO = localIO) => {
    const n = { stat: 0, readdir: 0 };
    const io: FleetIO = {
      ...inner,
      stat: (p) => { n.stat += 1; return inner.stat(p); },
      readdir: (p) => { n.readdir += 1; return inner.readdir(p); },
    };
    return { io, n };
  };

  /** A dead-session box: dir === registryWorkdir and the dir is its own
   *  realpath, so all four exact rungs collapse to ONE candidate — the
   *  four-to-two collapse §5.1 promises, here at its floor. */
  const flat = (): { cfg: string; dir: string } => {
    const root = realpathSync(mkTmp('ccrc-memo-'));
    const dir = path.join(root, 'projects', 'demo');
    mkdirSync(dir, { recursive: true });
    return { cfg: path.join(root, '.claude'), dir };
  };

  it('re-validates a found answer with exactly ONE stat and no readdir at all', async () => {
    const { cfg, dir } = flat();
    const f = plant(stranded(cfg), 1000);
    mkdirSync(path.join(cfg, 'projects', '-b'), { recursive: true });
    const { io, n } = counting();
    const r = new TranscriptResolver(io);
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };

    const first = await r.resolve(o);
    expect(first).toEqual({ kind: 'found', path: f, rung: 'uuid-glob', account: null });
    // One exact candidate + one readdir + one stat per listed project dir.
    expect(n.readdir).toBe(1);
    const afterFirst = n.stat;
    expect(afterFirst).toBeGreaterThan(1);

    expect(await r.resolve(o)).toEqual(first);
    expect(n.stat - afterFirst).toBe(1);   // the whole point: ONE stat
    expect(n.readdir).toBe(1);             // and the search does not re-run
  });

  it('re-ladders the moment its winner vanishes', async () => {
    // Kills a mutant that trusts the memo blindly — the session would tail a
    // deleted path forever and the chat would freeze mid-conversation.
    const { cfg, dir } = flat();
    const f = plant(stranded(cfg), 1000);
    const { io, n } = counting();
    const r = new TranscriptResolver(io);
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };
    expect((await r.resolve(o)).path).toBe(f);
    const readdirs = n.readdir;

    rmSync(f);
    expect(await r.resolve(o)).toEqual({
      kind: 'fallback', path: transcriptPath(cfg, dir, UUID), complete: true,
    });
    expect(n.readdir).toBe(readdirs + 1); // the full ladder actually re-ran
  });

  it('a changed key re-ladders; the key is (configDir, uuid, dir)', async () => {
    // Kills a mutant with a single-slot memo or a key missing the uuid — a
    // /clear rotates the uuid and would otherwise keep rendering the old file.
    const { cfg, dir } = flat();
    const a = plant(stranded(cfg), 1000);
    const other = 'o'.repeat(36);
    const b = plant(stranded(cfg, other), 1000);
    const r = new TranscriptResolver(localIO);
    expect((await r.resolve({ configDir: cfg, dir, registryWorkdir: dir, uuid: UUID })).path).toBe(a);
    expect((await r.resolve({ configDir: cfg, dir, registryWorkdir: dir, uuid: other })).path).toBe(b);
  });

  it('a fallback re-ladders only when its back-off expires — and then finds what appeared elsewhere', async () => {
    // §5.4's back-off, pinned with an injected clock so the test never sleeps.
    // Kills both mutants: one that re-ladders every call (the 2 s full-search
    // regression this memo exists to prevent) and one that never re-ladders
    // (a swapped-in transcript would never appear).
    const { cfg, dir } = flat();
    mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    let clock = 1_000_000;
    const { io, n } = counting();
    const r = new TranscriptResolver(io, { backoffMs: 30_000, now: () => clock });
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };

    expect((await r.resolve(o)).kind).toBe('fallback');
    const readdirs = n.readdir;

    const f = plant(stranded(cfg), 1000);   // a swap lands somewhere the exact rungs cannot see
    clock += 29_000;
    expect((await r.resolve(o)).kind).toBe('fallback'); // still inside the back-off
    expect(n.readdir).toBe(readdirs);

    clock += 2_000;
    expect(await r.resolve(o)).toEqual({ kind: 'found', path: f, rung: 'uuid-glob', account: null });
    expect(n.readdir).toBe(readdirs + 1);
  });

  it('a fallback whose own path appears re-ladders immediately, back-off or not', async () => {
    // The common heal: the session finally writes at the address the tailer is
    // already pointed at. Kills a mutant that makes the back-off the ONLY exit
    // from a fallback, which would delay every new session's first render.
    const { cfg, dir } = flat();
    mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    const r = new TranscriptResolver(localIO, { backoffMs: 30_000, now: () => 1_000_000 });
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };
    const raw = transcriptPath(cfg, dir, UUID);
    expect((await r.resolve(o)).kind).toBe('fallback');
    plant(raw, 1000);
    expect(await r.resolve(o)).toEqual({ kind: 'found', path: raw, rung: 'live-raw', account: null });
  });

  it('the memo is bounded — a rotating uuid cannot grow it without limit', async () => {
    // The watcher's sweep shares ONE resolver across every row, and a /clear
    // mints a fresh uuid on every rotation: an unbounded Map is a slow leak in
    // a process that runs for weeks.
    const { cfg, dir } = flat();
    mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    const r = new TranscriptResolver(localIO);
    for (let i = 0; i < MEMO_MAX + 20; i += 1) {
      await r.resolve({ configDir: cfg, dir, registryWorkdir: dir, uuid: `${i}`.padStart(36, '0') });
    }
    expect((r as unknown as { memo: Map<string, unknown> }).memo.size).toBeLessThanOrEqual(MEMO_MAX);
  });
});
