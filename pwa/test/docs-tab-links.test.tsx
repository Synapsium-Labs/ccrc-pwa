// The Docs tab rule at every caller (desktop polish wave 174; the rule is `opensNewTab`, `lib/docTab.ts`). At a desk a link
// from the console to a document is a real anchor with `target="_blank"` and no in-app click handler, so the browser opens
// the tab; below the desk width it is the same anchor with no target, and a plain click moves within the app. A link that is
// not to a document is unchanged at every width. Controls that are not anchors go through `followLink`. Neutral names only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../shared/api';
import { ChatLink } from '../src/lib/markdown';
import { GoalsPanel, SpecLink } from '../src/ledgers/GoalsPanel';
import { ItemView } from '../src/ledgers/ItemView';
import { EpicScreen } from '../src/ledgers/EpicScreen';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { PlaceDoor } from '../src/skins/DoorLink';
import { ScreenFallback } from '../src/components/RenderBoundary';
import { DOOR_EVENT } from '../src/command/door';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { navigate } from '../src/lib/router';
import { initSkin, setSkin } from '../src/lib/skin';
import { createFleetStore, useFleetStore } from '../src/stores/fleet';
import { App } from '../src/app';
import type { EpicView, CheckpointView } from '../../shared/plan';
import type { GoalsView } from '../../shared/ledgers';
import type { ProjectRow } from '../../shared/api';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import { fleetSession } from './fleetFixture';
import { itemView, NOW, runRow } from './ledgersFixture';

// The bell renders only where the browser can push; as in the shell's own suite.
vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
}));

/** A desk (or not) with a fine pointer: `(min-width: 900px)` answers `desk`. */
function stubWidth(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine'),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

const here = (): string => location.pathname + location.search;
const DOC = '/docs/project-a/specs/x.md';
const SPEC_PATH = 'docs/superpowers/specs/x.md';

let open: ReturnType<typeof vi.spyOn<Window, 'open'>>;

beforeEach(() => {
  history.replaceState(null, '', '/');
  open = vi.spyOn(window, 'open').mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input).includes('/api/accounts')
    ? new Response(JSON.stringify({ accounts: [], projected: null, roster: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  localStorage.clear();
  act(() => {
    setSkin(REFINED);
    useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null, feed: [], fleetFrameSeen: false, waiting: null });
  });
});

/** The two widths' common assertions for a document link, found by `find` after a render. */
function expectDeskDoc(link: HTMLElement, href: string): void {
  expect(link).toHaveAttribute('href', href);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener');
  const before = here();
  fireEvent.click(link);
  expect(here(), 'the app does not move: the browser opens the tab').toBe(before);
}
function expectPhoneDoc(link: HTMLElement, href: string): void {
  expect(link).toHaveAttribute('href', href);
  expect(link).not.toHaveAttribute('target');
  fireEvent.click(link);
  expect(here()).toBe(href);
}
/** A `TextLink` draws `target="_blank"` by default and relies on its click handler to keep a plain click in the app, so
 *  these two assert the move, not the absence of a target. */
function expectPhoneDocText(link: HTMLElement, href: string): void {
  expect(link).toHaveAttribute('href', href);
  fireEvent.click(link);
  expect(here()).toBe(href);
}
function expectInAppText(link: HTMLElement, href: string): void { expectPhoneDocText(link, href); }
function expectInApp(link: HTMLElement, href: string): void {
  expect(link).toHaveAttribute('href', href);
  expect(link).not.toHaveAttribute('target');
  fireEvent.click(link);
  expect(here()).toBe(href);
}

/** Renders `ui` at a desk or a phone, and answers the cleanup-and-reset between the two widths of one case. */
function at(desk: boolean, ui: () => React.ReactElement): void {
  stubWidth(desk);
  render(ui());
}

describe('ChatLink', () => {
  const ui = (): React.ReactElement => <ChatLink target={{ href: DOC, external: false }}>the spec</ChatLink>;
  it('at a desk is a new-tab anchor', () => {
    at(true, ui);
    expectDeskDoc(screen.getByRole('link', { name: 'the spec' }), DOC);
  });
  it('on a phone moves within the app', () => {
    at(false, ui);
    expectPhoneDoc(screen.getByRole('link', { name: 'the spec' }), DOC);
  });
  it('a non-document link is in-app at a desk', () => {
    at(true, () => <ChatLink target={{ href: '/runs', external: false }}>runs</ChatLink>);
    expectInApp(screen.getByRole('link', { name: 'runs' }), '/runs');
  });
});

describe('SpecLink', () => {
  const ui = (): React.ReactElement => <SpecLink href={DOC} programme="prog-a" />;
  it('at a desk is a new-tab anchor', () => {
    at(true, ui);
    expectDeskDoc(screen.getByRole('link', { name: 'Spec for prog-a' }), DOC);
  });
  it('on a phone moves within the app', () => {
    at(false, ui);
    expectPhoneDocText(screen.getByRole('link', { name: 'Spec for prog-a' }), DOC);
  });
});

describe('GoalsPanel: Open the spec in Docs', () => {
  const goals: GoalsView = { program: 'prog-a', specPath: 'docs/superpowers/specs/x.md', inShort: 'In short.', inShortAt: NOW, modifications: [] };
  const ui = (): React.ReactElement => <GoalsPanel goals={goals} homeProject="project-a" />;
  it('at a desk is a new-tab anchor', () => {
    at(true, ui);
    expectDeskDoc(screen.getByRole('link', { name: 'Open the spec in Docs' }), DOC);
  });
  it('on a phone moves within the app', () => {
    at(false, ui);
    expectPhoneDocText(screen.getByRole('link', { name: 'Open the spec in Docs' }), DOC);
  });
});

describe('ItemView: linked text', () => {
  const item = itemView({ id: 3, title: `Read ${SPEC_PATH} then item 7` });
  const ui = (): React.ReactElement => (
    <ItemView item={item} onTick={async () => {}} onDismiss={async () => {}} programmeLive now={NOW}
      programme={{ name: 'Programme A', hue: null, homeProject: 'project-a' }} itemHref={(n) => `/waiting/${n}`} />
  );
  const heading = (): HTMLElement => screen.getByRole('heading', { level: 1 });
  it('at a desk a document path is a new-tab anchor, an item reference is in-app', () => {
    at(true, ui);
    expectDeskDoc(within(heading()).getByRole('link', { name: SPEC_PATH }), DOC);
    expectInAppText(within(heading()).getByRole('link', { name: 'item 7' }), '/waiting/7');
  });
  it('on a phone a document path moves within the app', () => {
    at(false, ui);
    expectPhoneDocText(within(heading()).getByRole('link', { name: SPEC_PATH }), DOC);
  });
});

describe('EpicBody: a checkpoint’s evidence', () => {
  const cp = (key: string, evidence: CheckpointView['evidence']): CheckpointView => ({
    key, title: `Checkpoint ${key}`, kind: 'acceptance', state: 'open', proves: [], metAt: null, evidence, url: null, sync: 'none', syncWord: null,
  });
  const epic: EpicView = {
    key: 'e1', title: 'Epic one', summary: 'The summary.', project: 'project-a', waves: [1], state: 'active', url: null, sync: 'none',
    syncWord: null, checkpoints: [cp('a', { path: SPEC_PATH }), cp('b', { itemId: 7 })], tickets: [],
  };
  async function mount(desk: boolean): Promise<void> {
    stubWidth(desk);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' } as ProjectRow] });
    vi.spyOn(api, 'plan').mockResolvedValue({ ok: true, plan: { program: 'prog-a', planned: true, initiatives: [], epics: [epic], doneWhen: [] } });
    render(<EpicScreen slug="prog-a" epicKey="e1" />);
    await screen.findByRole('heading', { level: 1, name: 'Epic one' });
  }
  it('at a desk a document is a new-tab anchor, an item is in-app', async () => {
    await mount(true);
    expectDeskDoc(screen.getByRole('link', { name: SPEC_PATH }), DOC);
    expectInAppText(screen.getByRole('link', { name: 'Item #7' }), '/waiting/7');
  });
  it('on a phone a document moves within the app', async () => {
    await mount(false);
    expectPhoneDocText(screen.getByRole('link', { name: SPEC_PATH }), DOC);
  });
});

describe('RunDetail: the Spec fact', () => {
  const T0 = Date.UTC(2026, 10, 2, 11, 20);
  const run = {
    ...runRow({ id: 410, program: 'programme-a' }),
    programTitle: 'Programme A', project: 'project-a', homeProject: 'project-a', workspace: null, branch: null, reviews: null,
    openedAt: T0, dispatchedAt: T0 + 60_000, handoffCommit: null, items: { done: 1, total: 3 }, unreadMail: 0,
    resumed: false, clearedAt: null, dispatchStartedAt: null, lastMoveAt: T0 + 120_000,
  } as unknown as RunSummary;
  async function mount(desk: boolean): Promise<HTMLElement> {
    stubWidth(desk);
    vi.spyOn(api, 'runRecord').mockResolvedValue({ ok: true, run, events: [], reviewedBy: [], olderEvents: 0 });
    vi.spyOn(api, 'run').mockResolvedValue({ ok: true, run, spend: { measured: false, reason: 'no-sweep' } });
    vi.spyOn(api, 'runItems').mockResolvedValue({ ok: true, items: [] });
    vi.spyOn(api, 'runSignals').mockRejectedValue(new ApiError(404, { ok: false }));
    vi.spyOn(api, 'goals').mockResolvedValue({
      ok: true, goals: { program: 'programme-a', specPath: SPEC_PATH, inShort: null, inShortAt: null, modifications: [] },
    } as unknown as Awaited<ReturnType<typeof api.goals>>);
    render(<RunDetailScreen id={410} store={createFleetStore({
      makeSocket: () => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket,
    })} />);
    return screen.findByRole('link', { name: 'Open the spec' });
  }
  it('at a desk is a new-tab anchor', async () => { expectDeskDoc(await mount(true), DOC); });
  it('on a phone moves within the app', async () => { expectPhoneDocText(await mount(false), DOC); });
});

describe('the actions sheet’s Docs row', () => {
  const s: FleetSession = fleetSession({
    id: 'lane-a-demo', wrapper: 'lane-a', home: 'lane-a', project: 'demo', workdir: '/repo/wt/ws-old', workspace: 'ws-old', branch: 'feat/renamed',
  });
  const HREF = '/docs/demo?ref=feat/renamed';
  it('at a desk is a new-tab anchor and the sheet closes', () => {
    stubWidth(true);
    const onClose = vi.fn();
    render(<SessionActionsSheet session={s} open onClose={onClose} onReap={() => {}} />);
    expectDeskDoc(document.querySelector<HTMLAnchorElement>('.docs-session-row')!, HREF);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('on a phone moves within the app and the sheet closes', () => {
    stubWidth(false);
    const onClose = vi.fn();
    render(<SessionActionsSheet session={s} open onClose={onClose} onReap={() => {}} />);
    expectPhoneDoc(document.querySelector<HTMLAnchorElement>('.docs-session-row')!, HREF);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the session menu’s Docs item', () => {
  const s: FleetSession = fleetSession({
    id: 'lane-a-demo', wrapper: 'lane-a', home: 'lane-a', project: 'demo', workdir: '/repo/wt/ws-old', workspace: 'ws-old', branch: 'feat/renamed',
  });
  const HREF = '/docs/demo?ref=feat/renamed';
  const props = (): HeaderHostProps => ({
    session: s, status: 'idle', statusUpdatedAt: null,
    onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
    onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(), roster: [],
  });
  it('at a desk is a new-tab anchor and the menu closes', () => {
    stubWidth(true);
    render(<SessionHeaderHost {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expectDeskDoc(screen.getByRole('link', { name: 'Docs' }), HREF);
    expect(screen.queryByRole('link', { name: 'Docs' })).toBeNull();
  });
  it('on a phone moves within the app and the menu closes', () => {
    stubWidth(false);
    render(<SessionHeaderHost {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expectPhoneDoc(screen.getByRole('link', { name: 'Docs' }), HREF);
    expect(screen.queryByRole('link', { name: 'Docs' })).toBeNull();
  });
});

describe('PlaceDoor', () => {
  it('at a desk the Docs place is a new-tab link, the Runs place a button', () => {
    stubWidth(true);
    render(<><PlaceDoor id="docs" glyph={null} aria-label="Docs">Docs</PlaceDoor><PlaceDoor id="runs" glyph={null} aria-label="Runs">Runs</PlaceDoor></>);
    expectDeskDoc(screen.getByRole('link', { name: 'Docs, opens in a new tab' }), '/docs');
    expect(screen.getByRole('button', { name: 'Runs' })).toHaveAttribute('data-command', 'go-runs');
    expect(screen.queryByRole('link', { name: /^Runs/ })).toBeNull();
  });
  it('on a phone the Docs place is the Go to command button', () => {
    stubWidth(false);
    render(<PlaceDoor id="docs" glyph={null} aria-label="Docs">Docs</PlaceDoor>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Docs' })).toHaveAttribute('data-command', 'go-docs');
  });
});

describe('the whole app at a desk', () => {
  function mountApp(): void {
    act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a' })] }));
    navigate('/fleet');
    render(<App />);
  }
  it('"Go to Docs" from the command layer opens a new tab and leaves this one', () => {
    stubWidth(true);
    mountApp();
    act(() => { window.dispatchEvent(new CustomEvent<string>(DOOR_EVENT, { detail: 'go-docs' })); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/docs', '_blank', 'noopener');
    expect(location.pathname).toBe('/fleet');
  });
  it.each([['Refined', REFINED], ['Instrument', INSTRUMENT]])('%s: the top bar’s Docs place is a new-tab link, its Runs place a button', (_n, skin) => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-skin');
    initSkin();
    act(() => { setSkin(skin); });
    stubWidth(true);
    mountApp();
    const bar = document.querySelector<HTMLElement>('nav[aria-label="Primary"]')!;
    const docs = within(bar).getByRole('link', { name: /^Docs/ });
    expect(docs).toHaveAttribute('href', '/docs');
    expect(docs).toHaveAttribute('target', '_blank');
    expect(within(bar).getByRole('button', { name: /^Runs/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('link', { name: /^Runs/ })).toBeNull();
  });
});

describe('ScreenFallback: Back to the fleet', () => {
  it('in a Docs tab at a desk opens the fleet in a new tab and leaves the location alone', () => {
    stubWidth(true);
    history.replaceState(null, '', '/docs/project-a');
    render(<ScreenFallback />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fleet' }));
    expect(open).toHaveBeenCalledWith('/fleet', '_blank', 'noopener');
    expect(location.pathname).toBe('/docs/project-a');
  });
  it('in the console at a desk moves in-app', () => {
    stubWidth(true);
    history.replaceState(null, '', '/runs');
    render(<ScreenFallback />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fleet' }));
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/fleet');
  });
});
