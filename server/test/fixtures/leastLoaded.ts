// One definition of the account-routing cases, consumed by BOTH implementations
// of the "where does a new workspace land?" rule: ccd's `_ws_least_loaded`
// (bash, the authority that actually assigns `home`) and the server's
// `projectHome` (TypeScript, which only PREDICTS it for the PWA's `+`).
//
// The spec's warning is the whole reason this file exists: "Two implementations
// of one rule drift; that is what they do." They cannot share code across the
// language boundary, so they share FIXTURES — exactly as rollover.ts already
// does for the limits reader. If either side drifts, projected-home.test.ts
// goes red.
//
// Expressed as a function of `now` because the two cannot share a clock:
// readLimits takes an injectable now, ccd's _limit_field calls `date +%s`.
export interface LeastLoadedCase {
  name: string;
  /** Per-wrapper file bytes under ~/.cc-limits. An ABSENT key means no file at
   *  all — which both sides must read as UNKNOWN, and unknown now ranks below
   *  every measured account instead of scoring 0 and beating them all (Stage
   *  2a, Task 6: `projectHome`'s `measured()` and `_ws_least_loaded`'s
   *  `[[ -z "$sc" ]] && continue`). Unknown is still not unplaceable: when NO
   *  account is measured, both sides fall back to the first home-able one at
   *  score 0 — see the `projectHome edge cases` describe in the runner. */
  files: Record<string, string>;
  /** Wrappers carrying a `<w>-disabled` marker (ccd's `$REG`, the server's
   *  registryDir — same directory, same filename, on purpose: it is the one
   *  file both implementations already read). Omitted/empty means no lane is
   *  declared off. */
  disabled?: string[];
  /** `null` iff every home-able lane is disabled — nothing is placeable, and
   *  both sides must say so in their own idiom (see the runner). */
  expect: { wrapper: string; score: number } | null;
  why: string;
}

/** Compact, the way statusline-command.sh's printf writes the Anthropic accounts. */
const c = (o: Record<string, number | null>): string => JSON.stringify(o);

export function leastLoadedCases(now: number): LeastLoadedCase[] {
  const fresh = (five: number, seven: number): string =>
    c({ five, seven, ts: now - 60, fiveResetAt: now + 9000, sevenResetAt: now + 400000 });

  return [
    {
      name: 'plain',
      files: { claude: fresh(80, 40), claude2: fresh(5, 3), 'claude-corp': fresh(90, 95), 'claude-dev0': fresh(85, 45) },
      expect: { wrapper: 'claude2', score: 5 },
      why: 'the cheapest account wins, not the first one listed',
    },
    {
      name: 'seven-dominates',
      files: { claude: fresh(10, 90), claude2: fresh(50, 50), 'claude-corp': fresh(60, 20), 'claude-dev0': fresh(70, 70) },
      expect: { wrapper: 'claude2', score: 50 },
      why: 'score is max(5h, 7d) — a free 5h window over an exhausted week is not headroom',
    },
    {
      name: 'all-pinned',
      files: { claude: fresh(100, 100), claude2: fresh(99, 100), 'claude-corp': fresh(98, 99), 'claude-dev0': fresh(100, 100) },
      expect: { wrapper: 'claude-corp', score: 99 },
      why: '_ws_least_loaded does NOT apply _avail/SWAP_CEILING: it returns the minimum '
        + 'even when every account is pinned. The headroom display is what warns the user',
    },
    {
      // THE placement magnet, in both languages. `claude-corp` and
      // `claude-dev0` have no telemetry file at all; before Task 6 both sides
      // scored them 0 and handed the workspace to `claude-corp`, beating two
      // accounts that had honestly reported 70 and 60. The account nobody could
      // see was simply the emptiest-looking one.
      name: 'missing-file',
      files: { claude: fresh(70, 70), claude2: fresh(60, 60) },
      expect: { wrapper: 'claude2', score: 60 },
      why: 'no telemetry file at all reads as unknown, and unknown ranks BELOW every '
        + 'measured account — the cheapest MEASURED account wins, not the one nobody '
        + 'has ever measured',
    },
    {
      name: 'tie',
      files: { claude: fresh(50, 50), claude2: fresh(50, 50), 'claude-corp': fresh(50, 50), 'claude-dev0': fresh(50, 50) },
      expect: { wrapper: 'claude', score: 50 },
      why: 'a tie goes to the earlier wrapper — bash compares strictly less-than',
    },
    {
      name: 'gpt-is-cheapest',
      files: {
        claude: fresh(70, 70), claude2: fresh(75, 75), 'claude-corp': fresh(60, 60),
        'claude-dev0': fresh(65, 65),
        gpt: c({ five: null, seven: 0, ts: now - 60, fiveResetAt: null, sevenResetAt: now + 400000 }),
      },
      expect: { wrapper: 'claude-corp', score: 60 },
      why: 'gpt is a 4th lane, opt-in only (ccd:11-16) and absent from VALID_WRAPPERS — '
        + 'it must never win, however free it looks',
    },
    {
      name: 'disabled-lane-skipped',
      files: { claude: fresh(50, 40), claude2: fresh(5, 3), 'claude-corp': fresh(90, 95), 'claude-dev0': fresh(60, 60) },
      disabled: ['claude2'],
      expect: { wrapper: 'claude', score: 50 },
      why: 'claude2 is cheapest but declared off — the runner-up wins, not the '
        + 'account nobody can actually place a session on',
    },
    {
      name: 'all-disabled',
      files: { claude: fresh(50, 40), claude2: fresh(5, 3), 'claude-corp': fresh(90, 95), 'claude-dev0': fresh(60, 60) },
      disabled: ['claude', 'claude2', 'claude-corp', 'claude-dev0'],
      expect: null,
      why: 'every home-able lane declared off: nothing is placeable, and both '
        + 'sides must admit it rather than name an account that cannot take work',
    },
    {
      name: 'disabled-lane-no-telemetry',
      // claude2 is markered off but has NEVER written a limits file — a fresh
      // `touch claude2-disabled`, or a lane that's never had a session on it.
      // No `claude2` key in `files` at all (an absent file, not an empty one).
      files: { claude: fresh(50, 40), 'claude-corp': fresh(90, 95), 'claude-dev0': fresh(60, 60) },
      disabled: ['claude2'],
      expect: { wrapper: 'claude', score: 50 },
      why: 'a markered lane with no telemetry file is still excluded — absent-from-map '
        + 'must not be mistaken for unknown-and-therefore-free, or the account that has '
        + 'never even run scores 0 and wins the very projection the marker forbids',
    },
    {
      name: 'all-disabled-no-telemetry',
      // Fresh box, or every lane markered before any of them ever wrote a
      // limits file: `.cc-limits` is empty, `disabled` names all three anyway.
      files: {},
      disabled: ['claude', 'claude2', 'claude-corp', 'claude-dev0'],
      expect: null,
      why: 'no telemetry anywhere AND every lane declared off: still null, not the '
        + 'empty-directory tie-goes-to-claude case — declared-off overrides unknown-is-free',
    },
    {
      name: 'rolled-over-window',
      files: {
        // claude reads 98 on a week that already reset — the 2026-07-27 shape.
        claude: c({ five: 10, seven: 98, ts: now - 72000, fiveResetAt: now - 72000, sevenResetAt: now - 50000 }),
        claude2: fresh(10, 10),
        'claude-corp': fresh(40, 40),
        'claude-dev0': fresh(20, 20),
      },
      expect: { wrapper: 'claude', score: 0 },
      why: 'both sides apply the rollover rule before scoring, so a reset window frees '
        + 'the account rather than excluding it for another six days',
    },
  ];
}
