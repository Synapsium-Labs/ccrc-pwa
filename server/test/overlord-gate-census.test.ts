// Overlord W1, gates B (plan w1-gates.md Task 6, Review Focus 1, 2 and 5; spec §11.2, F8): every `overlord`-group door of the
// table (`coord/overlordDoors.ts`) is registered with the box-token `onRequest` form and its handler asks the ONE gate with its
// own row's key, before it touches the coordination store, and stops at once on `refused`:
//
//   const g = await gate(req, reply, '<row key>', { … });
//   if (g.kind === 'refused') return reply;
//
// The card door's recording page asks a second row, `card-record`, before anything is written (before its `insertSnapshot` and
// its `insertCardRead` calls), and stops on `refused` the same way (review 2803 F3, N7). A new Overlord door that forgets the
// call, names another row, goes on after a refusal or reads the store first turns this red.
//
// The scan reads every file an `overlord` row may name (the seven files `overlord-doors-census.test.ts` lists) and refuses a row
// naming any other (review 2803 F5). The runner call is told from the account gate's `deps.gate(req, reply, { … })` by its
// third argument: a string literal is the runner's row key, an object literal is the account gate's, which is not scanned.
//
// WHAT THE SCAN CANNOT SEE: a route registered through a helper, a loop or another registrar (`app.route({…})`, a
// `registerX(app)` that is not one of the files named here, a computed path), a handler that is not an inline function
// (an identifier is refused, not followed), a gate call reached through a helper inside the handler (the call must be a
// top-level `const g = await gate(…)` statement of the handler), and a store reached through a name other than `coord`
// (every door reads the store through the `coord` local or `deps.coord`; a differently named alias would pass the
// "before the store" arm), and a row naming a file outside the seven (refused by the subset test, not followed). It reads literal `app.get|post|put|delete('<path>', …)` calls with the repo's one parser wrapper
// (`scan/parse.ts`), as the other censuses do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from './scan/parse.js';
import { OVERLORD_DOORS } from '../src/coord/overlordDoors.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTINUITY = 'server/src/continuity/routes.ts';
const OVERLORD_ROUTES = 'server/src/coord/overlordRoutes.ts';
const LEDGERS_ROUTES = 'server/src/coord/ledgersRoutes.ts';
const NAME_LIST_ROUTES = 'server/src/operatorModel/nameListRoutes.ts';
const LINKING_ROUTES = 'server/src/linking/routes.ts';
const INBOX_ROUTES = 'server/src/coord/overlordInboxRoutes.ts';
const HISTORY_ROUTES = 'server/src/coord/overlordHistoryRoutes.ts';
const SEQUENCE_ROUTES = 'server/src/coord/overlordSequenceRoutes.ts';
const BOARD_ROUTES = 'server/src/coord/overlordBoardRoutes.ts';
/** The files an `overlord` row may name: the same eight `overlord-doors-census.test.ts` reads (D-8809 added the linking file, the inbox
 *  piece its own, the history door (W1, PR B1) its own, the cursor read of the sequence (W1 sequence C) its own). */
const SCANNED = [OVERLORD_ROUTES, CONTINUITY, LEDGERS_ROUTES, NAME_LIST_ROUTES, LINKING_ROUTES, INBOX_ROUTES, HISTORY_ROUTES, SEQUENCE_ROUTES, BOARD_ROUTES] as const;
const sourceOf = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
const VERBS = new Set(['get', 'post', 'put', 'delete']);

interface Reg { readonly reg: string; readonly options: ts.ObjectLiteralExpression | null; readonly handler: ts.Node | null }

function parse(text: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

/** Every literal `app.<verb>('<path>', [options,] handler)` of a source text, as `METHOD path`. */
export function registrationsIn(text: string, file: string): Reg[] {
  const out: Reg[] = [];
  walk(parse(text, file), (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const callee = n.expression;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'app' || !VERBS.has(callee.name.text)) return;
    const first = n.arguments[0];
    if (first === undefined || !ts.isStringLiteralLike(first)) return;
    const rest = n.arguments.slice(1);
    const options = rest.length >= 2 && ts.isObjectLiteralExpression(rest[0]!) ? (rest[0] as ts.ObjectLiteralExpression) : null;
    out.push({ reg: `${callee.name.text.toUpperCase()} ${first.text}`, options, handler: rest[rest.length - 1] ?? null });
  });
  return out;
}

/** A runner call: `gate(req, reply, '<key>', …)` or `deps.gate(req, reply, '<key>', …)`. The account gate's
 *  `deps.gate(req, reply, { … })` has an object literal for its third argument and is not one. */
const isGateCall = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && (
    (ts.isIdentifier(n.expression) && n.expression.text === 'gate')
    || (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'deps' && n.expression.name.text === 'gate'))
  && !(n.arguments[2] !== undefined && ts.isObjectLiteralExpression(n.arguments[2]));
const callsNamed = (root: ts.Node, name: string): boolean => {
  let found = false;
  walk(root, (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if ((ts.isIdentifier(e) && e.text === name) || (ts.isPropertyAccessExpression(e) && e.name.text === name)) found = true;
    }
  });
  return found;
};
const callsOf = (root: ts.Node, name: string): ts.CallExpression[] => {
  const out: ts.CallExpression[] = [];
  walk(root, (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if ((ts.isIdentifier(e) && e.text === name) || (ts.isPropertyAccessExpression(e) && e.name.text === name)) out.push(n);
    }
  });
  return out;
};

/** The `overlord` rows a file registers, grouped by registration: `METHOD path` to its row keys, in table order. */
export function overlordRowsOf(file: string): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const [key, r] of Object.entries(OVERLORD_DOORS)) {
    if (r.group !== 'overlord' || r.file !== file) continue;
    const k = `${r.method} ${r.path}`;
    by.set(k, [...(by.get(k) ?? []), key]);
  }
  return by;
}

/** Whether the statement after a gate call's `const <name> = await gate(…)` declaration is `if (<name>.kind === 'refused')` whose
 *  branch ends in a `return`. With `top` set the declaration must be a top-level statement of that block. */
function stopViolations(call: ts.CallExpression, label: string, top: ts.Block | null): string[] {
  const aw = call.parent;
  const decl = aw !== undefined && ts.isAwaitExpression(aw) ? aw.parent : undefined;
  const stmt = decl !== undefined && ts.isVariableDeclaration(decl) ? decl.parent?.parent : undefined;
  const block = stmt?.parent;
  if (decl === undefined || !ts.isVariableDeclaration(decl) || stmt === undefined || !ts.isVariableStatement(stmt) || block === undefined
    || !ts.isBlock(block) || (top !== null && block !== top) || !ts.isIdentifier(decl.name)) {
    return [`${label}: the gate( call is not a ${top !== null ? 'top-level ' : ''}\`const g = await gate(...)\` statement`];
  }
  const at = block.statements.indexOf(stmt);
  const next = block.statements[at + 1];
  const name = decl.name.text;
  const cond = next !== undefined && ts.isIfStatement(next) ? next.expression : undefined;
  const stops = cond !== undefined && ts.isBinaryExpression(cond) && cond.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isPropertyAccessExpression(cond.left) && ts.isIdentifier(cond.left.expression) && cond.left.expression.text === name && cond.left.name.text === 'kind'
    && ts.isStringLiteralLike(cond.right) && cond.right.text === 'refused';
  if (!stops) return [`${label}: the statement after the gate( declaration is not \`if (${name}.kind === 'refused') …\``];
  const then = (next as ts.IfStatement).thenStatement;
  const last = ts.isBlock(then) ? then.statements[then.statements.length - 1] : then;
  return last === undefined || !ts.isReturnStatement(last) ? [`${label}: the 'refused' branch does not return`] : [];
}

/** Everything wrong with one registration's handler against its row keys (the first key is the door's own; a second names
 *  the card door's recording page). Empty when it holds the form. */
export function violationsOfRegistration(r: Reg | undefined, keys: readonly string[]): string[] {
  const own = keys[0]!;
  if (r === undefined) return [`${own}: no registration found in the file`];
  const bad: string[] = [];
  // The onRequest option, whose function checks the box token.
  const onRequest = r.options?.properties.find((p): p is ts.PropertyAssignment =>
    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'onRequest');
  if (onRequest === undefined) bad.push(`${own}: no onRequest option`);
  else if (!callsNamed(onRequest.initializer, 'checkMailToken')) bad.push(`${own}: its onRequest does not call checkMailToken`);
  // The handler: an inline function with a block body.
  const h = r.handler;
  if (h === null || !(ts.isArrowFunction(h) || ts.isFunctionExpression(h)) || !ts.isBlock(h.body)) {
    bad.push(`${own}: the handler is not an inline function with a block body`);
    return bad;
  }
  const body = h.body;
  const gates: ts.CallExpression[] = [];
  walk(body, (n) => { if (isGateCall(n)) gates.push(n); });
  gates.sort((a, b) => a.pos - b.pos);
  const keyOf = (c: ts.CallExpression): string | null => { const a = c.arguments[2]; return a !== undefined && ts.isStringLiteralLike(a) ? a.text : null; };
  if (gates.length === 0) { bad.push(`${own}: the handler never calls gate(`); return bad; }
  for (const g of gates) {
    const k = keyOf(g);
    if (k === null) bad.push(`${own}: a gate( call whose key is not a string literal`);
    else if (!keys.includes(k)) bad.push(`${own}: gate( is called with another row's key '${k}'`);
  }
  const first = gates[0]!;
  if (keyOf(first) !== own) bad.push(`${own}: the first gate( call does not name its own row (it names ${JSON.stringify(keyOf(first))})`);
  // The first call is a top-level `const g = await gate(...)` and the next statement stops on `refused`.
  bad.push(...stopViolations(first, own, body));
  // Before the first `coord` or `deps.coord` use (an identifier named coord, a property access included).
  let firstCoord = Number.POSITIVE_INFINITY;
  walk(body, (n) => { if (ts.isIdentifier(n) && n.text === 'coord') firstCoord = Math.min(firstCoord, n.getStart()); });
  if (first.getStart() > firstCoord) bad.push(`${own}: the store (coord) is used before the first gate( call`);
  // The card's recording page: its row's gate( call precedes every write (insertSnapshot(, insertCardRead() and stops on refused.
  for (const extra of keys.slice(1)) {
    const askedCalls = gates.filter((g) => keyOf(g) === extra);
    const asked = askedCalls.map((g) => g.getStart());
    if (asked.length === 0) bad.push(`${own}: no gate( call names ${extra}`);
    for (const write of ['insertSnapshot', 'insertCardRead']) {
      const inserts = callsOf(body, write);
      if (inserts.length === 0) bad.push(`${own}: no ${write}( call (the arm that ${extra} fences)`);
      if (asked.length > 0 && inserts.some((c) => c.getStart() < Math.min(...asked))) bad.push(`${own}: ${write}( is called before the ${extra} gate( call`);
    }
    for (const c of askedCalls) bad.push(...stopViolations(c, `${own}/${extra}`, null));
  }
  return bad;
}

/** The whole file's violations, over its `overlord` rows. */
export function violationsOf(text: string, file: string, rows: Map<string, string[]> = overlordRowsOf(file)): string[] {
  const regs = registrationsIn(text, file);
  const out: string[] = [];
  for (const [reg, keys] of rows) out.push(...violationsOfRegistration(regs.find((r) => r.reg === reg), keys));
  return out;
}

const CONTINUITY_TEXT = sourceOf(CONTINUITY);
const rowsOfContinuity = overlordRowsOf(CONTINUITY);

/** Edits a source text in memory; the pattern must match, so a source change that moves the target turns the control red
 *  rather than leaving it a no-op. */
function mutate(text: string, from: RegExp, to: string): string {
  expect(from.test(text), `the control's target is gone: ${from}`).toBe(true);
  return text.replace(from, to);
}

describe('every overlord door asks the one gate, with its own row, before the store', () => {
  it('the scan finds the six start-door registrations and the three timer doors, the card one carrying two rows (a zero would make the rest vacuous)', () => {
    expect([...rowsOfContinuity.keys()].sort()).toEqual([
      'GET /api/sessions/:id/card', 'GET /api/sessions/:id/notes', 'GET /api/sessions/:id/probe', 'GET /api/timers',
      'POST /api/sessions/:id/handover', 'POST /api/sessions/:id/notes', 'POST /api/sessions/:id/probe', 'POST /api/timers',
      'POST /api/timers/:id/cancel',
    ]);
    expect(rowsOfContinuity.get('GET /api/sessions/:id/card')).toEqual(['card', 'card-record']);
    const regs = registrationsIn(CONTINUITY_TEXT, CONTINUITY).map((r) => r.reg);
    for (const k of rowsOfContinuity.keys()) expect(regs, k).toContain(k);
  });

  for (const [reg, keys] of rowsOfContinuity) {
    it(`${reg} (${keys.join(', ')}): onRequest checks the box token; gate( with its row's key leads, and stops on refused`, () => {
      const r = registrationsIn(CONTINUITY_TEXT, CONTINUITY).find((x) => x.reg === reg);
      expect(violationsOfRegistration(r, keys)).toEqual([]);
    });
  }

  it('the card door asks card-record before its insertCardRead call (pinned by key, not by position)', () => {
    const r = registrationsIn(CONTINUITY_TEXT, CONTINUITY).find((x) => x.reg === 'GET /api/sessions/:id/card')!;
    const calls = callsOf(r.handler!, 'insertCardRead');
    expect(calls).toHaveLength(1);
    const record = (() => { const out: ts.CallExpression[] = []; walk(r.handler!, (n) => { if (isGateCall(n) && ts.isStringLiteralLike(n.arguments[2]!) && (n.arguments[2] as ts.StringLiteral).text === 'card-record') out.push(n); }); return out; })();
    expect(record).toHaveLength(1);
    expect(record[0]!.getStart()).toBeLessThan(calls[0]!.getStart());
  });

  it('every overlord row names a scanned file, and the scan covers the seven files a row may name (F5)', () => {
    const files = new Set(Object.values(OVERLORD_DOORS).filter((r) => r.group === 'overlord').map((r) => r.file));
    expect(files.size).toBeGreaterThan(0);
    for (const f of files) expect(SCANNED as readonly string[], f).toContain(f);
  });

  for (const file of SCANNED.filter((f) => f !== CONTINUITY)) {
    it(`${file}: any overlord-group row it holds is checked as the continuity file's are (the linking file's link-team today)`, () => {
      const text = sourceOf(file);
      // Non-vacuity: the file is scanned and registers doors.
      expect(registrationsIn(text, file).length).toBeGreaterThan(0);
      expect(violationsOf(text, file)).toEqual([]);
    });
  }

  it('the card door asks card-record before insertSnapshot( and insertCardRead(, and stops on a refusal (F3, N7)', () => {
    const r = registrationsIn(CONTINUITY_TEXT, CONTINUITY).find((x) => x.reg === 'GET /api/sessions/:id/card')!;
    const record: ts.CallExpression[] = [];
    walk(r.handler!, (n) => { if (isGateCall(n) && ts.isStringLiteralLike(n.arguments[2]!) && (n.arguments[2] as ts.StringLiteral).text === 'card-record') record.push(n); });
    expect(record).toHaveLength(1);
    for (const write of ['insertSnapshot', 'insertCardRead']) {
      const calls = callsOf(r.handler!, write);
      expect(calls.length, write).toBeGreaterThan(0);
      for (const c of calls) expect(record[0]!.getStart(), write).toBeLessThan(c.getStart());
    }
    expect(stopViolations(record[0]!, 'card/card-record', null)).toEqual([]);
  });

  it('D-8809: the linking file registers the link-team door, which holds the form (a zero would make its loop case vacuous)', () => {
    const rows = overlordRowsOf(LINKING_ROUTES);
    expect([...rows.entries()]).toEqual([['POST /api/linking/confirm', ['link-team']]]);
    expect(violationsOf(sourceOf(LINKING_ROUTES), LINKING_ROUTES)).toEqual([]);
  });

  it('the inbox file registers the inbox, messages and acknowledge doors, each holding the form (a zero would make its loop case vacuous)', () => {
    const rows = overlordRowsOf(INBOX_ROUTES);
    expect([...rows.entries()]).toEqual([
      ['GET /api/overlord/inbox', ['inbox']], ['GET /api/overlord/messages/:id', ['messages']], ['POST /api/overlord/messages/:id/acknowledge', ['acknowledge']],
    ]);
    expect(violationsOf(sourceOf(INBOX_ROUTES), INBOX_ROUTES)).toEqual([]);
  });

  it('the history file registers the history door, which holds the form (a zero would make its loop case vacuous)', () => {
    const rows = overlordRowsOf(HISTORY_ROUTES);
    expect([...rows.entries()]).toEqual([['POST /api/overlord/history', ['history']]]);
    expect(violationsOf(sourceOf(HISTORY_ROUTES), HISTORY_ROUTES)).toEqual([]);
  });

  it('CONTROL: a history door that skips the gate call is found', () => {
    const t = mutate(sourceOf(HISTORY_ROUTES), /const g = await deps\.gate\(req, reply, 'history'[^\n]*\n\s*if \(g\.kind === 'refused'\) return reply;\n/, '');
    expect(violationsOf(t, HISTORY_ROUTES).join('\n')).toMatch(/history: the handler never calls gate\(/);
  });

  it('the sequence file registers the cursor read, which holds the form (a zero would make its loop case vacuous)', () => {
    const rows = overlordRowsOf(SEQUENCE_ROUTES);
    expect([...rows.entries()]).toEqual([['GET /api/overlord/sequence', ['sequence']]]);
    expect(violationsOf(sourceOf(SEQUENCE_ROUTES), SEQUENCE_ROUTES)).toEqual([]);
  });

  it('CONTROL: a cursor read that skips the gate call is found', () => {
    const t = mutate(sourceOf(SEQUENCE_ROUTES), /const g = await deps\.gate\(req, reply, 'sequence'[^\n]*\n\s*if \(g\.kind === 'refused'\) return reply;\n/, '');
    expect(violationsOf(t, SEQUENCE_ROUTES).join('\n')).toMatch(/sequence: the handler never calls gate\(/);
  });

  it('the board file registers the board read, which holds the form (board B2)', () => {
    const rows = overlordRowsOf(BOARD_ROUTES);
    expect([...rows.entries()]).toEqual([['GET /api/overlord/board', ['board']]]);
    expect(violationsOf(sourceOf(BOARD_ROUTES), BOARD_ROUTES)).toEqual([]);
  });

  // Call 1590, ruling point 5: the history and board reads are unfenced, so the gate call is all that stands before them.
  it('CONTROL: a board read that skips the gate call is found', () => {
    const t = mutate(sourceOf(BOARD_ROUTES), /const g = await deps\.gate\(req, reply, 'board'[^\n]*\n\s*if \(g\.kind === 'refused'\) return reply;\n/, '');
    expect(violationsOf(t, BOARD_ROUTES).join('\n')).toMatch(/board: the handler never calls gate\(/);
  });

  it('the whole continuity file is clean, over every overlord row', () => {
    expect(violationsOf(CONTINUITY_TEXT, CONTINUITY)).toEqual([]);
  });
});

describe('CONTROL: the census goes red on each way to break the form (edited in memory, re-scanned)', () => {
  it('a handler that skips the gate call (the handover door)', () => {
    const t = mutate(CONTINUITY_TEXT, /const g = await gate\(req, reply, 'handover'[^\n]*\n\s*if \(g\.kind === 'refused'\) return reply;\n/, '');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/handover: the handler never calls gate\(/);
  });

  it('a handler that calls the gate with another row\'s key (the notes write door passes card)', () => {
    const t = mutate(CONTINUITY_TEXT, /await gate\(req, reply, 'notes-write'/, "await gate(req, reply, 'card'");
    const v = violationsOf(t, CONTINUITY).join('\n');
    expect(v).toMatch(/notes-write: gate\( is called with another row's key 'card'/);
    expect(v).toMatch(/notes-write: the first gate\( call does not name its own row/);
  });

  it('a handler that goes on after refused (the probe answer door has no return)', () => {
    const t = mutate(CONTINUITY_TEXT, /(await gate\(req, reply, 'probe-answer'[^\n]*\n\s*)if \(g\.kind === 'refused'\) return reply;/, "$1if (g.kind === 'refused') void 0;");
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/probe-answer: the 'refused' branch does not return/);
  });

  it('a handler whose refused branch is a block that does not return', () => {
    const t = mutate(CONTINUITY_TEXT, /(await gate\(req, reply, 'probe-read'[^\n]*\n\s*)if \(g\.kind === 'refused'\) return reply;/, "$1if (g.kind === 'refused') { void 0; }");
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/probe-read: the 'refused' branch does not return/);
  });

  it('a handler where something sits between the declaration and the refused check', () => {
    const t = mutate(CONTINUITY_TEXT, /(await gate\(req, reply, 'notes-read'[^\n]*\n)/, '$1    void 0;\n');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/notes-read: the statement after the gate\( declaration is not/);
  });

  it('a handler that reads the store before the gate (a coord access first)', () => {
    const t = mutate(CONTINUITY_TEXT, /(\n\s*)(const g = await gate\(req, reply, 'notes-write')/, '$1const early = deps.coord;$1$2');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/notes-write: the store \(coord\) is used before the first gate\( call/);
  });

  it('a card handler that records before asking card-record', () => {
    const t = mutate(CONTINUITY_TEXT, /(\n\s*)(const f = await gate\(req, reply, 'card-record')/, '$1coord.insertCardRead({} as never);$1$2');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/card: insertCardRead\( is called before the card-record gate\( call/);
  });

  it('a card handler whose card-record call sits after insertSnapshot (the F3 order undone)', () => {
    const t = mutate(CONTINUITY_TEXT, /(\n\s*)(const f = await gate\(req, reply, 'card-record')/, '$1coord.insertSnapshot({} as never);$1$2');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/card: insertSnapshot\( is called before the card-record gate\( call/);
  });

  it('a card handler whose card-record refused branch does not return', () => {
    const t = mutate(CONTINUITY_TEXT, /(await gate\(req, reply, 'card-record'[^\n]*\n\s*)if \(f\.kind === 'refused'\) return reply;/, "$1if (f.kind === 'refused') void 0;");
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/card\/card-record: the 'refused' branch does not return/);
  });

  it('a card handler where something sits between the card-record declaration and its refused check', () => {
    const t = mutate(CONTINUITY_TEXT, /(await gate\(req, reply, 'card-record'[^\n]*\n)/, '$1        void 0;\n');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/card\/card-record: the statement after the gate\( declaration is not/);
  });

  it('a planted overlord row on a ledger registration that holds only the account gate is red (the account gate is not the runner)', () => {
    const text = sourceOf(LEDGERS_ROUTES);
    expect(violationsOf(text, LEDGERS_ROUTES)).toEqual([]);
    const planted = new Map([['POST /api/programmes/:slug/goals/ratify', ['planted-door']]]);
    expect(text).toMatch(/app\.post\('\/api\/programmes\/:slug\/goals\/ratify'[^\n]*\n\s*const g = deps\.gate\(req, reply, \{/);
    expect(violationsOf(text, LEDGERS_ROUTES, planted)).toContain('planted-door: the handler never calls gate(');
  });

  it('a card handler that never asks card-record', () => {
    const t = mutate(CONTINUITY_TEXT, /await gate\(req, reply, 'card-record'/, "await gate(req, reply, 'card'");
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/card: no gate\( call names card-record/);
  });

  it('a registration with no box-token onRequest (the handover door)', () => {
    const t = mutate(CONTINUITY_TEXT, /checkMailToken\(deps\.mailToken\(\), req\.headers\[MAIL_TOKEN_HEADER\], 'POST \/api\/sessions\/:id\/handover'\)/, '({ ok: true } as never)');
    expect(violationsOf(t, CONTINUITY).join('\n')).toMatch(/handover: its onRequest does not call checkMailToken/);
  });

  it('a planted overlord row whose registration is absent is red (the table and the file agree)', () => {
    expect(violationsOfRegistration(undefined, ['planted-door'])).toEqual(['planted-door: no registration found in the file']);
  });

  it('the controls are red only through their edit: the unedited text is clean', () => {
    expect(violationsOf(CONTINUITY_TEXT, CONTINUITY)).toEqual([]);
  });
});
