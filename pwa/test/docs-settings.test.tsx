import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocsSettingsSection } from '../src/screens/settings/DocsSettingsSection';
import { ApiError, api, createApi } from '../src/lib/api';
import { DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, docsApi } from '../../shared/docs';
import type { ProjectRow } from '../../shared/api';
import type { DocsSettings } from '../../shared/docsTracker';

const ok = (settings: DocsSettings) => ({ s: 'ok' as const, value: { ok: true as const, settings } });
const empty = (): DocsSettings => ({ rules: [], defaultBranches: {} });
const list = { kind: 'read' as const, rows: [{ name: 'project-a', workdir: '/w/project-a' } as ProjectRow] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Docs settings', () => {
  it('exposes the settings read and write adapter', () => {
    expect(api.docs.settings?.read).toBeTypeOf('function');
    expect(api.docs.settings?.write).toBeTypeOf('function');
  });

  it('sends the settings envelope and marker and preserves docs refusals', async () => {
    const row: DocsSettings = { rules: [], defaultBranches: { 'project-a': 'release' } };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, settings: row }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, failure: 'bad-query', why: 'pattern-invalid' }), { status: 400 }));
    const client = createApi(fetcher as unknown as typeof fetch);
    const controller = new AbortController();
    expect(await client.docs.settings.read(controller.signal)).toEqual(ok(row));
    expect(await client.docs.settings.write(row)).toEqual({ s: 'failed', body: { ok: false, failure: 'bad-query', why: 'pattern-invalid' } });
    const [url, read] = fetcher.mock.calls[0] as [string, RequestInit];
    const [writeUrl, write] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(docsApi.settings());
    expect(writeUrl).toBe(url);
    expect(read.signal).toBe(controller.signal);
    expect(new Headers(read.headers).get(DOCS_REQUEST_HEADER)).toBe(DOCS_REQUEST_HEADER_VALUE);
    expect(new Headers(write.headers).get(DOCS_REQUEST_HEADER)).toBe(DOCS_REQUEST_HEADER_VALUE);
    expect(write.method).toBe('PUT');
    expect(JSON.parse(write.body as string)).toEqual({ settings: row });
  });

  it('keeps a rule edit after refusal and shows the confirmed response on save', async () => {
    const write = vi.fn().mockResolvedValueOnce({ s: 'failed', body: { ok: false, failure: 'bad-query', why: 'pattern-invalid', message: 'untrusted text' } })
      .mockImplementation(async (settings: DocsSettings) => ok(settings));
    render(<DocsSettingsSection list={list} settings={{ read: async () => ok(empty()), write }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    fireEvent.change(screen.getByLabelText('Rule name 1'), { target: { value: 'Tickets' } });
    fireEvent.change(screen.getByLabelText('Pattern 1'), { target: { value: '[A-Z]+-[0-9]+' } });
    fireEvent.change(screen.getByLabelText('URL template 1'), { target: { value: 'https://tracker.invalid/item/{0}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Docs settings' }));
    expect(await screen.findByText(/pattern.*invalid/i)).toBeInTheDocument();
    expect(screen.queryByText('untrusted text')).toBeNull();
    expect(screen.getByLabelText('Rule name 1')).toHaveValue('Tickets');
    fireEvent.click(screen.getByRole('button', { name: 'Save Docs settings' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Docs settings saved.')).toBeInTheDocument();
    expect(write.mock.calls[1]![0].rules[0]).toEqual({ name: 'Tickets', pattern: '[A-Z]+-[0-9]+', template: 'https://tracker.invalid/item/{0}' });
  });

  it('adds and removes project branches, including a project missing from discovery', async () => {
    const write = vi.fn(async (settings: DocsSettings) => ok(settings));
    render(<DocsSettingsSection list={list} settings={{ read: async () => ok({ rules: [], defaultBranches: { 'project-gone': 'old' } }), write }} />);
    fireEvent.change(await screen.findByLabelText('Default branch for project-a'), { target: { value: 'release' } });
    fireEvent.change(screen.getByLabelText('Default branch for project-gone'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Docs settings' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith({ rules: [], defaultBranches: { 'project-a': 'release' } }));
  });

  it('does not replay a refused action after confirmation and blocks a pending write', async () => {
    let finish!: (value: ReturnType<typeof ok>) => void;
    const write = vi.fn().mockRejectedValueOnce(new ApiError(403, { error: 'step-up-required' }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const stepUpDeps = { client: { stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }), stepUpFinish: vi.fn(), stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300000 }) } };
    render(<DocsSettingsSection list={list} settings={{ read: async () => ok(empty()), write }} stepUpDeps={stepUpDeps} />);
    fireEvent.change(await screen.findByLabelText('Default branch for project-a'), { target: { value: 'release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Docs settings' }));
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(screen.queryByLabelText('Passphrase')).toBeNull());
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save Docs settings' }));
    expect(screen.getByRole('button', { name: 'Save Docs settings' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Docs settings' }));
    expect(write).toHaveBeenCalledTimes(2);
    finish(ok({ rules: [], defaultBranches: { 'project-a': 'release' } }));
    expect(await screen.findByText('Docs settings saved.')).toBeInTheDocument();
  });
});
