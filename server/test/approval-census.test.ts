/**
 * The approval census's rows and their one writer (approvals plan 2026-11-18, §3.1 and Task 1.3). A painted permission
 * prompt that leaves no approvals row (Table 2a's paths 1, 2, 6 and 7) gets exactly one `approval_census` row per
 * sighting, written by the questions owner (`observeCensus`); a repeat sighting writes none, a prompt a minted row
 * records writes none, and the summary is stored masked and redacted.
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createQuestions } from '../src/coord/questions.js';
import { approvalShapedMenu, censusSightingOf, type CensusSightingInput } from '../src/coord/approvalCensus.js';
import type { HookState } from '../src/hookstate.js';
import type { SessionRecord } from '../src/registry.js';
import type { Dialog, HookAsk } from '../../shared/api.js';
import { APPROVAL_INPUT_RETENTION_DAYS } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { removeTmpFixtures(); });

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-census-'), '.ccrc', 'coord.db')));
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
const censusRows = (c: CoordStore): Array<Record<string, unknown>> =>
  c.db.prepare('SELECT sessionId, sightingKey, path, route, thread, tool, summary, runId FROM approval_census ORDER BY id').all() as Array<Record<string, unknown>>;

describe('censusSightingOf: which prompts owe a census row (L1)', () => {
  const at = (over: Partial<CensusSightingInput>): CensusSightingInput => ({
    ask: approval('sent'), updatedAt: 1_000, waitBy: null, dialog: PERMISSION, firstSeenAt: 2_000, recentMinted: false, ...over,
  });
  it('a skip word is path 1, keyed by the envelope\'s stamp; `not-a-child` is path 7', () => {
    expect(censusSightingOf(at({ ask: approval('deny-unknown') }))).toMatchObject({ kind: 'write', path: 'hook-skipped', route: 'deny-unknown', sightingKey: 'env:1000', thread: 'main' });
    expect(censusSightingOf(at({ ask: approval('not-a-child') }))).toMatchObject({ kind: 'write', path: 'not-a-child' });
  });
  it('a refusal or a lost answer is path 2; the route\'s own `not-a-child` is path 7', () => {
    expect(censusSightingOf(at({ ask: approval('request-refused:deny-not-engaged') }))).toMatchObject({ path: 'refused-at-mint' });
    expect(censusSightingOf(at({ ask: approval('request-failed') }))).toMatchObject({ path: 'refused-at-mint' });
    expect(censusSightingOf(at({ ask: approval('request-refused:not-a-child') }))).toMatchObject({ path: 'not-a-child' });
  });
  it('a subagent\'s envelope is the subagent thread', () => {
    expect(censusSightingOf(at({ ask: approval('no-key'), waitBy: 'subagent' }))).toMatchObject({ thread: 'subagent' });
  });
  it('a prompt a minted row records owes nothing: `sent`, and a request released at mint', () => {
    expect(censusSightingOf(at({ ask: approval('sent') }))).toEqual({ kind: 'none' });
    expect(censusSightingOf(at({ ask: approval('request-refused:approval-released') }))).toEqual({ kind: 'none' });
  });
  it('an envelope with no route word (an older hook), or one this build does not know, is not counted', () => {
    expect(censusSightingOf(at({ ask: approval() }))).toEqual({ kind: 'none' });
    expect(censusSightingOf(at({ ask: approval('a-word-from-later') }))).toEqual({ kind: 'none' });
  });
  it('an AskUserQuestion is no permission prompt', () => {
    expect(censusSightingOf(at({ ask: { questions: [] } }))).toEqual({ kind: 'none' });
  });
  it('no envelope over an approval-shaped menu is path 6, keyed by the sighting; unless a recent row is this prompt\'s', () => {
    expect(censusSightingOf(at({ ask: null }))).toEqual({
      kind: 'write', path: 'envelope-erased', route: null, thread: null, tool: null, summary: null, sightingKey: 'menu:dlg-perm:2000',
    });
    expect(censusSightingOf(at({ ask: null, recentMinted: true }))).toEqual({ kind: 'none' });
    expect(censusSightingOf(at({ ask: null, dialog: MODEL_CONFIRM }))).toEqual({ kind: 'none' });
  });
  it('the summary is cut to the envelope\'s 200 characters', () => {
    const s = censusSightingOf(at({ ask: approval('no-node', 'x'.repeat(500)) }));
    expect(s.kind === 'write' ? s.summary?.length : -1).toBe(200);
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

describe('observeCensus: the one writer, once per sighting', () => {
  it('a skipped prompt seen on three ticks writes exactly one row, with its run and the summary redacted', () => {
    const c = store();
    const q = createQuestions({ coord: c, masker: { maskText: (t) => t.replace('hunter2', '[masked]') } });
    const secret = 'sk-ant-api03-' + 'A'.repeat(90);
    for (let t = 0; t < 3; t++) q.observeCensus(child('lane-a-project-a'), PERMISSION, hs(approval('deny-unknown', `curl -H ${secret} hunter2`)), 5_000 + t);
    const rows = censusRows(c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'lane-a-project-a', sightingKey: 'env:1000', path: 'hook-skipped', route: 'deny-unknown', thread: 'main', tool: 'Bash', runId: 7 });
    expect(String(rows[0]!['summary'])).not.toContain(secret);
    expect(String(rows[0]!['summary'])).not.toContain('hunter2');
    expect(q.pushSourceOf('lane-a-project-a')).toMatch(/^census:\d+$/);
  });
  it('a second prompt (a new envelope stamp) is a second row; a new instance (a restart) re-seeing the first writes none', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    q.observeCensus(child('lane-a-project-a'), PERMISSION, hs(approval('no-key'), 1_000), 5_000);
    q.observeCensus(child('lane-a-project-a'), PERMISSION, hs(approval('no-key'), 9_000), 6_000);
    createQuestions({ coord: c }).observeCensus(child('lane-a-project-a'), PERMISSION, hs(approval('no-key'), 9_000), 7_000);
    expect(censusRows(c).map((r) => r['sightingKey'])).toEqual(['env:1000', 'env:9000']);
  });
  it('a root session\'s prompt is path 7 with no run', () => {
    const c = store();
    createQuestions({ coord: c }).observeCensus(root('lane-a-project-b'), PERMISSION, hs(approval('not-a-child')), 5_000);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'not-a-child', runId: null })]);
  });
  it('a prompt the request route minted writes no row, and its push source is the row', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    const id = c.insertApproval({ childId: 'lane-a-project-a', parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'b'.repeat(32),
      agentId: '', tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'escalate', askAt: 1_500, notifyAt: 61_500 });
    q.observeCensus(child('lane-a-project-a'), PERMISSION, hs(approval('sent'), 1_000), 5_000);
    expect(censusRows(c)).toEqual([]);
    expect(q.pushSourceOf('lane-a-project-a')).toBe(`approval:${id}`);
  });
  it('an erased envelope over a permission menu is one row per sighting; a recent row makes it none; a clear ends the sighting', () => {
    const c = store();
    const q = createQuestions({ coord: c });
    const doneHs: HookState = { ...hs(null), state: 'done', event: 'Stop' };
    q.observeCensus(child('lane-a-project-a'), PERMISSION, doneHs, 1_000_000);
    q.observeCensus(child('lane-a-project-a'), PERMISSION, doneHs, 1_002_000);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'envelope-erased', sightingKey: 'menu:dlg-perm:1000000', thread: null, summary: null })]);
    q.settleCleared('lane-a-project-a', PERMISSION.id);
    q.observeCensus(child('lane-a-project-a'), PERMISSION, doneHs, 2_000_000);
    expect(censusRows(c)).toHaveLength(2);
    const c2 = store();
    c2.insertApproval({ childId: 'lane-a-project-a', parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'b'.repeat(32),
      agentId: 'agent-1', tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'escalate', askAt: 900_000, notifyAt: 1_080_000 });
    createQuestions({ coord: c2 }).observeCensus(child('lane-a-project-a'), PERMISSION, doneHs, 1_000_000);
    expect(censusRows(c2)).toEqual([]);
  });
  it('an AskUserQuestion menu writes nothing', () => {
    const c = store();
    createQuestions({ coord: c }).observeCensus(child('lane-a-project-a'), PERMISSION, hs({ questions: [] }), 5_000);
    expect(censusRows(c)).toEqual([]);
  });
  it('the daily prune clears a summary past the approvals\' retention and keeps the row', () => {
    const c = store();
    createQuestions({ coord: c }).observeCensus(child('lane-a-project-a'), PERMISSION, hs(approval('no-uuid')), 1_000);
    createQuestions({ coord: c }).prune(1_000 + APPROVAL_INPUT_RETENTION_DAYS * 86_400_000 + 1);
    expect(censusRows(c)).toEqual([expect.objectContaining({ path: 'hook-skipped', summary: null })]);
  });
});

describe('insertCensusRow: the store\'s unique sighting', () => {
  it('a repeat insert of one sighting answers the same id and writes nothing', () => {
    const c = store();
    const row = { sessionId: 's', sightingKey: 'env:1', path: 'hook-skipped' as const, route: 'no-key', thread: 'main' as const,
      tool: 'Bash', summary: 'x', runId: null, seenAt: 1 };
    const a = c.insertCensusRow(row);
    const b = c.insertCensusRow({ ...row, seenAt: 2 });
    expect(a.inserted).toBe(true);
    expect(b).toEqual({ id: a.id, inserted: false });
    expect(censusRows(c)).toHaveLength(1);
  });
});
