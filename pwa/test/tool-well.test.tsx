// The tool card's wells on the code palette (T4a, D-6387): `renderToolWell` hands `ToolCard` a renderer that reads each
// well through `toolWellPlan` and the one bounded highlighter. These tests pin that a plain well keeps today's DOM,
// that no ANSI value ever reaches a `style` attribute, that a failed call's row says so at rest, that a block over
// CodeBlock's bound renders plain, and that inline code is a well chip.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as planner from '../src/session/toolWell';
import * as markdown from '../src/lib/markdown';
import { ToolWellText } from '../src/session/ToolWellText';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ToolCard, type ToolResultEvent, type ToolUseEvent } from '@ccrc/ui';
import { renderToolWell } from '../src/session/ToolWellText';
import { ChatMarkdown } from '../src/lib/markdown';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';
import { ANSI_HUE_TOKEN } from '../src/lib/ansi';

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
  it('paints synthetic payloads that resemble diff headers as changes', () => {
    const [well] = expanded(use('Edit', JSON.stringify({ file_path: 'x', old_string: '--old', new_string: '++new' })), result('ok'));
    expect(well!.querySelector('.hljs-deletion')?.textContent).toBe('- --old');
    expect(well!.querySelector('.hljs-addition')?.textContent).toBe('+ ++new');
    expect(well!.querySelector('code')?.textContent).toBe('@@ x @@\n- --old\n+ ++new');
  });

  it('bare expanded card preserves raw input and displays empty-result fallback', () => {
    const raw = '{"command":"pwd"}';
    const { container } = render(<ToolCard use={use('Bash', raw)} result={result('')} />);
    fireEvent.click(container.querySelector('.tool-row')!);
    const wells = container.querySelectorAll('.well');
    expect(wells[0]?.textContent).toBe(raw);
    expect(wells[1]?.textContent).toBe('(no output)');
  });

  it('strips parsed input escapes before rendering highlighted command and metadata', () => {
    const esc = String.fromCharCode(27);
    const [well] = expanded(use('Bash', JSON.stringify({ command: `echo ${esc}[31mword`, description: `desc ${esc}[2Ktail` })), result('ok'));
    expect(well!.querySelector('code.hljs')?.textContent).toBe('# desc tail\necho word');
    expect(well!.textContent).not.toContain(esc);
  });

  it('strips input escapes on plain and over-bound fallbacks', () => {
    const esc = String.fromCharCode(27);
    const malformed = `bad${esc}[2Kinput`;
    const plain = render(<ToolWellText use={{ name: 'Bash', input: malformed }} part="input" text={malformed} />);
    expect(plain.container.textContent).toBe('badinput');
    plain.unmount();
    const long = JSON.stringify({ command: `${'x'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1)}${esc}[2Kdone` });
    const capped = render(<ToolWellText use={{ name: 'Bash', input: long }} part="input" text={long} />);
    expect(capped.container.textContent).not.toContain(esc);
    expect(capped.container.textContent).toBe(long);
  });

  it('strips control-only and escape-bearing diff results', () => {
    const cases = [['before\x1b[2Kafter', 'beforeafter'], ['\x1b]0;title\x07ok', 'ok'], ['ok\x1b', 'ok'], ['@@ -1 +1 @@\n-old\n+new\x1b[2K', '@@ -1 +1 @@\n-old\n+new']];
    for (const [raw, expected] of cases) {
      const [, well] = expanded(use('Bash', '{}'), result(raw!));
      expect(well!.textContent).toBe(expected);
      expect(well!.querySelector('code.hljs')).toBeNull();
      cleanup();
    }
  });

  it('memoizes mounted well work by scalar inputs', () => {
    const plans = vi.spyOn(planner, 'toolWellPlan');
    const highlights = vi.spyOn(markdown, 'boundedHighlight');
    const text = '{"command":"pwd"}';
    const view = render(<ToolWellText use={{ name: 'Bash', input: text }} part="input" text={text} />);
    expect(plans).toHaveBeenCalledTimes(1);
    expect(highlights).toHaveBeenCalledTimes(1);
    view.rerender(<ToolWellText use={{ name: 'Bash', input: text }} part="input" text={text} />);
    expect(plans).toHaveBeenCalledTimes(1);
    expect(highlights).toHaveBeenCalledTimes(1);
    view.rerender(<ToolWellText use={{ name: 'Read', input: text }} part="input" text={text} />);
    expect(plans).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe(JSON.stringify({ command: 'pwd' }, null, 2));
    view.rerender(<ToolWellText use={{ name: 'Read', input: text }} part="result" text={text} />);
    expect(plans).toHaveBeenCalledTimes(3);
    expect(view.container.textContent).toBe(text);
    view.rerender(<ToolWellText use={{ name: 'Read', input: text }} part="result" text="changed" />);
    expect(plans).toHaveBeenCalledTimes(4);
    expect(view.container.textContent).toBe('changed');
    plans.mockRestore();
    highlights.mockRestore();
  });
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
    expect(rule![1]).toMatch(/background:\s*var\(--bg-raised\)/);
    expect(rule![1]).toMatch(/color:\s*var\(--ink-primary\)/);
    const scoped = /\.msg-assist:not\(\.doc-body\):not\(\.compaction-body\) \.md-code\s*\{([^}]*)\}/.exec(css);
    expect(scoped).not.toBeNull();
    expect(scoped![1]).toMatch(/background:\s*var\(--bg-well\)/);
    expect(scoped![1]).toMatch(/color:\s*var\(--ink-on-well\)/);
    const { container } = render(<ChatMarkdown text={'run `ls -la` now'} />);
    const chip = container.querySelector('.md-code');
    expect(chip?.textContent).toBe('ls -la');
  });

  it('well emphasis and strong retain syntax typography', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'prose.css'), 'utf8');
    expect(css).toMatch(/\.well \.hljs-emphasis\s*\{\s*font-style:\s*italic/);
    expect(css).toMatch(/\.well \.hljs-strong\s*\{\s*font-weight:\s*var\(--weight-semibold\)/);
  });

  it('ANSI hue tokens match the actual tool-card stylesheet', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'tool-card.css'), 'utf8');
    for (const [hue, token] of Object.entries(ANSI_HUE_TOKEN)) {
      const match = new RegExp(`\\.well \\.ansi-${hue}\\s*\\{\\s*color:\\s*var\\((--[\\w-]+)\\)`).exec(css);
      expect(match?.[1], hue).toBe(token);
    }
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
