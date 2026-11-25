// Overlord W1, the renewal readings (plan `w1-renewal-readings.md`, PRs A, B and C): the L1 mappers' cases, written once in
// `sim/renewalReadingSets.ts` and run here against the real module (the floors run them against each mutant), and the
// readings' L0 vocabulary.
import { describe, it, expect } from 'vitest';
import * as readings from '../src/continuity/renewalReadings.js';
import {
  backstopDueCases, backstopInstantCases, classChangedCases, designatedClassCases, fittedCeilingCases, notLocalAskCases, notLocalCases, probesFailedTwiceCases,
  termRaisedCases,
} from './sim/renewalReadingSets.js';
import { BACKSTOP_DEFAULT, BACKSTOP_HOURS, BACKSTOP_ZONE_MAX, isBackstopHour, isBackstopZone } from '../../shared/renewal-readings.js';

describe('fittedCeilingOf', () => {
  for (const [name, fn] of Object.entries(fittedCeilingCases(readings))) it(name, fn);
});

describe('backstopInstantBefore', () => {
  for (const [name, fn] of Object.entries(backstopInstantCases(readings))) it(name, fn, 60_000);
});

describe('backstopDueOf', () => {
  for (const [name, fn] of Object.entries(backstopDueCases(readings))) it(name, fn);
});

describe('termRaisedOf (PR C)', () => {
  for (const [name, fn] of Object.entries(termRaisedCases(readings))) it(name, fn);
});

describe('classChangedOf (PR C)', () => {
  for (const [name, fn] of Object.entries(classChangedCases(readings))) it(name, fn);
});

describe('designatedClassAtMint (PR C)', () => {
  for (const [name, fn] of Object.entries(designatedClassCases(readings))) it(name, fn);
});

describe('probesFailedTwiceOf (PR C)', () => {
  for (const [name, fn] of Object.entries(probesFailedTwiceCases(readings))) it(name, fn);
});

describe('notLocalOf (PR B)', () => {
  for (const [name, fn] of Object.entries(notLocalCases(readings))) it(name, fn);
});

describe('notLocalAskOf (PR B, fix round 1 F2)', () => {
  for (const [name, fn] of Object.entries(notLocalAskCases(readings))) it(name, fn);
});

describe('the backstop vocabulary (shared/renewal-readings.ts)', () => {
  it('the hours are 0 to 23, and the default is 04:00 UTC (question 2)', () => {
    expect(BACKSTOP_HOURS).toEqual(Array.from({ length: 24 }, (_, h) => h));
    expect(BACKSTOP_DEFAULT).toEqual({ hour: 4, zone: 'UTC' });
    expect(isBackstopHour(BACKSTOP_DEFAULT.hour) && isBackstopZone(BACKSTOP_DEFAULT.zone)).toBe(true);
  });

  it('an hour is a whole number from 0 to 23', () => {
    for (const ok of [0, 4, 23]) expect(isBackstopHour(ok), String(ok)).toBe(true);
    for (const bad of [-1, 24, 4.5, '4', null, Number.NaN]) expect(isBackstopHour(bad), String(bad)).toBe(false);
  });

  it('a zone is a short name Intl takes', () => {
    for (const ok of ['UTC', 'Europe/Berlin', 'America/New_York']) expect(isBackstopZone(ok), ok).toBe(true);
    for (const bad of ['', 'Not/AZone', 4, null, 'A'.repeat(BACKSTOP_ZONE_MAX + 1)]) expect(isBackstopZone(bad), String(bad)).toBe(false);
  });
});
