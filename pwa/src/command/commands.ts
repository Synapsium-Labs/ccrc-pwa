// The base commands (D-5103): the screens, the sessions, the layout and the
// theme, and the shortcut sheet. "New session" and the per-session actions
// are W2's: they need the fleet screen's own state, and that screen is held
// by an in-flight change until it lands.
import { AUTO, SKINS, SYSTEM, THEMES } from '@ccrc/ui';
import { boardHome, type FleetSession, type RunSummary } from '../../../shared/api';
import { groupFleet } from '../fleet/groupFleet';
import { nestFleet } from '../fleet/nestFleet';
import { isRunClosed, runCard } from '../fleet/runWords';
import { sessionLabel } from '../fleet/sessionLabel';
import type { Command, CommandContext } from './registry';

/** The screens a "Go to" command opens, each with its `g` chord's second key.
 *  `command-registry.test.ts` holds every path to a route `app.tsx` routes.
 *  Archive has no chord: `a` is Accounts, and the archive is a door off the
 *  fleet rather than a place visited every day. */
export const GO_TO: readonly { id: string; title: string; path: string; chord?: string }[] = [
  { id: 'go.fleet', title: 'Go to Fleet', path: '/', chord: 'f' },
  { id: 'go.inbox', title: 'Go to Inbox', path: '/mail', chord: 'i' },
  { id: 'go.runs', title: 'Go to Runs', path: '/runs', chord: 'r' },
  { id: 'go.accounts', title: 'Go to Accounts', path: '/accounts', chord: 'a' },
  { id: 'go.archive', title: 'Go to Archive', path: '/archive' },
  { id: 'go.settings', title: 'Go to Settings', path: '/settings', chord: 's' },
];

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
  const m = /^\/s\/([^/]+)\/?$/.exec(path);
  return m ? decodeURIComponent(m[1]!) : null;
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
      id: 'session.open',
      title: 'Open session…',
      group: 'Sessions',
      when: (ctx) => ctx.sessions.length > 0,
      run: (ctx) => ({
        title: 'Open session',
        commands: ctx.sessions.map((s): Command => ({
          id: `session.open.${s.id}`,
          title: sessionLabel(s),
          group: s.project,
          run: (c) => c.navigate(`/s/${encodeURIComponent(s.id)}`),
        })),
      }),
    },
    {
      id: 'session.next',
      title: 'Next session',
      group: 'Sessions',
      keys: [']'],
      run: (ctx) => stepSession(ctx, 1),
    },
    {
      id: 'session.previous',
      title: 'Previous session',
      group: 'Sessions',
      keys: ['['],
      run: (ctx) => stepSession(ctx, -1),
    },
    {
      id: 'layout.switch',
      title: 'Switch layout →',
      group: 'Appearance',
      run: () => ({
        title: 'Switch layout',
        // The picker's three (spec §7): Match this device, then the catalogue.
        commands: [
          { id: `layout.${AUTO}`, title: 'Match this device', group: 'Layout', run: (c) => c.setSkin(AUTO) },
          ...SKINS.map((s): Command => ({
            id: `layout.${s.id}`,
            title: s.preview ? `${s.label} (preview)` : s.label,
            group: 'Layout',
            run: (c) => c.setSkin(s.id),
          })),
        ],
      }),
    },
    {
      id: 'theme.switch',
      title: 'Switch theme…',
      group: 'Appearance',
      run: () => ({
        title: 'Switch theme',
        commands: [
          { id: `theme.${SYSTEM}`, title: 'Follow system', group: 'Theme', run: (c) => c.setTheme(SYSTEM) },
          ...THEMES.map((t): Command => ({
            id: `theme.${t.id}`,
            title: t.label,
            group: t.mode === 'light' ? 'Light' : 'Dark',
            run: (c) => c.setTheme(t.id),
          })),
        ],
      }),
    },
    {
      id: 'help.shortcuts',
      title: 'Show shortcuts',
      group: 'Help',
      keys: ['?'],
      run: (ctx) => ctx.openShortcuts(),
    },
  ];
}
