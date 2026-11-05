# Account pools read unavailable without the pool-sync timer

An install with no `ccd-pool-sync.timer` stores and forecasts account tags, but ccd never reads them: nothing pulls the
projection, so `_acct_pool_state` falls back to the declared roster. The server still answered `accountPools: 'enforced'`,
because it checked only the `account-pools` capability token, and the PWA drew no warning. This is the reporting half of
the fix. Installing the timer for every role is a separate change.

- **D-8015 (2026-11-03)** — account pools read unavailable without the pool-sync timer, unknown from an older agent.
  `cmd_caps` prints `pool-sync-installed` or `pool-sync-absent`, read by `_pool_sync_installed`, and
  `accountPoolsEnforcement` needs the first for `enforced`. A ccd with `account-pools` and neither word predates the
  measurement, so it reads `unknown`. `_pool_ok`, the swap path, the pool rule and forecast, and install roles and units
  are unchanged.
