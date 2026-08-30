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
import { queueProgramKickoff } from '../src/coord/kickoff.js';
import { PROGRAM_KICKOFF_SUBJECT, programKickoff } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const ID = 'demo-quiet-mesa';
const PROGRAM = { slug: 'build9-demo', title: 'Build 9 demo' };

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-kickoff-'), '.ccrc', 'coord.db')));

const due = (s: CoordStore) => s.dueDeliveries(NOW, 60_000);

describe('queueProgramKickoff — the kickoff is MAIL, and it says which kind of answer it gave', () => {
  it('queues one mail and one delivery, and reports the ids it wrote', () => {
    const s = store();
    const out = queueProgramKickoff({ coord: s }, ID, PROGRAM);
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
    expect(queueProgramKickoff({ coord: s }, ID, PROGRAM).queued).toBe(true);
    const second = queueProgramKickoff({ coord: s }, ID, PROGRAM);
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
    const other = queueProgramKickoff({ coord: s }, ID, { slug: 'other-program', title: 'Other' });
    expect(other.queued).toBe(false);
    expect(due(s).length).toBe(1);
  });

  it('queues again once the first was ACKED — the guard is about outstanding mail, not history', () => {
    const s = store();
    const first = queueProgramKickoff({ coord: s }, ID, PROGRAM);
    if (!first.queued) throw new Error('fixture: first kickoff was not queued');
    s.markDelivered(first.deliveryId, NOW);
    expect(s.markAcked(first.deliveryId, NOW)).toBe(true);
    expect(queueProgramKickoff({ coord: s }, ID, PROGRAM).queued).toBe(true);
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(2);
  });

  it('two different sessions each get their own kickoff', () => {
    const s = store();
    expect(queueProgramKickoff({ coord: s }, ID, PROGRAM).queued).toBe(true);
    expect(queueProgramKickoff({ coord: s }, 'demo-calm-ridge', PROGRAM).queued).toBe(true);
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
