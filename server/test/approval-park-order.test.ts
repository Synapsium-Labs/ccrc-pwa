// The park's clear and park ordering, driven through the watcher (approvals PR 3c, F-A; approvals plan 2026-11-18, §3.3.1
// and the line on a press in the clear interval). In one watcher tick `detectDialogs` runs before the approvals sweep, so a
// clear edge can be seen before the sweep parks a row whose hook has already printed the park deny. A clear edge at or past
// the row's `notifyAt` less the slack (1.5 s) is that deny and settles nothing; the sweep parks the row. After the park, a
// clear is the park deny too and voids nothing, while the operator's press through the session door on that dialog still
// reaches the parked row and voids its park, only when the press lands (review 3022 F2) and only while hook state still
// names that row's own prompt (F1: the dialog id hashes the menu, not the command). A dialog still painted on a closed key
// is pushed (F3). Hook state keeps one stamp per prompt, as the hook's main-thread wait does. The clock is faked (`Date` only); the fixture is `approvalsHarness.ts`'s, the park
// lane stored live and its gate opened for the mint (this build holds it inert). Neutral fixtures only; never the live HOME.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { heldFor } from '../src/coord/heldFor.js';
import { loadOrCreateApprovalSigner, rulingsAllowedHere } from '../src/coord/approvalsign.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { parseDialog } from '../src/pane/dialog.js';
import type { ApprovalRaiseDeps } from '../src/coord/questions.js';
import { APPROVAL_PARK_LANE } from '../../shared/lane-arm.js';
import { CHILD, PARENT, hookInput, requestBody, standardFixture, uuidOf, type Approvals } from './approvalsHarness.js';

const T0 = 1_784_600_000_000;
let f: (Approvals & { runId: number }) | undefined;
afterEach(async () => { vi.useRealTimers(); if (f) await f.close(); f = undefined; });

const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const BARE = 'ready\n❯ \n';
const DIALOG_ID = parseDialog(PERMISSION_PANE)?.id ?? '';

const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };
const fx = (): Approvals & { runId: number } => { if (f === undefined) throw new Error('fixture: boot first'); return f; };
/** The main thread's wait for one prompt: its stamp is the PermissionRequest's and stands for the whole wait. */
interface Prompt { readonly at: number; readonly summary: string }
const PROMPT_A: Prompt = { at: T0 + 500, summary: 'rm -rf build' };
let prompt: Prompt = PROMPT_A;
/** A subagent's prompts live in hook state's per-agent list, each entry stamped by its own write, and the newest one's
 *  write set the wait (`waitBy`); null: the main thread's. */
let entries: readonly (Prompt & { readonly agentId: string })[] | null = null;
const hookstate = (): void => {
  const wait = entries === null ? prompt : entries[entries.length - 1] ?? prompt;
  writeFileSync(path.join(fx().home, '.cc-sessions', `${CHILD}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(CHILD), pid: 1, updatedAt: wait.at,
    ask: { approval: { tool: 'Bash', summary: wait.summary } }, subagents: [],
    ...(entries === null ? {} : { waitBy: 'subagent', approvals: entries.map((e) => ({ agentId: e.agentId, tool: 'Bash', summary: e.summary, at: e.at })) }),
  }));
};
const tickAt = async (ms: number, pane: string): Promise<void> => {
  at(ms);
  fx().panes.set(CHILD, pane);
  hookstate();
  await fx().watcher.tick();
};
/** The operator's press through the session door. Enter answers the prompt, so the fixture's pane clears on it, as Claude
 *  Code's does (the press then settles at once rather than waiting for a pane that never moves). */
const press = (dialogId = DIALOG_ID) => {
  const real = fx().deps.tmux.sendKey.bind(fx().deps.tmux);
  vi.spyOn(fx().deps.tmux, 'sendKey').mockImplementation(async (id: string, key: string) => {
    if (key === 'Enter') fx().panes.set(CHILD, BARE);
    return real(id, key);
  });
  return pressDoor(dialogId);
};
const pressDoor = (dialogId: string) => fx().app.inject({
  method: 'POST', url: `/api/questions/session-${CHILD}/answer`, payload: { kind: 'dialog', dialogId, optionIndex: 1 },
});
const rowOf = (id: number) => {
  const r = fx().coord.approvalById(id);
  if (!r.ok || r.row === null) throw new Error('fixture: the row must read back');
  return r.row;
};
const parkOf = (id: number) => { const k = rowOf(id).parkKey; return k === null ? null : fx().coord.approvalPark(k); };
const parkPushes = (id: number) => fx().sent.filter((p) => p.body.includes(`approval ${id}`));

/** Boot (the priming tick), store the park lane live, mint one main-thread request through the watcher's own questions
 *  instance with the lane's gate opened and sign-in armed (its window is 60 s), then paint its prompt and tick once: the
 *  painted prompt is held for the claimant, covering the row. Answers the row's id. */
const boot = async (o: { closeRunAt?: number; agentId?: string } = {}): Promise<number> => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  prompt = PROMPT_A;
  entries = o.agentId === undefined ? null : [{ ...PROMPT_A, agentId: o.agentId }];
  f = await standardFixture();
  f.coord.db.prepare("UPDATE lane_arm_settings SET choice = 'live' WHERE lane = ?").run(APPROVAL_PARK_LANE);
  await f.watcher.tick();
  const signer = loadOrCreateApprovalSigner(path.join(f.home, '.ccrc'));
  const deps: ApprovalRaiseDeps = {
    coord: f.coord, io: f.deps.io, cfg: { ...f.deps.cfg, authEnabled: true }, tmux: f.deps.tmux, masker: SHAPE_ONLY_MASKER,
    signerFor: () => signer, rulingsAllowedHere, heldFor, denyStanding: async () => 'current', liveVersionOf: async () => '2.1.302',
    journalDigestMismatch: () => {}, parkGate: () => null,
  };
  const b = requestBody(hookInput({ command: 'rm -rf build', ...(o.agentId === undefined ? {} : { agentId: o.agentId }) }));
  const v = await f.watcher.questions.raiseApproval({ sessionId: CHILD, digest: b.digest, nonce: b.nonce, canonical: b.canonical }, deps, Date.now());
  if (v.kind !== 'minted') throw new Error(`fixture: not minted: ${JSON.stringify(v)}`);
  expect(v.park).toBe('live');
  if (o.agentId === undefined) expect(rowOf(v.id).notifyAt).toBe(T0 + 60_000);
  await tickAt(1_000, PERMISSION_PANE);
  if (o.closeRunAt !== undefined) {
    // The abandon door closes the run `failed` while the prompt is still inside its window.
    at(o.closeRunAt);
    f.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(f.runId);
  }
  return v.id;
};

describe('a clear edge before the sweep in one tick (F-A, option (i): the slack, 1.5 s)', () => {
  it('the clear seen in the tick whose sweep parks the row: the row parks, never operator, and its push is sent at park time', async () => {
    const id = await boot();
    await tickAt(60_000, BARE);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
    expect(parkPushes(id)).toHaveLength(1);
  });
  it('the hook\'s deny clears the prompt up to 1.5 s before notifyAt: that clear settles nothing, and the next sweep parks the row', async () => {
    const id = await boot();
    await tickAt(58_500, BARE);
    expect(rowOf(id).state).toBe('held');
    await tickAt(60_000, BARE);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
  });
  it('a clear earlier than the slack is the operator\'s answer in the pane: the row becomes operator and never parks', async () => {
    const id = await boot();
    await tickAt(58_499, BARE);
    expect(rowOf(id).state).toBe('operator');
    await tickAt(60_000, BARE);
    expect(rowOf(id).state).toBe('operator');
    expect(parkPushes(id)).toHaveLength(0);
  });
});

describe('a closed key at the window\'s end, the dialog still painted (F-B, review 3022 F3)', () => {
  it('the row is staled, not parked; the still-painted prompt, which no row will answer, is pushed to the operator once', async () => {
    const id = await boot({ closeRunAt: 30_000 });
    await tickAt(60_000, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('stale');
    expect(parkOf(id)?.parkedAt ?? null).toBeNull();
    expect(parkPushes(id), 'no "parked for a ruling" push').toHaveLength(0);
    expect(fx().sent.filter((p) => p.tag === `ask-${CHILD}`), 'the painted prompt, as the operator\'s').toHaveLength(1);
    await tickAt(62_000, PERMISSION_PANE);
    expect(fx().sent.filter((p) => p.tag === `ask-${CHILD}`), 'once').toHaveLength(1);
  });
});

describe('after the park, the dialog still painted (F-A, the press in the clear interval)', () => {
  it('the operator\'s press through the session door on that dialog marks the parked row operator and voids its park', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('parked');
    const res = await press();
    expect(res.statusCode).toBe(200);
    expect(rowOf(id).state).toBe('operator');
    expect(parkOf(id)?.voided).toBe(true);
    expect(fx().watcher.questions.operatorRuleApproval({ id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(409);
  });
  it('a press on another dialog of the child reaches no parked row (review 2889 F3 holds)', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    await press('another-dialog');
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
  });
  it('a press on a second prompt painted under the same dialog id voids no park (review 3022 F1: the id hashes the menu, not the command)', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('parked');
    // The deny cleared the first prompt and the model asked again before the poll saw the clear: the same labels and
    // title (so the same id), another command, a new wait in hook state.
    prompt = { at: T0 + 60_400, summary: 'rm -rf dist' };
    hookstate();
    const res = await press();
    expect(res.statusCode).toBe(200);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
  });
  it('a subagent\'s: a press on a queued sibling\'s prompt under the same menu voids no park once the hook dropped the parked entry (review 3037 F1)', async () => {
    const id = await boot({ agentId: 'a0000000000000013' });
    const end = rowOf(id).notifyAt - T0; // a subagent's own window
    await tickAt(end, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('parked');
    // The park deny printed and dropped the first agent's entry (ccd/session-hook.sh, `_hook_approval_wait`); the sibling's
    // prompt, the same command (so the same dialog id), painted at once, so the poll saw no clear edge.
    entries = [{ at: T0 + end + 400, summary: 'rm -rf build', agentId: 'a0000000000000019' }];
    hookstate();
    const res = await press();
    expect(res.statusCode).toBe(200);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
  });
  it('a press that does not land (stale-dialog: the deny cleared the prompt before the poll saw it) voids no park (review 3022 F2)', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('parked');
    fx().panes.set(CHILD, BARE);
    const res = await press();
    expect(res.statusCode).toBe(409);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
  });
  it('a clear after the park is the park deny: the row stays parked, its park open, and the operator may still rule it', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('parked');
    await tickAt(62_000, BARE);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
    expect(parkPushes(id)).toHaveLength(1);
    expect(fx().watcher.questions.operatorRuleApproval({ id, verdict: 'deny', reason: 'no', by: PARENT }).status).toBe(200);
  });
});
