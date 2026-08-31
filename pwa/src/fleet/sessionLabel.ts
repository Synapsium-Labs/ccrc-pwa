import type { FleetSession } from '../../../shared/api';

/**
 * What to call a session, everywhere.
 * `title ?? name ?? branch ?? workspace ?? id`.
 *
 * `title` LEADS, and it is the only rung a human typed on purpose: it is what
 * the operator gave `ws-add --title`, held verbatim in `$REG/<id>.title`. It
 * outranks `name` because `name` is Claude Code's — a title it derived from
 * the conversation — and it outranks `branch` because the ai-title sweep
 * rewrites `branch` and is specifically forbidden from touching a workspace
 * the operator named (`sweepNames`' thirteenth condition). A named workspace
 * therefore reads the same on every surface for its whole life, which is the
 * property the slug cannot provide (31 characters, lowercase) and the reason
 * the two are separate fields at all.
 *
 * `name` is only ever present when it is worth showing: the server drops
 * Claude Code's derived session handles (`openclawhetzner-42` — cwd basename
 * plus a counter) before they reach the wire, so a non-null name is one a
 * human chose. Branch outranks the slug because a workspace's branch gets
 * renamed to something descriptive while `workspace` keeps the slug it was
 * born with; the `id` tail keeps the rule total for legacy rows, which have
 * no workspace.
 *
 * THAT SECOND CLAUSE IS NOW HALF TRUE, and the half it loses is the common
 * one. Wave 3 §3.1 freezes a workspace's name for the life of a claim — the
 * naming sweep skips a held row or one an open run names, and `ccd ws-rename`
 * refuses a held workspace — so for the whole of a wave this function returns
 * `ws/<slug>`, the born name, and the descriptive rename lands only after the
 * claim is released. A claimed worker row therefore reads exactly like an
 * unclaimed brand-new one. That is the deliberate trade: a name a ledger can
 * cite beats a prettier one that moves under it mid-wave.
 *
 * OPEN QUESTION FOR THE OPERATOR, deliberately NOT decided in code: should a
 * claimed row fall back to its run's `program`/`wave` instead of the slug?
 * `RunSummary` carries both and the fleet store already holds the run list,
 * so it is cheap — but it changes what every worker row is called for the
 * length of a program, which is a product decision, not a refactor.
 */
export function sessionLabel(session: FleetSession): string {
  return session.title ?? session.name ?? session.branch ?? session.workspace ?? session.id;
}
