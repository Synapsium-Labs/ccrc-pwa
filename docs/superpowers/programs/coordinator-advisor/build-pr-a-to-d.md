# Coordinator advisor: the build of PR A to PR D

Plan: `docs/superpowers/plans/2026-11-23-coordinator-advisor.md`. Spec: `docs/superpowers/specs/2026-11-23-coordinator-advisor-design.md`.
This note records what was built, where the build departs from the plan and why, and the red-first evidence. It defines
no deviation number: the plan's D-8967..D-8972 cover every decision below.

## Where the build departs from the plan

1. **The spawn record is `$REG/<id>.advisorspawn`, not `$REG/<id>.advisor`.** The route field `advisor` is stored by
   `ccd route` at `$REG/<id>.advisor`, so a record at the same path would overwrite the field it records (measured: the
   first red run of `ccd-advisor-spawn.test.ts` read the route's word back as the record). Same grammar as the plan:
   `<fable|opus> <epoch>`, `off <epoch>`, `off fastdeath <epoch>`.
2. **`_advisor_spawn_compose` is its own composer**, called on the spawn line right after `_profile_spawn_compose`, not a
   branch inside it. The profile composer has six return paths (no profile, an unreadable row, a failed settings merge, a
   non-digest row, the digest row); a flag appended inside it would need a copy on each. The browser composer is the
   precedent: one function per spawn surface, each never failing. A row with no field and no record writes nothing, so
   every other session's registry is unchanged too.
3. **The caps word is `route-advisor-v1`**, the versioned spelling every route-field token takes (`route-mailhold-v1`).
4. **The L1 decisions live in `server/src/continuity/advisorPolicy.ts`**, not in `profileFor.ts`: `coordinatorAdvisorOf`,
   `advisorFor`, `foldAdvisorFacts`, `advisorStaleOf`, `advisorStateOf` and `advisorApplyPathOf`. The read types
   (`CoordinatorAdvisorRead`, `AdvisorReadState`, `AdvisorCallRow`) are declared there and the store imports them, the
   `PlainAutoMemoryRead` shape, so no L1 file imports the store.
5. **The SQL lives in `server/src/coord/advisorStore.ts`** with one-line `CoordStore` delegates (the `coordCallsStore.ts`
   precedent), so `store.ts` grows by seven lines. One migration (123) creates all three tables.
6. **The readout is computed in the fleet assembly** (`continuity/advisorReadout.ts`, one batched read, called from
   `fleet.ts`), and `FleetSession` gains two optional fields: `advisorSpawn` (the roll's `advisor-stale` reason reads it
   with `route.fields.advisor`) and `advisor` (the readout). Both are absent for a session the advisor never touched, so
   every existing row is byte for byte as before. They revive through `reviveFleetSession`.
7. **The session header fact is a `detailRows` row** (`advisor`), drawn by `SessionDetails.tsx`; the Settings summary lists
   every touched coordinator from the fleet store. Both read `pwa/src/fleet/advisorWords.ts#advisorLineOf`.
8. **The scope's ids are typed into one text field** (spaces or commas), not picked from a list of coordinators: the fleet
   list's coordinator flag is not a field the PWA holds, and a trial of two names is short. A picker is a follow-up.
9. **`advisorFor` leaves the field alone on an unmeasured main model** (spec §4 says "not eligible"). With no field yet,
   leaving it alone is not eligible; with a field standing, a usage sidecar that went stale for a minute does not clear it
   and cost a restart. The lane counts these as `advisorUnread` in its pass line.
10. **The roll's `advisor-stale` reason treats a fast-death record as settled**, so a restart never retries the launch that
    died before the count lane and the profile lane have cleared the field for the day.

## What each PR holds

- **PR A (ccd):** `ROUTE_FIELDS` and `ROUTE_WRITABLE_FIELDS` gain `advisor` (lane-only, last); `_route_valid` takes
  `fable`/`opus`; the mint and a session's shell refuse it; the empty value clears it; `_route_any` skips it;
  `_advisor_spawn_compose` adds `--advisor`, writes the record and journals `advisor-dropped` on a spawn within 90 s of one
  that applied it; `ccd caps` prints `route-advisor-v1`. ccd/ccd stays inside the growth check's 40 net code lines.
- **PR B (setting and lane):** `shared/coordinatorAdvisor.ts`; migration 123; `GET`/`POST /api/coord/coordinator-advisor`
  (session-only; `SESSION_ONLY`, CLAUDE.md's sentence, the auth-gate counts, the masker's GET list, the coordinator skill
  test's unnamed doors); the `coordinator-advisor` switches row; the profile lane's `advisor` field behind the caps word;
  `CoordinatorAdvisorSection.tsx`.
- **PR C (counting and cap):** `parse.ts#advisorFactsOf`; `transcript/advisorRead.ts`; `continuity/advisorLane.ts` (the
  `advisorCount` lane, once a minute); `registry.ts#advisorSpawnOf`; the roll reason `advisor-stale`.
- **PR D (readout):** `advisorStateOf`, `FleetSession.advisor`, `advisorWords.ts`, the header fact and the Settings summary.

## Red-first evidence

- `ccd-advisor-spawn.test.ts`: the characterization cases were recorded on the branch point (`ADV_RECORD=1`) and passed
  there (4 green); the 11 advisor cases were red before the ccd change and green after.
- Mutations, each measured red then reverted: `advisorFor`'s role, Anthropic, Opus-class, scope and cap rules; the
  profile lane's caps gate (`capSupported(…, ADVISOR_ROUTE_CAP)`); `advisorStaleOf`'s fast-death rule; the roll's
  `|| advisorStale`; the parser's `name === 'advisor'`; the store's upsert (`ON CONFLICT … DO UPDATE`); ccd's
  `_route_valid` word check.
- One mutation stayed green and is held twice on purpose: removing the `if (advisorCap)` around the per-row decision,
  because the Settings row is not read at all without the caps word, so `advisorFor` answers null. The outer gate is the
  one measured red.

## Review fixes (two review passes, before merge)

- **The ccd context map.** `_advisor_spawn_compose` has its row in `ccd/contexts.tsv` (C2) and its three edges in
  `ccd/contexts-edges.tsv` (`ccd-contexts.test.ts` was red).
- **The count starts at a file's tail.** A first read, a new path after a swap and a rewrite start
  `ADVISOR_TAIL_BYTES` (four ranges) before the end, at the first whole line; read from byte 0, a 40 MB transcript took
  hours to reach today's calls, and the cap acted that late.
- **A clear is written in shadow and past the steer marker**, alone in its call, so Off, the cap and a drop still remove
  a field the lane wrote while live. Departure 9 above is narrowed: `advisorFor` now answers every measured reason to
  remove before it asks for an unmeasured fact.
- **A drop holds for its UTC day.** ccd keeps an `off fastdeath` record through a spawn without the flag; the reader keeps
  `droppedDay` (migration 123's `advisor_reads.droppedDay`) across spawns; `advisorStaleOf` settles a fast death on its
  own day only, so the next day's roll restores the advisor. Departure 10 is narrowed to that day.
- **Opus 5 or later.** A measured Opus id below 5 clears the field.
- **`unmeasured` readout word** for an unreadable spawn record, never `off`.
- **One Anthropic-lane rule**, `shared/roster.ts#anthropicLaneOf`; a lane the roster does not name is unmeasured for the
  advisor (the roll still reads it as not Anthropic).
- **The Settings row saves a cap or a list** under the standing choice with its own button.
- **Tokens.** A later streamed line of the same message, in the same read, fills that message's call; the store keeps the
  newest measured usage. Which line carries the final usage stays Trial step 1 (D-8969).
- **Wiring tests.** The watcher's dispatch of the count lane, the fleet row's readout, the roll's `advisor-stale` reason
  through `rollPass`, `advisorCounted`'s applied arm, and `_route_any`'s exclusion are each measured red when removed;
  `ProfileReads.anthropicLane` and `ProfileLaneDeps.now` are required, so a composition without them does not compile.
- **Not changed:** the cap is enforced at the next idle restart or renewal (D-8970), not by typing or a kill; the
  readout's apply path is fleet-wide and does not read a session's `.no-roll` (the fleet assembly does not read the
  opt-out markers); the trial needs the Launch profiles lane live for the whole fleet (D-8967).
