// Flows wave 2 (plan 2026-11-19-flows-w2 Task 4): the shadow's verdict, one word per case.
import { describe, expect, it } from 'vitest';
import { flowBriefShadow } from '../src/flows/briefShadow.js';
import { findTemplate } from '../src/flows/templates.js';

const doc = { ok: true as const, doc: structuredClone(findTemplate('ccrc')!.doc) };
const base = { pin: { flowId: 3, version: 2 }, doc, kind: 'work' as const, vars: { 'run.id': '7' }, prefix: 'P\n\n', todayBytes: 40 };

describe('flowBriefShadow', () => {
  it('a programme with no pin', () => expect(flowBriefShadow({ ...base, pin: null })).toBe('flow-brief:no-flow'));
  it('a pinned version that cannot be read, or whose row is gone', () => {
    expect(flowBriefShadow({ ...base, doc: { ok: false, reason: 'unknown schema 9' } })).toBe('flow-brief:unreadable 3@2');
    expect(flowBriefShadow({ ...base, doc: null })).toBe('flow-brief:unreadable 3@2');
  });
  it('a review composes nothing', () => expect(flowBriefShadow({ ...base, kind: 'review' })).toBe('flow-brief:no-block 3@2'));
  it('a work dispatch: the sizes side by side, and what the server could not fill', () => {
    const block = doc.doc.blocks.find((b) => b.id === 'build')!;
    const text = `Run the ${block.skill} skill.\n\n${block.prompt}`;
    const bytes = new TextEncoder().encode(`P\n\n${text}`).length;
    expect(flowBriefShadow(base)).toBe(`flow-brief:composed 3@2 bytes=${bytes} today=40 missing=plan.path`);
  });
});
