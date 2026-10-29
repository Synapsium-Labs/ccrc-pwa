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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { approvalRulingBytes, renderServerCaps, SERVER_CAPS, type ApprovalRulingRecord } from '../../shared/api.js';
import { verdictFor } from '../../ccd/approval-verify.mjs';
import { CCRC_API } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { CHILD, PARENT, requestBody, standardFixture, TOKEN, uuidOf } from './approvalsHarness.js';
import { mkTmp } from './tmpHelpers.js';
import {
  ANSWER, ASK_PANE, bodyOf, DIFFERENCE, EXPECTED, hookstate, installRealServerHooks, json, LADDER, mailBodiesTo, NONCE,
  NOW, ORDINARY, P, realServer, REL, RULE, runRow, statusOf, type Verb, VERBS, withKind,
} from './claimantClientFixture.js';

/** The old door each verb sends on this base. */
const OLD_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/asks/${id}/answer`,
  'asks release': (id) => `/api/asks/${id}/release`,
  'approvals rule': (id) => `/api/approvals/${id}/rule`,
  'approvals release': (id) => `/api/approvals/${id}/release`,
};

// ── The mailed commands, read off the mail a real server sends ────────────────────────────────────────────────────

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

installRealServerHooks();

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

