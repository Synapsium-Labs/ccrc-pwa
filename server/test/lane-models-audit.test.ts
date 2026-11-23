// Programme model-class-advance, wave R4 (review F3): the audit line of `POST /api/models/:lane` through the REAL wiring.
// `lane-models-post.test.ts` and the hold-race suite inject their own `actorOf`, so neither can see the registration in
// `server.ts`. This one builds the whole server with sign-in armed, signs a device in through the session store, POSTs a revert
// and reads the one `console.warn` line the door writes: it must name the device the gate measured (`device:<label>`,
// D-5229) and never the session cookie. The door reads the lane before it writes (revert-holds-until-newer, D-8757), and a
// refusal of that read writes no line: the audit line is one per write op asked. The fake `io` answers the capability read, the
// verb and the fresh read; no file, no agent, no `ccrc`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore } from '../src/auth/sessions.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { FleetIO } from '../src/io.js';
import type { PtyLike } from '../src/pty.js';
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import { CLASSES, laneClassModels, parseCatalogue, parseRegistry } from '../../shared/models.js';
import { loadConfig } from '../src/config.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
/** A neutral lane, rostered for this suite alone (the programme's tests name their lanes lane-a and lane-b, review 2523 F10). */
const LANE = 'lane-a';
const ROSTER = {
  version: 1,
  accounts: [
    { id: LANE, label: LANE, configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  ],
};
const [C0, C1] = CLASSES;
/** The label the session was created with: what the gate measures as the device. A control character is flattened. */
const LABEL = 'audit phone';
const LABEL_WITH_BREAK = 'audit\nphone';

const REG = {
  probe: 'codex', subagent: C1, discovery: 'catalogue',
  classes: { [C0]: 'model-5.6-gamma', [C1]: 'model-6.1-gamma', [CLASSES[2]]: 'model-6.1-delta', [CLASSES[3]]: null },
};
const CAT = {
  probe: 'codex', fetchedAt: 1_700_000_000_000,
  models: [{ id: 'model-5.6-gamma', label: 'Model 5.6 Gamma' }, { id: 'model-6.1-gamma', label: 'Model 6.1 Gamma' }, { id: 'model-6.1-delta', label: 'Model 6.1 Delta' }],
};
const exited = (stdout: object): ModelsAsked => ({ kind: 'exited', code: 0, stdout: `${JSON.stringify(stdout)}\n` });
const SHOW = exited({
  ok: true, op: 'show', id: LANE, anthropic: false, registry: REG, labels: laneClassModels(parseRegistry(REG), parseCatalogue(CAT)), windowNotices: [],
  revertHoldEnds: true,
});
/** An older box's `show`: no `revertHoldEnds`, so the door refuses before it writes. */
const SHOW_OLD = exited({
  ok: true, op: 'show', id: LANE, anthropic: false, registry: REG, labels: laneClassModels(parseRegistry(REG), parseCatalogue(CAT)), windowNotices: [],
});
const REVERT = exited({ ok: true, op: 'revert', class: C1, id: LANE });

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

describe('POST /api/models/:lane, built through buildServer with sign-in armed: the audit line names the measured device', () => {
  let app: FastifyInstance | undefined;
  let warn: ReturnType<typeof spyWarn>;
  beforeEach(() => { warn = spyWarn(); });
  afterEach(async () => { warn.mockRestore(); if (app) await app.close(); app = undefined; });

  async function signedIn(label: string, show: ModelsAsked = SHOW): Promise<{ cookie: string; token: string; asked: string[] }> {
    const home = mkTmp('ccrc-lane-models-audit-');
    seedRoster(home, ROSTER);
    const base0 = testDeps(home);
    seedRoster(home, ROSTER);   // testDeps seeds the default roster; this suite's lane is the one rostered
    const base: Deps = { ...base0, cfg: loadConfig({ CCRC_HOME: home }) };
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine('correct horse battery staple', FAST_PARAMS, 1)}\n`);
    const seeder = new SessionStore(path.join(home, '.ccrc', 'sessions.json'));
    await seeder.load();
    const { token } = await seeder.create(label, 1, Date.now());
    const asked: string[] = [];
    const io: FleetIO = {
      ...base.io,
      models: async (lane, action) => { asked.push(`${lane} ${action}`); return action === 'show' ? show : REVERT; },
    };
    const deps: Deps = { ...base, io, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false }, spawnPty: stubPty };
    app = await buildServer(deps);
    await app.ready();
    return { cookie: `${SESSION_COOKIE}=${token}`, token, asked };
  }
  const audit = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: models:'));

  it('one revert: 200, one audit line, "by device:<the label the session was created with>", no cookie and no token in it', async () => {
    const s = await signedIn(LABEL);
    const res = await app!.inject({
      method: 'POST', url: `/api/models/${LANE}`, headers: { cookie: s.cookie }, payload: { action: 'revert', class: C1 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(s.asked, 'the capability read, the act, then the fresh read').toEqual([`${LANE} show`, `${LANE} revert`, `${LANE} show`]);
    expect(audit()).toEqual([`ccrc-server: models: revert ${LANE} ${C1} by device:${LABEL} -> done`]);
    const line = audit()[0]!;
    expect(line).not.toContain(s.token);
    expect(line).not.toContain(SESSION_COOKIE);
    expect(line, 'a bare "unmeasured" is the gate measuring no session').not.toContain('unmeasured');
  });

  it('a label with a control character is flattened to one line (deviceActor, the one writer of the actor)', async () => {
    const s = await signedIn(LABEL_WITH_BREAK);
    const res = await app!.inject({
      method: 'POST', url: `/api/models/${LANE}`, headers: { cookie: s.cookie }, payload: { action: 'revert', class: C1 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(audit()).toEqual([`ccrc-server: models: revert ${LANE} ${C1} by device:${LABEL} -> done`]);
  });

  it('a box that does not prove the capability is refused before any write: 501, one read, and NO audit line', async () => {
    const s = await signedIn(LABEL, SHOW_OLD);
    const res = await app!.inject({
      method: 'POST', url: `/api/models/${LANE}`, headers: { cookie: s.cookie }, payload: { action: 'revert', class: C1 },
    });
    expect(res.statusCode, res.body).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported', cause: 'revert-hold-ends' });
    expect(s.asked, 'only the capability read: nothing was written').toEqual([`${LANE} show`]);
    expect(audit(), 'the audit line is one per write op asked').toEqual([]);
  });

  it('with no session the gate refuses first: nothing is asked of the op and nothing is audited', async () => {
    const s = await signedIn(LABEL);
    const res = await app!.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'revert', class: C1 } });
    expect(res.statusCode).toBe(401);
    expect(s.asked).toEqual([]);
    expect(audit()).toEqual([]);
  });
});
