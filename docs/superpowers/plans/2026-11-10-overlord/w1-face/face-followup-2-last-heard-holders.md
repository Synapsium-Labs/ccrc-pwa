# Overlord W1 face follow-up 2: the last heard holders

The second follow-up to [`w1-face.md`](../w1-face.md), after [`face-followup-one-hearing-rule.md`](face-followup-one-hearing-rule.md)
and its review. Seven hand-written "heard" ternaries in five files (`ProgrammeBox.tsx`, three; `FleetScreen.tsx`,
`MailScreen.tsx`, `RunDetailScreen.tsx` and `RunsScreen.tsx`, one each) now take their rows and runs from the hook
(`pwa/src/fleet/useHeard.ts`). The census lists no holder, and it now parses each file instead of matching text. This note
records what the build found or decided, so the programme can fold it into its ledger. Each entry has a plain slug and no
number: the programme mints them.

## What changed

- **characterized-first** — `pwa/test/heard-holders.test.tsx` pins what each of the seven shows, in 34 cases: not heard
  yet (the store holds rows and runs, no frame), each frame alone where a site reads both, heard, link lost, and a frame
  row that leaves out an optional field the surface reads. Every "not heard yet" case uses rows that, without the gate,
  would show something else. The file was green on `main`'s code before the move (its own commit) and is unchanged after.
  Removing either gate from the hook turns it red: 11 cases fail without the runs gate and 3 without the sessions gate.
- **move-without-behaviour-change** — each value is the hook's answer with the old fallback: `useHeardRuns(store) ??
  NO_RUNS` in MailScreen and in the Spec link, `heard.sessions === null ? []` on the runs board. The previous note listed
  three of the seven as behaviour changes because their fallback is an empty list. The review refuted that, and the
  characterization confirms the review: nothing shown changed, so no behaviour-change commit was needed.
- **negated-alias-gates-found** — the tighter census found six more gates in `RunsScreen.tsx` than the old pattern did.
  They go through `const noSignalYet = !runsFrameSeen`: the open runs' projects for the start sheet, the Stuck band,
  Closed today, Waiting on its coordinator, the info lines and the Loading line. `noSignalYet` is now `heard.runs === null`,
  so all of them ask the hook. No value changed: in the board's sense, `heard.runs === null` and `!runsFrameSeen` are one
  fact.
- **site7-runs-flag-hides-cards** — the subagent that wrote the characterization reported this. On the runs board, the
  needs-you count can only be seen once a runs frame has landed, because `noSignalYet` draws no card before that. So the
  ungated `live` that the count reads can never reach the screen before the frame. The count still reads `live`, as
  before.

## One subscription per half

- **one-subscription-per-half** — the hook subscribed to four slices: both flags and both lists. A surface that read only
  the runs, such as MailScreen's door, would therefore have been rendered again on every fleet frame. `useHeard` is now
  two halves. `useHeardSessions` and `useHeardRuns` are each one selector that answers the rows or null, and `useHeard`
  joins them. `pwa/test/use-heard.test.tsx` pins it in two ways. A runs reader is not rendered again by a fleet frame, and
  a sessions reader is not rendered again by a runs frame. A half that has not been heard stays null and is not rendered
  again by its rows. Measured red by a runs half that also subscribes to the sessions.
- **folded-where-the-surface-reads-only-heard** — the following surfaces no longer subscribe to a flag and its rows
  separately:
  - FleetScreen, whose runs line uses `useHeardRuns`;
  - MailScreen, which uses `useHeardRuns`;
  - the programme box's Spec link, which uses `useHeardRuns`;
  - the programme box's waiting chip, which uses `useHeard`;
  - RunDetailScreen's runs flag, which is now `heardRuns !== null`;
  - RunsScreen's two flags, which are now `heard.runs !== null` and `heard.sessions !== null`.
- **raw-rows-kept-where-read-ungated** — three surfaces still subscribe to a list both raw and through the hook. Each
  reads the store's rows as they stand, which this change does not touch:
  - FleetScreen's `sessions`: the fleet draws the snapshot's rows on a cold start;
  - RunDetailScreen's `liveRuns`: the open run's override and its re-read (D-5545);
  - RunsScreen's `live` and `sessions`: the board's open list and its lookups, which `noSignalYet` gates when it draws.

  Folding these would change what the screens show before a frame lands. The second subscription costs one selector
  call per store change and no extra render, because both selectors return the same reference.
- **fleet-flag-reads-kept** — RunDetailScreen still reads `fleetFrameSeen` raw, for `coordinatorPresence`. That read is
  an argument, not a gate on rows, so the census does not count it. Routing it through the hook would add a sessions
  subscription that the screen already has.

## The census

- **census-parses** — `pwa/test/use-heard.test.tsx` now parses each `pwa/src` file with TypeScript's parser, through
  `server/test/scan/parse.ts`'s `ts` export, the repository's one parser import. It counts:
  - a ternary whose condition is either flag, its negation, or a `&&`/`||`/`??`/comparison chain that contains it;
  - a `&&`/`||`/`??` chain used as a value (an initializer, an argument or a JSX child) with the flag as an operand,
    counted once per outermost chain.

  "The flag" covers four forms: a read of `.fleetFrameSeen` or `.runsFrameSeen` (`?.` included), an identifier with
  either name, or an alias bound in the same file. An alias is one of these:
  - a variable initialized from a read (a selector `store((s) => s.runsFrameSeen)` or its negation);
  - a destructured field;
  - a renamed import;
  - an alias of an alias, in any order (resolved to a fixed point).

  The census leaves alone a chain in an `if`, `while` or `for` test (`useColdRuns`'s re-read conditions), a prop of
  another name (`frameSeen?: boolean`, `props.frameSeen ?? false`), an argument (`coordinatorPresence(…, seen)`) and the
  hook's own answer (`heard.runs ?? []`, `heard.runs === null`). The allow-list is gone: the tree scan expects `{}` once
  the hook's two ternaries are counted.
- **census-arms-measured** — 16 mutants, each applied to a saved copy and restored by copying it back, and all 16 turned
  the suite red:
  - each census arm switched off (the initializer alias, the destructured alias, the renamed import, the short-circuit
    arm, `??`, `||`, negation stripping, the fixed point, outermost-only counting and the ternary arm);
  - the test-position exemption removed;
  - a short-circuit holder, and an alias ternary, added to a real `src` file (`StatusBar.tsx`);
  - both gates of the hook removed, and the runs half subscribing to the sessions as well.

  The fixed-point arm survived until a pin declared the alias before the name it aliases. Declarations in source order
  resolve in one pass.
- **census-parser-from-scan-parse** — the first version imported `typescript` directly. That turned
  `single-definition/advance-switches.test.ts` red ("only scan/parse.ts imports a TS parser"). It now imports the shared
  export, as the other pwa scan suites do.
- **census-known-width** — the census has known limits:
  - it has no scopes, so an alias binds its name across the whole file, which errs toward refusing;
  - it does not see a read through an element access (`s['runsFrameSeen']`), an assignment (`let x; x = s.runsFrameSeen`),
    a flag passed into a function and gated there under another name, or a gate in a statement (`if (seen) rows = runs`).

## Runs

- **deviation-refs-load-timeout** — on the first run, `server/test/deviation-refs.test.ts` "is looking at two real trees"
  timed out at 30.8 s while both heavy test slots were held. Run alone, it was green in 12 s.
- **browser-suite-local** — the whole browser suite was run locally, three shards one at a time, with two workers
  (`--maxWorkers=2`). The first try of shard 1 at the default worker count was killed by the test slice's 6 GB memory
  cap. Results:
  - shard 2: 33 files and 816 tests passed;
  - shard 3: 32 files and 1249 tests passed;
  - shard 1: 1500 of 1514 tests passed, with 12 skipped. The two failures came in a run with two OOM kills.
    `reader-frame` M8.20 read `fallback` where it expected `ready`, and `refined-phone`'s panel case measured
    "the control is 42 tall". Each file passed alone (24/24 and 53/53).
- **pwa-suite-local** — the whole pwa unit suite, run once locally with two workers (`--maxWorkers=2`): 15680 of 15683
  tests passed, with 2 skipped. The one failure came in a run with six OOM kills, in which vitest's type check was
  killed as well: `skin-switch`'s phone Goals-icon case timed out at 5 s. The file passed alone (29/29), and its type
  check passes on its own run.
