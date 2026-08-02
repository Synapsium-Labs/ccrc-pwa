// BYPASS FIXTURE — MUST NOT COMPILE.
//
// The same grant as g1, written BELOW the `ccd` key. The pair is the evidence
// that the new mechanism is position-independent: same error, same code, from a
// diff the old source-text slice would have treated completely differently.
import type { ExecWhitelist } from '../../../src/whitelist.js';

export const widened: ExecWhitelist = {
  tmux: [['has-session']],
  ccd: [['start']],
  gh: [['pr', 'view']],
};
