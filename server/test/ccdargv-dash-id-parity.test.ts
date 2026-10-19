// server/test/ccdargv-dash-id-parity.test.ts
//
// NO DASH-LEADING ID REDIRECTS A VERB THE SERVER COMPOSES, MEASURED ON THE REAL
// BINARY (path-identity spec §2.2, §2.8).
//
// The server appends its decision flags AFTER the id:
// `<verb> --session <id> --surface <s> --actor <a> [--reason <r>]`. Before
// path-identity W1b, each of the eight `--session` loops in ccd collected every
// token it did not recognise into one residue, and bound `--session <id>` from
// that residue only afterwards. So an id that spelled a flag was scanned again as
// one. With an id of `--actor`, `--actor --surface` read as a pair, and the
// surface word (the sweeps' `agent`, or the console's `pwa`) was left over as the
// id. stop's positional id and ws-add's positional project had the same shape.
// W1b takes each identity pair whole and refuses a dash-leading id. This file is
// the crossing nothing else makes for it: every argv a builder in `ccdargv.ts`
// composes, with every flag spelling as the id, run through the real `ccd` in a
// fixture HOME.
//
// WHAT A ROW ASSERTS. The fixture plants decoy rows named for the surface words,
// each holding a hold, and a row named for the probed id itself. A row is green
// when the verb does all of these:
//   - it refuses: a non-zero exit, or a `"refused"` document at exit 0;
//   - it never answers as a verb that looked the id up as a row;
//   - it creates no reap lock;
//   - it journals nothing naming a decoy or the probed id, except ws-restore's
//     own `bad-session-id` refusal, which journals the id it refused;
//   - it changes no unit, and kills or makes no pane;
//   - it changes no registry row or field, and leaves each decoy as it was.
//
// WHICH BINARY. `DASH_PARITY_CCD` selects another copy. Spec §8's measurement
// runs this file once against the pre-wave `ccd/ccd`, written to a scratch file
// outside the tree, and the mutation rows run against scratch copies. So the
// tracked file is never overwritten to measure anything. When the variable is
// unset, the binary is the checkout's own `ccd/ccd`.
//
// COMPOSED, NEVER TYPED, with one exception: stop's second argv. Path identity
// W1a moves `stopId` to send `--surface` first, while a server from before W1a
// composes the id first. Whichever order the builder in this tree composes, the
// other is typed here, because no builder composes it.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan. Its one bash spawn goes through `ghContainedEnv` and asks
// for both poisons.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, ghContainedEnv, harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CCD_ARGV, type ActorFlags } from '../src/ccdargv.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { DASH_IDS, DECOY_IDS, plantRow, reapLocks, regDirOf, regListing } from './dashIdFixture.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** The binary under test. It is the checkout's own unless `DASH_PARITY_CCD` names a copy: spec §8's pre-wave run, or a
 *  mutation row's scratch copy. A path that names no file would make every row "refuse" (bash exits 127), so it fails
 *  the file at load. */
const CCD_UNDER_TEST = process.env.DASH_PARITY_CCD ?? CCD;
if (!fs.existsSync(CCD_UNDER_TEST)) throw new Error(`DASH_PARITY_CCD names no file: ${CCD_UNDER_TEST}`);

/** What `sweepDec` composes for an unattended lane: `reason: null`, so `decFlags` sends `--surface`/`--actor` only. */
const PROBE_DEC: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: null };
/** The same dec with a reason, so `decFlags` sends all three pairs. Never used for ws-add, whose loop has no `--reason`
 *  arm. */
const DEC_WITH_REASON: ActorFlags = { surface: 'agent', actor: 'probe:dec parity', reason: 'probe reason' };

/**
 * THE DERIVED SET. This is `ccdargv-dec-parity.test.ts`'s scan, copied rather than imported, because that file
 * exports nothing. Every `argv([…])` literal in the table is walked: its first quoted token is the verb, and a
 * `decFlags(` inside the literal declares that the verb takes a dec.
 */
function decAppendingVerbs(): string[] {
  const src = fs.readFileSync(path.join(srcRoot, 'ccdargv.ts'), 'utf8');
  const table = src.slice(src.indexOf('export const CCD_ARGV'));
  const found = new Set<string>();
  for (const m of table.matchAll(/argv\(\[([\s\S]*?)\]\)/g)) {
    const body = m[1]!;
    const verb = /^\s*'([a-z][a-z-]*)'/.exec(body)?.[1];
    if (verb !== undefined && body.includes('decFlags(')) found.add(verb);
  }
  return [...found].sort();
}

/** One verb's probe: the argvs its own builder composes for a probed id, what it needs planted beyond the decoy rows
 *  and the literal row, and how a decoy it must not touch is checked afterwards. */
interface DashProbe {
  argv: (id: string, dec: ActorFlags) => readonly (readonly string[])[];
  decoy: () => void;
  untouched: (id: string) => void;
}

/** A §2.2 verb that carries no dec: the argvs its builder composes with a dash-leading positional, and whether the
 *  verb must refuse it or, as plain ws-audit does, answers about the literal id. */
interface PositionalProbe {
  argv: (dash: string) => readonly (readonly string[])[];
  expect: 'refused' | 'literal';
}

const TOKEN = 'a'.repeat(64);
/** `wsCollect`'s token parameter type, named without importing L0 (this file reads `ccdargv.js` and nothing else from
 *  the shipped tree). */
type CollectTokenArg = Parameters<typeof CCD_ARGV.wsCollect>[0];
const DECOY_HOLD = 'program:decoy wave:1/1';
const JUNK_WITNESS = 'this is no witness\n';
/** The test roster's account the two-argument forms name. A dash project that a pre-wave stop takes as a pair
 *  composes `<wrapper>-<word>`, so the positional decoys include those ids too. */
const PAIR_WRAPPER = 'claude-a';
const POSITIONAL_DECOYS: readonly string[] = [...DECOY_IDS, ...DECOY_IDS.map((d) => `${PAIR_WRAPPER}-${d}`)];
/** Answers that only a verb which BOUND the id and looked it up as a row can give. §2.2 tells a redirect, a literal
 *  id and a refusal apart, so a refusal by lookup is not a refusal of the shape. hibernate's `session-busy` is one: it
 *  answers it only after it found the row and re-measured it. */
const LOOKUP_WORDS = /no such session|no-such-session|not a workspace|not-a-workspace|not-witnessed|not held|no registry|"refused":"held"|session-busy/;
/** A systemctl call that changes a unit. A read (`is-active`, `show`, `is-enabled`) does not match. */
const UNIT_CHANGE = /\b(?:enable|disable|start|stop|restart|try-restart|reset-failed|kill|mask)\b/;
/** A tmux call that kills, makes or types into a pane. `has-session` and `list-panes` reads do not match. */
const PANE_ACT = /\b(?:kill-session|new-session|send-keys|respawn-pane)\b/;

/** stop's two orders: the id first, as a server before path-identity W1a composes it, and `--surface` first, as W1a's
 *  builder composes it. */
const STOP_ID_FIRST = (id: string): readonly string[] => ['stop', id, '--surface', 'pwa'];
const STOP_ID_LAST = (id: string): readonly string[] => ['stop', '--surface', 'pwa', id];
const sameArgv = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);
/** The order `CCD_ARGV.stopId` does NOT compose, typed. It is the one justified exception to "composed, never
 *  typed": no builder in this tree composes it, and a server on the other side of W1a still can. */
const stopOtherOrder = (id: string): readonly string[] =>
  sameArgv(CCD_ARGV.stopId(id, 'pwa'), STOP_ID_FIRST(id)) ? STOP_ID_LAST(id) : STOP_ID_FIRST(id);

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-dash-parity-'); });
afterEach(() => { h.cleanup(); });

/** The binary under test, run as a program through its own dispatcher in the fixture HOME, under `bash -p` (the token
 *  verbs and their audits refuse any other entry). Both streams and the exit code are folded into one answer, because
 *  ccd refuses in two dialects: a `die` (stderr, exit 1), or a `{"refused":…}` document on stdout at exit 0. */
const runCcd = (args: readonly string[], extra: NodeJS.ProcessEnv = {}): { code: number; out: string } => {
  const stub = harnessBin(h.home);
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home,
      { ...inheritedEnv(), ...extra, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` },
      { systemd: true, tmux: true }),
  };
  let res: { code: number; out: string };
  try {
    const stdout = execFileSync('bash', ['-p', CCD_UNDER_TEST, ...args], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    res = { code: 0, out: String(stdout).trim() };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    res = { code: err.status ?? 1, out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`.trim() };
  }
  // 126 and 127 mean bash never ran ccd. Treated as answers, they would read as refusals and turn every row green.
  if (res.code === 126 || res.code === 127) throw new Error(`the ccd under test did not run (rc ${res.code}): ${res.out}`);
  return res;
};

/** The registry's rows and fields: `regListing` without its dot names. The lifecycle journal and the reap locks have
 *  their own assertions, and a dot-named helper lock is not a row. */
const rowFiles = (): string[] => regListing(h.home).filter((n) => !n.startsWith('.'));
const unitActs = (): string[] => h.systemctlCalls().filter((l) => l.includes('claude-session@') && UNIT_CHANGE.test(l));
const paneActs = (): string[] => h.tmuxCalls().filter((l) => PANE_ACT.test(l));

const plantSessionDecoys = (): void => {
  for (const d of DECOY_IDS) plantRow(h.home, d, { hold: DECOY_HOLD });
};
const holdsIntact = (): void => {
  for (const d of DECOY_IDS) {
    const p = path.join(regDirOf(h.home), `${d}.hold`);
    expect.soft(fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null, `${d}'s hold`).toBe(DECOY_HOLD);
  }
};
/** The positional decoys, plus a directory for the dash project. A start or enable that took the dash as a project
 *  then finds a workdir and reaches its act; a refusal never reads it. */
const plantPositionalDecoys = (dash: string): void => {
  for (const d of POSITIONAL_DECOYS) plantRow(h.home, d, { hold: DECOY_HOLD });
  fs.mkdirSync(path.join(h.home, 'projects', dash), { recursive: true });
};
/** ws-restore journals the id it refuses as `bad-session-id` (its `_lc_refuse` practice). That one line is allowed. */
const isRestoresOwnRefusal = (verb: string, id: string, e: Record<string, unknown>): boolean =>
  verb === 'ws-restore' && e['act'] === 'restore' && e['outcome'] === 'refused'
  && e['refusal'] === 'bad-session-id' && e['id'] === id;

const DASH_PROBES: Record<string, DashProbe> = {
  'ws-release': { argv: (id, d) => [CCD_ARGV.wsRelease(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-archive': { argv: (id, d) => [CCD_ARGV.wsArchive(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-restore': { argv: (id, d) => [CCD_ARGV.wsRestore(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-hold': { argv: (id, d) => [CCD_ARGV.wsHold(id, 'probe reason', d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-rename': { argv: (id, d) => [CCD_ARGV.wsRename(id, 'ws/probe', d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  'ws-reclaim': {
    argv: (id, d) => [CCD_ARGV.wsReclaim(TOKEN, 7, id, false, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact(),
  },
  'ws-expire': { argv: (id, d) => [CCD_ARGV.wsExpire(TOKEN, id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  // A junk witness at `tmproots/agent`: before W1b a redirect to `agent` made agent a member of the collector's
  // population, so the verb opened `.reap-agent.lock` (spec §2.2).
  'ws-collect': {
    argv: (id, d) => [CCD_ARGV.wsCollect(TOKEN as CollectTokenArg, id, d)],
    decoy: () => {
      plantSessionDecoys();
      fs.mkdirSync(path.join(regDirOf(h.home), 'tmproots'), { recursive: true });
      fs.writeFileSync(path.join(regDirOf(h.home), 'tmproots', 'agent'), JUNK_WITNESS);
    },
    untouched: () => {
      holdsIntact();
      expect.soft(fs.readFileSync(path.join(regDirOf(h.home), 'tmproots', 'agent'), 'utf8'), 'the decoy witness')
        .toBe(JUNK_WITNESS);
    },
  },
  // ws-add's id is its PROJECT. A project of `--actor` used to become project `agent` (spec §2.2), so the decoy is a
  // real repo named `agent`, and a redirect would create a workspace in it.
  'ws-add': {
    argv: (id, d) => [CCD_ARGV.wsAddWorker(id, d)],
    decoy: () => { plantSessionDecoys(); h.makeRepo('agent'); },
    untouched: (id) => {
      holdsIntact();
      for (const p of ['agent', id]) {
        expect.soft(fs.existsSync(path.join(h.home, 'worktrees', p)), `a worktree under worktrees/${p}`).toBe(false);
      }
    },
  },
  // hibernate's id is POSITIONAL and composed first (`hibernate <id> --surface … --actor …`), and its loop strips the dec
  // pairs before the arity rule. So an id of `--actor` used to take `--surface` as its value and leave the surface word
  // as the id. The held decoy makes that redirect answer `session-busy`, which LOOKUP_WORDS names.
  hibernate: { argv: (id, d) => [CCD_ARGV.hibernate(id, d)], decoy: plantSessionDecoys, untouched: () => holdsIntact() },
  stop: {
    argv: (id) => [CCD_ARGV.stopId(id, 'pwa'), stopOtherOrder(id)],
    decoy: plantSessionDecoys,
    untouched: () => holdsIntact(),
  },
};

const POSITIONAL_PROBES: Record<string, PositionalProbe> = {
  stopPair: { argv: (x) => [CCD_ARGV.stopPair(x, 'demo', 'pwa'), CCD_ARGV.stopPair(PAIR_WRAPPER, x, 'pwa')], expect: 'refused' },
  forget: { argv: (x) => [CCD_ARGV.forget(x)], expect: 'refused' },
  swap: { argv: (x) => [CCD_ARGV.swap(x, 'claude-b')], expect: 'refused' },
  swapCross: { argv: (x) => [CCD_ARGV.swapCross(x, 'claude-b')], expect: 'refused' },
  start: { argv: (x) => [CCD_ARGV.start(x, 'demo'), CCD_ARGV.start(PAIR_WRAPPER, x)], expect: 'refused' },
  enable: { argv: (x) => [CCD_ARGV.enable(x, 'demo'), CCD_ARGV.enable(PAIR_WRAPPER, x)], expect: 'refused' },
  // Plain ws-audit binds `$2` positionally and has no decision-flag loop. It audits the literal id and acts on
  // nothing: the stated residual `verbs-outside-sec1-keep-the-inline-regex`.
  wsAudit: { argv: (x) => [CCD_ARGV.wsAudit(x)], expect: 'literal' },
  wsReclaimAudit: { argv: (x) => [CCD_ARGV.wsReclaimAudit(x, false)], expect: 'refused' },
  wsExpireAudit: { argv: (x) => [CCD_ARGV.wsExpireAudit(x)], expect: 'refused' },
  wsCollectAudit: { argv: (x) => [CCD_ARGV.wsCollectAudit(x)], expect: 'refused' },
};

interface DecRow { readonly label: string; readonly dec: ActorFlags }
const DECS: readonly DecRow[] = [
  { label: 'without a reason', dec: PROBE_DEC },
  { label: 'with a reason', dec: DEC_WITH_REASON },
];
/** ws-add runs without a reason only, because its loop has no `--reason` arm. stop composes no dec, only
 *  `--surface pwa`, so it runs once per id and argv. */
const decsFor = (verb: string): readonly DecRow[] =>
  verb === 'ws-add' ? [DECS[0]!]
    : verb === 'stop' ? [{ label: 'none (stop sends --surface pwa only)', dec: PROBE_DEC }]
      : DECS;

describe('no dash-leading id redirects a verb the server composes, on the real binary (path-identity spec §2.8)', () => {
  it('every dec-appending verb has a dash probe, and stop has two orders', () => {
    expect(decAppendingVerbs())
      .toEqual(['hibernate', 'ws-add', 'ws-archive', 'ws-collect', 'ws-expire', 'ws-hold', 'ws-reclaim', 'ws-release', 'ws-rename',
        'ws-restore']);
    expect(decAppendingVerbs().filter((v) => !(v in DASH_PROBES)), 'a dec-appending verb has no dash probe').toEqual([]);
    expect(Object.keys(DASH_PROBES).sort()).toEqual([...decAppendingVerbs(), 'stop'].sort());
    for (const v of decAppendingVerbs()) expect(DASH_PROBES[v]!.argv('probe-id', PROBE_DEC), v).toHaveLength(1);
    // BOTH orders, exactly: the builder's own, and the other one typed. If the builder composed a third shape, this
    // set would differ.
    expect(DASH_PROBES['stop']!.argv('probe-id', PROBE_DEC).map((a) => a.join(' ')).sort())
      .toEqual([STOP_ID_FIRST('probe-id'), STOP_ID_LAST('probe-id')].map((a) => a.join(' ')).sort());
  });

  for (const verb of [...decAppendingVerbs(), 'stop']) {
    const probe = DASH_PROBES[verb];
    if (probe === undefined) continue;   // the anti-whitelist case above is red instead
    for (const id of DASH_IDS) {
      for (const { label, dec } of decsFor(verb)) {
        const n = probe.argv(id, dec).length;
        for (let k = 0; k < n; k++) {
          it(`${verb} refuses id ${id} under dec ${label}${n > 1 ? ` (argv ${k + 1} of ${n})` : ''}`, () => {
            // The literal row: a verb that binds the id AS GIVEN finds it and acts on it, so binding the literal
            // id is visible as an act, not only as a "no such session".
            plantRow(h.home, id);
            probe.decoy();
            const before = rowFiles();
            const r = runCcd(probe.argv(id, dec)[k]!);
            expect.soft(r.code !== 0 || r.out.includes('"refused"'), `answered as an act: rc ${r.code}: ${r.out}`).toBe(true);
            expect.soft(r.out, 'looked the id up as a row: the literal id was bound').not.toMatch(LOOKUP_WORDS);
            expect.soft(reapLocks(h.home), 'a refusal created a permanent reap lock').toEqual([]);
            const named = new Set<string>([...DECOY_IDS, id]);
            expect.soft(
              readJournal(h.home).filter((e) => named.has(String(e['id'])) && !isRestoresOwnRefusal(verb, id, e)),
              'a journal line names a decoy or the probed id',
            ).toEqual([]);
            expect.soft(unitActs(), 'a unit was changed').toEqual([]);
            expect.soft(paneActs(), 'a pane was killed or made').toEqual([]);
            expect.soft(rowFiles(), 'a registry row or field changed').toEqual(before);
            probe.untouched(id);
          });
        }
      }
    }
  }

  it('every §2.2 verb without a dec has a positional probe', () => {
    expect(Object.keys(POSITIONAL_PROBES).sort()).toEqual([
      'enable', 'forget', 'start', 'stopPair', 'swap', 'swapCross', 'wsAudit', 'wsCollectAudit', 'wsExpireAudit', 'wsReclaimAudit',
    ]);
    for (const k of Object.keys(POSITIONAL_PROBES)) expect(Object.keys(CCD_ARGV), `${k} is not a CCD_ARGV builder`).toContain(k);
    expect(Object.entries(POSITIONAL_PROBES).filter(([, p]) => p.expect === 'literal').map(([k]) => k)).toEqual(['wsAudit']);
  });

  for (const [name, probe] of Object.entries(POSITIONAL_PROBES)) {
    for (const dash of DASH_IDS) {
      const n = probe.argv(dash).length;
      for (let k = 0; k < n; k++) {
        it(`${name} given a dash-leading positional ${dash} acts on no decoy${n > 1 ? ` (argv ${k + 1} of ${n})` : ''}`, () => {
          plantPositionalDecoys(dash);
          const before = rowFiles();
          const r = runCcd(probe.argv(dash)[k]!);
          if (probe.expect === 'refused') {
            expect.soft(r.code !== 0 || r.out.includes('"refused"'), `answered as an act: rc ${r.code}: ${r.out}`).toBe(true);
          } else {
            expect.soft(r.out, 'plain ws-audit audits the literal id it was given').toContain(`"id":${JSON.stringify(dash)}`);
          }
          expect.soft(reapLocks(h.home), 'a reap lock was created').toEqual([]);
          expect.soft(readJournal(h.home).filter((e) => POSITIONAL_DECOYS.includes(String(e['id']))),
            'a journal line names a decoy').toEqual([]);
          expect.soft(unitActs(), 'a unit was changed').toEqual([]);
          expect.soft(paneActs(), 'a pane was killed or made').toEqual([]);
          expect.soft(rowFiles(), 'a registry row or field changed').toEqual(before);
        });
      }
    }
  }

  it('a dec whose actor or reason begins with "-" still reaches the journal', () => {
    // THE CONTROL (Review Focus 2): at the verbs W1b built, the fix narrows the id, never the prose. hibernate is the
    // one exception, ruled on 2026-10-19 (`hibernate-refuses-a-dash-leading-id`), and the cases below pin it. The dec
    // reaches ws-release through its builder, and the declared pairs land in the `release` row byte for byte.
    const id = 'demo-quiet-basin';
    plantRow(h.home, id, { hold: DECOY_HOLD });
    const r = runCcd(CCD_ARGV.wsRelease(id, { surface: 'agent', actor: '-device', reason: '--tidy' }));
    expect(r).toEqual({ code: 0, out: `released ${id}` });
    const released = eventsOf(h.home, 'release');
    expect(released, 'ws-release wrote no release line').toHaveLength(1);
    expect(released[0]!['id']).toBe(id);
    expect(decOf(released[0]!)).toEqual({ surface: 'agent', actor: '-device', reason: '--tidy' });
    expect(fs.existsSync(path.join(regDirOf(h.home), `${id}.hold`))).toBe(false);
  });

  // ONE PROSE CASE PER DEC-APPENDING VERB (review 641 F3; the operator's ruling of 2026-10-19). Each verb runs its own
  // builder twice, each time in a fresh fixture HOME: once with a dec in plain words, once with the same dec led by a
  // dash. A verb that keeps the prose answers both alike, wherever its answer lands, and journals the dash-led pairs
  // as given. hibernate is the recorded exception (`hibernate-refuses-a-dash-leading-id`): its id comes first in the
  // server's argv, so its loop refuses a dash-leading value with its usage line, where the plain dec reaches the row.
  const PROSE_ID = 'demo-quiet-basin';
  const PLAIN_WORDS = { actor: 'probe:prose', reason: 'probe reason' } as const;
  const DASH_WORDS = { actor: '-device', reason: '--tidy' } as const;
  /** ws-add's loop has no `--reason` arm. */
  const proseDec = (verb: string, dash: boolean): ActorFlags => {
    const w = dash ? DASH_WORDS : PLAIN_WORDS;
    return { surface: 'agent', actor: w.actor, reason: verb === 'ws-add' ? null : w.reason };
  };
  /** The verb's own builder. ws-hold's builder drops the dec's reason and sends the hold reason as its `--reason`, so
   *  there the prose under test is the hold reason. */
  const proseArgv = (verb: string, id: string, dec: ActorFlags): readonly string[] =>
    (verb === 'ws-hold' ? CCD_ARGV.wsHold(id, dec.reason!, dec) : DASH_PROBES[verb]!.argv(id, dec)[0]!);
  /** One run in the current fixture HOME, on a workspace row (ws-add: on a repo, its project): the answer with the
   *  HOME's path folded, the journal without its clock, and the registry's rows. Only the verbs whose act a hold
   *  gates, or whose plain answer needs one to land (ws-release), get the decoy hold. */
  const proseRun = (verb: string, dash: boolean) => {
    const id = verb === 'ws-add' ? 'demo' : PROSE_ID;
    if (verb === 'ws-add') h.makeRepo(id);
    else {
      const workdir = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
      fs.mkdirSync(workdir, { recursive: true });
      plantRow(h.home, id, {
        project: 'demo', workspace: 'quiet-basin', workdir, branch: 'ws/quiet-basin', wrapper: 'claude',
        ...(verb === 'ws-release' || verb === 'hibernate' ? { hold: DECOY_HOLD } : {}),
      });
    }
    const r = runCcd(proseArgv(verb, id, proseDec(verb, dash)), { CCD_WS_SLUG: 'quiet-basin' });
    const journal = readJournal(h.home).map((e) => ({
      act: e['act'], id: e['id'], outcome: e['outcome'], refusal: e['refusal'], dec: e['dec'] === undefined ? null : decOf(e),
    }));
    return { code: r.code, out: r.out.split(h.home).join('<home>'), journal, rows: rowFiles() };
  };
  const decWords = (d: ActorFlags): Record<string, string> =>
    ({ surface: d.surface, actor: d.actor, ...(d.reason === null ? {} : { reason: d.reason }) });
  const sameDec = (a: unknown, b: unknown): boolean =>
    JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

  for (const verb of decAppendingVerbs()) {
    it(`${verb}: a dec whose prose begins with "-" ${
      verb === 'hibernate' ? 'is refused on the usage line, where the plain dec reaches the row' : 'gets the plain dec\'s answer'}`, () => {
      expect(DASH_PROBES[verb], `${verb} has no probe`).toBeDefined();
      const plain = proseRun(verb, false);
      h.cleanup();
      h = makeCcdHarness('ccrc-dash-parity-');
      const dashed = proseRun(verb, true);
      expect(plain.out, 'the plain dec was refused on the usage line').not.toMatch(/usage: ccd /);
      if (verb === 'hibernate') {
        expect(dashed.code).toBe(1);
        expect(dashed.out).toBe('ccd: usage: ccd hibernate [--surface <word>] [--actor <text>] [--reason <text>] <id>');
        expect(dashed.journal, 'a refused prose value journals nothing').toEqual([]);
        expect(dashed.rows, 'a refused prose value changes no row').not.toContain(`${PROSE_ID}.hibernated`);
        // The plain dec found the row and re-measured it: the hold refuses it there, not at the parse.
        expect(plain.out).toMatch(/session-busy: held/);
        return;
      }
      // An answer that echoes the prose (ws-hold's `held <id>: <reason>`) echoes the dash-led words; folded back, the
      // answers are equal.
      const folded = dashed.out.split(DASH_WORDS.reason).join(PLAIN_WORDS.reason).split(DASH_WORDS.actor).join(PLAIN_WORDS.actor);
      expect({ code: dashed.code, out: folded, rows: dashed.rows }, 'the dash-led dec changed the answer')
        .toEqual({ code: plain.code, out: plain.out, rows: plain.rows });
      // The journal is the plain run's, line for line, with each line that carried the plain pairs carrying the
      // dash-led ones instead. A line the verb writes with pairs of its own (`surface: none`) stays as it was.
      const expected = plain.journal.map((e) =>
        (sameDec(e.dec, decWords(proseDec(verb, false))) ? { ...e, dec: decWords(proseDec(verb, true)) } : e));
      expect(dashed.journal, 'the dash-led dec changed the journal').toEqual(expected);
    });
  }
});
