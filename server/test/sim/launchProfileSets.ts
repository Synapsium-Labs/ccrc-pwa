// `compactThresholdFor`'s oracle and mutant set (Overlord W1a launch profiles, Task 4: w1a-launch-profiles.md). Its cases
// are written ONCE here, as suite cases over a module: `continuity-launch-profile.test.ts` runs them against the real
// module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FLEET_ROLES, FLEET_ROLE_NAMES } from '../../../shared/fleetRoles.js';
import type { LaunchProfile } from '../../../shared/fleetRoles.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type LaunchProfileModule = typeof import('../../src/continuity/launchProfile.js');

const COORDINATOR = FLEET_ROLES.coordinator.launchProfile;
/** A profile with a large step above the cap, to reach the 95% ceiling. */
const STEEP: LaunchProfile = { ...COORDINATOR, compaction: { settings: { idleCompaction: false }, aboveHardCapPts: 60 } };
/** Windows from below the variable's floor to above its ceiling, odd ones included. */
const WINDOWS = [50_000, 100_000, 150_000, 199_999, 200_000, 333_333, 400_000, 500_000, 500_001, 520_833, 520_834,
  750_000, 1_000_000, 2_000_000, 10_000_000];
/** The hard cap, written out (Table 3.3.11b) so this oracle does not read the code it judges. */
const cap = (w: number): number => Math.min(250_000, w / 2);
/** How far below `CLAUDE_CODE_AUTO_COMPACT_WINDOW` Claude Code fires its auto-compaction, at most: measured between 33,000
 *  and 33,500 tokens on 2.1.325 in the W0 rig, with the variable at 120,000 and at 200,000 (review 1945 F2; the departure
 *  `compact-window-carries-the-buffer`). Written out, so this oracle does not read the code's constant. */
const BUFFER_MEASURED_MAX = 33_500;
/** Where Claude Code fires on a window `w` with the variable at `v`: the variable never widens the model's own window. */
const firesAt = (v: number, w: number): number => Math.min(v, w) - BUFFER_MEASURED_MAX;

export function compactThresholdCases(m: LaunchProfileModule): Record<string, SuiteCase> {
  return {
    "the plan's examples, plus Claude Code's 34,000-token buffer: 1M is 35%, 384,000; 200k is 60%, 154,000; 400k is 60%, 274,000": () => {
      expect(m.compactThresholdFor(COORDINATOR, 1_000_000)).toStrictEqual({ pct: 35, windowTokens: 384_000 });
      expect(m.compactThresholdFor(COORDINATOR, 200_000)).toStrictEqual({ pct: 60, windowTokens: 154_000 });
      expect(m.compactThresholdFor(COORDINATOR, 400_000)).toStrictEqual({ pct: 60, windowTokens: 274_000 });
    },
    'a role with no compaction column, or an unmeasured window, answers null': () => {
      for (const r of FLEET_ROLE_NAMES.filter((x) => FLEET_ROLES[x].launchProfile.compaction === null)) {
        expect(m.compactThresholdFor(FLEET_ROLES[r].launchProfile, 1_000_000), r).toBeNull();
      }
      for (const w of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(m.compactThresholdFor(COORDINATOR, w), String(w)).toBeNull();
    },
    'the percent rounds up from the cap, then adds the points, never above 95': () => {
      for (const w of WINDOWS) {
        const t = m.compactThresholdFor(COORDINATOR, w)!;
        expect(t.pct, String(w)).toBe(Math.min(95, Math.ceil((100 * cap(w)) / w) + 10));
        expect(m.compactThresholdFor(STEEP, w)!.pct, String(w)).toBeLessThanOrEqual(95);
      }
      expect(m.compactThresholdFor(STEEP, 200_000)!.pct).toBe(95);
      expect(m.compactThresholdFor(COORDINATOR, 333_333)!.pct).toBe(60);
      expect(m.compactThresholdFor(COORDINATOR, 750_000)!.pct).toBe(44);
    },
    'the token window is the percent of the window rounded up, plus 34,000, clamped to 100,000 to 1,000,000': () => {
      for (const w of WINDOWS) {
        const t = m.compactThresholdFor(COORDINATOR, w)!;
        expect(t.windowTokens, String(w)).toBe(Math.min(1_000_000, Math.max(100_000, Math.ceil((t.pct * w) / 100) + 34_000)));
      }
      expect(m.compactThresholdFor(COORDINATOR, 100_000)!.windowTokens).toBe(100_000);
      expect(m.compactThresholdFor(COORDINATOR, 10_000_000)!.windowTokens).toBe(1_000_000);
      expect(m.compactThresholdFor(COORDINATOR, 333_333)!.windowTokens).toBe(234_000);
      expect(m.compactThresholdFor(COORDINATOR, 750_000)!.windowTokens).toBe(364_000);
    },
    'monotonic: the percent never rises as the window grows, and Claude Code fires above the hard cap (C39, review 1945 F2)': () => {
      let prev = Number.POSITIVE_INFINITY;
      for (let w = 100_000; w <= 3_000_000; w += 7_919) {
        const t = m.compactThresholdFor(COORDINATOR, w)!;
        expect(t.pct, String(w)).toBeLessThanOrEqual(prev);
        prev = t.pct;
        expect(firesAt(t.windowTokens, w), String(w)).toBeGreaterThan(cap(w));
        expect(firesAt(t.windowTokens, w), String(w)).toBeGreaterThanOrEqual(Math.min(Math.ceil((t.pct * w) / 100), w - BUFFER_MEASURED_MAX));
      }
      // The 200k window the review named: the plan's 120,000 fired near 87,000, under the 100,000 hard cap.
      expect(firesAt(m.compactThresholdFor(COORDINATOR, 200_000)!.windowTokens, 200_000)).toBeGreaterThan(100_000);
    },
  };
}

/** `compactThresholdFor`'s mutants (the plan's four, two more on the clamp, and two on Claude Code's buffer: review 1945 F2). */
const COMPACT_THRESHOLD_SET: MutantSet<LaunchProfileModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/launchProfile.ts'),
  mutants: [
    { id: 'T1', old: 'Math.ceil((100 * hardCapTokens(windowTokens)) / windowTokens)', new: 'Math.floor((100 * hardCapTokens(windowTokens)) / windowTokens)' },
    { id: 'T2', old: 'const pct = Math.min(COMPACT_PCT_MAX,\n    Math.ceil(', new: 'const pct = Math.min(Infinity,\n    Math.ceil(' },
    { id: 'T3', old: ' || windowTokens <= 0) return null;', new: ') return null;' },
    { id: 'T4', old: '/ windowTokens) + profile.compaction.aboveHardCapPts);', new: '/ windowTokens) + 2 * profile.compaction.aboveHardCapPts);' },
    { id: 'T5', old: 'Math.min(COMPACT_WINDOW_MAX_TOKENS, Math.max(COMPACT_WINDOW_MIN_TOKENS, tokens))', new: 'Math.max(COMPACT_WINDOW_MIN_TOKENS, tokens)' },
    { id: 'T6', old: 'Math.min(COMPACT_WINDOW_MAX_TOKENS, Math.max(COMPACT_WINDOW_MIN_TOKENS, tokens))', new: 'Math.min(COMPACT_WINDOW_MAX_TOKENS, tokens)' },
    { id: 'T7', old: 'const tokens = Math.ceil((pct * windowTokens) / 100) +', new: 'const tokens = Math.floor((pct * windowTokens) / 100) +' },
    { id: 'T9', old: '/ 100) + AUTO_COMPACT_BUFFER_TOKENS;', new: '/ 100);' },
    { id: 'T10', old: 'export const AUTO_COMPACT_BUFFER_TOKENS = 34_000;', new: 'export const AUTO_COMPACT_BUFFER_TOKENS = 33_000;' },
    { id: 'T8', old: 'if (profile.compaction === null ||', new: 'if (' },
  ],
  suite: compactThresholdCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const LAUNCH_PROFILE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/launchProfile.ts#compactThresholdFor': COMPACT_THRESHOLD_SET as MutantSet<never>,
};
