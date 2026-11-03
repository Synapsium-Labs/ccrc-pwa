// D-7670, R4 (#1444, spec §6.7, Linear central key plan task LK2). The one rate service has one home: Linear's quota
// and every budget are declared once, in `linear/rate.ts`; the service is constructed by the composition root alone
// and handed to `Deps` there (the plan's "One of each": one rate service instance). `callLinear`'s wait bounds are
// declared once, in `linear/client.ts`, where the header is read. Test files are not sources here, so
// `linearServicesFake.ts` is no second home.
import { describe, it, expect } from 'vitest';
import { ALL, rel, stallCode } from './helpers.js';

describe('the Linear rate service has one home (D-7670)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);

  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('LinearRateService').test('export class LinearRateService {')).toBe(true);
    expect(decl('LinearRateService').test('const linearRate = new LinearRateService(Date.now);')).toBe(false);
    expect(decl('LINEAR_QUOTA').test('export const LINEAR_QUOTA = {')).toBe(true);
    expect(decl('LINEAR_QUOTA').test('expect(LINEAR_QUOTA.requestsPerHour)')).toBe(false);
  });

  it("Linear's quota, the lanes and the budgets are declared once, in linear/rate.ts", () => {
    for (const c of ['LINEAR_QUOTA', 'LINEAR_RATE_LANES', 'LinearRateLane', 'LINEAR_SLOT_CALLS_PER_HOUR',
      'LINEAR_LANE_CALLS_PER_HOUR', 'LINEAR_RESTART_SHARE', 'LINEAR_SESSION_BUDGET', 'LinearRateService']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/rate.ts']);
    }
  });

  it("the quota's numbers are written once, so a second copy of the quota cannot be spelled beside it", () => {
    expect(holders(/\b(?:2_500|2500)\b[\s\S]*\b(?:3_000_000|3000000)\b/)).toEqual(['server/src/linear/rate.ts']);
  });

  it('the service is constructed by the composition root alone, and handed to Deps there', () => {
    expect(holders(/\bnew LinearRateService\(/)).toEqual(['server/src/index.ts']);
    expect(holders(/\bdeps\.linearRate\s*=(?!=)/)).toEqual(['server/src/index.ts']);
  });

  it("callLinear's wait bounds are declared once, beside the header they bound", () => {
    for (const c of ['LINEAR_RETRY_AFTER_MIN_S', 'LINEAR_RETRY_AFTER_MAX_S', 'LINEAR_RATE_LIMITED_FALLBACK_S']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/client.ts']);
    }
  });
});
