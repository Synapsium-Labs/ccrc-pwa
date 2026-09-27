# Routing slice 2 — the skills: coordinator clauses 12 and 13, the routing matrix and the held-out panel as references, worker clauses 14 and 15, the routing sentence in the brief, and the wave-done signal lines the server reads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the routing strategy where the deciders read it — the coordinator skill gains a clause that makes every brief name the wave's shape and routing and a clause that routes every handoff review through a held-out Opus panel; the worker skill gains a clause that routes its own subagents by task shape with class and effort named on every call, and a clause that opens every wave-done with two signal lines (`suite:`, `failure:`) the server parses into the run's signals — with no wire, envelope or ccd change, and no behaviour change for a run whose worker sends no signal lines.

**Architecture:** Two new coordinator references, `routing-matrix.md` (spec §3 verbatim) and `review-panel.md` (a Workflow script whose every `agent()` call carries literal `model:` and `effort:`), each in `REQUIRED_REFS` and pinned by a parity test that harvests the matrix's class and effort words from `shared/models.mjs` and ccd's own `ROUTE_EFFORTS`, and the panel's literals from the fenced script. Four new contract clauses, each a `CONTRACT` literal, a numbered item and the count word at every site the two skill tests derive. One L0 grammar in `shared/api.ts` (`SUITE_WORDS`, `FAILURE_KINDS`, `parseWaveDoneSignals`) with three answers per line — a value, absent, unrecognised — read at `runSignals` time from the LAST `status`/`wave-done` mail the run's own worker sent, so the mail row stays the record and nothing new is written at ingress. `renderEnvelope` and `parseMailEnvelope` are untouched; a round-trip pin proves the signal lines ride inside `body`.

**Tech Stack:** Markdown skills and references, TypeScript (`shared/api.ts`, `server/src/coord/store.ts`), vitest, bash (`ccd/install-coordinator-skill.sh`), the Workflow tool's script grammar (`review-panel.md`).

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §2 (the quality gate and the held-out panel), §3 (the matrix), §4 (the decider, the two references, `REQUIRED_REFS`, the twelfth and thirteenth clauses), §5.5 (skills and workflow agents; the body-line grammar; "count the sites from the test"), §6 (`suite:` as the first-run signal), §7 slice 2, §8 rows 13 and 16. Slices 0 and 1 are merged (`c5dd6e41`); this plan builds on them and changes nothing they shipped.

## Global Constraints

- **Every new clause is three things in one commit** (spec §5.5): a `CONTRACT` literal in the skill's test, a numbered item in `SKILL.md`, and the count word at EVERY site the test derives — for the coordinator: `SKILL.md`'s "These <n> sentences", README.md and CLAUDE.md wherever `ccd/coordinator-skill/SKILL.md` is named (a count word within 160 characters, whitespace-tolerant); for the worker: `SKILL.md`'s "These <n> clauses" AND "these <n> lines", README.md (three sites today) and CLAUDE.md wherever `ccd/worker-skill/SKILL.md` is named. Count the sites by running the test, never from memory: `coordinator-skill.test.ts` "spells that same count" and `worker-skill.test.ts` "spells that same count" name every site they read.
- **Worker clauses carry STRAIGHT apostrophes and NO double-quote character** (D-104; `worker-skill.test.ts`'s literals are double-quoted). Coordinator clauses may carry curly apostrophes only if the test literal carries the same bytes; the clauses below carry none, deliberately.
- **The coordinator's contract is scoped**: `coordinator-skill.test.ts` numbers the `## The contract` section alone; the worker test numbers the WHOLE file, so no new numbered list anywhere in `ccd/worker-skill/SKILL.md`.
- **Route corpus.** Both new references join `coordinator-skill.test.ts`'s `routeSkillText` (everything but `mail-envelope.md`): a `GET /api/…` or `POST /api/…` token in either file must be a route `server/src/coord/routes.ts` registers with that method. Neither file below names one.
- **Destructive-verb census.** `ws-reap`, `ws-rm`, `ws-gc` appear in the coordinator corpus ONLY in clause 3; the five verbs appear in the worker skill ONLY in clause 8. No new file or clause names any of them.
- **`REQUIRED_REFS` is the references directory** (`wrapper-roster-fixture.test.ts` I8, both directions): a file added under `ccd/coordinator-skill/references/` is added to `ccd/install-coordinator-skill.sh`'s array in the same commit. The worker skill ships no `references/` of its own (`worker-skill.test.ts` pins `readdirSync(skillDir) === ['SKILL.md']`) and points at the coordinator's.
- **The held-out panel's model and effort are LITERAL** in `review-panel.md`'s script — `model: 'opus'`/`'sonnet'`, `effort: 'high'` on every `agent()` call, never a variable, never inherited (spec §2, §8 row 13). `fable` appears nowhere in that file.
- **Body-line signals never touch the envelope** (spec §8 row 16): `renderEnvelope`, `parseMailEnvelope`, `EnvelopeInput` and `MailEnvelope` are not modified; the grammar is strictly the first two lines of `body`.
- **Three answers per signal line, never two:** a recognised value, `absent`, `unrecognised`. A run whose worker sent no wave-done carries `signals: null` — a fourth condition, distinct from all three.
- **Wire discipline:** `RunSignals` grows two fields additively; `FLEET_PROTO` is not bumped; `GET /api/runs/:id/signals` keeps its shape and gate.
- **L0 imports nothing** (`shared/api.ts`); the store reads the vocabulary from it, never a second copy.
- **`ledger-template.md` is pinned verbatim** (`coordinator-skill.test.ts:512`) and `mail-envelope.md`'s example is `renderEnvelope`'s real output — neither changes in this slice.
- **AGENT-FIRST** for everything under `ccd/` (both skills ship on the agent lane's rsync + installers); **FIXTURE HOMEs only** in tests; suites from inside the package, foreground, `timeout ≥ 600000`, never bare `npx vitest`; **D-numbers are issued** by the allocator (`ccrc-api ledger allocate`), never looked up — the allocator's stdout ends `}http 201` on the SAME line; **no account names** in shipped source or docs.
- **Never touch the live fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units by hand.** Task 6's gate reads only.

---

## File structure

| File | Responsibility |
|---|---|
| `shared/api.ts` | `SUITE_WORDS`, `SuiteWord`, `FAILURE_KINDS`, `FailureKind`, `WAVE_DONE_SUBJECT`, `SignalLine<T>`, `WaveDoneSignals`, `parseWaveDoneSignals`; `RunSignals` gains `waveDoneMails` and `signals` |
| `server/src/coord/store.ts` | `runSignals` reads the worker's last `wave-done` body and parses it |
| `ccd/coordinator-skill/references/routing-matrix.md` | spec §3 verbatim (the table and its rules), plus how a row changes |
| `ccd/coordinator-skill/references/review-panel.md` | the held-out panel: three Opus lenses, three Sonnet refuters per finding, the Workflow script, the unverified rule |
| `ccd/install-coordinator-skill.sh` | `REQUIRED_REFS` gains both files |
| `server/src/skillstate.ts` | the D-1027 docstring's reference count |
| `ccd/coordinator-skill/SKILL.md` | clauses 12 and 13; "These thirteen sentences"; step 2 names shape and routing; step 5 names the panel |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | §2 brief list gains shape and routing; §4 documents the two signal lines; §5 opens with the panel; the signals section names the two new fields |
| `ccd/worker-skill/SKILL.md` | clauses 14 and 15; "These fifteen clauses" / "these fifteen lines"; a routing section pointing at the matrix; the wave-done section shows the signal lines |
| `README.md`, `CLAUDE.md` | the count words at every derived site; one paragraph each on the new clauses |
| tests | `server/test/wave-done-signals.test.ts` (new), `mail-envelope-parse.test.ts`, `run-signals.test.ts`, `routing-references.test.ts` (new), `install-coordinator-skill.test.ts`, `coordinator-skill.test.ts`, `worker-skill.test.ts` |
| `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` | §6 row for slice 2's gate |

---

### Task 1: The signal-line grammar in L0, and the proof it never touches the envelope

**Files:**
- Modify: `shared/api.ts` (beside `DONE_AUTHORITY_CODES`)
- Test: `server/test/wave-done-signals.test.ts` (new), `server/test/mail-envelope-parse.test.ts`

**Interfaces:**
- Consumes: nothing (L0).
- Produces: `SUITE_WORDS: readonly ['green','red','unrun']`, `type SuiteWord`, `FAILURE_KINDS: readonly ['shallow','ceiling','unclear']`, `type FailureKind`, `WAVE_DONE_SUBJECT = 'wave-done'`, `type SignalLine<T> = {ok:true; value:T} | {ok:false; why:'absent'} | {ok:false; why:'unrecognised'}`, `interface WaveDoneSignals { suite: SignalLine<SuiteWord>; failure: SignalLine<FailureKind> }`, `parseWaveDoneSignals(body: string): WaveDoneSignals`. Task 2 reads all of them; Tasks 4 and 5 import the two arrays into the skill tests.

- [ ] **Step 1: Write the failing tests**

Create `server/test/wave-done-signals.test.ts`:

```ts
// Routing spec 2026-09-14 §5.5 — the two signal lines a worker's `wave-done`
// body opens with, parsed by ONE L0 function the store and the skill tests
// share. Three answers per line (a value, absent, unrecognised): a worker on an
// older skill that sends no line is never read as a typo, and a typo is never
// read as silence.
import { describe, it, expect } from 'vitest';
import {
  FAILURE_KINDS, SUITE_WORDS, WAVE_DONE_SUBJECT, parseWaveDoneSignals,
  type FailureKind, type SuiteWord, type WaveDoneSignals,
} from '../../shared/api.js';

/** Derived from the UNION, `worker-skill.test.ts`'s `ALL_PHASES` idiom: a
 *  fourth member forces a key here (the tests directory is typechecked). */
const ALL_SUITE: Record<SuiteWord, true> = { green: true, red: true, unrun: true };
const ALL_FAILURE: Record<FailureKind, true> = { shallow: true, ceiling: true, unclear: true };

const absent = { ok: false, why: 'absent' } as const;
const unrec = { ok: false, why: 'unrecognised' } as const;

describe('the wave-done signal vocabularies', () => {
  it('are closed at three words each, and the arrays are the type', () => {
    expect([...SUITE_WORDS].sort()).toEqual(Object.keys(ALL_SUITE).sort());
    expect([...FAILURE_KINDS].sort()).toEqual(Object.keys(ALL_FAILURE).sort());
    expect(WAVE_DONE_SUBJECT).toBe('wave-done');
  });
});

describe('parseWaveDoneSignals', () => {
  it.each([...SUITE_WORDS])('reads suite: %s on the first line', (w) => {
    expect(parseWaveDoneSignals(`suite: ${w}\n{"branchTip":"x"}`))
      .toEqual<WaveDoneSignals>({ suite: { ok: true, value: w }, failure: absent });
  });

  it.each([...FAILURE_KINDS])('reads failure: %s on the second line', (k) => {
    expect(parseWaveDoneSignals(`suite: red\nfailure: ${k}\nprose`))
      .toEqual<WaveDoneSignals>({ suite: { ok: true, value: 'red' }, failure: { ok: true, value: k } });
  });

  it('reads the two lines in either order', () => {
    expect(parseWaveDoneSignals('failure: ceiling\nsuite: red\n'))
      .toEqual({ suite: { ok: true, value: 'red' }, failure: { ok: true, value: 'ceiling' } });
  });

  it('a word outside the vocabulary is UNRECOGNISED, never absent and never a value', () => {
    expect(parseWaveDoneSignals('suite: passed\nfailure: flaky'))
      .toEqual({ suite: unrec, failure: unrec });
  });

  it('a body with no signal lines is absent on both — an older worker, not a typo', () => {
    expect(parseWaveDoneSignals('{"branchTip":"x"}')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('')).toEqual({ suite: absent, failure: absent });
  });

  it('the lines must be the FIRST lines: a signal after prose or JSON is not read', () => {
    expect(parseWaveDoneSignals('{"branchTip":"x"}\nsuite: green')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('suite: green\n\nfailure: ceiling'))
      .toEqual({ suite: { ok: true, value: 'green' }, failure: absent });
  });

  it('a third line is never a signal line, and the first of a repeated key wins', () => {
    expect(parseWaveDoneSignals('suite: green\nsuite: red\nfailure: ceiling'))
      .toEqual({ suite: { ok: true, value: 'green' }, failure: absent });
  });

  it('the grammar is exact: one space after the colon, nothing after the word', () => {
    expect(parseWaveDoneSignals('suite:green')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('suite: green (first run)')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('Suite: green')).toEqual({ suite: absent, failure: absent });
  });

  it('tolerates CRLF and trailing spaces, which a pasted body may carry', () => {
    expect(parseWaveDoneSignals('suite: unrun \r\nfailure: unclear\r\n'))
      .toEqual({ suite: { ok: true, value: 'unrun' }, failure: { ok: true, value: 'unclear' } });
  });
});
```

Append to `server/test/mail-envelope-parse.test.ts` (imports: add `WAVE_DONE_SUBJECT, parseWaveDoneSignals` to the `shared/api.js` import):

```ts
// Routing spec 2026-09-14 §5.5 / §8 row 16 — the signal lines are BODY, never
// header. The mutation this reds on: a `suite:` line emitted by `renderEnvelope`
// above the `--` terminator (or read by `parseMailEnvelope` as a header).
describe('body-line signals never touch the envelope (routing slice 2)', () => {
  const body = 'suite: red\nfailure: ceiling\n{"branchTip":"a","prNumber":null,"prPhase":"none","handoffCommit":"a"}';
  const input: EnvelopeInput = { ...BASE, kind: 'status', subject: WAVE_DONE_SUBJECT, body };

  it('the header above `--` carries no suite:/failure: line', () => {
    const text = renderEnvelope(input);
    const cut = text.indexOf('\n--\n');
    expect(cut).toBeGreaterThan(0);
    expect(text.slice(0, cut)).not.toMatch(/^(suite|failure): /m);
  });

  it('the lines round-trip inside `body`, verbatim, and parse from there', () => {
    const parsed = parseMailEnvelope(renderEnvelope(input));
    expect(parsed).toEqual({ ok: true, envelope: expectedFrom(input) });
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.envelope.body.startsWith('suite: red\nfailure: ceiling\n')).toBe(true);
    expect(parseWaveDoneSignals(parsed.envelope.body))
      .toEqual({ suite: { ok: true, value: 'red' }, failure: { ok: true, value: 'ceiling' } });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/wave-done-signals.test.ts test/mail-envelope-parse.test.ts`
Expected: FAIL — `parseWaveDoneSignals` is not exported (a TS2305 on both files).

- [ ] **Step 3: Implement the grammar**

In `shared/api.ts`, directly after the `DoneRejectCode` type and its "NO `isDoneRejectCode` PREDICATE" comment block, add:

```ts
/** Routing spec 2026-09-14 §5.5 — the subject a worker's done-claim mail
 *  carries (`kind: 'status'`). ONE spelling: `runSignals` (`coord/store.ts`)
 *  selects on it and the skills quote it. `close.ts`'s `wave-done-rejected`
 *  is a different subject (the server's answer), deliberately not derived. */
export const WAVE_DONE_SUBJECT = 'wave-done';

/** The first-run suite word a worker reports (spec §6: "suite green on first
 *  run" is a QUALITY signal; fix rounds are counted on the spend side). */
export const SUITE_WORDS = ['green', 'red', 'unrun'] as const;
export type SuiteWord = (typeof SUITE_WORDS)[number];

/** The failure KIND a worker names when a check failed, so the coordinator can
 *  choose the escalation rung (spec §3 "Escalation"): `shallow` raises effort,
 *  `ceiling` raises class, `unclear` defaults to effort-first. */
export const FAILURE_KINDS = ['shallow', 'ceiling', 'unclear'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** ONE signal line, three answers, never two. `absent` is a worker that sent
 *  no such line (an older skill, or nothing to say); `unrecognised` is a line
 *  that WAS sent with a word outside the vocabulary — a mechanism defect to
 *  surface, which "absent" would hide. */
export type SignalLine<T extends string> =
  | { ok: true; value: T }
  | { ok: false; why: 'absent' }
  | { ok: false; why: 'unrecognised' };

export interface WaveDoneSignals {
  suite: SignalLine<SuiteWord>;
  failure: SignalLine<FailureKind>;
}

const SIGNAL_LINE = /^(suite|failure): (\S+)$/;

/**
 * Read the two signal lines off a `wave-done` body (spec §5.5): the FIRST two
 * lines only, in either order, exact grammar `key: word`. The walk stops at
 * the first line that is not a signal line, so a `suite:` inside later prose
 * or JSON is never read as a claim. The first of a repeated key wins.
 *
 * Never throws; never reads the envelope — the caller hands it `body`, which
 * `parseMailEnvelope` returns verbatim below the `--` terminator, or the
 * `mail.body` column, which is the same bytes.
 */
export function parseWaveDoneSignals(body: string): WaveDoneSignals {
  let suite: SignalLine<SuiteWord> = { ok: false, why: 'absent' };
  let failure: SignalLine<FailureKind> = { ok: false, why: 'absent' };
  for (const raw of body.split('\n', 2)) {
    const m = SIGNAL_LINE.exec(raw.replace(/\r$/, '').trimEnd());
    if (!m) break;
    const word = m[2] as string;
    if (m[1] === 'suite') {
      if (suite.ok || suite.why !== 'absent') continue;
      suite = (SUITE_WORDS as readonly string[]).includes(word)
        ? { ok: true, value: word as SuiteWord } : { ok: false, why: 'unrecognised' };
    } else {
      if (failure.ok || failure.why !== 'absent') continue;
      failure = (FAILURE_KINDS as readonly string[]).includes(word)
        ? { ok: true, value: word as FailureKind } : { ok: false, why: 'unrecognised' };
    }
  }
  return { suite, failure };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/wave-done-signals.test.ts test/mail-envelope-parse.test.ts test/typecheck-tests.test.ts`
Expected: PASS (typecheck-tests is the load flake — re-run in isolation before calling it real).

- [ ] **Step 5: Mutation check, measured**

Temporarily make `renderEnvelope` push `` `suite: ${m.body.split('\n')[0]}` `` as a header line before `kind:`; run `test/mail-envelope-parse.test.ts` → the new describe's first test reds on the header regex. Revert. Temporarily change `SIGNAL_LINE` to `/^(suite|failure): (\S+)/` (no `$`) → "the grammar is exact" reds on `suite: green (first run)`. Revert. Record both in the commit message.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/test/wave-done-signals.test.ts server/test/mail-envelope-parse.test.ts
git commit -m "feat(routing): the wave-done signal grammar in L0 — suite:/failure: lines, three answers each, body only (routing slice 2, Task 1)"
```

---

### Task 2: `runSignals` reads the worker's last wave-done body

**Files:**
- Modify: `shared/api.ts` (`RunSignals`), `server/src/coord/store.ts` (`runSignals`)
- Test: `server/test/run-signals.test.ts`

**Interfaces:**
- Consumes: Task 1's `WAVE_DONE_SUBJECT`, `parseWaveDoneSignals`, `WaveDoneSignals`; `insertMail` (`store.ts`); the `mail` table (`runId`, `fromId`, `kind`, `subject`, `body`).
- Produces: `RunSignals.waveDoneMails: number` and `RunSignals.signals: WaveDoneSignals | null`, served unchanged by `GET /api/runs/:id/signals`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/run-signals.test.ts` (add `WAVE_DONE_SUBJECT` to the `shared/api.js` import):

```ts
/** A `wave-done` from `fromId` on `runId`, through the store's own ingress
 *  writer (`insertMail`, the row `POST /api/mail` inserts). */
const waveDone = (coord: CoordStore, runId: number, fromId: string, body: string): void => {
  coord.insertMail({ fromId, fromUuid: 'u', toId: 'ccrc-pwa-coord', runId, kind: 'status',
    subject: WAVE_DONE_SUBJECT, body, artifacts: [] });
};

describe('CoordStore.runSignals — the worker\'s wave-done signal lines (routing slice 2)', () => {
  it('no wave-done yet: zero mails and signals null — a fourth condition, not an absent line', () => {
    const coord = open(); const id = seedRun(coord);
    expect(coord.runSignals(id)).toMatchObject({ waveDoneMails: 0, signals: null });
  });

  it('reads the two lines off the worker\'s wave-done, on an OPEN run too', () => {
    const coord = open(); const id = seedRun(coord);
    waveDone(coord, id, 'demo-worker', 'suite: green\nfailure: shallow\n{"branchTip":"a"}');
    expect(coord.runSignals(id)).toMatchObject({
      waveDoneMails: 1,
      signals: { suite: { ok: true, value: 'green' }, failure: { ok: true, value: 'shallow' } },
    });
  });

  it('a wave-done with no lines is ABSENT on both, distinct from null', () => {
    const coord = open(); const id = seedRun(coord);
    waveDone(coord, id, 'demo-worker', '{"branchTip":"a"}');
    expect(coord.runSignals(id)).toMatchObject({
      waveDoneMails: 1, signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } },
    });
  });

  it('the LAST wave-done wins — a re-sent claim after a rejection supersedes', () => {
    const coord = open(); const id = seedRun(coord);
    waveDone(coord, id, 'demo-worker', 'suite: red\n{}');
    waveDone(coord, id, 'demo-worker', 'suite: green\n{}');
    expect(coord.runSignals(id)).toMatchObject({ waveDoneMails: 2, signals: { suite: { ok: true, value: 'green' } } });
  });

  it('only the run\'s OWN worker counts: another session\'s wave-done, a status mail with another subject, and a wave-done on another run are ignored', () => {
    const coord = open(); const id = seedRun(coord);
    waveDone(coord, id, 'someone-else', 'suite: green\n{}');
    coord.insertMail({ fromId: 'demo-worker', fromUuid: 'u', toId: 'ccrc-pwa-coord', runId: id, kind: 'status',
      subject: 'progress', body: 'suite: green', artifacts: [] });
    const other = seedRun(coord);
    waveDone(coord, other, 'demo-worker', 'suite: green\n{}');
    expect(coord.runSignals(id)).toMatchObject({ waveDoneMails: 0, signals: null });
  });

  it('a run with no worker (sessionId null) reads nothing — never another session\'s mail', () => {
    const coord = open();
    const opened = coord.openRun({ program: 'p2', title: 'p2', project: 'demo', wave: 1, waveOf: null, claimedBy: 'ccrc-pwa-coord' });
    if (!('id' in opened)) throw new Error('refused');
    coord.insertMail({ fromId: 'demo-worker', fromUuid: 'u', toId: 'ccrc-pwa-coord', runId: opened.id, kind: 'status',
      subject: WAVE_DONE_SUBJECT, body: 'suite: green', artifacts: [] });
    expect(coord.runSignals(opened.id)).toMatchObject({ waveDoneMails: 0, signals: null });
  });
});
```

Note: `seedRun` opens program `demo` twice in the "another run" case — if `openRun` refuses a second run on the same program while one is open, open the second on a different `program` slug instead (read `openRun`'s refusals in `store.ts` before choosing).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/run-signals.test.ts`
Expected: FAIL — `waveDoneMails` undefined / `signals` undefined.

- [ ] **Step 3: Implement**

In `shared/api.ts`'s `RunSignals` docstring append one paragraph and two fields:

```ts
 *  `waveDoneMails` counts the `status`/`wave-done` mails the run's OWN worker
 *  (`runs.sessionId`, never `claimedBy`) has sent on this run, and `signals`
 *  is `parseWaveDoneSignals` over the LAST of them — the re-sent claim after a
 *  rejection supersedes the refused one — or null when there are none, which
 *  is a fourth condition beside the three each line carries (routing spec
 *  §5.5, slice 2). Read at signal time from the mail row; nothing is written
 *  at ingress, so the mail table stays the one record. */
export interface RunSignals {
  …existing fields…
  readonly waveDoneMails: number;
  readonly signals: WaveDoneSignals | null;
}
```

In `store.ts`'s `runSignals`, before the `return`:

```ts
    // The worker's own done-claims, in order. `fromId = runs.sessionId` is the
    // filter, not `toId`: the coordinator role resolves per run, and any
    // session on the box can name a runId (attribution, not authentication).
    const waveDone = run.sessionId === null ? [] : this.db.prepare(
      "SELECT body FROM mail WHERE runId = ? AND fromId = ? AND kind = 'status' AND subject = ? ORDER BY id",
    ).all(runId, run.sessionId, WAVE_DONE_SUBJECT) as { body: string }[];
    const last = waveDone[waveDone.length - 1];
```

and in the returned object: `waveDoneMails: waveDone.length, signals: last === undefined ? null : parseWaveDoneSignals(last.body),`. Import `WAVE_DONE_SUBJECT`, `parseWaveDoneSignals` from `../../../shared/api.js` on the existing import line.

- [ ] **Step 4: Run to verify they pass, and the suites that pin the signals shape**

Run: `cd server && ./node_modules/.bin/vitest run test/run-signals.test.ts test/run-routes.test.ts test/coord-envelope.test.ts test/typecheck-tests.test.ts`
Expected: PASS. If a route test pins the signals object with `toEqual`, extend its expected object with the two fields (both are additive; do not weaken the pin to `toMatchObject`).

- [ ] **Step 5: Mutation check, measured**

Drop the `AND fromId = ?` clause (and its bind) → "only the run's OWN worker counts" reds. Restore. Change `ORDER BY id` to `ORDER BY id DESC` → "the LAST wave-done wins" reds. Restore.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/coord/store.ts server/test/run-signals.test.ts
git commit -m "feat(routing): runSignals reads the worker's last wave-done signal lines (routing slice 2, Task 2)"
```

---

### Task 3: The two references — `routing-matrix.md` and `review-panel.md` — in `REQUIRED_REFS`, with their parity tests

**Files:**
- Create: `ccd/coordinator-skill/references/routing-matrix.md`, `ccd/coordinator-skill/references/review-panel.md`
- Modify: `ccd/install-coordinator-skill.sh:72` (`REQUIRED_REFS`), `server/src/skillstate.ts:38` (the docstring's "five")
- Test: `server/test/routing-references.test.ts` (new), `server/test/install-coordinator-skill.test.ts`, `server/test/wrapper-roster-fixture.test.ts` (I8, unchanged — goes red then green), `server/test/coordinator-skill.test.ts` (unchanged — the corpus now includes both files)

**Interfaces:**
- Consumes: `CLASSES` from `shared/models.mjs` (`['haiku','sonnet','opus','fable']`), `ROUTE_EFFORTS="auto low medium high xhigh max ultracode"` harvested from `ccd/ccd`.
- Produces: two reference files clauses 12 and 13 (Task 4) and clause 14 (Task 5) name by path.

- [ ] **Step 1: Write the failing tests**

Create `server/test/routing-references.test.ts`:

```ts
// Routing spec 2026-09-14 §4 — the two references the coordinator skill ships
// for routing. Both are PROSE a model follows, so both get the skill tests'
// mechanism: harvest the words that matter and pin them to the code that owns
// them, in both directions where there is a second side.
//
// `routing-matrix.md` is spec §3's table. Its class words are pinned to
// `shared/models.mjs`'s CLASSES and its effort words to ccd's own ROUTE_EFFORTS
// (harvested from `ccd/ccd`, the record's validator): a matrix cell naming a
// class or an effort the record would refuse is a rule the mechanism can never
// apply.
//
// `review-panel.md` is the held-out panel (spec §2, §8 row 13). The mutation it
// reds on: route the panel through the routing fields — an `agent()` call whose
// `model:`/`effort:` is a variable, absent, or anything but the literals.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES } from '../../shared/models.mjs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { afterEach } from 'vitest';

afterEach(removeTmpFixtures);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const refs = path.join(root, 'ccd/coordinator-skill/references');
const matrix = readFileSync(path.join(refs, 'routing-matrix.md'), 'utf8');
const panel = readFileSync(path.join(refs, 'review-panel.md'), 'utf8');

/** ccd's effort vocabulary, harvested — `worker-skill.test.ts`'s `replayCeiling`
 *  idiom: the validator WRITES this list, and a doc naming a level the
 *  validator refuses is a rule that can never fire. */
const ROUTE_EFFORTS = ((): string[] => {
  const ccd = readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
  const m = /^ROUTE_EFFORTS="([^"]+)"$/m.exec(ccd);
  if (!m) throw new Error('ccd/ccd declares no ROUTE_EFFORTS — the record vocabulary moved');
  return m[1]!.split(' ');
})();

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

describe('routing-matrix.md — spec §3, pinned to the vocabularies the mechanism enforces', () => {
  const rows = matrix.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Work shape') && !l.startsWith('|---'));

  it('carries the five-column table with at least the nine shapes the spec names', () => {
    expect(matrix).toContain('| Work shape | Main loop | Subagents | Workflow mode | Why |');
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.split('|').length - 2, `a row is not five cells: ${r.slice(0, 60)}`).toBe(5);
  });

  it('every class word in a Main loop or Subagents cell is a CLASSES member, capitalised', () => {
    const allowed = new Set(CLASSES.map(cap));
    for (const r of rows) {
      const cells = r.split('|').slice(1, -1).map((c) => c.trim());
      for (const cell of [cells[1]!, cells[2]!]) {
        for (const m of cell.matchAll(/\b([A-Z][a-z]+) · /g)) {
          expect(allowed.has(m[1]!), `${m[1]} is not a model class (${cell})`).toBe(true);
        }
      }
    }
  });

  it('every effort word after a `·` is one ccd\'s ROUTE_EFFORTS admits', () => {
    for (const m of matrix.matchAll(/ · `?([a-z]+)`?/g)) {
      expect(ROUTE_EFFORTS.includes(m[1]!), `${m[1]} is not a ROUTE_EFFORTS level`).toBe(true);
    }
    expect([...matrix.matchAll(/ · /g)].length).toBeGreaterThanOrEqual(12);
  });

  it('states the floors the mechanism relies on, in the spec\'s words', () => {
    expect(matrix).toContain('Fable is never a fan-out worker');
    expect(matrix).toContain('`max` is never a default');
    expect(matrix).toContain('every workflow agent');
    expect(matrix).toContain('Haiku 4.5 accepts no effort level');
  });

  it('names no route and no destructive verb (it joins the coordinator corpus)', () => {
    expect(matrix).not.toMatch(/\b(GET|POST) \/api\//);
    for (const v of ['ws-reap', 'ws-rm', 'ws-gc']) expect(matrix).not.toContain(v);
  });
});

describe('review-panel.md — the held-out panel, model and effort LITERAL on every agent() call', () => {
  const blocks = [...panel.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]!);

  it('ships exactly one fenced js script, and it parses as a Workflow script', () => {
    expect(blocks.length).toBe(1);
    // A Workflow script runs inside an async function (top-level `return` and
    // `await` are legal there; `export const meta` is hoisted by the runner),
    // so a bare `node --check` on the block rejects the `return`. Wrap it the
    // way the runner does — measured: the unwrapped block fails on
    // "Illegal return statement", the wrapped one passes.
    const wrapped = 'async function __wf(args, agent, pipeline, parallel, log, phase) {\n' +
      blocks[0]!.replace(/^export const meta/m, 'const meta') + '\n}\n';
    const tmp = path.join(mkTmp('ccrc-panel-'), 'panel.mjs');
    writeFileSync(tmp, wrapped);
    expect(() => execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })).not.toThrow();
  });

  it('every agent() call carries model and effort as string literals, opus or sonnet, high', () => {
    const script = blocks[0]!;
    // Each call's options object precedes its `schema:` key (the script's own
    // ordering: label, phase, model, effort, schema), so the text between
    // `agent(` and the next `schema:` is that call's option list.
    const calls = script.split('agent(').slice(1);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      const at = c.indexOf('schema:');
      expect(at, `an agent() call without a schema: ${c.slice(0, 80)}`).toBeGreaterThan(0);
      const opts = c.slice(0, at);
      expect(opts, `an agent() call without a literal model: ${opts.slice(0, 80)}`).toMatch(/model: '(opus|sonnet)'/);
      expect(opts, `an agent() call without a literal effort: ${opts.slice(0, 80)}`).toMatch(/effort: 'high'/);
    }
    // lenses on opus, refuters on sonnet — both present
    expect(script).toMatch(/phase: 'Lenses'[^\n]*model: 'opus'/);
    expect(script).toMatch(/phase: 'Refute'[^\n]*model: 'sonnet'/);
    // never a computed model — the mutation that would route the panel through the fields
    expect(script).not.toMatch(/model: (?!')/);
    expect(script).not.toMatch(/effort: (?!')/);
  });

  it('never names Fable, and never inherits: the prose says so and the script obeys', () => {
    expect(panel.toLowerCase()).not.toContain('fable');
    expect(panel).toContain('unverified, never as approval');
    for (const lens of ['correctness', 'spec conformance', 'does-it-reproduce']) expect(panel).toContain(lens);
    expect(panel).toContain('majority');
  });

  it('names no route and no destructive verb (it joins the coordinator corpus)', () => {
    expect(panel).not.toMatch(/\b(GET|POST) \/api\//);
    for (const v of ['ws-reap', 'ws-rm', 'ws-gc']) expect(panel).not.toContain(v);
  });
});
```

In `server/test/install-coordinator-skill.test.ts`'s first test, after the `ledger-template.md` line add:

```ts
      expect(fs.existsSync(skill(d, 'references', 'routing-matrix.md'))).toBe(true);
      expect(fs.existsSync(skill(d, 'references', 'review-panel.md'))).toBe(true);
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/routing-references.test.ts test/install-coordinator-skill.test.ts`
Expected: FAIL — ENOENT on both reference files.

- [ ] **Step 3: Write `routing-matrix.md`**

The body is spec §3 VERBATIM — the introduction paragraph ("Keyed on the shape of the work…"), the "**Effort and workflow mode are independent settings.**" paragraph, the table, and the "**Floors and ceilings.**", "**Where subagent class and effort can be set.**", "**Escalation.**", "**Demotion.**" and "**Timing.**" paragraphs. The "**Context hygiene, class-independent.**" paragraph is left out: it consumes another plan and is not a routing rule. Extract it, do not retype it:

```bash
S=docs/superpowers/specs/2026-09-14-effort-model-routing-design.md
{
cat <<'EOF'
# The routing matrix — which class, effort, subagent class and workflow mode a shape of work runs on

This is the strategy the coordinator applies (clause 12) and the worker routes its own subagents
by (worker clause 14). It is spec §3 of `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md`,
verbatim; the spec is the argument, this file is the rule the skills point at. A row changes by a
PR against THIS file, with the spec amended in the same PR and the measurement behind the change
attached (spec §6: ten completed waves of one shape, judged by a panel, never a single agent). A
reference, not a clause: `server/test/routing-references.test.ts` pins its class and effort words
to the vocabularies the mechanism enforces, not the rows themselves.

The held-out review panel (`references/review-panel.md`) is NOT routed by this table: its model
and effort are literal in its script, whatever row the wave under review ran on.

EOF
awk '/^## 3\. The strategy/{p=1; next} /^## 4\. The decider/{p=0} p' "$S" \
  | awk 'BEGIN{skip=0} /^\*\*Context hygiene, class-independent\.\*\*/{skip=1} skip && /^$/{skip=0; next} !skip'
} > ccd/coordinator-skill/references/routing-matrix.md
```

Then read the result end to end. Check: the table's header row is present once; `**Timing.**` is the last paragraph; no `Context hygiene`; no curly apostrophes (`grep -c "’" ccd/coordinator-skill/references/routing-matrix.md` → 0 — replace any with straight ones, the spec carries none in §3 today). Verify the table is byte-identical to the spec's: `diff <(grep '^|' "$S" | sed -n '1,11p') <(grep '^|' ccd/coordinator-skill/references/routing-matrix.md)` → empty (§3's table is the first table in the spec and is header + separator + nine rows = 11 lines; the spec's 12th `|` line is §5.1's table header, measured at plan time — adjust the range only if a row is added to §3).

- [ ] **Step 4: Write `review-panel.md`**

```markdown
# The held-out review panel — every handoff review, three Opus lenses, a Sonnet refute pass, majority deciding

Invoked by coordinator clause 13 at the handoff review (SKILL.md step 5), on the wave's handoff
commit range, before the ledger is updated and before the next wave's run is opened. It is the
quality gate of the routing design (spec §2): the one measurement that must not move when a
worker's class or effort is changed, so it is **unroutable** — its model and effort are literal in
the script below, it reads no routing field, and no escalation or demotion reaches it. A wave is
never accepted on the coordinator's own reading alone.

**The three lenses**, each a fresh context on `opus` at `high`:

- **correctness** — does the code do what its own comments and tests say, at every seam the diff
  touches; a guard that cannot red for the thing it claims to guard is a finding.
- **spec conformance** — does the diff do what the plan's tasks and the spec's sections it cites
  require, no more and no less; a plan step skipped, a constraint weakened, a deviation not
  ledgered is a finding.
- **does-it-reproduce** — for every claim the handoff makes (a suite green, a measurement, a
  mutation red), can it be reproduced from the tree as committed; a claim that cannot is a
  finding, whatever the commit message says.

**The refute pass.** Every finding goes to three fresh `sonnet` `high` refuters, each told to
refute it and to default to refuted when uncertain; the **majority** decides. A finding two or
three refuters kill is dropped, with the refutations kept. A finding that survives is a finding;
its refuters' proposed remedy is advice, never a mandate (a survived finding is not a mandate for
its own remedy).

**Unverified is never approval.** A lens that dies, times out or returns nothing is recorded as
`unverifiedLenses` and the review is incomplete: re-run that lens before accepting the wave. A
finding whose refuters ALL died is `unexamined`, never `refuted` — it is reported beside the
confirmed findings and blocks acceptance until examined.

**What the coordinator does with the result.** Confirmed findings go back to the worker as a
`finding` mail with the file, the line and the claim, and the run stays where it is; the ledger's
"Decisions & deviations" records the panel's verdict and the count of findings per lens for the
wave, which is what spec §6's quality signal reads. Nothing in this file changes routing: a wave
with findings is a fix round on the spend side, and the routing decision for the NEXT wave is
clause 12's, made on the evidence, not here.

**Run it as a Workflow**, passing the range and the documents as `args`. The script is complete;
copy it verbatim. `agent`, `pipeline`, `parallel`, `phase` and `args` are the Workflow tool's
globals.

```js
export const meta = {
  name: 'ccrc-review-panel',
  description: 'Held-out handoff review: three Opus lenses, three Sonnet refuters per finding, majority deciding',
  phases: [{ title: 'Lenses' }, { title: 'Refute' }],
}
// args: { repo, base, tip, plan, spec, wave } — repo is the WORKER's worktree (read-only for
// every agent), base..tip the handoff commit range, plan and spec the documents the wave is
// measured against, wave the ledger's wave number (for labels only).
const A = args
const RANGE = `${A.base}..${A.tip}`
const READ_ONLY = `Work in ${A.repo}. Read only: never edit, commit, stash, checkout or run a build there. Cite every claim as file:line at ${A.tip}.`
const LENSES = [
  { key: 'correctness', prompt: `${READ_ONLY}\nReview the diff ${RANGE} (git -C ${A.repo} diff ${RANGE}) for CORRECTNESS: does the code do what its own comments and tests say at every seam the diff touches? A guard that cannot red for the thing it claims to guard is a finding. Return only findings you can point at.` },
  { key: 'spec', prompt: `${READ_ONLY}\nReview the diff ${RANGE} for SPEC CONFORMANCE against the plan at ${A.plan} (its tasks for wave ${A.wave}) and the spec at ${A.spec}: a plan step skipped, a constraint weakened, a deviation not ledgered in the plan's Deviations section is a finding. Return only findings you can point at.` },
  { key: 'reproduce', prompt: `${READ_ONLY}\nFor every claim the commits in ${RANGE} make (git -C ${A.repo} log ${RANGE}): a suite green, a measurement, a mutation red — attempt to REPRODUCE it from the tree at ${A.tip} without modifying it (read the test files and the commands the messages name; you may run read-only commands and the named vitest suites from inside their package with ./node_modules/.bin/vitest run, foreground). A claim that does not reproduce is a finding, whatever the message says.` },
]
const FINDINGS = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object',
    properties: { file: { type: 'string' }, line: { type: 'integer' }, claim: { type: 'string' },
      severity: { type: 'string', enum: ['critical', 'important', 'minor'] } },
    required: ['file', 'claim', 'severity'] } } },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, why: { type: 'string' } },
  required: ['refuted', 'why'],
}
const unverifiedLenses = []
const results = await pipeline(
  LENSES,
  (l) => agent(l.prompt, { label: `lens:${l.key}`, phase: 'Lenses', model: 'opus', effort: 'high', schema: FINDINGS })
    .then((r) => { if (r === null) unverifiedLenses.push(l.key); return r }),
  (found, l) => found === null ? [] : parallel((found.findings ?? []).map((f) => () =>
    parallel([0, 1, 2].map((i) => () =>
      agent(`${READ_ONLY}\nA ${l.key} reviewer of ${RANGE} claims: ${JSON.stringify(f)}. Try to REFUTE it from the tree at ${A.tip}. Default to refuted=true when uncertain. Answer with why either way.`,
        { label: `refute:${l.key}:${i}`, phase: 'Refute', model: 'sonnet', effort: 'high', schema: VERDICT })))
      .then((votes) => ({ lens: l.key, finding: f, votes: votes.filter(Boolean) })))),
)
const judged = results.filter(Boolean).flat()
const confirmed = judged.filter((j) => j.votes.length > 0 && j.votes.filter((v) => v.refuted).length < 2)
const refuted = judged.filter((j) => j.votes.length > 0 && j.votes.filter((v) => v.refuted).length >= 2)
const unexamined = judged.filter((j) => j.votes.length === 0)
log(`${confirmed.length} confirmed, ${refuted.length} refuted, ${unexamined.length} unexamined, lenses unverified: ${unverifiedLenses.join(', ') || 'none'}`)
return { confirmed, refuted, unexamined, unverifiedLenses }
```

A refuter that dies is not a vote (`filter(Boolean)`); a finding with no surviving vote is
`unexamined`, never `refuted` — the `votes.length > 0` guard on both buckets is what keeps a
dead refuter from counting as a kill.
```

Then: `grep -ci fable ccd/coordinator-skill/references/review-panel.md` → 0; `grep -c "’" …` → 0.

- [ ] **Step 5: `REQUIRED_REFS` and the docstring**

`ccd/install-coordinator-skill.sh:72`:

```bash
REQUIRED_REFS=(ledger-template.md mail-envelope.md peer-protocol.md resume.md review-panel.md routing-matrix.md wave-lifecycle.md)
```

`server/src/skillstate.ts:38`: "that installer names five REQUIRED reference files" → "seven REQUIRED reference files" (the sentence is prose; the I8 row is the pin).

- [ ] **Step 6: Run to verify they pass, plus every suite that reads the references directory**

Run: `cd server && ./node_modules/.bin/vitest run test/routing-references.test.ts test/install-coordinator-skill.test.ts test/wrapper-roster-fixture.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts`
Expected: PASS. `coordinator-skill.test.ts` reads the directory into its corpus: the destructive-verb census, the route parity and the refusal census now cover both new files.

- [ ] **Step 7: Mutation check, measured**

In the script, change one lens call's `model: 'opus'` to `model: A.model` → "every agent() call carries model and effort as string literals" reds. Restore. Remove `review-panel.md` from `REQUIRED_REFS` → I8 reds. Restore. Change a matrix cell to `Opus · turbo` → the effort test reds. Restore.

- [ ] **Step 8: Commit**

```bash
git add ccd/coordinator-skill/references/routing-matrix.md ccd/coordinator-skill/references/review-panel.md ccd/install-coordinator-skill.sh server/src/skillstate.ts server/test/routing-references.test.ts server/test/install-coordinator-skill.test.ts
git commit -m "feat(routing): routing-matrix.md and review-panel.md ship with the coordinator skill, pinned to the vocabularies and their literals (routing slice 2, Task 3)"
```

---

### Task 4: Coordinator clauses 12 and 13, the count at every site, the brief's routing sentence, the wave-done lines and the panel in `wave-lifecycle.md`

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (the contract; steps 2 and 5), `ccd/coordinator-skill/references/wave-lifecycle.md` (§2, §4, §5, "The run's own signals"), `README.md` (the two coordinator-path sites), `CLAUDE.md:194`
- Test: `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Consumes: Task 3's two files by path; Task 1's `SUITE_WORDS`, `FAILURE_KINDS` (imported into the test); Task 2's field names.
- Produces: clause 12 and clause 13 as the test's `CONTRACT[11]` and `CONTRACT[12]`.

- [ ] **Step 1: Write the failing tests**

In `server/test/coordinator-skill.test.ts`, append two entries to `CONTRACT` (after clause 11; byte-identical to the SKILL.md lines in Step 3):

```ts
  'Every brief names the shape of the wave and the routing the matrix derives from it — class, effort, subagent class and workflow mode, and the subagent effort the worker is expected to name on its calls — read from `references/routing-matrix.md`; this session revises routing only on the evidence a wave returns, and records each change and why in the ledger before the next dispatch.',
  'The handoff review invokes the held-out panel in `references/review-panel.md` as written: three Opus lenses and a Sonnet refute pass per finding, model and effort literal in the script, exempt from every routing field and from escalation and demotion. A lens that dies or returns nothing counts as unverified, never as approval, and no wave is accepted on a reading this session made alone.',
```

Update the file header comment and the `it('carries all eleven clauses verbatim'` title to say thirteen (the title is prose; the count itself is derived). Add `SUITE_WORDS, FAILURE_KINDS` to the `shared/api.js` import, and append:

```ts
describe('the routing clauses (routing slice 2)', () => {
  it('clause 12 names the matrix reference, which ships, and step 2 sends the brief writer to it', () => {
    const c12 = CONTRACT[11]!;
    expect(c12).toContain('`references/routing-matrix.md`');
    expect(REFERENCE_NAMES).toContain('routing-matrix.md');
    // step 2's list of what a brief carries, in SKILL.md and in the reference
    expect(flat(skill)).toMatch(/the shape of the wave and the routing[\s\S]{0,200}routing-matrix\.md/);
    expect(flat(refs('wave-lifecycle.md'))).toMatch(/A brief carries what only THIS wave knows:[\s\S]{0,900}routing-matrix\.md/);
  });

  it('clause 13 names the panel reference, which ships, and step 5 invokes it before the ledger', () => {
    const c13 = CONTRACT[12]!;
    expect(c13).toContain('`references/review-panel.md`');
    expect(c13).toContain('unverified, never as approval');
    expect(REFERENCE_NAMES).toContain('review-panel.md');
    expect(flat(skill)).toMatch(/Review the handoff commit[\s\S]{0,160}review-panel\.md/);
    expect(flat(refs('wave-lifecycle.md'))).toMatch(/## 5 — The boundary[\s\S]{0,600}review-panel\.md/);
  });

  it('wave-lifecycle.md §4 documents the two signal lines with every word the vocabulary admits, and the signals section names the two new fields', () => {
    const wl = refs('wave-lifecycle.md');
    for (const w of SUITE_WORDS) expect(wl).toMatch(new RegExp(`suite: [^\\n]*\\b${w}\\b`));
    for (const k of FAILURE_KINDS) expect(wl).toMatch(new RegExp(`failure: [^\\n]*\\b${k}\\b`));
    expect(wl).toContain('waveDoneMails');
    expect(wl).toMatch(/`signals`/);
    // absent vs unrecognised — the reader is told the third answer exists
    expect(wl).toContain('unrecognised');
  });
});
```

`flat` is the file's existing whitespace-collapsing helper (used at the delegation describe); if it is declared below this point, place the new describe after it.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: FAIL — "missing contract clause", "numbers a different set of clauses" (11 ≠ 13), and "SKILL.md says eleven where the CONTRACT pins 13".

- [ ] **Step 3: SKILL.md**

In `## The contract`: "These eleven sentences are the boundary" → "These thirteen sentences are the boundary". Append after clause 11, as items 12 and 13, EXACTLY the two literals from Step 1.

Step 2 of "## The wave lifecycle", in the sentence listing what a brief carries — after "the deviations already ledgered)" insert ", **the shape of the wave and the routing** the matrix derives from it (`references/routing-matrix.md`; clause 12)" so the sentence reads "…the interfaces earlier waves settled, the deviations already ledgered, **the shape of the wave and the routing** the matrix derives from it (`references/routing-matrix.md`; clause 12), not the identity, ack, question and fingerprint rules the worker already has."

Step 5: replace the opening "**Review the handoff commit** like any other commit, update the ledger," with "**Review the handoff commit** through the held-out panel in `references/review-panel.md` (clause 13) and then like any other commit, record the panel's verdict and update the ledger,".

- [ ] **Step 4: `wave-lifecycle.md`**

§2, the "A brief carries what only THIS wave knows:" sentence: after "the deviations already ledgered," insert "the shape of the wave and the routing the matrix derives from it — class, effort, subagent class, workflow mode, and the subagent effort the worker should name on its calls (`references/routing-matrix.md`, clause 12) —" before "and whatever your review of the last handoff decided." The pinned window `A brief carries what only THIS wave knows:[\s\S]{0,320}deviations already ledgered` must still hold: the insertion is AFTER that phrase.

§4, after the paragraph ending "…is the single commonest way a finished wave is refused." add:

```markdown
**Two signal lines open the body** (routing spec §5.5; worker clause 15), before any prose and
before the JSON — the first two lines, in either order, grammar exactly `key: word` with one space:
`suite: green|red|unrun` (the whole suite on its FIRST full run after the wave's implementation
was complete — red stays red however many fix rounds followed; unrun when no full run happened)
and, only when a check failed, `failure: shallow|ceiling|unclear` (shallow: tests missed, a plan
half-followed — raise effort; ceiling: an ambiguity the worker could not resolve, a design flaw,
a debug that survived two attempts — raise class; unclear: effort-first). A complete body:

```
suite: red
failure: ceiling
{"branchTip":"<40-hex sha>","prNumber":591,"prPhase":"open","handoffCommit":"<the same 40-hex sha>"}
```

The server reads them from the mail row, never from the envelope: `GET /api/runs/:id/signals`
answers `signals.suite` and `signals.failure`, each one of THREE answers — a value, `absent`
(the line was not sent: an older worker, or nothing to say), or `unrecognised` (a line was sent
with a word outside the vocabulary — a defect in the worker's report, surfaced, never read as
silence). They are what spec §6's first-run quality signal and clause 12's next-wave routing
decision read; a wave-done that omits the suite line is accepted by the fingerprint route all the
same, and shows as `absent`.
```

Mind the fences: the example block above is a plain ``` block inside the markdown, so the file's own fence nesting stays valid — the wave-lifecycle file uses ``` fences for its JSON examples today; keep the same style.

§5, insert as the first paragraph under `## 5 — The boundary: open the next wave's run, THEN close this one`:

```markdown
**The handoff review is the held-out panel, first** (clause 13, `references/review-panel.md`):
three Opus lenses over the wave's commit range, three Sonnet refuters per finding, majority
deciding, model and effort literal in the script. Confirmed findings go back to the worker as a
`finding` mail and the run stays where it is; a lens that returned nothing is a review not yet
done. Only a wave the panel has examined is reviewed "like any other commit" below.
```

"The run's own signals" section, append to its first paragraph: "Since routing slice 2 it also answers `waveDoneMails` (the worker's `wave-done` mails on this run) and `signals` — the two signal lines off the LAST of them, or `null` when there are none (§4 above)."

- [ ] **Step 5: README.md and CLAUDE.md**

`CLAUDE.md:194`: "its eleven clauses are pinned VERBATIM" → "its thirteen clauses are pinned VERBATIM".

`README.md` at the two sites the test derives (today the sentence around line 1548 "and its eleven\nclauses are pinned verbatim"): "eleven" → "thirteen" — run the test to find every site rather than trusting this line number. After that paragraph add one:

```markdown
**Routing (routing slice 2).** Clause 12 makes every brief name the wave's shape and the routing
`ccd/coordinator-skill/references/routing-matrix.md` (spec §3, verbatim) derives from it, and makes
the coordinator revise routing only on a wave's evidence, recorded in the ledger. Clause 13 routes
every handoff review through the held-out panel in `references/review-panel.md` — three Opus lenses,
a Sonnet refute pass per finding, model and effort literal in the script — so the quality gate does
not move when a worker's class or effort does. Both references are in `install-coordinator-skill.sh`'s
`REQUIRED_REFS` and pinned by `server/test/routing-references.test.ts`.
```

(The paragraph names `ccd/coordinator-skill/…/routing-matrix.md`, not `ccd/coordinator-skill/SKILL.md`, so it adds no count site.)

- [ ] **Step 6: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts test/routing-references.test.ts`
Expected: PASS — including the delegation describe's `[\s\S]{0,320}deviations already ledgered` window and the refusal-code censuses over the enlarged corpus.

- [ ] **Step 7: Mutation check, measured**

Revert "thirteen" to "eleven" in CLAUDE.md alone → "spells that same count" reds naming CLAUDE.md. Restore. Delete clause 13's "unverified, never as approval" from SKILL.md alone → the verbatim pin reds. Restore.

- [ ] **Step 8: Commit**

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md README.md CLAUDE.md server/test/coordinator-skill.test.ts
git commit -m "feat(routing): coordinator clauses 12 and 13 — the brief names shape and routing; the handoff review is the held-out panel (routing slice 2, Task 4)"
```

---

### Task 5: Worker clauses 14 and 15, the count at every site, the routing section and the signal lines in the wave-done section

**Files:**
- Modify: `ccd/worker-skill/SKILL.md`, `README.md` (the three worker-path sites), `CLAUDE.md:200`
- Test: `server/test/worker-skill.test.ts`

**Interfaces:**
- Consumes: Task 3's `routing-matrix.md` (by the relative path `../ccrc-coordinator/references/routing-matrix.md`), Task 1's `SUITE_WORDS`, `FAILURE_KINDS`, `SUBAGENT_CLASSES` from `shared/models.mjs`.
- Produces: clause 14 and clause 15 as `CONTRACT[13]` and `CONTRACT[14]`.

- [ ] **Step 1: Write the failing tests**

In `server/test/worker-skill.test.ts`, append two entries to `CONTRACT` (double-quoted, byte-identical to Step 3):

```ts
  "Route your own subagents by the shape of their task, from `../ccrc-coordinator/references/routing-matrix.md`, and never let one inherit your model: name the class on every Agent or Workflow call and the effort on every Workflow `agent()` call (an Agent-tool subagent runs at your own effort) — implementation from a spec'd plan on Sonnet at high, review with judgement and adversarial verification on Opus at high, scouts and transcription-grade edits on Haiku, and Fable never as a fan-out worker. A subagent effort the brief names governs over that default.",
  "Your wave-done body opens with two signal lines the server parses, before any prose and before the fingerprint: `suite: green|red|unrun` says whether the whole suite passed on its FIRST full run after this wave's implementation was complete (red stays red however many fix rounds followed; unrun when no full run happened), and, only when a check failed, `failure: shallow|ceiling|unclear` names the kind — shallow for tests missed or a plan half-followed, ceiling for an ambiguity you could not resolve, a design flaw or a debug that survived two attempts, unclear otherwise. The suite line is never omitted.",
```

Update the header comment and the `it('carries all thirteen clauses verbatim'` title to fifteen. In the "carries no references of its own" test add `'../ccrc-coordinator/references/routing-matrix.md'` to the pointed-at list. Add `FAILURE_KINDS, SUITE_WORDS` to the `shared/api.js` import and `import { SUBAGENT_CLASSES } from '../../shared/models.mjs';`, then append:

```ts
describe('the worker skill: the routing clauses (routing slice 2)', () => {
  const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

  it('clause 14 names every subagent class the record admits, Opus for judgement, and Fable never', () => {
    const c14 = CONTRACT[13]!;
    for (const c of SUBAGENT_CLASSES) expect(c14, `clause 14 never names ${cap(c)}`).toContain(cap(c));
    expect(c14).toContain('Opus at high');
    expect(c14).toContain('Fable never as a fan-out worker');
    expect(c14).toContain('../ccrc-coordinator/references/routing-matrix.md');
    // the same rule outside the contract, where a reader lands from the skill's own section
    expect(skill).toMatch(/## Routing your subagents[\s\S]{0,900}routing-matrix\.md/);
  });

  it('clause 15 spells every suite word and failure kind the parser admits, in the grammar it parses', () => {
    const c15 = CONTRACT[14]!;
    expect(c15).toContain(`\`suite: ${SUITE_WORDS.join('|')}\``);
    expect(c15).toContain(`\`failure: ${FAILURE_KINDS.join('|')}\``);
    for (const w of SUITE_WORDS) expect(c15).toMatch(new RegExp(`\\b${w}\\b`));
    for (const k of FAILURE_KINDS) expect(c15).toMatch(new RegExp(`\\b${k}\\b`));
  });

  it('the wave-done section shows the two lines ABOVE the fingerprint, in a complete body', () => {
    const section = skill.slice(skill.indexOf('## Reporting a wave-done'));
    expect(section).toMatch(/```\nsuite: (green|red|unrun)\nfailure: (shallow|ceiling|unclear)\n\{"branchTip"/);
    expect(section).toContain('one space');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`
Expected: FAIL — missing clauses, 13 ≠ 15 numbering, "SKILL.md says thirteen where the CONTRACT pins 15".

- [ ] **Step 3: SKILL.md**

"These thirteen clauses are the boundary" → "These fifteen clauses are the boundary"; "these thirteen lines are pinned verbatim" → "these fifteen lines are pinned verbatim". Append items 14 and 15 EXACTLY as the Step 1 literals (straight apostrophes in `spec'd`, `wave's`; no double-quote character anywhere in either line).

Add a section before `## How to call the API` (NO numbered list in it — the test numbers the whole file):

```markdown
## Routing your subagents

The strategy is `../ccrc-coordinator/references/routing-matrix.md`, installed beside this skill
(clause 14). Name the class on every Agent or Workflow call — a subagent that inherits your model
is the one thing the matrix forbids outright — and the effort on every Workflow `agent()` call,
where it can be set; the Agent tool runs a subagent at your own effort. The brief may name the
subagent effort the coordinator expects for this wave; that governs. A Workflow script on this
fleet passes `model:` and `effort:` on every `agent()` call, and its agents run on Opus or Sonnet
(Haiku for scouts) — never on the class your own main loop runs on if that is above Opus.
```

In `## Reporting a wave-done`, after the fingerprint table and before "Then stop pushing (clause 9).", add:

```markdown
**The body opens with two signal lines** (clause 15) — the first two lines, before any prose and
before the JSON, grammar exactly `key: word` with one space after the colon and nothing after the
word. `suite:` is never omitted; `failure:` only when a check failed. A complete body:

```
suite: red
failure: ceiling
{"branchTip":"<40-hex sha>","prNumber":591,"prPhase":"open","handoffCommit":"<the same 40-hex sha>"}
```

The server reads them off the mail row (`GET /api/runs/:id/signals`, the coordinator's read); a
word outside the vocabulary is reported as unrecognised, never as green. Say `red` when the first
full run after your implementation was complete failed, even if a fix round made it green before
you sent this — the signal is what the first run said, and the fix round is counted on its own.
```

The worker skill's route census (`coordinator-skill.test.ts`'s is the coordinator's) does not cover this file, but `GET /api/runs/:id/signals` is a real registered route; keep the spelling exact.

- [ ] **Step 4: README.md and CLAUDE.md**

`CLAUDE.md:200`: "thirteen clauses pinned by" → "fifteen clauses pinned by". README.md, at every site the test derives (today around lines 1358, 1551 and 1803 — "thirteen clauses" each): → "fifteen clauses". The R2 bullet at ~1803 reads "now carries thirteen clauses" — make it "now carries fifteen clauses (thirteen at R2; routing slice 2 added 14 and 15)". After the README's "Routing (routing slice 2)" paragraph from Task 4, add:

```markdown
The worker's half: clause 14 routes its own subagents by task shape from the same matrix, class
named on every call and effort on every Workflow call, Fable never a fan-out worker; clause 15 opens
every wave-done body with `suite: green|red|unrun` and, on a failed check, `failure:
shallow|ceiling|unclear`, which `GET /api/runs/:id/signals` reads off the mail row as `signals` —
three answers per line (a value, absent, unrecognised) and `null` when no wave-done has arrived.
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts test/coordinator-skill.test.ts test/dispatch-skillstate.test.ts test/skillstate.test.ts test/install-worker-skill.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check, measured**

Replace `suite: green|red|unrun` in clause 15 (SKILL.md and the literal) with `suite: green|red` → "spells every suite word" reds on `unrun`. Restore. Add a stray `"` to clause 14 in SKILL.md alone → the verbatim pin reds. Restore. Revert README's third site alone to "thirteen" → the count test reds naming README.md. Restore.

- [ ] **Step 7: Commit**

```bash
git add ccd/worker-skill/SKILL.md README.md CLAUDE.md server/test/worker-skill.test.ts
git commit -m "feat(routing): worker clauses 14 and 15 — subagents routed by shape with class and effort named; the wave-done opens with suite:/failure: (routing slice 2, Task 5)"
```

---

### Task 6: Ship agent-first and measure the gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 (one row: slice 2's gate)

- [ ] **Step 1: The full suites, in chunks**

From `server/`, foreground, `timeout 600000` each: `./node_modules/.bin/vitest run --maxWorkers=2 test/[a-c]*.test.ts`, `test/[d-l]*.test.ts`, `test/[m-r]*.test.ts`, `test/[s-z]*.test.ts`; then `cd agent && npm run test`, `cd pwa && npm run test`. Known load flakes re-run in isolation before being called real. Also `git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts` (this plan defines numbers only if a deviation is minted during execution).

- [ ] **Step 2: Push and open the PR**

Push `ws/ccrc-token-optimization-strategy`; `gh pr create` against `main` with a hand-written body (what slice 2 ships, the four clauses by number, the two references, the grammar, the gate); the body ends with the attribution line the session reminder specifies. Merge only after the operator's approval, via the ruleset's admin bypass.

- [ ] **Step 3: Deploy, agent lane first**

`bash deploy/deploy.sh agent` (rsyncs both skill directories and runs both installers on every rostered home — `install-coordinator-skill.sh` refuses unless all seven references are present, which is the guard working), then `bash deploy/deploy.sh` (server: `runSignals`). `/health` reports the shipped sha.

- [ ] **Step 4: Measure the gate**

On the fleet host, read only: (a) for every home `~/.ccrc/accounts.sh` projects (`source ~/.ccrc/accounts.sh; for a in "${CCRC_ACCOUNTS[@]}"; do d=$(_ccrc_cfg_dir "$a"); [[ -d $d ]] && ls "$d/skills/ccrc-coordinator/references/" | wc -l; done`) → 7 in each; `grep -c '^1[45]\. ' <home>/skills/ccrc-worker/SKILL.md` → 2. (b) `ccrc-api runs list --closed 1` → pick a closed run; `GET /api/runs/<id>/signals` (via `ccrc-api`, cookieless with the box token) answers `waveDoneMails` and `signals: null` for a pre-slice-2 run — the additive fields land, the old rows say nothing. (c) The spec's second gate line, "sidecar shows subagent class shifting", cannot be read from the sidecar: slice 0 measured that subagent renders never write `.agents/` sidecars (0 on the fleet). The observer for `subagent` is the offline sweep (spec §6): after the NEXT dispatched wave on this fleet runs under the new worker skill, `~/.ccrc/usage-sweep.json`'s `perSession[<worker session uuid>].models` shows a sonnet or haiku entry with `subagentN > 0`. Record the first such wave's session, its `models` map and the sweep's `finishedAt` in the research note; if none has run by the time this task closes, record the row as PENDING with the exact read above.

- [ ] **Step 5: Commit the row**

```bash
git add docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md
git commit -m "docs(research): slice 2 gate — the clauses pinned, both references installed, the signal fields live (routing slice 2, Task 6)"
```

---

## Deviations found

Issued by `POST /api/ledger/deviations` on 2026-09-15 (one block of five, D-2830..D-2834, one more, D-2835, issued after the whole-branch review, and three more, D-2842..D-2844, issued after Task 6's gate) and defined here in the same act. Every one records a defect in THIS PLAN's text or a ruling the controller made on a plan-mandated finding; the shipped tree is as the entries describe.

- **D-2830 — Task 2, ruling S2-R1: the rebound case pinned, the read unchanged.** The plan's `runSignals` filter (`fromId = runs.sessionId`) hides a predecessor session's wave-done after a rebind (`bindSession`, reached through the open route's `setSession`); the review called the resulting `signals: null` an overloaded null. Measured: the only caller that can CHANGE a run's occupant is the open route, whose rebind is reached only through `openRun`'s dup arm (`state = 'planned'`), so a change of occupant happens only on a never-dispatched run and a predecessor's mail there is not a done-claim for dispatched work. Shipped: the plan's SQL unchanged; one test pinning the rebound case (`run-signals.test.ts`) and a `RunSignals` docstring paragraph naming the assumption and the path that would break it. Commit cdccdacc.
- **D-2831 — Task 3: the plan's review-panel.md prose contradicted the plan's own test.** Step 4's prescribed heading read "Unverified is never approval." while Step 1's test asserts the literal `unverified, never as approval` (the clause-13 wording). Shipped: the heading kept, the exact phrase placed in the sentence that follows. Commit e24c94f4.
- **D-2832 — Task 3: the plan named one docstring line; the count appeared twice.** Step 5 said to change `skillstate.ts:38`'s "five" to "seven"; line 43's "five on top of two" carried the same count and was left contradicting it. Shipped in fix round 1: both say seven. Commit 9019dc4a.
- **D-2833 — Task 4, ruling S2-R2: the plan's clause-12 pin was satisfied by clause 12 itself, and its gloss dropped a parenthesis.** Step 1's `the shape of the wave and the routing[\s\S]{0,200}routing-matrix\.md` matches clause 12's own text, so deleting the step-2 insertion stayed green; Step 3's anchor kept step 2's closing `)` while its "so the sentence reads" gloss dropped it. Shipped in fix round 1: the pin anchors on `what only this wave knows[\s\S]{0,320}routing-matrix\.md` (measured: live match, red on the step-2 mutant) and the `)` is restored. Commit dd697db9.
- **D-2834 — Task 5: the plan's mandated wave-done sentence collided with the worker test's count harvest.** Step 3 prescribed "the first two lines"; `worker-skill.test.ts` harvests every `<word> lines` over the whole file as a stated clause count and compares it with fifteen, so the verbatim sentence reds the test the same task requires green. Shipped: "the leading pair" — meaning unchanged, no literal or pin altered. Commit 4ab26909.
- **D-2835 — final review #1: the read keys on the exact subject `wave-done`, and the plan never made the worker send exactly that.** Task 2's `runSignals` selects `subject = WAVE_DONE_SUBJECT` (byte-exact), while the worker skill's text only said a wave-done is "a `status` mail whose subject says so" — a decorated subject (`wave-done: wave 3`) would read as no wave-done at all, the collapse the three-answer grammar exists to prevent, one level up. Shipped in the final fix wave (d4af33f9, opus/high): the worker skill's "Reporting a wave-done" section says the subject is that exact string, the API-section bullet that licensed the drift is tightened, and `worker-skill.test.ts` pins the worked mail JSON's `subject` to `WAVE_DONE_SUBJECT` (mutants measured red: a decorated subject in the worked JSON, the sentence deleted). Four further Minor plan issues on the references (#2-#5) are parked with rulings S2-R3..S2-R6 in the execution ledger and carried to slice 3's plan.
- **D-2842 — Task 6: the plan named a `ccrc-api` read the closed client does not have.** Step 4(b) says the signals read goes "via `ccrc-api`, cookieless with the box token"; the client's closed table (22 rows, `ccrc-api.test.ts` pins the count) has no `runs signals` row, and adding one is shipped source outside the task. Shipped: the read replicated what the client does (CCRC_SERVER_URL from `~/.ccrc/agent.env`, the token file's value line as `x-ccrc-mail-token`, `curl -sS -m 30`), nothing printed; the row says so. A client row is carried to slice 4 (the PWA or a coordinator will want the read).
- **D-2843 — Task 6: the plan named the wrong file for the sweep's per-session report.** Step 4(c) says `~/.ccrc/usage-sweep.json`'s `perSession`; that file is the ten-pass CENSUS ({started, finished, status, records}) with no `perSession` key. The report is `~/.cc-sessions/usage/sweep/latest.json` (`ccd/ccd-usage-sweep`'s `OUT_DIR`). The gate row reads the right file and says which; slice 3's plan reads the right file from the start.
- **D-2844 — Task 6: the plan predicted one of two readings for a pre-slice-2 run.** Step 4(b) expects `signals: null`; measured over all 58 runs, 7 answer `null` (no matching wave-done) and 51 answer `absent` on both lines (a wave-done whose body carries no signal line), 0 unrecognised — both are the shipped semantics (`runSignals`, `parseWaveDoneSignals`), and a gate that had read one run would have reported one of them as the whole. The row records both counts. Also measured beside it: 96 wave-done mails on the fleet carry the byte-exact subject D-2835 keys on.


## Carried to later slices (recorded here so they are not lost)

- **Spec §5.3 "Coordinator decisions" contradicts coordinator clause 1.** §5.3 has the coordinator run `ccd route --session <id> --set …` "locally on the fleet box"; clause 1 says the coordinator "never runs `ccd` to change fleet state", and a routing field is fleet state. Clause 12 is therefore mechanism-neutral (it records the decision in the ledger). Slice 5 (escalation and demotion "through the verb") must rule the door — the natural fit for clause 1 is an HTTP route built on `CCD_ARGV.route` (slice 1's Task 5 minor: the builder still carries no actor/reason) — and amend §5.3 in the same PR.
- **The panel's `args.repo` is the worker's worktree**, read-only by instruction; a later slice may give the panel an isolated checkout (`isolation: 'worktree'`) once the cost is measured.
- **`GET /api/runs/:id/signals` has no PWA consumer**; the run board could render `signals.suite` beside `firstSubmission` (slice 4 or a UI slice).
- Slice 1 carries stand: `--model <alias>` on non-Anthropic lanes unmeasured (S1-R10), `{"enableWorkflows":false}` unmeasured (S1-R12), inert=effort for any level on non-Anthropic lanes (S1-R7), the settle keyed on the effort field (S1-R11), the doctor's subagent-key arm back to FAIL once every session carries a record (S1-R13).

## Self-review against the spec

- §4: two references, both in `REQUIRED_REFS` and the two parity tests (I8 and `coordinator-skill.test.ts`'s directory-derived corpus), the worker pointing at the coordinator's — Tasks 3 and 5. Clause 12 (the brief names shape and routing; revise on evidence; record why) and clause 13 (the panel) — Task 4. ✓
- §5.5 worker clauses (route by shape, name class and effort; report a failed check with its kind) — Task 5; body lines and the server's parser, envelope untouched — Tasks 1 and 2; "count the sites from the test" — Tasks 4 and 5; Workflow scripts pass model and effort, never Fable — the matrix's floors paragraph, clause 14, the worker's routing section, and `review-panel.md`'s script. ✓
- §6 "suite green on first run from the worker's `suite:` body line" — Task 2's `signals.suite`. ✓
- §7 slice 2 gate "skill tests pin the clauses; sidecar shows subagent class shifting" — Task 6, with the sidecar half re-routed to the sweep on slice 0's measurement (0 `.agents/` sidecars), stated in the task. ✓
- §8 row 13 (panel literals; the parity test on `review-panel.md` and the clause-13 pin) — Task 3's literal scan and Task 4's pin; row 16 (body-line signals never touch the envelope; `mail-envelope-parse`'s round-trip pin) — Task 1. ✓
- Placeholder scan: the matrix file is extracted from the spec by command, not retyped; the panel script is complete; every test has its code. ✓
- Type consistency: `SignalLine`, `WaveDoneSignals`, `parseWaveDoneSignals`, `WAVE_DONE_SUBJECT`, `SUITE_WORDS`, `FAILURE_KINDS` are spelled identically in Tasks 1, 2, 4 and 5; `RunSignals.waveDoneMails`/`signals` in Tasks 2, 4 and 5. ✓
