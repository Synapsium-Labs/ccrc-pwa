/**
 * What the Settings section says about the connection, decided from two measured reads (named workspaces S4b,
 * design §5.1). L1 POLICY: pure. It imports types and the L0 vocabulary only, makes no I/O, and is handed the
 * key's digest by its caller (a hash of the key is a computation this file would otherwise need `token/files`
 * for, an L3 import).
 *
 * THE KEY IS NEVER AN INPUT. A `key` read arrives as its digest alone, so no line here can put the credential
 * into a view, even by mistake.
 *
 * EVERY CONDITION ITS OWN STATE. The key file's four non-value kinds each have a state, and the details file's
 * three (plus "describes another key") fold into one `details-unknown` that still says which, because the
 * remedy is the same (press Check again) and the reason is worth a line in the section.
 */
import type { LinearConnectionView, LinearDetailsRead } from '../../../shared/linear.js';

/** `readLinearKey`'s answer with the key replaced by its digest. */
export type KeyMeasure =
  | { kind: 'key'; digest: string }
  | { kind: 'absent' }
  | { kind: 'unusable' }
  | { kind: 'placeholder' }
  | { kind: 'unreadable' };

/**
 * What a failed key check means for the STORED outcome: Linear's 401/403 says the key is bad (`rejected`);
 * every other arm (a timeout, a 5xx, a refused connection, an answer of the wrong shape) decided nothing about
 * the key, so it is `unreachable`. The wire to the caller keeps the arm word (`timeout`, `malformed`); only the
 * stored outcome folds, because the section's table has one state for "could not check".
 */
export function checkOutcomeOf(reason: 'unauthorised' | 'timeout' | 'malformed' | 'unreachable'): 'rejected' | 'unreachable' {
  return reason === 'unauthorised' ? 'rejected' : 'unreachable';
}

export function linearConnectionView(key: KeyMeasure, details: LinearDetailsRead): LinearConnectionView {
  switch (key.kind) {
    // Details with no key are a half-finished Disconnect, and describe nothing that is stored.
    case 'absent': return { state: 'not-connected' };
    case 'unreadable': return { state: 'unreadable' };
    case 'unusable': return { state: 'unusable' };
    case 'placeholder': return { state: 'placeholder' };
    case 'key': break;
  }
  if (details.kind !== 'details') return { state: 'details-unknown', why: details.kind };
  const d = details.details;
  if (d.keyDigest !== key.digest) return { state: 'details-unknown', why: 'stale' };
  const shown = { org: d.org, user: d.user, keyTail: d.keyTail, checkedAt: d.checkedAt };
  switch (d.outcome) {
    case 'ok': return { state: 'connected', outcome: 'ok', ...shown };
    case 'rejected': return { state: 'key-rejected', outcome: 'rejected', ...shown };
    case 'unreachable': return { state: 'unreachable', outcome: 'unreachable', ...shown };
  }
}
