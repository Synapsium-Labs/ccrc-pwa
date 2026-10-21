// The advance step's push (auto-advance spec §2.3 steps 5 and 6; plan W2 Task 12): `deploy/notify.sh --push`,
// `POST /api/notify`'s `push: true`, the one reader of a models push line (`modelsPushOf`) and the pure policy that
// decides which of those lines reach a phone (`modelsPushDecision`, ruling RB10). The script runs against a fixture HOME
// whose PATH holds a recording `curl` stub and the real tools it shells out to (`notify-addr.test.ts`'s arrangement):
// the network call never fires. The route runs in-process with a fake push service and a roster of neutral fixture
// lanes. The advance step's own messages are rendered by the REAL jq programs of `ccd/ccrc`, sourced in a fixture HOME
// (ruling T12-1): no test here keeps a copy of a message template. Neutral ids only: this repository is public.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import type { PushPayload, PushService } from '../src/push.js';
import {
  CLASSES, MODEL_ID_RE, MODELS_PUSH_MAX, modelsPushDecision, modelsPushOf, type ModelsPushRoster,
} from '../../shared/models.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { stepRoster } from './fixtures/advanceCases.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOTIFY_SH = path.join(REPO, 'deploy', 'notify.sh');
const CCRC_SRC = path.join(REPO, 'ccd', 'ccrc');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};
const MOVED = 'lane-a: opus model-5.6-gamma → model-6.1-gamma';
const MOVED_B = 'lane-b: opus model-5.6-gamma → model-6.1-gamma';
const CANARY_FAILED = 'lane-a: haiku stays on model-5.6-alpha: model-6-alpha failed its canary (http 500: upstream error)';
const MOVE_FAILED = 'lane-b: sonnet stays on none: moving to model-6-beta failed (materialise failed (materialise-failed): x)';
/** Single-quoted for bash. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
/** This process's environment without anything that steers ccrc, ccd or the advance step. */
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(CCRC_|CCD_|MODELS_|_CCD_|BASH_ENV$|ENV$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(k)));

const REFUSED = 'ccrc-server: /api/notify: push:true on a notice that is not a model-class line of a codex-kind lane';

/** A recording `curl` stand-in: the argv it saw, one word to a line, in `$HOME/curl-argv`; its stdin drained; rc 0. */
const CURL_STUB = '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done > "$HOME/curl-argv"\ncat > /dev/null\nexit 0\n';

/** A fixture HOME with a recording `curl` in `stub-bin`, the real tools notify.sh shells out to, and a box token. */
function notifyHome(): { home: string; bin: string } {
  const home = mkTmp('ccrc-notify-push-');
  const bin = path.join(home, 'stub-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  for (const n of ['jq', 'grep', 'tail', 'cut', 'tr', 'sed', 'head', 'cat']) symlinkSync(realPath(n), path.join(bin, n));
  mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
  writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), `${'y'.repeat(64)}\n`, { mode: 0o600 });
  return { home, bin };
}
const curlArgv = (home: string): string[] => {
  const p = path.join(home, 'curl-argv');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l !== '') : [];
};
const bodyArg = (argv: string[]): string => argv[argv.indexOf('-d') + 1]!;

/** Runs the real `deploy/notify.sh` with `args`; answers the argv its `curl` saw. */
function runNotify(args: string[]): string[] {
  const { home, bin } = notifyHome();
  const r = spawnSync(BASH, [NOTIFY_SH, ...args],
    { env: { HOME: home, PATH: bin, CCRC_ADDR: 'http://127.0.0.1:9' }, encoding: 'utf8', input: '' });
  expect(r.status, r.stderr).toBe(0);
  return curlArgv(home);
}

describe('deploy/notify.sh --push (plan W2 Task 12)', () => {
  it('without the flag the body is exactly what it was', () => {
    expect(bodyArg(runNotify([MOVED]))).toBe(JSON.stringify({ message: MOVED }));
  });

  it('a leading --push adds push:true, and the message is the next word', () => {
    expect(bodyArg(runNotify(['--push', MOVED]))).toBe(JSON.stringify({ message: MOVED, push: true }));
  });

  it('only a LEADING --push is the flag: one later in the message is sent as it is', () => {
    expect(bodyArg(runNotify(['cc swap: s1 moved lane-a -> lane-b --push']))).toBe(
      JSON.stringify({ message: 'cc swap: s1 moved lane-a -> lane-b --push' }));
  });

  it('the flag is consumed once: a second --push is the message itself', () => {
    expect(bodyArg(runNotify(['--push', '--push']))).toBe(JSON.stringify({ message: '--push', push: true }));
  });

  it('the token still rides curl\'s stdin and the address is still the one asked for, with the flag', () => {
    const argv = runNotify(['--push', MOVED]);
    expect(argv.join('\n')).not.toContain('y'.repeat(64));
    expect(argv).toContain('http://127.0.0.1:9/api/notify');
  });

  it('its header comment does not spell the two assignments the token slice is cut between (the slice must start at the real ones)', () => {
    const lines = readFileSync(NOTIFY_SH, 'utf8').split('\n');
    const real = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const firstMention = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    expect(real(/^TOKEN_FILE=/)).toBeGreaterThan(0);
    expect(firstMention('TOKEN_FILE='), 'a comment spells TOKEN_FILE= above the real assignment').toBe(real(/^TOKEN_FILE=/));
    expect(firstMention('ADDR="${CCRC_ADDR:-}"'), 'a comment spells the address assignment above the real one').toBe(real(/^ADDR=/));
  });
});

describe('the real _models_push and the real notify.sh agree on the call (ruling T12-2)', () => {
  it('_models_push hands the hook --push first and the message second, and the body carries push:true', () => {
    const { home, bin } = notifyHome();
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    copyFileSync(NOTIFY_SH, path.join(home, '.cc-sessions', 'notify.sh'));
    chmodSync(path.join(home, '.cc-sessions', 'notify.sh'), 0o755);
    const env = { ...cleanEnv(), HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, CCRC_ADDR: 'http://127.0.0.1:9' };
    const r = spawnSync(BASH, ['-c', `umask 022\n. ${q(CCRC_SRC)}\n_models_push ${q(MOVED)}`], { env, encoding: 'utf8', input: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(bodyArg(curlArgv(home))).toBe(JSON.stringify({ message: MOVED, push: true }));
  });
});

describe('modelsPushDecision, the policy of push:true (plan W2 Task 12, ruling RB10)', () => {
  const lanes: ModelsPushRoster = new Map([
    ['lane-a', { exec: { kind: 'codex' } }], ['lane-b', { exec: { kind: 'codex' } }],
    ['lane-c', { exec: { kind: 'generated' } }], ['lane-up', { exec: { kind: 'upstream' } }],
  ]);

  it.each([
    [MOVED, { lane: 'lane-a', cls: 'opus', kind: 'moved', tag: 'models-advance:lane-a:opus' }],
    [CANARY_FAILED, { lane: 'lane-a', cls: 'haiku', kind: 'canary-failed', tag: 'models-advance:lane-a:haiku' }],
    [MOVE_FAILED, { lane: 'lane-b', cls: 'sonnet', kind: 'move-failed', tag: 'models-advance:lane-b:sonnet' }],
  ] as [string, Record<string, string>][])('%s is pushable, with the tag of its lane and class', (message, want) => {
    expect(modelsPushDecision(message, lanes)).toEqual({ verdict: 'pushable', ...want });
  });

  it.each([
    ['a cc swap: notice', 'cc swap: s1 moved lane-a -> lane-b', 'not-a-model-line'],
    ['free text', 'lane-a: re-authenticate at http://example.invalid now', 'not-a-model-line'],
    ['a word that is not a class', 'lane-a: subagent model-5.6-gamma → model-6.1-gamma', 'not-a-model-line'],
    ['a second line', `${MOVED}\nlane-a: opus x → y`, 'not-a-model-line'],
    ['a lane the roster does not have', 'lane-z: opus model-5.6-gamma → model-6.1-gamma', 'unknown-lane'],
    ['a lane of generated kind', 'lane-c: opus model-5.6-gamma → model-6.1-gamma', 'not-a-codex-lane'],
    ['the upstream lane', 'lane-up: opus model-5.6-gamma → model-6.1-gamma', 'not-a-codex-lane'],
    ['a well-shaped line one character over the cap',
      `lane-a: opus stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} failed its canary ()`, 'over-cap'],
    ['free text over the cap', 'x'.repeat(MODELS_PUSH_MAX + 1), 'over-cap'],
  ] as [string, string, string][])('%s is refused, and the refusal names why', (_w, message, reason) => {
    expect(modelsPushDecision(message, lanes)).toEqual({ verdict: 'refused', reason });
  });

  it.each([[42], [undefined], [null], [{ message: MOVED }]] as [unknown][])(
    'a message that is not a string (%j) is refused as no model line, never thrown on', (message) => {
      expect(modelsPushDecision(message, lanes)).toEqual({ verdict: 'refused', reason: 'not-a-model-line' });
    });

  it('the roster is asked once, for the lane the line names, and never for a message that is no model line', () => {
    const get = vi.fn((id: string) => lanes.get(id));
    const spy: ModelsPushRoster = { get };
    modelsPushDecision('cc swap: s1 moved lane-a -> lane-b', spy);
    modelsPushDecision('x'.repeat(MODELS_PUSH_MAX + 1), spy);
    expect(get).not.toHaveBeenCalled();
    modelsPushDecision(MOVED, spy);
    expect(get.mock.calls).toEqual([['lane-a']]);
  });

  it('the decision follows the roster it is given: the same line is pushable for one roster and refused for another', () => {
    const flipped: ModelsPushRoster = new Map([['lane-a', { exec: { kind: 'external' } }]]);
    expect(modelsPushDecision(MOVED, lanes).verdict).toBe('pushable');
    expect(modelsPushDecision(MOVED, flipped)).toEqual({ verdict: 'refused', reason: 'not-a-codex-lane' });
    expect(modelsPushDecision(MOVED, new Map())).toEqual({ verdict: 'refused', reason: 'unknown-lane' });
  });

  describe('the cap (ruling item 4: the cap stays, and what it refuses is stated)', () => {
    const longest = Math.max(...CLASSES.map((c) => c.length));
    const widest = CLASSES.find((c) => c.length === longest)!;
    const laneId = 'a'.repeat(32);
    const wide: ModelsPushRoster = new Map([[laneId, { exec: { kind: 'codex' } }]]);

    it('a MOVED line always fits: the longest lane id, class word and two model ids make exactly the cap', () => {
      const line = `${laneId}: ${widest} ${'m'.repeat(128)} → ${'n'.repeat(128)}`;
      expect(line.length).toBe(MODELS_PUSH_MAX);
      expect(modelsPushDecision(line, wide)).toMatchObject({ verdict: 'pushable', kind: 'moved', cls: widest });
    });

    it('a failure line with long model ids does NOT fit: it is refused for its length, and the banner is the only notice of it', () => {
      for (const tail of [`failed its canary (${'x'.repeat(120)})`, `failed (${'x'.repeat(120)})`]) {
        const line = tail.startsWith('failed its')
          ? `${laneId}: ${widest} stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} ${tail}`
          : `${laneId}: ${widest} stays on ${'m'.repeat(128)}: moving to ${'n'.repeat(128)} ${tail}`;
        expect(line.length).toBeGreaterThan(MODELS_PUSH_MAX);
        expect(modelsPushDecision(line, wide)).toEqual({ verdict: 'refused', reason: 'over-cap' });
      }
    });

    it('the cap is 300 characters', () => {
      expect(MODELS_PUSH_MAX).toBe(300);
    });
  });
});

describe('POST /api/notify with push (plan W2 Task 12)', () => {
  const TOKEN = 'f'.repeat(64);
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; vi.restoreAllMocks(); });
  /** A server whose roster has lane-a and lane-b codex-kind, lane-c an Anthropic lane, and no lane-z. Its ports are
   *  pure-parse: nothing here connects to them. */
  const lanesDeps = (): Deps => {
    const h = mkTmp('ccrc-');
    const d = testDeps(h);
    seedRoster(h, stepRoster({ proxyPort: 45020, litellmPort: 45021, authDir: codexAuthDir('lane-a') },
      { proxyPort: 45030, litellmPort: 45031, authDir: codexAuthDir('lane-b') }));
    return { ...d, cfg: loadConfig({ CCRC_HOME: h }) };
  };
  const fakePush = (impl: (p: PushPayload) => Promise<void> = async () => {}) => {
    const notify = vi.fn(impl);
    return { push: { notify } as unknown as PushService, notify };
  };
  const post = (a: FastifyInstance, payload: Record<string, unknown>, token = TOKEN) =>
    a.inject({ method: 'POST', url: '/api/notify', headers: { 'x-ccrc-mail-token': token }, payload });

  it('push:true on a model-class line of a codex-kind lane sends one phone push, tagged by lane and class, after the banner', async () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    const bannersAtPush: string[][] = [];
    const p = fakePush(async () => { bannersAtPush.push([...seen]); });
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push }, bus);
    expect((await post(app, { message: MOVED, push: true })).statusCode).toBe(200);
    expect(seen).toEqual([MOVED]);
    expect(p.notify).toHaveBeenCalledTimes(1);
    expect(p.notify).toHaveBeenCalledWith({ title: 'Model classes', body: MOVED, tag: 'models-advance:lane-a:opus',
      url: '/accounts' });
    expect(bannersAtPush, 'the banner was already out when the push was sent').toEqual([[MOVED]]);
  });

  it('two lanes, and two classes, in one run are pushes with tags of their own, so none replaces another in the tray', async () => {
    const p = fakePush();
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push });
    for (const message of [MOVED, MOVED_B, CANARY_FAILED]) {
      expect((await post(app, { message, push: true })).statusCode).toBe(200);
    }
    expect(p.notify.mock.calls.map((c) => c[0].tag)).toEqual(
      ['models-advance:lane-a:opus', 'models-advance:lane-b:opus', 'models-advance:lane-a:haiku']);
  });

  it.each([
    ['no push key', {}], ['push:false', { push: false }], ['push:"true", a string', { push: 'true' }], ['push:1', { push: 1 }],
  ] as [string, Record<string, unknown>][])('%s sends no phone push, and the banner still goes out', async (_w, extra) => {
    const p = fakePush();
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push }, bus);
    expect((await post(app, { message: MOVED, ...extra })).statusCode).toBe(200);
    expect(p.notify).not.toHaveBeenCalled();
    expect(seen).toEqual([MOVED]);
  });

  it.each([
    ['a cc swap: notice', 'cc swap: s1 moved lane-a -> lane-b', 'not-a-model-line'],
    ['a lane the roster does not have', 'lane-z: opus model-5.6-gamma → model-6.1-gamma', 'unknown-lane'],
    ['a lane that is not codex-kind', 'lane-c: opus model-5.6-gamma → model-6.1-gamma', 'not-a-codex-lane'],
    ['a word that is not a class', 'lane-a: subagent model-5.6-gamma → model-6.1-gamma', 'not-a-model-line'],
    ['free text', 'lane-a: re-authenticate at http://example.invalid now', 'not-a-model-line'],
    ['a well-shaped line over the length cap',
      `lane-a: opus stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} failed its canary (${'x'.repeat(20)})`, 'over-cap'],
  ] as [string, string, string][])('push:true on %s gives the banner, no phone push, and one warning naming why', async (_w, message, reason) => {
    // Review Focus: a box-token holder is any process on the fleet box (notify.sh's own header), so push:true is
    // honoured only for the advance step's lines.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push }, bus);
    expect((await post(app, { message, push: true })).statusCode).toBe(200);
    expect(seen).toEqual([message]);
    expect(p.notify).not.toHaveBeenCalled();
    const said = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(REFUSED));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`(${reason})`);
    expect(said[0], 'the refusal must not echo the message').not.toContain(message.slice(0, 40));
  });

  it('with no VAPID keys there is no push service: push:true on a model line answers 200, throws nothing and warns nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN });
    expect((await post(app, { message: MOVED, push: true })).statusCode).toBe(200);
    expect(warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('/api/notify'))).toEqual([]);
  });

  it('with no push service the eligibility is still decided: push:true on a line that is no model line still warns (ruling item 3)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN });
    expect((await post(app, { message: 'lane-c: opus model-5.6-gamma → model-6.1-gamma', push: true })).statusCode).toBe(200);
    expect(warn.mock.calls.flat().join(' ')).toContain(REFUSED);
  });

  it('a push that rejects is logged, and the route still answers 200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush(async () => { throw new Error('store unwritable'); });
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push });
    expect((await post(app, { message: MOVED, push: true })).statusCode).toBe(200);
    await vi.waitFor(() => expect(warn.mock.calls.flat().join(' '))
      .toContain('ccrc-server: /api/notify: the push did not go out (store unwritable)'));
  });

  it('the gate is unchanged: a wrong box token is refused before any push', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push });
    const res = await post(app, { message: MOVED, push: true }, 'nope');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated' });
    expect(p.notify).not.toHaveBeenCalled();
  });

  it('cc swap: routing is unchanged, with or without the flag, and never reaches the phone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new Bus();
    const toSession: unknown[] = [];
    bus.on('session:s1', (m) => toSession.push(m));
    const p = fakePush();
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push }, bus);
    await post(app, { message: 'cc swap: s1 moved lane-a -> lane-b' });
    await post(app, { message: 'cc swap: s1 moved lane-b -> lane-a', push: true });
    expect(toSession).toEqual([
      { type: 'notice', message: 'cc swap: s1 moved lane-a -> lane-b' },
      { type: 'notice', message: 'cc swap: s1 moved lane-b -> lane-a' },
    ]);
    expect(p.notify).not.toHaveBeenCalled();
  });
});

describe('modelsPushOf, the one reader of a models push line (plan W2 Task 12)', () => {
  it.each([
    [MOVED, { lane: 'lane-a', cls: 'opus', kind: 'moved' }],
    ['lane-a: fable none → model-6-delta', { lane: 'lane-a', cls: 'fable', kind: 'moved' }],
    ['lane-a: sonnet vendor-a/model-5:beta → vendor-a/model-6:beta', { lane: 'lane-a', cls: 'sonnet', kind: 'moved' }],
    [CANARY_FAILED, { lane: 'lane-a', cls: 'haiku', kind: 'canary-failed' }],
    [MOVE_FAILED, { lane: 'lane-b', cls: 'sonnet', kind: 'move-failed' }],
    [`lane-a: opus stays on none: model-6-alpha failed its canary (${'x'.repeat(120)})`, { lane: 'lane-a', cls: 'opus', kind: 'canary-failed' }],
    [`lane-a: opus stays on none: moving to model-6-alpha failed (${'x'.repeat(120)})`, { lane: 'lane-a', cls: 'opus', kind: 'move-failed' }],
    ['lane-a: opus stays on none: moving to model-6-alpha failed ()', { lane: 'lane-a', cls: 'opus', kind: 'move-failed' }],
    [`${'a'.repeat(32)}: opus model-5.6-gamma → model-6.1-gamma`, { lane: 'a'.repeat(32), cls: 'opus', kind: 'moved' }],
    // Exactly MODELS_PUSH_MAX characters: the cap's own control.
    [`lane-a: opus stays on ${'m'.repeat(127)}: ${'n'.repeat(128)} failed its canary ()`,
      { lane: 'lane-a', cls: 'opus', kind: 'canary-failed' }],
  ] as [string, unknown][])('%s reads as its lane, class and shape', (message, want) => {
    expect(modelsPushOf(message)).toEqual(want);
  });

  it.each([
    ['a cc swap: notice', 'cc swap: s1 moved lane-a -> lane-b'],
    ['a second line', `${MOVED}\nlane-a: opus x → y`],
    ['a trailing newline', `${MOVED}\n`],
    ['an uppercase lane', 'Lane-A: opus model-5.6-gamma → model-6.1-gamma'],
    ['a lane of 33 characters', `${'a'.repeat(33)}: opus model-5.6-gamma → model-6.1-gamma`],
    ['a model id with a space', 'lane-a: opus model 5 → model-6.1-gamma'],
    ['a reason that is not printable ASCII', 'lane-a: opus stays on model-5.6-gamma: model-6.1-gamma failed its canary (é)'],
    ['a reason with a tab', 'lane-a: opus stays on model-5.6-gamma: model-6.1-gamma failed its canary (a\tb)'],
    ['a reason with a DEL character', 'lane-a: opus stays on model-5.6-gamma: model-6.1-gamma failed its canary (a\x7fb)'],
    ['a move-failed reason with a DEL character', 'lane-a: opus stays on none: moving to model-6-alpha failed (a\x7fb)'],
    ['a reason of 121 characters', `lane-a: opus stays on none: model-6-alpha failed its canary (${'x'.repeat(121)})`],
    ['a move-failed reason of 121 characters', `lane-a: opus stays on none: moving to model-6-alpha failed (${'x'.repeat(121)})`],
    ['a move-failed reason that is not printable ASCII', 'lane-a: opus stays on none: moving to model-6-alpha failed (caf\u00e9)'],
    ['a failed-canary line followed by a second line', `${CANARY_FAILED}\nlane-a: opus x → y`],
    ['a move-failed line followed by a second line', `${MOVE_FAILED}\nlane-a: opus x → y`],
    ['a moved line followed by text on the same line', `${MOVED} and more`],
    ['text before the line', `note: ${MOVED}`],
    ['a class word in capitals', 'lane-a: Opus model-5.6-gamma → model-6.1-gamma'],
    ['a stays-on line with no reason brackets', 'lane-a: opus stays on none: model-6-alpha failed its canary'],
    ['a well-shaped line one character over the cap',
      `lane-a: opus stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} failed its canary ()`],
  ] as [string, string][])('%s is no models line', (_w, message) => {
    expect(modelsPushOf(message)).toBeNull();
  });

  it('a message that is not a string is no models line', () => {
    for (const m of [undefined, null, 42, {}, [MOVED]]) expect(modelsPushOf(m)).toBeNull();
  });
});

/** The advance step's REAL jq programs, in `ccd/ccrc` sourced in a fixture HOME (ruling T12-1). Nothing here reaches a
 *  live HOME, a registry, tmux or the network: HOME is a `mkTmp` directory and the `curl` first on PATH is a recording
 *  stand-in. */
function inCcrc(call: string, stdin = '', edit?: (src: string) => string): { code: number; stdout: string; stderr: string } {
  const { home, bin } = notifyHome();
  const env = ghContainedEnv(home, { ...cleanEnv(), HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}` });
  // `edit` is the check's own sensitivity test: a COPY of ccd/ccrc, in the fixture HOME, whose text has drifted. The
  // repository's file is never altered.
  let source = CCRC_SRC;
  if (edit !== undefined) {
    source = path.join(home, 'ccrc-copy');
    writeFileSync(source, edit(readFileSync(CCRC_SRC, 'utf8')));
  }
  const r = spawnSync(BASH, ['-c', `umask 022\n. ${q(source)}\n${call}`], { env, encoding: 'utf8', input: stdin, timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** The push lines of a receipt: `_models_adv_body_receipt <kind> <id> <cls> <pin> <to> <result>` fed the writer's answer. */
function receiptPushes(kind: 'backfill' | 'commit', args: [string, string, string, string, string], answer: Record<string, unknown>,
  edit?: (src: string) => string): string[] {
  const r = inCcrc(`_models_adv_body_receipt ${kind} ${args.map(q).join(' ')}`, JSON.stringify(answer), edit);
  expect(r.code, r.stderr).toBe(0);
  const frames = r.stdout.split('\n').filter((l) => l !== '');
  expect(frames[frames.length - 1], 'the receipt is not whole').toBe('END');
  return frames.filter((l) => l.startsWith('PUSH ')).map((l) => l.slice('PUSH '.length));
}
const commitAnswer = (o: Record<string, unknown>): Record<string, unknown> =>
  ({ ok: true, op: 'advance-commit', id: 'lane-a', class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', push: true, recovered: false, ...o });

describe('the advance step\'s messages, rendered by its real jq (plan W2 Task 12, ruling T12-1)', () => {
  it.each([
    ['a move', commitAnswer({ outcome: 'moved' }), 'passed', 'moved'],
    ['a failed canary', commitAnswer({ outcome: 'failed', reason: 'http 500: upstream error' }), 'failed', 'canary-failed'],
    ['a move that failed after a passed canary', commitAnswer({ outcome: 'failed', reason: 'materialise failed (materialise-failed): x' }), 'passed', 'move-failed'],
  ] as [string, Record<string, unknown>, string, string][])('%s: its one push line is a line modelsPushOf reads, for the lane and class it names', (_w, answer, res, kind) => {
    const pushes = receiptPushes('commit', ['lane-a', 'opus', 'model-5.6-gamma', 'model-6.1-gamma', res], answer);
    expect(pushes).toHaveLength(1);
    expect(modelsPushOf(pushes[0]!), pushes[0]).toEqual({ lane: 'lane-a', cls: 'opus', kind });
  });

  it('a recovered automatic move: its push line, from the step\'s receipt, is a moved line modelsPushOf reads', () => {
    const answer = { ok: true, op: 'advance-backfill', id: 'lane-a', created: false, why: 'present',
      recoveredMove: { class: 'sonnet', from: 'model-5.6-beta', to: 'model-6-beta', how: 'advance' } };
    const pushes = receiptPushes('backfill', ['lane-a', '-', '-', '-', '-'], answer);
    expect(pushes).toHaveLength(1);
    expect(modelsPushOf(pushes[0]!), pushes[0]).toEqual({ lane: 'lane-a', cls: 'sonnet', kind: 'moved' });
  });

  it('a recovered automatic move: the line a HAND verb pushes (_models_hand_settled) is the same kind of line', () => {
    const answer = JSON.stringify({ ok: true, recoveredMove: { class: 'fable', from: null, to: 'model-6-delta', how: 'advance' } });
    const r = inCcrc(`_models_push() { printf '%s\\n' "$1"; }\n_models_hand_settled lane-a ${q(answer)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n').filter(Boolean)).toEqual(['lane-a: fable none → model-6-delta']);
    expect(modelsPushOf(r.stdout.trim())).toEqual({ lane: 'lane-a', cls: 'fable', kind: 'moved' });
  });

  it('every class, a missing pin, and model ids that carry a colon and a slash: every push line is read, for the lane and class it names', () => {
    const ids = ['model-6.1-gamma', 'vendor-a/model-6:beta'];
    for (const cls of CLASSES) {
      for (const from of [null, 'vendor-a/model-5:beta']) {
        for (const [res, outcome, kind] of [['passed', 'moved', 'moved'], ['failed', 'failed', 'canary-failed'], ['passed', 'failed', 'move-failed']] as const) {
          const answer = commitAnswer({ class: cls, from, to: ids[1], outcome, reason: 'upstream error (x)' });
          const pushes = receiptPushes('commit', ['lane-a', cls, from ?? 'none', ids[1]!, res], answer);
          expect(pushes, `${cls} ${String(from)} ${outcome}`).toHaveLength(1);
          expect(modelsPushOf(pushes[0]!), pushes[0]).toEqual({ lane: 'lane-a', cls, kind });
        }
      }
    }
  });

  it('a reason that is not printable ASCII, or is long, is flattened to a reason modelsPushOf reads', () => {
    const reason = `  café\tline one\nline two ${'y'.repeat(200)}  `;
    for (const [res] of [['failed'], ['passed']] as const) {
      const pushes = receiptPushes('commit', ['lane-a', 'opus', 'model-5.6-gamma', 'model-6.1-gamma', res], commitAnswer({ outcome: 'failed', reason }));
      expect(pushes).toHaveLength(1);
      const line = modelsPushOf(pushes[0]!);
      expect(line, pushes[0]).toMatchObject({ lane: 'lane-a', cls: 'opus' });
      const inner = /\(([^]*)\)$/.exec(pushes[0]!)![1]!;
      expect(inner.length).toBeLessThanOrEqual(120);
      expect(inner).toMatch(/^[\x20-\x7e]*$/);
    }
  });

  it('the receipt\'s model-id grammar is MODEL_ID_RE: the longest id and a too-long one', () => {
    const longest = `m${'a'.repeat(127)}`;
    expect(MODEL_ID_RE.test(longest)).toBe(true);
    const ok = receiptPushes('commit', ['lane-a', 'opus', 'none', longest, 'passed'], commitAnswer({ from: null, to: longest, outcome: 'moved' }));
    expect(ok).toEqual([`lane-a: opus none → ${longest}`]);
    expect(modelsPushOf(ok[0]!)).toMatchObject({ kind: 'moved' });
    const tooLong = `m${'a'.repeat(128)}`;
    expect(MODEL_ID_RE.test(tooLong)).toBe(false);
    expect(receiptPushes('commit', ['lane-a', 'opus', 'none', tooLong, 'passed'], commitAnswer({ from: null, to: tooLong, outcome: 'moved' }))).toEqual([]);
  });
});

describe('the check is not vacuous: a message template that drifts from modelsPushOf is caught (ruling T12-1)', () => {
  // Each case sources a COPY of ccd/ccrc whose text has drifted in one place, renders the same line the real one renders,
  // and expects the reader to refuse it. `replaceAll` of a phrase that is not there would drift nothing, so each edit
  // asserts it found its phrase.
  const drift = (from: string, to: string) => (src: string): string => {
    expect(src.includes(from), `ccd/ccrc has no "${from}" to drift`).toBe(true);
    return src.replaceAll(from, to);
  };
  const MOVE_ARGS: [string, string, string, string, string] = ['lane-a', 'opus', 'model-5.6-gamma', 'model-6.1-gamma', 'passed'];
  const CANARY_ARGS: [string, string, string, string, string] = ['lane-a', 'opus', 'model-5.6-gamma', 'model-6.1-gamma', 'failed'];

  it.each([
    ['the arrow of a moved line', ' → ', ' -> ', 'passed', commitAnswer({ outcome: 'moved' })],
    ['the "stays on" of a failed-canary line', 'stays on', 'stays at', 'failed', commitAnswer({ outcome: 'failed', reason: 'x' })],
    ['the "failed its canary" of a failed-canary line', 'failed its canary', 'failed the canary', 'failed', commitAnswer({ outcome: 'failed', reason: 'x' })],
    ['the "moving to" of a move-failed line', 'moving to', 'moving on to', 'passed', commitAnswer({ outcome: 'failed', reason: 'x' })],
  ] as [string, string, string, string, Record<string, unknown>][])('%s', (_w, from, to, res, answer) => {
    const args = res === 'failed' ? CANARY_ARGS : MOVE_ARGS;
    // Control: the real file's line is read.
    const real = receiptPushes('commit', args, answer);
    expect(real).toHaveLength(1);
    expect(modelsPushOf(real[0]!), real[0]).not.toBeNull();
    const drifted = receiptPushes('commit', args, answer, drift(from, to));
    expect(drifted).toHaveLength(1);
    expect(modelsPushOf(drifted[0]!), drifted[0]).toBeNull();
  });

  it('the reason limit: a receipt that cut at 200 instead of 120 builds a line the reader refuses', () => {
    const answer = commitAnswer({ outcome: 'failed', reason: 'y'.repeat(200) });
    const drifted = receiptPushes('commit', CANARY_ARGS, answer, drift('flat(120)', 'flat(200)'));
    expect(drifted).toHaveLength(1);
    expect(modelsPushOf(drifted[0]!), drifted[0]).toBeNull();
  });

  it('the recovered line: a hand-verb and receipt line whose arrow drifted is refused', () => {
    const answer = { ok: true, op: 'advance-backfill', id: 'lane-a', recoveredMove: { class: 'sonnet', from: 'model-5.6-beta', to: 'model-6-beta', how: 'advance' } };
    const drifted = receiptPushes('backfill', ['lane-a', '-', '-', '-', '-'], answer, drift(' → ', ' -> '));
    expect(drifted).toHaveLength(1);
    expect(modelsPushOf(drifted[0]!), drifted[0]).toBeNull();
  });
});
