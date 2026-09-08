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
  /** Wrappers carrying a `<w>-authdead` marker — the account-health probe's
   *  verdict, in the same registry directory as `-disabled` and read on the same
   *  `readdir`. It ranks an account out of SCORING on both sides, and out of
   *  neither side's fallback: ccd assigns `first` BEFORE its skip, so the TS
   *  must drop the account from `scored` and leave `live`/`scorable[0]` alone.
   *  Omitted/empty means nothing is condemned. */
  authDead?: string[];
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
      files: { claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(90, 95), 'claude-d': fresh(85, 45) },
      expect: { wrapper: 'claude-a', score: 5 },
      why: 'the cheapest account wins, not the first one listed',
    },
    {
      name: 'seven-dominates',
      files: { claude: fresh(10, 90), 'claude-a': fresh(50, 50), 'claude-b': fresh(60, 20), 'claude-d': fresh(70, 70) },
      expect: { wrapper: 'claude-a', score: 50 },
      why: 'score is max(5h, 7d) — a free 5h window over an exhausted week is not headroom',
    },
    {
      name: 'all-pinned',
      files: { claude: fresh(100, 100), 'claude-a': fresh(99, 100), 'claude-b': fresh(98, 99), 'claude-d': fresh(100, 100) },
      expect: { wrapper: 'claude-b', score: 99 },
      why: '_ws_least_loaded does NOT apply _avail/SWAP_CEILING: it returns the minimum '
        + 'even when every account is pinned. The headroom display is what warns the user',
    },
    {
      // THE placement magnet, in both languages. `claude-b` and
      // `claude-d` have no telemetry file at all; before Task 6 both sides
      // scored them 0 and handed the workspace to `claude-b`, beating two
      // accounts that had honestly reported 70 and 60. The account nobody could
      // see was simply the emptiest-looking one.
      name: 'missing-file',
      files: { claude: fresh(70, 70), 'claude-a': fresh(60, 60) },
      expect: { wrapper: 'claude-a', score: 60 },
      why: 'no telemetry file at all reads as unknown, and unknown ranks BELOW every '
        + 'measured account — the cheapest MEASURED account wins, not the one nobody '
        + 'has ever measured',
    },
    {
      name: 'tie',
      files: { claude: fresh(50, 50), 'claude-a': fresh(50, 50), 'claude-b': fresh(50, 50), 'claude-d': fresh(50, 50) },
      expect: { wrapper: 'claude', score: 50 },
      why: 'a tie goes to the earlier wrapper — bash compares strictly less-than',
    },
    {
      name: 'gpt-is-cheapest',
      files: {
        claude: fresh(70, 70), 'claude-a': fresh(75, 75), 'claude-b': fresh(60, 60),
        'claude-d': fresh(65, 65),
        gpt: c({ five: null, seven: 0, ts: now - 60, fiveResetAt: null, sevenResetAt: now + 400000 }),
      },
      expect: { wrapper: 'claude-b', score: 60 },
      why: 'gpt is not home-able, so it is an opt-in lane a session reaches only by having it '
        + 'as HOME (ccd\'s roster header) and it is absent from CCRC_HOME_ABLE, the array '
        + '_ws_least_loaded iterates — it must never win, however free it looks',
    },
    {
      name: 'disabled-lane-skipped',
      files: { claude: fresh(50, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(90, 95), 'claude-d': fresh(60, 60) },
      disabled: ['claude-a'],
      expect: { wrapper: 'claude', score: 50 },
      why: 'claude-a is cheapest but declared off — the runner-up wins, not the '
        + 'account nobody can actually place a session on',
    },
    {
      name: 'all-disabled',
      files: { claude: fresh(50, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(90, 95), 'claude-d': fresh(60, 60) },
      disabled: ['claude', 'claude-a', 'claude-b', 'claude-d'],
      expect: null,
      why: 'every home-able lane declared off: nothing is placeable, and both '
        + 'sides must admit it rather than name an account that cannot take work',
    },
    {
      name: 'disabled-lane-no-telemetry',
      // claude-a is markered off but has NEVER written a limits file — a fresh
      // `touch claude-a-disabled`, or a lane that's never had a session on it.
      // No `claude-a` key in `files` at all (an absent file, not an empty one).
      files: { claude: fresh(50, 40), 'claude-b': fresh(90, 95), 'claude-d': fresh(60, 60) },
      disabled: ['claude-a'],
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
      disabled: ['claude', 'claude-a', 'claude-b', 'claude-d'],
      expect: null,
      why: 'no telemetry anywhere AND every lane declared off: still null, not the '
        + 'empty-directory tie-goes-to-claude case — declared-off overrides unknown-is-free',
    },
    {
      name: 'rolled-over-window',
      files: {
        // claude reads 98 on a week that already reset — the 2026-07-27 shape.
        claude: c({ five: 10, seven: 98, ts: now - 72000, fiveResetAt: now - 72000, sevenResetAt: now - 50000 }),
        'claude-a': fresh(10, 10),
        'claude-b': fresh(40, 40),
        'claude-d': fresh(20, 20),
      },
      expect: { wrapper: 'claude-a', score: 10 },
      why: 'a rolled-over window is UNMEASURED, not measured empty: the zero both sides used to '
        + 'read here was inferred from a timestamp, never observed, and it beat three accounts '
        + 'that had honestly reported 10, 20 and 40 — then went on beating them, because nothing '
        + 'runs on an account nothing was placed on. The cheapest MEASURED account wins',
    },
    {
      name: 'half-rolled-window',
      files: {
        // claude's 5h window ended; its 7d window is fresh and reads 5 — the
        // shape EVERY Anthropic account passes through at each 5h reset, and
        // the one the live fleet was sitting in when this case was written.
        claude: c({ five: 87, seven: 5, ts: now - 15000, fiveResetAt: now - 100, sevenResetAt: now + 200000 }),
        'claude-a': fresh(10, 10),
        'claude-b': fresh(40, 40),
        'claude-d': fresh(20, 20),
      },
      expect: { wrapper: 'claude-a', score: 10 },
      why: 'ONE ended window is enough to make the row unmeasured: a score is a MAXIMUM, so the '
        + 'surviving half bounds the truth only from below and 5 could really be 99. Scoring the '
        + 'survivor is the placement magnet reaching through the readable half — the account whose '
        + '5h state nobody has measured would rank emptiest on the fleet and win every placement. '
        + 'This case had no coverage, which is why that divergence was invisible',
    },
    {
      name: 'all-rolled-over',
      // §B.2's honest cost, pinned in both languages. Two accounts really do
      // share a 5h reset on this fleet, so a shared boundary that leaves NOTHING
      // measured is a live shape, not a hypothetical. Both sides must land on
      // their documented fallback — the first home-able account in roster order
      // at score 0 — rather than on `null`/`""`, which would mean "nothing is
      // placeable" and break every ws-add in that window.
      //
      // This case gives the SAME answer before and after the provenance fix, and
      // that is what it is for: today every account scores an inferred 0 and the
      // strict `<` keeps the first; afterwards every account is unmeasured, both
      // sides skip them all, and the fallback keeps the first. The answer must
      // not move while the reason does.
      files: {
        claude: c({ five: 10, seven: 98, ts: now - 72000, fiveResetAt: now - 72000, sevenResetAt: now - 50000 }),
        'claude-a': c({ five: 40, seven: 40, ts: now - 72000, fiveResetAt: now - 60, sevenResetAt: now - 60 }),
        'claude-b': c({ five: 20, seven: 20, ts: now - 72000, fiveResetAt: now - 60, sevenResetAt: now - 60 }),
        'claude-d': c({ five: 30, seven: 30, ts: now - 72000, fiveResetAt: now - 60, sevenResetAt: now - 60 }),
      },
      expect: { wrapper: 'claude', score: 0 },
      why: 'every home-able window has turned over, so nothing is measured — both sides fall '
        + 'back to the first home-able account in roster order rather than answering '
        + '"nothing is placeable"',
    },
    {
      name: 'authdead-loses-scoring',
      files: { claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(40, 20), 'claude-d': fresh(85, 45) },
      authDead: ['claude-a'],
      expect: { wrapper: 'claude-b', score: 40 },
      why: 'the cheapest lane is condemned, so the cheapest lane nobody condemned wins — '
        + 'a health verdict costs preference, never eligibility',
    },
  ];
}
