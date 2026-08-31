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
