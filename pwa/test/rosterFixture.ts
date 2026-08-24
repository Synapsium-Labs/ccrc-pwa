// The shared TEST roster — the fixture every PWA test that needs a real
// account label/hue reaches for, rather than seven independent copies of the
// same five production accounts.
//
// Stage 2a Task 6 deleted `shared/api.ts`'s compile-time `ACCOUNTS` literal;
// Task 7 deleted `pwa/src/lib/accounts.ts`'s `PRODUCTION_ROSTER`, the
// transitional hand-typed copy Task 6 left behind for exactly this deletion.
// `accountLabel`/`accountHue`/`homeAbleLabelList` are now pure projections
// over whatever `RosterWire[]` a caller hands them — production gets that
// array off `GET /api/accounts`'s wire; a test gets it from here.
//
// Ids and `homeAble` are transcribed from the deleted `PRODUCTION_ROSTER`;
// the labels are the neutral `team·…` fixture vocabulary (stage-5 de-brand,
// spec §5/D-202 — the real fleet's labels are ratcheted out of the tree by
// `server/test/topology-clean.test.ts`, and every label here except `gpt`'s
// stays ≠ its id so label/id confusions keep failing). Hues match
// `server/test/helpers.ts`'s `DEFAULT_TEST_ROSTER` — the server suite's own
// root copy of this same roster shape — rather than inventing a
// second assignment: `claude-dev0` gets `green`, the concrete case this
// task's SessionScreen/SwapSheet fix exists for (its `colorVar` used to be
// the non-hue `--ink-tertiary`, and a wrapper whose token wasn't an
// `--acct-*` name fell through to `claude`'s cyan).
import type { RosterWire } from '../../shared/api';

export const TEST_ROSTER: RosterWire[] = [
  { id: 'claude', label: 'team·max', hue: 'cyan', homeAble: true },
  { id: 'claude2', label: 'team·alt', hue: 'violet', homeAble: true },
  { id: 'claude-corp', label: 'team·b', hue: 'blue', homeAble: true },
  // Opt-in only: a lane a session reaches solely by being sent there on
  // purpose, never one ccd's `_ws_least_loaded` chooses on its own.
  { id: 'gpt', label: 'gpt', hue: 'magenta', homeAble: false },
  { id: 'claude-dev0', label: 'team·d', hue: 'green', homeAble: true },
];
