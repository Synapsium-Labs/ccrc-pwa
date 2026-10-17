// Docs W5 part 1, Task 11: a session's link into Docs (design 2026-10-01 section 4.8; M4.L2). `sessionDocsHref` is
// the one builder: the actions sheet's row and the session menu's item both call it, and each navigates to exactly
// the href it built. The branch is the one the session's worktree holds NOW (`s.branch`), never the workspace slug;
// a branch outside the bare grammar, or none, links the default view, and the string `null` never reaches a URL; a
// project outside the project grammar renders no row; the project is `s.project`, never the card the session renders
// on. Placeholders only: projects `demo`, `a`, `b`; branches `main`, `feat/renamed`; workspace `ws-old`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { sessionDocsHref } from '../src/docs/docsLinks';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'lane-a-demo', wrapper: 'lane-a', home: 'lane-a', project: 'demo',
  workdir: '/repo/wt/ws-old', workspace: 'ws-old', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'feat/renamed',
  ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null,
  ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null, background: null, ...over,
});

const headerProps = (session: FleetSession): SessionHeaderProps => ({
  session, status: 'idle', statusUpdatedAt: null,
  onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  roster: [],
});

const here = (): string => location.pathname + location.search;

beforeEach(() => {
  // The sheet mounts SwapSheet, which polls `/api/accounts` while open: answer it with an empty roster.
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
});

/** The actions sheet's Docs row for `session`, clicked; answers where it navigated and what `onClose` saw. */
function viaSheet(session: FleetSession): { href: string; closedAt: string | null } {
  let closedAt: string | null = null;
  render(<SessionActionsSheet session={session} open onClose={() => { closedAt = here(); }} onReap={() => {}} />);
  const row = document.querySelector<HTMLButtonElement>('.docs-session-row');
  expect(row, 'the sheet has a Docs row').not.toBeNull();
  fireEvent.click(row!);
  const href = here();
  cleanup();
  history.replaceState(null, '', '/');
  return { href, closedAt };
}

/** The session menu's Docs item for `session`, clicked; answers where it navigated. */
function viaMenu(session: FleetSession): string {
  render(<SessionHeader {...headerProps(session)} />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
  const href = here();
  cleanup();
  history.replaceState(null, '', '/');
  return href;
}

describe('sessionDocsHref (spec 4.8, M4.L2)', () => {
  it('links the branch the worktree holds now, written verbatim, never the workspace slug', () => {
    expect(sessionDocsHref(s({ workspace: 'ws-old', branch: 'feat/renamed' })))
      .toEqual({ href: '/docs/demo?ref=feat/renamed', label: 'Docs on feat/renamed', branch: 'feat/renamed' });
  });

  it('links the default view when the session reports no branch', () => {
    expect(sessionDocsHref(s({ branch: null })))
      .toEqual({ href: '/docs/demo', label: 'Docs, default branch', branch: null });
  });

  it.each(['HEAD', 'refs/heads/main', 'a..b', 'x y', 'main.lock'])(
    'links the default view for a branch outside the bare grammar: %j', (branch) => {
      expect(sessionDocsHref(s({ branch })))
        .toEqual({ href: '/docs/demo', label: 'Docs, default branch', branch: null });
    });

  it.each(['', '.hidden', '../x', 'a b'])('renders no link for a project outside the project grammar: %j', (project) => {
    expect(sessionDocsHref(s({ project }))).toBeNull();
  });

  it('reads the session’s own project, never the card it renders on', () => {
    expect(sessionDocsHref(s({ project: 'a', boardProject: 'b', branch: 'main' }))?.href).toBe('/docs/a?ref=main');
  });

  it('never writes the string null into a URL', () => {
    for (const session of [s(), s({ branch: null }), s({ branch: 'HEAD' }), s({ workspace: null, branch: null })]) {
      const link = sessionDocsHref(session);
      expect(link).not.toBeNull();
      expect(link!.href).not.toContain('null');
    }
  });
});

describe('the actions sheet’s Docs row (spec 4.8, M4.L2)', () => {
  it('is a btn-ghost row right after Restart, labelled with the branch', () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    const row = screen.getByRole('button', { name: 'Docs on feat/renamed' });
    expect(row).toHaveClass('btn-ghost', 'docs-session-row');
    const buttons = [...document.querySelectorAll('.sess-sheet > button')];
    const restart = buttons.findIndex((b) => b.textContent === 'Restart session');
    expect(restart).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf(row)).toBe(restart + 1);
  });

  it('closes the sheet, then navigates to exactly the href the builder made', () => {
    const { href, closedAt } = viaSheet(s());
    expect(closedAt, 'onClose ran before the navigation').toBe('/');
    expect(href).toBe('/docs/demo?ref=feat/renamed');
  });

  it('says Docs, default branch for a session with no branch', () => {
    render(<SessionActionsSheet session={s({ branch: null })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByRole('button', { name: 'Docs, default branch' })).toHaveClass('docs-session-row');
  });

  it('renders no row for a project outside the project grammar', () => {
    render(<SessionActionsSheet session={s({ project: '.hidden' })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByRole('button', { name: 'Restart session' })).toBeInTheDocument();
    expect(document.querySelector('.docs-session-row')).toBeNull();
  });
});

describe('the session menu’s Docs item (spec 4.8, M4.L2)', () => {
  it('is a menu-item named Docs whose hint is the branch, or default', () => {
    render(<SessionHeader {...headerProps(s())} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = screen.getByRole('button', { name: 'Docs' });
    expect(item).toHaveClass('menu-item', 'docs-menu-item');
    expect(item.querySelector('.menu-hint')?.textContent).toBe('feat/renamed');
    cleanup();
    render(<SessionHeader {...headerProps(s({ branch: null }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Docs' }).querySelector('.menu-hint')?.textContent).toBe('default');
  });

  it('closes the menu and navigates to exactly the href the builder made', () => {
    render(<SessionHeader {...headerProps(s())} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    expect(here()).toBe('/docs/demo?ref=feat/renamed');
    expect(screen.queryByRole('button', { name: 'Docs' })).toBeNull();
  });

  it('renders no item for a project outside the project grammar', () => {
    render(<SessionHeader {...headerProps(s({ project: '.hidden' }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(document.querySelector('.docs-menu-item')).toBeNull();
  });
});

describe('one builder for both surfaces (spec 4.8, M4.L2)', () => {
  it.each([
    ['a renamed workspace', s()],
    ['no branch', s({ branch: null })],
    ['a branch outside the bare grammar', s({ branch: 'HEAD' })],
    ['a session on another project’s card', s({ project: 'a', boardProject: 'b', branch: 'main' })],
  ])('the sheet row and the menu item go to the same href for %s', (_name, session) => {
    const want = sessionDocsHref(session)!.href;
    expect(viaSheet(session).href).toBe(want);
    expect(viaMenu(session)).toBe(want);
  });

  // A text scan over the two callers, NOT EXHAUSTIVE: it sees a Docs URL spelled in either file (a `/docs` string or
  // template, a `?ref=`, a call to `docsPageUrl` or `docsLocation`). It does not see a builder imported from a third
  // module under another name, or a URL assembled from pieces that never spell those; the behaviour cases above are
  // what pin the hrefs themselves.
  it.each(['src/fleet/SessionActionsSheet.tsx', 'src/session/SessionHeader.tsx'])(
    '%s calls sessionDocsHref and builds no Docs URL of its own', (rel) => {
      const text = readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8');
      expect(text).toContain('sessionDocsHref(session)');
      expect(text).not.toMatch(/['"`]\/docs\b|\?ref=|\bdocsPageUrl\(|\bdocsLocation\(/);
    });
});

describe('T13 review 5-3: the session menu lists Docs directly after History', () => {
  it('the Docs item is History’s next sibling in the menu, and nothing sits between them', () => {
    render(<SessionHeader {...headerProps(s())} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const history = screen.getByRole('button', { name: 'History' });
    const docs = screen.getByRole('button', { name: 'Docs' });
    expect(history.nextElementSibling).toBe(docs);
    expect(docs.parentElement).toBe(history.parentElement);
    const labels = [...(history.parentElement?.children ?? [])].map((n) => n.querySelector('.menu-label')?.textContent);
    expect(labels.slice(0, 4)).toEqual(['Change model', 'Change effort', 'History', 'Docs']);
  });
});
