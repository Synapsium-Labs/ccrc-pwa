// The approvals lane's clock and the operator's push (coordinator-first routing plan Task 16, D-5298, D-5440, D-5441):
// a painted permission prompt whose child's hook already asked is held off the operator's phone for the row's own
// window (60 s on the main thread, 180 s in a subagent), then pushed; a ruling inside the window resolves it with no
// push; a ruling after it is `409 hook-gone` and the notification is unchanged; a hand-over pushes at once. The clock
// is faked (`Date` only); the fixture is `approvalsHarness.ts`'s.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { UNTRUSTED_PREFACE } from '../src/coord/untrusted.js';
import {
  CHILD, PARENT, hookInput, requestBody, standardFixture, uuidOf, type Approvals,
} from './approvalsHarness.js';

const T0 = 1_784_600_000_000;
let f: (Approvals & { runId: number }) | undefined;
afterEach(async () => { vi.useRealTimers(); if (f) await f.close(); f = undefined; });

const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const BARE = 'ready\n❯ \n';
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';

const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };
const hookstate = (fx: Approvals, ask: unknown): void => {
  writeFileSync(path.join(fx.home, '.cc-sessions', `${CHILD}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(CHILD), pid: 1, updatedAt: Date.now(), ask, subagents: [],
  }));
};
const askPushes = (fx: Approvals) => fx.sent.filter((p) => p.tag === `ask-${CHILD}`);
const rowOf = (fx: Approvals, id: number) => {
  const r = fx.coord.approvalById(id);
  if (!r.ok || r.row === null) throw new Error('fixture: the row must read back');
  return r.row;
};

/** Boot (the priming tick), mint one or more requests through the route, then paint the prompt and tick once. */
const raise = async (
  inputs: Record<string, unknown>[], o: { painted?: boolean; status?: number[] } = {},
): Promise<{ ids: number[]; nonces: string[]; waits: number[] }> => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  f = await standardFixture();
  await f.watcher.tick();
  const ids: number[] = [], nonces: string[] = [], waits: number[] = [];
  for (const [i, input] of inputs.entries()) {
    const body = requestBody(input);
    const res = await f.request(body);
    expect(res.statusCode).toBe(o.status?.[i] ?? 201);
    const j = res.json() as { id: number; waitS: number };
    ids.push(j.id); waits.push(j.waitS); nonces.push(body['nonce'] as string);
  }
  hookstate(f, { approval: { tool: 'Bash', summary: 'rm -rf build' } });
  f.panes.set(CHILD, o.painted === false ? BARE : PERMISSION_PANE);
  await f.watcher.tick();
  return { ids, nonces, waits };
};
const tickAt = async (ms: number): Promise<void> => {
  at(ms);
  hookstate(f!, { approval: { tool: 'Bash', summary: 'rm -rf build' } });
  await f!.watcher.tick();
};

describe('the approval window and the operator\'s push (D-5441)', () => {
  it('a subagent row: waitS 180, its menu hidden while the hook waits (D-5440), raised at its first sighting after the window, and a ruling at 200 s is hook-gone with the notification unchanged', async () => {
    const { ids, waits } = await raise([hookInput({ agentId: 'a0000000000000001' })], { painted: false });
    expect(waits).toEqual([180]);
    await tickAt(179_000);
    expect(askPushes(f!)).toEqual([]);
    expect(rowOf(f!, ids[0]!).state).toBe('held');
    await tickAt(180_000);
    expect(rowOf(f!, ids[0]!).state).toBe('released');
    f!.panes.set(CHILD, PERMISSION_PANE);          // the hook returned with no decision: the menu paints now
    await tickAt(181_000);
    expect(askPushes(f!)).toHaveLength(1);
    at(200_000);
    expect((await f!.rule(ids[0]!, PARENT, 'allow')).json()).toMatchObject({ error: 'hook-gone' });
    await tickAt(202_000);
    expect(askPushes(f!)).toHaveLength(1);
  });

  it('a main-thread row: waitS 60, no push for 60 s, the push at 60 s, and a ruling at 70 s is hook-gone', async () => {
    const { ids, waits } = await raise([hookInput({})]);
    expect(waits).toEqual([60]);
    await tickAt(59_000);
    expect(askPushes(f!)).toEqual([]);
    await tickAt(60_000);
    expect(askPushes(f!)).toHaveLength(1);
    at(70_000);
    expect((await f!.rule(ids[0]!, PARENT, 'allow')).json()).toMatchObject({ error: 'hook-gone' });
  });

  it('a ruling inside the window is accepted and the operator\'s push never fires', async () => {
    const { ids } = await raise([hookInput({})]);
    at(10_000);
    expect((await f!.rule(ids[0]!, PARENT, 'allow')).json()).toEqual({ ok: true, state: 'allowed' });
    await tickAt(12_000);
    f!.panes.set(CHILD, BARE);                       // the hook printed the allow; the menu went away
    await tickAt(14_000);
    await tickAt(200_000);
    expect(askPushes(f!)).toEqual([]);
    expect(rowOf(f!, ids[0]!).state).toBe('allowed');
  });

  it('a hand-over pushes at once, and the ruling route answers the declined row its state and no ruling (D-5440)', async () => {
    const { ids, nonces } = await raise([hookInput({})]);
    at(5_000);
    expect((await f!.release(ids[0]!, PARENT)).json()).toEqual({ ok: true });
    expect(askPushes(f!)).toHaveLength(1);
    expect((await f!.ruling(ids[0]!, nonces[0]!)).json()).toEqual({ state: 'declined' });
  });

  it('a lapsed row answers released and no ruling', async () => {
    const { ids, nonces } = await raise([hookInput({})]);
    await tickAt(61_000);
    expect((await f!.ruling(ids[0]!, nonces[0]!)).json()).toEqual({ state: 'released' });
  });

  it('two parallel subagent requests mint two rows, each ruled or lapsing on its own, and neither buzzes while hidden', async () => {
    const { ids } = await raise([hookInput({ agentId: 'a0000000000000001' }), hookInput({ agentId: 'a0000000000000002', command: 'rm -rf dist' })],
      { painted: false });
    expect(new Set(ids).size).toBe(2);
    at(10_000);
    expect((await f!.rule(ids[0]!, PARENT, 'deny')).statusCode).toBe(200);
    await tickAt(100_000);
    expect(askPushes(f!)).toEqual([]);
    expect(rowOf(f!, ids[1]!).state).toBe('held');
    await tickAt(180_000);
    expect(rowOf(f!, ids[1]!).state).toBe('released');
    expect(rowOf(f!, ids[0]!).state).toBe('denied');
  });

  it('the painted prompt answered in the pane: the dialog clears and its unruled rows become operator', async () => {
    const { ids } = await raise([hookInput({})]);
    f!.panes.set(CHILD, BARE);
    await tickAt(5_000);
    expect(rowOf(f!, ids[0]!).state).toBe('operator');
    expect((await f!.rule(ids[0]!, PARENT, 'allow')).json()).toMatchObject({ error: 'already-ruled' });
  });

  it('the hook\'s ceiling: a released row past askAt + APPROVAL_HOOK_WAIT_S is stale', async () => {
    const { ids } = await raise([hookInput({})]);
    await tickAt(61_000);
    await tickAt(541_000);
    expect(rowOf(f!, ids[0]!).state).toBe('stale');
  });

  it('an input older than 30 days is cleared and the row kept', async () => {
    const { ids } = await raise([hookInput({})]);
    at(31 * 86_400_000);
    await f!.watcher.sweepApprovals();
    const row = rowOf(f!, ids[0]!);
    expect(row.inputRedacted).toBeNull();
    expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

// The painted prompt is the main thread's: a background subagent's menu is painted only after its hook returns (D-5440,
// and a fleet child's subagents are background ones, D-5443). So only the child's main-thread rows defer the painted
// dialog's push, and a subagent's hidden wait neither withholds that push nor is ended by that dialog (D-5491).
describe('a main-thread prompt and a background subagent\'s hidden wait at once (D-5491)', () => {
  const BG = { agentId: 'a0000000000000001', command: 'rm -rf dist' };
  it('the main-thread row lapses at 60 s while the subagent row is held: the operator is pushed then, not at 180 s', async () => {
    const { ids } = await raise([hookInput(BG), hookInput({})]);
    await tickAt(59_000);
    expect(askPushes(f!)).toEqual([]);
    await tickAt(61_000);
    expect(askPushes(f!)).toHaveLength(1);
    expect(rowOf(f!, ids[0]!).state).toBe('held');
  });

  it('a forbidden main-thread request (minted released) goes straight to the operator while the subagent row is held', async () => {
    await raise([hookInput(BG), hookInput({ command: 'ccd ws-rm project-a-still-cove' })], { status: [201, 409] });
    expect(askPushes(f!)).toHaveLength(1);
  });

  it('the claimant hands the main-thread prompt over while the subagent row is held: the push fires at once', async () => {
    const { ids } = await raise([hookInput(BG), hookInput({})]);
    at(5_000);
    expect((await f!.release(ids[1]!, PARENT)).json()).toEqual({ ok: true });
    expect(askPushes(f!)).toHaveLength(1);
    expect(rowOf(f!, ids[0]!).state).toBe('held');
  });

  it('the main-thread row is ruled and its dialog clears: the subagent row keeps its hidden wait (not operator)', async () => {
    const { ids } = await raise([hookInput(BG), hookInput({})]);
    at(10_000);
    expect((await f!.rule(ids[1]!, PARENT, 'allow')).statusCode).toBe(200);
    f!.panes.set(CHILD, BARE);
    await tickAt(14_000);
    expect(rowOf(f!, ids[0]!).state).toBe('held');
    expect(rowOf(f!, ids[1]!).state).toBe('allowed');
    expect(askPushes(f!)).toEqual([]);
  });

  it('a subagent row ruled while the main-thread prompt is with the operator does not replace that notification', async () => {
    const { ids } = await raise([hookInput(BG), hookInput({ command: 'ccd ws-rm project-a-still-cove' })], { status: [201, 409] });
    expect(askPushes(f!)).toHaveLength(1);
    at(10_000);
    expect((await f!.rule(ids[0]!, PARENT, 'deny')).statusCode).toBe(200);
    expect(askPushes(f!)).toHaveLength(1);
  });
});

describe('the claimant\'s mail (spec §6.3 server step 3, §6.7)', () => {
  it('fences the redacted command under the preface, shows the class outside the fence, the UTC deadline and both commands; a bearer token is masked', async () => {
    const TOKEN_HEX = 'abcdef0123456789'.repeat(2);
    const { ids } = await raise([hookInput({ command: `rm -rf build && echo "Bearer ${TOKEN_HEX}"` })]);
    const mail = f!.coord.db.prepare("SELECT body FROM mail WHERE subject = ?").get(`approval:${ids[0]}`) as { body: string };
    const body = mail.body;
    expect(body).not.toContain(TOKEN_HEX);
    const fenceAt = body.indexOf(UNTRUSTED_PREFACE);
    expect(fenceAt).toBeGreaterThan(0);
    const cls = body.indexOf('Class (the server\'s, not the child\'s): escalate');
    expect(cls).toBeGreaterThanOrEqual(0);
    expect(cls).toBeLessThan(fenceAt);
    expect(body).toContain(`closes at ${new Date(T0 + 60_000).toISOString().slice(11, 19)} UTC`);
    expect(body).toContain(`"$API" approvals rule ${ids[0]} --json -\n`);
    expect(body).toContain("IFS= read -r reason <<'REASON'\n");     // the reason never expands (D-5489)
    expect(body).toContain(`"$API" approvals release ${ids[0]} --json - <<JSON`);
    expect(body).toContain('"fromId":"$id","fromUuid":"$uuid"');     // the hand-over's pair
    expect(body).toContain('{fromId:$id,fromUuid:$uuid,verdict:"deny",reason:$reason}');
    expect(body).not.toContain('verdict:"allow"');   // escalate: no allow command is offered
  });

  it('an ordinary row\'s mail offers the allow command too', async () => {
    const { ids } = await raise([hookInput({})]);
    const mail = f!.coord.db.prepare("SELECT body FROM mail WHERE subject = ?").get(`approval:${ids[0]}`) as { body: string };
    expect(mail.body).toContain('verdict:"allow"');
    expect(mail.body).toContain('verdict:"deny"');
  });

  it('the approval mail is recorded, never pushed: it must not buzz the operator during the window', async () => {
    await raise([hookInput({})]);
    await tickAt(2_000);
    expect(f!.sent.filter((p) => (p.tag ?? '').startsWith('mail-'))).toEqual([]);
  });
});

describe('a question\'s text is redacted before the asks row and the ask mail (spec §5.4, §6.7)', () => {
  it('a bearer token in the question is masked in the row and in the mail', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    f = await standardFixture();
    await f.watcher.tick();
    const TOKEN_HEX = '0123456789abcdef'.repeat(2);
    hookstate(f, { questions: [{ question: `Use Bearer ${TOKEN_HEX} for the call?`, header: 'Token', multiSelect: false,
      options: [{ label: 'Yes' }, { label: 'No' }] }] });
    f.panes.set(CHILD, MENU_PANE);
    await f.watcher.tick();
    const row = f.coord.db.prepare('SELECT question, options FROM asks').get() as { question: string; options: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.question).not.toContain(TOKEN_HEX);
    expect(row!.question).toContain('[REDACTED]');
    const mail = f.coord.db.prepare("SELECT body FROM mail WHERE subject LIKE 'ask:%'").get() as { body: string };
    expect(mail.body).not.toContain(TOKEN_HEX);
  });
});
