// The server's own facts and the reader (Overlord W1, plan `w1-isolation.md` Task 3): `measureServerFacts` over a
// synthetic tree of stats (no live path, mode or uid is read), and `makeIsolationReader` over a live `FleetState` object.
import { mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import type { FleetState } from '../src/fleetstate.js';
import { codeRootOf, makeIsolationReader, measureServerFacts, realServerSeams, type MeasuredServer, type ServerSeams } from '../src/isolationFacts.js';
import { hostDigest } from '../../shared/host-identity.mjs';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, readlinkSync: vi.fn(fs.readlinkSync) };
});

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
const BEARER = 'link-bearer';
const sd = { machine: hostDigest(BEARER, 'machine', MACHINE), boot: hostDigest(BEARER, 'boot', BOOT) };
const remoteRead = (measured: MeasuredServer) => makeIsolationReader('remote', measured, BEARER, {
  connected: true, hostReport: { uid: 3000, ...sd }, peer: { locality: 'local', uid: 3000 }, readySerial: 1,
}).read();

function codeTree(): { root: string; entry: string; packageDir: string } {
  const root = mkTmp('ccrc-isocode-');
  // All eight search levels stay inside the fixture, even with no package marker.
  const packageDir = path.join(root, 'server');
  const entry = path.join(packageDir, 'a/b/c/d/e/f/g/index.js');
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(entry, '');
  return { root, entry, packageDir };
}

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

  it.each([
    ['absolute target', '/data/ccrc', '/data'],
    ['relative target above the link directory', '../store/ccrc', '/h/store'],
  ])('only the resolved ancestry guards a secret: %s', (_label, target, parent) => {
    const holding = `${parent}/ccrc`;
    const links = { [`${HOME}/.ccrc`]: target };
    const t = tree({ [`${HOME}/.ccrc`]: link(), [parent]: dir(0o755, 0), [holding]: dir(0o755), [`${holding}/coord.db`]: file(0o644) });
    const measured = (mode: number) => measureServerFacts(CFG, '/code', {}, seams({ ...t, [parent]: dir(mode, 0) }, { links }));
    const open = measured(0o755);
    expect(open.facts.holdings.find((h) => h.name === 'coordDbPath')).toEqual({ name: 'coordDbPath', owners: [], exposure: 'exposed' });
    expect(remoteRead(open)).toEqual({ kind: 'measured', word: 'shared-user', cause: 'store-mode' });
    const guarded = measured(0o700);
    expect(guarded.facts.holdings.find((h) => h.name === 'coordDbPath')).toEqual({ name: 'coordDbPath', owners: [], exposure: 'owner-only' });
    expect(remoteRead(guarded)).toEqual({ kind: 'measured', word: 'separate-user', cause: 'other-user' });
  });

  it('resolves a parent step after an input-path link, not before it', () => {
    const alias = `${HOME}/alias`;
    const t = tree({ [alias]: link(), '/data': dir(0o755, 0), '/data/child': dir(0o755),
      '/data/store': dir(0o755), '/data/store/coord.db': file(0o644) });
    const measured = measureServerFacts({ ...CFG, coordDbPath: `${alias}/../store/coord.db` }, '/code', {},
      seams(t, { links: { [alias]: '/data/child' } }));
    expect(measured.facts.holdings.find((h) => h.name === 'coordDbPath')?.exposure).toBe('exposed');
    expect(remoteRead(measured)).toEqual({ kind: 'measured', word: 'shared-user', cause: 'store-mode' });
  });

  it('retains measured read exposure when the server uid is unmeasured', () => {
    const s = seams(tree({ [HOME]: dir(0o755), [`${HOME}/.ccrc`]: dir(0o755) }), { uid: undefined });
    const measured = measureServerFacts(CFG, '/code', {}, s);
    expect(measured.facts.uid).toBe('unmeasured');
    expect(measured.facts.holdings.find((h) => h.name === 'ccrcDir')?.exposure).toBe('exposed');
    expect(remoteRead(measured)).toEqual({ kind: 'measured', word: 'shared-user', cause: 'store-mode' });
  });

  // F1 of the first review: the chain is established whole, link after link, or it is unmeasured. Synthetic trees only.
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

describe('realServerSeams link-target decoding', () => {
  it.each([
    ['undecodable bytes', Buffer.from([0xc3]), 'unmeasured'],
    ['valid text', Buffer.from('﻿fixture-�', 'utf8'), '﻿fixture-�'],
  ])('preserves the measurement distinction for %s', (_label, bytes, expected) => {
    // Substitute only the OS read; do not create or resolve any filesystem path for these bytes.
    vi.mocked(readlinkSync).mockImplementationOnce((_p, options?: string | { encoding?: string | null } | null) =>
      (typeof options === 'string' ? options : options?.encoding) === 'buffer' ? bytes : bytes.toString('utf8'));
    expect(realServerSeams().readlink('fixture')).toBe(expected);
  });
});

describe('realServerSeams over fixture paths', () => {
  it('measures file mode and kind, reads link targets and bounded text, and distinguishes failure from absence', () => {
    const root = mkTmp('ccrc-isoadapter-');
    const plain = path.join(root, 'plain');
    const alias = path.join(root, 'alias');
    const absent = path.join(root, 'absent');
    const tooLong = path.join(root, 'x'.repeat(4096));
    writeFileSync(plain, 'fixture text', { mode: 0o600 });
    symlinkSync('plain', alias);
    const io = realServerSeams();
    expect(io.lstat(plain)).toMatchObject({ mode: 0o600, dir: false, link: false });
    expect(io.lstat(root)).toMatchObject({ dir: true, link: false });
    expect(io.lstat(alias)).toMatchObject({ dir: false, link: true });
    expect(io.readlink(alias)).toBe('plain');
    expect(io.readlink(plain)).toBe('unmeasured');
    expect(io.readText(plain)).toBe('fixture text');
    expect(io.readText(absent)).toBe('unmeasured');
    expect(io.readText(tooLong)).toBe('unmeasured');
    writeFileSync(plain, 'x'.repeat(64 * 1024 + 1));
    expect(io.readText(plain)).toBe('unmeasured');
    expect(io.lstat(absent)).toBe('absent');
    expect(io.lstat(path.join(plain, 'child'))).toBe('absent');
    expect(io.lstat(tooLong)).toBe('unmeasured');
  });

  it('an adapter error does not prove isolation at its otherwise guarded parent', () => {
    const root = mkTmp('ccrc-isoerror-');
    const io = realServerSeams();
    const synthetic = seams(tree());
    const measure = (leaf: string) => {
      const coordDbPath = `${HOME}/.ccrc/${leaf}`;
      // Only the selected leaf uses real I/O, under the fixture root. Host identity and every ancestor are synthetic.
      return measureServerFacts({ ...CFG, coordDbPath }, '/code', {}, {
        ...synthetic, lstat: (p) => p === coordDbPath ? io.lstat(path.join(root, leaf)) : synthetic.lstat(p),
      });
    };
    const failed = measure('x'.repeat(4096));
    expect(failed.facts.holdings.find((h) => h.name === 'coordDbPath')).toEqual({ name: 'coordDbPath', owners: 'unmeasured', exposure: 'unmeasured' });
    expect(remoteRead(failed)).toEqual({ kind: 'unmeasured', why: 'server-facts' });
    const absent = measure('absent');
    expect(absent.facts.holdings.find((h) => h.name === 'coordDbPath')).toEqual({ name: 'coordDbPath', owners: [], exposure: 'owner-only' });
    expect(remoteRead(absent)).toEqual({ kind: 'measured', word: 'separate-user', cause: 'other-user' });
  });
});

describe('codeRootOf', () => {
  it('uses the parent of the established server package, not the entry directory', () => {
    const { root, entry, packageDir } = codeTree();
    writeFileSync(path.join(packageDir, 'package.json'), '{}');
    expect(codeRootOf(entry)).toBe(root);
  });

  it('no established package leaves the code holding and composed verdict unmeasured', () => {
    const { entry } = codeTree();
    const root = codeRootOf(entry);
    expect(root).toBe('unmeasured');
    const measured = measureServerFacts(CFG, root, {}, seams(tree()));
    expect(measured.facts.holdings.find((h) => h.name === 'codeRoot')).toEqual({ name: 'codeRoot', owners: 'unmeasured', exposure: 'unmeasured' });
    expect(remoteRead(measured)).toEqual({ kind: 'unmeasured', why: 'server-facts' });
  });

  it('does not follow a symlink marker or skip it to use a higher package', () => {
    const { entry, packageDir } = codeTree();
    writeFileSync(path.join(packageDir, 'package.json'), '{}');
    symlinkSync('package.json', path.join(path.dirname(entry), 'package.json'));
    expect(codeRootOf(entry)).toBe('unmeasured');
  });

  it('does not treat a failed marker measurement as absence', () => {
    const { packageDir } = codeTree();
    writeFileSync(path.join(packageDir, 'package.json'), '{}');
    symlinkSync('blocked', path.join(packageDir, 'blocked'));
    expect(codeRootOf(path.join(packageDir, 'blocked/index.js'))).toBe('unmeasured');
  });

  it('does not treat a directory with the marker name as a server package', () => {
    const { entry, packageDir } = codeTree();
    mkdirSync(path.join(packageDir, 'package.json'));
    expect(codeRootOf(entry)).toBe('unmeasured');
  });
});

describe('makeIsolationReader', () => {
  const measured = (): MeasuredServer => measureServerFacts(CFG, '/code', {}, seams(tree()));

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

  it('the reader relation stays conservative for a non-local peer', () => {
    const r = makeIsolationReader('remote', measured(), BEARER, null);
    const nonLocal = { link: 'ready', peer: { locality: 'not-local', uid: 'unmeasured' }, serverDigests: sd, readySerial: 1 } as const;
    expect(r.relationOf({ ...nonLocal, report: { uid: 3000, ...sd } })).toBe('same-host');
    expect(r.relationOf({ ...nonLocal, report: { uid: 3000, machine: 'unmeasured', boot: 'unmeasured' } })).toBe('unmeasured');
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
