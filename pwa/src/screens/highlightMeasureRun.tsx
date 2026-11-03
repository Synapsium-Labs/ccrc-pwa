// R19's measurements (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19; the W5h-a plan's
// refinements (i) and (k)). `runHighlightMeasure` runs the eight items on the shipped highlight worker chunk, each
// through highlighters of its own (`deps.highlighter`, which the page builds with `createHighlighter`, so every worker
// is spawned by `spawnHighlightWorker`: never a second `new Worker` literal), and answers one `MeasureResult`, which
// `formatMeasureResult` turns into the page's text. It reads documents only through the docs loaders' `projects`,
// `tree` and `file` (never `refresh`), at the Docs screen's fetch concurrency; it stores and sends nothing and writes
// no clipboard (M7.12). The result names no project, path, file or code: a block is its grammar, its length, an
// ordinal. Items, as section 7.8 numbers them:
//   1. every block of the corpus, one per job, on a warm highlighter (MEASURE_DEADLINE_MS, no ceilings, none of part
//      1's bounds): time by grammar; then each grammar's largest block first on a fresh highlighter (cold);
//   2. boot: a fresh highlighter's first call (which spawns) to its post (after `{ready}`): the page's first, cold;
//      the cold-block highlighters of item 1, after a respawn;
//   3. HTML characters per input character, by grammar, on the corpus (item 1's figures) and, on a highlighter of the
//      measurement-only deadline of its own, the crafted shapes; an answer over the HTML cap gives its `htmlChars`;
//   4. checking and inserting DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS of real answers through the one sink, and layout;
//   5. the largest real page within the render gate, through `DocMarkdown`: plain first frame to last block coloured;
//   6. part 1's crafted shapes under the SHIPPED deadline: outcome, time, the longest main-thread frame gap;
//   7. eight crafted blocks under the SHIPPED ceilings, none of part 1's bounds: the wait to settled, against section
//      4.10's sum for Export's longest wait;
//   8. a `ChatMarkdown` streamed at each of MEASURE_SETTLE_CADENCES_MS and, at each, for each candidate debounce:
//      the requests the growing block made and the time from its fence closing to its colours. No settle gaps: they
//      would be this page's own sleep (BASE has no fixed chat settle cadence; the W5h-a plan's refinement (q)).
//
// Ring L4: it renders, schedules and measures; the decisions are the store's and the runner's.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { contentClass, type DocPin, type DocsTreeOk } from '../../../shared/docs';
import type { DocLinkContextValue } from '../docs/DocLink';
import { DocMarkdown, docMarkdownSource } from '../docs/DocMarkdown';
import type { DocsLoaders } from '../docs/failures';
import { createFetchQueue } from '../docs/fetchQueue';
import { HIGHLIGHT_GRAMMARS, grammarOf, isRegisteredGrammar } from '../lib/highlightNames';
import type { Highlighter, HighlightOutcome } from '../lib/highlightProtocol';
import {
  checkHighlightHtml, codeBlocksOf, createHighlightStore, type CodeBlockText, type HighlightClock, type HighlightEntry, type HighlightStore,
} from '../lib/highlightStore';
import { HighlighterContext, type HighlighterContextValue } from '../lib/highlighterContext';
import { ChatMarkdown, HighlightedCode } from '../lib/markdown';
import { utf8ByteLength } from '../lib/markdownGuard';
import {
  DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_RENDER_GATE_BYTES, HIGHLIGHT_BLOCK_DEADLINE_MS,
  HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS, HIGHLIGHT_STREAM_DEBOUNCE_MS,
  MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
} from '../lib/markdownLimits';
import type { MarkdownParser } from '../lib/markdownRunner';

/** R19's measurement-only deadline: well above any candidate value, so a slow block is timed, not cut off. */
export const MEASURE_DEADLINE_MS = 60000;
/** Item 8's candidate debounces. */
export const MEASURE_CANDIDATE_DEBOUNCES: readonly number[] = [0, 150, 250, 400];
/** Item 8's settle cadences (refinement (q)): BASE has no fixed chat settle cadence, so item 8 runs at three, and
 *  W5h-b reads its debounce off the table across them. */
export const MEASURE_SETTLE_CADENCES_MS: readonly number[] = [50, 100, 250];

export interface MeasureDeps {
  readonly loaders: Pick<DocsLoaders, 'projects' | 'tree' | 'file'>;
  readonly parse: MarkdownParser;
  /** A fresh highlighter with this deadline (each call a new worker) and this boot budget (omitted: the shipped one). */
  readonly highlighter: (deadlineMs: number, bootBudgetMs?: number) => Highlighter;
  readonly now: () => number;
  /** The next animation frame's time. */
  readonly frame: () => Promise<number>;
  readonly sleep: (ms: number) => Promise<void>;
  /** Where items 4, 5 and 8 render: laid out, off screen. */
  readonly host: HTMLElement;
  readonly signal: AbortSignal;
  readonly hardwareConcurrency: number | null;
}

export interface GrammarFigures {
  readonly grammar: string;
  readonly blocks: number;
  readonly chars: number;
  readonly warmMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly cold: { readonly chars: number; readonly ms: number } | null;
  readonly htmlRatio: { readonly p95: number; readonly max: number };
  /** Blocks the worker did not answer as HTML (too large, threw, unregistered). */
  readonly notHtml: number;
  /** Of those, the blocks answered `too-large`: their `htmlChars` are in `htmlRatio`, so its max is not censored at the cap. */
  readonly overCap: number;
}

export interface MeasureResult {
  readonly r19: 1;
  readonly device: { readonly hardwareConcurrency: number | null };
  readonly shipped: Readonly<Record<string, number>>;
  readonly corpus: { readonly projects: number; readonly docs: number; readonly unreadDocs: number; readonly blocks: number };
  readonly item1: { readonly byGrammar: readonly GrammarFigures[]; readonly slowest: readonly { readonly grammar: string; readonly chars: number; readonly ms: number }[] };
  readonly item2: { readonly coldMs: number | null; readonly respawnMs: readonly number[] };
  readonly item3: { readonly crafted: readonly { readonly shape: string; readonly ratio: number | null; readonly overCap: boolean }[] };
  readonly item4: { readonly blocks: number; readonly htmlChars: number; readonly checkMs: number; readonly insertAndLayoutMs: number };
  readonly item5: { readonly blocks: number; readonly codeChars: number; readonly firstFrameToColouredMs: number | null };
  readonly item6: readonly { readonly shape: string; readonly grammar: string; readonly chars: number; readonly outcome: string; readonly ms: number; readonly longestFrameGapMs: number }[];
  readonly item7: { readonly waitMs: number | null; readonly sumMs: number; readonly withinSum: boolean | null; readonly entries: readonly string[] };
  readonly item8: { readonly byCadence: readonly { readonly settleMs: number; readonly byDebounce: readonly { readonly debounceMs: number; readonly requests: number; readonly closeToColouredMs: number | null }[] }[] };
}

/** `unit` repeated to `chars` characters, broken into lines of `line` characters (0: one line). */
function shape(unit: string, chars: number, line: number): string {
  const body = unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
  return line === 0 ? body : (body.match(new RegExp(`[^]{1,${line}}`, 'g')) ?? []).join('\n').slice(0, chars);
}
const BLOCK = 65000;
const LS = String.fromCharCode(0x2028);
/** W5 part 1's crafted shapes, from `markdownLimits.ts`'s notes, each in its grammar, under the block cap. */
export const CRAFTED_SHAPES: readonly { readonly name: string; readonly lang: string; readonly code: string }[] = [
  { name: 'markdown-link-openers', lang: 'markdown', code: shape('[](', BLOCK, 2048) },
  { name: 'yaml-flow', lang: 'yaml', code: shape('[]', BLOCK, 2048) },
  { name: 'ts-tags', lang: 'typescript', code: shape('<a>', BLOCK, 1800) },
  { name: 'rust-raw-string', lang: 'rust', code: shape('r#"', BLOCK, 1800) },
  { name: 'ts-newlines', lang: 'typescript', code: `a${'\n'.repeat(BLOCK - 2)}b` },
  { name: 'ts-line-separators', lang: 'typescript', code: shape(`${LS}\n`, BLOCK, 0) },
  { name: 'php-identifier', lang: 'php', code: shape('_é', BLOCK, 0) },
  { name: 'ts-identifier', lang: 'typescript', code: shape('a', 32768, 0) },
  { name: 'markdown-bracket-line', lang: 'markdown', code: shape('[', BLOCK, 0) },
  { name: 'yaml-words-line', lang: 'yaml', code: shape('a ', BLOCK, 0) },
  { name: 'xml-script-lines', lang: 'xml', code: shape('<script>\n', BLOCK, 0) },
];

const round = (n: number): number => Math.round(n * 10) / 10;
function pct(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
}
const clockOf = (deps: MeasureDeps): HighlightClock => ({
  now: deps.now, setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (h) => window.clearTimeout(h as number),
});

/** The HTML characters a worker's answer measured: an `html` answer's length, or a `too-large` answer's `htmlChars`
 *  (section 4.9 sets the HTML cap from the highest ratio R19 measures, so an answer over the cap still counts);
 *  `null` for every other answer. */
function htmlCharsOf(o: HighlightOutcome): number | null {
  return o.kind === 'html' ? o.html.length : o.kind === 'too-large' ? o.htmlChars : null;
}

/** One block posted; its outcome and its worker time, post to answer. */
async function timed(deps: MeasureDeps, h: Highlighter, lang: string, code: string): Promise<{ outcome: HighlightOutcome; ms: number; postedAt: number }> {
  let postedAt = Number.NaN;
  const outcome = await h.highlight({ lang, code }, { signal: deps.signal, onPosted: () => { postedAt = deps.now(); } });
  return { outcome, ms: round(deps.now() - postedAt), postedAt };
}

/** The time `test` first holds, checked once a frame, or `null` past `capMs`. */
async function until(deps: MeasureDeps, test: () => boolean, capMs: number): Promise<number | null> {
  const start = deps.now();
  while (deps.now() - start < capMs) {
    deps.signal.throwIfAborted();
    if (test()) return deps.now();
    await deps.frame();
  }
  return null;
}

/** The longest gap between animation frames while `during` runs. */
async function longestGap(deps: MeasureDeps, during: Promise<unknown>): Promise<number> {
  let done = false;
  void during.then(() => { done = true; }, () => { done = true; });
  let last = await deps.frame();
  let gap = 0;
  while (!done) {
    const t = await deps.frame();
    gap = Math.max(gap, t - last);
    last = t;
  }
  return round(gap);
}

interface Page { readonly text: string; readonly codeChars: number; readonly blocks: number; readonly link: Omit<DocLinkContextValue, 'urls'> }

/** Reads the corpus, one project at a time, its files through the fetch queue, and hands each parsed document's
 *  blocks to `onDoc`. */
async function readCorpus(
  deps: MeasureDeps, progress: (line: string) => void,
  onDoc: (blocks: readonly CodeBlockText[], text: string, link: Omit<DocLinkContextValue, 'urls'>) => Promise<void>,
): Promise<{ projects: number; docs: number; unreadDocs: number }> {
  const index = await deps.loaders.projects();
  if (index.s !== 'ok') throw new Error(`the docs index answered ${index.s}`);
  const ready = index.value.index.projects.filter((p) => p.state === 'ready');
  const queue = createFetchQueue();
  let docs = 0;
  let unreadDocs = 0;
  for (const p of ready) {
    deps.signal.throwIfAborted();
    const answer = await deps.loaders.tree(p.project, null);
    if (answer.s !== 'ok') continue;
    const tree: DocsTreeOk = answer.value.tree;
    const pins = tree.entries
      .filter((e) => contentClass(e.path) === 'markdown' && (e.committed?.kind === 'file' || e.committed?.kind === 'exec'))
      .map((e): DocPin => ({ kind: 'committed', commit: tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path }));
    const texts = await Promise.all(pins.map((pin) => queue.run(async (signal) => {
      const f = await deps.loaders.file(p.project, pin, signal);
      if (f.s !== 'ok') return null;
      const src = docMarkdownSource(f.value.show);
      return src.kind === 'markdown' ? { pin, text: src.text } : null;
    }, deps.signal)));
    for (const t of texts) {
      if (t === null) { unreadDocs += 1; continue; }
      const parsed = await deps.parse(t.text, { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS, signal: deps.signal });
      if (parsed.kind !== 'tree') { unreadDocs += 1; continue; }
      docs += 1;
      await onDoc(codeBlocksOf(parsed.tree), t.text, {
        project: p.project, pageRef: null, view: 'effective', section: t.pin.section, path: t.pin.path, tree,
        pageSource: 'committed', onFragment: () => undefined,
      });
      progress(`Item 1: ${docs} documents read`);
    }
  }
  return { projects: ready.length, docs, unreadDocs };
}

const PLAIN: HighlightEntry = { kind: 'plain', first: { kind: 'malformed' }, retry: null };

export async function runHighlightMeasure(deps: MeasureDeps, progress: (line: string) => void): Promise<MeasureResult> {
  deps.signal.throwIfAborted();
  // Items 1 to 5 and 8 time a boot and a block rather than cut either off (a boot past the shipped budget is timed, so
  // item 2 can measure a slow one); items 6 and 7 keep the shipped deadline and the shipped boot budget.
  const measureHighlighter = (): Highlighter => deps.highlighter(MEASURE_DEADLINE_MS, MEASURE_DEADLINE_MS);
  // Items 1-3: the corpus, warm, after one tiny job per grammar (the first of which boots: item 2, cold).
  const warm = measureHighlighter();
  const created = deps.now();
  let coldMs: number | null = null;
  for (const g of HIGHLIGHT_GRAMMARS) {
    const r = await timed(deps, warm, g, 'x');
    // A highlighter that cannot answer (no worker here, a boot that failed) would leave every figure after this one
    // meaningless, so the run ends here, naming the answer's kind (a fixed word, nothing private).
    if (r.outcome.kind !== 'html') throw new Error(`The highlight worker did not answer (${r.outcome.kind}).`);
    if (coldMs === null) coldMs = round(r.postedAt - created);
  }
  const stats = new Map<string, { ms: number[]; ratios: number[]; chars: number; notHtml: number; overCap: number; largest: string }>();
  const slowest: { grammar: string; chars: number; ms: number }[] = [];
  const kept: { raw: string; html: string }[] = [];
  let keptChars = 0;
  let blocks = 0;
  let page: Page | null = null;
  const corpus = await readCorpus(deps, progress, async (docBlocks, text, link) => {
    let codeChars = 0;
    let docCount = 0;
    for (const b of docBlocks) {
      const grammar = grammarOf(b.lang);
      if (grammar === null || !isRegisteredGrammar(b.lang) || b.raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) continue;
      blocks += 1;
      docCount += 1;
      codeChars += b.raw.length;
      const s = stats.get(grammar) ?? { ms: [], ratios: [], chars: 0, notHtml: 0, overCap: 0, largest: '' };
      stats.set(grammar, s);
      const r = await timed(deps, warm, b.lang, b.raw);
      s.ms.push(r.ms);
      s.chars += b.raw.length;
      if (b.raw.length > s.largest.length) s.largest = b.raw;
      const htmlChars = htmlCharsOf(r.outcome);
      if (htmlChars !== null && b.raw.length > 0) s.ratios.push(htmlChars / b.raw.length);
      if (r.outcome.kind === 'html') {
        if (keptChars + r.outcome.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS) {
          kept.push({ raw: b.raw, html: r.outcome.html });
          keptChars += r.outcome.html.length;
        }
      } else {
        s.notHtml += 1;
        if (r.outcome.kind === 'too-large') s.overCap += 1;
      }
      slowest.push({ grammar, chars: b.raw.length, ms: r.ms });
      slowest.sort((x, y) => y.ms - x.ms);
      slowest.length = Math.min(slowest.length, 20);
    }
    if (utf8ByteLength(text) <= DOCS_RENDER_GATE_BYTES && (page === null || codeChars > page.codeChars)) {
      page = { text, codeChars, blocks: docCount, link };
    }
  });
  // Item 1, cold; item 2, boots after a respawn.
  const cold = new Map<string, { chars: number; ms: number }>();
  const respawnMs: number[] = [];
  for (const [grammar, s] of stats) {
    progress(`Item 1: ${grammar}, cold`);
    const fresh = measureHighlighter();
    const at = deps.now();
    const r = await timed(deps, fresh, grammar, s.largest);
    respawnMs.push(round(r.postedAt - at));
    cold.set(grammar, { chars: s.largest.length, ms: r.ms });
  }
  const byGrammar: GrammarFigures[] = [...stats].map(([grammar, s]) => ({
    grammar, blocks: s.ms.length, chars: s.chars,
    warmMs: { p50: pct(s.ms, 0.5), p95: pct(s.ms, 0.95), max: pct(s.ms, 1) },
    cold: cold.get(grammar) ?? null,
    htmlRatio: { p95: pct(s.ratios, 0.95), max: pct(s.ratios, 1) },
    notHtml: s.notHtml,
    overCap: s.overCap,
  }));
  // Item 4: check, insert and lay out a page's worth of real answers through the one sink.
  progress('Item 4');
  const t0 = deps.now();
  const checked = kept.map((k) => ({ raw: k.raw, checked: k.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS ? null : checkHighlightHtml(k.html) }));
  const t1 = deps.now();
  const root4 = createRoot(deps.host);
  let t2: number;
  try {
    flushSync(() => root4.render(
      <>{checked.map((c, i) => <pre key={i}><HighlightedCode entry={c.checked === null ? PLAIN : { kind: 'html', mode: 'block', checked: c.checked }} raw={c.raw} /></pre>)}</>,
    ));
    void deps.host.offsetHeight;
    t2 = deps.now();
  } finally {
    root4.unmount();
  }
  // Item 5: the largest real page through DocMarkdown, no ceilings, no part-1 bounds.
  progress('Item 5');
  let firstFrameToColouredMs: number | null = null;
  const largest = page as Page | null;
  if (largest !== null) {
    const h5 = measureHighlighter();
    let published: HighlightStore | null = null;
    const ctx: HighlighterContextValue = {
      docs: h5, chat: h5, publish: (s) => { published = s; },
      createStore: (h, mode) => createHighlightStore(h, { mode, part1: false, ceilings: false }, clockOf(deps)),
    };
    const root5 = createRoot(deps.host);
    try {
      root5.render(<HighlighterContext value={ctx}><DocMarkdown text={largest.text} pinKey="r19" parser={deps.parse} link={largest.link} /></HighlighterContext>);
      const first = await until(deps, () => deps.host.querySelector('article') !== null, MEASURE_DEADLINE_MS);
      // A page that never rendered (its parse past the normal budget shows the plain text, with no store) is not waited on again.
      const coloured = first === null ? null : await until(deps, () => (published as HighlightStore | null)?.settled() === true, MEASURE_DEADLINE_MS * 4);
      firstFrameToColouredMs = first === null || coloured === null ? null : round(coloured - first);
    } finally {
      root5.unmount();
    }
  }
  // Item 3, the crafted shapes: section 7.8 runs items 1 to 5 on the measurement-only deadline, so a shape past the
  // shipped deadline is timed and its ratio read, not cut off (item 6, next, is the shipped deadline's).
  const crafted: { shape: string; ratio: number | null; overCap: boolean }[] = [];
  const measured = measureHighlighter();
  for (const s of CRAFTED_SHAPES) {
    progress(`Item 3: ${s.name}`);
    const r = await timed(deps, measured, s.lang, s.code);
    const chars = htmlCharsOf(r.outcome);
    crafted.push({ shape: s.name, ratio: chars === null ? null : round(chars / s.code.length), overCap: r.outcome.kind === 'too-large' });
  }
  // Item 6: the same shapes under the SHIPPED deadline.
  const item6: MeasureResult['item6'][number][] = [];
  const shipped = deps.highlighter(HIGHLIGHT_BLOCK_DEADLINE_MS);
  for (const s of CRAFTED_SHAPES) {
    progress(`Item 6: ${s.name}`);
    const job = timed(deps, shipped, s.lang, s.code);
    const gap = await longestGap(deps, job);
    const r = await job;
    item6.push({ shape: s.name, grammar: s.lang, chars: s.code.length, outcome: r.outcome.kind, ms: r.ms, longestFrameGapMs: gap });
  }
  // Item 7: eight crafted blocks under the shipped ceilings, none of part 1's bounds.
  progress('Item 7');
  const sumMs = HIGHLIGHT_PAGE_WORKER_MS + HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) * HIGHLIGHT_BOOT_BUDGET_MS;
  const store7 = createHighlightStore(deps.highlighter(HIGHLIGHT_BLOCK_DEADLINE_MS), { mode: 'docs', part1: false }, clockOf(deps));
  const blocks7 = CRAFTED_SHAPES.slice(0, 8).map((s, i) => ({ lang: s.lang, raw: `${s.code.slice(0, BLOCK - 4)}\n${i}` }));
  store7.seed(blocks7);
  const keys7 = blocks7.map((b) => store7.keyOf(b.lang, b.raw)).flatMap((k) => (k.kind === 'key' ? [k.key] : []));
  const start7 = deps.now();
  const releases = keys7.map((k) => store7.request(k));
  let settled7: number | null;
  let entries7: string[];
  try {
    settled7 = await until(deps, () => store7.settled(), 2 * sumMs);
    entries7 = keys7.map((k) => store7.peek(k).kind);
  } finally {
    releases.forEach((release) => release());
  }
  const waitMs = settled7 === null ? null : round(settled7 - start7);
  // Item 8: a streamed chat message, at each settle cadence and, at each, for each candidate debounce.
  const LINES = Array.from({ length: 40 }, (_, i) => `const value${i} = compute(${i}, "x${i}");`);
  const full = LINES.join('\n');
  const byCadence: MeasureResult['item8']['byCadence'][number][] = [];
  for (const settleMs of MEASURE_SETTLE_CADENCES_MS) {
    const byDebounce: MeasureResult['item8']['byCadence'][number]['byDebounce'][number][] = [];
    for (const d of MEASURE_CANDIDATE_DEBOUNCES) {
      progress(`Item 8: every ${settleMs} ms, debounce ${d} ms`);
      const inner = measureHighlighter();
      let requests = 0;
      const counting: Highlighter = {
        highlight: (r, o) => { if (r.code.startsWith(LINES[0]!)) requests += 1; return inner.highlight(r, o); },
        status: () => inner.status(), prewarm: () => inner.prewarm(),
      };
      const ctx: HighlighterContextValue = {
        docs: counting, chat: counting,
        createStore: (h, mode) => createHighlightStore(h, { mode, part1: false, ceilings: false, debounceMs: d }, clockOf(deps)),
      };
      const root8 = createRoot(deps.host);
      const show = (text: string): void => {
        flushSync(() => root8.render(<HighlighterContext value={ctx}><ChatMarkdown text={text} /></HighlighterContext>));
      };
      let closedAt: number;
      let colouredAt: number | null;
      try {
        for (let n = 1; n <= LINES.length; n += 1) {
          deps.signal.throwIfAborted();
          show(`Working on it.\n\n\`\`\`ts\n${LINES.slice(0, n).join('\n')}`);
          await deps.sleep(settleMs);
        }
        show(`Working on it.\n\n\`\`\`ts\n${full}\n\`\`\`\n\nDone.`);
        closedAt = deps.now();
        colouredAt = await until(deps, () => {
          const code = deps.host.querySelector('code.hljs');
          return code !== null && code.textContent === full && code.querySelector('[class^="hljs-"]') !== null;
        }, 10 * HIGHLIGHT_STREAM_DEBOUNCE_MS + MEASURE_DEADLINE_MS);
      } finally {
        root8.unmount();
      }
      byDebounce.push({ debounceMs: d, requests, closeToColouredMs: colouredAt === null ? null : round(colouredAt - closedAt) });
    }
    byCadence.push({ settleMs, byDebounce });
  }
  progress('Done');
  return {
    r19: 1,
    device: { hardwareConcurrency: deps.hardwareConcurrency },
    shipped: {
      HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_WORKER_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS,
      MD_HIGHLIGHT_MAX_HTML_CHARS, DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, HIGHLIGHT_STREAM_DEBOUNCE_MS,
    },
    corpus: { ...corpus, blocks },
    item1: { byGrammar, slowest: slowest.map((s) => ({ ...s })) },
    item2: { coldMs, respawnMs },
    item3: { crafted },
    item4: { blocks: checked.length, htmlChars: keptChars, checkMs: round(t1 - t0), insertAndLayoutMs: round(t2 - t1) },
    item5: { blocks: largest?.blocks ?? 0, codeChars: largest?.codeChars ?? 0, firstFrameToColouredMs },
    item6,
    item7: { waitMs, sumMs, withinSum: waitMs === null ? null : waitMs <= sumMs, entries: entries7 },
    item8: { byCadence },
  };
}

/** The page's text: the result as indented JSON, which a tap selects whole. */
export function formatMeasureResult(r: MeasureResult): string {
  return JSON.stringify(r, null, 2);
}

/** What the page shows while it measures and after (kept here, beside the run, for the page to import). */
export const MEASURE_TEXT = {
  title: 'Measure highlighting',
  intro: 'Times this device\'s highlight worker on the Docs you can read, once, for the next release\'s values. Keep the screen on and the app in front until it says Done; then select the result and copy it, or take a screenshot, and send it on. It saves and sends nothing itself.',
  start: 'Start',
  stop: 'Stop',
  starting: 'Starting…',
  stopping: 'Stopping…',
  done: 'Done.',
  result: 'Result',
  select: 'Select result',
} as const;
