// The ingress. Two halves: the rejection table (pinned BOTH directions, the
// discipline `whitelist-subset.test.ts` and `wsaudit.test.ts` already
// established), and the happy path.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MAIL_REJECT_CODES, RUN_REFUSE_CODES, isRunRefuseCode, isLifecycleGapReason, isClaimRefuseCode, isSessionLifecycle, isReclaimRefuseCode } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField as withUnreadableField } from './ioDoubles.js';

const TOKEN = 'f'.repeat(64);
const UUID = 'a'.repeat(36);

const seed = (home: string, id: string, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const withMail = async (home: string, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const send = (app: FastifyInstance, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: '/api/mail',
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: body as Record<string, unknown> });

const ack = (app: FastifyInstance, id: number, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/mail/${id}/ack`,
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: body as Record<string, unknown> });

/** Pulls the id back out of an envelope's own `ack:` instruction — the ONLY
 *  way a receiving agent (or this test) learns which id to POST back
 *  (fix-round finding 5/6: the store's `dueDeliveries()[0].id` and the
 *  envelope's own published id are two independent `AUTOINCREMENT`
 *  sequences that only happen to agree while every mail resolves to exactly
 *  one delivery — a test that reads `.id` directly instead of parsing this
 *  line is structurally incapable of noticing the two diverge). */
const ackIdFromEnvelope = (envelope: string): number => {
  const m = /ack: ccrc-api mail ack (\d+)\b/.exec(envelope);
  if (!m) throw new Error(`envelope carries no ack: line to parse:\n${envelope}`);
  return Number(m[1]);
};

const GOOD = { fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'coordinator',
               kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [] };

/** A directory listing that always fails — the ordinary transient shape in
 *  remote mode (one dropped agent-WS round trip), not a directory that is
 *  genuinely empty. */
const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };


describe('POST /api/mail — the rejection table', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('accepts a well-formed message and records one queued delivery, rendered with this message\'s own data', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts: ['/tmp/a.png'] });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, id: expect.any(Number) });
    // `dueDeliveries` needs a `replayMs` second arg (deviation D-10, already
    // landed in Task 3) — the literal here stands in for Task 8's own
    // `MAIL_REPLAY_MS`, which does not exist in this tree yet; a freshly
    // queued row (`nextAttemptAt` defaults to 0) is due regardless of its
    // value.
    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(1);
    // The stored envelope actually carries THIS message's own data — nothing
    // in this file used to read `.envelope` at all (fix-round finding 4/7),
    // so `renderEnvelope` and `resolveCoordinator`/the route's own `toId`
    // pass-through arm were reachable by every test here without ever being
    // exercised for real.
    const { envelope } = due[0]!;
    expect(envelope).toContain('from: demo-quiet-mesa');
    expect(envelope).toContain('to: demo-coordinator');
    expect(envelope).toContain('kind: finding');
    expect(envelope).toContain('subject: a finding');
    expect(envelope).toContain('/tmp/a.png');
    expect(envelope).toContain('the body');
    // The ack line names the DELIVERY id, not the mail id (fix-round finding 5).
    expect(ackIdFromEnvelope(envelope)).toBe(due[0]!.id);
  });

  // Data-only rows (never a closure in the tuple: `it.each`'s generic
  // inference over a mixed array-of-arrays does not reliably keep a function
  // value callable at its own position, and a spread of a widened union type
  // is a compile error waiting to happen) — the override merges onto GOOD,
  // and only the `unauthenticated` row swaps the token instead.
  const REJECT_CASES: [code: string, status: number, override: Record<string, unknown>][] = [
    ['unauthenticated', 401, {}],
    ['unknown-sender', 403, { fromId: 'nobody-here' }],
    ['stale-uuid', 403, { fromUuid: 'b'.repeat(36) }],
    ['unknown-recipient', 404, { toId: 'nobody-here' }],
    ['unknown-run', 404, { runId: 4242 }],
    ['bad-kind', 400, { kind: 'gossip' }],
    ['oversize', 413, { body: 'x'.repeat(8 * 1024 + 1) }],
  ];

  // D-1165: the lower bound the third `runId` reader already had. Wave 5 put
  // `>= 1` on the kickoff route (D-1151) and left this one and the claims one
  // accepting 0 and negatives, relying on a downstream `coord.run(runId) ===
  // null` to answer 404 `unknown-run`. That is a shape error answering as a
  // missing row, which is the overloaded seam this tree bans by name — and on
  // THIS route it also mislabels the durable rejection record.
  //
  // The behaviour CHANGE is pinned in both directions on purpose: a malformed
  // runId becomes 400, and a well-formed-but-absent one stays 404.
  it.each([[0], [-1], [-4242], [1.5], [4242.5]])('refuses runId %s as a shape error, not as a missing run', async (runId) => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await send(app!, { ...GOOD, runId });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-kind' });
    expect(res.json().detail).toContain('positive');
    // …AND THE DURABLE ROW SAYS THE SAME THING (D-1218). The comment above
    // claims this route "also mislabels the durable rejection record" — a
    // SECOND consequence, beyond the status code, that nothing on THESE two
    // rows checked. The record itself is well read: `store.rejections()` has
    // sixteen call sites across three test files (fourteen before this wave
    // added two), so the gap was never "nothing reads it" — it was that the two
    // rows whose comment makes the claim did not. The row is the fleet-visible
    // half of a refusal and the half a later feed will surface, so a shape error
    // recorded as a missing run is a wrong fact that outlives the response.
    //
    // Measured with a mutation that touches the ROW alone — `refuse()` recording
    // a constant code while the reply still varies — so this assertion is
    // witnessed independently of the status assertions above it.
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['bad-kind']);
  });

  it('still answers 404 unknown-run for a WELL-FORMED runId that names no run', async () => {
    // The fixture that keeps the row above from being a widening: 4242 is a
    // perfectly good run id, and it must still reach the existence check.
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await send(app!, { ...GOOD, runId: 4242 });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-run' });
    // The other direction for the durable row too: this one really is recorded
    // as a missing run, so the row above pins a DISTINCTION rather than a
    // constant.
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['unknown-run']);
  });

  it.each(REJECT_CASES)('refuses %s', async (code, status, override) => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const token = code === 'unauthenticated' ? 'wrong' : TOKEN;
    const res = await send(app!, { ...GOOD, ...override }, token);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ ok: false, error: code });
    // "a rejected message is a fact about the fleet" (spec:147-148)
    expect(w.coord.rejections().map((r) => r.code)).toContain(code);
    // …and nothing was queued for delivery.
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  // Fix-round finding 3/5: `/api/notify`'s one-deploy-generation `legacy`
  // tolerance (an ABSENT token, checkMailToken's `'legacy'` verdict) does NOT
  // extend to `/api/mail` — it has no pre-existing deployed caller a rollout
  // could strand, and the spec lists `unauthenticated` as a plain, total
  // rejection code for it (spec:136-148) with no tolerance carved out. This
  // was entirely unpinned before: `send`'s `token` parameter supports `null`
  // (no header at all) but nothing in this file ever called it that way, so
  // a mutant widening `verdict === 'bad'` back to `!== 'ok'` — accepting a
  // tokenless request as `/api/notify` does — survived the whole suite.
  it('refuses a request with NO token header at all — /api/mail grants no legacy tolerance', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await send(app, GOOD, null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    // Unlike `/api/notify` (which has no coordination store to write into and
    // relies on a `console.warn`), the mail routes DO have one — the refusal
    // must be recorded, so "was a tokenless POST ever accepted" stays an
    // answerable question through the rollout window.
    expect(w.coord.rejections().map((r) => r.code)).toContain('unauthenticated');
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  // Fix-round finding 3 (Task 7 / D-39): `checkMailToken` used to answer
  // `'ok'` for `expected === null` unconditionally — a server whose token
  // file was never minted ran `/api/mail` fully unauthenticated, with no
  // `mail_rejections` row at all. `/api/mail` has no pre-existing deployed
  // caller a strict gate could strand (the same argument that already ruled
  // out a `'legacy'` tolerance above), so it must fail SHUT here, unlike
  // `/api/notify` (pinned separately in `notify-token.test.ts`, unchanged).
  it('refuses unauthenticated when NO box token is configured on the server at all — unconfigured fails shut, not open', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    app = await buildServer({ ...testDeps(home), coord });   // NOTE: no `mailToken` key at all
    const withNoHeader = await send(app, GOOD, null);
    expect(withNoHeader.statusCode).toBe(401);
    expect(withNoHeader.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    // Presenting SOME value cannot rescue it either — there is nothing
    // configured to compare against, so any value is equally "wrong".
    const withGuessedToken = await send(app, GOOD, 'nope');
    expect(withGuessedToken.statusCode).toBe(401);
    expect(withGuessedToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect(coord.rejections().map((r) => r.code)).toEqual(['unauthenticated', 'unauthenticated']);
    expect(coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('measures the 8KB cap in UTF-8 BYTES, not code units', async () => {
    // A body of 2100 astral characters is 2100 string units and 8400 bytes —
    // `hookstate.ts:128-135` already had to learn this distinction.
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator', body: '𝔘'.repeat(2100) });
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize' });
  });

  it('rejects an artifact list that carries a PAYLOAD instead of a path', async () => {
    // spec:52-53 — artifact = PATHS, not payloads. A non-string entry, and a
    // relative path, are both a bad-kind of artifact and reuse the ingress
    // vocabulary rather than growing a fourteenth code.
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const payload = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts: [{ data: 'x' }] });
    expect(payload.statusCode).toBe(400);
    expect(payload.json()).toMatchObject({ ok: false, error: 'bad-kind' });
    const relative = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts: ['relative/path.png'] });
    expect(relative.statusCode).toBe(400);
    expect(relative.json()).toMatchObject({ ok: false, error: 'bad-kind' });
  });

  // Fix-round finding 8 / D-44: `MAIL_BODY_MAX_BYTES` alone did not bound the
  // injected envelope — `subject` renders as one line and `artifacts`
  // renders one line PER ENTRY, and `sendPrompt` costs one agent round trip
  // PER LINE, so either was a way to smuggle tens of thousands of injection
  // round trips through a request well under the body cap and Fastify's 1
  // MiB default body limit.
  it('caps subject size (fix-round finding 8)', async () => {
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator', subject: 'x'.repeat(201) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize' });
  });

  it('caps the NUMBER of artifacts — each renders its own injection line (fix-round finding 8)', async () => {
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const artifacts = Array.from({ length: 65 }, (_, i) => `/tmp/f${i}`);
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize' });
  });

  it('caps a single artifact path\'s length (fix-round finding 8)', async () => {
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts: [`/${'a'.repeat(4100)}`] });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize' });
  });

  // Fix-round finding 1 / D-37: `readRegistry` collapses an unlistable
  // directory (`io.readdir` -> null, an ordinary transient failure in remote
  // mode) to `[]` — indistinguishable, before this fix, from a registry that
  // genuinely carries no row for the sender. Reading that as fact turned a
  // dropped agent-WS round trip into a PERMANENT, recorded `unknown-sender`
  // for a session that is plainly alive — the worker's own `wave-done`
  // status mail, the one message the whole done-authority lane depends on,
  // is exactly what this could silently drop.
  describe('a transient registry-read failure is NOT a fact about the sender or recipient (fix-round finding 1)', () => {
    it('refuses registry-unmeasurable, not unknown-sender, when the directory cannot be listed', async () => {
      const home = mkTmp('ccrc-mail-');
      seed(home, 'demo-quiet-mesa');
      const w = await withMail(home, { io: unlistableIO }); app = w.app;
      const res = await send(app, GOOD);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
      expect(w.coord.rejections().map((r) => r.code)).toContain('registry-unmeasurable');
      expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
    });

    it('refuses registry-unmeasurable, not unknown-sender, when the sender IS listed but one field could not be read', async () => {
      const home = mkTmp('ccrc-mail-');
      seed(home, 'demo-quiet-mesa');
      const w = await withMail(home, { io: withUnreadableField('demo-quiet-mesa', 'workdir') });
      app = w.app;
      const res = await send(app, GOOD);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
      expect(w.coord.rejections().map((r) => r.code)).toContain('registry-unmeasurable');
    });

    // Registry ladder (architecture doc, increment 1's second half): a
    // recipient's OWN identity is never re-derived by this route — mail is
    // addressed and delivered by `toId` (a plain session-id string,
    // `sweepMail`'s own `sendPrompt(tmux, queue, toId, envelope)` call)
    // verbatim, never by uuid — so "does a row exist for this id" is the
    // only fact recipient routing needs, and a degraded IDENTITY field on an
    // otherwise-present recipient row answers that fact just as well as a
    // fully-measured one. This inverts what this test used to pin (a 502
    // refusal) — see check 5.5's own comment on `sender.unmeasured` for why
    // the SENDER side still refuses: attribution re-derives uuid, recipient
    // routing does not.
    it('accepts a message to a recipient whose row is listed but one identity field is unreadable — routing ' +
       'is by id, never by uuid, so a degraded recipient still receives mail', async () => {
      const home = mkTmp('ccrc-mail-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
      const w = await withMail(home, { io: withUnreadableField('demo-coordinator', 'wrapper') });
      app = w.app;
      const res = await send(app, { ...GOOD, toId: 'demo-coordinator' });
      expect(res.statusCode).toBe(202);
      const due = w.coord.dueDeliveries(Date.now(), 60_000);
      expect(due.length).toBe(1);
      expect(due[0]!.toId).toBe('demo-coordinator');
    });

    // The recipient row's OWN unmeasured identity must not become the SENDER's
    // 502 — the sibling case above proves the accept path; this proves check
    // 5.5 above (the sender's own gate) is the ONLY place unmeasured identity
    // refuses in this route, not a blanket "any degraded row anywhere refuses".
    it('still accepts when it is the SENDER that is fully measured and the RECIPIENT alone is degraded ' +
       '(regression guard: unmeasured identity is not contagious across the two rows)', async () => {
      const home = mkTmp('ccrc-mail-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
      const w = await withMail(home, { io: withUnreadableField('demo-coordinator', 'uuid') });
      app = w.app;
      const res = await send(app, { ...GOOD, toId: 'demo-coordinator' });
      expect(res.statusCode).toBe(202);
    });
  });

  // Check 5.5: the NEW gate this build adds between checks 5 and 6. Written
  // FIRST (registry-ladder task discipline) and confirmed red against the
  // pre-gate code, where an unmeasured `sender.uuid` (reading `''`) fell
  // through to check 6's `sender.uuid === '' || sender.uuid !== fromUuid` and
  // was answered `stale-uuid` — a TERMINAL, 403 refusal for what is only a
  // transient read failure on a sender that is plainly still there.
  describe('an unmeasured SENDER identity refuses registry-unmeasurable, never stale-uuid (check 5.5)', () => {
    it('refuses registry-unmeasurable, not stale-uuid, when the sender\'s OWN uuid field is listed but unreadable', async () => {
      const home = mkTmp('ccrc-mail-');
      seed(home, 'demo-quiet-mesa');
      const w = await withMail(home, { io: withUnreadableField('demo-quiet-mesa', 'uuid') });
      app = w.app;
      const res = await send(app, GOOD);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
      expect(w.coord.rejections().map((r) => r.code)).toContain('registry-unmeasurable');
      // The mutant this kills: deleting check 5.5 (or reordering it after
      // check 6) reaches `sender.uuid === '' || sender.uuid !== fromUuid` —
      // `''` degraded-uuid trivially satisfies the first disjunct — and
      // answers 403 stale-uuid instead.
      expect(w.coord.rejections().map((r) => r.code)).not.toContain('stale-uuid');
    });

    it('refuses registry-unmeasurable for the ACK route too, on the same unmeasured-uuid sender shape', async () => {
      const home = mkTmp('ccrc-mail-');
      seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
      const w = await withMail(home); app = w.app;
      await send(app, { ...GOOD, toId: 'demo-coordinator' });
      const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);
      await w.app.close();
      app = await buildServer({
        ...testDeps(home), mailToken: TOKEN, coord: w.coord,
        io: withUnreadableField('demo-coordinator', 'uuid'),
      });
      const res = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    });
  });
});

describe('the rejection table is total, in both directions', () => {
  // The linkage discipline `wsaudit.test.ts:52-100` established: the union and
  // the emitters are one set, and neither may grow alone. A code nobody emits
  // is a promise the server does not keep; an emitted code nobody declared is
  // a 500 waiting for a client that switches on it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coordDir = path.resolve(here, '../src/coord');
  const sources = (): string =>
    readdirSync(coordDir).filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(path.join(coordDir, f), 'utf8')).join('\n');

  it('every declared INGRESS/DONE-AUTHORITY code is emitted somewhere in server/src/coord', () => {
    // 'undeliverable' is the one DELIVERY-group code (MAIL_REJECT_CODES's own
    // comment names three groups: ingress, delivery, done-authority). It is
    // emitted by `watch.ts`'s mail sweep — Task 8, not landed in this tree —
    // and `watch.ts` sits outside `server/src/coord` entirely, so asserting it
    // here would fail through no fault of this task's own diff. Recorded as a
    // deviation rather than silently narrowing MAIL_REJECT_CODES or widening
    // this scan to a file this task does not touch (D-38 — and this exclusion
    // is now also stated honestly in `MAIL_REJECT_CODES`'s own docstring,
    // rather than the docstring claiming a total both-directions pin the test
    // right here has always carved one exception out of).
    const src = sources();
    for (const code of MAIL_REJECT_CODES) {
      if (code === 'undeliverable') continue;
      expect(src, code).toContain(`'${code}'`);
    }
  });

  it('every declared RunRefuseCode (run-route refusals) is emitted somewhere in server/src/coord', () => {
    // The reverse of the scan below, for `RunRefuseCode` specifically — the
    // same both-directions discipline `MAIL_REJECT_CODES` gets above,
    // required now that a run refusal has its own typed union (orchestrator
    // amendment, architecture increment 3) rather than living only as an
    // untyped string a route happened to send.
    const src = sources();
    for (const code of RUN_REFUSE_CODES) expect(src, code).toContain(`'${code}'`);
  });

  it('every quoted kebab token in server/src/coord that looks like a code is declared', () => {
    // Deliberately over-broad, then filtered by an explicit allowlist of
    // NON-code kebab literals, so a new code cannot slip in unnamed. A token
    // is accepted if it is a MAIL_REJECT_CODES member OR a RunRefuseCode
    // member (orchestrator amendment) — the two unions are checked TOGETHER,
    // never merged into one, because a run refusal and a mail refusal are
    // different vocabularies that happen to share this one scanner.
    const NOT_CODES = new Set([
      'x-ccrc-mail-token',   // coord/token.ts's header name
      'not-configured',      // the generic "no store wired" answer, shared with push/notifyLog
      'no-commits',          // coord/fingerprint.ts — a DoneRun verdict, not a mail code
      'packed-refs',         // coord/gitref.ts — a git filename
      'refused-project',     // coord/gitref.ts — a `WorktreeRead.reason` (§1.7).
                             // NOT a refusal a client ever sees: `readWorktreeRecords`
                             // answers it to ONE in-process caller (`watch.ts`'s
                             // census), no route maps it to a status, and nothing
                             // switches on it over the wire. The sibling reason
                             // `unlistable` is one word and never reaches this scan
                             // at all, which is the only reason it is not listed
                             // beside this one.
      'not-a-checkout',      // coord/gitref.ts — the same, and it arrives here for
                             // the same reason `refused-project` does: two words.
                             // It is the STANDING half that used to hide inside
                             // `unreachable` (one word, invisible to this scan),
                             // so splitting it made a fact this file already knew
                             // how to allowlist. Also not a wire code: one
                             // in-process caller, no route, nothing switches on it.
      // Task 9 (`coord/routes.ts`'s run routes) — a SEPARATE `refused`/
      // `reject.code` vocabulary for `POST /api/runs*`, now typed as
      // `RunRefuseCode` above and so no longer hand-allowlisted here.
      'no-refs',              // coord/ledgerseed.ts — a `FloorMeasurement.why`
                               // (wave 2, F2). NOT a wire code: the allocator's
                               // refusal stays `not-seeded`, and this only
                               // chooses WHICH detail sentence that 409 carries.
                               // One in-process caller, no route maps it to a
                               // status, nothing switches on it over the wire.
                               // Its sibling `unmeasurable` is one word and
                               // never reaches this scan at all — the same
                               // asymmetry `refused-project`/`unlistable` above
                               // records.
      'coordinator-paused',   // $REG marker filename, not a code
      'bad-request',          // the generic body-shape refusal server.ts
                               // already uses throughout; not a mail code
      'not-found',            // GET /api/mail/:id's generic 404 for an
                               // unknown delivery id; not a mail reject code
                               // (nothing was ever rejected — it never existed)
      'wave-brief',           // mail SUBJECT text (dispatch's own brief)
      'wave-done-rejected',   // mail SUBJECT text (close's own rejection)
      'wave-advance-rejected', // mail SUBJECT text (advance's own rejection, review findings 1/15)
      'awaiting-review',      // a RunState value (advance's own target list), not a mail code
      'enter-ignored',        // a `SendResult` error (`inject/send.ts`), reached here as
                              // half of `rundefs.ts`'s `CLEAR_REFUSED_STRANDS_TEXT` — the
                              // `run_events.detail` token `CoordStore.strandedClear` matches
                              // (Task 407). A THIRD vocabulary passing through this
                              // scanner, not a mail refusal and not a run refusal: nothing
                              // maps it to a status and no client switches on it. Listed
                              // rather than merged, for the reason stated above — three
                              // vocabularies sharing one scanner stay three.
      'session-gone',         // claims.ts `claimExpiry`'s `endedBy` values (Build 9 D12) —
      'hard-cap',             // stored forensics on a lapsed claim, never a refusal a
                              // caller switches on. `ClaimSummary.endedBy` is deliberately
                              // `string | null` in shared/api.ts ("display/forensic" — its
                              // own docstring), so there is no union to admit them through:
                              // an exported guard here would invent the very vocabulary the
                              // L0 slice ruled out. Allowlisted as fixed spellings instead;
                              // a THIRD endedBy value trips this scan and gets its own
                              // deliberate entry, which is the ceremony working.
      'run-closed',           // …and here is that third value, deliberately (Task 15):
                              // store.ts `releaseClaimsForRun`'s endedBy — the run close
                              // releasing its own claims inside the close transaction
                              // (Build 9 D12). Same family, same reasoning as the pair
                              // above: stored forensics on a released claim, never a
                              // refusal a caller switches on. A FOURTH value gets its
                              // own entry too.
      'bad-count',            // ledger.ts `decideAllocation`'s local refusal arm. The plan
                              // ruled it NOT L0 ("no wire type carries it"), so it is
                              // deliberately absent from CLAIM_REFUSE_CODES and has no
                              // guard to pass through. If the allocator route later gives
                              // it a wire spelling, that task moves it out of this list.
      'not-live',             // store.ts `ClaimEndResult`'s local refusal arm (Task 12) —
                              // the `bad-count` shape exactly: a store-internal spelling
                              // no wire carries. The claims routes (Task 19) map it to
                              // 'claim-terminal' (CLAIM_REFUSE_CODES) before any caller
                              // sees it, so admitting it through the guard would put a
                              // never-wire word INTO the wire vocabulary to do it.
    ]);
    for (const m of sources().matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)) {
      const tok = m[1]!;
      if (NOT_CODES.has(tok)) continue;
      expect((MAIL_REJECT_CODES as readonly string[]).includes(tok)
        || isRunRefuseCode(tok)
        // BUILD 9a WAVE 4 — a FOURTH union, checked together and never merged, for
        // the reason the `enter-ignored` note above already states. `LifecycleGapReason`
        // reaches this scanner because `mirrorplan.ts` lives in `server/src/coord` and
        // `'rotated-away'` is one of its members. It is admitted through its own exported
        // guard rather than added to `NOT_CODES`, and that difference is the point: an
        // allowlist entry would accept exactly one spelling for ever, whereas the guard
        // accepts a gap reason added later and still rejects a typo'd one.
        || isLifecycleGapReason(tok)
        // BUILD 9 WAVE 7 — the FIFTH union, checked together and never merged
        // (the standing rule stated at `enter-ignored` above). The claims and
        // ledger routes refuse synchronously to a live caller — nothing is
        // recorded, nothing replays — so their codes are neither mail
        // rejections nor run refusals. Admitted through the exported guard,
        // not NOT_CODES, so a member added later is accepted and a typo is not.
        || isClaimRefuseCode(tok)
        // BUILD 9 WAVE 7 — `peers.ts` lives in `server/src/coord` and spells
        // `'never-started'` as a `SessionLifecycle` record key, the exact way
        // `mirrorplan.ts` brought `'rotated-away'` here. Same remedy, same
        // reason: the exported guard, never an allowlist pin per member.
        || isSessionLifecycle(tok)
        // PROGRAM-LEVERAGE WAVE 5 — the SIXTH union, checked together and never
        // merged, on the standing rule `enter-ignored` states above. `reclaim.ts`
        // lives in `server/src/coord` and spells both of its own refusals as
        // literals. It is a vocabulary of its own and not an extension of
        // `RunRefuseCode` FOR A REASON THIS SCANNER CANNOT SEE:
        // `coordinator-skill.test.ts` requires every `RunRefuseCode` member to be
        // named in the coordinator corpus, and this door is the operator's act on a
        // coordinator that is already dead — a live one reading about it has found a
        // recovery for a problem it does not have. Admitted through the exported
        // guard rather than NOT_CODES, for the reason the `LifecycleGapReason` note
        // above gives: an allowlist accepts one spelling for ever, a guard accepts a
        // member added later and still rejects a typo'd one.
        || isReclaimRefuseCode(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle or ReclaimRefuseCode`).toBe(true);
    }
  });
});

// Fix-round finding 4/6: the plan's headline "No guessing" decision — a
// worker addressing `toId: 'coordinator'` must resolve to the run's/program's
// real claimant, never the literal string — had zero test reaching it. Every
// case in the rejection table above that carried `toId: 'coordinator'`
// refused EARLIER, at a cheaper check; the three accept-direction tests all
// address a literal session id instead. `resolvedToId = toId` (skipping
// resolution entirely) and deleting the `resolvedToId === null` refusal both
// kept the whole suite green before these tests existed.
describe('resolving the \'coordinator\' role (fix-round finding 4/6)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('resolves toId:\'coordinator\' to the NAMED RUN\'s own claim, never the literal string', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    seed(home, 'demo-coord-session');
    const w = await withMail(home); app = w.app;
    const opened = w.coord.openRun({ program: 'p1', title: 'P1', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-coord-session' }) as { id: number };
    const res = await send(app, { ...GOOD, runId: opened.id });   // GOOD.toId is already 'coordinator'
    expect(res.statusCode).toBe(202);
    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(1);
    // The mutant this kills: `const resolvedToId = toId;` would queue this
    // addressed to the literal string 'coordinator', which is not a session
    // id and can never be a tmux target — every worker->coordinator message
    // would be silently undeliverable.
    expect(due[0]!.toId).toBe('demo-coord-session');
    expect(due[0]!.envelope).toContain('to: demo-coord-session');
  });

  it('refuses unknown-recipient, recorded, when \'coordinator\' has no runId and no single active program to fall back on', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    // No program opened at all: resolveCoordinator(null) sees zero active
    // programs — absent, not ambiguous, but the same refusal either way.
    const res = await send(app, GOOD);   // toId: 'coordinator', no runId
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    expect(w.coord.rejections().map((r) => r.code)).toContain('unknown-recipient');
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('refuses unknown-recipient, recorded, when TWO active programs make \'coordinator\' ambiguous with no runId', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    seed(home, 'demo-coord-a'); seed(home, 'demo-coord-b');
    const w = await withMail(home); app = w.app;
    w.coord.openRun({ program: 'pA', title: 'A', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-coord-a' });
    w.coord.openRun({ program: 'pB', title: 'B', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-coord-b' });
    const res = await send(app, GOOD);   // toId: 'coordinator', no runId -> resolveCoordinator(null)
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });
});

// Fix-round finding 5 / D-41: the envelope used to publish the MAIL id as the
// ack id, while the ack route resolves a DELIVERY id — two independent
// AUTOINCREMENT sequences that only happened to walk together while every
// mail resolved to exactly one delivery.
describe('the ack instruction names the DELIVERY id, not the mail id (fix-round finding 5)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('desynchronises the two id sequences first, then proves the envelope names the delivery id', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    // Insert one mail row directly, bypassing the route, with NO delivery —
    // bumps `mail.id`'s own AUTOINCREMENT sequence without touching
    // `mail_deliveries.id`, so the two sequences are already apart before the
    // real send below. With only ONE mail ever sent the two ids are
    // numerically indistinguishable and a regression to the mail id would
    // pass unnoticed — this is why this test exists as its own case.
    w.coord.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'demo-coordinator',
      runId: null, kind: 'finding', subject: 'filler', body: 'filler', artifacts: [] });

    const res = await send(app, { ...GOOD, toId: 'demo-coordinator' });
    expect(res.statusCode).toBe(202);
    const mailId = (res.json() as { id: number }).id;
    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(1);
    const delivery = due[0]!;
    expect(mailId).not.toBe(delivery.id);                        // the desync really happened
    expect(ackIdFromEnvelope(delivery.envelope)).toBe(delivery.id);
    expect(ackIdFromEnvelope(delivery.envelope)).not.toBe(mailId);
  });
});

describe('POST /api/mail/:id/ack', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('acks once, and a second ack is not an error but is not a second ack either', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    // Read from the PUBLISHED ENVELOPE, not `dueDeliveries()[0].id` directly
    // (fix-round finding 5/6): the two happen to agree today, but a test
    // that reads `.id` is structurally incapable of noticing the day they
    // do not.
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);

    const first = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, already: false });

    const second = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, already: true });
  });

  it('applies the SAME token and attribution gate as the ingress', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);

    const wrongToken = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID }, 'wrong');
    expect(wrongToken.statusCode).toBe(401);
    expect(wrongToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });

    // Fix-round finding 3/5: no legacy tolerance on the ack route either —
    // see the matching ingress test above for the full rationale.
    const noToken = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID }, null);
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });

    const staleUuid = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: 'b'.repeat(36) });
    expect(staleUuid.statusCode).toBe(403);
    expect(staleUuid.json()).toMatchObject({ ok: false, error: 'stale-uuid' });

    const unknownSender = await ack(app, deliveryId, { fromId: 'nobody-here', fromUuid: UUID });
    expect(unknownSender.statusCode).toBe(403);
    expect(unknownSender.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
  });

  it('refuses to let one session ack another session\'s delivery', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);

    const res = await ack(app, deliveryId, { fromId: 'demo-quiet-mesa', fromUuid: UUID });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    // The delivery itself is untouched — still queued, not acked.
    expect(w.coord.delivery(deliveryId)?.state).toBe('queued');
  });

  // Fix-round finding 1 / D-37: same transient-vs-terminal split as the
  // ingress route's checks 5/6 — a directory listing that cannot be read is
  // not proof the acking session does not exist.
  it('refuses registry-unmeasurable, not unknown-sender, when the registry directory cannot be listed', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home);
    await send(w.app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);
    await w.app.close();
    // Same underlying store, a second Fastify instance whose `io` cannot
    // list the registry — the delivery already exists from the healthy send
    // above, so only the ACK's own registry read is under test.
    app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord: w.coord, io: unlistableIO });
    const res = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });

  // Fix-round finding 3 / D-39: an unconfigured server token fails shut on
  // the ack route too, not just the ingress.
  it('refuses unauthenticated when no box token is configured on the server', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home);
    await send(w.app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);
    await w.app.close();
    app = await buildServer({ ...testDeps(home), coord: w.coord });   // NOTE: no `mailToken` key at all
    const res = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID }, null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });
});

// GET /api/mail/:id — the body channel the reference nudge (robust-mail-
// delivery spec §1.2) points at. Serves the STORED envelope verbatim; never
// calls renderEnvelope again (spec:176-177's "verbatim, never re-rendered"
// extends to every reader, not only the delivery lane).
const getEnvelope = (app: FastifyInstance, id: number | string, token: string | null = TOKEN) =>
  app.inject({ method: 'GET', url: `/api/mail/${id}`,
    headers: token === null ? {} : { 'x-ccrc-mail-token': token } });

describe('GET /api/mail/:id', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('returns the stored envelope verbatim for a known delivery', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const delivery = w.coord.dueDeliveries(Date.now(), 60_000)[0]!;

    const res = await getEnvelope(app, delivery.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true, id: delivery.id, toId: 'demo-coordinator', state: 'queued', envelope: delivery.envelope,
    });
    // Not a re-render — the exact bytes `dueDeliveries` already has, which
    // are themselves rendered exactly once at queue time.
    expect(res.json()).toMatchObject({ envelope: expect.stringContaining('the body') });
  });

  it('404s an unknown delivery id', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await getEnvelope(app, 999999);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-found' });
  });

  it('400s a non-integer id', async () => {
    const home = mkTmp('ccrc-mail-');
    const w = await withMail(home); app = w.app;
    const res = await getEnvelope(app, 'not-a-number');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('401s without the box token — the same gate as GET /api/mail?to=, a read with no attribution to check', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const delivery = w.coord.dueDeliveries(Date.now(), 60_000)[0]!;

    const noToken = await getEnvelope(app, delivery.id, null);
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });

    const wrongToken = await getEnvelope(app, delivery.id, 'wrong');
    expect(wrongToken.statusCode).toBe(401);
    expect(wrongToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });

  it('is a distinct route from POST /api/mail/:id/ack — no router ordering hazard', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const delivery = w.coord.dueDeliveries(Date.now(), 60_000)[0]!;

    const before = await getEnvelope(app, delivery.id);
    expect(before.json()).toMatchObject({ state: 'queued' });

    const ackRes = await ack(app, delivery.id, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(ackRes.statusCode).toBe(200);

    const after = await getEnvelope(app, delivery.id);
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ state: 'acked' });
  });

  // Hard case (e): the worker can still ack from the nudge — the full
  // read+ack protocol the nudge itself names (envelope.ts's own
  // `renderMailNudge`): list outstanding mail, fetch the body of each by
  // DELIVERY id, then ack it. Chained end to end here at the route level.
  //
  // The two id sequences are desynchronised FIRST (same technique as "the ack
  // instruction names the DELIVERY id" describe block above) — with only one
  // mail ever sent, `mail.id` and `mail_deliveries.id` are numerically
  // indistinguishable and a regression back to the listing's bare `id` field
  // would pass unnoticed (exactly the masking the blocking review finding
  // named: this test used to read `mail[0]!.id` and call it `deliveryId`).
  it('supports the full nudge-driven protocol: list -> fetch body -> ack, using the listing\'s deliveryId (blocking finding, re-opened D-41)', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    // Desync the sequences before the real send: one filler mail row with NO
    // delivery bumps `mail.id`'s own AUTOINCREMENT without touching
    // `mail_deliveries.id`.
    w.coord.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'demo-coordinator',
      runId: null, kind: 'finding', subject: 'filler', body: 'filler', artifacts: [] });
    await send(app, { ...GOOD, toId: 'demo-coordinator' });

    // 1: list — what the nudge's own `GET /api/mail?to=` step returns.
    const listRes = await app.inject({ method: 'GET', url: '/api/mail?to=demo-coordinator',
      headers: { 'x-ccrc-mail-token': TOKEN } });
    expect(listRes.statusCode).toBe(200);
    const { mail } = listRes.json() as { mail: { id: number; deliveryId: number }[] };
    expect(mail.length).toBe(1);
    // The desync really happened: the mail id and delivery id disagree, so a
    // protocol that used `mail[0]!.id` would now point at the wrong row (or
    // 404).
    expect(mail[0]!.deliveryId).not.toBe(mail[0]!.id);
    const deliveryId = mail[0]!.deliveryId;

    // 2: fetch body — the nudge's `GET /api/mail/<deliveryId>` step.
    const bodyRes = await getEnvelope(app, deliveryId);
    expect(bodyRes.statusCode).toBe(200);
    const { envelope } = bodyRes.json() as { envelope: string };
    expect(envelope).toContain('the body');

    // 3: ack — the nudge's `POST /api/mail/<deliveryId>/ack` step.
    const ackRes = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(ackRes.statusCode).toBe(200);
    expect(ackRes.json()).toMatchObject({ ok: true, already: false });
    expect(w.coord.delivery(deliveryId)?.state).toBe('acked');
  });
});
