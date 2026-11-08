# PR8b (the adoption switch, and what adoption would keep, in Settings): departures and measurements

Run 1645, delegation broker wave 5. The operator asked on 2026-11-07 to switch adoption on from the console rather than from a
file. Until this PR `$REG/delegation-adopt` had no writer in the tree (O5-7 (a), D-7846), and the console showed none of what that
ruling asks the operator to read first. This PR gives the marker one writer behind an operator door, and puts a Settings card in
front of it. The coordinator's three rulings (R1, R2, R3) are the whole scope. What adoption keeps, and when, is unchanged.
Adoption stays shadow until the operator turns the switch on.

**Ledger.** Defined in the plan's "Deviations found": D-8112 (R1, the verb, the door and the guard), D-8113 (R2, the refusal rule)
and D-8114 (R3, the card and the bounded list). Amended in place, to name D-8112: the plan's Global Constraints line "Stage marker
with no writer" (now "with one writer"), its Gate paragraph, Task 5.7.1's snippet and Step 1 (W5-X1, W5-X2), D-7846, and
`pr7b.md`'s opening paragraph. The block issued to this run is used whole.

## The floor rule, as built

Review 1451 F14's floor holds: no transition-table row, no loosened `assertLease` rule or decision, no changed fold of an existing
kind, and no journal kind, entry field or checkpoint member. The decider (`delegation-adoption.ts`) is unchanged. The list of
worktrees a pass would keep is lane memory: the adoption step writes it into `AdoptLaneMemory.health` each pass, built by the
L1 `adoptionKeepsOf`, and it rides the health block's `adoption` member as the optional `keeps`. `watch.ts` +0 and `store.ts` +0.

## What was built

- **R1 (D-8112).** `ccd delegation-adopt --state on|off` (`cmd_delegation_adopt`, `cmd_scope_sweep_busy`'s shape) is the marker's one
  writer, listed in `ccd caps` and in `ccd/contexts.tsv` (C5). `CCD_ARGV.delegationAdopt` and its `verbRow` (`server/src/ccdargv.ts`),
  the agent's `['delegation-adopt', '--state']` grant, enrolled in `REQUIRED_VERB_FLAG` with its bypass fixture g28.
  `GET`/`POST /api/coord/delegation-adopt` in `coord/routes.ts`, session-gated, no box token, in `SESSION_ONLY`; CLAUDE.md's
  sentence that counts those doors names it (fourteen). The verb is in `FORBIDDEN_CCD_VERBS`, the child deny list
  (`shared/api.ts`), both deny lists of the session hook and the installer's child-deny loop, and CLAUDE.md's SAFETY section
  carries its bullet in `ws-lease-mark`'s shape. The switchboard row names the writer; the three pins that said "no writer"
  (`switches-history`, `advance-switches`, `late-census`) now pin exactly this one, and a new row pins that the server reaches the
  verb only through its `CCD_ARGV` row.
- **R2 (D-8113).** `server/src/coord/delegation-adopt-switch.ts` (L1): `delegationAdoptCapsOf` reads the two capabilities from the
  fleet box's measured caps (`null` is `unmeasured` for both, never `absent`), `delegationAdoptRefusal` is the rule, and
  `delegationAdoptViewOf` is the GET's answer. The refusal words and statuses are declared once in `shared/delegation-adopt.ts`
  and spread into `REFUSAL_STATUS`.
- **R3 (D-8114).** `DelegationAdoptionHealth.keeps` (`{items, more}`, at most `DELEGATION_ADOPTION_KEEPS_MAX = 50` items), its one
  reader `delegationAdoptionKeepsOf`, and the card "Worktrees left behind" in Settings › Automation after "Leftover processes"
  (`DelegationAdoptSection.tsx`, `useDelegationAdoptView.ts`, `delegationAdoptWords.ts`).

## Precedent sites (D-7902, D-7994)

Every site `git grep` finds for `pane-scope-stop`, `scope-sweep-busy` and `coord/scope-sweep`, mirrored or set aside:

| Site | Here |
|---|---|
| `ccd/ccd`: the verb, `cmd_caps`, the dispatcher, the usage line, the staging-file comment above `_reg_purge` | mirrored |
| `ccd/contexts.tsv` | mirrored (C5, the lane's context) |
| `agent/src/whitelist.ts`, `REQUIRED_VERB_FLAG`, the bypass fixture, `legit-whitelist.ts`, `whitelist-structural.test.ts` | mirrored (g28) |
| `server/src/ccdargv.ts` (`CCD_ARGV`, `CCD_CAN`), `ccdArgvSamples.ts`, `id-argv-census.test.ts`, `whitelist-subset.test.ts` | mirrored |
| `server/src/coord/routes.ts`, `auth-gate.test.ts` and `gate.ts`'s counts, `coord-pause-route.test.ts`'s `SESSION_ONLY`, CLAUDE.md's door sentence | mirrored |
| `coordinator-skill.test.ts`: the unnamed-door list | mirrored, beside the scope-sweep pair, as the leave agreed with the landing-order 5g run (claim 3773) allows; that leave allows no other edit there, so no forbid-mention row of the pane-scope stop's kind (`FORBIDDEN_CCD_VERBS` refuses the verb) |
| `secret-mask.test.ts`'s unmasked-read list | mirrored |
| `shared/switches.ts`, `switches.test.ts`, `switches-history.test.ts` | mirrored, the no-writer pins re-pointed |
| `shared/scope-sweep.ts` (the L0 view) | mirrored as `shared/delegation-adopt.ts` |
| The PWA card, hook and words; `pwa/src/lib/api.ts`; `settingsText.ts`; `SettingsDataProvider.tsx`; `AutomationSection.tsx`; the settings tests; a browser test | mirrored |
| README's whitelist sentences | mirrored |
| `fleetws.test.ts` and `watch.ts`'s coord frame member (`paneScopeStop`) | set aside: the door reads the registry itself, as `scope-sweep`'s does, and `watch.ts` stays +0 |
| `ccd/ccrc-doctor-checks` and its fixtures (`pane-scope-stop`'s check) | set aside: the card is the operator's reading surface (R3), and no ruling asks for a doctor line; a new check would move every doctor fixture's count |
| `ccd/ccd-scope-sweep`, `deploy/measure-continuity.py`, `paneScopeFixture.ts`, `hibernate-census.test.ts` | set aside: specific to the sweep's own reader |
| `ccd/ccd-entry.py`'s protected list | set aside: no switch verb is on it (`coord-pause`, `testbox-remote`, `pane-scope-stop`, `scope-sweep-busy`), the ruling names the hook and the classifier, and the entry protects verbs whose body re-proves a token |

## Departures and notes

- The route carries one `ccdCan(deps.fleetState, 'delegationAdopt')` check after the rule, which `verb-gate.test.ts` requires at every
  `CCD_ARGV` call site. It is a TOCTOU re-check, not a second rule: the caps can change across the listing's await (an agent
  reconnect), and it answers the rule's own word (`fleet-switch-missing`). Recorded in D-8113.
- The precedents' history split CLAUDE.md, the session hook and the installer into a rules-only change, at an external review
  gate's request. This PR keeps them in, because the brief and R1 ask for them here.
- The card's CSS class is `left-behind-keeps`, so no PWA stylesheet names the broker (`delegation-wave3.integration`'s scope census).

## Measurements

**Mutants**, each from a saved copy, restored with its sha256 checked, every vitest call bounded by `timeout -k` and a process cap
measured from the user's thread count:

| Mutant | File | Red rows |
|---|---|---|
| M1 the marker write removed from the verb | `ccd/ccd` | 4 of 22 `delegation-adopt-switch` rows, among them "on writes the marker and off removes it" and "a change is one record-only feed row". `advance-switches` survives it: the off arm's `rm` still reads as a write there |
| M2 `on` allowed without `lease-audit-v1` | `delegation-adopt-switch.ts` | 4 of 22 rows, among them "on: refused on unmeasured caps, on a missing verb, on a missing audit" and "the view" |
| M3 `on` allowed on unmeasured caps | `delegation-adopt-switch.ts` | 4 of 22 rows, among them "on: refused on unmeasured caps, on a missing verb, on a missing audit" and "the view" |
| M4 `off` refused when the caps lack `lease-audit-v1` | `delegation-adopt-switch.ts` | 4 of 22 rows, among them "off: refused only when the verb is missing" and "the view" |
| M5 the verb dropped from `FORBIDDEN_CCD_VERBS` | `approvalguard.ts` | R1's forbidden row (1); `ccd-spawn-child-settings`: the two lists stay equal (2) |
| M6 the list unbounded (the 51st served) | `delegation-adopt-switch.ts` | R3's bound row (1) |
| M7 the confirmation skipped in the card | `DelegationAdoptSection.tsx` | 13 of 53 `delegation-adopt-section` rows, among them "tapping on opens the sheet ... and sends nothing" and "Cancel sends nothing" |

**Growth** over the base (`growthCheck.ts#netGrowth`): `ccd/ccd` +20, `server/src/coord/routes.ts` +31, `pwa/src/lib/api.ts` +4;
`server/src/watch.ts` +0, `server/src/coord/store.ts` +0, `ccd/session-hook.sh` +0 (two lines changed in place). The PR adds new files
under `server/src/coord/` and `shared/`, which waives the listed files; none passes 40 either way. `GROWTH_CHECK=1` growth-check green.
