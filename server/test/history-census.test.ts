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
  agentKeys, agentRig, agentRows, AGENT_T0, armed, callRows, censusOf, counterNames, fixtureRows, holdAgainIn, iso, linkOf, plantAgentTree,
  resultRows, T0, untimedRows, whileClosed, type AgentRig, type CensusReport, type TreeSpec,
} from './historyAgentFixtures.js';
import { holdLock, makeHistoryBox, openStoreRO, runCli, runShim, skipOnDarwin, type HistoryBox } from './historyHelpers.js';
import { historyPaths, WRITING_FORMS } from '../../ccd/history/lib.mjs';
import { closeWriter, createStore, getMeta } from '../../ccd/history/store.mjs';
import { LANE_ROSTER } from './historyAgentFixtures.js';

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
