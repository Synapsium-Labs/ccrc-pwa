// releaseWaiting (D-6327): which release waits, and the sentence that names it — the decision the fleet's update line
// and Settings › Updates both read. Moved unchanged from update-banner.test.tsx (the banner's "speaks" and "stays
// silent" cases): the same fixtures, case names and expected strings, asserted on the pure functions instead of a
// rendered component.
import { describe, expect, it } from 'vitest';
import type { FleetHealth, NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { bannerRelease, releaseWaitingWords, updateBannerText } from '../src/fleet/releaseWaiting';

const NOW = Date.now();
const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';

/** A stamp; `version` omitted = an unversioned (deploy.sh) build. */
const stamp = (version?: string): BuildInfo => ({
  sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});

/** A measured, reachable, stable-channel fleet node on v0.0.7 whose desired is
 *  v0.0.9 — every case edits the one field it is about. */
const fleetNode = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.7'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: 'v0.0.7', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
/** The server's own row: no agent by construction (`agentOps: null`). */
const serverNode = (over: Partial<NodeWire> = {}): NodeWire =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });

const view = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: NOW - 4 * 60_000, lastError: null },
  releases: [],
  nodes: [fleetNode(), serverNode()],
  intent: [],
  ...over,
});

describe('releaseWaiting — when it speaks', () => {
  it('names a newer release: the tag, the channel, and what the fleet runs', () => {
    expect(updateBannerText(view())).toBe('v0.0.9 is out on stable — fleet and server are on v0.0.7.');
  });

  it('names each side when the two boxes disagree — the per-node form', () => {
    expect(updateBannerText(view({
      nodes: [fleetNode(), serverNode({ current: stamp('v0.0.9'), highestVersion: 'v0.0.9' })],
    }))).toBe('v0.0.9 is out on stable — fleet v0.0.7 · server v0.0.9.');
  });

  it('counts an unversioned node as behind, and the summary says unversioned', () => {
    expect(updateBannerText(view({
      nodes: [fleetNode({ current: stamp() }), serverNode({ current: stamp('v0.0.9') })],
    }))).toBe('v0.0.9 is out on stable — fleet unversioned · server v0.0.9.');
  });

  it('reports a never-measured row as a MISSING side, not as an unversioned one', () => {
    // The server is measured and behind, so the banner speaks; the fleet row is
    // a placeholder nobody has measured. "unversioned" would state a
    // measurement nobody made — the summary says the side is missing instead.
    expect(updateBannerText(view({
      nodes: [fleetNode({ measuredAt: null, current: null, stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown', caps: [], os: 'unknown', highestVersion: null, floorRead: 'unmeasured', previousRead: 'unmeasured', reachable: false, unreachableSince: NOW - 60_000 }), serverNode()],
    }))).toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it("sides are picked from EVERY row, never a pre-filtered subset — two rows share the fleet role, and dropping the unstated one first would change the answer (W5 review 161, F-D)", () => {
    // Every other case here carries at most ONE row per role, so a caller that
    // filtered to the rows that vouch (`statedOf`) BEFORE picking sides would
    // agree with one that did not. Here two LIVE rows are both `role: 'fleet'`:
    // the first never read its stamp (it occupies the side and renders the
    // dash), the second is fully stated on v0.0.8. `versionSides` takes the
    // FIRST fleet row it finds, so the side is the dash; a pre-filter would
    // drop the first and let the second stand in, naming `v0.0.8`.
    expect(updateBannerText(view({
      nodes: [
        fleetNode({ current: null, stampRead: 'unreadable' }),
        fleetNode({ nodeId: '7c1d4e9a-3b5f-4a28-8d6e-0f9b2a4c6e81', label: 'fleet-2', current: stamp('v0.0.8') }),
        serverNode(),
      ],
    }))).toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it('reads a MEASURED but UNREAD stamp as a MISSING side, never as unversioned (D-3307)', () => {
    // The fleet row HAS been measured (`measuredAt` is set — W5 review 161,
    // F-I: `statedOf` asks "ever measured", never "measured this sweep"), but
    // its stamp did not read (a
    // local-mode box that cannot read its own build.json). Only the server
    // side is behind, so the banner speaks off the server's arrow alone; the
    // fleet side must still read as missing, not "unversioned" — that word
    // would claim a version measurement nobody made.
    expect(updateBannerText(view({
      nodes: [fleetNode({ current: null, stampRead: 'unreadable' }), serverNode()],
    }))).toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it('reads a lone both row as both sides ONLY in explicit local mode — unknown/no health states no fleet version (fix round 2, item 3)', () => {
    // Inverted, review of d5aefc4a: the local both-row fallback nobody
    // measured must not fire while the fleet mode is UNKNOWN (health null,
    // the default before it has loaded) — only an EXPLICIT local health
    // earns it.
    expect(updateBannerText(view({ nodes: [serverNode({ role: 'both' })] }), { mode: 'local', connected: true, downSince: null }))
      .toBe('v0.0.9 is out on stable — fleet and server are on v0.0.7.');
  });

  it("picks the NEWEST pending tag in semver order — v0.0.10 over v0.0.9 — with that node's channel", () => {
    // String order puts 'v0.0.9' above 'v0.0.10'; both node orders are checked,
    // so neither first-wins nor last-wins can pass by accident.
    expect(updateBannerText(view({
      nodes: [fleetNode({ desiredTag: 'v0.0.9' }), serverNode({ channel: 'dev', desiredTag: 'v0.0.10' })],
    }))).toBe('v0.0.10 is out on dev — fleet and server are on v0.0.7.');
    expect(bannerRelease(view({
      nodes: [serverNode({ channel: 'dev', desiredTag: 'v0.0.10' }), fleetNode({ desiredTag: 'v0.0.9' })],
    }))).toEqual({ tag: 'v0.0.10', channel: 'dev' });
  });
});

describe('releaseWaiting — when it stays silent (unreachable is not current, spec §7 and §18)', () => {
  /** Silent: no sentence and no waiting release. */
  const silent = (v: UpdatesView): void => {
    expect(updateBannerText(v)).toBeNull();
    expect(bannerRelease(v)).toBeNull();
  };

  it('is silent when every node runs its desired tag, and when a desired is OLDER than what runs', () => {
    silent(view({
      nodes: [
        fleetNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.9' }),
        serverNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.9' }),
      ],
    }));
    silent(view({
      nodes: [fleetNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.7' })],
    }));
  });

  it('is silent while the catalogue has never been reached since the server started (lastOkAt: null)', () => {
    silent(view({
      catalogue: { lastOkAt: null, lastError: { at: NOW - 30_000, reason: 'rate-limited' } },
    }));
    silent(view({ catalogue: { lastOkAt: null, lastError: null } }));
  });

  it('is silent when the only node behind has never been measured (measuredAt: null)', () => {
    // measuredAt is the ONLY field between this fleet row and an arrow: its
    // stamp was read (stampRead 'ok'), it runs v0.0.7 and desires v0.0.9 on
    // stable. A placeholder-shaped row (current null, stampRead 'unreadable') would
    // also be silenced by pendingTag's read-stamp guard, and would keep this
    // case green over a predicate that lost its measuredAt clause (Step 8, 7).
    silent(view({
      nodes: [
        fleetNode({ measuredAt: null }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    }));
  });

  it('is silent when the only node behind is a macOS node — not centrally managed, so it has no arrow', () => {
    // D-3309: pendingTag answers null for os 'darwin', so
    // this banner, BuildLine and the /settings row (which reads the macOS
    // sentence in place of a desired) say the same thing about the same node.
    silent(view({
      nodes: [
        fleetNode({ os: 'darwin' }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    }));
  });

  it('is silent when the only node behind is UNREACHABLE — no arrow, so the banner does not speak on its account (fix round 2, item 4, D-3316)', () => {
    // pendingTag now refuses an unreachable node exactly like an unread
    // stamp (D-3307's own class, widened) — so this node offers nothing to
    // move up to, and the banner has no OTHER node to speak from.
    silent(view({
      nodes: [
        fleetNode({ reachable: false, unreachableSince: NOW - 60_000 }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    }));
  });

  it('is silent when the only node behind has a channel this build cannot name (channel: null)', () => {
    silent(view({
      nodes: [
        fleetNode({ channel: null, resolveDetail: 'the stored channel is not one this build can read' }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    }));
  });
});

describe('releaseWaiting — the D-3313/D-3316 rule (fix round 1, widened fix round 2)', () => {
  const remoteHealth: FleetHealth = { mode: 'remote', connected: true, downSince: null };

  it('states nothing for a fleet side nobody measured — a both row never lends it its version (F1)', () => {
    // The reviewer's exact rows: a server row recorded `both`, and an actual
    // fleet-role row whose stamp did not read. `updateBannerText` no longer
    // pre-filters the nodes before picking sides, so the unreadable fleet
    // row still occupies its role (rather than vanishing from the array,
    // which is exactly what let the `both` row's own version stand in for a
    // fleet nobody measured before this fix).
    expect(updateBannerText(view({
      nodes: [serverNode({ role: 'both' }), fleetNode({ current: null, stampRead: 'unreadable' })],
    }), remoteHealth)).toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it('on a remote fleet, a lone both row never lends its version to the fleet side (D-3313)', () => {
    // Narrower than the case above: no fleet-role row exists at all, so only
    // routing through remoteSides on a remote fleet (never versionSides'
    // both-fallback) tells the two pickers apart.
    expect(updateBannerText(view({ nodes: [serverNode({ role: 'both' })] }), remoteHealth))
      .toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it('with NO health yet (mode unknown), a lone both row states NO fleet version — inverted, review of d5aefc4a item 3', () => {
    // This pin previously read the opposite way (health omitted defaulted to
    // the LOCAL both-fallback). The ruling: while the fleet mode is unknown,
    // a dash claims nothing, but the local fallback would state a fleet
    // version off a box that might turn out to be remote — the exact D-3313
    // hazard, just with "unknown" standing in for "remote". Only an EXPLICIT
    // local health earns the both-fallback (the case right above this one).
    expect(updateBannerText(view({ nodes: [serverNode({ role: 'both' })] })))
      .toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
    // An explicit remote health reads the same way — remoteSides either way.
    expect(updateBannerText(view({ nodes: [serverNode({ role: 'both' })] }), { mode: 'remote', connected: true, downSince: null }))
      .toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it('an unreachable fleet row carrying an old version does not state it, and is not read as current (F14, D-3316)', () => {
    expect(updateBannerText(view({
      nodes: [fleetNode({ reachable: false, unreachableSince: NOW - 60_000 }), serverNode()],
    }))).toBe('v0.0.9 is out on stable — fleet — · server v0.0.7.');
  });

  it("is silent when lastOkAt is a magnitude this build's Date cannot place — the settings catalogue line's own predicate (F13)", () => {
    const v = view({ catalogue: { lastOkAt: 1e20, lastError: null } });
    expect(updateBannerText(v)).toBeNull();
    expect(bannerRelease(v)).toBeNull();
  });
});

describe('releaseWaitingWords (D-6327)', () => {
  it('releaseWaitingWords names the waiting tag, and nothing when none waits', () => {
    expect(releaseWaitingWords(view())).toBe('↑ v0.0.9 available');
    // The newest pending tag in semver order, the same answer `bannerRelease` gives (v0.0.10 above v0.0.9).
    const newest = view({ nodes: [fleetNode({ desiredTag: 'v0.0.9' }), serverNode({ desiredTag: 'v0.0.10' })] });
    expect(releaseWaitingWords(newest)).toBe(`↑ ${bannerRelease(newest)!.tag} available`);
    expect(releaseWaitingWords(newest)).toBe('↑ v0.0.10 available');
    // Nothing waits: every node is on its desired tag, or the catalogue was never reached.
    expect(releaseWaitingWords(view({ nodes: [fleetNode({ desiredTag: 'v0.0.7' }), serverNode({ desiredTag: 'v0.0.7' })] }))).toBeNull();
    expect(releaseWaitingWords(view({ catalogue: { lastOkAt: null, lastError: null } }))).toBeNull();
    expect(releaseWaitingWords(view({ nodes: [] }))).toBeNull();
  });
});
