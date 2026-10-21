// The consolidation wave's census (D-5849; ARCH-40 (#775); spec 2026-10-19 §5.1 rule 3). Each named query in
// `consolidationCensus.ts` is held here two ways. Against a FIXTURE tree, so the query is shown to count what it
// claims and to pass over what it must not (a comment, an import, a bare word). Against the REAL tree, so it finds
// the one site the spec cites: a query that silently matched nothing would be red here, not quietly zero.
//
// NO COUNT IS PINNED (spec §5.1 rule 3, rev 2): a census reports until its series reaches its target, and the
// may-only-shrink pin lands in the commit that reaches it. Each real-tree row prints its list instead, so a PR body
// can quote it, measured on the PR's tip.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  feedRecordCallSites, reclaimPauseParseSites, markerDefinitions, markerLiteralFiles, filesNaming,
  runCcdOldFoldSites, RAN_NARROW_WINDOW, type CensusSite,
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
  // follows it there; the row's other halves are unchanged.
  it("REAL: it finds the funnel's archive write in notice.ts, and every site is a call", () => {
    const sites = feedRecordCallSites();
    show('feedRecordCallSites', sites);
    expect(sites.some((s) => s.file === 'server/src/notice.ts' && /\bdeps\.coord\.recordFeedEvent\(log\.epoch, ev\)/.test(s.text)),
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

  it('REAL: the four sites step 1 migrated are off the old fold, and the rest still on it are listed for step 2', () => {
    const sites = runCcdOldFoldSites();
    show('runCcdOldFoldSites', sites);
    const migrated = ['server/src/coord/expireArchived.ts', 'server/src/coord/collectTempRoot.ts'];
    for (const f of migrated) expect(files(sites), `${f} is still on the old fold`).not.toContain(f);
    // A query that silently matched nothing would read as "step 2 is done": the swap route is a known old-fold site.
    expect(sites.some((s) => s.file === 'server/src/server.ts'), 'no server.ts site found').toBe(true);
    for (const s of sites) expect(s.text, `${s.file}:${s.line}`).toMatch(/\brunCcd\s*\(/);
  });
});
