// The command registry (D-5103): pure ranking, and the base commands' own
// invariants. `command-layer.test.tsx` drives the palette and the keys.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ts } from '../../server/test/scan/parse';
import { describe, expect, it } from 'vitest';
import {
  available, COMMAND_FIELD_WORDS, rankCommands, SEARCH_EMPTY, SEARCH_MIN, type Command, type CommandContext,
} from '../src/command/registry';
import { baseCommands, fleetOrder, GO_TO, SESSION_COMMANDS } from '../src/command/commands';
import { runEntries } from '../src/command/runEntries';
import { sessionEntries } from '../src/command/sessionEntries';
import { matchRoute, ROUTES } from '../src/lib/routes';
import { fleetSession } from './fleetFixture';
import { fleetTree } from '../src/fleet/fleetTree';
import type { FleetSession, RunSummary } from '../../shared/api';
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

/** GO_TO's rule for a row that is not top (W5h-a): its path sits under a top row's path other than `/`, whatever its
 *  id. R19's measurement page, `measure-highlighting` at `/settings/measure-highlighting`, is the first such row
 *  whose id does not start `settings-`. */
const underTop = (routes: readonly { readonly top: boolean; readonly path: string | null }[], p: string): boolean =>
  routes.some((t) => t.top && t.path !== null && t.path !== '/' && p.startsWith(`${t.path}/`));

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
    // From W5h-a, GO_TO's own rule (underTop): a page under a top route is offered whatever its id.
    const offered = ROUTES.filter((r) => r.path !== null && (r.top || underTop(ROUTES, r.path)));
    expect(GO_TO.map((g) => g.id), 'one Go to per offered route').toEqual(offered.map((r) => `go-${r.id}`));
    for (const go of GO_TO) {
      expect(`go-${matchRoute(go.path)?.route.id}`, `${go.title} → ${go.path}`).toBe(go.id);
    }
    expect(GO_TO.map((g) => g.path)).toContain('/');
    expect(GO_TO.map((g) => g.id)).toContain('go-docs');
    const ids = new Set(baseCommands().map((c) => c.id));
    for (const go of GO_TO) expect(ids.has(go.id), go.id).toBe(true);
  });

  it('offers R19\'s measurement page under Settings, and the oracle\'s rule admits a planted page under a top route and none under no top route (W5h-a)', () => {
    expect(GO_TO.find((g) => g.id === 'go-measure-highlighting')?.title).toBe('Go to Settings › Measure highlighting');
    expect(GO_TO.find((g) => g.id === 'go-reader-lab')?.title).toBe('Go to Settings › Reader lab');
    expect(underTop(ROUTES, '/settings/planted')).toBe(true);
    expect(underTop(ROUTES, '/planted/page')).toBe(false);
    expect(underTop(ROUTES.filter((r) => r.path !== '/settings'), '/settings/planted')).toBe(false);
  });

  // C7d (D-7182): `fleetOrder` calls the fleet tree, so the palette's order is the cards' order, a worker under the
  // coordinator whose run the wire binds to it. The behaviour row, OA-C15 (a) (D-7265): a worker the wire does not
  // bind to the open run that names it (#746's recycled id, or an older server's frame) is not listed under that run's
  // claimant (before C7d the palette re-composed the order itself and bracketed it by the run's ids).
  it('lists the fleet in the fleet tree\'s order: a bound worker under its coordinator, an unbound one in its own place', () => {
    const coord = fleetSession({ id: 'coord', project: 'project-a', role: 'coordinator', bucket: 'idle', statusUpdatedAt: 1 });
    const other = fleetSession({ id: 'other', project: 'project-a', bucket: 'idle', statusUpdatedAt: 3 });
    const runOf = (id: number, sessionId: string): RunSummary => ({ id, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2,
      project: 'project-a', homeProject: null, sessionId, workspace: sessionId, branch: null, state: 'working', kind: 'work', reviews: null,
      claimedBy: 'coord', resumed: false, clearedAt: null, openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null,
      handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
      health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
      childReclaim: null, reviewCap: null, hadChild: false });
    const r = runOf(7, 'worker');
    const bound = { id: 7, state: 'working' as const, claimedBy: 'coord' };
    const worker = (over: Partial<FleetSession>): FleetSession => fleetSession({ id: 'worker', project: 'project-a', role: 'child', bucket: 'idle', statusUpdatedAt: 2, ...over });
    const order = (w: FleetSession): string[] => fleetOrder([coord, w, other], [r]).map((s) => s.id);
    const tree = (w: FleetSession): string[] => fleetTree([coord, w, other], [], [r]).flatMap((g) => g.rows.flatMap((row) => (row.kind === 'session' ? [row.session.id] : [])));
    expect(order(worker({ run: bound, openRun: bound }))).toEqual(['other', 'coord', 'worker']);
    expect(order(worker({ run: null, openRun: null }))).toEqual(['other', 'worker', 'coord']);
    for (const w of [worker({ run: bound, openRun: bound }), worker({ run: null, openRun: null }), worker({})]) expect(order(w)).toEqual(tree(w));
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
      'go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-archive', 'go-settings', 'go-waiting',
      'open-session', 'next-session', 'prev-session',
      'switch-layout', 'switch-theme', 'switch-character', 'show-shortcuts',
      // W2 Task S2b registers these three (§The door table's last column).
      'go-docs', 'new-session', 'open-palette',
      // Settings Task R2b1 (D-5504): one per section, its door the section's index row.
      'go-settings-updates', 'go-settings-appearance', 'go-settings-notifications', 'go-settings-automation',
      'go-settings-security',
      // Docs W5h-a Task 9: R19's measurement page, a page under Settings; its door is the palette's Go to.
      'go-measure-highlighting',
      // The reader lab plan, Task 10: the reader lab, a page under Settings beside R19's; its door is the palette's Go to.
      'go-reader-lab',
      // W2 Task S2d: the ⋯ menu's items on the base, and the terminal and PR caps (D-5466).
      'session-model', 'session-effort', 'open-history', 'session-docs', 'session-swap', 'session-archive',
      'session-restore', 'open-terminal', 'session-pr',
      // Desktop polish T3e (D-6385): the inspector's hide and show, offered only while a part places a rail.
      'toggle-inspector',
      // D-8121: the ⋯ menu's Browser tools item, the session's own browser MCP choice.
      'session-browser',
    ].sort());
  });
});

describe('the session commands (W2 Task S2d)', () => {
  const ctx = (session: CommandContext['session']): CommandContext => ({
    path: '/s/project-a-one', sessions: [], runs: [], navigate: () => {}, setSkin: () => {}, setTheme: () => {}, setCharacter: () => {},
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
    // W5h-a reads the table without go-measure-highlighting the same way; its own rank row and place are pinned below.
    // D-8121 reads it without session-browser the same way; its own rank row and place are pinned below.
    // The Overlord face plan's Switch character is read without the same way; its place is pinned below.
    const ranked = (q: string): string[] => rankCommands(q, baseCommands()).map((c) => c.id).filter((id) => id !== 'toggle-inspector' && id !== 'go-measure-highlighting' && id !== 'go-reader-lab' && id !== 'session-browser' && id !== 'switch-character');
    // Desktop-polish PL5a adds `go-waiting` (a top route's door); the table is read without it, and its own place is below.
    const rankedBefore = (q: string): string[] => ranked(q).filter((id) => id !== 'go-waiting');
    for (const [q, ids] of BEFORE) expect(rankedBefore(q), JSON.stringify(q)).toEqual(ids);
    // The command's own rank row: the one command whose title holds "inspector".
    expect(rankCommands('inspector', baseCommands()).map((c) => c.id)).toEqual(['toggle-inspector']);
    expect(rankCommands('character', baseCommands()).map((c) => c.id)).toEqual(['switch-character']);
    // This pin couples to the registry's order on purpose: moving the command is a decision, not a drift.
    const empty = rankCommands('', baseCommands()).map((c) => c.id);
    expect(empty.indexOf('toggle-inspector'), 'after the session commands, before Switch layout').toBe(empty.indexOf('session-pr') + 1);
    expect(empty[empty.indexOf('toggle-inspector') + 1]).toBe('switch-layout');
    // W5h-a: the one command whose title holds "measure", placed right after Settings' five pages.
    expect(rankCommands('measure', baseCommands()).map((c) => c.id)).toEqual(['go-measure-highlighting']);
    expect(empty.indexOf('go-measure-highlighting'), 'after Settings\' five pages').toBe(empty.indexOf('go-settings-security') + 1);
    // The reader lab plan, Task 10: the one command whose title holds "reader", placed right after R19's page.
    expect(rankCommands('reader', baseCommands()).map((c) => c.id)).toEqual(['go-reader-lab']);
    expect(empty.indexOf('go-reader-lab'), 'after R19\'s page').toBe(empty.indexOf('go-measure-highlighting') + 1);
    // D-8121: the one command whose title holds "browser", placed right after Change effort, as the menu places it.
    expect(rankCommands('browser', baseCommands()).map((c) => c.id)).toEqual(['session-browser']);
    expect(empty.indexOf('session-browser'), 'after Change effort').toBe(empty.indexOf('session-effort') + 1);
  });

  // Go to Waiting on you (desktop-polish PL5a): its own case, away from the lines other waves add to the one above.
  it('Go to Waiting on you is found by its words, and is in the registry because its route is top', () => {
    expect(rankCommands('waiting', baseCommands()).map((c) => c.id)[0]).toBe('go-waiting');
    expect(rankCommands('', baseCommands()).map((c) => c.id)).toContain('go-waiting');
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

describe('the run entries (D-8072, spec 2026-11-04 §8.3)', () => {
  const nav: string[] = [];
  const ctx = { navigate: (h: string) => { nav.push(h); } } as unknown as CommandContext;
  const openRun = (over: Partial<RunSummary>): RunSummary => ({ id: 11, program: 'programme-a', programTitle: 'Programme A', runTitle: null,
    wave: 2, waveOf: 3, kind: 'work', reviews: null, state: 'working', project: 'project-a', workspace: 'lane-a', branch: 'ws/lane-a', closedAt: null, ...over }) as unknown as RunSummary;
  const titles = (q: string, runs: RunSummary[], sessions: FleetSession[] = []): string[] =>
    rankCommands(q, [...baseCommands(), ...sessionEntries(sessions, runs, 'top'), ...runEntries(q, runs)]).map((c) => c.title);

  it('a number offers Open run 410, which goes to /runs/410', () => {
    for (const q of ['410', '#410', 'run 410']) {
      const found = rankCommands(q, runEntries(q, []));
      expect(found[0]!.title, q).toBe('Open run 410');
      nav.length = 0;
      found[0]!.run(ctx);
      expect(nav).toEqual(['/runs/410']);
    }
  });

  it('open runs join the entries by the same terms, ranked after sessions', () => {
    const s = fleetSession({ id: 'lane-a-session', project: 'project-a', workspace: 'lane-a', bucket: 'idle' });
    const order = titles('lane-a', [openRun({}), openRun({ id: 12, state: 'done' })], [s]);
    const at = order.findIndex((t) => t.startsWith('Run 11'));
    expect(at).toBeGreaterThan(order.findIndex((t) => t.includes('lane-a-session') || t === 'lane-a-session') );
    expect(order.some((t) => t.startsWith('Run 12'))).toBe(false);
  });

  it('other text offers Find runs matching, which opens /runs?q=', () => {
    const found = rankCommands('xyz abc', runEntries('xyz abc', []));
    expect(found.map((c) => c.title)).toEqual(["Find runs matching 'xyz abc'"]);
    nav.length = 0;
    found[0]!.run(ctx);
    expect(nav).toEqual(['/runs?q=xyz+abc']);
  });

  it('the palette reads no server', () => {
    const src = readFileSync(path.join(__dirname, '../src/command/runEntries.ts'), 'utf8');
    expect(src).not.toMatch(/lib\/api|fetch\(/);
  });

  it('entry ids do not collide with the base commands', () => {
    const ids = [...baseCommands().map((c) => c.id), ...runEntries('11', [openRun({})]).map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
