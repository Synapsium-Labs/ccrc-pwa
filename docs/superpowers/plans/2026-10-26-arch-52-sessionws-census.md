# ARCH-52's exit is pinned: SessionStream polls 4 -> 0, dialog frame producers 2 -> 1

**Size:** S. **Deploy class:** server tests only (`server/test/consolidationCensus.ts`, `server/test/consolidation-census.test.ts`); no `ccd/`, `agent/`, `pwa/` or wire change. One task.

## Problem

The consolidation spec's §5.5 exit for ARCH-52 (#787) is "SessionStream polls: 4 -> 0, dialog frames per change per socket: 2 -> 1". `main` already meets both: the per-session reads live in `sessionFeed.ts`, once per open session, and `sessionws.ts` is the one file that builds a `dialog` / `dialog_cleared` frame. Nothing held either count there.

## Task 1: two named census queries and the pin (D-6977)

**Files:** `server/test/consolidationCensus.ts` (`sessionStreamPollSites`, `dialogFrameProducers`), `server/test/consolidation-census.test.ts` (one fixture row per query and one real-tree row).

**Verify:** `consolidation-census`, `deviation-refs`, `dtbd`, `growth-check`, `single-definition`.

## Deviations found

- **D-6977** — `arch-52-sessionws-census`: ARCH-52's two series reached their target on `main`, so this is the census's first pin in the spirit of spec §5.1 rule 3 (rev 2): `sessionStreamPollSites` must stay at 0 and `dialogFrameProducers` at the one file `server/src/sessionws.ts`. Both queries are fixture-tested first and real-tree-tested second. `sessionStreamPollSites` has a known width: it reads only `server/src/sessionws.ts` and only the named reader calls, so a poll moved to another file or made through a renamed reader is not seen.
