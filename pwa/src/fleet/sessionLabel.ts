import type { FleetSession } from '../../../shared/api';

/**
 * What to call a session, everywhere. `name ?? branch ?? workspace ?? id`.
 *
 * `name` is only ever present when it is worth showing: the server drops
 * Claude Code's derived session handles (`openclawhetzner-42` — cwd basename
 * plus a counter) before they reach the wire, so a non-null name is one a
 * human chose. Branch outranks the slug because a workspace's branch gets
 * renamed to something descriptive while `workspace` keeps the slug it was
 * born with; the `id` tail keeps the rule total for legacy rows, which have
 * no workspace.
 */
export function sessionLabel(session: FleetSession): string {
  return session.name ?? session.branch ?? session.workspace ?? session.id;
}
