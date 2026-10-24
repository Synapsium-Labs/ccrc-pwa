// D-5912 (plan docs/superpowers/plans/2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md, Task P1c; spec
// §2.3, §2.4): every server lane that types into a pane passes `onDraft: 'stash'`. A human's draft is stashed with
// Claude Code's own `C-s` around the lane's text and given back (D-5911), so a draft is never a reason for mail to
// wait: the mail lane's `draft-present` back-off and its "unsent text" sender notice are deleted, the two stash
// refusals are recorded as gates and take the park, and every `sendPrompt` call in `server/src` is held to the
// classified call-site table below.
//
// The pane fake emulates the five facts Task P1b's probe measured (`send-stash.test.ts`'s docstring): `C-s` on a
// non-empty box stashes it and shows ` › stashed ·` on the notification row; a submit restores it; `C-s` on an empty
// box pops it. The harness idioms are `mail-sweep.test.ts`'s (a fixture HOME, a recording Runner, a primed watcher,
// `Date` faked alone) and `dispatch-route.test.ts`'s (`dispatchRun` called directly).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { renderMailNudge } from '../src/coord/envelope.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { clearSender } from '../src/inject/send.js';
import { ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import type { PushPayload } from '../src/push.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { sourceOfSymbol } from './scan/symbols.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', 'src');

const ID = 'project-a-quiet-basin';
const UUID = 'a'.repeat(36);
const PID = 4242;
const NOW = 1_800_000_000_000;
const MAIL_QUIET_MS = 60_000;
const MAIL_MAX_ATTEMPTS = 6;
const NUDGE = renderMailNudge(ID);
const DRAFT = 'a half typed note to the worker';
const RULE = '─'.repeat(80);

// ── the pane ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Pane { box: string; stash: string | null; history: string[]; keys: string[] }

/** Claude Code's layout as the probe captured it: transcript, the notification row (` › stashed ·` while a stash is
 *  held), a rule, the box (the dim placeholder when empty), a rule, the footer. */
const render = (p: Pane): string => [
  '⏺ an earlier turn, done', '',
  p.stash !== null ? ' › stashed · ctrl+s to restore' : '',
  RULE,
  p.box === '' ? '❯ \x1b[2mTry "fix typecheck errors"\x1b[0m' : `❯ ${p.box}`,
  RULE,
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
].join('\n') + '\n';

/** A Runner for the tmux verbs over `p`; `inertStash` models a rebound `C-s`. Other verbs answer `other`. */
const paneRunner = (p: Pane, o: { inertStash?: boolean; other?: (args: string[]) => { code: number; stdout: string; stderr: string } } = {}): Runner =>
  async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: render(p), stderr: '' };
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') { p.keys.push(`lit:${args.at(-1)}`); p.box += args.at(-1)!; return { code: 0, stdout: '', stderr: '' }; }
      const key = args.at(-1)!;
      p.keys.push(key);
      if (key === 'C-u') p.box = '';
      else if (key === 'C-s' && !o.inertStash) {
        if (p.box !== '') { p.stash = p.box; p.box = ''; } else if (p.stash !== null) { p.box = p.stash; p.stash = null; }
      } else if (key === 'Enter' && p.box !== '') {
        p.history.push(p.box);
        p.box = '';
        if (p.stash !== null) { p.box = p.stash; p.stash = null; }
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    return o.other?.(args) ?? { code: 0, stdout: '', stderr: '' };
  };

// ── the mail lane ───────────────────────────────────────────────────────────────────────────────────────────────────

const seedRecipient = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
    v: 1, state: 'done', sessionId: UUID, pid: PID, event: null, updatedAt: Date.now() - 61_000, ask: null, subagents: [] }));
  const live = path.join(home, '.claude', 'sessions');
  mkdirSync(live, { recursive: true });
  writeFileSync(path.join(live, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: '/w/project-a', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: Date.now() - MAIL_QUIET_MS - 1_000, version: '2.1.303' }));
};

const mailRig = async (p: Pane, o: { inertStash?: boolean } = {}) => {
  const home = mkTmp('ccrc-lane-draft-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const deps: Deps = { ...testDeps(home, paneRunner(p, o)), coord,
    push: { notify: async (x: PushPayload) => { sent.push(x); } } as never };
  const w = new FleetWatcher(deps, new Bus(), 2000);
  await w.tick();                 // primed on an empty registry: no pane is captured
  seedRecipient(home);
  const mail = coord.insertMail({ fromId: 'project-a-sender', fromUuid: 'b'.repeat(36), toId: ID, runId: null,
    kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
  const d = coord.queueDelivery(mail.id, ID, 'ccrc-mail test payload');
  const row = () => coord.db.prepare('SELECT state, attempts, lastError, lastGate, parkedAt, parkReason FROM mail_deliveries WHERE id = ?')
    .get(d.id) as { state: string; attempts: number; lastError: string | null; lastGate: string | null;
      parkedAt: number | null; parkReason: string | null };
  return { home, coord, w, sent, id: d.id, row };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the mail lane stashes a draft (D-5912)', () => {
  it('an idle recipient with a draft: the mail lands within one sweep and the box reads the draft back', async () => {
    const p: Pane = { box: DRAFT, stash: null, history: [], keys: [] };
    const r = await mailRig(p);
    await r.w.sweepMail();
    expect(p.keys).toEqual(['C-s', `lit:${NUDGE}`, 'Enter']);
    expect(p.history).toEqual([NUDGE]);
    expect(p.box, 'the draft is given back').toBe(DRAFT);
    expect(p.stash).toBeNull();
    expect(r.row()).toMatchObject({ state: 'delivered', lastError: null });
  });

  it("a sweep over a draft pane never writes `lastError:'draft-present'`, and tells the sender nothing", async () => {
    // A rebound `C-s`: the stash cannot take the draft, so every attempt refuses. The word is the stash's, never
    // `draft-present`, and no "unsent text" notice reaches the sender.
    const p: Pane = { box: DRAFT, stash: null, history: [], keys: [] };
    const r = await mailRig(p, { inertStash: true });
    for (let i = 0; i < 3; i++) {
      await r.w.sweepMail();
      expect(r.row().lastError).not.toBe('draft-present');
      vi.setSystemTime(Date.now() + 16 * 60_000);
      seedRecipient(r.home);
    }
    expect(r.row().lastError).toBe('stash-failed');
    expect(r.sent.filter((x) => /unsent text/.test(JSON.stringify(x)))).toEqual([]);
    expect(p.keys.filter((k) => k !== 'C-s'), 'nothing but the stash key ever reached the draft').toEqual([]);
    expect(p.box).toBe(DRAFT);
  }, 60_000);

  it("the lane's code holds no `draft-present` arm (source)", () => {
    const body = sweepMailCode();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).not.toMatch(/'draft-present'/);
    expect(body).toMatch(/onDraft:\s*'stash'/);
  });

  it("`stash-failed` to the attempts ceiling parks `queued` with that reason, and the park's push fires once naming the recipient and the word", async () => {
    const p: Pane = { box: DRAFT, stash: null, history: [], keys: [] };
    const r = await mailRig(p, { inertStash: true });
    for (let i = 0; i < MAIL_MAX_ATTEMPTS + 1; i++) {
      await r.w.sweepMail();
      vi.setSystemTime(Date.now() + 16 * 60_000);   // past the largest back-off step
      seedRecipient(r.home);
    }
    expect(r.row()).toMatchObject({ state: 'queued', parkReason: 'stash-failed', lastGate: 'stash-failed' });
    expect(r.row().parkedAt).not.toBeNull();
    const parked = r.sent.filter((x) => x.tag === `mail-parked-${r.id}`);
    expect(parked).toHaveLength(1);
    expect(JSON.stringify(parked[0])).toContain(ID);
    expect(JSON.stringify(parked[0])).toContain('stash-failed');
    expect(p.box, 'never typed over').toBe(DRAFT);
  }, 120_000);

  it("`stash-occupied` is recorded as the delivery's gate and presses nothing", async () => {
    const p: Pane = { box: DRAFT, stash: 'an earlier stashed note', history: [], keys: [] };
    const r = await mailRig(p);
    await r.w.sweepMail();
    expect(p.keys).toEqual([]);
    expect(r.row()).toMatchObject({ state: 'queued', lastError: 'stash-occupied', lastGate: 'stash-occupied' });
    expect(p.stash).toBe('an earlier stashed note');
  });

  it("#853's `enter-ignored` hold still presses nothing on unchanged human text", async () => {
    const p: Pane = { box: DRAFT, stash: null, history: [], keys: [] };
    const r = await mailRig(p);
    r.coord.db.prepare("UPDATE mail_deliveries SET attempts = 1, parkedAt = ?, parkReason = 'enter-ignored', parkBox = ?, nextAttemptAt = ? WHERE id = ?")
      .run(NOW - 60_000, DRAFT, NOW - 1, r.id);
    await r.w.sweepMail();
    expect(p.keys).toEqual([]);
    expect(r.row()).toMatchObject({ state: 'queued', lastGate: 'parked', parkReason: 'enter-ignored' });
    expect(p.box).toBe(DRAFT);
  });
});

// ── dispatch's `/clear` ─────────────────────────────────────────────────────────────────────────────────────────────

describe("dispatch's `/clear` stashes a draft (D-5912)", () => {
  it("dispatch's `/clear` with a draft: cleared conversation, draft restored", async () => {
    vi.useRealTimers();
    const home = mkTmp('ccrc-lane-draft-dispatch-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = { wrapper: 'claude', project: 'project-a', workdir: `/w/${ID}`, uuid: `u-${ID}`,
      started: '1', workspace: ID, branch: `ws/${ID}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: 'project-a', wave: 2, waveOf: 3, claimedBy: 'c' });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    coord.setSession(opened.id, ID);
    const p: Pane = { box: DRAFT, stash: null, history: [], keys: [] };
    const base = testDeps(home, paneRunner(p));
    const deps: DispatchRunDeps = {
      ...base, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP],
        rosterFp: null, build: null },
      configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const, sendClear: clearSender(base),
    };
    const out = await dispatchRun(deps, opened.id, 'go', undefined, undefined);
    expect(out).toMatchObject({ ok: true, resumed: true, clearedAt: expect.any(Number) });
    expect(p.keys).toEqual(['C-s', 'lit:/clear', 'Enter']);
    expect(p.history).toEqual(['/clear']);
    expect(p.box, 'the draft is given back after the clear').toBe(DRAFT);
    expect(p.stash).toBeNull();
  });
});

// ── the call-site table ─────────────────────────────────────────────────────────────────────────────────────────────

/** Comments blanked (each character kept as a space or newline), so offsets and line numbers survive. */
const blankComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre: string) => pre + ' '.repeat(m.length - pre.length));

/** `sweepMail`'s code, keyed on its symbol (D-5854: no literal source pin over a W1a file), comments blanked. */
const sweepMailCode = (): string => blankComments(sourceOfSymbol('server/src/watch.ts', 'FleetWatcher.sweepMail'));

type Policy = 'stash' | 'refuse-or-replace';
interface Site { file: string; fn: string; policy: Policy }

/** EVERY `sendPrompt(` call in `server/src`, classified (spec §2.3): a lane that types into a pane stashes a draft; an
 *  operator-initiated send refuses or replaces it, as the operator asked. A new call is red until it is classified
 *  here. The definition in `inject/send.ts` is not a call. */
const CALL_SITES: readonly Site[] = [
  { file: 'inject/send.ts', fn: 'clearSender', policy: 'stash' },                 // the wave N>=2 `/clear`, dispatch's `sendClear` port (ARCH-22)
  { file: 'server.ts', fn: 'POST /api/sessions/:id/prompt', policy: 'refuse-or-replace' },   // the PWA's human send
  { file: 'watch.ts', fn: 'idleNudgeOne', policy: 'stash' },                     // the idle compact nudge
  { file: 'watch.ts', fn: 'sweepMail', policy: 'stash' },                        // every mail
];

const FN_RE = /^ {2}(?:private |public |protected )?(?:static )?(?:async )?(?!(?:if|for|while|switch|catch|return|await)\b)([A-Za-z_]\w*)\s*\(|^(?:export )?(?:async )?function\s+([A-Za-z_]\w*)|app\.(get|post|put|patch|delete)\('([^']+)'/;

/** Every call in `files` (path relative to `src`, and its text): where it is, and what it passes for `onDraft`. */
const callSites = (files: readonly { rel: string; text: string }[]): { file: string; fn: string; onDraft: string | null }[] => {
  const out: { file: string; fn: string; onDraft: string | null }[] = [];
  for (const { rel, text } of files) {
    const code = blankComments(text);
    for (const m of code.matchAll(/\bsendPrompt\s*\(/g)) {
      if (/function\s+$/.test(code.slice(Math.max(0, m.index! - 20), m.index!))) continue;   // the definition
      const lines = code.slice(0, m.index!).split('\n');
      let fn = '?';
      for (let k = lines.length - 1; k >= 0; k--) {
        const f = FN_RE.exec(lines[k]!);
        if (f !== null) { fn = f[1] ?? f[2] ?? `${f[3]!.toUpperCase()} ${f[4]}`; break; }
      }
      let depth = 0, j = code.indexOf('(', m.index!);
      const start = j;
      for (; j < code.length; j++) {
        if (code[j] === '(') depth++;
        else if (code[j] === ')' && --depth === 0) break;
      }
      const call = code.slice(start, j + 1);
      const od = /onDraft:\s*([^,}]+)/.exec(call);
      out.push({ file: rel, fn, onDraft: od === null ? null : od[1]!.trim() });
    }
  }
  return out;
};

const srcFiles = (): { rel: string; text: string }[] => {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) out.push({ rel: path.relative(srcDir, full).split(path.sep).join('/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(srcDir);
  return out;
};

/** What the table says is wrong with `found`: an unlisted call, a listed site with no call, or a policy broken. */
const tableFaults = (found: ReturnType<typeof callSites>): string[] => {
  const faults: string[] = [];
  const key = (s: { file: string; fn: string }): string => `${s.file} ${s.fn}`;
  for (const f of found) {
    const site = CALL_SITES.find((s) => key(s) === key(f));
    if (site === undefined) { faults.push(`unlisted: ${key(f)}`); continue; }
    const ok = site.policy === 'stash'
      ? f.onDraft === "'stash'"
      : f.onDraft !== null && !f.onDraft.includes('stash');
    if (!ok) faults.push(`${key(f)}: onDraft ${f.onDraft ?? '(none)'} breaks policy ${site.policy}`);
  }
  for (const s of CALL_SITES) if (!found.some((f) => key(f) === key(s))) faults.push(`no call: ${key(s)}`);
  return faults;
};

describe('every `sendPrompt` call is classified (D-5912)', () => {
  it('every `sendPrompt` call matches its row in the call-site table', () => {
    const found = callSites(srcFiles());
    expect(found.length).toBe(CALL_SITES.length);
    expect(tableFaults(found)).toEqual([]);
  });

  it('…and an unlisted call is red', () => {
    const extra = { rel: 'watch.ts', text: 'class X {\n  async someNewLane(): Promise<void> {\n    await sendPrompt(d, id, "hi");\n  }\n}\n' };
    const faults = tableFaults(callSites([...srcFiles(), extra]));
    expect(faults).toEqual(['unlisted: watch.ts someNewLane']);
  });

  it('…and a lane that drops `stash` is red', () => {
    const files = srcFiles().map((f) => f.rel === 'inject/send.ts'
      ? { ...f, text: f.text.replace("'/clear', { onDraft: 'stash' })", "'/clear')") } : f);
    expect(tableFaults(callSites(files))).toEqual(['inject/send.ts clearSender: onDraft (none) breaks policy stash']);
  });
});
