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
 *  unreadable one, or a stamp that carries no tag). `role` is `NodeRole`'s word, or `null` = unknown.
 *  `stated` — fix round 1 (F1/F14, D-3316) — is false when this reading does not VOUCH for `version` at all:
 *  a row that is unmeasured this run, whose stamp did not read, or that is `reachable: false` (§18 "unreachable
 *  is not current", widened by D-3316 from the settings inventory to every summary reader). Such a row still
 *  OCCUPIES its `role` (so no other row falls back to standing in for it — the point of picking sides from every
 *  live row FIRST, below), but the clause states nothing about it: it renders exactly as if there were no row at
 *  all. Omitted (`undefined`), a row is `stated` — the default every existing caller and test relies on. */
export interface SummaryRow { role: string | null; version: string | null; stated?: boolean }

/** How a node with no tag reads — the word `BuildLine` and `FleetHostBanner` already show. */
export const UNVERSIONED_WORD = 'unversioned';
/** How a side with no row at all reads (a fleet node never measured, a server row not yet written) — and,
 *  since fix round 1 (D-3316), how an occupied but unstated side reads too. */
export const MISSING_SIDE = '—';

/** The two sides of a fleet. `server` = the first row whose role is `server` or `both` (W2 Task 14's
 *  `derivedBuilds` picks its `own` side the same way); `fleet` = the first row whose role is `fleet`, else the
 *  server row itself when ITS role is `both` — one box that is both, local mode, where "the fleet" and "the
 *  server" are the same install. A row whose role is `null` or another word is on neither side. Generic, so a
 *  caller gets its own row objects back.
 *
 *  Fix round 1 (F1, D-3316): a caller decides sides from EVERY live row, never a pre-filtered subset — filtering
 *  out an unmeasured/unread/unreachable row BEFORE this pick is exactly what lets the `both`-row fallback below
 *  stand in for a fleet nobody measured (the reviewer's rows: a `both` row plus a `fleet` row whose stamp did not
 *  read). A row that does not vouch for its version still occupies its role; whether it STATES that version is
 *  `sideVersion`'s question, asked afterwards, never this function's. */
export function versionSides<T extends { role: string | null }>(rows: readonly T[]): { fleet: T | null; server: T | null } {
  const server = rows.find((r) => r.role === 'server' || r.role === 'both') ?? null;
  const fleet = rows.find((r) => r.role === 'fleet') ?? (server !== null && server.role === 'both' ? server : null);
  return { fleet, server };
}

/** `versionSides` for a REMOTE fleet (D-3313, moved here from `pwa/src/fleet/BuildLine.tsx` in fix round 1 so
 *  the server can call it too — item 1): a `both` row is THIS box, never the fleet box, so a fleet side that
 *  turns out to BE the server row (the `both`-row fallback above) comes back null instead. `BuildLine` and
 *  `FleetHostBanner`'s skew arm render only on a remote fleet, where a `both`-recorded server row (an explicit
 *  role override, most likely) must never lend its own version to an unmeasured fleet box. Local mode calls
 *  `versionSides` directly (D-3301) — its one `both` row genuinely IS both sides. */
export function remoteSides<T extends { role: string | null }>(rows: readonly T[]): { fleet: T | null; server: T | null } {
  const { fleet, server } = versionSides(rows);
  return { fleet: fleet === server ? null : fleet, server };
}

/** One side as text: its tag, `UNVERSIONED_WORD` when it has none, `MISSING_SIDE` when there is no row OR the
 *  row occupying the side does not vouch for its version (`stated === false`, D-3316). */
export function sideVersion(row: SummaryRow | null): string {
  if (row === null || row.stated === false) return MISSING_SIDE;
  return typeof row.version === 'string' ? row.version : UNVERSIONED_WORD;
}

/** `fleet and server are on v0.0.7` when BOTH sides are present, STATED and run the SAME TAG; otherwise each
 *  side named — `fleet v0.0.7 · server v0.0.9`, `fleet — · server v0.0.7`, `fleet unversioned · server v0.0.7`.
 *  Two unversioned sides do not "agree": nothing is known to be the same, so they are named one by one. Over
 *  already-decided sides (a remote fleet's `remoteSides`, or local mode's `versionSides`) — never filters rows
 *  itself; a caller that filtered before picking sides is the D-3316 bug, not this function's contract. */
export function summaryFromSides(sides: { fleet: SummaryRow | null; server: SummaryRow | null }): string {
  const { fleet, server } = sides;
  if (
    fleet !== null && server !== null && fleet.stated !== false && server.stated !== false &&
    typeof fleet.version === 'string' && fleet.version === server.version
  ) {
    return `fleet and server are on ${fleet.version}`;
  }
  return `fleet ${sideVersion(fleet)} · server ${sideVersion(server)}`;
}

/** `summaryFromSides` over `versionSides` — D-3301's default, right for local mode's one `both` row. A remote
 *  fleet picks its sides through `remoteSides` first (D-3313) and calls `summaryFromSides` directly. */
export function versionsSummary(rows: readonly SummaryRow[]): string {
  return summaryFromSides(versionSides(rows));
}
