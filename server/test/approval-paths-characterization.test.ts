/**
 * Characterization of today's approval paths (plan 2026-11-18-overlord-approvals, Task 1.1 and Table 2a). It pins what a
 * child's permission prompt does TODAY, green on `main`, so a later change is checked against it. One `describe` per path:
 *
 *  1. the hook's silent gates (`ccd/session-hook.sh#_hook_approval_wait`): no stdout and no request, in a fixture HOME;
 *  2. the mint refusals of `createQuestions(...).raiseApproval`: each verdict kind, and no row minted;
 *  3. the rows minted `released`: each release reason, state `released`;
 *  4. the lapse: a held row past its `notifyAt` moves, and the deferred push goes through the sink;
 *  5. `holdApproval`'s main-thread filter, reached through `Questions.raise`.
 *
 * Pinned: the print, whether a request was sent, the verdict kinds, the states. Not pinned: the bytes of the hookstate
 * file, or the shape of its `ask.approval` envelope. The hook and the fixture rig are copied from
 * `session-hook-approval-wait.test.ts`, `approval-raise.test.ts` and `questions-carrier.test.ts`; fixture HOMEs only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { heldFor } from '../src/coord/heldFor.js';
import { rulingsAllowedHere } from '../src/coord/approvalsign.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import {
  createQuestions, questionsTestView, type ApprovalRaiseDeps, type ApprovalRaiseRequest, type ApprovalRaiseVerdict,
  type QuestionPush, type QuestionRules,
} from '../src/coord/questions.js';
import type { HookState } from '../src/hookstate.js';
import { parseDialog } from '../src/pane/dialog.js';
import type { SessionRecord } from '../src/registry.js';
import { testDeps } from './helpers.js';
import { CHILD, CHILD2, DUNE, FAR, PARENT, hookInput, requestBody, standardFixture, approvalCount, type Approvals } from './approvalsHarness.js';

// ── 1. the hook's silent gates ─────────────────────────────────────────────────────────────────────────────────────

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const VERIFY = path.resolve(__dirname, '../../ccd/approval-verify.mjs');
const CAPTURES = path.resolve(__dirname, 'fixtures/approvals/captures');
const GUARD = path.resolve(__dirname, 'fixtures/approvals/guard-corpus.json');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
const UUID = '00000000-0000-4000-8000-0000000000aa';
const DENY_FILE = '{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}\n';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

type Payload = Record<string, unknown> & { tool_input: Record<string, unknown> };
const doc = JSON.parse(fs.readFileSync(path.join(CAPTURES, '2.1.302', 'permission-main.json'), 'utf8')) as { events: Array<{ event: string; payload: Payload }> };
const MAIN = doc.events.find((e) => e.event === 'PermissionRequest')!.payload;
const FORBIDDEN = (JSON.parse(fs.readFileSync(GUARD, 'utf8')) as Array<{ tool: string; input: Record<string, unknown>; class: string }>)
  .find((r) => r.class === 'forbidden' && r.tool === 'Bash')!;

const ours = generateKeyPairSync('ed25519');
let home: string;
let transcript: string;

const STUB_API = `#!/usr/bin/env bash
d="$HOME/stub"
printf '%s\\n' "$*" >> "$d/calls"
case "$1 $2" in
  "approvals request") cat > "$d/request.body"; cat "$d/request.out"; printf 'http 201\\n' >&2 ;;
  "approvals ruling") echo '{"state":"declined"}'; printf 'http 200\\n' >&2 ;;
esac
exit 0
`;
const put = (rel: string, text: string, mode = 0o644): void => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { mode });
};
const reg = (rel: string): string => path.join(home, '.cc-sessions', rel);

beforeEach(() => {
  home = mkTmp('ccrc-aprpaths-');
  put(`.cc-sessions/${ID}.generation`, GENERATION);
  put(`.cc-sessions/${ID}.child`, '7');
  put(`.cc-sessions/${ID}.uuid`, `${UUID}\n`);
  put('.cc-sessions/child-deny.settings.json', DENY_FILE);
  put(`.cc-sessions/${ID}.deny-settings`, sha(DENY_FILE));
  fs.copyFileSync(VERIFY, reg('approval-verify.mjs'));
  put('.ccrc/approval-signing.pub', ours.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  put('bin/tmux', `#!/bin/sh\necho "cc-${ID}"\n`, 0o755);
  put('.local/bin/ccrc-api', STUB_API, 0o755);
  put('stub/request.out', '{"id":41,"waitS":1}');
  transcript = path.join(home, 'cfg', 'projects', '-rig-proj', 'main.jsonl');
  put(path.relative(home, transcript), '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
  CCRC_APPROVAL_TICK_S: '0.05', CCRC_APPROVAL_POLL_TICKS: '2', CCRC_APPROVAL_CEILING_S: '4',
});
const fire = (over: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = ENV()): { stdout: string; calls: string[] } => {
  const payload = { ...MAIN, transcript_path: transcript, ...over };
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 30_000 });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const calls = path.join(home, 'stub', 'calls');
  return { stdout: r.stdout, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [] };
};
const silent = (r: { stdout: string; calls: string[] }): void => {
  expect(r.stdout, 'nothing on stdout').toBe('');
  expect(r.calls, 'no request was sent').toEqual([]);
};

describe('path 1: the hook returns silently before the request (Table 2a row 1; row 7 for the .child gate)', () => {
  it('positive control: every gate open sends the request', () => {
    const r = fire();
    expect(r.calls[0]).toMatch(/^approvals request /);
  });
  const gates: Array<[string, () => void]> = [
    ['not a child (no .child mark; path 7)', () => fs.rmSync(reg(`${ID}.child`))],
    ['the kill switch approvals-disabled', () => put('.cc-sessions/approvals-disabled', '')],
    ['the .deny-settings stamp absent', () => fs.rmSync(reg(`${ID}.deny-settings`))],
    ['the .deny-settings stamp malformed', () => put(`.cc-sessions/${ID}.deny-settings`, 'not-a-digest')],
    ['the .deny-settings stamp naming another digest', () => put(`.cc-sessions/${ID}.deny-settings`, 'c'.repeat(64))],
    ['the managed deny file absent', () => fs.rmSync(reg('child-deny.settings.json'))],
    ['the verifier file absent', () => fs.rmSync(reg('approval-verify.mjs'))],
    ['the pinned public key absent', () => fs.rmSync(path.join(home, '.ccrc', 'approval-signing.pub'))],
    ['the client not executable', () => fs.chmodSync(path.join(home, '.local', 'bin', 'ccrc-api'), 0o644)],
    ['the session uuid file absent', () => fs.rmSync(reg(`${ID}.uuid`))],
  ];
  it.each(gates)('%s: no output, no request', (_n, arrange) => {
    arrange();
    silent(fire());
  });
  it('a statically forbidden command (the hook\'s APPROVAL_FORBIDDEN_JQ match): no output, no request', () => {
    silent(fire({ tool_input: FORBIDDEN.input }));
  });
  it('node missing from PATH: no output, no request', () => {
    // Every PATH directory that holds `node` is replaced by a shadow of itself without it.
    const dirs = (ENV()['PATH'] ?? '').split(':').filter((d) => d !== '');
    const shadowed = dirs.map((d, i) => {
      if (!fs.existsSync(path.join(d, 'node'))) return d;
      const s = path.join(home, `shadow${i}`);
      fs.mkdirSync(s, { recursive: true });
      for (const n of fs.readdirSync(d)) if (n !== 'node') { try { fs.symlinkSync(path.join(d, n), path.join(s, n)); } catch { /* skip */ } }
      return s;
    });
    const env = { ...ENV(), PATH: shadowed.join(':') };
    expect(spawnSync('bash', ['-c', 'command -v node'], { env }).status, 'the harness PATH really has no node').not.toBe(0);
    silent(fire({}, env));
  });
  // Not pinned here: the canonical-form and nonce failures (rows of the same table). Neither can be forced from a
  // payload the hook routes on without first failing a gate above; the digest corpus in the wait suite covers the "none" rows.
});

// ── 2 and 3. raiseApproval: the mint refusals and the rows minted released ─────────────────────────────────────────

let f: (Approvals & { runId: number }) | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (f) await f.close(); f = undefined; });

const ORDINARY = hookInput({ command: 'rm -rf build' });
const NOW = Date.now();
const req = (input: Record<string, unknown> = ORDINARY, id = CHILD): ApprovalRaiseRequest => {
  const b = requestBody(input, id);
  return { sessionId: id, digest: b.digest, nonce: b.nonce, canonical: b.canonical };
};
const raiseDeps = (fx: Approvals, over: Partial<ApprovalRaiseDeps> = {}): ApprovalRaiseDeps => ({
  coord: fx.coord, io: fx.deps.io, cfg: fx.deps.cfg, tmux: fx.deps.tmux, masker: SHAPE_ONLY_MASKER,
  signerFor: () => ({}) as never, rulingsAllowedHere, heldFor,
  denyEngaged: async () => true, liveVersionOf: async () => '2.1.302', journalDigestMismatch: () => {},
  ...over,
});
const stateOf = (fx: Approvals, id: number): string =>
  (fx.coord.db.prepare('SELECT state FROM approvals WHERE id = ?').get(id) as { state: string }).state;

describe('path 2: refused at mint, nothing minted (Table 2a row 2)', () => {
  const refusals: Array<[string, (fx: Approvals) => Promise<ApprovalRaiseVerdict>, ApprovalRaiseVerdict['kind']]> = [
    ['single-box', (fx) => createQuestions({ coord: fx.coord }).raiseApproval(req(), raiseDeps(fx, { rulingsAllowedHere: () => false }), NOW), 'single-box'],
    ['internal (no signer)', (fx) => createQuestions({ coord: fx.coord }).raiseApproval(req(), raiseDeps(fx, { signerFor: () => null }), NOW), 'internal'],
    ['not-a-child (no child mark)', (fx) => createQuestions({ coord: fx.coord }).raiseApproval(req(ORDINARY, DUNE), raiseDeps(fx), NOW), 'not-a-child'],
    ['deny-not-engaged', (fx) => createQuestions({ coord: fx.coord }).raiseApproval(req(), raiseDeps(fx, { denyEngaged: async () => false }), NOW), 'deny-not-engaged'],
    ['version-unverified (build unread)', (fx) => createQuestions({ coord: fx.coord }).raiseApproval(req(), raiseDeps(fx, { liveVersionOf: async () => null }), NOW), 'version-unverified'],
    ['digest-mismatch', (fx) => createQuestions({ coord: fx.coord }).raiseApproval({ ...req(), digest: 'a'.repeat(64) }, raiseDeps(fx), NOW), 'digest-mismatch'],
    ['run-unreadable (heldFor throws)', (fx) => createQuestions({ coord: fx.coord }).raiseApproval(req(), raiseDeps(fx, {
      heldFor: async () => { throw new Error('fixture: the runs table is unreadable'); } }), NOW), 'run-unreadable'],
  ];
  it.each(refusals)('%s', async (_n, drive, kind) => {
    f = await standardFixture();
    const v = await drive(f);
    expect(v.kind).toBe(kind);
    expect(approvalCount(f.coord), 'no approvals row is minted').toBe(0);
  });
  it('the verdict details are the route\'s words', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    expect(await q.raiseApproval(req(), raiseDeps(f, { signerFor: () => null }), NOW)).toEqual({ kind: 'internal', detail: 'the approval signing key is not loaded' });
    expect(await q.raiseApproval(req(), raiseDeps(f, { liveVersionOf: async () => null }), NOW)).toMatchObject({ kind: 'version-unverified', trust: 'unread' });
    expect(await q.raiseApproval(req(), raiseDeps(f, { heldFor: async () => { throw new Error('boom'); } }), NOW)).toEqual({ kind: 'run-unreadable', detail: 'boom' });
  });
});

describe('path 3: minted released, held for nobody or for a claimant that is not live (Table 2a row 3)', () => {
  const released = async (fx: Approvals, r: ApprovalRaiseRequest, d: ApprovalRaiseDeps, reason: string): Promise<void> => {
    const v = await createQuestions({ coord: fx.coord }).raiseApproval(r, d, NOW);
    expect(v, reason).toMatchObject({ kind: 'approval-released', releaseReason: reason });
    const id = (v as { id: number }).id;
    expect(stateOf(fx, id), reason).toBe('released');
    const row = fx.coord.db.prepare('SELECT releaseReason FROM approvals WHERE id = ?').get(id) as { releaseReason: string };
    expect(row.releaseReason, reason).toBe(reason);
  };
  it('forbidden, truncated and unparseable (the classifier and the body)', async () => {
    f = await standardFixture();
    const { canonical: _c, ...t } = req();
    await released(f, req(hookInput({ command: 'ccd ws-rm project-a-still-cove' })), raiseDeps(f), 'forbidden');
    await released(f, { ...t, truncated: true }, raiseDeps(f), 'truncated');
    await released(f, req(hookInput({ toolInput: ['rm'] as never })), raiseDeps(f), 'unparseable');
    expect(approvalCount(f.coord)).toBe(3);
  });
  it('parent-not-live: the claimant\'s session is gone', async () => {
    f = await standardFixture();
    f.gone.add(PARENT);
    await released(f, req(), raiseDeps(f), 'parent-not-live');
  });
  it('parent-unmeasured: the claimant cannot be measured', async () => {
    f = await standardFixture();
    f.unmeasured.add(PARENT);
    await released(f, req(), raiseDeps(f), 'parent-unmeasured');
  });
  it('run-unclaimed: the run the mark names records no claimant', async () => {
    f = await standardFixture();
    f.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(f.runId);
    await released(f, req(), raiseDeps(f), 'run-unclaimed');
  });
  it('run-unattributed: the claimant was never attributed', async () => {
    f = await standardFixture();
    f.coord.db.prepare('UPDATE runs SET unattributed = 1 WHERE id = ?').run(f.runId);
    await released(f, req(), raiseDeps(f), 'run-unattributed');
  });
  it('run-other-programme: the mark names a run whose claimant is not the newest open run\'s', async () => {
    f = await standardFixture();
    f.child(CHILD2, f.runId);
    f.run(FAR, CHILD2);
    await released(f, req(ORDINARY, CHILD2), raiseDeps(f), 'run-other-programme');
  });
});

// ── 4 and 5. the lapse and the main-thread filter ──────────────────────────────────────────────────────────────────

const T0 = 1_786_000_000_000;
const A = 'project-a-quiet-basin';
const B = 'project-a-still-cove';
const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const APPROVAL_ASK = { approval: { tool: 'Bash', summary: 'rm -rf build' } };
const SUB_AGENT = 'a0000000000000001';
const hook = (ask: unknown): HookState => ({ state: 'waiting', updatedAt: Date.now(), ask } as unknown as HookState);
const rec = (id: string): SessionRecord => ({ id, project: 'project-a', child: { kind: 'child', runId: 1 } } as unknown as SessionRecord);

function carrier() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const home2 = mkTmp('ccrc-aprpaths-q-');
  const coord = new CoordStore(openCoordDb(path.join(home2, '.ccrc', 'coord.db')));
  const runner = async () => ({ ran: true as const, code: 0, stdout: '', stderr: '' });
  const deps = { ...testDeps(home2, runner), coord };
  const rules = { heldFor: vi.fn(async () => ({ kind: 'held', parent: PARENT, runId: 1 })) } as unknown as QuestionRules;
  const q = createQuestions(deps, rules);
  const pushes: QuestionPush[] = [];
  let nonces = 0;
  const approval = (child: string, agentId = ''): number => coord.insertApproval({
    childId: child, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: String(++nonces).padStart(32, 'n'), agentId,
    tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt: Date.now(), notifyAt: Date.now() + 60_000,
  });
  const states = () => (coord.db.prepare('SELECT id, agentId, state FROM approvals ORDER BY id').all() as Array<{ id: number; agentId: string; state: string }>);
  return { coord, q, pushes, sink: (ev: QuestionPush): void => { pushes.push(ev); }, approval, states };
}
afterEach(() => { vi.useRealTimers(); });

describe('path 4: held, then lapsed (Table 2a row 4)', () => {
  it('a held main-thread row past its notifyAt lapses to released, and the deferred push goes through the sink while painted', async () => {
    const c = carrier();
    c.approval(A);
    const dialog = parseDialog(PERMISSION_PANE)!;
    expect((await c.q.raise(rec(A), dialog, hook(APPROVAL_ASK), null, [])).kind).toBe('held');
    const input = (now: number) => ({ now, graceMs: 10_000, paintedDialogOf: () => dialog.id, push: c.sink });
    c.q.lapseApprovals(input(T0 + 59_999));
    expect(c.states().map((r) => r.state), 'inside the window').toEqual(['held']);
    expect(c.pushes).toEqual([]);
    c.q.lapseApprovals(input(T0 + 60_000));
    expect(c.states().map((r) => r.state), 'at the window\'s end').toEqual(['released']);
    expect(c.pushes.map((p) => p.sessionId)).toEqual([A]);
  });
  it('a lapsed row whose dialog is no longer painted sends no push, and the hold is dropped', async () => {
    const c = carrier();
    c.approval(A);
    const dialog = parseDialog(PERMISSION_PANE)!;
    await c.q.raise(rec(A), dialog, hook(APPROVAL_ASK), null, []);
    c.q.lapseApprovals({ now: T0 + 61_000, graceMs: 10_000, paintedDialogOf: () => undefined, push: c.sink });
    expect(c.states().map((r) => r.state)).toEqual(['released']);
    expect(c.pushes).toEqual([]);
    expect(questionsTestView(c.q).heldApprovals().size).toBe(0);
  });
});

describe('path 5: holdApproval keeps only main-thread rows (D-5491)', () => {
  it('a held main-thread row inside its window answers held and withholds the push', async () => {
    const c = carrier();
    const id = c.approval(A);
    const v = await c.q.raise(rec(A), parseDialog(PERMISSION_PANE)!, hook(APPROVAL_ASK), null, []);
    expect(v.kind).toBe('held');
    if (v.kind === 'held') expect(v.record).toMatchObject({ sessionId: A, recordOnly: true, recordAlways: true });
    expect(questionsTestView(c.q).heldApprovals().get(A)?.rowIds).toEqual([id]);
  });
  it('a held subagent row alone answers none: its push is not withheld', async () => {
    const c = carrier();
    c.approval(B, SUB_AGENT);
    const v = await c.q.raise(rec(B), parseDialog(PERMISSION_PANE)!, hook(APPROVAL_ASK), null, []);
    expect(v).toEqual({ kind: 'none' });
    expect(questionsTestView(c.q).heldApprovals().has(B)).toBe(false);
    expect(c.states()).toEqual([{ id: 1, agentId: SUB_AGENT, state: 'held' }]);
  });
  it('a main row beside a subagent row: held, covering the main row only', async () => {
    const c = carrier();
    const main = c.approval(A);
    c.approval(A, SUB_AGENT);
    const v = await c.q.raise(rec(A), parseDialog(PERMISSION_PANE)!, hook(APPROVAL_ASK), null, []);
    expect(v.kind).toBe('held');
    expect(questionsTestView(c.q).heldApprovals().get(A)?.rowIds).toEqual([main]);
  });
});
