// Fix round 3 (task 14 follow-up, Important #3): local mode's own evidence
// for `stopSurfaceSupported` — see `localcaps.ts`'s own comment for why this
// exists. Uses the REAL `realRunner` (a real `execFile`, not a stub
// callback) against a real, executable stub script on disk — the same
// idiom `agent/test/caps.test.ts` uses for the remote side, so this proves
// the actual exec mechanism, not just the string-parsing half.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { realRunner } from '../src/exec.js';
import { readLocalCcdCaps } from '../src/localcaps.js';
import { mkTmp } from './tmpHelpers.js';

const writeStubCcd = (home: string, body: string): string => {
  const dir = path.join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};

describe('readLocalCcdCaps', () => {
  it('parses a real exec of a new-shaped ccd — stop-surface present', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'echo start\necho stop\necho stop-surface\nexit 0');
    expect(await readLocalCcdCaps(realRunner, ccdBin)).toEqual(['start', 'stop', 'stop-surface']);
  });

  it('parses a real exec of an old-shaped ccd — stop-surface absent', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'echo start\necho stop\nexit 0');
    expect(await readLocalCcdCaps(realRunner, ccdBin)).toEqual(['start', 'stop']);
  });

  it('answers null, not [], on a nonzero exit — no evidence is not zero capabilities', async () => {
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, 'echo start\nexit 1');
    expect(await readLocalCcdCaps(realRunner, ccdBin)).toBeNull();
  });

  it('answers null on a missing binary, rather than throwing', async () => {
    const home = mkTmp('ccrc-localcaps-');
    expect(await readLocalCcdCaps(realRunner, path.join(home, 'no-such-ccd'))).toBeNull();
  });

  it('drops a line that is not verb-shaped, exactly like the agent-side reader does', async () => {
    // Same regex, same parser (`parseCcdCaps`, shared/agent-protocol.ts) —
    // proven here with a line no real ccd would print, to show the filter
    // is real and not just "whatever ccd happens to emit".
    const home = mkTmp('ccrc-localcaps-');
    const ccdBin = writeStubCcd(home, "echo start\necho 'not a verb!'\necho stop");
    expect(await readLocalCcdCaps(realRunner, ccdBin)).toEqual(['start', 'stop']);
  });
});
