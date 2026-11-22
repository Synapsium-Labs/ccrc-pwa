// When the browser leg's parse gates print their medians (native Docs reader, completion plan C2's first item, review run
// 2318's minor 7). Not a test file (no `*.browser.test.*` in its name). `browser/mockup-parse.browser.test.ts` times each
// gated shape three times and holds the median to its 1 000 ms gate; a passing gate says nothing about its margin, and full
// CI run 43969306070 passed every gate on a hosted runner without printing one median, so the hosted margin went
// unmeasured. Each gate now prints its `M5B8-MEASURE` line whenever the leg runs in CI, as well as on request: GitHub
// Actions sets `CI=true` and `GITHUB_ACTIONS=true` on every step, so the browser leg's job log carries the hosted medians on
// every run. The gate itself is unchanged. Pinned by `test/browser-leg.test.ts`.

/** Whether the parse gates print their `M5B8-MEASURE` lines: on request (`CCRC_MEASURE=1`, the measurement runs), and
 *  whenever the leg runs in CI (`CI=true` or `GITHUB_ACTIONS=true`). Any other value of either is not a request. */
export function printsGateMedians(env: Readonly<Record<string, string | undefined>>): boolean {
  return env['CCRC_MEASURE'] === '1' || env['CI'] === 'true' || env['GITHUB_ACTIONS'] === 'true';
}
