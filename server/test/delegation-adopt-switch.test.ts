// Delegation broker wave 5 PR8b (D-8112, D-8113, D-8114; plan docs/superpowers/plans/2026-11-03-delegation-broker-wave5-adopt.md,
// note `pr8b.md`). The adoption switch, end to end:
//  - R2's rule and the door's view, in L1 (`coord/delegation-adopt-switch.ts`), row by row;
//  - R3's bounded list of what a pass would keep (`adoptionKeepsOf`), at its bound;
//  - `GET`/`POST /api/coord/delegation-adopt` over a bare Fastify (`scope-sweep-switch.test.ts`'s idiom), the POST writing and
//    removing `$REG/delegation-adopt` through the REAL `ccd delegation-adopt` verb, reached only across the agent's exec whitelist
//    (`testDeps`' guard);
//  - R1's guard: the verb is forbidden to every session.
// Every ccd call runs against a fixture HOME (`makeCcdHarness`), never the live one; the live marker is never touched.
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { Bus } from '../src/bus.js';
import { EXEMPT, NO_SESSION, type GateDecision } from '../src/auth/gate.js';
import type { Runner } from '../src/exec.js';
import { notRanSentence } from '../src/unmeasured.js';
import { LEASE_AUDIT_CAP } from '../src/ccdargv.js';
import { approvalClass, FORBIDDEN_CCD_VERBS } from '../src/coord/approvalguard.js';
import {
  adoptionKeepsOf, delegationAdoptCapsOf, delegationAdoptRefusal, delegationAdoptViewOf, type DelegationAdoptCaps,
} from '../src/coord/delegation-adopt-switch.js';
import type { DelegationLeaseRow } from '../src/coord/delegation-model.js';
import {
  DELEGATION_ADOPTION_KEEPS_MAX, delegationAdoptionHealthOf, delegationAdoptionKeepsOf, type DelegationAdoptionHealth, type LeaseAuditAnswer,
} from '../../shared/api.js';
import { DELEGATION_ADOPT_REFUSALS } from '../../shared/delegation-adopt.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { DELEGATION_ADOPT_MARKER } from '../../shared/switches.js';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { testDeps } from './helpers.js';

const DOOR = '/api/coord/delegation-adopt';
const VERB = 'delegation-adopt';
const BOTH = [VERB, LEASE_AUDIT_CAP];
const apps: FastifyInstance[] = [];
const harnesses: CcdHarness[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const h of harnesses.splice(0)) h.cleanup();
});

// ── R2 (D-8113): the rule, in L1 ─────────────────────────────────────────────────────────────────────────────────────────────
describe('R2: the rule refuses what the operator\'s checks used to catch (D-8113)', () => {
  const caps = (verb: DelegationAdoptCaps['verb'], audit: DelegationAdoptCaps['audit']): DelegationAdoptCaps => ({ verb, audit });

  it('the caps: a list that did not read is unmeasured for both, never absent; a read list says present or absent per word', () => {
    expect(delegationAdoptCapsOf(null)).toEqual({ verb: 'unmeasured', audit: 'unmeasured' });
    expect(delegationAdoptCapsOf([])).toEqual({ verb: 'absent', audit: 'absent' });
    expect(delegationAdoptCapsOf([VERB])).toEqual({ verb: 'present', audit: 'absent' });
    expect(delegationAdoptCapsOf([LEASE_AUDIT_CAP])).toEqual({ verb: 'absent', audit: 'present' });
    expect(delegationAdoptCapsOf(BOTH)).toEqual({ verb: 'present', audit: 'present' });
  });

  it('on: refused on unmeasured caps, on a missing verb, on a missing audit; allowed only when both are present', () => {
    expect(delegationAdoptRefusal(caps('unmeasured', 'unmeasured'), true, true)).toBe('fleet-caps-unmeasured');
    expect(delegationAdoptRefusal(caps('present', 'unmeasured'), true, true)).toBe('fleet-caps-unmeasured');
    expect(delegationAdoptRefusal(caps('absent', 'present'), true, true)).toBe('fleet-switch-missing');
    expect(delegationAdoptRefusal(caps('absent', 'absent'), true, true)).toBe('fleet-switch-missing');
    expect(delegationAdoptRefusal(caps('present', 'absent'), true, true)).toBe('fleet-audit-missing');
    expect(delegationAdoptRefusal(caps('present', 'present'), true, true)).toBeNull();
  });

  it('on: refused sign-in-unarmed first for a caller that is not a signed-in operator, whatever the caps say (review 1659 F2)', () => {
    for (const [v, a] of [['present', 'present'], ['unmeasured', 'unmeasured'], ['absent', 'absent'], ['present', 'absent']] as const) {
      expect(delegationAdoptRefusal(caps(v, a), true, false), `${v} ${a}`).toBe('sign-in-unarmed');
    }
    expect(delegationAdoptRefusal(caps('present', 'present'), true, true), 'CONTROL: signed in, it passes to the caps rules').toBeNull();
  });

  it('off: refused only when the verb is missing; unmeasured caps, a missing audit and no sign-in let it through (the safe direction)', () => {
    for (const signedIn of [true, false]) {
      expect(delegationAdoptRefusal(caps('absent', 'present'), false, signedIn)).toBe('fleet-switch-missing');
      expect(delegationAdoptRefusal(caps('absent', 'absent'), false, signedIn)).toBe('fleet-switch-missing');
      expect(delegationAdoptRefusal(caps('present', 'absent'), false, signedIn)).toBeNull();
      expect(delegationAdoptRefusal(caps('unmeasured', 'unmeasured'), false, signedIn)).toBeNull();
      expect(delegationAdoptRefusal(caps('present', 'present'), false, signedIn)).toBeNull();
    }
  });

  it('the view: the marker from one listing (an unlisted registry is unmeasurable), the caps, both refusals, and the lane\'s pass', () => {
    const adoption: DelegationAdoptionHealth = { mode: 'shadow', adopted: 0, wouldAdopt: 1, waiting: 0, unchanged: 0, unaudited: 0,
      conflicting: 0, unsupported: 0, uncensused: 0, owed: 0 };
    expect(delegationAdoptViewOf([], BOTH, null, true)).toEqual({ state: 'clear', caps: { verb: 'present', audit: 'present' },
      refused: { on: null, off: null }, adoption: null });
    expect(delegationAdoptViewOf([DELEGATION_ADOPT_MARKER], [VERB], adoption, true)).toEqual({ state: 'set',
      caps: { verb: 'present', audit: 'absent' }, refused: { on: 'fleet-audit-missing', off: null }, adoption });
    expect(delegationAdoptViewOf(null, null, null, true)).toMatchObject({ state: 'unmeasurable', refused: { on: 'fleet-caps-unmeasured', off: null } });
    expect(delegationAdoptViewOf([], BOTH, null, false), 'not signed in: on says so, off is open')
      .toMatchObject({ refused: { on: 'sign-in-unarmed', off: null } });
  });

  it('each refusal word has one status, spread into the route table', () => {
    expect(DELEGATION_ADOPT_REFUSALS).toEqual({ 'fleet-caps-unmeasured': 503, 'fleet-switch-missing': 501, 'fleet-audit-missing': 409 });
    for (const [w, n] of Object.entries(DELEGATION_ADOPT_REFUSALS)) expect(REFUSAL_STATUS[w as keyof typeof REFUSAL_STATUS], w).toBe(n);
  });
});

// ── R3 (D-8114): the bounded list ────────────────────────────────────────────────────────────────────────────────────────────
describe('R3: the list of worktrees a pass would keep is bounded and names what the audit measured (D-8114)', () => {
  const lease = (n: number): DelegationLeaseRow => ({ leaseId: `l-${n}`, project: 'demo', adminRecord: `wt-${n}`,
    canonicalPath: `/w/demo/.claude/worktrees/wt-${n}`, parentId: 'lane-a-demo' } as unknown as DelegationLeaseRow);
  const ok: LeaseAuditAnswer = { ok: true, lease: 'l-0', generation: 1, tip: 'a'.repeat(40), dirty: true, aheadOfBase: 2,
    branchAheadOfBase: 'no-branch', changed: true, token: 't' };

  it('none kept is null: no list is served', () => {
    expect(adoptionKeepsOf([])).toBeNull();
  });

  it('a definite audit answer names the changes; an unsupported, refused or missing one names none', () => {
    const k = adoptionKeepsOf([{ lease: lease(0), audit: ok }, { lease: lease(1), audit: 'unsupported' },
      { lease: lease(2), audit: { ok: false, refusal: 'unmeasured', detail: 'x' } }, { lease: lease(3), audit: undefined }])!;
    expect(k.more).toBe(0);
    expect(k.items[0], 'R3\'s fields and no path (review 1665 N10)').toEqual({ project: 'demo', worktree: 'wt-0', parent: 'lane-a-demo',
      changes: { dirty: true, aheadOfBase: 2, branchAheadOfBase: 'no-branch' } });
    for (const i of [1, 2, 3]) expect(k.items[i], `item ${i}`).not.toHaveProperty('changes');
  });

  it('an answer that read but did not settle changed (changed: unmeasured) names no changes; changed true or false still does (review 1659 F1)', () => {
    const unsettled: LeaseAuditAnswer = { ...ok, dirty: false, aheadOfBase: 0, changed: 'unmeasured' };
    const k = adoptionKeepsOf([{ lease: lease(0), audit: unsettled }, { lease: lease(1), audit: ok },
      { lease: lease(2), audit: { ...ok, dirty: false, aheadOfBase: 0, changed: false } }])!;
    expect(k.items[0], 'never "kept, nothing changed" for a check that did not complete').not.toHaveProperty('changes');
    expect(k.items[1]?.changes, 'CONTROL: changed: true').toEqual({ dirty: true, aheadOfBase: 2, branchAheadOfBase: 'no-branch' });
    expect(k.items[2]?.changes, 'CONTROL: changed: false').toEqual({ dirty: false, aheadOfBase: 0, branchAheadOfBase: 'no-branch' });
  });

  it('at most 50 are named, in decision order, and the rest are counted: the 51st is never served', () => {
    expect(DELEGATION_ADOPTION_KEEPS_MAX).toBe(50);
    const all = Array.from({ length: 53 }, (_, n) => ({ lease: lease(n), audit: undefined }));
    const k = adoptionKeepsOf(all)!;
    expect(k.items).toHaveLength(50);
    expect(k.items.map((i) => i.worktree)).toEqual(all.slice(0, 50).map((x) => x.lease.adminRecord));
    expect(k.items.map((i) => i.worktree)).not.toContain('wt-50');
    expect(k.more).toBe(3);
    expect(adoptionKeepsOf(all.slice(0, 50))!.more).toBe(0);
  });

  // Review 1659 F6: `keeps`' one reader, beside its type, and `adoption`'s reader reads `keeps` through it.
  it('the reader: absent is null, a list is read as served (over the bound too: the bound is the writer\'s), a malformed one is null', () => {
    const item = { project: 'demo', worktree: 'wt-0', parent: 'lane-a-demo' };
    expect(delegationAdoptionKeepsOf({})).toBeNull();
    expect(delegationAdoptionKeepsOf({ keeps: { items: [item], more: 0 } })).toEqual({ items: [item], more: 0 });
    const over = { items: Array.from({ length: DELEGATION_ADOPTION_KEEPS_MAX + 1 }, () => item), more: 4 };
    expect(delegationAdoptionKeepsOf({ keeps: over })).toBe(over);
    for (const bad of [null, 'x', { items: 'x', more: 0 }, { items: [item] }, { items: [item], more: '0' }]) {
      expect(delegationAdoptionKeepsOf({ keeps: bad } as never), JSON.stringify(bad)).toBeNull();
    }
    // Review 1665 N19: the items and the count are checked, not just the envelope.
    const changes = { dirty: false, aheadOfBase: 2, branchAheadOfBase: 'no-branch' as const };
    expect(delegationAdoptionKeepsOf({ keeps: { items: [{ ...item, changes }], more: 0 } }), 'CONTROL: a full item').not.toBeNull();
    for (const badItem of [null, 'wt-0', { ...item, project: 3 }, { worktree: 'wt-0', parent: 'p' }, { ...item, parent: null },
      { ...item, changes: 'x' }, { ...item, changes: { ...changes, dirty: 'yes' } }, { ...item, changes: { ...changes, aheadOfBase: -1 } },
      { ...item, changes: { ...changes, branchAheadOfBase: 'gone' } }]) {
      expect(delegationAdoptionKeepsOf({ keeps: { items: [item, badItem], more: 0 } } as never), `item ${JSON.stringify(badItem)}`).toBeNull();
    }
    for (const badMore of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(delegationAdoptionKeepsOf({ keeps: { items: [item], more: badMore } }), `more ${badMore}`).toBeNull();
    }
  });

  it('adoption\'s reader keeps a list its reader reads and drops one it refuses, so a malformed list reads as none served', () => {
    const base: DelegationAdoptionHealth = { mode: 'shadow', adopted: 0, wouldAdopt: 1, waiting: 0, unchanged: 0, unaudited: 0,
      conflicting: 0, unsupported: 0, uncensused: 0, owed: 0 };
    const good = { ...base, keeps: { items: [], more: 0 } };
    expect(delegationAdoptionHealthOf({ adoption: good })).toBe(good);
    expect(delegationAdoptionHealthOf({ adoption: base })).toBe(base);
    expect(delegationAdoptionHealthOf({ adoption: { ...base, keeps: { items: 'x' } } as never })).toEqual(base);
    expect(delegationAdoptionHealthOf({})).toBeNull();
  });
});

// ── R1 (D-8112): the door, the verb and the guard ────────────────────────────────────────────────────────────────────────────
/** The runner the agent would be: the real ccd dispatcher, under the fixture HOME, started as the installed direct entry starts a
 *  protected verb (review 1665 N1): `bash -p`, with no startup variable or exported function inherited. */
const STARTUP_KEYS = ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE'];
const realCcd = (h: CcdHarness, argvs: string[][]): Runner => (_cmd, args) => new Promise((resolve) => {
  argvs.push(args);
  const clean = Object.fromEntries(Object.entries(inheritedEnv()).filter(([k]) => !k.startsWith('BASH_FUNC_') && !STARTUP_KEYS.includes(k)));
  const env = ghContainedEnv(h.home, { ...clean, HOME: h.home }, { systemd: true, tmux: true });
  execFile('bash', ['-p', CCD, ...args], { cwd: h.home, env, encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ ran: true, code: err === null ? 0 : typeof err.code === 'number' ? err.code : 1, stdout, stderr });
  });
});

interface Setup { app: FastifyInstance; h: CcdHarness; argvs: string[][]; reg: string; marker: string; feed: string[]; listings: () => number }
const SHADOW: DelegationAdoptionHealth = { mode: 'shadow', adopted: 0, wouldAdopt: 1, waiting: 0, unchanged: 0, unaudited: 0, conflicting: 0,
  unsupported: 0, uncensused: 0, owed: 0,
  keeps: { items: [{ project: 'demo', worktree: 'wt-x', parent: 'lane-a-demo' }], more: 0 } };

/** `auth`: `armed` (sign-in armed, the caller holds a session; the default), `no-session` (armed, no session) or `dark` (unarmed). */
type Auth = 'armed' | 'no-session' | 'dark';
function setup(o: { verbs?: string[] | null; runner?: Runner; unlistable?: boolean; adoption?: DelegationAdoptionHealth | null;
  auth?: Auth; gate?: { enabled: boolean; decision: GateDecision } } = {}): Setup {
  const h = makeCcdHarness('ccrc-delegation-adopt-switch-');
  harnesses.push(h);
  const argvs: string[][] = [];
  const base = testDeps(h.home, o.runner ?? realCcd(h, argvs));
  const feed: string[] = [];
  const verbs = o.verbs === undefined ? BOTH : o.verbs;
  const auth = o.auth ?? 'armed';
  let listed = 0;
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: o.gate?.enabled ?? auth !== 'dark' },
    io: { ...base.io, readdirMeasured: async (dir: string) => { listed += 1;
      return o.unlistable ? { ok: false as const, reason: 'unreadable' as const } : base.io.readdirMeasured(dir); } },
    notifyLog: { record: async (n: { title: string; body: string }) => { feed.push(`${n.title}: ${n.body}`); }, flush: async () => undefined } as unknown as Deps['notifyLog'],
    fleetState: { ccdVerbs: verbs } as unknown as Deps['fleetState'],
  };
  const sessionAuth = (): GateDecision => o.gate?.decision
    ?? (auth === 'armed' ? { allow: true, verdict: 'ok', reason: 'session', device: null } : NO_SESSION);
  const watcher = { currentDelegationHealth: () => (o.adoption === null ? {} : { adoption: o.adoption ?? SHADOW }) };
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, watcher as never);
  apps.push(app);
  const reg = path.join(h.home, '.cc-sessions');
  return { app, h, argvs, reg, marker: path.join(reg, DELEGATION_ADOPT_MARKER), feed, listings: () => listed };
}
const get = (app: FastifyInstance) => app.inject({ method: 'GET', url: DOOR });
const post = (app: FastifyInstance, payload?: unknown) =>
  app.inject({ method: 'POST', url: DOOR, ...(payload === undefined ? {} : { payload: payload as object }) });

describe('GET /api/coord/delegation-adopt: the switch, the caps, the refusals and the lane\'s last pass (D-8112..D-8114)', () => {
  it('reads the marker, the two caps, what each direction would be refused with, and the lane\'s counts and list', async () => {
    const s = setup();
    expect((await get(s.app)).json()).toEqual({ ok: true, state: 'clear', caps: { verb: 'present', audit: 'present' },
      refused: { on: null, off: null }, adoption: SHADOW });
    writeFileSync(s.marker, '');
    expect((await get(s.app)).json()).toMatchObject({ ok: true, state: 'set' });
  });

  it('says which condition holds: unmeasured caps, a missing verb, a missing audit', async () => {
    expect((await get(setup({ verbs: null }).app)).json()).toMatchObject({ caps: { verb: 'unmeasured', audit: 'unmeasured' },
      refused: { on: 'fleet-caps-unmeasured', off: null } });
    expect((await get(setup({ verbs: [LEASE_AUDIT_CAP] }).app)).json()).toMatchObject({ caps: { verb: 'absent', audit: 'present' },
      refused: { on: 'fleet-switch-missing', off: 'fleet-switch-missing' } });
    expect((await get(setup({ verbs: [VERB] }).app)).json()).toMatchObject({ caps: { verb: 'present', audit: 'absent' },
      refused: { on: 'fleet-audit-missing', off: null } });
  });

  it('a registry that cannot be listed reads unmeasurable, never clear; a lane whose last pass counted nothing reads null', async () => {
    expect((await get(setup({ unlistable: true }).app)).json()).toMatchObject({ state: 'unmeasurable' });
    expect((await get(setup({ adoption: null }).app)).json()).toMatchObject({ adoption: null });
  });

  it('says when on would be refused because the caller is not a signed-in operator; off is open either way (review 1659 F2)', async () => {
    for (const auth of ['dark', 'no-session'] as const) {
      expect((await get(setup({ auth }).app)).json(), auth).toMatchObject({ refused: { on: 'sign-in-unarmed', off: null } });
    }
    expect((await get(setup().app)).json(), 'CONTROL: signed in').toMatchObject({ refused: { on: null, off: null } });
  });

  it('serves the lane\'s list through its reader: a malformed list reads as none served', async () => {
    const { keeps: _k, ...bare } = SHADOW;
    const r = (await get(setup({ adoption: { ...SHADOW, keeps: { items: 'x' } } as never }).app)).json();
    expect(r.adoption).toEqual(bare);
  });

  it('it is no exempt door: the gate holds it for a session', () => {
    expect([...EXEMPT.keys()].filter((e) => e.includes('delegation-adopt'))).toEqual([]);   // review 1659 F5: the keys, never the pairs
  });
});

describe('POST /api/coord/delegation-adopt: the marker through its one writer, past the rule (D-8112, D-8113)', () => {
  it('on writes the marker and off removes it, each through `ccd delegation-adopt --state`, and the answer is what the registry then reads', async () => {
    const s = setup();
    const on = await post(s.app, { on: true });
    expect([on.statusCode, on.json()]).toMatchObject([200, { ok: true, state: 'set' }]);
    expect(lstatSync(s.marker).isFile()).toBe(true);
    const off = await post(s.app, { on: false });
    expect([off.statusCode, off.json()]).toMatchObject([200, { ok: true, state: 'clear' }]);
    expect(existsSync(s.marker)).toBe(false);
    expect(s.argvs).toEqual([[VERB, '--state', 'on'], [VERB, '--state', 'off']]);
  });

  it('a refused POST changes nothing and runs nothing, and answers the rule\'s word with its status', async () => {
    for (const [verbs, on, word] of [[null, true, 'fleet-caps-unmeasured'], [[LEASE_AUDIT_CAP], true, 'fleet-switch-missing'],
      [[LEASE_AUDIT_CAP], false, 'fleet-switch-missing'], [[VERB], true, 'fleet-audit-missing']] as const) {
      const s = setup({ verbs: verbs === null ? null : [...verbs] });
      if (!on) writeFileSync(s.marker, '');
      const r = await post(s.app, { on });
      expect([r.statusCode, r.json().error], `${JSON.stringify(verbs)} ${on}`).toEqual([DELEGATION_ADOPT_REFUSALS[word], word]);
      expect(s.argvs, 'nothing ran').toEqual([]);
      expect(existsSync(s.marker), 'the marker is as it was').toBe(!on);
      expect(s.feed).toEqual([]);
    }
  });

  it('on is refused sign-in-unarmed (403) while sign-in is dark or the caller holds no session, and nothing runs (review 1659 F2)', async () => {
    for (const auth of ['dark', 'no-session'] as const) {
      const s = setup({ auth });
      const r = await post(s.app, { on: true });
      expect([r.statusCode, r.json().error], auth).toEqual([403, 'sign-in-unarmed']);
      expect(REFUSAL_STATUS['sign-in-unarmed']).toBe(403);
      expect(s.argvs, 'nothing ran').toEqual([]);
      expect(existsSync(s.marker)).toBe(false);
      expect(s.feed).toEqual([]);
      expect((await post(s.app, {})).statusCode, `${auth}: a body that does not parse answers 400 first, as when armed`).toBe(400);
    }
  });

  // Review 1665 N2: each half of the measurement on its own. Auth off with a live session is not signed in; auth armed with any
  // reason but `session` is not either.
  it('on with sign-in off is refused even when the session read answers session (the flag half)', async () => {
    const s = setup({ gate: { enabled: false, decision: { allow: true, verdict: 'ok', reason: 'session', device: null } } });
    const r = await post(s.app, { on: true });
    expect([r.statusCode, r.json().error]).toEqual([403, 'sign-in-unarmed']);
    expect(s.argvs).toEqual([]);
  });

  it('on with sign-in armed is refused for every reason but session (the session half)', async () => {
    const reasons: GateDecision[] = [{ allow: true, verdict: 'ok', reason: 'flag-off', device: null },
      { allow: true, verdict: 'ok', reason: 'exempt', device: null }, NO_SESSION];
    for (const decision of reasons) {
      const s = setup({ gate: { enabled: true, decision } });
      const r = await post(s.app, { on: true });
      expect([r.statusCode, r.json().error], decision.reason).toEqual([403, 'sign-in-unarmed']);
      expect(s.argvs).toEqual([]);
    }
  });

  // Review 1665 N8: as the collect-lane door does, an unsigned on is refused before any I/O.
  it('an unsigned on answers 403 before the registry is ever listed', async () => {
    const s = setup({ auth: 'dark' });
    const r = await post(s.app, { on: true });
    expect(r.statusCode).toBe(403);
    expect(s.listings(), 'no listing for an unsigned on').toBe(0);
    await post(s.app, { on: false });
    expect(s.listings(), 'CONTROL: off still lists the registry').toBeGreaterThan(0);
  });

  it('on from a signed-in operator passes to the caps rules; off while sign-in is dark is sent', async () => {
    const audit = await post(setup({ verbs: [VERB] }).app, { on: true });
    expect([audit.statusCode, audit.json().error], 'armed with a session: the caps rule answers').toEqual([409, 'fleet-audit-missing']);
    const s = setup({ auth: 'dark' });
    writeFileSync(s.marker, '');
    const off = await post(s.app, { on: false });
    expect([off.statusCode, off.json()]).toMatchObject([200, { ok: true, state: 'clear' }]);
    expect(existsSync(s.marker)).toBe(false);
    expect(s.argvs).toEqual([[VERB, '--state', 'off']]);
  });

  it('off on unmeasured caps or a missing audit is sent: turning it off is never held behind the check', async () => {
    for (const verbs of [null, [VERB]]) {
      const s = setup({ verbs });
      writeFileSync(s.marker, '');
      const r = await post(s.app, { on: false });
      expect(r.statusCode, JSON.stringify(verbs)).toBe(200);
      expect(existsSync(s.marker)).toBe(false);
      expect(s.argvs).toEqual([[VERB, '--state', 'off']]);
    }
  });

  it('a change is one record-only feed row naming the move; the same state again writes none', async () => {
    const s = setup();
    await post(s.app, { on: true });
    await post(s.app, { on: true });
    const rows = s.feed.filter((l) => l.startsWith('delegation keep switch changed'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('clear -> set');
  });

  it('on replaces a dangling link with a file, and off removes a dangling link', async () => {
    const s = setup();
    symlinkSync(path.join(s.h.home, 'nowhere'), s.marker);
    await post(s.app, { on: true });
    expect(lstatSync(s.marker).isFile()).toBe(true);
    await post(s.app, { on: false });
    symlinkSync(path.join(s.h.home, 'nowhere'), s.marker);
    await post(s.app, { on: false });
    expect(() => lstatSync(s.marker), 'the dangling link is gone too').toThrow(/ENOENT/);
  });

  it('any body but {on: boolean} is refused and runs nothing', async () => {
    const s = setup();
    for (const bad of [undefined, {}, { on: 'true' }, { on: 1 }, { on: true, state: 'on' }, { state: 'on' }, ['on']]) {
      expect((await post(s.app, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(s.argvs).toEqual([]);
    expect(existsSync(s.marker)).toBe(false);
  });

  it('a raise that fails answers 502 with the verb\'s words, and leaves no temp behind', async () => {
    const s = setup();
    mkdirSync(path.join(s.marker, 'x'), { recursive: true });   // a directory in the marker's place: the rename cannot land
    const r = await post(s.app, { on: true });
    expect(r.statusCode).toBe(502);
    expect(r.json().stderr).toMatch(/could not raise the adoption switch/);
    expect(readdirSync(s.reg).filter((n) => n.startsWith('.delegation-adopt.'))).toEqual([]);
    // Review 1659 F10: the directory reads `set` by name, so the GET says the switch is on; neither arm can clear it (a hand step).
    expect((await get(s.app)).json().state).toBe('set');
    expect((await post(s.app, { on: false })).statusCode, 'off cannot remove a directory, and says so').toBe(502);
  });

  it('a verb that never ran answers its own reason, never the forged code\'s words (D-6840)', async () => {
    const s = setup({ runner: async () => ({ ran: false, reason: 'transport', detail: 'the link dropped', code: 1, stdout: '', stderr: 'forged' }) });
    const r = await post(s.app, { on: true });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ ok: false, error: 'fleetFailed',
      detail: notRanSentence('ccd delegation-adopt', { ran: false, reason: 'transport', detail: 'the link dropped' }) });
    expect(existsSync(s.marker)).toBe(false);
  });
});

describe('the verb itself, on a fixture HOME (D-8112)', () => {
  it('ccd caps lists it, and a bad usage writes nothing', () => {
    const h = makeCcdHarness('ccrc-delegation-adopt-verb-');
    harnesses.push(h);
    expect(h.sh('cmd_caps').split('\n')).toContain(VERB);
    for (const bad of ['', '--state', '--state maybe', 'on', '--state on extra']) {
      expect(h.sh(`( cmd_delegation_adopt ${bad} ) >/dev/null 2>&1; echo "[rc=$?]"`), bad).not.toContain('[rc=0]');
    }
    expect(existsSync(path.join(h.home, '.cc-sessions', DELEGATION_ADOPT_MARKER))).toBe(false);
  });
});

describe('R1: the verb is forbidden to every session (D-8112)', () => {
  it('FORBIDDEN_CCD_VERBS names it, and the classifier sends a session\'s call straight to the operator', () => {
    expect(FORBIDDEN_CCD_VERBS).toContain(VERB);
    const ctx = { worktree: '/w/demo', tmpRoot: '/tmp/t', scratch: null, home: '/home/u', cwd: '/w/demo' };
    for (const cmd of [`ccd ${VERB} --state on`, `ccd ${VERB} --state off`, `~/.local/bin/ccd ${VERB} --state on`]) {
      expect(approvalClass('Bash', { command: cmd }, ctx), cmd).toBe('forbidden');
    }
    expect(approvalClass('Bash', { command: 'ccd ls' }, ctx), 'CONTROL: a plain verb is not forbidden').not.toBe('forbidden');
  });
});
