// The consolidation wave's census (D-5849; ARCH-40 (#775); spec 2026-10-19 §5.1 rule 3). Each named query in
// `consolidationCensus.ts` is held here two ways. Against a FIXTURE tree, so the query is shown to count what it
// claims and to pass over what it must not (a comment, an import, a bare word). Against the REAL tree, so it finds
// the one site the spec cites: a query that silently matched nothing would be red here, not quietly zero.
//
// A COUNT IS PINNED ONLY ONCE ITS SERIES REACHES ITS TARGET (spec §5.1 rule 3, rev 2): a census reports until then,
// and the may-only-shrink pin lands in the commit that reaches it. Each real-tree row prints its list instead, so a PR body
// can quote it, measured on the PR's tip.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  feedRecordCallSites, reclaimPauseParseSites, markerDefinitions, markerLiteralFiles, filesNaming,
  REPO, runCcdOldFoldSites, runCcdSiteArms, RAN_NARROW_WINDOW, RAN_TABLE, type CensusSite, type RanTableRow,
} from './consolidationCensus.js';
import { capabilityChoiceSites, W4_HELD_FILES } from './consolidationCensus.js';
import { changeLatchSites, changeLatchReported, onceWarnDefinitions } from './consolidationCensus.js';
import { registryListingSites } from './consolidationCensus.js';
import { dialogFrameProducers, sessionStreamPollSites } from './consolidationCensus.js';
import { cadenceLiterals, declaredDerivations, laneClockFields, laneClockReported, laneClockShapes, singleFlightGuards } from './consolidationCensus.js';
import {
  coordStoreQuestionShapedMethods, envelopePairingRules, envelopePairingTitleRules, NOT_QUESTION_STORE_METHODS, QUESTION_STORE_EXCLUDED,
  QUESTION_STORE_METHODS, QUESTION_STORE_OWNERS, questionDoorIns, questionDoors, questionHoldCarriers, questionPaneEdges,
  questionStoreCallsOutside, questionSweepEntries,
} from './consolidationCensus.js';

const show = (name: string, sites: readonly CensusSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.file}:${s.line}  ${s.text.trim()}`).join('\n')}`);
};
const files = (sites: readonly CensusSite[]): string[] => [...new Set(sites.map((s) => s.file))].sort();

// A neutral fixture tree, one file per shape the queries must tell apart.
let root = '';
const put = (rel: string, body: string): void => {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
};
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'consolidation-census-'));
  put('server/src/coord/store.ts', [
    'export class CoordStore {',
    '  recordFeedEvent(epoch: number, ev: FeedEvent): void {',
    '    this.recordFeedEvent(epoch, ev);',
    '  }',
    '}',
  ].join('\n'));
  put('server/src/lane.ts', [
    "import { RECLAIM_PAUSE_MARKER } from './coord/rundefs.js';",
    '/** Writes the row through `coord.recordFeedEvent(log.epoch, ev)`, as every lane does.',
    ' *  recordFeedEvent(epoch, ev) is the store\'s one archive door. */',
    '// recordFeedEvent(log.epoch, ev) is called below',
    'export function lane(deps: Deps, names: string[] | null): void {',
    '  deps.coord.recordFeedEvent(log.epoch, ev);',
    '  done(); // then recordFeedEvent(log.epoch, ev) is not called again',
    '  // names.includes(RECLAIM_PAUSE_MARKER) was the old read',
    '  if (names.includes(RECLAIM_PAUSE_MARKER) || other.includes(RECLAIM_PAUSE_MARKER)) return;',
    '  const why = `${RECLAIM_PAUSE_MARKER} is raised`;',
    "  const old = 'reclaim-paused';",
    '}',
  ].join('\n'));
  put('server/src/coord/rundefs.ts', [
    '/** `$REG/mail-disabled`: removable only by hand. */',
    "export const MAIL_DISABLED_MARKER = 'mail-disabled';",
    "export const RECLAIM_PAUSE_MARKER = 'reclaim-paused';",
    "// const OLD_MARKER = 'mail-disabled';",
    "export const LATER_WORD = 'mail-disabled-later';",
  ].join('\n'));
  put('server/src/watch.ts', [
    "const MAIL_DISABLED_MARKER = 'mail-disabled';",
    "const verdict = names.includes('mail-disabled') ? 'off' : 'on';",
    '/** Reads `reclaim-paused` from the listing. */',
  ].join('\n'));
  put('shared/api.ts', "export type Code = 'paused' | 'mail-disabled';\n");
  put('server/src/__mutant__.ts', 'deps.coord.recordFeedEvent(log.epoch, ev);\nnames.includes(RECLAIM_PAUSE_MARKER);\n');
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('feedRecordCallSites: recordFeedEvent( call expressions under server/src, outside coord/store.ts (D-5849)', () => {
  it('FIXTURE: a docstring mention is not a call site, nor a comment, nor the store\'s own definition or call', () => {
    const sites = feedRecordCallSites(root);
    expect(sites.map((s) => `${s.file}:${s.line}`)).toEqual(['server/src/lane.ts:6']);
    expect(sites[0]!.text).toContain('deps.coord.recordFeedEvent(log.epoch, ev);');
  });

  // D-5857 (Task C1c): pushOne's archive write moved into the funnel (`notice.ts` `notify`), so the real-tree anchor
  // follows it there; the row's other halves are unchanged. D-5860 (Task C1f): the write also passes the notice's
  // once-only key when it has one, so the anchor matches the call's first two arguments.
  it("REAL: it finds the funnel's archive write in notice.ts, and every site is a call", () => {
    const sites = feedRecordCallSites();
    show('feedRecordCallSites', sites);
    expect(sites.some((s) => s.file === 'server/src/notice.ts' && /\bdeps\.coord\.recordFeedEvent\(log\.epoch, ev[,)]/.test(s.text)),
      "the funnel's archive write is not among the sites").toBe(true);
    for (const s of sites) expect(s.text, `${s.file}:${s.line}`).toMatch(/\brecordFeedEvent\s*\(/);
    expect(files(sites)).not.toContain('server/src/coord/store.ts');
  });
});

describe('reclaimPauseParseSites: includes(RECLAIM_PAUSE_MARKER) expressions under server/src (D-5849)', () => {
  it('FIXTURE: an import, a comment, a template or a bare literal names the marker but is not a parse', () => {
    const sites = reclaimPauseParseSites(root);
    // Two expressions on one line are two sites; the commented-out read is none.
    expect(sites.map((s) => `${s.file}:${s.line}`)).toEqual(['server/src/lane.ts:9', 'server/src/lane.ts:9']);
    expect(filesNaming(['reclaim-paused', 'RECLAIM_PAUSE_MARKER'], root)).toEqual(
      ['server/src/coord/rundefs.ts', 'server/src/lane.ts', 'server/src/watch.ts']);
  });

  // D-5856: the real-tree anchor is the stop-done lane's read, the one parse W1a's C1b leaves (W4 moves it); C1b folds
  // childReclaim's, the anchor until then, onto `readSwitches`.
  it("REAL: it finds stopDoneSweep's read, and fewer files parse the marker than name it", () => {
    const sites = reclaimPauseParseSites();
    show('reclaimPauseParseSites', sites);
    expect(sites.some((s) => s.file === 'server/src/stopDoneSweep.ts'), "stopDoneSweep's read is not found").toBe(true);
    for (const s of sites) expect(s.text, `${s.file}:${s.line}`).toMatch(/\bincludes\(\s*RECLAIM_PAUSE_MARKER\s*\)/);
    const naming = filesNaming(['reclaim-paused', 'RECLAIM_PAUSE_MARKER']);
    console.log(`census files naming reclaim-paused: ${naming.length}\n  ${naming.join('\n  ')}`);
    // Every parse site's file names the marker; a query matching the bare word would make the two sets equal.
    for (const f of files(sites)) expect(naming).toContain(f);
    expect(files(sites).length).toBeLessThan(naming.length);
  });
});

describe('markerDefinitions(name): const definitions of a marker literal under server/src and shared (D-5849)', () => {
  it('FIXTURE: an exported and a private definition count; a comment, a longer literal and a use do not', () => {
    expect(markerDefinitions('mail-disabled', root).map((s) => `${s.file}:${s.line}`))
      .toEqual(['server/src/coord/rundefs.ts:2', 'server/src/watch.ts:1']);
  });

  it("REAL: mail-disabled is defined once, in its shared/switches.ts row (D-5855; 2 -> 1)", () => {
    const sites = markerDefinitions('mail-disabled');
    show('markerDefinitions(mail-disabled)', sites);
    expect(sites.map((s) => s.file)).toEqual(['shared/switches.ts']);
    expect(sites[0]?.text).toMatch(/^export const MAIL_DISABLED_MARKER\b/);
  });
});

describe('markerLiteralFiles: quoted marker-name literals on code lines under server/src (D-5849; recorded, gates nothing)', () => {
  it('FIXTURE: the vocabulary comes from the marker definitions, and only a quoted whole name on a code line counts', () => {
    const sites = markerLiteralFiles(root);
    expect(sites.map((s) => `${s.file}:${s.line}`)).toEqual([
      'server/src/coord/rundefs.ts:2', 'server/src/coord/rundefs.ts:3',
      'server/src/lane.ts:11',
      'server/src/watch.ts:1', 'server/src/watch.ts:2',
    ]);
  });

  it("REAL: the vocabulary survives the move to shared/switches.ts, and no server/src line defines a marker (D-5855)", () => {
    const sites = markerLiteralFiles();
    show('markerLiteralFiles', sites);
    console.log(`census files spelling a marker literal: ${files(sites).length}`);
    // dispatch.ts's refusal CODE spells 'mail-disabled': found only while the vocabulary is still read from shared/.
    expect(sites.some((s) => s.file === 'server/src/coord/dispatch.ts' && s.text.includes("'mail-disabled'"))).toBe(true);
    expect(sites.filter((s) => /\bconst\s+[A-Z0-9_]*_MARKER\b/.test(s.text)).map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });
});

describe('runCcdOldFoldSites: runCcd( call sites under server/src not yet narrowed on ran (D-6034; ARCH-10, #543)', () => {
  let tree = '';
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'ran-fold-census-'));
    mkdirSync(path.join(tree, 'server/src/coord'), { recursive: true });
    writeFileSync(path.join(tree, 'server/src/coord/lane.ts'), [
      '// const res = await deps.runCcd(argv); is how a lane calls it',       // 1: a comment
      'export async function oldFold(deps: Deps): Promise<boolean> {',
      '  const res = await deps.runCcd(argv);',                                 // 3: old fold
      '  return res.ok;',
      '}',
      '// the next declaration\'s narrowing names another `res`: it never counts for line 3',
      'export async function newFold(deps: Deps): Promise<Read> {',
      '  const res = await deps.runCcd(argv);',                                 // 8: new fold
      "  if (res.ran === false) return { kind: 'unreadable' };",
      '  return parse(res.ok, res.stdout);',
      '}',
      'const wrap = (deps: Deps): RunCcd => async (argv) => {',
      '  return await deps.runCcd(argv);',                                      // 13: a pass-through
      '};',
      'export interface Port { runCcd: (argv: CcdArgv) => Promise<CcdResult> }', // 15: a type
      'export async function tooFar(deps: Deps): Promise<boolean> {',
      '  const res = await deps.runCcd(argv);',                                 // 17: narrowed past the window
      ...Array.from({ length: RAN_NARROW_WINDOW }, () => '  step();'),
      '  if (res.ran === false) return false;',
      '  return res.ok;',
      '}',
    ].join('\n'));
  });
  afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE: a comment, a type, a pass-through and a narrowed call are not sites; an un-narrowed call is, and so is one narrowed past the window', () => {
    // [file, line] pairs, not `file:line` strings: the citations ratchet counts the latter (D-5893).
    expect(runCcdOldFoldSites(tree).map((s) => [s.file, s.line]))
      .toEqual([['server/src/coord/lane.ts', 3], ['server/src/coord/lane.ts', 17]]);
  });

  it('FIXTURE: a result handed to a carry reader is carried; a table row accounts for a site by file, text and nth', () => {
    const t2 = mkdtempSync(path.join(tmpdir(), 'ran-fold-census2-'));
    try {
      mkdirSync(path.join(t2, 'server/src'), { recursive: true });
      writeFileSync(path.join(t2, 'server/src/lane.ts'), [
        'export async function a(deps: Deps) {',
        '  const res = await deps.runCcd(argv);',                         // 2: carried
        '  return cutShort(res);',
        '}',
        'export async function b(deps: Deps) {',
        '  const r = await queue.run(id, () => deps.runCcd(argv));',      // 6: nth 1
        '  return r.ok;',
        '}',
        'export async function c(deps: Deps) {',
        '  const r = await queue.run(id, () => deps.runCcd(argv));',      // 10: nth 2
        '  return r.ok;',
        '}',
        'export interface P { runCcd(argv: CcdArgv): Promise<CcdResult>; }', // 13: a signature
      ].join('\n'));
      const row = (nth: number): RanTableRow => ({ file: 'server/src/lane.ts', text: 'const r = await queue.run(id, () => deps.runCcd(argv));', nth, arm: 'ok-only' });
      expect(runCcdSiteArms(t2, []).map((x) => [x.line, x.arm])).toEqual([[2, 'carried'], [6, null], [10, null]]);
      expect(runCcdSiteArms(t2, [row(2)]).map((x) => [x.line, x.arm])).toEqual([[2, 'carried'], [6, null], [10, 'ok-only']]);
    } finally { rmSync(t2, { recursive: true, force: true }); }
  });

  it('REAL: every runCcd( site answers the not-ran arm, and the count stays at 0 (D-6840; ARCH-10, #543)', () => {
    const sites = runCcdSiteArms();
    show('runCcdSiteArms', sites);
    // A query that silently matched nothing would read as "every site is accounted": the swap route is a known site.
    expect(sites.some((x) => x.file === 'server/src/server.ts'), 'no server.ts site found').toBe(true);
    for (const x of sites) expect(x.text, `${x.file}:${x.line}`).toMatch(/\brunCcd\s*\(/);
    // This is the may-only-shrink pin at its floor: a new `runCcd(` site must narrow on `ran === false`, hand its
    // result to a `RAN_CARRY_READERS` reader, or add a reviewed row to `RAN_TABLE`.
    expect(runCcdOldFoldSites().map((x) => `${x.file}:${x.line}`)).toEqual([]);
  });

  it('REAL: every RAN_TABLE row names a site that exists and that nothing else already accounts for', () => {
    const bare = runCcdSiteArms(REPO, []);
    const keyed = (r: RanTableRow): boolean => {
      const seen = new Map<string, number>();
      for (const x of bare) {
        const k = `${x.file}\n${x.text.trim()}`;
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        if (x.file === r.file && x.text.trim() === r.text && n === r.nth) return x.arm === null;
      }
      return false;
    };
    expect(RAN_TABLE.filter((r) => !keyed(r)).map((r) => `${r.file}: ${r.text}`)).toEqual([]);
  });
});

// D-5866 (Task C1k; ARCH-71 #806). The capability census: every verb, flag and precondition question, tagged from
// `CCD_CAN`, never from a list.
describe('capabilityChoiceSites: verbSupported(, capSupported( and ccdCan( calls under server/src, tagged (D-5866)', () => {
  let tree = '';
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-caps-'));
    const at = (rel: string, body: string): void => {
      const p = path.join(tree, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    };
    at('server/src/ccdargv.ts', 'export function ccdCan(state, row) { return capSupported(state, row); }\n');
    at('server/src/lane.ts', [
      'export function lane(s: S, argv: A, ask: Q): void {',
      "  if (!ccdCan(s, 'wsArchive')) return;",                                    // 2: verb
      '  if (!verbSupported(s, argv)) return;',                                     // 3: verb
      '  if (!capSupported(s, EXPIRE_CAP)) return;',                                // 4: verb (a row's token)
      "  if (!ccdCan(s, 'wsCollect') || !capSupported(s, RECLAIM_PAUSE_CAP)) return;", // 5: verb, verb-precondition
      '  if (!capSupported(s, RECLAIM_PAUSE_CAP)) return;',                         // 6: verb (its own route)
      '  const f = capSupported(s, POOLS_CAP);',                                    // 7: flag
      '  if (!capSupported(s, ask.cap)) return;',                                   // 8: flag, unresolved
      "  const g = capSupported(s, 'stop-surface');",                               // 9: flag, a literal
      '  // capSupported(s, EXPIRE_CAP) named in a comment',                        // 10: prose
      '  const m = { verbSupported: true };',                                       // 11: a key, not a call
      '}',
    ].join('\n'));
    at('server/src/hibernateSweep.ts', 'export const p = (a: A) => verbSupported(a.fleetState, argv);\n');
  });
  afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE: each form and tag, and never a comment, a key or the defining file', async () => {
    expect((await capabilityChoiceSites(tree)).map((x) => [x.file.replace('server/src/', ''), x.line, x.form, x.token, x.tag]))
      .toEqual([
        ['hibernateSweep.ts', 1, 'verbSupported', null, 'w4-held'],
        ['lane.ts', 2, 'ccdCan', null, 'verb'],
        ['lane.ts', 3, 'verbSupported', null, 'verb'],
        ['lane.ts', 4, 'capSupported', 'expire-v1', 'verb'],
        ['lane.ts', 5, 'ccdCan', null, 'verb'],
        ['lane.ts', 5, 'capSupported', 'reclaim-pause-v1', 'verb-precondition'],
        ['lane.ts', 6, 'capSupported', 'reclaim-pause-v1', 'verb'],
        ['lane.ts', 7, 'capSupported', 'pools-v1', 'flag'],
        ['lane.ts', 8, 'capSupported', null, 'flag'],
        ['lane.ts', 9, 'capSupported', 'stop-surface', 'flag'],
      ]);
  });

  it('REAL: every tag is seen, and the W4 files hold the only verbSupported( calls outside the deferred watch.ts', async () => {
    const sites = await capabilityChoiceSites();
    for (const tag of ['verb', 'verb-precondition', 'flag', 'w4-held'] as const) {
      show(`capabilityChoiceSites ${tag}`, sites.filter((x) => x.tag === tag));
      expect(sites.some((x) => x.tag === tag), `no ${tag} site found`).toBe(true);
    }
    expect(sites.filter((x) => x.tag === 'w4-held').every((x) => W4_HELD_FILES.includes(x.file))).toBe(true);
    expect(sites.some((x) => x.form === 'ccdCan'), 'no ccdCan( site found').toBe(true);
  });
});

// D-5861 (Task C1g; ARCH-76 #811). The change-latch census: a `last*` field of a class compared with a key before a
// `console.warn` and assigned in the same method.
describe('changeLatchSites: FleetWatcher\'s hand-rolled "warn once until it changes" latches (D-5861)', () => {
  let tree = '';
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-latch-'));
    const p = path.join(tree, 'server/src/watch.ts');
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, [
      'export class FleetWatcher {',
      '  private lastWhy: string | null = null;',
      '  private readonly lastByProject = new Map<string, string>();',
      '  a(key: string): void {',
      '    if (key !== this.lastWhy) {',                                           // 5: a latch
      '      console.warn(`why ${key}`);',
      '    }',
      '    this.lastWhy = key;',
      '  }',
      '  b(project: string, json: string): void {',
      '    if (json !== this.lastByProject.get(project)) {',                       // 11: a keyed latch
      '      this.lastByProject.set(project, json);',
      '      console.warn(`p ${project}`);',
      '    }',
      '  }',
      '  c(now: number): void {',
      '    if (this.lastSweep !== 0 && now - this.lastSweep < 5) return;',          // 17: a throttle, a literal operand
      '    this.lastSweep = now;',
      '    console.warn("swept");',
      '  }',
      '  d(hour: number): void {',
      '    if (hour === this.lastHour) return;',                                    // 22: an hourly retry beside a catch
      '    this.lastHour = hour;',
      '    try { run(); } catch (e) { console.warn("failed"); }',
      '  }',
      '  e(key: string): void {',
      '    // key !== this.lastNote is named in a comment',
      '    this.lastNote = key;',
      '    console.warn("e");',
      '  }',
      '}',
      'class DelegationLane {',
      '  private lastMarkHour = -1;',
      '  m(hour: number): void {',
      '    if (hour === this.lastMarkHour) return;',                                // 35: a check-and-set, reported
      '    this.lastMarkHour = hour;',
      '    console.warn("marks");',
      '  }',
      '}',
    ].join('\n'));
  });
  afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE: a key against a field, plain or keyed, and never a throttle, a catch-line retry, a comment or another class', () => {
    expect(changeLatchSites(tree).map((x) => x.line)).toEqual([5, 11]);
    expect(changeLatchReported(tree).map((x) => x.line)).toEqual([35]);
  });

  it('REAL: `DelegationLane#lastMarkWarnHour` is reported, not counted', () => {
    const reported = changeLatchReported();
    show('changeLatchReported', reported);
    expect(reported.map((x) => x.text.trim()).join('\n')).toContain('lastMarkWarnHour');
    expect(changeLatchSites().map((x) => x.text.trim()).join('\n'), 'a DelegationLane latch was counted').not.toContain('lastMarkWarnHour');
  });
});

// D-5867 (Task C1l; ARCH-66 (#801)). The redaction census: the JS/TS modules that spell redaction rule patterns of their
// own. A table is a file whose code lines hold a mask word and two of the three shapes (Bearer, Authorization, token=).
describe('redactRuleTables: modules that spell redaction rule patterns of their own (D-5867)', () => {
  let tree = '';
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-redact-'));
    const at = (rel: string, body: string): void => {
      const p = path.join(tree, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    };
    at('shared/one.mjs', "const B = /\\b(Bearer)\\s+x/g; const A = /Authorization:/; const R = '[REDACTED]';\n");
    at('server/src/two.ts', "const H = /Authorization/; const Q = /[?&](?:access_token|token)=/; const M = '***';\n");
    at('ccd/history/three.mjs', "const REDACTED_MARK = '[redacted]'; const T = /token=/; const B = /Bearer /;\n");
    at('server/src/prose.ts', "// Bearer and Authorization and token= named in a comment\nconst M = '[REDACTED]';\n");
    at('server/src/one-shape.ts', "const B = /Bearer /; const M = '[REDACTED]';\n");
    at('server/src/no-mask.ts', 'const B = /Bearer /; const A = /Authorization/;\n');
    at('server/src/decl.d.mts', "const B = /Bearer /; const A = /Authorization/; const M = '[REDACTED]';\n");
  });
  afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE: a mask word and two shapes make a table; a comment, one shape, no mask and a declaration file do not', async () => {
    const { redactRuleTables } = await import('./consolidationCensus.js');
    expect(redactRuleTables(tree)).toEqual(['ccd/history/three.mjs', 'server/src/two.ts', 'shared/one.mjs']);
  });

  it('REAL: finds shared/redact.mjs and the history redactor, and no TypeScript table', async () => {
    const { redactRuleTables } = await import('./consolidationCensus.js');
    const tables = redactRuleTables();
    console.log(`census redactRuleTables: ${tables.length}\n${tables.map((t) => `  ${t}`).join('\n')}`);
    expect(tables).toContain('shared/redact.mjs');
    expect(tables).toContain('ccd/history/lib.mjs');
    expect(tables.filter((t) => /\.tsx?$/.test(t))).toEqual([]);
  });
});

// D-5862 (Task C1h; ARCH-68 #803). The lane-schedule census: the named clocks and guards a lane keeps as fields of the
// watcher, the structural query for a clock nobody named, the bare cadence literal, and the three derivations.
describe('the lane schedule census (D-5862)', () => {
  let tree = '';
  beforeAll(() => {
    tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-lanes-'));
    const p = path.join(tree, 'server/src/watch.ts');
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, [
      'export class FleetWatcher {',
      '  private lastTaskSweep = 0;',                                              // 2: a named clock
      '  private lastNewSweep = 0;',                                               // 3: an unnamed clock
      '  private lastQuiet: number | null = null;',                                // 4: an unnamed nullable clock
      '  private lastJson: string | null = null;',                                 // 5: not numeric
      '  private lastStallJudgedAt: number | null = null;',                         // 6: exempt gap rule
      '  private collectSweeping = false;',                                        // 7: a named guard
      '  private ticking = false;',                                                 // 8: a named guard
      '  a(now: number): void {',
      '    if (now - this.lastNewSweep < SWEEP_MS) return;',                       // 10: a shape
      '    if (this.lastQuiet !== null && Date.now() - this.lastQuiet >= 5000) return;', // 11: a shape and a literal
      '    if (now - this.lastTaskSweep >= 86_400_000) return;',                   // 12: a shape and a literal
      '    if (now - this.lastQuiet > 60 * 1000) return;',                         // 13: a shape and a product literal
      '    if (now - this.lastStallJudgedAt > GAP_MS) return;',                    // 14: exempt
      '    if (now - this.lastQuiet < 500) return;',                               // 15: a shape, under 1000: not a cadence literal
      '    if (SWEEP_MS > now - this.lastNewSweep) return;',                       // 16: a shape, written the other way round
      '    if (now - other.lastQuiet < SWEEP_MS) return;',                         // 17: another object: not seen
      '  }',
      '}',
      'class DelegationLane {',
      '  private lastSweepAt = 0;',                                                 // 21: reported, not counted
      '  m(now: number): void { if (now - this.lastSweepAt < SWEEP_MS) return; }',
      '}',
      'export const DELEGATION_SWEEP_MS = DIVERGENCE_SWEEP_MS;',
    ].join('\n'));
    writeFileSync(path.join(tree, 'server/src/laneSchedule.ts'), [
      'export const STALL_SWEEP_MS = 60_000;',
      'export const COLLECT_OBSERVE_INTERVAL_MS = CHILD_RECLAIM_SWEEP_MS;',
    ].join('\n'));
  });
  afterAll(() => { if (tree) rmSync(tree, { recursive: true, force: true }); });

  it('FIXTURE: a named clock and a named guard are found by name', async () => {
    expect(laneClockFields(tree).map((x) => x.line)).toEqual([2]);
    expect(singleFlightGuards(tree).map((x) => x.line)).toEqual([7, 8]);
    expect(laneClockReported(tree).map((x) => x.line)).toEqual([21]);
  });

  it('FIXTURE: the structural query finds an unnamed clock compared with a constant, the exempt gap rule and another object aside', async () => {
    expect(laneClockShapes(tree).map((x) => x.line)).toEqual([10, 11, 12, 13, 15, 16]);
  });

  it('FIXTURE: a bare millisecond literal (1000 or more, a product of literals too) against a last* clock; a constant, a small number and a second object are not', async () => {
    expect(cadenceLiterals(tree).map((x) => x.line)).toEqual([11, 12, 13]);
  });

  it('FIXTURE: a derivation is a reference only when its initializer is a bare name', async () => {
    expect(declaredDerivations(tree)).toEqual([
      { name: 'COLLECT_OBSERVE_INTERVAL_MS', file: 'server/src/laneSchedule.ts', reference: true },
      { name: 'STALL_SWEEP_MS', file: 'server/src/laneSchedule.ts', reference: false },
      { name: 'DELEGATION_SWEEP_MS', file: 'server/src/watch.ts', reference: true },
    ]);
  });

  it('REAL: the census runs on the tree, and W4\'s two clocks are the ones left (the delegation lane\'s is a row since D-5862)', async () => {
    const fields = laneClockFields();
    show('laneClockFields', fields);
    expect(fields.map((x) => x.text).join('\n')).toContain('lastStopDoneSweep');
    expect(laneClockReported(), 'DelegationLane#lastSweepAt is the `delegation` row of LANE_SCHEDULE').toEqual([]);
    expect(declaredDerivations()).toHaveLength(3);
  });
});

describe('registryListingSites: where watch.ts lists the registry, tagged selection, act or tests-only (D-5864)', () => {
  const fixture = [
    'class FleetWatcher {',
    '  async tick(): Promise<void> {',
    '    // readRegistryMeasured( named in a comment is not a call',
    '    const a = await readRegistryMeasured(this.deps.io, this.deps.cfg);',
    '    const again = await this.deps.io.readdir(this.deps.cfg.registryDir);',
    '  }',
    '  private async lanePass(): Promise<void> {',
    '    const r = await readRegistry(this.deps.io, this.deps.cfg);',
    '  }',
    '  private async divergencesPass(): Promise<void> {',
    '    const n = await this.deps.io.readdir(this.deps.cfg.registryDir);',
    '    const other = await this.deps.io.readdir(this.deps.cfg.projectsRoot);',
    '  }',
    '  private async fleetFor(): Promise<void> {',
    '    const f = await readRegistryMeasured(this.deps.io, this.deps.cfg);',
    '  }',
    '}',
  ].join('\n');

  it('FIXTURE: a call in tick or in a lane is selection, a bare readdir in tick and a named act read are act, a named fallback is tests-only, a comment and another directory are nothing', () => {
    const tree = mkdtempSync(path.join(tmpdir(), 'listing-census-'));
    try {
      mkdirSync(path.join(tree, 'server/src'), { recursive: true });
      writeFileSync(path.join(tree, 'server/src/watch.ts'), fixture);
      expect(registryListingSites(tree).map((s) => `${s.line} ${s.method} ${s.tag}`)).toEqual([
        '4 FleetWatcher.tick selection',
        '5 FleetWatcher.tick act',
        '8 FleetWatcher.lanePass selection',
        '11 FleetWatcher.divergencesPass act',
        '15 FleetWatcher.fleetFor tests-only',
      ]);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('REAL TREE: finds the tick\'s listing, and prints the list for the PR body', () => {
    const sites = registryListingSites();
    console.log(`census registryListingSites: ${sites.length}\n${sites.map((s) => `  ${s.line} ${s.method} ${s.tag}  ${s.text.trim()}`).join('\n')}`);
    expect(sites.filter((s) => s.method === 'FleetWatcher.tick').length, 'the tick lists the registry').toBeGreaterThan(0);
  });
});

// ARCH-52 (#787; spec §5.5 exit): ARCH-52's pin: both series reached their target, so the counts are held there
// (D-6977), against a fixture first and the real tree second.
describe('ARCH-52: SessionStream polls and dialog frame producers', () => {
  const stream = [
    "import { readTasks } from './tasks/read.js';",
    '// await readTasks(io, cfgDir, uuid) named in a comment is not a call',
    'class SessionStream {',
    '  async tick() {',
    '    const pane = await this.deps.tmux.capture(this.id);',
    '    const d = parseDialog(pane);',
    '    const t = await readTasks(io, cfgDir, uuid);',
    '    const h = await readHookStateRawMeasured(io, dir, id, uuid);',
    '    const m = this.deps.coord.outstandingMailFor(this.id, 500);',
    '  }',
    '}',
  ].join('\n');

  it('FIXTURE: the pane, plan, hookstate and mail reads in sessionws.ts are polls; an import, a comment and another file are not', () => {
    const tree = mkdtempSync(path.join(tmpdir(), 'arch52-census-'));
    try {
      mkdirSync(path.join(tree, 'server/src'), { recursive: true });
      writeFileSync(path.join(tree, 'server/src/sessionws.ts'), stream);
      writeFileSync(path.join(tree, 'server/src/sessionFeed.ts'), stream);
      expect(sessionStreamPollSites(tree).map((s) => s.line)).toEqual([5, 6, 7, 8, 9]);
      expect(new Set(sessionStreamPollSites(tree).map((s) => s.file))).toEqual(new Set(['server/src/sessionws.ts']));
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('FIXTURE: a dialog frame producer is one site per file, a comment and a comparison are nothing', () => {
    const tree = mkdtempSync(path.join(tmpdir(), 'arch52-census-'));
    try {
      mkdirSync(path.join(tree, 'server/src'), { recursive: true });
      writeFileSync(path.join(tree, 'server/src/a.ts'), "bus.emit('session:x', { type: 'dialog', dialog });\nsend({ type: 'dialog_cleared' });\n");
      writeFileSync(path.join(tree, 'server/src/b.ts'), "// { type: 'dialog' } in prose\nif (m.type === 'dialog') return;\n");
      expect(dialogFrameProducers(tree).map((s) => ({ file: s.file, line: s.line }))).toEqual([{ file: 'server/src/a.ts', line: 1 }]);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('REAL TREE: SessionStream polls 4 -> 0, and dialog frame producers 2 -> 1 (sessionws.ts alone)', () => {
    const polls = sessionStreamPollSites();
    const producers = dialogFrameProducers();
    show('sessionStreamPollSites', polls);
    show('dialogFrameProducers', producers);
    expect(polls, 'a SessionStream read comes from its session\'s feed (sessionFeed.ts), never from a poll of its own').toEqual([]);
    expect(producers.map((s) => s.file), 'every dialog frame is built by the stream\'s one gate').toEqual(['server/src/sessionws.ts']);
  });
});

// ARCH-76 (#811) follow-up (D-6991). The once-warn census: a `warn…Once` helper defined outside
// `server/src/changeLatch.ts`. The ratchet in `single-definition/advance-switches.test.ts` holds it to `ONCE_WARN_ALLOWED`.
describe('onceWarnDefinitions: `warn…Once` helpers defined outside changeLatch.ts (D-6991)', () => {
  it('FIXTURE: a function, a const and a let are definitions; a call, an import, a comment and changeLatch.ts are not', () => {
    const tree = mkdtempSync(path.join(tmpdir(), 'consolidation-census-oncewarn-'));
    try {
      const at = (rel: string, body: string): void => {
        const p = path.join(tree, rel);
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, body);
      };
      at('server/src/a.ts', [
        'const warnOnce = (k: string): void => {};',          // 1: a definition
        'warnOnce("x");',                                      // 2: a call
        '// const warnOnce = 1;',                              // 3: a comment
        'export function warnDiskOnce(k: string): void {}',    // 4: a definition
      ].join('\n'));
      at('server/src/b.ts', ['import { warnOnce } from "./a.js";', 'let warnReadOnce = () => {};'].join('\n'));   // 2
      at('shared/c.ts', 'function warnOnce(): void {}');                                                           // 1
      at('server/src/changeLatch.ts', 'const warnOnce = 1;');
      expect(onceWarnDefinitions(tree).map((s) => [s.file, s.line])).toEqual([
        ['server/src/a.ts', 1], ['server/src/a.ts', 4], ['server/src/b.ts', 2], ['shared/c.ts', 1],
      ]);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('REAL: finds tmpSweepLane.ts\'s helper, and prints the list for the PR body', () => {
    const sites = onceWarnDefinitions();
    show('onceWarnDefinitions', sites);
    expect(files(sites)).toContain('server/src/tmpSweepLane.ts');
  });
});

// W3, operator questions (slug question-census; Task Q3a; plan 2026-10-26-consolidation-w3-questions.md). Every query
// REPORTS: the base counts below are what the PR body prints, and each may-only-shrink pin lands later, in the commit
// that reaches its wave target (Q3c to Q3f). The REAL rows hold what is true at every step of the series (every door
// tagged, every counted store call owned, the closed method list against the class), never a count.
describe('W3 question census (slug question-census)', () => {
  const tree = (files: Record<string, string>): string => {
    const t = mkdtempSync(path.join(tmpdir(), 'w3-census-'));
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(t, rel);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    return t;
  };
  const watch = [
    'export class FleetWatcher {',
    '  private dialogIds = new Map<string, string>();',
    '  private heldAsks = new Map<string, number>();',
    '  private heldApprovals = new Map<string, number>();',
    '  private otherMap = new Map<string, number>();',
    '  async tick(): Promise<void> {',
    '    void this.sweepAsks().catch(() => {});',
    '    void this.sweepOther();',
    '    this.helper();',
    '  }',
    '  async sweepAsks(): Promise<void> { await this.runLane(() => this.askPass()); }',
    '  private async askPass(): Promise<void> { this.deps.coord.releaseAsk(1, 2); }',
    '  async sweepApprovals(): Promise<void> { this.deps.coord.lapseApproval(1); }',
    '  async sweepOther(): Promise<void> { this.deps.coord.askById(1); }',
    '  helper(): void {}',
    '  releaseHeldAsk(id: string): void { this.heldAsks.delete(id); }',
    '  private settle(id: string): void { this.heldApprovals.delete(id); }',
    '  notCalled(id: string): void { this.heldAsks.delete(id); }',
    '}',
  ].join('\n');
  const routes = [
    'export function registerCoordRoutes(app: App, deps: Deps): void {',
    '  const approvalInputs = new Map<number, string>();',
    "  app.post('/api/asks/:id/answer', async () => { deps.coord.askById(1); deps.watcher?.releaseHeldAsk('x'); });",
    "  app.post('/api/approvals', async () => { deps.coord.insertApproval(1); });",
    "  app.get('/api/approvals/:id/ruling', async () => { deps.coord.approvalById(1); });",
    "  app.post('/api/asks/:id/shout', async () => {});",
    "  app.post('/api/runs/:id/close', async () => {});",
    '}',
  ].join('\n');
  const server = [
    'export function buildServer(): void {',
    "  app.post('/api/sessions/:id/dialog/tab', async () => {});",
    "  app.post('/api/sessions/:id/release', async () => {});",
    "  app.post('/api/sessions/:id/ask', async () => { coord.heldAskFor('x'); });",
    '}',
  ].join('\n');

  it('FIXTURE: carriers by name and by closure owner; pane edges by name; another field is neither', () => {
    const t = tree({ 'server/src/watch.ts': watch, 'server/src/coord/routes.ts': routes });
    try {
      expect(questionHoldCarriers(t).map((s) => [s.name, s.owner, s.line])).toEqual([
        ['heldAsks', 'FleetWatcher', 3], ['heldApprovals', 'FleetWatcher', 4], ['approvalInputs', 'registerCoordRoutes', 2],
      ]);
      expect(questionPaneEdges(t).map((s) => s.line)).toEqual([2]);
      // A carrier name bound at module scope in the new module is reported as such, never hidden.
      const m = tree({ 'server/src/coord/questions.ts': 'const heldAsks = new Map();\nexport function createQuestions() { const approvalInputs = new Map(); }\n' });
      try {
        expect(questionHoldCarriers(m).map((s) => [s.name, s.owner])).toEqual([['heldAsks', 'module scope'], ['approvalInputs', 'createQuestions']]);
      } finally { rmSync(m, { recursive: true, force: true }); }
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: a sweep entry is a method tick calls that reaches a lapse, release or prune; a public half tick does not call is not one', () => {
    const t = tree({ 'server/src/watch.ts': watch });
    try {
      // `sweepAsks` reaches `releaseAsk` through `askPass` inside an arrow; `sweepOther` reads only; `sweepApprovals` is not called by tick.
      expect(questionSweepEntries(t).map((s) => [s.method, s.line])).toEqual([['sweepAsks', 7]]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: doors by shape and tag; a door-shaped path with no tag is `untagged`; the raise and a session release are not doors', () => {
    const t = tree({ 'server/src/coord/routes.ts': routes, 'server/src/server.ts': server });
    try {
      expect(questionDoors(t).map((s) => [s.route, s.tag])).toEqual([
        ['POST /api/asks/:id/answer', 'claimant'], ['POST /api/asks/:id/shout', 'untagged'],
        ['POST /api/sessions/:id/dialog/tab', 'navigation'], ['POST /api/sessions/:id/ask', 'operator'],
      ]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: a door-in is a public watcher method touching a carrier that a route calls; private and uncalled ones are not', () => {
    const t = tree({ 'server/src/watch.ts': watch, 'server/src/coord/routes.ts': routes });
    try {
      expect(questionDoorIns(t).map((s) => [s.method, s.callers])).toEqual([['releaseHeldAsk', ['POST /api/asks/:id/answer']]]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: store calls outside the store, by route or symbol; `this.` calls, the store and the module are not; the ruling read is excluded by name', () => {
    const t = tree({
      'server/src/watch.ts': watch, 'server/src/coord/routes.ts': routes, 'server/src/server.ts': server,
      'server/src/coord/store.ts': 'export class CoordStore { askById(id: number) { return this.readAsk(id); } x() { this.askById(1); } }',
      'server/src/coord/questions.ts': 'export function createQuestions(coord: CoordStore) { coord.askById(1); }',
      'server/src/coord/digest.ts': '// coord.digestAsks(1) in prose\nexport function buildDigest(store: CoordStore) { return store.digestAsks(1, 2); }',
    });
    try {
      expect(questionStoreCallsOutside(t).map((s) => [s.file, s.symbol, s.method, s.excluded])).toEqual([
        ['server/src/coord/digest.ts', 'buildDigest', 'digestAsks', false],
        ['server/src/coord/routes.ts', 'POST /api/asks/:id/answer', 'askById', false],
        ['server/src/coord/routes.ts', 'POST /api/approvals', 'insertApproval', false],
        ['server/src/coord/routes.ts', 'GET /api/approvals/:id/ruling', 'approvalById', true],
        ['server/src/server.ts', 'POST /api/sessions/:id/ask', 'heldAskFor', false],
        ['server/src/watch.ts', 'FleetWatcher.askPass', 'releaseAsk', false],
        ['server/src/watch.ts', 'FleetWatcher.sweepApprovals', 'lapseApproval', false],
        ['server/src/watch.ts', 'FleetWatcher.sweepOther', 'askById', false],
      ]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: pairing rules are definitions per side; an import, a re-export, a call and a comment are not', () => {
    const t = tree({
      'server/src/transcript/ask.ts': 'export const pairMatches = (a: string, b: string): boolean => a === b;\n// const pairMatches = 1;\n',
      'server/src/inject/ask.ts': "import { pairMatches } from '../transcript/ask.js';\npairMatches('a', 'b');\nexport { pairMatches } from '../transcript/ask.js';\n",
      'pwa/src/session/askLive.ts': 'const prefixMatches = (a: string, b: string): boolean => true;\nconst WRAP_BAR_RE = /x/;\nexport function titleMatches(q: string, t: string): boolean { return true; }\n',
    });
    try {
      expect(envelopePairingRules(t).map((s) => [s.side, s.name, s.file])).toEqual([
        ['server', 'pairMatches', 'server/src/transcript/ask.ts'], ['pwa', 'prefixMatches', 'pwa/src/session/askLive.ts'],
      ]);
      expect(envelopePairingTitleRules(t).map((s) => [s.side, s.name])).toEqual([['pwa', 'WRAP_BAR_RE'], ['pwa', 'titleMatches']]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('REAL: the closed store-method list partitions the class\'s question-shaped public methods with the not-a-question list', () => {
    const listed = [...QUESTION_STORE_METHODS, ...Object.keys(NOT_QUESTION_STORE_METHODS)].sort();
    expect(QUESTION_STORE_METHODS).toHaveLength(32);
    expect(new Set(listed).size, 'no method is on both lists').toBe(listed.length);
    expect(coordStoreQuestionShapedMethods(), 'a CoordStore question method missing from QUESTION_STORE_METHODS').toEqual(listed);
  });

  it('REAL: every carrier, pane edge, sweep entry, door and door-in the census finds, printed for the PR body', () => {
    const carriers = questionHoldCarriers();
    const doors = questionDoors();
    const doorIns = questionDoorIns();
    show('questionHoldCarriers', carriers);
    show('questionPaneEdges', questionPaneEdges());
    show('questionSweepEntries', questionSweepEntries());
    show('questionDoors', doors);
    show('questionDoorIns', doorIns);
    expect(carriers.filter((s) => s.owner === 'module scope'), 'question state is never module scope').toEqual([]);
    expect(carriers.map((s) => s.name), 'the closure carrier is found').toContain('approvalInputs');
    expect(doors.filter((s) => s.tag === 'untagged').map((s) => s.route), 'a door-shaped POST with no principal').toEqual([]);
    expect(doors.map((s) => s.route), 'the cited door is found').toContain('POST /api/approvals/:id/rule');
    for (const d of doorIns) expect(d.callers.length, `${d.method} has a route caller`).toBeGreaterThan(0);
  });

  it('REAL: every counted question-store call has an owning task; the excluded one is named; printed for the PR body', () => {
    const calls = questionStoreCallsOutside();
    console.log(`census questionStoreCallsOutside: ${calls.length} (${calls.filter((c) => c.excluded).length} excluded by name)\n${calls
      .map((c) => `  ${c.file} | ${c.symbol} | ${c.method}${c.excluded ? '  [excludedByName]' : ''}`).join('\n')}`);
    const unowned = calls.filter((c) => !c.excluded && QUESTION_STORE_OWNERS[`${c.file} | ${c.symbol}`] === undefined);
    expect(unowned.map((c) => `${c.file} | ${c.symbol} | ${c.method}`), 'a question-store call no W3 task moves').toEqual([]);
    expect(calls.filter((c) => c.excluded).map((c) => `${c.file} | ${c.symbol} | ${c.method}`))
      .toEqual(QUESTION_STORE_EXCLUDED.map((x) => `${x.file} | ${x.symbol} | ${x.method}`));
  });

  it('REAL: the pairing rule\'s definitions, one server and one PWA at most, printed for the PR body', () => {
    const rules = envelopePairingRules();
    show('envelopePairingRules', rules);
    show('envelopePairingTitleRules', envelopePairingTitleRules());
    expect(rules.filter((s) => s.side === 'server').length, 'the server keeps one normalize-and-prefix definition').toBe(1);
    expect(rules.filter((s) => s.side === 'pwa').length).toBeLessThanOrEqual(1);
  });
});
