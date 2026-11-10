// server/test/history-census.test.ts — the subagent parent-link census (W4 addendum P4, P11, P12, P16 to P19; plan 2026-11-09 Task 1H).
// In-process against fixture HOMEs and stores made by historyAgentFixtures.ts' rig: a scan tick ingests the fixture exactly as the pass
// does, and `censusOf` runs the verb's own function (sweep.mjs censusReport: the walk, then runCensus). The verb itself (exits, stdout,
// writes nothing) is run through the CLI in SA23's cases. Linux-only, as the sweep's cases are (the walk lists real directories and
// plants FIFOs). Every pin is its own case, named after it; a count the addendum predicts that measured differently is corrected here
// with a comment, and listed in the task report.
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  agentKeys, agentRig, agentRows, AGENT_T0, armed, callRows, censusOf, counterNames, counterOf, fixtureRows, holdAgainIn, linkOf, membershipsPerEntry,
  plantAgentTree, resultRows, T0, transcriptRows, untimedRows, variantsOf, whileClosed, type AgentRig, type CensusReport, type TreeSpec,
} from './historyAgentFixtures.js';
import { holdLock, makeHistoryBox, openStoreRO, recordOpenFlags, runCli, runShim, runSweep, skipOnDarwin, type HistoryBox } from './historyHelpers.js';
import { historyPaths, WRITING_FORMS } from '../../ccd/history/lib.mjs';
import { closeWriter, getMeta } from '../../ccd/history/store.mjs';
import { discoverTranscripts } from '../../ccd/history/sweep.mjs';
import { formatCensus, runCensus } from '../../ccd/history/census.mjs';

skipOnDarwin();

const SLUG = '-home-u-tree';
const uuidOf = (n: number): string => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PARENT = uuidOf(1);
const RUN = 'wf_0123abcd-0a1';
const SINCE = { sinceMs: T0 };
const MIN = 60_000;

const rigs: AgentRig[] = [];
const rigOf = async (prefix: string): Promise<AgentRig> => { const r = await agentRig(prefix); rigs.push(r); return r; };
afterEach(() => { for (const r of rigs.splice(0)) { try { closeWriter(r.db); } catch { /* already closed */ } } });

type AgentSpec = TreeSpec['agents'][number];
/** One agent with `n` rows (message uuids under `tag`; the first row is at AGENT_T0), and its meta. */
const agent = (id: string, tag: number, extra: { n?: number; atMs?: number; meta?: AgentSpec['meta']; rows?: object[] } = {}): AgentSpec =>
  ({ id, rows: extra.rows ?? fixtureRows(tag, extra.n ?? 2), ...(extra.atMs === undefined ? {} : { atMs: extra.atMs }), ...(extra.meta === undefined ? {} : { meta: extra.meta }) });

/** One Agent-tool subagent `a` of a known parent, ingested by an armed scan tick; the census over it. */
async function one(prefix: string, o: { parentRows?: object[] | false; agentRows?: object[]; meta?: AgentSpec['meta']; tag?: number }): Promise<{ rig: AgentRig; report: CensusReport }> {
  const rig = await rigOf(prefix);
  plantAgentTree(rig, {
    slug: SLUG, uuid: PARENT, agents: [agent('a', o.tag ?? 0x2001, { ...(o.agentRows === undefined ? {} : { rows: o.agentRows }), ...(o.meta === undefined ? {} : { meta: o.meta }) })],
    ...(o.parentRows === false ? { main: false } : o.parentRows === undefined ? {} : { mainRows: o.parentRows }),
  }, SINCE);
  await rig.tick(armed, { scan: true });
  return { rig, report: censusOf(rig) };
}
/** The parent's main transcript rows: calls at the given offsets BEFORE the agent's first row (ms), each holding the ids. */
const calls = (tag: number, ...c: Array<{ before: number | null; ids: string[] }>): object[] =>
  callRows(tag, c.map((x) => ({ ms: x.before === null ? null : AGENT_T0 - x.before, ids: x.ids })));
const tau = (n: number): string => `toolu_${n}`;

describe('SA13 census partitions: the hand count (P11, P18)', () => {
  it('SA13 census partitions: one unit of each of R, P, Q, L, U, M, X, an imported unit and a gone row, and every count equals the hand count', async () => {
    const rig = await rigOf('ccrc-hist-sa13-');
    const { box } = rig;
    // PA: the parent whose main transcript is stored and wholly read, with no untimed row. Its calls: l1's and imp's launching calls.
    const pa = plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, mainRows: calls(0x3001, { before: 120_000, ids: ['toolu_L1'] }, { before: 90_000, ids: ['toolu_IMP'] }),
      agents: [
        agent('l1', 0x2101, { meta: { toolUseId: 'toolu_L1' } }),                       // L
        agent('u1', 0x2102, { meta: { toolUseId: 'toolu_U' } }),                        // U: no call names it, the window complete
        agent('x1', 0x2103, { meta: {} }),                                              // X: a meta read whole that names no link
        agent('imp', 0x2104, { atMs: -60_000, meta: { toolUseId: 'toolu_IMP' } }),      // imported pre-install, linked
      ],
    }, SINCE);
    // PM: the parent has no stored main transcript (M, parent-not-stored). PG: its subagent is stored, then deleted with its meta (G).
    plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(2), main: false, agents: [agent('m1', 0x2105, { meta: { toolUseId: 'toolu_M' } })] }, SINCE);
    const pg = plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(3), agents: [agent('g1', 0x2106, { meta: { toolUseId: 'toolu_G' } })] }, SINCE);
    // PP: an unknown parent, a pre-install file the import will not take (P).
    plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(4), parent: 'unknown', agents: [agent('p1', 0x2107, { atMs: -60_000, meta: { toolUseId: 'toolu_P' } })] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db), 'CONTROL: the tick ingested the post-install files of known parents only').toEqual(['g1', 'l1', 'm1', 'u1', 'x1']);
    const r = await whileClosed(rig, () => runShim(box, ['--op', 'import', '--agents', '--apply']));
    expect(r.code, r.stderr).toBe(0);
    expect(agentKeys(rig.db), 'CONTROL: the import took the pre-install file of the known parent, and not the unknown one\'s').toEqual(['g1', 'imp', 'l1', 'm1', 'u1', 'x1']);
    // G: the stored row's only holding and its meta are deleted
    fs.rmSync(pg.paths['g1']!); fs.rmSync(pg.paths['g1']!.replace(/\.jsonl$/, '.meta.json'));
    // R: a link named as a transcript, with its meta beside it. Q: a post-install file the store has not met, with its meta.
    const sub = path.dirname(pa.paths['l1']!);
    fs.writeFileSync(path.join(path.dirname(sub), 'real-r1'), 'x');   // the link's target lies outside subagents/, which the walk lists
    fs.symlinkSync(path.join(path.dirname(sub), 'real-r1'), path.join(sub, 'agent-r1.jsonl'));
    fs.writeFileSync(path.join(sub, 'agent-r1.meta.json'), JSON.stringify({ toolUseId: 'toolu_R' }));
    fs.writeFileSync(path.join(sub, 'agent-q1.jsonl'), fixtureRows(0x2108, 2).map((x) => `${JSON.stringify(x)}\n`).join(''));
    fs.utimesSync(path.join(sub, 'agent-q1.jsonl'), new Date(T0 + 60_000), new Date(T0 + 60_000));
    fs.writeFileSync(path.join(sub, 'agent-q1.meta.json'), JSON.stringify({ toolUseId: 'toolu_Q' }));
    // a meta with no transcript beside it, and a run directory's journal
    fs.writeFileSync(path.join(sub, 'agent-orph.meta.json'), JSON.stringify({ toolUseId: 'toolu_O' }));
    fs.mkdirSync(path.join(sub, 'workflows', RUN), { recursive: true });
    fs.writeFileSync(path.join(sub, 'workflows', RUN, 'journal.jsonl'), '{}\n');

    const c = censusOf(rig);
    expect(c.units).toMatchObject({ D: 8, R: 1, P: 1, Q: 1, Ad: 5, L: 2, U: 1, M: 1, X: 1, I: 1, G: { notFound: 1, unknown: 0 } });
    expect(c.reasons).toEqual({ 'parent-not-stored': 1 });
    expect(c.beside.agentMetaOrphan).toBe(1);
    // l1 u1 x1 imp m1 p1 q1 r1 and the orphan: nine metas listed (g1's was deleted); one journal
    expect(c.beside.companions).toEqual({ meta: 9, journal: 1 });
    expect(c.beside.agentFileRefused).toEqual({ link: 1 });
    expect(c.K).toEqual([]);
    expect(c.sums).toEqual({ ok: true, failed: [] });
    // the shares are ranges: D-T = R + Q + (Ad - I) = 6 units, one linked (l1), one unmeasured (m1); the imported unit is outside it
    expect(c.shares!['D-T']).toEqual({ lo: 1 / 6, hi: 2 / 6, den: 6 });
    expect(c.shares!['D']).toEqual({ lo: 2 / 8, hi: 3 / 8, den: 8 });
    expect(c.shares!['E']).toEqual({ lo: 2 / 6, hi: 3 / 6, den: 6 });
    expect(c.shares!['Ad']).toEqual({ lo: 2 / 5, hi: 3 / 5, den: 5 });
    expect(c.shares!['D-T']!.lo).toBeLessThanOrEqual(c.shares!['D-T']!.hi);
    expect(c.canonical).toEqual({ lo: 1 / 6, hi: 2 / 6 });
    expect(c.withheld).toEqual([]);
    // by kind: all eight are Agent-tool units, and no workflow file exists
    expect(c.byKind.agent).toEqual(c.units);
    expect(c.byKind.workflow.a).toMatchObject({ D: 0 });
    expect(c.beside.holdings, 'eight listed units, one holding each').toBe(8);
    expect(c.beside.physical).toBe(8);
  });
});

describe('SA2 Agent-tool link, bounded decode (P4)', () => {
  it('SA2 a tool_use that is the second block of a parent row whose tool_name names the first is linked', async () => {
    const { rig, report } = await one('ccrc-hist-sa2-second-', {
      meta: { toolUseId: tau(2) }, parentRows: calls(0x3101, { before: 60_000, ids: [tau(1), tau(2)] }),
    });
    expect(rig.db.prepare("SELECT tool_name AS n FROM entries WHERE type = 'assistant' AND tool_name IS NOT NULL").get()).toEqual({ n: 'Read' });   // CONTROL: the row's tool_name names the first block
    expect(report.units).toMatchObject({ Ad: 1, L: 1, U: 0, M: 0, X: 0 });
    expect(report.beside.lookups).toMatchObject({ agentTool: 1, decodes: 1 });
  });

  it('SA2 the id outside the 15-minute window is unresolved, never linked', async () => {
    // the call that names it is 16 minutes before the agent's first row, outside [t0 - 15 min, t0]; a decoy inside the window is decoded
    const { report } = await one('ccrc-hist-sa2-outside-', {
      meta: { toolUseId: tau(3) }, parentRows: calls(0x3102, { before: 16 * MIN, ids: [tau(3)] }, { before: 60_000, ids: [tau(4)] }),
    });
    expect(report.units).toMatchObject({ L: 0, U: 1, M: 0 });
    expect(report.beside.lookups.decodes, 'CONTROL: the decoy inside the window was decoded').toBe(1);
  });

  it('SA2 65 candidates and a match only in the 65th is unmeasured (decode-bound), never linked; a match in the 64th is linked', async () => {
    const many = (matchAt: number): object[] => callRows(0x3103 + matchAt, Array.from({ length: 65 }, (_, k) => ({ ms: AGENT_T0 - 1000 * (k + 1), ids: [k === matchAt ? 'toolu_target' : `toolu_x${k}`] })));
    // newest first: index 64 is the 65th candidate (the oldest)
    const late = await one('ccrc-hist-sa2-65th-', { meta: { toolUseId: 'toolu_target' }, parentRows: many(64), tag: 0x2201 });
    expect(late.report.units).toMatchObject({ L: 0, U: 0, M: 1 });
    expect(late.report.reasons).toEqual({ 'decode-bound': 1 });
    expect(late.report.beside.lookups.decodes, 'at most 64 decodes').toBe(64);
    const edge = await one('ccrc-hist-sa2-64th-', { meta: { toolUseId: 'toolu_target' }, parentRows: many(63), tag: 0x2202 });
    expect(edge.report.units, 'CONTROL: the 64th candidate is within the bound').toMatchObject({ L: 1, M: 0 });
  });

  it('SA2 a candidate body over blobOverDecodeCap is unmeasured (over-cap), never decoded', async () => {
    const { rig } = await one('ccrc-hist-sa2-overcap-', { meta: { toolUseId: tau(5) }, parentRows: calls(0x3104, { before: 60_000, ids: [tau(5)] }) });
    // a stored body cannot honestly be over the cap (a line that long is stored raw-only), so the blob's recorded length is raised
    rig.db.prepare("UPDATE blobs SET raw_len = 20000000 WHERE blob_id = (SELECT blob_id FROM entries WHERE type = 'assistant' AND tool_name IS NOT NULL)").run();
    const report = censusOf(rig);
    expect(report.units).toMatchObject({ L: 0, U: 0, M: 1 });
    expect(report.reasons).toEqual({ 'over-cap': 1 });
    expect(report.beside.lookups.decodes, 'CONTROL: nothing was decoded').toBe(0);
  });
});

describe('a candidate that cannot be decoded (P4)', () => {
  it('a pruned body (a tombstone) is unmeasured (undecodable), never unresolved', async () => {
    const { rig } = await one('ccrc-hist-sa2-tomb-', { meta: { toolUseId: tau(11) }, parentRows: calls(0x3107, { before: 60_000, ids: [tau(11)] }) });
    rig.db.prepare("UPDATE blobs SET z = NULL, pruned_ms = 1 WHERE blob_id = (SELECT blob_id FROM entries WHERE type = 'assistant' AND tool_name IS NOT NULL)").run();
    const report = censusOf(rig);
    expect(report.units).toMatchObject({ L: 0, U: 0, M: 1 });
    expect(report.reasons).toEqual({ undecodable: 1 });
  });
});

describe('the rest of the verdict table', () => {
  it('SA15 parent not stored: the subagent row is kept, the census says M parent-not-stored, never U', async () => {
    const { rig, report } = await one('ccrc-hist-sa15-', { meta: { toolUseId: tau(6) }, parentRows: false });
    expect(agentKeys(rig.db), 'CONTROL: the subagent row was stored').toEqual(['a']);
    expect(report.units).toMatchObject({ Ad: 1, L: 0, U: 0, M: 1 });
    expect(report.reasons).toEqual({ 'parent-not-stored': 1 });
  });

  it('a subagent with no timed row is M (no-timed-row), never U (failure row 19)', async () => {
    const { report } = await one('ccrc-hist-notimed-', { meta: { toolUseId: tau(7) }, agentRows: untimedRows(0x2301, 2), parentRows: calls(0x3105, { before: 60_000, ids: [tau(8)] }) });
    expect(report.units).toMatchObject({ Ad: 1, M: 1, U: 0 });
    expect(report.reasons).toEqual({ 'no-timed-row': 1 });
  });

  it('a parent stored from another home still resolves (Review Focus 3)', async () => {
    const rig = await rigOf('ccrc-hist-otherhome-');
    const [a, b] = rig.box.homes as [string, string];
    // the subagent lives in the first home's session directory; the parent's main transcript only in the second home's project
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, main: false, agents: [agent('a', 0x2401, { meta: { toolUseId: tau(9) } })] }, { ...SINCE, home: a });
    fs.mkdirSync(path.join(b, 'projects', SLUG), { recursive: true });
    fs.writeFileSync(path.join(b, 'projects', SLUG, `${PARENT}.jsonl`), calls(0x3106, { before: 60_000, ids: [tau(9)] }).map((x) => `${JSON.stringify(x)}\n`).join(''));
    await rig.tick(armed, { scan: true });
    expect(fs.existsSync(path.join(a, 'projects', SLUG, `${PARENT}.jsonl`)), 'CONTROL: the first home holds no main transcript').toBe(false);
    expect(rig.db.prepare("SELECT count(*) AS n FROM transcripts WHERE agent_id = ''").get()).toEqual({ n: 1 });
    expect(censusOf(rig).units.L).toBe(1);
  });

  it('SA4 run-id grammar: wf_bad is refused and counted agent_file_refused:run-id, a matching name is read', async () => {
    const rig = await rigOf('ccrc-hist-sa4-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [], runs: [{ id: 'wf_bad', agents: [agent('b', 0x2501)] }, { id: RUN, agents: [agent('g', 0x2502)] }] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db), 'the matching name is read, wf_bad\'s file never').toEqual([`${RUN}/g`]);
    const c = censusOf(rig);
    expect(c.beside.agentFileRefused).toEqual({ 'run-id': 1 });
    expect(c.units).toMatchObject({ D: 2, R: 1, Ad: 1 });
  });

  it('SA20 a name-refused run directory: a real wf_bad holding two agent files lists both as R (run-id), neither read', async () => {
    const rig = await rigOf('ccrc-hist-sa20-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [], runs: [{ id: 'wf_bad', agents: [agent('a', 0x2601), agent('b', 0x2602)] }] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db), 'neither file was read').toBe(0);
    const c = censusOf(rig);
    expect(c.units).toMatchObject({ D: 2, R: 2, P: 0, Q: 0, Ad: 0 });
    expect(c.beside.agentFileRefused).toEqual({ 'run-id': 2 });
    expect(c.K, 'the directory is real, so it is listed and not counted unentered').toEqual([]);
    expect(c.byKind.workflow.a).toMatchObject({ D: 2, R: 2 });
  });

  it('SA5 regular files only: a symlink, a FIFO and a directory named agent-x.jsonl are none read, each counted', { timeout: 10_000 }, async () => {
    const rig = await rigOf('ccrc-hist-sa5-');
    const kinds = ['link', 'fifo', 'dir'] as const;
    const fifo = { path: '' };
    kinds.forEach((kind, i) => {
      const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(10 + i), agents: [agent('seed', 0x2700 + i)] }, SINCE);
      const sub = path.dirname(paths['seed']!);
      fs.rmSync(paths['seed']!);
      const p = path.join(sub, 'agent-x.jsonl');
      if (kind === 'link') { fs.writeFileSync(path.join(path.dirname(sub), 'real'), '{}\n'); fs.symlinkSync(path.join(path.dirname(sub), 'real'), p); }
      else if (kind === 'fifo') { spawnSync('mkfifo', [p]); fs.utimesSync(p, new Date(T0 + 60_000), new Date(T0 + 60_000)); fifo.path = p; }
      else fs.mkdirSync(p);
    });
    // the install record is older than the FIFO's mtime, so the FIFO's unit would be Q once admitted
    await rig.tick(armed, { scan: true });
    expect(agentRows(rig.db), 'none read').toBe(0);
    const c = censusOf(rig);
    expect(c.beside.agentFileRefused).toEqual({ link: 1, 'not-regular': 2 });
    expect(c.units).toMatchObject({ D: 3, R: 3, Q: 0, Ad: 0 });
    expect(fs.statSync(fifo.path).isFIFO(), 'CONTROL: the FIFO is there').toBe(true);
  });

  it('SA6 meta bounded: an oversized and a malformed meta leave the row with a NULL link, and the census reads M (meta-unread:oversized, meta-unread:malformed)', async () => {
    const rig = await rigOf('ccrc-hist-sa6-');
    plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, mainRows: calls(0x3201, { before: 60_000, ids: [tau(10)] }),
      agents: [agent('o', 0x2801, { meta: 'oversized' }), agent('m', 0x2802, { meta: 'malformed' })],
    }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db), 'CONTROL: both transcripts were ingested').toEqual(['m', 'o']);
    expect(linkOf(rig.db, 'o')).toBeNull();
    expect(linkOf(rig.db, 'm')).toBeNull();
    expect(counterNames(rig.db).filter((n) => n.startsWith('agent_meta'))).toEqual(['agent_meta_unreadable:malformed', 'agent_meta_unreadable:oversized']);
    const c = censusOf(rig);
    expect(c.units).toMatchObject({ Ad: 2, L: 0, U: 0, M: 2, X: 0 });
    expect(c.reasons).toEqual({ 'meta-unread:oversized': 1, 'meta-unread:malformed': 1 });
    expect(counterNames(rig.db).filter((n) => n.startsWith('agent_file') || n.startsWith('agent_dir')), 'the census bumps no counter (D-8154)').toEqual([]);
  });

  it('Q of an unknown parent is reported apart, inside D minus T', async () => {
    const rig = await rigOf('ccrc-hist-qunknown-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('k', 0x2901)] }, SINCE);
    plantAgentTree(rig, { slug: SLUG, uuid: uuidOf(2), parent: 'unknown', agents: [agent('u', 0x2902)] }, SINCE);
    const r = censusOf(rig);   // no tick: both are pending
    expect(r.units).toMatchObject({ D: 2, Q: 2, Ad: 0 });
    expect(r.beside.qParentUnknown).toBe(1);
    expect(r.shares!['D-T']!.den, 'both are in D minus T: P11\'s denominator is unchanged').toBe(2);
    expect(r.sums.ok).toBe(true);
  });
});

// ── workflows (P12) ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The text a workflow's launching call returns (act M1, D-8161). */
const launched = (run: string): string => `Workflow launched in background. Task ID: t-1\nRun ID: ${run}`;

describe('SA14 workflow predicate (P12): (a), (b) and (c) side by side', () => {
  /** A run RUN with agents `ids` under a known parent whose main rows are `parentRows`; an armed tick; the census. `summary` plants the run's summary file. */
  async function wf(prefix: string, parentRows: object[] | undefined, o: { ids?: string[]; summary?: boolean; over?: Record<string, unknown> } = {}): Promise<{ rig: AgentRig; report: CensusReport }> {
    const rig = await rigOf(prefix);
    const ids = o.ids ?? ['x'];
    const { paths } = plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, agents: [], runs: [{ id: RUN, agents: ids.map((id, i) => agent(id, 0x4100 + i)) }],
      ...(parentRows === undefined ? {} : { mainRows: parentRows }),
    }, SINCE);
    if (o.summary === true) {
      const dir = path.join(path.dirname(path.dirname(path.dirname(path.dirname(paths[`${RUN}/${ids[0]}`]!)))), 'workflows');   // <session>/workflows/<run>.json
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${RUN}.json`), '{}');
    }
    await rig.tick(armed, { scan: true });
    return { rig, report: censusOf(rig, o.over ?? {}) };
  }
  const workflowUnits = (r: CensusReport, which: 'a' | 'b' | 'c') => r.byKind.workflow[which] as Exclude<CensusReport['byKind']['workflow']['a'], 'unavailable'>;

  it('under the shipped predicate (b) is computed and the canonical share is the D-T range when nothing is withheld', async () => {
    const { report } = await wf('ccrc-hist-sa14-b-', resultRows(0x4001, [{ ms: AGENT_T0 - 30_000, text: launched(RUN) }]));
    expect(workflowUnits(report, 'b')).toMatchObject({ D: 1, Ad: 1, L: 1, U: 0, M: 0 });
    expect(report.units).toMatchObject({ Ad: 1, L: 1 });
    expect(report.withheld).toEqual([]);
    expect(report.canonical).toEqual({ lo: 1, hi: 1 });
  });

  it('SA14 (a), (b), (c) each over a fixture where only that predicate holds: only that row counts it', async () => {
    // only (b) holds: the launch result names the run, there is no summary file
    const onlyB = await wf('ccrc-hist-sa14-onlyb-', resultRows(0x4002, [{ ms: AGENT_T0 - 30_000, text: launched(RUN) }]));
    expect([workflowUnits(onlyB.report, 'a').L, workflowUnits(onlyB.report, 'b').L, workflowUnits(onlyB.report, 'c').L]).toEqual([1, 1, 0]);
    expect(workflowUnits(onlyB.report, 'c').U).toBe(1);
    // only (c) holds: the run summary exists, no result names the run
    const onlyC = await wf('ccrc-hist-sa14-onlyc-', resultRows(0x4003, [{ ms: AGENT_T0 - 30_000, text: 'nothing about it' }]), { summary: true });
    expect([workflowUnits(onlyC.report, 'a').L, workflowUnits(onlyC.report, 'b').L, workflowUnits(onlyC.report, 'c').L]).toEqual([1, 0, 1]);
    expect(workflowUnits(onlyC.report, 'b').U).toBe(1);
    // only (a) holds: placement alone, which is true of every admitted file and measures nothing
    const onlyA = await wf('ccrc-hist-sa14-onlya-', resultRows(0x4004, [{ ms: AGENT_T0 - 30_000, text: 'nothing about it' }]));
    expect([workflowUnits(onlyA.report, 'a').L, workflowUnits(onlyA.report, 'b').L, workflowUnits(onlyA.report, 'c').L]).toEqual([1, 0, 0]);
    // CONTROL: the canonical verdict under (b) is the result's, not placement's
    expect([onlyB.report.units.L, onlyC.report.units.L, onlyA.report.units.L]).toEqual([1, 0, 0]);
  });

  it('SA14 (b): a tool_result naming the run inside the window is linked; the same row outside it is unresolved', async () => {
    const outside = await wf('ccrc-hist-sa14-outside-', resultRows(0x4005, [{ ms: AGENT_T0 + 20 * MIN, text: launched(RUN) }]));
    expect(outside.report.units).toMatchObject({ L: 0, U: 1, M: 0 });
    const edge = await wf('ccrc-hist-sa14-edge-', resultRows(0x4006, [{ ms: AGENT_T0 + 14 * MIN, text: launched(RUN) }]));
    expect(edge.report.units, 'CONTROL: 14 minutes after the run\'s first row is inside').toMatchObject({ L: 1, U: 0 });
  });

  it('SA14 (b): 65 candidates with the match last is unmeasured (decode-bound); the 64th is within the bound', async () => {
    // nearest the anchor first: the rows at +1 s, +2 s, ...; the match is the farthest
    const rows = (matchAt: number, tag: number): object[] => resultRows(tag, Array.from({ length: 65 }, (_, k) => ({ ms: AGENT_T0 + 1000 * (k + 1), text: k === matchAt ? launched(RUN) : `other ${k}` })));
    const late = await wf('ccrc-hist-sa14-65-', rows(64, 0x4007));
    expect(late.report.units).toMatchObject({ L: 0, U: 0, M: 1 });
    expect(late.report.reasons).toEqual({ 'decode-bound': 1 });
    expect(late.report.beside.lookups).toMatchObject({ workflow: 1, decodes: 64 });
    const edge = await wf('ccrc-hist-sa14-64-', rows(63, 0x4008));
    expect(edge.report.units, 'CONTROL').toMatchObject({ L: 1, M: 0 });
  });

  it('SA14 (b): a user row over the decode cap is unmeasured (over-cap)', async () => {
    const { rig } = await wf('ccrc-hist-sa14-overcap-', resultRows(0x4009, [{ ms: AGENT_T0 - 30_000, text: launched(RUN) }]));
    rig.db.prepare("UPDATE blobs SET raw_len = 20000000 WHERE blob_id IN (SELECT e.blob_id FROM entries e JOIN transcripts t ON t.transcript_pk = e.transcript_pk WHERE t.agent_id = '')").run();
    const report = censusOf(rig);
    expect(report.units).toMatchObject({ L: 0, U: 0, M: 1 });
    expect(report.reasons).toEqual({ 'over-cap': 1 });
  });

  it('SA14 (b): two agents of one run share one lookup', async () => {
    const { report } = await wf('ccrc-hist-sa14-two-', resultRows(0x400a, [{ ms: AGENT_T0 - 30_000, text: launched(RUN) }]), { ids: ['x', 'y'] });
    expect(report.units).toMatchObject({ D: 2, Ad: 2, L: 2 });
    expect(report.beside.lookups).toMatchObject({ workflow: 1, agentTool: 0 });
  });

  it('the run id is a whole token: a longer id that begins with it, and a word that ends with it, do not name the run; a text item does', async () => {
    const longer = await wf('ccrc-hist-sa14-longer-', resultRows(0x400b, [{ ms: AGENT_T0 - 30_000, text: launched(`${RUN}f`) }, { ms: AGENT_T0 - 20_000, text: `x${RUN}` }, { ms: AGENT_T0 - 10_000, text: `${RUN}-` }]));
    expect(longer.report.units).toMatchObject({ L: 0, U: 1 });
    const items = await wf('ccrc-hist-sa14-items-', resultRows(0x400c, [{ ms: AGENT_T0 - 30_000, text: `${launched(RUN)}\n`, items: true }]));
    expect(items.report.units, 'CONTROL: a tool_result whose content is text items, the run id ended by a line break').toMatchObject({ L: 1 });
  });

  it('a settled predicate with no run window measures none and guesses none: the lookup is not run, M (no-run-window)', async () => {
    const { report } = await wf('ccrc-hist-sa14-nowindow-', resultRows(0x400e, [{ ms: AGENT_T0 - 30_000, text: launched(RUN) }]), { over: { runWindow: null } });
    expect(report.units, 'CONTROL (the row above names the run inside the window it would have guessed)').toMatchObject({ L: 0, U: 0, M: 1 });
    expect(report.reasons).toEqual({ 'no-run-window': 1 });
    expect(report.beside.lookups).toMatchObject({ workflow: 0, decodes: 0 });
  });

  it('with no predicate settled (a direct call), (b) is unavailable, no canonical share exists, and the workflow unit is M for the range', async () => {
    const { report } = await wf('ccrc-hist-sa14-null-', resultRows(0x400d, [{ ms: AGENT_T0 - 30_000, text: launched(RUN) }]), { over: { predicate: null, runWindow: null } });
    expect(report.byKind.workflow.b).toBe('unavailable');
    expect(workflowUnits(report, 'a')).toMatchObject({ L: 1 });
    expect(report.canonical).toBeNull();
    expect(report.units).toMatchObject({ Ad: 1, L: 0, M: 1 });
    expect(report.reasons).toEqual({ 'predicate-unsettled': 1 });
    expect(report.sums.ok).toBe(true);
  });
});

// ── the pre-install, unentered and held-twice populations ───────────────────────────────────────────────────────────────

describe('SA18 pre-install (P6): P, then Q and admitted, then imported', () => {
  it('SA18 a pre-install file is P and outside D-T; touched after the record it is Q, then admitted; imported it is Ad and I, still outside D-T', async () => {
    const rig = await rigOf('ccrc-hist-sa18-');
    const { paths } = plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, mainRows: calls(0x3301, { before: 60_000, ids: ['toolu_ctrl'] }, { before: 50_000, ids: ['toolu_pre'] }, { before: 40_000, ids: ['toolu_imp'] }),
      agents: [agent('ctrl', 0x4201, { meta: { toolUseId: 'toolu_ctrl' } }), agent('pre', 0x4202, { atMs: -60_000, meta: { toolUseId: 'toolu_pre' } }), agent('imp', 0x4203, { atMs: -60_000, meta: { toolUseId: 'toolu_imp' } })],
    }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(agentKeys(rig.db), 'never ingested by a tick').toEqual(['ctrl']);
    let c = censusOf(rig);
    expect(c.units).toMatchObject({ D: 3, P: 2, Q: 0, R: 0, Ad: 1, I: 0 });
    expect(c.beside.agentFileRefused, 'never refused').toEqual({});
    expect(c.shares!['D-T']!.den, 'outside D - T').toBe(1);
    expect(c.shares!['D']!.den).toBe(3);
    // touched at the record: post-install (an mtime equal to it is), so Q, and in D - T
    fs.utimesSync(paths['pre']!, new Date(T0), new Date(T0));
    c = censusOf(rig);
    expect(c.units).toMatchObject({ D: 3, P: 1, Q: 1, Ad: 1 });
    expect(c.shares!['D-T']!.den).toBe(2);
    await rig.tick(armed, { scan: true });
    c = censusOf(rig);
    expect(c.units).toMatchObject({ D: 3, P: 1, Q: 0, Ad: 2, I: 0 });
    // the operator's import takes the other pre-install file: Ad and I, out of P, still outside D - T
    const r = await whileClosed(rig, () => runShim(rig.box, ['--op', 'import', '--agents', '--apply']));
    expect(r.code, r.stderr).toBe(0);
    c = censusOf(rig);
    expect(c.units).toMatchObject({ D: 3, P: 0, Q: 0, Ad: 3, I: 1, L: 3 });
    expect(c.shares!['D-T']!.den, 'the imported unit is outside D - T').toBe(2);
    expect(c.shares!['D']!.den).toBe(3);
    expect(c.shares!['E']!.den).toBe(3);
    expect(c.sums.ok).toBe(true);
  });
});

describe('SA19 unentered directories, every level (K)', () => {
  const isRoot = process.getuid?.() === 0;
  /** A control unit that an unentered directory must not let a share print over, then `arrange` in the second home / second session. */
  async function withK(prefix: string, arrange: (rig: AgentRig, ctx: { sess: string; proj: string; lane: string }) => void): Promise<{ rig: AgentRig; report: CensusReport }> {
    const rig = await rigOf(prefix);
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('c', 0x4301, { meta: {} })] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(censusOf(rig).shares, 'CONTROL: a share prints while nothing is unentered').not.toBeNull();
    const lane = rig.box.homes[1]!;
    const proj = path.join(rig.box.homes[0]!, 'projects', SLUG);
    arrange(rig, { sess: path.join(proj, uuidOf(2)), proj, lane });
    return { rig, report: censusOf(rig) };
  }
  const expectK = (r: CensusReport, level: string, reason: string): void => {
    expect(r.K).toEqual([{ level, reason, n: 1 }]);
    expect(r.shares, 'no share is drawn from a tree that holds one').toBeNull();
    expect(r.canonical).toBeNull();
    expect(r.withheld).toEqual(['K']);
    expect(r.units, 'their files are unknown, never counted as 0 or as units').toMatchObject({ D: 1, Ad: 1 });
  };

  it('SA19 subagents a link', async () => {
    const { report } = await withK('ccrc-hist-sa19-sublink-', (rig, { sess }) => {
      fs.mkdirSync(path.join(rig.box.home, 'elsewhere', 'sub'), { recursive: true });
      fs.mkdirSync(sess, { recursive: true });
      fs.symlinkSync(path.join(rig.box.home, 'elsewhere', 'sub'), path.join(sess, 'subagents'));
    });
    expectK(report, 'subagents', 'link');
  });

  it('SA19 a workflows/<run> that is a regular file', async () => {
    const { report } = await withK('ccrc-hist-sa19-runfile-', (_rig, { sess }) => {
      fs.mkdirSync(path.join(sess, 'subagents', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(sess, 'subagents', 'workflows', RUN), 'x');
    });
    expectK(report, 'run', 'not-dir');
  });

  it.skipIf(isRoot)('SA19 a subagents/ that cannot be listed (mode 000, skipped as root)', async () => {
    let dir = '';
    try {
      const { report } = await withK('ccrc-hist-sa19-sub000-', (_rig, { sess }) => {
        dir = path.join(sess, 'subagents');
        fs.mkdirSync(dir, { recursive: true });
        fs.chmodSync(dir, 0);
      });
      expectK(report, 'subagents', 'unlistable');
    } finally { if (dir !== '') fs.chmodSync(dir, 0o755); }
  });

  it('SA19 a projects root that is a link', async () => {
    const { report } = await withK('ccrc-hist-sa19-rootlink-', (rig, { lane }) => {
      fs.rmSync(path.join(lane, 'projects'), { recursive: true });
      fs.mkdirSync(path.join(rig.box.home, 'elsewhere', 'projects'), { recursive: true });
      fs.symlinkSync(path.join(rig.box.home, 'elsewhere', 'projects'), path.join(lane, 'projects'));
    });
    expectK(report, 'root', 'link');
  });

  it.skipIf(isRoot)('SA19 a project directory that cannot be listed (mode 000, skipped as root)', async () => {
    let dir = '';
    try {
      const { report } = await withK('ccrc-hist-sa19-proj000-', (_rig, { lane }) => {
        dir = path.join(lane, 'projects', '-home-u-closed');
        fs.mkdirSync(dir, { recursive: true });
        fs.chmodSync(dir, 0);
      });
      expectK(report, 'project', 'unlistable');
    } finally { if (dir !== '') fs.chmodSync(dir, 0o755); }
  });

  it('SA19 a session directory that is a link', async () => {
    const { report } = await withK('ccrc-hist-sa19-sesslink-', (rig, { sess }) => {
      fs.mkdirSync(path.join(rig.box.home, 'elsewhere', 'sess'), { recursive: true });
      fs.symlinkSync(path.join(rig.box.home, 'elsewhere', 'sess'), sess);
    });
    expectK(report, 'session', 'link');
  });

  it('SA19 a session-id entry that is a regular file', async () => {
    const { report } = await withK('ccrc-hist-sa19-sessfile-', (_rig, { sess }) => { fs.writeFileSync(sess, 'x'); });
    expectK(report, 'session', 'not-dir');
  });

  it('SA19 a linked project directory whose session holds subagents/agent-x.jsonl: K gains project/link, agent-x is no unit and is never read, the main transcript is still listed (review 1728 F4)', async () => {
    const x = uuidOf(3);
    let target = '';
    const { rig, report } = await withK('ccrc-hist-sa19-projlink-', (rig2, { proj }) => {
      target = path.join(rig2.box.home, 'elsewhere', 'real-proj');
      fs.mkdirSync(path.join(target, x, 'subagents'), { recursive: true });
      fs.writeFileSync(path.join(target, `${x}.jsonl`), fixtureRows(0x4302, 1).map((r) => `${JSON.stringify(r)}\n`).join(''));
      fs.writeFileSync(path.join(target, x, 'subagents', 'agent-x.jsonl'), fixtureRows(0x4303, 1).map((r) => `${JSON.stringify(r)}\n`).join(''));
      fs.symlinkSync(target, path.join(path.dirname(proj), '-home-u-linked'));
    });
    expectK(report, 'project', 'link');
    const { opens } = recordOpenFlags(() => censusOf(rig));
    expect(opens.map((o) => o.path).filter((p) => p.includes('agent-x'))).toEqual([]);
    expect(discoverTranscripts(rig.box.homes, [x]).map((t: { uuid: string }) => t.uuid), 'main lists through the link, as it always did').toEqual([x]);
  });
});

describe('SA21 the census\'s unit (P18 (a)): one unit per key, however many holdings', () => {
  async function held(prefix: string, how: Array<'link' | 'copy'>): Promise<CensusReport> {
    const rig = await rigOf(prefix);
    const [a, b] = rig.box.homes as [string, string];
    const ids = how.map((_, i) => `h${i}`);
    const { paths } = plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, mainRows: calls(0x3401, ...ids.map((id, i) => ({ before: 60_000 + i * 1000, ids: [`toolu_${id}`] }))),
      agents: ids.map((id, i) => agent(id, 0x4400 + i, { meta: { toolUseId: `toolu_${id}` } })),
    }, SINCE);
    await rig.tick(armed, { scan: true });
    how.forEach((h, i) => holdAgainIn(paths[ids[i]!]!, a, b, h));
    await rig.tick(armed, { scan: true });
    return censusOf(rig);
  }

  it('SA21 a hardlink held by two homes and a copy held by two homes: one unit each, holdings 2 and physical files 1 and 2', async () => {
    const link = await held('ccrc-hist-sa21-link-', ['link']);
    expect(link.units).toMatchObject({ D: 1, Ad: 1, L: 1 });
    expect([link.beside.holdings, link.beside.physical]).toEqual([2, 1]);
    const copy = await held('ccrc-hist-sa21-copy-', ['copy']);
    expect(copy.units).toMatchObject({ D: 1, Ad: 1, L: 1 });
    expect([copy.beside.holdings, copy.beside.physical]).toEqual([2, 2]);
    const both = await held('ccrc-hist-sa21-both-', ['link', 'copy']);
    expect(both.units, 'CONTROL: counting each listed path as a unit would make four').toMatchObject({ D: 2, Ad: 2, L: 2 });
    expect([both.beside.holdings, both.beside.physical]).toEqual([4, 3]);
    expect(both.beside.holdingUnbound).toEqual({ unread: 0, unreadable: 0, replaced: 0, shrunk: 0 });
    expect(both.sums.ok).toBe(true);
  });
});

describe('what the store keeps of a key held more than once', () => {
  /** Agent `a` in the first home with `n` rows, ingested; then `then` runs. */
  async function twice(prefix: string, o: { n?: number; meta?: AgentSpec['meta']; links?: string[] } = {}): Promise<{ rig: AgentRig; first: string; a: string; b: string }> {
    const rig = await rigOf(prefix);
    const [a, b] = rig.box.homes as [string, string];
    const { paths } = plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, mainRows: calls(0x3501, ...(o.links ?? ['toolu_1', 'toolu_2']).map((id, i) => ({ before: 60_000 + i * 1000, ids: [id] }))),
      agents: [agent('a', 0x4501, { n: o.n ?? 3, ...(o.meta === undefined ? { meta: { toolUseId: 'toolu_1' } } : { meta: o.meta }) })],
    }, SINCE);
    await rig.tick(armed, { scan: true });
    return { rig, first: paths['a']!, a, b };
  }

  it('SA26 growing copies: a copy, then three rows appended in place to the source: the three stored once, the union of both holdings, no variant, shape prefix', async () => {
    const { rig, first, a, b } = await twice('ccrc-hist-sa26-');
    holdAgainIn(first, a, b, 'copy');
    await rig.tick(armed, { scan: true });
    fs.appendFileSync(first, fixtureRows(0x4502, 3).map((r) => `${JSON.stringify(r)}\n`).join(''));
    await rig.tick(armed, { scan: true });
    expect(transcriptRows(rig.db, 'a')).toBe(1);
    expect(membershipsPerEntry(rig.db, 'a'), 'six entries, the first three held by both').toEqual([2, 2, 2, 1, 1, 1]);
    expect(variantsOf(rig.db, 'a')).toBe(0);
    const c = censusOf(rig);
    expect(c.beside.shapes).toMatchObject({ prefix: 1, identical: 0, fork: 0, disjoint: 0 });
    expect(c.beside.identityCollision).toBe(0);
    expect(c.shares, 'growth withholds nothing').not.toBeNull();
    expect(c.units).toMatchObject({ D: 1, Ad: 1 });
  });

  it('SA29 disjoint holdings: two holdings of one key with rows and none in common are identity_collision, and no share prints', async () => {
    const { rig, a, b } = await twice('ccrc-hist-sa29-');
    // another file of the same key in the second home: other rows under the same session and agent id
    const dir = path.join(b, 'projects', SLUG, PARENT, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent-a.jsonl'), fixtureRows(0x4503, 3).map((r) => `${JSON.stringify(r)}\n`).join(''));
    fs.writeFileSync(path.join(dir, 'agent-a.meta.json'), JSON.stringify({ toolUseId: 'toolu_1' }));
    fs.utimesSync(path.join(dir, 'agent-a.jsonl'), new Date(T0 + 60_000), new Date(T0 + 60_000));
    await rig.tick(armed, { scan: true });
    expect(transcriptRows(rig.db, 'a'), 'CONTROL: both files are the one key\'s').toBe(1);
    expect(a).not.toBe(b);
    const c = censusOf(rig);
    expect(c.beside.shapes).toMatchObject({ disjoint: 1 });
    expect(c.beside.identityCollision).toBe(1);
    expect(c.shares).toBeNull();
    expect(c.withheld).toEqual(['identity_collision']);
    expect(c.canonical).toBeNull();
    expect(c.units, 'one unit, not a collision of units').toMatchObject({ D: 1, Ad: 1 });
  });

  it('SA29 CONTROL: identical copies are not a collision and the share prints', async () => {
    const { rig, first, a, b } = await twice('ccrc-hist-sa29-copy-');
    holdAgainIn(first, a, b, 'copy');
    await rig.tick(armed, { scan: true });
    const c = censusOf(rig);
    expect(c.beside.shapes).toMatchObject({ identical: 1, disjoint: 0 });
    expect(c.shares).not.toBeNull();
    expect(c.withheld).toEqual([]);
  });

  describe('SA28 a key\'s meta evidence (P17 (c))', () => {
    const verdictOf = (c: CensusReport): string => (['L', 'U', 'M', 'X'] as const).filter((k) => c.units[k] === 1).join('');
    const isRoot = process.getuid?.() === 0;

    it('SA28 metas naming different links: the row keeps the first, the census says M (meta-conflict), never L', async () => {
      const { rig, first, a, b } = await twice('ccrc-hist-sa28-conflict-');
      holdAgainIn(first, a, b, 'copy', { toolUseId: 'toolu_2' });
      await rig.tick(armed, { scan: true });
      expect(linkOf(rig.db, 'a')).toBe('toolu_1');
      expect(counterOf(rig.db, 'agent_meta_conflict')).toBe(1);
      const c = censusOf(rig);
      expect(verdictOf(c)).toBe('M');
      expect(c.reasons).toEqual({ 'meta-conflict': 1 });
    });

    it('SA28 from X: one holding whose meta names no link is X; a second holding whose meta is absent moves it to M (meta-unread:absent)', async () => {
      const { rig, first, a, b } = await twice('ccrc-hist-sa28-x-', { meta: {} });
      expect(verdictOf(censusOf(rig))).toBe('X');
      holdAgainIn(first, a, b, 'copy', 'absent');
      await rig.tick(armed, { scan: true });
      const c = censusOf(rig);
      expect(verdictOf(c), 'a copy whose meta is missing widens the range: (c)\'s disclosed consequence').toBe('M');
      expect(c.reasons).toEqual({ 'meta-unread:absent': 1 });
    });

    it.each([['oversized'], ['malformed']] as const)('SA28 one holding whose meta is %s is M (meta-unread:<cause>); a second holding that names a link leaves it M', async (cause) => {
      const { rig, first, a, b } = await twice(`ccrc-hist-sa28-${cause}-`, { meta: cause });
      let c = censusOf(rig);
      expect(verdictOf(c)).toBe('M');
      expect(c.reasons).toEqual({ [`meta-unread:${cause}`]: 1 });
      holdAgainIn(first, a, b, 'copy', { toolUseId: 'toolu_1' });
      await rig.tick(armed, { scan: true });
      c = censusOf(rig);
      expect(linkOf(rig.db, 'a'), 'the second holding\'s link was written').toBe('toolu_1');
      expect(verdictOf(c)).toBe('M');
      expect(c.reasons).toEqual({ [`meta-unread:${cause}`]: 1 });
    });

    it('SA28 a meta that is a directory is M (meta-unread:not-regular)', async () => {
      const rig = await rigOf('ccrc-hist-sa28-notreg-');
      const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3502, { before: 60_000, ids: ['toolu_1'] }), agents: [agent('a', 0x4504, { meta: 'absent' })] }, SINCE);
      fs.mkdirSync(paths['a']!.replace(/\.jsonl$/, '.meta.json'));
      await rig.tick(armed, { scan: true });
      const c = censusOf(rig);
      expect(c.reasons).toEqual({ 'meta-unread:not-regular': 1 });
    });

    it.skipIf(isRoot)('SA28 a meta that cannot be opened is M (meta-unread:unreadable), skipped as root', async () => {
      const rig = await rigOf('ccrc-hist-sa28-unreadable-');
      const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3503, { before: 60_000, ids: ['toolu_1'] }), agents: [agent('a', 0x4505, { meta: { toolUseId: 'toolu_1' } })] }, SINCE);
      fs.chmodSync(paths['a']!.replace(/\.jsonl$/, '.meta.json'), 0);
      await rig.tick(armed, { scan: true });
      expect(censusOf(rig).reasons).toEqual({ 'meta-unread:unreadable': 1 });
    });

    it('SA28 a meta changed after its link was stored is M (meta-conflict)', async () => {
      const { rig, first } = await twice('ccrc-hist-sa28-changed-');
      expect(verdictOf(censusOf(rig)), 'CONTROL: unchanged, it is linked').toBe('L');
      fs.writeFileSync(first.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ toolUseId: 'toolu_2' }));
      const c = censusOf(rig);
      expect(verdictOf(c)).toBe('M');
      expect(c.reasons).toEqual({ 'meta-conflict': 1 });
    });
  });
});

describe('SA30 unbound holdings (P18 (a)): the lower end widens and the upper end does not', () => {
  const isRoot = process.getuid?.() === 0;
  it.skipIf(isRoot)('SA30 four keys with a bound holding each: three have a second that is unread, unreadable or replaced, one only grew', async () => {
    const rig = await rigOf('ccrc-hist-sa30-');
    const [a, b] = rig.box.homes as [string, string];
    const ids = ['k1', 'k2', 'k3', 'k4'];
    const { paths } = plantAgentTree(rig, {
      slug: SLUG, uuid: PARENT, mainRows: calls(0x3601, ...ids.map((id, i) => ({ before: 60_000 + i * 1000, ids: [`toolu_${id}`] }))),
      agents: ids.map((id, i) => agent(id, 0x4600 + i, { meta: { toolUseId: `toolu_${id}` } })),
    }, SINCE);
    await rig.tick(armed, { scan: true });
    // k3's second holding is read, then replaced by another inode at the same path
    const replaced = holdAgainIn(paths['k3']!, a, b, 'copy');
    await rig.tick(armed, { scan: true });
    // the new file exists before the old one goes, and the old inode is kept by a link outside the tree, so no later file takes its
    // number (a recycled number reads as replaced too, which is not the case this one pins)
    fs.linkSync(replaced, path.join(rig.box.home, 'keep-k3'));
    fs.copyFileSync(paths['k3']!, `${replaced}.new`);
    fs.renameSync(`${replaced}.new`, replaced);
    // k1's is not yet read; k2's cannot be opened; k4 only grew since its read
    holdAgainIn(paths['k1']!, a, b, 'copy');
    fs.chmodSync(holdAgainIn(paths['k2']!, a, b, 'copy'), 0);
    fs.appendFileSync(paths['k4']!, fixtureRows(0x4610, 2).map((r) => `${JSON.stringify(r)}\n`).join(''));
    const c = censusOf(rig);
    expect(c.beside.holdingUnbound).toEqual({ unread: 1, unreadable: 1, replaced: 1, shrunk: 0 });
    expect(c.units).toMatchObject({ D: 4, Ad: 4, L: 4 });
    // three extra units at the lower end, none at the upper: 4 / (4 + 3) to 4 / 4
    expect(c.shares!['D-T']!.lo).toBeCloseTo(4 / 7, 12);
    expect(c.shares!['D-T']!.hi).toBe(1);
    expect(c.shares!['D-T']!.den).toBe(4);
  });

  it('SA30 a holding that shrank below its cursor is unbound (shrunk)', async () => {
    const rig = await rigOf('ccrc-hist-sa30-shrunk-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3602, { before: 60_000, ids: ['toolu_k1'] }), agents: [agent('k1', 0x4620, { n: 3, meta: { toolUseId: 'toolu_k1' } })] }, SINCE);
    await rig.tick(armed, { scan: true });
    expect(censusOf(rig).beside.holdingUnbound.shrunk, 'CONTROL').toBe(0);
    fs.truncateSync(paths['k1']!, 10);
    const c = censusOf(rig);
    expect(c.beside.holdingUnbound).toEqual({ unread: 0, unreadable: 0, replaced: 0, shrunk: 1 });
  });
});

describe('SA31 precedence: nothing counted twice (P18)', () => {
  it('SA31 a stored row whose only holding is replaced by a link is Ad once, refused_since_stored 1, and both sums hold', async () => {
    const rig = await rigOf('ccrc-hist-sa31-');
    const { paths } = plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3701, { before: 60_000, ids: ['toolu_1'] }), agents: [agent('a', 0x4701, { meta: { toolUseId: 'toolu_1' } })] }, SINCE);
    await rig.tick(armed, { scan: true });
    const moved = path.join(path.dirname(path.dirname(paths['a']!)), 'moved-a');   // outside subagents/, which the walk lists
    fs.renameSync(paths['a']!, moved);
    fs.symlinkSync(moved, paths['a']!);
    const c = censusOf(rig);
    expect(c.units, 'counted exactly once, as admitted').toMatchObject({ D: 1, R: 0, P: 0, Q: 0, Ad: 1, L: 1, G: { notFound: 0, unknown: 0 } });
    expect(c.beside.refusedSinceStored).toBe(1);
    expect(c.beside.agentFileRefused).toEqual({ link: 1 });
    expect(c.sums).toEqual({ ok: true, failed: [] });
    expect(c.shares).not.toBeNull();
  });
});

describe('SA33 a parent\'s window (P19 (b)): M by cause, never U; read past the window, U', () => {
  type Kind = 'agent' | 'workflow';
  /** The decoy rows of a kind: rows that name nothing the unit links to, timed `at` ms from the unit's first row. */
  const decoy = (kind: Kind, tag: number, at: number[]): object[] => (kind === 'agent'
    ? callRows(tag, at.map((ms, i) => ({ ms: AGENT_T0 + ms, ids: [`toolu_decoy${tag}_${i}`] })))
    : resultRows(tag, at.map((ms, i) => ({ ms: AGENT_T0 + ms, text: `other ${tag}.${i}` }))));
  /** Row times: inside the window, and just past its end (the agent's window ends at t0, a workflow's 15 minutes after it). */
  const IN = (kind: Kind): number => (kind === 'agent' ? -5 * MIN : -2 * MIN);
  const IN2 = (kind: Kind): number => (kind === 'agent' ? -2 * MIN : 2 * MIN);
  const PAST = (kind: Kind): number => (kind === 'agent' ? 5 * MIN : 20 * MIN);
  async function parentOf(prefix: string, kind: Kind, rows: object[]): Promise<{ rig: AgentRig; main: string }> {
    const rig = await rigOf(prefix);
    const a = agent(kind === 'agent' ? 'a' : 'x', 0x4800 + (kind === 'agent' ? 0 : 1), kind === 'agent' ? { meta: { toolUseId: 'toolu_Z' } } : {});
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: rows, ...(kind === 'agent' ? { agents: [a] } : { agents: [], runs: [{ id: RUN, agents: [a] }] }) }, SINCE);
    await rig.tick(armed, { scan: true });
    return { rig, main: path.join(rig.box.homes[0]!, 'projects', SLUG, `${PARENT}.jsonl`) };
  }
  const lines = (rows: object[]): string => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

  it.each([['agent'], ['workflow']] as const)('SA33 %s: a parent read only to before the window\'s end is M (parent-behind); read past it, U', async (kind) => {
    const { rig, main } = await parentOf(`ccrc-hist-sa33-behind-${kind}-`, kind, decoy(kind, 0x5001, [IN(kind)]));
    expect(censusOf(rig).units, 'CONTROL: the parent read to its end, no match').toMatchObject({ U: 1, M: 0 });
    // two rows appended: one inside the window, one past its end; a tick that reads one line stores the first only
    fs.appendFileSync(main, lines([...decoy(kind, 0x5002, [IN2(kind)]), ...decoy(kind, 0x5003, [PAST(kind)])]));
    await rig.tick(armed, { scan: true, budget: { chunkBytes: 1, maxBytes: 1 } });
    let c = censusOf(rig);
    expect(c.units).toMatchObject({ U: 0, M: 1 });
    expect(c.reasons).toEqual({ 'parent-behind': 1 });
    await rig.tick(armed, { scan: true });
    c = censusOf(rig);
    expect(c.units, 'the same parent read past the window\'s end').toMatchObject({ U: 1, M: 0 });
  });

  it.each([['agent'], ['workflow']] as const)('SA33 %s: a parent with a second holding not yet bound is M (parent-copy-unbound); bound, U', async (kind) => {
    const { rig, main } = await parentOf(`ccrc-hist-sa33-unbound-${kind}-`, kind, decoy(kind, 0x5004, [IN(kind)]));
    expect(censusOf(rig).units.U, 'CONTROL').toBe(1);
    holdAgainIn(main, rig.box.homes[0]!, rig.box.homes[1]!, 'copy');
    let c = censusOf(rig);
    expect(c.units).toMatchObject({ U: 0, M: 1 });
    expect(c.reasons).toEqual({ 'parent-copy-unbound': 1 });
    await rig.tick(armed, { scan: true });
    c = censusOf(rig);
    expect(c.units).toMatchObject({ U: 1, M: 0 });
  });

  it.each([['agent'], ['workflow']] as const)('SA33 %s: a parent whose only candidate row has a NULL ts_ms and no match is M (parent-untimed)', async (kind) => {
    const rows = kind === 'agent' ? callRows(0x5005, [{ ms: null, ids: ['toolu_other'] }]) : resultRows(0x5005, [{ ms: null, text: 'other' }]);
    const { rig } = await parentOf(`ccrc-hist-sa33-untimed-${kind}-`, kind, rows);
    const c = censusOf(rig);
    expect(c.units).toMatchObject({ U: 0, M: 1 });
    expect(c.reasons).toEqual({ 'parent-untimed': 1 });
  });

  it.each([['agent'], ['workflow']] as const)('SA33 %s: an untimed row is decoded within the bound, so one that names the unit still links it', async (kind) => {
    const rows = kind === 'agent' ? callRows(0x5006, [{ ms: null, ids: ['toolu_Z'] }]) : resultRows(0x5006, [{ ms: null, text: launched(RUN) }]);
    const { rig } = await parentOf(`ccrc-hist-sa33-untimed-hit-${kind}-`, kind, rows);
    expect(censusOf(rig).units).toMatchObject({ L: 1, M: 0 });
  });
});

// ── the install record, the physical files, the text ──────────────────────────────────────────────────────────────────

describe('what the report says of its own inputs', () => {
  it('the install record is reported: its milliseconds, absent, or damaged; with none, every admitted unit reads as imported, as isPreInstall reads a file', async () => {
    const rig = await rigOf('ccrc-hist-record-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3901, { before: 60_000, ids: ['toolu_1'] }), agents: [agent('a', 0x4901, { meta: { toolUseId: 'toolu_1' } })] }, SINCE);
    await rig.tick(armed, { scan: true });
    let c = censusOf(rig);
    expect([c.beside.installRecord, c.units.I]).toEqual([T0, 0]);
    rig.db.prepare("DELETE FROM meta WHERE k = 'agents_since_ms'").run();
    c = censusOf(rig);
    expect([c.beside.installRecord, c.units.I], 'no record: absent, and the unit reads as pre-install').toEqual(['absent', 1]);
    rig.db.prepare("INSERT INTO meta (k, v) VALUES ('agents_since_ms', 'abc')").run();
    c = censusOf(rig);
    expect([c.beside.installRecord, c.units.I], 'a damaged record reads as none, and the report says it is damaged').toEqual(['damaged', 1]);
    expect(formatCensus(c as never).join('\n')).toContain('install record damaged');
  });

  it('a holding whose lstat failed is counted apart (physicalUnmeasured), never as one file with the others', async () => {
    // a hand-made walk: two entries with no identity and one measured; the census reads the store only for the rows it finds
    const rig = await rigOf('ccrc-hist-physical-');
    const entry = (id: string, ident: { dev: bigint | null; ino: bigint | null }) => ({
      type: 'file', home: '/h', slug: 's', uuid: PARENT, runId: null, id, path: `/h/projects/s/${PARENT}/subagents/agent-${id}.jsonl`,
      verdict: 'refuse', reason: 'not-regular', mtimeMs: 0, size: 0, ...ident,
    });
    const walk = { main: [], agents: [entry('x', { dev: null, ino: null }), entry('y', { dev: null, ino: null }), entry('z', { dev: 1n, ino: 5n })] };
    const c = runCensus(rig.db, walk, { readMeta: () => ({ ok: false, cause: 'absent' }), predicate: 'b', runWindow: 'immediate' }) as unknown as CensusReport;
    expect(c.beside).toMatchObject({ holdings: 3, physical: 1, physicalUnmeasured: 2 });
  });

  it('the canonical line says why there is none: an unsettled predicate, or no unit in the D-T denominator', async () => {
    const rig = await rigOf('ccrc-hist-canon-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('p', 0x4902, { atMs: -60_000 })] }, SINCE);   // pre-install, never ingested: P, outside D-T
    const settled = censusOf(rig);
    expect(settled.units).toMatchObject({ D: 1, P: 1 });
    expect(settled.shares!['D-T'], 'no D-T share: nothing is in its denominator').toBeUndefined();
    expect(formatCensus(settled as never)).toContain('census canonical: none (no unit is in the D-T denominator)');
    const unsettled = censusOf(rig, { predicate: null, runWindow: null });
    expect(formatCensus(unsettled as never)).toContain('census canonical: none (the workflow predicate is not settled)');
  });
});

// ── the verb (P16 (a)) ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('SA23 the census verb writes nothing and answers lib\'s exits', () => {
  /** The store's bytes (sha256), mtime and user_version, and every other entry under ~/.ccrc (names, sizes and mtimes), as "writes
   *  nothing" is measured. The census writes nothing but SQLite's own reader sidecars (`-wal`, `-shm`), which a read-only open
   *  creates for every read verb, and the shim's lock file, which every op takes: those are the reader's and the shim's, so they
   *  are left out of the comparison and named here. */
  function fingerprint(box: HistoryBox): { db: string; dbMtime: number; userVersion: number; tree: string[] } {
    const dbFile = historyPaths(box.home).dbFile;
    const ro = openStoreRO(box);
    let userVersion: number;
    try { userVersion = (ro.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { ro.close(); }
    const root = path.join(box.home, '.ccrc');
    const tree: string[] = [];
    const visit = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'history-sweep.lock' || /-(wal|shm)$/.test(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { tree.push(`${path.relative(root, p)}/`); visit(p); continue; }
        const st = fs.lstatSync(p);
        tree.push(`${path.relative(root, p)} ${st.size} ${Math.trunc(st.mtimeMs)}`);
      }
    };
    visit(root);
    return { db: createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex'), dbMtime: fs.statSync(dbFile).mtimeMs, userVersion, tree: tree.sort() };
  }

  it('SA23 --json prints the report as one JSON document on stdout, exit 0; the store file and every other file under ~/.ccrc are untouched (SQLite\'s reader sidecars and the lock aside); no install record is written', async () => {
    const rig = await rigOf('ccrc-hist-sa23-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3801, { before: 60_000, ids: ['toolu_1'] }), agents: [agent('a', 0x4801, { meta: { toolUseId: 'toolu_1' } })] }, SINCE);
    await rig.tick(armed, { scan: true });
    // the fixture deletes the install record after its seeding ticks, so a census that ran decideInstallRecord would write one (review 1728, F6)
    rig.db.prepare("DELETE FROM meta WHERE k = 'agents_since_ms'").run();
    closeWriter(rig.db);
    const before = fingerprint(rig.box);
    const r = runCli(rig.box, ['census', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as CensusReport;
    expect(doc.units).toMatchObject({ D: 1, Ad: 1 });
    expect(r.stderr, 'nothing on stderr: the report is the answer').toBe('');
    expect(fingerprint(rig.box)).toEqual(before);
    const ro = openStoreRO(rig.box);
    try { expect(getMeta(ro, 'agents_since_ms')).toBeNull(); } finally { ro.close(); }
    expect(WRITING_FORMS).not.toHaveProperty('census');
  });

  it('the text form prints one group per line, counts and ranges only, never a path; it runs inside a session too', async () => {
    const rig = await rigOf('ccrc-hist-sa23-text-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, mainRows: calls(0x3802, { before: 60_000, ids: ['toolu_1'] }), agents: [agent('a', 0x4802, { meta: { toolUseId: 'toolu_1' } })] }, SINCE);
    await rig.tick(armed, { scan: true });
    closeWriter(rig.db);
    const r = runCli(rig.box, ['census'], { env: { CLAUDECODE: '1' } });
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines.every((l) => l.startsWith('census '))).toBe(true);
    expect(lines[0]).toBe('census units: D 1 = R 0 + P 0 + Q 0 + Ad 1; Ad = L 1 + U 0 + M 0 + X 0; I 0; G 0 (not found 0, unknown 0)');
    expect(r.stdout).toContain('census share D-T: 100.0% to 100.0% (den 1)');
    expect(r.stdout, 'no path').not.toContain(rig.box.home);
    expect(r.stdout).not.toContain('agent-a');
  });

  /** stdout is exactly one JSON document, the envelope of `exit`, and the sweep's prose went to stderr. */
  const oneEnvelope = (r: { code: number | null; stdout: string; stderr: string }, exit: number): Record<string, unknown> => {
    expect(r.code).toBe(exit);
    expect(r.stdout.trim().split('\n'), 'one line on stdout').toHaveLength(1);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc).toMatchObject({ v: 1, exit });
    expect(doc).not.toHaveProperty('units');
    return doc;
  };

  it('census --json that the sweep refuses prints one envelope on stdout and its own prose on stderr: no store (9), an unreadable roster (2), a held lock (4)', async () => {
    const empty = makeHistoryBox('ccrc-hist-sa23-json-nostore-');
    const none = runCli(empty, ['census', '--json']);
    oneEnvelope(none, 9);
    expect(none.stderr).toContain('history-sweep: no store on this box; nothing to census');
    expect(none.stdout, 'the prose is not on stdout').not.toContain('history-sweep');

    const rig = await rigOf('ccrc-hist-sa23-json-roster-');
    closeWriter(rig.db);
    fs.rmSync(path.join(rig.box.home, '.ccrc', 'accounts.sh'));
    const roster = runCli(rig.box, ['census', '--json']);
    expect(oneEnvelope(roster, 2)).toMatchObject({ reason: 'roster-unreadable' });
    expect(roster.stderr).toContain('accounts.sh could not be read');
    expect(roster.stdout).not.toContain('accounts.sh');

    const held = await rigOf('ccrc-hist-sa23-json-lock-');
    closeWriter(held.db);
    const release = holdLock(held.box);
    try { oneEnvelope(runCli(held.box, ['census', '--json']), 4); } finally { release(); }
  });

  it('no store on this box is exit 9; a held lock is exit 4; any argument but --json is exit 2', async () => {
    const empty = makeHistoryBox('ccrc-hist-sa23-nostore-');
    expect(runCli(empty, ['census']).code).toBe(9);
    const rig = await rigOf('ccrc-hist-sa23-lock-');
    closeWriter(rig.db);
    expect(runCli(rig.box, ['census', '--bogus']).code).toBe(2);
    expect(runCli(rig.box, ['census', 'x']).code).toBe(2);
    const release = holdLock(rig.box);
    try { expect(runCli(rig.box, ['census']).code).toBe(4); } finally { release(); }
  });

  it('an unreadable roster knows no home, so the census refuses it (roster-unreadable) instead of reporting no units', async () => {
    const rig = await rigOf('ccrc-hist-sa23-roster-');
    plantAgentTree(rig, { slug: SLUG, uuid: PARENT, agents: [agent('a', 0x4803, { meta: {} })] }, SINCE);
    await rig.tick(armed, { scan: true });
    closeWriter(rig.db);
    const ok = runSweep(rig.box, ['--op', 'census']);
    expect(ok.code, `CONTROL: with the roster read, it runs\n${ok.stderr}`).toBe(0);
    const r = runSweep(rig.box, ['--op', 'census', '--roster-unreadable'], { homes: [] });
    expect(r.code).toBe(2);
    expect(r.stdout.trim().split('\n').at(-1)).toBe('{"rc":2,"reason":"roster-unreadable"}');
    expect(r.stdout, 'no report').not.toContain('census ');
  });
});
