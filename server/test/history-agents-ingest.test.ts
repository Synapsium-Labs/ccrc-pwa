// server/test/history-agents-ingest.test.ts — the walk's subagent arm, the first ingest and its gates (W4 addendum P6, P15 (b),
// P20; plan 2026-11-09 Task 1C). In-process, against fixture HOMEs and stores made by historyAgentFixtures.ts' rig: the scan
// tick's agent arm runs `ingestTick` exactly as the pass does, and the pass-level cases run `runDriver` on a fixture HOME.
// Linux-only, as the sweep's cases are (the arm lists real directories and plants FIFOs).
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  agentRig, agentRows, agentKeys, armed, CENSUS_WALK_FIGURES, counterNames, fixtureRows, mainRows, noMarker, offsetOf,
  plantAgentTree, plantMarker, recordOpenFlagsAsync, runIdsOf, sidecarsOf, T0, type AgentRig, type TreeSpec,
} from './historyAgentFixtures.js';
import { makeHistoryBox, openStoreRO, plantSession, plantTranscript, runDriver, skipOnDarwin } from './historyHelpers.js';
import { LANE_ROSTER } from './historyAgentFixtures.js';
import { agentIdOk, capBytes, historyPaths } from '../../ccd/history/lib.mjs';
import { closeWriter, createStore, getMeta, openWriter } from '../../ccd/history/store.mjs';
import { behindStats, discoverTranscripts } from '../../ccd/history/sweep.mjs';

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
    expect(baseline, 'CONTROL: the parent\'s main transcript was ingested, so the scan did run').toHaveLength(1);
    plantMarker(box, 'link'); await tick(null, { scan: true }); expect(agentRows(db), 'a link is not armed').toBe(0);
    plantMarker(box, 'dir'); await tick(null, { scan: true }); expect(agentRows(db), 'a directory is not armed').toBe(0);
    plantMarker(box, 'file'); await tick(null, { scan: true }); expect(agentRows(db), 'CONTROL: a regular file arms it').toBe(1);
    expect(mainRows(db), 'main capture is unchanged').toEqual(baseline);
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
});

// openStoreRO/openWriter are used by neighbouring cases through the rig; this keeps the writer import exercised for the typecheck.
void openWriter;
