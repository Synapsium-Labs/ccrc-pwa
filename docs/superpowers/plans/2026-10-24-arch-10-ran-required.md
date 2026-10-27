# ARCH-10 step 2: every `runCcd` site answers the not-ran arm, and `ran` is required: Plan note

ARCH-10 (#543), step 2, completes the issue. Step 1 (#927) added `ran: false` as an additive arm of the runner's
result and migrated the expiry and collect lanes. This step makes every `runCcd(` site under `server/src` answer
the not-ran arm first, and makes `ran` REQUIRED on both runner results. A transport failure no longer reads as a ccd
refusal at a site that classified the runner's forged `code: 1` and stderr. One number, D-6840, was issued to it.

## Deviations found

- **D-6840** — `ran` is required on both runner results: `ran: true` on the ran arm and `ran: false` (with `ok:
  false` and a `detail`) on the not-ran arm, so `tsc` narrows the ran arm by `ok` and the failure path stays the one
  it always took. Each `runCcd(` site takes one of three arms, pinned per site in `RAN_TABLE`
  (`server/test/consolidationCensus.ts`): **explicit** (the site reads `ran === false` itself, first), **carried**
  (the whole result goes to a reader that reads `ran` first) or **ok-only** (the site reads only `ok`, the stdout of
  an ok answer, or stderr as a plain failure sentence). The agent's exec op sends `ran: false` and `detail` on a
  spawn error, an additive wire key with no `FLEET_PROTO` bump: an older server ignores it, and an agent older than
  the key answers no `ran`, read as `ran: true`, the answer it always was. Deploy agent lane first, then server;
  neither order breaks. Builds on D-6034 and D-6035.
