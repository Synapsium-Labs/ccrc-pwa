// L1, context C3 (Session Conversation): `actKeyClaimVerdict`, whether the claim door issues the act key (Overlord spec
// §3.3.11 H12 "The fence", §3.6 H1 "The door process (H9)"; plan `w1-door-process.md` Task 1, ruled F2). Pure: the claim
// door (`routes.ts`, L4) reads the facts once through `actKeyStore.ts` and `continuityStore.ts` (L3), asks here, and acts.
//
// THE CLAIM BINDS THE NEWEST RECORDED START. The door process presents the launch nonce ccd wrote into its config; the hook
// put the nonce's sha256 on that spawn's start report (`continuity_starts.doorNonceSha256`). The key is issued once, for the
// generation minted from the start carrying the hash, and only while that start is the session's newest and its generation
// has not ended. A start no spawn bound (an older hook, a start nobody spawned) carries no hash, so it never matches.
// "Newest" and "matching" read only starts that can mint (slug claim-reads-starts-that-can-mint): a compaction keeps the
// conversation and carries the same process environment, so its start report repeats the hash and mints nothing; read as a
// start, it would supersede the start whose generation the key belongs to, and leave the claim `renewing` for ever.
import type { GenerationState } from '../../../shared/continuity.js';
import type { ClaimWhy } from '../../../shared/continuity-door.js';

/** A fact the door read, or the read's failure: never folded into an answer. */
export type ClaimRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** One recorded start as the claim reads it: its hash (null: the start bound no nonce) and the generation minted from it. */
export interface StartFact {
  readonly startId: number;
  readonly nonceSha256: string | null;
  readonly generation: { readonly id: number; readonly n: number; readonly state: GenerationState } | 'not-minted';
}

/** What the door read, each read once in one synchronous stretch. `presented` is the sha256 of the presented nonce, hashed
 *  by the door. */
export interface ClaimFacts {
  readonly presented: string;
  /** An act-key row already holding this hash (`actKeyByNonce`). */
  readonly spent: ClaimRead<{ readonly generationId: number } | 'none'>;
  /** The session's newest recorded start that can mint (`newestStartOf`). */
  readonly newest: ClaimRead<StartFact | 'none'>;
  /** The session's newest start that can mint and carries this hash, if any (`startByNonce`). */
  readonly matching: ClaimRead<StartFact | 'none'>;
}

export type ClaimRefusal = 'renewing' | 'stale-generation' | 'unmeasured';
export type ClaimVerdict =
  | { readonly kind: 'issue'; readonly generationId: number; readonly n: number }
  | { readonly kind: 'refuse'; readonly error: ClaimRefusal; readonly why: ClaimWhy };

const refuse = (error: ClaimRefusal, why: ClaimWhy): ClaimVerdict => ({ kind: 'refuse', error, why });

/** Does the claim door issue the key? First match wins:
 *  1. any read unmeasured: `unmeasured` (`store-unreadable`);
 *  2. the nonce already spent: `stale-generation` (`nonce-spent`), and the door counts the refusal on that row;
 *  3. no start carries the hash: `renewing` (`start-unreported`): the hook spools the start while the server is away;
 *  4. the matching start is not the newest: `stale-generation` (`superseded`): a newer spawn's door process exists;
 *  5. the matching start's generation is not minted yet: `renewing` (`not-minted`);
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
  if (newest === 'none' || newest.startId !== matching.startId) return refuse('stale-generation', 'superseded');
  if (matching.generation === 'not-minted') return refuse('renewing', 'not-minted');
  if (matching.generation.state === 'ended') return refuse('stale-generation', 'generation-ended');
  return { kind: 'issue', generationId: matching.generation.id, n: matching.generation.n };
}
