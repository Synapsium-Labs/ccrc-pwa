// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ALL, ccrcRoot, here, prose, rel, sources, stallCode, stallCodeText } from './helpers.js';


// Docs W2, Task 8 (spec 2026-10-01 M7.10, section 1's ring column): the files under server/src/docs are classified
// by their IMPORTS, never by their path. policy.ts (L1) imports only shared/; ports.ts (L2) is type-only;
// ccdsource.ts (L3) names no fastify, no `reply` and no timer, and imports only from its stated list; only W3's
// routes.ts, hooks.ts, lane.ts and cache.ts (L4) may import fastify or own a timer. A file the table does not name
// is held to L3's rules, so a new file is never an exemption. The file list is read from the directory (`sources`,
// a readdirSync walk), never hand-kept. Every rule reads comment-stripped text (`stallCodeText`), so a sentence
// ABOUT fastify or a timer is never counted as one. APPENDED after the file's last line: `session-hook.test.ts`'s
// citation audit cites this file by line, so nothing above may move.
describe('the docs ring — server/src/docs is classified by its imports (spec 2026-10-01 M7.10)', () => {
  const docsDir = path.join(ccrcRoot, 'server/src/docs');
  type DocsRing = 'L1' | 'L2' | 'L3' | 'L4';
  /** Each known file's ring. W3's four L4 files are named now, so W3 adding them reds nothing here. */
  const DOCS_RING_ROLES: Readonly<Record<string, DocsRing>> = {
    'policy.ts': 'L1', 'ports.ts': 'L2', 'ccdsource.ts': 'L3',
    'routes.ts': 'L4', 'hooks.ts': 'L4', 'lane.ts': 'L4', 'cache.ts': 'L4',
  };
  /** The files W2 created. A FLOOR, not a count (the update ring's argument): a new file raises it, and a listed
   *  file that is gone reds instead of disarming the scan. */
  const DOCS_RING_FLOOR: readonly string[] = ['policy.ts', 'ports.ts', 'ccdsource.ts', 'routes.ts', 'hooks.ts', 'lane.ts', 'cache.ts'];
  /** What L3 may import (the W2 plan's Global Constraints): its server neighbours, node's hash, its own ring's
   *  policy and ports, and L0. A type import is an import. */
  const L3_IMPORTS: ReadonlySet<string> = new Set([
    '../ccdargv.js', '../lifecycle.js', '../exec.js', '../fleetstate.js', 'node:crypto', './policy.js', './ports.js',
    '../../../shared/docs.js',
  ]);
  /** A fastify import in any of its forms: `from`, a bare `import`, a dynamic `import(...)` or a `require(...)`;
   *  either quote; the package, a subpath, a `fastify-*` package or an `@fastify/*` one. */
  const FASTIFY = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(?:@fastify\/[^'"\n]*|fastify(?:[-/][^'"\n]*)?)\1/;
  const TIMERS = /\b(?:setTimeout|setInterval|setImmediate)\s*\(/;
  const RUNTIME_LOAD = /\bimport\s*\(|\brequire\s*\(/;
  const REPLY = /\breply\b/;
  const L2_RUNTIME_EXPORT = /^\s*export\s+(?:default\b|(?:async\s+)?(?:const|let|var|function|class|abstract|enum)\b|\{|\*)/m;
  /** Every static specifier: `import ... from 'x'`, `export ... from 'x'` and a bare `import 'x'`. */
  const specifiers = (code: string): string[] => [
    ...[...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"\n]+)\1/gm)].map((m) => m[2]),
    ...[...code.matchAll(/^\s*import\s*(['"])([^'"\n]+)\1/gm)].map((m) => m[2]),
  ];
  /** Over `[name, source]` pairs, so the CONTROLs below plant their shapes as text: no fixture directory, and so
   *  no new import line in this file. */
  const ringViolations = (files: readonly (readonly [string, string])[]): string[] =>
    files.flatMap(([name, text]) => {
      const role: DocsRing = DOCS_RING_ROLES[name] ?? 'L3';
      const code = stallCodeText(text);
      const at = `${name} (${role})`;
      const specs = specifiers(code);
      const out: string[] = [];
      if (role !== 'L4' && FASTIFY.test(code)) out.push(`${at} imports fastify`);
      if (role !== 'L4' && TIMERS.test(code)) out.push(`${at} owns a timer`);
      if (role === 'L1') {
        for (const s of specs) if (!/^(?:\.\.\/)+shared\//.test(s)) out.push(`${at} imports ${s}, outside shared/`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      if (role === 'L2') {
        for (const l of code.split('\n')) {
          if (/^\s*import\b/.test(l) && !/^\s*import\s+type\b/.test(l)) out.push(`${at} has a value import: ${l.trim()}`);
        }
        if (L2_RUNTIME_EXPORT.test(code)) out.push(`${at} exports a runtime value`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      if (role === 'L3') {
        if (REPLY.test(code)) out.push(`${at} names reply`);
        for (const s of specs) if (!L3_IMPORTS.has(s)) out.push(`${at} imports ${s}, not on L3's list`);
        if (RUNTIME_LOAD.test(code)) out.push(`${at} loads a module at run time`);
      }
      return out;
    });
  const docsNames = (): string[] => sources(docsDir).map((f) => path.relative(docsDir, f));
  const onDisk = (): (readonly [string, string])[] =>
    docsNames().map((n) => [n, readFileSync(path.join(docsDir, n), 'utf8')] as const);
  /** One live file with one planted line above its own text: the live text is clean, so the answer is exactly what
   *  the planted line breaks. */
  const planted = (name: string, line: string): (readonly [string, string])[] =>
    [[name, `${line}\n${readFileSync(path.join(docsDir, name), 'utf8')}`]];

  it('covers the directory — every floor file is visited by the directory walk (never a hand list)', () => {
    expect(existsSync(docsDir), 'server/src/docs is not on disk — was the directory moved?').toBe(true);
    const names = docsNames();
    for (const f of DOCS_RING_FLOOR) expect(names, `${f} is listed but not visited`).toContain(f);
    expect(names.length).toBeGreaterThanOrEqual(DOCS_RING_FLOOR.length);
  });

  it('the live tree: no file under server/src/docs breaks its ring', () => {
    expect(ringViolations(onDisk())).toEqual([]);
  });

  it('CONTROL: L1 (policy.ts) — fastify in each form, a node builtin, a server module, a timer', () => {
    expect(ringViolations(planted('policy.ts', "import fastify from 'fastify';"))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', "import 'fastify';"))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) imports fastify, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', 'const f = await import("fastify");'))).toEqual([
      'policy.ts (L1) imports fastify', 'policy.ts (L1) loads a module at run time',
    ]);
    expect(ringViolations(planted('policy.ts', "import { readFileSync } from 'node:fs';"))).toEqual([
      'policy.ts (L1) imports node:fs, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', "import type { CcdArgv } from '../ccdargv.js';"))).toEqual([
      'policy.ts (L1) imports ../ccdargv.js, outside shared/',
    ]);
    expect(ringViolations(planted('policy.ts', 'const t = setTimeout(() => {}, 1);'))).toEqual([
      'policy.ts (L1) owns a timer',
    ]);
  });

  it('CONTROL: L2 (ports.ts) — a value import and each runtime export are caught; a type re-export is not', () => {
    expect(ringViolations(planted('ports.ts', "import { DOCS_CAP } from '../ccdargv.js';"))).toEqual([
      "ports.ts (L2) has a value import: import { DOCS_CAP } from '../ccdargv.js';",
    ]);
    expect(ringViolations(planted('ports.ts', 'export const X = 1;'))).toEqual(['ports.ts (L2) exports a runtime value']);
    expect(ringViolations(planted('ports.ts', 'export function f(): void {}'))).toEqual(['ports.ts (L2) exports a runtime value']);
    expect(ringViolations(planted('ports.ts', "export { DOCS_CAP } from '../ccdargv.js';"))).toEqual([
      'ports.ts (L2) exports a runtime value',
    ]);
    expect(ringViolations(planted('ports.ts', "export type { DocsJob } from './policy.js';"))).toEqual([]);
    expect(ringViolations(planted('ports.ts', 'const m = await import("node:fs");'))).toEqual([
      'ports.ts (L2) loads a module at run time',
    ]);
  });

  it('CONTROL: L3 (ccdsource.ts) — reply, a timer, a fastify type and an unlisted import are caught; prose is not', () => {
    expect(ringViolations(planted('ccdsource.ts', 'reply.code(500);'))).toEqual(['ccdsource.ts (L3) names reply']);
    expect(ringViolations(planted('ccdsource.ts', 'setTimeout(() => {}, 1);'))).toEqual(['ccdsource.ts (L3) owns a timer']);
    expect(ringViolations(planted('ccdsource.ts', "import type { FastifyReply } from 'fastify';"))).toEqual([
      'ccdsource.ts (L3) imports fastify', "ccdsource.ts (L3) imports fastify, not on L3's list",
    ]);
    expect(ringViolations(planted('ccdsource.ts', "import { readFileSync } from 'node:fs';"))).toEqual([
      "ccdsource.ts (L3) imports node:fs, not on L3's list",
    ]);
    expect(ringViolations(planted('ccdsource.ts', 'const m = await import("node:fs");'))).toEqual([
      'ccdsource.ts (L3) loads a module at run time',
    ]);
    expect(ringViolations(planted('ccdsource.ts', '// reply, setTimeout( and import fastify are named here in prose only'))).toEqual([]);
  });

  it('CONTROL: an L4 file may import fastify and own a timer; an unclassified file is held to L3', () => {
    expect(ringViolations([
      ['routes.ts', "import type { FastifyInstance } from 'fastify';\nexport const t = setTimeout(() => {}, 1);\n"],
    ])).toEqual([]);
    expect(ringViolations([['extra.ts', "import fastify from 'fastify';\n"]])).toEqual([
      'extra.ts (L3) imports fastify', "extra.ts (L3) imports fastify, not on L3's list",
    ]);
    expect(ringViolations([['extra.ts', 'import fastifyStatic from "@fastify/static";\n']])).toEqual([
      'extra.ts (L3) imports fastify', "extra.ts (L3) imports @fastify/static, not on L3's list",
    ]);
  });
});


// Docs W2, Task 8: the names W2 declares, each with ONE home. W3's routes and later waves import them; a second
// declaration would be a second answer that nothing forces to agree. Two directions: a hand-kept table pins each
// W2 name to its file, and a derived scan holds EVERY export under server/src/docs (W3's included, with no list to
// maintain) to exactly one declaration across the four roots. The table is checked against the scan, so the scan
// cannot go blind to a name the table knows. Plus two docs-only spellings: the qualified ref prefixes are derived
// from L0 and never quoted under server/src/docs, and the adapter is the one caller of the docs builders (row 49's
// exact `docsFetch(` count is W3's). APPENDED, for the citation audit's reason above.
describe('docs W2 names are defined once (spec 2026-10-01 section 1, M7.10)', () => {
  const docsDir = path.join(ccrcRoot, 'server/src/docs');
  const POLICY = 'server/src/docs/policy.ts';
  const PORTS = 'server/src/docs/ports.ts';
  const SOURCE = 'server/src/docs/ccdsource.ts';
  const HOMES: Readonly<Record<string, string>> = {
    // policy.ts (L1): values, functions, types.
    DOCS_FAILURE_HTTP: POLICY, DOCS_CAPS_UNKNOWN_RETRY_AFTER_S: POLICY, DOCS_REF_PREFIXES: POLICY,
    DOCS_LANE_EXECS: POLICY, DOCS_LANE_BYTES: POLICY, DOCS_LANE_LARGE_RAW: POLICY, DOCS_LANE_QUEUE: POLICY,
    DOCS_LANE_MAX_WAIT_MS: POLICY, LISTING_JOB: POLICY, DOCS_CACHE_IMMUTABLE: POLICY, DOCS_CACHE_NO_STORE: POLICY,
    DOCS_JSON_CONTENT_TYPE: POLICY,
    docsRetryAfterSeconds: POLICY, docsRefTarget: POLICY, fetchBranchFor: POLICY, refreshDue: POLICY,
    parseDocsApiQuery: POLICY, parseDocsProjectParam: POLICY, parseDocsRefreshBody: POLICY, docsProvenance: POLICY,
    laneAdmit: POLICY, showRawBound: POLICY, showWire: POLICY, docsShowPlan: POLICY, cacheControlFor: POLICY,
    docsSendPolicy: POLICY,
    DocsRefTarget: POLICY, DocsFetchPlan: POLICY, DocsApiRoute: POLICY, DocsApiRequest: POLICY,
    DocsRefreshRequest: POLICY, DocsHeaderBag: POLICY, DocsProvenance: POLICY, DocsJob: POLICY, LaneLoad: POLICY,
    DocsShowPlan: POLICY, DocsSendVerdict: POLICY,
    // ports.ts (L2): types only.
    DocsNodeId: PORTS, DocsSourceId: PORTS, DocsShowAsk: PORTS, DocsIndexRead: PORTS, DocsTreeRead: PORTS,
    DocsShowRead: PORTS, DocsFetchRun: PORTS, DocsReader: PORTS, DocsFetcher: PORTS,
    // ccdsource.ts (L3): the deps type and the two factories.
    CcdDocsDeps: SOURCE, ccdDocsReader: SOURCE, ccdDocsFetcher: SOURCE,
    // Outside server/src/docs: the cap token, and the single reader of killed/signal.
    DOCS_CAP: 'server/src/ccdargv.ts', CcdEnding: 'server/src/lifecycle.ts', ccdEnding: 'server/src/lifecycle.ts',
  };
  /** A declaration of `name` in any of its shapes: a function (async or not), a `const|let|var|class|enum` binding,
   *  a type alias by its `=`, an interface; `export`/`declare` optional. An import, a re-export or a call declares
   *  nothing. */
  const DEF = (name: string): RegExp => new RegExp(
    `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:(?:async\\s+)?function\\s+${name}\\b|(?:const|let|var|class|enum)\\s+${name}\\b|type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`,
    'm');
  /** Every name a file exports by declaration. */
  const exportedNames = (text: string): string[] =>
    [...text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]);
  const text = new Map<string, string>();
  const src = (f: string): string => {
    const hit = text.get(f);
    if (hit !== undefined) return hit;
    const t = readFileSync(f, 'utf8');
    text.set(f, t);
    return t;
  };
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(src(f))).map(rel);
  /** A qualified ref prefix inside a string literal of any quote, a template included. */
  const QUOTED_PREFIX = /(['"`])refs\/(?:heads|remotes\/origin)\//;
  const DOCS_CALL = /\bCCD_ARGV\.docs\w*\s*\(/;

  it('CONTROL: DEF sees each declaration shape and an un-exported copy, and not an import, a re-export, a call or a longer name', () => {
    for (const decl of [
      'export const X = 1;', 'const X = 1;', 'export interface X {', 'export type X<T> = T;', 'type X = 1;',
      'export async function X(): Promise<void> {', 'function X(): void {', 'export class X {',
    ]) expect(DEF('X').test(decl), decl).toBe(true);
    for (const miss of [
      "import { X } from './policy.js';", "import {\n  type X,\n} from './policy.js';", 'export { X };',
      'export const X_SEEN = 1;', 'const y = X(1);', 'export type XY = 1;',
    ]) expect(DEF('X').test(miss), miss).toBe(false);
  });

  it('CONTROL: exportedNames reads every exported declaration and nothing else', () => {
    expect(exportedNames(
      'export const A = 1;\nexport function b(): void {}\nexport interface C {}\nexport type D = 1;\n'
      + 'export async function e(): Promise<void> {}\nconst f = 1;\nexport { f };\n  export const g = 1;\n',
    )).toEqual(['A', 'b', 'C', 'D', 'e']);
  });

  it.each(Object.entries(HOMES))('%s is declared exactly once, in %s', (name, home) => {
    expect(holders(DEF(name))).toEqual([home]);
  });

  it('every export under server/src/docs is declared exactly once across the four roots, in its own file', () => {
    const files = sources(docsDir);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      for (const name of exportedNames(src(f))) expect(holders(DEF(name)), name).toEqual([rel(f)]);
    }
  });

  it('the table is seen by the scan: every listed name under server/src/docs is an export of its home', () => {
    for (const [name, home] of Object.entries(HOMES)) {
      if (!home.startsWith('server/src/docs/')) continue;
      expect(exportedNames(src(path.join(ccrcRoot, home))), `${name} in ${home}`).toContain(name);
    }
  });

  it('CONTROL: QUOTED_PREFIX sees a quoted prefix in each quote, and not prose or the derived name', () => {
    for (const hit of ["const l = 'refs/heads/' + b;", 'const o = `refs/remotes/origin/${b}`;', 'x === "refs/heads/main"']) {
      expect(QUOTED_PREFIX.test(stallCodeText(hit)), hit).toBe(true);
    }
    for (const miss of [' * - `refs/heads/b`: skipped, local-ref', '// refs/remotes/origin/b', 'const [l, o] = DOCS_REF_PREFIXES;']) {
      expect(QUOTED_PREFIX.test(stallCodeText(miss)), miss).toBe(false);
    }
  });

  it("the qualified ref prefixes are quoted nowhere under server/src/docs (derived from L0's prefix body)", () => {
    expect(sources(docsDir).filter((f) => QUOTED_PREFIX.test(stallCode(f))).map(rel)).toEqual([]);
  });

  it('CONTROL: DOCS_CALL sees a builder call, and not the builder table or a comment', () => {
    expect(DOCS_CALL.test(stallCodeText('await deps.runCcd(CCD_ARGV.docsFetch(project, branch));'))).toBe(true);
    expect(DOCS_CALL.test(stallCodeText("  docsFetch: (project: string, branch: string | null) =>"))).toBe(false);
    expect(DOCS_CALL.test(stallCodeText('/** the ONE `CCD_ARGV.docsFetch(` in server/src */'))).toBe(false);
  });

  it('the docs builders have one caller across the four roots: the adapter', () => {
    expect(ALL.filter((f) => DOCS_CALL.test(stallCode(f))).map(rel)).toEqual([SOURCE]);
  });
});


// Docs W3, Task 9 (spec 2026-10-01 section 2 (g)'s walls, section 2 (j) row 49, section 3.13's new scans; W3
// refinement (q)). GET never fetches, read as text: row 49's literal half (exactly one `CCD_ARGV.docsFetch(` across
// the four roots, in the adapter), WIDENED for W2's review carry, which found that `DOCS_CALL` above cannot see an
// optional-chain, a bracket or an aliased call. The identifier `docsFetch` is held to its two code lines (the builder
// key and the one call), and every other `CCD_ARGV` in code must be a plain member access, so the builder table is
// never indexed, destructured, aliased or passed. And the visible half of "L4 decides nothing": no failure word of
// `shared/docs.ts`'s `DOCS_FAILURES` is quoted in the code of `routes.ts`, `hooks.ts`, `lane.ts` or `cache.ts`. The
// words are read from that file's TEXT (and held equal to the module's keys by a dynamic import), so this append adds
// no import above. `DOCS_RING_FLOOR` (edited in place, above) names those four files too, so a deleted L4 file reds
// the floor. Every scan reads comment-stripped text (`stallCodeText`). APPENDED, for the citation audit's reason above.
describe('docs W3 — GET never fetches, and the L4 files quote no failure word (spec 2026-10-01 §2 row 49, §3.13)', () => {
  type Text = readonly [string, string];
  const SOURCE = 'server/src/docs/ccdsource.ts';
  const ARGV = 'server/src/ccdargv.ts';
  const L4_FILES = ['routes.ts', 'hooks.ts', 'lane.ts', 'cache.ts'];
  /** Every file of the four roots as `[repo-relative path, text]`, read once. */
  const LIVE: readonly Text[] = ALL.map((f) => [rel(f), readFileSync(f, 'utf8')] as const);
  /** The live corpus with `shape` planted after `name`'s own text (a copy: nothing is written). */
  const plantedIn = (name: string, shape: string): Text[] =>
    LIVE.map(([n, t]) => [n, n === name ? `${t}\n${shape}\n` : t] as const);

  const LITERAL = 'CCD_ARGV.docsFetch(';
  /** One entry per literal `CCD_ARGV.docsFetch(` in code, naming its file. */
  const literalCalls = (files: readonly Text[]): string[] =>
    files.flatMap(([n, t]) => new Array<string>(stallCodeText(t).split(LITERAL).length - 1).fill(n));
  const DOCS_FETCH_ID = /\bdocsFetch\b/;
  /** D-5866 (Task C1k): `CCD_CAN`'s own entry for the row, a NAME keyed to its capability token, which builds and
   *  calls nothing. It is excepted in `ccdargv.ts` alone, on its own line, and held to exactly one such line below. */
  const CAN_ENTRY = /^\s*docsFetch: capRow\(DOCS_CAP\),\s*$/;
  /** D-5866: the adapter's own gate, `ccdCan(deps.fleetState, 'docsFetch')`, ASKS by the row's name and builds
   *  nothing. It is excepted in the adapter alone, on its own line, and held to exactly one such line below. */
  const CAN_ASK = /^\s*if \(!ccdCan\(deps\.fleetState, 'docsFetch'\)\) return fail\('unsupported'\);\s*$/;
  /** One entry per comment-stripped LINE that names the identifier `docsFetch`, naming its file. */
  const docsFetchLines = (files: readonly Text[]): string[] =>
    files.flatMap(([n, t]) => stallCodeText(t).split('\n')
      .filter((l) => DOCS_FETCH_ID.test(l) && !(n === ARGV && CAN_ENTRY.test(l)) && !(n === SOURCE && CAN_ASK.test(l)))
      .map(() => n));
  /** A whole static import statement, single- or multi-line (lazy, and never across a `;`). */
  const IMPORT_STATEMENT = /^\s*import\s[^;]*?\bfrom\s*(['"])[^'"\n]+\1\s*;?/gm;
  /** `CCD_ARGV` NOT followed by a plain member access (`.name`, whitespace and newlines allowed around the dot). */
  // D-5866 (Task C1k): a TYPE query `keyof typeof CCD_ARGV` (the row-name type `CCD_CAN` is keyed by) reads no value,
  // so it is not an escape. A bare `typeof CCD_ARGV` is still one.
  const ARGV_ESCAPE = /(?<!\bkeyof\s+typeof\s+)\bCCD_ARGV\b(?!\s*\.\s*[A-Za-z_$])/g;
  const ARGV_DECLARATION = 'export const CCD_ARGV = {';
  /** Every `CCD_ARGV` in code, imports removed, that is not a plain member access, as `file: line`; the table's one
   *  declaration excepted. */
  const argvEscapes = (files: readonly Text[]): string[] => files.flatMap(([n, t]) => {
    const code = stallCodeText(t).replace(IMPORT_STATEMENT, '');
    const out: string[] = [];
    for (const m of code.matchAll(ARGV_ESCAPE)) {
      const start = code.lastIndexOf('\n', m.index) + 1;
      const end = code.indexOf('\n', m.index);
      const at = code.slice(start, end === -1 ? code.length : end).trim();
      if (n === ARGV && at === ARGV_DECLARATION) continue;
      out.push(`${n}: ${at}`);
    }
    return out;
  });

  it('row 49, literal: exactly one `CCD_ARGV.docsFetch(` across the four roots, in the adapter', () => {
    expect(literalCalls(LIVE)).toEqual([SOURCE]);
  });

  it('row 49, widened by identifier: `docsFetch` names two code lines, the builder key and the one call', () => {
    expect(docsFetchLines(LIVE).sort()).toEqual([ARGV, SOURCE]);
  });

  it('row 49: CCD_CAN\'s docsFetch entry is one line, in ccdargv.ts, and the exception sees nothing else (D-5866)', () => {
    const argvText = LIVE.find(([n]) => n === ARGV)![1];
    expect(stallCodeText(argvText).split('\n').filter((l) => CAN_ENTRY.test(l))).toHaveLength(1);
    const before = docsFetchLines(LIVE).length;
    expect(docsFetchLines(plantedIn(SOURCE, '  docsFetch: capRow(DOCS_CAP),')).length, 'outside ccdargv.ts it counts')
      .toBe(before + 1);
    expect(docsFetchLines(plantedIn(ARGV, '  docsFetch: (p, b) => CCD_ARGV.docsFetch(p, b),')).length, 'another line counts')
      .toBe(before + 1);
    const sourceText = LIVE.find(([n]) => n === SOURCE)![1];
    expect(stallCodeText(sourceText).split('\n').filter((l) => CAN_ASK.test(l)), 'the adapter asks once').toHaveLength(1);
    expect(docsFetchLines(plantedIn(ARGV, "  if (!ccdCan(deps.fleetState, 'docsFetch')) return fail('unsupported');")).length,
      'the ask counts outside the adapter').toBe(before + 1);
    expect(docsFetchLines(plantedIn(SOURCE, "  if (!ccdCan(deps.fleetState, 'docsFetch')) return run(CCD_ARGV.docsFetch(p, b));"))
      .length, 'a line that asks AND calls counts').toBe(before + 1);
  });

  it('CONTROL: a keyof-typeof type query is not an escape; a bare typeof or a value use still is (D-5866)', () => {
    const before = argvEscapes(LIVE).length;
    expect(argvEscapes(plantedIn(SOURCE, 'type R = keyof typeof CCD_ARGV;')).length).toBe(before);
    expect(argvEscapes(plantedIn(SOURCE, 'type T = typeof CCD_ARGV;')).length).toBe(before + 1);
    expect(argvEscapes(plantedIn(SOURCE, 'const r = Object.keys(CCD_ARGV) as (keyof typeof CCD_ARGV)[];')).length)
      .toBe(before + 1);
  });

  it('row 49, widened by use: `CCD_ARGV` is only ever a plain member access, outside its one declaration', () => {
    expect(argvEscapes(LIVE)).toEqual([]);
    expect(LIVE.filter(([n]) => n === ARGV).flatMap(([, t]) => stallCodeText(t).split('\n'))
      .filter((l) => l.trim() === ARGV_DECLARATION), 'the declaration the escape scan excepts moved').toHaveLength(1);
  });

  it('CONTROL: every call shape the literal scan misses is caught by one of the two widened scans; prose by neither', () => {
    const base = {
      literal: literalCalls(LIVE).length, lines: docsFetchLines(LIVE).length, escapes: argvEscapes(LIVE).length,
    };
    const SHAPES: readonly (readonly [string, boolean, boolean])[] = [
      // [the planted text, seen by the identifier scan, seen by the escape scan]
      ['const a = CCD_ARGV?.docsFetch(p, b);', true, true],
      ["const a = CCD_ARGV['docsFetch'](p, b);", true, true],
      ['const a = CCD_ARGV["docsFetch"](p, b);', true, true],
      ['const { docsFetch } = CCD_ARGV;', true, true],
      ['const A = CCD_ARGV; A.docsFetch(p, b);', true, true],
      ['const a = CCD_ARGV\n  .docsFetch(p, b);', true, false],
      ["const f = Reflect.get(CCD_ARGV, 'docsFetch');", true, true],
    ];
    for (const [shape, byId, byEscape] of SHAPES) {
      const planted = plantedIn(SOURCE, shape);
      expect(literalCalls(planted).length, `${shape}: the literal scan was expected to miss it`).toBe(base.literal);
      expect(docsFetchLines(planted).length > base.lines, `${shape}: identifier scan`).toBe(byId);
      expect(argvEscapes(planted).length > base.escapes, `${shape}: escape scan`).toBe(byEscape);
      expect(byId || byEscape, shape).toBe(true);
    }
    for (const prose of ['// a CCD_ARGV?.docsFetch( or `const { docsFetch } = CCD_ARGV` in prose',
      ' * CCD_ARGV[\'docsFetch\'] named in a docstring']) {
      const planted = plantedIn(SOURCE, prose);
      expect(docsFetchLines(planted).length, prose).toBe(base.lines);
      expect(argvEscapes(planted).length, prose).toBe(base.escapes);
    }
    expect(literalCalls(plantedIn(SOURCE, 'void CCD_ARGV.docsFetch(p, b);')).length, 'the literal scan is blind')
      .toBe(base.literal + 1);
  });

  /** `DOCS_FAILURES`' keys, read from `shared/docs.ts`'s TEXT: its `export const DOCS_FAILURES = {` block. */
  const failureWords = (): string[] => {
    const text = readFileSync(path.join(ccrcRoot, 'shared/docs.ts'), 'utf8');
    const open = text.indexOf('export const DOCS_FAILURES = {');
    const close = text.indexOf('} as const', open);
    expect(open, 'the DOCS_FAILURES block moved').toBeGreaterThan(-1);
    expect(close, 'the DOCS_FAILURES block has no end').toBeGreaterThan(open);
    return [...text.slice(open, close).matchAll(/^\s*'([a-z][a-z-]*)':/gm)].map((m) => m[1]);
  };
  /** The words of `words` quoted as a whole literal (single, double or backtick) in `text`'s code. */
  const quotedWords = (text: string, words: readonly string[]): string[] => {
    const code = stallCodeText(text);
    return words.filter((w) => new RegExp(`(['"\`])${w}\\1`).test(code));
  };
  const l4 = (): Text[] =>
    L4_FILES.map((n) => [n, readFileSync(path.join(ccrcRoot, 'server/src/docs', n), 'utf8')] as const);

  it('the failure words read from the text are exactly DOCS_FAILURES\' keys', async () => {
    const { DOCS_FAILURES } = await import('../../../shared/docs.js');
    expect(failureWords()).toEqual(Object.keys(DOCS_FAILURES));
  });

  it('CONTROL: a quoted word is seen in each quote; a backticked word in a prose comment is not', () => {
    const words = failureWords();
    for (const hit of ["const w = 'docs-busy';", 'const w = "bad-query";', 'const w = `foreign-request`;']) {
      expect(quotedWords(hit, words), hit).toHaveLength(1);
    }
    for (const miss of ['// the lane answers `docs-busy` past its wait', ' * a `bad-query {why}` refusal',
      'const w = docsBusyBody(lane);']) {
      expect(quotedWords(miss, words), miss).toEqual([]);
    }
  });

  it('L4 decides nothing (the visible half): routes.ts, hooks.ts, lane.ts and cache.ts quote no failure word', () => {
    const words = failureWords();
    const files = l4();
    expect(files.map(([n]) => n)).toEqual(L4_FILES);
    expect(files.flatMap(([n, t]) => quotedWords(t, words).map((w) => `${n}: '${w}'`))).toEqual([]);
  });
});
