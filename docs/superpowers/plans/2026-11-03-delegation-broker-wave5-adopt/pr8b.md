# PR8b (the adoption switch, its door, and what adoption would keep): departures and measurements

Run 1645, delegation broker wave 5. The operator asked on 2026-11-07 to switch adoption on from the console rather than from a
file. Until this PR `$REG/delegation-adopt` had no writer in the tree (O5-7 (a), D-7846), and the console showed none of what that
ruling asks the operator to read first. This PR gives the marker one writer behind an operator door, and serves through that door
what adoption would keep; the Settings card in front of it is the follow-on PR8c (below, "The split"). The coordinator's three rulings (R1, R2, R3) are the whole scope. What adoption keeps, and when, is unchanged.
Adoption stays shadow until the operator turns the switch on.

**Ledger.** Defined in the plan's "Deviations found": D-8112 (R1, the verb, the door and the guard), D-8113 (R2, the refusal rule)
and D-8114 (R3; here, its server half: the bounded list). Amended in place, to name D-8112: the plan's Global Constraints line "Stage marker
with no writer" (now "with one writer"), its Gate paragraph, Task 5.7.1's snippet and Step 1 (W5-X1, W5-X2), D-7846, and
`pr7b.md`'s opening paragraph; in fix round 1 (review 1659 F7, F12), also the "safe dark" paragraph, the snippet's `writer` line,
the Rider's "Never planned" list, two "Where things stand" lines, the Additive-wire constraint (it names `keeps`), and the comment in
`server/test/switches.test.ts`. Left, and why: the approved design spec (`docs/superpowers/specs/2026-10-04-delegation-broker-design.md`)
still says the marker has no writer, because the plan's rule is that feature PRs edit no spec text; and the programme ledger is the
coordinator's, folded on its own pull request. The block issued to this run is used whole.

## The floor rule, as built

Review 1451 F14's floor holds: no transition-table row, no loosened `assertLease` rule or decision, no changed fold of an existing
kind, and no journal kind, entry field or checkpoint member. The decider (`delegation-adoption.ts`) is unchanged in behaviour; FR1
exports its `definite`, and FR2 makes it a type guard (review 1665 N14, N18). The list of
worktrees a pass would keep is lane memory: the adoption step writes it into `AdoptLaneMemory.health` each pass, built by the
L1 `adoptionKeepsOf`, and it rides the health block's `adoption` member as the optional `keeps`. `watch.ts` +0 and `store.ts` +0.

## What was built

- **R1 (D-8112).** `ccd delegation-adopt --state on|off` (`cmd_delegation_adopt`, `cmd_scope_sweep_busy`'s shape) is the marker's one
  writer, listed in `ccd caps` and in `ccd/contexts.tsv` (C5). `CCD_ARGV.delegationAdopt` and its `verbRow` (`server/src/ccdargv.ts`),
  the agent's `['delegation-adopt', '--state']` grant, enrolled in `REQUIRED_VERB_FLAG` with its bypass fixture g28.
  `GET`/`POST /api/coord/delegation-adopt` in `coord/routes.ts`, session-gated, no box token, in `SESSION_ONLY`; CLAUDE.md's
  sentence that counts those doors names it (fourteen). The verb is in `FORBIDDEN_CCD_VERBS`, the child deny list
  (`shared/api.ts`), both deny lists of the session hook and the installer's child-deny loop, and CLAUDE.md's SAFETY section
  carries its bullet in `ws-lease-mark`'s shape. The verb is never a session's: the child hook and the child deny file stop a child;
  for a top-level session (a coordinator included) it is the same convention as `ws-lease-mark`'s, while the door refuses `on`
  without a signed-in operator (review 1659 F3, ruled; review 1665 N12). Since fix round 2 it is also on the installed direct
  entry's protected list (`ccd/ccd-entry.py#is_protected`) and the body's direct-entry guard, as `ws-lease-mark` is, so it starts
  under `bash -p` and a case-folded spelling a child might reach through an inherited `nocasematch` matches no verb (review 1665 N1).
  The verb is the tree's one writer; a session that writes the file directly is not stopped, as for every `$REG` marker (review
  1665 D2, a residual). The switchboard row names the writer; the three pins that said "no writer"
  (`switches-history`, `advance-switches`, `late-census`) now pin exactly this one, and a new row pins that the server reaches the
  verb only through its `CCD_ARGV` row.
- **R2 (D-8113).** `server/src/coord/delegation-adopt-switch.ts` (L1): `delegationAdoptCapsOf` reads the two capabilities from the
  fleet box's measured caps (`null` is `unmeasured` for both, never `absent`), `delegationAdoptRefusal` is the rule, and
  `delegationAdoptViewOf` is the GET's answer. The refusal words and statuses are declared once in `shared/delegation-adopt.ts`
  and spread into `REFUSAL_STATUS`. Since fix round 1 (review 1659 F2, ruled) the rule also takes `signedIn`, measured by the route
  as the collect-lane door does (sign-in armed and the caller holds a session): `on` without it is refused `sign-in-unarmed` (403),
  first, after the body parses and before any I/O (the sign-in arm is its own L1 function, which the whole rule calls too; review
  1665 N8); `off` never is. The GET says so for the caller that asks. `fleet-audit-missing` cannot arise from a shipped ccd, because
  `ccd caps` prints both words unconditionally; it stays because R2 rules it (review 1665 N3).
- **R3 (D-8114), the server half.** `DelegationAdoptionHealth.keeps` (`{items, more}`, at most `DELEGATION_ADOPTION_KEEPS_MAX = 50`
  items), its one reader `delegationAdoptionKeepsOf` (called by `adoption`'s reader, `delegationAdoptionHealthOf`, which drops a list
  it refuses), written by the adoption step each pass and served by the GET. A tree's `changes` are named only from a definite audit
  answer, the decider's own `definite`, now exported and reused (review 1659 F1). The list names only adoptions that applied, so it may
  be shorter than `adopted` (F11). Each item is R3's list: project, worktree and parent session, and no path (review 1665 N10); the
  reader checks each item's fields and an integer `more` of at least 0 (N19).

## The split

Full CI on this branch's first tip went red on `consolidation-path-guard.test.ts` (D-5855, spec 2026-10-19 §5.1 rule 8): a diff that
touches `pwa/` beside `shared/switches.ts` is refused, and R1 must edit `shared/switches.ts`. The coordinator ruled the split (run 1645,
2026-11-08), as D-7994's card was split (#2289, then #2322): this PR keeps R1, R2 and R3's server half, and the card follows in a
follow-on pull request, PR8c, a new run cut after this one merges. Every `pwa/` path went back to the merge base in one commit; the
card half is carried as a patch the coordinator holds. Three patches go to PR8c: the card (`pr8c-card.patch`), the wave-3 census's
PWA allow-list hunk (`pr8b-card-census.patch`), and, from fix round 1, `pr8c-shared.patch`: `DELEGATION_ADOPT_CAPS`, the caps union's
derived list, whose one reader is the card's wire guard, with its single-definition row (review 1659 F6; ask 335 ruled the move). Two
other exports got callers here: `delegationAdoptionKeepsOf` (above) and `DelegationAdoptRequest`, which types the route's body parse.
PR8c's card must also read `sign-in-unarmed` in the GET's `refused.on` (`DelegationAdoptOnRefusal`), which its patch predates: the
card needs a runtime guard for `DelegationAdoptOnRefusal` beside its type, or it reads every dark server's view as malformed (review
1665 N6, carried to PR8c). The card must also stop reading an item's `path`, which fix round 2 dropped (N10).
With the list gone, the caps union is derived from its table (`DelegationAdoptCap = keyof typeof DELEGATION_ADOPT_CAP_MAP`, the
refusal words' idiom), so the table is read and a word is spelled once; the PR8c patch adds the list back beside it.
The seventh mutant the ruling named (the card's confirmation skipped, red in 13 of 53 rows) moved to PR8c with the card.

## Precedent sites (D-7902, D-7994)

Every site `git grep` finds for `pane-scope-stop`, `scope-sweep-busy` and `coord/scope-sweep`, mirrored or set aside:

| Site | Here |
|---|---|
| `ccd/ccd`: the verb, `cmd_caps`, the dispatcher, the usage line, the staging-file comment above `_reg_purge` | mirrored |
| `ccd/contexts.tsv` | mirrored (C5, the lane's context) |
| `agent/src/whitelist.ts`, `REQUIRED_VERB_FLAG`, the bypass fixture, `legit-whitelist.ts`, `whitelist-structural.test.ts` | mirrored (g28) |
| `server/src/ccdargv.ts` (`CCD_ARGV`, `CCD_CAN`), `ccdArgvSamples.ts`, `id-argv-census.test.ts`, `whitelist-subset.test.ts` | mirrored |
| `server/src/coord/routes.ts`, `auth-gate.test.ts` and `gate.ts`'s counts, `coord-pause-route.test.ts`'s `SESSION_ONLY`, CLAUDE.md's door sentence | mirrored |
| `coordinator-skill.test.ts`: the unnamed-door list, and the pane-scope stop's forbid-mention row | mirrored. The door list sits beside the scope-sweep pair, as the leave agreed with the landing-order 5g run allowed. The forbid-mention row (the corpus never names the verb or its door, with a CONTROL) came in fix round 2, once #2453 had merged and released that file (review 1665 N4): a coordinator is a top-level session with permissions bypassed, so `FORBIDDEN_CCD_VERBS` never fires for it, and the convention, this row and the door's sign-in rule are what hold |
| `secret-mask.test.ts`'s unmasked-read list | mirrored |
| `shared/switches.ts`, `switches.test.ts`, `switches-history.test.ts` | mirrored, the no-writer pins re-pointed. Since fix round 3 (review 1669 A2) `switches-history` also carries the precedents' row that no non-shell file under `ccd/` or `deploy/` names the marker on a code line, with one exact allowance, `ccd/ccd-entry.py`'s protected-verb tuple, and its guard row is bounded to the guard's own grammar (C1) |
| `shared/scope-sweep.ts` (the L0 view) | mirrored as `shared/delegation-adopt.ts` |
| The PWA card and its wiring and tests (`ScopeSweepSection.tsx` and its siblings) | moves with the card, to PR8c (the split) |
| README's whitelist sentences | mirrored |
| README's operator prose for the door, its refusals and the verb (`scope-sweep`'s and `pane-scope-stop`'s paragraphs) | mirrored in fix round 1 (review 1659 F9), at the end of "Delegation observation"; the card's prose comes with PR8c |
| `fleetws.test.ts` and `watch.ts`'s coord frame member (`paneScopeStop`) | set aside: the door reads the registry itself, as `scope-sweep`'s does, and `watch.ts` stays +0 |
| `ccd/ccrc-doctor-checks` and its fixtures (`pane-scope-stop`'s check) | set aside: the door's GET is the operator's reading surface (R3), and no ruling asks for a doctor line; a new check would move every doctor fixture's count |
| `ccd/ccd-scope-sweep`, `deploy/measure-continuity.py`, `paneScopeFixture.ts`, `hibernate-census.test.ts` | set aside: specific to the sweep's own reader |
| `ccd/ccd-entry.py`'s protected list and the body's direct-entry guard | mirrored in fix round 2, as `ws-lease-mark` (review 1665 N1, ruled): the verb starts under `bash -p` with a clean environment; its rows ride `ccd-ws-lease-mark-reach.test.ts`'s table and `agent/test/ccd-entry-exec.test.ts`'s, and the route suite runs the real verb under `bash -p`, as the launcher starts it |

## Departures and notes

- The route carries one `ccdCan(deps.fleetState, 'delegationAdopt')` check after the rule, which `verb-gate.test.ts` requires at every
  `CCD_ARGV` call site. It is the exec path's verb gate, not a re-check (corrected in fix round 1, review 1659 F4): it reads the caps
  list the rule just read, and no I/O can run between (review 1665 N13), so it never refuses what the rule let through, and with the caps unread it
  permits, which is what lets `off` through. No behaviour row guards it; `verb-gate` does. Recorded in D-8113.
- A directory standing in the marker's place reads `set` (by name), so adoption runs live, while `on` answers "could not raise" and
  `off` "STILL on": the console cannot clear it, as with `scope-sweep-busy`. The failure is reported, not hidden; the hand step is
  removing that directory on the fleet box (README says so). The existing failed-raise row now also reads the GET's `set` (F10).
- Two POSTs at once are not serialised: the marker always ends in one state, but the feed row can name a move the registry no longer
  shows, the precedent door's posture (F11, left as ruled).
- A rollback (review 1665 N3; no mechanism, as R2 rules): after `on`, a fleet box rolled below this PR loses the verb, so the door
  refuses `off` (`fleet-switch-missing`) while the marker stands and the lane keeps adopting; a server rolled below it has no door.
  The hand step, in README and the plan's revert order: switch adoption off at the door before rolling the fleet box below this PR;
  if the door or the verb is already gone, remove `$REG/delegation-adopt` on the fleet box by hand.
- W4-U27's older-server render (`pwa/test/older-server-render.test.tsx`): with no card in this PR no PWA file reads the new member,
  and `keeps` is optional and additive, so the render cannot change; re-run alone at the tip all the same, green (F12).
- Main was merged once, after #2453 (landing order 5g) merged first, as the leave agreed with that run asks of the second to land;
  no conflict, and the route and census counts held on the merged tree, so none changed. Fix round 3 merged main a second time, as
  ruled, because #2470's two run-record routes conflicted in `auth-gate.test.ts`'s counts: every count was re-derived from main's
  figures plus this PR's two gated, non-exempt routes (`coord/routes.ts` 66, the table 190, the HTTP half 187: 117 gated, 70 exempt),
  and `gate.ts`'s docstring, which both sides had left at 185, now says 187. Every other count both sides touch held.
- The precedents' history split CLAUDE.md, the session hook and the installer into a rules-only change, at an external review
  gate's request. This PR keeps them in, because the brief and R1 ask for them here.
- The adoption switch's staging file `$REG/.delegation-adopt.<pid>.tmp` joins the R-3 boundary paragraph in `ccd/ccd`, whose cardinal
  `ccd-account-auth.test.ts` derives (twenty-two), as `scope-sweep-busy`'s did.

## For review

- The switch suite's real-verb row runs the verb under `bash -p` with six startup variables removed, where the launcher's protected
  start removes fifteen; the row's probe (the verb raises and lowers the marker) stands as it is (review 1669 A4).
- Carried to the programme ledger (review 1669 A5, ruled): the door keeps `pane-scope-stop`'s shape here, with no re-read after
  `ran:false` and the actor's feed row only on a measured change, so after a timed-out `on` the GET still shows the switch's
  position but who moved it can be missing; whether a switch door must record its actor when the verb may have run is a
  question for every such door at once.

## Measurements

**Mutants**, each from a saved copy, restored with its sha256 checked, every vitest call bounded by `timeout -k` and a process cap
measured from the user's thread count:

| Mutant | File | Red rows |
|---|---|---|
| M1 the marker write removed from the verb | `ccd/ccd` | 4 of 33 `delegation-adopt-switch` rows: "on writes the marker and off removes it", "a change is one record-only feed row", the dangling-link row and the failed-raise row. `advance-switches` survives it: the off arm's `rm` still reads as a write there |
| M2 `on` allowed without `lease-audit-v1` | `delegation-adopt-switch.ts` | 5 of 33 rows, among them "on: refused on unmeasured caps, on a missing verb, on a missing audit" and "the view" |
| M3 `on` allowed on unmeasured caps | `delegation-adopt-switch.ts` | 4 of 33 rows, among them "on: refused on unmeasured caps, on a missing verb, on a missing audit" and "the view" |
| M4 `off` refused when the caps lack `lease-audit-v1` | `delegation-adopt-switch.ts` | 4 of 33 rows, among them "off: refused only when the verb is missing" and "the view" |
| M5 the verb dropped from `FORBIDDEN_CCD_VERBS` | `approvalguard.ts` | R1's forbidden row (1 of 33); `ccd-spawn-child-settings`: the two lists stay equal (2 of 18) |
| M6 the list unbounded (the 51st served) | `delegation-adopt-switch.ts` | R3's bound row (1 of 33) |
| M7 the card's confirmation skipped | PWA card | moved to PR8c with the card (13 of 53 card rows, measured before the split) |

Every figure above was measured again at fix round 2's code (review 1665 N15), and M1 to M4 again on fix round 3's merged tip,
unchanged. Fix round 1's and fix round 2's own mutants are in the
report's FR1 and FR2 tables.

**Growth** over the merge base `12ce1ba7e` at fix round 2's code, and again over fix round 3's merge base `c6f05621c`
(`growthCheck.ts#netGrowth`, code lines): `ccd/ccd` +20, `server/src/coord/routes.ts` +36;
`server/src/watch.ts` +0, `server/src/coord/store.ts` +0, `ccd/session-hook.sh` +0 (two lines changed in place). The PR adds new files
under `server/src/coord/` and `shared/`, which waives the listed files; none passes 40 either way. `GROWTH_CHECK=1` growth-check green.
