// The park's clear and park ordering, driven through the watcher (approvals PR 3c, F-A; approvals plan 2026-11-18, §3.3.1
// and the line on a press in the clear interval). In one watcher tick `detectDialogs` runs before the approvals sweep, so a
// clear edge can be seen before the sweep parks a row whose hook has already printed the park deny. A clear edge at or past
// the row's `notifyAt` less the slack is that deny and settles nothing; the sweep parks the row. After the park, a clear is
// the park deny too and voids nothing, while the operator's press through the session door on that dialog still reaches
// the parked row and voids its park. The clock is faked (`Date` only); the fixture is `approvalsHarness.ts`'s, the park
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
const hookstate = (): void => {
  writeFileSync(path.join(fx().home, '.cc-sessions', `${CHILD}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(CHILD), pid: 1, updatedAt: Date.now(),
    ask: { approval: { tool: 'Bash', summary: 'rm -rf build' } }, subagents: [],
  }));
};
const tickAt = async (ms: number, pane: string): Promise<void> => {
  at(ms);
  fx().panes.set(CHILD, pane);
  hookstate();
  await fx().watcher.tick();
};
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
const boot = async (): Promise<number> => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  f = await standardFixture();
  f.coord.db.prepare("UPDATE lane_arm_settings SET choice = 'live' WHERE lane = ?").run(APPROVAL_PARK_LANE);
  await f.watcher.tick();
  const signer = loadOrCreateApprovalSigner(path.join(f.home, '.ccrc'));
  const deps: ApprovalRaiseDeps = {
    coord: f.coord, io: f.deps.io, cfg: { ...f.deps.cfg, authEnabled: true }, tmux: f.deps.tmux, masker: SHAPE_ONLY_MASKER,
    signerFor: () => signer, rulingsAllowedHere, heldFor, denyStanding: async () => 'current', liveVersionOf: async () => '2.1.302',
    journalDigestMismatch: () => {}, parkGate: () => null,
  };
  const b = requestBody(hookInput({ command: 'rm -rf build' }));
  const v = await f.watcher.questions.raiseApproval({ sessionId: CHILD, digest: b.digest, nonce: b.nonce, canonical: b.canonical }, deps, Date.now());
  if (v.kind !== 'minted') throw new Error(`fixture: not minted: ${JSON.stringify(v)}`);
  expect(v.park).toBe('live');
  expect(rowOf(v.id).notifyAt).toBe(T0 + 60_000);
  await tickAt(1_000, PERMISSION_PANE);
  return v.id;
};

describe('a clear edge before the sweep in one tick (F-A, option (i): the slack)', () => {
  it('the clear seen in the tick whose sweep parks the row: the row parks, never operator, and its push is sent at park time', async () => {
    const id = await boot();
    await tickAt(60_000, BARE);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
    expect(parkPushes(id)).toHaveLength(1);
  });
  it('the hook\'s deny clears the prompt up to 2 s before notifyAt: that clear settles nothing, and the next sweep parks the row', async () => {
    const id = await boot();
    await tickAt(58_000, BARE);
    expect(rowOf(id).state).toBe('held');
    await tickAt(60_000, BARE);
    expect(rowOf(id).state).toBe('parked');
    expect(parkOf(id)?.voided).toBe(false);
  });
  it('a clear earlier than the slack is the operator\'s answer in the pane: the row becomes operator and never parks', async () => {
    const id = await boot();
    await tickAt(57_999, BARE);
    expect(rowOf(id).state).toBe('operator');
    await tickAt(60_000, BARE);
    expect(rowOf(id).state).toBe('operator');
    expect(parkPushes(id)).toHaveLength(0);
  });
});

describe('after the park, the dialog still painted (F-A, the press in the clear interval)', () => {
  it('the operator\'s press through the session door on that dialog marks the parked row operator and voids its park', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    expect(rowOf(id).state).toBe('parked');
    const res = await fx().app.inject({
      method: 'POST', url: `/api/questions/session-${CHILD}/answer`, payload: { kind: 'dialog', dialogId: DIALOG_ID, optionIndex: 2 },
    });
    expect(res.statusCode).toBeLessThan(500);
    expect(rowOf(id).state).toBe('operator');
    expect(parkOf(id)?.voided).toBe(true);
    expect(fx().watcher.questions.operatorRuleApproval({ id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(409);
  });
  it('a press on another dialog of the child reaches no parked row (review 2889 F3 holds)', async () => {
    const id = await boot();
    await tickAt(60_000, PERMISSION_PANE);
    await fx().app.inject({
      method: 'POST', url: `/api/questions/session-${CHILD}/answer`, payload: { kind: 'dialog', dialogId: 'another-dialog', optionIndex: 0 },
    });
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
