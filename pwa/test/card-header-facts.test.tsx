// D-5545: a session CARD is a glance and its HEADER shows everything the card does.
// One pure model (`sessionFacts.ts`) decides both; these cases pin the rule both
// ways — the model's card facts are a subset of its header facts, and the
// rendered card's facts are all in the rendered header, in both skins.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { fleetSession, DEAD_LIFECYCLE } from './fleetFixture';
import { SessionLine } from '../src/fleet/SessionLine';
import { RunRow } from '../src/screens/RunRow';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import type { RunSummary } from '../../shared/api';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import {
  COORDINATOR_WORD, MARKER_ORDER, NAME_BUDGET, cardFacts, cardWithinHeader, headerFacts, headerStatusWord, markers,
  sessionFacts, shortenByToken, type FactInput,
} from '../src/fleet/sessionFacts';
import type { ChildRunContext } from '../src/fleet/runWords';
import { setSkin } from '../src/lib/skin';
import { activity } from './delegationFixture';
import { ENTRIES_NOTE } from '../src/fleet/delegationWords';

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
  // Verifier round 1: the rows the first suite lacked.
  'a dead session that is not hibernated': {
    session: s({ workspace: 'still-pond', status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead' }), now: NOW,
  },
  'a hand-held workspace (held, no child mark)': {
    session: s({ workspace: 'calm-bay', held: 'waiting on the schema decision' }), now: NOW,
  },
  'a working row whose coordinator holds its question': {
    session: s({ workspace: 'dry-creek', status: 'busy', bucket: 'working', role: 'child',
      withCoordinator: { kind: 'question', parentId: 'lane-a-project-a', since: NOW - 30_000, notifyAt: NOW + 150_000 },
      ask: { state: 'held', parentId: 'lane-a-project-a' } } as Partial<FleetSession>),
    now: NOW,
  },
  'a cleanup row with its merged PR': {
    session: s({ workspace: 'wide-delta', bucket: 'cleanup', archivedBytes: 4_200_000,
      pr: { phase: 'merged', number: 77, url: null, title: null, checks: 'pass', checkNames: null, ahead: 0, reason: null,
        checkedAt: NOW, mergedAt: NOW - 60_000, retryAt: null } }),
    now: NOW,
  },
  'a working row with work in the background': {
    session: s({ workspace: 'soft-dune', status: 'idle', bucket: 'working', background: { count: 2, kinds: ['bash', 'agent'] } }),
    now: NOW,
  },
  // D-8276: an older Claude Code build than the fleet's newest: the quietest marker, and the header names the pair.
  'a session behind the fleet\'s newest Claude Code build': {
    session: s({ workspace: 'quiet-fen', version: '2.1.296' }), now: NOW, claudeLatest: '2.1.302', claudeLaneLatest: '2.1.302',
  },
  'an unreachable pane with every other marker too': {
    session: s({ substrate: { at: NOW - 60_000, text: 'tmux socket gone' }, limits: { five: 99, seven: null },
      swapBlocked: { at: NOW, reason: 'no headroom' }, unmeasured: ['uuid'] }),
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

  it('a coordinator\'s card names its role; a child\'s never does (D-8142)', () => {
    for (const [name, input] of Object.entries(CASES)) {
      const role = cardFacts(sessionFacts(input)).role;
      if (input.session.role === 'coordinator') {
        expect(role, name).toMatchObject({ key: 'role', text: 'coordinator' });
      } else {
        expect(role, name).toBeNull();
      }
    }
    expect(cardFacts(sessionFacts(CASES['a coordinator']!)).role).toEqual(
      { key: 'role', text: COORDINATOR_WORD, title: 'this session is its project\'s coordinator' });
    expect(cardFacts(sessionFacts(CASES['a coordinator']!)).role).not.toBeNull();
    expect(cardFacts(sessionFacts(CASES['a plain operator workspace with a PR']!)).role).not.toBeNull();
    for (const c of ['a held dispatched child', 'a hold whose run left the board']) {
      expect(cardFacts(sessionFacts(CASES[c]!)).role, c).toBeNull();
    }
    // An older server sends no role: a worker, so no role fact.
    const older = s({ workspace: 'old-pond' }) as unknown as Record<string, unknown>;
    delete older.role;
    expect(cardFacts(sessionFacts({ session: older as unknown as FleetSession, now: NOW })).role).toBeNull();
    expect(cardFacts(sessionFacts({ session: s({ role: null as never }), now: NOW })).role).toBeNull();
  });

  it('a coordinator with a long branch keeps both whole on the card (D-8142)', () => {
    const branch = 'feat/a-long-descriptive-branch-name-for-the-sidebar';
    const f = sessionFacts({ session: s({ workspace: 'bright-lake', name: 'bright-lake', role: 'coordinator', branch }), now: NOW });
    const c = cardFacts(f);
    expect(c.role?.text).toBe('coordinator');
    expect(c.context).toMatchObject({ key: 'branch', text: branch, short: 'feat/a-long…' });
    expect(c.context!.short!.length + c.role!.text.length + 3).toBeLessThanOrEqual(NAME_BUDGET);
    // A child, and a coordinator with no role cell to make room for, keep the full budget.
    const kid = cardFacts(sessionFacts({ session: s({ workspace: 'bright-lake', name: 'bright-lake', role: 'child', branch }), now: NOW }));
    expect(kid.context?.short).toBe(shortenByToken(branch, NAME_BUDGET));
  });

  it('a child names its programme and wave on the card; the header keeps the verbatim hold and the coordinator', () => {
    const f = sessionFacts(CASES['a held dispatched child']!);
    expect(cardFacts(f).context).toMatchObject({ key: 'programme', text: 'port-api · wave 5 of 7' });
    const h = headerFacts(f);
    expect(h).toContainEqual(expect.objectContaining({ key: 'hold', text: 'held: program:port-api wave:5/7 run:40' }));
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

const headerProps = (over: Partial<HeaderHostProps>): HeaderHostProps => ({
  session: null, status: 'idle', statusUpdatedAt: null,
  onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  ...over,
});

/** The text a reader SEES in a subtree — never a `title`, which a phone cannot show, nor an `sr-only` span
 *  (verifier round 1). `aria-hidden` text IS seen (TypedLabel's settled value is drawn that way). */
const visible = (el: Element): string => {
  const c = el.cloneNode(true) as Element;
  for (const x of c.querySelectorAll('.sr-only')) x.remove();
  return (c.textContent ?? '').replace(/\s+/g, ' ');
};

describe('the rendered card is a glance, and the rendered header holds all of it (both skins)', () => {
  for (const skin of ['refined', 'instrument'] as const) {
    for (const [name, input] of Object.entries(CASES)) {
      it(`${skin} · ${name}`, () => {
        act(() => setSkin(skin));
        const { container: card } = render(
          <SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={input.now}
            childRun={input.childRun} workingOn={input.workingOn ?? null} coordinator={input.coordinator ?? null}
            claudeLatest={input.claudeLatest ?? null} claudeLaneLatest={input.claudeLaneLatest ?? null} />,
        );
        const meta = card.querySelector('.sess-meta')!;
        // The glance: a status, at most one context, at most one marker — nothing else on the meta line.
        expect(meta.children.length).toBeLessThanOrEqual(3);
        // …and across the whole card: one marker at most, one context line at most.
        expect(card.querySelectorAll('[data-marker], .sess-spawn').length).toBeLessThanOrEqual(1);
        expect(card.querySelectorAll('.sess-meta').length).toBeLessThanOrEqual(2);
        expect(card.querySelector('.sess-acct')).toBeNull();
        expect(card.querySelector('.sess-ask')).toBeNull();
        expect(card.textContent).not.toMatch(/run #\d|run:\d|program:|wave:\d/);

        const facts = sessionFacts(input);
        const c = cardFacts(facts);
        render(<SessionHeaderHost {...headerProps({ session: input.session, status: input.session.status, facts, })} />);
        const head = document.querySelector('.chat-head')!;
        const toggle = screen.queryByRole('button', { name: /details/i });
        if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
        const text = visible(head);
        // The card's status word as the CARD renders it, in the header's visible text.
        const cardWord = visible(card.querySelector('.sess-state')!);
        expect(text, 'the card\'s status word is missing from the header').toContain(cardWord);
        for (const fact of [c.name, c.status, c.context, c.marker, c.workingOn, c.role]) {
          if (fact !== null) expect(text, `${fact.key} missing from the header`).toContain(fact.text);
        }
        // D-8142: a coordinator's context line begins with the one role cell; a child has none.
        const roles = card.querySelectorAll('.sess-role');
        if (input.session.role === 'coordinator') {
          expect(roles.length).toBe(1);
          const ctxLine = card.querySelector('.sess-meta--context')!;
          expect(ctxLine.firstElementChild).toBe(roles[0]);
          expect(visible(ctxLine).trim().startsWith('coordinator')).toBe(true);
          expect(text).toContain('coordinator');
        } else {
          expect(roles.length).toBe(0);
        }
        // The verbatim hold — the card's `held` or programme names it, the header spells it.
        if (input.session.held !== null) expect(text, 'the verbatim hold').toContain(`held: ${input.session.held}`);
        cleanup();
      });
    }
  }
});

describe('verifier round 1 — the gaps the first suite left open', () => {
  it('the header status word comes from the model and begins with the card\'s word, for every bucket', () => {
    for (const bucket of ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'] as const) {
      const f = sessionFacts({ session: s({ bucket, status: bucket === 'dead' ? 'dead' : 'idle' }), now: NOW });
      const head = headerStatusWord({ bucket, asleepAt: null, background: null, at: NOW - 120_000, now: NOW });
      expect(head.startsWith(f.statusText), `${bucket}: "${head}" vs card "${f.statusText}"`).toBe(true);
    }
  });

  it('a dead row reads `exited` on the card AND in the rendered header (the lamp still speaks "not running")', () => {
    const input = CASES['a dead session that is not hibernated']!;
    render(<SessionHeaderHost {...headerProps({ session: input.session, status: 'dead', facts: sessionFacts(input) })} />);
    expect(document.querySelector('.chat-head .status-line')?.textContent).toBe('exited');
    expect(screen.getByRole('img', { name: 'not running' })).toBeInTheDocument();
  });

  it('shortenByToken never returns a bare ellipsis, even for a separator-led text', () => {
    for (const text of ['.acb-', '-x-yyyy', '/_abc/def', '..hidden-file-name', '_a']) {
      for (let max = 1; max <= text.length; max += 1) {
        const out = shortenByToken(text, max);
        expect(out, `${text} @${max}`).not.toBe('…');
        if (out === text) continue;
        expect(text.startsWith(out.slice(0, -1))).toBe(true);
        expect(/[^-/_. ]/.test(out.slice(0, -1))).toBe(true);
      }
    }
  });

  it('the lifecycle qualifier reads the model\'s clock, never Date.now()', () => {
    const f = sessionFacts({
      session: s({ lifecycle: 'stopped', stoppedBy: { at: NOW - 5 * 60_000, surface: 'cli' } }), now: NOW,
    });
    expect(f.lifecycle).toBe('stopped by cli, 5m ago');
  });

  it('the orphan guidance rides the model, so the header\'s marker carries it as the card\'s does', () => {
    const input = { ...CASES['an orphan whose coordinator is gone']!, coordinatorTitle: 'coordinator x is gone — reclaim this programme from the run board' };
    const m = markers(sessionFacts(input)).find((x) => x.key === 'coordinator-gone')!;
    expect(m.title).toContain('reclaim');
    render(<SessionHeaderHost {...headerProps({ session: input.session, status: 'idle', facts: sessionFacts(input) })} />);
    const toggle = screen.queryByRole('button', { name: /details/i });
    if (toggle !== null) fireEvent.click(toggle);
    expect(document.querySelector('.chat-head [data-marker="coordinator-gone"]')?.getAttribute('title')).toContain('reclaim');
  });

  it('a cleanup row names its PR once in the header, not three times', () => {
    const input = CASES['a cleanup row with its merged PR']!;
    render(<SessionHeaderHost {...headerProps({ session: input.session, status: 'idle', facts: sessionFacts(input) })} />);
    const toggle = screen.queryByRole('button', { name: /details/i });
    if (toggle !== null) fireEvent.click(toggle);
    const facts = document.querySelector('.chat-facts')!;
    expect(visible(facts).match(/#77/g)?.length ?? 0).toBe(1);
  });

  it('the card button\'s accessible name is the FULL name, never the shortened one', () => {
    const input = CASES['a long name waiting on the operator']!;
    render(<SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    const btn = screen.getByRole('button', { name: /^an-exceptionally-long-session-name-that-will-not-fit-on-a-phone-screen/ });
    expect(btn.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('button', { name: /…/ })).toBeNull();
    // From its CONTENT, not the `title` fallback (a description, and absent where the name fits).
    btn.removeAttribute('title');
    expect(screen.getByRole('button', { name: /^an-exceptionally-long-session-name-that-will-not-fit-on-a-phone-screen/ })).toBe(btn);
  });

  it('a wide card can show a long name and a 31-character programme whole: both forms render, CSS picks by width', () => {
    const long = { ...RUN, program: 'a-very-long-programme-slug-name' };
    const input = { ...CASES['a held dispatched child']!, session: s({ name: 'an-exceptionally-long-session-name-that-will-not-fit',
      role: 'child', child: { kind: 'child', runId: 40 }, held: 'program:a-very-long-programme-slug-name wave:4/9 run:40' }),
      childRun: child({ ...long, wave: 4, waveOf: 9 }) };
    const { container } = render(<SessionLine session={input.session} onOpen={() => {}} onActions={() => {}} now={NOW}
      childRun={input.childRun} />);
    const fulls = [...container.querySelectorAll('.fit-full')].map((x) => x.textContent);
    expect(fulls).toContain('an-exceptionally-long-session-name-that-will-not-fit');
    expect(fulls).toContain('a-very-long-programme-slug-name');
    const shorts = [...container.querySelectorAll('.fit-short')].map((x) => x.textContent);
    expect(shorts.every((x) => x?.endsWith('…'))).toBe(true);
    // Both visual forms are hidden from the accessibility tree; the full text is spoken once.
    for (const el of container.querySelectorAll('.fit-full, .fit-short')) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('on a phone the card\'s marker and its non-programme context sit in the header before the details door is opened', () => {
    for (const name of ['a limit-hit session whose swap was refused', 'a hold whose run left the board',
      'a busy session under context pressure'] as const) {
      const input = CASES[name]!;
      const c = cardFacts(sessionFacts(input));
      render(<SessionHeaderHost {...headerProps({ session: input.session, status: input.session.status, facts: sessionFacts(input) })} />);
      const head = visible(document.querySelector('.chat-head')!);
      if (c.marker !== null) expect(head, `${name}: marker`).toContain(c.marker.short ?? c.marker.text);
      if (c.context !== null && c.context.key !== 'programme') expect(head, `${name}: context`).toContain(c.context.text);
      cleanup();
    }
  });
});

// Delegation visibility: the session header lists every delegation entry the session started, every liveness counted
// (D-7781). The row's R9 chip and its count comparison (D-7782) went with D-8771: the fleet list shows no such count.
describe('the header\'s delegated-entries disclosure (D-7781; the card chip is gone, D-8771)', () => {
  const worker = s({ role: 'child', child: { kind: 'child', runId: 40 }, status: 'busy', bucket: 'working' });
  const two = [activity({ activityId: 'a1', parentId: worker.id, displayName: 'map the tree' }),
    activity({ activityId: 'a2', parentId: worker.id, displayName: 'read the plan' })];

  it('C46 (supersedes D-7781 and D-7782 on the card): the card carries no delegated fact, the header keeps it with its count', () => {
    const f = sessionFacts({ session: worker, now: NOW, childRun: child(RUN), delegated: two });
    const card = cardFacts(f);
    expect(card, 'no field survives on the card').not.toHaveProperty('delegated');
    const head = headerFacts(f).find((h) => h.key === 'delegated');
    expect(head).toMatchObject({ text: '2 delegated' });
    expect(head?.title).toBe('2 recorded delegation entries, not a current agent count; execution not confirmed');
    // Every entry still counts in the header, of every liveness (D-7781's header side stands).
    const dead = s({ ...worker, status: 'dead', bucket: 'dead' });
    const three = [...two, activity({ activityId: 'a3', parentId: worker.id, liveness: 'stale' })];
    expect(headerFacts(sessionFacts({ session: dead, now: NOW, delegated: three })).find((h) => h.key === 'delegated')?.text).toBe('3 delegated');
    // The subset rule is now about the card's own facts only, and still catches a header that lacks one.
    expect(cardWithinHeader(card, headerFacts(f))).toEqual([]);
    expect(cardWithinHeader(card, headerFacts(f).filter((h) => h.key !== 'status'))).toEqual([card.status]);
  });

  it('C46: a session\'s row draws no count of its subagents or delegated entries, in its text or its accessible name', () => {
    const busy = s({ ...worker, subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }] });
    for (const session of [busy, s({ ...busy, status: 'dead', bucket: 'dead' })]) {
      const { container } = render(<SessionLine session={session} onOpen={() => {}} onActions={() => {}} now={NOW} />);
      const drawn = `${container.textContent} ${[...container.querySelectorAll('[aria-label],[title]')]
        .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`).join(' ')}`;
      expect(drawn).not.toMatch(/subagent|delegated|⑂/i);
      expect(container.querySelector('.sess-meta-chip')).toBeNull();
      expect(container.querySelector('.sess-subagents')).toBeNull();
      cleanup();
    }
  });

  it('C46: the same session\'s header still draws both disclosures with their counts', () => {
    const busy = s({ ...worker, subagents: [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }] });
    const f = sessionFacts({ session: busy, now: NOW, childRun: child(RUN), delegated: two });
    render(<SessionHeaderHost {...headerProps({ session: busy, status: busy.status, facts: f })} />);
    const toggle = screen.queryByRole('button', { name: /details/i });
    if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '2 subagents' }).textContent).toContain('2 subagents');
    expect(screen.getByRole('button', { name: '2 delegated' }).textContent).toContain('2 delegated');
  });

  it('VIS-H1: the header lists every entry the session started, once each, behind a disclosure that does not navigate', async () => {
    const entries = [
      activity({ activityId: 'a1', parentId: worker.id, placement: 'chip', displayName: 'map the tree' }),
      activity({ activityId: 'a2', parentId: worker.id, placement: 'row', displayName: 'read the plan', liveness: 'stale',
        openedAt: '2026-10-26T10:01:00.000Z' }),
      activity({ activityId: 'a3', parentId: worker.id, placement: 'row', displayName: 'check the build', liveness: 'unmeasured',
        openedAt: '2026-10-26T10:02:00.000Z' }),
    ];
    const f = sessionFacts({ session: worker, now: NOW, childRun: child(RUN), delegated: entries });
    render(<SessionHeaderHost {...headerProps({ session: worker, status: worker.status, facts: f })} />);
    const details = screen.queryByRole('button', { name: /details/i });
    if (details !== null && details.getAttribute('aria-expanded') === 'false') fireEvent.click(details);
    const door = screen.getByRole('button', { name: '3 delegated' });
    expect(door.getAttribute('aria-expanded')).toBe('false');
    expect(door.hasAttribute('aria-controls')).toBe(false);
    expect(document.body.textContent).not.toContain(ENTRIES_NOTE);
    const path = location.pathname;
    // Keyboard: Enter on the focused button opens it.
    door.focus();
    await userEvent.keyboard('{Enter}');
    expect(door.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(door.getAttribute('aria-controls')!);
    if (list === null) throw new Error('aria-controls names no element');
    expect(list.textContent).toContain(ENTRIES_NOTE);
    const rows = [...list.querySelectorAll('.proj-work')].map((r) => [...r.querySelectorAll('.proj-work-part')].map((p) => p.textContent));
    expect(rows).toEqual([
      ['agent', 'map the tree', 'not confirmed'], ['agent', 'read the plan', 'stop not seen'], ['agent', 'check the build', 'unmeasured'],
    ]);
    expect(location.pathname).toBe(path);
    // Touch: a tap closes it, and the list and its aria-controls go together.
    fireEvent.click(door);
    expect(door.getAttribute('aria-expanded')).toBe('false');
    expect(door.hasAttribute('aria-controls')).toBe(false);
    expect(document.body.textContent).not.toContain(ENTRIES_NOTE);
    expect(location.pathname).toBe(path);
  });

  it('the rendered header draws the delegated disclosure with its count', () => {
    const f = sessionFacts({ session: worker, now: NOW, childRun: child(RUN), delegated: two });
    render(<SessionHeaderHost {...headerProps({ session: worker, status: worker.status, facts: f })} />);
    const toggle = screen.queryByRole('button', { name: /details/i });
    if (toggle !== null && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    expect(visible(document.querySelector('.chat-head')!)).toContain('2 delegated');
  });
});

// The run page's header is a superset of the run row (the runs rebuild, Task 7, D-8072; spec 2026-11-04 §8.4; D-5545): every
// element the row draws is drawn again, word for word, from the same readers.
describe('a run row and its page header', () => {
  it('every row element appears verbatim in the header', async () => {
    const run = {
      id: 410, program: 'programme-a', programTitle: 'Programme A', runTitle: null, wave: 2, waveOf: 4, project: 'project-b',
      homeProject: 'project-a', kind: 'review', reviews: 409, state: 'working', sessionId: null, claimedBy: null, workspace: null,
      branch: null, resumed: true, clearedAt: null, dispatchStartedAt: null, dispatchedAt: null, openedAt: NOW - 60_000,
      closedAt: null, items: { done: 1, total: 3 }, unreadMail: 0, handoffCommit: null,
      stuck: { reason: 'owner-gone', cause: null, since: NOW - 60_000, closes: null }, waitsOn: 'coordinator', blockedBy: null,
      health: { mailParked: 2, mailOutstanding: 1, mailParkedLive: 1, mailReplayMax: 0, briefQueued: null, clearError: null, coordKickoffPendingSince: null },
      workerLastSeen: NOW - 300_000, workerLastTurn: { state: 'done', startedAt: NOW - 900_000, endedAt: NOW - 300_000 },
    } as unknown as RunSummary;
    const row = render(<ul><RunRow run={run} nowMs={NOW} session={null} /></ul>);
    const rowTexts = [...row.container.querySelectorAll('.run-state, .run-name, .run-project, .run-crossing, .run-kind, .run-tally, .run-commits, .run-when, .run-seen, .run-resumed, .run-warn-item, .run-wait')]
      .map((e) => e.textContent ?? '');
    row.unmount();
    // Neither the lamp's word nor a marker is optional in this case: the row draws them, so the header must.
    expect(rowTexts).toEqual(expect.arrayContaining(['stuck', 'resumed, not cleared', 'last seen 5m ago']));
    expect(rowTexts.length).toBeGreaterThanOrEqual(8);
    vi.spyOn(api, 'runRecord').mockResolvedValue({ ok: true, run, events: [], reviewedBy: [], olderEvents: 0 });
    vi.spyOn(api, 'run').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'runItems').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'runSignals').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'goals').mockRejectedValue(new Error('offline'));
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    try {
      render(<RunDetailScreen id={410} store={createFleetStore({ makeSocket: () => ({ close() {} }) as unknown as WebSocket })} />);
    } finally { vi.useRealTimers(); }
    const header = (await waitFor(() => { const h = document.querySelector('.rd-head'); if (h === null) throw new Error('no header'); return h; })).textContent ?? '';
    for (const t of rowTexts) expect(header, t).toContain(t);
  });
});
