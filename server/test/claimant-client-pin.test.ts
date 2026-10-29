// The claimant client's characterization pin (D-7320; K5 tail, Task Q3h; plan
// 2026-10-29-consolidation-k5-claimant-doors.md; spec 2026-10-19 §5.1 rules 1 and 3). The four claimant verbs
// `ccd/ccrc-api` runs, `asks answer`, `asks release`, `approvals rule` and `approvals release`, run for real, in a
// fixture HOME (`ccrcApiClient.ts`: the HOME, the contained PATH with its `tmux` stub, the token document and
// `agent.env` that `ccrc-api.test.ts` builds), against two servers:
//
//   (a) A RECORDING SERVER: for each verb, each state of `~/.ccrc/server-caps` in the fixture HOME, and each body,
//       what the client sent (method, path, content-type, whether the box token rode, the body bytes). On this base
//       every state sends the old door and the caller's body unchanged; Q3j's behaviour commit flips the path while
//       `questions-v1` is advertised and current, and only then. The bodies are the server's mailed commands, RUN as
//       mailed (the briefs `renderAskBrief` and `renderApprovalBrief` print, read off the mail a real server sends),
//       `{}`, no `--json` at all, each verb's mailed body with the contrary top-level `kind`, an approval-shaped body
//       on `asks answer`, and a non-object body. No FIFO at the path: the cap reader blocks on one (D-7339).
//   (b) A REAL `buildServer` (`approvalsHarness.ts`'s standard family, the fixture signing key, a fixed clock): per
//       verb, the outcome of the success arm and each front-ladder refusal a caller of the client can reach (status,
//       body bytes, the row after, the door-ins called, keys pressed, mail to the parent). On this base they run
//       through the old doors.
//   (c) THE SIGNED RULING, END TO END: an allow ruled through `approvals rule` with a reason padded by one space at
//       each end, fetched with `approvals ruling`, its canonical record bytes and signature held as literals, and
//       `ccd/approval-verify.mjs`'s `verdictFor` accepting it under the fixture public key.
//   (d) THE NAMED-DIFFERENCE ROWS (D-7325), recorded as the base answers them: the unconfigured box token's detail,
//       the five contrary-kind bodies, and the non-object body. MEASURED, not assumed: the old doors ignore a
//       contrary `kind` (an ask body with `"kind":"approval"` is pressed and recorded; an approval-shaped body on
//       `asks answer` is the ask ladder's `bad-request`), and `[]` is valid JSON, so fastify parses it and the route's
//       own body check answers `bad-request` with its detail; no fastify parse refusal is reached.
//
// Neutral ids only (`approvalsHarness.ts`'s). Nothing here touches the live HOME or a live server.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createHash, createPrivateKey } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
import { APPROVAL_SIGNING_KEY_FILE, approvalRulingBytes, renderServerCaps, SERVER_CAPS, type ApprovalRulingRecord } from '../../shared/api.js';
import { verdictFor } from '../../ccd/approval-verify.mjs';
import { CCRC_API } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import {
  CHILD, CHILD2, hookInput, PARENT, requestBody, standardFixture, TOKEN, uuidOf, type Approvals,
} from './approvalsHarness.js';
import { mkTmp } from './tmpHelpers.js';

const P = { fromId: PARENT, fromUuid: uuidOf(PARENT) };
const json = (o: unknown): string => JSON.stringify(o);

/** The four verbs, and the old door each sends on this base. */
type Verb = 'asks answer' | 'asks release' | 'approvals rule' | 'approvals release';
const VERBS: readonly Verb[] = ['asks answer', 'asks release', 'approvals rule', 'approvals release'];
const OLD_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/asks/${id}/answer`,
  'asks release': (id) => `/api/asks/${id}/release`,
  'approvals rule': (id) => `/api/approvals/${id}/rule`,
  'approvals release': (id) => `/api/approvals/${id}/release`,
};

// ── The mailed commands, read off the mail a real server sends ────────────────────────────────────────────────────

const QUESTION = { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] };
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
const ORDINARY = hookInput({ command: 'rm -rf build' });

/** A waiting hookstate for `id` carrying `QUESTION` at `updatedAt` (the stamp the take re-measures). `event: null`
 *  leaves the field out, as an AskUserQuestion's wait writes it, which is what the hold mints an ask row for. */
const hookstate = (f: Approvals, id: string, updatedAt: number, o: { event?: null } = {}): void => {
  fs.writeFileSync(path.join(f.home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', ...(o.event === null ? {} : { event: 'PermissionRequest' }), sessionId: uuidOf(id), pid: 4242, updatedAt,
    ask: { questions: [QUESTION] }, subagents: [],
  }));
};

const mailBodiesTo = (f: Approvals, to: string): string[] =>
  (f.coord.db.prepare('SELECT m.body AS body FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE d.toId = ? ORDER BY m.id')
    .all(to) as { body: string }[]).map((r) => r.body);

/** One mailed command block, as the brief prints it, with the verb and the id it names. */
interface Mailed { verb: Verb; id: string; block: string }

const ASK_BLOCK = /^"\$API" (asks (?:answer|release)) (\d+) --json - <<JSON\n[^\n]*\nJSON$/gm;
const APPROVAL_RULE_BLOCK = /^IFS= read -r reason <<'REASON'\n[^\n]*\nREASON\njq [^\n]*\|\n {2}"\$API" (approvals rule) (\d+) --json -$/gm;
const APPROVAL_RELEASE_BLOCK = /^"\$API" (approvals release) (\d+) --json - <<JSON\n[^\n]*\nJSON$/gm;

/** The ask brief (minted by the hold on a watcher tick) and the approval brief (minted by the raise), as mailed. */
async function mailedBlocks(): Promise<Mailed[]> {
  const f = await standardFixture();
  try {
    await f.watcher.tick();                                   // priming
    hookstate(f, CHILD, Date.now(), { event: null });
    f.panes.set(CHILD, ASK_PANE);
    await f.watcher.tick();                                   // the hold mints the ask and mails the brief
    const raised = await f.request(requestBody(ORDINARY));
    if (raised.statusCode !== 201) throw new Error(`the fixture raise answered ${raised.statusCode}`);
    const out: Mailed[] = [];
    for (const body of mailBodiesTo(f, PARENT)) {
      for (const re of [ASK_BLOCK, APPROVAL_RULE_BLOCK, APPROVAL_RELEASE_BLOCK]) {
        for (const m of body.matchAll(re)) out.push({ verb: m[1] as Verb, id: m[2]!, block: m[0] });
      }
    }
    return out;
  } finally {
    await f.close();
  }
}

/** The body each mailed block sends, after the shell expands it with the fixture parent's `$id` and `$uuid`. */
const W = `"fromId":"${PARENT}","fromUuid":"${uuidOf(PARENT)}"`;
const MAILED_BODIES: Record<Verb, readonly string[]> = {
  'asks answer': [`{${W},"optionIndexes":[0]}`, `{${W},"optionIndexes":[1]}`],
  'asks release': [`{${W}}`],
  'approvals rule': [`{${W},"verdict":"allow","reason":"<one line, in plain words>"}`, `{${W},"verdict":"deny","reason":"<one line, in plain words>"}`],
  'approvals release': [`{${W}}`],
};

/** A fixed driver: `API`, `id` and `uuid` set as the coordinator skill's preamble sets them, then the mailed block,
 *  read from a file, run as written. Paths and values reach it as arguments, never inside a `bash -c` string. */
const DRIVER = '#!/usr/bin/env bash\nset -u\nAPI="$1"; id="$2"; uuid="$3"\n. "$4"\n';

// ── (a) the recording server ──────────────────────────────────────────────────────────────────────────────────────

interface Sent { method: string; path: string; contentType: string | null; token: boolean; body: string }

/** Each state the fixture HOME's `~/.ccrc/server-caps` is put in. Never a FIFO (D-7339). */
type CapState = 'absent' | 'current, lists questions-v1' | 'current, omits questions-v1' | 'stale by 181 s'
  | '`at` in the future' | 'torn to two lines' | 'a directory';
const CAP_STATES: readonly CapState[] = ['absent', 'current, lists questions-v1', 'current, omits questions-v1', 'stale by 181 s',
  '`at` in the future', 'torn to two lines', 'a directory'];
const capFile = (home: string): string => path.join(home, '.ccrc', 'server-caps');
const putCaps = (home: string, state: CapState): void => {
  const p = capFile(home);
  fs.rmSync(p, { recursive: true, force: true });
  const nowS = Math.floor(Date.now() / 1000);
  const others = SERVER_CAPS.filter((w) => w !== 'questions-v1');
  switch (state) {
    case 'absent': return;
    case 'current, lists questions-v1': fs.writeFileSync(p, renderServerCaps(SERVER_CAPS, nowS)); return;
    case 'current, omits questions-v1': fs.writeFileSync(p, renderServerCaps(others, nowS)); return;
    case 'stale by 181 s': fs.writeFileSync(p, renderServerCaps(SERVER_CAPS, nowS - 181)); return;
    case '`at` in the future': fs.writeFileSync(p, renderServerCaps(SERVER_CAPS, nowS + 60)); return;
    case 'torn to two lines': fs.writeFileSync(p, renderServerCaps(SERVER_CAPS, nowS).split('\n').slice(0, 2).join('\n') + '\n'); return;
    case 'a directory': fs.mkdirSync(p); return;
  }
};

/** A body with `"kind":<kind>` added as its last top-level key. */
const withKind = (body: string, kind: string): string => `${body.slice(0, -1)},"kind":"${kind}"}`;
const CONTRARY: Record<Verb, string> = {
  'asks answer': 'approval', 'asks release': 'approval', 'approvals rule': 'ask', 'approvals release': 'ask',
};
/** The bodies each verb is run with besides the mailed blocks: `null` is no `--json` at all. */
const bodiesFor = (verb: Verb): ReadonlyArray<readonly [string, string | null]> => [
  ['{}', '{}'],
  ['no --json', null],
  [`the mailed body with "kind":"${CONTRARY[verb]}"`, withKind(MAILED_BODIES[verb][0]!, CONTRARY[verb])],
  ...(verb === 'asks answer'
    ? [['a body well formed for an approval', json({ ...P, kind: 'approval', verdict: 'allow', reason: 'r' })] as const] : []),
  ['a non-object body', '[]'],
];

describe('(a) what the four verbs send, per cap-file state (the base sends the old door, the body unchanged)', () => {
  let home = '';
  let scratch = '';
  let server: Server;
  let seen: Sent[] = [];
  let mailed: Mailed[] = [];
  beforeAll(async () => {
    mailed = await mailedBlocks();
    scratch = mkTmp('claimant-pin-driver-');
    fs.writeFileSync(path.join(scratch, 'driver'), DRIVER, { mode: 0o755 });
  });
  afterAll(() => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });
  beforeEach(async () => {
    home = mkTmp('claimant-pin-home-');
    seen = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({
          method: req.method ?? '', path: req.url ?? '', contentType: (req.headers['content-type'] as string | undefined) ?? null,
          token: req.headers['x-ccrc-mail-token'] === TOKEN, body,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
  });
  afterEach(async () => {
    await new Promise<void>((r) => { server.close(() => r()); });
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** The one request a run sent, or a failure naming what the client printed. */
  const one = (r: Run, what: string): Sent => {
    expect(r.status, `${what}: ${r.stdout}${r.stderr}`).toBe(0);
    expect(seen, `${what}: one request`).toHaveLength(1);
    const s = seen[0]!;
    seen = [];
    return s;
  };
  const sentAs = (verb: Verb, id: string, body: string | null): Sent => ({
    method: 'POST', path: OLD_DOOR[verb](id), contentType: body === null ? null : 'application/json', token: true, body: body ?? '',
  });

  it('the mailed briefs carry the blocks this pin runs: two answers and a release per ask, an allow, a deny and a release per approval', () => {
    expect(mailed.map((m) => `${m.verb} ${m.id}`)).toEqual([
      'asks answer 1', 'asks answer 1', 'asks release 1', 'approvals rule 1', 'approvals rule 1', 'approvals release 1',
    ]);
  });

  it('each mailed body reaches the server byte for byte, in every cap state', async () => {
    const driver = path.join(scratch, 'driver');
    for (const state of CAP_STATES) {
      putCaps(home, state);
      const seenBodies: Partial<Record<Verb, string[]>> = {};
      for (const [i, m] of mailed.entries()) {
        const block = path.join(scratch, `block-${i}`);
        fs.writeFileSync(block, `${m.block}\n`);
        const s = one(await runClient(home, [CCRC_API, PARENT, uuidOf(PARENT), block], undefined, undefined, driver), `${state} | ${m.verb}`);
        (seenBodies[m.verb] ??= []).push(s.body);
        expect(s, `${state} | ${m.verb}`).toEqual(sentAs(m.verb, m.id, s.body));
      }
      expect(seenBodies, state).toEqual(MAILED_BODIES);
    }
  });

  it.each(VERBS.map((v) => [v, OLD_DOOR[v]('<n>')] as const))('%s sends POST %s, in every cap state', async (verb) => {
    const [group, name] = verb.split(' ') as [string, string];
    for (const state of CAP_STATES) {
      putCaps(home, state);
      for (const [label, body] of [...MAILED_BODIES[verb].map((b, i) => [`mailed body ${i}`, b] as const), ...bodiesFor(verb)]) {
        const args = body === null ? [group, name, '7'] : [group, name, '7', '--json', '-'];
        const s = one(await runClient(home, args, body ?? undefined), `${state} | ${label}`);
        expect(s, `${state} | ${label}`).toEqual(sentAs(verb, '7', body));
      }
    }
  });
});

// ── (b), (c), (d): a real server ──────────────────────────────────────────────────────────────────────────────────

/** The fixed clock, and the fixture signing key from a fixed, public 32-byte seed (Ed25519 signs deterministically),
 *  derived as `approval-signing-pin.test.ts` derives it. It signs nothing real: no box pins its public half. */
const NOW = 1_760_000_000_000;
const SEED = Buffer.alloc(32, 0x5a);
const FIXTURE_KEY = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]), format: 'der', type: 'pkcs8',
});
const NONCE = '0123456789abcdef0123456789abcdef';

interface Outcome { status: number; body: string; effects: Record<string, unknown> }
/** The client's stdout is the body and one newline; over 400 characters it is held by its SHA-256, as
 *  `question-doors.test.ts#bodyOf` holds a response. */
const bodyOf = (stdout: string): string => {
  const b = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  return b.length > 400 ? `sha256:${createHash('sha256').update(b, 'utf8').digest('hex')}` : b;
};
const statusOf = (r: Run): number => Number(/^http (\d+)$/m.exec(r.stderr)?.[1] ?? -1);

const DOOR_INS: ReadonlyArray<readonly [keyof Questions, number]> = [['released', 1], ['answeredLate', 3], ['approvalReleased', 1], ['approvalRuled', 4]];

let KEYS: string[] = [];
const live: Array<() => Promise<void>> = [];
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

/** A real server for one row: the standard family, the fixture signing key, the clock at `NOW`, listening on
 *  loopback, a client HOME pointing at it, and the composition's door-ins spied (calling through). */
interface Real {
  f: Approvals; home: string; ask: number; approval: number; doorIns: () => string[]; mail0: number;
  client: (verb: Verb | 'approvals ruling', args: string[], body?: string | null) => Promise<Run>;
}
async function realServer(o: { mailToken?: 'unconfigured' } = {}): Promise<Real> {
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
  return {
    f, home, ask, approval, doorIns: () => [...calls], mail0: mailBodiesTo(f, PARENT).length,
    client: (verb, args, body = null) => {
      const [group, name] = verb.split(' ') as [string, string];
      return runClient(home, [group, name, ...args, ...(body === null ? [] : ['--json', '-'])], body ?? undefined);
    },
  };
}

const askState = (r: Real) => {
  const a = r.f.coord.askById(r.ask);
  return a.ok && a.ask !== null ? { state: a.ask.state, answeredBy: a.ask.answeredBy, answer: a.ask.answer } : null;
};
const approvalState = (r: Real) => {
  const a = r.f.coord.approvalById(r.approval);
  return a.ok && a.row !== null ? { state: a.row.state, answeredBy: a.row.answeredBy, releaseReason: a.row.releaseReason } : null;
};
const outcome = (r: Real, run: Run, verb: Verb): Outcome => ({
  status: statusOf(run), body: bodyOf(run.stdout),
  effects: {
    row: verb.startsWith('asks') ? askState(r) : approvalState(r), doorIns: r.doorIns(), keys: [...KEYS],
    mailToParent: mailBodiesTo(r.f, PARENT).length - r.mail0,
  },
});

/** One row: the verb, how the row is set up after the mint, and the call (the id, the body). `id` is the row's own
 *  question id unless a literal is given. */
type Row = readonly [name: string, verb: Verb, call: { id?: string; body: string | null }, before?: (r: Real) => Promise<void>];
const ANSWER = (i: number): string => json({ ...P, optionIndexes: [i] });
const RULE = (verdict: 'allow' | 'deny', extra: Record<string, unknown> = {}): string =>
  json({ ...P, verdict, reason: `${verdict} through the client`, ...extra });
const REL = json(P);
const STALE = { fromId: PARENT, fromUuid: 'u-stale' };
const NOT_PARENT = { fromId: CHILD2, fromUuid: uuidOf(CHILD2) };

const LADDER: Row[] = [
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
const DIFFERENCE: Row[] = [
  ['difference | asks answer | the mailed body with "kind":"approval"', 'asks answer', { body: withKind(ANSWER(0), 'approval') }],
  ['difference | asks answer | a body well formed for an approval', 'asks answer', { body: json({ ...P, kind: 'approval', verdict: 'allow', reason: 'r' }) }],
  ['difference | asks release | the mailed body with "kind":"approval"', 'asks release', { body: withKind(REL, 'approval') }],
  ['difference | approvals rule | the mailed body with "kind":"ask"', 'approvals rule', { body: withKind(RULE('allow'), 'ask') }],
  ['difference | approvals release | the mailed body with "kind":"ask"', 'approvals release', { body: withKind(REL, 'ask') }],
  ...VERBS.map((v) => [`difference | ${v} | a non-object body`, v, { body: '[]' }] as const),
];

const EXPECTED: Record<string, Outcome> = {
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

const runRow = async ([name, verb, call, before]: Row, o: { mailToken?: 'unconfigured' } = {}): Promise<Outcome> => {
  const r = await realServer(o);
  await before?.(r);
  KEYS = [];
  const id = call.id ?? String(verb.startsWith('asks') ? r.ask : r.approval);
  const mail0 = mailBodiesTo(r.f, PARENT).length;
  const doorIns0 = r.doorIns().length;
  const run = await r.client(verb, [id], call.body);
  const out = outcome(r, run, verb);
  out.effects['doorIns'] = r.doorIns().slice(doorIns0);
  out.effects['mailToParent'] = mailBodiesTo(r.f, PARENT).length - mail0;
  return out;
};

describe('(b) what a real server answers each verb, through the old doors on this base', () => {
  it('the rows are uniquely named, and every row has an expectation', () => {
    const names = [...LADDER, ...DIFFERENCE].map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(EXPECTED).sort()).toEqual([...names, ...VERBS.map((v) => `difference | ${v} | the box token unconfigured`)].sort());
  });
  it.each(LADDER.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    expect(await runRow(row)).toEqual(EXPECTED[row[0]]);
  });
});

describe('(d) the named-difference rows, recorded as the base answers them (D-7325)', () => {
  it.each(DIFFERENCE.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    expect(await runRow(row)).toEqual(EXPECTED[row[0]]);
  });
  it.each(VERBS.map((v) => [`difference | ${v} | the box token unconfigured`, v] as const))('%s', async (name, verb) => {
    const body = verb === 'asks answer' ? ANSWER(0) : verb === 'approvals rule' ? RULE('allow') : REL;
    expect(await runRow([name, verb, { body }], { mailToken: 'unconfigured' })).toEqual(EXPECTED[name]);
  });
});

// ── (c) the signed ruling, end to end ─────────────────────────────────────────────────────────────────────────────

/** The reason the row rules with, one space at each end: both doors check it only with `trim() === ''` and the length
 *  cap and pass it on as sent, so the spaces reach the signed record. */
const PADDED_REASON = ' a cleanup inside your worktree ';
const RULING_RECORD_BYTES = '{"agentId":"","class":"ordinary","digest":"bfa51fffa8a70e8ee52fd68c63a0b6778bb6e12aeaafd4dbdafdb5bea44d3758","expiresAt":1760000060000,"nonce":"0123456789abcdef0123456789abcdef","reason":" a cleanup inside your worktree ","rowId":1,"sessionId":"project-a-quiet-basin","v":1,"verdict":"allow"}';
const RULING_SIG = 'qC/0I+dSlhgCTh9PZgB6PTOhp+oY0cFDISvuRlL+lHF81J63X/kXzcEVIUHFc6oP8mRcvOpuyVq3tq3h65f2Dg==';

describe('(c) the signed ruling, end to end', () => {
  it('the signed ruling\'s record bytes and signature are the fixture\'s', async () => {
    const r = await realServer();
    const ruled = await r.client('approvals rule', [String(r.approval)], json({ ...P, verdict: 'allow', reason: PADDED_REASON }));
    expect([statusOf(ruled), bodyOf(ruled.stdout)]).toEqual([200, '{"ok":true,"state":"allowed"}']);
    const got = await runClient(r.home, ['approvals', 'ruling', String(r.approval), '--nonce', NONCE]);
    expect(statusOf(got), got.stdout).toBe(200);
    const answer = JSON.parse(got.stdout) as { state: string; ruling: { record: ApprovalRulingRecord; sig: string } };
    expect(answer.state).toBe('allowed');
    expect(approvalRulingBytes(answer.ruling.record)).toBe(RULING_RECORD_BYTES);
    expect(answer.ruling.sig).toBe(RULING_SIG);
    const key = await runClient(r.home, ['approvals', 'key']);
    const pub = (JSON.parse(key.stdout) as { publicKey: string }).publicKey;
    const expected = {
      sessionId: CHILD, agentId: '', digest: answer.ruling.record.digest, nonce: NONCE, rowId: r.approval, now: NOW,
    };
    expect(verdictFor(answer.ruling, expected, pub)).toBe(`allow ${PADDED_REASON}`);
  });
});

