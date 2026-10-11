// Child reclamation wave 8, X1 in the executor (spec §5.5, §5.7). A sweep request carries
// `licenceGeneration`: the workspace generation the sweep judged it under, from its own byte-exact
// read. The executor re-reads the generation after the switch and before presence, for EVERY sweep
// request, licensed or not (step 2c). It then compares the audit's own `generation` with the licence
// before it spends the token (step 5a). Close's requests carry `none` and skip both. With the sweep's
// read and ccd's token under its lock, that makes four equal generations from the licence to the act,
// so a licence never crosses a generation, wherever in the request's life the slug is minted again.
// This file takes the later points: between the re-read and the audit, between the audit and the act,
// and between two requests queued for one id. `child-reclaim-licence-lane.test.ts` takes the earlier ones.
//
// The ccd is `modelCcd` (wave 7's binding, or an older ccd without one), or a script for a document no
// correct ccd prints. It runs behind the agent's REAL exec whitelist (`testDeps`). FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE, CHILD_RECLAIM_TOKEN_KIND,
  isChildReclaimDeferWhy, isChildReclaimKebab, parseChildReclaimAudit, reclaimChild,
  type ChildReclaimDeps, type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_PRESENCE_DEFERS, type ChildReclaimFeedQuiet } from '../src/childReclaimSweep.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { LC_REFUSAL_TOKENS, type ChildReclaimGenerationKey } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { G1, G2, modelCcd, type CcdAnswer, type CcdHooks } from './childReclaimGenerationFixture.js';

const ID = 'demo-quiet-basin';
const TOK = 'c'.repeat(64);
/** A byte-order mark, built from its code point so that no editor or agent write can drop it. */
const BOM = String.fromCharCode(0xfeff);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
const value = (v: string): ChildReclaimGenerationKey => ({ kind: 'value', v });
const ABSENT: ChildReclaimGenerationKey = { kind: 'absent' };
const NONE = { kind: 'none' } as const;
const detailOf = (o: ChildReclaimOutcome): string => (o.kind === 'deferred' ? o.detail : '');

interface RigOpts {
  /** The row's `.generation`: a string is written byte for byte, `null` writes no file, and `'dir'`
   *  plants a directory there, which reads as unreadable. Default `G1`. */
  readonly generation?: string | null | 'dir';
  readonly visible?: boolean;
  readonly paused?: boolean;
  /** `false` is an older ccd. The default is wave 7's (`modelCcd`). */
  readonly wave7?: boolean;
  /** A script in place of the model. */
  readonly script?: (args: readonly string[], runId: number) => CcdAnswer | undefined;
  /** A fault on the fixture HOME's io. */
  readonly io?: (base: FleetIO) => FleetIO;
}

/** `child-reclaim.test.ts`'s `rig`, cut down: one child of a CLOSED minting run, a real CoordStore, a
 *  feed log, and the ccd above. `mint` writes the row as ws-add does. A second call is the SAME run
 *  minting the slug again, with a new uuid and the generation given. */
const rig = async (over: RigOpts = {}) => {
  const home = mkTmp('ccrc-child-reclaim-licence-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const genPath = path.join(reg, `${ID}.generation`);
  let mints = 0;
  const mint = (generation: string | null | 'dir'): void => {
    mints += 1;
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`,
      uuid: `u-${ID}-${mints}`, started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main',
      child: String(runId) };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    rmSync(genPath, { recursive: true, force: true });
    if (generation === 'dir') mkdirSync(genPath);
    else if (generation !== null) writeFileSync(genPath, generation);
  };
  mint(over.generation === undefined ? G1 : over.generation);
  if (over.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const hooks: CcdHooks = {};
  const model = modelCcd({ reg, id: ID, wave7: over.wave7 !== false, hooks });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const a = over.script !== undefined ? over.script(args, runId) : model(args);
    return a === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` }
      : { code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
  };
  const base = testDeps(home, run);
  let generationReads = 0;
  const counted: FleetIO = {
    ...base.io,
    readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      if (path.basename(p) === `${ID}.generation`) generationReads += 1;
      return base.io.readFileMeasured(p, timeoutMs, signal);
    },
  };
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: over.io?.(counted) ?? counted, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: CAPS, presence: { isVisible: (id: string) => over.visible === true && id === ID }, notifyLog };
  /** A sweep request judged under `licence`, or close's request when it is `none`; licensed or not. */
  const req = (licence: ChildReclaimGenerationKey | typeof NONE,
    o: { readonly licensed?: boolean; readonly feedQuiet?: ChildReclaimFeedQuiet } = {}): ChildReclaimRequest => ({
    sessionId: ID, runId, trigger: licence.kind === 'none' ? 'close' : 'sweep', deferExpired: o.licensed === true,
    deferredSinceMs: null, feedQuiet: o.feedQuiet ?? CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: licence,
  });
  const events = () => coord.feedEvents(50).filter((e) => e.sessionId === ID);
  return {
    runId, deps, hooks, req, mint, calls,
    remint: (g: string): void => { writeFileSync(genPath, g); },
    verbs: (): string[] => calls.map((c) => c[0]!),
    generationReads: (): number => generationReads,
    listed: (): string[] => readdirSync(reg).filter((n) => n.startsWith(`${ID}.`)),
    feed: (): string[] => events().map((e) => e.title),
    bodies: (): string[] => events().map((e) => e.body),
  };
};

describe('step 2c — the re-read before presence, for every sweep request', () => {
  it.each([['unlicensed', false], ['licensed', true]] as const)(
    '%s: the generation it was judged under still stands, so it proceeds to the act ccd binds to it',
    async (_what, licensed) => {
      const s = await rig();
      expect(await reclaimChild(s.deps, s.req(value(G1), { licensed }))).toMatchObject({ kind: 'reclaimed' });
      expect(s.verbs()).toEqual(['ws-audit', 'ws-reclaim']);
    });

  it.each<[string, string | null, ChildReclaimGenerationKey]>([
    ['another value', G2, value(G1)],
    ['a value where the request was judged under none', G1, ABSENT],
    ['none where the request was judged under a value', null, value(G1)],
  ])('%s defers generation-changed before any argv, unlicensed and licensed alike', async (_what, file, licence) => {
    for (const licensed of [false, true]) {
      const s = await rig({ generation: file });
      const out = await reclaimChild(s.deps, s.req(licence, { licensed }));
      expect(out, `licensed: ${String(licensed)}`).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
      expect(s.calls, 'nothing reached the box').toEqual([]);
      expect(s.listed(), 'the workspace under the name stands').toContain(`${ID}.uuid`);
    }
  });

  it('names both generations, then says why in its own sentence', async () => {
    const s = await rig({ generation: G2 });
    const d = detailOf(await reclaimChild(s.deps, s.req(value(G1))));
    expect(d).toContain(`now carries generation ${G2}`);
    expect(d).toContain(`judged under generation ${G1}`);
    expect(d.endsWith(CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE)).toBe(true);
  });

  it('absent against absent proceeds to the audit, where wave 7’s ccd mints nothing over a row with no generation', async () => {
    const s = await rig({ generation: null });
    expect(await reclaimChild(s.deps, s.req(ABSENT))).toMatchObject({ kind: 'failed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it.each<[string, string]>([
    ['a directory where the file should be', 'dir'],
    ['37 bytes: the value and a newline', `${G1}\n`],
    ['a byte-order mark before the value', `${BOM}${G1}`],
  ])('%s is unreadable: marker-unreadable with its own detail, never generation-changed, and nothing reaches the box',
    async (_what, file) => {
      const s = await rig({ generation: file });
      const out = await reclaimChild(s.deps, s.req(value(G1), { licensed: true }));
      expect(out).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
      expect(detailOf(out)).toContain(`${ID}.generation could not be read`);
      expect(s.calls).toEqual([]);
    });

  it('a read that rejects is marker-unreadable too, never an uncaught rejection', async () => {
    const s = await rig({ io: (b) => ({ ...b,
      readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
        if (path.basename(p) === `${ID}.generation`) throw new Error('EIO');
        return b.readFileMeasured(p, timeoutMs, signal);
      } }) });
    const out = await reclaimChild(s.deps, s.req(value(G1)));
    expect(out).toMatchObject({ kind: 'deferred', why: 'marker-unreadable' });
    expect(detailOf(out)).toContain('EIO');
    expect(s.calls).toEqual([]);
  });
});

describe('where step 2c sits: after the switch, before presence', () => {
  it('a raised switch answers first, and the generation is not read at all', async () => {
    const s = await rig({ generation: G2, paused: true });
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(s.generationReads()).toBe(0);
  });

  it('a re-minted workspace someone is viewing answers generation-changed, never presence: no presence answer measured on a new workspace is credited to the old one’s episode', async () => {
    const s = await rig({ generation: G2, visible: true });
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    const c = await rig({ generation: G1, visible: true });
    expect(await reclaimChild(c.deps, c.req(value(G1))), 'the CONTROL: the generation it was judged under is presence')
      .toMatchObject({ kind: 'deferred', why: 'presence' });
  });
});

describe('step 5a — the audit’s generation, against the licence', () => {
  it('a re-mint BETWEEN the re-read and the audit: wave 7’s ccd mints over G2 and says so, and that token is never spent', async () => {
    for (const licensed of [false, true]) {
      const s = await rig();
      s.hooks.beforeAudit = () => s.remint(G2);
      const out = await reclaimChild(s.deps, s.req(value(G1), { licensed }));
      expect(out, `licensed: ${String(licensed)}`).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
      expect(detailOf(out)).toContain(`ws-audit minted its token over generation ${G2}`);
      expect(s.verbs(), 'the audit ran, and the act never did').toEqual(['ws-audit']);
    }
  });

  it('a re-mint BETWEEN the audit and the act: ccd’s lock refuses the G1 token state-changed, and the new workspace stands', async () => {
    // The fourth equal generation is ccd's own (spec §5.5): the server cannot see this window, and does
    // not need to. Wave 7's real-ccd case pins the refusal; this pins that the server reads it as a retry.
    const s = await rig();
    s.hooks.beforeAct = () => s.remint(G2);
    expect(await reclaimChild(s.deps, s.req(value(G1), { licensed: true })))
      .toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(s.verbs()).toEqual(['ws-audit', 'ws-reclaim']);
    expect(s.listed()).toContain(`${ID}.uuid`);
  });

  it('a licence judged under no generation never spends a token minted over one', async () => {
    const s = await rig({ generation: null, script: (args, runId) => (args[0] === 'ws-audit'
      ? { code: 0, stdout: JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, generation: G1,
          verdict: 'reclaimable', detail: '', token: TOK }) }
      : undefined) });
    expect(await reclaimChild(s.deps, s.req(ABSENT))).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });
});

describe('an older ccd: its audit prints no generation', () => {
  it('a LICENSED request is never spent: it defers unsupported, and the detail says the audit prints no generation', async () => {
    const s = await rig({ wave7: false });
    const out = await reclaimChild(s.deps, s.req(value(G1), { licensed: true }));
    expect(out).toMatchObject({ kind: 'deferred', why: 'unsupported' });
    expect(detailOf(out)).toContain('ws-audit prints no generation');
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an UNLICENSED request relies on step 2c, and proceeds', async () => {
    const s = await rig({ wave7: false });
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'reclaimed' });
  });

  it('THE STATED RESIDUAL: an unlicensed request keeps the gap between step 2c and the act', async () => {
    // Spec §5.5: what is left of the same-run re-mint window while the fleet host runs a ccd older than
    // wave 7's. A licensed request is never spent there (the case above).
    const s = await rig({ wave7: false });
    s.hooks.beforeAudit = () => s.remint(G2);
    expect(await reclaimChild(s.deps, s.req(value(G1)))).toMatchObject({ kind: 'reclaimed' });
  });
});

describe('two requests queued for one id', () => {
  it('the second, judged under G1, never reaches the slug the same run minted again after the first reclaimed it', async () => {
    for (const wave7 of [false, true]) {
      const s = await rig({ wave7 });
      s.hooks.afterReclaim = () => { s.hooks.afterReclaim = undefined; s.mint(G2); };
      const q = new KeyedQueue();
      const first = q.run(ID, () => reclaimChild(s.deps, s.req(value(G1))));
      const second = q.run(ID, () => reclaimChild(s.deps, s.req(value(G1))));
      expect(await first, `wave7: ${String(wave7)}`).toMatchObject({ kind: 'reclaimed' });
      expect(await second, `wave7: ${String(wave7)}`).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
      expect(s.verbs(), 'the second asked the box nothing').toEqual(['ws-audit', 'ws-reclaim']);
      expect(s.listed(), 'the new workspace stands').toContain(`${ID}.uuid`);
    }
  });
});

describe('close: `none` skips the re-read and the comparison', () => {
  const closeCcd = (printed: Record<string, unknown>) =>
    (args: readonly string[], runId: number): CcdAnswer | undefined => {
      if (args[0] === 'ws-audit') {
        return { code: 0, stdout: JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, ...printed,
          verdict: 'reclaimable', detail: '', token: TOK }) };
      }
      if (args[0] === 'ws-reclaim') {
        return { code: 0, stdout: JSON.stringify({ reclaimed: ID, childOf: runId, wip: null, attic: 2,
          residueBytes: null, secretsDropped: 0 }) };
      }
      return undefined;
    };

  it('reads no generation, and spends the token whatever value the audit prints, or none', async () => {
    for (const printed of [{ generation: G2 }, {}]) {
      const s = await rig({ generation: 'dir', script: closeCcd(printed) });
      expect(await reclaimChild(s.deps, s.req(NONE)), JSON.stringify(printed)).toMatchObject({ kind: 'reclaimed' });
      expect(s.generationReads(), 'close never reads the generation').toBe(0);
    }
  });

  it('a null generation on a token-bearing document is unreadable for close too, so it is never spent', async () => {
    const s = await rig({ script: closeCcd({ generation: null }) });
    expect(await reclaimChild(s.deps, s.req(NONE))).toMatchObject({ kind: 'failed', resume: 'not-resumable' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });
});

describe('parseChildReclaimAudit reads `generation` in four arms, by hasOwnProperty', () => {
  const doc = (extra: Record<string, unknown>, verdict = 'reclaimable'): string => JSON.stringify({
    id: ID, mode: 'reclaim', childOf: 7, verdict, detail: '', ...(verdict === 'reclaimable' ? { token: TOK } : {}), ...extra });

  it('a value: the token, and the generation ccd bound into it', () => {
    expect(parseChildReclaimAudit(ID, doc({ generation: G1 })))
      .toEqual({ kind: 'token', token: TOK, childOf: 7, generation: { kind: 'value', v: G1 } });
  });

  it('no key at all is an older ccd, named as such: never folded into null, nor into the row having none', () => {
    expect(parseChildReclaimAudit(ID, doc({})))
      .toEqual({ kind: 'token', token: TOK, childOf: 7, generation: { kind: 'unprinted' } });
  });

  it('null on a token-bearing document is unreadable, so the token is never spent', () => {
    expect(parseChildReclaimAudit(ID, doc({ generation: null })))
      .toEqual({ kind: 'unreadable', detail: 'ws-audit --reclaim said reclaimable with a null generation' });
  });

  it.each<[string, unknown]>([
    ['the value and a newline', `${G1}\n`],
    ['a space before the value', ` ${G1}`],
    ['a byte-order mark before the value', `${BOM}${G1}`],
    ['upper case', G1.toUpperCase()],
    ['35 characters', G1.slice(1)],
    ['37 characters', `${G1}0`],
    ['an empty string', ''],
    ['a number', 42],
    ['an object', { v: G1 }],
  ])('a malformed value (%s) is unreadable, never trimmed into one', (_what, g) => {
    const r = parseChildReclaimAudit(ID, doc({ generation: g }));
    expect(r).toMatchObject({ kind: 'unreadable' });
    expect(r.kind === 'unreadable' ? r.detail : '').toContain('36-character');
  });

  it('on a refused document the key gates nothing, whatever it holds', () => {
    for (const extra of [{}, { generation: null }, { generation: G1 }, { generation: 'junk' }]) {
      expect(parseChildReclaimAudit(ID, doc(extra, 'not-a-child')), JSON.stringify(extra))
        .toEqual({ kind: 'refused', token: 'not-a-child', detail: '' });
    }
  });
});

describe('generation-changed: the server’s own defer word', () => {
  it('is a defer reason and a declared word, and never a ccd word, a journal token or a presence defer', () => {
    // Not a presence defer, so `childReclaimNextEntry` ends the presence episode on it, and no licence
    // outlives it: the class `child-reclaim-sweep-policy.test.ts` pins for every non-presence defer.
    expect(isChildReclaimDeferWhy('generation-changed')).toBe(true);
    expect(isChildReclaimKebab('generation-changed')).toBe(true);
    expect(Object.keys(CHILD_RECLAIM_TOKEN_KIND)).not.toContain('generation-changed');
    expect(LC_REFUSAL_TOKENS as readonly string[]).not.toContain('generation-changed');
    expect(CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).not.toContain('generation-changed');
  });

  it('writes one feed row naming the word and its sentence wherever it is found, and none for a repeat in the same episode', async () => {
    const reread = await rig({ generation: G2 });
    await reclaimChild(reread.deps, reread.req(value(G1)));
    const audited = await rig();
    audited.hooks.beforeAudit = () => audited.remint(G2);
    await reclaimChild(audited.deps, audited.req(value(G1)));
    for (const s of [reread, audited]) {
      expect(s.feed()).toEqual(['child reclaim deferred']);
      expect(s.bodies()[0]).toContain('reclaim deferred (generation-changed) — ');
      expect(s.bodies()[0]).toContain(CHILD_RECLAIM_GENERATION_CHANGED_SENTENCE);
    }
    const quiet = await rig({ generation: G2 });
    await reclaimChild(quiet.deps, quiet.req(value(G1), { feedQuiet: { deferWhy: 'generation-changed', failureToken: null } }));
    expect(quiet.feed(), 'the episode’s row is already written').toEqual([]);
  });
});
