// The reader lab's door through the real server (native Docs reader, the reader lab plan of 2026-11-03, Task 3; the
// rich-docs spec's rows M10.2, M10.3, M10.4, M10.5, M10.7, M10.8, M10.17; the reader lab design, section 4): `buildServer`
// with the gate dark and armed. The run routes are session-gated and a run answers only the session that opened it; every
// probe answer is one empty 204, whatever it is sent; the counter sees a probe before the gate and keeps only classes; a
// frame's WebSocket upgrade is refused by the gate, which logs its foreign-origin line, and still counted; a CORS
// preflight to the probe is never approved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { DOCS_REQUEST_HEADER } from '../../shared/docs.js';
import {
  READER_LAB_PROBE_ROUTE, READER_LAB_RUNS_PATH, readerLabProbePath, type LabOpenAnswer, type LabReadAnswer,
} from '../../shared/readerLab.js';
import { READER_LAB_PROBE_BODY_MAX, labOwnerOf } from '../src/readerLab/routes.js';
import { READER_LAB_RUN_HITS_MAX, READER_LAB_RUN_TTL_MS } from '../src/readerLab/runs.js';
import { testDeps } from './helpers.js';
import { walkSrc } from './rings/walkSrc.js';
import { ts } from './scan/parse.js';
import { callsIn, parsedFile, sourceOfSymbol, symbolOf } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';

/** What the nonce case below feeds `randomBytes(16)`: the hoisted state of its `node:crypto` mock. A request that asks for
 *  16 bytes while `queue` holds some is handed the next one, and every other call is the real function. */
const forced = vi.hoisted(() => ({ queue: [] as Buffer[], handed: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const real = actual.randomBytes as (...a: unknown[]) => Buffer;
  const randomBytes = ((size: number, ...rest: unknown[]): Buffer => {
    if (size === 16 && forced.queue.length > 0) {
      forced.handed += 1;
      return forced.queue.shift()!;
    }
    return real(size, ...rest);
  }) as typeof actual.randomBytes;
  return { ...actual, randomBytes };
});

const here = path.dirname(fileURLToPath(import.meta.url));
/** A cheap scrypt line verifies through the identical code path (auth-gate.test.ts' FAST_PARAMS). */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** A pty that never touches tmux (auth-gate.test.ts' stubPty). */
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });
const UNKNOWN = 'ZZZZZZZZZZZZZZZZZZZZZZ';

/** The source with its comments blanked, so a sentence about a body is never a read of one. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Words that read the request's body or its connection when they appear in code (`bodyLimit` is not the word `body`). */
const READ_WORDS = /\b(body|raw|stream|socket)\b/;
/** Members that read it too, named as a member (`req.file()`), a literal key (`req['parts']`) or a destructured key: the
 *  multipart readers, which consume the stream as surely as `body` does. */
const READ_MEMBERS: ReadonlySet<string> = new Set(['file', 'files', 'parts', 'saveRequestFiles']);

/** A read of the request in one piece of the door's source: the words above outside a comment; a multipart reader; or any
 *  computed key (`req['bo' + 'dy']`, `req[k]`, `const { [k]: v } = req`), because a key built at run time can be any
 *  member, the body included. A literal key (`req.headers['cookie']`) is a member named as written and is judged so.
 *  KNOWN WIDTH: a read the source does not name (code in a package, a member reached through a type, `eval`), and a
 *  handler reached by `import()` or `require()`, are not seen; hiding a read from this scan takes one of those. */
function readsRequest(text: string): boolean {
  if (READ_WORDS.test(stripComments(text))) return true;
  const sf = ts.createSourceFile('piece.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const keyRead = (key: ts.Node | undefined): void => {
    if (key === undefined) return;
    if (ts.isComputedPropertyName(key)) found = true;
    else if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && READ_MEMBERS.has(key.text)) found = true;
  };
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n)) keyRead(n.name);
    else if (ts.isElementAccessExpression(n)) {
      const k = n.argumentExpression;
      if (ts.isStringLiteralLike(k)) keyRead(k);
      else if (!ts.isNumericLiteral(k)) found = true;
    } else if (ts.isBindingElement(n)) keyRead(n.propertyName ?? n.name);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** One module of the door's graph, read for the names it declares at the top level, what it imports and what it re-exports. */
interface ModuleFacts {
  /** Each top-level name to the whole statement that declares it, whatever the shape of its initialiser (`as`,
   *  `satisfies`, a call, an object whose members are handlers). */
  decls: Map<string, string>;
  defaultText: string | null;
  imports: Map<string, { from: string; name: string }>;
  /** `export { a as b } from './m.js'` by its exported name `b`; and the modules of an `export * from`. */
  reexports: Map<string, { from: string; name: string }>;
  stars: string[];
}

function moduleFacts(file: string): ModuleFacts {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const facts: ModuleFacts = { decls: new Map(), defaultText: null, imports: new Map(), reexports: new Map(), stars: [] };
  const names = (b: ts.BindingName): string[] => (ts.isIdentifier(b) ? [b.text]
    : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : names(e.name))));
  for (const st of sf.statements) {
    const isDefault = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name !== undefined) {
      facts.decls.set(st.name.text, st.getText(sf));
      if (isDefault) facts.defaultText = st.getText(sf);
    } else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
      if (isDefault) facts.defaultText = st.getText(sf);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) for (const n of names(d.name)) facts.decls.set(n, st.getText(sf));
    } else if (ts.isExportAssignment(st)) {
      facts.defaultText = st.getText(sf);
    } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.isTypeOnly !== true) {
      const from = st.moduleSpecifier.text;
      const c = st.importClause;
      if (c?.name !== undefined) facts.imports.set(c.name.text, { from, name: 'default' });
      if (c?.namedBindings !== undefined && ts.isNamespaceImport(c.namedBindings)) facts.imports.set(c.namedBindings.name.text, { from, name: '*' });
      else if (c?.namedBindings !== undefined) {
        for (const e of c.namedBindings.elements) if (!e.isTypeOnly) facts.imports.set(e.name.text, { from, name: (e.propertyName ?? e.name).text });
      }
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier !== undefined && ts.isStringLiteral(st.moduleSpecifier)) {
      const from = st.moduleSpecifier.text;
      if (st.exportClause === undefined) facts.stars.push(from);
      else if (ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) facts.reexports.set(e.name.text, { from, name: (e.propertyName ?? e.name).text });
      }
    }
  }
  return facts;
}

/** The file a relative specifier names (`./x.js` is `x.ts`, as the server's own imports spell it), or null for a package,
 *  a `node:` module or a file that is not there. */
function resolveModule(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const c of [base.replace(/\.js$/, '.ts'), `${base}.ts`, path.join(base, 'index.ts')]) if (existsSync(c)) return c;
  return null;
}

/** The identifiers in a piece of source, outside strings and comments. */
function identifiersIn(text: string): Set<string> {
  const sf = ts.createSourceFile('piece.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every piece of `file`'s source (and of the modules it imports) a probe request runs through, keyed on the parser, not
 *  on a line of text: the counter hook, each probe registration (a call `app.<verb>` in `registerReaderLabRoutes` whose
 *  first argument is the probe route, with its options and so its errorHandler) and, transitively, every top-level
 *  declaration any of those names, whatever shape it is bound in (a function, an arrow, a call's result, `as` or
 *  `satisfies`, an object that holds the handler as a member), in the file or in a relative module it imports by name,
 *  as a namespace or through a re-export. A declaration is the whole statement, so an object's sibling members are scanned
 *  with the handler: the scan reads more than it must, never less. */
function probePathSources(file: string): { verbs: string[]; pieces: { what: string; text: string }[] } {
  const parsed = parsedFile(file);
  const regs = callsIn(symbolOf(file, 'registerReaderLabRoutes'))
    .filter((c) => /^app\.\w+$/.test(c.callee) && c.args[0]?.kind === 'string' && c.args[0].text === READER_LAB_PROBE_ROUTE);
  const root = parsed.path;
  const work: { what: string; text: string; file: string }[] = [
    { what: 'installReaderLabCounter', text: sourceOfSymbol(file, 'installReaderLabCounter'), file: root },
    ...regs.map((c) => ({ what: c.callee, text: parsed.text.slice(c.start, c.end), file: root })),
  ];
  const facts = new Map<string, ModuleFacts>();
  const factsOf = (f: string): ModuleFacts => {
    let m = facts.get(f);
    if (m === undefined) facts.set(f, (m = moduleFacts(f)));
    return m;
  };
  const seen = new Set<string>([`${root}#installReaderLabCounter`, `${root}#registerReaderLabRoutes`]);
  const take = (f: string, name: string, text: string): void => {
    if (!seen.has(`${f}#${name}`)) {
      seen.add(`${f}#${name}`);
      work.push({ what: name, text, file: f });
    }
  };
  /** `name` as module `f` exports it: a declaration of its own, or one it re-exports from another module. */
  const exported = (f: string, name: string, depth = 0): void => {
    const m = factsOf(f);
    const own = name === 'default' ? m.defaultText : m.decls.get(name);
    if (own !== undefined && own !== null) return take(f, name, own);
    if (depth > 8) return;
    const re = m.reexports.get(name);
    const via = re === undefined ? null : resolveModule(f, re.from);
    if (re !== undefined && via !== null) exported(via, re.name, depth + 1);
    for (const star of m.stars) {
      const target = resolveModule(f, star);
      if (target !== null) exported(target, name, depth + 1);
    }
  };
  for (let i = 0; i < work.length; i += 1) {
    const here = work[i]!;
    const m = factsOf(here.file);
    const ids = identifiersIn(here.text);
    for (const id of ids) {
      const own = m.decls.get(id);
      if (own !== undefined) take(here.file, id, own);
      const imp = m.imports.get(id);
      const target = imp === undefined ? null : resolveModule(here.file, imp.from);
      if (imp === undefined || target === null) continue;
      if (imp.name === '*') for (const other of ids) exported(target, other);
      else exported(target, imp.name);
    }
  }
  return { verbs: regs.map((c) => c.callee), pieces: work.map(({ what, text }) => ({ what, text })) };
}

/** The calls in `file` that register a route at the lab's paths: a call whose last name is a route verb (or `route`,
 *  or `register` for a plugin with a prefix) and whose arguments name `/api/reader-lab` or a path the shared vocabulary
 *  builds. Each is `<verb> <first argument>`. */
function labRegistrationsIn(file: string): string[] {
  const VERB = /^(get|post|put|patch|delete|head|options|all|route|register)$/;
  const LAB_PATH = /\/api\/reader-lab|\bREADER_LAB_(?:RUNS_PATH|PROBE_ROUTE)\b|\breaderLab(?:Run|Close|Probe)\w*/;
  return parsedFile(file).calls
    .filter((c) => c.name !== null && VERB.test(c.name) && c.args.some((a) => LAB_PATH.test(a.text)))
    .map((c) => `${c.name} ${c.args[0]?.text ?? ''}`);
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  forced.queue = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
});

/** The real server in a fixture home, the gate armed or dark, with a passphrase so a session can be minted. */
async function openApp(armed: boolean, seen?: string[]): Promise<FastifyInstance> {
  const home = mkTmp('ccrc-reader-lab-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false }, spawnPty: stubPty };
  app = await buildServer(deps);
  // Fastify runs a route's onError hooks before its errorHandler, so this sees what the probe's errorHandler is handed.
  if (seen !== undefined) app.addHook('onError', async (_req, _reply, err) => { seen.push((err as { code?: string }).code ?? err.name); });
  await app.ready();
  return app;
}

/** A live session cookie, minted through the real login route. */
async function login(a: FastifyInstance): Promise<string> {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
}

const headersOf = (cookie?: string): Record<string, string> => (cookie === undefined ? {} : { cookie });

async function openRun(a: FastifyInstance, cookie?: string): Promise<string> {
  const res = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, headers: headersOf(cookie) });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as LabOpenAnswer).nonce;
}

async function readRun(a: FastifyInstance, nonce: string, cookie?: string): Promise<LabReadAnswer> {
  const res = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: headersOf(cookie) });
  return JSON.parse(res.body) as LabReadAnswer;
}

const counted = (r: LabReadAnswer): Extract<LabReadAnswer, { ok: true }>['run'] => {
  if (!r.ok) throw new Error('the run is not open');
  return r.run;
};

describe('the reader lab door (reader lab plan, Task 3)', () => {
  it('registers the run routes and the probe pair at the paths the vocabulary names, as literals', async () => {
    const a = await openApp(false);
    expect(a.hasRoute({ method: 'POST', url: READER_LAB_RUNS_PATH })).toBe(true);
    expect(a.hasRoute({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/:nonce` })).toBe(true);
    expect(a.hasRoute({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/:nonce/close` })).toBe(true);
    expect(a.hasRoute({ method: 'GET', url: READER_LAB_PROBE_ROUTE })).toBe(true);
    expect(a.hasRoute({ method: 'POST', url: READER_LAB_PROBE_ROUTE })).toBe(true);
    // Refinement (f): no HEAD on either GET (a HEAD route would share the probe's counter and answer 204).
    expect(a.hasRoute({ method: 'HEAD', url: READER_LAB_PROBE_ROUTE })).toBe(false);
    expect(a.hasRoute({ method: 'HEAD', url: `${READER_LAB_RUNS_PATH}/:nonce` })).toBe(false);
    const src = readFileSync(path.join(here, '..', 'src', 'readerLab', 'routes.ts'), 'utf8');
    for (const lit of [`app.post('${READER_LAB_RUNS_PATH}'`, `app.get('${READER_LAB_PROBE_ROUTE}'`, `app.post('${READER_LAB_PROBE_ROUTE}'`]) {
      expect(src, lit).toContain(lit);
    }
  });

  it('armed: a session opens, reads and closes a run; an anonymous caller gets the gate\'s 401 on all three (M10.8)', async () => {
    const a = await openApp(true);
    for (const [method, url] of [['POST', READER_LAB_RUNS_PATH], ['GET', `${READER_LAB_RUNS_PATH}/${UNKNOWN}`],
      ['POST', `${READER_LAB_RUNS_PATH}/${UNKNOWN}/close`]] as const) {
      const anon = await a.inject({ method, url });
      expect(anon.statusCode, `${method} ${url}`).toBe(401);
      expect((JSON.parse(anon.body) as { verdict?: unknown }).verdict, `${method} ${url}`).toBe('no-session');
    }
    const cookie = await login(a);
    const opened = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, headers: { cookie } });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(opened.body) as LabOpenAnswer;
    expect(body.ok).toBe(true);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.ttlMs).toBe(READER_LAB_RUN_TTL_MS);
    expect(counted(await readRun(a, body.nonce, cookie)).counted).toBe(0);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${body.nonce}/close`, headers: { cookie } });
    expect(JSON.parse(closed.body)).toEqual({ ok: true, closed: true });
    const gone = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${body.nonce}`, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
    expect(JSON.parse(gone.body)).toEqual({ ok: false, error: 'unknown-run' });
    const again = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${body.nonce}/close`, headers: { cookie } });
    expect(JSON.parse(again.body)).toEqual({ ok: true, closed: false });
  });

  it('the server mints every nonce: two opens differ, and a nonce sent in the body is not taken (M10.2)', async () => {
    const a = await openApp(false);
    const offered = 'AAAAAAAAAAAAAAAAAAAAAA';
    const res = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, payload: { nonce: offered } });
    const first = (JSON.parse(res.body) as LabOpenAnswer).nonce;
    const second = await openRun(a);
    expect(first).not.toBe(offered);
    expect(second).not.toBe(first);
    const r = await readRun(a, offered);
    expect(r).toEqual({ ok: false, error: 'unknown-run' });
  });

  it('every probe answer is the same empty 204, by GET and POST, for a live, unknown, malformed, closed, expired or saturated run and an unknown name (M10.4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_784_600_000_000);
    const a = await openApp(false);
    const expired = await openRun(a);
    vi.setSystemTime(1_784_600_000_000 + READER_LAB_RUN_TTL_MS - 1000);
    const live = await openRun(a);
    const closed = await openRun(a);
    await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${closed}/close` });
    const full = await openRun(a);
    for (let i = 0; i < READER_LAB_RUN_HITS_MAX; i += 1) await a.inject({ method: 'GET', url: readerLabProbePath(full, 'cookie-image') });
    vi.setSystemTime(1_784_600_000_000 + READER_LAB_RUN_TTL_MS);
    expect(await readRun(a, expired)).toEqual({ ok: false, error: 'unknown-run' });
    expect(counted(await readRun(a, full)).saturated).toBe(true);
    const urls = [
      readerLabProbePath(live, 'cookie-image'), `/api/reader-lab/probe/${live}/not-a-probe`, readerLabProbePath(UNKNOWN, 'cookie-image'),
      '/api/reader-lab/probe/x/cookie-image', readerLabProbePath(closed, 'cookie-image'), readerLabProbePath(expired, 'cookie-image'),
      readerLabProbePath(full, 'cookie-image'),
    ];
    const shapes = new Set<string>();
    for (const url of urls) {
      for (const method of ['GET', 'POST'] as const) {
        const res = await a.inject({ method, url, ...(method === 'POST' ? { payload: 'x', headers: { 'content-type': 'text/plain' } } : {}) });
        const what = `${method} ${url}`;
        expect(res.statusCode, what).toBe(204);
        expect(res.body, what).toBe('');
        expect(res.headers['cache-control'], what).toBe('no-store');
        expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-') || h === 'set-cookie'), what).toEqual([]);
        shapes.add(Object.keys(res.headers).filter((h) => h !== 'date').sort().join(','));
      }
    }
    expect([...shapes], 'every probe answer carries the same header names').toHaveLength(1);
    expect(counted(await readRun(a, live)).counted).toBe(4);
  }, 60_000);

  it('a POST probe whose body the server will not take still answers 204, and is counted (M10.4)', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    const report = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-beacon'),
      payload: '{"csp-report":{}}', headers: { 'content-type': 'application/csp-report' } });
    const big = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-xhr'),
      payload: 'x'.repeat(4096), headers: { 'content-type': 'text/plain' } });
    expect([report.statusCode, report.body, big.statusCode, big.body]).toEqual([204, '', 204, '']);
    const run = counted(await readRun(a, nonce));
    expect([run.probes['cookie-beacon'].hits, run.probes['cookie-xhr'].hits]).toEqual([1, 1]);
  });

  it('a probe POST body over 1 KiB is refused by the route\'s own limit and still answers 204; one under it is not refused (M10.4)', async () => {
    // The limit's value is pinned, as its sibling READER_LAB_RUN_HITS_MAX is: the bodies below are sized from it.
    expect(READER_LAB_PROBE_BODY_MAX, 'the probe POST body limit is 1 KiB').toBe(1024);
    const seen: string[] = [];
    const a = await openApp(false, seen);
    const nonce = await openRun(a);
    const post = (n: number) => a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-xhr'),
      payload: 'x'.repeat(n), headers: { 'content-type': 'text/plain' } });
    const small = await post(READER_LAB_PROBE_BODY_MAX - 1);
    expect([small.statusCode, small.body, seen], 'a body under the limit is parsed, not refused').toEqual([204, '', []]);
    const big = await post(2 * READER_LAB_PROBE_BODY_MAX);
    expect([big.statusCode, big.body], 'a refused body answers as an accepted one does').toEqual([204, '']);
    expect(seen, 'the 2 KiB body went through the route\'s error path as a too-large body').toEqual(['FST_ERR_CTP_BODY_TOO_LARGE']);
    expect(counted(await readRun(a, nonce)).probes['cookie-xhr'].hits).toBe(2);
  });

  it('the probe path never reads a body: no body, raw-stream, socket or multipart access in the counter, either registration or any declaration they name (refinement (f))', () => {
    const { verbs, pieces } = probePathSources('server/src/readerLab/routes.ts');
    expect(verbs, 'both probe registrations are found, and only they').toEqual(['app.get', 'app.post']);
    expect(pieces.map((p) => p.what), 'the counter, both registrations and the probe answer are scanned')
      .toEqual(expect.arrayContaining(['installReaderLabCounter', 'app.get', 'app.post', 'probeAnswer']));
    expect(pieces.map((p) => p.what), 'the helpers the counter imports are scanned too')
      .toEqual(expect.arrayContaining(['parseCookies', 'labSiteClass', 'labOriginClass']));
    for (const p of pieces) expect(readsRequest(p.text), `${p.what}: the probe path reads the request`).toBe(false);
    // CONTROL, through the same scan over fixture files shaped like routes.ts: each planted read is found, through a
    // named handler, a named errorHandler, a helper, a destructured `raw`, the counter, a handler bound through `as` or
    // `satisfies`, wrapped in a call, held as an object member or imported (by name, as a namespace, through a barrel),
    // and a read of the socket, of a multipart reader or by a computed key; the clean fixtures have none.
    const dir = mkTmp('ccrc-reader-lab-scan-');
    const fixture = (name: string, post: string, counter = '', top = '', siblings: Record<string, string> = {}): string => {
      for (const [f, text] of Object.entries(siblings)) writeFileSync(path.join(dir, f), text);
      const file = path.join(dir, `${name}.ts`);
      writeFileSync(file, `${top}
const probeAnswer = (reply: any) => reply.code(204).send();
export function installReaderLabCounter(app: any): void {
  app.addHook('onRequest', async (req: any) => { ${counter} });
}
export function registerReaderLabRoutes(app: any): void {
  // the handler never reads the body
  app.get('${READER_LAB_PROBE_ROUTE}', { exposeHeadRoute: false }, async (_req: any, reply: any) => probeAnswer(reply));
  app.post('${READER_LAB_PROBE_ROUTE}', ${post});
}
`);
      return file;
    };
    const readIn = (file: string): string[] => probePathSources(file).pieces.filter((p) => readsRequest(p.text)).map((p) => p.what);
    const handlerSource = (read: string): string => `export const probeHandler = async (req: any, reply: any) => { ${read} return reply.code(204).send(); };\n`;
    expect(readIn(fixture('clean', '{ bodyLimit: 1024, errorHandler: (_e: any, _r: any, reply: any) => probeAnswer(reply) }, async (_req: any, reply: any) => probeAnswer(reply)')))
      .toEqual([]);
    expect(readIn(fixture('named', '{ bodyLimit: 1024 }, probeHandler', '',
      'const probeHandler = async (req: any, reply: any) => { void req.body; return probeAnswer(reply); };'))).toEqual(['probeHandler']);
    expect(readIn(fixture('onerror', '{ errorHandler: onRefused }, async (_req: any, reply: any) => probeAnswer(reply)', '',
      'const onRefused = (_e: any, req: any, reply: any) => { void req.body; return probeAnswer(reply); };'))).toEqual(['onRefused']);
    expect(readIn(fixture('helper', '{}, async (req: any, reply: any) => { drain(req); return probeAnswer(reply); }', '',
      'const drain = (req: any) => req.stream;'))).toEqual(['drain']);
    expect(readIn(fixture('raw', "{}, async (req: any, reply: any) => { const { raw } = req; raw.on('data', () => {}); return probeAnswer(reply); }")))
      .toEqual(['app.post']);
    expect(readIn(fixture('counter', '{}, async (_req: any, reply: any) => probeAnswer(reply)', 'void req.body;'))).toEqual(['installReaderLabCounter']);
    // A handler bound in a shape the symbol table does not key.
    expect(readIn(fixture('as', '{}, probeHandler', '',
      'const probeHandler = (async (req: any, reply: any) => { void req.body; return reply; }) as unknown;'))).toEqual(['probeHandler']);
    expect(readIn(fixture('satisfies', '{}, probeHandler', '',
      'const probeHandler = (async (req: any, reply: any) => { void req.body; return reply; }) satisfies object;'))).toEqual(['probeHandler']);
    expect(readIn(fixture('wrapped', '{}, probeHandler', '',
      'const wrap = (f: any) => f;\nconst probeHandler = wrap(async (req: any, reply: any) => { void req.body; return reply; });'))).toEqual(['probeHandler']);
    expect(readIn(fixture('member', '{}, handlers.post', '',
      'const handlers = { post: async (req: any, reply: any) => { void req.body; return reply; } };'))).toEqual(['handlers']);
    expect(readIn(fixture('imported', '{}, probeHandler', '', "import { probeHandler } from './imported-handler.js';",
      { 'imported-handler.ts': handlerSource('void req.body;') }))).toEqual(['probeHandler']);
    expect(readIn(fixture('namespace', '{}, h.probeHandler', '', "import * as h from './namespace-handler.js';",
      { 'namespace-handler.ts': handlerSource('void req.body;') }))).toEqual(['probeHandler']);
    expect(readIn(fixture('reexport', '{}, probeHandler', '', "import { probeHandler } from './barrel.js';",
      { 'barrel.ts': "export { probeHandler } from './barrel-impl.js';\n", 'barrel-impl.ts': handlerSource('void req.body;') }))).toEqual(['probeHandler']);
    // What the connection and the multipart readers consume.
    expect(readIn(fixture('socket', '{}, async (req: any, reply: any) => { req.socket.destroy(); return probeAnswer(reply); }'))).toEqual(['app.post']);
    expect(readIn(fixture('socket-counter', '{}, async (_req: any, reply: any) => probeAnswer(reply)', 'void req.socket;'))).toEqual(['installReaderLabCounter']);
    expect(readIn(fixture('file', '{}, async (req: any, reply: any) => { await req.file(); return probeAnswer(reply); }'))).toEqual(['app.post']);
    expect(readIn(fixture('parts', '{}, async (req: any, reply: any) => { for await (const p of req.parts()) void p; return probeAnswer(reply); }')))
      .toEqual(['app.post']);
    expect(readIn(fixture('parts-key', '{}, async (req: any, reply: any) => { void req["parts"]; return probeAnswer(reply); }'))).toEqual(['app.post']);
    // A key built at run time, which no word test sees.
    expect(readIn(fixture('computed', "{}, async (req: any, reply: any) => { void req['bo' + 'dy']; return probeAnswer(reply); }"))).toEqual(['app.post']);
    expect(readIn(fixture('computed-var', "{}, async (req: any, reply: any) => { const k = ['bo', 'dy'].join(''); void req[k]; return probeAnswer(reply); }")))
      .toEqual(['app.post']);
    expect(readIn(fixture('computed-pattern', "{}, async (req: any, reply: any) => { const k = ['bo', 'dy'].join(''); const { [k]: v } = req; void v; return probeAnswer(reply); }")))
      .toEqual(['app.post']);
    // CONTROL of the controls: the same shapes with nothing read are clean, and a literal key is not a computed one.
    expect(readIn(fixture('clean-as', '{}, probeHandler', '',
      'const probeHandler = (async (_req: any, reply: any) => probeAnswer(reply)) as unknown;'))).toEqual([]);
    expect(readIn(fixture('clean-imported', '{}, probeHandler', '', "import { probeHandler } from './clean-imported-handler.js';",
      { 'clean-imported-handler.ts': handlerSource('void 1;') }))).toEqual([]);
    expect(readIn(fixture('clean-keys', "{}, async (req: any, reply: any) => { void req.headers['cookie']; void req.params['nonce']; void [1][0]; return probeAnswer(reply); }",
      "void req.headers['sec-fetch-site'];"))).toEqual([]);
  });

  it('every /api/reader-lab route registration under server/src is in readerLab/routes.ts, and those are the five doors (M10.8)', () => {
    const files = walkSrc({ roots: ['server/src'], min: 200 });
    const found = files.flatMap((f) => labRegistrationsIn(f).map((r) => ({ file: f, reg: r })));
    expect([...new Set(found.map((r) => r.file))], 'a lab route is registered outside the door\'s file').toEqual(['server/src/readerLab/routes.ts']);
    expect(found.map((r) => r.reg).sort(), 'the door\'s registrations are the five').toEqual(
      ['get /api/reader-lab/probe/:nonce/:name', 'get /api/reader-lab/runs/:nonce', 'post /api/reader-lab/probe/:nonce/:name',
        'post /api/reader-lab/runs', 'post /api/reader-lab/runs/:nonce/close']);
    // CONTROL: the same scan over planted files finds a registration moved to another file, one spelled through the
    // shared constants, a plugin registered under the lab prefix and a route option; it passes a file that only names the path.
    const dir = mkTmp('ccrc-reader-lab-place-');
    const plant = (name: string, body: string): string => {
      const file = path.join(dir, `${name}.ts`);
      writeFileSync(file, body);
      return file;
    };
    expect(labRegistrationsIn(plant('moved', "export const r = (app: any) => { app.get('/api/reader-lab/runs/:nonce', async () => ({})); };")))
      .toEqual(['get /api/reader-lab/runs/:nonce']);
    expect(labRegistrationsIn(plant('const', 'export const r = (app: any) => { app.post(READER_LAB_RUNS_PATH, async () => ({})); };')))
      .toEqual(['post READER_LAB_RUNS_PATH']);
    expect(labRegistrationsIn(plant('route', "export const r = (app: any) => { app.route({ method: 'GET', url: '/api/reader-lab/x', handler: async () => ({}) }); };")))
      .toHaveLength(1);
    expect(labRegistrationsIn(plant('prefix', "export const r = (app: any, plugin: any) => { app.register(plugin, { prefix: '/api/reader-lab' }); };")))
      .toHaveLength(1);
    expect(labRegistrationsIn(plant('clean', "export const note = '/api/reader-lab/runs';\nexport const t = new Map([['GET /api/reader-lab/probe/:nonce/:name', 'a row']]);\nexport const r = (app: any) => { app.get('/api/other', async () => ({})); };")))
      .toEqual([]);
  });

  it('a nonce is 128 bits from node:crypto: minted by randomBytes(16), imported from node:crypto, with no Math.random in the door (M10.2)', () => {
    // The shape is pinned elsewhere; its entropy source is pinned here, because a Math.random- or counter-derived string of
    // the same 22 characters would pass every shape check. Keyed on the parser (scan/symbols.ts), not on a line of text.
    const F = 'server/src/readerLab/routes.ts';
    const parsed = parsedFile(F);
    const mints = callsIn(symbolOf(F, 'registerReaderLabRoutes')).filter((c) => c.name === 'randomBytes');
    expect(mints.map((c) => [c.callee, c.args.map((a) => a.text), c.boundTo]), 'the open handler mints the nonce once, 16 bytes')
      .toEqual([['randomBytes', ['16'], 'nonce']]);
    const encode = parsed.calls.filter((c) => c.callee === 'randomBytes(16).toString');
    expect(encode.map((c) => c.args.map((a) => `${a.kind}:${a.text}`)), 'encoded as base64url').toEqual([['string:base64url']]);
    expect(parsed.imports.filter((e) => e.names.includes('randomBytes')).map((e) => e.specifier)).toEqual(['node:crypto']);
    expect(parsed.calls.filter((c) => /^Math\s*\.\s*random$/.test(c.callee)).length, 'the door draws no randomness from Math').toBe(0);
  });

  it('the minted value is what the answer carries and what the store opens the run under: 16 bytes from randomBytes, base64url, minted once (M10.2)', async () => {
    const a = await openApp(false);
    const first = Buffer.alloc(16, 7);
    const second = Buffer.alloc(16, 9);
    // `randomBytes(16)` is handed these two (see the mock at the top): a second mint, or a nonce from anywhere else, is not
    // `first`, and the run the store holds is the one the answer names.
    forced.queue = [first, second];
    forced.handed = 0;
    const nonce = await openRun(a);
    expect(nonce, 'the answer carries the bytes the first mint drew').toBe(first.toString('base64url'));
    expect([forced.handed, forced.queue.length], 'one mint per open').toEqual([1, 1]);
    expect(counted(await readRun(a, nonce)).counted, 'the store opened the run under that same value').toBe(0);
    expect(await readRun(a, second.toString('base64url')), 'and under no other').toEqual({ ok: false, error: 'unknown-run' });
    forced.queue = [second];
    expect(await openRun(a)).toBe(second.toString('base64url'));
    expect(counted(await readRun(a, first.toString('base64url'))).counted, 'the first run is still open beside the second').toBe(0);
    expect(forced.queue, 'nothing is left over').toEqual([]);
  });

  it('a request that reaches no probe handler gets one answer whether or not a run exists: a HEAD, a wrong-shaped path, a malformed escape, an over-long name, dark or armed (refinement (f))', async () => {
    // The gate's journal line for a refused foreign-origin write is counted below, not printed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const armed of [false, true]) {
      const a = await openApp(armed);
      const session = armed ? await login(a) : undefined;
      const nonce = await openRun(a, session);
      const base = `/api/reader-lab/probe/${nonce}`;
      // A box that serves the built PWA answers a GET or a HEAD that matches no route through its catch-all, which the gate
      // lets by; one that does not, through the gate. Both are measured, so the expected split is whichever this box is.
      const bundle = (await a.inject({ method: 'GET', url: '/' })).statusCode === 200;
      const probes = [
        { method: 'HEAD', url: `${base}/cookie-image` }, { method: 'GET', url: `${base}/cookie-image/extra` },
        { method: 'POST', url: `${base}/cookie-image/extra` }, { method: 'GET', url: base },
        { method: 'HEAD', url: `${READER_LAB_RUNS_PATH}/${nonce}` },
        // A write from a frame's opaque origin: on an armed box the gate refuses it before the session check.
        { method: 'POST', url: `${base}/cookie-image/extra`, origin: 'null' }, { method: 'PUT', url: `${base}/cookie-image`, origin: 'null' },
        // Fastify answers these two before any hook: a malformed percent-escape (400) and an over-long name on a POST (414).
        { method: 'GET', url: `${base}/cookie%ZZimage` }, { method: 'POST', url: `${base}/${'n'.repeat(200)}` },
      ] as const;
      type Probe = (typeof probes)[number];
      const originOf = (p: Probe): string | undefined => ('origin' in p ? p.origin : undefined);
      /** What the answer must be, by the gate's rules: a refusal before any hook, then the gate's foreign-origin write, then
       *  the box's own 404 (a catch-all for a GET or HEAD on a box with the bundle, a session that passes the gate, a dark
       *  box) or the gate's 401 for a caller with no session. */
      const expectStatus = (p: Probe, hasSession: boolean): number => {
        if (p.url.includes('%ZZ')) return 400;
        if (p.url.includes('n'.repeat(200))) return 414;
        if (armed && originOf(p) !== undefined) return 403;
        if (bundle && (p.method === 'HEAD' || p.method === 'GET')) return 404;
        return armed && !hasSession ? 401 : 404;
      };
      /** Headers that must differ between two answers of one request: the clock's `date`. Nothing else is set aside. */
      const MUST_DIFFER = new Set(['date']);
      const ask = async (cookie: string | undefined): Promise<string[]> => {
        const out: string[] = [];
        for (const p of probes) {
          const origin = originOf(p);
          const res = await a.inject({ method: p.method, url: p.url, headers: { ...headersOf(cookie), ...(origin === undefined ? {} : { origin }) } });
          const headers = Object.entries(res.headers).filter(([h]) => !MUST_DIFFER.has(h)).sort(([x], [y]) => (x < y ? -1 : 1));
          expect(res.statusCode, `armed ${armed} ${p.method} ${p.url} ${origin ?? ''}`).toBe(expectStatus(p, cookie !== undefined));
          out.push(`${p.method} ${p.url} ${res.statusCode} ${res.body} ${JSON.stringify(headers)}`);
        }
        return out;
      };
      // Each answer is read with the run live, then again once it is closed: the same nonce, the same request, no run.
      const live = [await ask(undefined), await ask(session)];
      expect((await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${nonce}/close`, headers: headersOf(session) })).statusCode).toBe(200);
      const none = [await ask(undefined), await ask(session)];
      expect(none, `armed ${armed}: a request that reaches no probe handler answers the same, headers too, with no run open`).toEqual(live);
      // CONTROL: the answers are real refusals, not the probe's 204, so equality is not vacuous.
      expect(live.flat().every((l) => !l.includes(' 204 ')), `armed ${armed}`).toBe(true);
      expect(live.flat().filter((l) => l.includes('%ZZ') || l.includes('n'.repeat(200))).map((l) => l.split(' ')[2]),
        `armed ${armed}: the malformed escape is a 400 and the over-long POST a 414, before any hook`).toEqual(['400', '414', '400', '414']);
      // CONTROL: the headers are in the comparison. An answer is a refusal with headers (content-type, content-length).
      expect(live.flat().every((l) => l.includes('"content-type"')), `armed ${armed}: the compared answers carry headers`).toBe(true);
      if (armed) {
        const refused = live.flat().filter((l) => l.includes(' 403 '));
        expect(refused.map((l) => l.split(' ').slice(3).join(' ').replace(/ \[.*$/, '')), 'the foreign-origin refusal, with and without a session')
          .toEqual(Array(4).fill('{"ok":false,"error":"foreign-origin"}'));
        expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('request from a foreign origin')),
          'the gate journals each refused write once (two asks of two callers, run live and closed)').toHaveLength(8);
      }
      await a.close();
      app = undefined;
    }
  });

  it('a run\'s owner digest is never the bare sha256 of the session token, so it never equals the session store\'s own key (M10.17)', () => {
    const token = 'lab-token-for-the-digest-case';
    const owner = labOwnerOf(`ccrc_session=${token}`);
    const bare = createHash('sha256').update(token);
    // The session store keys a session by the hex of this digest (auth/sessions.ts); the door's own is base64url. Neither
    // encoding of the bare digest may be the owner.
    for (const form of [bare.copy().digest('hex'), bare.copy().digest('base64url'), bare.copy().digest('base64')]) expect(owner).not.toBe(form);
    expect(owner).not.toContain(token);
    expect(owner).toBe(createHash('sha256').update(`reader-lab:${token}`).digest('base64url'));
  });

  it('a HEAD to the probe is neither answered as a probe nor counted (refinement (f))', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    await a.inject({ method: 'HEAD', url: readerLabProbePath(nonce, 'cookie-image') });
    const run = counted(await readRun(a, nonce));
    expect([run.counted, run.probes['cookie-image'].hits]).toEqual([0, 0]);
  });

  it('armed: the counter keeps classes, never a value: the cookie by name, Sec-Fetch-Site and Origin (M10.7)', async () => {
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    const withCookie = await a.inject({ method: 'GET', url: readerLabProbePath(nonce, 'cookie-fetch'),
      headers: { cookie, 'sec-fetch-site': 'cross-site', origin: 'null' } });
    const bare = await a.inject({ method: 'GET', url: readerLabProbePath(nonce, 'cookie-image'),
      headers: { 'sec-fetch-site': 'same-origin' } });
    expect([withCookie.statusCode, bare.statusCode]).toEqual([204, 204]);
    const res = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: { cookie } });
    const run = counted(JSON.parse(res.body) as LabReadAnswer);
    expect(run.probes['cookie-fetch']).toMatchObject({ hits: 1, cookie: 1, upgrade: 0 });
    expect(run.probes['cookie-fetch'].site['cross-site']).toBe(1);
    expect(run.probes['cookie-fetch'].origin.null).toBe(1);
    expect(run.probes['cookie-image']).toMatchObject({ hits: 1, cookie: 0 });
    expect(run.probes['cookie-image'].site['same-origin']).toBe(1);
    expect(run.probes['cookie-image'].origin.absent).toBe(1);
    expect(res.body, 'the read never carries the cookie\'s value').not.toContain(cookie.slice(cookie.indexOf('=') + 1));
  });

  it('armed: a frame\'s WebSocket upgrade to the probe is refused by the gate (403), logged by the gate once, and still counted (M10.3)', async () => {
    // The gate's journal line is counted, and not printed into the suite's output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    await expect(a.injectWS(readerLabProbePath(nonce, 'cookie-websocket'), { headers: { origin: 'null' } }))
      .rejects.toThrow('Unexpected server response: 403');
    const run = counted(await readRun(a, nonce, cookie));
    expect(run.probes['cookie-websocket']).toMatchObject({ hits: 1, upgrade: 1, cookie: 0 });
    expect(run.probes['cookie-websocket'].origin.null).toBe(1);
    // The gate's own CSRF line, unchanged: on an armed box each lab frame's upgrade writes it once, which the design's
    // section 4.4 and the page call expected. The door adds no line of its own.
    const refusals = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('foreign origin'));
    expect(refusals, 'the gate logs one foreign-origin line for the upgrade').toHaveLength(1);
    expect(refusals[0]).toContain('refused a websocket upgrade from a foreign origin');
    expect(refusals[0]).toContain('"null"');
  });

  it('armed: a frame\'s POST probe from origin null skips the origin check (reason 8): the same 204, counted, and no refusal logged (M10.4)', async () => {
    // The gate's journal line is counted, and not printed into the suite's output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    const res = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-beacon'), payload: 'x',
      headers: { origin: 'null', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' } });
    expect([res.statusCode, res.body, res.headers['cache-control']]).toEqual([204, '', 'no-store']);
    const run = counted(await readRun(a, nonce, cookie));
    expect(run.probes['cookie-beacon']).toMatchObject({ hits: 1, cookie: 0 });
    expect(run.probes['cookie-beacon'].origin.null).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('foreign origin'))).toEqual([]);
  });

  it('a run answers only the session that opened it: any other gets exactly the unknown-nonce answer, and cannot close it (M10.17)', async () => {
    const a = await openApp(false);
    const mine = 'ccrc_session=lab-a';
    const other = 'ccrc_session=lab-b';
    const nonce = await openRun(a, mine);
    const theirs = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: { cookie: other } });
    const unknown = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${UNKNOWN}`, headers: { cookie: mine } });
    expect([theirs.statusCode, theirs.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(theirs.statusCode).toBe(404);
    const anon = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}` });
    expect(anon.statusCode, 'a caller with no session is another owner').toBe(404);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${nonce}/close`, headers: { cookie: other } });
    expect(JSON.parse(closed.body)).toEqual({ ok: true, closed: false });
    expect(counted(await readRun(a, nonce, mine)).counted).toBe(0);
    // The owner is a one-way digest: never the cookie, stable for one session, distinct between two; no cookie is one owner.
    expect(labOwnerOf(mine)).not.toContain('lab-a');
    expect(labOwnerOf(mine)).toBe(labOwnerOf(`${mine}; theme=dark`));
    expect(labOwnerOf(mine)).not.toBe(labOwnerOf(other));
    expect(labOwnerOf(undefined)).toBe(labOwnerOf('theme=dark'));
  });

  it('armed: a run answers only the sign-in that opened it: a second real session reads and closes it as an unknown nonce, and the opener still can (M10.17)', async () => {
    // The dark-box case above uses synthetic cookies. Here the owner digest is over two cookies the real login route minted,
    // behind the gate that checks each for a live session before the door sees it.
    const a = await openApp(true);
    const mine = await login(a);
    const other = await login(a);
    expect(other, 'two sign-ins are two sessions').not.toBe(mine);
    const nonce = await openRun(a, mine);
    const read = (cookie: string, n: string) => a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${n}`, headers: { cookie } });
    const theirs = await read(other, nonce);
    const unknown = await read(other, UNKNOWN);
    expect([theirs.statusCode, theirs.body, theirs.headers['cache-control']], 'the other session reads it as it reads a nonce nobody opened')
      .toEqual([unknown.statusCode, unknown.body, unknown.headers['cache-control']]);
    expect(theirs.statusCode).toBe(404);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${nonce}/close`, headers: { cookie: other } });
    expect(JSON.parse(closed.body), 'and cannot close it').toEqual({ ok: true, closed: false });
    expect(counted(await readRun(a, nonce, mine)).counted, 'the opener reads it still').toBe(0);
    expect(JSON.parse((await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${nonce}/close`, headers: { cookie: mine } })).body))
      .toEqual({ ok: true, closed: true });
  });

  it('a CORS preflight to the probe is never approved: no CORS header, a refusal, and nothing counted, dark or armed', async () => {
    // The cookie check's marker request needs this preflight; the browser case cannot see it, because Playwright answers
    // preflights itself while it intercepts requests, so the refusal is pinned here, at the server.
    for (const armed of [false, true]) {
      const a = await openApp(armed);
      const cookie = armed ? await login(a) : undefined;
      const nonce = await openRun(a, cookie);
      const res = await a.inject({ method: 'OPTIONS', url: readerLabProbePath(nonce, 'cookie-fetch-marker'), headers: {
        origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': DOCS_REQUEST_HEADER } });
      expect(res.statusCode, `armed ${armed}`).toBeGreaterThanOrEqual(400);
      expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-')), `armed ${armed}`).toEqual([]);
      expect(counted(await readRun(a, nonce, cookie)).counted, `armed ${armed}`).toBe(0);
      await a.close();
      app = undefined;
    }
  });

  it('with no run open under a nonce, probes naming it record nothing anywhere (M10.5)', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    for (const name of ['cookie-image', 'busy-start', 'csp-canary'] as const) {
      await a.inject({ method: 'GET', url: readerLabProbePath(UNKNOWN, name) });
    }
    const run = counted(await readRun(a, nonce));
    expect([run.counted, run.ignored]).toEqual([0, 0]);
  });

  it('the probe pair is EXEMPT under reason 8; the run routes are not (M10.8)', () => {
    for (const k of [`GET ${READER_LAB_PROBE_ROUTE}`, `POST ${READER_LAB_PROBE_ROUTE}`]) {
      expect(EXEMPT.has(k), k).toBe(true);
      expect(EXEMPT.get(k), k).toContain('reason 8');
      expect(EXEMPT.get(k), k).not.toContain('EXEMPT-BUT-AUTHENTICATED');
    }
    for (const k of [`POST ${READER_LAB_RUNS_PATH}`, `GET ${READER_LAB_RUNS_PATH}/:nonce`, `POST ${READER_LAB_RUNS_PATH}/:nonce/close`]) {
      expect(EXEMPT.has(k), k).toBe(false);
    }
  });
});
