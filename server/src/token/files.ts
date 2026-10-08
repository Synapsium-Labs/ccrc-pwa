// Box-token file adapter, ring L3 (spec 4.2). Measured reads that keep absent,
// unusable, placeholder and unreadable apart; one atomic, fsynced, 0600-from-
// birth write for every file this feature owns; the mints. Every path derives
// from `path.dirname(cfg.mailTokenPath)` (server/src/config.ts), so
// `CCRC_MAIL_TOKEN_PATH` moves them all.
//
// Calls go through the `fsp` object (never destructured) so a test can inject
// a failure at one step with `vi.spyOn(fs.promises, …)`; there is no fault
// seam in the production signature.
import { constants as FS, promises as fsp } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { extractToken, PLACEHOLDER_TOKEN } from '../coord/token.js';
import {
  FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, OWED_REASONS, TOKEN_FILE_PROBLEMS, TOKEN_HOLDS, TOKEN_ORIGINS,
} from '../../../shared/box-token.js';
import { CCRC_DIR_NAME, NODE_FILES, TOKEN_TRANSPORTS } from '../../../shared/agent-protocol.js';
import { PENDING_HARD_CAP, type BoxTokenState, type WriteRecord } from './policy.js';
import type { BothRoleWriter, FileMeta, RetiredRead, StateRead, TokenPaths, TokenStore, ValueRead } from './ports.js';

export type { FileMeta, RetiredRead, StateRead, TokenPaths, ValueRead } from './ports.js';

const errno = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'EIO';

export function tokenPaths(mailTokenPath: string, home: string): TokenPaths {
  const dir = path.dirname(mailTokenPath);
  return {
    dir,
    current: mailTokenPath,
    previous: path.join(dir, 'mail-previous.token'),
    pending: (id: string) => {
      if (!GENERATION_ID_RE.test(id)) throw new RangeError('tokenPaths.pending: not a generation id');
      return path.join(dir, `mail-pending-${id}.token`);
    },
    state: path.join(dir, 'box-token.json'),
    retired: path.join(dir, 'box-token-retired.json'),
    // A node file (verb, doctor, uninstall, the agent's grant): under the HOME, from NODE_FILES, never a quoted literal.
    generation: path.join(home, CCRC_DIR_NAME, NODE_FILES.tokenGeneration),
    fleetFile: path.join(home, '.cc-secrets', 'ccrc-mail.token'),
    agentEnv: path.join(home, CCRC_DIR_NAME, 'agent.env'),
  };
}

const kindOf = (st: { isFile(): boolean; isSymbolicLink(): boolean }): FileMeta['kind'] =>
  st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'regular' : 'other';

/** lstat first (its ENOENT is the only `absent`), then the read, which follows a link exactly as
 *  `readMailToken`'s `readFileSync` does; the value is `extractToken`'s, never re-spelled. */
export async function readValueFile(p: string): Promise<ValueRead> {
  let meta: FileMeta;
  try {
    const st = await fsp.lstat(p);
    meta = { dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, mode: st.mode & 0o7777, kind: kindOf(st) };
  } catch (e) {
    return errno(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', code: errno(e) };
  }
  let raw: string;
  try {
    raw = await fsp.readFile(p, 'utf8');
  } catch (e) {
    return { kind: 'unreadable', code: errno(e) };   // ENOENT here is a dangling link: present, not absent
  }
  const value = extractToken(raw);
  if (value === null) return { kind: 'unusable', meta };
  if (value === PLACEHOLDER_TOKEN) return { kind: 'placeholder' };
  return { kind: 'value', value, meta };
}

/** Temp `<dir>/.<base>.tmp-<16 hex>` opened O_WRONLY|O_CREAT|O_EXCL at 0600, written, fsynced, fstat'd, closed,
 *  renamed over `p`, then the directory fsynced. A throw before the rename removes the temp and leaves `p`
 *  byte-equal. A rejection from the post-rename directory fsync means `p` WAS replaced but its durability is
 *  unproven: the caller must treat `p`'s state as unknown. `writtenAtMs` is never earlier than the file's own mtime (the 4.2.1 proof compares the two). */
export async function writeValueFileAtomic(p: string, text: string): Promise<WriteRecord> {
  const dir = path.dirname(p);
  const tmp = path.join(dir, `.${path.basename(p)}.tmp-${randomBytes(8).toString('hex')}`);
  let rec: WriteRecord;
  try {
    const fh = await fsp.open(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL, 0o600);
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
      const st = await fh.stat();
      rec = { dev: st.dev, ino: st.ino, writtenAtMs: Math.max(Date.now(), Math.ceil(st.mtimeMs)) };
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, p);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await syncDir(dir);
  return rec;
}

async function syncDir(dir: string): Promise<void> {
  const dh = await fsp.open(dir, 'r');
  try { await dh.sync(); } finally { await dh.close(); }
}

/** One atomic replace (promotion step (c)), then the directory fsync. A rejection from the fsync means `to` WAS
 *  replaced but its durability is unproven: the caller must treat `to`'s state as unknown. */
export async function renameOverAtomic(from: string, to: string): Promise<void> {
  await fsp.rename(from, to);
  await syncDir(path.dirname(to));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isSource = (v: unknown): boolean => v === 'pending' || v === 'previous';
const DIGEST_RE = /^[0-9a-f]{64}$/;
const isWrite = (v: unknown): boolean => isObj(v) && isNum(v.dev) && isNum(v.ino) && isNum(v.writtenAtMs);

/** A shape check, not a schema: every field BoxTokenState declares must be present and null or its declared shape
 *  (D-4403), so every reader of a field gets the type the field declares. Only `fileProblem` is optional. */
function isBoxTokenState(v: unknown): v is BoxTokenState {
  if (!isObj(v) || v.v !== 1) return false;
  if (!(TOKEN_ORIGINS as readonly unknown[]).includes(v.origin)) return false;
  if (typeof v.rotationOwed !== 'boolean') return false;
  if (v.owedWhy !== null && !(OWED_REASONS as readonly unknown[]).includes(v.owedWhy)) return false;
  const c = v.current;
  if (!isObj(c) || !isStrOrNull(c.id) || !isNum(c.seq) || !isNum(c.since) || !(c.write === null || isWrite(c.write))) return false;
  // F4 / D-4413: `pending` is bounded to the cap, so no consumer (BoxTokenHolder.setSlots) is handed a list it throws on.
  if (!Array.isArray(v.pending) || v.pending.length > PENDING_HARD_CAP || !v.pending.every((p) => isObj(p) && typeof p.id === 'string' && GENERATION_ID_RE.test(p.id)
    && isNum(p.seq) && isNum(p.stagedAt) && isNumOrNull(p.handedOutAt) && isNumOrNull(p.confirmBy) && isWrite(p.write))) return false;
  const pr = v.previous;
  if (pr !== null && !(isObj(pr) && isStrOrNull(pr.id) && isNum(pr.seq) && isNum(pr.graceUntil) && isNum(pr.hardUntil)
    && typeof pr.currentPresented === 'boolean' && isWrite(pr.write))) return false;
  if (v.promoting !== null && !(isObj(v.promoting) && typeof v.promoting.id === 'string' && GENERATION_ID_RE.test(v.promoting.id))) return false;
  if (v.recovering !== null && !(isObj(v.recovering) && isSource(v.recovering.source))) return false;
  if (!isStrOrNull(v.holdNode) || !isStrOrNull(v.lastFailure)) return false;
  const ls = v.lastSync;
  if (ls !== null && !(isObj(ls) && isNum(ls.at) && typeof ls.word === 'string'
    && (ls.transport === 'unmeasured' || (TOKEN_TRANSPORTS as readonly unknown[]).includes(ls.transport)))) return false;
  if (!isNumOrNull(v.retiredRefusedAt) || !isNumOrNull(v.mintFailedAt)) return false;
  const lb = v.lastBootRecovery;
  if (lb !== null && !(isObj(lb) && isNum(lb.at) && isSource(lb.source))) return false;
  if (v.hold !== null && !(TOKEN_HOLDS as readonly unknown[]).includes(v.hold)) return false;
  if (!isStrOrNull(v.fleetConfirmed) || !isNum(v.nextSeq) || !isNumOrNull(v.lastRotationAt) || !isNum(v.failures)) return false;
  if (!isObj(v.counters) || !isNum(v.counters.previousPresented) || !isNum(v.counters.retiredPresented)) return false;
  const fp = v.fileProblem;   // optional (A9's re-read): absent and null both read; anything else must be the shape
  if (fp !== undefined && fp !== null && !(isObj(fp) && isNum(fp.at) && ['current', 'pending', 'previous'].includes(fp.file as string)
    && (TOKEN_FILE_PROBLEMS as readonly unknown[]).includes(fp.word))) return false;
  // D-4410: the retiring record is optional (absent and null both read); anything else must be the shape, entry by entry.
  const rt = v.retiring;
  if (rt !== undefined && rt !== null && !(Array.isArray(rt) && rt.every((e) => isObj(e) && typeof e.sha256 === 'string' && DIGEST_RE.test(e.sha256) && isNum(e.at)))) return false;
  return true;
}

/** A state that is valid in every respect except that `pending` is longer than the cap (D-4413, F4): checked by
 *  validating it with the list cut to the cap, so no other malformed content can be called over-cap. */
function overCap(v: unknown): boolean {
  return isObj(v) && Array.isArray(v.pending) && v.pending.length > PENDING_HARD_CAP
    && isBoxTokenState({ ...v, pending: v.pending.slice(0, PENDING_HARD_CAP) });
}

export async function readState(p: string): Promise<StateRead> {
  let raw: string;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) {
    return errno(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', code: errno(e) };
  }
  try {
    const v: unknown = JSON.parse(raw);
    if (isBoxTokenState(v)) return { kind: 'state', state: v };
    return overCap(v) ? { kind: 'unusable', why: 'over-cap' } : { kind: 'unusable' };
  } catch { return { kind: 'unusable' }; }
}

/** The same atomic write, so the same rejection contract: a rejection before the rename leaves the file unchanged;
 *  one from the post-rename directory fsync means it was replaced with durability unproven (state unknown). */
export async function writeState(p: string, s: BoxTokenState): Promise<void> {
  await writeValueFileAtomic(p, `${JSON.stringify(s)}\n`);
}

interface RetiredEntry { len: number; sha256: string; at: number }

/** Parses and validates a retired file's text once; null when it is not the shape. Entries keep their validated shape. */
function parseRetired(raw: string): RetiredEntry[] | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || v.v !== 1 || !Array.isArray(v.retired)) return null;
    const entries: RetiredEntry[] = [];
    for (const r of v.retired) {
      if (!isObj(r) || typeof r.sha256 !== 'string' || !DIGEST_RE.test(r.sha256)) return null;
      entries.push({ len: isNum(r.len) ? r.len : 64, sha256: r.sha256, at: isNum(r.at) ? r.at : 0 });
    }
    return entries;
  } catch { return null; }
}

export async function readRetired(p: string): Promise<RetiredRead> {
  let raw: string;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) {
    return errno(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', code: errno(e) };
  }
  const entries = parseRetired(raw);
  return entries === null ? { kind: 'unusable' } : { kind: 'retired', digests: entries.map((e) => e.sha256) };
}

/** Adds one digest (deduplicated). An unusable file is never overwritten: that would drop digests, so it throws.
 *  One read, one parse: the new file is built from the validated entries. */
export async function appendRetired(p: string, valueDigest: string, at: number): Promise<void> {
  if (!DIGEST_RE.test(valueDigest)) throw new RangeError('appendRetired: not a sha256 hex digest');
  let raw: string | null = null;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) {
    // Unreadable (EACCES, EIO, EISDIR...) is not unusable: two outcomes, two words (D-4410, D-4403 item 2). Neither is rewritten.
    if (errno(e) !== 'ENOENT') throw Object.assign(new Error(`${p} is unreadable (${errno(e)}); refusing to rewrite it`), { code: errno(e) });
  }
  const entries = raw === null ? [] : parseRetired(raw);
  if (entries === null) throw Object.assign(new Error(`${p} is unusable; refusing to rewrite it`), { code: 'unusable' });
  if (!entries.some((e) => e.sha256 === valueDigest)) entries.push({ len: 64, sha256: valueDigest, at });
  await writeValueFileAtomic(p, `${JSON.stringify({ v: 1, retired: entries })}\n`);
}

/** Sets an unusable file aside as `<p>.unusable-<tag>` (then `-1`, `-2`... when that name is taken), keeping every byte
 *  and never overwriting: a hard link is made first, which refuses an existing name (EEXIST), and only then is the old
 *  name removed. Answers the new path (D-4410). */
export async function moveAsideUnusable(p: string, tag: string | number): Promise<string> {
  for (let n = 0; n < 1000; n++) {
    const to = `${p}.unusable-${tag}${n === 0 ? '' : `-${n}`}`;
    try { await fsp.link(p, to); } catch (e) {
      if (errno(e) === 'EEXIST') continue;
      throw e;
    }
    await fsp.rm(p, { force: true });
    return to;
  }
  throw new Error(`${p}: no free name to set it aside under`);
}

export function valueDigestHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function mintValue(): string { return randomBytes(32).toString('hex'); }
export function mintGenerationId(): string { return randomBytes(8).toString('hex'); }
export function mintClaimCode(): string { return randomBytes(32).toString('base64url'); }

/** The existing file's `#` and blank lines kept verbatim and in order, then the one value line; no file ->
 *  the fixed comment line, then the value. Every reader takes the first line that is neither blank nor `#`. */
export function fleetFileText(existing: string | null, value: string): string {
  if (existing === null) return `${FLEET_TOKEN_FILE_COMMENT}\n${value}\n`;
  const lines = existing.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const kept = lines.filter((l) => { const t = l.trim(); return t === '' || t.startsWith('#'); });
  return [...kept, value].join('\n') + '\n';
}

/** `<home>/.cc-secrets` is created at 0700 only when absent; an existing directory is never chmodded. */
export async function writeFleetTokenFile(p: string, value: string): Promise<void> {
  const dir = path.dirname(p);
  if (!(await fileExists(dir))) await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  let existing: string | null = null;
  try { existing = await fsp.readFile(p, 'utf8'); } catch (e) {
    if (errno(e) !== 'ENOENT') throw e;
  }
  await writeValueFileAtomic(p, fleetFileText(existing, value));
}

export async function writeGenerationFile(p: string, id: string): Promise<void> {
  if (!GENERATION_ID_RE.test(id)) throw new RangeError('writeGenerationFile: not a generation id');
  await writeValueFileAtomic(p, `${id}\n`);
}

/** lstat, any kind. Anything but a proven ENOENT reads as present: the callers ask "is there a .cc-secrets", and
 *  "present" is the safe answer. */
export async function fileExists(p: string): Promise<boolean> {
  try { await fsp.lstat(p); return true; } catch (e) { return errno(e) !== 'ENOENT'; }
}

/** Whether `~/.ccrc/agent.env` marks a FLEET box, so the both-role writer must not act (spec 4.10 as narrowed by
 *  D-4399). A proven ENOENT: no. A readable file: yes iff a line's KEY is `CCRC_AGENT_TOKEN`
 *  (optionally after `export `), which every `ccrc install --role fleet` writes and the README's single-box file
 *  (`CCRC_SERVER_URL` only) never does. Any other read failure: yes, because unknown is the safe answer. The file
 *  carries the agent bearer: only each line's key is looked at, no value is kept, returned or logged. */
export async function readAgentEnvMarksFleet(p: string): Promise<boolean> {
  let raw: string;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) { return errno(e) !== 'ENOENT'; }
  return raw.split('\n').some((line) => /^\s*(?:export\s+)?CCRC_AGENT_TOKEN=/.test(line));
}

/** The `TokenStore` port over these functions (an addition to the contract: its one adapter). */
export function fileTokenStore(paths: TokenPaths): TokenStore {
  return {
    paths,
    readState: () => readState(paths.state),
    writeState: (s) => writeState(paths.state, s),
    readValue: (p) => readValueFile(p),
    writeValue: (p, value) => writeValueFileAtomic(p, `${value}\n`),
    removeValue: async (p) => { await fsp.rm(p, { force: true }); },
    renameOver: (from, to) => renameOverAtomic(from, to),
    readRetired: () => readRetired(paths.retired),
    appendRetired: (d, at) => appendRetired(paths.retired, d, at),
    mintValue, mintGenerationId, mintClaimCode,
  };
}

/** The recorded-both writer (spec 4.10): the fleet file, then the generation file. */
export function fileBothRoleWriter(paths: TokenPaths): BothRoleWriter {
  return {
    async write(value, generation) {
      await writeFleetTokenFile(paths.fleetFile, value);
      if (generation !== null) await writeGenerationFile(paths.generation, generation);
    },
  };
}
