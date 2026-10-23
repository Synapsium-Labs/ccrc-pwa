// server/test/reapcrumb.test.ts — the L0 reaping-breadcrumb union (ARCH-25, #531).
import { describe, it, expect } from 'vitest';
import { REAP_ACTS, REAP_PHASES, parseReapCrumb } from '../../shared/reapcrumb.js';
import { reviveWsAudit } from '../../shared/api.js';

describe('parseReapCrumb', () => {
  it('reads a bare phase as the reap act', () => {
    expect(parseReapCrumb('worktree')).toEqual({ kind: 'known', act: 'reap', phase: 'worktree' });
  });
  it('reads every phase of every act', () => {
    for (const act of REAP_ACTS) {
      for (const phase of REAP_PHASES[act]) {
        expect(parseReapCrumb(act === 'reap' ? phase : `${act}:${phase}`)).toEqual({ kind: 'known', act, phase });
      }
    }
  });
  it('takes the typed unknown arm, keeping the raw token, for anything ccd never writes', () => {
    for (const raw of ['sometime-else', 'reclaim:clips', 'expire:', ':branch', 'wat:branch', 'reap:branch', 'Branch', ' branch', 'clips:clips']) {
      expect(parseReapCrumb(raw), raw).toEqual({ kind: 'unknown', raw });
    }
  });
});

describe('the wire reader (reviveWsAudit)', () => {
  const audit = (reaping: unknown): unknown => ({
    id: 'p-a', branch: 'ws/a', registryBranch: 'ws/a', drift: '', base: 'origin/main', workdir: '<workdir>',
    project: 'p', repo: 'o/r', exists: false, headMatchesRegistry: false, alive: false, started: false, unit: 'enabled',
    dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0, clips: [], stashes: 0,
    worktreeBytes: null, commitsAheadOfBase: 0, pr: { number: 1, url: 'u', mergeCommit: '7a68ca0', headRefOid: 'deadbee' },
    merge: { proof: 'patch-id', fetchedAt: 1 }, transcript: '/t.jsonl', children: [], verdict: 'worktree-missing', detail: '', token: 'a'.repeat(64),
    ...(reaping === undefined ? {} : { reaping }),
  });
  const read = (reaping: unknown) => reviveWsAudit(audit(reaping), 's').reaping;
  it('maps an absent, null or empty crumb to null', () => {
    for (const r of [undefined, null, '']) expect(read(r)).toBeNull();
  });
  it('maps a string through parseReapCrumb, known or unknown', () => {
    expect(read('expire:branch')).toEqual({ kind: 'known', act: 'expire', phase: 'branch' });
    expect(read('sometime-else')).toEqual({ kind: 'unknown', raw: 'sometime-else' });
  });
});
