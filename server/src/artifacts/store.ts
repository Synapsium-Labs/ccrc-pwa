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
// THE LOAD COUNTS (X5 A3.3, D-9135), which the content door reads and this store alone writes. A capability carries its
// in-flight count, its queue length, the bytes it has served in the current hour and the hour's start; the store carries the
// box-wide in-flight count. A request that has just arrived is `admit`ted and gets a TICKET, a number unique for the store's
// life that names its place: `waiting` (one queue place of its capability) or `running` (one in-flight slot of its capability
// and one box slot). `admitLoad` and `admitQueued` (policy.ts) decide; the store only counts. `promote` asks whether a waiting
// ticket's turn has come, and `release` frees what a ticket holds, once: a second call, or a call for an unknown ticket, does
// nothing, so a slot is never freed twice. A capability that ends loses its queue places with its record, but a running ticket
// still holds its box slot until it is released (the response it serves is still on its way out), so the box count is never
// freed twice and never leaked. `charge` is the capability's hourly byte budget (the window restarts an hour after its start,
// asked only where the store is asked, with no timer); it answers `ok`, `over-budget` (a spent hour) or `dead` (an ended or
// unknown capability) as three words, and throws for a count that is not a whole non-negative number. `recordSnapshot` keeps one
// range snapshot per manifest entry, which the view shows through a read-only face. A route reads these in a frozen view and writes none of them.
import { createHash, randomBytes } from 'node:crypto';
import {
  ARTIFACT_HOURLY_BYTES, ARTIFACT_IDLE_MS, ARTIFACT_MAX_AGE_DRAFT_MS, ARTIFACT_MAX_AGE_MS, ARTIFACT_MAX_LIVE,
  ARTIFACT_MAX_LIVE_PER_SESSION, type ArtifactRow,
} from '../../../shared/artifacts.js';
import { isCapabilityToken } from '../../../shared/capabilityToken.js';
import type { DocPin, DocsRangePin, DocSectionSlug } from '../../../shared/docs.js';
import type { SessionLiveness } from './ports.js';
import { ARTIFACT_BUDGET_WINDOW_MS, admitLoad, admitQueued } from './policy.js';

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
  /** The requests of this capability running now, and those waiting for a place (X5 A3.3): the store's counts as of this view. */
  readonly inflight: number;
  readonly queued: number;
  /** The bytes charged in the current hour and when that hour began (a new capability's hour begins at `mintedAt`). */
  readonly servedThisHour: number;
  readonly hourStart: number;
  /** The recorded range snapshot of each manifest entry, by the entry's key: a read-only face, like `manifest`. */
  readonly snapshots: ReadonlyMap<string, string>;
}

/** What the store alone decides about a capability, and a mint is never given (X5 A3.3). */
type StoreDecided = 'id' | 'tokenHash' | 'mintedAt' | 'lastAt' | 'drafts' | 'inflight' | 'queued' | 'servedThisHour' | 'hourStart'
  | 'snapshots';

/** What a mint is given: the capability less what the store itself decides. `drafts` is the store's to count from the manifest,
 *  never the caller's to state, because it picks the shorter absolute expiry. */
export type CapabilityInput = Omit<Capability, StoreDecided>;

/** What `admit` answers for a request that has just arrived: run it now (it holds a slot, under `ticket`), make it wait (it
 *  holds a queue place, under `ticket`), refuse it because the queue is full, or refuse it because the capability has ended. */
export type ArtifactAdmitAnswer =
  | { kind: 'run'; ticket: number }
  | { kind: 'wait'; ticket: number }
  | { kind: 'full' }
  | { kind: 'dead' };

/** What `promote` answers for a waiting ticket: its turn has come (it now holds a slot), it still waits, its capability has
 *  ended (the ticket is spent), or it is not a waiting ticket at all. */
export type ArtifactPromoteAnswer = { kind: 'run' } | { kind: 'wait' } | { kind: 'dead' } | { kind: 'gone' };

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
  /** A request has just arrived for the capability: a dead or unknown one is `dead` (decided as `lookup` decides, and a dead
   *  one is ended and announced); else `admitLoad` decides whether it runs, waits or is refused as `full`, and a run or a wait
   *  takes its place and returns the ticket that names it. */
  admit(id: string): ArtifactAdmitAnswer;
  /** Whether a waiting ticket's turn has come, by `admitQueued`; true turns it into a running one. A ticket that is not
   *  waiting (released, already running, unknown) is `gone`; one whose capability has ended is `dead` and is spent. */
  promote(ticket: number): ArtifactPromoteAnswer;
  /** Free what a ticket holds, once: a waiting ticket its queue place, a running ticket its capability's in-flight slot (if
   *  that capability still lives) and its box slot (always). Every later call for it, and a call for an unknown ticket, does
   *  nothing. */
  release(ticket: number): void;
  /** The running requests of the whole box, whichever capability they belong to, ended or not. */
  boxInflight(): number;
  /** Charge `bytes` to the capability's hour: `ok`; `over-budget`, charging nothing, when they would pass `ARTIFACT_HOURLY_BYTES`
   *  (a spent hour and nothing else); `dead`, charging nothing, for a capability that has ended or was never minted (it fails
   *  shut, and a caller tells it from a spent hour by the word). A count that is not a non-negative safe integer is a caller's
   *  programming error: it throws a `RangeError` (naming no id), whatever the capability's state, and charges nothing. */
  charge(id: string, bytes: number): 'ok' | 'over-budget' | 'dead';
  /** Set a live capability's snapshot for a manifest key, or remove it for `null`. A dead or unknown id, or a key that is not
   *  in its manifest, is left alone. */
  recordSnapshot(id: string, rel: string, snapshot: string | null): void;
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
  /** Each live capability's snapshots, by its id; the record shows them through a read-only face. */
  const snapData = new Map<string, Map<string, string>>();
  /** The tickets in hand, each naming the record it was taken on (by identity, so a record that has ended is never mistaken for a
   *  live one) and whether it waits or runs. A ticket leaves the map when it is released or spent. */
  const tickets = new Map<number, { rec: Record_; state: 'waiting' | 'running' }>();
  let nextTicket = 0;
  /** Running requests box-wide: it counts a running ticket whose capability has ended until that ticket is released. */
  let boxRunning = 0;

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
    snapData.delete(rec.id);
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

  /** The live record for an id, decided as `lookup` decides (the clock, then liveness); a dead one is ended and announced. */
  const liveRecord = (id: string): Record_ | null => {
    const rec = byId.get(id);
    if (rec === undefined) return null;
    if (isDead(rec, clock())) {
      end(rec);
      return null;
    }
    return rec;
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
        const snaps = new Map<string, string>();
        const rec: Record_ = {
          id, tokenHash, sessionIdHash: input.sessionIdHash, project: input.project, pin: Object.freeze({ ...input.pin }),
          ref: Object.freeze({ commit: input.ref.commit, served: input.ref.served }), section: input.section, dir: input.dir,
          page: input.page,
          manifest: readOnlyMap(manifest), drafts, origins: Object.freeze([...input.origins]),
          windows: input.windows, mintedAt: now, lastAt: now,
          inflight: 0, queued: 0, servedThisHour: 0, hourStart: now, snapshots: readOnlyMap(snaps),
        };
        byHash.set(tokenHash, rec);
        byId.set(id, rec);
        snapData.set(id, snaps);
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

    admit(id) {
      const rec = liveRecord(id);
      if (rec === null) return { kind: 'dead' };
      const verdict = admitLoad({ inflight: rec.inflight, queued: rec.queued }, boxRunning);
      if (verdict === 'full') return { kind: 'full' };
      const ticket = ++nextTicket;
      if (verdict === 'run') {
        rec.inflight++;
        boxRunning++;
        tickets.set(ticket, { rec, state: 'running' });
        return { kind: 'run', ticket };
      }
      rec.queued++;
      tickets.set(ticket, { rec, state: 'waiting' });
      return { kind: 'wait', ticket };
    },

    promote(ticket) {
      const t = tickets.get(ticket);
      if (t === undefined || t.state !== 'waiting') return { kind: 'gone' };
      // a capability that has ended, or ends now by the clock or its session, spends the ticket: its queue place went with it
      if (byId.get(t.rec.id) !== t.rec || liveRecord(t.rec.id) === null) {
        tickets.delete(ticket);
        return { kind: 'dead' };
      }
      if (!admitQueued({ inflight: t.rec.inflight }, boxRunning)) return { kind: 'wait' };
      t.rec.queued--;
      t.rec.inflight++;
      boxRunning++;
      t.state = 'running';
      return { kind: 'run' };
    },

    release(ticket) {
      const t = tickets.get(ticket);
      if (t === undefined) return;
      tickets.delete(ticket);
      const lives = byId.get(t.rec.id) === t.rec;
      if (t.state === 'waiting') {
        if (lives) t.rec.queued--;
        return;
      }
      if (lives) t.rec.inflight--;
      boxRunning--;
    },

    boxInflight() {
      return boxRunning;
    },

    charge(id, bytes) {
      // A count that is not a whole, non-negative number is the caller's programming error, never a verdict about the capability:
      // it is refused before the capability is looked at, charges nothing, and its words name no id and no token.
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('charge: bytes must be a non-negative safe integer');
      const rec = liveRecord(id);
      if (rec === null) return 'dead';
      const now = clock();
      if (now - rec.hourStart >= ARTIFACT_BUDGET_WINDOW_MS) {
        rec.hourStart = now;
        rec.servedThisHour = 0;
      }
      if (rec.servedThisHour + bytes > ARTIFACT_HOURLY_BYTES) return 'over-budget';
      rec.servedThisHour += bytes;
      return 'ok';
    },

    recordSnapshot(id, rel, snapshot) {
      const rec = liveRecord(id);
      const snaps = snapData.get(id);
      if (rec === null || snaps === undefined || !rec.manifest.has(rel)) return;
      if (snapshot === null) snaps.delete(rel);
      else snaps.set(rel, snapshot);
    },
  };
}
