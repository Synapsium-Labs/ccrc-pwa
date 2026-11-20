// Session helpers H1b (D-8862): the hook roster keeps its optional agent `id`, server-internal (spec 2026-11-19 §3.1 and
// Table 11's last row). An id that fails the hook's own rule reads as ABSENT, never as a malformed hook state, because
// id-less entries still occur (D-5375); and `fleet.ts`, which copies the roster onto `FleetSession.subagents`, strips it,
// so the fleet wire and the state cache are unchanged. Neutral fixture names.
//
// RED FIRST: committed before the code, against origin/main, where `reviveSubagents` drops every id.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readHookStateRawMeasured, type HookState } from '../src/hookstate.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { loadConfig } from '../src/config.js';
import { Tmux } from '../src/exec.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude-demo';
const UUID = '1'.repeat(36);
const NOW = 1_800_000_000_000;

const read = async (subagents: unknown): Promise<HookState['subagents'] | string> => {
  const reg = mkTmp('ccrc-roster-id-');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
    v: 1, state: 'working', event: 'SubagentStart', sessionId: UUID, pid: 1, updatedAt: NOW, ask: null, subagents,
    graphQueries: 0, graphGateDenials: 0,
  }));
  const r = await readHookStateRawMeasured(localIO, reg, ID, UUID);
  return r.ok ? r.state.subagents : r.reason;
};

describe('the hook roster keeps its agent id (H1b)', () => {
  it('a listed entry with an id on the hook\'s rule carries it', async () => {
    expect(await read([{ id: 'a516cb53d83b231c7', name: 'Explore', startedAt: NOW - 1000 }]))
      .toEqual([{ id: 'a516cb53d83b231c7', name: 'Explore', startedAt: NOW - 1000 }]);
  });

  it('an entry with no id stays an entry with no id (D-5375: id-less entries still occur), and keeps its place', async () => {
    expect(await read([{ name: 'reviewer', startedAt: 1 }, { id: 'a1', name: 'Explore', startedAt: 2 }]))
      .toEqual([{ name: 'reviewer', startedAt: 1 }, { id: 'a1', name: 'Explore', startedAt: 2 }]);
  });

  it.each([
    ['a space', 'a b'],
    ['a semicolon', 'bad;'],
    ['the empty string', ''],
    ['65 characters', 'a'.repeat(65)],
    ['a number', 42],
    ['null', null],
    ['an object', { id: 'a1' }],
  ])('an id that fails the rule (%s) reads as ABSENT: the entry stays, the read is not malformed', async (_why, id) => {
    expect(await read([{ id, name: 'Explore', startedAt: 5 }])).toEqual([{ name: 'Explore', startedAt: 5 }]);
  });

  it('an id at the rule\'s edges is kept: 64 characters, a hyphen and an underscore', async () => {
    const id = `${'a'.repeat(62)}-_`;
    expect(await read([{ id, name: 'Explore', startedAt: 5 }])).toEqual([{ id, name: 'Explore', startedAt: 5 }]);
  });

  it('the rest of an entry is still checked: a bad name or start still makes the whole read malformed', async () => {
    expect(await read([{ id: 'a1', startedAt: 5 }])).toBe('malformed');
    expect(await read([{ id: 'a1', name: 'Explore' }])).toBe('malformed');
  });
});

describe('FleetSession.subagents carries no id (the fleet wire and the state cache are unchanged)', () => {
  it('fleet.ts strips the roster\'s id when it copies it onto the session', async () => {
    const home = mkTmp('ccrc-roster-strip-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'claude', project: ID, workdir: `/data/projects/${ID}`, uuid: UUID, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const hs: HookState = {
      state: 'working', updatedAt: 1784600000000, event: null, ask: null, graphQueries: 0, graphGateDenials: 0, interrupted: false,
      subagents: [{ id: 'a1', name: 'Explore', startedAt: 1000 }, { name: 'reviewer', startedAt: 2000 }],
    };
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(async () => ({ ran: true, code: 1, stdout: '', stderr: '' })),
      liveStateReaderOver(localIO), 1784600000, { hookStates: new Map([[ID, hs]]) });
    const s = fleet.find((x) => x.id === ID)!;
    expect(s.subagents).toEqual([{ name: 'Explore', startedAt: 1000 }, { name: 'reviewer', startedAt: 2000 }]);
    expect(JSON.stringify(s.subagents)).not.toContain('"id"');
  });
});
