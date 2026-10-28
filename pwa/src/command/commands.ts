// The base commands (D-5103): the screens, the sessions, the layout and the
// theme, and the shortcut sheet. W2 Task S2b adds "New session" (the fleet
// flows' own door, D-5468), "Go to Docs" (from the route table) and "Open the
// command palette" (D-5469: a door runs a command, so the search door needs
// one); S2d adds the session's (`SESSION_COMMANDS`, D-5466).
import { AUTO, SKINS, SYSTEM, THEMES } from '@ccrc/ui';
import { boardHome, type FleetSession, type RunSummary } from '../../../shared/api';
import { groupFleet } from '../fleet/groupFleet';
import { nestFleet } from '../fleet/nestFleet';
import { isRunClosed, runCard } from '../fleet/runWords';
import { matchRoute, ROUTES } from '../lib/routes';
import type { Command, CommandContext } from './registry';
import { sessionEntries } from './sessionEntries';

/** The `g` chord's second key per route. Archive and Docs have none: `a` is
 *  Accounts and `d` is unclaimed, and both are doors off the fleet rather
 *  than places visited every day. */
const CHORDS: Readonly<Record<string, string>> = { fleet: 'f', inbox: 'i', runs: 'r', accounts: 'a', settings: 's' };

/** The top row whose page a path sits under (`/settings` for `/settings/updates`), or null. */
function parentOf(path: string): (typeof ROUTES)[number] | null {
  return ROUTES.find((p) => p.top && p.path !== null && p.path !== '/' && path.startsWith(`${p.path}/`)) ?? null;
}

/** The screens a "Go to" command opens: the route table's top rows (D-5466),
 *  each with its `g` chord's second key, then each page under one that has a
 *  path of its own, titled under its parent ("Go to Settings › Updates",
 *  D-5504). A row with no path (a session, the digest, `settings-section`)
 *  is never offered. `command-registry.test.ts` holds every path to a route
 *  `app.tsx` routes. */
export const GO_TO: readonly { id: string; title: string; path: string; chord?: string }[] = ROUTES.flatMap((r) => {
  if (r.path === null) return [];
  if (r.top) return [{ id: `go-${r.id}`, title: `Go to ${r.title}`, path: r.path, chord: CHORDS[r.id] }];
  const parent = parentOf(r.path);
  return parent === null ? [] : [{ id: `go-${r.id}`, title: `Go to ${parent.title} › ${r.title}`, path: r.path }];
});

/** The fleet in the order the fleet screen draws it: its cards in
 *  `groupFleet`'s order (which sorts with `sortFleet`), and each card's rows
 *  in `nestFleet`'s, a run's worker under its owner. The pending dispatch rows
 *  carry no session, so they are not stops. `]` and `[` walk this list, and
 *  "Open session…" lists it, so neither invents an order of its own. */
export function fleetOrder(
  sessions: readonly FleetSession[],
  runs: readonly RunSummary[],
): FleetSession[] {
  const cardOf = new Map(sessions.map((s) => [s.id, boardHome(s)] as const));
  const active = runs.filter((r) => !isRunClosed(r));
  return groupFleet([...sessions], []).flatMap((g) =>
    nestFleet(g.sessions, active.filter((r) => runCard(r, cardOf) === g.project))
      .flatMap((row) => (row.kind === 'session' ? [row.session] : [])));
}

/** The session the path names, or null off a session screen. */
function currentId(path: string): string | null {
  const at = matchRoute(path);
  return at?.route.id === 'session' ? at.param : null;
}

/** Step through the fleet from the session in force, wrapping at either end.
 *  Off a session screen, `]` opens the first and `[` the last. */
export function stepSession(ctx: CommandContext, step: 1 | -1): void {
  const list = ctx.sessions;
  if (list.length === 0) return;
  const id = currentId(ctx.path);
  const at = id === null ? -1 : list.findIndex((s) => s.id === id);
  const next = at < 0
    ? (step > 0 ? 0 : list.length - 1)
    : (at + step + list.length) % list.length;
  ctx.navigate(`/s/${encodeURIComponent(list[next]!.id)}`);
}

/** The session's commands (W2 Task S2d, D-5466): the ⋯ menu's items on the base, plus the two header doors that
 *  open a session flow (the terminal and the PR sheet). Each menu item is built with `commandDoor(id)`, so the menu,
 *  the palette and any door run one command. Offered only while a session screen's flows are mounted, and only
 *  where the menu itself would offer the item enabled: the gate is `SessionFlows`', asked through `offers`. */
export const SESSION_COMMANDS: readonly { id: string; title: string }[] = [
  { id: 'session-model', title: 'Change model' },
  { id: 'session-effort', title: 'Change effort' },
  { id: 'open-history', title: 'Show history' },
  { id: 'session-docs', title: "Open this session's docs" },
  { id: 'session-swap', title: 'Move to another account' },
  { id: 'session-archive', title: 'Archive this session' },
  { id: 'session-restore', title: 'Restore this session' },
  { id: 'open-terminal', title: 'Open the terminal' },
  { id: 'session-pr', title: 'Open the pull request' },
];

export function baseCommands(): Command[] {
  return [
    ...GO_TO.map((g): Command => ({
      id: g.id,
      title: g.title,
      group: 'Go to',
      keys: g.chord === undefined ? undefined : ['g', g.chord],
      run: (ctx) => ctx.navigate(g.path),
    })),
    {
      id: 'new-session',
      title: 'New session',
      group: 'Sessions',
      run: (ctx) => ctx.openNewSession(),
    },
    {
      id: 'open-session',
      title: 'Open session…',
      group: 'Sessions',
      when: (ctx) => ctx.sessions.length > 0,
      // The same entries the top search finds (D-6714), not search-only here: the page lists the whole fleet.
      run: (ctx) => ({ title: 'Open session', commands: sessionEntries(ctx.sessions, ctx.runs, 'page') }),
    },
    {
      id: 'next-session',
      title: 'Next session',
      group: 'Sessions',
      keys: [']'],
      run: (ctx) => stepSession(ctx, 1),
    },
    {
      id: 'prev-session',
      title: 'Previous session',
      group: 'Sessions',
      keys: ['['],
      run: (ctx) => stepSession(ctx, -1),
    },
    ...SESSION_COMMANDS.map((c): Command => ({
      id: c.id,
      title: c.title,
      group: 'Session',
      when: (ctx) => ctx.session !== null && ctx.session.offers(c.id),
      run: (ctx) => ctx.session?.run(c.id),
    })),
    {
      // Offered only while a part publishes an inspector target. A single key skips `when` (`useShortcuts`), so the
      // run is null-safe: `i` where nothing is placed does nothing (desktop polish T3e, D-6385).
      id: 'toggle-inspector',
      title: 'Show or hide the inspector',
      group: 'Appearance',
      keys: ['i'],
      when: (ctx) => ctx.inspector !== null,
      run: (ctx) => ctx.inspector?.toggle(),
    },
    {
      id: 'switch-layout',
      title: 'Switch layout →',
      group: 'Appearance',
      run: () => ({
        title: 'Switch layout',
        // The picker's three (spec §7): Match this device, then the catalogue.
        commands: [
          { id: `layout-${AUTO}`, title: 'Match this device', group: 'Layout', run: (c) => c.setSkin(AUTO) },
          ...SKINS.map((s): Command => ({
            id: `layout-${s.id}`,
            title: s.preview ? `${s.label} (preview)` : s.label,
            group: 'Layout',
            run: (c) => c.setSkin(s.id),
          })),
        ],
      }),
    },
    {
      id: 'switch-theme',
      title: 'Switch theme…',
      group: 'Appearance',
      run: () => ({
        title: 'Switch theme',
        commands: [
          { id: `theme-${SYSTEM}`, title: 'Follow system', group: 'Theme', run: (c) => c.setTheme(SYSTEM) },
          ...THEMES.map((t): Command => ({
            id: `theme-${t.id}`,
            title: t.label,
            group: t.mode === 'light' ? 'Light' : 'Dark',
            run: (c) => c.setTheme(t.id),
          })),
        ],
      }),
    },
    {
      // Offered by a door (the search door, the command field), never inside
      // the palette it would open: the palette is already open there.
      id: 'open-palette',
      title: 'Open the command palette',
      group: 'Help',
      when: (ctx) => !ctx.paletteOpen,
      run: (ctx) => ctx.openPalette(),
    },
    {
      id: 'show-shortcuts',
      title: 'Show shortcuts',
      group: 'Help',
      keys: ['?'],
      run: (ctx) => ctx.openShortcuts(),
    },
  ];
}
