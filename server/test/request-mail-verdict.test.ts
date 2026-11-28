// The request ids' deciders against the real modules. The cases are `sim/requestIdSets.ts`'s, shared with the mutation floors
// (`mutation-floors.test.ts` runs each against its textual mutants), so the suite and the floor read one copy.
import { describe, it } from 'vitest';
import * as requestMail from '../src/coord/requestMail.js';
import * as peerBound from '../src/coord/peerBound.js';
import {
  mailDesignationCases, programmeRequestCases, reportMailCases, requestMailCases, requestOwnerReadCases,
} from './sim/requestIdSets.js';
import type { SuiteCase } from './sim/mutate.js';

const each = (cases: Record<string, SuiteCase>): void => {
  for (const [name, fn] of Object.entries(cases)) it(name, fn);
};

describe('requestOwnerReadOf', () => { each(requestOwnerReadCases(requestMail)); });
describe('programmeRequestVerdict', () => { each(programmeRequestCases(requestMail)); });
describe('mailDesignationOf', () => { each(mailDesignationCases(requestMail)); });
describe('requestMailVerdict', () => { each(requestMailCases(requestMail)); });
describe('reportMailVerdict', () => { each(reportMailCases(peerBound)); });
