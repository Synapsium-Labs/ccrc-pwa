// The artifact tier's words on the console (X5 A5.1; spec 2026-11-19 §2.5, §3.2 "Earlier versions", §6.2). Ring L1: words only,
// no logic. The sentences of spec §2.5 name `ccrc expose artifacts` and `ccrc doctor` in code font there; the console keeps them
// as plain text. `why` is the launch sheet's Why line (§6.2), drawn by A5.2.
export const ARTIFACT_TEXT = {
  open: 'Open as artifact',
  setup: 'Running it in full needs this box\'s artifact host (ccrc expose artifacts).',
  byAddress: 'This box is reached by address, and artifacts need names.',
  listenerDown: 'This box\'s artifact listener is not running. ccrc doctor says why.',
  version: 'Only the current version of a page runs as an artifact. Go back to the latest to open it.',
  why: 'The view above runs this page within ccrc\'s walls, where dialogs, windows, downloads, WebAssembly, workers and large files may not work. '
    + 'As an artifact it runs in full, in a new tab.',
} as const;
