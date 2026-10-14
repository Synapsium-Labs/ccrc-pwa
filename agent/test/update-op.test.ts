// Design 2026-09-20 §10: the `update` op, answered by a REAL agent over a real
// loopback WS against a fixture HOME (the `build-fp.test.ts` idiom). Every spawn
// is the injected `AgentOpts.spawnUpdate` recorder, with one exception: the
// describe at the end runs `realUpdateSpawn` over a fixture launcher UNDER the
// fixture HOME, with the process's PATH and HOME contained for its cases. None
// of these cases touches a real `~/.local/bin/ccrc` or the live `$HOME`.
//
// What is pinned (spec §10 Pins, §18):
//  - The argument is gated in `validateReq`, before any case body runs, and
//    nothing spawns. A bad tag answers `bad-tag` (`isReleaseTag`, the one
//    guard) and a bad kind `bad-kind`. Neither is ever `bad-request`, which
//    from this op must mean "the agent predates it".
//  - `busy` in two situations. One: `~/.ccrc/update.json` says a run is in
//    flight, read directly and bounded
//    (D-3371). Two: another op is still
//    spawning on this AGENT (D-3392).
//  - The spawn is exactly one of two absolute argv templates, bounded by
//    `UPDATE_SPAWN_TIMEOUT_MS`.
//  - The answer is `accepted` only once the `--detach` parent exited 0.
//    Anything else is `spawn-failed`, carrying the parent's first stderr line
//    (D-3372); a parent killed at the bound is decided by re-measurement (D-3413).
//  - The ready frame advertises exactly `['update', 'token-sync']` (the second word is box-token lifecycle wave 1's,
//    pinned with its op in `token-sync-op.test.ts`).
//  - The op reaches no exec path. This is a SOURCE scan, because no behavioural
//    case can see an extra call whose answer comes out the same.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInFlightReport, realUpdateSpawn, type RunningAgent, type UpdateSpawn } from '../src/server.js';
import { EXEC_COMMANDS, FORBIDDEN_COMMANDS, isExecAllowed } from '../src/whitelist.js';
import {
  UPDATE_OP_DETAIL_MAX, UPDATE_SPAWN_TIMEOUT_MS, updateLauncherPath, updateSpawnArgv, type AgentReady,
} from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(here, '..', 'src', 'server.ts');

interface Res { t: 'res'; id: number; ok: boolean; err?: string; detail?: string; accepted?: boolean }
interface SpawnCall { file: string; args: string[]; timeoutMs: number }
type SpawnAnswer = Awaited<ReturnType<UpdateSpawn>>;

/** A recording `spawnUpdate`. After `park()`, every call waits until
 *  `release()`, which stands in for a `--detach` parent still running. */
function recorder(answer: SpawnAnswer = { code: 0, stdout: '', stderr: '', killed: false, pid: 4242 }) {
  const calls: SpawnCall[] = [];
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const spawn: UpdateSpawn = async (file, args, timeoutMs) => {
    calls.push({ file, args: [...args], timeoutMs });
    if (gate !== null) await gate;
    return answer;
  };
  return {
    calls,
    spawn,
    park(): void { gate = new Promise<void>((r) => { open = r; }); },
    release(): void { gate = null; open(); },
  };
}

/** wave 4's `update.json` line — seven keys, times in unix SECONDS (rulings R1/R14). The default writer is THIS
 *  process, alive, because an in-flight report answers `busy` only while its writer lives (D-3411). */
const reportLine = (o: Record<string, unknown> = {}): string => `${JSON.stringify({
  target: 'v0.0.8', phase: 'installing', startedAt: 1790000000, updatedAt: 1790000060, detail: null, from: 'pwa',
  pid: process.pid, ...o,
})}\n`;
function reportPath(home: string): string {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  return path.join(home, '.ccrc', 'update.json');
}
const TEMPLATE = ['update', '--to', 'v0.0.9', '--detach', '--from', 'pwa'];

/** A pid that was real and is gone: a short child, waited for. Its number is free until the kernel wraps, far off. */
async function deadPid(): Promise<number> {
  const child = spawn('true', [], { stdio: 'ignore' });
  const pid = child.pid!;
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  return pid;
}

/** The text between `open` and the first `close` match after it: a named slice
 *  of the real source, which fails loudly when either anchor is missing. */
function slice(src: string, open: string, close: RegExp): string {
  const at = src.indexOf(open);
  expect(at, `${open} not found in agent/src/server.ts`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(at + open.length);
  const end = close.exec(rest);
  expect(end, `no end after ${open}`).not.toBeNull();
  return rest.slice(0, end!.index);
}
/** Every way into the exec surface or the wire read gate. */
const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
const CASE_END = /\n    (?:case '|default:)/;

describe('the update op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  /** EVERY client this file opens, closed by the hook whether the case passed or
   *  threw (`build-fp.test.ts`'s reason: mutation sweeps run with red asserts). */
  const clients: TestClient[] = [];
  const open = async (port: number): Promise<TestClient> => {
    const c = new TestClient(port);
    clients.push(c);
    await c.hello();
    return c;
  };

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  /** A fixture HOME, a real agent spawning through `rec`, and one authenticated client. */
  async function up(rec = recorder()): Promise<{ c: TestClient; rec: ReturnType<typeof recorder>; home: string }> {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnUpdate: rec.spawn });
    return { c: await open(agent.port), rec, home: fixture.home };
  }

  describe('validateReq gates the argument before any case body runs', () => {
    it("a tag that fails isReleaseTag is bad-tag — the '; rm' fixture spawns nothing", async () => {
      const { c, rec } = await up();
      const res = await c.req<Res>(1, { op: 'update', tag: '; rm -rf ~' });
      // "Nothing spawned" is asserted FIRST: with both guard layers removed
      // (Step 8 mutation 2) the answer is `accepted`, and this is the line that
      // must name what happened — the tag reached the spawn.
      expect(rec.calls, 'the recorder saw a spawn').toEqual([]);
      expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'bad-tag' });
    });

    it('a tag that is not a string, or no tag at all, is bad-tag', async () => {
      const { c, rec } = await up();
      const frames: Record<string, unknown>[] = [
        { op: 'update', tag: 42 }, { op: 'update', tag: null }, { op: 'update' }, { op: 'update', tag: ['v0.0.9'] },
      ];
      for (const [i, frame] of frames.entries()) {
        expect(await c.req<Res>(i + 1, frame), JSON.stringify(frame)).toEqual({ t: 'res', id: i + 1, ok: false, err: 'bad-tag' });
      }
      expect(rec.calls).toEqual([]);
    });

    it('a kind outside RequestKind is bad-kind — never bad-request, and nothing spawns', async () => {
      const { c, rec } = await up();
      for (const [i, kind] of (['sideways', null, 'Update', 1] as const).entries()) {
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9', kind }), String(kind))
          .toEqual({ t: 'res', id: i + 1, ok: false, err: 'bad-kind' });
      }
      expect(rec.calls).toEqual([]);
    });

    it('no id is no reply (the envelope rule, unchanged) and the connection keeps serving', async () => {
      const { c, rec } = await up();
      c.send({ t: 'req', op: 'update', tag: 'v0.0.9' });
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ id: 2, ok: true, accepted: true });
      await expect(c.waitFor((m) => (m as Res).t === 'res' && (m as Res).id === undefined, 300)).rejects.toThrow('timed out');
      expect(rec.calls).toHaveLength(1);
    });

    it('kind absent is the update template', async () => {
      const { c, rec } = await up();
      await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' });
      expect(rec.calls.map((x) => x.args)).toEqual([TEMPLATE]);
    });
  });

  describe('the spawn — two absolute templates, and an answer only once the --detach parent exited', () => {
    it('update: exactly <home>/.local/bin/ccrc update --to <tag> --detach --from pwa, bounded, then accepted', async () => {
      const { c, rec, home } = await up();
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9', kind: 'update' }))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
      expect(rec.calls).toEqual([
        { file: path.join(home, '.local', 'bin', 'ccrc'), args: TEMPLATE, timeoutMs: UPDATE_SPAWN_TIMEOUT_MS },
      ]);
    });

    it('rollback: the twin template', async () => {
      const { c, rec, home } = await up();
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.8', kind: 'rollback' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toEqual([{
        file: path.join(home, '.local', 'bin', 'ccrc'),
        args: ['rollback', '--to', 'v0.0.8', '--detach', '--from', 'pwa'],
        timeoutMs: UPDATE_SPAWN_TIMEOUT_MS,
      }]);
    });

    // Step 0.1: a lock-held busy names the way out, as an in-flight report's does (a holder that hangs writes no report).
    const ADVICE = ' - a live updater that hangs answers busy on every sweep: ack the row or mend the box';
    it('a parent that exits 1 on the LOCK is busy carrying its first stderr line, never spawn-failed (D-3411, review F1)', async () => {
      const LOCK = 'ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';
      const { c } = await up(recorder({ code: 1, stdout: '', stderr: `${LOCK}\nsecond\n`, killed: false, pid: 4242 }));
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'busy', detail: `${LOCK}${ADVICE}` });
    });

    it.each([
      ["flock absent (`_upd_flock_die`)", "ccrc: flock (util-linux) is required by 'ccrc update' — it serialises updates and refuses rather than racing; nothing on this box was changed"],
      ['an unmeasured lock (the probe\'s last arm)', 'ccrc: update: ~/.ccrc/update.lock could not be measured (probe rc 3) — refusing to detach a run past a lock this box cannot see; nothing on this box was changed'],
    ])('every OTHER refusal keeps spawn-failed — %s (D-3411)', async (_what, line) => {
      const { c } = await up(recorder({ code: 1, stdout: '', stderr: `${line}\n`, killed: false, pid: 4242 }));
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: false, err: 'spawn-failed' });
    });

    it('the rule is the FIRST stderr line: a lock sentence behind another line is spawn-failed with the first (D-3411)', async () => {
      const { c } = await up(recorder({
        code: 1, stdout: '', killed: false, pid: 4242,
        stderr: 'ccrc: something else\nccrc: update: another update holds ~/.ccrc/update.lock (pid 7)\n',
      }));
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toMatchObject({ ok: false, err: 'spawn-failed', detail: 'ccrc: something else' });
    });

    // Corrected in fix round 1 (D-3400 amended, D-3413): a parent killed at the bound is no longer a blanket
    // `spawn-failed` naming the timeout. What it did is re-measured (`update-killed-arms.test.ts` pins every arm); here, with
    // no update.json at either read and stdout read to EOF, nothing was queued: `not-queued`, which releases idle.
    it('a parent killed at the bound with nothing queued answers not-queued, never a halting spawn-failed (Review Focus 4, D-3413)', async () => {
      const { c } = await up(recorder({ code: 137, stdout: '', stderr: '', killed: true, pid: 4242 }));
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toEqual({
        t: 'res', id: 1, ok: false, err: 'not-queued',
        detail: `the --detach parent was stopped at the ${UPDATE_SPAWN_TIMEOUT_MS} ms bound before it queued anything; nothing started`,
      });
    });

    it('a spawn port that throws is answered by the envelope, and the gate is released', async () => {
      fixture = makeFixture();
      let first = true;
      const spawn: UpdateSpawn = async () => {
        if (first) { first = false; throw new Error('spawn port failed'); }
        return { code: 0, stdout: '', stderr: '', killed: false, pid: 4242 };
      };
      agent = await boot(fixture, { spawnUpdate: spawn });
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'spawn port failed' });
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
    });
  });

  describe('busy — a run in flight, or a spawn still running on this agent', () => {
    it('update.json in flight with a LIVE writer is busy, naming the phase, target, start second and writer pid, and the way out — nothing spawned (D-3411)', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      const tail = ' - a live updater that hangs answers busy on every sweep: ack the row or mend the box';
      for (const [i, phase] of (['queued', 'installing', 'restoring'] as const).entries()) {
        writeFileSync(p, reportLine({ phase }));
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9' }), phase).toEqual({
          t: 'res', id: i + 1, ok: false, err: 'busy',
          detail: `update.json says ${phase} (target v0.0.8, started 1790000000, writer pid ${process.pid})${tail}`,
        });
      }
      writeFileSync(p, reportLine({ target: null, startedAt: 1790000000000 }));
      expect(await c.req<Res>(4, { op: 'update', tag: 'v0.0.9' }))
        .toMatchObject({ err: 'busy', detail: `update.json says installing (target none, started unknown, writer pid ${process.pid})${tail}` });
      expect(rec.calls).toEqual([]);
    });

    it('a report whose pid is ABSENT or unreadable keeps busy — that writer is unmeasurable, not dead (D-3411)', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      const withoutPid = JSON.parse(reportLine()) as Record<string, unknown>;
      delete withoutPid.pid;
      writeFileSync(p, `${JSON.stringify(withoutPid)}\n`);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toMatchObject({ err: 'busy', detail: expect.stringContaining('writer pid unknown') });
      // 0 and negative would be a process GROUP to kill(2): never read as a pid, so unreadable, so busy.
      for (const [i, bad] of ([0, -1, 1.5, '4242', null] as const).entries()) {
        writeFileSync(p, reportLine({ pid: bad }));
        expect(await c.req<Res>(i + 2, { op: 'update', tag: 'v0.0.9' }), String(bad))
          .toMatchObject({ err: 'busy', detail: expect.stringContaining('writer pid unknown') });
      }
      expect(rec.calls).toEqual([]);
    });

    it('a leftover in-flight report whose writer is DEAD spawns — the parent\'s own lock probe decides (D-3411, review F2)', async () => {
      const { c, rec, home } = await up();
      const dead = await deadPid();
      for (const [i, phase] of (['queued', 'installing', 'restoring'] as const).entries()) {
        writeFileSync(reportPath(home), reportLine({ phase, pid: dead }));
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9' }), phase).toMatchObject({ ok: true, accepted: true });
      }
      expect(rec.calls).toHaveLength(3);
    });

    it('a busy detail built from an in-flight report is bounded to UPDATE_OP_DETAIL_MAX, and the way out survives the cut (D-3391, D-3411)', async () => {
      // `isReleaseTag` has no length cap on the numeric components, so a
      // report whose target is a release tag with a ~1000-digit major
      // component still passes it and would otherwise blow the sentence past
      // the op's one detail bound.
      const { c, rec, home } = await up();
      const p = reportPath(home);
      writeFileSync(p, reportLine({ target: `v${'1'.repeat(1000)}.0.0` }));
      const res = await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' });
      expect(res).toMatchObject({ ok: false, err: 'busy' });
      expect(res.detail).toBeDefined();
      expect(res.detail!.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
      expect(res.detail!.endsWith('ack the row or mend the box')).toBe(true);
      expect(rec.calls).toEqual([]);
    });

    it('a finished report is not busy — done, failed and reverted all spawn', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      for (const [i, phase] of (['done', 'failed', 'reverted'] as const).entries()) {
        writeFileSync(p, reportLine({ phase }));
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9' }), phase).toMatchObject({ ok: true, accepted: true });
      }
      expect(rec.calls).toHaveLength(3);
    });

    it('a report the agent cannot use is not busy — unparseable, over the 64 KiB bound', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      writeFileSync(p, '{');
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      // In flight AND over the bound: only the bound can make this one spawn.
      writeFileSync(p, `{"phase":"installing","pad":"${'x'.repeat(70 * 1024)}"}\n`);
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(2);
    });

    it.skipIf(process.getuid?.() === 0)('an unreadable report (EACCES) is not busy', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      writeFileSync(p, reportLine());
      chmodSync(p, 0o000);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(1);
    });

    // A FIFO at the report's name must not wedge the agent in open(2): the read
    // is O_NONBLOCK and refuses anything fstat does not call a regular file.
    // Skipped on Darwin: the FIFO probes are measured flaky on the macOS runner.
    it.skipIf(process.platform === 'darwin')('a FIFO at update.json is not busy, and does not wedge the agent', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      expect(spawnSync('mkfifo', [p]).status).toBe(0);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(1);
    });

    it('readInFlightReport reads the file directly: absent is null, in flight is the report', () => {
      fixture = makeFixture();
      expect(readInFlightReport(fixture.home)).toBeNull();
      writeFileSync(reportPath(fixture.home), reportLine());
      expect(readInFlightReport(fixture.home)).toEqual({ phase: 'installing', target: 'v0.0.8', startedAtS: 1790000000, pid: process.pid });
    });

    it('a second op while the first is still spawning is busy — on this connection AND on another', async () => {
      const rec = recorder();
      const { c } = await up(rec);
      rec.park();
      c.send({ t: 'req', id: 1, op: 'update', tag: 'v0.0.9' });
      await vi.waitFor(() => expect(rec.calls).toHaveLength(1), { timeout: 3000 });
      const DETAIL = 'an update op is already spawning on this agent';
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 2, ok: false, err: 'busy', detail: DETAIL });
      // A reconnecting server is a NEW connection: the gate belongs to the agent
      // process, not to the socket (D-3392).
      const other = await open(agent!.port);
      expect(await other.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'busy', detail: DETAIL });
      rec.release();
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 1))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
      expect(await c.req<Res>(3, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(2);
    });

    it('the gate is checked and set with no await between — two ops sent back to back on ONE connection allow only one spawn', async () => {
      const rec = recorder();
      const { c } = await up(rec);
      rec.park();
      const DETAIL = 'an update op is already spawning on this agent';
      // No await between these two sends: id 2 must land while id 1's
      // synchronous gate-check-and-set stretch has already run to completion,
      // not while it is still pending on some await inserted before the flag
      // is set (which would let both ops pass the gate and both spawn).
      c.send({ t: 'req', id: 1, op: 'update', tag: 'v0.0.9' });
      c.send({ t: 'req', id: 2, op: 'update', tag: 'v0.0.9' });
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 2))
        .toEqual({ t: 'res', id: 2, ok: false, err: 'busy', detail: DETAIL });
      expect(rec.calls).toHaveLength(1);
      rec.release();
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 1))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
    });
  });

  it("the ready frame advertises exactly ['update', 'token-sync'] (§18 \"an agent without the op is never sent it\", the agent half)", async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnUpdate: recorder().spawn });
    const c = new TestClient(agent.port);
    clients.push(c);
    expect((await c.hello() as AgentReady).ops).toEqual(['update', 'token-sync']);
  });

  describe('the op reaches no exec path (§18 "the op never execs") — read from the source', () => {
    const src = readFileSync(SERVER_TS, 'utf8');

    it("handleReq's update case names no exec-surface call; the same cut of the exec case does (the control)", () => {
      const handle = slice(src, 'async function handleReq(', /\n\}\n/);
      const body = slice(handle, "case 'update': {", CASE_END);
      expect(body).not.toMatch(EXEC_PATH);
      expect(body).toMatch(/const file = updateLauncherPath\(home\);/);
      expect(body).toMatch(/const argv = updateSpawnArgv\(req\.kind \?\? 'update', req\.tag\);/);
      expect(body).toMatch(/ctx\.spawnUpdate\(file, argv, UPDATE_SPAWN_TIMEOUT_MS\)/);
      expect(slice(handle, "case 'exec': {", CASE_END)).toMatch(/isExecAllowed\(/);
    });

    it("validateReq's update case calls the one tag guard and the one kind guard, and restates neither", () => {
      const validate = slice(src, 'function validateReq(', /\n\}\n/);
      const body = slice(validate, "case 'update': {", CASE_END);
      expect(body).toMatch(/isReleaseTag\(msg\.tag\)/);
      expect(body).toMatch(/isRequestKind\(kind\)/);
      expect(body, 'the tag shape is restated here').not.toMatch(/\/\^v|RELEASE_TAG/);
    });

    it('the spawn port and the report read name no exec path either', () => {
      const spawnBody = slice(src, 'export function makeUpdateSpawn', /\ninterface PtyEntry/);
      expect(spawnBody).not.toMatch(EXEC_PATH);
      expect(spawnBody).toMatch(/spawn\(file, \[\.\.\.args\], \{ detached: true, stdio: \['ignore', 'pipe', 'pipe'\], env \}\)/);
      const readBody = slice(src, 'export function readUpdateReport(', /\n\}\n/);
      expect(readBody).not.toMatch(EXEC_PATH);
      expect(readBody).toMatch(/NODE_FILES\.report/);
      expect(slice(src, 'export function readInFlightReport(', /\n\}\n/)).not.toMatch(EXEC_PATH);
    });

    it('the exec surface is untouched: ccrc is on neither list, and the exec op refuses the template', () => {
      expect([...EXEC_COMMANDS]).toEqual(['tmux', 'ccd']);
      expect((EXEC_COMMANDS as readonly string[]).includes('ccrc')).toBe(false);
      expect((FORBIDDEN_COMMANDS as readonly string[]).includes('ccrc')).toBe(false);
      const argv = [...updateSpawnArgv('update', 'v0.0.9')];
      expect(isExecAllowed('ccrc', argv)).toBe(false);
      expect(isExecAllowed(updateLauncherPath('/h'), argv)).toBe(false);
    });
  });

  describe('realUpdateSpawn — one real child, under the fixture HOME', () => {
    // CONTAINMENT, not convenience. `execFile` hands the child THIS process's
    // env, which is the operator's: a PATH carrying the real `~/.local/bin` and
    // the real HOME. Every launcher here is the fixture's ABSOLUTE path, but
    // under Step 8's mutation 5 (`const file = 'ccrc';`) an uncontained PATH
    // would resolve the REAL `ccrc` and run a real `ccrc rollback --to v0.0.9
    // --detach --from pwa` against the live box. So every case in this
    // describe runs with PATH cut to the system directories (the scripts need
    // only `/bin/sh`, `printf` and `sleep`) and HOME at the fixture, restored
    // whether the case passed or threw.
    const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
    function contain(home: string): void {
      process.env.PATH = '/usr/bin:/bin';
      process.env.HOME = home;
    }
    afterEach(() => {
      for (const k of ['PATH', 'HOME'] as const) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    });
    function plantLauncher(home: string, body: string): string {
      const bin = path.join(home, '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      const file = path.join(bin, 'ccrc');
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
      return file;
    }

    it("is the agent's default: the absolute launcher runs with the exact argv, and exit 0 is accepted", async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const argvFile = path.join(fixture.home, 'argv');
      plantLauncher(fixture.home, `printf '%s\\n' "$0" "$@" > '${argvFile}'`);
      agent = await boot(fixture);   // NO spawnUpdate: startAgent's default is the thing under test
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9', kind: 'rollback' }))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
      expect(readFileSync(argvFile, 'utf8')).toBe(
        [path.join(fixture.home, '.local', 'bin', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--detach', '--from', 'pwa', '']
          .join('\n'));
    });

    it("a parent that exits 1 is spawn-failed with its first real stderr line, byte for byte", async () => {
      fixture = makeFixture();
      contain(fixture.home);
      plantLauncher(fixture.home, "printf 'ccrc: --detach is Linux-only (decision 17)\\nsecond line\\n' >&2\nexit 1");
      agent = await boot(fixture);
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toEqual({
        t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: 'ccrc: --detach is Linux-only (decision 17)',
      });
    });

    it('a launcher that is not there is spawn-failed naming why, never an empty detail (D-3393)', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      agent = await boot(fixture);
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toEqual({
        t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: 'could not start the launcher (ENOENT)',
      });
    });

    it('a parent that outlives the bound is killed, and says so', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const file = plantLauncher(fixture.home, 'exec sleep 5');
      const t0 = Date.now();
      const r = await realUpdateSpawn(file, updateSpawnArgv('update', 'v0.0.9'), 300);
      expect(r).toMatchObject({ killed: true });
      expect(r.code).not.toBe(0);
      expect(Date.now() - t0).toBeLessThan(4000);
    });
  });
});
