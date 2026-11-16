// The renewal act's L1 deciders (Overlord spec §3.3.11 H12, H13; C50; W1a renewal act Task 4): the permit, the ordered feed,
// renew's answer as an event, the owed try, the acts of a step, the mail hold, the Overlord's order, the drain and the route
// doors' `compact`. The cases are written once, in `sim/renewalActSets.ts`, so the mutation floors run the same ones.
import { describe, it } from 'vitest';
import * as feed from '../src/continuity/renewalFeed.js';
import * as order from '../src/continuity/renewalOrder.js';
import * as drain from '../src/continuity/renewalDrain.js';
import * as compact from '../src/continuity/compactOwner.js';
import {
  answerCases, compactCases, drainCases, feedCases, holdsMailCases, overlordFirstCases, permitCases,
} from './sim/renewalActSets.js';

const run = (cases: Record<string, () => void | Promise<void>>): void => { for (const [name, fn] of Object.entries(cases)) it(name, fn); };

describe('overlordFirst: the Overlord renews first, hard renewals included (C50, ruling F11)', () => run(overlordFirstCases(order)));
describe('renewalPermit: the host, then the Overlord, then the soft answer', () => run(permitCases(feed)));
describe('renewalFeed: the events a pass feeds, those stamped before the deadline first (m6)', () => run(feedCases(feed)));
describe('renewAnswerEvent, renewOwed and actsOfStep: renew\'s answer, the owed try and a step\'s acts', () => run(answerCases(feed)));
describe('renewalHoldsMail: deliveries held from draining to probing, the handover ask let through', () => run(holdsMailCases(feed)));
describe('drainVerdict: the hold table, asked for a drain', () => run(drainCases(drain)));
describe('compactRefusal: the route doors leave compact to the launch-profile lane while continuity is live', () => run(compactCases(compact)));
