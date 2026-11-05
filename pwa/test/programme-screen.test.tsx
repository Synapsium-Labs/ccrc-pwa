// The programme view (desktop-polish PL5b, D-7713; spec section 3, the prototype's view 2): Goals on one side, this
// programme's share of the Waiting on you list on the other. `ProgrammeScreen` reads the fleet store (the list, the fleet's
// sessions and runs), asks the server for the programme's Goals, and navigates; the panels it draws take props only
// (`goals-panel.test.tsx`). The store is the test's own, the programme `prog-a`, the project `project-a`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GoalsView, StoredSecretsAnswer } from '../../shared/ledgers';
import { WAITS_ON_WORDS } from '../../shared/ledgers';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { PROGRAM_SLUG_MAX_CHARS } from '../../shared/api';
import { ROUTES, isProgrammeSlug, matchRoute, programmeIsOpenable, programmePath, shellViewOf, topRouteOf } from '../src/lib/routes';
import { ProgrammeScreen } from '../src/ledgers/ProgrammeScreen';
import { STORED_TEXT, type RemoveSecret } from '../src/ledgers/ItemView';
import { itemPath } from '../src/ledgers/WaitingRoutes';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { effectiveValue, stripComments } from './cssRule';

const SPEC = 'docs/superpowers/specs/2026-10-31-prog-a-design.md';
const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;
const mk = () => createFleetStore({ makeSocket });

const goals = (over: Partial<GoalsView> = {}): GoalsView => ({
  program: 'prog-a', specPath: SPEC, inShort: 'A console view of what the programme is building.',
  inShortAt: NOW - 3 * 24 * 60 * MIN, modifications: [], ...over,
});
const live = [runRow({ id: 1, program: 'prog-a', state: 'working', wave: 2, waveOf: 5, programTitle: 'Programme A', homeProject: 'project-a' } as never)];

/** A store that has heard the fleet, the runs and a list. */
function heard(over: Partial<ReturnType<ReturnType<typeof mk>['getState']>> = {}) {
  const store = mk();
  act(() => store.setState({ fleetFrameSeen: true, runsFrameSeen: true, sessions: [], runs: live, waiting: waitingView(), ...over }));
  return store;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals() });
  vi.spyOn(api, 'storedSecrets').mockResolvedValue({ ok: true, program: 'prog-a', slots: [] });
  history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

describe('the programme route', () => {
  it('matches /programmes/<slug> with the slug as its param, and nothing near it', () => {
    const at = matchRoute('/programmes/prog-a');
    expect(at?.route.id).toBe('programme');
    expect(at?.param).toBe('prog-a');
    expect(matchRoute('/programmes/prog-a/')?.param).toBe('prog-a');
    for (const bad of ['/programmes', '/programmes/', '/programmes/a/b', '/programmesx/a', '/programme/a']) {
      expect(matchRoute(bad)?.route.id, bad).not.toBe('programme');
    }
  });

  it('takes the owner\'s slug grammar (`shapeProgramSlug`): upper case, underscores and a leading dash are programme slugs too', () => {
    for (const slug of ['Build_4', 'pA', 'Prog-A', '-a', 'build_4-name', 'a1-b2']) {
      expect(isProgrammeSlug(slug), slug).toBe(true);
      expect(programmeIsOpenable(slug), slug).toBe(true);
      expect(matchRoute(programmePath(slug))?.route.id, slug).toBe('programme');
      expect(matchRoute(programmePath(slug))?.param, slug).toBe(slug);
    }
  });

  it('refuses what the owner refuses: a dot, a space, a slash, an empty slug or one past the length cap', () => {
    for (const slug of ['a.b', 'a b', 'a/b', ' a', 'a ', '', 'é', 'a'.repeat(PROGRAM_SLUG_MAX_CHARS + 1)]) {
      expect(isProgrammeSlug(slug), JSON.stringify(slug)).toBe(false);
      expect(programmeIsOpenable(slug), JSON.stringify(slug)).toBe(false);
    }
    expect(isProgrammeSlug('a'.repeat(PROGRAM_SLUG_MAX_CHARS))).toBe(true);
  });

  // Carry C (D-7951), review 1388 F1: a slug the owner refuses is no route, so a phone shows the fleet rather than a blank
  // pane (`shell.css` hides both the fleet column and the placeholder under `[data-view='session']` below 900).
  it('a slug the owner refuses is no route at all: matchRoute answers null, and the frame\'s view is the fleet', () => {
    const tooLong = 'a'.repeat(PROGRAM_SLUG_MAX_CHARS + 1);
    for (const path of ['/programmes/a.b', '/programmes/a.b/', '/programmes/a%20b', '/programmes/%20a', '/programmes/%C3%A9', `/programmes/${tooLong}`]) {
      // The row's own pattern takes the path, so the null below is the row's `accepts` refusing it, and nothing else (review 1437
      // A3: the `topRouteOf` null this case asserted held with or without that fix, since the programme row is no place).
      expect(ROUTES.find((r) => r.id === 'programme')!.pattern.test(path), path).toBe(true);
      expect(matchRoute(path), path).toBeNull();
      expect(shellViewOf(path), path).toBe('fleet');
    }
    expect(shellViewOf('/programmes/prog-a')).toBe('session');
  });

  // Carry C (D-7951), review 1388 F3: `decodeURIComponent` throws on a malformed escape, and `App` calls `matchRoute` in its own
  // body, outside every boundary but the root's. One guard: such a path is no route, on every row that captures a segment.
  it('a malformed percent escape is no route, and matchRoute never throws on one', () => {
    for (const path of ['/programmes/%zz', '/programmes/%', '/programmes/%E0%A4%A', '/s/%zz', '/s/%', '/settings/%zz']) {
      expect(() => matchRoute(path), path).not.toThrow();
      expect(matchRoute(path), path).toBeNull();
      expect(shellViewOf(path), path).toBe('fleet');
      // Under no place either: the rail and the phone's bar mark nothing current where the pane draws the placeholder (review
      // 1437 F2: `/settings/%zz` was under Settings by `topRouteOf`'s prefix fallback).
      expect(topRouteOf(path), path).toBeNull();
    }
  });

  // Carry C (D-7951), review 1388's advisory: the grammar is asked before the slug is encoded, so a string `encodeURIComponent`
  // refuses (a lone surrogate) is refused, never thrown during the box's render.
  it('programmeIsOpenable asks the grammar before it encodes: a lone surrogate is refused, never thrown', () => {
    expect(() => programmeIsOpenable('\uD800')).not.toThrow();
    expect(programmeIsOpenable('\uD800')).toBe(false);
    expect(programmeIsOpenable('a\uDC00b')).toBe(false);
  });

  it('is a page under the fleet, not a place of its own: no tab, and no "Go to" command', () => {
    const row = ROUTES.find((r) => r.id === 'programme')!;
    expect(row.top).toBe(false);
    expect(row.path).toBeNull();
    expect(row.title).toBe('Programme');
  });

  it('programmePath is the one builder of that path, and the route parses what it builds', () => {
    expect(programmePath('prog-a')).toBe('/programmes/prog-a');
    expect(matchRoute(programmePath('prog-a'))?.param).toBe('prog-a');
    expect(matchRoute(programmePath('a1-b2'))?.param).toBe('a1-b2');
  });
});

describe('the programme view: the head', () => {
  it('names the programme, its wave and a way back to the fleet', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Programme A' })).toBeTruthy();
    expect(screen.getByText('wave 2 of 5')).toBeTruthy();
    history.replaceState(null, '', '/programmes/prog-a');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Fleet' }));
    expect(location.pathname).toBe('/');
  });

  // Carry C (D-7951), review 1386 F12: the "wave N of M" template is spelled once (`waveOfWords`, the work-wave half of
  // `programmeWaveTail`), and the programme's head and its group on the combined list both read it.
  it('the "wave N of M" template is spelled once in pwa/src, in runWords.ts', () => {
    const root = path.join(__dirname, '../src');
    const holders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const n = readFileSync(p, 'utf8').match(/wave \$\{[^}]+\} of \$\{/g)?.length ?? 0;
          for (let i = 0; i < n; i++) holders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(holders).toEqual(['fleet/runWords.ts']);
  });

  it('says the programme has no open run once, in the card, and not before the runs have been heard', () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'done' })] });
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByText('Nothing needs you. The programme has no open run.')).toBeTruthy();
    // Once: the header does not say it again, and the words' fragment ("Waiting on: nothing: …") is not in the card.
    expect(view.container.textContent!.split('has no open run').length - 1).toBe(1);
    expect(view.container.querySelector('.pv-head')!.textContent).not.toContain('no open run');
    expect(view.container.textContent).not.toContain('Waiting on:');
    view.unmount();
    const unheard = render(<ProgrammeScreen slug="prog-a" store={heard({ runsFrameSeen: false, runs: [] })} />);
    expect(unheard.container.textContent).not.toContain('no open run');
  });
});

// Desktop-polish PL10 (D-7952; spec §2, D26): the programme's pinned spec is one tap away from its head, at the address Goals
// builds (`specHref`, the one builder), and no link is drawn while the programme has no pin.
describe('the programme view: the spec one tap away', () => {
  it('the programme head links the pinned spec, at the address Goals builds', async () => {
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    const head = document.querySelector<HTMLElement>('.pv-head')!;
    const link = await within(head).findByRole('link', { name: 'Spec for Programme A' });
    expect(link.textContent).toBe('Spec');
    expect(link.getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
    expect(screen.getByRole('link', { name: 'Open the spec in Docs' }).getAttribute('href')).toBe(link.getAttribute('href'));
    fireEvent.click(link);
    expect(location.pathname).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
  });

  it('no spec link is drawn without a pin, or without a home project', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ specPath: null, inShort: null, inShortAt: null }) });
    const view = render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(await screen.findByText('No spec is pinned yet.')).toBeTruthy();
    expect(within(view.container.querySelector<HTMLElement>('.pv-head')!).queryByRole('link')).toBeNull();
    // Not even as words: a link with no address is no `link` role, so the words are what a dead "Spec" leaves (review 1466 F15).
    expect(within(view.container.querySelector<HTMLElement>('.pv-head')!).queryByText('Spec')).toBeNull();
    view.unmount();
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals() });
    const homeless = render(<ProgrammeScreen slug="prog-a" store={heard({ runs: [runRow({ id: 1, program: 'prog-a', homeProject: null } as never)] })} />);
    expect(await screen.findByText('A console view of what the programme is building.')).toBeTruthy();
    expect(within(homeless.container.querySelector<HTMLElement>('.pv-head')!).queryByRole('link')).toBeNull();
    expect(within(homeless.container.querySelector<HTMLElement>('.pv-head')!).queryByText('Spec')).toBeNull();
  });
});

describe('the programme view: Goals', () => {
  it('asks the server for this programme\'s Goals and draws them, the spec link in the programme\'s home project', async () => {
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(await screen.findByText('A console view of what the programme is building.')).toBeTruthy();
    expect(api.goals).toHaveBeenCalledWith('prog-a');
    const link = screen.getByRole('link', { name: 'Open the spec in Docs' });
    expect(link.getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
  });

  it('builds no spec link when no run of the programme names a home project', async () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'working', homeProject: null } as never)] });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(await screen.findByText('A console view of what the programme is building.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open the spec in Docs' })).toBeNull();
  });

  it('draws the Goals the list already carries while the read is on the wire, and the frame\'s copy stays the one drawn after the answer', async () => {
    let release!: (v: { ok: true; goals: GoalsView }) => void;
    vi.spyOn(api, 'goals').mockReturnValue(new Promise((r) => { release = r; }));
    const store = heard({ waiting: waitingView({ goals: [goals({ inShort: 'The list\'s copy.' })] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByText('The list\'s copy.')).toBeTruthy();
    await act(async () => { release({ ok: true, goals: goals({ inShort: 'The older read.' }) }); });
    expect(screen.getByText('The list\'s copy.')).toBeTruthy();
    expect(screen.queryByText('The older read.')).toBeNull();
  });

  it('a new frame after the answer changes what is drawn: a merged change stops reading pending, a new pin replaces "In short"', async () => {
    const pending = { id: 1, at: NOW - MIN, text: 'Added a ledger', ruling: null, itemId: null, pr: 12, merged: false };
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ inShort: 'The read.', modifications: [pending] }) });
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    // The frame lists no Goals for this programme, so the answer is what is drawn.
    expect(await screen.findByText('The read.')).toBeTruthy();
    expect(screen.getByText(/spec update pending \(PR #12\)/)).toBeTruthy();
    // The coordinator marks the change merged and pins a new summary: the frame is re-sent, and the frame's text is drawn.
    act(() => store.setState({ waiting: waitingView({ goals: [goals({ inShort: 'The frame after the merge.', modifications: [{ ...pending, merged: true }] })] }) }));
    expect(screen.getByText('The frame after the merge.')).toBeTruthy();
    expect(screen.queryByText('The read.')).toBeNull();
    expect(screen.queryByText(/spec update pending/)).toBeNull();
  });

  it('draws THIS programme\'s entry of the frame, never the first: another programme\'s Goals listed first are not shown', async () => {
    const other = goals({ program: 'prog-0', inShort: 'Another programme\'s summary.' });
    const mine = goals({ inShort: 'This programme\'s own copy.' });
    vi.spyOn(api, 'goals').mockReturnValue(new Promise(() => {}));
    const store = heard({ waiting: waitingView({ goals: [other, mine] }) });
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByText('This programme\'s own copy.')).toBeTruthy();
    expect(screen.queryByText('Another programme\'s summary.')).toBeNull();
    view.unmount();
    // A frame that lists only another programme's Goals: this one reads (pending) or says it could not be read, never the other's.
    const only = heard({ waiting: waitingView({ goals: [other] }) });
    render(<ProgrammeScreen slug="prog-a" store={only} />);
    expect(screen.getByText('Reading Goals…')).toBeTruthy();
    expect(screen.queryByText('Another programme\'s summary.')).toBeNull();
  });

  it('with another programme\'s Goals first in the frame and the read failed, it says the read failed, never the other\'s', async () => {
    vi.spyOn(api, 'goals').mockRejectedValue(new TypeError('offline'));
    const other = goals({ program: 'prog-0', inShort: 'Another programme\'s summary.' });
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ goals: [other] }) })} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Goals could not be read.');
    expect(screen.queryByText('Another programme\'s summary.')).toBeNull();
  });

  it('draws only a view that is this programme\'s: another programme\'s answer is a failed read', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ program: 'prog-b', inShort: 'Another programme\'s summary.' }) });
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Goals could not be read.');
    expect(screen.queryByText('Another programme\'s summary.')).toBeNull();
  });

  // Carry C (D-7951), review 1386 F6: the read resets when the slug changes, so a mount that is not keyed by the slug never
  // draws one programme's Goals under another's name.
  it('a new slug on the same mount resets the read: the old programme\'s Goals are never drawn under the new name', async () => {
    const answer: Record<string, (v: { ok: true; goals: GoalsView }) => void> = {};
    vi.spyOn(api, 'goals').mockImplementation((slug: string) => new Promise((r) => { answer[slug] = r; }));
    const store = heard();
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    await act(async () => { answer['prog-a']!({ ok: true, goals: goals({ inShort: 'The first programme\'s summary.' }) }); });
    expect(screen.getByText('The first programme\'s summary.')).toBeTruthy();
    view.rerender(<ProgrammeScreen slug="prog-b" store={store} />);
    expect(screen.queryByText('The first programme\'s summary.')).toBeNull();
    expect(screen.getByText('Reading Goals…')).toBeTruthy();
    await act(async () => { answer['prog-b']!({ ok: true, goals: goals({ program: 'prog-b', inShort: 'The second programme\'s summary.' }) }); });
    expect(screen.getByText('The second programme\'s summary.')).toBeTruthy();
  });

  // Carry C (D-7951), review 1386 F8: the frame's copy is shape-checked as the fetched one is (`isGoalsFor`), so an entry the
  // panel cannot read is not drawn, and the fetched copy is.
  it('a frame entry that is not a Goals view is not drawn: the fetched copy is, and nothing throws', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ inShort: 'The fetched copy.' }) });
    const broken = { program: 'prog-a', specPath: null, inShort: 'A broken frame copy.', inShortAt: null } as unknown as GoalsView;
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ goals: [broken] }) })} />);
    expect(await screen.findByText('The fetched copy.')).toBeTruthy();
    expect(screen.queryByText('A broken frame copy.')).toBeNull();
  });

  it('says it is reading until Goals arrive, never "no spec is pinned yet"', async () => {
    vi.spyOn(api, 'goals').mockReturnValue(new Promise(() => {}));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(screen.getByText('Reading Goals…')).toBeTruthy();
    expect(screen.queryByText('No spec is pinned yet.')).toBeNull();
  });

  it('a failed read with no copy to show says so, and keeps the rest of the view', async () => {
    vi.spyOn(api, 'goals').mockRejectedValue(new ApiError(500, { ok: false, error: 'boom' }));
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items: [itemView({ id: 4, title: 'Pick the order' })] }) })} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Goals could not be read.');
    expect(screen.getByRole('link', { name: '1 waiting on you' })).toBeTruthy();
  });

  it('a failed read leaves the list\'s copy on screen', async () => {
    vi.spyOn(api, 'goals').mockRejectedValue(new TypeError('offline'));
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ goals: [goals({ inShort: 'The list\'s copy.' })] }) })} />);
    await waitFor(() => expect(api.goals).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('The list\'s copy.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a modification that came from an item links to it only while the list still holds that item', async () => {
    const mods = [
      { id: 2, at: NOW - MIN, text: 'Dropped the old flag', ruling: null, itemId: 7, pr: null, merged: true },
      { id: 1, at: NOW - 2 * MIN, text: 'Added a ledger', ruling: null, itemId: 8, pr: null, merged: true },
    ];
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ modifications: mods }) });
    const store = heard({ waiting: waitingView({ cleared: [itemView({ id: 7, state: 'done', closedAt: NOW })] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByText('Dropped the old flag');
    const links = screen.getAllByRole('link', { name: 'Open the item' });
    expect(links).toHaveLength(1); // item 8 is no longer on the list: no link to a page that says so
    // The link names the one Waiting on you list, filtered to this programme, so the item steps along it, and its way back is
    // this Goals page (plan PL9; PL11, D-7986: the programme page draws no list of its own; review 1537 F2, keeping 1402's F3).
    expect(links[0]!.getAttribute('href')).toBe(itemPath(7, { at: 'waiting', programme: 'prog-a', back: 'goals' }));
    fireEvent.click(links[0]!);
    expect(location.pathname).toBe(itemPath(7));
    expect(new URLSearchParams(location.search).get('from')).toBe('goals:prog-a');
  });
});

// ONE WAITING ON YOU PAGE (desktop-polish PL11, D-7986; spec §2, D29): the programme page is the programme's Goals page. It
// draws no list of its own; it says how many things wait on the operator as a link to the one list, filtered to the programme.
describe('the Goals page: no list of its own, a link to the filtered list', () => {
  const items = [
    itemView({ id: 1, program: 'prog-a', title: 'Pick the order', neededBy: 'blocking' }),
    itemView({ id: 2, program: 'prog-a', title: 'Switch it on' }),
    itemView({ id: 3, program: 'prog-a', title: 'Being checked', state: 'checking', tickedAt: NOW - MIN }),
    itemView({ id: 4, program: 'prog-b', title: 'Another programme\'s item' }),
  ];

  it('the programme page draws no list of its own and links the filtered list', () => {
    const cleared = [itemView({ id: 20, program: 'prog-a', state: 'done', title: 'Approve v6', closedAt: NOW - 60 * MIN })];
    const view = render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items, cleared }) })} />);
    const card = screen.getByRole('region', { name: 'Waiting on you' });
    expect(within(card).queryAllByRole('listitem')).toEqual([]);
    expect(view.container.querySelectorAll('.wl-item')).toHaveLength(0);
    for (const t of ['Pick the order', 'Switch it on', 'Being checked', 'Another programme\'s item', 'Approve v6']) expect(screen.queryByText(t)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recently cleared' })).toBeNull();
    const link = within(card).getByRole('link', { name: '2 waiting on you' });
    expect(link.getAttribute('href')).toBe('/waiting?programme=prog-a');
    fireEvent.click(link);
    expect(location.pathname + location.search).toBe('/waiting?programme=prog-a');
  });

  it('counts a session\'s question of this programme beside the items: the chip\'s number', () => {
    const asker = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'Keep the old flag?', bucketSince: NOW - 6 * MIN });
    const runs = [runRow({ id: 1, program: 'prog-a', state: 'working', sessionId: 'project-a-ask', claimedBy: 'project-a-coord' })];
    const store = heard({ sessions: withRunBinding([asker], runs), runs, waiting: waitingView({ items: [items[0]!] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByRole('link', { name: '2 waiting on you' })).toBeTruthy();
    expect(screen.queryByText('Keep the old flag?')).toBeNull();
  });

  it('draws no link while nothing waits on the operator: the waits-on sentence says why instead', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items: [items[2]!, items[3]!] }) })} />);
    expect(screen.queryByRole('link', { name: /waiting on you/ })).toBeNull();
    expect(screen.getByText(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.work}`)).toBeTruthy();
  });
});

describe('the programme view: when nothing needs the operator', () => {
  const says = (store: ReturnType<typeof mk>): string => {
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    const text = screen.getByRole('region', { name: 'Waiting on you' }).textContent ?? '';
    view.unmount();
    return text;
  };

  it('with no open item it reads "Nothing needs you. Waiting on: <what the programme is waiting on>"', () => {
    const runs = (state: 'working' | 'awaiting-review' | 'merging' | 'planned') => [runRow({ id: 1, program: 'prog-a', state })];
    expect(says(heard({ runs: runs('working') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.work}`);
    expect(says(heard({ runs: runs('awaiting-review') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.review}`);
    expect(says(heard({ runs: runs('merging') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS['merge-queue']}`);
    expect(says(heard({ runs: runs('planned') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS['next-wave']}`);
  });

  it('reads only this programme\'s runs: another programme\'s working run changes nothing', () => {
    const store = heard({ runs: [
      runRow({ id: 1, program: 'prog-a', state: 'planned' }), runRow({ id: 2, program: 'prog-b', state: 'working' }),
      runRow({ id: 3, program: 'prog-c', state: 'awaiting-review' }),
    ] });
    expect(says(store)).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS['next-wave']}`);
  });

  it('a programme with no open run says that, in the same sentence', () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'done' })] });
    expect(says(store)).toContain('Nothing needs you. The programme has no open run.');
  });

  it('an item the coordinator is checking is not the operator\'s: the sentence stands, and the page lists no item', () => {
    const checking = itemView({ id: 3, program: 'prog-a', title: 'Being checked', state: 'checking', tickedAt: NOW - MIN });
    const store = heard({ waiting: waitingView({ items: [checking] }) });
    const text = says(store);
    expect(text).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.work}`);
    expect(text).not.toContain('Being checked');
  });

  it('says nothing of what the programme waits on while an item waits on the operator', () => {
    const store = heard({ waiting: waitingView({ items: [itemView({ id: 1, program: 'prog-a' })] }) });
    expect(says(store)).not.toMatch(/Nothing needs you|Waiting on:/);
  });

  it('before the runs frame it says "Nothing needs you." and names nothing it has not heard', () => {
    const text = says(heard({ runsFrameSeen: false, runs: [] }));
    expect(text).toContain('Nothing needs you.');
    expect(text).not.toContain('Waiting on:');
  });

  it('before the first list it says it is waiting, never that nothing needs the operator', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: null })} />);
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    expect(screen.queryByText(/Nothing needs you/)).toBeNull();
    // Goals do not wait on the list: they come from their own read.
    expect(screen.getByRole('region', { name: 'Goals' })).toBeTruthy();
  });
});

describe('the programme screen\'s Stored secrets (the operator\'s ruling on programme item 9)', () => {
  const SECRET_VALUE_TAIL = 'zz99';
  const answerOf = (slots: StoredSecretsAnswer['slots']): StoredSecretsAnswer => ({ ok: true, program: 'prog-a', slots });
  const stepUpDeps = {
    client: {
      stepUpStart: async () => ({ challengeB64url: 'AQID', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] }),
      stepUpFinish: async () => { throw new Error('no passkey in this test'); },
      stepUpPassphrase: async () => ({ ok: true, stepUpFreshUntil: Date.now() + 300_000 }),
    } as never,
  };

  it('is not shown when the programme has no stored secret', async () => {
    const read = vi.fn(async () => answerOf([]));
    render(<ProgrammeScreen slug="prog-a" store={heard()} secrets={{ read }} />);
    await waitFor(() => expect(read).toHaveBeenCalledWith('prog-a'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: STORED_TEXT.heading })).toBeNull();
  });

  it('lists each slot by name, when it was saved and the item that asked for it, never any part of the value, with a Remove', async () => {
    const read = vi.fn(async () => answerOf([
      { slot: 'api-key', setAt: Date.now() - 3 * 60 * MIN, item: { id: 9, title: 'Give the service key' } },
      { slot: 'old-one', setAt: null, item: null },
    ]));
    render(<ProgrammeScreen slug="prog-a" store={heard()} secrets={{ read }} />);
    const section = await screen.findByRole('region', { name: STORED_TEXT.heading });
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-slot'))).toEqual(['api-key', 'old-one']);
    expect(rows[0]!.textContent).toContain('api-key');
    expect(rows[0]!.textContent).toContain('Saved 3h ago');
    expect(rows[0]!.textContent).toContain(STORED_TEXT.askedBy('Give the service key'));
    expect(rows[1]!.textContent).toContain(STORED_TEXT.savedAt(null));
    expect(rows[1]!.textContent).toContain(STORED_TEXT.askedBy(null));
    expect(within(section).getAllByRole('button', { name: /Remove the stored secret/ })).toHaveLength(2);
    expect(section.textContent).not.toContain(SECRET_VALUE_TAIL);
  });

  it('a row\'s name, saved-when and asking item are separate parts, each with its rule, and a Remove\'s refusal and Removed are tinted (review 1416 F5)', async () => {
    const read = vi.fn(async () => answerOf([{ slot: 'api-key', setAt: Date.now() - 3 * 60 * MIN, item: { id: 9, title: 'Give the service key' } }]));
    render(<ProgrammeScreen slug="prog-a" store={heard()} secrets={{ read }} />);
    const section = await screen.findByRole('region', { name: STORED_TEXT.heading });
    const row = within(section).getByRole('listitem');
    // The section carries the class every row rule is scoped to (review 1418 A3): renamed, each .pv-secrets rule would be dead.
    expect(row.closest('.pv-secrets')).toBe(section);
    // Three elements, never one run of text: "api-keySaved 3h agoAsked for by: …" was the unstyled row (review 1416 F5).
    const parts = ['.pv-secret-name', '.pv-secret-when', '.pv-secret-asker'].map((c) => row.querySelector(c));
    expect(parts.map((p) => p?.textContent)).toEqual(['api-key', 'Saved 3h ago', STORED_TEXT.askedBy('Give the service key')]);
    // …and each class the row draws has its rule in ledgers.css (vitest loads no stylesheet, so the rule is read as text).
    const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'ledgers', 'ledgers.css'), 'utf8'));
    expect(effectiveValue(css, '.pv-secrets .pv-secret', 'display')).toBe('grid');
    expect(effectiveValue(css, '.pv-secrets .pv-secret-name', 'font')).toContain('var(--family-mono)');
    for (const sel of ['.pv-secrets .pv-secret-when', '.pv-secrets .pv-secret-asker']) expect(effectiveValue(css, sel, 'color'), sel).toBe('var(--ink-secondary)');
    expect(effectiveValue(css, '.pv-secrets .wi-refusal', 'background')).toBe('var(--status-dead-tint-solid)');
    expect(effectiveValue(css, '.pv-secrets .wi-status', 'background')).toBe('var(--accent-tint)');
    // A long refusal or status wraps inside the row, as its item-view twin does (review 1418 A6).
    for (const sel of ['.pv-secrets .wi-status', '.pv-secrets .wi-refusal']) expect(effectiveValue(css, sel, 'overflow-wrap'), sel).toBe('anywhere');
    expect(effectiveValue(css, '.wi-stored', 'display')).toBe('flex');
  });

  it('a store that could not be read says so; it is never drawn as a programme with no secrets', async () => {
    const read = vi.fn(async () => { throw new ApiError(503, { ok: false, error: 'secrets-unreadable' }); });
    render(<ProgrammeScreen slug="prog-a" store={heard()} secrets={{ read }} />);
    const section = await screen.findByRole('region', { name: STORED_TEXT.heading });
    expect(within(section).getByRole('alert').textContent).toBe(STORED_TEXT.unreadable);
  });

  it('Remove asks for confirmation, removes that slot of this programme, and reads the list again', async () => {
    let slots: StoredSecretsAnswer['slots'] = [{ slot: 'api-key', setAt: NOW, item: null }];
    const read = vi.fn(async () => answerOf(slots));
    const remove = vi.fn<RemoveSecret>(async (_p, slot) => { slots = []; return { ok: true, slot }; });
    render(<ProgrammeScreen slug="prog-a" store={heard()} secrets={{ read, remove, stepUpDeps }} />);
    const section = await screen.findByRole('region', { name: STORED_TEXT.heading });
    fireEvent.click(within(section).getByRole('button', { name: STORED_TEXT.removeLabel('api-key') }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(STORED_TEXT.confirmTitle('api-key'));
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === STORED_TEXT.remove)!);
    await waitFor(() => expect(remove).toHaveBeenCalledWith('prog-a', 'api-key'));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('region', { name: STORED_TEXT.heading })).toBeNull());
  });

  it('reads the list again when one of this programme\'s secret items changes in the frame', async () => {
    const read = vi.fn(async () => answerOf([]));
    const store = heard({ waiting: waitingView({ items: [itemView({ id: 5, kind: 'secret', secretSlot: 'api-key' } as never)] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} secrets={{ read }} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 5, kind: 'secret', secretSlot: 'api-key', state: 'checking', secretSet: { at: NOW, tail: '', masked: false, why: 'too-short' } } as never)] }) }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('reads the list again when an item\'s slot moves between nothing stored, stored with no record and unreadable (review 1418 A3)', async () => {
    const read = vi.fn(async () => answerOf([]));
    const at = (secretSet: unknown) => waitingView({ items: [itemView({ id: 5, kind: 'secret', secretSlot: 'api-key', state: 'checking', secretSet } as never)] });
    const store = heard({ waiting: at(null) });
    render(<ProgrammeScreen slug="prog-a" store={store} secrets={{ read }} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => store.setState({ waiting: at({ at: null, tail: '' }) }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    act(() => store.setState({ waiting: at({ unreadable: true }) }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    act(() => store.setState({ waiting: at(null) }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  });
});
