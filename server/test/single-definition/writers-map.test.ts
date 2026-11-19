// SECTION 2.2'S WRITERS, FACT BY FACT (#2369; ARCH-40's exit, spec 2026-10-19 §2.1 rule (f)). Rule (f) says every fact
// §2.2 names has a declared writer set, held by a `writers` pin that may only shrink. The pins grew one describe at a
// time, in this directory and in the census modules, and nothing tied them back to §2.2, so whether every fact had one
// was unmeasured. `SECTION_2_2` is that tie: one row per fact, naming the describe(s) that hold its writer set, or, where
// no pin holds all of it, a `gap` that says what is not held and why.
//
// What this file checks: every "Writers:" sub-bullet and "Facts recorded:" bullet of §2.2 (and C7's server-caps line,
// the one writer fact stated outside a "Writers:" list) has a row; every row's quote sits in exactly one of those bullets;
// and every cited describe exists, by its exact title, in the file named. A renamed or deleted pin, or a new §2.2 bullet
// with no row, reds here. It does not judge a pin's strength: that is each pin's own test.
//
// Three facts had no pin; their describes are at the foot of this file: the coord.db tables §2.2 records (who issues
// each table's SQL writes), the `.reaped/<id>.json` tombstones, and the server-caps file.
//
// The switches rows of `advance-switches.test.ts`'s ARCH-40 describe are §3 K12's, not §2.2's, so they are not rows here.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseFile, ts } from '../scan/parse.js';
import { sqlWrites } from './sqlStatements.js';
import { ccdSourceLines, bashCodeOf } from '../consolidationCensus.js';
import { ALL, ALL_MJS, BASH, ccrcRoot, codeLines, rel, stallCode } from './helpers.js';

const SPEC = path.join(ccrcRoot, 'docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md');

/** A describe that holds (part of) a fact's writer set: its file under `server/test`, and its exact title. */
interface Pin { readonly file: string; readonly describe: string }
/** One §2.2 fact. `quote` is text of the bullet that states it; `gap` says what the pins do not hold, and why. */
interface Row {
  readonly context: string;
  readonly fact: string;
  readonly quote: string;
  readonly pins: readonly Pin[];
  readonly gap?: string;
}

const SD = 'single-definition/';
const THIS = `${SD}writers-map.test.ts`;
const TABLES_PIN = 'coord.db\'s recorded tables: every SQL write is a CoordStore method, by name, may only shrink';
const TOMB_PIN = 'the workspace tombstone `.reaped/<id>.json`: three writers in ccd, every other naming a read, may only shrink';
const CAPS_PIN = 'the server-caps file: one writer per node kind, every other naming a read, may only shrink';
/** This file's own pins, whose titles are the constants above rather than literals. */
const OWN_PINS: readonly string[] = [TABLES_PIN, TOMB_PIN, CAPS_PIN];

export const SECTION_2_2: readonly Row[] = [
  {
    context: 'C1', fact: 'the account roster (`~/.ccrc/accounts.json`)',
    quote: 'The roster: `ccrc account` → `deploy/account-op.mjs`.',
    pins: [],
    gap: 'No writer census. The roster has more writers than the one §2.2 names: the `ccrc account` add, declare and '
      + 'remove verbs, `ccrc codex switch` (a read-modify-write of the whole file) and `ccrc install`\'s seed. They are '
      + 'serialised by one lock (`ccrc-account.test.ts`, "the roster transitions share one placement lock"), which holds '
      + 'their order, not their number. Counting them needs a JSON-write census over bash, Python and .mjs, a ticket of '
      + 'its own.',
  },
  {
    context: 'C1', fact: 'the per-account switch `$REG/<w>-disabled`',
    quote: 'The per-account switch `$REG/<w>-disabled` is **not** a roster projection.',
    pins: [
      { file: `${SD}roster-bash.test.ts`, describe: 'the disabled switch has one write primitive (D-7050)' },
      { file: `${SD}roster-bash.test.ts`, describe: 'the disabled switch is never projected from the roster (D-7048)' },
    ],
  },
  {
    context: 'C1', fact: 'the auth-dead marker',
    quote: 'Auth-dead: one ccd primitive, `_authdead_mark`/`_authdead_clear`.',
    pins: [{ file: `${SD}roster-bash.test.ts`, describe: 'the auth-dead marker has one write primitive (D-7049)' }],
  },
  {
    context: 'C1', fact: 'registry fields (`$REG/<id>.*`)',
    quote: 'Registry fields: `_reg_set`/`_reg_purge` in ccd',
    pins: [{ file: 'ccd-collect-recycle-pins.test.ts', describe: 'premise 2 — ONE `.child` writer' }],
    gap: 'Partly held: that describe pins every variable-field `_reg_set` call to a reviewed census, and `.child` to one '
      + 'writer. The per-field table §2.2 asks for (ARCH-34\'s manifest plus a field table naming each field\'s writer, '
      + 'and the hook\'s fields in `session-hook.sh`) does not exist yet, so no pin names a writer per field.',
  },
  {
    context: 'C1', fact: '`SessionReading`',
    quote: '`SessionReading`: one L1 function, `readSession(facts)`.',
    pins: [{ file: 'census-w2/sessionReading.test.ts', describe: 'one reading of a session: the W2 pins (D-8049; each may only shrink)' }],
  },
  {
    context: 'C1', fact: 'the ccd lifecycle journal (`$REG/.lifecycle`) and its `lifecycle_events` mirror',
    quote: 'the ccd lifecycle journal (`$REG/.lifecycle`, mirrored into `lifecycle_events`)',
    pins: [
      { file: 'ccd-lifecycle-contain.test.ts', describe: 'nothing but the _lc_* block writes into .lifecycle/' },
      { file: THIS, describe: TABLES_PIN },
    ],
  },
  {
    context: 'C3', fact: 'pane tokens',
    quote: 'Pane tokens come from one module, `server/src/pane/`.',
    pins: [
      { file: 'pane-busy-corpus.test.ts', describe: 'pane busy corpus' },
      { file: 'pane-sgr-guard-characterization.test.ts', describe: 'ARCH-63: one SGR stripper, no guard copy' },
    ],
    gap: 'Partly held: the corpus pins each caller\'s verdict, TS and ccd, and the SGR stripper is one. No census counts '
      + 'pane-token parsers outside `server/src/pane/`, so a second TS parser of the spinner row would not red.',
  },
  {
    context: 'C3', fact: 'transcript readers',
    quote: 'The transcript reader is one per language',
    pins: [
      { file: 'ccd-python-reader-census.test.ts', describe: 'the Python transcript readers in ccd (D-8070)' },
      { file: 'rings/pwa-one-owner.test.ts', describe: 'the transcript copy and usability rules have one owner (C7q, D-7212)' },
    ],
    gap: 'Partly held: ccd\'s Python readers are counted against the operator\'s 2026-11-06 ruling, and `ccd/lib/transcript.jq` '
      + 'is ccd\'s reader. No census counts TS transcript parsers outside `server/src/transcript/`.',
  },
  {
    context: 'C4', fact: 'the sleep and retire deciders',
    quote: 'One L1 decider per transition: `decideSleep(facts, policy)` and `decideRetire(facts, reason)`.',
    pins: [
      { file: 'census-w4/sleep.test.ts', describe: 'the sleep lanes\' censuses (ARCH-43)' },
      { file: `${SD}late-census.test.ts`, describe: 'the retire executors share one gate decider, decideRetire (D-7166; ARCH-44)' },
    ],
  },
  {
    context: 'C4', fact: 'the sleep and retire executors',
    quote: 'One L4 executor per transition.',
    pins: [
      { file: `${SD}late-census.test.ts`, describe: 'the sleep lanes share one executor (D-7042; ARCH-43)' },
      { file: `${SD}late-census.test.ts`, describe: 'child-spent runs through retireAct, and no retire executor keeps a gate ladder of its own (D-7170; ARCH-44 C4m)' },
      { file: `${SD}late-census.test.ts`, describe: 'a retire entry reaches the session queue through one owner, retireExecutor (D-7171; ARCH-44 C4n)' },
    ],
  },
  {
    context: 'C4', fact: 'ccd\'s shared refusal, lock and audit-token helpers',
    quote: 'On the ccd side, shared refusal, lock and audit-token helpers',
    pins: [
      { file: `${SD}child-reclaim.test.ts`, describe: 'ARCH-45 C5e: no `_reap_refuse` or `_ws_collect_refuse` definition or call stands in ccd’s source (D-7072; may only shrink)' },
      { file: `${SD}child-reclaim.test.ts`, describe: 'ARCH-45 C5f: one token minter in ccd’s source, `_ws_reclaim_fingerprint` (D-7075; may only shrink)' },
      { file: `${SD}child-reclaim.test.ts`, describe: 'ARCH-45 C5g: one reap-lock runner in ccd’s source, `_ws_reap_lock_run` (D-7076; may only shrink)' },
    ],
  },
  {
    context: 'C4', fact: 'lifecycle journal rows',
    quote: 'lifecycle journal rows (`intent`/`done`/`fail`/`refuse`)',
    pins: [{ file: 'ccd-lifecycle-contain.test.ts', describe: 'nothing but the _lc_* block writes into .lifecycle/' }],
  },
  {
    context: 'C4', fact: 'the `.reaped/<id>.json` tombstones',
    quote: '`.reaped/<id>.json` tombstones',
    pins: [{ file: THIS, describe: TOMB_PIN }],
  },
  {
    context: 'C5', fact: 'store primitives, one per invariant',
    quote: 'Store primitives, one per invariant',
    pins: [
      { file: 'mail-deliveries-writer.test.ts', describe: 'store.ts writes mail_deliveries in exactly one place (D-5997)' },
      { file: THIS, describe: TABLES_PIN },
    ],
  },
  {
    context: 'C5', fact: '`RunBinding`',
    quote: '`RunBinding` is written by `openRun`/`dispatchRun`/`closeRun`/`reclaimProgram`, and by nothing else.',
    pins: [
      { file: 'run-binding.test.ts', describe: 'RunBinding has one writer' },
      { file: 'run-binding-bind-records.test.ts', describe: 'the bound incarnation has one writer (ARCH-60 follow-up, #1407)' },
    ],
  },
  {
    context: 'C5', fact: 'ccd\'s `.child` marker',
    quote: 'ccd\'s `.child` marker becomes a **projection** of the binding',
    pins: [{ file: 'ccd-collect-recycle-pins.test.ts', describe: 'premise 2 — ONE `.child` writer' }],
  },
  {
    context: 'C5', fact: '`run_events`, `mail_deliveries` and the `lifecycle_*` mirrors',
    quote: '`run_events` (transitions only), `mail_deliveries`, `lifecycle_*` mirrors',
    pins: [{ file: THIS, describe: TABLES_PIN }],
    gap: '"Transitions only" is not met yet: stall and breaker observations are still `run_events` rows (`CoordStore`\'s '
      + '`insertObservation`, `recordRunEvent` and `recordDeadCoordinatorBreakerHeld` beside `advanceInner`). The pin '
      + 'records the four, so the set can only shrink toward `advanceInner` when StallObservation moves out.',
  },
  {
    context: 'C5', fact: 'the delegation journal',
    quote: 'the delegation journal',
    pins: [{ file: `${SD}kernel-tail-journal.test.ts`, describe: 'the journal kernel: one epoch reader, one floor, one append-then-apply (D-7058)' }],
  },
  {
    context: 'C6', fact: 'notices (ring, `feed_events`, push)',
    quote: 'Notices: one funnel, `notify(event, mode)`',
    pins: [
      { file: `${SD}update-stall.test.ts`, describe: 'the feed archive\'s writer set (D-5859; ARCH-54 #789)' },
      { file: THIS, describe: TABLES_PIN },
    ],
    gap: 'Partly held: both pins count `feed_events` writers only. No census counts writers to the `NotifyLog` ring '
      + '(`record`) or callers of `PushService.notify`; `notice.ts` is the only one of each today, so a second ring or '
      + 'push writer elsewhere in `server/src` would not red.',
  },
  {
    context: 'C6', fact: 'operator questions (the `asks` and `approvals` tables)',
    quote: 'Questions: one module, `coord/questions.ts`',
    pins: [
      { file: `${SD}ask-digest.test.ts`, describe: 'the question tables are read through coord/questions.ts (D-7026)' },
      { file: `${SD}ask-digest.test.ts`, describe: 'one question sweep (D-7027)' },
      { file: THIS, describe: TABLES_PIN },
    ],
  },
  {
    context: 'C6', fact: 'the approval signing path',
    quote: 'The approval signing path (`approvalsign.ts`, `approval-verify.mjs`) is untouched.',
    pins: [{ file: 'approvalsign.test.ts', describe: 'the approval signing key (spec §6.4)' }],
    gap: 'Held by behaviour, not by a writer census: §2.2 leaves this security boundary untouched, so the wave adds no '
      + 'writer set to it. The pin holds the key\'s one creation and reuse.',
  },
  {
    context: 'C6', fact: 'the egress command redactor',
    quote: 'The egress command redactor (`coord/redact.ts`, D-5299, D-5360)',
    pins: [
      { file: `${SD}ask-digest.test.ts`, describe: 'the approval classifier, its class map and the redactor each have one home (D-5299)' },
      { file: `${SD}late-census.test.ts`, describe: 'one redaction rule table (ARCH-66): shared/redact.mjs (D-5867)' },
    ],
  },
  {
    context: 'C6', fact: 'the question doors',
    quote: 'The question doors stay **inside `coord/routes.ts`**',
    pins: [{ file: `${SD}ask-digest.test.ts`, describe: 'the question doors: one reader, one core per principal, the old doors aliases (W3 Q3f, D-7030)' }],
  },
  {
    context: 'C7', fact: 'the server-caps file',
    quote: 'The server-caps file is written by `update/serverCaps.ts` on server nodes and by `ccd-update-sync` on fleet nodes.',
    pins: [
      { file: THIS, describe: CAPS_PIN },
      { file: 'server-caps.test.ts', describe: 'writeServerCaps: tmp then one rename, 0600, never throws' },
    ],
  },
];

/** §2.2's text, from its heading to §2.3's. */
const section22 = (): string => {
  const t = readFileSync(SPEC, 'utf8');
  const from = t.indexOf('\n### 2.2 ');
  const to = t.indexOf('\n### 2.3 ');
  if (from < 0 || to < from) throw new Error('§2.2 not found in the consolidation spec');
  return t.slice(from, to);
};

/** The bullets that state a writer fact: each "Writers:" sub-bullet, each "Facts recorded:" bullet, and C7's
 *  server-caps line. A bullet's continuation lines are joined to it. */
export const writerBullets = (text: string): string[] => {
  const out: string[] = [];
  let inWriters = false;
  let cur: string | null = null;
  const flush = (): void => { if (cur !== null) out.push(cur); cur = null; };
  for (const l of text.split('\n')) {
    if (/^#{1,4} /.test(l) || l.trim() === '') { flush(); inWriters = false; continue; }
    if (/^- \*\*Writers:\*\*/.test(l)) { flush(); inWriters = true; continue; }
    if (/^- \*\*Facts recorded:\*\*/.test(l) || /^- The server-caps file is written by/.test(l)) {
      flush(); inWriters = false; cur = l; continue;
    }
    if (/^- /.test(l)) { flush(); inWriters = false; continue; }
    if (inWriters && /^ {2}- /.test(l)) { flush(); cur = l; continue; }
    if (cur !== null && /^ {2,}\S/.test(l)) { cur += ` ${l.trim()}`; continue; }
    flush();
  }
  flush();
  return out;
};

/** The titles of a test file's `describe(…)` calls whose title is one plain string literal, unescaped. */
const describeTitles = (file: string): string[] => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^\s*describe(?:\.\w+)*\((['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,/gm)]
    .filter((m) => m[1] !== '`' || !m[2]!.includes('${'))
    .map((m) => m[2]!.replace(/\\(.)/g, '$1'));
};

describe('section 2.2\'s facts each map to the writers pins that hold them (#2369; ARCH-40)', () => {
  const bullets = writerBullets(section22());

  it('CONTROL: the bullets are found — 5 in C1\'s Writers, 2 in C3\'s, 3 in C4\'s, 3 in C5\'s, 5 in C6\'s, 3 Facts recorded and C7\'s line', () => {
    expect(bullets.length).toBe(22);
  });

  it('every bullet has a row, and every row\'s quote sits in exactly one bullet', () => {
    const unmapped = bullets.filter((b) => !SECTION_2_2.some((r) => b.includes(r.quote)));
    expect(unmapped).toEqual([]);
    const misquoted = SECTION_2_2.filter((r) => bullets.filter((b) => b.includes(r.quote)).length !== 1).map((r) => r.fact);
    expect(misquoted).toEqual([]);
  });

  it('every cited describe exists, by its exact title, in the file named', () => {
    const testDir = path.resolve(ccrcRoot, 'server', 'test');
    const missing: string[] = [];
    for (const r of SECTION_2_2) {
      for (const p of r.pins) {
        const f = path.join(testDir, p.file);
        const titles = p.file === THIS ? OWN_PINS : existsSync(f) ? describeTitles(f) : [];
        if (!titles.includes(p.describe)) missing.push(`${r.fact}: ${p.file} › ${p.describe}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('a row with no pin, or with pins that hold only part of the fact, says why', () => {
    expect(SECTION_2_2.filter((r) => r.pins.length === 0 && !(r.gap ?? '').trim()).map((r) => r.fact)).toEqual([]);
  });

  it('the facts with no writers pin are exactly the ones recorded here, may only shrink', () => {
    expect(SECTION_2_2.filter((r) => r.pins.length === 0).map((r) => r.fact)).toEqual(['the account roster (`~/.ccrc/accounts.json`)']);
  });
});

// COORD.DB'S RECORDED TABLES. §2.2 C1, C5 and C6 record facts as coord.db rows. Each table's writers are the
// functions holding an INSERT, UPDATE, DELETE FROM or REPLACE INTO naming it, under `server/src`, `agent/src` and
// `shared/`, named `Class.method` by the innermost enclosing symbol (`scan/parse.ts`). MAY ONLY SHRINK: a write from a
// new method, or from outside `CoordStore`, reds here. KNOWN WIDTH: a statement whose table name is built at run time
// (the delegation tables' `delegationInsertSql`) or split from its verb across string pieces is not seen.
const TABLES = ['run_events', 'mail_deliveries', 'feed_events', 'lifecycle_events', 'lifecycle_generations',
  'lifecycle_gaps', 'asks', 'approvals', 'practice_cases', 'continuity_starts', 'continuity_generations', 'continuity_cursor',
  'continuity_snapshots', 'continuity_card_reads', 'continuity_timers', 'continuity_notes', 'continuity_handovers',
  'continuity_probes', 'continuity_reads', 'continuity_checkpoints', 'continuity_renew_calls', 'continuity_soft_renewals',
  'push_outbox', 'operator_items', 'portfolio_rank', 'portfolio_rank_revision',
  'continuity_start_loads', 'answer_marks', 'overlord_authority_head',
  'operator_responses', 'response_receipts', 'response_boots', 'response_settings', 'claim_collisions', 'programme_pairs', 'decision_records', 'decision_days', 'renewal_backstop_settings',
  'programme_remaining', 'programme_edges', 'overlord_designation', 'programme_forecasts', 'overlord_ladder', 'overlord_latches',
  'continuity_renew_requests', 'operator_marks', 'operator_mark_quiet',
  'decision_rows', 'decision_host', 'decision_lines', 'programme_health', 'run_spend',
  'continuity_act_keys', 'approval_census', 'overlord_fence_refusals'] as const;

/** Each table's writers, `file#Class.method`, sorted and unique, read off the one scan (`sqlStatements.ts#sqlWrites`). `tables`
 *  is the table list to read: coord.db's by default, and the private store's for its own describe (Overlord W1 private store A). */
export const tableWriters = (files: readonly string[], tables: readonly string[] = TABLES): Record<string, string[]> => {
  const out: Record<string, Set<string>> = Object.fromEntries(tables.map((t) => [t, new Set<string>()]));
  for (const w of sqlWrites(files, tables)) out[w.table]!.add(w.writer);
  return Object.fromEntries(Object.entries(out).map(([t, s]) => [t, [...s].sort()]));
};

describe(TABLES_PIN, () => {
  const S = 'server/src/coord/store.ts#CoordStore.';
  const OUTBOX_REACH = 'server/src/coord/pushOutboxStore.ts#stampReach';
  it('CONTROL: a write in a method is named by it; a read, and a write to another table, are not', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-map-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, [
        'export class S {',
        "  w(): void { this.db.prepare('INSERT OR IGNORE INTO run_events (a) VALUES (?)'); }",
        "  r(): void { this.db.prepare('SELECT * FROM run_events'); this.db.prepare('INSERT INTO other (a) VALUES (1)'); }",
        "  u(): void { this.db.prepare(`UPDATE asks SET a = 1`); }",
        '}',
      ].join('\n'));
      const w = tableWriters([f]);
      expect(Object.values(w).flat().map((s) => s.replace(/^.*#/, ''))).toEqual(['S.w', 'S.u']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('each table\'s writers, by name', () => {
    const files = ALL.filter((f) => !rel(f).startsWith('pwa/'));
    expect(tableWriters(files)).toEqual({
      // D-8125: `liftReviewCapByCoordinator` writes its lift's event inside the lift's own transaction (the SQL of `recordRunEvent`).
      run_events: ['server/src/coord/reviewCapStore.ts#liftReviewCapByCoordinator', `${S}advanceInner`, `${S}insertObservation`, `${S}recordDeadCoordinatorBreakerHeld`, `${S}recordRunEvent`],
      mail_deliveries: [`${S}queueDelivery`, `${S}writeDeliveries`],
      feed_events: [`${S}recordFeedEvent`],
      lifecycle_events: [`${S}ingestJournal`],
      lifecycle_generations: [`${S}ingestJournal`, `${S}retireGeneration`],
      lifecycle_gaps: [`${S}recordGap`],
      // The push outbox (Overlord W1): `stampReach` is the one writer of `reachedOperatorAt`, on asks and on items.
      asks: [OUTBOX_REACH, ...['correctWithMail', 'declineAsk', 'insertAsk', 'pruneAskQuestions', 'releaseAsk', 'restampAsk', 'settleAsk',
        'staleAsk', 'takeAskForAnswer', 'untakeAsk'].map((m) => `${S}${m}`)],
      approvals: ['correctWithMail', 'declineApproval', 'insertApproval', 'lapseApproval', 'markApprovalOperator',
        'markApprovalOperatorRows', 'pruneApprovalInputs', 'staleApproval', 'takeApprovalForRule'].map((m) => `${S}${m}`),
      // The approval census (approvals PR 1): its one writer, reached only through the questions owner, and its retention.
      approval_census: ['insertCensusRow', 'pruneCensusSummaries'].map((f) => `server/src/coord/approvalCensusStore.ts#${f}`),
      practice_cases: ['server/src/coord/practiceCasesStore.ts#openPracticeCase'],
      continuity_starts: ['server/src/continuity/continuityStore.ts#insertStart'],
      // The designation's go-live restamps the pending body's generation with its term (Overlord W1 designation, X5).
      continuity_generations: ['advanceObserved', 'clearShadowWalk', 'endOverlordGeneration', 'mintGeneration', 'restampOverlordGeneration', 'setGenerationDue', 'setHoldOff',
        'stepGeneration']
        .map((f) => `server/src/continuity/continuityStore.ts#${f}`),
      continuity_cursor: ['server/src/continuity/continuityStore.ts#advanceCursorIn'],
      continuity_snapshots: ['server/src/continuity/continuityStore.ts#insertSnapshot'],
      continuity_card_reads: ['server/src/continuity/continuityStore.ts#insertCardRead'],
      // The timers (Overlord W1a): one writer per move of `TIMER_TRANSITIONS`, and the purge of terminal rows.
      continuity_timers: ['cancelTimer', 'insertTimer', 'markTimersFired', 'purgeTimers'].map((f) => `server/src/continuity/continuityStore.ts#${f}`),
      continuity_notes: ['server/src/continuity/continuityStore.ts#appendNote'],
      continuity_handovers: ['server/src/continuity/continuityStore.ts#putHandover'],
      // The probes (Overlord W1a): one writer per fact, the lane's round and the door's answers; the card and note GETs' stamp.
      continuity_probes: ['answerRound', 'openRound'].map((f) => `server/src/continuity/continuityStore.ts#${f}`),
      continuity_reads: ['server/src/continuity/continuityStore.ts#stampContinuityRead'],
      // The renewal act (Overlord W1a): the generations lane's checkpoint, and its one claim-then-answer record of a renew call.
      continuity_checkpoints: ['server/src/continuity/continuityStore.ts#putCheckpoint'],
      continuity_renew_calls: ['answerRenewCall', 'claimRenewCall'].map((f) => `server/src/continuity/continuityStore.ts#${f}`),
      continuity_soft_renewals: ['server/src/continuity/continuityStore.ts#recordSoftRenewal'],
      continuity_start_loads: ['server/src/continuity/continuityStore.ts#insertStartLoads'],
      // The push outbox (Overlord W1): one writer per move of `OUTBOX_TRANSITIONS`, and the purge of terminal unbound rows.
      push_outbox: ['armBoundRowInTx', 'claimOutboxRow', 'insertBoundRowInTx', 'insertUnboundRow', 'markOutboxVerdict', 'purgeOutbox',
        'sealAtBoot', 'silenceOutboxRow'].map((f) => `server/src/coord/pushOutboxStore.ts#${f}`),
      // The item ledger's raise, its one state move and the level toggle, measured at the push outbox's build; and the reach stamp.
      operator_items: [...['moveItemInTx', 'raiseItemInTx', 'setBlocking'].map((f) => `server/src/coord/ledgersStore.ts#${f}`), OUTBOX_REACH],
      // The portfolio (Overlord W1): the operator's order and its revision, one writer for both, reached from the rank door.
      portfolio_rank: ['server/src/coord/portfolioStore.ts#setPortfolioRank'],
      portfolio_rank_revision: ['server/src/coord/portfolioStore.ts#setPortfolioRank'],
      // The answer marks (Overlord W1): append-only, one writer, reached only from the operator's answer-mark door.
      answer_marks: ['server/src/coord/answerMarkStore.ts#recordAnswerMark'],
      // The Overlord authority journal's head row (Overlord W1, H27): one writer, the apply step of the journal's append, inside
      // its caller's transaction. Confirm the restore's `appendConfirmInTx` joins it in authority journal C.
      overlord_authority_head: ['server/src/coord/overlordAuthorityJournal.ts#OverlordAuthorityJournal.appendInTx'],
      // The designation (Overlord W1, C2): one writer per move of the row, each appending its authority record first where one is owed.
      // The migration's one-time pending-actor backfill is SQL in MIGRATIONS' string, so the scanner names its module.
      overlord_designation: [...['bindPendingGeneration', 'designatePending', 'failPending', 'goLive', 'retire', 'setAccountSet', 'setModelClass', 'stopDone']
        .map((f) => `server/src/coord/overlordDesignationStore.ts#${f}`), 'server/src/coord/schema.ts#(module)'],
      // The ladder (Overlord W1, C5): the rung row's two writers (the doors' and Confirm's) and the catch-up's stamp; each latch row's
      // raise, clear, Confirm's insert and stamp, and the catch-up's stamp.
      overlord_ladder: ['applyRestoreInTx', 'journalPendingInTx', 'setRungInTx'].map((f) => `server/src/coord/overlordLadderStore.ts#${f}`),
      overlord_latches: ['applyRestoreInTx', 'clearLatchInTx', 'journalPendingInTx', 'raiseLatchInTx']
        .map((f) => `server/src/coord/overlordLadderStore.ts#${f}`),
      // The response record (Overlord W1 responses A): the sender's insert and verdict, which is also the deleter by the
      // push's verdict (a never-delivered row holding no receipt, review 2214 F2); the receipts door's one insert, and
      // nothing deletes a receipt; the boot's record.
      // Responses B adds the Waiting on you rows' insert (in the reach's move), the digest lines' (in the digest's claim), the
      // lane's one seal, the handled door's one mark, and the deleter by time, which also removes receipts and older boots.
      operator_responses: ['deleteResponsesThroughInTx', 'insertDigestResponsesInTx', 'insertPushResponseInTx', 'insertWaitingResponseInTx',
        'landPushVerdictInTx', 'markResponseHandled', 'sealResponse'].map((f) => `server/src/coord/responsesStore.ts#${f}`),
      response_receipts: ['deleteResponsesThroughInTx', 'insertReceipt'].map((f) => `server/src/coord/responsesStore.ts#${f}`),
      response_boots: ['deleteResponsesThroughInTx', 'recordResponseBoot'].map((f) => `server/src/coord/responsesStore.ts#${f}`),
      // The retention setting (responses B): its seed row, and the retention door's one writer.
      response_settings: ['server/src/coord/responsesStore.ts#setResponseRetention', 'server/src/coord/schema.ts#(module)'],
      // Overlaps and goal conflicts (Overlord W2, plan w2-overlaps.md Task 3): a refused claim's record, prune included, written
      // only after the claim's own transaction committed; the pairs' rows by the arm's apply, and their goals stamps by the one
      // stamp writer (the ruling joins it in PR B). `mailedAt` and `ruled` get column cases in PR B.
      claim_collisions: ['server/src/coord/claimCollisions.ts#recordCollisions'],
      programme_pairs: ['applyPairMoves', 'stampPairGoalsInTx'].map((f) => `server/src/coord/programmePairsStore.ts#${f}`),
      // The renewal hand-offs (Overlord W1a): the Renew now door's request, the prompt route's mark and the lane's quiet of it.
      continuity_renew_requests: ['server/src/continuity/continuityStore.ts#insertRenewRequest'],
      operator_marks: ['server/src/continuity/continuityStore.ts#putOperatorMark'],
      operator_mark_quiet: ['server/src/continuity/continuityStore.ts#advanceMarkQuiet'],
      // The decision-model records (Overlord W2, plan w2-decision-model.md Task 4): one answer per key, one writer; the day counts'
      // reservation and its settle, the boot release settling through the same writer; the anchor columns' one writer (PR B).
      decision_records: ['server/src/coord/decisionModelStore.ts#recordDecision'],
      decision_days: ['recordAnchorRun', 'reserveDecisionCalls', 'settleDecisionCalls'].map((f) => `server/src/coord/decisionModelStore.ts#${f}`),
      // The decision model's arming (Overlord W2 decision model B, Task 6): a row's one writer, journal record first; the host's
      // one writer, in the key doors' transaction; a line's admission, and its canary columns.
      decision_rows: ['server/src/coord/decisionModelStore.ts#moveDecisionRowInTx'],
      decision_host: ['server/src/coord/decisionModelStore.ts#setDecisionHostInTx'],
      decision_lines: ['admitDecisionLine', 'recordCanary'].map((f) => `server/src/coord/decisionModelStore.ts#${f}`),
      // The daily backstop (Overlord W1 renewal readings A): its seed row, and its door's one writer.
      renewal_backstop_settings: ['server/src/continuity/continuityStore.ts#setBackstop', 'server/src/coord/schema.ts#(module)'],
      // What a programme says is left (Overlord W2 remaining work A): one writer of both tables, reached only from the
      // remaining-work door; remaining work B's `settleEdge` writes `programme_edges`' state columns alone.
      programme_remaining: ['server/src/coord/programmeFactsStore.ts#insertRemaining'],
      programme_edges: ['insertRemaining', 'settleEdge'].map((f) => `server/src/coord/programmeFactsStore.ts#${f}`),
      // The sealed forecasts (Overlord W2 forecasts A, plan w2-forecasts-health.md Task 3): the seal arm's INSERT and the
      // score arm's outcome write, each reached only from its arm of the forecast lane.
      programme_forecasts: ['scoreForecast', 'sealForecast'].map((f) => `server/src/coord/programmeFactsStore.ts#${f}`),
      // Health changes and what each run cost (Overlord W2 forecasts B, plan w2-forecasts-health.md Task 7): one writer
      // each, reached only from its arm of the forecast lane.
      programme_health: ['server/src/coord/programmeFactsStore.ts#appendHealth'],
      run_spend: ['server/src/coord/programmeFactsStore.ts#recordRunSpend'],
      // The door process's act key (Overlord W1 door process A1, plan w1-door-process.md Task 1): three facts, three writers,
      // one row: the claim door's issue and refused-claim count, and the counter, reached only through gates B's guarded adapter.
      continuity_act_keys: ['advanceActCounter', 'issueActKey', 'noteRefusedClaim'].map((f) => `server/src/continuity/actKeyStore.ts#${f}`),
      // The gate's fence refusals (Overlord W1 gates B, plan w1-gates.md Task 5): one writer, which also prunes the table.
      overlord_fence_refusals: ['server/src/coord/overlordGateStore.ts#recordFenceRefusal'],
    });
  });

  // The portfolio's one writer is reached only from the rank door (Overlord W1, plan w1-portfolio.md Task 2; review 2130, F2):
  // every call under `server/src` is listed, never deduplicated, by its innermost enclosing symbol and, inside a route's
  // registration call, by that route. Fastify handlers are anonymous arrows, so the route is what tells a second call in
  // another handler of the same registration function (the box-token goals read among them) from the rank door's own.
  const ROUTE_VERB = /^(get|post|put|delete|patch)$/;
  // The answer marks' one writer is pinned the same way (Overlord W1, plan w1-delegation-marks.md Task 2), so `callSitesOf`
  // takes the callee's name.
  const callSitesOf = (target: string) => (files: readonly string[]): string[] => {
    const out: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (!text.includes(`${target}(`)) continue;
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const syms = parseFile(f).symbols;
      const visit = (node: ts.Node, route: string | null): void => {
        let here = route;
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const first = node.arguments[0];
          if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'app' &&
            ROUTE_VERB.test(callee.name.text) && first !== undefined && ts.isStringLiteral(first)) {
            here = `${callee.name.text.toUpperCase()} ${first.text}`;
          }
          const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
          if (name === target) {
            const at = node.getStart(sf);
            const inner = syms.filter((x) => x.start <= at && at < x.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
            out.push(`${rel(f)}#${inner?.name ?? '(module)'}${here === null ? '' : ` @ ${here}`}`);
          }
        }
        ts.forEachChild(node, (c) => visit(c, here));
      };
      visit(sf, null);
    }
    return out.sort();
  };
  const rankCallSites = callSitesOf('setPortfolioRank');
  const markCallSites = callSitesOf('recordAnswerMark');
  const RANK_CALLS = [
    'server/src/coord/ledgersRoutes.ts#registerLedgerOperatorRoutes @ POST /api/portfolio/rank', `${S}setPortfolioRank`,
  ];
  const plant = async (name: string, text: string, check: (f: string) => void): Promise<void> => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-map-rank-'));
    try {
      const f = path.join(d, name);
      writeFileSync(f, text);
      check(f);
    } finally { rmSync(d, { recursive: true, force: true }); }
  };
  it('CONTROL: a call to setPortfolioRank in a function is named by it; its definition is not a call', async () => {
    await plant('a.ts', ['export function setPortfolioRank(): void {}', 'export function door(): void { setPortfolioRank(); }'].join('\n'),
      (f) => expect(rankCallSites([f]).map((s) => s.replace(/^.*#/, ''))).toEqual(['door']));
  });
  it('CONTROL: a second call in the goals read\'s handler, in the same registration function, is a second entry', async () => {
    const routes = readFileSync(path.join(ccrcRoot, 'server/src/coord/ledgersRoutes.ts'), 'utf8');
    const anchor = '    return reply.code(200).send({ ok: true, ...goalsReadOf(';
    expect(routes.split(anchor)).toHaveLength(2);
    const planted = routes.replace(anchor, `    coord.setPortfolioRank({ basedOn: 0, seen: [], order: [] }, 'x', 0);\n${anchor}`);
    await plant('ledgersRoutes.ts', planted, (f) => {
      const sites = rankCallSites([f]).map((s) => s.replace(/^.*#/, ''));
      expect(sites).toEqual([
        'registerLedgerOperatorRoutes @ GET /api/programmes/:slug/goals', 'registerLedgerOperatorRoutes @ POST /api/portfolio/rank',
      ]);
      expect(sites).not.toEqual([RANK_CALLS[0]!.replace(/^.*#/, '')]);
    });
  });
  it('setPortfolioRank is called exactly once outside the store, inside the POST /api/portfolio/rank handler', () => {
    expect(rankCallSites(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual(RANK_CALLS);
  });
  const MARK_CALLS = [
    'server/src/coord/ledgersRoutes.ts#registerLedgerOperatorRoutes @ POST /api/answer-marks', `${S}recordAnswerMark`,
  ];
  it('CONTROL: a second recordAnswerMark call in the tick door\'s handler is a second entry', async () => {
    const routes = readFileSync(path.join(ccrcRoot, 'server/src/coord/ledgersRoutes.ts'), 'utf8');
    const anchor = "  app.post('/api/items/:id/tick', (req, reply) => {\n";
    expect(routes.split(anchor)).toHaveLength(2);
    const planted = routes.replace(anchor, `${anchor}    deps.coord?.recordAnswerMark({ kind: 'item', id: 1, mark: 'unsure', value: true }, 'x', 0);\n`);
    await plant('ledgersRoutes.ts', planted, (f) => {
      const sites = markCallSites([f]).map((s) => s.replace(/^.*#/, ''));
      expect(sites).toEqual(['registerLedgerOperatorRoutes @ POST /api/answer-marks', 'registerLedgerOperatorRoutes @ POST /api/items/:id/tick']);
      expect(sites).not.toEqual([MARK_CALLS[0]!.replace(/^.*#/, '')]);
    });
  });
  it('recordAnswerMark is called exactly once outside the store, inside the POST /api/answer-marks handler', () => {
    expect(markCallSites(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual(MARK_CALLS);
  });
  // What a programme says is left (Overlord W2 remaining work A, plan w2-remaining-work.md Task 2): `programme_remaining`
  // is append-only, so no statement that changes or removes a row names it anywhere, even inside its one writer (which the
  // map above cannot tell from the INSERT): UPDATE, DELETE, REPLACE INTO, INSERT OR REPLACE, or an INSERT whose
  // ON CONFLICT clause does an UPDATE (review 2347, F4). The writer is reached only from the remaining-work door, and it
  // never changes an edge: the edge's state columns are remaining work B's `settleEdge`'s.
  const remainingCallSites = callSitesOf('insertRemaining');
  const uncommented = (t: string): string => t.replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, '');
  const rowChanges = (table: string) => (text: string): boolean => {
    const code = uncommented(text);
    if (new RegExp(`(?:UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO|INSERT\\s+OR\\s+REPLACE\\s+INTO)\\s+${table}\\b`).test(code)) return true;
    // An upsert names no table after its UPDATE: read each INSERT into the table up to the call that runs it.
    return [...code.matchAll(new RegExp(`INTO\\s+${table}\\b`, 'g'))]
      .some((m) => /ON\s+CONFLICT[^]*?DO\s+UPDATE/.test(code.slice(m.index).split(/\)\s*\.(?:run|get|all|iterate)\(/)[0]!));
  };
  const remainingChanges = rowChanges('programme_remaining');
  const edgeChanges = rowChanges('programme_edges');
  const insertRemainingBody = (text: string): string => {
    const from = text.indexOf('export function insertRemaining(');
    return from < 0 ? '' : text.slice(from, text.indexOf('\n}\n', from));
  };
  it.each([
    'UPDATE programme_remaining SET reason = ?', 'DELETE FROM programme_remaining WHERE id = ?',
    'REPLACE INTO programme_remaining (id) VALUES (?)', 'INSERT OR REPLACE INTO programme_remaining (id) VALUES (?)',
    "db.prepare('INSERT INTO programme_remaining (id) VALUES (?) ' +\n  'ON CONFLICT(id) DO UPDATE SET reason = excluded.reason').run(1)",
  ])('CONTROL: the append-only scan sees %s', (sql) => {
    expect(remainingChanges(sql)).toBe(true);
    expect(remainingChanges(sql.replace('programme_remaining', 'programme_edges'))).toBe(false);
  });
  it('CONTROL: an INSERT followed by another statement\'s upsert is not read as an upsert of programme_remaining', () => {
    expect(remainingChanges("p('INSERT INTO programme_remaining (id) VALUES (?)').run(1);\np('INSERT INTO t (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET n = 1').run(1);")).toBe(false);
  });
  it('no statement that changes or removes a row names programme_remaining anywhere: append-only', () => {
    expect(ALL.filter((f) => !rel(f).startsWith('pwa/') && remainingChanges(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });
  it('insertRemaining never changes or removes an edge: it only inserts into programme_edges', () => {
    const text = readFileSync(path.join(ccrcRoot, 'server/src/coord/programmeFactsStore.ts'), 'utf8');
    expect(insertRemainingBody(text)).toMatch(/INSERT INTO programme_edges/);
    expect(edgeChanges(insertRemainingBody(text))).toBe(false);
    // CONTROL: the same body with an edge UPDATE planted before its return is caught.
    const planted = text.replace('    return { ok: true, id, added, kept };',
      "    db.prepare(\"UPDATE programme_edges SET state = 'met' WHERE id = ?\").run(id);\n    return { ok: true, id, added, kept };");
    expect(planted).not.toBe(text);
    expect(edgeChanges(insertRemainingBody(planted))).toBe(true);
  });
  it('insertRemaining is called exactly once outside the store, inside the remaining-work door', () => {
    expect(remainingCallSites(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual([
      'server/src/coord/programmeRemainingRoute.ts#registerProgrammeRemainingRoute @ POST /api/coord/programmes/:slug/remaining',
      `${S}insertRemaining`,
    ]);
  });
  // Remaining work B (plan w2-remaining-work.md Task 5): an edge's state columns have one writer, `settleEdge`, reached only
  // from the forecast lane's edge arm, and it writes only a row still open. No coordinator path clears an edge.
  it('settleEdge is called exactly once outside the store, inside the forecast lane', () => {
    expect(callSitesOf('settleEdge')(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual([
      'server/src/coord/forecastLane.ts#runForecastLane',
      `${S}settleEdge`,
    ]);
  });
  it('settleEdge\'s UPDATEs set the state columns alone, and only on a row still open', () => {
    const text = readFileSync(path.join(ccrcRoot, 'server/src/coord/programmeFactsStore.ts'), 'utf8');
    const updates = [...uncommented(text).matchAll(/UPDATE\s+programme_edges\s+SET\s+(.*?)\s+WHERE\s+(.*?)["`]\)/g)];
    expect(updates.map((m) => [m[1], m[2]])).toEqual([
      ['state = ?, endedAt = ?, evidence = ?', "id = ? AND state = 'open'"],
      ['unmeasuredSince = ?', "id = ? AND state = 'open' AND unmeasuredSince IS NOT ?"],
    ]);
  });
  // The sealed forecasts (Overlord W2 forecasts A, plan w2-forecasts-health.md Task 3): each writer is reached only from its
  // arm of the forecast lane, and `scoreForecast` writes the outcome columns alone, never a seal's dates, seed or statement.
  it.each(['sealForecast', 'scoreForecast'])('%s is called exactly once outside the store, inside the forecast lane', (fn) => {
    expect(callSitesOf(fn)(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual([
      'server/src/coord/forecastLane.ts#runForecastLane',
      `${S}${fn}`,
    ]);
  });
  it('scoreForecast\'s one UPDATE sets outcome and scoredAt alone, and only on an open row', () => {
    const text = readFileSync(path.join(ccrcRoot, 'server/src/coord/programmeFactsStore.ts'), 'utf8');
    const updates = [...uncommented(text).matchAll(/UPDATE\s+programme_forecasts\s+SET\s+(.*?)\s+WHERE\s+(.*?)["`]\)/g)];
    expect(updates.map((m) => [m[1], m[2]])).toEqual([['outcome = ?, scoredAt = ?', "id = ? AND outcome = 'open'"]]);
  });
  // Health changes and what each run cost (Overlord W2 forecasts B, plan w2-forecasts-health.md Task 7): each writer is reached
  // only from its arm of the forecast lane.
  it.each([['appendHealth', 'healthArm'], ['recordRunSpend', 'spendArm']])('%s is called exactly once outside the store, inside the forecast lane\'s %s', (fn, arm) => {
    expect(callSitesOf(fn)(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual([
      `server/src/coord/forecastLane.ts#${arm}`,
      `${S}${fn}`,
    ]);
  });
  // THE MARKS' READERS (review 2196 F2): no decider reads a mark. `answerMarksOf` is called by the two operator views alone,
  // and `FROM answer_marks` is spelled in the store alone, so a new reader (a gate, a dispatch rule) reds here first.
  const markReadSites = callSitesOf('answerMarksOf');
  // Answer marks B adds `asksViewOf`, the waiting view's ask lists, which only `waitingViewOf` calls.
  const MARK_READS = [
    'server/src/coord/ledgersRoutes.ts#asksViewOf',
    'server/src/coord/ledgersRoutes.ts#registerLedgerOperatorRoutes.operatorView', 'server/src/coord/ledgersRoutes.ts#waitingViewOf',
    `${S}answerMarksOf`,
  ];
  it('CONTROL: an answerMarksOf call in the coordinator\'s box-token items read is a further entry', async () => {
    const routes = readFileSync(path.join(ccrcRoot, 'server/src/coord/ledgersRoutes.ts'), 'utf8');
    const anchor = "deps.presenceOf, deps.secretOf, 'none')) });";
    expect(routes.split(anchor)).toHaveLength(2);
    await plant('ledgersRoutes.ts', routes.replace(anchor, "deps.presenceOf, deps.secretOf, coord.answerMarksOf('item', []))) });"), (f) => {
      const sites = markReadSites([f]).map((x) => x.replace(/^.*#/, ''));
      expect(sites).toContain('registerLedgerCoordinatorRoutes @ GET /api/programmes/:slug/items');
      expect(sites).not.toEqual(MARK_READS.slice(0, 3).map((x) => x.replace(/^.*#/, '')));
    });
  });
  it('answerMarksOf is called only by the operator views (the item view, the waiting view and its ask lists)', () => {
    expect(markReadSites(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual(MARK_READS);
  });
  const tableReaders = (files: readonly string[]): string[] => files.filter((f) => /\bFROM\s+answer_marks\b/.test(
    readFileSync(f, 'utf8').replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, ''))).map(rel).sort();
  it('CONTROL: a FROM answer_marks outside a comment is found, and one in a comment is not', async () => {
    await plant('a.ts', "// SELECT x FROM answer_marks\nexport const q = 'SELECT value FROM answer_marks';\n", (f) => expect(tableReaders([f])).toHaveLength(1));
    await plant('b.ts', '// SELECT x FROM answer_marks\nexport const q = 1;\n', (f) => expect(tableReaders([f])).toEqual([]));
  });
  it('FROM answer_marks is spelled in answerMarkStore.ts alone', () => {
    expect(tableReaders(ALL.filter((f) => !rel(f).startsWith('pwa/')))).toEqual(['server/src/coord/answerMarkStore.ts']);
  });
});

// THE WORKSPACE TOMBSTONE. §2.2 C4 records `.reaped/<id>.json`, the record that outlives a workspace. It is written by
// three ccd functions: `_ws_tombstone` creates it and `_ws_tombstone_patch` and `_ws_tombstone_reclip` rewrite fields of
// it. Every other ccd function that names the path only reads it (a `tomb=` binding, `_ws_tomb_str`,
// `_ws_tomb_children`, a `-s` test or a `sed -n`), and no line writes through `$tomb`. MAY ONLY SHRINK: a new function
// naming the path reds until it is classified. KNOWN WIDTH: a path handed to a Python writer through a reader's
// variable is a read here.
const TOMB_WRITERS = ['_ws_tombstone', '_ws_tombstone_patch', '_ws_tombstone_reclip'];
const TOMB_READ = /\btomb=|_ws_tomb_str |_ws_tomb_children |\[\[ ! -s |\bsed -n /;

describe(TOMB_PIN, () => {
  const sites = (): Array<{ fn: string; code: string }> => {
    const out: Array<{ fn: string; code: string }> = [];
    let fn = '(top level)';
    for (const s of ccdSourceLines()) {
      const open = /^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{/.exec(s.text);
      if (open) fn = open[1]!;
      const code = bashCodeOf(s.text);
      if (/\.reaped\b/.test(code)) out.push({ fn, code });
    }
    return out;
  };

  it('the ccd functions naming the tombstone path, may only shrink', () => {
    expect([...new Set(sites().map((s) => s.fn))].sort()).toEqual([
      '_attic_project', '_ws_expire_locked', '_ws_expire_resume_eval', '_ws_reap_eval', '_ws_reap_locked', '_ws_reap_tail',
      '_ws_reclaim_locked', '_ws_reclaim_recorded_crumb', '_ws_reclaim_resume_eval', '_ws_reclaim_tail',
      ...TOMB_WRITERS,
    ]);
  });

  it('outside the three writers, each naming is a read', () => {
    expect(sites().filter((s) => !TOMB_WRITERS.includes(s.fn) && !TOMB_READ.test(s.code)).map((s) => `${s.fn}: ${s.code.trim()}`))
      .toEqual([]);
  });

  it('no ccd line writes through `$tomb`', () => {
    const w = /(?:>{1,2}\s*["']?\$\{?tomb\b|\b(?:rm|mv|cp|touch|tee|truncate|ln)\b[^;|&]*\$\{?tomb\b)/;
    expect(ccdSourceLines().filter((s) => w.test(bashCodeOf(s.text))).map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it('no other shell, TS, .mjs or Python code names the tombstone path', () => {
    const ccd = new Set(['ccd/ccd', 'ccd/lib/disk-retention.sh', 'ccd/lib/train-proof.sh', 'ccd/lib/delegation-lease.sh']);
    const named = (code: string): boolean => /\.reaped\//.test(code);
    const hits = [
      ...BASH.filter((f) => !ccd.has(rel(f)) && codeLines(f).some(named)),
      ...[...ALL, ...ALL_MJS].filter((f) => named(stallCode(f))),
      ...pyFiles().filter((f) => pyCode(f).some(named)),
    ].map(rel).sort();
    expect(hits).toEqual([]);
  });
});

/** Every tracked Python file, absolute. A failed `git ls-files` throws rather than scanning nothing. */
const pyFiles = (): string[] => {
  const r = spawnSync('git', ['ls-files', '-z', '*.py'], { cwd: ccrcRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files *.py exited ${String(r.status)}`);
  return r.stdout.split('\0').filter(Boolean).map((f) => path.join(ccrcRoot, f));
};
const pyCode = (f: string): string[] => readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));

// THE SERVER-CAPS FILE. §2.2 C7: one fact per node, one writer per node kind — `update/serverCaps.ts#writeServerCaps`
// on a server node, called from one place, and `ccd-update-sync` on a fleet node. Every other code file that names the
// file reads it or spells its name. MAY ONLY SHRINK: a new file naming it, or a second caller of `writeServerCaps`, reds
// until classified. KNOWN WIDTH: a name built from pieces is not seen.
describe(CAPS_PIN, () => {
  const NAMES = /\.ccrc\/server-caps\b|\bSERVER_CAPS_FILE\b|['"]server-caps['"]/;

  it('writeServerCaps is defined in update/serverCaps.ts and called from watch.ts alone', () => {
    const calls = ALL.filter((f) => /(?<![\w.])writeServerCaps\s*\(/.test(stallCode(f).replace(/export\s+(?:async\s+)?function\s+writeServerCaps\s*\(/g, '')))
      .map(rel).sort();
    expect(calls).toEqual(['server/src/watch.ts']);
  });

  it('the code files naming the file, each classified, may only shrink', () => {
    const hits = [
      ...BASH.filter((f) => codeLines(f).some((l) => NAMES.test(l))),
      ...[...ALL, ...ALL_MJS].filter((f) => NAMES.test(stallCode(f))),
      ...pyFiles().filter((f) => pyCode(f).some((l) => NAMES.test(l))),
    ].map(rel);
    expect([...new Set(hits)].sort()).toEqual([
      'ccd/ccd-update-sync',             // the fleet node's writer
      'ccd/ccrc-api',                    // reads it
      'ccd/ccrc-doctor-checks',          // reads it
      'ccd/session-hook.sh',             // reads it
      'deploy/measure-working-state.py', // reads it
      'server/src/update/serverCaps.ts', // the server node's writer
      'server/src/watch.ts',             // calls the writer, and names the file in its warning
      'shared/api.ts',                   // spells the name, SERVER_CAPS_FILE
    ]);
  });
});

// THE PRIVATE STORE'S TABLES (Overlord W1, private store A; spec §9.1, C29). `operator-model.db` is a second SQLite file with
// one owner, `OperatorModelStore`: `recordMessage` is the one INSERT of a message, `moveMessage` the one writer of its state and
// stamps (by the message moves table), and `recordRead` the one writer of the read ledger; `replacePrivateNames` is the one
// writer of the uploaded name list's two tables (Overlord W2, private names B). MAY ONLY SHRINK.
const PRIVATE_TABLES = ['operator_messages', 'read_ledger', 'private_name_list', 'private_name_entries'] as const;
describe('the private store\'s tables: every SQL write is an OperatorModelStore method, by name, may only shrink', () => {
  it('CONTROL: a second UPDATE of operator_messages in another function is named, beside the store\'s own', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-private-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, [
        'export class OperatorModelStore {',
        "  moveMessage(): void { this.db.prepare('UPDATE operator_messages SET state = ? WHERE id = ?'); }",
        '}',
        "export function sneak(): void { db.prepare('UPDATE operator_messages SET text = ? WHERE id = ?'); }",
        "export function look(): void { db.prepare('SELECT * FROM read_ledger'); }",
      ].join('\n'));
      const w = tableWriters([f], PRIVATE_TABLES);
      expect(Object.fromEntries(Object.entries(w).map(([t, ws]) => [t, ws.map((s) => s.replace(/^.*#/, ''))])))
        .toEqual({ operator_messages: ['OperatorModelStore.moveMessage', 'sneak'], read_ledger: [], private_name_list: [], private_name_entries: [] });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('each table\'s writers, by name', () => {
    const files = ALL.filter((f) => !rel(f).startsWith('pwa/'));
    const S = 'server/src/operatorModel/store.ts#OperatorModelStore.';
    expect(tableWriters(files, PRIVATE_TABLES)).toEqual({
      operator_messages: [`${S}moveMessage`, `${S}recordMessage`],
      read_ledger: [`${S}recordRead`],
      private_name_list: [`${S}replacePrivateNames`],
      private_name_entries: [`${S}replacePrivateNames`],
    });
  });
});

// THE COORDINATOR CALL RECORD (D-8126, migration 55). Its table has one writer per column, all in `coordCallsStore.ts`:
// `insertCall` the only INSERT, `markCallSeen` the only writer of `seenAt`, `overturnCallTx` of `overturnedAt` and
// `overturnNote`, `markBlockWoken` of `wokenAt`. MAY ONLY SHRINK: a statement from another function, or a SET naming one
// of these columns elsewhere, reds here. KNOWN WIDTH: a statement split from its verb across string pieces is not seen.
describe('coordinator_calls: one writer per column, every write in coordCallsStore.ts', () => {
  const writes = (files: readonly string[]): Record<string, string[]> => {
    const out: Record<string, Set<string>> = {};
    const verb = /(INSERT(?:\s+OR\s+\w+)?\s+INTO\s+coordinator_calls\b|UPDATE\s+coordinator_calls\s+SET\s+([^'"`]*?)\s+WHERE|DELETE\s+FROM\s+coordinator_calls\b)/g;
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, (l) => ' '.repeat(l.length));
      if (!text.includes('coordinator_calls')) continue;
      const syms = parseFile(f).symbols;
      for (const m of text.matchAll(verb)) {
        const at = m.index!;
        const inner = syms.filter((s) => s.start <= at && at < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        const who = `${rel(f)}#${inner?.name ?? '(module)'}`;
        const keys = m[2] === undefined
          ? [m[1]!.startsWith('DELETE') ? 'DELETE' : 'INSERT']
          : [...m[2].matchAll(/(\w+)\s*=/g)].map((c) => c[1]!);
        for (const k of keys) (out[k] ??= new Set()).add(who);
      }
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)).map(([k, s]) => [k, [...s].sort()]));
  };

  it('CONTROL: an INSERT, a SET column and a DELETE are each found, and a SELECT is not', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-calls-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, [
        'export function ins(): void { db.prepare(`INSERT INTO coordinator_calls (a) VALUES (1)`); }',
        "export function upd(): void { db.prepare('UPDATE coordinator_calls SET seenAt = ? WHERE id = ?'); }",
        "export function del(): void { db.prepare('DELETE FROM coordinator_calls'); }",
        "export function sel(): void { db.prepare('SELECT * FROM coordinator_calls'); }",
      ].join('\n'));
      const w = writes([f]);
      expect(Object.keys(w)).toEqual(['DELETE', 'INSERT', 'seenAt']);
      expect(Object.values(w).flat().map((s) => s.replace(/^.*#/, ''))).toEqual(['del', 'ins', 'upd']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('each column\'s writer, by name', () => {
    const files = ALL.filter((f) => !rel(f).startsWith('pwa/'));
    const F = 'server/src/coord/coordCallsStore.ts#';
    expect(writes(files)).toEqual({
      INSERT: [`${F}insertCall`],
      overturnNote: [`${F}overturnCallTx`],
      overturnedAt: [`${F}overturnCallTx`],
      seenAt: [`${F}markCallSeen`],
      wokenAt: [`${F}markBlockWoken`],
    });
  });
});

// Overlord W1, portfolio B (plan `w1-portfolio.md` Task 4; Table 11.1a, "`ratifiedBy` on each goals version"): the goals
// versions' ratification columns have the writers the plan names and no other. `ratifiedBy` and `ratifiedAt` are written
// by `setSpecPin` (a re-pin records its own source) and the operator's `ratifyGoalsVersion` on `programs`, and by
// `addModification` and `ratifyGoalsVersion` on `programme_modifications`; `ratifiedActor` (review 2240 F7) by the same
// writers of `programs` and by `ratifyGoalsVersion` alone on a modification (an insert leaves it NULL); `doneWhenBy` only in
// the statements that write `doneWhen` (`setSpecPin`, `setDoneWhen`). Review 2240 F2 widened it to the TEXT the source
// describes: the pin's `specPath`, `inShort`, `inShortAt` and `doneWhen`, and a modification's `text`, `ruling` and
// `itemId` (keyed by table, since those names are common), so a writer of the text that skips the source is a new entry.
// MAY ONLY SHRINK. KNOWN WIDTH: a statement split from its verb across string pieces is not seen, as in the census above.
describe('the goals versions\' ratification columns: every write in ledgersStore.ts, by the plan\'s writers', () => {
  const COLS = /\b(ratifiedBy|ratifiedAt|ratifiedActor|doneWhenBy|doneWhen|inShort|inShortAt|specPath)\b/g;
  const MOD_TEXT = /\b(text|ruling|itemId)\b/g;
  const writes = (files: readonly string[]): Record<string, string[]> => {
    const out: Record<string, Set<string>> = {};
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, (l) => ' '.repeat(l.length));
      if (!/ratifiedBy|ratifiedAt|ratifiedActor|doneWhen|inShort|specPath|programme_modifications/.test(text)) continue;
      const syms = parseFile(f).symbols;
      for (const m of text.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)) {
        const lit = m[0];
        if (!/\b(?:UPDATE|INSERT)\b/.test(lit)) continue;
        const at = m.index!;
        const inner = syms.filter((s) => s.start <= at && at < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        const by = `${rel(f)}#${inner?.name ?? '(module)'}`;
        for (const c of lit.matchAll(COLS)) (out[c[1]!] ??= new Set()).add(by);
        if (/\bprogramme_modifications\b/.test(lit)) for (const c of lit.matchAll(MOD_TEXT)) (out[`programme_modifications.${c[1]!}`] ??= new Set()).add(by);
      }
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)).map(([k, s]) => [k, [...s].sort()]));
  };
  const STORE = 'server/src/coord/ledgersStore.ts';
  const F = `${STORE}#`;
  // `addModification.insert` is the insert closure inside `addModification` (the row and a new list are one act there).
  const EXPECTED = {
    doneWhen: [`${F}setDoneWhen`, `${F}setSpecPin`],
    doneWhenBy: [`${F}setDoneWhen`, `${F}setSpecPin`],
    inShort: [`${F}setSpecPin`],
    inShortAt: [`${F}setSpecPin`],
    'programme_modifications.itemId': [`${F}addModification.insert`],
    'programme_modifications.ruling': [`${F}addModification.insert`],
    'programme_modifications.text': [`${F}addModification.insert`],
    ratifiedActor: [`${F}ratifyGoalsVersion`, `${F}setSpecPin`],
    ratifiedAt: [`${F}addModification.insert`, `${F}ratifyGoalsVersion`, `${F}setSpecPin`],
    ratifiedBy: [`${F}addModification.insert`, `${F}ratifyGoalsVersion`, `${F}setSpecPin`],
    specPath: [`${F}setSpecPin`],
  };

  it('CONTROL: an UPDATE and an INSERT naming a column are found by their function; a SELECT and a comment are not', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-ratified-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, [
        "export function upd(): void { db.prepare(\"UPDATE programs SET doneWhenBy = 'pin' WHERE slug = ?\"); }",
        'export function ins(): void { db.prepare(`INSERT INTO programme_modifications (ratifiedBy) VALUES (?)`); }',
        "export function sel(): void { db.prepare('SELECT ratifiedAt FROM programs'); }",
        "// UPDATE programs SET ratifiedAt = 1",
      ].join('\n'));
      const w = writes([f]);
      expect(w).toEqual({ doneWhenBy: [`${rel(f)}#upd`], ratifiedBy: [`${rel(f)}#ins`] });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('CONTROL: a planted fifth writer in ledgersStore.ts is a further entry', async () => {
    const real = readFileSync(path.join(ccrcRoot, STORE), 'utf8');
    const planted = `${real}\nexport function plantedWriter(db: DatabaseSync): void { db.prepare("UPDATE programs SET ratifiedBy = 'operator' WHERE slug = ?").run('x'); }\n`;
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-ratified-plant-'));
    try {
      const f = path.join(d, 'ledgersStore.ts');
      writeFileSync(f, planted);
      expect(writes([f])['ratifiedBy']).toContain(`${rel(f)}#plantedWriter`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('each column\'s writers, by name, under server/src', () => {
    const files = ALL.filter((f) => rel(f).startsWith('server/src/'));
    expect(writes(files)).toEqual(EXPECTED);
  });
});

// Overlord W2 done tests A (plan `w2-done-tests.md` DT7): `runs.closePr`, a run's own bound PR as its close measured it,
// has ONE writer, `CoordStore.closeRun`, in the close's transaction. A second statement that writes the column, anywhere
// under server/src, is a further entry and reds here. KNOWN WIDTH: a statement split from its verb across string pieces.
describe('runs.closePr: one writer, CoordStore.closeRun', () => {
  const writers = (files: readonly string[]): string[] => {
    const out = new Set<string>();
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, (l) => ' '.repeat(l.length));
      if (!text.includes('closePr')) continue;
      const syms = parseFile(f).symbols;
      for (const m of text.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)) {
        if (!/\b(?:UPDATE|INSERT)\b/.test(m[0]) || !/\bclosePr\b/.test(m[0])) continue;
        const inner = syms.filter((s) => s.start <= m.index! && m.index! < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        out.add(`${rel(f)}#${inner?.name ?? '(module)'}`);
      }
    }
    return [...out].sort();
  };

  it('CONTROL: an UPDATE naming the column is found by its function; a SELECT and a comment are not', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const d = mkdtempSync(path.join(tmpdir(), 'writers-closepr-'));
    try {
      const f = path.join(d, 'a.ts');
      writeFileSync(f, [
        "export function upd(): void { db.prepare('UPDATE runs SET closePr = ? WHERE id = ?'); }",
        "export function sel(): void { db.prepare('SELECT closePr FROM runs'); }",
        '// UPDATE runs SET closePr = NULL',
      ].join('\n'));
      expect(writers([f])).toEqual([`${rel(f)}#upd`]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('its one writer, by name, under server/src', () => {
    expect(writers(ALL.filter((f) => rel(f).startsWith('server/src/')))).toEqual(['server/src/coord/store.ts#CoordStore.closeRun']);
  });
});
