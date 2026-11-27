// The artifact tier's in-memory capability store (native Docs HTML artifacts X5, plan Task A2.2; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md section 3.3, "the capability's life").
// Ring L3: the store of spec section 9's table, over `node:crypto` for the token, the id and the hash; it does no I/O and decides
// over its own memory. The one writer of its records: a route reads a frozen view, whose `ref`, `pin`, origins and manifest
// entries are frozen too and whose manifest is a read-only wrapper, so no field of a record can be written through it.
//
// A CAPABILITY is a minted token's grant: one page of one project at one pin, the files its manifest names, the origins it may call
// and whether it may open windows. The store keeps the token only as its sha256 hex (the map's key and the record's `tokenHash`),
// never in plaintext, so nothing reachable from it, a list row or a view holds a token. It keeps no session secret generation
// either: whether the minting session still stands is asked of the `SessionLiveness` port at every decision, which reads the
// CURRENT generation, so a passphrase change ends every capability with no other act.
//
// NO SCHEDULER, NO TIMER, NO SWEEP. Expiry is decided where the store is asked: `mint`, `lookup`, `list` and `onEnd` each drop
// what is dead at `clock()` and announce each end, so a dead record's manifest is released at the next ask and the `too-many` limits
// never count an expired capability. A capability is dead at `now` when `now >= expiresAt` or its session is not live.
//
// Deferred to wave A3, whose content door is their only consumer: admission and in-flight counts (`admit`, `release`), the
// hourly byte charge (`charge`) and the range snapshots (`recordSnapshot`).
import { createHash, randomBytes } from 'node:crypto';
import {
  ARTIFACT_IDLE_MS, ARTIFACT_MAX_AGE_DRAFT_MS, ARTIFACT_MAX_AGE_MS, ARTIFACT_MAX_LIVE, ARTIFACT_MAX_LIVE_PER_SESSION,
  type ArtifactRow,
} from '../../../shared/artifacts.js';
import { isCapabilityToken } from '../../../shared/capabilityToken.js';
import type { DocPin, DocsRangePin, DocSectionSlug } from '../../../shared/docs.js';
import type { SessionLiveness } from './ports.js';

/** How many tokens one mint may draw before it gives up with `unmeasured`: a draw that is malformed, refused by the caller's
 *  `accept` (the mask has altered the URL it would form) or already in use is drawn again. */
export const ARTIFACT_MINT_DRAWS = 8;

/** One file the capability may load: its path relative to the section, the pin its bytes are read at, its measured size, its
 *  response MIME and whether it is committed (a draft file is not). */
export interface ArtifactManifestEntry {
  rel: string; pin: DocsRangePin; size: number; mime: string; committed: boolean;
}

/** A capability as a reader sees it: every field read-only. `dir` is the page's directory inside its section ('' at the section
 *  root), `page` its section-relative path, `pin` the pin the mint accepted, `ref` the tree read's commit and served ref, and
 *  `drafts` the manifest's uncommitted count. */
export interface Capability {
  readonly id: string;
  readonly tokenHash: string;
  readonly sessionIdHash: string;
  readonly project: string;
  readonly pin: DocPin;
  readonly ref: { readonly commit: string; readonly served: string };
  readonly section: DocSectionSlug;
  readonly dir: string;
  readonly page: string;
  readonly manifest: ReadonlyMap<string, ArtifactManifestEntry>;
  readonly drafts: number;
  readonly origins: readonly string[];
  readonly windows: boolean;
  readonly mintedAt: number;
  readonly lastAt: number;
}

/** What a mint is given: the capability less what the store itself decides. `drafts` is the store's to count from the manifest,
 *  never the caller's to state, because it picks the shorter absolute expiry. */
export type CapabilityInput = Omit<Capability, 'id' | 'tokenHash' | 'mintedAt' | 'lastAt' | 'drafts'>;

export type ArtifactMintAnswer =
  | { ok: true; id: string; token: string; expiresAt: number }
  | { ok: false; error: 'too-many' | 'unmeasured' };

export interface ArtifactStore {
  /** Drop what is dead, refuse `too-many` at the box-wide or per-session limit, then draw a token and an id (at most
   *  `ARTIFACT_MINT_DRAWS` times) until the token is well formed, `accept` takes the pair and neither is in use; none taken is
   *  `unmeasured` and nothing is stored. The token is returned ONCE, here, and kept nowhere. */
  mint(input: CapabilityInput, accept?: (token: string, id: string) => boolean): ArtifactMintAnswer;
  /** The live capability a token names, as a frozen view; null for a malformed, unknown, revoked or dead token (a dead one is
   *  dropped and its end announced). It does not touch the idle clock: `touch` does. */
  lookup(token: string): Capability | null;
  /** Move a live capability's idle clock to now. A dead or unknown id is left alone. */
  touch(id: string): void;
  /** End one capability. True when one was removed. */
  revoke(id: string): boolean;
  /** End every capability, or only one session's. Answers how many. */
  revokeAll(sessionIdHash?: string): number;
  /** The live capabilities as the console lists them: never a token, never a URL. */
  list(): ArtifactRow[];
  /** Run `f` once, synchronously, when the capability ends (revoked, revoked by `revokeAll`, or found dead by `lookup`, `mint`,
   *  `list` or `onEnd`). A dead or unknown id runs `f` at once. Answers the unsubscribe: an unsubscribed `f` never runs. */
  onEnd(id: string, f: () => void): () => void;
}

/** When a capability ends by the clock: an hour after its last request, and at an absolute age (twelve hours, two over a draft). */
export function expiresAt(c: Pick<Capability, 'mintedAt' | 'lastAt' | 'drafts'>): number {
  return Math.min(c.lastAt + ARTIFACT_IDLE_MS, c.mintedAt + (c.drafts > 0 ? ARTIFACT_MAX_AGE_DRAFT_MS : ARTIFACT_MAX_AGE_MS));
}

export const defaultToken = (): string => randomBytes(32).toString('base64url');
export const defaultId = (): string => randomBytes(16).toString('base64url');

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The store's own record: a capability whose idle clock the store alone moves. */
type Record_ = { -readonly [K in keyof Capability]: Capability[K] };

/** A read-only face over a map the store alone holds: it has no `set`, `delete` or `clear`, and is frozen, so a cast in a route
 *  cannot add a file to a grant. */
function readOnlyMap<K, V>(m: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const face: ReadonlyMap<K, V> = Object.freeze({
    get: (k: K) => m.get(k),
    has: (k: K) => m.has(k),
    get size() { return m.size; },
    keys: () => m.keys(),
    values: () => m.values(),
    entries: () => m.entries(),
    forEach: (f: (v: V, k: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      m.forEach((v, k) => f.call(thisArg, v, k, face));
    },
    [Symbol.iterator]: () => m.entries(),
  });
  return face;
}

/** A manifest entry copied and frozen, its pin too, so the mint door's own objects are never the record's. */
const frozenEntry = (e: ArtifactManifestEntry): ArtifactManifestEntry =>
  Object.freeze({ rel: e.rel, pin: Object.freeze({ ...e.pin }), size: e.size, mime: e.mime, committed: e.committed });

const pinLabel = (pin: DocPin): string => (pin.kind === 'committed' ? pin.commit.slice(0, 12) : `draft on ${pin.branch}`);

export function createArtifactStore(
  clock: () => number,
  liveness: SessionLiveness,
  draw: () => string = defaultToken,
  drawId: () => string = defaultId,
): ArtifactStore {
  const byHash = new Map<string, Record_>();
  const byId = new Map<string, Record_>();
  const subscribers = new Map<string, Set<() => void>>();

  const isDead = (rec: Record_, now: number): boolean => {
    if (now >= expiresAt(rec)) return true;
    try {
      return liveness.of(rec.sessionIdHash, now) !== 'live';
    } catch {
      return true; // the port never throws; a port that does is not a live session
    }
  };

  /** Remove the record and run each subscriber once. A subscriber that throws does not stop the others. A record already
   *  ended (a subscriber called back into the store) is left alone, so a later record never loses its entry to it. Answers
   *  whether this call ended it. */
  const end = (rec: Record_): boolean => {
    if (byId.get(rec.id) !== rec) return false;
    byHash.delete(rec.tokenHash);
    byId.delete(rec.id);
    const fs = subscribers.get(rec.id);
    subscribers.delete(rec.id);
    if (fs !== undefined) {
      for (const f of fs) {
        try { f(); } catch { /* an end's subscriber is not the store's to judge */ }
      }
    }
    return true;
  };

  const dropDead = (now: number): void => {
    const dead = [...byHash.values()].filter((rec) => isDead(rec, now));
    for (const rec of dead) end(rec);
  };

  return {
    mint(input, accept = () => true) {
      const now = clock();
      dropDead(now);
      if (byHash.size >= ARTIFACT_MAX_LIVE) return { ok: false, error: 'too-many' };
      let mine = 0;
      for (const rec of byHash.values()) if (rec.sessionIdHash === input.sessionIdHash) mine++;
      if (mine >= ARTIFACT_MAX_LIVE_PER_SESSION) return { ok: false, error: 'too-many' };
      for (let i = 0; i < ARTIFACT_MINT_DRAWS; i++) {
        const token = draw();
        const id = drawId();
        if (!isCapabilityToken(token) || !accept(token, id)) continue;
        const tokenHash = sha256hex(token);
        if (byHash.has(tokenHash) || byId.has(id)) continue;
        const manifest = new Map<string, ArtifactManifestEntry>();
        for (const [k, e] of input.manifest) manifest.set(k, frozenEntry(e));
        let drafts = 0;
        for (const e of manifest.values()) if (!e.committed) drafts++;
        const rec: Record_ = {
          id, tokenHash, sessionIdHash: input.sessionIdHash, project: input.project, pin: Object.freeze({ ...input.pin }),
          ref: Object.freeze({ commit: input.ref.commit, served: input.ref.served }), section: input.section, dir: input.dir,
          page: input.page,
          manifest: readOnlyMap(manifest), drafts, origins: Object.freeze([...input.origins]),
          windows: input.windows, mintedAt: now, lastAt: now,
        };
        byHash.set(tokenHash, rec);
        byId.set(id, rec);
        return { ok: true, id, token, expiresAt: expiresAt(rec) };
      }
      return { ok: false, error: 'unmeasured' };
    },

    lookup(token) {
      if (!isCapabilityToken(token)) return null;
      const rec = byHash.get(sha256hex(token));
      if (rec === undefined) return null;
      if (isDead(rec, clock())) {
        end(rec);
        return null;
      }
      return Object.freeze({ ...rec });
    },

    touch(id) {
      const rec = byId.get(id);
      const now = clock();
      if (rec !== undefined && !isDead(rec, now)) rec.lastAt = now;
    },

    revoke(id) {
      const rec = byId.get(id);
      return rec !== undefined && end(rec);
    },

    revokeAll(sessionIdHash) {
      const all = [...byHash.values()].filter((rec) => sessionIdHash === undefined || rec.sessionIdHash === sessionIdHash);
      let ended = 0;
      for (const rec of all) if (end(rec)) ended++;
      return ended;
    },

    list() {
      dropDead(clock());
      return [...byHash.values()].map((rec): ArtifactRow => ({
        id: rec.id, project: rec.project, section: rec.section, path: rec.page, pinLabel: pinLabel(rec.pin),
        mintedAt: rec.mintedAt, lastAt: rec.lastAt, expiresAt: expiresAt(rec), windows: rec.windows, origins: [...rec.origins],
      }));
    },

    onEnd(id, f) {
      const rec = byId.get(id);
      if (rec !== undefined && isDead(rec, clock())) end(rec);
      if (!byId.has(id)) {
        try { f(); } catch { /* as in `end` */ }
        return () => {};
      }
      let set = subscribers.get(id);
      if (set === undefined) { set = new Set(); subscribers.set(id, set); }
      const own = (): void => f();
      set.add(own);
      return () => { subscribers.get(id)?.delete(own); };
    },
  };
}
