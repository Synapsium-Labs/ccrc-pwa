// Decision `ask-dialog-tab-route`: `POST /api/sessions/:id/dialog/tab` moves the PANE between an AskUserQuestion's tabs
// with ←/→, as Claude Code's own keys do, and proves every step by the screen it lands on. The pane here is a fake that
// moves between REAL captures (Claude Code 2.1.296 at 220x50, neutral text; and 2.1.302) as each key arrives, so every
// assertion is about what that build was measured to do with that key on that screen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyedQueue } from '../src/inject/queue.js';
import { moveDialogTab, type SendDeps } from '../src/inject/send.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Tmux, type Runner } from '../src/exec.js';
import { parseAskTabs } from '../../shared/ask-menu.js';
import { isDialogTab } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pane = (name: string): string => readFileSync(path.join(here, 'fixtures', 'panes', `${name}.txt`), 'utf8');
const idOf = (name: string): string => parseDialog(pane(name))!.id;

/** DERIVED from a real capture: the same screen with the ❯ cursor on row `k` instead (Up and Down only move it). */
function withCursor(name: string, k: number): string {
  return pane(name).split('\n').map((l) => {
    const m = /^(❯| ) (\d+)\. /.exec(l);
    if (m === null) return l;
    return `${Number(m[2]) === k ? '❯' : ' '}${l.slice(1)}`;
  }).join('\n');
}

const NO_MENU = 'Some reply text.\n\n❯ \n  ? for shortcuts\n';

/**
 * A pane that is one screen at a time and moves on a key as `moves` says; a key with no move leaves it where it is
 * (Claude Code's no-op edges). `screens` maps a screen's name to its capture. Records every key sent.
 */
function paneGraph(start: string, screens: Record<string, string>, moves: Record<string, Record<string, string>>,
  opts: { failCaptures?: number } = {}) {
  let at = start;
  let fails = opts.failCaptures ?? 0;
  const keys: string[] = [];
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') {
      if (fails > 0) {
        fails--;
        return { code: 1, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: screens[at]!, stderr: '' };
    }
    if (args[0] === 'send-keys') {
      const key = args.at(-1)!;
      keys.push(key);
      at = moves[at]?.[key] ?? at;
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), keys, at: () => at };
}

const deps = (tmux: Tmux): SendDeps => ({ tmux, queue: new KeyedQueue(), sleep: async () => {} });

// The two-question 2.1.296 ask (neutral text), every screen a real capture.
const S = {
  q1: pane('cc296-ask-2q-long-q1'),
  q1row2: withCursor('cc296-ask-2q-long-q1', 2),
  q1text: pane('cc296-ask-2q-long-q1-on-text'),
  q1chat: pane('cc296-ask-2q-long-q1-on-chat'),
  q2: pane('cc296-ask-2q-long-q2'),
  rightQ2: pane('cc296-ask-2q-long-right-q2'),
  review: pane('cc296-ask-2q-long-review'),
  rightReview: pane('cc296-ask-2q-long-right-review'),
  revisitQ2: pane('cc296-ask-2q-long-revisit-q2'),
  revisitQ1: pane('cc296-ask-2q-long-revisit-q1'),
  gone: NO_MENU,
};
// What each key was measured to do (neutral/kb, neutral/kb2 recordings). ← on question 1 and → on the review are
// no-ops; ←/→ on the free-text row and on Chat are swallowed (the screen stays byte for byte); Up only moves the cursor.
const MOVES: Record<string, Record<string, string>> = {
  q1: { Right: 'rightQ2' },
  q1row2: { Up: 'q1', Right: 'rightQ2' },
  q1text: { Up: 'q1row2' },
  q1chat: { Up: 'q1text' },
  rightQ2: { Right: 'rightReview', Left: 'q1' },
  q2: { Right: 'review', Left: 'q1' },
  review: { Left: 'revisitQ2' },
  rightReview: { Left: 'rightQ2' },
  revisitQ2: { Left: 'revisitQ1', Right: 'review' },
  revisitQ1: { Right: 'revisitQ2' },
};

describe('parseAskTabs reads the tab row off a plain capture', () => {
  it('question 1 of 2 on 2.1.296: two tabs, neither answered', () => {
    expect(parseAskTabs(S.q1)).toEqual({
      tabs: [{ header: 'Water rota', answered: false }, { header: 'Table supply', answered: false }],
    });
  });

  it('question 2 after answering 1: ☒ then ☐; the review: both ☒', () => {
    expect(parseAskTabs(S.q2)!.tabs.map((t) => t.answered)).toEqual([true, false]);
    expect(parseAskTabs(S.review)!.tabs.map((t) => t.answered)).toEqual([true, true]);
  });

  it('2.1.302: a multiSelect question and a preview question paint the same row', () => {
    expect(parseAskTabs(pane('cc302-ask-multiselect-q2'))!.tabs.map((t) => t.header)).toEqual(['Pet', 'Toppings']);
    expect(parseAskTabs(pane('cc302-ask-preview-q2'))!.tabs.map((t) => t.header)).toEqual(['Lang', 'Layout']);
  });

  it('a one-question single-select ask paints no tab row: null', () => {
    expect(parseAskTabs(pane('cc300-ask-1q-open'))).toBeNull();
    expect(parseAskTabs(pane('ask-user-question-real'))).toBeNull();
  });

  it('a line that only looks like one is no tab row', () => {
    expect(parseAskTabs('←  go back  or on  →\n')).toBeNull();
    expect(parseAskTabs('←  ☐ A  ☐ B  →\n')).toBeNull();
    expect(parseAskTabs('←  ✔ Submit  →\n')).toBeNull();
  });
});

describe('isDialogTab', () => {
  it('takes the four targets, with from only as a tab number', () => {
    expect(isDialogTab({ dialogId: 'a', to: 'prev' })).toBe(true);
    expect(isDialogTab({ dialogId: 'a', to: 'submit' })).toBe(true);
    expect(isDialogTab({ dialogId: 'a', to: 2, from: 1 })).toBe(true);
    expect(isDialogTab({ dialogId: 'a', to: 0 })).toBe(false);
    expect(isDialogTab({ dialogId: 'a', to: 1.5 })).toBe(false);
    expect(isDialogTab({ dialogId: 'a', to: 'last' })).toBe(false);
    expect(isDialogTab({ dialogId: 'a', to: 2, from: '1' })).toBe(false);
    expect(isDialogTab({ dialogId: '', to: 'next' })).toBe(false);
    expect(isDialogTab(null)).toBe(false);
  });
});

describe('moveDialogTab moves the pane between tabs, and proves each step', () => {
  const graph = (start: keyof typeof S, opts?: { failCaptures?: number }) => paneGraph(start, S, MOVES, opts);

  it('→ from the last question: one Right, and the review comes back as next', async () => {
    const g = graph('q2');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q2'), to: 'next' });
    expect(res).toEqual({ ok: true, next: parseDialog(S.review) });
    expect(g.keys).toEqual(['Right']);
  });

  it('← from the review: the last question again, its answer marked ✔ (2.1.296)', async () => {
    const g = graph('review');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-review'), to: 'prev' });
    expect(res.ok && res.next.id).toBe(idOf('cc296-ask-2q-long-revisit-q2'));
    expect(res.ok && res.next.options[0]!.label).toMatch(/✔$/);
    expect(g.keys).toEqual(['Left']);
  });

  it('← on question 1 is Claude Code\'s no-op: one Left, then no-move', async () => {
    const g = graph('q1');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1'), to: 'prev' });
    expect(res).toEqual({ ok: false, error: 'no-move' });
    expect(g.keys).toEqual(['Left']);
  });

  it('→ on the review is an edge the server can see: no-move with no key at all', async () => {
    const g = graph('review');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-review'), to: 'next' });
    expect(res).toEqual({ ok: false, error: 'no-move' });
    expect(g.keys).toEqual([]);
  });

  it('the cursor on the free-text row: walks Up to row 1 first, since → is swallowed there, then Right', async () => {
    const g = graph('q1text');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1-on-text'), to: 'next' });
    expect(res.ok && res.next.id).toBe(idOf('cc296-ask-2q-long-right-q2'));
    expect(g.keys).toEqual(['Up', 'Up', 'Right']);
  });

  it('the cursor on Chat about this: the same walk, three Ups (→ is swallowed there too, measured)', async () => {
    const g = graph('q1chat');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1-on-chat'), to: 'next' });
    expect(res.ok && res.next.id).toBe(idOf('cc296-ask-2q-long-right-q2'));
    expect(g.keys).toEqual(['Up', 'Up', 'Up', 'Right']);
  });

  it('a walk that does not land on row 1: walk-failed, and no arrow across tabs', async () => {
    const g = paneGraph('q1text', S, { q1text: {} });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1-on-text'), to: 'next' });
    expect(res).toEqual({ ok: false, error: 'walk-failed' });
    expect(g.keys.filter((k) => k !== 'Up')).toEqual([]);
  });

  it('submit from question 1: Right until the review (the skipped-question warning one), never Enter', async () => {
    const g = graph('q1');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1'), to: 'submit' });
    expect(res.ok && res.next.id).toBe(idOf('cc296-ask-2q-long-right-review'));
    expect(g.keys).toEqual(['Right', 'Right']);
  });

  it('submit on the review: already there, nothing pressed', async () => {
    const g = graph('review');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-review'), to: 'submit' });
    expect(res).toEqual({ ok: true, next: parseDialog(S.review) });
    expect(g.keys).toEqual([]);
  });

  it('tab 1 from the review: the server knows where it is, so two Lefts, each proved', async () => {
    const g = graph('review');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-review'), to: 1 });
    expect(res.ok && res.next.id).toBe(idOf('cc296-ask-2q-long-revisit-q1'));
    expect(g.keys).toEqual(['Left', 'Left']);
  });

  it('tab 2 from tab 1 on a question: one Right', async () => {
    const g = graph('q1');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1'), to: 2, from: 1 });
    expect(res.ok && res.next.id).toBe(idOf('cc296-ask-2q-long-right-q2'));
    expect(g.keys).toEqual(['Right']);
  });

  it('the tab already up: ok with the screen, nothing pressed', async () => {
    const g = graph('q1');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1'), to: 1, from: 1 });
    expect(res).toEqual({ ok: true, next: parseDialog(S.q1) });
    expect(g.keys).toEqual([]);
  });

  it('a numbered target on a question with no from, or past the row: bad-request, nothing pressed', async () => {
    const g = graph('q1');
    const id = idOf('cc296-ask-2q-long-q1');
    expect(await moveDialogTab(deps(g.tmux), 'x', { dialogId: id, to: 2 })).toEqual({ ok: false, error: 'bad-request' });
    expect(await moveDialogTab(deps(g.tmux), 'x', { dialogId: id, to: 3, from: 1 }))
      .toEqual({ ok: false, error: 'bad-request' });
    expect(await moveDialogTab(deps(g.tmux), 'x', { dialogId: id, to: 'up' })).toEqual({ ok: false, error: 'bad-request' });
    expect(g.keys).toEqual([]);
  });

  it('a stale id: stale-dialog with no key sent', async () => {
    const g = graph('q2');
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1'), to: 'next' });
    expect(res).toEqual({ ok: false, error: 'stale-dialog' });
    expect(g.keys).toEqual([]);
  });

  it('a one-question ask paints no tabs: no-tabs, no key', async () => {
    const one = pane('cc300-ask-1q-open');
    const g = paneGraph('one', { one }, {});
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: parseDialog(one)!.id, to: 'next' });
    expect(res).toEqual({ ok: false, error: 'no-tabs' });
    expect(g.keys).toEqual([]);
  });

  it('the menu went away after the arrow: menu-gone', async () => {
    const g = paneGraph('q2', S, { q2: { Right: 'gone' } });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q2'), to: 'next' });
    expect(res).toEqual({ ok: false, error: 'menu-gone' });
  });

  it('a capture that fails up front: not-alive, no key', async () => {
    const g = graph('q2', { failCaptures: 1 });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q2'), to: 'next' });
    expect(res).toEqual({ ok: false, error: 'not-alive' });
    expect(g.keys).toEqual([]);
  });

  it('2.1.302 multiSelect question: → reaches the review (the ticks stay, measured)', async () => {
    const screens = { m: pane('cc302-ask-multiselect-q2'), r: pane('cc302-ask-multiselect-right-review') };
    const g = paneGraph('m', screens, { m: { Right: 'r' } });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: parseDialog(screens.m)!.id, to: 'next' });
    expect(res.ok && res.next.id).toBe(parseDialog(screens.r)!.id);
    expect(g.keys).toEqual(['Right']);
  });

  it('a multiSelect question with the cursor on its commit row: walked Up through the free-text box to box 1, then Right', async () => {
    // DERIVED: the real 2.1.302 capture (cursor on box 1) with its ❯ moved to the commit row, and to each box on the way
    // back up, as the 2.1.300 `walk-to-next` and `on-freetext` recordings draw it. → there is unmeasured; walking first
    // is safe, since Up only moves the cursor.
    const m = pane('cc302-ask-multiselect-q2');
    const box = (k: number): string => m.replace('❯ 1. [ ] Cheese', '  1. [ ] Cheese').replace(`  ${k}. [ ] `, `❯ ${k}. [ ] `);
    const commit = m.replace('❯ 1. [ ] Cheese', '  1. [ ] Cheese').replace(/^ {5}Submit$/m, '❯    Submit');
    const screens = { commit, b4: box(4), b3: box(3), b2: box(2), m, r: pane('cc302-ask-multiselect-right-review') };
    expect([commit, screens.b4, screens.b3, screens.b2, m].map((s) => parseDialog(s)!.multi!.cursor))
      .toEqual(['commit', 4, 3, 2, 1]);
    expect(parseDialog(screens.b4)!.multi!.options.some((o) => o.index === 4)).toBe(false);
    const g = paneGraph('commit', screens, {
      commit: { Up: 'b4' }, b4: { Up: 'b3' }, b3: { Up: 'b2' }, b2: { Up: 'm' }, m: { Right: 'r' },
    });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: parseDialog(commit)!.id, to: 'next' });
    expect(res.ok && res.next.id).toBe(parseDialog(screens.r)!.id);
    expect(g.keys).toEqual(['Up', 'Up', 'Up', 'Up', 'Right']);
  });

  it('a walk Up that lands on another question\'s screen: walk-failed, and no Left or Right at all', async () => {
    // The landing is proved by the question's title as well as the cursor: question 2's screen with its cursor on row 1
    // is not question 1's row 1, so nothing is pressed across tabs from it.
    const g = paneGraph('q1text', S, { q1text: { Up: 'rightQ2' } });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: idOf('cc296-ask-2q-long-q1-on-text'), to: 'next' });
    expect(res).toEqual({ ok: false, error: 'walk-failed' });
    expect(g.keys).toEqual(['Up']);
  });

  it('2.1.302 preview question (no free-text row, unnumbered Chat): → reaches the review', async () => {
    const screens = { p: pane('cc302-ask-preview-q2'), r: pane('cc302-ask-preview-right-review') };
    const g = paneGraph('p', screens, { p: { Right: 'r' } });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: parseDialog(screens.p)!.id, to: 'next' });
    expect(res.ok && res.next.id).toBe(parseDialog(screens.r)!.id);
    expect(g.keys).toEqual(['Right']);
  });

  it('a preview question with the cursor on its unnumbered Chat row: walked Up to row 1 before Right', async () => {
    // DERIVED: no recording has the cursor on a preview's Chat row, so this one moves the real cursor-on-2 capture's ❯
    // there. Whether 2.1.302 swallows → on that row is unmeasured (it does on the numbered Chat row, 2.1.296); walking
    // Up first is safe either way, since Up only moves the cursor.
    const row2 = pane('cc302-ask-preview-q2-row2');
    const chat = row2.replace('❯ 2. List', '  2. List').replace(/^  Chat about this$/m, '❯ Chat about this');
    const screens = { chat, row2, row1: pane('cc302-ask-preview-q2'), r: pane('cc302-ask-preview-right-review') };
    expect(parseDialog(chat)!.options.at(-1)!.label).toBe('Chat about this');
    expect(parseDialog(chat)!.selectedIndex).toBe(3);
    const g = paneGraph('chat', screens, { chat: { Up: 'row2' }, row2: { Up: 'row1' }, row1: { Right: 'r' } });
    const res = await moveDialogTab(deps(g.tmux), 'x', { dialogId: parseDialog(chat)!.id, to: 'next' });
    expect(res.ok && res.next.id).toBe(parseDialog(screens.r)!.id);
    expect(g.keys).toEqual(['Up', 'Up', 'Right']);
  });

  it('no tab move ever presses Enter, Tab or a digit, whatever the target', async () => {
    const all: string[] = [];
    for (const [start, to] of [['q1', 'submit'], ['q1text', 'next'], ['review', 1], ['q1', 'prev']] as const) {
      const g = graph(start);
      await moveDialogTab(deps(g.tmux), 'x', { dialogId: parseDialog(S[start])!.id, to });
      all.push(...g.keys);
    }
    expect(new Set(all)).toEqual(new Set(['Left', 'Right', 'Up']));
  });
});
