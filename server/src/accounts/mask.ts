/**
 * THE EGRESS MASK (D-5513, accounts-connect spec 2026-10-18 §3.3, plan Task A10; G31). Every server egress of
 * session-derived text passes here before it leaves: the transcript and ask websocket (`sessionws.ts`), the drawer
 * (`/ws/pty/:id`'s `onData`, the one point the local `attachPty` and the remote `createSpawnPty` arms share), pane
 * history, `GET /api/feed`, `GET /api/runs/:id/items`, the mail answers, the notification catch-up and every web-push
 * payload (`push.ts`).
 *
 * Two halves, both on DECODED strings before serialization, never on a serialized frame:
 *   - SHAPES. Every entry of `CREDENTIAL_MASKS` (`shared/api.ts`, the one home) becomes `SECRET_MASK`. ANSI CSI
 *     sequences are read two ways, stripped (so a shape SGR splits still matches) and as a delimiter (so a shape SGR
 *     touches still has its boundary), and the union of both is masked. In ROWS mode (the drawer and pane history,
 *     where Claude Code's TUI hard-wraps a long line into indented rows) a shape that reaches the end of its row also
 *     masks the leading token run of the next row, and on through every row that run fills.
 *   - EXACT BYTES. A `compatible` key has no shape, so each lane secret has a fingerprint,
 *     `HMAC-SHA256(box token, "ccrc-secret-fp-v1\0" ‖ secret)`, computed on the box and stored in `secret_fingerprints`
 *     with the box-token generation it was keyed with. Each candidate run (20 to 8192 bytes, delimited by whitespace,
 *     quotes, `=`, `:`, `,`, `;`, `&`, `}`, `]`, a backtick, the JSON escapes `\n` `\t` `\"`, and CSI sequences) is
 *     hashed bare and with one and two `=` of padding under every generation held, and a match is masked. THE CAP
 *     FAILS CLOSED: runs are checked in chunks of 256, every chunk is checked, and past 64 chunks the rest of the text
 *     is replaced by `SECRET_MASK_TOO_LARGE`. No run is passed through unchecked. With no fingerprint row held there is
 *     nothing to hash against, so the pass (and its ceiling) is skipped.
 *
 * A ROTATION never opens a window: when the box token changes, the masker keeps the previous generation's token in
 * memory only, keeps matching that generation's rows with it, and asks for the re-keying `roster` sub; once rows for
 * the new generation land (`ingest`), the old rows are deleted and the old token is forgotten (D-5975).
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
/** A candidate run's byte bounds. */
export const RUN_MIN_BYTES = 20;
export const RUN_MAX_BYTES = 8192;
/** The exact-bytes check's chunk and its hard ceiling (64 × 256 = 16,384 runs). */
export const RUNS_PER_CHUNK = 256;
export const MAX_CHUNKS = 64;
/** How long the drawer holds back a chunk's open tail run before it flushes it alone. */
export const DRAWER_HOLD_MS = 50;

/** One fingerprint row as the table holds it. */
export interface FingerprintRow { readonly laneId: string; readonly fp: string; readonly gen: string }

export interface SecretMaskerOpts {
  /** coord.db; `null`/absent: shapes only (no table to read). */
  readonly db?: DatabaseSync | null;
  /** The current box token, read at every mask; `null`/absent: no exact-bytes check. */
  readonly token?: () => string | null;
  /** Asks for the re-keying `roster` sub (after a rotation, or at boot over rows of another generation). */
  readonly requestRekey?: () => void;
  readonly now?: () => number;
}

/** The generation id a token's rows carry (D-5975): a short digest of the token under its own domain, so the box and
 *  the server derive the same id with nothing else exchanged, and no id reveals the token. */
export function fingerprintGeneration(token: string): string {
  return createHash('sha256').update('ccrc-secret-fp-gen-v1\0').update(token, 'utf8').digest('hex').slice(0, 16);
}

/** A lane secret's fingerprint under `token` (the box computes the same). */
export function fingerprintOf(token: string, secret: string): string {
  return createHmac('sha256', token).update(FINGERPRINT_DOMAIN, 'utf8').update(secret, 'utf8').digest('hex');
}

// ── the two views of a text ────────────────────────────────────────────────

const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
/** A text's view with every CSI sequence stripped (`sep: ''`) or replaced by one NUL (`sep: '\0'`), and the map
 *  from each view index to its index in the original (`map[t.length]` is the original's length). */
interface View { readonly t: string; readonly map: readonly number[] | null }
function viewOf(s: string, sep: '' | '\0'): View {
  if (!s.includes('\x1b')) return { t: s, map: null };   // no escape: the view is the text (the common case)
  let t = ''; const map: number[] = [];
  let from = 0;
  CSI.lastIndex = 0;
  const copy = (a: number, b: number): void => { for (let i = a; i < b; i++) { t += s[i]; map.push(i); } };
  for (let m = CSI.exec(s); m !== null; m = CSI.exec(s)) {
    copy(from, m.index);
    if (sep !== '') { t += sep; map.push(m.index); }
    from = m.index + m[0].length;
  }
  copy(from, s.length);
  map.push(s.length);
  return { t, map };
}
/** A view span [a, b) as an original span. */
const spanIn = (v: View, a: number, b: number): [number, number] =>
  (v.map === null ? [a, b] : [v.map[a]!, v.map[b - 1]! + 1]);
const origin = (v: View, i: number): number => (v.map === null ? i : v.map[i]!);

// ── shapes ─────────────────────────────────────────────────────────────────

/** One regular expression per shape, each with its boundary (a lookbehind source keeps its own). */
export function shapeMatchers(masks: readonly CredentialMask[] = CREDENTIAL_MASKS): RegExp[] {
  return masks.map((m) => new RegExp(m.source.startsWith('(?<=') ? m.source : `(?<![A-Za-z0-9])(?:${m.source})`, 'g'));
}
const SHAPES = shapeMatchers();

/** The next row's leading token run after a span that ends at its row's end: [start, end) in `t`, or null. A TUI
 *  wrap is INDENTED (Claude Code indents the rows a long line wraps into; tmux may draw that indent as a cursor move,
 *  which the CSI-as-NUL view reads as a NUL), so a next row with no indent is a new line, never a wrap. */
const ROW_END = /^[ \t]*(?:\r\n|\r|\n)/;
const ROW_INDENT = /^(?:[ \t\0]|│|┃|\|)+/;
const TOKEN_RUN = /^[A-Za-z0-9_+/.-]+/;
function continuationAfter(t: string, end: number): [number, number] | null {
  const nl = ROW_END.exec(t.slice(end));
  return nl === null ? null : leadingRun(t, end + nl[0].length);
}
function leadingRun(t: string, from: number): [number, number] | null {
  const rest = t.slice(from);
  const indent = ROW_INDENT.exec(rest);
  if (indent === null) return null;
  const run = TOKEN_RUN.exec(rest.slice(indent[0].length));
  return run === null ? null : [from + indent[0].length, from + indent[0].length + run[0].length];
}
/** The length of the row `i` sits on, in `t`. */
function rowLength(t: string, i: number): number {
  const start = Math.max(t.lastIndexOf('\n', i - 1), t.lastIndexOf('\r', i - 1)) + 1;
  const m = /[\r\n]/.exec(t.slice(i));
  return (m === null ? t.length : i + m.index) - start;
}

/** Every shape starts with one of these, so a text holding none of them holds no shape. */
const SHAPE_HINT = /sk-|eyJ|_token"|OPENAI_API_KEY"/;
function shapeSpans(s: string, rows: boolean, masks: readonly RegExp[]): { spans: [number, number][]; carry: boolean } {
  const spans: [number, number][] = [];
  let carry = false;
  if (!SHAPE_HINT.test(s.replace(CSI, ''))) return { spans, carry };
  for (const sep of ['', '\0'] as const) {
    if (sep === '\0' && !s.includes('\x1b')) break;   // with no escape the two views are one
    const v = viewOf(s, sep);
    for (const re of masks) {
      re.lastIndex = 0;
      for (let m = re.exec(v.t); m !== null; m = re.exec(v.t)) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        let end = m.index + m[0].length;
        spans.push(spanIn(v, m.index, end));
        // Rows mode: a shape that reaches its row's end runs on into the next row's leading run, and on through every
        // further row while the row before it was as full as the shape's own (a shorter row is the value's last).
        const full = rowLength(v.t, m.index);
        for (let first = true; rows; first = false) {
          if (!first && rowLength(v.t, end - 1) < full) break;
          const next = continuationAfter(v.t, end);
          if (next === null) {
            if (/^[ \t]*(?:\r\n|\r|\n)?$/.test(v.t.slice(end))) carry = true;   // the next row is in the next text
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

/** A run's delimiters, in the CSI-as-NUL view. Never `-`: a key holds dashes. */
const DELIM = /[\s"'=:,;&}\]`\0]|\\[nt"]/g;

interface Key { readonly gen: string; readonly token: string }

/** Masks `text` for every egress of session-derived text. */
export class SecretMasker {
  private readonly db: DatabaseSync | null;
  private readonly token: () => string | null;
  private readonly requestRekey: () => void;
  private readonly now: () => number;
  /** Current generation first; a second entry is the previous one, held until the re-key lands. */
  private keys: Key[] = [];
  /** gen → fingerprints, mirrored from the table. */
  private rows = new Map<string, Set<string>>();

  constructor(opts: SecretMaskerOpts = {}) {
    this.db = opts.db ?? null;
    this.token = opts.token ?? (() => null);
    this.requestRekey = opts.requestRekey ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.load();
    this.syncKeys();
    // Rows keyed with a generation this process holds no token for (a restart after a rotation) cannot be matched:
    // ask for the re-key at once.
    const cur = this.keys[0]?.gen;
    if (cur !== undefined && [...this.rows.keys()].some((g) => g !== cur)) this.requestRekey();
  }

  private load(): void {
    this.rows = new Map();
    if (this.db === null) return;
    for (const r of this.db.prepare('SELECT fp, gen FROM secret_fingerprints').all() as unknown as FingerprintRow[]) {
      let set = this.rows.get(r.gen);
      if (set === undefined) this.rows.set(r.gen, (set = new Set()));
      set.add(r.fp);
    }
  }

  /** Follows the box token. A change keeps the previous token (memory only) and asks for the re-key. */
  private syncKeys(): void {
    const tok = this.token();
    if (tok === null || tok === '') return;
    const head = this.keys[0];
    if (head !== undefined && head.token === tok) return;
    const key = { gen: fingerprintGeneration(tok), token: tok };
    if (head === undefined) { this.keys = [key]; return; }
    this.keys = [key, head];
    this.requestRekey();
  }

  /** Writes the CURRENT generation's fingerprints (A12's `reloadRoster` calls it with every answer's `fingerprints`).
   *  Rows of every other generation are deleted in the same transaction, and the previous token is forgotten. */
  ingest(rows: readonly { laneId: string; fp: string }[]): void {
    this.syncKeys();
    const cur = this.keys[0];
    if (cur === undefined || this.db === null) return;
    const at = this.now();
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Every other generation's rows go; each lane named here has its current rows replaced by this answer's.
      db.prepare('DELETE FROM secret_fingerprints WHERE gen <> ?').run(cur.gen);
      const del = db.prepare('DELETE FROM secret_fingerprints WHERE gen = ? AND laneId = ?');
      const ins = db.prepare('INSERT OR REPLACE INTO secret_fingerprints (laneId, fp, gen, at) VALUES (?, ?, ?, ?)');
      for (const lane of new Set(rows.map((r) => r.laneId))) del.run(cur.gen, lane);
      for (const r of rows) if (/^[0-9a-f]{64}$/.test(r.fp)) ins.run(r.laneId, r.fp, cur.gen, at);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    this.keys = [cur];
    this.load();
  }

  /** The keys whose generation has rows to match. */
  private liveKeys(): { key: Key; fps: Set<string> }[] {
    const out: { key: Key; fps: Set<string> }[] = [];
    for (const key of this.keys) {
      const fps = this.rows.get(key.gen);
      if (fps !== undefined && fps.size > 0) out.push({ key, fps });
    }
    return out;
  }

  /** Every exact-bytes span, and the original index the ceiling cuts at (null: under it). */
  private fingerprintSpans(s: string): { spans: [number, number][]; cut: number | null } {
    const live = this.liveKeys();
    if (live.length === 0) return { spans: [], cut: null };
    const v = viewOf(s, '\0');
    const runs: [number, number][] = [];
    let from = 0;
    DELIM.lastIndex = 0;
    const take = (a: number, b: number): void => {
      if (b <= a) return;
      const bytes = Buffer.byteLength(v.t.slice(a, b), 'utf8');
      if (bytes >= RUN_MIN_BYTES && bytes <= RUN_MAX_BYTES) runs.push([a, b]);
    };
    for (let m = DELIM.exec(v.t); m !== null; m = DELIM.exec(v.t)) { take(from, m.index); from = m.index + m[0].length; }
    take(from, v.t.length);
    const spans: [number, number][] = [];
    for (let chunk = 0; chunk * RUNS_PER_CHUNK < runs.length; chunk++) {
      if (chunk >= MAX_CHUNKS) return { spans, cut: origin(v, runs[chunk * RUNS_PER_CHUNK]![0]) };
      for (const [a, b] of runs.slice(chunk * RUNS_PER_CHUNK, (chunk + 1) * RUNS_PER_CHUNK)) {
        const run = v.t.slice(a, b);
        if (live.some(({ key, fps }) => [run, `${run}=`, `${run}==`].some((f) => fps.has(fingerprintOf(key.token, f))))) {
          spans.push(spanIn(v, a, b));
        }
      }
    }
    return { spans, cut: null };
  }

  /** `text` masked, and whether a shape ran to its text's last row (the drawer carries it into the next chunk). */
  maskWithCarry(text: string, opts: { rows?: boolean; leadingWrap?: boolean } = {}): { text: string; carry: boolean } {
    if (text === '') return { text, carry: opts.leadingWrap === true };
    this.syncKeys();
    const rows = opts.rows === true;
    const { spans, carry } = shapeSpans(text, rows, SHAPES);
    if (rows && opts.leadingWrap === true) {
      const v = viewOf(text, '\0');
      const lead = /^(?:\r\n|\r|\n)?/.exec(v.t)![0].length;
      const first = leadingRun(v.t, lead);
      if (first !== null) spans.push(spanIn(v, first[0], first[1]));
    }
    const fp = this.fingerprintSpans(text);
    spans.push(...fp.spans);
    const limit = fp.cut ?? text.length;
    spans.sort((x, y) => x[0] - y[0]);
    let out = ''; let at = 0;
    for (const [a0, b0] of spans) {
      if (a0 >= limit) break;
      const a = Math.max(a0, at); const b = Math.min(b0, limit);
      if (b <= at) continue;
      if (a > at) out += text.slice(at, a);
      if (!out.endsWith(SECRET_MASK) || a > at) out += SECRET_MASK;
      at = b;
    }
    out += text.slice(at, limit);
    if (fp.cut !== null) out += SECRET_MASK_TOO_LARGE;
    return { text: out, carry: fp.cut === null && carry };
  }

  /** One string, masked. `rows`: the drawer and pane history (TUI row wraps). */
  maskText(text: string, opts: { rows?: boolean } = {}): string {
    return this.maskWithCarry(text, opts).text;
  }

  /** A structured answer or frame with every string field masked, before it is serialized. A copy: the input (which a
   *  caller may hold or cache) is never mutated. */
  maskDeep<T>(value: T): T {
    return this.walk(value) as T;
  }

  private walk(v: unknown): unknown {
    if (typeof v === 'string') return this.maskText(v);
    if (Array.isArray(v)) return v.map((x) => this.walk(x));
    if (v !== null && typeof v === 'object') {
      const proto = Object.getPrototypeOf(v) as unknown;
      if (proto !== Object.prototype && proto !== null) return v;   // a Buffer, a Date: not text
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = this.walk(x);
      return out;
    }
    return v;
  }

  /** A drawer's per-connection streamer over this masker. */
  drawer(emit: (text: string) => void, holdMs: number = DRAWER_HOLD_MS): DrawerMask {
    return new DrawerMask(this, emit, holdMs);
  }
}

/** Where a drawer chunk's open tail begins: an unfinished escape, or a candidate run with no delimiter after it. */
function openTailAt(s: string): number {
  const esc = /\x1b(?:\[[0-?]*[ -/]*)?$/.exec(s);
  const body = esc === null ? s : s.slice(0, esc.index);
  const v = viewOf(body, '\0');
  if (v.t.length === 0) return esc === null ? s.length : esc.index;
  const last = v.t[v.t.length - 1]!;
  if (/[\s"'=:,;&}\]`\0]/.test(last)) return esc === null ? s.length : esc.index;
  let i = v.t.length - 1;
  while (i > 0 && !/[\s"'=:,;&}\]`\0]/.test(v.t[i - 1]!)) i--;
  return origin(v, i);
}

/** The drawer is a byte stream: a chunk that ends inside a candidate run holds that run back until the next chunk or
 *  `holdMs`, so a secret split across two chunks is still masked; a chunk that ends on a delimiter goes at once. */
export class DrawerMask {
  private held = '';
  private carry = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly masker: SecretMasker, private readonly emit: (text: string) => void,
    private readonly holdMs: number) {}

  push(chunk: string): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    const s = this.held + chunk;
    this.held = '';
    const cut = openTailAt(s);
    if (cut > 0) this.out(s.slice(0, cut));
    if (cut < s.length) {
      this.held = s.slice(cut);
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.holdMs);
    }
  }

  /** Sends whatever is held, masked on its own. */
  flush(): void {
    if (this.held === '') return;
    const h = this.held;
    this.held = '';
    this.out(h);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.held = '';
  }

  private out(text: string): void {
    const r = this.masker.maskWithCarry(text, { rows: true, leadingWrap: this.carry });
    this.carry = r.carry;
    this.emit(r.text);
  }
}

/** The masker every egress falls back to when none is wired: the shapes, with no table and no token. */
export const SHAPE_ONLY_MASKER = new SecretMasker();
