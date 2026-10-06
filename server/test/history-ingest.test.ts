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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, runSweep, skipOnDarwin, openStoreRO, SWEEP, type HistoryBox } from './historyHelpers.js';
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
    expect(rows()).toEqual([]);
    expect(runSweep(box).code).toBe(0);
    expect(rows()).toHaveLength(1);
  });
});
