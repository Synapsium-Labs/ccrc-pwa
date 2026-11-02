// The Refined Accounts card (accounts plan Task A2, D-7718; spec 2026-10-18 accounts-connect §4.1–§4.4, §12.4): one
// state word per lane with its lamp, the kind chip, the trouble cards first, the roll-up, and a Copy that tells the
// truth. The fixture is the plan's five lanes: lane-a (on, fresh usage), lane-b (401), lane-c (5h at 100%), lane-d
// (off) and lane-e (codex), with the lane states the server would send, built by the one function.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { stateWordFor } from '../../shared/accounts';
import type { AccountUsage, LaneWire, RosterWire } from '../../shared/api';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { COPY_FAILED } from '../src/fleet/TroubleCard';
import { STATE_LAMPS, WEEKLY_ONLY } from '../src/fleet/accountWords';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { declValue, rulesFor, stripComments } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const now = Date.now();
const nowSec = Math.floor(now / 1000);

const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: `${id} label`, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in', ...over,
});
// Roster order deliberately not trouble order: the 401 lane is fourth, the limited one second.
const ROSTER: RosterWire[] = [
  lane('lane-a'),
  lane('lane-c', { hue: 'violet' }),
  lane('lane-d', { hue: 'blue', provider: 'openrouter', kind: 'key' }),
  lane('lane-b', { hue: 'amber', kind: 'token' }),
  lane('lane-e', { hue: 'magenta', provider: 'openai', kind: 'codex', homeAble: false }),
];

const usage = (wrapper: string, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: nowSec - 120, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
const USAGE: AccountUsage[] = [
  usage('lane-a'),
  usage('lane-b', { authDead: true }),
  usage('lane-c', { five: 100, fiveResetAt: nowSec + 72 * 60 }),
  usage('lane-d', { disabled: true }),
  usage('lane-e', { five: null, seven: 40 }),
];

/** Each lane's wire as `lanesWire` builds it at the server's instant `at`: the word from `stateWordFor` over the same
 *  facts, the 401 checked 2 h before it and every other lane 4 m before it. */
const lanesAt = (at: number): Record<string, LaneWire> => Object.fromEntries(ROSTER.map((r) => {
  const u = USAGE.find((x) => x.wrapper === r.id)!;
  const check = r.id === 'lane-b' ? { verdict: 'auth-dead', at: at - 2 * 3_600_000 } : { verdict: 'ok', at: at - 4 * 60_000 };
  const state = stateWordFor({
    disabled: u.disabled === true, authDead: u.authDead === true, five: u.five, seven: u.seven,
    fiveResetAt: u.fiveResetAt, sevenResetAt: u.sevenResetAt, provider: r.provider, kind: r.kind,
    lane: { kind: 'read', state: { check } }, now: at,
  });
  const wire: LaneWire = { state, check, ready: true };
  if (r.id === 'lane-a') wire.identity = 'someone@example.invalid';
  return [r.id, wire];
}));
const LANES = lanesAt(now);

const show = (lanes: Record<string, LaneWire> | null = LANES): void => {
  act(() => { useFleetStore.setState({ usage: USAGE, projected: { wrapper: 'lane-a', score: 1 }, roster: ROSTER, lanes }); });
  render(<><AccountsScreen /><ToastHost /></>);
};
const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane='${id}']`) as HTMLElement;
const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.accounts-row[data-lane]')];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({
    sessions: [], usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
});

describe('the Refined Accounts card: one state word per lane (D-7718)', () => {
  it('Signed out and Rate-limited cards render before the others, in that order', () => {
    show();
    expect(cards().map((c) => c.dataset['lane'])).toEqual(['lane-b', 'lane-c', 'lane-a', 'lane-d', 'lane-e']);
    expect(cards().map((c) => c.dataset['state'])).toEqual(['signed-out', 'rate-limited', 'signed-in', 'off', 'signed-in']);
    // Each trouble card says what is wrong, its effect and its fix.
    expect(within(card('lane-b')).getByText("lane-b's token was refused (HTTP 401) 2h ago.")).toBeInTheDocument();
    expect(within(card('lane-c')).getByText('lane-c reached its 5-hour limit.')).toBeInTheDocument();
    expect(within(card('lane-c')).getByText(/^Resets in 1h 1[12]m\./)).toBeInTheDocument();
    expect(card('lane-a').querySelector('.acct-trouble')).toBeNull();
  });

  it('the roll-up opens the page, zero clauses omitted, with the projection line under it', () => {
    show();
    const rollup = document.querySelector('.accounts-rollup');
    expect(rollup?.textContent).toBe('5 accounts · 1 signed out · 1 rate-limited · 1 off');
    expect(rollup?.nextElementSibling?.className).toBe('accounts-projection');
  });

  it('a Signed-out Refined card carries the rail class; no other state does', () => {
    show();
    for (const c of cards()) {
      expect(c.classList.contains('acct-rail'), c.dataset['lane']).toBe(c.dataset['state'] === 'signed-out');
    }
    // The rail is achromatic: `--ink-primary` on `--bg-raised`, no colour token.
    const [rail] = rulesFor(fleetCss, '.accounts-row[data-state].acct-rail');
    expect(declValue(rail!.body, 'background')).toBe('var(--bg-raised)');
    expect(declValue(rail!.body, 'border-left')).toBe('2px solid var(--ink-primary)');
  });

  it('the Signed in glyph names the busy hue and no glow class', () => {
    show();
    const glyph = card('lane-a').querySelector('.acct-lamp-glyph') as HTMLElement;
    expect(glyph.textContent).toBe('●');
    const lamp = glyph.closest('.acct-lamp') as HTMLElement;
    for (const el of [lamp, glyph]) expect(el.className, el.className).not.toMatch(/glow|breathe|pulse|animate/);
    const [rule] = rulesFor(fleetCss, ".accounts-row[data-state] .acct-lamp[data-state='signed-in'] .acct-lamp-glyph");
    expect(declValue(rule!.body, 'color')).toBe('var(--status-busy-text)');
    // No rule that names the lamp lights it: no shadow, no animation.
    const lampRules = stripComments(fleetCss).split('}').filter((r) => r.includes('.acct-lamp'));
    expect(lampRules.length).toBeGreaterThan(3);
    for (const r of lampRules) expect(r).not.toMatch(/box-shadow|text-shadow|animation|filter/);
  });

  it('a glyph is never rendered without its word', () => {
    show();
    const lamps = [...document.querySelectorAll<HTMLElement>('.acct-lamp')];
    expect(lamps).toHaveLength(5);
    for (const l of lamps) {
      const word = l.dataset['state'] as keyof typeof STATE_LAMPS;
      expect(l.querySelector('.acct-lamp-glyph')?.getAttribute('aria-hidden')).toBe('true');
      expect(l.querySelector('.acct-lamp-word')?.textContent).toBe(STATE_LAMPS[word].word);
    }
  });

  it('the head carries the id, the label, the lamp, then the kind chip, the identity line and the pool chip', () => {
    show();
    const a = card('lane-a');
    const head = a.querySelector('.accounts-row-head') as HTMLElement;
    expect(head.querySelector('.acct-card-id')?.textContent).toBe('lane-a');
    expect(head.querySelector('.acct-card-label')?.textContent).toBe('lane-a label');
    expect(head.lastElementChild?.className).toBe('acct-lamp');
    const kind = a.querySelector('.accounts-row-kind') as HTMLElement;
    expect(kind.querySelector('.acct-kind-chip')?.textContent).toBe('claude · sign-in');
    expect(kind.querySelector('.acct-identity')?.textContent).toBe('Signed in as someone@example.invalid');
    expect(within(card('lane-b')).getByText('claude · token')).toBeInTheDocument();
    expect(within(card('lane-d')).getByText('openrouter · key')).toBeInTheDocument();
    expect(within(card('lane-e')).getByText('chatgpt · codex')).toBeInTheDocument();
    // The pool chip and its sheet stay through the redesign (D-7718's amendment): on every rostered card, and it opens.
    for (const c of cards()) expect(c.querySelector('.acct-pool-chip'), c.dataset['lane']).not.toBeNull();
    fireEvent.click(screen.getByTestId('acct-pool-chip-lane-a'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("the state's age and the usage reading's age are two lines", () => {
    show();
    const a = card('lane-a');
    expect(a.querySelector('.accounts-state-source')?.textContent).toBe('checked 4m ago');
    expect(a.querySelector('.accounts-fresh')?.textContent).toBe('last reported 2m ago');
  });

  it("a held answer's source ages on the card's clock, as the card's other ages do (D-7718 (10))", () => {
    // The answer the server wrote an hour ago, held since (the link down, the store keeping its last good read).
    const held = lanesAt(now - 3_600_000);
    expect(held['lane-b']!.state.source).toBe('HTTP 401 · checked 2h ago');
    expect(held['lane-c']!.state.source).toMatch(/^5h limit reached · resets in 2h 1[12]m$/);
    show(held);
    const source = (id: string): string => card(id).querySelector('.accounts-state-source')?.textContent ?? '';
    // The source and the trouble line say the same age, from the same instant.
    expect(source('lane-b')).toBe('HTTP 401 · checked 3h ago');
    expect(within(card('lane-b')).getByText("lane-b's token was refused (HTTP 401) 3h ago.")).toBeInTheDocument();
    expect(source('lane-a')).toBe('checked 1h ago');
    // The countdown counts down to the telemetry row's reset, as "Resets in" under it does.
    expect(source('lane-c')).toMatch(/^5h limit reached · resets in 1h 1[12]m$/);
    expect(within(card('lane-c')).getByText(/^Resets in 1h 1[12]m\./)).toBeInTheDocument();
    // A source with no age stands, and the words are the server's.
    expect(source('lane-d')).toBe('Off on the fleet host');
    expect(cards().map((c) => c.dataset['state'])).toEqual(['signed-out', 'rate-limited', 'signed-in', 'off', 'signed-in']);
  });

  it('a Codex lane says weekly window only', () => {
    show();
    const e = card('lane-e');
    expect(within(e).getByText(WEEKLY_ONLY)).toBeInTheDocument();
    expect(e.querySelectorAll('.acct-meter')).toHaveLength(1);
    // Only a Codex lane: another lane's unmeasured 5h still reads "—".
    expect(within(card('lane-a')).queryByText(WEEKLY_ONLY)).toBeNull();
  });

  it('an answer with no lane state still draws one word per lane, and never Signed in', () => {
    show(null);
    expect(cards().map((c) => c.dataset['state'])).toEqual(['signed-out', 'rate-limited', 'not-checked', 'off', 'not-checked']);
    expect(document.querySelector('.acct-identity')).toBeNull();
  });
});

describe("the CLI fix's Copy tells the truth (spec §12.4)", () => {
  const field = (): HTMLElement => card('lane-c').querySelector('.acct-fix-field') as HTMLElement;
  const copyButton = (): HTMLElement => within(card('lane-c')).getByRole('button', { name: 'Copy' });

  it('the fix is the fleet-host command, read-only, in a mono field', () => {
    show();
    expect(field().textContent).toBe('ccrc account disable --id lane-c');
    expect(field().tagName).toBe('CODE');
    expect(field().getAttribute('contenteditable')).toBeNull();
    expect([...card('lane-b').querySelectorAll('.acct-fix-field')].map((f) => f.textContent))
      .toEqual(['ccrc account credential --id lane-b --credential - < /path/to/credential-file', 'ccrc account check --id lane-b']);
  });

  it('says Copied only when clipboard.writeText resolves', async () => {
    let resolve: () => void = () => {};
    const writeText = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    show();
    fireEvent.click(copyButton());
    expect(writeText).toHaveBeenCalledWith('ccrc account disable --id lane-c');
    expect(screen.queryByText('Copied')).toBeNull();
    await act(async () => { resolve(); await Promise.resolve(); });
    expect(within(card('lane-c')).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await screen.findAllByText('Copied')).toHaveLength(2); // the button and the toast
  });

  it('a refused clipboard leaves the command selected, with the hold-to-copy line, and never says Copied', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    show();
    fireEvent.click(copyButton());
    expect(await within(card('lane-c')).findByText(COPY_FAILED)).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('ccrc account disable --id lane-c');
    expect(document.activeElement).toBe(field());
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('no clipboard at all is a refusal too', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    show();
    fireEvent.click(copyButton());
    expect(await within(card('lane-c')).findByText(COPY_FAILED)).toBeInTheDocument();
    expect(screen.queryByText('Copied')).toBeNull();
  });
});
