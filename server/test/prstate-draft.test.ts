// D-8147: `draftPr` carries `Refs KEY-123` on a private project whose branch names a ticket of its team, and nowhere else.
import { describe, it, expect } from 'vitest';
import { draftPr, type CcdPrLine } from '../src/prstate.js';

const line = (over: Partial<CcdPrLine> = {}): CcdPrLine => ({
  id: 'project-a-key-123-fix', project: 'project-a', repo: 'owner/repo', branch: 'ws/key-123-fix',
  base: 'origin/main', baseShort: 'main', tip: 'f'.repeat(40), ahead: 1, dirty: 0,
  commits: [{ sha: 'aaaaaaa', subject: 'the work', body: 'Why it matters.\n\nMore detail.' }], template: null,
  rows: [], phase: 'none', number: null, checkedAt: 1785300000000, reason: null, ...over,
});
const PRIVATE = { mode: 'private' as const, teamKey: 'KEY' };

describe('draftPr and the linking standard', () => {
  it("a private project's draft ends its first part with Refs KEY-123 when the branch names it", () => {
    const d = draftPr(line(), null, PRIVATE);
    expect(d.body.startsWith('Why it matters.\n\nRefs KEY-123\n\n## Commits')).toBe(true);
  });

  it('with a template, the Refs line ends the template part', () => {
    const d = draftPr(line({ template: '## Summary\n\n## Test plan' }), null, PRIVATE);
    expect(d.body.startsWith('## Summary\n\n## Test plan\n\nRefs KEY-123\n\n')).toBe(true);
  });

  it('with no body and no template, the Refs line is the first part', () => {
    const d = draftPr(line({ commits: [{ sha: 'aaaaaaa', subject: 'the work', body: '' }] }), null, PRIVATE);
    expect(d.body.startsWith('Refs KEY-123\n\n## Commits')).toBe(true);
  });

  it('the Refs line is not added when the template or the body already names the ticket', () => {
    const named = draftPr(line({ commits: [{ sha: 'aaaaaaa', subject: 'the work', body: 'Closes key-123 once merged.' }] }), null, PRIVATE);
    expect(named.body).not.toContain('Refs KEY-123');
    const tpl = draftPr(line({ template: 'Closes KEY-123' }), null, PRIVATE);
    expect(tpl.body).not.toContain('Refs KEY-123');
  });

  it('a branch that names another ticket or none adds nothing', () => {
    expect(draftPr(line({ branch: 'ws/quiet-basin' }), null, PRIVATE).body).not.toContain('KEY-');
    expect(draftPr(line({ branch: 'ws/other-9-x' }), null, PRIVATE).body).not.toContain('Refs');
  });

  it('a public or unknown project\'s draft names no tracker id', () => {
    // The branch here names the ticket (a workspace made before the standard); the draft adds nothing of its own.
    for (const mode of ['public', 'unknown'] as const) {
      expect(draftPr(line(), null, { mode, teamKey: 'KEY' })).toEqual(draftPr(line(), null));
      expect(draftPr(line(), null, { mode, teamKey: 'KEY' }).body).not.toContain('Refs');
    }
  });

  it("no team key: the draft is today's, byte for byte", () => {
    const today = draftPr(line(), null);
    expect(draftPr(line(), null, { mode: 'private', teamKey: null })).toEqual(today);
    expect(draftPr(line(), null, undefined)).toEqual(today);
  });
});
