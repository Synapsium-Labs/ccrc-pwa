// Path-identity W1b (path-identity spec §2.2, §2.4): the three token verbs, ws-reclaim, ws-expire and ws-collect,
// take each identity key and its value as ONE pair, and refuse a dash-leading id at entry, before the reap lock.
//
// These are the verbs that delete. The server appends its decision flags after the id, and each loop used to scan the
// `--session` value again as a flag:
//   - an id of `--actor`, `--surface` or `--reason` lost its value to the dec arm, and the sweeps' surface word,
//     `agent`, bound as the id;
//   - an id of `--expect`, `--child-of`, `--session` or `--branch` (and, at ws-expire and ws-collect, `--defer-expired`)
//     stayed literal, passed the old id regex, and could open `$REG/.reap---<x>.lock` before the token refused (at
//     ws-reclaim, an id of `--defer-expired` was eaten by its own arm and answered the usage line). A reap lock is never unlinked
//     (path-identity spec §2.5), so each such call left one for good.
// A call that spells no id, token or run id as a flag answers as before: a lone key, a key given twice and a pair out of order still
// reach the exact-arity rule and answer the usage line, and the dec ladder still runs first.
//
// FIXTURE HOMEs ONLY. Every call runs the SOURCED function in `makePrHarness`'s HOME. `CHILD_STUBS` records the unit
// and pane calls instead of making them, and `CHILD_ENV` keeps the residue probe inside the HOME. The argv is TYPED
// here, in the order each server builder composes it (`wsReclaim`, `wsExpire` and `wsCollect` in
// server/src/ccdargv.ts). This file imports nothing from server/src; `ccdargv-dash-id-parity.test.ts` runs the
// composed argv on the real binary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, makeChild } from './childReclaimFixture.js';
import { EXP_ID, EXP_STUBS, expireVerb, makeArchived } from './wsExpireFixture.js';
import { COL_ID, WRONG_TOKEN, collectVerb, docOf, makeOrphan } from './wsCollectFixture.js';
import { DASH_IDS, DECOY_IDS, plantRow, reapLocks, regDirOf, regListing } from './dashIdFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-token-verbs-dash-id-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
/** Well-formed, so ws-expire's and ws-collect's token check, which runs BEFORE their id check, passes and the id check
 *  is what answers. Under a mutant that lets the id through, the verb goes on and opens the reap lock, where it shows. */
const TOK = 'a'.repeat(64);
/** The dec the sweeps append (`decFlags`), without and with a reason. */
const DEC = '--surface agent --actor x';
const DEC_R = '--surface agent --actor x --reason r';
/** The ids a dec arm used to take the value of, leaving the surface word to bind (spec §2.2). */
const REBINDING: readonly string[] = ['--actor', '--surface', '--reason'];
/** The rest of `DASH_IDS`: each stayed literal and opened `.reap---<x>.lock`. `--branch` is among them: no token verb
 *  has that key, so it was literal too. */
const LITERAL: readonly string[] = DASH_IDS.filter((d) => !REBINDING.includes(d));
const q = (s: string): string => `'${s}'`;
const linesOf = (s: string): string[] => s.split('\n');
const isDecoy = (id: unknown): boolean => (DECOY_IDS as readonly string[]).includes(String(id));
/** The registry names that belong to a decoy: its rows, and any reap lock taken for it. */
const decoyNames = (home: string): string[] =>
  regListing(home).filter((n) => DECOY_IDS.some((d) => n.startsWith(`${d}.`) || n === `.reap-${d}.lock`));

interface TokenVerbCase {
  /** The journal act this verb's refusals are written under. */
  readonly act: 'reclaim' | 'expire' | 'collect';
  /** Everything up to and including the function name: the recorders, the residue root, the sourced verb. */
  readonly call: string;
  /** The verb's keys before `--session <id>`, in its builder's order. */
  readonly head: (token: string) => string;
  /** What the server appends after the id: the dec, without and with a reason, and for ws-reclaim also with the
   *  `--defer-expired` that `deferFlags` puts before the dec. */
  readonly tails: readonly string[];
  /** The verb's usage literal, as its `die` prints it after `ccd: `. */
  readonly usage: string;
  /** The real id of the verb's own fixture. */
  readonly id: string;
  /** Argvs whose token or run id spells a flag, with the line the verb answers once that value is taken whole. */
  readonly flagValues: readonly (readonly [string, string])[];
}

const RECLAIM: TokenVerbCase = {
  act: 'reclaim',
  call: `${CHILD_STUBS} ${CHILD_ENV} cmd_ws_reclaim`,
  head: (token) => `--expect ${token} --child-of ${CHILD_RUN}`,
  tails: [DEC, DEC_R, `--defer-expired ${DEC}`, `--defer-expired ${DEC_R}`],
  usage: 'usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id> [--defer-expired] [--surface <word>] [--actor <text>] [--reason <text>]',
  id: CHILD_ID,
  flagValues: [
    [`--expect --surface --child-of ${CHILD_RUN} --session ${CHILD_ID} ${DEC}`, 'ccd: bad token'],
    [`--expect ${TOK} --child-of --surface --session ${CHILD_ID} ${DEC}`, 'ccd: bad run id'],
  ],
};
const EXPIRE: TokenVerbCase = {
  act: 'expire',
  call: `${EXP_STUBS} ${CHILD_ENV} cmd_ws_expire`,
  head: (token) => `--expect ${token}`,
  tails: [DEC, DEC_R],
  usage: 'usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]',
  id: EXP_ID,
  flagValues: [[`--expect --surface --session ${EXP_ID} ${DEC}`, 'ccd: bad token']],
};
const COLLECT: TokenVerbCase = {
  act: 'collect',
  call: 'cmd_ws_collect',
  head: (token) => `--expect ${token}`,
  tails: [DEC, DEC_R],
  usage: 'usage: ccd ws-collect --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]',
  id: COL_ID,
  flagValues: [[`--expect --surface --session ${COL_ID} ${DEC}`, 'ccd: bad token']],
};

interface Snapshot { readonly listing: string[]; readonly journal: Record<string, unknown>[]; readonly decoys: string[] }

/** Plants the decoy rows `agent` and `pwa` with node:fs. For ws-collect it also writes a plain file under `tmproots/`
 *  for each name in `witnessed`: the collector opens the reap lock for any name a witness file stands for, so a
 *  mutant that lets the name through shows as a lock. Sources ccd once, so anything sourcing writes is already in the
 *  snapshot it returns. */
function setup(v: TokenVerbCase, witnessed: readonly string[]): Snapshot {
  for (const d of DECOY_IDS) plantRow(h.home, d);
  if (v.act === 'collect') {
    const dir = path.join(regDirOf(h.home), 'tmproots');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of witnessed) fs.writeFileSync(path.join(dir, n), 'not a witness\n');
  }
  h.sh('true');
  return { listing: regListing(h.home), journal: readJournal(h.home), decoys: decoyNames(h.home) };
}

/** The cases every token verb shares, registered inside that verb's own describe. */
function sharedCases(v: TokenVerbCase): void {
  const run = (argv: string): { code: number; stdout: string; stderr: string } => h.run(`${v.call} ${argv}`);
  /** The server's argv for `id`: the verb's keys, the id, then what the server appends. */
  const server = (id: string, tail: string): string => `${v.head(TOK)} --session ${q(id)} ${tail}`;

  /** Dies "bad session id" at exit 1, prints no document, and moves nothing: no reap lock, no journal line, no unit
   *  or pane call, and the registry exactly as it was. */
  const diesBadId = (argv: string, before: Snapshot): void => {
    const r = run(argv);
    expect(r.code, `${argv}\n${r.stdout}${r.stderr}`).toBe(1);
    expect(r.stdout, argv).toBe('');
    expect(linesOf(r.stderr), argv).toContain('ccd: bad session id');
    expect(reapLocks(h.home), `${argv}: a reap lock was created`).toEqual([]);
    expect(eventsOf(h.home, v.act), `${argv}: a ${v.act} line was journaled`).toEqual([]);
    expect(readJournal(h.home), argv).toEqual(before.journal);
    expect(h.calls(), `${argv}: a unit or pane call was made`).toEqual([]);
    expect(regListing(h.home), `${argv}: the registry changed`).toEqual(before.listing);
  };
  /** Answers the verb's usage line at exit 1, as it did before this task, and moves nothing. */
  const answersUsage = (argv: string, before: Snapshot): void => {
    const r = run(argv);
    expect(r.code, `${argv}\n${r.stdout}${r.stderr}`).toBe(1);
    expect(r.stdout, argv).toBe('');
    expect(linesOf(r.stderr), argv).toContain(`ccd: ${v.usage}`);
    expect(reapLocks(h.home), argv).toEqual([]);
    expect(regListing(h.home), argv).toEqual(before.listing);
  };

  it('an id of --actor, --surface or --reason never rebinds to the surface word', () => {
    const before = setup(v, [...DECOY_IDS, ...DASH_IDS]);
    for (const id of REBINDING) for (const tail of v.tails) diesBadId(server(id, tail), before);
    expect(decoyNames(h.home), 'the decoys stand as planted').toEqual(before.decoys);
  }, 120_000);

  it('an id of --expect, --child-of, --defer-expired or --session dies before any lock', () => {
    const before = setup(v, [...DECOY_IDS, ...DASH_IDS]);
    for (const id of LITERAL) for (const tail of v.tails) diesBadId(server(id, tail), before);
  }, 120_000);

  it("a lone trailing --session still answers today's usage line", () => {
    const before = setup(v, DECOY_IDS);
    for (const argv of [
      `${v.head(TOK)} --session`,
      `${v.head(TOK)} ${DEC} --session`,
      // A missing id in the middle: the arm takes `--surface` as the value, and the residue is still the wrong length.
      `${v.head(TOK)} --session ${DEC}`,
      `${v.head(TOK)} --session ${v.id} --expect`,
    ]) answersUsage(argv, before);
    // THE DEC LADDER STILL RUNS BEFORE THE ARITY RULE: the arm sends a lone key to the residue and refuses nothing
    // itself, so a blank --actor ahead of a lone --session still answers in the actor's own words.
    const r = run(`${v.head(TOK)} --actor ' ' --session`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(linesOf(r.stderr)).toContain('ccd: --actor must be non-blank');
  }, 120_000);

  it("--session given twice still answers today's usage line", () => {
    const before = setup(v, DECOY_IDS);
    for (const argv of [
      `${v.head(TOK)} --session ${v.id} --session ${v.id}`,
      `${v.head(TOK)} --session demo-quiet-a --session demo-quiet-b ${DEC}`,
      `${v.head(TOK)} ${v.head(TOK)} --session ${v.id}`,
    ]) answersUsage(argv, before);
  }, 120_000);

  it("an identity pair out of the verb's order still answers today's usage line", () => {
    const before = setup(v, DECOY_IDS);
    for (const argv of [
      `--session ${v.id} ${v.head(TOK)}`,
      `${DEC} --session ${v.id} ${v.head(TOK)}`,
    ]) answersUsage(argv, before);
  }, 120_000);

  it('a token or run id spelled as a flag is taken whole, and refused as the malformed value it is', () => {
    setup(v, DECOY_IDS);
    for (const [argv, said] of v.flagValues) {
      const r = run(argv);
      expect(r.code, `${argv}\n${r.stdout}${r.stderr}`).toBe(1);
      expect(linesOf(r.stderr), argv).toContain(said);
      expect(reapLocks(h.home), argv).toEqual([]);
    }
    expect(readJournal(h.home).filter((e) => e['id'] !== v.id), 'a line names an id other than the real one').toEqual([]);
  }, 120_000);
}

describe('ws-reclaim takes --session whole: a flag-spelled id dies "bad session id" before the lock (path-identity spec §2.2, §2.4)', () => {
  sharedCases(RECLAIM);

  it("the server's argv for a real id still reaches the token check", () => {
    makeChild(h);
    const before = setup(RECLAIM, DECOY_IDS);
    // ws-reclaim checks its token right AFTER the id, and journals the refusal against that id: here, the REAL one.
    for (const tail of RECLAIM.tails) {
      const r = childReclaimVerb(h, 'x', { extra: tail });
      expect(r.code, `${tail}\n${r.stdout}${r.stderr}`).toBe(1);
      expect(linesOf(r.stderr), tail).toContain('ccd: bad token');
    }
    // Flags in any position, as before: the dec LEADING the verb's keys.
    const lead = h.run(`${RECLAIM.call} ${DEC} --expect x --child-of ${CHILD_RUN} --session ${CHILD_ID}`);
    expect(lead.code, lead.stdout + lead.stderr).toBe(1);
    expect(linesOf(lead.stderr)).toContain('ccd: bad token');
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['id'], e['refusal']]))
      .toEqual([...RECLAIM.tails, DEC].map(() => ['refused', CHILD_ID, 'token-malformed']));
    expect(reapLocks(h.home)).toEqual([]);
    expect(readJournal(h.home).filter((e) => isDecoy(e['id']))).toEqual([]);
    expect(decoyNames(h.home)).toEqual(before.decoys);
  }, 120_000);
});

describe('ws-expire takes --session whole: a flag-spelled id dies "bad session id" before the lock (path-identity spec §2.2, §2.4)', () => {
  sharedCases(EXPIRE);

  it("the server's argv for a real id still reaches the token check", () => {
    makeArchived(h);
    const before = setup(EXPIRE, DECOY_IDS);
    for (const tail of EXPIRE.tails) {
      // ws-expire checks its token BEFORE its id, so a malformed one dies first, in the words it always had.
      const bad = expireVerb(h, 'x', { extra: tail });
      expect(bad.code, `${tail}\n${bad.stdout}${bad.stderr}`).toBe(1);
      expect(linesOf(bad.stderr), tail).toContain('ccd: bad token');
      // A well-formed token the audit never minted: the REAL id binds, takes ITS lock, and is refused state-changed.
      const r = expireVerb(h, 'f'.repeat(64), { extra: tail });
      expect(r.code, `${tail}\n${r.stdout}${r.stderr}`).toBe(0);
      expect(docOf(r.stdout)['refused'], tail).toBe('state-changed');
    }
    const rows = eventsOf(h.home, 'expire');
    expect([...new Set(rows.map((e) => e['id']))], 'every expire line names the real id').toEqual([EXP_ID]);
    const refused = rows.filter((e) => e['outcome'] === 'refused');
    expect(refused.map((e) => [e['refusal'], decOf(e)['surface'], decOf(e)['actor']]))
      .toEqual(EXPIRE.tails.map(() => ['state-changed', 'agent', 'x']));
    expect(decOf(refused[1]!)['reason'], 'the dec with a reason reached the journal whole').toBe('r');
    expect(fs.existsSync(path.join(regDirOf(h.home), `.reap-${EXP_ID}.lock`)), 'the real id took its own lock').toBe(true);
    expect(reapLocks(h.home), 'and no other lock was taken').toHaveLength(1);
    expect(readJournal(h.home).filter((e) => isDecoy(e['id']))).toEqual([]);
    expect(decoyNames(h.home)).toEqual(before.decoys);
  }, 180_000);
});

describe('ws-collect takes --session whole: a flag-spelled id dies "bad session id" before the lock (path-identity spec §2.2, §2.4)', () => {
  sharedCases(COLLECT);

  // Linux only, as `ccd-ws-collect-verb.test.ts`'s end-to-end cases are: the state-changed half needs an evaluation
  // that answers collectable, and the collector is Linux-first.
  it.skipIf(!LINUX)("the server's argv for a real id still reaches the token check", () => {
    makeOrphan(h);
    const before = setup(COLLECT, DECOY_IDS);
    for (const tail of COLLECT.tails) {
      // ws-collect checks its token BEFORE its id, so a malformed one dies first, in the words it always had.
      const bad = collectVerb(h, 'nothex', { extra: tail });
      expect(bad.code, `${tail}\n${bad.stdout}${bad.stderr}`).toBe(1);
      expect(linesOf(bad.stderr), tail).toContain('ccd: bad token');
      // A well-formed token no audit minted: the REAL id binds, takes ITS lock, and is refused state-changed.
      const r = collectVerb(h, WRONG_TOKEN, { extra: tail });
      expect(r.code, `${tail}\n${r.stdout}${r.stderr}`).toBe(0);
      expect(docOf(r.stdout)['refused'], tail).toBe('state-changed');
    }
    const rows = eventsOf(h.home, 'collect');
    expect(rows.map((e) => [e['outcome'], e['id'], e['refusal'], decOf(e)['surface'], decOf(e)['actor']]))
      .toEqual(COLLECT.tails.map(() => ['refused', COL_ID, 'state-changed', 'agent', 'x']));
    expect(decOf(rows[1]!)['reason'], 'the dec with a reason reached the journal whole').toBe('r');
    expect(fs.existsSync(path.join(regDirOf(h.home), `.reap-${COL_ID}.lock`)), 'the real id took its own lock').toBe(true);
    expect(reapLocks(h.home), 'and no other lock was taken').toHaveLength(1);
    expect(readJournal(h.home).filter((e) => isDecoy(e['id']))).toEqual([]);
    expect(decoyNames(h.home)).toEqual(before.decoys);
  }, 180_000);
});
