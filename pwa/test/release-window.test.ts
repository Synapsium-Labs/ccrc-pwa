// The release window of three (D-5505; settings spec §7, §11.4). `releaseWindow`
// is pure, so every fleet state is a fixture: 22 releases unless a case says
// otherwise, the nodes `fleet` and `server`, and a macOS node `mac`. The cap is
// the point (Review focus 1): an unmeasured, unversioned, mixed or all-macOS
// fleet must cap at three per group exactly as a measured one does.
import { describe, expect, it } from 'vitest';
import type { NodeWire, ReleaseWire, UpdateChannel } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import {
  RELEASE_WINDOW_MAX, olderClosingLine, releaseSummary, releaseWindow, rollbackLead,
} from '../src/screens/updates';

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY = 86_400_000;
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '22222222-2222-4222-8222-222222222222';
const MAC_ID = '33333333-3333-4333-8333-333333333333';

const stamp = (version: string | undefined): BuildInfo => ({
  sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-01T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
const node = (version: string | undefined, over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp(version), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: version ?? null, previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: null, resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const server = (version: string | undefined, over: Partial<NodeWire> = {}): NodeWire =>
  node(version, { nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const mac = (version: string | undefined, over: Partial<NodeWire> = {}): NodeWire =>
  node(version, { nodeId: MAC_ID, role: null, label: 'mac', os: 'darwin', ...over });

const tag = (n: number): string => `v0.1.${n}`;
const release = (n: number, over: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag: tag(n), version: tag(n), channel: 'stable', publishedAt: T0 + n * DAY, commitSha: null,
  bundleListed: true, yanked: false, refused: [], notes: null, ...over,
});
/** v0.1.1 … v0.1.22, all Stable unless `over` says otherwise for a number. */
const releases22 = (over: (n: number) => Partial<ReleaseWire> = () => ({})): ReleaseWire[] =>
  Array.from({ length: 22 }, (_, i) => release(i + 1, over(i + 1)));
const tags = (rows: ReadonlyArray<{ release: ReleaseWire }>): string[] => rows.map((r) => r.release.tag);

const uniform = (v: string, over: Partial<NodeWire> = {}): NodeWire[] => [node(v, over), server(v, over)];
const W = (rs: ReleaseWire[], ns: NodeWire[], ch: UpdateChannel | null = 'stable') => releaseWindow(rs, ns, ch);

describe('releaseWindow: the measured window (spec §7.2)', () => {
  it('measured, uniform: the three newest earlier rows, newest first, and olderHidden counting the rest', () => {
    const w = W(releases22(), uniform(tag(22)));
    expect(w.state).toBe('measured');
    expect(RELEASE_WINDOW_MAX).toBe(3);
    expect(tags(w.rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(w.olderHidden).toBe(18);
    expect(w.running?.tag).toBe(tag(22));
    expect(w.running?.release?.tag).toBe(tag(22));
    expect(w.newer).toEqual([]);
    expect(w.mixed).toBeNull();
    expect(w.rule).toBe('stable');
  });

  it('a Stable fleet with 20 newer Dev builds: at most three Newer rows, all Stable, and newerHidden', () => {
    // v0.1.1 runs; v0.1.2 … v0.1.21 are Dev, v0.1.22 alone Stable — plus four more Stable above.
    const rs = [
      ...releases22((n) => (n >= 2 && n <= 21 ? { channel: 'dev' } : {})),
      release(23), release(24), release(25), release(26),
    ];
    const w = W(rs, uniform(tag(1)));
    expect(w.newer.length).toBeLessThanOrEqual(3);
    expect(w.newer.every((r) => r.release.channel === 'stable')).toBe(true);
    expect(tags(w.newer)).toEqual([tag(26), tag(25), tag(24)]);
    expect(w.newerHidden).toBe(2);   // v0.1.23 and v0.1.22: the Stable ones not shown; Dev builds are not counted
  });

  it('a Stable fleet whose three newest earlier rows are Dev skips them; a Dev fleet does not', () => {
    const rs = releases22((n) => (n >= 19 && n <= 21 ? { channel: 'dev' } : {}));
    const stable = W(rs, uniform(tag(22)), 'stable');
    expect(tags(stable.rollback)).toEqual([tag(18), tag(17), tag(16)]);
    expect(stable.rule).toBe('stable');
    const dev = W(rs, uniform(tag(22)), 'dev');
    expect(tags(dev.rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(dev.rule).toBe('dev');
  });

  it('a Dev fleet counts a row whose channel this build cannot name; a Stable fleet does not', () => {
    const rs = releases22((n) => (n === 21 ? { channel: null } : {}));
    expect(tags(W(rs, uniform(tag(22)), 'dev').rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(tags(W(rs, uniform(tag(22)), 'stable').rollback)).toEqual([tag(20), tag(19), tag(18)]);
  });

  it('the fleet\'s shared previousVersion takes the third slot when not among the three, marked "Ran before the last update"; differing previous versions take no slot', () => {
    const rs = releases22();
    const shared = W(rs, uniform(tag(22), { previousVersion: tag(10) }));
    expect(tags(shared.rollback)).toEqual([tag(21), tag(20), tag(10)]);
    expect(shared.rollback.map((r) => r.ranBefore)).toEqual([false, false, true]);
    expect(shared.olderHidden).toBe(18);
    // Already among the three: it keeps its own place, still marked.
    const inside = W(rs, uniform(tag(22), { previousVersion: tag(20) }));
    expect(tags(inside.rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(inside.rollback.map((r) => r.ranBefore)).toEqual([false, true, false]);
    // A Stable fleet that last ran a Dev build still offers it.
    const devPrev = W(releases22((n) => (n === 15 ? { channel: 'dev' } : {})), uniform(tag(22), { previousVersion: tag(15) }));
    expect(tags(devPrev.rollback)).toEqual([tag(21), tag(20), tag(15)]);
    // Differing: no slot.
    const differ = W(rs, [node(tag(22), { previousVersion: tag(10) }), server(tag(22), { previousVersion: tag(11) })]);
    expect(tags(differ.rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(differ.rollback.some((r) => r.ranBefore)).toBe(false);
  });

  it('withdrawn rows counted inside the three, marked, and never in Newer', () => {
    const rs = releases22((n) => (n === 20 || n === 22 ? { yanked: true } : {}));
    const w = W(rs, uniform(tag(19)));
    expect(tags(w.rollback)).toEqual([tag(18), tag(17), tag(16)]);
    expect(tags(w.newer)).toEqual([tag(21)]);   // v0.1.22 and v0.1.20 are withdrawn: never Newer
    const back = W(rs, uniform(tag(22)));
    expect(tags(back.rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(back.rollback[1]!.release.yanked).toBe(true);
  });

  it('a blocked row (no signed bundle on a verified node) is kept in place, not replaced by a fourth', () => {
    const w = W(releases22((n) => (n === 20 ? { bundleListed: false } : {})), uniform(tag(22)));
    expect(tags(w.rollback)).toEqual([tag(21), tag(20), tag(19)]);
  });

  it('0, 1 and 2 earlier releases: the lead lines of §7.5 and no closing line', () => {
    const zero = W([release(1)], uniform(tag(1)));
    expect(zero.rollback).toEqual([]);
    expect(zero.olderHidden).toBe(0);
    expect(rollbackLead(zero)).toBe('No earlier release to roll back to.');
    const one = W([release(1), release(2)], uniform(tag(2)));
    expect(tags(one.rollback)).toEqual([tag(1)]);
    expect(rollbackLead(one)).toBe('The most recent earlier release on this channel. That is every one on record here.');
    expect(one.olderHidden).toBe(0);
    const two = W([release(1), release(2), release(3)], uniform(tag(3)));
    expect(rollbackLead(two)).toBe('The 2 most recent earlier releases on this channel. That is every one on record here.');
    expect(two.olderHidden).toBe(0);
  });

  it('three and more: the rule\'s lead and the closing line with the count and the CLI', () => {
    const w = W(releases22(), uniform(tag(22)));
    expect(rollbackLead(w)).toBe('The three most recent earlier Stable releases. Rolling back moves every managed node, one at a time.');
    expect(rollbackLead(W(releases22(), uniform(tag(22)), 'dev')))
      .toBe('The three most recent earlier releases, Stable and Dev. Rolling back moves every managed node, one at a time.');
    expect(olderClosingLine(18)).toContain('18 older releases are not offered here.');
    expect(olderClosingLine(18)).toContain('ccrc rollback --to <tag>');
    expect(olderClosingLine(18)).toContain('ccrc rollout --to <tag> --downgrade');
    expect(olderClosingLine(1)).toContain('1 older release is not offered here.');
  });

  it('a mixed fleet ten versions apart: no row between lo and hi, mixed = { lo, hi }, rollback below lo', () => {
    const w = W(releases22(), [node(tag(10)), server(tag(20))]);
    expect(w.state).toBe('measured');
    expect(w.mixed).toEqual({ lo: tag(10), hi: tag(20) });
    expect(w.running).toBeNull();
    const shown = [...tags(w.newer), ...tags(w.rollback)];
    for (let n = 10; n <= 20; n += 1) expect(shown).not.toContain(tag(n));
    expect(tags(w.newer)).toEqual([tag(22), tag(21)]);
    expect(tags(w.rollback)).toEqual([tag(9), tag(8), tag(7)]);
    expect(w.olderHidden).toBe(6);
  });

  it('pendingTag\'s release is first in Newer even when it is not the newest Newer row (§7.2)', () => {
    const w = W(releases22(), uniform(tag(15), { desiredTag: tag(17) }));
    expect(w.pending).toBe(tag(17));
    expect(tags(w.newer)).toEqual([tag(17), tag(22), tag(21)]);
    expect(w.newerHidden).toBe(4);
  });

  it('a withdrawn running release keeps its place as the running row (§7.2)', () => {
    const w = W(releases22((n) => (n === 22 ? { yanked: true } : {})), uniform(tag(22)));
    expect(w.running?.release?.tag).toBe(tag(22));
    expect(w.running?.release?.yanked).toBe(true);
  });

  it('every earlier release withdrawn: Roll back to holds them, each marked, and the closing line counts them (§7.5)', () => {
    const w = W(releases22((n) => (n < 22 ? { yanked: true } : {})), uniform(tag(22)));
    expect(tags(w.rollback)).toEqual([tag(21), tag(20), tag(19)]);
    expect(w.rollback.every((r) => r.release.yanked)).toBe(true);
    expect(w.olderHidden).toBe(18);
  });

  it('a Stable fleet whose only earlier releases are Dev builds: no Roll back to rows, the lead "No earlier Stable release…", and the closing line counting the Dev builds (§7.5)', () => {
    const w = W(releases22((n) => (n < 22 ? { channel: 'dev' } : {})), uniform(tag(22)));
    expect(w.rollback).toEqual([]);
    expect(rollbackLead(w)).toBe('No earlier Stable release to roll back to.');
    expect(w.olderHidden).toBe(21);
  });

  it('a Newer row at or below a node\'s floor: Install disabled when it takes no node forward, with the floor line', () => {
    // Both nodes were rolled back from v0.1.20 to v0.1.19: their floor is v0.1.20.
    const all = W(releases22(), uniform(tag(19), { highestVersion: tag(20) }));
    const row20 = all.newer.find((r) => r.release.tag === tag(20))!;
    expect(row20.floored).toEqual(['fleet', 'server']);
    expect(row20.installBlocked).toBe(true);
    const row21 = all.newer.find((r) => r.release.tag === tag(21))!;
    expect(row21.floored).toEqual([]);
    expect(row21.installBlocked).toBe(false);
    // One node floored: Install still takes the other forward; the line names the floored one.
    const one = W(releases22(), [node(tag(19), { highestVersion: tag(20) }), server(tag(19))]);
    const r = one.newer.find((x) => x.release.tag === tag(20))!;
    expect(r.floored).toEqual(['fleet']);
    expect(r.installBlocked).toBe(false);
  });
});

describe('releaseWindow: the unmeasured and unmanaged states (spec §7.1)', () => {
  it('one unmeasured node: state unmeasured, one Releases group of at most three, no rollback group', () => {
    const w = W(releases22(), [node(tag(22)), server(tag(22), { measuredAt: null })]);
    expect(w.state).toBe('unmeasured');
    expect(tags(w.newer)).toEqual([tag(22), tag(21), tag(20)]);
    expect(w.rollback).toEqual([]);
    expect(w.olderHidden).toBe(19);
    expect(w.unreported).toEqual(['server']);
  });

  it('an unversioned node, or an unread channel, is unmeasured too', () => {
    expect(W(releases22(), [node(tag(22)), server(undefined)]).state).toBe('unmeasured');
    const unread = W(releases22((n) => (n === 22 ? { channel: 'dev' } : {})), uniform(tag(20)), null);
    expect(unread.state).toBe('unmeasured');
    expect(tags(unread.newer)).toEqual([tag(22), tag(21), tag(20)]);   // any channel while it is unread
    expect(unread.rollback).toEqual([]);
  });

  it('an all-macOS fleet: state unmanaged, at most three rows, no rollback group', () => {
    const w = W(releases22(), [mac(tag(10))]);
    expect(w.state).toBe('unmanaged');
    expect(tags(w.newer)).toEqual([tag(22), tag(21), tag(20)]);
    expect(w.rollback).toEqual([]);
    expect(w.olderHidden).toBe(19);
  });

  it('no group holds more than three rows in any of the five fleets', () => {
    const fleets: NodeWire[][] = [
      uniform(tag(11)),
      [node(tag(5)), server(tag(17))],
      [node(tag(11)), server(tag(11), { measuredAt: null })],
      [mac(tag(3))],
      [node(tag(11)), server(undefined)],
    ];
    for (const ns of fleets) {
      for (const ch of ['stable', 'dev', null] as const) {
        const w = W(releases22((n) => (n % 2 === 0 ? { channel: 'dev' } : {})), ns, ch);
        expect(w.newer.length).toBeLessThanOrEqual(RELEASE_WINDOW_MAX);
        expect(w.rollback.length).toBeLessThanOrEqual(RELEASE_WINDOW_MAX);
      }
    }
  });
});

describe('releaseSummary: one line of what a release was (spec §7.4)', () => {
  it('grouped notes give the first item of the first non-empty group, never "Changes since …"', () => {
    const notes = ['Changes since v0.1.4', '', 'Fixed', '- The banner said nothing #12', '', 'Faster', '- A quicker read', ''].join('\n');
    expect(releaseSummary(notes)).toBe('The banner said nothing #12');
    expect(releaseSummary(['First release', '', 'New', '- Everything', ''].join('\n'))).toBe('Everything');
  });
  it('an empty grouped body gives "No changes."', () => {
    expect(releaseSummary('Changes since v0.1.4\n\nNo changes.\n')).toBe('No changes.');
  });
  it('plain notes give their first non-empty line', () => {
    expect(releaseSummary('\n\nA hand-written note\nwith two lines')).toBe('A hand-written note');
  });
  it('none gives "No notes for this release"', () => {
    expect(releaseSummary(null)).toBe('No notes for this release');
    expect(releaseSummary('   ')).toBe('No notes for this release');
  });
});
