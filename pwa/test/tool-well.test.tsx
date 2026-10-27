// The tool card's wells on the code palette (T4a, D-6387): `renderToolWell` hands `ToolCard` a renderer that reads each
// well through `toolWellPlan` and the one bounded highlighter. These tests pin that a plain well keeps today's DOM,
// that no ANSI value ever reaches a `style` attribute, that a failed call's row says so at rest, that a block over
// CodeBlock's bound renders plain, and that inline code is a well chip.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ToolCard, type ToolResultEvent, type ToolUseEvent } from '@ccrc/ui';
import { renderToolWell } from '../src/session/ToolWellText';
import { ChatMarkdown } from '../src/lib/markdown';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';

afterEach(cleanup);

const TS = '2026-10-02T14:00:00.000Z';
const TS_LATER = '2026-10-02T14:00:04.200Z';

const use = (name: string, input: string): ToolUseEvent => ({ kind: 'tool_use', uuid: 'u1', toolId: 'tu1', ts: TS, name, input });
const result = (text: string, isError = false): ToolResultEvent => ({ kind: 'tool_result', toolId: 'tu1', ts: TS_LATER, text, isError });

/** An expanded card: its wells, in document order (input, then result). */
function expanded(u: ToolUseEvent, r?: ToolResultEvent): HTMLElement[] {
  const { container } = render(<ToolCard use={u} result={r} renderWell={renderToolWell(u)} />);
  fireEvent.click(container.querySelector('.tool-row')!);
  return Array.from(container.querySelectorAll<HTMLElement>('.well'));
}

const textNodes = (el: Element): ChildNode[] => Array.from(el.childNodes);

describe('tool well', () => {
  it("a plain result renders today's DOM: one text node in the well", () => {
    const [, resultWell] = expanded(use('Read', '{"file_path":"/a/b.txt"}'), result('line one\nline two'));
    expect(textNodes(resultWell!)).toHaveLength(1);
    expect(resultWell!.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(resultWell!.textContent).toBe('line one\nline two');
    expect(resultWell!.querySelector('*')).toBeNull();
  });

  it('a tool well carries no style attribute', () => {
    const ansi = '\x1b[31mFAIL\x1b[0m one\n\x1b[32mok\x1b[0m two\x1b[2K\x1b[1A\x1b[38;5;196mhot\x1b[0m';
    const wells = expanded(use('Bash', '{"command":"npm test"}'), result(ansi));
    expect(wells).toHaveLength(2);
    for (const well of wells) {
      expect(well.hasAttribute('style')).toBe(false);
      expect(well.querySelector('[style]')).toBeNull();
    }
  });

  it("a failed call's row says 'failed'; an ok or running call's does not", () => {
    const u = use('Bash', '{"command":"false"}');
    const rowOf = (r?: ToolResultEvent): HTMLElement => {
      const { container } = render(<ToolCard use={u} result={r} />);
      return container.querySelector<HTMLElement>('.tool-row')!;
    };
    const failed = rowOf(result('boom', true));
    expect(failed.querySelector('.tool-fail')?.textContent).toBe('failed');
    expect(failed.textContent).toContain('failed');
    cleanup();
    expect(rowOf(result('fine', false)).textContent).not.toContain('failed');
    cleanup();
    const running = rowOf(undefined);
    expect(running.textContent).not.toContain('failed');
    expect(running.querySelector('.tool-fail')).toBeNull();
  });

  it("a block over CodeBlock's bound renders plain", () => {
    const body = '+x\n'.repeat(Math.ceil(MD_HIGHLIGHT_BLOCK_MAX_CHARS / 3) + 10);
    const diff = `@@ -1 +1 @@\n${body}`;
    expect(diff.length).toBeGreaterThan(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    const [, resultWell] = expanded(use('Bash', '{"command":"git diff"}'), result(diff));
    expect(textNodes(resultWell!)).toHaveLength(1);
    expect(resultWell!.querySelector('.hljs')).toBeNull();
    expect(resultWell!.textContent).toBe(diff);
  });

  it('inline code renders as a well chip', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'prose.css'), 'utf8');
    const rule = /\.msg-assist \.md-code\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background:\s*var\(--bg-well\)/);
    expect(rule![1]).toMatch(/color:\s*var\(--ink-on-well\)/);
    const { container } = render(<ChatMarkdown text={'run `ls -la` now'} />);
    const chip = container.querySelector('.md-code');
    expect(chip?.textContent).toBe('ls -la');
  });

  it('a Bash input renders a highlighted code element holding the command', () => {
    const [inputWell] = expanded(use('Bash', JSON.stringify({ command: 'git status --short', description: 'show changes' })), result('x'));
    const code = inputWell!.querySelector('code.hljs');
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('git status --short');
    expect(code!.querySelector('[class^="hljs-"]')).not.toBeNull();
  });

  it('a Write input leads with its path as a comment, then the highlighted content', () => {
    const [inputWell] = expanded(use('Write', JSON.stringify({ file_path: '/a/b.ts', content: 'const x = 1;' })), result('ok'));
    const head = inputWell!.querySelector(':scope > .hljs-comment');
    expect(head?.textContent).toBe('/a/b.ts');
    expect(inputWell!.querySelector('code.hljs')!.textContent).toContain('const x = 1;');
  });

  it('an ANSI result renders hue spans and holds no escape character', () => {
    const [, resultWell] = expanded(use('Bash', '{"command":"x"}'), result('\x1b[31mred\x1b[0m and \x1b[32mgreen\x1b[0m'));
    expect(resultWell!.querySelector('.ansi-red')?.textContent).toBe('red');
    expect(resultWell!.querySelector('.ansi-green')?.textContent).toBe('green');
    expect(resultWell!.textContent).not.toContain('\x1b');
    expect(resultWell!.textContent).toBe('red and green');
  });

  it('a diff-headed result renders as a highlighted diff', () => {
    const [, resultWell] = expanded(use('Bash', '{"command":"git diff"}'), result('@@ -1 +1 @@\n-old\n+new'));
    expect(resultWell!.querySelector('code.hljs .hljs-deletion')?.textContent).toBe('-old');
    expect(resultWell!.querySelector('code.hljs .hljs-addition')?.textContent).toBe('+new');
  });
});
