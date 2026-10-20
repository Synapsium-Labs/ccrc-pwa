/**
 * THE EGRESS MASK (D-5513, accounts-connect spec 2026-10-18 §3.3, plan Task A10; G31). Every server egress of
 * session-derived text passes here before it leaves: the transcript and ask websocket (`sessionws.ts`), the fleet
 * websocket's session frames and `GET /api/fleet`, the drawer (`/ws/pty/:id`'s `onData`, the one point the local
 * `attachPty` and the remote `createSpawnPty` arms share), pane history (in slices), `GET /api/feed`,
 * `GET /api/runs/:id/items`, the mail answers, `GET /api/asks`, `GET /api/ledger`, `GET /api/digest`, the other GET
 * routes the egress inventory lists, every write route's answer (one hook), the notification catch-up and every
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
 *     ends its row joined with the next row's leading run. Only a candidate whose byte length some row holds counts,
 *     and the search for one is linear in the text: a fine run is searched only inside its coarse run (D-5995). THE CAP FAILS CLOSED: one budget of 32 × 256 candidate RUNS, each
 *     checked under every live key, covers a whole frame (a `maskDeep` walk, a drawer flush); once it is spent the
 *     rest of the string is replaced by `SECRET_MASK_TOO_LARGE`, and every later string of the frame is cut at its
 *     first candidate, read no further. That bounds a frame's hashing at about 20 ms (D-5995). With no fingerprint row
 *     held there is nothing to hash against, so the pass (and its ceiling) is skipped.
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
import { createHash, createHmac, type Hash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CREDENTIAL_MASKS, SECRET_MASK, SECRET_MASK_TOO_LARGE, type CredentialMask,
} from '../../../shared/api.js';

/** The fingerprint's domain prefix, fed to the HMAC ahead of the secret. */
export const FINGERPRINT_DOMAIN = 'ccrc-secret-fp-v1\0';
/** A candidate run's byte bounds (a fingerprint row's `len` lies within them). */
export const RUN_MIN_BYTES = 20;
export const RUN_MAX_BYTES = 8192;
/** The exact-bytes budget: 32 chunks of 256 candidate runs (8,192) per frame, each checked under every live key
 *  (D-5995: 16,384 cost a frame past the 25 ms bound). */
export const RUNS_PER_CHUNK = 256;
export const MAX_CHUNKS = 32;
/** How long the drawer holds back an open tail that could start a secret, from the FIRST hold (D-5995): well over the
 *  gap between the chunks of one node-pty burst. 6 ms, so the echo latency it adds, with the 1 to 3 ms late a Node
 *  timer fires, stays within the 8 ms bound measured through a real tmux attach. */
export const DRAWER_HOLD_MS = 6;
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
  if (e.length === 2) return e === '\x1bE' ? '\n' : e === '\x1bD' ? '\n\0' : null;
  if (e[1] !== '[' || !'HfEFdB'.includes(e[e.length - 1]!)) return null;   // the common escape: no regex (D-5995)
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
/** The last text's two views: one mask reads the same text's views in several passes (D-5995). */
let viewMemo: { s: string; v: [View | null, View | null] } = { s: '', v: [null, null] };
function viewOf(s: string, sep: '' | '\0'): View {
  if (!s.includes('\x1b')) return { t: s, map: null };   // no escape: the view is the text (the common case)
  if (viewMemo.s !== s) viewMemo = { s, v: [null, null] };
  const k = sep === '' ? 0 : 1;
  return viewMemo.v[k] ??= buildView(s, sep);
}
function buildView(s: string, sep: '' | '\0'): View {
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

/** A shape's left boundary (D-5995): no letter or digit before it, or a literal JSON escape (`\n` `\r` `\t`, a
 *  `\uXXXX`), a `\xXX` escape, or a percent-escape. */
const BOUNDARY = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[nrt])|(?<=\\u[0-9A-Fa-f]{4})|(?<=\\x[0-9A-Fa-f]{2})|(?<=%[0-9A-Fa-f]{2}))`;

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

/** A run's characters (D-5995): anything but a delimiter. Never `-`: a key holds dashes. The coarse set keeps a key
 *  that holds `/` whole; the fine set also splits paths, brackets and percent-escapes. The JSON escapes `\n` `\r`
 *  `\t` `\"` `\\` delimit in both. */
const RUN_CHAR_COARSE = String.raw`(?:[^\s"'=:,;&}\]\`\0\\]|\\(?![nrt"\\]))`;
const RUN_CHAR_FINE = String.raw`(?:[^\s"'=:,;&}\]\`\0\\/?#()<>{[|*%]|\\(?![nrt"\\])|%(?![0-9A-Fa-f]{2}))`;
/** Where a run may start (D-5995): after a delimiter, after a JSON escape or a percent-escape, or at the text's
 *  start, and never on an escape's second byte. Testing the byte before is what keeps the search linear: the engine
 *  tries only a run's first byte, never every byte inside it. */
const runStart = (fine: boolean): string => {
  const delims = fine ? String.raw`\s"'=:,;&}\]\`\0/?#()<>{[|*` : String.raw`\s"'=:,;&}\]\`\0`;
  return String.raw`(?:(?<![^${delims}\\])(?<!(?<!\\)\\)|(?<=(?<!\\)\\[nrt"\\])${fine ? String.raw`|(?<=%[0-9A-Fa-f]{2})` : ''})`;
};
const runExprs = new Map<string, RegExp>();
/** The runs of at least `min` units, leftmost first: a shorter run is skipped inside the expression engine. */
function runExpr(fine: boolean, min: number): RegExp {
  const k = `${fine ? 'f' : 'c'}${min}`;
  let re = runExprs.get(k);
  if (re === undefined) runExprs.set(k, (re = new RegExp(`${runStart(fine)}${fine ? RUN_CHAR_FINE : RUN_CHAR_COARSE}{${Math.max(1, min)},}`, 'g')));
  return re;
}
const DELIM_COARSE = /[\s"'=:,;&}\]`\0]/;
const DELIM_FINE = /[\s"'=:,;&}\]`\0/?#()<>{[|*]/;
const HEX = /[0-9A-Fa-f]/;
/** A byte only the fine set delimits on. */
const FINE_ONLY = /[/?#()<>{[|*%]/;
/** Where the run that ends at `e` starts, read back at most `max` units (D-5995). */
/** Each ASCII byte's class for a read back (D-5995): 1 a coarse (and fine) delimiter, 2 a fine-only delimiter, 4 a
 *  JSON escape's second byte, 8 a hex digit, 16 `%`; so a read back costs no regular expression. */
const BYTE_CLASS = (() => {
  const tab = new Uint8Array(128);
  for (let c = 0; c < 128; c++) {
    const ch = String.fromCharCode(c);
    if (DELIM_COARSE.test(ch)) tab[c] = 1; else if (DELIM_FINE.test(ch)) tab[c] = 2;
    if ('nrt"\\'.includes(ch)) tab[c] = tab[c]! | 4;
    if (HEX.test(ch)) tab[c] = tab[c]! | 8;
    if (ch === '%') tab[c] = tab[c]! | 16;
  }
  return tab;
})();
const isHex = (t: string, i: number): boolean => { const c = t.charCodeAt(i); return c < 128 && (BYTE_CLASS[c]! & 8) !== 0; };
function runStartBefore(t: string, e: number, fine: boolean, max: number): number {
  const delim = fine ? DELIM_FINE : DELIM_COARSE;
  let i = e;
  while (i > 0 && e - i < max) {
    const code = t.charCodeAt(i - 1);
    if (code >= 128) { if (delim.test(t[i - 1]!)) break; i--; continue; }
    const k = BYTE_CLASS[code]!;
    if ((k & 1) !== 0 || (fine && (k & 2) !== 0)) break;
    if ((k & 4) !== 0 && i >= 2 && t.charCodeAt(i - 2) === 0x5c && !(i >= 3 && t.charCodeAt(i - 3) === 0x5c)) break;   // a JSON escape
    if (fine && (k & 8) !== 0 && i >= 3 && t.charCodeAt(i - 3) === 0x25 && isHex(t, i - 2)) break;                  // a percent-escape
    if (fine && (k & 16) !== 0 && i + 1 < t.length && isHex(t, i) && isHex(t, i + 1)) break;
    i--;
  }
  return i;
}
const LINE_BREAK = /\r\n|\r|\n/g;
const ROW_INDENT_OPT = /(?:[ \t\0]|│|┃|\|)*/y;

/** One key's HMAC with its padded key blocks hashed once (D-5995): the same digest as `fingerprintOf`. */
class FpHasher {
  private readonly inner: Hash;
  private readonly outer: Hash;
  constructor(token: string) {
    let k = Buffer.from(token, 'utf8');
    if (k.length > 64) k = createHash('sha256').update(k).digest();
    const block = Buffer.alloc(64);
    k.copy(block);
    this.inner = createHash('sha256').update(block.map((b) => b ^ 0x36)).update(FINGERPRINT_DOMAIN, 'utf8');
    this.outer = createHash('sha256').update(block.map((b) => b ^ 0x5c));
  }
  of(text: string): string {
    return this.outer.copy().update(this.inner.copy().update(text, 'utf8').digest()).digest('hex');
  }
}
const hashers = new WeakMap<object, FpHasher>();
function hasherOf(key: { readonly token: string }): FpHasher {
  let h = hashers.get(key);
  if (h === undefined) hashers.set(key, (h = new FpHasher(key.token)));
  return h;
}
/** ASCII punctuation (`[!-/:-@[-\`{-~]`), the bytes a candidate is trimmed of. */
const isPunct = (c: number): boolean => (c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60)
  || (c >= 0x7b && c <= 0x7e);
/** The longest punctuation a candidate is trimmed of. */
const TRIM_MAX = 16;

/** The fail-closed start of a text's open tail (D-5995): an open Codex token value, `sk-` or `eyJ` at a boundary in
 *  its last run (a shape's prefix), or, while fingerprints are held (`fpMax`: the longest held byte length), a last run
 *  of `floor` bytes or more that could still be one. Nothing else: an ordinary run is never masked for being open. An
 *  index into `t`, or null. The floor is 20 for a run typed key by key (a keystroke's echo is never delayed, ruling a)
 *  and 1 for a run a burst of output left open (a key a chunk boundary split shows none of its bytes). */
const SHAPE_STARTED = new RegExp(`${BOUNDARY}(?:sk-|eyJ)`);
const CODEX_VALUE_OPEN = /"(?:access_token|id_token|refresh_token|OPENAI_API_KEY)"\s*:\s*"((?:[^"\\\n]|\\.)*)$/;
const OPEN_DELIM = /[\s"'=:,;&}\]`\0]/;
function failClosedStart(t: string, fpMax: number | null, floor = RUN_MIN_BYTES): number | null {
  const near = Math.max(0, t.length - DRAWER_HELD_MAX);
  if (t.lastIndexOf('"') >= near) {
    const cx = CODEX_VALUE_OPEN.exec(t.slice(near));
    if (cx !== null) return cx[1] === '' ? null : t.length - cx[1]!.length;
  }
  let i = t.length;
  while (i > near && !OPEN_DELIM.test(t[i - 1]!)) i--;
  const run = t.slice(i);
  if (run === '') return null;
  const sh = SHAPE_STARTED.exec(run);
  if (sh !== null) return i + sh.index;
  if (fpMax === null) return null;
  const n = Buffer.byteLength(run, 'utf8');
  return n >= floor && n <= fpMax + TRIM_MAX ? i : null;
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
  /** The drawer: the previous text ended in a fail-closed mask past what a drawer holds, so this text's leading run
   *  continues it and is masked, indent or not (D-5995). */
  readonly leadingTaint?: boolean;
  /** The drawer's expired hold: mask this text's open tail from where a secret may begin (D-5995). */
  readonly failClosedTail?: boolean;
  /** The frame's shared exact-bytes budget (D-5995); absent: this string's own. */
  readonly budget?: MaskBudget;
  /** A sliced mask (pane history): raw text that follows this text, matched with it and never emitted (D-5995). */
  readonly lookahead?: string;
}

/** A sliced mask's slice and the raw overlap read on each side of it (D-5995): one slice of pane history costs a few
 *  milliseconds, and the overlap is what a drawer holds, so a key or a wrapped shape a cut splits is matched whole. */
const SLICE_UNITS = 64 * 1024;
const SLICE_OVERLAP = DRAWER_HELD_MAX;

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

  /** The longest byte length a held fingerprint row can match, or null: none can be matched (the shape-only mode).
   *  The drawer holds every open run while one can. */
  fingerprintMax(): number | null {
    this.syncKeys();
    let max: number | null = null;
    for (const l of this.liveKeys()) for (const n of l.lens) if (max === null || n > max) max = n;
    return max;
  }

  /** Every exact-bytes span, and the original index the budget cuts at (null: within it). Linear in the text: a run
   *  is found by an expression that skips every run too short to be a candidate, a row join is read back from each
   *  line break, and each pass stops once it has seen more distinct candidates than the budget has left (D-5995).
   *  Stopping there loses nothing: the cut lies at or before that pass's last candidate, so every occurrence ahead of
   *  the cut (a matched key's repeats included) is collected. */
  private fingerprintSpans(s: string, rows: boolean, budget: MaskBudget): { spans: [number, number][]; cut: number | null } {
    const live = this.liveKeys();
    if (live.length === 0) return { spans: [], cut: null };
    const lens = new Set<number>();
    for (const l of live) for (const n of l.lens) lens.add(n);
    let minLen = Infinity; let maxLen = 0;
    for (const n of lens) { if (n < minLen) minLen = n; if (n > maxLen) maxLen = n; }
    // A candidate of n bytes holds at least n/3 UTF-16 units (exactly n in an ASCII text).
    const ascii = /^[\x00-\x7f]*$/.test(s);
    const minUnits = ascii ? minLen : Math.ceil(minLen / 3);
    /** The candidate runs one frame may still check, each under every live key: the budget counts RUNS (D-5995), so a
     *  text that repeats a few runs many times is bounded like one that never repeats. A pass stops past one more. */
    const cap = Math.floor(Math.max(0, budget.left) / live.length);
    const limit = cap + 1;
    /** Every distinct candidate occurrence (by its original span), and its text. */
    const occ = new Map<string, { at: number; text: string; spans: [number, number][] }>();
    let seen = 0;
    /** Records one candidate occurrence, counting the new ones of this pass in `seen`. */
    const consider = (v: View, pieces: readonly [number, number][]): void => {
      let n = 0;
      for (const [a, b] of pieces) n += b - a;
      if (n > maxLen || n * 3 < minLen || (ascii && !lens.has(n))) return;
      const text = pieces.length === 1 ? v.t.slice(pieces[0]![0], pieces[0]![1]) : pieces.map(([a, b]) => v.t.slice(a, b)).join('');
      if (!lens.has(ascii ? text.length : Buffer.byteLength(text, 'utf8'))) return;
      const spans = pieces.map(([a, b]) => spanIn(v, a, b));
      const id = spans.map(([a, b]) => `${a},${b}`).join(';');
      if (occ.has(id)) return;
      occ.set(id, { at: spans[0]![0], text, spans });
      seen++;
    };
    /** A run and its punctuation trims (`lead`/`trail`: that end may be trimmed). In an ASCII text every depth of
     *  each trim is tried (D-5995: a key that itself ends in `_` or `-`, then a `.`, is found with its own last byte),
     *  which costs nothing past the length prefilter; otherwise the whole punctuation run of each end. */
    const trims = (t: string, a: number, b: number, lead = true, trail = true): [number, number][] => {
      let l = 0; if (lead) while (l < TRIM_MAX && a + l < b && isPunct(t.charCodeAt(a + l))) l++;
      let r = 0; if (trail) while (r < TRIM_MAX && b - r > a && isPunct(t.charCodeAt(b - r - 1))) r++;
      if (l === 0 && r === 0) return [[a, b]];
      const out: [number, number][] = [];
      for (let x = 0; x <= l; x = ascii || x === l ? x + 1 : l) {
        for (let y = 0; y <= r; y = ascii || y === r ? y + 1 : r) if (a + x < b - y) out.push([a + x, b - y]);
      }
      return out;
    };
    const views = [viewOf(s, '\0')];
    if (s.includes('\x1b')) views.push(viewOf(s, ''));
    const longest = maxLen + 2 * TRIM_MAX;
    const coarse = runExpr(false, minUnits);
    const fine = runExpr(true, minUnits);
    for (const v of views) {
      const t = v.t;
      // The coarse runs long enough to hold a candidate, in order; inside one that holds a fine delimiter, its fine
      // runs too (a fine run never crosses a coarse delimiter). The limit is read only between runs, so every
      // candidate not yet seen starts after every one seen.
      seen = 0;
      coarse.lastIndex = 0;
      for (let m = coarse.exec(t); m !== null && seen < limit; m = coarse.exec(t)) {
        const a = m.index; const b = a + m[0].length;
        if (b - a <= longest) for (const p of trims(t, a, b)) consider(v, [p]);
        if (!FINE_ONLY.test(m[0])) continue;
        // The fine runs are searched inside the coarse run only, never past it (D-5995): searching the whole text from
        // `a` costs the rest of the text for every coarse run with no long fine run, quadratic on a path listing. The
        // run's own start is a run start, so its slice yields the same runs.
        const sub = m[0];
        fine.lastIndex = 0;
        for (let f = fine.exec(sub); f !== null; f = fine.exec(sub)) {
          const fa = a + f.index; const fb = fa + f[0].length;
          if (fb - fa <= longest) for (const p of trims(t, fa, fb)) consider(v, [p]);
        }
        coarse.lastIndex = b;
      }
      if (!rows) continue;
      // A run that ends its row, joined with the next row's leading run: a key the TUI wrapped. One read back gives
      // the fine run's start and, read on from there, the coarse run's (D-5995: the same starts as two reads).
      seen = 0;
      LINE_BREAK.lastIndex = 0;
      for (let m = LINE_BREAK.exec(t); m !== null && seen < limit; m = LINE_BREAK.exec(t)) {
        let e = m.index;
        while (e > 0 && (t[e - 1] === ' ' || t[e - 1] === '\t' || t[e - 1] === '\0')) e--;
        const aFine = runStartBefore(t, e, true, longest + 1);
        if (e - aFine > longest) continue;
        const aCoarse = runStartBefore(t, aFine, false, longest + 1 - (e - aFine));
        if (aCoarse === e) continue;
        const after = m.index + m[0].length;
        ROW_INDENT_OPT.lastIndex = after;
        const at = after + ROW_INDENT_OPT.exec(t)![0].length;
        TOKEN_RUN.lastIndex = at;
        const run = TOKEN_RUN.exec(t);
        if (run === null) continue;
        const next: [number, number] = [at, at + run[0].length];
        const tail = trims(t, next[0], next[1], false, true);
        for (const a of aCoarse === aFine ? [aFine] : [aCoarse, aFine]) {
          if (a === e || e - a > longest || (e - a) + (next[1] - next[0]) - 2 * TRIM_MAX > maxLen) continue;
          const head = trims(t, a, e, true, false).filter(([x, y]) => y - x <= maxLen);
          for (const h of head) for (const tl of tail) consider(v, [h, tl]);
        }
      }
    }
    const all = [...occ.values()].sort((x, y) => x.at - y.at);
    const cut = all.length > cap ? all[cap]!.at : null;
    const kept = cut === null ? all : all.slice(0, cap);
    budget.left = cut === null ? budget.left - kept.length * live.length : 0;
    const verdict = new Map<string, boolean>();
    const spans: [number, number][] = [];
    for (const o of kept) {
      let hit = verdict.get(o.text);
      if (hit === undefined) verdict.set(o.text, (hit = live.some(({ key, fps }) => fps.has(hasherOf(key).of(o.text)))));
      if (hit) spans.push(...o.spans);
    }
    if (cut !== null) return { spans, cut };
    return { spans, cut: null };
  }

  /** Where the first exact-bytes candidate of `s` can start (at or before it), or null: `s` holds none. Only the text
   *  ahead of the first escape is read, where both views are the text itself; a candidate that an escape could join
   *  starts no later than the run before that escape (D-5995: a spent frame's later strings cost no views). */
  private firstCandidate(s: string, rows: boolean): number | null {
    const live = this.liveKeys();
    if (live.length === 0) return null;
    let minLen = Infinity;
    for (const l of live) for (const n of l.lens) if (n < minLen) minLen = n;
    const esc = s.indexOf('\x1b');
    const t = esc < 0 ? s : s.slice(0, esc);
    let best: number | null = esc < 0 ? null : runStartBefore(t, t.length, false, Infinity);
    const re = runExpr(false, Math.ceil(minLen / 3));
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m !== null) best = Math.min(best ?? Infinity, m.index);
    if (!rows) return best;
    LINE_BREAK.lastIndex = 0;
    for (let b = LINE_BREAK.exec(t); b !== null; b = LINE_BREAK.exec(t)) {
      if (best !== null && b.index >= best) break;
      let e = b.index;
      while (e > 0 && (t[e - 1] === ' ' || t[e - 1] === '\t' || t[e - 1] === '\0')) e--;
      const a = runStartBefore(t, e, false, Infinity);
      if (a < e) { best = Math.min(best ?? Infinity, a); break; }
    }
    return best;
  }

  /** `text` masked, and whether a shape ran to its text's last row (the drawer carries it into the next chunk). */
  maskWithCarry(text: string, opts: MaskOpts = {}): { text: string; carry: boolean; cut: boolean } {
    if (text === '') return { text, carry: opts.leadingWrap === true, cut: false };
    this.syncKeys();
    const rows = opts.rows === true;
    const ctx = opts.context ?? '';
    const budget = opts.budget ?? newBudget();
    // A frame whose budget is spent cuts each later string at its first candidate: only the text ahead of it is read
    // (D-5995), so a frame of many long strings costs what its first strings cost.
    const spent = budget.left <= 0 ? this.firstCandidate(ctx + text, rows) : null;
    const full = spent === null ? ctx + text + (opts.lookahead ?? '') : (ctx + text).slice(0, Math.max(spent, ctx.length));
    const off = ctx.length;
    const spans: [number, number][] = [];
    /** Full-text spans, as spans of `text`: a span wholly in the context was sent masked already. */
    const clip = (list: readonly [number, number][]): void => {
      for (const [a, b] of list) if (b > off) spans.push([Math.max(a, off) - off, b - off]);
    };
    const shapes = shapeSpans(full, rows, SHAPES);
    clip(shapes.spans);
    if (opts.leadingTaint === true) {
      const v = viewOf(text, '\0');
      let k = 0;
      while (k < v.t.length && !OPEN_DELIM.test(v.t[k]!)) k++;
      if (k > 0) spans.push(spanIn(v, 0, k));
    }
    if (rows && opts.leadingWrap === true) {
      const v = viewOf(text, '\0');
      const lead = /^(?:\r\n|\r|\n)?/.exec(v.t)![0].length;
      const first = leadingRun(v.t, lead);
      if (first !== null) spans.push(spanIn(v, first[0], first[1]));
    }
    const fp = spent === null ? this.fingerprintSpans(full, rows, budget) : { spans: [], cut: full.length };
    clip(fp.spans);
    if (opts.failClosedTail === true) {
      const v = viewOf(full, '\0');
      const p = failClosedStart(v.t, this.fingerprintMax());
      if (p !== null) clip([[origin(v, p), full.length]]);
    }
    // A cut inside the lookahead is the next slice's: this text is whole (its budget is spent, so that one is cut).
    const cutAt = fp.cut !== null && fp.cut - off < text.length ? fp.cut : null;
    const limit = cutAt === null ? text.length : Math.max(0, cutAt - off);
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
    if (cutAt !== null) out.push(SECRET_MASK_TOO_LARGE);
    return { text: out.join(''), carry: cutAt === null && shapes.carry, cut: cutAt !== null };
  }

  /** A long text (pane history) masked in slices at line breaks, yielding to the event loop between them, so no slice
   *  blocks it past the 25 ms bound (D-5995). Each slice reads the raw text on both sides of it, and one budget covers
   *  them all; once it cuts, the rest is the too-large notice. The same answer as `maskText` but for that overlap. */
  async maskTextSliced(text: string, opts: { rows?: boolean } = {},
    pause: () => Promise<void> = () => new Promise((r) => setImmediate(r))): Promise<string> {
    if (text.length <= SLICE_UNITS) return this.maskText(text, opts);
    const budget = newBudget();
    const out: string[] = [];
    let carry = false;
    for (let at = 0; at < text.length;) {
      let end = Math.min(text.length, at + SLICE_UNITS);
      if (end < text.length) { const nl = text.lastIndexOf('\n', end - 1); if (nl > at) end = nl + 1; }
      const r = this.maskWithCarry(text.slice(at, end), {
        rows: opts.rows, leadingWrap: carry, budget,
        context: text.slice(Math.max(0, at - SLICE_OVERLAP), at), lookahead: text.slice(end, end + SLICE_OVERLAP),
      });
      out.push(r.text);
      if (r.cut) break;
      carry = r.carry;
      at = end;
      if (at < text.length) await pause();
    }
    return out.join('');
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

const CODEX_NAMES = ['access_token', 'id_token', 'refresh_token', 'OPENAI_API_KEY'];
/** Where an open Codex token VALUE begins in `t` (its name and colon read whole), or null. A split inside the name or
 *  before the value is no hold: the drawer's context matches the field across the cut (D-5995). */
function codexValueOpenAt(t: string): number | null {
  const q = t.lastIndexOf('"');
  if (q < 0 || t.length - q > DRAWER_HELD_MAX) return null;
  const near = Math.max(0, q - 64);
  const m = /"([A-Za-z_]+)"\s*:\s*"((?:[^"\\\n]|\\.)*\\?)$/.exec(t.slice(near));
  return m !== null && CODEX_NAMES.includes(m[1]!) ? t.length - m[2]!.length : null;
}

/** Where a drawer chunk's open tail begins (D-5995): an unfinished escape, a run that has begun a shape (`sk-` or
 *  `eyJ` at a boundary), an open Codex token value, or, while fingerprints are held, any open run. In the shape-only
 *  mode an ordinary run (a word, a path, a keystroke's echo) is never held: a shape a cut splits ahead of `sk-` is
 *  matched across the cut by the drawer's context. `null`: that tail is longer than a drawer holds. Only the end of
 *  the text is scanned. */
/** An escape whose final byte has not arrived yet, at the end of a text. */
const UNFINISHED_ESC = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*|[PX^_][^\x1b]*|[ -/]*)?$/;
function openTailAt(s: string, fingerprints: boolean, ctx = ''): number | null {
  const base = Math.max(0, s.length - (DRAWER_HELD_MAX + 64));
  // What was sent just before is read with the text (a run `sk-` began in it is still open), never held again.
  const lead = base === 0 ? ctx.slice(-64) : '';
  const w = lead + s.slice(base);
  const esc = UNFINISHED_ESC.exec(w);
  const bodyEnd = esc === null ? w.length : esc.index;
  const v = viewOf(w.slice(0, bodyEnd), '\0');
  let i = v.t.length;
  while (i > 0 && !OPEN_DELIM.test(v.t[i - 1]!)) i--;
  const run = v.t.slice(i);
  let hold: number | null = null;
  if (run !== '') {
    if (fingerprints) hold = i;
    else {
      const sh = SHAPE_STARTED.exec(run);
      if (sh !== null) hold = i + sh.index;
    }
  }
  const cx = codexValueOpenAt(v.t);
  if (cx !== null && (hold === null || cx < hold)) hold = cx;
  if (hold === 0 && base > 0) return null;
  return Math.max(0, base + (hold === null ? bodyEnd : origin(v, hold)) - lead.length);
}

/** The width the provisional mask takes on a terminal. */
const MASK_COLUMNS = [...SECRET_MASK].length;
/** Erases the provisional mask: back over its columns, then blank them (CUB, ECH), so the completed text is drawn
 *  where the terminal would have drawn it. */
const ERASE_MASK = `\x1b[${MASK_COLUMNS}D\x1b[${MASK_COLUMNS}X`;
/** How many holds a provisional mask whose run ended its row waits for a wrapped next row (D-5995): a TUI writes a
 *  wrapped line's rows in one write, so a quiet row end is the line's end, and its text is drawn as typed. */
const ROW_SETTLE_HOLDS = 2;

/** Whether the run that opens `s` has ended within it (D-5995): a delimiter or an escape after it, and when that is a
 *  row end, the next row's leading run ended too (a TUI wrap continues the run there). 'spaces': only blanks follow
 *  it so far (closed once the hold passes with nothing after them). 'row': only a row end (and an indent) follows it
 *  so far (closed once a longer settle passes with no wrapped next row: the output went quiet at a line's end). */
function runClosed(s: string): boolean | 'spaces' | 'row' {
  const v = viewOf(s, '\0');
  const t = v.t;
  let k = 0;
  while (k < t.length && !OPEN_DELIM.test(t[k]!)) k++;
  if (k >= t.length) return false;
  if (t[k] !== '\r' && t[k] !== '\n' && !(t[k] === ' ' || t[k] === '\t' || t[k] === '\0')) return true;
  ROW_END.lastIndex = k;
  const nl = ROW_END.exec(t);
  if (nl === null) {
    // spaces after the run: closed unless only spaces (or an indent's cursor move) remain so far
    let j = k;
    while (j < t.length && (t[j] === ' ' || t[j] === '\t' || t[j] === '\0')) j++;
    return j < t.length ? true : 'spaces';
  }
  let j = k + nl[0].length;
  if (j >= t.length) return 'row';
  ROW_INDENT.lastIndex = j;
  const ind = ROW_INDENT.exec(t);
  if (ind === null) return true;   // an unindented next row: a new line
  j += ind[0].length;
  if (j >= t.length) return 'row';
  TOKEN_RUN.lastIndex = j;
  const run = TOKEN_RUN.exec(t);
  return j + (run === null ? 0 : run[0].length) < t.length;
}

/** The drawer is a byte stream. A chunk whose tail could start a secret holds that tail back until the next chunk, or
 *  for `holdMs` from the FIRST hold, so a secret split across two chunks is masked whole; every other chunk goes at
 *  once. What was sent stays as context for the next chunk. An expired hold fails closed: a begun shape, an open Codex
 *  value, or (fingerprints held) a run that could still be a key is drawn as a PROVISIONAL mask and withheld until it
 *  ends; then the mask is erased and the completed run is drawn masked or not, as one chunk would have been (D-5995).
 *  So an ordinary path, sha, blob or word typed slowly reaches the screen unmasked once it is complete. */
export class DrawerMask {
  private held = '';
  private carry = false;
  private ctx = '';
  /** The run an expired hold drew as a provisional mask, while it is still open. */
  private pending: string | null = null;
  /** A run past what a drawer holds ended in a mask: the next chunk's leading run continues it. */
  private taint = false;
  /** Every chunk the held tail came in was a keystroke's echo (D-5995): its expired hold keeps the 20-byte floor. */
  private heldTyped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly masker: SecretMasker, private readonly emit: (text: string) => void,
    private readonly holdMs: number) {}

  push(chunk: string): void {
    if (chunk === '') return;
    if (this.pending !== null) {
      const s = this.pending + chunk;
      // Still able to be a secret, by the rule that drew the mask: keep it behind the provisional mask. The context is
      // read through the same escape view (D-5995): a cursor escape before the run is a delimiter, never run bytes.
      const v = viewOf(s, '\0');
      let k = 0;
      while (k < v.t.length && !OPEN_DELIM.test(v.t[k]!)) k++;
      const first = viewOf(this.ctx.slice(-64), '\0').t + v.t.slice(0, k);   // the run the mask stands for, so far
      const couldBe = failClosedStart(first, this.masker.fingerprintMax(), 1) !== null
        || (k === v.t.length && codexValueOpenAt(this.ctx + s) !== null)
        || (k < v.t.length && CODEX_VALUE_OPEN.test(`${this.ctx.slice(-64)}${v.t.slice(0, k)}`));
      const closed = runClosed(s);
      if (closed !== true && couldBe && s.length <= DRAWER_HELD_MAX) {
        this.pending = s;
        // Blanks after the run: it ends there unless a row end and a wrapped next row follow within the hold.
        if (closed !== false && this.timer === null) {
          this.timer = setTimeout(() => { this.timer = null; this.settlePending(); },
            closed === 'row' ? ROW_SETTLE_HOLDS * this.holdMs : this.holdMs);
        }
        return;
      }
      this.stopTimer();
      this.pending = null;
      this.resolve(s);
      return;
    }
    // A keystroke's echo is at most two visible characters (a surrogate pair), its escapes aside.
    const typed = viewOf(chunk, '').t.length <= 2;
    this.heldTyped = (this.held === '' || this.heldTyped) && typed;
    this.route(this.held + chunk, '');
  }

  /** Sends whatever is held, failing closed on a secret it may begin. */
  flush(): void {
    this.stopTimer();
    if (this.held === '') return;
    let h = this.held;
    this.held = '';
    // The context and the held text are read as one text (D-5995): an escape the cut split is whole in it, and a
    // cursor escape before the run is a delimiter, never run bytes. An escape that has not ended is never sent in part,
    // nor masked into: it stays held until its next byte.
    const lead = this.ctx.slice(-64);
    const open = UNFINISHED_ESC.exec(lead + h);
    let tail = '';
    if (open !== null) {
      const at = Math.max(0, open.index - lead.length);
      tail = h.slice(at);
      h = h.slice(0, at);
      if (h === '') { this.held = tail; return; }
    }
    const v = viewOf(lead + h, '\0');
    const p = failClosedStart(v.t, this.masker.fingerprintMax(), this.heldTyped ? RUN_MIN_BYTES : 1);
    // A start inside the context: the run began before the held text, which is all of it.
    const cut = p === null ? null : Math.max(0, origin(v, p) - lead.length);
    if (cut === null) { this.out(h, false, ''); this.held = tail; return; }
    if (cut > 0) this.out(h.slice(0, cut), false, '');
    this.emit(SECRET_MASK);
    this.pending = h.slice(cut) + tail;
  }

  /** The provisional mask's run ended in blanks that nothing followed within the hold: resolve it now. */
  private settlePending(): void {
    if (this.pending === null) return;
    const s = this.pending;
    this.pending = null;
    this.resolve(s);
  }

  dispose(): void {
    this.stopTimer();
    this.held = '';
    this.ctx = '';
    this.pending = null;
  }

  /** The provisional mask's run has ended (or can no longer be a secret): erase the mask and draw the text as one
   *  chunk would have been drawn. */
  private resolve(s: string): void {
    this.route(s, ERASE_MASK);
  }

  /** Sends `s` up to its open tail (prefixed by `lead`, raw), and holds the tail. */
  private route(s: string, lead: string): void {
    this.held = '';
    const cut = openTailAt(s, this.masker.fingerprintMax() !== null, this.ctx);
    if (cut === null) {   // an open tail past the bound: sent now, failing closed on a begun secret
      this.stopTimer();
      this.out(s, true, lead);
      return;
    }
    if (cut > 0 || lead !== '') this.out(s.slice(0, cut), false, lead);
    if (cut < s.length) {
      this.held = s.slice(cut);
      if (this.timer === null) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.holdMs);
    } else {
      this.stopTimer();
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private out(text: string, failClosedTail: boolean, lead: string): void {
    const r = this.masker.maskWithCarry(text, {
      rows: true, leadingWrap: this.carry, context: this.ctx, failClosedTail, leadingTaint: this.taint,
    });
    this.carry = r.carry;
    this.taint = failClosedTail && r.text.endsWith(SECRET_MASK);
    this.ctx = (this.ctx + text).slice(-DRAWER_CONTEXT);
    this.emit(lead + r.text);
  }
}

/** The masker every egress falls back to when none is wired: the shapes, with no table and no token. */
export const SHAPE_ONLY_MASKER = new SecretMasker();
