// The command registry (D-5103): pure ranking, and the base commands' own
// invariants. `command-layer.test.tsx` drives the palette and the keys.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  available, COMMAND_FIELD_WORDS, rankCommands, SEARCH_EMPTY, SEARCH_MIN, type Command, type CommandContext,
} from '../src/command/registry';
import { baseCommands, fleetOrder, GO_TO, SESSION_COMMANDS } from '../src/command/commands';
import { matchRoute, ROUTES } from '../src/lib/routes';
import { fleetSession } from './fleetFixture';
import { parseTs } from './literalWalker';

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
      // Desktop polish T3e (D-6385): the inspector's hide and show, offered only while a part places a rail.
      'toggle-inspector',
    ].sort());
  });
});

describe('the session commands (W2 Task S2d)', () => {
  const ctx = (session: CommandContext['session']): CommandContext => ({
    path: '/s/project-a-one', sessions: [], runs: [], navigate: () => {}, setSkin: () => {}, setTheme: () => {},
    openShortcuts: () => {}, openNewSession: () => {}, openPalette: () => {}, paletteOpen: false, session, inspector: null,
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

// THE TOP SEARCH (D-6714, plan 2026-10-22-desktop-polish Task T5a): a term is scored by the one `score`, a search-only
// entry ranks after every other entry, needs SEARCH_MIN characters and a contiguous match, and a lower tier ranks first
// among equal scores. The base commands carry none of the new fields, so their ranking is today's (the regression pin).
describe('the top search: terms, tier and search-only (D-6714)', () => {
  const entry = (id: string, title: string, over: Partial<Command> = {}): Command => ({ ...cmd(id, title), ...over });

  it('a term is scored by the same score as a title', () => {
    const subTerm = entry('alpha', 'Alpha', { terms: ['xfoo'] }); // a substring: 2
    const wordTerm = entry('beta', 'Beta', { terms: ['x-foo'] }); // a word start: 3
    expect(rankCommands('foo', [subTerm, wordTerm]).map((c) => c.id)).toEqual(['beta', 'alpha']);
    const prefixTerm = entry('gamma', 'Gamma', { terms: ['foo-x'] }); // a prefix: 4
    const titleWord = entry('go-foo', 'Go foo'); // a title word start: 3
    expect(rankCommands('foo', [titleWord, prefixTerm]).map((c) => c.id)).toEqual(['gamma', 'go-foo']);
  });

  it('a search-only entry ranks after every other entry, even on a better score', () => {
    const list = [entry('go-runs', 'Go to Runs'), entry('s', 'first', { terms: ['runs-fold'], searchOnly: true })];
    expect(rankCommands('runs', list).map((c) => c.id)).toEqual(['go-runs', 's']);
    expect(rankCommands('runs', [...list].reverse()).map((c) => c.id), 'whatever the list order').toEqual(['go-runs', 's']);
  });

  it('among search-only entries of equal score a lower tier ranks first', () => {
    const list = [2, 3, 1].map((tier) => entry(`t${tier}`, `s${tier}`, { terms: ['project-a'], tier, searchOnly: true }));
    expect(rankCommands('project-a', list).map((c) => c.id)).toEqual(['t1', 't2', 't3']);
  });

  it('a search-only entry is never in the empty list', () => {
    const list = [entry('a', 'Go to Fleet'), entry('s', 'first', { terms: ['project-a'], searchOnly: true })];
    expect(rankCommands('', list).map((c) => c.id)).toEqual(['a']);
    expect(rankCommands('   ', list).map((c) => c.id)).toEqual(['a']);
  });

  it('a search-only entry needs a trimmed query of SEARCH_MIN characters', () => {
    expect(SEARCH_MIN).toBe(2);
    const list = [entry('s', 'first', { terms: ['project-a'], searchOnly: true })];
    expect(rankCommands('p', list)).toEqual([]);
    expect(rankCommands(' p ', list)).toEqual([]);
    expect(rankCommands('pr', list).map((c) => c.id)).toEqual(['s']);
  });

  it('a search-only entry is found by a contiguous run, never a scattered subsequence', () => {
    const list = [entry('plain', 'alpha-beta'), entry('s', 'alpha-beta', { searchOnly: true })];
    expect(rankCommands('ab', list).map((c) => c.id)).toEqual(['plain']);
    expect(rankCommands('ha-b', list).map((c) => c.id), 'a contiguous run finds both').toEqual(['plain', 's']);
  });

  it('entries with no terms, tier or searchOnly rank exactly as before', () => {
    // Measured on the base (4910f4cff) before T5a: the base commands' ids per query.
    const BEFORE: readonly [string, readonly string[]][] = [
  ['', ['go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-docs', 'go-archive', 'go-settings', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation', 'go-settings-security', 'new-session', 'open-session', 'next-session', 'prev-session', 'session-model', 'session-effort', 'open-history', 'session-docs', 'session-swap', 'session-archive', 'session-restore', 'open-terminal', 'session-pr', 'switch-layout', 'switch-theme', 'open-palette', 'show-shortcuts']],
  ['runs', ['go-runs']],
  ['go', ['go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-docs', 'go-archive', 'go-settings', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation', 'go-settings-security', 'session-model', 'session-effort']],
  ['settings', ['go-settings', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation', 'go-settings-security']],
  ['sess', ['new-session', 'open-session', 'next-session', 'prev-session', 'session-docs', 'session-archive', 'session-restore', 'go-settings-updates', 'go-settings-notifications', 'go-settings-security']],
  ['theme', ['switch-theme', 'open-palette']],
  ['gta', ['go-accounts', 'go-archive', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation']],
  ['s', ['open-history', 'switch-layout', 'switch-theme', 'show-shortcuts', 'go-settings', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation', 'go-settings-security', 'new-session', 'open-session', 'next-session', 'prev-session', 'session-docs', 'session-archive', 'session-restore', 'go-runs', 'go-accounts', 'go-docs', 'session-pr']],
  ['se', ['go-settings', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation', 'go-settings-security', 'new-session', 'open-session', 'next-session', 'prev-session', 'session-docs', 'session-archive', 'session-restore', 'switch-theme']],
  ['open', ['open-session', 'session-docs', 'open-terminal', 'session-pr', 'open-palette', 'go-settings-appearance']],
  ['zz', []],
  [' Go to ', ['go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-docs', 'go-archive', 'go-settings', 'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation', 'go-settings-security']],
  ['layout', ['switch-layout']],
  ['h', ['open-history', 'go-archive', 'session-model', 'session-effort', 'session-docs', 'session-swap', 'session-archive', 'session-restore', 'open-terminal', 'session-pr', 'switch-layout', 'switch-theme', 'open-palette', 'show-shortcuts']],
    ];
    // T3e (D-6385) adds `toggle-inspector`; every other command ranks as it did, so the table is read without it, and
    // the new command's own place is pinned in the empty list below.
    const ranked = (q: string): string[] => rankCommands(q, baseCommands()).map((c) => c.id).filter((id) => id !== 'toggle-inspector');
    for (const [q, ids] of BEFORE) expect(ranked(q), JSON.stringify(q)).toEqual(ids);
    const empty = rankCommands('', baseCommands()).map((c) => c.id);
    expect(empty.indexOf('toggle-inspector'), 'after the session commands, before Switch layout').toBe(empty.indexOf('session-pr') + 1);
    expect(empty[empty.indexOf('toggle-inspector') + 1]).toBe('switch-layout');
  });
});

describe("the palette's words and the session builder each have one home (D-6714)", () => {
  const SRC = path.join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
  /** Every string a file's CODE holds (never a comment): string literals, each template's literal parts, and JSX text. */
  const strings = (file: string): string[] => {
    const out: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) out.push(n.text);
      else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
      ts.forEachChild(n, walk);
    };
    walk(parseTs(file));
    return out;
  };
  /** The module `name` is imported from in `file`, or null. */
  const importedFrom = (file: string, name: string): string | null => {
    for (const st of parseTs(file).statements) {
      if (!ts.isImportDeclaration(st) || st.importClause?.namedBindings === undefined) continue;
      const b = st.importClause.namedBindings;
      if (ts.isNamedImports(b) && b.elements.some((e) => e.name.text === name)) return (st.moduleSpecifier as ts.StringLiteral).text;
    }
    return null;
  };
  const rel = (f: string): string => path.relative(SRC, f);

  it("the palette's words have one home", () => {
    expect(importedFrom(path.join(SRC, 'skins/instrument/TopBar.tsx'), 'COMMAND_FIELD_WORDS')).toBe('../../command/registry');
    expect(importedFrom(path.join(SRC, 'command/CommandLayer.tsx'), 'COMMAND_FIELD_WORDS')).toBe('./registry');
    for (const words of [COMMAND_FIELD_WORDS, SEARCH_EMPTY]) {
      const holders = files(SRC).filter((f) => strings(f).some((s) => s.includes(words))).map(rel);
      expect(holders, words).toEqual(['command/registry.ts']);
    }
  });

  it('one session builder', () => {
    const holders = files(SRC).filter((f) => strings(f).some((s) => s.startsWith('open-session-'))).map(rel);
    expect(holders).toEqual(['command/sessionEntries.ts']);
  });
});
