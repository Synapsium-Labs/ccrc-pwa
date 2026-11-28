// `ccrc doctor`'s `overlord-journals` check and its read-only helper (Overlord W2, act journal plan Task A4, question 9, Table 3).
// The helper is run on journals the real kernel wrote in a fixture HOME, through the real server modules (`--modules` at the
// sources, under tsx). The check is run alone, as `approvals-doctor.test.ts` runs its checks (`ccd/ccrc` and the checks file
// sourced in a fixture HOME), against a fixture tree whose `deploy/` holds the real helper and whose server build is a set of
// shims that re-export the sources, with a `node` on PATH that loads tsx: so every grade is the real helper's answer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import {
  buildChainedRecord, chainNext, encodeChainedRecord,
  type ChainedJournalFormat, type ChainedJournalRecord, type ChainedPosition, type ChainedRefusal,
} from '../src/chainedJournal.js';
import { OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_FORMAT } from '../src/coord/overlordAuthority.js';
import { OVERLORD_ACTS_BASENAME, OVERLORD_ACTS_FORMAT } from '../src/coord/overlordActRecords.js';
import { INTENT, SETTLE } from './sim/overlordActJournalSets.js';

const REPO = path.resolve(__dirname, '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const CHECKS = path.join(REPO, 'ccd', 'ccrc-doctor-checks');
const HELPER = path.join(REPO, 'deploy', 'overlord-journals-verify.mjs');
const SRC = path.join(REPO, 'server', 'src');
const TSX = path.join(REPO, 'server', 'node_modules', 'tsx', 'dist', 'loader.mjs');
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const MARKER = 'Planted Marker 5c2d';

let home: string;
let ccrcDir: string;
beforeEach(() => { home = mkTmp('ccrc-ojdoc-'); ccrcDir = path.join(home, '.ccrc'); fs.mkdirSync(ccrcDir, { recursive: true }); });
afterEach(() => { fs.chmodSync(ccrcDir, 0o700); for (const f of fs.readdirSync(ccrcDir)) fs.chmodSync(path.join(ccrcDir, f), 0o600); fs.rmSync(home, { recursive: true, force: true }); });

/** `n` records of a format chained from 1, written as the server writes them. */
function writeJournal<E>(fmt: ChainedJournalFormat<E, ChainedRefusal>, base: string, entries: readonly E[], extra = ''): string {
  const parts: Uint8Array[] = [];
  let prev: ChainedPosition | null = null;
  for (const entry of entries) {
    const rec: ChainedJournalRecord<E> = buildChainedRecord(fmt, { ...chainNext(prev), acceptedAt: '2026-11-28T10:00:00.000Z', entry });
    parts.push(encodeChainedRecord(fmt, rec));
    prev = rec;
  }
  const p = path.join(ccrcDir, base);
  fs.writeFileSync(p, Buffer.concat([...parts.map((b) => Buffer.from(b)), Buffer.from(extra)]), { mode: 0o600 });
  return p;
}
const authority = (n: number, extra = ''): string => writeJournal(OVERLORD_AUTHORITY_FORMAT as never, OVERLORD_AUTHORITY_BASENAME,
  Array.from({ length: n }, (_, i) => ({ kind: 'authority-latch-raise', opKey: `op-${i}`, cause: 'restore-detected', cap: 'chat' })), extra);
const acts = (entries: readonly unknown[], extra = ''): string => writeJournal(OVERLORD_ACTS_FORMAT as never, OVERLORD_ACTS_BASENAME, entries, extra);

function helper(dir = ccrcDir): { code: number; lines: unknown[]; raw: string } {
  const r = spawnSync(process.execPath, ['--import', TSX, HELPER, '--modules', SRC, dir], { encoding: 'utf8' });
  return { code: r.status ?? -1, raw: r.stdout, lines: r.stdout.trim() === '' ? [] : r.stdout.trim().split('\n').map((l) => JSON.parse(l) as unknown) };
}

describe('the helper: one JSON line per journal, read only', () => {
  it('no file: absent, both', () => {
    expect(helper()).toMatchObject({ code: 0, lines: [{ journal: 'authority', state: 'absent' }, { journal: 'acts', state: 'absent' }] });
  });
  it('a verified file: ok, with its head\'s sequence', () => {
    authority(3);
    acts([{ ...INTENT, actId: 1 }, { ...SETTLE, actId: 1, from: 'pending' }]);
    expect(helper().lines).toEqual([{ journal: 'authority', state: 'ok', sequence: 3 }, { journal: 'acts', state: 'ok', sequence: 2 }]);
  });
  it('bytes after the last LF: torn-tail, with the head before it', () => {
    authority(2, '{"v":1,"seq');
    acts([SETTLE], '{');
    expect(helper().lines).toEqual([{ journal: 'authority', state: 'torn-tail', sequence: 2 }, { journal: 'acts', state: 'torn-tail', sequence: 1 }]);
  });
  it('a broken chain or a line the grammar refuses: malformed, with the kernel\'s word and no prose', () => {
    const p = authority(2);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"op-1"', '"op-9"'));
    acts([{ ...SETTLE, actor: { kind: 'operator', subject: MARKER } }]);
    const a = fs.readFileSync(path.join(ccrcDir, OVERLORD_ACTS_BASENAME), 'utf8');
    fs.writeFileSync(path.join(ccrcDir, OVERLORD_ACTS_BASENAME), a.replace('"act":"acknowledge"', `"act":"${MARKER}"`));
    const r = helper();
    expect(r.lines).toEqual([
      { journal: 'authority', state: 'malformed', code: expect.stringMatching(/^[a-z-]+$/) },
      { journal: 'acts', state: 'malformed', code: expect.stringMatching(/^[a-z-]+$/) },
    ]);
    expect(r.raw).not.toContain('Marker');
  });
  it('a file it may not read: unreadable, with the adapter\'s word', () => {
    if (process.getuid?.() === 0) return;   // root reads a mode-000 file
    const p = acts([SETTLE]);
    fs.chmodSync(p, 0o000);
    expect(helper().lines).toEqual([{ journal: 'authority', state: 'absent' }, { journal: 'acts', state: 'unreadable', why: 'unreadable' }]);
  });
  it('never writes: every byte, mode and name in the directory is unchanged, a torn tail included, and no quarantine directory appears', () => {
    authority(2, '{"v"');
    acts([SETTLE], 'x');
    const before = fs.readdirSync(ccrcDir).sort().map((f) => { const p = path.join(ccrcDir, f); return [f, fs.statSync(p).mode, fs.readFileSync(p, 'base64')]; });
    helper();
    const after = fs.readdirSync(ccrcDir).sort().map((f) => { const p = path.join(ccrcDir, f); return [f, fs.statSync(p).mode, fs.readFileSync(p, 'base64')]; });
    expect(after).toEqual(before);
  });
  it('a build it cannot load: one build-missing line, exit 3', () => {
    const r = spawnSync(process.execPath, [HELPER, '--modules', path.join(home, 'nothing'), ccrcDir], { encoding: 'utf8' });
    expect([r.status, r.stdout]).toEqual([3, '{"state":"build-missing"}\n']);
  });
});

/** A fixture tree for the check: `deploy/` holds the real helper (or `helperText`), and `server/dist/server/src/` shims that
 *  re-export the sources (or none, `build: false`); a `node` on PATH loads tsx. `CCRC_HERE` points at its `ccd/`. */
function check(o: { role?: string; build?: boolean; helperText?: string | null; noNode?: boolean } = {}): { code: number; out: string } {
  const tree = path.join(home, 'tree');
  fs.mkdirSync(path.join(tree, 'ccd'), { recursive: true });
  fs.mkdirSync(path.join(tree, 'deploy'), { recursive: true });
  if (o.helperText !== null) fs.writeFileSync(path.join(tree, 'deploy', 'overlord-journals-verify.mjs'), o.helperText ?? fs.readFileSync(HELPER, 'utf8'));
  if (o.build !== false) {
    for (const rel of ['chainedJournalFile.js', 'coord/overlordAuthority.js', 'coord/overlordActRecords.js']) {
      const shim = path.join(tree, 'server', 'dist', 'server', 'src', rel);
      fs.mkdirSync(path.dirname(shim), { recursive: true });
      fs.writeFileSync(shim, `export * from ${JSON.stringify(path.join(SRC, rel.replace(/\.js$/, '.ts')))};\n`);
    }
  }
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'node'), `#!${BASH}\nexec ${shq(process.execPath)} --import ${shq(TSX)} "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(ccrcDir, 'box.env'), `CCRC_ROLE=${o.role ?? 'both'}\n`, { mode: 0o600 });
  const script = `source ${shq(CCRC)}; source ${shq(CHECKS)}; BOX_ENV_FILE=${shq(path.join(ccrcDir, 'box.env'))}; CCRC_HERE=${shq(path.join(tree, 'ccd'))}; _check_overlord-journals`;
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  env.PATH = `${bin}:${env.PATH ?? ''}`;
  if (o.noNode === true) {
    // Every command on PATH, first one of each name winning, linked into one directory, less `node`.
    const only = path.join(home, 'no-node-bin');
    fs.mkdirSync(only, { recursive: true });
    const linked = new Set<string>(['node']);
    for (const dir of (env.PATH ?? '').split(':').filter((d) => d !== '' && d !== bin)) {
      let names: string[] = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) if (!linked.has(n)) { linked.add(n); fs.symlinkSync(path.join(dir, n), path.join(only, n)); }
    }
    env.PATH = only;
  }
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('doctor: overlord-journals (Table 3)', () => {
  it('no record in either journal: PASS, "no record yet" for each', () => {
    const r = check();
    expect(r.out).toMatch(/^PASS overlord-journals: authority: no record yet; acts: no record yet$/m);
    expect(r.code).toBe(0);
  });
  it('both verified: PASS, naming each head', () => {
    authority(4);
    acts([SETTLE, { ...SETTLE, actId: 8 }]);
    expect(check().out).toMatch(/^PASS overlord-journals: authority: verified to record 4; acts: verified to record 2$/m);
  });
  for (const which of ['authority', 'acts'] as const) {
    const plant = (extra: string): string => (which === 'authority' ? authority(2, extra) : acts([SETTLE, { ...SETTLE, actId: 8 }], extra));
    it(`${which}: a torn tail WARNs, naming the boot heal, and never FAILs`, () => {
      plant('{"v":1');
      const r = check();
      expect(r.out).toMatch(new RegExp(`^WARN overlord-journals: .*${which}: a torn tail after record 2, which the server cuts aside at its next boot`, 'm'));
      expect(r.out).toMatch(/^ {2}remedy: nothing to do/m);
      expect(r.code).toBe(2);
    });
    it(`${which}: a malformed file FAILs, naming Confirm the restore`, () => {
      const p = plant('');
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/"digest":"[0-9a-f]/, '"digest":"z'));
      const r = check();
      expect(r.out).toMatch(new RegExp(`^FAIL overlord-journals: .*${which}: malformed \\([a-z-]+\\)`, 'm'));
      expect(r.out).toMatch(/^ {2}remedy: open the console and Confirm the restore/m);
      expect(r.code).toBe(1);
    });
    it(`${which}: an unreadable file FAILs with its reason`, () => {
      if (process.getuid?.() === 0) return;
      fs.chmodSync(plant(''), 0o000);
      const r = check();
      expect(r.out).toMatch(new RegExp(`^FAIL overlord-journals: .*${which}: unreadable \\(unreadable\\)`, 'm'));
      expect(r.code).toBe(1);
    });
  }
  it('a FAIL outranks a WARN, and both journals are named', () => {
    authority(1, '{');
    const p = acts([SETTLE]);
    fs.writeFileSync(p, 'not json\n');
    expect(check().out).toMatch(/^FAIL overlord-journals: authority: a torn tail after record 1.*; acts: malformed \(malformed-json\)$/m);
  });
  it('a missing server build is unmeasured: WARN, never PASS', () => {
    const r = check({ build: false });
    expect(r.out).toMatch(/^WARN overlord-journals: unmeasured: the journal verifier gave no answer/m);
    expect(r.code).toBe(2);
  });
  it('a tree that ships no helper reads nothing: SKIP, as sigstore-root does with no verifier', () => {
    expect(check({ helperText: null })).toMatchObject({ code: 3, out: expect.stringMatching(/^SKIP overlord-journals: this tree ships no journal verifier/m) });
  });
  it('no node on PATH is unmeasured: WARN', () => {
    const r = check({ noNode: true });
    expect(r.out).toMatch(/^WARN overlord-journals: unmeasured: node is not on PATH/m);
    expect(r.code).toBe(2);
  });
  it('a helper that prints nothing, one line, or a line out of shape is unmeasured: WARN', () => {
    for (const text of ['', 'console.log(\'{"journal":"authority","state":"absent"}\');',
      'console.log(\'{"journal":"authority","state":"absent"}\\n{"journal":"acts","state":"fine"}\');',
      'console.log(\'{"journal":"acts","state":"absent"}\\n{"journal":"authority","state":"absent"}\');',
      'console.log(\'{"journal":"authority","state":"absent"}\\n{"journal":"acts","state":"absent"}\\n{"journal":"acts","state":"absent"}\');']) {
      expect(check({ helperText: text }).out, text).toMatch(/^WARN overlord-journals: unmeasured/m);
    }
  });
  it('a box that records CCRC_ROLE=fleet SKIPs, and a server box runs it', () => {
    expect(check({ role: 'fleet' })).toMatchObject({ code: 3, out: expect.stringMatching(/^SKIP overlord-journals: this box records CCRC_ROLE=fleet/m) });
    expect(check({ role: 'server' }).out).toMatch(/^PASS overlord-journals: /m);
  });
  it('a record\'s text never reaches a doctor line: a marker in an operator subject, on a verified and on a broken journal', () => {
    acts([{ ...SETTLE, actor: { kind: 'operator', subject: `device:${MARKER}` } }]);
    expect(check().out).not.toContain('Marker');
    acts([{ ...SETTLE, actor: { kind: 'operator', subject: `device:${MARKER}` } }], `{"subject":"${MARKER}"`);
    const r = check();
    expect(r.out).toMatch(/^WARN overlord-journals: /m);
    expect(r.out).not.toContain('Marker');
  });
});
