// The per-agent approval envelope's two deciders, case by case (approvals plan 2026-11-18, §3.2.2 and Task 2.1; review 2752
// F1, F2 and F7; review 2774 F1 to F5; review 2800 F1 to F5): `approvalEntryFor` (which subagent entry, if any, is the prompt the pane paints, honestly and recently) and
// `paintedApprovalOf` (the envelope every converted reader of the painted prompt takes: hook state's own matching `ask`
// first, then that entry, else hook state's own `ask`). One list of named cases, run by `approval-envelope.test.ts` and by
// the mutation floors' `approvalEnvelopeSets.ts` over a mutated copy of the module. Neutral fixtures only.
import { expect } from 'vitest';
import type { Dialog, HookAsk } from '../../shared/api.js';
import type { HookApprovalEntry, PaintedApproval, PaintedHookState } from '../src/coord/approvalEnvelope.js';

type Menu = Pick<Dialog, 'title' | 'body' | 'parsed' | 'options' | 'ask' | 'multi'>;
export interface ApprovalEnvelopeModule {
  approvalEntryFor(entries: readonly HookApprovalEntry[], dialog: Menu | null, now: number): HookApprovalEntry | null;
  paintedApprovalOf(hs: PaintedHookState | null, dialog: Menu | null, now: number): PaintedApproval;
  readonly APPROVAL_MATCH_CHARS: number;
  readonly APPROVAL_MATCH_MIN_CHARS: number;
  readonly APPROVAL_ENTRY_MAX_AGE_MS: number;
  readonly APPROVAL_MENU_ANSWER_MS: number;
  readonly APPROVAL_ENTRY_MAX_AHEAD_MS: number;
  readonly HOOK_APPROVALS_MAX: number;
}

const YES_NO = [{ index: 1, label: 'Yes' }, { index: 2, label: 'No, and tell Claude what to do differently' }];
/** A permission prompt as the pane paints it: the command under the tool's header, wrapped where the pane wraps it, and a
 *  description line under it. */
const menu = (command: string, over: Partial<Menu> = {}, description = 'Run it'): Menu => ({
  title: 'Bash command', body: `Tip: auto mode handles these prompts for you\n\n  ${command}\n  ${description}\n\nDo you want to proceed?`,
  parsed: true, options: YES_NO, ...over,
});
/** The two shapes Claude Code paints a Bash prompt in, as `parseDialog` reads them (`approval-envelope.test.ts` pins both
 *  against the real captures). cc280 (`fixtures/panes/cc280-permission.txt`): the command's rows and then its description,
 *  indented, the body's first row trimmed by the parser. 2.1.299 (`pwa/test/fixtures/drawer/recorded/2.1.299/
 *  permission.json`): the description first, then the command's rows between dashed rules, each behind a gutter. */
export const cc280Body = (rows: readonly string[], description: string): string => [rows[0] ?? '',
  ...rows.slice(1).map((r) => (r === '' ? '' : `   ${r}`)), `   ${description}`, '',
  ' Permission rule Bash requires confirmation for this command.', ' /permissions to update rules', '', ' Do you want to proceed?'].join('\n');
const DASHED = '╌'.repeat(220);
export const r299Body = (rows: readonly string[], description: string): string => [
  'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below', ` ${description}`, DASHED,
  ...rows.map((r) => ` │ ${r}`), DASHED, ' Do you want to proceed?'].join('\n');
const shaped = (body: string): Menu => ({ title: 'Bash command', body, parsed: true, options: YES_NO });
/** A shared head of 70 non-space characters: siblings that `cd` into one long worktree path before every command. */
const WT = 'cd /work/project-a/worktrees/feature-a-rather-long-branch-name/server && ';
/** The clock every case reads at: entries stamped 100 to 300 are seconds old, never near the age bound. */
const NOW = 10_000;
const entry = (agentId: string, summary: string, at: number, over: Partial<HookApprovalEntry> = {}): HookApprovalEntry =>
  ({ agentId, tool: 'Bash', summary, at, route: 'sent', ...over });
const A = entry('agent-a', 'rm -rf scratch/out', 100);
const B = entry('agent-b', 'git clean -fdx build', 200);
const MAIN_Q: HookAsk = { questions: [{ question: 'Which way?', options: [{ label: 'Left' }, { label: 'Right' }] }] };
const MAIN_APPROVAL: HookAsk = { approval: { tool: 'Bash', summary: 'npm test', route: 'sent' } };
/** Hook state as the decider reads it: `updatedAt` is the stamp of the write that set `ask`. */
const hs = (ask: HookAsk | null, approvals?: readonly HookApprovalEntry[], over: Partial<PaintedHookState> = {}): PaintedHookState =>
  ({ ask, updatedAt: NOW, ...(approvals === undefined ? {} : { approvals }), ...over });
/** The age bound: the hook's longest wait (540 s) and then 15 minutes to answer. */
const MAX_AGE = 540_000 + 15 * 60_000;
const asSubagent = (e: HookApprovalEntry): PaintedApproval => ({
  ask: { approval: { tool: e.tool, summary: e.summary, ...(e.route === undefined ? {} : { route: e.route }), thread: 'subagent' } }, entry: e,
});

export interface EnvelopeCase { readonly name: string; run(m: ApprovalEnvelopeModule): void }

export const APPROVAL_ENVELOPE_CASES: readonly EnvelopeCase[] = [
  { name: 'the bounds: 60 characters to match, 12 to match by substring, the wait and 15 minutes of age, a minute ahead, 16 kept', run: (m) => {
    expect(m.APPROVAL_MATCH_CHARS).toBe(60);
    expect(m.APPROVAL_MATCH_MIN_CHARS).toBe(12);
    expect(m.APPROVAL_MENU_ANSWER_MS).toBe(15 * 60_000);
    expect(m.APPROVAL_ENTRY_MAX_AGE_MS).toBe(MAX_AGE);
    expect(m.APPROVAL_ENTRY_MAX_AHEAD_MS).toBe(60_000);
    expect(m.HOOK_APPROVALS_MAX).toBe(16);
  } },
  { name: 'the entry whose command the menu paints is the one', run: (m) => {
    expect(m.approvalEntryFor([A, B], menu('rm -rf scratch/out'), NOW)).toBe(A);
    expect(m.approvalEntryFor([A, B], menu('git clean -fdx build'), NOW)).toBe(B);
  } },
  { name: 'no entry, no menu, or a menu with no matching command: none', run: (m) => {
    expect(m.approvalEntryFor([], menu('rm -rf scratch/out'), NOW)).toBeNull();
    expect(m.approvalEntryFor([A], null, NOW)).toBeNull();
    expect(m.approvalEntryFor([A], menu('ls -la'), NOW)).toBeNull();
  } },
  { name: 'a menu that is not a permission prompt matches nothing (an AskUserQuestion, a /model confirm, an unparsed pane)', run: (m) => {
    expect(m.approvalEntryFor([A], menu('rm -rf scratch/out', { options: [{ index: 1, label: 'Left' }, { index: 2, label: 'Right' }] }), NOW)).toBeNull();
    expect(m.approvalEntryFor([A], menu('rm -rf scratch/out', { parsed: false }), NOW)).toBeNull();
    expect(m.approvalEntryFor([A], menu('rm -rf scratch/out', { ask: { question: 'q', multiSelect: false, options: [] } }), NOW)).toBeNull();
  } },
  { name: 'the command is read from the title or the body', run: (m) => {
    expect(m.approvalEntryFor([A], menu('', { title: 'rm -rf scratch/out' }), NOW)).toBe(A);
    expect(m.approvalEntryFor([A], { ...menu(''), title: 'Bash command', body: '  rm -rf scratch/out' }, NOW)).toBe(A);
    const ls = entry('agent-a', 'ls', 100);
    expect(m.approvalEntryFor([ls], { ...menu(''), title: 'Bash command', body: '  ls' }, NOW), 'a block with no description').toBe(ls);
  } },
  { name: 'the pane\'s wrap, mid-word too, still matches: whitespace is removed on both sides', run: (m) => {
    const long = entry('agent-c', 'cp -r /work/project-a/some/deeply/nested/directory/with/files /work/project-a/elsewhere/copy', 300);
    expect(m.approvalEntryFor([long], menu('cp -r /work/project-a/some/deeply/nest\n    ed/directory/with/files\n    /work/project-a/elsewhere/copy'), NOW)).toBe(long);
  } },
  { name: 'a long summary\'s first 60 characters must be painted (a long command the pane cuts still matches)', run: (m) => {
    const long = entry('agent-c', `echo ${'x'.repeat(70)} tail-that-the-pane-cut`, 300);
    expect(m.approvalEntryFor([long], menu(`echo ${'x'.repeat(70)}`), NOW)).toBe(long);
    expect(m.approvalEntryFor([long], menu(`echo ${'x'.repeat(55)}`), NOW), 'fewer than 60 characters painted').toBeNull();
  } },
  { name: 'a summary under 60 characters must appear whole', run: (m) => {
    const mid = entry('agent-c', 'git log --oneline --graph --decorate', 300);
    expect(m.approvalEntryFor([mid], menu('git log --oneline --graph --decorate'), NOW)).toBe(mid);
    expect(m.approvalEntryFor([mid], menu('git log --oneline --graph'), NOW), 'only its head painted').toBeNull();
  } },
  { name: 'a summary under 12 characters matches only as the menu\'s whole command text (git status against git status --short)', run: (m) => {
    const short = entry('agent-c', 'git status', 300);
    expect(m.approvalEntryFor([short], menu('git status --short'), NOW)).toBeNull();
    expect(m.approvalEntryFor([short], menu('cd sub && git status'), NOW)).toBeNull();
    expect(m.approvalEntryFor([short], menu('git status'), NOW)).toBe(short);
    expect(m.approvalEntryFor([entry('agent-c', 'ls', 300)], menu('ls'), NOW)).toEqual(entry('agent-c', 'ls', 300));
    const shortLong = entry('agent-d', 'git status --short', 200);
    expect(m.approvalEntryFor([short, shortLong], menu('git status --short'), NOW)).toBe(shortLong);
  } },
  { name: 'a short command the pane wrapped is still the menu\'s whole command text', run: (m) => {
    const short = entry('agent-c', 'git status', 300);
    expect(m.approvalEntryFor([short], menu('git st\n    atus'), NOW)).toBe(short);
    expect(m.approvalEntryFor([short], menu('git st\n    atus --short'), NOW)).toBeNull();
  } },
  { name: 'an entry with an empty summary matches nothing: there is no text to tie it to the pane', run: (m) => {
    expect(m.approvalEntryFor([entry('agent-e', '', 1)], menu('anything'), NOW)).toBeNull();
    expect(m.approvalEntryFor([entry('agent-e', '  \n ', 1)], menu('anything'), NOW)).toBeNull();
    expect(m.approvalEntryFor([entry('agent-e', '', 1)], { ...menu(''), body: '  rm -rf scratch/out' }, NOW), 'a one-row block less its row').toBeNull();
  } },
  { name: 'a prefix pair: the exact one wins, not the newer shorter one (npm run build against npm run)', run: (m) => {
    const build = entry('agent-a', 'npm run build', 100);
    const prefix = entry('agent-b', 'npm run', 200);
    expect(m.approvalEntryFor([build, prefix], menu('npm run build'), NOW)).toBe(build);
    expect(m.approvalEntryFor([prefix, build], menu('npm run build'), NOW)).toBe(build);
    expect(m.approvalEntryFor([build, prefix], menu('npm run'), NOW)).toBe(prefix);
  } },
  { name: 'an exact match beats a longer one that is not exact, under 60 characters', run: (m) => {
    const exact = entry('agent-a', 'npm run release-candidate', 100);
    const longer = entry('agent-b', 'npm run release-candidate --wa', 200);
    expect(m.approvalEntryFor([exact, longer], menu('npm run release-candidate --watch'), NOW), 'neither is the block').toBe(longer);
    const block = entry('agent-c', 'npm run release-candidate --watch', 50);
    expect(m.approvalEntryFor([longer, block], menu('npm run release-candidate --watch'), NOW)).toBe(block);
    expect(m.approvalEntryFor([block, longer], menu('npm run release-candidate --watch'), NOW)).toBe(block);
    const spill = entry('agent-d', 'npm run release-candidate --watch Run it Do you', 300);
    expect(m.approvalEntryFor([block, spill], menu('npm run release-candidate --watch'), NOW), 'a longer, newer match into the next line').toBe(block);
  } },
  { name: 'exact means the command block: one line inside a script is not it (review 2774 C3)', run: (m) => {
    const script = ['set -e', 'npm ci', 'npm test', 'npm run lint', `node scripts/publish.mjs --tag next --dry-run=false ${'x'.repeat(150)}`].join('\n');
    const a = entry('agent-a', Array.from(script).slice(0, 200).join(''), 100);
    const b = entry('agent-b', 'npm test', 200);
    const painted = menu(script.split('\n').join('\n  '), {}, 'Publish the packages');
    expect(m.approvalEntryFor([a, b], painted, NOW)).toBe(a);
    expect(m.approvalEntryFor([b], painted, NOW), 'a body line is no command block').toBeNull();
    expect(m.approvalEntryFor([entry('agent-b', 'set -e', 200)], painted, NOW), 'nor is the block\'s first line').toBeNull();
  } },
  { name: 'a short exact match never outranks a 60-character one (review 2774 C3, the block\'s other reading)', run: (m) => {
    const long = `npm test\n${'node scripts/check.mjs --all '.repeat(10)}`;
    const a = entry('agent-a', Array.from(long).slice(0, 200).join(''), 100);
    const b = entry('agent-b', 'npm test', 200);
    const undescribed: Menu = { title: 'Bash command', body: `  ${long.split('\n').join('\n  ')}\n\nDo you want to proceed?`, parsed: true, options: YES_NO };
    expect(m.approvalEntryFor([b], undescribed, NOW), 'alone, the block less its last line').toBe(b);
    expect(m.approvalEntryFor([a, b], undescribed, NOW)).toBe(a);
    expect(m.approvalEntryFor([b, a], undescribed, NOW)).toBe(a);
  } },
  { name: 'the longest match beats a newer shorter one, when neither is exact', run: (m) => {
    const longer = entry('agent-a', 'npm run build:all-packages --watch', 100);
    const shorter = entry('agent-b', 'npm run build:all-packages', 200);
    expect(m.approvalEntryFor([longer, shorter], menu('cd /work && npm run build:all-packages --watch'), NOW)).toBe(longer);
  } },
  { name: 'two entries with the same command: the newest wins, whatever their order', run: (m) => {
    const older = entry('agent-a', 'npm run build', 100);
    const newer = entry('agent-b', 'npm run build', 200);
    expect(m.approvalEntryFor([older, newer], menu('npm run build'), NOW)).toBe(newer);
    expect(m.approvalEntryFor([newer, older], menu('npm run build'), NOW)).toBe(newer);
  } },
  { name: 'one whose tool the menu names beats a newer one whose tool it does not', run: (m) => {
    const bash = entry('agent-a', 'scratch/out', 100);
    const other = entry('agent-b', 'scratch/out', 200, { tool: 'Write' });
    expect(m.approvalEntryFor([bash, other], menu('scratch/out'), NOW)).toBe(bash);
    expect(m.approvalEntryFor([other, bash], menu('scratch/out'), NOW)).toBe(bash);
    const blank = entry('agent-c', 'scratch/out', 300, { tool: '' });
    expect(m.approvalEntryFor([bash, blank], menu('scratch/out'), NOW), 'an empty tool names nothing').toBe(bash);
  } },
  { name: 'an entry older than the hook\'s wait and 15 minutes is ignored; one at the bound is not', run: (m) => {
    const at = 1_000_000;
    const e = entry('agent-a', 'rm -rf scratch/out', at);
    expect(m.approvalEntryFor([e], menu('rm -rf scratch/out'), at + 540_000 + 15 * 60_000)).toBe(e);
    expect(m.approvalEntryFor([e], menu('rm -rf scratch/out'), at + 540_000 + 15 * 60_000 + 1)).toBeNull();
    expect(m.paintedApprovalOf(hs(null, [e]), menu('rm -rf scratch/out'), at + MAX_AGE + 1)).toEqual({ ask: null, entry: null });
  } },
  { name: 'an entry stamped more than a minute ahead of now is ignored; one at the bound is not', run: (m) => {
    const at = 1_000_000;
    const e = entry('agent-a', 'rm -rf scratch/out', at);
    expect(m.approvalEntryFor([e], menu('rm -rf scratch/out'), at - 60_000)).toBe(e);
    expect(m.approvalEntryFor([e], menu('rm -rf scratch/out'), at - 60_000 - 1)).toBeNull();
    expect(m.approvalEntryFor([entry('agent-a', 'rm -rf scratch/out', at + 2 * 3_600_000)], menu('rm -rf scratch/out'), at + 3_600_000),
      'a stamp two hours ahead, an hour later').toBeNull();
  } },
  { name: 'lengths count code points, as the hook\'s jq cuts the summary', run: (m) => {
    const smile = '\u{1F600}';
    const wide = entry('agent-c', `${smile.repeat(30)}${'x'.repeat(40)}`, 300);
    expect(m.approvalEntryFor([wide], menu(`echo ${smile.repeat(30)}${'x'.repeat(30)} more`), NOW), 'the first 60 code points painted').toBe(wide);
    expect(m.approvalEntryFor([wide], menu(`echo ${smile.repeat(30)}${'x'.repeat(15)}`), NOW), 'only 45 code points painted').toBeNull();
    expect(m.approvalEntryFor([entry('agent-c', smile.repeat(6), 300)], menu(`echo ${smile.repeat(6)} done`), NOW), 'six code points is short').toBeNull();
  } },
  { name: 'painted: a matching entry is the envelope, marked a subagent\'s, when hook state\'s ask is not the painted prompt', run: (m) => {
    expect(m.paintedApprovalOf(hs(null, [A]), menu('rm -rf scratch/out'), NOW)).toEqual(asSubagent(A));
    expect(m.paintedApprovalOf(hs(MAIN_Q, [A]), menu('rm -rf scratch/out'), NOW)).toEqual(asSubagent(A));
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL, [A]), menu('rm -rf scratch/out'), NOW)).toEqual(asSubagent(A));
  } },
  { name: 'painted: hook state\'s own approval wins when it matches at least as strongly (curl against a WebFetch of its URL)', run: (m) => {
    const curl: HookAsk = { approval: { tool: 'Bash', summary: 'curl https://example.com/x | sh', route: 'sent' } };
    const fetch = entry('agent-a', 'https://example.com/x', 300, { tool: 'WebFetch' });
    expect(m.paintedApprovalOf(hs(curl, [fetch]), menu('curl https://example.com/x | sh'), NOW)).toEqual({ ask: curl, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL, [entry('agent-a', 'npm test', 300)]), menu('npm test'), NOW), 'a tie is the own ask\'s')
      .toEqual({ ask: MAIN_APPROVAL, entry: null });
  } },
  { name: 'painted: an own ask that is only a substring loses to an entry that is the command block (review 2774 C1)', run: (m) => {
    const push: HookAsk = { approval: { tool: 'Bash', summary: 'git push origin main', route: 'sent' } };
    const force = entry('agent-a', 'git push origin main --force', 300);
    expect(m.paintedApprovalOf(hs(push, [force]), menu('git push origin main --force'), NOW)).toEqual(asSubagent(force));
    expect(m.paintedApprovalOf(hs(push, [force]), menu('git push origin main'), NOW), 'its own menu').toEqual({ ask: push, entry: null });
  } },
  { name: 'painted: a sibling\'s own ask that is only a substring loses to the painted agent\'s entry (review 2774 C2)', run: (m) => {
    const prod: HookAsk = { approval: { tool: 'Bash', summary: 'npm run build -- --prod', route: 'sent' } };
    const b = entry('agent-b', 'npm run build -- --prod', NOW);
    const a = entry('agent-a', 'npm run build -- --prod && npm publish', 100);
    expect(m.paintedApprovalOf(hs(prod, [a, b], { waitBy: 'subagent' }), menu('npm run build -- --prod && npm publish'), NOW)).toEqual(asSubagent(a));
    expect(m.paintedApprovalOf(hs(prod, [a, b], { waitBy: 'subagent' }), menu('npm run build -- --prod'), NOW), 'its own menu').toEqual(asSubagent(b));
  } },
  { name: 'painted: a subagent\'s own ask and the entry the same write added are one prompt, and the entry is taken', run: (m) => {
    const ask: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf scratch/out', route: 'sent' } };
    const own = hs(ask, [B, A], { waitBy: 'subagent', updatedAt: A.at });
    expect(m.paintedApprovalOf(own, menu('rm -rf scratch/out'), NOW)).toEqual(asSubagent(A));
    const other = entry('agent-c', 'rm -rf scratch/out', 50);
    expect(m.paintedApprovalOf({ ...own, approvals: [other, A] }, menu('rm -rf scratch/out'), NOW), 'not another agent\'s identical one')
      .toEqual(asSubagent(A));
    expect(m.paintedApprovalOf({ ...own, approvals: [other] }, menu('rm -rf scratch/out'), NOW), 'its own entry gone: no entry')
      .toEqual({ ask, entry: null });
    expect(m.paintedApprovalOf({ ...own, approvals: [{ ...A, tool: 'Write' }] }, menu('rm -rf scratch/out'), NOW), 'another tool is another call')
      .toEqual({ ask, entry: null });
    expect(m.paintedApprovalOf({ ...own, approvals: [{ ...A, summary: 'rm -rf elsewhere' }] }, menu('rm -rf scratch/out'), NOW),
      'another command is another call').toEqual({ ask, entry: null });
    const stale = entry('agent-a', 'rm -rf scratch/out', 1);
    expect(m.paintedApprovalOf(hs(ask, [stale], { waitBy: 'subagent', updatedAt: 1 }), menu('rm -rf scratch/out'), 1 + MAX_AGE),
      'its own entry at the age bound').toEqual(asSubagent(stale));
    expect(m.paintedApprovalOf(hs(ask, [stale], { waitBy: 'subagent', updatedAt: 1 }), menu('rm -rf scratch/out'), 2 + MAX_AGE),
      'past it: the same age rule, no entry').toEqual({ ask, entry: null });
    expect(m.paintedApprovalOf(hs(ask, [A], { updatedAt: A.at }), menu('rm -rf scratch/out'), NOW), 'the main thread\'s ask: no subagent\'s')
      .toEqual({ ask, entry: null });
  } },
  { name: 'painted: an entry with no route word carries none', run: (m) => {
    const bare: HookApprovalEntry = { agentId: 'agent-a', tool: 'Bash', summary: 'rm -rf scratch/out', at: 1 };
    expect(m.paintedApprovalOf(hs(null, [bare]), menu('rm -rf scratch/out'), NOW).ask)
      .toEqual({ approval: { tool: 'Bash', summary: 'rm -rf scratch/out', thread: 'subagent' } });
  } },
  { name: 'painted: an own approval the permission prompt does not match is no envelope when another agent\'s live entry exists (review 2800 F5)', run: (m) => {
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL, [A]), menu('ls -la'), NOW)).toEqual({ ask: null, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL), menu('rm -rf scratch/out'), NOW), 'no list: as before').toEqual({ ask: MAIN_APPROVAL, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL, [entry('agent-a', 'rm -rf scratch/out', NOW - MAX_AGE - 1)]), menu('ls -la'), NOW),
      'a stale entry competes with nothing').toEqual({ ask: MAIN_APPROVAL, entry: null });
    const ask: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf scratch/out', route: 'sent' } };
    expect(m.paintedApprovalOf(hs(ask, [A], { waitBy: 'subagent', updatedAt: A.at }), menu('ls -la'), NOW), 'its own entry is no other agent\'s')
      .toEqual({ ask, entry: null });
    expect(m.paintedApprovalOf(hs(ask, [A, B], { waitBy: 'subagent', updatedAt: A.at }), menu('ls -la'), NOW), 'a sibling\'s is')
      .toEqual({ ask: null, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL), menu('npm test'), NOW), 'control: its own menu').toEqual({ ask: MAIN_APPROVAL, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_Q, [A]), menu('ls -la'), NOW), 'a question envelope stands').toEqual({ ask: MAIN_Q, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_Q, []), null, NOW)).toEqual({ ask: MAIN_Q, entry: null });
    expect(m.paintedApprovalOf(hs(MAIN_APPROVAL, [A], { waitBy: 'subagent' }), null, NOW), 'no menu: as before').toEqual({ ask: MAIN_APPROVAL, entry: null });
    expect(m.paintedApprovalOf(hs(null, [A]), null, NOW)).toEqual({ ask: null, entry: null });
  } },
  { name: 'an ambiguous tie shows no one: two agents\' commands share their first 60 characters, neither exact (review 2800 F1)', run: (m) => {
    const longA = `${WT}git push --force origin main ${'x'.repeat(200)}`;
    const a = entry('agent-a', Array.from(longA).slice(0, 200).join(''), 100);
    const b = entry('agent-b', `${WT}npm test`, 200);
    const painted = menu(longA);
    expect(m.approvalEntryFor([a, b], painted, NOW)).toBeNull();
    expect(m.paintedApprovalOf(hs(null, [a, b]), painted, NOW)).toEqual({ ask: null, entry: null });
    expect(m.approvalEntryFor([a], painted, NOW), 'control: alone, it is the prompt').toBe(a);
    const a2 = entry('agent-a', `${WT}npm test`, 200);
    expect(m.approvalEntryFor([a, a2], painted, NOW), 'within one agent: the newest, as before').toBe(a2);
    const weak = entry('agent-b', 'git push --force origin main', 300);
    expect(m.approvalEntryFor([a, weak], painted, NOW), 'a weaker match of another agent ties nothing').toBe(a);
    const exactLong = `${WT}npm run build`;
    const e1 = entry('agent-a', exactLong, 100);
    const e2 = entry('agent-b', exactLong, 200);
    expect(m.approvalEntryFor([e1, e2], menu(exactLong), NOW), 'an exact tie is not this tier: the newest, as before').toBe(e2);
    const s1 = entry('agent-a', 'npm run build:all-packages', 100);
    const s2 = entry('agent-b', 'npm run build:all-packages', 200);
    expect(m.approvalEntryFor([s1, s2], menu('cd /work && npm run build:all-packages --watch'), NOW), 'nor is a tie under 60').toBe(s2);
  } },
  { name: 'an ambiguous tie with the own ask shows no one either: the main thread\'s, or a sibling\'s with its own entry (review 2800 F1)', run: (m) => {
    const longA = `${WT}git push --force origin main ${'x'.repeat(200)}`;
    const a = entry('agent-a', Array.from(longA).slice(0, 200).join(''), 100);
    const painted = menu(longA);
    const status: HookAsk = { approval: { tool: 'Bash', summary: `${WT}git status`, route: 'sent' } };
    expect(m.paintedApprovalOf(hs(status, [a]), painted, NOW)).toEqual({ ask: null, entry: null });
    const b = entry('agent-b', `${WT}npm test`, 200);
    const bAsk: HookAsk = { approval: { tool: 'Bash', summary: b.summary, route: 'sent' } };
    expect(m.paintedApprovalOf(hs(bAsk, [a, b], { waitBy: 'subagent', updatedAt: b.at }), painted, NOW)).toEqual({ ask: null, entry: null });
    const aAsk: HookAsk = { approval: { tool: 'Bash', summary: a.summary, route: 'sent' } };
    expect(m.paintedApprovalOf(hs(aAsk, [a], { waitBy: 'subagent', updatedAt: a.at }), painted, NOW), 'control: one agent, its own ask and entry')
      .toEqual(asSubagent(a));
    expect(m.paintedApprovalOf(hs(status, []), painted, NOW), 'control: no entry to tie with').toEqual({ ask: status, entry: null });
    expect(m.paintedApprovalOf(hs(status, [entry('agent-b', 'git push --force origin main', 300)]), painted, NOW), 'control: a weaker entry')
      .toEqual({ ask: status, entry: null });
  } },
  { name: 'the cc280 shape (measured): the command rows and the description are the block; the parser\'s trimmed first row belongs to it', run: (m) => {
    const echo = entry('agent-a', 'echo rigok', 100);
    expect(m.approvalEntryFor([echo], shaped(cc280Body(['echo rigok'], 'Print rigok')), NOW)).toBe(echo);
    expect(m.approvalEntryFor([entry('agent-a', 'echo', 100)], shaped(cc280Body(['echo rigok'], 'Print rigok')), NOW)).toBeNull();
    const old: Menu = shaped('rm -rf build\n   Remove the build directory\n Do you want to proceed?');
    expect(m.approvalEntryFor([entry('agent-a', 'rm -rf build', 100)], old, NOW), 'the no-blank-line pane').toEqual(entry('agent-a', 'rm -rf build', 100));
  } },
  { name: 'the 2.1.299 shape (measured): the rows between the dashed rules are the block, the gutter removed; the description is not', run: (m) => {
    const echo = entry('agent-a', 'echo rigok', 100);
    expect(m.approvalEntryFor([echo], shaped(r299Body(['echo rigok'], 'Print rigok')), NOW)).toBe(echo);
    expect(m.approvalEntryFor([entry('agent-a', 'Print rigok', 100)], shaped(r299Body(['echo rigok'], 'Print rigok')), NOW), 'the description').toBeNull();
    const wrapped = ['mkdir -p /rig/shared/project-a/build/cache/some/very/long/directory/path/that/keeps/going/and/going/until/it/wraps && echo',
      'the-build-cache-directory-for-project-a-is-ready-and-this-marker-is-long-enough-to-wrap-the-code-row-twice'];
    const long = entry('agent-a', wrapped.join(' '), 100);
    expect(m.approvalEntryFor([long], shaped(r299Body(wrapped, 'Create the build cache directory')), NOW)).toBe(long);
    const tail = entry('agent-b', `&& echo ${wrapped[1]!.slice(0, 50)}`, 200);
    expect(m.approvalEntryFor([long, tail], shaped(r299Body(wrapped, 'Create the build cache directory')), NOW)).toBe(long);
    expect(m.approvalEntryFor([tail], shaped(r299Body(wrapped, 'Create the build cache directory')), NOW), 'a wrap reads whole across the gutter')
      .toBe(tail);
    const clean = entry('agent-a', 'rm -rf dist', 100);
    const named = entry('agent-b', 'npm run build:prod', 200);
    expect(m.approvalEntryFor([clean, named], shaped(r299Body(['rm -rf dist'], 'Clean before npm run build:prod')), NOW), 'review 2800 G2')
      .toBe(clean);
  } },
  { name: 'a blank row inside a script ends no block: one part of a longer script is never exact (review 2800 F4)', run: (m) => {
    const script = entry('agent-a', 'npm test\n\nnpm run lint', 100);
    const part = entry('agent-b', 'npm test', 200);
    for (const body of [cc280Body(['npm test', '', 'npm run lint'], 'Test and lint'), r299Body(['npm test', '', 'npm run lint'], 'Test and lint'),
      `Tip: auto mode handles these prompts for you\n\n  npm test\n\n  npm run lint\n  Test and lint\n\nDo you want to proceed?`]) {
      expect(m.approvalEntryFor([script, part], shaped(body), NOW)).toBe(script);
      expect(m.approvalEntryFor([part, script], shaped(body), NOW)).toBe(script);
      expect(m.approvalEntryFor([part], shaped(body), NOW), 'alone').toBeNull();
    }
    const lsPwd = entry('agent-a', 'ls\n\npwd', 100);
    expect(m.approvalEntryFor([lsPwd], menu('ls\n\n  pwd', {}, 'List'), NOW), 'a short script across a blank row is its block').toBe(lsPwd);
    const cd = entry('agent-b', 'cd /tmp/x', 200);
    expect(m.approvalEntryFor([cd], shaped(cc280Body(['cd /tmp/x', '', 'git clean -fdx'], 'Clean')), NOW), 'P4d').toBeNull();
  } },
  { name: 'painted: hook state\'s own approval is not the prompt of a menu that is no permission prompt', run: (m) => {
    const ask: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf scratch/out', route: 'sent' } };
    const notPrompt = menu('rm -rf scratch/out', { options: [{ index: 1, label: 'Left' }, { index: 2, label: 'Right' }] });
    expect(m.paintedApprovalOf(hs(ask, [A], { waitBy: 'subagent', updatedAt: A.at }), notPrompt, NOW)).toEqual({ ask, entry: null });
  } },
  { name: 'painted: no hook state is no envelope', run: (m) => {
    expect(m.paintedApprovalOf(null, menu('rm -rf scratch/out'), NOW)).toEqual({ ask: null, entry: null });
  } },
];
