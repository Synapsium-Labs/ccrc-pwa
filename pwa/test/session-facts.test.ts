// THE SESSION FACTS, version and cost (D-5104; the audit's F6, data half).
//
// Every `FleetSession` carries `version` (Claude Code's own, from its session
// file) and `usage`, whose `cost` is the statusline's `cost.total_cost_usd`
// and whose `stale` is the server's freshness verdict. Nothing in `pwa/src`
// read either before `sessionFacts`. These cases pin the one rule the model
// exists for: a value nobody measured is `—`, never `$0.00` and never an empty
// word, and a measured zero is a value.
//
// MEASURED (plan Task 16, Step 3; each mutant applied alone to
// `sessionFacts.ts` and run against this file alone; baseline 5 passed):
//
//   | mutant                                       | red                                         |
//   |----------------------------------------------|---------------------------------------------|
//   | `cost ?? 0`                                  | a missing usage key…; stale is carried      |
//   | `s.usage.cost` without the optional chain    | a missing usage key… and a null version… —  |
//   |                                              | both throw `Cannot read properties of …`    |
//   | `stale` dropped (`stale: false`)             | stale is carried                            |
//   | `0` treated as unmeasured (`&& cost !== 0`,  | a measured zero is $0.00                    |
//   | and the truthy `cost ?` form)                |                                             |
//   | the empty-version arm deleted                | a null version is unmeasured…               |
//   | `-0` not normalised                          | a measured zero is $0.00                    |
//   | the `<$0.01` arm deleted                     | cost reads as US dollars…                   |
import { readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { FleetSession, SessionUsage } from '../../shared/api';
import {
  COORDINATOR_WORD, coordinatorRole, headerFacts, sessionFacts as fleetFacts,
} from '../src/fleet/sessionFacts';
import { sessionFacts } from '../src/session/sessionFacts';
import { fleetSession } from './fleetFixture';
import { parseTs } from './literalWalker';

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  ts: 1_700_000_000, model: null, class: null, effort: null, ctxPct: null,
  cost: null, stale: false, ...over,
});

const withCost = (cost: number | null, stale = false): FleetSession =>
  fleetSession({ usage: usage({ cost, stale }) });

/** A row from a server older than the `usage` field. A `fleet` frame is CAST,
 *  never revived, so on such a row the key is simply absent: `undefined` at
 *  runtime, which the declared `SessionUsage | null` does not admit. */
const olderServerRow = (): FleetSession => {
  const row: Record<string, unknown> = { ...fleetSession({ version: '2.1.0' }) };
  delete row['usage'];
  return row as unknown as FleetSession;
};

describe('sessionFacts (D-5104, F6): version and cost as words, never a fabricated value', () => {
  it('a null version is unmeasured, never an empty word', () => {
    expect(sessionFacts(fleetSession({ version: null })).version).toEqual({ word: '—', measured: false });
    // The server passes any string through from the session file
    // (`livestate.ts`), so an empty one can arrive. It is no word either.
    expect(sessionFacts(fleetSession({ version: '' })).version).toEqual({ word: '—', measured: false });
    // A string is shown as it is.
    expect(sessionFacts(fleetSession({ version: '2.1.0' })).version).toEqual({ word: '2.1.0', measured: true });
  });

  it('a missing usage key (an older server) is unmeasured, not $0.00', () => {
    const row = olderServerRow();
    expect('usage' in row, 'the fixture really omits the key').toBe(false);
    expect(sessionFacts(row).cost).toEqual({ word: '—', measured: false, stale: false });
    // No sidecar reading (`null`), and a reading that carries no cost, are the
    // same fact to this model: nobody measured a spend.
    expect(sessionFacts(fleetSession({ usage: null })).cost).toEqual({ word: '—', measured: false, stale: false });
    expect(sessionFacts(withCost(null)).cost).toEqual({ word: '—', measured: false, stale: false });
    // The version beside it is still read: one missing fact is not two.
    expect(sessionFacts(row).version).toEqual({ word: '2.1.0', measured: true });
  });

  it('cost reads as US dollars at two decimals, with <$0.01 below a cent', () => {
    expect(sessionFacts(withCost(1.5)).cost).toEqual({ word: '$1.50', measured: true, stale: false });
    expect(sessionFacts(withCost(0.42)).cost.word).toBe('$0.42');
    expect(sessionFacts(withCost(3)).cost.word).toBe('$3.00');
    expect(sessionFacts(withCost(0.01)).cost.word).toBe('$0.01');
    expect(sessionFacts(withCost(1234.5)).cost.word).toBe('$1,234.50');
    // Above zero and below a cent: spent, but less than two decimals can say.
    expect(sessionFacts(withCost(0.0042)).cost).toEqual({ word: '<$0.01', measured: true, stale: false });
    expect(sessionFacts(withCost(0.0099)).cost.word).toBe('<$0.01');
  });

  it('a measured zero is $0.00, measured', () => {
    expect(sessionFacts(withCost(0)).cost).toEqual({ word: '$0.00', measured: true, stale: false });
    // `JSON.parse` keeps a negative zero, and it is the same measurement.
    expect(sessionFacts(withCost(-0)).cost).toEqual({ word: '$0.00', measured: true, stale: false });
  });

  it('stale is carried', () => {
    expect(sessionFacts(withCost(2, true)).cost).toEqual({ word: '$2.00', measured: true, stale: true });
    expect(sessionFacts(withCost(2, false)).cost).toEqual({ word: '$2.00', measured: true, stale: false });
    // A stale reading that carries no cost is still a stale reading.
    expect(sessionFacts(withCost(null, true)).cost).toEqual({ word: '—', measured: false, stale: true });
  });
});

// THE COORDINATOR'S ONE READER AND ONE WORD (D-6714, plan 2026-10-22-desktop-polish Task T5a): the palette's session
// entries ask `coordinatorRole` as the row's facts do, and say `COORDINATOR_WORD` as the header and the details do.
describe('coordinatorRole and COORDINATOR_WORD (D-6714)', () => {
  const SRC = path.join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
  const nodes = (file: string, pick: (n: ts.Node) => boolean): ts.Node[] => {
    const out: ts.Node[] = [];
    const walk = (n: ts.Node): void => { if (pick(n)) out.push(n); ts.forEachChild(n, walk); };
    walk(parseTs(file));
    return out;
  };
  const isCoordinatorLiteral = (n: ts.Node): boolean =>
    (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === 'coordinator';
  /** `x === 'coordinator'` (or `==`, `!==`, `!=`) where `x` is `role` or a `.role` read. */
  const roleComparison = (n: ts.Node): boolean => {
    if (!ts.isBinaryExpression(n)) return false;
    const op = n.operatorToken.kind;
    if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken].includes(op)) return false;
    const isRole = (e: ts.Expression): boolean => (ts.isIdentifier(e) && e.text === 'role')
      || (ts.isPropertyAccessExpression(e) && e.name.text === 'role');
    return (isRole(n.left) && isCoordinatorLiteral(n.right)) || (isRole(n.right) && isCoordinatorLiteral(n.left));
  };
  const enclosingFunction = (n: ts.Node): string | null => {
    for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
      if (ts.isFunctionDeclaration(p)) return p.name?.text ?? null;
    }
    return null;
  };

  it("coordinatorRole: only 'coordinator' is a coordinator; null, absent and any other value are not", () => {
    expect(coordinatorRole(fleetSession({ role: 'coordinator' }))).toBe(true);
    expect(coordinatorRole(fleetSession({ role: null }))).toBe(false);
    const { role: _role, ...absent } = fleetSession();
    expect(coordinatorRole(absent as unknown as FleetSession)).toBe(false);
    for (const other of ['worker', 'Coordinator', 'coordinator ', '', 1, true]) {
      expect(coordinatorRole(fleetSession({ role: other as unknown as FleetSession['role'] })), String(other)).toBe(false);
    }
  });

  it('the coordinator word has one home', () => {
    expect(COORDINATOR_WORD).toBe('coordinator');
    const lead = fleetSession({ id: 'lead', role: 'coordinator' });
    const role = headerFacts(fleetFacts({ session: lead, now: 0 })).find((f) => f.key === 'role');
    expect(role?.text, "headerFacts' role fact").toBe(COORDINATOR_WORD);

    // sessionFacts.ts: headerFacts' role fact takes COORDINATOR_WORD as its text, never a literal.
    const facts = path.join(SRC, 'fleet', 'sessionFacts.ts');
    const roleFacts = nodes(facts, (n) => ts.isObjectLiteralExpression(n) && n.properties.some((p) =>
      ts.isPropertyAssignment(p) && p.name.getText() === 'key' && ts.isStringLiteral(p.initializer) && p.initializer.text === 'role'));
    expect(roleFacts, "headerFacts' one role fact").toHaveLength(1);
    const text = (roleFacts[0] as ts.ObjectLiteralExpression).properties.find((p) => p.name?.getText() === 'text');
    expect(text !== undefined && ts.isPropertyAssignment(text) ? text.initializer.getText() : null).toBe('COORDINATOR_WORD');

    // SessionDetails.tsx imports the word and spells it nowhere: no JSX text and no string that is the whole word.
    const details = path.join(SRC, 'session', 'SessionDetails.tsx');
    // The module `name` is imported from, under its own name (an alias either way is refused), or null.
    const importedFrom = (file: string, name: string): string | null => {
      for (const st of parseTs(file).statements) {
        if (!ts.isImportDeclaration(st) || st.importClause?.namedBindings === undefined) continue;
        const b = st.importClause.namedBindings;
        if (ts.isNamedImports(b) && b.elements.some((e) => (e.propertyName ?? e.name).text === name && e.name.text === name)) {
          return (st.moduleSpecifier as ts.StringLiteral).text;
        }
      }
      return null;
    };
    expect(importedFrom(details, 'COORDINATOR_WORD'), 'SessionDetails.tsx imports COORDINATOR_WORD from fleet/sessionFacts, its one owner').toBe('../fleet/sessionFacts');
    const spelled = nodes(details, (n) => isCoordinatorLiteral(n) || (ts.isJsxText(n) && n.text.trim() === 'coordinator'));
    expect(spelled.map((n) => n.getText()), 'SessionDetails.tsx spells the word').toEqual([]);

    // sessionEntries.ts (the palette's session builder) imports the word; its two wording arrows `groupWords` and
    // `labelWords` reference it and hold no string or template text that spells it; nothing else in the file does.
    const entries = path.join(SRC, 'command', 'sessionEntries.ts');
    expect(importedFrom(entries, 'COORDINATOR_WORD'), 'sessionEntries.ts imports COORDINATOR_WORD from fleet/sessionFacts, its one owner').toBe('../fleet/sessionFacts');
    type TextPart = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail;
    const textPart = (n: ts.Node): n is TextPart => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
      || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
    const spellsWord = (n: ts.Node): boolean => textPart(n) && /\bcoordinator\b/i.test(n.text);
    for (const name of ['groupWords', 'labelWords']) {
      const owners = parseTs(entries).statements.filter(ts.isVariableStatement).flatMap((st) => st.declarationList.declarations)
        .filter((d) => d.name.getText() === name && d.initializer !== undefined && ts.isArrowFunction(d.initializer));
      expect(owners, `sessionEntries.ts has the top-level arrow ${name}`).toHaveLength(1);
      const body = (owners[0]!.initializer as ts.ArrowFunction).body;
      const inBody: ts.Node[] = [];
      const walk = (n: ts.Node): void => { inBody.push(n); ts.forEachChild(n, walk); };
      walk(body);
      expect(inBody.some((n) => ts.isIdentifier(n) && n.text === 'COORDINATOR_WORD'), `${name} says COORDINATOR_WORD`).toBe(true);
      expect(inBody.filter(spellsWord).map((n) => n.getText()), `${name} spells the word`).toEqual([]);
    }
    expect(nodes(entries, spellsWord).map((n) => n.getText()), 'sessionEntries.ts spells the word').toEqual([]);

    // coordinatorRole is the only `role === 'coordinator'` comparison in pwa/src.
    const comparisons = files(SRC).flatMap((f) => nodes(f, roleComparison)
      .map((n) => `${path.relative(SRC, f)}:${enclosingFunction(n) ?? '<top>'}`));
    expect(comparisons).toEqual(['fleet/sessionFacts.ts:coordinatorRole']);
  });
});
