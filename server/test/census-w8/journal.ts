// W8's journal-chain census module (the 2026-10-26 consolidation W8 plan, Task C8-0's census split).
// The journal chain (the journal kernel and its epoch floors, ARCH-73)
// fills it with its census queries, in C8f, then C8g.
// Each query returns `CensusSite` rows the way `consolidationCensus.ts`'s own do, and it imports what it needs from
// `consolidationCensus.ts`, which never re-exports it (D-TBD-c8-0b-header-wording), so no import cycle forms, and
// every count a W8 PR body quotes comes from a named query of this module. It reads no imported value at top level
// (only types, and functions called inside a query). Its fixture and real-tree rows live in the sibling
// `journal.test.ts`, which the chain's first task creates. No other chain edits this file; a chain's first task that
// finds it non-empty stops and reports.
export {};
