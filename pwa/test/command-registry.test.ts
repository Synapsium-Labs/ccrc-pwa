// The command registry (D-5103): pure ranking, and the base commands' own
// invariants. `command-layer.test.tsx` drives the palette and the keys.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { rankCommands, type Command } from '../src/command/registry';
import { baseCommands, fleetOrder, GO_TO } from '../src/command/commands';
import { fleetSession } from './fleetFixture';

const cmd = (id: string, title: string): Command => ({ id, title, group: 'Test', run: () => {} });

describe('rankCommands', () => {
  it('ranks prefix matches first', () => {
    const list = [
      cmd('a', 'Rerun the suites'), // a subsequence (r…u…n…s) only
      cmd('b', 'Go to Runs'), // a word starts with it
      cmd('c', 'Runs board'), // the title starts with it
      cmd('d', 'Settings'), // no match at all
    ];
    expect(rankCommands('runs', list).map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('matches case-insensitively, as a subsequence, and drops what does not match', () => {
    const list = [cmd('a', 'Go to Accounts'), cmd('b', 'Go to Archive')];
    expect(rankCommands('GTACC', list).map((c) => c.id)).toEqual(['a']);
    expect(rankCommands('zz', list)).toEqual([]);
  });

  it('keeps the registry order on an empty query and between equal scores', () => {
    const list = [cmd('a', 'Go to Fleet'), cmd('b', 'Go to Inbox'), cmd('c', 'Go to Runs')];
    expect(rankCommands('', list).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(rankCommands('go', list).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('the base commands', () => {
  it('command ids are unique', () => {
    const ids = baseCommands().map((c) => c.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size, `duplicated: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`)
      .toBe(ids.length);
  });

  it('every Go to command targets a route app.tsx routes', () => {
    // A read-only scan of app.tsx: every route is a `/^\/name\/?$/.test(path)`
    // literal there, and `/` is the fleet, the ladder's fallback. A renamed
    // route reds here rather than navigating to the placeholder.
    const app = readFileSync(path.join(import.meta.dirname, '..', 'src', 'app.tsx'), 'utf8');
    const routes = [...app.matchAll(/\/(\^\\\/[^/]*?\\\/\?\$)\/\.test\(path\)/g)]
      .map((m) => new RegExp(m[1]!.replace(/\\\//g, '/')));
    expect(routes.length, 'the scan found the routes').toBeGreaterThanOrEqual(5);
    for (const go of GO_TO) {
      if (go.path === '/') continue;
      expect(routes.some((r) => r.test(go.path)), `${go.title} → ${go.path}`).toBe(true);
    }
    expect(GO_TO.map((g) => g.path)).toContain('/');
    const ids = new Set(baseCommands().map((c) => c.id));
    for (const go of GO_TO) expect(ids.has(go.id), go.id).toBe(true);
  });

  it('orders the fleet as the fleet screen does: by card, then by the server bucket', () => {
    const a1 = fleetSession({ id: 'a1', project: 'project-a', bucket: 'idle', statusUpdatedAt: 1 });
    const a2 = fleetSession({ id: 'a2', project: 'project-a', bucket: 'idle', statusUpdatedAt: 2 });
    const b1 = fleetSession({ id: 'b1', project: 'project-b', bucket: 'attention', statusUpdatedAt: 1 });
    expect(fleetOrder([a1, a2, b1], []).map((s) => s.id)).toEqual(['b1', 'a2', 'a1']);
  });
});

describe("the ids are W2's door table's", () => {
  it('every base command carries the id docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md §The door table names', () => {
    expect(baseCommands().map((c) => c.id).sort()).toEqual([
      'go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-archive', 'go-settings',
      'open-session', 'next-session', 'prev-session',
      'switch-layout', 'switch-theme', 'show-shortcuts',
    ].sort());
  });
});
