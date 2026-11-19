// The per-agent approval envelope's two deciders, case by case (approvals plan 2026-11-18, §3.2.2 and Task 2.1):
// `approvalEntryFor` (which subagent entry, if any, is the prompt the pane paints) and `paintedApprovalOf` (the envelope
// every reader of the painted prompt takes: that entry, else hook state's own `ask`). One list of named cases, run by
// `approval-envelope.test.ts` and by the mutation floors' `approvalEnvelopeSets.ts` over a mutated copy of the module.
// Neutral fixtures only.
import { expect } from 'vitest';
import type { Dialog, HookAsk } from '../../shared/api.js';
import type { HookApprovalEntry, PaintedApproval } from '../src/coord/approvalEnvelope.js';

type Menu = Pick<Dialog, 'title' | 'body' | 'parsed' | 'options' | 'ask' | 'multi'>;
export interface ApprovalEnvelopeModule {
  approvalEntryFor(entries: readonly HookApprovalEntry[], dialog: Menu | null): HookApprovalEntry | null;
  paintedApprovalOf(hs: { readonly ask: HookAsk | null; readonly approvals: readonly HookApprovalEntry[] } | null, dialog: Menu | null): PaintedApproval;
  readonly APPROVAL_MATCH_CHARS: number;
  readonly HOOK_APPROVALS_MAX: number;
}

const YES_NO = [{ index: 1, label: 'Yes' }, { index: 2, label: 'No, and tell Claude what to do differently' }];
/** A Bash permission prompt as the pane paints it: the command under the tool's header, wrapped where the pane wraps it. */
const menu = (command: string, over: Partial<Menu> = {}): Menu => ({
  title: 'Bash command', body: `Tip: auto mode handles these prompts for you\n\n  ${command}\n  Run it\n\nDo you want to proceed?`,
  parsed: true, options: YES_NO, ...over,
});
const entry = (agentId: string, summary: string, at: number, over: Partial<HookApprovalEntry> = {}): HookApprovalEntry =>
  ({ agentId, tool: 'Bash', summary, at, route: 'sent', ...over });
const A = entry('agent-a', 'rm -rf scratch/out', 100);
const B = entry('agent-b', 'git clean -fdx build', 200);
const MAIN_Q: HookAsk = { questions: [{ question: 'Which way?', options: [{ label: 'Left' }, { label: 'Right' }] }] };
const MAIN_APPROVAL: HookAsk = { approval: { tool: 'Bash', summary: 'npm test', route: 'sent' } };

export interface EnvelopeCase { readonly name: string; run(m: ApprovalEnvelopeModule): void }

export const APPROVAL_ENVELOPE_CASES: readonly EnvelopeCase[] = [
  { name: 'the bounds: 60 characters to match, 16 entries kept', run: (m) => {
    expect(m.APPROVAL_MATCH_CHARS).toBe(60);
    expect(m.HOOK_APPROVALS_MAX).toBe(16);
  } },
  { name: 'the entry whose command the menu paints is the one', run: (m) => {
    expect(m.approvalEntryFor([A, B], menu('rm -rf scratch/out'))).toBe(A);
    expect(m.approvalEntryFor([A, B], menu('git clean -fdx build'))).toBe(B);
  } },
  { name: 'no entry, no menu, or a menu with no matching command: none', run: (m) => {
    expect(m.approvalEntryFor([], menu('rm -rf scratch/out'))).toBeNull();
    expect(m.approvalEntryFor([A], null)).toBeNull();
    expect(m.approvalEntryFor([A], menu('ls -la'))).toBeNull();
  } },
  { name: 'a menu that is not a permission prompt matches nothing (an AskUserQuestion, a /model confirm, an unparsed pane)', run: (m) => {
    expect(m.approvalEntryFor([A], menu('rm -rf scratch/out', { options: [{ index: 1, label: 'Left' }, { index: 2, label: 'Right' }] }))).toBeNull();
    expect(m.approvalEntryFor([A], menu('rm -rf scratch/out', { parsed: false }))).toBeNull();
    expect(m.approvalEntryFor([A], menu('rm -rf scratch/out', { ask: { question: 'q', multiSelect: false, options: [] } }))).toBeNull();
  } },
  { name: 'the pane\'s wrap, mid-word too, still matches: whitespace is removed on both sides', run: (m) => {
    const long = entry('agent-c', 'cp -r /work/project-a/some/deeply/nested/directory/with/files /work/project-a/elsewhere/copy', 300);
    expect(m.approvalEntryFor([long], menu('cp -r /work/project-a/some/deeply/nest\n    ed/directory/with/files\n    /work/project-a/elsewhere/copy'))).toBe(long);
  } },
  { name: 'only the summary\'s first 60 characters must be painted (a long command the pane cuts still matches)', run: (m) => {
    const long = entry('agent-c', `echo ${'x'.repeat(70)} tail-that-the-pane-cut`, 300);
    expect(m.approvalEntryFor([long], menu(`echo ${'x'.repeat(70)}`))).toBe(long);
    expect(m.approvalEntryFor([long], menu(`echo ${'x'.repeat(50)}`)), 'fewer than 60 characters painted').toBeNull();
  } },
  { name: 'an entry with an empty summary matches nothing: there is no text to tie it to the pane', run: (m) => {
    expect(m.approvalEntryFor([entry('agent-e', '', 1)], menu('anything'))).toBeNull();
    expect(m.approvalEntryFor([entry('agent-e', '  \n ', 1)], menu('anything'))).toBeNull();
  } },
  { name: 'two entries with the same command: the newest wins, whatever their order', run: (m) => {
    const older = entry('agent-a', 'npm run build', 100);
    const newer = entry('agent-b', 'npm run build', 200);
    expect(m.approvalEntryFor([older, newer], menu('npm run build'))).toBe(newer);
    expect(m.approvalEntryFor([newer, older], menu('npm run build'))).toBe(newer);
  } },
  { name: 'one whose tool the menu names beats a newer one whose tool it does not', run: (m) => {
    const bash = entry('agent-a', 'scratch/out', 100);
    const other = entry('agent-b', 'scratch/out', 200, { tool: 'Write' });
    expect(m.approvalEntryFor([bash, other], menu('scratch/out'))).toBe(bash);
    expect(m.approvalEntryFor([other, bash], menu('scratch/out'))).toBe(bash);
    const blank = entry('agent-c', 'scratch/out', 300, { tool: '' });
    expect(m.approvalEntryFor([bash, blank], menu('scratch/out')), 'an empty tool names nothing').toBe(bash);
  } },
  { name: 'painted: a matching entry is the envelope, marked a subagent\'s, whatever hook state\'s ask says', run: (m) => {
    const want = { ask: { approval: { tool: 'Bash', summary: 'rm -rf scratch/out', route: 'sent', thread: 'subagent' } }, entry: A };
    expect(m.paintedApprovalOf({ ask: null, approvals: [A] }, menu('rm -rf scratch/out'))).toEqual(want);
    expect(m.paintedApprovalOf({ ask: MAIN_Q, approvals: [A] }, menu('rm -rf scratch/out'))).toEqual(want);
    expect(m.paintedApprovalOf({ ask: MAIN_APPROVAL, approvals: [A] }, menu('rm -rf scratch/out'))).toEqual(want);
  } },
  { name: 'painted: an entry with no route word carries none', run: (m) => {
    const bare: HookApprovalEntry = { agentId: 'agent-a', tool: 'Bash', summary: 'rm -rf scratch/out', at: 1 };
    expect(m.paintedApprovalOf({ ask: null, approvals: [bare] }, menu('rm -rf scratch/out')).ask)
      .toEqual({ approval: { tool: 'Bash', summary: 'rm -rf scratch/out', thread: 'subagent' } });
  } },
  { name: 'painted: no matching entry leaves hook state\'s own ask exactly as it was', run: (m) => {
    expect(m.paintedApprovalOf({ ask: MAIN_APPROVAL, approvals: [A] }, menu('npm test'))).toEqual({ ask: MAIN_APPROVAL, entry: null });
    expect(m.paintedApprovalOf({ ask: MAIN_Q, approvals: [] }, null)).toEqual({ ask: MAIN_Q, entry: null });
    expect(m.paintedApprovalOf({ ask: null, approvals: [A] }, null)).toEqual({ ask: null, entry: null });
  } },
  { name: 'painted: no hook state is no envelope', run: (m) => {
    expect(m.paintedApprovalOf(null, menu('rm -rf scratch/out'))).toEqual({ ask: null, entry: null });
  } },
];
