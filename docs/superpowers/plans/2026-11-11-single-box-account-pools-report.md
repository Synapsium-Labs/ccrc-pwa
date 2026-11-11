# Single-box installs say why account pools are not applied

- **D-8283 (2026-11-11)** — the pools frame names why `accountPools` reads `unavailable`: `accountPoolsReason`,
  `ccd-predates` or `no-pool-sync` (`shared/api.ts`), from `accountPoolsUnavailableReason` (`server/src/pools.ts`).
  A single-box install's chip and sheet say the tag is not applied on this install and why, never that ccd is old.

## What ccd does on a single-box install

`ccrc install` arms `ccd-pool-sync.timer` only for `--role fleet` (`_inst_units`, ruling T4-R1): the sync needs
`~/.ccrc/agent.env`, and only a fleet install writes it. The default `--role both` and `--role server`, and every
macOS box, have no timer. With no timer and no `pool-epoch` file, `_acct_pool_state` falls back to the roster's
declared tag. So on one box ccd applies the declared pool and the project tags (`pools/<project>`, written by the
`project-pool` verb on any box), but a central account tag set from the PWA never reaches it. The server's forecast and
swap check still read that central tag from coord.db.

The pools design (`2026-09-18-account-pool-membership-design.md` §5.1, §5.4) has `ccd-pool-sync` write the projection
on the box and nothing else, and the installer's ruling keeps the timer off non-fleet roles. This change follows both and
makes the report truthful. It does not make one box apply central tags.

## Before

D-8015 already made `accountPoolsEnforcement` answer `unavailable` there (`pool-sync-absent` in `ccd caps`). But
`unavailable` had one PWA text, written for the older cause: "fleet ccd predates account pools". On a single-box install
ccd is current, so that sentence was false.

## After

- `accountPoolsUnavailableReason(ccdVerbs)` reads the same tokens as `accountPoolsEnforcement`: no `account-pools` token
  is `ccd-predates`, the token with `pool-sync-absent` is `no-pool-sync`, and anything that is not `unavailable` has no
  reason. Both `poolsWire` call sites (`GET /api/fleet` and the watcher's frame) send it. The key is left out when it is
  undefined.
- The fleet store gates it with `isAccountPoolsUnavailableReason`. The chip's title comes from
  `accountPoolUnavailableText`: "not applied on this install — no pool-sync timer", the old text for `ccd-predates`,
  and a neutral text when an older server sends no reason. The sheet's notice says ccd places by the roster's declared
  pool, and that the server's forecast and swap check use the tag.
- Both install shapes are tested. `ccd-caps-pool-sync.test.ts` runs the real `ccd caps`: with no timer the reason is
  `no-pool-sync`, and with the timer it is enforced with no reason. `fleetws.test.ts` checks both call sites, and the
  browser leg checks the single-box chip and notice at 360, 390, 1280 and 1920.

## Deviations found

- Making one box apply central tags (the issue's option b) is not here. It needs a projection writer on a box with no
  `agent.env`: the server writing `pool-epoch` itself, as it writes `update-intent` on `server`/`both`, or the timer
  reading the local server. Either one changes what fails shut on that box (a stopped server would turn every tagged
  placement `stale`), so it needs a design ruling first.
