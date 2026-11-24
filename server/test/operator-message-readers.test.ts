// Overlord W1, inbox piece, Task 3 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`, question 20, Review Focus 1; spec
// §3.8, H7, H10): the words of the operator's messages are read in ONE place. Outside `server/src/operatorModel/`:
//   1. a reader that returns text (`messageById`, `unsettledMessages`, `settledRows`, `unnudged`) is called only inside a route
//      handler whose registration names an `OVERLORD_DOORS` row of group `overlord` with `others: 'refuse'` (a door only the
//      designated session holding the live key passes), or whose `METHOD path` is in the hand-kept `OPERATOR_MESSAGE_DOORS`
//      (the operator's own doors, behind the account gate: empty in W1; the chat and the card add theirs when they ship);
//   2. BOTH WAYS: every handler found that reads text is listed in `TEXT_READING_DOORS` (`['messages']` in W1), and every listed
//      door reads;
//   3. no string or template literal names the private store's tables (`operator_messages`, `read_ledger`), so no SQL on them
//      is written outside the store;
//   4. the opener (`openOperatorModelDb(`) is called nowhere outside `server/src/operatorModel/`, and the store's opener
//      (`openOperatorModelStore(`) only in `server/src/index.ts`. (The plan said `openOperatorModelDb(` only in `index.ts`: on
//      this tree `index.ts` opens the store through `openOperatorModelStore`, which calls the opener inside `operatorModel/`.)
//
// WHAT THIS SCAN CANNOT SEE: a reader reached through an alias (`const f = store.messageById; f(1)`), a destructured method, a
// computed member name, a call through `any`, a table name built from pieces (`'operator_' + 'messages'`), a registration made
// through a helper, a loop or another registrar (`app.route({…})`), and a text reader called from a function that a handler
// calls (the call is judged where it is written, so a helper outside a handler is a violation, never followed). A handler that
// passes the registration test and then hands the store to code elsewhere is not followed either. It reads literal
// `app.get|post|put|delete('<path>', …)` calls with the repo's one parser wrapper (`scan/parse.ts`).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from './scan/parse.js';
import { OVERLORD_DOORS } from '../src/coord/overlordDoors.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(REPO, 'server', 'src');
const STORE_DIR = 'server/src/operatorModel/';
const TEXT_READERS = new Set(['messageById', 'unsettledMessages', 'settledRows', 'unnudged']);
const PRIVATE_TABLES = /\b(?:operator_messages|read_ledger)\b/;
const VERBS = new Set(['get', 'post', 'put', 'delete']);

/** The hand-kept operator doors (`METHOD path`, each with the file that registers it and its reason) that may read text: the
 *  operator's own, behind the account gate. Empty in W1; the chat and the card add their entries when they ship. */
const OPERATOR_MESSAGE_DOORS: Readonly<Record<string, { readonly file: string; readonly why: string }>> = {};
/** The doors (OVERLORD_DOORS keys) that read a message's text, and no others (both ways). */
const TEXT_READING_DOORS = ['messages'];
/** Existing callers outside the store that the rule would red, each with its file and reason. None on this tree (measured: every
 *  call of the four readers outside `operatorModel/` is the `messages` handler's). */
const TEXT_READER_ALLOWLIST: Readonly<Record<string, string>> = {};

const rel = (abs: string): string => path.relative(REPO, abs).split(path.sep).join('/');
function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => path.join(e.parentPath, e.name));
}
const parse = (text: string, file: string): ts.SourceFile => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function walk(node: ts.Node, visit: (n: ts.Node) => void): void { visit(node); ts.forEachChild(node, (c) => walk(c, visit)); }

/** The `METHOD path` of the `app.<verb>('<path>', …)` registration whose HANDLER (its last argument) holds `node`, or null. */
function registrationOf(node: ts.Node): string | null {
  for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
    if (!ts.isCallExpression(p) || !ts.isPropertyAccessExpression(p.expression)) continue;
    const callee = p.expression;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'app' || !VERBS.has(callee.name.text)) continue;
    const first = p.arguments[0];
    const handler = p.arguments[p.arguments.length - 1];
    if (first === undefined || !ts.isStringLiteralLike(first) || handler === undefined || p.arguments.length < 2) continue;
    if (node.pos >= handler.pos && node.end <= handler.end) return `${callee.name.text.toUpperCase()} ${first.text}`;
  }
  return null;
}

/** The OVERLORD_DOORS key a registration in `file` names, when its row is an Overlord door that refuses every other caller. */
function refusingDoorOf(file: string, reg: string): string | null {
  for (const [key, row] of Object.entries(OVERLORD_DOORS)) {
    if (row.group === 'overlord' && row.others === 'refuse' && row.file === file && `${row.method} ${row.path}` === reg) return key;
  }
  return null;
}

interface Scan { readonly violations: string[]; readonly textDoors: Set<string> }

/** One file's findings. `file` is repo-relative. */
export function scanFile(text: string, file: string): Scan {
  const out: Scan = { violations: [], textDoors: new Set() };
  const inStore = file.startsWith(STORE_DIR);
  walk(parse(text, file), (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (name === null || inStore) { /* the store's own files are the readers' home */ } else if (TEXT_READERS.has(name)) {
        const reg = registrationOf(n);
        const key = reg === null ? null : refusingDoorOf(file, reg);
        if (key !== null) out.textDoors.add(key);
        else if (reg !== null && Object.prototype.hasOwnProperty.call(OPERATOR_MESSAGE_DOORS, reg) && OPERATOR_MESSAGE_DOORS[reg]!.file === file) { /* an operator door */ }
        else if (!Object.prototype.hasOwnProperty.call(TEXT_READER_ALLOWLIST, `${file}#${name}`)) {
          out.violations.push(`${file}: ${name}( is called ${reg === null ? 'outside a route handler' : `in ${reg}, which is no Overlord door that refuses every other caller`}`);
        }
      } else if (name === 'openOperatorModelDb') out.violations.push(`${file}: openOperatorModelDb( is called outside ${STORE_DIR}`);
      else if (name === 'openOperatorModelStore' && file !== 'server/src/index.ts') out.violations.push(`${file}: openOperatorModelStore( is called outside server/src/index.ts`);
    }
    if (!inStore && (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && PRIVATE_TABLES.test(n.text)) {
      out.violations.push(`${file}: a string names the private store's tables`);
    }
  });
  return out;
}

const FILES = srcFiles(SRC).map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
const SCANS = FILES.map((f) => ({ ...f, scan: scanFile(f.text, f.file) }));
const INBOX = 'server/src/coord/overlordInboxRoutes.ts';
const textOf = (file: string): string => FILES.find((f) => f.file === file)!.text;

describe('the operator\'s words are read in one place', () => {
  it('scans the whole of server/src (a zero would make every other case vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(FILES.some((f) => f.file.startsWith(STORE_DIR))).toBe(true);
  });

  it('no file outside the store calls a text reader anywhere but a refusing Overlord door\'s handler, or touches the private tables or the opener', () => {
    expect(SCANS.flatMap((s) => s.scan.violations)).toEqual([]);
  });

  it('BOTH WAYS: the doors found reading text are exactly TEXT_READING_DOORS', () => {
    const found = new Set(SCANS.flatMap((s) => [...s.scan.textDoors]));
    expect([...found].sort()).toEqual([...TEXT_READING_DOORS].sort());
    for (const key of TEXT_READING_DOORS) {
      const row = OVERLORD_DOORS[key];
      expect(row?.group, key).toBe('overlord');
      expect(row && row.group === 'overlord' ? row.others : null, key).toBe('refuse');
      expect(SCANS.find((s) => s.scan.textDoors.has(key))?.file, key).toBe(INBOX);
    }
  });

  it('the operator door list and the allowlist are empty in W1, and name only registered doors when they are not', () => {
    for (const [reg, e] of Object.entries(OPERATOR_MESSAGE_DOORS)) {
      expect(textOf(e.file), reg).toContain(`'${reg.split(' ')[1]!}'`);
      expect(e.why.length, reg).toBeGreaterThan(10);
    }
    expect(Object.keys(OPERATOR_MESSAGE_DOORS)).toEqual([]);
    expect(Object.keys(TEXT_READER_ALLOWLIST)).toEqual([]);
  });

  it('the store itself writes SQL on both tables (the scan reads them where they live)', () => {
    const store = FILES.filter((f) => f.file.startsWith(STORE_DIR)).map((f) => f.text).join('\n');
    expect(store).toContain('operator_messages');
    expect(store).toContain('read_ledger');
    expect(textOf('server/src/index.ts')).toContain('openOperatorModelStore(');
  });
});

describe('CONTROL: each way to break the rule is found, edited in memory and re-scanned', () => {
  it('a text reader called in a lane function (outside any handler)', () => {
    const planted = `${textOf('server/src/coord/overlordInboxRoutes.ts')}\nexport function laneRead(deps: { inboxStore: { messageById(i: number): unknown } }): unknown { return deps.inboxStore.messageById(1); }\n`;
    const v = scanFile(planted, INBOX).violations;
    expect(v.join('\n')).toMatch(/messageById\( is called outside a route handler/);
  });

  it('a text reader called in the handler of a hook row (the card door), and in a handler no row names', () => {
    const card = 'server/src/continuity/routes.ts';
    const marker = "app.get('/api/sessions/:id/card', ";
    expect(textOf(card)).toContain(marker);
    const planted = textOf(card).replace(marker, "app.get('/api/sessions/:id/card', ");
    // Plant inside the card handler: the first statement after its async arrow's opening.
    const at = planted.indexOf('async (req, reply) => {', planted.indexOf(marker));
    expect(at).toBeGreaterThan(0);
    const edited = `${planted.slice(0, at)}async (req, reply) => { deps.inboxStore.unsettledMessages();${planted.slice(at + 'async (req, reply) => {'.length)}`;
    expect(scanFile(edited, card).violations.join('\n')).toMatch(/unsettledMessages\( is called in GET \/api\/sessions\/:id\/card, which is no Overlord door that refuses every other caller/);
    const extra = `${textOf(INBOX)}\napp.get('/api/overlord/other', async () => deps.inboxStore.settledRows());\n`;
    expect(scanFile(extra, INBOX).violations.join('\n')).toMatch(/settledRows\( is called in GET \/api\/overlord\/other/);
  });

  it('the messages handler\'s own call passes, and the same call moved out of it does not', () => {
    expect([...scanFile(textOf(INBOX), INBOX).textDoors]).toEqual(['messages']);
    expect(scanFile(textOf(INBOX), INBOX).violations).toEqual([]);
    const moved = textOf(INBOX).replace('deps.inboxStore.messageById(id.id)', 'deps.inboxStore.messageFactsById(id.id)');
    expect(moved).not.toBe(textOf(INBOX));
    expect([...scanFile(moved, INBOX).textDoors]).toEqual([]);
  });

  it('SQL naming the private tables in a coord file', () => {
    const planted = `${textOf('server/src/coord/overlordRead.ts')}\nconst q = 'SELECT text FROM operator_messages';\nconst t = \`SELECT count(*) FROM \${'x'} read_ledger\`;\n`;
    const v = scanFile(planted, 'server/src/coord/overlordRead.ts').violations;
    expect(v.filter((x) => /names the private store's tables/.test(x))).toHaveLength(2);
  });

  it('a second opener call, and the store opener outside the composition root', () => {
    const planted = `${textOf('server/src/coord/overlordRead.ts')}\nconst db = openOperatorModelDb('x');\nconst s = openOperatorModelStore('x', 'y', 0);\n`;
    const v = scanFile(planted, 'server/src/coord/overlordRead.ts').violations.join('\n');
    expect(v).toMatch(/openOperatorModelDb\( is called outside server\/src\/operatorModel\//);
    expect(v).toMatch(/openOperatorModelStore\( is called outside server\/src\/index\.ts/);
    expect(scanFile(`const s = openOperatorModelStore('x', 'y', 0);`, 'server/src/index.ts').violations).toEqual([]);
  });
});
