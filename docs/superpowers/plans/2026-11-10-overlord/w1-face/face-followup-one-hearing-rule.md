# Overlord W1 face follow-up: one hearing rule

The follow-up to [`w1-face.md`](../w1-face.md) that review 2002 N-F asked for: the navigation's counts (`useNavBadges`),
Instrument's status bar, Refined's phone header and the PR sheet each carried their own "heard" ternary over the fleet
store's frame flags. All four now take their rows and runs from `useHeard` (`pwa/src/fleet/useHeard.ts`), so one rule
decides "not heard yet", heard and link lost. This note records what the build found or decided, for the programme to fold
into its ledger. Each entry is a plain slug. None carries a number: the programme mints them.

## What changed

- **three-states-characterized, tests first** — `pwa/test/heard-surfaces.test.tsx` pins what the nav badges, the status
  bar's readout and the phone header's readout show in three states: not heard yet (the offline snapshot's rows and runs,
  no frame), heard (both frames, link open) and link lost (both frames, then the link down). `pr-sheet.test.tsx` gains the
  link-lost case beside its existing gate cases. Every case was green on `main`'s code before the move and unchanged after.
- **move-without-behaviour-change** — the move changes nothing that is shown, so no behaviour-change commit was needed.
  The status bar and the phone header still count the store's sessions as they stand, the offline snapshot's included, and
  gate only their runs. Gating their sessions too would hide the fleet on a cold start, and that is a product question
  this change does not answer.
- **link-lost-is-heard, reading** — the frame flags are sticky: once a frame lands, a lost link leaves its rows heard.
  "Link lost" therefore reads as heard on every surface, which is what each surface already showed. `useHeard`'s header now
  says so.
- **status-bar-keeps-the-singleton** — Instrument's status bar reads the app's singleton store (`useFleetStore`), not the
  shell's chrome store, and still does: `useHeard(useFleetStore)`. In the app they are the same store. Moving the status
  bar onto the chrome store would be a separate change.

## The census

- **heard-ternary-census, a guard** — `pwa/test/use-heard.test.tsx`'s scan, which covered `face/` and `ledgers/` only, now
  covers all of `pwa/src`, counted per file. A hand-written ternary over `fleetFrameSeen` or `runsFrameSeen` is refused
  anywhere but the hook. A second case pins what the pattern sees (`x ?`, `(x) ?`, `!x ?`, a line break before the `?`)
  and what it does not (`if (!x)`, `x ?? y`, `x?.y`, `coordFrameSeen`). Measured red three ways, each mutation restored
  from a saved copy: the old ternary back in the status bar, a second ternary in a listed file, and a pattern that never
  matches.
- **still-hand-written-holders, carried forward** — five screens outside this brief still carry seven heard ternaries in
  all, listed in the census with their counts. The list only shrinks:
  - `fleet/ProgrammeBox.tsx`, three ternaries;
  - `screens/FleetScreen.tsx`, one ternary: its runs line, `runsLineLabel(runsFrameSeen ? runs : null)`, which is a plain
    move;
  - `screens/MailScreen.tsx`, one ternary;
  - `screens/RunDetailScreen.tsx`, one ternary;
  - `screens/RunsScreen.tsx`, one ternary.

  In three of the seven, the fallback before the frame is an empty list, not null: MailScreen's `NO_RUNS`, RunsScreen's
  `[]` entries and ProgrammeBox's spec link. Routing those through `useHeard` would change what they show, so each is a
  behaviour change of its own.
