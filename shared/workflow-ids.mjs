// shared/workflow-ids.mjs — the one definition of Claude Code's workflow run id (W4 addendum P10, the shared arm).
//
// L0, a `.mjs` that imports nothing. Two readers, in two rings, name it: the server's workflow reader
// (`server/src/workflows/model.ts` re-exports it) and ccrc history's policy ring (`ccd/history/lib.mjs`, whose import
// block is pinned to this file and `node:crypto` alone by history-lib.test.ts). A copy in either would be a second
// writer of the grammar, so single-definition/vocabularies.test.ts holds this file as the one definer.
// Types: the hand-written `workflow-ids.d.mts` beside it.

/** Claude Code's run id, as measured: `wf_` + 8 hex + `-` + 3 hex. Anything else in a runs directory is not a run. */
export const RUN_ID_RE = /^wf_[0-9a-f]{8}-[0-9a-f]{3}$/;
