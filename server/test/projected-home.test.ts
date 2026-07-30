// The spec requires the `+` to show "the account it is about to assign and its
// current headroom" BEFORE the tap, because "a workspace that silently lands on
// an exhausted account presents as a stalled session with no explanation".
//
// The routing rule itself is `_ws_least_loaded` (ccd:132-140) — bash, and the
// authority: it is what actually writes `home`. `projectHome` only PREDICTS it
// for the display. Two implementations of one rule drift, so this file drives
// BOTH over identical fixtures and demands they agree on the wrapper AND the
// score, the way ccd-limits.test.ts does for the rollover rule.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readLimits, projectHome } from '../src/limits.js';
import { leastLoadedCases } from './fixtures/leastLoaded.js';
import { mkTmp } from './tmpHelpers.js';

const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');
let home: string;

/** ccd reads the clock itself, so fixtures live against real now. */
const now = (): number => Math.floor(Date.now() / 1000);

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();

beforeEach(() => {
  home = mkTmp('ccrc-projected-');
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp', 'gpt']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const seed = (files: Record<string, string>): void => {
  for (const name of fs.readdirSync(path.join(home, '.cc-limits'))) {
    fs.rmSync(path.join(home, '.cc-limits', name));
  }
  for (const [wrapper, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(home, '.cc-limits', `${wrapper}.json`), content);
  }
};

/** _limit_score says "wholly unknown" with an empty string; projectHome says it
 *  with 0, because _ws_least_loaded's own `[[ -z "$sc" ]] && sc=0` does. */
const shellScore = (wrapper: string): number => Number(sh(`_limit_score ${wrapper}`) || '0');

describe('projectHome agrees with ccd _ws_least_loaded', () => {
  it.each(leastLoadedCases(now()).map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      seed(c.files);
      const cfg = loadConfig({ CCRC_HOME: home });
      const projected = projectHome(await readLimits(localIO, cfg));

      // 1. The prediction is right in its own terms.
      expect(projected, c.why).toEqual(c.expect);
      // 2. …and bash, the authority, picks the same account.
      expect(sh('_ws_least_loaded'), `ccd disagrees: ${c.why}`).toBe(c.expect.wrapper);
      // 3. …and scores it the same, so the headroom the user reads is the
      //    headroom the account really has.
      expect(shellScore(c.expect.wrapper), `score drift: ${c.why}`).toBe(c.expect.score);
    },
  );
});

describe('projectHome edge cases', () => {
  it('projects claude at full headroom when there is no telemetry at all', () => {
    // First boot, or a limits dir nothing has written yet. Every account scores
    // 0, and the tie rule hands it to the first home-able wrapper — which is
    // exactly what ccd does with the same empty directory.
    expect(projectHome({})).toEqual({ wrapper: 'claude', score: 0 });
    expect(sh('_ws_least_loaded')).toBe('claude');
  });
});
