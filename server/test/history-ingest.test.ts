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
import { Transform } from 'node:stream';
import { brotliCompressSync, brotliDecompressSync, constants as zc } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { REPO, makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, plantSession, counters, journalRecords, spoolLine, readTxlog, writes, recordOpenFlags, SWEEP, PRELOADS, type HistoryBox } from './historyHelpers.js';
import { boundaryRow } from './historyFixtures.js';
import { createStore, openWriter, closeWriter } from '../../ccd/history/store.mjs';
import { historyPaths, sha256Hex, HEALTH_COUNTERS } from '../../ccd/history/lib.mjs';

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

  // M22: a rostered projects/ tree may hold a directory link the operator made, so admission's open carries O_NOCTTY.
  it('opens the transcript with O_NOCTTY, O_NOFOLLOW and O_NONBLOCK (M22)', () => {
    const p = transcriptAt(box.homes[0]!, 'demo', U1, row('r1'));
    const { out, opens } = recordOpenFlags(() => SW.admitFile(p, box.homes[0]!, box.homes, box.home));
    if (out.ok) fs.closeSync(out.fd);
    expect(out.ok).toBe(true);
    const mine = opens.filter((o) => o.path === p);
    expect(mine).toHaveLength(1);
    const want = fs.constants.O_NOCTTY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    expect(mine[0]!.flags & want).toBe(want);
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
interface IxTickResult { busy: boolean; bytes: number; newEntries: number; minNewTsMs: number | null; paused: boolean; skipped: ReadonlySet<string> }
interface IxSweep {
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): IxBudget;
  makeIngestCtx(home: string, homes: string[], nowMs: number, ids: IxIds, floorProbe?: () => Promise<IxFloorWord>): IxCtx;
  ingestPath(db: DatabaseSync, ctx: IxCtx, f: { path: string; uuid: string; home: string }, b: IxBudget): Promise<IxFileResult | null>;
  ingestTick(db: DatabaseSync, ctx: IxCtx, b: IxBudget): Promise<IxTickResult>;
  ingestSidecars(db: DatabaseSync, ctx: IxCtx, b: IxBudget, uuids: Iterable<string>): Promise<{ bytes: number; complete: boolean; paused: boolean }>;
  toolResultCandidates(db: DatabaseSync, transcriptPk: number, names: Iterable<string>): Array<{ entryId: number; text: string; toolUseIds: string[] }>;
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

interface IxSweep { parseStoredJson(bytes: Uint8Array): unknown; }
/** An IX.user row whose message.content is the raw JSON text `content` (D-4345's structure-bound cases). */
const ixFrame = (u: string, parent: string | null, n: number, content: string): string =>
  JSON.stringify(IX.user(u, parent, ['__C__'], n)).replace('["__C__"]', () => content);

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

  it('review 316 F7: a 16,200,040-byte line of 8.1 million nested arrays, under a 512 MiB heap, is stored raw-only and every pass exits 0', async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-f7-');
    try {
      const d = 8_100_000;
      const line = ixFrame(IX.uuidN(2), IX.uuidN(1), 2, '['.repeat(d) + ']'.repeat(d));
      expect(Buffer.byteLength(line), 'CONTROL: this case exercises the under-LINE_MAX path').toBeLessThan(lib.LINE_MAX);
      const text = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), line, IX.user(IX.uuidN(3), IX.uuidN(1), 'after', 3)]);
      IX.plantCopy(box.homes[0]!, IX.U, text);
      const opts = { env: { NODE_OPTIONS: `--import ${pathToFileURL(PRELOADS.statfs).href} --max-old-space-size=512` } };
      IX.sweepTwice(box, opts);                                              // at HEAD a pass dies on SIGABRT
      const r = runSweep(box, [], opts);
      expect(r.code, `${r.signal} ${r.stderr}`).toBe(0);
      const db = openStoreRO(box);
      try {
        expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(3)}'`)).toBe(1);
        expect(IX.count(db, 'entries', "parse_state = 'raw-only'")).toBe(1);
        expect((db.prepare('SELECT last_error_code AS c FROM ingest_files').get() as { c: string }).c).toBe('line-too-complex');
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 180_000);

  it('D-4346: a later row whose uuid is a line-too-long raw row\'s key leaves its raw blob undecompressed: two unknown variants, both blobs kept, the small body searchable', async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-d4346-collide-');
    try {
      // The raw line is a JSON array of tool_result blocks (the shape of a stored user body): decoded whole, toolResultCandidates would offer it for linkage.
      const long = JSON.stringify([{ type: 'tool_result', tool_use_id: 'toolu_01RAW', content: 'saved to: /home/u/x/tool-results/zzraw.txt' }, 'a'.repeat(lib.LINE_MAX + 16)]);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), long, IX.user(IX.uuidN(4), IX.uuidN(1), 'after', 4)]));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      let k = '';
      try {
        const raw = db.prepare(`SELECT e.uuid AS uuid, b.raw_len AS len FROM entries e JOIN blobs b ON b.blob_id = e.blob_id
          WHERE e.parse_state = 'raw-only'`).get() as { uuid: string; len: number };
        k = raw.uuid;
        expect(raw.len).toBeGreaterThan(lib.LINE_MAX);
      } finally { db.close(); }
      const second = IX.plantCopy(box.homes[1]!, IX.U, IX.jsonl([IX.user(k, null, 'zqcollide words', 5)]));
      fs.utimesSync(second, new Date('2099-01-01T00:00:00Z'), new Date('2099-01-01T00:00:00Z'));
      fs.mkdirSync(path.join(box.root, 'spool'), { recursive: true });
      spoolLine(box, IX.ID, { v: 1, ev: 'Stop', id: IX.ID });   // a hint: the session's files are discovered again
      const sideDir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(sideDir, { recursive: true });
      fs.writeFileSync(path.join(sideDir, 'zzraw.txt'), 'the raw row\'s sidecar body\n');
      IX.sweepTwice(box);   // each pass exits 0 (sweepTwice asserts it), the sidecar pass included
      db = openStoreRO(box);
      try {
        // F1: the collision leaves a type 'user' entry whose CURRENT blob is still the raw blob of unbounded raw_len.
        const col = db.prepare(`SELECT e.entry_id AS entry_id, e.type AS type, e.transcript_pk AS pk, b.raw_len AS len FROM entries e
          JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?`).get(k) as { entry_id: number; type: string; pk: number; len: number };
        expect(col.type).toBe('user');
        expect(col.len).toBeGreaterThan(lib.LINE_MAX);
        // the guard in toolResultCandidates: that raw blob is never decoded whole, so it names no sidecar. Without it the row
        // is a candidate for 'zzraw.txt' (its decoded text names the file).
        const S = (await IX.api()).sweep;
        expect(S.toolResultCandidates(db as unknown as DatabaseSync, col.pk, ['zzraw.txt']).filter((c) => c.entryId === col.entry_id)).toEqual([]);
        const ev = db.prepare(`SELECT v.blob_id AS blob_id, v.cause AS cause FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
          WHERE e.uuid = ?`).all(k) as { blob_id: number; cause: string }[];
        expect(ev).toHaveLength(2);
        expect(ev.map((x) => x.cause)).toEqual(['unknown', 'unknown']);
        for (const x of ev) expect(IX.count(db, 'blobs', `blob_id = ${x.blob_id}`)).toBe(1);
        expect((db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get('zqcollide') as { n: number }).n).toBe(1);
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 180_000);
});

/** CP-39d carry (987 F6): O2b's text without its malformed line, `[user 1, over-long, user 4]`, and the over-long line's byte offset. */
const longLineCase = (lineMax: number): { text: string; longStart: number } => {
  const first = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1)]);
  const long = `{"pad":"${'a'.repeat(lineMax + 16)}"}`;
  return { text: IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), long, IX.user(IX.uuidN(4), IX.uuidN(1), 'after', 4)]), longStart: Buffer.byteLength(first) };
};
/** CP-39d carry (987 F6): fs.readSync replaced so that only compressFdRange's first piece of the over-long line (a buffer of exactly
 *  1 << 20 bytes read at `longStart`) calls `act`; every other read, findLineEnd's and readLines' included, is the real one. */
const patchLongRead = (longStart: number, act: () => number): { restore: () => void; hits: () => number } => {
  const real = fs.readSync;
  let hits = 0;
  (fs as { readSync: unknown }).readSync = function readSync(fd: number, buf: Buffer, ...rest: unknown[]): number {
    if (buf.length === (1 << 20) && Number(rest[2]) === longStart) { hits += 1; return act(); }
    return (real as (...a: unknown[]) => number)(fd, buf, ...rest);
  };
  syncBuiltinESMExports();
  return { restore: () => { (fs as { readSync: unknown }).readSync = real; syncBuiltinESMExports(); }, hits: () => hits };
};

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

  it('CP-39d carry (m) (987 F6, the null arm): a read of the over-long line that returns 0 answers atEof false at the line\'s start and stores no raw row; the next call stores it', async () => {
    const box = IX.newBox('ccrc-hist-cp39d-m-');
    const { text, longStart } = longLineCase(lib.LINE_MAX);
    const p = IX.plantCopy(box.homes[0]!, IX.U, text);
    const { db, ids } = await IX.openFixtureStore(box);
    const rawOnly = (): number => (db.prepare('SELECT n FROM counters WHERE name = ?').get('raw_only') as { n: number } | undefined)?.n ?? 0;
    let patch: ReturnType<typeof patchLongRead> | undefined;
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
      const f = { path: p, uuid: IX.U, home: box.homes[0]! };
      patch = patchLongRead(longStart, () => 0);
      const r = await S.ingestPath(db, ctx, f, S.newBudget());
      const hits = patch.hits();
      patch.restore(); patch = undefined;
      expect(hits, 'CONTROL: the patched read was the over-long line\'s first piece').toBe(1);
      expect(r!.atEof, '(m) atEof: a short read of the over-long line is not the end of the file').toBe(false);
      expect(IX.cursorOf(db, r!.fileId), '(m) the cursor holds at the over-long line\'s start').toBe(longStart);
      expect(rawOnly(), '(m) no raw row').toBe(0);
      expect(IX.count(db, 'entries', "parse_state = 'raw-only'")).toBe(0);
      // CONTROL: an unpatched second call stores the over-long line raw and reaches the end.
      const r2 = await S.ingestPath(db, ctx, f, S.newBudget());
      expect(r2!.atEof).toBe(true);
      expect(r2!.offset).toBe(Buffer.byteLength(text));
      expect(rawOnly()).toBe(1);
    } finally {
      patch?.restore();
      db.close();
      fs.rmSync(box.home, { recursive: true, force: true });
    }
  }, 120_000);

  it('CP-39d carry (n) (987 F6, the OS-error arm): a read of the over-long line that throws EIO rejects ingestPath with the cursor held, and the tick counts it file_unreadable and skips the file', async () => {
    const box = IX.newBox('ccrc-hist-cp39d-n-');
    const { text, longStart } = longLineCase(lib.LINE_MAX);
    const p = IX.plantCopy(box.homes[0]!, IX.U, text);
    const { db, ids } = await IX.openFixtureStore(box);
    const eio = Object.assign(new Error('cp39d-k'), { code: 'EIO', syscall: 'read' });
    const unreadable = (): number => (db.prepare('SELECT n FROM counters WHERE name = ?').get('file_unreadable') as { n: number } | undefined)?.n ?? 0;
    let patch: ReturnType<typeof patchLongRead> | undefined;
    try {
      patch = patchLongRead(longStart, () => { throw eio; });
      const f = { path: p, uuid: IX.U, home: box.homes[0]! };
      const viaPath = await S.ingestPath(db, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), f, S.newBudget()).then(() => 'resolved' as const, (e: unknown) => e);
      expect(viaPath, '(n) ingestPath resolved: the OS error must reach the tick').toBe(eio);
      expect(patch.hits(), 'CONTROL: the patched read was reached').toBe(1);
      const fileId = (db.prepare('SELECT file_id AS id FROM ingest_files').get() as { id: number }).id;
      expect(IX.cursorOf(db, fileId)).toBe(longStart);
      expect(unreadable(), 'ingestPath itself counts nothing').toBe(0);
      // Through the tick: the OS error is that file's, counted and skipped.
      const t = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), S.newBudget());
      expect(patch.hits(), 'CONTROL: the tick reached the patched read').toBe(2);
      expect(t.busy).toBe(false);
      expect(unreadable()).toBe(1);
      expect(IX.cursorOf(db, fileId)).toBe(longStart);
      expect([...t.skipped]).toEqual([IX.U]);
    } finally {
      patch?.restore();
      db.close();
      fs.rmSync(box.home, { recursive: true, force: true });
    }
  }, 120_000);

  it('D-4345 (history-json-structure-bound): a line over JSON_DEPTH_MAX deep or over JSON_NODES_MAX units is stored raw-only byte for byte, line-too-complex, before any parse, and the cursor goes past it; a 3,000-deep line is a parsed row', async () => {
    const box = IX.newBox('ccrc-hist-d4345-');
    const D = lib.JSON_DEPTH_MAX + 1;
    const deep = ixFrame(IX.uuidN(2), IX.uuidN(1), 2, '['.repeat(D) + ']'.repeat(D));
    const wide = ixFrame(IX.uuidN(3), IX.uuidN(1), 3, '[' + '0,'.repeat(lib.JSON_NODES_MAX) + '0]');
    const deepBad = ixFrame(IX.uuidN(6), IX.uuidN(1), 6, '['.repeat(D) + ']'.repeat(D)).slice(0, -1);   // over the bound AND not JSON
    const ok3000 = ixFrame(IX.uuidN(5), IX.uuidN(1), 5, '['.repeat(3000) + '"zqdeepok"' + ']'.repeat(3000));
    const text = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), deep, wide, deepBad, ok3000, IX.user(IX.uuidN(4), IX.uuidN(1), 'after', 4)]);
    const p = IX.plantCopy(box.homes[0]!, IX.U, text);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const r = await S.ingestPath(db, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), { path: p, uuid: IX.U, home: box.homes[0]! }, S.newBudget());
      expect(r!.atEof).toBe(true);
      expect(r!.offset).toBe(Buffer.byteLength(text));
      const raws = db.prepare(`SELECT e.uuid AS uuid, b.z AS z FROM entries e JOIN blobs b ON b.blob_id = e.blob_id
        WHERE e.parse_state = 'raw-only' ORDER BY e.entry_id`).all() as { uuid: string; z: Uint8Array }[];
      expect(raws.map((x) => brotliDecompressSync(x.z).toString('utf8'))).toEqual([deep, wide, deepBad]);
      for (const x of raws) expect(x.uuid).toMatch(/^x[0-9a-f]{32}$/);
      expect(IX.count(db, 'entries', `uuid IN ('${IX.uuidN(2)}','${IX.uuidN(3)}','${IX.uuidN(6)}')`)).toBe(0);
      expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(5)}' AND parse_state = 'ok'`)).toBe(1);
      expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(4)}'`)).toBe(1);
      expect((db.prepare('SELECT last_error_code AS c FROM ingest_files').get() as { c: string }).c).toBe('line-too-complex');   // deepBad is the last raw line; at HEAD it would be json-parse
      expect((db.prepare('SELECT n FROM counters WHERE name = ?').get('raw_only') as { n: number }).n).toBe(3);
    } finally {
      db.close();
      fs.rmSync(box.home, { recursive: true, force: true });
    }
  }, 120_000);

  it('D-4345: every stored-blob parse goes through parseStoredJson, which refuses an over-bound blob that ftsTextOfBlob would otherwise index', async () => {
    const src = fs.readFileSync(SWEEP, 'utf8');
    expect(src.match(/JSON\.parse\(unbrotli\(/g)).toBeNull();
    expect((src.match(/\bunbrotli\(/g) ?? []).length).toBe(4);
    expect((src.match(/(?<!function )\bparseStoredJson\(/g) ?? []).length).toBe(4);
    const over = Buffer.from(JSON.stringify([{ type: 'text', text: 'zqstructsentinel' }]).slice(0, -1) + ',0'.repeat(lib.JSON_NODES_MAX) + ']');
    const idx = lib.makePairIndex([]);
    const okBody = Buffer.from(JSON.stringify([{ type: 'text', text: 'zqstructsentinel' }]));
    expect((await S.ftsTextOfBlob(brotliCompressSync(over), false, idx, over.length)).text).toBe('');
    expect((await S.ftsTextOfBlob(brotliCompressSync(okBody), false, idx, okBody.length)).text).toBe('zqstructsentinel');
    expect(() => S.parseStoredJson(over)).toThrow(SyntaxError);
  });

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
 *  MemoryMax=1G (D-4244). DM47 (task 21) uses the same bound.
 *  Every figure above was read with the preload's inherited maxRSS, max(the test worker's size at spawn, the sweep's own peak) on
 *  Linux (D-6964); the worker's size at spawn was not measured; one run per side differs by a few percent either way. With the preload's own peak (VmHWM) Node 24.14.1 measured this pass at 314756 KiB (299488 KiB read the old way in a separate run),
 *  DM47 at 227648 KiB (230940 old) and CP-39's walk-cap case at 311052 KiB (319320 old).
 *  The 22.16.0 figures are the node-floor CI leg's and stay as read then. */
const IX_RSS_BOUND_KIB = process.version === 'v22.16.0' ? 256 * 1024 : 512 * 1024;
/** half the carrier's MemoryMax=1G, D-4244's bound family; the heaviest STRUCTURED line measured 389,508 and 356,032 KiB whole-pass on Node 24.14.1 (D-4345), and since D-4419's window the heaviest plain-text line measured, an ESC 7-dense one, 372,204 KiB in a 1 GiB scope (the whole-pass readings were read with the inherited maxRSS, D-6964; the scoped reading stays as recorded). With the preload's own peak, Node 24.14.1 measured the D-4345 case at 331912 KiB (315656 KiB read the old way) and the D-4419 case at 364268 KiB (363324 old). */
const IX_LINE_RSS_BOUND_KIB = 512 * 1024;
/** The old-space cap the D-4345 RSS case gives its child. It is TIGHTER than the ~256 MiB of old space a 1 GiB carrier's cgroup gives V8
 *  (about physical/4), chosen for margin, so the pass is held to a stricter heap than production: V8 paces its heap from the cgroup
 *  it sees, and an unflagged child on a 31 GiB box floated this pass to 535-559 MiB. Measured on Node 24.14.1 under load ~25, the peak of two passes per run,
 *  seven runs of 256 and of 192 MiB: 256 MiB gave 434,448 to 512,048 KiB, 192 MiB gave 413,976 to 442,004 KiB, 128 MiB gave 408,636 to 414,180 KiB,
 *  and the same line in a real `MemoryMax=1G` scope peaked at 401,540 KiB (the one scoped reading, recorded in the FU2 commit body, never enforced here).
 *  The 256, 192 and 128 MiB figures were read with the inherited maxRSS (D-6964) and are kept as read, and the
 *  re-measurement with the preload's own peak at 192 MiB is on the bound's comment above (D-4345 331912 and D-4419 364268 KiB, Node 24.14.1).
 *  The case sets no scope, so it never reaches a service manager. */
const IX_LINE_HEAP_MIB = 192;

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

  it('D-4345: the heaviest structured line, JSON_NODES_MAX units of 30-character strings, is a parsed row and the pass peaks under 512 MiB, half the carrier\'s MemoryMax=1G, with its old space capped at 192 MiB, tighter than a 1 GiB carrier gives', async () => {
    const { lib } = await IX.api();
    const base = JSON.stringify(IX.user(IX.uuidN(2), IX.uuidN(1), ['s'], 2));
    const frameUnits = [...base].filter((ch) => ch === '[' || ch === '{' || ch === ',').length;   // no value of the frame holds one
    const n = lib.JSON_NODES_MAX - frameUnits + 1;   // the content array's own `[` is in frameUnits; n strings add n - 1 commas
    const strs = (k: number): string => JSON.stringify(IX.user(IX.uuidN(2), IX.uuidN(1),
      Array.from({ length: k }, (_, i) => String(i).padStart(30, 'q')), 2));
    const line = strs(n);
    expect(lib.jsonWithinStructureBound(Buffer.from(line)), 'CONTROL: at the bound').toBe(true);
    expect(lib.jsonWithinStructureBound(Buffer.from(strs(n + 1))), 'CONTROL: one unit over').toBe(false);
    expect(Buffer.byteLength(line), 'CONTROL: under LINE_MAX').toBeLessThan(lib.LINE_MAX);
    // The carrier's bound is a cgroup, and V8 sizes and paces its heap from the cgroup it sees: an unflagged child on a large box
    // lets it defer collection, and this same pass floats to 535-559 MiB (measured), a reading of the box and not of the unit.
    // So the child gets a heap cap as a flag: 192 MiB, deliberately tighter than the ~256 MiB of old space a 1 GiB carrier gives
    // (chosen for margin, see IX_LINE_HEAP_MIB), so the pass is held to a stricter heap than production. This case never touches a
    // service manager: a scope would reach the operator's real user bus (containedTools.ts), and it would skip wherever none exists.
    const box = IX.newBox('ccrc-hist-f7rss-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), line]));
      const nodeOptions = [`--max-old-space-size=${IX_LINE_HEAP_MIB}`, ...[PRELOADS.statfs, IX_RSS_PRELOAD].map((x) => `--import ${pathToFileURL(x).href}`)].join(' ');
      let peak = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        const r = runSweep(box, [], { env: { NODE_OPTIONS: nodeOptions } });
        expect(r.code, `${r.signal} ${r.stderr}`).toBe(0);
        const m = /history-test-maxrss-kib=(\d+)/.exec(r.stderr);
        expect(m, 'the RSS preload printed nothing').not.toBeNull();
        peak = Math.max(peak, Number(m![1]));
      }
      const db = openStoreRO(box);
      try { expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(2)}' AND parse_state = 'ok'`)).toBe(1); } finally { db.close(); }
      console.log(`D-4345 heaviest structured line peak RSS ${peak} KiB on ${process.version}`);
      expect(peak).toBeLessThan(IX_LINE_RSS_BOUND_KIB);
    } finally {
      fs.rmSync(box.home, { recursive: true, force: true });
    }
  }, 300_000);

  it('D-4419: a 16,400,072-byte line of U+008F, a letter and a space is a parsed, indexed row, and the pass peaks under 512 MiB with its old space capped at 192 MiB (before the window it aborted every pass, final review FP7)', async () => {
    const { lib } = await IX.api();
    const SS3 = String.fromCharCode(0x8f);   // the 8-bit single shift, written raw by JSON.stringify
    const line = JSON.stringify(IX.user(IX.uuidN(2), IX.uuidN(1), `${SS3}a `.repeat(4_100_000), 2));
    expect(Buffer.byteLength(line), 'CONTROL: under LINE_MAX').toBeLessThan(lib.LINE_MAX);
    expect(lib.jsonWithinStructureBound(Buffer.from(line)), 'CONTROL: inside the structure bound').toBe(true);
    const box = IX.newBox('ccrc-hist-fu7rss-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), line]));
      const nodeOptions = [`--max-old-space-size=${IX_LINE_HEAP_MIB}`, ...[PRELOADS.statfs, IX_RSS_PRELOAD].map((x) => `--import ${pathToFileURL(x).href}`)].join(' ');
      let peak = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        const r = runSweep(box, [], { env: { NODE_OPTIONS: nodeOptions } });
        expect(r.code, `${r.signal} ${r.stderr.slice(0, 400)}`).toBe(0);
        const m = /history-test-maxrss-kib=(\d+)/.exec(r.stderr);
        expect(m, 'the RSS preload printed nothing').not.toBeNull();
        peak = Math.max(peak, Number(m![1]));
      }
      const db = openStoreRO(box);
      try {
        expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(2)}' AND parse_state = 'ok'`)).toBe(1);
        expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(2);
      } finally { db.close(); }
      console.log(`D-4419 U+008F line peak RSS ${peak} KiB on ${process.version}`);
      expect(peak).toBeLessThan(IX_LINE_RSS_BOUND_KIB);
    } finally {
      fs.rmSync(box.home, { recursive: true, force: true });
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
      // a sidecar half the floor cut short leaves its own scan unmarked (D-6933), so the next tick's sidecar scan covers
      // every known uuid again and takes the sidecar; the transcripts, done, have their own mark
      expect((db.prepare("SELECT v FROM meta WHERE k = 'scan_sidecars_ms'").get() as { v: string }).v).toBe(String(at(0)));
      expect((db.prepare("SELECT v FROM meta WHERE k = 'scan_discover_ms'").get() as { v: string }).v).toBe(String(at(1)));
      const unsettled = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at(2), ids, async () => 'unsettled'), S.newBudget());
      expect(unsettled.paused).toBe(true);
      expect(counterOf(db, 'capture_paused_low_disk')).toBe(1);   // an unsettled probe is uncounted
      const ok = await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at(3), ids), S.newBudget());
      expect(ok.paused).toBe(false);
      expect(sidecarRows(db)).toEqual([{ name: 'b7k2q9z1x.txt', uuid: IX.uuidN(3) }]);
    } finally { db.close(); }
  });

  it('linkage is unchanged by the bounded candidate index: a name that is a substring of one a row names, a toolu_ stem, and an orphan', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47i-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'go', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'tool_use', id: 'toolu_01DDD', name: 'Bash', input: { command: 'make' } }], 2),
      IX.user(IX.uuidN(3), IX.uuidN(2), [{ type: 'tool_result', tool_use_id: 'toolu_01DDD', content: 'saved to: /home/u/x/tool-results/data.txt' }], 3),
      IX.assistant(IX.uuidN(4), IX.uuidN(3), [{ type: 'tool_use', id: 'toolu_01EEE', name: 'Read', input: { file_path: '/home/u/tree/b.png' } }], 4),
      IX.user(IX.uuidN(5), IX.uuidN(4), [{ type: 'tool_result', tool_use_id: 'toolu_01EEE', content: 'short' }], 5),
    ]));
    for (const name of ['data.txt', 'a.txt', 'toolu_01EEE.json', 'zz-orphan.txt']) fs.writeFileSync(path.join(sideDir(box.homes[0]!), name), `body of ${name}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget());
      expect(sidecarRows(db)).toEqual([
        { name: 'a.txt', uuid: IX.uuidN(3) },                 // a substring of data.txt, which that row's text holds
        { name: 'data.txt', uuid: IX.uuidN(3) },
        { name: 'toolu_01EEE.json', uuid: IX.uuidN(5) },
        { name: 'zz-orphan.txt', uuid: null },
      ]);
    } finally { db.close(); }
  });

  it('toolResultCandidates keeps no row text: a transcript of large tool_results yields candidates the size of the asked names (O20)', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-dm47j-');
    const big = (k: number): string => `${IX.words(30_000, k)} saved to: /home/u/x/tool-results/big${k}.txt`;   // ~200 KB of text per row
    const rows = [IX.user(IX.uuidN(1), null, 'go', 1)];
    for (let k = 1; k <= 6; k += 1) {
      rows.push(IX.assistant(IX.uuidN(10 * k), IX.uuidN(k === 1 ? 1 : 10 * (k - 1) + 1), [{ type: 'tool_use', id: `toolu_0${k}`, name: 'Bash', input: { command: 'make' } }], 2 * k));
      rows.push(IX.user(IX.uuidN(10 * k + 1), IX.uuidN(10 * k), [{ type: 'tool_result', tool_use_id: `toolu_0${k}`, content: big(k) }], 2 * k + 1));
    }
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(rows));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
      const pk = (db.prepare('SELECT transcript_pk AS pk FROM transcripts WHERE cc_session_uuid = ?').get(IX.U) as { pk: number }).pk;
      const total = S.toolResultCandidates(db, pk, ['big2.txt', 'big5.txt', 'toolu_03.json']);
      expect(total.map((c) => c.entryId).length, 'the three answered rows are candidates, the other three are not').toBe(3);
      expect(total.map((c) => c.text)).toEqual(['big2.txt', '', 'big5.txt']);
      expect(total.map((c) => c.toolUseIds)).toEqual([[], ['toolu_03'], []]);
      expect(JSON.stringify(total).length, 'a candidate carried a row\'s text').toBeLessThan(1000);
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

  it('DM47: a 64 MiB sidecar and a larger one are both streamed, byte for byte, with peak RSS under O20\'s bound', () => {
    // D-6972: both files are over SIDECAR_READ_WHOLE_MAX, so the streamed arm takes both; the CP-39b describe pins the boundary itself.
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
      const whole = write(path.join(dir, 'stream64.txt'), 67_108_864);   // D-7099 (987 F3): the name no longer says whole; both files are streamed
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
        expect(got('stream64.txt')).toEqual({ sha: whole, len: 67_108_864 });
        expect(got('streamed.txt')).toEqual({ sha: streamed, len: 67_108_864 + 4096 });
        // D-7099 (987 F3): each blob is decoded and compared, so a sha taken over bytes the blob does not hold cannot pass.
        for (const [name, want, len] of [['stream64.txt', whole, 67_108_864], ['streamed.txt', streamed, 67_108_864 + 4096]] as const) {
          const z = (db.prepare('SELECT b.z AS z FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id WHERE s.name = ?').get(name) as { z: Uint8Array }).z;
          const body = brotliDecompressSync(z);
          expect({ sha: createHash('sha256').update(body).digest(), len: body.length }, `${name} decodes to the bytes written`).toEqual({ sha: want, len });
        }
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
  resetFtsPending(db: DatabaseSync): void;
  storedBody(s: { blobZ: { get(id: number): unknown } }, blobId: number): unknown;
  pairedFromStore(db: DatabaseSync, toolUseId: string, parentUuid: string | null): { id: string } | null;
  ftsTextOfBlob(z: Uint8Array, isSidecar: boolean, pairIdx: unknown, rawLen: number): Promise<{ text: string; decoded: number; undecodable: false; overCap?: true } | { text: null; decoded: number; undecodable: true }>;
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

  it('O34 (FULL half): the pair transaction commits under synchronous=FULL with its outbox row and nothing else, and its journal append is the very next event', () => {
    const box = IX.newBox('ccrc-hist-sec-o34f-');
    put(box.home, '.cc-secrets/lane.env', `LANE_API_KEY=${hex(32)}\n`);
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqfull words', 1)]));
    const txlog = path.join(box.home, 'txlog');
    IX.sweepTwice(box, { preloads: [PRELOADS.faults], env: { HISTORY_TEST_TXLOG: txlog } });   // the first pass may only create the store
    const evs = readTxlog(txlog);
    const iP = evs.findIndex((e) => writes(e, /\bINTO redact_hashes\b/));
    expect(iP).toBeGreaterThanOrEqual(0);
    const p = evs[iP]!;
    expect(p.kind === 'tx' ? p.sync : -1).toBe(2);
    expect(p.kind === 'tx' && p.writes.every((x) => /\bINTO (redact_hashes|journal_outbox)\b/.test(x))).toBe(true);
    expect(writes(p, /\bINTO journal_outbox\b/)).toBe(true);
    expect(evs[iP + 1]).toEqual(expect.objectContaining({ kind: 'journal' }));
    expect(evs.findIndex((e) => writes(e, /\bINTO entries\b/))).toBeGreaterThan(iP + 1);
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

interface IxSweep {
  rederiveFts(db: DatabaseSync, ctx: IxCtx, budget: IxBudget, slice?: IxBudget): Promise<{ state: 'idle' | 'running' | 'completed'; reindexed: number }>;
  reindexForValues(db: DatabaseSync, ctx: IxCtx, values: string[], fresh: string[], budget: IxBudget, slice?: IxBudget): Promise<number>;
}

describe('history ingest: the FTS index (plan task 23)', () => {
  // D-4246 (history-w1b-three-prs): these pins are the store halves; their `grep` halves are B2's.
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const hex = (n: number): string => randomBytes(n).toString('hex');
  const metaV = (db: DatabaseSync, k: string): string | undefined =>
    (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  const maxRid = (db: DatabaseSync): number => (db.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r;
  const rowidOf = (db: DatabaseSync, q: string): number => (db.prepare('SELECT rowid AS id FROM blobs_fts WHERE blobs_fts MATCH ?').get(q) as { id: number }).id;
  const matches = (db: DatabaseSync, q: string): number =>
    (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(q) as { n: number }).n;
  /** Whether the index holds a row for a blob (its rowid is the blob_id), whatever that row says. */
  const hasFtsRow = (db: DatabaseSync, blobId: number): boolean =>
    db.prepare('SELECT 1 AS one FROM blobs_fts WHERE rowid = ?').get(blobId) !== undefined;
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

  it('DM28 and DM32 (store halves): summary and harness text is not indexed; operator, model and tool text is, a cat of <ccrc-recall and a recall echo included', () => {
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
      // A recall echo is indexed for grep --include-recall, while default grep filters its provenance.
      expect({ operator: matches(db, 'zqoperator'), model: matches(db, 'zqmodel'), tool: matches(db, 'zqtool'), cat: matches(db, 'zqcatbody'), echo: matches(db, 'zqecho') })
        .toEqual({ operator: 1, model: 1, tool: 1, cat: 1, echo: 1 });
      expect({ harness: matches(db, 'zqharness'), meta: matches(db, 'zqmeta'), summary: matches(db, 'zqsummary') })
        .toEqual({ harness: 0, meta: 0, summary: 0 });
      expect((db.prepare("SELECT count(*) AS n FROM entries WHERE provenance = 'recall-echo'").get() as { n: number }).n).toBe(1);
    } finally { db.close(); }
  });

  it('history-recall-echo-indexed on a store B1 backfilled: the first B2 tick re-opens the completed backfill once, from 0, and indexes the old echo', () => {
    const box = IX.newBox('ccrc-hist-echo-b1-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, 'zqopener words', 1),
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'tool_use', id: 'toolu_01RB', name: 'Bash', input: { command: 'ccrc history grep zqasked' } }], 2),
      IX.user(IX.uuidN(3), IX.uuidN(2), [{ type: 'tool_result', tool_use_id: 'toolu_01RB', content: 'zqoldecho words' }], 3),
    ]));
    IX.sweepTwice(box);
    // The store as B1 leaves it: the echo's blob unindexed, the ('fts', 1) backfill complete, no meta fts_provenance.
    const w = openWriter(historyPaths(box.home).dbFile);
    try {
      const echo = (w.prepare("SELECT blob_id FROM entries WHERE provenance = 'recall-echo'").get() as { blob_id: number }).blob_id;
      w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(echo);
      w.prepare('UPDATE blobs SET fts_indexed = 0 WHERE blob_id = ?').run(echo);
      w.prepare("DELETE FROM meta WHERE k = 'fts_provenance'").run();
    } finally { closeWriter(w); }
    const doneAt = (db: DatabaseSync): number | null =>
      (db.prepare("SELECT completed_ms FROM derivation_state WHERE step = 'fts' AND version = 1").get() as { completed_ms: number | null }).completed_ms;
    let db = openStoreRO(box);
    try {
      expect(matches(db, 'zqoldecho'), 'CONTROL: the echo is out of the index, as B1 left it').toBe(0);
      expect(doneAt(db), 'CONTROL: the backfill is complete').not.toBeNull();
    } finally { db.close(); }
    expect(runSweep(box).code).toBe(0);
    let first: number | null;
    db = openStoreRO(box);
    try {
      expect(matches(db, 'zqoldecho'), 'the re-opened backfill indexed the old echo').toBe(1);
      expect(matches(db, 'zqopener'), 'and kept what was indexed').toBe(1);
      expect(metaV(db, 'fts_provenance')).toBe('operator,model,tool,recall-echo');
      expect(metaV(db, 'fts')).toBe('ready');
      first = doneAt(db);
      expect(first).not.toBeNull();
    } finally { db.close(); }
    expect(runSweep(box).code).toBe(0);
    db = openStoreRO(box);
    try {
      expect(doneAt(db), 'once only: a tick on a recorded set re-opens nothing').toBe(first);
    } finally { db.close(); }
  });

  it('F3: a rolled-back B1 leaves an eligible recall echo unindexed under the CURRENT fts_provenance; the next tick re-opens from 0 once, indexes it, and then leaves a healthy store alone', () => {
    const box = IX.newBox('ccrc-hist-echo-rollback-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqopener words', 1)]));
    IX.sweepTwice(box);
    const stamp = (db: DatabaseSync): { completed: number | null; cursor: string | null; prov: string | undefined } => {
      const r = db.prepare("SELECT completed_ms AS c, cursor AS k FROM derivation_state WHERE step = 'fts' AND version = 1").get() as { c: number | null; k: string | null };
      return { completed: r.c, cursor: r.k, prov: metaV(db, 'fts_provenance') };
    };
    let db = openStoreRO(box);
    try { expect(stamp(db).completed, 'CONTROL: the backfill is complete').not.toBeNull(); } finally { db.close(); }
    // After the completed backfill a row is appended that B2 would index (a recall echo) and one it never indexes (isMeta
    // harness text): B1 rolled back over this store ingests both and writes neither to the index.
    fs.appendFileSync(p, IX.jsonl([
      IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'tool_use', id: 'toolu_01RR', name: 'Bash', input: { command: 'ccrc history grep zqasked' } }], 2),
      IX.user(IX.uuidN(3), IX.uuidN(2), [{ type: 'tool_result', tool_use_id: 'toolu_01RR', content: 'zqrollecho words' }], 3),
      IX.user(IX.uuidN(4), IX.uuidN(3), 'zqrollmeta words', 4, { isMeta: true }),
    ]));
    hint(box);
    expect(runSweep(box).code).toBe(0);
    const w = openWriter(historyPaths(box.home).dbFile);
    let echo: number;
    try {
      echo = (w.prepare("SELECT blob_id FROM entries WHERE provenance = 'recall-echo' AND uuid = ?").get(IX.uuidN(3)) as { blob_id: number }).blob_id;
      w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(echo);
      w.prepare('UPDATE blobs SET fts_indexed = 0 WHERE blob_id = ?').run(echo);
    } finally { closeWriter(w); }
    let before: ReturnType<typeof stamp>;
    db = openStoreRO(box);
    try {
      before = stamp(db);
      expect(matches(db, 'zqrollecho'), 'CONTROL: the echo is out of the index').toBe(0);
      expect(before.completed, 'CONTROL: the backfill is complete').not.toBeNull();
      expect(before.prov, 'CONTROL: the marker is the current set').toBe('operator,model,tool,recall-echo');
      expect(Number(before.cursor), 'CONTROL: the echo lies past the completed cursor').toBeLessThan(echo);
      expect((db.prepare("SELECT fts_indexed AS f FROM blobs b JOIN entries e ON e.blob_id = b.blob_id WHERE e.uuid = ?").get(IX.uuidN(4)) as { f: number }).f, 'CONTROL: harness text is never indexed').toBe(0);
    } finally { db.close(); }
    expect(runSweep(box).code).toBe(0);
    let repaired: ReturnType<typeof stamp>;
    db = openStoreRO(box);
    try {
      expect(matches(db, 'zqrollecho'), 'the owed echo is indexed again').toBe(1);
      expect(matches(db, 'zqrollmeta'), 'an excluded source class is not broadened in').toBe(0);
      repaired = stamp(db);
      expect(repaired.completed).not.toBeNull();
      expect(repaired.prov).toBe(before.prov);
      expect(metaV(db, 'fts')).toBe('ready');
    } finally { db.close(); }
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    db = openStoreRO(box);
    try {
      expect(stamp(db), 'a healthy complete store is not re-opened on later ticks').toEqual(repaired);
      expect(matches(db, 'zqrollecho')).toBe(1);
    } finally { db.close(); }
  });

  it('F3 (relation only): a rolled-back build re-labels an OLD deduplicated harness-only blob as a recall echo at or below the completed cursor; the next tick re-opens from 0, indexes it once, and then leaves a healthy store alone', async () => {
    const { sweep: S, lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-echo-oldblob-');
    try {
      const call = [{ type: 'tool_use', id: 'toolu_01OB', name: 'Bash', input: { command: 'ccrc history grep zqasked' } }];
      const result = [{ type: 'tool_result', tool_use_id: 'toolu_01OB', content: 'zqoldecho words' }];
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, 'zqopener words', 1),
        IX.assistant(IX.uuidN(2), IX.uuidN(1), call, 2),
        IX.user(IX.uuidN(3), IX.uuidN(2), result, 3, { isMeta: true }),   // harness: its blob is not eligible
        IX.user(IX.uuidN(4), IX.uuidN(3), 'zqlater words', 4),            // a later eligible blob, so the cursor passes the harness one
      ]));
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick: nothing indexed
        const cycle = async (k: number): Promise<string> => {
          const c = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000 + k * 60_000, ids);
          const p = S.ftsPrepare(db, c.nowMs);
          c.fts = p.tables;
          c.pairIdx = lib.makePairIndex([]);
          await S.deriveFts(db, c, S.newBudget());
          return p.state;
        };
        const stamp = (): { completed: number | null; cursor: string | null; prov: string | undefined; undec: number | undefined } => {
          const r = db.prepare("SELECT completed_ms AS c, cursor AS k FROM derivation_state WHERE step = 'fts' AND version = 1").get() as { c: number | null; k: string | null };
          return { completed: r.c, cursor: r.k, prov: metaV(db, 'fts_provenance'), undec: (db.prepare('SELECT n FROM counters WHERE name = ?').get(HEALTH_COUNTERS.blobUndecodable) as { n: number } | undefined)?.n };
        };
        const entryOf = (n: number): { blob_id: number; provenance: string } =>
          db.prepare('SELECT blob_id, provenance FROM entries WHERE uuid = ?').get(IX.uuidN(n)) as { blob_id: number; provenance: string };
        const old = entryOf(3);
        expect(old.provenance, 'CONTROL: the entry is harness').toBe('harness');
        await cycle(0);
        const done = stamp();
        expect(done.completed, 'CONTROL: the backfill is complete').not.toBeNull();
        expect(Number(done.cursor), 'CONTROL: the cursor passed the harness blob').toBeGreaterThanOrEqual(old.blob_id);
        expect(matches(db, 'zqoldecho'), 'CONTROL: harness text is not indexed').toBe(0);
        // The rolled-back build ingests a newer-ranked copy of the same uuid and the same canonical body, whose structural
        // pairing makes it a recall echo. ENTRY_UPSERT retains blob_id; no blob is stored; the build indexes nothing.
        const blobsBefore = IX.count(db, 'blobs');
        const second = IX.plantCopy(box.homes[1]!, IX.U, IX.jsonl([
          IX.assistant(IX.uuidN(2), IX.uuidN(1), call, 2),
          IX.user(IX.uuidN(3), IX.uuidN(2), result, 3),
        ]));
        fs.utimesSync(second, new Date('2099-01-01T00:00:00Z'), new Date('2099-01-01T00:00:00Z'));
        const r = await S.ingestPath(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 90_000, ids), { path: second, uuid: IX.U, home: box.homes[1]! }, S.newBudget());
        expect(r, 'the second copy was ingested').not.toBeNull();
        const now = entryOf(3);
        expect(now.provenance, 'the same entry is now a recall echo').toBe('recall-echo');
        expect(now.blob_id, 'and keeps its old blob').toBe(old.blob_id);
        expect(IX.count(db, 'blobs'), 'the body deduplicated').toBe(blobsBefore);
        expect(old.blob_id).toBeLessThanOrEqual(Number(done.cursor));
        expect(IX.count(db, 'blobs', `blob_id = ${old.blob_id} AND fts_indexed = 0`)).toBe(1);
        expect(hasFtsRow(db, old.blob_id)).toBe(false);
        expect(stamp(), 'the completed state and its marker are untouched').toEqual(done);
        // The next B2 tick measures the relation from 0.
        expect(await cycle(1)).toBe('fts-pending');
        expect(matches(db, 'zqoldecho'), 'the old echo is indexed again').toBe(1);
        expect(hasFtsRow(db, old.blob_id)).toBe(true);
        const repaired = stamp();
        expect(repaired.completed).not.toBeNull();
        expect(repaired.prov).toBe(done.prov);
        expect(repaired.undec).toBe(done.undec);
        for (let k = 2; k < 5; k += 1) {
          expect(await cycle(k), 'a healthy complete store is not re-opened').toBe('ready');
          expect(stamp()).toEqual(repaired);
        }
        expect(matches(db, 'zqoldecho')).toBe(1);
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  /** The relation-only fixture of the F3 cases: a completed backfill whose cursor passed an OLD harness-only blob, and the
   *  rollback-era FTS-disabled ingest (a newer same-uuid, same-body copy) that makes that blob a recall echo without allocating one. */
  const oldEchoStore = async (prefix: string, body: (x: {
    S: Awaited<ReturnType<typeof IX.api>>['sweep']; db: DatabaseSync; old: number;
    cycle: (k: number) => Promise<string>; relabel: () => Promise<void>;
    stamp: () => { completed: number | null; cursor: string | null };
  }) => Promise<void>): Promise<void> => {
    const { sweep: S, lib } = await IX.api();
    const box = IX.newBox(prefix);
    try {
      const call = [{ type: 'tool_use', id: 'toolu_01OB', name: 'Bash', input: { command: 'ccrc history grep zqasked' } }];
      const result = [{ type: 'tool_result', tool_use_id: 'toolu_01OB', content: 'zqoldecho words' }];
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, 'zqopener words', 1),
        IX.assistant(IX.uuidN(2), IX.uuidN(1), call, 2),
        IX.user(IX.uuidN(3), IX.uuidN(2), result, 3, { isMeta: true }),   // harness: its blob is not eligible
        IX.user(IX.uuidN(4), IX.uuidN(3), 'zqlater words', 4),            // a later eligible blob, so the cursor passes the harness one
      ]));
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick: nothing indexed
        const cycle = async (k: number): Promise<string> => {
          const c = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000 + k * 60_000, ids);
          const p = S.ftsPrepare(db, c.nowMs);
          c.fts = p.tables;
          c.pairIdx = lib.makePairIndex([]);
          await S.deriveFts(db, c, S.newBudget());
          return p.state;
        };
        const stamp = (): { completed: number | null; cursor: string | null } => {
          const r = db.prepare("SELECT completed_ms AS c, cursor AS k FROM derivation_state WHERE step = 'fts' AND version = 1").get() as { c: number | null; k: string | null };
          return { completed: r.c, cursor: r.k };
        };
        const entryOf = (n: number): { blob_id: number; provenance: string } =>
          db.prepare('SELECT blob_id, provenance FROM entries WHERE uuid = ?').get(IX.uuidN(n)) as { blob_id: number; provenance: string };
        const old = entryOf(3);
        expect(old.provenance, 'CONTROL: the entry is harness').toBe('harness');
        await cycle(0);
        expect(stamp().completed, 'CONTROL: the backfill is complete').not.toBeNull();
        expect(Number(stamp().cursor), 'CONTROL: the cursor passed the harness blob').toBeGreaterThanOrEqual(old.blob_id);
        const relabel = async (): Promise<void> => {
          const blobsBefore = IX.count(db, 'blobs');
          const second = IX.plantCopy(box.homes[1]!, IX.U, IX.jsonl([
            IX.assistant(IX.uuidN(2), IX.uuidN(1), call, 2),
            IX.user(IX.uuidN(3), IX.uuidN(2), result, 3),
          ]));
          fs.utimesSync(second, new Date('2099-01-01T00:00:00Z'), new Date('2099-01-01T00:00:00Z'));
          const r = await S.ingestPath(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 90_000, ids), { path: second, uuid: IX.U, home: box.homes[1]! }, S.newBudget());
          expect(r, 'the second copy was ingested').not.toBeNull();
          expect(entryOf(3), 'the same entry is now a recall echo on its old blob').toEqual({ blob_id: old.blob_id, provenance: 'recall-echo' });
          expect(IX.count(db, 'blobs'), 'the body deduplicated').toBe(blobsBefore);
          expect(IX.count(db, 'blobs', `blob_id = ${old.blob_id} AND fts_indexed = 0`)).toBe(1);
          expect(hasFtsRow(db, old.blob_id)).toBe(false);
        };
        await body({ S, db, old: old.blob_id, cycle, relabel, stamp });
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  };

  it('F3 (reset): an explicit no-index reopen of a COMPLETED store sets the cursor to 0, so the very next prepare/derive cycle indexes an old blob the same ingest made eligible', async () => {
    await oldEchoStore('ccrc-hist-echo-reset-', async ({ S, db, cycle, relabel, stamp }) => {
      await relabel();
      S.resetFtsPending(db);
      expect(stamp(), 'reopened, from zero').toEqual({ completed: null, cursor: '0' });
      expect(await cycle(1)).toBe('fts-pending');
      expect(matches(db, 'zqoldecho'), 'the old echo is indexed by the immediately following cycle').toBe(1);
      expect(stamp().completed).not.toBeNull();
      const repaired = stamp();
      for (let k = 2; k < 4; k += 1) {
        expect(await cycle(k)).toBe('ready');
        expect(stamp()).toEqual(repaired);
      }
    });
  });

  it('F3 (reset): an explicit reopen of an already-PENDING store with an advanced cursor also sets the cursor to 0', async () => {
    await oldEchoStore('ccrc-hist-echo-reset-pending-', async ({ S, db, cycle, relabel, stamp }) => {
      // A backfill stopped part-way (a spent budget): pending, its cursor past the old blob.
      const past = stamp().cursor;
      db.prepare("UPDATE derivation_state SET completed_ms = NULL WHERE step = 'fts' AND version = 1").run();
      expect(stamp(), 'CONTROL: pending at an advanced cursor').toEqual({ completed: null, cursor: past });
      expect(Number(past)).toBeGreaterThan(0);
      await relabel();
      S.resetFtsPending(db);
      expect(stamp(), 'a pending row is reset to zero too').toEqual({ completed: null, cursor: '0' });
      expect(await cycle(1)).toBe('fts-pending');
      expect(matches(db, 'zqoldecho'), 'the old echo is indexed in that cycle').toBe(1);
      expect(stamp().completed).not.toBeNull();
    });
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

  it('D-4344 (F12, was D-4311 S5): with one secret source readable and one unreadable, both owed blobs are re-indexed and the mark advances', async () => {
    const box = IX.newBox('ccrc-hist-s5-');
    const va = `zqx-${hex(10)}_${hex(10)}`;
    const tail = va.slice(va.indexOf('_') + 1);
    const vb = `zqj${hex(12)}5`;
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      IX.user(IX.uuidN(1), null, `note ${va} end`, 1),
      IX.user(IX.uuidN(2), IX.uuidN(1), `note \u00e9${vb} end`, 2),
    ]));
    IX.sweepTwice(box);                                      // indexed in clear: the pairs are not known yet
    let db = openStoreRO(box);
    try {
      expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(1);   // CONTROL
      expect(matches(db, '"ezqj"*')).toBe(1);                  // CONTROL: the glued term
    } finally { db.close(); }
    secretFile(box, 'a.env', `ZQ_A=${va}\n`);
    secretFile(box, 'b.env', `ZQ_B=${vb}\n`);
    const { sweep: S, store, lib } = await IX.api();
    const P = lib.historyPaths(box.home);
    const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
    const w = store.openWriter(P.dbFile);
    try {
      expect([...S.secretsStep(w, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), []).newValues].sort()).toEqual([va, vb].sort());   // the dead pass
    } finally { w.close(); }
    const file = path.join(box.home, '.cc-secrets', 'b.env');
    fs.chmodSync(file, 0o000);
    try {
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(counters(box)['redact_source_unreadable']).toBeGreaterThan(0);
        expect(matches(db, `"${tail.slice(0, 6)}"*`)).toBe(0);   // found by phrase: its value loaded
        expect(matches(db, '"ezqj"*')).toBe(0);                 // found only by hash: its source is unreadable
        expect(ftsBytes(db).includes(vb.slice(3, 15))).toBe(false);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
      } finally { db.close(); }
    } finally { fs.chmodSync(file, 0o600); }
  });

  it('D-4343 (F2): an entry holding a literal backslash-n before a known value indexes no term holding it', () => {
    const box = IX.newBox('ccrc-hist-esc-entry-');
    const BS = String.fromCharCode(92);
    const value = `zqe${hex(12)}7`;
    secretFile(box, 'esc.env', `ZQ_ESC_VALUE=${value}\n`);
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note x${BS}n${value} end`, 1)]));
    IX.sweepTwice(box);
    const db = openStoreRO(box);
    try {
      expect(matches(db, '"nzqe"*')).toBe(0);
      expect(matches(db, 'note')).toBe(1);
      expect(ftsBytes(db).includes(value.slice(3, 15))).toBe(false);
      expect(IX.blobsHold(db, value)).toBe(true);
    } finally { db.close(); }
  });

  describe('D-4344 (history-reindex-mark-by-rederivation): the mark moves only when every indexed blob is re-derived with every pair', () => {
    it('F3: a value glued to a non-ASCII letter, a combining mark or a CSI remnant is found by hash and re-indexed', () => {
      const box = IX.newBox('ccrc-hist-glued-');
      const v1 = `zqg${hex(12)}1`; const v2 = `zqh${hex(12)}2`; const v3 = `zqk${hex(12)}3`;
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, `note \u00e9${v1} end`, 1),
        IX.user(IX.uuidN(2), IX.uuidN(1), `note x\u0301${v2} end`, 2),
        IX.user(IX.uuidN(3), IX.uuidN(2), `note \x1b[1m${v3} end`, 3),
      ]));
      IX.sweepTwice(box);
      const Q = ['"ezqg"*', '"xzqh"*', '"1mzqk"*'];
      let db = openStoreRO(box);
      try { for (const q of Q) expect(matches(db, q), q).toBe(1); } finally { db.close(); }   // CONTROL: each glued term is indexed
      secretFile(box, 'glued.env', `ZQ_A=${v1}\nZQ_B=${v2}\nZQ_C=${v3}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        for (const q of Q) expect(matches(db, q), q).toBe(0);
        expect(matches(db, 'note')).toBe(3);
        for (const v of [v1, v2, v3]) expect(ftsBytes(db).includes(v.slice(3, 15)), v.slice(0, 3)).toBe(false);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
        expect(IX.blobsHold(db, v1)).toBe(true);
      } finally { db.close(); }
    });

    it('F3: a hash-only pair (sessions.json) re-indexes the blob holding its token, which no phrase search can find', () => {
      const box = IX.newBox('ccrc-hist-hashonly-');
      const token = `zqp${hex(20)}`;                         // 43 characters, a session token's length
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note ${token} end`, 1)]));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try { expect(matches(db, '"zqp"*')).toBe(1); } finally { db.close(); }   // CONTROL: the token's own term; porter leaves zqp whole ("zqs" stems to "zq", review 316 M3)
      fs.mkdirSync(path.join(box.home, '.ccrc'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(box.home, '.ccrc', 'sessions.json'),
        JSON.stringify([{ idHash: sha256Hex(token), createdAt: 1, lastSeenAt: 1, generation: 1, label: 'fixture' }]), { mode: 0o600 });
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, '"zqp"*')).toBe(0);
        expect(ftsBytes(db).includes(token.slice(3, 23))).toBe(false);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
      } finally { db.close(); }
    });

    it('F4: an owed pair whose declared secret file an unreadable roster did not pass is still served by hash, and the mark advances', async () => {
      const box = IX.newBox('ccrc-hist-f4-');
      const v = `zqr${hex(12)}4`;
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note ${v} end`, 1)]));
      IX.sweepTwice(box);
      const declared = path.join(box.home, '.config', 'lane', 'key.env');   // outside SECRET_SOURCES
      fs.mkdirSync(path.dirname(declared), { recursive: true, mode: 0o700 });
      fs.writeFileSync(declared, `LANE_KEY=${v}\n`, { mode: 0o600 });
      const { sweep: S, store, lib } = await IX.api();
      const P = lib.historyPaths(box.home);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      const w = store.openWriter(P.dbFile);
      try {
        expect(S.secretsStep(w, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), [declared]).newValues).toEqual([v]);   // the dead pass
      } finally { w.close(); }
      const r = runSweep(box, ['--roster-unreadable'], { secrets: [], homes: [] });   // the shim's argv when accounts.sh does not source
      expect(r.code, r.stderr).toBe(0);
      const db = openStoreRO(box);
      try {
        expect(counters(box)['roster_unreadable']).toBeGreaterThanOrEqual(1);
        expect(matches(db, `"${v.slice(0, 6)}"*`)).toBe(0);
        expect(ftsBytes(db).includes(v.slice(3, 15))).toBe(false);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
      } finally { db.close(); }
    });

    it('F1 (review 316): the ingest-time index text is the re-derivation text, so a value glued to an escape in an Edit input behind an unterminated PEM header is never indexed once learned', () => {
      const box = IX.newBox('ccrc-hist-order-');
      const BS = String.fromCharCode(92);
      const v = `zqt${hex(12)}8`;
      // Source key order is old_string, new_string; canonicalJson (the stored blob) sorts them to new_string, old_string.
      // The PEM shape runs to the end of the text, so which part comes first decides which part it masks.
      const input = {
        file_path: '/home/u/tree/a.py',
        old_string: `msg = "a${BS}n${v}"`,
        new_string: 'if l.startswith("-----BEGIN RSA PRIVATE KEY-----"):',
      };
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, 'go', 1),
        IX.assistant(IX.uuidN(2), IX.uuidN(1), [{ type: 'tool_use', id: 'toolu_01FFF', name: 'Edit', input }], 2),
      ]));
      IX.sweepTwice(box);
      secretFile(box, 'order.env', `ZQ_ORDER_VALUE=${v}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      const db = openStoreRO(box);
      try {
        expect(matches(db, '"nzqt"*')).toBe(0);
        expect(ftsBytes(db).includes(v.slice(3, 15))).toBe(false);
        expect(matches(db, 'msg')).toBe(0);                                  // the part the PEM masks, in the stored order
        expect(IX.blobsHold(db, v)).toBe(true);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
      } finally { db.close(); }
    });

    it('rederiveFts resumes from its durable cursor, re-indexes only blobs whose re-derivation hit an owed pair, and moves the mark to its own target, never to a pair learned mid-generation', async () => {
      const box = IX.newBox('ccrc-hist-rederive-');
      const a = `zqm${hex(12)}6`;
      const b = `zqn${hex(12)}7`;
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, `note \u00e9${b} end`, 1),
        IX.user(IX.uuidN(2), IX.uuidN(1), `note \u00e9${a} end`, 2),
      ]));
      IX.sweepTwice(box);
      const { sweep: S, store, lib } = await IX.api();
      const P = lib.historyPaths(box.home);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      const w = store.openWriter(P.dbFile);
      try {
        const Y = rowidOf(w, '"ezqn"*');                    // holds b
        const X = rowidOf(w, '"ezqm"*');                    // holds a
        expect(Y).toBeLessThan(X);                           // CONTROL: blob order is row order
        expect(IX.count(w, 'blobs', 'fts_indexed = 1')).toBe(2);
        const E = (w.prepare('SELECT max(blob_id) AS id FROM blobs').get() as { id: number }).id;
        const m0 = metaV(w, 'fts_reindex_rid');
        const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
        secretFile(box, 'a.env', `ZQ_A=${a}\n`);
        S.secretsStep(w, ctx, []);
        const ra = maxRid(w);
        ctx.fts = S.ftsPrepare(w, ctx.nowMs).tables;
        const one = () => S.newBudget(Date.now, { maxBytes: 1 });
        expect(await S.rederiveFts(w, ctx, one())).toEqual({ state: 'running', reindexed: 0 });     // Y examined, no owed hit; X waits
        expect(metaV(w, 'fts_reindex_rid')).toBe(m0);
        expect(lib.parseRederiveState(metaV(w, 'fts_rederive'))).toEqual({ target: ra, cursor: Y, end: E });
        secretFile(box, 'b.env', `ZQ_B=${b}\n`);
        S.secretsStep(w, ctx, []);
        const rb = maxRid(w);
        expect(rb).toBeGreaterThan(ra);
        expect(await S.rederiveFts(w, ctx, one())).toEqual({ state: 'completed', reindexed: 1 });   // X re-indexed for a
        expect(metaV(w, 'fts_reindex_rid')).toBe(String(ra));   // its own target: Y was read before b was learned
        expect(matches(w, '"ezqm"*')).toBe(0);
        expect(matches(w, '"ezqn"*')).toBe(1);
        expect(await S.rederiveFts(w, ctx, one())).toEqual({ state: 'running', reindexed: 1 });     // b's generation: Y re-indexed
        expect(await S.rederiveFts(w, ctx, one())).toEqual({ state: 'completed', reindexed: 0 });   // X holds no owed value
        expect(metaV(w, 'fts_reindex_rid')).toBe(String(rb));
        expect(matches(w, '"ezqn"*')).toBe(0);
      } finally { w.close(); }
    });

    it('F2 (review 344): while a generation is open the phrase path searches only the values whose pairs its tick recorded, so a blob it cannot clean is not re-indexed on every tick', async () => {
      const { sweep: S, store, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-f2p-');
      try {
        // Printed with its own `-` as spaces: a phrase of its unit still finds it (unicode61 drops both), and no piece
        // reaches SECRET_SEGMENT_MIN, so neither the pair, its glue windows nor the belt removes it (W1-B2 Task 7A).
        const v = `zqf${hex(4)}-${hex(5)}-${hex(4)}2`;
        const spaced = v.replace(/-/g, ' ');
        const u = `zqu${hex(12)}5`;   // stand-alone: the redaction removes it
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
          IX.user(IX.uuidN(1), null, `note ${u} end`, 1),
          IX.user(IX.uuidN(2), IX.uuidN(1), `note ${spaced} tail end`, 2),
          IX.user(IX.uuidN(3), IX.uuidN(2), `note ${spaced} other end`, 3),
          IX.user(IX.uuidN(4), IX.uuidN(3), `note ${spaced} tail two end`, 4),
        ]));
        IX.sweepTwice(box);
        const P = lib.historyPaths(box.home);
        const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
        const w = store.openWriter(P.dbFile);
        try {
          expect(IX.count(w, 'blobs', 'fts_indexed = 1'), 'CONTROL: four indexed blobs, so a one-blob slice keeps the generation open for three ticks').toBe(4);
          const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
          ctx.fts = S.ftsPrepare(w, ctx.nowMs).tables;
          // The tick's secrets step, then its two re-index steps in its order; the re-derivation reads one blob a tick.
          const tick = async (): Promise<number> => {
            const secrets = S.secretsStep(w, ctx, []);
            ctx.pairIdx = secrets.pairIdx;
            const n = await S.reindexForValues(w, ctx, secrets.values, secrets.newValues, S.newBudget());
            await S.rederiveFts(w, ctx, S.newBudget(Date.now, { maxBytes: 1 }));
            return n;
          };
          secretFile(box, 'v.env', `ZQ_V=${v}\n`);
          const seen: number[] = [];
          seen.push(await tick());                                    // the opening tick: no generation is open yet
          const ra = maxRid(w);
          expect(lib.parseRederiveState(metaV(w, 'fts_rederive'))?.target, 'CONTROL: the generation is open').toBe(ra);
          expect(matches(w, `"${u}"`), 'CONTROL: u is indexed in clear, its blob behind the cursor').toBe(1);
          expect(rowidOf(w, `"${u}"`), 'CONTROL: u\'s blob lies behind the cursor').toBeLessThanOrEqual(lib.parseRederiveState(metaV(w, 'fts_rederive'))!.cursor);
          secretFile(box, 'u.env', `ZQ_U=${u}\n`);                   // learned mid-generation
          seen.push(await tick());
          expect(matches(w, `"${u}"`), 'the recording tick searched the value learned mid-generation').toBe(0);
          seen.push(await tick());
          seen.push(await tick());                                    // this tick's re-derivation completes the generation
          expect(metaV(w, 'fts_reindex_rid')).toBe(String(ra));
          seen.push(await tick());                                    // u is owed again, and its blob is already clean
          expect(seen).toEqual([3, 1, 0, 0, 0]);
          expect(matches(w, `"${v}"`), 'CONTROL: the shape: the spaced value stays in the index, a phrase still finds all three').toBe(3);
        } finally { w.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it.each([['the run budget', 'run'], ['the slice', 'slice']] as const)('F2 (review 344): the phrase path is charged to %s, and the blobs a cut run leaves are the generation\'s', async (_name, cut) => {
      const { sweep: S, store, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-f2b-');
      try {
        const v = `zqb${hex(12)}3`;
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
          IX.user(IX.uuidN(1), null, `note ${v} end`, 1),
          IX.user(IX.uuidN(2), IX.uuidN(1), `other ${v} tail`, 2),
          IX.user(IX.uuidN(3), IX.uuidN(2), `third ${v} word`, 3),
        ]));
        IX.sweepTwice(box);
        const P = lib.historyPaths(box.home);
        const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
        const w = store.openWriter(P.dbFile);
        try {
          expect(matches(w, `"${v}"`), 'CONTROL: three rows hold the value in clear').toBe(3);
          const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
          ctx.fts = S.ftsPrepare(w, ctx.nowMs).tables;
          secretFile(box, 'b.env', `ZQ_B=${v}\n`);
          const secrets = S.secretsStep(w, ctx, []);
          ctx.pairIdx = secrets.pairIdx;
          const tiny = () => S.newBudget(Date.now, { maxBytes: 1 });
          const run = cut === 'run' ? tiny() : S.newBudget();
          const slice = cut === 'slice' ? tiny() : undefined;
          expect(await S.reindexForValues(w, ctx, secrets.values, secrets.newValues, run, slice), 'one blob, then the budget is spent').toBe(1);
          expect(matches(w, `"${v}"`)).toBe(2);
          expect(await S.rederiveFts(w, ctx, run, slice), 'the generation opens on what is left, and saves its cursor').toEqual({ state: 'running', reindexed: 0 });
          const again = S.secretsStep(w, ctx, []);
          expect(await S.reindexForValues(w, ctx, again.values, again.newValues, S.newBudget()), 'open, and nothing recorded this tick').toBe(0);
          expect((await S.rederiveFts(w, ctx, S.newBudget())).state).toBe('completed');
          expect(matches(w, `"${v}"`), 'the generation re-indexed what the cut run left').toBe(0);
          expect(metaV(w, 'fts_reindex_rid')).toBe(String(maxRid(w)));
        } finally { w.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('F2 (review 344): the tick charges the phrase path and the re-derivation to one shared slice of its run budget', () => {
      const src = fs.readFileSync(SWEEP, 'utf8');
      const at = src.indexOf('export async function tick(db, ctx) {');
      const body = src.slice(at, src.indexOf('\n}\n', at));
      expect(body).toMatch(/\n {2}const slice = rederiveSlice\(ctx\.budget\);\n/);
      expect(body).toMatch(/\n {2}await reindexForValues\(db, ictx, secrets\.values, secrets\.newValues, ctx\.budget, slice\);\n/);
      expect(body).toMatch(/\n {2}await rederiveFts\(db, ictx, ctx\.budget, slice\);\n/);
    });
  });

  describe('D-4419 (history-entry-index-text-windowed): an entry indexes its first ENTRY_FTS_BYTES, and every path writes that one text', () => {
    it('an entry past the window: its head is searchable and its tail is not, and a value learned later inside the window is re-indexed through the same window', () => {
      const box = IX.newBox('ccrc-hist-ewin-');
      const v = `zqw${hex(12)}5`;
      const text = `zqheadword note ${v} end ${'filler '.repeat(200_000)}zqtailword`;   // 1.4 MB: the tail lies past the window
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, text, 1)]));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try {
        expect(matches(db, 'zqheadword')).toBe(1);
        expect(matches(db, `"${v.slice(0, 6)}"*`)).toBe(1);   // CONTROL: the value is indexed in clear, its pair not known yet
        expect(matches(db, 'zqtailword')).toBe(0);             // past ENTRY_FTS_BYTES
        expect(IX.blobsHold(db, 'zqtailword')).toBe(true);     // the blob keeps it, verbatim
      } finally { db.close(); }
      secretFile(box, 'ewin.env', `ZQ_EWIN=${v}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, `"${v.slice(0, 6)}"*`)).toBe(0);
        expect(matches(db, 'zqheadword')).toBe(1);
        expect(matches(db, 'zqtailword')).toBe(0);             // the phrase path and the re-derivation wrote the windowed text too
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
      } finally { db.close(); }
    });

    it('census: sweep.mjs writes every index text through entryIndexText at its three insert sites, and never calls redactForIndex', () => {
      const code = fs.readFileSync(SWEEP, 'utf8').split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n');
      expect(code.match(/\bredactForIndex\(/g)).toBeNull();
      expect((code.match(/\bentryIndexText\(/g) ?? []).length).toBe(3);
      expect(code).toMatch(/f\.ins\.run\(blobId, entryIndexText\(text, pairIdx\)\)/);           // indexBlob: ingest, the backfill, a sidecar
      expect(code).toMatch(/f\.ins\.run\(g\.id, entryIndexText\(g\.text, ctx\.pairIdx\)\)/);   // reindexForValues, the phrase fast path
      expect(code).toMatch(/const final = entryIndexText\(t\.text, idx\);/);                  // rederiveFts
    });
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

    it('S6: the streamed arm (a sidecar over SIDECAR_READ_WHOLE_MAX) redacts the larger window before its cut as well', () => {
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

    it('FPM6: a streamed sidecar is indexed from the bytes it stored, never from a second read of the file', () => {
      // preload-faults' HISTORY_TEST_READ_SWAP passes the first read that sees zqorig and makes every later read of it see
      // zqswap, as a rewrite right after the first read would, logging each such read.
      const head = Buffer.from('zqfirst zqorig zqlast\n');
      const plant = (box: HistoryBox, name: string, size: number): void => {
        const fd = fs.openSync(sideFile(box, name), 'w');
        try {
          fs.writeSync(fd, head, 0, head.length, 0);
          fs.ftruncateSync(fd, size);                                    // a hole past the head, at no disk cost
        } finally { fs.closeSync(fd); }
      };
      const opts = (box: HistoryBox): { preloads: string[]; env: Record<string, string> } => ({
        preloads: [PRELOADS.faults],
        env: { HISTORY_TEST_READ_SWAP: 'zqorig:zqswap', HISTORY_TEST_READ_SWAP_LOG: path.join(box.home, 'swap.log') },
      });
      const swaps = (box: HistoryBox): string => (fs.existsSync(path.join(box.home, 'swap.log')) ? fs.readFileSync(path.join(box.home, 'swap.log'), 'utf8') : '');
      // CONTROL: two whole-read sidecars with one head. The second one's single read is swapped, so the seam fires, and each
      // blob's index text agrees with it because both come from that one read.
      const ctl = IX.newBox('ccrc-hist-fpm6c-');
      try {
        IX.plantCopy(ctl.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
        plant(ctl, 'one.txt', 4096);
        plant(ctl, 'two.txt', 4096);
        IX.sweepTwice(ctl, opts(ctl));
        expect(swaps(ctl)).toBe('read-swap 1\n');
        const db = openStoreRO(ctl);
        try {
          expect(IX.count(db, 'sidecars')).toBe(2);
          expect(matches(db, 'zqorig')).toBe(1);
          expect(matches(db, 'zqswap')).toBe(1);
          expect(IX.blobsHold(db, 'zqorig')).toBe(true);
          expect(IX.blobsHold(db, 'zqswap')).toBe(true);
        } finally { db.close(); }
      } finally { fs.rmSync(ctl.home, { recursive: true, force: true }); }
      const box = IX.newBox('ccrc-hist-fpm6-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
        plant(box, 'swap.txt', 67_108_864 + 4096);                       // over SIDECAR_READ_WHOLE_MAX: the streamed arm
        IX.sweepTwice(box, opts(box));
        expect(swaps(box)).toBe('');                                     // the file's head is read once, by the compress
        const db = openStoreRO(box);
        try {
          expect(IX.count(db, 'sidecars')).toBe(1);
          expect(matches(db, 'zqorig')).toBe(1);                         // what the stored blob holds
          expect(matches(db, 'zqswap')).toBe(0);
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

  describe('CP-39b: a sidecar over SIDECAR_READ_WHOLE_MAX is captured by the streamed arm (D-6971, D-6973)', () => {
    /** `size` bytes of IX.words text (4000-word pieces cut to size): the bytes themselves. */
    const wordBytes = (size: number): Buffer => {
      const out = Buffer.alloc(size);
      for (let at = 0, k = 1; at < size; k += 1) at += Buffer.from(IX.words(4000, k)).copy(out, at, 0, size - at);
      return out;
    };
    const sha256Of = (b: Buffer): Buffer => createHash('sha256').update(b).digest();
    const tool = (box: HistoryBox): string => {
      const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    /** One box with one transcript and a store in this process; no ingestTick, so the transcript reads as caught up. */
    const inProcess = async (prefix: string) => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox(prefix);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      const { db, ids } = await IX.openFixtureStore(box);
      const run = (): Promise<{ bytes: number; complete: boolean; paused: boolean }> =>
        S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(), [IX.U]);
      return { box, db, lib, run };
    };
    const rowOf = (db: DatabaseSync, name: string): { sha: Buffer; len: number; z: Buffer } => {
      const r = db.prepare(`SELECT b.sha256 AS sha, b.raw_len AS len, b.z AS z FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id
        WHERE s.name = ?`).get(name) as { sha: Uint8Array; len: number; z: Uint8Array };
      return { sha: Buffer.from(r.sha), len: r.len, z: Buffer.from(r.z) };
    };
    /** For each sidecar file named in `names`, the largest `length` a readSync asks for and the buffer objects it passes. */
    const spyReads = (names: string[]): { seen: Map<string, { max: number; bufs: Set<unknown> }>; restore: () => void } => {
      const real = fs.readSync;
      const seen = new Map<string, { max: number; bufs: Set<unknown> }>();
      (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
        const base = path.basename(fs.readlinkSync(`/proc/self/fd/${fd}`));
        if (names.includes(base)) {
          const e = seen.get(base) ?? { max: 0, bufs: new Set<unknown>() };
          e.max = Math.max(e.max, Number(rest[2]));
          e.bufs.add(rest[0]);
          seen.set(base, e);
        }
        return (real as (...a: unknown[]) => number)(fd, ...rest);
      };
      syncBuiltinESMExports();
      return { seen, restore: () => { (fs as { readSync: unknown }).readSync = real; syncBuiltinESMExports(); } };
    };

    it('(a) the threshold is 8 MiB, below SIDECAR_WHOLE_MAX', async () => {
      const { lib } = await IX.api();
      expect(lib.SIDECAR_READ_WHOLE_MAX).toBe(8 * 1024 * 1024);
      expect(lib.SIDECAR_READ_WHOLE_MAX).toBeLessThan(lib.SIDECAR_WHOLE_MAX);
    });

    it('(b) a sidecar of exactly the threshold is read whole; one byte more is streamed through ONE reused buffer, both stored byte for byte', async () => {
      const { box, db, lib, run } = await inProcess('ccrc-hist-cp39b-b-');
      const M = lib.SIDECAR_READ_WHOLE_MAX;
      const spy = spyReads(['at.txt', 'over.txt']);
      try {
        const dir = tool(box);
        const atBytes = wordBytes(M);
        const overBytes = wordBytes(M + 1);
        fs.writeFileSync(path.join(dir, 'at.txt'), atBytes);
        fs.writeFileSync(path.join(dir, 'over.txt'), overBytes);
        await run();
        const at = spy.seen.get('at.txt');
        const over = spy.seen.get('over.txt');
        expect(at, 'CONTROL: at.txt was read').toBeDefined();
        expect(over, 'CONTROL: over.txt was read').toBeDefined();
        expect(at!.max).toBe(M);
        expect(over!.max).toBeLessThanOrEqual(1 << 20);
        expect(over!.bufs.size, 'every read of over.txt passed one buffer object').toBe(1);
        const a = rowOf(db, 'at.txt');
        const o = rowOf(db, 'over.txt');
        expect({ sha: a.sha, len: a.len }).toEqual({ sha: sha256Of(atBytes), len: M });
        expect({ sha: o.sha, len: o.len }).toEqual({ sha: sha256Of(overBytes), len: M + 1 });
        expect(brotliDecompressSync(o.z).equals(overBytes)).toBe(true);
      } finally {
        spy.restore();
        db.close();
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    }, 300_000);

    it('(c) a sidecar just over the threshold has its secret out of the index and its far word out of the window, as the whole arm does', async () => {
      const { lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-cp39b-c-');
      const tok = hex(24);
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      try {
        const size = lib.SIDECAR_READ_WHOLE_MAX + 4096;
        const body = wordBytes(size);   // real words over the whole index window; zqhead and zqfarword are tokens IX.words never makes
        const head = Buffer.from(`zqhead\nZQ_SIDE_VALUE=${tok}\n`);
        head.copy(body, 0);
        Buffer.from('\nzqfarword\n').copy(body, lib.SIDECAR_FTS_BYTES + lib.SIDECAR_REDACT_MARGIN + 1024);
        fs.writeFileSync(path.join(dir, 'over.txt'), body);
        IX.sweepTwice(box);
        const db = openStoreRO(box);
        try {
          expect(matches(db, 'zqhead'), 'CONTROL: the head word is indexed').toBe(1);
          expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
          expect(matches(db, 'zqfarword')).toBe(0);
          expect(IX.blobsHold(db, tok)).toBe(true);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    }, 300_000);

    it('(d) an incompressible sidecar over the threshold is stored with its sha256 and raw_len, and its blob decodes to its bytes', async () => {
      const { box, db, lib, run } = await inProcess('ccrc-hist-cp39b-d-');
      try {
        const bytes = randomBytes(lib.SIDECAR_READ_WHOLE_MAX + 4096);
        fs.writeFileSync(path.join(tool(box), 'rand.bin'), bytes);
        await run();
        const r = rowOf(db, 'rand.bin');
        expect({ sha: r.sha, len: r.len }).toEqual({ sha: createHash('sha256').update(bytes).digest(), len: bytes.length });
        expect(brotliDecompressSync(r.z).equals(bytes)).toBe(true);
      } finally {
        db.close();
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    }, 300_000);

    it('(e) two names with the same over-threshold bytes give one blob and two sidecars rows', async () => {
      const { box, db, lib, run } = await inProcess('ccrc-hist-cp39b-e-');
      try {
        const size = lib.SIDECAR_READ_WHOLE_MAX + 4096;
        const bytes = wordBytes(size);
        const sha = sha256Of(bytes);
        fs.writeFileSync(path.join(tool(box), 'a.txt'), bytes);
        fs.copyFileSync(path.join(tool(box), 'a.txt'), path.join(tool(box), 'b.txt'));
        await run();
        expect(IX.count(db, 'sidecars')).toBe(2);
        const blobs = db.prepare('SELECT blob_id AS id FROM blobs WHERE sha256 = ?').all(sha) as { id: number }[];
        expect(blobs.length).toBe(1);
        expect(IX.count(db, 'sidecars', `blob_id = ${blobs[0]!.id}`)).toBe(2);
      } finally {
        db.close();
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    }, 300_000);
    /** node:zlib's `createBrotliCompress` replaced by `make` (its exports are configurable, not writable); `restore` puts it back. */
    const stubBrotli = async (make: () => Transform): Promise<() => void> => {
      const zlib = (await import('node:zlib')).default;
      const real = Object.getOwnPropertyDescriptor(zlib, 'createBrotliCompress')!;
      Object.defineProperty(zlib, 'createBrotliCompress', { ...real, value: make });
      syncBuiltinESMExports();
      return () => { Object.defineProperty(zlib, 'createBrotliCompress', real); syncBuiltinESMExports(); };
    };

    it('(f) a compressor error, in either shape zlib reports it, rejects compressFdRange and leaves no unhandled rejection (D-6973)', async () => {
      const { store } = await IX.api();
      const box = IX.newBox('ccrc-hist-cp39b-f-');
      const seen: unknown[] = [];
      const onUnhandled = (e: unknown): void => { seen.push(e); };
      const boom = new Error('cp39b-f: the compressor failed on its second write');
      process.on('unhandledRejection', onUnhandled);
      let fd = -1;
      let timer: NodeJS.Timeout | undefined;
      let restore: (() => void) | undefined;
      try {
        const file = path.join(box.home, 'range.bin');
        fs.writeFileSync(file, Buffer.alloc(3 * (1 << 20), 0x61));   // three RANGE_PIECE pieces
        fd = fs.openSync(file, 'r');
        // 'native': zlib's own error path destroys the stream with the error and never runs the in-flight write's callback.
        // 'callback': the write callback itself carries the error.
        for (const shape of ['native', 'callback'] as const) {
          restore = await stubBrotli(() => {
            let writes = 0;
            return new Transform({
              transform(chunk: Buffer, _enc, cb) {
                writes += 1;
                if (writes !== 2) cb(null, chunk);
                else if (shape === 'native') this.destroy(boom);
                else cb(boom);
              },
            });
          });
          const outcome = await Promise.race([
            store.compressFdRange(fd, 0, 3 * (1 << 20)).then(() => ({ kind: 'resolved' as const }), (e: unknown) => ({ kind: 'rejected' as const, e })),
            new Promise<{ kind: 'timeout' }>((res) => { timer = setTimeout(() => res({ kind: 'timeout' }), 5000); }),
          ]);
          clearTimeout(timer);
          restore(); restore = undefined;
          expect(outcome.kind === 'timeout', `${shape}: compressFdRange did not settle within 5 s`).toBe(false);
          expect(outcome, `${shape}: it rejects`).toMatchObject({ kind: 'rejected' });
          expect((outcome as { e: unknown }).e, `${shape}: with the compressor's error`).toBe(boom);
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setImmediate(r));
          expect(seen, `${shape}: no rejection was left unhandled`).toEqual([]);
        }
      } finally {
        clearTimeout(timer);
        restore?.();
        process.off('unhandledRejection', onUnhandled);
        if (fd >= 0) fs.closeSync(fd);
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    }, 60_000);

    it('(g) a read error mid-range rejects compressFdRange and destroys the encoder (D-6973)', async () => {
      const { store } = await IX.api();
      const box = IX.newBox('ccrc-hist-cp39b-g-');
      const boom = new Error('cp39b-g: the read failed on its second piece');
      const made: Transform[] = [];
      const realRead = fs.readSync;
      let fd = -1;
      let restoreBrotli: (() => void) | undefined;
      try {
        const file = path.join(box.home, 'range.bin');
        fs.writeFileSync(file, Buffer.alloc(3 * (1 << 20), 0x61));
        fd = fs.openSync(file, 'r');
        restoreBrotli = await stubBrotli(() => {
          const t = new Transform({ transform(chunk: Buffer, _enc, cb) { cb(null, chunk); } });
          made.push(t);
          return t;
        });
        let reads = 0;
        (fs as { readSync: unknown }).readSync = function readSync(rfd: number, ...rest: unknown[]): number {
          if (rfd === fd) { reads += 1; if (reads === 2) throw boom; }
          return (realRead as (...a: unknown[]) => number)(rfd, ...rest);
        };
        syncBuiltinESMExports();
        await expect(store.compressFdRange(fd, 0, 3 * (1 << 20))).rejects.toBe(boom);
        expect(reads, 'CONTROL: the second read is the one that threw').toBe(2);
        expect(made.length, 'CONTROL: the stub encoder was the one used').toBe(1);
        expect(made[0]!.destroyed, 'the encoder was destroyed').toBe(true);
      } finally {
        (fs as { readSync: unknown }).readSync = realRead;
        syncBuiltinESMExports();
        restoreBrotli?.();
        if (fd >= 0) fs.closeSync(fd);
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    });

    it('(h) a short read destroys the encoder and answers null (987 F1)', async () => {
      const { store } = await IX.api();
      const box = IX.newBox('ccrc-hist-cp39b-h-');
      const made: Transform[] = [];
      const realRead = fs.readSync;
      let fd = -1;
      let restoreBrotli: (() => void) | undefined;
      try {
        const file = path.join(box.home, 'range.bin');
        fs.writeFileSync(file, Buffer.alloc(3 * (1 << 20), 0x61));
        fd = fs.openSync(file, 'r');
        restoreBrotli = await stubBrotli(() => {
          const t = new Transform({ transform(chunk: Buffer, _enc, cb) { cb(null, chunk); } });
          made.push(t);
          return t;
        });
        let reads = 0;
        (fs as { readSync: unknown }).readSync = function readSync(rfd: number, ...rest: unknown[]): number {
          if (rfd === fd) { reads += 1; if (reads === 2) return 0; }
          return (realRead as (...a: unknown[]) => number)(rfd, ...rest);
        };
        syncBuiltinESMExports();
        expect(await store.compressFdRange(fd, 0, 3 * (1 << 20))).toBeNull();
        expect(reads, 'CONTROL: the second read is the one that came back short').toBe(2);
        expect(made.length, 'CONTROL: the stub encoder was the one used').toBe(1);
        expect(made[0]!.destroyed, '(h) the encoder was destroyed').toBe(true);
      } finally {
        (fs as { readSync: unknown }).readSync = realRead;
        syncBuiltinESMExports();
        restoreBrotli?.();
        if (fd >= 0) fs.closeSync(fd);
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    });

    it('(i) a throw from the piece\'s allocation destroys the encoder (987 F5)', async () => {
      const { store } = await IX.api();
      const box = IX.newBox('ccrc-hist-cp39b-i-');
      const mark = new Error('cp39b-i: the piece could not be allocated');
      const made: Transform[] = [];
      const realAlloc = Buffer.allocUnsafe;
      let fd = -1;
      let restoreBrotli: (() => void) | undefined;
      let asked = 0;
      try {
        const file = path.join(box.home, 'range.bin');
        fs.writeFileSync(file, Buffer.alloc(777_777, 0x61));
        fd = fs.openSync(file, 'r');
        restoreBrotli = await stubBrotli(() => {
          const t = new Transform({ transform(chunk: Buffer, _enc, cb) { cb(null, chunk); } });
          made.push(t);
          return t;
        });
        // vi.spyOn(Buffer, 'allocUnsafe') in effect: the real function for every size but the piece's.
        (Buffer as { allocUnsafe: unknown }).allocUnsafe = function allocUnsafe(size: number): Buffer {
          if (size === 777_777) { asked += 1; throw mark; }
          return realAlloc.call(Buffer, size);
        };
        await expect(store.compressFdRange(fd, 0, 777_777)).rejects.toBe(mark);
        expect(asked, 'CONTROL: the piece\'s allocation is the call that threw').toBe(1);
        expect(made.length, 'CONTROL: the stub encoder was the one used').toBe(1);
        expect(made[0]!.destroyed, '(i) the encoder was destroyed').toBe(true);
      } finally {
        (Buffer as { allocUnsafe: unknown }).allocUnsafe = realAlloc;
        restoreBrotli?.();
        if (fd >= 0) fs.closeSync(fd);
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    });

    it('CP-39d carry (o) a compressor error leaves the tick instead of hanging it (987 F6)', async () => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-cp39d-o-');
      const { text, longStart } = longLineCase(lib.LINE_MAX);
      const p = IX.plantCopy(box.homes[0]!, IX.U, text);
      const { db, ids } = await IX.openFixtureStore(box);
      const mark = new Error('cp39d-o');   // no syscall: not an OS error
      const unreadable = (): number => (db.prepare('SELECT n FROM counters WHERE name = ?').get('file_unreadable') as { n: number } | undefined)?.n ?? 0;
      let constructed = 0;
      let timer: NodeJS.Timeout | undefined;
      let restore: (() => void) | undefined;
      /** The call's outcome, or a timeout after 10 s. */
      const settle = <T,>(call: Promise<T>) => Promise.race([
        call.then(() => ({ kind: 'resolved' as const }), (e: unknown) => ({ kind: 'rejected' as const, e })),
        new Promise<{ kind: 'timeout' }>((res) => { timer = setTimeout(() => res({ kind: 'timeout' }), 10_000); }),
      ]);
      try {
        restore = await stubBrotli(() => {
          constructed += 1;
          return new Transform({ transform(_chunk: Buffer, _enc, cb) { cb(mark); } });
        });
        const f = { path: p, uuid: IX.U, home: box.homes[0]! };
        const viaPath = await settle(S.ingestPath(db, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), f, S.newBudget()));
        clearTimeout(timer);
        expect(constructed, 'CONTROL: the stub encoder was constructed').toBeGreaterThanOrEqual(1);
        expect(viaPath.kind === 'timeout', 'ingestPath did not settle within 10 s').toBe(false);
        expect(viaPath, '(o) ingestPath resolved').toMatchObject({ kind: 'rejected' });
        expect((viaPath as { e: unknown }).e, 'with the compressor\'s error').toBe(mark);
        const fileId = (db.prepare('SELECT file_id AS id FROM ingest_files').get() as { id: number }).id;
        expect(IX.cursorOf(db, fileId)).toBeLessThanOrEqual(longStart);
        const before = unreadable();
        const viaTick = await settle(S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, Date.now(), ids), S.newBudget()));
        clearTimeout(timer);
        expect(viaTick.kind === 'timeout', 'ingestTick did not settle within 10 s').toBe(false);
        expect(viaTick, '(o) ingestTick resolved: a compressor error was counted unreadable').toMatchObject({ kind: 'rejected' });
        expect((viaTick as { e: unknown }).e).toBe(mark);
        expect(unreadable(), 'a compressor error is not a file_unreadable').toBe(before);
        expect(IX.cursorOf(db, fileId)).toBeLessThanOrEqual(longStart);
      } finally {
        clearTimeout(timer);
        restore?.();
        db.close();
        fs.rmSync(box.home, { recursive: true, force: true });
      }
    }, 120_000);
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
      const r = await S.ftsTextOfBlob(q5(raw), true, idx, raw.length);
      if (r.text === null) throw new Error('the blob did not decode');
      expect(r.undecodable).toBe(false);
      expect(r.decoded).toBeLessThan(BOUND + 128 * 1024);
      expect(r.text).toBe(lib.sidecarIndexText(raw.subarray(0, BOUND), idx));
      expect(r.text).toContain('zqhead');
      expect(r.text).not.toContain('zqtail');
      const entryBody = Buffer.from(JSON.stringify('an entry body'));
      const e = await S.ftsTextOfBlob(q5(entryBody), false, idx, entryBody.length);
      expect(e.undecodable).toBe(false);
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
  describe('D-4336 (history-sidecar-index-text-unescaped, FR1-a): a JSON-format sidecar is indexed from its unescaped text', () => {
    const q5 = (b: Buffer): Buffer => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } });
    const sideFile = (box: HistoryBox, name: string): string => {
      const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, name);
    };
    const skShape = (tail: string): string => `${['sk', 'ant', 'api03'].join('-')}-${tail}`;
    const jsonSidecar = (tok: string, sk: string): Buffer =>
      Buffer.from(JSON.stringify([{ type: 'text', text: `zqhead\n${tok}\nzqmid\t${sk}\nzqend` }]));

    it('ingest arm: a value after a newline escape and an sk- shape after a tab escape never reach the index; the words around them do', () => {
      const box = IX.newBox('ccrc-hist-fr1a-');
      const tok = hex(24); const skTail = hex(20);
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(sideFile(box, 'out.json'), jsonSidecar(tok, skShape(skTail)));
      IX.sweepTwice(box);
      const db = openStoreRO(box);
      try {
        expect(matches(db, 'zqhead')).toBe(1);
        expect(matches(db, 'zqmid')).toBe(1);                          // CONTROL: the escapes are undone, so the next run is its own word
        expect(matches(db, 'zqend')).toBe(1);
        expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
        expect(ftsBytes(db).includes(skTail.slice(0, 12))).toBe(false);
        expect(IX.blobsHold(db, tok)).toBe(true);                      // the blob keeps its bytes verbatim
      } finally { db.close(); }
    });

    it('re-index arm: a value learned after the sidecar was indexed is found by its phrase and purged', () => {
      const box = IX.newBox('ccrc-hist-fr1a-r-');
      const tok = hex(24);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(sideFile(box, 'out.json'), jsonSidecar(tok, skShape(hex(20))));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try { expect(matches(db, `"${tok}"`)).toBe(1); } finally { db.close(); }   // CONTROL: indexed in clear, the pair is not known yet
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, `"${tok}"`)).toBe(0);
        expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
        expect(matches(db, 'zqhead')).toBe(1);
      } finally { db.close(); }
    });

    it('backfill and re-index text arm (ftsTextOfBlob): a stored JSON sidecar blob gives text with neither secret in it', async () => {
      const { sweep: S, lib } = await IX.api();
      const tok = hex(24); const skTail = hex(20);
      const idx = lib.makePairIndex(lib.secretPairs([tok]).pairs);
      const sc = jsonSidecar(tok, skShape(skTail));
      const r = await S.ftsTextOfBlob(q5(sc), true, idx, sc.length);
      if (r.text === null) throw new Error('the blob did not decode');
      expect(r.text.includes(tok.slice(0, 12))).toBe(false);
      expect(r.text.includes(skTail.slice(0, 12))).toBe(false);
      expect(r.text).toContain('zqhead');
      expect(r.text).toContain('zqend');
    });

    it('a plain-text sidecar indexes as before', () => {
      const box = IX.newBox('ccrc-hist-fr1a-p-');
      const tok = hex(24);
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(sideFile(box, 'out.txt'), `zqhead\n${tok}\nzqend\n`);
      IX.sweepTwice(box);
      const db = openStoreRO(box);
      try {
        expect(matches(db, 'zqhead')).toBe(1);
        expect(matches(db, 'zqend')).toBe(1);
        expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
      } finally { db.close(); }
    });
  });
  describe('D-4346 (history-permanent-failures-classified): a stored blob that does not decode is passed over, never thrown', () => {
    const q5 = (b: Buffer): Buffer => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } });
    const counterOf = (db: DatabaseSync, name: string): number | undefined => (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;
    const BAD = Buffer.from('zq-not-brotli');
    const sideDir = (box: HistoryBox): string => {
      const dir = path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };

    it('ftsTextOfBlob answers undecodable for garbage, truncated and empty bytes, in both arms, and never rejects', async () => {
      const { sweep: S } = await IX.api();
      const idx = (await IX.api()).lib.makePairIndex([]);
      const small = q5(Buffer.from(JSON.stringify('an entry body')));
      for (const isSidecar of [true, false]) {
        for (const z of [BAD, small.subarray(0, Math.floor(small.length / 2)), Buffer.alloc(0)]) {
          await expect(S.ftsTextOfBlob(z, isSidecar, idx, 1000), `${isSidecar} ${z.length}`).resolves.toEqual({ text: null, decoded: 0, undecodable: true });
        }
      }
      await expect(S.ftsTextOfBlob(small, false, idx, 15)).resolves.toEqual({ text: 'an entry body', decoded: 15, undecodable: false });   // CONTROL
    });

    it('the backfill passes an undecodable body blob and an undecodable sidecar blob over, counts each once, and indexes the rest in the same run', async () => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-undec-bf-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqentry words', 1)]));
        const dir = sideDir(box);
        for (const n of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `${n}.txt`), `zqside${n} ${IX.words(200, n.charCodeAt(0))}\n`);
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick: nothing indexed
          const total = IX.count(db, 'blobs');
          expect(total).toBeGreaterThanOrEqual(4);
          const entryBlob = (db.prepare('SELECT blob_id AS id FROM entries').get() as { id: number }).id;
          const sideBlob = (db.prepare("SELECT blob_id AS id FROM sidecars WHERE name = 'a.txt'").get() as { id: number }).id;
          for (const id of [entryBlob, sideBlob]) db.prepare('UPDATE blobs SET z = ? WHERE blob_id = ?').run(BAD, id);
          const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000, ids);
          ctx.fts = S.ftsPrepare(db, ctx.nowMs).tables;
          ctx.pairIdx = lib.makePairIndex([]);
          await S.deriveFts(db, ctx, S.newBudget());
          expect(metaV(db, 'fts')).toBe('ready');
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(2);
          expect(IX.count(db, 'blobs', `fts_indexed = 0 AND blob_id IN (${entryBlob}, ${sideBlob})`)).toBe(2);
          expect(IX.count(db, 'blobs', 'fts_indexed = 1')).toBe(total - 2);
          expect(matches(db, 'zqsideb')).toBe(1);
          expect(matches(db, 'zqsidea')).toBe(0);
          expect(matches(db, 'zqentry')).toBe(0);
          await S.deriveFts(db, ctx, S.newBudget());
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(2);   // a second pass does not recount
          // F3: each pass-over is classified by the decoder mode that failed it, in a sparse meta row that holds the blob id and
          // the mode word only; the blob stays unindexed (D-4346), and the classification is what keeps it from being owed.
          const classes = db.prepare("SELECT k, v FROM meta WHERE k LIKE 'fts\\_undecodable:%' ESCAPE '\\' ORDER BY k").all() as { k: string; v: string }[];
          expect(Object.fromEntries(classes.map((c) => [c.k, c.v]))).toEqual({ [`fts_undecodable:${entryBlob}`]: 'entry', [`fts_undecodable:${sideBlob}`]: 'sidecar' });
          expect(classes).toHaveLength(2);
          const stamp = (): unknown => db.prepare("SELECT cursor, completed_ms FROM derivation_state WHERE step = 'fts' AND version = 1").get();
          const done = stamp();
          expect((done as { completed_ms: number | null }).completed_ms).not.toBeNull();
          // Repeated healthy ticks (ftsPrepare, then deriveFts) neither re-open the store nor recount the same mode.
          for (let k = 1; k <= 3; k += 1) {
            const c = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000 + k * 60_000, ids);
            const prep = S.ftsPrepare(db, c.nowMs);
            expect(prep.state, `tick ${k}: not re-opened`).toBe('ready');
            c.fts = prep.tables;
            c.pairIdx = lib.makePairIndex([]);
            await S.deriveFts(db, c, S.newBudget());
            expect(stamp(), `tick ${k}`).toEqual(done);
            expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable), `tick ${k}`).toBe(2);
            expect(IX.count(db, 'blobs', `fts_indexed = 0 AND blob_id IN (${entryBlob}, ${sideBlob})`)).toBe(2);
          }
          // An unclassified legacy pass-over is retried once, classified, and then left alone.
          db.prepare("DELETE FROM meta WHERE k LIKE 'fts\\_undecodable:%' ESCAPE '\\'").run();
          const legacy = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 600_000, ids);
          const prepL = S.ftsPrepare(db, legacy.nowMs);
          expect(prepL.state, 'an unclassified failure is owed once').toBe('fts-pending');
          legacy.fts = prepL.tables;
          legacy.pairIdx = lib.makePairIndex([]);
          await S.deriveFts(db, legacy, S.newBudget());
          expect(db.prepare("SELECT k, v FROM meta WHERE k LIKE 'fts\\_undecodable:%' ESCAPE '\\' ORDER BY k").all()).toEqual(classes);
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(4);
          const legacyDone = stamp();
          for (let k = 1; k <= 2; k += 1) {
            const c = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 700_000 + k * 60_000, ids);
            expect(S.ftsPrepare(db, c.nowMs).state).toBe('ready');
            c.fts = true;
            c.pairIdx = lib.makePairIndex([]);
            await S.deriveFts(db, c, S.newBudget());
            expect(stamp()).toEqual(legacyDone);
            expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(4);
          }
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    /** One tick's FTS half as the sweep runs it: ftsPrepare (which may re-open), then deriveFts, on a clock that advances. */
    const ftsCycle = async (S: Awaited<ReturnType<typeof IX.api>>['sweep'], lib: Awaited<ReturnType<typeof IX.api>>['lib'], db: DatabaseSync, box: HistoryBox, ids: Parameters<typeof S.makeIngestCtx>[3], k: number): Promise<string> => {
      const c = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000 + k * 60_000, ids);
      const p = S.ftsPrepare(db, c.nowMs);
      c.fts = p.tables;
      c.pairIdx = lib.makePairIndex([]);
      await S.deriveFts(db, c, S.newBudget());
      return p.state;
    };
    const classOf = (db: DatabaseSync, blobId: number): string | undefined => metaV(db, `fts_undecodable:${blobId}`);

    it('F3: an entry-mode failure classified `entry` does not suppress the sidecar attempt once a sidecar references the same blob: the bounded decode succeeds, the blob is indexed, and its classification is cleared', async () => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-undec-mode-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqmode words', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'zqother words', 2)]));
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick
          const blob = (db.prepare('SELECT blob_id AS id FROM entries WHERE uuid = ?').get(IX.uuidN(1)) as { id: number }).id;
          // Whole brotli bytes whose stored raw_len is short of them: the whole-entry decode (bounded by raw_len) refuses, the sidecar's bounded prefix decode does not.
          db.prepare('UPDATE blobs SET raw_len = 1 WHERE blob_id = ?').run(blob);
          const z = (db.prepare('SELECT z FROM blobs WHERE blob_id = ?').get(blob) as { z: Uint8Array }).z;
          const idx = lib.makePairIndex([]);
          await expect(S.ftsTextOfBlob(z, false, idx, 1), 'CONTROL: entry mode cannot decode it').resolves.toMatchObject({ undecodable: true });
          const bounded = await S.ftsTextOfBlob(z, true, idx, 1);
          expect(bounded.undecodable, 'CONTROL: sidecar mode can').toBe(false);
          expect(bounded.text).toContain('zqmode');
          expect(await ftsCycle(S, lib, db, box, ids, 0)).toBe('fts-pending');
          expect(classOf(db, blob), 'classified by the mode that failed').toBe('entry');
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(1);
          expect(IX.count(db, 'blobs', `blob_id = ${blob} AND fts_indexed = 0`)).toBe(1);
          expect(await ftsCycle(S, lib, db, box, ids, 1), 'a healthy tick leaves the classified failure alone').toBe('ready');
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(1);
          // A sidecar whose bytes are the entry's canonical body deduplicates onto the very same blob.
          fs.writeFileSync(path.join(sideDir(box), 'mode.txt'), JSON.stringify('zqmode words'));
          await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 300_000, ids), S.newBudget(), [IX.U]);
          expect(IX.count(db, 'sidecars', `blob_id = ${blob}`), 'CONTROL: the sidecar references the same blob').toBe(1);
          expect(classOf(db, blob), 'CONTROL: still classified entry').toBe('entry');
          expect(await ftsCycle(S, lib, db, box, ids, 5), 'the current mode is sidecar, so the entry classification does not suppress it').toBe('fts-pending');
          expect(IX.count(db, 'blobs', `blob_id = ${blob} AND fts_indexed = 1`)).toBe(1);
          expect(matches(db, 'zqmode')).toBe(1);
          expect(classOf(db, blob), 'the stale classification is cleared').toBeUndefined();
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable), 'a successful attempt counts nothing').toBe(1);
          expect(await ftsCycle(S, lib, db, box, ids, 6)).toBe('ready');
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('F3: a successful index of a blob clears a stale failure classification (a classification of the other mode keeps it owed)', async () => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-undec-stale-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqstale words', 1)]));
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick
          const blob = (db.prepare('SELECT blob_id AS id FROM entries').get() as { id: number }).id;
          db.prepare("INSERT INTO meta (k, v) VALUES (?, 'sidecar')").run(`fts_undecodable:${blob}`);   // a mode this entry blob is no longer read in
          expect(classOf(db, blob), 'CONTROL: planted').toBe('sidecar');
          expect(await ftsCycle(S, lib, db, box, ids, 0)).toBe('fts-pending');
          expect(matches(db, 'zqstale'), 'indexed').toBe(1);
          expect(classOf(db, blob), 'and the stale classification is gone').toBeUndefined();
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable) ?? 0).toBe(0);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('the backfill marks an over-cap body indexed and inserts no row for it, as ingest leaves it (B3M3, FU5)', async () => {
      const { sweep: S, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-overcap-bf-');
      try {
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqovbf words', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'zqovctl words', 2)]));
        const { db, ids } = await IX.openFixtureStore(box);
        try {
          await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // no FTS this tick: nothing indexed
          const blobOf = (n: number): number => (db.prepare('SELECT blob_id AS id FROM entries WHERE uuid = ?').get(IX.uuidN(n)) as { id: number }).id;
          db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(lib.BLOB_DECODE_MAX + 1, blobOf(1));
          const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 120_000, ids);
          ctx.fts = S.ftsPrepare(db, ctx.nowMs).tables;
          ctx.pairIdx = lib.makePairIndex([]);
          await S.deriveFts(db, ctx, S.newBudget());
          expect(metaV(db, 'fts')).toBe('ready');
          expect(IX.count(db, 'blobs', `fts_indexed = 1 AND blob_id = ${blobOf(1)}`)).toBe(1);   // marked: the cursor moved past it
          expect(hasFtsRow(db, blobOf(2)), 'CONTROL: the other blob is indexed').toBe(true);
          expect(hasFtsRow(db, blobOf(1))).toBe(false);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('a late pair whose only indexed blob no longer decodes: the pass exits 0, the row is deleted, the value is not MATCHable, the mark advances, counted once', () => {
      const box = IX.newBox('ccrc-hist-undec-late-');
      const tok = hex(24); const tok2 = hex(24);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      fs.writeFileSync(path.join(sideDir(box), 'out.txt'), `zqhead\n${tok}\n${tok2}\nzqend\n`);
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      let ticksBefore = 0;
      try { expect(matches(db, `"${tok}"`)).toBe(1); ticksBefore = IX.count(db, 'ticks'); } finally { db.close(); }   // CONTROL: indexed in clear, the pair is not known yet
      const w = openWriter(historyPaths(box.home).dbFile);
      try { w.prepare('UPDATE blobs SET z = ? WHERE blob_id = (SELECT blob_id FROM sidecars)').run(BAD); } finally { closeWriter(w); }
      secretFile(box, 'side.env', `ZQ_SIDE_VALUE=${tok}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, `"${tok}"`)).toBe(0);
        expect(ftsBytes(db).includes(tok.slice(0, 12))).toBe(false);
        expect(counters(box)[HEALTH_COUNTERS.blobUndecodable]).toBe(1);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
        expect(IX.count(db, 'ticks')).toBe(ticksBefore + 1);
      } finally { db.close(); }
      const again = runSweep(box);
      expect(again.code, again.stderr).toBe(0);
      expect(counters(box)[HEALTH_COUNTERS.blobUndecodable]).toBe(1);
      // 3b: a second late pair the same undecodable blob holds: nothing is recounted, and the mark advances.
      secretFile(box, 'side2.env', `ZQ_SIDE_TWO=${tok2}\n`);
      const r2 = runSweep(box);
      expect(r2.code, r2.stderr).toBe(0);
      expect(counters(box)[HEALTH_COUNTERS.blobUndecodable]).toBe(1);
      db = openStoreRO(box);
      try { expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db))); } finally { db.close(); }
    });

    it('a late pair glued to a letter in an entry whose blob no longer decodes is reached only by the re-derivation, which deletes the row and never skips it (D-4344, D-4346)', () => {
      const box = IX.newBox('ccrc-hist-undec-glued-');
      const v = `zqc${hex(12)}3`;
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note \u00e9${v} end`, 1)]));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try { expect(matches(db, '"ezqc"*')).toBe(1); } finally { db.close(); }   // CONTROL: the glued term is indexed
      const w = openWriter(historyPaths(box.home).dbFile);
      try { w.prepare('UPDATE blobs SET z = ? WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(BAD, IX.uuidN(1)); } finally { closeWriter(w); }
      secretFile(box, 'c.env', `ZQ_C_VALUE=${v}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, '"ezqc"*')).toBe(0);
        expect(ftsBytes(db).includes(v.slice(3, 15))).toBe(false);
        expect(counters(box)[HEALTH_COUNTERS.blobUndecodable]).toBe(1);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
      } finally { db.close(); }
      const again = runSweep(box);
      expect(again.code, again.stderr).toBe(0);
      expect(counters(box)[HEALTH_COUNTERS.blobUndecodable]).toBe(1);
    });

    it('M10: a second generation over a blob that no longer decodes deletes nothing, so it reports reindexed 0 and registers no merge step (D-4346)', async () => {
      const { sweep: S, store, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-undec-gen2-');
      try {
        const a = `zqe${hex(12)}5`;
        const b = `zqf${hex(12)}6`;
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note é${a}${b} end`, 1)]));
        IX.sweepTwice(box);
        const P = lib.historyPaths(box.home);
        const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
        const db = store.openWriter(P.dbFile);
        try {
          expect(matches(db, '"ezqe"*')).toBe(1);   // CONTROL: indexed in full
          db.prepare('UPDATE blobs SET z = ? WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(BAD, IX.uuidN(1));
          const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
          secretFile(box, 'a.env', `ZQ_A=${a}\n`);
          S.secretsStep(db, ctx, []);
          ctx.fts = S.ftsPrepare(db, ctx.nowMs).tables;
          expect(await S.rederiveFts(db, ctx, S.newBudget())).toEqual({ state: 'completed', reindexed: 1 });   // the row is deleted: a change
          expect(matches(db, '"ezqe"*')).toBe(0);
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(1);
          db.prepare("UPDATE derivation_state SET completed_ms = ? WHERE step = 'fts-merge'").run(1);   // the merge step is idle: a second generation that deletes nothing must not reopen it
          secretFile(box, 'b.env', `ZQ_B=${b}\n`);
          S.secretsStep(db, ctx, []);
          expect(await S.rederiveFts(db, ctx, S.newBudget())).toEqual({ state: 'completed', reindexed: 0 });   // nothing left to delete: no change
          expect(counterOf(db, HEALTH_COUNTERS.blobUndecodable)).toBe(1);
          expect((db.prepare("SELECT completed_ms AS c FROM derivation_state WHERE step = 'fts-merge'").get() as { c: number | null }).c).toBe(1);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('B4M1: the phrase path keeps no row for an over-cap blob an earlier store indexed in full, and re-indexes a within-cap blob holding the same value (D-4346)', async () => {
      const { sweep: S, store, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-b4m1-');
      try {
        const v = `zqg${hex(12)}8`;
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
          IX.user(IX.uuidN(1), null, `note ${v} end`, 1),
          IX.user(IX.uuidN(2), IX.uuidN(1), `other ${v} tail`, 2),
        ]));
        IX.sweepTwice(box);
        const P = lib.historyPaths(box.home);
        const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
        const db = store.openWriter(P.dbFile);
        try {
          const blobOf = (n: number): number => (db.prepare('SELECT blob_id AS id FROM entries WHERE uuid = ?').get(IX.uuidN(n)) as { id: number }).id;
          expect(matches(db, `"${v}"`), 'CONTROL: both rows are indexed in full').toBe(2);
          // a store written before ingest withheld an over-cap body: the blob's raw_len says over the cap, its index row is whole
          db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(lib.BLOB_DECODE_MAX + 1, blobOf(1));
          expect(hasFtsRow(db, blobOf(1)), 'CONTROL: the over-cap blob holds a row before the call').toBe(true);
          const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
          secretFile(box, 'g.env', `ZQ_G_VALUE=${v}\n`);
          const secrets = S.secretsStep(db, ctx, []);
          ctx.pairIdx = secrets.pairIdx;
          ctx.fts = S.ftsPrepare(db, ctx.nowMs).tables;
          // the pair is above the mark, the phrase finds both blobs, and no sweep ran: only this arm decides the over-cap one
          expect(await S.reindexForValues(db, ctx, secrets.values, secrets.newValues, S.newBudget())).toBe(2);
          expect(hasFtsRow(db, blobOf(1)), 'the over-cap blob keeps no row, not an empty one').toBe(false);
          expect(hasFtsRow(db, blobOf(2)), 'CONTROL: the within-cap blob is re-indexed').toBe(true);
          expect(matches(db, `"${v}"`), 'CONTROL: the re-index redacted the value').toBe(0);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('M13: storedBody and pairedFromStore refuse a stored body whose raw_len is over BLOB_DECODE_MAX, though its bytes would decode (D-4346)', async () => {
      const { sweep: S, store, lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-m13-');
      try {
        const tu = { type: 'tool_use', id: 'toolu_01M13', name: 'Read', input: { file_path: '/home/u/tree/a.txt' } };
        IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
          IX.user(IX.uuidN(1), null, 'zqm13 words', 1),
          IX.assistant(IX.uuidN(2), IX.uuidN(1), [tu], 2),
        ]));
        IX.sweepTwice(box);
        const db = store.openWriter(lib.historyPaths(box.home).dbFile);
        try {
          const blobOf = (n: number): number => (db.prepare('SELECT blob_id AS id FROM entries WHERE uuid = ?').get(IX.uuidN(n)) as { id: number }).id;
          const over = (id: number): void => { db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(lib.BLOB_DECODE_MAX + 1, id); };
          const s = { blobZ: db.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?') };
          // storedBody: the variant compare's reader
          expect(S.storedBody(s, blobOf(1)), 'CONTROL: a small body is read').not.toBeNull();
          over(blobOf(1));
          expect(S.storedBody(s, blobOf(1))).toBeNull();
          // pairedFromStore: the walk up parentUuid; the tool_use sits in the row whose body is made over-cap
          expect(S.pairedFromStore(db, 'toolu_01M13', IX.uuidN(2)), 'CONTROL: the tool_use is found').toMatchObject({ id: 'toolu_01M13' });
          over(blobOf(2));
          expect(S.pairedFromStore(db, 'toolu_01M13', IX.uuidN(2))).toBeNull();
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    });

    it('a body whose stored raw_len is over BLOB_DECODE_MAX is never decompressed: it indexes empty and uncounted (D-4346)', async () => {
      const { sweep: S, lib } = await IX.api();
      const idx = lib.makePairIndex([]);
      const small = brotliCompressSync(Buffer.from(JSON.stringify([{ type: 'text', text: 'zqoversentinel' }])), { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } });
      await expect(S.ftsTextOfBlob(small, false, idx, lib.BLOB_DECODE_MAX + 1)).resolves.toEqual({ text: '', decoded: 0, undecodable: false, overCap: true });
      expect((await S.ftsTextOfBlob(small, false, idx, 1000)).text).toBe('zqoversentinel');   // CONTROL
    });

    describe('F5 blobPlainText: the synchronous read verbs\' plain text of a stored blob, direct (Task 12 fix round 1)', () => {
      const entryBytes = (t: string): Buffer => Buffer.from(JSON.stringify([{ type: 'text', text: t }]));

      it('F5 blobPlainText sidecar cap: a sidecar whose stored rawLen is over SIDECAR_WHOLE_MAX answers empty without decoding; the same bytes within the cap give their indexed text', async () => {
        const { store, lib } = await IX.api();
        const idx = lib.makePairIndex([]);
        const sc = Buffer.from('zqsidehead\nzqsideend\n');
        const z = q5(sc);
        expect(store.blobPlainText(z, true, idx, lib.SIDECAR_WHOLE_MAX + 1)).toBe('');
        expect(store.blobPlainText(z, true, idx, lib.SIDECAR_WHOLE_MAX)).toBe(lib.sidecarIndexText(sc, idx));   // CONTROL: at the cap
        expect(store.blobPlainText(z, true, idx, sc.length)).toContain('zqsidehead');                          // CONTROL: its true length
      });

      it('F5 blobPlainText entry cap: an entry whose stored rawLen is BLOB_DECODE_MAX + 1 answers empty; the same bytes at their true length give their text', async () => {
        const { store, lib } = await IX.api();
        const idx = lib.makePairIndex([]);
        const body = entryBytes('zqentrysentinel');
        const z = q5(body);
        expect(store.blobPlainText(z, false, idx, lib.BLOB_DECODE_MAX + 1)).toBe('');
        expect(store.blobPlainText(z, false, idx, body.length)).toBe('zqentrysentinel');   // CONTROL
      });

      it('F5 blobPlainText structure bound: a valid entry over JSON_NODES_MAX answers empty before any parse; a nearby valid entry gives its text', async () => {
        const { store, lib } = await IX.api();
        const idx = lib.makePairIndex([]);
        const over = Buffer.from(JSON.stringify([{ type: 'text', text: 'zqstructsentinel' }]).slice(0, -1) + ',0'.repeat(lib.JSON_NODES_MAX) + ']');
        expect(over.length, 'CONTROL: the over-structure body is within the decode cap').toBeLessThanOrEqual(lib.BLOB_DECODE_MAX);
        expect(lib.jsonWithinStructureBound(over), 'CONTROL: it is over the structure bound').toBe(false);
        expect(() => JSON.parse(over.toString('utf8')), 'CONTROL: it is valid JSON').not.toThrow();
        const ok = entryBytes('zqstructsentinel');
        expect(store.blobPlainText(q5(over), false, idx, over.length)).toBe('');
        expect(store.blobPlainText(q5(ok), false, idx, ok.length)).toBe('zqstructsentinel');   // CONTROL
      });

      it('F5 blobPlainText malformed brotli: garbage and truncated bytes answer empty in both arms and never throw', async () => {
        const { store, lib } = await IX.api();
        const idx = lib.makePairIndex([]);
        const good = q5(entryBytes('zqbrotlisentinel'));
        const truncated = good.subarray(0, Math.floor(good.length / 2));
        expect(store.blobPlainText(good, false, idx, 1000), 'CONTROL: the whole blob decodes').toBe('zqbrotlisentinel');
        for (const isSidecar of [false, true]) {
          for (const z of [Buffer.from('zq-not-brotli'), truncated]) {
            expect(() => store.blobPlainText(z, isSidecar, idx, 1000)).not.toThrow();
            expect(store.blobPlainText(z, isSidecar, idx, 1000), `${isSidecar} ${z.length}`).toBe('');
          }
        }
      });

      it('F5 blobPlainText malformed json: a brotli-valid entry whose in-bound JSON does not parse answers empty and never throws', async () => {
        const { store, lib } = await IX.api();
        const idx = lib.makePairIndex([]);
        const bad = Buffer.from('[{"type":"text","text":"zqjsonsentinel"');   // truncated: never closed
        expect(lib.jsonWithinStructureBound(bad), 'CONTROL: it passes the structure bound, so the parse is what refuses it').toBe(true);
        expect(() => JSON.parse(bad.toString('utf8')), 'CONTROL: it does not parse').toThrow(SyntaxError);
        expect(() => store.blobPlainText(q5(bad), false, idx, bad.length)).not.toThrow();
        expect(store.blobPlainText(q5(bad), false, idx, bad.length)).toBe('');
        const ok = Buffer.from(bad.toString('utf8') + '}]');
        expect(store.blobPlainText(q5(ok), false, idx, ok.length)).toBe('zqjsonsentinel');   // CONTROL: closed, it parses
      });

      it('F5 blobPlainText sidecar extraction: a compressed JSON sidecar is unescaped and redacted through sidecarIndexText, agreeing with it on the raw bytes', async () => {
        const { store, lib } = await IX.api();
        const tok = randomBytes(24).toString('hex');
        const idx = lib.makePairIndex(lib.secretPairs([tok]).pairs);
        const sc = Buffer.from(JSON.stringify([{ type: 'text', text: `zqpubhead\n${tok}\nzqpubend` }]));
        expect(sc.toString('utf8').includes(tok), 'CONTROL: the raw bytes carry the fixture secret').toBe(true);
        const got = store.blobPlainText(q5(sc), true, idx, sc.length);
        expect(got).toBe(lib.sidecarIndexText(sc, idx));
        expect(got).toContain('zqpubhead');
        expect(got).toContain('zqpubend');
        expect(got.includes(tok.slice(0, 12))).toBe(false);
        expect(got, 'the JSON newline escape is undone').toContain('zqpubhead\n');
        expect(got.includes('\\n')).toBe(false);
      });
    });

    it('F7 sibling (D-4346): a row whose canonical body is over BLOB_DECODE_MAX while its line is within LINE_MAX is stored and indexes nothing at ingest, as the backfill and the re-derivation index it', async () => {
      const { lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-f7-sib-');
      try {
        const marker = `zqovc${hex(6)}`;
        const SLOT = 'ZQ-SLOT';
        const frame = Buffer.from(JSON.stringify(IX.user(IX.uuidN(2), IX.uuidN(1), SLOT, 2)));
        const cut = frame.indexOf(SLOT);
        // 6,000,000 invalid UTF-8 bytes: each reads as U+FFFD, three bytes in the canonical body, so the body is ~18 MB
        // (over the 16 MiB cap) while the line stays ~6 MB (under LINE_MAX).
        const line = Buffer.concat([frame.subarray(0, cut), Buffer.from(marker), Buffer.alloc(6_000_000, 0xff), frame.subarray(cut + SLOT.length), Buffer.from('\n')]);
        expect(line.length, 'CONTROL: the line is within LINE_MAX').toBeLessThan(lib.LINE_MAX);
        const small = Buffer.from(IX.jsonl([IX.user(IX.uuidN(1), null, 'zqsmallctl words', 1)]));
        const dir = path.join(box.homes[0]!, 'projects', IX.SLUG);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${IX.U}.jsonl`), Buffer.concat([small, line]));
        IX.sweepTwice(box);
        const db = openStoreRO(box);
        try {
          const row = db.prepare('SELECT b.blob_id AS id, b.raw_len AS len, b.fts_indexed AS ix FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?').get(IX.uuidN(2)) as { id: number; len: number; ix: number } | undefined;
          expect(row, 'CONTROL: the row was stored').toBeDefined();
          expect(row!.len).toBeGreaterThan(lib.BLOB_DECODE_MAX);
          expect(matches(db, 'zqsmallctl')).toBe(1);   // CONTROL: the index is on and indexes a small row
          const small1 = db.prepare('SELECT blob_id AS id FROM entries WHERE uuid = ?').get(IX.uuidN(1)) as { id: number };
          expect(hasFtsRow(db, small1.id), 'CONTROL: the row-presence probe sees a row that exists').toBe(true);
          // B3M3 (FU5): the over-cap blob is marked indexed (the backfill cursor moves past it) and has NO index row,
          // the state the re-derivation leaves it in, rather than an empty row.
          expect(row!.ix).toBe(1);
          expect(hasFtsRow(db, row!.id)).toBe(false);
          expect(matches(db, `"${marker}"`)).toBe(0);
          expect(ftsBytes(db).includes(marker)).toBe(false);
        } finally { db.close(); }
      } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
    }, 180_000);

    it('a late pair glued inside an over-cap row that an earlier store indexed in full: the re-derivation deletes its index row, uncounted, and the mark advances (D-4344, D-4346)', async () => {
      const { lib } = await IX.api();
      const box = IX.newBox('ccrc-hist-overcap-late-');
      const v = `zqd${hex(12)}4`;
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `note é${v} end`, 1)]));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try { expect(matches(db, '"ezqd"*')).toBe(1); } finally { db.close(); }   // CONTROL: the row is indexed in full
      const w = openWriter(historyPaths(box.home).dbFile);
      try {
        // a store written before ingest withheld an over-cap body: the row's raw_len says over the cap, its index row is whole
        w.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(lib.BLOB_DECODE_MAX + 1, IX.uuidN(1));
      } finally { closeWriter(w); }
      secretFile(box, 'd.env', `ZQ_D_VALUE=${v}\n`);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(matches(db, '"ezqd"*')).toBe(0);
        expect(ftsBytes(db).includes(v.slice(3, 15))).toBe(false);
        expect(metaV(db, 'fts_reindex_rid')).toBe(String(maxRid(db)));
        expect(counters(box)[HEALTH_COUNTERS.blobUndecodable] ?? 0).toBe(0);   // uncounted: an over-cap body is not an undecodable one
      } finally { db.close(); }
    });

    it('FPM10: a blob whose stored bytes decode past its raw_len is undecodable; unbrotli refuses a call with no bound', async () => {
      const { sweep: S, store, lib } = await IX.api();
      const big = Buffer.alloc(4 << 20, 0x61);                         // 4 MiB of one byte: a few bytes compressed
      const z = brotliCompressSync(big);
      expect(z.length, 'CONTROL: the crafted blob is small').toBeLessThan(1024);
      expect(store.unbrotli(z, big.length).equals(big)).toBe(true);    // CONTROL: its true length decodes
      // node:zlib itself stops the decode at the bound (ERR_BUFFER_TOO_LARGE), never a whole decode checked afterwards.
      let code: unknown = 'no throw';
      try { store.unbrotli(z, 16); } catch (e) { code = (e as { code?: unknown }).code; }
      expect(code).toBe('ERR_BUFFER_TOO_LARGE');
      expect(() => (store.unbrotli as unknown as (z: Uint8Array) => Buffer)(z)).toThrow(TypeError);
      expect(store.unbrotli(brotliCompressSync(Buffer.alloc(0)), 0).length).toBe(0);   // an empty body at raw_len 0
      expect(() => store.unbrotli(brotliCompressSync(Buffer.from('x')), 0)).toThrow(RangeError);
      expect(await S.ftsTextOfBlob(z, false, lib.makePairIndex([]), 16)).toMatchObject({ text: null, undecodable: true });
    });

    it('census: every decompression of a stored blob in sweep.mjs is guarded, and only ftsTextOfBlob decodes for the index', () => {
      const lines = fs.readFileSync(SWEEP, 'utf8').split('\n');
      const hits: Array<{ fn: string; line: string; prev: string }> = [];
      lines.forEach((line, i) => {
        if (!/\bunbrotli(?:Prefix)?\(/.test(line)) return;
        const tr = line.trim();
        if (tr.startsWith('*') || tr.startsWith('/*') || tr.startsWith('//')) return;
        let fn = '';
        for (let j = i; j >= 0; j -= 1) { const m = /^(?:export )?(?:async )?function (\w+)/.exec(lines[j]!); if (m) { fn = m[1]!; break; } }
        hits.push({ fn, line, prev: lines[i - 1] ?? '' });
      });
      expect([...new Set(hits.map((h) => h.fn))].sort()).toEqual(['ftsTextOfBlob', 'pairedFromStore', 'storedBody', 'toolResultCandidates']);
      for (const h of hits) expect(/\btry\b/.test(h.line) || /\btry\b/.test(h.prev), h.line).toBe(true);
      expect(hits.filter((h) => h.fn === 'ftsTextOfBlob')).toHaveLength(2);   // CONTROL
      // FPM10: every whole-body decode is bounded by that blob's own stored raw_len.
      for (const h of hits.filter((x) => /\bunbrotli\(/.test(x.line))) expect(h.line, h.line).toMatch(/\bunbrotli\((?:r\.z, r\.raw_len|z, rawLen)\)/);
      // D-4346: every blob SELECT a whole-body reader decodes from carries raw_len, and each reader checks it before it decodes.
      const sel = lines.filter((l) => /^\s*(?:blobZ|pairSel|blobForFts): db\.prepare\(/.test(l));
      expect(sel).toHaveLength(4);
      for (const l of sel) expect(l, l).toContain('raw_len');
      const fnLines = (fn: string): string[] => {
        const at = lines.findIndex((l) => new RegExp(`^(?:export )?(?:async )?function ${fn}\\b`).test(l));
        expect(at, fn).toBeGreaterThanOrEqual(0);
        const end = lines.findIndex((l, i) => i > at && /^}/.test(l));
        return lines.slice(at, end + 1);
      };
      for (const fn of ['storedBody', 'pairedFromStore', 'ftsTextOfBlob']) {
        const body = fnLines(fn);
        const guard = body.findIndex((l) => /\bblobOverDecodeCap\(/.test(l));
        const decode = body.findIndex((l) => /\bunbrotli\(/.test(l));
        expect(guard, `${fn} has no guard`).toBeGreaterThanOrEqual(0);
        expect(guard, `${fn} decodes before it checks`).toBeLessThan(decode);
      }
      // toolResultCandidates is no exception: a collided entry reads type 'user' over a raw line-too-long blob (ENTRY_UPSERT keeps the first blob_id).
      const trc = fnLines('toolResultCandidates');
      const tGuard = trc.findIndex((l) => /\bblobOverDecodeCap\(/.test(l));
      const tDecode = trc.findIndex((l) => /\bunbrotli\(/.test(l));
      expect(tGuard, 'toolResultCandidates has no guard').toBeGreaterThanOrEqual(0);
      expect(tGuard, 'toolResultCandidates decodes before it checks').toBeLessThan(tDecode);
      const src = lines.join('\n');
      const tr = /toolResults: db\.prepare\(`([^`]*)`/.exec(src);
      expect(tr).not.toBeNull();
      expect(tr![1]).toContain('raw_len');
    });
  });
});

interface IxSweep { firstUuidRowCwd(homes: string[], userHome: string, uuid: string, cache?: unknown): string | null; }

describe('FR2-d (D-4340): a read error on one admitted file is that file\'s, never the tick\'s', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  let S: IxSweep;
  beforeAll(async () => { ({ sweep: S } = await IX.api()); });
  const counterOf = (db: DatabaseSync, name: string): number | undefined =>
    (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;
  /** readSync cannot be faulted in a spawned pass (the faults preload has no read event), so it is faulted in this
   *  process, as D-4298's case does: node:fs's readSync is replaced for the descriptors that name `bad`, and
   *  syncBuiltinESMExports() carries it to sweep.mjs's named import. `code` is the OS error's. */
  const failReads = (bad: string, code = 'EIO'): { faulted: () => number; restore: () => void } => {
    const realRead = fs.readSync;
    let faulted = 0;
    const err = Object.assign(new Error(`${code}: i/o error, read`), { code, errno: -5, syscall: 'read' });
    (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) === bad) { faulted += 1; throw err; }
      return (realRead as (...a: unknown[]) => number)(fd, ...rest);
    };
    syncBuiltinESMExports();
    return { faulted: () => faulted, restore: () => { (fs as { readSync: unknown }).readSync = realRead; syncBuiltinESMExports(); } };
  };
  const sideDir = (home: string, uuid: string): string => {
    const d = path.join(home, 'projects', IX.SLUG, uuid, 'tool-results');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  it('EIO on the first-sorted transcript: the later one is ingested, file_unreadable counts it once, the tick row is written, the next tick retries the file', async () => {
    const box = IX.newBox('ccrc-hist-fr2d1-');
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'unreadable', 1)]));
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'readable', 21, { sessionId: IX.U2 })]));
    expect([bad, path.join(path.dirname(bad), `${IX.U2}.jsonl`)].sort()[0], 'the faulted file sorts first').toBe(bad);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const f = failReads(bad);
      try {
        const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
        const tick = await S.ingestTick(db, ctx, S.newBudget());       // never throws
        S.recordTick(db, ctx, tick);
        expect(f.faulted(), 'the fault never fired').toBeGreaterThanOrEqual(1);
        expect(tick.busy).toBe(false);
        expect(IX.count(db, 'entries'), 'the file sorted after the bad one is captured').toBe(1);
        expect(counterOf(db, 'file_unreadable')).toBe(1);
        expect(IX.count(db, 'ticks'), 'the tick row exists').toBe(1);
        expect([...tick.skipped], 'the tick names the session whose copy it could not read (D-5061), and no other').toEqual([IX.U]);
      } finally { f.restore(); }
      const ctx2 = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids);
      const tick2 = await S.ingestTick(db, ctx2, S.newBudget());
      expect([...tick2.skipped], 'the retry read it: nothing skipped').toEqual([]);
      S.recordTick(db, ctx2, tick2);
      expect(IX.count(db, 'entries'), 'the next tick retried it').toBe(2);
      expect(counterOf(db, 'file_unreadable')).toBe(1);
    } finally { db.close(); }
  });

  it('a copy whose parse crashes is a skipped copy: tick.skipped names its uuid and no other (D-5061)', async () => {
    const box = IX.newBox('ccrc-hist-fr1c1-');
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'a line the parser cannot take', 1)]));
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'a line it takes', 21, { sessionId: IX.U2 })]));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
      // The parser module throws on the first uuid's lines only (a bug the copy's content reaches), as O2 (b) does.
      const realPrepare = ctx.prepareLines as (...a: unknown[]) => unknown;
      const sel = { ...ctx, prepareLines: (lines: { bytes: Buffer }[], ...rest: unknown[]): unknown => {
        if (lines.some((l) => l.bytes.toString('utf8').includes('a line the parser cannot take'))) throw new Error('parser bug');
        return realPrepare(lines, ...rest);
      } } as typeof ctx;
      const tick = await S.ingestTick(db, sel, S.newBudget());
      expect(counterOf(db, 'parser_crash'), 'the parser crash fired').toBe(1);
      expect(IX.count(db, 'entries'), 'the other copy is ingested').toBe(1);
      expect([...tick.skipped], 'the crashed copy\'s session is named, and not the copy whose lines parse (CONTROL)').toEqual([IX.U]);
    } finally { db.close(); }
  });

  it('a programming error is not swallowed: a thrown TypeError out of the read still leaves the tick', async () => {
    const box = IX.newBox('ccrc-hist-fr2d2-');
    const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1)]));
    const { db, ids } = await IX.openFixtureStore(box);
    const realRead = fs.readSync;
    try {
      (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
        if (fs.readlinkSync(`/proc/self/fd/${fd}`) === bad) throw new TypeError('a bug, not the disk');
        return (realRead as (...a: unknown[]) => number)(fd, ...rest);
      };
      syncBuiltinESMExports();
      await expect(S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget())).rejects.toThrow(TypeError);
      expect(counterOf(db, 'file_unreadable')).toBeUndefined();
    } finally { (fs as { readSync: unknown }).readSync = realRead; syncBuiltinESMExports(); db.close(); }
  });

  it('EIO on one sidecar: the next sidecar is taken, file_unreadable counts it, the tick completes, the next tick retries it', async () => {
    const box = IX.newBox('ccrc-hist-fr2d3-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
    const dir = sideDir(box.homes[0]!, IX.U);
    const bad = path.join(dir, 'a-bad.txt');
    fs.writeFileSync(bad, 'unreadable body\n');
    fs.writeFileSync(path.join(dir, 'b-good.txt'), 'readable body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const f = failReads(bad);
      try {
        const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids);
        const tick = await S.ingestTick(db, ctx, S.newBudget());
        S.recordTick(db, ctx, tick);
        expect(f.faulted(), 'the fault never fired').toBeGreaterThanOrEqual(1);
        expect(IX.count(db, 'sidecars'), 'the sidecar after the bad one is taken').toBe(1);
        expect(counterOf(db, 'file_unreadable')).toBe(1);
        expect(IX.count(db, 'ticks')).toBe(1);
      } finally { f.restore(); }
      const ctx2 = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids);
      S.recordTick(db, ctx2, await S.ingestTick(db, ctx2, S.newBudget()));
      expect(IX.count(db, 'sidecars'), 'the next tick retried it').toBe(2);
    } finally { db.close(); }
  });

  it('a programming error on a sidecar is not swallowed: a thrown TypeError out of the sidecar read still leaves the tick (D-4340)', async () => {
    const box = IX.newBox('ccrc-hist-fr2d4-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
    const bad = path.join(sideDir(box.homes[0]!, IX.U), 'a-bad.txt');
    fs.writeFileSync(bad, 'a body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    const realRead = fs.readSync;
    try {
      (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
        if (fs.readlinkSync(`/proc/self/fd/${fd}`) === bad) throw new TypeError('a bug, not the disk');
        return (realRead as (...a: unknown[]) => number)(fd, ...rest);
      };
      syncBuiltinESMExports();
      await expect(S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget())).rejects.toThrow(TypeError);
      expect(counterOf(db, 'file_unreadable')).toBeUndefined();
    } finally { (fs as { readSync: unknown }).readSync = realRead; syncBuiltinESMExports(); db.close(); }
  });

  it('D-4298 (Task 18 site): an EIO on the first home\'s copy skips that copy and the next home\'s copy places the epoch', () => {
    const box = IX.newBox('ccrc-hist-d4298a-');
    const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'first home', 1, { cwd: '/home/u/elsewhere' })]));
    IX.plantCopy(box.homes[1]!, IX.U, IX.jsonl([IX.user(IX.uuidN(2), null, 'second home', 2, { cwd: '/home/u/tree' })]));
    expect(S.firstUuidRowCwd(box.homes, box.home, IX.U), 'CONTROL: the first home\'s copy is tried first').toBe('/home/u/elsewhere');
    const f = failReads(bad);
    let got: string | null;
    try { got = S.firstUuidRowCwd(box.homes, box.home, IX.U); } finally { f.restore(); }
    expect(f.faulted()).toBe(1);
    expect(got!).toBe('/home/u/tree');
  });

  it('D-4340: a file met only through a spool hint is not retried by the next unhinted tick, and is by the next due scan (review 316 F34)', async () => {
    const box = IX.newBox('ccrc-hist-d4340h-');
    const { db, ids } = await IX.openFixtureStore(box);
    const at = (ms: number) => S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + ms, ids);
    try {
      await S.ingestTick(db, at(60_000), S.newBudget());   // a scan tick with nothing planted: the scan is marked done
      const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'late', 1)]));
      const drainDir = path.join(box.home, '.ccrc', 'history', 'spool', '.draining');
      fs.mkdirSync(drainDir, { recursive: true });
      const hint = path.join(drainDir, `${IX.ID}.${IX.tsMs(0)}.1.jsonl`);
      fs.writeFileSync(hint, '');
      const f = failReads(bad);
      try { await S.ingestTick(db, at(180_000), S.newBudget()); } finally { f.restore(); }
      expect(f.faulted()).toBeGreaterThanOrEqual(1);
      expect(counterOf(db, 'file_unreadable')).toBe(1);
      fs.rmSync(hint);
      await S.ingestTick(db, at(300_000), S.newBudget());
      expect(IX.count(db, 'entries'), 'no hint, not behind, no scan due: not found').toBe(0);
      await S.ingestTick(db, at(60_000 + 30 * 60_000), S.newBudget());
      expect(IX.count(db, 'entries'), 'the next due scan finds it').toBe(1);
    } finally { db.close(); }
  });
});

describe('FR2-e (D-4341): a numeric row timestamp beyond the Date range is NULL, never a wedge', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it.each([[-(2 ** 60), 'negative'], [2 ** 60, 'positive']])('a row stamped %s (%s): stored with ts_ms NULL, and every pass, census included, exits 0', (stamp) => {
    const box = IX.newBox('ccrc-hist-fr2e-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
      { ...IX.user(IX.uuidN(1), null, 'odd clock', 1), timestamp: stamp },
      IX.user(IX.uuidN(2), IX.uuidN(1), 'ordinary clock', 2),
    ]));
    for (let i = 0; i < 4; i += 1) {
      const r = runSweep(box);
      expect(r.code, `pass ${i}: ${r.stderr}`).toBe(0);
    }
    const db = openStoreRO(box);
    try {
      expect(db.prepare('SELECT uuid, ts_ms FROM entries ORDER BY uuid').all()).toEqual([
        { uuid: IX.uuidN(1), ts_ms: null },
        { uuid: IX.uuidN(2), ts_ms: IX.tsMs(2) },
      ]);
    } finally { db.close(); }
  });
});


// ── W1-B2 Task 7B: the substring belt in the index (spec §6.2 "The belt", §8.3 layer 4; rev 3.5; O59 store half) ──
// The shapes B1 measured (review 351; fr2's "For the coordinator" items 1-2), through the real sweep: a stray ESC[ that
// took a value's second character behind a mid-span ESC[0m (31 of 32 characters one term at 561609adc; 27 with a closing
// sequence), and the value glued by `_`, `-` and letters. Terms are read through fts5vocab, so a value inside a longer
// term is seen too. Each value ends in a digit, so the porter stemmer never rewrites the term that holds it.
describe('O59 (W1-B2 Task 7B): the substring belt in the index (spec §6.2, §8.3 layer 4)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const E = String.fromCharCode(27);
  const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const alnum = (n: number): string => Array.from(randomBytes(n), (b) => AL[b % 62]!).join('');
  const mint = (): string => `QP${alnum(29)}7`;
  const btSecret = (box: HistoryBox, name: string, body: string): string => {
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    const p = path.join(box.home, '.cc-secrets', name);
    fs.writeFileSync(p, body, { mode: 0o600 });
    return p;
  };
  const btMeta = (db: DatabaseSync, k: string): string | undefined =>
    (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  const btMatch = (db: DatabaseSync, q: string): number =>
    (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(q) as { n: number }).n;
  /** The longest stretch any blobs_fts term shares with `v` (terms are stored folded, so `v` is folded too). */
  const btShared = (db: DatabaseSync, v: string): number => {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.btv USING fts5vocab(main, blobs_fts, 'row')");
    const terms = (db.prepare('SELECT term FROM temp.btv').all() as { term: string }[]).map((r) => r.term);
    const w = v.toLowerCase();
    let best = 0;
    for (const t of terms) for (let i = 0; i < w.length; i += 1) for (let j = i + best + 1; j <= w.length && t.includes(w.slice(i, j)); j += 1) best = j - i;
    return best;
  };
  const btRows = (v: string): IxRow[] => [
    IX.user(IX.uuidN(1), null, `zqbelt one w ${v[0]}${E}[0m${E}[${v.slice(1)} y`, 1),
    IX.user(IX.uuidN(2), IX.uuidN(1), `zqbelt two w ${v[0]}${E}[0m${E}[${v.slice(1, 28)}${E}[0m${v.slice(28)} y`, 2),
    IX.user(IX.uuidN(3), IX.uuidN(2), `zqbelt three ab_${v} end`, 3),
    IX.user(IX.uuidN(4), IX.uuidN(3), `zqbelt four ab-${v}-tail end`, 4),
    IX.user(IX.uuidN(5), IX.uuidN(4), `zqbelt five abP${v}x end`, 5),
  ];
  const btHint = (box: HistoryBox): void => {
    fs.mkdirSync(path.join(box.root, 'spool'), { recursive: true });
    spoolLine(box, IX.ID, { v: 1, ev: 'Stop', id: IX.ID });
  };

  it('a value known before its text is indexed: no term holds its width, the remnant is no MATCH, the blobs keep it, no meta row holds it, and every pass ends witnessed', async () => {
    const { lib, sweep } = await IX.api();
    const W = sweep as unknown as { beltWitness(db: DatabaseSync): string };
    const box = IX.newBox('ccrc-hist-belt-a-');
    try {
      const v = mint();
      btSecret(box, 'belt.env', `ZQ_BELT=${v}\n`);
      const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(btRows(v)));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try {
        expect(btMatch(db, 'zqbelt'), 'CONTROL: the five rows are indexed').toBe(5);
        expect(btShared(db, v)).toBeLessThan(lib.beltWidth(v));
        expect(btMatch(db, `"${v.slice(1)}"`), 'the 31 characters the stray CSI left').toBe(0);
        expect(IX.blobsHold(db, v.slice(1)), 'the store stays lossless').toBe(true);
        expect(lib.parseBeltState(btMeta(db, lib.BELT_META))?.v, 'the belt state names this version').toBe(lib.BELT_VERSION);
        for (const k of [lib.BELT_META, lib.REDACT_SOURCES_META, 'fts_rederive']) expect(btMeta(db, k) ?? '', k).not.toContain(v.slice(2, 10));
      } finally { db.close(); }
      // R-rollback's stamp: a tick that ingests after its re-derivation step still ends with its own writes witnessed,
      // so the next tick reads no other build's hand in them.
      fs.appendFileSync(p, IX.jsonl([IX.user(IX.uuidN(6), IX.uuidN(5), 'zqbelt six plain', 6)]));
      btHint(box);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(btMatch(db, 'zqbelt'), 'CONTROL: the tick ingested a row after its re-derivation step').toBe(6);
        expect(lib.parseBeltState(btMeta(db, lib.BELT_META))?.w, 'the pass ends with its own writes witnessed').toBe(W.beltWitness(db));
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('a value learned after its text was indexed: the generation rewrites every shape, the letter-glued one too, and the mark advances', async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-belt-b-');
    try {
      const v = mint();
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(btRows(v)));
      IX.sweepTwice(box);
      let db = openStoreRO(box);
      try { expect(btShared(db, v), 'CONTROL: indexed in clear, the value not known yet').toBe(32); } finally { db.close(); }
      btSecret(box, 'late.env', `ZQ_LATE=${v}\n`);
      btHint(box);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(btShared(db, v)).toBeLessThan(lib.beltWidth(v));
        expect(btMeta(db, 'fts_reindex_rid')).toBe(String((db.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r));
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('a store a build without the belt wrote after B2 (a rollback to B1, then forward): the moved witness opens a belt generation, which rewrites its rows', async () => {
    const { sweep, store, lib } = await IX.api();
    const S = sweep as unknown as { ftsTextOfBlob(z: Uint8Array, s: boolean, i: unknown, n: number): Promise<{ text: string | null }> };
    const box = IX.newBox('ccrc-hist-belt-c-');
    try {
      const v = mint();
      btSecret(box, 'belt.env', `ZQ_BELT=${v}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(btRows(v)));
      IX.sweepTwice(box);
      let covered = '';
      const w = store.openWriter(lib.historyPaths(box.home).dbFile);
      try {
        covered = (w.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string }).v;
        // What one B1 tick leaves (finding R22's interleave): its ingest wrote a blob and indexed it with the three
        // layers alone, and its re-derivation rewrote an older row the same way. B1 never reads or writes fts_belt.
        const bare = lib.makePairIndex((w.prepare('SELECT len, sha256 FROM redact_hashes').all() as { len: number; sha256: Uint8Array }[])
          .map((p) => ({ len: Number(p.len), sha256: Buffer.from(p.sha256).toString('hex') })));
        const first = Number((w.prepare('SELECT min(blob_id) AS b FROM blobs WHERE fts_indexed = 1 AND z IS NOT NULL').get() as { b: number }).b);
        w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, fts_indexed) SELECT ?, codec, z, raw_len, 1 FROM blobs WHERE blob_id = ?')
          .run(randomBytes(32), first);
        const added = Number((w.prepare('SELECT max(blob_id) AS b FROM blobs').get() as { b: number }).b);
        for (const id of [first, added]) {
          const b = w.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?').get(id) as { z: Uint8Array; raw_len: number };
          const t = await S.ftsTextOfBlob(b.z, false, bare, Number(b.raw_len));
          w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(id);
          if (t.text !== null) w.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(id, lib.entryIndexText(t.text, bare));
        }
      } finally { w.close(); }
      let db = openStoreRO(box);
      try {
        expect(btShared(db, v), 'CONTROL: the rows the other build indexed hold the value').toBeGreaterThanOrEqual(lib.beltWidth(v));
        expect(btMeta(db, lib.BELT_META), 'CONTROL: fts_belt still records every row covered').toBe(covered);
        expect(lib.parseBeltState(covered)?.v, 'CONTROL: at this version').toBe(lib.BELT_VERSION);
      } finally { db.close(); }
      btHint(box);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(btShared(db, v)).toBeLessThan(lib.beltWidth(v));
        expect(lib.parseBeltState(btMeta(db, lib.BELT_META))?.v).toBe(lib.BELT_VERSION);
        expect(lib.parseRederiveState(btMeta(db, 'fts_rederive'))?.belt, 'the completed belt generation is closed').toBeUndefined();
        expect((db.prepare('SELECT n FROM counters WHERE name = ?').get(lib.BELT_COUNTERS.generations) as { n: number } | undefined)?.n,
          'a due record (v: 0) is no event').toBeUndefined();
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('a B1 store whose pair generation is open at upgrade: the first tick restarts it from cursor 0 as a belt generation, and that first belt generation is no event', async () => {
    const { sweep, store, lib } = await IX.api();
    const S = sweep as unknown as { ftsTextOfBlob(z: Uint8Array, s: boolean, i: unknown, n: number): Promise<{ text: string | null }> };
    const box = IX.newBox('ccrc-hist-belt-e-');
    try {
      const v = mint();
      btSecret(box, 'belt.env', `ZQ_BELT=${v}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(btRows(v)));
      IX.sweepTwice(box);
      const w = store.openWriter(lib.historyPaths(box.home).dbFile);
      try {
        // A B1 store (finding R15): every row as the three layers alone index it, no fts_belt, and B1's pair generation
        // open past its first blob (`<top> <first> <end>` above a mark of 0, B1's grammar).
        const bare = lib.makePairIndex((w.prepare('SELECT len, sha256 FROM redact_hashes').all() as { len: number; sha256: Uint8Array }[])
          .map((p) => ({ len: Number(p.len), sha256: Buffer.from(p.sha256).toString('hex') })));
        const rows = w.prepare('SELECT blob_id, z, raw_len FROM blobs WHERE fts_indexed = 1 AND z IS NOT NULL ORDER BY blob_id').all() as { blob_id: number; z: Uint8Array; raw_len: number }[];
        for (const b of rows) {
          const t = await S.ftsTextOfBlob(b.z, false, bare, Number(b.raw_len));
          w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(b.blob_id);
          if (t.text !== null) w.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(b.blob_id, lib.entryIndexText(t.text, bare));
        }
        const top = Number((w.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r);
        const end = Number((w.prepare('SELECT max(blob_id) AS b FROM blobs').get() as { b: number }).b);
        w.prepare('DELETE FROM meta WHERE k = ?').run(lib.BELT_META);
        const upsert = w.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
        upsert.run('fts_reindex_rid', '0');
        upsert.run('fts_rederive', `${top} ${rows[0]!.blob_id} ${end}`);
      } finally { w.close(); }
      let db = openStoreRO(box);
      try {
        expect(btShared(db, v), 'CONTROL: the escape and letter shapes are terms again').toBe(32);
        expect(lib.parseRederiveState(btMeta(db, 'fts_rederive'))?.cursor, 'CONTROL: B1\'s generation is open past the first blob').toBeGreaterThan(0);
      } finally { db.close(); }
      btHint(box);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(btShared(db, v), 'the first blob too: the walk began again at cursor 0').toBeLessThan(lib.beltWidth(v));
        expect(lib.parseBeltState(btMeta(db, lib.BELT_META))?.v).toBe(lib.BELT_VERSION);
        expect(lib.parseRederiveState(btMeta(db, 'fts_rederive'))?.belt, 'the completed belt generation is closed').toBeUndefined();
        expect(btMeta(db, 'fts_reindex_rid'), 'its completion moved the mark').toBe(String((db.prepare('SELECT max(rowid) AS r FROM redact_hashes').get() as { r: number }).r));
        expect((db.prepare('SELECT n FROM counters WHERE name = ?').get(lib.BELT_COUNTERS.generations) as { n: number } | undefined)?.n,
          'a store with no state is no event').toBeUndefined();
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('a value whose file was unreadable while a row was indexed is no longer covered, and its return opens a belt generation that rewrites that row', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-belt-d-');
    try {
      const v = mint();
      const file = btSecret(box, 'ret.env', `ZQ_RET=${v}\n`);
      const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqbelt before the gap', 1)]));
      IX.sweepTwice(box);
      fs.chmodSync(file, 0o000);
      try {
        fs.appendFileSync(p, IX.jsonl([IX.user(IX.uuidN(2), IX.uuidN(1), `zqbelt gap abP${v}x end`, 2)]));
        btHint(box);
        const r = runSweep(box);
        expect(r.code, r.stderr).toBe(0);
      } finally { fs.chmodSync(file, 0o600); }
      let db = openStoreRO(box);
      try { expect(btShared(db, v), 'CONTROL: glued by letters, the row indexed in the gap holds the value').toBe(32); } finally { db.close(); }
      btHint(box);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(btShared(db, v)).toBeLessThan(lib.beltWidth(v));
        expect((db.prepare('SELECT n FROM counters WHERE name = ?').get(lib.BELT_COUNTERS.generations) as { n: number } | undefined)?.n,
          'the return is counted').toBe(1);
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('a belt past BELT_GRAMS_MAX counts the units it left to layer 1 in redact_belt_overflow', async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-belt-f-');
    try {
      // 3000 forty-character values: 27 grams each at width 14, 81,000 in all, past BELT_GRAMS_MAX (65,536).
      btSecret(box, 'many.env', Array.from({ length: 3000 }, (_, i) => `ZQ_MANY_${i}=QP${alnum(37)}7\n`).join(''));
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqbelt many', 1)]));
      IX.sweepTwice(box);
      const db = openStoreRO(box);
      try {
        expect((db.prepare('SELECT count(*) AS n FROM redact_hashes').get() as { n: number }).n, 'CONTROL: the values were loaded').toBeGreaterThanOrEqual(3000);
        expect((db.prepare('SELECT n FROM counters WHERE name = ?').get(lib.BELT_COUNTERS.overflow) as { n: number } | undefined)?.n ?? 0,
          'the units past the bound are counted').toBeGreaterThan(0);
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  // Finding V13: B1's writeChunk and sidecar path index a blob ALREADY stored whose fts_indexed is 0 (a row of
  // non-searchable provenance stored it first, or the backfill passed over it, B1's D-4346), moving no id or meta.
  it('a build without the belt that indexes a blob already stored moves only the index witness, and the next pass rewrites that row', async () => {
    const { sweep, store, lib } = await IX.api();
    const S = sweep as unknown as {
      ftsTextOfBlob(z: Uint8Array, s: boolean, i: unknown, n: number): Promise<{ text: string | null }>;
      beltWitness(db: DatabaseSync): string;
      stampBeltWitness(db: DatabaseSync): void;
    };
    const box = IX.newBox('ccrc-hist-belt-g-');
    try {
      const v = mint();
      btSecret(box, 'belt.env', `ZQ_BELT=${v}\n`);
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(btRows(v)));
      IX.sweepTwice(box);
      let before = '';
      const w = store.openWriter(lib.historyPaths(box.home).dbFile);
      try {
        // The state such a blob is in when B2 last stamped the store: stored, fts_indexed 0, no index row.
        const first = Number((w.prepare('SELECT min(blob_id) AS b FROM blobs WHERE fts_indexed = 1 AND z IS NOT NULL').get() as { b: number }).b);
        w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(first);
        w.prepare('UPDATE blobs SET fts_indexed = 0 WHERE blob_id = ?').run(first);
        S.stampBeltWitness(w);
        before = S.beltWitness(w);
        // What B1's indexBlob then does, with the three layers alone: one index row, and fts_indexed 1.
        const bare = lib.makePairIndex((w.prepare('SELECT len, sha256 FROM redact_hashes').all() as { len: number; sha256: Uint8Array }[])
          .map((p) => ({ len: Number(p.len), sha256: Buffer.from(p.sha256).toString('hex') })));
        const b = w.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?').get(first) as { z: Uint8Array; raw_len: number };
        const t = await S.ftsTextOfBlob(b.z, false, bare, Number(b.raw_len));
        expect(t.text, 'CONTROL: the blob decodes').not.toBeNull();
        w.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(first, lib.entryIndexText(t.text!, bare));
        w.prepare('UPDATE blobs SET fts_indexed = 1 WHERE blob_id = ?').run(first);
      } finally { w.close(); }
      let db = openStoreRO(box);
      try {
        expect(btShared(db, v), 'CONTROL: the row the other build indexed holds the value').toBeGreaterThanOrEqual(lib.beltWidth(v));
        expect((JSON.parse(S.beltWitness(db)) as unknown[]).slice(0, 5), 'CONTROL: no blob id, pair, mark, re-derivation state or backfill step moved')
          .toEqual((JSON.parse(before) as unknown[]).slice(0, 5));
      } finally { db.close(); }
      btHint(box);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(btShared(db, v), 'the moved index witness opened a belt generation, which rewrote the row').toBeLessThan(lib.beltWidth(v));
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  // Finding V14: each part of the witness is pinned by the write that moves only it.
  it('the witness moves with each value a build without the belt writes: a blob, a pair, the mark, the re-derivation state, the backfill step and an index row', async () => {
    const { sweep, store, lib } = await IX.api();
    const W = sweep as unknown as { beltWitness(db: DatabaseSync): string };
    const box = IX.newBox('ccrc-hist-belt-h-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqbelt witness parts', 1)]));
      IX.sweepTwice(box);
      const w = store.openWriter(lib.historyPaths(box.home).dbFile);
      try {
        const upsert = w.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
        const first = Number((w.prepare('SELECT min(blob_id) AS b FROM blobs WHERE z IS NOT NULL').get() as { b: number }).b);
        let added = 0;
        const moves: [string, () => number][] = [
          ['a blob it stores, unindexed', () => {
            const n = Number(w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, fts_indexed) SELECT ?, codec, z, raw_len, 0 FROM blobs WHERE blob_id = ?')
              .run(randomBytes(32), first).changes);
            added = Number((w.prepare('SELECT max(blob_id) AS b FROM blobs').get() as { b: number }).b);
            return n;
          }],
          ['a pair it records', () => Number(w.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?)').run(40, randomBytes(32), 1).changes)],
          ['the mark its re-derivation moves', () => Number(upsert.run('fts_reindex_rid', '987654').changes)],
          ['its re-derivation state', () => Number(upsert.run('fts_rederive', '987654 1 2').changes)],
          ["its backfill's cursor", () => Number(w.prepare("UPDATE derivation_state SET cursor = '987654' WHERE step = 'fts' AND version = 1").run().changes)],
          ['an index row for a blob already stored', () => Number(w.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(added, 'zqwitness parts').changes)],
        ];
        for (const [what, move] of moves) {
          const was = W.beltWitness(w);
          expect(move(), `CONTROL: ${what} was written`).toBe(1);
          expect(W.beltWitness(w), what).not.toBe(was);
        }
      } finally { w.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('keeps redact_sources when the shim passes no paths after a roster-unreadable pass', async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-belt-sources-');
    try {
      const p = btSecret(box, 'declared.env', `ZQ_DECLARED=${mint()}\n`);
      expect(runSweep(box, [], { secrets: [p] }).code).toBe(0);
      expect(runSweep(box, [], { secrets: [p] }).code).toBe(0);
      let db = openStoreRO(box);
      try {
        expect(lib.parseRedactSources(btMeta(db, lib.REDACT_SOURCES_META)), 'CONTROL: declared source paths are recorded')
          .toEqual([p]);
      } finally { db.close(); }
      const r = runSweep(box, ['--roster-unreadable'], { secrets: [], homes: [] });
      expect(r.code, r.stderr).toBe(0);
      db = openStoreRO(box);
      try {
        expect(lib.parseRedactSources(btMeta(db, lib.REDACT_SOURCES_META))).toEqual([p]);
      } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });

  it('admits normalized redact_sources at the shared bound and refuses overflow before it writes', async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-belt-source-bound-');
    try {
      const p = btSecret(box, 'declared.env', `ZQ_DECLARED=${mint()}\n`);
      const repeats = Array.from({ length: 257 }, () => p);
      expect(runSweep(box, [], { secrets: repeats }).code, '257 copies of one declared path are one source').toBe(0);
      let db = openStoreRO(box);
      try {
        expect(btMeta(db, lib.REDACT_SOURCES_META), 'only the normalized source list is persisted').toBe(JSON.stringify([p]));
        expect(lib.parseRedactSources(btMeta(db, lib.REDACT_SOURCES_META))).toEqual([p]);
      } finally { db.close(); }

      const accepted = [p, ...Array.from({ length: 255 }, (_, i) => path.join(box.home, '.cc-secrets', `source-${i}.env`))];
      expect(runSweep(box, [], { secrets: accepted }).code, 'the 256-source boundary is accepted').toBe(0);
      db = openStoreRO(box);
      let before: { sources: string | undefined; pairs: number; belt: string | undefined };
      try {
        before = {
          sources: btMeta(db, lib.REDACT_SOURCES_META),
          pairs: Number((db.prepare('SELECT count(*) AS n FROM redact_hashes').get() as { n: number }).n),
          belt: btMeta(db, lib.BELT_META),
        };
        expect(lib.parseRedactSources(before.sources), 'every producer-accepted source list round-trips through the reader').toEqual(accepted);
      } finally { db.close(); }

      const unchanged = (why: string): void => {
        db = openStoreRO(box);
        try {
          expect({
            sources: btMeta(db, lib.REDACT_SOURCES_META),
            pairs: Number((db.prepare('SELECT count(*) AS n FROM redact_hashes').get() as { n: number }).n),
            belt: btMeta(db, lib.BELT_META),
          }, why).toEqual(before!);
        } finally { db.close(); }
      };
      const rejected = Array.from({ length: 257 }, (_, i) => path.join(box.home, '.cc-secrets', `overflow-${i}.env`));
      const overflow = runSweep(box, [], { secrets: rejected });
      expect(overflow.code, overflow.stderr).toBe(2);
      unchanged('an over-limit list writes no metadata, pairs, or belt state');
      const relative = runSweep(box, [], { secrets: [...accepted.slice(0, 255), 'relative.env'] });
      expect(relative.code, relative.stderr).toBe(2);
      unchanged('a non-absolute source writes no metadata, pairs, or belt state');
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  });
});

// ── W1-B2 Task 23: a repair rebuild leaves the belt due, and the next tick closes it (spec §6.2 "The belt"; O59) ──────
describe('O59 (W1-B2 Task 23): a doctor --repair rebuild leaves the belt due, and the next tick closes it', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  it('the rebuild records the belt state due; the next scheduled pass runs a belt generation and records BELT_VERSION', async () => {
    const { sweep, store, lib } = await IX.api();
    const S = sweep as unknown as {
      makeIngestCtx(home: string, homes: string[], nowMs: number, ids: object): Record<string, unknown>;
      secretsStep(db: DatabaseSync, ictx: object, files: string[]): { pairIdx: unknown };
      newBudget(): object;
      ftsRebuildJob(db: DatabaseSync, ictx: object, o: { stepVersion: number; budget: object }): Promise<{ done: boolean }>;
    };
    const box = IX.newBox('ccrc-hist-belt-r-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'zqrepair one', 1)]));
      IX.sweepTwice(box);
      const P = lib.historyPaths(box.home);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      const beltOf = (db: DatabaseSync): string | undefined =>
        (db.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string } | undefined)?.v;
      const w = store.openWriter(P.dbFile);
      try {
        expect(lib.parseBeltState(beltOf(w))?.v, 'CONTROL: the ticks recorded the belt').toBe(lib.BELT_VERSION);
        const ictx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
        ictx['pairIdx'] = S.secretsStep(w, ictx, []).pairIdx;
        ictx['fts'] = true;
        expect((await S.ftsRebuildJob(w, ictx, { stepVersion: Date.now(), budget: S.newBudget() })).done).toBe(true);
        expect(lib.parseBeltState(beltOf(w))).toEqual({ v: 0, rids: [], gen: null });
      } finally { w.close(); }
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      const db = openStoreRO(box);
      try { expect(lib.parseBeltState(beltOf(db))?.v).toBe(lib.BELT_VERSION); } finally { db.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 120_000);
});

// ── W1-B2 Task 23: a resumed rebuild re-checks the belt state (spec §6.2 "The belt"; O59) ──
describe('O59 (W1-B2 Task 23): a resumed rebuild whose belt lacks a unit the belt state records as covered records the belt due', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  it('the second pass starts past the first chunk, with the unit unreadable, and still records the belt due', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const { sweep, store, lib } = await IX.api();
    const S = sweep as unknown as {
      makeIngestCtx(home: string, homes: string[], nowMs: number, ids: object): Record<string, unknown>;
      secretsStep(db: DatabaseSync, ictx: object, files: string[]): { pairIdx: unknown };
      newBudget(now?: () => number, limits?: { maxBytes?: number }): object;
      ftsRebuildJob(db: DatabaseSync, ictx: object, o: { stepVersion: number; budget: object }): Promise<{ done: boolean }>;
      stampBeltWitness(db: DatabaseSync): void;
    };
    const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const v = `QP${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(29)), (b) => AL[b % AL.length]!).join('')}7`;
    const box = IX.newBox('ccrc-hist-belt-rr-');
    try {
      const sec = path.join(box.home, '.cc-secrets');
      fs.mkdirSync(sec, { recursive: true, mode: 0o700 });
      const file = path.join(sec, 'rr.env');
      fs.writeFileSync(file, `ZQ_RR=${v}\n`, { mode: 0o600 });
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, `zqresume ab${v}cd one`, 1)]));
      IX.sweepTwice(box);
      const P = lib.historyPaths(box.home);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      const rawBelt = (): string | undefined => {
        const db = openStoreRO(box);
        try { return (db.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string } | undefined)?.v; } finally { db.close(); }
      };
      const covered = rawBelt();
      expect(lib.parseBeltState(covered)?.v, 'CONTROL: the ticks completed a belt generation').toBe(lib.BELT_VERSION);
      expect(lib.parseBeltState(covered)?.rids.length, 'CONTROL: recording the one unit covered').toBe(1);
      /** One repair pass in this process: the pass's own pair index (secretsStep), then one ftsRebuildJob call. */
      const pass = async (limits?: { maxBytes: number }): Promise<boolean> => {
        const w = store.openWriter(P.dbFile);
        try {
          const ictx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
          ictx['pairIdx'] = S.secretsStep(w, ictx, []).pairIdx;
          ictx['fts'] = true;
          const budget = limits === undefined ? S.newBudget() : S.newBudget(Date.now, limits);
          return (await S.ftsRebuildJob(w, ictx, { stepVersion: Date.now(), budget })).done;
        } finally { w.close(); }
      };
      // Pass 1, every unit loaded: its one chunk takes the store's few blobs, so the phase moves past `blobs`, and the
      // 1-byte budget ends the call there.
      expect(await pass({ maxBytes: 1 }), 'CONTROL: the first pass stops after its first chunk').toBe(false);
      expect(lib.parseBeltState(rawBelt()), 'CONTROL: the first chunk recorded the belt due').toEqual({ v: 0, rids: [], gen: null });
      // What a tick's belt generation that completes between the two passes leaves: the state the ticks recorded above,
      // planted back as it was read, so the case does not hang on a tick's budget.
      const w = store.openWriter(P.dbFile);
      try { w.prepare('UPDATE meta SET v = ? WHERE k = ?').run(covered!, lib.BELT_META); store.withTx(w, 'NORMAL', () => { S.stampBeltWitness(w); }); } finally { w.close(); }
      const p = lib.parseBeltState(rawBelt()); const c = lib.parseBeltState(covered)!; expect({ v: p?.v, rids: p?.rids, gen: p?.gen }, 'CONTROL: the state names the unit covered again, stamped as a tick leaves it').toEqual({ v: c.v, rids: c.rids, gen: c.gen });
      // Pass 2, the unit's file unreadable: it resumes past the start, so the first chunk's record never runs again.
      fs.chmodSync(file, 0o000);
      try {
        let done = false;
        for (let k = 0; k < 8 && !done; k += 1) done = await pass();
        expect(done, 'CONTROL: the resumed rebuild completed').toBe(true);
      } finally { fs.chmodSync(file, 0o600); }
      expect(lib.parseBeltState(rawBelt()), 'the resumed pass wrote rows without that unit\'s belt: the belt is due')
        .toEqual({ v: 0, rids: [], gen: null });
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 240_000);
});

// ── W1-B2 Task 23: the rebuild deletes a blob's row before it inserts it (FTS5 merges a second insert of one rowid) ──
describe('W1-B2 Task 23: a rebuild spread over two passes replaces the row a tick wrote between them, never merges into it', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  it('the tail blob, which the first pass did not reach and a tick re-derived, keeps only the second pass\'s text', async () => {
    const { sweep, store, lib } = await IX.api();
    const S = sweep as unknown as {
      makeIngestCtx(home: string, homes: string[], nowMs: number, ids: object): Record<string, unknown>;
      secretsStep(db: DatabaseSync, ictx: object, files: string[]): { pairIdx: unknown };
      newBudget(now?: () => number, limits?: { maxBytes?: number }): object;
      ftsRebuildJob(db: DatabaseSync, ictx: object, o: { stepVersion: number; budget: object }): Promise<{ done: boolean }>;
    };
    const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    /** A value no shape matches (C49's shape): only its pair, learned from a secret file, masks it. */
    const mint = (): string => `${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(30)), (b) => AL[b % AL.length]!).join('')}7`;
    const X = mint();   // a secret only from the second rebuild pass on
    const Y = mint();   // a secret from the tick between the two passes on
    // More indexable blobs than one rebuild chunk takes (REBUILD_BATCH = 2048), each its own text; the last one holds X and Y.
    const N = 2100;
    const rows = Array.from({ length: N }, (_, k) => {
      const i = k + 1;
      return IX.user(IX.uuidN(i), i === 1 ? null : IX.uuidN(i - 1), i === N ? `zqdeltail ${X} and ${Y} end` : `zqdelrow ${i}`, i);
    });
    const box = IX.newBox('ccrc-hist-t23-del-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl(rows));
      const P = lib.historyPaths(box.home);
      const match = (q: string): number => {
        const db = openStoreRO(box);
        try {
          return (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(`"${q}"`) as { n: number }).n;
        } finally { db.close(); }
      };
      const tickUntil = (done: () => boolean): void => {
        for (let k = 0; k < 8 && !done(); k += 1) {
          const r = runSweep(box);
          expect(r.code, r.stderr).toBe(0);
        }
      };
      tickUntil(() => fs.existsSync(P.dbFile) && match('zqdeltail') === 1);
      expect(match('zqdeltail'), 'CONTROL: every row was ingested and indexed').toBe(1);
      expect(match(X), 'CONTROL: X is no secret yet, so it is a term').toBe(1);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      /** One repair pass in this process: the pass's own pair index (secretsStep), then one ftsRebuildJob call. */
      const pass = async (limits?: { maxBytes: number }): Promise<boolean> => {
        const w = store.openWriter(P.dbFile);
        try {
          const ictx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
          ictx['pairIdx'] = S.secretsStep(w, ictx, []).pairIdx;
          ictx['fts'] = true;
          const budget = limits === undefined ? S.newBudget() : S.newBudget(Date.now, limits);
          return (await S.ftsRebuildJob(w, ictx, { stepVersion: Date.now(), budget })).done;
        } finally { w.close(); }
      };
      // Pass 1: the first chunk (2048 blobs) charges more than one byte, so the budget is spent after it.
      expect(await pass({ maxBytes: 1 }), 'CONTROL: the first pass stops after one chunk').toBe(false);
      expect(match('zqdeltail'), 'CONTROL: the first chunk did not reach the tail blob').toBe(0);
      // Y becomes a secret. The ticks record its pair, and B1's rederiveFts re-derives the tail blob, whose text holds Y,
      // into the NEW table: delete (nothing there yet), then insert, with X still unknown.
      const sec = path.join(box.home, '.cc-secrets');
      fs.mkdirSync(sec, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(sec, 't23-y.env'), `ZQ_T23_Y=${Y}\n`, { mode: 0o600 });
      tickUntil(() => match('zqdeltail') === 1);
      expect(match('zqdeltail'), 'CONTROL: a tick wrote the tail blob\'s row between the two passes').toBe(1);
      expect(match(X), 'CONTROL: the tick\'s row holds X as a term').toBe(1);
      expect(match(Y), 'CONTROL: and Y redacted').toBe(0);
      // X becomes a secret too; the second pass learns its pair and finishes the rebuild.
      fs.writeFileSync(path.join(sec, 't23-x.env'), `ZQ_T23_X=${X}\n`, { mode: 0o600 });
      let done = false;
      for (let k = 0; k < 8 && !done; k += 1) done = await pass();
      expect(done, 'CONTROL: the rebuild completed').toBe(true);
      expect(match('zqdeltail'), 'the tail blob keeps its row').toBe(1);
      expect(match(X), 'the second pass replaced the tick\'s row (deleted first): X is no term').toBe(0);
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 240_000);
});

// ── wave 5h-1 CI fix (D-5638): node:sqlite on Node 22 binds positional arguments to ANONYMOUS parameters only ──
// A numbered parameter (`?21`) is named "?21" by SQLite, so Node 22 skips it and the last positional argument fails with
// "column index out of range" (measured on the node-floor leg, 22.16.0); Node 24 binds it, so the suites pass locally.
// This scan reds on any Node, so the floor leg is not the only net.
describe('no numbered SQL parameter in ccd/history (node:sqlite on Node 22 binds positional arguments to anonymous parameters only)', () => {
  /** The file's code lines: whole-line `//` comments and the lines inside a block comment dropped. */
  function codeLines(src: string): Array<{ n: number; text: string }> {
    const out: Array<{ n: number; text: string }> = [];
    let inBlock = false;
    src.split('\n').forEach((raw, i) => {
      let t = raw.trim();
      if (inBlock) { if (t.includes('*/')) { inBlock = false; t = t.slice(t.indexOf('*/') + 2).trim(); } else return; }
      if (t.startsWith('//')) return;
      if (t.startsWith('/*')) { if (!t.includes('*/')) { inBlock = true; return; } t = t.slice(t.indexOf('*/') + 2).trim(); }
      out.push({ n: i + 1, text: t });
    });
    return out;
  }
  it('no ccd/history/*.mjs code line carries a ?NNN parameter', () => {
    const dir = path.join(REPO, 'ccd', 'history');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
    expect(files, 'CONTROL: the scan reads the history modules, sweep.mjs among them').toContain('sweep.mjs');
    const hits: string[] = [];
    for (const f of files) {
      for (const l of codeLines(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        if (/\?[0-9]+/.test(l.text)) hits.push(`${f}:${l.n}`);
      }
    }
    expect(hits, 'write a plain ? and bind the arguments in text order').toEqual([]);
  });
});

// ── W5h-2 Task 2: the BELT_VERSION 2 generation rewrites only the rows the widened class changes (D-5746 (history-belt-v2-value-class-reindex)) ─
// In process, so the re-derivation's own count is read. A store this build indexed has its row for the widened value replanted
// as a BELT_VERSION 1 build indexed it (the value's tail a term of its own), and fts_belt stamped v 1, as every B4 or W5h-1 build
// stamps it: the first tick after an upgrade, or after a rollback and forward again. The stamp is the literal 1, never
// BELT_VERSION - 1, so the mutant that leaves BELT_VERSION at 1 reads a covered store and opens nothing.
describe('W5h-2 Task 2: a store stamped BELT_VERSION 1 re-derives under the widened class and rewrites only the row a widened value changes (D-5746)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const W5 = (s: IxSweep) => s as unknown as { beltWitness(db: DatabaseSync): string };
  const w5Matches = (db: DatabaseSync, q: string): number =>
    (db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get(q) as { n: number }).n;

  it('one row re-indexed: the widened value\'s; the row whose named value v1 already masked whole and the plain row are left as they are', async () => {
    const { sweep: S, store, lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-w5h2-belt-');
    const tail = `zqwt${randomBytes(6).toString('hex')}7`;
    try {
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([
        IX.user(IX.uuidN(1), null, `zqwide one password=zqa&${tail} end`, 1),
        IX.user(IX.uuidN(2), IX.uuidN(1), 'zqwide two password=zqplain7 end', 2),
        IX.user(IX.uuidN(3), IX.uuidN(2), 'zqwide three plain words', 3),
      ]));
      IX.sweepTwice(box);
      const P = lib.historyPaths(box.home);
      const ids = { storeId: fs.readFileSync(P.storeId, 'utf8').trim(), writer: fs.readFileSync(P.writer, 'utf8').trim() };
      const w = store.openWriter(P.dbFile);
      try {
        expect(w5Matches(w, 'zqwide'), 'CONTROL: the three rows are indexed').toBe(3);
        expect(w5Matches(w, `"${tail}"`), 'CONTROL: this build indexed the value whole').toBe(0);
        const bare = lib.makePairIndex([]);
        const blobs = w.prepare('SELECT blob_id, z, raw_len FROM blobs WHERE fts_indexed = 1 AND z IS NOT NULL ORDER BY blob_id').all() as { blob_id: number; z: Uint8Array; raw_len: number }[];
        let planted = 0;
        for (const b of blobs) {
          const t = await S.ftsTextOfBlob(b.z, false, bare, Number(b.raw_len));
          if (t.text === null || !t.text.includes(tail)) continue;
          const now = lib.entryIndexText(t.text, bare);
          const v1 = now.replaceAll(`password=${lib.REDACTED_MARK}`, `password=${lib.REDACTED_MARK}&${tail}`);
          expect(v1, 'CONTROL: the row this build wrote masks the value whole').not.toBe(now);
          w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(b.blob_id);
          w.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(b.blob_id, v1);
          planted += 1;
        }
        expect(planted, 'CONTROL: one blob holds the widened value').toBe(1);
        const s0 = lib.parseBeltState((w.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string }).v)!;
        store.setMeta(w, lib.BELT_META, lib.formatBeltState({ v: 1, rids: s0.rids, gen: null, w: W5(S).beltWitness(w) }));
        expect(w5Matches(w, `"${tail}"`), 'CONTROL: the replanted row answers the tail, as a v1 row does').toBe(1);
        const ctx = S.makeIngestCtx(box.home, box.homes, Date.now(), ids);
        ctx.fts = S.ftsPrepare(w, ctx.nowMs).tables;
        expect(await S.rederiveFts(w, ctx, S.newBudget())).toEqual({ state: 'completed', reindexed: 1 });
        expect(w5Matches(w, `"${tail}"`), 'the tail is no MATCH').toBe(0);
        expect(w5Matches(w, 'zqwide'), 'every row is still indexed').toBe(3);
        expect(lib.parseBeltState((w.prepare('SELECT v FROM meta WHERE k = ?').get(lib.BELT_META) as { v: string }).v)?.v).toBe(lib.BELT_VERSION);
        expect(IX.blobsHold(w, tail), 'the store stays lossless').toBe(true);
      } finally { w.close(); }
    } finally { fs.rmSync(box.home, { recursive: true, force: true }); }
  }, 120_000);
});

// ── CP-39: the kit Tasks 1-4 share: the fixture rows, and counters that observe the work from outside the code under test ──
interface Cp39Walk { budget: IxBudget; after: number; advanced: number; complete: boolean }
const CP39 = (() => {
  const ROWS = 30;
  /** One plain user row, then ROWS tool_result rows; row k's text names tool-results/out<k>.txt and answers toolu_cp39<k>. */
  const rows = (): string => {
    const out: IxRow[] = [IX.user(IX.uuidN(1), null, 'go', 1)];
    for (let k = 1; k <= ROWS; k += 1) {
      const id = `toolu_cp39${String(k).padStart(3, '0')}`;
      out.push(IX.assistant(IX.uuidN(100 + k), IX.uuidN(k === 1 ? 1 : 200 + k - 1), [{ type: 'tool_use', id, name: 'Bash', input: { command: 'make' } }], 2 * k));
      out.push(IX.user(IX.uuidN(200 + k), IX.uuidN(100 + k), [{ type: 'tool_result', tool_use_id: id, content: `saved to: /home/u/x/tool-results/out${k}.txt` }], 2 * k + 1));
    }
    return IX.jsonl(out);
  };
  const names = (n = 40): string[] => Array.from({ length: n }, (_, i) => `out${i + 1}.txt`);
  const sideDir = (home: string, uuid = IX.U): string => {
    const d = path.join(home, 'projects', IX.SLUG, uuid, 'tool-results');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const pkOf = (db: DatabaseSync, uuid = IX.U): number =>
    (db.prepare('SELECT transcript_pk AS pk FROM transcripts WHERE cc_session_uuid = ?').get(uuid) as { pk: number }).pk;
  const userIds = (db: DatabaseSync, pk: number): number[] =>
    (db.prepare("SELECT entry_id FROM entries WHERE transcript_pk = ? AND type = 'user' ORDER BY entry_id").all(pk) as { entry_id: number }[]).map((r) => r.entry_id);
  const walkOf = (budget: IxBudget, after = 0): Cp39Walk => ({ budget, after, advanced: 0, complete: false });
  /** Successful row decodes, counted outside the walk: a decode that throws (an undecodable blob) is not counted. */
  const countDecodes = async (): Promise<{ n: () => number; restore: () => void }> => {
    const zlib = (await import('node:zlib')).default;
    const real = zlib.brotliDecompressSync;
    let n = 0;
    (zlib as { brotliDecompressSync: unknown }).brotliDecompressSync = function brotliDecompressSync(...a: unknown[]): unknown {
      const out = (real as (...x: unknown[]) => unknown)(...a);
      n += 1;
      return out;
    };
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (zlib as { brotliDecompressSync: unknown }).brotliDecompressSync = real; syncBuiltinESMExports(); } };
  };
  /** String.prototype.includes calls whose search string is one of `asked`, for the call only. */
  const countIncludes = (asked: readonly string[]): { n: () => number; restore: () => void } => {
    const real = String.prototype.includes;
    const want = new Set(asked);
    let n = 0;
    String.prototype.includes = function includes(this: string, s: string, at?: number): boolean {
      if (want.has(s)) n += 1;
      return real.call(this, s, at);
    };
    return { n: () => n, restore: () => { String.prototype.includes = real; } };
  };
  /** readSync calls on a descriptor whose file lies under `dir`: a sidecar's bytes being read. */
  const countReads = (dir: string): { n: () => number; restore: () => void } => {
    const real = fs.readSync;
    const under = `${fs.realpathSync(dir)}/`;
    let n = 0;
    (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(under)) n += 1;
      return (real as (...a: unknown[]) => number)(fd, ...rest);
    };
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (fs as { readSync: unknown }).readSync = real; syncBuiltinESMExports(); } };
  };
  /** The persisted walk state of `pk`, parsed here (never by the code under test), or null. */
  const walkState = (db: DatabaseSync, pk: number): { v: number; done: { names: string[] }; walk: { names: string[]; after: number } | null } | null => {
    const v = (db.prepare('SELECT v FROM meta WHERE k = ?').get(`sidecar_walk:${pk}`) as { v: string } | undefined)?.v;
    return v === undefined ? null : JSON.parse(v);
  };
  const sidecarRows = (db: DatabaseSync): { name: string; uuid: string | null }[] =>
    (db.prepare(`SELECT s.name AS name, e.uuid AS uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id
      ORDER BY s.name, s.blob_id`).all() as { name: string; uuid: string | null }[]).map((r) => ({ name: r.name, uuid: r.uuid }));
  /** What every out<k>.txt of `ks` links to, in sidecarRows' order (SQLite's BINARY order is the default sort's here). */
  const linked = (ks: number[]): { name: string; uuid: string }[] =>
    ks.map((k) => ({ k, name: `out${k}.txt` })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ k, name }) => ({ name, uuid: IX.uuidN(200 + k) }));
  const upTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
  return { ROWS, rows, names, sideDir, pkOf, userIds, walkOf, countDecodes, countIncludes, countReads, walkState, sidecarRows, linked, upTo };
})();

describe('CP-39 Task 1: the link walk decodes each row once and asks every name at once (D-6930)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  interface Cand { entryId: number; text: string; toolUseIds: string[] }
  interface T1 { toolResultCandidates(db: DatabaseSync, pk: number, names: Iterable<string>, walk?: Cp39Walk): Cand[] }
  const names = CP39.names();
  /** A store holding CP39's rows, ingested; answers the store, the transcript's pk and its user rows' ids. */
  const ingested = async (prefix: string): Promise<{ S: IxSweep & T1; db: DatabaseSync; pk: number; ids: number[] }> => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep & T1;
    const box = IX.newBox(prefix);
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const { db, ids } = await IX.openFixtureStore(box);
    await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
    const pk = CP39.pkOf(db);
    return { S, db, pk, ids: CP39.userIds(db, pk) };
  };

  it('rows x names: each user row is decoded once and no asked name is tested by includes, however many names are asked', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1a-');
    try {
      const walk = CP39.walkOf(S.newBudget());
      const dec = await CP39.countDecodes();
      const inc = CP39.countIncludes(names);
      let got: Cand[];
      try { got = S.toolResultCandidates(db, pk, names, walk); } finally { inc.restore(); dec.restore(); }
      expect(dec.n(), 'CONTROL: the decode counter sees the walk, once per user row').toBe(CP39.ROWS + 1);
      expect(inc.n(), 'no asked name was tested by String.prototype.includes').toBe(0);
      expect(walk.complete, 'the walk reached the last row').toBe(true);
      expect(walk.advanced, 'the cursor moved past every user row').toBe(CP39.ROWS + 1);
      expect(walk.after, 'the cursor names the last user row').toBe(ids.at(-1));
      expect(got, 'CONTROL: the walk answers what the walk-less call answers').toEqual(S.toolResultCandidates(db, pk, names));
      expect(got.map((c) => c.text)).toEqual(CP39.upTo(CP39.ROWS).map((k) => `out${k}.txt`));
    } finally { db.close(); }
  });

  it('a budget spent inside the walk stops it at a row boundary, and a walk resumed from its cursor decodes only the rest', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1b-');
    const dec = await CP39.countDecodes();
    try {
      // Within the budget until the tenth row decode; spent from then on, whatever else reads the clock.
      const cut = CP39.walkOf(S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }));
      const first = S.toolResultCandidates(db, pk, names, cut);
      expect(cut.complete, 'the budget ended the walk').toBe(false);
      expect(dec.n(), 'ten rows decoded before the check that failed').toBe(10);
      expect(cut.advanced).toBe(10);
      expect(cut.after, 'the cursor is the tenth user row').toBe(ids[9]);
      const before = dec.n();
      const rest = CP39.walkOf(S.newBudget(), cut.after);
      const second = S.toolResultCandidates(db, pk, names, rest);
      expect(rest.complete).toBe(true);
      expect(dec.n() - before, 'the resumed walk decodes only the rows left').toBe(CP39.ROWS + 1 - 10);
      expect([...first, ...second], 'CONTROL: the two halves are the uncut walk').toEqual(S.toolResultCandidates(db, pk, names));
    } finally { dec.restore(); db.close(); }
  });

  it('a budget spent before the first row takes nothing: the cursor stands, nothing is decoded, the walk is incomplete', async () => {
    const { S, db, pk } = await ingested('ccrc-hist-cp39-t1c-');
    const dec = await CP39.countDecodes();
    try {
      const walk = CP39.walkOf(S.newBudget(() => 0, { maxMs: 0 }));
      expect(S.toolResultCandidates(db, pk, names, walk)).toEqual([]);
      expect(dec.n(), 'nothing decoded').toBe(0);
      expect(walk, 'the cursor stands').toMatchObject({ after: 0, advanced: 0, complete: false });
    } finally { dec.restore(); db.close(); }
  });

  it('an over-cap row and an undecodable row: the cursor moves past both, neither is decoded, and the walk answers the rest', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1d-');
    const { lib } = await IX.api();
    const blobOf = (entryId: number): number => (db.prepare('SELECT blob_id AS b FROM entries WHERE entry_id = ?').get(entryId) as { b: number }).b;
    // As the D-4346 cases plant them: ids[3] answers out3.txt, ids[4] answers out4.txt.
    db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(lib.BLOB_DECODE_MAX + 1, blobOf(ids[3]!));   // over the cap: never decoded
    db.prepare('UPDATE blobs SET raw_len = 1 WHERE blob_id = ?').run(blobOf(ids[4]!));                          // undecodable: its decode throws
    const dec = await CP39.countDecodes();
    try {
      const walk = CP39.walkOf(S.newBudget());
      const got = S.toolResultCandidates(db, pk, names, walk);
      expect(walk.complete).toBe(true);
      expect(walk.advanced, 'the cursor moved past every row, the two passed over included').toBe(CP39.ROWS + 1);
      expect(walk.after).toBe(ids.at(-1));
      expect(dec.n(), 'neither passed-over row was decoded').toBe(CP39.ROWS + 1 - 2);
      expect(got.map((c) => c.text), 'the two passed-over rows name nothing').toEqual(CP39.upTo(CP39.ROWS).filter((k) => k !== 3 && k !== 4).map((k) => `out${k}.txt`));
    } finally { dec.restore(); db.close(); }
  });

  it('complete only when the rows ran out: a budget spent right after the last row still completes; one spent before it does not', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1e-');
    const dec = await CP39.countDecodes();
    try {
      const all = CP39.ROWS + 1;
      const atEnd = CP39.walkOf(S.newBudget(() => (dec.n() >= all ? 10_000 : 0), { maxMs: 1_000 }));
      S.toolResultCandidates(db, pk, names, atEnd);
      expect(atEnd.complete, 'the iterator ended: no check after the last row').toBe(true);
      const base = dec.n();
      const short = CP39.walkOf(S.newBudget(() => (dec.n() - base >= all - 1 ? 10_000 : 0), { maxMs: 1_000 }));
      S.toolResultCandidates(db, pk, names, short);
      expect(short.complete, 'a check that failed before the last row').toBe(false);
      expect(short.after).toBe(ids.at(-2));
    } finally { dec.restore(); db.close(); }
  });
});

describe('CP-39 Task 2: the link walk keeps its place across passes and is never restarted (D-6931, D-6932)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  interface T2 {
    ingestSidecars(db: DatabaseSync, ctx: IxCtx, b: IxBudget, uuids: Iterable<string>, opts?: { from?: string | null }): Promise<Record<string, unknown> & { bytes: number; complete: boolean }>;
    importSidecars(db: DatabaseSync, ctx: Record<string, unknown>, uuids: string[]): Promise<string>;
  }
  type S2 = Omit<IxSweep, 'ingestSidecars'> & T2;
  const PLENTY = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 });
  /** CP39's transcript ingested by the transcript half alone (a one-byte budget: the sidecar half then takes nothing),
   *  and its ROWS sidecars out<k>.txt on disk, bodies distinct. */
  const fixture = async (prefix: string) => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as S2;
    const box = IX.newBox(prefix);
    const p = IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = CP39.sideDir(box.homes[0]!);
    for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(dir, `out${k}.txt`), `body ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));
    expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the transcript only').toBe(0);
    const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids);
    const pk = CP39.pkOf(db);
    return { S, box, p, dir, db, ids, ctx, pk, rowIds: CP39.userIds(db, pk) };
  };
  const lateRow = (): string => IX.jsonl([IX.user(IX.uuidN(400), IX.uuidN(200 + CP39.ROWS), [{ type: 'tool_result', tool_use_id: 'toolu_cp39late', content: 'saved to: /home/u/x/tool-results/late.txt' }], 400)]);
  const walkRows = (db: DatabaseSync): number => IX.count(db, 'meta', "k LIKE 'sidecar\\_walk:%' ESCAPE '\\'");
  /** tool-results/ listings, counted outside the sweep: node:fs's DEFAULT readdirSync patched, carried to sweep.mjs by
   *  syncBuiltinESMExports. */
  const countListings = (): { n: () => number; restore: () => void } => {
    const real = fs.readdirSync;
    let n = 0;
    (fs as { readdirSync: unknown }).readdirSync = function readdirSync(p: unknown, ...rest: unknown[]): unknown {
      if (String(p).endsWith('/tool-results')) n += 1;
      return (real as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (fs as { readdirSync: unknown }).readdirSync = real; syncBuiltinESMExports(); } };
  };
  /** An import window's limits whose `maxMs` getter counts the windows: newBudget reads it once a window, and nothing else
   *  reads it, so the case reads the window count directly. Past 40 windows each window is spent at its first check (no
   *  progress, so the import ends): a loop without end stops, and the count shows it. */
  const countedWindows = (): { n: () => number; limits: { readonly maxMs: number } } => {
    let n = 0;
    return { n: () => n, limits: { get maxMs() { n += 1; return n > 40 ? 0 : 1_000; } } };
  };

  it('a pass whose budget ends inside the walk reads no sidecar byte and keeps the walk; the next pass resumes at the persisted cursor and links as an uncut pass links', async () => {
    const { S, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2a-');
    try {
      const dec = await CP39.countDecodes();
      const reads = CP39.countReads(dir);
      let cut: Record<string, unknown>;
      try {
        // Within the budget until the tenth row decode; spent from then on, whatever else reads the clock.
        cut = await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]);
      } finally { reads.restore(); dec.restore(); }
      expect(cut, 'cut inside the walk: incomplete, nothing read, ten rows walked').toEqual({ bytes: 0, complete: false, paused: false, walked: 10 });
      expect(reads.n(), 'no sidecar byte was read before its link was known').toBe(0);
      expect(IX.count(db, 'sidecar_seen')).toBe(0);
      const st = CP39.walkState(db, pk);
      expect(st?.walk?.after, 'the walk is kept at its cursor, the tenth user row').toBe(rowIds[9]);
      expect(st?.walk?.names, 'it asks every unseen name').toHaveLength(CP39.ROWS);
      const dec2 = await CP39.countDecodes();
      let rest: { complete: boolean };
      try { rest = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]); } finally { dec2.restore(); }
      expect(rest.complete).toBe(true);
      expect(dec2.n(), 'the next pass decoded only the rows after the persisted cursor').toBe(CP39.ROWS + 1 - 10);
      expect(CP39.sidecarRows(db), 'every sidecar links to the row that names it').toEqual(CP39.linked(CP39.upTo(CP39.ROWS)));
      expect(walkRows(db), 'a walk whose group was examined in full is deleted').toBe(0);
    } finally { db.close(); }
  });

  it('a name outside a walk in progress waits (deferred) and the half reports incomplete; once the walk is done the name is linked', async () => {
    const { S, p, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2b-');
    try {
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      // A new sidecar, and the row naming it, appended and ingested by the transcript half alone.
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      fs.appendFileSync(p, lateRow());
      await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: ctx.homes[0]! }, S.newBudget());
      const dec2 = await CP39.countDecodes();
      let cut: Record<string, unknown>;
      try { cut = await S.ingestSidecars(db, ctx, S.newBudget(() => (dec2.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec2.restore(); }
      expect(cut, 'late.txt (sorted first) waited; the walk advanced five rows').toEqual({ bytes: 0, complete: false, paused: false, walked: 5 });
      expect(CP39.walkState(db, pk)?.walk?.names, 'the walk in progress did not take the new name').not.toContain('late.txt');
      expect(CP39.walkState(db, pk)?.walk?.after).toBe(rowIds[14]);
      const full = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]);
      expect(full.complete, 'late.txt waited again while the walk finished').toBe(false);
      expect(IX.count(db, 'sidecar_seen'), 'every out<k>.txt, and not late.txt').toBe(CP39.ROWS);
      expect((await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])).complete).toBe(true);
      expect(CP39.sidecarRows(db).find((r) => r.name === 'late.txt'), 'late.txt links to the row that names it').toEqual({ name: 'late.txt', uuid: IX.uuidN(400) });
      expect(walkRows(db)).toBe(0);
    } finally { db.close(); }
  });

  it('a new name once a walk is done gets an extension over the uncovered names alone; the done names still unseen keep their state and are never walked again (P9)', async () => {
    const { S, p, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2c-');
    try {
      // The walk finishes inside the first sidecar's link; that sidecar's read then spends the budget: one taken, a done walk kept.
      const reads = CP39.countReads(dir);
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (reads.n() >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { reads.restore(); }
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: one sidecar taken').toBe(1);
      expect(CP39.walkState(db, pk)?.walk, 'CONTROL: the walk is done, and kept').toBeNull();
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      fs.appendFileSync(p, lateRow());
      await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: ctx.homes[0]! }, S.newBudget());
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      const st = CP39.walkState(db, pk);
      expect(st?.walk?.names, 'the extension asks only the uncovered name').toEqual(['late.txt']);
      expect(st?.walk?.after, 'with its own cursor, from the first row').toBe(rowIds[0]);
      expect(st?.done.names, 'the done names still unseen keep their state').toEqual(CP39.upTo(CP39.ROWS).slice(1).map((k) => `out${k}.txt`).sort());
      const dec2 = await CP39.countDecodes();
      try { expect((await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])).complete).toBe(true); } finally { dec2.restore(); }
      expect(dec2.n(), 'only the extension went on: the rows after its cursor, once').toBe(CP39.ROWS + 2 - 1);
      expect(CP39.sidecarRows(db)).toEqual([{ name: 'late.txt', uuid: IX.uuidN(400) }, ...CP39.linked(CP39.upTo(CP39.ROWS))]);
    } finally { db.close(); }
  });

  it('the sidecar half takes the uuids in the order it is given them, so a hinted session goes before a backlog', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as S2;
    const box = IX.newBox('ccrc-hist-cp39-t2d-');
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    // U2's transcript is ONE user row, whose tool_result names its one sidecar, so its walk is one decode (P19).
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(301), null, [{ type: 'tool_result', tool_use_id: 'toolu_cp39u2', content: 'saved to: /home/u/x/tool-results/u2.txt' }], 301, { sessionId: IX.U2 })]));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // both transcripts, no sidecar yet
      for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(CP39.sideDir(box.homes[0]!), `out${k}.txt`), `body ${k}\n`);
      fs.writeFileSync(path.join(CP39.sideDir(box.homes[0]!, IX.U2), 'u2.txt'), 'the hinted body\n');
      // One byte: U2's one-row walk and its sidecar fit, then the budget is spent; U's walk, had it gone first, would be cut at its second row.
      const r = await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(Date.now, { maxBytes: 1 }), [IX.U2, IX.U]);
      expect(CP39.sidecarRows(db), "exactly one sidecar is taken, and it is U2's").toEqual([{ name: 'u2.txt', uuid: IX.uuidN(301) }]);
      expect(r.complete).toBe(false);
    } finally { db.close(); }
  });

  it('import: each window resumes after the last sidecar the previous one examined, and a window that walked or examined is progress, so the import links every sidecar, from ONE listing (D-6932)', async () => {
    const { S, box, db, ids, pk } = await fixture('ccrc-hist-cp39-t2e-');
    try {
      let t = 0;
      // The window counter, read directly (P3). An injected statfs that threw would be swallowed: statfsWithDeadline reads a
      // throw as {state:'threw'}, planRun reads that as low-disk, and the import would answer 'paused'.
      const w = countedWindows();
      const opCtx = {
        home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now: () => (t += 100), out: () => {},
        deps: { statfs: PLENTY, budget: w.limits },
      };
      const l = countListings();
      let ended: string;
      try { ended = await S.importSidecars(db, opCtx, [IX.U]); } finally { l.restore(); }
      expect(ended).toBe('done');
      expect(w.n(), 'each window resumed: the import ended in a bounded number of windows').toBeLessThan(40);
      expect(l.n(), 'the sidecars were listed once for the whole import, never once a window').toBe(1);
      expect(IX.count(db, 'sidecar_seen')).toBe(CP39.ROWS);
      expect(CP39.sidecarRows(db), 'every sidecar links to the row that names it').toEqual(CP39.linked(CP39.upTo(CP39.ROWS)));
      expect(CP39.walkState(db, pk), 'the walk retired').toBeNull();
    } finally { db.close(); }
  });

  it('import: a window that re-examined only seen sidecars is progress, and the next resumes past them, so the sidecars a tick left are taken (D-6932, P3)', async () => {
    const { S, box, dir, db, ids, ctx } = await fixture('ccrc-hist-cp39-t2j-');
    try {
      // A scheduled call takes twenty: its walk finishes first (no read), then the budget is spent after the twentieth read.
      const reads = CP39.countReads(dir);
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (reads.n() >= 20 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { reads.restore(); }
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: twenty seen before the import').toBe(20);
      let t = 0;
      const w = countedWindows();
      const opCtx = {
        home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now: () => (t += 100), out: () => {},
        deps: { statfs: PLENTY, budget: w.limits },
      };
      // About nine sidecars fit a window (a check per sidecar at 100 ms of a 1,000 ms window), so the first windows examine seen sidecars only.
      expect(await S.importSidecars(db, opCtx, [IX.U])).toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'the import took the ten left, past the twenty seen').toBe(CP39.ROWS);
      expect(w.n()).toBeLessThan(40);
    } finally { db.close(); }
  });

  it('a walk an import window started is resumed by a scheduled tick from its persisted cursor, and links as one uncut walk', async () => {
    const { S, box, db, ids, pk, rowIds } = await fixture('ccrc-hist-cp39-t2f-');
    try {
      const dec = await CP39.countDecodes();
      let t = 0;
      // The clock creeps until the fifth row decode, then leaps: the first window is cut there, and the second is spent at its first check.
      const opCtx = {
        home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now: () => (t += dec.n() >= 5 ? 2_000 : 1), out: () => {},
        deps: { statfs: PLENTY, budget: { maxMs: 1_000 } },
      };
      let ended: string;
      try { ended = await S.importSidecars(db, opCtx, [IX.U]); } finally { dec.restore(); }
      expect(ended, 'a window spent before its first check is no progress: the import ends').toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the import took no sidecar').toBe(0);
      expect(CP39.walkState(db, pk)?.walk?.after, 'it left its walk at the fifth user row').toBe(rowIds[4]);
      const dec2 = await CP39.countDecodes();
      try { await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 3_000_000, ids), S.newBudget()); } finally { dec2.restore(); }
      expect(dec2.n(), 'the tick resumed the walk: only the rows after the fifth').toBe(CP39.ROWS + 1 - 5);
      expect(CP39.sidecarRows(db), 'and linked as one uncut walk links').toEqual(CP39.linked(CP39.upTo(CP39.ROWS)));
    } finally { db.close(); }
  });

  it("a uuid's sidecars under two homes are one group: one walk links both homes' copies, a same-name pair to one entry", async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as S2;
    const box = IX.newBox('ccrc-hist-cp39-t2g-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const zero = CP39.sideDir(box.homes[0]!);
    const one = CP39.sideDir(box.homes[1]!);   // a home with no <uuid>.jsonl, as _swap_carry_sidecars leaves one
    for (const k of [1, 2, 3]) fs.writeFileSync(path.join(zero, `out${k}.txt`), `home zero ${k}\n`);
    for (const k of [3, 4]) fs.writeFileSync(path.join(one, `out${k}.txt`), `home one ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const dec = await CP39.countDecodes();
      try { expect((await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(), [IX.U])).complete).toBe(true); } finally { dec.restore(); }
      expect(dec.n(), 'the rows were walked once, for both homes').toBe(CP39.ROWS + 1);
      expect(CP39.sidecarRows(db)).toEqual(CP39.linked([1, 2, 3, 3, 4]));
    } finally { db.close(); }
  });

  it('the walk state is parsed once per pass however many sidecars link from it (P10)', async () => {
    const { S, dir, db, ctx, pk } = await fixture('ccrc-hist-cp39-t2h-');
    try {
      const reads = CP39.countReads(dir);
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (reads.n() >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { reads.restore(); }
      expect(CP39.walkState(db, pk)?.done.names, 'CONTROL: a done walk is kept for the next pass').toHaveLength(CP39.ROWS);
      const realParse = JSON.parse;
      let parses = 0;
      JSON.parse = function parse(text: string, ...rest: unknown[]): unknown {
        if (typeof text === 'string' && text.startsWith('{"v":1,"done":')) parses += 1;
        return (realParse as (...a: unknown[]) => unknown)(text, ...rest);
      } as typeof JSON.parse;
      let r: { complete: boolean };
      try { r = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]); } finally { JSON.parse = realParse; }
      expect(r.complete).toBe(true);
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the other 29 sidecars linked from the one state').toBe(CP39.ROWS);
      expect(parses, 'one parse for the group, none per sidecar: no walk advanced in this pass').toBeLessThanOrEqual(1);
    } finally { db.close(); }
  });

  it("O20 at the walk's cap: a walk of SIDECAR_WALK_CHARS_MAX units of names beside a 64 MiB sidecar, captured by the real sweep under O20's bound (P22)", async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-cp39-t2i-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
      const dir = CP39.sideDir(box.homes[0]!);
      // 2,100 names of 250 units: more than the cap holds, so the first walk is built at it (CONTROL below).
      const many = Array.from({ length: 2_100 }, (_, i) => `cp39-${String(i).padStart(4, '0')}-${'q'.repeat(236)}.txt`);
      for (const n of many) fs.writeFileSync(path.join(dir, n), 'x\n');
      const fd = fs.openSync(path.join(dir, 'whole64.txt'), 'w');
      try { for (let at = 0, k = 1; at < 67_108_864; k += 1) { const piece = Buffer.from(IX.words(4000, k)).subarray(0, 67_108_864 - at); fs.writeSync(fd, piece); at += piece.length; } } finally { fs.closeSync(fd); }
      const first = lib.walkNames([...many, 'whole64.txt'], many[0]!);
      expect(first.reduce((n, s) => n + s.length, 0), 'CONTROL: the first walk is built at the cap').toBeGreaterThan(lib.SIDECAR_WALK_CHARS_MAX - 250);
      let peak = 0;
      for (let pass = 0; pass < 4; pass += 1) {
        const r = runSweep(box, [], { preloads: [IX_RSS_PRELOAD] });
        expect(r.code, r.stderr).toBe(0);
        peak = Math.max(peak, Number(/history-test-maxrss-kib=(\d+)/.exec(r.stderr)?.[1] ?? 'NaN'));
        const db = openStoreRO(box);
        let seen = 0;
        try { seen = IX.count(db, 'sidecar_seen'); } finally { db.close(); }
        if (seen === many.length + 1) break;
      }
      const db = openStoreRO(box);
      try { expect(IX.count(db, 'sidecar_seen'), 'every sidecar was taken').toBe(many.length + 1); } finally { db.close(); }
      console.log(`CP-39 walk-cap peak RSS ${peak} KiB on ${process.version}`);
      expect(peak).toBeLessThan(IX_RSS_BOUND_KIB);
    } finally {
      fs.rmSync(box.home, { recursive: true, force: true });   // a 64 MiB sidecar plus its store: never left for afterAll alone
    }
  }, 300_000);

  it("a group an import window skips whole through opts.from keeps its walk state: only a group the call took up retires (D-6931)", async () => {
    const { S, p, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2k-');
    try {
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.after, 'CONTROL: a walk in progress').toBe(rowIds[9]);
      // A name the walk in progress does not cover waits, so the group is not examined in full and keeps its state.
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      fs.appendFileSync(p, lateRow());
      await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: ctx.homes[0]! }, S.newBudget());
      const first = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]);
      expect(first.complete, 'CONTROL: window 1 deferred late.txt').toBe(false);
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: every out<k>.txt taken').toBe(CP39.ROWS);
      expect(walkRows(db), 'CONTROL: the group kept its state').toBe(1);
      // Window 2 resumes after the group's last sidecar, so it takes up none of it.
      const second = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U], { from: path.join(dir, 'out9.txt') });
      expect(second, 'window 2 examined nothing').toEqual({ bytes: 0, complete: true, paused: false });
      expect(walkRows(db), 'a group the call skipped whole keeps its state').toBe(1);
    } finally { db.close(); }
  });

  it('a group whose every sidecar is already seen retires a walk state kept beside it, found by its uuid (D-6931)', async () => {
    const { S, db, ctx, pk } = await fixture('ccrc-hist-cp39-t2l-');
    try {
      expect((await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])).complete, 'CONTROL: every sidecar taken').toBe(true);
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL').toBe(CP39.ROWS);
      expect(walkRows(db), 'CONTROL: taking them retired the walk').toBe(0);
      const { lib } = await IX.api();
      const kept = lib.emptySidecarWalk();
      kept.done.names.push('out1.txt');
      db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run(`sidecar_walk:${pk}`, lib.formatSidecarWalk(kept));
      expect(walkRows(db), 'CONTROL: a state kept beside a seen group').toBe(1);
      // No sidecar reaches its link, so the group never learns its transcript: the retire finds it by uuid.
      expect((await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])).complete).toBe(true);
      expect(walkRows(db), 'the kept state is gone').toBe(0);
    } finally { db.close(); }
  });
});

describe('CP-39 Task 3: each half of the ingest keeps its own scan mark, and discovery runs under the budget (D-6933, D-6934, D-6938)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const sideDir = (home: string, uuid = IX.U): string => CP39.sideDir(home, uuid);
  const metaV = (db: DatabaseSync, k: string): string | null => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null;
  const PLENTY = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 });
  const counterOf = (db: DatabaseSync, name: string): number | undefined =>
    (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;
  /** As the FR2-d describe's: node:fs's readSync faulted for the descriptors that name `bad`, carried to sweep.mjs by
   *  syncBuiltinESMExports. */
  const failReads = (bad: string, code = 'EIO'): { faulted: () => number; restore: () => void } => {
    const realRead = fs.readSync;
    let faulted = 0;
    const err = Object.assign(new Error(`${code}: i/o error, read`), { code, errno: -5, syscall: 'read' });
    (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) === bad) { faulted += 1; throw err; }
      return (realRead as (...a: unknown[]) => number)(fd, ...rest);
    };
    syncBuiltinESMExports();
    return { faulted: () => faulted, restore: () => { (fs as { readSync: unknown }).readSync = realRead; syncBuiltinESMExports(); } };
  };
  /** The directories one call lists, counted outside the sweep: every readdirSync under a projects/ tree of the fixture
   *  box (rooted at `root`, its home), and the uuid of every tool-results/ listed. */
  const listings = (root: string): { projects: () => string[]; toolResults: () => string[]; restore: () => void } => {
    const real = fs.readdirSync;
    const projects: string[] = [];
    const toolResults: string[] = [];
    (fs as { readdirSync: unknown }).readdirSync = function readdirSync(p: unknown, ...rest: unknown[]): unknown {
      const s = String(p);
      if (s.startsWith(`${root}/`) && s.includes('/projects')) projects.push(s);
      if (s.endsWith('/tool-results')) toolResults.push(path.basename(path.dirname(s)));
      return (real as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    syncBuiltinESMExports();
    return { projects: () => projects, toolResults: () => toolResults, restore: () => { (fs as { readdirSync: unknown }).readdirSync = real; syncBuiltinESMExports(); } };
  };
  /** Three known uuids under home 0, each a one-row transcript, ingested by a first tick over no sidecar (its wrap
   *  completes); then one sidecar each, and the sidecar mark deleted so that ONLY the sidecar scan is due on the next ticks. */
  const threeUuids = async (prefix: string) => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox(prefix);
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    plantSession(box, 'claude-demo3', { uuid: IX.U3, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    const uuids = [IX.U, IX.U2, IX.U3];   // their directories sort in this order
    uuids.forEach((u, i) => IX.plantCopy(box.homes[0]!, u, IX.jsonl([IX.user(IX.uuidN(500 + i), null, 'go', 500 + i, { sessionId: u })])));
    const { db, ids } = await IX.openFixtureStore(box);
    const t0 = IX.tsMs(0) + 60_000;
    await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget());
    expect(metaV(db, 'scan_sidecars_ms'), 'CONTROL: the first wrap completed').toBe(String(t0));
    uuids.forEach((u) => fs.writeFileSync(path.join(sideDir(box.homes[0]!, u), 'one.txt'), `the sidecar of ${u}\n`));
    db.prepare("DELETE FROM meta WHERE k = 'scan_sidecars_ms'").run();
    const tick = (k: number, budget: IxBudget) => S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + k * 60_000, ids), budget);
    return { S, box, db, ids, t0, tick };
  };

  it('a sidecar half the budget cut leaves only its own mark unset: the transcripts are not rediscovered, and the next unhinted tick still takes the known uuid\'s sidecar', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-cp39-t3a-');
    const text = IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]);
    IX.plantCopy(box.homes[0]!, IX.U, text);
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'a-first.txt'), 'first body\n');
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b-second.txt'), 'second body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const at = IX.tsMs(0) + 60_000;
      // The byte budget lets the transcript, its one-row walk and the first sidecar in, then holds the second.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at, ids), S.newBudget(Date.now, { maxBytes: Buffer.byteLength(text) + 1 }));
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the budget cut the sidecar half after one').toBe(1);
      expect(metaV(db, 'scan_discover_ms'), 'the transcripts are done, so their scan is marked').toBe(String(at));
      expect(metaV(db, 'scan_sidecars_ms'), 'the sidecar half is not').toBeNull();
      // One minute on: no transcript scan is due, nothing is hinted, and the sidecar scan still covers the known uuid.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at + 60_000, ids), S.newBudget());
      expect(IX.count(db, 'sidecar_seen'), 'the second sidecar is taken by the sidecar scan alone').toBe(2);
      expect(metaV(db, 'scan_discover_ms'), 'the transcript scan was not re-run').toBe(String(at));
      expect(metaV(db, 'scan_sidecars_ms')).toBe(String(at + 60_000));
    } finally { db.close(); }
  });

  it('D-4340 narrowed: a sidecar read error holds only the sidecar mark; a transcript read error holds only the transcript mark (D-6934)', async () => {
    const { sweep: S } = await IX.api();
    const at = IX.tsMs(0) + 60_000;
    // Arm (a): EIO on a sidecar. The transcripts are done, so their mark is set; the sidecar scan met the error, so its mark is held.
    {
      const box = IX.newBox('ccrc-hist-cp39-t3b1-');
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      const dir = sideDir(box.homes[0]!);
      const bad = path.join(fs.realpathSync(dir), 'a-bad.txt');
      fs.writeFileSync(bad, 'unreadable body\n');
      fs.writeFileSync(path.join(dir, 'b-good.txt'), 'readable body\n');
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        const f = failReads(bad);
        try { await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at, ids), S.newBudget()); } finally { f.restore(); }
        expect(f.faulted(), 'CONTROL: arm (a), the fault fired').toBeGreaterThanOrEqual(1);
        expect(counterOf(db, 'file_unreadable'), 'CONTROL: arm (a), counted once').toBe(1);
        expect(IX.count(db, 'sidecars'), 'arm (a): the good sidecar was taken').toBe(1);
        expect(metaV(db, 'scan_discover_ms'), 'arm (a): the transcript mark is set').toBe(String(at));
        expect(metaV(db, 'scan_sidecars_ms'), 'arm (a): the sidecar mark is held').toBeNull();
      } finally { db.close(); }
    }
    // Arm (b): EIO on a transcript. Its mark is held; the sidecar scan, complete over the other uuid, sets its own.
    {
      const box = IX.newBox('ccrc-hist-cp39-t3b2-');
      plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
      const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'unreadable', 1)]));
      IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'readable', 21, { sessionId: IX.U2 })]));
      fs.writeFileSync(path.join(sideDir(box.homes[0]!, IX.U2), 'c-u2.txt'), 'the readable session\'s sidecar\n');
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        const f = failReads(fs.realpathSync(bad));
        try { await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at, ids), S.newBudget()); } finally { f.restore(); }
        expect(f.faulted(), 'CONTROL: arm (b), the fault fired').toBeGreaterThanOrEqual(1);
        expect(counterOf(db, 'file_unreadable'), 'CONTROL: arm (b), counted once').toBe(1);
        expect(IX.count(db, 'sidecars'), "arm (b): the other uuid's sidecar was taken").toBe(1);
        expect(metaV(db, 'scan_discover_ms'), 'arm (b): the transcript mark is held').toBeNull();
        expect(metaV(db, 'scan_sidecars_ms'), 'arm (b): the sidecar mark is set').toBe(String(at));
      } finally { db.close(); }
    }
  });

  it('the sidecar scan resumes from its uuid-directory cursor: a cut wrap goes on where it stopped, the mark waits for the whole wrap, and the wrap stamps sidecars_unseen (D-6938)', async () => {
    const { S, box, db, t0, tick } = await threeUuids('ccrc-hist-cp39-t3c-');
    try {
      // One byte a tick: the listing and one sidecar (a one-row walk, then its read) fit, then the budget is spent.
      const run = async (k: number, budget: IxBudget): Promise<string[]> => {
        const l = listings(box.home);
        try { await tick(k, budget); } finally { l.restore(); }
        return l.toolResults();
      };
      expect(await run(1, S.newBudget(Date.now, { maxBytes: 1 })), 'tick 1 lists from the start').toEqual([IX.U, IX.U2, IX.U3]);
      expect(IX.count(db, 'sidecar_seen')).toBe(1);
      expect(JSON.parse(metaV(db, 'scan_sidecars_at')!).dir, "the cursor passed U's directory").toMatch(new RegExp(`/${IX.U}$`));
      expect(metaV(db, 'scan_sidecars_ms'), 'the mark waits for the whole wrap').toBeNull();
      expect(await run(2, S.newBudget(Date.now, { maxBytes: 1 })), 'tick 2 lists only after its cursor').toEqual([IX.U2, IX.U3]);
      expect(IX.count(db, 'sidecar_seen')).toBe(2);
      expect(metaV(db, 'scan_sidecars_ms'), 'still waiting').toBeNull();
      expect(await run(3, S.newBudget()), 'tick 3 finishes the wrap').toEqual([IX.U3]);
      expect(IX.count(db, 'sidecar_seen')).toBe(3);
      expect(metaV(db, 'scan_sidecars_ms'), 'the wrap completed clean: the mark').toBe(String(t0 + 3 * 60_000));
      expect(metaV(db, 'sidecars_unseen'), 'the wrap took three, over three ticks').toBe('3');
      expect(metaV(db, 'scan_sidecars_at'), 'the cursor is reset for the next wrap').toBeNull();
    } finally { db.close(); }
  });

  it('discovery runs under the budget: a spent budget lists nothing under projects/; one spent by a tool-results/ listing lists no further uuid directory (D-6938)', async () => {
    const { S, box, db, tick } = await threeUuids('ccrc-hist-cp39-t3d-');
    try {
      // (1) Both scans due, the budget spent at entry: neither the transcript scan nor the sidecar scan lists a directory.
      db.prepare("DELETE FROM meta WHERE k = 'scan_discover_ms'").run();
      const l1 = listings(box.home);
      try { await tick(1, S.newBudget(() => 0, { maxMs: 0 })); } finally { l1.restore(); }
      expect(l1.projects(), 'a spent budget lists nothing under projects/').toEqual([]);
      // (2) The budget is spent by the first tool-results/ listing: the check before the next uuid directory stops the listing.
      const l2 = listings(box.home);
      try { await tick(2, S.newBudget(() => (l2.toolResults().length >= 1 ? 10_000 : 0), { maxMs: 1_000 })); } finally { l2.restore(); }
      expect(l2.toolResults(), 'one uuid directory listed, then the check failed').toEqual([IX.U]);
      expect(IX.count(db, 'sidecar_seen'), 'the budget was spent before any sidecar').toBe(0);
      expect(metaV(db, 'scan_sidecars_at'), 'no directory was examined: the cursor did not move').toBeNull();
    } finally { db.close(); }
  });

  it("the group's lstats run under the budget: once it is spent, unseenOf lstats nothing and the sidecar waits (D-6938)", async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3e-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(dir, `out${k}.txt`), `body ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    const real = fs.lstatSync;
    const under = [`${dir}/`, `${fs.realpathSync(dir)}/`];
    let lstats = 0;
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      (fs as { lstatSync: unknown }).lstatSync = function lstatSync(p: unknown, ...rest: unknown[]): unknown {
        if (under.some((d) => String(p).startsWith(d))) lstats += 1;
        return (real as (...a: unknown[]) => unknown)(p, ...rest);
      };
      syncBuiltinESMExports();
      const r = await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(() => (lstats >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]);
      expect(r, 'the sidecar waits: nothing read, nothing walked').toEqual({ bytes: 0, complete: false, paused: false });
      expect(lstats, "only the sidecar's own lstat; none for its group").toBe(1);
    } finally { (fs as { lstatSync: unknown }).lstatSync = real; syncBuiltinESMExports(); db.close(); }
  });

  /** An in-process import's context over the box, whose window limits count the windows at the read of `maxMs` (newBudget
   *  reads it once a window, before the window's listing, and nothing else reads it); `onWindow` runs there too. Past 40 the
   *  read throws, the one stop an import whose listing never ends has; the cases read the count directly. */
  type ImportS = { importSidecars(db: DatabaseSync, ctx: Record<string, unknown>, uuids: string[]): Promise<string> };
  const importCtx = (box: { home: string; homes: string[] }, ids: unknown, now: () => number, onWindow: () => void = () => {}) => {
    let windows = 0;
    const limits = { get maxMs() { windows += 1; onWindow(); if (windows > 40) throw new Error('more than 40 windows: the import does not end'); return 1_000; } };
    return { windows: () => windows, ctx: { home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now, out: () => {}, deps: { statfs: PLENTY, budget: limits } } };
  };

  it('a walk whose names can no longer reach the link holds nothing back: its sidecar deleted, the sidecar over SIDECAR_MAX_BYTES beside it never in a walk, the new name is linked and the wrap completes with its mark (D-6938)', async () => {
    const { sweep, lib } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3f-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    const big = path.join(dir, 'big.txt');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, lib.SIDECAR_MAX_BYTES + 1);   // sparse: over the cap by its stat, with no block written
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const pk = CP39.pkOf(db);
      // out1.txt starts a walk, which the budget cuts at its fifth row.
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'the walk takes only the names that can reach the link, never the sidecar over the cap').toEqual(['out1.txt']);
      fs.rmSync(path.join(dir, 'out1.txt'));
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      // Two minutes on: only the sidecar scan is due, and its wrap visits the group.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + 120_000, ids), S.newBudget());
      expect(CP39.sidecarRows(db).map((r) => r.name), 'the new name is taken in the same tick: no walk held it back').toEqual(['late.txt']);
      expect(metaV(db, 'scan_sidecars_ms'), 'the wrap completed clean: its mark is written').toBe(String(t0 + 120_000));
      expect(metaV(db, 'sidecars_unseen'), 'it took late.txt and left the sidecar over the cap unseen').toBe('2');
      expect(IX.count(db, 'meta', "k LIKE 'sidecar\\_walk:%' ESCAPE '\\'"), 'the group was examined in full: the walk state retired').toBe(0);
    } finally { db.close(); }
  });

  it('a walk that advanced no row over a whole visit of its group is retired, and the wrap counts every sidecar it left unseen, the deferred one included, in sidecars_unseen (D-6938)', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3g-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    fs.writeFileSync(path.join(dir, 'locked.txt'), 'never admitted\n');
    const { db, ids } = await IX.openFixtureStore(box);
    // locked.txt is a small regular file whose every open is refused (EACCES), so admission refuses it before its link on
    // every pass: a name a walk can hold that never reaches the link. node:fs's DEFAULT openSync, carried to sweep.mjs.
    const realOpen = fs.openSync;
    try {
      (fs as { openSync: unknown }).openSync = function openSync(p: unknown, ...rest: unknown[]): unknown {
        if (String(p).endsWith('/locked.txt')) throw Object.assign(new Error(`EACCES: permission denied, open '${String(p)}'`), { code: 'EACCES' });
        return (realOpen as (...a: unknown[]) => unknown).call(fs, p, ...rest);
      };
      syncBuiltinESMExports();
      const t0 = IX.tsMs(0) + 60_000;
      const tick = (k: number, budget: IxBudget) => S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + k * 60_000, ids), budget);
      await tick(0, S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const pk = CP39.pkOf(db);
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'CONTROL: a walk in progress holds locked.txt, which never reaches the link').toEqual(['locked.txt', 'out1.txt']);
      fs.rmSync(path.join(dir, 'out1.txt'));
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      // Tick 2: the scan's visit of the group defers late.txt (the walk holds locked.txt, still unseen), refuses locked.txt, and advances no row.
      await tick(2, S.newBudget());
      expect(CP39.walkState(db, pk)?.walk ?? null, "the walk that advanced no row over its group's whole visit is retired").toBeNull();
      expect(metaV(db, 'sidecars_unseen'), 'the wrap left two unseen: late.txt deferred and locked.txt refused').toBe('2');
      expect(metaV(db, 'scan_sidecars_ms'), 'a deferral holds the mark').toBeNull();
      // Tick 3: a new wrap; late.txt starts an extension walk, which links it.
      await tick(3, S.newBudget());
      expect(CP39.sidecarRows(db).map((r) => r.name), 'late.txt is taken').toEqual(['late.txt']);
      expect(metaV(db, 'scan_sidecars_ms'), 'the next wrap completed clean: its mark').toBe(String(t0 + 3 * 60_000));
    } finally { (fs as { openSync: unknown }).openSync = realOpen; syncBuiltinESMExports(); db.close(); }
  });

  it('import: a window whose listing its budget cut resumes the listing from its own cursor in the next window, lists each uuid directory once, and ends done only with every sidecar seen (D-6932, D-6938)', async () => {
    const { S, box, db, ids } = await threeUuids('ccrc-hist-cp39-t3h-');
    try {
      const l = listings(box.home);
      let t = 0;
      let leapt = false;
      // The clock creeps, and leaps once, at its first read after the first tool-results/ listing: the first window's listing is cut there.
      const now = (): number => { if (!leapt && l.toolResults().length >= 1) { leapt = true; t += 10_000; } return (t += 1); };
      const im = importCtx(box, ids, now);
      let ended: string;
      try { ended = await (S as unknown as ImportS).importSidecars(db, im.ctx, [IX.U, IX.U2, IX.U3]); } finally { l.restore(); }
      expect(leapt, 'CONTROL: the clock leapt inside the first listing').toBe(true);
      expect(ended).toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'done only with every sidecar seen').toBe(3);
      expect(im.windows(), 'the cut listing ended its window, and the next resumed it').toBe(2);
      expect(l.toolResults(), 'each uuid directory listed once over the import').toEqual([IX.U, IX.U2, IX.U3]);
    } finally { db.close(); }
  });

  it('import: a listing cut before its first uuid directory lists the rest once with no budget, in the same window, and the next window ingests (D-6932)', async () => {
    const { S, box, db, ids } = await threeUuids('ccrc-hist-cp39-t3i-');
    try {
      const l = listings(box.home);
      let t = 0;
      let windows = 0;
      let leaptIn = 0;
      let base = 0;
      // The clock leaps at its first read after a window's first projects/ listing: every window's budgeted listing is cut
      // before its first uuid directory, so only the retry can end it.
      const now = (): number => { if (windows !== leaptIn && l.projects().length > base) { leaptIn = windows; t += 10_000; } return (t += 1); };
      const im = importCtx(box, ids, now, () => { windows += 1; base = l.projects().length; });
      let ended: string;
      try { ended = await (S as unknown as ImportS).importSidecars(db, im.ctx, [IX.U, IX.U2, IX.U3]); } finally { l.restore(); }
      expect(ended).toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'done only with every sidecar seen').toBe(3);
      expect(im.windows(), 'the retry ended the listing in the first window; the second ingested').toBe(2);
      expect(l.toolResults(), 'each uuid directory listed once, by the retry').toEqual([IX.U, IX.U2, IX.U3]);
    } finally { db.close(); }
  });

  it('a non-regular entry named like a sidecar, beside a walk whose sidecar is deleted, is never in a walk: the new name is linked and the wrap completes with its mark (D-6938)', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3j-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    fs.mkdirSync(path.join(dir, 'dir.txt'));   // a directory under a sidecar's name: its lstat is no regular file
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const pk = CP39.pkOf(db);
      // out1.txt starts a walk, which the budget cuts at its fifth row.
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'the walk takes only the names that can reach the link, never the entry that is not a regular file').toEqual(['out1.txt']);
      fs.rmSync(path.join(dir, 'out1.txt'));
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      // Two minutes on: only the sidecar scan is due, and its wrap visits the group.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + 120_000, ids), S.newBudget());
      expect(CP39.sidecarRows(db).map((r) => r.name), 'the new name is taken in the same tick: no walk held it back').toEqual(['late.txt']);
      expect(metaV(db, 'scan_sidecars_ms'), 'the wrap completed clean: its mark is written').toBe(String(t0 + 120_000));
      expect(IX.count(db, 'meta', "k LIKE 'sidecar\\_walk:%' ESCAPE '\\'"), 'the group was examined in full: the walk state retired').toBe(0);
    } finally { db.close(); }
  });

  it("unseenOf leaves out a name whose lstat fails: a sidecar listed and then gone before its group's lstat holds nothing back and is no fault (D-6938)", async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3k-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'gone.txt'), 'listed, then gone\n');
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    const { db, ids } = await IX.openFixtureStore(box);
    const real = fs.lstatSync;
    let failed = 0;
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      // gone.txt is listed (the listing reads names only), and every lstat of it answers ENOENT, the shape of a name deleted
      // between the listing and the lstat: its own lstat (counted missing, as today) and its group's, in unseenOf, when
      // out1.txt (sorted after it) asks for its link.
      (fs as { lstatSync: unknown }).lstatSync = function lstatSync(p: unknown, ...rest: unknown[]): unknown {
        if (String(p).endsWith('/tool-results/gone.txt')) {
          failed += 1;
          throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${String(p)}'`), { code: 'ENOENT', syscall: 'lstat' });
        }
        return (real as (...a: unknown[]) => unknown)(p, ...rest);
      };
      syncBuiltinESMExports();
      const r = await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(), [IX.U]);
      expect(failed, "CONTROL: gone.txt's own lstat and its group's both failed").toBe(2);
      expect(CP39.sidecarRows(db).map((x) => x.name), 'out1.txt is taken in the same call: the failed lstat left gone.txt out of the walk').toEqual(['out1.txt']);
      expect((r as Record<string, unknown>).unreadable, 'a failed lstat in unseenOf is no read error').toBeUndefined();
      expect(r.complete, 'the call completed').toBe(true);
    } finally { (fs as { lstatSync: unknown }).lstatSync = real; syncBuiltinESMExports(); db.close(); }
  });

  it('a taken sidecar of zero bytes is counted as taken in the wrap, never as one already seen: the result says `taken` beside `bytes: 0` (D-6938)', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3l-');
    IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'empty.txt'), '');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the empty sidecar was taken').toBe(1);
      expect(metaV(db, 'sidecars_unseen'), 'the wrap took one').toBe('1');
    } finally { db.close(); }
  });

  it('a fault in the given share holds the wrap\'s mark: a hinted uuid\'s sidecar read error on a tick whose scan share closes the wrap leaves scan_sidecars_ms unset (D-6934)', async () => {
    const { S, box, db, ids, t0 } = await threeUuids('ccrc-hist-cp39-t3m-');
    try {
      type Side = { ingestSidecars(db: DatabaseSync, ctx: unknown, b: IxBudget, uuids: string[], opts: { scan: Set<string> }): Promise<Record<string, unknown>> };
      const bad = path.join(fs.realpathSync(sideDir(box.homes[0]!, IX.U)), 'one.txt');
      const f = failReads(bad);
      let r: Record<string, unknown>;
      try {
        // U is the given share (hinted); U2 and U3 are the scan's, and the scan completes its wrap over both.
        r = await (S as unknown as Side).ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(), [IX.U], { scan: new Set([IX.U, IX.U2, IX.U3]) });
      } finally { f.restore(); }
      expect(f.faulted(), 'CONTROL: the fault fired').toBeGreaterThanOrEqual(1);
      expect(counterOf(db, 'file_unreadable'), 'CONTROL: counted once').toBe(1);
      expect(IX.count(db, 'sidecar_seen'), "CONTROL: the scan share took U2's and U3's").toBe(2);
      expect(r['unreadable'], 'CONTROL: the call reports the fault').toBe(true);
      expect(metaV(db, 'sidecars_unseen'), 'the wrap closed: two taken, none left').toBe('2');
      expect(metaV(db, 'scan_sidecars_ms'), "the given share's fault holds the wrap's mark").toBeNull();
    } finally { db.close(); }
  });

  it('a cursor naming a directory under a home no longer rostered, or one that does not parse, restarts the wrap from the start: every known uuid is listed and taken, never skipped (D-6938)', async () => {
    for (const [i, dir] of [`/home/u/gone/projects/${IX.SLUG}/${IX.U2}`, 'not-a-directory'].entries()) {
      const { S, box, db, t0, tick } = await threeUuids(`ccrc-hist-cp39-t3n${i}-`);
      try {
        db.prepare("INSERT INTO meta (k, v) VALUES ('scan_sidecars_at', ?)").run(JSON.stringify({ v: 1, dir, taken: 0, left: 0, held: false }));
        const l = listings(box.home);
        try { await tick(1, S.newBudget()); } finally { l.restore(); }
        expect(l.toolResults(), `arm ${i}: the wrap restarted from the start`).toEqual([IX.U, IX.U2, IX.U3]);
        expect(IX.count(db, 'sidecar_seen'), `arm ${i}: every sidecar taken`).toBe(3);
        expect(metaV(db, 'scan_sidecars_ms'), `arm ${i}: the wrap closed clean`).toBe(String(t0 + 60_000));
        expect(metaV(db, 'sidecars_unseen'), `arm ${i}`).toBe('3');
      } finally { db.close(); }
    }
  });

  it('a deferral in the given share holds the wrap\'s mark: a hinted uuid\'s sidecar deferred behind a walk in progress, on a tick whose scan share closes the wrap, leaves scan_sidecars_ms unset (D-6934)', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    type Side = { ingestSidecars(db: DatabaseSync, ctx: unknown, b: IxBudget, uuids: string[], opts: { scan: Set<string> }): Promise<Record<string, unknown>> };
    const box = IX.newBox('ccrc-hist-cp39-t3o-');
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(500), null, 'go', 500, { sessionId: IX.U2 })]));
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    fs.writeFileSync(path.join(sideDir(box.homes[0]!, IX.U2), 'one.txt'), 'the scan share\'s sidecar\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the first transcript only
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + 1_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // and the second
      expect(IX.count(db, 'transcripts'), 'CONTROL: both transcripts are in').toBeGreaterThanOrEqual(2);
      db.prepare("DELETE FROM meta WHERE k IN ('scan_sidecars_ms', 'scan_sidecars_at')").run();
      const pk = CP39.pkOf(db);
      // out1.txt starts a walk, which the budget cuts at its fifth row.
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'CONTROL: a walk in progress holds out1.txt').toEqual(['out1.txt']);
      // late.txt sorts before out1.txt: the given share defers it (the walk holds out1.txt, still unseen), then the walk resumes and links out1.txt.
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      const r = await (S as unknown as Side).ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 120_000, ids), S.newBudget(), [IX.U], { scan: new Set([IX.U, IX.U2]) });
      expect(r['unreadable'], 'CONTROL: no read error, so the hold is the deferral\'s').toBeUndefined();
      expect(r.complete, 'CONTROL: the deferral leaves the call incomplete').toBe(false);
      expect(CP39.sidecarRows(db).map((x) => x.name), "CONTROL: out1.txt (resumed walk) and U2's sidecar taken, late.txt deferred").toEqual(['one.txt', 'out1.txt']);
      expect(metaV(db, 'sidecars_unseen'), 'the wrap closed over U2: one taken, none left').toBe('1');
      expect(metaV(db, 'scan_sidecars_ms'), "the given share's deferral holds the wrap's mark").toBeNull();
    } finally { db.close(); }
  });
});

describe('CP-39 Task 4: a ceiling rung keeps the run\'s start; a step slice starts at its step and keeps its floor (D-6935, D-6939)', () => {
  interface Lim { maxMs: number; maxBytes: number }
  interface R4 { budgetRung(b: IxBudget, l: Lim): IxBudget; stepSlice(b: IxBudget, ceiling: Lim, floor: Lim): IxBudget; budgetLeft(b: IxBudget): boolean }
  it('a ceiling rung: the run\'s start and bytes, shared; spent at its own maxMs and maxBytes while the run is live; never above the run', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep & R4;
    let t = 1_000;
    const run = S.newBudget(() => t, { maxMs: 100, maxBytes: 100 });   // starts at 1000
    t = 1_030;                                                           // the run has aged when the rung is made
    const rung = S.budgetRung(run, { maxMs: 50, maxBytes: 60 });
    expect(rung.startMs, "the rung keeps the run's start (O5), not the moment it was made").toBe(1_000);
    t = 1_049;
    expect(S.budgetLeft(rung), 'inside its maxMs').toBe(true);
    t = 1_050;
    expect(S.budgetLeft(rung), 'spent at its own maxMs').toBe(false);
    expect(S.budgetLeft(run), 'CONTROL: the run is live').toBe(true);
    const fresh = S.newBudget(() => 0, { maxMs: 100, maxBytes: 100 });
    const byBytes = S.budgetRung(fresh, { maxMs: 50, maxBytes: 60 });
    byBytes.bytes += 70;
    expect(fresh.bytes, "a charge to the rung is the run's").toBe(70);
    expect(S.budgetLeft(byBytes), 'spent at its own maxBytes').toBe(false);
    expect(S.budgetLeft(fresh), 'CONTROL: the run is not').toBe(true);
    const over = S.budgetRung(run, { maxMs: 999, maxBytes: 999 });
    expect([over.maxMs, over.maxBytes], "never above the run's limits").toEqual([100, 100]);
  });
  it('a step slice: it starts at the step, takes the larger of what is left of its ceiling and its floor, and charges the run', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep & R4;
    let t = 1_000;
    const run = S.newBudget(() => t, { maxMs: 100, maxBytes: 100 });
    // Before its ceiling: what is left of the ceiling is more than the floor.
    t = 1_020;
    run.bytes = 30;
    const early = S.stepSlice(run, { maxMs: 80, maxBytes: 80 }, { maxMs: 10, maxBytes: 20 });
    expect([early.startMs, early.maxMs, early.maxBytes, early.bytes], "the step's start; 80 - 20 ms and 80 - 30 bytes left").toEqual([1_020, 60, 50, 0]);
    // Past the run's time and past the ceiling's bytes (90 of 80): the floor, in ms and in bytes, from the step's own start.
    t = 1_150;
    run.bytes = 90;
    expect(S.budgetLeft(run), 'CONTROL: the run is spent').toBe(false);
    const late = S.stepSlice(run, { maxMs: 80, maxBytes: 80 }, { maxMs: 10, maxBytes: 20 });
    expect([late.startMs, late.maxMs, late.maxBytes], 'the floor, counted from the step').toEqual([1_150, 10, 20]);
    t = 1_159;
    expect(S.budgetLeft(late), 'inside its floor though the run is spent').toBe(true);
    late.bytes += 15;
    expect(run.bytes, "a charge to the slice is the run's").toBe(105);
    t = 1_160;
    expect(S.budgetLeft(late), 'spent at its floor').toBe(false);
  });
});

describe('CP-39 Task 4: the link walk charges its rows\' compressed bytes to the run, through an ingest rung (D-6930, D-6935)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  interface T4W {
    ingestSidecars(db: DatabaseSync, ctx: IxCtx, b: IxBudget, uuids: Iterable<string>, opts?: { from?: string | null }): Promise<Record<string, unknown> & { bytes: number; complete: boolean }>;
    budgetRung(b: IxBudget, l: { maxMs: number; maxBytes: number }): IxBudget;
    budgetLeft(b: IxBudget): boolean;
  }
  it('a rung whose byte ceiling the walk\'s first row reaches stops the walk after that row, and the run holds exactly that row\'s compressed size', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as Omit<IxSweep, 'ingestSidecars'> & T4W;
    const box = IX.newBox('ccrc-hist-cp39-t4w-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = CP39.sideDir(box.homes[0]!);
    for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(dir, `out${k}.txt`), `body ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      // The transcript half alone (a one-byte budget: the sidecar half then takes nothing).
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the transcript only').toBe(0);
      const pk = CP39.pkOf(db);
      const first = db.prepare(`SELECT length(b.z) AS n FROM entries e JOIN blobs b ON b.blob_id = e.blob_id
        WHERE e.transcript_pk = ? AND e.type = 'user' AND b.z IS NOT NULL ORDER BY e.entry_id LIMIT 1`).get(pk) as { n: number };
      expect(first.n, 'CONTROL: the first row has a compressed size to charge').toBeGreaterThan(0);
      const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids);
      // The run has room; its ingest rung's byte ceiling is one byte, which the first row's charge reaches.
      const run = S.newBudget(() => 0, { maxMs: 1_000, maxBytes: 1_000_000 });
      const rung = S.budgetRung(run, { maxMs: 1_000, maxBytes: 1 });
      const cut = await S.ingestSidecars(db, ctx, rung, [IX.U]);
      expect(cut, 'the walk took the first row, was spent by its bytes, and stopped; no sidecar byte was read').toEqual({ bytes: 0, complete: false, paused: false, walked: 1 });
      expect(run.bytes, "the walk's charge reached the run through the rung: the first row's compressed size").toBe(first.n);
      expect(S.budgetLeft(rung), 'the rung is spent').toBe(false);
      expect(S.budgetLeft(run), 'CONTROL: the run itself still has room').toBe(true);
    } finally { db.close(); }
  });
});


// ── CP-39d Task 2 (D-7096): the sweep reads a registered session's mid-turn growth within a tick ─────────────────────────
// The hook spools only on Stop, PostCompact and SessionStart, and a transcript's recorded size is the size last
// measured, so a transcript that grew mid-turn was seen at the turn's Stop line or at the 30-minute scan: the live W1-b
// p95 was 22 minutes. On a tick whose scan is not due, the sweep lstats the live main-thread files of the uuids `$REG`
// names, each uuid's newest recorded copy first, at most ACTIVE_STAT_MAX a tick, and reads each file lib's
// decideActiveRead answers 'read'. Every case drives ingestTick in this process against a fixture HOME and a fixture
// store (`IX.newBox`, `IX.openFixtureStore`); (k) is the one case through the real sweep.
describe('CP-39d: a registered session\'s transcript that grew mid-turn is read within a tick (D-7096)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  let S: IxSweep;
  let lib: typeof import('../../ccd/history/lib.mjs');
  beforeAll(async () => { ({ sweep: S, lib } = await IX.api()); });
  interface Fx { box: HistoryBox; db: DatabaseSync; ids: IxIds; t0: number; p: string }
  /** A box whose registry names `claude-demo` on IX.U, with two rows planted, and a fixture store. `t0` is the first (scan) tick. */
  const fixture = async (prefix: string, plant = true): Promise<Fx> => {
    const box = IX.newBox(prefix);
    const p = plant
      ? IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2)]))
      : path.join(box.homes[0]!, 'projects', IX.SLUG, `${IX.U}.jsonl`);
    const { db, ids } = await IX.openFixtureStore(box);
    return { box, db, ids, t0: IX.tsMs(0) + 600_000, p };
  };
  /** One in-process tick at `ms` with its ticks row. `patch` edits the ingest context first (the seams). */
  const tick = async (f: Fx, ms: number, patch?: (c: IxCtx) => void, budget?: IxBudget): Promise<IxTickResult> => {
    const ctx = S.makeIngestCtx(f.box.home, f.box.homes, ms, f.ids);
    if (patch !== undefined) patch(ctx);
    const r = await S.ingestTick(f.db, ctx, budget ?? S.newBudget());
    S.recordTick(f.db, ctx, r);
    return r;
  };
  /** A counting stat: every path the pass lstats lands in `stats`; `max` replaces the cap. */
  const counting = (stats: string[], max?: number) => (c: IxCtx): void => {
    const real = c.activeStat as (p: string) => unknown;
    c.activeStat = (p: string): unknown => { stats.push(p); return real(p); };
    if (max !== undefined) c.activeStatMax = max;
  };
  /** D-4340's in-process Stop hint: an empty draining file named for `id`; the returned function removes it. */
  const hint = (box: HistoryBox, id = IX.ID): (() => void) => {
    const d = lib.historyPaths(box.home).draining;
    fs.mkdirSync(d, { recursive: true });
    const h = path.join(d, `${id}.${IX.tsMs(0)}.1.jsonl`);
    fs.writeFileSync(h, '');
    return () => fs.rmSync(h);
  };
  const append = (p: string, rows: IxRow[]): void => { fs.appendFileSync(p, IX.jsonl(rows)); };
  const metaOf = (db: DatabaseSync, k: string): string | undefined => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  const counterOf = (db: DatabaseSync, name: string): number => (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n ?? 0;
  const entriesOf = (db: DatabaseSync, uuid: string): number =>
    (db.prepare('SELECT count(*) AS n FROM entries e JOIN transcripts t ON t.transcript_pk = e.transcript_pk WHERE t.cc_session_uuid = ?').get(uuid) as { n: number }).n;
  const stored = (db: DatabaseSync, n: number): boolean => IX.count(db, 'entries', `uuid = '${IX.uuidN(n)}'`) === 1;
  const lastTick = (db: DatabaseSync): { lag_ms: number | null; files_behind: number } =>
    db.prepare('SELECT lag_ms, files_behind FROM ticks ORDER BY tick_id DESC LIMIT 1').get() as { lag_ms: number | null; files_behind: number };
  /** Sets a file's recorded mtime_ns through the writer, by one of its paths. */
  const setRecorded = (db: DatabaseSync, p: string, ns: bigint): void => {
    db.prepare('UPDATE ingest_files SET mtime_ns = ? WHERE file_id = (SELECT file_id FROM file_paths WHERE path = ?)').run(ns, p);
  };
  const rowsOf = (from: number, to: number, ts = 500): IxRow[] => {
    const out: IxRow[] = [];
    for (let k = from; k <= to; k += 1) out.push(IX.user(IX.uuidN(k), k === from ? IX.uuidN(2) : IX.uuidN(k - 1), `mid-turn ${k}`, ts + (k - from)));
    return out;
  };

  it('(a) the production wiring: the ingest context carries ACTIVE_STAT_MAX and a stat function', async () => {
    const f = await fixture('ccrc-hist-cp39d-a-', false);
    try {
      const ctx = S.makeIngestCtx(f.box.home, f.box.homes, f.t0, f.ids);
      expect(ctx.activeStatMax).toBe(lib.ACTIVE_STAT_MAX);
      expect(typeof ctx.activeStatMax, 'a number, not an unset pair of undefineds').toBe('number');
      expect(typeof ctx.activeStat).toBe('function');
    } finally { f.db.close(); }
  });

  it('(b) the defect: rows written mid-turn, with no hint, are stored by the next non-scan tick, and the lag is measured from the row', async () => {
    const f = await fixture('ccrc-hist-cp39d-b-');
    try {
      await tick(f, f.t0);
      append(f.p, rowsOf(500, 501));
      const rec = f.db.prepare('SELECT size, offset FROM ingest_files').get() as { size: number; offset: number };
      expect(rec.size, 'CONTROL: the recorded size is the cursor, short of the file').toBe(rec.offset);
      expect(rec.size).toBeLessThan(fs.statSync(f.p).size);
      expect(metaOf(f.db, 'scan_discover_ms'), 'CONTROL: the scan ran at t0').toBe(String(f.t0));
      expect(stored(f.db, 500)).toBe(false);
      await tick(f, f.t0 + 120_000);
      expect(stored(f.db, 500), 'the first appended row is stored').toBe(true);
      expect(stored(f.db, 501), 'the second appended row is stored').toBe(true);
      expect(IX.cursorOf(f.db, 1), 'the cursor is at the file end').toBe(fs.statSync(f.p).size);
      expect(lastTick(f.db)).toEqual({ lag_ms: f.t0 + 120_000 - IX.tsMs(500), files_behind: 0 });
    } finally { f.db.close(); }
  });

  it('(c) an unregistered uuid is not stat\'ed between scans: its growth waits for the scan, and the next due scan reads it', async () => {
    const f = await fixture('ccrc-hist-cp39d-c-');
    try {
      const p2 = IX.plantCopy(f.box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(31), null, 'other session', 31)]));
      // IX.U2 is known to the store through a confirmed epoch only; no $REG entry names it.
      const pk = Number(f.db.prepare("INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms, merged_into) VALUES ('claude-other', ?, 'demo', 1, NULL)").run(IX.G).lastInsertRowid);
      f.db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'hook', 1)").run(pk, IX.U2);
      await tick(f, f.t0);
      expect(entriesOf(f.db, IX.U2), 'CONTROL: the scan read the unregistered session\'s file').toBe(1);
      append(p2, [IX.user(IX.uuidN(32), IX.uuidN(31), 'grew mid-turn', 500)]);
      append(f.p, rowsOf(500, 500));
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats));
      expect(stored(f.db, 500), 'CONTROL: the registered session\'s row is stored').toBe(true);
      expect(stats, 'only the registered session\'s file was stat\'ed').toEqual([f.p]);
      expect(stored(f.db, 32), 'the unregistered session\'s new row is not stored').toBe(false);
      await tick(f, f.t0 + lib.SCAN_INTERVAL_MS + 1_000);
      expect(stored(f.db, 32), 'CONTROL: the next due scan stores it').toBe(true);
    } finally { f.db.close(); }
  });

  it('(d) on a scan tick the pass stats nothing, and the scan stores the rows', async () => {
    const f = await fixture('ccrc-hist-cp39d-d-');
    try {
      await tick(f, f.t0);
      append(f.p, rowsOf(500, 500));
      f.db.prepare("DELETE FROM meta WHERE k = 'scan_discover_ms'").run();
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats));
      expect(stats, 'a scan tick makes no active stat').toEqual([]);
      expect(stored(f.db, 500), 'the scan stored the row').toBe(true);
      expect(metaOf(f.db, 'scan_discover_ms'), 'CONTROL: the scan completed').toBe(String(f.t0 + 120_000));
      append(f.p, rowsOf(510, 510, 510));
      const control: string[] = [];
      await tick(f, f.t0 + 240_000, counting(control));
      expect(control, 'CONTROL: the same append on a non-scan tick pushes one stat').toEqual([f.p]);
      expect(stored(f.db, 510)).toBe(true);
    } finally { f.db.close(); }
  });

  it('(e) the cap: at most activeStatMax lstats a tick, each uuid\'s most recently recorded copy first; the rest wait for the scan', async () => {
    const f = await fixture('ccrc-hist-cp39d-e-');
    try {
      plantSession(f.box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
      plantSession(f.box, 'claude-demo3', { uuid: IX.U3, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
      const p2 = IX.plantCopy(f.box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(41), null, 'second', 41)]));
      const p3 = IX.plantCopy(f.box.homes[0]!, IX.U3, IX.jsonl([IX.user(IX.uuidN(51), null, 'third', 51)]));
      await tick(f, f.t0);
      expect(IX.count(f.db, 'ingest_files'), 'CONTROL: all three read at the scan').toBe(3);
      setRecorded(f.db, f.p, 5_000_000_000_000_000_000n);
      setRecorded(f.db, p2, 4_000_000_000_000_000_000n);
      setRecorded(f.db, p3, 3_000_000_000_000_000_000n);
      append(f.p, rowsOf(500, 500));
      append(p2, [IX.user(IX.uuidN(42), IX.uuidN(41), 'second grew', 500)]);
      append(p3, [IX.user(IX.uuidN(52), IX.uuidN(51), 'third grew', 500)]);
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats, 2));
      expect(stats, 'the two most recently recorded paths only').toEqual([f.p, p2]);
      expect(stored(f.db, 500) && stored(f.db, 42)).toBe(true);
      expect(stored(f.db, 52), 'the third\'s new row is not stored').toBe(false);
      await tick(f, f.t0 + lib.SCAN_INTERVAL_MS + 1_000);
      expect(stored(f.db, 52), 'CONTROL: the next due scan stores it').toBe(true);
    } finally { f.db.close(); }
  });

  it('(f) a shrink: a file rewritten shorter than its cursor, same inode, is read from 0 and counted source_shrank', async () => {
    const f = await fixture('ccrc-hist-cp39d-f-');
    try {
      await tick(f, f.t0);
      const first = `${fs.readFileSync(f.p, 'utf8').split('\n')[0]}\n`;
      const ino = fs.statSync(f.p).ino;
      fs.writeFileSync(f.p, first);   // truncated in place: the same inode, the same first line
      expect(fs.statSync(f.p).ino, 'CONTROL: the same inode').toBe(ino);
      expect(counterOf(f.db, 'source_shrank')).toBe(0);
      const r = await tick(f, f.t0 + 120_000);
      expect(counterOf(f.db, 'source_shrank')).toBe(1);
      expect(r.bytes, 'read from 0: the whole shorter file').toBe(Buffer.byteLength(first));
      expect(IX.cursorOf(f.db, 1)).toBe(Buffer.byteLength(first));
    } finally { f.db.close(); }
  });

  it('(g) a rename is read on the non-scan tick; a vanished path is skipped silently: nothing counted, the row stays live', async () => {
    const f = await fixture('ccrc-hist-cp39d-g-');
    try {
      await tick(f, f.t0);
      const fresh = `${f.p}.new`;
      fs.writeFileSync(fresh, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2), ...rowsOf(700, 700)]));
      const oldIno = fs.statSync(f.p).ino;
      fs.renameSync(fresh, f.p);
      expect(fs.statSync(f.p).ino, 'CONTROL: another inode stands at the path').not.toBe(oldIno);
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats));
      expect(stats).toEqual([f.p]);
      expect(stored(f.db, 700), 'the renamed-over file\'s new row is stored').toBe(true);
      const missing = counterOf(f.db, 'file_missing');
      fs.rmSync(f.p);
      const gone: string[] = [];
      await tick(f, f.t0 + 240_000, counting(gone));
      expect(gone, 'the stat was made').toEqual([f.p]);
      expect(counterOf(f.db, 'file_missing'), 'a vanished path is not counted').toBe(missing);
      expect((f.db.prepare('SELECT f.status AS s FROM ingest_files f JOIN file_paths p ON p.file_id = f.file_id WHERE p.path = ?').get(f.p) as { s: string }).s).toBe('live');
    } finally { f.db.close(); }
  });

  it('(h) a link at the path is not followed: nothing stored, nothing counted non_regular, but the path was stat\'ed', async () => {
    const f = await fixture('ccrc-hist-cp39d-h-');
    try {
      await tick(f, f.t0);
      const target = path.join(f.box.homes[0]!, 'elsewhere.jsonl');
      fs.writeFileSync(target, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2), ...rowsOf(700, 700)]));
      fs.rmSync(f.p);
      fs.symlinkSync(target, f.p);
      const before = counterOf(f.db, 'non_regular');
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats));
      expect(stats, 'the counting stat saw the path').toEqual([f.p]);
      expect(stored(f.db, 700), 'the link was not followed').toBe(false);
      expect(counterOf(f.db, 'non_regular'), 'the link was never offered to admission').toBe(before);
    } finally { f.db.close(); }
  });

  it('(i) a stale torn tail is not re-read every tick: the stat is made, no bind runs', async () => {
    const f = await fixture('ccrc-hist-cp39d-i-', false);
    try {
      const rows = IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2)]);
      IX.plantCopy(f.box.homes[0]!, IX.U, `${rows}{"pad":"x`);
      const old = new Date(f.t0 - lib.SCAN_INTERVAL_MS - 1_000);   // stale at the scan tick, and so at the tick after it
      fs.utimesSync(f.p, old, old);
      await tick(f, f.t0);   // the scan: the torn tail is stale, so the recorded size is the cursor
      const rec = f.db.prepare('SELECT size, offset FROM ingest_files').get() as { size: number; offset: number };
      expect(rec.size, 'CONTROL: the stale torn tail counts as read').toBe(rec.offset);
      expect(rec.size).toBeLessThan(fs.statSync(f.p).size);
      const seen = (): number => (f.db.prepare('SELECT last_seen_ms AS n FROM file_paths').get() as { n: number }).n;
      expect(seen(), 'CONTROL: the scan bound the path').toBe(f.t0);
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats));
      expect(stats, 'the stat was made').toEqual([f.p]);
      expect(seen(), 'no bind ran: last_seen_ms still reads the scan tick').toBe(f.t0);
      expect(IX.count(f.db, 'entries')).toBe(2);
    } finally { f.db.close(); }
  });

  it('(j) a spent budget ends the pass before its first stat', async () => {
    const f = await fixture('ccrc-hist-cp39d-j-');
    try {
      await tick(f, f.t0);
      append(f.p, rowsOf(500, 500));
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats), S.newBudget(Date.now, { maxBytes: 0 }));
      expect(stats).toEqual([]);
      expect(stored(f.db, 500), 'nothing was read').toBe(false);
    } finally { f.db.close(); }
  });

  it('(k) through the real sweep: a row written a minute ago, with no spool line, is stored by the next pass with a lag under ten minutes', () => {
    const box = IX.newBox('ccrc-hist-cp39d-k-');
    const p = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'one', 1), IX.user(IX.uuidN(2), IX.uuidN(1), 'two', 2)]));
    IX.sweepTwice(box);
    fs.appendFileSync(p, IX.jsonl([{ ...IX.user(IX.uuidN(900), IX.uuidN(2), 'written mid-turn', 3), timestamp: new Date(Date.now() - 60_000).toISOString() }]));
    const r = runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    const db = openStoreRO(box);
    try {
      expect(IX.count(db, 'entries', `uuid = '${IX.uuidN(900)}'`), 'the row is stored').toBe(1);
      const t = db.prepare('SELECT lag_ms FROM ticks ORDER BY tick_id DESC LIMIT 1').get() as { lag_ms: number };
      expect(t.lag_ms).toBeGreaterThan(0);
      expect(t.lag_ms).toBeLessThanOrEqual(600_000);
    } finally { db.close(); }
  }, 120_000);

  it('(l) a sidecar written mid-turn waits for its Stop hint or the scan: the transcript row is stored now, the sidecar at the next due scan', async () => {
    const f = await fixture('ccrc-hist-cp39d-l-');
    try {
      await tick(f, f.t0);
      expect(metaOf(f.db, 'scan_sidecars_ms'), 'CONTROL: the sidecar scan is not due').toBe(String(f.t0));
      const id = 'toolu_zqmid';
      append(f.p, [
        IX.assistant(IX.uuidN(600), IX.uuidN(2), [{ type: 'tool_use', id, name: 'Bash', input: { command: 'make' } }], 600),
        IX.user(IX.uuidN(601), IX.uuidN(600), [{ type: 'tool_result', tool_use_id: id, content: 'saved to: /home/u/x/tool-results/zqmid.txt' }], 601),
      ]);
      const dir = path.join(f.box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'zqmid.txt'), 'a sidecar written mid-turn\n');
      await tick(f, f.t0 + 120_000);
      expect(stored(f.db, 601), 'the tool_result row is stored').toBe(true);
      expect(IX.count(f.db, 'sidecars', "name = 'zqmid.txt'"), 'no sidecar yet').toBe(0);
      await tick(f, f.t0 + lib.SCAN_INTERVAL_MS + 1_000);
      expect(IX.count(f.db, 'sidecars', "name = 'zqmid.txt'"), 'CONTROL: the next due scan stores it').toBe(1);
    } finally { f.db.close(); }
  });

  it('(p) a hinted file is neither stat\'ed nor counted against the cap', async () => {
    const run = async (hinted: boolean): Promise<{ stats: string[]; pU: string; pV: string; f: Fx }> => {
      const f = await fixture(hinted ? 'ccrc-hist-cp39d-p1-' : 'ccrc-hist-cp39d-p0-');
      plantSession(f.box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
      const pV = IX.plantCopy(f.box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(41), null, 'second', 41)]));
      await tick(f, f.t0);
      setRecorded(f.db, f.p, 5_000_000_000_000_000_000n);
      setRecorded(f.db, pV, 4_000_000_000_000_000_000n);
      append(f.p, rowsOf(500, 500));
      append(pV, [IX.user(IX.uuidN(42), IX.uuidN(41), 'second grew', 500)]);
      const rm = hinted ? hint(f.box) : null;
      const stats: string[] = [];
      try { await tick(f, f.t0 + 120_000, counting(stats, 1)); } finally { if (rm !== null) rm(); }
      return { stats, pU: f.p, pV, f };
    };
    const h = await run(true);
    try {
      expect(h.stats, 'the hinted file is not stat\'ed and does not use the cap').toEqual([h.pV]);
      expect(stored(h.f.db, 500), 'the hint reads IX.U\'s file').toBe(true);
      expect(stored(h.f.db, 42), 'the pass reads V\'s').toBe(true);
    } finally { h.f.db.close(); }
    const c = await run(false);
    try {
      expect(c.stats[0], 'CONTROL: with no hint the first stat is IX.U\'s path').toBe(c.pU);
      expect(c.stats).toHaveLength(1);
    } finally { c.f.db.close(); }
  });

  it('(q) each uuid\'s newest copy comes first: the cap keeps IX.U\'s only copy ahead of another uuid\'s older copy', async () => {
    const f = await fixture('ccrc-hist-cp39d-q-');
    try {
      plantSession(f.box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
      const text = IX.jsonl([IX.user(IX.uuidN(41), null, 'second', 41)]);
      const vNew = IX.plantCopy(f.box.homes[0]!, IX.U2, text);
      const vOld = IX.plantCopy(f.box.homes[1]!, IX.U2, text);
      await tick(f, f.t0);
      expect(IX.count(f.db, 'ingest_files'), 'CONTROL: IX.U holds one copy and V two').toBe(3);
      setRecorded(f.db, f.p, 2_000_000_000_000_000_000n);
      setRecorded(f.db, vNew, 5_000_000_000_000_000_000n);
      setRecorded(f.db, vOld, 4_000_000_000_000_000_000n);
      append(f.p, rowsOf(500, 500));
      // CONTROL (read before the tick re-records the mtimes it examines): by recorded mtime alone the two newest rows are V's
      const byMtime = f.db.prepare("SELECT p.path AS path FROM ingest_files f JOIN file_paths p ON p.file_id = f.file_id WHERE f.status = 'live' ORDER BY f.mtime_ns DESC LIMIT 2").all() as { path: string }[];
      expect(byMtime.map((r) => r.path), 'CONTROL: ordered by recorded mtime alone the two newest rows are V\'s').toEqual([vNew, vOld]);
      const stats: string[] = [];
      await tick(f, f.t0 + 120_000, counting(stats, 2));
      expect(stats, 'V\'s newer copy and IX.U\'s path').toEqual([vNew, f.p]);
      expect(stats, 'CONTROL: V\'s older copy is not stat\'ed').not.toContain(vOld);
      expect(stored(f.db, 500), 'IX.U\'s new row is stored').toBe(true);
    } finally { f.db.close(); }
  });
});
