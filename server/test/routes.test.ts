import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import type { CcdArgv } from '../src/ccdargv.js';
import { parseDialog } from '../src/pane/dialog.js';
import { Bus } from '../src/bus.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { guardRunner, testDeps } from './helpers.js';
import { askKey } from '../src/askkey.js';

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
  const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO }, bus);
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
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${ID}`, 'Enter']]);
    await app.close();
  });

  it('refuses an empty box with 409 nothing-to-submit, and presses nothing', async () => {
    const { app, calls } = await makeApp([EMPTY_BOX]);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(sendKeysCalls(calls)).toEqual([]);
    await app.close();
  });

  it('refuses while a menu owns the keyboard with 409 dialog-open, and presses nothing', async () => {
    const { app, calls } = await makeApp([menuPane(1)]);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/submit`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'dialog-open' });
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
