// server/test/history-ingest.test.ts
// The history sweep's discovery, admission and file identity (spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.2 steps 2-3, §5.2, §6.5, §6.10 item 6), and,
// as the plan's later tasks append, its chunked ingest.
// - The binding rules run in-process against a real store. A reused inode is presented by an injected stat, which
//   is deterministic where ext4's allocator is only likely.
// - Admission of a FIFO runs in a child with a deadline, so a mutant that blocks in open(2) fails instead of hanging
//   the worker.
// - The tick's wiring runs as the box runs it.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants as zc } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, plantSession, counters, journalRecords, spoolLine, SWEEP, PRELOADS, type HistoryBox } from './historyHelpers.js';
import { boundaryRow } from './historyFixtures.js';
import { createStore, openWriter, closeWriter } from '../../ccd/history/store.mjs';
import { historyPaths, sha256Hex } from '../../ccd/history/lib.mjs';

skipOnDarwin();

type Ids = { storeId: string; writer: string };
type TickCtx = {
  home: string; ids: Ids | null; now: () => number; homes: string[]; rosterUnreadable: boolean;
  out: (line: string) => void; hints?: string[];
};
type BindStat = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; birthtimeNs: bigint };
type Refusal = 'non_regular' | 'outside-roots' | 'missing' | 'unreadable';
type Admit = { ok: true; fd: number; st: BigIntStats } | { ok: false; why: Refusal };
type Bound = { fileId: number; transcriptPk: number; action: 'resume' | 'rescan' | 'retire' | 'skip'; offset: number };
/** The slice of sweep.mjs these tests call. It grows task by task; every member is a real export. */
interface Sweep {
  PARSER_VERSION: number;
  admitFile(p: string, home: string, homes: string[], userHome: string): Admit;
  discoverTranscripts(homes: string[], uuids: Iterable<string>): Array<{ path: string; uuid: string; home: string }>;
  knownUuids(db: DatabaseSync, home: string): Set<string>;
  headShaOf(fd: number, size: number): string | null;
  lineShaBefore(fd: number, offset: number, size: number): string | null;
  bindFile(db: DatabaseSync, f: { path: string; uuid: string; fd: number; st: BindStat; headSha: string | null }, nowMs: number): Bound;
  discoverAndPlan(db: DatabaseSync, c: TickCtx, uuids: readonly string[]): Array<Bound & { path: string; dev: bigint; ino: bigint }>;
}
let SW: Sweep;
beforeAll(async () => { SW = (await import('../../ccd/history/sweep.mjs')) as unknown as Sweep; });

const T = Date.UTC(2026, 9, 5, 12, 0, 0);
const u = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const U1 = u(0x21); const U2 = u(0x22); const U3 = u(0x23); const U4 = u(0x24);
const row = (uuid: string): string => `${JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: `text of ${uuid}` } })}\n`;
const transcriptAt = (home: string, slug: string, name: string, text: string): string => {
  const dir = path.join(home, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(p, text);
  return p;
};
/** admitFile in a child with a 5 s deadline: a FIFO opened without O_NONBLOCK blocks for ever, and a synchronous
 *  open cannot be timed out from inside the test's own process. */
const admitInChild = (box: HistoryBox, p: string, home: string): { status: number | null; stdout: string } => {
  const file = path.join(box.home, `admit-${process.hrtime.bigint()}.mjs`);
  fs.writeFileSync(file, `import * as S from ${JSON.stringify(pathToFileURL(SWEEP).href)};
const a = S.admitFile(${JSON.stringify(p)}, ${JSON.stringify(home)}, ${JSON.stringify(box.homes)}, ${JSON.stringify(box.home)});
process.stdout.write(JSON.stringify(a.ok ? { ok: true } : a));
`);
  const r = spawnSync(process.execPath, ['--no-warnings', file], { env: box.env, cwd: box.home, encoding: 'utf8', timeout: 5000 });
  return { status: r.status, stdout: r.stdout };
};

describe('admission (spec §5.2 "Read only", §9.2 step 2; DM35 transcript half)', () => {
  let box: HistoryBox;
  beforeEach(() => { box = makeHistoryBox('ccrc-hist-admit-', { role: 'fleet' }); });
  const admit = (p: string, home: string, homes: string[] = box.homes): Admit => {
    const a = SW.admitFile(p, home, homes, box.home);
    if (a.ok) fs.closeSync(a.fd);
    return a;
  };

  it('admits a regular transcript under a rostered projects/ root, and hands back an open descriptor on it', () => {
    const p = transcriptAt(box.homes[0]!, 'demo', U1, row('r1'));
    const a = SW.admitFile(p, box.homes[0]!, box.homes, box.home);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.st.isFile()).toBe(true);
      expect(a.st.size).toBe(BigInt(fs.statSync(p).size));
      fs.closeSync(a.fd);
    }
  });

  it('refuses a symlinked name even when it points at a transcript inside the roots (O_NOFOLLOW)', () => {
    const real = transcriptAt(box.homes[0]!, 'demo', 'real-one', row('r1'));
    const link = path.join(box.homes[0]!, 'projects', 'demo', `${U2}.jsonl`);
    fs.symlinkSync(real, link);
    expect(admit(link, box.homes[0]!)).toEqual({ ok: false, why: 'non_regular' });
  });

  it('refuses a FIFO at once, never waiting on it (O_NONBLOCK)', () => {
    const dir = path.join(box.homes[0]!, 'projects', 'demo');
    fs.mkdirSync(dir, { recursive: true });
    const fifo = path.join(dir, `${U3}.jsonl`);
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const r = admitInChild(box, fifo, box.homes[0]!);
    expect(r.status, 'admission blocked on a FIFO').toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, why: 'non_regular' });
  });

  it('refuses a file reached through a symlinked project dir whose realpath leaves every rostered root', () => {
    const outside = path.join(box.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, `${U1}.jsonl`), row('r1'));
    fs.mkdirSync(path.join(box.homes[0]!, 'projects'), { recursive: true });
    fs.symlinkSync(outside, path.join(box.homes[0]!, 'projects', 'escape'));
    expect(admit(path.join(box.homes[0]!, 'projects', 'escape', `${U1}.jsonl`), box.homes[0]!)).toEqual({ ok: false, why: 'outside-roots' });
  });

  it('admits under a rostered home that is itself a symlink: the $HOME/.claude* test reads the home\'s own path', () => {
    const real = path.join(box.home, 'data', 'claude-s');
    fs.mkdirSync(real, { recursive: true });
    const home = path.join(box.home, '.claude-s');
    fs.symlinkSync(real, home);
    const p = transcriptAt(home, 'demo', U1, row('r1'));
    expect(admit(p, home, [...box.homes, home]).ok).toBe(true);
  });

  it('refuses a rostered home outside $HOME/.claude*, and a home the roster does not name', () => {
    const other = path.join(box.home, 'not-claude');
    const p = transcriptAt(other, 'demo', U1, row('r1'));
    expect(admit(p, other, [...box.homes, other])).toEqual({ ok: false, why: 'outside-roots' });
    const stray = path.join(box.home, '.claude-stray');
    const q = transcriptAt(stray, 'demo', U1, row('r1'));
    expect(admit(q, stray)).toEqual({ ok: false, why: 'outside-roots' });
  });

  it('answers missing for a path that is not there', () => {
    expect(admit(path.join(box.homes[0]!, 'projects', 'demo', `${U4}.jsonl`), box.homes[0]!)).toEqual({ ok: false, why: 'missing' });
  });
});

describe('discovery and file identity (spec §9.2 steps 2-3, §6.5; DM20, DM40, DM45, O3)', () => {
  let box: HistoryBox;
  let db: DatabaseSync;
  let homes: string[];
  beforeEach(() => {
    box = makeHistoryBox('ccrc-hist-ident-', { role: 'fleet' });
    createStore(box.home);
    db = openWriter(historyPaths(box.home).dbFile);
    homes = box.homes;
  });
  afterEach(() => { closeWriter(db); });
  const homeOf = (p: string): string => homes.find((h) => p.startsWith(`${h}/`))!;
  const bindAt = (p: string, uuid: string, nowMs: number, over: Partial<BindStat> = {}): Bound => {
    const a = SW.admitFile(p, homeOf(p), homes, box.home);
    if (!a.ok) throw new Error(`${p} was not admitted: ${a.why}`);
    try {
      const st: BindStat = { dev: a.st.dev, ino: a.st.ino, size: a.st.size, mtimeNs: a.st.mtimeNs, birthtimeNs: a.st.birthtimeNs, ...over };
      return SW.bindFile(db, { path: p, uuid, fd: a.fd, st, headSha: SW.headShaOf(a.fd, Number(a.st.size)) }, nowMs);
    } finally {
      fs.closeSync(a.fd);
    }
  };
  type FileRow = { file_id: bigint; dev: bigint; ino: bigint; source_key: string; transcript_pk: bigint; birth_ns: bigint | null; offset: bigint; status: string; parser_version: bigint };
  const rowOf = (fileId: number): FileRow => {
    const s = db.prepare('SELECT file_id, dev, ino, source_key, transcript_pk, birth_ns, offset, status, parser_version FROM ingest_files WHERE file_id = ?');
    s.setReadBigInts(true);
    return s.get(fileId) as unknown as FileRow;
  };
  const pathsOf = (fileId: number): string[] =>
    (db.prepare('SELECT path FROM file_paths WHERE file_id = ? ORDER BY path').all(fileId) as Array<{ path: string }>).map((r) => r.path);
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const counterOf = (name: string): number =>
    (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n ?? 0;
  /** The cursor as an ingest chunk leaves it: at end of file, with the last line's sha beside it. */
  const cursorToEnd = (fileId: number, p: string): number => {
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    try {
      db.prepare('UPDATE ingest_files SET offset = ?, tail_sha256 = ? WHERE file_id = ?')
        .run(size, Buffer.from(SW.lineShaBefore(fd, size, size)!, 'hex'), fileId);
    } finally {
      fs.closeSync(fd);
    }
    return size;
  };
  /** One stored row of a file (a blob, an entry, its membership), so a case can see that nothing is ever deleted. */
  const plantEntry = (fileId: number, transcriptPk: number, uuid: string): void => {
    const blob = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', NULL, 0)").run(Buffer.from(sha256Hex(uuid), 'hex')).lastInsertRowid;
    const entry = db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id) VALUES (?, ?, 'user', 'operator', 1, 1, ?, ?)")
      .run(uuid, transcriptPk, fileId, blob).lastInsertRowid;
    db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, 1)').run(fileId, entry);
  };

  it('headShaOf hashes the first line without its newline; lineShaBefore the last whole line before a cursor that sits after a newline', () => {
    const p = transcriptAt(homes[0]!, 'demo', U1, 'a\nbb\n');
    const fd = fs.openSync(p, 'r');
    try {
      expect(SW.headShaOf(fd, 5)).toBe(sha256Hex('a'));
      expect(SW.lineShaBefore(fd, 5, 5)).toBe(sha256Hex('bb'));
      expect(SW.lineShaBefore(fd, 2, 5)).toBe(sha256Hex('a'));
      expect(SW.lineShaBefore(fd, 3, 5), 'a cursor not after a newline is never proof').toBeNull();
      expect(SW.lineShaBefore(fd, 0, 5)).toBeNull();
      expect(SW.lineShaBefore(fd, 6, 5)).toBeNull();
    } finally {
      fs.closeSync(fd);
    }
    const q = transcriptAt(homes[0]!, 'demo', U2, 'no newline yet');
    const fq = fs.openSync(q, 'r');
    try { expect(SW.headShaOf(fq, 14)).toBeNull(); } finally { fs.closeSync(fq); }
  });

  it('discovers <uuid>.jsonl under every rostered home, hardlinked copies included; a home with no projects/ is skipped silently', () => {
    const a = transcriptAt(homes[0]!, 'demo', U1, row('r1'));
    fs.mkdirSync(path.join(homes[1]!, 'projects', 'demo'), { recursive: true });
    const b = path.join(homes[1]!, 'projects', 'demo', `${U1}.jsonl`);
    fs.linkSync(a, b);
    transcriptAt(homes[0]!, 'other', U2, row('r2'));
    const bare = path.join(box.home, '.claude-new');
    fs.mkdirSync(bare);
    const got = SW.discoverTranscripts([...homes, bare], [U1]);
    expect(got.map((f) => f.path).sort()).toEqual([a, b].sort());
    expect(got.every((f) => f.uuid === U1)).toBe(true);
  });

  it('known uuids are the confirmed epochs\' and the registry\'s; an unconfirmed clear epoch and a candidate are not', () => {
    db.exec("INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES ('x', '', 'p', 1)");
    const pk = (db.prepare("SELECT session_pk FROM sessions WHERE ccrc_id = 'x'").get() as { session_pk: number }).session_pk;
    const ep = db.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?)');
    ep.run(pk, 1, U1, 'startup', 'hook', 5);
    ep.run(pk, 2, U2, 'clear', 'hook', null);
    db.prepare("INSERT INTO epoch_candidates (cc_session_uuid, ccrc_id, generation, cause, ts_ms, first_seen_ms) VALUES (?, 'x', '', 'startup', NULL, 1)").run(U3);
    fs.writeFileSync(path.join(box.reg, 'y.uuid'), U4);
    fs.writeFileSync(path.join(box.reg, 'z.uuid'), 'not-a-uuid');
    expect([...SW.knownUuids(db, box.home)].sort()).toEqual([U1, U4].sort());
  });

  it('a new file gets one live row keyed on its inode, source_key \'\', bound to its claude-code transcript, read from 0 (DM40)', () => {
    const p = transcriptAt(homes[0]!, 'demo', U1, row('r1'));
    const b = bindAt(p, U1, T);
    expect(b).toMatchObject({ action: 'rescan', offset: 0 });
    const st = fs.statSync(p, { bigint: true });
    expect(rowOf(b.fileId)).toMatchObject({ dev: st.dev, ino: st.ino, source_key: '', status: 'live', parser_version: BigInt(SW.PARSER_VERSION) });
    expect(db.prepare('SELECT cc_session_uuid, harness, agent_id FROM transcripts WHERE transcript_pk = ?').get(b.transcriptPk))
      .toEqual({ cc_session_uuid: U1, harness: 'claude-code', agent_id: '' });
    expect(pathsOf(b.fileId)).toEqual([p]);
  });

  it('two paths of one inode are one row with two paths (DM20)', () => {
    const a = transcriptAt(homes[0]!, 'demo', U1, row('r1'));
    fs.mkdirSync(path.join(homes[1]!, 'projects', 'demo'), { recursive: true });
    const b = path.join(homes[1]!, 'projects', 'demo', `${U1}.jsonl`);
    fs.linkSync(a, b);
    const first = bindAt(a, U1, T);
    const second = bindAt(b, U1, T + 1);
    expect(second.fileId).toBe(first.fileId);
    expect(count('SELECT count(*) AS n FROM ingest_files')).toBe(1);
    expect(pathsOf(first.fileId)).toEqual([a, b].sort());
  });

  it('resumes from the cursor only with proof: the same identity, a size at least the offset, and the last line\'s sha', () => {
    const p = transcriptAt(homes[0]!, 'demo', U1, row('r1') + row('r2'));
    const b = bindAt(p, U1, T);
    const end = cursorToEnd(b.fileId, p);
    fs.appendFileSync(p, row('r3'));
    expect(bindAt(p, U1, T + 1)).toMatchObject({ fileId: b.fileId, action: 'resume', offset: end });
    const text = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, text.replace('"uuid":"r2"', '"uuid":"R2"'));   // same inode and length, another line under the cursor
    expect(bindAt(p, U1, T + 2)).toMatchObject({ fileId: b.fileId, action: 'rescan', offset: 0 });
    expect(rowOf(b.fileId).offset).toBe(0n);
  });

  it('a file shorter than its cursor is rescanned from 0, counted source_shrank, and nothing is deleted (O3, G17)', (ctx) => {
    const p = transcriptAt(homes[0]!, 'demo', U1, row('pre-1') + row('pre-2') + row('kept'));
    // Without a birth time, the first line stands in for identity, and a rewrite that drops the first line reads as a
    // reused inode (§9.2, graded I). Then G17 is a retire, which deletes nothing either, but it is not this case.
    if (fs.statSync(p, { bigint: true }).birthtimeNs === 0n) ctx.skip();
    const b = bindAt(p, U1, T);
    cursorToEnd(b.fileId, p);
    plantEntry(b.fileId, b.transcriptPk, 'pre-1');
    fs.writeFileSync(p, row('kept'));                              // the pre-boundary rows vanish, same inode
    expect(bindAt(p, U1, T + 1)).toMatchObject({ fileId: b.fileId, action: 'rescan', offset: 0 });
    expect(counterOf('source_shrank')).toBe(1);
    expect(count('SELECT count(*) AS n FROM entries')).toBe(1);
    expect(count('SELECT count(*) AS n FROM memberships')).toBe(1);
  });

  it('a new inode at a known path gets its own row; the path names it; the old row and its memberships stay (O3)', () => {
    const p = transcriptAt(homes[0]!, 'demo', U1, row('r1'));
    const b = bindAt(p, U1, T);
    plantEntry(b.fileId, b.transcriptPk, 'r1');
    fs.writeFileSync(`${p}.new`, row('r1') + row('r2'));
    fs.renameSync(`${p}.new`, p);                                  // the new inode is made while the old one still exists
    const again = bindAt(p, U1, T + 1);
    expect(again.fileId).not.toBe(b.fileId);
    expect(again).toMatchObject({ action: 'rescan', offset: 0, transcriptPk: b.transcriptPk });
    expect(pathsOf(again.fileId)).toEqual([p]);
    expect(pathsOf(b.fileId)).toEqual([]);
    expect(rowOf(b.fileId).source_key).toBe('');
    expect(count(`SELECT count(*) AS n FROM memberships WHERE file_id = ${b.fileId}`)).toBe(1);
  });

  it('a file at a recorded (dev, ino) whose uuid differs retires that row; it gets its own row and transcript (DM45)', () => {
    const pU = transcriptAt(homes[0]!, 'demo', U1, row('u-1'));
    const bU = bindAt(pU, U1, T);
    plantEntry(bU.fileId, bU.transcriptPk, 'u-1');
    const rU = rowOf(bU.fileId);
    fs.unlinkSync(pU);                                            // U's inode is freed...
    const pV = transcriptAt(homes[1]!, 'other', U2, row('v-1'));
    const bV = bindAt(pV, U2, T + 5, { dev: rU.dev, ino: rU.ino });   // ...and V's file is presented on it
    expect(bV.action).toBe('retire');
    expect(bV.fileId).not.toBe(bU.fileId);
    expect(bV.transcriptPk).not.toBe(bU.transcriptPk);
    expect(rowOf(bU.fileId).source_key).toBe(`retired:${sha256Hex(`${rU.dev}\0${rU.ino}\0${rU.transcript_pk}\0${T + 5}`)}`);
    expect(rowOf(bU.fileId).status).toBe('retired');
    expect(rowOf(bV.fileId)).toMatchObject({ source_key: '', dev: rU.dev, ino: rU.ino, status: 'live' });
    expect(db.prepare('SELECT cc_session_uuid FROM transcripts WHERE transcript_pk = ?').get(bV.transcriptPk)).toEqual({ cc_session_uuid: U2 });
    expect(count(`SELECT count(*) AS n FROM memberships WHERE file_id = ${bU.fileId}`)).toBe(1);
    expect(counterOf('inode_recycled')).toBe(1);
    expect(pathsOf(bV.fileId)).toEqual([pV]);
  });

  it('a second home\'s copy of U on U\'s freed inode differs by birth time, so it gets its own row (DM45)', (ctx) => {
    const pA = transcriptAt(homes[0]!, 'demo', U1, row('u-1'));
    if (fs.statSync(pA, { bigint: true }).birthtimeNs === 0n) ctx.skip();   // no birth time: the first line stands in (§9.2, I)
    const bA = bindAt(pA, U1, T);
    const rA = rowOf(bA.fileId);
    fs.unlinkSync(pA);
    const pB = transcriptAt(homes[1]!, 'demo', U1, row('u-1'));
    const bB = bindAt(pB, U1, T + 5, { dev: rA.dev, ino: rA.ino, birthtimeNs: (rA.birth_ns ?? 0n) + 1_000n });
    expect(bB.action).toBe('retire');
    expect(bB.fileId).not.toBe(bA.fileId);
    expect(bB.transcriptPk).toBe(bA.transcriptPk);
    expect(rowOf(bA.fileId).source_key).toMatch(/^retired:[0-9a-f]{64}$/);
    expect(counterOf('inode_recycled')).toBe(1);
  });

  it('a path whose file was replaced names the new row, whether or not the new file reused the old inode (DM45)', () => {
    const p = transcriptAt(homes[0]!, 'demo', U1, row('r1'));
    const b = bindAt(p, U1, T);
    fs.unlinkSync(p);
    fs.writeFileSync(p, row('r1') + row('r2'));                   // a carry: unlink, then write
    const again = bindAt(p, U1, T + 1);
    expect(again.fileId).not.toBe(b.fileId);
    expect(pathsOf(again.fileId)).toEqual([p]);
  });

  it('one inode holds rows of distinct source_keys; a second \'\' row for it is refused by UNIQUE (DM40)', () => {
    const t = db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run(U1).lastInsertRowid;
    const ins = db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (7, 9, ?, ?, 'live', 1)");
    ins.run('', t);
    ins.run(`exported:${'ab'.repeat(32)}`, t);
    ins.run(`retired:${'cd'.repeat(32)}`, t);
    ins.run(U2, t);                                               // a session id inside a shared source (§6.10 item 6)
    expect(() => ins.run('', t)).toThrow(/UNIQUE constraint failed/);
  });

  it('discoverAndPlan binds each admitted inode once, and counts what it refuses or no longer finds (DM20, DM35)', () => {
    const a = transcriptAt(homes[0]!, 'demo', U1, row('r1'));
    fs.mkdirSync(path.join(homes[1]!, 'projects', 'demo'), { recursive: true });
    fs.linkSync(a, path.join(homes[1]!, 'projects', 'demo', `${U1}.jsonl`));
    const target = transcriptAt(homes[0]!, 'demo', 'target', row('r9'));
    fs.symlinkSync(target, path.join(homes[0]!, 'projects', 'demo', `${U2}.jsonl`));
    const gone = transcriptAt(homes[2]!, 'demo', U3, row('r3'));
    bindAt(gone, U3, T);
    fs.unlinkSync(gone);
    const c: TickCtx = { home: box.home, ids: null, now: () => T, homes, rosterUnreadable: false, out: () => undefined };
    const planned = SW.discoverAndPlan(db, c, [U1, U2, U3]);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ action: 'rescan', offset: 0, path: a });
    expect(pathsOf(planned[0]!.fileId)).toHaveLength(2);
    expect(counterOf('non_regular')).toBe(1);
    expect(counterOf('file_missing')).toBe(1);
  });
});

describe('the tick discovers and binds, as the box runs it (spec §9.2 steps 2-3)', () => {
  it('the first pass binds the transcript a registry uuid names: one transcript, one cursor row, its path', () => {
    const box = makeHistoryBox('ccrc-hist-discover-', { role: 'fleet' });
    fs.writeFileSync(path.join(box.reg, 'claude-a-demo.uuid'), U1);
    const p = transcriptAt(box.homes[1]!, 'demo', U1, row('r1'));
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    const db = openStoreRO(box);
    try {
      expect(db.prepare('SELECT cc_session_uuid, harness, agent_id FROM transcripts').all()).toEqual([{ cc_session_uuid: U1, harness: 'claude-code', agent_id: '' }]);
      expect(db.prepare('SELECT source_key, status FROM ingest_files').all()).toEqual([{ source_key: '', status: 'live' }]);
      expect(db.prepare('SELECT path FROM file_paths').all()).toEqual([{ path: p }]);
    } finally {
      db.close();
    }
  });

  it('with an unreadable roster nothing is discovered and the scan stays due; the next readable pass binds (§9.2 step 2)', () => {
    const box = makeHistoryBox('ccrc-hist-roster-', { role: 'fleet' });
    fs.writeFileSync(path.join(box.reg, 'claude-a-demo.uuid'), U1);
    transcriptAt(box.homes[1]!, 'demo', U1, row('r1'));
    expect(runSweep(box, ['--roster-unreadable']).code).toBe(0);
    const rows = (): unknown[] => { const db = openStoreRO(box); try { return db.prepare('SELECT file_id FROM ingest_files').all(); } finally { db.close(); } };
    // The scan clock itself (plan task 19): ingest discovers through knownUuids on every tick, so the file rows alone
    // no longer show whether the unreadable pass left the scan due. meta scan_ms does.
    const mark = (): string | null => {
      const db = openStoreRO(box);
      try { return (db.prepare("SELECT v FROM meta WHERE k = 'scan_ms'").get() as { v: string } | undefined)?.v ?? null; } finally { db.close(); }
    };
    expect(rows()).toEqual([]);
    expect(mark()).toBeNull();
    expect(runSweep(box).code).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(mark()).not.toBeNull();
  });
});

// ---- ingest fixtures shared by plan tasks 19–23 --------------------------------------------------
// Every row is synthetic and spelled out: real Claude Code 2.1.289 field NAMES (type, uuid,
// parentUuid, timestamp, message.{role,model,content}, requestId, cwd, gitBranch), invented
// values. Spawned cases run the real sweep through runSweep: a child on process.execPath, the
// statfs preload set to 'plenty', the tmux poison, a scrubbed env. In-process cases import
// sweep.mjs and pass every home explicitly, so no case here can reach the operator's ~/.ccrc.
interface IxBudget { startMs: number; bytes: number; now: () => number; maxMs: number; maxBytes: number; chunkBytes: number }
interface IxIds { storeId: string; writer: string }
type IxFloorWord = 'ok' | 'low-disk' | 'unsettled';
interface IxCtx {
  home: string; homes: string[]; nowMs: number; ids: IxIds;
  historyOff: () => boolean; prepareLines: (...args: never[]) => unknown; floorProbe: () => Promise<IxFloorWord>;
  [extra: string]: unknown;
}
interface IxFileResult {
  fileId: number; size: number; bytes: number; atEof: boolean; offset: number;
  newEntries: number; minNewTsMs: number | null; crashed?: boolean; tornAt?: number; floor?: IxFloorWord;
}
interface IxTickResult { busy: boolean; bytes: number; newEntries: number; minNewTsMs: number | null; paused: boolean }
interface IxSweep {
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): IxBudget;
  makeIngestCtx(home: string, homes: string[], nowMs: number, ids: IxIds, floorProbe?: () => Promise<IxFloorWord>): IxCtx;
  ingestPath(db: DatabaseSync, ctx: IxCtx, f: { path: string; uuid: string; home: string }, b: IxBudget): Promise<IxFileResult | null>;
  ingestTick(db: DatabaseSync, ctx: IxCtx, b: IxBudget): Promise<IxTickResult>;
  ingestSidecars(db: DatabaseSync, ctx: IxCtx, b: IxBudget, uuids: Iterable<string>): Promise<{ bytes: number; complete: boolean; paused: boolean }>;
}
type IxRow = Record<string, unknown>;

const IX = (() => {
  const U = '6f1c2e3a-0b4d-4c5e-8f60-718293a4b5c6';
  const U2 = '7a2d3f4b-1c5e-4d6f-9a71-8293a4b5c6d7';
  const U3 = '8b3e4a5c-2d6f-4e7a-8b82-93a4b5c6d7e8';
  const G = '0189abcd-1234-4678-9abc-0123456789ab';
  const ID = 'claude-demo';
  const SLUG = '-home-u-tree';
  const uuidN = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ts = (n: number): string => new Date(Date.UTC(2026, 9, 5, 10, 0, 0) + n * 1000).toISOString();
  const tsMs = (n: number): number => Date.UTC(2026, 9, 5, 10, 0, 0) + n * 1000;
  const user = (uuid: string, parent: string | null, content: unknown, n: number, extra: IxRow = {}): IxRow => ({
    parentUuid: parent, isSidechain: false, userType: 'external', cwd: '/home/u/tree', sessionId: U,
    version: '2.1.289', gitBranch: 'main', type: 'user', message: { role: 'user', content }, uuid, timestamp: ts(n), ...extra,
  });
  const assistant = (uuid: string, parent: string | null, content: unknown[], n: number, model = 'claude-opus-4-1'): IxRow => ({
    parentUuid: parent, isSidechain: false, cwd: '/home/u/tree', sessionId: U, version: '2.1.289', gitBranch: 'main',
    type: 'assistant', message: { id: `msg_${uuid.slice(-8)}`, type: 'message', role: 'assistant', model, content },
    requestId: `req_${uuid.slice(-8)}`, uuid, timestamp: ts(n),
  });
  const jsonl = (rows: (IxRow | string)[]): string => rows.map((r) => `${typeof r === 'string' ? r : JSON.stringify(r)}\n`).join('');
  /** `n` pseudo-random words (a fixed LCG, so every run writes the same bytes). */
  const words = (n: number, seed = 7): string => {
    const W = ['alpha', 'beta', 'gamma', 'delta', 'sweep', 'cursor', 'journal', 'blob', 'entry', 'family', 'zeta', 'omega'];
    let x = seed; let s = '';
    for (let i = 0; i < n; i += 1) { x = (x * 1103515245 + 12345) % 2147483648; s += `${W[x % W.length]}${i % 17 === 16 ? '\n' : ' '}`; }
    return s;
  };
  const plantCopy = (home: string, uuid: string, text: string, slug = SLUG): string => {
    const dir = path.join(home, 'projects', slug);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${uuid}.jsonl`);
    fs.writeFileSync(p, text);
    return p;
  };
  /** A fleet-role box whose registry names one session, `claude-demo` on uuid U. */
  const newBox = (prefix: string, roster?: unknown): HistoryBox => {
    const box = makeHistoryBox(prefix, roster === undefined ? { role: 'fleet' } : { role: 'fleet', roster });
    plantSession(box, ID, { uuid: U, generation: G, project: 'demo', workdir: '/home/u/tree' });
    return box;
  };
  /** Two scheduled passes: the first may only create the store; the second certainly ingests. */
  const sweepTwice = (box: HistoryBox, opts?: Parameters<typeof runSweep>[2]): void => {
    for (let i = 0; i < 2; i += 1) {
      const r = runSweep(box, [], opts);
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    }
  };
  const count = (db: DatabaseSync, table: string, where = ''): number =>
    (db.prepare(`SELECT count(*) AS n FROM ${table}${where === '' ? '' : ` WHERE ${where}`}`).get() as { n: number }).n;
  const blobsHold = (db: DatabaseSync, needle: string): boolean =>
    (db.prepare('SELECT z FROM blobs WHERE z IS NOT NULL').all() as { z: Uint8Array }[])
      .some((b) => brotliDecompressSync(b.z).toString('utf8').includes(needle));
  /** Every TEXT value of every ordinary table (FTS5 tables and their shadows excluded) that holds `needle`. */
  const textColumnsHold = (db: DatabaseSync, needle: string): string[] => {
    const hits: string[] = [];
    const tables = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[])
      .filter((t) => !/^CREATE VIRTUAL TABLE/i.test(t.sql) && !/_fts_/.test(t.name));
    for (const t of tables) {
      const cols = (db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]).map((c) => c.name);
      const st = db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t.name}"`);
      st.setReadBigInts(true);
      for (const row of st.all() as Record<string, unknown>[]) {
        for (const c of cols) { const v = row[c]; if (typeof v === 'string' && v.includes(needle)) hits.push(`${t.name}.${c}`); }
      }
    }
    return hits;
  };
  let apiP: Promise<{ sweep: IxSweep; store: typeof import('../../ccd/history/store.mjs'); lib: typeof import('../../ccd/history/lib.mjs') }> | null = null;
  const api = () => (apiP ??= (async () => ({
    sweep: (await import('../../ccd/history/sweep.mjs')) as unknown as IxSweep,
    store: await import('../../ccd/history/store.mjs'),
    lib: await import('../../ccd/history/lib.mjs'),
  }))());
  /** A real store in the box, created and opened in THIS process (in-process cases only). */
  const openFixtureStore = async (box: HistoryBox): Promise<{ db: DatabaseSync; ids: IxIds }> => {
    const { store, lib } = await api();
    const ids = store.createStore(box.home);
    return { db: store.openWriter(lib.historyPaths(box.home).dbFile), ids };
  };
  const cursorOf = (db: DatabaseSync, fileId: number): number =>
    (db.prepare('SELECT offset FROM ingest_files WHERE file_id = ?').get(fileId) as { offset: number }).offset;
  return { U, U2, U3, G, ID, SLUG, uuidN, ts, tsMs, user, assistant, jsonl, words, plantCopy, newBox, sweepTwice, count, blobsHold, textColumnsHold, api, openFixtureStore, cursorOf };
})();

describe('history ingest: chunk writes through the real sweep (plan task 19)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('DM1: six homes holding one transcript give one entry per uuid and six memberships each', () => {
    const SIX = { ...DEFAULT_TEST_ROSTER, accounts: [...DEFAULT_TEST_ROSTER.accounts, {
      id: 'claude-e', label: 'claude-e', configDirSuffix: '.claude-e', exec: { kind: 'generated' },
      homeAble: true, hue: 'amber', telemetry: 'anthropic',
    }] };
    const box = IX.newBox('ccrc-hist-dm1-', SIX);
    expect(box.homes).toHaveLength(6);
    const rows = [
      IX.user(IX.uuidN(1), null, 'first prompt', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'text', text: 'first answer' }], 2),
      IX.user(IX.uuidN(3), IX.uuidN(2), 'second prompt', 3),
    ];
    for (const h of box.homes) IX.plantCopy(h, IX.U, IX.jsonl(rows));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries')).toBe(3);
      expect(IX.count(db, 'ingest_files')).toBe(6);
      const per = (db.prepare(`SELECT e.uuid AS uuid, count(m.file_id) AS n FROM entries e
        JOIN memberships m ON m.entry_id = e.entry_id GROUP BY e.uuid ORDER BY e.uuid`).all() as { uuid: string; n: number }[])
        .map((r) => ({ uuid: r.uuid, n: r.n }));
      expect(per).toEqual([1, 2, 3].map((i) => ({ uuid: IX.uuidN(i), n: 6 })));
    } finally { db.close(); }
  });

  it('DM2: one uuid with two bodies in one copy gives one entry and two variants', () => {
    const box = IX.newBox('ccrc-hist-dm2-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'body one', 1),
      IX.user(IX.uuidN(1), null, 'body two', 1),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries')).toBe(1);
      expect(IX.count(db, 'entry_variants')).toBe(2);
      expect(IX.count(db, 'memberships')).toBe(1);
      expect(counters(box)['variants_unknown']).toBe(1);
    } finally { db.close(); }
  });

  it('DM2b (store half): an empty-text gateway copy against the sanitised "..." copy is ccd-sanitize; any other difference is unknown', () => {
    const box = IX.newBox('ccrc-hist-dm2b-');
    const copy = (fill: string, last: string): string => IX.jsonl([
      IX.user(IX.uuidN(1), null, 'question', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'text', text: fill }, { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/home/u/tree/a.md' } }], 2, 'gpt-5'),
      IX.assistant(IX.uuidN(3), IX.uuidN(2), [{ type: 'text', text: last }], 3, 'gpt-5'),
    ]);
    IX.plantCopy(box.homes[3]!, IX.U, copy('', 'foo'));     // the gateway home's copy
    IX.plantCopy(box.homes[0]!, IX.U, copy('...', 'bar'));  // the Anthropic home's copy, sanitised by ccd on the carry
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      const v = (db.prepare(`SELECT e.uuid AS uuid, v.cause AS cause FROM entry_variants v
        JOIN entries e ON e.entry_id = v.entry_id ORDER BY e.uuid, v.blob_id`).all() as { uuid: string; cause: string }[])
        .map((r) => ({ uuid: r.uuid, cause: r.cause }));
      expect(v).toEqual([
        { uuid: IX.uuidN(2), cause: 'ccd-sanitize' }, { uuid: IX.uuidN(2), cause: 'ccd-sanitize' },
        { uuid: IX.uuidN(3), cause: 'unknown' }, { uuid: IX.uuidN(3), cause: 'unknown' },
      ]);
      const c = counters(box);
      expect(c['variants_sanitize']).toBe(1);
      expect(c['variants_unknown']).toBe(1);
    } finally { db.close(); }
  });

  it('DM3: 335 identical prompts with distinct uuids give 335 entries and one blob', () => {
    const box = IX.newBox('ccrc-hist-dm3-');
    const rows: IxRow[] = [];
    for (let i = 1; i <= 335; i += 1) rows.push(IX.user(IX.uuidN(i), i === 1 ? null : IX.uuidN(i - 1), 'run the tests', i));
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(rows));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries')).toBe(335);
      expect((db.prepare('SELECT count(DISTINCT blob_id) AS n FROM entries').get() as { n: number }).n).toBe(1);
      expect(IX.count(db, 'blobs')).toBe(1);
    } finally { db.close(); }
  });

  it('DM12: a thinking or redacted_thinking sentinel is in no decompressed blob', () => {
    const box = IX.newBox('ccrc-hist-dm12-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'think about it', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [
        { type: 'thinking', thinking: 'zq-thinking-sentinel', signature: 'c2lnbmF0dXJl' },
        { type: 'redacted_thinking', data: 'zq-redacted-sentinel' },
        { type: 'text', text: 'zq visible answer' },
      ], 2),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(IX.blobsHold(db, 'zq visible answer')).toBe(true);     // CONTROL: the scan reads real bodies
      expect(IX.blobsHold(db, 'zq-thinking-sentinel')).toBe(false);
      expect(IX.blobsHold(db, 'zq-redacted-sentinel')).toBe(false);
    } finally { db.close(); }
  });

  it('DM13 (store half): a uuid-less bridge-session row is stored nowhere and counted by type', () => {
    const ACCT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const box = IX.newBox('ccrc-hist-dm13-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'hello', 1),
      { type: 'bridge-session', sessionId: IX.U, accountUuid: ACCT, organizationUuid: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', timestamp: IX.ts(2) },
      IX.user(IX.uuidN(3), IX.uuidN(1), 'after the bridge row', 3),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries')).toBe(2);                         // CONTROL: the rows around it landed
      expect(IX.count(db, 'entries', "type = 'bridge-session'")).toBe(0);
      expect(IX.blobsHold(db, ACCT)).toBe(false);
      expect(IX.textColumnsHold(db, ACCT)).toEqual([]);
      expect(counters(box)['uuidless:bridge-session']).toBe(1);
    } finally { db.close(); }
  });

  it('DM24: an unknown row type with a uuid is stored, provenance harness, and counted', () => {
    const box = IX.newBox('ccrc-hist-dm24-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'hello', 1),
      { type: 'zq-mystery', uuid: IX.uuidN(2), parentUuid: IX.uuidN(1), timestamp: IX.ts(2), payload: 'zq mystery body' },
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      const r = db.prepare('SELECT type, provenance FROM entries WHERE uuid = ?').get(IX.uuidN(2)) as { type: string; provenance: string };
      expect({ type: r.type, provenance: r.provenance }).toEqual({ type: 'zq-mystery', provenance: 'harness' });
      expect(counters(box)['unknown_type']).toBe(1);
    } finally { db.close(); }
  });

  it('DM34: a malformed line stores the closed code json-parse, and no fragment of it in any TEXT column', () => {
    const box = IX.newBox('ccrc-hist-dm34-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'hello', 1),
      `{"type":"user","uuid":"${IX.uuidN(2)}","message": zqfragmentsentinel}`,
      IX.user(IX.uuidN(3), IX.uuidN(1), 'after the bad line', 3),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect((db.prepare('SELECT last_error_code AS c FROM ingest_files').get() as { c: string }).c).toBe('json-parse');
      // 'zqfrag', not the whole sentinel: V8's JSON.parse message quotes only about ten characters around the
      // fault (`…"message": zqfragment"…`), so a leaked message holds this prefix and never the full word.
      expect(IX.textColumnsHold(db, 'zqfrag')).toEqual([]);
      expect(IX.count(db, 'entries', "parse_state = 'raw-only'")).toBe(1);
      expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(3)}'`)).toBe(1);   // the cursor went past it
    } finally { db.close(); }
  });

  it('DM38 (store half): an assistant row keeps message.model verbatim, <synthetic> included; a user row stores NULL', () => {
    const box = IX.newBox('ccrc-hist-dm38-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'hello', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'text', text: 'hi' }], 2, 'claude-opus-4-1'),
      IX.assistant(IX.uuidN(3), IX.uuidN(2), [{ type: 'text', text: 'No response requested.' }], 3, '<synthetic>'),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      const m = (db.prepare('SELECT uuid, model FROM entries ORDER BY uuid').all() as { uuid: string; model: string | null }[])
        .map((r) => r.model);
      expect(m).toEqual([null, 'claude-opus-4-1', '<synthetic>']);
    } finally { db.close(); }
  });

  it('boundaries, api_block_index and the epoch launch facts: ord per transcript, the kept uuids as a blob, a missing field counted', () => {
    const box = IX.newBox('ccrc-hist-bnd-');
    // Two rows of ONE API response share a requestId (Claude Code writes a multi-block reply as several rows).
    const block = (uuid: string, parent: string, text: string, n: number): IxRow =>
      ({ ...IX.assistant(uuid, parent, [{ type: 'text', text }], n), requestId: 'req_shared01' });
    const kept = [IX.uuidN(1), IX.uuidN(2)];
    const seg = { headUuid: IX.uuidN(1), anchorUuid: IX.uuidN(2), tailUuid: IX.uuidN(3), allUuids: kept };
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'first prompt', 1),
      block(IX.uuidN(2), IX.uuidN(1), 'block zero', 2),
      block(IX.uuidN(3), IX.uuidN(2), 'block one', 3),
      boundaryRow({ uuid: IX.uuidN(4), parentUuid: IX.uuidN(3), ts: IX.ts(4), trigger: 'manual', ...seg }),
      boundaryRow({ uuid: IX.uuidN(5), parentUuid: IX.uuidN(4), ts: IX.ts(5), trigger: 'auto', ...seg, omit: ['preservedSegment'] }),
    ]));
    IX.sweepTwice(box);   // the scan's registry backfill chains U's epoch before the first chunk is written
    const db = openStoreRO(box);
    try {
      const b = db.prepare(`SELECT e.uuid AS uuid, b.ord AS ord, b.trigger AS trigger, b.head_uuid AS head, b.kept_blob_id AS kept
        FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id ORDER BY b.ord`).all() as
        { uuid: string; ord: number; trigger: string; head: string | null; kept: number | null }[];
      expect(b.map((r) => ({ uuid: r.uuid, ord: r.ord, trigger: r.trigger, head: r.head }))).toEqual([
        { uuid: IX.uuidN(4), ord: 1, trigger: 'manual', head: IX.uuidN(1) },
        { uuid: IX.uuidN(5), ord: 2, trigger: 'auto', head: null },
      ]);
      const z = (db.prepare('SELECT z FROM blobs WHERE blob_id = ?').get(b[0]!.kept) as { z: Uint8Array }).z;
      expect(JSON.parse(brotliDecompressSync(z).toString('utf8'))).toEqual(kept);
      expect(b[1]!.kept).toBe(b[0]!.kept);                                  // one blob for one kept list
      expect(counters(box)['boundary_field_missing']).toBe(1);               // only the boundary missing its segment
      const idx = (db.prepare("SELECT api_block_index AS i FROM entries WHERE request_id = 'req_shared01' ORDER BY uuid").all() as { i: number }[])
        .map((r) => r.i);
      expect(idx).toEqual([0, 1]);
      const ep = db.prepare('SELECT started_ms, cwd, git_branch FROM epochs WHERE cc_session_uuid = ?').get(IX.U) as
        { started_ms: number | null; cwd: string | null; git_branch: string | null };
      expect({ started: ep.started_ms, cwd: ep.cwd, branch: ep.git_branch }).toEqual({ started: IX.tsMs(1), cwd: '/home/u/tree', branch: 'main' });
    } finally { db.close(); }
  });

  it('§9.3 (BK17): a disk that fills after the pass began stops ingest at the next chunk, counted capture_paused_low_disk', () => {
    const box = IX.newBox('ccrc-hist-floor-spawn-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'held by the floor', 1)]));
    // The pass's own probe, the first statfs call, sees plenty (so planRun runs); every later call, the per-chunk
    // probe, sees 1 byte free of a 1 TiB filesystem (Step 12's preload block).
    IX.sweepTwice(box, { env: { HISTORY_TEST_STATFS_AFTER: `1:1:${2 ** 40}` } });
    const db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries')).toBe(0);
      expect(IX.count(db, 'ingest_files', '"offset" > 0')).toBe(0);
      expect(counters(box)['capture_paused_low_disk']).toBe(2);              // once per pass
    } finally { db.close(); }
  });

  it('O21: every blob is codec br5, its sha is sha256 of its bytes, and its z is the quality-5 output byte for byte', () => {
    const box = IX.newBox('ccrc-hist-o21-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'write me a long answer', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'text', text: IX.words(8000) }], 2),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      const rows = db.prepare('SELECT codec, sha256, z, raw_len FROM blobs').all() as { codec: string; sha256: Uint8Array; z: Uint8Array; raw_len: number }[];
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const b of rows) {
        expect(b.codec).toBe('br5');
        const raw = brotliDecompressSync(b.z);
        expect(raw.length).toBe(b.raw_len);
        expect(createHash('sha256').update(raw).digest().equals(Buffer.from(b.sha256))).toBe(true);
        const q5 = brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length } });
        expect(q5.equals(Buffer.from(b.z)), 'stored z is not the quality-5 output').toBe(true);
      }
    } finally { db.close(); }
  });

  it('O11: with history-off present the pass writes nothing: history.db and its WAL keep their mtimes', () => {
    const box = IX.newBox('ccrc-hist-o11-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'before the switch', 1)]));
    IX.sweepTwice(box);
    const dbFile = path.join(box.root, 'db', 'history.db');
    const stamp = (): number[] => [dbFile, `${dbFile}-wal`].map((f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1));
    const before = stamp();
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    fs.appendFileSync(p, IX.jsonl([IX.user(IX.uuidN(2), IX.uuidN(1), 'after the switch', 2)]));
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(stamp()).toEqual(before);
    const db = openStoreRO(box);
    try { expect(IX.count(db, 'entries')).toBe(1); } finally { db.close(); }
  });
});

describe('history ingest: chunk writes in-process (plan task 19)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  let S: IxSweep;
  let lib: typeof import('../../ccd/history/lib.mjs');
  beforeAll(async () => { ({ sweep: S, lib } = await IX.api()); });
  const parentOf = (db: DatabaseSync, uuid: string): string | null =>
    (db.prepare('SELECT parent_uuid AS p FROM entries WHERE uuid = ?').get(uuid) as { p: string | null }).p;

  it('DM4: structure comes from the copy with the larger mtime_ns; the older copy read second never overwrites it', async () => {
    const run = async (order: 'newer-first' | 'older-first'): Promise<string | null> => {
      const box = IX.newBox(`ccrc-hist-dm4-${order}-`);
      const text = (parent: string): string => IX.jsonl([IX.user(IX.uuidN(1), null, 'p', 1), IX.user(IX.uuidN(2), parent, 'q', 2)]);
      const older = IX.plantCopy(box.homes[0]!, IX.U, text('aaaaaaaa-0000-4000-8000-000000000001'));
      const newer = IX.plantCopy(box.homes[1]!, IX.U, text('bbbbbbbb-0000-4000-8000-000000000002'));
      fs.utimesSync(older, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
      fs.utimesSync(newer, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
        const files = [{ path: newer, uuid: IX.U, home: box.homes[1]! }, { path: older, uuid: IX.U, home: box.homes[0]! }];
        for (const f of order === 'newer-first' ? files : files.reverse()) await S.ingestPath(db, ctx, f, S.newBudget());
        expect(IX.count(db, 'entries')).toBe(2);
        expect(IX.count(db, 'entry_variants')).toBe(0);   // the bodies are equal: only structure differs
        return parentOf(db, IX.uuidN(2));
      } finally { db.close(); }
    };
    expect(await run('newer-first')).toBe('bbbbbbbb-0000-4000-8000-000000000002');
    expect(await run('older-first')).toBe('bbbbbbbb-0000-4000-8000-000000000002');
  });

  it('O1: a throw injected after the entry insert leaves no row of that chunk and the cursor where it was', async () => {
    const box = IX.newBox('ccrc-hist-o1-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2)]));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      // A connection whose memberships insert throws: the entry insert before it has already run
      // inside the chunk's transaction when it does. An in-process injected dependency, not a seam.
      const failing = new Proxy(db, {
        get(target, key) {
          if (key === 'prepare') {
            return (sql: string) => (/^\s*INSERT INTO memberships/.test(sql)
              ? { run: () => { throw new Error('injected: after the entry insert'); } }
              : target.prepare(sql));
          }
          const v = Reflect.get(target, key, target) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
      const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
      await expect(S.ingestPath(failing, ctx, { path: p, uuid: IX.U, home: box.homes[0]! }, S.newBudget())).rejects.toThrow(/injected/);
      expect(IX.count(db, 'entries')).toBe(0);
      expect(IX.count(db, 'blobs')).toBe(0);
      expect((db.prepare('SELECT offset FROM ingest_files').get() as { offset: number }).offset).toBe(0);
    } finally { db.close(); }
  });

  it('O2: a file gone before its read, a parser-module throw, and a half-written last line each leave the cursor unchanged', async () => {
    const box = IX.newBox('ccrc-hist-o2-');
    const first = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1)]);
    const p = IX.plantCopy(box.homes[0]!, IX.U, `${first}{"type":"user","uuid":"${IX.uuidN(2)}","mess`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
      const f = { path: p, uuid: IX.U, home: box.homes[0]! };
      // (c) the half-written last line: ingested up to the last '\n', never past it
      const r1 = await S.ingestPath(db, ctx, f, S.newBudget());
      expect(r1!.offset).toBe(Buffer.byteLength(first));
      expect(r1!.atEof).toBe(false);
      expect(IX.count(db, 'entries')).toBe(1);
      fs.appendFileSync(p, `age":{"role":"user","content":"two"},"timestamp":"${IX.ts(2)}"}\n`);
      // (b) a parser-module throw: counted, the cursor held, the code recorded
      const crashing = { ...ctx, prepareLines: (): never => { throw new Error('parser bug'); } };
      const r2 = await S.ingestPath(db, crashing, f, S.newBudget());
      expect(r2!.crashed).toBe(true);
      expect(IX.cursorOf(db, r2!.fileId)).toBe(Buffer.byteLength(first));
      expect((db.prepare('SELECT n FROM counters WHERE name = ?').get('parser_crash') as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT last_error_code AS c FROM ingest_files').get() as { c: string }).c).toBe('parser-crash');
      // (a) the file is gone before the next read: skipped, counted, the cursor untouched, and its row, which no
      // path names any more, is `gone` (Task 20 counts only live rows behind)
      fs.rmSync(p);
      expect(await S.ingestPath(db, ctx, f, S.newBudget())).toBeNull();
      expect(IX.cursorOf(db, r2!.fileId)).toBe(Buffer.byteLength(first));
      expect((db.prepare('SELECT n FROM counters WHERE name = ?').get('file_missing') as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT status FROM ingest_files WHERE file_id = ?').get(r2!.fileId) as { status: string }).status).toBe('gone');
    } finally { db.close(); }
  });

  it('O2b: a malformed line and a line over LINE_MAX are stored raw-only, byte for byte, and the cursor goes past both', async () => {
    const box = IX.newBox('ccrc-hist-o2b-');
    const bad = '{"type":"user","uuid": not json';
    const long = `{"pad":"${'a'.repeat(lib.LINE_MAX + 16)}"}`;
    const text = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), bad, long, IX.user(IX.uuidN(4), IX.uuidN(1), 'after both', 4)]);
    const p = IX.plantCopy(box.homes[0]!, IX.U, text);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const r = await S.ingestPath(db, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), { path: p, uuid: IX.U, home: box.homes[0]! }, S.newBudget());
      expect(r!.atEof).toBe(true);
      expect(r!.offset).toBe(Buffer.byteLength(text));
      expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(4)}'`)).toBe(1);
      // D-4237: a membership's `line` is the line's BYTE OFFSET, not a line number.
      const lastAt = Buffer.byteLength(text.slice(0, text.lastIndexOf(`{"parentUuid"`)));
      expect((db.prepare(`SELECT m.line AS line FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
        WHERE e.uuid = ?`).get(IX.uuidN(4)) as { line: number }).line).toBe(lastAt);
      const raws = db.prepare(`SELECT e.uuid AS uuid, b.z AS z FROM entries e JOIN blobs b ON b.blob_id = e.blob_id
        WHERE e.parse_state = 'raw-only' ORDER BY e.entry_id`).all() as { uuid: string; z: Uint8Array }[];
      expect(raws.map((x) => brotliDecompressSync(x.z).toString('utf8'))).toEqual([bad, long]);
      for (const x of raws) expect(x.uuid).toMatch(/^x[0-9a-f]{32}$/);
      expect((db.prepare('SELECT n FROM counters WHERE name = ?').get('raw_only') as { n: number }).n).toBe(2);
    } finally {
      db.close();
      fs.rmSync(box.home, { recursive: true, force: true });   // a 16 MiB line: never left for the file's afterAll alone
    }
  }, 120_000);

  it('O11: history-off created between two chunks stops the second chunk', async () => {
    const box = IX.newBox('ccrc-hist-o11b-');
    const rows: IxRow[] = [];
    for (let i = 1; i <= 40; i += 1) rows.push(IX.user(IX.uuidN(i), i === 1 ? null : IX.uuidN(i - 1), IX.words(40, i), i));
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(rows));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
      const realOff = ctx.historyOff;
      let calls = 0;
      // The real probe of the real file, which this wrapper creates when ingestFile asks for the
      // second time — that is, between chunk 1's commit and chunk 2's read.
      ctx.historyOff = () => {
        calls += 1;
        if (calls === 2) fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
        return realOff();
      };
      const r = await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: box.homes[0]! }, S.newBudget(Date.now, { chunkBytes: 4096 }));
      expect(r!.atEof).toBe(false);
      const n = IX.count(db, 'entries');
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(40);
      expect(IX.cursorOf(db, r!.fileId)).toBe(r!.offset);
    } finally { db.close(); }
  });

  it('§9.3 (BK17): the free-space floor is probed before every chunk; below it the file stops, counted once, the cursor at the last chunk', async () => {
    const box = IX.newBox('ccrc-hist-floor-');
    const rows: IxRow[] = [];
    for (let i = 1; i <= 40; i += 1) rows.push(IX.user(IX.uuidN(i), i === 1 ? null : IX.uuidN(i - 1), IX.words(40, i), i));
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(rows));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      let probes = 0;
      // An injected probe, as `tick` injects the real one: the floor holds for chunk 1, then the disk fills.
      const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids,
        async () => { probes += 1; return probes === 1 ? 'ok' : 'low-disk'; });
      const r = await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: box.homes[0]! }, S.newBudget(Date.now, { chunkBytes: 4096 }));
      expect(probes).toBe(2);
      expect(r!.atEof).toBe(false);
      expect(r!.floor).toBe('low-disk');
      const n = IX.count(db, 'entries');
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(40);
      expect(IX.cursorOf(db, r!.fileId)).toBe(r!.offset);
      expect((db.prepare('SELECT n FROM counters WHERE name = ?').get('capture_paused_low_disk') as { n: number }).n).toBe(1);
    } finally { db.close(); }
  });
});

interface IxSweep {
  recordTick(db: DatabaseSync, ctx: IxCtx, ing: IxTickResult | null): void;
  backfillEpochFacts(db: DatabaseSync, ctx: IxCtx): void;
}
const IX_RSS_PRELOAD = path.join(__dirname, 'fixtures', 'history', 'preload-rss.mjs');
/** O20's bound on the real sweep's peak RSS, in KiB. The spec's 256 MiB is asserted on the floor interpreter, 22.16.0
 *  (the node-floor CI leg's), where this pass measured 172884 KiB with 2 MiB chunks, and 247412 KiB with 4 MiB chunks once
 *  task 23 indexes inline. Node 24.14.1 measured 216676 to 270240 KiB for the same pass under load, more after task 23, and
 *  smaller chunks do not bring it under 256 MiB, so any other interpreter is held to 512 MiB, half the carrier's
 *  MemoryMax=1G (D-4244). DM47 (task 21) uses the same bound. */
const IX_RSS_BOUND_KIB = process.version === 'v22.16.0' ? 256 * 1024 : 512 * 1024;

describe('history ingest: budget, backlog and the ticks row (plan task 20)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  let S: IxSweep;
  let lib: typeof import('../../ccd/history/lib.mjs');
  beforeAll(async () => { ({ sweep: S, lib } = await IX.api()); });
  /** `n` rows of about 1.2 KB each, with distinct bodies and uuids from `base`. */
  const backlog = (n: number, base = 0): string => {
    const rows: IxRow[] = [];
    for (let i = 1; i <= n; i += 1) rows.push(IX.user(IX.uuidN(base + i), i === 1 ? null : IX.uuidN(base + i - 1), IX.words(150, base + i), i));
    return IX.jsonl(rows);
  };
  const drain = async (db: DatabaseSync, box: HistoryBox, ids: IxIds, size: number, limits: { maxBytes: number; chunkBytes: number }): Promise<number[]> => {
    const offsets: number[] = [];
    for (let tick = 1; tick <= 60; tick += 1) {
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + tick * 120_000, ids);
      await S.ingestTick(db, ctx, S.newBudget(Date.now, limits));
      offsets.push((db.prepare('SELECT offset FROM ingest_files').get() as { offset: number }).offset);
      if (offsets[offsets.length - 1] === size) break;
    }
    return offsets;
  };
  /** One in-process tick at `nowMs` with its ticks row; answers that row's files_behind. */
  const tickBehind = async (db: DatabaseSync, box: HistoryBox, ids: IxIds, nowMs: number, limits?: { maxBytes: number; chunkBytes: number }): Promise<number> => {
    const ctx = S.makeIngestCtx(box.home, box.homes, nowMs, ids);
    S.recordTick(db, ctx, await S.ingestTick(db, ctx, S.newBudget(Date.now, limits)));
    return (db.prepare('SELECT files_behind AS n FROM ticks ORDER BY tick_id DESC LIMIT 1').get() as { n: number }).n;
  };
  const counterOf = (db: DatabaseSync, name: string): number | undefined =>
    (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;

  it('a tick writes one ticks row: bytes read, the lag of the oldest new row of a resumed file (none for a first read), files and bytes behind; eof_ms and last_zero_behind_ms follow', async () => {
    const box = IX.newBox('ccrc-hist-tick-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2)]));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 600_000;
      const tick = async (nowMs: number, limits?: { maxBytes: number; chunkBytes: number }): Promise<void> => {
        const ctx = S.makeIngestCtx(box.home, box.homes, nowMs, ids);
        S.recordTick(db, ctx, await S.ingestTick(db, ctx, S.newBudget(Date.now, limits)));
      };
      const sizeA = fs.statSync(p).size;
      const tD = t0 + lib.SCAN_INTERVAL_MS + 1_000;
      await tick(t0);                                                    // A: both rows new, but a first read: lag unmeasured
      await tick(t0 + 120_000);                                          // B: nothing new
      S.recordTick(db, S.makeIngestCtx(box.home, box.homes, t0 + 240_000, ids), null);   // C: a paused tick
      fs.appendFileSync(p, backlog(3, 100));
      await tick(tD, { maxBytes: 1, chunkBytes: 64 });                   // D: the scan resumes the file; one line, then the budget
      const rows = (db.prepare('SELECT ts_ms, lag_ms, bytes, files_behind, bytes_behind FROM ticks ORDER BY tick_id').all() as
        { ts_ms: number; lag_ms: number | null; bytes: number; files_behind: number; bytes_behind: number }[])
        .map((r) => ({ ts: r.ts_ms, lag: r.lag_ms, bytes: r.bytes, fb: r.files_behind, bb: r.bytes_behind }));
      const size = fs.statSync(p).size;
      const off = (db.prepare('SELECT offset FROM ingest_files').get() as { offset: number }).offset;
      expect(rows.slice(0, 3)).toEqual([
        { ts: t0, lag: null, bytes: sizeA, fb: 0, bb: 0 },
        { ts: t0 + 120_000, lag: 0, bytes: 0, fb: 0, bb: 0 },
        { ts: t0 + 240_000, lag: null, bytes: 0, fb: 0, bb: 0 },
      ]);
      // D's one new row is backlog's first, stamped IX.ts(1), read from a resumed file
      expect(rows[3]).toMatchObject({ ts: tD, lag: tD - IX.tsMs(1), fb: 1, bb: size - off });
      // tick A left the file at end-of-file; B examined nothing (no hint, no scan, not behind);
      // D examined it and left it short, which keeps the old mark
      expect((db.prepare('SELECT eof_ms FROM ingest_files').get() as { eof_ms: number }).eof_ms).toBe(t0);
      expect((db.prepare("SELECT v FROM meta WHERE k = 'last_zero_behind_ms'").get() as { v: string }).v).toBe(String(t0 + 240_000));
      expect(journalRecords(box)).toContainEqual(expect.objectContaining({ k: 'tick', t: tD, lag_ms: tD - IX.tsMs(1) }));
    } finally { db.close(); }
  });

  it('O4: a backlog twelve times the run byte budget drains over at least ten ticks: monotone cursor, no duplicates', async () => {
    const box = IX.newBox('ccrc-hist-o4-');
    const text = backlog(400);
    const size = Buffer.byteLength(text);
    IX.plantCopy(box.homes[0]!, IX.U, text);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const offsets = await drain(db, box, ids, size, { maxBytes: Math.floor(size / 12), chunkBytes: 1024 });
      expect(offsets[offsets.length - 1]).toBe(size);
      expect(offsets.length).toBeGreaterThanOrEqual(10);
      for (let i = 1; i < offsets.length; i += 1) expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
      expect(IX.count(db, 'entries')).toBe(400);
      expect(IX.count(db, 'memberships')).toBe(400);
    } finally { db.close(); }
  });

  it('O5: one budget for the run: a clock past 90 s after file 1 defers files 2..n to the next tick', async () => {
    const box = IX.newBox('ccrc-hist-o5-');
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    plantSession(box, 'claude-demo3', { uuid: IX.U3, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    [IX.U, IX.U2, IX.U3].forEach((u, k) => IX.plantCopy(box.homes[0]!, u, IX.jsonl([IX.user(IX.uuidN(10 * k + 1), null, `session ${k}`, 1)])));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = 1_000_000;
      // The run's clock reads 91 s later as soon as any entry is committed: after file 1's chunk.
      const clock = (): number => (IX.count(db, 'entries') > 0 ? t0 + 91_000 : t0);
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(clock));
      expect(IX.count(db, 'ingest_files')).toBe(1);
      expect((db.prepare('SELECT count(DISTINCT transcript_pk) AS n FROM entries').get() as { n: number }).n).toBe(1);
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget());
      expect(IX.count(db, 'ingest_files')).toBe(3);   // the cut-short scan ran again
    } finally { db.close(); }
  });

  it('O20 (ticks): a file three times the run byte budget is captured over three or more ticks with a monotone cursor', async () => {
    const box = IX.newBox('ccrc-hist-o20a-');
    const text = backlog(90);
    const size = Buffer.byteLength(text);
    IX.plantCopy(box.homes[0]!, IX.U, text);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const offsets = await drain(db, box, ids, size, { maxBytes: Math.ceil(size / 3), chunkBytes: 1024 });
      expect(offsets[offsets.length - 1]).toBe(size);
      expect(offsets.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < offsets.length; i += 1) expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
      expect(IX.count(db, 'entries')).toBe(90);
    } finally { db.close(); }
  });

  it('O20 (memory): a 96 MiB transcript is captured by the real sweep with peak RSS under O20\'s bound', () => {
    const box = IX.newBox('ccrc-hist-o20b-');
    try {
      const dir = path.join(box.homes[0]!, 'projects', IX.SLUG);
      fs.mkdirSync(dir, { recursive: true });
      const fd = fs.openSync(path.join(dir, `${IX.U}.jsonl`), 'w');
      let rows = 0;
      try {
        for (let size = 0, i = 1; size < 96 * 1024 * 1024; i += 1) {
          const line = `${JSON.stringify(IX.user(IX.uuidN(i), i === 1 ? null : IX.uuidN(i - 1), IX.words(600, i), i))}\n`;
          fs.writeSync(fd, line);
          size += Buffer.byteLength(line);
          rows = i;
        }
      } finally { fs.closeSync(fd); }
      let peak = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        const r = runSweep(box, [], { preloads: [IX_RSS_PRELOAD] });
        expect(r.code, r.stderr).toBe(0);
        const m = /history-test-maxrss-kib=(\d+)/.exec(r.stderr);
        expect(m, 'the RSS preload printed nothing').not.toBeNull();
        peak = Math.max(peak, Number(m![1]));
      }
      const db = openStoreRO(box);
      try { expect(IX.count(db, 'entries')).toBe(rows); } finally { db.close(); }
      console.log(`O20 peak RSS ${peak} KiB on ${process.version}`);   // the reading the commit records (task 20 step 11)
      expect(peak).toBeLessThan(IX_RSS_BOUND_KIB);
    } finally {
      fs.rmSync(box.home, { recursive: true, force: true });   // 96 MiB plus its store: never left for the file's afterAll alone
    }
  }, 300_000);

  it('O22: a write lock held past busy_timeout ends the tick with no partial chunk, and the next tick ingests', async () => {
    const box = IX.newBox('ccrc-hist-o22-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'held', 1)]));
    const { db, ids } = await IX.openFixtureStore(box);
    const holder = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      `import { DatabaseSync } from 'node:sqlite';
       const d = new DatabaseSync(${JSON.stringify(lib.historyPaths(box.home).dbFile)});
       d.exec('BEGIN IMMEDIATE'); process.stdout.write('held\\n'); setInterval(() => {}, 1000);`],
      { stdio: ['ignore', 'pipe', 'ignore'], env: box.env, cwd: box.home });
    const exited = new Promise((resolve) => { holder.once('exit', resolve); });
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout!.once('data', () => resolve());
        void exited.then(() => reject(new Error('the lock holder exited before it held the lock')));
      });
      // This connection waits 300 ms rather than the writer's 30 s: a setting on the test's own
      // connection, not a shipped seam. The sweep's answer to SQLITE_BUSY is what is under test.
      db.exec('PRAGMA busy_timeout = 300');
      const r = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
      expect(r.busy).toBe(true);
    } finally {
      holder.kill('SIGKILL');
      await exited;
    }
    try {
      expect(IX.count(db, 'entries')).toBe(0);
      expect(IX.count(db, 'blobs')).toBe(0);
      const r2 = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget());
      expect(r2.busy).toBe(false);
      expect(IX.count(db, 'entries')).toBe(1);
    } finally { db.close(); }
  });

  it('a uuid named only by a spool hint is ingested on the next pass, with no periodic scan due', () => {
    const box = IX.newBox('ccrc-hist-hint-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'first session', 1)]));
    IX.sweepTwice(box);                                    // the scan has run; the next is 30 min away
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'second session', 21)]));
    fs.mkdirSync(path.join(box.root, 'spool'), { recursive: true });
    spoolLine(box, 'claude-demo2', { v: 1, ev: 'Stop', id: 'claude-demo2' });
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    const db = openStoreRO(box);
    try { expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(21)}'`)).toBe(1); } finally { db.close(); }
  });

  it('a FIFO at a hinted id\'s .uuid never wedges the pass (D-4299)', () => {
    const box = IX.newBox('ccrc-hist-hint-fifo-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'first session', 1)]));
    IX.sweepTwice(box);                                    // the scan has run; the next is 30 min away
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'second session', 21)]));
    // The id's .uuid is a FIFO with no writer: a bare open(2) of it blocks for ever, which no run budget can interrupt.
    const uuidFile = path.join(box.reg, 'claude-demo2.uuid');
    fs.rmSync(uuidFile);
    expect(spawnSync('mkfifo', [uuidFile]).status).toBe(0);
    spoolLine(box, 'claude-demo2', { v: 1, ev: 'Stop', id: 'claude-demo2' });
    const r = runSweep(box, [], { timeoutMs: 5000 });
    expect(r.code, 'hint read blocked on a FIFO').toBe(0);
    const db = openStoreRO(box);
    try { expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(21)}'`)).toBe(0); } finally { db.close(); }   // a FIFO hints nothing
  });

  it('behind counts only what a later tick can read: a copy replaced at its path by a new inode is not behind', async () => {
    const box = IX.newBox('ccrc-hist-behind-repl-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, backlog(4));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      expect(await tickBehind(db, box, ids, t0, { maxBytes: 1, chunkBytes: 64 })).toBe(1);   // CONTROL: one line read, behind
      // A carry's `cp --remove-destination`: a new inode at the same path. The old inode stays allocated under another
      // name outside projects/, so the new file cannot reuse its number and the old row keeps its own identity.
      fs.renameSync(p, path.join(box.home, 'held-inode'));
      fs.writeFileSync(p, backlog(2, 10));
      expect(await tickBehind(db, box, ids, t0 + 120_000)).toBe(0);
      expect(IX.count(db, 'ingest_files')).toBe(2);                                          // the old row stays, pathless
    } finally { db.close(); }
  });

  it('behind counts only what a later tick can read: a deleted copy is gone, counted file_missing once, and not behind', async () => {
    const box = IX.newBox('ccrc-hist-behind-del-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, backlog(4));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      expect(await tickBehind(db, box, ids, t0, { maxBytes: 1, chunkBytes: 64 })).toBe(1);   // CONTROL: behind
      fs.rmSync(p);
      expect(await tickBehind(db, box, ids, t0 + 120_000)).toBe(0);
      expect(await tickBehind(db, box, ids, t0 + 240_000)).toBe(0);
      expect(counterOf(db, 'file_missing')).toBe(1);        // a gone row is not re-read every tick
    } finally { db.close(); }
  });

  it('behind counts only what a later tick can read: a tail with no newline that nobody wrote for a scan interval is not behind', async () => {
    const box = IX.newBox('ccrc-hist-behind-torn-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, `${backlog(2)}{"type":"user","uuid":"${IX.uuidN(9)}","mess`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const now = Date.now();
      // CONTROL: a tail written just now may still be finished, so the file is behind
      expect(await tickBehind(db, box, ids, now)).toBe(1);
      const stale = new Date(now - 2 * lib.SCAN_INTERVAL_MS);
      fs.utimesSync(p, stale, stale);
      expect(await tickBehind(db, box, ids, now + 120_000)).toBe(0);
      expect(IX.count(db, 'entries')).toBe(2);
    } finally { db.close(); }
  });

  it('behind counts only what a later tick can read: a copy whose home left the roster is not behind, and an unreadable roster (no homes) is not a reassuring zero (D-4309)', async () => {
    const box = IX.newBox('ccrc-hist-behind-unrostered-');
    IX.plantCopy(box.homes[0]!, IX.U, backlog(4));
    const { db, ids } = await IX.openFixtureStore(box);
    const lastZero = (): string | undefined => (db.prepare("SELECT v FROM meta WHERE k = 'last_zero_behind_ms'").get() as { v: string } | undefined)?.v;
    const lastRow = (): { n: number; b: number } =>
      db.prepare('SELECT files_behind AS n, bytes_behind AS b FROM ticks ORDER BY tick_id DESC LIMIT 1').get() as { n: number; b: number };
    try {
      const t0 = IX.tsMs(0) + 60_000;
      expect(await tickBehind(db, box, ids, t0, { maxBytes: 1, chunkBytes: 64 })).toBe(1);   // CONTROL: rostered, one line read, behind
      const bytesBehind = lastRow().b;
      expect(bytesBehind).toBeGreaterThan(0);
      expect(lastZero()).toBeUndefined();
      // No homes: the roster could not be read, so nothing says the path is un-rostered. Still behind, lag not advanced.
      S.recordTick(db, S.makeIngestCtx(box.home, [], t0 + 60_000, ids), null);
      expect(lastRow()).toEqual({ n: 1, b: bytesBehind });
      expect(lastZero()).toBeUndefined();
      // The only path sits under a home the roster no longer lists: never read again, so not behind for good.
      S.recordTick(db, S.makeIngestCtx(box.home, [box.homes[1]!], t0 + 120_000, ids), null);
      expect(lastRow()).toEqual({ n: 0, b: 0 });
      expect(lastZero()).toBe(String(t0 + 120_000));
    } finally { db.close(); }
  });

  it('DM20 (cursor clause): two hardlinked paths of one transcript in two homes bind one row, and the cursor advances once', async () => {
    const box = IX.newBox('ccrc-hist-dm20c-');
    const text = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2)]);
    const p = IX.plantCopy(box.homes[0]!, IX.U, text);
    const dir1 = path.join(box.homes[1]!, 'projects', IX.SLUG);
    fs.mkdirSync(dir1, { recursive: true });
    const q = path.join(dir1, `${IX.U}.jsonl`);
    fs.linkSync(p, q);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
      const b = S.newBudget();
      const r1 = await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: box.homes[0]! }, b);
      const r2 = await S.ingestPath(db, ctx, { path: q, uuid: IX.U, home: box.homes[1]! }, b);
      expect(r2!.fileId).toBe(r1!.fileId);
      expect({ first: r1!.bytes, second: r2!.bytes, run: b.bytes }).toEqual({ first: Buffer.byteLength(text), second: 0, run: Buffer.byteLength(text) });
      expect(IX.count(db, 'ingest_files')).toBe(1);
      expect(IX.count(db, 'file_paths')).toBe(2);
      expect(IX.count(db, 'memberships')).toBe(2);
      expect(IX.cursorOf(db, r1!.fileId)).toBe(Buffer.byteLength(text));
    } finally { db.close(); }
  });

  it('a session read before its epoch is chained still gets its launch facts once the epoch confirms', () => {
    const box = IX.newBox('ccrc-hist-facts-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'first session', 1)]));
    IX.sweepTwice(box);                                    // the scan has run; the next is 30 min away
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'second session', 21)]));
    spoolLine(box, 'claude-demo2', { v: 1, ev: 'SessionStart', id: 'claude-demo2', sid: IX.U2, src: 'startup', reg: IX.U2 });
    // Pass N renames the startup line and, hinted by its id's $REG uuid, reads U2's transcript from 0 before any U2
    // epoch exists. Pass N+1 drains the line, which chains and confirms U2's epoch, with the transcript at its end.
    for (let i = 0; i < 2; i += 1) { const r = runSweep(box); expect(r.code, r.stderr).toBe(0); }
    const db = openStoreRO(box);
    try {
      const ep = db.prepare('SELECT started_ms, cwd, git_branch, confirmed_ms FROM epochs WHERE cc_session_uuid = ?').get(IX.U2) as
        { started_ms: number | null; cwd: string | null; git_branch: string | null; confirmed_ms: number | null };
      expect(ep.confirmed_ms).not.toBeNull();             // CONTROL: the epoch was chained and confirmed
      expect({ started: ep.started_ms, cwd: ep.cwd, branch: ep.git_branch })
        .toEqual({ started: IX.tsMs(21), cwd: '/home/u/tree', branch: 'main' });
    } finally { db.close(); }
  });

  it('an EIO on an admitted transcript\'s first-row read skips that epoch, leaves it factless and starves no other (D-4298, Task 20F)', async () => {
    // readSync cannot be faulted in a spawned pass (the faults preload has no read event), so the read is faulted in
    // this process: node:fs's readSync is replaced for one descriptor and syncBuiltinESMExports() carries it to
    // sweep.mjs's named import.
    const box = IX.newBox('ccrc-hist-facts-eio-');
    const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'unreadable', 1)]));
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'readable', 21)]));
    const { db, ids } = await IX.openFixtureStore(box);
    const realRead = fs.readSync;
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
      const b = S.newBudget();
      for (const [uuid, name] of [[IX.U, bad], [IX.U2, path.join(path.dirname(bad), `${IX.U2}.jsonl`)]] as const) {
        await S.ingestPath(db, ctx, { path: name, uuid, home: box.homes[0]! }, b);
      }
      // Two confirmed epochs, each holding no launch fact, each with a transcript a cursor has read from.
      db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'claude-demo', 'g1', 'demo', 1), (2, 'claude-demo2', 'g2', 'demo', 1)").run();
      db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'spool', 1), (2, 1, ?, 'startup', 'spool', 1)").run(IX.U, IX.U2);
      const factsOf = (uuid: string) => db.prepare('SELECT started_ms AS startedMs, cwd, git_branch AS branch FROM epochs WHERE cc_session_uuid = ?').get(uuid);
      const none = { startedMs: null, cwd: null, branch: null };
      expect(factsOf(IX.U)).toEqual(none);                 // CONTROL: both epochs start factless
      expect(factsOf(IX.U2)).toEqual(none);
      const eio = Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO', errno: -5, syscall: 'read' });
      let faulted = 0;
      (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
        if (fs.readlinkSync(`/proc/self/fd/${fd}`) === bad) { faulted += 1; throw eio; }
        return (realRead as (...a: unknown[]) => number)(fd, ...rest);
      };
      syncBuiltinESMExports();
      try {
        expect(() => S.backfillEpochFacts(db, ctx)).not.toThrow();   // the error never leaves the step, so the tick goes on
      } finally {
        (fs as { readSync: unknown }).readSync = realRead;
        syncBuiltinESMExports();
      }
      expect(faulted, 'the fault never fired: the unreadable epoch was not tried').toBe(1);
      expect(factsOf(IX.U)).toEqual(none);                 // the epoch it could not read stays factless
      expect(factsOf(IX.U2)).toEqual({ startedMs: IX.tsMs(21), cwd: '/home/u/tree', branch: 'main' });   // the other still got its facts
    } finally { (fs as { readSync: unknown }).readSync = realRead; syncBuiltinESMExports(); db.close(); }
  });
});

describe('history ingest: sidecars (plan task 21)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const sideDir = (home: string, uuid = IX.U): string => {
    const d = path.join(home, 'projects', IX.SLUG, uuid, 'tool-results');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  /** The transcript the linkage cases share: a Bash result whose text names one file, a Read result whose id names another. */
  const linkRows = (): string => IX.jsonl([
    IX.user(IX.uuidN(1), null, 'go', 1),
    IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'tool_use', id: 'toolu_01AAA', name: 'Bash', input: { command: 'make big-output' } }], 2),
    IX.user(IX.uuidN(3), IX.uuidN(2), [{ type: 'tool_result', tool_use_id: 'toolu_01AAA', content: 'Output too large. Full output saved to: /home/u/x/tool-results/b7k2q9z1x.txt' }], 3),
    IX.assistant(IX.uuidN(4), IX.uuidN(3), [{ type: 'tool_use', id: 'toolu_01BBB', name: 'Read', input: { file_path: '/home/u/tree/a.png' } }], 4),
    IX.user(IX.uuidN(5), IX.uuidN(4), [{ type: 'tool_result', tool_use_id: 'toolu_01BBB', content: 'short' }], 5),
  ]);
  const sidecarRows = (db: DatabaseSync): { name: string; uuid: string | null }[] =>
    (db.prepare(`SELECT s.name AS name, e.uuid AS uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id
      ORDER BY s.name, s.blob_id`).all() as { name: string; uuid: string | null }[]).map((r) => ({ name: r.name, uuid: r.uuid }));
  const counterOf = (db: DatabaseSync, name: string): number | undefined =>
    (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;

  it('DM47: sidecars under every home are captured, linked by name or toolu_ id; differing copies sit side by side; an unnamed one is counted', () => {
    const box = IX.newBox('ccrc-hist-dm47-');
    IX.plantCopy(box.homes[0]!, IX.U, linkRows());
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b7k2q9z1x.txt'), 'the big output body\n');
    fs.writeFileSync(path.join(sideDir(box.homes[1]!), 'toolu_01BBB.json'), '{"image":"zq"}\n');   // a home with no <uuid>.jsonl
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'same.txt'), 'copy in home zero\n');
    fs.writeFileSync(path.join(sideDir(box.homes[1]!), 'same.txt'), 'copy in home one\n');
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'zz-orphan.txt'), 'nobody names me\n');
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(sidecarRows(db)).toEqual([
        { name: 'b7k2q9z1x.txt', uuid: IX.uuidN(3) },
        { name: 'same.txt', uuid: null }, { name: 'same.txt', uuid: null },
        { name: 'toolu_01BBB.json', uuid: IX.uuidN(5) },
        { name: 'zz-orphan.txt', uuid: null },
      ]);
      expect(IX.blobsHold(db, 'copy in home zero')).toBe(true);
      expect(IX.blobsHold(db, 'copy in home one')).toBe(true);
      expect(counters(box)['sidecar_unlinked']).toBe(3);
    } finally { db.close(); }
  });

  it('DM47: a changed (size, mtime_ns) is re-hashed into a new row beside the old; an unchanged one is never re-read', () => {
    const box = IX.newBox('ccrc-hist-dm47b-');
    IX.plantCopy(box.homes[0]!, IX.U, linkRows());
    const zero = path.join(sideDir(box.homes[0]!), 'same.txt');
    const one = path.join(sideDir(box.homes[1]!), 'same.txt');
    fs.writeFileSync(zero, 'copy in home zero\n');
    fs.writeFileSync(one, 'copy in home one\n');
    IX.sweepTwice(box);
    fs.appendFileSync(zero, 'and a second line\n');   // a changed size: re-hashed
    fs.chmodSync(one, 0o000);                         // unchanged (size, mtime_ns): opening it now would fail
    fs.mkdirSync(path.join(box.root, 'spool'), { recursive: true });
    spoolLine(box, IX.ID, { v: 1, ev: 'Stop', id: IX.ID });   // the hint that re-examines this uuid next pass
    const r = runSweep(box);
    fs.chmodSync(one, 0o644);
    expect(r.code, r.stderr).toBe(0);
    const db = openStoreRO(box);
    try {
      expect(sidecarRows(db).filter((x) => x.name === 'same.txt')).toHaveLength(3);
      expect(IX.blobsHold(db, 'and a second line')).toBe(true);
      expect(counters(box)['file_unreadable']).toBeUndefined();
    } finally { db.close(); }
  });

  it('a transcript still behind defers its sidecars, so a sidecar named by a row not yet read is linked once its copy is caught up', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47c-');
    const head = IX.jsonl([
      IX.user(IX.uuidN(1), null, 'go', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'tool_use', id: 'toolu_01CCC', name: 'Bash', input: { command: 'make late' } }], 2),
    ]);
    const naming = JSON.stringify(IX.user(IX.uuidN(3), IX.uuidN(2), [{ type: 'tool_result', tool_use_id: 'toolu_01CCC', content: 'saved to: /home/u/x/tool-results/late01.txt' }], 3));
    const p = IX.plantCopy(box.homes[0]!, IX.U, `${head}${naming.slice(0, 40)}`);   // the naming row is still being written
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'late01.txt'), 'late body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
      expect(IX.count(db, 'sidecars')).toBe(0);
      fs.appendFileSync(p, `${naming.slice(40)}\n`);
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget());
      expect(sidecarRows(db)).toEqual([{ name: 'late01.txt', uuid: IX.uuidN(3) }]);
    } finally { db.close(); }
  });

  it('a copy that can never catch up (deleted while still short) does not hold its uuid\'s sidecars back', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47e-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, linkRows());
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b7k2q9z1x.txt'), 'the big output body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      // one line read, then the budget: the copy is short of its end
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1, chunkBytes: 64 }));
      expect(IX.count(db, 'sidecars')).toBe(0);
      fs.rmSync(p);
      // its row is gone now (Task 19), and nothing will ever catch it up: the sidecar is taken, unlinked, because the
      // row that names it was never read
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget());
      expect(sidecarRows(db)).toEqual([{ name: 'b7k2q9z1x.txt', uuid: null }]);
    } finally { db.close(); }
  });

  it('a copy whose home left the roster does not hold its uuid\'s sidecars back (D-4309: caught up counts only rows a rostered home still holds)', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47f-');
    IX.plantCopy(box.homes[0]!, IX.U, linkRows());
    fs.writeFileSync(path.join(sideDir(box.homes[1]!), 'b7k2q9z1x.txt'), 'the big output body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      // home 0's copy is read one line deep, then the budget: it is short and a path under home 0 names it
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1, chunkBytes: 64 }));
      // a scan later (past the 30 min interval), home 0 unrostered: nothing a rostered home holds is short, so the sidecar under home 1 is taken
      const rest = box.homes.slice(1);
      await S.ingestTick(db, S.makeIngestCtx(box.home, rest, IX.tsMs(0) + 60_000 + 2_000_000, ids), S.newBudget());
      expect(sidecarRows(db)).toEqual([{ name: 'b7k2q9z1x.txt', uuid: null }]);
    } finally { db.close(); }
  });

  it('sidecar floor (par 9.3, BK17): below the floor a sidecar is not read, the stop is counted once and reported paused, the next ok tick takes it', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47g-');
    IX.plantCopy(box.homes[0]!, IX.U, linkRows());
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const at = (k: number): number => IX.tsMs(0) + 60_000 + k * 2_000_000;   // each tick is past the 30 min scan interval
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at(0), ids), S.newBudget());   // the transcript is caught up, no sidecar yet
      fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b7k2q9z1x.txt'), 'the big output body\n');
      const low = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at(1), ids, async () => 'low-disk'), S.newBudget());
      expect(low.paused).toBe(true);
      expect(IX.count(db, 'sidecars')).toBe(0);
      expect(IX.count(db, 'sidecar_seen')).toBe(0);              // a file the floor stopped is never marked seen
      expect(counterOf(db, 'capture_paused_low_disk')).toBe(1);   // the caught-up transcript never probes: this is the sidecar's own stop
      // a sidecar half the floor cut short leaves the scan unmarked, so the next tick scans (and takes the sidecar) again
      expect((db.prepare("SELECT v FROM meta WHERE k = 'scan_discover_ms'").get() as { v: string }).v).toBe(String(at(0)));
      const unsettled = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at(2), ids, async () => 'unsettled'), S.newBudget());
      expect(unsettled.paused).toBe(true);
      expect(counterOf(db, 'capture_paused_low_disk')).toBe(1);   // an unsettled probe is uncounted
      const ok = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at(3), ids), S.newBudget());
      expect(ok.paused).toBe(false);
      expect(sidecarRows(db)).toEqual([{ name: 'b7k2q9z1x.txt', uuid: IX.uuidN(3) }]);
    } finally { db.close(); }
  });

  it('ingestSidecars stops, unpaused and incomplete, when history is switched off or the run budget is spent', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47h-');
    IX.plantCopy(box.homes[0]!, IX.U, linkRows());
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b7k2q9z1x.txt'), 'the big output body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // transcript in, sidecar not yet: sidecar_seen empty
      db.exec('DELETE FROM sidecars; DELETE FROM sidecar_seen');
      const off = { ...S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), historyOff: () => true };
      expect(await S.ingestSidecars(db, off, S.newBudget(), [IX.U])).toEqual({ bytes: 0, complete: false, paused: false });
      const spent = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids);
      expect(await S.ingestSidecars(db, spent, S.newBudget(Date.now, { maxBytes: 0 }), [IX.U])).toEqual({ bytes: 0, complete: false, paused: false });
      expect(IX.count(db, 'sidecars')).toBe(0);
      expect(await S.ingestSidecars(db, spent, S.newBudget(), [IX.U])).toMatchObject({ complete: true, paused: false });
      expect(IX.count(db, 'sidecars')).toBe(1);
    } finally { db.close(); }
  });

  it('DM47: a 64 MiB sidecar is read whole and a larger one streamed, both byte for byte, with peak RSS under O20\'s bound', () => {
    const box = IX.newBox('ccrc-hist-dm47d-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, linkRows());
      const write = (p: string, size: number): Buffer => {
        const fd = fs.openSync(p, 'w');
        const hash = createHash('sha256');
        try {
          for (let at = 0, k = 1; at < size; k += 1) {
            const piece = Buffer.from(IX.words(4000, k)).subarray(0, size - at);
            fs.writeSync(fd, piece);
            hash.update(piece);
            at += piece.length;
          }
        } finally { fs.closeSync(fd); }
        return hash.digest();
      };
      const dir = sideDir(box.homes[0]!);
      const whole = write(path.join(dir, 'whole64.txt'), 67_108_864);
      const streamed = write(path.join(dir, 'streamed.txt'), 67_108_864 + 4096);
      let peak = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        const r = runSweep(box, [], { preloads: [IX_RSS_PRELOAD] });
        expect(r.code, r.stderr).toBe(0);
        peak = Math.max(peak, Number(/history-test-maxrss-kib=(\d+)/.exec(r.stderr)?.[1] ?? 'NaN'));
      }
      const db = openStoreRO(box);
      try {
        const got = (name: string): { sha: Buffer; len: number } => {
          const r = db.prepare(`SELECT b.sha256 AS sha, b.raw_len AS len FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id
            WHERE s.name = ?`).get(name) as { sha: Uint8Array; len: number };
          return { sha: Buffer.from(r.sha), len: r.len };
        };
        expect(got('whole64.txt')).toEqual({ sha: whole, len: 67_108_864 });
        expect(got('streamed.txt')).toEqual({ sha: streamed, len: 67_108_864 + 4096 });
      } finally { db.close(); }
      console.log(`DM47 peak RSS ${peak} KiB on ${process.version}`);
      expect(peak).toBeLessThan(IX_RSS_BOUND_KIB);
    } finally {
      fs.rmSync(box.home, { recursive: true, force: true });   // two 64 MiB sidecars plus their store: never left for afterAll alone
    }
  }, 300_000);

  describe('SIDECAR_MAX_BYTES (D-4310, history-sidecar-size-cap)', () => {
    /** A sidecar of `size` bytes that holds no data on disk: ftruncate leaves a hole. */
    const sparse = (p: string, size: number): void => {
      const fd = fs.openSync(p, 'w');
      try { fs.ftruncateSync(fd, size); } finally { fs.closeSync(fd); }
    };
    const CAP = 134_217_728;
    it('one byte over the cap is counted and never read: no blob, no sidecar_seen mark, the tick still completes with its ticks row', async () => {
      const { sweep: S } = await IX.api();
      const box = IX.newBox('ccrc-hist-dm47i-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, linkRows());
        sparse(path.join(sideDir(box.homes[0]!), 'huge.bin'), CAP + 1);
        fs.chmodSync(path.join(sideDir(box.homes[0]!), 'huge.bin'), 0o000);   // decided from the stat alone: an open would be counted unreadable instead
        fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b7k2q9z1x.txt'), 'the big output body\n');   // a sidecar after it in the same tick is still taken
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
          const t0 = Date.now();
          const tick = await S.ingestTick(db, ctx, S.newBudget());
          S.recordTick(db, ctx, tick);
          expect(Date.now() - t0).toBeLessThan(20_000);      // a mutated run that read the hole would compress 128 MiB of zeros
          expect(tick.paused).toBe(false);
          expect(counterOf(db, 'sidecar_too_large')).toBe(1);
          expect(counterOf(db, 'file_unreadable')).toBeUndefined();
          expect(sidecarRows(db)).toEqual([{ name: 'b7k2q9z1x.txt', uuid: IX.uuidN(3) }]);
          expect(IX.count(db, 'sidecar_seen')).toBe(1);
          expect(IX.count(db, 'ticks')).toBe(1);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    }, 120_000);

    it('exactly at the cap it is captured as before (streamed, byte for byte)', async () => {
      const { sweep: S } = await IX.api();
      const box = IX.newBox('ccrc-hist-dm47j-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, linkRows());
        sparse(path.join(sideDir(box.homes[0]!), 'atcap.bin'), CAP);
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
          expect(counterOf(db, 'sidecar_too_large')).toBeUndefined();
          const r = db.prepare(`SELECT b.raw_len AS len FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id WHERE s.name = 'atcap.bin'`).get() as { len: number } | undefined;
          expect(r?.len).toBe(CAP);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    }, 300_000);
  });
});

interface IxSweep {
  ftsPrepare(db: DatabaseSync, nowMs: number): { state: string; tables: boolean };
  deriveFts(db: DatabaseSync, ctx: IxCtx, budget: IxBudget): Promise<void>;
  ftsTextOfBlob(z: Uint8Array, isSidecar: boolean, pairIdx: unknown): Promise<{ text: string; decoded: number }>;
}
interface IxSweep {
  secretsStep(db: DatabaseSync, ctx: IxCtx, secretFiles: string[]): { pairIdx: unknown; newValues: string[]; values: string[] };
  loadSecrets(home: string, secretFiles: string[]): { values: string[]; pairs: unknown[]; unreadable: string[]; unsegmentable: number };
}

describe('history ingest: secrets per tick (plan task 22)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  let S: IxSweep;
  beforeAll(async () => { ({ sweep: S } = await IX.api()); });
  const hex = (n: number): string => randomBytes(n).toString('hex');
  const sha = (v: string): string => createHash('sha256').update(v).digest('hex');
  const put = (home: string, rel: string, text: string): string => {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    fs.writeFileSync(p, text, { mode: 0o600 });
    return p;
  };
  /** runSweep with explicit `--secrets` files (file-URL preloads, SPAWN_TIMEOUT_MS cap): sweepWith goes through
   *  runSweep, never its own spawnSync, so the preload option and the wall-clock cap come from Task 14's helper. */
  const sweepWith = (box: HistoryBox, secrets: string[]): string => {
    const r = runSweep(box, [], { secrets });
    expect(r.code, r.stderr).toBe(0);
    return `${r.stdout}${r.stderr}`;
  };
  const pairsIn = (db: DatabaseSync): string[] =>
    (db.prepare('SELECT len, lower(hex(sha256)) AS h FROM redact_hashes ORDER BY len, h').all() as { len: number; h: string }[])
      .map((r) => `${r.len}:${r.h}`);

  it('O34 (redact half): a pair learned this tick is in the journal before any drain or ingest runs; a second tick journals nothing again', async () => {
    const box = IX.newBox('ccrc-hist-sec-o34-');
    const token = hex(32);
    put(box.home, '.cc-secrets/lane.env', `LANE_API_KEY=${token}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
      const r = S.secretsStep(db, ctx, []);
      expect(r.newValues).toEqual([token]);
      expect(journalRecords(box)).toContainEqual(expect.objectContaining({ k: 'redact', len: 64, sha256: sha(token) }));
      expect(IX.count(db, 'journal_outbox')).toBe(0);
      expect(pairsIn(db)).toEqual([`64:${sha(token)}`]);
      const again = S.secretsStep(db, { ...ctx, nowMs: ctx.nowMs + 120_000 }, []);
      expect(again.newValues).toEqual([]);
      expect(journalRecords(box).filter((x) => (x as { k?: string }).k === 'redact')).toHaveLength(1);
    } finally { db.close(); }
  });

  it('every frozen-list source and a declared secretsFile give their pairs; no value reaches the DB, its WAL, the journal or the pass output', () => {
    const box = IX.newBox('ccrc-hist-sec-e2e-');
    const v = {
      ccSecrets: hex(32), token: hex(32), exposure: hex(24), codex: `sk-${hex(24)}`,
      agent: hex(32), ccrcEnv: hex(32), declared: hex(30),
    };
    const session = randomBytes(32).toString('base64url');   // 43 chars, the server's token shape
    put(box.home, '.cc-secrets/claude-a-oauth.env', `CLAUDE_CODE_OAUTH_TOKEN=${v.ccSecrets}\n`);
    put(box.home, '.ccrc/mail.token', `${v.token}\n`);
    put(box.home, '.ccrc/exposure.env', `CCRC_EXPOSURE_SECRET=${v.exposure}\n`);
    put(box.home, '.ccrc/codex/lane1/runtime.env', `LITELLM_MASTER_KEY=${v.codex}\n`);
    put(box.home, '.ccrc/agent.env', `CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=${v.agent}\n`);
    fs.appendFileSync(path.join(box.home, '.ccrc', 'ccrc.env'), `CCRC_FIXTURE_TOKEN=${v.ccrcEnv}\n`);
    put(box.home, '.ccrc/sessions.json', JSON.stringify([{ idHash: sha(session), createdAt: 1, lastSeenAt: 1, generation: 1, label: 'fixture' }]));
    const declared = put(box.home, '.config/lane/key.env', `LANE_KEY=${v.declared}\n`);   // outside the frozen list
    const out = sweepWith(box, [declared]) + sweepWith(box, [declared]);
    const db = openStoreRO(box);
    try {
      const got = pairsIn(db);
      for (const value of Object.values(v)) expect(got, `no pair for a ${value.length}-char value`).toContain(`${value.length}:${sha(value)}`);
      expect(got).toContain(`43:${sha(session)}`);
    } finally { db.close(); }
    const keys = journalRecords(box).filter((x) => (x as { k?: string }).k === 'redact')
      .map((x) => { const r = x as { len: number; sha256: string }; return `${r.len}:${r.sha256}`; });
    expect(keys.length).toBeGreaterThanOrEqual(Object.keys(v).length + 1);
    expect(keys.length, 'a pair was journaled twice').toBe(new Set(keys).size);   // learned once each, never re-journaled
    const files = [path.join(box.root, 'db', 'history.db'), path.join(box.root, 'db', 'history.db-wal')];
    const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(path.join(box.root, 'journal'));
    const bytes = files.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f).toString('latin1')).join('\n') + out;
    for (const value of [...Object.values(v), session]) expect(bytes.includes(value), 'a secret value was written somewhere').toBe(false);
  });

  it('an unreadable listed file is counted and named for doctor while its earlier pairs stay; an absent one is neither', () => {
    const box = IX.newBox('ccrc-hist-sec-unread-');
    const value = hex(32);
    const p = put(box.home, '.ccrc/exposure.env', `CCRC_EXPOSURE_SECRET=${value}\n`);
    IX.sweepTwice(box);
    const meta = (): string => {
      const db = openStoreRO(box);
      try { return (db.prepare("SELECT v FROM meta WHERE k = 'redact_unreadable'").get() as { v: string }).v; } finally { db.close(); }
    };
    expect(meta()).toBe('[]');
    expect(counters(box)['redact_source_unreadable']).toBeUndefined();
    fs.chmodSync(p, 0o000);
    try {
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
    } finally { fs.chmodSync(p, 0o600); }
    expect(JSON.parse(meta())).toEqual([p]);
    expect(counters(box)['redact_source_unreadable']).toBe(1);
    const db = openStoreRO(box);
    try { expect(pairsIn(db)).toContain(`64:${sha(value)}`); } finally { db.close(); }
  });

  it('a FIFO, a link to a device and an oversize file under ~/.cc-secrets are unreadable sources, never opened; a directory is neither (D-4300)', () => {
    const box = IX.newBox('ccrc-hist-sec-nonreg-');
    const value = hex(32);
    put(box.home, '.ccrc/exposure.env', `CCRC_EXPOSURE_SECRET=${value}\n`);
    const dir = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(path.join(dir, 'adir'), { recursive: true, mode: 0o700 });
    const fifo = path.join(dir, 'pipe');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const zero = path.join(dir, 'zero');
    fs.symlinkSync('/dev/zero', zero);
    const big = path.join(dir, 'big');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, 4 * 1024 * 1024 + 1);   // sparse, past SECRET_FILE_MAX
    IX.sweepTwice(box, { timeoutMs: 20_000 });
    const db = openStoreRO(box);
    try {
      const m = (db.prepare("SELECT v FROM meta WHERE k = 'redact_unreadable'").get() as { v: string }).v;
      expect((JSON.parse(m) as string[]).slice().sort()).toEqual([big, fifo, zero].sort());
      expect(pairsIn(db)).toContain(`64:${sha(value)}`);
    } finally { db.close(); }
    expect(counters(box)['redact_source_unreadable']).toBe(6);   // three paths, two ticks
  });

  it('Task 24F: a declared secretsFile that the .cc-secrets glob also yields is taken once: an unreadable one counts +1 per tick and is named once, a readable one gives its pairs once', async () => {
    const box = IX.newBox('ccrc-hist-sec-dedupe-');
    const value = hex(32);
    const dir = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fifo = path.join(dir, 'claude-a-oauth.env');   // the roster's default secretsFile location
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const good = put(box.home, '.cc-secrets/claude-b-oauth.env', `CLAUDE_CODE_OAUTH_TOKEN=${value}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
      const loaded = S.loadSecrets(box.home, [fifo, good]);
      expect(loaded.unreadable).toEqual([fifo]);
      expect(loaded.values).toEqual([value]);
      expect(loaded.pairs).toHaveLength(1);
      const r = S.secretsStep(db, ctx, [fifo, good]);
      expect(r.values).toEqual([value]);
      expect((db.prepare("SELECT n FROM counters WHERE name = 'redact_source_unreadable'").get() as { n: number }).n).toBe(1);
      expect(JSON.parse((db.prepare("SELECT v FROM meta WHERE k = 'redact_unreadable'").get() as { v: string }).v)).toEqual([fifo]);
      expect(pairsIn(db)).toEqual([`64:${sha(value)}`]);
    } finally { db.close(); }
  });
});

describe('history ingest: the FTS index (plan task 23)', () => {
  // D-4246 (history-w1b-three-prs): these pins are the store halves; their `grep` halves are B2's.
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const hex = (n: number): string => randomBytes(n).toString('hex');
  const metaV = (db: DatabaseSync, k: string): string | undefined =>
    (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  const matches = (db: DatabaseSync, q: string): number =>
    (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(q) as { n: number }).n;
  /** The index's own bytes: every FTS5 data block, as latin1. */
  const ftsBytes = (db: DatabaseSync): string =>
    (db.prepare('SELECT block FROM blobs_fts_data').all() as { block: Uint8Array }[]).map((r) => Buffer.from(r.block).toString('latin1')).join('');
  const secretFile = (box: HistoryBox, name: string, body: string): void => {
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', name), body, { mode: 0o600 });
  };
  const hint = (box: HistoryBox): void => {
    fs.mkdirSync(path.join(box.root, 'spool'), { recursive: true });
    spoolLine(box, IX.ID, { v: 1, ev: 'Stop', id: IX.ID });
  };

  it('O9 (store half): a probe answering absent leaves no FTS tables and capture continues; a throw is probe-failed; flipped, derivation creates and backfills', () => {
    const box = IX.newBox('ccrc-hist-o9-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqalpha before the probe', 1)]));
    const absent = { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'absent' } };
    IX.sweepTwice(box, absent);
    fs.appendFileSync(p, IX.jsonl([IX.user(IX.uuidN(2), IX.uuidN(1), 'zqbravo while absent', 2)]));
    hint(box);
    expect(runSweep(box, [], absent).code).toBe(0);
    let db = openStoreRO(box);
    try {
      expect(IX.count(db, 'sqlite_master', "name IN ('blobs_fts', 'nodes_fts')")).toBe(0);
      expect(metaV(db, 'fts')).toBe('fts5-absent');
      expect(IX.count(db, 'entries')).toBe(2);              // the new message was still captured
      expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(0);
    } finally { db.close(); }
    expect(runSweep(box, [], { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'throw' } }).code).toBe(0);
    db = openStoreRO(box);
    try { expect(metaV(db, 'fts')).toBe('probe-failed'); } finally { db.close(); }   // never folded into absent
    expect(runSweep(box).code).toBe(0);                     // no seam: FTS5 is present on this interpreter (>= 22.16)
    db = openStoreRO(box);
    try {
      expect(IX.count(db, 'sqlite_master', "name IN ('blobs_fts', 'nodes_fts')")).toBe(2);
      expect(metaV(db, 'fts')).toBe('ready');
      expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(2);
      expect(matches(db, 'zqalpha')).toBe(1);
      expect(matches(db, 'zqbravo')).toBe(1);
    } finally { db.close(); }
  });

  it('DM28 and DM32 (store halves): summary, harness and recall-echo text is not indexed; operator, model and tool text is, a cat of <ccrc-recall included', () => {
    const box = IX.newBox('ccrc-hist-dm28-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'zqoperator words', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'text', text: 'zqmodel words' }], 2),
      { type: 'system', subtype: 'informational', level: 'info', content: 'zqharness words', uuid: IX.uuidN(3), parentUuid: IX.uuidN(2), timestamp: IX.ts(3) },
      // An isMeta user row: harness provenance with a string body, which ftsTextOf would index, so the provenance
      // gate is the only thing keeping it out (an attachment's object body yields no text either way).
      IX.user(IX.uuidN(4), IX.uuidN(3), 'zqmeta words', 4, { isMeta: true }),
      IX.user(IX.uuidN(5), IX.uuidN(4), 'zqsummary words', 5, { isCompactSummary: true }),
      IX.assistant(IX.uuidN(6), IX.uuidN(5), [{ type: 'tool_use', id: 'toolu_01RE', name: 'Bash', input: { command: 'ccrc history grep zqasked' } }], 6),
      IX.user(IX.uuidN(7), IX.uuidN(6), [{ type: 'tool_result', tool_use_id: 'toolu_01RE', content: 'zqecho words' }], 7),
      IX.assistant(IX.uuidN(8), IX.uuidN(7), [{ type: 'tool_use', id: 'toolu_01CT', name: 'Bash', input: { command: 'cat notes.md' } }], 8),
      IX.user(IX.uuidN(9), IX.uuidN(8), [{ type: 'tool_result', tool_use_id: 'toolu_01CT', content: 'zqtool words <ccrc-recall id="L0123456789abcdef0123"> zqcatbody' }], 9),
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect({ operator: matches(db, 'zqoperator'), model: matches(db, 'zqmodel'), tool: matches(db, 'zqtool'), cat: matches(db, 'zqcatbody') })
        .toEqual({ operator: 1, model: 1, tool: 1, cat: 1 });
      expect({ harness: matches(db, 'zqharness'), meta: matches(db, 'zqmeta'), summary: matches(db, 'zqsummary'), echo: matches(db, 'zqecho') })
        .toEqual({ harness: 0, meta: 0, summary: 0, echo: 0 });
    } finally { db.close(); }
  });

  it('DM29 (store half): a sidecar indexes its first 512 KB only; the text past it stays in the blob', () => {
    const box = IX.newBox('ccrc-hist-dm29-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
    const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'big.txt'), `zqhead ${'x '.repeat(300_000)} zqtail\n`);
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(matches(db, 'zqhead')).toBe(1);
      expect(matches(db, 'zqtail')).toBe(0);
      expect(IX.blobsHold(db, 'zqtail')).toBe(true);
    } finally { db.close(); }
  });

  it('DM30 and DM13 (FTS clauses): the body is plain text, never JSON keys; a uuid-less row is no term', () => {
    const box = IX.newBox('ccrc-hist-dm30-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, [{ type: 'text', text: 'zqfirst line\nzqsecond word' }], 1),
      { type: 'bridge-session', sessionId: IX.U, accountUuid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', timestamp: IX.ts(2) },
    ]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(matches(db, 'zqsecond')).toBe(1);
      expect(matches(db, 'type')).toBe(0);
      expect(matches(db, 'text')).toBe(0);
      expect(matches(db, '"a1b2c3d4"')).toBe(0);
    } finally { db.close(); }
  });

  it('DM31 (store half): a token known before its text is indexed is no term, no prefix and no index byte, and its blob keeps it', () => {
    const box = IX.newBox('ccrc-hist-dm31-');
    const token = hex(32);
    secretFile(box, 'fixture.env', `ZQ_FIXTURE_TOKEN=${token}\n`);
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `the key is ${token} ok`, 1)]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(matches(db, 'key')).toBe(1);                   // CONTROL: the row itself is indexed
      expect(matches(db, `"${token.slice(0, 6)}"*`)).toBe(0);
      expect(ftsBytes(db).includes(token.slice(16, 32))).toBe(false);
      expect(IX.blobsHold(db, token)).toBe(true);
    } finally { db.close(); }
  });

  it('a value learned after its text was indexed is re-indexed by quoted phrase, then purged from the index bytes by merge steps', () => {
    const box = IX.newBox('ccrc-hist-late-');
    const value = `zqv-${hex(10)}_${hex(10)}`;          // '-' and '_': a bare MATCH of it is a syntax error
    const tail = value.slice(value.indexOf('_') + 1);
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note ${value} end`, 1)]));
    IX.sweepTwice(box);
    let db = openStoreRO(box);
    try {
      expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(1);   // CONTROL: indexed in clear before the pair is known
      expect(ftsBytes(db).includes(tail.slice(4, 16))).toBe(true);
    } finally { db.close(); }
    secretFile(box, 'late.env', `ZQ_LATE_VALUE=${value}\n`);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    db = openStoreRO(box);
    try {
      expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(0);
      expect(matches(db, 'note')).toBe(1);                  // the row is still indexed, redacted
      expect(ftsBytes(db).includes(tail.slice(4, 16))).toBe(false);
      expect(IX.blobsHold(db, value)).toBe(true);
      expect((db.prepare("SELECT completed_ms AS c FROM derivation_state WHERE step = 'fts-merge' AND version = 1").get() as { c: number | null }).c)
        .not.toBeNull();
    } finally { db.close(); }
  });

  it('a pair committed by a pass that died before its re-index is re-indexed by the next pass: the obligation is durable', async () => {
    const box = IX.newBox('ccrc-hist-reidx-');
    const value = `zqw-${hex(10)}_${hex(10)}`;
    const tail = value.slice(value.indexOf('_') + 1);
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note ${value} end`, 1)]));
    IX.sweepTwice(box);                                      // indexed in clear: the pair is not known yet
    secretFile(box, 'late.env', `ZQ_LATE_VALUE=${value}\n`);
    // The dead pass, in-process: the tick's secrets step learns the pair, commits it under FULL and journals it, and
    // the process ends before reindexForValues runs.
    const { sweep: S, store, lib } = await IX.api();
    const P = lib.historyPaths(box.home);
    const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
    const w = store.openWriter(P.dbFile);
    try {
      expect(S.secretsStep(w, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), []).newValues).toEqual([value]);
    } finally { w.close(); }
    let db = openStoreRO(box);
    try { expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(1); } finally { db.close(); }   // CONTROL: still a term
    const r = runSweep(box);                                 // the pair is known now: it is new to no one
    expect(r.code, r.stderr).toBe(0);
    db = openStoreRO(box);
    try {
      expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(0);
      expect(ftsBytes(db).includes(tail.slice(4, 16))).toBe(false);
      expect(metaV(db, 'fts_reindex_rid'))
        .toBe(String((db.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r));   // the mark caught up
    } finally { db.close(); }
  });

  it('blobs captured while the probe failed are indexed once FTS is back: the completed backfill re-opens', () => {
    const box = IX.newBox('ccrc-hist-fts-reopen-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqalpha indexed at once', 1)]));
    IX.sweepTwice(box);
    let db = openStoreRO(box);
    try { expect(metaV(db, 'fts')).toBe('ready'); } finally { db.close(); }   // the tables exist and the backfill is complete
    fs.appendFileSync(p, IX.jsonl([IX.user(IX.uuidN(2), IX.uuidN(1), 'zqcharlie while the probe fails', 2)]));
    hint(box);
    expect(runSweep(box, [], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'throw' } }).code).toBe(0);
    db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries')).toBe(2);              // captured
      expect(metaV(db, 'fts')).toBe('probe-failed');
      expect(matches(db, 'zqcharlie')).toBe(0);             // not indexed: this tick could not
    } finally { db.close(); }
    expect(runSweep(box).code).toBe(0);                     // no seam: FTS is back
    db = openStoreRO(box);
    try {
      expect(matches(db, 'zqcharlie')).toBe(1);
      expect(metaV(db, 'fts')).toBe('ready');
    } finally { db.close(); }
  });

  it('D-4311 (S4): a blob indexed holding only one SEGMENT of a later-learned value is found by that segment and re-indexed', () => {
    const box = IX.newBox('ccrc-hist-seg-');
    const seg = `zqc${hex(8)}`;
    const value = `AAAA+zqb${hex(8)}/${seg}=`;       // not one [A-Za-z0-9_-] run: redaction registers each 12+ char run as its own pair
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note ${seg} end`, 1)]));
    IX.sweepTwice(box);
    let db = openStoreRO(box);
    try {
      expect(matches(db, `"${seg.slice(0, 6)}"*`)).toBe(1);        // CONTROL: indexed in clear, the pair is not known yet
      expect(ftsBytes(db).includes(seg.slice(4, 14))).toBe(true);
    } finally { db.close(); }
    secretFile(box, 'part.env', `ZQ_PART_VALUE=${value}\n`);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    db = openStoreRO(box);
    try {
      expect(matches(db, `"${seg.slice(0, 6)}"*`)).toBe(0);
      expect(ftsBytes(db).includes(seg.slice(4, 14))).toBe(false);
      expect(matches(db, 'note')).toBe(1);                          // the row is still indexed, redacted
      expect(IX.blobsHold(db, seg)).toBe(true);
    } finally { db.close(); }
  });

  it('D-4311 (S5): a tick whose secret source is unreadable does not advance the re-index mark; the next readable tick re-indexes and advances it', async () => {
    const box = IX.newBox('ccrc-hist-s5-');
    const value = `zqx-${hex(10)}_${hex(10)}`;
    const tail = value.slice(value.indexOf('_') + 1);
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note ${value} end`, 1)]));
    IX.sweepTwice(box);                                      // indexed in clear: the pair is not known yet
    secretFile(box, 'late.env', `ZQ_LATE_VALUE=${value}\n`);
    const { sweep: S, store, lib } = await IX.api();
    const P = lib.historyPaths(box.home);
    const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
    const w = store.openWriter(P.dbFile);
    try {
      expect(S.secretsStep(w, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), []).newValues).toEqual([value]);   // the dead pass: pair committed, never re-indexed
    } finally { w.close(); }
    const file = path.join(box.home, '.cc-secrets', 'late.env');
    fs.chmodSync(file, 0o000);                               // the source the value lives in is now unreadable
    try {
      const r1 = runSweep(box);
      expect(r1.code, r1.stderr).toBe(0);
      let db = openStoreRO(box);
      try {
        expect(counters(box)['redact_source_unreadable']).toBeGreaterThan(0);
        expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(1);   // nothing could be re-indexed: the value is not loadable
        expect(Number(metaV(db, 'fts_reindex_rid') ?? 0))
          .toBeLessThan((db.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r);   // the obligation stands
      } finally { db.close(); }
    } finally { fs.chmodSync(file, 0o600); }
    const r2 = runSweep(box);
    expect(r2.code, r2.stderr).toBe(0);
    const db = openStoreRO(box);
    try {
      expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(0);
      expect(ftsBytes(db).includes(tail.slice(4, 16))).toBe(false);
      expect(metaV(db, 'fts_reindex_rid'))
        .toBe(String((db.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r));
    } finally { db.close(); }
  });

  describe('D-4312 (history-sidecar-redact-before-cut): a sidecar is redacted over a window larger than its cut, then cut', () => {
    const N = 512 * 1024;
    const sideFile = (box: HistoryBox, name: string): string => {
      const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, name);
    };
    /** `zqhead`, blanks, then `secret` with `before` of its characters below byte N, then ` zqend`. */
    const straddle = (secret: string, before: number): Buffer =>
      Buffer.concat([Buffer.from('zqhead\n'), Buffer.alloc(N - 7 - before, 0x20), Buffer.from(secret), Buffer.from(' zqend\n')]);

    it('S6: a known value straddling byte SIDECAR_FTS_BYTES leaves no 12+ char prefix in the index (whole-read arm)', () => {
      const box = IX.newBox('ccrc-hist-s6-');
      const tok = hex(24);
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(sideFile(box, 'big.txt'), straddle(tok, 20));
      IX.sweepTwice(box);
      const db = openStoreRO(box);
      try {
        expect(matches(db, 'zqhead')).toBe(1);                         // CONTROL: the sidecar is indexed
        expect(matches(db, `"${tok.slice(0, 12)}"*`)).toBe(0);
        expect(matches(db, `"${tok.slice(0, 16)}"*`)).toBe(0);
        expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
        expect(IX.blobsHold(db, tok)).toBe(true);                      // the blob keeps it, verbatim
      } finally { db.close(); }
    });

    it('S6: the streamed arm (a sidecar over SIDECAR_WHOLE_MAX) redacts the larger window before its cut as well', () => {
      const box = IX.newBox('ccrc-hist-s6b-');
      const tok = hex(24);
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      const file = sideFile(box, 'huge.txt');
      const fd = fs.openSync(file, 'w');
      try {
        const head = straddle(tok, 20);
        fs.writeSync(fd, head, 0, head.length, 0);
        fs.ftruncateSync(fd, 67_108_864 + 4096);                       // a hole past the head: the streamed arm, at no disk cost
      } finally { fs.closeSync(fd); }
      try {
        IX.sweepTwice(box);
        const db = openStoreRO(box);
        try {
          expect(IX.count(db, 'sidecars')).toBe(1);
          expect(matches(db, 'zqhead')).toBe(1);
          expect(matches(db, `"${tok.slice(0, 12)}"*`)).toBe(0);
          expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    }, 300_000);

    it('S6: a secret not yet known, straddling the cut, leaves no partial run at it: the cut run is dropped', () => {
      const box = IX.newBox('ccrc-hist-s6c-');
      const tok = hex(24);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(sideFile(box, 'big.txt'), straddle(tok, 20));
      IX.sweepTwice(box);                                              // no pair is known: only the dropped partial run keeps the prefix out
      const db = openStoreRO(box);
      try {
        expect(matches(db, 'zqhead')).toBe(1);
        expect(matches(db, `"${tok.slice(0, 12)}"*`)).toBe(0);
        expect(matches(db, 'zqend')).toBe(0);                          // past the cut
      } finally { db.close(); }
    });

    it('S6: a value learned late, printed in a sidecar\'s head, is re-indexed through the bounded read', () => {
      const box = IX.newBox('ccrc-hist-s6d-');
      const tok = hex(24);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(sideFile(box, 'big.txt'), `zqhead ${tok} zqend\n${' '.repeat(2 * N)}zqfar\n`);
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try { expect(matches(db, `"${tok.slice(0, 12)}"*`)).toBe(1); } finally { db.close(); }   // CONTROL: indexed in clear, the pair is not known yet
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, 'zqhead')).toBe(1);
        expect(matches(db, 'zqend')).toBe(1);
        expect(matches(db, `"${tok.slice(0, 12)}"*`)).toBe(0);
        expect(matches(db, 'zqfar')).toBe(0);                          // still past the cut
      } finally { db.close(); }
    });
  });

  describe('T23-a (D-4312): the backfill and the re-index never decompress a whole sidecar, and charge blobs one at a time', () => {
    const BOUND = 512 * 1024 + 65536;
    const body = (): Buffer => Buffer.from(`zqhead ${'x '.repeat(1_500_000)} zqtail\n`);   // 3 MB of compressible text, far over the bound
    const q5 = (b: Buffer): Buffer => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } });

    it('unbrotliPrefix stops decoding at the bound, and returns exactly the first bytes of the body', async () => {
      const { store } = await IX.api();
      const raw = body();
      const p = await store.unbrotliPrefix(q5(raw), BOUND);
      expect(p.bytes.length).toBe(BOUND);
      expect(p.bytes.equals(raw.subarray(0, BOUND))).toBe(true);
      expect(p.whole).toBe(false);
      expect(p.decoded).toBeLessThan(BOUND + 128 * 1024);     // the decompressor never produced the whole 3 MB
      const small = await store.unbrotliPrefix(q5(Buffer.from('short body')), BOUND);
      expect(small).toMatchObject({ whole: true, decoded: 10 });
      expect(small.bytes.toString()).toBe('short body');
    });

    it('a stored sidecar blob over the bound indexes exactly its head, decoding no more than the bound', async () => {
      const { sweep: S, lib } = await IX.api();
      const raw = body();
      const idx = lib.makePairIndex([]);
      const r = await S.ftsTextOfBlob(q5(raw), true, idx);
      expect(r.decoded).toBeLessThan(BOUND + 128 * 1024);
      expect(r.text).toBe(lib.sidecarIndexText(raw.subarray(0, BOUND), idx));
      expect(r.text).toContain('zqhead');
      expect(r.text).not.toContain('zqtail');
      const e = await S.ftsTextOfBlob(q5(Buffer.from(JSON.stringify('an entry body'))), false, idx);
      expect(e.text).toBe('an entry body');
    });

    it('the backfill charges the run budget per blob and stops its batch when the budget fails', async () => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-t23a-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqentry words', 1)]));
        const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
        fs.mkdirSync(dir, { recursive: true });
        for (const n of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `${n}.txt`), `zqside${n} ${IX.words(200, n.charCodeAt(0))}\n`);
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick: nothing indexed
          const total = IX.count(db, 'blobs');
          expect(total).toBeGreaterThanOrEqual(4);
          expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(0);
          const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000, ids);
          ctx.fts = S.ftsPrepare(db, ctx.nowMs).tables;
          ctx.pairIdx = lib.makePairIndex([]);
          await S.deriveFts(db, ctx, S.newBudget(Date.now, { maxBytes: 1 }));
          expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(1);   // one blob charged, the budget failed, the batch stopped
          expect(metaV(db, 'fts')).not.toBe('ready');
          for (let i = 0; i < total && metaV(db, 'fts') !== 'ready'; i += 1) await S.deriveFts(db, ctx, S.newBudget(Date.now, { maxBytes: 1 }));
          expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(total);   // each later run resumes from the cursor
          expect(metaV(db, 'fts')).toBe('ready');
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });
  });
});
