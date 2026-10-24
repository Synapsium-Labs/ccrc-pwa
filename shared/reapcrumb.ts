// L0. The reaping breadcrumb as the wire carries it (ARCH-25, #531): ccd's per-workspace
// `.reaping` marker, which a destructive verb writes before each step so an interrupted
// cleanup can say where it stopped. Imports NOTHING: the PWA bundles shared/*.ts.
//
// ONE GRAMMAR, `<act>:<phase>`, where a bare phase is `ws-reap`'s own spelling. ccd's
// `_crumb_parse` is the one reader on the box; this is the one reader on the wire, and it
// FAILS CLOSED the same way: a crumb the vocabulary below does not hold is `unknown`, a
// typed arm a caller must handle, never a string passed through to a screen. The words a
// person reads live in the PWA (`pwa/src/session/reapWords.ts`), keyed off these types.

/** The verbs that leave a breadcrumb. */
export type ReapAct = 'reap' | 'reclaim' | 'expire';

/** The steps a verb passes, in the order it passes them; `clips` is `ws-reap`'s alone and
 *  `artifacts` the other two's. */
export type ReapPhase = 'children' | 'worktree' | 'branch' | 'clips' | 'artifacts';

// Derived-enumeration discipline (`SESSION_ROLE_MAP`'s): a member added to the union is a compile error here.
const REAP_ACT_MAP: Record<ReapAct, true> = { reap: true, reclaim: true, expire: true };
export const REAP_ACTS: readonly ReapAct[] = Object.keys(REAP_ACT_MAP) as ReapAct[];
const REAP_PHASE_MAP: Record<ReapPhase, true> = { children: true, worktree: true, branch: true, clips: true, artifacts: true };
export const REAP_PHASE_NAMES: readonly ReapPhase[] = Object.keys(REAP_PHASE_MAP) as ReapPhase[];

/** The phases each act ever writes — the table `parseReapCrumb` reads, and the one the
 *  PWA's word tables are typed against. */
export const REAP_PHASES: Readonly<Record<ReapAct, readonly ReapPhase[]>> = {
  reap: ['children', 'worktree', 'branch', 'clips'],
  reclaim: ['children', 'worktree', 'branch', 'artifacts'],
  expire: ['children', 'worktree', 'branch', 'artifacts'],
};

/** A crumb as read. `unknown` keeps the raw token for a diagnostic and nothing else: no
 *  screen renders it. */
export type ReapCrumb =
  | { readonly kind: 'known'; readonly act: ReapAct; readonly phase: ReapPhase }
  | { readonly kind: 'unknown'; readonly raw: string };

/** `raw` is the file's text; an empty one is not a crumb (the caller maps it to `null`). */
export function parseReapCrumb(raw: string): ReapCrumb {
  const colon = raw.indexOf(':');
  const prefixed = colon > 0 ? raw.slice(0, colon) : '';
  const act: ReapAct = prefixed === 'reclaim' || prefixed === 'expire' ? prefixed : 'reap';
  const phase = act === 'reap' ? raw : raw.slice(colon + 1);
  const known = (REAP_PHASES[act] as readonly string[]).includes(phase);
  return known
    ? { kind: 'known', act, phase: phase as ReapPhase }
    : { kind: 'unknown', raw };
}
