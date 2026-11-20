// D-8808 (Linear hierarchy wave 8, Task 8.3): the attached-issues reader and its counting. Linear is faked at
// `callLinear`'s FetchLike with the CONSTRUCTED fixture `read-attachments-for-url-constructed` (the read awaits the operator's
// live capture); nothing reaches a network. Neutral data: teams `AAA`/`BBB`, workspaces `ws-a`/`ws-b`, `owner/repo`.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { ATTACHED_URLS_MAX, readAttachedIssues, tallyAttached } from '../src/linking/attachedIssues.js';
import type { CcrcCallDeps } from '../src/linear/ccrcCall.js';
import type { FetchLike } from '../src/linear/client.js';
import type { LinearRouteSlot } from '../src/linear/route.js';
import { linearServicesFake } from './linearServicesFake.js';
import { linearAnswer, RATELIMITED_ERRORS } from './linearFetchFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { linearRecord } from './linearRecorded.js';
import { mkTmp } from './tmpHelpers.js';

const FIXTURE = 'read-attachments-for-url-constructed';
const url = (n: number): string => `https://github.com/owner/repo/pull/${n}`;
const slotOf = (w: 'a' | 'b'): LinearRouteSlot =>
  ({ ref: { source: 'file', id: WS[w].id }, workspaceId: WS[w].id, urlKey: WS[w].urlKey, teamKeys: WS[w].teams.map((t) => t.key) });
const node = (n: number, team: string) => ({
  issue: { id: `00000000-0006-4000-8000-${String(n).padStart(12, '0')}`, identifier: `${team}-${n}`, team: { key: team } },
});
const answerOf = (nodes: unknown[]) => ({ data: { attachmentsForURL: { nodes } } });

interface Rig { deps: CcrcCallDeps; asked: { key: string; url: string }[] }
async function rig(answer: (key: string, url: string) => unknown | 'fail'): Promise<Rig> {
  const ccrcDir = path.join(mkTmp('ccrc-attached-'), '.ccrc');
  await seedSlot(ccrcDir, 'a');
  await seedSlot(ccrcDir, 'b');
  const fx = linearServicesFake({ clock: () => 1_800_000_000_000 });
  const asked: Rig['asked'] = [];
  const fetch: FetchLike = (_u, init) => {
    const vars = (JSON.parse(init.body) as { variables: { url: string } }).variables;
    const key = init.headers['authorization'] ?? '';
    asked.push({ key, url: vars.url });
    const a = answer(key, vars.url);
    return Promise.resolve(a === 'fail'
      ? linearAnswer({ ok: true, status: 200, json: async () => RATELIMITED_ERRORS })
      : linearAnswer({ ok: true, status: 200, json: async () => a }));
  };
  return { deps: { ccrcDir, rate: fx.rate, journal: fx.journal, policy: fx.policy, fetch, now: () => 1_800_000_000_000 }, asked };
}

describe('tallyAttached: distinct issues per (workspace, key)', () => {
  it('counts one issue once however many URLs name it, per pair, with a total', () => {
    const t = tallyAttached([
      { workspaceId: 'ws-a', issueId: 'i1', teamKey: 'AAA' }, { workspaceId: 'ws-a', issueId: 'i1', teamKey: 'AAA' },
      { workspaceId: 'ws-a', issueId: 'i2', teamKey: 'AAA' }, { workspaceId: 'ws-b', issueId: 'i3', teamKey: 'AAA' },
      { workspaceId: 'ws-a', issueId: 'i4', teamKey: 'BBB' },
    ]);
    expect(t.total).toBe(4);
    expect([...t.pairs].sort((x, y) => (x.workspaceId + x.key).localeCompare(y.workspaceId + y.key))).toEqual([
      { workspaceId: 'ws-a', key: 'AAA', ids: 2 }, { workspaceId: 'ws-a', key: 'BBB', ids: 1 }, { workspaceId: 'ws-b', key: 'AAA', ids: 1 },
    ]);
  });
});

describe('readAttachedIssues', () => {
  it('asks each slot once per URL with the constructed fixture\'s document and reads its answer', async () => {
    const r = await rig(() => linearRecord(FIXTURE).body);
    const out = await readAttachedIssues(r.deps, [slotOf('a')], [url(1)]);
    expect(out).toEqual({ total: 2, pairs: [{ workspaceId: WS.a.id, key: 'AAA', ids: 1 }, { workspaceId: WS.a.id, key: 'BBB', ids: 1 }] });
    expect(r.asked).toHaveLength(1);
  });

  it('counts the same issue on two URLs once, and keeps two workspaces\' pairs apart', async () => {
    const r = await rig((key, u) => answerOf(key === WS.a.key
      ? [node(1, 'AAA'), u === url(1) ? node(2, 'AAA') : node(3, 'AAA')]   // issue 1 is on both URLs
      : [node(9, 'AAA')]));
    const out = await readAttachedIssues(r.deps, [slotOf('a'), slotOf('b')], [url(1), url(2)]);
    if (out === 'unmeasured') throw new Error('measured expected');
    expect(out.total).toBe(4);   // a: 1, 2, 3; b: 9
    expect(out.pairs).toContainEqual({ workspaceId: WS.a.id, key: 'AAA', ids: 3 });
    expect(out.pairs).toContainEqual({ workspaceId: WS.b.id, key: 'AAA', ids: 1 });
  });

  it('asks at most ATTACHED_URLS_MAX URLs', async () => {
    expect(ATTACHED_URLS_MAX).toBe(10);
    const r = await rig(() => answerOf([]));
    await readAttachedIssues(r.deps, [slotOf('a')], Array.from({ length: 15 }, (_, i) => url(i + 1)));
    expect(r.asked).toHaveLength(10);
  });

  it('an answer out of shape is unmeasured, never zero', async () => {
    const r = await rig(() => ({ data: { attachmentsForURL: { nodes: [{ issue: { id: 'not-a-uuid' } }] } } }));
    expect(await readAttachedIssues(r.deps, [slotOf('a')], [url(1)])).toBe('unmeasured');
  });

  it('a failing slot stops at its first failure and does not stop another slot', async () => {
    const r = await rig((key) => (key === WS.a.key ? 'fail' : answerOf([node(5, 'BBB')])));
    const out = await readAttachedIssues(r.deps, [slotOf('a'), slotOf('b')], [url(1), url(2)]);
    expect(out).toEqual({ total: 1, pairs: [{ workspaceId: WS.b.id, key: 'BBB', ids: 1 }] });
    expect(r.asked.filter((x) => x.key === WS.a.key)).toHaveLength(1);
    expect(r.asked.filter((x) => x.key === WS.b.key)).toHaveLength(2);
  });

  it('no slot answered, or no URL, is unmeasured', async () => {
    const r = await rig(() => 'fail');
    expect(await readAttachedIssues(r.deps, [slotOf('a')], [url(1)])).toBe('unmeasured');
    expect(await readAttachedIssues(r.deps, [slotOf('a')], [])).toBe('unmeasured');
    expect(await readAttachedIssues(r.deps, [], [url(1)])).toBe('unmeasured');
  });
});
