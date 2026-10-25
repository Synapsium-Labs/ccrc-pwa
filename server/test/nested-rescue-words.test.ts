// DISK RETENTION DR-21 (D-6633; spec 2026-10-23 §2.7.1). The server's half of rung 9's nested-repository rescue: the two
// words ccd's pin prints (`nested-rescue-too-large`, terminal; `nested-rescue-failed`, retry) are known to BOTH lanes, each
// has a sentence, both audit parsers read the document's `nestedRescue.wouldRescue`, and each lane records ONE
// "would rescue" feed row for a child (or archive) its audit says the arm would rescue. The arming marker has a switchboard
// row and no writer. ccd is scripted: nothing here reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_TOKEN_KIND, childReclaimStatus, childReclaimTokenKind, isChildReclaimStuckToken, parseChildReclaimAudit, parseChildReclaimResult, reclaimChild,
  type ChildReclaimDeps, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { EXPIRE_TOKEN_KIND, parseExpireAudit, parseExpireResult } from '../src/archivedExpiry.js';
import { expireArchived, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { CHILD_RECLAIM_TIER_NONE, childReclaimTerminalRefusal, childReclaimTierSeed } from '../src/childReclaimSweep.js';
import { expireTokenKind } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';
import { NESTED_RESCUE_LIVE_MARKER, SWITCHES, markerSwitchNames } from '../../shared/switches.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const WORDS = ['nested-rescue-too-large', 'nested-rescue-failed'] as const;

describe('the two rescue words are known to both lanes', () => {
  it('nested-rescue-too-large is terminal and nested-rescue-failed is retry, on the reclaim lane and the expiry lane', () => {
    expect(CHILD_RECLAIM_TOKEN_KIND['nested-rescue-too-large']).toBe('terminal');
    expect(CHILD_RECLAIM_TOKEN_KIND['nested-rescue-failed']).toBe('retry');
    expect(EXPIRE_TOKEN_KIND['nested-rescue-too-large']).toBe('terminal');
    expect(EXPIRE_TOKEN_KIND['nested-rescue-failed']).toBe('retry');
  });

  it('each word has its own sentence, and a retry word asks nothing of a reader', () => {
    for (const w of WORDS) {
      expect(SENTENCES[w], w).toBeDefined();
      expect(refusalSentence(w), w).toBe(SENTENCES[w]);
    }
    expect(SENTENCES['nested-rescue-too-large']).toMatch(/nothing was removed/i);
    expect(SENTENCES['nested-rescue-failed']).toMatch(/nothing was removed/i);
    expect(SENTENCES['nested-rescue-failed']).toMatch(/tries again/i);
  });
});

describe('both audit parsers read nestedRescue.wouldRescue', () => {
  const ID = 'demo-quiet-basin';
  it('the reclaim audit: a refused document carries the count, and none is added when the key is absent or empty', () => {
    const doc = (extra: Record<string, unknown>): string => JSON.stringify({ id: ID, mode: 'reclaim', childOf: 7,
      verdict: 'containment-unproven', detail: 'd', ...extra });
    expect(parseChildReclaimAudit(ID, doc({ nestedRescue: { wouldRescue: ['/x/a', '/x/b'], rescue: [] } })))
      .toEqual({ kind: 'refused', token: 'containment-unproven', detail: 'd', wouldRescue: 2 });
    expect(parseChildReclaimAudit(ID, doc({}))).toEqual({ kind: 'refused', token: 'containment-unproven', detail: 'd' });
    expect(parseChildReclaimAudit(ID, doc({ nestedRescue: { wouldRescue: [], rescue: [] } })))
      .toEqual({ kind: 'refused', token: 'containment-unproven', detail: 'd' });
    expect(parseChildReclaimAudit(ID, doc({ nestedRescue: { wouldRescue: 'x' } })), 'a non-array is no count')
      .toEqual({ kind: 'refused', token: 'containment-unproven', detail: 'd' });
  });

  it('the expiry audit: the document carries the count the same way', () => {
    const doc = (extra: Record<string, unknown>): string => JSON.stringify({ session: ID, mode: 'expire', archivedAt: 5,
      expiresAt: 9, sensitive: [], verdict: 'containment-unproven', detail: 'd', ...extra });
    const withKey = parseExpireAudit(ID, true, doc({ nestedRescue: { wouldRescue: ['/x/a'], rescue: [] } }));
    expect(withKey).toMatchObject({ kind: 'document', nestedWouldRescue: 1 });
    const without = parseExpireAudit(ID, true, doc({}));
    expect(without.kind).toBe('document');
    expect('nestedWouldRescue' in without).toBe(false);
  });
});

const SHADOW_TITLE = 'a nested repository would be rescued';

describe('the reclaim lane records one "would rescue" row per refused child', () => {
  const ID = 'demo-quiet-basin';
  const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
    ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
  const rig = async (audit: (runId: number) => string) => {
    const home = mkTmp('ccrc-nested-words-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
    if (!('id' in opened)) throw new Error('openRun refused');
    const runId = opened.id;
    coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
    expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p', viaClosing: false }).ok).toBe(true);
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
      started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    writeFileSync(path.join(reg, `${ID}.child`), String(runId));
    const calls: string[][] = [];
    const run: Runner = async (_c, args) => {
      calls.push(args);
      return args[0] === 'ws-audit' ? { ran: true, code: 0, stdout: audit(runId), stderr: '' } : { ran: true, code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
    };
    const base = testDeps(home, run);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: CAPS, notifyLog };
    const req: ChildReclaimRequest = { sessionId: ID, runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: 1,
      feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'absent' } };
    const rows = () => coord.feedEvents(50).filter((e) => e.sessionId === ID);
    return { deps, req, calls, rows };
  };
  const refused = (extra: Record<string, unknown>) => (runId: number): string => JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId,
    verdict: 'containment-unproven', detail: 'a nested checkout', ...extra });

  it('a refusal whose audit says the arm would rescue writes the refusal row AND one shadow row, naming the count and no path', async () => {
    const s = await rig(refused({ nestedRescue: { wouldRescue: ['/secret/path/a', '/secret/path/b'], rescue: [] } }));
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'refused', token: 'containment-unproven' });
    const shadow = s.rows().filter((e) => e.title === SHADOW_TITLE);
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.body).toContain('2 nested repositories');
    expect(shadow[0]!.body).toMatch(/not armed|shadow/);
    expect(shadow[0]!.body).not.toContain('/secret/path');
    expect(s.rows().filter((e) => e.title !== SHADOW_TITLE), 'the refusal keeps its own row').toHaveLength(1);
  });

  it('the same refusal asked again for the same child writes no second shadow row', async () => {
    const s = await rig(refused({ nestedRescue: { wouldRescue: ['/x/a'], rescue: [] } }));
    await reclaimChild(s.deps, s.req);
    await reclaimChild(s.deps, s.req);
    expect(s.rows().filter((e) => e.title === SHADOW_TITLE)).toHaveLength(1);
  });

  it('a refusal with nothing to rescue writes no shadow row', async () => {
    const s = await rig(refused({}));
    await reclaimChild(s.deps, s.req);
    expect(s.rows().filter((e) => e.title === SHADOW_TITLE)).toEqual([]);
  });

  it('one repository is said in the singular', async () => {
    const s = await rig(refused({ nestedRescue: { wouldRescue: ['/x/a'], rescue: [] } }));
    await reclaimChild(s.deps, s.req);
    expect(s.rows().find((e) => e.title === SHADOW_TITLE)!.body).toContain('1 nested repository ');
  });
});

describe('the expiry lane records one "would rescue" row per refused archive', () => {
  const ID = 'demo-quiet-dune';
  const ARCH = 1_789_000_000;
  const DUE = ARCH + 604_800;
  const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
    ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] };
  const rig = async (extra: Record<string, unknown>) => {
    const home = mkTmp('ccrc-nested-words-exp-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const audit = JSON.stringify({ session: ID, mode: 'expire', archivedAt: ARCH, expiresAt: DUE, alive: false, exists: true,
      reaping: null, sensitive: [], verdict: 'containment-unproven', detail: 'a nested checkout', ...extra });
    const run: Runner = async (_c, args) => (args[0] === 'ws-audit' ? { ran: true, code: 0, stdout: audit, stderr: '' }
      : { ran: true, code: 1, stdout: '', stderr: `unscripted ${args[0]}` });
    const base = testDeps(home, run);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps: ExpireArchivedDeps = { coord, cfg: base.cfg, io: base.io, runCcd: base.runCcd, fleetState: CAPS, notifyLog };
    return { deps, req: { sessionId: ID, archivedAt: ARCH, expiresAt: DUE },
      rows: () => coord.feedEvents(50).filter((e) => e.sessionId === ID) };
  };

  it('writes one shadow row for the archive, naming the count and no path', async () => {
    const s = await rig({ nestedRescue: { wouldRescue: ['/secret/path/a'], rescue: [] } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'refused', token: 'containment-unproven' });
    const shadow = s.rows().filter((e) => e.title === SHADOW_TITLE);
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.body).toContain('1 nested repository ');
    expect(shadow[0]!.body).not.toContain('/secret/path');
  });

  it('asked again for the same archive writes no second row', async () => {
    const s = await rig({ nestedRescue: { wouldRescue: ['/x/a'], rescue: [] } });
    await expireArchived(s.deps, s.req);
    await expireArchived(s.deps, s.req);
    expect(s.rows().filter((e) => e.title === SHADOW_TITLE)).toHaveLength(1);
  });

  it('writes none when the audit names nothing to rescue', async () => {
    const s = await rig({});
    await expireArchived(s.deps, s.req);
    expect(s.rows().filter((e) => e.title === SHADOW_TITLE)).toEqual([]);
  });
});

// ccd prints both rescue words on the act's `failed` document (and journals them through `_lc_fail`), never as a refusal.
// The too-large word must still be terminal on that path: a repository over the bound is not re-measured every pass.
describe('the too-large word is terminal on the path ccd prints it (a failed document, no breadcrumb)', () => {
  const ID = 'demo-quiet-basin';
  const failed = (word: string, crumb?: boolean): string =>
    JSON.stringify({ failed: word, detail: 'over the bound', ...(crumb === undefined ? {} : { crumb }) });

  it('the reclaim act: {failed, crumb:false} reads as the terminal refusal, and is not tried again', () => {
    const r = parseChildReclaimResult(ID, failed('nested-rescue-too-large', false), '');
    expect(r).toEqual({ kind: 'refused', token: 'nested-rescue-too-large', detail: 'over the bound' });
    expect(childReclaimTokenKind('nested-rescue-too-large')).toBe('terminal');
  });

  it('the expiry act: {failed, crumb:false} keeps the word as a terminal refusal, not a restart', () => {
    const r = parseExpireResult(ID, failed('nested-rescue-too-large', false), '');
    expect(r).toEqual({ kind: 'refused', token: 'nested-rescue-too-large', detail: 'over the bound' });
    expect(expireTokenKind('nested-rescue-too-large')).toBe('terminal');
  });

  it('past a breadcrumb, or with the retry word, it stays a failure on both lanes', () => {
    expect(parseChildReclaimResult(ID, failed('nested-rescue-too-large', true), '')).toMatchObject({ kind: 'failed' });
    expect(parseChildReclaimResult(ID, failed('nested-rescue-failed', false), '')).toMatchObject({ kind: 'failed' });
    expect(parseExpireResult(ID, failed('nested-rescue-too-large', true), '')).toMatchObject({ kind: 'failed' });
    expect(parseExpireResult(ID, failed('nested-rescue-failed', false), '')).toMatchObject({ kind: 'restart' });
  });

  it('the journal: a failed line carrying the too-large word is a terminal refusal; no other failed word is', () => {
    const kindOf = childReclaimTokenKind;
    expect(childReclaimTerminalRefusal({ outcome: 'failed', refusal: 'nested-rescue-too-large' }, kindOf)).toBe(true);
    expect(childReclaimTerminalRefusal({ outcome: 'failed', refusal: 'nested-rescue-failed' }, kindOf)).toBe(false);
    expect(childReclaimTerminalRefusal({ outcome: 'failed', refusal: 'containment-unproven' }, kindOf)).toBe(false);
    expect(childReclaimTerminalRefusal({ outcome: 'refused', refusal: 'nested-rescue-too-large' }, kindOf)).toBe(true);
  });
});

describe('the too-large word on the failed line the journal prints it on (D-6633)', () => {
  const T0 = 1_758_500_000_000;
  const row = (act: string, outcome: string, refusal: string | null = null, at = T0): Record<string, unknown> => ({
    uid: null, at, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
    verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal, detail: null, truncated: false,
    obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: at + 5,
  });
  const generation = [
    row('create', 'done'),
    ...Array.from({ length: 6 }, () => [row('reclaim', 'intent'), row('reclaim', 'failed', 'worktree-remove-failed')]).flat(),
    row('reclaim', 'intent'), row('reclaim', 'failed', 'nested-rescue-too-large'),
  ] as never[];

  it('the tier seed stops at it: no persistent tier is seeded from the earlier failures', () => {
    expect(childReclaimTierSeed(generation, T0, isChildReclaimStuckToken, childReclaimTokenKind)).toEqual(CHILD_RECLAIM_TIER_NONE);
  });

  it('the chip answers refused, with the too-large sentence, over that failed line', () => {
    const got = childReclaimStatus({
      run: { id: 41, state: 'done', sessionId: 'demo-a' },
      event: { act: 'reclaim', outcome: 'failed', refusal: 'nested-rescue-too-large', at: T0 + 9 } as never,
      row: { kind: 'row', child: { kind: 'child', runId: 41 } },
      sessionHasOpenRun: false, reviewedRunNotTerminal: false, fleetPaused: false, deferredSince: null,
      verdict: { kind: 'eligible' }, sweepFailing: false, journalFailingSince: null,
    });
    expect(got).toEqual({ word: 'refused', sentence: refusalSentence('nested-rescue-too-large'), at: T0 + 9 });
  });
});

describe('the arming marker', () => {
  it('nested-rescue-live is a switchboard marker row, owner C4, hand-only, shadow by default', () => {
    expect(NESTED_RESCUE_LIVE_MARKER).toBe('nested-rescue-live');
    const row = SWITCHES[NESTED_RESCUE_LIVE_MARKER];
    expect(row.storage).toEqual({ marker: 'nested-rescue-live' });
    expect(row.owner).toBe('C4');
    expect(row.writer).toBe('hand-only');
    expect(row.default).toMatch(/absent: shadow/);
    expect(markerSwitchNames).toContain('nested-rescue-live');
  });
});
