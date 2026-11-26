# Overlord W1 home, PR B: notes for the ledger

Run 3960 built PR B of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-home.md`: Tasks 4 to 7, the Overlord place. This
note says what the build made, where `main` differed from the plan, and where the build departed from it. Each departure has
a slug, and the coordinator mints its number when it folds this note into the ledger. Home A's note is
[`w1-home.md`](w1-home.md); PR C writes its own.

## What landed

- **The place (`pwa/src/overlord/OverlordPlace.tsx`, L4).** One column in Table 4a's order: the restore banner's mount,
  the face with the designation's word, the readiness part (the word, its since, where questions go, Pause and its
  "taking effect" line), the body part (Start, Open, Rebind, Restart), the ladder part, "Since you were last here", the
  portfolio strip and the capacity line. Parts 3, 6 and 7 (W3, W2 and the chat piece) are not drawn. One `useStepUp` and
  one `ConfirmItsYou` serve the body and ladder parts; `RestoreBanner` keeps its own. `OverlordRoute` draws it under
  `overlord-v1` only, says Loading… and replaces nothing while the caps load, and replaces to `/fleet` otherwise.
- **The readiness word on three rows.** `readinessWords.ts` (L1) holds one row per word of `READINESS_WORDS`, and the
  part and the one-line form (`ReadinessPart.tsx`, `ReadinessLine.tsx`) draw `ReadinessWire` as served: the word and its
  since, `until` as time left for `renewing` and `restarting`, `why` for `unmeasured` and `dead`, `strandCause` for
  `stranded`, and "Questions go to you" from `questionsGo`, never decided from the word. A word the console does not know
  is drawn raw. The one-line form is mounted beside the Fleet's `BuildLine` and in both of Waiting on you's heads, and is
  drawn only under `overlord-v1` while the word is not `absent`.
- **The store.** `stores/overlord.ts` reads the readiness word beside the designation and the ladder, as a `ReadState`
  (503 unmeasured, 404 absent, a body without `word` and `since` unreadable), and only under `overlord-v1`.
- **The ladder and Pause (`LadderPart.tsx`, `ladderWords.ts`, `useLadderDoors.ts`).** Every control is a row of
  `GET /api/overlord/ladder`: the operator's rung from `rungs[]` (a rung not `available` drawn disabled with the word it
  `needs`), the effective rung and its `binding` rows, each latch with Clear, each condition with its reading and effect. A
  cause the console does not know is drawn by its key, with Clear. Pause and a lowered rung are one tap with no step-up; a
  raise and a latch's Clear go through the step-up. After Pause or a lowered rung whose answer carries `narrowing`, the
  "taking effect" line is kept until the ladder reads `done`, and `nudgeWitness()` runs; after Clear, neither. Every door
  ends in `refreshOverlord()`.
- **Start, Open, Rebind and Restart (`BodyPart.tsx`, `placeWords.ts`).** Controls per designation state from one table
  (`BODY_CONTROLS`): Start (model class and account set from `poolOptions` over the roster) for `none` and `failed-start`,
  never while bound or pending; Open, Rebind and, only from the readiness read's `restartable`, Restart for `bound`;
  "Rebind anyway" after `overlord-body-alive`, behind the step-up.
- **"Since you were last here" (`sinceWords.ts`, `lastHere.ts`, `SincePart.tsx`).** `sinceLines` composes the W1 lines
  from `GET /api/waiting` and `GET /api/programmes?since=` in Table 4.1b's order, at most seven; a failed read says
  "unmeasured". `lastHere.ts` is the one reader and writer of the per-device stamp, and a device with no stamp reads the
  last 24 hours.
- **The portfolio strip (`portfolioWords.ts`, `PortfolioStrip.tsx`).** Rank order with class and fixed date; Move up and
  Move down, a class and a date; Save writes `{ basedOn, seen, order }` with `seen` every drawn slug; `rank-changed`
  re-reads and never retries; a 404 says "no portfolio on this server".
- **The capacity line (`runwayWords.ts`, `CapacityLine.tsx`)** from `GET /api/pools/runway`, with a sentence per
  `EarliestReset` arm; not drawn while the read is absent.
- **The face (`FacePart.tsx`):** `Character` at scale 4 with `useMood()`'s mood, its cause in the label, played for
  `MOOD_PLAY_MS` and then still.
- **The door refusals (`lib/refusalWords.ts`):** one table, `OVERLORD_PLACE_REFUSAL_TEXT`, read by `overlordRefusalText`,
  which adds `needs`, the counted accounts or the detail where the word names one, and draws an unknown word raw.
- **The place-visible report (server).** `server/src/continuity/placeMark.ts` (L1) answers `placeMarkDue`, and
  `placeMarkReport.ts` reads the designation and the marks, asks it, and on `write` calls the store's one mark writer,
  `putOperatorMark('@overlord-place', now)`, with the server's own clock. `server.ts` calls it from the session socket's
  `visible` branch after `viewers.setVisible`. `OVERLORD_PLACE_MARK` and `PLACE_MARK_EVERY_MS` (60 s) sit in
  `shared/continuity.ts` beside `BREAK_PLACE_HIDDEN_MS`. No frame, door, migration or gate row was added, and the writers
  census keeps `operator_marks` at its one writer.
- **The stylesheet (`pwa/src/overlord/overlord.css`).** Tokens only; every rule that sets an ink states its ground, so the
  contrast gate measures every pair (all pass) and nothing enters the uncovered census.
- **The carried case** (ticket `home-a-review-carries`, its first point): `home-route.test.tsx` holds that `/overlord`
  waits on the capability read. Its other four points (the go-fleet census's scope, stale Fleet-is-root words, the bar's
  own-width pin, the badge wait in the width cases) are in files this piece did not open, and stay on the ticket.

## Where main differed from the plan

- Every read the plan listed as "not on `main` yet" is there: the designation, the ladder and its doors, designation B's
  Rebind and Restart, the readiness read, `GET /api/pools/runway` (question 6) and `RestoreBanner`. `pwa/src/lib/api.ts`
  had none of this piece's calls, so all ten were added.
- **Pause from `chat`** answers `{ ok, changed: false, rung }` with no `narrowing` (the door's `same` arm), where the plan
  expected a narrowing state. The line keys on `narrowing` being present, so nothing is drawn there; a test holds both that
  answer and a `changed: false` answer that does carry a narrowing.
- **Designate's warnings** are only `{ warning: 'unknown-pool', pool }` on `main`; the plan named a list and a count. Each
  warning is drawn by its word, an unknown one raw.
- **`GET /api/programmes`' `closedToday`** counts the runs closed since the `since` it was asked for, so "runs closed" is
  its sum.
- **The rank door** deletes the rank row of a `seen` slug absent from `order`, which is why `seen` matters
  (`unreadable-ranks-saved-as-drawn` below).
- **The generations lane** does not read the place mark yet (`placeHiddenObservedMs: later('W1')`), as the plan says: a
  later piece reads it.

## Departures

- **`overlord-refusals-one-table`.** The plan put the sentences in `refusalWords.ts`'s existing tables; they are one table of
  the place's door words with one reader, so no part writes a refusal sentence.
- **`pause-from-chat-answers-no-narrowing`** (above).
- **`doors-carry-which-door`.** `useLadderDoors` also answers which door spoke last, so the readiness part draws Pause's
  line and refusal and the ladder part the rung's and Clear's, and nothing is drawn twice.
- **`taking-effect-falls-back-to-the-door`.** Until the ladder read carries `lastChange.narrowing`, the line uses the door's
  own narrowing.
- **`refresh-after-every-door`.** `refreshOverlord()` runs after every door, a `step-up-required` refusal included; a 401 is
  left to the sign-in screen.
- **`rung-direction-is-l1`.** Whether a rung move goes through the step-up is `rungMovesUp` (L1); an unknown rung or an
  unread ladder counts as a raise. The server's gate stays the authority.
- **`readiness-label-is-a-chip`.** The status label is `Chip` with a tone class (`statusLabel` is keyed to session
  buckets).
- **`readiness-fleet-mount-beside-buildline`.** The Fleet's line sits beside `BuildLine`, which is outside
  `BannerStack`'s order.
- **`place-head-keeps-the-designation-word`.** Home A's `designationWordOf` line stays in the place's head.
- **`outcome-sentences-own-text`.** A failed start's sentence comes from a `Record` over `AttemptOutcome` in
  `placeWords.ts`; `ATTEMPT_OUTCOME_MAP`'s values are descriptions, not copy.
- **`account-set-defaults-all-on`.** Start's account set begins with every roster pool and untagged on; an empty set
  disables Start with a sentence.
- **`since-more-line`.** Past seven lines, six are kept and a seventh says how many were not shown.
- **`since-one-line-per-stalled-programme`**, and **`since-stuck-unread-is-unmeasured`**: a programme with open waves and no
  `stuck` verdict is one "unmeasured" line, never "not stalled".
- **`needs-you-counts-items-and-approvals`.** "Needs you" counts the read's open items and parked approvals; Waiting on
  you's own count also has sessions' questions and limit rows, which this read does not carry.
- **`unreadable-ranks-saved-as-drawn`.** An untouched `rankUnreadable` row is written as `standard` at its drawn place, so a
  save never deletes a rank a newer build stored.
- **`class-change-lands-at-the-end-of-its-band`.** A row moves only inside its class band.
- **`face-restates-the-play-window`.** The face part restates `FaceMark`'s play window; a shared hook is a follow-up.
- **`placemark-bound-is-tagged`.** `placeMarkDue` takes the binding as `bound`, `not-designated` or `unread`, and the mark as
  its `at`, `absent` or `unread`, so no two conditions fold together.
- **`placemark-unread-mark-skips`**, **`placemark-future-mark-writes`** (a mark dated after now, a clock stepped back, is
  refreshed), **`placemark-unread-warns`** (an unread read warns once, as a throw does).
- **`placemark-reporter-takes-the-server-clock`.** The plan had the handler read `Date.now()`; the reporter sits in
  `server/src/continuity/`, inside the time ports' scope, so `server.ts` hands it `deps.time.clock.wall()`.
- **`three-class-prefixes`.** The parts' classes are `ov-`, `ovl-` and `overlord-body-`; one stylesheet holds all three.

## Mutation rows

- **Floors** (`server/test/sim/mutation-floors.json`): `pwa/src/overlord/sinceWords.ts#sinceLines` at 1 (S1 a failed read
  answers "quiet", S2 the cap lifted, S3 the lines out of Table 4.1b's order: 3 of 3 killed), and
  `server/src/continuity/placeMark.ts#placeMarkDue` at 1 (P1 write on `visible: false`, P2 for another session, P3 with the
  designation unread, P4 ignoring the minute, and P5 to P9 the minute's edge, an unread mark, a future mark, no session
  designated and an absent mark: 9 of 9 killed).
- **By hand, before and after** (each red with the mutant, green restored):
  - a hard-coded rung list in place of `rungs[]`: four ladder cases, "no control without a row" among them;
  - the "taking effect" line dropped on `not-journalled`: a ladder case, two readiness cases and the totality case;
  - a line kept after Clear: the Clear case;
  - `questionsGo` decided from the word: two readiness cases and two words cases;
  - the `overlord-v1` check dropped from the readiness line: four cases;
  - Start offered while bound: seven body cases, "no second start" among them;
  - Restart keyed on the word: four body cases, the `restartable: false` case among them;
  - the forced Rebind sent past the step-up: the "Rebind anyway" case;
  - `seen` sent as only the moved rows: the two write-body cases;
  - `rank-changed` read the wrong way: two strip cases; `n: 0` drawn as 0: two cases; the capacity line drawn on a 404:
    two cases; the face label without its cause; `lastHere` reading storage unguarded: two cases;
  - the `visible` branch's report call removed from `server.ts`: three real-socket cases;
  - `OverlordRoute` replacing while the caps load: the carried capability-wait case;
  - the place widened to 500 px: the browser file's 320 px cases in both skins (192 and 196 px sideways).

## What a merge arms

Nothing an operator sees. The place, Start and the readiness lines are drawn only under `overlord-v1`, which no server
advertises until the `overlord-v1` piece, and a direct `/overlord` replaces to `/fleet` without it. The server's mark refresh
writes `@overlord-place` only for a visible frame of the session the designation binds, and nothing reads that mark yet.

## Harness dependence

None added. The place is the console over the server's reads and doors, and the place-visible report rides the session
store's own visibility frame and the server's own mark table, so any agent harness that the server hosts is served the same
way.

## Known limits

- Every visible frame of any session's screen reads the designation and the marks once (two small `coord.db` reads per open
  session screen every 15 s) before `placeMarkDue` skips it.
- The readiness word is drawn as the read answers it; its known limits (a late dead in a crash loop, an extra dead push after
  a blind stretch) are the readiness piece's.
- The pending deadline's "within N min" moves on the page clock every 30 s.
- On the fleet's test box, the mutation floors' two `mood.ts` sets fail with "Cannot find package '@ccrc/ui'" from the box's
  checkout; run locally they pass. This branch did not touch them.
