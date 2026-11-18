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
 *     row, and on through every row that run fills; and a row whose last run has begun a shape (or ends in a prefix
 *     of one that the next row completes) is joined to the next indented row's leading run before the shapes are
 *     matched, so a key wrapped before its first row could match is matched whole; the shapes are matched on the
 *     joined text and on the text as drawn, so a join never hides a key that begins the joined row (D-5995).
 *   - EXACT BYTES. A `compatible` key has no shape, so each lane secret has a fingerprint row (D-5996): the secret
 *     with its trailing `=` stripped, `HMAC-SHA256(box token, "ccrc-secret-fp-v1\0" ‖ that)`, and its byte length,
 *     computed on the box and stored in `secret_fingerprints` with the box-token generation it was keyed with. A
 *     candidate is a run between delimiters (two delimiter sets, a coarse and a fine one, on both views of the
 *     escapes), the same run with its leading and trailing ASCII punctuation trimmed, and in rows mode a run that
 *     ends its row joined with the next row's leading run and on with the leading run of every further row the run
 *     before fills, as many rows as a key can span (D-8710). Only a candidate whose byte length some row holds counts,
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
 * holds a lane secret. It does hold the operator's pasted secrets (plan PL6, `coord/ledgersSecrets.ts`): `ingestSecret`
 * fingerprints one of them here. Their lanes (`operator-secret:<programme>:<slot>`) are this server's own: `retain` never
 * prunes one (review 1389 F1), a box's roster answer never names one (`offer` drops any it carries, review 1391 A-1), and
 * the re-key after a rotation carries them (`withOperatorSecretRows`) without ever replacing a row a save wrote meanwhile
 * (review 1391 F1). The operator's Remove (programme item 9) retires a lane: its rows leave the table and are kept in this
 * process's memory only, so the removed value is masked until the server restarts and never reloaded after.
 */
import { createHash, createHmac, type Hash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SECRET_MASK, SECRET_MASK_TOO_LARGE } from '../../../shared/api.js';
import { isOperatorSecretLane, type SecretUnmasked } from '../../../shared/ledgers.js';
import {
  LF_BREAK_REST, ROW_BREAK, RUN_MAX_BYTES, RUN_MIN_BYTES, ROW_END, ROW_INDENT, SHAPE_STARTED, SHAPES, TOKEN_RUN, leadingRun, matchesShape, origin,
  Rows, rowTextEnd, runOnRows, shapeSpans, spanIn, spliceMasked, viewOf, walkStrings, type View,
} from './shapes.js';

/** The fingerprint's domain prefix, fed to the HMAC ahead of the secret. */
export const FINGERPRINT_DOMAIN = 'ccrc-secret-fp-v1\0';
/** The exact-bytes budget: 32 chunks of 256 candidate runs (8,192) per frame, each checked under every live key
 *  (D-5995: 16,384 cost a frame past the 25 ms bound). */
export const RUNS_PER_CHUNK = 256;
export const MAX_CHUNKS = 32;
/** The bytes of candidates joined across three or more rows one frame may hash, each under every live key (D-8710). Such
 *  candidates overlap: in a listing of equal lines whose width divides a held key's length, every line starts one as
 *  long as the key, so counting runs alone let a 64 Ki slice hash 31 MB (177 ms, measured). 2 MiB keeps a frame near
 *  the 20 ms the run budget bounds; past it the frame is cut, failing closed like the run budget. */
export const ROW_CHAIN_BYTES = 2 * 1024 * 1024;
/** How long the drawer holds back an open tail that could start a secret, from the FIRST hold (D-5995): well over the
 *  gap between the chunks of one node-pty burst. 6 ms, so the echo latency it adds, with the 1 to 3 ms late a Node
 *  timer fires, stays within the 8 ms bound measured through a real tmux attach. */
export const DRAWER_HOLD_MS = 6;
/** The raw text a drawer keeps from what it already sent, so a shape or a key that a chunk boundary or an expired
 *  hold split is still matched across it (D-5995). A key whose hold began inside it is not read from here: the match
 *  made with the held rows as lookahead carries into them (`DrawerMask`'s `ahead`, review 2370 F1). */
const DRAWER_CONTEXT = 1024;
/** The most a drawer holds back: a longer undelimited run is no fingerprint candidate (D-5995). */
const DRAWER_HELD_MAX = RUN_MAX_BYTES + 1024;
/** The text a drawer reads first for a key's rows (its window, plus 64), and what a slice of pane history reads on
 *  either side (D-8710): twice what it holds for one run, room for a key at the run ceiling drawn with a colour escape
 *  and an indent on every row (an 8,192-byte key at 118 columns in tmux's form spans about 10.5 KB). A key's rows that
 *  run past it are read again over the whole text (`WHOLE_HELD_MAX`, review 2370 F2). */
const CHAIN_HELD_MAX = 2 * DRAWER_HELD_MAX;
/** The most a drawer holds for a key's rows that run past `CHAIN_HELD_MAX` bytes (review 2370 F2), and the most pane
 *  history's lookahead grows and each window `chainRowsOn` reads: 64 KiB (desktop polish C44, D-8728; 256 KiB before,
 *  whose re-reads cost 26 to 37 ms a slice on hostile key-free panes, review 2411 F4). A key at the run ceiling coloured
 *  character by character (an 8,192-byte key in 150 KiB) no longer fits, and is masked as below. Past it the text is
 *  sent with the chain's rows masked, and the rows that go on with it too (`chainRowsBack`, `chainRowsOn`): failing
 *  closed, as pane history's lookahead does at the same cap. */
const WHOLE_HELD_MAX = 64 * 1024;
/** The re-key's backoff, and the most previous box tokens kept at once (D-5995). A previous token is kept only while its
 *  generation holds rows (`syncKeys`), so this caps the generations holding rows, not the rotations (review 1426 F-C). */
const REKEY_FIRST_MS = 1_000;
const REKEY_MAX_MS = 600_000;
const MAX_PREVIOUS_KEYS = 4;
/** How long a fingerprint write waits on a locked coord.db before it is held and retried: `ingest` runs on the event
 *  loop, so the connection's own 5 s timeout would stall every request behind it (D-5995 (10); accounts plan Task A12). */
export const INGEST_BUSY_MS = 50;

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
const LINE_BREAK = new RegExp(ROW_BREAK, 'g');
const ROW_INDENT_OPT = /(?:[ \t\0]|│|┃|\|)*/y;
const LEADING_BREAK = new RegExp(String.raw`^(?:${ROW_BREAK})?`);
/** One row break at `lastIndex`, as `ROW_BREAK` reads it (C44, review 2430 F1). */
const BREAK_AT = new RegExp(ROW_BREAK, 'y');
/** The most a slice's end moves past a LF to end the row break it begins (C44): blanks and escapes between a LF and its
 *  CR. A break that runs past it is cut after the LF, and the slice's lookahead reads the rest of the break as part of
 *  it (C45, `lookaheadEnd`'s `lead`), so the bound decides where a slice ends, never what is masked: 63 blanks end the
 *  slice after the CR, 64 after the LF (pinned in drawer-mask-rows). */
const BREAK_CUT_MAX = 64;
/** Where a slice of pane history that ends at the LF at `nl` is cut (C44, C45): after the row break that LF is in, as
 *  `ROW_BREAK` reads it through the escape view (an escape between a LF and its CR is part of the break, as every row
 *  reader reads it; review 2445 F1), when two bytes follow that break within `BREAK_CUT_MAX` + 2 bytes of the LF (what
 *  follows a CR decides whether it ends the break: a CR LF or a LF after it does not); else after the LF. The read ends
 *  outside an escape, so an escape the bound cuts is not read as text. */
function sliceCutAt(text: string, nl: number): number {
  const b0 = breakStartAt(text, nl + 1)!;
  const v = viewOf(text.slice(b0, outsideEscape(text, Math.min(text.length, nl + 1 + BREAK_CUT_MAX + 2), nl + 1)), '\0');
  BREAK_AT.lastIndex = 0;
  const br = BREAK_AT.exec(v.t);
  return br !== null && br[0].length + 1 < v.t.length ? Math.max(nl + 1, b0 + origin(v, br[0].length)) : nl + 1;
}
/** The rest of a row break that a slice cut after its LF (C45): blanks and escapes (NULs in the view), then the CR that
 *  ends the break, with no LF after it (that makes a CR LF, and the blanks a row of their own). Built from the grammar's
 *  own piece (`LF_BREAK_REST`), never a copy of it (review 2514 F5). */
const BREAK_REST = new RegExp(`^(?:${LF_BREAK_REST})`);
/** The first index of view `v` whose original index is `i` or later. */
function viewIndexOf(v: View, i: number): number {
  if (v.map === null) return i;
  let lo = 0; let hi = v.t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (v.map[mid]! < i) lo = mid + 1; else hi = mid; }
  return lo;
}

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
/** The fewest units of a row a key's row join runs through (D-8710): a key's rows between its first and its last are
 *  as wide as its wrap, and no terminal, TUI or program wraps one at fewer columns than this (review 2326's narrowest
 *  case is 15). A shorter row may still begin or end a key's rows. */
const WRAP_ROW_MIN = 12;
/** The most rows the row join reads one key across (D-8710): the drawer's pane is 220 columns, the reader floor 120, and
 *  a client that sends no width 80, where a key at the run ceiling (`RUN_MAX_BYTES`) spans 105 rows. More rows would
 *  only cost: a listing of equal lines chained that deep makes one candidate as long as the longest key per line. */
const KEY_ROWS_MAX = 128;

/** The fail-closed start of a text's open tail (D-5995): an open Codex token value, `sk-` or `eyJ` at a boundary in
 *  its last run (a shape's prefix), or, while fingerprints are held (`fpMax`: the longest held byte length), a last run
 *  of `floor` bytes or more that could still be one. Nothing else: an ordinary run is never masked for being open. An
 *  index into `t`, or null. The floor is 20 for a run typed key by key (a keystroke's echo is never delayed, ruling a)
 *  and 1 for a run a burst of output left open (a key a chunk boundary split shows none of its bytes). */
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
/** What one frame may still hash (D-5995): `left` candidate runs, and `rowBytes` bytes of the candidates the row join
 *  makes across three or more rows (D-8710). */
export interface MaskBudget { left: number; rowBytes?: number }
const newBudget = (): MaskBudget => ({ left: RUNS_PER_CHUNK * MAX_CHUNKS, rowBytes: ROW_CHAIN_BYTES });

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
  /** The drawer (D-8710): `carry` is read at this text's own end, as if no lookahead followed it. The drawer's held text
   *  is its lookahead, and a shape whose next row it holds would otherwise carry nothing into it, leaving that row to
   *  the context's 1 KiB. */
  readonly carryAtText?: boolean;
  /** The drawer and pane history (D-8710, review 2370 F1 and F2): spans of this text masked whatever it matches: those
   *  a match in the last text's lookahead reached into (`ahead`), masked as one text would have masked them, since this
   *  text is read with too little of the text before it to find that key again (the drawer keeps 1 KiB, a slice 18 KiB);
   *  and in pane history, a chain's rows that no slice could read whole (`chainRowsBack`, `chainRowsOn`). */
  readonly ahead?: readonly (readonly [number, number])[];
  /** The drawer: what each masked run reads as, in place of `SECRET_MASK` (`DRAWER_SECRET_MASK`, D-8694). */
  readonly mark?: string;
}

/** A sliced mask's slice and the raw overlap read on each side of it (D-5995): one slice of pane history costs a few
 *  milliseconds, and the overlap is the chain hold (`CHAIN_HELD_MAX`, 18 KiB), so a key or a wrapped shape a cut splits
 *  is matched whole. It was what a drawer holds for one run (9 KiB), narrower than a key's rows with a colour escape on
 *  each: an 8,192-byte key at 118 columns in `capture-pane -e -J`'s form (10,092 bytes) showed up to 640 key bytes when
 *  the slice boundary fell inside it, and more at 64 columns (review 2352 F2). At 16 KiB a block with five escapes on
 *  every row (17,802 bytes) still showed up to 576 key bytes. The overlap stays a bound that does not grow with the text
 *  (`secret-mask.test.ts` pins it); only a chain of key rows the drawer's walk follows across the cut reads further, up
 *  to that key's own bytes and rows and `WHOLE_HELD_MAX` (`lookaheadEnd`, review 2370 F2). */
const SLICE_UNITS = 64 * 1024;
const SLICE_OVERLAP = CHAIN_HELD_MAX;
/** Where the lookahead of a slice of pane history that ends at `end` ends (D-8710, review 2370 F2): `SLICE_OVERLAP` past
 *  it, and further while the drawer's walk back from there (`chainBack`) still reaches `end`, so a key whose rows cross
 *  the cut is read whole in the slice before it, however many escapes or blanks its rows carry; never more than
 *  `WHOLE_HELD_MAX` past `end`. The walk is bounded by a key's own bytes and rows, so plain wrapped text never grows it.
 *  `fpMax` null: no fingerprint is held, and the overlap is the bound. */
function lookaheadEnd(text: string, end: number, fpMax: number | null): { end: number; cut: boolean } {
  const cap = Math.min(text.length, end + WHOLE_HELD_MAX);
  let le = Math.min(cap, end + SLICE_OVERLAP);
  if (fpMax === null) return { end: le, cut: false };
  for (let grown = false; ; grown = true) {
    if (grown) {
      const nl = text.indexOf('\n', le);
      // A grown lookahead ends at the end of a row: at the start of the row break its LF ends, read back as `ROW_BREAK`
      // reads it, so a CR LF's CR is not read as an empty last row that ends every key's rows (C44, review 2430 F3).
      le = nl < 0 || nl >= cap ? cap : breakStartAt(text, nl + 1)!;
    }
    // The walk starts at the leading run of the row the lookahead ends in: a key's rows that reach that row lead it,
    // whatever follows the key on its last row or wherever in the row the lookahead ends.
    const t = viewOf(text.slice(end, le), '\0').t;
    // A slice cut after the LF of a LF, blanks or escapes, then a CR (one row down, too long for the cut to end:
    // `BREAK_CUT_MAX`) begins its lookahead with the rest of that break, which is no row of its own: the read starts after
    // it. Read as a row, it ended every key's rows at the cut, and the whole key went out raw (C45, review 2445 F1).
    const lead = text[end - 1] === '\n' && text[end - 2] !== '\r' ? BREAK_REST.exec(t)?.[0].length ?? 0 : 0;
    let i = t.length;
    while (i > lead && t[i - 1] !== '\n' && t[i - 1] !== '\r') i--;
    let r = i;
    while (r < t.length && ROW_LEAD.includes(t[r]!)) r++;
    const blank = i === lead && r === t.length;   // the read is all one row's indent and escapes
    if (r === t.length && i > lead && (!grown || le >= cap)) {
      // The first read, or a read the cap stopped, ends inside a row's indent or escapes, before its run: start from the
      // row before. At the cap, answering "no cut" there sent the chain's rows on both sides raw (review 2411 F2: an
      // 8,192-byte key with 2,600 blanks of indent a row, whole at 15 of 16 placements). A grown read below the cap ends
      // at a row break, so its last row is whole, and a row with no run ends every key's rows.
      // Back over the row break as `ROW_BREAK` reads it: a move down then a CR (CUD+CR, IND+CR) is one break, viewed as a
      // LF, a NUL and a CR, and stepping back over LF and CR alone stopped at the NUL, read an empty row and answered "no
      // cut" (review 2430 F1: a 2,000-byte key whole in pane history where main masked it).
      for (let s = breakStartAt(t, i); s !== null; s = breakStartAt(t, i)) i = s;
      while (i > 0 && t[i - 1] !== '\n' && t[i - 1] !== '\r') i--;
      r = i;
      while (r < t.length && ROW_LEAD.includes(t[r]!)) r++;
    }
    i = r;
    let j = i;
    for (;;) {   // the run, joined across escapes as `joinBack` joins it
      while (j < t.length && !OPEN_DELIM.test(t[j]!)) j++;
      let n0 = j;
      while (n0 < t.length && t[n0] === '\0') n0++;
      if (n0 === j || n0 >= t.length || OPEN_DELIM.test(t[n0]!)) break;
      j = n0;
    }
    if (i === j) {
      // The row holds no leading run: no key's rows run through it, so a key that crosses the cut ends inside the read.
      // Unless the read is all one row's indent (no row break, nothing but blanks and escapes): a key's next row may come
      // after it, so the read grows as for a chain across the cut, and at the cap the rows fail closed
      // (`chainRowsBack`, `chainRowsOn`). Answering "no cut" sent a key's rows after an indent wider than the read raw (C44).
      if (!blank) return { end: le, cut: false };
      if (le >= cap) return { end: le, cut: le < text.length };
      le = Math.min(cap, end + 2 * (le - end));
      continue;
    }
    const c = chainBack(t, i, Buffer.byteLength(t.slice(i, j).replace(/\0/g, ''), 'utf8'), fpMax, 0, -1, true);
    let k = c.at;
    while (k > 0 && ROW_LEAD.includes(t[k - 1]!)) k--;
    if (c.long || k > lead) return { end: le, cut: false };   // the chain read back from here starts after the cut
    if (le >= cap) return { end: le, cut: le < text.length };   // still across the cut at the cap
    le = Math.min(cap, end + 2 * (le - end));
  }
}
/** What a chain of key rows still may fill on from where it was cut (review 2370 F2): rows and units left, and `cont`: the
 *  last text read ended inside a row, so the next text begins with the rest of that row (C44). */
interface ChainLeft { rows: number; units: number; cont?: boolean }
/** Whether the row break that ends view `t` at `k` may be completed, or read again, by what comes after it (C44, review
 *  2430 F1): a CR (a LF after it makes CR LF) or a LF no CR comes before (blanks and a CR after it make one move down). */
function breakMayGoOn(t: string, k: number): boolean {
  return t[k - 1] === '\r' || (t[k - 1] === '\n' && t[k - 2] !== '\r');
}
/** Whether `text` ends inside a row: after its last row break, something but blanks and escapes (C44); or inside a row
 *  break, or right after one the next text may complete (`breakMayGoOn`): a push cut between CR and LF, or between a move
 *  down and its CR, began the next text with the rest of the break, read as an empty row that ended the chain (review 2430
 *  F1). Unread (all blanks and escapes in its last 4 KiB) answers true, so a chain is never ended by a row it could not
 *  see begin. */
function endsInRow(text: string): boolean {
  const t = viewOf(text.slice(-4096), '\0').t;
  let k = t.length;
  while (k > 0 && (t[k - 1] === '\0' || t[k - 1] === ' ' || t[k - 1] === '\t')) k--;
  if (k === 0 || (t[k - 1] !== '\n' && t[k - 1] !== '\r')) return true;
  return breakMayGoOn(t, k) && (k === t.length || t[k - 1] === '\n');
}
/** The leading run of each row of `v` from `from` (joined across escapes as `joinBack` joins one), as spans of the text
 *  `v` views plus `base`, while `left` has rows and units (D-8710, review 2370 F2). `alone`: the rows on from a cut,
 *  where the chain ends at a row that holds more than its indent and one run, or none: the answer is where it ended
 *  (`to` while it may go on in the next text). */
function chainRowSpans(
  v: View, from: number, to: number, base: number, left: ChainLeft, alone: boolean, spans: [number, number][],
): number {
  const t = v.t;
  for (let a = from; a < to && left.rows > 0 && left.units > 0;) {
    let b = a;
    while (b < to && t[b] !== '\n' && t[b] !== '\r') b++;
    // The rest of a row the last text ended inside (`cont`): its run, if any, goes on with the chain's, and blanks and
    // escapes before its break end nothing. Read as a row of its own, the tail of a key's row left after a push that ended
    // inside it ended the chain, and the key's later rows went out raw (C44, measured at a 64 KiB hold).
    const cont = left.cont === true && a === from;
    left.cont = false;
    let s0 = a;
    while (s0 < b && ROW_LEAD.includes(t[s0]!)) s0++;
    let e0 = s0;
    for (;;) {
      while (e0 < b && !OPEN_DELIM.test(t[e0]!)) e0++;
      let n0 = e0;
      while (n0 < b && t[n0] === '\0') n0++;
      if (n0 === e0 || n0 >= b || OPEN_DELIM.test(t[n0]!)) break;
      e0 = n0;
    }
    if (e0 > s0) {
      const [x, y] = spanIn(v, s0, e0);
      spans.push([base + x, base + y]);
      if (!cont) left.rows--;
      // The run's own units, never the NUL each escape inside it reads as: a key coloured per character is twice its
      // length in the view, and counting the NULs stopped its rows half way (review 2411 F3).
      let nul = 0;
      for (let q = s0; q < e0; q++) if (t.charCodeAt(q) === 0) nul++;
      left.units -= e0 - s0 - nul;
    }
    if (b === to) { left.cont = true; return to; }   // the text ends inside this row: the next text goes on with it
    if (alone && (rowTextEnd(t, b) > e0 || (e0 === s0 && !cont))) return a;
    // On past the row break (and any that follow it, as blank rows), read as `ROW_BREAK` reads it: skipping LF and CR
    // alone stopped inside a move down then a CR (viewed LF, NUL, CR), read the NUL as an empty row and ended the chain,
    // so a key's later rows went out raw (review 2430 F1). A text that ends at a break the next may complete hands it on.
    a = b;
    for (let br = true; br && a < to;) {
      BREAK_AT.lastIndex = a;
      const m = BREAK_AT.exec(t);
      if (m === null) br = false; else a += m[0].length;
    }
    if (a >= to && breakMayGoOn(t, to)) left.cont = true;
  }
  return left.rows > 0 && left.units > 0 ? to : from;
}
/** The rows of the chain of key rows that ends `text` (its last run, or a run that ends its last row), back as far as a
 *  key that reaches the end can start (`chainBack`), as spans of `text` (review 2370 F2). */
function chainRowsBack(text: string, fpMax: number): [number, number][] {
  const spans: [number, number][] = [];
  const v = viewOf(text, '\0');
  let j = v.t.length;
  while (j > 0 && (v.t[j - 1] === '\n' || v.t[j - 1] === '\r' || ROW_LEAD.includes(v.t[j - 1]!))) j--;
  let i = j;
  while (i > 0 && !OPEN_DELIM.test(v.t[i - 1]!)) i--;
  if (i === j) return spans;
  const c = chainBack(v.t, i, Buffer.byteLength(v.t.slice(i, j), 'utf8'), fpMax, 0, -1, true);
  chainRowSpans(v, c.at, j, 0, { rows: KEY_ROWS_MAX, units: Infinity }, false, spans);
  return spans;
}
/** The rows on from `from` that a chain of key rows cut there still fills, as spans of `text`, read up to `limit` a hold's
 *  length at a time; `left` is spent as they are taken. True: the chain may go on past `limit`. A window with no row break
 *  ends outside an escape (`outsideEscape`): one cut inside an escape began the next window with the escape's tail, read
 *  as a run of its own, and the chain stopped there (review 2411 F3). */
function chainRowsOn(text: string, from: number, left: ChainLeft, spans: [number, number][], limit = text.length): boolean {
  while (from < limit && left.rows > 0 && left.units > 0) {
    const to = Math.min(limit, from + WHOLE_HELD_MAX);
    const nl = to < limit ? text.lastIndexOf('\n', to - 1) : to;
    const stop = nl > from ? nl : to < limit ? outsideEscape(text, to, from + 1) : to;
    const v = viewOf(text.slice(from, stop), '\0');
    const reached = chainRowSpans(v, 0, v.t.length, from, left, true, spans);
    if (reached < v.t.length) return false;
    if (stop >= limit) return true;
    from = text[stop] === '\n' ? stop + 1 : stop;   // the next window starts at the row after the break
  }
  return left.rows > 0 && left.units > 0;
}
/** `i`, or where the escape that `i` falls inside begins, never before `min` (review 2411 F3): an escape begun before `i`
 *  and not ended by it. A cut there leaves its head as text at the end of what is read before it and its tail as text at
 *  the start of what is read after. Read back over `ESC_CUT_BACK` units, and no further (review 2514 F12: an unbounded
 *  search for the last ESC read to the text's start): an escape longer than that is cut where it is. */
function outsideEscape(text: string, i: number, min: number): number {
  const from = Math.max(min, i - ESC_CUT_BACK);
  let e = i - 1;
  while (e >= from && text.charCodeAt(e) !== 0x1b) e--;
  if (e < from) return i;
  const u = UNFINISHED_ESC.exec(text.slice(from, i));
  return u === null ? i : Math.max(min, from + u.index);
}
const ESC_CUT_BACK = 4096;

/** Masks `text` for every egress of session-derived text. */
export class SecretMasker {
  private readonly db: DatabaseSync | null;
  private readonly token: () => string | null;
  private readonly requestRekey: () => Promise<FingerprintAnswer | null> | void;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** Current generation first; then every previous one whose rows are still held (D-5995). */
  private keys: Key[] = [];
  /** gen → fingerprints and byte lengths, mirrored from the table, with the retired rows (`retireSecret`) merged in. */
  private rows = new Map<string, GenRows>();
  /** The generations the TABLE holds rows of (the re-key's concern: a retired row is never re-keyed). */
  private tableGens = new Set<string>();
  /** The rows of lanes the operator removed (`retireSecret`), in memory only: they go on matching for the life of this
   *  process, and a restart forgets them, because the table no longer holds them and the slot file is gone. */
  private retired = new Map<string, GenRows>();
  /** The lanes retired in this process: the re-key never writes one back (a re-key that read the slot before its removal). */
  private retiredLanes = new Set<string>();
  private rekeyTimer: ReturnType<typeof setTimeout> | null = null;
  private rekeyInFlight = false;
  private rekeyDelay = REKEY_FIRST_MS;
  /** Moves whenever the keys or the rows change, so a mask computed once and reused (a broadcast's, D-5995) is
   *  recomputed under the keys that hold now. */
  private epoch = 0;

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
    this.epoch++;
    this.rows = new Map();
    this.tableGens = new Set();
    const add = (gen: string, fp: string, len: number): void => {
      let g = this.rows.get(gen);
      if (g === undefined) this.rows.set(gen, (g = { fps: new Set(), lens: new Set() }));
      g.fps.add(fp);
      g.lens.add(len);
    };
    for (const [gen, g] of this.retired) for (const fp of g.fps) for (const len of g.lens) add(gen, fp, len);
    if (this.db === null) return;
    const all = this.db.prepare('SELECT fp, gen, len FROM secret_fingerprints').all() as unknown as
      (FingerprintRow & { len: number })[];
    for (const r of all) {
      add(r.gen, r.fp, r.len);
      this.tableGens.add(r.gen);
    }
  }

  /** Rows of a generation other than the current one are held in the table (a retired row is never re-keyed). */
  private staleRows(): boolean {
    const cur = this.keys[0]?.gen;
    return cur !== undefined && [...this.tableGens].some((g) => g !== cur);
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
    this.epoch++;
    if (this.staleRows()) this.scheduleRekey(true);
  }

  /** Asks for the re-key now or on the backoff; never once `close` has run (review 1418 A1): a key sync after close (a held
   *  flush's `ingest`, a late mask) starts no request and no timer. */
  private scheduleRekey(now: boolean): void {
    if (this.closed || this.rekeyInFlight || this.rekeyTimer !== null) return;
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
      try { landed = a !== null && this.ingest(a, { rekey: true }); } catch { landed = false; }
      if (landed && !this.staleRows()) { this.rekeyDelay = REKEY_FIRST_MS; return; }
      // A closed masker retries nothing (`scheduleRekey`), so it logs no retry either (review 1426 F-G).
      if (this.closed) return;
      this.log(`[mask] the re-key for generation ${this.keys[0]?.gen ?? '-'} has not landed; retrying`);
      this.scheduleRekey(false);
    };
    (answer as Promise<FingerprintAnswer | null>).then(settle, () => settle(null));
  }

  /** Which keys and rows a mask is computed under: equal versions, equal masks of the same value (D-5995). The box
   *  token is read first, so a rotation moves it. */
  get version(): number {
    this.syncKeys();
    return this.epoch;
  }

  /** Stops the re-key retries and a held offer's (a test, or a server closing), after ONE LAST TRY at what is held (review
   *  1416 A-S4): a Remove's delete still waiting on a busy coord.db lands now, or, the database still busy, stays in the table
   *  and is said in one line (its rows go on masking the removed value; nothing leaves). */
  close(): void {
    if (this.rekeyTimer !== null) clearTimeout(this.rekeyTimer);
    this.rekeyTimer = null;
    if (this.heldTimer !== null) clearTimeout(this.heldTimer);
    this.heldTimer = null;
    this.closed = true;
    this.flushHeld();
  }
  /** Set by `close`: a failed flush is never retried after it, and no re-key is asked for (`scheduleRekey`). */
  private closed = false;

  /** Writes the CURRENT generation's fingerprints (A12's `reloadRoster` calls it, through `offer`, with every answer's
   *  `fingerprints`, and the re-key lands here). An answer keyed with any other generation is refused and changes
   *  nothing (D-5995). Each lane the answer NAMES has every row of every generation replaced by the answer's; a lane
   *  it does not name keeps its rows, and the previous token that keys them is kept while they last, so a re-key
   *  answered without one lane (its secret file unreadable at that moment) never unmasks that lane's key (D-5995 (10),
   *  D-6057 (2)). True: it landed. Throws when coord.db stays locked past `INGEST_BUSY_MS`.
   *
   *  `rekey` (the re-key's answer, review 1391 F1): an operator-secret lane is only FILLED, never replaced. When the table
   *  already holds a row of the current generation for it (a save under the current token wrote it, and the re-key may have
   *  read the slot before that save's value was in place), that row stays, the row the re-key read is ADDED beside it, and
   *  the lane's rows of every OTHER generation are deleted (review 1418 F1): the re-key read the slot, so its row speaks for
   *  the value those rows were kept for, and a beside row (`ingestSecret`'s `beside`) never stops the value on disk being
   *  carried to the current token. The lane is skipped when the operator removed it in this process. Decided inside the
   *  write's own transaction, so a save landing before or after the re-key ends the same: the save's row stands, and the
   *  value the re-key read is at worst masked too. A roster lane is replaced as before.
   *
   *  `beside` (`ingestSecret`'s, review 1416 F1): the answer's rows are ADDED to the lanes it names, and no row is deleted. */
  ingest(answer: FingerprintAnswer, o: { rekey?: boolean; beside?: boolean } = {}): boolean {
    this.syncKeys();
    const cur = this.keys[0];
    if (cur === undefined || this.db === null || answer.gen !== cur.gen) return false;
    const at = this.now();
    this.write((db) => {
      const del = db.prepare('DELETE FROM secret_fingerprints WHERE laneId = ?');
      const ins = db.prepare('INSERT OR REPLACE INTO secret_fingerprints (laneId, fp, gen, len, at) VALUES (?, ?, ?, ?, ?)');
      const current = db.prepare('SELECT 1 AS x FROM secret_fingerprints WHERE laneId = ? AND gen = ? LIMIT 1');
      const delOther = db.prepare('DELETE FROM secret_fingerprints WHERE laneId = ? AND gen <> ?');
      const skip = new Set<string>();
      for (const lane of new Set(answer.rows.map((r) => r.laneId))) {
        if (o.rekey === true && isOperatorSecretLane(lane)) {
          if (this.retiredLanes.has(lane)) { skip.add(lane); continue; }
          if (current.get(lane, cur.gen) !== undefined) { delOther.run(lane, cur.gen); continue; }
        }
        if (o.beside !== true) del.run(lane);
      }
      for (const r of answer.rows) if (!skip.has(r.laneId) && validRow(r)) ins.run(r.laneId, r.fp, cur.gen, r.len, at);
    });
    return true;
  }

  /**
   * Registers ONE secret this server holds itself (an operator-secret slot, plan PL6; spec §5), fingerprinted here under the
   * CURRENT box token and written through `ingest`, the table's one writer. It answers what happened, never a silent skip
   * (Review Focus 2): `masked`, or why not: the unpadded value is under `RUN_MIN_BYTES` (`too-short`) or over
   * `RUN_MAX_BYTES` (`too-long`), or there is no token, no table or the table stayed busy (`unregistered`), or the row landed
   * but the egress search cannot produce the value as one candidate (`not-one-run`, review 1391 F2). Never throws, and the
   * value is never logged or kept: only its HMAC and byte length are stored.
   *
   * `masked` IS MEASURED, not decided on byte length: once the row has landed, the value standing alone is searched exactly
   * as outgoing text is (`fingerprintSpans`, this file's one search), and `masked` means that search caught the whole value.
   * A value with a space, `:`, `=`, `,` or another delimiter the search splits on inside it, or before it, is never one
   * candidate in any text, so it answers `not-one-run`. Its row stays: it is harmless, and a re-save replaces it.
   *
   * `beside` (review 1416 F1): the row is added beside the lane's rows, never in place of them, for a save whose write could not
   * prove which value its slot holds, so the previous value stays masked too until a save that proves it replaces the lane.
   */
  ingestSecret(laneId: string, secret: string, o: { beside?: boolean } = {}): 'masked' | SecretUnmasked {
    this.syncKeys();
    const cur = this.keys[0];
    const row = fingerprintRow(cur?.token ?? '', laneId, secret);
    if (row.len < RUN_MIN_BYTES) return 'too-short';
    if (row.len > RUN_MAX_BYTES) return 'too-long';
    if (cur === undefined || this.db === null) return 'unregistered';
    try {
      if (!this.ingest({ gen: cur.gen, rows: [row] }, { beside: o.beside === true })) return 'unregistered';
    } catch {
      return 'unregistered';
    }
    // THE ROW HAS LANDED, and only now (review 1416 A-S4): the re-key may speak for the lane again, and a Remove's delete still
    // waiting must not take this row with it. A save refused above (too short, too long, unregistered) leaves both as they
    // were, so a re-key that read the removed value before its Remove can never write it back through a refused re-save, and
    // the removed value's row still leaves the table.
    this.retiredLanes.delete(laneId);
    this.held?.drop.delete(laneId);
    return this.catchesWhole(secret) ? 'masked' : 'not-one-run';
  }

  /** Whether the egress search, run over `secret` standing alone, masks the whole of it (its trailing `=` aside, as the
   *  fingerprint sets it aside): the measurement behind `ingestSecret`'s `masked`. */
  private catchesWhole(secret: string): boolean {
    const bare = secret.replace(/=+$/, '').length;
    try {
      return this.fingerprintSpans(secret, false, newBudget()).spans.some(([a, b]) => a === 0 && b === bare);
    } catch {
      return false;
    }
  }

  /**
   * RETIRES one operator-secret lane (the operator's Remove, programme item 9): its rows leave the table and are kept in this
   * process's memory only, so the removed value is still masked until the server restarts, and nothing reloads it after,
   * because the table no longer holds it and the slot file is gone, EXCEPT in the two arms that leave the rows in the table
   * (review 1418 A2): the failed SELECT below, and a delete still held when the process stops (`close` tries it once more; a
   * production stop never calls `close`). There the rows reload after a restart and go on masking the removed value (the safe
   * side) until a save replaces the lane, UNLESS a rotation came before that restart: previous box tokens are memory-only (this
   * module's header, A ROTATION …; review 1440 F5), so rows under one reload but match nothing, and only keep the re-key retrying (review 1426 F-E). Nothing on disk
   * is unmasked by it: the value file is gone. The re-key never writes the lane back in this process (`ingest`'s `rekey`),
   * unless a re-save un-retires it meanwhile (review 1426 F-H). A retired row keyed with a previous token matches while that
   * token is kept, which is while its generation holds rows (`syncKeys`).
   * The table's delete is held and retried, as a roster offer is, when coord.db is busy, and tried once more at `close`. Never
   * throws; a lane that is not an operator-secret lane is refused (false), so the roster's rows are never touched from here.
   *
   * ROWS THAT CANNOT BE READ ARE NEVER DELETED (review 1416 A-S5): when the SELECT fails, the lane's rows stay in the table and
   * no delete is queued, so they go on masking the removed value (the safe side), past a restart too, until a save replaces
   * the lane; the lane is still retired, so the re-key never writes it.
   */
  retireSecret(laneId: string): boolean {
    if (!isOperatorSecretLane(laneId)) return false;
    this.retiredLanes.add(laneId);
    if (this.db === null) return true;
    try {
      const rows = this.db.prepare('SELECT fp, gen, len FROM secret_fingerprints WHERE laneId = ?').all(laneId) as unknown as
        (FingerprintRow & { len: number })[];
      for (const r of rows) {
        let g = this.retired.get(r.gen);
        if (g === undefined) this.retired.set(r.gen, (g = { fps: new Set(), lens: new Set() }));
        g.fps.add(r.fp);
        g.lens.add(r.len);
      }
    } catch {
      this.log('[mask] a removed secret\'s fingerprints could not be read; they stay in the table and go on masking it');
      return true;
    }
    this.load();
    const held = this.held;
    this.held = { answer: held?.answer ?? null, keep: held?.keep ?? null, drop: new Set([...(held?.drop ?? []), laneId]) };
    if (this.heldTimer === null) this.flushHeld();
    return true;
  }

  /** Deletes every row of every lane outside `keep` (a lane the roster no longer has, or one whose entry holds no
   *  secret): A12's `reloadRoster` calls it, through `offer`. Throws as `ingest` does.
   *
   *  NEVER an operator-secret lane (`OPERATOR_SECRET_LANE_PREFIX`, plan PL6; review 1389 F1). Those rows are this server's
   *  own (`ingestSecret`), not the roster's, so the roster's keep set cannot speak for them: a keep set computed while the
   *  store could not be listed, or held across a save, would otherwise delete a live slot's row and unmask it. Nothing in
   *  ccrc's own prune is the operator's Remove (`retireSecret`), never this; `ingest` still replaces one when its lane is named. */
  retain(keep: ReadonlySet<string>): void {
    if (this.db === null) return;
    const lanes = (this.db.prepare('SELECT DISTINCT laneId FROM secret_fingerprints').all() as unknown as { laneId: string }[])
      .map((r) => r.laneId).filter((l) => !keep.has(l) && !isOperatorSecretLane(l));
    if (lanes.length === 0) return;
    this.write((db) => {
      const del = db.prepare('DELETE FROM secret_fingerprints WHERE laneId = ?');
      for (const l of lanes) del.run(l);
    });
  }

  /**
   * THE ROSTER'S ONE ENTRY (A12's `reloadRoster`; D-6057 (2)): ingests `answer` (when it carries fingerprints) and prunes every
   * lane outside `keep`, never blocking the event loop on a locked coord.db for more than `INGEST_BUSY_MS`. A write
   * that finds the database locked is held (the latest offer replaces an older held one, whose prune it subsumes and
   * whose fingerprints it carries forward when it names none) and retried on an unref'd timer with the re-key's
   * backoff until it lands. Never throws.
   *
   * An operator-secret lane in `answer` is DROPPED (review 1391 A-1): those rows are this server's own, so a box's roster
   * answer that names one can never replace a slot's row.
   */
  offer(answer: FingerprintAnswer | null, keep: ReadonlySet<string>): void {
    const held = this.held;
    const own = answer === null ? null : { gen: answer.gen, rows: answer.rows.filter((r) => !isOperatorSecretLane(r.laneId)) };
    this.held = { answer: own ?? held?.answer ?? null, keep, drop: held?.drop ?? new Set() };
    if (this.heldTimer === null) this.flushHeld();
  }

  /** What is waiting to be written: a roster answer, its prune (`keep`, null when only a retire is waiting) and the lanes the
   *  operator removed (`drop`). */
  private held: { answer: FingerprintAnswer | null; keep: ReadonlySet<string> | null; drop: Set<string> } | null = null;
  private heldTimer: ReturnType<typeof setTimeout> | null = null;
  private heldDelay = REKEY_FIRST_MS;

  private flushHeld(): void {
    const h = this.held;
    if (h === null) return;
    try {
      if (h.answer !== null) this.ingest(h.answer);
      if (h.keep !== null) this.retain(h.keep);
      if (h.drop.size > 0) {
        this.write((db) => {
          const del = db.prepare('DELETE FROM secret_fingerprints WHERE laneId = ?');
          for (const l of h.drop) del.run(l);
        });
      }
      this.held = null;
      this.heldDelay = REKEY_FIRST_MS;
    } catch {
      if (this.closed) {
        this.log('[mask] coord.db was busy at close; what was held (a roster answer, a removed secret\'s delete) was not written');
        return;
      }
      this.log('[mask] coord.db was busy; the roster\'s fingerprints are held and retried');
      const delay = Math.round(this.heldDelay * (0.75 + Math.random() * 0.5));
      this.heldDelay = Math.min(this.heldDelay * 2, REKEY_MAX_MS);
      this.heldTimer = setTimeout(() => { this.heldTimer = null; this.flushHeld(); }, delay);
      this.heldTimer.unref?.();
    }
  }

  /** One write transaction on coord.db under a short busy timeout (`INGEST_BUSY_MS`), the connection's own restored
   *  after, then the in-memory mirror reloaded and the previous keys trimmed to those whose rows remain. A
   *  `BEGIN IMMEDIATE` that stays busy throws and changes nothing (D-5995 (10)). */
  private write(body: (db: DatabaseSync) => void): void {
    const db = this.db!;
    const prior = (db.prepare('PRAGMA busy_timeout').get() as { timeout: number } | undefined)?.timeout ?? 0;
    db.exec(`PRAGMA busy_timeout = ${INGEST_BUSY_MS}`);
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        body(db);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(prior))}`);
    }
    this.load();
    const cur = this.keys[0];
    this.keys = this.keys.filter((k) => k === cur || this.rows.has(k.gen));
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
    /** Each candidate's original spans are worked out only for one that matched (D-8710: a key's row join can hold
     *  scores of pieces, and most candidates match nothing). */
    const occ = new Map<string, { at: number; text: string | null; bytes: number; v: View; pieces: readonly [number, number][] }>();
    let seen = 0;
    /** The bytes of the row join's candidates of three or more rows this pass has collected (D-8710). */
    let chainSeen = 0;
    const textOf = (v: View, pieces: readonly [number, number][]): string =>
      (pieces.length === 1 ? v.t.slice(pieces[0]![0], pieces[0]![1]) : pieces.map(([a, b]) => v.t.slice(a, b)).join(''));
    /** Records one candidate occurrence, counting the new ones of this pass in `seen`. Its id is its original spans, so
     *  the two views of a text count a candidate they share once (D-5995); a candidate of three or more pieces is named
     *  by its view (`vi`), its original first and last bytes and its count of pieces instead, which name one candidate
     *  within one view (the count fixes its rows, its last byte its trim), so the other view's candidate of the same
     *  bounds, a different text where an escape splits a row, is never taken for it (D-8710, the security review). */
    const consider = (v: View, pieces: readonly [number, number][], vi = 0): void => {
      let n = 0;
      for (const [a, b] of pieces) n += b - a;
      if (n > maxLen || n * 3 < minLen || (ascii && !lens.has(n))) return;
      // An ASCII candidate's bytes are its units, so its text is built only if it is hashed.
      const text = ascii ? null : textOf(v, pieces);
      const bytes = text === null ? n : Buffer.byteLength(text, 'utf8');
      if (!lens.has(bytes)) return;
      const first = spanIn(v, pieces[0]![0], pieces[0]![1]);
      const id = pieces.length <= 2 ? pieces.map(([a, b]) => spanIn(v, a, b).join(',')).join(';')
        : `${vi}:${first[0]},${spanIn(v, pieces[pieces.length - 1]![0], pieces[pieces.length - 1]![1])[1]},${pieces.length}`;
      if (occ.has(id)) return;
      occ.set(id, { at: first[0], text, bytes, v, pieces });
      seen++;
      if (pieces.length > 2) chainSeen += bytes * live.length;
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
    for (const [vi, v] of views.entries()) {
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
      // A key wrapped onto rows (D-5995, D-8710): a run that ends its row, joined with the next row's leading run, and
      // on with the leading run of each further row while the run before FILLS its row (its row's text ends with it and
      // the row break follows), as many rows as a key can span: a key a program drew across three or more rows was
      // shown whole when only the next row was joined (review 2326 F3). One read back gives the head's fine run start
      // and, read on from there, its coarse one (D-5995: the same starts as two reads). The rows after the head are
      // walked once: each break's leading run, whether it fills its row, and a prefix sum of their lengths, so a chain
      // is searched for each held length by one binary search, never walked run by run (linear in the text).
      seen = 0;
      const brk: number[] = []; const brkEnd: number[] = [];
      LINE_BREAK.lastIndex = 0;
      for (let m = LINE_BREAK.exec(t); m !== null; m = LINE_BREAK.exec(t)) { brk.push(m.index); brkEnd.push(m.index + m[0].length); }
      const nb = brk.length;
      if (nb === 0) continue;
      /** Break i's next row: its leading run [ra, rb) (ra -1: none), and whether that run fills its row. */
      const ra = new Int32Array(nb); const rb = new Int32Array(nb); const fills = new Uint8Array(nb);
      for (let i = 0; i < nb; i++) {
        ROW_INDENT_OPT.lastIndex = brkEnd[i]!;
        const at = brkEnd[i]! + ROW_INDENT_OPT.exec(t)![0].length;
        TOKEN_RUN.lastIndex = at;
        const run = TOKEN_RUN.exec(t);
        if (run === null) { ra[i] = -1; continue; }
        ra[i] = at; rb[i] = at + run[0].length;
        fills[i] = i + 1 < nb && rowTextEnd(t, brk[i + 1]!) === rb[i]! ? 1 : 0;
      }
      /** P[i]: the units of the leading runs of breaks 0..i-1 (a run is ASCII, so its units are its bytes). */
      const P = new Float64Array(nb + 1);
      for (let i = 0; i < nb; i++) P[i + 1] = P[i]! + (ra[i]! < 0 ? 0 : rb[i]! - ra[i]!);
      /** last[i]: the last break whose leading run a chain from break i reaches. */
      const last = new Int32Array(nb);
      // A row the chain runs THROUGH holds `WRAP_ROW_MIN` units or more: nothing wraps a key that narrow, and a listing
      // of short lines (numbers, short words) would otherwise chain every row into candidates of every held length.
      for (let i = nb - 1; i >= 0; i--) {
        last[i] = fills[i] === 1 && rb[i]! - ra[i]! >= WRAP_ROW_MIN && i + 1 < nb && ra[i + 1]! >= 0 ? last[i + 1]! : i;
      }
      /** The trailing ASCII punctuation of break m's run a candidate may be trimmed of. */
      const trailPunct = (m: number): number => {
        let r = 0;
        while (r < TRIM_MAX && rb[m]! - r > ra[m]! && isPunct(t.charCodeAt(rb[m]! - r - 1))) r++;
        return r;
      };
      chainSeen = 0;
      const rowBytesLeft = budget.rowBytes ?? Infinity;
      for (let i = 0; i < nb && seen < limit && chainSeen <= rowBytesLeft; i++) {
        if (ra[i]! < 0) continue;
        const e = rowTextEnd(t, brk[i]!);
        const aFine = runStartBefore(t, e, true, longest + 1);
        if (e - aFine > longest) continue;
        const aCoarse = runStartBefore(t, aFine, false, longest + 1 - (e - aFine));
        if (aCoarse === e) continue;
        for (const a of aCoarse === aFine ? [aFine] : [aCoarse, aFine]) {
          if (a === e || e - a > longest) continue;
          for (const h of trims(t, a, e, true, false)) {
            if (h[1] - h[0] > maxLen) continue;
            const hl = ascii ? h[1] - h[0] : Buffer.byteLength(t.slice(h[0], h[1]), 'utf8');
            for (const len of lens) {
              const need = len - hl;   // what the rows after the head give, less the last run's trailing trim
              const end = Math.min(last[i]!, i + KEY_ROWS_MAX - 2);   // the head's row and the rows after it
              if (need <= 0 || P[end + 1]! - P[i]! < need) continue;
              // The first break m whose chain through its run gives `need` units or more.
              let lo = i; let hi = end;
              while (lo < hi) { const mid = (lo + hi) >> 1; if (P[mid + 1]! - P[i]! >= need) hi = mid; else lo = mid + 1; }
              for (let m = lo; m <= end && P[m + 1]! - P[i]! - need <= TRIM_MAX; m++) {
                const y = P[m + 1]! - P[i]! - need;
                if (y >= rb[m]! - ra[m]!) continue;
                // Every depth of the trim in an ASCII text; otherwise none or the whole punctuation run (`trims`).
                const tp = y === 0 ? 0 : trailPunct(m);
                if (y > tp || (!ascii && y !== 0 && y !== tp)) continue;
                const pieces: [number, number][] = [h];
                for (let k = i; k < m; k++) pieces.push([ra[k]!, rb[k]!]);
                pieces.push([ra[m]!, rb[m]! - y]);
                consider(v, pieces, vi);
              }
            }
          }
        }
      }
    }
    const all = [...occ.values()].sort((x, y) => x.at - y.at);
    let at = all.length > cap ? cap : -1;
    let rowBytes = budget.rowBytes ?? Infinity;
    for (let k = 0; k < (at < 0 ? all.length : at); k++) {
      const o = all[k]!;
      if (o.pieces.length <= 2) continue;
      rowBytes -= o.bytes * live.length;
      if (rowBytes < 0) { at = k; break; }
    }
    const cut = at < 0 ? null : all[at]!.at;
    const kept = at < 0 ? all : all.slice(0, at);
    budget.left = cut === null ? budget.left - kept.length * live.length : 0;
    if (budget.rowBytes !== undefined) budget.rowBytes = cut === null ? rowBytes : 0;
    const verdict = new Map<string, boolean>();
    const spans: [number, number][] = [];
    for (const o of kept) {
      const text = o.text ?? textOf(o.v, o.pieces);
      let hit = verdict.get(text);
      if (hit === undefined) verdict.set(text, (hit = live.some(({ key, fps }) => fps.has(hasherOf(key).of(text)))));
      if (hit) for (const [a, b] of o.pieces) spans.push(spanIn(o.v, a, b));
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
      const e = rowTextEnd(t, b.index);
      const a = runStartBefore(t, e, false, Infinity);
      if (a < e) { best = Math.min(best ?? Infinity, a); break; }
    }
    return best;
  }

  /** `text` masked, and whether a shape ran to its text's last row (the drawer carries it into the next chunk). */
  maskWithCarry(text: string, opts: MaskOpts = {}): {
    text: string; carry: boolean; cut: boolean; ahead: [number, number][];
  } {
    if (text === '') return { text, carry: opts.leadingWrap === true, cut: false, ahead: [] };
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
    // The text's leading run continues a run the last text masked: a fail-closed tail or a mask that reached its end
    // (`leadingTaint`), or a shape that ran to its last row's end (`leadingWrap`). So do the rows it runs on into (D-8710):
    // on through every next row while each is as full as the row before the first (`runOnRows`, the shapes' own walk),
    // read on the context and the text together, so a key whose start the context no longer holds is masked to its end.
    let runCarry = false;
    if (opts.leadingTaint === true || (rows && opts.leadingWrap === true)) {
      const w = viewOf(ctx + text, '\0');
      const t0 = viewIndexOf(w, off);
      const put = (a: number, b: number): void => clip([spanIn(w, a, b)]);
      const r = rows ? new Rows(w.t) : null;
      if (opts.leadingTaint === true) {
        let k = t0;
        while (k < w.t.length && !OPEN_DELIM.test(w.t[k]!)) k++;
        if (k > t0) {
          put(t0, k);
          if (r !== null && runOnRows(w.t, k, r.prevWidth(k - 1), r, put, false)) runCarry = true;
        }
      }
      if (r !== null && opts.leadingWrap === true) {
        const lead = LEADING_BREAK.exec(w.t.slice(t0))![0].length;
        let first = leadingRun(w.t, t0 + lead);
        if (first === null && lead === 0) {
          // The row break and the indent were the last text's (D-8710): the run starts this text.
          let k = t0;
          while (k > 0 && ROW_LEAD.includes(w.t[k - 1]!)) k--;
          if (k < t0 && k > 0 && (w.t[k - 1] === '\n' || w.t[k - 1] === '\r')) {
            TOKEN_RUN.lastIndex = t0;
            const run = TOKEN_RUN.exec(w.t);
            if (run !== null) first = [t0, t0 + run[0].length];
          }
        }
        if (first !== null) {
          put(first[0], first[1]);
          if (runOnRows(w.t, first[1], r.prevWidth(first[0]), r, put, false)) runCarry = true;
        }
      }
    }
    const fp = spent === null ? this.fingerprintSpans(full, rows, budget) : { spans: [], cut: full.length };
    clip(fp.spans);
    for (const [a, b] of opts.ahead ?? []) if (a < text.length) spans.push([a, Math.min(b, text.length)]);
    // What a match reaches of the lookahead, as spans of it: the drawer masks them when it sends that text (`ahead`).
    const end = off + text.length;
    const ahead: [number, number][] = [];
    if (full.length > end) for (const [a, b] of [...shapes.spans, ...fp.spans]) if (b > end) ahead.push([Math.max(a, end) - end, b - end]);
    if (opts.failClosedTail === true) {
      const v = viewOf(full, '\0');
      const p = failClosedStart(v.t, this.fingerprintMax());
      if (p !== null) clip([[origin(v, p), full.length]]);
    }
    // A cut inside the lookahead is the next slice's: this text is whole (its budget is spent, so that one is cut).
    const cutAt = fp.cut !== null && fp.cut - off < text.length ? fp.cut : null;
    const limit = cutAt === null ? text.length : Math.max(0, cutAt - off);
    const masked = spliceMasked(text, spans, limit, opts.mark);
    const carry = opts.carryAtText === true && (opts.lookahead ?? '') !== '' && spent === null
      ? shapeSpans(ctx + text, rows, SHAPES).carry : shapes.carry;
    return {
      text: cutAt === null ? masked : masked + SECRET_MASK_TOO_LARGE, carry: cutAt === null && (carry || runCarry),
      cut: cutAt !== null, ahead,
    };
  }

  /** A long text (pane history) masked in slices at line breaks, yielding to the event loop between them, so no slice
   *  blocks it past the 25 ms bound (D-5995). Each slice reads the raw text on both sides of it (`lookaheadEnd`), a match
   *  that reaches past its end is masked in the next slice too (`ahead`), and one budget covers them all; once it cuts,
   *  the rest is the too-large notice. The same answer as `maskText` but for that overlap, and for a chain of key rows
   *  past the lookahead's cap, whose rows go out masked (review 2370 F2). */
  async maskTextSliced(text: string, opts: { rows?: boolean } = {},
    pause: () => Promise<void> = () => new Promise((r) => setImmediate(r))): Promise<string> {
    if (text.length <= SLICE_UNITS) return this.maskText(text, opts);
    const budget = newBudget();
    const fpMax = opts.rows === true ? this.fingerprintMax() : null;
    const out: string[] = [];
    let carry = false;
    let ahead: [number, number][] = [];
    /** A chain of key rows cut at an earlier slice's cap: what it may still fill on from this slice's start. */
    let open: ChainLeft | null = null;
    for (let at = 0; at < text.length;) {
      let end = Math.min(text.length, at + SLICE_UNITS);
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end - 1);
        // A slice ends at a row break, or else outside an escape: a cut inside one read its tail as a run of its own
        // after the cut and its head as text before it, so neither side could follow the row (review 2411 F3).
        if (nl > at) {
          // At the end of the row break that LF is in, as `ROW_BREAK` reads it: a LF then a CR is one row down, and a cut
          // between them began the next slice with the CR, an empty row that ended the key's rows (C44). Read within
          // `BREAK_CUT_MAX` bytes of the LF only, so blanks between it and a CR never stretch a slice or its read, and read
          // through the escape view, as every row reader reads a break: an escape between the LF and its CR is part of it.
          // A break longer than that is cut after the LF, and the lookahead reads the rest of it (the blanks and the CR the
          // next slice begins with) as part of the break, not as an empty row: read as one, a LF, 64 blanks or more and a
          // CR ended the key's rows at the cut, and the whole key went out raw (C45, review 2445 F1, `pane-cut-long-break`).
          end = sliceCutAt(text, nl);
        } else {
          end = outsideEscape(text, end, at + 1);
        }
      }
      const la = end < text.length ? lookaheadEnd(text, end, fpMax) : { end, cut: false };
      // The rows of a chain an earlier cap cut, on through this slice: masked, never raw (review 2370 F2), however many
      // slices the chain runs through (review 2411 F3: carried one window only, the rest of a key coloured per character
      // on one joined row went out raw). Read over this slice only, so the cost stays a slice's.
      if (open !== null) {
        const spans: [number, number][] = [];
        if (!chainRowsOn(text, at, open, spans, end)) open = null;
        for (const [a, b] of spans) ahead.push([a - at, b - at]);
      }
      // Past the cap, with the chain still across the cut: its rows go out masked on both sides (review 2370 F2), back
      // from the cut here and on from it in the slices after.
      if (la.cut && fpMax !== null) {
        for (const [a, b] of chainRowsBack(text.slice(at, end), fpMax)) ahead.push([a, b]);
        open = { rows: KEY_ROWS_MAX, units: fpMax + 2 * TRIM_MAX, cont: endsInRow(text.slice(at, end)) };
      }
      const r = this.maskWithCarry(text.slice(at, end), {
        rows: opts.rows, leadingWrap: carry, budget, ahead,
        context: text.slice(Math.max(0, at - SLICE_OVERLAP), at), lookahead: text.slice(end, la.end),
      });
      out.push(r.text);
      if (r.cut) break;
      carry = r.carry;
      // A key a match found across the cut is masked in the next slice too, whatever its context (review 2370 F2).
      const later: [number, number][] = [];
      for (const [a, b] of ahead) if (b > end - at) later.push([Math.max(a, end - at) - (end - at), b - (end - at)]);
      ahead = [...later, ...r.ahead];
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
    const budget = newBudget();
    return walkStrings(value, (s) => this.maskWithCarry(s, { budget }).text) as T;
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
 *  `eyJ` at a boundary), an open Codex token value, a run that ends the chunk's last row (`rowTailAt`), or, while
 *  fingerprints are held, any open run. In the shape-only
 *  mode an ordinary run (a word, a path, a keystroke's echo) is never held: a shape a cut splits ahead of `sk-` is
 *  matched across the cut by the drawer's context. `null`: that tail is longer than a drawer holds. Only the end of
 *  the text is scanned. */
/** An escape whose final byte has not arrived yet, at the end of a text. A string escape (OSC, DCS, SOS, PM, APC) is
 *  unfinished until its whole terminator: a text that ends in the ESC of its ST (`ESC \\`) is the string escape from its
 *  start, never a lone ESC after text (D-8710: a chunk cut between the two bytes of an OSC 8 hyperlink's ST read the
 *  hyperlink's opening as text, held nothing, and drew a key's row before its next rows; found in the fix round of
 *  review 2352). */
const UNFINISHED_ESC = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*\x1b?|[PX^_][^\x1b]*\x1b?|[ -/]*)?$/;
/** The shortest run before a row end the drawer holds while fingerprints are held (D-5995): fewer bytes never
 *  identify a key, and a quiet line end of a shorter last word is drawn at once. */
const ROW_TAIL_MIN_BYTES = 8;
/** The start of the row break that ends at `j` (`t[j - 1]` its last byte), read back the way `ROW_BREAK` reads it
 *  forward, or null: no row break ends there. One family differs (review 2445 F2, pinned by mask-break-grammar's brute
 *  force): a CR LF, blanks or none, then a CR. Forward that is the CR LF, a blank row and a CR; back from the CR it is
 *  LF, blanks, CR, one break that starts at the CR LF's LF. Kept, as it fails closed: a reader that steps back over
 *  breaks (the cap's step back) reaches the row before the blank row and reads its run, a chain that can only mask
 *  more; a reader that stops at the start (`chainBack`, `rowTailAt`) finds the CR LF's CR before it, text that is no
 *  run, and ends there as it does forward. A CR CR LF reads back from its LF to its first CR, unless that CR ends a LF,
 *  blanks, CR break (a LF that no CR comes before: a CR right before a LF is always in the break that LF ends): then
 *  the break is the CR LF after it, as forward (C45 fix round, review 2514 F1). An index where no forward break ends
 *  (a LF a CR may follow) answers the start of the break it would be in: every caller passes a break's end or a text's
 *  end, where the next byte may complete it (review 2514 F7). */
export function breakStartAt(t: string, j: number): number | null {
  const c = t[j - 1];
  if (c === '\n') {
    if (j < 2 || t[j - 2] !== '\r') return j - 1;
    if (j < 3 || t[j - 3] !== '\r') return j - 2;
    let k = j - 3;
    while (k > 0 && (t[k - 1] === ' ' || t[k - 1] === '\t' || t[k - 1] === '\0')) k--;
    return k > 0 && t[k - 1] === '\n' && t[k - 2] !== '\r' ? j - 2 : j - 3;
  }
  if (c !== '\r') return null;
  let k = j - 1;
  while (k > 0 && (t[k - 1] === ' ' || t[k - 1] === '\t' || t[k - 1] === '\0')) k--;
  return k > 0 && t[k - 1] === '\n' ? k - 1 : j - 1;   // a LF, blanks, then this CR: one row down (D-8710)
}
const ROW_LEAD = ' \t\0│┃|';
/** Where a text that ends in a run, its row end and the next row's indent (nothing of that row's run yet) should be
 *  held from (D-5995), or null: a run that has begun a shape (from its `sk-` or `eyJ`), or, while fingerprints are
 *  held (`fpMax`), a run of a length that could be a key's first row. The TUI writes the wrapped next row after it,
 *  and a held run is masked together with that row's leading run; one sent at once would show its bytes.
 *
 *  A key can span more than two rows (D-8710, review 2326 F3): while fingerprints are held, the run is held together
 *  with the rows it continues, back through every row that holds nothing but its indent and one run, whose row before
 *  ends in a run, until those rows hold the most a key and its trims can (`fpMax + 2 * TRIM_MAX` bytes). A key that
 *  reaches the next rows starts within that much of the end, so every row it can touch is held, and the rows sent
 *  before the hold are masked with the held rows read after them (`DrawerMask.out`'s lookahead). Holding only the last
 *  row's run sent the rows before it alone, unjoined, and drew a key's first row in full even on two rows (measured,
 *  through a real tmux). `floor`: the first index a hold may start at (never inside text already sent). */
function rowTailAt(
  t: string, fpMax: number | null, floor = 0, head = -1, open = false,
): { at: number; proven: boolean } | null {
  let j = t.length;
  while (j > 0 && ROW_LEAD.includes(t[j - 1]!)) j--;
  if (j === 0) return null;
  let br = breakStartAt(t, j);
  // Two CRs at the text's end: the next byte may make them a CR CR LF, one row down, so the row before them ends here.
  // Read as two breaks, an empty row between, nothing was held and a key's rows went out alone (review 2514 F2).
  if (br === j - 1 && j === t.length && t[j - 2] === '\r') br = breakStartAt(t, j - 1);
  if (br === null) {
    // No row break yet, but the run ends in blanks (an erase, padding) at the text's end: its row end may be the next
    // chunk's first bytes, and its key's next row after it (D-8710). Held while fingerprints are; a shape that reaches
    // the text's end carries into the next text already (`shapeSpans`'s carry).
    if (fpMax === null || j === t.length) return null;
    j = rowTextEnd(t, j);
  } else {
    j = rowTextEnd(t, br);
  }
  let i = j;
  while (i > 0 && j - i <= DRAWER_HELD_MAX && !OPEN_DELIM.test(t[i - 1]!)) i--;
  if (i === j) return null;
  // A run sent whole before `floor` is not held again: a row end alone never delays (an Enter's echo). One that reaches
  // past it is held from it, never from where it began: text a BEL-ended hyperlink's tail left in the 64 bytes of sent
  // text reads as the start of the key's row, and that row went out unheld (review 2411 F1).
  if (j <= floor) return null;
  const run = t.slice(i, j);
  const sh = SHAPE_STARTED.exec(run);
  // A run that already matches a shape is masked on its own, and its wrapped next row by the shape's carry.
  if (sh !== null) return matchesShape(run) ? null : { at: Math.max(floor, i + sh.index), proven: true };
  if (fpMax === null) return null;
  const n = Buffer.byteLength(run, 'utf8');
  if (n > fpMax + TRIM_MAX) return null;
  const c = chainBack(t, i, n, fpMax, floor, head, open);
  return c.bytes >= ROW_TAIL_MIN_BYTES && !c.long ? { ...c, at: Math.max(c.at, floor) } : null;
}

/** Where a hold of the run at `at` (`n` bytes) starts once the rows that run continues are held with it (D-8710): back
 *  through every row that holds nothing but its indent and one run, whose row before ends in a run, until those rows
 *  hold the most a key and its trims can (`fpMax + 2 * TRIM_MAX` bytes) or `KEY_ROWS_MAX` rows. A key that reaches past
 *  the end starts within that much of it, so every row it touches is held; the rows sent before them are masked with
 *  the held rows read after them (`DrawerMask.out`'s lookahead). A run with text before it on its row begins no row a
 *  key wrapped onto, and stays where it is. `bytes`: the bytes held. `proven`: false when the walk stopped where it
 *  could not read whether the chain goes on (the window's first row, or a run joined across escapes past one run's
 *  hold); the caller reads the whole text again (`open`). `long`: the run is joined across escapes past any key. */
function chainBack(
  t: string, at: number, n: number, fpMax: number, floor: number, head = -1, open = false,
): { at: number; bytes: number; proven: boolean; long?: true } {
  const bound = fpMax + 2 * TRIM_MAX;
  let rows = 1;
  const joined = joinBack(t, at, open ? bound : null);
  if (joined.long) return { at, bytes: n, proven: true, long: true };
  // A run joined back past `floor` into text already sent is held from `floor`, the first byte not sent: what was sent
  // before it may be the tail of an escape the 64 bytes of sent text cut (the drawer's `lead`), read as a run, and a
  // stop there sent the held text's first row (review 2411 F1). Nothing before `floor` can be held, so the walk ends.
  const from = Math.max(joined.at, floor);
  if (from < at) { n += Buffer.byteLength(t.slice(from, at).replace(/\0/g, ''), 'utf8'); at = from; }
  if (joined.at < floor) return { at, bytes: n, proven: true };
  if (!joined.whole) return { at, bytes: n, proven: false };
  // `head`: the window's first row break (-1: the text is whole). The row before it began before the window, so nothing
  // read in it proves where the chain starts: an escape the window cut reads as text before a run, its tail as a run of
  // its own, and a run the window cut as a row's first (review 2352 F1: stopping at what the cut row seemed to say drew
  // a 1,600-byte key after a styled listing longer than the window at 2,457 of 4,427 cuts). Holding from the window's
  // first whole row did not fail closed either: the rows before it went out unjoined, a key not yet whole among them, and
  // the held rows later with 1 KiB of context, so the whole key could be drawn (review 2370 F2). So the walk reports the
  // stop, and the caller reads the whole text again, where the walk is bounded by the key's own length and rows only:
  // the units are the rows' own, never their indent or escapes (review 2352 F9).
  while (n < bound && rows < KEY_ROWS_MAX) {
    let k = at;
    while (k > 0 && ROW_LEAD.includes(t[k - 1]!)) k--;
    if (k <= head) return { at, bytes: n, proven: false };   // the window's first row: its start is not read
    if (k === 0) break;
    const pb = breakStartAt(t, k);
    if (pb === null) break;   // text before the run on its row
    const pe = rowTextEnd(t, pb);
    if (pe <= head) return { at, bytes: n, proven: false };   // the row before began before the window
    let ps = pe;
    while (ps > 0 && pe - ps <= DRAWER_HELD_MAX && !OPEN_DELIM.test(t[ps - 1]!)) ps--;
    if (ps === pe) break;   // the row before ends in no run
    const pj = joinBack(t, ps, open ? bound : null);
    if (pj.long || pe <= floor) break;   // a run past any key, or a row already sent
    // The row before joins back into text already sent (review 2411 F1): held from the first byte not sent, where the walk
    // ends. Stopping short of it sent this row, unjoined, before the key's later rows came, a row a push.
    const from = Math.max(pj.at, floor);
    n += Buffer.byteLength(t.slice(from, pe).replace(/\0/g, ''), 'utf8');
    at = from;
    rows++;
    if (pj.at < floor) return { at, bytes: n, proven: true };
    if (!pj.whole) return { at, bytes: n, proven: false };
    if (at === 0 || pe - at < WRAP_ROW_MIN) break;   // a row the join never runs through: it can only begin the key's rows
  }
  return { at, bytes: n, proven: true };
}

/** Where the run that starts at `i` in a NUL view starts once the escapes inside it are read away (D-8710): a run, then
 *  escapes and no blank or row break, then more of the run, is one run in the view the matcher also reads with escapes
 *  stripped. tmux re-sends a row's colour in the middle of it (after its own output buffer ends), and the hold that
 *  stopped at that escape sent the key's rows before it unjoined, drawing a 7,000-byte key whole through a real tmux
 *  (the fix round of review 2352). Read over what a drawer holds for one run (`whole` false past it); `units`: read
 *  over the whole text instead, until the run holds more than that many units (`long`: no key's). */
function joinBack(t: string, i: number, units: number | null = null): { at: number; whole: boolean; long?: true } {
  const from = i;
  let n = 0;
  for (;;) {
    let k = i;
    while (k > 0 && t[k - 1] === '\0') k--;
    if (k === i || k === 0 || OPEN_DELIM.test(t[k - 1]!)) return { at: i, whole: true };
    let j = k;
    while (j > 0 && (units !== null || from - j <= DRAWER_HELD_MAX) && !OPEN_DELIM.test(t[j - 1]!)) j--;
    if (units === null && from - j > DRAWER_HELD_MAX) return { at: i, whole: false };
    n += k - j;
    if (units !== null && n > units) return { at: i, whole: true, long: true };
    i = j;
  }
}

/** `rowTail`: also hold a run that ends its row (`rowTailAt`); off when a settled row end is being drawn.
 *
 *  The text's last `CHAIN_HELD_MAX + 64` bytes are read first (D-8710): a key's rows end in them, and a chain the walk
 *  can follow there costs no more than that. A chain the walk cannot prove starts there (it reaches the window's first
 *  row, a row that began before the window, or a run joined across escapes runs past one run's hold) is read again over
 *  the whole text (`whole`), and held from where it starts, so no row of a key is sent before the rows it continues
 *  into, however many escapes or blanks its rows carry (review 2370 F2: held from the window's first whole row, up to
 *  the whole key was drawn). Such a hold is at most `WHOLE_HELD_MAX`: past that (`past`) the text is sent with the
 *  chain's rows masked. */
function openTailAt(
  s: string, fpMax: number | null, ctx = '', rowTail = true, whole = false,
): number | null | { past: number } {
  const fingerprints = fpMax !== null;
  const base = whole ? 0 : Math.max(0, s.length - (CHAIN_HELD_MAX + 64));
  // What was sent just before is read with the text (a run `sk-` began in it is still open), never held again.
  const lead = base === 0 ? ctx.slice(-64) : '';
  const w = lead + s.slice(base);
  const esc = UNFINISHED_ESC.exec(w);
  const bodyEnd = esc === null ? w.length : esc.index;
  const v = viewOf(w.slice(0, bodyEnd), '\0');
  /** The first index of the view a hold may start at: never inside the lead, which was sent. */
  const floor = viewIndexOf(v, lead.length);
  // The window's first row break: the row before it began before the window (-1: the window is the whole text). A window
  // with no row break is all one row that began before it (review 2370 F3: read as the whole text, its first byte
  // proved where a run joined across escapes started, and a key coloured per character was drawn).
  const brk = base === 0 ? -1 : firstBreakIn(v.t);
  const head = base === 0 ? -1 : brk < 0 ? v.t.length : brk;
  // The open run is read over one run's hold, as before the window widened: one run longer than that is no key's, and is
  // never held (D-5995's bound on what a drawer holds; only a key's ROWS are held over the wider window).
  const runFloor = Math.max(0, v.t.length - (DRAWER_HELD_MAX + 64));
  let i = v.t.length;
  while (i > runFloor && !OPEN_DELIM.test(v.t[i - 1]!)) i--;
  const runTooLong = i === runFloor && runFloor > 0 && !OPEN_DELIM.test(v.t[i - 1]!);
  const run = v.t.slice(i);
  let hold: number | null = null;
  let proven = true;
  /** The hold is a run that ends its row (`rowTailAt`), not the text's open tail. */
  let rowHold = false;
  if (run !== '') {
    if (fingerprints) {
      // The open run, with the rows it continues (D-8710): holding the run alone sent the rows before it unjoined.
      if (runTooLong) return null;
      const c = chainBack(v.t, i, Buffer.byteLength(run, 'utf8'), fpMax, floor, head, whole);
      if (c.long) return null;   // no key's, as a run past one run's hold
      hold = c.at;
      proven = c.proven;
    } else {
      const sh = SHAPE_STARTED.exec(run);
      if (sh !== null) hold = i + sh.index;
    }
  }
  if (run === '' && rowTail) {
    // A run that ends its row, held only when it lies in this text: a row end alone never delays (an Enter's echo).
    const rt = rowTailAt(v.t, fpMax, floor, head, whole);
    if (rt !== null && origin(v, rt.at) >= lead.length) { hold = rt.at; proven = rt.proven; rowHold = true; }
  }
  if (!proven) return openTailAt(s, fpMax, ctx, rowTail, true);
  const cx = codexValueOpenAt(v.t);
  if (cx !== null && (hold === null || cx < hold)) { hold = cx; rowHold = false; }
  // An open tail that starts at the window's first byte is longer than the window: it goes now, the open tail failing
  // closed (`out`'s `failClosedTail`), masked in the push itself (review 2411 F7). Never a run that ends its row: the
  // fail-closed tail masks only the text's open tail, and a begun shape at the window's first byte that ends its row
  // before more than 9 KB of blanks went out raw, so its next row, drawn later, was matched by nothing (C44: 98 bytes
  // of a 108-byte shape key whose row ended after `sk-ant-api`). That hold starts at the window's first byte instead.
  if (hold === 0 && base > 0 && !rowHold) return null;
  const cut = Math.max(0, base + (hold === null ? bodyEnd : origin(v, hold)) - lead.length);
  // Past the most a drawer holds: the text up to its unfinished escape goes out with the chain's rows masked.
  return whole && s.length - cut > WHOLE_HELD_MAX ? { past: Math.max(0, base + bodyEnd - lead.length) } : cut;
}
/** Where `t`'s first row break begins, or -1. */
function firstBreakIn(t: string): number {
  const a = t.indexOf('\n');
  const b = t.indexOf('\r');
  return a < 0 ? b : b < 0 ? a : Math.min(a, b);
}

/** How many holds a withheld run that ended its row waits for a wrapped next row (D-5995): a TUI writes a
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

/** What a masked run reads as in the drawer (D-8694, desktop polish Task C39): ONE COLUMN, whatever it replaces.
 *  The drawer is a tmux client, and tmux places what follows a run where the run ended in its own picture, so a mark
 *  wider than the text it replaces runs on past it. `SECRET_MASK` is 15 columns: drawn for a key's row segment narrower
 *  than that in a row's last 14 columns (the head of a key a program broke across rows, or a whole short shape key), or
 *  for a short tail that text follows to the row's end, it ran past the right edge, the terminal wrapped, and every later
 *  relative move landed a row off, over the status row too (measured, `drawer-mask-screen.test.ts`). A mark as wide as
 *  the text would show the key's length, and one never wider than 15 columns but narrower for short text would show a
 *  bound on it, so the mark is one column for every run: never wider than any text, and the same whatever the key.
 *  U+2327 X IN A RECTANGLE BOX, East Asian Width Neutral, so no terminal draws it in two columns, and no glyph Claude
 *  Code's output uses. No SGR around it: a reset would clear the attributes of the text around it. Every other egress
 *  keeps `SECRET_MASK`; a run split across rows is one mark per row it touches, as before. */
export const DRAWER_SECRET_MASK = '\u2327';

/** The drawer is a byte stream. A chunk whose tail could start a secret holds that tail back until the next chunk, or
 *  for `holdMs` from the FIRST hold, so a secret split across two chunks is masked whole; every other chunk goes at
 *  once. What was sent stays as context for the next chunk. An expired hold fails closed: a begun shape, an open Codex
 *  value, or (fingerprints held) a run that could still be a key is WITHHELD until it ends, and the completed run is
 *  then drawn masked or not, as one chunk would have been (D-5995). So an ordinary path, sha, blob or word typed slowly
 *  reaches the screen unmasked once it is complete.
 *
 *  NOTHING IS DRAWN IN THE WITHHELD RUN'S PLACE (D-8665). The drawer is a tmux client, and tmux sends each redraw as
 *  cursor moves over its own picture of the client's screen, so a byte this class adds, or a mark wider than the run it
 *  stands for, moves the glass off that picture for good. A provisional `SECRET_MASK` used to be drawn here and erased
 *  with CUB and ECH: drawn for the date that ends tmux's status row (9 columns, against the mask's 15) it ran past the
 *  last column, the terminal wrapped and scrolled, and every later redraw landed a row off (measured through a real
 *  tmux, desktop polish Task C36). No mark can be drawn safely without knowing the cursor's column (a mark that reaches
 *  the right edge leaves the terminal's wrap pending, and neither CUB nor a saved cursor gets it back, measured on
 *  xterm), so a withheld run shows nothing until it resolves, and what reaches the terminal is the stream's own bytes
 *  unless a secret was masked in it (`drawer-mask-screen.test.ts`). */
export class DrawerMask {
  private held = '';
  private carry = false;
  private ctx = '';
  /** The run an expired hold withheld, while it is still open: nothing of it, nor anything after it, is sent yet. */
  private pending: string | null = null;
  /** A run past what a drawer holds ended in a mask: the next chunk's leading run continues it. */
  private taint = false;
  /** Every chunk the held tail came in was a keystroke's echo (D-5995): its expired hold keeps the 20-byte floor. */
  private heldTyped = true;
  /** Spans of the text still to be sent that a match in text already sent reached into (review 2370 F1), as spans of
   *  the next text `out` sends: it begins where the lookahead the match was read with began. */
  private ahead: [number, number][] = [];
  /** A chain of key rows sent masked past what a drawer holds: the rows still to come that go on with it are masked. */
  private chain: ChainLeft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly masker: SecretMasker, private readonly emit: (text: string) => void,
    private readonly holdMs: number) {}

  push(chunk: string): void {
    if (chunk === '') return;
    if (this.pending !== null) {
      const s = this.pending + chunk;
      // Still able to be a secret, by the rule that withheld it: keep withholding it. The context is
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
    this.route(this.held + chunk);
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
    const fpMax = this.masker.fingerprintMax();
    let p = failClosedStart(v.t, fpMax, this.heldTyped ? RUN_MIN_BYTES : 1);
    // With the rows that run continues (D-8710).
    const floor = viewIndexOf(v, lead.length);
    if (p !== null && fpMax !== null) p = chainBack(v.t, p, Buffer.byteLength(v.t.slice(p), 'utf8'), fpMax, floor, -1, true).at;
    // A run held at its row end (D-5995): withheld, and settled after the row settle when no
    // wrapped next row follows. Also when an escape has begun after it (D-8710): that escape may be the move to the
    // key's next row (a cursor position cut after its ESC), and drawing the run then showed a key's first row whole
    // after a gap of one hold (measured in the fix round of review 2352).
    const rowEnded = p === null ? rowTailAt(v.t, fpMax, floor, -1, true)?.at ?? null : null;
    if (rowEnded !== null && origin(v, rowEnded) >= lead.length) p = rowEnded;
    // A start inside the context: the run began before the held text, which is all of it.
    const cut = p === null ? null : Math.max(0, origin(v, p) - lead.length);
    if (cut === null) { this.out(h, false); this.held = tail; return; }
    if (cut > 0) this.out(h.slice(0, cut), false, h.slice(cut) + tail);
    this.pending = h.slice(cut) + tail;   // withheld, and nothing drawn in its place (D-8665)
    if (p === rowEnded) this.timer = setTimeout(() => { this.timer = null; this.settlePending(); }, ROW_SETTLE_HOLDS * this.holdMs);
  }

  /** The withheld run ended in blanks that nothing followed within the hold: resolve it now. */
  private settlePending(): void {
    if (this.pending === null) return;
    const s = this.pending;
    this.pending = null;
    this.route(s, false);   // settled: a run that ended its row is drawn, never held again
  }

  dispose(): void {
    this.stopTimer();
    this.held = '';
    this.ctx = '';
    this.pending = null;
    this.ahead = [];
    this.chain = null;
  }

  /** The withheld run has ended (or can no longer be a secret): draw the text as one
   *  chunk would have been drawn. */
  private resolve(s: string): void {
    this.route(s);
  }

  /** Sends `s` up to its open tail, and holds the tail. */
  private route(s: string, rowTail = true): void {
    this.held = '';
    const fpMax = this.masker.fingerprintMax();
    const cut = openTailAt(s, fpMax, this.ctx, rowTail);
    if (cut === null) {   // an open tail past the bound: sent now, failing closed on a begun secret
      this.stopTimer();
      this.out(s, true);
      return;
    }
    if (typeof cut === 'object') {
      // A chain of key rows past the most a drawer holds (`WHOLE_HELD_MAX`): its rows go out masked, and so do the rows
      // that go on with it in later text (review 2370 F2, failing closed as pane history's cap does).
      this.stopTimer();
      const sent = s.slice(0, cut.past);
      for (const span of chainRowsBack(sent, fpMax!)) this.ahead.push(span);
      this.out(sent, true, s.slice(cut.past));
      this.chain = { rows: KEY_ROWS_MAX, units: fpMax! + 2 * TRIM_MAX, cont: endsInRow(sent) };
      this.held = s.slice(cut.past);
      if (this.held !== '' && this.timer === null) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.holdMs);
      return;
    }
    if (cut > 0) this.out(s.slice(0, cut), false, s.slice(cut));
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

  /** `lookahead`: the text held after this one (D-8710): read with it and never sent, so a key whose rows the hold splits
   *  is matched whole and its rows before the hold are masked. */
  private out(text: string, failClosedTail: boolean, lookahead = ''): void {
    if (this.chain !== null) {
      // The rows that go on with a chain sent masked past the hold (review 2370 F2).
      const spans: [number, number][] = [];
      if (!chainRowsOn(text, 0, this.chain, spans)) this.chain = null;
      for (const span of spans) this.ahead.push(span);
    }
    const r = this.masker.maskWithCarry(text, {
      rows: true, leadingWrap: this.carry, context: this.ctx, failClosedTail, leadingTaint: this.taint, lookahead,
      carryAtText: true, mark: DRAWER_SECRET_MASK, ahead: this.ahead,
    });
    // A key a match found with the held rows read after this text is masked in them when they are sent, whatever
    // context they are sent with (review 2370 F1: a key whose hold began inside it drew its held rows, 10 to 5,000 bytes).
    const later: [number, number][] = [];
    for (const [a, b] of this.ahead) if (b > text.length) later.push([Math.max(a, text.length) - text.length, b - text.length]);
    this.ahead = [...later, ...r.ahead];
    this.carry = r.carry;
    const tv = viewOf(text, '').t;
    // What the output draws, its escapes read away (C44): a mark at the end or the start of a text is so whatever escapes
    // follow or precede it, as a key coloured per character masked across pushes has (one mark a push, measured, before).
    const rv = r.text.includes(DRAWER_SECRET_MASK) ? viewOf(r.text, '') : null;
    // The tainted leading run is the run the last text's mark already stands for: no second mark for it, so a run that
    // many chunks carry is one mark, as one chunk would have drawn it (D-8694's one mark per run on a row; D-8710).
    let shown = r.text;
    if (this.taint && tv !== '' && !OPEN_DELIM.test(tv[0]!) && rv !== null && rv.t.startsWith(DRAWER_SECRET_MASK)) {
      const k = rv.map === null ? 0 : rv.map[0]!;
      shown = r.text.slice(0, k) + r.text.slice(k + DRAWER_SECRET_MASK.length);
    }
    // A mask that reaches the text's end inside a run taints the next text's leading run (D-5995), and so on for as long
    // as the run goes on (D-8710, review 2326 O1): the next text's leading run continues it, whatever masked it (a shape,
    // a key, a fail-closed tail or this taint). Only a fail-closed tail used to taint, and only for one text, so a shape
    // key longer than a drawer holds was masked once and then drawn from the next chunk on, once the context no longer
    // held its start.
    this.taint = rv !== null && rv.t.endsWith(DRAWER_SECRET_MASK) && tv !== '' && !OPEN_DELIM.test(tv[tv.length - 1]!);
    this.ctx = (this.ctx + text).slice(-DRAWER_CONTEXT);
    if (shown !== '') this.emit(shown);
  }
}

/** The masker every egress falls back to when none is wired: the shapes, with no table and no token. */
export const SHAPE_ONLY_MASKER = new SecretMasker();
