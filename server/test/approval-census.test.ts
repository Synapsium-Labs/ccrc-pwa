/**
 * The approval census's rows and their one writer (approvals plan 2026-11-18, §3.1 and Task 1.3; review 2638's fix round,
 * F1, F2, F5, F6, F7 and F8). A painted permission prompt that leaves no approvals row (Table 2a's paths 1, 2, 6 and 7)
 * gets exactly one `approval_census` row per sighting, written by the questions owner (`observeCensus`); a sighting is
 * decided ONCE, a prompt a minted row records writes none, a prompt the census cannot place is one `unmeasured` row with
 * its `why`, and the summary is stored masked and redacted.
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createQuestions } from '../src/coord/questions.js';
import {
  approvalShapedMenu, censusSightingOf, censusSummaryOf, CENSUS_MATCH_MS, CENSUS_ROW_WAIT_MS, CENSUS_SUMMARY_MAX,
  type CensusMintedRow, type CensusSightingInput,
} from '../src/coord/approvalCensus.js';
import { ASK_SETTLE_TICKS } from '../src/askwindow.js';
import type { HookState } from '../src/hookstate.js';
import type { SessionRecord } from '../src/registry.js';
import type { Dialog, HookAsk } from '../../shared/api.js';
import { APPROVAL_INPUT_RETENTION_DAYS } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { removeTmpFixtures(); });

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-census-'), '.ccrc', 'coord.db')));
const CHILD = 'lane-a-project-a';
const child = (id: string, runId = 7): SessionRecord => ({ id, project: 'project-a', child: { kind: 'child', runId } } as unknown as SessionRecord);
const root = (id: string): SessionRecord => ({ id, project: 'project-a', child: { kind: 'none' } } as unknown as SessionRecord);
const PERMISSION: Dialog = {
  id: 'dlg-perm', title: 'Do you want to proceed?', parsed: true, raw: '', selectedIndex: 0,
  options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'Yes, and don\'t ask again for rm commands' }, { index: 3, label: 'No, and tell Claude what to do differently' }],
};
const MODEL_CONFIRM: Dialog = {
  id: 'dlg-model', title: 'Switch model?', parsed: true, raw: '', selectedIndex: 0,
  options: [{ index: 1, label: 'Opus' }, { index: 2, label: 'Sonnet' }],
};
const approval = (route?: string, summary = 'rm -rf build'): HookAsk => ({ approval: { tool: 'Bash', summary, ...(route === undefined ? {} : { route }) } });
const hs = (ask: HookAsk | null, updatedAt = 1_000, sub = false): HookState => ({
  state: 'waiting', updatedAt, event: 'PermissionRequest', ask, subagents: [], graphQueries: null, graphGateDenials: null, interrupted: false,
  ...(sub ? { waitBy: 'subagent' as const } : {}),
});
/** The hook state before the envelope is written: the child is working, no ask yet. */
const working: HookState = { ...hs(null), state: 'working', event: 'PreToolUse' };
const censusRows = (c: CoordStore): Array<Record<string, unknown>> =>
  c.db.prepare('SELECT sessionId, sightingKey, path, why, route, thread, tool, summary, runId FROM approval_census ORDER BY id').all() as Array<Record<string, unknown>>;
const mint = (c: CoordStore, askAt: number, agentId = ''): number => c.insertApproval({
  childId: CHILD, parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'b'.repeat(32),
  agentId, tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'escalate', askAt, notifyAt: askAt + 60_000,
});
/** One tick per `at`, each 2 s apart from `t0`. */
const ticks = (q: ReturnType<typeof createQuestions>, r: SessionRecord, d: Dialog, states: ReadonlyArray<HookState | null>, t0 = 100_000): void => {
  states.forEach((h, i) => { q.observeCensus(r, d, h, t0 + i * 2_000); });
};

describe('censusSightingOf: which prompts owe a census row (L1)', () => {
  const row = (over: Partial<CensusMintedRow> = {}): CensusMintedRow => ({ id: 4, askAt: 2_000, agentId: '', state: 'held', ...over });
  const at = (over: Partial<CensusSightingInput>): CensusSightingInput => ({
    hsPresent: true, ask: approval('sent'), updatedAt: 1_000, waitBy: null, dialog: PERMISSION, firstSeenAt: 2_000, now: 2_000,
    ticks: 1, minted: [], ...over,
  });
  it('a skip word is path 1 at once, keyed by the envelope\'s stamp; `not-a-child` is path 7', () => {
    expect(censusSightingOf(at({ ask: approval('deny-unknown') }))).toMatchObject({ kind: 'write', path: 'hook-skipped', why: null, route: 'deny-unknown', sightingKey: 'env:1000', thread: 'main' });
    expect(censusSightingOf(at({ ask: approval('not-a-child') }))).toMatchObject({ kind: 'write', path: 'not-a-child' });
  });
  it('a refusal or a lost answer is path 2; the route\'s own `not-a-child` is path 7', () => {
    expect(censusSightingOf(at({ ask: approval('request-refused:deny-not-engaged') }))).toMatchObject({ path: 'refused-at-mint' });
    expect(censusSightingOf(at({ ask: approval('request-failed') }))).toMatchObject({ path: 'refused-at-mint' });
    expect(censusSightingOf(at({ ask: approval('request-refused:not-a-child') }))).toMatchObject({ path: 'not-a-child' });
  });
  it('F7: a lost answer with a row of the same thread minted for it counts as that row, never path 2 as well', () => {
    expect(censusSightingOf(at({ ask: approval('request-failed'), minted: [row({ askAt: 9_000 })] }))).toEqual({ kind: 'none', mintedId: 4 });
    // Another thread's row is not this prompt's.
    expect(censusSightingOf(at({ ask: approval('request-failed'), minted: [row({ agentId: 'agent-1' })] }))).toMatchObject({ path: 'refused-at-mint' });
  });
  it('a subagent\'s envelope is the subagent thread', () => {
    expect(censusSightingOf(at({ ask: approval('no-key'), waitBy: 'subagent' }))).toMatchObject({ thread: 'subagent' });
  });
  it('`sent` (and a request released at mint) counts as its minted row once it is there, matched on the server\'s clock', () => {
    expect(censusSightingOf(at({ minted: [row()] }))).toEqual({ kind: 'none', mintedId: 4 });
    expect(censusSightingOf(at({ ask: approval('request-refused:approval-released'), minted: [row({ state: 'released' })] }))).toEqual({ kind: 'none', mintedId: 4 });
    // A row older than the sighting's match window is an earlier prompt's.
    expect(censusSightingOf(at({ minted: [row({ askAt: 2_000 - CENSUS_MATCH_MS - 1 })] }))).toMatchObject({ kind: 'wait' });
  });
  it('F6: `sent` with no row waits, and is `sent-no-row` past the row wait (or when it clears first)', () => {
    expect(censusSightingOf(at({}))).toEqual({ kind: 'wait', ifCleared: expect.objectContaining({ path: 'unmeasured', why: 'sent-no-row' }) });
    expect(censusSightingOf(at({ now: 2_000 + CENSUS_ROW_WAIT_MS }))).toMatchObject({ kind: 'write', path: 'unmeasured', why: 'sent-no-row', sightingKey: 'env:1000' });
  });
  it('F6: an envelope with no route word (an older hook), or one this build does not know, is unmeasured, never uncounted', () => {
    expect(censusSightingOf(at({ ask: approval() }))).toMatchObject({ kind: 'write', path: 'unmeasured', why: 'no-route' });
    expect(censusSightingOf(at({ ask: approval('a-word-from-later') }))).toMatchObject({ kind: 'write', path: 'unmeasured', why: 'unknown-route', route: 'a-word-from-later' });
  });
  it('an AskUserQuestion, and a menu that is not approval-shaped, is no permission prompt', () => {
    expect(censusSightingOf(at({ ask: { questions: [] } }))).toEqual({ kind: 'none', mintedId: null });
    expect(censusSightingOf(at({ ask: null, dialog: MODEL_CONFIRM, ticks: 9 }))).toEqual({ kind: 'none', mintedId: null });
  });
  it('F1: with no envelope the menu waits out the settle window; cleared there it is unmeasured (`cleared-early`)', () => {
    for (let t = 1; t <= ASK_SETTLE_TICKS; t++) {
      expect(censusSightingOf(at({ ask: null, ticks: t })), `tick ${t}`).toEqual({ kind: 'wait', ifCleared: expect.objectContaining({ path: 'unmeasured', why: 'cleared-early' }) });
    }
  });
  it('past the settle window: no row is path 6, keyed by the sighting; a tight match is that row; another row near it is unmeasured', () => {
    const settled = ASK_SETTLE_TICKS + 1;
    expect(censusSightingOf(at({ ask: null, ticks: settled }))).toEqual({
      kind: 'write', path: 'envelope-erased', why: null, route: null, thread: null, tool: null, summary: null, sightingKey: 'menu:dlg-perm:2000',
    });
    // F5: tight = the same thread, held or released, askAt within the match window of the first sighting.
    expect(censusSightingOf(at({ ask: null, ticks: settled, minted: [row({ askAt: 2_000 + CENSUS_MATCH_MS })] }))).toEqual({ kind: 'none', mintedId: 4 });
    expect(censusSightingOf(at({ ask: null, ticks: settled, minted: [row({ askAt: 2_000 - CENSUS_MATCH_MS - 1 })] }))).toMatchObject({ path: 'unmeasured', why: 'near-miss' });
    expect(censusSightingOf(at({ ask: null, ticks: settled, minted: [row({ state: 'allowed' })] }))).toMatchObject({ path: 'unmeasured', why: 'near-miss' });
    expect(censusSightingOf(at({ ask: null, ticks: settled, minted: [row({ agentId: 'agent-1' })] }))).toMatchObject({ path: 'unmeasured', why: 'near-miss' });
  });
  it('F2: a missing hook state is unmeasured (`hookstate-gone`) after the settle window, never path 6', () => {
    expect(censusSightingOf(at({ hsPresent: false, ask: null, updatedAt: null }))).toMatchObject({ kind: 'wait', ifCleared: { why: 'hookstate-gone' } });
    expect(censusSightingOf(at({ hsPresent: false, ask: null, updatedAt: null, ticks: ASK_SETTLE_TICKS + 1 }))).toMatchObject({ kind: 'write', path: 'unmeasured', why: 'hookstate-gone' });
  });
  it('F8: a summary cut at 200 characters loses its trailing word, which may be the front of a secret', () => {
    const cut = `${'a '.repeat(90)}token sk-ant-api03-ABCDEFGHIJKLMNOP`.slice(0, CENSUS_SUMMARY_MAX);
    expect(cut).toHaveLength(CENSUS_SUMMARY_MAX);
    expect(censusSummaryOf(cut)).not.toContain('sk-ant');
    expect(censusSummaryOf(cut).endsWith('token…')).toBe(true);
    expect(censusSummaryOf('rm -rf build')).toBe('rm -rf build');
    expect(censusSightingOf(at({ ask: approval('no-node', cut) }))).toMatchObject({ summary: censusSummaryOf(cut) });
  });
});

describe('approvalShapedMenu', () => {
  it('a permission prompt is (Yes first, a No row); a model confirm, an AskUserQuestion and an unparsed menu are not', () => {
    expect(approvalShapedMenu(PERMISSION)).toBe(true);
    expect(approvalShapedMenu({ ...PERMISSION, options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }] })).toBe(true);
    expect(approvalShapedMenu(MODEL_CONFIRM)).toBe(false);
    expect(approvalShapedMenu({ ...PERMISSION, ask: { question: 'q', options: [] } as unknown as Dialog['ask'] })).toBe(false);
    expect(approvalShapedMenu({ ...PERMISSION, parsed: false })).toBe(false);
    expect(approvalShapedMenu({ ...PERMISSION, options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'Nope' }] })).toBe(false);
  });
});

describe('observeCensus: the one writer, one decision per sighting', () => {
  it('a skipped prompt seen on three ticks writes exactly one row, with its run and the summary redacted', () => {
    const c = store();
    const q = createQuestions({ coord: c, masker: { maskText: (t) => t.replace('hunter2', '[masked]') } });
    const secret = 'sk-ant-api03-' + 'A'.repeat(90);
    for (let t = 0; t < 3; t++) q.observeCensus(child(CHILD), PERMISSION, hs(approval('deny-unknown', `curl -H ${secret} hunter2`)), 5_000 + t);
    const rows = censusRows(c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: CHILD, sightingKey: 'env:1000', path: 'hook-skipped', why: null, route: 'deny-unknown', thread: 'main', tool: 'Bash', runId: 7 });
    expect(String(rows[0]!['summary'])).not.toContain(secret);
    expect(String(rows[0]!['summary'])).not.toContain('hunter2');
    expect(q.pushSourceOf(CHILD)).toMatch(/^census:\d+$/);
  });
  it('F1 (the review\'s reproduction): a menu painted before its envelope, then a skip word, is ONE row, path 1', () => {
    const c = store();
    ticks(createQuestions({ coord: c }), child(CHILD), PERMISSION, [working, hs(approval('no-key'), 101_000)]);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'hook-skipped', route: 'no-key' })]);
  });
  it('F1 (the review\'s reproduction): a menu painted before its envelope, then `sent` with a minted row, is no row; the push source is the row', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    q.observeCensus(child(CHILD), PERMISSION, working, 100_000);
    const id = mint(c, 101_000);
    q.observeCensus(child(CHILD), PERMISSION, hs(approval('sent'), 100_500), 102_000);
    for (let t = 2; t < 6; t++) q.observeCensus(child(CHILD), PERMISSION, hs(approval('sent'), 100_500), 100_000 + t * 2_000);
    expect(censusRows(c)).toEqual([]);
    expect(q.pushSourceOf(CHILD)).toBe(`approval:${id}`);
  });
  it('F2: a decided prompt whose hook state ages out (null) while it stands writes no second row', () => {
    const c = store();
    ticks(createQuestions({ coord: c }), child(CHILD), PERMISSION, [hs(approval('not-a-child')), null, null, null, null]);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'not-a-child' })]);
  });
  it('F2: a menu with no hook state at all is one unmeasured row past the settle window, never path 6', () => {
    const c = store();
    ticks(createQuestions({ coord: c }), root('lane-a-project-b'), PERMISSION, [null, null, null, null]);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'unmeasured', why: 'hookstate-gone', sightingKey: 'menu:dlg-perm:100000' })]);
  });
  it('a restamp of the same envelope (a subagent event moves its stamp) is the same prompt: one row', () => {
    const c = store();
    ticks(createQuestions({ coord: c }), child(CHILD), PERMISSION, [hs(approval('no-key'), 1_000), hs(approval('no-key'), 9_000), hs(approval('no-key'), 12_000)]);
    expect(censusRows(c).map((r) => r['sightingKey'])).toEqual(['env:1000']);
  });
  it('a second prompt (new envelope content) under the same menu labels is a second row; a restart re-seeing it writes none', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    q.observeCensus(child(CHILD), PERMISSION, hs(approval('no-key', 'rm -rf build'), 1_000), 5_000);
    q.observeCensus(child(CHILD), PERMISSION, hs(approval('no-key', 'rm -rf dist'), 9_000), 7_000);
    createQuestions({ coord: c }).observeCensus(child(CHILD), PERMISSION, hs(approval('no-key', 'rm -rf dist'), 9_000), 9_000);
    expect(censusRows(c).map((r) => r['sightingKey'])).toEqual(['env:1000', 'env:9000']);
  });
  it('a root session\'s prompt is path 7 with no run', () => {
    const c = store();
    createQuestions({ coord: c }).observeCensus(root('lane-a-project-b'), PERMISSION, hs(approval('not-a-child')), 5_000);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'not-a-child', runId: null })]);
  });
  it('an erased envelope over a permission menu is path 6 only past the settle window; one row per sighting', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    const doneHs: HookState = { ...hs(null), state: 'done', event: 'Stop' };
    ticks(q, child(CHILD), PERMISSION, [doneHs, doneHs]);
    expect(censusRows(c)).toEqual([]);
    ticks(q, child(CHILD), PERMISSION, [doneHs, doneHs], 104_000);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'envelope-erased', sightingKey: 'menu:dlg-perm:100000', thread: null, summary: null })]);
    q.settleCleared(CHILD, PERMISSION.id);
    ticks(q, child(CHILD), PERMISSION, [doneHs, doneHs, doneHs], 200_000);
    expect(censusRows(c)).toHaveLength(2);
  });
  it('a menu that clears inside the settle window with no envelope is one unmeasured row (`cleared-early`), never silence', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    ticks(q, child(CHILD), PERMISSION, [working]);
    q.settleCleared(CHILD, PERMISSION.id);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'unmeasured', why: 'cleared-early' })]);
  });
  it('F5: a tightly matching row (same thread, held, minted beside the sighting) is this prompt\'s: no row', () => {
    const c = store();
    mint(c, 99_000);
    ticks(createQuestions({ coord: c }), child(CHILD), PERMISSION, [working, working, working]);
    expect(censusRows(c)).toEqual([]);
  });
  it('F5: an earlier row of the child that is not a tight match makes the erased menu unmeasured, not dropped', () => {
    const c = store();
    mint(c, 100_000 - 5 * 60_000, 'agent-1');
    ticks(createQuestions({ coord: c }), child(CHILD), PERMISSION, [working, working, working]);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'unmeasured', why: 'near-miss' })]);
  });
  it('F6: `sent` whose row never arrives is one unmeasured row when the menu clears', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    ticks(q, child(CHILD), PERMISSION, [hs(approval('sent'), 99_000)]);
    expect(censusRows(c)).toEqual([]);
    q.settleCleared(CHILD, PERMISSION.id);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'unmeasured', why: 'sent-no-row', sightingKey: 'env:99000' })]);
  });
  it('an AskUserQuestion menu writes nothing', () => {
    const c = store();
    createQuestions({ coord: c }).observeCensus(child(CHILD), PERMISSION, hs({ questions: [] }), 5_000);
    expect(censusRows(c)).toEqual([]);
  });
  it('the daily prune clears a summary past the approvals\' retention and keeps the row', () => {
    const c = store();
    createQuestions({ coord: c }).observeCensus(child(CHILD), PERMISSION, hs(approval('no-uuid')), 1_000);
    createQuestions({ coord: c }).prune(1_000 + APPROVAL_INPUT_RETENTION_DAYS * 86_400_000 + 1);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'hook-skipped', summary: null })]);
  });
});

describe('insertCensusRow: the store\'s unique sighting', () => {
  it('a repeat insert of one sighting answers the same id and writes nothing', () => {
    const c = store();
    const row = { sessionId: 's', sightingKey: 'env:1', path: 'hook-skipped' as const, why: null, route: 'no-key', thread: 'main' as const,
      tool: 'Bash', summary: 'x', runId: null, seenAt: 1 };
    const a = c.insertCensusRow(row);
    const b = c.insertCensusRow({ ...row, seenAt: 2 });
    expect(a.inserted).toBe(true);
    expect(b).toEqual({ id: a.id, inserted: false });
    expect(censusRows(c)).toHaveLength(1);
  });
});
