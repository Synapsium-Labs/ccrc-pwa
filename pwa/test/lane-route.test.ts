// T2c (D-6329): a lane card is a door to its lane on the existing accounts route. The query rides the route, as the
// digest's `?day=` does, so there is no new route and no registry command; one builder and one reader own the spelling.
import { describe, expect, it } from 'vitest';
import { ACCOUNTS_LANE_QUERY, accountsLaneHref, laneParam, matchRoute } from '../src/lib/routes';

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
