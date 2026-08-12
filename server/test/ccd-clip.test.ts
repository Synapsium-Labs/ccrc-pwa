// The Mac hotkey lane. `ccd clip` still types the path — correct for a terminal —
// but it used to name every destination .png regardless of the real format, and
// its one-second stamp let two clips in the same second overwrite each other.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CCD, ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

let isolatedHome: string;

beforeEach(() => {
  // Create an isolated HOME directory so sourcing ccd does not touch the real home.
  // ccd has file-scope setup (mkdir -p "$REG" with REG="$HOME/.cc-sessions") that
  // runs even when guarded by BASH_SOURCE[0] == $0. The guard only wraps the dispatch case.
  // Use os.tmpdir() to keep temp directories out of the repo.
  isolatedHome = mkTmp('ccrc-ccd-home-');
  // That file-scope setup now includes sourcing `~/.ccrc/accounts.sh`, which is
  // fatal when absent — so an isolated HOME has to carry a roster before ccd
  // will get as far as defining `_clip_dest`.
  seedAccountsSh(isolatedHome);
});

afterEach(() => {
  // Clean up the isolated HOME directory after each test.
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});

const dest = (src: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; _clip_dest /tmp/clips "${src}"`],
    // See ccd-limits.test.ts: the gh boundary belongs to every file that
    // sources ccd, not only to the ones using `makeCcdHarness`.
    { encoding: 'utf8', env: ghContainedEnv(isolatedHome, { ...process.env, HOME: isolatedHome }) }).trim();

describe('_clip_dest', () => {
  it('keeps the source extension instead of calling everything .png', () => {
    expect(dest('/tmp/photo.jpg')).toMatch(/\.jpg$/);
    expect(dest('/tmp/shot.PNG')).toMatch(/\.png$/);
  });

  it('does not collide for two clips filed in the same second', () => {
    expect(dest('/tmp/a.png')).not.toBe(dest('/tmp/a.png'));
  });

  it('uses isolated HOME and produces 8-hex-digit suffix', () => {
    // Verify the isolated HOME is used and not the real home.
    const clip = dest('/tmp/test.png');
    expect(clip).toMatch(/^\/tmp\/clips\/clip-\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
    // The real home should not have been touched.
    const realHomeClipsDir = path.join(process.env.HOME || '', '.cc-clips');
    if (fs.existsSync(realHomeClipsDir)) {
      // If .cc-clips exists, it should be empty or created by another process.
      // The test should not have created any subdirectories in it.
      expect(fs.readdirSync(realHomeClipsDir)).not.toContain('test');
    }
  });
});
