// The private-name matcher: ONE tokenizer, hasher and matcher, shared by
// `topology-clean.test.ts`'s hashed class and the local scan the sweep reads.
//
// WHY HASHES. This repository is public, and a guard that spelled the names it
// forbids would itself publish them. So the committed entries are keyed hashes
// of a name's tokens, and the tree's tokens are hashed the same way and
// compared. That stops casual grepping and indexing; it does NOT keep a name
// secret — the salt is committed, so anyone can confirm a guess. Only names
// already public in this repository's history are committed as entries; a name
// that was never published stays in the operator's local list alone, read by
// the `scan` below and by the pre-push hook, never by a committed file.
//
// WHAT A TOKEN IS. A line is folded one code point at a time — NFKC (so a
// fullwidth or ligature form becomes its plain letters), Unicode hyphens to `-`,
// soft hyphens and zero-width characters dropped — then split at every camelCase
// boundary (`aB`, `9B`, and `ABc` before the `B`) and lower-cased; its tokens are
// the maximal `[a-z0-9]+` pieces. Each token records the JOINER before it: `-`,
// `.`, `_`, `·` or `case` (a camelCase boundary) join a run; `space` is
// whitespace only; `other` is anything else; `''` opens the line. An entry never
// matches inside a token (`zz-alpha` is not in `zz-alphabet`).
//
// MODES. `part` matches the entry's tokens as any window of a run, joined by
// any run joiner, so `Zz_Alpha`, `zz.alpha` and `zzAlpha` are one name and a
// compound id built on it is caught. `exact` is a window anywhere joined by the
// joiners the name is listed with, for a name another spelling of whose tokens
// is ordinary vocabulary. `run` is `exact` that must also be the WHOLE run (no
// run joiner on either side), for a name that is a fragment of longer product
// names. `words` matches a phrase whose tokens are joined by whitespace only.
// A list row commits up to three entries (`entriesOf`): its tokens split, its
// camelCase pieces merged, and all its tokens run together, because the tree
// writes one name all three ways (`ZzAlpha`, `zzalpha-42`, `zzalpha` in a slug).
//
// HOW A LINE IS READ (`hitsAt`): its split tokens, then — for a line with a
// camelCase boundary — every run of two or more consecutive camelCase pieces as
// one token against the single-token `part` entries (`useZzAlpha`,
// `ZZALPHAWidget`), then its camelCase pieces merged. A span is reported once.
//
// Nothing here ever returns or prints matched TEXT: a hit is the first 8 hex of
// the entry's hash (`#h8`), a path is printed with each hit replaced by its
// `#h8` (`maskText`), and the CLI prints `path:line #h8`. CI logs on a public
// repository are public.
//
// COST, measured 2026-10-18 on the fleet box at load 11-18: the class's work
// over the whole tree (2,720 text files, 122 MB, 1.9M lines) took 4.4-5.2 s per
// line pass, and 3.9-7.5 s with the cross-line and path checks; the class's tree
// row ran in 6.9 s inside vitest while it was red, formatting a 1,222-row diff
// included. The first version, split pass only, took 2.9-4.5 s. Vitest's
// per-test timeout here is 20 s.
//
// CLI (local, run from anywhere inside the clone):
//   node server/test/private-names.mjs hash --list <path>   the committed entries literal, `pub` rows only
//   node server/test/private-names.mjs scan --list <path>   every hit of every row, tracked text files and paths
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Committed, and so no secret: it makes the hashes this tree's own, nothing more. */
export const PRIVATE_NAME_SALT = 'ccrc-private-names/v1';

/** A synthetic name, the class's liveness and leak fixture. Built by join so no
 *  line of this tree spells it as one run: the line below tokenizes to three
 *  tokens joined by quotes and commas, which no `part` window crosses. */
export const CANARY = ['zq', 'canary', 'x7'].join('-');

/** @typedef {'part' | 'exact' | 'run' | 'words'} Mode */
/** @typedef {'' | '-' | '.' | '_' | '·' | 'case' | 'space' | 'other'} Joiner */
/** @typedef {{ h: string, f: string, n: number, mode: Mode }} Entry */
/** @typedef {{ t: string, start: number, joinerBefore: Joiner }} Token */
/** @typedef {{ h8: string, start: number, end: number, folded: string, origStart: number, origEnd: number }} Hit */

/** The modes, enumerated once. */
export const MODES = /** @type {const} */ (['part', 'exact', 'run', 'words']);

/** @param {string} text @returns {string} 32 lower-case hex */
export function hashEntry(text) {
  return createHmac('sha256', PRIVATE_NAME_SALT).update(text).digest('hex').slice(0, 32);
}

/** Joiners as small codes, the order of the `Joiner` type: 1-5 join a run. */
const JOINER_NAMES = /** @type {Joiner[]} */ (['', '-', '.', '_', '·', 'case', 'space', 'other']);
const J_CASE = 5, J_SPACE = 6, J_OTHER = 7;
/** What a run joiner spells inside an `exact` or `run` entry's hashed text. */
const JOINER_TEXT = ['', '-', '.', '_', '·', ''];
const joinsRun = (j) => j >= 1 && j <= 5;

/** The joiner code spelled by `s[from, to)`, the gap between two alnum runs. */
function joinerOf(s, from, to) {
  if (to - from === 1) {
    const c = s.charCodeAt(from);
    if (c === 45) return 1;
    if (c === 46) return 2;
    if (c === 95) return 3;
    if (c === 183) return 4;
    if (c === 32 || c === 9) return J_SPACE;
  }
  return /^\s+$/.test(s.slice(from, to)) ? J_SPACE : J_OTHER;
}

const NON_ASCII = /[^\x00-\x7f]/;
/** Hyphens that are not `-` (U+2010 hyphen, U+2011 non-breaking, U+2012 figure,
 *  U+2013 en dash, U+2212 minus, U+FE63 small hyphen-minus): each joins a name
 *  as `-` would. The em dash stays punctuation. */
const HYPHENS = /^[‐-–−﹣]$/;
/** Invisible characters that split a name without showing: soft hyphen,
 *  zero-width space/non-joiner/joiner, word joiner, BOM. Dropped. */
const INVISIBLE = /^[­​-‍⁠﻿]$/;

/** The folded line, and for a non-ASCII line the original offset of every
 *  folded character (`map[k]`, with `map[length]` the line's length), so a hit
 *  can be located — and masked — in the text as written. */
const RETYPED = /[\u00ad\u200b-\u200d\u2060\ufeff\u2010-\u2013\u2212\ufe63]/;
function foldMapped(line) {
  if (!NON_ASCII.test(line)) return { s: line, map: null };
  // Most non-ASCII lines (an em dash, an arrow, a middle dot) fold to themselves.
  if (!RETYPED.test(line) && line.normalize('NFKC') === line) return { s: line, map: null };
  const parts = [];
  const map = [];
  for (let k = 0; k < line.length;) {
    const c = line.charCodeAt(k);
    if (c < 128) { parts.push(line[k]); map.push(k); k++; continue; }
    const w = line.codePointAt(k) > 0xffff ? 2 : 1;
    const ch = line.slice(k, k + w);
    const f = INVISIBLE.test(ch) ? '' : HYPHENS.test(ch) ? '-' : ch.normalize('NFKC');
    for (let q = 0; q < f.length; q++) map.push(k);
    parts.push(f);
    k += w;
  }
  map.push(line.length);
  return { s: parts.join(''), map };
}

const isUpper = (c) => c >= 65 && c <= 90;
const isLower = (c) => c >= 97 && c <= 122;
function isAlnum(c) {
  return isLower(c) || isUpper(c) || (c >= 48 && c <= 57);
}

/** The tokenizer's one implementation. It writes each token's span, joiner and
 *  two independent 32-bit hashes of its lower-cased text into reusable typed
 *  arrays, so the whole-tree scan allocates no string for a token it has seen
 *  before: about 80% of a string-keyed scan's time was slicing tokens and
 *  hashing those slices into a Map. Tokens are ASCII alnum, so lower-casing is
 *  `| 32` on A-Z, exact whatever the rest of the line holds. */
const stream = () => ({ start: new Int32Array(1024), end: new Int32Array(1024), join: new Uint8Array(1024),
  h1: new Int32Array(1024), h2: new Int32Array(1024) });
/** The split stream, and the merged one derived from it (`mergeCase`). */
const T = stream(), M = stream();
function grow(A) {
  for (const k of /** @type {const} */ (['start', 'end', 'join', 'h1', 'h2'])) {
    const next = new A[k].constructor(A[k].length * 2);
    next.set(A[k]);
    A[k] = next;
  }
}
const FNV0 = 0x811c9dc5 | 0, DJB0 = 5381;
let sawCase = false;
function tokenize(s) {
  sawCase = false;
  let n = 0;
  let prevEnd = -1;
  let i = 0;
  const len = s.length;
  while (i < len) {
    let c = s.charCodeAt(i);
    if (!isAlnum(c)) { i++; continue; }
    let joiner = prevEnd < 0 ? 0 : joinerOf(s, prevEnd, i);
    let pieceStart = i;
    let h1 = FNV0, h2 = DJB0;
    for (;;) {
      const lc = isUpper(c) ? c | 32 : c;
      h1 = Math.imul(h1 ^ lc, 16777619);
      h2 = (Math.imul(h2, 33) ^ lc) | 0;
      i++;
      if (i >= len || !isAlnum(c = s.charCodeAt(i))) break;
      const p = s.charCodeAt(i - 1);
      if (isUpper(c) && (!isUpper(p) || (i + 1 < len && isLower(s.charCodeAt(i + 1))))) {
        sawCase = true;
        if (n >= T.start.length) grow(T);
        T.start[n] = pieceStart; T.end[n] = i; T.join[n] = joiner; T.h1[n] = h1; T.h2[n] = h2; n++;
        joiner = J_CASE; pieceStart = i; h1 = FNV0; h2 = DJB0;
      }
    }
    if (n >= T.start.length) grow(T);
    T.start[n] = pieceStart; T.end[n] = i; T.join[n] = joiner; T.h1[n] = h1; T.h2[n] = h2; n++;
    prevEnd = i;
  }
  return n;
}

const textAt = (s, k, A = T) => s.slice(A.start[k], A.end[k]).toLowerCase();

/** The merged stream from the split one: each camelCase run one token, its two
 *  hashes continued over the following pieces' characters (both are streaming
 *  hashes), so a line is tokenized once. Returns the merged token count. */
function mergeCase(s, n) {
  let m = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0 && T.join[k] === J_CASE) {
      let h1 = M.h1[m - 1], h2 = M.h2[m - 1];
      for (let q = T.start[k]; q < T.end[k]; q++) {
        const c = s.charCodeAt(q);
        const lc = isUpper(c) ? c | 32 : c;
        h1 = Math.imul(h1 ^ lc, 16777619);
        h2 = (Math.imul(h2, 33) ^ lc) | 0;
      }
      M.end[m - 1] = T.end[k]; M.h1[m - 1] = h1; M.h2[m - 1] = h2;
      continue;
    }
    if (m >= M.start.length) grow(M);
    M.start[m] = T.start[k]; M.end[m] = T.end[k]; M.join[m] = T.join[k]; M.h1[m] = T.h1[k]; M.h2[m] = T.h2[k];
    m++;
  }
  return m;
}

/** @param {string} line @returns {Token[]} */
export function tokens(line) {
  const { s } = foldMapped(line);
  const n = tokenize(s);
  const out = [];
  for (let k = 0; k < n; k++) out.push({ t: textAt(s, k), start: T.start[k], joinerBefore: JOINER_NAMES[T.join[k]] });
  return out;
}

/** The split-form entry of a name: its tokens hashed joined by `-` (by the
 *  listed joiners for `exact` and `run`), its first token's own hash (the
 *  matcher's index key) and its token count.
 *  @param {string} text @param {Mode} mode @returns {Entry} */
export function entryOf(text, mode) {
  const { s } = foldMapped(text);
  return entryFromStream(s, tokenize(s), mode);
}

function entryFromStream(s, n, mode, A = T) {
  const ts = [], seps = [];
  for (let k = 0; k < n; k++) { ts.push(textAt(s, k, A)); seps.push(JOINER_TEXT[A.join[k]] ?? '-'); }
  return entryFrom(ts, mode, seps);
}

/** `seps[k]` is what joins token k to the one before it. */
function entryFrom(ts, mode, seps) {
  if (ts.length === 0) throw new Error('an entry needs at least one [a-z0-9] token');
  const keepsJoiners = mode === 'exact' || mode === 'run';
  const text = keepsJoiners ? ts.map((t, k) => (k === 0 ? t : seps[k] + t)).join('') : ts.join('-');
  return { h: hashEntry(text), f: hashEntry(ts[0]), n: ts.length, mode };
}

/** Every entry a list row commits: split, camelCase merged, and run together
 *  (a phrase or an `exact` name run together is matched as a `part` token, since
 *  joiners and spaces are what those modes are about). Distinct by all four
 *  fields, so a form that shares a hash with another but not its token count is
 *  still committed.
 *  @param {string} text @param {Mode} mode @returns {Entry[]} */
export function entriesOf(text, mode) {
  const { s } = foldMapped(text);
  const out = [];
  const add = (e) => {
    if (!out.some((x) => x.h === e.h && x.f === e.f && x.n === e.n && x.mode === e.mode)) out.push(e);
  };
  const n = tokenize(s);
  const split = [];
  for (let k = 0; k < n; k++) split.push(textAt(s, k));
  add(entryFromStream(s, n, mode));
  add(entryFromStream(s, mergeCase(s, n), mode, M));
  if (split.length > 1) add(entryFrom([split.join('')], mode === 'run' ? 'run' : 'part', ['']));
  return out;
}

/** One keyed hash per unique string per process. */
const HASHES = new Map();
function hashOf(text) {
  let v = HASHES.get(text);
  if (v === undefined) { v = hashEntry(text); HASHES.set(text, v); }
  return v;
}

/** Per entries array: the entries each first-token hash starts, and a cache from
 *  a token's two cheap hashes and its length to the entries that can start at
 *  it (null when none) — an open-addressing table, because a Map lookup per
 *  token was a quarter of the scan. The keyed hash decides every candidate, so
 *  a collision never invents a hit; a token whose two 32-bit hashes AND length
 *  all equal those of a different token seen earlier would read that token's
 *  answer, which could hide a hit (odds about 1e-10 over this tree). */
const INDEXES = new WeakMap();
function indexOf(entries) {
  let ix = INDEXES.get(entries);
  if (!ix) {
    const byF = new Map();
    for (const en of entries) {
      const list = byF.get(en.f);
      if (list) list.push(en); else byF.set(en.f, [en]);
    }
    const words = entries.filter((en) => en.mode === 'words');
    ix = { byF, words, maxN: Math.max(1, ...entries.map((en) => en.n)),
      wordsN: Math.max(0, ...words.map((en) => en.n)), size: 0, ...slots(1 << 17) };
    INDEXES.set(entries, ix);
  }
  return ix;
}

function slots(cap) {
  return { mask: cap - 1, k1: new Int32Array(cap), k2: new Int32Array(cap), k3: new Int32Array(cap),
    used: new Uint8Array(cap), cands: new Array(cap).fill(null) };
}

function put(ix, h1, h2, len, cands) {
  let at = h1 & ix.mask;
  while (ix.used[at]) at = (at + 1) & ix.mask;
  ix.used[at] = 1; ix.k1[at] = h1; ix.k2[at] = h2; ix.k3[at] = len; ix.cands[at] = cands;
}

/** The entries that can start at a token, by its cheap hashes; `text()` is
 *  called only the first time a token is seen. */
function lookup(ix, h1, h2, len, text) {
  for (let at = h1 & ix.mask; ix.used[at]; at = (at + 1) & ix.mask) {
    if (ix.k1[at] === h1 && ix.k2[at] === h2 && ix.k3[at] === len) return ix.cands[at];
  }
  const cands = ix.byF.get(hashEntry(text())) ?? null;
  if (++ix.size * 2 > ix.mask) {
    const old = { ...ix };
    Object.assign(ix, slots((ix.mask + 1) * 2));
    for (let at = 0; at <= old.mask; at++) if (old.used[at]) put(ix, old.k1[at], old.k2[at], old.k3[at], old.cands[at]);
  }
  put(ix, h1, h2, len, cands);
  return cands;
}

const candidatesAt = (ix, s, A, k) => lookup(ix, A.h1[k], A.h2[k], A.end[k] - A.start[k], () => textAt(s, k, A));

/** Every hit on a line, with its span in the folded line and in the line as
 *  written — positions are for the exemptions and for masking, never for
 *  printing text.
 *  @param {string} line @param {Entry[]} entries @returns {Hit[]} */
export function hitsAt(line, entries) {
  const ix = indexOf(entries);
  const { s, map } = foldMapped(line);
  cur = null; curS = s; curMap = map;
  const n = tokenize(s);
  windows(ix, s, T, n);
  // Whether a phrase could start in this line's last tokens and run on to the
  // next line: `pairHits` reads it rather than tokenizing the line again.
  lastLine = line; lastEntries = entries; lastStarts = false;
  for (let k = Math.max(0, n - ix.wordsN + 1); k < n && !lastStarts; k++) {
    const cands = candidatesAt(ix, s, T, k);
    lastStarts = cands !== null && cands.some((en) => en.mode === 'words');
  }
  if (sawCase) {
    camelRuns(ix, s, n);
    windows(ix, s, M, mergeCase(s, n));
  }
  const out = cur ?? NO_HITS;
  cur = null; curS = ''; curMap = null;
  return out;
}

/** The line being read: its hits so far (null until the first), folded text and
 *  offset map. Module state rather than a closure per line: there are 1.9M lines. */
let cur = null, curS = '', curMap = null;
let lastLine = null, lastEntries = null, lastStarts = false;
function push(en, start, end) {
  if (cur === null) cur = [];
  else if (cur.some((x) => x.start === start && x.end === end)) return;
  cur.push({ h8: en.h.slice(0, 8), start, end, folded: curS,
    origStart: curMap ? curMap[start] : start, origEnd: curMap ? curMap[end] : end });
}

const NO_HITS = Object.freeze([]);

/** Every window of a token stream (`T` split, `M` merged) that an entry matches. */
function windows(ix, s, A, n) {
  for (let i = 0; i < n; i++) {
    const cands = candidatesAt(ix, s, A, i);
    if (cands === null) continue;
    for (const en of cands) {
      const last = i + en.n - 1;
      if (last >= n) continue;
      let ok = true;
      for (let k = i + 1; k <= last && ok; k++) ok = en.mode === 'words' ? A.join[k] === J_SPACE : joinsRun(A.join[k]);
      if (!ok) continue;
      if (en.mode === 'run' && (joinsRun(A.join[i]) || (last + 1 < n && joinsRun(A.join[last + 1])))) continue;
      if (en.n > 1) {
        const keepsJoiners = en.mode === 'exact' || en.mode === 'run';
        let text = textAt(s, i, A);
        for (let k = i + 1; k <= last; k++) text += (keepsJoiners ? JOINER_TEXT[A.join[k]] : '-') + textAt(s, k, A);
        if (hashOf(text) !== en.h) continue;
      }
      push(en, A.start[i], A.end[last]);
    }
  }
}

/** Two to `CAMEL_MAX_PIECES` consecutive camelCase pieces of at most
 *  `CAMEL_MAX_CHARS` read as one token, against the single-token `part`
 *  entries: `useZzAlpha` and `ZzAlphaClient` hold a name listed as one word
 *  (`zzalpha`) that neither the split nor the merged pass sees. Bounded because
 *  a base64 or hash string is dozens of pieces, and every run of them would be
 *  hashed; a listed name is a few short words (a lane id is at most 32
 *  characters by the roster grammar). */
const CAMEL_MAX_PIECES = 4, CAMEL_MAX_CHARS = 40;
function camelRuns(ix, s, n) {
  for (let a = 0; a < n; a++) {
    if (a + 1 >= n || T.join[a + 1] !== J_CASE) continue;
    let h1 = FNV0, h2 = DJB0;
    for (let b = a; b < n && b < a + CAMEL_MAX_PIECES && (b === a || T.join[b] === J_CASE)
      && T.end[b] - T.start[a] <= CAMEL_MAX_CHARS; b++) {
      for (let q = T.start[b]; q < T.end[b]; q++) {
        const c = s.charCodeAt(q);
        const lc = isUpper(c) ? c | 32 : c;
        h1 = Math.imul(h1 ^ lc, 16777619);
        h2 = (Math.imul(h2, 33) ^ lc) | 0;
      }
      if (b === a) continue;
      const from = T.start[a], to = T.end[b];
      const cands = lookup(ix, h1, h2, to - from, () => s.slice(from, to).toLowerCase());
      if (cands === null) continue;
      for (const en of cands) if (en.n === 1 && en.mode === 'part') push(en, from, to);
    }
  }
}

/** The `h8` of every entry a line matches, once each, in order of first
 *  occurrence. Never text.
 *  @param {string} line @param {Entry[]} entries @returns {string[]} */
export function matchLine(line, entries) {
  const hits = hitsAt(line, entries);
  return hits.length === 0 ? [] : [...new Set(hits.map((x) => x.h8))];
}

/** The entry the history programme's documents cite as a public open-source
 *  upstream. Its citations there are exempt; every other entry in those
 *  documents, and this one anywhere else, is not. */
const UPSTREAM_H8 = '4dda1e70';
const inHistoryDoc = (file) => file.startsWith('docs/') && file.includes('ccrc-history');

/** The class's exemptions, argued once here because the class and the local
 *  scan must agree on them (a scan that disagreed with the class would never
 *  print nothing). Both are citations of that upstream, in a history-programme
 *  document. `topology-clean.test.ts` pins this list at three entries or fewer. */
export const EXEMPTIONS = [
  {
    name: 'upstream revision citation',
    why: 'the upstream name followed by @ and seven or more hex digits is a pinned upstream revision (`<name>@ee578bc7:<path>:<line>`), in a ccrc-history document',
    /** @param {string} file @param {Hit} hit */
    applies: (file, hit) => hit.h8 === UPSTREAM_H8 && inHistoryDoc(file)
      && /^@[0-9a-f]{7,}/i.test(hit.folded.slice(hit.end)),
  },
  {
    name: 'upstream plugin phrase',
    why: 'the history spec names the plugin it studied as `lossless-claw, an <name> plugin`, in a ccrc-history document',
    /** @param {string} file @param {Hit} hit */
    applies: (file, hit) => hit.h8 === UPSTREAM_H8 && inHistoryDoc(file)
      && hit.folded.slice(0, hit.start).endsWith('lossless-claw, an ')
      && hit.folded.slice(hit.end).startsWith(' plugin'),
  },
];

const exempt = (file) => (hit) => !EXEMPTIONS.some((x) => x.applies(file, hit));

/** What the class and the scan report for a line of `file`: matchLine, less
 *  the exempt hits. @param {string} line @param {string} file @param {Entry[]} entries */
export function hitsIn(line, file, entries) {
  const hits = hitsAt(line, entries);
  return hits.length === 0 ? [] : [...new Set(hits.filter(exempt(file)).map((x) => x.h8))];
}

/** A `words` phrase broken across a line break: the hits in the facing ends of
 *  two adjacent lines that neither line holds alone. Reported against the
 *  first line. @param {string} prev @param {string} line @param {string} file @param {Entry[]} entries */
export function pairHits(prev, line, file, entries) {
  const { words } = indexOf(entries);
  if (words.length === 0 || !prev || !line) return [];
  // A phrase broken here starts in the previous line's last few tokens: unless
  // one of them can start a phrase there is nothing to read. `hitsAt` measured
  // that when it read the previous line, which is the usual order of calls.
  if (prev !== lastLine || entries !== lastEntries) hitsAt(prev, entries);
  if (!lastStarts) return [];
  // Only whitespace may sit between a phrase's words, so the previous line must
  // end on a letter or digit and this one start on one.
  if (!/[\p{L}\p{N}]\s*$/u.test(prev) || !/^\s*[\p{L}\p{N}]/u.test(line)) return [];
  const tail = prev.slice(-80), head = line.slice(0, 80);
  const alone = new Set([...hitsIn(tail, file, words), ...hitsIn(head, file, words)]);
  return hitsIn(`${tail}\n${head}`, file, words).filter((h) => !alone.has(h));
}

/** `text` with every hit replaced by its `#h8` — how a path is printed, since a
 *  file named after an entry would otherwise put the name into the log that
 *  reports it. @param {string} text @param {Entry[]} entries */
export function maskText(text, entries) {
  const hits = hitsAt(text, entries).sort((a, b) => b.origStart - a.origStart);
  let out = text;
  let floor = Infinity;
  for (const h of hits) {
    if (h.origEnd > floor) continue;
    out = `${out.slice(0, h.origStart)}#${h.h8}${out.slice(h.origEnd)}`;
    floor = h.origStart;
  }
  return out;
}

/** The committed entries: the canary first, then every entry of every list row
 *  measured `pub` (present in this repository's public history, so its hash
 *  reveals nothing new), sorted. Regenerate with `hash --list <path>` and paste;
 *  never edit a row by hand. A `local` row never appears here.
 *  @type {Entry[]} */
export const PRIVATE_NAMES = [
  { h: '66b0e293ddb1c22e53d2a326842aeea7', f: '23d2560aa6396e4e500363a1d62da163', n: 3, mode: 'part' }, // CANARY
  { h: '0a288ae2901340b17cd1329a2338af96', f: '3de7ceaabb6754f2dfcd85aea6df42c5', n: 2, mode: 'part' },
  { h: '0afdea18594c943034069c3f2bfdfc3b', f: '45faaf52c78c64e13b115563aea9ca93', n: 2, mode: 'run' },
  { h: '0bb0afa4404f01dbcc756adf6086cf3d', f: '0bb0afa4404f01dbcc756adf6086cf3d', n: 1, mode: 'part' },
  { h: '0c9992d90d5a0961d7be6fe61fc2465f', f: '0c9992d90d5a0961d7be6fe61fc2465f', n: 1, mode: 'run' },
  { h: '137213276ffd6b856d331c0aa37b23c6', f: '137213276ffd6b856d331c0aa37b23c6', n: 1, mode: 'part' },
  { h: '14bbeee64e6517a5b0674aec60e91ad0', f: '6babf5ba1b05474aae7a869d1ffa1ab6', n: 2, mode: 'part' },
  { h: '15718f862f59f8e10cae095888275808', f: '8c3eec6eb450e3862a86f2eb06ea44e7', n: 2, mode: 'part' },
  { h: '16c93f4f721da5f0f7e772cf06ae951d', f: '4c21dcdd5ff3da2d2ba8d9cbf59a0f83', n: 2, mode: 'words' },
  { h: '16f07249acdb3004c0819c2a1c06f826', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '16f55c52f36903da377b2c4214d6699a', f: '16f55c52f36903da377b2c4214d6699a', n: 1, mode: 'part' },
  { h: '20fbe1be0286acbc9c12e491157e5339', f: '20fbe1be0286acbc9c12e491157e5339', n: 1, mode: 'part' },
  { h: '218db10e40d396e86712cc616a3475d9', f: '043566d122cfb1e714069d0a392a6d79', n: 2, mode: 'part' },
  { h: '22881083494487121070290d213d9a8d', f: '48354ff049451df110dc5ec4be774ab2', n: 2, mode: 'words' },
  { h: '24e1d9c7fb360c17d130592245cfa2cc', f: '24e1d9c7fb360c17d130592245cfa2cc', n: 1, mode: 'part' },
  { h: '25c26f0d3d4e918481e26c2b804d9883', f: '25c26f0d3d4e918481e26c2b804d9883', n: 1, mode: 'run' },
  { h: '2b127a8cedf3d69ca1761841c81aeffb', f: '10e8ebd9bb3f7018ab698037b5ac763f', n: 2, mode: 'part' },
  { h: '2bd26806f9b3ba79e00439b89acabf82', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '325e9a969c845a8ad522e3421c46d52d', f: '325e9a969c845a8ad522e3421c46d52d', n: 1, mode: 'part' },
  { h: '38a1b0b83a4755c30b7529f2e4fca1ae', f: '4dda1e70f85e066a44e4e323074727bd', n: 2, mode: 'part' },
  { h: '3bc20f1a1810c5492d8df0f4b18ff07d', f: '7e9482eddc21cf01a8b30bc6d828565f', n: 2, mode: 'run' },
  { h: '3c337bd09bb449307d48eec8bd10d9b4', f: '3c337bd09bb449307d48eec8bd10d9b4', n: 1, mode: 'part' },
  { h: '3de7ceaabb6754f2dfcd85aea6df42c5', f: '3de7ceaabb6754f2dfcd85aea6df42c5', n: 1, mode: 'run' },
  { h: '3f35c492c927eae7e01114424e9f373e', f: '6babf5ba1b05474aae7a869d1ffa1ab6', n: 2, mode: 'part' },
  { h: '4033214654eaf0808bcbc74288d083ec', f: '4033214654eaf0808bcbc74288d083ec', n: 1, mode: 'part' },
  { h: '449c4f61866901259dc00200fd094827', f: '449c4f61866901259dc00200fd094827', n: 1, mode: 'part' },
  { h: '454cc796a7b34189a5e553adaf7f7a2d', f: '454cc796a7b34189a5e553adaf7f7a2d', n: 1, mode: 'part' },
  { h: '46b6c2b6b4bf19285ef6ef24a3fa11c0', f: '46b6c2b6b4bf19285ef6ef24a3fa11c0', n: 1, mode: 'part' },
  { h: '472a2a2ee67c8374ec355d54b7ed3116', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '4855c98aaaa8d0e15f7745c5e3d10ef3', f: '3de7ceaabb6754f2dfcd85aea6df42c5', n: 2, mode: 'part' },
  { h: '490394884e2d96ae719f2bf63dc53857', f: '490394884e2d96ae719f2bf63dc53857', n: 1, mode: 'part' },
  { h: '4a1d30216aeb60e75b73d0645b674cb5', f: '4a1d30216aeb60e75b73d0645b674cb5', n: 1, mode: 'part' },
  { h: '4a6480f1fe2cf66fd70f1646917c694a', f: '4a6480f1fe2cf66fd70f1646917c694a', n: 1, mode: 'part' },
  { h: '4aa281b97c55a45a7875e5e118b42bd9', f: '043566d122cfb1e714069d0a392a6d79', n: 2, mode: 'part' },
  { h: '4ac05970d3b7a15f631dbc57acacf02d', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '4dda1e70f85e066a44e4e323074727bd', f: '4dda1e70f85e066a44e4e323074727bd', n: 1, mode: 'part' },
  { h: '4eadbbdaa08d00c2df2258b7e4bd55e7', f: '03ce9a1ca4688c3a0ca1689973533756', n: 3, mode: 'part' },
  { h: '556403527e867eedf86b86aab524615a', f: '556403527e867eedf86b86aab524615a', n: 1, mode: 'part' },
  { h: '580fe0605ba586769d02a69db538a781', f: '580fe0605ba586769d02a69db538a781', n: 1, mode: 'part' },
  { h: '58d1924638017eaf7c4a5f42b3c1d279', f: '58d1924638017eaf7c4a5f42b3c1d279', n: 1, mode: 'part' },
  { h: '590ef77a07eeb8d7c4395dbc0b705e6b', f: '6babf5ba1b05474aae7a869d1ffa1ab6', n: 2, mode: 'part' },
  { h: '5944194ca5abbfd19265b09d0a284530', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'run' },
  { h: '5964fdd4c733c191e9a1c25883357146', f: '4dda1e70f85e066a44e4e323074727bd', n: 2, mode: 'part' },
  { h: '5a1aa8834415d7cbd4b0f4952cedf57b', f: '5a1aa8834415d7cbd4b0f4952cedf57b', n: 1, mode: 'part' },
  { h: '5bc24d98f82fb1ac6d8af5b31c5d9e71', f: '5bc24d98f82fb1ac6d8af5b31c5d9e71', n: 1, mode: 'part' },
  { h: '5cd709db1a86ccbaf406650f3aa333bf', f: '5cd709db1a86ccbaf406650f3aa333bf', n: 1, mode: 'part' },
  { h: '5e41bd278d87948ec12d77aafe887be1', f: '5e41bd278d87948ec12d77aafe887be1', n: 1, mode: 'part' },
  { h: '5e8bd511dff635a6d0d5cd63eb70f466', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '61f9d62371863acc082c5c4258f196e1', f: 'dca76d6eea97202ceec1916eee473644', n: 2, mode: 'part' },
  { h: '64b6183d639844a92e7a6f2641800098', f: '3de7ceaabb6754f2dfcd85aea6df42c5', n: 3, mode: 'part' },
  { h: '65bc36cfabcdc8cc5a6688e2e85c1da4', f: '65bc36cfabcdc8cc5a6688e2e85c1da4', n: 1, mode: 'part' },
  { h: '6a6c4f38c96f860c0aa47fdefa200f3f', f: '6a6c4f38c96f860c0aa47fdefa200f3f', n: 1, mode: 'part' },
  { h: '6babf5ba1b05474aae7a869d1ffa1ab6', f: '6babf5ba1b05474aae7a869d1ffa1ab6', n: 1, mode: 'run' },
  { h: '6c7437ecd365e67b89417416eeb0216f', f: '6c7437ecd365e67b89417416eeb0216f', n: 1, mode: 'part' },
  { h: '6c7a4cd801b168600f6dfe88d28203e7', f: '6c7a4cd801b168600f6dfe88d28203e7', n: 1, mode: 'part' },
  { h: '6c930707173d6114a230aa55b331d359', f: '6a85de7b1aaf6d65bbd1f08a4e2042b7', n: 3, mode: 'part' },
  { h: '6d8b23ca2a52683d46177f7287ea4d04', f: '6d8b23ca2a52683d46177f7287ea4d04', n: 1, mode: 'part' },
  { h: '707c17c9837296a785f22da270e40fd7', f: '707c17c9837296a785f22da270e40fd7', n: 1, mode: 'part' },
  { h: '72038b86bb6732db0d90e419ac301440', f: '72038b86bb6732db0d90e419ac301440', n: 1, mode: 'part' },
  { h: '72af724788562763e554d3c3e59a10a9', f: '72af724788562763e554d3c3e59a10a9', n: 1, mode: 'part' },
  { h: '72f88052e95044210948100a0e4154f4', f: '72f88052e95044210948100a0e4154f4', n: 1, mode: 'part' },
  { h: '78c2f88d580b365611bb9f76e073b3e3', f: '78c2f88d580b365611bb9f76e073b3e3', n: 1, mode: 'part' },
  { h: '7cbdbf44be033e742f8c44435c213cad', f: '07626f45a1f2a9d2d3fd85b76b75c714', n: 2, mode: 'part' },
  { h: '7de95e9cf4a54af3a0c4a4013f72fecd', f: '7de95e9cf4a54af3a0c4a4013f72fecd', n: 1, mode: 'run' },
  { h: '7fc8d2793c3881428b30b2bffcee7da6', f: '7fc8d2793c3881428b30b2bffcee7da6', n: 1, mode: 'part' },
  { h: '81852cc797472e2bed6c2cc263413e7c', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '8536e6ce16043a6953e9198ec428744d', f: '8190d53d894698731874d95826cc7563', n: 2, mode: 'run' },
  { h: '853d6f6c0202d643ff587980c2a58219', f: '853d6f6c0202d643ff587980c2a58219', n: 1, mode: 'part' },
  { h: '869bb7110f763e23e84750f977837651', f: '043566d122cfb1e714069d0a392a6d79', n: 2, mode: 'part' },
  { h: '89851aff9b30a07af4cc79446336fb7c', f: '6a85de7b1aaf6d65bbd1f08a4e2042b7', n: 2, mode: 'part' },
  { h: '8a7388f250bb6b4325665ce0c73a10e6', f: 'd1666a0aec7a9e7ef1a7b290722eac46', n: 2, mode: 'part' },
  { h: '8f39732cd0e04c4472eb005814a86605', f: '8f39732cd0e04c4472eb005814a86605', n: 1, mode: 'run' },
  { h: '8fa95c762483c33c6fed06f4a184922a', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: '950d49abf331188c2b38f7c07893fbb0', f: '2a4fd6122b35a4a0a5483ed0d09dfa22', n: 3, mode: 'part' },
  { h: '976b61b5122aaa8ca3b32a7794e44259', f: '976b61b5122aaa8ca3b32a7794e44259', n: 1, mode: 'run' },
  { h: '992c6609451c5e02822cb1bf6bc95a30', f: '992c6609451c5e02822cb1bf6bc95a30', n: 1, mode: 'part' },
  { h: '999c9b462418b2f7015fe2770a31b753', f: 'fc12dc3fec3f0bcea6263a1587a9d7d0', n: 2, mode: 'part' },
  { h: '9a7b93c546c35a0fa7ce57878b960ff4', f: '9a7b93c546c35a0fa7ce57878b960ff4', n: 1, mode: 'part' },
  { h: '9b3058c8a683da77f85403584da24da6', f: '043566d122cfb1e714069d0a392a6d79', n: 2, mode: 'part' },
  { h: '9f35abd586006b4b195b895e295e51ee', f: 'ddd868071a8112721af349bfb0986367', n: 2, mode: 'part' },
  { h: '9f35abd586006b4b195b895e295e51ee', f: 'ddd868071a8112721af349bfb0986367', n: 2, mode: 'words' },
  { h: '9fb0d4a50b2bcfb6918f6995fe2ce7dd', f: 'f8ab6f67536ac55de25a019097026026', n: 3, mode: 'part' },
  { h: 'a0d04b85ac7d05a679306cc57f51b6b5', f: 'a0d04b85ac7d05a679306cc57f51b6b5', n: 1, mode: 'part' },
  { h: 'a30447fc3157bc90bc6f315a9b51db81', f: 'a30447fc3157bc90bc6f315a9b51db81', n: 1, mode: 'part' },
  { h: 'a3926ece4a66c3d97c0a0b6ef68a5c35', f: 'a3926ece4a66c3d97c0a0b6ef68a5c35', n: 1, mode: 'part' },
  { h: 'a4277cd1790f8db0a54b3e5aeb5d46cc', f: '3de7ceaabb6754f2dfcd85aea6df42c5', n: 3, mode: 'part' },
  { h: 'a5076eaf5be63aefb73b99d928e1981a', f: 'a5076eaf5be63aefb73b99d928e1981a', n: 1, mode: 'part' },
  { h: 'a8d823905f5d8b0afd9433123f247478', f: 'a8d823905f5d8b0afd9433123f247478', n: 1, mode: 'run' },
  { h: 'afb577aa707ff4b86b42d61bdbb268db', f: 'f3f3b5262c4a92bcf60ede029df4e37a', n: 2, mode: 'part' },
  { h: 'b08ad95ebe76722d8bba539655ede715', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: 'b556b7216e883e410b0dafa83baddf4f', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: 'b77d896268ae6fa0883496300762c6b2', f: 'b77d896268ae6fa0883496300762c6b2', n: 1, mode: 'part' },
  { h: 'b94e9a995364e5632d4a301d964728ab', f: 'b94e9a995364e5632d4a301d964728ab', n: 1, mode: 'part' },
  { h: 'bc15f6c53639c5e8366bd470e08c4437', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: 'bcf3977e821066f3d6d974da0dca19bc', f: 'bcf3977e821066f3d6d974da0dca19bc', n: 1, mode: 'part' },
  { h: 'bcfc180fc3c77d3ea1436770b3eb21c4', f: '6fb569869d444566a1378efbfe2e80c5', n: 2, mode: 'run' },
  { h: 'bee3878e1ceeee1b090be669c3206641', f: 'a495c540f8fc9e51575875fe15e6aa0e', n: 2, mode: 'part' },
  { h: 'c0a14a865037d4032dedef6320fd415d', f: 'c0a14a865037d4032dedef6320fd415d', n: 1, mode: 'part' },
  { h: 'c2e8230bac1920c61cea930e7ac8715b', f: 'c2e8230bac1920c61cea930e7ac8715b', n: 1, mode: 'part' },
  { h: 'c5aa7a156d8a332aeec6229f09b7a84f', f: '8ba71d3c5deb40ab4cd973721a77f0e5', n: 3, mode: 'part' },
  { h: 'c78d6161737c580840252d2a44a8a244', f: '02eb9a0f5102b65fa703643dbf25a8bc', n: 2, mode: 'run' },
  { h: 'c892dbeb72dec845267bb1227d60dcd4', f: 'c892dbeb72dec845267bb1227d60dcd4', n: 1, mode: 'part' },
  { h: 'cceaffd2b93411f2901990025d7c2bf8', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: 'cd84c1c0d2c5cd70ab78e62eb11fc5a8', f: '6babf5ba1b05474aae7a869d1ffa1ab6', n: 2, mode: 'part' },
  { h: 'd0e0f05764513e443e5bad8d7c85e42a', f: 'd0e0f05764513e443e5bad8d7c85e42a', n: 1, mode: 'part' },
  { h: 'd145074b51c2834b738d68cc8841e32f', f: 'd145074b51c2834b738d68cc8841e32f', n: 1, mode: 'run' },
  { h: 'd23c88a57d7eec12fa2664c78c00d09d', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: 'd376229c8c448d89b674c9564a8bf57d', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'exact' },
  { h: 'd3c0401847871acc4e33c0261faf24e9', f: '6fb569869d444566a1378efbfe2e80c5', n: 2, mode: 'run' },
  { h: 'd5167313ff9f188e138a7d9a1af217cc', f: 'd5167313ff9f188e138a7d9a1af217cc', n: 1, mode: 'part' },
  { h: 'd56c3f1d5897e0c9c76d60cf8dcac40e', f: 'd56c3f1d5897e0c9c76d60cf8dcac40e', n: 1, mode: 'part' },
  { h: 'd5726d04b9e7342c113b6706fa36bff4', f: '707c17c9837296a785f22da270e40fd7', n: 2, mode: 'part' },
  { h: 'dbc192b50ea35ac54d48dfd1979657ae', f: 'dbc192b50ea35ac54d48dfd1979657ae', n: 1, mode: 'part' },
  { h: 'e15e24b5811f6455b8bf622f100e85c7', f: '043566d122cfb1e714069d0a392a6d79', n: 2, mode: 'part' },
  { h: 'e259f6270f97115674f50008c7016006', f: 'e259f6270f97115674f50008c7016006', n: 1, mode: 'part' },
  { h: 'e2aaadd0ea7ef6e6ba80ac054dd6ddc3', f: 'e2aaadd0ea7ef6e6ba80ac054dd6ddc3', n: 1, mode: 'part' },
  { h: 'e3ef1d0deda515527ba4de48f9c5d4c0', f: 'e3ef1d0deda515527ba4de48f9c5d4c0', n: 1, mode: 'part' },
  { h: 'e5bf322bec7a43a9d296612ab17c7028', f: '97ecd2bd61fbbe555d63acbe177ffd9a', n: 2, mode: 'part' },
  { h: 'e795a3195e6b03373b421e91e917d586', f: 'e795a3195e6b03373b421e91e917d586', n: 1, mode: 'part' },
  { h: 'e796a6c3ea4a5fb11d9be844e87199ab', f: 'e796a6c3ea4a5fb11d9be844e87199ab', n: 1, mode: 'part' },
  { h: 'e8a66181c7a3178a34f2f87d4e615d3b', f: '03ce9a1ca4688c3a0ca1689973533756', n: 2, mode: 'part' },
  { h: 'e8f08e892082c8f3d7c0b28f8f13a0eb', f: '89aa7a43d85812b839d6df8c987c45f7', n: 3, mode: 'part' },
  { h: 'ea2d075248243ff0c1e39bf03b02a1ef', f: 'a6dd673d36b9f9ac52f54e3a91af6872', n: 2, mode: 'part' },
  { h: 'eaa169b591977980b671c7a91958a217', f: 'eaa169b591977980b671c7a91958a217', n: 1, mode: 'part' },
  { h: 'ed3c44b6f4560a26867448ae2dc631f7', f: '043566d122cfb1e714069d0a392a6d79', n: 2, mode: 'part' },
  { h: 'ef765fb9e954f37e0901bbd00c95fd24', f: 'ef765fb9e954f37e0901bbd00c95fd24', n: 1, mode: 'run' },
  { h: 'f00527006d8a67c55cac54f978efcf10', f: '25c26f0d3d4e918481e26c2b804d9883', n: 2, mode: 'words' },
  { h: 'f22aa65c61040146bc2bc58b81263663', f: 'f22aa65c61040146bc2bc58b81263663', n: 1, mode: 'part' },
  { h: 'f5b5ebb39c4ad43a0113dc3fe3ea201c', f: 'f5b5ebb39c4ad43a0113dc3fe3ea201c', n: 1, mode: 'part' },
  { h: 'f6f95ac74ed9aced59f3e0b91f72bfff', f: '6ff79678a1ac2a6c3b26765372fa2f60', n: 2, mode: 'run' },
  { h: 'f8f3d172658c4324ea52b9446903061c', f: 'f8f3d172658c4324ea52b9446903061c', n: 1, mode: 'part' },
  { h: 'fb004ddd5e2d63b9700f7b44c28f2917', f: 'fb004ddd5e2d63b9700f7b44c28f2917', n: 1, mode: 'run' },
  { h: 'fbbddb221ed721eb83a9b9115dfa2f29', f: 'fbbddb221ed721eb83a9b9115dfa2f29', n: 1, mode: 'part' },
  { h: 'fc25d97afc10b692ce705df2e0322b18', f: 'fc25d97afc10b692ce705df2e0322b18', n: 1, mode: 'run' },
  { h: 'fc353e4157699427af162db3f19ff43e', f: 'bcf3977e821066f3d6d974da0dca19bc', n: 2, mode: 'part' },
  { h: 'fd1e50ed66daba9755071cc5528301f8', f: 'fd1e50ed66daba9755071cc5528301f8', n: 1, mode: 'part' },
  { h: 'fd3bc3646bc83f712d1f502fa368dfa6', f: 'fd3bc3646bc83f712d1f502fa368dfa6', n: 1, mode: 'run' },
  { h: 'fd611aaf02ae5c6e7c793c7edc44a570', f: 'fd611aaf02ae5c6e7c793c7edc44a570', n: 1, mode: 'part' },
  { h: 'ff258ab08e9efeb36c2eaef0a53d8ae9', f: 'ff258ab08e9efeb36c2eaef0a53d8ae9', n: 1, mode: 'part' },
  { h: 'ff84f23ffa68705da04b64ce5da6e179', f: 'ff84f23ffa68705da04b64ce5da6e179', n: 1, mode: 'run' },
];

// ─── the local CLI ──────────────────────────────────────────────────────────

/** The operator's local list: `mode \t token \t stand-in \t class \t visibility`,
 *  `#` comments. Read only by the CLI, never by a test. */
function readList(file) {
  const rows = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const [mode, token, , , visibility] = line.split('\t');
    if (!MODES.includes(/** @type {Mode} */ (mode))) throw new Error(`list row ${i + 1}: bad mode`);
    for (const entry of entriesOf(token, /** @type {Mode} */ (mode))) {
      rows.push({ row: i + 1, entry, visibility: (visibility ?? '').trim() });
    }
  });
  return rows;
}

/** The order and identity of a committed entry: all four fields. */
export const entryKey = (en) => `${en.h} ${en.f} ${en.n} ${en.mode}`;

function cli(argv) {
  const [verb, ...rest] = argv;
  const at = rest.indexOf('--list');
  if (at < 0 || !rest[at + 1]) throw new Error('usage: private-names.mjs hash|scan --list <path>');
  const rows = readList(rest[at + 1]);
  if (verb === 'hash') {
    const pub = new Map();
    for (const r of rows) if (r.visibility === 'pub') pub.set(entryKey(r.entry), r.entry);
    const lit = (en) => `  { h: '${en.h}', f: '${en.f}', n: ${en.n}, mode: '${en.mode}' },`;
    const out = [lit(entryOf(CANARY, 'part')).replace(/,$/, ', // CANARY')];
    for (const key of [...pub.keys()].sort()) out.push(lit(pub.get(key)));
    process.stdout.write(`${out.join('\n')}\n`);
    return;
  }
  if (verb === 'scan') {
    const entries = rows.map((r) => r.entry);
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\0').filter(Boolean);
    const out = [];
    for (const file of files) {
      const shown = maskText(file, entries);
      for (const h of hitsIn(file, file, entries)) out.push(`${shown}:0 #${h} path`);
      let buf;
      try { buf = readFileSync(path.join(root, file)); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0)) continue;
      const lines = buf.toString('utf8').split('\n');
      lines.forEach((line, i) => {
        for (const h of hitsIn(line, file, entries)) out.push(`${shown}:${i + 1} #${h}`);
        if (i + 1 < lines.length) for (const h of pairHits(line, lines[i + 1], file, entries)) out.push(`${shown}:${i + 1} #${h} split`);
      });
    }
    process.stdout.write(out.length ? `${out.join('\n')}\n` : '');
    return;
  }
  throw new Error(`unknown verb ${verb}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2));
}
