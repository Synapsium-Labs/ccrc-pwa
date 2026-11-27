// The artifact tier's words on the console (X5 A5.1, A5.2; spec 2026-11-19 §2.5, §3.2, §6.2). Ring L1: words only,
// no logic. The sentences of spec §2.5 name `ccrc expose artifacts` and `ccrc doctor` in code font there; the console keeps them
// as plain text. `why` is the launch sheet's Why line (§6.2). The sheet's other lines carry `{host}`, `{n}` and `{m}` slots that
// `fillSentence` (docsText.ts) fills. The pin-moved sentence names no remedy: its one action is the button "Reload and open again".
// Another stop that can be tried again (the files could not be listed, a read that did not complete) has the button "Retry"; a few
// other sentences say in words what the operator does (revoke one, commit the draft).
import type { ArtifactRefusal } from '../../../../shared/artifacts';

export const ARTIFACT_TEXT = {
  open: 'Open as artifact',
  setup: 'Running it in full needs this box\'s artifact host (ccrc expose artifacts).',
  byAddress: 'This box is reached by address, and artifacts need names.',
  listenerDown: 'This box\'s artifact listener is not running. ccrc doctor says why.',
  version: 'Only the current version of a page runs as an artifact. Go back to the latest to open it.',
  why: 'The view above runs this page within ccrc\'s walls, where dialogs, windows, downloads, WebAssembly, workers and large files may not work. '
    + 'As an artifact it runs in full, in a new tab.',
  sheetTitle: 'Open as artifact',
  whatRuns: 'This page\'s own code runs in a new tab on {host}, a separate site with no ccrc session. '
    + 'It can read the {n} files beside it at this version ({m} uncommitted). It cannot reach ccrc.',
  originNote: 'loads from this host can carry what the page shows to it, and may see this link',
  above: '{n} references point above this page\'s folder and will not load',
  unsized: '{n} files beside it could not be measured and will not load',
  notScanned: 'This page was not scanned, so outside hosts cannot be offered and references above its folder are not counted. '
    + 'It runs with outside loads closed.',
  othersOpen: 'Another artifact is open. Pages run as artifacts can share data with each other while open',
  windows: 'Let it open windows. A window it opens can send what the page shows anywhere.',
  prepare: 'Prepare',
  openLink: 'Open',
  cancel: 'Cancel',
  pinMoved: 'This page changed since you opened it.',
  reloadOpen: 'Reload and open again',
  retry: 'Retry',
  reading: 'Reading what this page can reach.',
} as const;

/** The sentence of every refusal the scope read or the mint answers (spec §3.2, "Refusals"). Total over `ArtifactRefusal`: a word
 *  added to the type fails to compile here until it has its sentence. `pin-moved` is the one sentence with an action of its own
 *  (a button) and names no remedy in words. */
export const ARTIFACT_REFUSAL_TEXT: Record<ArtifactRefusal, string> = {
  'auth-off': 'Sign-in is off on this box, so a page cannot be opened as an artifact.',
  'insecure-origin': 'Pages open as artifacts only over a secure connection.',
  'unauthenticated': 'You are not signed in.',
  'unsupported': 'This box cannot open pages as artifacts.',
  'artifact-host-unset': ARTIFACT_TEXT.setup,
  'artifact-listener-down': ARTIFACT_TEXT.listenerDown,
  'not-html': 'Only an HTML page opens as an artifact.',
  'too-many': 'Too many artifacts are open. Revoke one, then prepare again.',
  'bad-origin': 'One of the chosen hosts cannot be allowed.',
  'unmeasured': 'The page\'s files could not be listed. Try again.',
  'pin-moved': ARTIFACT_TEXT.pinMoved,
  'page-too-large': 'This page is above the 64 MiB per-file limit, so it cannot open as an artifact.',
  'draft-too-large': 'This draft is above 4 MiB, so it cannot be pinned for an artifact. Commit it, then open it again.',
};
