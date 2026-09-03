// WAVE 0 (Build 9b) — mail hardening before any second producer exists
// (spec 2026-08-21-build9, D10). The store half: the dedupe guard's null
// arm (hole 1) and the two terminality guards (holes 3/4). The route half
// — quotas and the dark-behavior pin — lives in mail-peer-quota.test.ts.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { queueSystemMail } from '../src/coord/rundefs.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mailhard-'), '.ccrc', 'coord.db')));

const NOW = 1_000_000_000_000;

const openRun = (s: CoordStore) =>
  s.openRun({ program: 'build9b', title: 'Wave 0 fixture', project: 'demo',
              wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };

describe('hasOutstandingMail: the runId IS ? arm (D10 hole 1)', () => {
  it('finds an outstanding RUN-LESS mail — under `=` a bound NULL matches nothing, so the guard structurally could not fire', () => {
    const s = store();
    // Reseeded coordinator-sent for wave 4 (D-1041): the probe is sender-scoped
    // now, and this test is about the runId arm, not the sender arm. The
    // property it protects is that a bound NULL can match AT ALL — orthogonal to
    // who sent the row, and measured still-red under `IS` -> `=` after the
    // reseed rather than assumed to survive it.
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: 'demo-calm-ridge',
                             runId: null, kind: 'question', subject: 'peer q', body: 'x',
                             artifacts: [] });
    s.queueDelivery(m.id, 'demo-calm-ridge', '<mail>x</mail>');
    expect(s.hasOutstandingMail('coordinator', null, 'demo-calm-ridge', 'peer q')).toBe(true);
  });

  it('still finds a RUN mail by its number, and a run mail is NOT a run-less mail — IS is null-safe on both arms', () => {
    const s = store();
    const r = openRun(s);
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                             toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                             subject: 'wave-brief', body: 'go', artifacts: [] });
    s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
    expect(s.hasOutstandingMail('coordinator', r.id, 'demo-quiet-mesa', 'wave-brief')).toBe(true);
    // The null arm must select ONLY runId-IS-NULL rows — a run mail found by
    // the peer probe would dedupe a peer send against the coordinator's own
    // traffic, silently.
    expect(s.hasOutstandingMail('coordinator', null, 'demo-quiet-mesa', 'wave-brief')).toBe(false);
  });
});

// D-1041 (program-leverage wave 4). This guard's own killer. Until wave 4 the
// probe was keyed `(runId, toId, subject)` and its docstring justified omitting
// the sender: "the coordinator is its only sender". That was true only while
// every system mail carried a RUN. Wave 4 queues a system mail with `runId:
// null` — the program kickoff — which lands in the same key space as PEER mail,
// whose `subject` is caller-chosen free text nobody validates
// (`coord/routes.ts`'s own shape check bounds its BYTES and nothing else). So a
// peer mail that happened to be titled `program-kickoff` would have made
// `queueSystemMail` return with no row, no error and no record, and the new
// coordinator would have sat there un-briefed forever.
//
// The collision was one-way, which is why it had gone unnoticed: the peer lane
// deduped sender-scoped from the start (`hasOutstandingPeerDuplicate`), so a
// kickoff never blocks a peer — only a peer could swallow a kickoff.
describe('hasOutstandingMail is SENDER-scoped: one key space, two lanes (D-1041)', () => {
  it('sees only its own sender\'s outstanding mail, in the runId-IS-NULL space both lanes share', () => {
    const s = store();
    const sys = s.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: 'demo-calm-ridge',
                               runId: null, kind: 'status', subject: 'program-kickoff',
                               body: 'be the coordinator', artifacts: [] });
    s.queueDelivery(sys.id, 'demo-calm-ridge', '<mail>k</mail>');
    const peer = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u1', toId: 'demo-calm-ridge',
                                runId: null, kind: 'question', subject: 'program-kickoff',
                                body: 'what is this', artifacts: [] });
    s.queueDelivery(peer.id, 'demo-calm-ridge', '<mail>q</mail>');

    // Identical (runId, toId, subject) on both rows. ONLY the sender tells them
    // apart, and each probe must see its own and not the other's.
    expect(s.hasOutstandingMail('operator', null, 'demo-calm-ridge', 'program-kickoff')).toBe(true);
    expect(s.hasOutstandingMail('demo-quiet-mesa', null, 'demo-calm-ridge', 'program-kickoff')).toBe(true);
    expect(s.hasOutstandingMail('coordinator', null, 'demo-calm-ridge', 'program-kickoff')).toBe(false);
  });

  it('a peer mail cannot swallow a kickoff — the defect this guard exists for', () => {
    const s = store();
    const peer = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u1', toId: 'demo-calm-ridge',
                                runId: null, kind: 'question', subject: 'program-kickoff',
                                body: 'unrelated', artifacts: [] });
    s.queueDelivery(peer.id, 'demo-calm-ridge', '<mail>q</mail>');
    // The kickoff has not been queued yet. Un-scoped, this probe answered TRUE
    // and `queueSystemMail` returned without inserting anything.
    expect(s.hasOutstandingMail('operator', null, 'demo-calm-ridge', 'program-kickoff')).toBe(false);
  });
});

// The witness fixture for wave 4's "the run-mail lanes are unchanged" claim
// (D-1042). Widening `queueSystemMail` touched the write that dispatch, close
// and advance all use, and "unchanged" is worth nothing without a fixture that
// could see the change. `run-routes.test.ts`'s brief pin already witnesses the
// SENDER half (`from: coordinator` in the rendered envelope); this witnesses the
// DEDUPE half, which no route can reach — `RUN_TRANSITIONS.dispatched` has no
// self-edge, so a second dispatch 409s before the mail write, and only a retried
// close can re-enter the guard in production.
describe('queueSystemMail: the run-mail arm still dedupes, and now says so (D-1042)', () => {
  it('queues once, declines the identical second, and inserts nothing the second time', () => {
    const s = store();
    const r = openRun(s);
    const run = { program: 'build9b', wave: 1, waveOf: 1 };
    const m = { fromId: 'coordinator' as const, toId: 'demo-quiet-mesa', runId: r.id,
                kind: 'status' as const, subject: 'wave-brief', body: 'go' };

    const first = queueSystemMail(s, run, m);
    expect(first.queued).toBe(true);
    const due = s.dueDeliveries(NOW, 60_000);
    expect(due.length).toBe(1);
    // The sender half, at the seam rather than through a route: a widening that
    // let the sender drift would land here first.
    expect(due[0]!.envelope).toContain('from: coordinator');

    const second = queueSystemMail(s, run, m);
    expect(second.queued).toBe(false);
    // Not merely "the answer changed" — nothing was written.
    expect(s.dueDeliveries(NOW, 60_000).length).toBe(1);
  });

  it('a RUN-LESS system mail is queueable, carries no run line, and dedupes on its own key', () => {
    const s = store();
    const m = { fromId: 'operator' as const, toId: 'demo-calm-ridge', runId: null,
                kind: 'status' as const, subject: 'program-kickoff', body: 'be the coordinator' };

    const first = queueSystemMail(s, null, m);
    expect(first.queued).toBe(true);
    const due = s.dueDeliveries(NOW, 60_000);
    expect(due.length).toBe(1);
    expect(due[0]!.envelope).toContain('from: operator');
    // `renderEnvelope` gates the whole `run:` line on a non-null runId. A
    // positive assertion on ABSENCE, because that line is the run-less shape's
    // one visible difference and a regression would restore it silently.
    expect(due[0]!.envelope).not.toContain('run:');

    expect(queueSystemMail(s, null, m).queued).toBe(false);
    expect(s.dueDeliveries(NOW, 60_000).length).toBe(1);
  });
});

describe('terminality guards: markIngested and bumpReplayCount (D10 holes 3/4)', () => {
  const now = 1_000_000_000_000;

  /** One mail, one delivery, driven to `delivered` — the state both
   *  writers under test are only ever legitimately called in. */
  const deliveredRow = (s: CoordStore): { id: number } => {
    const r = openRun(s);
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                             toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                             subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
    s.markDelivered(d.id, now);
    return d;
  };

  it('markIngested leaves a PARKED row alone — the edge is not for a delivery already decided', () => {
    const s = store();
    const d = deliveredRow(s);
    s.rejectDelivery(d.id, 'undeliverable', 'parked at the ceiling');
    s.markIngested(d.id, now + 100);
    expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ ingestedAt: null });
  });

  it('markIngested leaves an ACKED row alone', () => {
    const s = store();
    const d = deliveredRow(s);
    expect(s.markAcked(d.id, now + 1)).toEqual({ ok: true, state: 'acked' });
    s.markIngested(d.id, now + 100);
    expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ ingestedAt: null });
  });

  it('markIngested still stamps a live delivered row', () => {
    const s = store();
    const d = deliveredRow(s);
    s.markIngested(d.id, now + 100);
    expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ ingestedAt: now + 100 });
  });

  it('bumpReplayCount counts a live replay, as a state and a number', () => {
    const s = store();
    const d = deliveredRow(s);
    expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 1 });
    expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 2 });
  });

  it('bumpReplayCount answers {state:"terminal"} for a parked or acked row and leaves the counter alone', () => {
    // The union is the fix, not the guard (D10): a guard that still
    // returned a bare unchanged number would read as "not yet at the
    // ceiling" for a row already parked — two conditions, one value, at a
    // seam.
    const s = store();
    const parked = deliveredRow(s);
    s.rejectDelivery(parked.id, 'undeliverable', 'parked at the ceiling');
    expect(s.bumpReplayCount(parked.id)).toEqual({ state: 'terminal' });
    expect(s.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?').get(parked.id))
      .toEqual({ replayCount: 0 });

    const acked = deliveredRow(s);
    expect(s.markAcked(acked.id, now + 1)).toEqual({ ok: true, state: 'acked' });
    expect(s.bumpReplayCount(acked.id)).toEqual({ state: 'terminal' });
    expect(s.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?').get(acked.id))
      .toEqual({ replayCount: 0 });
  });

  // D-1408. `noteGate` is hole 3/4's sibling and shipped WITH
  // its guard — and with nothing that measures it: every `noteGate` call in the
  // suite is on a fresh `queued` row, so deleting the guard left everything
  // green. The gate columns are the one place a terminal row could acquire a
  // fresh claim that something is still holding it.
  const gates = (s: CoordStore, id: number) => s.db.prepare(
    'SELECT lastGate, gateAt, gateCount, gateSince FROM mail_deliveries WHERE id = ?',
  ).get(id) as { lastGate: string | null; gateAt: number | null;
                 gateCount: number; gateSince: number | null };

  /** The fixture's own proof. Both setup calls below (`rejectDelivery`,
   *  `markAcked`) carry terminality guards of their OWN and can decline in
   *  silence — `rejectDelivery` returns void, so a declined park is
   *  indistinguishable from a taken one at the call site. Without this the
   *  "gate columns unchanged" assertion could pass for a row that never
   *  reached the state the test names, i.e. it would measure nothing. */
  const stateOf = (s: CoordStore, id: number) => (s.db.prepare(
    'SELECT state FROM mail_deliveries WHERE id = ?',
  ).get(id) as { state: string }).state;

  it('noteGate leaves a PARKED row\'s gate columns alone — nothing is holding an abandoned delivery', () => {
    const s = store();
    const d = deliveredRow(s);
    s.rejectDelivery(d.id, 'undeliverable', 'parked at the ceiling');
    expect(stateOf(s, d.id)).toBe('rejected');
    // `rejectDelivery` clears all four columns on the way in (its own statement
    // sets `lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL`),
    // so this is the honest starting point, not an assumption. `gateCount` is
    // `INTEGER NOT NULL DEFAULT 0` in the schema, hence 0 rather than null.
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
    s.noteGate(d.id, 'not-idle', now + 100, false, null);
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
  });

  it('noteGate leaves an ACKED row\'s gate columns alone', () => {
    const s = store();
    const d = deliveredRow(s);
    expect(s.markAcked(d.id, now + 1)).toEqual({ ok: true, state: 'acked' });
    expect(stateOf(s, d.id)).toBe('acked');
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
    s.noteGate(d.id, 'not-idle', now + 100, false, null);
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
  });

  it('noteGate still records a gate on a live delivered row', () => {
    // The positive control. Without it the two assertions above are satisfied
    // by a `noteGate` that writes nothing at all, on any row.
    const s = store();
    const d = deliveredRow(s);
    s.noteGate(d.id, 'not-idle', now + 100, false, null);
    expect(gates(s, d.id)).toEqual({ lastGate: 'not-idle', gateAt: now + 100,
                                     gateCount: 1, gateSince: now + 100 });
  });
});

// D-1411. The audit, as a mechanism instead of a sentence.
// Every `UPDATE mail_deliveries` in the store must name one of the TWO shared
// guard fragments — `OUTSTANDING_STATES_SQL` (the positive form: this write is
// only for a row still in play) or `TERMINAL_DELIVERY_SQL` (the negative form:
// this write is for any row that is not finished). A hand-written state list
// fails this too, which is deliberate: it is the same rule the single-definition
// scans state, said once more at the point of use.
//
// This is what lets `CLAUDE.md`'s "Open on main" section stop hedging. It scans
// TEXT, and that limitation is worth stating: it cannot tell a guard that is
// correct from one that is merely present, and it does not reach `server/test`,
// where a fixture may still write raw SQL (`coord-health.test.ts` does, on
// purpose). The bar is "a twelfth writer added in the ordinary way is stopped
// before review".
describe('every delivery-row writer names a shared terminality guard (wave 8)', () => {
  const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const storeSrc = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
  const srcLines = storeSrc.split('\n');

  /** A single-line method signature at class-member indent, e.g.
   *  `  markIngested(id: number, at: number): void {`. Single-line ON PURPOSE:
   *  the walk-back below names the writer by finding the nearest one above the
   *  statement, and a signature split across lines would silently attribute a
   *  statement to the PREVIOUS method. The `^  }` check guards exactly that. */
  const SIG = /^ {2}(?:private |public |static |readonly )*([A-Za-z_$][\w$]*)\(.*\)\s*:\s*(.+?)\s*\{\s*$/;

  /** Every prepared statement in `store.ts` that writes a delivery row, sliced
   *  from `this.db.prepare(` to the call that executes it, and tagged with the
   *  method it lives in. Anchored on `prepare(` rather than on the SQL verb so
   *  that PROSE naming the table — a docstring explaining one of these guards —
   *  can never be counted as a twelfth statement. */
  const writers = (): { line: number; method: string; returns: string; text: string }[] => {
    const out: { line: number; method: string; returns: string; text: string }[] = [];
    const EXEC = /\.(?:run|get|all|iterate)\(/;
    for (const m of storeSrc.matchAll(/this\.db\.prepare\(/g)) {
      const at = m.index!;
      const rest = storeSrc.slice(at);
      const e = EXEC.exec(rest);
      expect(e, `the prepare( at offset ${at} never reaches an execution call`).not.toBeNull();
      const text = rest.slice(0, e!.index);
      if (!/UPDATE mail_deliveries\b/.test(text)) continue;
      const line = storeSrc.slice(0, at).split('\n').length;
      let sigLine = 0;
      for (let i = line - 1; i > 0; i--) { if (SIG.test(srcLines[i - 1]!)) { sigLine = i; break; } }
      expect(sigLine, `no method signature above the delivery write at store.ts:${line}`)
        .toBeGreaterThan(0);
      // If a method CLOSED between that signature and this statement, the
      // walk-back left its own method and the name below would be a lie.
      const between = srcLines.slice(sigLine, line - 1).join('\n');
      expect(/^ {2}\}/m.test(between),
        `the walk-back from store.ts:${line} crossed a method close — its signature is not single-line`)
        .toBe(false);
      const sig = SIG.exec(srcLines[sigLine - 1]!)!;
      out.push({ line, method: sig[1]!, returns: sig[2]!, text });
    }
    return out;
  };

  it('finds every one of them — a renamed table or a rewritten call shape must red this, not disarm it', () => {
    const found = writers();
    // A FLOOR, not a count: eleven at 5e9f650d (2026-09-02), and a twelfth
    // writer raises it rather than breaking it. Without this the assertion in
    // the next test is satisfied by an extractor that found nothing.
    expect(found.length).toBeGreaterThanOrEqual(11);
    // …and each window is a STATEMENT, not a runaway slice that swallowed the
    // next method's docstring. Measured max: 498 characters at 5e9f650d, 502
    // once this wave's guards landed — `markDelivered`'s window is the long
    // one. The 1000 is a plausibility ceiling with room above the measurement,
    // not a second count.
    for (const w of found) {
      expect(w.text.includes('*/'), `store.ts:${w.line}'s window swallowed a docstring`).toBe(false);
      expect(w.text.length, `store.ts:${w.line}'s window is implausibly long`).toBeLessThan(1000);
      expect(w.method.length, `store.ts:${w.line} resolved to an empty method name`).toBeGreaterThan(0);
    }
    // Eleven statements in eleven distinct methods — a duplicate name means the
    // walk-back attributed two statements to one signature.
    expect(new Set(found.map((w) => w.method)).size).toBe(found.length);
  });

  it('names OUTSTANDING_STATES_SQL or TERMINAL_DELIVERY_SQL, never a hand-written state list', () => {
    for (const w of writers()) {
      expect(/OUTSTANDING_STATES_SQL|TERMINAL_DELIVERY_SQL/.test(w.text),
        `store.ts:${w.line} (${w.method}) writes a delivery row with no shared terminality guard`).toBe(true);
    }
  });

  it("CLAUDE.md names exactly the delivery-row writers that still return void", () => {
    // THE OTHER HALF OF THE SENTENCE, as a mechanism. The clause this replaces
    // sat unreworded from 2026-08-12 while three guard commits landed after it,
    // because nothing measured it. This derives the list from source and
    // compares both directions, so widening one of these writers reds here and
    // the sentence has to move with the code.
    const md = readFileSync(path.join(ccrcRoot, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
    // Flattened first, the way `box-token-census.test.ts` flattens its own
    // corpus and for the same reason: this is hard-wrapped prose and a
    // backticked name routinely sits either side of a newline.
    const MARK = 'still return `void` are ';
    expect(md, 'CLAUDE.md no longer carries the void-writer sentence this test reads')
      .toContain(MARK);
    const span = md.slice(md.indexOf(MARK) + MARK.length);
    const listed = span.slice(0, span.indexOf('.'));
    const named = [...listed.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]!);
    expect(named, 'the void-writer list in CLAUDE.md came out empty — was the sentence reworded?')
      .not.toEqual([]);
    const voids = writers().filter((w) => w.returns === 'void').map((w) => w.method);
    expect([...named].sort(), 'CLAUDE.md and store.ts disagree about which delivery writers return void')
      .toEqual([...voids].sort());
  });

  // D-1409, the half of it that was still a promise. `setDeliveryEnvelope` was
  // widened from `void` to `SetEnvelopeResult` "so the guard is not invisible"
  // — but TypeScript does not require a caller to consume a returned value, so
  // that half rested on author discipline alone. MEASURED: reverting both call
  // sites to the bare one-liner leaves `tsc` clean and 497 tests across nine
  // suites green. A union nobody reads is a `void` with extra characters, and
  // Task 61 of this same wave adds a THIRD call site, so the rule has to be
  // enforced on call sites this test has never seen.
  //
  // SCOPE LIMITS, stated because this is a text scan and cannot tell a correct
  // check from a present one:
  //   • It pins ONE consumption shape — bind the result to a name, then read
  //     `<name>.ok` within the following 40 lines. A destructuring call site
  //     (`const { ok } = …`) is CORRECT and would still red here. That is a
  //     deliberate trade: a false red on a new-but-valid shape costs one edit
  //     to this scan, while a loose scan costs the guarantee.
  //   • It sees `server/src` only, and only files ending `.ts`.
  //   • Comment lines are blanked before matching, so prose mentioning the
  //     method is not a call site — proved on this file's own corpus below.
  //   • It cannot see whether the `.ok` branch does anything USEFUL; the
  //     behavioural half is `coord-store.test.ts`'s refusal tests.
  it('every setDeliveryEnvelope call site consumes the result and checks it (D-1409)', () => {
    const CALL = /[A-Za-z_$][\w$]*\.setDeliveryEnvelope\(/;
    const BOUND = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\.setDeliveryEnvelope\(/;
    // The premises, established here rather than assumed: without them the
    // loop below is satisfied by a regex that matches nothing, or by one that
    // counts the DEFINITION (which has no receiver) as a call site.
    expect(CALL.test('    const stamped = coord.setDeliveryEnvelope(delivery.id, envelope);')).toBe(true);
    expect(CALL.test('    coord.setDeliveryEnvelope(delivery.id, envelope);')).toBe(true);
    expect(CALL.test('  setDeliveryEnvelope(id: number, envelope: string): SetEnvelopeResult {')).toBe(false);
    expect(BOUND.exec('    const stamped = coord.setDeliveryEnvelope(a, b);')?.[1]).toBe('stamped');
    expect(BOUND.exec('    coord.setDeliveryEnvelope(a, b);')).toBeNull();

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith('.ts')) files.push(f);
      }
    };
    walk(path.join(ccrcRoot, 'server/src'));
    expect(files.length, 'the walk over server/src found no TypeScript at all').toBeGreaterThan(20);

    const sites: { at: string; bound: string | null; checked: boolean }[] = [];
    for (const f of files) {
      // Comment lines are BLANKED rather than removed, so the index below
      // still names the real line of the file. Same idiom, and the same
      // stated cost, as `single-definition.test.ts`'s literal scans.
      const code = readFileSync(f, 'utf8').split('\n')
        .map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l));
      for (let i = 0; i < code.length; i++) {
        if (!CALL.test(code[i]!)) continue;
        const name = BOUND.exec(code[i]!)?.[1] ?? null;
        const after = code.slice(i + 1, i + 41).join('\n');
        sites.push({
          at: `${path.relative(ccrcRoot, f)}:${i + 1}`,
          bound: name,
          checked: name !== null && new RegExp(`\\b${name}\\.ok\\b`).test(after),
        });
      }
    }

    // THE ANTI-VACUITY FLOOR. Two call sites at f7421733 (`rundefs.ts`'s
    // `queueSystemMail` and `routes.ts`'s mail-send route); Task 61 adds a
    // third and raises this rather than breaking it. Without the floor a scan
    // that found nothing — a renamed method, a broken walk, an over-eager
    // comment strip — passes silently, which is the failure this wave has hit
    // more than once.
    expect(sites.length, 'no setDeliveryEnvelope call site found in server/src at all')
      .toBeGreaterThanOrEqual(2);
    // …and the comment strip really did strip: `store.ts` and `routes.ts` both
    // discuss this method in prose, and prose is not a call site.
    expect(sites.map((s) => s.at).filter((a) => a.startsWith('server/src/coord/store.ts')),
      'a mention of setDeliveryEnvelope inside store.ts was counted as a call site').toEqual([]);

    for (const s of sites) {
      expect(s.bound,
        `${s.at} discards setDeliveryEnvelope's result — the refusal it carries is invisible there, `
        + 'which is the exact defect D-1409 widened the return type to fix').not.toBeNull();
      expect(s.checked,
        `${s.at} binds setDeliveryEnvelope's result as \`${s.bound}\` but never reads \`${s.bound}.ok\``)
        .toBe(true);
    }
  });
});
