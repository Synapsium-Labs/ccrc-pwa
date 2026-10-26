// W8's spawn-chain census module (the 2026-10-26 consolidation W8 plan, Task C8-0's census split).
// The spawn chain (the update spawn kernel and the spawner audits, ARCH-73)
// fills it with its census queries, in C8c, then C8d, then C8e.
// Each query returns `CensusSite` rows the way `consolidationCensus.ts`'s own do, and `consolidationCensus.ts`
// re-exports this module, so every count a W8 PR body quotes still comes from a named census query. Its fixture and
// real-tree rows live in the sibling `spawn.test.ts`, which the chain's first task creates. No other chain edits this
// file; a chain's first task that finds it non-empty stops and reports.
export {};
