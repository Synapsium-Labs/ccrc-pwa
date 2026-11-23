// The isolation word's deciders (Overlord W1, plan `w1-isolation.md` Task 3): each table's rows, the failure contracts,
// the attacker's domain (F5), the F1, F2 and F9 cases by name, and monotonicity (Review Focus 3). The cases live in
// `sim/isolationSets.ts`, which `mutation-floors.test.ts` runs against every mutant too.
import { describe, expect, it } from 'vitest';
import * as word from '../src/isolationWord.js';
import * as sharedIsolation from '../../shared/isolation.js';
import {
  HOLDINGS, OTHER, SD, SEPARATE, SERVER_UID, THIRD_UID, blind, domain, holdingExposureSuite, hostRelationSuite, isolationConditionSuite,
  isolationWordSuite, linkIsolationSuite, linkKernelSuite, local, notLocal, readHostReportSuite, ready, report, server, shared, wakingHostKeySuite,
  widens,
} from './sim/isolationSets.js';

const run = (name: string, cases: Record<string, () => void | Promise<void>>): void => {
  describe(name, () => { for (const [n, fn] of Object.entries(cases)) it(n, fn); });
};
run('holdingExposure', holdingExposureSuite(word));
run('linkKernel', linkKernelSuite(word));
run('linkIsolation', linkIsolationSuite(word));
run('isolationWord', isolationWordSuite(word));
run('hostRelation', hostRelationSuite(word));
run('isolationCondition', isolationConditionSuite(word));
run('wakingHostKey', wakingHostKeySuite(word));
run('readHostReport', readHostReportSuite(sharedIsolation));

describe('the failure contracts (Global Constraints), one row each', () => {
  const v = (link: word.LinkFacts, s = server()) => word.isolationWord('remote', s, [link]);
  it('an older agent at a local peer: a narrowing fact reads shared-user, otherwise agent-older', () => {
    expect(v(ready(local(SERVER_UID), 'absent'))).toEqual(shared('same-user'));
    expect(v(ready(local(THIRD_UID), 'absent'))).toEqual(blind('agent-older'));
  });
  it('an older agent at a peer that is not local reads agent-older', () => { expect(v(ready(notLocal, 'absent'))).toEqual(blind('agent-older')); });
  it('a malformed host reads as an older agent, reason report-malformed', () => {
    expect(v(ready(notLocal, 'malformed'))).toEqual(blind('report-malformed'));
    expect(v(ready(local(THIRD_UID), 'malformed'))).toEqual(blind('report-malformed'));
    expect(v(ready(local(0), 'malformed'))).toEqual(shared('root-agent'));
  });
  it('a field of the report unmeasured narrows nothing and widens nothing', () => {
    expect(v(ready(local(THIRD_UID), report('unmeasured')))).toEqual(blind('report-disagrees'));
    expect(v(ready(local(THIRD_UID), report(THIRD_UID, 'unmeasured', SD.boot)))).toEqual(SEPARATE);
  });
  it('a local peer whose digests both differ reads forwarded', () => { expect(v(ready(local(THIRD_UID), report(THIRD_UID, OTHER.machine, OTHER.boot)))).toEqual(blind('forwarded')); });
  it('a peer that is not local, no digest equal, reads kernel-unproven', () => { expect(v(ready(notLocal, report(THIRD_UID, OTHER.machine, OTHER.boot)))).toEqual(blind('kernel-unproven')); });
  it('a peer that is not local, a digest equal: a narrowing fact reads shared-user, else other-namespace', () => {
    expect(v(ready(notLocal, report(SERVER_UID, OTHER.machine, SD.boot)))).toEqual(shared('same-user'));
    expect(v(ready(notLocal, report(THIRD_UID, OTHER.machine, SD.boot)))).toEqual(blind('other-namespace'));
  });
  it('the link down, or no ready since boot', () => {
    expect(v({ link: 'down' })).toEqual(blind('link-down'));
    expect(v({ link: 'none' })).toEqual(blind('no-agent'));
  });
  it("the peer's uid unreadable reads peer-uid-unmeasured unless a narrowing fact stands", () => {
    expect(v(ready(local('unmeasured'), report(THIRD_UID)))).toEqual(blind('peer-uid-unmeasured'));
    expect(v(ready(local('unmeasured'), report(SERVER_UID)))).toEqual(shared('same-user'));
  });
  it("the peer's uid is the overflow uid: peer-uid-overflow unless a narrowing fact stands", () => {
    expect(v(ready(local(65534), report(65534)))).toEqual(blind('peer-uid-overflow'));
    expect(v(ready(local(65534), report(65534)), server({ holdings: HOLDINGS.exposed }))).toEqual(shared('store-mode'));
  });
  it('the server in a user namespace, or its uid unreadable, unless a narrowing fact stands', () => {
    const wide = ready(local(THIRD_UID), report(THIRD_UID));
    expect(v(wide, server({ initialNamespace: false }))).toEqual(blind('server-namespace'));
    expect(v(wide, server({ uid: 'unmeasured' }))).toEqual(blind('server-facts'));
    expect(v(ready(local(0), report(THIRD_UID)), server({ initialNamespace: false }))).toEqual(shared('root-agent'));
  });
  it('a held path unreadable blocks separate-user and narrows nothing', () => {
    expect(v(ready(local(THIRD_UID), report(THIRD_UID)), server({ holdings: HOLDINGS.blind }))).toEqual(blind('server-facts'));
  });
});

describe('Review Focus 1: nothing a peer controls widens alone', () => {
  it('the domain has the widening cells, and they are few', () => {
    const cells = domain();
    expect(cells.length).toBeGreaterThan(3000);
    const wide = cells.filter(widens);
    expect(wide.length).toBeGreaterThan(0);
    expect(wide.length).toBeLessThan(10);
    for (const c of wide) {
      expect(c.peer).toEqual({ locality: 'local', uid: THIRD_UID });
      expect(typeof c.report === 'object' && c.report.uid).toBe(THIRD_UID);
    }
  });
});
