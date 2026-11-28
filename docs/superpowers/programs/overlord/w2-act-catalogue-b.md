# Overlord W2, the act catalogue, PR B (run 4181, wave 255)

The task note of the act catalogue's second pull request: the may-act decider `overlordMayAct`, its bound allow, its one caller
file `mayActW2`, and the `OverlordPolicy` port. Plan: `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`, Tasks
B1 to B4. PR A (#3608) is merged; its note is `w2-act-catalogue-a.md` beside this one. No deviation number was issued for this
wave; every departure is named by slug below, for the coordinator to fold into the ledger.

## Step 0: what main held, measured against the plan

The plan is a snapshot of 2026-11-16. Measured on `main` at `9d3a88b0eb`:

| The plan says | Main holds | What this pull request did |
|---|---|---|
| §3: the ladder, the gates, the isolation word and the identity file are not built | All are built: `shared/overlord-ladder.ts`, `server/src/coord/overlordGate.ts`, `overlordGateRun.ts`, `shared/isolation.ts` (`IsolationRead`), `shared/overlord-identity.ts` (`CallerStrength`, `CALLER_STRENGTHS`, `VerbClass`), `server/src/auth/callerIdentity.ts` (`RecordedActor`) | Built against main's code (the coordinator's item 1) |
| The catalogue's kinds as Table 4 | PR A's catalogue, with the team link (`link-team`): class none, compensable, `refuse, refuse, allow`, its ceiling held by the linking rule, the operator's relink its compensator | Taken as it is (item 2). The team link has no class, so nothing needs a cover: step 9 (`not-an-answer`) answers it `allow`, authority none, pinned by a case |
| `overlordMayAct` reaches nine answers | The spec's H24 now also lists `reason-unmeasured` and `reason-stale` for R22's run acts (§7.1.1) | Not built: R22's kinds are not in the catalogue (PR A's known limit 1), so no row can need a measured reason. A later plan adds both with the kinds |
| `policy-refused` is not in the refusal table | Absent from `OVERLORD_REFUSALS` and from Table 11.6 | Added to the group at 403, with its one Table 11.6 row (item 7), after the holder's yes to the exact packet |
| The effect's ceiling verdict from `actCeilingStep` with the act's count not asked (question 10) | PR A's note and case: a counted act whose own count is not asked refuses `unavailable` | The decider takes the verdict as an input; the door that gathers it asks both counts (item 10, slug `ceiling-door-call-asks-both-counts` from PR A) |
| A door calls the decider | No door does: no W2 write door exists | Nothing is wired: no door's answer changes at merge (item 3), held by the importer census |

## What was built

- **The vocabulary** (`shared/overlord.ts`, L0): `MAY_ACT_ANSWER_MAP` (ten words, each marked whether it mints an allow),
  `MAY_ACT_ALLOW_WORDS`, `ACT_AUTHORITY_MAP` and `ActAuthority` (a union: `none` names no row, every other kind names one, so
  no overloaded null), `ALLOW_MODE_MAP`. `shared/overlord-identity.ts`: `CALLER_STRENGTH_RANK`, derived from
  `CALLER_STRENGTHS`' order, and `strengthAtLeast`.
- **`policy-refused`**, 403, in `shared/refusal.ts#OVERLORD_REFUSALS`, its pin in the refusal table's guard suite, and its
  Table 11.6 row.
- **The decider** (`server/src/coord/overlordMayAct.ts`, L1, C5): `overlordMayAct`, `grantCovers`, the facts and target types,
  the dormant `GrantFact` and `CommandFact`, the bound `MayActAllow` with its one minter, `isMayActAllow` and
  `spendMayActAllow`, and `mayActRank`, the answers' order. `isMayActKebab` admits every word the decider quotes to the
  coordination directory's kebab-token census (`server/test/mail-routes.test.ts`, one admission line, applied by packet with
  the file's holder's yes), each from its one list: the steps, the grant condition kinds, an answer's verdicts, and L0's
  answer, cover, cell and isolation words.
- **W2's one door** (`server/src/coord/overlordMayActW2.ts`, L1): `mayActW2`, which names every fact it passes and never
  spreads its input, so a caller cannot pass a grant, a command, an entry, answer verdicts, an arming or a row lookup through
  it: it calls the decider with six arguments, so the catalogue's rows answer.
- **The policy port**: `overlordPolicy.ts` (L2, types only: the port, its question, its check and the door's verdict, with the
  failure contract), `overlordPolicyAsk.ts` (L1: `askPolicy`, which reads a throw, an answer that throws when read and an
  answer of any other shape as `policy-refused`) and `overlordPolicyDefault.ts` (`allowAllPolicy`).
- **The censuses** (`server/test/single-definition/overlord-may-act.test.ts`): the importer census (no file, the wrapper
  included, re-exports anything of the decider), the allow's census and the strengths' one home, each with CONTROL cases that
  go red.

## The decider's steps, in order, and the answer word of each

Steps 1 to 3 are common; steps 4 to 16 run over each path a cover opens, first match; the best path answers. A plain refusal
beside an unread cover answers `unmeasured`; a `defer` stands.

| Step | Reads | Answers |
|---|---|---|
| 1, may carry | the act's row, the effect's row | `operator-only`: an act the lookup lacks; a carrier with no effect, a carrier effect, the server's act or an unknown one; a listed row carrying what it does not list |
| 2, the effect's ceiling | the effect's ceiling verdict | the verdict's own refusal (`act-ceiling` or `unavailable`, with its latch), or `unavailable` when a counted effect's verdict was not asked |
| 3, covers | each class member and its row, `CLASS_COVERS`, the entry, the request, the command, each grant | no path: `unmeasured` when a cover's fact was unread, else `operator-only`; class none is the one path `none` |
| 4, identity | the caller, the act's, the effect's and the grant's least strength | `identity-too-weak` |
| 5, isolation (command and grant paths) | the isolation read | `unmeasured` for an unmeasured read, `server-not-isolated` for `shared-user` |
| 6, the cell | the cell | `operator-only` under `by-grant` off the grant and command paths |
| 7, the arming (an `armed` cell) | the arming | `unmeasured` for an unread arming |
| 8, a command | | `allow`, authority `command` |
| 9, not an answer (class none or a request) | the row's `answer` column | `allow`, authority `none` or `request` |
| 10, evidence (an answer, or the grant path) | the answer's verdicts | `unmeasured` for an answer with no verdicts or an unmeasured evidence; `evidence-too-weak` |
| 11, askOrAct (an answer) | | `unmeasured`; `ask-is-cheaper` |
| 12, by class none, an entry or a request | | `allow`, authority `none`, `entry` or `request` |
| 13, the blind check (grant) | the answer's blind check | `defer` for every value but `clear-yes` and `not-armed` (read in the positive form) |
| 14, staging (grant) | an O3 member, the caller | `staged`, authority `grant` |
| 15, by grant | | `allow-by-grant`, authority `grant` |
| 16, the mode (every allow) | the cell and the arming | `armed`: mode `live` or `shadow`; `proposal`: the word becomes `staged`, mode `proposal`; `allow` and `by-grant`: mode `act` |

## Departures, by slug

- **`the-best-cover-answers`**: the plan's step 3 tries the covers in one order and runs the first that covers. No fixed order is
  monotone: a command skips evidence but needs isolation, a request needs evidence but not isolation, so either order lets
  removing one cover turn a refusal into an allow. Each cover that covers is a path, steps 4 to 15 run on each, and the most
  permissive answers (ties to the first in the plan's order). Monotonicity then holds by construction, and the property case
  measures it.
- **`an-unread-fact-is-its-own-word`** (the coordinator's item 5): the plan folds an unread fact into another answer (an
  unmeasured isolation into `server-not-isolated`, an unmeasured arming into `shadow`, an unmeasured grant fact into "not
  covered", an unmeasured request naming into `operator-only`, an unmeasured verdict into `evidence-too-weak` or
  `ask-is-cheaper`, an answer with no verdicts into `evidence-too-weak`). Each answers `unmeasured`, naming the fact. A tenth
  word, `unmeasured`, joins the plan's nine. When every covering path refuses and some cover's fact was unread, the answer is
  `unmeasured` too, because the unread cover might have allowed; a `defer` stands, because it ranks above `unmeasured` and
  removing the unread cover would raise the answer back to it. The blind check has no unread word in W2: step 13 is read in the
  positive form (review 4213 F1), so only `clear-yes` and `not-armed` go on and every other value defers, and W3's gatherer adds
  the `unmeasured` word and its arm. One answer is decided by the row, not the facts (review 4213 F4): on the grant path, an act
  that is not an answer and carries no verdicts answers `evidence-too-weak`, as the plan's F2 has it, not `unmeasured`; the two
  tie at rank 0, and W3 may split that value.
- **`the-oracle-is-written-apart`**: the decider's oracle (`server/test/sim/mayActSets.ts`) was written by a separate subagent
  from a rule list, never from the decider's code, and checked against it over an exhaustive sweep of the catalogue (every kind,
  every effect, every cell, eleven fact sets) and 2,000 seeded first-match cases with grants and commands. The sweep runs eleven
  fixed fact sets, not the plan's full product of every fact; the seeded draw and the named cases vary the rest. Fix round 1's
  three oracle rules (the evidence path, the blind check's positive form, an unknown condition kind) were written apart again,
  from the rule text, by a subagent that did not open the decider.
- **`entry-and-request-never-tie`**: the plan's cover order puts an entry before a request, but no class takes both covers, so
  the two never cover the same members; a named case pins that, and the other tie orders are tested.
- **`the-arming-is-read-before-the-blind-check`**: the plan reads the arming when the allow is minted, after the blind check. An
  unread arming refuses there, which would let a clearer blind check turn a `defer` into a refusal, so the arming is read at
  step 7, right after the cell. The plan's `unmeasured` reads `shadow` is replaced by `unmeasured` (item 5).
- **`grant-covers-answers-three-ways`**: the plan's `grantCovers` answers a boolean. It answers covers, not covered with its
  reason, or unmeasured with the fact, read whole: any failing check is not covered, else any unread fact is unmeasured. A
  condition of a kind this build does not know cannot say: it is unmeasured, never a cover (review 4213 F2), and the
  condition's union is derived from its map, keyed both ways at compile time (F10).
- **`every-answer-carries-its-evidence`** (item 5): each arm of `MayActAnswer` carries `evidence` (the step, the path and what
  it read), so an answer without it does not compile (a case in the decider's suite holds that, in the expect-error form). The
  sweeps also compare it at value level against the oracle: the path that answered, and a read that is not empty (review 4213
  F5).
- **`a-grant-matches-the-members-row`**: the plan says a grant's effect is "the act's effect". A grant covers a member when its
  effect is the kind of the row the member comes from: the act's own kind for an act member (`approve-spec` carrying nothing),
  the effect's for an effect member (`relay` carrying `widen-scope`).
- **`w2-also-stages-a-proposal`**: the plan says W2 answers `allow` and `operator-only` on real rows. Under a `proposal` cell
  (`start-programme` and `rekick-coordinator` at `advise`) a class-none act or one an operator request covers mints `staged`,
  mode `proposal`, and an answer kind answers `unmeasured`. The W2 suite pins the set exactly: `allow` (by none or a request),
  `staged` with mode `proposal`, `operator-only` and `unmeasured`, never `identity-too-weak`.
- **`the-port-file-holds-types-only`**: the plan puts `askPolicy` in the port's file. A port file is L2 only when every
  statement is a type, so `askPolicy` lives beside it in `overlordPolicyAsk.ts` (L1).
- **`policy-verdict-names-its-cause`**: `askPolicy` answers `policy-refused` with its cause, `refused`, `threw` or
  `malformed` (an answer that is not a check), and the reason, so a throw is a refusal with its own evidence (item 8). The
  reason is the adapter's own for its refusal, and a fixed one otherwise: `the policy threw` and `the policy answered no
  check`. A thrown value's text is never forwarded, and the call and every read of its answer sit inside the try, so an
  answer's getter, a Proxy's trap or a thrown value that cannot be turned into text refuses too (review 4213 F3).
- **`default-adapter-reads-l1`**: the plan rings `overlordPolicyDefault.ts` L3; it makes no I/O, so the rings read it L1.
- **`policy-adapter-composed-with-its-first-door`**: the plan wires `allowAllPolicy` into `server/src/server.ts`. No door asks
  the port yet, and no deps object of today would read it, so the composition builds it with the first door that asks
  (request record B or act rows B). `server/src/server.ts` is untouched.
- **`mutant-sets-beside-their-cases`**: the decider's sets live in `server/test/sim/mayActSets.ts` and the wrapper's, the ask's
  and the strengths' in `server/test/sim/mayActW2Sets.ts`, both spread into `ACT_CATALOGUE_MUTANT_SETS`, so the floors suite's
  import list is unchanged.
- **`mutation-by-the-in-tree-runner`**: the plan's by-hand mutation steps (apply, run, restore) are replaced by the in-tree
  mutant sets, each at floor 1, which the floors suite runs on every change.
- **`act-authority-is-a-two-arm-union`**: the plan gives `ActAuthority` a nullable id. It is a union: `none` names no row (id
  `null`), and every other kind names its row's id, so no overloaded null.
- **`the-census-admits-the-deciders-words`**: `isMayActKebab` and its one admission line in the coordination directory's
  kebab-token census (`server/test/mail-routes.test.ts`) are outside every Files list of the plan. The census reds a word the
  decider quotes unless a guard derived from its home list admits it; the line was applied by packet with the holder's yes, and
  a case reds the guard when it admits a foreign word (review 4213 F6).
- **`policy-refused-joins-the-w2-group`**: the refusal table's guard suite (`server/test/single-definition/refusal-table.test.ts`)
  gains `policy-refused` in its `W2_GROUP`, outside B1's Files list; in fix round 1 its comment and one test title name Table
  11.6 beside Table V1 (review 4213 F9), each change applied by packet with the holder's yes.
- **`allow-all-is-tested-on-what-w2-mints`**: the plan says the default adapter passes "every row's allow". Its case passes
  every allow the W2 door mints at every cell and for every kind with no effect; an allow carrying an effect (a relay an
  operator request covers) is not in that case. The adapter reads nothing of the allow, so the effect cannot change its answer.

Brief item 9: everything here is the product's own decider, port and tables, read by the server. Nothing rests on a surface one
agent harness has.

## The spec row

The one row added to Table 11.6, in its neighbours' form, beside `identity-too-weak`:

| Word | Door or lane | Meaning | Call |
|---|---|---|---|
| `policy-refused` | Every Overlord write door, after `overlordMayAct` allows | The `OverlordPolicy` port refused the allowed act, or its adapter threw or answered no check | H24 |

## Mutation, before and after

Measured with the in-tree runner (`server/test/sim/mutation-floors.test.ts`, the five keys alone). The plan's three figures were
estimates; these are counts. Every set is new, at floor 1, every mutant killed.

| Decider | Before (main) | After the build | After fix round 1 (review 4213) | The plan's least |
|---|---|---|---|---|
| `server/src/coord/overlordMayAct.ts#overlordMayAct` | none | 63 of 63 (each step's comparison, each cover's fact, each binding field, the allow's freeze, registry and spend, the best path and the rank) | 66 of 66 (D40 and D41 rewritten to the positive form; D65 the blind check read in the negative form, D66 the evidence emptied, D67 the kebab guard admitting every word) | 24 |
| `server/src/coord/overlordMayAct.ts#grantCovers` | none | 19 of 19 (each check, each condition, each unread fact, and the order of a failing and an unread one) | 21 of 21 (G20 an unknown kind read as the recommendation, G21 an unknown kind covering) | 10 |
| `server/src/coord/overlordMayActW2.ts#mayActW2` | none | 10 of 10 (each dormant fact passed through, each gathered fact dropped) | 11 of 11 (W11 a row lookup passed through) | 5 |
| `server/src/coord/overlordPolicyAsk.ts#askPolicy` | none | 8 of 8 (a throw rethrown or passing, a malformed answer passing, the reason and cause, the adapter asked twice) | 11 of 11 (P1 to P8 on the new text; P9 the thrown text forwarded, P10 the answer read outside the try, P11 a non-object answer passing) | none named |
| `shared/overlord-identity.ts#strengthAtLeast` | none | 4 of 4 (the comparison and the derived order) | 4 of 4 | none named |

The review's two surviving mutants of its own, the kebab guard admitting every word and every evidence emptied, are D67 and D66.

Left out as equivalent, measured: in the decider, staging without its O3 test (only O3 takes a grant, so every grant path holds
an O3 member); in the wrapper, the caller, the isolation and the grant facts (known limit 3).

The first decider failed the strict monotonicity case (`defer` ranked above the other refusals, Table 11.7b): an unread cover
turned a `defer` into `unmeasured`, and an unread arming refused after the blind check, so a removal or a weakening uncovered a
`defer`. Both were fixed before the first commit (slugs `an-unread-fact-is-its-own-word` and
`the-arming-is-read-before-the-blind-check`); the property now holds with `defer` ranked 1.

No floor was lowered.

## What the pieces after this one call, and with which facts

- **The W2 write doors** (act rows B's own-record doors, request record B, the relay) call `mayActW2(act, effect, target,
  gathered, now)` inside their transaction, `gathered` holding the caller's strength (`CallerIdentity`), the isolation read
  (`IsolationReader`), the bound operator request or none, the effect's ceiling verdict from `actCeilingStep(act, effect, {
  act: <the act's count>, effect: <the effect's count> })` with both counts read, the cell from step 10's pass, the natural key
  and the live generation. Each such file adds itself to `W2_IMPORTERS` in the census in its own pull request. After an allow
  and the egress check, the door asks `askPolicy(policy, { allow, verbClass, actor })` and sends `policy-refused` on a
  refusal; the first such door builds `allowAllPolicy` in the composition.
- **Act rows A's writer** takes the allow: `isMayActAllow` at run time, `spendMayActAllow` once (a second spend answers
  `false`), compares the allow's act, effect and target with its row, maps mode `proposal` to a proposal row, and re-runs
  `actCeilingStep` for the act's and the effect's groups inside its write. It imports `MayActAllow`, `isMayActAllow` and
  `spendMayActAllow` and adds its row to `MAY_ACT_IMPORTERS`.
- **W3** feeds grants and commands, gathers the answer verdicts and the arming, replaces `mayActW2`, and lifts the census.

## Known limits

1. R22's `reason-unmeasured` and `reason-stale` are not built (Step 0).
2. The allow's census is a text census over `server/src`: a forgery it does not see still fails `isMayActAllow`, which the
   decider's suite holds.
3. Three of the wrapper's inputs (the caller, the isolation and the grant facts) cannot change a W2 answer on the real rows, so
   their mutants would be equivalent and are not in the set; the decider's own set holds each.
