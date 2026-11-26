// The paste delivery recipe's driver (`server/src/inject/deliveryDrive.ts`, Desktop polish wave 178): its input refusals
// before any tmux call, the Runner bound to the capture's own tmux server, the join at the product's own `sendPrompt` with
// the prompt route's options, and that nothing in the server imports it.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_SOCKET, captureTmuxDirName } from '../../shared/claudeBuildCapture.js';
import { deliveryCaseText, deliveryExpected } from '../../shared/deliveryCapture.js';
import { DELIVERY_CASE_IDS } from '../../shared/deliveryResult.js';
import { DRIVE_FAULT_EXIT, ROUTE_PLAIN_PROMPT_OPTIONS, captureTmuxRunner, driveAnswer, driveCase, privateTo, readDriveInput } from '../src/inject/deliveryDrive.js';
import type { Runner } from '../src/exec.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();
afterEach(() => undefined);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = '0123456789abcdef0123456789abcdef';
const CAPTURE = `/box/captures/${ID}`;
const BASE = '/tmp';
const TMUX = `${BASE}/${captureTmuxDirName(ID)}`;
const allDirs = (): boolean => true;

describe('readDriveInput: refused before any tmux call', () => {
  const ok = { capture: CAPTURE, tmux: TMUX, case: 'c0' };
  it('takes a capture\'s scratch directory, that capture\'s own tmux directory and a case id', () => {
    expect(readDriveInput(ok, allDirs, BASE, allDirs)).toEqual({ ok: true, input: ok });
  });
  it.each<[string, unknown, string]>([
    ['not an object', 'x', 'bad-input'],
    ['a field missing', { capture: CAPTURE, tmux: TMUX }, 'bad-input'],
    ['a field it does not name (a socket)', { ...ok, socket: 'default' }, 'bad-input'],
    ['free text instead of a case', { ...ok, text: 'rm -rf x' }, 'bad-input'],
    ['a path that is not a string', { ...ok, tmux: 1 }, 'bad-input'],
    ['an unknown case', { ...ok, case: 'c9' }, 'case'],
    ['a relative scratch directory', { ...ok, capture: `captures/${ID}` }, 'capture-dir'],
    ['a scratch directory not in normal form', { ...ok, capture: `/box/captures/../captures/${ID}` }, 'capture-dir'],
    ['a scratch directory with a trailing slash', { ...ok, capture: `${CAPTURE}/` }, 'capture-dir'],
    ['a scratch directory not named by a capture id', { ...ok, capture: '/box/captures/builds' }, 'capture-dir'],
    ['a scratch directory outside captures/', { ...ok, capture: `/box/runs/${ID}` }, 'capture-dir'],
    ['the temporary directory itself', { ...ok, tmux: '/tmp' }, 'tmux-dir'],
    ['the fleet\'s default socket directory', { ...ok, tmux: '/tmp/tmux-1000' }, 'tmux-dir'],
    ['a right-looking name under the wrong parent', { ...ok, tmux: `/var/tmp/${captureTmuxDirName(ID)}` }, 'tmux-dir'],
    ['a right-looking name one level down', { ...ok, tmux: `/tmp/x/${captureTmuxDirName(ID)}` }, 'tmux-dir'],
    ['another capture\'s tmux directory', { ...ok, tmux: `/tmp/${captureTmuxDirName('f'.repeat(32))}` }, 'tmux-dir'],
    ['a relative tmux directory', { ...ok, tmux: captureTmuxDirName(ID) }, 'tmux-dir'],
    ['a tmux directory not in normal form', { ...ok, tmux: `/tmp/./${captureTmuxDirName(ID)}` }, 'tmux-dir'],
  ])('refuses %s', (_why, raw, refusal) => {
    // Every directory reads as a real one and as this user's own private one, so each row is refused by the rule it names
    // and by no later check (review 3882 F6: a right-looking name under the wrong parent reaches the parent rule).
    const r = readDriveInput(raw, allDirs, BASE, allDirs);
    expect(r).toMatchObject({ ok: false, refusal });
  });
  it.each<[string, (p: string) => boolean, string]>([
    ['a scratch directory that is not a real directory', (p) => p !== CAPTURE, 'capture-dir'],
    ['a tmux directory that is not a real directory', (p) => p !== TMUX, 'tmux-dir'],
  ])('refuses %s', (_why, isDir, refusal) => {
    expect(readDriveInput({ capture: CAPTURE, tmux: TMUX, case: 'c0' }, isDir, BASE, allDirs)).toMatchObject({ ok: false, refusal });
  });
  it('refuses a tmux directory that is not this user\'s own and private, after every other check passed', () => {
    expect(readDriveInput({ capture: CAPTURE, tmux: TMUX, case: 'c0' }, allDirs, BASE, (p) => p !== TMUX)).toMatchObject({ ok: false, refusal: 'tmux-dir' });
  });
  it.each([
    ['owned by this user, 0700', { uid: 1000, mode: 0o40700 }, true],
    ['owned by this user, 0755 (only read and search for others)', { uid: 1000, mode: 0o40755 }, true],
    ['owned by another user', { uid: 1001, mode: 0o40700 }, false],
    ['owned by root', { uid: 0, mode: 0o40700 }, false],
    ['writable by group', { uid: 1000, mode: 0o40720 }, false],
    ['writable by other', { uid: 1000, mode: 0o40702 }, false],
    ['the sticky world-writable temporary directory\'s mode', { uid: 1000, mode: 0o41777 }, false],
  ])('privateTo: %s', (_why, st, want) => {
    expect(privateTo(st, 1000)).toBe(want);
  });
  it('reads the real file system by default: a link at the scratch directory\'s name is refused', () => {
    const base = mkTmp('ccrc-delivery-drive-');
    const real = path.join(base, 'elsewhere');
    mkdirSync(real);
    mkdirSync(path.join(base, 'captures'));
    const capture = path.join(base, 'captures', ID);
    symlinkSync(real, capture);
    const tmux = path.join(base, captureTmuxDirName(ID));
    mkdirSync(tmux);
    expect(readDriveInput({ capture, tmux, case: 'c0' }, undefined, base)).toMatchObject({ ok: false, refusal: 'capture-dir' });
  });
  it('reads the real file system by default: a link at the tmux directory\'s name, to a real one, is refused', () => {
    const base = mkTmp('ccrc-delivery-drive-');
    mkdirSync(path.join(base, 'captures', ID), { recursive: true });
    const real = path.join(base, 'real-tmux');
    mkdirSync(real);
    const tmux = path.join(base, captureTmuxDirName(ID));
    symlinkSync(real, tmux);
    expect(readDriveInput({ capture: path.join(base, 'captures', ID), tmux, case: 'c0' }, undefined, base)).toMatchObject({ ok: false, refusal: 'tmux-dir' });
    // The same layout with a real directory there is taken.
    const base2 = mkTmp('ccrc-delivery-drive-');
    mkdirSync(path.join(base2, 'captures', ID), { recursive: true });
    mkdirSync(path.join(base2, captureTmuxDirName(ID)), { mode: 0o700 });
    expect(readDriveInput({ capture: path.join(base2, 'captures', ID), tmux: path.join(base2, captureTmuxDirName(ID)), case: 'c0' }, undefined, base2)).toMatchObject({ ok: true });
  });
  it('reads the real file system by default: a tmux directory group or other can write is refused, as the runner\'s 0700 is taken', () => {
    const base = mkTmp('ccrc-delivery-drive-');
    mkdirSync(path.join(base, 'captures', ID), { recursive: true });
    const tmux = path.join(base, captureTmuxDirName(ID));
    mkdirSync(tmux, { mode: 0o700 });
    const input = { capture: path.join(base, 'captures', ID), tmux, case: 'c0' };
    expect(readDriveInput(input, undefined, base)).toMatchObject({ ok: true });
    chmodSync(tmux, 0o770);
    expect(readDriveInput(input, undefined, base)).toMatchObject({ ok: false, refusal: 'tmux-dir' });
    chmodSync(tmux, 0o707);
    expect(readDriveInput(input, undefined, base)).toMatchObject({ ok: false, refusal: 'tmux-dir' });
  });
  it('by default the parent is this process\'s own temporary directory', () => {
    const r = readDriveInput({ capture: CAPTURE, tmux: path.join(os.tmpdir(), captureTmuxDirName(ID)), case: 'c0' }, allDirs, undefined, allDirs);
    expect(r).toMatchObject({ ok: true });
  });
});

describe('captureTmuxRunner: the capture\'s own server, never the fleet\'s', () => {
  /** A stand-in `tmux` on PATH that prints its argv and environment as JSON. */
  function fakeTmuxBin(): string {
    const dir = mkTmp('ccrc-delivery-tmux-');
    const bin = path.join(dir, 'tmux');
    writeFileSync(bin, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n`);
    chmodSync(bin, 0o755);
    return dir;
  }
  it('runs tmux -L ccrc-capture on the given TMUX_TMPDIR, in an environment built from empty', async () => {
    const bin = fakeTmuxBin();
    const before = process.env['TMUX'];
    process.env['TMUX'] = '/tmp/tmux-1000/default,1,0';
    try {
      const r = await captureTmuxRunner(TMUX, bin)('tmux', ['capture-pane', '-t', '=cc-capture:', '-p']);
      expect(r).toMatchObject({ ran: true, code: 0 });
      const out = JSON.parse(r.stdout) as { argv: string[]; env: Record<string, string> };
      expect(out.argv).toEqual(['-L', CAPTURE_SOCKET, 'capture-pane', '-t', '=cc-capture:', '-p']);
      expect(out.env['TMUX_TMPDIR']).toBe(TMUX);
      expect(out.env['TMUX']).toBeUndefined();
      expect(Object.keys(out.env).filter((k) => k !== 'PATH' && k !== 'TMUX_TMPDIR' && k !== 'LANG')).toEqual([]);
    } finally {
      if (before === undefined) delete process.env['TMUX']; else process.env['TMUX'] = before;
    }
  });
  it('runs nothing but tmux', async () => {
    const r = await captureTmuxRunner(TMUX, fakeTmuxBin())('ccd', ['ws-rm']);
    expect(r).toMatchObject({ ran: false, reason: 'spawn' });
  });
  it('a tmux that cannot be found is a spawn failure, not an exit', async () => {
    const r = await captureTmuxRunner(TMUX, mkTmp('ccrc-delivery-empty-'))('tmux', ['has-session']);
    expect(r).toMatchObject({ ran: false, reason: 'spawn' });
  });
});

/** A minimal pane: a box that echoes what is typed (`M-Enter` a new line), and an Enter that submits it. */
function boxPane(): { run: Runner; submitted: string[]; calls: string[][] } {
  const submitted: string[] = [];
  const calls: string[][] = [];
  let lines = [''];
  const render = (): string => {
    const rule = '─'.repeat(40);
    const box = [`❯\xa0${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)];
    return ['previous turn', rule, ...box, rule, '  status'].join('\n') + '\n';
  };
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: render(), stderr: '' };
    if (args[0] === 'send-keys') {
      const lit = args.indexOf('-l');
      if (lit >= 0) lines[lines.length - 1] += args[args.length - 1]!;
      else if (args.at(-1) === 'M-Enter') lines.push('');
      else if (args.at(-1) === 'Enter') { submitted.push(lines.join('\n')); lines = ['']; }
      else if (args.at(-1) === 'C-u') lines = [''];
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { run, submitted, calls };
}

describe('driveCase: the product\'s own send, with the prompt route\'s options', () => {
  const input = (c: 'c0' | 'c5' | 'c3c') => ({ capture: CAPTURE, tmux: TMUX, case: c });
  it('types the case\'s text into the capture\'s session and answers ok once it is submitted', async () => {
    const p = boxPane();
    expect(await driveCase(input('c0'), p.run, async () => {})).toEqual({ kind: 'sent', send: 'ok' });
    expect(p.submitted).toEqual([deliveryExpected('c0')]);
    expect(p.calls.every((c) => c[0] === 'tmux' && c.includes('=cc-capture:'))).toBe(true);
  });
  it('a multiline case is typed line by line with M-Enter, and submitted once', async () => {
    const p = boxPane();
    expect(await driveCase(input('c5'), p.run, async () => {})).toEqual({ kind: 'sent', send: 'ok' });
    expect(p.submitted).toEqual([deliveryExpected('c5')]);
    const enters = p.calls.filter((c) => c.at(-1) === 'Enter').length;
    expect(enters).toBe(1);
  });
  it('answers sendPrompt\'s own refusal word when every tmux call ran: a dead session is not-alive', async () => {
    const dead: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: 'can\'t find session' });
    expect(await driveCase(input('c0'), dead, async () => {})).toEqual({ kind: 'sent', send: 'not-alive' });
  });
  it('the options it passes are the ones the prompt route passes for a plain prompt: refuse a draft, no attachments', () => {
    // WHAT THIS COMPARES (review 3882 A6): the driver's constant against the plain-prompt values, written here. It does not
    // read the route. The route's own policy is read where its call is by the send census (`lane-draft-never-blocks.test.ts`,
    // which reads each `sendPrompt` call's `onDraft` at the call), and the driver's call spells `onDraft` by name for the
    // same reason. The route's two other options are left out on purpose: `resumeIfOwn` is a Retry's only (`body.resume`),
    // and `recheck` is the designation's re-ask before the first key, which answers `go` for any session that is not the
    // Overlord, as a capture's session never is.
    expect(ROUTE_PLAIN_PROMPT_OPTIONS).toEqual({ onDraft: 'refuse', attachments: [] });
  });

  // A FAULT OF THE BOX IS NEVER A VERDICT (review 3882 F2, the coordinator's ruling): a tmux call the driver's own runner
  // could not complete (its per-call bound, a spawn that failed) ends the case as a fault, with no send word read as the
  // product's, and no later call of the case runs, so nothing more is typed into a pane that may hold a half-typed draft.
  const notRan = (reason: 'timeout' | 'spawn'): Awaited<ReturnType<Runner>> => ({ ran: false, reason, detail: `tmux ${reason}`, code: 1, stdout: '', stderr: '' });
  it('a tmux call that timed out is a fault of the box, not a send word', async () => {
    const p = boxPane();
    const slow: Runner = async (cmd, args) => (args[0] === 'capture-pane' ? notRan('timeout') : p.run(cmd, args));
    expect(await driveCase(input('c0'), slow, async () => {})).toMatchObject({ kind: 'fault', reason: 'timeout' });
  });
  it('a tmux that could not start is a fault of the box, not a send word', async () => {
    expect(await driveCase(input('c0'), async () => notRan('spawn'), async () => {})).toMatchObject({ kind: 'fault', reason: 'spawn' });
  });
  it('after the first call that could not complete, no later call of the case runs: a failed type is not followed by more keys', async () => {
    const p = boxPane();
    let typed = 0;
    const failsOnFirstType: Runner = async (cmd, args) => {
      if (args[0] === 'send-keys' && args.includes('-l') && ++typed === 1) return notRan('timeout');
      return p.run(cmd, args);
    };
    const out = await driveCase(input('c5'), failsOnFirstType, async () => {});
    expect(out).toMatchObject({ kind: 'fault', reason: 'timeout' });
    // The failed type was the case's last tmux call: no key after it (no M-Enter, no clear, no Enter) reached the pane.
    const typedAt = p.calls.length;
    expect(p.calls.slice(typedAt).length).toBe(0);
    expect(p.calls.filter((c) => c[1] === 'send-keys')).toEqual([]);
    expect(p.submitted).toEqual([]);
    expect(typed).toBe(1);
  });
  it('a screen read that could not complete stops the case there, wherever it falls: no key and no read follows it', async () => {
    // The send reads the pane back before and after typing (its draft and echo checks) and after its Enter. Any of those
    // reads failing is a fault, and the send must not go on to type or press a key on a screen it could not read.
    let faults = 0;
    for (let failAt = 1; failAt <= 6; failAt++) {
      const p = boxPane();
      let reads = 0;
      let faultAt = -1;
      let submittedAt = -1;
      const readFails: Runner = async (cmd, args) => {
        if (args[0] === 'capture-pane' && ++reads === failAt) { faultAt = p.calls.length; submittedAt = p.submitted.length; return notRan('timeout'); }
        return p.run(cmd, args);
      };
      const out = await driveCase(input('c0'), readFails, async () => {});
      if (faultAt < 0) continue;
      faults += 1;
      expect(out, `read ${failAt}`).toMatchObject({ kind: 'fault', reason: 'timeout' });
      expect(p.calls.slice(faultAt), `read ${failAt}`).toEqual([]);
      expect(p.submitted.length, `read ${failAt}`).toBe(submittedAt);
    }
    expect(faults).toBeGreaterThanOrEqual(3);
  });
  it('the answer line: a send word exits 0 with {send}; a fault exits non-zero with {fault, send, detail}, which no reader takes as sent', () => {
    expect(driveAnswer({ kind: 'sent', send: 'ok' })).toEqual({ code: 0, line: '{"send":"ok"}' });
    const f = driveAnswer({ kind: 'fault', reason: 'timeout', detail: 'tmux did not answer', send: 'not-alive' });
    expect(f.code).toBe(DRIVE_FAULT_EXIT);
    expect(f.code).not.toBe(0);
    expect(JSON.parse(f.line)).toEqual({ fault: 'timeout', send: 'not-alive', detail: 'tmux did not answer' });
  });
  it('every case is sent as the console sends it', () => {
    for (const id of DELIVERY_CASE_IDS) expect(deliveryCaseText(id).length).toBeGreaterThan(0);
  });
});

describe('nothing in the server imports the driver, and no route reaches it', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
  it('no source file under server/src names it in an import', () => {
    const src = path.join(ROOT, 'server/src');
    const importers = files(src).filter((f) => !f.endsWith('deliveryDrive.ts'))
      .filter((f) => /\bfrom\s+['"][^'"]*deliveryDrive(\.js)?['"]|import\(\s*['"][^'"]*deliveryDrive/.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual([]);
    expect(existsSync(path.join(src, 'inject/deliveryDrive.ts'))).toBe(true);
  });
  // No route can reach a module that nothing imports: routes register only from modules the composition imports. That the
  // driver names no tmux program of its own is the tmux socket census's (`tmux-socket-census.test.ts`), which has no
  // exception for it.
});
