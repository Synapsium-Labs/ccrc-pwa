// The Node floor stops being prose here, and it has TWO reasons now. The first:
// `server/src/coord/db.ts` imports `node:sqlite` unconditionally, so below
// 22.13 the server does not degrade, it fails to boot. The second: ccrc
// history (spec 2026-10-05 §9.1) needs FTS5 from `node:sqlite`, which 22.13.0
// and 22.15.1 lack, and an `.iterate()` that survives a statement collected
// mid-loop, which 22.15.1 lacks too — both measured; 22.16.0 has both.
//
// FOUR assertions, not equally strong. 1-2 pin the DECLARATION: the three
// packages agree, and THIS interpreter clears what they declare. Assertion 2
// is RELATIVE and ONE-DIRECTIONAL — lowering `engines.node` to meet a lowered
// interpreter keeps it green (ci.yml's setup-node comment has the scenario).
// 3 and 4 pin the FACT and read no package.json: 3 round-trips a DatabaseSync
// (the 22.13 flag boundary), 4 runs FTS5 and a gc-pressured `.iterate()` in a
// child (the 22.16 boundary). With `engines` lowered to 22.13, a 22.15.1 box
// keeps 1-3 green and only 4 reds: 4 alone proves THIS floor, and CI's
// `node-floor` job runs this file on exactly the floor's version. If 3 or 4 is
// red while 1-2 are green, the declared number is too low (plan deviation D-6
// was the first time): RAISE `engines` in all three packages, never lower it —
// 3 and 4 never read `engines`, so no edit to it can turn them green.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES = ['server', 'agent', 'pwa'];

const enginesOf = (pkg: string): string | undefined => {
  const j = JSON.parse(readFileSync(path.join(root, pkg, 'package.json'), 'utf8')) as
    { engines?: { node?: string } };
  return j.engines?.node;
};

/** `>=22.16.0` -> [22, 16, 0]. Deliberately understands ONE range form: the
 *  moment someone writes `^22 || >=24` this parser must fail loudly rather than
 *  silently accept a floor it did not understand. */
const floorOf = (range: string): [number, number, number] => {
  const m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  expect(m, `engines.node must be a single '>=x.y.z' range, got ${JSON.stringify(range)}`).not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
};

describe('the node floor', () => {
  it('is declared in all three package.jsons, identically', () => {
    const ranges = PACKAGES.map((p) => [p, enginesOf(p)] as const);
    for (const [p, r] of ranges) expect(r, `${p}/package.json has no engines.node`).toBeTruthy();
    expect(new Set(ranges.map(([, r]) => r)).size,
      `the three packages declare different floors: ${JSON.stringify(ranges)}`).toBe(1);
  });

  it('is satisfied by the interpreter running this suite', () => {
    const [maj, min, pat] = floorOf(enginesOf('server')!);
    const [rMaj, rMin, rPat] = process.version.slice(1).split('.').map(Number) as [number, number, number];
    const ok = rMaj > maj || (rMaj === maj && (rMin > min || (rMin === min && rPat >= pat)));
    expect(ok, `running ${process.version}, floor is ${enginesOf('server')}`).toBe(true);
  });

  it('can import node:sqlite and construct a DatabaseSync — the reason the floor exists', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE probe (a INTEGER)');
    db.prepare('INSERT INTO probe VALUES (?)').run(1);
    expect((db.prepare('SELECT count(*) AS c FROM probe').get() as { c: number }).c).toBe(1);
    db.close();
  });
});

// ── assertion 4: the 22.16 boundary ─────────────────────────────────────────
// ABSOLUTE, like 3: no package.json is read. Each fact runs in a CHILD on this
// same interpreter (`process.execPath`), for two reasons: the iterate leg needs
// `--expose-gc`, which vitest's worker was not started with, and
// `--no-warnings` keeps node:sqlite's ExperimentalWarning off the child's
// stderr, so an empty combined output IS the green answer. Two cases, not one
// probe, so each fact reds on its own: on 22.15.1 the FTS5 leg dies first
// (`no such module: fts5`), and a single probe would hide whether the iterate
// leg still bites. Measured 2026-10-05 on 22.15.1 (both red: `no such module:
// fts5`, `statement has been finalized`), 22.16.0 and 24.14.1 (both green).
const childProbe = (src: string): { status: number | null; out: string } => {
  const r = spawnSync(process.execPath,
    ['--no-warnings', '--expose-gc', '--input-type=module', '-e', src], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** The table shape the history store creates (spec §6.2): contentless, with
 *  contentless_delete, so a MATCH answers rowids and a DELETE is honoured. */
const FTS5_PROBE = [
  "import { DatabaseSync } from 'node:sqlite';",
  "const db = new DatabaseSync(':memory:');",
  "db.exec(\"CREATE VIRTUAL TABLE t USING fts5(body, content='', contentless_delete=1, tokenize='porter unicode61')\");",
  "const ins = db.prepare('INSERT INTO t(rowid, body) VALUES (?, ?)');",
  "ins.run(1, 'alpha beta gamma');",
  "ins.run(2, 'delta epsilon');",
  "const hits = (q) => db.prepare('SELECT rowid AS r FROM t WHERE t MATCH ? ORDER BY rowid').all(q).map((x) => x.r);",
  "if (JSON.stringify(hits('beta')) !== '[1]') throw new Error('MATCH beta answered ' + JSON.stringify(hits('beta')));",
  "db.prepare('DELETE FROM t WHERE rowid = ?').run(1);",
  "if (JSON.stringify(hits('beta')) !== '[]') throw new Error('a contentless delete left ' + JSON.stringify(hits('beta')));",
  'db.close();',
].join('\n');

/** An UNHELD statement paged past 500 rows: nothing but the loop references
 *  it, so a collection mid-iteration finalizes it on 22.15.1. Without the
 *  `gc()` call the same loop completes there (measured) — the forced
 *  collection is what makes this leg see the defect at all. */
const ITERATE_PROBE = [
  "import { DatabaseSync } from 'node:sqlite';",
  "const db = new DatabaseSync(':memory:');",
  "db.exec('CREATE TABLE n (i INTEGER)');",
  "const ins = db.prepare('INSERT INTO n VALUES (?)');",
  'for (let i = 0; i < 1200; i += 1) ins.run(i);',
  'let seen = 0;',
  "for (const row of db.prepare('SELECT i FROM n ORDER BY i').iterate()) {",
  '  seen += 1;',
  '  if (seen % 100 === 0) globalThis.gc();',
  "  if (row.i !== seen - 1) throw new Error('row ' + seen + ' read ' + row.i);",
  '}',
  "if (seen !== 1200) throw new Error('iterated ' + seen);",
  'db.close();',
].join('\n');

describe('the node floor, assertion 4: what ccrc history needs from node:sqlite', () => {
  it('4a: FTS5 is compiled in — a contentless-delete table answers MATCH and forgets a deleted row', () => {
    const r = childProbe(FTS5_PROBE);
    expect(r.out, 'node:sqlite on this interpreter has no usable FTS5 — RAISE engines, never lower them').toBe('');
    expect(r.status).toBe(0);
  });

  it('4b: .iterate() survives a forced gc past 500 rows on a statement nothing else holds', () => {
    const r = childProbe(ITERATE_PROBE);
    expect(r.out, 'node:sqlite finalized a statement mid-iteration — RAISE engines, never lower them').toBe('');
    expect(r.status).toBe(0);
  });
});
