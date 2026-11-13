// `renewalDue`, total over the roles (Overlord spec §3.3.11, Table 3.3.11b; W1a renewal deciders Task 3). The cases are
// written once, in `sim/renewalDeciderSets.ts`, so the mutation floor runs the same ones.
import { describe, expect, it } from 'vitest';
import { FLEET_ROLES, FLEET_ROLE_NAMES } from '../../shared/fleetRoles.js';
import * as renewal from '../src/continuity/renewalDue.js';
import { renewalDueCases } from './sim/renewalDeciderSets.js';

describe('renewalDue: hard rows first, an unmeasured reading never fires', () => {
  for (const [name, fn] of Object.entries(renewalDueCases(renewal))) it(name, fn, 60_000);
});

describe('RENEWAL_ROWS: total over FLEET_ROLES (C49)', () => {
  it('its keys are FLEET_ROLE_NAMES, and only long-lived roles have rows', () => {
    expect(Object.keys(renewal.RENEWAL_ROWS)).toEqual(FLEET_ROLE_NAMES);
    for (const r of FLEET_ROLE_NAMES) expect(renewal.RENEWAL_ROWS[r].length > 0, r).toBe(FLEET_ROLES[r].longLived);
  });
});
