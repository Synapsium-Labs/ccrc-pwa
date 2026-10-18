// D-5545: a session CARD is a glance and its HEADER shows everything the card does.
// One pure model (`sessionFacts.ts`) decides both; these cases pin the rule both
// ways — the model's card facts are a subset of its header facts, and the
// rendered card's facts are all in the rendered header, in both skins.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { SessionLine } from '../src/fleet/SessionLine';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';
import {
  MARKER_ORDER, cardFacts, cardWithinHeader, headerFacts, markers, sessionFacts, shortenByToken,
  type FactInput,
} from '../src/fleet/sessionFacts';
import type { ChildRunContext } from '../src/fleet/runWords';
import { setSkin } from '../src/lib/skin';

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const s = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'lane-a-project-a-still-pond', wrapper: 'lane-a', home: 'lane-a', project: 'project-a',
  workspace: 'still-pond', statusUpdatedAt: NOW - 120_000, ...over,
});
const RUN = { program: 'port-api', programTitle: 'Port the API', wave: 5, waveOf: 7, kind: 'work' as const };
const REVIEW = { ...RUN, kind: 'review' as const };
const child = (run: ChildRunContext['run'], coordinator: string | null = 'programme coordinator'): ChildRunContext =>
  ({ run, coordinator });

/** The realistic fixtures the measurement used: every kind of row the card must glance at. */
const CASES: Record<string, FactInput> = {
  'a held dispatched child': {
    session: s({ role: 'child', child: { kind: 'child', runId: 40 }, held: 'program:port-api wave:5/7 run:40',
      status: 'busy', bucket: 'working', branch: 'ws/still-pond', tasks: { done: 2, total: 5, running: 1, active: null },
      subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }] }),
    now: NOW, childRun: child(RUN),
  },
  'a coordinator': {
    session: s({ id: 'lane-a-project-a', workspace: null, name: 'programme coordinator', role: 'coordinator',
      status: 'busy', bucket: 'working', branch: 'main', tasks: { done: 3, total: 7, running: 1, active: null } }),
    now: NOW,
  },
  'a cross-project review child': {
    session: s({ id: 'lane-b-project-b-amber-field', project: 'project-b', workspace: 'amber-field', role: 'child',
      child: { kind: 'child', runId: 42 }, held: 'program:port-api wave:5/7 run:42', boardProject: 'project-a' }),
    now: NOW, childRun: child(REVIEW), workingOn: 'project-b',
  },
  'an orphan whose coordinator is gone': {
    session: s({ workspace: 'lone-reed', role: 'child', child: { kind: 'child', runId: 44 },
      held: 'program:terminal-drawer-fit wave:3/5 run:44' }),
    now: NOW, childRun: child({ ...RUN, program: 'terminal-drawer-fit', wave: 3, waveOf: 5 }, 'gone'), coordinator: 'dead',
  },
  'a hold whose run left the board': {
    session: s({ workspace: 'gray-moss', role: 'child', child: { kind: 'child', runId: 504 },
      held: 'program:terminal-drawer-fit wave:3/5 run:504' }),
    now: NOW,
  },
  'a plain operator workspace with a PR': {
    session: s({ workspace: 'bright-lake', role: 'coordinator', branch: 'feat/a-long-descriptive-branch-name-for-the-sidebar',
      pr: { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
        checkedAt: NOW, mergedAt: null, retryAt: null } }),
    now: NOW,
  },
  'a busy session under context pressure': {
    session: s({ status: 'busy', bucket: 'working', ctxPct: 86 }), now: NOW,
  },
  'a limit-hit session whose swap was refused': {
    session: s({ wrapper: 'lane-c', home: 'lane-c', limits: { five: 97, seven: 64 },
      swapBlocked: { at: NOW - 600_000, reason: 'no eligible account has headroom under the spend cap right now' } }),
    now: NOW,
  },
  'a long name waiting on the operator': {
    session: s({ name: 'an-exceptionally-long-session-name-that-will-not-fit-on-a-phone-screen', bucket: 'attention',
      hookState: 'waiting', askSummary: 'Keep the old migration path?' }),
    now: NOW,
  },
  'an unreachable pane with every other marker too': {
    session: s({ substrate: { at: NOW - 60_000, text: 'tmux socket gone' }, limits: { five: 99, seven: null },
      swapBlocked: { at: NOW, reason: 'no headroom' }, unmeasured: ['status'] }),
    now: NOW,
  },
};

describe('the model (D-5545)', () => {
  for (const [name, input] of Object.entries(CASES)) {
    it(`${name}: every card fact is a header fact, with its full text`, () => {
      const f = sessionFacts(input);
      expect(cardWithinHeader(cardFacts(f), headerFacts(f))).toEqual([]);
    });

    it(`${name}: the card carries no bookkeeping id and at most one marker`, () => {
      const c = cardFacts(sessionFacts(input));
      const shown = [c.name.short ?? c.name.text, c.status.text, c.context?.short ?? c.context?.text,
        c.marker?.short ?? c.marker?.text].filter(Boolean).join(' | ');
      expect(shown).not.toMatch(/run #\d|run:\d|program:|wave:\d/);
    });
  }

  it('a child names its programme and wave on the card; the header keeps the verbatim hold and the coordinator', () => {
    const f = sessionFacts(CASES['a held dispatched child']!);
    expect(cardFacts(f).context).toMatchObject({ key: 'programme', text: 'port-api · wave 5 of 7' });
    const h = headerFacts(f);
    expect(h).toContainEqual(expect.objectContaining({ key: 'hold', text: 'program:port-api wave:5/7 run:40' }));
    expect(h).toContainEqual(expect.objectContaining({ key: 'coordinator', text: 'programme coordinator' }));
    expect(h).toContainEqual(expect.objectContaining({ key: 'tasks', text: '2/5 tasks' }));
    expect(h).toContainEqual(expect.objectContaining({ key: 'subagents', text: '1 subagent' }));
  });

  it('a review child reads "review of wave N"', () => {
    expect(cardFacts(sessionFacts(CASES['a cross-project review child']!)).context?.text).toBe('port-api · review of wave 5');
  });

  it('the orphan marker is "coordinator gone", once, on the card', () => {
    const c = cardFacts(sessionFacts(CASES['an orphan whose coordinator is gone']!));
    expect(c.marker).toMatchObject({ key: 'coordinator-gone', text: 'coordinator gone' });
  });

  it('a hold whose run left the board says so in words, never the run number', () => {
    const c = cardFacts(sessionFacts(CASES['a hold whose run left the board']!));
    expect(c.context?.text).toBe('run not on the board');
  });

  it('a plain workspace shows its PR as its one context fact', () => {
    expect(cardFacts(sessionFacts(CASES['a plain operator workspace with a PR']!)).context?.text).toBe('PR #123');
  });

  it('the marker is the FIRST present in MARKER_ORDER, and the header lists every one', () => {
    const f = sessionFacts(CASES['an unreachable pane with every other marker too']!);
    expect(cardFacts(f).marker?.key).toBe('unreachable');
    expect(markers(f).map((m) => m.key)).toEqual(['unreachable', 'swap-blocked', 'limit', 'unreadable']);
    const keys = headerFacts(f).map((h) => h.key);
    for (const k of ['unreachable', 'swap-blocked', 'limit', 'unreadable'] as const) expect(keys).toContain(k);
  });

  it('a long refusal reads as its short word on the card and in full in the header', () => {
    const f = sessionFacts(CASES['a limit-hit session whose swap was refused']!);
    const m = markers(f).find((x) => x.key === 'swap-blocked')!;
    expect(m.short).toBe('swap blocked');
    expect(headerFacts(f)).toContainEqual(expect.objectContaining({ key: 'swap-blocked', text: m.text }));
    expect(m.text).toContain('no eligible account');
  });

  it('a waiting row "needs you"; a question its coordinator holds is "with coordinator"', () => {
    expect(cardFacts(sessionFacts(CASES['a long name waiting on the operator']!)).marker?.key).toBe('needs-you');
    expect(MARKER_ORDER.indexOf('needs-you')).toBeLessThan(MARKER_ORDER.indexOf('with-coordinator'));
  });
});

describe('shortenByToken — long names shorten by rule, never mid-token', () => {
  it('keeps a text that fits', () => {
    expect(shortenByToken('port-api', 16)).toBe('port-api');
  });

  it('cuts at a token boundary and marks the cut', () => {
    expect(shortenByToken('an-exceptionally-long-session-name-that-will-not-fit', 30)).toBe('an-exceptionally-long-session…');
    expect(shortenByToken('feat/a-long-descriptive-branch-name', 20)).toBe('feat/a-long…');
  });

  it('never splits a token, even one longer than the budget', () => {
    expect(shortenByToken('supercalifragilistic-x', 8)).toBe('supercalifragilistic…');
    for (const text of ['terminal-drawer-fit-and-finish', 'a/b/c/defghij', 'one two three four', 'x_y.z-w']) {
      for (let max = 1; max <= text.length; max += 1) {
        const out = shortenByToken(text, max);
        if (out === text) continue;
        const kept = out.slice(0, -1);
        expect(out.endsWith('…')).toBe(true);
        expect(text.startsWith(kept)).toBe(true);
        expect(/[-/_. ]/.test(text[kept.length] ?? '-')).toBe(true);
      }
    }
  });
});

const headerProps = (over: Partial<SessionHeaderProps>): SessionHeaderProps => ({
  session: null, status: 'idle', statusUpdatedAt: null,
  onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  ...over,
});

/** The text a reader can reach in a subtree: its text and every `title`. */
const reachable = (el: Element): string =>
  `${el.textContent ?? ''} ${[...el.querySelectorAll('[title]')].map((x) => x.getAttribute('title')).join(' ')}`;

describe('the rendered card is a glance, and the rendered header holds all of it (both skins)', () => {
  for (const skin of ['refined', 'instrument'] as const) {
    for (const [name, input] of Object.entries(CASES)) {
      it(`${skin} · ${name}`, () => {
        act(() => setSkin(skin));
        const { container: card } = render(
          <SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={input.now}
            childRun={input.childRun} workingOn={input.workingOn ?? null} coordinator={input.coordinator ?? null} />,
        );
        const meta = card.querySelector('.sess-meta')!;
        // The glance: a status, at most one context, at most one marker — nothing else on the meta line.
        expect(meta.children.length).toBeLessThanOrEqual(3);
        expect(card.querySelector('.sess-acct')).toBeNull();
        expect(card.querySelector('.sess-ask')).toBeNull();
        expect(card.textContent).not.toMatch(/run #\d|run:\d|program:|wave:\d/);

        const facts = sessionFacts(input);
        const c = cardFacts(facts);
        render(<SessionHeader {...headerProps({ session: input.session, status: input.session.status, facts, })} />);
        const head = document.querySelector('.chat-head')!;
        const toggle = screen.queryByRole('button', { name: /details/i });
        if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
        const text = reachable(head);
        for (const fact of [c.name, c.status, c.context, c.marker, c.workingOn]) {
          if (fact !== null) expect(text, `${fact.key} missing from the header`).toContain(fact.text);
        }
        cleanup();
      });
    }
  }
});
