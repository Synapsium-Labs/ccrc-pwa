// THE INTEGRITY CENSUS, AS A VIEW (D-5104, the audit's F5, data half).
//
// The server's registry census (`server/src/divergence.ts`) names every place
// two of the fleet's sources disagree — a worktree no row claims, a branch that
// drifted, a hold with no run — and sends the whole list on `/ws/fleet` as a
// `divergence` frame whenever it changes. The fleet store keeps the last one it
// received, with its receive time (`stores/fleet.ts`, `divergenceCensus`). This
// is the pure model a renderer reads: no UI reads it yet. The strip lands on
// the fleet screen with #402, and W2's status bar and inspector take it over.
//
// THREE STATES, AND THE FIRST IS NOT THE SECOND. The frame has NO COLD START —
// the server sends it on change only, and a fabricated empty census on connect
// "would claim a measurement this process may not have taken yet" (`server.ts`,
// `onDivergence`). So a page that connected after the last change has received
// nothing at all, and the store says so with `null`. That is `unmeasured`:
// never `clean`, which is an empty census this page actually received.
//
// NOTHING IS DROPPED. The frame is validated at its envelope only (an array),
// the depth `runs` and `fleet` are, so its members are untrusted here. A member
// whose `kind` this build cannot name — a newer server's seventh kind, or no
// string `kind` at all — is still something the server reported, so it is
// counted in a group of its own, after every kind this build can name. A census
// of nothing but such members is `diverged`, never `clean`.
//
// L0 ONLY: this imports `shared/api.ts` and nothing else, so the store can take
// its census type from here without a cycle, and either skin can render it.
import { DIVERGENCE_KINDS, isDivergenceKind, type Divergence, type DivergenceKind } from '../../../shared/api';

/** The fleet store's last census: the frame's members as they arrived, and the
 *  time this page received them (`Date.now()`, milliseconds). Held as `T | null`
 *  by the store, where `null` means no frame since this page loaded. */
export interface DivergenceCensus {
  readonly items: readonly Divergence[];
  readonly at: number;
}

/** One word per kind, as a heading the count is printed beside — never
 *  pluralised into it. A `Record`, so a kind added to `shared/api.ts` is a
 *  compile error here until it has a word. */
export const INTEGRITY_WORDS: Readonly<Record<DivergenceKind, string>> = {
  'unregistered-worktree': 'unregistered worktree',
  'branch-drift': 'branch drift',
  'claim-divergence': 'hold and run disagree',
  'provenance-mismatch': 'provenance mismatch',
  'archived-but-live': 'archived but live',
  'claim-orphan': 'orphaned claim',
};

/** The group for members this build cannot name. */
export const UNKNOWN_DIVERGENCE_WORD = 'unrecognised';

/** A group the census found members for. `known: false` is the one group of
 *  members whose kind this build cannot name, so it has no `kind` to carry. */
export type IntegrityGroup =
  | { readonly known: true; readonly kind: DivergenceKind; readonly count: number; readonly word: string }
  | { readonly known: false; readonly count: number; readonly word: string };

/** `age` is milliseconds since the census arrived, never below zero. */
export type IntegrityView =
  | { readonly state: 'unmeasured' }
  | { readonly state: 'clean'; readonly age: number }
  | {
    readonly state: 'diverged';
    readonly age: number;
    /** Every member, the unnamed ones included: the groups' counts add up to it. */
    readonly total: number;
    /** Only kinds with members, in `DIVERGENCE_KINDS` order, then the unknown group. */
    readonly groups: readonly IntegrityGroup[];
  };

/** A member's kind, if this build can name it. The member is untrusted (see the
 *  header), so it is read as `unknown` and narrowed by L0's own guard. */
const kindOf = (m: unknown): DivergenceKind | null => {
  if (typeof m !== 'object' || m === null) return null;
  const kind = (m as { kind?: unknown }).kind;
  return isDivergenceKind(kind) ? kind : null;
};

export function integrityView(census: DivergenceCensus | null, now: number): IntegrityView {
  if (census === null) return { state: 'unmeasured' };
  // A wall clock corrected backwards after the frame landed would otherwise
  // date the census in the future.
  const age = Math.max(0, now - census.at);
  if (census.items.length === 0) return { state: 'clean', age };

  const counts = new Map<DivergenceKind, number>();
  let unknown = 0;
  for (const m of census.items as readonly unknown[]) {
    const kind = kindOf(m);
    if (kind === null) unknown += 1;
    else counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const groups: IntegrityGroup[] = [];
  for (const kind of DIVERGENCE_KINDS) {
    const count = counts.get(kind);
    if (count !== undefined) groups.push({ known: true, kind, count, word: INTEGRITY_WORDS[kind] });
  }
  if (unknown > 0) groups.push({ known: false, count: unknown, word: UNKNOWN_DIVERGENCE_WORD });
  return { state: 'diverged', age, total: census.items.length, groups };
}
