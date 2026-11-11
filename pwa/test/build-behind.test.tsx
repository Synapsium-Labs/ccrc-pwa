// D-8276: the console tracks each session's Claude Code build against the newest the fleet runs (`fleetClaudeLatest`
// in `shared/claudeVersion.ts`). The card stays a glance: a session on the newest build shows nothing there, and one
// behind shows ONE quiet marker, `cc .296 behind`, the quietest of the markers; the header (a superset) names the build
// of every measured session. A restart reaches only the newest build on the session's OWN lane (binary-lifecycle spec
// §2.2), so the words promise a roll only where that lane runs a newer build. Settings › Automation › Roll idle
// sessions says how many sessions are behind, and how many of them a roll can move.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { SessionLine } from '../src/fleet/SessionLine';
import { MARKER_ORDER, cardFacts, cardWithinHeader, headerFacts, markers, sessionFacts } from '../src/fleet/sessionFacts';
import { behindFact, buildShort, rollIdleBuildLine } from '../src/fleet/buildWords';
import { useFleetStore } from '../src/stores/fleet';
import { api, type RollIdleView } from '../src/lib/api';
import { RollIdleSection } from '../src/fleet/RollIdleSection';

const NOW = 1_800_000_000_000;
const s = (id: string, over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: id, statusUpdatedAt: NOW - 120_000, ...over,
});
const OLD = s('still-pond', { version: '2.1.296' });
const NEW = s('bright-lake', { version: '2.1.302' });
/** Alone on its lane, on an older build than the fleet's newest: a restart would keep it there. */
const STUCK = s('slow-marsh', { wrapper: 'lane-b', home: 'lane-b', version: '2.1.296' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useFleetStore.setState({ sessions: [] }));
});

describe('the words (D-8276)', () => {
  it('the card names only the patch when major and minor match the newest, the whole build otherwise', () => {
    expect(buildShort('2.1.296', '2.1.302')).toBe('.296');
    expect(buildShort('2.0.77', '2.1.302')).toBe('2.0.77');
  });

  it('the behind fact: a quiet short form, the full pair, and a title that says what happens next', () => {
    const f = behindFact({ build: '2.1.296', latest: '2.1.302', reach: '2.1.302' });
    expect(f.short).toBe('cc .296 behind');
    expect(f.text).toBe('Claude Code 2.1.296 · behind 2.1.302');
    expect(f.title).toMatch(/2\.1\.296.*2\.1\.302.*idle/);
    expect(behindFact({ build: '2.1.296', latest: '2.1.302', reach: '2.1.300' }).title, 'the build its lane reaches')
      .toMatch(/reaches 2\.1\.300, so Roll idle sessions restarts it onto that build once it is idle/);
  });

  it('a session its lane cannot move: the title never promises a roll', () => {
    const f = behindFact({ build: '2.1.296', latest: '2.1.302', reach: null });
    expect(f.short).toBe('cc .296 behind');
    expect(f.title).toMatch(/A restart would keep it on 2\.1\.296/);
    expect(f.title).toMatch(/Roll idle sessions does not restart it for the build\.$/);
    expect(f.title).not.toMatch(/restarts it onto|once it is idle/);
  });
});

describe('the model (D-8276)', () => {
  it('a session on an older build than the newest wears the behind marker, the last in the fixed order', () => {
    const f = sessionFacts({ session: OLD, now: NOW, claudeLatest: '2.1.302', claudeLaneLatest: '2.1.302' });
    expect(MARKER_ORDER.at(-1)).toBe('behind');
    const m = markers(f).find((x) => x.key === 'behind');
    expect(m).toMatchObject({ text: 'Claude Code 2.1.296 · behind 2.1.302', short: 'cc .296 behind' });
    expect(cardFacts(f).marker?.key).toBe('behind');
    expect(cardWithinHeader(cardFacts(f), headerFacts(f))).toEqual([]);
  });

  it('a session behind that its own lane cannot move still wears the marker, and its title promises no roll', () => {
    const f = sessionFacts({ session: STUCK, now: NOW, claudeLatest: '2.1.302', claudeLaneLatest: '2.1.296' });
    expect(f.build).toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: null });
    const m = markers(f).find((x) => x.key === 'behind');
    expect(m?.short).toBe('cc .296 behind');
    expect(m?.title).not.toMatch(/restarts it onto/);
  });

  it('a session on the newest build shows nothing on the card, and its build in the header', () => {
    const f = sessionFacts({ session: NEW, now: NOW, claudeLatest: '2.1.302' });
    expect(markers(f).some((x) => x.key === 'behind')).toBe(false);
    expect(cardFacts(f).marker).toBeNull();
    expect(headerFacts(f).find((x) => x.key === 'build')?.text).toBe('Claude Code 2.1.302');
  });

  it('a behind session\'s header says the build once, in the marker, never twice', () => {
    const f = sessionFacts({ session: OLD, now: NOW, claudeLatest: '2.1.302' });
    expect(headerFacts(f).filter((x) => x.key === 'build')).toEqual([]);
    expect(headerFacts(f).filter((x) => x.text.includes('2.1.296'))).toHaveLength(1);
  });

  it('an unmeasured build, a hibernated row, or no newest build known says nothing is behind', () => {
    expect(markers(sessionFacts({ session: s('a', { version: null }), now: NOW, claudeLatest: '2.1.302' })).some((x) => x.key === 'behind')).toBe(false);
    expect(markers(sessionFacts({ session: s('b', { version: '2.1.1', status: 'dead', bucket: 'dead', hibernatedAt: NOW - 5_000 }), now: NOW, claudeLatest: '2.1.302' }))
      .some((x) => x.key === 'behind')).toBe(false);
    expect(markers(sessionFacts({ session: OLD, now: NOW })).some((x) => x.key === 'behind')).toBe(false);
  });

  it('a louder marker keeps the card\'s one slot; the behind marker stays in the header', () => {
    const f = sessionFacts({ session: { ...OLD, ctxPct: 91 }, now: NOW, claudeLatest: '2.1.302' });
    expect(cardFacts(f).marker?.key).toBe('ctx');
    expect(headerFacts(f).some((x) => x.key === 'behind')).toBe(true);
  });
});

describe('the rendered card reads the fleet\'s newest build from the fleet store (D-8276)', () => {
  it('the behind row wears one quiet marker; the current row wears none', () => {
    act(() => useFleetStore.setState({ sessions: [OLD, NEW] }));
    const { container: behind } = render(<SessionLine session={OLD} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    const marker = behind.querySelector('[data-marker="behind"]');
    expect(marker?.textContent).toBe('cc .296 behind');
    expect(marker?.getAttribute('title')).toMatch(/2\.1\.302/);
    expect(marker?.getAttribute('title'), 'its lane runs .302: a roll reaches it').toMatch(/restarts it onto that build/);
    expect(behind.querySelectorAll('[data-marker]').length).toBe(1);
    cleanup();
    const { container: current } = render(<SessionLine session={NEW} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    expect(current.querySelector('[data-marker]')).toBeNull();
  });

  it('a row alone on a lane behind the fleet\'s newest reads its lane from the store: the marker, and no promise', () => {
    act(() => useFleetStore.setState({ sessions: [NEW, STUCK] }));
    const { container } = render(<SessionLine session={STUCK} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    const marker = container.querySelector('[data-marker="behind"]');
    expect(marker?.textContent).toBe('cc .296 behind');
    expect(marker?.getAttribute('title')).toMatch(/A restart would keep it on 2\.1\.296/);
  });

  it('a fleet all on one build draws no marker', () => {
    act(() => useFleetStore.setState({ sessions: [NEW, s('calm-bay', { version: '2.1.302' })] }));
    const { container } = render(<SessionLine session={NEW} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    expect(container.querySelector('[data-marker="behind"]')).toBeNull();
  });
});

describe('Settings › Automation › Roll idle sessions counts the sessions behind (D-8276)', () => {
  const view = (targets: RollIdleView['targets']): RollIdleView => ({ ok: true, targets, default: 'all', choices: ['all', 'coordinators', 'off'] });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

  it('the line: how many are behind, against which build, and what the setting does about it', () => {
    const counts = { latest: '2.1.302', behind: 3, reachable: 3, current: 5, unmeasured: 1, asleep: 2 };
    expect(rollIdleBuildLine(counts, 'all')).toBe('3 sessions are behind: they run an older Claude Code build than 2.1.302, the newest the fleet runs. '
      + 'Roll idle sessions restarts each onto the newest build its lane runs once idle.');
    expect(rollIdleBuildLine({ ...counts, behind: 1, reachable: 1 }, 'all')).toMatch(/^1 session is behind: it runs an older.* restarts it onto/);
    expect(rollIdleBuildLine(counts, 'coordinators')).toMatch(/Only coordinators roll onto a newer build once idle/);
    expect(rollIdleBuildLine(counts, 'off')).toMatch(/Nothing rolls while this is off\.$/);
    expect(rollIdleBuildLine({ ...counts, behind: 0, reachable: 0 }, 'all')).toBe('Every running session is on Claude Code 2.1.302, the newest build the fleet runs.');
    expect(rollIdleBuildLine({ latest: null, behind: 0, reachable: 0, current: 0, unmeasured: 4, asleep: 0 }, 'all')).toBeNull();
  });

  it('the line separates the sessions a roll can move from those their lane holds, and never promises the latter a roll', () => {
    const counts = { latest: '2.1.302', behind: 3, reachable: 1, current: 5, unmeasured: 0, asleep: 0 };
    expect(rollIdleBuildLine(counts, 'all')).toBe('3 sessions are behind: they run an older Claude Code build than 2.1.302, the newest the fleet runs. '
      + 'Roll idle sessions restarts 1 of them onto the newest build its lane runs once idle. '
      + 'A restart would keep 2 of them on their build: no session on their lane runs a newer one, so the roll leaves them '
      + 'until that lane\'s own updater installs one.');
    const held = rollIdleBuildLine({ ...counts, behind: 1, reachable: 0 }, 'all');
    expect(held).toBe('1 session is behind: it runs an older Claude Code build than 2.1.302, the newest the fleet runs. '
      + 'A restart would keep it on its build: no session on its lane runs a newer one, so the roll leaves it until that '
      + 'lane\'s own updater installs one.');
    expect(held).not.toMatch(/restarts|rolls onto/);
  });

  it('the card draws the line from the fleet the console holds, lane by lane', async () => {
    act(() => useFleetStore.setState({ sessions: [OLD, NEW, s('calm-bay', { version: '2.1.300' }), STUCK] }));
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view('all'));
    render(<RollIdleSection />);
    await settle();
    expect(screen.getByText(/^3 sessions are behind: they run an older Claude Code build than 2\.1\.302/)).toBeInTheDocument();
    expect(screen.getByText(/restarts 2 of them onto .* A restart would keep 1 of them on its build/)).toBeInTheDocument();
  });

  it('with no build measured, the card draws no line', async () => {
    vi.spyOn(api, 'rollIdle').mockResolvedValue(view('all'));
    const { container } = render(<RollIdleSection />);
    await settle();
    expect(container.textContent).not.toMatch(/Claude Code 2\./);
  });
});
