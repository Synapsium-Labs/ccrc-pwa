// history-maint.test.ts — W1-B2: the operator door and the --op pass's dispatch tables (Task 19). prune (Task 20),
// reparse (21), doctor --backup (22), doctor --repair (23) and every writing form's two doors (30) append here.
// Spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.4 "Operator verbs" and "Speed
// bumps", §8.3's no-store table, §5.1. Pins O54 (relay half), C42 (CLI half), C63, and RB6's measurement in both
// halves for the forms this task runs (Task 25 pins every form).
//
// Operator verbs are BOX verbs: no pane, no identity. The CLI runs as an operator runs it, a child on
// process.execPath with the statfs preload. The shim it spawns is the fixture HOME's own copy, which execs the REAL
// sweep.mjs through the ~/ccrc link, or a stand-in (stubShim) that records its argv: a case that must spawn nothing
// reads that record as absent. No case here has a TTY; the TTY rows are Task 30's.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { beltWidth } from '../../ccd/history/lib.mjs';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { userRow } from './historyFixtures.js';
import {
  makeHistoryBox, runSweep, runShim, runCli, plantSession, plantTranscript, openStoreRO, stubShim, holdLock,
  PASS_DRIVER, SHIM, type HistoryBox,
} from './historyHelpers.js';

// Each spawning case gets this budget (the sweep and the CLI spawn on a heavily loaded box); longer is 1.5 * HEAVY or 2.5 * HEAVY, never a new literal.
const HEAVY = 120_000;

const ID = 'claude-a-maint';
const G1 = '0189abcd-1234-4678-9abc-00000000a019';
const U1 = '19000001-0000-4000-8000-000000000001';
const SLUG = '-home-u-tree-maint';
const V2 = 'CREATE TABLE seam_v2 (x INTEGER)';
const TS = new Date(Date.UTC(2026, 9, 4, 10, 0, 0)).toISOString();

interface Run { code: number | null; stdout: string; stderr: string; json: Record<string, unknown> | null }
const op = (box: HistoryBox, args: string[], env: Record<string, string> = {}): Run => runCli(box, args, { env });
function boundBox(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  return box;
}
/** What the stand-in shim was asked, one argv per run; null when it never ran. */
const stubArgv = (box: HistoryBox): string[] | null => {
  const p = path.join(box.home, 'stub-shim-argv');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n') : null;
};
const dbFile = (box: HistoryBox): string => path.join(box.root, 'db', 'history.db');
const storeIdOf = (box: HistoryBox): string => fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim();
const sha = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const versionOf = (p: string): number => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { db.close(); }
};
const snapshotsIn = (box: HistoryBox): string[] => {
  try { return fs.readdirSync(path.join(box.root, 'db', 'backups')).filter((n) => n.startsWith('pre-v')); } catch { return []; }
};
/** The --op pass's one JSON result, its LAST stdout line. */
const lastResult = (stdout: string): Record<string, unknown> => {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{"rc"'));
  expect(lines.length, `no {"rc":…} line in:\n${stdout}`).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
};
/** Every entry under ~/.ccrc with each file's size and mtime: "writes nothing", measured. The lock and SQLite's
 *  WAL sidecars are excluded (a read-only open may create the sidecars, §8.1). */
function snapshot(box: HistoryBox): string[] {
  const root = path.join(box.home, '.ccrc');
  const out: string[] = [];
  const visit = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'history-sweep.lock' || /-(wal|shm)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out.push(`${path.relative(root, p)}/`); visit(p); continue; }
      const st = fs.lstatSync(p);
      out.push(`${path.relative(root, p)} ${st.size} ${Math.trunc(st.mtimeMs)}`);
    }
  };
  visit(root);
  return out.sort();
}
/** The real shim, exec'ing B1's run-pass driver in place of sweep.mjs: the driver's HISTORY_TEST_DEPS (its only
 *  seam) can then stage a v2 migration behind the CLI's own door, lock and roster included. */
function driverShim(box: HistoryBox): void {
  const text = fs.readFileSync(SHIM, 'utf8');
  const from = '"$HOME/ccrc/ccd/history/sweep.mjs"';
  expect(text, 'CONTROL: the shim execs sweep.mjs through the ~/ccrc link').toContain(from);
  const p = path.join(box.home, '.local', 'bin', 'ccd-history-sweep');
  fs.writeFileSync(p, text.replace(from, JSON.stringify(PASS_DRIVER)));
  fs.chmodSync(p, 0o755);
}
const PENDING = { HISTORY_TEST_DEPS: JSON.stringify({ extraMigrations: [V2] }) };

describe.skipIf(process.platform === 'darwin')('O54 (relay half): the CLI and the shim agree (Task 19)', () => {
  it('a refusal decided under the lock reaches the operator: {"rc":2,"reason":"adopt-refused"} is exit 2 with that reason', () => {
    const box = boundBox('ccrc-hist-o54a-');
    stubShim(box, { stdout: '{"rc":2,"reason":"adopt-refused"}\n', exit: 2 });
    const r = op(box, ['doctor', '--backup', '--json']);
    expect(r.code).toBe(2);
    expect(r.json).toMatchObject({ exit: 2, reason: 'adopt-refused', coverage: 'this-box' });
    expect(r.json?.['store_id']).toBe(storeIdOf(box));
    expect(stubArgv(box), 'the CLI ran the shim with the --op form, and nothing else').toEqual(['--op backup']);
  }, HEAVY);

  it('75 from the shim (its lock held) is exit 4 writer-busy, in both forms', () => {
    const box = boundBox('ccrc-hist-o54b-');
    stubShim(box, { stdout: '', exit: 75 });
    const j = op(box, ['doctor', '--backup', '--json']);
    expect([j.code, j.json?.['reason']]).toEqual([4, 'writer-busy']);
    const h = op(box, ['doctor', '--backup']);
    expect(h.code).toBe(4);
    expect(h.stderr).toMatch(/^ccrc history doctor: writer-busy: /m);
  }, HEAVY);

  it('the real shim with its lock held: exit 4, and nothing written', () => {
    const box = boundBox('ccrc-hist-o54c-');
    const before = snapshot(box);
    const release = holdLock(box);
    try {
      const r = op(box, ['import', '--apply', '--json']);
      expect([r.code, r.json?.['reason']]).toEqual([4, 'writer-busy']);
    } finally { release(); }
    expect(snapshot(box)).toEqual(before);
  }, HEAVY);

  it('a result the relay cannot trust is exit 1: a reason off its exit, no result, a result the exit contradicts, no JSON', () => {
    const box = boundBox('ccrc-hist-o54d-');
    for (const [stdout, exit] of [['{"rc":2,"reason":"store-missing"}\n', 2], ['', 0], ['{"rc":5,"reason":"store-missing"}\n', 0], ['not json\n', 0]] as const) {
      stubShim(box, { stdout, exit });
      const r = op(box, ['doctor', '--backup', '--json']);
      expect([r.code, r.json?.['exit']], JSON.stringify(stdout)).toEqual([1, 1]);
    }
  }, HEAVY);

  it('the sweep\'s lines before its result are relayed in order and the result line is not; under --json they go to stderr', () => {
    const box = boundBox('ccrc-hist-o54e-');
    stubShim(box, { stdout: 'line one\nline two\n{"rc":0}\n', exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout).toBe('line one\nline two\n');
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(j.code).toBe(0);
    expect(j.stdout.trim().split('\n'), 'stdout is the envelope alone').toHaveLength(1);
    expect(j.json).toMatchObject({ exit: 0, coverage: 'this-box' });
    expect(j.stderr).toContain('line one\nline two\n');
  }, HEAVY);

  it('every non-zero line an operator verb prints names the operator, whatever stopped it (R-X-OPERATOR)', () => {
    const box = boundBox('ccrc-hist-o54op-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const runs: Array<[string, Run]> = [
      ['apply-in-session', op(box, ['import', '--apply'], { CLAUDECODE: '1' })],
      ['needs-tty', op(box, ['doctor', '--adopt'])],
      ['bad-args', op(box, ['import', '--bogus'])],
    ];
    const box2 = boundBox('ccrc-hist-o54op2-');
    stubShim(box2, { stdout: '', exit: 75 });
    runs.push(['writer-busy', op(box2, ['doctor', '--backup'])]);
    stubShim(box2, { stdout: 'not json\n', exit: 0 });
    runs.push(['internal', op(box2, ['doctor', '--backup'])]);
    stubShim(box2, { stdout: '{"rc":5,"reason":"store-unreachable"}\n', exit: 5 });
    runs.push(['store error', op(box2, ['doctor', '--backup'])]);
    const srv = makeHistoryBox('ccrc-hist-o54op-srv-', { role: 'server', shim: true });
    runs.push(['no-store', op(srv, ['doctor', '--backup'])]);
    const lineOf = (r: Run): string[] => r.stderr.split('\n').filter((l) => /^ccrc history \S+: /.test(l));
    expect(lineOf(runs[0]![1])[0], 'CONTROL: the case reads the refusal line itself').toContain('refused: apply-in-session');
    for (const [name, run] of runs) {
      expect(run.code, name).not.toBe(0);
      const lines = lineOf(run);
      expect(lines, `${name}: one line`).toHaveLength(1);
      expect(lines[0], `${name} names the operator`).toMatch(/; .*\bthe operator\b/);
    }
  }, HEAVY);

  it('a result line with no trailing newline is still the result: exit 0, and the line before it is relayed', () => {
    const box = boundBox('ccrc-hist-o54nn-');
    stubShim(box, { stdout: 'progress\n{"rc":0}', exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout).toBe('progress\n');
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(j.json?.['exit']).toBe(0);
  }, HEAVY);

  it('--json before the doctor flag is the same form: the shim is asked --op migrate', () => {
    const box = boundBox('ccrc-hist-o54jf-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const r = op(box, ['doctor', '--json', '--migrate']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(stubArgv(box)).toEqual(['--op migrate']);
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('the relay redaction: every line the relay passes on goes through redactFinal with the read verbs\' index, belt included (Task 19; spec §8.3 layers 1 and 4)', () => {
  it('a declared secretsFile value and a stray-CSI split of a frozen value come out redacted, human and --json', () => {
    const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const alnum = (n: number): string => Array.from(randomBytes(n), (b) => AL[b % AL.length]!).join('');
    const ESC = String.fromCharCode(27);
    /** A frozen-list value of review 351's shape (C69's V): `Q`, a CSI final byte (`P`), 29 letters and digits, a digit. */
    const V = `QP${alnum(29)}7`;
    /** A declared secretsFile's key (C69's G): only the shim names its file, so the CLI reads it through meta redact_sources
     *  and finds its pair in redact_hashes. No shape matches it (C49's shape), so only those layers mask it. */
    const G = `${alnum(39)}7`;
    /** Each beltWidth(s) stretch of the value `s` found in `text`, case folded (C69's measure: §8.3 layer 4's promise). */
    const leaks = (text: string, s: string): string[] => {
      const w = beltWidth(s);
      const low = text.toLowerCase();
      const out: string[] = [];
      for (let k = 0; k + w <= s.length; k += 1) if (low.includes(s.slice(k, k + w).toLowerCase())) out.push(s.slice(k, k + w));
      return out;
    };
    const roster = structuredClone(DEFAULT_TEST_ROSTER) as { version: number; accounts: Record<string, unknown>[] };
    roster.accounts.find((a) => a['id'] === 'gpt')!['exec'] = { kind: 'external', secretsFile: '.config/x19-gw/gw.env' };
    const box = makeHistoryBox('ccrc-hist-relay-red-', { role: 'fleet', shim: true, roster });
    const secret = (rel: string, body: string): void => {
      const p = path.join(box.home, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      fs.writeFileSync(p, body, { mode: 0o600 });
    };
    secret('.cc-secrets/x19relay.env', `ZQ_X19_V=${V}\n`);
    secret('.config/x19-gw/gw.env', `GW_X19_KEY=${G}\n`);
    // The real shim's pass creates the store, records both values' pairs and the declared file's path (meta
    // redact_sources, Task 7B): the shim reads the roster's secretsFile from accounts.sh and passes it to the sweep.
    const bound = runShim(box);
    expect(bound.code, bound.stderr).toBe(0);
    // The stand-in then prints both shapes on lines the relay passes on: G whole, and V behind a stray CSI that took its
    // second character, so the 31 characters after it are one run that no pair matches and only the belt masks.
    stubShim(box, { stdout: `zqx19 gateway ${G} end\nzqx19 csi w ${V[0]}${ESC}[0m${ESC}[${V.slice(1)} y\n{"rc":0}\n`, exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    expect(h.code, h.stderr).toBe(0);
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(j.code, j.stderr).toBe(0);
    expect(stubArgv(box), 'CONTROL: both runs reached the stand-in').toEqual(['--op backup', '--op backup']);
    expect(h.stdout, 'CONTROL: the lines are relayed to stdout').toContain('zqx19 gateway');
    expect(h.stdout, 'CONTROL: both of them').toContain('zqx19 csi w');
    expect(j.stderr, 'CONTROL: under --json, to stderr').toContain('zqx19 gateway');
    // One assertion per stream over both values, so a red names every leak at once: G (the declared secretsFile's value)
    // and V (the stray-CSI split of a frozen value).
    for (const [where, text] of [['human stdout', h.stdout], ['--json stderr', j.stderr]] as const) {
      expect({ G: leaks(text, G), V: leaks(text, V) }, `${where}: no belt-width stretch of either value`).toEqual({ G: [], V: [] });
    }
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('the no-store table and the speed bumps: decided by the CLI before any spawn (Task 19)', () => {
  it('a server role, and a box that never installed, answer 9; a store with no shim answers 2 writer-absent', () => {
    const server = makeHistoryBox('ccrc-hist-door-srv-', { role: 'server', shim: true });
    stubShim(server, { stdout: '{"rc":0}\n', exit: 0 });
    expect(op(server, ['doctor', '--backup', '--json']).code).toBe(9);
    expect(stubArgv(server), 'never spawned').toBeNull();
    const never = makeHistoryBox('ccrc-hist-door-none-', { role: 'fleet', shim: false });
    const n = op(never, ['import', '--json']);
    expect([n.code, n.json?.['reason']]).toEqual([9, undefined]);
    const absent = boundBox('ccrc-hist-door-abs-');
    fs.rmSync(path.join(absent.home, '.local', 'bin', 'ccd-history-sweep'));
    const a = op(absent, ['import', '--apply', '--json']);
    expect([a.code, a.json?.['reason']]).toEqual([2, 'writer-absent']);
  }, HEAVY);

  it('arguments are refused by lib\'s one grammar before any spawn, each with its word', () => {
    const box = boundBox('ccrc-hist-door-args-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const cases: Array<[string[], string]> = [
      [['prune', '--older-than', '7d'], 'older-than-floor'],
      [['doctor', '--restore', 'a/b.db'], 'restore-refused'],
      [['doctor', '--repair', '--backup'], 'bad-args'],
      [['doctor', '--bogus'], 'bad-args'],
      [['import', '--session', '../x', '--file', `/home/u/x/${U1}.jsonl`], 'bad-id'],
      [['import', '--bogus'], 'bad-args'],
    ];
    for (const [args, reason] of cases) {
      const r = op(box, [...args, '--json']);
      expect([r.code, r.json?.['reason']], args.join(' ')).toEqual([2, reason]);
    }
    expect(stubArgv(box), 'no refused form reached the shim').toBeNull();
  }, HEAVY);

  it('the speed bumps: CLAUDECODE refuses a writing form, history-off refuses a non-binding one, an irreversible one needs a TTY; a dry run passes', () => {
    const box = boundBox('ccrc-hist-door-gate-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const cc = op(box, ['doctor', '--backup', '--json'], { CLAUDECODE: '1' });
    expect([cc.code, cc.json?.['reason']]).toEqual([2, 'apply-in-session']);
    expect(op(box, ['doctor', '--adopt', '--json']).json?.['reason'], 'adopt is irreversible: no TTY here').toBe('needs-tty');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    try {
      const off = op(box, ['doctor', '--migrate', '--json']);
      expect([off.code, off.json?.['reason']]).toEqual([2, 'history-off']);
    } finally { fs.rmSync(path.join(box.home, '.ccrc', 'history-off')); }
    expect(stubArgv(box), 'no refused form reached the shim').toBeNull();
    const dry = op(box, ['import'], { CLAUDECODE: '1' });
    expect(dry.code, 'a dry run is no writing form: it passes CLAUDECODE').toBe(0);
    expect(stubArgv(box)).toEqual(['--op import']);
  }, HEAVY);

  it('bare doctor prints the status health lines and spawns nothing; with --json it is the status envelope', () => {
    const box = boundBox('ccrc-hist-door-doc-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const h = op(box, ['doctor']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout).toMatch(/^health: (PASS|WARN|FAIL) /m);
    const j = op(box, ['doctor', '--json']);
    expect(j.json?.['health']).toBeDefined();
    expect(j.json?.['store_id']).toBe(storeIdOf(box));
    expect(stubArgv(box)).toBeNull();
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('C42 (CLI half): import maps from evidence only (Task 19)', () => {
  it('the dry run lists every mapped and unmapped file and writes nothing; --apply ingests the mapped only', () => {
    const box = boundBox('ccrc-hist-c42cli-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'maint' });
    const mapped = plantTranscript(box, 'claude-a', SLUG, U1, [userRow({ uuid: '19000001-0000-4000-8000-0000000000a1', ts: TS, sessionId: U1, text: 'mapped words' })]);
    const unmapped: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      const u = `19000003-0000-4000-8000-${String(i).padStart(12, '0')}`;
      unmapped.push(plantTranscript(box, 'claude-b', SLUG, u, [userRow({ uuid: `19000004-0000-4000-8000-${String(i).padStart(12, '0')}`, ts: TS, sessionId: u, text: 'no evidence names me' })]));
    }
    const before = snapshot(box);
    const dry = op(box, ['import']);
    expect(dry.code, dry.stderr).toBe(0);
    const lines = dry.stdout.split('\n').filter(Boolean);
    expect(lines).toContain(`mapped ${ID} ${G1} ${mapped}`);
    expect(lines.filter((l) => l.startsWith('unmapped ')).sort()).toEqual(unmapped.map((p) => `unmapped ${p}`).sort());
    expect(lines.some((l) => l.startsWith('{"rc"')), 'the result line is the relay\'s, never printed').toBe(false);
    expect(snapshot(box), 'a dry run writes nothing').toEqual(before);
    const apply = op(box, ['import', '--apply', '--json']);
    expect(apply.code, apply.stderr).toBe(0);
    expect(apply.json).toMatchObject({ exit: 0, coverage: 'this-box' });
    expect(apply.stderr, 'under --json the sweep\'s listing goes to stderr').toContain('unmapped ');
    const db = openStoreRO(box);
    try {
      const uuids = (db.prepare('SELECT cc_session_uuid FROM transcripts').all() as { cc_session_uuid: string }[]).map((r) => r.cc_session_uuid);
      expect(uuids).toContain(U1);
      expect(uuids.filter((u) => u.startsWith('19000003')), 'an unmapped file is never ingested').toEqual([]);
    } finally { db.close(); }
  }, 1.5 * HEAVY);
});

describe.skipIf(process.platform === 'darwin')('C63: doctor --migrate through the door (Task 19)', () => {
  it('none: exit 0 and no snapshot, with no TTY', () => {
    const box = boundBox('ccrc-hist-c63a-');
    const r = op(box, ['doctor', '--migrate', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(snapshotsIn(box)).toEqual([]);
  }, HEAVY);

  it('refuse-newer: exit 2 migrate-refused, and the store is untouched', () => {
    const box = boundBox('ccrc-hist-c63b-');
    const w = new DatabaseSync(dbFile(box));
    try { w.exec('PRAGMA user_version = 2'); w.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { w.close(); }
    const before = sha(dbFile(box));
    const r = op(box, ['doctor', '--migrate', '--json']);
    expect([r.code, r.json?.['reason']]).toEqual([2, 'migrate-refused']);
    expect(sha(dbFile(box))).toBe(before);
    expect(versionOf(dbFile(box))).toBe(2);
    expect(snapshotsIn(box)).toEqual([]);
  }, HEAVY);

  it('refuse-low-disk: a pending migration with no room is exit 2 migrate-refused and writes no snapshot; with room it snapshots and migrates', () => {
    const box = boundBox('ccrc-hist-c63c-');
    driverShim(box);
    const r = op(box, ['doctor', '--migrate', '--json'], { ...PENDING, HISTORY_TEST_STATFS: `4096:${10 * 1024 ** 3}` });
    expect([r.code, r.json?.['reason']]).toEqual([2, 'migrate-refused']);
    expect(versionOf(dbFile(box))).toBe(1);
    expect(snapshotsIn(box)).toEqual([]);
    const ok = op(box, ['doctor', '--migrate', '--json'], PENDING);
    expect(ok.code, ok.stderr).toBe(0);
    expect(snapshotsIn(box)).toEqual(['pre-v2.db']);
    expect(versionOf(dbFile(box))).toBe(2);
  }, 1.5 * HEAVY);

  it('under CLAUDECODE: apply-in-session; under history-off: history-off; neither spawns the shim', () => {
    const box = boundBox('ccrc-hist-c63d-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    expect(op(box, ['doctor', '--migrate', '--json'], { CLAUDECODE: '1' }).json?.['reason']).toBe('apply-in-session');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    expect(op(box, ['doctor', '--migrate', '--json']).json?.['reason']).toBe('history-off');
    expect(stubArgv(box)).toBeNull();
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('the --op pass\'s tables, through the direct door (Task 19)', () => {
  it('a verb\'s arguments are lib\'s one grammar; a verb this build does not run is bad-args', () => {
    const box = boundBox('ccrc-hist-optab-');
    expect(lastResult(runSweep(box, ['--op', 'migrate', 'extra']).stdout)).toEqual({ rc: 2, reason: 'bad-args' });
    expect(lastResult(runSweep(box, ['--op', 'import', '--session', '../x', '--file', `/home/u/x/${U1}.jsonl`, '--apply']).stdout))
      .toEqual({ rc: 2, reason: 'bad-id' });
    expect(lastResult(runSweep(box, ['--op', 'adopt']).stdout)).toEqual({ rc: 2, reason: 'bad-args' });
  }, HEAVY);

  it('migration-pending refuses a verb whose rows the code\'s version shapes, never migrate itself', () => {
    const box = boundBox('ccrc-hist-oppend-');
    driverShim(box);
    expect(lastResult(runShim(box, ['--op', 'import', '--apply'], { env: PENDING }).stdout)).toEqual({ rc: 5, reason: 'migration-pending' });
    const m = runShim(box, ['--op', 'migrate'], { env: PENDING });
    expect(lastResult(m.stdout)).toEqual({ rc: 0 });
    expect(versionOf(dbFile(box))).toBe(2);
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('RB6: while a recovery step is registered, a writing form is refused recovering at both doors (Task 19)', () => {
  /** A bound store holding an open ('recover', <ms>) step, as restore and rebuild leave one (Tasks 27, 28), planted
   *  by SQL. Only import and migrate are --op verbs at this task, and no case here has a TTY: Task 25's RB6 case
   *  runs every writing form on a terminal, and Tasks 27 and 28 show restore and rebuild are never refused. */
  function recoveringBox(prefix: string): HistoryBox {
    const box = boundBox(prefix);
    const w = new DatabaseSync(dbFile(box));
    try {
      w.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.UTC(2026, 9, 4));
      w.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { w.close(); }
    return box;
  }

  it('the direct door: import --apply and migrate answer {rc:2, reason:"recovering"} and write nothing; the import dry run answers 0', () => {
    const box = recoveringBox('ccrc-hist-rb6a-');
    const before = snapshot(box);
    expect(lastResult(runShim(box, ['--op', 'import', '--apply']).stdout)).toEqual({ rc: 2, reason: 'recovering' });
    expect(lastResult(runShim(box, ['--op', 'migrate']).stdout)).toEqual({ rc: 2, reason: 'recovering' });
    // No op marker, no outbox flush, no writer open. No spool line is pending here, so the lock-take journal half,
    // which runs before the measure, and the half at release, which B1's `released` runs on the refusal, write nothing
    // either.
    expect(snapshot(box), 'a refused form writes nothing').toEqual(before);
    expect(lastResult(runShim(box, ['--op', 'import']).stdout), 'a dry run is no writing form').toEqual({ rc: 0 });
  }, HEAVY);

  it('the CLI door: import --apply, doctor --backup and doctor --migrate answer 2 recovering before any spawn; the import dry run reaches the shim', () => {
    const box = recoveringBox('ccrc-hist-rb6b-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    for (const args of [['import', '--apply'], ['doctor', '--backup'], ['doctor', '--migrate']]) {
      const r = op(box, [...args, '--json']);
      expect([r.code, r.json?.['reason']], args.join(' ')).toEqual([2, 'recovering']);
    }
    expect(stubArgv(box), 'the CLI refused each before it spawned').toBeNull();
    expect(op(box, ['import']).code, 'a dry run passes').toBe(0);
    expect(stubArgv(box)).toEqual(['--op import']);
  }, HEAVY);

  it('RB13, the direct door: migrate is refused while the stored user_version equals the code\'s; a store older than the code migrates, and its step stays for a later pass', () => {
    const box = recoveringBox('ccrc-hist-rb13a-');
    driverShim(box);
    const openStep = (): number => {
      const db = new DatabaseSync(dbFile(box), { readOnly: true });
      try {
        return (db.prepare("SELECT count(*) AS n FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL").get() as { n: number }).n;
      } finally { db.close(); }
    };
    // Stored 1, code 1: the refusal stands.
    expect(lastResult(runShim(box, ['--op', 'migrate']).stdout), 'stored = code').toEqual({ rc: 2, reason: 'recovering' });
    expect(versionOf(dbFile(box))).toBe(1);
    // Stored 1, code 2 (a v2 migration staged): a restored older backup migrates rather than wait on its own step.
    const m = runShim(box, ['--op', 'migrate'], { env: PENDING });
    expect(lastResult(m.stdout), `${m.stdout}\n${m.stderr}`).toEqual({ rc: 0 });
    expect(versionOf(dbFile(box))).toBe(2);
    expect(snapshotsIn(box)).toEqual(['pre-v2.db']);
    expect(openStep(), 'the migration leaves the step registered; it runs at the code\'s version').toBe(1);
    // Stored 2, code 2: equal again, so the refusal is back.
    expect(lastResult(runShim(box, ['--op', 'migrate'], { env: PENDING }).stdout), 'stored = code again').toEqual({ rc: 2, reason: 'recovering' });
  }, 1.5 * HEAVY);

  it('RB13, the CLI door: a store whose user_version is not the code\'s passes the recovering row in both halves and meets migrate\'s own word', () => {
    const box = recoveringBox('ccrc-hist-rb13b-');
    // Newer than the code, as a rollback past a migration leaves it. Neither half refuses it `recovering`; the sweep's
    // openStore answers schema-newer, which --migrate relays as migrate-refused (C63's refuse-newer).
    const w = new DatabaseSync(dbFile(box));
    try { w.exec('PRAGMA user_version = 2'); w.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { w.close(); }
    const before = sha(dbFile(box));
    const r = op(box, ['doctor', '--migrate', '--json']);
    expect([r.code, r.json?.['reason']], `${r.stdout}${r.stderr}`).toEqual([2, 'migrate-refused']);
    expect(sha(dbFile(box)), 'the store is untouched').toBe(before);
  }, HEAVY);
});
