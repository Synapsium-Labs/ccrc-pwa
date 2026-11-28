// Every client place that SUMMARISES a Waiting-on-you item calls the one plain-text projection `itemPlainText`
// (`shared/itemText.ts`). Fix round 1 of desktop-polish wave 186, F5, review 4189: no test went red when a call was replaced by
// the raw value. One case per surface (S1 to S6), each with Markdown in the title, the why and the send-back note, asserting the
// plain words and that no mark survives in that surface's text; S2b is F6, an item with an action keeps its why's lines, each
// line projected. Every fixture is invented (Programme A, project-a, example.com).
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endRunAction } from '../../shared/ledgers';
import { api } from '../src/lib/api';
import { ItemListColumn, ItemRouteAt } from '../src/ledgers/WaitingRoutes';
import { ProgrammeScreen } from '../src/ledgers/ProgrammeScreen';
import { WaitingScreen } from '../src/ledgers/WaitingScreen';
import { createFleetStore } from '../src/stores/fleet';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';

const MD_TITLE = 'Run `ccrc doctor` **now** [the spec](https://example.com/s)';
const PLAIN_TITLE = 'Run ccrc doctor now the spec';
const MD_WHY = 'It `piles` up **until** [then](https://example.com/w)';
const PLAIN_WHY = 'It piles up until then';
const MD_NOTE = 'Fix `the flag` **first** [see](https://example.com/n)';
const PLAIN_NOTE = 'Fix the flag first see';

/** No Markdown mark survives in a surface's text. */
const noMarks = (text: string | null | undefined): void => {
  expect(text ?? '').not.toContain('`');
  expect(text ?? '').not.toContain('**');
  expect(text ?? '').not.toContain('[');
  expect(text ?? '').not.toContain('](');
};

const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;
const mk = () => createFleetStore({ makeSocket });

beforeEach(() => { window.localStorage.clear(); vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

const showList = (view: ReturnType<typeof waitingView>): void => {
  render(<WaitingScreen view={view} sessions={[]} runs={[]} now={NOW} onOpenItem={vi.fn()} onOpenSession={vi.fn()} />);
};
const markdownItem = (over: Parameters<typeof itemView>[0] = {}) =>
  itemView({ id: 5, title: MD_TITLE, why: MD_WHY, history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }, { at: NOW - 5 * MIN, act: 'return', note: MD_NOTE }], ...over });

describe('every summary of an item is its plain text (fix round 1, F5 and F6)', () => {
  it('S1 the row title', () => {
    showList(waitingView({ items: [markdownItem()] }));
    const what = document.querySelector('.wl-what');
    expect(what?.textContent).toBe(PLAIN_TITLE);
    noMarks(what?.textContent);
  });

  it('S2 the row why, for an item without an action', () => {
    showList(waitingView({ items: [markdownItem()] }));
    const why = document.querySelector('.wl-why');
    expect(why?.textContent).toBe(PLAIN_WHY);
    noMarks(why?.textContent);
  });

  it('S2b the row why of an item WITH an action keeps its lines, each projected (F6)', () => {
    const item = markdownItem({ why: 'Stop the run: `prog-a-w1` is **done**\nSee [the note](https://example.com/n)', action: endRunAction(7, null) });
    showList(waitingView({ items: [item] }));
    const why = document.querySelector('.wl-why');
    expect(why?.textContent).toBe('Stop the run: prog-a-w1 is done\nSee the note');
    noMarks(why?.textContent);
  });

  it('S3 the send-back line', () => {
    showList(waitingView({ items: [markdownItem()] }));
    const bounce = document.querySelector('.wl-bounce');
    expect(bounce?.textContent).toBe(`The coordinator sent it back: ${PLAIN_NOTE}`);
    noMarks(bounce?.textContent);
  });

  it('S4 the cleared row\'s struck title', () => {
    showList(waitingView({ cleared: [markdownItem({ state: 'done', closedAt: NOW - 60 * MIN })] }));
    const trail = screen.getByRole('region', { name: 'Recently cleared' });
    const struck = trail.querySelector('s');
    expect(struck?.textContent).toBe(PLAIN_TITLE);
    noMarks(struck?.textContent);
  });

  it('S5 the item navigation\'s live region', () => {
    const soon = (id: number, over: Parameters<typeof itemView>[0] = {}) =>
      itemView({ id, program: 'prog-a', neededBy: 'soon', title: `Item ${id}`, raisedAt: NOW - (100 - id) * MIN, ...over });
    const store = mk();
    act(() => store.setState({ fleetFrameSeen: true, sessions: [], waiting: waitingView({ items: [soon(10), soon(11, { title: MD_TITLE }), soon(12)] }) }));
    history.replaceState(null, '', '/waiting/11');
    render(<><ItemListColumn param="11" store={store} fleet={<section aria-label="Fleet stand-in" />} /><ItemRouteAt param="11" store={store} /></>);
    const strip = screen.getByRole('navigation', { name: 'Between items' });
    const live = within(strip).getByRole('status');
    expect(live.textContent).toBe(`2 of 3, ${PLAIN_TITLE}`);
    noMarks(live.textContent);
  });

  it('S6 the secret\'s asked-by line on the programme page', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: { program: 'prog-a', specPath: 'docs/superpowers/specs/2026-10-31-prog-a-design.md', inShort: 'A console view.', inShortAt: NOW, modifications: [] } as never });
    vi.spyOn(api, 'plan').mockResolvedValue({ ok: true, plan: { program: 'prog-a', planned: true, initiatives: [], epics: [], doneWhen: [] } as never });
    vi.spyOn(api, 'storedSecrets').mockResolvedValue({ ok: true, program: 'prog-a', slots: [{ slot: 'api-key', setAt: Date.now() - 3 * 60 * MIN, item: { id: 9, title: MD_TITLE } }] });
    const store = mk();
    act(() => store.setState({ fleetFrameSeen: true, runsFrameSeen: true, sessions: [], runs: [runRow({ id: 1, program: 'prog-a', programTitle: 'Programme A', homeProject: 'project-a' } as never)], waiting: waitingView() }));
    render(<ProgrammeScreen slug="prog-a" store={store} secrets={{ read: async () => ({ ok: true, program: 'prog-a', slots: [{ slot: 'api-key', setAt: Date.now() - 3 * 60 * MIN, item: { id: 9, title: MD_TITLE } }] }) }} />);
    const section = await screen.findByRole('region', { name: /stored/i });
    const asker = section.querySelector('.pv-secret-asker');
    expect(asker?.textContent).toContain(PLAIN_TITLE);
    noMarks(asker?.textContent);
  });
});
