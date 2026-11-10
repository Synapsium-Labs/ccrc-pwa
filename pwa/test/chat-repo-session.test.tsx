// Desktop polish Task C21 (D-8172), rule 3b at the screen: `SessionScreen` tells the chat whether this session claims an open run
// whose repository is not its home one, from the fleet store's runs and projects, so a cross-repository coordinator's bare
// `#n` stays text while a single-repository session's links home. Neutral names: home `org-a/project-a`, another
// `org-b/project-b`; the session `lane-a:project-a`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChatEvent, ProjectRow, RunSummary } from '../../shared/api';

/** Each time a name is resolved: a name the chat draws again asks `refHref` again (review 1758 F9). */
const resolved = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/lib/chatRefs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/chatRefs')>();
  return {
    ...real,
    refHref: (...args: Parameters<typeof real.refHref>) => {
      resolved.count += 1;
      return real.refHref(...args);
    },
  };
});

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode; computeItemKey?: (i: number) => string | number }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i))),
      ),
  };
});

const { SessionScreen } = await import('../src/screens/SessionScreen');
const { createSessionStore } = await import('../src/stores/session');
const { useFleetStore } = await import('../src/stores/fleet');

const ID = 'lane-a:project-a';
const project = (name: string, slug: string): ProjectRow => ({ name, workdir: `/w/${name}`, repo: { state: 'named', slug } });
const PROJECTS = [project('project-a', 'org-a/project-a'), project('project-b', 'org-b/project-b')];
/** The fields the run readers on this screen ask; the rest of a run is not read here. */
const run = (id: number, over: Partial<RunSummary>): RunSummary => ({
  id, program: 'prog-a', programTitle: 'Prog A', wave: 1, waveOf: 2, project: 'project-a', homeProject: 'project-a',
  sessionId: null, workspace: null, branch: null, state: 'working', claimedBy: ID, ...over,
}) as RunSummary;
const EVENTS: ChatEvent[] = [{ kind: 'assistant', uuid: 'a1', ts: '2026-11-10T10:00:00.000Z', text: 'Merged #512 now.' }];

afterEach(() => {
  cleanup();
  act(() => useFleetStore.setState({ runs: [], projects: null }));
});

function mount(): void {
  const store = createSessionStore(ID, {
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
    api: { prompt: vi.fn().mockResolvedValue(undefined) },
  });
  render(<SessionScreen id={ID} store={store} />);
  act(() => { store.setState({ uuid: 'u1', status: 'idle', events: EVENTS }); });
}

const link = (): string | null => {
  const assist = document.querySelector('.msg-assist');
  expect(assist?.textContent).toContain('Merged #512 now.');
  return assist!.querySelector('a')?.getAttribute('href') ?? null;
};

describe('the session screen tells the chat whether its session coordinates work elsewhere (Task C21, rule 3b)', () => {
  it('a session with no run elsewhere links a bare #512 home', () => {
    act(() => useFleetStore.setState({ projects: PROJECTS, runs: [run(1, {})] }));
    mount();
    expect(link()).toBe('https://github.com/org-a/project-a/issues/512');
  });

  it('a session that claims an open run in another repository leaves a bare #512 as text, and links again once it closes', () => {
    act(() => useFleetStore.setState({ projects: PROJECTS, runs: [run(1, {}), run(2, { project: 'project-b' })] }));
    mount();
    expect(link()).toBeNull();
    act(() => useFleetStore.setState({ runs: [run(1, {}), run(2, { project: 'project-b', state: 'done' })] }));
    expect(link()).toBe('https://github.com/org-a/project-a/issues/512');
  });

  // The one-boolean selector (review 1758 F9): a runs frame that changes no run id and not the answer, here another session's
  // run moving on, re-renders no name.
  it('a runs frame of another session re-renders no name', () => {
    const other = (state: RunSummary['state']): RunSummary => run(2, { project: 'project-b', claimedBy: 'lane-b:project-b', state });
    act(() => useFleetStore.setState({ projects: PROJECTS, runs: [run(1, {}), other('working')] }));
    mount();
    expect(link()).toBe('https://github.com/org-a/project-a/issues/512');
    expect(resolved.count).toBeGreaterThan(0);
    resolved.count = 0;
    act(() => useFleetStore.setState({ runs: [run(1, {}), other('awaiting-review')] }));
    expect(resolved.count).toBe(0);
    expect(link()).toBe('https://github.com/org-a/project-a/issues/512');
  });

  it('another session\'s run elsewhere does not count', () => {
    act(() => useFleetStore.setState({ projects: PROJECTS, runs: [run(2, { project: 'project-b', claimedBy: 'lane-b:project-b' })] }));
    mount();
    expect(link()).toBe('https://github.com/org-a/project-a/issues/512');
  });
});
