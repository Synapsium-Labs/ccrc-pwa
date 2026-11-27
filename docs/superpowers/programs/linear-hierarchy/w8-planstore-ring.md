# Run 4048 (`w8-planstore-ring`): the plan store is L3 by its header

Linear hierarchy wave 8, follow-up, from review 3994 of #3454 (finding F1). This note is D-9148's record. The one plan
edit is the D-9148 line in the plan's Deviations section.

## The defect

`server/src/coord/planStore.ts` is the plan tables' store: every function takes the `DatabaseSync` handle and reads or
writes `coord.db` through it. By the 08-10 architecture spec that is an adapter, L3. But the rings classifier
(`serverRing`, `server/test/rings/ring.ts`) decides a ring from the file's own facts, and this file's facts are inward:

- its `node:sqlite` import is `import type`, which the classifier does not count;
- it imports no other I/O module, holds no timer and imports no `fastify`;
- its header declared no ring.

So the classifier read it **L1, "no outer-ring fact"**. A runtime value import of the store from an L1 policy file then
pointed sideways (L1 to L1), and the rings suite's outward-edge check could not see it. #3454 had one such import, and it
was fixed by hand: `ADOPTED_FINGERPRINT` now lives in `server/src/linear/planSyncPolicy.ts`, and the store re-exports it.

The spec has a rule for this case: a file that does its I/O only through the deps it is handed looks like L1 by its
imports, and it states its ring in its header. `coord/store.ts` does this already ("ring L3 ("), and
`outward-edges.test.ts` pins it (#2370).

## The classification

Confirmed L3, as the brief expected. The file runs SQL (`prepare`, `exec`) on the handle it is handed, opens
transactions through `tx.ts`, and makes no decision of its own: the decisions are `planPolicy.ts`'s and
`planSyncPolicy.ts`'s. No other reading fits. It is not L2 (it declares values), and it is not L4 (no fastify, no
scheduler).

The header now carries this line, in the grammar the classifier reads (`Ring L3:` at the start of a comment line):

> Ring L3: an adapter, which reads and writes coord.db through the handle it is handed. …

A declaration only moves a file outward of its facts, so the classifier's reason now reads "declares L3 in its header".

## The edges (step 3)

Measured on `main` at `f3b3cceed7`, with a scratch probe over the classifier's own functions (`serverRing`,
`runtimeEdges`, `resolveLocal`): 20 import edges into `planStore.ts`, from 18 files.

| From | Ring | Edge |
|---|---|---|
| `coord/openRun.ts`, `coord/planPolicy.ts`, `coord/planRunFacts.ts` | L1 | type only |
| `linear/inboundPolicy.ts`, `linear/inboundRetire.ts`, `linear/migrationPolicy.ts`, `linear/planSyncPolicy.ts` | L1 | type only |
| `deps.ts` | L2 | type only |
| `coord/store.ts` | L3 | value (`* as planStore`) |
| `coord/hierarchyRoutes.ts`, `coord/ledgersRoutes.ts`, `linear/driftPass.ts`, `linear/inboundLane.ts` | L4 | type only |
| `coord/planRoutes.ts` (`NO_PLAN_CHANGES`), `coord/routes.ts` (`planStorePort`) | L4 | value |
| `linear/migration.ts` (`EMPTY_MIGRATION_REPORT`, `IssueHeldError`, `MIGRATION_PLAN_BY`) | L4 | value |
| `linear/planSync.ts` (`ADOPTED_FINGERPRINT`) | L4 | value |
| `index.ts` (`planStorePort`) | L5 | value |

**Findings: none.** No L1 or L2 file imports a value from the store; every value importer is L3 or outward of it. With
the store at L3, the suite's real-tree check ("the outward runtime edges are exactly the exemptions") stays green with
the exemption set still empty. The store's own runtime imports (`planPolicy.ts`, `inboundRetire.ts`,
`planSyncPolicy.ts`, `tx.ts`, `programmeLifecycleStore.ts`, `shared/`) are all L0 or L1, so they point inward. So step 3
needed no fix and no commit.

## The guard (step 4), red first

Two commits:

1. **Characterization**, green on `main`'s code. It pins today's reading: `planStore.ts` is L1, "no outer-ring fact"; no
   L1 or L2 file loads a value from it; and a planted L1 file (`coord/planted.ts`, importing `ADOPTED_FINGERPRINT`, the
   #3454 shape) is not an outward edge.
2. **The declaration**, with the characterization turned into the guard. `planStore.ts` reads L3, "declares L3 in its
   header"; no L1 or L2 file loads a value from it; the planted import is exactly one outward edge, L1 to L3; and the same
   import, type-only, is none. Run before the header line, the guard failed with `ring: "L1", why: "no outer-ring fact"`.
   Run after it, it passed.

The mutations were run by hand on the committed tree, then restored with `git checkout`. The coordinator skill's
mutation helper mutates Python modules only.

| Mutant | Result |
|---|---|
| M1: the header line removed | killed: the CONTROL fails on the ring (`L1`, "no outer-ring fact") |
| M2: the header line kept; `planSyncPolicy.ts` given a runtime import of `NO_PLAN_CHANGES` from the store | killed twice: the CONTROL lists `L1 server/src/linear/planSyncPolicy.ts :20 {NO_PLAN_CHANGES}`, and the real-tree check names the new L1 to L3 edge |
| M3: both, no header line and the value import | the CONTROL fails, but the real-tree check passes: the hole review 3994 found |

M3 shows why there are two arms. The ring assertion holds the declaration. The value-importer assertion stands even if the
declaration goes, because it lists every L0 to L2 value edge into the store whatever ring the store reads.

## The limits

- **The guard covers one file.** The same idiom (a type-only `DatabaseSync`, SQL run on a handed handle, no header ring)
  makes the classifier read 11 more `server/src/coord/` files L1. A probe on this branch found them: `advisorStore.ts`,
  `claudeBuildDeliveriesStore.ts`, `claudeBuildsStore.ts`, `coordCallsStore.ts`, `ledgersStore.ts`,
  `lifecycleLaneRows.ts`, `linkingStore.ts`, `programmeFactsStore.ts`, `programmeLifecycleStore.ts`,
  `reviewCapStore.ts` and `tx.ts`. Declaring them is a design call and was not done here, because some of them would
  get outward edges at once:
  - `tx.ts` is loaded at runtime by `coord/rundefsTx.ts` and `operatorModel/nudgeQueue.ts`. Its own header says those
    are meant to stay policy files that load no `node:sqlite`.
  - `coord/reclaim.ts` (L1) loads `OPERATOR_UNMEASURED` and `ProgrammeActor` from `programmeLifecycleStore.ts`.
  - Store-to-store edges (`linkingStore.ts` to `coordCallsStore.ts`, `programmeLifecycleStore.ts` to `ledgersStore.ts`)
    would point sideways once both sides are L3.
- **A declaration is a promise in prose.** A new store written in this idiom reads L1 until its author adds the header
  line. The classifier has no fact that would make it L3. One candidate is "names `DatabaseSync` and calls `.prepare(`
  on it", but that is a change to the spec's rules, so it is not made here.
- **Re-exports.** `planStore.ts` re-exports `ADOPTED_FINGERPRINT` (from `planSyncPolicy.ts`) and `markSyncDueInTx`. An
  L1 file that takes one of them through the store now shows as an outward edge, which is the point: it should import
  from the value's L1 owner.
