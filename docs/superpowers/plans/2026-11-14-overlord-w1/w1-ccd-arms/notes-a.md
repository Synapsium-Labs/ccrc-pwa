# Overlord W1 ccd arms, PR A: notes for the ledger

PR A builds Tasks 1 to 3 of [`w1-ccd-arms.md`](../w1-ccd-arms.md): `ccd keep-awake` and its library
`ccd/lib/long-lived.sh`, the fresh start's pass of keep-awake's own `.no-roll`, and the verb's argv, capability token,
whitelist row and SAFETY status. These notes are what the programme ledger should learn from it. Each departure carries
a plain-words slug (cross-plan ruling X9); none has a D-number.

## In short

- The verb, its token `keep-awake-v1` and the fifth library are built as the plan rules. Nothing calls the verb, so no
  marker exists on any box.
- A plain `--roll` now refuses a dangling `.no-roll` link (the plan's stated tightening), pinned first as a
  characterization of `main`'s behaviour and then flipped.
- The capability floor row's fact is the route field `acctorder`, not the markers, by the coordinator's ruling
  ([Section 3](#3-the-capability-floor-row)).

## 1. Growth, measured

Measured with `server/test/growthCheck.ts#codeLines`, against `origin/main` after the landing merge of pool set B2.

| File | Net code lines | Plan's estimate |
|---|---|---|
| `ccd/lib/long-lived.sh` (new, in full) | +31 | +23 to +28 |
| `ccd/ccd` | +3 | about +4 |
| `ccd (program)` | +34 | +27 to +32 |
| `ccd/ccrc` | +2 (the backup line and the floor row) | +1 to +2 |

*Table 1. Every row is at 40 or under, with no waiver. `GROWTH_CHECK=1` `growth-check.test.ts` is green.*

## 2. Departures, by slug

| Slug | What and why |
|---|---|
| `keep-awake-library-is-31-lines` | The library is 31 code lines, above the estimate of 23 to 28 but inside the 40-line rows. The two markers' creates are one spelled line each (so the single-definition scan sees each write), and the four read words take one line each. |
| `keep-awake-read-word` | `_keep_awake_ours` still answers rc 0 or 1, never 2. It also sets `KEEP_AWAKE_READ` to `ours`, `absent`, `foreign` or `unreadable`, so `off` alone tells a foreign marker (kept, exit 0) from one it cannot read (kept, exit 1), as question 8 rules. |
| `keep-awake-window-test-without-a-seam` | The case "a hand marker created inside the window survives `on`" wraps the real `_keep_awake_ours` in the test, so the library carries no test-only seam. |
| `keep-awake-caps-is-an-echo-line` | `ccd caps` advertises the verb and its token on one `echo` line beside `delegation-adopt`'s, not in the heredoc: newer verbs ride the echo lines below the heredoc, which sits above a frozen corpus. That is +1 to `ccd/ccd`, not +2. |
| `keep-awake-before-ws-lease-mark` | In every forbidden-verb list and in the direct entry's protected tuple, `keep-awake` sits before `ws-lease-mark`. The adoption marker's pin (`switches-history.test.ts`) reads the order `ws-lease-mark`, `delegation-adopt`, `roll` in those lists, so the pin holds unchanged; its one exact-line allowance, the entry tuple, gains the word. |
| `purge-inventory-is-63` | The plan says `_reg_purge`'s inventory comment becomes 61. `main` already counted 61 (the loads report's two files), so the two markers make 63. |
| `account-auth-test-has-no-verb-list` | The plan lists `server/test/ccd-account-auth.test.ts`'s verb list. On `main` that file holds no list of server-only verbs, so nothing was edited there. |
| `forbidden-verb-cases-are-named` | The classifier, the hook's two jq arms and the child deny file are each pinned by name in `ccd-keep-awake.test.ts`. The shared suites iterate the lists, so they would stay green if the word were dropped. |
| `two-commits-not-three` | Tasks 1 to 3 land as one implementation commit after Task 2's characterization commit. Their `ccd/ccd` hunks interleave, and a non-interactive split would have to cut lines apart. |
| `landing-merge-before-the-first-push` | Pool set B2 (#2887) merged before PR A's first push, so the branch absorbed `origin/main` once, clean, to carry the `CAP_FLOOR_FACTS` twin row (the coordinator's mail of 2026-11-16). |
| `no-set-side-fixture` | Carried from serviceability A (`pool-set-fixtures-record-continuity`): no fixture of PR A places a set-side session, so none needs a recorded continuity lane. |

*Table 2. Departures from the plan's text, each the builder's own call within the rulings.*

## 3. The capability floor row

The brief rules one data row in `CAP_FLOOR_ROWS` for `keep-awake-v1`, whose fact is the Overlord's stamped keep-awake
markers, and its twin in `CAP_FLOOR_FACTS`. The twin's type (`server/src/poolrule.ts#CapFloorRow`) takes a route field
as its fact, because the server sees a session's facts only through the registry's route read. `.no-roll` is not a route
field, and no existing reader on either side tells keep-awake's stamped marker from a hand-made one.

The coordinator ruled the fact `acctorder` (slug `keep-awake-floor-reads-the-ordered-list`): the Overlord's ordered
account list, written for the Overlord's row only by the designation's create, which also sets its keep-awake markers,
so it stands exactly while a box needs `ccd keep-awake`. The row is
`acctorder|keep-awake-v1|<remedy>`, whose remedy is the operator's own-shell step (`ccd keep-awake … --state off`, then
`ccd route … --set acctorder=`), and its twin is `{ fact: 'acctorder', word: KEEP_AWAKE_CAP }`. B1's readers refuse and
proceed on it with no code change (`ccrc-cap-floor-keep-awake.test.ts`), and B2's loss lane pushes on it
(`pool-set-loss-lane.test.ts`). A hand-made `.no-roll` never blocks an update or a rollback, which a marker fact would
have done. The refusal reads "a acctorder stands for …", B1's sentence shape, unchanged here.

`pool-set-loss-lane.test.ts`'s "second row on a copy" case used `acctorder` as its fictional field, which its own comment
says must be one no floor row uses; it now uses `profile`.

## 4. Verification

- New suite `ccd-keep-awake.test.ts` (31 cases) was green on its first run.
- The plan's suites, the library sites, the capability-token suites, the approval and hook deny suites, the context
  map, the split pin, growth-check armed, `deviation-refs`, `single-definition/*` and `rings/*` are green.
- The shellcheck ratchet is killed by the local test slice's 6 GB memory cap on `ccd/ccd`, so CI is the arbiter there.
  `shellcheck` reports nothing on `ccd/lib/long-lived.sh`.
