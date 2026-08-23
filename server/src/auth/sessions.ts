import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { AuthVerdict } from '../../../shared/api.js';

/**
 * The flat-file session store — the bearer tokens behind a logged-in phone/laptop,
 * one JSON array on disk at `~/.ccrc/sessions.json`.
 *
 * It is deliberately NOT in `coord.db`, and this whole module reads the way it does
 * because of that one decision: sessions are the "loss is free" class. A dropped
 * session just means "log in again", so the store DEGRADES on every failure it can
 * — a corrupt file refuses one caller and boots empty (see {@link load}) — where
 * `coord.db` refuses to start and `secret.ts` refuses to boot. That contrast is the
 * point, not an oversight: an unreadable SECRET must never read as "no passphrase"
 * (fail OPEN), but an unreadable SESSION file reading as "nobody is logged in" is
 * exactly right.
 *
 * THE SECURITY CORE:
 *  - The store holds `sha256(token)`, NEVER the token. The token is 256 bits of
 *    `randomBytes`, so there is no dictionary to slow and no salt to add — a plain
 *    `sha256` is the correct and complete choice. The raw token is returned ONCE
 *    from {@link create} and is never written to disk or logged.
 *  - {@link verifyMeasured} hashes the presented token and `timingSafeEqual`s it
 *    against the stored hashes (length-check-FIRST, the `coord/token.ts:220-228` discipline —
 *    equal-length sha256 always, but the guard stays live against a malformed
 *    stored hash rather than letting `timingSafeEqual` throw a RangeError).
 *
 * CONCURRENCY: login and logout race — two `create`s, or a `create` and a
 * `revokeThis`, can be in flight against the SAME `${path}.${pid}.tmp` at once.
 * That is the exact hazard `notifylog.ts` documents (:26-31, :78-90): two
 * interleaved writers on one tmp path can drop a rename or land stale bytes. The
 * fix, copied whole, is {@link flush}'s promise-chain serialization — only one
 * write is ever in flight, and later calls always land after earlier ones, so the
 * persisted file always matches the LAST call in program order.
 */

/**
 * How long a session is good for from CREATION, no matter how active — ~30 days. A
 * phone PWA is left open for days at a time, so the absolute cap is generous; it is
 * the backstop that guarantees no bearer token lives forever even under continuous
 * use (which the idle cap alone would allow, since every request refreshes it).
 */
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a session survives WITHOUT use before it is dropped — a few days. Short
 * enough that an abandoned tab does not stay a live credential for a month, long
 * enough that a phone checked every day or two never gets logged out mid-use.
 * Refreshed in memory on every `'ok'` {@link verify} (see the note there on why the
 * refresh is lazy, not a disk write per request).
 */
export const IDLE_TTL_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * How often the background sweep drops dead records and rewrites the file — MINUTES,
 * not seconds. Unlike `watch.ts`'s 10s mail cadence (`MAIL_SWEEP_MS`), nothing is
 * waiting on a session being reaped promptly: an expired session already reads
 * `'expired'`/`'no-session'` from {@link verify} the instant it lapses, TTLs
 * measured live. The sweep only reclaims the DISK entry, which can wait five
 * minutes.
 */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** 256-bit token — `randomBytes(32)`. Enough entropy that brute force is not a
 *  threat model, which is why {@link create}'s stored hash needs no salt or KDF. */
const TOKEN_BYTES = 32;

/** Owner read/write only. The file holds hashes, not tokens, but it is still a list
 *  of live-credential fingerprints and has no business being group- or
 *  world-readable. `push.ts`/`notifylog.ts` do not set a mode; this store does,
 *  deliberately. */
const FILE_MODE = 0o600;

/** sha256 hash length in hex characters — a valid stored `idHash` is exactly this
 *  long, which {@link parseRecords} pins so a garbled row is dropped rather than fed
 *  to `timingSafeEqual`. */
const SHA256_HEX_LEN = 64;

/** One persisted session. `idHash` is `sha256(token)` in hex — NEVER the token. */
export interface SessionRecord {
  /** `sha256(token)` as hex. The token itself is never stored. */
  idHash: string;
  /** Epoch ms the session was minted — drives the absolute TTL. */
  createdAt: number;
  /** Epoch ms of the last `'ok'` verify — drives the idle TTL. Held in MEMORY and
   *  persisted lazily (on create/revoke and the periodic flush), so a restart loses
   *  idle-clock precision and the session falls back to whatever `lastSeenAt` was
   *  last written — in the worst case `createdAt`, i.e. the absolute TTL. That is
   *  accepted on purpose: the alternative is a disk write on every request, an I/O
   *  amplifier on the hottest path in the server. */
  lastSeenAt: number;
  /** The auth secret generation this session was minted under. A session whose
   *  generation is not the CURRENT one (bumped by every `ccrc passwd`) is
   *  `'expired'` — this is how a password change invalidates every live session at
   *  once, with no restart and no file rewrite. */
  generation: number;
  /** A human-facing note (the device that logged in). Not used in any decision. */
  label: string;
}

function sha256hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * The path under `home`, and the ONE place `sessions.json` is spelled.
 *
 * `home` IS REQUIRED, AND THAT IS THE SAFETY RULE MADE STRUCTURAL (D-123, Task 5
 * + its review fold-in). This function was `defaultSessionsPath()` with no
 * parameter, reaching `os.homedir()` — and `config.ts` must derive the path from
 * `cfg.home`, which is `CCRC_HOME` when set, which every server test sets to a
 * throwaway fixture. Wired the original way the suite would have minted and
 * swept sessions in the operator's LIVE `~/.ccrc/sessions.json`. A DEFAULT
 * parameter would have left that one keystroke away; a required one makes the
 * dangerous call a compile error, which is the difference between a rule and a
 * mechanism ("the ccd suite's single isolation boundary is HOME", `CLAUDE.md`).
 *
 * It exists at all — rather than `config.ts` writing `path.join(home, '.ccrc',
 * 'sessions.json')` inline — for `defaultCoordDbPath(home)`'s reason: "the same
 * string built twice, once tested and once not, is how a rename in one place
 * silently opens a different, brand-new, empty file in the other"
 * (`config.ts:169`).
 */
export function defaultSessionsPath(home: string): string {
  return path.join(home, '.ccrc', 'sessions.json');
}

export class SessionStore {
  private records: SessionRecord[] = [];
  /** The in-flight or completed load, cached so concurrent mutators share ONE read.
   *  Without this, a second `create` fired before the first's `load` resolves would
   *  push its record and then have the first load's `this.records = …` clobber it —
   *  the same class of race the flush chain closes for writes, here on the read. */
  private loadPromise: Promise<void> | undefined;
  /** True when in-memory state is ahead of disk (a lazy `lastSeenAt` bump, or a
   *  sweep drop). The periodic {@link sweepAndFlush} writes only when it is set. */
  private dirty = false;
  /** Serializes every `flush()` — the `notifylog.ts` shape, verbatim. Two writers
   *  interleaved on one tmp path is the real hazard (a dropped rename, stale bytes
   *  under an in-flight rename); chaining guarantees one write in flight and
   *  last-writer-wins in program order. */
  private flushChain: Promise<void> = Promise.resolve();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  /** `storePath` is REQUIRED — no default, for {@link defaultSessionsPath}'s
   *  reason: a zero-argument `new SessionStore()` would have written the live
   *  `~/.ccrc/sessions.json` from any test that forgot to pass one, and a
   *  compile error is the only version of that rule that cannot be forgotten. */
  constructor(private readonly storePath: string) {}

  /**
   * Read the file into memory and sweep out anything already dead. NEVER throws:
   * every failure — an ABSENT file (the ordinary first run, silent), an unreadable
   * one (EACCES, EIO), garbled JSON, or well-formed JSON of the wrong shape —
   * degrades to an empty store, warning for everything but the absent case. This is
   * the OPPOSITE of `secret.ts`, which throws on a present-but-unreadable secret to
   * fail SHUT: there, collapsing "unreadable" into "absent" would read a chmod as
   * "no passphrase" and open the gate; here, "I could not read the sessions" and
   * "there are no sessions" are the SAME safe answer — present credentials again.
   *
   * The sweep here prunes MEMORY only; the file is rewritten by the next
   * {@link flush} (a create/revoke, or the periodic {@link sweepAndFlush}). A boot
   * that reads a file full of dead rows and never writes just re-prunes them next
   * time — harmless.
   */
  async load(): Promise<void> {
    // A direct load() is a RELOAD: re-read from disk, replacing whatever is in
    // memory. Concurrent mutators go through ensureLoaded and share this same
    // promise rather than each starting their own read.
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.storePath, 'utf8');
    } catch (err) {
      // ENOENT is the ordinary first run — empty and SILENT. Any other read error
      // (EACCES after a bad chmod, EIO) still degrades to empty, but warns, because
      // it is a box misconfiguration worth a line in the log. Neither throws: a
      // session file we cannot read means "nobody is logged in", which is safe.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`ccrc-server: ${this.storePath} could not be read ` +
          `(${(err as NodeJS.ErrnoException).code}); starting with no sessions (loss is free — log in again)`);
      }
      this.records = [];
      return;
    }
    try {
      this.records = parseRecords(JSON.parse(raw) as unknown);
    } catch {
      // Garbled JSON, or JSON that is not our array shape. Refuse this one read —
      // NEVER rethrow (that is `secret.ts`'s job, for a file whose loss is NOT free).
      console.warn(`ccrc-server: ${this.storePath} is corrupt; starting with no sessions ` +
        '(a lost session just means log in again — this file is not fail-shut)');
      this.records = [];
      return;
    }
    this.sweep(Date.now());
  }

  /**
   * Mint a session for `label` under `generation`, stamped `now`. Returns the raw
   * token ONCE — it is never persisted (only its `sha256`) and never returned again.
   */
  async create(label: string, generation: number, now: number): Promise<{ token: string }> {
    await this.ensureLoaded();
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    this.records.push({ idHash: sha256hex(token), createdAt: now, lastSeenAt: now, generation, label });
    this.dirty = true;
    await this.flush();
    return { token };
  }

  /**
   * {@link verify}'s answer PLUS the matched row's device label — one loop, one
   * read, exactly as before. `readFileMeasured`/`readFile` in `server/src/io.ts`
   * is the same shape and the same argument: the RICHER answer is the primitive
   * and the narrow one derives from it, so there is never a SECOND lookup and
   * never two readers of the same rows that could disagree.
   *
   * `label` is `null` for every non-`'ok'` verdict, and that is not a stand-in
   * for the empty string: no row was matched, so nothing was measured. Still
   * SYNCHRONOUS and still no I/O — the property that lets the hottest path in
   * the server stay pure (`gate.ts`'s `GateDeps`).
   *
   * NOT A DECISION INPUT, here or anywhere downstream. The label is
   * attacker-controlled text (`server.ts`'s `deviceLabel` truncates a
   * user-agent) and it exists to be RECORDED, never to be compared.
   */
  verifyMeasured(
    token: string, currentGeneration: number, now: number,
  ): { verdict: AuthVerdict; label: string | null } {
    const presented = Buffer.from(sha256hex(token), 'hex');
    for (const rec of this.records) {
      const stored = Buffer.from(rec.idHash, 'hex');
      // length-check FIRST (coord/token.ts:220-228): equal-length sha256 always,
      // but a garbled stored hash of the wrong length would make
      // `timingSafeEqual` throw a RangeError rather than answering "no". Skip
      // such a row, do not crash.
      if (stored.length !== presented.length) continue;
      if (!timingSafeEqual(stored, presented)) continue;
      if (rec.generation !== currentGeneration) return { verdict: 'expired', label: null };
      if (isExpired(rec, now)) return { verdict: 'expired', label: null };
      rec.lastSeenAt = now;
      this.dirty = true;
      return { verdict: 'ok', label: rec.label };
    }
    return { verdict: 'no-session', label: null };
  }

  /**
   * The gate's per-request question: is `token` a live session at `currentGeneration`
   * as of `now`?
   *
   *  - no matching hash          → `'no-session'` (the ordinary first visit)
   *  - matched, wrong generation → `'expired'`  (a `ccrc passwd` has since bumped it)
   *  - matched, past absolute or idle TTL → `'expired'`
   *  - otherwise                 → `'ok'`, and `lastSeenAt` is refreshed IN MEMORY
   *
   * SYNCHRONOUS on purpose: it touches only in-memory state and the `lastSeenAt`
   * refresh is lazy (persisted by the next flush, not here), so the hottest path in
   * the server does no I/O. Requires a prior {@link load} (the gate does one at
   * boot) — an unloaded store simply has no records and answers `'no-session'`,
   * which is safe.
   *
   * Expired/stale-generation rows are LEFT in place for the sweep to reclaim; they
   * are inert (they never verify `'ok'`), so there is nothing to race on removing
   * them synchronously here.
   *
   * Derives from {@link verifyMeasured} since wave 6 — same loop, same effects,
   * the verdict half.
   */
  verify(token: string, currentGeneration: number, now: number): AuthVerdict {
    return this.verifyMeasured(token, currentGeneration, now).verdict;
  }

  /** Log out ONE session — the ordinary logout. A no-op (and no write) if the token
   *  matches nothing. */
  async revokeThis(token: string): Promise<void> {
    await this.ensureLoaded();
    const idHash = sha256hex(token);
    const before = this.records.length;
    this.records = this.records.filter((r) => r.idHash !== idHash);
    if (this.records.length !== before) {
      this.dirty = true;
      await this.flush();
    }
  }

  /**
   * Log out EVERYWHERE — drop every session. Note this is the EXPLICIT "log out
   * everywhere" control, not how `ccrc passwd` invalidates sessions: passwd bumps
   * the secret generation, which makes every old-generation session read `'expired'`
   * from {@link verify} at once, with no file rewrite. This method is for a user who
   * wants to actively cut all sessions.
   */
  async revokeAll(): Promise<void> {
    await this.ensureLoaded();
    if (this.records.length === 0) return;
    this.records = [];
    this.dirty = true;
    await this.flush();
  }

  /** Drop every record past its absolute or idle TTL (MEMORY only). Returns whether
   *  anything was dropped, and marks the store dirty if so. Generation is NOT
   *  considered — a stale-generation row is inert but harmless, and is reclaimed
   *  when its TTL lapses; the sweep has no `currentGeneration` to check against. */
  private sweep(now: number): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => !isExpired(r, now));
    const dropped = this.records.length !== before;
    if (dropped) this.dirty = true;
    return dropped;
  }

  /** The unit the periodic timer runs: sweep, then persist IF anything is pending
   *  (a sweep drop, or a lazy `lastSeenAt` bump since the last write). Public so a
   *  test can drive one cadence deterministically instead of waiting on the timer. */
  async sweepAndFlush(now: number): Promise<void> {
    this.sweep(now);
    if (this.dirty) await this.flush();
  }

  /** Start the background sweep. Idempotent. Unref'd (like `watch.ts:475`,
   *  `sessionws.ts:229`) so a pending sweep never keeps the process alive on its
   *  own. Task 5 calls this at boot. */
  startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => { void this.sweepAndFlush(Date.now()); }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  /**
   * Persist, serialized behind {@link flushChain}. Never rejects: a failed write
   * costs at most one lost session, which is the "loss is free" answer already —
   * exactly `notifylog.ts`'s stance, and the reason the store is a flat file and not
   * `coord.db` in the first place.
   */
  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  private async doFlush(): Promise<void> {
    // Snapshot the array as it stands when THIS chained write runs — because writes
    // are serialized, a later create/revoke's snapshot is always a superset-or-edit
    // of an earlier one, so the last write in program order is the one that lands.
    const snapshot = JSON.stringify(this.records);
    try {
      await mkdir(path.dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: FILE_MODE });
      await rename(tmp, this.storePath);
      this.dirty = false;
    } catch { /* best effort, by design — a lost session just means log in again */ }
  }
}

/** True iff `rec` is past either TTL as of `now`. */
function isExpired(rec: SessionRecord, now: number): boolean {
  return now - rec.createdAt > ABSOLUTE_TTL_MS || now - rec.lastSeenAt > IDLE_TTL_MS;
}

/**
 * Turn parsed JSON into records, keeping the well-formed rows and dropping the rest.
 * Throws if the top level is not an array — that is a corrupt/foreign file, and
 * {@link SessionStore.load}'s catch turns the throw into an empty store plus a warn
 * (NOT a rethrow: this file's loss is free). A single malformed ROW inside a valid
 * array is dropped silently — one bad entry should not evict every good session.
 */
function parseRecords(raw: unknown): SessionRecord[] {
  if (!Array.isArray(raw)) throw new Error('sessions.json is not an array');
  const out: SessionRecord[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { idHash, createdAt, lastSeenAt, generation, label } = entry;
    if (typeof idHash !== 'string' || !/^[0-9a-f]+$/.test(idHash) || idHash.length !== SHA256_HEX_LEN) continue;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue;
    if (typeof lastSeenAt !== 'number' || !Number.isFinite(lastSeenAt)) continue;
    if (typeof generation !== 'number' || !Number.isInteger(generation)) continue;
    if (typeof label !== 'string') continue;
    out.push({ idHash, createdAt, lastSeenAt, generation, label });
  }
  return out;
}
