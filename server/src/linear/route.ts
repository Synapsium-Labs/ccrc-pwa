/**
 * Workspace routing (#1444, D-7668; spec 2026-10-31 §4.2): which Linear slot a call reaches, from what it names.
 *
 * L1 POLICY: pure and total. It imports types only, makes no I/O and never calls Linear, so routing costs a call
 * nothing and cannot spend its deadline (§4.3, §6.6). A miss is answered here at once; refreshing what the slots know
 * is the background refresher's (`refresher.ts`), never a request's.
 *
 * NEVER A GUESS. Team keys are compared uppercased (a key can repeat across Linear workspaces), and where two slots
 * match, the answer is a refusal that names them, never the first match. An issue reference's prefix is a ROUTING HINT
 * only: it picks the slot, and the issue's team is whatever Linear says it is now (§4.5).
 */
import type { LinearSlotRef, LinearStoreRead } from './store.js';

/** A slot as the router reads it: where it points, and what its last check learned (nothing, when none has). */
export interface LinearRouteSlot {
  ref: LinearSlotRef;
  /** The workspace's id. Always known for a file slot (it is the file's name); the legacy slot is routable only once
   *  its Check again has learned it. */
  workspaceId: string;
  /** The workspace's URL key (`--workspace`), or null when no check of the present key has learned it. */
  urlKey: string | null;
  /** The team keys the key's user reaches, uppercased; empty when nothing is learned. */
  teamKeys: readonly string[];
}

/** What a call names (§4.2's input). `issue`: an issue reference's prefix, a hint. `team`: `--team`, or a body's
 *  `team`. `workspace`: a workspace-wide verb. Each may also name a workspace by its URL key. */
export type LinearRouteAsk =
  | { kind: 'issue'; prefix: string; workspace: string | null }
  | { kind: 'team'; team: string; workspace: string | null }
  | { kind: 'workspace'; workspace: string | null };

/** The router's refusal words (spec §6.8): `team-unknown` and `workspace-unknown` (404), `team-ambiguous` and
 *  `workspace-required` (409), `not-configured` (501). */
export type LinearRouteRefusal = 'team-unknown' | 'workspace-unknown' | 'workspace-required' | 'not-configured';

export type LinearRoute =
  | { kind: 'slot'; slot: LinearRouteSlot }
  | { kind: 'refused'; word: LinearRouteRefusal }
  /** `candidates`: the matching slots' URL keys, sorted, for the detail: `--workspace` is the remedy. */
  | { kind: 'refused'; word: 'team-ambiguous'; candidates: string[] };

type Listed = Extract<LinearStoreRead, { kind: 'listed' }>;

/**
 * The slots a store read can route (§3.4). Every file slot is one: its id is its workspace's, and its URL key and teams
 * are its record's only while that record describes the key now in the file (the digest rule), so a record left by a
 * replaced key routes nothing. The legacy slot is one only once its Check again has learned its workspace (a
 * `legacy-teams.json` whose digest matches), and never while a file slot holds that workspace: the file slot wins, so
 * one workspace never routes ambiguously against itself.
 */
export function routableSlots(store: Listed): LinearRouteSlot[] {
  const out: LinearRouteSlot[] = store.slots.map((s) => {
    const current = currentDetails(s);
    return {
      ref: { source: 'file', id: s.id },
      workspaceId: s.id,
      urlKey: current?.urlKey ?? null,
      teamKeys: (current?.teams ?? []).map((t) => t.key.toUpperCase()),
    };
  });
  const legacy = store.legacy;
  if (legacy !== null && legacy.workspace !== null && !legacy.superseded) {
    out.push({
      ref: { source: 'legacy' },
      workspaceId: legacy.workspace.workspaceId,
      urlKey: legacy.workspace.urlKey,
      teamKeys: legacy.workspace.teams.map((t) => t.key.toUpperCase()),
    });
  }
  return out;
}

/** A file slot's record while it describes the key now in the file (the digest rule), else null. */
export function currentDetails(s: Listed['slots'][number]) {
  return s.key.kind === 'key' && s.record.kind === 'details' && s.record.details.keyDigest === s.key.digest ? s.record.details : null;
}

/**
 * D-8405: every team the routable slots reach, key (uppercased), name and workspace id and name, in slot order: what the automatic team link
 * chooses among. The same slots `routableSlots` answers, by the same rules, so a team the router cannot reach is never
 * linked; a key two workspaces share appears once per workspace, each as its own (workspace, key) pair (D-8808).
 */
export function routableTeams(store: Listed): Array<{ key: string; name: string; workspaceId: string; workspaceName: string | null }> {
  const out = store.slots.flatMap((s) => {
    const d = currentDetails(s);
    return (d?.teams ?? []).map((t) => ({ key: t.key.toUpperCase(), name: t.name, workspaceId: s.id, workspaceName: d?.name ?? null }));
  });
  const legacy = store.legacy;
  if (legacy !== null && legacy.workspace !== null && !legacy.superseded) {
    const w = legacy.workspace;
    out.push(...w.teams.map((t) => ({ key: t.key.toUpperCase(), name: t.name, workspaceId: w.workspaceId, workspaceName: w.name as string | null })));
  }
  return out;
}

/** Whether a slot holds a team: both sides uppercased, whoever built the slot. */
const holds = (s: LinearRouteSlot, team: string): boolean => s.teamKeys.some((k) => k.toUpperCase() === team.toUpperCase());

/**
 * D-8808: where a project row's team key resolves. A row that names no workspace resolves exactly as `routeLinear` does for a
 * team (a key two workspaces share is `team-ambiguous`). A row that names one resolves in the slots of that workspace only: the
 * slot if it holds the key, else `team-unknown` (the workspace is gone, or no longer has the team); never `team-ambiguous`, and
 * `not-configured` only when there are no slots at all. The ONE resolver every project-team caller asks.
 */
export function routeProjectTeam(slots: readonly LinearRouteSlot[], row: { teamKey: string; workspaceId: string | null }): LinearRoute {
  if (row.workspaceId === null) return routeLinear(slots, { kind: 'team', team: row.teamKey, workspace: null });
  if (slots.length === 0) return { kind: 'refused', word: 'not-configured' };
  const own = slots.find((s) => s.workspaceId === row.workspaceId && holds(s, row.teamKey));
  return own === undefined ? { kind: 'refused', word: 'team-unknown' } : { kind: 'slot', slot: own };
}

/** Whether a project belongs to a team in a workspace. Unpinned rows require an unambiguous routing snapshot. */
export function projectOnTeam(
  row: { teamKey: string | null; workspaceId: string | null }, team: string, workspaceId: string, slots: readonly LinearRouteSlot[] | null,
): boolean {
  if (row.teamKey === null || row.teamKey.toUpperCase() !== team.toUpperCase()) return false;
  if (row.workspaceId !== null) return row.workspaceId === workspaceId;
  if (slots === null) return false;
  const route = routeProjectTeam(slots, { teamKey: row.teamKey, workspaceId: null });
  return route.kind === 'slot' && route.slot.workspaceId === workspaceId;
}

/** §4.2's table. Total: every ask answers one slot or one refusal word. */
export function routeLinear(slots: readonly LinearRouteSlot[], ask: LinearRouteAsk): LinearRoute {
  if (slots.length === 0) return { kind: 'refused', word: 'not-configured' };

  // A named workspace first: every row that names one is answered within it.
  if (ask.workspace !== null) {
    const named = slots.filter((s) => s.urlKey !== null && s.urlKey === ask.workspace);
    if (named.length === 0) return { kind: 'refused', word: 'workspace-unknown' };
    // Two slots claiming one URL key (a store a later check repairs) are never chosen between.
    if (named.length > 1) return { kind: 'refused', word: 'workspace-required' };
    const only = named[0]!;
    // An issue reference with a workspace takes that slot whatever its prefix (§4.5 resolves the team), so a prefix
    // two workspaces share, or one no slot holds any more, can still be reached.
    if (ask.kind === 'team' && !holds(only, ask.team)) return { kind: 'refused', word: 'team-unknown' };
    return { kind: 'slot', slot: only };
  }

  if (ask.kind === 'workspace') {
    return slots.length === 1 ? { kind: 'slot', slot: slots[0]! } : { kind: 'refused', word: 'workspace-required' };
  }

  const key = ask.kind === 'team' ? ask.team : ask.prefix;
  const holding = slots.filter((s) => holds(s, key));
  if (holding.length === 1) return { kind: 'slot', slot: holding[0]! };
  if (holding.length === 0) return { kind: 'refused', word: 'team-unknown' };
  const candidates = holding.flatMap((s) => (s.urlKey === null ? [] : [s.urlKey])).sort();
  return { kind: 'refused', word: 'team-ambiguous', candidates };
}
