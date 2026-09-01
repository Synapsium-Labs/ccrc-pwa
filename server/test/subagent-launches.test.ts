// Joining the hook's subagent roster to the launch record Claude Code already
// wrote. The two properties with real cost behind them are the CACHE (a launch
// record cannot change, so steady state must be zero io) and RETAIN-DON'T-ERASE
// (a later failed read must not blank a description already on screen).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { LAUNCH_MAX_BYTES, readLaunchRecord, sidecarDirFor } from '../src/subagents.js';
import { mkTmp } from './tmpHelpers.js';

describe('sidecarDirFor', () => {
  it('derives the sidecar dir from the transcript path', () => {
    expect(sidecarDirFor('/c/projects/-x/u.jsonl')).toBe('/c/projects/-x/u/subagents');
  });

  it('is derived from the RESOLVER’s winning path, never re-munged', () => {
    // `resolveTranscript` walks a six-rung ladder, and rungs 5 and 6 can land
    // in a DIFFERENT account's configDir. Recomputing the munge from the
    // workdir would rebuild the path the resolver rejected and read somebody
    // else's subagents, or nothing. Taking dirname+basename of whatever the
    // resolver returned is what makes that impossible — this case is a foreign
    // configDir and it still lands beside its own transcript.
    expect(sidecarDirFor('/other-home/.claude/projects/-w-demo/abc.jsonl'))
      .toBe('/other-home/.claude/projects/-w-demo/abc/subagents');
  });
});

describe('readLaunchRecord', () => {
  const seed = (contents: string, id = 'abc'): { io: FleetIO; dir: string } => {
    const home = mkTmp('ccrc-launch-');
    const dir = path.join(home, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `agent-${id}.meta.json`), contents);
    return { io: localIO, dir };
  };

  it('reads the description and the type', async () => {
    // The real shape, copied from a record measured on this box.
    const { io, dir } = seed(JSON.stringify({
      agentType: 'general-purpose', description: 'Inventory MapsPeople provider',
      toolUseId: 'toolu_x', parentAgentId: 'af8', spawnDepth: 2,
    }));
    await expect(readLaunchRecord(io, dir, 'abc')).resolves.toEqual({
      found: true, record: { agentType: 'general-purpose', description: 'Inventory MapsPeople provider' },
    });
  });

  it('is not found for a missing file, unparseable JSON, or a record describing nothing', async () => {
    // ONE arm for all of these, deliberately. `FleetIO.readFile` folds ENOENT,
    // EACCES and a dropped agent round trip into one null, so this layer
    // cannot tell "never written" from "would not read" — minting an `absent`
    // arm would fabricate a distinction the port cannot supply.
    const { io, dir } = seed('{}');
    await expect(readLaunchRecord(io, dir, 'nope')).resolves.toEqual({ found: false });
    await expect(readLaunchRecord(io, dir, 'abc')).resolves.toEqual({ found: false });

    const bad = seed('not json at all', 'bad');
    await expect(readLaunchRecord(bad.io, bad.dir, 'bad')).resolves.toEqual({ found: false });

    const blank = seed(JSON.stringify({ description: '   ', agentType: '' }), 'blank');
    await expect(readLaunchRecord(blank.io, blank.dir, 'blank')).resolves.toEqual({ found: false });
  });

  it('refuses an over-cap file rather than pulling it into memory', async () => {
    // The guard against a wrong path: the sibling `agent-<id>.jsonl` is the
    // subagent's own TRANSCRIPT (measured p50 857 KB, max 48 MB on this box),
    // and `transcript/tail.ts` records what reading those whole cost once
    // (~1.9 GB agent RSS). A record is ~137 bytes.
    const big = seed(JSON.stringify({ description: 'x'.repeat(LAUNCH_MAX_BYTES) }), 'big');
    await expect(readLaunchRecord(big.io, big.dir, 'big')).resolves.toEqual({ found: false });
  });

  it('never reads the subagent’s own transcript', async () => {
    // Pins the filename, because reaching for `.jsonl` is the natural slip and
    // the cost is three orders of magnitude.
    const home = mkTmp('ccrc-launch-');
    const dir = path.join(home, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'agent-x.jsonl'), 'x'.repeat(100_000));
    const reads: string[] = [];
    const spy: FleetIO = { ...localIO, readFile: async (p) => { reads.push(p); return localIO.readFile(p); } };
    await readLaunchRecord(spy, dir, 'x');
    expect(reads).toHaveLength(1);
    expect(reads[0]!.endsWith('agent-x.meta.json')).toBe(true);
    expect(reads.some((p) => p.endsWith('.jsonl'))).toBe(false);
  });

  it('trims the description, because it becomes a row’s only visible text', async () => {
    const { io, dir } = seed(JSON.stringify({ description: '  Map the auth seam  ' }), 't');
    const r = await readLaunchRecord(io, dir, 't');
    expect(r.found && r.record.description).toBe('Map the auth seam');
  });
});

// ── THE WATCHER JOIN ────────────────────────────────────────────────────────
// The pure functions above are the easy half. `describeSubagents` is where the
// cache, the miss budget and retain-don't-erase actually live, and adversarial
// review of this branch found them entirely uncovered — the commit message
// claimed properties nothing tested. These close that gap end to end:
// registry -> sweepHookStates -> the join -> the emitted fleet frame.
import { Bus } from '../src/bus.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { seedRoster } from './helpers.js';
import { Tmux, type Runner } from '../src/exec.js';
import type { FleetSession } from '../../shared/api.js';

const UUID = '1'.repeat(36);
const ID = 'claude-a-MekWarLive';

/** A registry row plus the transcript the resolver will land on, plus the
 *  sidecar beside it — the real on-disk layout, not a stub. */
const seedFleet = (home: string, agentId: string, meta: string | null) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const workdir = `/data/projects/${ID}`;
  for (const [k, v] of Object.entries({
    wrapper: 'claude-a', project: ID, workdir, uuid: UUID, started: '1',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);

  writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
    v: 1, state: 'working', event: 'PostToolUse', sessionId: UUID, pid: 40613,
    updatedAt: Date.now(), ask: null,
    subagents: [{ name: 'workflow-subagent', startedAt: Date.now() - 5000, id: agentId }],
  }));

  // `<cfgDir>/projects/<munge(workdir)>/<uuid>.jsonl`, and the sidecar dir
  // beside it — the exact shape `sidecarDirFor` derives.
  const munged = workdir.replace(/[/._]/g, '-');
  const projDir = path.join(home, '.claude-a', 'projects', munged);
  mkdirSync(path.join(projDir, UUID, 'subagents'), { recursive: true });
  writeFileSync(path.join(projDir, `${UUID}.jsonl`), '{}\n');
  if (meta !== null) {
    writeFileSync(path.join(projDir, UUID, 'subagents', `agent-${agentId}.meta.json`), meta);
  }
  return { workdir };
};

const runner: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: 'done\n> \n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

const watcherFor = (home: string, io = localIO) => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const bus = new Bus();
  const frames: FleetSession[][] = [];
  bus.on('fleet', (s) => frames.push(s));
  const deps = { cfg, runCcd: async () => ({ ok: true as const, stdout: '', stderr: '' }),
    tmux: new Tmux(runner), io, queue: new KeyedQueue() };
  return { w: new FleetWatcher(deps as never, bus), frames };
};

const subsOf = (frames: FleetSession[][]) =>
  frames.at(-1)?.find((x) => x.id === ID)?.subagents ?? null;

describe('describeSubagents (the watcher join)', () => {
  it('puts the launch record’s description on the wire', async () => {
    const home = mkTmp('ccrc-join-');
    seedRoster(home);
    seedFleet(home, 'abc123', JSON.stringify({
      agentType: 'general-purpose', description: 'Inventory the provider',
    }));
    const { w, frames } = watcherFor(home);
    await w.tick();
    expect(subsOf(frames)).toEqual([
      { name: 'workflow-subagent', startedAt: expect.any(Number), description: 'Inventory the provider' },
    ]);
  });

  it('reads each agentId ONCE — the cache is the whole cost story', async () => {
    // A launch record describes an event that already happened and cannot
    // change, so steady state must be zero io. Collapse the cache into a
    // per-sweep map and this is two reads, then three, then N.
    const home = mkTmp('ccrc-join-');
    seedRoster(home);
    seedFleet(home, 'cache1', JSON.stringify({ description: 'Read once' }));
    const reads: string[] = [];
    const io: FleetIO = { ...localIO, readFile: async (p) => { reads.push(p); return localIO.readFile(p); } };
    const { w } = watcherFor(home, io);
    await w.tick();
    await w.tick();
    await w.tick();
    const metaReads = reads.filter((p) => p.endsWith('agent-cache1.meta.json'));
    expect(metaReads, 'three sweeps must cost one read').toHaveLength(1);
  });

  it('RETAINS a description when a later read fails — never blanks what is on screen', async () => {
    // The rule `sweepTasks` already follows. A dropped agent round trip must
    // not erase a fact the operator is looking at.
    const home = mkTmp('ccrc-join-');
    seedRoster(home);
    seedFleet(home, 'keep1', JSON.stringify({ description: 'Still here' }));
    let broken = false;
    const io: FleetIO = {
      ...localIO,
      readFile: async (p) => (broken && p.includes('subagents') ? null : localIO.readFile(p)),
    };
    const { w, frames } = watcherFor(home, io);
    await w.tick();
    expect(subsOf(frames)?.[0]?.description).toBe('Still here');
    broken = true;
    await w.tick();
    expect(subsOf(frames)?.[0]?.description, 'a failed read must not blank it').toBe('Still here');
  });

  it('gives up after a bounded number of misses, rather than reading forever', async () => {
    // A record that will never exist (an older Claude Code, a different
    // harness) must not cost one read per session per tick indefinitely.
    const home = mkTmp('ccrc-join-');
    seedRoster(home);
    seedFleet(home, 'missing1', null);
    const reads: string[] = [];
    const io: FleetIO = { ...localIO, readFile: async (p) => { reads.push(p); return localIO.readFile(p); } };
    const { w, frames } = watcherFor(home, io);
    for (let i = 0; i < 6; i++) await w.tick();
    const metaReads = reads.filter((p) => p.endsWith('agent-missing1.meta.json'));
    expect(metaReads.length, 'the miss budget must stop the reads').toBeLessThanOrEqual(3);
    // And the row still ships, described by its type.
    expect(subsOf(frames)?.[0]?.description).toBeNull();
  });

  it('a row with no id is never looked up at all', async () => {
    // `id` is null for every row an older hook wrote — there is nothing to
    // join on and no read to make.
    const home = mkTmp('ccrc-join-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    seedFleet(home, 'unused', JSON.stringify({ description: 'Never read' }));
    writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'working', event: 'PostToolUse', sessionId: UUID, pid: 40613,
      updatedAt: Date.now(), ask: null,
      subagents: [{ name: 'reviewer', startedAt: Date.now() - 5000 }],
    }));
    const reads: string[] = [];
    const io: FleetIO = { ...localIO, readFile: async (p) => { reads.push(p); return localIO.readFile(p); } };
    const { w, frames } = watcherFor(home, io);
    await w.tick();
    expect(reads.some((p) => p.includes('subagents'))).toBe(false);
    expect(subsOf(frames)?.[0]?.description).toBeNull();
  });
});
