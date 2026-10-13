// Path identity W1a (spec §2.3): the expiry lane's executor boundary. `expireArchived` and `learnExpiry` each ask
// `isRegistryId` of the session id first — before the capability, before the registry listing, before the store — so
// an id that is not a registry id reaches neither `CCD_ARGV.wsExpireAudit` nor `CCD_ARGV.wsExpire`. The lane's
// population is registry-derived and already omits such a row; this pins the executor's OWN re-check. A scripted ccd
// in a fixture HOME answers; nothing here reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, learnExpiry, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { EDGE_ACCEPTED_IDS, REFUSED_IDS } from './registryIdCases.js';

const ARCH = 1_789_000_000;
const DUE = ARCH + 86_400;
/** The words both refusals carry; the constant itself is module-private to the executor. */
const REFUSED_TEXT = 'the server refused this session id';

const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] };
/** The same box with `expire-v1` withdrawn: a guard that sat behind the capability would answer `unsupported` here. */
const NO_EXPIRE: FleetState = { ...CAPS, ccdVerbs: ['ws-audit', 'ws-expire', ACTOR_FLAGS_CAP] };
const VARIANTS: readonly (readonly [string, FleetState])[] = [
  [`with ${EXPIRE_CAP}`, CAPS],
  [`without ${EXPIRE_CAP}`, NO_EXPIRE],
];

/** A minimal executor rig: a fixture HOME with an empty registry, a runner that records every argv and answers exit 1
 *  with no document, and an `io` that counts listings. */
const rig = (caps: FleetState) => {
  const home = mkTmp('ccrc-expire-id-boundary-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return { code: 1, stdout: '', stderr: `scripted: ${args[0] ?? ''} answers nothing here` };
  };
  const base = testDeps(home, run);
  const listings: string[] = [];
  const io = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      listings.push(p);
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const deps: ExpireArchivedDeps = {
    coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
    io, cfg: base.cfg, runCcd: base.runCcd, fleetState: caps,
  };
  return { deps, calls, listings };
};

describe('expiry refuses a non-registry id before either builder (spec §2.3)', () => {
  it.each([...REFUSED_IDS])('expireArchived for %s answers composition, saying the server refused the id; no call', async (id) => {
    for (const [label, caps] of VARIANTS) {
      const s = rig(caps);
      const out = await expireArchived(s.deps, { sessionId: id, archivedAt: ARCH, expiresAt: DUE });
      expect(s.calls, `${label}: no ccd call`).toEqual([]);
      expect(s.listings, `${label}: no registry listing`).toEqual([]);
      expect(out, label).toMatchObject({
        kind: 'composition', sessionId: id, archivedAt: ARCH, expiresAt: DUE,
        detail: expect.stringContaining(REFUSED_TEXT),
      });
    }
  });

  it.each([...REFUSED_IDS])('learnExpiry for %s answers unreadable; no call', async (id) => {
    for (const [label, caps] of VARIANTS) {
      const s = rig(caps);
      const read = await learnExpiry({ runCcd: s.deps.runCcd, fleetState: caps }, id);
      expect(s.calls, `${label}: no ccd call`).toEqual([]);
      expect(read, label).toEqual({ kind: 'unreadable', detail: expect.stringContaining(REFUSED_TEXT) });
    }
  });

  it('controls: a--actor and a 255-character id compose their ws-audit', async () => {
    for (const id of EDGE_ACCEPTED_IDS) {
      const s = rig(CAPS);
      const out = await expireArchived(s.deps, { sessionId: id, archivedAt: ARCH, expiresAt: DUE });
      expect(s.calls, `expireArchived ${id}`).toEqual([['ws-audit', '--session', id, '--expire']]);
      expect(out, `expireArchived ${id}`).toMatchObject({ kind: 'audit-failed', sessionId: id });

      const l = rig(CAPS);
      const read = await learnExpiry({ runCcd: l.deps.runCcd, fleetState: CAPS }, id);
      expect(l.calls, `learnExpiry ${id}`).toEqual([['ws-audit', '--session', id, '--expire']]);
      expect(read, `learnExpiry ${id}`).toMatchObject({ kind: 'unreadable' });
      expect((read as { detail: string }).detail, `learnExpiry ${id}`).not.toContain(REFUSED_TEXT);
    }
  });
});
