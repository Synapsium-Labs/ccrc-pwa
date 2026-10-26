// W8's journal-chain census module (the 2026-10-26 consolidation W8 plan, Task C8-0's census split).
// The journal chain (the journal kernel and its epoch floors, ARCH-73)
// fills it with its census queries, in C8f, then C8g.
// Each query returns `CensusSite` rows the way `consolidationCensus.ts`'s own do, and `consolidationCensus.ts`
// re-exports this module, so every count a W8 PR body quotes still comes from a named census query. Its fixture and
// real-tree rows live in the sibling `journal.test.ts`, which the chain's first task creates. No other chain edits this
// file; a chain's first task that finds it non-empty stops and reports.
export {};
