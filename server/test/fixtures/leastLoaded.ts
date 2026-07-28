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
   *  all — which both sides must read as unknown, and unknown scores 0. */
  files: Record<string, string>;
  expect: { wrapper: string; score: number };
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
      files: { claude: fresh(80, 40), claude2: fresh(5, 3), 'claude-corp': fresh(90, 95) },
      expect: { wrapper: 'claude2', score: 5 },
      why: 'the cheapest account wins, not the first one listed',
    },
    {
      name: 'seven-dominates',
      files: { claude: fresh(10, 90), claude2: fresh(50, 50), 'claude-corp': fresh(60, 20) },
      expect: { wrapper: 'claude2', score: 50 },
      why: 'score is max(5h, 7d) — a free 5h window over an exhausted week is not headroom',
    },
    {
      name: 'all-pinned',
      files: { claude: fresh(100, 100), claude2: fresh(99, 100), 'claude-corp': fresh(98, 99) },
      expect: { wrapper: 'claude-corp', score: 99 },
      why: '_ws_least_loaded does NOT apply _avail/SWAP_CEILING: it returns the minimum '
        + 'even when every account is pinned. The headroom display is what warns the user',
    },
    {
      name: 'missing-file',
      files: { claude: fresh(70, 70), claude2: fresh(60, 60) },
      expect: { wrapper: 'claude-corp', score: 0 },
      why: 'no telemetry file at all reads as unknown, and unknown scores 0 — so an '
        + 'account nobody has measured looks free to both sides alike',
    },
    {
      name: 'tie',
      files: { claude: fresh(50, 50), claude2: fresh(50, 50), 'claude-corp': fresh(50, 50) },
      expect: { wrapper: 'claude', score: 50 },
      why: 'a tie goes to the earlier wrapper — bash compares strictly less-than',
    },
    {
      name: 'gpt-is-cheapest',
      files: {
        claude: fresh(70, 70), claude2: fresh(75, 75), 'claude-corp': fresh(60, 60),
        gpt: c({ five: null, seven: 0, ts: now - 60, fiveResetAt: null, sevenResetAt: now + 400000 }),
      },
      expect: { wrapper: 'claude-corp', score: 60 },
      why: 'gpt is a 4th lane, opt-in only (ccd:11-16) and absent from VALID_WRAPPERS — '
        + 'it must never win, however free it looks',
    },
    {
      name: 'rolled-over-window',
      files: {
        // claude reads 98 on a week that already reset — the 2026-07-27 shape.
        claude: c({ five: 10, seven: 98, ts: now - 72000, fiveResetAt: now - 72000, sevenResetAt: now - 50000 }),
        claude2: fresh(10, 10),
        'claude-corp': fresh(40, 40),
      },
      expect: { wrapper: 'claude', score: 0 },
      why: 'both sides apply the rollover rule before scoring, so a reset window frees '
        + 'the account rather than excluding it for another six days',
    },
  ];
}
