// A GFM task list's checkbox carries a name that says its state in words. remark-gfm emits a bare
// `<input type="checkbox" disabled>` (checked or not) as the item's first child, or inside a loose item's first `<p>`,
// with no `<label>`, so without a name a screen reader hears "checkbox, checked, dimmed" and nothing that says what it
// is. axe flags it ("Form elements must have labels"), which is how the design system's Prose story found it.
// `SHARED_COMPONENTS.input` names it ("done" / "to do"), so chat (`CHAT_COMPONENTS`) and the Docs screen
// (`DOC_COMPONENTS`) both carry it; the item's own text still follows the box. The Prose story's Lists mirror is held
// to the same names here, so Storybook keeps showing what the app renders.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatMarkdown, TASK_CHECKBOX_NAME } from '../src/lib/markdown';
import { DOC_COMPONENTS } from '../src/docs/DocMarkdown';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';

afterEach(cleanup);

const TEXT = [
  'A tight task list:',
  '',
  '- [x] tight done',
  '- [ ] tight open',
  '',
  'A loose one:',
  '',
  '- [x] loose done',
  '',
  '- [ ] loose open',
  '',
  '  Its second paragraph.',
  '',
].join('\n');

/** Each checkbox's accessible name, its checked state, and the text of the item it sits in, in document order. */
function boxes(container: HTMLElement): { name: string | null; checked: boolean; disabled: boolean; item: string }[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((b) => ({
    name: b.getAttribute('aria-label'),
    checked: b.checked,
    disabled: b.disabled,
    item: (b.closest('li')?.textContent ?? '').trim().split('\n')[0]!.trim(),
  }));
}

const EXPECTED = [
  { name: 'done', checked: true, disabled: true, item: 'tight done' },
  { name: 'to do', checked: false, disabled: true, item: 'tight open' },
  { name: 'done', checked: true, disabled: true, item: 'loose done' },
  { name: 'to do', checked: false, disabled: true, item: 'loose open' },
];

describe('a task-list checkbox is named by its state', () => {
  it('the words are "done" and "to do"', () => {
    expect(TASK_CHECKBOX_NAME).toEqual({ checked: 'done', unchecked: 'to do' });
  });

  it('chat (ChatMarkdown): tight and loose items, each box named, still disabled', () => {
    const { container, getAllByRole } = render(<ChatMarkdown text={TEXT} />);
    expect(boxes(container)).toEqual(EXPECTED);
    // The name is what the accessibility tree computes, not only an attribute: RTL's role query asks it.
    expect(getAllByRole('checkbox', { name: 'done' })).toHaveLength(2);
    expect(getAllByRole('checkbox', { name: 'to do' })).toHaveLength(2);
  });

  it('Docs (DOC_COMPONENTS through renderHast): the same names', () => {
    const parsed = parseMarkdown(TEXT, 'docs');
    if (parsed.kind !== 'tree') throw new Error(`parse answered ${parsed.kind}`);
    const { container, getAllByRole } = render(<article>{renderHast(parsed.tree, { components: DOC_COMPONENTS })}</article>);
    expect(boxes(container)).toEqual(EXPECTED);
    expect(getAllByRole('checkbox', { name: 'done' })).toHaveLength(2);
    expect(getAllByRole('checkbox', { name: 'to do' })).toHaveLength(2);
  });

  it('the markup is otherwise what remark-gfm emits: the box is the first child of a tight item, of a loose item\'s first <p>', () => {
    const { container } = render(<ChatMarkdown text={TEXT} />);
    const items = [...container.querySelectorAll('li.task-list-item')];
    expect(items).toHaveLength(4);
    const first = (el: Element): Element | null => el.firstElementChild;
    expect(first(items[0]!)?.tagName).toBe('INPUT');
    expect(first(items[1]!)?.tagName).toBe('INPUT');
    expect(first(items[2]!)?.tagName).toBe('P');
    expect(first(first(items[2]!)!)?.tagName).toBe('INPUT');
    expect(first(first(items[3]!)!)?.tagName).toBe('INPUT');
  });
});

describe('the Prose story mirrors it', () => {
  const STORY = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'prose.stories.tsx'), 'utf8');
  const inputs = [...STORY.matchAll(/<input\b[^>]*\/>/g)].map((m) => m[0]);

  it('reads every checkbox of the story', () => {
    expect(inputs.length).toBeGreaterThanOrEqual(9);
    for (const i of inputs) expect(i, i).toMatch(/type="checkbox"/);
  });

  it('each story checkbox carries the name the app gives its state, and stays disabled', () => {
    for (const i of inputs) {
      const want = /\bchecked\b/.test(i) ? TASK_CHECKBOX_NAME.checked : TASK_CHECKBOX_NAME.unchecked;
      expect(i, i).toMatch(/\bdisabled\b/);
      expect(i, i).toContain(`aria-label="${want}"`);
    }
  });
});
