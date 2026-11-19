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
import fs from 'node:fs';
import path from 'node:path';
import * as mod from '../src/coord/approvalEnvelope.js';
import { APPROVAL_ENVELOPE_CASES, cc280Body, r299Body } from './approvalEnvelopeCases.js';
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
/** The menu Claude Code paints for subagent A's prompt (the characterization suite's pane, its command A's), with the blank
 *  lines a real capture paints around the command block (`fixtures/panes/cc280-permission.txt`). */
const paneFor = (command: string): string => ['  ⎿  $ ' + command, RULE, ' Bash command', '', `   ${command}`, '   Remove the build directory',
  '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const MENU_A = parseDialog(paneFor('rm -rf build'))!;
/** The same prompt with no blank lines (the characterization suite's pane, and this suite's before review 2800 F3). */
const paneNoBlank = (command: string): string => ['  ⎿  $ ' + command, RULE, ' Bash command', `   ${command}`, '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
/** The same prompt in the shape Claude Code 2.1.299 paints (`pwa/test/fixtures/drawer/recorded/2.1.299/permission.json`):
 *  the description first, then the command's rows between dashed rules, each behind a gutter. */
const pane299 = (command: string): string => ['  ⎿  $ ' + command, '', '─'.repeat(220), ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below', ' Remove the build directory', '╌'.repeat(220),
  ` │ ${command}`, '╌'.repeat(220), ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  '', ' Esc to cancel · Tab to amend'].join('\n');
const SHAPES = [['cc280', paneFor], ['no blank lines', paneNoBlank], ['2.1.299', pane299]] as const;
/** Two siblings' commands that share their first 60 characters (a `cd` into one long worktree path), neither exact. */
const WT = 'cd /work/project-a/worktrees/feature-a-rather-long-branch-name/server && ';
const LONG_A = `${WT}git push --force origin main ${'x'.repeat(200)}`;
const tieA = (at: number): HookApprovalEntry => ({ agentId: AGENT_A, tool: 'Bash', summary: Array.from(LONG_A).slice(0, 200).join(''), route: 'no-key', at });
const tieB = (at: number): HookApprovalEntry => ({ agentId: AGENT_B, tool: 'Bash', summary: `${WT}npm test`, route: 'no-key', at });
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
  it.each(SHAPES)('in the %s shape, a subagent\'s painted menu holds that agent\'s row (review 2800 F2, F3)', async (_shape, pane) => {
    const c = carrier();
    c.approval(AGENT_B);
    const own = c.approval(AGENT_A);
    const v = await c.q.raise(rec(CHILD), parseDialog(pane('rm -rf build'))!, hook(null, T0, [entryA(T0)]), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([own]);
  });
  it('an ambiguous tie across agents holds nothing (review 2800 F1): the bare menu raises as before', async () => {
    const c = carrier();
    const own = c.approval(AGENT_A, Date.now(), LONG_A.slice(0, 200));
    c.approval(AGENT_B, Date.now(), `${WT}npm test`);
    const menu = parseDialog(paneFor(LONG_A))!;
    expect(await c.q.raise(rec(CHILD), menu, hook(null, T0, [tieA(T0), tieB(T0)]), null, [])).toEqual({ kind: 'none' });
    const v = await c.q.raise(rec(CHILD), menu, hook(null, T0, [tieA(T0)]), null, []);
    expect(v.kind, 'control: alone, A is held').toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([own]);
  });
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
  it('an entry older than the hook\'s wait and 15 minutes holds nothing (reviews 2752 F2, 2774 F3): the bare menu raises as before', async () => {
    const c = carrier();
    c.approval(AGENT_A);
    const v = await c.q.raise(rec(CHILD), MENU_A, hook(null, T0, [entryA(T0 - 540_000 - 15 * 60_000 - 1)]), null, []);
    expect(v).toEqual({ kind: 'none' });
  });
  it('the main thread\'s own approval that is only a substring loses to the entry that is the command block (review 2774 C1)', async () => {
    const c = carrier();
    c.approval('', Date.now(), 'git push origin main');
    const own = c.approval(AGENT_A, Date.now(), 'git push origin main --force');
    const force: HookApprovalEntry = { agentId: AGENT_A, tool: 'Bash', summary: 'git push origin main --force', route: 'sent', at: T0 };
    const v = await c.q.raise(rec(CHILD), parseDialog(paneFor('git push origin main --force'))!, hook(approvalAsk('git push origin main'), T0, [force]), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([own]);
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
  const tick = (c: ReturnType<typeof carrier>, h: HookState, at: number, menu = MENU_A): void => {
    c.q.observeCensus(rec(CHILD), menu, h, at);
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
  it('a sibling\'s own ask that is only a substring of the painted command keeps the sighting on the painted agent (review 2774 C2)', () => {
    const c = carrier();
    const publish = 'npm run build -- --prod && npm publish';
    const a: HookApprovalEntry = { agentId: AGENT_A, tool: 'Bash', summary: publish, route: 'no-key', at: 99_000 };
    const b: HookApprovalEntry = { agentId: AGENT_B, tool: 'Bash', summary: 'npm run build -- --prod', route: 'no-key', at: 101_000 };
    const menu = parseDialog(paneFor(publish))!;
    tick(c, hook(approvalAsk('npm run build -- --prod', 'no-key'), 101_000, [a, b], { waitBy: 'subagent' }), 102_000, menu);
    clear(c);
    expect(c.census()).toEqual([{ sightingKey: 'env:99000', path: 'hook-skipped', route: 'no-key', thread: 'subagent', summary: publish }]);
  });
  it.each(SHAPES)('in the %s shape, a subagent\'s menu is keyed by its own entry (review 2800 F2, F3)', (_shape, pane) => {
    const c = carrier();
    tick(c, hook(null, 103_000, [entryA(99_000, 'no-key')]), 104_000, parseDialog(pane('rm -rf build'))!);
    clear(c);
    expect(c.census()).toEqual([{ sightingKey: 'env:99000', path: 'hook-skipped', route: 'no-key', thread: 'subagent', summary: 'rm -rf build' }]);
  });
  it('an ambiguous tie across agents is no envelope for the census (review 2800 F1): an envelope-less menu', () => {
    const c = carrier();
    tick(c, hook(null, 103_000, [tieA(99_000), tieB(101_000)]), 104_000, parseDialog(paneFor(LONG_A))!);
    clear(c);
    expect(c.census()).toEqual([expect.objectContaining({ sightingKey: expect.stringMatching(/^menu:[0-9a-f]{40}:103000$/), thread: null })]);
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
  it('an entry older than the hook\'s wait and 15 minutes is no envelope for the census (reviews 2752 F2, 2774 F3): an envelope-less menu', () => {
    const c = carrier();
    tick(c, hook(null, 2_000_000, [entryA(1_000_000, 'no-key')]), 1_000_000 + 540_000 + 15 * 60_000 + 1);
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

describe('the real captures, through parseDialog and paintedApprovalOf (review 2800 F2, F3)', () => {
  const CC280 = fs.readFileSync(path.resolve(__dirname, 'fixtures/panes/cc280-permission.txt'), 'utf8');
  const R299 = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../pwa/test/fixtures/drawer/recorded/2.1.299/permission.json'), 'utf8')) as
    { capture: string[] }).capture;
  const R299_ROWS = [R299[17]!.replace(/^ │ /, ''), R299[18]!.replace(/^ │ /, '')];
  const R299_DESCRIPTION = R299[15]!.trim();
  const at = (summary: string): HookApprovalEntry => ({ agentId: AGENT_A, tool: 'Bash', summary, route: 'sent', at: T0 });
  const shownFor = (pane: string, summary: string) => mod.paintedApprovalOf({ ask: null, updatedAt: T0, approvals: [at(summary)] }, parseDialog(pane)!, T0);
  it('the cases\' two shapes are what parseDialog reads from the captures', () => {
    expect(parseDialog(CC280)).toMatchObject({ title: 'Bash command', body: cc280Body(['echo rigok'], 'Print rigok') });
    expect(parseDialog(R299.join('\n'))).toMatchObject({ title: 'Bash command', body: r299Body(R299_ROWS, R299_DESCRIPTION) });
  });
  it('cc280: a short command and a long one are their prompt', () => {
    expect(shownFor(CC280, 'echo rigok').entry?.summary).toBe('echo rigok');
    const long = `echo ${'rigok-'.repeat(20)}done`;
    expect(shownFor(CC280.split('echo rigok').join(long), long).entry?.summary).toBe(long);
    expect(shownFor(CC280, 'echo').entry, 'a part of it is not').toBeNull();
  });
  it('2.1.299: a short command and the recorded long one are their prompt', () => {
    const recorded = R299_ROWS.join(' ');
    expect(shownFor(R299.join('\n'), recorded).entry?.summary).toBe(recorded);
    const short = [...R299.slice(0, 15), ' Print rigok', R299[16]!, ' │ echo rigok', ...R299.slice(19)].join('\n');
    expect(shownFor(short, 'echo rigok').entry?.summary).toBe('echo rigok');
    expect(shownFor(short, 'Print rigok').entry, 'its description is not').toBeNull();
  });
});

describe('an own approval the menu does not match (review 2800 F5, as the coordinator narrowed it)', () => {
  const WRITE = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../pwa/test/fixtures/drawer/recorded/2.1.299/write-preview.json'), 'utf8')) as
    { capture: string[] }).capture.join('\n');
  const write: HookAsk = { approval: { tool: 'Write', summary: '/rig/project-a/src/notes.md', route: 'sent' } };
  const sibling: HookApprovalEntry = { agentId: AGENT_B, tool: 'Bash', summary: 'git clean -fdx dist', route: 'sent', at: T0 };
  it('the 2.1.299 Write preview paints a relative path: with no live entry the main thread\'s own ask stands, its surface and its hold', async () => {
    const menu = parseDialog(WRITE)!;
    expect(mod.paintedApprovalOf({ ask: write, updatedAt: T0 }, menu, T0)).toEqual({ ask: write, entry: null });
    const c = carrier();
    const main = c.approval('', Date.now(), '/rig/project-a/src/notes.md');
    const v = await c.q.raise(rec(CHILD), menu, hook(write, T0, []), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(CHILD)?.rowIds).toEqual([main]);
  });
  it('the same menu with a sibling\'s live entry answers none: no surface, no hold', async () => {
    const menu = parseDialog(WRITE)!;
    expect(mod.paintedApprovalOf({ ask: write, updatedAt: T0, approvals: [sibling] }, menu, T0)).toEqual({ ask: null, entry: null });
    const c = carrier();
    c.approval('', Date.now(), '/rig/project-a/src/notes.md');
    expect(await c.q.raise(rec(CHILD), menu, hook(write, T0, [sibling]), null, [])).toEqual({ kind: 'none' });
  });
});

describe('the wire keeps the subagent mark (wireHookAsk)', () => {
  it('a painted subagent envelope leaves with `thread: subagent`, its summary redacted as ever', () => {
    const painted = mod.paintedApprovalOf({ ask: null, updatedAt: 1, approvals: [entryA(1)] }, MENU_A, 1);
    expect(wireHookAsk(painted.ask!)).toEqual({ approval: { tool: 'Bash', summary: 'rm -rf build', thread: 'subagent' } });
  });
  it('hook state\'s own envelope leaves exactly as before: no mark', () => {
    expect(wireHookAsk(approvalAsk('rm -rf build'))).toEqual({ approval: { tool: 'Bash', summary: 'rm -rf build' } });
  });
});
