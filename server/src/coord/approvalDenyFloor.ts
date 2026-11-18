import type { ApprovalClass } from './approvalguard.js';

/**
 * THE STALE DENY DIGEST (Overlord approvals PR 0; plan 2026-11-18-overlord-approvals.md §3.2.1, Table 3c). Pure: no
 * I/O, no clock. Two deciders, read by `questions.raiseApproval`.
 *
 * A child records `$REG/<id>.deny-settings`, the sha256 of the managed deny file it was spawned with (`ccd`'s spawn, its
 * one writer). When `ccrc update` installs a changed deny list, every child spawned before then carries an older digest
 * for the rest of its life: a running Claude Code pins a `--settings` file's content at start (measured on 2.1.327, the
 * PR's note), so it never loads the new rules. Before this module the hook and the server both refused such a child, and
 * every prompt of it reached the operator with no row.
 *
 * Now the install spine (`ccd/install-session-hooks.sh`, the file's one writer) keeps `$REG/child-deny.digests`, one
 * `<digest> <epoch ms>` line per digest the managed file has had, newest last, at most `CHILD_DENY_DIGESTS_MAX` lines.
 * A child whose digest that history names is routed and held, its class left as the classifier gave it, and the row
 * records "deny current" as its own fact (`approvals.denyCurrent`). The rule door asks `approvalAllowRefusal`, which
 * refuses an allow on a row whose deny rules are not current, so a coordinator may deny it or hand it over, never allow
 * it (spec §6.6's guarantee, kept for allows). A digest in neither the managed file nor the history is refused
 * `deny-not-engaged`, as before.
 */

/** The installer's digest history, beside the managed deny file in the registry. Its one writer is the install spine. */
export const CHILD_DENY_DIGESTS_FILE = 'child-deny.digests';
/** The newest lines the history keeps, and the most this reader reads: a line older than these is forgotten. */
export const CHILD_DENY_DIGESTS_MAX = 32;

/** Where a child's spawn digest stands: the managed file's current digest, one the history names, or neither. */
export type DenyStanding = 'current' | 'history' | 'none';

const DIGEST = /^[0-9a-f]{64}$/;
const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}$/;

/**
 * `child` is the child's `.deny-settings` digest (null: none recorded), `managed` the sha256 of the managed deny file as
 * read now (null: unreadable), and `history` the history file's text (null: absent or unreadable). An unreadable managed
 * file is `none` even for a digest the history names: with the current rules unmeasured, nothing is engaged. Only a line
 * of the exact shape counts, and only the newest `CHILD_DENY_DIGESTS_MAX` non-empty lines are read.
 */
export function denyStandingOf(child: string | null, managed: string | null, history: string | null): DenyStanding {
  // The child's digest needs no shape check of its own: it only ever matches a checked managed digest or a checked line.
  if (managed === null || !DIGEST.test(managed)) return 'none';
  if (child === managed) return 'current';
  if (history === null) return 'none';
  const lines = history.split('\n').filter((l) => l !== '').slice(-CHILD_DENY_DIGESTS_MAX);
  for (const l of lines) {
    const m = HISTORY_LINE.exec(l);
    if (m !== null && m[1] === child) return 'history';
  }
  return 'none';
}

/** Why an allow is refused at the rule door, or null when it may be signed. `rowClass` is the class stored at mint (a
 *  string: a word a newer build wrote is not `ordinary`), `again` the classifier run once more over the input held for
 *  the window (`escalate` when none is held), and `denyCurrent` the row's own fact. Forbidden on either side is
 *  `guard-forbidden`, first. A row whose child runs under older deny rules than the box's is `deny-not-current`,
 *  whatever its class: the fact is the child's, so it answers the same before and after a server restart. Anything
 *  else short of `ordinary` on both sides is `guard-escalate`. A deny or a hand-over never asks: they stay open on
 *  every row. */
export function approvalAllowRefusal(
  rowClass: string, again: ApprovalClass, denyCurrent: boolean,
): 'guard-forbidden' | 'deny-not-current' | 'guard-escalate' | null {
  if (rowClass === 'forbidden' || again === 'forbidden') return 'guard-forbidden';
  if (!denyCurrent) return 'deny-not-current';
  if (rowClass !== 'ordinary' || again !== 'ordinary') return 'guard-escalate';
  return null;
}
