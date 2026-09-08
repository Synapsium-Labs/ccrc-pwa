# Telemetry provenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an INFERRED zero — a reading whose window merely elapsed — from being ranked as a
MEASURED zero, so a rolled-over account no longer beats every honestly-reporting account on the
fleet and then stays the winner forever because nothing runs on it to correct it.

**Architecture:** One fact, spelled in two languages that cannot share code. bash's `_limit_field`
stops printing a confident `0` for a window it only inferred had ended and answers `""` — the token
`_limit_score`, `_ws_least_loaded`, `_avail` and `_swap_target` already agree means "nobody
measured this". TypeScript keeps the inferred `0` on the wire (the accounts screen renders it as
`reset`) but teaches `measured()` to refuse to SCORE it, and fixes the one writer of the
`fiveRolledOver`/`sevenRolledOver` flags that produced an inferred zero and left the flag false.
`projected-home.test.ts` drives both implementations over one seeded HOME, so the two halves land in
one commit or the parity harness reds on drift alone.

**Tech Stack:** TypeScript, bash, vitest. `server/` package plus `ccd/ccd`; `shared/api.ts` comment
only; no PWA code changes.

**Spec:** `docs/superpowers/specs/2026-09-07-account-health-and-provenance-design.md` §B

## Global Constraints

- Node floor `>=22.13.0`, identical across all three engines. Never lower engines to make a test green.
- Run suites in the FOREGROUND from inside the package, timeout ≥600000ms:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. **Never bare `npx vitest`.**
- Wire discipline: additive only, absence-permits. This plan adds NO wire field and does not touch
  `FLEET_PROTO`. `AccountUsage` keeps every field it has and every field keeps its type; one boolean
  changes VALUE on one input shape, and one comment beside it changes text.
- Mutation-table discipline: every guard ships WITH a test measured RED when the guard is deleted.
  Measure it, do not assert it in a comment. TDD red-first.
- **AGENT-FIRST.** This plan modifies `ccd/ccd`, so it ships to the fleet host **before** the server:
  `bash deploy/deploy.sh agent <host>` first, then `bash deploy/deploy.sh`. The server reads what the
  fleet host writes, and the agent caches `ccd caps` at boot.
- **The deploy window is real and this plan's bash half sits inside it.** Every ccd change ships a
  fresh executable to a host whose ~20 supervisors keep executing the pre-deploy inode until the
  `KillMode=process`-gated supervisor sweep restarts them (the account-pools spec measured 15 of 18
  live sessions running a days-old inode). Until that sweep runs, `_limit_field`'s new answer is a
  no-op for every live session's own `_auto_swap_check`; `cmd_ws_add` picks it up immediately because
  a `ccd ws-add` is a fresh process. Do not hand-`install_atomic` the new `ccd` without the sweep, and
  do not read "placement did not change on the box" as a failed deploy until the sweep has run.
- No account name appears in any shipped source file. Every wrapper id in this plan appears only in
  `server/test/` fixtures, which is where the roster fixture already lives.
- **`ccd/ccd` carries a provenance marker on line 2 and editing it invalidates that marker.**
  Re-stamp before committing or `server/test/ownership.test.ts` reds with *"ccd/ccd was edited without
  re-stamping its provenance marker"*. The command is in Task 3 Step 8, verbatim.

---

## Background the implementer needs

### The defect, end to end

`ccd/ccd:11746-11749` — `_limit_field`'s `resetAt` branch:

```bash
  reset=$(_limit_json_num "$f" "${field}ResetAt")
  if [[ -n "$val" && -n "$reset" && "$now" -ge "$reset" ]]; then
    printf '0'; return 0
  fi
```

That `0` was never observed. It is INFERRED from a timestamp: the window this sample described has
ended, so the sample no longer describes anything. `_limit_score` (`ccd/ccd:11762`) then returns
`max(0, 0) = 0`, and `_ws_least_loaded` (`ccd/ccd:3870-3871`) keeps the lowest score with a strict `<`:

```bash
    sc=$(_limit_score "$w"); [[ -z "$sc" ]] && continue
    (( sc < bs )) && { bs=$sc; best="$w"; }
```

So a `0` beats every honest account. Nothing runs on the account it beat them with, so nothing ever
reports a real number for it, so it goes on winning. **The account whose window merely turned over
becomes the most attractive destination on the fleet and stays that way.**

The server mirrors the arithmetic at `server/src/limits.ts:142-145` and — this is the part worth
reading twice — it already NAMES the distinction, four lines into the file (`server/src/limits.ts:10-13`):

```ts
  /** The window ended and nothing has measured the new one yet, so the 0 above
   *  is inferred from the reset timestamp rather than observed. Distinct from a
   *  measured 0 (something ran on the account and it really is empty). */
  fiveRolledOver: boolean; sevenRolledOver: boolean;
```

…then hands the row to `measured()` (`server/src/limits.ts:40-41`), which names only `five` and
`seven` and never asks the flags:

```ts
const measured = (l: AccountLimits | undefined): number | null =>
  !l || l.five === null || l.seven === null ? null : Math.max(l.five, l.seven);
```

**So neither implementation ignores the rollover event. Both ignore the PROVENANCE of the zero.**
This is the tree's own "no overloaded null at a seam" rule violated at the seam that decides
placement: *rested* and *nobody has looked since it rested* render identically.

### What is already correct, and must not be "fixed"

The three unknown-handling sites state one rule between them, and it is right:

> unmeasured never OUTRANKS measured, and never becomes INELIGIBLE.

- `_ws_least_loaded` **skips** unmeasured (`[[ -z "$sc" ]] && continue`, `ccd/ccd:3870`) — affordable
  only because it HAS a fallback three lines down (`[[ -z "$best" ]] && best="$first"`, `:3873`).
- `_swap_target` **ranks unmeasured last** (`sc=$(_limit_score "$cand"); : "${sc:=100}"`,
  `ccd/ccd:11880`) — it cannot skip, because a rescue with no candidate strands a stuck session. Its
  comment argues 100 exactly: `_avail` has already rejected everything at or above `SWAP_CEILING`
  (98), so a measured candidate reaching that line is at most 97 and always outranks an unmeasured
  one, while 100 is far below the `999` sentinel.
- `_avail` (`ccd/ccd:11785`) **stays permissive**, and this plan does not touch it. Its own comment is
  the ruling:

  > UNKNOWN IS AVAILABLE HERE. It is not a score, and this is the one of the three unknown-handling
  > sites that must stay permissive, because ELIGIBILITY and RANK are different questions and only
  > this function answers the first.

  and, on why:

  > Reading that as blocked would evacuate every session off a perfectly healthy home the moment it
  > went quiet — the mirror image of the 2026-07-27 incident `_limit_field` records — and would leave
  > a hard-blocked session with NO destination.

  **A rolled-over account is available today (it scores 0) and available after this plan (it scores
  unknown). Same answer, honest reason.** Task 2 pins that in both directions before Task 3 touches
  anything, because "the answer did not change" is a claim you cannot make with a test written
  afterwards.

### The third defect, fixed on the way

`server/src/limits.ts:150-153` — the age fallback:

```ts
      if (ts !== null) {
        if (!fiveRolledOver && five !== null && now - ts > FIVE_WINDOW) five = 0;
        if (!sevenRolledOver && seven !== null && now - ts > SEVEN_WINDOW) seven = 0;
      }
```

It writes an inferred `0` and leaves `fiveRolledOver` **false**. `pwa/src/screens/AccountsScreen.tsx:114`
renders exactly that difference —

```tsx
      <span className="acct-pct">{rolledOver ? 'reset' : pct === null ? '—' : `${pct}%`}</span>
```

— so this path paints a confident `0%` on the screen whose own comment two lines up promises
*"the strip's exact three-way, never collapsed: "reset" (inferred zero) ≠ measured "0%" ≠ "—" (never
measured)"*. `pwa/src/fleet/AccountsStrip.tsx:159-160` makes the same three-way from the same flags.
The flag's docstring already defines it as "the 0 above is inferred rather than observed" — the age
branch is simply the one writer that never honoured its own contract. **Fixing it changes no
placement** (Task 1 lands before `measured()` reads the flags at all) and no PWA code.

### The parity harness, and why one commit

`server/test/projected-home.test.ts` seeds ONE fixture HOME with both projections of one roster
(`seedRoster` writes `.ccrc/accounts.json` for `loadConfig`, `seedAccountsSh` writes `.ccrc/accounts.sh`
for ccd), then runs `projectHome` and `_ws_least_loaded` over identical `~/.cc-limits` bytes and
demands they agree on the wrapper AND the score (`:100-107`). `server/test/ccd-limits.test.ts:53-62`
does the same for the field reader against `server/test/fixtures/rollover.ts`. **A one-sided change
reds on parity alone**, which is why Task 3 is a single commit spanning both languages.

The fixture roster's home-able accounts, in declaration order (`DEFAULT_TEST_ROSTER`,
`server/test/helpers.ts:60-99`): `claude`, `claude-a`, `claude-b`, `claude-d`. `gpt` is
`homeAble: false`, `telemetry: 'none'`, and is scored by neither side.

`server/test/fixtures/leastLoaded.ts:131-143`'s `rolled-over-window` case currently asserts the defect
is CORRECT — a rolled-over `claude` wins placement at score 0 against accounts measured at 10, 20 and
40. Ruling R7 of the spec overturns it. **It is rewritten, not deleted:** the shape it covers is the
2026-07-27 shape and it is the only fixture that exercises the rollover rule through the placement
rule at all.

### Two divergences you will not close in this plan

Both are recorded in `## Deviations found` with the argument for leaving them. Read them before you
start so you do not "helpfully" close one:

1. **A HALF-rolled row.** After Task 3, `{five: rolled, seven: 40}` is UNMEASURED to `measured()` (the
   flag is set) but scores 40 in `_limit_score`, whose `: "${five:=0}"` substitutes 0 for a missing
   half and whose wholly-unknown branch fires only when BOTH halves are empty (`ccd/ccd:11768`). The
   spec fixes `_limit_field` and says explicitly that `_limit_score` "then returns `""` when both
   halves are unknown" — it is not in scope. Closing it by relaxing that branch to `||` would make
   `_limit_score gpt` unknown for gpt's real on-disk `{"five": null, "seven": 0}` shape, hence
   `_avail gpt` always true, hence `_gpt_status` (`ccd/ccd:1246`) can never report the Codex weekly
   cap — three assertions in `ccd-limits.test.ts:97-142` red (`:112`, `:118`, `:131`; the two cases
   that seed a non-null `five` stay green), and the gpt lane silently loses its only exclusion. Do not.
2. **`FleetSession.limits`.** `shared/api.ts:41` carries `{five, seven}` and no provenance, so
   `pwa/src/fleet/SwapSheet.tsx:76-77`'s `load` ranks an inferred `0` as the emptiest pool and tags it
   "suggested" — the exact defect that function's own docstring exists to prevent, reached through a
   seam it cannot see. §B holds the wire still by design.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/limits.ts` (modify) | The age fallback sets the inferred-zero flag; `measured()` refuses to SCORE an inferred zero |
| `shared/api.ts` (modify) | Comment only: the two flag comments name both writers of an inferred zero |
| `ccd/ccd` (modify) | `_limit_field`'s two inferred-zero branches answer `""` instead of `0`; the three unknown-handling sites' comments name the new source of unknown; line-2 provenance marker re-stamped |
| `server/test/fixtures/rollover.ts` (modify) | `no-reset-fields-old` carries the honest flag — the one shared row the age path owns |
| `server/test/fixtures/leastLoaded.ts` (modify) | `rolled-over-window` rewritten (R7); `all-rolled-over` added for §B.2's honest cost |
| `server/test/limits.test.ts` (modify) | Pins the age-inferred flag directly, not only through the shared fixture |
| `server/test/ccd-limits.test.ts` (modify) | Flag-aware fixture translation; the eligibility pin and the rescue-destination pin |
| `server/test/projected-home.test.ts` (modify) | Pins `measured()`'s refusal to score an inferred zero, and the half-rolled divergence as a TS-side-only fact; `shellScore`'s docstring stops calling its `\|\| '0'` unreachable, because `all-rolled-over` reaches it |

**Checked when this plan was written, not left for the implementer to discover:**

- `single-definition.test.ts` scans for named vocabularies (`UNCHECKED_PR`, the reason vocabulary,
  auth verdicts, the ccd script path, `KeyedQueue`, `sessionLabel`, the Build 7 nouns, the terminal
  delivery states). None of them is `measured`, `asShell`, `_limit_field` or a rollover flag, and no
  file in this plan spells the ccd script path. Safe.
- `readLimits`'s other consumer is `server/src/fleet.ts:262`, and it reads exactly two fields off the
  row (`limits: acct ? { five: acct.five, seven: acct.seven } : null`, `:408`). Neither changes value
  in this plan, so `FleetSession` is byte-identical. `projectHome`'s only caller is
  `server/src/server.ts:1185`.
- Every other bash suite that seeds `~/.cc-limits` writes `{five, seven, ts: <now>}` with **no
  `resetAt` keys and a fresh `ts`**, so neither branch of `_limit_field` fires in any of them:
  `ccd-account-ok.test.ts:22-24`, `ccd-pool-ok.test.ts:182-184`, `ccd-workspaces.test.ts:443-448`,
  `ccd-login-screen.test.ts:283-284`. `statusline-script.test.ts` tests the WRITER, not either reader.
- Every PWA test that names a rollover flag hand-builds an `AccountUsage` literal
  (`pwa/test/accounts-strip.test.tsx:19`, `accounts-screen.test.tsx:25`, `fleet-screen.test.tsx:236`,
  `lifecycle-ui.test.tsx:96`); none calls `readLimits`. **The `pwa/` package is untouched by this
  plan** and needs no run.

---

### Task 1: The flag stops lying — an age-inferred zero says it was inferred

`server/src/limits.ts`'s age fallback is the one writer that produces an inferred zero and leaves the
flag that means "this zero is inferred" set to false. Fixing it changes no placement (nothing reads
the flags for scoring until Task 3) and no PWA code — it changes what the two UIs already render from
`0%` to `reset` on one input shape.

**Files:**
- Modify: `server/src/limits.ts` (the `AccountLimits` flag docstring at `:10-13`; the rollover
  computation and age fallback at `:142-153`)
- Modify: `shared/api.ts` (the two flag comments at `:2660-2661` — comment text only)
- Modify: `server/test/fixtures/rollover.ts` (the `no-reset-fields-old.json` case at `:57-64`)
- Test: `server/test/limits.test.ts` (a new `it` inside the existing
  `describe('readLimits — a window that has rolled over')`)

**Interfaces:**
- Consumes: nothing from an earlier task — this is the first.
- Produces: `readLimits(io, cfg, now)` returns `fiveRolledOver: true` / `sevenRolledOver: true` for a
  row whose zero came from the AGE rule as well as for one whose zero came from a lapsed `resetAt`.
  The exported signature is unchanged: `readLimits(io: FleetIO, cfg: CcrcConfig, now?: number):
  Promise<Record<string, AccountLimits>>`. `AccountLimits`'s field list and types are unchanged.

- [ ] **Step 1: Write the failing test**

In `server/test/fixtures/rollover.ts`, replace the `no-reset-fields-old.json` case (currently at
`:57-64`) in full:

```typescript
    {
      file: 'no-reset-fields-old.json',
      // No resetAt and older than its own 5h window: the EXISTING age rule
      // still has to fire. The FLAG has to fire with it — this is the one
      // shared row the age path owns, and it is what pins that the zero it
      // writes is declared inferred rather than passed off as measured.
      content: compact({ five: 99, seven: 80, ts: now - 20000 }),
      expect: { five: 0, seven: 80, fiveRolledOver: true, sevenRolledOver: false },
      why: 'the age rule still applies when resetAt is absent — and its 0 is declared inferred',
    },
```

Then, in `server/test/limits.test.ts`, add this `it` at the end of the
`describe('readLimits — a window that has rolled over')` block (after the existing
`'a rolled-over zero is distinguishable from a measured zero'` case, before that describe's closing
`});`):

```typescript
  it('an age-inferred zero carries the same flag a resetAt-inferred one does', async () => {
    // The flags' whole contract is "the 0 above is inferred rather than
    // observed" (the AccountLimits docstring). TWO rules can reach that state:
    // a lapsed resetAt, which is fact straight from the API, and a sample older
    // than its own window, which is inference. Both write the same inferred 0,
    // so both have to set the same flag — the flag names the PROVENANCE of the
    // number, not which rule derived it.
    //
    // Left false, the age path told AccountsScreen's `Bar` (rolledOver ? 'reset'
    // : `${pct}%`) that an account nobody had measured in six hours was measured
    // empty — the exact collapse that component's own comment says it never
    // makes.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1785231736;
    // No resetAt fields at all — the gpt 429-exclusion shape, and anything
    // written before those fields existed. 20000s is past the 5h window and
    // nowhere near the 7d one, so exactly one half is inferred and the other
    // stays a real measurement. A fixture that rolled BOTH could not tell a
    // per-field flag from a per-row one.
    writeFileSync(path.join(dir, 'aged.json'),
      JSON.stringify({ five: 99, seven: 80, ts: now - 20000 }));

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    expect(l['aged'], 'the 5h half is inferred and must say so').toMatchObject({
      five: 0, fiveRolledOver: true,
    });
    expect(l['aged'], 'the 7d half is a real measurement and must NOT say otherwise').toMatchObject({
      seven: 80, sevenRolledOver: false,
    });
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/limits.test.ts
```

Expected: **2 assertions red**, both in `describe('readLimits — a window that has rolled over')`.

1. `reports every rollover case exactly` fails on the shared fixture row, headlined with that row's
   own message — `no-reset-fields-old.json: the age rule still applies when resetAt is absent — and
   its 0 is declared inferred` — and a `toMatchObject` diff whose only differing line is
   `- "fiveRolledOver": true` / `+ "fiveRolledOver": false`.
2. `an age-inferred zero carries the same flag a resetAt-inferred one does` fails on its first
   assertion, headlined `the 5h half is inferred and must say so`, with the same one-line diff.

The second assertion of the new case (`seven: 80, sevenRolledOver: false`) is already true and is
never reached in the red run; it exists so Step 5's mutation cannot be "passed" by setting both flags
unconditionally. **Record the actual output.**

- [ ] **Step 3: Make the flag honest**

In `server/src/limits.ts`, replace the `AccountLimits` flag docstring (currently `:10-13`):

```typescript
  /** The window ended and nothing has measured the new one yet, so the 0 above
   *  is inferred from the reset timestamp rather than observed. Distinct from a
   *  measured 0 (something ran on the account and it really is empty). */
  fiveRolledOver: boolean; sevenRolledOver: boolean;
```

with:

```typescript
  /** The window ended and nothing has measured the new one yet, so the 0 above
   *  is INFERRED rather than observed. Distinct from a measured 0 (something ran
   *  on the account and it really is empty).
   *
   *  TWO writers reach this state and both set the flag: a `resetAt` that has
   *  lapsed (fact, straight from the API) and a sample older than its own window
   *  (inference). The flag names the PROVENANCE of the number, not which rule
   *  derived it — the age path used to write the 0 and leave this false, which
   *  told both UIs an unmeasured account had been measured empty.
   *
   *  `measured()` reads this: an inferred 0 is not a score. */
  fiveRolledOver: boolean; sevenRolledOver: boolean;
```

Then replace the rollover computation and age fallback (currently `:135-153`):

```typescript
      // A reading whose own window has already reset does not describe the
      // current window — it describes one that ended. The reset timestamps come
      // straight from the API (statusline-command.sh:163-166), so this is fact,
      // not the inference the age rules below make. Telemetry is written only
      // when a session renders its statusline, so an idle account's sample can
      // outlive its window by days: claude sat at seven=98 for 14h after its 7d
      // window reset, excluding it from the whole fleet.
      const fiveRolledOver = five !== null && fiveResetAt !== null && now >= fiveResetAt;
      const sevenRolledOver = seven !== null && sevenResetAt !== null && now >= sevenResetAt;
      if (fiveRolledOver) five = 0;
      if (sevenRolledOver) seven = 0;

      // Fallback for a file with no reset fields (the gpt 429 exclusion, and
      // anything written before those fields existed): a sample older than its
      // own window has certainly rolled over.
      if (ts !== null) {
        if (!fiveRolledOver && five !== null && now - ts > FIVE_WINDOW) five = 0;
        if (!sevenRolledOver && seven !== null && now - ts > SEVEN_WINDOW) seven = 0;
      }
```

with:

```typescript
      // A reading whose own window has already reset does not describe the
      // current window — it describes one that ended. The reset timestamps come
      // straight from the API (statusline-command.sh:163-166), so this is fact,
      // not the inference the age rules below make. Telemetry is written only
      // when a session renders its statusline, so an idle account's sample can
      // outlive its window by days: claude sat at seven=98 for 14h after its 7d
      // window reset, excluding it from the whole fleet.
      //
      // `let`, not `const`: the age fallback below is the SECOND writer of the
      // same conclusion, and it used to write the inferred 0 while leaving these
      // false. The flag's contract is "the 0 above is inferred rather than
      // observed" — not "a resetAt lapsed" — so a path that inferred a 0 and
      // left the flag false was asserting a measurement it had not made.
      let fiveRolledOver = five !== null && fiveResetAt !== null && now >= fiveResetAt;
      let sevenRolledOver = seven !== null && sevenResetAt !== null && now >= sevenResetAt;
      if (fiveRolledOver) five = 0;
      if (sevenRolledOver) seven = 0;

      // Fallback for a file with no reset fields (the gpt 429 exclusion, and
      // anything written before those fields existed): a sample older than its
      // own window has certainly rolled over.
      //
      // The `!fiveRolledOver` guards STAY. They say the FACT wins over the
      // INFERENCE — the resetAt rule has already reached this conclusion and the
      // age rule may not re-derive it. They produce the same value either way
      // today, which is exactly why deleting them would be invisible.
      if (ts !== null) {
        if (!fiveRolledOver && five !== null && now - ts > FIVE_WINDOW) { five = 0; fiveRolledOver = true; }
        if (!sevenRolledOver && seven !== null && now - ts > SEVEN_WINDOW) { seven = 0; sevenRolledOver = true; }
      }
```

Finally, in `shared/api.ts`, replace the two flag comments (currently `:2660-2661`):

```typescript
  fiveRolledOver: boolean;      // the 5h window reset; the 0 above is inferred, not measured
  sevenRolledOver: boolean;     // the 7d window reset; the 0 above is inferred, not measured
```

with:

```typescript
  fiveRolledOver: boolean;      // the 5h window ended (lapsed resetAt, or an over-age sample); the 0 above is inferred, not measured
  sevenRolledOver: boolean;     // the 7d window ended (lapsed resetAt, or an over-age sample); the 0 above is inferred, not measured
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/limits.test.ts test/accounts-route.test.ts test/projected-home.test.ts test/ccd-limits.test.ts
```

Expected: **all four green**, with no further edits.

- `limits.test.ts` — the two red assertions above now pass. Its first case
  (`reads fresh values and decays stale ones per ccd rules`, `:12-29`) asserts `.five`/`.seven` for
  the two age-rule rows and a full `toEqual` only for the FRESH row, so it is unaffected.
- `accounts-route.test.ts` — its two rollover cases (`:71-108`) both use lapsed `resetAt` values, so
  they were already flagged; the age path is not on their route.
- `projected-home.test.ts` — no `leastLoaded` fixture has an account whose zero comes from the age
  rule (every one carries explicit `fiveResetAt`/`sevenResetAt`), and `measured()` does not read the
  flags yet. **This is the step that proves the spec's "changes no placement".**
- `ccd-limits.test.ts` — its `asShell` translator (`:50`) still reads only the VALUE, and bash still
  prints `0` for the age row. Task 3 changes both together.

- [ ] **Step 5: Verify the guard is real by mutating it**

Revert exactly the two additions inside the age fallback — `{ five = 0; fiveRolledOver = true; }` back
to `five = 0;`, and the `seven` line likewise — leaving the `let` in place. Re-run
`./node_modules/.bin/vitest run test/limits.test.ts` and confirm the same **2 assertions** go red.
Restore. Record before/after in the commit message. A comment is a request; a red suite is a
mechanism.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add server/src/limits.ts shared/api.ts server/test/fixtures/rollover.ts server/test/limits.test.ts
git commit -m "fix(limits): an age-inferred zero sets the flag that says it was inferred (D-1926)

readLimits' age fallback wrote a 0 it had inferred from the sample's own age and
left fiveRolledOver/sevenRolledOver false, so AccountsScreen's Bar rendered '0%'
where the flag exists to make it render 'reset'. The flag's docstring already
said it names the provenance of the zero; this path was the one writer that
never honoured it. Placement is untouched — measured() does not read the flags
yet.

Mutation measured: dropping the two flag assignments reds 2 assertions in
limits.test.ts."
```

---

### Task 2: Pin what the provenance fix must NOT change

Three answers must be identical on both sides of Task 3, and "it did not change" is a claim you can
only make with a test that existed before the change. These are **characterization pins**: they pass
on today's code, they pass after Task 3, and their teeth are measured in Task 3 Step 10, where the
mutation that would break them finally becomes reachable.

One line of one of them is deliberately written to today's REASON rather than today's answer, so that
Task 3 has a red-first signal at the exact seam it moves.

**Files:**
- Modify: `server/test/ccd-limits.test.ts` (append one `describe` at the end of the file)
- Modify: `server/test/fixtures/leastLoaded.ts` (append one case to `leastLoadedCases`)
- Modify: `server/test/projected-home.test.ts` (`shellScore`'s docstring at `:73-78`, comment only —
  the new fixture is the first one whose expected winner goes unmeasured, and that docstring
  currently declares the `|| '0'` that will carry it unreachable)
- No source file is touched by this task.

**Interfaces:**
- Consumes from Task 1: nothing — Task 1 touched only the TS flag, and no assertion here reads it.
- Produces: three standing pins consumed by Task 3 Step 10 as its mutation targets —
  `_avail <rolled account>` succeeds; `_swap_target <id> <cur> <home>` prints a non-empty destination
  when every candidate has rolled over; and the `all-rolled-over` `LeastLoadedCase`
  (`{ name, files, expect: { wrapper: 'claude', score: 0 }, why }`) driven by the existing
  `it.each(leastLoadedCases(now()))` runner in `projected-home.test.ts:82`.

- [ ] **Step 1: Write the pins**

Append to `server/test/ccd-limits.test.ts`, at the end of the file:

```typescript
describe('a rolled-over account is ELIGIBLE — _avail answers eligibility, not rank', () => {
  // Written BEFORE the provenance fix and expected to pass on both sides of it.
  // That is the point: `_avail`'s own comment rules that "UNKNOWN IS AVAILABLE
  // HERE… ELIGIBILITY and RANK are different questions and only this function
  // answers the first", and the fix must not quietly reverse it. A rolled-over
  // account is available today because it scores 0 and available afterwards
  // because it scores unknown — same answer, honest reason.
  //
  // The 2026-07-27 shape: a 20h-old sample whose 7d window reset 14h ago, and
  // whose 5h window reset with it.
  const rolled = (w: string): void => {
    const t = now();
    writeLimits(`${w}.json`,
      json({ five: 10, seven: 98, ts: t - 72000, fiveResetAt: t - 72000, sevenResetAt: t - 50000 }));
  };

  it('_avail says yes for an account whose windows have both reset', () => {
    rolled('claude');
    expect(sh('_avail claude && echo AVAIL || echo NO'),
      'eligibility must not change across the provenance fix — a hard-blocked session that '
      + 'cannot reach a rolled-over lane has nowhere to go').toBe('AVAIL');
    // The REASON, pinned separately so the fix is visible here and not only in
    // the parity harness. Today `_limit_score` answers a confident `0` for an
    // account whose windows have both lapsed; after the fix it answers ""
    // (unknown) and `_avail`'s own `[[ -z "$sc" ]] && return 0` carries the same
    // verdict for an honest reason. Task 3 flips this ONE literal.
    expect(sh('_limit_score claude'),
      'the reason eligibility holds: an inferred zero today, an honest unknown after').toBe('0');
  });

  it('_swap_target still names a destination when every candidate has rolled over', () => {
    // The rescue lane's non-negotiable, and the thing `_swap_target`'s
    // rank-last comment exists to protect: a session that must leave must have
    // somewhere to go. cur == home == claude-b at the ceiling, so the one
    // reachable "stay" shortcut (`_avail "$home"`, ccd:11843) declines and the
    // must-leave loop runs over candidates that are measured today and
    // unmeasured after — eligible either way, ranked last after, never dropped.
    rolled('claude'); rolled('claude-a');
    writeLimits('claude-b.json', json({ five: 99, seven: 99, ts: now() }));
    expect(sh('_swap_target claude-demo claude-b claude-b || true'),
      'a rescue with no candidate strands a stuck session').not.toBe('');
    // …and it is the first candidate in pool order, which is roster declaration
    // order. Both scores are equal (0 today, 100 after) and the tie-break is a
    // strict `<`, so the answer is stable across the fix.
    expect(sh('_swap_target claude-demo claude-b claude-b || true')).toBe('claude');
  });
});
```

**`|| true` is required, not cosmetic.** `_swap_target`'s last statement is
`[[ -n "$best" ]] && echo "$best"` (`ccd/ccd:11883`), so a call that names nobody short-circuits and
the function exits **1** — and `sh` is `execFileSync` (`ccd-limits.test.ts:18-23`), which THROWS on a
non-zero exit instead of returning stdout. Without the `|| true` this pin cannot observe the empty
answer it is written to catch: the mutation that empties it would report a thrown
`Command failed: bash -c …` rather than `expected '' not to be ''`. (Every other `''` expectation in
that file — `:246`, `:253` — reaches `''` through an explicit `return 0` in a *stay* branch, never
through an empty must-leave loop, which is why none of them needs this.)

Append to `server/test/fixtures/leastLoaded.ts`, as the last entry of the array returned by
`leastLoadedCases` (after the `rolled-over-window` case, before the closing `];`):

```typescript
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
```

- [ ] **Step 2: Say why assertion 3 survives an unmeasured winner**

The parity runner's third assertion scores the fixture's expected winner through `shellScore`
(`projected-home.test.ts:106` calls it, `:73-79` defines it), and that helper's docstring declares
its `|| '0'` unreachable — *"only reached for a wrapper no fixture expects to WIN"*. `all-rolled-over`
is the first fixture whose expected winner is UNMEASURED, so once Task 3 lands, `_limit_score claude`
answers `""` for the very wrapper the case names and `|| '0'` is the only thing between that and
`NaN`. The docstring is fixed HERE, in the commit that adds the fixture, so a later "simplification"
to a bare `Number(sh(...))` reads a comment that says why it cannot.

In `server/test/projected-home.test.ts`, replace the `shellScore` docstring (currently `:73-78`; the
definition line below it is unchanged and is shown only as the anchor):

```typescript
/** `_limit_score` says "wholly unknown" with an empty string, and `|| '0'` is
 *  only reached for a wrapper no fixture expects to WIN — every `c.expect`
 *  names a measured account now, since neither side lets an unmeasured one win
 *  while a measured one exists (Task 6). Kept as a total function anyway: it
 *  reads a score for whichever wrapper the fixture names, and a bare `Number('')`
 *  would be `NaN` rather than a legible failure. */
const shellScore = (wrapper: string): number => Number(sh(`_limit_score ${wrapper}`) || '0');
```

with:

```typescript
/** `_limit_score` says "wholly unknown" with an empty string, and `|| '0'` IS
 *  reached — by `all-rolled-over`, whose expected winner is unmeasured on both
 *  sides the moment the provenance fix lands (until then it is an inferred 0 on
 *  both sides, which is the same 0 by a dishonest route). That case is the
 *  documented fallback ("if NOTHING is measured, the first home-able account in
 *  roster order, at score 0"), so bash answers "" for the very wrapper the
 *  fixture names, and `|| '0'` is what turns that into the 0 the fixture
 *  asserts. It is therefore LOAD-BEARING, not a courtesy: a bare `Number('')`
 *  would be `NaN` and red that case for a reason that has nothing to do with
 *  placement. */
const shellScore = (wrapper: string): number => Number(sh(`_limit_score ${wrapper}`) || '0');
```

Comment only — the expression is byte-identical, so no assertion moves in this step.

- [ ] **Step 3: Run them and verify they pass on unmodified source**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-limits.test.ts test/projected-home.test.ts
```

Expected: **all green**, including the new `all-rolled-over` row of
`describe('projectHome agrees with ccd _ws_least_loaded')` and both new `ccd-limits` cases.

Derived when this plan was written, so you know what you are confirming rather than discovering:
today every account in `all-rolled-over` reads an inferred 0 on both sides, `projectHome`'s `reduce`
keeps the first at 0, `_ws_least_loaded`'s strict `<` keeps the first at 0, and
`shellScore('claude')` is `Number('0')`. If any of these is red on unmodified source, **stop** — the
premise of Task 3 has changed and the plan must be re-derived, not the assertion relaxed.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add server/test/ccd-limits.test.ts server/test/fixtures/leastLoaded.ts server/test/projected-home.test.ts
git commit -m "test(limits): pin what the provenance fix must NOT change

Three characterization pins written before the change, so that 'the answer did
not move' is measurable rather than asserted: _avail keeps a rolled-over account
eligible, _swap_target still names a destination when every candidate has rolled
over, and a fleet with nothing measured still falls back to the first home-able
account at score 0 in both languages.

No source change. One assertion deliberately pins today's REASON (_limit_score
answers '0'), which is the single literal the next commit flips."
```

---

### Task 3: The provenance fix — both languages, one commit

**THE KEYSTONE.** `projected-home.test.ts` runs bash and TypeScript over one seeded HOME, so a
one-sided change reds on parity alone. Everything below lands in a single commit.

**Files:**
- Modify: `ccd/ccd` (`_limit_field`'s header and its two inferred-zero branches, `:11728-11759`;
  the comment in `_avail`, `:11785-11826`; the comment in `_ws_least_loaded`, `:3798-3826`; the
  comment in `_swap_target`, `:11856-11880`; the line-2 provenance marker)
- Modify: `server/src/limits.ts` (`measured()`, `:26-41`)
- Modify: `server/test/fixtures/leastLoaded.ts` (the `rolled-over-window` case, `:131-143`)
- Modify: `server/test/ccd-limits.test.ts` (`asShell` at `:47-50` and its two call sites at `:57-60`;
  the one reason literal Task 2 planted)
- Modify: `server/test/projected-home.test.ts` (two new `it`s in
  `describe('projectHome ranks unmeasured below measured')`)

**Interfaces:**
- Consumes from Task 1: `AccountLimits.fiveRolledOver` / `.sevenRolledOver` are now set by BOTH
  writers of an inferred zero. `measured()` may therefore trust them as "this number is inferred"
  rather than as "a resetAt lapsed".
- Consumes from Task 2: the three characterization pins, unchanged except for the single
  `_limit_score claude` literal named below.
- Produces:
  - bash — `_limit_field <wrapper> five|seven [maxage]` prints **nothing** (exit 0) when the field's
    window has ended, by either rule. `_limit_score` (`ccd/ccd:11767`) and `_gpt_status`
    (`ccd/ccd:1268`) are its only two direct callers, and **neither is edited**. `_limit_score`
    already answers `""` when both halves are empty, and `_avail`, `_ws_least_loaded` and
    `_swap_target` read that through it; `_gpt_status` folds `""` to 0 with `: "${five:=0}"`
    (`:1269`), but that fold is unreachable for the shape this change creates — gpt's `five` is
    already `null`, so a rolled `seven` makes `_limit_score gpt` wholly unknown, `_avail gpt`
    succeeds at `:11824`, and `_gpt_status` returns "enabled, available" at `:1289` without entering
    the `:1266` branch at all. Stated because it is luck, not design: a future `gpt.json` carrying a
    real `five` and a lapsed `fiveResetAt` would reach that fold.
  - bash, third surface — **`_limit_five` (`ccd/ccd:11760`) is a back-compat shim with ZERO callers.**
    Measured: `grep -n '_limit_five' ccd/ccd` returns exactly two lines — its own definition, and a
    mention inside `_ws_least_loaded`'s comment block at `:3821` which cites it as evidence that a
    limits file "CAN be missing a key". It is **not edited and not deleted by this plan**, and it is
    named here for one reason: an enumeration of `_limit_field`'s consumers that omits it is the same
    incomplete-census defect this plan exists to remove, one level up. Anyone reviving that shim
    inherits the new `""` return automatically, because it forwards to `_limit_field` unchanged — so
    the shim is safe, but only by construction, not by anyone having checked. Deleting it is a
    separate call: `:3821`'s argument leans on its existence, so removing it silently falsifies a
    comment that is doing real work.
  - TypeScript — `measured(l: AccountLimits | undefined): number | null` returns `null` when
    `l.fiveRolledOver || l.sevenRolledOver`. `projectHome`'s exported signature
    (`(roster: Roster, limits: Record<string, AccountLimits>) => ProjectedHome | null`) is unchanged.

- [ ] **Step 1: Rewrite the fixture that asserts the defect is correct (R7)**

In `server/test/fixtures/leastLoaded.ts`, replace the `rolled-over-window` case (currently `:131-143`)
in full:

```typescript
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
```

**This case is overturned, not deleted (R7).** It previously asserted `{ wrapper: 'claude', score: 0 }`
— that a reset window "frees the account rather than excluding it for another six days". Freeing it
was right; ranking it FIRST was the defect. The account is still eligible (Task 2's `_avail` pin), it
simply no longer outranks accounts that reported.

- [ ] **Step 2: Teach the fixture translator that bash has one channel**

In `server/test/ccd-limits.test.ts`, replace the `asShell` helper (currently `:47-50`):

```typescript
/** readLimits says "unknown" with null; _limit_field says it with an empty
 *  string. Same state, two vocabularies — translate, don't compare literally,
 *  or `String(null)` quietly demands that bash print the word "null". */
const asShell = (v: number | null): string => (v === null ? '' : String(v));
```

with:

```typescript
/** Two vocabularies AND two domains, so translate the FIXTURE rather than
 *  weakening either implementation.
 *
 *  `readLimits` keeps an inferred zero on the wire and flags it (`five: 0,
 *  fiveRolledOver: true`) because the accounts screen renders both halves —
 *  "reset" is a different word from "0%" and from "—". `_limit_field` has no
 *  second channel: stdout carries one token, and the ranking callers that
 *  consume it (`_limit_score`, and through it `_avail`, `_ws_least_loaded`,
 *  `_swap_target`) have exactly one spelling for "nobody measured this", which
 *  is "". (`_gpt_status`, ccd:1268, is the other direct reader and folds "" to
 *  0 — see the note in this plan's Task 3 Interfaces for why that fold is
 *  unreachable here.)
 *
 *  So a row is unknown to bash when its value is null OR its rollover flag is
 *  set. Collapsing that into `v === null` is what let bash print a confident `0`
 *  for a window that had merely elapsed. */
const asShell = (v: number | null, rolledOver: boolean): string =>
  (v === null || rolledOver ? '' : String(v));
```

and update its two call sites (currently `:57-60`) to pass the matching flag:

```typescript
      expect(sh(`_limit_field ${wrapper} five`), `${c.file} five: ${c.why}`)
        .toBe(asShell(c.expect.five, c.expect.fiveRolledOver));
      expect(sh(`_limit_field ${wrapper} seven`), `${c.file} seven: ${c.why}`)
        .toBe(asShell(c.expect.seven, c.expect.sevenRolledOver));
```

Then flip the ONE reason literal Task 2 planted, in
`describe('a rolled-over account is ELIGIBLE — _avail answers eligibility, not rank')`:

```typescript
    expect(sh('_limit_score claude'),
      'the reason eligibility holds: an honest unknown, not an inferred zero').toBe('');
```

- [ ] **Step 3: Write the TypeScript guard's own tests**

In `server/test/projected-home.test.ts`, add these two `it`s at the end of
`describe('projectHome ranks unmeasured below measured')` (after the existing
`'ties go to the earlier account in roster order'` case, before that describe's closing `});`):

```typescript
  it('an INFERRED zero never beats a measured account — the placement magnet, third site', () => {
    // `L(0, 0)` with both flags set is the shape readLimits produces for an
    // account whose windows have turned over: the zeroes are real fields on the
    // wire (the accounts screen renders them as "reset") and they are not
    // measurements. Before this fix `measured()` read only `five`/`seven`, so
    // `b` scored 0, beat `a` at 5, and — since nothing runs on an account
    // nothing was placed on — went on beating it forever.
    //
    // Same magnet, same shape, as the two already recorded in this function's
    // docstring; this is the site that fires on a HEALTHY fleet every time a
    // window turns over, rather than only on an account nobody ever measured.
    expect(projectHome(r, {
      a: L(5, 5),
      b: { ...L(0, 0), fiveRolledOver: true, sevenRolledOver: true },
    })).toEqual({ wrapper: 'a', score: 5 });
  });

  it('ONE rolled window is enough to make the row unmeasured — the score is a maximum', () => {
    // `measured()` already refuses a HALF-NULL row for this reason, in its own
    // words: "the score is a MAXIMUM, so `{five: 3, seven: null}` bounds the
    // truth only from below and could really be 99". A half-INFERRED row is the
    // same bound reached by a different route — the new 5h window has been
    // running for an unknown time and nobody has read it — so it gets the same
    // answer. `b` is not scored at 40 here; `a` at 50 wins by being the only
    // account anyone has actually measured.
    //
    // SUPERSEDED BY FIX ROUND 1 — the comment this plan originally specified
    // here said bash does NOT agree on this shape and that a shared fixture
    // over it "would red the parity harness by design". Both clauses were made
    // false by the same round that closed D-1927:
    // `_limit_score` now answers "" unless BOTH halves are measured, so bash
    // agrees, and `half-rolled-window` IS in the shared leastLoaded fixtures.
    // What shipped is the corrected text; see the ledger entry. This case
    // survives because it pins the RULE in isolation, over a synthetic roster,
    // the way its neighbours do.
    expect(projectHome(r, {
      a: L(50, 50),
      b: { ...L(0, 40), fiveRolledOver: true },
    })).toEqual({ wrapper: 'a', score: 50 });
  });
```

- [ ] **Step 4: Run the suites and verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-limits.test.ts test/projected-home.test.ts
```

Expected: **5 assertions red**, derived by reading when this plan was written. Record the actual
output.

1. `ccd-limits.test.ts` → `_limit_field rollover > agrees with readLimits on every shared fixture`.
   `rolloverCases` iterates in order and `rolled-seven.json` is first, so the run stops at
   `rolled-seven.json five: both windows reset before now` with `expected '0' to be ''`. Four fixture
   rows have moved behind it (`rolled-seven` five and seven, `rolled-five-only` five,
   `gpt-spaced-rolled` seven) plus `no-reset-fields-old` five from the age branch — five rows in one
   `it`, which reports as one assertion.
2. `ccd-limits.test.ts` → `a rolled-over account is ELIGIBLE… > _avail says yes for an account whose
   windows have both reset`. Its FIRST assertion still passes; the second fails with
   `the reason eligibility holds: an honest unknown, not an inferred zero` and `expected '0' to be ''`.
3. `projected-home.test.ts` → `projectHome agrees with ccd _ws_least_loaded > rolled-over-window`,
   on assertion 1 (`expect(projected, c.why).toEqual(c.expect)`): `expected { wrapper: 'claude',
   score: 0 } to deeply equal { wrapper: 'claude-a', score: 10 }`, headlined with the new `why`.
4. `projected-home.test.ts` → `an INFERRED zero never beats a measured account`:
   `expected { wrapper: 'b', score: 0 } to deeply equal { wrapper: 'a', score: 5 }`.
5. `projected-home.test.ts` → `ONE rolled window is enough to make the row unmeasured`. Today
   `measured()` reads only `five`/`seven` (`server/src/limits.ts:40-41`), so `measured(b)` is
   `max(0, 40) = 40`, which is LESS than `a`'s 50 and `projectHome` answers `b`:
   `expected { wrapper: 'b', score: 40 } to deeply equal { wrapper: 'a', score: 50 }`.

If your run shows four rather than five, or names different cases, **stop and re-derive** — the
fixtures moved since this plan was written.

- [ ] **Step 5: Make `measured()` refuse to score an inferred zero**

In `server/src/limits.ts`, replace `measured()`'s docstring and body (currently `:26-41`). Keep the
existing docstring exactly as it is and APPEND the new paragraph before the closing `*/`, then change
the expression:

```typescript
/** An account's pressure, or `null` when NOTHING has measured it — the
 *  distinction the whole placement rule turns on (see `projectHome`). Absent
 *  row, `five === null` and `seven === null` are one answer: unknown. A
 *  half-measured row counts as unknown too, and that is not a hypothetical
 *  shape — `~/.cc-limits/gpt.json` really is `{"five": null, "seven": 0}`,
 *  because gpt has no 5h window at all.
 *
 *  Term for term the same rule `pwa/src/fleet/SwapSheet.tsx`'s `load` already
 *  applies to the SWAP recommendation, and for the same reason its docstring
 *  gives: "an account nobody could read was recommended precisely BECAUSE
 *  nobody could read it". One known window is not enough either — the score is
 *  a MAXIMUM, so `{five: 3, seven: null}` bounds the truth only from below and
 *  could really be 99. The swap picker learned this first; placement is the
 *  other half of the same lesson.
 *
 *  AN INFERRED ZERO IS UNKNOWN, and that is the third site of the same magnet.
 *  A rolled-over row carries a REAL `0` on the wire — the accounts screen
 *  renders it as "reset" — but that 0 was derived from a timestamp, never
 *  observed. Read as a measurement it was the best score on the fleet, so
 *  placement went there; nothing runs on an account nothing was placed on, so
 *  nothing ever replaced it. Unlike the two magnets above, this one fires on a
 *  perfectly healthy fleet, every time a window turns over.
 *
 *  ONE rolled window is enough, for the same reason one null window is: the
 *  score is a maximum, and the elapsed half bounds the truth only from below.
 *  Both flags are consulted, and either one alone answers null.
 *
 *  ccd's mirror says this by saying nothing — `_limit_field` prints "" for a
 *  window that has ended, which `_limit_score` (its ranking reader) and that
 *  function's three callers already read as unmeasured. Two languages, one fact. `projected-home.test.ts` runs
 *  both over the same bytes. */
const measured = (l: AccountLimits | undefined): number | null =>
  !l || l.five === null || l.seven === null || l.fiveRolledOver || l.sevenRolledOver
    ? null
    : Math.max(l.five, l.seven);
```

- [ ] **Step 6: Make `_limit_field` answer "" for a window that has ended**

In `ccd/ccd`, replace the function header line (currently `:11728`):

```bash
_limit_field() {   # wrapper five|seven [maxage-secs] -> that limit %, or "" if unknown/stale
```

with:

```bash
_limit_field() {   # wrapper five|seven [maxage-secs] -> that limit %, or "" when unknown
  # FOUR conditions answer "": no file, no value for this field, a caller that
  # demanded fresher telemetry than exists, and a value whose own window has
  # ENDED. They mean one thing to every caller — nobody has measured this
  # window — and what they must NOT mean is 0, which is a measurement.
```

Then replace the comment block and the two branches (currently `:11735-11758`):

```bash
  # A reading whose own window has already reset describes a window that ENDED.
  # resetAt comes straight from the API (statusline-command.sh), so this is fact,
  # where the age rules below are inference. It matters because telemetry is only
  # written when a session renders its statusline: an idle account stops
  # reporting entirely, so its last sample can outlive its window by days.
  # Observed 2026-07-27: claude read seven=98 for 14h after its 7d window reset,
  # which excluded it from every pool and stranded two sessions on gpt.
  # Both rules below rewrite a KNOWN value; neither may conjure one. gpt.json carries
  # `"five": null` with no 5h window at all, and a reset timestamp for a window nobody
  # ever measured says nothing about its value — "unknown" has to stay "" (readLimits
  # keeps it null), or _limit_score's wholly-unknown branch becomes unreachable.
  reset=$(_limit_json_num "$f" "${field}ResetAt")
  if [[ -n "$val" && -n "$reset" && "$now" -ge "$reset" ]]; then
    printf '0'; return 0
  fi
  # Fallback when the file carries no resetAt (the gpt 429 exclusion, and files
  # written before those fields existed): a sample older than its own window has
  # certainly rolled over. (7d decays slowly, so a stale seven only zeroes after
  # a full week.)
  if [[ -n "$val" && -n "$ts" ]]; then
    [[ "$field" == "five"  && $((now - ts)) -gt 18000  ]] && val=0
    [[ "$field" == "seven" && $((now - ts)) -gt 604800 ]] && val=0
  fi
  printf '%s' "$val"
```

with:

```bash
  # A reading whose own window has already reset describes a window that ENDED.
  # resetAt comes straight from the API (statusline-command.sh), so this is fact,
  # where the age rule below is inference. It matters because telemetry is only
  # written when a session renders its statusline: an idle account stops
  # reporting entirely, so its last sample can outlive its window by days.
  # Observed 2026-07-27: claude read seven=98 for 14h after its 7d window reset,
  # which excluded it from every pool and stranded two sessions on gpt.
  # Both rules below RETRACT a known value; neither may conjure one. gpt.json carries
  # `"five": null` with no 5h window at all, and a reset timestamp for a window nobody
  # ever measured says nothing about its value — "unknown" has to stay "" (readLimits
  # keeps it null), or _limit_score's wholly-unknown branch becomes unreachable.
  reset=$(_limit_json_num "$f" "${field}ResetAt")
  if [[ -n "$val" && -n "$reset" && "$now" -ge "$reset" ]]; then
    # WAS `printf '0'`. That 0 was INFERRED from a timestamp, never observed,
    # and it entered the ranking as the best measurement on the fleet:
    # _limit_score returned max(0,0)=0, and _ws_least_loaded's strict `<` kept
    # it over every account that had honestly reported. Nothing runs on the
    # account it won, so nothing ever replaced the 0 — the emptiest-looking
    # account was simply the one whose window had lapsed. Same magnet, same
    # shape, as the two unknown-is-zero defects recorded in _ws_least_loaded and
    # _swap_target; this is the third site, and unlike those two it fires on a
    # perfectly healthy fleet every time a window turns over.
    #
    # The honest answer is "": this window ended and nobody has measured the new
    # one. _avail keeps the account ELIGIBLE (see its comment — eligibility and
    # rank are different questions), _ws_least_loaded skips it, _swap_target
    # ranks it last at 100. Availability does not change; only preference does.
    return 0
  fi
  # Fallback when the file carries no resetAt (the gpt 429 exclusion, and files
  # written before those fields existed): a sample older than its own window has
  # certainly rolled over. (7d decays slowly, so a stale seven only answers
  # unknown after a full week.) Same answer as the branch above and for the same
  # reason — this path INFERS that the window turned over, so it may not report
  # a measurement. The server's mirror sets fiveRolledOver/sevenRolledOver on
  # exactly this path for exactly this reason (server/src/limits.ts).
  if [[ -n "$val" && -n "$ts" ]]; then
    [[ "$field" == "five"  && $((now - ts)) -gt 18000  ]] && return 0
    [[ "$field" == "seven" && $((now - ts)) -gt 604800 ]] && return 0
  fi
  printf '%s' "$val"
```

`_limit_score`, `_avail`, `_ws_least_loaded` and `_swap_target` are **NOT edited** in this step. They
already read `""` as unmeasured; that is the whole reason this fix fits in one branch.

**AMENDED BY FIX ROUND 1 — two of those four WERE edited, in the follow-up commit `2b8743bd`.** The
sentence above is true of *this step* and false as a claim about the task, so it is corrected rather
than left to mislead. `_limit_score` gained the `||` (either half unknown makes the row unknown) and
lost its `: "${five:=0}"` defaults; `_avail` was rewritten to read `_limit_field` directly and refuse
only a KNOWN half at the ceiling, which is what let `_limit_score` tighten without stripping the gpt
lane of its only exclusion. `_ws_least_loaded` and `_swap_target` are genuinely untouched in both
commits. See D-1927 for the argument and the measurements.

- [ ] **Step 7: Name the new source of "unknown" where the three sites explain themselves**

Three comment-only edits in `ccd/ccd`, so the next reader of each site learns that unknown now has a
second, routine source.

**7a.** In `_avail`, immediately after the line `#   • This function answers "may a session RUN here"` …
paragraph — that is, after the paragraph ending `passes only while unknown is available.` and before
the line beginning `#   • Ranking is where unknown must lose` — insert:

```bash
  #     AND UNKNOWN IS NO LONGER RARE. Since the provenance fix, _limit_field
  #     answers "" for a window that has merely ENDED, not only for an account
  #     nobody ever measured — so every account passes through unknown each time
  #     a window turns over, on a healthy fleet. That makes this function's
  #     permissiveness load-bearing rather than a corner case: a rolled-over
  #     account is available today because it scored 0 and available now because
  #     it scores unknown, which is the same answer for an honest reason.
```

**7b.** In `_ws_least_loaded`, the comment block lists the ways the server's copy is stricter than
bash and promises they are "stated here rather than discovered later". The block says **TWO** and
closes by claiming parity holds because **both** gaps are unreachable — so adding a third that this
plan's own text calls REACHABLE falsifies the sentences on either side of the list. Fix those two
sentences FIRST, then insert the item.

**7b-i.** Replace the paragraph that introduces the list (currently `ccd/ccd:3800-3802`):

```bash
  # The server's copy (projectHome, server/src/limits.ts) is stricter about
  # "unknown" in TWO ways this is not, and both are stated here rather than
  # discovered later:
```

with:

```bash
  # The server's copy (projectHome, server/src/limits.ts) is stricter about
  # "unknown" in THREE ways this is not, and all three are stated here rather
  # than discovered later:
```

**7b-ii.** Then replace the opening sentence of the paragraph that closes it (currently
`ccd/ccd:3815-3816` — the two lines shown, not the whole paragraph, which continues `file carries a
null half…` and is unchanged):

```bash
  # Parity holds today because both gaps are reachable only through the SAME
  # account: gpt is the only telemetry:'none' account and the only one whose
```

with:

```bash
  # Parity holds today on gaps 1 and 2 ONLY, and they are reachable only
  # through the SAME account: gpt is the only telemetry:'none' account and the
  # only one whose
```

Gap 3 is live from the moment this change ships — a single Anthropic account with one window turned
over reaches it — which is exactly what makes it worth writing down.

**7b-iii.** Only now, immediately after item `2.` (the paragraph ending `and the server picks the
cheapest fully-measured one.`), insert the third item:

```bash
  #   3. It treats a HALF-ROLLED row as unknown, where _limit_score scores it by
  #      its surviving half. Since the provenance fix, _limit_field answers ""
  #      for a window that has ended, so `{five: <ended>, seven: 40}` reaches
  #      _limit_score as `("" , 40)` — its `: "${five:=0}"` substitutes 0 and the
  #      wholly-unknown branch does not fire, giving 40, while projectHome's
  #      measured() reads the row's fiveRolledOver flag and answers unknown.
  #      Unlike gaps 1 and 2 this one is REACHABLE: it needs only one Anthropic
  #      account with one window turned over. Not closed here, deliberately —
  #      relaxing _limit_score's `&&` to `||` would make `_limit_score gpt`
  #      unknown for gpt's real half-null file, hence `_avail gpt` always true,
  #      hence _gpt_status unable to report the Codex weekly cap at all. The
  #      clean close is a second channel on _limit_field (an exit status telling
  #      "absent" from "inferred") so _limit_score can tell them apart; recorded,
  #      not chosen. projected-home.test.ts keeps no fixture on this shape,
  #      because a shared fixture over it would red on parity by design.
```

**7c.** In `_swap_target`, inside the `UNMEASURED RANKS LAST` comment, immediately after the paragraph
ending `Eligibility must survive; only preference changes.`, insert:

```bash
    # And unmeasured now has a SECOND source, routine rather than exceptional:
    # since the provenance fix a candidate whose window has merely ended reads
    # unmeasured too. It stays eligible and ranks 100 here, which is the correct
    # treatment — its old inferred 0 made it the preferred rescue destination on
    # a fleet where nothing had run on it, which is the magnet this comment
    # already describes, arriving by a third route.
```

- [ ] **Step 8: Re-stamp `ccd/ccd`'s provenance marker**

`ccd/ccd` carries `# ccrc:generated 1 sha256=…` on line 2, and every edit invalidates it. A stale
marker does not fail quietly — it makes ccrc's own freshly-deployed ccd report `ccrc-edited` on every
box forever, which is the verdict that tells the installer NOT to replace it.

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

`markGenerated` is idempotent (it strips any existing marker before hashing), so this is safe to run
whether or not the file is already stamped. Run it AFTER every ccd edit in this task, including the
mutation-and-restore cycles in Step 10 — or simply run it once more immediately before Step 11.

- [ ] **Step 9: Run the suites and verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-limits.test.ts test/projected-home.test.ts test/limits.test.ts test/accounts-route.test.ts test/ownership.test.ts
```

Expected: **all five green.**

- `ccd-limits.test.ts` — the shared-fixture case now agrees in both directions; the two Task 2 pins
  pass, one of them for its new reason. The five `_gpt_status` cases at `:97-142` are unaffected: each
  writes either a recent `ts` with no lapsed reset, or a `sevenResetAt` in the future, so neither
  branch fires and `_gpt_status`'s `: "${five:=0}"` defaults see exactly what they saw before. The two
  `2026-07-27` cases at `:200-223` still pass — and now for the honest reason: `_avail claude`
  succeeds through `_limit_score`'s wholly-unknown branch rather than through a fabricated 0.
- `projected-home.test.ts` — `rolled-over-window` now answers `claude-a` at 10 on both sides,
  `all-rolled-over` still answers `claude` at 0 on both sides, and both new TS cases pass.
- `limits.test.ts` and `accounts-route.test.ts` — unchanged and green. `limits.test.ts` never
  reaches `projectHome` at all; `accounts-route.test.ts` **does**, through `GET /api/accounts`
  (`server/src/server.ts:1185`), and asserts `projected` twice (`:122`, `:137`) — but both of those
  fixtures carry `fiveResetAt: t + 9000` / `sevenResetAt: t + 400000` (`:115`, `:130`), so no row is
  flagged and `measured()` answers exactly what it answered before. The wire fields are untouched,
  which is the evidence for the spec's claim that both UIs are unaffected. **If a rollover fixture is
  ever added to that suite it will move `projected` — check the resetAts before assuming a red there
  is a flake.**
- `ownership.test.ts` — green iff Step 8 ran.

Then the neighbours that read the same helpers but seed no `resetAt`:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-account-ok.test.ts test/ccd-login-screen.test.ts test/ccd-pool-ok.test.ts test/ccd-workspaces.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected: all pass with **no edits needed** — checked when this plan was written (see the File
Structure notes). `typecheck-tests.test.ts` is a known load flake; re-run it in isolation before
calling it a real break, and CI on the quiet box is the arbiter.

- [ ] **Step 10: Verify all four guards are real by mutating them**

One at a time; restore (and re-stamp, for the ccd ones) between mutations. Record before/after.

- **M1 — the bash resetAt branch.** Put `printf '0'; return 0` back in place of the bare `return 0`.
  Re-stamp, re-run `test/ccd-limits.test.ts test/projected-home.test.ts`. Expect the shared-fixture
  case, the `_limit_score claude` reason assertion, and `rolled-over-window`'s bash half to go red.
- **M2 — the bash age branch.** Put `&& val=0` back in place of `&& return 0` on both lines.
  Re-stamp, re-run `test/ccd-limits.test.ts`. Expect the shared-fixture case red on
  `no-reset-fields-old.json five`.
- **M3 — `measured()`.** Delete `|| l.fiveRolledOver || l.sevenRolledOver`. Re-run
  `test/projected-home.test.ts`. Expect `rolled-over-window`, `an INFERRED zero never beats a measured
  account` and `ONE rolled window is enough` red — and note that `all-rolled-over` stays GREEN, which
  is correct: with every account inferred-0 the tie-break still keeps the first.
- **M4 — `_avail`'s permissiveness (the pin Task 2 planted).** Change
  `sc=$(_limit_score "$w"); [[ -z "$sc" ]] && return 0` to `… && return 1`. Re-stamp, re-run
  `test/ccd-limits.test.ts`. Expect **FOUR** assertions red: both Task 2 cases — `_avail says yes…`
  on its first assertion, and `_swap_target still names a destination…` on
  `expected '' not to be ''` — **and both cases of
  `describe('the account that was stranded on 2026-07-27')` (`:214`, `:219`), which seed the same
  rolled `claude.json` and therefore reach `_avail`'s unknown branch for the first time after
  Task 3.** `:214` asks `_avail claude` directly and gets `NO`; `:219` loses the home-recovered
  branch, falls into the must-leave loop and answers `claude-b` (57) instead of `claude`, because
  the only accounts still eligible are the two that never rolled. That widening is the point: the
  2026-07-27 rescue now depends on `_avail` staying permissive over *unknown*, where before Task 3
  it depended on a fabricated 0. **This is the measurement Task 2 was written to make possible** —
  before Task 3 this mutation was unreachable, because a rolled-over account scored a confident 0
  and never took `_avail`'s unknown branch at all.

If any mutation reds FEWER assertions than listed, the guard is under-pinned: add the missing case
rather than accepting the count.

- [ ] **Step 11: Commit — both languages, one commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add ccd/ccd server/src/limits.ts server/test/fixtures/leastLoaded.ts server/test/ccd-limits.test.ts server/test/projected-home.test.ts
git commit -m "fix(limits,ccd): an inferred zero is unknown, not the emptiest account on the fleet (D-1925)

_limit_field printed a confident 0 for a window it had only inferred had ended,
and measured() read the mirrored 0 the same way. _limit_score returned max(0,0),
_ws_least_loaded's strict < kept it over every honestly-reporting account, and
nothing runs on an account nothing was placed on — so the rolled-over lane won
placement and went on winning. bash now answers \"\" and TypeScript's measured()
answers null; the wire, the flags and both UIs are untouched.

Eligibility deliberately unchanged: _avail stays permissive (unknown is
available) so a hard-blocked session always has a destination. _limit_score,
_ws_least_loaded and _swap_target are unedited — they already read \"\" as
unmeasured.

Both languages in ONE commit: projected-home.test.ts drives bash and TS over one
seeded HOME and reds on parity alone. leastLoaded's rolled-over-window is
rewritten, not deleted (spec R7) — it asserted the defect was correct.

Mutation measured: restoring printf '0' reds 3 assertions; restoring the age
branch's val=0 reds 1; deleting measured()'s flag check reds 3; making _avail
refuse unknown reds 4."
```

- [ ] **Step 12: Deploy AGENT-FIRST, and read the window honestly**

```bash
cd "$(git rev-parse --show-toplevel)"
bash deploy/deploy.sh agent <host>    # ccd/ccd first — the server reads what the fleet host writes
bash deploy/deploy.sh                 # then the server
```

`<host>` comes from `~/.ccrc/deploy.env`'s `CCRC_AGENT_BOX` when omitted; deploy.sh has no default
target and refuses with exit 2 rather than guessing, and the agent lane never falls back to
`CCRC_BOX`.

**Then read the result correctly.** The ~20 live supervisors keep executing the pre-deploy inode until
the `KillMode=process`-gated sweep restarts them, so `_auto_swap_check`'s placement on a live session
does not change at deploy time. `ccd ws-add` is a fresh process and picks it up immediately. Do not
hand-`install_atomic` the new `ccd`, and do not read "nothing moved on the box" as a failed deploy
until the sweep has run. The server lane's final gate is `/health` reporting the shipped sha.

---

## Deviations found

- **D-1925** — `_limit_field`'s `resetAt` branch printed `0` for a
  window it had inferred had ended, and `server/src/limits.ts`'s `measured()` read the mirrored `0`
  as a measurement. `_limit_score` returned `max(0, 0)`, `_ws_least_loaded`'s strict `<` kept it over
  every honestly-reporting account, and because nothing runs on an account nothing was placed on, no
  real number ever replaced the inferred one: the rolled-over lane won placement permanently. Third
  site of the magnet already recorded in `_ws_least_loaded` and `_swap_target`, and the only one that
  fires on a healthy fleet. Fixed by Task 3.
- **D-1926** — `server/src/limits.ts`'s age fallback wrote an inferred `0` and left
  `fiveRolledOver`/`sevenRolledOver` **false**, so `AccountsScreen.tsx`'s `Bar` and
  `AccountsStrip.tsx`'s `LimitRow` rendered `0%` — a measured zero — for a window nobody had measured.
  The flag's own docstring already defined it as "the 0 above is inferred rather than observed"; this
  path was the one writer that never honoured it. Fixed by Task 1.
- **D-1927** — Task 3's own fix opened this and Task 3 closed it, in the
  follow-up commit `2b8743bd`. On a row with ONE window rolled over, TypeScript's `measured()`
  answered `null` (the flag is set, and the score is a maximum bounded only from below) while bash's
  `_limit_score` substituted `0` for the empty half and answered the surviving one — so
  `{five: <ended>, seven: 5}` scored 5, and an account whose 5h state nobody had measured ranked
  emptiest on the fleet and won every placement. That is the plan's own magnet reaching through the
  readable half, on a shape every Anthropic account enters at each 5h reset. **Found and FIXED**
  (operator/coordinator ruling, fix round 1, overriding this plan's original decision to defer).

  Why the deferral was overridden: it is NEW (before Task 3 both sides answered 40), it is routine
  rather than exceptional, and its dangerous direction restores the defect the plan exists to remove.

  The close is not the `&&`→`||` relaxation this entry originally rejected, because that rejection
  was CORRECT and was re-measured: with `_avail` still routed through `_limit_score`, gpt's real
  `{"five": null, "seven": 99}` went from EXCLUDED to "enabled, available" and three `_gpt_status`
  assertions went red. The shipped close separates the two questions instead — ELIGIBILITY NEEDS ONLY
  A LOWER BOUND, RANK NEEDS A FULL MEASUREMENT. `_limit_score` answers `""` unless BOTH halves are
  measured (and `: "${five:=0}"`, which WAS the magnet, is deleted); `_avail` no longer consults it at
  all, reading `_limit_field` itself and refusing only a KNOWN half at or above the ceiling. `_avail`'s
  extension is byte-identical to the `max(five, seven) < SWAP_CEILING` it replaced on every shape —
  only its dependency moved. Pinned by the new SHARED fixture `half-rolled-window`
  (`server/test/fixtures/leastLoaded.ts`), which is the coverage whose absence made the divergence
  invisible: reverting `||` to `&&` reds it and nothing else.

  Still open and NOT closed by this: `_limit_field`'s single output channel cannot distinguish an
  ABSENT value from a RETRACTED one, which is an overloaded null at a seam whose callers handle the
  two differently. It is harmless today only because the one file with a null half (gpt's) is absent
  rather than retracted. The recorded close remains a second channel — an exit status separating the
  two — as its own change.
- **D-1928** — `FleetSession.limits` (`shared/api.ts:41`) carries
  `{five, seven}` and no provenance, so `pwa/src/fleet/SwapSheet.tsx`'s `load` ranks an inferred `0`
  as the emptiest pool and awards it the "suggested" tag — the exact defect that function's own
  docstring exists to prevent, reached through a seam it cannot see. `SessionLine.tsx` and
  `SessionActionsSheet.tsx` render the same two numbers with the same collapse. **Found, not fixed:**
  §B holds the wire still by design, and closing this means an additive `FleetSession.limits` field
  threaded through `reviveFleetSession` (which returns a literal, so a new field is a compile error
  until every path computes it), `server/src/fleet.ts:408`, and the PWA's three readers. Additive and
  absence-permitting, so it needs no `FLEET_PROTO` bump when someone does it.

**Minted 2026-09-08**, as part of one contiguous block of thirty (`D-1924`–`D-1953`, floor
1924 → 1954) covering all five plans on this branch, defined in the same act. The
"allocator unreachable" claim this paragraph used to carry was **wrong** — the fleet box reaches the
server over `CCRC_SERVER_URL`, and `ccrc-api ledger allocate` is a row in that client's closed table.
The measurement is in `2026-09-07-swap-verb-timeout.md`'s `## Deviations found`.

---

## Self-review

**Spec coverage.** §B has four requirements and this plan implements all four.

| §B requirement | Where |
|---|---|
| TS: `measured()` consults the rollover flags and returns `null` for an inferred zero | Task 3 Step 5 |
| bash: `_limit_field`'s `resetAt` branch returns `""`; `_ws_least_loaded`, `_swap_target` unchanged | Task 3 Step 6. **Amended:** `_limit_score` WAS edited in fix round 1 (`2b8743bd`) to close the divergence Step 6 opened; `_ws_least_loaded` and `_swap_target` are untouched |
| `_avail` deliberately unchanged — unknown stays available | **Behaviour** unchanged and pinned in both directions by Task 2 (mutation-measured as M4/M4′); its **implementation** was rewritten in fix round 1 to read `_limit_field` instead of `_limit_score`, with an extension byte-identical to the `max(five, seven) < SWAP_CEILING` it replaced. Unknown still stays available |
| The age-fallback path's dishonest `rolledOver` flag | Task 1 |
| §B.1: `rolled-over-window` rewritten, not deleted (R7) | Task 3 Step 1 |
| §B.1's measured mutation table (E12) | Task 3 Step 10 M1–M3 re-measure it; Task 1 Step 5 measures the age-flag guard |
| §B.2's honest cost — a shared reset boundary degrades placement to roster order | Pinned as the `all-rolled-over` fixture, Task 2 Step 1, in both languages |
| Both languages in ONE commit | Task 3 Step 11; Tasks 1 and 2 are each independently green, which is why they can precede it |
| §10's deploy window | Global Constraints, and Task 3 Step 12 |

Not in scope and not touched: §A (the probe), §C (the keepalive), §D (the pre-emptive lane), §E (the
swap verb timeout, already planned and shipping first). No `-authdead` marker, no
`ccd-account-health`, no `ccd-telemetry-keepalive`, no systemd unit, no doctor check.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N", no reference to a
function no task defines. Every code step carries its literal content, and every bash and TypeScript
edit is given as an exact before/after pair rather than a description. The four `D-TBD-<slug>` names
this section once carried were replaced by their minted numbers on 2026-09-08; no `TBD` remains.

**Type consistency.**
- `measured` keeps its declared type `(l: AccountLimits | undefined) => number | null`. The added
  disjuncts read two `boolean` fields that already exist on `AccountLimits`, so no cast, no widening,
  no new import.
- `readLimits`'s exported signature is unchanged; `fiveRolledOver`/`sevenRolledOver` change from
  `const` to `let` inside the try block and are still `boolean` at every use, including the two object
  literals at `:155` and (untouched) `:158` and `:184`.
- `asShell` changes arity from `(v: number | null) => string` to
  `(v: number | null, rolledOver: boolean) => string`; both of its call sites are updated in the same
  step, and it is module-private to `ccd-limits.test.ts`.
- The two new `LeastLoadedCase` entries match the interface exactly (`name`, `files`, optional
  `disabled` omitted, `expect`, `why`); `rolloverCases`'s modified entry keeps all four `expect` keys.
- The new `projected-home.test.ts` cases spread the existing local `L(five, seven)` helper, which
  returns a full `AccountLimits`, and override one or two boolean fields — so a field added to
  `AccountLimits` later is still a compile error at `L`, not silently defaulted at the call sites.
- `bash` has no types; the two branches change from `printf '0'; return 0` / `&& val=0` to `return 0`
  / `&& return 0`. `ccd` runs `set -uo pipefail` with **no** `-e`, so a `[[ … ]] && return 0` whose
  test is false leaves a non-zero status mid-function and execution continues to `printf '%s' "$val"`
  as before — this is the same idiom the two lines already used.

**Risks handed to the implementer.**

1. **The half-rolled divergence (D-1927) is introduced by this change, not
   inherited.** Today both sides agree on `{five: rolled, seven: 40}` at 40. After Task 3 they do not.
   **RESOLVED IN FIX ROUND 1** (`2b8743bd`), overriding the deferral this paragraph originally
   recommended: it was closed in the same task that opened it, `half-rolled-window` IS now a shared
   fixture, and the answer was not the exit-status channel but a separation of eligibility from rank.
   The paragraph is kept, corrected, because the risk it names was real and the reviewer it warned
   about did ask.
2. **The mutation counts in Task 3 Step 4 and Step 10 were derived by reading, not by running** — this
   worktree has no `server/node_modules`, so no suite was executed while writing this plan. E12 in the
   spec is the measured figure (2 bash assertions for the `resetAt` branch, +1 for the age branch, 5
   TS) and it describes the guards as they stand on `main`, which is why Step 4 asks you to STOP and
   re-derive if your run names different cases rather than to adjust an assertion.
3. **Step 4 expects FIVE red assertions, and the fifth is the one that reads like a green case.**
   `ONE rolled window is enough` is red on unmodified source because today `measured()` scores
   `{five: 0, seven: 40}` at 40 and `a` at 50 loses — the guard it pins is the one Step 5 adds, so
   of course it is red first. If you see four, one of the two new TS cases is not being collected —
   check the `describe` you appended into.
4. **Re-stamping `ccd/ccd` is easy to forget inside Step 10's mutate-and-restore loop.** Every ccd
   mutation invalidates line 2, and `ownership.test.ts` is not in the command lines for M1, M2 and M4.
   Restore, re-stamp, and re-run Step 9's first command before committing.
5. **`ccd-session-state`, `pr-sweep`, `session-hook`, `ccd-ws-gc` and `typecheck-tests` are known load
   flakes.** Re-run any red one IN ISOLATION before calling it a real break. None of them reads
   `_limit_field`, `_limit_score` or `readLimits`, so a red there is a flake or a genuine surprise —
   never an expected consequence of this change.
