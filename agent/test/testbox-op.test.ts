// D-7411, D-7427, D-7430, D-7555 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28 §2.7,
// §2.10). The fleet agent's `testbox` and `testbox-tools-sync` ops. Two layers, the `disk` op's idiom:
//  - the wire (a REAL agent over loopback against a fixture HOME): both ops are advertised in `ready.ops`, take no
//    field, and a frame carrying any field is `bad-request` and starts nothing;
//  - the op bodies (`measureTestbox`, `syncTestboxTools`) against fixture programs: a fixture `systemctl` on the
//    agent's PATH answers a user manager's environment whose PATH names fixture tools, a fixture launcher prints the
//    settings, and an in-process WebSocket server stands in for the test box. Nothing reaches a real box, a real
//    user manager or a real tool: every fixture program is a fixed script of shell builtins.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { RunningAgent } from '../src/server.js';
import { KNOBS_ARGV, PROBES, SHOW_ENV_ARGV, measureTestbox, parseShowEnvironment, syncTestboxTools, versionOf } from '../src/testboxOp.js';
import {
  TESTBOX_OP, TESTBOX_TOOLS_SYNC_OP, readTestboxOpReply, readTestboxToolsSyncReply, type AgentReady,
} from '../../shared/agent-protocol.js';
import { CAP_WORD } from '../../shared/api.js';
import { TESTBOX_PROTO, TESTBOX_TOOLS, type StatusAnswer, type ToolsSync } from '../../shared/testbox.js';
import { boot, makeFixture, TestClient } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const US = '\x1f';
const NOW = Date.parse('2026-10-30T12:00:00Z');
/** What each fixture tool prints, in the shape the real one does. */
const TOOL_OUT: Readonly<Record<string, string>> = {
  node: 'v22.99.1', npm: '10.9.0', tmux: 'tmux 3.4', git: 'git version 2.43.0', python3: 'Python 3.12.3',
  chrome: 'Google Chrome for Testing 131.0.6778.85',
};
const MEASURED = { node: '22.99.1', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };

/** A fixed script of shell builtins: it appends its name and argv to `$HOME/calls.log`, then prints `out`. */
function script(file: string, name: string, out: string): void {
  writeFileSync(file, [
    '#!/bin/sh',
    `printf '%s' '${name}' >> "$HOME/calls.log"`,
    `for a in "$@"; do printf ' %s' "$a" >> "$HOME/calls.log"; done`,
    `printf ' PATH=%s\\n' "$PATH" >> "$HOME/calls.log"`,
    `printf '%s\\n' '${out}'`,
    '',
  ].join('\n'));
  chmodSync(file, 0o755);
}

/** A script that prints a file under `$HOME` line by line, with builtins only. */
function catScript(file: string, name: string, rel: string): void {
  writeFileSync(file, [
    '#!/bin/sh',
    `printf '%s' '${name}' >> "$HOME/calls.log"`,
    `for a in "$@"; do printf ' %s' "$a" >> "$HOME/calls.log"; done`,
    `printf '\\n' >> "$HOME/calls.log"`,
    `[ -f "$HOME/${rel}" ] || exit 3`,
    `while IFS= read -r l || [ -n "$l" ]; do printf '%s\\n' "$l"; done < "$HOME/${rel}"`,
    '',
  ].join('\n'));
  chmodSync(file, 0o755);
}

interface World { home: string; agentBin: string; userBin: string; agentPath: string; calls(): string[] }

function world(o: { url?: string; poll?: string; userEnv?: string | null; release?: string | null; tools?: Partial<Record<string, string | null>> } = {}): World {
  const home = makeFixture().home;
  const agentBin = mkTmp('tb-agent-bin-');
  const userBin = mkTmp('tb-user-bin-');
  // The agent's own PATH holds systemctl and a DIFFERENT node, so a probe that ran on it would read 1.0.0.
  catScript(path.join(agentBin, 'systemctl'), 'systemctl', 'user-manager.env');
  script(path.join(agentBin, 'node'), 'agent-node', 'v1.0.0');
  for (const t of TESTBOX_TOOLS) {
    const out = o.tools !== undefined && t in o.tools ? o.tools[t] : TOOL_OUT[t]!;
    if (out === null) continue;
    script(path.join(userBin, t === 'chrome' ? 'chrome-for-testing' : t), t, out!);
  }
  if (o.userEnv !== null) {
    writeFileSync(path.join(home, 'user-manager.env'), o.userEnv
      ?? `HOME=${home}\nLANG=C.UTF-8\nPATH=${userBin}\nCCRC_CHROME=${path.join(userBin, 'chrome-for-testing')}\nODD=$'a\\nb'\n`);
  }
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  catScript(path.join(home, '.local', 'bin', 'ccrc'), 'ccrc', 'knobs.out');
  const tokenFile = path.join(home, '.ccrc', 'testbox.token');
  mkdirSync(path.dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, 'fixture-token\n');
  writeFileSync(path.join(home, 'knobs.out'), [
    ['CCRC_TESTBOX_URL', '', o.url ?? '', 'the fixture'],
    ['CCRC_TESTBOX_TOKEN_FILE', '~/.ccrc/testbox.token', '~/.ccrc/testbox.token', 'default'],
    ['CCRC_TESTBOX_STATUS_DEADLINE', '3s', '2s', 'the fixture'],
    ['CCRC_TESTBOX_POLL', '30s', o.poll ?? '45s', 'the fixture'],
  ].map((f) => f.join(US)).join('\n') + '\n');
  if (o.release !== null) {
    writeFileSync(path.join(home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-30T00:00:00Z', dirty: false, version: o.release ?? 'v0.0.900',
    }));
  }
  const agentPath = `${agentBin}`;
  return {
    home, agentBin, userBin, agentPath,
    calls: () => (existsSync(path.join(home, 'calls.log')) ? readFileSync(path.join(home, 'calls.log'), 'utf8').split('\n').filter((l) => l !== '') : []),
  };
}

const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900',
  tools: MEASURED, sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0,
  pristine: [], failedKeys: [], heldRunUsers: [], repositories: [{ name: 'project-a', mirrorPath: '/srv/mirror/project-a.git' }],
};

interface Box { url: string; hellos: unknown[]; frames: unknown[]; close(): Promise<void> }
const boxes: Box[] = [];
/** The stand-in test box: it answers a hello with `answer` (the status, D-7501) and records every later frame. */
async function box(answer: unknown = STATUS): Promise<Box> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const hellos: unknown[] = [];
  const frames: unknown[] = [];
  wss.on('connection', (ws: WsSocket) => {
    let first = true;
    ws.on('message', (raw) => {
      const m: unknown = JSON.parse(String(raw));
      if (first) { first = false; hellos.push(m); ws.send(JSON.stringify(answer)); return; }
      frames.push(m);
    });
  });
  const port = (wss.address() as { port: number }).port;
  const b: Box = {
    url: `ws://127.0.0.1:${port}`, hellos, frames,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }),
  };
  boxes.push(b);
  return b;
}

let agent: RunningAgent | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await agent?.close();
  agent = undefined;
  for (const b of boxes.splice(0)) await b.close();
});

const seams = (w: World) => ({ agentPath: w.agentPath, now: () => NOW });
/** Wait until the box has recorded `n` frames (the frame is sent just before the op's connection closes). */
async function framesOf(b: Box, n: number): Promise<unknown[]> {
  for (let i = 0; i < 100 && b.frames.length < n; i++) await new Promise((r) => setTimeout(r, 10));
  return b.frames;
}

describe('the testbox ops on the wire (D-7411, D-7555)', () => {
  async function connect(w: World): Promise<TestClient> {
    agent = await boot({ home: w.home, projectsRoot: mkTmp('tb-projects-'), outside: mkTmp('tb-outside-') }, { testboxSeams: seams(w) });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }
  const res = (c: TestClient, id: number) =>
    c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as Promise<Record<string, unknown>>;

  it('both ops are in ready.ops, which has 7 words, every one on CAP_WORD', async () => {
    const c = await connect(world());
    const ops = (await c.hello() as AgentReady).ops!;
    expect(ops).toContain(TESTBOX_OP);
    expect(ops).toContain(TESTBOX_TOOLS_SYNC_OP);
    expect(ops).toHaveLength(7);
    expect(ops.filter((w) => !CAP_WORD.test(w))).toEqual([]);
    expect(TESTBOX_TOOLS_SYNC_OP).toBe('testbox-tools-sync');
  });

  it('the testbox op answers the measurement and the box\'s status, with no request field', async () => {
    const b = await box();
    const w = world({ url: b.url });
    const c = await connect(w);
    await c.hello();
    c.send({ t: 'req', id: 3, op: 'testbox' });
    const r = await res(c, 3);
    expect(r.ok).toBe(true);
    const reply = readTestboxOpReply(r);
    expect(reply?.box).toEqual({ ok: true, status: STATUS });
    expect(reply?.host.tools).toEqual(MEASURED);
    expect(reply?.pollMs).toBe(45_000);
  });

  it('a request with any field is a bad request, for either op, and nothing is spawned', async () => {
    const b = await box();
    const w = world({ url: b.url });
    const c = await connect(w);
    await c.hello();
    const cases = [
      [8, 'testbox', { path: '/etc/shadow' }], [9, 'testbox', { url: 'ws://elsewhere.invalid' }],
      // The replayed sync, carrying a release and versions of the page's own: refused, and nothing reaches the box.
      [10, 'testbox-tools-sync', { release: 'v9.9.9', versions: MEASURED }], [11, 'testbox-tools-sync', { body: {} }],
    ] as const;
    for (const [id, op, extra] of cases) {
      c.send({ t: 'req', id, op, ...extra });
      expect(await res(c, id), `${op} ${JSON.stringify(extra)}`).toMatchObject({ ok: false, err: 'bad-request' });
    }
    expect(w.calls(), 'no fixed spawn ran').toEqual([]);
    expect(b.hellos).toEqual([]);
    expect(b.frames).toEqual([]);
  });

  it('the tools sync over the wire sends build.json\'s release and the fresh measurement', async () => {
    const b = await box();
    const w = world({ url: b.url, release: 'v0.0.901' });
    const c = await connect(w);
    await c.hello();
    c.send({ t: 'req', id: 4, op: 'testbox-tools-sync' });
    const reply = readTestboxToolsSyncReply(await res(c, 4));
    const sent: ToolsSync = { t: 'tools.sync', release: 'v0.0.901', versions: MEASURED, measuredAt: '2026-10-30T12:00:00Z' };
    expect(reply).toEqual({ outcome: 'sent', detail: null, frame: sent });
    expect(await framesOf(b, 1)).toEqual([sent]);
  });
});

describe('measureTestbox: the fixed spawns (D-7427, D-7430)', () => {
  it('the user manager\'s environment is read through the fixed argv on the agent\'s PATH', async () => {
    const w = world();
    await measureTestbox(w.home, seams(w));
    expect(SHOW_ENV_ARGV).toEqual(['--user', 'show-environment']);
    expect(w.calls().filter((l) => l.startsWith('systemctl'))).toEqual(['systemctl --user show-environment']);
  });

  it('the settings are read through the fixed argv `ccrc test --testbox-knobs host`, from the home\'s launcher', async () => {
    const w = world();
    await measureTestbox(w.home, seams(w));
    expect(KNOBS_ARGV).toEqual(['test', '--testbox-knobs', 'host']);
    expect(w.calls().filter((l) => l.startsWith('ccrc'))).toEqual(['ccrc test --testbox-knobs host']);
  });

  it('every probe runs on the user manager\'s PATH: the fixture node there, never the agent\'s own', async () => {
    const w = world();
    const r = await measureTestbox(w.home, seams(w));
    expect(r.host.tools).toEqual(MEASURED);
    expect(r.host.tools.node, 'the agent PATH\'s node answers 1.0.0').not.toBe('1.0.0');
    const probes = w.calls().filter((l) => !l.startsWith('systemctl') && !l.startsWith('ccrc'));
    expect(probes.map((l) => l.split(' ')[0]).sort()).toEqual([...TESTBOX_TOOLS].sort());
    for (const l of probes) expect(l.endsWith(` PATH=${w.userBin}`), l).toBe(true);
    for (const t of TESTBOX_TOOLS) expect(probes.find((l) => l.startsWith(`${t} `)), t).toContain(` ${PROBES[t].args.join(' ')} PATH=`);
  });

  it('with no user manager environment, nothing is measured: a version from another PATH is not the sessions\'', async () => {
    const w = world({ userEnv: null });
    const r = await measureTestbox(w.home, seams(w));
    expect(r.host.tools).toEqual(Object.fromEntries(TESTBOX_TOOLS.map((t) => [t, null])));
  });

  it('a probe that fails or prints no version is unmeasured, never a guess; a relative CCRC_CHROME is not run', async () => {
    const w = world({ tools: { git: null, npm: 'no version here' } });
    writeFileSync(path.join(w.home, 'user-manager.env'), `PATH=${w.userBin}\nCCRC_CHROME=chrome-for-testing\n`);
    const r = await measureTestbox(w.home, seams(w));
    expect(r.host.tools).toEqual({ ...MEASURED, git: null, npm: null, chrome: null });
    expect(w.calls().some((l) => l.startsWith('chrome'))).toBe(false);
  });

  it('the release is build.json\'s version when it is a tag, else null; the clock is the measurement time', async () => {
    const w = world({ release: 'untagged-abc1234' });
    const r = await measureTestbox(w.home, seams(w));
    expect(r.host.release).toBeNull();
    expect(r.host.measuredAt).toBe('2026-10-30T12:00:00Z');
  });
});

describe('measureTestbox: the box call', () => {
  it('no CCRC_TESTBOX_URL is unconfigured, and no connection is made', async () => {
    const w = world({ url: '' });
    const r = await measureTestbox(w.home, seams(w));
    expect(r.box).toEqual({ ok: false, failure: 'unconfigured', detail: null });
    expect(r.pollMs).toBe(45_000);
  });

  it('the hello carries the token file\'s token, and the status answer is the reply', async () => {
    const b = await box();
    const w = world({ url: b.url });
    const r = await measureTestbox(w.home, seams(w));
    expect(b.hellos).toEqual([{ t: 'hello', token: 'fixture-token' }]);
    expect(r.box).toEqual({ ok: true, status: STATUS });
    expect(readTestboxOpReply(r)).toEqual(r);
  });

  it('a box that answers something other than a status answer is bad-answer', async () => {
    const b = await box({ t: 'status', state: 'ok' });
    const w = world({ url: b.url });
    const r = await measureTestbox(w.home, seams(w));
    expect(r.box).toMatchObject({ ok: false, failure: 'bad-answer' });
  });

  it('a box that does not answer is unreachable, with the detail', async () => {
    const b = await box();
    const url = b.url;
    await b.close();
    boxes.splice(boxes.indexOf(b), 1);
    const w = world({ url });
    const r = await measureTestbox(w.home, seams(w));
    expect(r.box).toMatchObject({ ok: false, failure: 'unreachable' });
    expect((r.box as { detail: string }).detail.length).toBeGreaterThan(0);
  });

  it('settings that cannot be read are unreachable with the printer\'s words, and no poll is carried', async () => {
    const w = world();
    writeFileSync(path.join(w.home, 'knobs.out'), 'not four fields\n');
    const r = await measureTestbox(w.home, seams(w));
    expect(r.box).toMatchObject({ ok: false, failure: 'unreachable' });
    expect((r.box as { detail: string }).detail).toMatch(/the test box settings cannot be read/);
    expect(r.pollMs).toBeNull();
  });
});

describe('syncTestboxTools: nothing in the frame comes from the request', () => {
  it('a tool not measured refuses the sync as unmeasured, and nothing is sent', async () => {
    const b = await box();
    const w = world({ url: b.url, tools: { tmux: null } });
    const r = await syncTestboxTools(w.home, seams(w));
    expect(r).toEqual({ outcome: 'unmeasured', detail: 'not measured on the fleet host: tmux', frame: null });
    expect(b.hellos).toEqual([]);
  });

  it('no release in build.json refuses the sync as unmeasured', async () => {
    const b = await box();
    const w = world({ url: b.url, release: null });
    const r = await syncTestboxTools(w.home, seams(w));
    expect(r.outcome).toBe('unmeasured');
    expect(r.detail).toMatch(/the release/);
  });

  it('no URL is unconfigured; the reply round-trips through the one reader', async () => {
    const w = world({ url: '' });
    const r = await syncTestboxTools(w.home, seams(w));
    expect(r).toEqual({ outcome: 'unconfigured', detail: null, frame: null });
    expect(readTestboxToolsSyncReply(r)).toEqual(r);
  });
});

describe('the probe readers', () => {
  it('versionOf reads each tool\'s first version word, Chrome\'s last', () => {
    expect(Object.fromEntries(TESTBOX_TOOLS.map((t) => [t, versionOf(t, TOOL_OUT[t]!)]))).toEqual(MEASURED);
    expect(versionOf('tmux', 'tmux 3.3a')).toBe('3.3a');
    expect(versionOf('git', 'git version 2.39.5 (Apple Git-154)')).toBe('2.39.5');
    expect(versionOf('npm', 'command not found')).toBeNull();
    expect(versionOf('node', '')).toBeNull();
  });

  it('parseShowEnvironment reads KEY=value lines and skips an escaped value', () => {
    expect([...parseShowEnvironment("PATH=/a:/b\nODD=$'x\\ny'\nLANG=C\n")]).toEqual([['PATH', '/a:/b'], ['LANG', 'C']]);
  });
});
