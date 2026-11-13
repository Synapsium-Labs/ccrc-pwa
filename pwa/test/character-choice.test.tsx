// The character choice in Settings › Appearance (the Overlord face plan, Task 7): one server row, a device copy for the
// first paint, two cards in one radiogroup, and a palette command. `fetch` is stubbed; nothing here reaches a server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { AppearanceSection } from '../src/screens/settings/AppearanceSection';
import { CHARACTER_STORAGE_KEY, initCharacter, setCharacter, useCharacter } from '../src/lib/character';
import { SETTINGS_INDEX_TEXT } from '../src/fleet/settingsText';
import { baseCommands } from '../src/command/commands';
import type { Character as CharacterName } from '../../shared/face';

type Reply = { status: number; body: unknown };
let held: Array<(r: Reply) => void> = [];
const calls: Array<{ method: string; path: string; body: unknown }> = [];

function stubFetch(auto: (method: string) => Reply | undefined): void {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const r = auto(method) ?? await new Promise<Reply>((res) => { held.push(res); });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }));
}
const face = (character: CharacterName): Reply => ({ status: 200, body: { character, updatedAt: 1 } });
const posts = () => calls.filter((c) => c.method === 'POST');

beforeEach(() => { localStorage.clear(); calls.length = 0; held = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('the character store', () => {
  it("boot draws the device copy, then the server's answer", async () => {
    localStorage.setItem(CHARACTER_STORAGE_KEY, 'dark-lord');
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    expect(result.current).toBe('dark-lord');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/face' });
    await act(async () => { held.shift()!(face('orb')); });
    await waitFor(() => expect(result.current).toBe('orb'));
    expect(localStorage.getItem(CHARACTER_STORAGE_KEY)).toBe('orb');
  });

  it('a failed read keeps the copy', async () => {
    localStorage.setItem(CHARACTER_STORAGE_KEY, 'dark-lord');
    stubFetch(() => ({ status: 503, body: { ok: false } }));
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe('dark-lord');
  });

  it('a choice applies at once and is written to the server', async () => {
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { setCharacter('dark-lord'); });
    expect(result.current).toBe('dark-lord');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ path: '/api/face', body: { character: 'dark-lord' } });
    await act(async () => { held.shift()!(face('dark-lord')); });
    expect(result.current).toBe('dark-lord');
  });

  it("a refused write puts back the server's value", async () => {
    stubFetch((m) => (m === 'GET' ? face('orb') : { status: 400, body: { ok: false, error: 'bad-request' } }));
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => { setCharacter('dark-lord'); });
    expect(result.current).toBe('dark-lord');
    await waitFor(() => expect(result.current).toBe('orb'));
    expect(localStorage.getItem(CHARACTER_STORAGE_KEY)).toBe('orb');
  });
});

describe('the card', () => {
  const group = (): HTMLElement => within(screen.getByRole('group', { name: 'Character' })).getByRole('radiogroup');
  const radios = (): HTMLInputElement[] => within(group()).getAllByRole('radio') as HTMLInputElement[];

  it('says it is yours, and sits after Layout and theme', () => {
    stubFetch(() => undefined);
    render(<AppearanceSection />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf('Character')).toBe(headings.indexOf('Layout and theme') + 1);
    const card = screen.getByRole('heading', { level: 3, name: 'Character' }).closest('section')!;
    expect(within(card).getByText('You')).toBeTruthy();
    expect(radios().map((r) => r.value)).toEqual(['orb', 'dark-lord']);
    expect(radios()[0]).toHaveAccessibleName(/The Orb/);
    expect(radios()[1]).toHaveAccessibleName(/The Dark Lord/);
  });

  it("the section's purpose no longer says it is all this device's", () => {
    expect(SETTINGS_INDEX_TEXT.purpose.appearance).toBe(
      'How ccrc looks: the layout and theme on this device, and your character on every device.',
    );
  });

  it('arrows move the choice, one write per press', async () => {
    stubFetch(() => undefined);
    act(() => { setCharacter('orb'); });
    await act(async () => { held.shift()!(face('orb')); });
    calls.length = 0;
    render(<AppearanceSection />);
    expect(radios()[0]!.checked).toBe(true);
    fireEvent.keyDown(group(), { key: 'ArrowRight' });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ character: 'dark-lord' });
    expect(radios()[1]!.checked).toBe(true);
    fireEvent.keyDown(group(), { key: 'ArrowRight' });
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.body).toEqual({ character: 'orb' });
  });
});

describe('the Switch character command', () => {
  it('offers both, and runs through the context', () => {
    const cmd = baseCommands().find((c) => c.id === 'switch-character')!;
    const sub = cmd.run({} as never) as unknown as { commands: Array<{ title: string; run: (c: never) => void }> };
    expect(sub.commands.map((c) => c.title)).toEqual(['The Orb', 'The Dark Lord']);
    const seen: string[] = [];
    sub.commands[1]!.run({ setCharacter: (c: string) => seen.push(c) } as never);
    expect(seen).toEqual(['dark-lord']);
  });
});
