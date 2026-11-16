// D-2545's test-side unwrappers.
//
// `CoordStore`'s five read surfaces answer a discriminated result now, because
// ABSENT and UNREADABLE are two conditions a caller handles differently and
// collapsing them into one `null` is the overloaded-null-at-a-seam defect this
// codebase bans. Almost every existing test asserts about a row it planted
// itself, on a database it just created, so for those the refusal arm is not a
// case — it is an impossibility, and asserting `.ok` at two hundred call sites
// would be noise that hides the handful of tests where the refusal IS the
// subject.
//
// These helpers make that split explicit: they THROW, naming the store's own
// detail, so a refusal in a test that did not expect one fails loudly rather
// than reading as an absent row. The tests that exercise the refusal arm call
// the store method directly and assert on the union — never through these.
import type {
  AskReadResult, AskRow, AsksByChildResult, AsksReadResult,
  OpenSibling, OpenSiblingsResult, RunReadResult, RunRow, RunsReadResult,
} from '../src/coord/store.js';

const refused = (what: string, detail: string): never => {
  throw new Error(`test expected a readable ${what}, got a refusal: ${detail}`);
};

export const okRun = (r: RunReadResult): RunRow | null =>
  r.ok ? r.run : refused('run', r.detail);

export const okRuns = (r: RunsReadResult): RunRow[] =>
  r.ok ? r.runs : refused('run list', r.detail);

export const okSiblings = (r: OpenSiblingsResult): OpenSibling[] =>
  r.ok ? r.siblings : refused('sibling list', r.detail);

export const okAsk = (r: AskReadResult): AskRow | null =>
  r.ok ? r.ask : refused('ask', r.detail);

export const okAsks = (r: AsksReadResult): AskRow[] =>
  r.ok ? r.asks : refused('ask list', r.detail);

export const okAsksByChild = (r: AsksByChildResult): Map<string, AskRow> =>
  r.ok ? r.asks : refused('ask map', r.detail);

// ARCH-62 (#797), slice 2: the store's `parentOfSession`, `openClaimantsOf` and `openRunsClaimedBy` readers were folded into
// `bindingRunsOf` / `openRunsForSession` / `runsNamingSession` (the census pins the four that remain). The tests that
// characterise them assert the PRODUCTION answers: `claimantsOfSession` and `openRunsClaimedBy` (coord/bindingReads.ts)
// are imported directly; the parent is `childParentOf` (coord/runBinding.ts, heldFor's and the drift lane's decider) over
// `bindingRunsOf`, with no minter, which is `parentOf` of the open binding.
import { childParentOf, unbornIncarnation, type Incarnation } from '../src/coord/runBinding.js';
import type { CoordStore } from '../src/coord/store.js';

/** The claimant of the session's open binding (`null`: none, or the open run is ownerless), as production decides it. */
export const parentOfSession = (s: Pick<CoordStore, 'bindingRunsOf'>, id: string, inc?: Incarnation): string | null => {
  const series = s.bindingRunsOf(id);
  return childParentOf(series.ok ? series.runs : refused('run series', series.detail), null, inc ?? unbornIncarnation(id, 'not-a-child'));
};
