// server/test/history-agents-ingest.test.ts — the walk's subagent arm, the first ingest and its gates (W4 addendum P6, P15 (b),
// P20; plan 2026-11-09 Task 1C). In-process, against fixture HOMEs and stores made by historyAgentFixtures.ts' rig: the scan
// tick's agent arm runs `ingestTick` exactly as the pass does, and the pass-level cases run `runDriver` on a fixture HOME.
// Linux-only, as the sweep's cases are (the arm lists real directories and plants FIFOs).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs, { constants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import {
  agentRig, agentRows, agentKeys, agentTypeOf, aliasesOf, armed, CENSUS_WALK_FIGURES, counterNames, counterOf, fileRowsOf, fixtureRows,
  holdAgainIn, LANE_ROSTER, linkOf, mainRows, membershipsPerEntry, noMarker, offsetOf, plantAgentTree, plantMarker, recordOpenFlagsAsync,
  runIdsOf, sidecarsOf, T0, transcriptRows, variantsOf, type AgentRig, type TreeSpec,
} from './historyAgentFixtures.js';
import { counters, makeHistoryBox, openStoreRO, plantSession, plantTranscript, recordOpenFlags, runCli, runDriver, runShim, skipOnDarwin, type HistoryBox } from './historyHelpers.js';
import { userRow } from './historyFixtures.js';
import { mkTmp, removeTmpFixturesSince, tmpMark } from './tmpHelpers.js';
import { agentIdOk, capBytes, historyPaths, lagOfTick, META_FAILURES, META_MAX_BYTES, parseOpVerbArgs, SCAN_INTERVAL_MS, WRITING_FORMS } from '../../ccd/history/lib.mjs';
import { closeWriter, createStore, getMeta } from '../../ccd/history/store.mjs';
import { behindStats, candidateFiles, discoverTranscripts, ingestTick, makeIngestCtx, newBudget, readAgentMeta } from '../../ccd/history/sweep.mjs';

skipOnDarwin();

const RUN = 'wf_0123abcd-0a1';
const RUN_A = 'wf_0123abcd-0a1';
const RUN_B = 'wf_89abcdef-1b2';
const SLUG = '-home-u-tree';
const uuidOf = (n: number): string => `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PARENT = uuidOf(1);

const rigs: AgentRig[] = [];
const rigOf = async (prefix: string): Promise<AgentRig> => { const r = await agentRig(prefix); rigs.push(r); return r; };
afterEach(() => { for (const r of rigs.splice(0)) { try { closeWriter(r.db); } catch { /* already closed */ } } });

/** One agent with `n` rows, its message uuids under `tag`, so no two agents share an entry uuid. */
const agent = (id: string, tag: number, extra: { n?: number; atMs?: number; meta?: TreeSpec['agents'][number]['meta'] } = {}): TreeSpec['agents'][number] =>
  ({ id, rows: fixtureRows(tag, extra.n ?? 2), ...(extra.atMs === undefined ? {} : { atMs: extra.atMs }), ...(extra.meta === undefined ? {} : { meta: extra.meta }) });
const SINCE = { sinceMs: T0 };

describe('the scan tick\'s subagent arm and its arming marker (P15 (b), SA22)', () => {
  it('SA22 ingest arming (P15 (b)): no marker, no subagent file read and no subagent row', async () => {
    const rig = await rigOf('ccrc-hist-sa22-');
    const { box, db, tick } = rig;
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x100)] }, SINCE);
    await tick(noMarker, { scan: true });
    expect(agentRows(db)).toBe(0);
    const baseline = mainRows(db);
    // the parent's own two rows, stated outright: subagent entries wrongly attached to the main transcript would change this count
    expect(baseline, 'CONTROL: the parent\'s main transcript was ingested, so the scan did run').toEqual([{ uuid: PARENT, entries: 2 }]);
    plantMarker(box, 'link'); await tick(null, { scan: true }); expect(agentRows(db), 'a link is not armed').toBe(0);
    plantMarker(box, 'dir'); await tick(null, { scan: true }); expect(agentRows(db), 'a directory is not armed').toBe(0);
    plantMarker(box, 'file'); await tick(null, { scan: true }); expect(agentRows(db), 'CONTROL: a regular file arms it').toBe(1);
    expect(mainRows(db), 'main capture is unchanged').toEqual([{ uuid: PARENT, entries: 2 }]);
  });

  it('SA1 journal excluded: one row, and the journal never opened', async () => {
    const rig = await rigOf('ccrc-hist-sa1-');
    const { db, tick } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [], runs: [{ id: RUN, agents: [agent('a', 0x200)], journal: 'file' }] }, SINCE);
    const journalPath = path.join(path.dirname(paths[`${RUN}/a`]!), 'journal.jsonl');
    expect(fs.existsSync(journalPath), 'CONTROL: the journal is a regular file of valid JSON rows').toBe(true);
    const { opens } = await recordOpenFlagsAsync(() => tick(armed, { scan: true }));
    expect(agentKeys(db)).toEqual([`${RUN}/a`]);
    // the addendum's SA1 row and failure row 14, kept (review 1735 F4): the agent file is opened, the journal never
    expect(opens.map((o) => o.path)).toContain(paths[`${RUN}/a`]);
    expect(opens.map((o) => o.path)).not.toContain(journalPath);
  });

  it('SA3 workflow identity: two runs, one agent id, two rows', async () => {
    const rig = await rigOf('ccrc-hist-sa3-');
    const { db, tick } = rig;
    plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, agents: [],
      runs: [{ id: RUN_A, agents: [agent('x', 0x300)] }, { id: RUN_B, agents: [agent('x', 0x301)] }],
    }, SINCE);
    await tick(armed, { scan: true });
    expect(agentKeys(db)).toEqual([`${RUN_A}/x`, `${RUN_B}/x`]);
    expect(runIdsOf(db)).toEqual([RUN_A, RUN_B]);
  });

  it('an Agent-tool subagent\'s row is keyed by its bare id and carries no run id', async () => {
    const rig = await rigOf('ccrc-hist-id-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x400), agent('b', 0x401)] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db)).toEqual(['a', 'b']);
    expect(runIdsOf(rig.db)).toEqual([]);
  });

  it('a candidate that is no transcript is refused and nothing is counted at a tick (D-8154): a bad run id, a bad name, a link', async () => {
    const rig = await rigOf('ccrc-hist-refuse-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('ok', 0x500)], runs: [{ id: 'wf_bad', agents: [agent('x', 0x501)] }] }, SINCE);
    const sub = path.dirname(paths['ok']!);
    fs.writeFileSync(path.join(sub, 'agent-a.b.jsonl'), '{}\n');
    fs.symlinkSync(paths['ok']!, path.join(sub, 'agent-linked.jsonl'));
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db)).toEqual(['ok']);
    expect(counterNames(rig.db).filter((n) => CENSUS_WALK_FIGURES.some((f) => n.startsWith(f)))).toEqual([]);
  });

  it('an mtime equal to the install record is post-install (Review Focus 1)', async () => {
    const rig = await rigOf('ccrc-hist-eq-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x600, { atMs: 0 })] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db)).toBe(1);
  });

  it('a file older than the install record is not ingested by a tick (P6; SA12 and SA18 pin the rest)', async () => {
    const rig = await rigOf('ccrc-hist-pre-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('old', 0x610, { atMs: -1 }), agent('new', 0x611, { atMs: 1 })] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db)).toEqual(['new']);
  });

  it('the first W4 tick writes agents_since_ms, armed or not, and no later tick moves it (P6)', async () => {
    const rig = await rigOf('ccrc-hist-rec-');
    const { db, tick } = rig;
    await tick(noMarker, { nowMs: T0 }); expect(getMeta(db, 'agents_since_ms')).toBe(String(T0));
    await tick(armed, { nowMs: T0 + 3_600_000, scan: true }); expect(getMeta(db, 'agents_since_ms')).toBe(String(T0));
  });

  it.each(['abc', '', ' ', '  ', '-5', '1e3', '12.5'])('a damaged install record %j reads as pre-install: nothing is ingested, and the record is not rewritten', async (damaged) => {
    const rig = await rigOf('ccrc-hist-damaged-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x650)] }, SINCE);
    rig.db.prepare('UPDATE meta SET v = ? WHERE k = ?').run(damaged, 'agents_since_ms');
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db)).toBe(0);
    expect(getMeta(rig.db, 'agents_since_ms')).toBe(damaged);
  });

  it('a walk cut inside subagents/ resumes and counts nothing unentered (Review Focus 2)', async () => {
    const rig = await rigOf('ccrc-hist-cut-');
    const { db, tick } = rig;
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => agent(id, 0x700 + i)) }, SINCE);
    await tick(armed, { scan: true, agentStop: (taken) => taken >= 2 });
    expect(agentRows(db)).toBe(2);                        // the two handed over before the cut, read under an unspent budget
    expect(getMeta(db, 'scan_discover_ms')).toBeNull();   // a cut walk leaves the scan unmarked
    await tick(armed);                                    // so the store's own clock makes this tick a scan again
    expect(agentRows(db)).toBe(5);
    // no walk figure at a tick: those are the census's (build question history-w4-refusals-counted-by-census). Task 1D's
    // agent_meta_unreadable:absent for these meta-less files is a bind count, not one of them, so it is not filtered in
    expect(counterNames(db).filter((n) => CENSUS_WALK_FIGURES.some((f) => n.startsWith(f)))).toEqual([]);
  });
});

describe('what reads a stored short subagent row, and what it holds back (review 1728 F1, review 1735 F2)', () => {
  /** An armed scan tick stores parent and agent a whole; then `rows` more are appended to a and the store's size for it is set to
   *  the file's new size with its offset unchanged: the state a budget-cut read leaves. */
  const shortAgent = async (prefix: string): Promise<{ rig: AgentRig; aPath: string; at: number }> => {
    const rig = await rigOf(prefix);
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x800)] }, SINCE);
    const aPath = paths['a']!;
    await rig.tick(armed, { scan: true });
    expect(offsetOf(rig.db, aPath), 'CONTROL: set-up stored a whole').toBe(fs.statSync(aPath).size);
    fs.appendFileSync(aPath, fixtureRows(0x801, 3).map((r) => `${JSON.stringify(r)}\n`).join(''));
    rig.db.prepare('UPDATE ingest_files SET size = ? WHERE file_id = (SELECT file_id FROM file_paths WHERE path = ?)').run(fs.statSync(aPath).size, aPath);
    return { rig, aPath, at: offsetOf(rig.db, aPath) };
  };

  it('a stored short subagent row is read only through a gated arm (review 1728, F1)', async () => {
    const { rig, aPath, at } = await shortAgent('ccrc-hist-f1-');
    const { db, box, tick } = rig;
    expect(at, 'CONTROL: the row is short').toBeLessThan(fs.statSync(aPath).size);
    await tick(noMarker, { scan: false }); await tick(noMarker, { scan: true });
    expect(offsetOf(db, aPath)).toBe(at);                // disarmed: not read, behindFiles hands main rows only
    expect(behindStats(db, box.homes).files).toBe(0);    // and the lag does not count it
    await tick(armed, { scan: false });                  // armed, but its parent is not active: it waits for the scan tick
    expect(offsetOf(db, aPath)).toBe(at);
    // the paused row (W4 P5): armed, a scan tick, the store at 90% of the cap: the agent arm withholds it, cursor unmoved, counted once
    await tick(armed, { scan: true, storeAt: 0.9 });
    expect(offsetOf(db, aPath), 'paused at 90%: the short row stays short').toBe(at);
    expect(counterOf(db, 'capture_paused_agents_at_cap')).toBe(1);
    await tick(armed, { scan: true });                   // the scan tick's agent arm reads it, under its own key
    expect(offsetOf(db, aPath)).toBe(fs.statSync(aPath).size);
    expect(agentKeys(db)).toEqual(['a']);
  });

  it('a stored short subagent row holds none of its parent\'s sidecars back (review 1735, F2)', async () => {
    const rig = await rigOf('ccrc-hist-f2-');
    const { db, box, tick } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x810)] }, SINCE);
    const aPath = paths['a']!;
    // 1. set-up: an armed scan tick stores the parent's main transcript whole and agent file a whole. The parent has no sidecar
    //    yet, so this tick's sidecar half, due on a fresh store, stores none and sets scan_sidecars_ms.
    await tick(armed, { scan: true });
    expect(sidecarsOf(db, PARENT)).toBe(0);
    // 2. agent file a grows by three rows, and the fixture sets its ingest_files.size to the new size, offset unchanged: its row is
    //    short. Then one sidecar file is planted in the parent's session directory.
    fs.appendFileSync(aPath, fixtureRows(0x811, 3).map((r) => `${JSON.stringify(r)}\n`).join(''));
    db.prepare('UPDATE ingest_files SET size = ? WHERE file_id = (SELECT file_id FROM file_paths WHERE path = ?)').run(fs.statSync(aPath).size, aPath);
    const at = offsetOf(db, aPath);
    const results = path.join(box.homes[0]!, 'projects', SLUG, PARENT, 'tool-results');
    fs.mkdirSync(results, { recursive: true });
    fs.writeFileSync(path.join(results, 'note.txt'), 'a sidecar of the parent\n');
    // 3. the asserted tick: disarmed, not a transcript scan, and a sidecar scan forced. The parent is neither hinted nor behind, so
    //    only the sidecar scan's every-known-uuid share reaches it.
    await tick(noMarker, { scan: false, sideScan: true });
    // Correct code: notCaughtUp(parent) sees main rows only, finds the main row whole, and the sidecar is stored: 1.
    // Mutant (n), the filter dropped: notCaughtUp finds agent a's short row under the parent's uuid and withholds the parent's
    // sidecars: 0.
    expect(sidecarsOf(db, PARENT)).toBe(1);
    expect(offsetOf(db, aPath)).toBe(at);                // and the subagent row is still short, unread while disarmed
  });
});

describe('a subagent file feeds none of the main lag series (final review I1)', () => {
  type Ing = { newEntries: number; minNewTsMs: number | null; bytes: number };
  const lagOf = (ing: Ing): number | null => lagOfTick({ tickStartMs: Date.UTC(2026, 10, 1, 12, 0, 0), newEntries: ing.newEntries, minNewTsMs: ing.minNewTsMs });
  const rowAt = (tag: number, ts: string): object => userRow({ uuid: `00000000-${tag.toString(16).padStart(4, '0')}-4000-8000-000000000001`, ts, sessionId: PARENT, text: `lag ${tag}` });

  it('an armed tick whose only new rows are a subagent file\'s (a first read, then a stale file\'s growth) leaves the lag at 0, as a main-only tick would', async () => {
    const rig = await rigOf('ccrc-hist-i1-');
    const { db, tick } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xe00)] }, SINCE);
    await tick(noMarker, { scan: true });                        // the parent is stored; the disarmed node reads no subagent file
    expect(agentRows(db), 'CONTROL: set-up stored no subagent row').toBe(0);
    // 1. the subagent file's first read: new rows, none of them main's
    let ing = (await tick(armed, { scan: true })) as Ing;
    expect(agentKeys(db), 'CONTROL: the armed scan tick read the agent file').toEqual(['a']);
    expect(ing.bytes, 'CONTROL: the tick read bytes').toBeGreaterThan(0);
    expect([ing.newEntries, ing.minNewTsMs], 'a subagent\'s first read is no main entry').toEqual([0, null]);
    expect(lagOf(ing)).toBe(0);
    // 2. the stale file grows; the next scan tick (up to SCAN_INTERVAL_MS later) resumes it
    grow(paths['a']!, 0xe01, T0 + 400_000, 3);
    ing = (await tick(armed, { scan: true })) as Ing;
    expect(offsetOf(db, paths['a']!), 'CONTROL: the growth was read').toBe(fs.statSync(paths['a']!).size);
    expect([ing.newEntries, ing.minNewTsMs]).toEqual([0, null]);
    expect(lagOf(ing)).toBe(0);
  });

  it('a main file\'s lag is unchanged beside a subagent file\'s: only the main entries are counted, and the main rows\' own time is the minimum', async () => {
    const rig = await rigOf('ccrc-hist-i1b-');
    const { tick } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xe10)] }, SINCE);
    await tick(armed, { scan: true });
    // the subagent file grows by rows older than the main file's new row, so a min over both would be the subagent's
    grow(paths['a']!, 0xe11, T0 + 400_000, 2);
    fs.appendFileSync(mainPathOf(rig, PARENT), `${JSON.stringify(rowAt(0xe12, '2026-11-01T10:05:00.000Z'))}\n`);
    fs.utimesSync(mainPathOf(rig, PARENT), new Date(T0 + 400_000), new Date(T0 + 400_000));
    const ing = (await tick(armed, { scan: true })) as Ing;
    expect(ing.newEntries, 'one main entry; the subagent file\'s two are not counted').toBe(1);
    expect(ing.minNewTsMs).toBe(Date.UTC(2026, 10, 1, 10, 5, 0));
    expect(lagOf(ing)).toBe(Date.UTC(2026, 10, 1, 12, 0, 0) - Date.UTC(2026, 10, 1, 10, 5, 0));
  });
});

describe('a stored short subagent row under the 90% pause holds none of its parent\'s sidecars back (review 1735, F2; W4 P5)', () => {
  it('the paused twin: armed, a sidecar scan, the store at 90%: the sidecar is stored and the agent offset stays at `at`', async () => {
    const rig = await rigOf('ccrc-hist-f2p-');
    const { db, box, tick } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x820)] }, SINCE);
    const aPath = paths['a']!;
    await tick(armed, { scan: true });                   // the same set-up tick: parent and agent a whole, no sidecar yet
    expect(sidecarsOf(db, PARENT)).toBe(0);
    fs.appendFileSync(aPath, fixtureRows(0x821, 3).map((r) => `${JSON.stringify(r)}\n`).join(''));
    db.prepare('UPDATE ingest_files SET size = ? WHERE file_id = (SELECT file_id FROM file_paths WHERE path = ?)').run(fs.statSync(aPath).size, aPath);
    const at = offsetOf(db, aPath);                      // captured AFTER agent a grows (review 1735 F2's correction)
    const results = path.join(box.homes[0]!, 'projects', SLUG, PARENT, 'tool-results');
    fs.mkdirSync(results, { recursive: true });
    fs.writeFileSync(path.join(results, 'note.txt'), 'a sidecar of the parent\n');
    await tick(armed, { scan: true, sideScan: true, storeAt: 0.9 });
    expect(sidecarsOf(db, PARENT), 'main capture, sidecars included, does not wait on a paused subagent row').toBe(1);
    expect(offsetOf(db, aPath)).toBe(at);
  });
});

describe('what the agent arm does not enter, and which parents it serves', () => {
  it('no subagents/ and no projects root add nothing (failure rows 1 and 2)', async () => {
    const rig = await rigOf('ccrc-hist-none-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [] }, SINCE);
    fs.rmSync(path.join(rig.box.homes[0]!, 'projects', SLUG, PARENT), { recursive: true, force: true });
    fs.rmSync(path.join(rig.box.homes[1]!, 'projects'), { recursive: true, force: true });
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db)).toBe(0);
    expect(mainRows(rig.db)).toHaveLength(1);
    expect(counterNames(rig.db).filter((n) => CENSUS_WALK_FIGURES.some((f) => n.startsWith(f)))).toEqual([]);
  });

  it('a linked project directory keeps its main transcript, and its subagent files are never entered through it (failure table: a link is never followed)', async () => {
    const rig = await rigOf('ccrc-hist-linkedproj-');
    plantAgentTree(rig, { slug: '-real', uuid: PARENT, agents: [agent('a', 0x910)] }, SINCE);
    const projects = path.join(rig.box.homes[0]!, 'projects');
    fs.symlinkSync('-real', path.join(projects, '-linked'));
    await rig.tick(armed, { scan: true });
    const via = (like: string): number =>
      (rig.db.prepare('SELECT count(*) AS n FROM file_paths WHERE path LIKE ?').get(like) as { n: number }).n;
    expect(via('%/-linked/%.jsonl'), 'main discovery lists through a linked project directory, as it always did').toBeGreaterThan(0);
    expect(via('%/-real/%/subagents/%'), 'CONTROL: the subagent file was read through the real directory').toBe(1);
    expect(via('%/-linked/%/subagents/%'), 'and never through the link').toBe(0);
  });

  it('a subagent file that fails admission leaves its parent out of skipped; a main copy that fails puts it in (D-5061)', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();   // root opens a mode-000 file regardless
    const failing = async (which: 'agent' | 'main'): Promise<ReadonlySet<string>> => {
      const rig = await rigOf(`ccrc-hist-skipped-${which}-`);
      const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x920)] }, SINCE);
      const victim = which === 'agent' ? paths['a']! : path.join(rig.box.homes[0]!, 'projects', SLUG, `${PARENT}.jsonl`);
      fs.chmodSync(victim, 0o000);
      try {
        return ((await rig.tick(armed, { scan: true })) as { skipped: ReadonlySet<string> }).skipped;
      } finally { fs.chmodSync(victim, 0o600); }
    };
    expect([...(await failing('main'))], 'CONTROL: an unreadable main copy withdraws the parent\'s predictions').toEqual([PARENT]);
    expect([...(await failing('agent'))], 'an unreadable subagent file does not').toEqual([]);
  });

  it('history-off reads no subagent file (failure row 26)', async () => {
    const rig = await rigOf('ccrc-hist-off-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x900)] }, SINCE);
    fs.writeFileSync(historyPaths(rig.box.home).off, '');
    const { opens } = await recordOpenFlagsAsync(() => rig.tick(armed, { scan: true }));
    expect(agentRows(rig.db)).toBe(0);
    expect(opens.map((o) => o.path)).not.toContain(paths['a']);
    fs.rmSync(historyPaths(rig.box.home).off);
    await rig.tick(null, { scan: true });
    expect(agentRows(rig.db), 'CONTROL: history on, the same tree is ingested').toBe(1);
  });

  it('a subagent of a session the main arm does not ingest is not ingested', async () => {
    const rig = await rigOf('ccrc-hist-unknown-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xa00)], parent: 'unknown' }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db)).toBe(0);
    expect(mainRows(rig.db)).toEqual([]);
  });

  it('a parent known only by a $REG compactions line is not known to the tick (the one admitted set)', async () => {
    const rig = await rigOf('ccrc-hist-compactions-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xa10)], parent: 'compactions' }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db)).toBe(0);
  });

  it('a parent known by a confirmed epoch is known to the tick', async () => {
    const rig = await rigOf('ccrc-hist-epoch-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xa20)], parent: 'epoch' }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db)).toEqual(['a']);
  });

  it('only the scan tick\'s known-uuid walk enters the agent arm: a non-scan tick reads none, and the unfiltered walk is main only', async () => {
    const rig = await rigOf('ccrc-hist-scanonly-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xb00)] }, SINCE);
    await rig.tick(armed, { scan: false });
    expect(agentRows(rig.db)).toBe(0);
    // indexedTranscripts and the hinted walk pass no agent sink: discoverTranscripts without one lists main transcripts alone
    const found = discoverTranscripts(rig.box.homes, [PARENT]) as Array<{ path: string }>;
    expect(found.map((f) => path.basename(f.path))).toEqual([`${PARENT}.jsonl`]);
  });

  it('a hinted non-scan tick does not enter the agent arm (review 1731, F5)', async () => {
    const rig = await rigOf('ccrc-hist-hinted-');
    const { parentId } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xc00)] }, SINCE);
    await rig.tick(armed, { scan: false, hint: parentId! });   // discover(hinted) walks: the hinted set holds the parent's uuid
    expect(agentRows(rig.db)).toBe(0);
    expect(mainRows(rig.db), 'CONTROL: the hinted walk did read the parent').toHaveLength(1);
  });

  it('a subagent\'s first row never writes its parent epoch\'s launch facts', async () => {
    const rig = await rigOf('ccrc-hist-facts-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xd00)], parent: 'epoch', main: false }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db), 'CONTROL: the agent file was read').toEqual(['a']);
    expect(rig.db.prepare('SELECT started_ms AS s, cwd, git_branch AS b FROM epochs WHERE cc_session_uuid = ?').get(PARENT)).toEqual({ s: null, cwd: null, b: null });
  });
});

/** The result of one `candidateFiles` call over the rig's store, as a non-scan tick makes it: the paths it would read, in order, every
 *  path its between-scans pass stated, and what the subagent row query did (`queries` runs, `rows` handed back by each). `max` is
 *  ctx.activeStatMax (the per-tick stat cap). */
function probeActive(rig: AgentRig, o: { max?: number; armedMarker?: boolean } = {}): { read: string[]; stats: string[]; queries: number; rows: number[]; offProbes: number } {
  const ctx = makeIngestCtx(rig.box.home, rig.box.homes, T0 + 3_600_000, null) as Record<string, unknown>;
  const real = ctx['activeStat'] as (p: string) => unknown;
  const stats: string[] = [];
  ctx['activeStat'] = (p: string): unknown => { stats.push(p); return real(p); };
  if (o.max !== undefined) ctx['activeStatMax'] = o.max;
  // the history-off probe (an existsSync a tick makes), counted: an unarmed node's active arm must not make it (final review M1)
  const realOff = ctx['historyOff'] as () => boolean;
  let offProbes = 0;
  ctx['historyOff'] = (): boolean => { offProbes += 1; return realOff(); };
  const rows: number[] = [];
  // the db behind a proxy that watches the one statement whose text filters subagent rows (`t.agent_id <> ''`)
  const spy = new Proxy(rig.db, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      if (prop !== 'prepare') return (v as (...a: unknown[]) => unknown).bind(target);
      return (sql: string) => {
        const st = (v as (q: string) => object).call(target, sql);
        if (!sql.includes("t.agent_id <> ''")) return st;
        return new Proxy(st, {
          get(t, p) {
            const m = Reflect.get(t, p, t) as unknown;
            if (typeof m !== 'function') return m;
            return (...a: unknown[]) => {
              const out = (m as (...x: unknown[]) => unknown).apply(t, a);
              if (p === 'all') rows.push((out as unknown[]).length);
              return out;
            };
          },
        });
      };
    },
  }) as typeof rig.db;
  const r = candidateFiles(spy, ctx, false, false, null, o.armedMarker ?? true) as { files: Array<{ path: string }> };
  return { read: r.files.map((f) => f.path), stats, queries: rows.length, rows, offProbes };
}
/** Appends `n` rows (message uuids under `tag`) to a stored file and stamps its mtime at `atMs`, so the next stat reads as changed. */
function grow(p: string, tag: number, atMs: number, n = 1): void {
  fs.appendFileSync(p, fixtureRows(tag, n).map((r) => `${JSON.stringify(r)}\n`).join(''));
  fs.utimesSync(p, new Date(atMs), new Date(atMs));
}
const mainPathOf = (rig: AgentRig, uuid: string): string => path.join(rig.box.homes[0]!, 'projects', SLUG, `${uuid}.jsonl`);

describe('the read cadence (W4 addendum P3, SA10)', () => {
  it('SA10 read cadence (P3): an inactive parent\'s subagents are not stated; an active parent\'s are, inside the per-tick cap, after the main files', async () => {
    const rig = await rigOf('ccrc-hist-sa10-');
    const { db, tick } = rig;
    const p1 = plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(1), agents: [agent('a1', 0x900)] }, SINCE);
    const p2 = plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(2), agents: [agent('a2', 0x910)] }, SINCE);
    await tick(armed, { scan: true });
    expect(agentRows(db), 'CONTROL: set-up stored both subagents').toBe(2);
    const [a1, a2, m1, m2] = [p1.paths['a1']!, p2.paths['a2']!, mainPathOf(rig, uuidOf(1)), mainPathOf(rig, uuidOf(2))];
    const statsOf = (r: { stats: string[] }, ...paths: string[]): number => r.stats.filter((x) => paths.includes(x)).length;
    // 1. a non-scan tick, no parent active: the main files are stated (CONTROL), no subagent file is
    let r = probeActive(rig);
    expect(statsOf(r, m1, m2), 'CONTROL: the main files were stated').toBe(2);
    expect(statsOf(r, a1, a2)).toBe(0);
    // 2. the subagent files themselves changed, their parents' did not: still not stated, not read
    grow(a1, 0x901, T0 + 300_000); grow(a2, 0x911, T0 + 300_000);
    r = probeActive(rig);
    expect(statsOf(r, a1, a2), 'an inactive parent: no subagent stat').toBe(0);
    expect(r.read).toEqual([]);
    // 3. parent 1 active: its stored subagent file is stated once, inside ACTIVE_STAT_MAX, and read after the main file; parent 2's is not
    grow(m1, 0x9a1, T0 + 300_000);
    r = probeActive(rig);
    expect(statsOf(r, a1), 'an active parent: its subagent file is stated').toBe(1);
    expect(statsOf(r, a2)).toBe(0);
    expect(r.read).toEqual([m1, a1]);
    // 4. the cap filled by main files: both parents active, a cap of two stats: the main files take it, the subagent files wait
    grow(m2, 0x9a2, T0 + 300_000);
    r = probeActive(rig, { max: 2 });
    expect([...r.read].sort(), 'the cap is filled by the main files').toEqual([m1, m2].sort());
    expect(statsOf(r, a1, a2), 'the subagent files wait for a later tick').toBe(0);
    // 5. CONTROL: with room, the same state reads all four, the main files first (main files take precedence)
    r = probeActive(rig, { max: 4 });
    expect(r.read.slice(0, 2).sort()).toEqual([m1, m2].sort());
    expect(r.read.slice(2).sort()).toEqual([a1, a2].sort());
    // 6. and one stat of room beyond the main files reads exactly one of them
    r = probeActive(rig, { max: 3 });
    expect(r.read).toHaveLength(3);
    expect(statsOf(r, a1, a2)).toBe(1);
    // 7. the marker reaches this arm, and nothing about subagents happens on an unarmed node: no row query, no stat, no read
    r = probeActive(rig, { max: 4, armedMarker: false });
    expect([...r.read].sort()).toEqual([m1, m2].sort());
    expect(r.queries, 'an unarmed node runs no subagent row query').toBe(0);
    expect(statsOf(r, a1, a2), 'an unarmed node stats no subagent file').toBe(0);
    expect(probeActive(rig, { max: 4 }).queries, 'CONTROL: armed, the query runs once').toBe(1);
    // M1 (final review): the unarmed node pays no history-off probe in the active agent arm; armed, the gate asks it once
    expect(r.offProbes, 'an unarmed node does not probe history-off for the subagent arm').toBe(0);
    expect(probeActive(rig, { max: 4 }).offProbes, 'CONTROL: armed, the probe runs once').toBe(1);
    // 8. the query is bounded by the room the main files leave: a cap of two stats and two active parents leave none, and one stat
    //    of room beyond the main files hands back at most one row
    expect(probeActive(rig, { max: 2 }).queries, 'no room: no query').toBe(0);
    expect(probeActive(rig, { max: 3 }).rows, 'room for one file: one row').toEqual([1]);
  });

  it('SA10 end to end: a non-scan tick reads an active parent\'s grown subagent file, not an inactive parent\'s, not a disarmed one, and not one with no row', async () => {
    const rig = await rigOf('ccrc-hist-sa10e-');
    const { db, tick } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xa00)] }, SINCE);
    const [aPath, mPath] = [paths['a']!, mainPathOf(rig, PARENT)];
    await tick(armed, { scan: true });
    const sizeOf = (p: string): number => fs.statSync(p).size;
    expect(offsetOf(db, aPath), 'CONTROL: set-up stored a whole').toBe(sizeOf(aPath));
    const stored = offsetOf(db, aPath);
    // the subagent file grows alone: its parent is inactive, so a non-scan tick leaves it
    grow(aPath, 0xa01, T0 + 400_000);
    await tick(armed, { scan: false });
    expect(offsetOf(db, aPath)).toBe(stored);
    // the parent grows too: the parent is active, and the subagent file is read in the same tick
    grow(mPath, 0xa02, T0 + 400_000);
    await tick(armed, { scan: false });
    expect(offsetOf(db, aPath), 'read by the active parent\'s pass').toBe(sizeOf(aPath));
    expect(offsetOf(db, mPath)).toBe(sizeOf(mPath));
    // a subagent file with no row waits for a scan tick, even under an active parent
    const b = path.join(path.dirname(aPath), 'agent-b.jsonl');
    fs.writeFileSync(b, fixtureRows(0xa10, 2).map((x) => `${JSON.stringify(x)}\n`).join(''));
    fs.utimesSync(b, new Date(T0 + 400_000), new Date(T0 + 400_000));
    grow(mPath, 0xa03, T0 + 500_000);
    await tick(armed, { scan: false });
    expect(agentKeys(db), 'no row, no active read').toEqual(['a']);
    await tick(armed, { scan: true });
    expect(agentKeys(db)).toEqual(['a', 'b']);
    // disarmed: the parent is read, the subagent file is not, though its parent is active
    grow(aPath, 0xa04, T0 + 600_000); grow(mPath, 0xa05, T0 + 600_000);
    const before = offsetOf(db, aPath);
    await tick(noMarker, { scan: false });
    expect(offsetOf(db, mPath)).toBe(sizeOf(mPath));
    expect(offsetOf(db, aPath), 'the marker reaches the active pass').toBe(before);
  });
});

describe('main files take precedence under a spent budget (W4 addendum P3, SA10\'s CONTROL)', () => {
  it('a budget that reads one file reads the main file, and the active subagent file waits: a mutant that reads subagent files first leaves the main file unread', async () => {
    const rig = await rigOf('ccrc-hist-sa10c-');
    const { db } = rig;
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xa50)] }, SINCE);
    const [aPath, mPath] = [paths['a']!, mainPathOf(rig, PARENT)];
    await rig.tick(armed, { scan: true });
    const [aStored, mStored] = [offsetOf(db, aPath), offsetOf(db, mPath)];
    grow(aPath, 0xa51, T0 + 400_000, 2); grow(mPath, 0xa52, T0 + 400_000, 2);
    // ingestTick as the pass runs it, on a context with no ids (the tick's journal half is not under test), not a scan, and a budget that
    // is spent after one file: maxBytes 1
    const ctx = makeIngestCtx(rig.box.home, rig.box.homes, T0 + 120_000, null) as Record<string, unknown>;
    await ingestTick(db, ctx, newBudget(undefined, { maxBytes: 1 }));
    expect(offsetOf(db, mPath), 'the main file was read').toBeGreaterThan(mStored);
    expect(offsetOf(db, aPath), 'the subagent file waits for a later tick').toBe(aStored);
  });
});

describe('the pause order (W4 addendum P5, SA11)', () => {
  /** A rig with a known parent and `ids` subagent files, post-install unless `atMs` says otherwise. */
  const paused = async (prefix: string, ids: string[], o: { atMs?: number } = {}): Promise<AgentRig> => {
    const rig = await rigOf(prefix);
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: ids.map((id, i) => agent(id, 0xb00 + i * 16, o.atMs === undefined ? {} : { atMs: o.atMs })) }, SINCE);
    return rig;
  };

  it('a scan tick at 90% of the cap ingests the main transcript and no subagent file, and counts the tick once', async () => {
    const rig = await paused('ccrc-hist-p90-', ['a', 'b']);
    await rig.tick(armed, { scan: true, storeAt: 0.9 });
    expect(mainRows(rig.db), 'main capture continues').toEqual([{ uuid: PARENT, entries: 2 }]);
    expect(agentRows(rig.db), 'no subagent file is bound').toBe(0);
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap'), 'two files withheld, one count').toBe(1);
    await rig.tick(null, { scan: true, storeAt: 0.9 });
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap'), 'once per tick').toBe(2);
    await rig.tick(null, { scan: true, storeAt: 0.89 });
    expect(agentRows(rig.db), 'CONTROL: under 90% both are read').toBe(2);
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap')).toBe(2);
  });

  it('an unarmed node, or a file the pause is not the reason for, counts nothing', async () => {
    const rig = await paused('ccrc-hist-p90-un-', ['a']);
    await rig.tick(noMarker, { scan: true, storeAt: 0.9 });
    expect(counterNames(rig.db)).not.toContain('capture_paused_agents_at_cap');   // unarmed: nothing is paused
    const old = await paused('ccrc-hist-p90-old-', ['a'], { atMs: -60_000 });
    await old.tick(armed, { scan: true, storeAt: 0.9 });
    expect(counterNames(old.db), 'a pre-install file would not be read anyway').not.toContain('capture_paused_agents_at_cap');
  });

  it('a subagent file with nothing to read is not counted as withheld (item 3): fully read at 90%, scan or active pass, bumps nothing; one with bytes bumps once', async () => {
    const rig = await rigOf('ccrc-hist-p90-eof-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xb90)] }, SINCE);
    const [aPath, mPath] = [paths['a']!, mainPathOf(rig, PARENT)];
    await rig.tick(armed, { scan: true });
    expect(offsetOf(rig.db, aPath), 'CONTROL: stored whole').toBe(fs.statSync(aPath).size);
    await rig.tick(armed, { scan: true, storeAt: 0.9 });
    expect(counterNames(rig.db), 'a scan tick at 90% over a fully read file').not.toContain('capture_paused_agents_at_cap');
    // the active pass: the parent grows, the subagent file is only touched (its mtime moves, its size does not)
    grow(mPath, 0xb91, T0 + 400_000);
    fs.utimesSync(aPath, new Date(T0 + 400_000), new Date(T0 + 400_000));
    await rig.tick(armed, { scan: false, storeAt: 0.9 });
    expect(counterNames(rig.db), 'a touched but fully read file in the active pass').not.toContain('capture_paused_agents_at_cap');
    // CONTROL: bytes to read, in each arm
    grow(aPath, 0xb92, T0 + 500_000);
    await rig.tick(armed, { scan: true, storeAt: 0.9 });
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap'), 'scan arm, bytes waiting').toBe(1);
    grow(mPath, 0xb93, T0 + 600_000); grow(aPath, 0xb94, T0 + 600_000);
    await rig.tick(armed, { scan: false, storeAt: 0.9 });
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap'), 'active arm, bytes waiting').toBe(2);
  });

  it('a scan tick at 90% counts an unstored EMPTY subagent file as nothing withheld, and an unstored non-empty one once: the forecast\'s rule (final review M2)', async () => {
    const rig = await rigOf('ccrc-hist-p90-empty-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('e', 0xb95, { n: 0 })] }, SINCE);
    expect(fs.statSync(paths['e']!).size, 'CONTROL: the file is empty').toBe(0);
    await rig.tick(armed, { scan: true, storeAt: 0.9 });
    expect(counterNames(rig.db), 'an unstored empty file has nothing to read').not.toContain('capture_paused_agents_at_cap');
    const g = path.join(path.dirname(paths['e']!), 'agent-g.jsonl');
    fs.writeFileSync(g, fixtureRows(0xb96, 2).map((r) => `${JSON.stringify(r)}\n`).join(''));
    fs.utimesSync(g, new Date(T0 + 300_000), new Date(T0 + 300_000));
    await rig.tick(armed, { scan: true, storeAt: 0.9 });
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap'), 'CONTROL: an unstored file with bytes is counted, once for the tick').toBe(1);
    expect(agentRows(rig.db), 'and the pause read neither').toBe(0);
  });

  it('the active pass is paused too: an active parent\'s grown subagent file is withheld at 90%, its parent is read', async () => {
    const rig = await rigOf('ccrc-hist-p90-act-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0xc00)] }, SINCE);
    const [aPath, mPath] = [paths['a']!, mainPathOf(rig, PARENT)];
    await rig.tick(armed, { scan: true });
    const before = offsetOf(rig.db, aPath);
    grow(aPath, 0xc01, T0 + 400_000); grow(mPath, 0xc02, T0 + 400_000);
    await rig.tick(armed, { scan: false, storeAt: 0.9 });
    expect(offsetOf(rig.db, mPath), 'main capture continues').toBe(fs.statSync(mPath).size);
    expect(offsetOf(rig.db, aPath)).toBe(before);
    expect(counterOf(rig.db, 'capture_paused_agents_at_cap')).toBe(1);
    await rig.tick(armed, { scan: true });
    expect(offsetOf(rig.db, aPath), 'CONTROL: below 90% the scan reads it').toBe(fs.statSync(aPath).size);
  });

  /** The pass itself (review 1735 F3), through runDriver on a fixture HOME with a 1 GB cap: a first pass at the cap writes the install
   *  record and ingests nothing; a second, below 90%, stores the parent and one subagent file; both grow; the third runs at `size`. */
  const sa11 = (prefix: string, o: { scan: boolean; size: number }): { mainEntries: number; agentBefore: number; agentAfter: number; counter: number } => {
    const box = makeHistoryBox(prefix, { roster: LANE_ROSTER });
    createStore(box.home);
    fs.writeFileSync(historyPaths(box.home).cap, '1\n');
    const pass = (deps: Parameters<typeof runDriver>[1]): void => { const r = runDriver(box, deps); expect(r.code, r.stderr).toBe(0); };
    pass({ sizeBytes: capBytes(1) });
    const ro0 = openStoreRO(box);
    const since = Number(getMeta(ro0, 'agents_since_ms'));
    ro0.close();
    const parent = uuidOf(11);
    plantSession(box, 'lane-a-s1', { uuid: parent });
    const main = plantTranscript(box, 'lane-a', SLUG, parent, fixtureRows(0xd00, 2, parent));
    const dir = path.join(box.accountHome['lane-a']!, 'projects', SLUG, parent, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'agent-a.jsonl');
    const put = (p: string, rows: object[], atMs: number, append = false): void => {
      const text = rows.map((r) => `${JSON.stringify(r)}\n`).join('');
      if (append) fs.appendFileSync(p, text); else fs.writeFileSync(p, text);
      fs.utimesSync(p, new Date(atMs), new Date(atMs));
    };
    put(file, fixtureRows(0xd01, 2), since + 60_000);
    fs.mkdirSync(path.dirname(historyPaths(box.home).agentsOn), { recursive: true });
    fs.writeFileSync(historyPaths(box.home).agentsOn, '');
    pass({ sizeBytes: 1024, offsetMs: 120_000 });
    const agentOffset = (db: ReturnType<typeof openStoreRO>): number =>
      (db.prepare("SELECT f.offset AS n FROM ingest_files f JOIN transcripts t ON t.transcript_pk = f.transcript_pk WHERE t.agent_id = 'a'").get() as { n: number }).n;
    const ro1 = openStoreRO(box);
    const agentBefore = agentOffset(ro1);
    expect(agentBefore, 'CONTROL: the second pass stored the subagent file whole').toBe(fs.statSync(file).size);
    ro1.close();
    put(main, fixtureRows(0xd02, 2, parent), since + 180_000, true);
    put(file, fixtureRows(0xd03, 2), since + 180_000, true);
    pass({ sizeBytes: o.size, offsetMs: o.scan ? 120_000 + SCAN_INTERVAL_MS + 60_000 : 240_000 });
    const db = openStoreRO(box);
    try {
      const mainEntries = (mainRows(db) as Array<{ entries: number }>)[0]!.entries;
      return { mainEntries, agentBefore, agentAfter: agentOffset(db), counter: counterOf(db, 'capture_paused_agents_at_cap') };
    } finally { db.close(); }
  };

  it.each([[true], [false]] as const)('SA11 pause order (P5), through the pass (scan tick: %s): at 90 percent of a 1 GB cap main rows are ingested, subagent cursors unmoved, counted', (scan) => {
    // DriverDeps.sizeBytes at ceil(0.9 * capBytes(1)): planRun answers no pause (under the cap), so only ingestTick's decideAgentsPause can hold the
    // subagent file back, from the size and cap the pass handed tick() (mutants (f) and (g))
    const r = sa11(`ccrc-hist-sa11-${scan}-`, { scan, size: Math.ceil(0.9 * capBytes(1)) });
    expect(r.mainEntries, 'main capture continues').toBe(4);
    expect(r.agentAfter, 'the subagent cursor did not move').toBe(r.agentBefore);
    expect(r.counter).toBe(1);
  }, 180_000);

  it('SA11 CONTROL: one byte under 90% the same pass reads the grown subagent file and counts nothing', () => {
    const r = sa11('ccrc-hist-sa11-ctl-', { scan: true, size: Math.ceil(0.9 * capBytes(1)) - 1 });
    expect(r.mainEntries).toBe(4);
    expect(r.agentAfter, 'the subagent cursor moved').toBeGreaterThan(r.agentBefore);
    expect(r.counter).toBe(0);
  }, 180_000);
});

describe('the install record under the pass itself (review 1731, F3)', () => {
  it('the first pass writes agents_since_ms under an at-cap pause, and a later file is post-install', async () => {
    const box = makeHistoryBox('ccrc-hist-atcap-', { roster: LANE_ROSTER });
    createStore(box.home);
    fs.writeFileSync(historyPaths(box.home).cap, '1\n');
    // the first pass, through runDriver: DriverDeps.sizeBytes at the cap of a 1 GB history-max-gb, so planRun pauses at-cap
    const first = runDriver(box, { sizeBytes: capBytes(1) });
    expect(first.code, first.stderr).toBe(0);
    const ro = openStoreRO(box);
    const since = Number(getMeta(ro, 'agents_since_ms'));
    ro.close();
    expect(since).toBeGreaterThan(0);
    // a known parent with one agent file stamped since + 60_000, the marker set, then a pass below the cap
    const parent = uuidOf(7);
    plantSession(box, 'lane-a-s1', { uuid: parent });
    plantTranscript(box, 'lane-a', SLUG, parent, fixtureRows(0xe00, 2));
    const dir = path.join(box.accountHome['lane-a']!, 'projects', SLUG, parent, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'agent-a.jsonl');
    fs.writeFileSync(file, fixtureRows(0xe01, 2).map((r) => `${JSON.stringify(r)}\n`).join(''));
    const t = new Date(since + 60_000);
    fs.utimesSync(file, t, t);
    fs.mkdirSync(path.dirname(historyPaths(box.home).agentsOn), { recursive: true });
    fs.writeFileSync(historyPaths(box.home).agentsOn, '');
    const second = runDriver(box, { sizeBytes: 1024, offsetMs: 120_000 });
    expect(second.code, second.stderr).toBe(0);
    const db = openStoreRO(box);
    try {
      expect(agentRows(db)).toBe(1);
      expect(getMeta(db, 'agents_since_ms'), 'and the record did not move').toBe(String(since));
    } finally { db.close(); }
  });
});

describe('the subagent meta, its lifecycle and agent_type (W4 addendum P17, SA6, SA16)', () => {
  const metaPathOf = (agentPath: string): string => agentPath.replace(/\.jsonl$/, '.meta.json');
  const one = async (prefix: string, meta: TreeSpec['agents'][number]['meta']): Promise<{ rig: AgentRig; aPath: string }> => {
    const rig = await rigOf(prefix);
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x1000, { meta })] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db), 'CONTROL: the transcript was ingested whatever its meta').toEqual(['a']);
    return { rig, aPath: paths['a']! };
  };

  it('a meta read whole stores its link once, and its type from the measured field', async () => {
    const { rig } = await one('ccrc-hist-meta-ok-', { toolUseId: 'toolu_01', agentType: 'general-purpose' });
    expect(linkOf(rig.db, 'a')).toBe('toolu_01');
    expect(agentTypeOf(rig.db, 'a')).toBe('general-purpose');
    expect(counterNames(rig.db).filter((n) => n.startsWith('agent_meta'))).toEqual([]);
  });

  it('SA16 agent_type: a meta without the measured field is NULL', async () => {
    // the fixture meta carries an agent_type key, which is not the measured field (act M2 measured agentType, D-8161)
    const { rig } = await one('ccrc-hist-sa16-null-', { toolUseId: 'toolu_02', agent_type: 'general-purpose' });
    expect(agentTypeOf(rig.db, 'a')).toBeNull();
    expect(linkOf(rig.db, 'a'), 'CONTROL: the meta was read whole').toBe('toolu_02');
  });

  it('SA16 agent_type: with the field act M2 names, its value', async () => {
    const { rig } = await one('ccrc-hist-sa16-value-', { toolUseId: 'toolu_03', agentType: 'general-purpose' });
    expect(agentTypeOf(rig.db, 'a')).toBe('general-purpose');
  });

  it.each([[7], [{ x: 1 }], [['a']], [true], [null]] as const)('agentType %j, not a string, is NULL and never coerced', async (value) => {
    const { rig } = await one('ccrc-hist-sa16-type-', { toolUseId: 'toolu_04', agentType: value });
    expect(agentTypeOf(rig.db, 'a')).toBeNull();
    expect(linkOf(rig.db, 'a'), 'CONTROL: the meta was read whole').toBe('toolu_04');
  });

  it('a meta naming no link leaves the link NULL and counts nothing', async () => {
    const { rig } = await one('ccrc-hist-meta-nolink-', { agentType: 'x' });
    expect(linkOf(rig.db, 'a')).toBeNull();
    expect(agentTypeOf(rig.db, 'a')).toBe('x');
    expect(counterNames(rig.db).filter((n) => n.startsWith('agent_meta'))).toEqual([]);
  });

  it.each([
    ['no meta file', 'absent', undefined],
    ['absent', 'absent', 'absent'],
    ['oversized', 'oversized', 'oversized'],
    ['malformed', 'malformed', 'malformed'],
  ] as const)('SA6: a meta that is %s leaves the link NULL, counts agent_meta_unreadable:<cause> once, and the transcript is ingested (%s)', async (_what, cause, meta) => {
    const { rig } = await one(`ccrc-hist-meta-${cause}-`, meta);
    expect(linkOf(rig.db, 'a')).toBeNull();
    expect(counterOf(rig.db, `agent_meta_unreadable:${cause}`)).toBe(1);
    expect(counterNames(rig.db).filter((n) => n.startsWith('agent_meta'))).toEqual([`agent_meta_unreadable:${cause}`]);
  });

  it('a meta that is a link, and one that is a directory, are not regular: agent_meta_unreadable:not-regular', async () => {
    const rig = await rigOf('ccrc-hist-meta-link-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x1010, { meta: 'absent' }), agent('b', 0x1011, { meta: 'absent' })] }, SINCE);
    const real = path.join(path.dirname(paths['a']!), 'real-meta');
    fs.writeFileSync(real, JSON.stringify({ toolUseId: 'toolu_05' }));
    fs.symlinkSync(real, metaPathOf(paths['a']!));
    fs.mkdirSync(metaPathOf(paths['b']!));
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db)).toEqual(['a', 'b']);
    expect(linkOf(rig.db, 'a'), 'a link is never followed').toBeNull();
    expect(counterOf(rig.db, 'agent_meta_unreadable:not-regular')).toBe(2);
  });

  it('nothing retries: a meta that became whole later is not read by a later tick, and no tick recounts', async () => {
    const { rig, aPath } = await one('ccrc-hist-meta-noretry-', 'oversized');
    fs.writeFileSync(metaPathOf(aPath), JSON.stringify({ toolUseId: 'toolu_06' }));
    fs.appendFileSync(aPath, fixtureRows(0x1020, 1).map((r) => `${JSON.stringify(r)}\n`).join(''));
    await rig.tick(armed, { scan: true });
    await rig.tick(armed, { scan: true });
    expect(linkOf(rig.db, 'a')).toBeNull();
    expect(counterOf(rig.db, 'agent_meta_unreadable:oversized')).toBe(1);
  });

  it('a workflow agent\'s meta is the one beside its file, in its run directory', async () => {
    const rig = await rigOf('ccrc-hist-meta-run-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [], runs: [{ id: RUN, agents: [agent('x', 0x1030, { meta: { toolUseId: 'toolu_07' } })] }] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(linkOf(rig.db, `${RUN}/x`)).toBe('toolu_07');
  });

  describe('several holdings of one key (P17 (c), SA24, SA25)', () => {
    /** One agent `a` with three rows in the first home, ingested by a first armed scan tick. */
    const held = async (prefix: string, meta: TreeSpec['agents'][number]['meta'] = { toolUseId: 'toolu_10' }): Promise<{ rig: AgentRig; first: string; fromHome: string; otherHome: string }> => {
      const rig = await rigOf(prefix);
      const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x1100, { n: 3, meta })] }, SINCE);
      await rig.tick(armed, { scan: true });
      expect(fileRowsOf(rig.db, 'a'), 'CONTROL: set-up stored one holding').toBe(1);
      return { rig, first: paths['a']!, fromHome: rig.box.homes[0]!, otherHome: rig.box.homes[1]! };
    };

    it('SA24 hardlinked holdings: one file row, two aliases, one membership per message', async () => {
      const { rig, first, fromHome, otherHome } = await held('ccrc-hist-sa24-');
      const second = holdAgainIn(first, fromHome, otherHome, 'link');
      expect(fs.statSync(second).ino, 'CONTROL: one inode').toBe(fs.statSync(first).ino);
      await rig.tick(armed, { scan: true });
      const { db } = rig;
      expect(fileRowsOf(db, 'a')).toBe(1); expect(aliasesOf(db, 'a')).toBe(2);
      expect(transcriptRows(db, 'a')).toBe(1); expect(membershipsPerEntry(db, 'a')).toEqual([1, 1, 1]);
      expect(counterOf(db, 'agent_meta_conflict'), 'both holdings name the same link').toBe(0);
    });

    it('SA25 identical copies: two file rows, one transcript, a membership in each, no variant', async () => {
      const { rig, first, fromHome, otherHome } = await held('ccrc-hist-sa25-');
      const second = holdAgainIn(first, fromHome, otherHome, 'copy');
      expect(fs.statSync(second).ino, 'CONTROL: two inodes').not.toBe(fs.statSync(first).ino);
      await rig.tick(armed, { scan: true });
      const { db } = rig;
      expect(fileRowsOf(db, 'a')).toBe(2); expect(aliasesOf(db, 'a')).toBe(2);
      expect(transcriptRows(db, 'a')).toBe(1); expect(membershipsPerEntry(db, 'a')).toEqual([2, 2, 2]);
      expect(variantsOf(db, 'a')).toBe(0);
      expect(agentKeys(db)).toEqual(['a']);
    });

    it('a further holding whose meta names a different link: the first link stands and agent_meta_conflict is counted', async () => {
      const { rig, first, fromHome, otherHome } = await held('ccrc-hist-meta-conflict-');
      holdAgainIn(first, fromHome, otherHome, 'copy', { toolUseId: 'toolu_other' });
      await rig.tick(armed, { scan: true });
      expect(linkOf(rig.db, 'a')).toBe('toolu_10');
      expect(counterOf(rig.db, 'agent_meta_conflict')).toBe(1);
      await rig.tick(armed, { scan: true });
      expect(counterOf(rig.db, 'agent_meta_conflict'), 'and a later tick does not recount it').toBe(1);
    });

    it('a further holding whose meta is absent counts agent_meta_unreadable:absent and writes nothing', async () => {
      const { rig, first, fromHome, otherHome } = await held('ccrc-hist-meta-second-absent-');
      holdAgainIn(first, fromHome, otherHome, 'copy', 'absent');
      await rig.tick(armed, { scan: true });
      expect(linkOf(rig.db, 'a')).toBe('toolu_10');
      expect(counterOf(rig.db, 'agent_meta_unreadable:absent')).toBe(1);
    });

    it('the first meta read whole that names a link is written, though an earlier holding\'s was incomplete', async () => {
      const { rig, first, fromHome, otherHome } = await held('ccrc-hist-meta-late-link-', 'malformed');
      expect(linkOf(rig.db, 'a')).toBeNull();
      holdAgainIn(first, fromHome, otherHome, 'copy', { toolUseId: 'toolu_11', agentType: 'Explore' });
      await rig.tick(armed, { scan: true });
      expect(linkOf(rig.db, 'a')).toBe('toolu_11');
      expect(agentTypeOf(rig.db, 'a')).toBe('Explore');
      expect(counterOf(rig.db, 'agent_meta_unreadable:malformed')).toBe(1);
      expect(counterOf(rig.db, 'agent_meta_conflict')).toBe(0);
    });
  });
});

describe('readAgentMeta (W4 addendum P17)', () => {
  // a directory per case, removed after it (tmpHelpers' mark-and-remove, scoped to this describe)
  let mark = -1;
  beforeEach(() => { mark = tmpMark(); });
  afterEach(() => { if (mark >= 0) removeTmpFixturesSince(mark); mark = -1; });
  const dirOf = (): string => mkTmp('ccrc-hist-meta-');
  it('answers the link and the type of a whole object, and the cause of anything else', () => {
    const dir = dirOf();
    const put = (name: string, text: string): string => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
    expect(readAgentMeta(put('ok.json', '{"toolUseId":"t","agentType":"x"}'))).toEqual({ ok: true, toolUseId: 't', agentType: 'x' });
    expect(readAgentMeta(put('empty-link.json', '{"toolUseId":""}'))).toEqual({ ok: true, toolUseId: null, agentType: null });
    expect(readAgentMeta(put('num-link.json', '{"toolUseId":5}'))).toEqual({ ok: true, toolUseId: null, agentType: null });
    expect(readAgentMeta(put('empty-obj.json', '{}'))).toEqual({ ok: true, toolUseId: null, agentType: null });
    for (const [name, text] of [['array.json', '[1]'], ['null.json', 'null'], ['str.json', '"x"'], ['num.json', '5'], ['bad.json', '{not'], ['blank.json', '']] as const) {
      expect(readAgentMeta(put(name, text)), name).toEqual({ ok: false, cause: 'malformed' });
    }
    expect(readAgentMeta(path.join(dir, 'missing.json'))).toEqual({ ok: false, cause: 'absent' });
    expect(readAgentMeta(path.join(dir, 'missing', 'x.json')), 'a parent that is not there').toEqual({ ok: false, cause: 'absent' });
    expect(readAgentMeta(dir), 'a directory').toEqual({ ok: false, cause: 'not-regular' });
    fs.symlinkSync(path.join(dir, 'ok.json'), path.join(dir, 'link.json'));
    expect(readAgentMeta(path.join(dir, 'link.json')), 'a link').toEqual({ ok: false, cause: 'not-regular' });
    expect(readAgentMeta(put('over.json', `{"pad":"${'x'.repeat(META_MAX_BYTES)}"}`))).toEqual({ ok: false, cause: 'oversized' });
  });
  it('every cause readAgentMeta can answer is in META_FAILURES, and every META_FAILURES word is one it answers (the census spells them in a reason)', () => {
    // scan the reader's own body: each `cause: <expr>` (a literal or a ternary chain of literals) up to its closing brace
    const src = fs.readFileSync(path.join(__dirname, '../../ccd/history/sweep.mjs'), 'utf8');
    const start = src.indexOf('export function readAgentMeta(');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    const exprs = [...body.matchAll(/cause:\s*([^}]*)\}/g)].map((m) => m[1]!);
    const causes = new Set(exprs.flatMap((e) => [...e.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!)));
    expect(exprs.length, 'CONTROL: the scan found the reader\'s causes').toBeGreaterThanOrEqual(8);
    expect([...causes].sort()).toEqual([...META_FAILURES].sort());
  });
  it('a file of exactly META_MAX_BYTES is read, one byte more is oversized', () => {
    const dir = dirOf();
    const body = (len: number): string => { const head = '{"toolUseId":"t","pad":"'; const tail = '"}'; return head + 'x'.repeat(len - head.length - tail.length) + tail; };
    const at = path.join(dir, 'at.json'); fs.writeFileSync(at, body(META_MAX_BYTES));
    const over = path.join(dir, 'over.json'); fs.writeFileSync(over, body(META_MAX_BYTES + 1));
    expect(fs.statSync(at).size).toBe(META_MAX_BYTES);
    expect(readAgentMeta(at)).toEqual({ ok: true, toolUseId: 't', agentType: null });
    expect(readAgentMeta(over)).toEqual({ ok: false, cause: 'oversized' });
  });
  it('invalid UTF-8 is malformed, never decoded with replacement characters; valid multibyte text and a BOM-led file are read as before', () => {
    const dir = dirOf();
    const put = (name: string, bytes: Buffer): string => { const p = path.join(dir, name); fs.writeFileSync(p, bytes); return p; };
    const json = (pre: Buffer | string, post: Buffer | string = ''): Buffer => Buffer.concat([Buffer.from('{"toolUseId":"t","agentType":"'), Buffer.from(pre), Buffer.from(post), Buffer.from('"}')]);
    expect(readAgentMeta(put('bad.json', json(Buffer.from([0xff, 0xfe]))))).toEqual({ ok: false, cause: 'malformed' });
    expect(readAgentMeta(put('cut.json', json(Buffer.from([0xe2, 0x82]))))).toEqual({ ok: false, cause: 'malformed' });
    expect(readAgentMeta(put('ok.json', json('é€')))).toEqual({ ok: true, toolUseId: 't', agentType: 'é€' });
    expect(readAgentMeta(put('bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json('x')])))).toEqual({ ok: false, cause: 'malformed' });
  });
  it('the open carries O_NOFOLLOW and O_NONBLOCK (the race belts behind the lstat)', () => {
    const dir = dirOf();
    const p = path.join(dir, 'm.json');
    fs.writeFileSync(p, '{"toolUseId":"t"}');
    const { out, opens } = recordOpenFlags(() => readAgentMeta(p));
    expect(out, 'CONTROL: the meta was read').toEqual({ ok: true, toolUseId: 't', agentType: null });
    const mine = opens.filter((o) => o.path === p);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.flags & constants.O_NOFOLLOW, 'O_NOFOLLOW').toBe(constants.O_NOFOLLOW);
    expect(mine[0]!.flags & constants.O_NONBLOCK, 'O_NONBLOCK').toBe(constants.O_NONBLOCK);
  });
  /** fs.lstatSync answers `as` for `target` and the real answer for any other path, for the run of `fn`; restored in finally. */
  const lstatLying = <T,>(target: string, as: string, fn: () => T): T => {
    const real = fs.lstatSync;
    const patch = fs as { lstatSync: typeof fs.lstatSync };   // lstatSync is typed read-only; the open recorder patches openSync the same way
    patch.lstatSync = ((p: fs.PathLike, ...rest: unknown[]) => (String(p) === target ? (real as (...a: unknown[]) => fs.Stats)(as) : (real as (...a: unknown[]) => fs.Stats)(p, ...rest))) as typeof fs.lstatSync;
    syncBuiltinESMExports();
    try { return fn(); } finally { patch.lstatSync = real; syncBuiltinESMExports(); }
  };
  it('a swap after the lstat: a FIFO where a regular file was seen is not regular, and the read does not block', { timeout: 5000 }, () => {
    const dir = dirOf();
    const regular = path.join(dir, 'regular.json'); fs.writeFileSync(regular, '{"toolUseId":"t"}');
    const fifo = path.join(dir, 'fifo.json');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    // A reader and a writer end are held by the case, so even an open without O_NONBLOCK returns and a read without the fstat
    // re-check ends in EAGAIN (O_NONBLOCK) rather than hanging this process for good: the mutants fail, they do not wedge.
    const reader = fs.openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const writer = fs.openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    try {
      expect(lstatLying(fifo, regular, () => readAgentMeta(fifo))).toEqual({ ok: false, cause: 'not-regular' });
    } finally { fs.closeSync(writer); fs.closeSync(reader); }
  });
  it('a swap after the lstat: a link where a regular file was seen is refused by the open, never followed', () => {
    const dir = dirOf();
    const regular = path.join(dir, 'regular.json'); fs.writeFileSync(regular, '{"toolUseId":"t"}');
    const link = path.join(dir, 'link.json'); fs.symlinkSync(regular, link);
    expect(lstatLying(link, regular, () => readAgentMeta(link))).toEqual({ ok: false, cause: 'not-regular' });
  });
  it('a FIFO is not regular and is never blocked on', () => {
    const dir = dirOf();
    const fifo = path.join(dir, 'fifo.json');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    expect(readAgentMeta(fifo)).toEqual({ ok: false, cause: 'not-regular' });
  });
});

// ── SA34: one walker, and the hook's id shape (P20 (a)) ─────────────────────────────────────────────────────────────────
const REPO = path.resolve(__dirname, '..', '..');
const HISTORY_DIR = path.join(REPO, 'ccd', 'history');
/** The comment lines dropped, so a sentence about a name is never read as code. */
const codeLines = (text: string): string[] => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
/** The two gate lines of the hook's `_hook_compact_scope`, found by content, never by line number. */
function hookGateLines(): string[] {
  const text = fs.readFileSync(path.join(REPO, 'ccd', 'session-hook.sh'), 'utf8').split('\n');
  const at = text.findIndex((l) => l.startsWith('_hook_compact_scope() {'));
  expect(at, 'the hook declares no _hook_compact_scope').toBeGreaterThan(-1);
  let end = at + 1;
  while (end < text.length && text[end] !== '}') end += 1;
  const body = text.slice(at, end);
  const charClass = body.filter((l) => /^\s*case "\$f" in ''\|\*\[!A-Za-z0-9_-\]\*\) return 1 ;; esac\s*$/.test(l));
  const length = body.filter((l) => /^\s*\(\( \$\{#f\} <= CCRC_ID_MAX \)\) \|\| return 1\s*$/.test(l));
  expect([charClass.length, length.length], 'the hook\'s two gate lines were not found, once each').toEqual([1, 1]);
  return [charClass[0]!.trim(), length[0]!.trim()];
}
/** Whether the hook's gate accepts `id`: its two lines run under bash with CCRC_ID_MAX=128, in the C locale. */
function hookGateAccepts(id: string): boolean {
  const [cls, len] = hookGateLines();
  const script = `CCRC_ID_MAX=128\ngate() { local f="$1"; ${cls}\n${len}\nreturn 0; }\ngate "$1"`;
  const r = spawnSync('bash', ['-c', script, 'bash', id], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' });
  expect(r.error, 'bash did not run').toBeUndefined();
  return r.status === 0;
}
/** The top-level functions of ccd/history/*.mjs whose code lines spell `/subagents` as a path component. Comments are dropped. */
function listersOfSubagents(files: Array<{ name: string; text: string }>): string[] {
  const out = new Set<string>();
  for (const f of files) {
    let fn = '<top>';
    for (const l of codeLines(f.text)) {
      const m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(l);
      if (m) fn = m[1]!;
      if (l.includes('/subagents')) out.add(`${f.name} ${fn}`);
    }
  }
  return [...out].sort();
}
/** The listing calls census.mjs makes, which must be none: it reads the tree only through the walk. */
const listingCalls = (text: string): string[] => codeLines(text).filter((l) => /\b(?:readdir|readdirSync|opendir|opendirSync)\s*\(/.test(l));
const historyModules = (): Array<{ name: string; text: string }> =>
  fs.readdirSync(HISTORY_DIR).filter((n) => n.endsWith('.mjs')).sort().map((n) => ({ name: n, text: fs.readFileSync(path.join(HISTORY_DIR, n), 'utf8') }));

describe('SA34 one walker, and the hook\'s id shape (P20 (a))', () => {
  it('the hook\'s gate and lib\'s agent-id grammar accept and refuse alike', () => {
    for (const id of ['', 'a', 'a'.repeat(128), 'a'.repeat(129), 'a.b', '-a', 'a_b', 'a b', 'é']) {
      expect(hookGateAccepts(id), JSON.stringify(id)).toBe(agentIdOk(id));
    }
    expect(hookGateAccepts('a'), 'CONTROL: the harness accepts a good id').toBe(true);
    expect(hookGateAccepts('a.b'), 'CONTROL: and refuses a dot').toBe(false);
  });

  it('only the walk\'s agent arm lists the subagent tree, and census.mjs lists nothing', () => {
    const files = historyModules();
    expect(listersOfSubagents(files)).toEqual(['sweep.mjs walkAgentProject']);
    for (const f of files.filter((x) => x.name === 'census.mjs')) expect(listingCalls(f.text), 'census.mjs lists a directory').toEqual([]);
    // CONTROLs: a census listing of subagents/ is seen by both halves
    const planted = { name: 'census.mjs', text: 'function listAll(s) {\n  return readdirSync(`${s}/subagents`);\n}\n' };
    expect(listersOfSubagents([...files, planted])).toContain('census.mjs listAll');
    expect(listingCalls(planted.text)).toHaveLength(1);
    expect(listersOfSubagents([{ name: 'x.mjs', text: '// the list of `${s}/subagents` is the walk\'s\n * /subagents\n' }]), 'a comment is not a lister').toEqual([]);
  });

  it('the live row a path names is one statement (the tick\'s withheld count and the import\'s forecast share it), and its bytes-left rule is lib\'s (final review M2)', () => {
    const sweep = historyModules().find((m) => m.name === 'sweep.mjs')!.text;
    const rowStatements = codeLines(sweep).filter((l) => l.includes('SELECT f.dev AS dev, f.ino AS ino, f.offset AS offset FROM file_paths p'));
    expect(rowStatements, 'the path-row statement is spelled once').toHaveLength(1);
    // and neither arm re-spells the rule: size minus the cursor is lib's bytesLeftOf alone
    expect(codeLines(sweep).filter((l) => /Math\.max\(\s*size\s*-\s*Number\(row\.offset\)/.test(l) || /st\.size\s*!==\s*Number\(row\.offset\)/.test(l))).toEqual([]);
  });
});


describe('the import writing form: import --agents [--apply] (W4 addendum P6, SA12, SA32; departures D-8157, D-8158)', () => {
  const pre = (id: string, tag: number): TreeSpec['agents'][number] => agent(id, tag, { atMs: -60_000 });
  const post = (id: string, tag: number): TreeSpec['agents'][number] => agent(id, tag, { atMs: 60_000 });
  const op = (box: HistoryBox, ...args: string[]) => runShim(box, ['--op', ...args]);
  interface Forecast { files: number; bytes: number; storeBytesLow: number; storeBytesHigh: number; pauseAtBytes: number; skipped: Record<string, number> }
  /** The dry run's one JSON line (the forecast), whatever else the run prints. */
  const forecastOf = (stdout: string): Forecast => {
    const line = stdout.split('\n').find((l) => l.startsWith('{"files"'));
    expect(line, `no forecast line in:\n${stdout}`).toBeDefined();
    return JSON.parse(line!) as Forecast;
  };
  /** Every entry under ~/.ccrc with its size and mtime: "writes nothing", measured. The shim's lock and SQLite's WAL sidecars are
   *  excluded (a read-only open may create them); directories are listed by name. */
  const treeState = (box: HistoryBox): string[] => {
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
  };
  /** What a tree listing cannot see: a write that only reached the WAL moves a counter or a meta row, or the -wal file's size. */
  const storeState = (box: HistoryBox): { counters: Record<string, number>; meta: unknown[]; walBytes: number } => {
    const ro = openStoreRO(box);
    try {
      const wal = `${historyPaths(box.home).dbFile}-wal`;
      return {
        counters: counters(box),
        meta: ro.prepare('SELECT k, v FROM meta ORDER BY k').all(),
        walBytes: fs.existsSync(wal) ? fs.statSync(wal).size : 0,
      };
    } finally { ro.close(); }
  };
  const storedAgents = (box: HistoryBox): number => { const ro = openStoreRO(box); try { return agentRows(ro); } finally { ro.close(); } };
  const sizeOf = (p: string): number => fs.statSync(p).size;
  const REMEDY = 'run `ccrc history import --apply` first';
  const RESUME = 're-run import --agents --apply to resume it: the scheduled ticks never take a pre-install file';

  it('SA12 no backfill (P6): a tick ingests no pre-install file; the dry run forecasts, skips a file whose parent is unknown, and writes nothing', async () => {
    const rig = await rigOf('ccrc-hist-sa12i-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1000)] }, SINCE);
    plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(2), agents: [pre('b', 0x1001)], parent: 'unknown' }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db), 'a tick takes no pre-install file').toBe(0);
    closeWriter(rig.db);
    const before = treeState(rig.box);
    const storeBefore = storeState(rig.box);
    const r = op(rig.box, 'import', '--agents');
    expect(r.code, r.stderr).toBe(0);
    expect(forecastOf(r.stdout)).toMatchObject({
      files: 1, bytes: sizeOf(paths['a']!), skipped: { 'parent-unconfirmed': 0, 'parent-unknown': 1, 'post-install': 0, refused: 0 },
    });
    expect(treeState(rig.box), 'a dry run writes nothing: no byte, no mtime').toEqual(before);
    expect(storeState(rig.box), 'nor a counter, a meta row or a WAL byte').toEqual(storeBefore);
    expect(storedAgents(rig.box)).toBe(0);
  });

  it('the forecast counts each skipped file under one reason, and the store sizes follow the bytes (the 0.4 and 0.55 ratios)', async () => {
    const rig = await rigOf('ccrc-hist-fcast-');
    const a = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1010), post('p', 0x1011)], runs: [{ id: 'wf_bad', agents: [pre('x', 0x1012)] }] }, SINCE);
    plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(3), agents: [pre('c', 0x1013)], parent: 'compactions' }, SINCE);
    plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(4), agents: [pre('d', 0x1014)], parent: 'unknown' }, SINCE);
    closeWriter(rig.db);
    fs.writeFileSync(historyPaths(rig.box.home).cap, '1\n');
    const r = op(rig.box, 'import', '--agents');
    expect(r.code, r.stderr).toBe(0);
    const bytes = sizeOf(a.paths['a']!);
    expect(forecastOf(r.stdout)).toEqual({
      files: 1, bytes, storeBytesLow: Math.round(bytes * 0.4), storeBytesHigh: Math.round(bytes * 0.55), pauseAtBytes: Math.ceil(0.9 * capBytes(1)),
      skipped: { 'parent-unconfirmed': 1, 'parent-unknown': 1, 'post-install': 1, refused: 1 },
    });
    expect(r.stdout, 'the pause bound is said in words').toContain(`the apply stops once the store reaches ${Math.ceil(0.9 * capBytes(1))} bytes (90% of the cap)`);
  });

  it('SA32 the import writing form (P6): a WRITING_FORMS row, refused in a session and under history-off, bad-args beside --session or --file', async () => {
    const rig = await rigOf('ccrc-hist-sa32-');
    closeWriter(rig.db);
    const { box } = rig;
    expect(WRITING_FORMS['import-agents-apply']).toMatchObject({ op: 'import', irreversible: false, binding: false });
    const apply = ['import', '--agents', '--apply', '--json'];
    const inSession = runCli(box, apply, { env: { CLAUDECODE: '1' } });
    expect(inSession.json, `${inSession.stdout}${inSession.stderr}`).toMatchObject({ exit: 2, reason: 'apply-in-session' });
    fs.writeFileSync(historyPaths(box.home).off, '');
    const off = runCli(box, apply);
    expect(off.json, `${off.stdout}${off.stderr}`).toMatchObject({ exit: 2, reason: 'history-off' });
    fs.rmSync(historyPaths(box.home).off);
    // only the combination refuses: a valid id and a <uuid>.jsonl file parse without --agents
    const pair = ['--session', 'lane-a-s1', '--file', `${box.homes[0]!}/projects/${SLUG}/${PARENT}.jsonl`];
    expect(parseOpVerbArgs('import', pair)).toMatchObject({ ok: true });
    expect(parseOpVerbArgs('import', ['--agents', ...pair])).toEqual({ ok: false, reason: 'bad-args' });
    const both = runCli(box, ['import', '--agents', ...pair, '--json']);
    expect(both.json, `${both.stdout}${both.stderr}`).toMatchObject({ exit: 2, reason: 'bad-args' });
    // not irreversible: a pipe (no terminal) runs it
    const piped = runCli(box, apply);
    expect(piped.code, `${piped.stdout}${piped.stderr}`).toBe(0);
    expect(piped.json).toMatchObject({ exit: 0 });
  });

  it('the apply ingests the pre-install files of known parents, workflow agents included, and never a post-install file or the parent\'s main transcript', async () => {
    const rig = await rigOf('ccrc-hist-apply-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1020), post('p', 0x1021)], runs: [{ id: RUN, agents: [pre('b', 0x1022)] }] }, SINCE);
    closeWriter(rig.db);
    const r = op(rig.box, 'import', '--agents', '--apply');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, 'the apply says what it did not take, by reason').toContain('history-sweep: skipped by reason: parent-unconfirmed 0, parent-unknown 0, post-install 1, refused 0\n');
    expect(r.stdout, 'and no remedy when no parent waits').not.toContain(REMEDY);
    const ro = openStoreRO(rig.box);
    try {
      expect(agentKeys(ro)).toEqual(['a', `${RUN}/b`]);
      expect(mainRows(ro), 'the form ingests subagent files only').toEqual([]);
    } finally { ro.close(); }
    // the marker is not read (D-8158): none stands, and the rows are there
    expect(fs.existsSync(historyPaths(rig.box.home).agentsOn)).toBe(false);
    const again = op(rig.box, 'import', '--agents', '--apply');
    expect(again.code, again.stderr).toBe(0);
    expect(storedAgents(rig.box), 'a second apply adds nothing').toBe(2);
  });

  it('a parent known only through importEvidence waits for a plain import --apply (review 1728, F9; D-8157)', async () => {
    const rig = await rigOf('ccrc-hist-f9-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1030)], parent: 'compactions' }, SINCE);
    closeWriter(rig.db);
    const dry = op(rig.box, 'import', '--agents');
    expect(forecastOf(dry.stdout)).toMatchObject({ files: 0, skipped: { 'parent-unconfirmed': 1, 'parent-unknown': 0 } });
    expect(dry.stdout).toContain(REMEDY);
    const first = op(rig.box, 'import', '--agents', '--apply');
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout, 'the apply names the skip').toContain('history-sweep: skipped by reason: parent-unconfirmed 1, parent-unknown 0, post-install 0, refused 0\n');
    expect(first.stdout, 'and the remedy').toContain(REMEDY);
    expect(storedAgents(rig.box), 'the wider map does not admit it').toBe(0);
    expect(op(rig.box, 'import', '--apply').code).toBe(0);   // confirms the parent's epoch: knownUuids now holds it
    expect(forecastOf(op(rig.box, 'import', '--agents').stdout)).toMatchObject({ files: 1, skipped: { 'parent-unconfirmed': 0 } });
    expect(op(rig.box, 'import', '--agents', '--apply').code).toBe(0);
    expect(storedAgents(rig.box)).toBe(1);
  });

  it('the remedy\'s exception: a parent the same id holds as an unconfirmed epoch stays parent-unconfirmed (review 1731, F9)', async () => {
    const rig = await rigOf('ccrc-hist-f9x-');
    const { parentId } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1040)], parent: 'compactions' }, SINCE);
    const pk = Number(rig.db.prepare("INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, '', 'p', 1)").run(parentId!).lastInsertRowid);
    rig.db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'spool', NULL)").run(pk, PARENT);
    closeWriter(rig.db);
    expect(op(rig.box, 'import', '--apply').code).toBe(0);   // mapRegistryUuid answers skipped: nothing is confirmed
    const dry = op(rig.box, 'import', '--agents');
    expect(forecastOf(dry.stdout)).toMatchObject({ files: 0, skipped: { 'parent-unconfirmed': 1 } });
    expect(dry.stdout, 'the remedy names its exceptions').toContain('It does not when the same id already holds the uuid as an unconfirmed epoch');
    expect(op(rig.box, 'import', '--agents', '--apply').code).toBe(0);
    expect(storedAgents(rig.box)).toBe(0);
  });

  /** One pre-install file of a known parent on a fixture box with a 1 GB cap and no marker. */
  const capBox = async (prefix: string): Promise<HistoryBox> => {
    const rig = await rigOf(prefix);
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1050)] }, SINCE);
    closeWriter(rig.db);
    fs.writeFileSync(historyPaths(rig.box.home).cap, '1\n');
    return rig.box;
  };

  it('import --agents --apply pauses at 90% of the cap, armed or not (review 1731, F2)', async () => {
    const box = await capBox('ccrc-hist-p90-');
    expect(fs.existsSync(historyPaths(box.home).agentsOn), 'no marker').toBe(false);
    const r = runDriver(box, { sizeBytes: Math.ceil(0.9 * capBytes(1)) }, ['--op', 'import', '--agents', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('agents-paused-at-cap');
    expect(r.stdout).toContain(RESUME);
    expect(r.stdout).not.toContain('the scheduled ticks resume it by cursor');
    expect(storedAgents(box)).toBe(0);
    expect(counters(box)['capture_paused_agents_at_cap']).toBe(1);
    expect(forecastOf(op(box, 'import', '--agents').stdout)).toMatchObject({ pauseAtBytes: Math.ceil(0.9 * capBytes(1)) });
  });

  it('CONTROL: one byte under 90% the same import writes the row and counts nothing', async () => {
    const box = await capBox('ccrc-hist-p90c-');
    const r = runDriver(box, { sizeBytes: Math.ceil(0.9 * capBytes(1)) - 1 }, ['--op', 'import', '--agents', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain('agents-paused-at-cap');
    expect(storedAgents(box)).toBe(1);
    expect(counters(box)['capture_paused_agents_at_cap'] ?? 0).toBe(0);
  });

  it('every stop word of the --agents form names the act that resumes it: at the cap, too; a plain import keeps its message', async () => {
    const box = await capBox('ccrc-hist-stop-');
    const r = runDriver(box, { sizeBytes: capBytes(1) }, ['--op', 'import', '--agents', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: at-cap: ingest stopped at .*; re-run import --agents --apply to resume it: the scheduled ticks never take a pre-install file \(P6\)$/m);
    expect(storedAgents(box)).toBe(0);
    const plain = runDriver(box, { sizeBytes: capBytes(1) }, ['--op', 'import', '--apply']);
    expect(plain.code, plain.stderr).toBe(0);
    expect(plain.stdout, 'a plain import counts no agent pause').not.toContain('agents-paused-at-cap');
    expect(plain.stdout, 'and keeps its own message').toContain('the scheduled ticks resume it by cursor');
    expect(plain.stdout).not.toContain('re-run import --agents --apply');
  });

  it('P5: the 90% pause is the --agents form\'s alone: a plain import at 90% of the cap ingests its main transcript, says no agent pause and counts none', async () => {
    const box = await capBox('ccrc-hist-p90m-');
    const r = runDriver(box, { sizeBytes: Math.ceil(0.9 * capBytes(1)) }, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain('agents-paused-at-cap');
    expect(r.stdout).not.toContain('ingest stopped');
    const ro = openStoreRO(box);
    try {
      expect(mainRows(ro), 'main capture goes on to the cap').toEqual([{ uuid: PARENT, entries: 2 }]);
    } finally { ro.close(); }
    expect(counters(box)['capture_paused_agents_at_cap'] ?? 0).toBe(0);
  });

  it('the forecast counts what is still waiting: a file stored whole is neither counted nor sized, a grown one counts its growth, an unstored one its size', async () => {
    const rig = await rigOf('ccrc-hist-left-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [pre('a', 0x1060)] }, SINCE);
    closeWriter(rig.db);
    expect(forecastOf(op(rig.box, 'import', '--agents').stdout)).toMatchObject({ files: 1, bytes: sizeOf(paths['a']!) });
    expect(op(rig.box, 'import', '--agents', '--apply').code).toBe(0);
    expect(forecastOf(op(rig.box, 'import', '--agents').stdout), 'stored whole: nothing waits').toMatchObject({ files: 0, bytes: 0, storeBytesLow: 0, storeBytesHigh: 0 });
    // one more row appended, the mtime kept before the install record; and a second agent file, not yet stored
    const stored = sizeOf(paths['a']!);
    fs.appendFileSync(paths['a']!, fixtureRows(0x1061, 1).map((row) => `${JSON.stringify(row)}\n`).join(''));
    const t = new Date(T0 - 60_000);
    fs.utimesSync(paths['a']!, t, t);
    const grown = sizeOf(paths['a']!) - stored;
    const second = path.join(path.dirname(paths['a']!), 'agent-b.jsonl');
    fs.writeFileSync(second, fixtureRows(0x1062, 2).map((row) => `${JSON.stringify(row)}\n`).join(''));
    fs.utimesSync(second, t, t);
    expect(grown).toBeGreaterThan(0);
    expect(forecastOf(op(rig.box, 'import', '--agents').stdout)).toMatchObject({ files: 2, bytes: grown + sizeOf(second) });
  });
});
