/**
 * THE EGRESS MASK (D-5513, accounts-connect spec 2026-10-18 §3.3, plan Task A10; G31). Every server egress of
 * session-derived text passes here before it leaves: the transcript and ask websocket (`sessionws.ts`), the fleet
 * websocket's session frames and `GET /api/fleet`, the drawer (`/ws/pty/:id`'s `onData`, the one point the local
 * `attachPty` and the remote `createSpawnPty` arms share), pane history, `GET /api/feed`, `GET /api/runs/:id/items`,
 * the mail answers, `GET /api/asks`, `GET /api/ledger`, `GET /api/digest`, the notification catch-up and every
 * web-push payload (`push.ts`).
 *
 * Two halves, both on DECODED strings before serialization, never on a serialized frame:
 *   - SHAPES. Every entry of `CREDENTIAL_MASKS` (`shared/api.ts`, the one home) becomes `SECRET_MASK`. Every ECMA-48
 *     escape (CSI, OSC, DCS/SOS/PM/APC, and ESC + intermediates + final such as tmux's `ESC(B`) is read two ways,
 *     stripped (so a shape an escape splits still matches) and as a delimiter (so a shape an escape touches still
 *     has its boundary), and the union of both is masked. A cursor move to another row is a row end in both views
 *     (D-5995). A shape's boundary is a non-alphanumeric byte, a literal JSON escape (`\n` `\r` `\t`) or a
 *     percent-escape (D-5995). In ROWS mode (the drawer and pane history, where Claude Code's TUI hard-wraps a long
 *     line into indented rows) a shape that reaches the end of its row also masks the leading token run of the next
 *     row, and on through every row that run fills.
 *   - EXACT BYTES. A `compatible` key has no shape, so each lane secret has a fingerprint row (D-5996): the secret
 *     with its trailing `=` stripped, `HMAC-SHA256(box token, "ccrc-secret-fp-v1\0" ‖ that)`, and its byte length,
 *     computed on the box and stored in `secret_fingerprints` with the box-token generation it was keyed with. A
 *     candidate is a run between delimiters (two delimiter sets, a coarse and a fine one, on both views of the
 *     escapes), the same run with its leading and trailing ASCII punctuation trimmed, and in rows mode a run that
 *     ends its row joined with the next row's leading run. Only a candidate whose byte length some row holds is
 *     hashed. THE CAP FAILS CLOSED: one budget of 64 × 256 hashed candidates covers a whole frame (a `maskDeep`
 *     walk, a drawer flush); once it is spent the rest of the string is replaced by `SECRET_MASK_TOO_LARGE`, and
 *     every later string of the frame is cut at its first candidate. With no fingerprint row held there is nothing
 *     to hash against, so the pass (and its ceiling) is skipped.
 *
 * A ROTATION keeps every previous box token whose generation still has rows, in memory only, so those rows go on
 * matching; it asks for the re-keying `roster` sub, ingests the answer, and retries with backoff until the rows of
 * the current generation land (D-5995). A restart forgets the previous tokens: until the re-key lands, a compatible
 * key keyed with one is matched by nothing (the shapes still apply). That is the accepted cost of never persisting a
 * box token's history.
 *
 * This module is the one reader and writer of `secret_fingerprints`, and the table is never served. The server never
 * holds a lane secret.
 */
import { createHash, createHmac } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CREDENTIAL_MASKS, SECRET_MASK, SECRET_MASK_TOO_LARGE, type CredentialMask,
} from '../../../shared/api.js';

/** The fingerprint's domain prefix, fed to the HMAC ahead of the secret. */
export const FINGERPRINT_DOMAIN = 'ccrc-secret-fp-v1\0';
/** A candidate run's byte bounds (a fingerprint row's `len` lies within them). */
export const RUN_MIN_BYTES = 20;
export const RUN_MAX_BYTES = 8192;
/** The exact-bytes budget: 64 chunks of 256 hashed candidates (16,384) per frame. */
export const RUNS_PER_CHUNK = 256;
export const MAX_CHUNKS = 64;
/** How long the drawer holds back an open tail that could start a secret, from the FIRST hold (D-5995): under one
 *  16 ms frame, and well over the gap between the chunks of one node-pty burst. */
export const DRAWER_HOLD_MS = 8;
/** The raw text a drawer keeps from what it already sent, so a shape or a key that a chunk boundary or an expired
 *  hold split is still matched across it (D-5995). */
const DRAWER_CONTEXT = 1024;
/** The most a drawer holds back: a longer undelimited run is no fingerprint candidate (D-5995). */
const DRAWER_HELD_MAX = RUN_MAX_BYTES + 1024;
/** The re-key's backoff, and how many previous box tokens a run of rotations keeps (D-5995). */
const REKEY_FIRST_MS = 1_000;
const REKEY_MAX_MS = 600_000;
const MAX_PREVIOUS_KEYS = 4;

/** One fingerprint row as the table holds it. */
export interface FingerprintRow { readonly laneId: string; readonly fp: string; readonly gen: string }
/** One row of a box answer (D-5996): the fingerprint and the byte length of the unpadded secret. */
export interface FingerprintIn { readonly laneId: string; readonly fp: string; readonly len: number }
/** A box answer's fingerprints: the generation its token keyed them with, and the rows (D-5996). */
export interface FingerprintAnswer { readonly gen: string; readonly rows: readonly FingerprintIn[] }

export interface SecretMaskerOpts {
  /** coord.db; `null`/absent: shapes only (no table to read). */
  readonly db?: DatabaseSync | null;
  /** The current box token, read at every mask; `null`/absent: no exact-bytes check. */
  readonly token?: () => string | null;
  /** Asks the box for the re-keying `roster` sub. A promised answer is ingested; a rejection, a `null` answer, or one
   *  that does not land is retried with backoff while rows of a generation other than the current one remain. */
  readonly requestRekey?: () => Promise<FingerprintAnswer | null> | void;
  readonly now?: () => number;
  /** One line per re-key that did not land; it names the generation id only. */
  readonly log?: (line: string) => void;
}

/** The generation id a token's rows carry (D-5975): a short digest of the token under its own domain, so the box and
 *  the server derive the same id with nothing else exchanged, and no id reveals the token. */
export function fingerprintGeneration(token: string): string {
  return createHash('sha256').update('ccrc-secret-fp-gen-v1\0').update(token, 'utf8').digest('hex').slice(0, 16);
}

/** A string's fingerprint under `token`. */
export function fingerprintOf(token: string, secret: string): string {
  return createHmac('sha256', token).update(FINGERPRINT_DOMAIN, 'utf8').update(secret, 'utf8').digest('hex');
}

/** The row the box answers for one lane secret (D-5996): its trailing `=` stripped, then fingerprinted and measured. */
export function fingerprintRow(token: string, laneId: string, secret: string): FingerprintIn {
  const bare = secret.replace(/=+$/, '');
  return { laneId, fp: fingerprintOf(token, bare), len: Buffer.byteLength(bare, 'utf8') };
}

const validRow = (r: unknown): r is FingerprintIn => {
  const x = r as Partial<FingerprintIn> | null;
  return x !== null && typeof x === 'object' && typeof x.laneId === 'string' && typeof x.fp === 'string'
    && /^[0-9a-f]{64}$/.test(x.fp) && Number.isInteger(x.len) && x.len! >= RUN_MIN_BYTES && x.len! <= RUN_MAX_BYTES;
};

/** A `roster` answer's fingerprints (D-5996: `{"fingerprints": {"gen": …, "rows": [{laneId, fp, len}]}}`), or null. */
export function fingerprintAnswerOf(stdout: string): FingerprintAnswer | null {
  try {
    const f = (JSON.parse(stdout) as { fingerprints?: { gen?: unknown; rows?: unknown } } | null)?.fingerprints;
    if (f === undefined || f === null || typeof f.gen !== 'string' || !Array.isArray(f.rows)) return null;
    return { gen: f.gen, rows: f.rows.filter(validRow) };
  } catch {
    return null;
  }
}

// ── the two views of a text ────────────────────────────────────────────────

/** Every ECMA-48 escape: CSI; OSC to BEL or ST; DCS, SOS, PM and APC to ST; ESC + intermediates + final. */
const ESC_SEQ = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[ -/]*[0-~])/g;
/** A row move's stand-in (D-5995): a newline, with a NUL indent when it lands past the first column. */
function rowMove(e: string): string | null {
  const m = /^\x1b\[([0-9;]*)([HfEFdB])$/.exec(e);
  if (m !== null) {
    if (m[2] === 'H' || m[2] === 'f') return Number(m[1]!.split(';')[1] || '1') > 1 ? '\n\0' : '\n';
    return m[2] === 'E' || m[2] === 'F' ? '\n' : '\n\0';
  }
  if (e === '\x1bE') return '\n';
  if (e === '\x1bD') return '\n\0';
  return null;
}
/** A text's view with every escape stripped (`sep: ''`) or replaced by one NUL (`sep: '\0'`), a row move by its
 *  stand-in in both, and the map from each view index to its index in the original (`map[t.length]` is the
 *  original's length). */
interface View { readonly t: string; readonly map: Int32Array | null }
function viewOf(s: string, sep: '' | '\0'): View {
  if (!s.includes('\x1b')) return { t: s, map: null };   // no escape: the view is the text (the common case)
  const parts: string[] = [];
  const map = new Int32Array(s.length + 1);
  let n = 0;
  let from = 0;
  const copy = (a: number, b: number): void => {
    if (b <= a) return;
    parts.push(s.slice(a, b));
    for (let i = a; i < b; i++) map[n++] = i;
  };
  ESC_SEQ.lastIndex = 0;
  for (let m = ESC_SEQ.exec(s); m !== null; m = ESC_SEQ.exec(s)) {
    copy(from, m.index);
    const put = rowMove(m[0]) ?? sep;
    if (put !== '') parts.push(put);
    for (let k = 0; k < put.length; k++) map[n++] = m.index;
    from = m.index + m[0].length;
  }
  copy(from, s.length);
  map[n] = s.length;
  return { t: parts.join(''), map: map.subarray(0, n + 1) };
}
/** A view span [a, b) as an original span. */
const spanIn = (v: View, a: number, b: number): [number, number] =>
  (v.map === null ? [a, b] : [v.map[a]!, v.map[b - 1]! + 1]);
const origin = (v: View, i: number): number => (v.map === null ? i : v.map[i]!);

// ── shapes ─────────────────────────────────────────────────────────────────

/** A shape's left boundary (D-5995): no letter or digit before it, or a literal JSON escape, or a percent-escape. */
const BOUNDARY = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[nrt])|(?<=%[0-9A-Fa-f]{2}))`;

/** One regular expression per shape, each with its boundary (a lookbehind source keeps its own). */
export function shapeMatchers(masks: readonly CredentialMask[] = CREDENTIAL_MASKS): RegExp[] {
  return masks.map((m) => new RegExp(m.source.startsWith('(?<=') ? m.source : `${BOUNDARY}(?:${m.source})`, 'g'));
}
const SHAPES = shapeMatchers();

/** The next row's leading token run after a span that ends at its row's end: [start, end) in `t`, or null. A TUI
 *  wrap is INDENTED (Claude Code indents the rows a long line wraps into; tmux may draw that indent as a cursor move,
 *  which both views read as a NUL), so a next row with no indent is a new line, never a wrap. Sticky expressions:
 *  nothing is sliced, so a text with many matches stays linear (D-5995). */
const ROW_END = /[ \t\0]*(?:\r\n|\r|\n)/y;
const ROW_INDENT = /(?:[ \t\0]|│|┃|\|)+/y;
const TOKEN_RUN = /[A-Za-z0-9_+/.-]+/y;
const TEXT_END = /[ \t\0]*(?:\r\n|\r|\n)?$/y;
function continuationAfter(t: string, end: number): [number, number] | null {
  ROW_END.lastIndex = end;
  const nl = ROW_END.exec(t);
  return nl === null ? null : leadingRun(t, end + nl[0].length);
}
function leadingRun(t: string, from: number): [number, number] | null {
  ROW_INDENT.lastIndex = from;
  const indent = ROW_INDENT.exec(t);
  if (indent === null) return null;
  const at = from + indent[0].length;
  TOKEN_RUN.lastIndex = at;
  const run = TOKEN_RUN.exec(t);
  return run === null ? null : [at, at + run[0].length];
}
/** The row lengths of one text, from one index of its line breaks (D-5995: built once, in rows mode only). */
class Rows {
  private readonly breaks: number[] = [];
  constructor(private readonly t: string) {
    const re = /[\r\n]/g;
    for (let m = re.exec(t); m !== null; m = re.exec(t)) this.breaks.push(m.index);
  }
  /** The length of the row `i` sits on. */
  length(i: number): number {
    const b = this.breaks;
    let lo = 0; let hi = b.length;   // first break at or after i
    while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid]! < i) lo = mid + 1; else hi = mid; }
    const start = lo > 0 ? b[lo - 1]! + 1 : 0;
    const end = lo < b.length ? b[lo]! : this.t.length;
    return end - start;
  }
}

/** Every shape starts with one of these, so a text holding none of them holds no shape. */
const SHAPE_HINT = /sk-|eyJ|_token"|OPENAI_API_KEY"/;
function shapeSpans(s: string, rows: boolean, masks: readonly RegExp[]): { spans: [number, number][]; carry: boolean } {
  const spans: [number, number][] = [];
  let carry = false;
  const hasEsc = s.includes('\x1b');
  if (!SHAPE_HINT.test(hasEsc ? s.replace(ESC_SEQ, '') : s)) return { spans, carry };
  for (const sep of ['', '\0'] as const) {
    if (sep === '\0' && !hasEsc) break;   // with no escape the two views are one
    const v = viewOf(s, sep);
    const r = rows ? new Rows(v.t) : null;
    for (const re of masks) {
      re.lastIndex = 0;
      for (let m = re.exec(v.t); m !== null; m = re.exec(v.t)) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        let end = m.index + m[0].length;
        spans.push(spanIn(v, m.index, end));
        if (r === null) continue;
        // Rows mode: a shape that reaches its row's end runs on into the next row's leading run, and on through every
        // further row while the row before it was as full as the shape's own (a shorter row is the value's last).
        const full = r.length(m.index);
        for (let first = true; ; first = false) {
          if (!first && r.length(end - 1) < full) break;
          const next = continuationAfter(v.t, end);
          if (next === null) {
            TEXT_END.lastIndex = end;
            if (TEXT_END.test(v.t)) carry = true;   // the next row is in the next text
            break;
          }
          spans.push(spanIn(v, next[0], next[1]));
          end = next[1];
        }
      }
    }
  }
  return { spans, carry };
}

// ── exact bytes ────────────────────────────────────────────────────────────

/** A run's delimiters (D-5995). Never `-`: a key holds dashes. The fine set also splits paths, brackets and
 *  percent-escapes; the coarse set keeps a key that holds `/` whole. */
const COARSE = /[\s"'=:,;&}\]`\0]|\\[nrt"\\]/g;
const FINE = /[\s"'=:,;&}\]`\0/?#()<>{[|*]|\\[nrt"\\]|%[0-9A-Fa-f]{2}/g;
const PUNCT_LEAD = /^[!-/:-@[-`{-~]+/;
const PUNCT_TRAIL = /[!-/:-@[-`{-~]+$/;
/** The longest punctuation a candidate is trimmed of. */
const TRIM_MAX = 16;

/** The fail-closed start of a text's open tail (D-5995): where a shape begins in its last run (`sk-` or `eyJ` and
 *  four more characters, or an open Codex token value), or the whole run when fingerprints are held and it is long
 *  enough to be a key. An index into `t`, or null. */
const SHAPE_BEGUN = new RegExp(`${BOUNDARY}(?:sk-|eyJ)[A-Za-z0-9_.-]{4,}`);
const CODEX_VALUE_OPEN = /"(?:access_token|id_token|refresh_token|OPENAI_API_KEY)"\s*:\s*"((?:[^"\\\n]|\\.)+)$/;
const OPEN_DELIM = /[\s"'=:,;&}\]`\0]/;
function openShapeStart(t: string, fingerprints: boolean): number | null {
  const near = Math.max(0, t.length - DRAWER_HELD_MAX);
  const cx = CODEX_VALUE_OPEN.exec(t.slice(near));
  if (cx !== null) return t.length - cx[1]!.length;
  let i = t.length;
  while (i > near && !OPEN_DELIM.test(t[i - 1]!)) i--;
  const run = t.slice(i);
  if (run === '') return null;
  const sh = SHAPE_BEGUN.exec(run);
  if (sh !== null) return i + sh.index;
  return fingerprints && Buffer.byteLength(run, 'utf8') >= RUN_MIN_BYTES ? i : null;
}

interface Key { readonly gen: string; readonly token: string }
interface GenRows { readonly fps: Set<string>; readonly lens: Set<number> }
/** What one frame may still hash (D-5995). */
export interface MaskBudget { left: number }
const newBudget = (): MaskBudget => ({ left: RUNS_PER_CHUNK * MAX_CHUNKS });

export interface MaskOpts {
  /** The drawer and pane history: TUI row wraps. */
  readonly rows?: boolean;
  /** The drawer: the previous chunk ended inside a wrapped shape, so this text's leading run is its next row. */
  readonly leadingWrap?: boolean;
  /** The drawer: raw text already sent, matched with this text and never emitted again (D-5995). */
  readonly context?: string;
  /** The drawer's expired hold: mask this text's open tail from where a secret may begin (D-5995). */
  readonly failClosedTail?: boolean;
  /** The frame's shared exact-bytes budget (D-5995); absent: this string's own. */
  readonly budget?: MaskBudget;
}

/** Masks `text` for every egress of session-derived text. */
export class SecretMasker {
  private readonly db: DatabaseSync | null;
  private readonly token: () => string | null;
  private readonly requestRekey: () => Promise<FingerprintAnswer | null> | void;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** Current generation first; then every previous one whose rows are still held (D-5995). */
  private keys: Key[] = [];
  /** gen → fingerprints and byte lengths, mirrored from the table. */
  private rows = new Map<string, GenRows>();
  private rekeyTimer: ReturnType<typeof setTimeout> | null = null;
  private rekeyInFlight = false;
  private rekeyDelay = REKEY_FIRST_MS;

  constructor(opts: SecretMaskerOpts = {}) {
    this.db = opts.db ?? null;
    this.token = opts.token ?? (() => null);
    this.requestRekey = opts.requestRekey ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((line) => console.warn(line));
    this.load();
    // Rows keyed with a generation this process holds no token for (a restart after a rotation) cannot be matched:
    // the first read of the token asks for the re-key at once.
    this.syncKeys();
  }

  private load(): void {
    this.rows = new Map();
    if (this.db === null) return;
    const all = this.db.prepare('SELECT fp, gen, len FROM secret_fingerprints').all() as unknown as
      (FingerprintRow & { len: number })[];
    for (const r of all) {
      let g = this.rows.get(r.gen);
      if (g === undefined) this.rows.set(r.gen, (g = { fps: new Set(), lens: new Set() }));
      g.fps.add(r.fp);
      g.lens.add(r.len);
    }
  }

  /** Rows of a generation other than the current one are held. */
  private staleRows(): boolean {
    const cur = this.keys[0]?.gen;
    return cur !== undefined && [...this.rows.keys()].some((g) => g !== cur);
  }

  /** Follows the box token. A change keeps every previous token whose rows are held (memory only) and asks for the
   *  re-key. */
  private syncKeys(): void {
    const tok = this.token();
    if (tok === null || tok === '') return;
    const head = this.keys[0];
    if (head !== undefined && head.token === tok) return;
    const key = { gen: fingerprintGeneration(tok), token: tok };
    this.keys = [key, ...this.keys.filter((k) => k.gen !== key.gen && this.rows.has(k.gen))]
      .slice(0, 1 + MAX_PREVIOUS_KEYS);
    if (this.staleRows()) this.scheduleRekey(true);
  }

  private scheduleRekey(now: boolean): void {
    if (this.rekeyInFlight || this.rekeyTimer !== null) return;
    if (now) { this.attemptRekey(); return; }
    const delay = Math.round(this.rekeyDelay * (0.75 + Math.random() * 0.5));
    this.rekeyDelay = Math.min(this.rekeyDelay * 2, REKEY_MAX_MS);
    this.rekeyTimer = setTimeout(() => { this.rekeyTimer = null; this.attemptRekey(); }, delay);
    this.rekeyTimer.unref?.();
  }

  private attemptRekey(): void {
    if (!this.staleRows()) { this.rekeyDelay = REKEY_FIRST_MS; return; }
    let answer: Promise<FingerprintAnswer | null> | void;
    try { answer = this.requestRekey(); } catch { answer = undefined; }
    if (answer === undefined || typeof (answer as Promise<unknown>).then !== 'function') {
      this.scheduleRekey(false);
      return;
    }
    this.rekeyInFlight = true;
    const settle = (a: FingerprintAnswer | null): void => {
      this.rekeyInFlight = false;
      let landed = false;
      try { landed = a !== null && this.ingest(a); } catch { landed = false; }
      if (landed && !this.staleRows()) { this.rekeyDelay = REKEY_FIRST_MS; return; }
      this.log(`[mask] the re-key for generation ${this.keys[0]?.gen ?? '-'} has not landed; retrying`);
      this.scheduleRekey(false);
    };
    (answer as Promise<FingerprintAnswer | null>).then(settle, () => settle(null));
  }

  /** Stops the re-key retries (a test, or a server closing). */
  close(): void {
    if (this.rekeyTimer !== null) clearTimeout(this.rekeyTimer);
    this.rekeyTimer = null;
  }

  /** Writes the CURRENT generation's fingerprints (A12's `reloadRoster` calls it with every answer's
   *  `fingerprints`, and the re-key lands here). An answer keyed with any other generation is refused and changes
   *  nothing (D-5995). Rows of every other generation are deleted in the same transaction, and the previous tokens
   *  are forgotten. True: it landed. */
  ingest(answer: FingerprintAnswer): boolean {
    this.syncKeys();
    const cur = this.keys[0];
    if (cur === undefined || this.db === null || answer.gen !== cur.gen) return false;
    const at = this.now();
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Every other generation's rows go; each lane named here has its current rows replaced by this answer's.
      db.prepare('DELETE FROM secret_fingerprints WHERE gen <> ?').run(cur.gen);
      const del = db.prepare('DELETE FROM secret_fingerprints WHERE gen = ? AND laneId = ?');
      const ins = db.prepare('INSERT OR REPLACE INTO secret_fingerprints (laneId, fp, gen, len, at) VALUES (?, ?, ?, ?, ?)');
      for (const lane of new Set(answer.rows.map((r) => r.laneId))) del.run(cur.gen, lane);
      for (const r of answer.rows) if (validRow(r)) ins.run(r.laneId, r.fp, cur.gen, r.len, at);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    this.keys = [cur];
    this.load();
    return true;
  }

  /** The keys whose generation has rows to match. */
  private liveKeys(): { key: Key; fps: Set<string>; lens: Set<number> }[] {
    const out: { key: Key; fps: Set<string>; lens: Set<number> }[] = [];
    for (const key of this.keys) {
      const g = this.rows.get(key.gen);
      if (g !== undefined && g.fps.size > 0) out.push({ key, fps: g.fps, lens: g.lens });
    }
    return out;
  }

  /** Whether any fingerprint row can be matched (the drawer holds every open run while one can). */
  hasFingerprints(): boolean {
    this.syncKeys();
    return this.liveKeys().length > 0;
  }

  /** Every exact-bytes span, and the original index the budget cuts at (null: within it). */
  private fingerprintSpans(s: string, rows: boolean, budget: MaskBudget): { spans: [number, number][]; cut: number | null } {
    const live = this.liveKeys();
    if (live.length === 0) return { spans: [], cut: null };
    const lens = new Set<number>();
    for (const l of live) for (const n of l.lens) lens.add(n);
    const minLen = Math.min(...lens);
    const maxLen = Math.max(...lens);
    const cands = new Map<string, { at: number; spans: [number, number][] }>();
    const consider = (v: View, pieces: readonly [number, number][]): void => {
      let n = 0;
      for (const [a, b] of pieces) n += b - a;
      if (n > maxLen || n * 3 < minLen) return;
      const text = pieces.map(([a, b]) => v.t.slice(a, b)).join('');
      if (!lens.has(Buffer.byteLength(text, 'utf8'))) return;
      const spans = pieces.map(([a, b]) => spanIn(v, a, b));
      const c = cands.get(text);
      if (c === undefined) cands.set(text, { at: spans[0]![0], spans });
      else { c.spans.push(...spans); c.at = Math.min(c.at, spans[0]![0]); }
    };
    const trims = (t: string, a: number, b: number): [number, number][] => {
      const run = t.slice(a, b);
      const l = Math.min(PUNCT_LEAD.exec(run)?.[0].length ?? 0, TRIM_MAX);
      const r = Math.min(PUNCT_TRAIL.exec(run)?.[0].length ?? 0, TRIM_MAX);
      const out: [number, number][] = [[a, b]];
      if (l > 0 && a + l < b) out.push([a + l, b]);
      if (r > 0 && a < b - r) out.push([a, b - r]);
      if (l > 0 && r > 0 && a + l < b - r) out.push([a + l, b - r]);
      return out;
    };
    const views = [viewOf(s, '\0')];
    if (s.includes('\x1b')) views.push(viewOf(s, ''));
    for (const v of views) {
      for (const delim of [COARSE, FINE]) {
        const runs: [number, number][] = [];
        delim.lastIndex = 0;
        let from = 0;
        for (let m = delim.exec(v.t); m !== null; m = delim.exec(v.t)) {
          if (m.index > from) runs.push([from, m.index]);
          from = m.index + m[0].length;
        }
        if (v.t.length > from) runs.push([from, v.t.length]);
        for (const [a, b] of runs) {
          if (b - a <= maxLen + 2 * TRIM_MAX) for (const p of trims(v.t, a, b)) consider(v, [p]);
          if (!rows) continue;
          // A run that ends its row, joined with the next row's leading run: a key the TUI wrapped.
          const next = continuationAfter(v.t, b) ?? (() => {
            ROW_END.lastIndex = b;
            const nl = ROW_END.exec(v.t);
            if (nl === null) return null;
            TOKEN_RUN.lastIndex = b + nl[0].length;
            const run = TOKEN_RUN.exec(v.t);
            return run === null ? null : [b + nl[0].length, b + nl[0].length + run[0].length] as [number, number];
          })();
          if (next === null) continue;
          const head = trims(v.t, a, b).filter(([x, y]) => y === b && y - x <= maxLen);
          const tail = trims(v.t, next[0], next[1]).filter(([x]) => x === next[0]);
          for (const h of head) for (const tl of tail) consider(v, [h, tl]);
        }
      }
    }
    const spans: [number, number][] = [];
    for (const [text, c] of [...cands.entries()].sort((x, y) => x[1].at - y[1].at)) {
      if (budget.left <= 0) return { spans, cut: c.at };
      budget.left--;
      if (live.some(({ key, fps }) => fps.has(fingerprintOf(key.token, text)))) spans.push(...c.spans);
    }
    return { spans, cut: null };
  }

  /** `text` masked, and whether a shape ran to its text's last row (the drawer carries it into the next chunk). */
  maskWithCarry(text: string, opts: MaskOpts = {}): { text: string; carry: boolean } {
    if (text === '') return { text, carry: opts.leadingWrap === true };
    this.syncKeys();
    const rows = opts.rows === true;
    const ctx = opts.context ?? '';
    const full = ctx + text;
    const off = ctx.length;
    const spans: [number, number][] = [];
    /** Full-text spans, as spans of `text`: a span wholly in the context was sent masked already. */
    const clip = (list: readonly [number, number][]): void => {
      for (const [a, b] of list) if (b > off) spans.push([Math.max(a, off) - off, b - off]);
    };
    const shapes = shapeSpans(full, rows, SHAPES);
    clip(shapes.spans);
    if (rows && opts.leadingWrap === true) {
      const v = viewOf(text, '\0');
      const lead = /^(?:\r\n|\r|\n)?/.exec(v.t)![0].length;
      const first = leadingRun(v.t, lead);
      if (first !== null) spans.push(spanIn(v, first[0], first[1]));
    }
    const fp = this.fingerprintSpans(full, rows, opts.budget ?? newBudget());
    clip(fp.spans);
    if (opts.failClosedTail === true) {
      const v = viewOf(full, '\0');
      const p = openShapeStart(v.t, this.liveKeys().length > 0);
      if (p !== null) clip([[origin(v, p), full.length]]);
    }
    const limit = fp.cut === null ? text.length : Math.max(0, fp.cut - off);
    spans.sort((x, y) => x[0] - y[0]);
    // Parts joined once (D-5995): appending to a string and testing its end on every span flattens it each time.
    const out: string[] = []; let at = 0; let masked = false;
    for (const [a0, b0] of spans) {
      if (a0 >= limit) break;
      const a = Math.max(a0, at); const b = Math.min(b0, limit);
      if (b <= at) continue;
      if (a > at) { out.push(text.slice(at, a)); masked = false; }
      if (!masked) { out.push(SECRET_MASK); masked = true; }
      at = b;
    }
    if (at < limit) out.push(text.slice(at, limit));
    if (fp.cut !== null) out.push(SECRET_MASK_TOO_LARGE);
    return { text: out.join(''), carry: fp.cut === null && shapes.carry };
  }

  /** One string, masked. `rows`: the drawer and pane history (TUI row wraps). */
  maskText(text: string, opts: { rows?: boolean } = {}): string {
    return this.maskWithCarry(text, opts).text;
  }

  /** A structured answer or frame with every string field masked, before it is serialized, under ONE exact-bytes
   *  budget (D-5995). A copy: the input (which a caller may hold or cache) is never mutated. */
  maskDeep<T>(value: T): T {
    return this.walk(value, newBudget()) as T;
  }

  private walk(v: unknown, budget: MaskBudget): unknown {
    if (typeof v === 'string') return this.maskWithCarry(v, { budget }).text;
    if (Array.isArray(v)) return v.map((x) => this.walk(x, budget));
    if (v !== null && typeof v === 'object') {
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Date) return v;   // bytes or a time
      // Anything else serializes through `toJSON` or its own enumerable fields, so those are walked (D-5995): a class
      // instance is never passed through unmasked.
      const toJSON = (v as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') return this.walk((toJSON as () => unknown).call(v), budget);
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = this.walk(x, budget);
      return out;
    }
    return v;
  }

  /** A drawer's per-connection streamer over this masker. */
  drawer(emit: (text: string) => void, holdMs: number = DRAWER_HOLD_MS): DrawerMask {
    return new DrawerMask(this, emit, holdMs);
  }
}

/** The last run could be the start of a shape (D-5995): it holds `sk-` or `eyJ` at a boundary, or ends in a prefix
 *  of one, or in a half-read boundary escape. */
const SHAPE_STARTED = new RegExp(`${BOUNDARY}(?:sk-|eyJ)`);
const SHAPE_PREFIX_END = new RegExp(`${BOUNDARY}(?:s|sk|e|ey)$|\\\\[nrt]?$|%[0-9A-Fa-f]?$`);
const CODEX_NAMES = ['access_token', 'id_token', 'refresh_token', 'OPENAI_API_KEY'];
const CODEX_OPEN =
  /^"(?:([A-Za-z_]*)|(?:access_token|id_token|refresh_token|OPENAI_API_KEY)"\s*(?::\s*(?:"(?:[^"\\\n]|\\.)*\\?)?)?)$/;
/** Where an unfinished Codex token field (its name, its colon or its open value) begins in `t`, or null. */
function codexOpenAt(t: string): number | null {
  let q = t.length;
  for (let k = 0; k < 3; k++) {
    q = t.lastIndexOf('"', q - 1);
    if (q < 0 || t.length - q > DRAWER_HELD_MAX) return null;
    const m = CODEX_OPEN.exec(t.slice(q));
    if (m !== null && (m[1] === undefined || CODEX_NAMES.some((n) => n.startsWith(m[1]!)))) return q;
  }
  return null;
}

/** Where a drawer chunk's open tail begins: an unfinished escape, a run that could start a secret (any run while
 *  fingerprints are held), or an unfinished Codex token field. `null`: that tail is longer than a drawer holds. Only
 *  the end of the text is scanned (D-5995). */
function openTailAt(s: string, fingerprints: boolean): number | null {
  const base = Math.max(0, s.length - (DRAWER_HELD_MAX + 64));
  const w = s.slice(base);
  const esc = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*|[PX^_][^\x1b]*|[ -/]*)?$/.exec(w);
  const bodyEnd = esc === null ? w.length : esc.index;
  const v = viewOf(w.slice(0, bodyEnd), '\0');
  let i = v.t.length;
  while (i > 0 && !OPEN_DELIM.test(v.t[i - 1]!)) i--;
  const run = v.t.slice(i);
  let hold: number | null = run !== '' && (fingerprints || SHAPE_STARTED.test(run) || SHAPE_PREFIX_END.test(run)) ? i : null;
  const cx = codexOpenAt(v.t);
  if (cx !== null && (hold === null || cx < hold)) hold = cx;
  if (hold === 0 && base > 0) return null;
  return base + (hold === null ? bodyEnd : origin(v, hold));
}

/** The drawer is a byte stream: a chunk whose tail could start a secret holds that tail back until the next chunk
 *  or `holdMs` after the first hold, so a secret split across two chunks is still masked; every other chunk goes at
 *  once. What was sent stays as context for the next chunk, and an expired hold fails closed on a begun secret
 *  (D-5995). */
export class DrawerMask {
  private held = '';
  private carry = false;
  private ctx = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly masker: SecretMasker, private readonly emit: (text: string) => void,
    private readonly holdMs: number) {}

  push(chunk: string): void {
    const s = this.held + chunk;
    this.held = '';
    const cut = openTailAt(s, this.masker.hasFingerprints());
    if (cut === null) {   // an open tail past the bound: sent now, failing closed on a begun secret
      this.stopTimer();
      this.out(s, true);
      return;
    }
    if (cut > 0) this.out(s.slice(0, cut), false);
    if (cut < s.length) {
      this.held = s.slice(cut);
      if (this.timer === null) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.holdMs);
    } else {
      this.stopTimer();
    }
  }

  /** Sends whatever is held, failing closed on a secret it begins. */
  flush(): void {
    this.stopTimer();
    if (this.held === '') return;
    const h = this.held;
    this.held = '';
    this.out(h, true);
  }

  dispose(): void {
    this.stopTimer();
    this.held = '';
    this.ctx = '';
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private out(text: string, failClosedTail: boolean): void {
    const r = this.masker.maskWithCarry(text, { rows: true, leadingWrap: this.carry, context: this.ctx, failClosedTail });
    this.carry = r.carry;
    this.ctx = (this.ctx + text).slice(-DRAWER_CONTEXT);
    this.emit(r.text);
  }
}

/** The masker every egress falls back to when none is wired: the shapes, with no table and no token. */
export const SHAPE_ONLY_MASKER = new SecretMasker();
