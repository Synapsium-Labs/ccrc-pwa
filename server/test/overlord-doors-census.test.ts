// Overlord W1, gates A (plan w1-gates.md Task 1, F8; spec Table 11.2): the door table (`coord/overlordDoors.ts`) against
// the routes files that register the doors. Every row is registered in the file it names; in `coord/overlordRoutes.ts`
// and `continuity/routes.ts` every registration has a row or a `NOT_OVERLORD_DOORS` entry, and never both; the table's
// columns agree with each other (a GET is `view`, a DELETE is not, an operator row is never `operate`).
//
// WHAT THE SCAN CANNOT SEE: a route registered through a helper, a loop or another registrar (`app.route({…})`, a
// `registerX(app)` that is not one of the files named here, a computed path). It reads literal `app.get|post|put|delete(
// '<path>'` calls with the repo's one parser wrapper (`scan/parse.ts`), as the other censuses do. A file outside this list
// that registers an Overlord door is a row naming it, which the "every row is registered there" test then reads.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, ts } from './scan/parse.js';
import { OVERLORD_DOORS, NOT_OVERLORD_DOORS, doorRow } from '../src/coord/overlordDoors.js';
import { DOOR_GROUPS, VERB_CLASSES } from '../../shared/overlord-identity.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OVERLORD_ROUTES = 'server/src/coord/overlordRoutes.ts';
const CONTINUITY_ROUTES = 'server/src/continuity/routes.ts';
const LEDGERS_ROUTES = 'server/src/coord/ledgersRoutes.ts';
const NAME_LIST_ROUTES = 'server/src/operatorModel/nameListRoutes.ts';
// D-8809: the Overlord's team link door (`link-team`) is registered in the linking file.
const LINKING_ROUTES = 'server/src/linking/routes.ts';
// The Overlord's inbox doors (W1 inbox piece): a routes file of its own, beside `overlordRoutes.ts`, which holds only the operator's doors.
const INBOX_ROUTES = 'server/src/coord/overlordInboxRoutes.ts';
// The Overlord's history door (W1, PR B1): a routes file of its own beside the inbox's.
const HISTORY_ROUTES = 'server/src/coord/overlordHistoryRoutes.ts';
const FILES = [OVERLORD_ROUTES, CONTINUITY_ROUTES, LEDGERS_ROUTES, NAME_LIST_ROUTES, LINKING_ROUTES, INBOX_ROUTES, HISTORY_ROUTES] as const;
/** Table 11.1d's server words (the later waves' words join here when their pieces land). */
const SERVER_WORDS = ['continuity-v1', 'timers-v1', 'overlord-v1'];
const VERBS = new Set(['get', 'post', 'put', 'delete']);

/** Every literal `app.<verb>('<path>'` registration of a source text, as `METHOD path`. */
export function registrationsOf(text: string, fileName = 'routes.ts'): string[] {
  return parseSource(text, fileName).calls
    .filter((c) => /^app\.(get|post|put|delete)$/.test(c.callee) && c.args[0]?.kind === 'string' && VERBS.has(c.name ?? ''))
    .map((c) => `${(c.name as string).toUpperCase()} ${c.args[0]!.text}`);
}
const sourceOf = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
const regs: Record<string, string[]> = Object.fromEntries(FILES.map((f) => [f, registrationsOf(sourceOf(f), f)]));
const rowRegistration = (r: { method: string; path: string }): string => `${r.method} ${r.path}`;
const rows = Object.entries(OVERLORD_DOORS);

/** The registrations of a file that neither a row nor an entry names. */
export function unaccounted(file: string, registrations: readonly string[]): string[] {
  const named = new Set<string>([
    ...rows.filter(([, r]) => r.file === file).map(([, r]) => rowRegistration(r)),
    ...Object.entries(NOT_OVERLORD_DOORS).filter(([, e]) => e.file === file).map(([k]) => k),
  ]);
  return registrations.filter((r) => !named.has(r));
}

describe('the door table against the routes files', () => {
  it('the scan finds registrations in each file (a zero would make every other test vacuous)', () => {
    for (const f of FILES) expect(regs[f]!.length, f).toBeGreaterThan(0);
  });
  it('every row is registered in the file it names, and that file is one of the files read here', () => {
    for (const [key, r] of rows) {
      expect(FILES as readonly string[], key).toContain(r.file);
      expect(regs[r.file], key).toContain(rowRegistration(r));
    }
  });
  for (const f of [OVERLORD_ROUTES, CONTINUITY_ROUTES, NAME_LIST_ROUTES, INBOX_ROUTES, HISTORY_ROUTES]) {
    it(`${f}: every registration has a row or a NOT_OVERLORD_DOORS entry`, () => {
      expect(unaccounted(f, regs[f]!)).toEqual([]);
    });
  }
  it('a registration is never both a row and a NOT_OVERLORD_DOORS entry', () => {
    const rowRegs = new Set(rows.map(([, r]) => rowRegistration(r)));
    for (const k of Object.keys(NOT_OVERLORD_DOORS)) expect(rowRegs.has(k), k).toBe(false);
  });
  it('every NOT_OVERLORD_DOORS entry is a registration of the file it names, with a reason', () => {
    for (const [k, e] of Object.entries(NOT_OVERLORD_DOORS)) {
      expect(regs[e.file] ?? [], k).toContain(k);
      expect(e.why.length, k).toBeGreaterThan(10);
    }
  });
  it('CONTROL: a planted registration with no row or entry is found, in each exhaustively scanned file', () => {
    for (const f of [OVERLORD_ROUTES, CONTINUITY_ROUTES, NAME_LIST_ROUTES, INBOX_ROUTES, HISTORY_ROUTES]) {
      const planted = `${sourceOf(f)}\napp.post('/api/planted/door', async () => 1);\n`;
      expect(unaccounted(f, registrationsOf(planted, f)), f).toEqual(['POST /api/planted/door']);
    }
  });
});

describe('the table itself', () => {
  it('keys are kebab-case and unique, and doorRow reads each, and throws on one it lacks', () => {
    const keys = rows.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) { expect(k).toMatch(/^[a-z]+(?:-[a-z]+)*$/); expect(doorRow(k)).toBe(OVERLORD_DOORS[k]); }
    expect(() => doorRow('no-such-door')).toThrow();
    expect(() => doorRow('constructor')).toThrow();
  });
  it('the only registration two rows share is card with card-record', () => {
    const by = new Map<string, string[]>();
    for (const [k, r] of rows) by.set(rowRegistration(r), [...(by.get(rowRegistration(r)) ?? []), k]);
    const shared = [...by.values()].filter((ks) => ks.length > 1);
    expect(shared).toEqual([['card', 'card-record']]);
  });
  it('groups and verb classes are words of the vocabulary; an overlord row names one of the server words', () => {
    for (const [k, r] of rows) {
      expect(DOOR_GROUPS, k).toContain(r.group);
      expect(VERB_CLASSES, k).toContain(r.verbClass);
      if (r.group === 'overlord') {
        expect(SERVER_WORDS, k).toContain(r.word);
        expect(['refuse', 'hook'], k).toContain(r.others);
        expect(typeof r.write, k).toBe('boolean');
      }
    }
  });
  it('a GET row is view, a DELETE is never view, and an operator row is never operate', () => {
    for (const [k, r] of rows) {
      if (r.method === 'GET') expect(r.verbClass, k).toBe('view');
      if (r.method === 'DELETE') expect(r.verbClass, k).not.toBe('view');
      if (r.group === 'operator') expect(r.verbClass, k).not.toBe('operate');
    }
  });
  it('the rows on landing include the ratify and designation C Settings doors already on main', () => {
    expect(rows.map(([k]) => k)).toEqual([
      'designate', 'retire', 'rebind', 'restart', 'designation', 'model', 'account-set', 'ladder', 'rung', 'pause', 'latch-clear', 'witness',
      // Confirm the restore (authority journal C): the guard's state, and the door.
      'restore-read', 'restore-confirm',
      'portfolio-rank', 'goals-ratify', 'private-names-read', 'private-names-write',
      'card', 'card-record', 'notes-write', 'notes-read', 'handover', 'probe-read', 'probe-answer',
      // D-8809: the Overlord's team link, the first Overlord door of class `other`.
      'link-team',
      // The Overlord's inbox doors (W1 inbox piece): the inbox, one message and its acknowledge.
      'inbox', 'messages', 'acknowledge',
      // The Overlord's history door (W1, PR B1).
      'history',
      // The timer doors (W1, the Overlord's timers): every other session keeps W1a's path.
      'timer-set', 'timer-list', 'timer-cancel',
    ]);
  });
});

// ── Overlord W1, gates B (plan w1-gates.md Task 6, Review Focus 5; spec §3.6 H2): every operator door that writes records its
// actor through the identity port. For each `operator` row whose verb class is `admin`, the handler of its registration (in
// the row's file) calls `identity.operator(` or `identity.console(`, as `deps.identity.<arm>(` or a local named `identity`.
// A handler that reaches the port only through a named function of the same file (the ladder's `moveRung`, which both the
// rung and the pause doors call) is followed ONE call deep: the helper's own body must hold the call. Read rows (`view`)
// are exempt.
//
// WHAT THIS SCAN CANNOT SEE: a port reached through a function two calls deep, through a function of another file, through
// an alias of the port (`const id = deps.identity`) or through a method call on an object; a registration made through a
// helper or a loop; whether the actor the port returned is the one that reaches the store. It proves the port is asked in the
// handler's reach, not that its answer is what is recorded.
describe('every operator door that writes records its actor through the identity port', () => {
  type FnNode = ts.Node;
  const portCall = (n: ts.Node): boolean => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return false;
    const arm = n.expression.name.text;
    if (arm !== 'operator' && arm !== 'console') return false;
    const recv = n.expression.expression;
    return (ts.isIdentifier(recv) && recv.text === 'identity')
      || (ts.isPropertyAccessExpression(recv) && recv.name.text === 'identity' && ts.isIdentifier(recv.expression) && recv.expression.text === 'deps');
  };
  const walkAll = (node: ts.Node, visit: (n: ts.Node) => void): void => { visit(node); ts.forEachChild(node, (c) => walkAll(c, visit)); };
  const hasPort = (node: ts.Node): boolean => { let f = false; walkAll(node, (n) => { if (portCall(n)) f = true; }); return f; };

  /** The handler of `METHOD path` in a source text (its last argument), or undefined. */
  function handlerOf(text: string, file: string, method: string, route: string): FnNode | undefined {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let found: FnNode | undefined;
    walkAll(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      const c = n.expression;
      if (!ts.isIdentifier(c.expression) || c.expression.text !== 'app' || c.name.text.toUpperCase() !== method) return;
      const first = n.arguments[0];
      if (first === undefined || !ts.isStringLiteralLike(first) || first.text !== route) return;
      found = n.arguments[n.arguments.length - 1];
    });
    return found;
  }
  /** The named helpers of a file: a function declaration, or a `const name = (…) => …` / function expression. */
  function helpersOf(text: string, file: string): Map<string, ts.Node> {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out = new Map<string, ts.Node>();
    walkAll(sf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name !== undefined) out.set(n.name.text, n);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) out.set(n.name.text, n.initializer);
    });
    return out;
  }
  /** `direct` when the handler holds the port call; `via <name>` when one named helper of the file does; else null. */
  function reach(text: string, file: string, method: string, route: string): { how: 'direct' } | { how: 'via'; helper: string } | null | 'no-handler' {
    const h = handlerOf(text, file, method, route);
    if (h === undefined) return 'no-handler';
    if (hasPort(h)) return { how: 'direct' };
    const helpers = helpersOf(text, file);
    const called: string[] = [];
    walkAll(h, (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && helpers.has(n.expression.text)) called.push(n.expression.text); });
    for (const name of called) if (hasPort(helpers.get(name)!)) return { how: 'via', helper: name };
    return null;
  }

  const adminRows = rows.filter(([, r]) => r.group === 'operator' && r.verbClass === 'admin');
  /** The rows whose handler reaches the port only through a helper, as `key -> helper` (pinned below). */
  const followed: Record<string, string> = {};
  for (const [key, r] of adminRows) {
    const got = reach(sourceOf(r.file), r.file, r.method, r.path);
    if (typeof got === 'object' && got !== null && got.how === 'via') followed[key] = got.helper;
  }

  it('there are admin operator rows to check (a zero would make the rest vacuous), and read rows are not among them', () => {
    expect(adminRows.map(([k]) => k)).toEqual([
      'designate', 'retire', 'rebind', 'restart', 'model', 'account-set', 'rung', 'pause', 'latch-clear', 'restore-confirm', 'portfolio-rank', 'goals-ratify',
      'private-names-write',
    ]);
    for (const [k, r] of rows) if (r.group === 'operator' && r.verbClass === 'view') expect(adminRows.map(([x]) => x), k).not.toContain(k);
  });
  for (const [key, r] of adminRows) {
    it(`${key} (${r.method} ${r.path}): its handler reaches identity.operator( or identity.console(`, () => {
      const got = reach(sourceOf(r.file), r.file, r.method, r.path);
      expect(got, `${key} in ${r.file}`).not.toBe('no-handler');
      expect(got, `${key} does not reach the identity port`).not.toBeNull();
    });
  }
  it('the rows that reach the port through a helper of their own file are pinned: the rung and pause doors, through moveRung', () => {
    expect(followed).toEqual({ rung: 'moveRung', pause: 'moveRung' });
  });
  it('CONTROL: a planted admin handler with a row and no port call is red; with the port call, green', () => {
    const none = "app.post('/api/planted', async (req, reply) => { const g = deps.gate(req, reply, {}); return { ok: true }; });\n";
    expect(reach(none, 'x.ts', 'POST', '/api/planted')).toBeNull();
    const direct = "app.post('/api/planted', async (req, reply) => { const a = deps.identity.operator(g.actor); return a; });\n";
    expect(reach(direct, 'x.ts', 'POST', '/api/planted')).toEqual({ how: 'direct' });
    const local = "app.post('/api/planted', (req, reply) => { return identity.console(true, 'device-a'); });\n";
    expect(reach(local, 'x.ts', 'POST', '/api/planted')).toEqual({ how: 'direct' });
  });
  it('CONTROL: a helper that does not reach the port is not followed to green; one that does is, and is named', () => {
    const idle = "const helper = () => 1;\napp.post('/api/planted', async () => helper());\n";
    expect(reach(idle, 'x.ts', 'POST', '/api/planted')).toBeNull();
    const reaching = "const helper = () => deps.identity.operator(a);\napp.post('/api/planted', async () => helper());\n";
    expect(reach(reaching, 'x.ts', 'POST', '/api/planted')).toEqual({ how: 'via', helper: 'helper' });
    // Two calls deep is not followed: the scan's stated width.
    const deep = "const inner = () => deps.identity.operator(a);\nconst outer = () => inner();\napp.post('/api/planted', async () => outer());\n";
    expect(reach(deep, 'x.ts', 'POST', '/api/planted')).toBeNull();
    // An unrelated receiver is not the port.
    const other = "app.post('/api/planted', async () => other.operator(a));\n";
    expect(reach(other, 'x.ts', 'POST', '/api/planted')).toBeNull();
  });
  it('CONTROL: deleting the port call from a real admin handler (the model door) turns it red', () => {
    const text = sourceOf(OVERLORD_ROUTES);
    const at = text.indexOf("app.post('/api/overlord/model'");
    expect(at).toBeGreaterThan(-1);
    const call = text.indexOf('deps.identity.operator(g.actor)', at);
    expect(call).toBeGreaterThan(at);
    const mutated = `${text.slice(0, call)}(g.actor as never)${text.slice(call + 'deps.identity.operator(g.actor)'.length)}`;
    expect(reach(text, OVERLORD_ROUTES, 'POST', '/api/overlord/model')).toEqual({ how: 'direct' });
    expect(reach(mutated, OVERLORD_ROUTES, 'POST', '/api/overlord/model')).toBeNull();
  });
});
