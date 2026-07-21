import { describe, it, expect, beforeAll } from 'vitest';
import { BASE, post, get, pollUntil, wsCollect, eventsOf, sleep, waitIdle } from './helpers.js';

const ID = 'claude2-cctest';

// The suite drives a real cctest session through ccrc's public API only.
// Guarded so `vitest run` stays green when CCRC_BASE_URL is unset.
describe.skipIf(!BASE)('ccrc live e2e (cctest)', () => {
  beforeAll(() => {
    // eslint-disable-next-line no-console
    console.log(`e2e against ${BASE}`);
  });

  it('1. create + reach ready (idle, gates cleared)', async () => {
    await post('/api/sessions', { wrapper: 'claude2', project: 'cctest', enable: true });
    // Wait for genuinely ready — not just tmux-alive — so ccd's spawn automation
    // (trust gate, /effort injection) finishes before we drive the pane.
    await waitIdle(ID, 200_000);
    const { body } = await get('/api/fleet');
    expect(body.sessions.find((s: any) => s.id === ID)?.status).toBe('idle');
  }, 230_000);

  it('2. prompt -> reply streams', async () => {
    await waitIdle(ID, 60_000);
    const msgs = await wsCollect(
      `/ws/session/${ID}`,
      (_m, all) => eventsOf(all).some(
        (e) => e.kind === 'assistant' && /pong/i.test(e.text ?? ''),
      ),
      150_000,
      () => { void post(`/api/sessions/${ID}/prompt`, { text: 'Reply with exactly the word pong and nothing else.' }); },
    );
    const evs = eventsOf(msgs);
    expect(evs.some((e) => e.kind === 'user')).toBe(true);
    expect(evs.some((e) => e.kind === 'assistant' && /pong/i.test(e.text))).toBe(true);
  }, 170_000);

  it('3. dialog appears, answer clears it', async () => {
    await waitIdle(ID, 60_000);
    // Ask cctest to pose a multi-option question via its AskUserQuestion tool.
    const dialogMsgs = await wsCollect(
      `/ws/session/${ID}`,
      (m) => m.type === 'dialog' && m.dialog?.parsed && (m.dialog.options?.length ?? 0) >= 3,
      150_000,
      () => { void post(`/api/sessions/${ID}/prompt`, { text: 'Use your AskUserQuestion tool to ask me which colour I prefer, with exactly these options: Red, Green, Blue.' }); },
    );
    const dialog = dialogMsgs[dialogMsgs.length - 1].dialog;
    expect(dialog.options.length).toBeGreaterThanOrEqual(3);

    // Answer option 2 and expect the dialog to clear.
    const clearedMsgs = await wsCollect(
      `/ws/session/${ID}`,
      (m) => m.type === 'dialog_cleared',
      60_000,
      () => { void post(`/api/sessions/${ID}/dialog`, { dialogId: dialog.id, optionIndex: 2 }); },
    );
    expect(clearedMsgs.some((m) => m.type === 'dialog_cleared')).toBe(true);
  }, 230_000);

  it('4. interrupt returns session to idle', async () => {
    await waitIdle(ID, 60_000);
    // Kick off a long task, wait for busy, then interrupt.
    await wsCollect(
      `/ws/session/${ID}`,
      (m) => m.type === 'status' && m.status === 'busy',
      60_000,
      () => { void post(`/api/sessions/${ID}/prompt`, { text: 'Count slowly from 1 to 200, one number per line, pausing between each.' }); },
    );
    const r = await post(`/api/sessions/${ID}/interrupt`, {});
    expect(r.status).toBe(200);
    const back = await pollUntil(
      '/api/fleet',
      (b) => b?.sessions?.find((s: any) => s.id === ID)?.status === 'idle',
      45_000,
    );
    expect(back.sessions.find((s: any) => s.id === ID).status).toBe('idle');
  }, 130_000);

  it('5. image upload lands a clip path in the input box', async () => {
    // 1x1 transparent PNG
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const bytes = Buffer.from(pngB64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'probe.png');
    const res = await fetch(`${BASE}/api/sessions/${ID}/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    await sleep(1500);
    // ccd clip types the path into the input box WITHOUT Enter, so it sits as a
    // draft. A plain prompt must now correctly detect that draft (the draftOf fix)
    // and report it — proving both the upload pipeline and box-vs-history parsing.
    const draftRes = await post(`/api/sessions/${ID}/prompt`, { text: 'describe the attached image' });
    expect(draftRes.status).toBe(409);
    expect(String(draftRes.body?.draft ?? '')).toMatch(/\.cc-clips\/.*cctest/);
    // Clear the draft so later phases start from an empty box.
    await post(`/api/sessions/${ID}/prompt`, { text: 'ok', replaceDraft: true });
    await waitIdle(ID, 60_000);
  }, 120_000);

  it('6. swap follows the session to a new account', async () => {
    const r = await post(`/api/sessions/${ID}/swap`, { wrapper: 'claude' });
    expect([200, 202]).toContain(r.status);
    // ccd keeps the registry id; only the wrapper field flips. Poll fleet for wrapper change.
    const fleet = await pollUntil(
      '/api/fleet',
      (b) => b?.sessions?.find((s: any) => s.id === ID)?.wrapper === 'claude' && b.sessions.find((s: any) => s.id === ID).status !== 'dead',
      200_000,
    );
    expect(fleet.sessions.find((s: any) => s.id === ID).wrapper).toBe('claude');
    // Post-swap ccd re-runs spawn automation on the new account; let it settle.
    await waitIdle(ID, 120_000);
    // Stream still works under the new account.
    const msgs = await wsCollect(
      `/ws/session/${ID}`,
      (_m, all) => eventsOf(all).some((e) => e.kind === 'assistant' && /pong/i.test(e.text ?? '')),
      120_000,
      () => { void post(`/api/sessions/${ID}/prompt`, { text: 'Reply with exactly the word pong.' }); },
    );
    expect(eventsOf(msgs).some((e) => e.kind === 'assistant' && /pong/i.test(e.text))).toBe(true);
  }, 340_000);

  it('7. stop marks the session dead', async () => {
    await post(`/api/sessions/${ID}/stop`, {});
    const fleet = await pollUntil(
      '/api/fleet',
      (b) => b?.sessions?.find((s: any) => s.id === ID)?.status === 'dead',
      60_000,
    );
    expect(fleet.sessions.find((s: any) => s.id === ID).status).toBe('dead');
  }, 80_000);
});
