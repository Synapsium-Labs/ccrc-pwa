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
  SecretMasker, DrawerMask, fingerprintOf, fingerprintGeneration, shapeMatchers, RUNS_PER_CHUNK, MAX_CHUNKS,
} from '../src/accounts/mask.js';
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
  m.ingest((opts.secrets ?? [CMP]).map((s, i) => ({ laneId: `lane${i}`, fp: fingerprintOf(token()!, s) })));
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
    const runs = Array.from({ length: 299 }, (_, i) => `filler${String(i).padStart(20, '0')}`);
    const out = m.maskText(`${runs.join(' ')} ${CMP} tail`);
    expect(RUNS_PER_CHUNK).toBe(256);
    expect(out.endsWith(`${SECRET_MASK} tail`)).toBe(true);
    expect(leaksNone(out, CMP)).toBe(true);
  });

  it('a frame past the hard ceiling ends in the too-large notice, and no byte after the ceiling reaches the socket', () => {
    const { m } = maskerWith();
    const ceiling = RUNS_PER_CHUNK * MAX_CHUNKS;
    const runs = Array.from({ length: ceiling + 10 }, (_, i) => `filler${String(i).padStart(20, '0')}`);
    const out = m.maskText(`${runs.join(' ')} ${CMP} after`);
    expect(out.endsWith(SECRET_MASK_TOO_LARGE)).toBe(true);
    expect(out).toContain(runs[ceiling - 1]);
    expect(out).not.toContain(runs[ceiling]);
    expect(out).not.toContain('after');
    expect(leaksNone(out, CMP)).toBe(true);
  });

  it('a row is matched only under the token of its own generation', () => {
    let tok = TOKEN_1;
    const { m, db } = maskerWith({ token: () => tok });
    tok = TOKEN_2;
    m.maskText('x');   // the rotation is seen; TOKEN_1 is still held as the previous generation
    // A row filed under the NEW generation but keyed with the OLD token is not this generation's fingerprint.
    db.prepare('INSERT INTO secret_fingerprints (laneId, fp, gen, at) VALUES (?, ?, ?, ?)')
      .run('stray', fingerprintOf(TOKEN_1, CMP_OTHER), fingerprintGeneration(TOKEN_2), 1);
    const fresh = new SecretMasker({ db, token: () => TOKEN_2 });
    expect(fresh.maskText(`k=${CMP_OTHER}`)).toBe(`k=${CMP_OTHER}`);
  });

  it('after a rotation, a compatible key is still masked before and after the re-key, and old-generation rows are dropped once the new ones land; the roster sub is requested', () => {
    let tok = TOKEN_1;
    const rekeys: number[] = [];
    const { m, db } = maskerWith({ token: () => tok, requestRekey: () => rekeys.push(1) });
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    tok = TOKEN_2;   // the box token rotates
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);   // before the re-key: the previous generation still matches
    expect(rekeys).toHaveLength(1);
    m.ingest([{ laneId: 'lane0', fp: fingerprintOf(TOKEN_2, CMP) }]);   // the re-keyed rows land
    expect(m.maskText(`k=${CMP}`)).toBe(`k=${SECRET_MASK}`);
    const gens = (db.prepare('SELECT DISTINCT gen FROM secret_fingerprints').all() as { gen: string }[]).map((r) => r.gen);
    expect(gens).toEqual([fingerprintGeneration(TOKEN_2)]);
    // and a process booting over rows of a generation it holds no token for asks for the re-key at once
    db.prepare('INSERT INTO secret_fingerprints (laneId, fp, gen, at) VALUES (?, ?, ?, ?)').run('old', 'f'.repeat(64), 'oldgen', 1);
    const booted: number[] = [];
    new SecretMasker({ db, token: () => TOKEN_2, requestRekey: () => booted.push(1) });
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
    d.push('partial');                           // an open run is held, at most 50 ms
    expect(out).toEqual(['prompt> ']);
    vi.advanceTimersByTime(50);
    expect(out).toEqual(['prompt> ', 'partial']);
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
    const mail = coord.insertMail({ fromId: ID, fromUuid: UUID_A, toId: 'claude-a-other', runId: null, kind: 'note',
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
    expect(cols.sort()).toEqual(['at', 'fp', 'gen', 'laneId']);
    db.close();
  });
});
