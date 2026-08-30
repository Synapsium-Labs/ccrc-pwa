// program-leverage wave 4 (F4) — the L1 seam that queues a program kickoff as
// durable system mail. TDD red-first: this file was written and run before
// `src/coord/kickoff.ts` existed, to confirm it failed for the right reason.
//
// The route half lives in `kickoff-route.test.ts`. What is pinned HERE is the
// decision — what gets queued, what does not, and what the caller is told —
// because wave 5's coordinator-reclaim door calls this function and never sees
// the route.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { queueProgramKickoff, type KickoffOutcome } from '../src/coord/kickoff.js';
import { MAIL_BODY_MAX_BYTES, PROGRAM_KICKOFF_SUBJECT, programKickoff } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const ID = 'demo-quiet-mesa';
const PROGRAM = { slug: 'build9-demo', title: 'Build 9 demo' };

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-kickoff-'), '.ccrc', 'coord.db')));

const due = (s: CoordStore) => s.dueDeliveries(NOW, 60_000);

/** Narrows the oversize arm away, once, for the fixtures that cannot reach it —
 *  every `PROGRAM` below composes a body of a couple of hundred bytes. It THROWS
 *  rather than asserting so a fixture that starts being refused says so at the
 *  line that refused it, instead of failing later as a missing row. */
const queued = (s: CoordStore, id: string, p = PROGRAM): Extract<KickoffOutcome, { ok: true }> => {
  const out = queueProgramKickoff({ coord: s }, id, p);
  if (!out.ok) throw new Error(`fixture: the seam refused this kickoff (${out.kind})`);
  return out;
};

describe('queueProgramKickoff — the kickoff is MAIL, and it says which kind of answer it gave', () => {
  it('queues one mail and one delivery, and reports the ids it wrote', () => {
    const s = store();
    const out = queued(s, ID);
    expect(out.queued).toBe(true);
    const rows = due(s);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ toId: ID });
    if (!out.queued) throw new Error('unreachable — narrowed above');
    expect(rows[0]!.id).toBe(out.deliveryId);
    // The two ids are separate AUTOINCREMENT sequences (D-41). Reporting both
    // is the point: a caller that needs one must not have to assume the other.
    expect(out.mailId).toBeGreaterThan(0);
  });

  it('sends the standing kickoff sentence, byte for byte', () => {
    const s = store();
    queueProgramKickoff({ coord: s }, ID, PROGRAM);
    const envelope = due(s)[0]!.envelope;
    // Both halves on purpose. Against the L0 constant, so the seam is pinned to
    // USE it rather than compose its own; and against the literal, so a change
    // to the constant cannot silently change what a coordinator is told — the
    // same reasoning `pwa/test/start-program.test.tsx`'s own literal pin gives.
    expect(envelope).toContain(programKickoff(PROGRAM.slug, PROGRAM.title));
    expect(envelope).toContain(
      'You are the coordinator for program `build9-demo` (Build 9 demo).\n'
      + 'Its ledger is `docs/superpowers/programs/build9-demo.md`.\n'
      + 'Run the ccrc-coordinator skill and open the run for wave 1.',
    );
  });

  it('is FROM the operator, not from the coordinator it is addressed to', () => {
    // D-1040. The recipient IS the coordinator-to-be; a `from: coordinator`
    // line would be a false statement on the face of the envelope, and would
    // send `tellSender` through `resolveCoordinator(null)`.
    const s = store();
    queueProgramKickoff({ coord: s }, ID, PROGRAM);
    const envelope = due(s)[0]!.envelope;
    expect(envelope).toContain('from: operator');
    expect(envelope).not.toContain('from: coordinator');
    expect(envelope).toContain(`subject: ${PROGRAM_KICKOFF_SUBJECT}`);
    expect(envelope).toContain('kind: status');
  });

  it('names NO run — there is none yet, and the envelope does not pretend otherwise', () => {
    const s = store();
    queueProgramKickoff({ coord: s }, ID, PROGRAM);
    // A positive assertion on ABSENCE. `renderEnvelope` gates the whole `run:`
    // line on a non-null runId, and that missing line is the run-less shape's
    // one visible difference — a regression would restore it silently, naming a
    // program and a wave that do not exist.
    expect(due(s)[0]!.envelope).not.toContain('run:');
    const row = s.db.prepare('SELECT runId FROM mail').get() as { runId: number | null };
    expect(row.runId).toBeNull();
  });

  it('declines an identical second kickoff and writes NOTHING for it', () => {
    const s = store();
    expect(queued(s, ID).queued).toBe(true);
    const second = queued(s, ID);
    expect(second.queued).toBe(false);
    // Not merely "the answer changed" — no second row exists. A dedupe that
    // answered honestly and inserted anyway would pass the line above.
    expect(due(s).length).toBe(1);
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(1);
  });

  it('declines a kickoff for a DIFFERENT program to the same session, deliberately', () => {
    // The dedupe key is (operator, null, toId, 'program-kickoff') — NOT
    // namespaced by slug. One session is one program's coordinator; a second
    // outstanding kickoff to a session that already has one unread is a thing
    // to refuse whatever program it names, and a slug-suffixed subject would
    // queue both and let the first one lose. Recorded as a narrowing, not an
    // oversight, and pinned so a later slug-in-the-subject "fix" is a decision
    // somebody has to make on purpose.
    const s = store();
    queueProgramKickoff({ coord: s }, ID, PROGRAM);
    const other = queued(s, ID, { slug: 'other-program', title: 'Other' });
    expect(other.queued).toBe(false);
    expect(due(s).length).toBe(1);
  });

  it('queues again once the first was ACKED — the guard is about outstanding mail, not history', () => {
    const s = store();
    const first = queued(s, ID);
    if (!first.queued) throw new Error('fixture: first kickoff was not queued');
    s.markDelivered(first.deliveryId, NOW);
    expect(s.markAcked(first.deliveryId, NOW)).toBe(true);
    expect(queued(s, ID).queued).toBe(true);
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(2);
  });

  // WAVE-4 REVIEW, MINOR 2 (D-1119). The kickoff is the FIRST system-mail
  // producer whose body embeds content an HTTP caller chose. `queueSystemMail`
  // inserts whatever it is handed; `MAIL_BODY_MAX_BYTES` is enforced at the
  // `POST /api/mail` ingress and by `dispatchRun` on its own composed brief —
  // and by nothing on this path. So the 8 KiB invariant `schema.ts` states in
  // a comment beside the column was silently false for the one producer a
  // caller can aim, and a title under Fastify's 1 MiB default landed twice in
  // `coord.db` and was served whole into the recipient's context.
  //
  // MEASURED ON THE COMPOSED BODY, not on the title — `dispatchRun`'s own
  // lesson, in its own words: a cap on the raw input lets an input at exactly
  // the ceiling through and queues a mail over it, so the two producers would
  // disagree about what 8 KiB means by exactly the length of a template.
  describe('the composed body is capped', () => {
    const base = Buffer.byteLength(programKickoff('build9-demo', ''), 'utf8');

    it('refuses a title that pushes the body over the cap, and writes NOTHING', () => {
      const s = store();
      const out = queueProgramKickoff({ coord: s }, ID,
        { slug: 'build9-demo', title: 'x'.repeat(MAIL_BODY_MAX_BYTES) });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error('unreachable — narrowed above');
      expect(out.kind).toBe('oversize');
      expect(out.limit).toBe(MAIL_BODY_MAX_BYTES);
      expect(due(s)).toEqual([]);
    });

    it('a title UNDER the cap still refuses when the template pushes it over', () => {
      // The half a title-scoped cap would miss. One byte of title under the
      // limit, and the sentence around it is what tips the body over.
      const s = store();
      const title = 'x'.repeat(MAIL_BODY_MAX_BYTES - 1);
      expect(Buffer.byteLength(title, 'utf8')).toBeLessThan(MAIL_BODY_MAX_BYTES);
      expect(queueProgramKickoff({ coord: s }, ID, { slug: 'build9-demo', title }).ok).toBe(false);
      expect(due(s)).toEqual([]);
    });

    it('a body at EXACTLY the cap is queued — the refusal is > and not >=', () => {
      const s = store();
      const title = 'x'.repeat(MAIL_BODY_MAX_BYTES - base);
      expect(Buffer.byteLength(programKickoff('build9-demo', title), 'utf8'))
        .toBe(MAIL_BODY_MAX_BYTES);
      const out = queueProgramKickoff({ coord: s }, ID, { slug: 'build9-demo', title });
      expect(out.ok).toBe(true);
      expect(due(s).length).toBe(1);
    });

    it('counts BYTES, not characters', () => {
      // The same char-vs-byte care `MAIL_BODY_MAX_BYTES`'s own docstring
      // demands. Half the cap in CHARACTERS, over it in UTF-8 bytes: a
      // `.length` cap would queue this.
      const s = store();
      const title = '𝄞'.repeat(Math.floor(MAIL_BODY_MAX_BYTES / 4));
      expect(title.length).toBeLessThan(MAIL_BODY_MAX_BYTES);
      expect(queueProgramKickoff({ coord: s }, ID, { slug: 'build9-demo', title }).ok).toBe(false);
      expect(due(s)).toEqual([]);
    });

    it('the slug counts too — it is in the body twice', () => {
      const s = store();
      expect(queueProgramKickoff({ coord: s }, ID,
        { slug: 'x'.repeat(MAIL_BODY_MAX_BYTES), title: 'T' }).ok).toBe(false);
      expect(due(s)).toEqual([]);
    });
  });

  it('two different sessions each get their own kickoff', () => {
    const s = store();
    expect(queued(s, ID).queued).toBe(true);
    expect(queued(s, 'demo-calm-ridge').queued).toBe(true);
    expect(due(s).length).toBe(2);
  });
});

// The RING pin, and the reason the decision does not live in `server.ts`.
//
// `server.ts` already imports `../inject/send.js` for the operator's own
// keystroke route (`POST /api/sessions/:id/prompt`, which this wave does not
// touch), so an import-absence scan there would be dead on arrival. Here it is
// a live mechanism: this module is where "the kickoff never injects" can be an
// architectural property instead of a per-fixture observation, and adding the
// import is the whole mutation.
describe('the kickoff seam has no way to type', () => {
  const src = readFileSync(new URL('../src/coord/kickoff.ts', import.meta.url), 'utf8');

  it('read a real module, not an empty string — a scan over nothing passes everything', () => {
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain('queueSystemMail');
    expect(src).toContain('queueProgramKickoff');
  });

  it('never imports the injector, and never names sendPrompt', () => {
    expect(src).not.toMatch(/from '\.\.\/inject\/send\.js'/);
    expect(src).not.toMatch(/\bsendPrompt\b/);
  });

  // NOTE: there is deliberately no handle-absence assertion here.
  // `single-definition.test.ts`'s coord-ring guard already scans every `.ts` in
  // this directory for `./db.js`, `node:sqlite` and a `coord.db` receiver, and a
  // second copy of one rule is the drift that suite exists to refuse. The first
  // draft of this file DID carry one, and its regex matched this module's own
  // PROSE about the rule — a pin that fails on a docstring is not a pin, it is a
  // second implementation of someone else's, done worse.
});
