// WorkbenchSidebar (@ccrc/ui): the desk's workspace tree. It only DRAWS — the app groups, orders, filters and seeds
// the folds — so this file pins behaviour and accessibility, not pixels: the flat tree's roles and levels, the roving
// focus and its keys, the coordinator fold and its summary line, the `+` and the coordinator tag as pointer helpers
// (and the `+`'s key route, Shift+Enter on the head), the yield order on a long id,
// the no-match echo, the account hue as `data-acct`, and the sheet's few load-bearing rules. Neutral fixtures only.
//
// MUTATION TABLE (measured 2026-10-20: each mutation applied to the source, this file run, the source restored).
// Before every mutation: 26/26 green.
//   mutation                                                     after
//   ← no longer folds an open head or coordinator                red 2 ("←/→ fold…", "← on a lane…")
//   the coordinator tag's click propagates (opens the row)       red 1 ("the coordinator tag…")
//   the `+`'s click propagates (toggles the head)                red 1 ("`+` is named…")
//   no match renders the tree anyway                             red 1 ("no match…")
//   data-acct without the `?? 'unknown'` fallback                red 1 ("the account chip…")
//   every session row tabIndex 0 (no roving)                     red 2 ("exactly one tab stop…", "↓/↑ move…")
//   ↓ moves nowhere                                              red 1 ("↓/↑ move…")
//   aria-expanded on every row, leaves included                  red 1 ("aria-expanded on heads…")
//   a folded coordinator keeps its state word, no summary        red 2 ("←/→ fold…", "a coordinator seeded folded…")
//   head named by aria-label including "New session"             red 1 ("a section head is named…")
//   sheet: the dim rule fades with `opacity: 0.6`                red 1 ("dim steps ink…")
//   sheet: a `:hover` outside `@media (hover: hover)`            red 1 ("every :hover sits inside…")
// SECOND ROUND (measured 2026-10-20: 31/31 green before and after; each mutation alone):
//   Shift+Enter on a head does what plain Enter does              red 1 ("the `+`'s key route…")
//   no aria-keyshortcuts on the head                             red 1 ("the `+`'s key route…")
//   aria-keyshortcuts on every head                              red 2 ("the `+`'s key route…", "no onNewSession…")
//   the key route ignores canCreate                              red 1 ("the `+`'s key route…")
//   sheet: the head's title line does not wrap                   red 1 ("a head's label and pool…")
//   the pool chip's text outside its clip span                   red 1 ("every chip text sits in a clip span…")
//   sheet: an agent name without its ellipsis                    red 1 ("line two yields…")
//   sheet: the account cap moved back onto the chip              red 1 ("line two yields…")
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  WorkbenchSidebar,
  type WorkbenchSection,
  type WorkbenchSessionItem,
  type WorkbenchSidebarProps,
} from '@ccrc/ui';

afterEach(cleanup);

const lane = (o: Partial<WorkbenchSessionItem> & { id: string }): WorkbenchSessionItem => ({
  name: o.id, status: 'working', stateWord: 'working', branch: `ws/${o.id}`, account: { label: 'lane-a', hue: 'cyan' }, ...o,
});

const PROJECTS: WorkbenchSection[] = [
  {
    id: 'project-a', label: 'project-a', pool: 'pool-a', waiting: 2, total: 5, canCreate: true,
    items: [
      lane({ id: 'feature-x', stateWord: 'working · 04:12', branch: 'ws/feature-x' }),
      lane({
        id: 'program-a', stateWord: 'working · 12:40', laneSummary: '3 lanes · 2 working · 1 waiting',
        account: { label: 'lane-b', hue: 'violet' },
        lanes: [
          lane({
            id: 'tabs-w1', pr: '#123', subagents: 2,
            agents: [
              { id: 'ag-1', name: 'Explore', task: 'map the tab store', age: '1m', running: true },
              { id: 'ag-2', name: 'reviewer', task: 'review the diff', age: 'just now', running: false },
            ],
          }),
          lane({ id: 'tabs-w2', status: 'attention', stateWord: 'waiting' }),
          lane({ id: 'tabs-w3', status: 'done', stateWord: 'done' }),
        ],
      }),
      lane({ id: 'old-spike', status: 'cleanup', stateWord: 'merged', account: { label: 'lane-c', hue: null } }),
      lane({ id: 'sleepy', status: 'dead', asleep: true, stateWord: 'hibernated', account: null }),
    ],
  },
  { id: 'project-b', label: 'project-b', waiting: 0, total: 1, defaultFolded: true, items: [lane({ id: 'feature-y' })] },
];

function setup(over: Partial<WorkbenchSidebarProps> = {}) {
  const props: WorkbenchSidebarProps = {
    mode: 'projects', onModeChange: vi.fn(), query: '', onQueryChange: vi.fn(),
    sections: PROJECTS, selectedId: 'feature-x', onOpen: vi.fn(), onOpenAgent: vi.fn(), onNewSession: vi.fn(),
    ...over,
  };
  const view = render(<WorkbenchSidebar {...props} />);
  return { ...view, props };
}

const item = (text: string | RegExp): HTMLElement => {
  const hits = screen.getAllByRole('treeitem').filter((el) =>
    typeof text === 'string' ? el.textContent?.includes(text) && el.querySelector('.wb-side-name, .wb-side-label')?.textContent === text
      : text.test(el.textContent ?? ''));
  if (hits.length !== 1) throw new Error(`expected one treeitem for ${String(text)}, got ${hits.length}`);
  return hits[0]!;
};
const key = (el: HTMLElement, k: string, mods: { shiftKey?: boolean } = {}): void => {
  fireEvent.keyDown(el, { key: k, ...mods });
};

describe('the flat tree: roles, levels, expanded and selected', () => {
  it('is a nav named Workspaces holding one tree of sibling treeitems', () => {
    setup();
    expect(screen.getByRole('navigation', { name: 'Workspaces' })).toBeTruthy();
    const tree = screen.getByRole('tree', { name: 'Workspaces' });
    // Flat: no treeitem contains another treeitem.
    for (const ti of within(tree).getAllByRole('treeitem')) expect(ti.querySelector('[role="treeitem"]')).toBeNull();
    expect(tree.querySelector('[role="group"]')).toBeNull();
  });

  it('levels: 1 section, 2 session, 3 lane, 4 agent', () => {
    setup();
    expect(item('project-a').getAttribute('aria-level')).toBe('1');
    expect(item('feature-x').getAttribute('aria-level')).toBe('2');
    expect(item('tabs-w2').getAttribute('aria-level')).toBe('3');
    expect(item('Explore').getAttribute('aria-level')).toBe('4');
  });

  it('setsize and posinset per level', () => {
    setup();
    expect(item('project-b').getAttribute('aria-setsize')).toBe('2');
    expect(item('project-b').getAttribute('aria-posinset')).toBe('2');
    expect(item('old-spike').getAttribute('aria-setsize')).toBe('4');
    expect(item('old-spike').getAttribute('aria-posinset')).toBe('3');
    expect(item('tabs-w3').getAttribute('aria-posinset')).toBe('3');
    expect(item('reviewer').getAttribute('aria-posinset')).toBe('2');
    expect(item('reviewer').getAttribute('aria-setsize')).toBe('2');
  });

  it('aria-expanded on heads and coordinators only; aria-selected on rows, never on heads', () => {
    setup();
    expect(item('project-a').getAttribute('aria-expanded')).toBe('true');
    expect(item('project-b').getAttribute('aria-expanded')).toBe('false');
    expect(item('program-a').getAttribute('aria-expanded')).toBe('true');
    expect(item('feature-x').hasAttribute('aria-expanded')).toBe(false);
    expect(item('Explore').hasAttribute('aria-expanded')).toBe(false);
    expect(item('project-a').hasAttribute('aria-selected')).toBe(false);
    expect(item('feature-x').getAttribute('aria-selected')).toBe('true');
    expect(item('tabs-w2').getAttribute('aria-selected')).toBe('false');
    expect(item('Explore').getAttribute('aria-selected')).toBe('false');
  });

  it('a folded section renders no children, and keeps its waiting badge', () => {
    setup({ sections: [{ ...PROJECTS[0]!, defaultFolded: true }] });
    expect(item('project-a').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('feature-x')).toBeNull();
    expect(item('project-a').textContent).toContain('2 waiting');
  });

  it('a section head is named by its label and counts, never by its `+`', () => {
    setup();
    const head = screen.getByRole('treeitem', { name: /^project-a/ });
    expect(head).toBe(item('project-a'));
    expect(head.getAttribute('aria-labelledby')?.split(' ')).toHaveLength(2);
    const name = head.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ');
    expect(name).toContain('project-a');
    expect(name).toContain('2 waiting');
    expect(name).not.toContain('New session');
    expect(name).not.toContain('+');
  });

  it('every lamp carries its word: the row names its state from content', () => {
    setup();
    expect(within(item('sleepy')).getByRole('img').getAttribute('aria-label')).toBe('hibernated');
    expect(within(item('tabs-w2')).getByRole('img').getAttribute('aria-label')).toBe('waiting on you');
  });
});

describe('roving focus and the keys', () => {
  it('exactly one tab stop: the selected row first, else the first item', () => {
    setup();
    const stops = screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0);
    expect(stops).toEqual([item('feature-x')]);
    cleanup();
    setup({ selectedId: null });
    expect(screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)).toEqual([item('project-a')]);
  });

  it('↓/↑ move through visible items; Home/End jump; the tab stop follows', () => {
    setup();
    const fx = item('feature-x');
    fx.focus();
    key(fx, 'ArrowDown');
    expect(document.activeElement).toBe(item('program-a'));
    key(item('program-a'), 'ArrowUp');
    key(item('feature-x'), 'ArrowUp');
    expect(document.activeElement).toBe(item('project-a'));
    key(item('project-a'), 'End');
    expect(document.activeElement).toBe(item('project-b'));
    expect(screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)).toEqual([item('project-b')]);
    key(item('project-b'), 'Home');
    expect(document.activeElement).toBe(item('project-a'));
  });

  it('←/→ fold and unfold a coordinator, which switches line two to the summary', () => {
    setup();
    const co = item('program-a');
    co.focus();
    expect(co.textContent).toContain('ws/program-a');
    key(co, 'ArrowLeft');
    expect(item('program-a').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('tabs-w1')).toBeNull();
    expect(item('program-a').textContent).toContain('3 lanes · 2 working · 1 waiting');
    expect(item('program-a').textContent).not.toContain('ws/program-a');
    key(item('program-a'), 'ArrowRight');
    expect(item('program-a').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(item('program-a'));
    key(item('program-a'), 'ArrowRight');
    expect(document.activeElement).toBe(item('tabs-w1'));
  });

  it('← on a lane moves to its coordinator; ← on an agent moves to its lane; ← on an open head folds it', () => {
    setup();
    item('tabs-w2').focus();
    key(item('tabs-w2'), 'ArrowLeft');
    expect(document.activeElement).toBe(item('program-a'));
    item('Explore').focus();
    key(item('Explore'), 'ArrowLeft');
    expect(document.activeElement).toBe(item('tabs-w1'));
    item('project-a').focus();
    key(item('project-a'), 'ArrowLeft');
    expect(item('project-a').getAttribute('aria-expanded')).toBe('false');
  });

  it('a coordinator seeded folded shows its summary until unfolded', () => {
    const items = PROJECTS[0]!.items.map((it) => (it.id === 'program-a' ? { ...it, defaultFolded: true } : it));
    setup({ sections: [{ ...PROJECTS[0]!, items }] });
    expect(item('program-a').getAttribute('aria-expanded')).toBe('false');
    expect(item('program-a').textContent).toContain('3 lanes · 2 working · 1 waiting');
  });

  it('Enter opens a row or an agent, and toggles a head', () => {
    const { props } = setup();
    key(item('feature-x'), 'Enter');
    expect(props.onOpen).toHaveBeenCalledWith('feature-x');
    key(item('Explore'), 'Enter');
    expect(props.onOpenAgent).toHaveBeenCalledWith('tabs-w1', 'ag-1');
    key(item('project-b'), 'Enter');
    expect(item('project-b').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('feature-y')).toBeTruthy();
  });

  it('a click opens a row; a click on a head toggles it', () => {
    const { props } = setup();
    fireEvent.click(item('tabs-w3'));
    expect(props.onOpen).toHaveBeenCalledWith('tabs-w3');
    fireEvent.click(item('project-a'));
    expect(item('project-a').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the pointer helpers inside a treeitem', () => {
  it('`+` is named, untabbable, and calls onNewSession without toggling the head', () => {
    const { props } = setup();
    const plus = screen.getByRole('button', { name: 'New session on project-a' });
    expect(plus.tabIndex).toBe(-1);
    fireEvent.click(plus);
    expect(props.onNewSession).toHaveBeenCalledWith('project-a');
    expect(item('project-a').getAttribute('aria-expanded')).toBe('true');
    expect(props.onOpen).not.toHaveBeenCalled();
    // No `+` where the section cannot create.
    expect(screen.queryByRole('button', { name: 'New session on project-b' })).toBeNull();
  });

  it("the `+`'s key route: Shift+Enter on a head that can create, declared in aria-keyshortcuts", () => {
    const { props } = setup();
    const head = item('project-a');
    expect(head.getAttribute('aria-keyshortcuts')).toBe('Shift+Enter');
    key(head, 'Enter', { shiftKey: true });
    expect(props.onNewSession).toHaveBeenCalledWith('project-a');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    // A head that cannot create declares nothing, and Shift+Enter is its plain Enter.
    const other = item('project-b');
    expect(other.hasAttribute('aria-keyshortcuts')).toBe(false);
    key(other, 'Enter', { shiftKey: true });
    expect(props.onNewSession).toHaveBeenCalledTimes(1);
    expect(other.getAttribute('aria-expanded')).toBe('true');
  });

  it('no onNewSession: no `+` and no key route, even where the section could create', () => {
    setup({ onNewSession: undefined });
    expect(screen.queryByRole('button', { name: /New session/ })).toBeNull();
    expect(item('project-a').hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('the coordinator tag is an aria-hidden, untabbable toggle that never opens the row', () => {
    const { props } = setup();
    const tag = item('program-a').querySelector<HTMLButtonElement>('.wb-side-ctag')!;
    expect(tag.getAttribute('aria-hidden')).toBe('true');
    expect(tag.tabIndex).toBe(-1);
    expect(tag.textContent).toBe('▾ coordinator · 3');
    fireEvent.click(tag);
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(item('program-a').getAttribute('aria-expanded')).toBe('false');
    expect(item('program-a').querySelector('.wb-side-ctag')!.textContent).toBe('▸ coordinator · 3');
  });
});

describe('the words and the stamps', () => {
  it('no match echoes the query and renders no tree at all', () => {
    setup({ sections: [], query: 'auth' });
    expect(screen.getByText('No workspace matches “auth”.')).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('the account chip carries data-acct, unknown for a null hue', () => {
    setup();
    expect(item('feature-x').querySelector('.wb-side-acct')!.getAttribute('data-acct')).toBe('cyan');
    expect(item('old-spike').querySelector('.wb-side-acct')!.getAttribute('data-acct')).toBe('unknown');
    expect(item('sleepy').querySelector('.wb-side-acct')).toBeNull();
  });

  it('cleanup rows dim name and word; an attention word is marked; the branch is shown', () => {
    setup();
    const spike = item('old-spike');
    expect(spike.querySelector('.wb-side-name')!.getAttribute('data-dim')).toBe('true');
    expect(spike.querySelector('.wb-side-word')!.getAttribute('data-dim')).toBe('true');
    expect(item('feature-x').querySelector('.wb-side-name')!.hasAttribute('data-dim')).toBe(false);
    expect(item('tabs-w2').querySelector('.wb-side-word')!.getAttribute('data-attention')).toBe('true');
    expect(item('feature-x').querySelector('.wb-side-branch')!.textContent).toBe('ws/feature-x');
  });

  it('the PR and the subagent count ride line one', () => {
    setup();
    expect(item('tabs-w1').querySelector('.wb-side-pr')!.textContent).toBe('#123');
    expect(item('tabs-w1').querySelector('.wb-side-subs')!.textContent).toContain('2');
    expect(item('feature-x').querySelector('.wb-side-subs')).toBeNull();
  });

  it('the mode switch is a pressed pair in a group; the filter reports its text', () => {
    const { props } = setup();
    const group = screen.getByRole('group', { name: 'Group by' });
    expect(within(group).getByRole('button', { name: 'Projects' }).getAttribute('aria-pressed')).toBe('true');
    const status = within(group).getByRole('button', { name: 'Status' });
    expect(status.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(status);
    expect(props.onModeChange).toHaveBeenCalledWith('status');
    const filter = screen.getByRole('searchbox', { name: 'Filter workspaces' });
    fireEvent.change(filter, { target: { value: 'auth' } });
    expect(props.onQueryChange).toHaveBeenCalledWith('auth');
  });

  it('status mode: a group head carries its lamp; the foot renders', () => {
    setup({
      mode: 'status',
      sections: [{ id: 'needs', label: 'Needs you', lamp: 'attention', waiting: 0, total: 1, items: [lane({ id: 'tabs-w2', status: 'attention' })] }],
      foot: <div>foot-slot</div>,
    });
    expect(within(item('Needs you')).getByRole('img').getAttribute('aria-label')).toBe('waiting on you');
    expect(screen.getByText('foot-slot')).toBeTruthy();
  });
});

describe('the sheet', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-sidebar.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('dim steps ink to --ink-tertiary on [data-dim], and nothing fades with opacity', () => {
    expect(css).toMatch(/\[data-dim='true'\][^{]*\{[^}]*color:\s*var\(--ink-tertiary\)/);
    expect(css).not.toMatch(/opacity/);
  });

  it('the row floor is var(--row-h); no literal 44px; tokens only', () => {
    expect(css).toMatch(/\.wb-side-row\s*\{[^}]*min-height:\s*var\(--row-h\)/);
    expect(css).not.toMatch(/\b44px\b/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/);
    expect(css).not.toMatch(/data-skin/);
  });

  it('every :hover sits inside @media (hover: hover)', () => {
    const stack: string[] = [];
    let prelude = '';
    const hovers: string[][] = [];
    for (const ch of css) {
      if (ch === '{') { stack.push(prelude.trim()); prelude = ''; }
      else if (ch === '}') { stack.pop(); prelude = ''; }
      else if (ch === ';') prelude = '';
      else prelude += ch;
      if (ch === '{' && stack[stack.length - 1]!.includes(':hover')) hovers.push([...stack]);
    }
    expect(hovers.length).toBeGreaterThan(0);
    for (const s of hovers) expect(s.some((p) => /@media\s*\(hover:\s*hover\)/.test(p))).toBe(true);
  });

  // The yield order on a long id (the shapes, not the pixels — those are the blind verifier's).
  const rule = (sel: string): string => {
    const at = css.indexOf(`${sel} {`);
    expect(at, sel).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it("a head's label and pool share one clipped wrapping line, so the pool goes before the label does", () => {
    const title = rule('.wb-side-head .wb-side-title');
    expect(title).toMatch(/flex-wrap:\s*wrap/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/height:\s*var\(--wb-side-chip-h\)/);
    expect(rule('.wb-side-head .wb-side-label')).toMatch(/flex:\s*1000 1 8ch/);
    expect(rule('.wb-side-counts')).toMatch(/flex:\s*none/);
    expect(rule('.wb-side-head .wb-side-new')).toMatch(/flex:\s*none/);
  });

  it('line two yields the branch, then the capped account chip, then the word; an agent name ellipsizes', () => {
    expect(rule('.wb-side-row .wb-side-branch')).toMatch(/flex:\s*0 1e12 auto/);
    expect(rule('.wb-side-row .wb-side-acct')).toMatch(/flex:\s*0 1e6 auto/);
    expect(rule('.wb-side-row .wb-side-word')).toMatch(/flex:\s*0 1 auto/);
    expect(rule('.wb-side-row .wb-side-acct .wb-side-clip')).toMatch(/max-width:\s*14ch/);
    expect(rule('.wb-side-agent .wb-side-name')).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.wb-side-agent')).toMatch(/grid-template-columns:\s*12px minmax\(0, max-content\) minmax\(4ch, 1fr\) auto/);
  });

  it('every chip text sits in a clip span, so a long pool or account ellipsizes inside its pill', () => {
    setup();
    for (const chip of document.querySelectorAll('.wb-side-pool, .wb-side-acct')) {
      expect(chip.firstElementChild?.className).toBe('wb-side-clip');
    }
    expect(rule('.wb-side .wb-side-clip')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('the selected row is the accent tint with an inset accent rail', () => {
    expect(css).toMatch(/\.wb-side-row\[aria-selected='true'\]\s*\{[^}]*background:\s*var\(--accent-tint\)[^}]*box-shadow:\s*inset 2px 0 0 var\(--accent\)/);
  });
});
