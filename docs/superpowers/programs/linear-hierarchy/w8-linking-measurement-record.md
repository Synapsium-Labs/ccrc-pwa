# Wave 8 follow-up: workspace selection stated once, the suggestion remedies derived (run 3326, D-8808, D-8809)

The follow-up #3182 left as known limits (`w8-mapping.md`, Run 3279). No decision changes and no new deviation number: what
any door answers is as before. Two items.

## 1. Workspace selection, stated once and exactly (D-8808)

The operator's write decides the workspace stored beside a key in one place, `workspaceAfterWrite`
(`server/src/linking/policy.ts`). The policy comments and the coordinator plan reference
(`ccd/coordinator-skill/references/plan.md`, `## linking suggest`, "What the operator's save stores as the workspace") explain
these cases. The wire comment on `LinkingWriteBody` points to the decision owner and the reference:

| Write | Answer |
|---|---|
| A workspace named | It must hold the key, else `team-unknown`, as with no workspace connected; a named slot that cannot be read is `unavailable`, nothing written |
| Omitted, unchanged key | The stored choice, a stored none included; the store is not read |
| Omitted, changed key | A stored workspace while it holds the new key (`unavailable` while it cannot be read); otherwise as none named |
| None named (omitted as above, or explicit `null`, which reads the store with the unchanged key too) | The one connected workspace that holds the key; two holders `team-ambiguous`; a store that cannot be read, or any slot the answer depends on unread while two readable ones do not already hold the key, `unavailable`, nothing written; a key no connected workspace holds, every one read, or no workspace connected, stored with none |
| The keep of a stored none (review 2971 F2, review 3286 F1) | A row stored with no workspace keeps that none, with its evidence, when its unchanged key is sent back and one readable workspace holds it: named (another unread slot does not undo it) or not (every slot read). Only two readable holders undo it |
| A cleared key | Stores none; a workspace named with no key is `team-unknown` |

The coordinator reference's six bullets are pinned word for word (`coordinator-plan-reference.test.ts`, `WORKSPACE_CASES`);
loosening one of them was measured red (below). The decider's cases were already pinned as pure functions
(`linking-policy.test.ts`, `workspaceAfterWrite` and `writeReadsStore`); no test of a decision changed.

**For the ledger (D-8808):** its sentence on the write already matches the code. One case it does not say: a changed key with
the workspace omitted keeps a stored workspace while that workspace holds the new key, and is `unavailable` while it cannot be
read. The coordinator folds that in on the ledger pull request; this pull request leaves the plan untouched.

## 2. The suggestion remedies, derived (D-8808, D-8809)

**One owner.** `TEAM_SUGGEST_REFUSALS` and `TEAM_CONFIRM_REFUSALS` (`shared/linking.ts`) are each team door's own refusal
words. The handlers answer through `refuseSuggest` and `refuseConfirm` (`server/src/linking/routes.ts`), typed by those lists,
so a word outside a list does not compile. What each door answers is unchanged. The box token's `unauthenticated`, the
attribution check's words (suggest) and the door gate's words (confirm) pass through and are not in the lists.

**The guards that read it:**

| Guard | What it holds |
|---|---|
| `linking-door-refusals.test.ts` (new) | Each list equals what its handler answers, read from the handler's parsed calls (literals, and a decider's answer as the words its declared return type names); the handler reaches no refusal past its refuser but the pass-through ones; each list names a word once |
| `coordinator-plan-reference.test.ts` | The `## linking suggest` refusal list is now one line per word (`- \`word\`: remedy`). The words listed equal `TEAM_SUGGEST_REFUSALS` both ways, each once, and each line equals its pin in `SUGGEST_REMEDIES`, a record typed by the vocabulary, so a new word fails the tests' typecheck until it has a line |
| `overlord-skill.test.ts` | The team candidate paragraph lists the words in `TEAM_CONFIRM_REFUSALS` exactly once each, except `bad-request` (the door process composes the body; the exclusion fails the test if the word leaves the list). Each remedy equals its pin in `CONFIRM_REMEDIES`. The route call scan now lives in `linking-door-refusals.test.ts` |
| `single-definition/team-link-source.test.ts` | Each team-door list has one declaration, in `shared/linking.ts`; the scan checks ordinary variable declarations across shared, server, PWA and agent sources |

The guide changes: `no-project` and `linear-text-public` had no remedy of their own (they shared `bad-request`'s
parenthetical) and now have one. `bad-request` gained "The detail names the field: fix it and send again." `team-unknown`
gained "Check the key, and the workspace if you named one, before you send again." The other remedies moved from a
parenthetical to a line without changing their wording.

**Red first, measured** (each mutation was temporary and was restored after the check):

| Mutant | Red |
|---|---|
| M1: a raw `refuseRoute(reply, 'conflict')` added to the suggest handler | the scan guard (a pass-through it does not allow) |
| M2: `conflict` added to `TEAM_CONFIRM_REFUSALS` | the scan guard (the handler never answers it) and both confirm guide checks |
| M3: the Overlord paragraph's `no-project` renamed `no-row` | both confirm guide checks |
| M4: the Overlord paragraph's `team-ambiguous` remedy changed | the remedy check |
| M5: the Overlord paragraph's `write-failed` remedy dropped | both confirm guide checks |
| M6: the coordinator list's `no-project` renamed `no-row` | both suggest guide checks |
| M7: the coordinator list's `not-configured` remedy changed | the remedy check |
| M8: the coordinator list's `run-unreadable` line dropped | both suggest guide checks and the who-may-suggest pin |
| M9: a workspace case loosened (the two-readable-holders clause cut) | the workspace-cases pin |
| M10: `conflict` added to `TEAM_SUGGEST_REFUSALS` | both suggest guide checks and the scan guard |
| M11 (review fix): a second declaration of each vocabulary in the route module | both single-definition rows: the scan found both files |
| M12 (review fix): `no-project` and its remedy copied in the confirm paragraph | both confirm guide checks: the raw matches contained the word twice. The old checks passed with the same duplicate |

The independent reviewer ran four files at the feature commit `3211d85c3f`: `linking-door-refusals.test.ts`,
`overlord-skill.test.ts`, `coordinator-plan-reference.test.ts`, and `single-definition/refusal-table.test.ts`. Four cases were
red: the old confirm pin counted the old refuser's calls, two old suggest pins still expected the previous guide, and the
refusal-table guard treated the confirm list as a table group. The new scan passed. All four files passed at the reviewed
tip; the reviewer did not run the intervening commits.

**A judgement to check.** `refusal-table.test.ts` registers every exported `*_REFUSALS` group of `shared/` whose comment names
the Overlord as one of the Overlord spec's Table 11.6 groups. `TEAM_CONFIRM_REFUSALS` is a linking door's list (D-8809, this
programme's plan), not an Overlord group of that table, and none of its door-specific words is in the table, so its comment
names the door and its guard, not the Overlord. Registering it would need rows in the Overlord spec's table, which is not this
wave's.

**Review (a Sonnet per-task reviewer, read only):** no blocking finding; every stated case traced against the code. Two nits
folded: the none-named case names an unreadable store, and the scan guard's header states its width (calls counted by name,
so an inline send, another helper or an alias is not seen; a decider read by its declared words). One left: a named
workspace may also read as unmeasured when the legacy slot is unreadable and no file slot has that id; the sentences say "a
named workspace that cannot be read", which covers it loosely.

## Runs

Through the fleet test slice, each slice at most 12 files: the linking, guide and refusal-ratchet tests, the single-definition
guards in four slices, and the ring guards. Two timed out under load (16 cores, load average about 32): `rings/outward-edges`
(a 20 s timeout, alone too; this change adds only a type import, no runtime edge) and
`deviation-refs`' two-trees case (a 20 s timeout; its other 33 cases green). `single-definition/advance-switches` timed out
once in a slice and was green alone. The required checks are the arbiter for the two.
