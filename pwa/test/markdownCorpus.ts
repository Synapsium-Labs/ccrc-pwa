// The chat Markdown corpus (native Docs reader, W4 Task 1; design 2026-10-01 section 4.9 and section 4.15's M4.M1,
// the W4 plan's refinement (e)). One named case per entry. `markdown-golden.test.tsx` renders every case through
// today's `MessageBubble` and holds the output to a stored file under `test/golden/markdown/<name>.html`; Task 4's
// parity row renders the same cases through the pipeline. Both read this file, and nothing else declares a case.
//
// Two bounds keep every golden file still through the whole wave, and the golden test asserts both on each case:
//   - every `text` is at most 4 096 UTF-8 bytes (CHAT_SYNC_MAX_BYTES, which Task 3 declares), so Task 6's split
//     keeps every case on the synchronous path that renders exactly as today;
//   - no case draws an `<img>` whose source is root-relative or protocol-relative, which Task 6 refuses.
// Placeholders only: example.com, 203.0.113.7, `<server-host>`. No raw control byte (source-bytes.test.ts).

export interface CorpusCase {
  /** A file-safe slug: the golden file is `test/golden/markdown/<name>.html`. */
  readonly name: string;
  readonly text: string;
  /** Renders the assistant turn with the streaming caret after its body. */
  readonly streaming?: boolean;
}

/** Fence tags that `MessageBubble` resolves through an alias rather than a grammar's own name: the three
 *  `registerAliases` calls (`zsh`, `shell`, `tsx`, `html`, `svg`) and the grammars' built-in aliases. The grammar
 *  names themselves are not listed here: the golden measures them with `hljs.listLanguages()`. */
export const CHAT_ALIAS_TAGS: readonly string[] = [
  'zsh', 'shell', 'tsx', 'html', 'svg',
  'sh', 'ts', 'js', 'jsx', 'mjs', 'py', 'yml', 'md', 'docker', 'golang', 'rs', 'jsonc',
];

/** Fence tags no registered grammar answers: the block renders unhighlighted, labelled with the raw tag. */
export const CHAT_UNREGISTERED_TAGS: readonly string[] = ['text', 'mermaid', 'console'];

/** One fenced block for each tag, over a body with a keyword, a string, a number, a comment, markup and a query,
 *  so every grammar emits some tokens. */
export function languageCases(langs: readonly string[]): CorpusCase[] {
  return langs.map((lang) => ({
    name: `lang-${lang}`,
    text: [
      `A ${lang} block:`,
      '',
      '```' + lang,
      'const greeting = "hello"; // say it',
      'if (count > 1) { return [1, 2, 3]; }',
      '<div class="note">text &amp; more</div>',
      'SELECT id FROM t WHERE n = 2;',
      '- item: true',
      '```',
      '',
    ].join('\n'),
  }));
}

/** `text` padded with ASCII to exactly `bytes` UTF-8 bytes (it must not already exceed them). */
function padToBytes(text: string, bytes: number): string {
  const have = new TextEncoder().encode(text).length;
  return have >= bytes ? text : text + 'x'.repeat(bytes - have);
}

export const CHAT_CORPUS: readonly CorpusCase[] = [
  {
    name: 'empty',
    text: '',
  },
  {
    name: 'prose-inline',
    text: [
      '# Heading one',
      '## Heading two',
      '### Heading three',
      '',
      'Plain prose with **bold**, *italic*, ***both***, `inline code` and a line  ',
      'break, then a soft',
      'wrap.',
      '',
      '---',
      '',
      '1. first',
      '2. second',
      '   - nested bullet',
      '   - another',
      '',
      '* star list',
      '+ plus list',
      '',
      '> a plain quote, not an alert',
      '',
    ].join('\n'),
  },
  {
    name: 'emphasis-runs',
    text: '**strong** __also strong__ *em* _em_ ***strong em*** ********** a run of ten, and \\*escaped\\* stars.',
  },
  {
    name: 'entities-and-escapes',
    text: 'Ampersand &amp; copyright &copy; numeric &#169; hex &#xA9; and a literal \\# hash, \\[bracket\\], \\`tick\\`.',
  },
  {
    name: 'unicode',
    text: 'Accents: café, naïve. CJK: 漢字かな. Emoji: 🚀✅. Arrows: ← → ↑ ↓. Math: ≤ ≥ ≠ ∞.',
  },
  {
    name: 'callouts-all-kinds',
    text: [
      '> [!NOTE]',
      '> A note with **bold**.',
      '',
      '> [!TIP]',
      '> A tip.',
      '',
      '> [!IMPORTANT]',
      '> Important text.',
      '',
      '> [!WARNING]',
      '> A warning.',
      '',
      '> [!CAUTION]',
      '> Caution, with `code`.',
      '',
      '> [!note]',
      '> Lower case still tags.',
      '',
      '> [!FOO]',
      '> Not an alert kind: a plain quote.',
      '',
    ].join('\n'),
  },
  {
    name: 'callout-nested',
    text: [
      '> [!NOTE]',
      '> Outer note.',
      '>',
      '> > [!WARNING]',
      '> > Inner warning.',
      '> >',
      '> > > [!TIP]',
      '> > > Innermost tip.',
      '',
      '> Plain outer quote.',
      '>',
      '> > [!CAUTION]',
      '> > An alert inside a plain quote.',
      '',
      '- a list item',
      '',
      '  > [!IMPORTANT]',
      '  > An alert inside a list item.',
      '',
    ].join('\n'),
  },
  {
    name: 'callout-emptied-lead',
    text: [
      '> [!TIP]',
      '>',
      '> The marker paragraph empties and is dropped; this paragraph stays.',
      '',
      '> [!WARNING] **bold right after the marker**',
      '',
      '> [!CAUTION]',
      '',
      '> [!NOTE]   ',
      '> trailing spaces after the marker',
      '',
    ].join('\n'),
  },
  {
    name: 'kbd-chips',
    text: 'Press `Cmd+K`, then `Esc`, or `Ctrl + Shift + P`, or `⌘+K`, or `F5`, or `Alt+F4`. A lone `a` stays a chip; `Ctrl+Foo` and `npm ci` are code.',
  },
  {
    name: 'inline-code',
    text: 'Run `npm ci` in `pwa/`, then `` a `tick` inside `` and `<b>not bold</b>`.',
  },
  {
    name: 'code-no-tag',
    text: [
      'A fence with no tag:',
      '',
      '```',
      'plain text block',
      '  keeps its indent',
      '```',
      '',
      'A tilde fence:',
      '',
      '~~~',
      'tilde fenced',
      '~~~',
      '',
      'An indented block:',
      '',
      '    indented code',
      '    second line',
      '',
    ].join('\n'),
  },
  {
    name: 'gfm-table',
    text: [
      '| left | centre | right |',
      '|:-----|:------:|------:|',
      '| a | **b** | `c` |',
      '| 1 | 2 | 3 |',
      '',
    ].join('\n'),
  },
  {
    name: 'gfm-task-list',
    text: ['- [ ] open task', '- [x] done task', '- plain item', ''].join('\n'),
  },
  {
    name: 'gfm-strikethrough',
    text: 'This is ~~gone~~ and ~single~ tilde.',
  },
  {
    name: 'gfm-footnote',
    text: ['A claim with a footnote.[^1]', '', '[^1]: The footnote text.', ''].join('\n'),
  },
  {
    name: 'images-https',
    text: [
      '![a chart](https://example.com/chart.png)',
      '',
      '![](https://example.com/plain.svg "a title")',
      '',
      'Inline ![icon](https://example.com/icon.webp) in prose.',
      '',
    ].join('\n'),
  },
  {
    name: 'links',
    text: [
      '[docs](https://example.com/docs) and [guide](example.com/guide) and [mail](mailto:someone@example.com).',
      '',
      'A link to an image file: [the render](https://example.com/render.jpg?size=2).',
      '',
      'Bare URLs: https://example.com/page and www.example.com and http://203.0.113.7/status.',
      '',
      'A bare image URL: https://example.com/shot.png',
      '',
      'An angle autolink: <https://example.com/angle>.',
      '',
    ].join('\n'),
  },
  {
    name: 'raw-html',
    text: [
      '<img src=x onerror=alert(1)>',
      '',
      '<script>x</script>',
      '',
      'Inline <b>bold?</b> and <server-host> and a <kbd>K</kbd> tag.',
      '',
      '<div class="callout">a raw div</div>',
      '',
    ].join('\n'),
  },
  {
    name: 'streaming-caret',
    text: 'Still writing this **answer**',
    streaming: true,
  },
  {
    name: 'at-sync-limit',
    text: padToBytes(
      ['# A long message', '', 'Exactly 4 096 UTF-8 bytes, with a multi-byte é so bytes and characters differ.', '', ''].join('\n'),
      4096,
    ),
  },
];

/** A recap that `MessageBubble` folds into the compaction card (it matches `COMPACTION_RE`). Its Markdown body is
 *  the second Markdown site, which renders only once the card is opened. */
export const RECAP_CASE: CorpusCase = {
  name: 'recap-opened',
  text: [
    'This session is being continued from a previous conversation that ran out of context.',
    '',
    '> [!NOTE]',
    '> The summary follows.',
    '',
    '| step | state |',
    '|------|-------|',
    '| plan | ~~open~~ done |',
    '',
    '```ts',
    'const a = 1;',
    '```',
    '',
  ].join('\n'),
};
