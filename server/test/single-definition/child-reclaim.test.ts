// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sourceOfSymbol } from '../scan/symbols.js';
import { ALL, HISTORY_MJS, ccrcRoot, codeLines, here, holdersOf, isBashComment, rel, sources, stallCode, stallCodeText } from './helpers.js';


// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10): the temp-root id predicate and its cap are ONE L0 function and ONE
// L0 constant. This block is APPENDED for the reason the blocks above state: `session-hook.test.ts`'s citation audit
// cites this file by line. Before this wave the kept-leaf reader held a private copy (`leafIdOk`) and the store a
// private cap (`CHILD_RECLAIM_MAX_SESSION_ID_CHARS`). A third copy is how the dash and length clauses would be lost
// again, so it reds here.
describe('child reclamation wave 9: the temp-root id predicate and its cap are defined once, in shared/api.ts', () => {
  const DEF_FN = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${n}\\b`, 'm');
  const DEF_VAL = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`, 'm');
  const definers = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel).sort();
  /** The session-id shape and a leading-dot or leading-dash test on one code line: a re-derived predicate under a new name. */
  const REDERIVED = /\bisSessionIdShape\s*\(.*startsWith\(\s*['"][.-]['"]\s*\)|startsWith\(\s*['"][.-]['"]\s*\).*\bisSessionIdShape\s*\(/;

  it('CONTROL: the patterns see a declaration, an un-exported copy and a re-derivation, and not an import or a call', () => {
    expect(DEF_FN('isTmpRootId').test('export function isTmpRootId(id: unknown): id is string {')).toBe(true);
    expect(DEF_VAL('leafIdOk').test('const leafIdOk = (id: string): boolean => isTmpRootId(id);')).toBe(true);
    expect(DEF_VAL('TMPROOT_ID_MAX_CHARS').test("import { TMPROOT_ID_MAX_CHARS } from '../../../shared/api.js';")).toBe(false);
    expect(DEF_FN('isTmpRootId').test('  if (!isTmpRootId(id)) return;')).toBe(false);
    expect(REDERIVED.test("const ok = (id: string): boolean => isSessionIdShape(id) && !id.startsWith('.');")).toBe(true);
    expect(REDERIVED.test("const ok = (id: string): boolean => isSessionIdShape(id) && !id.startsWith('-');")).toBe(true);
    expect(REDERIVED.test('if (!isSessionIdShape(sid)) {')).toBe(false);
  });

  it('isTmpRootId and TMPROOT_ID_MAX_CHARS are declared in shared/api.ts and nowhere else', () => {
    expect(definers(DEF_FN('isTmpRootId'))).toEqual(['shared/api.ts']);
    expect(definers(DEF_VAL('isTmpRootId'))).toEqual([]);
    expect(definers(DEF_VAL('TMPROOT_ID_MAX_CHARS'))).toEqual(['shared/api.ts']);
  });

  it('the two private copies are gone, and the two files that held them use the L0 names', () => {
    expect(definers(DEF_VAL('leafIdOk')), 'leafIdOk').toEqual([]);
    expect(definers(DEF_VAL('CHILD_RECLAIM_MAX_SESSION_ID_CHARS')), 'the store cap').toEqual([]);
    expect(stallCode(path.join(ccrcRoot, 'server/src/childReclaimSweep.ts'))).toMatch(/\bisTmpRootId\s*\(/);
    expect(stallCode(path.join(ccrcRoot, 'server/src/coord/store.ts'))).toMatch(/\bTMPROOT_ID_MAX_CHARS\b/);
  });

  it('no code line outside shared/api.ts re-derives it from the session-id shape and a leading-dot or leading-dash test', () => {
    expect(ALL.filter((f) => rel(f) !== 'shared/api.ts' && stallCode(f).split('\n').some((l) => REDERIVED.test(l)))
      .map(rel)).toEqual([]);
  });
});


// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10). APPENDED, for the reason the blocks above state: `session-hook.test.ts`'s
// citation audit cites this file by line. The temp-root collector's lane SHIPS SHADOWED: until `$REG/collect-lane-live`
// exists it audits and records "would collect" and never composes `ws-collect`. The file is the operator's to touch BY
// HAND on the fleet box, as `expire-lane-live` is, so no line of shell names it. Its one TS spelling is its definer, an
// L1 file that reaches no `node:` module and so cannot write it.
describe('child reclamation wave 9: the collector lane’s live switch has no writer in the tree', () => {
  const NAME = 'collect-lane-live';
  const DEFINER = 'shared/switches.ts'; // its switchboard row since D-5855; collectLane.ts re-exports it

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER, the expiry pin's argument: a file that imports the ONE spelling and holds an `io` could write it
  // without spelling its name. The files whose code names the constant are the definer and the executor, which reads
  // it from the registry listing alone; neither reaches a FILE write, and since wave 10 the executor's one write is
  // the latch, through the store's setCollectLane. The lane's feed and attention writes live in watch.ts, never naming it.
  it('the files that name its constant are the definer, its re-exporter and the executor, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('COLLECT_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});


// CHILD RECLAMATION WAVE 9 (spec 2026-09-22 §5.10, "The population"). Task 1's wave-9 describe ("the temp-root id
// predicate and its cap are defined once, in shared/api.ts") holds the predicate's one L0 definer, its forerunners'
// absence, and the kept-leaf reader's and the store's use. This block adds the collector's two files: the lane and the
// executor each import the L0 predicate and CALL it, so the population and the job's step 1 cannot drift to a private
// copy under a new name, which a scan of declarations would not see. KNOWN WIDTH: a call kept beside a private copy
// still passes here.
describe('child reclamation wave 9: the collector’s lane and executor call the temp-root id predicate from L0', () => {
  it('its readers import it: the lane and the executor import isTmpRootId from shared/api.js and call it', () => {
    const code = (r: string): string => stallCode(path.join(ccrcRoot, r));
    for (const r of ['server/src/collectLane.ts', 'server/src/coord/collectTempRoot.ts']) {
      expect(code(r), r).toMatch(/\bisTmpRootId\s*\(/);
      expect(code(r), `${r} does not import it from L0`)
        .toMatch(/import\s*(?:type\s*)?\{[^}]*\bisTmpRootId\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/api\.js'/);
    }
  });
});


// PATH IDENTITY W1a (spec 2026-10-12 §2.3): the registry id predicate and its cap are ONE L0 function and ONE L0
// constant, and the collector's temp-root names derive from them, so the dash, dot and length clauses are written
// once. APPENDED after the last describe, for the reason the blocks above state: `session-hook.test.ts`'s citation
// audit cites this file by line. The wave 9 describe above still holds `isTmpRootId`'s one function definer and the
// store's use of `TMPROOT_ID_MAX_CHARS`. Its three pattern helpers are block-local there, and hoisting them would move
// this file's cited lines, so this block keeps its own copies under the same names.
describe('path identity W1a: the registry id predicate is defined once, and isTmpRootId derives from it', () => {
  const DEF_FN = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${n}\\b`, 'm');
  const DEF_VAL = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`, 'm');
  const definers = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel).sort();
  const API = (): string => readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
  const TMP_DECL = 'export function isTmpRootId(id: unknown): id is string {';
  /** `isTmpRootId`'s body: from the end of its declaration line to the first bare closing brace, or null. */
  const tmpBody = (t: string): string | null => {
    const at = t.indexOf(TMP_DECL);
    if (at === -1) return null;
    const end = t.indexOf('\n}', at);
    return end === -1 ? null : t.slice(at + TMP_DECL.length, end);
  };
  /** The right-hand side of `TMPROOT_ID_MAX_CHARS`'s declaration, or null. */
  const aliasRhs = (t: string): string | null => /^export const TMPROOT_ID_MAX_CHARS = (.*)$/m.exec(t)?.[1] ?? null;

  it('CONTROL: the body slice sees a re-derived body and a derived one, and the alias reader sees a literal', () => {
    const old = `${TMP_DECL}\n  return typeof id === 'string' && id.length <= TMPROOT_ID_MAX_CHARS && isSessionIdShape(id)\n`
      + `    && !id.startsWith('.') && !id.startsWith('-');\n}\n`;
    expect(tmpBody(old)).toMatch(/startsWith/);
    expect(tmpBody(old)).not.toMatch(/\bisRegistryId\s*\(/);
    const derived = `${TMP_DECL}\n  return isRegistryId(id);\n}\n`;
    expect(tmpBody(derived)).toMatch(/\bisRegistryId\s*\(/);
    expect(tmpBody(derived)).not.toMatch(/startsWith/);
    expect(tmpBody('export const isTmpRootId = isRegistryId;\n')).toBeNull();
    expect(aliasRhs('export const TMPROOT_ID_MAX_CHARS = 255;\n')).toBe('255;');
    expect(DEF_VAL('REGISTRY_ID_MAX_CHARS').test('export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;')).toBe(false);
  });

  it('isRegistryId and REGISTRY_ID_MAX_CHARS are declared in shared/api.ts and nowhere else', () => {
    expect(definers(DEF_FN('isRegistryId'))).toEqual(['shared/api.ts']);
    expect(definers(DEF_VAL('isRegistryId'))).toEqual([]);
    expect(definers(DEF_VAL('REGISTRY_ID_MAX_CHARS'))).toEqual(['shared/api.ts']);
  });

  it('isTmpRootId calls isRegistryId and tests no prefix itself', () => {
    const body = tmpBody(API());
    expect(body, 'isTmpRootId is not declared as a function in shared/api.ts').not.toBeNull();
    expect(body).toMatch(/\bisRegistryId\s*\(/);
    expect(body).not.toMatch(/startsWith/);
    expect(body).not.toMatch(/\bisSessionIdShape\b/);
  });

  it('TMPROOT_ID_MAX_CHARS is the alias, never a second literal', () => {
    expect(aliasRhs(API())).toBe('REGISTRY_ID_MAX_CHARS;');
  });

  // Wave 9's REDERIVED scan reads one code line at a time, so a copy of the old two-line body under a new name (the
  // shape call on one line, the prefix tests on the next) passes it. This scan reads each file's whole code text, and
  // `[^;{}]` keeps a match inside one statement, so a shape check and a prefix test in two statements are not a copy.
  it('no file outside shared/api.ts re-derives it from the shape and a prefix test, even across lines', () => {
    const REDERIVED_STMT = new RegExp(
      String.raw`\bisSessionIdShape\s*\([^;{}]*?startsWith\(\s*['"][.-]['"]\s*\)`
      + String.raw`|startsWith\(\s*['"][.-]['"]\s*\)[^;{}]*?\bisSessionIdShape\s*\(`);
    expect(REDERIVED_STMT.test("const ok = (id: string): boolean => isSessionIdShape(id)\n  && !id.startsWith('-');\n"),
      'CONTROL: a two-line copy').toBe(true);
    expect(REDERIVED_STMT.test("const ok = (id: string): boolean => !id.startsWith('.')\n  && isSessionIdShape(id);\n"),
      'CONTROL: a two-line copy, prefix first').toBe(true);
    expect(REDERIVED_STMT.test("if (!isSessionIdShape(sid)) {\n  return null;\n}\nif (sid.startsWith('-')) {\n"),
      'CONTROL: two statements are not a copy').toBe(false);
    expect(REDERIVED_STMT.test(stallCodeText("  // isSessionIdShape(id) && !id.startsWith('-')\n")),
      'CONTROL: a comment line is not code').toBe(false);
    expect(ALL.filter((f) => rel(f) !== 'shared/api.ts' && REDERIVED_STMT.test(stallCode(f))).map(rel)).toEqual([]);
  });
});

// CHILD RECLAMATION WAVE 10 (path-identity spec 2026-10-12 §5.9: "Exactly one database writer and one journal append
// adapter exist; only POST and automatic latch call the writer"). APPENDED, for the reason the blocks above state:
// `session-hook.test.ts`'s citation audit cites this file by line. Settings now arms the temp-root collector beside the
// hand-touched legacy file, so what may move the switch is pinned as text:
// - the store's one writer is called by the route's POST and the one latch helper, and by nothing else;
// - the generation journal is appended by one adapter, from inside that writer only, and its basename is spelled once;
// - the resolver that turns the switch into a licence is called by the executor and the GET's view composer alone;
// - the latch helper is called by the executor and the lane's pass alone.
// The call census reads server/src only: the PWA's client method of the same name posts to the route and is not the
// store's writer, and the PWA cannot import server/src. Code lines only (`stallCode`): a sentence about a call is never a
// call. KNOWN WIDTH: a call spelled inside a string on a code line counts, which errs toward red. A call through an
// alias (`const w = store.setCollectLane; w(…)`) is not seen; the bar is the ordinary call.
// D-6114: the pass's call count below reads `FleetWatcher.collectPass` by symbol. Imported here, beside its one
// reader, so no line above moves (line citations into this file stay anchored).
describe('child reclamation wave 10: the collector switch has one writer, one journal and one resolver', () => {
  const STORE = 'server/src/coord/store.ts';
  const ROUTES = 'server/src/coord/routes.ts';
  const EXECUTOR = 'server/src/coord/collectTempRoot.ts';
  const LANE = 'server/src/collectLane.ts';
  const ADAPTER = 'server/src/coord/collectLaneJournal.ts';
  const WATCH = 'server/src/watch.ts';
  const SERVER = ALL.filter((f) => rel(f).startsWith('server/src/'));
  const code = (r: string): string => stallCode(path.join(ccrcRoot, r));
  /** A call or a method head: the name and its paren, never after `function ` (a declaration). */
  const CALL = (n: string): RegExp => new RegExp(`(?<!function\\s+)\\b${n}\\s*\\(`, 'g');
  const count = (text: string, re: RegExp): number => [...text.matchAll(re)].length;
  /** `file:n` for every server/src file whose code lines match `re` (global) n times, sorted. */
  const sitesOf = (re: RegExp): string[] => SERVER.flatMap((f) => {
    const n = count(stallCode(f), re);
    return n === 0 ? [] : [`${rel(f)}:${n}`];
  }).sort();
  const DEF_FN = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\b`, 'm');
  const DEF_VAL = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`, 'm');
  const definers = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  /** Quoted strings and template literals blanked to spaces, newlines kept: a brace inside a quote never moves a
   *  body's end. */
  const unquoted = (t: string): string =>
    t.replace(/'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`/g, (m) => m.replace(/[^\n]/g, ' '));
  /** The `{…}` body that opens at the first brace after the first match of `head`; '' when `head` matches nothing. */
  const bodyAfter = (text: string, head: RegExp): string => {
    const at = text.search(head);
    if (at < 0) return '';
    const flat = unquoted(text);
    const open = flat.indexOf('{', at);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < flat.length; i++) {
      if (flat[i] === '{') depth += 1;
      else if (flat[i] === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(open, i + 1);
      }
    }
    return text.slice(open);
  };
  /** The route's POST, from its registration to its handler's own closing brace (`bodyAfter`), never on to the next
   *  registration: a helper declared between the two is not the handler. '' when the registration is gone. */
  const postSlice = (text: string): string => {
    const at = text.indexOf("app.post('/api/coord/collect-lane'");
    const rest = at < 0 ? '' : text.slice(at);
    const body = bodyAfter(rest, /^/);
    return body === '' ? '' : rest.slice(0, rest.indexOf(body) + body.length);
  };

  it('CONTROL: the scanners see a call, a method head and a body, and not a declaration, a comment line or a quoted brace', () => {
    expect(count('    const w = deps.coord.setCollectLane(req, at, deps.collectLane.journal);', CALL('setCollectLane'))).toBe(1);
    expect(count('  setCollectLane(req: CollectLaneWriteRequest, at: number, journal: CollectLaneJournal): CollectLaneWrite {',
      CALL('setCollectLane')), 'a method head is a site').toBe(1);
    expect(count('export function collectLaneEffective(i: CollectLaneInputs): CollectLaneEffective {', CALL('collectLaneEffective')))
      .toBe(0);
    expect(count('export async function collectRetireLatch(c: CollectControlDeps): CollectLatchOutcome {', CALL('collectRetireLatch')))
      .toBe(0);
    expect(count(stallCodeText('  // c.coord.setCollectLane(req, at, journal)\n   * collectLaneEffective(i) is called here'),
      CALL('setCollectLane')), 'a comment line is not a call').toBe(0);
    expect(DEF_FN('collectRetireLatch').test(
      'export function collectRetireLatch(c: CollectControlDeps, switches: CollectSwitches, epoch: CollectEpochPair): CollectLatchOutcome {'))
      .toBe(true);
    expect(DEF_FN('collectRetireLatch').test('    const out = collectRetireLatch(deps.control, sw, pair);')).toBe(false);
    const planted = "export function f(): void {\n  const s = '}';\n  g(`${'{'}`);\n  if (x) { h(); }\n}\nexport function k(): void { h(); }\n";
    expect(bodyAfter(planted, /^export function f\(/m), 'the body ends at its own brace, past a quoted one')
      .toBe("{\n  const s = '}';\n  g(`${'{'}`);\n  if (x) { h(); }\n}");
    expect(bodyAfter(planted, /^export function absent\(/m), 'an absent head reads as no body').toBe('');
    const routes = "app.get('/api/coord/collect-lane', a);\napp.post('/api/coord/collect-lane', async () => { w(); });\nconst below = () => s.setCollectLane(r);\napp.get('/api/runs', b);\n";
    expect(postSlice(routes), 'the slice ends at the handler’s brace, short of a helper below it').toBe("app.post('/api/coord/collect-lane', async () => { w(); }");
    expect(SERVER.length, 'the walk reached server/src').toBeGreaterThan(30);
    expect(SERVER.map(rel)).toContain(STORE);
  });

  it('setCollectLane is defined in store.ts and called only in the route’s POST and collectRetireLatch', () => {
    expect(sitesOf(/\bsetCollectLane\s*\(/g), 'a second caller, or a second definition')
      .toEqual([`${EXECUTOR}:1`, `${ROUTES}:1`, `${STORE}:1`]);
    expect(code(STORE), 'the store’s one spelling is not the single-line method head')
      .toMatch(/^[ \t]*setCollectLane\s*\([^)]*\)\s*:\s*CollectLaneWrite\s*\{[ \t]*$/m);
    const post = postSlice(code(ROUTES));
    expect(post, 'the POST registration is gone — this scan is over nothing').toContain("app.post('/api/coord/collect-lane'");
    expect(count(post, /\bsetCollectLane\s*\(/g), 'the routes.ts call is not in the POST handler').toBe(1);
    expect(count(bodyAfter(code(EXECUTOR), /^export function collectRetireLatch\(/m), /\bsetCollectLane\s*\(/g),
      'the executor file’s call is not in the latch helper').toBe(1);
  });

  it('appendGeneration is defined once, in the adapter, and called once, in setCollectLane', () => {
    expect(sitesOf(/\.appendGeneration\s*\(/g), 'a second caller of the append').toEqual([`${STORE}:1`]);
    expect(count(bodyAfter(code(STORE), /^[ \t]*setCollectLane\s*\(/m), /\.appendGeneration\s*\(/g),
      'the store’s append is not inside setCollectLane').toBe(1);
    expect(SERVER.filter((f) => /\bappendGeneration\b/.test(stallCode(f))).map(rel).sort(),
      'a second file defines or names the append').toEqual([LANE, ADAPTER, STORE]);
    const lane = code(LANE);
    const port = bodyAfter(lane, /^export interface CollectLaneJournal\b/m);
    expect(count(port, /\bappendGeneration\b/g), 'the L1 port no longer declares the append').toBe(1);
    expect(count(lane, /\bappendGeneration\b/g), 'collectLane.ts names the append outside the port it declares').toBe(1);
    expect(count(code(STORE), /\bappendGeneration\b/g), 'the store names the append other than by its one call').toBe(1);
    expect(count(code(ADAPTER), /\bappendGeneration\b/g), 'the adapter does not name the append exactly once').toBe(1);
  });

  it('COLLECT_LANE_JOURNAL_BASENAME has one definer, and the quoted basename stands on no other TS or TSX code line', () => {
    const BASENAME = 'collect-lane-generation.log';
    expect(stallCodeText(`  // ~/.ccrc/${BASENAME}\n   * ${BASENAME}`).includes(BASENAME), 'CONTROL: a comment line is not a spelling')
      .toBe(false);
    expect(stallCodeText(`const p = '${BASENAME}';`).includes(BASENAME), 'CONTROL: a code line is').toBe(true);
    expect(definers(DEF_VAL('COLLECT_LANE_JOURNAL_BASENAME')), 'a second definer').toEqual([ADAPTER]);
    expect(ALL.filter((f) => stallCode(f).includes(BASENAME)).map(rel).sort(), 'the basename spelled outside its definer')
      .toEqual([ADAPTER]);
    expect(code(ADAPTER).split(BASENAME).length - 1, 'the definer spells it more than once').toBe(1);
    expect(code(ADAPTER)).toMatch(/^export const COLLECT_LANE_JOURNAL_BASENAME = 'collect-lane-generation\.log';$/m);
  });

  it('collectLaneEffective is defined in collectLane.ts and called only in collectTempRoot and collectLaneView', () => {
    expect(definers(DEF_FN('collectLaneEffective')), 'a second definition').toEqual([LANE]);
    expect(definers(DEF_VAL('collectLaneEffective')), 'a definition as a value').toEqual([]);
    const calls = CALL('collectLaneEffective');
    expect(sitesOf(calls).map((s) => s.slice(0, s.lastIndexOf(':'))), 'a caller outside the executor and the view')
      .toEqual([LANE, EXECUTOR]);
    const lane = code(LANE);
    const view = bodyAfter(lane, /^export function collectLaneView\(/m);
    expect(count(view, calls), 'collectLaneView does not resolve the switch').toBeGreaterThan(0);
    expect(count(lane, calls), 'collectLane.ts calls the resolver outside collectLaneView').toBe(count(view, calls));
    const exec = code(EXECUTOR);
    const job = bodyAfter(exec, /^export async function collectTempRoot\(/m);
    expect(count(job, calls), 'the executor does not resolve the switch').toBeGreaterThan(0);
    expect(count(exec, calls), 'collectTempRoot.ts calls the resolver outside the executor').toBe(count(job, calls));
  });

  it('collectRetireLatch is called only by the executor and the pass', () => {
    expect(definers(DEF_FN('collectRetireLatch')), 'a second definition').toEqual([EXECUTOR]);
    const calls = CALL('collectRetireLatch');
    expect(sitesOf(calls), 'a third caller, or a second call').toEqual([`${EXECUTOR}:1`, `${WATCH}:1`]);
    expect(count(bodyAfter(code(EXECUTOR), /^export async function collectTempRoot\(/m), calls),
      'the executor file’s call is not in collectTempRoot').toBe(1);
    // D-6114: keyed on the method's symbol (scan/symbols.ts), so C1h's rewrite of the pass moves the slice with it.
    expect(count(stallCodeText(sourceOfSymbol(path.join(ccrcRoot, WATCH), 'FleetWatcher.collectPass')), calls),
      'watch.ts’s call is not in the pass').toBe(1);
  });

  it('the marker’s holders are still exactly the definer, its re-exporter and the executor', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    // D-5855: the definer is the marker's switchboard row; `collectLane.ts` re-exports it.
    expect(ALL.filter((f) => stallCode(f).includes('collect-lane-live')).map(rel).sort(), 'the marker spelled outside its definer')
      .toEqual(['shared/switches.ts']);
    expect(ALL.filter((f) => stallCode(f).includes('COLLECT_LANE_LIVE_MARKER')).map(rel).sort(), 'a fourth holder of its constant')
      .toEqual([LANE, EXECUTOR, 'shared/switches.ts']);
    expect(code(EXECUTOR), 'the executor reaches a file write').not.toMatch(WRITE);
    expect(count(code(EXECUTOR), /\.setCollectLane\s*\(/g), 'the executor’s one write is the latch, through the store').toBe(1);
    expect(code(EXECUTOR), 'the executor appends to the journal itself').not.toMatch(/\.appendGeneration\s*\(/);
  });
});


// CHILD RECLAMATION WAVE 10 (path-identity spec 2026-10-12 §5.3). APPENDED, for the reason the blocks above state:
// `session-hook.test.ts`'s citation audit cites this file by line. The temp-root collector's generation journal only
// moves forward: no backup copies it, and no restore, rollback or watchdog arm moves it back, so a database snapshot
// restored without it reads as a mismatch and stops the lane. The one shell file that names it is `ccd/ccrc`, and only
// in what it TELLS the operator: the usage text and the downgrade report's one echo. The name is read off its one TS
// definer, so a rename on either side reds here.
describe('child reclamation wave 10: only ccrc\'s wording names the journal in shell', () => {
  const DEFINER = 'server/src/coord/collectLaneJournal.ts';
  const NAME = /^export const COLLECT_LANE_JOURNAL_BASENAME = '([^']+)';$/m
    .exec(readFileSync(path.join(ccrcRoot, DEFINER), 'utf8'))?.[1] ?? '';
  /** A shell act on a path: copy, move, removal, link, install, tee, truncate, dd, rsync, or any redirect. */
  const ACT = /\b(?:rm|cp|mv|ln|install|tee|truncate|dd|rsync)\b|>/;

  it('CONTROL: the name was read off its definer, and the act pattern sees a removal and a redirect but not the echo', () => {
    expect(NAME, `${DEFINER} no longer declares COLLECT_LANE_JOURNAL_BASENAME as one quoted literal`)
      .toMatch(/^[a-z][a-z0-9.-]*\.log$/);
    expect(ACT.test(`  rm -f "$HOME/.ccrc/${NAME}"`)).toBe(true);
    expect(ACT.test(`  printf '%s\\n' x >> "$HOME/.ccrc/${NAME}"`)).toBe(true);
    expect(ACT.test(`      echo "update: rollback:   (leave ~/.ccrc/${NAME} in place: no backup holds it"`)).toBe(false);
  });

  it('its holders are exactly ccd/ccrc', () => {
    expect(holdersOf(NAME), 'a line of shell outside ccd/ccrc names the journal, or ccd/ccrc no longer does').toEqual(['ccd/ccrc']);
  });

  it('every holder line is an echo or usage line, none a copy, move, removal or redirect aimed at it', () => {
    const lines = readFileSync(path.join(ccrcRoot, 'ccd/ccrc'), 'utf8').split('\n');
    const open = lines.indexOf('usage() {');
    const close = lines.indexOf('EOF', open);
    expect(open, 'ccd/ccrc has no usage() {').toBeGreaterThan(-1);
    expect(close, 'the usage heredoc has no closing EOF').toBeGreaterThan(open);
    const held = lines.flatMap((l, i) => (!isBashComment(l) && l.includes(NAME) ? [i] : []));
    expect(held.length, 'the two usage paragraphs and the downgrade echo: at least three lines').toBeGreaterThanOrEqual(3);
    const echoes = held.filter((i) => /^\s*echo "update: rollback: {3}\(leave ~\/\.ccrc\//.test(lines[i]!));
    expect(echoes, 'the downgrade report says it exactly once').toHaveLength(1);
    for (const i of held) {
      const l = lines[i]!;
      expect((i > open && i < close) || echoes.includes(i),
        `ccd/ccrc:${i + 1} names the journal outside the usage text and the downgrade echo: ${l.trim()}`).toBe(true);
      expect(l, `ccd/ccrc:${i + 1} acts on the journal`).not.toMatch(ACT);
    }
  });
});


// ── ccrc history W1-B2 Task 34: the hook spools exactly SPOOL_SOURCES on SessionStart (spec 2026-10-05 §5.1, S14;
// ruled Q16). APPENDED, with no import line, for the reason the blocks above state.
describe('ccrc history: the hook spools exactly SPOOL_SOURCES on SessionStart (spec 2026-10-05 §5.1, S14; W1-B2, ruled Q16)', () => {
  it('SPOOL_SOURCES is declared once, in lib.mjs, frozen and holding fork, and the spool block\'s one SessionStart arm spells exactly its members', async () => {
    const lib = (await import('../../../ccd/history/lib.mjs')) as unknown as Record<string, unknown>;
    const members = [...(lib['SPOOL_SOURCES'] as readonly string[])];
    expect(Object.isFrozen(lib['SPOOL_SOURCES'])).toBe(true);
    expect(members).toContain('fork');
    const declares = /(?:^|[\s;])(?:export\s+)?(?:const|let|var)\s+SPOOL_SOURCES\b/;
    expect(HISTORY_MJS.filter((f) => stallCode(f).split('\n').some((l) => declares.test(l))).map(rel)).toEqual(['ccd/history/lib.mjs']);
    const arms = codeLines(path.join(ccrcRoot, 'ccd', 'session-hook.sh'))
      .filter((l) => /^\s*SessionStart\)/.test(l) && l.includes('case "$src" in'));
    expect(arms, 'the spool block\'s SessionStart arm, and only it, cases on $src').toHaveLength(1);
    const m = /case "\$src" in ([a-z|]+)\)/.exec(arms[0]!);
    expect(m, 'the arm spells its sources as one alternation').not.toBeNull();
    expect(m![1]!.split('|').sort()).toEqual([...members].sort());
  });
});


// ── ARCH-45 C5f (D-7075; plan 2026-10-27-consolidation-w5-ccd-helpers.md, spec K2): ccd mints every token through one
// encoding, `_ws_reclaim_fingerprint`; `_ws_fingerprint` hands it the reap's fourteen `name=value` facts and pipes
// nothing itself. APPENDED, with no import line, for the reason the blocks above state. `tokenMinters()` counts the
// functions whose stdout is a `printf … | _plat_sha256 | cut` hash: 2 at the base, 1 here. May only shrink.
describe('ARCH-45 C5f: one token minter in ccd’s source, `_ws_reclaim_fingerprint` (D-7075; may only shrink)', () => {
  it('tokenMinters() is exactly ccd/ccd#_ws_reclaim_fingerprint', async () => {
    const census = await import('../census-w5/ccdHelpers.js');
    expect(census.tokenMinters().map((n) => `ccd/ccd#${n}`)).toEqual(['ccd/ccd#_ws_reclaim_fingerprint']);
  });
});

// ── ARCH-45 C5e (D-7072; plan 2026-10-27-consolidation-w5-ccd-helpers.md, spec K2): ccd's two byte-identical
// verdict-setting refusal helpers are one, `_ws_refuse`, and a call's family is the region it sits in. APPENDED, with no
// import line, for the reason the blocks above state. The definitions count (`refuseHelperDefs()` is exactly
// `ccd/ccd#_ws_refuse`) is `ccd-helpers-pin.test.ts`'s row; this one holds that neither old name comes back. May only shrink.
describe('ARCH-45 C5e: no `_reap_refuse` or `_ws_collect_refuse` definition or call stands in ccd’s source (D-7072; may only shrink)', () => {
  it('no definition and no call of either old name, in code or in a comment', async () => {
    const census = await import('../census-w5/ccdHelpers.js');
    const OLD = ['_reap_refuse', '_ws_collect_refuse'];
    const defs = census.refuseHelperDefs().filter((d) => OLD.includes(d.name)).map((d) => `definition ${d.name} (line ${d.line})`);
    const calls = census.refuseCalls().filter((c) => OLD.includes(c.name)).map((c) => `call at ${c.line}: ${c.text.trim()}`);
    expect([...defs, ...calls]).toEqual([]);
  });
});
