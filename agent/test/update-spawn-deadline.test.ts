// The bounded `--detach` spawner's TIMING and ERROR arms (I1, M2), driven against a FAKE child under fake timers:
// a real parent cannot be made to exit late (it cannot ignore SIGKILL), and a real pipe cannot be made to error on
// demand, so the deadline arithmetic and the `error` events are pinned here and the real-process rule stays in
// `update-spawn.test.ts`. `node:child_process` is mocked to hand back the fake; `process.kill` is spied so no real
// pid is ever signalled. The twin over the other role is ``server/test/update-spawn-deadline.test.ts``.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { UPDATE_SPAWN_DRAIN_MS } from '../../shared/agent-protocol.js';
import { makeUpdateSpawn } from '../src/server.js';

const h = vi.hoisted(() => ({ child: null as unknown }));
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: vi.fn(() => h.child),
}));

const FAKE_PID = 424242;
class FakeChild extends EventEmitter {
  pid: number | undefined = FAKE_PID;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}
let child: FakeChild;
let killSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  child = new FakeChild();
  h.child = child;
  killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(() => { vi.useRealTimers(); killSpy.mockRestore(); });

const BOUND = 1000;
const run = () => makeUpdateSpawn(process.env)('launcher', [], BOUND);

describe('the drain is ONE absolute deadline (I1)', () => {
  it('a killed parent that exits just before the drain runs out does not restart it: the answer is at T + D, not T + 2D', async () => {
    let answered = false;
    const p = run().then((r) => { answered = true; return r; });
    await vi.advanceTimersByTimeAsync(BOUND);
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(UPDATE_SPAWN_DRAIN_MS - 100);
    child.emit('exit', null, 'SIGKILL');   // T + D - 100: the parent exits late; a grandchild still holds the pipes
    await vi.advanceTimersByTimeAsync(100);
    expect(answered, 'the answer came after T + D: the exit restarted the drain').toBe(true);
    expect(await p).toEqual({ code: 137, stdout: null, stderr: '', killed: true, pid: FAKE_PID });
  });

  it('a parent that never exits after the kill is answered at T + D, code 1, killed', async () => {
    const p = run();
    await vi.advanceTimersByTimeAsync(BOUND + UPDATE_SPAWN_DRAIN_MS);
    expect(await p).toEqual({ code: 1, stdout: null, stderr: '', killed: true, pid: FAKE_PID });
  });

  it('an exit before the bound arms the drain at the exit: answered at exit + D with stdout null while the pipes stay open', async () => {
    let answered = false;
    const p = run().then((r) => { answered = true; return r; });
    await vi.advanceTimersByTimeAsync(300);
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(UPDATE_SPAWN_DRAIN_MS - 1);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
    expect(await p).toEqual({ code: 0, stdout: null, stderr: '', killed: false, pid: FAKE_PID });
  });
});

describe('an error event never crashes the spawner (M2)', () => {
  it('a second `error` event on the child — the kill fallback\'s `child.kill()` can emit one — throws nothing and the run still answers', async () => {
    const p = run();
    expect(() => { child.emit('error', Object.assign(new Error('boom'), { code: 'EPERM' })); }).not.toThrow();
    expect(() => { child.emit('error', Object.assign(new Error('boom again'), { code: 'EPERM' })); }).not.toThrow();
    child.stdout.emit('end');
    child.stderr.emit('end');
    child.emit('exit', 0, null);
    expect(await p).toMatchObject({ code: 0, killed: false, stdout: '', pid: FAKE_PID });
  });

  it('a kill whose group signal fails with EPERM falls back to the parent alone, and a second error from that kill is tolerated', async () => {
    killSpy.mockImplementation(() => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); });
    child.kill.mockImplementation(() => { child.emit('error', new Error('kill failed')); return false; });
    const p = run();
    await vi.advanceTimersByTimeAsync(BOUND);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await vi.advanceTimersByTimeAsync(UPDATE_SPAWN_DRAIN_MS);
    expect(await p).toMatchObject({ killed: true, stdout: null });
  });

  it('an error on the stdout pipe marks the capture incomplete: stdout null, and the answer is not held for the drain', async () => {
    const p = run();
    child.stdout.emit('data', Buffer.from('partial'));
    expect(() => child.stdout.emit('error', new Error('EPIPE'))).not.toThrow();
    child.stderr.emit('data', Buffer.from('err\n'));
    child.stderr.emit('end');
    child.emit('exit', 0, null);
    expect(await p).toEqual({ code: 0, stdout: null, stderr: 'err\n', killed: false, pid: FAKE_PID });
  });

  it('an error on the stderr pipe throws nothing and the answer still arrives with stdout intact', async () => {
    const p = run();
    child.stdout.emit('data', Buffer.from('all of it'));
    child.stdout.emit('end');
    expect(() => child.stderr.emit('error', new Error('ECONNRESET'))).not.toThrow();
    child.emit('exit', 0, null);
    expect(await p).toMatchObject({ code: 0, stdout: 'all of it', killed: false });
  });
});
