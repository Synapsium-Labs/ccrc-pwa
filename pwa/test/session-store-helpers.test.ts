// Session helpers H1b (D-8862): the session store accepts the `workflows` frame's new members (spec §8, Table 11) and
// decides nothing: `agents`, `agentsUnmeasured` and `readEvery` are carried as the frame states them, replaced wholesale
// with every frame like the rows beside them, and an older server's frame (no member) reads as none. The three client
// reset sites keep their behaviour and clear the new members with the workflow rows: `applySessionMsg`'s backlog onto
// ANOTHER transcript, the store's initial state, and `disconnect()`. Nothing is drawn yet (H2 draws).
//
// RED FIRST: committed before the code, against origin/main, where the store keeps the workflow rows only.
import { describe, expect, it, vi } from 'vitest';
import { applySessionMsg, createSessionStore, type SessionSnapshot } from '../src/stores/session';
import type { SessionStreamMsg } from '../../shared/api';
import type { AgentHelperView, WorkflowView } from '../../shared/workflows';

const snap = (o: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
  missingFile: null, strandedAccount: null, searchComplete: true, fileMeasured: true, file: null, ...o,
});

const helper = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: 'look around', agentType: 'Explore', model: 'model-a', effort: 'high', state: 'running',
  startedAt: 1_000, endedAt: null, lastActivityAt: 2_000, tokens: 1_200, summary: null, hasReport: false, ...o,
});
const wf = (id: string): WorkflowView => ({
  id, name: 'flow-a', state: 'running', done: 1, failed: 0, total: 2, phase: null, phases: null, startedAt: 1, endedAt: null,
  tokens: null, tokensUnmeasured: 0, agents: [], agentsOmitted: 0, lastActivityAt: 3_000,
});

const full: SessionStreamMsg = {
  type: 'workflows',
  workflows: [wf('wf_00000000-aaa')],
  agents: [helper('a1'), helper('a2', { state: 'done', endedAt: 5_000, summary: 'ok', hasReport: true })],
  agentsUnmeasured: { why: 'unseen', helpers: 1 },
  readEvery: { refreshed: 6, of: 9 },
};

describe('applySessionMsg: the workflows frame\'s helper members', () => {
  it('a frame with every member: each is carried as stated', () => {
    const s = applySessionMsg(snap(), full);
    expect(s.workflows).toEqual([wf('wf_00000000-aaa')]);
    expect(s.agents).toEqual([helper('a1'), helper('a2', { state: 'done', endedAt: 5_000, summary: 'ok', hasReport: true })]);
    expect(s.agentsUnmeasured).toEqual({ why: 'unseen', helpers: 1 });
    expect(s.readEvery).toEqual({ refreshed: 6, of: 9 });
  });

  it('an older server\'s frame (no `agents`, no `agentsUnmeasured`, no `readEvery`) reads as none: the workflow rows as today', () => {
    const s = applySessionMsg(applySessionMsg(snap(), full), { type: 'workflows', workflows: [wf('wf_00000000-bbb')] });
    expect(s.workflows).toEqual([wf('wf_00000000-bbb')]);
    expect(s.workflowsUnreadable).toBe(false);
    expect(s.agents).toEqual([]);
    expect(s.agentsUnmeasured).toBeNull();
    expect(s.readEvery).toBeNull();
  });

  it('each frame replaces the members wholesale, like the workflow rows (one reader per field)', () => {
    let s = applySessionMsg(snap(), full);
    s = applySessionMsg(s, { type: 'workflows', workflows: [], agents: [helper('a3')] });
    expect(s.agents).toEqual([helper('a3')]);
    expect(s.agentsUnmeasured).toBeNull();
    expect(s.readEvery).toBeNull();
  });

  it('an unreadable frame carries its helpers too: the Agent arm is read apart from the workflow arm', () => {
    const s = applySessionMsg(snap(), { type: 'workflows', workflows: [], unreadable: true, agents: [helper('a1')] });
    expect(s.workflowsUnreadable).toBe(true);
    expect(s.agents).toEqual([helper('a1')]);
  });

  it('a snapshot built without the members (the reducer\'s own suites) reads as none and keeps reading as none', () => {
    const s = applySessionMsg(snap(), { type: 'tasks', tasks: [] });
    expect(s.agents ?? []).toEqual([]);
    expect(s.agentsUnmeasured ?? null).toBeNull();
  });
});

describe('the three client reset sites clear the new members with the workflow rows', () => {
  const backlog = (file: string): SessionStreamMsg => ({
    type: 'backlog', uuid: 'u1', events: [], offset: 10, file, missing: false, fileMeasured: true, foreignAccount: null, searchComplete: true,
  });

  it('a backlog onto ANOTHER transcript drops the helpers with the workflow rows', () => {
    const s = applySessionMsg(applySessionMsg(snap({ file: '/p/a.jsonl' }), full), backlog('/p/b.jsonl'));
    expect(s.workflows).toEqual([]);
    expect(s.agents).toEqual([]);
    expect(s.agentsUnmeasured).toBeNull();
    expect(s.readEvery).toBeNull();
  });

  it('a backlog onto the SAME transcript (a reconnect, a rotation in place) keeps them until the restated frame, as the rows', () => {
    const s = applySessionMsg(applySessionMsg(snap({ file: '/p/a.jsonl' }), full), backlog('/p/a.jsonl'));
    expect(s.workflows).toEqual([wf('wf_00000000-aaa')]);
    expect(s.agents).toHaveLength(2);
    expect(s.agentsUnmeasured).toEqual({ why: 'unseen', helpers: 1 });
    expect(s.readEvery).toEqual({ refreshed: 6, of: 9 });
  });

  it('the store\'s initial state holds no helpers', () => {
    const st = createSessionStore('s1', { api: { prompt: vi.fn() } }).getState();
    expect(st.agents).toEqual([]);
    expect(st.agentsUnmeasured).toBeNull();
    expect(st.readEvery).toBeNull();
  });

  it('the store applies the frame, and disconnect() clears the helpers with the rows', () => {
    const store = createSessionStore('s1', { api: { prompt: vi.fn() } });
    store.getState().apply(full);
    expect(store.getState().agents).toHaveLength(2);
    expect(store.getState().readEvery).toEqual({ refreshed: 6, of: 9 });
    store.getState().disconnect();
    expect(store.getState().workflows).toEqual([]);
    expect(store.getState().agents).toEqual([]);
    expect(store.getState().agentsUnmeasured).toBeNull();
    expect(store.getState().readEvery).toBeNull();
  });
});
