# Wave 4 PR2: notes for the ledger

The worker's notes for PR2 (the PWA's delegation rows), to be folded into the plan's "Deviations found" and the programme
ledger by the coordinator's ledger pull request. PR2 owns D-7007..D-7010. The entries below are written as prose, not as
`- **D-N**` definition lines: the plan already defines each of these numbers (as `unused`), and `deviation-refs.test.ts` reads a
second definition line as a collision.

## Deviations

- D-7007, `delegation-rows-share-two-existing-rules` (PR2 Task 2.7, found by the first full PWA run at the tip). The plan adds new
  `.proj-work*` and `.proj-group*` rules next to `.proj-pending`, and lists no census file among PR2's files. As written, three
  censuses went red, each on a copy the new rows made: `shape-census` (`.proj-work` declared `.proj-pending`'s seven declarations,
  and `.proj-group-toggle` the fold toggles' seven), `markup-census` (the worktree row rendered the session row's works-on chip
  block a second time) and `contrast` (four new colour rules with no ground). Each copy now has one owner: `.proj-work` joins the
  `.proj-pending` rule and `.proj-group-toggle` joins the `.proj-released-toggle, .proj-archived-toggle, .proj-children-toggle`
  rule (two selector lines added to existing rules in `fleet.css`, not purely new rules), and `WorksOnChip` in `SessionLine.tsx`
  is drawn by both rows. The registries follow the rekeyed rules, in three files outside the plan's list: `pwa/design/audit.mjs`
  (the ground of `.proj-pending, .proj-work`, `.proj-work-parts > *:not(:first-child)::before` and `.proj-work-chip`, and the
  toggle rule's rekeyed entry), `pwa/test/contrast.test.ts` (`.proj-pending` leaves the grandfathered blind spots, since its rule
  is now registered) and `pwa/test/role-census.test.ts` (`'.proj-pending, .proj-work': META`). `fleet.css` still names no broker
  word, and no shipped colour or token changed.
- D-7008, `the-header-draws-the-r9-chip-too` (PR2 Task 2.8). The plan has `SessionMeta`'s card mode draw the chip, and the header
  hold it through `headerFacts`. `headerFacts` has no rendered reader, so the rendered session header would have lacked a fact
  the card shows, against D-5545's rule that the header is a superset of the card. `SessionMeta`'s header mode draws the same
  `.sess-meta-chip` after the subagent tally, pinned by the row "the rendered header draws the chip the card draws" in
  `card-header-facts.test.tsx`.
- D-7009, `characterisation-pins-fingerprints` (PR2 Task 2.3, W4-U0). The plan compares each `JSON.stringify` output with "an
  inline expected string captured on `main`". The three files make 70 calls whose outputs carry whole `FleetSession` rows, so
  the full strings would add thousands of lines. Each file instead records every call its cases make (inputs and the output's
  JSON, `pwa/test/characterise.ts`) and pins the first 16 hex digits of each output's SHA-256 as an inline snapshot, captured on
  `main`'s code before any source edit. A key-order change to one `nestFleet` row reds all three files. The null-argument twins
  (W4-U11, U19, U23) replay the recorded inputs and compare the full JSON string, not the fingerprint.
- D-7010, `the-health-row-admits-the-frame-slot` (PR2, found by CI's `server 1/12` at d3a88e8eb; licensed by the
  coordinator's ruling, through the worker's structured ask). Wave 3's row in `server/test/fleet-health.test.ts` ("adds no PWA
  state and no fleet frame") grepped `pwa/src` for `/DelegationObservationHealth|\.delegation\b/`. It was meant to keep the
  `/api/fleet/health` member out of the PWA, but it cannot tell that member from the frame's store slot `FleetState.delegation`
  (Task 2.1), which PR2 reads at four sites in three files. The plan lists no change to it, and PR2 may not touch `server/` on
  its own. The row now has W4-SC1's allow-list semantics. `DelegationObservationHealth` stays named nowhere in `pwa/src`, and
  `.delegation` is allowed only in `W4_PWA_FILES`, which the row reads from the scope census's own text (its one definition), with a
  CONTROL row. Three mutants each red it: dropping the allow-list clause, dropping the type ban, and adding a fake file to the
  list.

## Smaller notes (no number)

- Task 2.1: W4-UM1 (an empty initial slot) survived the plan's rows as first written, because every row read the slot after
  the socket opened and `onOpen` clears it. W4-U1 and W4-U4 now also read a store that has not connected (W4-U4 one hydrated
  from the offline snapshot), and W4-U27 reads the screen with sessions seeded before the socket opens. UM1 then reds all three.
- Task 2.2: `readDelegation` leaves out a member that is not an object at all (it carries no word to re-file and no key to
  render by); every object member is kept and re-filed as the plan states. It reads members with `lib/wire.ts`'s `isRecord`
  (`pwa-one-owner`).
- Task 2.4: W4-UM9 (worktree parents added to `parents`) reds W4-U13 and W4-U15. The plan also names W4-U0/U11, which carry no
  worktree and so cannot see it. In the offline group, worktrees come before activities, as W4-U16 states.
- Task 2.5: the count of activities no card can draw is `unplacedActivities` in `fleetTree.ts`, so `FleetCards` reads a
  decision rather than counting.
- Task 2.7: W4-U27's "today's code path" is a pass-through mock of `fleetTree` in `fleet-screen.test.tsx` that drops the fifth
  argument when a case sets it; every other case in that file runs the real function.
- Task 2.8: W4-UM19's first half (drop `card.delegated` from `cardWithinHeader`) survived as the plan predicts. W4-U33 also
  feeds the predicate a header without the chip, so both halves now red it.
- Task 2.8 Step 4, the census footprint measured with the census's own regexes (comments stripped): `delegation` is named by ten
  files, all in `W4_PWA_FILES` (`SessionMeta.tsx` names none); `lease` by six of them plus main's two (`HaltBanner.tsx`,
  `updateHalt.ts`). No file outside the list.
- `server/src/watch.ts` and `server/src/coord/store.ts` are untouched (growth 0). PR2's only `server/` and `shared/` changes are
  PR1's cherry-picked Task 1.1 commit, the one-line spec citation the brief licensed, and D-7010's row.
