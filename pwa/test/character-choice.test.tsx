// The character choice in Settings › Appearance (the Overlord face plan, Task 7): one server row, a device copy for the
// first paint, two cards in one radiogroup, and a palette command. `fetch` is stubbed; nothing here reaches a server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { AppearanceSection } from '../src/screens/settings/AppearanceSection';
import { CHARACTER_STORAGE_KEY, initCharacter, resetCharacterForTests, setCharacter, useCharacter } from '../src/lib/character';
import { clearAuthLost, isAuthLost, raiseAuthLost } from '../src/lib/auth';
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

// The store is module state: every case starts from its first state, so none relies on what an earlier one left.
beforeEach(() => { resetCharacterForTests(); localStorage.clear(); calls.length = 0; held = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearAuthLost(); localStorage.clear(); });

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

  it('a read refused at boot (sign-in needed) is made again when sign-in is regained, and the answer shows', async () => {
    localStorage.setItem(CHARACTER_STORAGE_KEY, 'dark-lord');
    stubFetch((m) => (m === 'GET' && calls.filter((c) => c.method === 'GET').length === 1
      ? { status: 401, body: { ok: false, error: 'unauthenticated', verdict: 'expired' } }
      : undefined));
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await waitFor(() => expect(isAuthLost()).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current).toBe('dark-lord'); // the copy stands
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    act(() => { clearAuthLost(); });
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    await act(async () => { held.shift()!(face('orb')); });
    await waitFor(() => expect(result.current).toBe('orb'));
    expect(localStorage.getItem(CHARACTER_STORAGE_KEY)).toBe('orb');
  });

  it('a read that answers while a write is in flight does not overwrite the choice just made', async () => {
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    act(() => { setCharacter('dark-lord'); });
    const [boot] = held.splice(0, 1); // the boot read, still out
    await act(async () => { boot!({ status: 200, body: { character: 'orb', updatedAt: 1 } }); });
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

describe('answers settle in request order', () => {
  it('a boot read that answers late does not overwrite a newer write, and a later refusal puts back the newer value', async () => {
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    const bootGet = held.shift()!;
    act(() => { setCharacter('dark-lord'); });
    await act(async () => { held.shift()!(face('dark-lord')); });
    await act(async () => { bootGet(face('orb')); });
    expect(result.current).toBe('dark-lord');
    act(() => { setCharacter('orb'); });
    await act(async () => { held.shift()!({ status: 400, body: { ok: false, error: 'bad-request' } }); });
    expect(result.current).toBe('dark-lord');
  });

  it("a newer write refused after an older one succeeded: the older write's success shows", async () => {
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { setCharacter('dark-lord'); setCharacter('orb'); });
    expect(posts()).toHaveLength(1); // one write in flight, the second press waits
    await act(async () => { held.shift()!(face('dark-lord')); });
    expect(posts()).toHaveLength(2);
    await act(async () => { held.shift()!({ status: 400, body: { ok: false, error: 'bad-request' } }); });
    expect(result.current).toBe('dark-lord');
  });

  it('two quick presses: one write in flight, the second queued, the newest choice wins with exactly two writes', async () => {
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { setCharacter('dark-lord'); });
    act(() => { setCharacter('orb'); });
    expect(result.current).toBe('orb'); // shown at once
    expect(posts().map((c) => c.body)).toEqual([{ character: 'dark-lord' }]);
    await act(async () => { held.shift()!(face('dark-lord')); });
    // the first write settled: the queued, newer choice goes out, and the screen keeps it meanwhile
    expect(posts().map((c) => c.body)).toEqual([{ character: 'dark-lord' }, { character: 'orb' }]);
    expect(result.current).toBe('orb');
    await act(async () => { held.shift()!(face('orb')); });
    expect(result.current).toBe('orb');
    expect(posts()).toHaveLength(2);
  });

  it('presses made while a write is out coalesce to the newest, and a choice the server already holds is not sent again', async () => {
    stubFetch(() => undefined);
    const { result } = renderHook(() => useCharacter());
    act(() => { setCharacter('dark-lord'); setCharacter('orb'); setCharacter('dark-lord'); });
    expect(posts()).toHaveLength(1);
    await act(async () => { held.shift()!(face('dark-lord')); });
    expect(posts()).toHaveLength(1); // the newest choice is what the server answered
    expect(result.current).toBe('dark-lord');
    expect(held).toHaveLength(0);
  });

  it('a write that fails on the network reverts', async () => {
    stubFetch((m) => (m === 'GET' ? face('orb') : undefined));
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    act(() => { setCharacter('dark-lord'); });
    await waitFor(() => expect(result.current).toBe('orb'));
  });
});

describe('a write whose outcome is unknown is reconciled', () => {
  /** A server that keeps one row. A POST waits to be let go (`gates`), then stores the choice and answers as `onPost` says:
   *  `lost` stores it and drops the connection, as a response lost on the way back does. */
  function stateful(start: CharacterName): { row: () => CharacterName; gates: Array<() => void>; getCount: () => number } {
    let row = start;
    const gates: Array<() => void> = [];
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, path: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (method === 'GET') { gets += 1; return new Response(JSON.stringify({ character: row, updatedAt: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      const asked = (JSON.parse(String(init!.body)) as { character: CharacterName }).character;
      await new Promise<void>((go) => { gates.push(go); });
      row = asked;
      if (gates.length === 1 && lostFirst) throw new TypeError('network'); // stored, and the answer is lost
      return new Response(JSON.stringify({ character: row, updatedAt: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return { row: () => row, gates, getCount: () => gets };
  }
  let lostFirst = false;
  beforeEach(() => { lostFirst = false; });

  it('the server stores a write whose answer is lost, and a press back to the old value is queued: both ends end on the same character', async () => {
    lostFirst = true;
    const server = stateful('orb');
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => { setCharacter('dark-lord'); });
    act(() => { setCharacter('orb'); }); // back to what the server held before: queued
    expect(posts()).toHaveLength(1);
    await act(async () => { server.gates[0]!(); await new Promise((r) => setTimeout(r, 0)); });
    // the outcome was unknown, so the row was read again (it holds dark-lord), and the queued choice differs from it: sent
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]).toMatchObject({ body: { character: 'orb' } });
    await act(async () => { server.gates[1]!(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(server.row()).toBe('orb'));
    expect(result.current).toBe('orb');
    expect(localStorage.getItem(CHARACTER_STORAGE_KEY)).toBe('orb');
  });

  it('a lost answer with nothing queued shows what the re-read returned: the server holds it', async () => {
    lostFirst = true;
    const server = stateful('orb');
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => { setCharacter('dark-lord'); });
    await act(async () => { server.gates[0]!(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(result.current).toBe('dark-lord'));
    expect(posts()).toHaveLength(1);
  });

  it('a read made on sign-in regained while a write is out waits for the write to settle, and then wins nothing stale', async () => {
    const server = stateful('orb');
    const { result } = renderHook(() => useCharacter());
    act(() => { initCharacter(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(server.getCount()).toBe(1);
    act(() => { setCharacter('dark-lord'); });
    act(() => { raiseAuthLost('expired'); });
    act(() => { clearAuthLost(); });
    expect(server.getCount(), 'no read goes out while the write is out').toBe(1);
    await act(async () => { server.gates[0]!(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(server.getCount()).toBe(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current).toBe('dark-lord');
    expect(server.row()).toBe('dark-lord');
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

  it('arrows move the choice, one write per press (each after the last settled)', async () => {
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
    await act(async () => { held.shift()!(face('dark-lord')); }); // one write at a time: the next press goes out once this one settles
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
