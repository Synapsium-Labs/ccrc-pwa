// Step 2 of the new-session sheet, after pools. The account is already picked,
// so the split runs the other way round from SwapSheet's: which projects may
// this account take. Same disclosure, same rule, same wire flag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectRow, RosterWire } from '../../shared/api';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { api } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((account) => ({ ...account, pool: byId[account.id] ?? null }));

const storeWith = (roster: RosterWire[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions: [], roster }); });
  return store;
};

const proj = (
  name: string,
  pool?: ProjectRow['pool'],
  placement?: ProjectRow['placement'],
): ProjectRow => ({
  name,
  workdir: `/w/${name}`,
  ...(pool === undefined ? {} : { pool }),
  ...(placement === undefined ? {} : { placement }),
});

const POOLS = { claude: 'pool-a', claude2: 'pool-b' };
const UNKNOWN_POOL_NOTE =
  'One or more project pools are not known from here, so pool matching does not hide those projects.';

/** Open the sheet, land the project list, and pick claude (pool-a) at step 1. */
const openAtStepTwo = async (projects: ProjectRow[]): Promise<void> => {
  const roster = pooled(POOLS);
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
  render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);
  fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
};

describe('NewSessionSheet step 2 and the pool line', () => {
  it('preserves a maximum-length crossing account pool in the shared row name and title', async () => {
    const maximumPool = `a${'z'.repeat(31)}`;
    const roster = pooled({ claude: 'pool-a', claude2: maximumPool });
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);

    const poolLabel = `pool · ${maximumPool}`;
    const chip = await screen.findByLabelText(poolLabel);
    expect(chip).toHaveAttribute('title', poolLabel);
    expect(chip).toHaveTextContent(poolLabel);
  });

  it('lists the projects this account may take, and counts the rest behind the disclosure', async () => {
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
      proj('acct-a-demo', { state: 'untagged' }),
    ]);

    expect(await screen.findByText('demo')).toBeInTheDocument();
    expect(screen.getByText('acct-a-demo')).toBeInTheDocument();
    expect(screen.queryByText('quiet-basin')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'show other pools (1)' })).toBeInTheDocument();
  });

  it('preserves a maximum-length crossing pool in the row name and title', async () => {
    const maximumPool = `a${'z'.repeat(31)}`;
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: maximumPool }),
    ]);

    fireEvent.click(await screen.findByRole('button', { name: 'show other pools (1)' }));
    const poolLabel = `pool · ${maximumPool}`;
    const chip = screen.getByLabelText(poolLabel);
    expect(chip).toHaveAttribute('title', poolLabel);
    expect(chip).toHaveTextContent(poolLabel);
  });

  it('sends crossPool only for a project behind the disclosure', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ]);

    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'demo', workdir: '/w/demo',
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Start demo/ })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    fireEvent.click(screen.getByText('quiet-basin'));
    fireEvent.click(screen.getByRole('button', { name: /^Start quiet-basin/ }));
    expect(create).toHaveBeenLastCalledWith({
      wrapper: 'claude',
      project: 'quiet-basin',
      workdir: '/w/quiet-basin',
      crossPool: true,
    });
  });

  it('offers an old-server project row whose pool key is absent plainly and starts it without crossPool', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const oldServerProject = proj('demo');
    expect(Object.hasOwn(oldServerProject, 'pool')).toBe(false);
    await openAtStepTwo([oldServerProject, proj('quiet-basin')]);

    expect(await screen.findByText('demo')).toBeInTheDocument();
    expect(screen.getByText('quiet-basin')).toBeInTheDocument();
    expect(screen.queryByText(UNKNOWN_POOL_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('demo'));
    const start = screen.getByRole('button', { name: /^Start demo/ });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'demo', workdir: '/w/demo',
    }));
  });

  it.each(['unreadable', 'malformed'] as const)(
    'offers an %s project plainly with one honest note and a plain request',
    async (state) => {
      const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
      await openAtStepTwo([
        proj('demo', { state }, { kind: 'unmeasurable' }),
      ]);

      fireEvent.click(await screen.findByText('demo'));
      expect(screen.getAllByText(UNKNOWN_POOL_NOTE)).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
      const start = screen.getByRole('button', { name: /^Start demo/ });
      expect(start).toBeEnabled();
      fireEvent.click(start);
      await waitFor(() => expect(create).toHaveBeenCalledWith({
        wrapper: 'claude', project: 'demo', workdir: '/w/demo',
      }));
    },
  );

  it('keeps a known mismatch disclosed while showing one note for visible unknown rows', async () => {
    await openAtStepTwo([
      proj('unknown-a', { state: 'unreadable' }, { kind: 'unmeasurable' }),
      proj('known-b', { state: 'tagged', name: 'pool-b' }),
      proj('unknown-b', { state: 'malformed' }, { kind: 'unmeasurable' }),
    ]);

    expect(await screen.findByText('unknown-a')).toBeInTheDocument();
    expect(screen.getByText('unknown-b')).toBeInTheDocument();
    expect(screen.queryByText('known-b')).not.toBeInTheDocument();
    expect(screen.getAllByText(UNKNOWN_POOL_NOTE)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    expect(screen.getByText('known-b')).toBeInTheDocument();
    expect(screen.getAllByText(UNKNOWN_POOL_NOTE)).toHaveLength(1);
  });

  it('clears a plain selection that becomes crossing after the roster changes', async () => {
    const projects = [
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ];
    const roster = pooled(POOLS);
    const store = storeWith(roster);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={store} />);
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    fireEvent.click(await screen.findByText('demo'));
    expect(screen.getByRole('button', { name: /^Start demo/ })).toBeEnabled();

    act(() => { store.setState({ roster: pooled({ claude: 'pool-b', claude2: 'pool-b' }) }); });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose a project' })).toBeDisabled());
    expect(screen.queryByText('demo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a project' })).toBeDisabled();
  });

  it('preserves a plain selection when an unrelated roster render leaves it eligible', async () => {
    const projects = [proj('demo', { state: 'tagged', name: 'pool-a' })];
    const roster = pooled(POOLS);
    const store = storeWith(roster);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={store} />);
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    fireEvent.click(await screen.findByText('demo'));

    act(() => { store.setState({ roster: pooled({ ...POOLS, 'claude-corp': 'pool-b' }) }); });

    expect(await screen.findByRole('button', { name: /^Start demo/ })).toBeEnabled();
  });

  it('preserves a deliberately disclosed crossing selection while it remains crossing', async () => {
    const projects = [proj('quiet-basin', { state: 'tagged', name: 'pool-b' })];
    const roster = pooled(POOLS);
    const store = storeWith(roster);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={store} />);
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'show other pools (1)' }));
    fireEvent.click(screen.getByText('quiet-basin'));

    act(() => { store.setState({ roster: pooled({ ...POOLS, 'claude-corp': 'pool-a' }) }); });

    expect(await screen.findByRole('button', { name: /^Start quiet-basin/ })).toBeEnabled();
  });

  it('still says nothing matched when search empties both lists', async () => {
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ]);
    fireEvent.change(await screen.findByLabelText('Search projects'), { target: { value: 'zzz' } });
    expect(screen.getByText('No project matches "zzz"')).toBeInTheDocument();
  });
});
