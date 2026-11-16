// T2c (D-6329): a lane card is a door to its lane on the existing accounts route. The query rides the route, as the
// digest's `?day=` does, so there is no new route and no registry command; one builder and one reader own the spelling.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS_LANE_QUERY, RUNS_RUN_QUERY, accountsLaneHref, laneParam, matchRoute, routedHref, runParam, runsRunHref,
} from '../src/lib/routes';

/** The way the app splits a location: `useLocation()` hands out the path and the search (leading `?`) apart. */
const split = (href: string): { path: string; search: string } => {
  const q = href.indexOf('?');
  return q < 0 ? { path: href, search: '' } : { path: href.slice(0, q), search: href.slice(q) };
};

describe('the lane query on the accounts route', () => {
  it('accountsLaneHref builds /accounts?lane=<id>, encoded, and laneParam reads it back', () => {
    expect(ACCOUNTS_LANE_QUERY).toBe('lane');
    expect(accountsLaneHref('lane-a')).toBe('/accounts?lane=lane-a');
    for (const id of ['lane-a', 'lane a', 'a&b=c', 'lane/é#x', '100%']) {
      const href = accountsLaneHref(id);
      expect(href.startsWith('/accounts?lane=')).toBe(true);
      expect(href).not.toMatch(/[ #]|&b=c/);
      const { search } = split(href);
      expect(laneParam(search)).toBe(id);
      expect(laneParam(search.slice(1))).toBe(id); // with or without the leading '?'
    }
  });

  it('a search with no lane reads null', () => {
    expect(laneParam('')).toBeNull();
    expect(laneParam('?')).toBeNull();
    expect(laneParam('?day=2026-10-24')).toBeNull();
    expect(laneParam('?lane=')).toBeNull();
  });

  it('/accounts?lane=x is still the accounts route', () => {
    const { path, search } = split('/accounts?lane=x');
    expect(matchRoute(path)?.route.id).toBe('accounts');
    expect(laneParam(search)).toBe('x');
    expect(matchRoute(split(accountsLaneHref('lane a')).path)?.route.id).toBe('accounts');
  });
});

// Chat reading Task L (D-8062, R10) opened the board at `/runs?run=<id>`; the runs rebuild (D-8072, A50) sends a name in chat to
// the run's page, and `?run=` stays only to be read from old chat text.
describe('the run link and the legacy run query', () => {
  it('runsRunHref builds /runs/1527 (the run page, A50)', () => {
    expect(RUNS_RUN_QUERY).toBe('run');
    expect(runsRunHref(1527)).toBe('/runs/1527');
    expect(matchRoute(split(runsRunHref(1527)).path)?.route.id).toBe('run');
  });

  it('runParam reads it', () => {
    expect(runParam(split('/runs?run=1527').search)).toBe(1527);
    expect(runParam('run=12')).toBe(12);
    expect(runParam('?lane=x&run=7')).toBe(7);
  });

  it.each(['?run=0', '?run=-1', '?run=1.5', '?run=abc', '?run=', '', '?lane=1', '?run=1e3', '?run=+3', '?run= 3'])(
    'runParam refuses 0, -1, 1.5, abc and empty: %j', (search) => {
      expect(runParam(search)).toBeNull();
    });
});

// Chat reading Task L (D-8062): `routedHref` is the ledgers' console-path arm, moved; chat's in-app link arm asks it too.
describe('routedHref', () => {
  it('answers a routed path, with its query or fragment', () => {
    expect(routedHref('/runs')).toBe('/runs');
    expect(routedHref('/waiting/12?from=x')).toBe('/waiting/12?from=x');
    expect(routedHref('/docs/project-a/specs/x.md#top')).toBe('/docs/project-a/specs/x.md#top');
  });

  it.each(['//host/x', '/\\host', '/%2e%2e//host', '/api/x', 'https://x', '/', '', 'runs', '/runs/../../x'])(
    'is null for a path the console must not open in the app: %j', (text) => {
      expect(routedHref(text)).toBeNull();
    });

  // Review 1586 F2 and F3: a protocol-relative address is refused before it is resolved, so it never throws and never routes
  // to the console path it would resolve to (`//host/runs` resolves to `/runs`).
  it.each([
    '//', '///', '//a%', '//a%25', '//a%20b', '//4294967296/x', '//host/runs', '//evil.example/s/abc', '//host/waiting/340',
    '/\\host/runs',
  ])('never throws and is null for the protocol-relative %j', (text) => {
    expect(() => routedHref(text)).not.toThrow();
    expect(routedHref(text)).toBeNull();
  });
});
