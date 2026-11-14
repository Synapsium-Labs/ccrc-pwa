// `compactThresholdFor`'s oracle and mutant set (Overlord W1a launch profiles, Task 4: w1a-launch-profiles.md). Its cases
// are written ONCE here, as suite cases over a module: `continuity-launch-profile.test.ts` runs them against the real
// module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FLEET_ROLES, FLEET_ROLE_NAMES } from '../../../shared/fleetRoles.js';
import type { FleetRole, LaunchProfile } from '../../../shared/fleetRoles.js';
import type { RoleReading } from '../../src/roleOf.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type LaunchProfileModule = typeof import('../../src/continuity/launchProfile.js');
export type ProfileForModule = typeof import('../../src/continuity/profileFor.js');

const COORDINATOR = FLEET_ROLES.coordinator.launchProfile;
/** A profile with a large step above the cap, to reach the 95% ceiling (at 850,000 tokens the ceiling still fires in time). */
const STEEP: LaunchProfile = { ...COORDINATOR, compaction: { settings: { idleCompaction: false }, aboveHardCapPts: 66 } };
/** The windows where Claude Code, with the variable clamped to its range, still fires at or after the compact point:
 *  85,000 to 6,900,000 tokens, written out (review 2024 F4) so this oracle does not read the code it judges. */
const BAND_MIN = 85_000;
const BAND_MAX = 6_900_000;
/** Windows inside the band, odd ones included. */
const WINDOWS = [85_000, 100_000, 150_000, 199_999, 200_000, 333_333, 400_000, 500_000, 500_001, 520_833, 520_834,
  750_000, 1_000_000, 2_000_000, 6_900_000];
/** Windows outside it: each answers null. */
const OUTSIDE = [1_000, 50_000, 84_999, 6_900_001, 10_000_000, 12_000_000];
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
    'a role with no compaction column, an unmeasured window, or a window outside 85,000 to 6,900,000 answers null': () => {
      for (const r of FLEET_ROLE_NAMES.filter((x) => FLEET_ROLES[x].launchProfile.compaction === null)) {
        expect(m.compactThresholdFor(FLEET_ROLES[r].launchProfile, 1_000_000), r).toBeNull();
      }
      for (const w of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(m.compactThresholdFor(COORDINATOR, w), String(w)).toBeNull();
      for (const w of OUTSIDE) expect(m.compactThresholdFor(COORDINATOR, w), String(w)).toBeNull();
    },
    'the percent rounds up from the cap, then adds the points, never above 95': () => {
      for (const w of WINDOWS) {
        const t = m.compactThresholdFor(COORDINATOR, w)!;
        expect(t.pct, String(w)).toBe(Math.min(95, Math.ceil((100 * cap(w)) / w) + 10));
        const steep = m.compactThresholdFor(STEEP, w);
        if (steep !== null) expect(steep.pct, String(w)).toBeLessThanOrEqual(95);
      }
      expect(m.compactThresholdFor(STEEP, 850_000)).toStrictEqual({ pct: 95, windowTokens: 841_500 });
      expect(m.compactThresholdFor(COORDINATOR, 333_333)!.pct).toBe(60);
      expect(m.compactThresholdFor(COORDINATOR, 750_000)!.pct).toBe(44);
    },
    'the token window is the percent of the window rounded up, plus 34,000, clamped to 100,000 to 1,000,000': () => {
      for (const w of WINDOWS) {
        const t = m.compactThresholdFor(COORDINATOR, w)!;
        expect(t.windowTokens, String(w)).toBe(Math.min(1_000_000, Math.max(100_000, Math.ceil((t.pct * w) / 100) + 34_000)));
      }
      expect(m.compactThresholdFor(COORDINATOR, 100_000)!.windowTokens).toBe(100_000);
      expect(m.compactThresholdFor(COORDINATOR, 85_000)!.windowTokens).toBe(100_000);
      expect(m.compactThresholdFor(COORDINATOR, 6_900_000)!.windowTokens).toBe(1_000_000);
      expect(m.compactThresholdFor(COORDINATOR, 333_333)!.windowTokens).toBe(234_000);
      expect(m.compactThresholdFor(COORDINATOR, 750_000)!.windowTokens).toBe(364_000);
    },
    'from 1,000 to 12,000,000 tokens: monotonic in percent, and Claude Code fires above the hard cap and at or after the compact point, or no point is written (C39, reviews 1945 F2 and 2024 F4)': () => {
      let prev = Number.POSITIVE_INFINITY;
      for (let w = 1_000; w <= 12_000_000; w += 7_919) {
        const t = m.compactThresholdFor(COORDINATOR, w);
        const inBand = w >= BAND_MIN && w <= BAND_MAX;
        expect(t === null, `${w} answers null exactly outside the band`).toBe(!inBand);
        if (t === null) continue;
        expect(t.pct, String(w)).toBeLessThanOrEqual(prev);
        prev = t.pct;
        expect(t.windowTokens, String(w)).toBeGreaterThanOrEqual(100_000);
        expect(t.windowTokens, String(w)).toBeLessThanOrEqual(1_000_000);
        expect(firesAt(t.windowTokens, w), String(w)).toBeGreaterThan(cap(w));
        expect(firesAt(t.windowTokens, w), String(w)).toBeGreaterThanOrEqual(Math.ceil((t.pct * w) / 100));
      }
      // The 200k window review 1945 named: the plan's 120,000 fired near 87,000, under the 100,000 hard cap.
      expect(firesAt(m.compactThresholdFor(COORDINATOR, 200_000)!.windowTokens, 200_000)).toBeGreaterThan(100_000);
    },
  };
}

/** `compactThresholdFor`'s mutants (the plan's four, two more on the clamp, two on Claude Code's buffer: review 1945 F2, and
 *  two on the band: review 2024 F4). */
const COMPACT_THRESHOLD_SET: MutantSet<LaunchProfileModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/launchProfile.ts'),
  mutants: [
    { id: 'T1', old: 'Math.ceil((100 * hardCapTokens(windowTokens)) / windowTokens)', new: 'Math.floor((100 * hardCapTokens(windowTokens)) / windowTokens)' },
    { id: 'T2', old: 'const pct = Math.min(COMPACT_PCT_MAX,\n    Math.ceil(', new: 'const pct = Math.min(Infinity,\n    Math.ceil(' },
    { id: 'T3', old: ' || windowTokens <= 0) return null;', new: ') return null;' },
    { id: 'T4', old: '/ windowTokens) + profile.compaction.aboveHardCapPts);', new: '/ windowTokens) + 2 * profile.compaction.aboveHardCapPts);' },
    { id: 'T5', old: 'Math.min(COMPACT_WINDOW_MAX_TOKENS, Math.max(COMPACT_WINDOW_MIN_TOKENS, point + AUTO_COMPACT_BUFFER_TOKENS))', new: 'Math.max(COMPACT_WINDOW_MIN_TOKENS, point + AUTO_COMPACT_BUFFER_TOKENS)' },
    { id: 'T6', old: 'Math.min(COMPACT_WINDOW_MAX_TOKENS, Math.max(COMPACT_WINDOW_MIN_TOKENS, point + AUTO_COMPACT_BUFFER_TOKENS))', new: 'Math.min(COMPACT_WINDOW_MAX_TOKENS, point + AUTO_COMPACT_BUFFER_TOKENS)' },
    { id: 'T7', old: 'const point = Math.ceil((pct * windowTokens) / 100);', new: 'const point = Math.floor((pct * windowTokens) / 100);' },
    { id: 'T9', old: 'point + AUTO_COMPACT_BUFFER_TOKENS));', new: 'point));' },
    { id: 'T10', old: 'export const AUTO_COMPACT_BUFFER_TOKENS = 34_000;', new: 'export const AUTO_COMPACT_BUFFER_TOKENS = 33_000;' },
    { id: 'T8', old: 'if (profile.compaction === null ||', new: 'if (' },
    { id: 'T11', old: 'if (Math.min(tokens, windowTokens) - AUTO_COMPACT_BUFFER_TOKENS < point) return null;', new: '' },
    { id: 'T12', old: 'if (Math.min(tokens, windowTokens) - AUTO_COMPACT_BUFFER_TOKENS < point)', new: 'if (tokens - AUTO_COMPACT_BUFFER_TOKENS < point)' },
  ],
  suite: compactThresholdCases,
};

/** The nine role readings `roleOf` can answer: each role, and the two undecided pairs. */
const READINGS: readonly RoleReading[] = [
  ...FLEET_ROLE_NAMES.map((role): RoleReading => ({ kind: 'role', role })),
  { kind: 'undecided', between: 'worker-or-reviewer' },
  { kind: 'undecided', between: 'coordinator-or-plain' },
];
/** The member each undecided reading takes, written out (C49: the member that does less). */
const LESS: Readonly<Record<string, FleetRole>> = { 'worker-or-reviewer': 'worker', 'coordinator-or-plain': 'plain' };
/** The roles whose profile has compaction, written out (Task 1's rows). */
const LONG_LIVED: readonly FleetRole[] = ['overlord', 'coordinator'];
/** The compaction fields each window answers for a long-lived role, written out from the threshold cases above. */
const COMPACT_AT: ReadonlyMap<number | null, { compact: number; compactwindow: number } | null> = new Map([
  [null, null], [200_000, { compact: 60, compactwindow: 154_000 }], [1_000_000, { compact: 35, compactwindow: 384_000 }],
]);

export function profileForCases(m: ProfileForModule): Record<string, SuiteCase> {
  return {
    'exhaustive: nine readings x two memory choices x three windows x continuity live or not (Task 5)': () => {
      for (const reading of READINGS) {
        const role = reading.kind === 'role' ? reading.role : LESS[reading.between]!;
        for (const mem of ['on', 'off'] as const) {
          for (const [w, at] of COMPACT_AT) {
            for (const continuityLive of [false, true]) {
              const label = `${JSON.stringify(reading)} ${mem} ${w} ${continuityLive}`;
              const compact = continuityLive && LONG_LIVED.includes(role) ? at : null;
              expect(m.profileFor(reading, mem, w, continuityLive), label).toStrictEqual({
                profile: role, automem: role === 'plain' ? mem : 'off',
                compact: compact === null ? null : compact.compact, compactwindow: compact === null ? null : compact.compactwindow,
              });
            }
          }
        }
      }
    },
    'with continuity in shadow, no role gets a compaction field, whatever its window (compaction-follows-continuity)': () => {
      for (const reading of READINGS) {
        for (const w of [100_000, 200_000, 1_000_000]) {
          const r = m.profileFor(reading, 'on', w, false);
          expect([r.compact, r.compactwindow], JSON.stringify(reading)).toStrictEqual([null, null]);
        }
      }
    },
    'an undecided reading takes the member that does less: worker, and plain (C49)': () => {
      expect(m.profileFor({ kind: 'undecided', between: 'coordinator-or-plain' }, 'on', 1_000_000, true))
        .toStrictEqual({ profile: 'plain', automem: 'on', compact: null, compactwindow: null });
      expect(m.profileFor({ kind: 'undecided', between: 'worker-or-reviewer' }, 'on', 1_000_000, true))
        .toStrictEqual({ profile: 'worker', automem: 'off', compact: null, compactwindow: null });
    },
    'the Settings row: a lost row is off (H14), a failed read or an unknown word is null': () => {
      expect(m.plainAutoMemoryOf({ kind: 'absent' })).toBe('off');
      expect(m.plainAutoMemoryOf({ kind: 'row', choice: 'on' })).toBe('on');
      expect(m.plainAutoMemoryOf({ kind: 'row', choice: 'off' })).toBe('off');
      for (const choice of ['ON', 'yes', '', null, 1]) expect(m.plainAutoMemoryOf({ kind: 'row', choice }), String(choice)).toBeNull();
      expect(m.plainAutoMemoryOf({ kind: 'unreadable', detail: 'x' })).toBeNull();
    },
  };
}

/** `profileFor`'s mutants: the plan's three (ignore the memory value; give `plain` the long-lived profile; answer the
 *  other member for an undecided reading) and one more on `continuityLive`. */
const PROFILE_FOR_SET: MutantSet<ProfileForModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/profileFor.ts'),
  mutants: [
    { id: 'P1', old: "const automem = row.autoMemory === 'switch' ? plainAutoMemory : 'off';", new: "const automem = row.autoMemory === 'switch' ? 'off' : 'off';" },
    { id: 'P2', old: "const row = FLEET_ROLES[profile].launchProfile;", new: "const row = FLEET_ROLES[profile === 'plain' ? 'coordinator' : profile].launchProfile;" },
    { id: 'P3', old: "  'coordinator-or-plain': 'plain',\n};", new: "  'coordinator-or-plain': 'coordinator',\n};" },
    { id: 'P4', old: 'const t = continuityLive ? compactThresholdFor(row, windowTokens) : null;', new: 'const t = compactThresholdFor(row, windowTokens);' },
    { id: 'P5', old: "  'worker-or-reviewer': 'worker',", new: "  'worker-or-reviewer': 'reviewer'," },
  ],
  suite: profileForCases,
};

/** `plainAutoMemoryOf`'s mutants: a lost row read as on, a failed read read as the default, an unknown word let through. */
const PLAIN_AUTO_MEMORY_SET: MutantSet<ProfileForModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/profileFor.ts'),
  mutants: [
    { id: 'M1', old: "if (r.kind === 'absent') return PLAIN_AUTO_MEMORY_DEFAULT;", new: "if (r.kind === 'absent') return 'on';" },
    { id: 'M2', old: "if (r.kind === 'unreadable') return null;", new: "if (r.kind === 'unreadable') return PLAIN_AUTO_MEMORY_DEFAULT;" },
    { id: 'M3', old: 'return isPlainAutoMemoryChoice(r.choice) ? r.choice : null;', new: 'return r.choice as PlainAutoMemoryChoice;' },
  ],
  suite: profileForCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const LAUNCH_PROFILE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/launchProfile.ts#compactThresholdFor': COMPACT_THRESHOLD_SET as MutantSet<never>,
  'server/src/continuity/profileFor.ts#profileFor': PROFILE_FOR_SET as MutantSet<never>,
  'server/src/continuity/profileFor.ts#plainAutoMemoryOf': PLAIN_AUTO_MEMORY_SET as MutantSet<never>,
};
