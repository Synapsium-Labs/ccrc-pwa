import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PasskeySummary } from '../../../shared/api.js';
import { MAX_CREDENTIAL_ID_BYTES, MAX_SPKI_BYTES, decodeB64url, type StoredCredential } from './webauthn.js';

/**
 * The enrolled passkeys — a JSON array on disk at `~/.ccrc/passkeys.json`,
 * `sessions.ts`'s shape and discipline, with three deliberate differences.
 *
 * SAME AS `sessions.ts`: a flat file rather than `coord.db`, 0600, an atomic
 * `write`+`rename`, a serialized flush chain (`notifylog.ts`'s promise chain —
 * two writers interleaved on one tmp path is a dropped rename or stale bytes),
 * a single cached `load` so concurrent mutators cannot clobber each other, and a
 * read failure that never throws.
 *
 * READING NOTHING DENIES, and that is the fail-shut direction here — the
 * opposite polarity to `secret.ts`. An unreadable PASSPHRASE file must never
 * read as "no passphrase"; that would be a box the gate lets everyone into. An
 * unreadable PASSKEY file yielding no usable credentials refuses every passkey
 * login and leaves the passphrase working.
 *
 * BUT "DENIES" IS NOT THE WHOLE STORY, AND COLLAPSING THE TWO CAUSES COST THE
 * OPERATOR THEIR CREDENTIALS (D-119). `doLoad` used to fold ENOENT, EACCES and a
 * corrupt file into one `records = []`, and every reader downstream then said
 * the same sentence — the enrol screen's "No passkey is enrolled on this box".
 * An operator who believes it does the obvious thing and enrols, and the first
 * successful enrolment REWRITES THE WHOLE FILE from an in-memory array that was
 * empty because the file could not be READ. The other credentials are gone, and
 * nothing anywhere said so. That is the "no overloaded null at a seam" rule
 * (`CLAUDE.md`) broken in the direction that destroys data rather than the one
 * that merely denies, and it is why {@link StoreState} is three states:
 *
 *  - `'absent'`   — the ordinary first run. Enrolling is correct and safe.
 *  - `'ok'`       — the file was read; `records` is what it holds.
 *  - `'unusable'` — the file EXISTS and could not be read or parsed. Assertions
 *                   deny (there are no usable credentials), and **enrolment is
 *                   REFUSED**, because the only way to enrol is to overwrite the
 *                   file we could not read.
 *
 * DIFFERENT FROM `sessions.ts`, and each difference has a reason:
 *
 *  1. NO SWEEP TIMER. A credential does not expire; it is removed when the
 *     operator revokes it (`DELETE /api/auth/passkey/:id`, wired in `server.ts`).
 *     There is nothing to reclaim on a schedule.
 *
 *  2. `signCount` MAKES A FAILED WRITE MATTER — this is the one place this store
 *     is NOT "loss is free". The counter is WebAuthn's only defence against a
 *     cloned authenticator, so a flush that silently fails leaves a stale
 *     counter on disk, and a restart would then accept an assertion the running
 *     process would have refused. `sessions.ts` swallows a write failure in
 *     silence because a lost session costs a login; here the failure is CAUGHT
 *     AND LOGGED, naming that consequence, so a broken disk is not also a silent
 *     weakening of a replay defence. The in-memory counter is advanced first and
 *     unconditionally, so within one process lifetime the defence holds
 *     regardless of what the disk does.
 *
 *  3. A CAP ON ROWS. Sessions are minted by logging in and swept by a TTL;
 *     credentials are only ever added, so the file needs a ceiling
 *     ({@link MAX_CREDENTIALS}) or an enrolment loop grows it without bound.
 *
 * IT HOLDS NO SECRETS — every field is a PUBLIC key, a public credential id, an
 * origin and a counter. There is nothing here an attacker who reads the file can
 * authenticate with, which is why 0600 is prudence rather than the security
 * boundary. (`sessions.json`, which holds live-credential fingerprints, is the
 * file where the mode is doing real work.)
 */

/** Owner read/write only. See the module docstring on what this is and is not
 *  protecting. */
const FILE_MODE = 0o600;

/**
 * How many passkeys one box may have enrolled. Generous — a phone, a laptop, a
 * hardware key and a spare is four — and finite, which is the point: every write
 * path here appends, so without a ceiling a loop against `register/finish`
 * (behind the session gate, so this is an authenticated operator's own foot,
 * not an attack) grows the file until the disk complains.
 */
export const MAX_CREDENTIALS = 20;

/** The path under `home`, and the ONE place `passkeys.json` is spelled.
 *
 *  `home` IS REQUIRED, for `defaultSessionsPath`'s reason (D-110): a
 *  zero-argument version reaching `os.homedir()` would have every test that
 *  forgot to pass one writing the operator's LIVE `~/.ccrc/passkeys.json`, and a
 *  compile error is the only version of that rule that cannot be forgotten. */
export function defaultPasskeysPath(home: string): string {
  return path.join(home, '.ccrc', 'passkeys.json');
}

/** What the last {@link PasskeyStore.load} found. See the module docstring
 *  (D-119) for why `'absent'` and `'unusable'` must not be one value. */
export type StoreState = 'unread' | 'absent' | 'ok' | 'unusable';

/**
 * Why an enrolment could not be stored. A discriminated result, never a bare
 * `false` (D-120): `add` used to answer `boolean`, which meant "the store is
 * full" and "the disk write failed" and "the file is unreadable" were the same
 * value — and two of those three were not even reachable, because a failed
 * `doFlush` is swallowed into a `console.warn`, so a full disk returned `true`
 * and the route answered `204 Passkey added` for a credential that would vanish
 * on restart. Each arm below is a different sentence the operator needs.
 */
export type AddResult =
  | { ok: true }
  /** `MAX_CREDENTIALS` reached. */
  | { ok: false; reason: 'full' }
  /** The file exists and could not be read — enrolling would overwrite it. */
  | { ok: false; reason: 'unusable' }
  /** The row is in memory but did not reach the disk. */
  | { ok: false; reason: 'write-failed' };

export class PasskeyStore {
  private records: StoredCredential[] = [];
  private state: StoreState = 'unread';
  /** Did the LAST write reach the disk? `doFlush` never throws (a rejection
   *  inside a route handler is a 500 on a path that must answer a refusal), so
   *  this is how its outcome is reported instead of being swallowed. */
  private lastWriteOk = true;
  /** The in-flight or completed load, cached so concurrent mutators share ONE
   *  read — `sessions.ts:136`'s reasoning, verbatim: a second `add` fired before
   *  the first's load resolves would push its row and then have the first load's
   *  assignment clobber it. */
  private loadPromise: Promise<void> | undefined;
  /** Serializes every `flush()`. One write in flight, last-writer-wins in
   *  program order. */
  private flushChain: Promise<void> = Promise.resolve();

  /** `storePath` is REQUIRED — no default. See {@link defaultPasskeysPath}. */
  constructor(private readonly storePath: string) {}

  async load(): Promise<void> {
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    this.records = [];
    let raw: string;
    try {
      raw = await readFile(this.storePath, 'utf8');
    } catch (err) {
      // ENOENT is the ordinary "no passkey has ever been enrolled" — silent, and
      // `'absent'`, which PERMITS enrolment. Every other read error (EACCES
      // after a bad chmod, EISDIR, EIO) is a file that EXISTS and cannot be
      // read: `'unusable'`, which denies assertions AND refuses enrolment,
      // because enrolling rewrites the file from an in-memory array that is
      // empty only because the read failed (D-119).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.state = 'absent';
        return;
      }
      this.state = 'unusable';
      console.warn(`ccrc-server: ${this.storePath} EXISTS but could not be read ` +
        `(${(err as NodeJS.ErrnoException).code}). No passkey will be accepted, and enrolment is ` +
        'REFUSED until this is fixed — enrolling would overwrite credentials this process cannot ' +
        'see. Sign in with the passphrase and fix the file\'s permissions.');
      return;
    }
    try {
      this.records = parseCredentials(JSON.parse(raw) as unknown);
      this.state = 'ok';
    } catch {
      // Present and unparseable. Same reasoning as the errno branch: the bytes
      // on disk are somebody's credentials, and overwriting them is not this
      // process's call to make.
      this.state = 'unusable';
      this.records = [];
      console.warn(`ccrc-server: ${this.storePath} is corrupt. No passkey will be accepted, and ` +
        'enrolment is REFUSED until this is fixed — enrolling would overwrite the file. Sign in ' +
        'with the passphrase; move the file aside deliberately if you mean to start over.');
    }
  }

  /** What the last load found. `'unread'` before any load — which denies and
   *  refuses enrolment, like `'unusable'`, because nobody looked. */
  loadState(): StoreState {
    return this.state;
  }

  /** Can a credential be enrolled right now? False on an unreadable file, so the
   *  route can refuse rather than overwrite (D-119). */
  canEnroll(): boolean {
    return this.state === 'absent' || this.state === 'ok';
  }

  /**
   * How many credentials are enrolled — the number `GET /api/auth/status`
   * publishes so the login screen knows whether to draw the passkey button.
   *
   * `0` on an unusable file, which is the right answer for THIS caller and only
   * this one: the anonymous status route is deciding whether to offer a button,
   * and a button that cannot work should not be offered. The caller that must
   * NOT read 0 as "none enrolled" is the authenticated enrol screen, and it
   * reads {@link loadState} instead — that split is the whole of D-119.
   */
  count(): number {
    return this.records.length;
  }

  /** The credential ids, for the ceremony's `allowCredentials`.
   *
   *  PUBLISHED TO AN UNAUTHENTICATED CALLER, deliberately and unavoidably: a
   *  non-discoverable credential can only be asserted if the browser is told
   *  which id to ask the authenticator for. A credential id is an opaque
   *  handle, not a secret — holding one gains nothing without the private key,
   *  which never leaves the authenticator. What it does reveal is that this box
   *  has N passkeys, which `AuthStatus.passkeysEnrolled` already publishes by
   *  the same explicit ruling (`ANON_VISIBLE`, `server.ts`). */
  ids(): string[] {
    return this.records.map((r) => r.credentialId);
  }

  /**
   * The enrolled keys as the ENROLMENT SCREEN sees them — `PasskeySummary`, the
   * gated shape (`shared/api.ts`).
   *
   * A PROJECTION, NOT THE ROWS. The stored record carries `spkiB64url`,
   * `algorithm`, `rpId`, `origin` and `signCount`; none of them belongs on a
   * screen whose only question is "which of these do I revoke", and mapping
   * field-by-field rather than spreading means a field ADDED to
   * `StoredCredential` tomorrow does not silently join the response. (The
   * `PasskeySummary` annotation is the other half: a field added to the WIRE
   * shape is a compile error here.)
   */
  list(): PasskeySummary[] {
    return this.records.map((r) => ({
      credentialIdB64url: r.credentialId,
      label: r.label,
      enrolledAt: r.enrolledAt,
      lastUsedAt: r.lastUsedAt,
      uvAtEnrollment: r.uvAtEnrollment,
    }));
  }

  /** The credential with this id, or `undefined`. A plain scan: the list is
   *  bounded by {@link MAX_CREDENTIALS}, and the id is a canonical base64url
   *  string (`decodeB64url` round-trips it), so there is no aliasing to defend
   *  against here. */
  find(credentialId: string): StoredCredential | undefined {
    return this.records.find((r) => r.credentialId === credentialId);
  }

  /**
   * Enrol one. RE-ENROLLING THE SAME ID REPLACES IT rather than adding a second
   * row — an authenticator re-registered against a box (the ordinary "I tapped
   * the button twice" case) produces the same credential id, and two rows for
   * one key would mean `find` returns the first, whose `signCount` is stale, and
   * every assertion is then refused as a replay. Replacing keeps one row per
   * key, which is what the authenticator itself believes.
   *
   * `false` when the store is full — the caller turns that into a refusal the
   * operator can read, never a silent drop.
   */
  async add(cred: StoredCredential): Promise<AddResult> {
    await this.ensureLoaded();
    // REFUSED ON AN UNREADABLE FILE, before anything is pushed. The flush that
    // would follow rewrites the whole file from `this.records`, which is empty
    // because the READ failed — so this is the line between "you have no
    // passkeys" and "you had passkeys and now you do not" (D-119).
    if (!this.canEnroll()) return { ok: false, reason: 'unusable' };
    const existing = this.records.findIndex((r) => r.credentialId === cred.credentialId);
    if (existing < 0 && this.records.length >= MAX_CREDENTIALS) return { ok: false, reason: 'full' };
    if (existing >= 0) this.records[existing] = cred;
    else this.records.push(cred);
    await this.flush();
    // The write's outcome is REPORTED, not swallowed (D-120). A full disk used
    // to answer `204 Passkey added` for a row that vanished on the next restart.
    if (!this.lastWriteOk) return { ok: false, reason: 'write-failed' };
    return { ok: true };
  }

  /**
   * Record an accepted assertion: advance the counter and stamp the clock.
   *
   * THE IN-MEMORY UPDATE IS UNCONDITIONAL AND HAPPENS FIRST. The replay defence
   * has to hold whatever the disk does — a flush that fails must not also mean
   * the running process will accept the same assertion again. Persistence is
   * best-effort behind it, and {@link doFlush} says so out loud when it fails.
   */
  async recordUse(credentialId: string, signCount: number, now: number): Promise<void> {
    await this.ensureLoaded();
    const rec = this.records.find((r) => r.credentialId === credentialId);
    if (rec === undefined) return;
    rec.signCount = signCount;
    rec.lastUsedAt = now;
    await this.flush();
  }

  /** Un-enrol one. `true` iff a row went. */
  async remove(credentialId: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.records.length;
    this.records = this.records.filter((r) => r.credentialId !== credentialId);
    if (this.records.length === before) return false;
    await this.flush();
    return true;
  }

  /** Persist, serialized behind {@link flushChain}. Never rejects — but unlike
   *  `sessions.ts` it does not fail SILENTLY either; see {@link doFlush}. */
  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  private async doFlush(): Promise<void> {
    const snapshot = JSON.stringify(this.records);
    try {
      await mkdir(path.dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: FILE_MODE });
      await rename(tmp, this.storePath);
      this.lastWriteOk = true;
      // A successful write makes the file READABLE-AND-KNOWN by construction:
      // these are the bytes we just put there. Without this a store that booted
      // `'absent'` would stay `'absent'` forever and `canEnroll` would keep
      // saying yes for the wrong reason.
      this.state = 'ok';
    } catch (err) {
      this.lastWriteOk = false;
      // LOUD, where `sessions.ts` is silent, and the difference is the counter.
      // A lost session costs a login. A lost `signCount` write means the value on
      // disk is behind the one in memory, so a RESTART would accept an assertion
      // this process would refuse — the clone/replay defence quietly weakened by
      // a full disk. That deserves a line in the journal.
      console.warn(`ccrc-server: could not write ${this.storePath} ` +
        `(${(err as NodeJS.ErrnoException).code ?? 'unknown'}). Enrolments and passkey signature ` +
        'counters are not being persisted; until this is fixed, a restart reverts them.');
    }
  }
}

/**
 * Turn parsed JSON into credentials, keeping the well-formed rows and dropping
 * the rest. Throws only if the top level is not an array (a corrupt or foreign
 * file), which {@link PasskeyStore.load}'s catch turns into an empty store.
 *
 * EVERY FIELD IS VALIDATED, INCLUDING THE ONES THAT "COULD ONLY HAVE COME FROM
 * US". This file is on disk under a path an operator can edit, and every row
 * that survives here is fed to a verifier as though it were trustworthy: the
 * `rpId` becomes the hash an assertion is checked against, the `origin` becomes
 * the string `clientDataJSON.origin` must equal, and `signCount` becomes the
 * replay floor. A row with `origin: ""` or a negative `signCount` is not a
 * cosmetic problem — it is a check that passes on inputs it should refuse. So
 * the parser is as strict as `secret.ts`'s, and a row that fails any part of it
 * is DROPPED (the credential stops working, the passphrase still does) rather
 * than repaired.
 */
function parseCredentials(raw: unknown): StoredCredential[] {
  if (!Array.isArray(raw)) throw new Error('passkeys.json is not an array');
  const out: StoredCredential[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const { credentialId, spkiB64url, algorithm, rpId, origin, signCount, uvAtEnrollment,
      enrolledAt, lastUsedAt, label } = e;
    // The two base64url fields go through the SAME strict decoder the verifier
    // uses, so a row whose id is spelled non-canonically cannot be stored under
    // a key that `find` will never be handed.
    if (typeof credentialId !== 'string' || decodeB64url(credentialId, MAX_CREDENTIAL_ID_BYTES) === null) continue;
    if (typeof spkiB64url !== 'string' || decodeB64url(spkiB64url, MAX_SPKI_BYTES) === null) continue;
    if (typeof algorithm !== 'number' || !Number.isInteger(algorithm)) continue;
    if (typeof rpId !== 'string' || rpId === '') continue;
    if (typeof origin !== 'string' || origin === '') continue;
    if (typeof signCount !== 'number' || !Number.isInteger(signCount) || signCount < 0) continue;
    if (typeof enrolledAt !== 'number' || !Number.isFinite(enrolledAt)) continue;
    if (typeof lastUsedAt !== 'number' || !Number.isFinite(lastUsedAt)) continue;
    if (typeof label !== 'string') continue;
    // A DUPLICATE id would give `find` a first row whose counter is behind the
    // second's — every assertion then refused as a replay, from a file that
    // looks fine. First wins, the rest are dropped.
    if (seen.has(credentialId)) continue;
    seen.add(credentialId);
    out.push({
      credentialId, spkiB64url, algorithm, rpId, origin, signCount,
      // Absence permits (`CLAUDE.md`'s wire discipline) for the one field that
      // is a NOTE rather than a decision: a row written by an older build has no
      // `uvAtEnrollment`, and refusing it would un-enrol a working key on
      // upgrade. Nothing branches on this value — the UV POLICY is enforced on
      // every assertion from the authenticator's own flags, never from here.
      uvAtEnrollment: uvAtEnrollment === true,
      enrolledAt, lastUsedAt, label,
    });
  }
  return out;
}
