#!/usr/bin/env node
// ccd/compact-card.mjs — the compaction card's helper. `card` mines a
// transcript window for the files a context was working in, resolves them
// against graphify's graph.json and renders a structural card; `measure`
// scores a compaction summary against that working set.
//
// Spec: docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md
// (§3.2 `card`, §3.4 `measure`). Invoked ONLY by ccd/session-hook.sh, under
// `timeout`, on PreCompact and PostCompact; installed beside the hook as
// ~/.cc-sessions/compact-card.mjs by deploy.sh's agent lane and `ccrc install`.
//
// Plain node, `node:*` imports only — the `shared/mark.mjs` class: a
// deploy-side script the PWA never bundles, importable by vitest directly
// (types in the hand-written `compact-card.d.mts` beside it). Reads only the
// files it is given; writes only `--out` and `--set`, each through a
// dot-prefixed temp name and a rename — the hook's own idiom.
//
// Exit codes (spec §3.2): 0 written; 3 empty working set (the set is written
// with `files: []`, no card); 2 usage; 1 any failure. `card` prints nothing on
// stdout; `measure` prints exactly one JSON object. Every failure names itself
// on stderr, which the hook discards — the hook's contract is silence.
import { openSync, readSync, closeSync, fstatSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ OK: 0, FAILURE: 1, USAGE: 2, EMPTY: 3 });

/** The window when no boundary exists: the last 16 MiB, realigned to a line
 *  start — a mid-line start is not a partial parse, `JSON.parse` rejects it
 *  wholesale, which the prototype measured as a silently empty set. 16 MiB,
 *  not 64: a transcript that has never compacted is far smaller (auto-
 *  compaction fires long before), and the cap bounds the helper's time and
 *  memory (a 64 MiB window measured 0.3 s to read and 0.4 s to mine). */
export const WINDOW_CAP = 16 * 1024 * 1024;
/** The backwards-scan chunk; a parameter of `readWindow` so a test can build
 *  a deterministic chunk-edge straddle with a small one. */
export const CHUNK = 1024 * 1024;
/** A boundary row is small (measured on this session's own transcript: 1,348
 *  and 1,943 bytes). A `"compact_boundary"` literal whose line start or end
 *  lies further away than this is inside a message body, not a row. */
const LINE_SCAN_MAX = 65536;
const NEEDLE = Buffer.from('"compact_boundary"');

/** Is this line the harness's own boundary row — `{type:"system",
 *  subtype:"compact_boundary"}` — and not a literal inside a message body? */
export function isBoundaryLine(line) {
  try {
    const o = JSON.parse(line);
    return o !== null && typeof o === 'object' && o.type === 'system' && o.subtype === 'compact_boundary';
  } catch {
    return false;
  }
}

/** The line containing byte offset `at`, bounded by LINE_SCAN_MAX on either
 *  side; null when a line end is not found inside the bound. */
function lineAt(fd, at, size) {
  const before = Math.min(LINE_SCAN_MAX, at);
  const after = Math.min(LINE_SCAN_MAX, size - at);
  const buf = Buffer.alloc(before + after);
  readSync(fd, buf, 0, buf.length, at - before);
  const nlBefore = before > 0 ? buf.lastIndexOf(0x0a, before - 1) : -1;
  const start = nlBefore >= 0 ? nlBefore + 1 : (at - before === 0 ? 0 : -1);
  const nlAfter = buf.indexOf(0x0a, before);
  const end = nlAfter >= 0 ? nlAfter : (at + after === size ? buf.length : -1);
  if (start < 0 || end < 0) return null;
  return { start: at - before + start, text: buf.subarray(start, end).toString('utf8') };
}

function readFrom(fd, start, size) {
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  return buf.toString('utf8');
}

/** The transcript window (spec §3.2): from the last CONFIRMED compaction
 *  boundary to EOF, found by scanning BACKWARDS in 1 MiB chunks for the
 *  literal and parsing the line it sits on; else the whole file, capped at the
 *  last `cap` bytes realigned to a line start. Chunks are searched as they
 *  are read and concatenated once, so a 64 MiB file with no boundary costs one
 *  pass, not sixty-four. */
export function readWindow(path, cap = WINDOW_CAP, chunkSize = CHUNK) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const chunks = [];
    let pos = size, total = 0;
    // The head of the previously read (later) chunk: a needle split across
    // the chunk edge is matched in `chunk + carry`, never lost.
    let carry = Buffer.alloc(0);
    while (pos > 0 && total < cap) {
      const len = Math.min(chunkSize, pos, cap - total);
      pos -= len;
      const chunk = Buffer.alloc(len);
      readSync(fd, chunk, 0, len, pos);
      chunks.unshift(chunk);
      total += len;
      const probe = Buffer.concat([chunk, carry]);
      let at = probe.lastIndexOf(NEEDLE);
      while (at >= 0) {
        const line = lineAt(fd, pos + at, size);
        if (line && isBoundaryLine(line.text)) return { text: readFrom(fd, line.start, size), boundary: true };
        at = at > 0 ? probe.lastIndexOf(NEEDLE, at - 1) : -1;
      }
      carry = chunk.subarray(0, Math.min(NEEDLE.length - 1, chunk.length));
    }
    let buf = Buffer.concat(chunks);
    if (pos > 0 || buf.length > cap) {
      buf = buf.subarray(Math.max(0, buf.length - cap));
      const nl = buf.indexOf(0x0a);
      buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0);
    }
    return { text: buf.toString('utf8'), boundary: false };
  } finally {
    closeSync(fd);
  }
}

// ── MINING (spec §3.2) ───────────────────────────────────────────────────
/** Ranked tags, strongest first. */
export const TAGS = Object.freeze(['edited', 'touched', 'carried']);
const TAG_RANK = { edited: 0, touched: 1, carried: 2 };
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** The working set is capped here; the card prints the first `--max-files`
 *  of it (two populations, spec §3.2). */
export const WORKSET_CAP = 100;

/** Every extension the graph's own files carry, longest first then
 *  alphabetical — DERIVED, never typed. Files with no extension (`ccd/ccd`)
 *  cannot be mined from shell text: a stated limitation, not a bug. */
export function extensionsOf(files) {
  const exts = new Set();
  for (const f of files) {
    const b = basename(f);
    const i = b.lastIndexOf('.');
    if (i > 0 && i < b.length - 1) exts.add(b.slice(i + 1));
  }
  return [...exts].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** `[A-Za-z0-9_./-]+\.(<ext>)`, anchored on both sides so `baz.tsz` and a
 *  mid-word start never match; null when the graph names no extension. */
export function tokenRegex(exts) {
  if (exts.length === 0) return null;
  const alt = exts.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![A-Za-z0-9_./-])[A-Za-z0-9_./-]+\\.(?:${alt})(?![A-Za-z0-9_])`, 'g');
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
  return '';
};

/** Raw path tokens out of a window, one row per occurrence (the mining table
 *  of spec §3.2): Edit-shaped tools' `file_path`/`notebook_path` → edited;
 *  `Read`'s `file_path` → touched; regex hits in a `Bash` command → touched;
 *  regex hits in the previous compaction's summary → carried. A line that
 *  does not parse is skipped, never fatal. */
export function mineTokens(windowText, re) {
  const out = [];
  for (const line of windowText.split('\n')) {
    if (line === '') continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o === null || typeof o !== 'object') continue;
    const msg = o.message;
    if (o.type === 'assistant' && msg && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (!item || item.type !== 'tool_use' || !item.input || typeof item.input !== 'object') continue;
        const inp = item.input;
        if (EDIT_TOOLS.has(item.name)) {
          const p = typeof inp.file_path === 'string' ? inp.file_path : inp.notebook_path;
          if (typeof p === 'string' && p !== '') out.push({ token: p, tag: 'edited' });
        } else if (item.name === 'Read') {
          if (typeof inp.file_path === 'string' && inp.file_path !== '') out.push({ token: inp.file_path, tag: 'touched' });
        } else if (item.name === 'Bash' && re && typeof inp.command === 'string') {
          for (const m of inp.command.matchAll(re)) out.push({ token: m[0], tag: 'touched' });
        }
      }
    } else if (o.isCompactSummary === true && msg && re) {
      for (const m of textOf(msg.content).matchAll(re)) out.push({ token: m[0], tag: 'carried' });
    }
  }
  return out;
}

// ── RESOLUTION (spec §3.2) ───────────────────────────────────────────────
/** The graph's `source_file` set, indexed by basename. A suffix match can
 *  only ever hit a file with the token's own basename, so the candidates for
 *  a token are one Map lookup — O(tokens) for the whole window, never a scan
 *  of every file per token (the review measured that scan at 2–12 s on a
 *  64 MiB window against a 5,000-file graph). */
export function fileIndex(files) {
  const set = new Set(files);
  const byBase = new Map();
  for (const f of set) {
    const b = basename(f);
    const list = byBase.get(b);
    if (list) list.push(f); else byBase.set(b, [f]);
  }
  return { files: set, byBase };
}

/** One token against the index: strip a leading `<cwd>/` or `./`; exact
 *  match first; else a suffix match on a path-segment boundary that is UNIQUE
 *  in the set. Two or more → `ambiguous`; an absolute path outside `<cwd>` →
 *  `outside`; none → `nomatch`. */
export function resolveToken(token, index, cwd) {
  let t = token;
  if (cwd && (t === cwd || t.startsWith(cwd + '/'))) t = t.slice(cwd.length + 1);
  if (t.startsWith('/')) return { reason: 'outside' };
  while (t.startsWith('./')) t = t.slice(2);
  if (t === '') return { reason: 'nomatch' };
  if (index.files.has(t)) return { path: t };
  const suffix = '/' + t;
  const hits = (index.byBase.get(basename(t)) ?? []).filter((f) => f.endsWith(suffix));
  if (hits.length === 1) return { path: hits[0] };
  return { reason: hits.length > 1 ? 'ambiguous' : 'nomatch' };
}

/** The working set: every resolved file, the strongest tag it earned, its
 *  occurrence count; ranked edited > touched > carried, then count, then
 *  path; capped. `stats` is what tells a thin card from a thin session. */
export function workingSet(tokens, index, cwd, cap = WORKSET_CAP) {
  const stats = { tokens: tokens.length, resolved: 0, ambiguous: 0, outside: 0, nomatch: 0 };
  const acc = new Map();
  for (const { token, tag } of tokens) {
    const r = resolveToken(token, index, cwd);
    if (!r.path) { stats[r.reason]++; continue; }
    stats.resolved++;
    const cur = acc.get(r.path);
    if (!cur) acc.set(r.path, { path: r.path, tag, count: 1 });
    else { cur.count++; if (TAG_RANK[tag] < TAG_RANK[cur.tag]) cur.tag = tag; }
  }
  const ranked = [...acc.values()].sort((a, b) =>
    TAG_RANK[a.tag] - TAG_RANK[b.tag] || b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: ranked.slice(0, cap), stats };
}

// ── CLI ──────────────────────────────────────────────────────────────────
/** `--kebab-flag value` pairs into camelCase keys; `--steer` alone is a
 *  boolean; anything else is a usage error the caller reports. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--steer') { opts.steer = true; continue; }
    if (!a.startsWith('--')) return { error: `unexpected argument ${a}` };
    const v = rest[i + 1];
    if (v === undefined) return { error: `${a} needs a value` };
    i++;
    opts[a.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = v;
  }
  return { cmd, opts };
}

const REQUIRED_CARD = ['transcript', 'cwd', 'graph', 'labels', 'out', 'set', 'maxChars', 'maxFiles', 'built', 'fresh', 'scope', 'at'];

function usage(msg) {
  process.stderr.write(`compact-card: ${msg}\n`);
  return EXIT.USAGE;
}

export function main(argv) {
  const p = parseArgs(argv);
  if (p.error) return usage(p.error);
  if (!p.cmd) return usage('no subcommand (card | measure)');
  const o = p.opts;
  try {
    if (p.cmd === 'card') {
      for (const k of REQUIRED_CARD) if (!(k in o)) return usage(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required`);
      if (o.scope !== 'main' && o.scope !== 'subagent') return usage('--scope must be main or subagent');
      const maxChars = Number(o.maxChars), maxFiles = Number(o.maxFiles), at = Number(o.at);
      if (!Number.isInteger(maxChars) || maxChars <= 0) return usage('--max-chars must be a positive integer');
      if (!Number.isInteger(maxFiles) || maxFiles <= 0) return usage('--max-files must be a positive integer');
      if (!Number.isInteger(at) || at <= 0) return usage('--at must be the set\'s epoch-ms nonce');
      return cardCommand({ transcript: o.transcript, cwd: o.cwd, graph: o.graph, labels: o.labels,
        out: o.out, set: o.set, maxChars, maxFiles, built: o.built, fresh: o.fresh,
        scope: o.scope, agent: o.agent ?? null, at });
    }
    if (p.cmd === 'measure') {
      if (o.trigger !== 'auto' && o.trigger !== 'manual') return usage('--trigger must be auto or manual');
      const raw = readFileSync(0, 'utf8');
      const set = readSetForMeasure(o.set);
      process.stdout.write(JSON.stringify(measureCommand(raw, set, o.trigger)) + '\n');
      return EXIT.OK;
    }
    return usage(`unknown subcommand ${p.cmd}`);
  } catch (e) {
    process.stderr.write(`compact-card: ${e && e.message ? e.message : String(e)}\n`);
    return EXIT.FAILURE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
