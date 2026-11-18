// The five hierarchy items' controls (Linear hierarchy design §11.3 and §11.4, D-8184, Task 5.4): one control per act, the body
// each sends, a refusal in its fixed sentence, and the map body's order (counts, then one group per class; D-8737).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ItemAction } from '../../shared/ledgers';
import type { MapCounts, MapEntry } from '../../shared/plan';
import { MAP_CLASSES } from '../../shared/plan';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { ITEM_DOOR_WORDS } from '../src/ledgers/ItemActs';
import { LINEAR_GROUP_WORDS, LINEAR_ITEM_TEXT } from '../src/ledgers/migrationWords';
import { LEDGER_REFUSAL_TEXT, LINEAR_ITEM_REFUSAL_TEXT, linearItemErrorText } from '../src/lib/refusalWords';
import { ItemView } from '../src/ledgers/ItemView';
import { LinearItemControls } from '../src/ledgers/LinearItemControls';
import { MigrationBody } from '../src/ledgers/MigrationBody';
import { NOW, itemView } from './ledgersFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const act = (action: ItemAction, over: Record<string, unknown> = {}) => itemView({ id: 41, action, ...over });
const controls = (action: ItemAction, over: { enabled?: boolean; onActed?: () => void; state?: 'open' | 'closed' } = {}) => {
  const { enabled, onActed, state } = over;
  return render(<LinearItemControls item={act(action, state === undefined ? {} : { state })} handWords={ITEM_DOOR_WORDS['hand-to-coordinator']} {...(enabled === undefined ? {} : { enabled })}
                                    {...(onActed === undefined ? {} : { onActed })} />);
};
const sent = (answer: unknown = { ok: true }) => vi.spyOn(api, 'linearItemAct').mockResolvedValue(answer as never);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('the hierarchy items\' controls', () => {
  it('Approve sends {act:"approve"} after its confirm', async () => {
    const call = sent();
    controls({ verb: 'linear-map', migrationId: 3 });
    click('Approve');
    expect(call).not.toHaveBeenCalled();
    click('Approve map');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'approve' }));
  });

  it('Return sends {act:"return", note} with the note typed', async () => {
    const call = sent();
    controls({ verb: 'linear-map', migrationId: 3 });
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), { target: { value: '  Leave KEY-9 alone.  ' } });
    click('Return');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'return', note: 'Leave KEY-9 alone.' }));
  });

  it('Return is off until a note is typed', () => {
    const call = sent();
    controls({ verb: 'linear-map', migrationId: 3 });
    expect((screen.getByRole('button', { name: 'Return' }) as HTMLButtonElement).disabled).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('Put back sends {act:"put-back"} after its confirm', async () => {
    const call = sent();
    controls({ verb: 'linear-report', migrationId: 3 });
    click('Put back');
    expect(call).not.toHaveBeenCalled();
    click('Put the team back');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'put-back' }));
  });

  it('Done sends {act:"done"}', async () => {
    const call = sent();
    controls({ verb: 'linear-report', migrationId: 3 });
    click('Done');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'done' }));
  });

  it('Hand to the coordinator sends {act:"hand"}, in the existing door word', async () => {
    const call = sent();
    controls({ verb: 'linear-drift', bindingId: 8 });
    click('Hand to a coordinator');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'hand' }));
  });

  it('Keep the plan sends {act:"keep"}', async () => {
    const call = sent();
    controls({ verb: 'linear-drift', bindingId: 8 });
    click('Keep the plan');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'keep' }));
  });

  it('Check again sends {act:"check-again"} and says the check is queued', async () => {
    const call = sent({ ok: true, queued: true });
    controls({ verb: 'linear-initiatives', workspaceId: 'AAA' });
    click('Check again');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'check-again' }));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('Name offers the live coordinators and sends {act:"name", owner} after its confirm', async () => {
    vi.spyOn(api, 'hierarchy').mockResolvedValue({ ok: true, projects: [], coordinators: [{ id: 'coord-a', live: true }, { id: 'coord-b', live: false }] });
    const call = sent();
    controls({ verb: 'linear-owner', project: 'project-a' });
    const pick = await screen.findByRole('combobox', { name: /coordinator/i });
    expect(Array.from((pick as HTMLSelectElement).options).map((o) => o.value)).toEqual(['', 'coord-a']);
    expect((screen.getByRole('button', { name: 'Name' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(pick, { target: { value: 'coord-a' } });
    click('Name');
    expect(call).not.toHaveBeenCalled();
    click('Make owner');
    await waitFor(() => expect(call).toHaveBeenCalledWith(41, { act: 'name', owner: 'coord-a' }));
  });

  it('Name says so when no coordinator is live', async () => {
    vi.spyOn(api, 'hierarchy').mockResolvedValue({ ok: true, projects: [], coordinators: [{ id: 'coord-b', live: false }] });
    controls({ verb: 'linear-owner', project: 'project-a' });
    expect(await screen.findByText(/no coordinator is live/i)).toBeTruthy();
  });

  it('Name says the coordinators could not be read when the read fails, never "none live"', async () => {
    vi.spyOn(api, 'hierarchy').mockRejectedValue(new TypeError('offline'));
    controls({ verb: 'linear-owner', project: 'project-a' });
    expect(await screen.findByText(LINEAR_ITEM_TEXT.unread)).toBeTruthy();
    expect(screen.queryByText(LINEAR_ITEM_TEXT.noneLive)).toBeNull();
  });

  it('each group is named by a sentence from the words, not by its verb', () => {
    for (const verb of ['linear-map', 'linear-report', 'linear-drift', 'linear-initiatives'] as const) {
      const action = (verb === 'linear-drift' ? { verb, project: 'project-a' } : verb === 'linear-initiatives' ? { verb, project: 'project-a' } : verb === 'linear-map' ? { verb, migrationId: 3 } : { verb, migrationId: 3 }) as ItemAction;
      const { container } = controls(action);
      const group = container.querySelector('[data-linear]')!;
      expect(group.getAttribute('aria-label')).toBe(LINEAR_GROUP_WORDS[verb]);
      expect(group.getAttribute('aria-label')).not.toBe(verb);
      cleanup();
    }
  });

  it.each([
    ['not-found', LINEAR_ITEM_REFUSAL_TEXT['not-found']],
    ['not-open', LEDGER_REFUSAL_TEXT['not-open']],
  ])('the %s refusal says its fixed sentence (not-open is the ledger doors\' own)', (word, sentence) => {
    expect(linearItemErrorText(new ApiError(409, { ok: false, error: word }))).toBe(sentence);
  });

  it('an act the server refuses shows its fixed sentence, never the box\'s text', async () => {
    vi.spyOn(api, 'linearItemAct').mockRejectedValue(new ApiError(409, { ok: false, error: 'item-act-mismatch', detail: 'the box said this' }));
    const onActed = vi.fn();
    controls({ verb: 'linear-drift', bindingId: 8 }, { onActed });
    click('Keep the plan');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('does not take this action');
    expect(alert.textContent).not.toContain('the box said this');
    expect(onActed).not.toHaveBeenCalled();
  });

  it('a landed act tells onActed', async () => {
    sent();
    const onActed = vi.fn();
    controls({ verb: 'linear-drift', bindingId: 8 }, { onActed });
    click('Keep the plan');
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
  });

  it('a saved copy draws its controls disabled, and a closed item draws none', () => {
    const { unmount } = controls({ verb: 'linear-drift', bindingId: 8 }, { enabled: false });
    expect((screen.getByRole('button', { name: 'Keep the plan' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    controls({ verb: 'linear-drift', bindingId: 8 }, { state: 'closed' });
    expect(screen.queryByRole('button', { name: 'Keep the plan' })).toBeNull();
  });
});

const COUNTS: MapCounts = { created: 4, moved: 3, closed: 2, left: 1, skipped: 5 };
const ENTRIES: MapEntry[] = [
  { issue: '00000000-0000-4000-8000-000000000001', identifier: 'KEY-1', class: 'leaf', target: { programme: 'prog-a', epic: 'e-1' } },
  { issue: '00000000-0000-4000-8000-000000000002', identifier: 'KEY-2', class: 'programme', target: { programme: 'prog-a' } },
  { issue: '00000000-0000-4000-8000-000000000003', identifier: 'KEY-3', class: 'stale' },
];

describe('the map and report body', () => {
  it('the map\'s counts come before its groups, and the groups follow MAP_CLASSES order', () => {
    const { container } = render(<MigrationBody kind="map" counts={COUNTS} entries={ENTRIES} />);
    const counts = container.querySelector('[data-migration-counts]')!;
    const groups = Array.from(container.querySelectorAll('[data-migration-class]'));
    expect(counts.compareDocumentPosition(groups[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(groups.map((g) => g.getAttribute('data-migration-class'))).toEqual(MAP_CLASSES.filter((c) => ENTRIES.some((e) => e.class === c)));
    expect(Array.from(counts.querySelectorAll('[data-count]')).map((li) => li.getAttribute('data-count')))
      .toEqual(['created', 'moved', 'closed', 'skipped', 'left']);
    expect(counts.textContent).toMatch(/4.*created/);
    expect(counts.textContent).toMatch(/5.*skipped/);
    expect(container.textContent).toContain('KEY-1');
    expect(container.textContent).toContain('prog-a');
  });
});

describe('an item view handed no body', () => {
  it('a map item renders its why and how and its controls', () => {
    render(<ItemView item={act({ verb: 'linear-map', migrationId: 3 }, { title: 'Approve the map', why: 'A team awaits its map.', how: ['Read it.'] })}
                     onTick={async () => {}} onDismiss={async () => {}} programmeLive={true} now={NOW} />);
    expect(screen.getByText('A team awaits its map.')).toBeTruthy();
    expect(screen.getByText('Read it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(document.querySelector('[data-migration-counts]')).toBeNull();
  });

  it('a drift item drawn through the item view carries the existing door word', () => {
    render(<ItemView item={act({ verb: 'linear-drift', bindingId: 8 })} onTick={async () => {}} onDismiss={async () => {}} programmeLive={true} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Hand to a coordinator' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep the plan' })).toBeTruthy();
  });

  it('with a body handed, the body is drawn', () => {
    render(<ItemView item={act({ verb: 'linear-map', migrationId: 3 })} migration={{ counts: COUNTS, entries: ENTRIES }}
                     onTick={async () => {}} onDismiss={async () => {}} programmeLive={true} now={NOW} />);
    expect(document.querySelector('[data-migration-counts]')).not.toBeNull();
  });
});
