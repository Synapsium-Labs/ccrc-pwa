# Pool tag parity — one tag, one answer — Implementation Plan

**Goal:** `ccd` and the ccrc server both read `$REG/pools/<project>` and both apply a 64 and a
trailing-whitespace strip to decide the same question. Measured, they did not agree, and `ccd` did not
agree with itself across locales. Close the four divergences and replace the prose that was holding the
three implementations in step with a shared corpus.

**Architecture:** No new surface, no protocol change, no new verb. Three of the four fixes are one line
each — `local LC_ALL=C`, the idiom `ccd`'s own `_lc_dec_ok` already uses and documents — and the fourth
spells out a character class that was written as `\s`. The mechanism is a fixture table driven through
both readers, exactly the move `ccd-pool-ok.test.ts` already makes one layer up for the pool RULE.

**Lane:** touches `ccd/`, so **AGENT-FIRST** by the standing rule. Nothing here needs deploying
urgently: no project is tagged on any box, so `pools/` is absent from the registry listing and every
reader returns before doing any tag I/O. That is also what makes the behaviour changes free today —
see "What changes for a live box" below.

---

## Deviations found

- **D-2519 (2026-09-11)** — **The two readers strip different character classes, and the comment that
  said it was safe reasoned about the wrong gate.** `server/src/pools.ts` stripped with JS `\s`, which
  is Unicode; `ccd`'s `_project_pool_state` strips with `[[:space:]]`. Measured on bash 5.2.21 / glibc,
  tag content `pool-a` + one trailing character:

  | char | `ccd` | server (before) |
  |---|---|---|
  | U+00A0 NBSP | `malformed` | **`tagged pool-a`** |
  | U+2007 FIGURE SPACE | `malformed` | **`tagged pool-a`** |
  | U+202F NARROW NBSP | `malformed` | **`tagged pool-a`** |
  | U+FEFF BOM | `malformed` | **`tagged pool-a`** |

  In every one the SERVER is the permissive side — it forecasts a placement the authority refuses,
  which is the one direction `shared/poolrule.ts` exists to rule out ("never a 409 offering a crossing
  over a constraint that was never read"). `ccd` stays fail-shut at placement, so this is a wrong
  FORECAST and never a wrong placement.
  **The comment is half the defect.** `pools.ts` argued the bytes-vs-units mismatch was "sufficient
  here because anything non-ASCII fails `POOL_NAME_RE` below and is `malformed` on both sides
  regardless". That reasons about the regex as if it were the last gate. **The strip runs in front of
  it**, so a character the strip removed never reaches the regex. The sentence is true only once the
  strip is ASCII-only, which is what this change makes it.
  **Fix:** the class is spelled out as C's `[[:space:]]` — `/[ \t\n\v\f\r]+$/` — so both readers remove
  the same bytes and nothing else.

- **D-2520 (2026-09-11)** — **`ccd`'s reader is locale-dependent, so the AUTHORITY disagrees with
  itself on identical bytes.** `_project_pool_state` makes three locale-sensitive decisions — the
  `[[:space:]]` strip, the `-n 64` cap, and `_pool_name_valid` reached by dynamic scoping — and `ccd`
  sets no locale anywhere. Measured, same file, only `LC_ALL` changed:

  | tag | `LC_ALL=C` | `LC_ALL=en_US.UTF-8` |
  |---|---|---|
  | `pool-a` + U+3000 | `malformed` | `named pool-a` |
  | `pool-a` + U+205F | `malformed` | `named pool-a` |

  A systemd unit's minimal environment and an interactive shell are enough to disagree, and nothing in
  either reader can report which answer you got.
  **Fix:** `local LC_ALL=C` at the top of `_project_pool_state`. Function-scoped, not exported; bash
  re-reads the locale on assignment, the shadow reaches `_pool_name_valid` by dynamic scoping, and it
  does not leak back to the caller — all three measured.

- **D-2521 (2026-09-11)** — **The cap's own test said "bytes"; the cap counted characters.**
  `server/test/ccd-project-pool.test.ts:278`, inside the test whose title calls itself "the `-n 64`
  cap's only evidence at any plausible bound", opened "`read -r -d '' -n 64 v` bounds the read at 64
  bytes." `read -n` counts characters in the ambient locale, so the bound moved with the caller's
  environment: a 96-byte / 36-character tag walked straight past it. `pools.ts` had this right in its
  own comment; its mirror test did not. D-2520's shadow makes `read -n` count BYTES, so the sentence
  becomes true rather than being rewritten — and the comment now says which change made it true.
  This matters beyond the comment: it is the sentence that makes a BYTE cap look like an exact mirror
  of `-n 64`, and a 64-byte cap on the server would answer `tagged pool-a` for a marker padded with
  U+3000 that both readers call `malformed` (measured). A wrong comment aimed a plausible future fix
  at a new wrong answer.

- **D-2522 (2026-09-11)** — **`POOL_NAME_RE`'s `[a-z]` is a COLLATION range in bash, and the pin that
  holds the three spellings equal cannot see it.** `shared/roster.ts`, `ccd/ccd` and
  `ccd/ccrc-doctor-checks` each hold `^[a-z][a-z0-9-]{0,31}$`, pinned BYTE-EQUAL by
  `pool-name-parity.test.ts` (D-2480). They are equal as text and unequal as behaviour: under
  `en_US.UTF-8`, bash's `=~` ACCEPTS U+00E9, U+00E5, U+00FC and U+00F1 by collation, while the
  TypeScript regex is codepoint-based and rejects all four.
  **It bites at the WRITER, which makes it the only one of these four reachable through a supported
  command.** `cmd_project_pool` validates through `_pool_name_valid` before writing, so
  `ccd project-pool <p> pool-<U+00E9>` was accepted and the tag written — and the server reads that
  same file `malformed`. A tag the documented path creates and the console can never decide.
  **Fix:** the same `local LC_ALL=C`, in `_pool_name_valid` itself, so it covers both the reader's call
  and the writer's.

- **D-2542 (2026-09-11)** — **The same collation range, in the same verb, on the project name.**
  `_ws_project_valid`'s `[[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]` is two collation ranges with the identical
  exposure D-2522 describes, and `cmd_project_pool` calls BOTH — `_ws_project_valid` for the project,
  `_pool_name_valid` for the pool. Shadowing only the pool half would have shipped a half-fixed verb.
  **The asymmetry is what makes it worth taking here rather than later.** The reader is now
  locale-independent; this gate was not. A project tagged from an interactive shell (`LANG=en_US.UTF-8`)
  could then not be CLEARED from the fleet's own `claude-session@*` environment, which carries no
  `LANG` at all: the tag keeps constraining placement while `ccd project-pool --clear` refuses the very
  name that created it. A constraint you can create and cannot remove with the supported verb is worse
  than either locale's behaviour alone. Pre-existing on `main` — this change neither introduced it nor
  would have fixed it without being told.
  **Fix:** the same `local LC_ALL=C`.

- **D-2543 (2026-09-11)** — **REPORTED, NOT TAKEN.** `_rc_enabled` decides whether sessions spawn with
  `--remote-control` by squeezing whitespace out of the file's first line with
  `${first//[[:space:]]/}` — the same locale-dependent class, so a `remote-control` file whose `on` is
  followed by U+3000 reads `on` under a UTF-8 locale and not under `C`. Its doctor mirror
  (`ccrc-doctor-checks`, the `case "${first//[[:space:]]/}"` arm) repeats it. Verified by measurement,
  and deliberately NOT fixed here: it is a different subsystem from the pool tag, and a change whose
  scope is "one tag, one answer" should not quietly grow a remote-control fix. Filed so the finding
  survives the PR that found it.

- **D-2588 (2026-09-12)** — **FOUND IN THE FIX'S OWN SUITE, AFTER MERGE. The guard that protects the
  skips folded a fact about the HOST into a defect in this file.** The review round above turned two
  `guards the guard` cases from hard failures into skips, because a box that lacks the property a block
  needs must not go red for it. **The two host shapes are DIFFERENT, and only one of them is `C.utf8`**
  — measured: `C.utf8` collates by codepoint so it cannot exhibit D-2522, but it DOES classify U+3000 as
  `[[:space:]]`, so it exhibits D-2520 perfectly well. The D-2520 guard's host shape is a box with NO
  UTF-8 locale at all. One cause was given for both cases, and that imprecision is the same mistake at
  the level of the account: the guard that broke is the one whose host shape was never named.
  The replacement guard on the D-2520 block
  asserted `expect(localeWhere('echo yes')).not.toBeNull()` — which is a DIFFERENT property from the one
  it claims in its own comment. That comment says a null "must mean 'this box has no such locale' and
  never 'the probe is broken'"; the assertion cannot tell those apart, so on a box whose `locale -a`
  lists no UTF-8 locale at all — a minimal container, and the one shape of host the skip exists for —
  the honest answer reds. **Measured** by shimming `locale -a` to list only `C` and `POSIX`: **1 failed,
  29 skipped, 78 passed**, the 29 skipping correctly while the guard alone failed. Latent on every CI runner
  this repo uses: each carries at least one UTF-8 locale, which the green legs on `79d6d045` prove,
  since the old guard would have red otherwise.
  **This is the same class as the defect it replaced**, one seam over: the first version collapsed
  "cannot show the property" into RED, and its replacement collapsed "cannot show the property" into
  "the machinery is broken". No overloaded null at a seam — two conditions a caller handles differently
  must not carry the same value.
  **Fix:** `probeVerdict(candidates, found)`, four conditions and four values — `found`,
  `no-locale-tool` (no `locale` binary), `no-utf8-locale` (it lists none) and `probe-broken` (it lists
  some and a trivially satisfiable probe still matched none). Only the last is a defect here; the guard
  asserts `not.toBe('probe-broken')`. The candidate list is enumerated ONCE into `UTF8_LOCALES` so the
  question can be asked at all — the old `localeWhere` threw that list away.
  **And the decision is fed LITERALS.** A guard derived from the environment can only be exercised on a
  box that has the property, so the arm that matters elsewhere would ship unexecuted on every box that
  ships it; lifting the decision into a pure function lets one table drive all four arms everywhere,
  plus a distinctness case that reds on any fold. That is
  `a-derived-guard-is-only-testable-where-it-runs` applied to the guard instead of to the subject.

---

## What changes for a live box

Every behaviour change moves a verdict from `named`/`tagged` to `malformed`, on BOTH readers together,
for tags whose trailing padding is non-ASCII whitespace or whose name contains a non-ASCII letter. That
is the fail-shut direction and it restores parity rather than inventing a new rule.

**No live tag is affected, because there are none.** `ccd` has exactly one `mkdir` for `$POOLS_DIR`,
inside `cmd_project_pool`, so until an operator tags a first project the directory does not exist; the
server's reader returns on the parent listing before any tag I/O. This is the last moment these
verdicts can be corrected for free, which is an argument for doing it now rather than after the PWA
wave puts tags on boxes.

## Tasks

- [x] **Task 1 — `ccd/ccd` `_project_pool_state`: shadow the locale.** D-2520/D-2521.
- [x] **Task 2 — `ccd/ccd` `_pool_name_valid`: shadow the locale.** D-2522; covers reader and writer.
- [x] **Task 3 — `ccd/ccrc-doctor-checks` `_check_pools`: the same shadow.** It is the third reader and
      repeats the same cap, strip and grammar.
- [x] **Task 4 — `server/src/pools.ts`: spell the strip class out, and correct the argument.** D-2519.
- [x] **Task 5 — `server/test/ccd-project-pool.test.ts`: the cap comment becomes true.** D-2521.
- [x] **Task 6 — `server/test/fixtures/poolTag.ts` + `pool-tag-parity.test.ts`: the mechanism.** One
      corpus, three readers, every locale that exhibits the property. Every byte in the corpus is an
      escape, never a literal — half the rows turn on a character that is invisible in an editor.
- [x] **Task 7 — re-stamp `ccd/ccd`'s provenance marker.** `verifyMarker` reads `ccrc-unmodified`.
- [x] **Task 8 (follow-up, 2026-09-12) — `probeVerdict`: the skips' own premise.** D-2588. Shipped
      after merge as its own PR, per the standing rule that a fix lands in the open PR if there is one
      and in its own PR otherwise.

## Measurements

- **Red-first:** the new suite against this branch's parent — **15 failed / 54 passed of 69**.
- **Green:** with the fix — **91 passed of 91** (the corpus grew when the doctor was added).
- **Mutation matrix**, each guard removed ALONE, because emptying a helper reds if any one call site is
  pinned and hides which:

  | mutation | verdict | rows that failed |
  |---|---|---|
  | none (baseline) | GREEN | — |
  | drop the `_project_pool_state` shadow | RED (6) | U+3000, U+205F, the byte-cap row |
  | drop the `_pool_name_valid` shadow | RED (4) | exactly the four collation traps |
  | revert the server strip to `\s` | RED (7) | NBSP, FIGSP, NNBSP, BOM |
  | drop the doctor's shadow | RED (5) | the doctor's locale rows |
  | control: cap `>= 64` to `> 64` (D-2010) | RED (1) | the 64-byte row |
| drop the `_ws_project_valid` shadow | RED (1) | the source-level pin (D-2542) |
| drop `\v` and `\f` from the strip class | RED (2) | the VT and FF rows |

### The D-2588 follow-up (2026-09-12)

Measured by shimming `locale -a` to list only `C` and `POSIX`, which is what a minimal container really
reports — the condition could not otherwise be reached on any box in this fleet.

| run | before | after |
|---|---|---|
| this box (3 UTF-8 locales) | 108 passed | **115 passed** (7 new rows) |
| simulated box, no UTF-8 locale | **1 FAILED**, 29 skipped, 78 passed | **0 failed**, 30 skipped, 85 passed |

| mutation | this box | what failed |
|---|---|---|
| none (baseline) | GREEN 115 | — |
| `no-utf8-locale` arm returns `probe-broken` — **the shipped fold** | RED (2) | the `[] + null` row and the distinctness case |
| `no-locale-tool` arm returns `no-utf8-locale` | RED (2) | the `null + null` row and distinctness |
| `probe-broken` arm returns `found` — the guard stops guarding | RED (2) | the `probe-broken` row and distinctness |
| **control:** `localeWhere` always null while locales ARE listed | RED (1) | **the guard itself**, reporting "this box LISTS 3 UTF-8 locale(s) and `echo yes` still found none" |

The control is the row that matters, because the fix WEAKENS an assertion — `not.toBeNull()` became
`not.toBe('probe-broken')` — and a weakened guard that no longer catches anything is the obvious way to
get a green suite. It still fires on real machinery failure, and it fires with a message that names the
count it measured.

And the shipped fold, re-run under the shim, reproduces the original defect exactly — **3 failed, 29
skipped**: the guard reds on a no-UTF-8 box just as it did before, joined by the two literal-fed rows.
Those two are the point of the table: they red on THIS box, where the host condition cannot occur at
all, so the arm that only matters on some other machine no longer ships unexecuted.

### What the D-2588 review round found (and it found the same class AGAIN)

Four adversarial lenses, 19 findings, 3 surviving refutation — all prose, and the first is the reason
the round was run:

- **The fix's own comments named a subsystem its assertion cannot observe.** Three sites said
  `probe-broken` means "`LC_ALL` is not reaching the probe". The probe is `echo yes`, whose output is
  locale-INVARIANT — so a dropped `LC_ALL` reads as `found`, never `probe-broken`. The refuter set out
  to kill this and measured five ways of breaking delivery (drop the `env` spread, never set the key,
  misspell it, set it empty, baseline): **all five returned `found`**. So the message pointed a
  maintainer at the one subsystem it provably cannot reach, and on a polluted-stdout failure it is
  flatly false — `LC_ALL` IS delivered there while the message says it is not.
  **This is D-2588's own class, inside D-2588's fix**: a comment claiming a property the assertion does
  not have. Corrected — and the gap it revealed was CLOSED rather than just described: `runUnder` is now
  the one place a probe is spawned under a locale, and a new case asserts `LC_ALL` actually arrives over
  that same channel. A second copy of the `env` spread would have let the delivery check pass while
  `localeWhere` dropped `LC_ALL` entirely, so the two deliberately share one spawn site.
- **"Four rows, four arms" — the table has five.** The arm count is right and is pinned twice (the union,
  and the distinctness case's `.toBe(4)`); the row count was decoration that would go stale on the next
  row. Deleted rather than corrected.
- **One cause was given for two converted cases, and it fits only one.** `C.utf8` cannot exhibit D-2522
  — but it DOES classify U+3000 as `[[:space:]]`, so it exhibits D-2520 fine (measured). The D-2520
  guard's host shape is a box with NO UTF-8 locale at all, which is why that guard is the one that
  broke. Corrected in both copies, per `correcting-the-instance-is-not-correcting-the-claim` — the
  program ledger carried the same sentence verbatim.

**The delivery check's own mutation matrix**, which is separate from the verdict's:

| mutation | verdict |
|---|---|
| `runUnder` drops the `env` spread | RED (1) |
| `runUnder` misspells the key (`LC_ALl`) | RED (1) |
| `lcAllArrivingAs` stubbed to return its argument | **GREEN — reported, not hidden** |
| the probe made to exit non-zero, so every spawn THROWS | RED (1) — one clean assertion naming the throw, not a leaked exception |

The green row is an identity stub returning exactly what the assertion expects, and no mutation test can
catch "delete the measurement and hardcode the answer". The first two are its control: they mutate the
SUBJECT — the `env` spread `localeWhere` itself rides — and both red, which is what makes the green
interpretable as "undetectable by construction" rather than "nothing drives this". An earlier shape of
this check took a boolean from a helper; mutation showed a helper returning `true` satisfied it while
measuring nothing, so the comparison moved into the assertion.

**Two more defects of the same class, caught in this check before CI could find them.** It first looped
over EVERY UTF-8 locale the box lists and called `runUnder` with no `try`. Linux lists three; macOS
lists close to two hundred — so on the one platform this change is riskiest for, a single locale that
made bash exit non-zero would have leaked an unhandled exception and red a clean tree, which is the
exact shape this whole change exists to remove. The set is now the locales the file actually makes
claims about (the two the probes selected, plus the first candidate — the channel question is answered
by one locale as well as by two hundred), and a throw is returned as a `THREW:` VALUE the assertion
compares rather than an exception that escapes.
And its failure message said "did not arrive in the spawned shell", which does not fit the throw case —
naming a cause the assertion cannot distinguish, one more time. It now names what was observed and what
follows, and the received value says which of the two happened.

- **The matrix found two holes in the suite itself**, which is the reason it was run rather than
  assumed. Choosing the UTF-8 locale BY NAME picked `C.utf8`, whose collation is codepoint order, so
  the D-2522 block contrasted two locales that agree and stayed green with its guard deleted; and
  nothing drove the doctor at all. Both are fixed, and both blocks now carry a guards-the-guard case
  that fails loudly if the box has no locale exhibiting the property, rather than passing quietly.
