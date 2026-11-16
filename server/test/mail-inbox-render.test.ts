// D-6778 (mail inbox, MI-5): the pure inbox renderer and the page budget.
import { describe, it, expect } from 'vitest';
import { renderEnvelope, renderInboxEntry, pageInbox } from '../src/coord/envelope.js';
import { MAIL_ENVELOPE_FENCE, MAIL_INBOX_FENCE_INFO, parseFetchedMailEnvelope } from '../../shared/api.js';

const base = {
  id: 412, fromId: 'project-a-worker', toId: 'project-a', runId: 88, program: 'demo', wave: 2, waveOf: 4,
  kind: 'status' as const, subject: 'wave-done', body: 'Wave 2 is on the branch.', artifacts: ['/abs/path/to/ledger.md'],
};

describe('renderInboxEntry (D-6778)', () => {
  it('shows delivery, from, to, kind, subject, run with program and wave, the artifacts and the body, in that order, and no ack: line', () => {
    const out = renderInboxEntry(412, renderEnvelope(base));
    const lines = out.split('\n');
    expect(lines.slice(1, 10)).toEqual([
      'delivery: 412', 'from: project-a-worker', 'to: project-a', 'kind: status', 'subject: wave-done',
      'run: 88 (program:demo wave 2/4)', 'artifacts:', '  /abs/path/to/ledger.md', '--',
    ]);
    expect(lines[10]).toBe('Wave 2 is on the branch.');
    expect(lines[0]).toBe(`\`\`\`${MAIL_INBOX_FENCE_INFO}`);
    expect(lines[lines.length - 1]).toBe('```');
    expect(out).not.toMatch(/^ack:/m);
    expect(out).not.toContain('ccrc-api mail ack');
  });

  it('never shows the mail row\'s own id', () => {
    // the stored envelope's `id:` line is the delivery id at queue time; the printed id is the argument.
    const out = renderInboxEntry(9001, renderEnvelope({ ...base, id: 7 }));
    expect(out).toContain('delivery: 9001');
    expect(out).not.toMatch(/^id: /m);
    expect(out).not.toContain('delivery: 7');
  });

  it('omits run and artifacts when there are none', () => {
    const out = renderInboxEntry(1, renderEnvelope({ ...base, runId: null, program: null, wave: null, waveOf: null, artifacts: [] }));
    expect(out).not.toMatch(/^run:/m);
    expect(out).not.toMatch(/^artifacts:/m);
  });

  it('a body holding a run of six backticks gets a seven-backtick fence', () => {
    const out = renderInboxEntry(1, renderEnvelope({ ...base, body: 'x\n``````\ny' }));
    expect(out.startsWith(`\`\`\`\`\`\`\`${MAIL_INBOX_FENCE_INFO}\n`)).toBe(true);
    expect(out.endsWith('\n```````')).toBe(true);
  });

  it('a body holding a fake delivery: 9 line stays inside the fence', () => {
    const out = renderInboxEntry(1, renderEnvelope({ ...base, body: 'a\n```\ndelivery: 9\n```' }));
    const lines = out.split('\n');
    const fence = (lines[0] as string).replace(MAIL_INBOX_FENCE_INFO, '');
    expect(lines.filter((l) => l === fence)).toEqual([fence]);        // only the closer closes
    expect(lines[lines.length - 1]).toBe(fence);
    expect(lines.indexOf('delivery: 9')).toBeLessThan(lines.length - 1);
  });

  it('a malformed stored envelope is printed verbatim', () => {
    const bad = '```ccrc-mail\nid: 5\nnot a header\n```';
    expect(renderInboxEntry(5, bad)).toBe(bad);
    expect(renderInboxEntry(5, 'plain text')).toBe('plain text');
  });

  it('the info string is not MAIL_ENVELOPE_FENCE, and parseFetchedMailEnvelope answers not-mail on a rendered entry', () => {
    expect(MAIL_INBOX_FENCE_INFO).not.toBe(MAIL_ENVELOPE_FENCE);
    const out = renderInboxEntry(412, renderEnvelope(base));
    expect(parseFetchedMailEnvelope(out)).toEqual({ ok: false, why: 'not-mail' });
  });
});

describe('pageInbox (D-6778)', () => {
  const e = (n: number) => ({ text: 'x'.repeat(n) });

  it('stops before the entry that would cross the budget and counts it in remaining', () => {
    const r = pageInbox([e(40), e(40), e(40)], 100);
    expect(r.page.length).toBe(2);
    expect(r.remaining).toBe(1);
  });

  it('takes an entry that fits exactly', () => {
    expect(pageInbox([e(50), e(50)], 100)).toMatchObject({ remaining: 0 });
  });

  it('always takes the first entry, even one over the budget', () => {
    const r = pageInbox([e(500), e(10)], 100);
    expect(r.page.length).toBe(1);
    expect(r.remaining).toBe(1);
  });

  it('answers an empty page for no entries', () => {
    expect(pageInbox([], 100)).toEqual({ page: [], remaining: 0 });
  });

  it('counts bytes, not characters', () => {
    expect(pageInbox([{ text: 'é'.repeat(40) }, { text: 'é'.repeat(40) }], 100).page.length).toBe(1);
  });
});
