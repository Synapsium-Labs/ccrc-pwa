// Confirm the restore's banner (Overlord W1, authority journal C, plan Task 8 and question 14): it reads the authority guard's
// state, shows the refusal and the Confirm the restore button while the guard is not coherent, takes the step-up the door asks
// for, and hides once the guard reads coherent. Neutral names only: the repository is public.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RESTORE_WORDS, RestoreBanner, readAuthority, restoreLine } from '../src/overlord/RestoreBanner';
import { ApiError, api } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ROLLED = { ok: true, authority: { kind: 'rolled-back', cause: 'witness-epoch' } };
const COHERENT = { ok: true, authority: { kind: 'coherent' } };
const UNMEASURED = { ok: true, authority: { kind: 'unmeasured', why: 'journal' } };
const stepUpClient = () => ({ stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }), stepUpFinish: vi.fn(), stepUpPassphrase: vi.fn() });

describe('readAuthority, the one reader of the guard\'s state', () => {
  it('keeps the three states and drops anything else', () => {
    expect(readAuthority(ROLLED)).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
    expect(readAuthority(COHERENT)).toEqual({ kind: 'coherent' });
    expect(readAuthority(UNMEASURED)).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(readAuthority({ ok: true, authority: { kind: 'maybe' } })).toBeNull();
    expect(readAuthority({ ok: true, authority: { kind: 'rolled-back' } })).toBeNull();
    expect(readAuthority(null)).toBeNull();
  });
  it('says the refusal in plain words', () => {
    expect(restoreLine({ kind: 'rolled-back', cause: 'witness-epoch' })).toContain('authority-rolled-back');
    expect(restoreLine({ kind: 'unmeasured', why: 'journal' })).toContain('cannot be read');
  });
});

describe('the restore banner', () => {
  it('shows the refusal and Confirm the restore while the guard reads rolled-back', async () => {
    vi.spyOn(api, 'overlordRestore').mockResolvedValue(ROLLED);
    render(<RestoreBanner stepUpDeps={{ client: stepUpClient() }} />);
    expect(await screen.findByText(restoreLine({ kind: 'rolled-back', cause: 'witness-epoch' }))).toBeTruthy();
    expect(screen.getByRole('button', { name: RESTORE_WORDS.confirm })).toBeTruthy();
  });

  it('hides when the guard reads coherent, and when the read fails', async () => {
    const read = vi.spyOn(api, 'overlordRestore').mockResolvedValue(COHERENT);
    const { container } = render(<RestoreBanner stepUpDeps={{ client: stepUpClient() }} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(container.querySelector('[data-restore-banner]')).toBeNull();
    cleanup();
    vi.spyOn(api, 'overlordRestore').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    const second = render(<RestoreBanner stepUpDeps={{ client: stepUpClient() }} />);
    await waitFor(() => expect(api.overlordRestore).toHaveBeenCalled());
    expect(second.container.querySelector('[data-restore-banner]')).toBeNull();
  });

  it('an unmeasured guard shows its line and no button: Confirm would refuse', async () => {
    vi.spyOn(api, 'overlordRestore').mockResolvedValue(UNMEASURED);
    render(<RestoreBanner stepUpDeps={{ client: stepUpClient() }} />);
    expect(await screen.findByText(restoreLine({ kind: 'unmeasured', why: 'journal' }))).toBeTruthy();
    expect(screen.queryByRole('button', { name: RESTORE_WORDS.confirm })).toBeNull();
  });

  it('a step-up-required refusal shows the step and sends nothing more', async () => {
    vi.spyOn(api, 'overlordRestore').mockResolvedValue(ROLLED);
    const confirm = vi.spyOn(api, 'confirmRestore').mockRejectedValue(new ApiError(403, { ok: false, error: 'step-up-required' }));
    const client = stepUpClient();
    render(<RestoreBanner stepUpDeps={{ client }} />);
    fireEvent.click(await screen.findByRole('button', { name: RESTORE_WORDS.confirm }));
    await waitFor(() => expect(client.stepUpStart).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('a confirmed restore reads the guard again and hides', async () => {
    const read = vi.spyOn(api, 'overlordRestore').mockResolvedValueOnce(ROLLED).mockResolvedValue(COHERENT);
    vi.spyOn(api, 'confirmRestore').mockResolvedValue({ ok: true, changed: true });
    const { container } = render(<RestoreBanner stepUpDeps={{ client: stepUpClient() }} />);
    fireEvent.click(await screen.findByRole('button', { name: RESTORE_WORDS.confirm }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('[data-restore-banner]')).toBeNull());
  });

  it('a refusal says its word', async () => {
    vi.spyOn(api, 'overlordRestore').mockResolvedValue(ROLLED);
    vi.spyOn(api, 'confirmRestore').mockRejectedValue(new ApiError(503, { ok: false, error: 'journal-unreadable', detail: 'the authority journal could not be read' }));
    render(<RestoreBanner stepUpDeps={{ client: stepUpClient() }} />);
    fireEvent.click(await screen.findByRole('button', { name: RESTORE_WORDS.confirm }));
    expect(await screen.findByText(`${RESTORE_WORDS.refused}: journal-unreadable`)).toBeTruthy();
  });
});
