// server/test/unattended-actor.test.ts
//
// Wave 6's headline sentence: "archiveMerged's timer and a human's ws-rm stop
// being byte-identical." The `--surface` word alone cannot carry that — the
// closed set has four members and none of them means "a server sweep" — so the
// distinguisher is the ACTOR, and that is why `ActorFlags.actor` is not
// optional. This file pins that every unattended lane names itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR_FLAGS_CAP, CCD_ARGV, sweepDec } from '../src/ccdargv.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const NEW = { ccdVerbs: [ACTOR_FLAGS_CAP] };
const FILES = ['watch.ts', 'coord/close.ts', 'coord/dispatch.ts', 'coord/routes.ts'];
const BUILDERS = /CCD_ARGV\.(wsArchive|wsRestore|wsHold|wsRelease|wsRename)\(/;

describe('sweepDec', () => {
  it('declares the agent lane and names the sweep', () => {
    expect(sweepDec(NEW, 'sweep:archive-merged'))
      .toEqual({ surface: 'agent', actor: 'sweep:archive-merged', reason: null });
  });

  it('is null on no evidence, exactly as the human lane is', () => {
    expect(sweepDec({ ccdVerbs: null }, 'sweep:names')).toBeNull();
    expect(sweepDec(undefined, 'sweep:names')).toBeNull();
    expect(sweepDec({ ccdVerbs: ['ws-rename'] }, 'sweep:names')).toBeNull();
  });

  it('builds an argv whose actor survives to the flags', () => {
    expect(CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', sweepDec(NEW, 'sweep:names')))
      .toEqual(['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/x',
                '--surface', 'agent', '--actor', 'sweep:names']);
  });
});

describe('every unattended ccd call site names itself', () => {
  it('leaves no hand-written `null` dec at a site that has a lane to declare', () => {
    // A source scan, and the reason is that the alternative pins nothing: a
    // sweep threaded with `null` compiles, runs, and records exactly what the
    // pre-wave build recorded — a byte-identical act with no way to tell whose
    // it was, which is the defect this wave exists to remove. The `null`s that
    // remain are the CAPABILITY answer (`sweepDec`/`pwaDec` return it), never a
    // hand-written one. The window is three lines because two of these call
    // sites already wrap (`close.ts:181-183`).
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(path.join(srcRoot, f), 'utf8').split('\n');
      src.forEach((line, i) => {
        if (!BUILDERS.test(line)) return;
        if (/,\s*null\s*\)/.test(src.slice(i, i + 3).join('\n'))) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `these unattended sites record nothing about who acted: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('found the call sites at all — a scan over nothing passes everything', () => {
    let n = 0;
    for (const f of FILES) {
      n += readFileSync(path.join(srcRoot, f), 'utf8').split('\n')
        .filter((l) => BUILDERS.test(l)).length;
    }
    expect(n, 'the scan matched no unattended ccd call site at all').toBeGreaterThanOrEqual(10);
  });
});
