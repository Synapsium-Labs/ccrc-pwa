// Fenced code blocks in an assistant turn: the language label over the bar, and
// whether the well underneath is actually highlighted.
//
// `hljs` is registered grammar-by-grammar from `highlight.js/lib/core`
// (MessageBubble.tsx) rather than by importing the whole package, which keeps
// the bundle honest but makes an unregistered language INVISIBLE: `CodeBlock`
// gates on `hljs.getLanguage(lang)` and falls back to plain text, so a missing
// grammar looks exactly like a code block that chose not to be highlighted.
// These read the DOM, so that difference cannot hide.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageBubble } from '../src/session/MessageBubble';

afterEach(cleanup);

const fenced = (lang: string, code: string): HTMLElement => {
  const { container } = render(
    <MessageBubble
      id="s"
      event={{ kind: 'assistant', uuid: 'a1', ts: '2026-07-21T20:00:00Z',
               text: `\`\`\`${lang}\n${code}\n\`\`\`` }}
    />,
  );
  return container;
};

const PHP = `<?php
namespace App\\Http;

class Invoice extends Model {
  private const VAT = 0.2;

  public function total(?float $net = null): float {
    // a comment, so the muted arm is exercised too
    $label = 'net total';
    return $net === null ? 0.0 : $net * (1 + self::VAT);
  }
}`;

describe('PHP code blocks', () => {
  it('highlights a PHP fence instead of dropping it to plain text', () => {
    const container = fenced('php', PHP);
    // The fallback arm renders `<code class="hljs">` with no children at all —
    // so the presence of scoped spans IS the proof a grammar was found.
    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
    expect(container.querySelector('.hljs-string')).not.toBeNull();
    expect(container.querySelector('.hljs-comment')).not.toBeNull();
    expect(container.querySelector('.hljs-variable')).not.toBeNull();
  });

  it('labels it PHP, not the raw fence word', () => {
    fenced('php', PHP);
    expect(screen.getByText('PHP')).toHaveClass('code-block-lang');
  });

  // The usual shape in a chat is a fragment, not a file — an answer quotes a
  // method, not a whole script with an opening tag. A grammar that only woke up
  // on `<?php` would leave most real blocks flat.
  it('highlights a bare snippet with no opening tag', () => {
    const container = fenced('php', [
      'public function handle(Request $request): Response {',
      '  $rows = DB::table(\'orders\')->where(\'paid\', true)->get();',
      '  return new Response($rows, 200);',
      '}',
    ].join('\n'));
    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
    expect(container.querySelector('.hljs-string')).not.toBeNull();
  });

  it('keeps the code itself intact, tags and all', () => {
    const container = fenced('php', PHP);
    expect(container.querySelector('.code-block pre')?.textContent).toBe(PHP);
  });
});

describe('a language with no grammar registered', () => {
  // The fallback is deliberate, not a gap to be filled by widening the imports:
  // an unknown fence renders readable and unhighlighted rather than throwing.
  it('renders plain, under the fence word as its own label', () => {
    const container = fenced('cobol', 'IDENTIFICATION DIVISION.');
    expect(container.querySelector('[class^="hljs-"]')).toBeNull();
    expect(screen.getByText('cobol')).toHaveClass('code-block-lang');
    expect(container.querySelector('.code-block pre')?.textContent)
      .toBe('IDENTIFICATION DIVISION.');
  });
});
