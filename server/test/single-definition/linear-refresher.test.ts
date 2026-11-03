// D-7668 (#1444, spec §4.3, Linear central key plan task LK3). The background refresher has one home: it is declared
// once, in `linear/refresher.ts`, with its window and its retry wait; it is constructed by the composition root alone,
// over the one rate service, and handed to `Deps` there; `buildServer` passes it through and never builds one (the
// plan's "One of each": one refresher). The router has one home too. Test files are not sources here, so
// `linearServicesFake.ts` is no second home.
import { describe, it, expect } from 'vitest';
import { ALL, rel, stallCode } from './helpers.js';

describe('the Linear refresher and router have one home (D-7668)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);

  it('CONTROL: the patterns see a declaration and a construction, and pass over a use', () => {
    expect(decl('LinearRefresher').test('export class LinearRefresher {')).toBe(true);
    expect(decl('LinearRefresher').test('const r: LinearRefresher = x;')).toBe(false);
    expect(/\bnew LinearRefresher\(/.test('const linearRefresher = new LinearRefresher({ ccrcDir, rate });')).toBe(true);
  });

  it('the refresher, its window, its retry wait and the slot key check are declared once, in linear/refresher.ts', () => {
    for (const c of ['LinearRefresher', 'LINEAR_TEAMS_REFRESH_MS', 'LINEAR_MISS_RETRY_AFTER_S', 'LinearMissDetail', 'checkLinearSlot']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/refresher.ts']);
    }
  });

  it('the router and the key check each have one home', () => {
    for (const c of ['routeLinear', 'routableSlots', 'LinearRouteSlot', 'LinearRouteAsk']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/route.ts']);
    }
    for (const c of ['checkLinearKey', 'LINEAR_TEAM_PAGE_SIZE', 'KEY_CHECK_QUERY']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/client.ts']);
    }
  });

  it('the refresher is constructed by the composition root alone, over the one rate service, and handed to Deps there', () => {
    expect(holders(/\bnew LinearRefresher\(/)).toEqual(['server/src/index.ts']);
    expect(holders(/\bnew LinearRefresher\(\{[^}]*\brate: linearRate\b/)).toEqual(['server/src/index.ts']);
    expect(holders(/\bdeps\.linearRefresher\s*=(?!=)/)).toEqual(['server/src/index.ts']);
  });

  it('buildServer passes it through as it is, possibly absent, to the legacy routes', () => {
    expect(holders(/\brefresher: deps\.linearRefresher \?\? null\b/)).toEqual(['server/src/server.ts']);
  });
});
