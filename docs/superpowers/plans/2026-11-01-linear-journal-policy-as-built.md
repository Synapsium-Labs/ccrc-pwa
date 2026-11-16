# Linear central key, task LK7: the journal and the policy point as built

Task LK7 of the Linear central key plan (#1444) builds the write journal (spec §7, D-7671) and the policy decision
point on writes (spec §8, D-7672). Its plan said where each piece lives. Measured on the tree it was built from, five
of those places could not hold as written, and one number records how each was settled.

- **D-7687 (2026-11-01)** — `linear-journal-policy-as-built`: the homes of the policy point's values, the services
  fake, the journal's grammars and field lists, and the policy point's two refusal words.

**Where the policy point's values live.** The plan put `askWithDeadline` and `allowAll` in `server/src/linear/policy.ts`
at L2, and said that if the rings table does not let L2 hold a value, `allowAll` lives in `index.ts`. Measured, the
rings (`server/test/rings/ring.ts#serverRing`) give L2 only to a file whose every top-level statement is a type, and
`askWithDeadline` holds a deadline timer, which is an L3 fact. So neither value can be in `policy.ts` if it is to stay
L2. Putting `allowAll` in `index.ts` would leave the test fake and row 10's "allow-all default" with no value to import,
except a second copy. So `policy.ts` holds the three types of spec §8, and nothing else. A new file,
`server/src/linear/policyPoint.ts` (L3), holds `askWithDeadline`, its two-second `LINEAR_POLICY_DEADLINE_MS`, the two
refusal words and `allowAll`. `index.ts` imports `allowAll` from there and wires it.

**The services fake.** The plan created `server/test/linearServicesFake.ts` in LK2, but LK2 is not open yet. LK7 creates
the fake with the signature the plan names, `linearServicesFake({clock?, db?})`. It holds the journal over an in-memory
coord.db, and `allowAll`. LK2 and LK3 add their builders to it, and whichever of them lands after this rebases.

**The journal's grammars.** The slot id and team key shapes the journal checks are the ones LK1 (#2041, open) exports
from `shared/linear.ts` (`LINEAR_UUID_SHAPE`, `LINEAR_TEAM_KEY_SHAPE`). Until LK1 lands they are spelled privately in
`journal.ts`, with the same text, and whichever of the two lands second makes the journal import LK1's. The issue
identifier is spec §5.1's grammar, with its team key bounded as LK1 bounds a team key.

**The field lists.** A row's `fields` comes from "the operation's closed list" (spec §7), and that list is LK8's
`LINEAR_OPS`, which does not exist yet. `LINEAR_JOURNAL_FIELDS` in `journal.ts` holds each write op's field names from
spec §5.3, less `requestId`, which changes nothing. LK8 derives one list from the other, so each name is spelled once.

**The policy point's refusal words.** The policy point answers `policy-denied` and `policy-unavailable`, and the journal
records them as a row's `code`. LK9 adds the proxy's words to `shared/refusal.ts`. Until then the two words are spelled
in `policyPoint.ts` (`LINEAR_POLICY_REFUSALS`). The journal takes any `ROUTE_REFUSALS` word, or one of these two. When
LK9 adds them to `shared/refusal.ts`, `policyPoint.ts`'s type names that table's words, and the journal's set is
unchanged.

Two smaller things. `server/src/accounts/audit.ts` exports `isMintedActor`, so the journal accepts only an actor the
account gate minted with `actorOf`, as the account audit does. `settle` takes the arguments in the order the plan wrote
them, `(id, outcome, code?, result?, masked?, decisionId?)`. It has no `workspaceId`, so a `key-add` row keeps a null
slot id unless LK11 states one when it inserts the row.
