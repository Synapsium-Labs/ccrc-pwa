// Design 2026-09-20 §10 — the `update` op's L0 vocabulary, and the one reader
// of the `detail` its refusals carry (programme wave 5, Task 1).
//
// Four things are pinned here and nowhere else:
//
//  1. The op's refusal words are a CLOSED list (D-3370).
//     `ResErr.err` was a bare string with no vocabulary at all, so the agent's
//     word and the dispatcher's comparison could drift with nothing red.
//  2. The two spawn argvs are TEMPLATES. `updateSpawnArgv` returns one of exactly
//     two shapes, with the tag the only variable token, and throws on any tag
//     `isReleaseTag` refuses: the argv half of §18 "the op validates the tag
//     with the one guard". `updateLauncherPath` is absolute: §18 "the spawn argv
//     is absolute".
//  3. The agent gives up on the `--detach` parent BEFORE the server gives up on
//     the op (Review Focus 4, D-3374). A server that timed out first
//     would release the lease while the node was still starting a run.
//  4. `AgentOpError` (D-3373): an answer the agent SENT is told
//     from a link that FAILED by `instanceof`, never by a message string, and
//     `message` stays `err`, so every existing `.message` caller is unchanged.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  UPDATE_OP, UPDATE_OP_ERRORS, isUpdateOpError, UPDATE_OP_FROM, UPDATE_LAUNCHER_PARTS, updateLauncherPath,
  updateSpawnArgv, UPDATE_SPAWN_TIMEOUT_MS, UPDATE_OP_TIMEOUT_MS, UPDATE_OP_DETAIL_MAX, firstStderrLine,
} from '../../shared/agent-protocol.js';
import { IN_FLIGHT_UPDATE_PHASES, inFlightReport } from '../../shared/api.js';
import { AgentOpError, connectFleet, type ConnectedFleet } from '../src/remote/client.js';
import { TOKEN } from './remoteHelpers.js';

describe('UPDATE_OP_ERRORS — the only words the update op refuses with', () => {
  it('is exactly the four words, and the op and its --from word are what wave 4 spells', () => {
    expect([...UPDATE_OP_ERRORS]).toEqual(['bad-tag', 'bad-kind', 'busy', 'spawn-failed']);
    expect(UPDATE_OP).toBe('update');
    expect(UPDATE_OP_FROM).toBe('pwa');
  });

  it('isUpdateOpError answers exactly the array — no trimming, no case folding, no envelope word', () => {
    for (const w of UPDATE_OP_ERRORS) expect(isUpdateOpError(w), w).toBe(true);
    // `bad-request` is the ENVELOPE's word for an op `validateReq` does not
    // know. From this op it means "the agent predates it" (spec §10), which is
    // exactly why it must never be one of the op's own words.
    for (const v of ['', 'BUSY', ' busy', 'busy ', 'bad-request', 'forbidden', null, undefined, 1]) {
      expect(isUpdateOpError(v), String(v)).toBe(false);
    }
  });
});

describe('the two spawn argv templates (§18 "the op validates the tag with the one guard", "the spawn argv is absolute")', () => {
  it('update and rollback are exactly the spec §10 templates', () => {
    expect([...updateSpawnArgv('update', 'v0.0.9')]).toEqual(['update', '--to', 'v0.0.9', '--detach', '--from', 'pwa']);
    expect([...updateSpawnArgv('rollback', 'v0.0.8')]).toEqual(['rollback', '--to', 'v0.0.8', '--detach', '--from', 'pwa']);
  });

  it('the tag is the only variable token, and a caller cannot append to a template', () => {
    const a = updateSpawnArgv('update', 'v0.0.9');
    const b = updateSpawnArgv('update', 'v10.20.30');
    expect(a.map((t, i) => (t === b[i] ? '=' : i))).toEqual(['=', '=', 2, '=', '=', '=']);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('throws on any tag isReleaseTag refuses — a caller bug, never a spawn', () => {
    for (const tag of ['; rm -rf ~', 'v0.0.9 ', 'v0.0.9\n', '0.0.9', 'V0.0.9', 'v0.0', '', 'v0.0.9; rm -rf ~']) {
      for (const kind of ['update', 'rollback'] as const) {
        expect(() => updateSpawnArgv(kind, tag), `${kind} ${JSON.stringify(tag)}`).toThrow(RangeError);
      }
    }
  });

  it('throws on a kind outside RequestKind', () => {
    for (const kind of ['sideways', 'Update', '', 'install']) {
      expect(() => updateSpawnArgv(kind as never, 'v0.0.9'), kind).toThrow(RangeError);
    }
  });

  it('the launcher is $HOME/.local/bin/ccrc — absolute, never bare ccrc', () => {
    expect([...UPDATE_LAUNCHER_PARTS]).toEqual(['.local', 'bin', 'ccrc']);
    expect(updateLauncherPath('/h')).toBe('/h/.local/bin/ccrc');
    expect(updateLauncherPath('/tmp/fixture-home')).toBe('/tmp/fixture-home/.local/bin/ccrc');
    for (const home of ['h', '', './h', '~/h', '/h/', '/']) {
      expect(() => updateLauncherPath(home), JSON.stringify(home)).toThrow(RangeError);
    }
  });
});

describe('the op timeouts — the agent answers before the server gives up (Review Focus 4, D-3374)', () => {
  it('UPDATE_SPAWN_TIMEOUT_MS is strictly below UPDATE_OP_TIMEOUT_MS', () => {
    expect(UPDATE_SPAWN_TIMEOUT_MS).toBe(20_000);
    expect(UPDATE_OP_TIMEOUT_MS).toBe(30_000);
    expect(UPDATE_SPAWN_TIMEOUT_MS).toBeLessThan(UPDATE_OP_TIMEOUT_MS);
  });
});

describe('firstStderrLine — what a spawn-failed answer carries (D-3372)', () => {
  it('is the first line with anything in it, exactly', () => {
    expect(firstStderrLine('\n\nccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)\nsecond\n'))
      .toBe('ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)');
    expect(firstStderrLine('\r\n  \nline one\r\nline two')).toBe('line one');
  });

  it("keeps printable ASCII only — every other run is one space, then trimmed (W2's printableDetail rule)", () => {
    expect(firstStderrLine('a—b\u0000c')).toBe('a b c');
    expect(firstStderrLine('\tindented\u0007')).toBe('indented');
    // A RUN of several non-printable characters folds to exactly one space,
    // not one space per character: `\u0000\u0001—` is three, not one.
    expect(firstStderrLine('a\u0000\u0001—b')).toBe('a b');
  });

  it('is cut to UPDATE_OP_DETAIL_MAX', () => {
    expect(UPDATE_OP_DETAIL_MAX).toBe(200);
    expect(firstStderrLine('x'.repeat(300))).toBe('x'.repeat(200));
  });

  it("says 'no message' when there is no line at all — never an empty detail", () => {
    for (const s of ['', '\n', ' \n\t\n', '\u0000']) expect(firstStderrLine(s), JSON.stringify(s)).toBe('no message');
  });
});

/** wave 4's `update.json` line — seven keys, times in unix SECONDS (rulings R1/R14). */
const LINE = (o: Record<string, unknown> = {}): string => `${JSON.stringify({
  target: 'v0.0.9', phase: 'installing', startedAt: 1790000000, updatedAt: 1790000060, detail: null, from: 'pwa',
  pid: 4242, ...o,
})}\n`;

describe('inFlightReport — is a run in flight right now (asked by the agent and by the server-role spawn)', () => {
  it('every in-flight phase is in flight — and the list is not empty', () => {
    expect(IN_FLIGHT_UPDATE_PHASES).toHaveLength(9);
    for (const phase of IN_FLIGHT_UPDATE_PHASES) {
      expect(inFlightReport(LINE({ phase })), phase).toEqual({ phase, target: 'v0.0.9', startedAtS: 1790000000 });
    }
  });

  it('a terminal, unknown or off-vocabulary phase is not in flight', () => {
    for (const phase of ['done', 'reverted', 'failed', 'unknown', 'installed', 'INSTALLING', '', null, 3]) {
      expect(inFlightReport(LINE({ phase })), String(phase)).toBeNull();
    }
    // `undefined` is dropped by JSON.stringify: a report with no phase key at all.
    expect(inFlightReport(LINE({ phase: undefined }))).toBeNull();
  });

  it("reads wave 4's seven-key line by name — the pid key, and any newer key, is ignored (ruling R2)", () => {
    expect(inFlightReport(LINE())).toEqual({ phase: 'installing', target: 'v0.0.9', startedAtS: 1790000000 });
    expect(inFlightReport(LINE({ extra: { nested: true } })))
      .toEqual({ phase: 'installing', target: 'v0.0.9', startedAtS: 1790000000 });
  });

  it('a start time that is not unix SECONDS reads null, and the report is kept (ruling R1)', () => {
    for (const startedAt of [1790000000000, 0, -1, 1.5, '1790000000', null]) {
      expect(inFlightReport(LINE({ startedAt })), String(startedAt))
        .toEqual({ phase: 'installing', target: 'v0.0.9', startedAtS: null });
    }
  });

  it('a target off the tag shape reads null', () => {
    for (const target of [null, 'latest', 'v0.0.9 ', 9]) {
      expect(inFlightReport(LINE({ target }))?.target, String(target)).toBeNull();
    }
  });

  it('a text that is not one JSON object is not in flight', () => {
    // `typeof parsed !== 'object'` and `Array.isArray(parsed)` are defence in
    // depth that no case here actually distinguishes: JSON's array syntax
    // cannot carry a named `phase` key (`JSON.stringify` drops non-index
    // properties on an array, and there is no array *literal* syntax for one
    // either), and reading `.phase` off any other non-object JSON value
    // (a string, a number, a boolean) is a safe `undefined` through
    // auto-boxing, never a throw — only `null` throws, and that is pinned
    // separately below. So every case here would read the same `null` with
    // just the `parsed === null` guard in place; they still exercise real
    // parse/shape edges (a truncated document, a bare array, a primitive, an
    // empty string, an array of objects), just not those two guards apart
    // from the null one.
    for (const text of ['{', '[]', 'null', '"installing"', '42', '', '[{"phase":"installing"}]']) {
      expect(inFlightReport(text), JSON.stringify(text)).toBeNull();
    }
  });
});

/** A hand-rolled agent: the hello/ready handshake, then every `req` answered by
 *  `answer` — or, for `'drop'`, the socket terminated under the request. */
function fakeAgent(
  answer: (req: Record<string, unknown>) => Record<string, unknown> | 'drop',
): Promise<{ port: number; wss: WebSocketServer }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const address = wss.address();
      resolve({ port: typeof address === 'object' && address !== null ? address.port : 0, wss });
    });
    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.t === 'hello') { ws.send(JSON.stringify({ t: 'ready', v: 1 })); return; }
        if (msg.t !== 'req') return;
        const a = answer(msg);
        if (a === 'drop') { ws.terminate(); return; }
        ws.send(JSON.stringify({ t: 'res', id: msg.id, ...a }));
      });
    });
  });
}

describe('AgentOpError — the one reader of ResErr.detail (D-3373)', () => {
  let wss: WebSocketServer | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
    }
    wss = undefined;
  });

  async function connect(answer: Parameters<typeof fakeAgent>[0]): Promise<ConnectedFleet> {
    const agent = await fakeAgent(answer);
    wss = agent.wss;
    fleet = connectFleet({ url: `ws://127.0.0.1:${agent.port}`, token: TOKEN, heartbeatMs: 60_000, reconnectMinMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    return fleet;
  }
  /** The rejection itself, as a value — a resolution is a failure of the case. */
  const rejection = (p: Promise<unknown>): Promise<unknown> =>
    p.then(() => { throw new Error('the request resolved'); }, (e: unknown) => e);
  const OP = { t: 'req', op: 'update', tag: 'v0.0.9' } as const;

  it('an answer the agent sent carries its word and its detail; message stays the word', async () => {
    const DETAIL = 'update.json says installing (target v0.0.8, started 1790000000)';
    const f = await connect(() => ({ ok: false, err: 'busy', detail: DETAIL }));
    const e = await rejection(f.client.request(OP));
    expect(e).toBeInstanceOf(AgentOpError);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ name: 'AgentOpError', message: 'busy', code: 'busy', detail: DETAIL });
  });

  it('no detail, or a detail that is not a string, reads null — absence permits', async () => {
    let n = 0;
    const f = await connect(() => (n++ === 0 ? { ok: false, err: 'spawn-failed' } : { ok: false, err: 'bad-tag', detail: 42 }));
    expect(await rejection(f.client.request(OP))).toMatchObject({ code: 'spawn-failed', detail: null });
    expect(await rejection(f.client.request(OP))).toMatchObject({ code: 'bad-tag', detail: null });
  });

  it('a detail longer than UPDATE_OP_DETAIL_MAX is cut at this reader (D-3391)', async () => {
    const f = await connect(() => ({ ok: false, err: 'spawn-failed', detail: 'y'.repeat(300) }));
    expect(await rejection(f.client.request(OP))).toMatchObject({ code: 'spawn-failed', detail: 'y'.repeat(UPDATE_OP_DETAIL_MAX) });
  });

  it("an err that is not a string reads 'error', as it always did", async () => {
    const f = await connect(() => ({ ok: false, err: 7 }));
    expect(await rejection(f.client.request(OP))).toMatchObject({ message: 'error', code: 'error', detail: null });
  });

  it("every existing .message caller is unchanged — the runner still reports the agent's word as stderr", async () => {
    const f = await connect(() => ({ ok: false, err: 'forbidden' }));
    await expect(f.runner('tmux', ['has-session', '-t', 'cc-x'])).resolves.toMatchObject({ code: 1, stderr: 'forbidden' });
  });

  it('a link that fails is NOT an AgentOpError — the dispatcher tells the two apart by instanceof', async () => {
    const f = await connect(() => 'drop');
    const e = await rejection(f.client.request(OP));
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(AgentOpError);
    expect((e as Error).message).toBe('disconnected');
  });
});
