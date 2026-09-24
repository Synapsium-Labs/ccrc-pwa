// The one spelling of "what the nodes run" (design 2026-09-20 §13; plan W3 Task 3, D-3301).
//
// Two packages say the same clause: the server's release push ("On stable — fleet and server are on v0.0.7.")
// and the PWA's update banner ("v0.0.9 is out on stable — fleet and server are on v0.0.7."). Written twice it
// is two sentences to keep in step, so it lives here, in L0, and both import it; `single-definition.test.ts`
// holds the clause to this one file across the four TS roots.
//
// L0: this file imports NOTHING — not a type, not `node:*` — because the PWA bundles it. Its row type is
// STRUCTURAL (`role` and `version` as plain strings), so neither the server's `NodeRow` nor the wire's
// `NodeWire` leaks into L0: each caller maps its own row onto `SummaryRow` at the call site.

/** One node, as the summary reads it: `version` is a release tag, or `null` = unversioned (no stamp, an
 *  unreadable one, or a stamp that carries no tag). `role` is `NodeRole`'s word, or `null` = unknown. */
export interface SummaryRow { role: string | null; version: string | null }

/** How a node with no tag reads — the word `BuildLine` and `FleetHostBanner` already show. */
export const UNVERSIONED_WORD = 'unversioned';
/** How a side with no row at all reads (a fleet node never measured, a server row not yet written). */
export const MISSING_SIDE = '—';

/** The two sides of a fleet. `server` = the first row whose role is `server` or `both` (W2 Task 14's
 *  `derivedBuilds` picks its `own` side the same way); `fleet` = the first row whose role is `fleet`, else the
 *  server row itself when ITS role is `both` — one box that is both, local mode, where "the fleet" and "the
 *  server" are the same install. A row whose role is `null` or another word is on neither side. Generic, so a
 *  caller gets its own row objects back. */
export function versionSides<T extends { role: string | null }>(rows: readonly T[]): { fleet: T | null; server: T | null } {
  const server = rows.find((r) => r.role === 'server' || r.role === 'both') ?? null;
  const fleet = rows.find((r) => r.role === 'fleet') ?? (server !== null && server.role === 'both' ? server : null);
  return { fleet, server };
}

/** One side as text: its tag, `UNVERSIONED_WORD` when it has none, `MISSING_SIDE` when there is no row. */
export function sideVersion(row: SummaryRow | null): string {
  if (row === null) return MISSING_SIDE;
  return typeof row.version === 'string' ? row.version : UNVERSIONED_WORD;
}

/** `fleet and server are on v0.0.7` when BOTH sides are present and run the SAME TAG; otherwise each side
 *  named — `fleet v0.0.7 · server v0.0.9`, `fleet — · server v0.0.7`, `fleet unversioned · server v0.0.7`.
 *  Two unversioned sides do not "agree": nothing is known to be the same, so they are named one by one. */
export function versionsSummary(rows: readonly SummaryRow[]): string {
  const { fleet, server } = versionSides(rows);
  if (fleet !== null && server !== null && typeof fleet.version === 'string' && fleet.version === server.version) {
    return `fleet and server are on ${fleet.version}`;
  }
  return `fleet ${sideVersion(fleet)} · server ${sideVersion(server)}`;
}
