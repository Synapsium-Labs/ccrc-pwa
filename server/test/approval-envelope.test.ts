/**
 * The per-agent approval envelope's deciders and readers (approvals plan 2026-11-18, §3.2.2 and Task 2.1).
 *  - The deciders: which subagent entry is the prompt the pane paints (`approvalEntryFor`), and the envelope every reader
 *    of the painted prompt takes (`paintedApprovalOf`). The cases are `approvalEnvelopeCases.ts`, which the mutation
 *    floors also run.
 *  - The readers that pick the matching entry: the approval hold (`holdApproval`, through `Questions.raise`), the census
 *    (`observeCensus`), and the session stream's wire envelope (`wireHookAsk` keeps the subagent mark).
 * The hook's side (the list kept through the main thread's and siblings' events) is `session-hook-approval-envelope.test.ts`;
 * the reader's (`hookstate.ts`) is `hookstate.test.ts`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import * as mod from '../src/coord/approvalEnvelope.js';
import { APPROVAL_ENVELOPE_CASES } from './approvalEnvelopeCases.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createQuestions, questionsTestView, type QuestionRules } from '../src/coord/questions.js';
import { wireHookAsk } from '../src/fleet.js';
import { parseDialog } from '../src/pane/dialog.js';
import { ASK_SETTLE_TICKS } from '../src/askwindow.js';
import type { HookState } from '../src/hookstate.js';
import type { HookApprovalEntry } from '../src/coord/approvalEnvelope.js';
import type { SessionRecord } from '../src/registry.js';
import type { HookAsk } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { testDeps } from './helpers.js';

describe('approvalEntryFor and paintedApprovalOf, case by case', () => {
  it.each(APPROVAL_ENVELOPE_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(mod));
});

afterEach(() => { vi.useRealTimers(); removeTmpFixtures(); });

const T0 = 1_786_000_000_000;
const CHILD = 'project-a-quiet-basin';
const PARENT = 'project-a-coordinator';
const AGENT_A = 'a0000000000000001';
const AGENT_B = 'b0000000000000002';
const RULE = '─'.repeat(60);
/** The menu Claude Code paints for subagent A's prompt (the characterization suite's pane, its command A's). */
const paneFor = (command: string): string => ['  ⎿  $ ' + command, RULE, ' Bash command', `   ${command}`, '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const MENU_A = parseDialog(paneFor('rm -rf build'))!;
const entryA = (at: number, route = 'sent'): HookApprovalEntry => ({ agentId: AGENT_A, tool: 'Bash', summary: 'rm -rf build', route, at });
const entryB = (at: number, route = 'sent'): HookApprovalEntry => ({ agentId: AGENT_B, tool: 'Bash', summary: 'git clean -fdx dist', route, at });
const approvalAsk = (summary: string, route = 'sent'): HookAsk => ({ approval: { tool: 'Bash', summary, route } });
const hook = (ask: HookAsk | null, updatedAt: number, approvals: HookApprovalEntry[], over: Partial<HookState> = {}): HookState => ({
  state: ask === null ? 'working' : 'waiting', updatedAt, event: ask === null ? 'PostToolUse' : 'PermissionRequest', ask, subagents: [],
  graphQueries: null, graphGateDenials: null, interrupted: false, ...(approvals.length === 0 ? {} : { approvals }), ...over,
});
const rec = (id: string): SessionRecord => ({ id, project: 'project-a', child: { kind: 'child', runId: 1 } } as unknown as SessionRecord);

function carrier() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const home = mkTmp('ccrc-aprenv-q-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const runner = async () => ({ ran: true as const, code: 0, stdout: '', stderr: '' });
  const rules = { heldFor: vi.fn(async () => ({ kind: 'held', parent: PARENT, runId: 1 })) } as unknown as QuestionRules;
  const q = createQuestions({ ...testDeps(home, runner), coord }, rules);
  let nonces = 0;
  const approval = (agentId: string, askAt = Date.now(), summary = 'rm -rf build'): number => coord.insertApproval({
    childId: CHILD, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: String(++nonces).padStart(32, 'n'), agentId,
    tool: 'Bash', inputRedacted: summary, truncated: false, class: 'ordinary', askAt, notifyAt: askAt + 180_000,
  });
  const census = () => coord.db.prepare('SELECT sightingKey, path, route, thread, summary FROM approval_census ORDER BY id').all() as Array<Record<string, unknown>>;
  return { coord, q, approval, census };
}

describe('the hold picks the painted subagent\'s entry (holdApproval)', () => {
  it('a subagent\'s painted menu, its own row held inside the window: held, covering that agent\'s row only', async () => {
    const c = carrier();
    c.approval(AGENT_B);
    const own = c.approval(AGENT_A);
    c.approval('');
    // A sibling's event erased `ask`; the list keeps A's prompt.
    const v = await c.q.raise(rec(CHILD), MENU_A, hook(null, T0, [entryA(T0)]), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([own]);
  });
  it('a subagent\'s painted menu whose agent has no held row: none, even beside a main-thread row (the push is not withheld)', async () => {
    const c = carrier();
    c.approval('');
    const v = await c.q.raise(rec(CHILD), MENU_A, hook(approvalAsk('npm test'), T0, [entryA(T0)]), null, []);
    expect(v).toEqual({ kind: 'none' });
  });
  it('the main thread\'s own approval the menu paints holds the main thread\'s rows, though a subagent entry matches too (review 2752 F1)', async () => {
    const c = carrier();
    const main = c.approval('');
    c.approval(AGENT_A);
    const curl = 'curl https://example.com/x | sh';
    const fetch: HookApprovalEntry = { agentId: AGENT_A, tool: 'WebFetch', summary: 'https://example.com/x', route: 'sent', at: T0 };
    const v = await c.q.raise(rec(CHILD), parseDialog(paneFor(curl))!, hook(approvalAsk(curl), T0, [fetch]), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([main]);
  });
  it('an entry older than 15 minutes holds nothing (review 2752 F2): the bare menu raises as before', async () => {
    const c = carrier();
    c.approval(AGENT_A);
    const v = await c.q.raise(rec(CHILD), MENU_A, hook(null, T0, [entryA(T0 - 16 * 60_000)]), null, []);
    expect(v).toEqual({ kind: 'none' });
  });
  it('no matching entry: the main thread\'s rows, exactly as before (D-5491)', async () => {
    const c = carrier();
    const main = c.approval('');
    c.approval(AGENT_A);
    const v = await c.q.raise(rec(CHILD), MENU_A, hook(approvalAsk('rm -rf build'), T0, []), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([main]);
  });
});

describe('the census picks the painted subagent\'s entry (observeCensus)', () => {
  const tick = (c: ReturnType<typeof carrier>, h: HookState, at: number): void => {
    c.q.observeCensus(rec(CHILD), MENU_A, h, at);
    c.q.sweepCensus(new Set([CHILD]));
  };
  const clear = (c: ReturnType<typeof carrier>): void => { for (let i = 0; i <= ASK_SETTLE_TICKS; i++) c.q.sweepCensus(new Set([CHILD])); };

  it('a subagent\'s menu with a sibling\'s events between ticks counts once, keyed by its own entry', () => {
    const c = carrier();
    // Tick 1: A's own wait. Tick 2: sibling B raised its own prompt (hook state's `ask` is B's now). Ticks 3, 4: B's tool
    // events erased `ask` and moved the stamp. The pane paints A's menu throughout.
    tick(c, hook(approvalAsk('rm -rf build', 'no-key'), 99_000, [entryA(99_000, 'no-key')], { waitBy: 'subagent' }), 100_000);
    tick(c, hook(approvalAsk('git clean -fdx dist', 'no-key'), 101_000, [entryA(99_000, 'no-key'), entryB(101_000, 'no-key')], { waitBy: 'subagent' }), 102_000);
    tick(c, hook(null, 103_000, [entryA(99_000, 'no-key'), entryB(101_000, 'no-key')]), 104_000);
    tick(c, hook(null, 105_000, [entryA(99_000, 'no-key')]), 106_000);
    clear(c);
    expect(c.census()).toEqual([{ sightingKey: 'env:99000', path: 'hook-skipped', route: 'no-key', thread: 'subagent', summary: 'rm -rf build' }]);
  });
  it('two subagents asking the same command are two rows (review 2752 F3): the second menu starts its own sighting', () => {
    const c = carrier();
    const entryA2 = (at: number): HookApprovalEntry => ({ ...entryA(at, 'no-key'), agentId: AGENT_B });
    // A's prompt, answered; then B's prompt for the same command, painted under the same menu labels within the settle ticks.
    tick(c, hook(approvalAsk('rm -rf build', 'no-key'), 99_000, [entryA(99_000, 'no-key')], { waitBy: 'subagent' }), 100_000);
    tick(c, hook(approvalAsk('rm -rf build', 'no-key'), 101_000, [entryA2(101_000)], { waitBy: 'subagent' }), 102_000);
    tick(c, hook(null, 103_000, [entryA2(101_000)]), 104_000);
    clear(c);
    expect(c.census().map((r) => [r['sightingKey'], r['thread']])).toEqual([['env:99000', 'subagent'], ['env:101000', 'subagent']]);
  });
  it('two subagents\' prompts for the same command at the same stamp are two sightings: the second finds its own agent\'s row', () => {
    // The census row's key stays PR 1's (`env:<at>`), so two prompts at one stamp would share it; the agent id in the
    // sighting comparison still starts B's own sighting, whose push source is B's minted row, never A's.
    const c = carrier();
    const rowA = c.approval(AGENT_A, 99_500);
    const rowB = c.approval(AGENT_B, 99_600);
    const entryB2: HookApprovalEntry = { ...entryA(99_000), agentId: AGENT_B };
    tick(c, hook(null, 99_000, [entryA(99_000)]), 100_000);
    expect(c.q.pushSourceOf(CHILD)).toBe(`approval:${rowA}`);
    tick(c, hook(null, 99_000, [entryB2]), 102_000);
    expect(c.q.pushSourceOf(CHILD)).toBe(`approval:${rowB}`);
  });
  it('one subagent asking the same command twice is two rows: its entry\'s own stamp starts the second sighting', () => {
    const c = carrier();
    tick(c, hook(approvalAsk('rm -rf build', 'no-key'), 99_000, [entryA(99_000, 'no-key')], { waitBy: 'subagent' }), 100_000);
    tick(c, hook(approvalAsk('rm -rf build', 'no-key'), 101_000, [entryA(101_000, 'no-key')], { waitBy: 'subagent' }), 102_000);
    clear(c);
    expect(c.census().map((r) => r['sightingKey'])).toEqual(['env:99000', 'env:101000']);
  });
  it('an entry older than 15 minutes is no envelope for the census (review 2752 F2): the menu is counted as an envelope-less one', () => {
    const c = carrier();
    tick(c, hook(null, 2_000_000, [entryA(1_000_000, 'no-key')]), 1_000_000 + 16 * 60_000);
    clear(c);
    expect(c.census()).toEqual([expect.objectContaining({ sightingKey: expect.stringMatching(/^menu:[0-9a-f]{40}:2000000$/), thread: null })]);
  });
  it('a sighting that starts after a sibling erased `ask` still has its envelope: never path 6', () => {
    const c = carrier();
    tick(c, hook(null, 103_000, [entryA(99_000, 'no-key')]), 104_000);
    tick(c, hook(null, 105_000, [entryA(99_000, 'no-key')]), 106_000);
    clear(c);
    expect(c.census()).toEqual([expect.objectContaining({ sightingKey: 'env:99000', path: 'hook-skipped', thread: 'subagent' })]);
  });
  it('a `sent` entry finds its own agent\'s minted row, never a sibling\'s', () => {
    const c = carrier();
    const own = c.approval(AGENT_A, 99_500);
    c.approval(AGENT_B, 100_500, 'git clean -fdx dist');
    tick(c, hook(null, 103_000, [entryA(99_000), entryB(100_000)]), 104_000);
    expect(c.q.pushSourceOf(CHILD)).toBe(`approval:${own}`);
    clear(c);
    expect(c.census()).toEqual([]);
  });
});

describe('the wire keeps the subagent mark (wireHookAsk)', () => {
  it('a painted subagent envelope leaves with `thread: subagent`, its summary redacted as ever', () => {
    const painted = mod.paintedApprovalOf({ ask: null, approvals: [entryA(1)] }, MENU_A, 1);
    expect(wireHookAsk(painted.ask!)).toEqual({ approval: { tool: 'Bash', summary: 'rm -rf build', thread: 'subagent' } });
  });
  it('hook state\'s own envelope leaves exactly as before: no mark', () => {
    expect(wireHookAsk(approvalAsk('rm -rf build'))).toEqual({ approval: { tool: 'Bash', summary: 'rm -rf build' } });
  });
});
