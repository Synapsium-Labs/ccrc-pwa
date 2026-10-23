// Step 2 of the new-session sheet, after pools. The account is already picked,
// so the split runs the other way round from SwapSheet's: which projects may
// this account take. Same disclosure, same rule, same wire flag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { FleetSession, ProjectRow, RosterWire } from '../../shared/api';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { NAME_FIELD_TEXT } from '../src/fleet/WorkspaceNameField';
import { api } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

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

const POOLS = { claude: 'pool-a', claude9: 'pool-b' };
const UNKNOWN_POOL_NOTE =
  'One or more project pools are not known from here, so pool matching does not hide those projects.';

/** Open the sheet, land the project list, and pick claude (pool-a) at step 1. */
const openAtStepTwo = async (projects: ProjectRow[]): Promise<FleetStore> => {
  const roster = pooled(POOLS);
  const store = storeWith(roster);
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
  render(<NewSessionSheet open onClose={vi.fn()} fleet={store} />);
  fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
  return store;
};

describe('NewSessionSheet step 2 and the pool line', () => {
  it('preserves a maximum-length crossing account pool in the shared row name and title', async () => {
    const maximumPool = `a${'z'.repeat(31)}`;
    const roster = pooled({ claude: 'pool-a', claude9: maximumPool });
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
    const store = await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ]);

    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'demo', workdir: '/w/demo',
    }));
    // The create answers no id: the sheet holds in its starting state until the fleet frame lists the new session.
    act(() => { store.setState({ sessions: [fleetSession({ id: 'claude-demo', wrapper: 'claude', project: 'demo' })] }); });
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

    act(() => { store.setState({ roster: pooled({ claude: 'pool-b', claude9: 'pool-b' }) }); });

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

    act(() => { store.setState({ roster: pooled({ ...POOLS, 'claude-acme': 'pool-b' }) }); });

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

    act(() => { store.setState({ roster: pooled({ ...POOLS, 'claude-acme': 'pool-a' }) }); });

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
      'Fable 5 — fable', 'Opus 5.5 — opus', 'Sonnet 5 — sonnet', 'Haiku 4.5 — haiku',
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
      "Unset fields take the coordinator row (Opus · ultracode, Sonnet subagents, workflows on). "
      + "If the account can't serve the class today, ccd starts one rung down and restores it when it can.",
    )).toBeInTheDocument();
  });
});

// ── THE THREE ARMS NOTHING ASKED (measured: 11 uncovered statements) ──
describe('NewSessionSheet — the project list that could not be read', () => {
  it('says so, as an alert, instead of showing a skeleton for ever', async () => {
    // `ProjectPicker` has THREE arms and its own header says so: loading is
    // `list === null && listError === null`, and a failure is its own state.
    // Without the second one a box whose `/api/projects` is down shows a
    // skeleton that never resolves — the shape a reader reads as "still
    // thinking", for ever.
    const roster = pooled(POOLS);
    vi.spyOn(api, 'projects').mockRejectedValue(new Error('agent link is down'));
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(roster)} />);
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    const said = await screen.findByText(/Couldn't load the project list/);
    expect(said).toHaveAttribute('role', 'alert');
    expect(said).toHaveTextContent('agent link is down');
    expect(screen.queryByText(/No project matches/), 'a failed read is not an empty one').toBeNull();
  });
});

describe('NewSessionSheet — the routing fields ride the start, and only when set', () => {
  const startCall = async (projects: ProjectRow[]): Promise<ReturnType<typeof vi.fn>> => {
    const createSession = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, 'createSession').mockImplementation(createSession);
    await openAtStepTwo(projects);
    fireEvent.click(await screen.findByText('demo'));
    return createSession;
  };

  it('sends NO route at all when every field is left on its unset row', async () => {
    // The unset row is what every build before the routing slice sent, and it
    // must stay byte-identical: an empty `route` object would ask the
    // coordinator to re-decide from a record that says nothing.
    const createSession = await startCall([proj('demo', { state: 'untagged' })]);
    fireEvent.click(screen.getByRole('button', { name: /^start demo on/i }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(createSession.mock.calls[0]?.[0]).not.toHaveProperty('route');
  });

  it('sends exactly the fields that were set, and nothing else', async () => {
    // Three independent selects, one object. A field left unset must not
    // arrive as `''` — the record would then carry a class nobody chose.
    const createSession = await startCall([proj('demo', { state: 'untagged' })]);
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: /^start demo on/i }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    const body = createSession.mock.calls[0]?.[0] as { route?: Record<string, string> };
    expect(body.route).toEqual({ effort: 'high' });
  });

  it('a change of account clears the route it had chosen for the old one', async () => {
    // The back control resets the three selects along with the account and the
    // project. Carried over, a class picked for one lane would ride a start on
    // another — and the sheet gives no second chance to notice.
    await openAtStepTwo([proj('demo', { state: 'untagged' })]);
    fireEvent.change(await screen.findByLabelText('Effort'), { target: { value: 'high' } });
    expect((screen.getByLabelText('Effort') as HTMLSelectElement).value).toBe('high');
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    expect((await screen.findByLabelText('Effort')) as HTMLSelectElement)
      .toHaveValue('');
  });
});

// — the third routing field, and the order the list is already in —
describe('the routing row’s third select, and the project order', () => {
  it('Workflows alone posts `route: { workflow: … }` and nothing else', async () => {
    // The one field of three with no case. Each contributes its key
    // INDEPENDENTLY — an unset select adds nothing — so a request carrying
    // `class` or `effort` here would be the sheet deciding something the
    // operator left alone.
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    await openAtStepTwo([proj('demo', { state: 'tagged', name: 'pool-a' })]);

    fireEvent.click(await screen.findByText('demo'));
    fireEvent.change(screen.getByLabelText('Workflows'), { target: { value: 'off' } });
    fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      wrapper: 'claude', project: 'demo', workdir: '/w/demo',
      route: { workflow: 'off' },
    }));
  });

  it('keeps the SERVER’s order for projects this box has never run', async () => {
    // The sort puts the recently-active first, and its `undefined === undefined`
    // arm is what keeps everything else where the server put it. Sorting those
    // against `-1` would be stable in V8 and arbitrary in principle; stating
    // the arm is what makes it a decision.
    await openAtStepTwo([
      proj('zulu', { state: 'tagged', name: 'pool-a' }),
      proj('alpha', { state: 'tagged', name: 'pool-a' }),
      proj('mike', { state: 'tagged', name: 'pool-a' }),
    ]);
    await screen.findByText('zulu');
    const names = [...document.querySelectorAll('.proj-name')].map((n) => n.textContent);
    expect(names, 'the list was re-ordered for rows nothing has run').toEqual(['zulu', 'alpha', 'mike']);
  });

  it('a project behind the disclosure shows its own pool name', async () => {
    // The disclosed rows carry the pool they belong to — that is the whole
    // reason they are disclosed rather than hidden — and a `tagged` pool is
    // the only state that has a name to show.
    await openAtStepTwo([
      proj('mine', { state: 'tagged', name: 'pool-a' }),
      proj('theirs', { state: 'tagged', name: 'pool-b' }),
    ]);
    fireEvent.click(await screen.findByRole('button', { name: /other pool/i }));
    expect(await screen.findByText('theirs')).toBeInTheDocument();
    expect(screen.getByTitle(/pool-b/)).toBeInTheDocument();
  });
});

// ── THE SHEET OPENS THE NEW SESSION AT ONCE (desktop polish B5, D-6370) ──
describe('NewSessionSheet — success opens the new session', () => {
  /** The row `createSession` makes for `demo` on claude: a main checkout, absent from the store until a fleet frame lists it. */
  const NEW_ROW: FleetSession = fleetSession({ id: 'claude-demo', wrapper: 'claude', project: 'demo', workspace: null });
  const NEW_WS_ROW: FleetSession = fleetSession({ id: 'claude-demo-ws-a', wrapper: 'claude', project: 'demo', workspace: 'ws-a' });

  /** Render the sheet over a store of its own and drain microtasks only, so it works under fake timers too. */
  const mount = async (opts: { cached?: ProjectRow[]; projects?: Promise<{ roots: string[]; projects: ProjectRow[] }> } = {}) => {
    const roster = pooled(POOLS);
    const store = storeWith(roster);
    if (opts.cached !== undefined) act(() => { store.setState({ projects: opts.cached }); });
    vi.spyOn(api, 'projects').mockImplementation(() => opts.projects ?? Promise.resolve({ roots: ['/w'], projects: [proj('demo')] }));
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'Login cleanup', source: 'linear', note: null });
    const onClose = vi.fn();
    const ui = (open: boolean) => <><ToastHost /><NewSessionSheet open={open} onClose={onClose} fleet={store} /></>;
    const view = render(ui(true));
    const flush = async (): Promise<void> => { await act(async () => {}); };
    await flush();
    return { store, onClose, flush, close: () => view.rerender(ui(false)) };
  };
  const pickDemo = async (flush: () => Promise<void>): Promise<void> => {
    fireEvent.click(screen.getByRole('button', { name: /team·max/ }));
    await flush();
    fireEvent.click(screen.getByText('demo'));
  };
  const showFrame = (store: FleetStore, sessions: FleetSession[]): void => {
    act(() => { store.setState({ sessions }); });
  };
  const startUnnamed = () => fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));
  const startNamed = () => {
    fireEvent.change(screen.getByLabelText(NAME_FIELD_TEXT.label), { target: { value: 'Login cleanup' } });
    fireEvent.click(screen.getByRole('button', { name: /^Start Login cleanup/ }));
  };

  it('a named create answered with an id navigates to it', async () => {
    vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: true, id: 'ws a/1', slug: 'login-cleanup', title: 'Login cleanup' });
    const { onClose, flush } = await mount();
    await pickDemo(flush);
    startNamed();
    await waitFor(() => expect(window.location.pathname).toBe('/s/ws%20a%2F1'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Starting/)).toBeNull(); // a navigating success shows no toast
  });

  it('a named answer this build cannot read keeps the toast and the close, and goes nowhere', async () => {
    vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    const { onClose, flush } = await mount();
    await pickDemo(flush);
    startNamed();
    expect(await screen.findByText('Starting demo on team·max…')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
  });

  it('an unnamed create navigates when the fleet frame lists the new session', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const { store, onClose, flush } = await mount();
    await pickDemo(flush);
    startUnnamed();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await flush();
    // The create answered, the frame has not: the sheet holds in its starting state and goes nowhere.
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');

    showFrame(store, [NEW_ROW]);
    await waitFor(() => expect(window.location.pathname).toBe('/s/claude-demo'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Starting demo/)).toBeNull();
  });

  it('an unnamed create whose frame came BEFORE the answer still navigates once it resolves', async () => {
    let answer!: () => void;
    vi.spyOn(api, 'createSession').mockImplementation(() => new Promise<void>((resolve) => { answer = resolve; }));
    const { store, onClose, flush } = await mount();
    await pickDemo(flush);
    startUnnamed();
    await flush();
    showFrame(store, [NEW_ROW]);
    expect(window.location.pathname).toBe('/');
    await act(async () => { answer(); });
    await waitFor(() => expect(window.location.pathname).toBe('/s/claude-demo'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a session already running in that project is not the new one', async () => {
    vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const { store, onClose, flush } = await mount();
    showFrame(store, [NEW_ROW]); // alive BEFORE the create
    await pickDemo(flush);
    startUnnamed();
    await flush();
    showFrame(store, [NEW_ROW, NEW_WS_ROW]); // a workspace row is not a main checkout either
    await flush();
    expect(window.location.pathname).toBe('/');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a create answered after the sheet was dismissed navigates nowhere', async () => {
    let answer!: () => void;
    vi.spyOn(api, 'createSession').mockImplementation(() => new Promise<void>((resolve) => { answer = resolve; }));
    const { store, onClose, flush, close } = await mount();
    await pickDemo(flush);
    startUnnamed();
    await flush();
    close();
    await act(async () => { answer(); });
    showFrame(store, [NEW_ROW]);
    await flush();
    expect(window.location.pathname).toBe('/');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a named create answered after the sheet was dismissed navigates nowhere', async () => {
    let answer!: (a: { named: true; id: string; slug: string; title: string }) => void;
    vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const { onClose, flush, close } = await mount();
    await pickDemo(flush);
    startNamed();
    await flush();
    close();
    await act(async () => { answer({ named: true, id: 'claude-demo-ws-a', slug: 'login-cleanup', title: 'Login cleanup' }); });
    await flush();
    expect(window.location.pathname).toBe('/');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a sheet dismissed during the wait navigates nowhere and its clock is cleared', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const { store, onClose, flush, close } = await mount();
    await pickDemo(flush);
    startUnnamed();
    await flush();
    close();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    showFrame(store, [NEW_ROW]);
    await flush();
    expect(window.location.pathname).toBe('/');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Starting demo/)).toBeNull(); // the bound's toast belongs to a sheet that is still waiting
  });

  it('past 60 s without a frame it toasts and closes, as before, and navigates nowhere', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const { onClose, flush } = await mount();
    await pickDemo(flush);
    startUnnamed();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Starting demo on team·max…')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});

describe('NewSessionSheet — step 2 shows the cached project list at once', () => {
  const open = (cached: ProjectRow[] | null, projects: Promise<{ roots: string[]; projects: ProjectRow[] }>) => {
    const roster = pooled(POOLS);
    const store = storeWith(roster);
    if (cached !== null) act(() => { store.setState({ projects: cached }); });
    vi.spyOn(api, 'projects').mockImplementation(() => projects);
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster });
    render(<NewSessionSheet open onClose={vi.fn()} fleet={store} />);
    return store;
  };

  it('step 2 renders cached projects before /api/projects answers', async () => {
    const store = open([proj('cached-a'), proj('cached-b')], new Promise(() => {}));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    expect(await screen.findByText('cached-a')).toBeInTheDocument();
    expect(screen.getByText('cached-b')).toBeInTheDocument();
    expect(document.querySelector('.proj-skel')).toBeNull();
    expect(store.getState().projects).toHaveLength(2); // the sheet reads the store's list, it never writes it
  });

  it('the fetched list replaces the cached one when it answers, and the store is left alone', async () => {
    let answer!: (r: { roots: string[]; projects: ProjectRow[] }) => void;
    const cached = [proj('cached-a')];
    const store = open(cached, new Promise((resolve) => { answer = resolve; }));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    await screen.findByText('cached-a');
    await act(async () => { answer({ roots: ['/w'], projects: [proj('fresh-a')] }); });
    expect(await screen.findByText('fresh-a')).toBeInTheDocument();
    expect(screen.queryByText('cached-a')).toBeNull();
    expect(store.getState().projects).toBe(cached);
  });

  it('a failed fetch shows the error line only when there is no cached list to show', async () => {
    open([proj('cached-a')], Promise.reject(new Error('agent link is down')));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    expect(await screen.findByText('cached-a')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the project list/)).toBeNull();
  });

  it('with neither a fetched nor a cached list the skeleton shows', async () => {
    open(null, new Promise(() => {}));
    fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
    await act(async () => {});
    expect(document.querySelector('.proj-skel')).not.toBeNull();
  });
});
