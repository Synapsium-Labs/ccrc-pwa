// The advance step's push (auto-advance spec §2.3 steps 5 and 6; plan W2 Task 12): `deploy/notify.sh --push`,
// `POST /api/notify`'s `push: true`, the one reader of a models push line (`modelsPushOf`) and the pure policy that
// decides which of those lines reach a phone (`modelsPushDecision`). The script runs against a fixture HOME
// whose PATH holds a recording `curl` stub and the real tools it shells out to (`notify-addr.test.ts`'s arrangement):
// the network call never fires. The route runs in-process with a fake push service and a roster of neutral fixture
// lanes. The advance step's own messages are rendered by the REAL jq programs of `ccd/ccrc`, sourced in a fixture HOME
// (no test here keeps a copy of a message template). Neutral ids only: this repository is public.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { loadConfig, reloadRoster } from '../src/config.js';
import type { PushPayload, PushService } from '../src/push.js';
import {
  CLASSES, MODEL_ID_RE, MODELS_PUSH_MAX, modelsPushDecision, modelsPushOf,
  type ModelsPushDecision, type ModelsPushKind, type ModelsPushRefusal, type ModelsPushRoster,
} from '../../shared/models.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { stepRoster } from './fixtures/advanceCases.js';
import { sourceOfSymbol } from './scan/symbols.js';

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
/** What a refused lane tells the operator to fix, per server mode. In both modes it is the lane's row in this box's
 *  accounts.json and a restart: nothing re-reads the roster because a lane's `exec.kind` alone differs. A codex row needs
 *  its whole exec block, and the server refuses a roster with an incomplete one at start, so remote mode copies the
 *  lane's whole row from the fleet box (this box's file is a copy that a later roster answer replaces), and local mode
 *  says the block must be complete. */
const REMOTE_FIX = "copy the lane's whole row from the fleet box's accounts.json into this server box's accounts.json, "
  + "and restart the server: this server box's file is a copy of the fleet box's roster, and a later roster answer "
  + 'from the fleet box replaces it';
const LOCAL_FIX = "if the lane is meant to be a codex lane, its row in this box's accounts.json needs a complete codex "
  + 'exec block, not exec.kind alone (exec.provider "openai", exec.authDir, and two ports of its own, exec.proxyPort '
  + 'and exec.litellmPort), and the server refuses a roster with an incomplete one at start: fix the row, and restart '
  + 'the server';
/** The exact tail of a lane refusal in a mode: the common clause, the mode's remedy and the closing words, contiguous. */
const laneTail = (fix: string): string =>
  `(the server decides from the roster it holds); ${fix}; the banner went out, the phone push did not`;
/** The one answer a remedy may name: the one that undoes a remote fix. No remedy says a verb or an answer picks one up. */
const UNDOES = 'and a later roster answer from the fleet box replaces it';

/** A recording `curl` stand-in: the argv it saw, one word to a line, in `$HOME/curl-argv`, and its stdin, byte for byte,
 *  in `$HOME/curl-stdin`; rc 0. */
const CURL_STUB = '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done > "$HOME/curl-argv"\ncat > "$HOME/curl-stdin"\nexit 0\n';

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
const curlStdin = (home: string): string => {
  const p = path.join(home, 'curl-stdin');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};
const bodyArg = (argv: string[]): string => argv[argv.indexOf('-d') + 1]!;
const TOKEN_ON_BOX = 'y'.repeat(64);

/** Runs the real `deploy/notify.sh` with `args`; answers the argv its `curl` saw and the stdin it was fed. */
function runNotify(args: string[]): { argv: string[]; stdin: string } {
  const { home, bin } = notifyHome();
  const r = spawnSync(BASH, [NOTIFY_SH, ...args],
    { env: { HOME: home, PATH: bin, CCRC_ADDR: 'http://127.0.0.1:9' }, encoding: 'utf8', input: '' });
  expect(r.status, r.stderr).toBe(0);
  return { argv: curlArgv(home), stdin: curlStdin(home) };
}

describe('deploy/notify.sh --push (plan W2 Task 12)', () => {
  it('without the flag the body is exactly what it was', () => {
    expect(bodyArg(runNotify([MOVED]).argv)).toBe(JSON.stringify({ message: MOVED }));
  });

  it('a leading --push adds push:true, and the message is the next word', () => {
    expect(bodyArg(runNotify(['--push', MOVED]).argv)).toBe(JSON.stringify({ message: MOVED, push: true }));
  });

  it('only a LEADING --push is the flag: one later in the message is sent as it is', () => {
    expect(bodyArg(runNotify(['cc swap: s1 moved lane-a -> lane-b --push']).argv)).toBe(
      JSON.stringify({ message: 'cc swap: s1 moved lane-a -> lane-b --push' }));
  });

  it('the flag is consumed once: a second --push is the message itself', () => {
    expect(bodyArg(runNotify(['--push', '--push']).argv)).toBe(JSON.stringify({ message: '--push', push: true }));
  });

  it('with the flag, the box token reaches curl on stdin as the -K config line and is nowhere in argv', () => {
    const { argv, stdin } = runNotify(['--push', MOVED]);
    expect(stdin).toBe(`header = "x-ccrc-mail-token: ${TOKEN_ON_BOX}"\n`);
    expect(argv.join('\n')).not.toContain(TOKEN_ON_BOX);
    expect(argv.slice(argv.indexOf('-K'), argv.indexOf('-K') + 2)).toEqual(['-K', '-']);
    expect(argv).toContain('http://127.0.0.1:9/api/notify');
  });

  it('its header usage line says the flag: [--push] <message>', () => {
    const usage = readFileSync(NOTIFY_SH, 'utf8').split('\n').find((l) => l.startsWith('# ccd swap hook'));
    expect(usage, 'notify.sh has no "# ccd swap hook" header line').toBeDefined();
    expect(usage).toContain('[--push] <message>');
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

describe('the real _models_push and the real notify.sh agree on the call: --push first, then the message', () => {
  it('_models_push hands the hook --push first and the message second, and the body carries push:true', () => {
    const { home, bin } = notifyHome();
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    copyFileSync(NOTIFY_SH, path.join(home, '.cc-sessions', 'notify.sh'));
    chmodSync(path.join(home, '.cc-sessions', 'notify.sh'), 0o755);
    const env = ghContainedEnv(home, { ...cleanEnv(), HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, CCRC_ADDR: 'http://127.0.0.1:9' });
    const r = spawnSync(BASH, ['-c', `umask 022\n. ${q(CCRC_SRC)}\n_models_push ${q(MOVED)}`], { env, encoding: 'utf8', input: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(bodyArg(curlArgv(home))).toBe(JSON.stringify({ message: MOVED, push: true }));
  });
});

describe('modelsPushDecision, the policy of push:true (plan W2 Task 12)', () => {
  const lanes: ModelsPushRoster = new Map([
    ['lane-a', { exec: { kind: 'codex' } }], ['lane-b', { exec: { kind: 'codex' } }],
    ['lane-c', { exec: { kind: 'generated' } }], ['lane-up', { exec: { kind: 'upstream' } }],
  ]);

  it.each([
    [MOVED, { lane: 'lane-a', cls: 'opus', kind: 'moved', tag: 'models-advance:lane-a:opus' }],
    [CANARY_FAILED, { lane: 'lane-a', cls: 'haiku', kind: 'canary-failed', tag: 'models-advance:lane-a:haiku' }],
    [MOVE_FAILED, { lane: 'lane-b', cls: 'sonnet', kind: 'move-failed', tag: 'models-advance:lane-b:sonnet' }],
    // THE ACCEPTED RESIDUAL, measured rather than discovered: a well-shaped line carries up to 120 characters of any
    // printable ASCII in its reason slot, and model ids may be URL-shaped (`:` and `/` are in MODEL_ID_RE).
    ['lane-a: opus stays on none: model-6-alpha failed its canary (Re-authenticate now at https://example.invalid/login)',
      { lane: 'lane-a', cls: 'opus', kind: 'canary-failed', tag: 'models-advance:lane-a:opus' }],
    ['lane-a: opus https://example.invalid/x → https://example.invalid/y',
      { lane: 'lane-a', cls: 'opus', kind: 'moved', tag: 'models-advance:lane-a:opus' }],
  ] as [string, Record<string, string>][])('%s is pushable, with the tag of its lane and class', (message, want) => {
    expect(modelsPushDecision(message, lanes)).toEqual({ verdict: 'pushable', ...want });
  });

  it.each([
    ['a cc swap: notice', 'cc swap: s1 moved lane-a -> lane-b', 'not-a-model-line', undefined],
    ['free text', 'lane-a: re-authenticate at http://example.invalid now', 'not-a-model-line', undefined],
    ['a word that is not a class', 'lane-a: subagent model-5.6-gamma → model-6.1-gamma', 'not-a-model-line', undefined],
    ['a second line', `${MOVED}\nlane-a: opus x → y`, 'not-a-model-line', undefined],
    ['a lane the roster does not have', 'lane-z: opus model-5.6-gamma → model-6.1-gamma', 'unknown-lane', 'lane-z'],
    ['a lane of generated kind', 'lane-c: opus model-5.6-gamma → model-6.1-gamma', 'not-a-codex-lane', 'lane-c'],
    ['the upstream lane', 'lane-up: opus model-5.6-gamma → model-6.1-gamma', 'not-a-codex-lane', 'lane-up'],
    // A key every object inherits, and a valid lane word (lowercase letters): it is not a roster row.
    ['a lane named like an inherited object key', 'constructor: opus model-5.6-gamma → model-6.1-gamma', 'unknown-lane', 'constructor'],
    ['a well-shaped line one character over the cap',
      `lane-a: opus stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} failed its canary ()`, 'over-cap', undefined],
    // The boundary of the over-cap reason: exactly the cap is NOT over it, one more is.
    ['free text of exactly the cap', 'x'.repeat(MODELS_PUSH_MAX), 'not-a-model-line', undefined],
    ['free text one character over the cap', 'x'.repeat(MODELS_PUSH_MAX + 1), 'over-cap', undefined],
  ] as [string, string, string, string | undefined][])('%s is refused, and the refusal names why', (_w, message, reason, lane) => {
    expect(modelsPushDecision(message, lanes)).toEqual(
      lane === undefined ? { verdict: 'refused', reason } : { verdict: 'refused', reason, lane });
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
    expect(modelsPushDecision(MOVED, flipped)).toEqual({ verdict: 'refused', reason: 'not-a-codex-lane', lane: 'lane-a' });
    expect(modelsPushDecision(MOVED, new Map())).toEqual({ verdict: 'refused', reason: 'unknown-lane', lane: 'lane-a' });
  });

  describe('the cap: it stays at 300, and what it refuses is stated', () => {
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
  const LANE_A = { proxyPort: 45020, litellmPort: 45021, authDir: codexAuthDir('lane-a') };
  const LANE_B = { proxyPort: 45030, litellmPort: 45031, authDir: codexAuthDir('lane-b') };
  /** A server whose roster has lane-a and (unless `laneBCodex` is false) lane-b codex-kind, lane-c an Anthropic lane,
   *  and no lane-z. Its ports are pure-parse: nothing here connects to them. */
  const lanesDeps = (laneBCodex = true): Deps => {
    const h = mkTmp('ccrc-');
    const d = testDeps(h);
    seedRoster(h, laneBCodex ? stepRoster(LANE_A, LANE_B) : stepRoster(LANE_A));
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

  const REFUSALS: [string, string, string, string | undefined][] = [
    ['a cc swap: notice', 'cc swap: s1 moved lane-a -> lane-b', 'not-a-model-line', undefined],
    ['a lane the roster does not have', 'lane-z: opus model-5.6-gamma → model-6.1-gamma', 'unknown-lane', 'lane-z'],
    ['a lane that is not codex-kind', 'lane-c: opus model-5.6-gamma → model-6.1-gamma', 'not-a-codex-lane', 'lane-c'],
    ['a lane named like an inherited object key', 'constructor: opus model-5.6-gamma → model-6.1-gamma', 'unknown-lane', 'constructor'],
    ['a word that is not a class', 'lane-a: subagent model-5.6-gamma → model-6.1-gamma', 'not-a-model-line', undefined],
    ['free text', 'lane-a: re-authenticate at http://example.invalid now', 'not-a-model-line', undefined],
    ['a well-shaped line over the length cap',
      `lane-a: opus stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} failed its canary (${'x'.repeat(20)})`, 'over-cap', undefined],
  ];
  type Mode = 'local' | 'remote';
  it.each((['local', 'remote'] as Mode[]).flatMap((mode) =>
    REFUSALS.map((r): [Mode, string, string, string, string | undefined] => [mode, ...r])))(
    'a %s server: push:true on %s gives the banner, no phone push, and one warning naming why',
    async (mode, _w, message, reason, lane) => {
    // Review Focus: a box-token holder is any process on the fleet box (notify.sh's own header), so push:true is
    // honoured only for the advance step's lines.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    const d = lanesDeps();
    app = await buildServer({ ...d, cfg: { ...d.cfg, fleetMode: mode }, mailToken: TOKEN, push: p.push }, bus);
    expect((await post(app, { message, push: true })).statusCode).toBe(200);
    expect(seen).toEqual([message]);
    expect(p.notify).not.toHaveBeenCalled();
    const said = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(REFUSED));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`(${reason})`);
    expect(said[0], 'the refusal must not echo the message').not.toContain(message.slice(0, 40));
    // A refusal about a lane names the lane, the remedy in this server's mode and the restart that picks it up; one about
    // the message names none of them, in either mode. The over-cap arm alone explains itself: the line is a good one,
    // only too long for the push.
    if (lane !== undefined) {
      expect(said[0]).toContain(`lane ${lane} must exist and carry exec.kind "codex"`);
      expect(said[0]).toContain("the server box's roster row");
      expect(said[0]).toContain('(the server decides from the roster it holds)');
      // Its own mode's clause, and not the other's.
      expect(said[0]).toContain(mode === 'remote' ? REMOTE_FIX : LOCAL_FIX);
      if (mode === 'local') expect(said[0], 'a local server names the fleet box').not.toContain('fleet box');
      else expect(said[0]).not.toContain(LOCAL_FIX);
    } else {
      for (const w of ['exec.kind', 'roster', 'accounts.json', 'restart', 'fleet box']) {
        expect(said[0], `a refusal about the message names a remedy ("${w}")`).not.toContain(w);
      }
    }
    if (reason === 'over-cap') {
      expect(said[0]).toContain(`longer than the push cap of ${MODELS_PUSH_MAX} characters`);
      expect(said[0]).toContain('a failure line with long model ids is refused this way by design, and the banner carries it');
    } else {
      expect(said[0]).not.toContain('push cap');
      expect(said[0]).not.toContain('by design');
    }
  });

  it('the over-cap refusal explains itself, from MODELS_PUSH_MAX, and still never echoes the line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push });
    const secret = 'Re-authenticate at https://example.invalid/login';
    const message = `lane-a: opus stays on ${'m'.repeat(128)}: ${'n'.repeat(128)} failed its canary (${secret})`;
    expect(message.length).toBeGreaterThan(MODELS_PUSH_MAX);
    expect((await post(app, { message, push: true })).statusCode).toBe(200);
    const said = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(REFUSED));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('(over-cap)');
    expect(said[0]).toContain(`: the line is longer than the push cap of ${MODELS_PUSH_MAX} characters; `);
    expect(said[0]).toContain('is refused this way by design, and the banner carries it');
    for (const leaked of [secret, 'Re-authenticate', 'example.invalid', 'mmmmmmmm', 'nnnnnnnn', 'canary']) {
      expect(said[0], `the warning echoes "${leaked}"`).not.toContain(leaked);
    }
    expect(p.notify).not.toHaveBeenCalled();
  });

  it('the over-cap clause is written from MODELS_PUSH_MAX, not as a number', () => {
    // Keyed on the symbol (scan/symbols.ts), not on a read of server.ts: the literal-source-pin ratchet in
    // single-definition.test.ts counts those and may only shrink.
    const route = sourceOfSymbol(path.join(REPO, 'server', 'src', 'server.ts'), 'buildServer');
    expect(route).toContain('the push cap of ${MODELS_PUSH_MAX} characters');
    expect(route).not.toMatch(/push cap of \d/);
  });

  it('a refusal about a lane prints the lane id and the remedy, and none of the message (the reason slot is free text)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push });
    const secret = 'Re-authenticate at https://example.invalid/login';
    for (const lane of ['lane-z', 'lane-c']) {
      const message = `${lane}: opus stays on none: model-6-alpha failed its canary (${secret})`;
      expect((await post(app, { message, push: true })).statusCode).toBe(200);
    }
    const said = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(REFUSED));
    expect(said).toHaveLength(2);
    expect(said[0]).toContain('lane lane-z must exist and carry exec.kind "codex"');
    expect(said[0]).toContain('(unknown-lane)');
    expect(said[1]).toContain('lane lane-c must exist and carry exec.kind "codex"');
    expect(said[1]).toContain('(not-a-codex-lane)');
    // What to fix and how the server picks it up, in this server's (local) mode.
    for (const l of said) expect(l).toContain(LOCAL_FIX);
    for (const l of said) {
      for (const leaked of [secret, 'Re-authenticate', 'example.invalid', 'model-6-alpha', 'canary']) {
        expect(l, `the warning echoes "${leaked}"`).not.toContain(leaked);
      }
    }
    expect(p.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['remote', REMOTE_FIX, LOCAL_FIX], ['local', LOCAL_FIX, REMOTE_FIX],
  ] as [string, string, string][])('a %s server tells the operator what to fix in its own mode, and not the other mode\'s remedy', async (mode, own, other) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    const d = lanesDeps();
    app = await buildServer({ ...d, cfg: { ...d.cfg, fleetMode: mode as 'local' | 'remote' }, mailToken: TOKEN, push: p.push });
    const secret = 'Re-authenticate at https://example.invalid/login';
    for (const lane of ['lane-z', 'lane-c']) {
      const message = `${lane}: opus stays on none: model-6-alpha failed its canary (${secret})`;
      expect((await post(app, { message, push: true })).statusCode).toBe(200);
    }
    const said = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(REFUSED));
    expect(said).toHaveLength(2);
    for (const l of said) {
      // The exact tail, contiguous: nothing between the common clause and the remedy, and nothing after it.
      expect(l.slice(-laneTail(own).length), 'the lane refusal\'s tail').toBe(laneTail(own));
      expect(l, 'the other mode\'s remedy').not.toContain(other);
      // What picks the fix up is a restart, and nothing else: no account verb, and no answer but the one that undoes it.
      expect(l, 'the remedy names no restart').toContain(', and restart the server');
      expect(l, 'the remedy promises an account verb').not.toContain('account verb');
      expect(l.replace(UNDOES, ''), 'the remedy promises an answer').not.toMatch(/\banswer/);
      expect(l).toContain('must exist and carry exec.kind "codex" (the server decides from the roster it holds)');
      expect(l, 'the old, false phrase').not.toContain('alone does not make it pushable');
      for (const leaked of [secret, 'Re-authenticate', 'example.invalid', 'model-6-alpha', 'canary']) {
        expect(l, `the warning echoes "${leaked}"`).not.toContain(leaked);
      }
    }
    expect(p.notify).not.toHaveBeenCalled();
  });

  it('the roster is read at each request: a lane that becomes codex-kind is pushable from the next request, and one that stops is refused again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePush();
    const d = lanesDeps(false);   // lane-b is external-kind at boot
    app = await buildServer({ ...d, mailToken: TOKEN, push: p.push });
    const refusals = (): string[] => warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes(REFUSED));
    // The roster changes the way the server changes it: reloadRoster reassigns cfg.roster in place.
    const reload = (roster: unknown): void => {
      const r = reloadRoster(d.cfg, { roster, fleetIdentity: 'fleet-x', fingerprints: null }, { fleetIdentity: () => 'fleet-x' });
      expect(r).toEqual({ ok: true, changed: true });
    };
    expect((await post(app, { message: MOVED_B, push: true })).statusCode).toBe(200);
    expect(p.notify).not.toHaveBeenCalled();
    expect(refusals()).toHaveLength(1);
    expect(refusals()[0]).toContain('(not-a-codex-lane)');

    reload(stepRoster(LANE_A, LANE_B));   // lane-b becomes codex-kind
    expect((await post(app, { message: MOVED_B, push: true })).statusCode).toBe(200);
    expect(p.notify).toHaveBeenCalledTimes(1);
    expect(p.notify.mock.calls[0]![0].tag).toBe('models-advance:lane-b:opus');
    expect(refusals()).toHaveLength(1);

    reload(stepRoster(LANE_A));           // and stops being
    expect((await post(app, { message: MOVED_B, push: true })).statusCode).toBe(200);
    expect(p.notify).toHaveBeenCalledTimes(1);
    expect(refusals()).toHaveLength(2);
  });

  it('the response never waits for the push: a push service whose notify never resolves still answers 200 within 3 seconds', async () => {
    const p = fakePush(() => new Promise<void>(() => {}));
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN, push: p.push });
    await app.ready();   // so that only the request sits inside the bound, not the server's own start-up
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<'timed-out'>((resolve) => { timer = setTimeout(() => resolve('timed-out'), 3000); });
    try {
      const res = await Promise.race([post(app, { message: MOVED, push: true }), bound]);
      expect(res, 'the route waited for a push that never resolves').not.toBe('timed-out');
      expect((res as { statusCode: number }).statusCode).toBe(200);
      expect(p.notify).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('with no VAPID keys there is no push service: push:true on a model line answers 200, throws nothing and warns nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...lanesDeps(), mailToken: TOKEN });
    expect((await post(app, { message: MOVED, push: true })).statusCode).toBe(200);
    expect(warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('/api/notify'))).toEqual([]);
  });

  it('with no push service the eligibility is still decided: push:true on a line of a lane that is not codex-kind still warns', async () => {
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

/** The advance step's REAL jq programs, in `ccd/ccrc` sourced in a fixture HOME. Nothing here reaches a
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

describe('the advance step\'s messages, rendered by its real jq (plan W2 Task 12)', () => {
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

describe('the check is not vacuous: a message template that drifts from modelsPushOf is caught', () => {
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

  it('the recovered move: the line the receipt builds AND the line a hand verb builds are each refused once the arrow drifts', () => {
    const answer = { ok: true, op: 'advance-backfill', id: 'lane-a', recoveredMove: { class: 'sonnet', from: 'model-5.6-beta', to: 'model-6-beta', how: 'advance' } };
    const handCall = `_models_push() { printf '%s\\n' "$1"; }\n_models_hand_settled lane-a ${q(JSON.stringify(answer))}`;
    // Controls: the real file's two lines are read.
    const realReceipt = receiptPushes('backfill', ['lane-a', '-', '-', '-', '-'], answer);
    expect(realReceipt).toHaveLength(1);
    expect(modelsPushOf(realReceipt[0]!), realReceipt[0]).not.toBeNull();
    const realHand = inCcrc(handCall);
    expect(realHand.code, realHand.stderr).toBe(0);
    expect(modelsPushOf(realHand.stdout.trim()), realHand.stdout).not.toBeNull();
    // Drifted.
    const viaReceipt = receiptPushes('backfill', ['lane-a', '-', '-', '-', '-'], answer, drift(' → ', ' -> '));
    expect(viaReceipt).toHaveLength(1);
    expect(modelsPushOf(viaReceipt[0]!), viaReceipt[0]).toBeNull();
    const viaHand = inCcrc(handCall, '', drift(' → ', ' -> '));
    expect(viaHand.code, viaHand.stderr).toBe(0);
    expect(viaHand.stdout.trim(), 'the hand verb built no line').not.toBe('');
    expect(modelsPushOf(viaHand.stdout.trim()), viaHand.stdout).toBeNull();
  });
});

describe('the push patterns are built from their owners, every shape uses them, and each rule is spelled once (text pins on shared/models.mjs)', () => {
  const src = readFileSync(path.join(REPO, 'shared', 'models.mjs'), 'utf8');
  const count = (re: RegExp): number => src.match(re)?.length ?? 0;
  const shapes = (): string[] => {
    const block = /const PUSH_SHAPES = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(src);
    expect(block, 'models.mjs has no PUSH_SHAPES block').not.toBeNull();
    return [...block![1]!.matchAll(/new RegExp\(`([^`]*)`\)/g)].map((m) => m[1]!);
  };

  it('PUSH_HEAD and PUSH_ID are built from pushInner(MODELS_LANE_ID_RE), CLASSES.join and pushInner(MODEL_ID_RE)', () => {
    expect(src).toContain("const PUSH_HEAD = `^(${pushInner(MODELS_LANE_ID_RE)}): (${CLASSES.join('|')}) `;");
    expect(src).toContain('const PUSH_ID = `(?:${pushInner(MODEL_ID_RE)})`;');
  });

  it('each of the three shapes begins with ${PUSH_HEAD} and names a model id only as ${PUSH_ID}, a reason only as ${PUSH_REASON}', () => {
    const t = shapes();
    expect(t, 'PUSH_SHAPES no longer holds exactly three regexes').toHaveLength(3);
    for (const x of t) {
      expect(x.startsWith('${PUSH_HEAD}'), `a shape does not begin with PUSH_HEAD: ${x}`).toBe(true);
      expect(x.match(/\$\{PUSH_ID\}/g), `a shape does not name its two ids as PUSH_ID: ${x}`).toHaveLength(2);
      // What is left once the three owners are taken out is the shape's own words and its end anchor, nothing that
      // could be a hand-written class list, id or reason pattern.
      const rest = x.replaceAll('${PUSH_HEAD}', '').replaceAll('${PUSH_ID}', '').replaceAll('${PUSH_REASON}', '');
      expect(rest, `a shape spells more than its words: ${x}`).toMatch(/^[A-Za-z :\u2192]*\$$/);
    }
  });

  it('no pattern group spells an alternation of the class words anywhere in the file: CLASSES.join is the only spelling', () => {
    // A group opens with `(` or `(?:`; the file's `<haiku|sonnet>` usage hints open with `<` and are not patterns.
    expect(src).not.toMatch(/[(:|]\s*(?:haiku|sonnet|opus|fable)\|(?:haiku|sonnet|opus|fable)/);
  });

  it('the lane and model-id repetition literals each occur once in the whole file: their definitions', () => {
    expect(count(/\{0,31\}/g), 'the lane pattern is spelled a second time').toBe(1);
    expect(count(/\{0,127\}/g), 'the model-id pattern is spelled a second time').toBe(1);
  });

  it('the reason grammar is written once, and the cap is compared in one place, whichever side of the operator it sits on', () => {
    expect(count(/\{0,120\}/g), 'the reason limit is spelled more than once').toBe(1);
    expect(count(/x20-\\+x7e/g), 'the reason alphabet is spelled more than once').toBe(1);
    const op = '(?:[<>]=?|[!=]==?)';
    expect(count(new RegExp(`${op}\\s*MODELS_PUSH_MAX\\b|\\bMODELS_PUSH_MAX\\s*${op}`, 'g')), 'the cap is compared in more than one place').toBe(1);
  });
});

describe('the direct callers of PushService.notify in server/src (the consolidation design, §3 K6)', () => {
  // The notify funnel (notice.ts) is the one way a notice is raised. Two callers still reach the push service directly,
  // each for reasons of its own. The watcher's release sender (`pushRelease`, watch.ts) is sessionless (D-3296): a
  // release is about the fleet, not a session, so it has no session for the presence gate and keeps no `NotifyLog` or
  // feed record. /api/notify's models push: the composition root's bound sink records every notice it can push, and
  // D-5211 rules a feed record out for that push in W2; the raw `notify` with a push-only set of sinks would take a
  // `NotifyEvent` kind, and none fits a model-class notice: a new kind widens shared/api.ts's union and the PWA's
  // per-kind tables, and an existing kind misfiles it. The design's K6 funnel
  // (docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md) is the owner that will absorb them, and this
  // list is what that wave finds them by.
  //
  // WHAT IT CATCHES: any line, in any JS or TS source file under server/src, that spells a call of a member named `notify`
  // in one of NOTIFY_SPELLINGS' forms once its inline `/* … */` spans are stripped, unless what is left begins with `//`,
  // `/*` or `*`. So a line that begins with an inline block comment and then has code is counted. A new direct caller
  // written in one of those forms is red until it is argued here. WHAT IT DOES NOT SEE: the census is lexical, so it sees
  // only those spellings; the type argument it reads has no nested angle brackets or parentheses (`<[^>()]*>`). It does
  // not see any other spelling (for example a parenthesised member, `Reflect.apply`, or a reference destructured or
  // aliased and called later), or code on a line that begins with `*` or `*/`. The walk takes every JS/TS-family
  // extension (SOURCE_EXT), so a `.js` or `.mts` file added later is read with no edit here, and the cases below pin the
  // walk: its own use of SOURCE_EXT on a fixture tree, and SOURCE_EXT itself on sample names.
  //
  // NON-CALL LINES THE SPELLINGS LEAVE ALONE: the reads and writes of the update intent's `notify` FIELD
  // (`isNotifyMode(r.notify)`, `patch.notify === undefined`, `notify: row.notify,`,
  // `notifyChannel(input.fleetIntent.notify, …)`, in store.ts, updateintentlog.ts, update/notify.ts and update/routes.ts),
  // and the bare funnel function (`notify(deps, …)`, not a member call). None of them is followed by a call, a non-null
  // assertion and a call, a `bind`, a `call`, an `apply` or the end of the line.
  const SRC = path.join(REPO, 'server', 'src');
  const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : SOURCE_EXT.test(e.name) ? [path.join(dir, e.name)] : []);
  const NOTIFY_SPELLINGS: RegExp[] = [
    /\.notify\s*!?\s*(?:\?\.\s*)?(?:<[^>()]*>\s*)?\(/,   // .notify(  ?.notify(  .notify!(  .notify?.(  .notify<T>(  .notify (
    /\.notify\s*!?\s*$/,                                    // .notify (or .notify!) at the end of the line, the call on the next
    /\.notify\s*!?\s*\??\.\s*(?:bind|call|apply)\b/,      // .notify.bind(  ?.notify.call(  .notify!.apply(
    /\[\s*(['"`])notify\1\s*\]/,                          // ['notify']  ["notify"]
  ];
  /** The lines of `text` that are code (not a comment line) and spell a call of a `notify` member. */
  const notifyLines = (text: string): string[] => text.split('\n')
    .filter((l) => {
      const code = l.replace(/\/\*.*?\*\//g, '');   // an inline block comment is not code
      return !/^\s*(\/\/|\*|\/\*)/.test(code) && NOTIFY_SPELLINGS.some((re) => re.test(code));
    });
  const callers = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const f of walk(SRC)) {
      const n = notifyLines(readFileSync(f, 'utf8')).length;
      if (n > 0) out[path.relative(SRC, f)] = n;
    }
    return out;
  };

  it('are the funnel, the watcher\'s release sender and this route, once each, and no others', () => {
    expect(callers()).toEqual({ 'notice.ts': 1, 'server.ts': 1, 'watch.ts': 1 });
  });

  it('the walk of server/src descends and finds the three callers\' files among the files it reads', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
    for (const f of ['notice.ts', 'server.ts', 'watch.ts']) expect(files).toContain(path.join(SRC, f));
    expect(files.some((f) => f.startsWith(path.join(SRC, 'coord') + path.sep)), 'the walk did not descend into a directory').toBe(true);
  });

  it('the walk returns exactly the files of a fixture tree that its extension test admits, a nested one included', () => {
    const root = mkTmp('ccrc-notify-walk-');
    mkdirSync(path.join(root, 'sub'));
    for (const f of ['a.ts', 'b.mts', 'c.js', 'd.cjs', 'e.tsx', 'f.json', 'g.md', path.join('sub', 'h.ts')]) {
      writeFileSync(path.join(root, f), '');
    }
    expect(walk(root).map((f) => path.relative(root, f)).sort())
      .toEqual(['a.ts', 'b.mts', 'c.js', 'd.cjs', 'e.tsx', path.join('sub', 'h.ts')].sort());
  });

  it.each(['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.d.ts'])(
    'the extension test reads %s, so a file of that kind added under server/src is walked with no edit here', (name) => {
      expect(SOURCE_EXT.test(name)).toBe(true);
    });

  it.each(['a.json', 'a.md', 'a.py', 'a.sh', 'a.tsbuildinfo', 'a.txt'])('the extension test does not read %s', (name) => {
    expect(SOURCE_EXT.test(name)).toBe(false);
  });

  it.each([
    'void deps.push?.notify({ title: 1 });', 'sender.notify(payload);', 'p?.notify?.(payload);', 'p.notify<never>(payload);',
    'p.notify (payload);', 'const send = p.notify.bind(p);', 'const send = p?.notify.call(p, x);', 'p.notify.apply(p, [x]);',
    "p['notify'](x);", 'p["notify"](x);', 'await deps.push?.["notify"](x);', 'await deps.push.notify', 'go(p.notify(x) /* c */);',
    'void deps.push!.notify!({ title: 1 });', 'const send = p.notify!.bind(p);', 'p.notify!.call(p, x);', 'p.notify!.apply(p, [x]);',
    // An inline block comment is stripped before the comment-line test, so code after one at the line's start counts.
    '/* why */ void deps.push.notify({ title: 1 });',
  ])('a line that spells a member call of notify is counted: %s', (line) => {
    expect(notifyLines(line)).toEqual([line]);
  });

  it.each([
    '// p.notify(x)', ' * p.notify(x)', '/* p.notify(x) */', '/* a */ // p.notify(x)', 'notify(deps, event, mode);',
    'const { notify } = deps;', 'notify: NotifyMode;', 'if (patch.notify === undefined) return;', 'row.notify,',
    'const c = notifyChannel(input.fleetIntent.notify, x);', 'x = a.notify ?? b;', 'p.notified(x);', 'p.notifyAll(x);',
    "import { notify } from '../notice.js';", 'if (a.notify !== undefined) return;', 'const ok = a.notify! ?? b;',
  ])('a line that is a comment, or no member call of notify, is not: %s', (line) => {
    expect(notifyLines(line)).toEqual([]);
  });
});

describe('the policy\'s types are held by a consumer, so typecheck-tests holds their parity', () => {
  // Record<Union, true> is exhaustive in both directions: a word added to, removed from or renamed in the declaration is a
  // compile error here, and the runtime checks below tie the same words to what the code produces.
  const KIND_WORDS: Record<ModelsPushKind, true> = { moved: true, 'canary-failed': true, 'move-failed': true };
  const REFUSAL_WORDS: Record<ModelsPushRefusal, true> = {
    'not-a-model-line': true, 'over-cap': true, 'unknown-lane': true, 'not-a-codex-lane': true,
  };
  const VERDICTS: Record<ModelsPushDecision['verdict'], true> = { pushable: true, refused: true };
  // The reasons of the arm that carries the lane: exactly these two, in both directions, at compile time. An arm that
  // lost its `lane` would leave this Extract empty, and a Record over an empty key set accepts anything, so `laneOf` reads
  // the lane off the arm too: on an empty arm (`never`) that read does not compile.
  type LaneArm = Extract<ModelsPushDecision, { verdict: 'refused'; lane: string }>;
  const LANE_REASONS: Record<LaneArm['reason'], true> = { 'unknown-lane': true, 'not-a-codex-lane': true };
  const laneOf = (d: LaneArm): string => d.lane;
  const roster: ModelsPushRoster = new Map([['lane-a', { exec: { kind: 'codex' } }], ['lane-c', { exec: { kind: 'generated' } }]]);

  it('every kind modelsPushOf reads is a ModelsPushKind, and every ModelsPushKind is read', () => {
    const read = [MOVED, CANARY_FAILED, MOVE_FAILED].map((m) => modelsPushOf(m)!.kind);
    expect([...new Set(read)].sort()).toEqual(Object.keys(KIND_WORDS).sort());
  });

  const decisions: ModelsPushDecision[] = [
    modelsPushDecision('cc swap: s1 moved lane-a -> lane-b', roster),
    modelsPushDecision('x'.repeat(MODELS_PUSH_MAX + 1), roster),
    modelsPushDecision('lane-z: opus model-5.6-gamma → model-6.1-gamma', roster),
    modelsPushDecision('lane-c: opus model-5.6-gamma → model-6.1-gamma', roster),
  ];

  it('exactly the lane-arm reasons come with a lane key, and no other refusal does', () => {
    expect(Object.keys(LANE_REASONS).sort()).toEqual(['not-a-codex-lane', 'unknown-lane']);
    for (const d of decisions) {
      if (d.verdict !== 'refused') continue;
      expect('lane' in d, `the refusal ${d.reason}`).toBe(d.reason in LANE_REASONS);
    }
  });

  it('the lane a lane-arm refusal carries is the lane its line names', () => {
    expect(laneOf(modelsPushDecision('lane-z: opus model-5.6-gamma → model-6.1-gamma', roster) as LaneArm)).toBe('lane-z');
    expect(laneOf(modelsPushDecision('lane-c: opus model-5.6-gamma → model-6.1-gamma', roster) as LaneArm)).toBe('lane-c');
  });

  it('every refusal word the policy produces is a ModelsPushRefusal, and every ModelsPushRefusal is produced', () => {
    const reasons = decisions.flatMap((d) => (d.verdict === 'refused' ? [d.reason] : []));
    expect([...new Set(reasons)].sort()).toEqual(Object.keys(REFUSAL_WORDS).sort());
    expect([...new Set([...decisions, modelsPushDecision(MOVED, roster)].map((d) => d.verdict))].sort()).toEqual(Object.keys(VERDICTS).sort());
  });
});
