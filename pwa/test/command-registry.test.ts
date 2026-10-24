// The command registry (D-5103): pure ranking, and the base commands' own
// invariants. `command-layer.test.tsx` drives the palette and the keys.
import { describe, expect, it } from 'vitest';
import { available, rankCommands, type Command, type CommandContext } from '../src/command/registry';
import { baseCommands, fleetOrder, GO_TO, SESSION_COMMANDS } from '../src/command/commands';
import { matchRoute, ROUTES } from '../src/lib/routes';
import { fleetSession } from './fleetFixture';

const cmd = (id: string, title: string): Command => ({ id, title, group: 'Test', run: () => {} });

describe('rankCommands', () => {
  it('ranks prefix matches first', () => {
    const list = [
      cmd('a', 'Rerun the suites'), // a subsequence (r…u…n…s) only
      cmd('b', 'Go to Runs'), // a word starts with it
      cmd('c', 'Runs board'), // the title starts with it
      cmd('d', 'Settings'), // no match at all
    ];
    expect(rankCommands('runs', list).map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('matches case-insensitively, as a subsequence, and drops what does not match', () => {
    const list = [cmd('a', 'Go to Accounts'), cmd('b', 'Go to Archive')];
    expect(rankCommands('GTACC', list).map((c) => c.id)).toEqual(['a']);
    expect(rankCommands('zz', list)).toEqual([]);
  });

  it('keeps the registry order on an empty query and between equal scores', () => {
    const list = [cmd('a', 'Go to Fleet'), cmd('b', 'Go to Inbox'), cmd('c', 'Go to Runs')];
    expect(rankCommands('', list).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(rankCommands('go', list).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('the base commands', () => {
  it('command ids are unique', () => {
    const ids = baseCommands().map((c) => c.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size, `duplicated: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`)
      .toBe(ids.length);
  });

  it('every Go to command targets a route app.tsx routes: the top rows of ROUTES, the ladder\'s one table', () => {
    // `app.tsx`'s ladder matches against ROUTES and nothing else (D-5466;
    // `app.test.tsx` holds the two to each other both ways), so a Go to whose
    // path no row matches would open the placeholder.
    // One Go to per top route, and one per page under a top route with a path of its own (Settings' five
    // sections, D-5504); each targets the row it is named for. A row with no path (`settings-section`) has none.
    const offered = ROUTES.filter((r) => r.path !== null && (r.top || r.id.startsWith('settings-')));
    expect(GO_TO.map((g) => g.id), 'one Go to per offered route').toEqual(offered.map((r) => `go-${r.id}`));
    for (const go of GO_TO) {
      expect(`go-${matchRoute(go.path)?.route.id}`, `${go.title} → ${go.path}`).toBe(go.id);
    }
    expect(GO_TO.map((g) => g.path)).toContain('/');
    expect(GO_TO.map((g) => g.id)).toContain('go-docs');
    const ids = new Set(baseCommands().map((c) => c.id));
    for (const go of GO_TO) expect(ids.has(go.id), go.id).toBe(true);
  });

  it('orders the fleet as the fleet screen does: by card, then by the server bucket', () => {
    const a1 = fleetSession({ id: 'a1', project: 'project-a', bucket: 'idle', statusUpdatedAt: 1 });
    const a2 = fleetSession({ id: 'a2', project: 'project-a', bucket: 'idle', statusUpdatedAt: 2 });
    const b1 = fleetSession({ id: 'b1', project: 'project-b', bucket: 'attention', statusUpdatedAt: 1 });
    expect(fleetOrder([a1, a2, b1], []).map((s) => s.id)).toEqual(['b1', 'a2', 'a1']);
  });
});

describe("the ids are W2's door table's", () => {
  it('every base command carries the id docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md §The door table names', () => {
    expect(baseCommands().map((c) => c.id).sort()).toEqual([
      'go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-archive', 'go-settings',
      'open-session', 'next-session', 'prev-session',
      'switch-layout', 'switch-theme', 'show-shortcuts',
      // W2 Task S2b registers these three (§The door table's last column).
      'go-docs', 'new-session', 'open-palette',
      // Settings Task R2b1 (D-5504): one per section, its door the section's index row.
      'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation',
      'go-settings-security',
      // W2 Task S2d: the ⋯ menu's items on the base, and the terminal and PR caps (D-5466).
      'session-model', 'session-effort', 'open-history', 'session-docs', 'session-swap', 'session-archive',
      'session-restore', 'open-terminal', 'session-pr',
    ].sort());
  });
});

describe('the session commands (W2 Task S2d)', () => {
  const ctx = (session: CommandContext['session']): CommandContext => ({
    path: '/s/project-a-one', sessions: [], runs: [], navigate: () => {}, setSkin: () => {}, setTheme: () => {},
    openShortcuts: () => {}, openNewSession: () => {}, openPalette: () => {}, paletteOpen: false, session,
  });

  it('are offered only while a session screen hosts its flows, and only where the flows offer the item', () => {
    const ids = SESSION_COMMANDS.map((c) => c.id);
    expect(available(baseCommands(), ctx(null)).filter((c) => ids.includes(c.id))).toEqual([]);
    const offered = available(baseCommands(), ctx({ offers: (id) => id !== 'session-archive', run: () => {} }))
      .map((c) => c.id).filter((id) => ids.includes(id));
    expect(offered).toEqual(ids.filter((id) => id !== 'session-archive'));
  });

  it('run through the session target, by their own id', () => {
    const ran: string[] = [];
    const c = ctx({ offers: () => true, run: (id) => { ran.push(id); } });
    for (const cmd of baseCommands().filter((x) => x.id.startsWith('session-') || x.id === 'open-history')) cmd.run(c);
    expect(ran).toEqual(SESSION_COMMANDS.map((x) => x.id).filter((id) => id !== 'open-terminal'));
  });
});
