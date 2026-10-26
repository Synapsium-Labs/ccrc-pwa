// D1, the Codex source watch (codex bridge spec §2.9; Stage 2 plan, Task 19). The bridge (`ccd/codexbridge/`) speaks
// the ChatGPT backend's Responses route the way the Codex CLI does, so a change to the CLI's wire is a change the
// bridge may have to follow. Each run lists the stable `rust-v*` releases of openai/codex, reads the last WALKED tag
// from one state issue (`codex wire: state`, whose body is that tag alone), and for every consecutive pair of stable
// tags from there on, oldest first, fetches the nine contract files at both tags and diffs what they name: the
// fields of a struct that is sent and the variants of an enum that is sent, and the event, error-code, header and
// endpoint literals. A pair with findings opens one issue, `codex wire: <old>..<new>`, unless an issue of that title
// already exists; a pair with none opens nothing.
//
// The walk never skips a release. A pair counts as walked only when all nine files were read at both of its tags and
// its issue (if any) is open; the first pair that cannot be compared ends the walk, the state stays at the last pair
// walked, and the job exits non-zero. With no state issue yet, the walk is the newest pair. The state and the
// "already opened" check read only issues the workflow's own token opened (`BOT_LOGIN`): this repository is public,
// and anyone can open an issue with either title.
//
// Pure parts (`contractFacts`, `wireReport`, `nextPairs`, `pairTitle`, `issueBody`) and the walk (`runWatch`) are
// unit-tested offline in server/test/codex-wire-watch.test.ts; `githubIo` is the only code that talks to the REST
// API, and its `fetch` is injected there. The extraction is lexical, over Rust source with comments, doc comments and
// `#[cfg(test)]` modules removed: a real-file shape it misses is found by the first real run (D-6424).
import { pathToFileURL } from 'node:url';

export const UPSTREAM = 'openai/codex';
export const CONTRACT_ROOT = 'codex-rs';
/** The nine wire-contract files, relative to `CONTRACT_ROOT` (spec D1; plan Task 19). */
export const CONTRACT_FILES = Object.freeze([
  'codex-api/src/common.rs',
  'codex-api/src/sse/responses.rs',
  'codex-api/src/sse/responses_error.rs',
  'codex-api/src/api_bridge.rs',
  'core/src/client.rs',
  'core/src/context/base_instructions.rs',
  'protocol/src/models.rs',
  'protocol/src/openai_models.rs',
  'core/src/responses_retry.rs',
]);
export const STATE_TITLE = 'codex wire: state';
/** The author of every issue `GITHUB_TOKEN` opens. */
export const BOT_LOGIN = 'github-actions[bot]';
export const STABLE_TAG_RE = /^rust-v(\d+)\.(\d+)\.(\d+)$/;
/** At most this many findings are listed in one issue body; the rest are counted. */
export const BODY_FINDINGS_MAX = 200;

/** The families a finding names, in report order. */
export const FAMILIES = Object.freeze(['request-struct field', 'event literal', 'error-code literal', 'header literal', 'endpoint literal']);

const SNAKE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const DOTTED_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const HYPHEN_HEADER_RE = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)+$/;
const HEADER_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]+$/;
const ABS_PATH_RE = /^\/[a-z0-9_{}.-]+(?:\/[a-z0-9_{}.-]+)*\/?$/;
const REL_PATH_RE = /^[a-z][a-z0-9_-]*(?:\/[a-z0-9_{}.-]+)+$/;
const MEDIA_TYPE_RE = /^(?:application|text|image|audio|video|multipart)\//;
const URL_RE = /^https?:\/\/[^\s"]+$/;
const IDENT_CHAR_RE = /[A-Za-z0-9_]/;
/** A literal is a candidate name only in this shape, so an issue body never carries upstream prose, markup or a
 *  mention: no whitespace, backtick, `@`, `<` or `>`, at most 200 characters. */
const PRINTABLE_NAME_RE = /^[^\s`@<>]{1,200}$/;

/**
 * Comments, doc comments and string-literal contents blanked (newlines kept, so offsets and lines still match the
 * source), and every string literal with its offset. A `'` is a char literal only in a char literal's exact shape;
 * otherwise it is a lifetime or a label.
 * @param {string} src @returns {{ code: string, literals: Array<{ value: string, at: number }> }}
 */
function lex(src) {
  const out = src.split('');
  /** @type {Array<{ value: string, at: number }>} */
  const literals = [];
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : '';
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; } else if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    const raw = (c === 'r' || c === 'b' || c === 'c') && !IDENT_CHAR_RE.test(prev)
      ? /^(?:b|c)?r(#*)"/.exec(src.slice(i, i + 260)) : null;
    if (raw) {
      const open = i + raw[0].length;
      const close = src.indexOf(`"${raw[1]}`, open);
      const stop = close === -1 ? n : close;
      literals.push({ value: src.slice(open, stop), at: i });
      blank(open, stop);
      i = close === -1 ? n : stop + 1 + raw[1].length;
      continue;
    }
    if (c === '"' || ((c === 'b' || c === 'c') && src[i + 1] === '"' && !IDENT_CHAR_RE.test(prev))) {
      const open = c === '"' ? i + 1 : i + 2;
      let j = open;
      while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      literals.push({ value: src.slice(open, Math.min(j, n)), at: i });
      blank(open, Math.min(j, n));
      i = j + 1;
      continue;
    }
    if (c === '\'') {
      const ch = /^'(?:\\(?:[nrt\\'"0]|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\})|[^\\'\n])'/.exec(src.slice(i, i + 12));
      if (ch) { blank(i + 1, i + ch[0].length - 1); i += ch[0].length; continue; }
    }
    i++;
  }
  return { code: out.join(''), literals };
}

/** The offset just past the `}` that closes the `{` at `open`, in lexed code. */
function closeBrace(code, open) {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}' && --depth === 0) return k + 1;
  }
  return code.length;
}

/** The `[from, to)` ranges of every `#[cfg(test)]` module, in lexed code. */
function testModules(code) {
  const ranges = [];
  const re = /#\[cfg\(test\)\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+[A-Za-z_]\w*\s*\{/g;
  for (let m; (m = re.exec(code));) ranges.push([m.index, closeBrace(code, m.index + m[0].length - 1)]);
  return ranges;
}

/** The top-level comma-separated items of a struct or enum body (the text between its braces), attributes removed. */
function bodyItems(body) {
  const items = [];
  let depth = 0;
  let seg = '';
  const flush = () => {
    const s = seg.replace(/#\[[^\]]*\]/g, ' ').trim();
    if (s) items.push(s);
    seg = '';
  };
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === '-' && body[k + 1] === '>') { seg += '->'; k++; continue; }
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { flush(); continue; }
    seg += ch;
  }
  flush();
  return items;
}

/** The field names declared at the top level of a struct body. */
function structFields(body) {
  return bodyItems(body).flatMap((s) => {
    const m = /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:r#)?([A-Za-z_]\w*)\s*:(?!:)/.exec(s);
    return m ? [m[1]] : [];
  });
}

/** An enum body's variants, `Variant`, and the fields of each struct-like variant, `Variant.field`. */
function enumMembers(body) {
  return bodyItems(body).flatMap((s) => {
    const m = /^([A-Za-z_]\w*)\s*(\{)?/.exec(s);
    if (!m) return [];
    if (!m[2]) return [m[1]];
    const inner = s.slice(m[0].length, s.lastIndexOf('}'));
    return [m[1], ...structFields(inner).map((f) => `${m[1]}.${f}`)];
  });
}

/**
 * What one contract file names, by family: `request-struct field` keys are `Struct.field` for every struct that
 * derives `Serialize` or whose name ends in `Request` (what is sent), and `Enum::Variant` and `Enum::Variant.field` for
 * every enum that derives `Serialize`; the literal families are classified by shape and by the line they sit on. A name
 * may sit in more than one family.
 * @param {string} src @returns {Record<string, Set<string>>}
 */
export function contractFacts(src) {
  const { code, literals } = lex(src);
  const cut = testModules(code);
  const inTest = (at) => cut.some(([a, b]) => at >= a && at < b);
  /** @type {Record<string, Set<string>>} */
  const facts = Object.fromEntries(FAMILIES.map((f) => [f, new Set()]));

  const structRe = /((?:#\[[^\]]*\]\s*)*)(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)\s*(?:<[^{;]*>)?\s*(?:where[^{;]*)?\{/g;
  for (let m; (m = structRe.exec(code));) {
    if (inTest(m.index)) continue;
    const sent = /\bSerialize\b/.test(m[1]) || /Request$/.test(m[2]);
    if (!sent) continue;
    const open = m.index + m[0].length - 1;
    for (const f of structFields(code.slice(open + 1, closeBrace(code, open) - 1))) facts['request-struct field'].add(`${m[2]}.${f}`);
  }
  // An enum that is sent is a request shape too: its variants (`Enum::Variant`) and a struct-like variant's fields
  // (`Enum::Variant.field`) — the input items are one such enum.
  const enumRe = /((?:#\[[^\]]*\]\s*)*)(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)\s*(?:<[^{;]*>)?\s*(?:where[^{;]*)?\{/g;
  for (let m; (m = enumRe.exec(code));) {
    if (inTest(m.index) || !/\bSerialize\b/.test(m[1])) continue;
    const open = m.index + m[0].length - 1;
    for (const v of enumMembers(code.slice(open + 1, closeBrace(code, open) - 1))) facts['request-struct field'].add(`${m[2]}::${v}`);
  }

  for (const { value, at } of literals) {
    if (inTest(at) || !PRINTABLE_NAME_RE.test(value)) continue;
    const ls = code.lastIndexOf('\n', at) + 1;
    const le = code.indexOf('\n', at);
    const line = code.slice(ls, le === -1 ? code.length : le);
    const arm = line.includes('=>');
    if (DOTTED_RE.test(value) && (value.startsWith('response.') || arm || /event|kind|type/i.test(line))) facts['event literal'].add(value);
    if (SNAKE_RE.test(value) && (arm || /\bcode\b|_code\b|\bcode_/.test(line))) facts['error-code literal'].add(value);
    if (HYPHEN_HEADER_RE.test(value) || (HEADER_TOKEN_RE.test(value) && /header|from_static/i.test(line))) facts['header literal'].add(value);
    const constLine = /\bconst\s+[A-Z0-9_]*(?:ENDPOINT|PATH|ROUTE|URL)[A-Z0-9_]*\s*:/.test(line);
    if (URL_RE.test(value) || (!MEDIA_TYPE_RE.test(value) && (ABS_PATH_RE.test(value) || REL_PATH_RE.test(value)))
      || constLine) facts['endpoint literal'].add(value);
  }
  return facts;
}

/** Every name of every family across one tag's contract files, with the files that name it.
 *  @param {Record<string, string>} files @returns {Map<string, Set<string>>} keyed `<family>\0<name>` */
function unionFacts(files, side) {
  /** @type {Map<string, Set<string>>} */
  const all = new Map();
  for (const file of CONTRACT_FILES) {
    const src = files[file];
    if (typeof src !== 'string') throw new Error(`the ${side} side has no ${file}: a pair is compared only on all nine contract files`);
    const facts = contractFacts(src);
    for (const fam of FAMILIES) {
      for (const name of facts[fam]) {
        const key = `${fam}\0${name}`;
        if (!all.has(key)) all.set(key, new Set());
        /** @type {Set<string>} */ (all.get(key)).add(file);
      }
    }
  }
  return all;
}

/**
 * The difference between one tag's nine contract files and the next's: `changed` is the files whose text differs
 * (contract order), `findings` one line per name that one side holds and the other does not, across all nine files
 * (a name that only moves between them is no finding), sorted by family, then removed before added, then name.
 * @param {Record<string, string>} before @param {Record<string, string>} after
 * @returns {{ changed: string[], findings: string[] }}
 */
export function wireReport(before, after) {
  const was = unionFacts(before, 'older');
  const now = unionFacts(after, 'newer');
  const changed = CONTRACT_FILES.filter((f) => before[f] !== after[f]);
  /** @type {Array<{ fam: number, kind: number, name: string, line: string }>} */
  const rows = [];
  const note = (kind, key, files) => {
    const [fam, name] = key.split('\0');
    const where = [...files].sort((a, b) => CONTRACT_FILES.indexOf(a) - CONTRACT_FILES.indexOf(b)).join(', ');
    rows.push({ fam: FAMILIES.indexOf(fam), kind: kind === 'removed' ? 0 : 1, name, line: `${kind} ${fam} \`${name}\` (${where})` });
  };
  for (const [key, files] of was) if (!now.has(key)) note('removed', key, files);
  for (const [key, files] of now) if (!was.has(key)) note('added', key, files);
  rows.sort((a, b) => a.fam - b.fam || a.kind - b.kind || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { changed, findings: rows.map((r) => r.line) };
}

/** @param {string} t @returns {number[]} */
function version(t) {
  const m = STABLE_TAG_RE.exec(t);
  if (!m) throw new Error(`not a stable tag: ${JSON.stringify(t)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const byVersion = (a, b) => {
  const x = version(a);
  const y = version(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * Every consecutive pair of stable tags from `lastWalked` on, oldest first; with no state yet, the newest pair only.
 * `lastWalked` is part of the walk even when the listing no longer holds it, so nothing after it is skipped; a state
 * that is not a stable tag throws rather than restart the walk somewhere else.
 * @param {string[]} stableTags @param {string | null} lastWalked @returns {Array<[string, string]>}
 */
export function nextPairs(stableTags, lastWalked) {
  if (lastWalked !== null && !STABLE_TAG_RE.test(lastWalked)) {
    throw new Error(`the state ${JSON.stringify(lastWalked)} is not a stable rust-v<x>.<y>.<z> tag`);
  }
  const tags = [...new Set(stableTags.filter((t) => STABLE_TAG_RE.test(t)))].sort(byVersion);
  /** @type {Array<[string, string]>} */
  const pairs = [];
  if (lastWalked === null) {
    if (tags.length >= 2) pairs.push([/** @type {string} */ (tags[tags.length - 2]), /** @type {string} */ (tags[tags.length - 1])]);
    return pairs;
  }
  const walk = [lastWalked, ...tags.filter((t) => byVersion(t, lastWalked) > 0)];
  for (let k = 1; k < walk.length; k++) pairs.push([/** @type {string} */ (walk[k - 1]), /** @type {string} */ (walk[k])]);
  return pairs;
}

/** @param {string} older @param {string} newer @returns {string} */
export function pairTitle(older, newer) {
  return `codex wire: ${older}..${newer}`;
}

/** The finding issue's body: the pair, the upstream compare link, the findings and the changed files — upstream
 *  names only. @param {string} older @param {string} newer @param {{ changed: string[], findings: string[] }} report
 *  @returns {string} */
export function issueBody(older, newer, report) {
  const shown = report.findings.slice(0, BODY_FINDINGS_MAX);
  const more = report.findings.length - shown.length;
  return [
    `The wire-contract files of ${UPSTREAM} changed between \`${older}\` and \`${newer}\`.`,
    '',
    `Compare: https://github.com/${UPSTREAM}/compare/${older}...${newer}`,
    '',
    'Findings:',
    ...shown.map((f) => `- ${f}`),
    ...(more > 0 ? [`- … and ${more} more`] : []),
    '',
    'Changed contract files:',
    ...report.changed.map((f) => `- \`${CONTRACT_ROOT}/${f}\``),
    '',
  ].join('\n');
}

/**
 * @typedef {{ number: number, title: string, body: string }} OwnIssue
 * @typedef {{
 *   ownIssues: () => Promise<OwnIssue[]>,
 *   stableTags: (lastWalked: string | null) => Promise<string[]>,
 *   files: (tag: string) => Promise<Record<string, string>>,
 *   openIssue: (title: string, body: string) => Promise<void>,
 *   writeState: (tag: string, issueNumber: number | null) => Promise<void>,
 *   log: (line: string) => void,
 * }} WatchIo
 */

/** The walk. Returns the exit code: 0 when every pair since the state was walked, 1 when one could not be compared
 *  (the state then names the last pair walked). A failure to read the issues or the releases, or to write the state,
 *  throws. @param {WatchIo} io @returns {Promise<number>} */
export async function runWatch(io) {
  const own = await io.ownIssues();
  const states = own.filter((i) => i.title === STATE_TITLE).sort((a, b) => a.number - b.number);
  if (states.length > 1) io.log(`::warning::codex-wire-watch: ${states.length} state issues; reading #${states[0]?.number}`);
  const state = states[0] ?? null;
  const lastWalked = state ? state.body.trim() : null;
  const pairs = nextPairs(await io.stableTags(lastWalked), lastWalked);
  const titles = new Set(own.map((i) => i.title));
  io.log(`codex-wire-watch: state ${lastWalked ?? '(none)'}, ${pairs.length} pair(s) to walk`);

  /** @type {string | null} */
  let walked = null;
  /** @type {string | null} */
  let failure = null;
  for (const [older, newer] of pairs) {
    try {
      const report = wireReport(await io.files(older), await io.files(newer));
      const title = pairTitle(older, newer);
      if (report.findings.length > 0 && !titles.has(title)) {
        await io.openIssue(title, issueBody(older, newer, report));
        titles.add(title);
      }
      io.log(`codex-wire-watch: ${older}..${newer}: ${report.changed.length} file(s) changed, ${report.findings.length} finding(s)`);
      walked = newer;
    } catch (e) {
      failure = `${older}..${newer} could not be compared: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
  }
  if (walked !== null) await io.writeState(walked, state ? state.number : null);
  if (failure !== null) {
    io.log(`::error::codex-wire-watch: ${failure}; the state stays at ${walked ?? lastWalked ?? '(none)'}`);
    return 1;
  }
  return 0;
}

const PER_PAGE = 100;
const MAX_PAGES = 30;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * The REST layer: this repository's issues (read and written with the job's token) and openai/codex's releases and
 * contract files (read). Only issues `BOT_LOGIN` opened are returned, and never a pull request.
 * @typedef {{ method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal }} FetchInit
 * @param {{ repo: string, token: string, apiBase?: string,
 *   fetchImpl?: (url: string, init: FetchInit) => Promise<Response>, log?: (line: string) => void }} opts
 * @returns {WatchIo}
 */
export function githubIo({ repo, token, apiBase = 'https://api.github.com', fetchImpl = fetch, log = (l) => process.stdout.write(`${l}\n`) }) {
  const call = async (method, route, { body, accept = 'application/vnd.github+json' } = {}) => {
    const res = await fetchImpl(`${apiBase}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${method} ${route.split('?')[0]}: HTTP ${res.status}`);
    return res;
  };
  const list = async (route, stop) => {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const sep = route.includes('?') ? '&' : '?';
      const items = await (await call('GET', `${route}${sep}per_page=${PER_PAGE}&page=${page}`)).json();
      if (!Array.isArray(items)) throw new Error(`GET ${route.split('?')[0]}: the answer is not a list`);
      out.push(...items);
      if (items.length < PER_PAGE || stop(out)) return out;
    }
    throw new Error(`GET ${route.split('?')[0]}: more than ${MAX_PAGES} pages`);
  };
  /** @type {Map<string, Promise<Record<string, string>>>} */
  const cache = new Map();
  const readTag = async (tag) => {
    /** @type {Record<string, string>} */
    const files = {};
    for (const file of CONTRACT_FILES) {
      const route = `/repos/${UPSTREAM}/contents/${CONTRACT_ROOT}/${file}?ref=${encodeURIComponent(tag)}`;
      let res;
      try {
        res = await call('GET', route, { accept: 'application/vnd.github.raw' });
      } catch (e) {
        throw new Error(`${CONTRACT_ROOT}/${file} at ${tag}: ${e instanceof Error ? e.message : String(e)}`);
      }
      files[file] = await res.text();
    }
    return files;
  };
  return {
    log,
    async ownIssues() {
      const all = await list(`/repos/${repo}/issues?state=all&creator=${encodeURIComponent(BOT_LOGIN)}`, () => false);
      return all
        .filter((i) => i && typeof i === 'object' && !i.pull_request && i.user?.login === BOT_LOGIN
          && Number.isInteger(i.number) && typeof i.title === 'string')
        .map((i) => ({ number: i.number, title: i.title, body: typeof i.body === 'string' ? i.body : '' }));
    },
    async stableTags(lastWalked) {
      const stable = (rs) => rs.filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string'
        && STABLE_TAG_RE.test(r.tag_name)).map((r) => r.tag_name);
      const releases = await list(`/repos/${UPSTREAM}/releases`, (rs) => (lastWalked === null
        ? stable(rs).length >= 2
        : rs.some((r) => r && r.tag_name === lastWalked)));
      return stable(releases);
    },
    files(tag) {
      if (!cache.has(tag)) cache.set(tag, readTag(tag));
      return /** @type {Promise<Record<string, string>>} */ (cache.get(tag));
    },
    async openIssue(title, body) {
      await call('POST', `/repos/${repo}/issues`, { body: { title, body } });
      log(`codex-wire-watch: opened "${title}"`);
    },
    async writeState(tag, issueNumber) {
      if (issueNumber === null) await call('POST', `/repos/${repo}/issues`, { body: { title: STATE_TITLE, body: tag } });
      else await call('PATCH', `/repos/${repo}/issues/${issueNumber}`, { body: { body: tag } });
      log(`codex-wire-watch: state is now ${tag}`);
    },
  };
}

/** `node codex-wire-watch.mjs --repo OWNER/NAME`, with `GITHUB_TOKEN` (and `GITHUB_API_URL`) in the environment. */
async function main(argv) {
  const at = argv.indexOf('--repo');
  const repo = at === -1 ? undefined : argv[at + 1];
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('usage: node codex-wire-watch.mjs --repo OWNER/NAME');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return runWatch(githubIo({ repo, token, apiBase: process.env.GITHUB_API_URL || 'https://api.github.com' }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`::error::codex-wire-watch: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  });
}
