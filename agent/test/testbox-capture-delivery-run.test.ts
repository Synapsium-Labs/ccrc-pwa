// The paste delivery recipe on the capture runner (Desktop polish wave 178): `captureRunner.ts`'s delivery branch and
// `captureDeliveryRun.ts`, against a FAKE build (`fixtures/fake-delivery-build.mjs`, never a real one), the real stand-in
// model and the recorder's own source. The product's send is the driver's (`server/test/delivery-drive.test.ts`); here a
// fake driver types each case's text into the fake build, so what is measured is the recipe: each case's window, the
// verdicts, the word, the cut between a fault of the box and a result, the bounds, and the clean-up on every path. The
// build-trust recipe is held unchanged beside it.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTestboxCaptureReply } from '../../shared/agent-protocol.js';
import { deliveryCaseText, deliveryExpected } from '../../shared/deliveryCapture.js';
import { DELIVERY_PART_COUNT, deliveryParts, readDeliveryCaptureResult, type DeliveryRoute } from '../../shared/deliveryResult.js';
import { CAPTURE_SOCKET, CAPTURE_TMUX_SESSION, captureBuildsDir, captureEnv, capturePaths, standInReply } from '../src/testbox/capture.js';
import { DELIVERY_PANE, DELIVERY_REPLY_TEXT, deliveryStandInReply } from '../src/testbox/captureDelivery.js';
import { nodeDeliveryDriver, readDriverAnswer, DRIVER_BOX_FAULT_SENDS, runDeliveryDrive, type DeliveryDriveContext, type DeliveryDriver, type DriverAnswer } from '../src/testbox/captureDeliveryRun.js';
import { recorderPath } from '../src/testbox/captureRecord.js';
import { CAPTURE_SHELL, CAPTURE_START, CaptureRunner, DELIVERY_NO_PART, tmuxLauncher, type CaptureLaunchSpec, type CaptureLauncher, type CaptureRunnerDeps } from '../src/testbox/captureRunner.js';
import { startStandIn } from '../src/testbox/captureStub.js';
import { boundedExec } from '../src/testbox/exec.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DELIVERY_BUILD = path.join(HERE, 'fixtures', 'fake-delivery-build.mjs');
const TRUST_BUILD = path.join(HERE, 'fixtures', 'fake-claude-build.mjs');
const RECORDER = [process.execPath, '--experimental-strip-types', '--no-warnings', recorderPath()];
const NODE_DIR = path.dirname(process.execPath);
const GOOD = '2.1.100';
const DUPLICATES = '2.1.990';
const SPLITS = '2.1.989';
const TRUNCATES = '2.1.988';
const DIES = '2.1.987';
const SIDE = '2.1.986';
const LATE = '2.1.985';
const COUNTS = '2.1.984';
/** The settle and quiet bounds the runner is handed (`CaptureDeliveryDeps`); the driver's bound is the fake driver's own. */
const BOUNDS = { settleMs: 8_000, quietMs: 150 } as const;

/** The test launcher: the build as a child, stdin piped; the last one started is kept, for the fake driver to type into. */
function pipeLauncher(): { launcher: CaptureLauncher; child: () => ChildProcess; specs: CaptureLaunchSpec[] } {
  let last: ChildProcess | null = null;
  const specs: CaptureLaunchSpec[] = [];
  const launcher: CaptureLauncher = {
    async start(spec) {
      specs.push(spec);
      const child = spawn(process.execPath, [spec.binary], { cwd: spec.cwd, env: Object.fromEntries(spec.env), stdio: ['pipe', 'ignore', 'ignore'] });
      last = child;
      let exited = false;
      child.on('exit', () => { exited = true; });
      child.on('error', () => { exited = true; });
      return {
        type: async (text) => { child.stdin!.write(`${text}\n`); },
        life: async () => (exited ? 'gone' as const : 'alive' as const),
        stop: async () => { child.kill('SIGKILL'); },
      };
    },
  };
  return { launcher, child: () => last!, specs };
}

/** A fake driver: types the case's text (one JSON line) into the build, then answers what `answer` says. */
const typingDriver = (child: () => ChildProcess, answer: (id: string) => DriverAnswer = () => ({ kind: 'sent', send: 'ok' })): DeliveryDriver => ({
  async drive(input) {
    child().stdin!.write(`JSON:${JSON.stringify(deliveryCaseText(input.case))}\n`);
    return answer(input.case);
  },
});

function place(root: string, version: string, fixture = DELIVERY_BUILD): void {
  mkdirSync(captureBuildsDir(root), { recursive: true });
  const f = path.join(captureBuildsDir(root), version);
  copyFileSync(fixture, f);
  chmodSync(f, 0o755);
}

function runner(root: string, launcher: CaptureLauncher, driver: DeliveryDriver | null, over: Partial<CaptureRunnerDeps> = {}): CaptureRunner {
  return new CaptureRunner({
    root, tmuxBase: root, recorder: RECORDER, toolsPath: () => NODE_DIR, launcher,
    standIn: (reply) => startStandIn(reply === undefined ? {} : { reply }),
    stepTimeoutMs: 20_000, exitTimeoutMs: 10_000, pollMs: 50, stopWaitMs: 5000, standInCloseMs: 2000,
    ...(driver === null ? {} : { delivery: { driver, tmuxConf: null, release: null, ...BOUNDS } }), ...over,
  });
}

const freshRoot = (): string => realpathSync(mkTmp('ccrc-capdel-'));
const gone = (root: string, id: string, build: string): boolean => !existsSync(capturePaths(root, id, build, root).dir) && !existsSync(capturePaths(root, id, build, root).tmux);

describe('a delivery capture of a build that receives every prompt intact', () => {
  it('answers intact, every case once and equal, with no build-trust verdict, and removes its directories', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('ok', GOOD, 'delivery', 0);
    expect(r.detail).toBeNull();
    expect(r.result).toBeNull();
    expect(r.delivery?.word).toBe('intact');
    expect(r.delivery?.part).toBe(0);
    expect(r.delivery?.cases.map((c) => c.id)).toEqual(deliveryParts()[0]);
    expect(r.delivery?.cases.every((c) => c.verdict === 'intact' && c.hook === 'equal' && c.receivedChars.length === 1)).toBe(true);
    // What travels: the one reader reads the result back, for this build and part.
    expect(readDeliveryCaptureResult(JSON.parse(JSON.stringify(r.delivery)), GOOD, 0)).toEqual(r.delivery);
    expect(gone(root, 'ok', GOOD)).toBe(true);
  }, 120_000);

  it('each part is a capture of its own: only its cases, sent to a fresh build in a fresh directory (call 1148)', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const sent: string[][] = [];
    for (const part of [2, 1]) {
      const l = pipeLauncher();
      const mine: string[] = [];
      sent.push(mine);
      const r = await runner(root, l.launcher, typingDriver(l.child, (id) => { mine.push(id); return { kind: 'sent', send: 'ok' }; })).run(`p${part}`, GOOD, 'delivery', part);
      expect(r.delivery?.part).toBe(part);
      expect(r.delivery?.cases.map((c) => c.id)).toEqual(deliveryParts()[part]);
      expect(r.delivery?.word).toBe('intact');
      expect(gone(root, `p${part}`, GOOD)).toBe(true);
    }
    expect(sent).toEqual([deliveryParts()[2], deliveryParts()[1]]);
  }, 180_000);

  it('a part this box\'s recipe does not have answers no verdict, and nothing is sent', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const asked: string[] = [];
    const r = await runner(root, l.launcher, typingDriver(l.child, (id) => { asked.push(id); return { kind: 'sent', send: 'ok' }; })).run('far', GOOD, 'delivery', DELIVERY_PART_COUNT);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/is not a part of this box's recipe/);
    expect(asked).toEqual([]);
    expect(gone(root, 'far', GOOD)).toBe(true);
  }, 120_000);

  it('asks the launcher for the fleet\'s pane and the stand-in for the delivery reply', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const replies: unknown[] = [];
    const r = await runner(root, l.launcher, typingDriver(l.child), {
      standIn: (reply) => { replies.push(reply); return startStandIn(reply === undefined ? {} : { reply }); },
    }).run('pane', GOOD, 'delivery', 0);
    expect(r.delivery?.word).toBe('intact');
    expect(l.specs[0]!.pane).toEqual(DELIVERY_PANE);
    expect(replies).toEqual([deliveryStandInReply]);
  }, 120_000);

  it('counts a side request apart from the turn', async () => {
    const root = freshRoot();
    place(root, SIDE);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('side', SIDE, 'delivery', 0);
    expect(r.delivery?.word).toBe('intact');
    expect(r.delivery?.cases.every((c) => c.sideRequests.messages >= 1 && c.sideRequests.count_tokens === 0)).toBe(true);
  }, 120_000);
});

describe('a delivery fault reads as a fault, never as a pass', () => {
  it('a prompt received twice: duplicate, the word fault', async () => {
    const root = freshRoot();
    place(root, DUPLICATES);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('dup', DUPLICATES, 'delivery', 0);
    expect(r.delivery?.word).toBe('fault');
    expect(r.delivery?.cases.every((c) => c.verdict === 'duplicate' && c.receivedChars.length === 2)).toBe(true);
    expect(gone(root, 'dup', DUPLICATES)).toBe(true);
  }, 120_000);

  it('a prompt split by lines: the multiline cases are splits with their first divergence, the one-line cases intact', async () => {
    const root = freshRoot();
    place(root, SPLITS);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('split', SPLITS, 'delivery', 0);
    const wrong = r.delivery!.cases.filter((c) => (deliveryExpected(c.id).includes('\n') ? c.verdict !== 'split' : c.verdict !== 'intact')).map((c) => `${c.id} ${c.verdict} ${c.receivedChars.length}`);
    expect(wrong).toEqual([]);
    expect(r.delivery?.word).toBe('fault');
    for (const c of r.delivery!.cases) {
      const lines = deliveryExpected(c.id).split('\n');
      if (lines.length === 1) expect(c.verdict).toBe('intact');
      else {
        expect(c.verdict).toBe('split');
        expect(c.divergence).toMatchObject({ turn: 0, index: Array.from(lines[0]!).length });
      }
    }
  }, 120_000);

  it('a truncated prompt: the long cases are altered at code point 100, the short control intact', async () => {
    const root = freshRoot();
    place(root, TRUNCATES);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('cut', TRUNCATES, 'delivery', 0);
    const c0 = r.delivery!.cases.find((c) => c.id === 'c0')!;
    const c1 = r.delivery!.cases.find((c) => c.id === 'c1')!;
    expect(c0.verdict).toBe('intact');
    expect(c1).toMatchObject({ verdict: 'altered', receivedChars: [100], divergence: { index: 100 } });
    expect(r.delivery?.word).toBe('fault');
  }, 120_000);

  it('a send that answers ok with nothing received is a false confirmation; a refusal with nothing received is refused', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const silent: DeliveryDriver = { drive: async (input) => ({ kind: 'sent', send: input.case === 'c0' ? 'ok' : 'verify-failed' }) };
    const r = await runner(root, l.launcher, silent).run('silent', GOOD, 'delivery', 0);
    expect(r.delivery?.cases[0]).toMatchObject({ id: 'c0', verdict: 'false-confirmation', receivedChars: [] });
    expect(r.delivery?.cases[1]).toMatchObject({ id: 'c1', verdict: 'refused', send: 'verify-failed' });
    expect(r.delivery?.word).toBe('fault');
  }, 120_000);
});

describe('a fault of the box is never a verdict, and the directories go on every path', () => {
  it('a driver that fails answers no verdict, naming the case', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const failing = typingDriver(l.child, (id) => (id === 'c1b' ? { kind: 'fault', detail: 'the driver could not start' } : { kind: 'sent', send: 'ok' }));
    const r = await runner(root, l.launcher, failing).run('fail', GOOD, 'delivery', 0);
    expect(r).toMatchObject({ result: null, delivery: null });
    expect(r.detail).toMatch(/case c1b: the driver could not start/);
    expect(gone(root, 'fail', GOOD)).toBe(true);
  }, 120_000);

  it('a driver that does not answer within its bound is killed, and the capture answers no verdict, in bounded time', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const script = path.join(mkTmp('ccrc-capdel-hang-'), 'hang.mjs');
    writeFileSync(script, 'process.stdin.resume(); setInterval(() => {}, 1000);\n');
    const t0 = Date.now();
    const r = await runner(root, l.launcher, nodeDeliveryDriver(process.execPath, script, 1_000, 1_000)).run('hang', GOOD, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/case c0: the driver did not answer within 1000 ms/);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(gone(root, 'hang', GOOD)).toBe(true);
  }, 120_000);

  it('a build that dies during the cases answers no verdict', async () => {
    const root = freshRoot();
    place(root, DIES);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('dies', DIES, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/the build is gone before case c1/);
    expect(gone(root, 'dies', DIES)).toBe(true);
  }, 120_000);

  it('a build killed during the cases answers no verdict, and the directories go', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const killing = typingDriver(l.child, (id) => {
      if (id === 'c1b') l.child().kill('SIGKILL');
      return { kind: 'sent', send: 'ok' };
    });
    const r = await runner(root, l.launcher, killing).run('kill', GOOD, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/the build is gone before case c2a/);
    expect(gone(root, 'kill', GOOD)).toBe(true);
  }, 120_000);

  it('a build killed during a part\'s last case answers no verdict too: its last window is not judged', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const killing = typingDriver(l.child, (id) => {
      if (id === 'c2a') l.child().kill('SIGKILL');
      return { kind: 'sent', send: 'ok' };
    });
    const r = await runner(root, l.launcher, killing).run('killlast', GOOD, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/the build is gone after the last case/);
    expect(gone(root, 'killlast', GOOD)).toBe(true);
  }, 120_000);

  it('a build that never starts answers no verdict within the step bound', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const mute: CaptureLauncher = { start: async (spec) => ({ ...(await l.launcher.start({ ...spec, env: spec.env.filter(([k]) => k !== 'CLAUDE_CONFIG_DIR') })) }) };
    const r = await runner(root, mute, typingDriver(l.child), { stepTimeoutMs: 1500 }).run('mute', GOOD, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/did not finish the step before the cases \(start\)/);
    expect(gone(root, 'mute', GOOD)).toBe(true);
  }, 120_000);

  it('a runner with no delivery driver wired says so (the box then refuses at the frame), and if asked answers no verdict and starts nothing', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    expect(runner(root, l.launcher, null).delivers).toBe(false);
    expect(runner(root, l.launcher, typingDriver(l.child)).delivers).toBe(true);
    const r = await runner(root, l.launcher, null).run('none', GOOD, 'delivery', 0);
    expect(r).toEqual({ result: null, delivery: null, detail: 'no delivery driver is wired to this runner' });
    expect(l.specs).toEqual([]);
  });

  it('a delivery capture asked with no part runs nothing and answers no verdict, never part 0 (call 1208, condition 1)', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const drives: string[] = [];
    const r = await runner(root, l.launcher, { drive: async (input) => { drives.push(input.case); return { kind: 'sent', send: 'ok' }; } }).run('nopart', GOOD, 'delivery');
    expect(r).toEqual({ result: null, delivery: null, detail: DELIVERY_NO_PART });
    expect(l.specs).toEqual([]);
    expect(drives).toEqual([]);
  });

  it('the capture\'s environment is built once: the pane and the driver\'s search path hold the same value, though the tools directories move between reads (call 1208, condition 2)', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    let reads = 0;
    const toolsPath = (): string => (reads++ === 0 ? NODE_DIR : `/moved-by-a-sync:${NODE_DIR}`);
    const inner = typingDriver(l.child);
    const paths: string[] = [];
    const driver: DeliveryDriver = { drive: async (input, where) => { paths.push(where.path); return inner.drive(input, where); } };
    const r = await runner(root, l.launcher, driver, { toolsPath }).run('once', GOOD, 'delivery', 0);
    expect(r.delivery).not.toBeNull();
    expect(reads).toBe(1);
    const panePath = new Map(l.specs[0]!.env).get('PATH');
    expect(panePath).toContain(NODE_DIR);
    expect(new Set(paths)).toEqual(new Set([panePath]));
  }, 120_000);
});

// The delivery recipe's launch on a REAL tmux (the capture owner's call 1208, condition 3): the fleet's shipped config and
// pane size, the pane started with no shell, and the build's environment the capture's. The same case runs under the
// shipped config with lines added that name a default shell and a default command, so a later line in that file cannot
// give the pane a shell. The suite's stub `tmux` is first on PATH, so the real binary is looked for by absolute path.
const REAL_TMUX = ['/usr/bin/tmux', '/usr/local/bin/tmux', '/bin/tmux', '/opt/homebrew/bin/tmux']
  .find((f) => existsSync(f) && spawnSync(f, ['-V'], { encoding: 'utf8', timeout: 10_000, env: {} }).status === 0) ?? null;
const SHIPPED_TMUX_CONF = fileURLToPath(new URL('../../ccd/tmux.conf', import.meta.url));
/** The fleet config's `default-terminal`, which tmux gives every pane as TERM. */
const FLEET_TERMINAL = /^set -g default-terminal "([^"]+)"$/m.exec(readFileSync(SHIPPED_TMUX_CONF, 'utf8'))?.[1] ?? 'unset';

describe('the delivery launch on a real tmux', () => {
  it.skipIf(REAL_TMUX === null || !existsSync('/proc/self/environ'))('starts the build with no shell under the fleet config, and gives it the capture\'s environment, whatever the config adds', async (ctx) => {
    const hostile = path.join(mkTmp('tconf-'), 'tmux.conf');
    writeFileSync(hostile, `${readFileSync(SHIPPED_TMUX_CONF, 'utf8')}\nset -g default-shell /bin/sh\nset -g default-command "/bin/sh -c 'exec sleep 60'"\n`);
    for (const conf of [SHIPPED_TMUX_CONF, hostile]) {
      const root = freshRoot();
      const sockDir = mkTmp('txd-');
      const p = capturePaths(root, 'launch', GOOD, sockDir);
      if (path.join(p.tmux, `tmux-${process.getuid?.() ?? 0}`, CAPTURE_SOCKET).length > 100) ctx.skip();
      for (const d of [p.dir, p.tmux, p.work]) mkdirSync(d, { recursive: true, mode: 0o700 });
      const binary = path.join(realpathSync(p.dir), 'build');
      writeFileSync(binary, '#!/bin/sh\nexec sleep 60\n', { mode: 0o755 });
      const env = captureEnv(p, 1, NODE_DIR);
      let panePid: number | null = null;
      const launcher = tmuxLauncher(REAL_TMUX!, 15_000, {
        spawner: (vars, boundMs) => {
          const e = boundedExec(vars, boundMs);
          return async (file, args) => {
            const out = await e(file, args);
            if (args.includes('new-session') && /^[0-9]+$/.test(out.stdout.trim())) panePid = Number(out.stdout.trim());
            return out;
          };
        },
      });
      const vars = Object.fromEntries(env);
      try {
        const l = await launcher.start({ binary, cwd: realpathSync(p.work), env, socket: CAPTURE_SOCKET, session: CAPTURE_TMUX_SESSION, pane: DELIVERY_PANE, tmuxConf: conf });
        const shown = spawnSync(REAL_TMUX!, ['-L', CAPTURE_SOCKET, 'display-message', '-p', '-t', tmuxTarget(CAPTURE_TMUX_SESSION), '#{pane_start_command} #{pane_width}x#{pane_height}'], { timeout: 10_000, env: vars, encoding: 'utf8' });
        expect(shown.status, shown.stderr).toBe(0);
        // Exactly the two words, the fixed start program and the build's path, which tmux runs with no shell; the fleet's size.
        expect(shown.stdout.trim(), conf).toBe(`${CAPTURE_START} ${binary} ${DELIVERY_PANE.cols}x${DELIVERY_PANE.rows}`);
        // The pane's process once it has become the build: its environment holds every variable of the capture's, and the
        // fixed shell as SHELL. Except TERM: tmux sets a pane's TERM from the config's `default-terminal`, so under the fleet's
        // config the build sees the fleet's terminal, as every fleet session does (measured on CI, where this case runs).
        expect(panePid).not.toBeNull();
        let seen: string[] | null = null;
        for (let n = 0; n < 100 && seen === null; n++) {
          try {
            const exe = readlinkSync(`/proc/${panePid}/exe`);
            if (exe !== realpathSync(REAL_TMUX!) && !exe.endsWith('/env')) seen = readFileSync(`/proc/${panePid}/environ`, 'utf8').split('\0').filter((x) => x !== '');
          } catch { /* not yet */ }
          if (seen === null) await new Promise((res) => { setTimeout(res, 100); });
        }
        expect(seen, 'the pane never became the build').not.toBeNull();
        for (const [k, v] of env) if (k !== 'TERM') expect(seen, `${k} in the build's environment (${conf})`).toContain(`${k}=${v}`);
        expect(seen, `TERM in the build's environment (${conf})`).toContain(`TERM=${FLEET_TERMINAL}`);
        expect(seen).toContain(`SHELL=${CAPTURE_SHELL}`);
        await l.stop();
      } finally {
        spawnSync(REAL_TMUX!, ['-L', CAPTURE_SOCKET, 'kill-server'], { timeout: 10_000, env: vars });
      }
    }
  }, 120_000);
});

describe('the build-trust recipe is unchanged beside it', () => {
  it('a build-trust capture asks the launcher with no pane and no config, the stand-in with no reply rule, and still passes', async () => {
    const root = freshRoot();
    place(root, GOOD, TRUST_BUILD);
    const l = pipeLauncher();
    const asked: unknown[][] = [];
    const r = await runner(root, l.launcher, typingDriver(l.child), {
      standIn: (...args) => { asked.push(args); return startStandIn(); },
    }).run('trust', GOOD);
    expect(r.result).toMatchObject({ build: GOOD, pass: true, cwd: true });
    expect(r).not.toHaveProperty('delivery');
    expect(asked).toEqual([[]]);
    expect(Object.keys(l.specs[0]!).sort()).toEqual(['binary', 'cwd', 'env', 'session', 'socket']);
  }, 120_000);

  it('the stand-in\'s default rule is still build trust\'s, and the delivery rule is never it', () => {
    const body = { tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'ccrc capture step one' }] };
    expect(standInReply(body)).toMatchObject({ kind: 'tool', name: 'Bash' });
    expect(deliveryStandInReply(body)).toEqual({ kind: 'text', text: DELIVERY_REPLY_TEXT });
  });

  it('the tmux launcher\'s creating call is build trust\'s own for a spec with no pane and no config, and the fleet\'s for a delivery spec', async () => {
    const calls: string[][] = [];
    const launcher = tmuxLauncher('tmux', 5000, {
      spawner: () => async (_file, args) => { calls.push([...args]); return { status: 0, stdout: args.includes('new-session') ? '4242\n' : '', stderr: '', killed: false }; },
      signal: () => undefined, shellUsable: () => true,
    });
    const spec = { binary: '/srv/box/captures/builds/2.1.100', cwd: '/w', env: [['PATH', '/usr/bin']] as const, socket: 'ccrc-capture', session: 'capture' };
    await launcher.start(spec);
    expect(calls[0]!.slice(0, 4)).toEqual(['-L', 'ccrc-capture', '-f', '/dev/null']);
    expect(calls[0]!.slice(calls[0]!.indexOf('-x'), calls[0]!.indexOf('-c'))).toEqual(['-x', '200', '-y', '50']);
    await launcher.start({ ...spec, pane: DELIVERY_PANE, tmuxConf: '/tree/ccd/tmux.conf' });
    const made = calls.find((c, i) => i > 0 && c.includes('new-session'))!;
    expect(made.slice(0, 4)).toEqual(['-L', 'ccrc-capture', '-f', '/tree/ccd/tmux.conf']);
    expect(made.slice(made.indexOf('-x'), made.indexOf('-c'))).toEqual(['-x', '220', '-y', '50']);
  });
});

describe('the driver child', () => {
  it('reads the one answer line: ok and a refusal word are the send\'s, anything else a fault', () => {
    expect(readDriverAnswer(0, '{"send":"ok"}\n')).toEqual({ kind: 'sent', send: 'ok' });
    expect(readDriverAnswer(0, '{"send":"verify-failed"}')).toEqual({ kind: 'sent', send: 'verify-failed' });
    expect(readDriverAnswer(2, '{"refused":"tmux-dir","detail":"x"}')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/refused tmux-dir/) });
    expect(readDriverAnswer(1, '{"send":"driver-failed","detail":"boom"}')).toMatchObject({ kind: 'fault' });
    expect(readDriverAnswer(0, 'not json')).toMatchObject({ kind: 'fault' });
    expect(readDriverAnswer(0, '{"send":"OK!"}')).toMatchObject({ kind: 'fault' });
    expect(readDriverAnswer(0, '{"send":"ok","extra":1}')).toMatchObject({ kind: 'fault' });
  });

  it('a driver whose own tmux call could not complete exits non-zero with a fault word: a fault, never a send, whatever send word it carries (review 3882 F2)', () => {
    expect(readDriverAnswer(3, '{"fault":"tmux-call","send":"not-alive","detail":"the pane is gone"}')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/exited 3/) });
    expect(readDriverAnswer(3, '{"send":"ok"}')).toMatchObject({ kind: 'fault' });
  });

  it('an exit-3 fault line names its reason and tmux\'s detail, never the send word, which is not the product\'s in that case (review 3898 A1)', () => {
    const a = readDriverAnswer(3, '{"fault":"tmux-call","send":"not-alive","detail":"the pane is gone"}');
    expect(a.kind).toBe('fault');
    const detail = a.kind === 'fault' ? a.detail : '';
    expect(detail).toMatch(/^the driver exited 3: /);
    expect(detail).toContain('tmux-call');
    expect(detail).toContain('the pane is gone');
    expect(detail).not.toContain('not-alive');
    // The detail stays bounded as the other arms' words are.
    const long = readDriverAnswer(3, JSON.stringify({ fault: 'tmux-call', send: 'not-alive', detail: 'x'.repeat(500) }));
    expect(long.kind === 'fault' ? long.detail.length : 0).toBeLessThan(250);
  });

  it('not-alive at exit 0 is a fault of the box (the capture\'s own session is not alive), never the product\'s refusal', () => {
    expect(readDriverAnswer(0, '{"send":"not-alive"}')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/not-alive/) });
    expect(DRIVER_BOX_FAULT_SENDS).toContain('not-alive');
    expect(readDriverAnswer(0, '{"send":"verify-failed"}')).toEqual({ kind: 'sent', send: 'verify-failed' });
  });

  it('is given the capture\'s directories and a case id on stdin, never text, in an environment built from empty', async () => {
    const dir = mkTmp('ccrc-capdel-echo-');
    const seen = path.join(dir, 'seen.json');
    const script = path.join(dir, 'echo.cjs');
    // A fixed script: it finds where to write from the TMPDIR it is given, so no value is spliced into its code.
    writeFileSync(script, "let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => { require('node:fs').writeFileSync(require('node:path').join(process.env.TMPDIR, 'seen.json'), JSON.stringify({ input: JSON.parse(s), env: process.env })); process.stdout.write('{\"send\":\"ok\"}'); });\n");
    const a = await nodeDeliveryDriver(process.execPath, script, 10_000, 1_000).drive({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', case: 'c3' }, { path: '/opt/tools/bin:/usr/bin', tmpBase: dir });
    expect(a).toEqual({ kind: 'sent', send: 'ok' });
    const got = JSON.parse(readFileSync(seen, 'utf8')) as { input: unknown; env: Record<string, string> };
    expect(got.input).toEqual({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', case: 'c3' });
    expect(Object.keys(got.env).filter((k) => k !== 'PATH' && k !== 'LANG' && k !== 'TMPDIR')).toEqual([]);
    expect(got.env['PATH']).toBe('/opt/tools/bin:/usr/bin');
    // The runner's tmux base is the child's temporary directory, the one parent the driver accepts (wave 178 departure).
    expect(got.env['TMPDIR']).toBe(dir);
  });

  it('a child that ignores TERM at its bound is killed its grace later, not sooner: the grace the worst case counts is taken (call 1208)', async () => {
    const dir = mkTmp('ccrc-capdel-term-');
    const script = path.join(dir, 'stubborn.cjs');
    writeFileSync(script, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    const bound = 300;
    const grace = 700;
    const t0 = Date.now();
    const a = await nodeDeliveryDriver(process.execPath, script, bound, grace).drive({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', case: 'c0' }, { path: '/usr/bin:/bin', tmpBase: dir });
    const took = Date.now() - t0;
    expect(a).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/did not answer within 300 ms/) });
    expect(took).toBeGreaterThanOrEqual(bound + grace);
  }, 20_000);
});

describe('the op\'s reader reads a delivery reply only as one', () => {
  it('a delivery reply with its result reads back; the same reply read as build trust carries no delivery', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('wire', GOOD, 'delivery', 0);
    const reply = { outcome: 'answered', refusal: null, result: null, detail: null, delivery: JSON.parse(JSON.stringify(r.delivery)) };
    expect(readTestboxCaptureReply(reply, GOOD, 'delivery', 0)?.delivery?.word).toBe('intact');
    expect(readTestboxCaptureReply(reply, GOOD, 'delivery', 1)).toBeNull();
    expect(readTestboxCaptureReply({ ...reply, delivery: { ...reply.delivery, word: 'fault' } }, GOOD, 'delivery', 0)).toBeNull();
    expect(readTestboxCaptureReply({ outcome: 'answered', refusal: null, result: null, detail: null }, GOOD, 'delivery', 0)).toBeNull();
    expect(readTestboxCaptureReply(reply, GOOD)?.delivery).toBeUndefined();
  }, 120_000);
});

// The stand-in tags each request with the route it came by (review 3882 F4); `requests` itself is build trust's and stays.
describe('the stand-in records the route of each request beside its body', () => {
  it('a Messages request and a count_tokens request, over real HTTP, each in its own place and order, one route each', async () => {
    const s = await startStandIn();
    try {
      const post = (p: string, body: unknown): Promise<Response> => fetch(`http://127.0.0.1:${s.port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const a = { tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'a' }] };
      await post('/v1/messages?beta=true', a);
      await post('/v1/messages/count_tokens?beta=true', a);
      await post('/v1/messages', { ...a, stream: true }).then((r) => r.text());
      expect(s.routes).toEqual(['messages', 'count_tokens', 'messages']);
      expect(s.requests).toHaveLength(3);
      expect(s.requests[1]).toEqual(a);
    } finally { await s.close(); }
  });
});

// The drive on a scripted window, a virtual clock and no process: what the drive does with a window, not what a build does.
describe('the drive on a scripted window', () => {
  const POLL = 10;
  const SETTLE = 200;
  const QUIET = 40;
  const bodyOf = (id: string): Record<string, unknown> => ({ tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: deliveryExpected(id as never) }] });

  /** A drive context over a fake build that is always alive. `onCase` scripts what each case's send does to the window;
   *  `late` is a request that arrives `after` virtual ms past the last case's driver answer (the quiet period is 40). */
  function scripted(part: number, o: { onCase?: (id: string, k: number) => DriverAnswer; late?: { after: number; route: DeliveryRoute }; other?: number; release?: string | null; unmeasured?: boolean } = {}) {
    const clock = { now: 0 };
    const requests: unknown[] = [];
    const routes: DeliveryRoute[] = [];
    const others: number[] = [];
    const records: { kind: 'hook'; event: string; payload: Record<string, unknown>; status: null }[] = [];
    const hook = (event: string): void => { records.push({ kind: 'hook', event, payload: {}, status: null }); };
    const cases = deliveryParts()[part]!;
    const asked: string[] = [];
    let lateAt: number | null = null;
    const driver: DeliveryDriver = {
      async drive(input) {
        asked.push(input.case);
        const k = asked.length - 1;
        const answer = o.onCase?.(input.case, k) ?? { kind: 'sent' as const, send: 'ok' };
        if (answer.kind === 'fault') return answer;
        if (o.other === k) others.push(requests.length);
        requests.push(bodyOf(input.case)); routes.push('messages'); hook('Stop');
        if (k === cases.length - 1 && o.late !== undefined) lateAt = clock.now + o.late.after;
        return answer;
      },
    };
    const ctx: DeliveryDriveContext = {
      launched: { type: async (text) => { if (text.startsWith('/model')) { hook('PreModelSwitch'); hook('PostModelSwitch'); } if (text === '/exit') hook('SessionEnd'); }, life: async () => 'alive', stop: async () => undefined },
      life: async () => 'alive', requests, routes, others, records: () => records, input: { capture: '/c', tmux: '/t' }, place: { path: '', tmpBase: '' },
      build: GOOD, part, driver, settleMs: SETTLE, quietMs: QUIET, stepTimeoutMs: 1000, exitTimeoutMs: 100, pollMs: POLL,
      release: o.release ?? null, unmeasured: o.unmeasured === true ? ['fleet-tmux-config'] : [],
      sleep: async (ms) => {
        clock.now += ms;
        if (records.length === 0) hook('SessionStart');
        if (lateAt !== null && clock.now >= lateAt) { lateAt = null; requests.push(bodyOf(cases.at(-1)!)); routes.push(o.late!.route); }
      },
      now: () => clock.now,
    };
    return { ctx, asked, clock };
  }

  // A request after the last case's quiet period, inside the trailing window (one settle after it): judged against that case.
  for (const part of [0, 1, 2]) {
    const last = deliveryParts()[part]!.at(-1)!;
    it(`part ${part}: a late second request of the last case (${last}) reads duplicate, a fault, never intact (review 3882 F3)`, async () => {
      const { ctx } = scripted(part, { late: { after: QUIET + 100, route: 'messages' } });
      const run = await runDeliveryDrive(ctx);
      expect(run.detail).toBeNull();
      const cases = run.delivery!.cases;
      expect(cases.map((c) => [c.id, c.verdict])).toEqual(cases.map((c) => [c.id, c.id === last ? 'duplicate' : 'intact']));
      expect(run.delivery!.word).toBe('fault');
    });
  }

  it('a late count_tokens request is a side request of the last case, never a second turn', async () => {
    const { ctx } = scripted(0, { late: { after: QUIET + 100, route: 'count_tokens' } });
    const run = await runDeliveryDrive(ctx);
    expect(run.delivery!.cases.at(-1)).toMatchObject({ verdict: 'intact', sideRequests: { messages: 0, count_tokens: 1 } });
  });

  it('a case whose window holds one request on a route the stand-in does not script carries sideRequests.other 1; the others carry no other key (review 3898 A3)', async () => {
    const { ctx } = scripted(0, { other: 1 });
    const cases = (await runDeliveryDrive(ctx)).delivery!.cases;
    expect(cases[1]!.sideRequests).toEqual({ messages: 0, count_tokens: 0, other: 1 });
    for (const [i, c] of cases.entries()) if (i !== 1) expect(Object.keys(c.sideRequests).sort()).toEqual(['count_tokens', 'messages']);
  });

  it('a window with no such request is byte for byte today\'s: no other key', async () => {
    const { ctx } = scripted(0);
    for (const c of (await runDeliveryDrive(ctx)).delivery!.cases) expect(c.sideRequests).toEqual({ messages: 0, count_tokens: 0 });
  });

  it('the trailing window is one settle past the quiet period, no more: a request after it is nobody\'s window', async () => {
    const { ctx } = scripted(0, { late: { after: QUIET + SETTLE + 3 * POLL, route: 'messages' } });
    expect((await runDeliveryDrive(ctx)).delivery!.word).toBe('intact');
  });

  it('a request with no route answers no verdict, naming the case: a fault of the box', async () => {
    const { ctx } = scripted(0);
    const bare: DeliveryDriveContext = { ...ctx, routes: [] };
    const run = await runDeliveryDrive(bare);
    expect(run.delivery).toBeNull();
    expect(run.detail).toMatch(/case c0: .*no route.*a fault of the box, not a verdict/);
  });

  it('the part stops at the first box fault: no later case is typed into a pane that may hold a half-typed draft (review 3882 F2)', async () => {
    const { ctx, asked } = scripted(0, { onCase: () => ({ kind: 'fault', detail: 'the driver exited 3: not-alive' }) });
    const run = await runDeliveryDrive(ctx);
    expect(run.delivery).toBeNull();
    expect(run.detail).toMatch(/case c0: the driver exited 3/);
    expect(asked).toEqual(['c0']);
  });

  it('the result carries the release the drive was given, and null when it was given none (review 3882 F5)', async () => {
    expect((await runDeliveryDrive(scripted(0, { release: 'v1.2.3' }).ctx)).delivery?.release).toBe('v1.2.3');
    expect((await runDeliveryDrive(scripted(0).ctx)).delivery?.release).toBeNull();
  });

  it('the result carries what was not measured: the fleet tmux config when the pane started without it, and nothing otherwise (A3)', async () => {
    expect((await runDeliveryDrive(scripted(0, { unmeasured: true }).ctx)).delivery?.unmeasured).toEqual(['fleet-tmux-config']);
    expect((await runDeliveryDrive(scripted(0).ctx)).delivery?.unmeasured).toEqual([]);
  });
});

describe('the runner hands the drive the release and what the pane lacked', () => {
  it('a runner built with a release tag and the fleet config answers its tag and nothing unmeasured', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child), { delivery: { driver: typingDriver(l.child), tmuxConf: '/tree/ccd/tmux.conf', release: 'v1.2.3', ...BOUNDS } }).run('rel', GOOD, 'delivery', 2);
    expect(r.delivery).toMatchObject({ word: 'intact', release: 'v1.2.3', unmeasured: [] });
    expect(l.specs[0]!.tmuxConf).toBe('/tree/ccd/tmux.conf');
  }, 120_000);

  it('a runner built with no release and no tmux config answers null and the unmeasured config', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('norel', GOOD, 'delivery', 2);
    expect(r.delivery).toMatchObject({ word: 'intact', release: null, unmeasured: ['fleet-tmux-config'] });
  }, 120_000);
});

describe('on the fake build: the late request and the count_tokens route (review 3882 F3 and F4)', () => {
  for (const part of [0, 1, 2]) {
    const last = deliveryParts()[part]!.at(-1)!;
    it(`part ${part}: a build that asks the last case (${last}) again after its quiet period is a duplicate, the other cases intact`, async () => {
      const root = freshRoot();
      place(root, LATE);
      const l = pipeLauncher();
      const r = await runner(root, l.launcher, typingDriver(l.child)).run(`late${part}`, LATE, 'delivery', part);
      expect(r.detail).toBeNull();
      expect(r.delivery?.cases.map((c) => [c.id, c.verdict])).toEqual(deliveryParts()[part]!.map((id) => [id, id === last ? 'duplicate' : 'intact']));
      expect(r.delivery?.word).toBe('fault');
      expect(gone(root, `late${part}`, LATE)).toBe(true);
    }, 120_000);
  }

  it('a build that also asks count_tokens with the turn\'s own body is intact, the request counted as a side request of its route', async () => {
    const root = freshRoot();
    place(root, COUNTS);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('counts', COUNTS, 'delivery', 0);
    expect(r.delivery?.word).toBe('intact');
    expect(r.delivery?.cases.every((c) => c.sideRequests.count_tokens === 1 && c.sideRequests.messages === 0)).toBe(true);
  }, 120_000);
});
