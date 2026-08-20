import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import type { CcdArgv } from '../src/ccdargv.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Bus } from '../src/bus.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { guardRunner, seedRoster, testDeps } from './helpers.js';
import { unreadableField } from './ioDoubles.js';
import { askKey } from '../src/askkey.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';

const ID = 'claude2-MekWarLive';

const seedSession = (home: string, id: string, wrapper: string) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** Server over a seeded one-session registry; capture-pane returns scripted panes in order (last repeats).
 *  `status` seeds the authoritative live status file (used by the interrupt route). `panes` may be a
 *  function of `home` when a test needs a clip path scripted into the pane text — `home` is a fresh
 *  mkdtemp dir created inside this call, so it can't be known before calling. */
async function makeApp(
  panes: (string | null)[] | ((home: string) => (string | null)[]),
  opts: { status?: 'busy' | 'idle' } = {},
): Promise<{ app: FastifyInstance; calls: string[][]; bus: Bus; home: string }> {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  const resolvedPanes = typeof panes === 'function' ? panes(home) : panes;
  seedSession(home, ID, 'claude2');
  const PANE_PID = 4242;
  if (opts.status) {
    const sdir = path.join(home, '.claude-personal', 'sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(path.join(sdir, `${PANE_PID}.json`), JSON.stringify({
      pid: PANE_PID, sessionId: '1'.repeat(36), cwd: `/data/projects/${ID}`,
      name: 'mek', status: opts.status, statusUpdatedAt: 1784600000000, version: '2.1.216',
    }));
  }
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = resolvedPanes[Math.min(capIdx, resolvedPanes.length - 1)] ?? null;
      capIdx++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PANE_PID}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const bus = new Bus();
  const cfg = loadConfig({ CCRC_HOME: home });
  const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() }, bus);
  return { app, calls, bus, home };
}

const sendKeysCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys');

/** An empty input box — capture-pane before/after any injection attempt. */
const EMPTY_BOX = '❯ \n';

const OPTS = ['A + B drawer (Recommended)', 'A pure', 'B first, A later', 'Other'];
function menuPane(selected: number): string {
  const lines = ['● Which architecture should we go with?', ''];
  OPTS.forEach((label, i) => {
    const n = i + 1;
    lines.push(`${n === selected ? '❯' : ' '} ${n}. ${label}`);
  });
  lines.push('', 'Enter to confirm · Esc to cancel');
  return lines.join('\n') + '\n';
}
const DIALOG_ID = parseDialog(menuPane(1))!.id;

describe('write routes', () => {
  it('POST prompt happy path returns 200 {ok:true}', async () => {
    // Three panes: empty box, the echo verify, then the emptied box that proves
    // Enter submitted (see sendPrompt's post-Enter check).
    const { app, calls } = await makeApp(['scrollback\n❯ \n', 'scrollback\n❯ hello\n', 'scrollback\n❯ \n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', 'hello'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('POST prompt with a draft present returns 409 with the draft in the body', async () => {
    const { app } = await makeApp(['❯ half-typed thought\n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hi' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'draft-present', draft: 'half-typed thought' });
    await app.close();
  });

  // C0.2, the user-visible fix: knownId used to answer via readRegistry,
  // which drops a session's ENTIRE row when any one of its three
  // completeness fields (wrapper/workdir/uuid) fails to read — so a single
  // transient read failure on a LIVE session's own sibling field (not its
  // identity) used to 404 a prompt typed into that very session. knownId now
  // answers off one `readdir` + `.uuid` membership alone, which this
  // unreadable `workdir` cannot touch.
  it('POST prompt succeeds — no 404 — when the live session\'s own workdir field is unreadable', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const PANE_PID = 4242;
    const panes = ['scrollback\n❯ \n', 'scrollback\n❯ hello\n', 'scrollback\n❯ \n'];
    let capIdx = 0;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'capture-pane') {
        const pane = panes[Math.min(capIdx, panes.length - 1)];
        capIdx++;
        return { code: 0, stdout: pane!, stderr: '' };
      }
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PANE_PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    // The shape `remote/io.ts` produces when one op of the ~21 a session's
    // readRegistry fires in parallel fails or times out: null, indistinguishable
    // at field() from a file that is not there (same idiom as hold-gate.test.ts's
    // `holdUnreadableIO`) — here on `workdir`, one of readRegistry's three
    // completeness fields, chosen because ITS failure is exactly what used to
    // drop the whole row.
    const workdirUnreadableIO = unreadableField(ID, 'workdir');
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: workdirUnreadableIO, queue: new KeyedQueue() },
      new Bus(),
    );

    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('POST prompt still 404s a truly unregistered id under the same unreadable-field IO', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const workdirUnreadableIO = unreadableField(ID, 'workdir');
    const cfg = loadConfig({ CCRC_HOME: home });
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: workdirUnreadableIO, queue: new KeyedQueue() },
      new Bus(),
    );

    const res = await app.inject({ method: 'POST', url: '/api/sessions/nope/prompt', payload: { text: 'hi' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST dialog happy path walks and confirms', async () => {
    const { app, calls } = await makeApp([menuPane(1), menuPane(2)]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/dialog`,
      payload: { dialogId: DIALOG_ID, optionIndex: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Down'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('POST dialog with a stale id returns 409', async () => {
    const { app, calls } = await makeApp([menuPane(1)]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/dialog`,
      payload: { dialogId: 'deadbeef', optionIndex: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'stale-dialog' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  it('POST interrupt on a busy session (live status) sends Escape', async () => {
    const { app, calls } = await makeApp(['generation…\n❯ \n'], { status: 'busy' });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/interrupt`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Escape']]);
    await app.close();
  });

  it('POST interrupt on an idle session returns 409 not-busy', async () => {
    const { app } = await makeApp(['❯ \n'], { status: 'idle' });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/interrupt`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-busy' });
    await app.close();
  });

  it('unknown session id returns 404 on all five routes', async () => {
    const { app } = await makeApp(['❯ \n']);
    for (const [url, payload] of [
      ['/api/sessions/nope/prompt', { text: 'hi' }],
      ['/api/sessions/nope/dialog', { dialogId: 'x', optionIndex: 1 }],
      ['/api/sessions/nope/interrupt', {}],
      ['/api/sessions/nope/ask', { askKey: 'k', optionIndexes: [0] }],
      ['/api/sessions/nope/submit', {}],
    ] as const) {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});

// Task 3: /submit — the one-tap rescue for sendPrompt's enter-ignored. Same
// convention as the /interrupt suite above: 404 covered in the shared loop,
// so this adds 409 (carrying the refusal token) and 200.
describe('POST /api/sessions/:id/submit', () => {
  it('happy path presses Enter once and returns 200 {ok:true}', async () => {
    // Two panes: the box holding a draft, then the emptied box that proves
    // Enter submitted (see submitEnter's `submitted` check).
    const { app, calls } = await makeApp(['scrollback\n❯ half-typed\n', 'scrollback\n❯ \n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'half-typed' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter']]);
    await app.close();
  });

  it('refuses an empty box with 409 nothing-to-submit, and presses nothing', async () => {
    const { app, calls } = await makeApp([EMPTY_BOX]);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'half-typed' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  it('refuses while a menu owns the keyboard with 409 dialog-open, and presses nothing', async () => {
    const { app, calls } = await makeApp([menuPane(1)]);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'half-typed' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'dialog-open' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  // Review Important 1: the happy path above proves submission by the box
  // turning EMPTY — a regression to the emptiness-only check `submitted()`
  // was written to retire (see send.ts) would leave it green. Here the
  // post-Enter row is non-empty and different from the draft, the shape a
  // busy Claude Code session actually renders (it swaps the row for a hint
  // rather than emptying it), so success can only be proved by "our text
  // left", not by "the box is empty".
  it('happy path proves submission via the needle leaving the box, not merely turning empty', async () => {
    const { app, calls } = await makeApp(['scrollback\n❯ half-typed\n', 'scrollback\n❯ Press up to edit queued messages\n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'half-typed' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter']]);
    await app.close();
  });

  // "fold in" per review: enter-ignored was covered at unit level only
  // (submit-route.test.ts) — Task 9's toast switches on this token, so the
  // route itself needs to prove it surfaces as 409, not just that `submitEnter`
  // returns it. Real timers here (routes.test.ts's sendDeps takes no `sleep`
  // override), so this one costs the full SUBMIT_TRIES*SUBMIT_POLL_MS wait.
  it('refuses a genuinely stuck box with 409 enter-ignored, after exactly one Enter', async () => {
    const { app, calls } = await makeApp(['scrollback\n❯ stuck words\n']);   // every capture identical
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'stuck words' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'enter-ignored' });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter']]);
    await app.close();
  }, 10_000);

  // Review Important 2: a blank marker row with real text one row down (the
  // shape sendPrompt's own M-Enter leaves for a message beginning with a
  // blank line) must not be reported as 409 nothing-to-submit — that's a
  // false claim. Proves the new token reaches the HTTP layer, not just the
  // unit under it.
  it('refuses a blank first row hiding real content below with 409 blank-first-row, and presses nothing', async () => {
    const { app, calls } = await makeApp(['❯ \n  actual text\n']);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'actual text' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'blank-first-row' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  // PR F whole-branch review, Critical — the HTTP half of the correspondence
  // gate. The box holds a message the caller was never shown (a second send
  // replaced it, or a second enter-ignored left its own), so Enter here would
  // submit someone else's text under this caller's name.
  it('refuses a box holding something else with 409 box-mismatch, and presses nothing', async () => {
    const { app, calls } = await makeApp(['scrollback\n❯ check the logs\n']);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/submit`, payload: { expect: 'run the tests' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'box-mismatch' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  // A caller that states nothing gates on nothing. 400 BEFORE any capture, so
  // an old client cannot fall back to the un-gated behaviour by omission.
  it('refuses a request with no expectation at all — 400, and presses nothing', async () => {
    const { app, calls } = await makeApp(['scrollback\n❯ half-typed\n', EMPTY_BOX]);
    for (const payload of [{}, { expect: '   ' }, { expect: 7 }]) {
      const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });
});

// Task 2 review, Important 3: the route and its `readAsk` closure
// (registry lookup + `readHookState`) had zero tests — every gate inside
// `answerAsk` was pinned in isolation (ask-route.test.ts) but nothing proved
// `server.ts` actually wires them together: the registry lookup for the
// session's uuid, `readHookState`'s freshness/identity gate, and the
// askDeps/sendDeps shared queue. Same convention as the `/dialog` suite
// above: 404 covered there, so this adds 400 / 409 / 200.
describe('POST /api/sessions/:id/ask', () => {
  const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
  const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';

  /** Seeds the registry (uuid `'1'.repeat(36)`, matching `seedSession`) plus a
   *  fresh, waiting hookstate file carrying `QUESTION` — the wiring `readAsk`
   *  needs end to end, not stubbed. */
  const seedAsk = (home: string, over: Record<string, unknown> = {}): void => {
    const reg = path.join(home, '.cc-sessions');
    writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'Notification', sessionId: '1'.repeat(36), pid: 4242,
      updatedAt: Date.now(), ask: { questions: [QUESTION] }, subagents: [],
      ...over,
    }));
  };

  it('happy path presses the single digit and returns 200', async () => {
    const { app, calls, home } = await makeApp([ASK_PANE]);
    seedAsk(home);
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/ask`,
      payload: { askKey: askKey({ questions: [QUESTION] }), optionIndexes: [1] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // Single-select: the digit alone, no Enter — see ask.ts's own comment.
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, '2']]);
    await app.close();
  });

  it('a stale/mismatched askKey returns 409 ask-mismatch and presses nothing', async () => {
    const { app, calls, home } = await makeApp([ASK_PANE]);
    seedAsk(home);
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${ID}/ask`,
      payload: { askKey: 'deadbeefdeadbeef', optionIndexes: [0] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'ask-mismatch' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  it('a malformed body is rejected 400 before touching the session', async () => {
    const { app, calls, home } = await makeApp([ASK_PANE]);
    seedAsk(home);
    for (const payload of [
      { optionIndexes: [0] },                          // askKey missing
      { askKey: 123, optionIndexes: [0] },              // askKey not a string
      { askKey: 'k', optionIndexes: 'nope' },           // optionIndexes not an array
      { askKey: 'k', optionIndexes: [0, '1'] },         // one entry not a number
      { askKey: 'k' },                                  // optionIndexes missing
    ]) {
      const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/ask`, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });
});

describe('prompt route attachment handling', () => {
  it('rejects an attachment outside this session’s clips dir', async () => {
    const { app, home } = await makeApp([EMPTY_BOX]);
    for (const bad of [
      '/etc/passwd',
      '/home/u/.cc-clips/other-session/clip-20260726-150340-a1b2.png',
      `${home}/.cc-clips/${ID}/../../x/clip-20260726-150340-a1b2.png`,
    ]) {
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${ID}/prompt`,
        payload: { text: 'hi', attachments: [bad] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('bad-attachment');
    }
    await app.close();
  });

  it('rejects a fifth attachment', async () => {
    const { app, home } = await makeApp([EMPTY_BOX]);
    const many = Array.from({ length: 5 }, (_, i) =>
      `${home}/.cc-clips/${ID}/clip-20260726-15034${i}-a1b2.png`);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'hi', attachments: many },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-attachment');
    await app.close();
  });

  // `home` is a fresh mkdtemp dir created inside makeApp, so the clip path (which
  // must resolve under it) can only be built from the `home` the callback receives.
  const clipOf = (home: string) => `${home}/.cc-clips/${ID}/clip-20260726-150340-a1b2.png`;

  it('accepts a staged attachment alongside text, typed as one turn', async () => {
    const { app, calls, home } = await makeApp((home) => [
      'scrollback\n❯ \n',
      `scrollback\n❯ ${clipOf(home)}\n`,
      'scrollback\n❯ \n',
    ]);
    const clip = clipOf(home);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`,
      payload: { text: 'what is this', attachments: [clip] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', clip],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'M-Enter'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', 'what is this'],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('accepts an image-only prompt (no text) when an attachment is present', async () => {
    const { app, calls, home } = await makeApp((home) => [
      'scrollback\n❯ \n',
      `scrollback\n❯ ${clipOf(home)}\n`,
      'scrollback\n❯ \n',
    ]);
    const clip = clipOf(home);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`,
      payload: { text: '', attachments: [clip] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([
      ['tmux', 'send-keys', '-t', `cc-${ID}`, '-l', clip],
      ['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter'],
    ]);
    await app.close();
  });

  it('still rejects an empty prompt with no attachments', async () => {
    const { app } = await makeApp([EMPTY_BOX]);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-request');
    await app.close();
  });
});

describe('upload route id handling', () => {
  const png = (name = 'shot.png') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(8)], { type: 'image/png' }), name);
    return form;
  };

  it('stages a picked image and returns where it landed', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/upload`, payload: png(),
    });
    expect(res.statusCode).toBe(200);
    const clip = res.json().clip as { path: string; name: string; bytes: number };
    expect(clip.name).toMatch(/^clip-\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
    expect(clip.path).toContain(`/.cc-clips/${ID}/`);
  });

  // A bare '..' is deliberately absent: the router normalises
  // `/api/sessions/../upload` to `/api/upload`, so it never reaches this route
  // and the assertion below was only ever answered by the SPA fallback's 404 —
  // which exists only when dist-pwa has been built, making the suite pass or
  // fail on a build artefact. `clip.test.ts` covers '..' at the unit level,
  // where it is actually the property under test.
  it('refuses a traversing session id before touching the filesystem', async () => {
    const { app } = await makeApp([null]);
    for (const bad of ['..%2F..%2F.ssh', '%2Fetc']) {
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${bad}/upload`, payload: png(),
      });
      expect([400, 404]).toContain(res.statusCode);
      expect(res.json().ok).toBe(false);
    }
  });

  it('404s an unknown but well-formed session', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/claude2-NoSuchProject/upload', payload: png(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('unknown-session');
  });
});

describe('clip route', () => {
  // Non-repeating, non-zero bytes (including 0x80/0xff, invalid UTF-8 lead/continuation
  // bytes) so a `send()` that ever touched the buffer as a string would corrupt it.
  const CLIP_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 128, 253, 254, 255]);
  const pngForm = (name = 'shot.png') => {
    const form = new FormData();
    form.append('file', new Blob([CLIP_BYTES], { type: 'image/png' }), name);
    return form;
  };

  it('serves a staged clip with an immutable cache header, bytes intact on the wire', async () => {
    const { app } = await makeApp([null]);
    const up = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/upload`, payload: pngForm(),
    });
    const { name } = up.json().clip as { name: string };
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/clip/${name}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    // The proof that matters: what actually crossed the wire, byte-for-byte —
    // not just a 200 with a plausible length.
    expect(Buffer.compare(res.rawPayload, CLIP_BYTES)).toBe(0);
  });

  it('refuses a name that is not a clip, and a traversing one', async () => {
    const { app } = await makeApp([null]);
    for (const bad of ['..%2F..%2F.ssh%2Fid_rsa', 'notaclip.png', 'clip-x.exe']) {
      const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/clip/${bad}` });
      expect(res.statusCode).toBe(400);
    }
  });

  it('404s a clip that is not on disk', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'GET', url: `/api/sessions/${ID}/clip/clip-20260726-150340-a1b2.png`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s a well-formed clip name under an unknown session', async () => {
    const { app } = await makeApp([null]);
    const res = await app.inject({
      method: 'GET', url: '/api/sessions/claude2-NoSuchProject/clip/clip-20260726-150340-a1b2.png',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('unknown-session');
  });
});

describe('notify ingestion', () => {
  it('POST /api/notify with a swap message emits notice and the session event', async () => {
    const { app, bus } = await makeApp(['❯ \n']);
    const notices: string[] = [];
    const sessionMsgs: SessionStreamMsg[] = [];
    bus.on('notice', (n) => notices.push(n.message));
    bus.on(`session:${ID}`, (m) => sessionMsgs.push(m));
    const message = `cc swap: ${ID} moved claude2 -> claude (limits) — reopen it on claude.ai under the claude account`;
    const res = await app.inject({ method: 'POST', url: '/api/notify', payload: { message } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(notices).toEqual([message]);
    expect(sessionMsgs).toEqual([{ type: 'notice', message }]);
    await app.close();
  });

  it('POST /api/notify with a non-swap message emits only notice', async () => {
    const { app, bus } = await makeApp(['❯ \n']);
    const notices: string[] = [];
    const sessionMsgs: SessionStreamMsg[] = [];
    bus.on('notice', (n) => notices.push(n.message));
    bus.on(`session:${ID}`, (m) => sessionMsgs.push(m));
    const message = 'deploy finished on server-box';
    const res = await app.inject({ method: 'POST', url: '/api/notify', payload: { message } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(notices).toEqual([message]);
    expect(sessionMsgs).toEqual([]);
    await app.close();
  });
});

// POST /api/sessions/:id/hold and /release — same shape as /archive/restore
// (pr-routes.test.ts): verbSupported-gated, 404/400/501/200.
//
// The 200 case runs through `helpers.ts`'s `testDeps`, i.e. through
// `guardRunner` — LAYER 1 of the three against "route added, whitelist not
// updated, all suites green, dead on the fleet" (`whitelist-subset.test.ts`'s
// header). An earlier draft built its deps by hand here precisely to escape
// that guard, because neither verb was granted yet; that made this the one
// route test whose argv the guard never saw (review finding 1). The grants
// landed, so the ordinary harness works and covers both new argvs for free.
// Registry ladder (architecture doc, increment 1's second half): REFUSE, not
// degrade — `stopPair` below RECOMPUTES a wrapper/project pair from these
// very fields to kill a tmux session BY NAME, so an unmeasured field must
// never silently fall through to a guessed value. Had NO pin before this
// (`registry.ts:123`'s old drop behaviour had never been exercised through
// this route at all — no test here even named `/stop` until now). Written
// FIRST and confirmed red against the pre-gate code, which would have
// answered 404 unknown-session (a LIE: the row is right there, just
// unmeasured) rather than 503.
describe('POST /api/sessions/:id/stop', () => {
  it('refuses 503 registry-unmeasurable, NOT 404 unknown-session, when the row is listed but its ' +
     'identity could not be measured', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: unreadableField(ID, 'wrapper'), queue: new KeyedQueue() },
      new Bus(),
    );
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    await app.close();
  });

  it('still refuses 404 unknown-session for a session PROVEN absent from the registry', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    // Fix (blocking review finding 3, test-fixture half): the registry
    // DIRECTORY must actually exist and be listable — a real fleet host
    // always has one once `ccd` has ever run — or this fixture proves
    // `reason: 'unlistable'`, not `reason: 'absent'`, and would pass by
    // accident against the pre-fix code that answered 404 for both. With
    // the directory present but no `<ID>.uuid` file in it, the listing
    // genuinely names this id absent.
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() }, new Bus(),
    );
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-session' });
    await app.close();
  });

  // Blocking review finding 3: the whole-fleet cousin of the field-degraded
  // case above must get the SAME 503, never the 404 this route exists to
  // avoid for exactly this reason — an unlistable registry proves nothing
  // about whether THIS id exists, the identical fact `readSessionRecord`'s
  // own `reason: 'unlistable'` already distinguishes from `reason: 'absent'`.
  // Written FIRST and confirmed red against the pre-fix code, which
  // collapsed both reasons into one bare `!read.found` check and answered
  // 404 unknown-session for a registry it could not even list.
  it('refuses 503 registry-unmeasurable, NOT 404 unknown-session, when the whole registry directory ' +
     'cannot be listed at all', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: unlistable, queue: new KeyedQueue() },
      new Bus(),
    );
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    await app.close();
  });

  it('stops normally (200) when the row is fully measured', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() }, new Bus(),
    );
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/stop` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('POST /api/sessions/:id/hold and /release', () => {
  it('404s an unknown session on both routes, before building any argv', async () => {
    const { app, calls } = await makeApp(['❯ \n']);
    for (const url of ['/api/sessions/nope-nothing/hold', '/api/sessions/nope-nothing/release']) {
      const res = await app.inject({ method: 'POST', url, payload: { reason: 'w' } });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    }
    expect(calls.filter((c) => c[1] === 'ws-hold' || c[1] === 'ws-release')).toEqual([]);
    await app.close();
  });

  it('400s a missing, empty or non-string reason on /hold, without shelling out', async () => {
    const { app, calls } = await makeApp(['❯ \n']);
    for (const payload of [{}, { reason: '' }, { reason: '   ' }, { reason: 5 }]) {
      const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/hold`, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(calls.filter((c) => c[1] === 'ws-hold')).toEqual([]);
    await app.close();
  });

  it('501s when the deployed ccd has neither verb, and shells out to nothing', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    const deps = { ...testDeps(home, run), fleetState: { connected: true, downSince: null, ccdVerbs: ['start'], rosterFp: null, build: null } };
    const app = await buildServer(deps);
    const resHold = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/hold`, payload: { reason: 'w' } });
    expect(resHold.statusCode).toBe(501);
    expect(resHold.json()).toEqual({ ok: false, error: 'unsupported' });
    const resRelease = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/release` });
    expect(resRelease.statusCode).toBe(501);
    expect(resRelease.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls.filter((c) => c[1] === 'ws-hold' || c[1] === 'ws-release')).toEqual([]);
    await app.close();
  });

  it('200s and runs ccd ws-hold/ws-release --session, the reason passed through verbatim', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude2');
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'ws-hold') return { code: 0, stdout: `held ${ID}`, stderr: '' };
      if (args[0] === 'ws-release') return { code: 0, stdout: `released ${ID}`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const app = await buildServer(testDeps(home, run));

    const resHold = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/hold`,
      payload: { reason: 'program:agent-evals wave:1/4' } });
    expect(resHold.statusCode).toBe(200);
    expect(resHold.json()).toEqual({ ok: true });
    expect(calls.find((c) => c[1] === 'ws-hold')?.slice(1))
      .toEqual(['ws-hold', '--session', ID, '--reason', 'program:agent-evals wave:1/4']);

    const resRelease = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/release` });
    expect(resRelease.statusCode).toBe(200);
    expect(resRelease.json()).toEqual({ ok: true });
    expect(calls.find((c) => c[1] === 'ws-release')?.slice(1)).toEqual(['ws-release', '--session', ID]);
    await app.close();
  });
});

describe('layer 1 — the guard runner', () => {
  // `async` + `await`, and both are load-bearing: `expect(promise).rejects`
  // returns a promise, so a synchronous callback that neither awaits nor
  // returns it passes no matter what `guardRunner` does — and this is the ONLY
  // behavioural test of layer 1. Prove it can fail before moving on: make
  // `guardRunner` return `inner(cmd, args)` unconditionally and watch this go
  // red.
  it('rejects an argv the agent whitelist would refuse, from any route', async () => {
    // Free on every existing route test: testDeps wraps its runner, so a route
    // that starts emitting a non-whitelisted argv fails HERE rather than on
    // the fleet.
    const inner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    await expect(guardRunner(inner)('/home/u/.local/bin/ccd', ['ws-rm', 'x']))
      .rejects.toThrow(/argv not in the agent EXEC_WHITELIST: ccd ws-rm x/);
  });

  it('lets a whitelisted argv through untouched — the guard is not a blanket refusal', async () => {
    // Without this, "rejects everything" would satisfy the test above.
    const inner: Runner = async () => ({ code: 0, stdout: 'ok', stderr: '' });
    await expect(guardRunner(inner)('/home/u/.local/bin/ccd', ['ensure', 'demo-quiet-basin']))
      .resolves.toEqual({ code: 0, stdout: 'ok', stderr: '' });
  });

  // MUTATION-SWEEP FINDING (Task 11): replacing `ccdRunner(guarded, cfg)` with
  // `ccdRunner(run, cfg)` in `testDeps` leaves the whole suite green — no
  // EXISTING route happens to emit a non-whitelisted argv today, so the two
  // tests above (which call `guardRunner` directly) never exercise `testDeps`'s
  // own wiring, only the function in isolation. This pins the wiring itself,
  // independent of whether any current route misbehaves — the claim in the
  // comment above testDeps ("free on every existing route test") is only true
  // if this holds. Task 13S moved the observation point from `deps.run` (gone:
  // there is no raw runner on Deps any more) to `deps.runCcd`; it observes the
  // same composition, one link further down the same chain.
  it('testDeps wires the guard onto deps.runCcd, not just reachable via a direct guardRunner call', async () => {
    const deps = testDeps(undefined, async () => ({ code: 0, stdout: '', stderr: '' }));
    // The cast is deliberate and is the point: since task 13S no route CAN
    // build this argv — that half is the brand, pinned in
    // ccdargv-brand.test.ts. This half is that a whitelist check still stands
    // between whatever argv does arrive and the process.
    await expect(deps.runCcd(['ws-rm', 'x'] as unknown as CcdArgv))
      .rejects.toThrow(/argv not in the agent EXEC_WHITELIST/);
  });

  // MUTATION-SWEEP FINDING (Task 11): replacing `new Tmux(guarded)` with
  // `new Tmux(run)` in testDeps ALSO left the whole suite green — Tmux's own
  // public methods only ever build already-whitelisted tmux verbs
  // (has-session, list-panes, capture-pane, send-keys, resize-window), so no
  // call through Tmux's public API can ever observe whether its runner is
  // guarded. Reach the constructor-injected runner directly — a real instance
  // property at runtime, since TypeScript `private` is compile-time-only —
  // and drive it with a verb none of Tmux's own methods build, to prove the
  // guard is actually load-bearing on this path rather than one refactor away
  // from being deleted as dead code.
  it('testDeps wires the guard onto deps.tmux as well, not just onto deps.runCcd', async () => {
    const deps = testDeps(undefined, async () => ({ code: 0, stdout: '', stderr: '' }));
    const tmuxRunner = (deps.tmux as unknown as { run: Runner }).run;
    await expect(tmuxRunner('tmux', ['kill-session', '-t', 'cc-x']))
      .rejects.toThrow(/argv not in the agent EXEC_WHITELIST/);
  });
});

describe('one queue for the process', () => {
  it('Deps carries the queue, and submissions under one key run in order', async () => {
    const deps = testDeps();
    const seen: string[] = [];
    await Promise.all([
      deps.queue.run('demo-quiet-mesa', async () => { seen.push('a'); }),
      deps.queue.run('demo-quiet-mesa', async () => { seen.push('b'); }),
    ]);
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('POST /api/sessions/:id/archive — and an open run', () => {
  const withCoord = async (home: string, run: Runner, sessionId: string) => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build4', title: 'T', project: 'demo', wave: 2, waveOf: 3,
      claimedBy: 'ccrc-pwa-coordinator' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, sessionId);
    const app = await buildServer({ ...testDeps(home, run), coord });
    return { app, coord, runId: opened.id };
  };

  /** `seedSession` in this file takes (home, id, wrapper) and returns NOTHING —
   *  it seeds into a home the caller already made. And there is no `recording`
   *  helper: the file's runner doubles are built inline. Both are written out
   *  here rather than assumed. */
  const seededHome = (id: string): string => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, id, 'claude2');
    return home;
  };
  const recording = (calls: string[][]): Runner => async (_cmd, args) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };

  it('refuses 409 run-open, NAMING the run ids — never a bare slug', async () => {
    const home = seededHome('demo-claimed');
    const calls: string[][] = [];
    const { app, runId } = await withCoord(home, recording(calls), 'demo-claimed');
    const res = await app.inject({ method: 'POST', url: '/api/sessions/demo-claimed/archive' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      ok: false, error: 'run-open',
      runs: [{ id: runId, program: 'build4', wave: 2, waveOf: 3 }],
    });
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    await app.close();
  });

  it("proceeds on {force:true} — the operator's own hands stay able to do it", async () => {
    const home = seededHome('demo-claimed');
    const calls: string[][] = [];
    const { app } = await withCoord(home, recording(calls), 'demo-claimed');
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/demo-claimed/archive', payload: { force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-claimed']);
    await app.close();
  });

  it('is unchanged when no run names the session, and when the server has no coord at all', async () => {
    // The `?.` path: `testDeps` supplies no `coord`, which is every other
    // test in this file. An archive must not become impossible on a server
    // with coordination switched off.
    const home = seededHome('demo-free');
    const calls: string[][] = [];
    const app = await buildServer(testDeps(home, recording(calls)));
    const res = await app.inject({ method: 'POST', url: '/api/sessions/demo-free/archive' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-free']);
    await app.close();
  });
});
