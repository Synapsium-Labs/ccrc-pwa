// BuildLine — the always-visible one-liner at the foot of FleetScreen
// (release/rollout spec §6; centralised-update design 2026-09-20 §13/§14):
// which version each box runs, amber for unversioned/dirty, a dash for
// unknown, and — since W3 — an amber ` → vX` affix on a side whose node the
// inventory says should move up. It reads the node inventory (`NodeWire[]`,
// FleetScreen's one GET /api/updates poll), NOT the health route's stamp
// pair, which stays on the wire unread (§14). Nothing at all for local mode
// or for no health answer; with no inventory answer, both sides unmeasured.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FleetHealth, NodeWire } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { BuildLine } from '../src/fleet/BuildLine';
import { declValue, ruleIn } from './cssRule';

afterEach(cleanup);

const SHA_A = 'bd2bf57a' + '0'.repeat(32);
const SHA_B = '2985b9d1' + '0'.repeat(32);
const stamp = (sha: string, version?: string, dirty = false): BuildInfo =>
  ({ sha, ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty, ...(version ? { version } : {}) });
const remote = (over: Partial<FleetHealth> = {}): FleetHealth =>
  ({ mode: 'remote', connected: true, downSince: null, ...over });

/** A measured, reachable, stable-channel node whose desired tag is the one it
 *  runs — so no arrow, unless a case moves `desiredTag`. `current: null` is a
 *  row whose stamp did not read (W2's `toNodeWire` answers null unless ok). */
const node = (role: 'fleet' | 'server' | 'both', current: BuildInfo | null, over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: role === 'fleet' ? '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10' : '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93',
  role, label: role === 'fleet' ? 'fleet' : 'server', os: 'linux',
  current, stampRead: current === null ? 'absent' : 'ok', installState: 'complete', provenance: 'verified',
  caps: [], agentOps: role === 'fleet' ? [] : null, highestVersion: current?.version ?? null, previousVersion: null,
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: current?.version ?? null, resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});

const line = (): Element | null => document.querySelector('.build-line');

describe('BuildLine', () => {
  it('renders both versions when both nodes run a tagged release', () => {
    render(<BuildLine health={remote({ build: 'agreed' })}
      nodes={[node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_A, 'v0.0.7'))]} />);
    expect(screen.getByRole('status')).toHaveTextContent('fleet v0.0.7 · server v0.0.7');
    expect(screen.queryByText(/unversioned/)).not.toBeInTheDocument();
    expect(document.querySelector('.build-line-next')).toBeNull();
  });

  it('renders an unversioned side amber with its short sha, and a dirty side amber — the full BuildInfo round-trips from NodeWire.current', () => {
    render(<BuildLine health={remote({ build: 'skewed' })}
      nodes={[node('fleet', stamp(SHA_A)), node('server', stamp(SHA_B, 'v0.0.9', true))]} />);
    expect(screen.getByText('fleet unversioned (bd2bf57a)')).toHaveClass('build-line-side--warn');
    expect(screen.getByText('server v0.0.9 dirty')).toHaveClass('build-line-side--warn');
  });

  it('reads dirty as a boolean — a non-boolean on the wire is not dirty', () => {
    // NodeWire.current reaches BuildLine through asUpdatesView, which passes
    // elements through unchecked (Task 5): every wire boolean is read === true.
    const odd = { ...stamp(SHA_A, 'v0.0.7'), dirty: 'false' as unknown as boolean };
    render(<BuildLine health={remote()} nodes={[node('fleet', odd), node('server', stamp(SHA_A, 'v0.0.7'))]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
    expect(screen.getByText('fleet v0.0.7')).not.toHaveClass('build-line-side--warn');
  });

  it('reads a version that arrived as null as unversioned AND amber — one predicate, read twice', () => {
    // The regression BuildLine's own comment narrates: the name used `??` while
    // the amber flag tested `=== undefined`, so a null version rendered
    // "unversioned" in calm ink. Moving the source onto NodeWire must not bring
    // the two reads back.
    const nullVersion: BuildInfo = { ...stamp(SHA_A), version: null as unknown as string };
    render(<BuildLine health={remote()} nodes={[node('fleet', nullVersion), node('server', stamp(SHA_B, 'v0.0.9'))]} />);
    expect(screen.getByText('fleet unversioned (bd2bf57a)')).toHaveClass('build-line-side--warn');
  });

  it('renders a dash for a side with no row, and for a row whose stamp did not read — with no arrow even when a tag is desired', () => {
    const { rerender } = render(<BuildLine health={remote({ build: 'unknown' })} nodes={[node('server', stamp(SHA_B, 'v0.0.9'))]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.9');
    // The unread row DESIRES v0.0.9: pendingTag's read-stamp guard (Task 9,
    // D-3307) is what keeps "fleet — → v0.0.9" off
    // the line — a stamp nobody read is not "behind".
    rerender(<BuildLine health={remote({ build: 'unknown' })}
      nodes={[node('fleet', null, { desiredTag: 'v0.0.9' }), node('server', stamp(SHA_B, 'v0.0.9'))]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.9');
    expect(screen.getByText('fleet —')).toHaveClass('build-line-side--warn');
  });

  it('carries the affix — each side a newer desired tag points at, in amber (spec §13)', () => {
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9');
    const arrows = [...document.querySelectorAll('.build-line-next')].map((e) => e.textContent);
    expect(arrows).toEqual([' → v0.0.9', ' → v0.0.9']);
    // "Amber" is a claim about the stylesheet, not the DOM (vitest runs with
    // css: false): the affix's own rule names the attention ink. The contrast
    // audit only measures a ratio, so a calm ink that clears it passes there.
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.build-line-next'), 'color')).toBe('var(--status-attention-text)');
    // One side behind, one current: the affix is per node, never per line.
    rerender(<BuildLine health={remote({ build: 'skewed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_B, 'v0.0.9')),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.9');
  });

  it('compares tags as semver — v0.0.10 is newer than v0.0.9', () => {
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.9'), { desiredTag: 'v0.0.10' }),
      node('server', stamp(SHA_A, 'v0.0.9'), { desiredTag: 'v0.0.10' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.9 → v0.0.10 · server v0.0.9 → v0.0.10');
  });

  it('draws no arrow while a node is unmeasured or has no resolved channel — unreachable is not current (§18)', () => {
    // Fix round 2 (review of d5aefc4a, item 5): the fleet side's own version
    // now reads a dash too, not just its arrow — `statedOf` gates BuildLine's
    // version display, and it has ALWAYS required `measuredAt` a number, the
    // same as `pushRelease`'s and the banner's `stated`. This row's `current`
    // is a STALE cached stamp from before `measuredAt` went null (exactly the
    // shape `markUnreachable` leaves behind), so it must not read calm. The
    // server side is unaffected: `channel: null` blocks only its ARROW
    // (pendingTag), never `statedOf`, which does not read `channel` at all.
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', measuredAt: null }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', channel: null }),
    ]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.7');
    expect(document.querySelector('.build-line-next')).toBeNull();
  });

  it('an unreachable side does not state its cached version, AND draws no arrow — inverted, review of d5aefc4a item 4 (D-3316)', () => {
    // markUnreachable keeps the row's last measuredAt/current unchanged, so a
    // side that DROPPED must not keep reading calm and present-tense (the
    // class F1/F3 fix too): the fleet side here renders a dash even though
    // its cached current is v0.0.7. This pin previously asserted the arrow
    // stayed — the coordinator's ruling reverses that: D-3316's own text
    // treats an unreachable node exactly like one whose stamp did not read
    // (D-3307), which already draws no arrow, so `pendingTag` now refuses an
    // unreachable node too. Only the reachable server side beside it keeps
    // its arrow.
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { reachable: false, unreachableSince: 1_000, desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.7 → v0.0.9');
    expect(screen.getByText('fleet —')).toHaveClass('build-line-side--warn');
    expect(document.querySelectorAll('.build-line-next')).toHaveLength(1);
  });

  it('an unreachable OR unread-stamp SERVER side gives the server side a dash too, and no arrow (item 7)', () => {
    // The fleet-side pin above, mirrored on server — BuildLine's serverCurrent
    // guard is its own line, worth its own pin rather than inferred from the
    // fleet side's.
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', reachable: false, unreachableSince: 1_000 }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server —');
    expect(screen.getByText('server —')).toHaveClass('build-line-side--warn');
    expect(document.querySelectorAll('.build-line-next')).toHaveLength(1);
    rerender(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', stampRead: 'unreadable' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server —');
  });

  it('renders "unversioned" without throwing when current has no string sha — belt-and-suspenders beside the dirty guard (F11)', () => {
    // asUpdatesView now drops an element shaped like this before it ever
    // reaches here (useUpdatesView.ts), but this guard stays anyway, for the
    // same "arrives unchecked" reason the dirty guard above it does.
    const noSha = { ...stamp(SHA_A), sha: undefined as unknown as string };
    expect(() => render(<BuildLine health={remote()} nodes={[node('fleet', noSha), node('server', stamp(SHA_A, 'v0.0.7'))]} />))
      .not.toThrow();
    expect(screen.getByText('fleet unversioned')).toHaveClass('build-line-side--warn');
  });

  it('draws no arrow on a macOS node — not centrally managed, as its /settings row says (decision 17)', () => {
    // D-3309: pendingTag answers null for os 'darwin', so
    // this line, the update banner and the inventory row agree about the node.
    // The Linux side beside it is the control: it keeps its arrow.
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', os: 'darwin' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.7');
  });

  it("reads the inventory, never the health route's stamp pair (§14)", () => {
    // A decoy pair on the health answer, disagreeing with the rows: the line
    // must say what the rows say. And a health answer carrying NO pair — the
    // shape that used to hide the line — renders from the rows all the same.
    const decoy = { fleet: stamp(SHA_B, 'v9.9.9'), own: stamp(SHA_B, 'v9.9.9') };
    const rows = [node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_A, 'v0.0.7'))];
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed', builds: decoy })} nodes={rows} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
    rerender(<BuildLine health={remote({ build: 'agreed' })} nodes={rows} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
  });

  it('on a remote fleet, a server row recorded as both is this box — never the fleet box', () => {
    // D-3313: versionSides' local-mode fallback
    // (a lone `both` row is both sides) must not name a fleet version nobody
    // measured beside a skew trigger computed without one.
    render(<BuildLine health={remote({ build: 'unknown' })} nodes={[node('both', stamp(SHA_A, 'v0.0.7'))]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.7');
  });

  it('still stands on a remote fleet whose inventory has not been read — both sides unmeasured, no arrow', () => {
    // Before /api/updates answers, and for as long as it cannot be read (a
    // 5xx, the network, a malformed body): hiding the line would take "what
    // each box runs" off the phone exactly when the update plane is unreadable.
    // A dash claims no version — neither current nor behind (§18). And the
    // health answer's stamp pair is NOT a fallback: that is the old reader.
    const decoy = { fleet: stamp(SHA_B, 'v9.9.9'), own: stamp(SHA_B, 'v9.9.9') };
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed', builds: decoy })} nodes={null} />);
    expect(line()!.textContent).toBe('fleet — · server —');
    expect(screen.getByText('fleet —')).toHaveClass('build-line-side--warn');
    expect(screen.getByText('server —')).toHaveClass('build-line-side--warn');
    expect(document.querySelector('.build-line-next')).toBeNull();
    // A malformed answer that is not an array reads the same: no row measured.
    rerender(<BuildLine health={remote({ build: 'agreed' })} nodes={{} as unknown as NodeWire[]} />);
    expect(line()!.textContent).toBe('fleet — · server —');
  });

  it('renders nothing in local mode or for a null health', () => {
    const rows = [node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_B, 'v0.0.9'))];
    const { rerender } = render(<BuildLine health={null} nodes={rows} />);
    expect(line()).toBeNull();
    // Local mode with a FULL inventory — only the mode clause can be hiding the
    // line here, not the nodes clause.
    rerender(<BuildLine health={{ mode: 'local', connected: true, downSince: null, build: 'agreed' } as FleetHealth}
      nodes={[node('both', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' })]} />);
    expect(line()).toBeNull();
  });
});

describe('the move onto NodeWire[] is whole (centralised-update §14)', () => {
  it("no file under pwa/src reads the health route's stamp pair any more — both readers moved together", () => {
    // A LITERAL-absence pin, deliberately: the two readers were BuildLine and
    // FleetHostBanner's skew arm, and a partial move would show two skew
    // opinions on one screen (the stamp pair's, the inventory's). The field
    // stays on the wire (§14 retires it later, under wire discipline); what is
    // pinned is that nothing in this bundle reads it.
    const root = path.join(import.meta.dirname, '..', 'src');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    expect(files.length, 'the walk stopped seeing the tree').toBeGreaterThan(50);
    const readers = files
      .filter((f) => /\.builds\b/.test(readFileSync(path.join(root, f), 'utf8')))
      .map((f) => f.split(path.sep).join('/'))
      .sort();
    expect(readers).toEqual([]);
  });
});
