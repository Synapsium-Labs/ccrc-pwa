// Console speed S2: `GET /api/updates` sends a release WINDOW and `releasesTotal`, the catalogue's size. The older-releases
// count (`olderHidden`) adds the rows the server's window left out, which are all older than what it kept. Absent
// `releasesTotal` (an older server, which sends the whole catalogue) leaves today's arithmetic exactly.
import { describe, expect, it } from 'vitest';
import type { NodeWire, ReleaseWire } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { releaseWindow } from '../src/screens/updates';
import { asUpdatesView } from '../src/fleet/updatesRead';

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY = 86_400_000;
const stamp = (version: string): BuildInfo => ({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-01T12:00:00Z', dirty: false, version });
const node = (version: string, over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '11111111-1111-4111-8111-111111111111', role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp(version), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: version, previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: null, resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const tag = (n: number): string => `v0.1.${n}`;
const release = (n: number): ReleaseWire => ({
  tag: tag(n), version: tag(n), channel: 'stable', publishedAt: T0 + n * DAY, commitSha: null,
  bundleListed: true, yanked: false, refused: [], notes: null,
});
/** v0.1.13 … v0.1.22: the newest ten of a 22-row catalogue, which is what a window of ten would send. */
const windowRows = (): ReleaseWire[] => Array.from({ length: 10 }, (_, i) => release(i + 13));
const fleet = (): NodeWire[] => [node(tag(22))];

describe('releaseWindow: olderHidden reads releasesTotal (console speed S2)', () => {
  it('with releasesTotal present, olderHidden counts the rows the window left out (measured)', () => {
    // The window holds v0.1.13..22: Roll back shows 21, 20, 19 and 6 more sit below them; 12 more were never sent.
    const w = releaseWindow(windowRows(), fleet(), 'stable', 22);
    expect(w.state).toBe('measured');
    expect(w.olderHidden).toBe(6 + 12);
  });

  it('with releasesTotal absent, olderHidden is today\'s number', () => {
    const w = releaseWindow(windowRows(), fleet(), 'stable');
    expect(w.olderHidden).toBe(6);
    expect(releaseWindow(windowRows(), fleet(), 'stable', undefined).olderHidden).toBe(6);
  });

  it('the whole catalogue sent (total equals the rows) adds nothing', () => {
    expect(releaseWindow(windowRows(), fleet(), 'stable', 10).olderHidden).toBe(6);
  });

  it('a non-number or a negative difference reads as absent', () => {
    const rows = windowRows();
    expect(releaseWindow(rows, fleet(), 'stable', 4).olderHidden).toBe(6);                       // fewer than the rows sent
    expect(releaseWindow(rows, fleet(), 'stable', '22' as unknown as number).olderHidden).toBe(6);
    expect(releaseWindow(rows, fleet(), 'stable', Number.NaN).olderHidden).toBe(6);
    expect(releaseWindow(rows, fleet(), 'stable', null as unknown as number).olderHidden).toBe(6);
  });

  it('the unmeasured state counts the left-out rows too', () => {
    const w = releaseWindow(windowRows(), [], 'stable', 22);
    expect(w.state).toBe('unmanaged');
    // The newest three are shown, seven older rows are in the window, 12 more were never sent.
    expect(w.olderHidden).toBe(7 + 12);
    expect(releaseWindow(windowRows(), [], 'stable').olderHidden).toBe(7);
  });
});

describe('asUpdatesView keeps releasesTotal when it rebuilds an answer (console speed S2, fix round 1, F9)', () => {
  it('a malformed release dropped from the rows leaves releasesTotal on the answer', () => {
    const raw = {
      catalogue: { lastOkAt: T0, lastError: null }, nodes: fleet(), intent: [],
      releases: [...windowRows(), { tag: 42 }], releasesTotal: 22,
    };
    const view = asUpdatesView(raw);
    expect(view?.releases).toHaveLength(10);
    expect(view?.releasesTotal).toBe(22);
  });

  it('an answer with no releasesTotal gains none', () => {
    const raw = { catalogue: { lastOkAt: T0, lastError: null }, nodes: fleet(), intent: [], releases: [...windowRows(), { tag: 42 }] };
    expect('releasesTotal' in (asUpdatesView(raw) ?? {})).toBe(false);
  });
});
