// The server's own facts and the reader (Overlord W1, plan `w1-isolation.md` Task 3): `measureServerFacts` over a
// synthetic tree of stats (no live path, mode or uid is read), and `makeIsolationReader` over a live `FleetState` object.
import { describe, expect, it } from 'vitest';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import type { FleetState } from '../src/fleetstate.js';
import { makeIsolationReader, measureServerFacts, type MeasuredServer, type ServerSeams } from '../src/isolationFacts.js';
import { hostDigest } from '../../shared/host-identity.mjs';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const HOME = '/h/u';
const SERVER_UID = 1000;
const MACHINE = 'a'.repeat(32);
const BOOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
type St = { uid: number; mode: number; dir: boolean; link: boolean };
const dir = (mode: number, uid = SERVER_UID): St => ({ uid, mode, dir: true, link: false });
const file = (mode: number, uid = SERVER_UID): St => ({ uid, mode, dir: false, link: false });
const link = (uid = SERVER_UID): St => ({ uid, mode: 0o777, dir: false, link: true });

/** A synthetic tree: every held path's chain, owner-only by default. */
function tree(over: Record<string, St | 'unmeasured' | undefined> = {}): Record<string, St | 'unmeasured' | undefined> {
  return {
    '/': dir(0o755, 0), '/h': dir(0o755, 0), [HOME]: dir(0o700), [`${HOME}/.ccrc`]: dir(0o700),
    [`${HOME}/.config`]: dir(0o700), [`${HOME}/.config/systemd`]: dir(0o700), [`${HOME}/.config/systemd/user`]: dir(0o700),
    '/code': dir(0o755), ...over,
  };
}
function seams(t: Record<string, St | 'unmeasured' | undefined>, opts: Partial<{ links: Record<string, string>; uidMap: string | 'unmeasured'; overflow: string | 'unmeasured'; platform: string; uid: number | undefined }> = {}): ServerSeams {
  const links = opts.links ?? {};
  return {
    lstat: (p) => { const v = t[p]; return v === undefined ? 'absent' : v; },
    readlink: (p) => links[p] ?? 'unmeasured',
    readText: (p) => p.endsWith('uid_map') ? (opts.uidMap ?? '         0          0 4294967295\n') : p.endsWith('overflowuid') ? (opts.overflow ?? '65534\n') : 'unmeasured',
    uid: () => ('uid' in opts ? opts.uid : SERVER_UID),
    hostIds: () => ({ machine: MACHINE, boot: BOOT }),
    procRoot: '/proc',
    platform: opts.platform ?? 'linux',
  };
}
/** A real config from a seeded temp home, every path re-rooted at the synthetic `HOME`. */
const CFG: CcrcConfig = (() => {
  const tmp = mkTmp('ccrc-isofacts-');
  seedRoster(tmp);
  const cfg = loadConfig({ CCRC_HOME: tmp }) as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, typeof v === 'string' && v.startsWith(tmp) ? HOME + v.slice(tmp.length) : v])) as unknown as CcrcConfig;
})();
const facts = (s: ServerSeams) => measureServerFacts(CFG, '/code', {}, s).facts;
const exposureOf = (s: ServerSeams, name: string) => facts(s).holdings.find((h) => h.name === name);

describe('measureServerFacts', () => {
  it('an owner-only home measures every holding owner-only, and the server facts measured', () => {
    const f = facts(seams(tree()));
    expect([f.uid, f.initialNamespace, f.overflowUid]).toEqual([SERVER_UID, true, 65534]);
    expect(f.holdings.map((h) => h.exposure)).toEqual(f.holdings.map(() => 'owner-only'));
    expect(f.holdings.map((h) => h.name)).toContain('operatorModelDbPath');
  });

  it('a 0755 ~/.ccrc under a 0755 home is read-exposed: the default install reads store-mode (question 21)', () => {
    expect(exposureOf(seams(tree({ [HOME]: dir(0o755), [`${HOME}/.ccrc`]: dir(0o755) })), 'ccrcDir')!.exposure).toBe('exposed');
  });

  it('an identity uid_map is the initial namespace, a mapped one is not, an unreadable one is unmeasured', () => {
    expect(facts(seams(tree(), { uidMap: '0 1000 1\n' })).initialNamespace).toBe(false);
    expect(facts(seams(tree(), { uidMap: '0 0 4294967295\n0 0 1\n' })).initialNamespace).toBe(false);
    expect(facts(seams(tree(), { uidMap: 'unmeasured' })).initialNamespace).toBe('unmeasured');
  });

  it('the overflow uid read, and unreadable or malformed', () => {
    expect(facts(seams(tree(), { overflow: '65533\n' })).overflowUid).toBe(65533);
    expect(facts(seams(tree(), { overflow: 'unmeasured' })).overflowUid).toBe('unmeasured');
    expect(facts(seams(tree(), { overflow: 'x\n' })).overflowUid).toBe('unmeasured');
  });

  it('off Linux the namespace and the overflow uid read unmeasured', () => {
    const f = facts(seams(tree(), { platform: 'darwin' }));
    expect([f.initialNamespace, f.overflowUid]).toEqual(['unmeasured', 'unmeasured']);
  });

  it('an unreadable uid reads unmeasured', () => {
    expect(facts(seams(tree(), { uid: undefined })).uid).toBe('unmeasured');
  });

  it('a symbolic ~/.ccrc is followed: its target chain and the directories holding the link are both measured', () => {
    const links = { [`${HOME}/.ccrc`]: '/data/ccrc' };
    const base = tree({ [`${HOME}/.ccrc`]: link(), '/data': dir(0o755, 0), '/data/ccrc': dir(0o700) });
    expect(exposureOf(seams(base, { links }), 'ccrcDir')!.exposure).toBe('owner-only');
    // The target's chain: a writable directory above the real store exposes it.
    expect(exposureOf(seams({ ...base, '/data': dir(0o777, 0) }, { links }), 'ccrcDir')!.exposure).toBe('exposed');
    // The link's own chain: whoever can write the directory holding the link can redirect the store.
    expect(exposureOf(seams({ ...base, [HOME]: dir(0o777) }, { links }), 'ccrcDir')!.exposure).toBe('exposed');
    // An owner of the target's chain is among the owners.
    expect(exposureOf(seams({ ...base, '/data': dir(0o755, 2000) }, { links }), 'ccrcDir')!.owners).toEqual([2000]);
  });

  // F1 of the review: the chain is established whole, link after link, or it is unmeasured. Synthetic trees only.
  describe('a chain through more than one link', () => {
    const links = { [`${HOME}/.ccrc`]: '/srv/x/ccrc', '/srv/x': '/vol/x' };
    const base = tree({ [`${HOME}/.ccrc`]: link(), '/srv': dir(0o755, 0), '/srv/x': link(), '/vol': dir(0o755, 0), '/vol/x': dir(0o755, 0), '/vol/x/ccrc': dir(0o700) });

    it('the measured control: every element owner-only reads owner-only', () => {
      expect(exposureOf(seams(base, { links }), 'coordDbPath')).toEqual({ name: 'coordDbPath', owners: [], exposure: 'owner-only' });
    });

    it('the directory holding the second link is measured: a writable one exposes the store', () => {
      expect(exposureOf(seams({ ...base, '/srv': dir(0o777, 0) }, { links }), 'coordDbPath')!.exposure).toBe('exposed');
    });

    it("the second link's owner is among the owners, in a sticky directory too", () => {
      const t = { ...base, '/srv': dir(0o1777, 0), '/srv/x': link(2000) };
      expect(exposureOf(seams(t, { links }), 'coordDbPath')).toEqual({ name: 'coordDbPath', owners: [2000], exposure: 'owner-only' });
    });

    it('a relative target is resolved from the directory holding the link', () => {
      const rel = { [`${HOME}/.ccrc`]: '../store/ccrc' };
      const t = tree({ [`${HOME}/.ccrc`]: link(), '/h/store': dir(0o755, 0), '/h/store/ccrc': dir(0o700) });
      expect(exposureOf(seams(t, { links: rel }), 'coordDbPath')!.exposure).toBe('owner-only');
      expect(exposureOf(seams({ ...t, '/h/store': dir(0o777, 0) }, { links: rel }), 'coordDbPath')!.exposure).toBe('exposed');
    });

    it("an unreadable link's target reads the holding unmeasured", () => {
      expect(exposureOf(seams(base, { links: { [`${HOME}/.ccrc`]: '/srv/x/ccrc' } }), 'coordDbPath')!.exposure).toBe('unmeasured');
    });

    it('an unreadable element met after the second link reads the holding unmeasured', () => {
      expect(exposureOf(seams({ ...base, '/vol': 'unmeasured' }, { links }), 'coordDbPath')!.exposure).toBe('unmeasured');
    });

    it('a link loop reads unmeasured, within the step bound', () => {
      const loop = { [`${HOME}/.ccrc`]: '/a', '/a': `${HOME}/.ccrc` };
      expect(exposureOf(seams(tree({ [`${HOME}/.ccrc`]: link(), '/a': link() }), { links: loop }), 'coordDbPath')!.exposure).toBe('unmeasured');
    });

    it('a path below something that is not a directory reads unmeasured', () => {
      expect(exposureOf(seams(tree({ [`${HOME}/.ccrc`]: file(0o600) })), 'coordDbPath')!.exposure).toBe('unmeasured');
    });
  });

  it('an absent store is measured at its nearest existing ancestor', () => {
    const f = exposureOf(seams(tree()), 'coordDbPath')!;
    expect(f.exposure).toBe('owner-only');
    expect(exposureOf(seams(tree({ [`${HOME}/.ccrc`]: undefined, [HOME]: dir(0o775) })), 'coordDbPath')!.exposure).toBe('exposed');
  });

  it('an unreadable element reads that holding unmeasured, and only that one', () => {
    const f = facts(seams(tree({ '/code': 'unmeasured' })));
    expect(f.holdings.find((h) => h.name === 'codeRoot')).toEqual({ name: 'codeRoot', owners: 'unmeasured', exposure: 'unmeasured' });
    expect(f.holdings.find((h) => h.name === 'ccrcDir')!.exposure).toBe('owner-only');
  });
});

describe('makeIsolationReader', () => {
  const measured = (): MeasuredServer => measureServerFacts(CFG, '/code', {}, seams(tree()));
  const BEARER = 'link-bearer';
  const sd = { machine: hostDigest(BEARER, 'machine', MACHINE), boot: hostDigest(BEARER, 'boot', BOOT) };

  it('local mode reads shared-user, local-mode', () => {
    expect(makeIsolationReader('local', measured(), null, null).read()).toEqual({ kind: 'measured', word: 'shared-user', cause: 'local-mode' });
  });

  it('remote mode over a live FleetState: no ready, a ready, a close, then a ready from an older agent', () => {
    const state: FleetState = { connected: false, downSince: null, ccdVerbs: null, rosterFp: null, build: null };
    const r = makeIsolationReader('remote', measured(), BEARER, state);
    expect(r.read()).toEqual({ kind: 'unmeasured', why: 'no-agent' });
    Object.assign(state, { connected: true, hostReport: { uid: 3000, ...sd }, peer: { locality: 'local', uid: 3000 }, readySerial: 1 });
    expect(r.read()).toEqual({ kind: 'measured', word: 'separate-user', cause: 'other-user' });
    expect(r.relationOf(r.linkOf(state))).toBe('same-host');
    Object.assign(state, { connected: false });
    expect(r.read()).toEqual({ kind: 'unmeasured', why: 'link-down' });
    Object.assign(state, { connected: true, hostReport: 'absent', peer: { locality: 'local', uid: 3000 }, readySerial: 2 });
    expect(r.read()).toEqual({ kind: 'unmeasured', why: 'agent-older' });
    Object.assign(state, { hostReport: { uid: 1000, ...sd }, peer: { locality: 'local', uid: 1000 } });
    expect(r.read()).toEqual({ kind: 'measured', word: 'shared-user', cause: 'same-user' });
  });

  it("digests the server's ids under the link's bearer: another bearer's report is another kernel", () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null,
      hostReport: { uid: 3000, machine: hostDigest('other', 'machine', MACHINE), boot: hostDigest('other', 'boot', BOOT) },
      peer: { locality: 'local', uid: 3000 }, readySerial: 1 };
    expect(makeIsolationReader('remote', measured(), BEARER, state).read()).toEqual({ kind: 'unmeasured', why: 'forwarded' });
    expect(makeIsolationReader('remote', measured(), null, state).read()).toEqual({ kind: 'unmeasured', why: 'host-unmeasured' });
  });

  it('the carrier: local mode is stable within a reader and unrelated across readers; remote mode is the report at its serial', () => {
    const a = makeIsolationReader('local', measured(), null, null);
    const b = makeIsolationReader('local', measured(), null, null);
    expect(a.wakingHostKey()).toEqual(a.wakingHostKey());
    expect(a.wakingHostKey()).not.toEqual(b.wakingHostKey());
    expect(JSON.stringify(a.wakingHostKey())).not.toContain(MACHINE);
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null,
      hostReport: { uid: 3000, ...sd }, peer: { locality: 'local', uid: 3000 }, readySerial: 4 };
    expect(makeIsolationReader('remote', measured(), BEARER, state).wakingHostKey()).toEqual({ digest: sd.machine, keyEpoch: 4 });
    expect(makeIsolationReader('remote', measured(), BEARER, null).wakingHostKey()).toBe('unmeasured');
  });
});
