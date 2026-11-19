// L1, context C3 (Session Conversation): `actKeyClaimVerdict`, whether the claim door issues the act key (Overlord spec
// §3.3.11 H12 "The fence", §3.6 H1 "The door process (H9)"; plan `w1-door-process.md` Task 1, ruled F2). Pure: the claim
// door (`routes.ts`, L4) reads the facts once through `actKeyStore.ts` and `continuityStore.ts` (L3), asks here, and acts.
//
// THE CLAIM BINDS THE NEWEST START THE GENERATIONS LANE MINTED FROM (review 2636 F1, slug claim-reads-the-minted-start). The
// door process presents the launch nonce ccd wrote into its config; the hook put the nonce's sha256 on that spawn's start
// report (`continuity_starts.doorNonceSha256`). The key is issued once, for the generation minted from the start carrying
// the hash, and only while no start the lane minted from was recorded after it and its generation has not ended. A start no
// spawn bound (an older hook, a start nobody spawned) carries no hash, so it never matches. A start the lane declines (a
// compaction or a fork, a nested process in the pane, which inherits the spawn's environment and so its hash, a start older
// than the live generation's, a role or row the lane does not mint) mints nothing, so it neither supersedes the start whose
// generation the key belongs to nor stands in for it: the generation row names the start it was minted from
// (`continuity_generations.startId`), and the reads follow that, never the newest start by source.
import type { GenerationState } from '../../../shared/continuity.js';
import type { ClaimWhy } from '../../../shared/continuity-door.js';

/** A fact the door read, or the read's failure: never folded into an answer. */
export type ClaimRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** One recorded start as the claim reads it: its place in the session's order (`reportedAt`, then id: `StartRow`'s ORDER
 *  note), its hash (null: the start bound no nonce) and the generation minted from it. */
export interface StartFact {
  readonly startId: number;
  readonly reportedAt: number;
  readonly nonceSha256: string | null;
  readonly generation: { readonly id: number; readonly n: number; readonly state: GenerationState } | 'not-minted';
}

/** What the door read, each read once in one synchronous stretch. `presented` is the sha256 of the presented nonce, hashed
 *  by the door. */
export interface ClaimFacts {
  readonly presented: string;
  /** An act-key row already holding this hash (`actKeyByNonce`). */
  readonly spent: ClaimRead<{ readonly generationId: number } | 'none'>;
  /** The session's newest start the generations lane minted from (`newestMintedStartOf`). */
  readonly newest: ClaimRead<StartFact | 'none'>;
  /** Of the session's starts carrying this hash, the newest the lane minted from, else the newest (`startByNonce`). */
  readonly matching: ClaimRead<StartFact | 'none'>;
}

export type ClaimRefusal = 'renewing' | 'stale-generation' | 'unmeasured';
export type ClaimVerdict =
  | { readonly kind: 'issue'; readonly generationId: number; readonly n: number }
  | { readonly kind: 'refuse'; readonly error: ClaimRefusal; readonly why: ClaimWhy };

const refuse = (error: ClaimRefusal, why: ClaimWhy): ClaimVerdict => ({ kind: 'refuse', error, why });

/** Was start `a` recorded after start `b`? One session's order: `reportedAt`, then id. */
const recordedAfter = (a: StartFact, b: StartFact): boolean =>
  a.reportedAt > b.reportedAt || (a.reportedAt === b.reportedAt && a.startId > b.startId);

/** Does the claim door issue the key? First match wins:
 *  1. any read unmeasured: `unmeasured` (`store-unreadable`);
 *  2. the nonce already spent: `stale-generation` (`nonce-spent`), and the door counts the refusal on that row;
 *  3. no start carries the hash: `renewing` (`start-unreported`): the hook spools the start while the server is away;
 *  4. a start the lane minted from was recorded after the matching start: `stale-generation` (`superseded`): a newer
 *     spawn's generation exists, and so does its door process. It holds whether or not the matching start minted, so a
 *     start the lane declined never answers `renewing` for ever once a newer one has minted;
 *  5. the matching start's generation is not minted yet: `renewing` (`not-minted`). While no newer start has minted, this
 *     is the lane's next pass, or a start it declined (a role or row it does not mint), which fails closed;
 *  6. that generation has ended: `stale-generation` (`generation-ended`);
 *  7. otherwise `issue`, for that generation. */
export function actKeyClaimVerdict(f: ClaimFacts): ClaimVerdict {
  if (!f.spent.ok || !f.newest.ok || !f.matching.ok) return refuse('unmeasured', 'store-unreadable');
  if (f.spent.value !== 'none') return refuse('stale-generation', 'nonce-spent');
  const matching = f.matching.value;
  if (matching === 'none' || matching.nonceSha256 === null || matching.nonceSha256 !== f.presented) {
    return refuse('renewing', 'start-unreported');
  }
  const newest = f.newest.value;
  if (newest !== 'none' && recordedAfter(newest, matching)) return refuse('stale-generation', 'superseded');
  if (matching.generation === 'not-minted') return refuse('renewing', 'not-minted');
  if (matching.generation.state === 'ended') return refuse('stale-generation', 'generation-ended');
  return { kind: 'issue', generationId: matching.generation.id, n: matching.generation.n };
}
