// The claimant client's characterization pin (D-7320, D-7322; K5 tail, Tasks Q3h and Q3j; plan
// 2026-10-29-consolidation-k5-claimant-doors.md; spec 2026-10-19 §5.1 rules 1 and 3). The four claimant verbs
// `ccd/ccrc-api` runs, `asks answer`, `asks release`, `approvals rule` and `approvals release`, run for real, in a
// fixture HOME (`ccrcApiClient.ts`: the HOME, the contained PATH with its `tmux` stub, the token document and
// `agent.env` that `ccrc-api.test.ts` builds), against two servers:
//
//   (a) A RECORDING SERVER: for each verb, each state of `~/.ccrc/server-caps` in the fixture HOME, and each body,
//       what the client sent (method, path, content-type, whether the box token rode, the body bytes). On Q3h's base
//       every state sent the old door and the caller's body unchanged; since Q3j's behaviour commit the state
//       "current, lists questions-v1", and only that state, sends the family's door with the row's `kind` spliced
//       first (a body naming `"kind":` left alone, no body sent as the kind alone, a non-object body refused by the
//       client and nothing sent). The bodies are the server's mailed commands, RUN as
//       mailed (the briefs `renderAskBrief` and `renderApprovalBrief` print, read off the mail a real server sends),
//       `{}`, no `--json` at all, each verb's mailed body with the contrary top-level `kind`, an approval-shaped body
//       on `asks answer`, and a non-object body. No FIFO at the path: the cap reader blocks on one (D-7339).
//   (b) A REAL `buildServer` (`approvalsHarness.ts`'s standard family, the fixture signing key, a fixed clock): per
//       verb, the outcome of the success arm and each front-ladder refusal a caller of the client can reach (status,
//       body bytes, the row after, the door-ins called, keys pressed, mail to the parent). The rows and their table
//       live in `claimantClientFixture.ts` (moved, so the skew suite reads the same table). The client HOME's cap file
//       is written from the server's own `/health`, so since Q3j they run through the family, and every outcome cell
//       is the base's except the named-difference rows of (d).
//   (c) THE SIGNED RULING, END TO END: an allow ruled through `approvals rule` with a reason padded by one space at
//       each end, fetched with `approvals ruling`, its canonical record bytes and signature held as literals, and
//       `ccd/approval-verify.mjs`'s `verdictFor` accepting it under the fixture public key. Since Q3j the HOME's cap
//       file lists `questions-v1`, so that row rules through the family; two more rows pin the same record bytes and
//       signature through each path by name: the family's door, and the old door with the cap file absent.
//   (d) THE NAMED-DIFFERENCE ROWS (D-7325), recorded as the base answers them (`EXPECTED`): the unconfigured box
//       token's detail, the five contrary-kind bodies, and the non-object body. MEASURED, not assumed: the old doors
//       ignore a contrary `kind` (an ask body with `"kind":"approval"` is pressed and recorded; an approval-shaped body
//       on `asks answer` is the ask ladder's `bad-request`), and `[]` is valid JSON, so fastify parses it and the
//       route's own body check answers `bad-request` with its detail; no fastify parse refusal is reached. Through the
//       family those rows, and only those, take the answers `FAMILY_DIFFERENCE` names (Q3j's behaviour commit).
//
// Neutral ids only (`approvalsHarness.ts`'s). Nothing here touches the live HOME or a live server.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { approvalRulingBytes, renderServerCaps, SERVER_CAPS, SERVER_CAPS_FILE, type ApprovalRulingRecord } from '../../shared/api.js';
import { verdictFor } from '../../ccd/approval-verify.mjs';
import { CCRC_API } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { CHILD, PARENT, requestBody, standardFixture, TOKEN, uuidOf } from './approvalsHarness.js';
import { mkTmp } from './tmpHelpers.js';
import {
  ANSWER, ASK_PANE, bodyOf, DIFFERENCE, EXPECTED, hookstate, installRealServerHooks, json, LADDER, lastRunDoors,
  mailBodiesTo, NONCE, NOW, ORDINARY, type Outcome, P, realServer, REL, type Row, RULE, runRow, statusOf, type Verb, VERBS,
  withKind,
} from './claimantClientFixture.js';

/** The old door each verb sends whenever `questions-v1` is not advertised, current and listed. */
const OLD_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/asks/${id}/answer`,
  'asks release': (id) => `/api/asks/${id}/release`,
  'approvals rule': (id) => `/api/approvals/${id}/rule`,
  'approvals release': (id) => `/api/approvals/${id}/release`,
};
/** The question door family's door each verb sends while it is (D-7322), and the kind the row splices: the row's,
 *  from the template's prefix, never the caller's. */
const FAMILY_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/questions/ask-${id}/rule`,
  'asks release': (id) => `/api/questions/ask-${id}/release`,
  'approvals rule': (id) => `/api/questions/approval-${id}/rule`,
  'approvals release': (id) => `/api/questions/approval-${id}/release`,
};
const KIND: Record<Verb, 'ask' | 'approval'> = {
  'asks answer': 'ask', 'asks release': 'ask', 'approvals rule': 'approval', 'approvals release': 'approval',
};
/** What the family is sent for a caller's `body`: `"kind"` first, unless the whitespace-stripped body names `"kind":`
 *  already; no body is sent as the kind alone. */
const spliced = (verb: Verb, body: string | null): string => {
  if (body === null) return `{"kind":"${KIND[verb]}"}`;
  if (body.replace(/\s/g, '').includes('"kind":')) return body;
  const rest = body.trimStart().slice(1);
  return rest.replace(/\s/g, '') === '}' ? `{"kind":"${KIND[verb]}"}` : `{"kind":"${KIND[verb]}",${rest}`;
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
/** The one state the family is sent in (D-7326). */
const ADVERTISED: CapState = 'current, lists questions-v1';
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

describe('(a) what the four verbs send, per cap-file state (the old door and the body unchanged, but while questions-v1 is advertised)', () => {
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
  const sentAs = (verb: Verb, id: string, body: string | null, state: CapState): Sent => state === ADVERTISED
    ? { method: 'POST', path: FAMILY_DOOR[verb](id), contentType: 'application/json', token: true, body: spliced(verb, body) }
    : { method: 'POST', path: OLD_DOOR[verb](id), contentType: body === null ? null : 'application/json', token: true, body: body ?? '' };
  /** A run the client refused before sending: `bad-body`, exit 2, no request. */
  const refusedHere = (r: Run, what: string): void => {
    expect([r.status, (JSON.parse(r.stdout) as { error: string }).error], `${what}: ${r.stdout}${r.stderr}`).toEqual([2, 'bad-body']);
    expect(seen, `${what}: nothing sent`).toEqual([]);
  };

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
        expect(s, `${state} | ${m.verb}`).toEqual(sentAs(m.verb, m.id, s.body, state));
      }
      expect(seenBodies, state).toEqual(state === ADVERTISED
        ? Object.fromEntries(Object.entries(MAILED_BODIES).map(([v, bs]) => [v, bs.map((b) => spliced(v as Verb, b))]))
        : MAILED_BODIES);
    }
  });

  it.each(VERBS.map((v) => [v, OLD_DOOR[v]('<n>'), FAMILY_DOOR[v]('<n>')] as const))(
    '%s sends POST %s in every cap state but one, and POST %s while questions-v1 is advertised', async (verb) => {
      const [group, name] = verb.split(' ') as [string, string];
      for (const state of CAP_STATES) {
        putCaps(home, state);
        for (const [label, body] of [...MAILED_BODIES[verb].map((b, i) => [`mailed body ${i}`, b] as const), ...bodiesFor(verb)]) {
          const args = body === null ? [group, name, '7'] : [group, name, '7', '--json', '-'];
          const r = await runClient(home, args, body ?? undefined);
          if (state === ADVERTISED && body === '[]') { refusedHere(r, `${state} | ${label}`); continue; }
          expect(one(r, `${state} | ${label}`), `${state} | ${label}`).toEqual(sentAs(verb, '7', body, state));
        }
      }
    });
});

// ── (b), (c), (d): a real server ──────────────────────────────────────────────────────────────────────────────────

installRealServerHooks();

/** The family's own answers to the named-difference rows (D-7325), MEASURED through the family: the unconfigured box
 *  token's detail names the family's route; a contrary kind is read by the family's ladder for that kind (on `rule`
 *  the body's kind picks the arm before attribution and the id check, so the mailed body with the contrary kind is the
 *  other arm's `bad-request`, and only a body well formed for the contrary kind reaches `kind-mismatch`; on `release`,
 *  `kind-mismatch`); a non-object body is refused by the client (`bad-body`, exit 2, no response: status -1). Every
 *  other cell is `EXPECTED`'s, the base's, unedited. */
const HELD_ASK = { state: 'held', answeredBy: null, answer: null };
const HELD_APPROVAL = { state: 'held', answeredBy: null, releaseReason: null };
const NOTHING = { doorIns: [], keys: [], mailToParent: 0 };
const CLIENT_BAD_BODY = '{"ok":false,"error":"bad-body","detail":"the body is not a JSON object; kind cannot be added"}';
const unconfigured = (route: string): string =>
  `{"ok":false,"error":"unauthenticated","detail":"no box token is configured on this server — ${route} fails shut on an unconfigured token, it does not fail open"}`;
const FAMILY_DIFFERENCE: Record<string, Outcome> = {
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
const THROUGH_FAMILY: Record<string, Outcome> = { ...EXPECTED, ...FAMILY_DIFFERENCE };

/** The door a row's own call reaches: the family's, with the row's id (a bad id rides through to the server, which
 *  refuses it); none for a body the client refuses. */
const familyDoor = ([, verb, call]: Row, r: { ask: number; approval: number }): string[] =>
  call.body === '[]' ? [] : [`POST ${FAMILY_DOOR[verb](call.id ?? String(verb.startsWith('asks') ? r.ask : r.approval))}`];
/** Every row's fixture mints ask 1 and approval 1. */
const IDS = { ask: 1, approval: 1 };

describe('(b) what a real server answers each verb, through the family while it advertises questions-v1', () => {
  it('the rows are uniquely named, and every row has an expectation', () => {
    const names = [...LADDER, ...DIFFERENCE].map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(EXPECTED).sort()).toEqual([...names, ...VERBS.map((v) => `difference | ${v} | the box token unconfigured`)].sort());
  });
  it('the family differs from the base on the named-difference rows only: every one of (d), no ladder row (D-7325)', () => {
    expect(Object.keys(FAMILY_DIFFERENCE).sort()).toEqual(Object.keys(EXPECTED).filter((n) => n.startsWith('difference | ')).sort());
    for (const [n, o] of Object.entries(FAMILY_DIFFERENCE)) expect(o, n).not.toEqual(EXPECTED[n]);
  });
  it.each(LADDER.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    expect(await runRow(row)).toEqual(THROUGH_FAMILY[row[0]]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(familyDoor(row, IDS));
  });
});

describe('(d) the named-difference rows: the base\'s answers in EXPECTED, the family\'s in FAMILY_DIFFERENCE (D-7325)', () => {
  it.each(DIFFERENCE.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    expect(await runRow(row)).toEqual(THROUGH_FAMILY[row[0]]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(familyDoor(row, IDS));
  });
  it.each(VERBS.map((v) => [`difference | ${v} | the box token unconfigured`, v] as const))('%s', async (name, verb) => {
    const body = verb === 'asks answer' ? ANSWER(0) : verb === 'approvals rule' ? RULE('allow') : REL;
    expect(await runRow([name, verb, { body }], { mailToken: 'unconfigured' })).toEqual(THROUGH_FAMILY[name]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(familyDoor([name, verb, { body }], IDS));
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
  it('approvals rule through the family signs the fixture ruling: the same record bytes and signature (D-7322)', async () => {
    const r = await realServer();
    const doors0 = r.doors().length;
    const ruled = await r.client('approvals rule', [String(r.approval)], json({ ...P, verdict: 'allow', reason: PADDED_REASON }));
    expect(r.doors().slice(doors0), 'the door the ruling reached').toEqual([`POST /api/questions/approval-${r.approval}/rule`]);
    expect([statusOf(ruled), bodyOf(ruled.stdout)]).toEqual([200, '{"ok":true,"state":"allowed"}']);
    const got = await runClient(r.home, ['approvals', 'ruling', String(r.approval), '--nonce', NONCE]);
    const answer = JSON.parse(got.stdout) as { state: string; ruling: { record: ApprovalRulingRecord; sig: string } };
    expect([approvalRulingBytes(answer.ruling.record), answer.ruling.sig]).toEqual([RULING_RECORD_BYTES, RULING_SIG]);
  });
  it('approvals rule through the old door, the cap file absent, signs the fixture ruling: the same record bytes and signature (D-7326)', async () => {
    const r = await realServer();
    // No cap file: questions-v1 is not advertised, so the client sends the old door, every non-advertised state's
    // fallback until the old doors retire.
    fs.rmSync(path.join(r.home, '.ccrc', SERVER_CAPS_FILE));
    const doors0 = r.doors().length;
    const ruled = await r.client('approvals rule', [String(r.approval)], json({ ...P, verdict: 'allow', reason: PADDED_REASON }));
    expect(r.doors().slice(doors0), 'the door the ruling reached').toEqual([`POST /api/approvals/${r.approval}/rule`]);
    expect([statusOf(ruled), bodyOf(ruled.stdout)]).toEqual([200, '{"ok":true,"state":"allowed"}']);
    const got = await runClient(r.home, ['approvals', 'ruling', String(r.approval), '--nonce', NONCE]);
    const answer = JSON.parse(got.stdout) as { state: string; ruling: { record: ApprovalRulingRecord; sig: string } };
    expect([approvalRulingBytes(answer.ruling.record), answer.ruling.sig]).toEqual([RULING_RECORD_BYTES, RULING_SIG]);
  });
});

