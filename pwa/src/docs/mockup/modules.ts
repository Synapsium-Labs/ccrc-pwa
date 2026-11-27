// The in-walls loader's script scan and import-map reader (X2 P6.2, plan 2026-11-18-native-docs-parity Task P6.2; spec
// 4.8). Ring L1: pure and linear, no DOM, no I/O, no timer and no module state. A page's script text is UNTRUSTED: this file
// only reads it, and what it finds is decided by the planner (`plan.ts`) under the one sibling rule (`resolveDocRef`).
//
//   scanScript        one script's static import specifiers, the dynamic imports it cannot follow, and its plain string
//                     literals, by a bounded lexer that skips comments, strings, templates and regular expressions
//   scanScriptBytes   the same over bytes, so spans are byte offsets and a rewrite keeps every other byte
//   scriptChildRefs   what a sibling script (module or classic) names, as references keyed under its parent
//   readImportMap     an import map's entries, or a refusal of the whole map
//   fetchCandidate    whether a string literal names a sibling the fetch shim may answer
//   scriptJson        JSON that cannot end a script element, open a comment in it, or break a line of it
//
// The lexer is a heuristic, as every regular-expression-versus-division guess without a parser is: a misread finds a
// specifier that is not one, or misses one. Neither moves a wall: a rewrite only replaces the content between a string's
// quotes with `#mockup/<n>`, and the policy, not this scan, is what stops a page reaching anything.
import { resolveDocRef, type DocSectionSlug } from '../../../../shared/docs';
import { MOCKUP_FETCH_MIME, MOCKUP_IMPORT_MAP_MAX_ENTRIES, MOCKUP_SCRIPT_MAX_REFS, MOCKUP_SCRIPT_SCAN_BYTES } from './policy';
import type { MockupBase, MockupRef } from './ports';

/** A string literal's CONTENT span (between its quotes, exclusive) and its text as written. */
export interface ScriptString {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
}

/** One `import(` the scan found: its argument's literal (a string with no escape), or null when the argument is anything
 *  else; `text` is the call as written, cut at 120 characters, for the census. */
export interface ScriptDynamic {
  readonly literal: string | null;
  readonly text: string;
}

/** What one script's scan found, each list in text order. `over`: the text is past `MOCKUP_SCRIPT_SCAN_BYTES`, and nothing
 *  was scanned. */
export interface ScriptScan {
  readonly specifiers: readonly ScriptString[];
  readonly dynamic: readonly ScriptDynamic[];
  readonly literals: readonly ScriptString[];
  readonly over: boolean;
}

const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c
  || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0xfeff;
const isIdent = (c: number): boolean => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)
  || c === 0x24 || c === 0x5f || c >= 0x80;
/** The most characters of a dynamic import the census shows, from `import` on. */
const DYNAMIC_TEXT_UNITS = 120;
/** Keywords after which a `/` opens a regular expression. */
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** The UTF-8 length of `text`, or a number above the bound as soon as it is passed (a linear count that stops early). */
function utf8Over(text: string, bound: number): boolean {
  if (text.length > bound) return true;
  if (text.length * 3 <= bound) return false;
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : c >= 0xdc00 && c <= 0xdfff ? 0 : 3;
    if (n > bound) return true;
  }
  return false;
}

/** One script's text scanned (see `ScriptScan`). Linear: every character is read a bounded number of times. A text past
 *  `MOCKUP_SCRIPT_SCAN_BYTES` (as UTF-8) is not scanned. An unterminated comment, string, template or regular expression
 *  ends the scan where it starts. */
export function scanScript(text: string): ScriptScan {
  if (utf8Over(text, MOCKUP_SCRIPT_SCAN_BYTES)) return { specifiers: [], dynamic: [], literals: [], over: true };
  const n = text.length;
  const specifiers: ScriptString[] = [];
  const dynamic: ScriptDynamic[] = [];
  const literals: ScriptString[] = [];
  const templates: number[] = []; // the brace depth at which each open template's `${` was entered
  let depth = 0;
  let regexOk = true;
  let pendingFrom = false;
  let prevDot = false; // the last significant character was `.`
  let i = 0;

  /** The index after `j`'s whitespace and comments, or -1 at an unterminated comment. */
  const skip = (j: number): number => {
    for (;;) {
      while (j < n && isSpace(text.charCodeAt(j))) j += 1;
      if (text.charCodeAt(j) === 0x2f && text.charCodeAt(j + 1) === 0x2f) {
        while (j < n && text.charCodeAt(j) !== 0x0a && text.charCodeAt(j) !== 0x0d) j += 1;
        continue;
      }
      if (text.charCodeAt(j) === 0x2f && text.charCodeAt(j + 1) === 0x2a) {
        const e = text.indexOf('*/', j + 2);
        if (e < 0) return -1;
        j = e + 2;
        continue;
      }
      return j;
    }
  };
  /** A quoted string at `j` (its quote): its content span and the index after it, or null if unterminated. */
  const quoted = (j: number): { s: ScriptString; escaped: boolean; next: number } | null => {
    const q = text.charCodeAt(j);
    let k = j + 1;
    let escaped = false;
    while (k < n) {
      const c = text.charCodeAt(k);
      if (c === q) return { s: { start: j + 1, end: k, raw: text.slice(j + 1, k) }, escaped, next: k + 1 };
      if (c === 0x5c) {
        escaped = true;
        k += 2;
        continue;
      }
      if (c === 0x0a || c === 0x0d) return null;
      k += 1;
    }
    return null;
  };
  /** Template text from `j` (just after a backtick or a closing `}`): the index after its end, and whether it ended at a
   *  backtick (`closed`) or opened a substitution. */
  const templateText = (j: number): { next: number; closed: boolean; escaped: boolean } | null => {
    let k = j;
    let escaped = false;
    while (k < n) {
      const c = text.charCodeAt(k);
      if (c === 0x60) return { next: k + 1, closed: true, escaped };
      if (c === 0x5c) {
        escaped = true;
        k += 2;
        continue;
      }
      if (c === 0x24 && text.charCodeAt(k + 1) === 0x7b) return { next: k + 2, closed: false, escaped };
      k += 1;
    }
    return null;
  };

  while (i < n) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    if (c === 0x2f && (text.charCodeAt(i + 1) === 0x2f || text.charCodeAt(i + 1) === 0x2a)) {
      const j = skip(i);
      if (j < 0) break;
      i = j;
      continue;
    }
    if (c === 0x27 || c === 0x22) {
      const q = quoted(i);
      if (q === null) break;
      if (!q.escaped) literals.push(q.s);
      i = q.next;
      regexOk = false;
      prevDot = false;
      continue;
    }
    if (c === 0x60) {
      const t = templateText(i + 1);
      if (t === null) break;
      if (t.closed && !t.escaped) literals.push({ start: i + 1, end: t.next - 1, raw: text.slice(i + 1, t.next - 1) });
      if (!t.closed) templates.push(depth);
      i = t.next;
      regexOk = !t.closed;
      prevDot = false;
      continue;
    }
    if (c === 0x7d && templates.length > 0 && templates[templates.length - 1] === depth) {
      templates.pop();
      const t = templateText(i + 1);
      if (t === null) break;
      if (!t.closed) templates.push(depth);
      i = t.next;
      regexOk = !t.closed;
      prevDot = false;
      continue;
    }
    if (c === 0x2f) {
      if (regexOk) {
        let k = i + 1;
        let inClass = false;
        let ended = false;
        while (k < n) {
          const r = text.charCodeAt(k);
          if (r === 0x0a || r === 0x0d) break;
          if (r === 0x5c) {
            k += 2;
            continue;
          }
          if (r === 0x5b) inClass = true;
          else if (r === 0x5d) inClass = false;
          else if (r === 0x2f && !inClass) {
            ended = true;
            break;
          }
          k += 1;
        }
        if (!ended) break;
        k += 1;
        while (k < n && isIdent(text.charCodeAt(k))) k += 1;
        i = k;
        regexOk = false;
      } else {
        i += 1;
        regexOk = true;
      }
      prevDot = false;
      continue;
    }
    if (isIdent(c)) {
      let k = i + 1;
      while (k < n && isIdent(text.charCodeAt(k))) k += 1;
      const word = text.slice(i, k);
      const afterDot = prevDot;
      i = k;
      prevDot = false;
      regexOk = REGEX_AFTER.has(word);
      if (afterDot) continue;
      if (word === 'import') {
        const j = skip(i);
        if (j < 0) break;
        const d = text.charCodeAt(j);
        if (d === 0x28) {
          // A dynamic import: its argument is read only when it is one plain string literal.
          const a = skip(j + 1);
          let literal: string | null = null;
          if (a >= 0 && (text.charCodeAt(a) === 0x27 || text.charCodeAt(a) === 0x22)) {
            const q = quoted(a);
            const after = q === null ? -1 : skip(q.next);
            if (q !== null && !q.escaped && after >= 0 && (text.charCodeAt(after) === 0x29 || text.charCodeAt(after) === 0x2c)) {
              literal = q.s.raw;
            }
          }
          // The census text: the call up to its first `)` within DYNAMIC_TEXT_UNITS of `import`, never a search past that
          // window, so a text full of `import(` with no `)` stays linear (review: an unbounded search was quadratic).
          const from = i - 6;
          const window = text.slice(from, Math.min(n, from + DYNAMIC_TEXT_UNITS));
          const close = window.indexOf(')');
          if (dynamic.length <= MOCKUP_SCRIPT_MAX_REFS) dynamic.push({ literal, text: close < 0 ? window : window.slice(0, close + 1) });
          regexOk = true;
          continue;
        }
        if (d === 0x2e) continue; // import.meta
        if (d === 0x27 || d === 0x22) {
          const q = quoted(j);
          if (q === null) break;
          if (specifiers.length <= MOCKUP_SCRIPT_MAX_REFS) specifiers.push(q.escaped ? { ...q.s, raw: `\\${q.s.raw}` } : q.s);
          i = q.next;
          regexOk = false;
          continue;
        }
        pendingFrom = true;
        continue;
      }
      if (word === 'export') {
        pendingFrom = true;
        continue;
      }
      if (word === 'from' && pendingFrom) {
        const j = skip(i);
        if (j < 0) break;
        const d = text.charCodeAt(j);
        if (d === 0x27 || d === 0x22) {
          const q = quoted(j);
          if (q === null) break;
          if (specifiers.length <= MOCKUP_SCRIPT_MAX_REFS) specifiers.push(q.escaped ? { ...q.s, raw: `\\${q.s.raw}` } : q.s);
          pendingFrom = false;
          i = q.next;
          regexOk = false;
        }
      }
      continue;
    }
    // A punctuator.
    if (c === 0x7b) depth += 1;
    else if (c === 0x7d) depth -= 1;
    if (c === 0x3b || c === 0x3d) pendingFrom = false;
    prevDot = c === 0x2e && !(text.charCodeAt(i + 1) === 0x2e);
    regexOk = !(c === 0x29 || c === 0x5d);
    i += 1;
  }
  return { specifiers, dynamic, literals, over: false };
}

// ---------------------------------------------------------------------------------------------------------------
// The same scan over BYTES, so a rewrite keeps every byte it does not replace (as `css.ts` does for a stylesheet).
// ---------------------------------------------------------------------------------------------------------------
const rawDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

function byteString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x2000) out += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return out;
}

/** `scanScript` over bytes: spans are byte offsets, and each string's `raw` is decoded as UTF-8. Every byte above 0x7f is
 *  read as an identifier character, which is what it is inside a name and harmless inside a string or a comment. */
export function scanScriptBytes(bytes: Uint8Array): ScriptScan {
  if (bytes.length > MOCKUP_SCRIPT_SCAN_BYTES) return { specifiers: [], dynamic: [], literals: [], over: true };
  const s = scanScript(byteString(bytes));
  const fix = (x: ScriptString): ScriptString => ({ ...x, raw: x.raw.startsWith('\\') ? x.raw : rawDecoder.decode(bytes.subarray(x.start, x.end)) });
  return {
    specifiers: s.specifiers.map(fix),
    dynamic: s.dynamic.map((d) => ({ literal: d.literal === null ? null : rawDecoder.decode(new Uint8Array([...d.literal].map((ch) => ch.charCodeAt(0)))), text: d.text })),
    literals: s.literals.map(fix),
    over: s.over,
  };
}

/** How a specifier is written: a path (`./`, `../`, `/`), a URL with a scheme, or a bare name. */
export function specifierForm(raw: string): 'path' | 'url' | 'bare' {
  if (raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('/')) return 'path';
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) ? 'url' : 'bare';
}

/** Whether a bare name is one an import map entry maps: the same key, or a key ending in `/` that the name starts with. */
export function mapNames(keys: readonly string[], name: string): boolean {
  return keys.some((k) => k === name || (k.endsWith('/') && name.startsWith(k)));
}

/** Whether a string literal names a sibling the fetch shim may answer (spec 4.8): a relative path, with no scheme, no
 *  leading `/`, `#` or `?`, no backslash, quote, angle bracket or whitespace, at most 1024 characters, whose final
 *  extension (before any `?` or `#`) is in `MOCKUP_FETCH_MIME`. Only a candidate: the planner decides what it is. */
export function fetchCandidate(raw: string): boolean {
  if (raw.length === 0 || raw.length > 1024) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || /^[/#?]/.test(raw) || /[\s\\'"`<>]/.test(raw)) return false;
  const cut = raw.search(/[?#]/);
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return Object.prototype.hasOwnProperty.call(MOCKUP_FETCH_MIME, name.slice(dot + 1).toLowerCase());
}

/** What one script names, as references (X2 P6.2). `module`: a module's static specifiers are followed (resolved from
 *  `base`, the script's own file) and its dynamic imports reported; a classic script yields only its fetch names. A literal
 *  `https` dynamic import, and (`inline`) a static `https` specifier of an inline page module, yield nothing: the page's
 *  script-text census already offers that origin, as it did before this loader. A bare name an import map entry names
 *  (`mapKeys`) yields nothing: the map's own reference loads it. Fetch names resolve from `page`, the document. Keys are
 *  `key(tag, index)`; past `MOCKUP_SCRIPT_MAX_REFS` the first reference left out becomes one `scan-limit` row. */
export function scriptRefs(
  scan: ScriptScan, opts: {
    readonly module: boolean; readonly inline: boolean; readonly base: MockupBase; readonly page: MockupBase; readonly depth: number;
    readonly mapKeys: readonly string[]; readonly key: (tag: string, index: number) => string;
  },
): { refs: MockupRef[]; sites: (ScriptString | null)[] } {
  const refs: MockupRef[] = [];
  const sites: (ScriptString | null)[] = [];
  let full = false;
  const push = (ref: MockupRef, site: ScriptString | null): void => {
    if (full) return;
    if (refs.length >= MOCKUP_SCRIPT_MAX_REFS) {
      full = true;
      refs.push({ ...ref, unread: 'scan-limit' });
      sites.push(null);
      return;
    }
    refs.push(ref);
    sites.push(site);
  };
  const { base, page, depth, key } = opts;
  if (scan.over) {
    push({ key: key('o', 0), raw: '…', basePath: base, kind: 'module', depth, unread: 'scan-limit' }, null);
    return { refs, sites };
  }
  if (opts.module) {
    scan.specifiers.forEach((s, i) => {
      const k = key('i', i);
      if (s.raw.startsWith('\\')) {
        push({ key: k, raw: s.raw.slice(1), basePath: base, kind: 'module', depth, spec: 'import', unread: 'unreadable' }, null);
        return;
      }
      const form = specifierForm(s.raw);
      if (form === 'bare') {
        if (!mapNames(opts.mapKeys, s.raw)) push({ key: k, raw: s.raw, basePath: base, kind: 'module', depth, spec: 'import', unread: 'bare' }, null);
        return;
      }
      if (form === 'url' && opts.inline && /^https:/i.test(s.raw)) return;
      push({ key: k, raw: s.raw, basePath: base, kind: 'module', depth, spec: 'import' }, s);
    });
  }
  scan.dynamic.forEach((d, i) => {
    if (d.literal !== null && specifierForm(d.literal) === 'url' && /^https:/i.test(d.literal)) return;
    if (d.literal !== null && specifierForm(d.literal) === 'bare' && mapNames(opts.mapKeys, d.literal)) return;
    push({ key: key('d', i), raw: d.literal ?? d.text, basePath: base, kind: 'module', depth, spec: 'import', unread: 'dynamic' }, null);
  });
  scan.literals.forEach((l, i) => {
    if (fetchCandidate(l.raw)) push({ key: key('f', i), raw: l.raw, basePath: page, kind: 'fetch', depth }, null);
  });
  return { refs, sites };
}

/** Every key below `root` in a module graph, each once, in depth-first order: `children(file)` answers a file's imports as
 *  `[key, file]` pairs. One walk with a visited set, so a layered graph (each module importing every module of the next
 *  layer) costs its edges, never its paths (review: a list built by concatenating each child's list grew with the paths). */
export function graphKeysBelow(root: string, children: (file: string) => readonly (readonly [string, string])[]): string[] {
  const out: string[] = [];
  const seenFiles = new Set<string>([root]);
  const seenKeys = new Set<string>();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const file = stack.pop()!;
    const next = children(file);
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const [key, child] = next[i]!;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        out.push(key);
      }
      if (!seenFiles.has(child)) {
        seenFiles.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

/** The `<section>/<path>` of the file `parent` names, resolved from its own base (the loader reads only a parent it was
 *  admitted to read, so this THROWS on anything else). */
export function fileBaseOf(parent: MockupRef): MockupBase {
  const slash = parent.basePath.indexOf('/');
  const r = resolveDocRef({ section: parent.basePath.slice(0, slash) as DocSectionSlug, path: parent.basePath.slice(slash + 1) }, parent.raw);
  if (r.kind !== 'doc') throw new Error(`mockup scripts: '${parent.raw}' is not a docs file`);
  return `${r.section}/${r.path}`;
}

/** What a sibling script names (`scriptRefs` over its bytes), keyed under `parent`: `${parent.key}>i<n>` for an import,
 *  `>d<n>` a dynamic import, `>f<n>` a fetch name, `>o0` an over-long text. `refs[i]`'s site in the bytes is `sites[i]` (an
 *  import the build may rewrite), or null. */
export function scriptChildRefs(
  bytes: Uint8Array, parent: MockupRef, page: MockupBase, mapKeys: readonly string[],
): { refs: MockupRef[]; sites: (ScriptString | null)[] } {
  return scriptRefs(scanScriptBytes(bytes), {
    module: parent.kind === 'module', inline: false, base: fileBaseOf(parent), page, depth: parent.depth + 1, mapKeys,
    key: (tag, index) => `${parent.key}>${tag}${index}`,
  });
}

/** An import map's entries in order, or a refusal of the whole map (spec 4.8: "A map naming anything else is refused as
 *  now"). Refused: text that is not JSON, anything but one top-level `imports` object (a `scopes` or `integrity` key
 *  included), more than `MOCKUP_IMPORT_MAP_MAX_ENTRIES` entries, a value that is not a string, a value that is neither a
 *  path (`./`, `../`, `/`) nor an `https:` URL, and a key ending in `/` whose value is a path (a sibling directory cannot be
 *  inlined file by file). Whether a path value names a sibling is the planner's to decide. */
export function readImportMap(text: string): { ok: true; entries: [string, string][] } | { ok: false } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false };
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== 'imports') return { ok: false };
  const imports = (v as { imports: unknown }).imports;
  if (typeof imports !== 'object' || imports === null || Array.isArray(imports)) return { ok: false };
  const entries = Object.entries(imports as Record<string, unknown>);
  if (entries.length > MOCKUP_IMPORT_MAP_MAX_ENTRIES) return { ok: false };
  const out: [string, string][] = [];
  for (const [k, val] of entries) {
    if (typeof val !== 'string') return { ok: false };
    const form = specifierForm(val);
    if (form === 'path') {
      if (k.endsWith('/') || val.startsWith('//')) return { ok: false };
    } else if (form !== 'url' || !/^https:\/\/[^/]/i.test(val)) {
      return { ok: false };
    }
    out.push([k, val]);
  }
  return { ok: true, entries: out };
}

/** `value` as JSON for the text of a script element the build writes (an import map, the fetch shim's table): every `<`,
 *  `>` and `&`, and U+2028 and U+2029, as a `\u` escape, so the text cannot end its element (`</script`), open a comment
 *  or a nested script state (`<!--`, `<script`), or break a line; `JSON.stringify` already escapes every control character,
 *  NUL included. The HTML serializer writes a script's text as it stands, so this is what keeps page-controlled keys inert. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The characters `scriptJson` escapes: `<`, `>`, `&`, U+2028 and U+2029. Built from code points, so no line separator
 *  stands in this file's source. */
const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
