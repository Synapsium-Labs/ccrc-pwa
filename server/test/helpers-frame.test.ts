// Session helpers H1b (D-8862): the pure pieces that put the helpers on the session's `workflows` frame (spec §3.1 "The
// read and the frame gate", §8 Table 11). `rosterInputOf` turns the stream's RAW hook read and its read time into the
// decision's roster (one fact per `HelpersUnmeasured` case, never the aged fold's one "no state"); `helpersFrame` builds the
// frame and its gate (`frameDue`, the gate H1a moved out of the delivery code), with each new member present only when it
// says something, so a session with no helpers sends today's frame byte for byte. Pure: no fs, no clock.
//
// RED FIRST: committed before the code, against origin/main, where neither function exists.
import { describe, expect, it } from 'vitest';
import {
  HELPER_DESCRIPTION_MAX,
  HELPER_KEPT_MAX,
  HELPER_LABEL_MAX,
  HELPER_LISTED_MAX,
  HELPER_NONFINAL_MAX,
  HELPER_SUMMARY_MAX_BYTES,
  type WorkflowView,
} from '../../shared/workflows.js';
import {
  decideAgentHelpers,
  emptyHelperMemory,
  frameDue,
  helpersFrame,
  lastLineTime,
  parseHelperMeta,
  rosterInputOf,
  workflowsFrame,
  type AgentArm,
  type HelperIdFacts,
  type HelperMeta,
  type WorkflowsRead,
} from '../src/workflows/model.js';
import { HOOKSTATE_FRESH_MS, type HookStateRawRead } from '../src/hookstate.js';

const NOW = 1_800_000_000_000;
const AT = NOW - 2_000;
const UUID = '1'.repeat(36);

const raw = (o: { identity?: 'current' | 'foreign' | 'unregistered'; updatedAt?: number; aliveAt?: number; subagents?: Array<{ id?: string; name: string; startedAt: number }> } = {}): HookStateRawRead => ({
  ok: true,
  sessionId: UUID,
  identity: o.identity ?? 'current',
  ...(o.aliveAt === undefined ? {} : { aliveAt: o.aliveAt }),
  state: {
    state: 'working', updatedAt: o.updatedAt ?? NOW - 60_000, event: null, ask: null, graphQueries: 0, graphGateDenials: 0, interrupted: false,
    subagents: o.subagents ?? [],
  },
});

describe('rosterInputOf: the raw hook read, told apart, never folded (spec §8, HelpersUnmeasured)', () => {
  it('a fresh, current read is usable, at its READ time, its entries in order, an absent id as null', () => {
    const r = rosterInputOf(raw({ subagents: [{ id: 'a1', name: 'Explore', startedAt: 5 }, { name: 'reviewer', startedAt: 6 }] }), AT, NOW, HOOKSTATE_FRESH_MS);
    expect(r).toEqual({ kind: 'usable', at: AT, entries: [{ id: 'a1', name: 'Explore', startedAt: 5 }, { id: null, name: 'reviewer', startedAt: 6 }] });
  });

  it('the read time is the reading\'s, not the file\'s `updatedAt` (SubagentStart and Stop leave that alone)', () => {
    const r = rosterInputOf(raw({ updatedAt: NOW - 25 * 60_000 }), AT, NOW, HOOKSTATE_FRESH_MS);
    expect(r).toMatchObject({ kind: 'usable', at: AT });
  });

  it.each([
    ['absent', { ok: false, reason: 'absent' } as const, { why: 'absent' }],
    ['unmeasured', { ok: false, reason: 'unmeasured' } as const, { why: 'unreadable' }],
    ['malformed', { ok: false, reason: 'malformed' } as const, { why: 'unreadable' }],
  ])('a failed read (%s) is unusable, for its own reason', (_n, r, why) => {
    expect(rosterInputOf(r, AT, NOW, HOOKSTATE_FRESH_MS)).toEqual({ kind: 'unusable', why });
  });

  it('another run\'s state is foreign; a session not yet registered is unregistered', () => {
    expect(rosterInputOf(raw({ identity: 'foreign' }), AT, NOW, HOOKSTATE_FRESH_MS)).toEqual({ kind: 'unusable', why: { why: 'foreign' } });
    expect(rosterInputOf(raw({ identity: 'unregistered' }), AT, NOW, HOOKSTATE_FRESH_MS)).toEqual({ kind: 'unusable', why: { why: 'unregistered' } });
  });

  it('stale past HOOKSTATE_FRESH_MS of silence, counted from the later of `updatedAt` and `aliveAt` (the aged fold\'s own clock), with its age', () => {
    const old = NOW - HOOKSTATE_FRESH_MS - 1;
    expect(rosterInputOf(raw({ updatedAt: old }), AT, NOW, HOOKSTATE_FRESH_MS)).toEqual({ kind: 'unusable', why: { why: 'stale', hookAgeMs: HOOKSTATE_FRESH_MS + 1 } });
    expect(rosterInputOf(raw({ updatedAt: NOW - HOOKSTATE_FRESH_MS }), AT, NOW, HOOKSTATE_FRESH_MS).kind).toBe('usable');
    expect(rosterInputOf(raw({ updatedAt: old, aliveAt: NOW - 1_000 }), AT, NOW, HOOKSTATE_FRESH_MS).kind).toBe('usable');
  });

  it('identity is asked before age: a stale foreign state is foreign', () => {
    expect(rosterInputOf(raw({ identity: 'foreign', updatedAt: NOW - HOOKSTATE_FRESH_MS - 1 }), AT, NOW, HOOKSTATE_FRESH_MS))
      .toEqual({ kind: 'unusable', why: { why: 'foreign' } });
  });

  it('no read this reading (no hook, or no read time): unusable as unreadable, never as a roster that lists nothing', () => {
    expect(rosterInputOf(null, null, NOW, HOOKSTATE_FRESH_MS)).toEqual({ kind: 'unusable', why: { why: 'unreadable' } });
    expect(rosterInputOf(raw(), null, NOW, HOOKSTATE_FRESH_MS)).toEqual({ kind: 'unusable', why: { why: 'unreadable' } });
  });
});

const ARM_NONE: AgentArm = { agents: [], omitted: 0, unmeasured: null, known: 0, memory: emptyHelperMemory() };
const meta = (o: Partial<HelperMeta> = {}): HelperMeta => ({
  path: 'agent', agentType: 'Explore', description: 'look around', model: 'model-a', effort: 'high', finished: false, lastWriteAt: NOW - 5_000, tokens: 1200, ...o,
});
const armOf = (metas: Record<string, HelperMeta>, facts: Record<string, HelperIdFacts> = {}, listed: string[] = Object.keys(metas), now = NOW): AgentArm =>
  decideAgentHelpers({
    now,
    roster: { kind: 'usable', at: AT, entries: listed.map((id, i) => ({ id, name: 'Explore', startedAt: NOW - 60_000 + i })) },
    proc: { kind: 'live', startedAt: NOW - 3_600_000 },
    facts: new Map(Object.entries(facts)),
    metas: new Map(Object.entries(metas)),
    memory: emptyHelperMemory(),
  });
const wf = (id: string): WorkflowView => ({
  id, name: 'flow-a', state: 'running', done: 0, failed: 0, total: 1, phase: null, phases: null, startedAt: 1, endedAt: null,
  tokens: null, tokensUnmeasured: 1, agents: [], agentsOmitted: 0,
});
const frameOf = (o: { read?: WorkflowsRead; hook?: boolean; last?: WorkflowView[]; arm?: AgentArm; readEvery?: { refreshed: number; of: number } | null; sent?: boolean } = {}) =>
  helpersFrame({
    read: o.read ?? { kind: 'absent' }, hookSaysWorkflow: o.hook ?? false, lastRead: o.last ?? [], arm: o.arm ?? ARM_NONE,
    readEvery: o.readEvery ?? null, sentBefore: o.sent ?? false,
  });

describe('helpersFrame: the frame and its gate', () => {
  it('a session that never had a workflow or a helper: not due, and the frame is today\'s, byte for byte', () => {
    const f = frameOf();
    expect(f.due).toBe(false);
    expect(JSON.stringify(f.frame)).toBe(JSON.stringify({ type: 'workflows', workflows: [] }));
  });

  it('a session with an Agent helper and NO workflow directory: due, with its rows, and the workflow rows empty', () => {
    const f = frameOf({ arm: armOf({ a1: meta() }) });
    expect(f.due).toBe(true);
    expect(f.frame).toMatchObject({ type: 'workflows', workflows: [], agents: [{ id: 'a1', state: 'running', description: 'look around' }] });
    expect(f.frame.unreadable).toBeUndefined();
  });

  it('a helper known but whose state is left out: due, and the reason is said once, on the frame', () => {
    const arm = decideAgentHelpers({
      now: NOW, roster: { kind: 'unusable', why: { why: 'stale', hookAgeMs: 41 * 60_000 } }, proc: { kind: 'live', startedAt: null },
      facts: new Map(), metas: new Map([['a1', meta()]]), memory: emptyHelperMemory(),
    });
    const f = frameOf({ arm });
    expect(f.due).toBe(true);
    expect(f.frame.agentsUnmeasured).toEqual({ why: 'stale', hookAgeMs: 41 * 60_000 });
  });

  it('each new member is present only when it says something: no `agents` for no rows, no `agentsUnmeasured` for null, no `readEvery` for null', () => {
    const f = frameOf({ read: { kind: 'read', workflows: [wf('wf_00000000-aaa')] } });
    expect(Object.keys(f.frame).sort()).toEqual(['type', 'workflows']);
    const g = frameOf({ read: { kind: 'read', workflows: [] }, arm: armOf({ a1: meta() }), readEvery: { refreshed: 6, of: 9 } });
    expect(Object.keys(g.frame).sort()).toEqual(['agents', 'readEvery', 'type', 'workflows']);
    expect(g.frame.readEvery).toEqual({ refreshed: 6, of: 9 });
  });

  it('the workflow arm is `workflowsFrame`\'s, unchanged: an absent read the hook calls a workflow is unreadable, the last rows standing', () => {
    const last = [wf('wf_00000000-aaa')];
    const f = frameOf({ read: { kind: 'absent' }, hook: true, last });
    expect(f.frame).toEqual({ type: 'workflows', workflows: last, unreadable: true });
    expect(f.due).toBe(true);
    const u = frameOf({ read: { kind: 'unreadable' }, last, arm: armOf({ a1: meta() }) });
    expect(u.frame).toMatchObject({ workflows: last, unreadable: true, agents: [{ id: 'a1' }] });
  });

  it('any frame after one was sent is due, so a client\'s rows are cleared', () => {
    expect(frameOf({ sent: true }).due).toBe(true);
  });
});

describe('characterization: the gate H1b deleted from `checkWorkflows` agrees with `frameDue` on every input it had (review 2961 F9)', () => {
  // The inline gate as it stood in `sessionws.ts#checkWorkflows` on main before H1b, copied here as the pin:
  //   const neverHad = read.kind === 'absent' && !decided.unreadable;
  //   if (neverHad && this.sentWorkflows === false) return;
  const inline = (read: WorkflowsRead, hookSaysWorkflow: boolean, sentBefore: boolean): boolean => {
    const decided = workflowsFrame(read, hookSaysWorkflow, []);
    const neverHad = read.kind === 'absent' && !decided.unreadable;
    return !(neverHad && sentBefore === false);
  };
  const reads: WorkflowsRead[] = [{ kind: 'absent' }, { kind: 'unreadable' }, { kind: 'read', workflows: [] }, { kind: 'read', workflows: [wf('wf_00000000-aaa')] }];
  for (const read of reads) {
    for (const hook of [false, true]) {
      for (const sent of [false, true]) {
        it(`${read.kind}${read.kind === 'read' ? `(${read.workflows.length})` : ''}, hook ${hook}, sent ${sent}: the same answer`, () => {
          const unreadable = workflowsFrame(read, hook, []).unreadable;
          expect(frameDue({ workflows: read.kind, unreadable, knownHelpers: 0, sentBefore: sent })).toBe(inline(read, hook, sent));
          expect(frameOf({ read, hook, sent }).due).toBe(inline(read, hook, sent));
        });
      }
    }
  }
});

describe('serialized row sizes on three capped-text fixtures (review 2961 F5)', () => {
  // Every text field at its cap; an ASCII summary at its byte cap; 13-digit times. Measured on this branch (H1a's note
  // measured 895, 1,677 and 1,287 bytes on a row of its own with other numbers in it), and pinned so that a cap that
  // grows, or a field added to the row, is a decision someone makes, not a drift.
  const worst = (ch: string): AgentArm => {
    const capped = (n: number): string => ch.repeat(n);
    const facts: HelperIdFacts = {
      launch: { at: NOW - 90_000, model: null, async: true, durationMs: null },
      end: { outcome: 'done', at: NOW - 1_000, summary: 'x'.repeat(HELPER_SUMMARY_MAX_BYTES), hasReport: true, from: 'notification' },
    };
    return armOf({
      a1: meta({ description: capped(HELPER_DESCRIPTION_MAX), agentType: capped(HELPER_LABEL_MAX), model: capped(HELPER_LABEL_MAX), effort: capped(HELPER_LABEL_MAX), tokens: 1_234_567 }),
    }, { a1: facts }, []);
  };
  const rowBytes = (arm: AgentArm): number => Buffer.byteLength(JSON.stringify(frameOf({ arm }).frame.agents![0]), 'utf8');

  it('ASCII text: 801 bytes a row', () => { expect(rowBytes(worst('a'))).toBe(801); });
  it('3-byte characters: 1,585 bytes a row', () => { expect(rowBytes(worst('€'))).toBe(1_585); });
  it('supplementary-plane characters: 1,193 bytes a row (the cap counts UTF-16 code units, so a pair is two of them)', () => {
    expect(rowBytes(worst('😀'))).toBe(1_193);
  });
});

describe('the serialized Agent arm bound includes JSON escapes (review 3014 F4)', () => {
  const wideNumber = -0.0000010000000000000002; // 25 JSON bytes, the longest shape for a JS Number
  const idOf = (n: number): string => `a${n.toString().padStart(63, '0')}`;
  // C0, C1 and lone surrogate controls add no bytes. Of the remaining characters, € uses the most JSON bytes per
  // UTF-16 unit in labels; escaped backslashes use the most JSON bytes per UTF-8 byte in summaries.
  const padded = (n: number): string => '\u0000\u0085\ud800' + '€'.repeat(n);
  const wideMeta = (): HelperMeta => ({
    ...meta(),
    ...parseHelperMeta(JSON.stringify({ description: padded(HELPER_DESCRIPTION_MAX), agentType: padded(HELPER_LABEL_MAX), model: padded(HELPER_LABEL_MAX), effort: padded(HELPER_LABEL_MAX) }))!,
    lastWriteAt: wideNumber, tokens: wideNumber,
  });
  const wideFacts = (final: boolean): HelperIdFacts => ({
    launch: { at: wideNumber, model: null, async: true, durationMs: null },
    end: final ? { outcome: 'stopped', at: wideNumber, summary: '\u0000\udc00' + '\\'.repeat(HELPER_SUMMARY_MAX_BYTES), hasReport: false, from: 'notification' } : null,
  });
  const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), 'utf8');

  it('bounds the longest final row at 1905 bytes including a fully escaped summary', () => {
    const id = idOf(1);
    const rows = frameOf({ arm: armOf({ [id]: wideMeta() }, { [id]: wideFacts(true) }, [], 0) }).frame.agents!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe('\\'.repeat(200));
    expect(bytes(rows[0])).toBe(1905);
  });

  it('caps the 84-row frame below 134000 bytes before adding any legacy workflow rows', () => {
    const open = HELPER_LISTED_MAX + HELPER_NONFINAL_MAX;
    const ids = Array.from({ length: open + HELPER_KEPT_MAX }, (_, n) => idOf(n));
    const arm = armOf(Object.fromEntries(ids.map((id) => [id, wideMeta()])),
      Object.fromEntries(ids.map((id, n) => [id, wideFacts(n >= open)])), ids.slice(0, HELPER_LISTED_MAX), 0);
    const { frame } = frameOf({ arm, readEvery: { refreshed: 6, of: 64 } });
    expect(frame.agents).toHaveLength(84);
    expect(frame.agentsUnmeasured).toEqual({ why: 'unseen', helpers: 32 });
    expect(bytes(frame)).toBeLessThan(134_000);
  });
});

describe('the reads\' two small parsers (cases added after the first mutation round)', () => {
  it('parseHelperMeta: `finished` is true only when the file says `true`; a truthy other value is not an end', () => {
    expect(parseHelperMeta(JSON.stringify({ finished: true }))?.finished).toBe(true);
    for (const v of [1, 'true', 'yes', {}, null]) expect(parseHelperMeta(JSON.stringify({ finished: v }))?.finished).toBe(false);
  });

  it('parseHelperMeta: display text loses controls and lone surrogates, but keeps letters and paired emoji', () => {
    expect(parseHelperMeta(JSON.stringify({ agentType: 'Ex\u0000plore', description: '\u001bα😀\ntext\u007f', model: 'm\ud800', effort: '\u0085\udc00' })))
      .toEqual({ agentType: 'Explore', description: 'α😀text', model: 'm', effort: null, finished: false });
  });

  it('a launch model and summary cannot bring controls or lone surrogates back onto a row', () => {
    const f: HelperIdFacts = {
      launch: { at: NOW - 90_000, model: 'm\u001b\ud800😀', async: true, durationMs: null },
      end: { outcome: 'done', at: NOW - 1_000, summary: 's\u0000\udc00😀', hasReport: true, from: 'notification' },
    };
    expect(frameOf({ arm: armOf({ a1: meta({ model: null }) }, { a1: f }, []) }).frame.agents?.[0])
      .toMatchObject({ model: 'm😀', summary: 's😀' });
  });

  it('parseHelperMeta: an array or a scalar is not a meta; an empty string field is not measured (null)', () => {
    expect(parseHelperMeta('[{"agentType":"Explore"}]')).toBeNull();
    expect(parseHelperMeta('"x"')).toBeNull();
    expect(parseHelperMeta('not json')).toBeNull();
    expect(parseHelperMeta(JSON.stringify({ agentType: '', description: '', model: '', effort: '' })))
      .toEqual({ agentType: null, description: null, model: null, effort: null, finished: false });
    expect(parseHelperMeta(JSON.stringify({ agentType: 'Explore', description: 'd', model: 'm', effort: 'high' })))
      .toEqual({ agentType: 'Explore', description: 'd', model: 'm', effort: 'high', finished: false });
  });

  it('lastLineTime: the NEWEST line with a readable timestamp; an unreadable timestamp after it is skipped, not returned', () => {
    const text = [
      JSON.stringify({ type: 'user', timestamp: '2026-11-20T10:00:00.000Z' }),
      JSON.stringify({ type: 'user', timestamp: '2026-11-20T10:05:00.000Z' }),
      JSON.stringify({ type: 'progress', timestamp: 'not a time' }),
      '{"partial": "a tail cut mid-line, "timestamp"',
    ].join('\n');
    expect(lastLineTime(text)).toBe(Date.parse('2026-11-20T10:05:00.000Z'));
    expect(lastLineTime(JSON.stringify({ timestamp: 'never' }))).toBeNull();
    expect(lastLineTime('')).toBeNull();
  });
});
