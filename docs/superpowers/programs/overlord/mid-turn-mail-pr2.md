# Overlord wave 173, mid-turn mail PR 2: notes for the ledger

This note records what PR 2 of the mid-turn mail plan built and measured, and where it departs from the plan. The
coordinator folds it into the programme ledger and mints any numbers. No D-number is defined here.

## In short

- **Built, and inert:** Tasks 2.1 to 2.5 of `docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, all except the mail
  ingress. These are:
  - the L1 sender rule (`server/src/coord/urgentMail.ts#urgentSenderVerdict`), which decides who may mark a mail
    urgent and one outstanding urgent mail per sender and recipient;
  - the store read that feeds it (`CoordStore.urgentVerdict`);
  - migration 107 (`mail.urgentAs` and the partial index `mail_urgent`), with its one writer (`insertMail`);
  - the inbox set's predicate, named once (`ACKABLE_OUTSTANDING_SQL`);
  - the hold's read (`CoordStore.urgentHolds`);
  - the three refusal words, named in the coordinator's mail reference.
- **Split by the coordinator's ruling** (slug `ingress-waits-for-routes`): `server/src/coord/routes.ts` is untouched,
  so `POST /api/mail` still ignores `urgent`, no mail is marked urgent, and every reader answers none. The ingress, its
  echo and ruling N10 follow in PR 2b, once the file is free.
- **Growth,** by the growth check's counter against `main` at `cb101e0ee`:

  | File | Code lines |
  |---|---|
  | `shared/api.ts` | +1 |
  | `server/src/coord/store.ts` | +30 |
  | `server/src/coord/schema.ts` | +4 |
  | `shared/refusal.ts` | 0 (three words added to existing lines) |
  | `server/src/coord/routes.ts` | 0 |

  No waiver.
- **Migration slot:** #3056 took 105 and #2997 took 106, so this is 107. The pins moved with it: `coord-db`'s version
  pins and `run-close-switch`'s rollback, which drops the column and index and replays fifty-four entries.

## 1. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `ingress-waits-for-routes` | `server/src/coord/routes.ts` is held by another programme's frozen wave (run 1850, claim 5482), and its holder refused two packets: the first because its import hunk bordered the holder's own lines, the second because its insert and 202 blocks carry #3056's keyed code, which the holder's frozen tree predates. By the coordinator's ruling, this PR lands everything but the route, inert. `POST /api/mail` does not read `urgent`, so a send carrying it, of any value, is treated as today: a 202 with no echo, `urgentAs` null, and an empty hold. A route case pins that. PR 2b adds the ingress later: five hunks in the handler (net +14 lines, no import), the echo, ruling N10 and the ingress cases, on `main` as it is then. The packet waits in a scratch clone. | `server/test/mail-urgent-route.test.ts` |
| `n10-moves-to-2b` | Ruling N10 (`urgent` among `mailKeyVerdict`'s compared fields, and its echo on a `same` replay) moves whole to PR 2b. A compared field means something only if the route's keyed request carries it, and the route is the part that waits. Adding it now would change `KEYED_FIELDS` with nothing to feed it. So `mailKey.ts`, its key set and `mailByClientKey` are untouched here. | `server/src/coord/mailKey.ts` |
| `overlord-urgent-unreachable-at-the-ingress` | The plan and the spec let the designated Overlord mark mail urgent to a coordinator, but `POST /api/mail` refuses the Overlord's own session with `overlord-uses-its-doors` (the other-lanes table, H10) before any urgent check could run. In version 1, only the coordinator arm can mark mail urgent through this door. The L1 rule keeps the Overlord arm, tested (and through the store), for an Overlord door that sends mail. The route test pins today's refusal, and the coordinator's mail reference names only the coordinator arm. | `server/src/coord/otherLanes.ts#OTHER_LANES` (`peerMail`), `server/test/mail-urgent-route.test.ts` |
| `terminal-test-lives-in-the-binding` | Plan Task 2.3's mutation "drop the terminal-run test" has nothing to mutate in L1. The rule is handed the binding's open answers (`bindingsOf(...).claimants()` and `.claimant()`), so which runs are terminal stays in `coord/runBinding.ts` (review focus: "reads bindings only through `bindingsOf`"). The terminal case is pinned through the store: a coordinator to its worker on a failed run is `urgent-not-allowed`. | `server/src/coord/urgentMail.ts`, `server/test/mail-urgent-route.test.ts` |
| `ackable-outstanding-no-prefix` | The plan names the fragment `ACKABLE_OUTSTANDING_SQL(prefix)`. `OUTSTANDING_OR_ABANDONED_SQL` is spelled over the `d` and `rr` aliases with no prefix, so the named fragment is a constant over those aliases (built once from `ackableDeliverySql('d.')`). `inboxFor`, `abandonedCount`, `urgentHolds` and `urgentOutstanding` read it. | `server/src/coord/store.ts` |
| `urgent-role-words-two-homes` | The two role words (`coordinator`, `overlord`) were drafted here as `urgentMail.ts#URGENT_ROLES` while PR 3 put them in `shared/mailHold.ts#MAILHOLD_ROLES`. By the coordinator's ruling, the second of the two to land imports from the first one's home. PR 3 landed first, so `UrgentRole` is now `MailHoldRole` and the copy is gone. A single-definition case finds no two-word list or union of the words in code outside `shared/mailHold.ts`; it was red while the copy stood. The SQL CHECK on `mail.urgentAs` in the migration still names both words, as the database's own guard. | `server/src/coord/urgentMail.ts`, `server/test/single-definition/mail-role-words.test.ts` |
| `urgent-outstanding-in-the-rule` | Plan P4 tests the outstanding urgent mail inside the insert's transaction. Here it is a fact (`UrgentFacts.outstanding`) the store reads beside the binding and the designation, and the L1 rule decides `urgent-outstanding`, after who may send, so a refused sender hears the rule. The ingress (PR 2b) asks with no `await` between that read and the insert, which is check 6.5's argument for the mail key, so two sends cannot both pass; PR 2b's concurrent-send case pins it. Unlike the key, there is no unique index behind it, since the outstanding set is a join over delivery states. | `server/src/coord/urgentMail.ts`, `server/src/coord/store.ts#urgentVerdict` |
| `urgent-self-mail` | An addition the plan does not list: a session never marks its own mail urgent (`urgent-not-allowed`), whatever role it holds. | `server/src/coord/urgentMail.ts` |
| `replay-echoes-the-flag-not-the-role` | For PR 2b. Task 2.4 says a matching keyed retry "answers the replay with `urgent` and the stored role echoed from `urgentAs`". The replay will echo `urgent: true`, read from the stored `urgentAs`, and not the role word, because a fresh urgent send echoes only `urgent: true`. The role stays a server fact, which the projection (PR 4) reads. | PR 2b |
| `inbox-store-load-flake` | `mail-inbox-store.test.ts`'s "for every fixture row" case builds a fresh database per row and times out at 20 s under load (measured at load average about 7). It times out on `main`'s code too, so the cause is the load, not this PR. | `server/test/mail-inbox-store.test.ts` |

## 2. Mutations

Each mutation was an in-place edit with a sha-checked restore from a saved copy, or a `runMutants` set for the L1
decider. Every mutant went red.

| Guard | Mutation | Red case |
|---|---|---|
| The sender rule | 13 textual mutants (`server/test/sim/urgentMailSets.ts`), among them dropping the claimant test, folding each `unmeasured` into `not-allowed`, dropping the designated-session match, dropping the self-mail refusal, and dropping the outstanding arm, asking it of every sender, or asking it of an allowed sender whatever the fact says | each mutant's own case; score 1 |
| The one writer | write `urgentAs` on every insert | `mail-urgent-store`: the null case |
| The hold's ackable clause | read `OUTSTANDING_OR_ABANDONED_SQL` alone | `mail-hold-set`: the order and set-equality cases |
| The hold's read predicate | read `ackableDeliverySql` alone | `mail-hold-set`: the order and set-equality cases |
| The urgent filter | drop `urgentAs IS NOT NULL` | `mail-hold-set`: five cases |
| One outstanding | the store never reads the fact (`outstanding: false`) | `mail-urgent-route`: the outstanding, run-close and pair cases |
| Keyed on the pair | key the store's read on the recipient alone | `mail-urgent-route`: the pair case |
| Unreadable is not "no binding" | the store folds a thrown binding read into an empty one | `mail-urgent-route`: the unreadable case |
| The designation fact | the store reads every designation as `not-designated` | `mail-urgent-route`: the Overlord case |
| One home for the role words | keep `URGENT_ROLES` in `urgentMail.ts` | `mail-role-words`: the one-home case |
