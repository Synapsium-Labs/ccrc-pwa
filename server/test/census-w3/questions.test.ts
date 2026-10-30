// W3's question census, held two ways (`consolidation-census.test.ts`'s discipline; slug question-census; Task Q3a;
// plan 2026-10-26-consolidation-w3-questions.md): against a FIXTURE tree, so each query counts what it claims and passes
// over what it must not, and against the REAL tree, so it finds the sites the plan cites. Every query REPORTS: the base
// counts are what the PR body prints, and each may-only-shrink pin lands later, in the commit that reaches its wave
// target (Q3c to Q3f). The REAL rows hold what is true at every step of the series (every door tagged, every counted
// store call owned, the closed method list against the class), never a count.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO, type CensusSite } from '../consolidationCensus.js';
import { parsedFile } from '../scan/symbols.js';
import {
  coordStoreQuestionShapedMethods, envelopePairingRules, envelopePairingTitleRules, NOT_QUESTION_STORE_METHODS, QUESTION_STORE_EXCLUDED,
  QUESTION_STORE_METHODS, QUESTION_STORE_OWNERS, questionDoorIns, questionDoors, questionHoldCarriers, questionPaneEdges,
  questionStoreCallsOutside, questionSweepEntries,
} from './questions.js';

const show = (name: string, sites: readonly CensusSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.file}:${s.line}  ${s.text.trim()}`).join('\n')}`);
};

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
    // W7 C7p (D-7194): the fixture's operator door was `/api/sessions/:id/ask`, retired, so its tag row is gone; the
    // family's operator door stands in for it, with the same store call.
    "  app.post('/api/questions/:id/answer', async () => { coord.heldAskFor('x'); });",
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

  it('FIXTURE (Q3d): the two flags are carriers when they are FleetWatcher fields, and the one carrier is found inside createQuestions', () => {
    const t = tree({
      'server/src/watch.ts': [
        'export class FleetWatcher {',
        '  private reseedLoaded = false;',
        '  private asksDisabled = false;',
        '  private otherFlag = false;',
        '}',
      ].join('\n'),
      'server/src/coord/questions.ts': [
        'export function createQuestions() {',
        '  const questionHolds = new Map<string, number>();',
        '  let reseedLoaded = false;',
        '  let asksDisabled = false;',
        '  const otherLocal = new Map();',
        '  return {};',
        '}',
      ].join('\n'),
    });
    try {
      expect(questionHoldCarriers(t).map((s) => [s.name, s.owner, s.line])).toEqual([
        ['reseedLoaded', 'FleetWatcher', 2], ['asksDisabled', 'FleetWatcher', 3],
        ['questionHolds', 'createQuestions', 2], ['reseedLoaded', 'createQuestions', 3], ['asksDisabled', 'createQuestions', 4],
      ]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: a sweep entry is a method tick calls that reaches a lapse, release or prune; a public half tick does not call is not one', () => {
    const t = tree({ 'server/src/watch.ts': watch });
    try {
      // `sweepAsks` reaches `releaseAsk` through `askPass` inside an arrow; `sweepOther` reads only; `sweepApprovals` is not called by tick.
      expect(questionSweepEntries(t).map((s) => [s.method, s.line])).toEqual([['sweepAsks', 7]]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE (Q3d): a sweep act reached only through this.questions.<member>( counts, through the factory\'s own member calls too; a member that only reads does not', () => {
    const t = tree({
      'server/src/watch.ts': [
        'export class FleetWatcher {',
        '  async tick(): Promise<void> {',
        '    this.sweepA();',
        '    this.sweepB();',
        '    this.sweepC();',
        '  }',
        '  sweepA(): void { this.questions.lapseAsks(1, () => {}); }',
        '  sweepB(): void { this.questions.lapseApprovals(1); }',
        '  sweepC(): void { this.questions.currentAskOf("x"); }',
        '}',
      ].join('\n'),
      'server/src/coord/questions.ts': [
        'export function createQuestions(deps: Deps) {',
        '  const lapseAsks = (now: number, push: () => void): void => { deps.coord.releaseAsk(1, now); push(); };',
        '  const prune = (now: number): void => { deps.coord.pruneAskQuestions(now); };',
        '  const lapseApprovals = (now: number): void => { prune(now); };',
        '  const currentAskOf = (id: string) => deps.coord.currentAskFor(id);',
        '  return { lapseAsks, lapseApprovals, currentAskOf };',
        '}',
      ].join('\n'),
    });
    try {
      expect(questionSweepEntries(t).map((s) => [s.method, s.line])).toEqual([['sweepA', 3], ['sweepB', 4]]);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });

  it('FIXTURE: doors by shape and tag; a door-shaped path with no tag is `untagged`; the raise and a session release are not doors', () => {
    const t = tree({ 'server/src/coord/routes.ts': routes, 'server/src/server.ts': server });
    try {
      expect(questionDoors(t).map((s) => [s.route, s.tag])).toEqual([
        ['POST /api/asks/:id/answer', 'claimant'], ['POST /api/asks/:id/shout', 'untagged'],
        ['POST /api/sessions/:id/dialog/tab', 'navigation'], ['POST /api/questions/:id/answer', 'operator'],
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
        ['server/src/server.ts', 'POST /api/questions/:id/answer', 'heldAskFor', false],
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
    // 9 at the base (4 claimant, 4 operator, 1 navigation); 12 since Q3f (D-7030): 9 + the 3 routes of the family.
    // W7 C7p (D-7194) retires the operator aliases one per commit: 11 (4 operator) with `/api/sessions/:id/ask` gone,
    // 10 (3 operator) with `/dialog/multi`.
    const byTag = (t: string): number => doors.filter((s) => s.tag === t).length;
    expect([doors.length, byTag('claimant'), byTag('operator'), byTag('navigation')], 'the question doors, by principal').toEqual([10, 6, 3, 1]);
    for (const d of doorIns) expect(d.callers.length, `${d.method} has a route caller`).toBeGreaterThan(0);
    // W3 Q3f (D-7030; slug q3f-door-in-repoint), at the target, may only shrink: no route calls the watcher for a question, and the four
    // door-in forwards Q3d left (`releaseHeldAsk`, `answeredLate`, `releaseHeldApproval`, `approvalRuled`) are gone; the
    // cores call the watcher's `Questions` instance and push through its doors sink.
    expect(doorIns.map((d) => d.method), 'a watcher door-in a route calls').toEqual([]);
    const watcherSymbols = parsedFile(path.join(REPO, 'server/src/watch.ts')).symbols.map((x) => x.name);
    expect(watcherSymbols, 'the watcher was read').toContain('FleetWatcher.tick');
    expect(watcherSymbols.filter((n) => /^FleetWatcher\.(?:releaseHeldAsk|answeredLate|releaseHeldApproval|approvalRuled)$/.test(n)),
      'a door-in forward on the watcher').toEqual([]);
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

  // W7 C7f (D-7184): the PWA's pairing is deleted, so its side reads 0 on both rows (1 -> 0 and 2 -> 0).
  it('REAL: the pairing rule\'s definitions, one server and no PWA (C7f), printed for the PR body', () => {
    const rules = envelopePairingRules();
    const titles = envelopePairingTitleRules();
    show('envelopePairingRules', rules);
    show('envelopePairingTitleRules', titles);
    expect(rules.filter((s) => s.side === 'server').length, 'the server keeps one normalize-and-prefix definition').toBe(1);
    expect(rules.filter((s) => s.side === 'pwa').length, 'C7f: the PWA defines no normalize-and-prefix rule').toBe(0);
    expect(titles.filter((s) => s.side === 'pwa').length, 'C7f: the PWA defines no title rule').toBe(0);
  });
});
