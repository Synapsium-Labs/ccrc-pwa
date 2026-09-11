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

- **The matrix found two holes in the suite itself**, which is the reason it was run rather than
  assumed. Choosing the UTF-8 locale BY NAME picked `C.utf8`, whose collation is codepoint order, so
  the D-2522 block contrasted two locales that agree and stayed green with its guard deleted; and
  nothing drove the doctor at all. Both are fixed, and both blocks now carry a guards-the-guard case
  that fails loudly if the box has no locale exhibiting the property, rather than passing quietly.
