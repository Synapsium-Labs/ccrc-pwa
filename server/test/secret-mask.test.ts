// D-5513 (accounts-connect spec 2026-10-18 §3.3, plan Task A10; G31): credential shapes and fingerprinted lane secrets
// are masked to `‹secret masked›` before EVERY server egress of session-derived text: the transcript, ask and drawer
// websockets (both drawer arms), pane history, the feed, run items, the mail answers, the notification catch-up and
// every web-push payload.
//
// Every credential here is ASSEMBLED at run time from neutral filler, so no file in the tree holds a whole shape.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';

const sent = vi.hoisted(() => [] as string[]);
vi.mock('web-push', () => {
  class WebPushError extends Error { statusCode = 0; }
  return {
    default: { setVapidDetails: () => {}, sendNotification: async (_s: unknown, body: string) => { sent.push(body); } },
    WebPushError,
  };
});

import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { SessionStream } from '../src/sessionws.js';
import { createSpawnPty } from '../src/remote/pty.js';
import type { FleetClient } from '../src/remote/client.js';
import type { PtyLike } from '../src/pty.js';
import { PushService } from '../src/push.js';
import { askPushBody } from '../src/askbody.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  SecretMasker, DrawerMask, fingerprintOf, fingerprintGeneration, fingerprintRow, shapeMatchers, RUNS_PER_CHUNK, MAX_CHUNKS,
} from '../src/accounts/mask.js';
import { approvalsFixture, CHILD, PARENT } from './approvalsHarness.js';
import { saveSnapshot } from '../src/fleetstate.js';
import type { FleetSession } from '../../shared/api.js';
import { CREDENTIAL_MASKS, SECRET_MASK, SECRET_MASK_TOO_LARGE, type SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

// ── assembled credentials ──────────────────────────────────────────────────
const fill = (n: number, salt: string, alphabet = 'base64url'): string => {
  let s = '';
  for (let i = 0; s.length < n; i++) {
    s += createHash('sha256').update(`${salt}:${i}`).digest(alphabet === 'hex' ? 'hex' : 'base64url');
  }
  return s.slice(0, n);
};
const SK = 'sk';
const OAT = [SK, 'ant', 'oat01', fill(95, 'oat')].join('-');
const ORT = [SK, 'ant', 'ort01', fill(95, 'ort')].join('-');
const API = [SK, 'ant', 'api03', fill(95, 'api')].join('-');
const ORKEY = [SK, 'or', 'v1', fill(64, 'or', 'hex')].join('-');
const JWT = ['eyJ' + fill(30, 'h'), 'eyJ' + fill(60, 'p'), fill(43, 's')].join('.');
const OPAQUE_REFRESH = `rt_${fill(40, 'rt', 'hex')}`;
/** A `compatible` key: no shape at all, dashes inside. */
const CMP = `cmp-${fill(20, 'c1', 'hex')}-${fill(20, 'c2', 'hex')}`;
const CMP_OTHER = `cmp-${fill(20, 'x1', 'hex')}-${fill(20, 'x2', 'hex')}`;
const TOKEN_1 = 'a1'.repeat(32);
const TOKEN_2 = 'b2'.repeat(32);

/** What a terminal shows for a drawer stream: printable text, CR, LF, and the two moves the provisional mask's erase
 *  uses (CUB `ESC[nD`, ECH `ESC[nX`); every other escape draws nothing. Rows joined by `\n`, trailing blanks cut. */
const screen = (stream: string): string => {
  const rows: string[][] = [[]];
  let row = 0; let col = 0;
  for (let i = 0; i < stream.length;) {
    const esc = /^\x1b(?:\[([0-9;]*)([@-~])|[^[])/.exec(stream.slice(i, i + 32));
    if (esc !== null) {
      const n = Number(esc[1] || '1');
      if (esc[2] === 'D') col = Math.max(0, col - n);
      if (esc[2] === 'X') for (let k = 0; k < n; k++) rows[row]![col + k] = ' ';
      i += esc[0].length; continue;
    }
    const c = stream[i++]!;
    if (c === '\r') { col = 0; continue; }
    if (c === '\n') { row++; rows[row] ??= []; continue; }
    rows[row]![col++] = c;
  }
  return rows.map((r) => Array.from(r, (c) => c ?? ' ').join('').trimEnd()).join('\n').replace(/\n+$/, '');
};

/** No 8-character slice of `secret` appears in `text`. */
const leaksNone = (text: string, secret: string): boolean => {
  for (let i = 0; i + 8 <= secret.length; i++) if (text.includes(secret.slice(i, i + 8))) return false;
  return true;
};

/** A masker over a fresh coord.db holding `CMP`'s fingerprint under `token`. */
const maskerWith = (opts: { token?: () => string | null; requestRekey?: () => void; secrets?: string[] } = {}) => {
  const db = openCoordDb(path.join(mkTmp('ccrc-mask-'), 'coord.db'));
  const token = opts.token ?? (() => TOKEN_1);
  const m = new SecretMasker({ db, token, requestRekey: opts.requestRekey });
  m.ingest({ gen: fingerprintGeneration(token()!), rows: (opts.secrets ?? [CMP]).map((s, i) => fingerprintRow(token()!, `lane${i}`, s)) });
  return { m, db };
};

// ── the session socket ─────────────────────────────────────────────────────
const ID = 'claude-a-demo';
const UUID_A = 'a'.repeat(36);
const WORKDIR = '/data/projects/demo';
const MUNGED = '-data-projects-demo';
const PID = 40613;
const userLine = (uuid: string, text: string): string => JSON.stringify({
  uuid, parentUuid: null, isSidechain: false, timestamp: '2026-07-20T21:00:00.000Z', type: 'user',
  message: { role: 'user', content: text },
}) + '\n';
const seedSession = (home: string, transcript: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: 'demo', workdir: WORKDIR, uuid: UUID_A, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const sess = path.join(home, '.claude-a', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'demo-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
  }));
  const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), transcript);
};

const listen = async (app: FastifyInstance): Promise<number> => {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const a = app.server.address();
  return typeof a === 'object' && a !== null ? a.port : 0;
};

/** The raw text of the backlog frame a fresh session socket sends. */
const backlogFrame = async (transcript: string, masker?: SecretMasker): Promise<string> => {
  const home = mkTmp('ccrc-mask-sws-');
  seedRoster(home);
  seedSession(home, transcript);
  const run: Runner = async (_c, args) => (args[0] === 'list-panes'
    ? { code: 0, stdout: `${PID}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' });
  const cfg = loadConfig({ CCRC_HOME: home });
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), masker };
  const app = await buildServer(deps, new Bus());
  try {
    const port = await listen(app);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const raw = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no backlog')), 5000);
      ws.on('message', (d) => {
        const s = String(d);
        if ((JSON.parse(s) as { type: string }).type === 'backlog') { clearTimeout(t); resolve(s); }
      });
      ws.on('error', reject);
    });
    ws.close();
    return raw;
  } finally {
    await app.close();
  }
};

describe('the session socket carries only the mask (D-5513)', () => {
  it('a transcript row holding an `env` dump with an assembled sk-ant-oat… and sk-or-v1-… reaches the session socket masked', async () => {
    const raw = await backlogFrame(userLine('u1', `HOME=/x\nANTHROPIC_AUTH_TOKEN=${OAT}\nOPENROUTER_API_KEY=${ORKEY}\nPATH=/bin`));
    expect(raw).toContain(SECRET_MASK);
    expect(leaksNone(raw, OAT)).toBe(true);
    expect(leaksNone(raw, ORKEY)).toBe(true);
    expect(raw).toContain('PATH=/bin');
  });

  it('a .credentials.json dump with an assembled sk-ant-ort01-… and a Codex auth.json with an assembled JWT reach the socket masked', async () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: OAT, refreshToken: ORT, expiresAt: 1 } });
    const auth = JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: JWT, access_token: JWT, refresh_token: OPAQUE_REFRESH } });
    const raw = await backlogFrame(userLine('u1', `${creds}\n${auth}`));
    for (const s of [OAT, ORT, JWT, OPAQUE_REFRESH]) expect(leaksNone(raw, s), s.slice(0, 12)).toBe(true);
  });

  it('a compatible key followed by \\n in a JSON-serialized transcript frame is masked', async () => {
    const { m } = maskerWith();
    const raw = await backlogFrame(userLine('u1', `export KEY=${CMP}\nnext`), m);
    expect(raw).toContain(`${SECRET_MASK}\\nnext`);
    expect(leaksNone(raw, CMP)).toBe(true);
  });

  it('the ask frame and the feed frame carry only the mask', async () => {
    const frames: SessionStreamMsg[] = [];
    const home = mkTmp('ccrc-mask-ask-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() };
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    const send = (stream as unknown as { send(m: SessionStreamMsg): void }).send;
    const ask = { type: 'ask', ask: { questions: [{ question: `use ${OAT}?`, header: 'Key', multiSelect: false, options: [{ label: ORKEY }] }] } };
    send(ask as unknown as SessionStreamMsg);
    const dialog = { type: 'dialog', dialog: { id: 'd1', title: `paste ${API}`, options: [{ index: 1, label: 'Yes' }], selectedIndex: 1, parsed: true, raw: API } };
    send(dialog as unknown as SessionStreamMsg);
    const out = JSON.stringify(frames);
    for (const s of [OAT, ORKEY, API]) expect(leaksNone(out, s)).toBe(true);
    expect(out).toContain(SECRET_MASK);
    // the input is never mutated: a caller may hold it
    expect(JSON.stringify(ask)).toContain(OAT);

    // The feed frame: `GET /api/feed` (the PWA's mail screen's durable read).
    const fhome = mkTmp('ccrc-mask-feed-');
    seedRoster(fhome);
    const coord = new CoordStore(openCoordDb(path.join(fhome, '.ccrc', 'coord.db')));
    coord.recordFeedEvent('e1', { seq: 1, at: 1, kind: 'mail', sessionId: ID, title: `key ${OAT}`, body: `or ${ORKEY}`, runId: null });
    const fcfg = loadConfig({ CCRC_HOME: fhome });
    const app = await buildServer({ cfg: fcfg, runCcd: ccdRunner(run, fcfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), coord }, new Bus());
    try {
      const res = await app.inject({ method: 'GET', url: '/api/feed' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(SECRET_MASK);
      for (const s of [OAT, ORKEY]) expect(leaksNone(res.body, s)).toBe(true);
    } finally { await app.close(); }
  });
});

// ── exact bytes ────────────────────────────────────────────────────────────
describe('a compatible key is masked by its exact bytes (D-5513)', () => {
  it('a compatible key with a fingerprint row is masked by exact bytes, and an unrelated string of the same length is not', () => {
    const { m } = maskerWith();
    expect(CMP_OTHER.length).toBe(CMP.length);
    const out = m.maskText(`a=${CMP} b=${CMP_OTHER} "${CMP}" ${CMP}==`);
    expect(out).toBe(`a=${SECRET_MASK} b=${CMP_OTHER} "${SECRET_MASK}" ${SECRET_MASK}==`);
  });

  it('a padded secret is matched through its =-padded forms', () => {
    const padded = `${fill(30, 'pad')}==`;
    const { m } = maskerWith({ secrets: [padded] });
    expect(m.maskText(`K=${padded}`)).toBe(`K=${SECRET_MASK}==`);
  });

  it('a compatible-key fingerprint planted at run 300 of one frame is masked', () => {
    const { m } = maskerWith();
    // D-5995: only a run of a held length is a candidate, so the fillers have CMP's length
    const runs = Array.from({ length: 299 }, (_, i) => `filler${String(i).padStart(CMP.length - 6, '0')}`);
    const out = m.maskText(`${runs.join(' ')} ${CMP} tail`);
    expect(RUNS_PER_CHUNK).toBe(256);
    expect(out.endsWith(`${SECRET_MASK} tail`)).toBe(true);
    expect(leaksNone(out, CMP)).toBe(true);
  });

  it('a frame past the hard ceiling ends in the too-large notice, and no byte after the ceiling reaches the socket', () => {
    const { m } = maskerWith();
    const ceiling = RUNS_PER_CHUNK * MAX_CHUNKS;
    const runs = Array.from({ length: ceiling + 10 }, (_, i) => `filler${String(i).padStart(CMP.length - 6, '0')}`);   // D-5995
    const out = m.maskText(`${runs.join(' ')} ${CMP} after`);
    expect(out.endsWith(SECRET_MASK_TOO_LARGE)).toBe(true);
    expect(out).toContain(runs[ceiling - 1]);
    expect(out).not.toContain(runs[ceiling]);
    expect(out).not.toContain('after');
    expect(leaksNone(out, CMP)).toBe(true);
  });

  it('a row is matched only under the token of its own generation', () => {
    const { db } = maskerWith();   // CMP under TOKEN_1's generation
    // A stray row filed under TOKEN_2's generation but keyed with TOKEN_1: no generation's own fingerprint.
    db.prepare('INSERT INTO secret_fingerprints (laneId, fp, gen, len, at) VALUES (?, ?, ?, ?, ?)')
      .run('stray', fingerprintOf(TOKEN_1, CMP_OTHER), fingerprintGeneration(TOKEN_2), CMP_OTHER.length, 1);
    let tok = TOKEN_1;
    const m = new SecretMasker({ db, token: () => tok });
    tok = TOKEN_2;   // a rotation: TOKEN_2 is current, TOKEN_1 is held as the previous generation
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);       // TOKEN_1 still matches its own generation's row
    expect(m.maskText(`k=${CMP_OTHER}`)).toBe(`k=${CMP_OTHER}`);   // and never another generation's
  });

  it('after a rotation, a compatible key is still masked before and after the re-key, and old-generation rows are dropped once the new ones land; the roster sub is requested', () => {
    let tok = TOKEN_1;
    const rekeys: number[] = [];
    const { m, db } = maskerWith({ token: () => tok, requestRekey: () => rekeys.push(1) });
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    tok = TOKEN_2;   // the box token rotates
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);   // before the re-key: the previous generation still matches
    expect(rekeys).toHaveLength(1);
    m.ingest({ gen: fingerprintGeneration(TOKEN_2), rows: [fingerprintRow(TOKEN_2, 'lane0', CMP)] });   // the re-keyed rows land
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    const gens = (db.prepare('SELECT DISTINCT gen FROM secret_fingerprints').all() as { gen: string }[]).map((r) => r.gen);
    expect(gens).toEqual([fingerprintGeneration(TOKEN_2)]);
    // and a process booting over rows of a generation it holds no token for asks for the re-key at once
    db.prepare('INSERT INTO secret_fingerprints (laneId, fp, gen, len, at) VALUES (?, ?, ?, ?, ?)').run('old', 'f'.repeat(64), 'oldgen', 45, 1);
    const booted: number[] = [];
    new SecretMasker({ db, token: () => TOKEN_2, requestRekey: () => { booted.push(1); } });
    expect(booted).toHaveLength(1);
  });
});

// ── shapes ─────────────────────────────────────────────────────────────────
describe('the credential shapes (D-5513)', () => {
  it('each family is its own entry: with the generic sk- rule removed, every family is still masked', () => {
    const specific = CREDENTIAL_MASKS.filter((x) => x.id !== 'genericSk');
    const res = shapeMatchers(specific);
    for (const s of [OAT, ORT, API, ORKEY, JWT, [SK, fill(48, 'gw', 'hex')].join('-')]) {
      expect(res.some((re) => { re.lastIndex = 0; return re.test(` ${s} `); }), s.slice(0, 12)).toBe(true);
    }
    // and the Codex auth.json token fields by name
    const field = res.find((re) => re.source.includes('refresh_token'))!;
    field.lastIndex = 0;
    expect(field.test(`{"refresh_token": "${OPAQUE_REFRESH}"}`)).toBe(true);
  });

  it('a key between SGR sequences is masked', () => {
    const m = new SecretMasker();
    for (const text of [`\x1b[1m${OAT}\x1b[0m`, `X=\x1b[2m${OAT.slice(0, 30)}\x1b[22m${OAT.slice(30)}\r\n`, `word\x1b[33m${ORKEY}`]) {
      const out = m.maskText(text, { rows: true });
      expect(out).toContain(SECRET_MASK);
      expect(leaksNone(out, OAT) && leaksNone(out, ORKEY)).toBe(true);
    }
  });

  it('a key wrapped by the TUI across two drawer rows at 80 columns leaves no byte of it', () => {
    const m = new SecretMasker();
    const head = '  ⎿  ANTHROPIC_API_KEY=';
    const first = API.slice(0, 80 - head.length);
    const text = `${head}${first}\r\n     ${API.slice(first.length)}\r\n  next row\r\n`;
    const out = m.maskText(text, { rows: true });
    expect(leaksNone(out, API)).toBe(true);
    expect(out).toContain('next row');
  });
});

// ── the drawer ─────────────────────────────────────────────────────────────
describe('the drawer stream (D-5513)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a key split across two drawer chunks is masked, and the drawer is not delayed by more than 50 ms when no run is open', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const d = new DrawerMask(new SecretMasker(), (t) => out.push(t), 50);
    d.push(`token: ${OAT.slice(0, 20)}`);
    d.push(`${OAT.slice(20)}\r\n`);
    expect(out.join('')).toBe(`token: ${SECRET_MASK}\r\n`);
    out.length = 0;
    d.push('plain line\r\n');                    // ends on a delimiter: sent at once
    expect(out).toEqual(['plain line\r\n']);
    out.length = 0;
    d.push('prompt> ');
    expect(out).toEqual(['prompt> ']);
    d.push('sk-pa');                             // an open run that could start a shape is held, at most 50 ms (D-5995)
    expect(out).toEqual(['prompt> ']);
    vi.advanceTimersByTime(50);
    expect(out).toEqual(['prompt> ', SECRET_MASK]);   // the expired hold draws a provisional mask (D-5995)
    d.push('ss x');                               // the run ends as no shape: the mask is erased and the text drawn
    expect(screen(out.join(''))).toBe('prompt> sk-pass x');
    d.dispose();
  });

  it('a wrapped key whose second row arrives in the next chunk leaves no byte of it', () => {
    const out: string[] = [];
    const d = new DrawerMask(new SecretMasker(), (t) => out.push(t), 50);
    d.push(`KEY=${API.slice(0, 60)}\r\n`);
    d.push(`     ${API.slice(60)}\r\n`);
    expect(leaksNone(out.join(''), API)).toBe(true);
    d.dispose();
  });

  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const drawerFrames = async (spawnPty: Deps['spawnPty'], until: (s: string) => boolean): Promise<string> => {
    const home = mkTmp('ccrc-mask-pty-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), spawnPty }, new Bus());
    const port = await listen(app);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty/${ID}?cols=80&rows=24`);
    const frames: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`drawer frames: ${JSON.stringify(frames)}`)), 5000);
      ws.on('message', (dd) => { frames.push(String(dd)); if (until(frames.join(''))) { clearTimeout(t); resolve(); } });
      ws.on('error', reject);
    });
    ws.close();
    return frames.join('');
  };

  it('a key in drawer output reaches the socket masked in remote mode (through createSpawnPty with a stub agent client) and in local mode (a stub SpawnPty)', async () => {
    const chunks = [`env\r\nANTHROPIC_API_KEY=${OAT.slice(0, 40)}`, `${OAT.slice(40)}\r\nDONE\r\n`];
    // local arm
    class StubPty implements PtyLike {
      onData(l: (d: string) => void) { queueMicrotask(() => { for (const c of chunks) l(c); }); return { dispose: () => {} }; }
      write(): void {} resize(): void {} kill(): void {}
    }
    const local = await drawerFrames(() => new StubPty(), (s) => s.includes('DONE'));
    expect(local).toContain(SECRET_MASK);
    expect(leaksNone(local, OAT)).toBe(true);
    await app!.close(); app = undefined;

    // remote arm: the real `createSpawnPty` over a stub agent client
    let listener: ((m: { t: 'pty'; ptyId: number; ev: 'data'; dataB64: string }) => void) | null = null;
    const client = {
      request: async () => ({ ptyId: 7 }),
      onPty: (_id: number, l: typeof listener) => { listener = l; queueMicrotask(() => {
        for (const c of chunks) listener!({ t: 'pty', ptyId: 7, ev: 'data', dataB64: Buffer.from(c).toString('base64') });
      }); },
      sendPty: () => {},
      offPty: () => {},
    } as unknown as FleetClient;
    const remote = await drawerFrames(createSpawnPty(client), (s) => s.includes('DONE'));
    expect(remote).toContain(SECRET_MASK);
    expect(leaksNone(remote, OAT)).toBe(true);
  });
});

// ── the other egresses ─────────────────────────────────────────────────────
describe('every other egress of session-derived text (D-5513)', () => {
  const TOKEN = 'f'.repeat(64);
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a planted sk-ant-oat…/sk-or-v1-… in a pane, a feed event, a run item, a mail body and an ask dialog is masked in the pane-history answer, the feed answer, the items answer, the mail answer and the push payload', async () => {
    const home = mkTmp('ccrc-mask-egress-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const run: Runner = async (_c, args) => {
      if (args[0] === 'capture-pane') return { code: 0, stdout: `$ env\nKEY=${OAT}\nOR=${ORKEY}\n`, stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '1 10 2000 220 50 0\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify-log.json'));
    await notifyLog.load();
    app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      coord, mailToken: TOKEN, notifyLog }, new Bus());
    const H = { 'x-ccrc-mail-token': TOKEN };
    const clean = (body: string): void => {
      expect(body).toContain(SECRET_MASK);
      expect(leaksNone(body, OAT) && leaksNone(body, ORKEY), body.slice(0, 200)).toBe(true);
    };

    // pane history
    clean((await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` })).body);

    // the feed
    coord.recordFeedEvent('e1', { seq: 1, at: 1, kind: 'ask', sessionId: ID, title: OAT, body: ORKEY, runId: null });
    clean((await app.inject({ method: 'GET', url: '/api/feed' })).body);

    // run items
    const r = coord.openRun({ program: 'p', title: 'T', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'coordinator' }) as { id: number };
    coord.addWorkItem(r.id, `rotate ${OAT} and ${ORKEY}`, []);
    clean((await app.inject({ method: 'GET', url: `/api/runs/${r.id}/items`, headers: H })).body);

    // mail
    const mail = coord.insertMail({ fromId: ID, fromUuid: UUID_A, toId: 'claude-a-other', runId: null, kind: 'status',
      subject: `key ${OAT}`, body: `or ${ORKEY}`, artifacts: [] });
    coord.queueDelivery(mail.id, 'claude-a-other', JSON.stringify({ subject: `key ${OAT}`, body: `or ${ORKEY}` }));
    clean((await app.inject({ method: 'GET', url: '/api/mail?to=claude-a-other&all=1', headers: H })).body);
    const one = (await app.inject({ method: 'GET', url: '/api/mail?to=claude-a-other&all=1', headers: H })).json() as { mail: { id: number }[] };
    clean((await app.inject({ method: 'GET', url: `/api/mail/${one.mail[0]!.id}`, headers: H })).body);

    // the notification catch-up
    notifyLog.record({ kind: 'ask', sessionId: ID, title: `use ${OAT}`, body: ORKEY, runId: null });
    clean((await app.inject({ method: 'GET', url: `/api/notifications/catchup?seq=0&epoch=${notifyLog.epoch}` })).body);

    // the push payload, captured at the push stub
    sent.length = 0;
    const push = new PushService({ publicKey: 'p', privateKey: 'k', subject: 'mailto:ops@example.invalid' },
      path.join(home, '.ccrc', 'push-subs.json'));
    await push.subscribe({ endpoint: 'https://push.example.invalid/1', keys: { p256dh: 'x', auth: 'y' } });
    await push.notify({ title: `ask ${OAT}`, body: askPushBody(null, { title: `paste ${ORKEY}` }), actions: [{ action: 'a', title: OAT }] });
    expect(sent).toHaveLength(1);
    clean(sent[0]!);
  });
});

// ── the table's custody ────────────────────────────────────────────────────
describe('secret_fingerprints never leaves the server (D-5513)', () => {
  const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  it('`secret_fingerprints` is read by mask.ts only and is in no route\'s answer', () => {
    const holders = files(srcRoot).filter((f) => readFileSync(f, 'utf8').includes('secret_fingerprints'))
      .map((f) => path.relative(srcRoot, f)).sort();
    expect(holders).toEqual(['accounts/mask.ts', 'coord/schema.ts']);
    // mask.ts registers no route and answers no request
    const mask = readFileSync(path.join(srcRoot, 'accounts', 'mask.ts'), 'utf8');
    expect(mask).not.toMatch(/app\.(get|post|put|delete)\(|reply\.|FastifyInstance/);
    // and the table holds no column a secret could sit in: the fingerprint, its lane, its generation and a time
    const db = new DatabaseSync(':memory:');
    const dbm = openCoordDb(path.join(mkTmp('ccrc-mask-cols-'), 'coord.db'));
    const cols = (dbm.prepare("SELECT name FROM pragma_table_info('secret_fingerprints')").all() as { name: string }[]).map((c) => c.name);
    expect(cols.sort()).toEqual(['at', 'fp', 'gen', 'laneId', 'len']);   // len: the unpadded secret's byte length (D-5996)
    db.close();
  });
});

// ── the review's findings (D-5995, D-5996) ─────────────────────────────────
// APPENDED. Each case is a probe a reviewer ran against the first build: a credential that still reached a client,
// or a mask that stalled or delayed the stream.
/** A fingerprint row as the box answers it (D-5996): the secret's trailing `=` stripped, its byte length beside it. */
const rowOf = (token: string, laneId: string, secret: string): { laneId: string; fp: string; len: number } =>
  fingerprintRow(token, laneId, secret);
const ingestAs = (m: SecretMasker, token: string, secrets: string[]): unknown =>
  (m.ingest as unknown as (a: unknown) => unknown)({
    gen: fingerprintGeneration(token), rows: secrets.map((x, i) => rowOf(token, `lane${i}`, x)),
  });
const maskerOver = (token: () => string, secrets: string[], requestRekey?: () => unknown) => {
  const db = openCoordDb(path.join(mkTmp('ccrc-mask-r-'), 'coord.db'));
  const m = new SecretMasker({ db, token, requestRekey: requestRekey as (() => void) | undefined });
  ingestAs(m, token(), secrets);
  return { m, db };
};

describe('the review findings: shapes reach every client masked (D-5995)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a Codex auth.json split at every offset of its field context and opaque refresh_token value leaves no byte of the value in the drawer', () => {
    const line = `{"refresh_token": "${OPAQUE_REFRESH}"}\r\n`;
    for (let k = 1; k < line.length - 2; k++) {
      const out: string[] = [];
      const d = new DrawerMask(new SecretMasker(), (t) => out.push(t), 50);
      d.push(line.slice(0, k));
      d.push(line.slice(k));
      d.flush();
      expect(leaksNone(out.join(''), OPAQUE_REFRESH), `split at ${k}: ${out.join('|')}`).toBe(true);
      d.dispose();
    }
  });

  it('a key after a literal \\n or \\t in a JSON-serialized tool input, or after a percent-escape, is masked', () => {
    const m = new SecretMasker();
    const input = JSON.stringify({ file_path: '/w/demo/.env', content: `A=1\n${API}\n\t${OAT}\n` });
    const out = m.maskText(`{"kind":"tool_use","input":${JSON.stringify(input)}}`);
    expect(leaksNone(out, API) && leaksNone(out, OAT), out).toBe(true);
    for (const t of [`Bearer%20${OAT}`, `%22${ORKEY}%22`, `key%3D${API}`, `x\\r${OAT}`]) {
      expect(leaksNone(m.maskText(t), t.includes(ORKEY) ? ORKEY : t.includes(API) ? API : OAT), t).toBe(true);
    }
  });

  it('a transcript tool_use input holding a Codex auth.json reaches the session socket with its value masked', async () => {
    const tool = JSON.stringify({ type: 'assistant', uuid: 'u-tool', timestamp: '2026-10-18T10:00:00.000Z', message: {
      role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Write',
        input: { file_path: '/w/demo/auth.json', content: JSON.stringify({ tokens: { refresh_token: OPAQUE_REFRESH } }) } }],
    } });
    const frame = await backlogFrame(`${tool}\n`);
    expect(leaksNone(frame, OPAQUE_REFRESH), frame.slice(0, 400)).toBe(true);
  });

  it('a compatible key that a tool input\'s 4,000-character cut would split is never shown in part', async () => {
    // the serialized input is `{"content":"` (12 characters) then the content: the key starts 20 characters before the cut
    const content = `${'a '.repeat((4_000 - 20 - 12) / 2)}${CMP} tail`;
    const tool = JSON.stringify({ type: 'assistant', uuid: 'u-cut', timestamp: '2026-10-18T10:00:00.000Z', message: {
      role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { content } }],
    } });
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const frame = await backlogFrame(`${tool}\n`, m);
    expect(frame).toContain('a a a');
    expect(leaksNone(frame, CMP), frame.slice(-300)).toBe(true);
    m.close();
  });

  it('a tmux redraw positions a wrapped key with cursor moves, or puts ESC(B ESC[m or an OSC 8 link in it, and no byte of it leaks', () => {
    const m = new SecretMasker();
    const cases = [
      `\x1b[5;1H⎿  ${OAT.slice(0, 40)}\x1b[6;1H     ${OAT.slice(40)}\x1b[7;1H`,
      `\x1b[5;1H  ${OAT.slice(0, 40)}\x1b[6;6H${OAT.slice(40)}`,
      `KEY=${API.slice(0, 60)}\x1b(B\x1b[m\r\n     ${API.slice(60)}\r\n`,
      ...[5, 20, 60].map((k) => `x ${OAT.slice(0, k)}\x1b(B\x1b[m${OAT.slice(k)} y`),
      `x ${OAT.slice(0, 30)}\x1b]8;;https://example.invalid/\x1b\\${OAT.slice(30)}\x1b]8;;\x1b\\ y`,
      `x ${OAT.slice(0, 30)}\x1b]8;;https://example.invalid/\x07${OAT.slice(30)} y`,
    ];
    for (const c of cases) {
      const secret = c.includes(API.slice(0, 20)) ? API : OAT;
      const out = m.maskText(c, { rows: true });
      expect(leaksNone(out.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-~])/g, ''), secret),
        JSON.stringify(out)).toBe(true);
    }
  });

  it('the drawer holds a split key past a gap longer than the hold and still leaks no byte of it', () => {
    vi.useFakeTimers();
    for (const k of [3, 6, 13, 22, 40]) {
      const out: string[] = [];
      const d = new SecretMasker().drawer((t) => out.push(t));
      d.push(`key: ${OAT.slice(0, k)}`);
      vi.advanceTimersByTime(80);
      d.push(`${OAT.slice(k)}\r\n`);
      expect(leaksNone(out.join(''), OAT), `gap after ${k}: ${out.join('|')}`).toBe(true);
      d.dispose();
    }
    // a JWT begun before the gap matches no shape on its own, so only the fail-closed tail masks its head
    const out: string[] = [];
    const d = new SecretMasker().drawer((t) => out.push(t));
    d.push(`jwt: ${JWT.slice(0, 20)}`);
    vi.advanceTimersByTime(80);
    d.push(`${JWT.slice(20)}\r\n`);
    expect(leaksNone(out.join(''), JWT), out.join('|')).toBe(true);
    d.dispose();
    // and with fingerprint rows held, a compatible key's head of 20 bytes or more
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const o2: string[] = [];
    const d2 = m.drawer((t) => o2.push(t));
    d2.push(`k ${CMP.slice(0, 25)}`);
    vi.advanceTimersByTime(80);
    d2.push(`${CMP.slice(25)}\r\n`);
    expect(leaksNone(o2.join(''), CMP), o2.join('|')).toBe(true);
    d2.dispose();
    m.close();
  });

  it('a maskDeep over a class instance masks its string fields', () => {
    class Holder { constructor(readonly note: string) {} }
    const out = JSON.stringify(new SecretMasker().maskDeep({ h: new Holder(`use ${OAT}`) }));
    expect(leaksNone(out, OAT), out).toBe(true);
  });
});

describe('the review findings: a compatible key is matched where it actually appears (D-5995, D-5996)', () => {
  it('a compatible key ending a sentence, in brackets, in a URL path or query, after a literal \\r, or with an SGR inside is masked, and the same contexts around another key are not', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const ctx = (k: string): string[] => [`${k}.`, `(${k})`, `<${k}>`, `{${k}}`, `[${k}]`, `|${k}|`, `**${k}**`,
      `/v1/${k}/x`, `?${k}`, `\\r${k}`];
    for (const c of ctx(CMP)) expect(leaksNone(m.maskText(c), CMP), c).toBe(true);
    for (const c of ctx(CMP_OTHER)) expect(m.maskText(c), c).toBe(c);
    expect(leaksNone(m.maskText(`${CMP.slice(0, 10)}\x1b[31m${CMP.slice(10)}`).replace(/\x1b\[[0-9;]*m/g, ''), CMP)).toBe(true);
  });

  it('a compatible key wrapped onto an indented next row, or split by a cursor move, is masked in rows mode', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    for (const c of [`  ⎿  x ${CMP.slice(0, 30)}\r\n     ${CMP.slice(30)}\r\n`, `k ${CMP.slice(0, 30)}\x1b[6;6H${CMP.slice(30)}`]) {
      const out = m.maskText(c, { rows: true });
      expect(leaksNone(out, CMP), JSON.stringify(out)).toBe(true);
    }
  });

  it('a padded secret is fingerprinted without its padding and matched bare or padded (D-5996)', () => {
    const padded = `${fill(30, 'pad')}==`;
    const { m } = maskerOver(() => TOKEN_1, [padded]);
    expect(m.maskText(`K=${padded}`)).toBe(`K=${SECRET_MASK}==`);
    expect(m.maskText(`K ${padded.slice(0, -2)} x`)).toBe(`K ${SECRET_MASK} x`);
  });

  it('ordinary run-dense text of no fingerprinted length is never cut, and the ceiling is shared by a whole frame', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const plain = Array.from({ length: 40_000 }, (_, i) => `run${String(i).padStart(22, '0')}`).join(' ');
    expect(m.maskText(plain).endsWith(SECRET_MASK_TOO_LARGE)).toBe(false);
    // runs of CMP's own length are candidates: two strings of 4,500 each pass the 8,192-run frame ceiling
    const same = (salt: string): string => Array.from({ length: 4_500 },
      (_, i) => `${salt}${String(i).padStart(CMP.length - salt.length, '0')}`).join(' ');
    const frame = m.maskDeep({ a: same('p'), b: `${same('q')} ${CMP}` });
    expect(frame.a.endsWith(SECRET_MASK_TOO_LARGE)).toBe(false);
    expect(frame.b.endsWith(SECRET_MASK_TOO_LARGE)).toBe(true);
    expect(leaksNone(frame.b, CMP)).toBe(true);
  });
});

describe('the review findings: rotation and re-key (D-5995)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('two rotations before the re-key lands keep the oldest generation matched', () => {
    let tok = TOKEN_1;
    const { m } = maskerOver(() => tok, [CMP]);
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    tok = TOKEN_2;
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    tok = 'c3'.repeat(32);
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
  });

  it('an answer keyed with another generation is refused and deletes nothing', () => {
    let tok = TOKEN_1;
    const { m, db } = maskerOver(() => tok, [CMP]);
    tok = TOKEN_2;
    m.maskText('x');
    expect(ingestAs(m, TOKEN_1, [CMP_OTHER])).toBe(false);   // keyed with the previous token: not the current generation
    const gens = (db.prepare('SELECT DISTINCT gen FROM secret_fingerprints').all() as { gen: string }[]).map((r) => r.gen);
    expect(gens).toEqual([fingerprintGeneration(TOKEN_1)]);
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
  });

  it('the re-key request\'s answer is ingested, and a failed request is retried with backoff', async () => {
    vi.useFakeTimers();
    let tok = TOKEN_1;
    const calls: number[] = [];
    let fail = true;
    const { m, db } = maskerOver(() => tok, [CMP], () => {
      calls.push(1);
      if (fail) return Promise.reject(new Error('link down'));
      return Promise.resolve({ gen: fingerprintGeneration(tok), rows: [rowOf(tok, 'lane0', CMP)] });
    });
    tok = TOKEN_2;
    m.maskText('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const gens = (db.prepare('SELECT DISTINCT gen FROM secret_fingerprints').all() as { gen: string }[]).map((r) => r.gen);
    expect(gens).toEqual([fingerprintGeneration(TOKEN_2)]);
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    const settled = calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls).toHaveLength(settled);   // nothing stale left: no further request
    (m as unknown as { close?: () => void }).close?.();
  });
});

describe('the rulings: a restart after a rotation re-keys with backoff until it lands (D-5995)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a restart under a rotated token asks for the re-key at once, retries with growing gaps through failures, and masks the key once it lands', async () => {
    vi.useFakeTimers();
    const { db } = maskerOver(() => TOKEN_1, [CMP]);   // rows of the old generation, then the process restarts
    const at: number[] = [];
    let failures = 3;
    const m = new SecretMasker({ db, token: () => TOKEN_2, log: () => {}, requestRekey: () => {
      at.push(Date.now());
      if (failures-- > 0) return Promise.reject(new Error('link down'));
      return Promise.resolve({ gen: fingerprintGeneration(TOKEN_2), rows: [fingerprintRow(TOKEN_2, 'lane0', CMP)] });
    } });
    // the accepted window (ruling e): the previous token is gone with the old process, so only the shapes apply
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${CMP}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(at).toHaveLength(1);                         // asked at boot
    await vi.advanceTimersByTimeAsync(60_000);
    expect(at).toHaveLength(4);                         // three failures, then the answer
    const gaps = at.slice(1).map((t, i) => t - at[i]!);
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!);         // the gap grows
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(at).toHaveLength(4);                         // landed: no further request
    m.close();
  });
});

describe('the review findings: the mask stays cheap and the drawer stays live (D-5995)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('20,000 shape matches mask in well under a second, flat and in rows mode', () => {
    const m = new SecretMasker();
    const text = Array.from({ length: 20_000 }, (_, i) => `sk-${String(i).padStart(12, '0')}`).join(' ');
    for (const rows of [false, true]) {
      const t0 = performance.now();
      const out = m.maskText(text, { rows });
      expect(out.startsWith(SECRET_MASK)).toBe(true);
      expect(performance.now() - t0, `rows=${rows}`).toBeLessThan(600);
    }
  });

  it('2 MB of undelimited drawer output in 4 KB chunks stays bounded in time and in what it holds', () => {
    const out: string[] = [];
    const d = new DrawerMask(new SecretMasker(), (t) => out.push(t), 50);
    const chunk = 'A'.repeat(4096);
    const t0 = performance.now();
    let maxHeld = 0;
    d.push('key sk-');   // a run that could start a shape: held, and it never ends
    for (let i = 0; i < 512; i++) {
      d.push(chunk);
      maxHeld = Math.max(maxHeld, (d as unknown as { held: string }).held.length);
    }
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(maxHeld).toBeLessThanOrEqual(8192 + 1024 + 4096);
    d.dispose();
  });

  it('a keystroke echo that cannot start a shape goes at once, and a held one goes 6 ms after its first hold', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const d = new SecretMasker().drawer((t) => out.push(t));
    d.push('x');
    expect(out).toEqual(['x']);
    d.push(' e');                      // a shape's first byte is no hold in the shape-only mode
    expect(out.join('')).toBe('x e');
    d.push(' sk-');                    // a begun shape is held
    expect(out.join('')).toBe('x e ');
    vi.advanceTimersByTime(4);
    d.push('y');                       // still held; the deadline does not restart
    vi.advanceTimersByTime(2);
    expect(out.join('')).toBe(`x e ${SECRET_MASK}`);   // 6 ms after the first hold, failed closed on the begun shape
    d.dispose();
  });
});

describe('the review findings: every egress of session text is masked (D-5995)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const session = (id: string): FleetSession => ({
    id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
    workspace: null, name: `n ${OAT}`, status: 'idle', statusUpdatedAt: null, limits: null,
    dialogPending: false, version: null, model: null, effort: null, ultracode: false,
    branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
    hookState: null, askSummary: `paste ${ORKEY}`, subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
    unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
    started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator', releasedFrom: null,
  });
  const clean = (body: string): void => {
    expect(body).toContain(SECRET_MASK);
    expect(leaksNone(body, OAT) && leaksNone(body, ORKEY), body.slice(0, 300)).toBe(true);
  };

  it('the /ws/fleet fleet frame and the disconnected GET /api/fleet snapshot carry only the mask', async () => {
    const home = mkTmp('ccrc-mask-fleet-');
    seedRoster(home);
    const cachePath = path.join(home, 'state-cache.json');
    await saveSnapshot([session(ID)], cachePath);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const bus = new Bus();
    app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(),
      stateCachePath: cachePath, fleetState: { connected: false, downSince: 1, ccdVerbs: null, rosterFp: null, build: null } }, bus);
    clean((await app.inject({ method: 'GET', url: '/api/fleet' })).body);
    const port = await listen(app);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
    const frame = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no fleet frame')), 5000);
      ws.on('message', (d) => {
        const s = String(d);
        if (s.includes('"hello"')) bus.emit('fleet', [session(ID)]);
        if (s.includes('"type":"fleet"')) { clearTimeout(t); resolve(s); }
      });
      ws.on('error', reject);
    });
    ws.close();
    clean(frame);
  });

  it('GET /api/asks carries only the mask, and GET /api/digest leaks nothing', async () => {
    const f = await approvalsFixture();
    try {
      const t = Date.now() - 3 * 86_400_000;
      const id = f.coord.insertAsk({ childId: CHILD, parentId: PARENT, runId: null, askKey: 'k-mask', askAt: t, dialogId: 'd-mask',
        question: `use ${OAT}?`, options: [ORKEY, 'no'], now: t });
      const r = f.coord.askById(id);
      if (!r.ok || r.ask === null) throw new Error('fixture');
      clean((await f.app.inject({ method: 'GET', url: `/api/asks?parent=${PARENT}` })).body);
      f.coord.takeAskForAnswer(id, r.ask.askAt);
      f.coord.settleAsk(id, PARENT, ORKEY, t + 1);
      const day = new Date(t + 86_400_000).toISOString().slice(0, 10);
      const d = (await f.app.inject({ method: 'GET', url: `/api/digest?day=${day}` })).body;
      const prev = (await f.app.inject({ method: 'GET', url: `/api/digest?day=${new Date(t).toISOString().slice(0, 10)}` })).body;
      // The digest's lines already pass `redactCommand` (shapes only); the mask adds the exact-bytes half.
      const body = d.includes('"lines":[]') ? prev : d;
      expect(body).toContain('"rowKind":"ask"');
      expect(leaksNone(body, OAT) && leaksNone(body, ORKEY), body.slice(0, 300)).toBe(true);
    } finally { await f.close(); }
  });

  it('GET /api/digest and GET /api/ledger are masked like their siblings, as one frame each', () => {
    const src = (...p: string[]): string => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', ...p), 'utf8');
    expect(src('coord', 'routes.ts')).toMatch(/app\.get\('\/api\/ledger', \{ preSerialization: maskAnswer \}/);
    expect(src('server.ts')).toMatch(/app\.get\('\/api\/digest', \{ preSerialization: maskAnswer \}/);
  });
});

// ── the orchestrator's rulings on the drawer and the mask's cost (D-5995) ──
// APPENDED. (a) an ordinary keystroke's echo is never delayed in the shape-only mode, and at most the 8 ms hold while
// fingerprint rows are held; (b) failing closed never masks ordinary text for good; (d) one frame never blocks the
// event loop for more than 25 ms on the round-1 reviewer's worst cases.
describe('the rulings: the drawer echoes at once and never masks ordinary text for good (D-5995)', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Ten keystrokes 30 ms apart, each echoed by tmux as its own chunk: the added latency of each, in ms. */
  const echoBench = (m: SecretMasker, keys: string): number[] => {
    vi.useFakeTimers();
    const out: { at: number; text: string }[] = [];
    const d = m.drawer((t) => out.push({ at: Date.now(), text: t }));
    const sent: number[] = [];
    for (const k of keys) {
      sent.push(Date.now());
      d.push(k);
      vi.advanceTimersByTime(30);
    }
    d.dispose();
    // the moment each key's character first reached the socket
    let seen = '';
    const lat: number[] = [];
    for (const o of out) {
      for (const ch of o.text) { if (seen.length < keys.length && ch === keys[seen.length]) { lat.push(o.at - sent[seen.length]!); seen += ch; } }
    }
    expect(seen).toBe(keys);
    return lat;
  };

  it('ten keystrokes 30 ms apart are echoed with no added latency in the shape-only mode, and within 8 ms with fingerprint rows held', () => {
    for (const keys of ['git status', 'echo hello', 'ssh-keygen']) {
      expect(echoBench(new SecretMasker(), keys), keys).toEqual(Array(keys.length).fill(0));
      const { m } = maskerOver(() => TOKEN_1, [CMP]);
      const lat = echoBench(m, keys);
      expect(Math.max(...lat), `${keys}: ${lat.join(',')}`).toBeLessThanOrEqual(8);
      m.close();
    }
  });

  /** `text` typed one character per 30 ms, then a space and Enter, through a drawer: the terminal's final screen. */
  const typeSlowly = (m: SecretMasker, text: string): { shown: string; raw: string } => {
    vi.useFakeTimers();
    const out: string[] = [];
    const d = m.drawer((t) => out.push(t));
    d.push('$ ');
    for (const ch of text) { d.push(ch); vi.advanceTimersByTime(30); }
    d.push(' ');
    d.push('\r\n');
    vi.advanceTimersByTime(30);
    d.push('$ ');                                 // the shell's next prompt
    vi.advanceTimersByTime(30);
    d.dispose();
    return { shown: screen(out.join('')), raw: out.join('') };
  };
  const ORDINARY = {
    path: '/data/projects/demo/server/src/accounts/mask.ts',
    url: 'https://example.com/docs/guide/getting-started?tab=install#node',
    sha: fill(40, 'sha', 'hex'),
    blob: `${fill(42, 'blob')}==`,
    word: 'pneumonoultramicroscopicsilicovolcanoconiosis',
  };

  it('a long path, a URL, a git sha, a base64 blob and a long word typed slowly reach the screen unmasked, in both modes', () => {
    // every ordinary string's own length (and its runs' lengths) is a fingerprinted length: each could still be a key
    const lengths = Object.values(ORDINARY).flatMap((x) => x.split(/[/?#=:.&-]/).concat(x)).map((x) => x.length).filter((n) => n >= 20);
    const secrets = [...new Set(lengths)].map((n, i) => fill(n, `s${i}`, 'hex'));
    for (const [name, text] of Object.entries(ORDINARY)) {
      expect(typeSlowly(new SecretMasker(), text).shown, `shape-only ${name}`).toBe(`$ ${text}\n$`);
      const { m } = maskerOver(() => TOKEN_1, secrets);
      const r = typeSlowly(m, text);
      expect(r.shown, `fingerprints held, ${name}`).toBe(`$ ${text}\n$`);
      m.close();
    }
  });

  it('a compatible key typed slowly stays masked past its first 19 bytes, and a shape typed slowly past its sk', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const k = typeSlowly(m, CMP);
    // the accepted gap (D-5995): a key's first 19 bytes, typed slower than the hold, leave before it could be one
    expect(k.shown).toBe(`$ ${CMP.slice(0, 19)}${SECRET_MASK}\n$`);
    expect(leaksNone(k.raw, CMP.slice(19)), k.raw).toBe(true);
    m.close();
    const s = typeSlowly(new SecretMasker(), OAT);
    expect(s.shown).toBe(`$ sk${SECRET_MASK}\n$`);
    expect(leaksNone(s.raw, OAT.slice(2)), s.raw).toBe(true);
  });

  it('an expired hold on a run that cannot be a key goes unmasked: a run longer than every fingerprinted length is drawn as typed', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const long = 'x'.repeat(CMP.length + 40);
    expect(typeSlowly(m, long).shown).toBe(`$ ${long}\n$`);
    // and before the run ends: once it is longer than every fingerprinted length, it is drawn as typed
    vi.useFakeTimers();
    const out: string[] = [];
    const d = m.drawer((t) => out.push(t));
    for (const ch of long) { d.push(ch); vi.advanceTimersByTime(30); }
    expect(screen(out.join(''))).toBe(long);
    d.dispose();
    m.close();
  });
});

describe('the rulings: the provisional mask waits for the run to end, and no longer (D-5995)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a run that ends in blanks with nothing after them is drawn as typed within the hold', () => {
    vi.useFakeTimers();
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const out: string[] = [];
    const d = m.drawer((t) => out.push(t));
    const word = 'a-fairly-long-ordinary-identifier-name';
    for (const ch of word) { d.push(ch); vi.advanceTimersByTime(30); }
    d.push(' ');
    vi.advanceTimersByTime(8);
    expect(screen(out.join(''))).toBe(word);
    d.dispose();
    m.close();
  });

  it('a compatible key wrapped onto an indented next row that arrives after the hold leaks nothing past its first 19 bytes', () => {
    vi.useFakeTimers();
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    for (const cut of [20, 30, CMP.length - 3]) {
      const out: string[] = [];
      const d = m.drawer((t) => out.push(t));
      d.push(`key ${CMP.slice(0, cut)}`);
      vi.advanceTimersByTime(80);
      d.push('\r\n');
      vi.advanceTimersByTime(80);
      d.push(`    ${CMP.slice(cut)}\r\n$ `);
      vi.advanceTimersByTime(80);
      expect(leaksNone(out.join(''), CMP.slice(19)), `cut ${cut}: ${JSON.stringify(out)}`).toBe(true);
      d.dispose();
    }
    m.close();
  });
});

describe('the rulings: one frame never blocks the event loop past 25 ms (D-5995)', () => {
  // The round-1 performance reviewer's worst cases, with one fingerprint row held. Generous CI bound: a timing test
  // pins the ORDER of the cost (a quadratic or per-string regression is seconds), the PR body gives the measured ms.
  const BOUND = 250;
  it('4 MB of undelimited drawer output in 4 KB chunks: no push blocks, and nothing is held past the bound', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const d = m.drawer(() => {});
    const chunk = 'A'.repeat(4096);
    let worst = 0;
    d.push('key sk-');
    for (let i = 0; i < 1024; i++) {
      const t0 = performance.now();
      d.push(chunk);
      worst = Math.max(worst, performance.now() - t0);
      expect((d as unknown as { held: string }).held.length + ((d as unknown as { pending: string | null }).pending?.length ?? 0))
        .toBeLessThanOrEqual(8192 + 1024 + 4096);
    }
    d.dispose();
    expect(worst).toBeLessThan(BOUND);
    m.close();
  });

  it('20,000 shape matches, and a frame of 50 strings each at the run ceiling, mask within the bound', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const sk = Array.from({ length: 20_000 }, (_, i) => `sk-${String(i).padStart(12, '0')}`).join(' ');
    let t0 = performance.now();
    m.maskText(sk, { rows: true });
    expect(performance.now() - t0).toBeLessThan(BOUND);
    const atCap = Array.from({ length: RUNS_PER_CHUNK * MAX_CHUNKS + 16 }, (_, i) => `cmp-${fill(CMP.length - 4, `u${i}`, 'hex')}`).join(' ');
    t0 = performance.now();
    const frame = m.maskDeep(Array.from({ length: 50 }, () => atCap));
    expect(performance.now() - t0).toBeLessThan(BOUND);
    expect(frame.every((x) => x.endsWith(SECRET_MASK_TOO_LARGE))).toBe(true);
    m.close();
  });

  it('the frame ceiling counts runs, not distinct texts: a few runs repeated past it still cut the frame', () => {
    const { m } = maskerOver(() => TOKEN_1, [CMP]);
    const few = Array.from({ length: 8 }, (_, i) => `cmp-${fill(CMP.length - 4, `f${i}`, 'hex')}`);
    const text = Array.from({ length: RUNS_PER_CHUNK * MAX_CHUNKS + 8 }, (_, i) => few[i % 8]).join(' ');
    expect(m.maskText(`${text} ${CMP}`).endsWith(SECRET_MASK_TOO_LARGE)).toBe(true);
    m.close();
  });
});

describe('the rulings: every egress of session-derived text goes through the masker (D-5995)', () => {
  const src = (...p: string[]): string => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', ...p), 'utf8');
  /** Masked inside the handler (a `maskDeep`/`maskText` call, a masked stream or a drawer): path → what masks it. */
  const INLINE: Record<string, RegExp> = {
    '/ws/fleet': /mk\.maskDeep\(\{ type: 'fleet'/,
    '/ws/session/:id': /new SessionStream\(/,   // SessionStream's one `send` masks every frame
    '/ws/pty/:id': /\.drawer\(\(text\) => socket\.send\(text\)\)/,
    '/api/notifications/catchup': /maskDeep\(deps\.notifyLog\.catchUp/,
    '/api/sessions/:id/pane/history': /maskText\(r\.text, \{ rows: true \}\)/,
    '/api/mail': /mail: \(deps\.masker \?\? SHAPE_ONLY_MASKER\)\.maskDeep\(mail\)/,
    '/api/mail/:id': /envelope: \(deps\.masker \?\? SHAPE_ONLY_MASKER\)\.maskDeep\(row\.envelope\)/,
    '/api/runs/:id/items': /items: \(deps\.masker \?\? SHAPE_ONLY_MASKER\)\.maskDeep\(/,
    '/api/feed': /events: \(deps\.masker \?\? SHAPE_ONLY_MASKER\)\.maskDeep\(/,
  };
  /** Carries no session-derived text: path → why. */
  const EXEMPT: Record<string, string> = {
    '/api/auth/passkeys': 'passkey ids and labels the operator set',
    '/api/auth/status': 'the auth state',
    '/api/fleet/health': "the mirror's counters",
    '/api/push/key': 'the VAPID public key',
    '/api/accounts': 'the account roster (lane names and states the operator set; no secret)',
    '/api/sessions/:id/commands': "the session's command files' names",
    '/api/projects': 'project names and paths',
    '/api/pools/epoch': 'a counter',
    '/api/sessions/:id/clip/:name': 'a file the operator uploaded, served back as it was',
    '/api/coord/caps': 'capacity settings',
    '/api/coord/collect-lane': "the collector's settings and counters",
    '/api/approvals/:id/ruling': 'a signed ruling read by the fleet box (a mask would break the signature); its input is shape-redacted at write',
    '/api/approvals/key': 'a public key',
    '/api/updates': 'release metadata',
    '/api/updates/intent/:nodeId': 'an update intent',
    '/api/docs/projects': 'repository content, not session text',
    '/api/docs/:project/tree': 'repository content, not session text',
    '/api/docs/:project/file': 'repository content, not session text',
  };

  it('every GET route and websocket is masked by the hook, masked inline, or exempt with a reason', () => {
    const files = [['server.ts'], ['coord', 'routes.ts'], ['update', 'routes.ts'], ['docs', 'routes.ts']];
    const seen: string[] = [];
    for (const f of files) {
      const text = src(...f);
      for (const m of text.matchAll(/app\.get\('(\/(?:api|ws)[^']*)'(, \{[^}]*\})?/g)) {
        const p = m[1]!;
        seen.push(p);
        if ((m[2] ?? '').includes('preSerialization: maskAnswer')) continue;
        if (INLINE[p] !== undefined) {
          expect(text.slice(m.index!, m.index! + 6000), `${p} masks inline`).toMatch(INLINE[p]!);
          continue;
        }
        expect(EXEMPT[p], `${p} is neither masked nor exempt`).toBeDefined();
      }
    }
    for (const p of [...Object.keys(INLINE), ...Object.keys(EXEMPT)]) expect(seen, `${p} is still registered`).toContain(p);
  });
});
