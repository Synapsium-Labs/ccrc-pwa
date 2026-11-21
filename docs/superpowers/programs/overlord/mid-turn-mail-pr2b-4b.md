# Overlord wave 195, mid-turn mail PR 2b and PR 4b: notes for the ledger

This note records what PR 2b and PR 4b of the mid-turn mail plan (`docs/superpowers/plans/2026-11-19-mid-turn-mail.md`,
Tasks 2.4 and 4.4) built and measured, and where they depart from the plan, by slug. The two pieces were left out of PR 2
and PR 4 because `server/src/coord/routes.ts` was frozen (slugs `ingress-waits-for-routes` and `ack-kick-waits-for-routes`
in `mid-turn-mail-pr2.md` and `mid-turn-mail-pr4.md`). The coordinator folds this note into the programme ledger and mints
any numbers. No D-number is defined here.

## In short

- **Built:**
  - the urgent ingress: `POST /api/mail` reads `urgent`, asks `CoordStore.urgentVerdict`, stores the role in
    `mail.urgentAs` and echoes `urgent: true`;
  - ruling N10: `urgent` is one of the mail key's compared fields;
  - the reclaim's repoint of an urgent mail to a displaced coordinator (review 2833 F3);
  - the ack's kick of the mailhold projection.
- **`routes.ts`** carries exactly the two packets its holder consented to under the operator's item 486. The first has
  six hunks: 37 lines added and 3 edited in place. The second is the CI fix (`refusal-word-named-for-the-status-scan`):
  one line of the first packet becomes five. Against `main`, that is 41 lines added and the same 3 edited in place: the
  `keyedRequest` literal, the keyed `same` reply and the `insertMail` call, each gaining one field.
- **No migration.** The column and its index came with PR 2 (migration 108).
- **No new route, verb, run state or wire bump.** `urgent` on the send body and its answer is additive. An older server
  answers no `urgent`, which reads as "not urgent".

## 1. What runs where

| Piece | Where | What it does |
|---|---|---|
| The body field | `server/src/coord/routes.ts` (`POST /api/mail`, after `clientKey`) | absent, null or false is ordinary mail; a non-boolean is `bad-kind` |
| Check 8.5 | the same route, after the role resolution | reads the resolved recipient's registry mark, asks `urgentVerdict`, refuses with its word through `refuse(...)` (recorded) |
| The store's role | the insert, in the route's one transaction | `insertMail({ …, urgentAs })`, the column's one writer |
| The echo | the 202 | `{ ok, id, urgent: true }`, with `clientKey` when keyed |
| The key (N10) | `server/src/coord/mailKey.ts#mailKeyVerdict`, `server/src/coord/store.ts#mailByClientKey` | `urgent` is compared; `same` carries the stored mark, which the replay echoes |
| The repoint (F3) | `server/src/coord/store.ts#repointCoordinatorMail` | moves the Overlord's outstanding urgent mail to a displaced claimant, by session id, scoped to the programme |
| The ack's kick | `POST /api/mail/:id/ack`; `server/src/deps.ts` (`Deps.onMailAcked`); `server/src/index.ts` | called after `markAcked` lands, in a try, never awaited; composed as `watcher.kick(MAIL_HOLD_LANE_ROW)` |

*Table 1. The pieces of PR 2b and PR 4b.*

## 2. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `ack-kick-composed-in-index` | The plan and the brief compose the kick "in `server/src/server.ts`". `buildServer` takes the watcher, but `Deps` is built in `index.ts`, which already sets its late fields after the watcher (`deps.tokenDriver = …`), and plan §3 names `index.ts` as the L5 that wires it. So the field is declared in `server/src/deps.ts`, where `Deps` now lives, and set in `index.ts`. `server.ts` is untouched, so no consent from its holder was needed. A test pins the composition line. | `server/src/deps.ts`, `server/src/index.ts` |
| `urgent-mark-of-an-unlisted-recipient` | Check 8.5 reads the recipient's mark from the same registry read the route already made. A listed row the read could not build is `unreadable`, so `urgent-unmeasured`. A role-resolved recipient that the registry does not list at all reads as `none`, so the id-string rule applies, as the drift lane and `withChildIds` read an unlisted session. | `server/src/coord/routes.ts` (check 8.5) |
| `urgent-before-peer-bounds` | Check 8.5 sits before check 9, the peer bounds. Urgent mail must name a run, and check 9 applies only to mail with no run, so the order changes no answer for a send that can pass. A send with `urgent` and no run is refused by the rule (`urgent-wrong-run` or `urgent-not-allowed`), never charged against the peer quota. | `server/src/coord/routes.ts` |
| `urgent-park-not-moved` | The F3 repoint moves outstanding deliveries only, as the repoint always has. An urgent mail to a claimant that was already parked as abandoned before the reclaim stays on the displaced id, as every park does (D-1425's arm (c)), and that id's hold stands until it acks. This is not reachable in version 1: only the Overlord arm sends urgent mail to a claimant, and the Overlord cannot send at this door (`overlord-urgent-unreachable-at-the-ingress`). | `server/src/coord/store.ts#repointCoordinatorMail` |
| `repoint-urgent-by-programme` | The repoint's new arm is `m.urgentAs = 'overlord'`, beside `m.toId = 'coordinator'`, under the same `toId IN (displaced)` and `r.program = ?` scope. The rule marks a mail `overlord` only when its recipient claims the run it names, so such a mail is mail to the chair of a run in this programme. Review 3069 F3 narrowed it from `m.urgentAs IS NOT NULL`, by the coordinator's ruling: a `coordinator` urgent mail is a run's worker's, and stays put even when that worker later becomes the claimant (a reclaim may hand the programme to the displaced chair's own live worker, D-3028) and a second reclaim displaces it. A case pins that two-reclaim path. Ordinary mail by session id stays where it is (D-1142), and a case pins that too. |
| `ack-kick-on-landed-ack-only` | The kick fires on `markAcked`'s `ok` only. A repeated ack (`already-acked`), a parked delivery and an ack refused before `markAcked` kick nothing. | `server/src/coord/routes.ts` (the ack route) |
| `refusal-word-named-for-the-status-scan` | CI's first run went red on `refusal-status.test.ts` ("no helper call passes a status"): the D-5381 scan reads any second argument of the mail ingress's `refuse(reply, …)` that ends in `.code` as a status, and check 8.5 passed the rule's refusal word as `v.code`. The word was never a status, but the scan cannot tell, so check 8.5 now names it (`const { code: refusal, detail } = v`). This is a second packet to the file's holder, one line out and five in, all inside this PR's own block. Run locally, the scan was missed because `refusal-status` was not among the files this PR ran. | `server/src/coord/routes.ts` (check 8.5), `server/test/refusal-status.test.ts` |
| `ingress-case-replaced` | The judge marks `mail-urgent-route.test.ts` `test-weakened`. PR 2's case "the route ignores urgent" pinned the ingress as it stood while it waited; Task 2.4 replaces it with the ingress cases, which pin the opposite. The Overlord's refusal at this door is kept, unchanged. | `server/test/mail-urgent-route.test.ts` |
| `reference-in-present-tense` | Review 3069 F1, by the coordinator's ruling: the coordinator skill's mail reference (`ccd/coordinator-skill/references/wave-lifecycle-3-mail.md`) said urgent mail was not open yet. It is now in the present tense, and names `bad-kind` for a non-boolean `urgent`, the `urgent: true` echo, `key-conflict` for a keyed retry that adds or drops the mark, and the four refusal words. A reference, not a pinned clause, so `SKILL.md` does not grow. | `ccd/coordinator-skill/references/wave-lifecycle-3-mail.md` |
| `unlisted-recipient-arm-pinned` | Review 3069 F2: check 8.5's arm for a role-resolved recipient whose `.uuid` is listed but whose row cannot be built (`unreadable`, so `urgent-unmeasured`) had no case, because a literal id is refused `registry-unmeasurable` at check 7 first. A case now sends to the `worker` role with one of its row's fields missing, and M1b and M1c (Table 2) go red. | `server/test/mail-urgent-route.test.ts` |
| `composition-pin-on-the-assignment` | Review 3069 F7: the composition case reads the `deps.onMailAcked = …` assignment with the parser (`nameWrites`) and asserts that its value calls `watcher.kick(MAIL_HOLD_LANE_ROW)`. A kick elsewhere in `index.ts` keeps it green (measured, a control); a kick moved out of the assignment turns it red. | `server/test/mail-hold-ack-kick.test.ts` |
| `abandoned-urgent-park-double-hold` | Review 3069 F4, a note for a later ruling. For a mail addressed to the role word `coordinator`, `requeueAbandonedMail` also queues the heir a new delivery of an abandoned park with no parent (`revivedFrom` NULL), so the park stays on the displaced id and both ids would hold one urgent mail. No such mail can exist in version 1: a coordinator-role urgent mail to the claimant itself is a self-send, and the Overlord is refused at this door. It is a ruling to make before any Overlord send door opens. | `server/src/coord/store.ts#requeueAbandonedMail` |
| `two-outstanding-after-repoint` | Review 3069 F5: the repoint can leave the heir with two outstanding urgent mails from one sender, if it already held one, which breaks "one outstanding per pair" for that pair until one is acked. Overlord arm only, so unreachable in version 1. Spec §3.3's one to three pairs per marker tolerates it. | `server/src/coord/store.ts#repointCoordinatorMail` |
| `concurrency-case-pins-io-awaits` | Review 3069 F6: the two-concurrent-sends case turns red on an IO-shaped await between check 8.5 and the insert, but not on a microtask-only `await Promise.resolve()`. The code holds one synchronous window from the verdict to the insert. | `server/test/mail-urgent-route.test.ts` |
| `kick-typed-void` | Review 3069 F8: `onMailAcked` is typed `() => void`, which also admits a function that returns a promise; a rejecting one would escape the route's `try` as an unhandled rejection. Today's composition, `watcher.kick`, is a synchronous stamp reset. | `server/src/deps.ts` |
| `child-spent-unplaceable-falls-back` | Review 3069 F10, outside this PR: in `server/src/coord/childSpent.ts`, a child mark whose minting run cannot be read answers `unplaceable`, and `incarnationOfMark` then falls back to the id-string rule rather than `urgent-unmeasured`. The coordinator carries it to the rule's owner. | `server/src/coord/childSpent.ts` |
| `replay-echoes-the-stored-mark` | As PR 2's note planned (`replay-echoes-the-flag-not-the-role`), a matching keyed retry echoes `urgent: true` from the stored `urgentAs`, never the role word. | `server/src/coord/mailKey.ts` |

## 3. Mutations

Each mutation was an in-place edit with a sha-checked restore from a saved copy, or a `runMutants` set for the L1
decider. Every mutant went red.

| Guard | Mutation | Red case |
|---|---|---|
| The key compares `urgent` (N10) | drop it from `KEYED_FIELDS` (`K14`, `server/test/sim/mailKeySets.ts`) | `mail-client-key`: the conflict cases |
| The replay carries the stored mark (N10) | answer `same` with `urgent: false` (`K15`) | `mail-client-key`: the same-urgent case |
| A non-boolean is `bad-kind` | accept any value | `mail-urgent-route`: the non-boolean case |
| The role is stored | insert without `urgentAs` | `mail-urgent-route`: the allowed-sender case |
| The echo | drop the urgent 202 | `mail-urgent-route`: the allowed-sender case |
| The replay echo (N10) | drop it from the keyed `same` reply | `mail-urgent-route`: the keyed case |
| No echo on a refusal | echo `urgent: true` on a refused send | `mail-urgent-route`: the refusal case |
| The recipient's mark | read every recipient as `none` | `mail-urgent-route`: the unreadable-mark case |
| One outstanding (P4) | the store never reads the fact | `mail-urgent-route`: the second-send case |
| Keyed on the pair | key the outstanding read on the recipient alone | `mail-urgent-route`: the second-sender case |
| The repoint carries urgent mail (F3) | drop the urgent arm | `mail-urgent-route`: the heir case |
| The repoint moves urgent mail only | move every mail of the programme by id | `mail-urgent-route`: the heir case (the ordinary mail) |
| The repoint is scoped to the programme | let the urgent arm ignore the programme | `mail-urgent-route`: the other-programme case |
| The kick | drop it | `mail-hold-ack-kick`: the landed-ack case |
| After the commit | kick before `markAcked` | `mail-hold-ack-kick`: the landed-ack case (the kick saw `queued`) |
| A landed ack only | kick on every ack | `mail-hold-ack-kick`: the refused-ack case |
| A throwing kick is caught | call it bare | `mail-hold-ack-kick`: the unchanged-answer case |
| The composition root | drop the line in `index.ts` | `mail-hold-ack-kick`: the composition case |
| M1b: the unlisted arm reads the resolved id (F2) | `${resolvedToId}.uuid` read as `${toId}.uuid` | `mail-urgent-route`: the unlisted-recipient case |
| M1c: the unlisted arm (F2) | delete it, so an unlisted recipient reads `none` | `mail-urgent-route`: the unlisted-recipient case |
| The repoint arm is the Overlord role only (F3) | `m.urgentAs IS NOT NULL` again | `mail-urgent-route`: the two-reclaim worker case |
| The kick is in the assignment (F7) | `deps.onMailAcked = () => {}`, with the kick on a line of its own | `mail-hold-ack-kick`: the composition case |

*Table 2. The mutants: 2 in the key's set (its score stays 1), and 20 in place, each restored from a saved copy and
sha-checked (fix round 1 added the last four and ran the three repoint rows and the composition row again over the new
text). All red. One control stayed green, as it should: a second `watcher.kick` elsewhere in `index.ts`.*

## 4. Growth

By the growth check's own counter (`codeLines`), against `main` at `66c63606c3`:

| File | Code lines |
|---|---|
| `server/src/coord/routes.ts` | +23 (+20 before the follow-up packet) |
| `server/src/coord/store.ts` | 0 (one clause widened, the rest comment) |
| `server/src/index.ts` | +2 (not a listed file) |
| `server/src/deps.ts` | +1 (not a listed file) |
| `server/src/coord/mailKey.ts` | +1 (not a listed file) |
| `shared/api.ts` | 0 (untouched; the four words came with PR 2) |

`growth-check` passes armed, with no waiver.

## 5. Tests run

One file at a time through `ccrc test`, from `server/`:

- **Green:** `mail-urgent-route` (25), `mail-client-key` (21), `mail-hold-ack-kick` (5), `mail-routes`,
  `urgent-mail-rule`, `mail-hold-set`, `mail-hold-lane`, `mail-hold-policy`, `mail-hardening`,
  `mail-deliveries-writer`, `growth-check`, `growth-caps`, `box-token-census`, `coordinator-skill`,
  `run-session-census`, `anchors`, `citations`, `dtbd`, `docs-grammar`, `topology-clean`, every
  `single-definition/*` file, and every `rings/*` file.
- **`refusal-status`** was red on CI's first run (shard 7), and is green after the follow-up packet; mutant 5 was run again
  over the new text and went red.
- **`single-definition/advance-switches`** was red once, on this PR's own first draft: the composition case pinned
  `index.ts` by a `toContain` over its text, which ARCH-06's literal-pin ratchet refuses. The case now reads the call
  with the parser (`scan/symbols.ts`).
- **Load, not this PR (slug `coord-reclaim-load-timeouts`):** `coord-reclaim.test.ts` timed out in one or two
  `measureClaimant` and `reclaimRun` cases at vitest's 20 s, at load average 16 to 18. The same case timed out the
  same way on a clean checkout of `origin/main`. `deviation-refs.test.ts`'s two-tree case timed out, and its worker
  was killed by the test slice's memory cap. This PR defines no D-number. CI's run is the arbiter for both.
