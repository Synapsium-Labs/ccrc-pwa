// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The exact mutation the final review performed to prove the no-`gh` invariant
// was pinned by one deletable test: `gh: [['pr','view']]` written ABOVE the
// `ccd` key. Position mattered to the old pin — the server's layer-3 check
// slices the source text from the `ccd` key onward, so a key written above it
// was outside the slice and went unseen (measured: 35/35 server PASS with the
// grant in place). A TYPE has no notion of "above": g1 and g2 differ only in
// where the key is written and produce the identical error.
import type { ExecWhitelist } from '../../../src/whitelist.js';

export const widened: ExecWhitelist = {
  gh: [['pr', 'view']],
  tmux: [['has-session']],
  ccd: [['start']],
};
