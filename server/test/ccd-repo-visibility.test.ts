import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource } from './ccdWsHelpers.js';
import { GH_HTTP_502, GH_RATE_LIMITED, GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-repovis-'); });
afterEach(() => { h.cleanup(); });

const answer = (out: string): Record<string, unknown> => JSON.parse(out.split('\n')[0]!);

describe('ccd repo-visibility (D-8147)', () => {
  it('prints slug, visibility, default branch and template for a github origin', () => {
    h.makeGhRepo('demo', 'owner/repo');
    h.ghRaw('private\tmain\n');
    const r = h.run(`${GH_STUB} cmd_repo_visibility --project demo`);
    expect(r.code).toBe(0);
    expect(answer(r.stdout)).toEqual({ slug: 'owner/repo', visibility: 'private', defaultBranch: 'main', template: 'absent' });
    const call = h.ghCalls().find((c) => c.includes('gh api') || c.startsWith('api '))!;
    expect(call).toContain('api repos/owner/repo');
    expect(h.ghCalls().some((c) => c.startsWith('timeout '))).toBe(true);
  });

  it('reads template present when the main checkout holds .github/pull_request_template.md', () => {
    const main = h.makeGhRepo('demo', 'owner/repo');
    fs.mkdirSync(path.join(main, '.github'), { recursive: true });
    fs.writeFileSync(path.join(main, '.github', 'pull_request_template.md'), 'x\n');
    h.ghRaw('public\ttrunk\n');
    const r = h.run(`${GH_STUB} cmd_repo_visibility --project demo`);
    expect(answer(r.stdout)).toEqual({ slug: 'owner/repo', visibility: 'public', defaultBranch: 'trunk', template: 'present' });
  });

  it('answers no-remote for a checkout with no github origin and calls no gh', () => {
    h.makeRepo('plain');
    const r = h.run(`${GH_STUB} cmd_repo_visibility --project plain`);
    expect(r.code).toBe(1);
    expect(answer(r.stdout)).toEqual({ reason: 'no-remote' });
    expect(h.ghCalls()).toEqual([]);
  });

  it('classifies a gh failure through _gh_fail_reason', () => {
    h.makeGhRepo('demo', 'owner/repo');
    for (const [stderr, reason] of [[GH_RATE_LIMITED, 'rate-limit'], [GH_HTTP_502, 'unavailable'], ['gh auth login required\n', 'unauthenticated'], ['boom\n', 'error']] as const) {
      h.ghFail(1, stderr);
      const r = h.run(`${GH_STUB} cmd_repo_visibility --project demo`);
      expect(r.code, reason).toBe(1);
      expect(answer(r.stdout), reason).toEqual({ reason });
    }
    h.ghFail(124, '');
    expect(answer(h.run(`${GH_STUB} cmd_repo_visibility --project demo`).stdout)).toEqual({ reason: 'unavailable' });
  });

  it('answers bad-answer for a visibility outside public, private and internal', () => {
    h.makeGhRepo('demo', 'owner/repo');
    for (const body of ['secret\tmain\n', '\n', 'private\n', 'private\tma in\n']) {
      h.ghRaw(body);
      const r = h.run(`${GH_STUB} cmd_repo_visibility --project demo`);
      expect(r.code, body).toBe(1);
      expect(answer(r.stdout), body).toEqual({ reason: 'bad-answer' });
    }
  });

  it('refuses an invalid project name before any read', () => {
    h.makeGhRepo('demo', 'owner/repo');
    const r = h.run(`${GH_STUB} cmd_repo_visibility --project "a b"`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad project/);
    expect(h.run(`${GH_STUB} cmd_repo_visibility --project ../x`).stderr).toMatch(/bad project/);
    expect(h.ghCalls()).toEqual([]);
  });

  it('exact arity: any other argv is the usage line', () => {
    for (const argv of ['', '--project', 'demo', '--project demo x', '--session demo', 'demo --project']) {
      const r = h.run(`${GH_STUB} cmd_repo_visibility ${argv}`);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd repo-visibility --project <p>/);
    }
    expect(h.ghCalls()).toEqual([]);
    expect(h.ghPoison()).toEqual([]);
  });

  it('cmd_pr_state reads the template through _pr_template_file', () => {
    const src = ccdSource();
    expect(src.split('pull_request_template.md').length - 1, 'one definition of the path').toBe(1);
    expect(src).toMatch(/_pr_template_file\(\) \{/);
    expect(src).toMatch(/tmplf=\$\(_pr_template_file "\$main"\)/);
    expect(h.sh('_pr_template_file /x')).toBe('/x/.github/pull_request_template.md');
  });

  it('is a listed verb and is dispatched', () => {
    expect(h.sh('true; cmd_caps').split('\n')).toContain('repo-visibility');
    expect(ccdSource()).toContain('repo-visibility) shift; cmd_repo_visibility "$@" ;;');
  });
});
