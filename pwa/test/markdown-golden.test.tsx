// M4.M1 (native Docs reader, W4 Task 1; design 2026-10-01 section 4.9 and section 4.15, the W4 plan's
// refinement (e)): chat's Markdown output, held to stored files generated against the UNCHANGED `MessageBubble`
// before anything moves. Task 2 extracts `lib/markdown.tsx` and Tasks 3-8 harden chat; none of them may move a
// golden file. A changed byte reds the case that names it.
//
// Mechanism: vitest's `toMatchFileSnapshot`, one file per case under `test/golden/markdown/`. A missing file is
// written only outside CI, so CI cannot pass vacuously; never run this file with `-u`. This file imports nothing
// W4 creates: only `MessageBubble`, the corpus, React's server renderer, RTL and highlight.js's core (the same
// instance `MessageBubble` registers its grammars on).
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import hljs from 'highlight.js/lib/core';
import { MessageBubble } from '../src/session/MessageBubble';
import {
  CHAT_ALIAS_TAGS, CHAT_CORPUS, CHAT_UNREGISTERED_TAGS, RECAP_CASE, languageCases, type CorpusCase,
} from './markdownCorpus';

afterEach(cleanup);

const GOLDEN_DIR = path.join(import.meta.dirname, 'golden', 'markdown');
const TS = '2026-10-09T00:00:00Z';

/** The grammars `MessageBubble` registers, MEASURED (importing it registers them as a side effect). */
const REGISTERED: readonly string[] = [...hljs.listLanguages()].sort();
const TAGS: readonly string[] = [...new Set([...REGISTERED, ...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS])];
const CASES: readonly CorpusCase[] = [...CHAT_CORPUS, ...languageCases(TAGS)];
const ALL: readonly CorpusCase[] = [...CASES, RECAP_CASE];

const html = (c: CorpusCase): string =>
  renderToStaticMarkup(
    <MessageBubble id="s" event={{ kind: 'assistant', uuid: `g-${c.name}`, ts: TS, text: c.text }} streaming={c.streaming} />,
  );

/** The recap's Markdown body renders only once the card is opened, so it goes through the DOM and a click. */
function openedRecap(): string {
  const { container } = render(
    <MessageBubble id="s" event={{ kind: 'assistant', uuid: 'g-recap', ts: TS, text: RECAP_CASE.text }} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Context compacted/ }));
  expect(container.querySelector('.compaction-body.msg-assist')).not.toBeNull();
  return container.innerHTML;
}

describe('M4.M1: chat Markdown output is held to its golden files', () => {
  it.each(CASES)('$name', async (c) => {
    await expect(html(c)).toMatchFileSnapshot(`./golden/markdown/${c.name}.html`);
  });

  it('recap-opened: the compaction card opened, its Markdown body rendered', async () => {
    await expect(openedRecap()).toMatchFileSnapshot(`./golden/markdown/${RECAP_CASE.name}.html`);
  });
});

describe('the golden is not vacuous', () => {
  it('measures a non-empty grammar list, every listed alias resolves and no unregistered tag does', () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
    for (const tag of [...REGISTERED, ...CHAT_ALIAS_TAGS]) expect(hljs.getLanguage(tag), tag).toBeDefined();
    for (const tag of CHAT_UNREGISTERED_TAGS) expect(hljs.getLanguage(tag), tag).toBeUndefined();
  });

  it('every case name is a unique file-safe slug', () => {
    const names = ALL.map((c) => c.name);
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(names).size).toBe(names.length);
  });

  // A dropped grammar or alias removes its case; the stored file it leaves behind is what reds here.
  it('every stored golden file belongs to a case', () => {
    const names = new Set(ALL.map((c) => c.name));
    // vitest writes new file snapshots when the file ends, so on the one run that generates them the directory is
    // not there yet; under CI every case above has already failed for its missing file.
    const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR) : [];
    const stored = files.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -'.html'.length));
    expect(stored.filter((n) => !names.has(n))).toEqual([]);
  });

  it('two renders of the corpus are byte-identical', () => {
    expect(CASES.map(html)).toEqual(CASES.map(html));
  });
});

/** `s` without its leading ASCII whitespace and C0 controls (every code unit up to U+0020), as a browser trims an
 *  attribute URL before parsing it. */
function trimC0(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 0x20) i += 1;
  return s.slice(i);
}

// The two bounds that keep every golden file still through the wave (markdownCorpus.ts's header).
describe('every case stays inside the bounds the later tasks rely on', () => {
  // 4096 is CHAT_SYNC_MAX_BYTES (Task 3's markdownLimits.ts); spelled here because this file imports nothing W4
  // creates. A case over it would take Task 6's worker path and could legitimately move.
  it.each(ALL)('$name is at most 4096 UTF-8 bytes', (c) => {
    expect(new TextEncoder().encode(c.text).length).toBeLessThanOrEqual(4096);
  });

  // Read from the rendered DOM, not from the Markdown text, so no Markdown spelling (inline, reference, angle
  // brackets, auto-embed) can hide a source: the browser trims ASCII whitespace and C0 controls from an attribute
  // URL and reads `\` as `/`, so this is root- or protocol-relative as the browser resolves it.
  it.each(ALL)('$name draws no image with a root- or protocol-relative source', (c) => {
    const host = document.createElement('div');
    host.innerHTML = c === RECAP_CASE ? openedRecap() : html(c);
    const srcs = [...host.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
    expect(srcs.filter((s) => /^[/\\]/.test(trimC0(s)))).toEqual([]);
  });
});
