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
import { LEDGER_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { PROGRAM_SLUG_MAX_CHARS, type ProgrammeRow, type RunHit } from '../../shared/api';
import { ROUTES, epicPath, isProgrammeSlug, matchRoute, programmeIsOpenable, programmePath, runPath, shellViewOf, topRouteOf } from '../src/lib/routes';
import { WORK_GROUPS, type PlanView, type WorkGroup, type WorkMapView } from '../../shared/plan';
import { ProgrammeScreen } from '../src/ledgers/ProgrammeScreen';
import { planKey, workCardOf, workReadNext } from '../src/ledgers/workRead';
import { STORED_TEXT, type RemoveSecret } from '../src/ledgers/ItemView';
import { itemPath } from '../src/ledgers/ledgerWords';
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
const PLAN = { program: 'prog-a', planned: true, initiatives: [], epics: [], doneWhen: [] } as unknown as PlanView;
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
  // The plan read answers no `work` (an older server), so a case that is not about the Work card draws no card (WM4).
  vi.spyOn(api, 'plan').mockResolvedValue({ ok: true, plan: PLAN });
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
  // The operator's ruling of 2026-11-20 (fix round 1 amendment, D-8823 `head-icon-not-word`): the head keeps two of the note's three cues, the
  // programme's colour and its wave line, so the word goes too, and the programme icon the box draws (`RoleBadge`) stands before the title.
  it('draws no visible "Programme" word, and no kicker', () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'working', wave: 2, waveOf: 5, programTitle: 'Billing', homeProject: 'project-a' } as never)] });
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    const head = view.container.querySelector('.pv-head')!;
    expect(head.querySelector('.pv-kicker')).toBeNull();
    expect(head.textContent).not.toMatch(/programme/i);
    expect(head.textContent).toContain('Billing');
  });

  it('its programme icon is an image named Programme, with the same title, standing before the title on its line', () => {
    const view = render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    const head = view.container.querySelector('.pv-head') as HTMLElement;
    const icon = within(head).getByRole('img', { name: 'Programme' });
    expect(icon.getAttribute('aria-label')).toBe('Programme');
    expect(icon.getAttribute('title')).toBe('Programme');
    expect(icon.querySelector('svg')).not.toBeNull();
    const heading = within(head).getByRole('heading', { level: 1, name: 'Programme A' });
    expect(icon.nextElementSibling).toBe(heading);
    expect(icon.parentElement).toBe(heading.parentElement);
    expect(icon.parentElement!.classList.contains('pv-name')).toBe(true);
  });

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

// The Runs section and Resume on the programme page (the runs rebuild, Task 19, D-8075; spec 2026-11-04 §8.5, §9.5, A55, F25).
// The page's two run reads are the test's own (`readers`); a hit is what `find` sends for a closed run.
describe('the programme page: Runs', () => {
  const T = Date.UTC(2026, 10, 2, 11, 20);
  const answerRow = (over: Partial<ProgrammeRow> = {}): ProgrammeRow => ({
    slug: 'prog-a', title: 'Programme A', currentWave: 2, waveOf: 5, claimedBy: 'coord-a',
    waves: { working: 1, waiting: 0, queued: 0, done: 1, failed: 0 }, lastMoveAt: Date.now() - 60_000, ending: null, ...over,
  });
  const hit = (over: Record<string, unknown> = {}): RunHit => ({
    id: 5, program: 'prog-a', programTitle: 'Programme A', runTitle: null, wave: 1, waveOf: 5, kind: 'work', reviews: null, state: 'done',
    project: 'project-a', workspace: null, branch: null, claimedBy: 'coord-a', openedAt: T - 1000, closedAt: T, closedBy: 'coordinator',
    closeDetail: null, ...over,
  }) as unknown as RunHit;
  const readersOf = (rows: ProgrammeRow[], hits: RunHit[] | 'fail' = []) => {
    const find = vi.fn(async () => {
      if (hits === 'fail') throw new TypeError('offline');
      return { ok: true as const, exact: null, runs: hits, reviewsOf: [], next: null };
    });
    return { find, readers: { find, programmes: async () => ({ ok: true as const, programmes: rows, closedToday: { operator: 0, sweep: 0, coordinator: 0 } }) } };
  };
  const coord = (over: Record<string, unknown> = {}) => fleetSession({ id: 'coord-a', project: 'project-a', role: 'coordinator', status: 'idle', lifecycle: 'running', ...over } as never);
  const runs = (...over: Record<string, unknown>[]) => over.map((o) => runRow({ program: 'prog-a', programTitle: 'Programme A', homeProject: 'project-a', claimedBy: 'coord-a', workspace: null, branch: null, ...o } as never));
  const resumeButtons = (): HTMLElement[] => screen.queryAllByRole('button', { name: /^resume/i });

  it('the header is a superset of the card: lamp and word, the line, the coordinator and its word, the wave counts', async () => {
    const { readers } = readersOf([answerRow()]);
    render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1, wave: 2, waveOf: 5 }), sessions: [coord()] })} readers={readers} />);
    const facts = await screen.findByTestId('programme-facts');
    await waitFor(() => expect(within(facts).getByText(/1 working · 0 waiting · 0 queued · 1 done/)).toBeTruthy());
    expect(within(facts).getByText('moving')).toBeTruthy();
    expect(within(facts).getByText(/^1 working · 1 done · moved/)).toBeTruthy();
    expect(within(facts).getByText('coord-a').closest('a')?.getAttribute('href')).toBe('/s/coord-a');
    expect(facts.textContent).toContain('alive');
    expect(screen.getByText('wave 2 of 5')).toBeTruthy();
  });

  it('an answer without a list (a proxy\'s {}) draws the page, the facts counted from the open runs, and never throws', async () => {
    const empty = { programmes: (async () => ({})) as never, find: (async () => ({})) as never };
    render(<ProgrammeScreen slug="prog-a" store={heard()} readers={empty} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Programme A' })).toBeTruthy();
    expect(screen.getByTestId('programme-facts')).toBeTruthy();
  });

  it('the header carries the pending-close line per reason', async () => {
    const { readers } = readersOf([answerRow({ pendingClose: [
      { reason: 'owner-gone', count: 2, soonestAt: Date.now() + 3 * 3_600_000 - 1000, armed: true },
      { reason: 'overtaken', count: 1, soonestAt: Date.now() + 5 * 60_000, armed: false },
    ] })]);
    render(<ProgrammeScreen slug="prog-a" store={heard()} readers={readers} />);
    expect(await screen.findByText('Owner gone: 2 · ccrc closes them in 3 h')).toBeTruthy();
    expect(screen.getByText(/^Overtaken by later waves: 1 · ccrc would close it in \d+ min$/)).toBeTruthy();
  });

  it('open waves newest first with reviews nested', async () => {
    const { readers } = readersOf([answerRow()]);
    const view = render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs(
      { id: 10, wave: 1 }, { id: 11, wave: 2 }, { id: 12, wave: 2, kind: 'review', reviews: 11 }) })} readers={readers} />);
    await screen.findByTestId('programme-facts');
    const waves = [...view.container.querySelectorAll('.programme-wave')].map((w) => [...w.querySelectorAll('li.run-row')].map((r) => (r as HTMLElement).title));
    expect(waves).toEqual([['run 11', 'run 12'], ['run 10']]);
  });

  it('a stuck row carries its Abandon, and a healthy row none', async () => {
    const { readers } = readersOf([answerRow()]);
    const stuck = { reason: 'overtaken', cause: null, since: Date.now() - 86_400_000, closes: null };
    render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 10, wave: 1, stuck }, { id: 11, wave: 2 }) })} readers={readers} />);
    await screen.findByTestId('programme-facts');
    expect(screen.getByRole('button', { name: 'Abandon run 10' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abandon run 11' })).toBeNull();
  });

  it('closed waves read through find with their close word and line', async () => {
    const { readers, find } = readersOf([answerRow()], [
      hit({ id: 5, state: 'done', closedBy: 'coordinator' }),
      hit({ id: 4, state: 'failed', closedAt: T - 86_400_000, closedBy: 'operator', closeDetail: 'abandon:overtaken' }),
    ]);
    render(<ProgrammeScreen slug="prog-a" store={heard()} readers={readers} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Closed waves/ }));
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ program: 'prog-a', scope: 'closed' }));
    const section = screen.getByTestId('programme-runs');
    expect(within(section).getByText('done')).toBeTruthy();
    expect(within(section).getByText(/^Closed by the coordinator, /)).toBeTruthy();
    expect(within(section).getByText('closed by you: overtaken')).toBeTruthy();
  });

  it('done reads with Closed by the coordinator on its line, and the date alone after a word that names the closer', async () => {
    const { readers } = readersOf([answerRow()], [hit({ id: 4, state: 'failed', closedBy: 'sweep', closeDetail: 'expired:never-started' })]);
    render(<ProgrammeScreen slug="prog-a" store={heard()} readers={readers} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Closed waves/ }));
    const row = screen.getByText('closed by ccrc: never started').closest('li')!;
    expect(row.textContent).not.toMatch(/Closed by/);
    expect(row.textContent).toMatch(/2 Nov/);
  });

  it('a failed closed waves read says Could not load closed waves. Try again. in the fold alone', async () => {
    const { readers, find } = readersOf([answerRow()], 'fail');
    const view = render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1 }) })} readers={readers} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Closed waves/ }));
    expect(screen.getByRole('alert').textContent).toContain('Could not load closed waves. Try again.');
    expect(screen.getByTestId('programme-facts')).toBeTruthy();
    expect(view.container.querySelectorAll('.programme-wave .run-row').length).toBe(1);
    find.mockImplementation(async () => ({ ok: true as const, exact: null, runs: [hit()], reviewsOf: [], next: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('at a desk Goals and Work stack in the first column and Waiting on you, Stored secrets and Runs in the other (o8, WM4)', async () => {
    const { readers } = readersOf([answerRow()]);
    const view = render(<ProgrammeScreen slug="prog-a" store={heard()} readers={readers} />);
    await screen.findByTestId('programme-facts');
    const two = view.container.querySelector('.pv-two')!;
    const main = two.querySelector(':scope > .pv-main')!;
    const side = two.querySelector(':scope > .pv-side')!;
    expect(main.querySelector('[aria-label="Goals"], .pg-goals')).not.toBeNull();
    expect(main.querySelector('section[aria-label="Waiting on you"]')).toBeNull();
    expect(side.querySelector(':scope > section[aria-label="Waiting on you"]')).not.toBeNull();
    expect(side.querySelector(':scope > [data-testid="programme-runs"]')).not.toBeNull();
    expect(main.querySelector('[data-testid="programme-runs"]')).toBeNull();
    const css = stripComments(readFileSync(path.join(__dirname, '../src/ledgers/ledgers.css'), 'utf8'));
    expect(css).toMatch(/\.pv-two \{ display: grid; grid-template-columns: minmax\(0, 1\.05fr\) minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width: 900px\) \{ \.pv-two \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
    expect(css).toMatch(/\.pv-main,\s*\.pv-side \{ display: grid; gap: var\(--sp-3\); min-width: 0; align-content: start; \}/);
  });

  describe('Resume sits once on the head (F25, A46, A55, A60)', () => {
    const gone = coord({ status: 'dead', lifecycle: 'orphan' });
    it('shows from coordinatorGone, once, and no row carries it', async () => {
      const { readers } = readersOf([answerRow({ coordinatorGone: true })]);
      const view = render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1 }, { id: 2, wave: 3 }), sessions: [coord()] })} readers={readers} />);
      const facts = await screen.findByTestId('programme-facts');
      await waitFor(() => expect(resumeButtons().length).toBe(1));
      expect(facts.contains(resumeButtons()[0]!)).toBe(true);
      expect(view.container.querySelector('.run-resume')).toBeNull();
      expect(within(screen.getByTestId('programme-runs')).queryByRole('button', { name: /resume/i })).toBeNull();
    });
    it('an owner-gone row carries Abandon and never Resume', async () => {
      const { readers } = readersOf([answerRow({ coordinatorGone: true })]);
      const stuck = { reason: 'owner-gone', cause: null, since: Date.now() - 86_400_000, closes: null };
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 10, stuck, coordinatorGone: true }), sessions: [gone] })} readers={readers} />);
      await waitFor(() => expect(resumeButtons().length).toBe(1));
      const rows = within(screen.getByTestId('programme-runs'));
      expect(rows.getByRole('button', { name: 'Abandon run 10' })).toBeTruthy();
      expect(rows.queryByRole('button', { name: /resume/i })).toBeNull();
    });
    it('a claimant with no fleet row still shows it', async () => {
      const { readers } = readersOf([answerRow({ coordinatorGone: true })]);
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1 }), sessions: [] })} readers={readers} />);
      await waitFor(() => expect(resumeButtons().length).toBe(1));
    });
    it('a live coordinator shows none', async () => {
      const { readers } = readersOf([answerRow({ coordinatorGone: false })]);
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1 }), sessions: [coord()] })} readers={readers} />);
      await screen.findByTestId('programme-facts');
      expect(resumeButtons()).toEqual([]);
    });
    it('an older server with no field reads coordinatorPresence', async () => {
      const { readers } = readersOf([answerRow()]);
      const deadStore = heard({ runs: runs({ id: 1 }), sessions: [gone] });
      render(<ProgrammeScreen slug="prog-a" store={deadStore} readers={readers} />);
      await waitFor(() => expect(resumeButtons().length).toBe(1));
      cleanup();
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1 }), sessions: [] })} readers={readers} />);
      await screen.findByTestId('programme-facts');
      expect(resumeButtons()).toEqual([]);
    });
    it('coordinatorGone false hides it over a presence of dead, as a substrate fault sends (D-7370)', async () => {
      const { readers } = readersOf([answerRow({ coordinatorGone: false })]);
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: runs({ id: 1 }), sessions: [gone] })} readers={readers} />);
      await screen.findByTestId('programme-facts');
      expect(resumeButtons()).toEqual([]);
    });
    it('an all-terminal programme with a gone coordinator shows it on its head, and a frame not yet heard hides it', async () => {
      const ended = answerRow({ coordinatorGone: true, ending: { outcome: 'complete', waves: 2, neverStarted: 0, closedBy: null }, currentWave: null });
      const { readers } = readersOf([ended], [hit({ id: 7 })]);
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: [], sessions: [gone] })} readers={readers} />);
      await waitFor(() => expect(resumeButtons().length).toBe(1));
      cleanup();
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: [], runsFrameSeen: false, sessions: [gone] })} readers={readers} />);
      await screen.findByTestId('programme-facts');
      expect(resumeButtons()).toEqual([]);
    });
    it('Resume from the head of an all-terminal programme calls the reclaim for its newest run\'s claimant', async () => {
      const ended = answerRow({ coordinatorGone: true, ending: { outcome: 'complete', waves: 2, neverStarted: 0, closedBy: null }, currentWave: null });
      const { readers } = readersOf([ended], [hit({ id: 6, wave: 1 }), hit({ id: 7, wave: 2 })]);
      const reclaim = vi.spyOn(api, 'reclaimRun').mockResolvedValue({ program: 'prog-a', runIds: [6, 7], from: 'coord-a', to: 'coord-b' });
      render(<ProgrammeScreen slug="prog-a" store={heard({ runs: [], sessions: [gone, coord({ id: 'coord-b' })] })} readers={readers} />);
      await waitFor(() => expect(resumeButtons().length).toBe(1));
      fireEvent.click(resumeButtons()[0]!);
      expect(await screen.findByText(/coord-a claims run 7/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
      fireEvent.change(await screen.findByRole('combobox', { name: /hand run 7 to a coordinator/i }), { target: { value: 'coord-b' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reclaim' }));
      await waitFor(() => expect(reclaim).toHaveBeenCalledWith(7, 'coord-b'));
    });
  });
});

describe('the programme view: ratifying Goals', () => {
  const unrecorded = { ratified: false, why: 'unrecorded', source: null } as const;
  const asked = () => goals({ pinRatification: unrecorded });

  it('a ratify posts the stamp the panel rendered, then reads the Goals again', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: asked() });
    const ratify = vi.spyOn(api, 'ratifyGoals').mockResolvedValue({ ok: true, changed: true, goals: asked() });
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ratify' }));
    await waitFor(() => expect(ratify).toHaveBeenCalledWith('prog-a', { pin: { inShortAt: asked().inShortAt } }));
    await waitFor(() => expect(api.goals).toHaveBeenCalledTimes(2));
  });

  it('a 409 goals-changed reads again and says the goals changed', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: asked() });
    vi.spyOn(api, 'ratifyGoals').mockRejectedValue(new ApiError(409, { ok: false, error: 'goals-changed' }));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ratify' }));
    expect(await screen.findByText(LEDGER_REFUSAL_TEXT['goals-changed'])).toBeTruthy();
    await waitFor(() => expect(api.goals).toHaveBeenCalledTimes(2));
  });

  it('a 404 from a server without the door hides the button and says the server does not offer it', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: asked() });
    vi.spyOn(api, 'ratifyGoals').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ratify' }));
    expect(await screen.findByText('This server does not offer ratifying goals.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ratify' })).toBeNull();
  });

  it('auth-off while sign-in is dark hides the button and says ratifying needs sign-in', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: asked() });
    vi.spyOn(api, 'ratifyGoals').mockRejectedValue(new ApiError(501, { ok: false, error: 'auth-off' }));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ratify' }));
    expect(await screen.findByText('Ratifying goals needs sign-in, which is off on this server.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ratify' })).toBeNull();
  });
});

// The Work card on the programme page (programme work map WM4, D-8823; spec 2026-11-16 §5 and §5.1; plan Task WM4). The page reads
// the plan on arrival and again when its key moves, keeps the last view the card drew, and passes the card its links. The card's
// own words and layout are `work-card.test.tsx`'s; this block is what the PAGE does with the answer.
describe('the programme page: the Work card (WM4)', () => {
  const ZERO = Object.fromEntries(WORK_GROUPS.map((g) => [g, 0])) as Record<WorkGroup, number>;
  const ticket = (key: string, title: string, status: 'done' | 'working', over: Record<string, unknown> = {}) => ({
    key, title, status, group: status === 'done' ? 'done' : 'in-progress', reason: null, epic: { key: 'epic-a', title: 'Epic A' }, phases: [],
    runId: null, wave: null, doneAt: null, itemIds: [], lastFailedRunId: null, ...over,
  });
  const workView = (over: Partial<WorkMapView> = {}): WorkMapView => ({
    source: 'plan', end: null, verdicts: 'read', counts: { ...ZERO, done: 1, 'in-progress': 1 },
    items: [ticket('t-1', 'First ticket', 'done'), ticket('t-2', 'Second ticket', 'working', { runId: 12, itemIds: [7] })] as never,
    phases: [{ key: 'p1', number: 1, title: 'First phase', summary: '', finish: null, counts: { ...ZERO, done: 1, 'in-progress': 1 }, carried: 0,
      carriedOut: [], wholeEpics: [], items: ['t-1', 't-2'] }],
    notInPhase: [],
    epics: [{ key: 'epic-a', title: 'Epic A', done: 1, total: 2, url: null, dropped: false, checkpointsMet: 0, checkpointsTotal: 1, items: ['t-1', 't-2'],
      checkpoints: [{ key: 'c-1', title: 'Guide accepted', kind: 'acceptance', state: 'open', metAt: null, evidence: null, url: null }] }],
    initiatives: [], doneWhen: [], beforePlan: null, runs: null, ...over,
  });
  const answers = (work: unknown) => vi.spyOn(api, 'plan').mockResolvedValue({ ok: true, plan: PLAN, work } as never);
  const card = (): HTMLElement => screen.getByRole('heading', { level: 2, name: 'Work' }).closest('section')!;
  const headlineOf = (): string | null => card().querySelector('.wk-headline')!.textContent;
  const flush = () => act(async () => { await Promise.resolve(); });

  it('the Work card sits below Goals', async () => {
    answers(workView());
    const view = render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    const main = view.container.querySelector('.pv-two > .pv-main')!;
    const goals = main.querySelector('.pg-goals')!;
    expect(main.contains(card())).toBe(true);
    expect(goals.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.container.querySelector('.pv-side')!.contains(card())).toBe(false);
    expect(api.plan).toHaveBeenCalledWith('prog-a');
    expect(headlineOf()).toBe('1 of 2 done');
  });

  it('Waiting on you heads the right column, above Runs', async () => {
    answers(workView());
    const { readers } = { readers: { find: async () => ({ ok: true as const, exact: null, runs: [], reviewsOf: [], next: null }), programmes: async () => ({ ok: true as const, programmes: [], closedToday: { operator: 0, sweep: 0, coordinator: 0 } }) } };
    const view = render(<ProgrammeScreen slug="prog-a" store={heard()} readers={readers} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    const side = view.container.querySelector('.pv-two > .pv-side')!;
    const kids = [...side.children].map((c) => c.getAttribute('aria-label') ?? c.getAttribute('data-testid'));
    expect(kids).toEqual(['Waiting on you', 'Runs']);
  });

  it('a run of this programme moving re-reads the plan, and a run of another programme does not', async () => {
    answers(workView());
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    expect(api.plan).toHaveBeenCalledTimes(1);
    act(() => store.setState({ runs: [...live, runRow({ id: 90, program: 'prog-b', state: 'working' })] }));
    await flush();
    expect(api.plan).toHaveBeenCalledTimes(1);
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    await waitFor(() => expect(api.plan).toHaveBeenCalledTimes(2));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging', stuck: { reason: 'overtaken', cause: null, since: Date.now(), closes: null } } as never] }));
    await waitFor(() => expect(api.plan).toHaveBeenCalledTimes(3));
  });

  it('an item of this programme moving re-reads the plan, and an item of another programme does not', async () => {
    answers(workView());
    const store = heard({ waiting: waitingView({ items: [itemView({ id: 7 })] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 7 }), itemView({ id: 8, program: 'prog-b' })] }) }));
    await flush();
    expect(api.plan).toHaveBeenCalledTimes(1);
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 7, state: 'checking' } as never)] }) }));
    await waitFor(() => expect(api.plan).toHaveBeenCalledTimes(2));
  });

  it('an answer with no work draws no card', async () => {
    const view = render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    await waitFor(() => expect(api.plan).toHaveBeenCalledTimes(1));
    await flush();
    expect(screen.queryByRole('heading', { level: 2, name: 'Work' })).toBeNull();
    expect(view.container.querySelector('.wk-card')).toBeNull();
  });

  it('nothing is drawn for the work until the first read answers', async () => {
    let answer: (v: never) => void = () => {};
    vi.spyOn(api, 'plan').mockReturnValue(new Promise((r) => { answer = r as never; }));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(screen.queryByRole('heading', { level: 2, name: 'Work' })).toBeNull();
    await act(async () => { answer({ ok: true, plan: PLAN, work: workView() } as never); });
    expect(screen.getByRole('heading', { level: 2, name: 'Work' })).toBeTruthy();
  });

  it('a slow answer that arrives after a newer read has answered is dropped', async () => {
    const pending: Array<(v: never) => void> = [];
    vi.spyOn(api, 'plan').mockImplementation(() => new Promise((r) => { pending.push(r as never); }));
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => { pending[1]!({ ok: true, plan: PLAN, work: workView({ counts: { ...ZERO, done: 2 } }) } as never); });
    expect(headlineOf()).toBe('2 of 2 done');
    await act(async () => { pending[0]!({ ok: true, plan: PLAN, work: workView() } as never); });
    expect(headlineOf()).toBe('2 of 2 done');
  });

  it('a view followed by an answer with no work draws no card, and a failed read after that has no last view to keep (review 2922 F4)', async () => {
    answers(workView());
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    vi.spyOn(api, 'plan').mockResolvedValue({ ok: true, plan: PLAN });
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Work' })).toBeNull());
    vi.spyOn(api, 'plan').mockRejectedValue(new TypeError('offline'));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'awaiting-review' }] }));
    await screen.findByText('The work could not be read: offline');
    expect(card().querySelector('.wk-headline')).toBeNull();
  });

  it('a slow failure that arrives after a newer read has answered is dropped (review 2922 F5)', async () => {
    const pending: Array<{ ok: (v: never) => void; fail: (e: unknown) => void }> = [];
    vi.spyOn(api, 'plan').mockImplementation(() => new Promise((ok, fail) => { pending.push({ ok: ok as never, fail }); }));
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => { pending[1]!.ok({ ok: true, plan: PLAN, work: workView({ counts: { ...ZERO, done: 2 } }) } as never); });
    expect(headlineOf()).toBe('2 of 2 done');
    await act(async () => { pending[0]!.fail(new ApiError(503, { ok: false, error: 'plan-store-down' })); });
    expect(headlineOf()).toBe('2 of 2 done');
    expect(within(card()).queryByRole('alert')).toBeNull();
  });

  it('a work with an unreadable word this build cannot word is a failed read, and a view missing a list does not throw (review 2922 F3)', async () => {
    answers({ unreadable: 'new-word' });
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(await screen.findByText('The work could not be read: unreadable answer')).toBeTruthy();
    answers(workView());
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    await waitFor(() => expect(headlineOf()).toBe('1 of 2 done'));
    answers({ ...workView(), epics: undefined });
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'awaiting-review' }] }));
    expect((await within(card()).findByRole('alert')).textContent).toBe('The work could not be read: unreadable answer');
    expect(headlineOf()).toBe('1 of 2 done');
  });

  it('a failed read keeps the last view and says the read failed', async () => {
    answers(workView());
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    expect(headlineOf()).toBe('1 of 2 done');
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError(503, { ok: false, error: 'plan-store-down' }));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    const alert = await within(card()).findByRole('alert');
    expect(alert.textContent).toBe('The work could not be read: plan-store-down');
    expect(headlineOf()).toBe('1 of 2 done');
    expect(within(card()).getByText('Second ticket')).toBeTruthy();
    // The next good read clears the note and draws the new view.
    answers(workView({ counts: { ...ZERO, done: 2 } }));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'done' }] }));
    await waitFor(() => expect(within(card()).queryByRole('alert')).toBeNull());
    expect(headlineOf()).toBe('2 of 2 done');
  });

  it('a failed read with no word of its own says what the transport said', async () => {
    answers(workView());
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    vi.spyOn(api, 'plan').mockRejectedValue(new TypeError('offline'));
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    expect((await within(card()).findByRole('alert')).textContent).toBe('The work could not be read: offline');
  });

  it('an unreadable work keeps the last view and says so', async () => {
    answers(workView());
    const store = heard();
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    answers({ unreadable: 'run-unreadable' });
    act(() => store.setState({ runs: [{ ...live[0]!, state: 'merging' }] }));
    expect((await within(card()).findByRole('alert')).textContent).toBe('The work could not be read: the runs could not be read');
    expect(headlineOf()).toBe('1 of 2 done');
  });

  it('an unreadable work on the first read draws the note alone', async () => {
    answers({ unreadable: 'read-failed' });
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect((await within(await screen.findByRole('heading', { level: 2, name: 'Work' }).then(() => card())).findByRole('alert')).textContent)
      .toBe('The work could not be read: a read failed');
    expect(within(card()).queryByText(/of \d+ done/)).toBeNull();
  });

  it('a failed first read says the work could not be read, with the refusal\'s word', async () => {
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError(503, { ok: false, error: 'plan-store-down' }));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    const note = await screen.findByText('The work could not be read: plan-store-down');
    expect(card().contains(note)).toBe(true);
    expect(note.getAttribute('role')).toBe('alert');
    expect(within(card()).queryByText(/of \d+ done/)).toBeNull();
  });

  it('the plan read of a refused answer (ok false) is a failed read too', async () => {
    vi.spyOn(api, 'plan').mockResolvedValue({ ok: false, error: 'not-found' } as never);
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(await screen.findByText('The work could not be read: not-found')).toBeTruthy();
  });

  it('a run link opens the run, an item link the held item, and an epic\'s checkpoint row links its epic page', async () => {
    answers(workView());
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items: [itemView({ id: 7 })] }) })} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    expect(within(card()).getByRole('link', { name: 'Run #12' }).getAttribute('href')).toBe(runPath(12));
    expect(within(card()).getByRole('link', { name: 'Item #7' }).getAttribute('href')).toBe(itemPath(7, { at: 'waiting', programme: 'prog-a', back: 'goals' }));
    fireEvent.click(within(card()).getByRole('button', { name: /Epic A/ }));
    expect(within(card()).getByRole('link', { name: 'Open the epic' }).getAttribute('href')).toBe(epicPath('prog-a', 'epic-a'));
  });

  it('an item the page does not hold is drawn as its number, with no link', async () => {
    answers(workView());
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    expect(within(card()).queryByRole('link', { name: 'Item #7' })).toBeNull();
    expect(within(card()).getByText('Item #7')).toBeTruthy();
  });

  it('the card writes neither Programme nor coordinator', async () => {
    answers(workView());
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    expect(card().textContent).not.toMatch(/programme|coordinator/i);
  });

  it('a different slug\'s page asks for its own plan and draws no card until that answers', async () => {
    answers(workView());
    const store = heard();
    const view = render(<ProgrammeScreen key="prog-a" slug="prog-a" store={store} />);
    await screen.findByRole('heading', { level: 2, name: 'Work' });
    vi.spyOn(api, 'plan').mockReturnValue(new Promise(() => {}));
    view.rerender(<ProgrammeScreen slug="prog-b" store={store} />);
    expect(screen.queryByRole('heading', { level: 2, name: 'Work' })).toBeNull();
    expect(api.plan).toHaveBeenLastCalledWith('prog-b');
  });
});

// What the page does with each answer is decided once, in `workRead.ts` (L1); the screen only holds its state and draws it.
describe('the work read: the page keeps the last view, and the time of the last good read', () => {
  const shape = { source: 'plan', counts: {}, phases: [], notInPhase: [], epics: [], initiatives: [], doneWhen: [] };
  const view = { ...shape, items: [] } as unknown as WorkMapView;
  const other = { ...shape, items: [{ key: 'x' }] } as unknown as WorkMapView;
  const T0 = 1_000;

  it('a view is the card\'s answer, with the time it was read', () => {
    const r = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0);
    expect(workCardOf(r, 'prog-a')).toEqual({ answer: view, readAt: T0 });
  });

  it('an absent work is no card, and drops the view the page held', () => {
    const r1 = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0);
    const r2 = workReadNext(r1, 'prog-a', { answer: { ok: true, plan: {} } }, T0 + 1);
    expect(workCardOf(r2, 'prog-a')).toBeNull();
  });

  it('an absent work drops the held view for good: a failed read after it has no last view (review 2922 F4)', () => {
    const r1 = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0);
    const r2 = workReadNext(r1, 'prog-a', { answer: { ok: true, plan: {} } }, T0 + 1);
    expect(r2.last).toBeNull();
    const r3 = workReadNext(r2, 'prog-a', { failed: 'plan-store-down' }, T0 + 2);
    expect(r3.last).toBeNull();
    expect(workCardOf(r3, 'prog-a')?.answer).toEqual({ readFailed: 'plan-store-down', last: null });
    const r4 = workReadNext(r2, 'prog-a', { answer: { ok: true, plan: {}, work: { unreadable: 'read-failed' } } }, T0 + 3);
    expect(workCardOf(r4, 'prog-a')?.answer).toEqual({ unreadable: 'read-failed', last: null });
  });

  it('a word the card cannot word, or a view missing a list the card walks, is a failed read (review 2922 F3)', () => {
    const unknownWord = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: { unreadable: 'new-word' } } }, T0);
    expect(workCardOf(unknownWord, 'prog-a')?.answer).toEqual({ readFailed: 'unreadable answer', last: null });
    for (const list of ['items', 'phases', 'notInPhase', 'epics', 'initiatives', 'doneWhen', 'counts']) {
      const partial = { ...shape, items: [] } as Record<string, unknown>;
      delete partial[list];
      const r = workReadNext(workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0), 'prog-a', { answer: { ok: true, plan: {}, work: partial } }, T0 + 1);
      expect(workCardOf(r, 'prog-a')?.answer, `no ${list}`).toEqual({ readFailed: 'unreadable answer', last: view });
    }
    const notList = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: { ...shape, items: [], epics: {} } } }, T0);
    expect(workCardOf(notList, 'prog-a')?.answer).toEqual({ readFailed: 'unreadable answer', last: null });
  });

  it('nothing read yet is no card', () => {
    expect(workCardOf(null, 'prog-a')).toBeNull();
  });

  it('an unreadable work keeps the last view and the time of the read that drew it', () => {
    const r1 = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0);
    const r2 = workReadNext(r1, 'prog-a', { answer: { ok: true, plan: {}, work: { unreadable: 'run-unreadable' } } }, T0 + 500);
    expect(workCardOf(r2, 'prog-a')).toEqual({ answer: { unreadable: 'run-unreadable', last: view }, readAt: T0 });
  });

  it('a failed read keeps the last view and the time of the last good read, and a good read after it replaces both', () => {
    const r1 = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0);
    const r2 = workReadNext(r1, 'prog-a', { failed: 'plan-store-down' }, T0 + 500);
    expect(workCardOf(r2, 'prog-a')).toEqual({ answer: { readFailed: 'plan-store-down', last: view }, readAt: T0 });
    const r3 = workReadNext(r2, 'prog-a', { answer: { ok: true, plan: {}, work: other } }, T0 + 900);
    expect(workCardOf(r3, 'prog-a')).toEqual({ answer: other, readAt: T0 + 900 });
  });

  it('a failed first read has no last view', () => {
    const r = workReadNext(null, 'prog-a', { failed: 'plan-store-down' }, T0);
    expect(workCardOf(r, 'prog-a')).toEqual({ answer: { readFailed: 'plan-store-down', last: null }, readAt: T0 });
  });

  it('an answer that is not ok is a failed read, worded by its error', () => {
    const r = workReadNext(null, 'prog-a', { answer: { ok: false, error: 'not-found' } }, T0);
    expect(workCardOf(r, 'prog-a')?.answer).toEqual({ readFailed: 'not-found', last: null });
    const odd = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: 'text' } }, T0);
    expect(workCardOf(odd, 'prog-a')?.answer).toEqual({ readFailed: 'unreadable answer', last: null });
  });

  it('a view held for another programme is never drawn for this one, nor carried into its next read', () => {
    const r1 = workReadNext(null, 'prog-a', { answer: { ok: true, plan: {}, work: view } }, T0);
    expect(workCardOf(r1, 'prog-b')).toBeNull();
    const r2 = workReadNext(r1, 'prog-b', { failed: 'x' }, T0 + 1);
    expect(workCardOf(r2, 'prog-b')?.answer).toEqual({ readFailed: 'x', last: null });
  });

  it('the key is this programme\'s runs as id:state:stuck and its items as id:state, nothing else', () => {
    const runs = [
      runRow({ id: 2, program: 'prog-a', state: 'working' }), runRow({ id: 1, program: 'prog-a', state: 'merging', stuck: { reason: 'overtaken' } } as never),
      runRow({ id: 9, program: 'prog-b', state: 'working' }),
    ];
    const items = [itemView({ id: 7, program: 'prog-a', state: 'open' }), itemView({ id: 8, program: 'prog-b' })];
    expect(planKey('prog-a', runs, waitingView({ items }))).toBe('1:merging:1,2:working:0|7:open');
    expect(planKey('prog-a', [], waitingView())).toBe('|');
    expect(planKey('prog-a', [], null)).toBe('|');
  });

  it('the items of the key are the open ones and the cleared ones of this programme, the list\'s choice and not the screen\'s (review 2922 A5)', () => {
    const open = itemView({ id: 7, program: 'prog-a', state: 'open' });
    const cleared = itemView({ id: 6, program: 'prog-a', state: 'done' });
    const otherCleared = itemView({ id: 5, program: 'prog-b', state: 'done' });
    expect(planKey('prog-a', [], waitingView({ items: [open], cleared: [cleared, otherCleared] }))).toBe('|6:done,7:open');
    expect(planKey('prog-a', [], waitingView({ items: [open] }))).toBe('|7:open');
  });
});
