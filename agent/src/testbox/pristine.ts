// D-7407, D-7543 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB5; spec §2.2 "Pristine installs", "A
// failed pristine build retries with backoff"). L1, pure and clock-free: the pristine-install store. Every time is
// given by the caller, in ms since the epoch.
//
// The install key is the sha256 of the package's install inputs (the row's `installInputs`: its `package.json` and
// `package-lock.json`, plus any file the row adds; then the files its lifecycle scripts run, D-8966 below), the node
// version and the platform: the inputs `server-deps`' CI cache key names, never a branch, a ref or a run. A key is `present` (its pristine install exists), `missing` (a
// build is wanted and not yet queued), `building` (queued or running) or `failed` (the last build exited non-zero,
// timed out or was killed; the next attempt waits `CCRC_TESTBOX_PRISTINE_RETRY`'s delay for its attempt count, the
// last delay repeating). A newer key for the same package replaces a failed one. A present key unused for
// `CCRC_TESTBOX_PRISTINE_KEEP` is deleted when no prepare is copying it. A new node version queues a rebuild of every
// key under that node; the old keys are never cloned again and expire as any unused key does.
import { createHash } from 'node:crypto';

export type PristineState = 'present' | 'missing' | 'building' | 'failed';
export const PRISTINE_STATE_MAP: Record<PristineState, true> = { present: true, missing: true, building: true, failed: true };

/** The two settings this store reads (`config.ts`'s `lines`, through `pristineSettings`). */
export const PRISTINE_KNOBS = ['CCRC_TESTBOX_PRISTINE_RETRY', 'CCRC_TESTBOX_PRISTINE_KEEP'] as const;

export interface PristineSettings {
  /** The delays between attempts of a failed build, the last repeating. */
  readonly retryMs: readonly number[];
  /** A present key unused this long is deleted. */
  readonly keepMs: number;
}

/** The settings from the printer's lines; `duration` is the caller's duration reader (`config.ts#durationMs`), so
 *  this file stays free of the reader's I/O. A missing key refuses with its name. */
export function pristineSettings(
  lines: ReadonlyMap<string, { readonly value: string }>, duration: (key: string, value: string) => number,
): PristineSettings {
  const v = (k: (typeof PRISTINE_KNOBS)[number]): string => {
    const l = lines.get(k);
    if (l === undefined) throw new Error(`the settings printer gave no ${k}`);
    return l.value;
  };
  const words = v('CCRC_TESTBOX_PRISTINE_RETRY').split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) throw new Error('CCRC_TESTBOX_PRISTINE_RETRY names no delay');
  return {
    retryMs: words.map((w) => duration('CCRC_TESTBOX_PRISTINE_RETRY', w)),
    keepMs: duration('CCRC_TESTBOX_PRISTINE_KEEP', v('CCRC_TESTBOX_PRISTINE_KEEP')),
  };
}

/** One install input: its path relative to the repository root and its bytes at the run's tree. */
export interface InstallInput { readonly path: string; readonly bytes: Uint8Array }

/** The sha256 of the inputs, in the row's order, each framed by its path and length so no two input sets collide. */
export function inputsDigest(inputs: readonly InstallInput[]): string {
  const h = createHash('sha256');
  for (const i of inputs) {
    h.update(`${i.path}\0${i.bytes.length}\0`);
    h.update(i.bytes);
  }
  return h.digest('hex');
}

/** The install key: the inputs, the node version and the platform. */
export function installKey(inputs: readonly InstallInput[], node: string, platform: string): string {
  return createHash('sha256').update(`ccrc-testbox-install\0${inputsDigest(inputs)}\0${node}\0${platform}`).digest('hex');
}

export const INSTALL_KEY = /^[0-9a-f]{64}$/;

// D-8966 (plan docs/superpowers/plans/2026-11-23-testbox-install-inputs-from-scripts.md; spec §2.2, §2.6): a package's
// install inputs are the row's, plus the files its own lifecycle scripts run. `npm ci` runs those scripts in the
// pristine build, which holds the inputs only, so a script the row did not name failed every build ("Cannot find
// module"). The row's list stays what the operator gave; this decides which further paths to look for, and the mirror
// read keeps those that are regular files at the run's tree. So the script is in the key, a change to it changes the
// key, and the build lays it out.

/** The lifecycle scripts `npm ci` runs in the package itself, in npm's order. */
export const LIFECYCLE_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'] as const;

/** At most this many paths a package's lifecycle scripts add, in the scripts' order: each is one read of the mirror. */
export const LIFECYCLE_INPUTS_MAX = 16;

export interface LifecycleInputs {
  /** Paths relative to the repository root, none of them declared, sorted; the caller keeps those that are files. */
  readonly paths: readonly string[];
  /** Why something added nothing, or was cut, one line each. */
  readonly notes: readonly string[];
}

/** Quoting, expansion, redirection, grouping, a background `&` or a second line: a script whose words a whitespace
 *  split would misread. */
const UNFOLLOWED = /['"`$\\<>()\n\r\0]/;
/** A word that may name a file: no glob, brace, tilde, assignment or other shell character. */
const PATH_WORD = /^[A-Za-z0-9._@+/-]+$/;

/** A script's words, or `null` when it uses what a whitespace split cannot follow. `&&`, `||`, `;` and `|` separate. */
function scriptWords(script: string): string[] | null {
  if (UNFOLLOWED.test(script)) return null;
  const plain = script.replace(/&&|\|\|/g, ' ');
  if (plain.includes('&')) return null;
  return plain.split(/[\s;|]+/).filter((w) => w !== '');
}

/** The path a word names relative to its package, or `null`: a flag, a `..`, `.` or empty segment (an absolute path's
 *  first segment is empty), or a bare word with neither a `/` nor a `.` (a command or an argument, not a file). */
function wordPath(word: string): string | null {
  if (word.startsWith('-') || !PATH_WORD.test(word)) return null;
  let w = word;
  while (w.startsWith('./')) w = w.slice(2);
  if (!w.includes('/') && !w.includes('.')) return null;
  return w.split('/').some((s) => s === '' || s === '.' || s === '..') ? null : w;
}

/** The paths a package's lifecycle scripts may run, from its `package.json` bytes (`null` when the row does not
 *  declare it). Deterministic: the four hooks in npm's order, their words in order, de-duplicated, the declared ones
 *  left out, cut at `LIFECYCLE_INPUTS_MAX`, then sorted. What cannot be read adds nothing and says why. */
export function lifecycleInputPaths(pkg: string, manifest: Uint8Array | null, declared: readonly string[]): LifecycleInputs {
  const at = `${pkg}/package.json`;
  const none = (why: string): LifecycleInputs => ({ paths: [], notes: [`${why}; no lifecycle script adds an install input`] });
  if (manifest === null) return none(`the row's install inputs do not name ${at}`);
  let v: unknown;
  try { v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)); } catch { return none(`${at} is not JSON`); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return none(`${at} is not an object`);
  const scripts = (v as Record<string, unknown>).scripts;
  if (scripts === undefined) return { paths: [], notes: [] };
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return none(`${at}: scripts is not an object`);
  const notes: string[] = [];
  const found: string[] = [];
  for (const hook of LIFECYCLE_HOOKS) {
    const s = Object.hasOwn(scripts, hook) ? (scripts as Record<string, unknown>)[hook] : undefined;
    if (s === undefined) continue;
    const words = typeof s === 'string' ? scriptWords(s) : null;
    if (words === null) {
      notes.push(`${at}: scripts.${hook} ${typeof s === 'string' ? 'uses quoting, expansion or redirection this reader does not follow' : 'is not a string'}; it adds no install input`);
      continue;
    }
    for (const w of words) {
      const p = wordPath(w);
      const full = p === null ? null : `${pkg}/${p}`;
      if (full !== null && !declared.includes(full) && !found.includes(full)) found.push(full);
    }
  }
  if (found.length > LIFECYCLE_INPUTS_MAX) notes.push(`${at}: its lifecycle scripts name ${found.length} paths; the first ${LIFECYCLE_INPUTS_MAX} are kept`);
  return { paths: found.slice(0, LIFECYCLE_INPUTS_MAX).sort(), notes };
}

export interface PristineEntry {
  readonly key: string;
  /** `null` for a pristine install found on disk that no run has named since the service started. */
  readonly repository: string | null;
  readonly package: string | null;
  /** The inputs a rebuild lays out; empty for an entry found on disk. */
  readonly inputs: readonly InstallInput[];
  readonly node: string;
  readonly state: PristineState;
  /** The last failed build's exit, `null` otherwise. */
  readonly exit: number | null;
  /** Failed attempts since the last success. */
  readonly attempts: number;
  /** When a failed key may be built again. */
  readonly nextAttemptAt: number | null;
  readonly lastUsedAt: number;
  /** Prepares copying this key now. */
  readonly copying: number;
}

export interface PristineStore {
  readonly node: string;
  readonly platform: string;
  readonly entries: readonly PristineEntry[];
  /** Keys deleted from the store whose directories the next install unit's privileged first step removes. */
  readonly doomed: readonly string[];
}

export const emptyStore = (node: string, platform: string): PristineStore => ({ node, platform, entries: [], doomed: [] });

const put = (s: PristineStore, e: PristineEntry): PristineStore =>
  ({ ...s, entries: s.entries.some((x) => x.key === e.key) ? s.entries.map((x) => (x.key === e.key ? e : x)) : [...s.entries, e] });
const find = (s: PristineStore, key: string): PristineEntry | undefined => s.entries.find((e) => e.key === key);

/** The directories found under `pristine/` at start: each one adopted as present, unnamed until a run names it, so an
 *  unused one expires after the keep time and a restart rebuilds nothing. */
export function adopt(s: PristineStore, keys: readonly string[], now: number): PristineStore {
  let next = s;
  for (const key of keys) {
    if (!INSTALL_KEY.test(key) || find(next, key) !== undefined) continue;
    next = put(next, { key, repository: null, package: null, inputs: [], node: next.node, state: 'present', exit: null, attempts: 0, nextAttemptAt: null, lastUsedAt: now, copying: 0 });
  }
  return next;
}

export interface Seen {
  readonly store: PristineStore;
  readonly key: string;
  /** Clone the pristine install (`true`), or install in the run's own copy (`false`). */
  readonly present: boolean;
}

/** A prepare names a package's inputs: the key under the store's node, whether it is present, and the store with the
 *  key used now. A key the store does not hold is `missing` (a build is queued); it replaces any failed key of the
 *  same package. A clone counts as copying until `copyEnded`. */
export function seen(s: PristineStore, repository: string, pkg: string, inputs: readonly InstallInput[], now: number): Seen {
  const key = installKey(inputs, s.node, s.platform);
  const e = find(s, key);
  if (e !== undefined) {
    const present = e.state === 'present';
    const named = { ...e, repository, package: pkg, inputs: e.inputs.length > 0 ? e.inputs : inputs };
    return { store: put(s, { ...named, lastUsedAt: now, copying: e.copying + (present ? 1 : 0) }), key, present };
  }
  const kept = s.entries.filter((x) => !(x.state === 'failed' && x.repository === repository && x.package === pkg));
  const fresh: PristineEntry = { key, repository, package: pkg, inputs, node: s.node, state: 'missing', exit: null, attempts: 0, nextAttemptAt: null, lastUsedAt: now, copying: 0 };
  return { store: { ...s, entries: [...kept, fresh] }, key, present: false };
}

/** A prepare that cloned `key` ended. */
export function copyEnded(s: PristineStore, key: string): PristineStore {
  const e = find(s, key);
  return e === undefined ? s : put(s, { ...e, copying: Math.max(0, e.copying - 1) });
}

/** The keys to queue a build for now: every missing one, and every failed one whose next attempt has come, in the
 *  store's order. */
export function due(s: PristineStore, now: number): readonly string[] {
  return s.entries.filter((e) => e.inputs.length > 0 && (e.state === 'missing' || (e.state === 'failed' && (e.nextAttemptAt ?? 0) <= now))).map((e) => e.key);
}

/** A build was queued. */
export function buildQueued(s: PristineStore, key: string): PristineStore {
  const e = find(s, key);
  return e === undefined ? s : put(s, { ...e, state: 'building' });
}

/** The delay before attempt `attempts + 1`, `attempts` failed ones counted: the last delay repeats. */
export function retryDelay(retryMs: readonly number[], attempts: number): number {
  if (retryMs.length === 0) throw new Error('no retry delay');
  return retryMs[Math.min(Math.max(attempts, 1), retryMs.length) - 1]!;
}

/** A build ended: exit 0 is present; anything else is failed, one more attempt counted, retried after its delay. */
export function buildEnded(s: PristineStore, key: string, exit: number, now: number, retryMs: readonly number[]): PristineStore {
  const e = find(s, key);
  if (e === undefined) return s;
  if (exit === 0) return put(s, { ...e, state: 'present', exit: null, attempts: 0, nextAttemptAt: null, lastUsedAt: now });
  const attempts = e.attempts + 1;
  return put(s, { ...e, state: 'failed', exit, attempts, nextAttemptAt: now + retryDelay(retryMs, attempts) });
}

/** Every present key unused for the keep time with no prepare copying it leaves the store and is doomed. */
export function expire(s: PristineStore, now: number, keepMs: number): PristineStore {
  const old = s.entries.filter((e) => e.state === 'present' && e.copying === 0 && now - e.lastUsedAt >= keepMs).map((e) => e.key);
  if (old.length === 0) return s;
  return { ...s, entries: s.entries.filter((e) => !old.includes(e.key)), doomed: [...s.doomed, ...old.filter((k) => !s.doomed.includes(k))] };
}

/** The doomed keys an install unit's first step removed. */
export function undoom(s: PristineStore, keys: readonly string[]): PristineStore {
  return { ...s, doomed: s.doomed.filter((k) => !keys.includes(k)) };
}

/** Whether a directory found on disk for `key` may be cloned: never one that is doomed. */
export const adoptable = (s: PristineStore, key: string): boolean => !s.doomed.includes(key);

/** A new node version: every named key's inputs queued again under it. The old keys stay until they expire. */
export function nodeChanged(s: PristineStore, node: string, now: number): PristineStore {
  if (node === s.node) return s;
  let next: PristineStore = { ...s, node, entries: s.entries.filter((e) => e.state !== 'failed') };
  for (const e of s.entries) {
    if (e.node !== s.node || e.repository === null || e.package === null || e.inputs.length === 0) continue;
    const key = installKey(e.inputs, node, s.platform);
    if (find(next, key) !== undefined) continue;
    next = put(next, { key, repository: e.repository, package: e.package, inputs: e.inputs, node, state: 'missing', exit: null, attempts: 0, nextAttemptAt: null, lastUsedAt: now, copying: 0 });
  }
  return next;
}

/** The status answer's two lists: present keys a run has named, and failed keys with their exit, attempts and next
 *  attempt (ms; the caller writes the time). */
export function pristineLists(s: PristineStore): {
  readonly pristine: readonly { readonly repository: string; readonly package: string; readonly key: string }[];
  readonly failed: readonly { readonly repository: string; readonly package: string; readonly key: string; readonly exit: number; readonly attempts: number; readonly nextAttemptAt: number }[];
} {
  const named = s.entries.filter((e) => e.repository !== null && e.package !== null);
  return {
    pristine: named.filter((e) => e.state === 'present').map((e) => ({ repository: e.repository!, package: e.package!, key: e.key })),
    failed: named.filter((e) => e.state === 'failed').map((e) => ({
      repository: e.repository!, package: e.package!, key: e.key, exit: e.exit ?? 0, attempts: e.attempts, nextAttemptAt: e.nextAttemptAt ?? 0,
    })),
  };
}
