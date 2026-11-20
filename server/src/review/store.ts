// Draft review's L3 adapter: the review store, the ONE writer of the share directory (`cfg.reviewStoreDir`). Task R1.3
// of the draft-review plan; the design is `docs/superpowers/specs/2026-11-18-native-docs-draft-review-design.md` section 4.
//
// What it keeps: per share, `<tokenHash>.v<N>.html` (the bytes of version N) and `<tokenHash>.json` (the index entry,
// which holds the token so the owner can copy the link later); per removed share, `<id>.removed.json` (no token, no
// bytes). Every file is 0600 in a 0700 directory, and no file name holds the token.
//
// It DECIDES nothing itself: expiry, admission and the view clock are `policy.ts`'s deciders, called here with the
// store's own counts. What this file owns is order and durability: the commit point (bytes renamed, then the index
// renamed, then the directory `fsync`ed), the removal order (dead in memory, tombstone, index, bytes) and one in-process
// queue that every write goes through, so a late view, pin or sweep never writes back a revoked, replaced or expired
// entry. All file work goes through `ReviewFs`, so a test can record its order or fail any one call.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open as fsOpen, readdir, readFile, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { DocSectionSlug } from '../../../shared/docs.js';
import {
  isReviewSource, isReviewToken, REVIEW_REMOVALS, REVIEW_TOMBSTONE_MS, type ReviewRemoval, type ReviewSource,
} from '../../../shared/docsReview.js';
import { matchesShape } from '../accounts/shapes.js';
import { admitCreate, expiryOf, viewDue, type ReviewEntry, type ReviewTombstone } from './policy.js';

// ---- The file port -----------------------------------------------------------------------------------------------

export interface ReviewStat { size: number; mtimeMs: number }

/** The small set of file operations the store uses, so a test can record their order or fail one. A directory is
 *  `fsync`ed by opening it read-only and `fsync`ing that handle. Every call throws on failure; an adapter that wraps
 *  these keeps the error it receives (a missing file is an error with `code: 'ENOENT'`). */
export interface ReviewFs {
  /** Creates the directory (and any missing parent) with this mode; succeeds when it already exists. */
  mkdir(dir: string, mode: number): Promise<void>;
  open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  /** Writes ALL of `data` to the handle. */
  write(h: FileHandle, data: Uint8Array): Promise<void>;
  fsync(h: FileHandle): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<ReviewStat>;
}

/** The real one. */
export const nodeReviewFs: ReviewFs = {
  mkdir: async (dir, mode) => { await mkdir(dir, { recursive: true, mode }); },
  open: (path, flags, mode) => fsOpen(path, flags, mode),
  write: async (h, data) => { await h.writeFile(data); },
  fsync: (h) => h.sync(),
  rename: (from, to) => rename(from, to),
  unlink: (path) => unlink(path),
  readdir: (dir) => readdir(dir),
  readFile: (path) => readFile(path),
  stat: async (path) => { const s = await stat(path); return { size: s.size, mtimeMs: s.mtimeMs }; },
};

// ---- Answers -----------------------------------------------------------------------------------------------------

/** `put`: a new share, or a re-share under the same link. `replacedExpired` is true when this create replaced an
 *  expired share of the same source (found inside the queue, or left as a tombstone by an earlier sweep). */
export type ReviewPutAnswer =
  | { ok: true; entry: ReviewEntry; replacedExpired: boolean }
  | { ok: false; why: 'too-large' | 'store-full' | 'not-durable' };

/** `markViewed`: `durable: false` means the view lives in memory only (the index write failed); the copy is still served. */
export type ReviewViewAnswer =
  | { ok: true; entry: ReviewEntry; durable: boolean }
  | { ok: false; why: 'stale' | 'expired' };

export type ReviewPinAnswer =
  | { ok: true; entry: ReviewEntry }
  | { ok: false; why: 'stale' | 'expired' | 'not-durable' };

/** `remove`: `ok` once any one of the removal's disk acts has landed (the entry is dead either way); `not-durable`
 *  when none has, with the entry still revoke-pending in memory; `stale` when the entry is gone or at another revision. */
export type ReviewRemoveAnswer =
  | { ok: true; entry: ReviewEntry; why: ReviewRemoval }
  | { ok: false; why: 'stale' }
  | { ok: false; why: 'not-durable'; entry: ReviewEntry };

export interface ReviewStore {
  // reads (in memory, synchronous): a share whose removal is pending is invisible to `byToken` and `bySource`.
  /** The live entry for a token (SHA-256, then the map), or null. Applies no expiry: the read door does that. */
  byToken(token: string): ReviewEntry | null;
  /** A live entry, or one whose removal has landed no disk act yet (`revoking: true`), by id. */
  byId(id: string): ReviewEntry | null;
  bySource(project: string, section: DocSectionSlug, path: string, branch: string): ReviewEntry | null;
  /** Live entries, and revoke-pending ones with no landed act (`revoking: true`). */
  all(): ReviewEntry[];
  /** Removed shares this process knows, newest first. One whose tombstone did not land lives here only. */
  tombstones(): ReviewTombstone[];
  /** Bytes reserved by snapshot files, including any whose removal is not yet durable. */
  bytesUsed(): number;
  /** Whether any removal, or any superseded copy whose unlink failed, still has an act to run. */
  hasPending(): boolean;
  /** The bytes of one version, whatever the entry's state. For tests and the sweep; the read door streams. */
  readBytes(tokenHash: string, version: number): Promise<Uint8Array | null>;
  /** A read stream over a descriptor opened while the entry is live, so a later unlink lets an in-flight send finish
   *  with the old bytes. Null when the entry is not live at that version or the file cannot be opened. */
  openBytes(tokenHash: string, version: number): Promise<{ stream: Readable; size: number } | null>;

  // writes, each through one in-process queue; each re-reads the live entry inside it and applies the expiry decision first.
  put(source: ReviewSource, bytes: Uint8Array, credentialShapes: number, now: number): Promise<ReviewPutAnswer>;
  markViewed(tokenHash: string, expectRev: number, now: number): Promise<ReviewViewAnswer>;
  setPinned(tokenHash: string, expectRev: number, pinned: boolean, now: number): Promise<ReviewPinAnswer>;
  remove(tokenHash: string, expectRev: number | 'any', why: ReviewRemoval, now: number): Promise<ReviewRemoveAnswer>;
  /** The sweep's call: re-runs each pending removal's remaining acts, and each superseded copy's unlink. */
  retryPending(now: number): Promise<{ remaining: number }>;
  /** Deletes tombstones `REVIEW_TOMBSTONE_MS` old, never while the share's index entry or bytes file still exists. */
  purgeTombstones(now: number): Promise<{ purged: number }>;
}

// ---- Names and shapes --------------------------------------------------------------------------------------------

const HASH_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[0-9a-f]{32}$/;
const INDEX_RE = /^([0-9a-f]{64})\.json$/;
const BYTES_RE = /^([0-9a-f]{64})\.v([1-9][0-9]*)\.html$/;
const TOMB_RE = /^([0-9a-f]{32})\.removed\.json$/;
const TMP_SUFFIX = '.tmp';
/** A temporary file older than this at boot is a crash's leftover. */
const TMP_MAX_AGE_MS = 60000;
/** The token draws `put` makes before it gives up: a draw that matches a credential shape 64 times running is not luck. */
const DRAW_LIMIT = 64;

const sha256Hex = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');
const bytesName = (hash: string, version: number): string => `${hash}.v${version}.html`;
const indexName = (hash: string): string => `${hash}.json`;
const tombName = (id: string): string => `${id}.removed.json`;
const isEnoent = (e: unknown): boolean => (e as NodeJS.ErrnoException | null)?.code === 'ENOENT';
const defaultDraw = (): Uint8Array => randomBytes(32);

/** One log line per failed disk act, by file name. The names are hash- or id-based, never the token, and nothing of a
 *  snapshot's bytes is ever logged. */
const warnAct = (op: string, name: string): void => { console.warn(`ccrc-server: review store: ${op} failed for ${name}`); };

function copySource(s: ReviewSource): ReviewSource {
  return {
    project: s.project, section: s.section, path: s.path, branch: s.branch, head: s.head, servedRef: s.servedRef,
    baseCommit: s.baseCommit, fp: s.fp, committedBlob: s.committedBlob,
  };
}

const sameKey = (a: ReviewSource, b: ReviewSource): boolean =>
  a.project === b.project && a.section === b.section && a.path === b.path && a.branch === b.branch;

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const isCount = (x: unknown): x is number => isInt(x) && x >= 0;

/** An index file's content, checked in full; null for anything that is not a share this store wrote. The hash in the
 *  file name must be the token's own, so a copied or renamed file is never served under another name. */
function parseEntry(text: string, hashFromName: string): ReviewEntry | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id !== 'string' || !ID_RE.test(o.id) || !isReviewSource(o.source) ||
    !isInt(o.version) || o.version < 1 || !isInt(o.sharedAt) || !isInt(o.firstSharedAt) || !isInt(o.idleSince) ||
    !(o.lastViewedAt === null || isInt(o.lastViewedAt)) || typeof o.pinned !== 'boolean' ||
    typeof o.sha256 !== 'string' || !isCount(o.size) || !isCount(o.credentialShapes) ||
    typeof o.token !== 'string' || !isReviewToken(o.token) || sha256Hex(o.token) !== hashFromName ||
    !isInt(o.rev) || o.rev < 1
  ) return null;
  return {
    id: o.id, source: copySource(o.source), version: o.version, sharedAt: o.sharedAt, firstSharedAt: o.firstSharedAt,
    idleSince: o.idleSince, lastViewedAt: o.lastViewedAt, pinned: o.pinned, sha256: o.sha256, size: o.size,
    credentialShapes: o.credentialShapes, revoking: false, tokenHash: hashFromName, token: o.token, rev: o.rev,
  };
}

function parseTombstone(text: string, idFromName: string): ReviewTombstone | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const r = o.removed as Record<string, unknown> | null | undefined;
  if (
    o.id !== idFromName || !isReviewSource(o.source) ||
    !isInt(o.version) || !isInt(o.sharedAt) || !isInt(o.firstSharedAt) || !isInt(o.idleSince) ||
    !(o.lastViewedAt === null || isInt(o.lastViewedAt)) || typeof o.pinned !== 'boolean' ||
    typeof o.sha256 !== 'string' || !isCount(o.size) || !isCount(o.credentialShapes) ||
    typeof r !== 'object' || r === null || typeof r.why !== 'string' ||
    !(REVIEW_REMOVALS as readonly string[]).includes(r.why) || !isInt(r.at)
  ) return null;
  return {
    id: idFromName, source: copySource(o.source), version: o.version, sharedAt: o.sharedAt,
    firstSharedAt: o.firstSharedAt, idleSince: o.idleSince, lastViewedAt: o.lastViewedAt, pinned: o.pinned,
    sha256: o.sha256, size: o.size, credentialShapes: o.credentialShapes,
    removed: { why: r.why as ReviewRemoval, at: r.at },
  };
}

// ---- The store ---------------------------------------------------------------------------------------------------

/** One removal whose disk acts are not all done. The tombstone act is `dropped` once another act has landed without
 *  it: the reason is then final (`lost`, or `revoked` kept), so a later retry never writes a reason the owner was
 *  already told was lost. */
interface Pending {
  entry: ReviewEntry;
  why: ReviewRemoval;
  at: number;
  tomb: 'todo' | 'done' | 'dropped';
  index: 'todo' | 'done';
  bytes: 'todo' | 'done';
  /** The owner row is settled: either listed in `tombs` or deliberately omitted for an unissued share. */
  listed: boolean;
}

class FsReviewStore implements ReviewStore {
  /** Live and pending entries by token hash; a pending one is a copy with `revoking: true`. */
  private readonly entries = new Map<string, ReviewEntry>();
  private readonly pending = new Map<string, Pending>();
  private readonly tombs = new Map<string, ReviewTombstone>();
  /** Snapshot lengths by disk name, independent of whether an index names them. The queue owns changes after boot. */
  private readonly snapshotSizes = new Map<string, number>();
  /** Unreferenced snapshot files whose unlink has not landed, retried by `retryPending`. */
  private readonly strays = new Set<string>();
  /** Bytes possibly named by an index whose directory sync failed; only removal may unlink them. */
  private readonly uncertain = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string, private readonly io: ReviewFs, private readonly draw: () => Uint8Array) {}

  private p(name: string): string { return `${this.dir}/${name}`; }

  // ---- queue -----------------------------------------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  // ---- reads -----------------------------------------------------------------------------------------------------

  byToken(token: string): ReviewEntry | null {
    const e = this.entries.get(sha256Hex(token));
    return e !== undefined && !e.revoking ? e : null;
  }

  byId(id: string): ReviewEntry | null {
    return this.all().find((e) => e.id === id) ?? null;
  }

  bySource(project: string, section: DocSectionSlug, path: string, branch: string): ReviewEntry | null {
    for (const e of this.entries.values()) {
      if (!e.revoking && e.source.project === project && e.source.section === section && e.source.path === path &&
          e.source.branch === branch) return e;
    }
    return null;
  }

  all(): ReviewEntry[] {
    // A removal with a landed act is a tombstone row, not a live one; only one with no landed act is the owner's
    // "revoking" row.
    return [...this.entries.values()].filter((e) => {
      const p = this.pending.get(e.tokenHash);
      return p === undefined || p.tomb === 'todo';
    });
  }

  tombstones(): ReviewTombstone[] {
    return [...this.tombs.values()].sort((a, b) => b.removed.at - a.removed.at);
  }

  bytesUsed(): number {
    let n = 0;
    for (const size of this.snapshotSizes.values()) n += size;
    return n;
  }

  hasPending(): boolean { return this.pending.size > 0 || this.strays.size > 0; }

  async readBytes(tokenHash: string, version: number): Promise<Uint8Array | null> {
    if (!HASH_RE.test(tokenHash)) return null;
    try { return await this.io.readFile(this.p(bytesName(tokenHash, version))); } catch { return null; }
  }

  async openBytes(tokenHash: string, version: number): Promise<{ stream: Readable; size: number } | null> {
    const e = this.entries.get(tokenHash);
    if (e === undefined || e.revoking || e.version !== version) return null;
    let h: FileHandle;
    try { h = await this.io.open(this.p(bytesName(tokenHash, version)), 'r'); } catch { return null; }
    // The entry may have died while the open was in flight; the descriptor is ours either way, so a send that began
    // while it was live finishes, but one that was not live when the open returned does not start.
    const now = this.entries.get(tokenHash);
    if (now === undefined || now.revoking || now.version !== version) {
      await h.close().catch(() => undefined);
      return null;
    }
    return { stream: h.createReadStream(), size: e.size };
  }

  // ---- file acts -------------------------------------------------------------------------------------------------

  /** A file by temporary name, `fsync`ed, then renamed over its final name. Throws on any failure; its temporary file
   *  is removed best-effort. The directory is NOT synced here: the caller does it at the commit point it names. */
  private async atomicWrite(name: string, data: Uint8Array): Promise<void> {
    const tmp = `${name}.${randomBytes(6).toString('hex')}${TMP_SUFFIX}`;
    const snapshot = BYTES_RE.test(name);
    let created = false;
    let h: FileHandle | null = null;
    try {
      h = await this.io.open(this.p(tmp), 'wx', 0o600);
      created = true;
      // Even a partial write can leave payload on disk. Reserve its upper bound until it is gone.
      if (snapshot) this.snapshotSizes.set(tmp, data.byteLength);
      await this.io.write(h, data);
      await this.io.fsync(h);
      await h.close();
      h = null;
      await this.io.rename(this.p(tmp), this.p(name));
      if (snapshot) {
        this.snapshotSizes.delete(tmp);
        this.snapshotSizes.set(name, data.byteLength);
      }
    } catch (e) {
      if (h !== null) await h.close().catch(() => undefined);
      if (created) {
        if (snapshot) {
          if (!(await this.unlinkDurable(tmp))) this.strays.add(tmp);
        } else {
          await this.io.unlink(this.p(tmp)).catch(() => undefined);
        }
      }
      throw e;
    }
  }

  private async syncDir(): Promise<void> {
    const h = await this.io.open(this.dir, 'r');
    try { await this.io.fsync(h); } finally { await h.close().catch(() => undefined); }
  }

  /** Unlinks a file (already gone counts) and syncs the directory; true only when both held, so a retry is safe. */
  private async unlinkDurable(name: string): Promise<boolean> {
    try {
      try { await this.io.unlink(this.p(name)); } catch (e) { if (!isEnoent(e)) throw e; }
      await this.syncDir();
      this.snapshotSizes.delete(name);
      return true;
    } catch {
      warnAct('unlink', name);
      return false;
    }
  }

  /** Whether a bytes file name is the CURRENT copy of a live entry. A stray never is: nothing may unlink it. */
  private isLiveBytes(name: string): boolean {
    const m = BYTES_RE.exec(name);
    if (m === null) return false;
    const e = this.entries.get(m[1]!);
    return e !== undefined && !e.revoking && e.version === Number(m[2]);
  }

  private async writeEntry(e: ReviewEntry): Promise<void> {
    await this.atomicWrite(indexName(e.tokenHash), Buffer.from(JSON.stringify(e)));
    await this.syncDir();
  }

  // ---- removal ---------------------------------------------------------------------------------------------------

  private tombstoneOf(p: Pending): ReviewTombstone {
    const e = p.entry;
    return {
      id: e.id, source: e.source, version: e.version, sharedAt: e.sharedAt, firstSharedAt: e.firstSharedAt,
      idleSince: e.idleSince, lastViewedAt: e.lastViewedAt, pinned: e.pinned, sha256: e.sha256, size: e.size,
      credentialShapes: e.credentialShapes, removed: { why: p.why, at: p.at },
    };
  }

  /** Marks an entry unavailable in memory (before any disk act) and runs its remaining acts once. */
  private async holdRemoval(p: Pending): Promise<Pending> {
    const e = p.entry;
    this.entries.set(e.tokenHash, { ...e, revoking: true });
    this.pending.set(e.tokenHash, p);
    await this.runRemoval(p);
    return p;
  }

  private startRemoval(e: ReviewEntry, why: ReviewRemoval, now: number): Promise<Pending> {
    return this.holdRemoval({ entry: e, why, at: now, tomb: 'todo', index: 'todo', bytes: 'todo', listed: false });
  }

  /** The removal's remaining acts, in order, each whether or not an earlier one failed: tombstone, index, bytes. An
   *  act has landed when its call and the directory `fsync` after it both succeeded. */
  private async runRemoval(p: Pending): Promise<void> {
    const e = p.entry;
    if (p.tomb === 'todo') {
      try {
        await this.atomicWrite(tombName(e.id), Buffer.from(JSON.stringify(this.tombstoneOf(p))));
        await this.syncDir();
        p.tomb = 'done';
      } catch { warnAct('write', tombName(e.id)); /* stays todo; settled below */ }
    }
    if (p.index === 'todo' && (await this.unlinkDurable(indexName(e.tokenHash)))) p.index = 'done';
    if (p.bytes === 'todo') {
      const names = new Set([bytesName(e.tokenHash, e.version), ...[...this.strays, ...this.uncertain].filter((n) => n.startsWith(`${e.tokenHash}.`))]);
      let all = true;
      for (const n of names) {
        if (await this.unlinkDurable(n)) { this.strays.delete(n); this.uncertain.delete(n); } else all = false;
      }
      if (all) p.bytes = 'done';
    }
    if (p.tomb === 'todo' && (p.index === 'done' || p.bytes === 'done')) {
      // Something landed without the tombstone: its reason can no longer be kept. A revoke keeps its own, so a revoked
      // share never reads as unreadable.
      p.tomb = 'dropped';
      if (p.why !== 'revoked') p.why = 'lost';
    }
    if (p.tomb !== 'todo' && !p.listed) {
      p.listed = true;
      this.tombs.set(e.id, this.tombstoneOf(p));
    }
    if (p.tomb !== 'todo' && p.index === 'done' && p.bytes === 'done') {
      this.entries.delete(e.tokenHash);
      this.pending.delete(e.tokenHash);
    }
  }

  // ---- writes ----------------------------------------------------------------------------------------------------

  private mint(): { token: string; hash: string } {
    for (let i = 0; i < DRAW_LIMIT; i++) {
      const raw = this.draw();
      if (raw.byteLength !== 32) throw new Error('ccrc-server: the review token draw must give 32 bytes');
      const token = Buffer.from(raw).toString('base64url');
      // The link's own prefix matches no credential shape, so the token alone is what the answer mask could mangle.
      // `matchesShape` is the egress mask's own matcher (`accounts/shapes.ts`, the one reader of the shapes).
      if (matchesShape(token)) continue;
      const hash = sha256Hex(token);
      if (this.entries.has(hash)) continue;
      return { token, hash };
    }
    throw new Error('ccrc-server: the review token draw kept matching a credential shape');
  }

  private liveCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (!e.revoking) n++;
    return n;
  }

  put(source: ReviewSource, bytes: Uint8Array, credentialShapes: number, now: number): Promise<ReviewPutAnswer> {
    return this.enqueue(() => this.putNow(copySource(source), bytes, credentialShapes, now));
  }

  private pendingFor(source: ReviewSource): Pending[] {
    return [...this.pending.values()].filter((p) => sameKey(p.entry.source, source));
  }

  /** Whether a removal pending for this source still has its tombstone or its index entry to deal with. Only then can a
   *  new share make a second index entry for the source (or have its removal's reason overwritten); a removal with
   *  only its bytes file left cannot, so a stuck bytes file never blocks a re-share (it keeps its own pending act). */
  private blockedBy(source: ReviewSource): boolean {
    return this.pendingFor(source).some((p) => p.tomb === 'todo' || p.index === 'todo');
  }

  private async putNow(source: ReviewSource, bytes: Uint8Array, credentialShapes: number, now: number): Promise<ReviewPutAnswer> {
    // A removal still pending for this source is finished first, so one source never has two index entries and a
    // pending entry's token is never reused.
    for (const p of this.pendingFor(source)) await this.runRemoval(p);
    if (this.blockedBy(source)) return { ok: false, why: 'not-durable' };
    let existing = this.bySource(source.project, source.section, source.path, source.branch);
    let replacedExpired = false;
    if (existing !== null) {
      const ex = expiryOf(existing, now);
      if (!ex.live) {
        await this.startRemoval(existing, ex.why, now);
        replacedExpired = true;
        existing = null;
        if (this.blockedBy(source)) return { ok: false, why: 'not-durable' };
      }
    }
    if (existing === null && !replacedExpired) {
      // An expired or retention-expired link for this file, still kept after an earlier removal.
      replacedExpired = [...this.tombs.values()].some((t) => sameKey(t.source, source) &&
        (t.removed.why === 'expired' || t.removed.why === 'retention'));
    }

    const verdict = admitCreate({
      size: bytes.byteLength, live: this.liveCount(), storeBytes: this.bytesUsed(),
      replacing: existing === null ? null : { size: this.snapshotSizes.get(bytesName(existing.tokenHash, existing.version)) ?? 0 },
    });
    if (!verdict.ok) return verdict;

    const minted = existing === null ? this.mint() : null;
    const version = existing === null ? 1 : existing.version + 1;
    const entry: ReviewEntry = existing === null
      ? {
        id: randomBytes(16).toString('hex'), source, version, sharedAt: now, firstSharedAt: now, idleSince: now,
        lastViewedAt: null, pinned: false, sha256: sha256Hex(bytes), size: bytes.byteLength, credentialShapes,
        revoking: false, tokenHash: minted!.hash, token: minted!.token, rev: 1,
      }
      : {
        ...existing, source, version, sharedAt: now, idleSince: now, sha256: sha256Hex(bytes), size: bytes.byteLength,
        credentialShapes, rev: existing.rev + 1,
      };

    const newBytes = bytesName(entry.tokenHash, version);
    if (existing !== null && this.uncertain.has(newBytes)) {
      // The disk index may already name this file. Restore the current index durably before replacing those bytes.
      try { await this.writeEntry(existing); } catch {
        warnAct('write', indexName(entry.tokenHash));
        return { ok: false, why: 'not-durable' };
      }
      this.uncertain.delete(newBytes);
      this.strays.add(newBytes);
    }
    let stage: 'bytes' | 'index' | 'sync' = 'bytes';
    try {
      await this.atomicWrite(newBytes, bytes);
      stage = 'index';
      await this.atomicWrite(indexName(entry.tokenHash), Buffer.from(JSON.stringify(entry)));
      stage = 'sync';
      await this.syncDir();
    } catch {
      warnAct(stage === 'sync' ? 'fsync' : 'write', stage === 'bytes' ? newBytes : indexName(entry.tokenHash));
      if (stage !== 'sync') {
        // The index rename did not happen: the new bytes are unreferenced. A later retry removes them (a name that has
        // become a live entry's own copy is never removed, `isLiveBytes`), instead of leaving them until the next boot.
        this.strays.add(newBytes);
      } else if (existing === null) {
        // No link was issued. Take the index and bytes back without creating an owner row. If the index stays,
        // keep this source fenced inside the queue so a retry cannot create a second index for it.
        await this.holdRemoval({ entry, why: 'lost', at: now, tomb: 'dropped', index: 'todo', bytes: 'todo', listed: true });
      } else {
        // The index may now name this version, even if an earlier failed attempt called it a stray.
        this.strays.delete(newBytes);
        this.uncertain.add(newBytes);
      }
      return { ok: false, why: 'not-durable' };
    }
    this.entries.set(entry.tokenHash, entry);
    // The committed name is the live copy now: a stray recorded earlier under it (a boot's unreferenced bytes, a failed
    // attempt) must never be unlinked by a retry.
    this.strays.delete(newBytes);
    this.uncertain.delete(newBytes);
    if (existing !== null) {
      const old = bytesName(entry.tokenHash, existing.version);
      if (!(await this.unlinkDurable(old))) this.strays.add(old);
    }
    return { ok: true, entry, replacedExpired };
  }

  /** Re-reads the entry inside the queue and applies the expiry decision, then the revision. Anything but the live
   *  entry at the expected revision is an answer, never a write. A dead entry is removed here, with its reason. */
  private async checked(
    tokenHash: string, expectRev: number, now: number,
  ): Promise<{ ok: true; entry: ReviewEntry } | { ok: false; why: 'stale' | 'expired' }> {
    const e = this.entries.get(tokenHash);
    if (e === undefined || e.revoking) return { ok: false, why: 'stale' };
    const ex = expiryOf(e, now);
    if (!ex.live) {
      await this.startRemoval(e, ex.why, now);
      return { ok: false, why: 'expired' };
    }
    if (e.rev !== expectRev) return { ok: false, why: 'stale' };
    return { ok: true, entry: e };
  }

  markViewed(tokenHash: string, expectRev: number, now: number): Promise<ReviewViewAnswer> {
    return this.enqueue(async () => {
      const c = await this.checked(tokenHash, expectRev, now);
      if (!c.ok) return c;
      if (!viewDue(c.entry, now)) return { ok: true, entry: c.entry, durable: true };
      // A view moves the idle clock too.
      const next: ReviewEntry = { ...c.entry, lastViewedAt: now, idleSince: now, rev: c.entry.rev + 1 };
      let durable = true;
      try { await this.writeEntry(next); } catch { durable = false; warnAct('write', indexName(tokenHash)); }
      this.entries.set(tokenHash, next);
      return { ok: true, entry: next, durable };
    });
  }

  setPinned(tokenHash: string, expectRev: number, pinned: boolean, now: number): Promise<ReviewPinAnswer> {
    return this.enqueue(async () => {
      const c = await this.checked(tokenHash, expectRev, now);
      if (!c.ok) return c;
      if (c.entry.pinned === pinned) return { ok: true, entry: c.entry };
      // A pin leaves the idle clock where it is; an unpin restarts it. Neither touches `firstSharedAt`.
      const next: ReviewEntry = { ...c.entry, pinned, idleSince: pinned ? c.entry.idleSince : now, rev: c.entry.rev + 1 };
      try { await this.writeEntry(next); } catch { warnAct('write', indexName(tokenHash)); return { ok: false, why: 'not-durable' }; }
      this.entries.set(tokenHash, next);
      return { ok: true, entry: next };
    });
  }

  remove(tokenHash: string, expectRev: number | 'any', why: ReviewRemoval, now: number): Promise<ReviewRemoveAnswer> {
    return this.enqueue(async () => {
      const e = this.entries.get(tokenHash);
      if (e === undefined) return { ok: false, why: 'stale' };
      let p = this.pending.get(tokenHash);
      if (p === undefined) {
        // Expiry first: a share already dead of age is removed for that reason, whatever this call asked for.
        const ex = expiryOf(e, now);
        if (ex.live && expectRev !== 'any' && e.rev !== expectRev) return { ok: false, why: 'stale' };
        p = await this.startRemoval(e, ex.live ? why : ex.why, now);
      } else {
        // A removal already pending keeps its own reason; this call only runs what it has left.
        await this.runRemoval(p);
      }
      if (p.tomb === 'todo') return { ok: false, why: 'not-durable', entry: this.entries.get(tokenHash) ?? { ...p.entry, revoking: true } };
      return { ok: true, entry: { ...p.entry, revoking: false }, why: p.why };
    });
  }

  retryPending(_now: number): Promise<{ remaining: number }> {
    return this.enqueue(async () => {
      for (const p of [...this.pending.values()]) await this.runRemoval(p);
      for (const name of [...this.strays]) {
        // A name that is a live entry's current copy is no stray: drop it from the set, never unlink it.
        if (this.isLiveBytes(name) || (await this.unlinkDurable(name))) this.strays.delete(name);
      }
      return { remaining: this.pending.size + this.strays.size };
    });
  }

  purgeTombstones(now: number): Promise<{ purged: number }> {
    return this.enqueue(async () => {
      // After boot, bytes without an index cannot be tied to a tombstone: it contains no token hash. Keep the
      // tombstones until those orphan bytes are gone, rather than guessing which removal is safe to forget.
      if ([...this.strays].some((name) => !this.entries.has(BYTES_RE.exec(name)?.[1] ?? ''))) return { purged: 0 };
      let purged = 0;
      for (const t of [...this.tombs.values()]) {
        if (now - t.removed.at < REVIEW_TOMBSTONE_MS) continue;
        // Never while the share's index entry or bytes file may still exist: its removal is still pending.
        const held = [...this.entries.values()].some((e) => e.id === t.id);
        if (held) continue;
        if (await this.unlinkDurable(tombName(t.id))) { this.tombs.delete(t.id); purged++; }
      }
      return { purged };
    });
  }

  // ---- boot ------------------------------------------------------------------------------------------------------

  /** False when the directory cannot be proved writable or read. A boot that cannot tell what is on disk fails closed:
   *  every link answers 404 and create refuses `store-unreadable`. */
  async boot(now: number): Promise<boolean> {
    let names: string[];
    try {
      await this.io.mkdir(this.dir, 0o700);
      // Writable, proved: a probe file written, synced and unlinked. A directory that cannot be written must not serve
      // a share whose revoke could not reach the disk.
      const probe = `probe-${randomBytes(6).toString('hex')}${TMP_SUFFIX}`;
      const h = await this.io.open(this.p(probe), 'wx', 0o600);
      try {
        await this.io.write(h, Buffer.from('ok'));
        await this.io.fsync(h);
      } finally { await h.close().catch(() => undefined); }
      await this.io.unlink(this.p(probe));
      await this.syncDir();
      names = await this.io.readdir(this.dir);
    } catch { return false; }

    const indexes: Array<{ hash: string; text: string }> = [];
    const tombIds = new Set<string>();
    const bytesFiles: string[] = [];
    try {
      for (const name of names) {
        if (name.endsWith(TMP_SUFFIX)) {
          const { size, mtimeMs } = await this.io.stat(this.p(name));
          const snapshot = BYTES_RE.test(name.split('.').slice(0, -2).join('.'));
          if (snapshot) this.snapshotSizes.set(name, size);
          if (now - mtimeMs > TMP_MAX_AGE_MS) {
            if (snapshot) {
              if (!(await this.unlinkDurable(name))) this.strays.add(name);
            } else {
              await this.io.unlink(this.p(name)).catch(() => undefined);
            }
          }
          continue;
        }
        const ix = INDEX_RE.exec(name);
        if (ix !== null) {
          indexes.push({ hash: ix[1]!, text: new TextDecoder().decode(await this.io.readFile(this.p(name))) });
          continue;
        }
        const tb = TOMB_RE.exec(name);
        if (tb !== null) {
          // Any tombstone file marks its share removed, readable or not (below).
          tombIds.add(tb[1]!);
          const t = parseTombstone(new TextDecoder().decode(await this.io.readFile(this.p(name))), tb[1]!);
          if (t === null) console.warn(`ccrc-server: review store: an unreadable tombstone was left in place (${name})`);
          else this.tombs.set(t.id, t);
          continue;
        }
        if (BYTES_RE.test(name)) {
          this.snapshotSizes.set(name, (await this.io.stat(this.p(name))).size);
          bytesFiles.push(name);
        }
      }
    } catch { return false; }

    const referenced = new Set<string>();
    const found: ReviewEntry[] = [];
    for (const { hash, text } of indexes) {
      const e = parseEntry(text, hash);
      if (e === null) {
        console.warn('ccrc-server: review store: an index file that is not a share was removed');
        await this.unlinkDurable(indexName(hash));
        continue;
      }
      referenced.add(bytesName(hash, e.version));
      found.push(e);
    }
    // Bytes no index entry names: a re-share a crash cut before its index rename, or a removal cut before its bytes.
    for (const name of bytesFiles) {
      if (referenced.has(name)) continue;
      if (!(await this.unlinkDurable(name))) this.strays.add(name);
    }
    const have = new Set(bytesFiles);
    for (const e of found) {
      const t = this.tombs.get(e.id);
      if (tombIds.has(e.id)) {
        // A damaged tombstone still marks removal. Rebuild its metadata conservatively before finishing the unlinks.
        await this.holdRemoval({ entry: e, why: t?.removed.why ?? 'revoked', at: t?.removed.at ?? now, tomb: t === undefined ? 'todo' : 'done', index: 'todo', bytes: 'todo', listed: t !== undefined });
      } else if (!have.has(bytesName(e.tokenHash, e.version))) {
        await this.startRemoval(e, 'lost', now);
      } else {
        this.entries.set(e.tokenHash, e);
      }
    }
    return true;
  }
}

/** Opens the store in `dir`: creates it 0700 if absent, proves it writable, rebuilds the index in memory and finishes
 *  what a crash cut. `io` and `draw` are the test seams (the file operations; the 32 random bytes of a token). */
export async function openReviewStore(
  dir: string, io: ReviewFs = nodeReviewFs, draw: () => Uint8Array = defaultDraw,
): Promise<{ ok: true; store: ReviewStore } | { ok: false; why: 'store-unreadable' }> {
  const store = new FsReviewStore(dir, io, draw);
  return (await store.boot(Date.now())) ? { ok: true, store } : { ok: false, why: 'store-unreadable' };
}
