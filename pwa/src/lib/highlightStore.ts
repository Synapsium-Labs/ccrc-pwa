// The highlight store and the main thread's check (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section
// 4.10 "The store", "Page ceilings", "The line retry", "The single sink and its check"). One store per Docs page,
// text leaf, chat message or tool well, keyed by content, `${lang}\0${raw}`, so identical blocks share one entry and
// one job.
//   - `blockKey(lang, raw)` is the ONE function that answers a key, or why the block can never be requested: no
//     registered grammar, or over MD_HIGHLIGHT_BLOCK_MAX_CHARS (W5h-b retired W5 part 1's per-block bounds).
//     `store.keyOf` is it; `CodeBlock` and the seeding walk both ask it, so they never disagree.
//   - `seed(blocks)`, a Docs page's or a text leaf's, once, at creation: every requestable block, in document order,
//     each OCCURRENCE counted, a key that several blocks share included (review 1364 F1: every drawn copy inserts the
//     key's HTML, so every copy counts); the input ceiling applies here. The first occurrence of a key decides its
//     entry: past a ceiling, the key is `skipped` from the first commit, whatever order effects run in. A LATER
//     occurrence past a ceiling, of a key whose first occurrence was admitted, is a skipped COPY: `copySkip(at)` names
//     the ceiling for the copy's own `at`, the `pre` element, and the copy draws plain while its earlier siblings are
//     coloured. One job still serves the key.
//   - `copySkip(at)` is synchronous and never requests: the page ceiling that skipped this drawn copy, or `null` when
//     the copy draws its key's entry. A chat store, and a block with no `at`, answer `null`.
//   - `peek(key)` is synchronous and never requests; it returns the same entry object until that entry changes, and
//     one shared frozen `unrequested` entry for a key it has not seen (useSyncExternalStore's contract).
//   - `request(key)` adds a reference and asks the highlighter once per key; its release drops the reference, and
//     the last release detaches the key's job (the highlighter's `'detach'`: the worker lives on).
//   - `subscribe(key)` returns the same function for the same key; `subscribe()` is store-wide.
//   - `settled()`: a Docs store when every seeded key is `html`, `plain` or `skipped`; a chat store when no key a
//     mounted block references is `unrequested` or `pending`, a block referencing the key it shows (`show`) as well as
//     the key it requested, so a block in chat's debounce window, showing a key it has not requested yet, is waiting.
//   - On receipt, in this order (the W5h-a plan's refinement (e)): an outcome `readHighlightOutcome` does not know is
//     `malformed`, never left pending (the runner already answers a worker's unknown reply `worker-failed`,
//     `malformed-reply`, so this arm is any other highlighter's); an answer longer than MD_HIGHLIGHT_MAX_HTML_CHARS
//     is `too-large`; one the check refuses is `malformed`; on a Docs store, one that would take the page's HTML past
//     DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS is `skipped` by that ceiling, counted per drawn copy: each admitted copy of the
//     key adds the answer's length, in document order; the first copy that would pass the ceiling, and every later copy
//     of the key, is a skipped copy (the verdicts are recorded before the entry is set), and the ceiling latches. When
//     the FIRST copy is the one that passes, the entry is skipped. Only `checkHighlightHtml` makes a
//     `CheckedHighlightHtml`, a frozen `{html}` this module records in a private WeakSet; the sink inserts only a
//     value `isCheckedHighlightHtml` accepts.
//   - A first answer of `timeout` or `too-large` on a block longer than HIGHLIGHT_LINE_RETRY_UNITS is retried once,
//     line by line, while the ceilings admit it; the entry stays `pending` meanwhile, and a failed or refused retry
//     leaves it `plain` under its first failure.
//   - Page ceilings (option `ceilings`, on by default): a Docs store counts input (at seed), HTML received, timeouts and
//     worker time; a chat store the last two. Past a live one the store latches: every request not yet answered, and
//     every later one, is `skipped` by it, and its running job is detached. Worker time runs from the highlighter's
//     `onPosted` to the answer, live, so the ceiling can fire mid-job.
//   - A highlighter whose status is not `live` makes a request `plain` at once (refinement (g)): no main-thread
//     fallback.
//
// Ring L1: pure. Its clock and its highlighter are arguments (`highlighterContext.ts` supplies the real ones); it holds
// no timer global, makes no I/O and posts nothing.
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import {
  HIGHLIGHT_NAME_SET, codeLanguage, isRegisteredGrammar,
} from './highlightNames';
import type { Highlighter, HighlightOutcome } from './highlightProtocol';
import {
  DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS, HIGHLIGHT_LINE_RETRY_UNITS, HIGHLIGHT_PAGE_MAX_TIMEOUTS,
  HIGHLIGHT_PAGE_WORKER_MS, HIGHLIGHT_STREAM_DEBOUNCE_MS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
} from './markdownLimits';

// ---- The check ----

/** HTML the check accepted. Only `checkHighlightHtml` makes one; `isCheckedHighlightHtml` recognises it. */
export interface CheckedHighlightHtml {
  readonly html: string;
}

const CHECKED = new WeakSet<object>();
const ENTITIES: readonly string[] = ['&amp;', '&lt;', '&gt;', '&quot;', '&#x27;'];
const OPEN = '<span class="';
const CLOSE = '</span>';
const HLJS_PREFIX = 'hljs-';
const LANGUAGE_PREFIX = 'language-';

/** Whether `c` is one of `[a-z0-9]`. */
function isLowerAlnum(c: number): boolean {
  return (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
}

/** A class the check accepts: exactly what highlight.js 11 emits for a scope (`scopeToCSSClass`), or `language-NAME`
 *  for a registered name or alias. The value splits on SINGLE spaces, with no empty token; token 0 is `hljs-` and one
 *  or more of `[a-z0-9_-]`; token k >= 1 (a tiered scope's piece) is one or more of `[a-z0-9-]` and then exactly k
 *  underscores. One pass: each character is read once. */
function acceptedClass(cls: string): boolean {
  if (!cls.startsWith(HLJS_PREFIX)) {
    return cls.startsWith(LANGUAGE_PREFIX) && HIGHLIGHT_NAME_SET.has(cls.slice(LANGUAGE_PREFIX.length));
  }
  let pos = 0;
  for (let tier = 0; ; tier += 1) {
    const space = cls.indexOf(' ', pos);
    const end = space === -1 ? cls.length : space;
    if (tier === 0) {
      if (end - pos <= HLJS_PREFIX.length) return false;
      for (let k = pos + HLJS_PREFIX.length; k < end; k += 1) {
        const c = cls.charCodeAt(k);
        if (!(isLowerAlnum(c) || c === 0x5f || c === 0x2d)) return false;
      }
    } else {
      let body = end;
      while (body > pos && cls.charCodeAt(body - 1) === 0x5f) body -= 1;
      if (end - body !== tier || body === pos) return false;
      for (let k = pos; k < body; k += 1) {
        const c = cls.charCodeAt(k);
        if (!(isLowerAlnum(c) || c === 0x2d)) return false;
      }
    }
    if (space === -1) return true;
    pos = space + 1;
  }
}

/** The worker's HTML, checked: one linear pass that accepts exactly `<span class="…">` with an accepted class,
 *  `</span>`, and text holding no `<`, `>`, `"` or `'`, each `&` beginning one of the five entities, the spans
 *  balanced; `null` for anything else. `steps`, when given, counts the units the pass reads (M4.H14's linearity). */
export function checkHighlightHtml(html: string, steps?: { n: number }): CheckedHighlightHtml | null {
  let depth = 0;
  let i = 0;
  while (i < html.length) {
    if (steps !== undefined) steps.n += 1;
    const c = html.charCodeAt(i);
    if (c === 0x3c) {
      if (html.startsWith(CLOSE, i)) {
        depth -= 1;
        if (depth < 0) return null;
        i += CLOSE.length;
        continue;
      }
      if (!html.startsWith(OPEN, i)) return null;
      const start = i + OPEN.length;
      const end = html.indexOf('"', start);
      if (end === -1 || html.charCodeAt(end + 1) !== 0x3e) return null;
      if (steps !== undefined) steps.n += end - start;
      if (!acceptedClass(html.slice(start, end))) return null;
      depth += 1;
      i = end + 2;
      continue;
    }
    if (c === 0x3e || c === 0x22 || c === 0x27) return null;
    if (c === 0x26) {
      const entity = ENTITIES.find((e) => html.startsWith(e, i));
      if (entity === undefined) return null;
      i += entity.length;
      continue;
    }
    i += 1;
  }
  if (depth !== 0) return null;
  const checked: CheckedHighlightHtml = Object.freeze({ html });
  CHECKED.add(checked);
  return checked;
}

/** Whether `v` is a value `checkHighlightHtml` made (by identity, not by shape). */
export function isCheckedHighlightHtml(v: unknown): v is CheckedHighlightHtml {
  return typeof v === 'object' && v !== null && CHECKED.has(v);
}

/** A job's outcome, or `null` for a value that is not an outcome this build knows: exactly the arms of
 *  `HighlightOutcome`, each with its fields' types. The ONE shape check of an outcome: the runner reads a worker's reply
 *  through it, and the store reads what a highlighter answers through it, so a reply from a worker of another chunk
 *  version (an unknown `kind`, a missing field) settles its block and never leaves it pending (review 1364 A4). It
 *  lives here because this module is L1 and the runner (L3) may import it; `highlightProtocol.ts` holds types only.
 *  `null` means only "not an outcome this build knows". The answer is a fresh object. */
export function readHighlightOutcome(v: unknown): HighlightOutcome | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Readonly<Record<string, unknown>>;
  return typeof o.kind === 'string' && Object.hasOwn(OUTCOME_READERS, o.kind)
    ? OUTCOME_READERS[o.kind as HighlightOutcome['kind']](o)
    : null;
}

/** One reader per arm of `HighlightOutcome`, keyed by its `kind`: an arm added to the union and missing here is a
 *  compile error, so a new outcome is never read as unknown. */
const OUTCOME_READERS: {
  readonly [K in HighlightOutcome['kind']]: (o: Readonly<Record<string, unknown>>) => Extract<HighlightOutcome, { kind: K }> | null;
} = {
  html: (o) => (typeof o.html === 'string' && (o.mode === 'block' || o.mode === 'line') ? { kind: 'html', html: o.html, mode: o.mode } : null),
  'too-large': (o) => (typeof o.htmlChars === 'number' ? { kind: 'too-large', htmlChars: o.htmlChars } : null),
  'line-too-long': (o) => (typeof o.chars === 'number' ? { kind: 'line-too-long', chars: o.chars } : null),
  threw: (o) => (typeof o.error === 'string' ? { kind: 'threw', error: o.error } : null),
  timeout: (o) => (typeof o.budgetMs === 'number' ? { kind: 'timeout', budgetMs: o.budgetMs } : null),
  'worker-failed': (o) => (typeof o.error === 'string' ? { kind: 'worker-failed', error: o.error } : null),
  'worker-unavailable': () => ({ kind: 'worker-unavailable' }),
  unregistered: () => ({ kind: 'unregistered' }),
};

// ---- Keys and the seeding walk ----

/** A block's key, or why it can never be requested. */
export type BlockKey =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'unregistered' }
  | { readonly kind: 'over-cap'; readonly chars: number };

/** THE key function (section 4.10 "Keys"): no registered grammar, then over the block cap, else the key. */
export function blockKey(lang: string, raw: string): BlockKey {
  if (!isRegisteredGrammar(lang)) return { kind: 'unregistered' };
  if (raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) return { kind: 'over-cap', chars: raw.length };
  return { kind: 'key', key: `${lang}\u0000${raw}` };
}

/** One code block as `CodeBlock` reads it: its language and its text with one trailing newline stripped. `at`, when
 *  given, is the copy's identity: the `pre` element the block is drawn from (what `codeBlocksOf` sets), which is the
 *  `node` the block receives, so the page's ceilings can answer for this copy (`copySkip`). A caller that seeds
 *  repeats must pass `at`: a later copy with none counts against the ceilings but cannot be told it was skipped. */
export interface CodeBlockText {
  readonly lang: string;
  readonly raw: string;
  readonly at?: object;
}

/** Every text node under `node`, in document order (what `CodeBlock`'s `nodeText` flattens). Iterative. */
function textOf(node: HastElement): string {
  let out = '';
  const stack: RootContent[] = [...node.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === 'text') out += n.value;
    else if (n.type === 'element') for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return out;
}

/** The class of `pre`'s first `code` child as `CodeBlock` reads it: hast's array joined with a space; `''` for none. */
function preCodeClass(pre: HastElement): string {
  const code = pre.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'code');
  const cls = code?.properties.className;
  return Array.isArray(cls) ? cls.map((v) => String(v)).join(' ') : typeof cls === 'string' ? cls : '';
}

/** The seeding walk (section 4.10 "Seeding"): every `pre` of a parsed tree, in document order, iteratively, each with
 *  its own element as `at`. */
export function codeBlocksOf(tree: HastRoot): CodeBlockText[] {
  const out: CodeBlockText[] = [];
  const stack: RootContent[] = [...tree.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'pre') {
      out.push({ lang: codeLanguage(preCodeClass(n)), raw: textOf(n).replace(/\n$/, ''), at: n });
      continue;
    }
    for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return out;
}

// ---- Entries ----

/** Why a block is plain after a request (Export's provenance reads the first). */
export type PlainCause =
  | { readonly kind: 'timeout'; readonly budgetMs: number }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'line-too-long' }
  | { readonly kind: 'unregistered' }
  | { readonly kind: 'threw'; readonly error: string }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'worker-failed'; readonly error: string }
  | { readonly kind: 'worker-unavailable' };

/** What became of a line retry: its own failure, or `refused` (a ceiling closed before or while it ran). */
export type RetryOutcome = PlainCause | { readonly kind: 'refused' };

/** Which of the four page ceilings skipped a block. */
export type SkipCeiling = 'page-input' | 'page-output' | 'page-timeouts' | 'page-worker-time';

/** One key's state. `unrequested` and `pending` are two words with two meanings, never folded. */
export type HighlightEntry =
  | { readonly kind: 'unrequested' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'html'; readonly mode: 'block' | 'line'; readonly checked: CheckedHighlightHtml }
  | { readonly kind: 'plain'; readonly first: PlainCause; readonly retry: RetryOutcome | null }
  | { readonly kind: 'skipped'; readonly ceiling: SkipCeiling };

/** The one entry `peek` answers for a key the store has not seen. */
export const UNREQUESTED_ENTRY: HighlightEntry = Object.freeze({ kind: 'unrequested' } as const);
const PENDING: HighlightEntry = Object.freeze({ kind: 'pending' } as const);
const REFUSED: RetryOutcome = Object.freeze({ kind: 'refused' } as const);
/** The copies of a key the store never seeded: one. */
const ONE_COPY: readonly object[] = Object.freeze([Object.freeze({})]);

/** A failure outcome as the entry records it. */
function causeOf(o: Exclude<HighlightOutcome, { kind: 'html' }>): PlainCause {
  switch (o.kind) {
    case 'timeout': return { kind: 'timeout', budgetMs: o.budgetMs };
    case 'too-large': return { kind: 'too-large' };
    case 'line-too-long': return { kind: 'line-too-long' };
    case 'unregistered': return { kind: 'unregistered' };
    case 'threw': return { kind: 'threw', error: o.error };
    case 'worker-failed': return { kind: 'worker-failed', error: o.error };
    case 'worker-unavailable': return { kind: 'worker-unavailable' };
  }
}

// ---- The store ----

/** The store's clock: `highlighterContext.ts` hands in the real one, a test a fake. */
export interface HighlightClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** `mode` is the store's owner kind. The other two exist for R19's page (the W5h-a plan's refinement (k)): production
 *  passes `{ mode }` alone, so the ceilings are on and the debounce is chat's constant (Docs: none). */
export interface HighlightStoreOptions {
  readonly mode: 'docs' | 'chat';
  readonly ceilings?: boolean;
  readonly debounceMs?: number;
}

export interface HighlightStore {
  readonly mode: 'docs' | 'chat';
  /** How long a mounted block whose text changed waits before it requests its new key (chat only). */
  readonly debounceMs: number;
  keyOf(lang: string, raw: string): BlockKey;
  seed(blocks: readonly CodeBlockText[]): void;
  peek(key: string): HighlightEntry;
  /** The page ceiling that skipped this drawn copy of a block (the `pre` element a block was seeded with, `at`), or
   *  `null` when the copy draws its key's entry. Synchronous; never requests. A chat store always answers `null`. */
  copySkip(at: object): SkipCeiling | null;
  request(key: string): () => void;
  /** A mounted block shows `key` (from its first commit, before any debounced request); the release ends that. A
   *  chat store's `settled()` reads shown keys as well as requested ones (refinement (r)). */
  show(key: string): () => void;
  subscribe(key?: string): (listener: () => void) => () => void;
  settled(): boolean;
  evictUnreferenced(): void;
  /** How many rows the store keeps per map, entries, cached `subscribe(key)` functions and listener Sets. The test
   *  seam for M4.C5's retention (review 1364 F2): no production caller reads it. */
  heldKeys(): { readonly entries: number; readonly subscribers: number; readonly listeners: number };
  releaseAll(): void;
}

export function createHighlightStore(
  highlighter: Highlighter, options: HighlightStoreOptions, clock: HighlightClock,
): HighlightStore {
  const docs = options.mode === 'docs';
  const ceilingsOn = options.ceilings ?? true;
  const debounceMs = options.debounceMs ?? (docs ? 0 : HIGHLIGHT_STREAM_DEBOUNCE_MS);

  interface Job {
    readonly key: string;
    /** The first attempt's failure, for a retry; null for a first attempt. */
    readonly first: PlainCause | null;
    readonly controller: AbortController;
  }

  const entries = new Map<string, HighlightEntry>();
  const refs = new Map<string, number>();
  const shownKeys = new Map<string, number>();
  const seeded = new Set<string>();
  /** Per seeded key, its admitted copies in document order (a block with no `at` is a placeholder), for the output count. */
  const admitted = new Map<string, object[]>();
  /** The page ceiling that skipped a drawn copy, by the copy's `at`. */
  const copySkips = new WeakMap<object, SkipCeiling>();
  const jobs = new Map<string, Job>();
  const listeners = new Map<string, Set<() => void>>();
  const subscribers = new Map<string, (listener: () => void) => () => void>();
  const everyone = new Set<() => void>();
  let storeWide: ((listener: () => void) => () => void) | undefined;
  let outputChars = 0;
  let timeouts = 0;
  let spent = 0;
  let closed: SkipCeiling | null = null;
  let posted: { readonly job: Job; readonly at: number; readonly timer: unknown } | null = null;

  const peek = (key: string): HighlightEntry => entries.get(key) ?? UNREQUESTED_ENTRY;
  const copySkip = (at: object): SkipCeiling | null => copySkips.get(at) ?? null;

  function set(key: string, entry: HighlightEntry): void {
    entries.set(key, entry);
    for (const l of [...(listeners.get(key) ?? [])]) l();
    for (const l of [...everyone]) l();
  }

  /** Stops `job`'s worker-time clock, when it is the posted job, adding what it ran. */
  function stopClock(job: Job): void {
    if (posted === null || posted.job !== job) return;
    spent += clock.now() - posted.at;
    clock.clearTimer(posted.timer);
    posted = null;
  }

  /** `job` was posted: its worker time starts, and the worker-time ceiling's timer runs for what is left. */
  function onPosted(job: Job): void {
    if (jobs.get(job.key) !== job) return;
    // The runner posts the next job in the tick it ends the last one, before that job's answer reaches `answered`:
    // the job still in `posted` has ended at this instant, so its time is counted and its timer stopped here.
    if (posted !== null) stopClock(posted.job);
    const timer = ceilingsOn
      ? clock.setTimer(() => {
        if (posted?.job !== job) return;
        spent = HIGHLIGHT_PAGE_WORKER_MS;
        posted = null;
        close('page-worker-time');
      }, Math.max(0, HIGHLIGHT_PAGE_WORKER_MS - spent))
      : undefined;
    posted = { job, at: clock.now(), timer };
  }

  /** Detaches `job`: its answer will reach nobody; the worker lives on. */
  function detach(job: Job): void {
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    stopClock(job);
    job.controller.abort();
  }

  /** Latches the first live ceiling: every key not yet answered, and every later request, is skipped by it; a running
   *  retry becomes plain under its first failure. */
  function close(ceiling: SkipCeiling): void {
    if (closed !== null) return;
    closed = ceiling;
    for (const job of [...jobs.values()]) {
      detach(job);
      set(job.key, job.first === null ? { kind: 'skipped', ceiling } : { kind: 'plain', first: job.first, retry: REFUSED });
    }
    for (const key of [...seeded, ...refs.keys()]) if (peek(key).kind === 'unrequested') set(key, { kind: 'skipped', ceiling });
  }

  function checkCeilings(): void {
    if (!ceilingsOn) return;
    if (timeouts >= HIGHLIGHT_PAGE_MAX_TIMEOUTS) close('page-timeouts');
    else if (spent >= HIGHLIGHT_PAGE_WORKER_MS) close('page-worker-time');
  }

  function start(key: string, mode: 'block' | 'line', first: PlainCause | null): void {
    if (ceilingsOn && closed !== null) {
      set(key, first === null ? { kind: 'skipped', ceiling: closed } : { kind: 'plain', first, retry: REFUSED });
      return;
    }
    const status = highlighter.status();
    if (status !== 'live') {
      const cause: PlainCause = status === 'worker-unavailable' ? { kind: 'worker-unavailable' } : { kind: 'worker-failed', error: 'boot' };
      set(key, first === null ? { kind: 'plain', first: cause, retry: null } : { kind: 'plain', first, retry: cause });
      return;
    }
    const sep = key.indexOf('\u0000');
    const lang = key.slice(0, sep);
    const code = key.slice(sep + 1);
    const job: Job = { key, first, controller: new AbortController() };
    jobs.set(key, job);
    if (first === null) set(key, PENDING);
    highlighter.highlight(
      mode === 'line' ? { lang, code, mode } : { lang, code },
      { signal: job.controller.signal, onPosted: () => onPosted(job) },
    ).then((o) => answered(job, o), () => undefined);
  }

  /** `reply` is what the highlighter answered, read through the check before anything else: it leaves `jobs` and stops
   *  its clock first, so nothing below may throw on a value this build does not know. */
  function answered(job: Job, reply: unknown): void {
    if (jobs.get(job.key) !== job) return;
    jobs.delete(job.key);
    stopClock(job);
    const key = job.key;
    const o = readHighlightOutcome(reply);
    if (o?.kind === 'timeout') timeouts += 1;
    let failure: PlainCause;
    if (o === null) {
      failure = { kind: 'malformed' };
    } else if (o.kind !== 'html') {
      failure = causeOf(o);
    } else if (o.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) {
      failure = { kind: 'too-large' };
    } else {
      const checked = checkHighlightHtml(o.html);
      if (checked === null) {
        failure = { kind: 'malformed' };
      } else {
        // Every admitted copy of the key inserts this HTML again, so each adds its length (a key never seeded is one copy).
        const copies = admitted.get(key) ?? ONE_COPY;
        const capped = docs && ceilingsOn;
        let fitted = 0;
        while (fitted < copies.length && (!capped || outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS)) {
          outputChars += o.html.length;
          fitted += 1;
        }
        if (fitted === copies.length) {
          checkCeilings();
          set(key, { kind: 'html', mode: o.mode, checked });
          return;
        }
        // The copies from `fitted` on pass the page HTML ceiling: skipped copies, their verdicts recorded before the
        // entry is set (the key's listeners re-render every copy). The first copy passing leaves the entry skipped.
        if (fitted > 0) for (let i = fitted; i < copies.length; i += 1) copySkips.set(copies[i]!, 'page-output');
        close('page-output');
        if (fitted > 0) set(key, { kind: 'html', mode: o.mode, checked });
        else set(key, job.first === null ? { kind: 'skipped', ceiling: 'page-output' } : { kind: 'plain', first: job.first, retry: REFUSED });
        return;
      }
    }
    checkCeilings();
    const rawLength = key.length - key.indexOf('\u0000') - 1;
    if (job.first === null && (failure.kind === 'timeout' || failure.kind === 'too-large') && rawLength > HIGHLIGHT_LINE_RETRY_UNITS) {
      start(key, 'line', failure);
      return;
    }
    set(key, job.first === null ? { kind: 'plain', first: failure, retry: null } : { kind: 'plain', first: job.first, retry: failure });
  }

  function seed(blocks: readonly CodeBlockText[]): void {
    let input = 0;
    for (const b of blocks) {
      const k = blockKey(b.lang, b.raw);
      if (k.kind !== 'key') continue;
      // Every occurrence counts: each drawn copy inserts the key's text and HTML again (review 1364 F1).
      input += b.raw.length;
      const past: SkipCeiling | null = ceilingsOn && input > DOCS_HIGHLIGHT_PAGE_MAX_CHARS ? 'page-input' : null;
      if (!seeded.has(k.key)) {
        seeded.add(k.key);
        if (past !== null) entries.set(k.key, { kind: 'skipped', ceiling: past });
        else admitted.set(k.key, [b.at ?? {}]);
        continue;
      }
      // A later occurrence. A key whose first occurrence was skipped is skipped for every copy.
      const copies = admitted.get(k.key);
      if (copies === undefined) continue;
      if (past === null) copies.push(b.at ?? {});
      else if (b.at !== undefined) copySkips.set(b.at, past);
    }
  }

  function request(key: string): () => void {
    refs.set(key, (refs.get(key) ?? 0) + 1);
    if (peek(key).kind === 'unrequested') start(key, 'block', null);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (refs.get(key) ?? 1) - 1;
      if (n > 0) {
        refs.set(key, n);
        return;
      }
      refs.delete(key);
      const job = jobs.get(key);
      if (job !== undefined) {
        detach(job);
        set(key, UNREQUESTED_ENTRY);
      }
    };
  }

  function show(key: string): () => void {
    shownKeys.set(key, (shownKeys.get(key) ?? 0) + 1);
    let hidden = false;
    return () => {
      if (hidden) return;
      hidden = true;
      const left = (shownKeys.get(key) ?? 1) - 1;
      if (left > 0) shownKeys.set(key, left);
      else shownKeys.delete(key);
    };
  }

  function subscribe(key?: string): (listener: () => void) => () => void {
    if (key === undefined) {
      storeWide ??= (l) => {
        everyone.add(l);
        return () => { everyone.delete(l); };
      };
      return storeWide;
    }
    let fn = subscribers.get(key);
    if (fn === undefined) {
      fn = (l) => {
        let held = listeners.get(key);
        if (held === undefined) {
          held = new Set();
          listeners.set(key, held);
        }
        held.add(l);
        return () => {
          // The key's Set goes with its last listener, so a key nobody listens to keeps no row (review 1364 F2).
          const now = listeners.get(key);
          if (now === undefined) return;
          now.delete(l);
          if (now.size === 0) listeners.delete(key);
        };
      };
      subscribers.set(key, fn);
    }
    return fn;
  }

  function settled(): boolean {
    if (docs) {
      for (const key of seeded) {
        const kind = peek(key).kind;
        if (kind === 'unrequested' || kind === 'pending') return false;
      }
      return true;
    }
    for (const key of new Set([...refs.keys(), ...shownKeys.keys()])) {
      const kind = peek(key).kind;
      if (kind === 'unrequested' || kind === 'pending') return false;
    }
    return true;
  }

  function evictUnreferenced(): void {
    const referenced = (key: string): boolean => refs.has(key) || seeded.has(key) || shownKeys.has(key);
    for (const key of [...entries.keys()]) if (!referenced(key)) entries.delete(key);
    // A key whose blocks only ever showed it, or never requested it, has no entry, but `subscribe(key)` cached a function
    // for it and a listener made a Set: both go by their own key sets (review 1364 F2). A Set that still holds a live
    // listener stays with its function. In the hooks' order none is live here: this runs in the message's effect after
    // every child's effects, and a child's `useSyncExternalStore` unsubscribes in its cleanup, which React runs for the
    // whole tree before any effect of the new commit.
    for (const key of new Set([...subscribers.keys(), ...listeners.keys()])) {
      if (referenced(key) || (listeners.get(key)?.size ?? 0) > 0) continue;
      listeners.delete(key);
      subscribers.delete(key);
    }
  }

  function heldKeys(): { readonly entries: number; readonly subscribers: number; readonly listeners: number } {
    return { entries: entries.size, subscribers: subscribers.size, listeners: listeners.size };
  }

  function releaseAll(): void {
    refs.clear();
    for (const job of [...jobs.values()]) {
      detach(job);
      set(job.key, UNREQUESTED_ENTRY);
    }
  }

  return {
    mode: options.mode, debounceMs, keyOf: (lang, raw) => blockKey(lang, raw), seed, peek, copySkip, request, show,
    subscribe, settled, evictUnreferenced, heldKeys, releaseAll,
  };
}
