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
import { parseFile } from '../scan/parse.js';
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
  'continuity_snapshots', 'continuity_card_reads', 'continuity_timers'] as const;

/** Each table's writers, `file#Class.method`, sorted and unique. */
export const tableWriters = (files: readonly string[]): Record<string, string[]> => {
  const out: Record<string, Set<string>> = Object.fromEntries(TABLES.map((t) => [t, new Set<string>()]));
  const verb = new RegExp(`(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+(${TABLES.join('|')})\\b`, 'g');
  for (const f of files) {
    // Comment lines blanked to spaces, so prose naming a statement is not a writer and offsets still hold.
    const text = readFileSync(f, 'utf8').replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, (l) => ' '.repeat(l.length));
    if (!TABLES.some((t) => text.includes(t))) continue;
    const hits = [...text.matchAll(verb)];
    if (hits.length === 0) continue;
    const syms = parseFile(f).symbols;
    for (const m of hits) {
      const at = m.index!;
      const inner = syms.filter((s) => s.start <= at && at < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      out[m[1]!]!.add(`${rel(f)}#${inner?.name ?? '(module)'}`);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([t, s]) => [t, [...s].sort()]));
};

describe(TABLES_PIN, () => {
  const S = 'server/src/coord/store.ts#CoordStore.';
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
      asks: ['correctWithMail', 'declineAsk', 'insertAsk', 'pruneAskQuestions', 'releaseAsk', 'restampAsk', 'settleAsk',
        'staleAsk', 'takeAskForAnswer', 'untakeAsk'].map((m) => `${S}${m}`),
      approvals: ['correctWithMail', 'declineApproval', 'insertApproval', 'lapseApproval', 'markApprovalOperator',
        'markApprovalOperatorRows', 'pruneApprovalInputs', 'staleApproval', 'takeApprovalForRule'].map((m) => `${S}${m}`),
      practice_cases: ['server/src/coord/practiceCasesStore.ts#openPracticeCase'],
      continuity_starts: ['server/src/continuity/continuityStore.ts#insertStart'],
      continuity_generations: ['advanceObserved', 'clearShadowWalk', 'mintGeneration', 'setGenerationDue', 'setHoldOff', 'stepGeneration']
        .map((f) => `server/src/continuity/continuityStore.ts#${f}`),
      continuity_cursor: ['server/src/continuity/continuityStore.ts#advanceCursorIn'],
      continuity_snapshots: ['server/src/continuity/continuityStore.ts#insertSnapshot'],
      continuity_card_reads: ['server/src/continuity/continuityStore.ts#insertCardRead'],
      // The timers (Overlord W1a): one writer per move of `TIMER_TRANSITIONS`, and the purge of terminal rows.
      continuity_timers: ['cancelTimer', 'insertTimer', 'markTimersFired', 'purgeTimers'].map((f) => `server/src/continuity/continuityStore.ts#${f}`),
    });
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
