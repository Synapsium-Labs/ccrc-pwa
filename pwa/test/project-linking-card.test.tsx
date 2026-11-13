// Settings › Security › Project linking (D-8147, linking-standard plan Task 8): one row per project from
// `GET /api/projects`' `linking` cell. Neutral fixtures: `project-a`, `KEY`, `owner/repo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { LINKING_REFUSALS, type ProjectLinkingWire } from '../../shared/linking';
import type { ProjectRow } from '../../shared/api';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { LINKING_REFUSAL_TEXT, LINKING_ROUTE_TEXT } from '../src/lib/refusalWords';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { LINKING_TEXT, ProjectLinkingCard } from '../src/screens/settings/ProjectLinkingCard';
import { PASSWORD_MANAGER_IGNORE } from '../src/lib/noAutofill';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const measured = (over: Partial<Extract<ProjectLinkingWire['measured'], { state: 'measured' }>> = {}): ProjectLinkingWire['measured'] =>
  ({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW - 3 * 3_600_000, ...over });
const wire = (over: Partial<ProjectLinkingWire> = {}): ProjectLinkingWire =>
  ({ teamKey: null, override: null, measured: measured(), mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false, ...over });
const row = (name: string, linking?: ProjectLinkingWire): ProjectRow =>
  ({ name, workdir: `/w/${name}`, ...(linking === undefined ? {} : { linking }) });
const serve = (projects: ProjectRow[]) => vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
const mount = async (projects: ProjectRow[]): Promise<HTMLElement> => {
  serve(projects);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await act(async () => { render(<><ToastHost /><ProjectLinkingCard /></>); });
  return screen.findByRole('region', { name: SETTINGS_CARDS.security.linking.title });
};
const rowOf = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-linking-row="${name}"]`)!;
const keyField = (name: string): HTMLInputElement => within(rowOf(name)).getByLabelText(LINKING_TEXT.teamKey) as HTMLInputElement;
const overrideSelect = (name: string): HTMLSelectElement => within(rowOf(name)).getByLabelText(LINKING_TEXT.override) as HTMLSelectElement;

describe('the card', () => {
  it('renders one row per project with its key, visibility and template', async () => {
    await mount([
      row('project-a', wire({ teamKey: 'KEY', measured: measured({ template: 'present' }) })),
      row('project-b', wire({ measured: { state: 'unmeasured' }, mode: 'unknown' })),
      row('project-c', wire({ measured: { state: 'failed', reason: 'offline', at: NOW - 60_000 }, mode: 'unknown' })),
    ]);
    const a = within(rowOf('project-a'));
    expect(a.getByText('project-a')).toBeInTheDocument();
    expect(keyField('project-a').value).toBe('KEY');
    expect(a.getByText('Private, read 3h ago')).toBeInTheDocument();
    expect(a.getByText(LINKING_TEXT.templatePresent)).toBeInTheDocument();
    expect(overrideSelect('project-a').value).toBe('');
    expect(within(rowOf('project-b')).getByText(LINKING_TEXT.notRead)).toBeInTheDocument();
    expect(within(rowOf('project-c')).getByText("Couldn't read: offline")).toBeInTheDocument();
  });

  it('the team key box is never filled by a browser or password manager (D-8405)', async () => {
    await mount([row('project-a', wire()), row('project-b', wire({ teamKey: 'KEY' }))]);
    for (const name of ['project-a', 'project-b']) {
      const f = keyField(name);
      expect(f.getAttribute('autocomplete')).toBe('off');
      for (const [attr, v] of Object.entries(PASSWORD_MANAGER_IGNORE)) expect(f.getAttribute(attr)).toBe(v);
      expect(f.hasAttribute('name')).toBe(false);
    }
  });

  it('saving a key renders the stored row', async () => {
    await mount([row('project-a', wire())]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'KEY' }) });
    fireEvent.change(keyField('project-a'), { target: { value: 'key' } });
    expect(keyField('project-a').value).toBe('KEY');
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'KEY', override: null }));
    await within(rowOf('project-a')).findByText(LINKING_TEXT.saved);
    expect(keyField('project-a').value).toBe('KEY');
  });

  it('an empty key clears it', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire() });
    fireEvent.change(keyField('project-a'), { target: { value: '  ' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: null, override: null }));
  });

  it('an override change sends override and renders the answer', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: wire({ teamKey: 'KEY', override: 'public', mode: 'public' }),
    });
    fireEvent.change(overrideSelect('project-a'), { target: { value: 'public' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'KEY', override: 'public' }));
    await waitFor(() => expect(overrideSelect('project-a').value).toBe('public'));
    expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
  });

  it('the template button shows only for a private project with no template and a key', async () => {
    await mount([
      row('project-a', wire({ teamKey: 'KEY' })),
      row('project-b', wire({ teamKey: null })),
      row('project-c', wire({ teamKey: 'KEY', mode: 'public', measured: measured({ visibility: 'public' }) })),
      row('project-d', wire({ teamKey: 'KEY', measured: measured({ template: 'present' }) })),
      row('project-e', wire({ teamKey: 'KEY', measured: { state: 'unmeasured' }, mode: 'unknown' })),
    ]);
    const button = (n: string) => within(rowOf(n)).queryByRole('button', { name: LINKING_TEXT.openTemplate });
    expect(button('project-a')).toBeInTheDocument();
    for (const n of ['project-b', 'project-c', 'project-d', 'project-e']) expect(button(n), n).toBeNull();
  });

  it('the template act confirms first and shows the PR link', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    const open = vi.spyOn(api, 'openTemplatePr').mockResolvedValue({ ok: true, url: 'https://github.com/owner/repo/pull/7' });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.openTemplate }));
    expect(open).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('owner/repo');
    expect(dialog).toHaveTextContent('.github/pull_request_template.md');
    fireEvent.click(within(dialog).getByRole('button', { name: LINKING_TEXT.openTemplateConfirm }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('project-a'));
    const link = await within(rowOf('project-a')).findByRole('link', { name: LINKING_TEXT.templatePr });
    expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/7');
  });

  it('each refusal word renders its fixed sentence', async () => {
    for (const word of LINKING_REFUSALS) {
      cleanup();
      await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
      vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(400, { ok: false, error: word, detail: 'box text that must not show' }));
      fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
      const sentence = await within(rowOf('project-a')).findByRole('status');
      expect(sentence.textContent, word).toBe(LINKING_REFUSAL_TEXT[word]);
      expect(sentence.textContent).not.toContain('box text');
      vi.restoreAllMocks();
    }
  });

  it('the template act\'s refusal is its fixed sentence, never the box\'s stderr', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    vi.spyOn(api, 'openTemplatePr').mockRejectedValue(new ApiError(502, { ok: false, error: 'template-failed', stderr: 'pr-template: push failed for ccrc/linking-template — nothing was opened' }));
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.openTemplate }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: LINKING_TEXT.openTemplateConfirm }));
    const sentence = await within(rowOf('project-a')).findByRole('status');
    expect(sentence.textContent).toBe(LINKING_REFUSAL_TEXT['template-failed']);
    expect(sentence.textContent).not.toContain('push failed');
  });

  it('the write route\'s own words (write-failed, bad-request) are sentences, not bare words', async () => {
    for (const word of ['write-failed', 'bad-request']) {
      cleanup();
      await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
      vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(503, { ok: false, error: word, detail: 'box text that must not show' }));
      fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
      const sentence = await within(rowOf('project-a')).findByRole('status');
      expect(sentence.textContent, word).toBe(LINKING_ROUTE_TEXT[word as 'write-failed' | 'bad-request']);
      expect(sentence.textContent).not.toBe(word);
      expect(sentence.textContent).not.toContain('box text');
      vi.restoreAllMocks();
    }
  });

  it('a project with no linking cell renders nothing', async () => {
    await mount([row('project-a'), row('project-b', wire())]);
    expect(rowOf('project-a')).toBeNull();
    expect(rowOf('project-b')).not.toBeNull();
  });

  it('uses the long word for an internal repository', async () => {
    await mount([row('project-a', wire({ measured: measured({ visibility: 'internal' }) }))]);
    expect(within(rowOf('project-a')).getByText('Internal, read 3h ago')).toBeInTheDocument();
  });
});
