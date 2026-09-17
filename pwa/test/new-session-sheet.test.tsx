// Step 2 of the new-session sheet, after pools. The account is already picked,
// so the split runs the other way round from SwapSheet's: which projects may
// this account take. Same disclosure, same rule, same wire flag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('the optional routing row (routing slice 4, Task 6)', () => {
  it('renders only at step 2', async () => {
    const roster = pooled(POOLS);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);
    expect(screen.queryByLabelText('Class')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    expect(await screen.findByLabelText('Class')).toBeInTheDocument();
    expect(screen.getByLabelText('Effort')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflows')).toBeInTheDocument();
  });

  it('leaves every select unset and posts no `route` key at all', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    await openAtStepTwo([proj('demo', { state: 'tagged', name: 'pool-a' })]);

    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'demo', workdir: '/w/demo',
    }));
  });

  it('Opus + High posts `route: { class: "opus", effort: "high" }`', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    await openAtStepTwo([proj('demo', { state: 'tagged', name: 'pool-a' })]);

    fireEvent.click(await screen.findByText('demo'));
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'opus' } });
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'demo', workdir: '/w/demo',
      route: { class: 'opus', effort: 'high' },
    }));
  });

  it('offers no Ultracode rung on the gpt account\'s Effort select', async () => {
    const roster = pooled(POOLS);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);

    fireEvent.click(await screen.findByRole('button', { name: /^gpt/ }));
    const effortSelect = await screen.findByLabelText('Effort');
    expect(within(effortSelect).queryByText('Ultracode')).not.toBeInTheDocument();
  });

  // Fix round 2, finding #4: the gpt negative above was a bare negative with
  // no positive control — this is the mirror case on an Anthropic wrapper, so
  // the pair actually binds the rule ("Ultracode shows for Anthropic, not for
  // gpt") rather than "Ultracode never shows".
  it('offers the Ultracode rung on an Anthropic account\'s Effort select', async () => {
    const roster = pooled(POOLS);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);

    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    const effortSelect = await screen.findByLabelText('Effort');
    expect(within(effortSelect).getByText('Ultracode')).toBeInTheDocument();
  });

  // Fix round 2, finding #5: the Class select used to read in ladder order
  // (Haiku first) with no class word on a gpt label, so a gpt operator saw
  // "GPT-6 Astra" and had no way to know it posts `class=fable`. S4-R13 wants
  // capability order (Fable, Opus, Sonnet, Haiku) after the two unset rows,
  // and every label carrying its class word.
  it('the Class select reads in capability order with the class word appended (S4-R13)', async () => {
    await openAtStepTwo([proj('demo', { state: 'tagged', name: 'pool-a' })]);
    fireEvent.click(await screen.findByText('demo'));
    const classSelect = await screen.findByLabelText('Class') as HTMLSelectElement;
    const labels = Array.from(classSelect.options).map((o) => o.textContent);
    expect(labels).toEqual([
      'Coordinator row', 'Default',
      'Fable 5 — fable', 'Opus 5 — opus', 'Sonnet 5 — sonnet', 'Haiku 4.5 — haiku',
    ]);
  });

  it('a gpt operator sees the class word on a label that otherwise carries none of its own', async () => {
    const roster = pooled(POOLS);
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects: [] });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);

    fireEvent.click(await screen.findByRole('button', { name: /^gpt/ }));
    const classSelect = await screen.findByLabelText('Class');
    expect(within(classSelect).getByText('GPT-6 Astra — fable')).toBeInTheDocument();
  });

  it('shows the coordinator-row note under the row', async () => {
    await openAtStepTwo([]);
    expect(await screen.findByText(
      "Unset fields take the coordinator row (Fable · ultracode, Sonnet subagents, workflows on). "
      + "If the account can't serve the class today, ccd starts one rung down and restores it when it can.",
    )).toBeInTheDocument();
  });
});
