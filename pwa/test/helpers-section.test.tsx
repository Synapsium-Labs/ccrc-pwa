// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4 and §10, Tables 4 to 6, Table 13's H2 row): the
// Helpers section, drawn from what H1a and H1b put on the frame. It replaces the workflow strip under the transcript and,
// at 1600 px and up in a skin that places an inspector, sits in the rail instead (the same rule as the mail and task
// strips: a hidden rail brings it back into the column). Render tests at 360 and 1280 px; the census of words no row may
// say; the glyph each state draws (review 2900 F16: a state left out draws a neutral glyph, never the running one); the
// tap floor of the fold toggle and the report's links (review 2900 F18); and the report a finished row opens to, asked of
// the server on demand.
//
// RED FIRST: committed before the code, against origin/main, where none of it exists.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { SessionScreen } from '../src/screens/SessionScreen';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import { InspectorSections } from '../src/inspector/InspectorSections';
import { InspectorRail } from '../src/skins/refined/InspectorRail';
import { navigate } from '../src/lib/router';
import { createSessionStore, getSessionStore } from '../src/stores/session';
import type { SessionStreamMsg } from '../../shared/api';
import type { AgentHelperView, HelpersUnmeasured, WorkflowView } from '../../shared/workflows';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && !q.includes('pointer: coarse');
    return { matches, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  });
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

const NOW = Date.parse('2026-11-21T10:00:00.000Z');
const agent = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: `Measure ${id}`, agentType: 'general-purpose', model: 'Sonnet', effort: 'high', state: 'running',
  startedAt: NOW - 725_000, endedAt: null, lastActivityAt: NOW - 20_000, tokens: 41_000, summary: null, hasReport: false, ...o,
});
const wf = (id: string, o: Partial<WorkflowView> = {}): WorkflowView => ({
  id, name: 'review-panel', state: 'running', done: 7, failed: 0, total: 12, phase: 'Verify', phases: ['Build', 'Verify'],
  startedAt: NOW - 362_000, endedAt: null, tokens: 2_500_000, tokensUnmeasured: 0,
  agents: [{ label: 'build', phase: 'Build', state: 'done' }, { label: 'verify-1', phase: 'Verify', state: 'running' }],
  agentsOmitted: 0, lastActivityAt: NOW - 4_000, ...o,
});

const RUNNING = [agent('server helper sources'), agent('transcript helper sources', { startedAt: NOW - 708_000, lastActivityAt: NOW - 11 * 60_000, tokens: 63_000 })];
const DONE = agent('today\'s session panel', {
  state: 'done', startedAt: NOW - 400_000, endedAt: NOW - 148_000, summary: 'header facts only', hasReport: true, tokens: null,
});
const FAILED = agent('the mockup', { state: 'failed', startedAt: NOW - 200_000, endedAt: NOW - 137_000, summary: 'headless browser not found', hasReport: false });

/** What each test session's socket sent, by session id: the store's own asks, as the server would read them. */
const SENT = new Map<string, Array<{ type: string; id?: string }>>();
/** Each test session's newest socket, by session id: a case drops it with its `onclose`. */
const SOCKETS = new Map<string, { onclose: (() => void) | null; onopen: (() => void) | null }>();
function sessionWith(id: string, frame: Partial<SessionStreamMsg & { type: 'workflows' }>): ReturnType<typeof createSessionStore> {
  const sent: Array<{ type: string; id?: string }> = [];
  SENT.set(id, sent);
  const store = createSessionStore(id, {
    makeSocket: () => {
      const sock = {
        onopen: null, onmessage: null, onclose: null, onerror: null, readyState: 1, close() {},
        send(raw: string) { sent.push(JSON.parse(raw) as { type: string; id?: string }); },
      };
      SOCKETS.set(id, sock);
      return sock as unknown as WebSocket;
    },
    api: { prompt: async () => {} },
  });
  act(() => {
    store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
    store.getState().apply({ type: 'workflows', workflows: [], ...frame } as SessionStreamMsg);
  });
  return store;
}

function screenAt(width: number, frame: Partial<SessionStreamMsg & { type: 'workflows' }>, set = REFINED_SET) {
  stubWidth(width);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const id = `lane-a-project-a-h2-${width}-${Math.random().toString(36).slice(2, 8)}`;
  const store = sessionWith(id, frame);
  const r = render(<SkinSetProvider set={set}><SessionScreen id={id} store={store} /></SkinSetProvider>);
  return { ...r, id, store, section: (): HTMLElement | null => r.container.querySelector('.chat-strips .helpers-strip') };
}
const open = (section: HTMLElement): void => { fireEvent.click(within(section).getByRole('button', { name: /^Helpers/ })); };

/** Line 2 as a reader at `width` sees it: jsdom does not evaluate container queries, so the parts the stylesheet hides at
 *  that width (pinned in "review 3072 F6 and F7" below) are removed here — the tokens on a phone, the inline elapsed at the
 *  desk — and the real-Chrome `helpers-rail` file measures the same at 360 and 1280. */
function line2At(row: Element, width: number): string {
  const facts = row.querySelector('.helper-facts')!.cloneNode(true) as Element;
  for (const hidden of facts.querySelectorAll(width < 480 ? '.helper-tokens' : '.helper-elapsed-inline')) hidden.remove();
  return facts.textContent!.replace(/\u00A0/g, ' '); // the no-break spaces before a group's separators are pinned apart (review 3099 F2)
}
const plain = (t: string | null): string => (t ?? '').replace(/\u00A0/g, ' ');

for (const width of [360, 1280]) {
  describe(`${width} px: the section sits in the strips under the transcript`, () => {
    it('Table 4: the head says "Helpers", the counts once, and each not-known line once', () => {
      const s = screenAt(width, {
        workflows: [wf('wf_00000000-aaa')], agents: [...RUNNING, DONE, FAILED],
      });
      const sec = s.section()!;
      expect(sec, 'in the column').not.toBeNull();
      const head = within(sec).getByRole('button', { name: /^Helpers/ });
      expect(head.textContent).toContain('Helpers');
      expect(head.textContent).toContain('3 running');
      expect(head.textContent).toContain('2 finished');
      expect(head.getAttribute('aria-expanded')).toBe('false');
    });

    it('Table 4: a stale roster is said once in the head, and the rows carry no state', () => {
      const unmeasured: HelpersUnmeasured = { why: 'stale', hookAgeMs: 41 * 60_000 };
      const s = screenAt(width, { workflows: [], agents: RUNNING.map((a) => ({ ...a, state: 'unmeasured' as const })), agentsUnmeasured: unmeasured });
      const sec = s.section()!;
      expect(sec.textContent!.match(/live state not known: no news from the session for 41m/g)).toHaveLength(1);
      expect(sec.textContent).toContain('2 helpers');
      open(sec);
      for (const row of sec.querySelectorAll('[data-helper-row]')) expect(row.textContent).not.toMatch(/running/);
    });

    it('collapsed: the glance takes running rows only, never a row that claims no running', () => {
      const s = screenAt(width, { agents: [RUNNING[0]!, agent('quiet one', { state: 'unlisted' })] });
      const glance = s.section()!.querySelectorAll('[data-helper-glance]');
      expect(glance).toHaveLength(1);
      expect(glance[0]!.textContent).toContain('Measure server helper sources');
    });

    it('collapsed: the head and line 1 of the first two running rows, each with its state word kept visible', () => {
      const s = screenAt(width, { workflows: [wf('wf_00000000-aaa', { startedAt: NOW - 100 })], agents: RUNNING });
      const glance = s.section()!.querySelectorAll('.helpers-glance [data-helper-glance]');
      expect(glance).toHaveLength(2);
      expect(glance[0]!.textContent).toContain('Measure server helper sources');
      expect(glance[0]!.querySelector('.helper-glance-state')!.textContent).toBe('running');
      expect(s.section()!.querySelector('.helpers-rows'), 'collapsed: no rows mounted').toBeNull();
    });

    it(width < 480
      ? 'Table 5 at the phone width: line 2 says kind, model, effort, state, elapsed and last activity, no tokens (§10)'
      : 'Table 5 at the desk: an Agent row says its kind, model, effort, state, last activity and tokens; elapsed on the right of line 1', () => {
      const s = screenAt(width, { agents: [RUNNING[0]!] });
      open(s.section()!);
      const row = s.section()!.querySelector('[data-helper-row="server helper sources"]')!;
      expect(row.querySelector('.helper-what')!.textContent).toBe('Measure server helper sources');
      expect(line2At(row, width)).toBe(width < 480
        ? 'subagent · general-purpose · Sonnet · high · running · 12m5s · active 20s ago'
        : 'subagent · general-purpose · Sonnet · high · running · active 20s ago · ↓ 41k');
      expect(row.querySelector(':scope > .helper-elapsed')!.textContent, 'line 1\'s elapsed (the desk draws it)').toBe('12m5s');
      expect(plain(row.querySelector('.helper-elapsed-inline')!.textContent), 'line 2\'s elapsed (the phone draws it)').toBe(' · 12m5s');
    });

    it('Table 5: past ten minutes quiet, the last activity reads "quiet 11m", in the muted ink, with no state change', () => {
      const s = screenAt(width, { agents: [RUNNING[1]!] });
      open(s.section()!);
      const row = s.section()!.querySelector('[data-helper-row="transcript helper sources"]')!;
      const quiet = row.querySelector('.helper-activity')!;
      expect(quiet.textContent).toBe('quiet 11m');
      expect(quiet.getAttribute('data-quiet')).toBe('');
      expect(row.querySelector('.helper-facts')!.textContent).toContain('running');
    });

    it('Table 5: a missing effort, model or token count is left out, never guessed', () => {
      const s = screenAt(width, { agents: [agent('bare', { effort: null, model: null, tokens: null, lastActivityAt: null })] });
      open(s.section()!);
      const row = s.section()!.querySelector('[data-helper-row="bare"]')!;
      expect(line2At(row, width)).toBe(width < 480 ? 'subagent · general-purpose · running · 12m5s' : 'subagent · general-purpose · running');
      expect(row.querySelector('.helper-tokens')).toBeNull();
    });

    it('Table 5: a workflow row says its name, kind, state, phase, progress, last activity, tokens, and its meter', () => {
      const s = screenAt(width, { workflows: [wf('wf_00000000-aaa')] });
      open(s.section()!);
      const row = s.section()!.querySelector('[data-helper-row="wf_00000000-aaa"]')!;
      expect(row.querySelector('.helper-what')!.textContent).toBe('review-panel');
      expect(line2At(row, width)).toBe(width < 480
        ? 'workflow · running · phase Verify · 7/12 agents · 6m2s · active 4s ago'
        : 'workflow · running · phase Verify · 7/12 agents · active 4s ago · ↓ 2.5m tokens');
      expect(row.querySelector('.helper-tokens')!.textContent).toBe(' · ↓ 2.5m tokens');
      expect(row.querySelector('.meter, [data-band]')).not.toBeNull();
      expect(row.querySelector('.helper-elapsed')!.textContent).toBe('6m2s');
    });

    it('Table 6: finished rows fold away under "Finished · last 10 min (N)", closed by default', () => {
      const s = screenAt(width, { agents: [RUNNING[0]!, DONE, FAILED] });
      open(s.section()!);
      const toggle = within(s.section()!).getByRole('button', { name: /Finished · last 10 min \(2\)/ });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(s.section()!.querySelector('[data-helper-row="today\'s session panel"]')).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const done = s.section()!.querySelector('[data-helper-row="today\'s session panel"]')!;
      expect(plain(done.querySelector('.helper-facts')!.textContent)).toBe('done · 4m12s · header facts only');
      const failed = s.section()!.querySelector('[data-helper-row="the mockup"]')!;
      expect(failed.querySelector('.helper-facts')!.textContent).toBe('failed · 1m3s · headless browser not found');
    });

    it('Table 6: stopped, finished and a workflow\'s final words', () => {
      const s = screenAt(width, {
        agents: [
          agent('stop', { state: 'stopped', startedAt: NOW - 30_000, endedAt: NOW - 8_000 }),
          agent('fin', { state: 'finished', startedAt: NOW - 400_000, endedAt: NOW - 40_000 }),
        ],
        workflows: [wf('wf_00000000-bbb', { state: 'completed', done: 12, failed: 0, total: 12, startedAt: NOW - 400_000, endedAt: NOW - 30_000 })],
      });
      open(s.section()!);
      fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished · last 10 min \(3\)/ }));
      const facts = (id: string): string => s.section()!.querySelector(`[data-helper-row="${id}"] .helper-facts`)!.textContent!;
      expect(facts('stop')).toBe('stopped · 22s');
      expect(facts('fin')).toBe('finished · 6m0s');
      expect(facts('wf_00000000-bbb')).toBe('done · 12/12 agents · 6m10s');
    });

    it('review 3072 F8: a workflow whose token count misses some agents reads "↓ 2.5m+ tokens" (the floor)', () => {
      const s = screenAt(width, { workflows: [wf('wf_00000000-aaa', { tokensUnmeasured: 2 })] });
      open(s.section()!);
      expect(s.section()!.querySelector('[data-helper-row="wf_00000000-aaa"] .helper-tokens')!.textContent).toBe(' · ↓ 2.5m+ tokens');
    });

    it('review 3072 F8: a row with no measured start draws no elapsed time, on line 1 or line 2', () => {
      const s = screenAt(width, { agents: [agent('no start', { startedAt: null })] });
      open(s.section()!);
      const row = s.section()!.querySelector('[data-helper-row="no start"]')!;
      expect(row.querySelector('.helper-elapsed')).toBeNull();
      expect(row.querySelector('.helper-elapsed-inline')).toBeNull();
      expect(line2At(row, width)).toBe('subagent · general-purpose · Sonnet · high · running · active 20s ago' + (width < 480 ? '' : ' · ↓ 41k'));
    });

    it('review 3072 F8: the collapsed glance is a list of its rows', () => {
      const s = screenAt(width, { agents: RUNNING });
      const glance = within(s.section()!).getByRole('list');
      expect(within(glance).getAllByRole('listitem')).toHaveLength(2);
    });

    it('review 3072 F3: a state outside the vocabulary (a newer server\'s) draws the neutral glyph, for an Agent helper and a workflow, and never throws', () => {
      const s = screenAt(width, {
        agents: [agent('newer', { state: 'paused' as AgentHelperView['state'] })],
        workflows: [
          wf('wf_00000000-ccc', { state: 'paused' as WorkflowView['state'] }),
          wf('wf_00000000-ddd', { agents: [{ label: 'queued-1', phase: 'Verify', state: 'queued' as WorkflowView['agents'][number]['state'] }] }),
        ],
      });
      open(s.section()!);
      const fold = within(s.section()!).queryByRole('button', { name: /Finished · last 10 min/ });
      if (fold !== null) fireEvent.click(fold); // a state that is not running may sort into the fold
      const g = (id: string): [string, string] => {
        const el = s.section()!.querySelector(`[data-helper-row="${id}"] .helper-glyph`)!;
        return [el.textContent!, el.getAttribute('data-tone')!];
      };
      expect(g('newer')).toEqual(['◇', 'neutral']);
      expect(g('wf_00000000-ccc')).toEqual(['◇', 'neutral']);
      const detail = s.section()!.querySelector('[data-helper-row="wf_00000000-ddd"]')!;
      fireEvent.click(within(detail as HTMLElement).getByRole('button', { name: 'review-panel' }));
      expect(detail.querySelector('.helper-phase-agent-glyph')!.textContent, 'a phase agent in an unknown state').toBe('◇');
    });
  });
}

describe('the word census (Table 13, H2): no row says "not confirmed" or "unmeasured"; no fold row is "no longer listed" or "session ended"', () => {
  it('every state drawn, fold open, every workflow fact unmeasured', () => {
    const states: AgentHelperView['state'][] = ['launched', 'running', 'done', 'failed', 'stopped', 'finished', 'unlisted', 'gone', 'unmeasured'];
    const s = screenAt(1280, {
      agents: states.map((state, i) => agent(`s-${state}`, {
        description: `Helper number ${i}`, state, endedAt: ['done', 'failed', 'stopped', 'finished'].includes(state) ? NOW - 1_000 * (i + 1) : null, tokens: null,
      })),
      workflows: [wf('wf_00000000-aaa', { tokens: null, done: null, failed: null, total: null }), wf('wf_00000000-bbb', { state: 'killed', endedAt: NOW - 9_000, tokens: null })],
      agentsUnmeasured: { why: 'unseen', helpers: 1 },
    });
    open(s.section()!);
    fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished · last 10 min/ }));
    const rows = [...s.section()!.querySelectorAll('[data-helper-row]')];
    expect(rows.length).toBe(11);
    for (const row of rows) expect(row.textContent, row.getAttribute('data-helper-row')!).not.toMatch(/not confirmed|unmeasured|unreadable/);
    const fold = s.section()!.querySelector('.helpers-finished')!;
    for (const row of fold.querySelectorAll('[data-helper-row]')) expect(row.textContent).not.toMatch(/no longer listed|session ended/);
    // The two claim-no-end states are drawn, in the main list.
    expect(s.section()!.querySelector('[data-helper-row="s-unlisted"]')!.textContent).toContain('no longer listed');
    expect(s.section()!.querySelector('[data-helper-row="s-gone"]')!.textContent).toContain('session ended');
    expect(fold.querySelector('[data-helper-row="s-unlisted"]')).toBeNull();
  });
});

describe('review 2900 F16: each state\'s glyph; a state left out is neutral, never the running one', () => {
  const GLYPH: Record<AgentHelperView['state'], { glyph: string; tone: string }> = {
    running: { glyph: '◆', tone: 'busy' },
    launched: { glyph: '◇', tone: 'neutral' },
    unlisted: { glyph: '◇', tone: 'neutral' },
    gone: { glyph: '◇', tone: 'neutral' },
    unmeasured: { glyph: '◇', tone: 'neutral' },
    done: { glyph: '✓', tone: 'done' },
    failed: { glyph: '✗', tone: 'dead' },
    stopped: { glyph: '■', tone: 'neutral' },
    finished: { glyph: '✓', tone: 'neutral' },
  };
  it('the rule, per state', () => {
    const states = Object.keys(GLYPH) as AgentHelperView['state'][];
    const s = screenAt(1280, { agents: states.map((state) => agent(`g-${state}`, { state, endedAt: ['done', 'failed', 'stopped', 'finished'].includes(state) ? NOW - 1_000 : null })) });
    open(s.section()!);
    fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished · last 10 min/ }));
    for (const state of states) {
      const g = s.section()!.querySelector(`[data-helper-row="g-${state}"] .helper-glyph`)!;
      expect([g.textContent, g.getAttribute('data-tone')], state).toEqual([GLYPH[state].glyph, GLYPH[state].tone]);
      expect(g.getAttribute('aria-hidden')).toBe('true');
    }
  });
  it('a running workflow draws its own glyph in the busy tone; a finished one its last word\'s', () => {
    const s = screenAt(1280, { workflows: [wf('wf_00000000-aaa'), wf('wf_00000000-bbb', { state: 'failed', endedAt: NOW - 1_000 })] });
    open(s.section()!);
    fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished · last 10 min/ }));
    const g = (id: string): [string | null, string | null] => {
      const el = s.section()!.querySelector(`[data-helper-row="${id}"] .helper-glyph`)!;
      return [el.textContent, el.getAttribute('data-tone')];
    };
    expect(g('wf_00000000-aaa')).toEqual(['▣', 'busy']);
    expect(g('wf_00000000-bbb')).toEqual(['✗', 'dead']);
  });
  it('the stylesheet gives the busy tone the running ink and the neutral tone none of it', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workflow-strip.css'), 'utf8');
    const rule = (sel: string): string => { const i = css.indexOf(`${sel} {`); expect(i, sel).toBeGreaterThanOrEqual(0); return css.slice(i, css.indexOf('}', i)); };
    expect(rule('.helpers-strip .helper-glyph[data-tone=\'busy\']')).toContain('var(--status-busy-text)');
    expect(rule('.helpers-strip .helper-glyph[data-tone=\'neutral\']')).not.toContain('busy');
  });
});

describe('review 3072 F6 and F7: line 2 breaks only between its groups, and the phone layout moves elapsed into it', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workflow-strip.css'), 'utf8');
  const rule = (sel: string, from = 0): string => { const i = css.indexOf(`${sel} {`, from); expect(i, sel).toBeGreaterThanOrEqual(0); return css.slice(i, css.indexOf('}', i)); };
  const phone = css.indexOf('@container (max-width: 479px) {');
  it('line 2 is one run of text: each fact and each word of the state group is a block no wider than the line, and only a prose fact wraps anywhere', () => {
    expect(rule('.helpers-strip .helper-line2')).toContain('display: block');
    expect(css).toContain('.helper-fact,\n  .helper-word {');
    expect(rule('.helper-word')).toContain('display: inline-block');
    expect(rule('.helper-word')).toContain('max-width: 100%');
    expect(rule('.helper-prose')).toContain('overflow-wrap: anywhere');
    expect(rule('.helper-prose')).not.toContain('nowrap');
  });
  it('the state and its times are one group, the separators between groups outside it', () => {
    const s = screenAt(1280, { agents: [RUNNING[0]!] });
    open(s.section()!);
    const row = s.section()!.querySelector('[data-helper-row="server helper sources"]')!;
    const groups = [...row.querySelectorAll('.helper-fact')].map((g) => plain(g.textContent));
    expect(groups).toEqual(['subagent · general-purpose', 'Sonnet', 'high', 'running · 12m5s · active 20s ago']);
    expect(row.querySelector('.helper-state .helper-activity')).not.toBeNull();
    // Inside the group each word is its own block, so a group wider than the line breaks between words, never inside one.
    expect([...row.querySelectorAll('.helper-state .helper-word')].map((w) => w.textContent)).toEqual(['running', '12m5s', 'active 20s ago']);
  });
  it('review 3099 F2: every " · " inside a state group is preceded by a no-break space, so a separator ends a line and never starts one', () => {
    for (const frame of [{ agents: [RUNNING[0]!] }, { workflows: [wf('wf_00000000-aaa')] }]) {
      const s = screenAt(1280, frame);
      open(s.section()!);
      const groups = [...s.section()!.querySelectorAll('.helper-state')];
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        const t = g.textContent!;
        expect(t, 'a group with a separator').toContain('·');
        expect(t.match(/(?<!\u00A0)·/g), `a "·" not after U+00A0 in "${t}"`).toBeNull();
        expect(t.match(/\u00A0· /g)!.length).toBe(t.split('·').length - 1);
      }
      s.unmount();
    }
  });
  it('review 3099 F2: no rule on a state group or its words lets a word split inside', () => {
    expect(css).not.toMatch(/\.helper-state[^{]*\{[^}]*(overflow-wrap:\s*anywhere|word-break:\s*break-all)/);
    expect(rule('.helper-word'), 'today\'s rule: only a word wider than the whole line wraps, by overflow-wrap').not.toMatch(/word-break|break-word/);
    expect(rule('.helper-word')).toContain('display: inline-block');
    expect(css).toContain('.helper-fact,\n  .helper-word {'); // the shared rule: a fact or word is a block; only a word wider than the line wraps
  });
  it('review 3099 F5: a finished Agent row draws its summary as the wrappable prose part, outside the state group', () => {
    const s = screenAt(1280, { agents: [DONE] });
    open(s.section()!);
    fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished/ }));
    const row = s.section()!.querySelector('[data-helper-row="today\'s session panel"]')!;
    const prose = row.querySelector('.helper-prose')!;
    expect(prose.textContent).toBe('header facts only');
    expect(prose.closest('.helper-state')).toBeNull();
    expect(plain(row.querySelector('.helper-state')!.textContent)).toBe('done · 4m12s');
  });
  it('at the desk the inline elapsed is hidden; under the phone container query line 1\'s elapsed hides, line 2\'s shows and the tokens hide', () => {
    expect(rule('.helper-elapsed-inline')).toContain('display: none');
    expect(phone).toBeGreaterThan(0);
    expect(rule('.helper-row > .helper-elapsed', phone)).toContain('display: none');
    expect(rule('.helper-elapsed-inline', phone)).toContain('display: inline');
    expect(rule('.helper-tokens', phone)).toContain('display: none');
  });
  it('review 3072 F14: " · " stands before the tokens, as the mockup draws it (review 3099 F5: the report links\' separator is pinned elsewhere)', () => {
    const s = screenAt(1280, { agents: [RUNNING[0]!] });
    open(s.section()!);
    expect(s.section()!.querySelector('.helper-tokens')!.textContent).toBe(' · ↓ 41k');
  });
});

describe('review 2900 F18: the fold toggle and the report\'s links clear the tap floor', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workflow-strip.css'), 'utf8');
  const rule = (sel: string): string => { const i = css.indexOf(`${sel} {`); expect(i, sel).toBeGreaterThanOrEqual(0); return css.slice(i, css.indexOf('}', i)); };
  for (const sel of ['.helpers-strip .helpers-fold-toggle', '.helpers-strip .helper-open', '.helpers-strip .helper-report-link']) {
    it(`${sel}: min-height var(--tap-min)`, () => { expect(rule(sel)).toContain('min-height: var(--tap-min)'); });
  }
  it('the head is a real button with aria-expanded, at the tap floor', () => {
    const s = screenAt(360, { agents: RUNNING });
    const head = within(s.section()!).getByRole('button', { name: /^Helpers/ });
    expect(head.tagName).toBe('BUTTON');
    expect(head.className).toContain('min-h-tap');
  });
});

describe('the report a finished row opens to (§4.3): asked of the server once, first 4 lines, then Show all and Copy', () => {
  const REPORT = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n');
  /** The real store on an open socket: `sent()` is the ids its asks put on the wire (the store dedupes, review 3072 F4). */
  const opened = (answer?: { report: string | null; cut: boolean }, agents: AgentHelperView[] = [DONE]) => {
    const s = screenAt(1280, { agents });
    act(() => { s.store.getState().connect(); });
    act(() => { s.store.getState().apply({ type: 'workflows', workflows: [], agents }); }); // this stream's first frame
    const wire = SENT.get(s.id)!;
    const sent = (): string[] => wire.filter((m) => m.type === 'helper-report').map((m) => m.id!);
    open(s.section()!);
    fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished · last 10 min/ }));
    const row = (): HTMLElement => s.section()!.querySelector('[data-helper-row="today\'s session panel"]')!;
    expect(sent(), 'a row nobody opened asks nothing').toEqual([]);
    fireEvent.click(within(row()).getByRole('button', { name: /Measure today's session panel/ }));
    if (answer !== undefined) act(() => s.store.getState().apply({ type: 'helper-report', id: DONE.id, ...answer } as unknown as SessionStreamMsg));
    return { s, sent, row };
  };

  it('opening asks for that one report, once', () => {
    const { sent } = opened();
    expect(sent()).toEqual([DONE.id]);
  });

  it('closing and opening again before an answer asks no second time', () => {
    const { sent, row } = opened();
    const open1 = within(row()).getByRole('button', { name: /Measure today's session panel/ });
    fireEvent.click(open1);
    fireEvent.click(within(row()).getByRole('button', { name: /Measure today's session panel/ }));
    expect(sent()).toEqual([DONE.id]);
  });

  it('review 3072 F2: done with an answer, continued, done at a new end: the row asks again and never draws the earlier report', () => {
    const { s, sent } = opened({ report: 'the earlier report', cut: false });
    expect(s.section()!.querySelector('.helper-report-text')!.textContent).toBe('the earlier report');
    act(() => { s.store.getState().apply({ type: 'workflows', workflows: [], agents: [{ ...DONE, state: 'running', endedAt: null, hasReport: false }] }); });
    const later = { ...DONE, endedAt: NOW - 20_000 };
    act(() => { s.store.getState().apply({ type: 'workflows', workflows: [], agents: [later] }); });
    const fold = within(s.section()!).getByRole('button', { name: /Finished · last 10 min/ });
    if (fold.getAttribute('aria-expanded') !== 'true') fireEvent.click(fold);
    const row = s.section()!.querySelector('[data-helper-row="today\'s session panel"]')!;
    if (row.querySelector('.helper-report') === null) fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Measure today's session panel/ }));
    expect(s.section()!.querySelector('.helper-report-text'), 'no earlier text under the new end').toBeNull();
    expect(sent(), 'asked again for the new end').toEqual([DONE.id, DONE.id]);
  });

  /** Drop the session's stream and open a new one; the new stream's first frame restates the rows. */
  const newStream = (s: ReturnType<typeof opened>['s'], agents: AgentHelperView[]): void => {
    act(() => { SOCKETS.get(s.id)!.onclose?.(); });
    act(() => { window.dispatchEvent(new Event('online')); });
    act(() => { SOCKETS.get(s.id)!.onopen?.(); });
    act(() => { s.store.getState().apply({ type: 'workflows', workflows: [], agents: agents.map((a) => ({ ...a })) }); });
  };

  it('review 3072 F4: an open row with no answer asks again after a new stream\'s first frame', () => {
    const { s, sent } = opened();
    expect(sent()).toEqual([DONE.id]);
    newStream(s, [DONE]);
    expect(sent(), 'the server could not answer the first ask; the open row asks the new stream').toEqual([DONE.id, DONE.id]);
  });

  it('review 3072 F4: a row that has its answer does not ask a new stream again', () => {
    const { s, sent } = opened({ report: 'the report', cut: false });
    expect(sent()).toEqual([DONE.id]);
    newStream(s, [DONE]);
    expect(s.section()!.querySelector('.helper-report-text')!.textContent).toBe('the report');
    expect(sent()).toEqual([DONE.id]);
  });

  it('review 3072 F13: a report that ends in a newline counts its lines without the empty tail', () => {
    const { row } = opened({ report: `${REPORT}\n`, cut: false });
    within(row()).getByRole('button', { name: 'Show all (6 lines)' });
  });

  it('the answer draws its first 4 lines, then "Show all (6 lines)" and Copy; Show all draws every line', () => {
    const { row } = opened({ report: REPORT, cut: false });
    const body = row().querySelector('.helper-report')!;
    expect(body.querySelector('.helper-report-text')!.textContent).toBe('one\ntwo\nthree\nfour');
    const show = within(row()).getByRole('button', { name: 'Show all (6 lines)' });
    within(row()).getByRole('button', { name: 'Copy' });
    expect(row().querySelector('.helper-report-links')!.textContent, 'review 3072 F14').toBe('Show all (6 lines) · Copy');
    fireEvent.click(show);
    expect(row().querySelector('.helper-report-text')!.textContent).toBe(REPORT);
  });

  it('a cut report says so', () => {
    const { row } = opened({ report: 'part', cut: true });
    expect(row().querySelector('.helper-report')!.textContent).toMatch(/cut at 16 KiB/);
  });

  it('an answer that there is none says so, without a word it cannot act on', () => {
    const { row } = opened({ report: null, cut: false });
    const text = row().querySelector('.helper-report')!.textContent!;
    expect(text).toMatch(/report is no longer held/);
    expect(text).not.toMatch(/unmeasured|not confirmed/);
  });

  it('an older server never answers: the row stays open with no report drawn, and nothing claims there is none', () => {
    const { row } = opened();
    expect(row().querySelector('.helper-report-text')).toBeNull();
    expect(row().textContent).not.toMatch(/no longer held/);
  });

  it('a row with no report has nothing to open', () => {
    const s = screenAt(1280, { agents: [FAILED] });
    open(s.section()!);
    fireEvent.click(within(s.section()!).getByRole('button', { name: /Finished · last 10 min/ }));
    const row = s.section()!.querySelector('[data-helper-row="the mockup"]')!;
    expect(row.querySelector('button.helper-open')).toBeNull();
  });
});

describe('review 3014 F13: absent agents draws nothing', () => {
  it('a frame with no rows (an older server, or none): no section, no "none" (a characterization pin: main draws nothing too)', () => {
    const s = screenAt(1280, {});
    expect(s.section()).toBeNull();
    expect(s.container.textContent).not.toMatch(/no helpers|Helpers · none/);
  });
});

describe('the rail at 1600 px and up (one instance per width)', () => {
  const ID = 'lane-a-project-a-h2-rail';
  it('at >=1600 in Refined the column draws no Helpers strip; below it, and in a skin with no inspector, it does', () => {
    const store = sessionWith(`${ID}-col`, { agents: RUNNING });
    const at = (width: number, set = REFINED_SET): boolean => {
      stubWidth(width);
      const r = render(<SkinSetProvider set={set}><SessionScreen id={`${ID}-col`} store={store} /></SkinSetProvider>);
      act(() => store.getState().apply({ type: 'workflows', workflows: [], agents: RUNNING }));
      const out = r.container.querySelector('.chat-strips .helpers-strip') !== null;
      r.unmount();
      return out;
    };
    expect(at(1600)).toBe(false);
    expect(at(1920)).toBe(false);
    expect(at(1599)).toBe(true);
    expect(at(360)).toBe(true);
    expect(INSTRUMENT_SET.Inspector).toBeNull();
    expect(at(1920, INSTRUMENT_SET)).toBe(true);
  });

  it('the rail\'s Helpers section reads the route\'s session store: the same head and rows, always open', () => {
    stubWidth(1600);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    act(() => navigate(`/s/${ID}`));
    act(() => getSessionStore(ID).getState().apply({ type: 'workflows', workflows: [wf('wf_00000000-aaa')], agents: [...RUNNING, DONE] }));
    const r = render(<InspectorSections />);
    const sec = r.container.querySelector('[data-section="helpers"]')!;
    expect(sec, 'the rail section').not.toBeNull();
    expect(within(sec as HTMLElement).getByRole('heading').textContent).toBe('Helpers');
    expect(sec.textContent).toContain('3 running · 1 finished');
    expect(sec.querySelectorAll('.helpers-main [data-helper-row]')).toHaveLength(3);
    expect(within(sec as HTMLElement).getByRole('button', { name: /Finished · last 10 min \(1\)/ })).toBeTruthy();
  });

  it('Refined\'s own rail places the Helpers section at 1600', () => {
    stubWidth(1600);
    act(() => navigate(`/s/${ID}`));
    act(() => getSessionStore(ID).getState().apply({ type: 'workflows', workflows: [], agents: RUNNING }));
    const r = render(<InspectorRail />);
    const sections = [...r.container.querySelectorAll('[data-section]')].map((e) => e.getAttribute('data-section'));
    expect(sections).toContain('helpers');
  });

  it('the rail section renders nothing for a session with no helpers (a characterization pin)', () => {
    stubWidth(1600);
    act(() => navigate(`/s/${ID}-none`));
    const r = render(<InspectorSections />);
    expect(r.container.querySelector('[data-section="helpers"]')).toBeNull();
  });
});
