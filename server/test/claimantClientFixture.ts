// The claimant client's real-server fixture (D-7320, D-7322; K5 tail, Tasks Q3h and Q3j; plan
// 2026-10-29-consolidation-k5-claimant-doors.md). MOVED here from `claimant-client-pin.test.ts`, never copied, so the
// pin and `claimant-client-skew.test.ts` run the same rows against the same server and read the same outcome table:
// a real `buildServer` (`approvalsHarness.ts`'s standard family, the fixture signing key, a fixed clock), per verb the
// success arm and each front-ladder refusal a caller of the client can reach, and the named-difference rows (D-7325).
// `EXPECTED` is the table as the base answers it, through the old doors; `FAMILY_DIFFERENCE` names the family's
// differences beside it (moved here from the pin in K5 Q3l). Neutral ids only (`approvalsHarness.ts`'s). Nothing here touches the live HOME or a live server.
import { beforeEach, afterEach, vi } from 'vitest';
import { createHash, createPrivateKey } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { Tmux } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import type { Questions } from '../src/coord/questions.js';
import { APPROVAL_SIGNING_KEY_FILE, renderServerCaps, SERVER_CAPS_FILE } from '../../shared/api.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import {
  CHILD, CHILD2, hookInput, PARENT, requestBody, standardFixture, TOKEN, uuidOf, type Approvals,
} from './approvalsHarness.js';
import { mkTmp } from './tmpHelpers.js';

export const P = { fromId: PARENT, fromUuid: uuidOf(PARENT) };
export const json = (o: unknown): string => JSON.stringify(o);

/** The four claimant verbs. */
export type Verb = 'asks answer' | 'asks release' | 'approvals rule' | 'approvals release';
export const VERBS: readonly Verb[] = ['asks answer', 'asks release', 'approvals rule', 'approvals release'];

export const QUESTION = { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] };
export const ASK_KEY = askKey({ questions: [QUESTION] })!;
export const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
export const ORDINARY = hookInput({ command: 'rm -rf build' });

/** A waiting hookstate for `id` carrying `QUESTION` at `updatedAt` (the stamp the take re-measures). `event: null`
 *  leaves the field out, as an AskUserQuestion's wait writes it, which is what the hold mints an ask row for. */
export const hookstate = (f: Approvals, id: string, updatedAt: number, o: { event?: null } = {}): void => {
  fs.writeFileSync(path.join(f.home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', ...(o.event === null ? {} : { event: 'PermissionRequest' }), sessionId: uuidOf(id), pid: 4242, updatedAt,
    ask: { questions: [QUESTION] }, subagents: [],
  }));
};

export const mailBodiesTo = (f: Approvals, to: string): string[] =>
  (f.coord.db.prepare('SELECT m.body AS body FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE d.toId = ? ORDER BY m.id')
    .all(to) as { body: string }[]).map((r) => r.body);

/** A body with `"kind":<kind>` added as its last top-level key. */
export const withKind = (body: string, kind: string): string => `${body.slice(0, -1)},"kind":"${kind}"}`;

// ── (b), (c), (d): a real server ──────────────────────────────────────────────────────────────────────────────────

/** The fixed clock, and the fixture signing key from a fixed, public 32-byte seed (Ed25519 signs deterministically),
 *  derived as `approval-signing-pin.test.ts` derives it. It signs nothing real: no box pins its public half. */
export const NOW = 1_760_000_000_000;
export const SEED = Buffer.alloc(32, 0x5a);
export const FIXTURE_KEY = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]), format: 'der', type: 'pkcs8',
});
export const NONCE = '0123456789abcdef0123456789abcdef';

export interface Outcome { status: number; body: string; effects: Record<string, unknown> }
/** The client's stdout is the body and one newline; over 400 characters it is held by its SHA-256, as
 *  `question-doors.test.ts#bodyOf` holds a response. */
export const bodyOf = (stdout: string): string => {
  const b = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  return b.length > 400 ? `sha256:${createHash('sha256').update(b, 'utf8').digest('hex')}` : b;
};
export const statusOf = (r: Run): number => Number(/^http (\d+)$/m.exec(r.stderr)?.[1] ?? -1);

export const DOOR_INS: ReadonlyArray<readonly [keyof Questions, number]> = [['released', 1], ['answeredLate', 3], ['approvalReleased', 1], ['approvalRuled', 4]];

let KEYS: string[] = [];
const live: Array<() => Promise<void>> = [];
/** The spies and the teardown every real-server row needs, registered by the suite that runs the rows. */
export function installRealServerHooks(): void {
  beforeEach(() => {
    KEYS = [];
    vi.spyOn(Tmux.prototype, 'sendKey').mockImplementation(async (id: string, k: string) => { KEYS.push(`${id} ${k}`); return true; });
    vi.spyOn(Tmux.prototype, 'sendLiteral').mockImplementation(async (id: string, t: string) => { KEYS.push(`${id} -l ${t}`); return true; });
  });
  afterEach(async () => {
    for (const c of live.splice(0)) await c();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}

/** The REAL clock in unix seconds: `realServer` fakes `Date` at `NOW`, and the client reads its cap file's lease by
 *  the box's own clock (`EPOCHREALTIME`), so a cap file stamped by the faked `Date` would read as stale. */
const realNowS = (): number => Math.floor((performance.timeOrigin + performance.now()) / 1000);

/** What a real server is built with: the box token unconfigured, and the client the rows run (`ccd/ccrc-api` unless a
 *  suite names another copy, as `claimant-client-skew.test.ts` names the base commit's). */
export interface RealOptions { mailToken?: 'unconfigured'; client?: string }

/** A real server for one row: the standard family, the fixture signing key, the clock at `NOW`, listening on
 *  loopback, a client HOME pointing at it, and the composition's door-ins spied (calling through). The client HOME's
 *  `~/.ccrc/server-caps` is written, current, from the server's own `GET /health` (the words `ccd-update-sync` would
 *  record on a fleet node), so the rows run through whatever door that server advertises (D-7322). `doors` is every
 *  request the server received, method and path. */
export interface Real {
  f: Approvals; home: string; ask: number; approval: number; doorIns: () => string[]; mail0: number;
  doors: () => string[];
  client: (verb: Verb | 'approvals ruling', args: string[], body?: string | null) => Promise<Run>;
}
export async function realServer(o: RealOptions = {}): Promise<Real> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const f = await standardFixture();
  live.push(async () => { await f.close(); });
  fs.writeFileSync(path.join(f.home, '.ccrc', APPROVAL_SIGNING_KEY_FILE), FIXTURE_KEY.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
  await f.restart();
  let app: FastifyInstance = f.app;
  if (o.mailToken === 'unconfigured') {
    app = await buildServer({ ...f.deps, mailToken: undefined }, new Bus(), new FleetWatcher({ ...f.deps, mailToken: undefined }, new Bus(), 10_000));
    live.push(async () => { await app.close(); });
  }
  const calls: string[] = [];
  const q = f.watcher.questions;
  for (const [m, n] of DOOR_INS) {
    const real = (q[m] as (...a: unknown[]) => unknown).bind(q);
    vi.spyOn(q, m).mockImplementation(((...a: unknown[]) => { calls.push(`${m}(${a.slice(0, n).map((x) => json(x)).join(',')})`); return real(...a); }) as never);
  }
  hookstate(f, CHILD, NOW);
  f.panes.set(CHILD, ASK_PANE);
  const ask = f.coord.insertAsk({
    childId: CHILD, parentId: PARENT, runId: f.runId, askKey: ASK_KEY, askAt: NOW, dialogId: 'dlg-1',
    question: QUESTION.question, options: QUESTION.options.map((x) => x.label), now: NOW,
  });
  const raised = await f.request({ ...requestBody(ORDINARY), nonce: NONCE });
  if (raised.statusCode !== 201) throw new Error(`the fixture raise answered ${raised.statusCode}: ${raised.body}`);
  const approval = (raised.json() as { id: number }).id;
  await app.listen({ host: '127.0.0.1', port: 0 });
  const home = mkTmp('claimant-pin-real-');
  live.push(async () => { fs.rmSync(home, { recursive: true, force: true }); });
  writeClientHome(home, `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, TOKEN);
  const health = (await app.inject({ method: 'GET', url: '/health' })).json() as { caps: string[] };
  fs.writeFileSync(path.join(home, '.ccrc', SERVER_CAPS_FILE), renderServerCaps(health.caps, realNowS()));
  const doors: string[] = [];
  app.server.on('request', (req: IncomingMessage) => { doors.push(`${req.method ?? ''} ${req.url ?? ''}`); });
  return {
    f, home, ask, approval, doorIns: () => [...calls], mail0: mailBodiesTo(f, PARENT).length, doors: () => [...doors],
    client: (verb, args, body = null) => {
      const [group, name] = verb.split(' ') as [string, string];
      return runClient(home, [group, name, ...args, ...(body === null ? [] : ['--json', '-'])], body ?? undefined, undefined, o.client);
    },
  };
}

export const askState = (r: Real) => {
  const a = r.f.coord.askById(r.ask);
  return a.ok && a.ask !== null ? { state: a.ask.state, answeredBy: a.ask.answeredBy, answer: a.ask.answer } : null;
};
export const approvalState = (r: Real) => {
  const a = r.f.coord.approvalById(r.approval);
  return a.ok && a.row !== null ? { state: a.row.state, answeredBy: a.row.answeredBy, releaseReason: a.row.releaseReason } : null;
};
export const outcome = (r: Real, run: Run, verb: Verb): Outcome => ({
  status: statusOf(run), body: bodyOf(run.stdout),
  effects: {
    row: verb.startsWith('asks') ? askState(r) : approvalState(r), doorIns: r.doorIns(), keys: [...KEYS],
    mailToParent: mailBodiesTo(r.f, PARENT).length - r.mail0,
  },
});

/** One row: the verb, how the row is set up after the mint, and the call (the id, the body). `id` is the row's own
 *  question id unless a literal is given. */
export type Row = readonly [name: string, verb: Verb, call: { id?: string; body: string | null }, before?: (r: Real) => Promise<void>];
export const ANSWER = (i: number): string => json({ ...P, optionIndexes: [i] });
export const RULE = (verdict: 'allow' | 'deny', extra: Record<string, unknown> = {}): string =>
  json({ ...P, verdict, reason: `${verdict} through the client`, ...extra });
export const REL = json(P);
export const STALE = { fromId: PARENT, fromUuid: 'u-stale' };
export const NOT_PARENT = { fromId: CHILD2, fromUuid: uuidOf(CHILD2) };

export const LADDER: Row[] = [
  ['asks answer | success: pressed, recorded', 'asks answer', { body: ANSWER(1) }],
  ['asks answer | a bad body', 'asks answer', { body: '{}' }],
  ['asks answer | a wrong fromUuid is refused, nothing pressed', 'asks answer', { body: json({ ...STALE, optionIndexes: [0] }) }],
  ['asks answer | a bad id: 01', 'asks answer', { id: '01', body: ANSWER(0) }],
  ['asks answer | a bad id: abc', 'asks answer', { id: 'abc', body: ANSWER(0) }],
  ['asks answer | an unknown id', 'asks answer', { id: '99', body: ANSWER(0) }],
  ['asks answer | not the parent', 'asks answer', { body: json({ ...NOT_PARENT, optionIndexes: [0] }) }],
  ['asks answer | declined after a release', 'asks answer', { body: ANSWER(0) },
    async (r) => { await r.client('asks release', [String(r.ask)], REL); }],
  ['asks answer | already answered', 'asks answer', { body: ANSWER(0) },
    async (r) => { await r.client('asks answer', [String(r.ask)], ANSWER(1)); }],
  ['asks release | success: declined, the door-in fires', 'asks release', { body: REL }],
  ['asks release | a bad body', 'asks release', { body: '{}' }],
  ['asks release | a wrong fromUuid', 'asks release', { body: json(STALE) }],
  ['asks release | a bad id: 01', 'asks release', { id: '01', body: REL }],
  ['asks release | a bad id: abc', 'asks release', { id: 'abc', body: REL }],
  ['asks release | an unknown id', 'asks release', { id: '99', body: REL }],
  ['asks release | not the parent', 'asks release', { body: json(NOT_PARENT) }],
  ['asks release | declined after a release', 'asks release', { body: REL },
    async (r) => { await r.client('asks release', [String(r.ask)], REL); }],
  ['asks release | already answered', 'asks release', { body: REL },
    async (r) => { await r.client('asks answer', [String(r.ask)], ANSWER(1)); }],
  ['approvals rule | success: allowed, signed, recorded', 'approvals rule', { body: RULE('allow') }],
  ['approvals rule | success: denied, signed, recorded', 'approvals rule', { body: RULE('deny') }],
  ['approvals rule | a bad body', 'approvals rule', { body: '{}' }],
  ['approvals rule | a wrong fromUuid', 'approvals rule', { body: json({ ...STALE, verdict: 'allow', reason: 'r' }) }],
  ['approvals rule | a bad id: 01', 'approvals rule', { id: '01', body: RULE('allow') }],
  ['approvals rule | a bad id: abc', 'approvals rule', { id: 'abc', body: RULE('allow') }],
  ['approvals rule | an unknown id', 'approvals rule', { id: '99', body: RULE('allow') }],
  ['approvals rule | not the parent', 'approvals rule', { body: json({ ...NOT_PARENT, verdict: 'allow', reason: 'r' }) }],
  ['approvals rule | declined after a release', 'approvals rule', { body: RULE('allow') },
    async (r) => { await r.client('approvals release', [String(r.approval)], REL); }],
  ['approvals rule | already ruled', 'approvals rule', { body: RULE('allow') },
    async (r) => { await r.client('approvals rule', [String(r.approval)], RULE('deny')); }],
  ['approvals rule | permanent is bad-request, nothing signed', 'approvals rule', { body: RULE('allow', { permanent: true }) }],
  ['approvals release | success: declined, the door-in fires', 'approvals release', { body: REL }],
  ['approvals release | a bad body', 'approvals release', { body: '{}' }],
  ['approvals release | a wrong fromUuid', 'approvals release', { body: json(STALE) }],
  ['approvals release | a bad id: 01', 'approvals release', { id: '01', body: REL }],
  ['approvals release | a bad id: abc', 'approvals release', { id: 'abc', body: REL }],
  ['approvals release | an unknown id', 'approvals release', { id: '99', body: REL }],
  ['approvals release | not the parent', 'approvals release', { body: json(NOT_PARENT) }],
  ['approvals release | declined after a release', 'approvals release', { body: REL },
    async (r) => { await r.client('approvals release', [String(r.approval)], REL); }],
  ['approvals release | already ruled', 'approvals release', { body: REL },
    async (r) => { await r.client('approvals rule', [String(r.approval)], RULE('deny')); }],
];

/** (d) The named-difference rows (D-7325), as the base answers them. */
export const DIFFERENCE: Row[] = [
  ['difference | asks answer | the mailed body with "kind":"approval"', 'asks answer', { body: withKind(ANSWER(0), 'approval') }],
  ['difference | asks answer | a body well formed for an approval', 'asks answer', { body: json({ ...P, kind: 'approval', verdict: 'allow', reason: 'r' }) }],
  ['difference | asks release | the mailed body with "kind":"approval"', 'asks release', { body: withKind(REL, 'approval') }],
  ['difference | approvals rule | the mailed body with "kind":"ask"', 'approvals rule', { body: withKind(RULE('allow'), 'ask') }],
  ['difference | approvals release | the mailed body with "kind":"ask"', 'approvals release', { body: withKind(REL, 'ask') }],
  ...VERBS.map((v) => [`difference | ${v} | a non-object body`, v, { body: '[]' }] as const),
];

export const EXPECTED: Record<string, Outcome> = {
  "asks answer | success: pressed, recorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Blue"}, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "mailToParent": 0}},
  "asks answer | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | a wrong fromUuid is refused, nothing pressed":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | a bad id: 01":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | a bad id: abc":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | an unknown id":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-ask\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | not the parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may pre-empt its question\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | declined after a release":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"declined\"}", "effects": {"row": {"state": "declined", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks answer | already answered":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"already-answered\"}", "effects": {"row": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Blue"}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | success: declined, the door-in fires":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "declined", "answeredBy": null, "answer": null}, "doorIns": ["released(\"project-a-quiet-basin\")"], "keys": [], "mailToParent": 0}},
  "asks release | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | a wrong fromUuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | a bad id: 01":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | a bad id: abc":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | an unknown id":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-ask\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | not the parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may decline its question\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | declined after a release":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "declined", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "asks release | already answered":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Blue"}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | success: allowed, signed, recorded":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"allowed\"}", "effects": {"row": {"state": "allowed", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"allow\")"], "keys": [], "mailToParent": 0}},
  "approvals rule | success: denied, signed, recorded":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"denied\"}", "effects": {"row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "keys": [], "mailToParent": 0}},
  "approvals rule | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | a wrong fromUuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | a bad id: 01":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | a bad id: abc":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | an unknown id":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-approval\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | not the parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only the claimant this prompt was held for may rule on it\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | declined after a release":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"declined\"}", "effects": {"row": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | already ruled":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"already-ruled\"}", "effects": {"row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals rule | permanent is bad-request, nothing signed":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"a ruling allows once only; permanent is never accepted\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | success: declined, the door-in fires":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalReleased(\"project-a-quiet-basin\")"], "keys": [], "mailToParent": 0}},
  "approvals release | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | a wrong fromUuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | a bad id: 01":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | a bad id: abc":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | an unknown id":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-approval\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | not the parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only the claimant this prompt was held for may hand it over\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | declined after a release":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "approvals release | already ruled":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | asks answer | the mailed body with \"kind\":\"approval\"":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Red"}, "doorIns": [], "keys": ["project-a-quiet-basin 1"], "mailToParent": 0}},
  "difference | asks answer | a body well formed for an approval":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | asks release | the mailed body with \"kind\":\"approval\"":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "declined", "answeredBy": null, "answer": null}, "doorIns": ["released(\"project-a-quiet-basin\")"], "keys": [], "mailToParent": 0}},
  "difference | approvals rule | the mailed body with \"kind\":\"ask\"":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"allowed\"}", "effects": {"row": {"state": "allowed", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"allow\")"], "keys": [], "mailToParent": 0}},
  "difference | approvals release | the mailed body with \"kind\":\"ask\"":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalReleased(\"project-a-quiet-basin\")"], "keys": [], "mailToParent": 0}},
  "difference | asks answer | a non-object body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | asks release | a non-object body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | approvals rule | a non-object body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | approvals release | a non-object body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | asks answer | the box token unconfigured":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token is configured on this server — POST /api/asks/:id/answer fails shut on an unconfigured token, it does not fail open\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | asks release | the box token unconfigured":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token is configured on this server — POST /api/asks/:id/release fails shut on an unconfigured token, it does not fail open\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | approvals rule | the box token unconfigured":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token is configured on this server — POST /api/approvals/:id/rule fails shut on an unconfigured token, it does not fail open\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
  "difference | approvals release | the box token unconfigured":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token is configured on this server — POST /api/approvals/:id/release fails shut on an unconfigured token, it does not fail open\"}", "effects": {"row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "mailToParent": 0}},
};

/** MOVED here from `claimant-client-pin.test.ts` (K5 Q3l), never copied, so the skew suite reads the same table.
 *  The family's own answers to the named-difference rows (D-7325), MEASURED through the family: the unconfigured box
 *  token's detail names the family's route; a contrary kind is read by the family's ladder for that kind (on `rule`
 *  the body's kind picks the arm before attribution and the id check, so the mailed body with the contrary kind is the
 *  other arm's `bad-request`, and only a body well formed for the contrary kind reaches `kind-mismatch`; on `release`,
 *  `kind-mismatch`); a non-object body is refused by the client (`bad-body`, exit 2, no response: status -1). Every
 *  other cell is `EXPECTED`'s, the base's, unedited. */
export const HELD_ASK = { state: 'held', answeredBy: null, answer: null };
export const HELD_APPROVAL = { state: 'held', answeredBy: null, releaseReason: null };
export const NOTHING = { doorIns: [], keys: [], mailToParent: 0 };
export const CLIENT_BAD_BODY = '{"ok":false,"error":"bad-body","detail":"the body is not a JSON object; kind cannot be added"}';
export const unconfigured = (route: string): string =>
  `{"ok":false,"error":"unauthenticated","detail":"no box token is configured on this server — ${route} fails shut on an unconfigured token, it does not fail open"}`;
export const FAMILY_DIFFERENCE: Record<string, Outcome> = {
  'difference | asks answer | the mailed body with "kind":"approval"':
    { status: 400, body: '{"ok":false,"error":"bad-request","detail":"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters"}', effects: { row: HELD_ASK, ...NOTHING } },
  'difference | asks answer | a body well formed for an approval':
    { status: 400, body: '{"ok":false,"error":"kind-mismatch"}', effects: { row: HELD_ASK, ...NOTHING } },
  'difference | asks release | the mailed body with "kind":"approval"':
    { status: 400, body: '{"ok":false,"error":"kind-mismatch"}', effects: { row: HELD_ASK, ...NOTHING } },
  'difference | approvals rule | the mailed body with "kind":"ask"':
    { status: 400, body: '{"ok":false,"error":"bad-request","detail":"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given"}', effects: { row: HELD_APPROVAL, ...NOTHING } },
  'difference | approvals release | the mailed body with "kind":"ask"':
    { status: 400, body: '{"ok":false,"error":"kind-mismatch"}', effects: { row: HELD_APPROVAL, ...NOTHING } },
  'difference | asks answer | a non-object body': { status: -1, body: CLIENT_BAD_BODY, effects: { row: HELD_ASK, ...NOTHING } },
  'difference | asks release | a non-object body': { status: -1, body: CLIENT_BAD_BODY, effects: { row: HELD_ASK, ...NOTHING } },
  'difference | approvals rule | a non-object body': { status: -1, body: CLIENT_BAD_BODY, effects: { row: HELD_APPROVAL, ...NOTHING } },
  'difference | approvals release | a non-object body': { status: -1, body: CLIENT_BAD_BODY, effects: { row: HELD_APPROVAL, ...NOTHING } },
  'difference | asks answer | the box token unconfigured':
    { status: 401, body: unconfigured('POST /api/questions/:id/rule'), effects: { row: HELD_ASK, ...NOTHING } },
  'difference | asks release | the box token unconfigured':
    { status: 401, body: unconfigured('POST /api/questions/:id/release'), effects: { row: HELD_ASK, ...NOTHING } },
  'difference | approvals rule | the box token unconfigured':
    { status: 401, body: unconfigured('POST /api/questions/:id/rule'), effects: { row: HELD_APPROVAL, ...NOTHING } },
  'difference | approvals release | the box token unconfigured':
    { status: 401, body: unconfigured('POST /api/questions/:id/release'), effects: { row: HELD_APPROVAL, ...NOTHING } },
};
/** The table the family answers: the base's, with the named differences and nothing else. */
export const THROUGH_FAMILY: Record<string, Outcome> = { ...EXPECTED, ...FAMILY_DIFFERENCE };

/** The requests the last `runRow` call's own call sent (its `before` setup excluded): method and path. */
let lastDoors: string[] = [];
export const lastRunDoors = (): string[] => [...lastDoors];

export const runRow = async ([name, verb, call, before]: Row, o: RealOptions = {}): Promise<Outcome> => {
  const r = await realServer(o);
  await before?.(r);
  KEYS = [];
  const id = call.id ?? String(verb.startsWith('asks') ? r.ask : r.approval);
  const mail0 = mailBodiesTo(r.f, PARENT).length;
  const doorIns0 = r.doorIns().length;
  const doors0 = r.doors().length;
  const run = await r.client(verb, [id], call.body);
  lastDoors = r.doors().slice(doors0);
  const out = outcome(r, run, verb);
  out.effects['doorIns'] = r.doorIns().slice(doorIns0);
  out.effects['mailToParent'] = mailBodiesTo(r.f, PARENT).length - mail0;
  return out;
};
